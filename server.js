// Dédale : serveur en ligne.
// Il sert le jeu et relaie les messages entre joueurs. La partie elle-même tourne dans le
// navigateur de l'hôte (le premier arrivé) ; si l'hôte part, le joueur suivant prend le relais.
// Aucune dépendance : seulement Node.js 18 ou plus récent.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 5;
const COLORS = ['#ff7a59', '#3aa58a', '#d29a00', '#7b62d9', '#3b8fd6'];

// ---------- fichiers du jeu (compressés une fois au démarrage) ----------
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const files = new Map();
for (const name of fs.readdirSync(PUBLIC)) {
  const full = path.join(PUBLIC, name);
  if (!fs.statSync(full).isFile()) continue;
  const raw = fs.readFileSync(full);
  files.set('/' + name, { raw, gz: zlib.gzipSync(raw, { level: 9 }), type: TYPES[path.extname(name)] || 'application/octet-stream' });
}
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') { res.writeHead(200); return res.end('ok'); }
  const f = files.get(url === '/' ? '/index.html' : url);
  if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-cache', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
  res.end(gz ? f.gz : f.raw);
});

// ---------- WebSocket minimal (RFC 6455) ----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function encodeFrame(data, opcode = 1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, payload]);
}
class Socket {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.open = true; this.frag = null; this.alive = true;
    this.onmessage = () => {}; this.onclose = () => {};
    sock.setNoDelay(true);
    sock.on('data', (d) => this.feed(d));
    sock.on('close', () => this.closed());
    sock.on('error', () => this.closed());
  }
  feed(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    if (this.buf.length > 4 << 20) return this.close();
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 2 << 20) return this.close();
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(need);
      this.alive = true;
      if (op === 0x8) return this.close();
      if (op === 0x9) { this.raw(encodeFrame(payload, 0xA)); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x2) { if (fin) this.onmessage(payload.toString('utf8')); else this.frag = [payload]; continue; }
      if (op === 0x0 && this.frag) { this.frag.push(payload); if (fin) { const all = Buffer.concat(this.frag); this.frag = null; this.onmessage(all.toString('utf8')); } }
    }
  }
  raw(buf) { if (this.open) { try { this.sock.write(buf); } catch (e) { this.closed(); } } }
  send(obj) { this.raw(encodeFrame(JSON.stringify(obj))); }
  ping() { this.raw(encodeFrame('', 0x9)); }
  close() { if (!this.open) return; this.raw(Buffer.from([0x88, 0])); this.sock.end(); this.closed(); }
  closed() { if (!this.open) return; this.open = false; try { this.sock.destroy(); } catch (e) {} this.onclose(); }
}
server.on('upgrade', (req, sock) => {
  if ((req.url || '').split('?')[0] !== '/ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  onConnection(new Socket(sock));
});

// ---------- salons et relais ----------
const rooms = new Map();
let nextId = 1;
const cleanRoom = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Joueur';
const pub = (p) => ({ id: p.id, name: p.name, color: p.color });

function broadcast(room, msg, except) {
  const frame = encodeFrame(JSON.stringify(msg));
  for (const p of room.players.values()) if (p !== except) p.ws.raw(frame);
}
function setHost(room, id) {
  room.host = id;
  broadcast(room, { t: 'host', id });
}
function onConnection(ws) {
  let room = null, me = null;
  ws.onmessage = (txt) => {
    if (!me) {
      let m; try { m = JSON.parse(txt); } catch (e) { return; }
      if (!m || m.t !== 'join') return;
      const code = cleanRoom(m.room);
      if (code.length < 3) return ws.send({ t: 'error', msg: 'Code de partie invalide.' });
      let r = rooms.get(code);
      if (!r) { r = { code, players: new Map(), host: 0 }; rooms.set(code, r); }
      if (r.players.size >= MAX_PLAYERS) { ws.send({ t: 'error', msg: 'Cette partie est complète (' + MAX_PLAYERS + ' joueurs maximum).' }); return ws.close(); }
      const used = new Set([...r.players.values()].map((p) => p.color));
      room = r;
      me = { id: nextId++, ws, name: cleanName(m.name), color: COLORS.find((c) => !used.has(c)) || COLORS[0], joined: Date.now() };
      room.players.set(me.id, me);
      if (!room.host) room.host = me.id;
      ws.send({ t: 'welcome', id: me.id, you: pub(me), host: room.host, players: [...room.players.values()].map(pub) });
      broadcast(room, { t: 'join', p: pub(me) }, me);
      return;
    }
    // relais rapide sans tout décoder : on ne lit que le type
    const type = txt.slice(0, 12);
    if (type.startsWith('{"t":"h"')) { // joueur vers hôte
      const host = room.players.get(room.host);
      if (host && host !== me) host.ws.raw(encodeFrame('{"t":"h","from":' + me.id + txt.slice(8)));
      return;
    }
    if (type.startsWith('{"t":"b"')) { // hôte vers tout le monde
      if (room.host !== me.id) return;
      const frame = encodeFrame(txt);
      for (const p of room.players.values()) if (p !== me) p.ws.raw(frame);
      return;
    }
    if (type.startsWith('{"t":"yield"')) { // l'hôte passe la main (onglet en arrière-plan)
      if (room.host !== me.id) return;
      const next = [...room.players.values()].filter((p) => p !== me).sort((a, b) => a.joined - b.joined)[0];
      if (next) setHost(room, next.id);
    }
  };
  ws.onclose = () => {
    if (!room || !me) return;
    room.players.delete(me.id);
    if (room.players.size === 0) { rooms.delete(room.code); return; }
    if (room.host === me.id) room.host = [...room.players.values()].sort((a, b) => a.joined - b.joined)[0].id;
    broadcast(room, { t: 'leave', id: me.id, host: room.host });
  };
}

// connexions mortes : ping toutes les 20 s
setInterval(() => {
  for (const room of rooms.values()) for (const p of room.players.values()) {
    if (!p.ws.alive) { p.ws.close(); continue; }
    p.ws.alive = false; p.ws.ping();
  }
}, 20000);

server.listen(PORT, () => console.log('Dédale prêt sur le port ' + PORT));
