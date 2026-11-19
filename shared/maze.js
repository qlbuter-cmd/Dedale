// Dédale : génération du labyrinthe, partagée par le serveur et le navigateur.
// Le labyrinthe est déterministe (graine fixe) : tout le monde joue exactement sur la même carte.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DedaleMaze = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  // intersection rayon / boîte (méthode des dalles). Renvoie la distance ou -1.
  function rayBox(o, d, min, max) {
    let tmin = 0, tmax = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < min[i] || o[i] > max[i]) return -1; continue; }
      let t1 = (min[i] - o[i]) / d[i], t2 = (max[i] - o[i]) / d[i];
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    return tmin;
  }
  function makeNav(HALF, N, C, freeAt) {
    // grille de navigation (cases de 50 cm) pour les bots (marche à pied, sans grimper)
    const NS = 0.5, NW = Math.round(N * C / NS), navFree = new Uint8Array(NW * NW);
    for (let i = 0; i < NW; i++) for (let j = 0; j < NW; j++) navFree[i * NW + j] = freeAt(-HALF + (j + 0.5) * NS, -HALF + (i + 0.5) * NS, 0.42) ? 1 : 0;
    const navIdx = (x, z) => { const j = Math.floor((x + HALF) / NS), i = Math.floor((z + HALF) / NS); return i < 0 || j < 0 || i >= NW || j >= NW ? -1 : i * NW + j; };
    const navPos = (k) => ({ x: -HALF + (k % NW + 0.5) * NS, z: -HALF + (Math.floor(k / NW) + 0.5) * NS });
    function navNearest(x, z) {
      let k = navIdx(clamp(x, -HALF + 0.1, HALF - 0.1), clamp(z, -HALF + 0.1, HALF - 0.1));
      if (k >= 0 && navFree[k]) return k;
      const i0 = Math.floor(k / NW), j0 = k % NW;
      for (let rad = 1; rad < 16; rad++) for (let di = -rad; di <= rad; di++) for (let dj = -rad; dj <= rad; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
        const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= NW || j >= NW) continue;
        if (navFree[i * NW + j]) return i * NW + j;
      }
      return -1;
    }
    function navLine(a, b) { // ligne droite praticable entre deux points
      const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / 0.2);
      for (let s = 1; s < n; s++) { const k = navIdx(a.x + (b.x - a.x) * s / n, a.z + (b.z - a.z) * s / n); if (k < 0 || !navFree[k]) return false; }
      return true;
    }
    const navPrev = new Int32Array(NW * NW);
    function navPath(x0, z0, x1, z1) {
      const s = navNearest(x0, z0), g = navNearest(x1, z1);
      if (s < 0 || g < 0) return [];
      navPrev.fill(-1); navPrev[s] = s;
      const q = new Int32Array(NW * NW); let qh = 0, qt = 0; q[qt++] = s;
      while (qh < qt) {
        const cur = q[qh++]; if (cur === g) break;
        const i = Math.floor(cur / NW), j = cur % NW;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= NW || nj >= NW) continue;
          const n = ni * NW + nj; if (!navFree[n] || navPrev[n] >= 0) continue;
          if (di && dj && (!navFree[i * NW + nj] || !navFree[ni * NW + j])) continue;
          navPrev[n] = cur; q[qt++] = n;
        }
      }
      if (navPrev[g] < 0) return [];
      const cells = []; for (let c = g; c !== s; c = navPrev[c]) cells.push(c);
      cells.reverse();
      // on ne garde que les virages (tirer le fil)
      const pts = [], start = { x: x0, z: z0 }; let from = start;
      for (let k = 0; k < cells.length; k++) {
        const nxt = k + 1 < cells.length ? navPos(cells[k + 1]) : null;
        if (nxt && navLine(from, nxt)) continue;
        const p = navPos(cells[k]); pts.push(p); from = p;
      }
      return pts;
    }

    return { navPath, navNearest };
  }


  // ---------- carte importée (modèle 3D) : collisions par colonnes de 25 cm ----------
  // data : { HALF, CS, LV, Y0, NW, types: [[n0, n1, ...]], runs: base64 (Uint16 : type, répétition) }
  function buildMesh(kind, data) {
    const HALF = data.HALF, CS = data.CS, LV = data.LV, Y0 = data.Y0, NW = data.NW;
    const C = 6, N = Math.round(2 * HALF / C), H = 2.0, TH = 0;
    const bin = typeof atob === 'function' ? Uint8Array.from(atob(data.runs), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(data.runs, 'base64'));
    const runs = new Uint16Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
    const colType = new Uint16Array(NW * NW);
    for (let k = 0, p = 0; k < runs.length; k += 2) { colType.fill(runs[k], p, p + runs[k + 1]); p += runs[k + 1]; }
    const types = data.types.map((t) => { const iv = []; for (let i = 0; i < t.length; i += 2) iv.push([Y0 + t[i] * LV, Y0 + t[i + 1] * LV]); return iv; });
    const cache = new Array(NW * NW);
    function colBoxes(i, j) {
      if (i < 0 || j < 0 || i >= NW || j >= NW) return [];
      const k = i * NW + j; let b = cache[k];
      if (!b) { const x0 = -HALF + j * CS, z0 = -HALF + i * CS; b = cache[k] = types[colType[k]].map(([y0, y1]) => ({ minX: x0, maxX: x0 + CS, minZ: z0, maxZ: z0 + CS, y0, h: y1 })); }
      return b;
    }
    const col = (v) => Math.floor((v + HALF) / CS);
    function near(x, z, r) {
      const out = [], j0 = col(x - r), j1 = col(x + r), i0 = col(z - r), i1 = col(z + r);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const b = colBoxes(i, j); for (let k = 0; k < b.length; k++) out.push(b[k]); }
      return out;
    }
    function collide(o, rad, feet) {
      for (const b of near(o.x, o.z, rad + 0.02)) {
        if (feet + 0.35 > b.h || feet + 1.6 < b.y0) continue;
        const cx = clamp(o.x, b.minX, b.maxX), cz = clamp(o.z, b.minZ, b.maxZ);
        const dx = o.x - cx, dz = o.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= rad * rad) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); o.x += dx / d * (rad - d); o.z += dz / d * (rad - d); }
        else {
          const l = o.x - b.minX, rr = b.maxX - o.x, t = o.z - b.minZ, bt = b.maxZ - o.z, mm = Math.min(l, rr, t, bt);
          if (mm === l) o.x = b.minX - rad; else if (mm === rr) o.x = b.maxX + rad; else if (mm === t) o.z = b.minZ - rad; else o.z = b.maxZ + rad;
        }
      }
      o.x = clamp(o.x, -HALF, HALF); o.z = clamp(o.z, -HALF, HALF);
    }
    function groundAt(x, z, rad, feet) {
      let g = 0;
      for (const b of near(x, z, rad)) {
        if (feet + 0.36 < b.h) continue;
        const cx = clamp(x, b.minX, b.maxX), cz = clamp(z, b.minZ, b.maxZ);
        if ((x - cx) ** 2 + (z - cz) ** 2 < rad * rad * 0.6) g = Math.max(g, b.h);
      }
      return g;
    }
    // plafond au-dessus de la tête (pour ne pas traverser les arches en sautant)
    function ceilAt(x, z, feet) {
      let c = Infinity;
      for (const b of near(x, z, 0.15)) if (b.y0 > feet + 0.5 && b.y0 < c) c = b.y0;
      return c;
    }
    // rayon : parcours des colonnes traversées (DDA)
    function rayWorld(o, d, maxDist) {
      let best = maxDist;
      if (d[1] < -1e-6) { const t = -o[1] / d[1]; if (t >= 0 && t < best) best = t; }
      let j = col(o[0]), i = col(o[2]);
      const sx = d[0] > 0 ? 1 : -1, sz = d[2] > 0 ? 1 : -1;
      const dtx = Math.abs(d[0]) > 1e-9 ? CS / Math.abs(d[0]) : Infinity, dtz = Math.abs(d[2]) > 1e-9 ? CS / Math.abs(d[2]) : Infinity;
      let tx = Math.abs(d[0]) > 1e-9 ? ((-HALF + (j + (sx > 0 ? 1 : 0)) * CS) - o[0]) / d[0] : Infinity;
      let tz = Math.abs(d[2]) > 1e-9 ? ((-HALF + (i + (sz > 0 ? 1 : 0)) * CS) - o[2]) / d[2] : Infinity;
      let t0 = 0;
      for (let n = 0; n < 4000 && t0 < best; n++) {
        for (const b of colBoxes(i, j)) {
          const t = rayBox(o, d, [b.minX, b.y0, b.minZ], [b.maxX, b.h, b.maxZ]);
          if (t >= 0 && t < best) best = t;
        }
        if (tx < tz) { t0 = tx; tx += dtx; j += sx; } else { t0 = tz; tz += dtz; i += sz; }
        if (i < -1 || j < -1 || i > NW || j > NW) break;
      }
      return best;
    }
    // colonnes où l'on marche au niveau de la rue, et zone accessible depuis le centre
    const low = new Uint8Array(NW * NW);
    for (let k = 0; k < NW * NW; k++) for (const [y0, y1] of types[colType[k]]) if (y0 < 1.6 && y1 > 0.35) { low[k] = 1; break; }
    const clearAt = (i, j, r) => { for (let a = i - r; a <= i + r; a++) for (let b = j - r; b <= j + r; b++) { if (a < 0 || b < 0 || a >= NW || b >= NW || low[a * NW + b]) return false; } return true; };
    const reach = new Uint8Array(NW * NW);
    {
      let s = -1;
      for (let r = 0; r < NW / 2 && s < 0; r++) for (let a = -r; a <= r && s < 0; a++) for (let b = -r; b <= r && s < 0; b++) { const i = (NW >> 1) + a, j = (NW >> 1) + b; if (clearAt(i, j, 2)) s = i * NW + j; }
      const q = [s]; reach[s] = 1;
      while (q.length) {
        const k = q.pop(), i = Math.floor(k / NW), j = k % NW;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= NW || b >= NW) continue;
          const n = a * NW + b; if (reach[n] || !clearAt(a, b, 1)) continue; reach[n] = 1; q.push(n);
        }
      }
    }
    function freeAt(x, z, rad) {
      const i = col(z), j = col(x); if (i < 0 || j < 0 || i >= NW || j >= NW || !reach[i * NW + j]) return false;
      return clearAt(i, j, Math.ceil((rad || 0.6) / CS));
    }
    const { navPath, navNearest } = makeNav(HALF, N, C, freeAt);
    const wx = (c) => c * C - HALF, wz = (r) => r * C - HALF;
    const spawns = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const x = wx(c) + C / 2, z = wz(r) + C / 2; if (freeAt(x, z, 1)) spawns.push({ x, z }); }
    // mannequin : point libre le plus proche du centre
    let dummy = { x: 0, z: 0 }, bd = 1e9;
    for (let i = 0; i < NW; i += 2) for (let j = 0; j < NW; j += 2) { const x = -HALF + (j + 0.5) * CS, z = -HALF + (i + 0.5) * CS, d = x * x + z * z; if (d < bd && freeAt(x, z, 1.2)) { bd = d; dummy = { x, z }; } }
    // pour la mini-carte : hauteur du plus haut bloc de chaque colonne (-1 = hors carte)
    const topOf = (k) => { const iv = types[colType[k]]; if (!iv.length) return 0; const t = iv[iv.length - 1][1]; return t > 20 ? -1 : t; };
    return { kind, mesh: true, N, C, TH, H, HALF, hW: [], vW: [], obstacles: [], ladders: data.ladders || [], spawns, props: [], decor: [], towerTops: [], dummy,
      collide, groundAt, rayBox, rayWorld, freeAt, near, ceilAt, navPath, navNearest, wx, wz, mulberry32, glb: data.glb, cols: { NW, CS, topOf, reach } };
  }

  // kind : 'dedale' (le labyrinthe d'origine) ou 'place' (plus grande, place ronde et deux tours)
  function build(kind, data) {
    if (kind === 'toujane' && data) return buildMesh(kind, data);
    const PLACE = kind === 'place';
    const N = PLACE ? 16 : 12, C = 5, TH = 2.2, H = 2.0, HALF = N * C / 2;
    const rnd = mulberry32(PLACE ? 777 : 2026);
    const m = N / 2;
    // cases exclues du labyrinthe : les deux tours (blocs 2×2 dans des angles opposés)
    const TOWER_H = 4.2, TS = 1; // tours d'une case
    const towers = PLACE ? [{ r: 0, c: 0 }, { r: N - TS, c: N - TS }] : [];
    const inTower = (r, c) => towers.some((t) => r >= t.r && r < t.r + TS && c >= t.c && c < t.c + TS);
    const PLAZA_R = 12.5; // rayon du mur rond de la place (m)
    const cellDist = (r, c) => Math.hypot((c + 0.5) * C - HALF, (r + 0.5) * C - HALF);
    const hW = [], vW = []; // hW[r][c] : mur horizontal sur z = r*C ; vW[r][c] : mur vertical sur x = c*C
    for (let r = 0; r <= N; r++) { hW[r] = []; for (let c = 0; c < N; c++) hW[r][c] = true; }
    for (let r = 0; r < N; r++) { vW[r] = []; for (let c = 0; c <= N; c++) vW[r][c] = true; }

    // labyrinthe parfait par exploration en profondeur
    const seen = [];
    for (let r = 0; r < N; r++) seen[r] = new Array(N).fill(false);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (inTower(r, c)) seen[r][c] = true;
    const st0 = PLACE ? [m, m] : [0, 0];
    const stack = [st0]; seen[st0[0]][st0[1]] = true;
    while (stack.length) {
      const [r, c] = stack[stack.length - 1];
      const nb = [];
      if (r > 0 && !seen[r - 1][c]) nb.push([r - 1, c, 'n']);
      if (r < N - 1 && !seen[r + 1][c]) nb.push([r + 1, c, 's']);
      if (c > 0 && !seen[r][c - 1]) nb.push([r, c - 1, 'w']);
      if (c < N - 1 && !seen[r][c + 1]) nb.push([r, c + 1, 'e']);
      if (!nb.length) { stack.pop(); continue; }
      const [nr, nc, d] = nb[Math.floor(rnd() * nb.length)];
      if (d === 'n') hW[r][c] = false; else if (d === 's') hW[r + 1][c] = false;
      else if (d === 'w') vW[r][c] = false; else vW[r][c + 1] = false;
      seen[nr][nc] = true; stack.push([nr, nc]);
    }
    // quelques boucles pour éviter les impasses à répétition
    let removed = 0;
    while (removed < (PLACE ? 26 : 20)) {
      if (rnd() < 0.5) { const r = 1 + Math.floor(rnd() * (N - 1)), c = Math.floor(rnd() * N); if (hW[r][c] && !inTower(r, c) && !inTower(r - 1, c)) { hW[r][c] = false; removed++; } }
      else { const r = Math.floor(rnd() * N), c = 1 + Math.floor(rnd() * (N - 1)); if (vW[r][c] && !inTower(r, c) && !inTower(r, c - 1)) { vW[r][c] = false; removed++; } }
    }
    if (!PLACE) {
      // place centrale 2×2
      hW[m][m - 1] = hW[m][m] = false; vW[m - 1][m] = vW[m][m] = false;
    } else {
      // grande place ronde : on retire tous les murs proches du centre (et un couloir circulaire autour)
      const segDist = (x0, z0, x1, z1) => { const dx = x1 - x0, dz = z1 - z0, k = Math.max(0, Math.min(1, -(x0 * dx + z0 * dz) / (dx * dx + dz * dz))); return Math.hypot(x0 + dx * k, z0 + dz * k); };
      const clear = PLAZA_R + 4.2;
      for (let r = 1; r < N; r++) for (let c = 0; c < N; c++) if (segDist(c * C - HALF, r * C - HALF, (c + 1) * C - HALF, r * C - HALF) < clear) hW[r][c] = false;
      for (let r = 0; r < N; r++) for (let c = 1; c < N; c++) if (segDist(c * C - HALF, r * C - HALF, c * C - HALF, (r + 1) * C - HALF) < clear) vW[r][c] = false;
      // les tours remplacent les murs de leur bloc
      for (const t of towers) {
        for (let r = t.r; r <= t.r + TS; r++) for (let c = t.c; c < t.c + TS; c++) hW[r][c] = false;
        for (let r = t.r; r < t.r + TS; r++) for (let c = t.c; c <= t.c + TS; c++) vW[r][c] = false;
        // dégage le pied des deux échelles (milieu des faces intérieures)
      }
    }

    const wx = (c) => c * C - HALF, wz = (r) => r * C - HALF;

    // murs fusionnés en segments (boîtes alignées sur les axes)
    const obstacles = [];
    for (let r = 0; r <= N; r++) {
      let c = 0;
      while (c < N) {
        if (!hW[r][c]) { c++; continue; }
        const c0 = c; while (c < N && hW[r][c]) c++;
        obstacles.push({ minX: wx(c0) - TH / 2, maxX: wx(c) + TH / 2, minZ: wz(r) - TH / 2, maxZ: wz(r) + TH / 2, h: H });
      }
    }
    for (let c = 0; c <= N; c++) {
      let r = 0;
      while (r < N) {
        if (!vW[r][c]) { r++; continue; }
        const r0 = r; while (r < N && vW[r][c]) r++;
        obstacles.push({ minX: wx(c) - TH / 2, maxX: wx(c) + TH / 2, minZ: wz(r0) - TH / 2, maxZ: wz(r) + TH / 2, h: H });
      }
    }

    const decor = [];
    const addBox = (x0, z0, x1, z1, h, extra) => obstacles.push(Object.assign({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), h }, extra || {}));
    const towerLadders = [], towerTops = [];
    if (PLACE) {
      // mur rond de la place : une couronne de blocs, avec 6 entrées
      const SEG = 72, step = Math.PI * 2 / SEG, gapAt = (a) => { for (let k = 0; k < 6; k++) { let d = Math.abs(a - (k * Math.PI / 3 + Math.PI / 6)); d = Math.min(d, Math.PI * 2 - d); if (d < 0.17) return true; } return false; };
      const on = [];
      for (let i = 0; i < SEG; i++) {
        const a = (i + 0.5) * step; on[i] = !gapAt(a); if (!on[i]) continue;
        const x = Math.cos(a) * PLAZA_R, z = Math.sin(a) * PLAZA_R, hs = 0.6;
        addBox(x - hs, z - hs, x + hs, z + hs, H, { ring: true, hidden: true });
      }
      // tronçons continus du mur rond (pour le dessin)
      const g0 = on.indexOf(false);
      for (let k = 1, run = null; k <= SEG; k++) {
        const i = (g0 + k) % SEG;
        if (on[i]) { if (!run) run = { a0: i * step }; run.a1 = (i + 1) * step + (i < (run.a0 / step) ? Math.PI * 2 : 0); }
        if ((!on[i] || k === SEG) && run) { decor.push({ type: 'ring', r: PLAZA_R, w: 1.2, h: H, a0: run.a0, a1: run.a1 }); run = null; }
      }
      // fontaine au centre (collision en boîtes, dessin arrondi côté jeu)
      decor.push({ type: 'fountain', x: 0, z: 0, r: 2.6 });
      addBox(-2.4, -1.2, 2.4, 1.2, 0.75, { hidden: true }); addBox(-1.2, -2.4, 1.2, 2.4, 0.75, { hidden: true });
      addBox(-0.45, -0.45, 0.45, 0.45, 2.3, { hidden: true });
      // arbres en bac et bancs autour de la fontaine
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4, x = Math.cos(a) * 7.2, z = Math.sin(a) * 7.2;
        decor.push({ type: 'tree', x, z });
        addBox(x - 0.75, z - 0.75, x + 0.75, z + 0.75, 0.55, { hidden: true });
        addBox(x - 0.22, z - 0.22, x + 0.22, z + 0.22, 3.4, { hidden: true });
        const b = k * Math.PI / 2, bx = Math.cos(b) * 6.4, bz = Math.sin(b) * 6.4, along = k % 2 === 0;
        decor.push({ type: 'bench', x: bx, z: bz, rot: along ? Math.PI / 2 : 0 });
        if (along) addBox(bx - 0.3, bz - 1.0, bx + 0.3, bz + 1.0, 0.5, { hidden: true }); else addBox(bx - 1.0, bz - 0.3, bx + 1.0, bz + 0.3, 0.5, { hidden: true });
      }
      // lampadaires près des entrées
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6 + 0.24, x = Math.cos(a) * (PLAZA_R - 2.2), z = Math.sin(a) * (PLAZA_R - 2.2); decor.push({ type: 'lamp', x, z }); addBox(x - 0.15, z - 0.15, x + 0.15, z + 0.15, 3.2, { hidden: true }); }
      // tours : un gros bloc haut avec un parapet et deux échelles côté intérieur
      for (const t of towers) {
        const x0 = wx(t.c) - TH / 2, x1 = wx(t.c + TS) + TH / 2, z0 = wz(t.r) - TH / 2, z1 = wz(t.r + TS) + TH / 2;
        addBox(x0, z0, x1, z1, TOWER_H, { tower: true });
        const P = 0.4, PH = TOWER_H + 0.8;
        // côtés intérieurs (vers le centre) : ouverture au milieu pour l'échelle
        const innerX = t.c === 0 ? x1 : x0, innerZ = t.r === 0 ? z1 : z0, sx = t.c === 0 ? -1 : 1, sz = t.r === 0 ? -1 : 1;
        const midX = (x0 + x1) / 2, midZ = (z0 + z1) / 2, gap = 0.75;
        // parapet sur les 4 bords
        const edge = (ax0, az0, ax1, az1) => addBox(ax0, az0, ax1, az1, PH, { parapet: true });
        // bord intérieur en z (horizontal), avec une ouverture
        edge(x0, innerZ, midX - gap, innerZ + sz * P); edge(midX + gap, innerZ, x1, innerZ + sz * P);
        // bord intérieur en x (vertical), avec une ouverture
        edge(innerX, z0, innerX + sx * P, midZ - gap); edge(innerX, midZ + gap, innerX + sx * P, z1);
        // bords extérieurs
        const outerX = t.c === 0 ? x0 : x1, outerZ = t.r === 0 ? z0 : z1;
        edge(x0, outerZ, x1, outerZ - sz * P); edge(outerX, z0, outerX - sx * P, z1);
        // échelles au milieu des deux faces intérieures (normale vers l'extérieur de la tour)
        towerLadders.push({ x: midX, z: innerZ, nx: 0, nz: -sz, tx: -sz, tz: 0, h: TOWER_H });
        towerLadders.push({ x: innerX, z: midZ, nx: -sx, nz: 0, tx: 0, tz: sx, h: TOWER_H });
        // un abri sur le toit
        addBox(midX + sx * 1.6 - 0.55, midZ + sz * 1.6 - 0.55, midX + sx * 1.6 + 0.55, midZ + sz * 1.6 + 0.55, TOWER_H + 1.1, { parapet: true }); // petit abri dans l'angle extérieur
        towerTops.push({ x: midX - sx * 1.5, z: midZ - sz * 1.5, y: TOWER_H });
      }
    }

    // 16 échelles, une par bloc d'une grille 4×4
    const ladders = [];
    const addLadder = (x, z, nx, nz) => ladders.push({ x, z, nx, nz, tx: nz, tz: -nx });
    const lr = mulberry32(99);
    const cut = (i) => Math.floor(i * N / 4);
    for (let bi = 0; bi < 4; bi++) for (let bj = 0; bj < 4; bj++) {
      const br = cut(bi), bh = cut(bi + 1) - br, bc = cut(bj), bw = cut(bj + 1) - bc;
      for (let tries = 0; tries < 20; tries++) {
        const r = br + Math.floor(lr() * bh), c = bc + Math.floor(lr() * bw);
        if (PLACE && (inTower(r, c) || cellDist(r, c) < PLAZA_R + 4)) continue;
        const opts = [];
        if (hW[r][c]) opts.push('n');
        if (hW[r + 1][c]) opts.push('s');
        if (vW[r][c]) opts.push('w');
        if (vW[r][c + 1]) opts.push('e');
        if (!opts.length) continue;
        const d = opts[Math.floor(lr() * opts.length)];
        const mx = wx(c) + C / 2, mz = wz(r) + C / 2;
        if (d === 'n') addLadder(mx, wz(r) + TH / 2, 0, 1);
        if (d === 's') addLadder(mx, wz(r + 1) - TH / 2, 0, -1);
        if (d === 'w') addLadder(wx(c) + TH / 2, mz, 1, 0);
        if (d === 'e') addLadder(wx(c + 1) - TH / 2, mz, -1, 0);
        break;
      }
    }
    for (const l of ladders) l.h = H;
    for (const l of towerLadders) ladders.push(l);

    // petits blocs de décor posés dans les angles des cases (on peut sauter dessus)
    const props = [];
    const pr = mulberry32(404), P = 0.8;
    for (let tries = 0; props.length < 20 && tries < 600; tries++) {
      const r = Math.floor(pr() * N), c = Math.floor(pr() * N);
      if ((r < 1 && c < 1) || (Math.abs(r - (m - 0.5)) < 1 && Math.abs(c - (m - 0.5)) < 1)) continue;
      if (PLACE && (inTower(r, c) || cellDist(r, c) < PLAZA_R + 5)) continue;
      const left = pr() < 0.5, top = pr() < 0.5;
      const size = P * (0.85 + pr() * 0.4), h = Math.min(0.33, size * (0.9 + pr() * 0.3)); // simple marche : on monte dessus sans sauter
      const x = left ? wx(c) + TH / 2 + size / 2 + 0.05 : wx(c + 1) - TH / 2 - size / 2 - 0.05;
      const z = top ? wz(r) + TH / 2 + size / 2 + 0.05 : wz(r + 1) - TH / 2 - size / 2 - 0.05;
      if (ladders.some((l) => Math.hypot(l.x - x, l.z - z) < 1.8)) continue;
      if (props.some((p) => Math.hypot(p.x - x, p.z - z) < 4)) continue;
      props.push({ x, z, size, h });
      obstacles.push({ minX: x - size / 2, maxX: x + size / 2, minZ: z - size / 2, maxZ: z + size / 2, h, prop: true });
    }

    // points d'apparition : centres de cases répartis sur toute la carte
    const spawns = [];
    for (let r = 0; r < N; r += 2) for (let c = (r / 2) % 2; c < N; c += 2) {
      if (!inTower(r, c)) spawns.push({ x: wx(c) + C / 2, z: wz(r) + C / 2 });
    }
    // point libre au sol (pas dans un mur, une tour ou un décor)
    function freeAt(x, z, rad) {
      const k = rad || 0.6;
      for (const b of obstacles) if (b.h > 0.34 && x > b.minX - k && x < b.maxX + k && z > b.minZ - k && z < b.maxZ + k) return false;
      return Math.abs(x) < HALF && Math.abs(z) < HALF;
    }
    const { navPath, navNearest } = makeNav(HALF, N, C, freeAt);

    function collide(o, rad, feet) {
      for (const b of obstacles) {
        if (feet + 0.35 > b.h) continue;
        const cx = clamp(o.x, b.minX, b.maxX), cz = clamp(o.z, b.minZ, b.maxZ);
        const dx = o.x - cx, dz = o.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= rad * rad) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); o.x += dx / d * (rad - d); o.z += dz / d * (rad - d); }
        else {
          const l = o.x - b.minX, rr = b.maxX - o.x, t = o.z - b.minZ, bt = b.maxZ - o.z, mm = Math.min(l, rr, t, bt);
          if (mm === l) o.x = b.minX - rad; else if (mm === rr) o.x = b.maxX + rad; else if (mm === t) o.z = b.minZ - rad; else o.z = b.maxZ + rad;
        }
      }
      const lim = HALF + 40; o.x = clamp(o.x, -lim, lim); o.z = clamp(o.z, -lim, lim);
    }
    function groundAt(x, z, rad, feet) {
      let g = 0;
      for (const b of obstacles) {
        if (feet + 0.36 < b.h) continue;
        const cx = clamp(x, b.minX, b.maxX), cz = clamp(z, b.minZ, b.maxZ);
        if ((x - cx) ** 2 + (z - cz) ** 2 < rad * rad * 0.6) g = Math.max(g, b.h);
      }
      return g;
    }
    // distance jusqu'au premier mur ou au sol le long du rayon
    function rayWorld(o, d, maxDist) {
      let best = maxDist;
      if (d[1] < -1e-6) { const t = -o[1] / d[1]; if (t >= 0 && t < best) best = t; }
      for (const b of obstacles) {
        const t = rayBox(o, d, [b.minX, 0, b.minZ], [b.maxX, b.h, b.maxZ]);
        if (t >= 0 && t < best) best = t;
      }
      return best;
    }

    return { kind: PLACE ? 'place' : 'dedale', N, C, TH, H, HALF, hW, vW, obstacles, ladders, spawns, props, decor, towerTops, dummy: PLACE ? { x: 0, z: 4.2 } : { x: 0, z: 0 }, collide, groundAt, rayBox, rayWorld, freeAt, near: () => obstacles, ceilAt: () => Infinity, navPath, navNearest, wx, wz, mulberry32 };
  }

  return { build };
});
