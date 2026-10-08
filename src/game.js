// Dédale : version solo (toi contre 4 bots) avec toutes les armes et les bonus.
(function () {
'use strict';
const $ = (id) => document.getElementById(id);
const app = $('app');
const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!window.THREE || !window.DedaleMaze) {
  $('mLead').textContent = "Le moteur 3D n'a pas pu se charger. Vérifie ta connexion puis recharge la page.";
  $('play').hidden = true;
  return;
}
const MAP = DedaleMaze.build();
// en ligne : le navigateur du créateur (l'hôte) fait tourner la partie ; les autres envoient leurs actions
const ONLINE = !!window.DEDALE_ONLINE;
const NET = { host: !ONLINE, ws: null, out: [], mute: 0, applying: false, projSeq: 0, connected: false, inq: [] };
const r2 = (v) => Math.round(v * 100) / 100;
function emit(ev) { if (ONLINE && NET.host && !NET.mute && !NET.applying) NET.out.push(ev); }
function netSend(ev) { if (ONLINE && !NET.host) NET.inq.push(ev); }
const { N, C, TH, H, HALF } = MAP;

// ---------- utilitaires ----------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const cache = new Map();
function setText(el, v) { if (cache.get(el) !== v) { cache.set(el, v); el.textContent = v; } }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function fmtClock(t) { t = Math.max(0, Math.ceil(t)); const m = Math.floor(t / 60), s = t % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function dirFrom(yaw, pitch) { const cp = Math.cos(pitch); return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp]; }
function spreadDir(d, s) {
  if (s <= 0) return d;
  const r = [d[0] + (Math.random() - 0.5) * 2 * s, d[1] + (Math.random() - 0.5) * 2 * s, d[2] + (Math.random() - 0.5) * 2 * s];
  const l = Math.hypot(r[0], r[1], r[2]); return [r[0] / l, r[1] / l, r[2] / l];
}
function los(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
  if (d < 0.01) return true;
  return MAP.rayWorld([ax, ay, az], [dx / d, dy / d, dz / d], d) >= d - 0.3;
}
function cellOf(x, z) { return [clamp(Math.floor((z + HALF) / C), 0, N - 1), clamp(Math.floor((x + HALF) / C), 0, N - 1)]; }
function cellCenter(r, c) { return { x: MAP.wx(c) + C / 2, z: MAP.wz(r) + C / 2 }; }

// ---------- règles et contenu ----------
const RULES = { killLimit: 25, matchSeconds: 600, respawn: 3 };
const WEAPONS = {
  pistol: { name: 'Colt M1911', dmg: 30, interval: 0.3, auto: false, mag: 7, reserve: Infinity, reload: 1.3, spread: 0.012, range: 120, kick: 0.018 },
  smg: { name: 'Thompson M1A1', dmg: 14, interval: 0.085, auto: true, mag: 30, reserve: 90, reload: 2.1, spread: 0.032, range: 80, kick: 0.007 },
  rifle: { name: 'M1 Garand', dmg: 34, interval: 0.24, auto: false, mag: 8, reserve: 32, reload: 1.7, spread: 0.007, range: 150, kick: 0.02 },
  launcher: { name: 'Lance-grenades M7', dmg: 0, interval: 0.5, auto: false, mag: 1, reserve: 8, reload: 1.3, spread: 0.01, range: 0, kick: 0.06, proj: true },
  katana: { name: 'Katana', dmg: 250, interval: 0.55, auto: false, mag: Infinity, reserve: Infinity, reload: 0, spread: 0, range: 2.4, kick: 0, melee: true },
};
const ORDER = ['pistol', 'smg', 'rifle', 'launcher', 'katana'];
const GL = { speed: 26, gravity: 12, radius: 3.8, dmg: 70, direct: 250, kill: 2.2 };
const NADE = { max: 3, fuse: 2.1, radius: 5, dmg: 70, kill: 3 };
const ITEMS = {
  missile: { name: 'Missile chercheur', desc: 'Fonce sur le premier du classement', color: '#ff7a59', glyph: '!' },
  bomb: { name: 'Bombe rebondissante', desc: 'File au sol, rebondit et tue au contact', color: '#26262b', glyph: '●' },
  mine: { name: 'Mine', desc: 'Presque invisible, tue celui qui marche dessus', color: '#c0483a', glyph: '✸' },
  boost: { name: 'Turbo', desc: 'Vitesse ×1,6 pendant 4 s', color: '#c98a10', glyph: '»' },
  star: { name: 'Surcharge', desc: 'Invincible 6 s, élimine au contact', color: '#d29a00', glyph: '★' },

  shield: { name: 'Orbes gardiennes', desc: '3 orbes qui bloquent les coups', color: '#7b62d9', glyph: 'o' },
};
// poids des tirages : premier du classement → dernier (rattrapage façon jeu de kart)
const ITEM_W = {
  // la bombe rebondissante sort 3 fois plus souvent
  missile: [0.2, 3], bomb: [6, 4.5], mine: [3, 0.5], boost: [2, 1.5], star: [0.2, 2.5], shield: [3, 1],
};
const COLORS = ['#ff7a59', '#3aa58a', '#d29a00', '#7b62d9', '#3b8fd6'];
const BOT_NAMES = ['Boulon', 'Ferraille', 'Rivet', 'Écrou'];
const DIFF = [
  { spread: 0.06, react: 0.75, turn: 3.2, nade: 0.06 },
  { spread: 0.035, react: 0.45, turn: 5, nade: 0.12 },
  { spread: 0.018, react: 0.25, turn: 8, nade: 0.2 },
];

// ---------- réglages ----------
const S = { groundSpeed: 9, accel: 11, friction: 6, airAccel: 2.5, jump: 7.4, gravity: 21, hopGain: 1.07, hopMax: 1.6, climb: 5.5, fov: 95, sens: 2.2, diff: 1 };
S.quality = 2; S.exposure = 0.8;
try { const o = JSON.parse(lsGet('dedale-options') || 'null'); if (o) for (const k of ['fov', 'sens', 'diff', 'quality']) if (typeof o[k] === 'number') S[k] = o[k]; if (typeof o.exp2 === 'number') S.exposure = o.exp2; } catch (e) {}
function saveOptions() { lsSet('dedale-options', JSON.stringify({ fov: S.fov, sens: S.sens, diff: S.diff, quality: S.quality, exp2: S.exposure })); }

// ---------- rendu ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.toneMapping = THREE.LinearToneMapping;
renderer.toneMappingExposure = S.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.id = 'view';
app.prepend(renderer.domElement);
const scene = new THREE.Scene();
const HORIZON = 0xf2f2f2;
scene.fog = new THREE.Fog(HORIZON, 35, 140);
const camera = new THREE.PerspectiveCamera(S.fov, 1, 0.05, 600);
camera.rotation.order = 'YXZ';
scene.add(camera);
let baseFov = S.fov;
function resize() {
  const w = app.clientWidth, h = app.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; baseFov = S.fov; camera.fov = baseFov; camera.updateProjectionMatrix();
  if (typeof applyQuality === 'function' && ADDONS) applyQuality();
}
let ADDONS = null, composer = null;
window.addEventListener('resize', resize);
resize();

// ciel neutre avec quelques nuages, soleil bas aux ombres nettes
const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0xc9d3dd) }, bot: { value: new THREE.Color(HORIZON) } },
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying vec3 vD; void main(){ vec3 c = mix(bot, top, smoothstep(0.0, 0.6, vD.y)); gl_FragColor = vec4(c,1.0); }'
}));
sky.renderOrder = -1; scene.add(sky);
{
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false });
  const cr = MAP.mulberry32(77);
  for (let i = 0; i < 18; i++) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(cr() * 4);
    for (let j = 0; j < n; j++) { const s = 7 + cr() * 9; const m = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), cloudMat); m.position.set(j * 9 - n * 4 + cr() * 5, cr() * 4, cr() * 8); m.scale.y = 0.45; g.add(m); }
    const a = cr() * Math.PI * 2, d = 170 + cr() * 180;
    g.position.set(Math.cos(a) * d, 55 + cr() * 50, Math.sin(a) * d); g.rotation.y = cr() * 3;
    scene.add(g);
  }
}
const hemi = new THREE.HemisphereLight(0xffffff, 0xbdbdbd, 0.72); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.75);
sun.position.set(-30, 30, 20); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 140 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
scene.add(sun);

// ---------- décor du labyrinthe : blanc neutre, panneaux de béton et dalles ----------
const panelTex = (() => {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = '#f1f1f1'; x.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 260; i++) { const g = 236 + Math.floor(Math.random() * 12); x.fillStyle = 'rgba(' + g + ',' + g + ',' + g + ',.35)'; x.fillRect(Math.random() * 256, Math.random() * 128, 2 + Math.random() * 6, 2 + Math.random() * 6); }
  x.fillStyle = 'rgba(0,0,0,.13)'; x.fillRect(0, 0, 256, 3); x.fillRect(0, 0, 3, 128);
  x.fillStyle = 'rgba(255,255,255,.7)'; x.fillRect(0, 3, 256, 1); x.fillRect(3, 0, 1, 128);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
})();
// contours : un fin trait noir sur les arêtes de tous les volumes
const edgeLineMat = new THREE.LineBasicMaterial({ color: 0x141414 });
const edgeCache = new Map();
function edgesOf(geo, angle) {
  const k = geo.uuid + ':' + angle;
  if (!edgeCache.has(k)) edgeCache.set(k, new THREE.EdgesGeometry(geo, angle));
  return edgeCache.get(k);
}
function outline(root, angle) {
  const list = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.noOutline && !o.userData.outlined) list.push(o); });
  for (const m of list) { m.userData.outlined = true; const l = new THREE.LineSegments(edgesOf(m.geometry, angle || 35), edgeLineMat); l.userData.noOutline = true; m.add(l); }
  return root;
}
const wallMat = new THREE.MeshStandardMaterial({ map: panelTex, color: 0xffffff, roughness: 0.95, envMapIntensity: 0.45 });
const PANEL_W = 2, PANEL_H = 1;
const wallMeshes = [];
function buildWalls(Geo) {
  for (const m of wallMeshes) { scene.remove(m); m.geometry.dispose(); }
  wallMeshes.length = 0;
  for (const b of MAP.obstacles) {
    const bh = b.h, w = b.maxX - b.minX, d = b.maxZ - b.minZ, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const geo = Geo ? new Geo(w, bh, d, 2, b.prop ? 0.035 : 0.05) : new THREE.BoxGeometry(w, bh, d);
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const wx_ = pos.getX(i) + cx, wy = pos.getY(i) + bh / 2, wz_ = pos.getZ(i) + cz;
      const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nzz = Math.abs(nor.getZ(i));
      // coordonnées de texture à l'échelle du monde : les panneaux gardent la même taille partout
      if (ny >= nx && ny >= nzz) uv.setXY(i, wx_ / PANEL_W, wz_ / PANEL_W);
      else if (nx >= nzz) uv.setXY(i, wz_ / PANEL_W, wy / PANEL_H);
      else uv.setXY(i, wx_ / PANEL_W, wy / PANEL_H);
    }
    uv.needsUpdate = true;
    const body = new THREE.Mesh(geo, wallMat);
    body.position.set(cx, bh / 2, cz); body.castShadow = body.receiveShadow = true;
    body.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, bh, d)), edgeLineMat));
    scene.add(body); wallMeshes.push(body);
  }
}
buildWalls(null);
{
  // sol en dalles d'un mètre
  const SZ = 2048, span = N * C + 2, ppm = SZ / span, px = (v) => (v + span / 2) * ppm;
  const cv = document.createElement('canvas'); cv.width = cv.height = SZ;
  const x = cv.getContext('2d');
  x.fillStyle = '#e9e9e9'; x.fillRect(0, 0, SZ, SZ);
  const tr = MAP.mulberry32(9);
  for (let i = Math.floor(-span / 2); i < span / 2; i++) for (let j = Math.floor(-span / 2); j < span / 2; j++) {
    const g = 228 + Math.floor(tr() * 10);
    x.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
    x.fillRect(px(i) + 2, px(j) + 2, ppm - 4, ppm - 4);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(span, span), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, envMapIntensity: 0.4 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const out = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 1, envMapIntensity: 0.4 }));
  out.rotation.x = -Math.PI / 2; out.position.y = -0.02; out.receiveShadow = true; scene.add(out);
}
// ombre de contact douce sous les personnages et les objets
const blobTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const x = cv.getContext('2d'), gr = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(30,30,30,.22)'); gr.addColorStop(1, 'rgba(30,30,30,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
const blobGeo = new THREE.PlaneGeometry(1, 1);
function blob(size) { const m = new THREE.Mesh(blobGeo, blobMat); m.userData.noOutline = true; m.rotation.x = -Math.PI / 2; m.position.y = 0.012; m.scale.setScalar(size); m.renderOrder = 1; return m; }
{
  const ladderMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.7 });
  const len = H + 0.8;
  const rail = new THREE.BoxGeometry(0.06, len, 0.06), rung = new THREE.BoxGeometry(0.76, 0.04, 0.04);
  for (const l of MAP.ladders) {
    const g = new THREE.Group();
    for (const s of [-0.38, 0.38]) { const m = new THREE.Mesh(rail, ladderMat); m.position.set(s, len / 2, 0); m.castShadow = true; g.add(m); }
    for (let y = 0.35; y < len - 0.2; y += 0.38) { const m = new THREE.Mesh(rung, ladderMat); m.position.y = y; m.castShadow = true; g.add(m); }
    g.position.set(l.x + l.nx * 0.08, 0, l.z + l.nz * 0.08); g.rotation.y = Math.atan2(l.nx, l.nz);
    outline(g); scene.add(g);
  }
}

// ---------- modèles d'armes ----------
const M = {
  metal: new THREE.MeshStandardMaterial({ color: 0x2f3134, roughness: 0.42, metalness: 0.65 }),
  park: new THREE.MeshStandardMaterial({ color: 0x45483f, roughness: 0.62, metalness: 0.35 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6b4126, roughness: 0.62 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x4a2c19, roughness: 0.7 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.35, metalness: 0.7 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x5a6040, roughness: 0.75 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x6b6a4c, roughness: 0.95 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xd6a983, roughness: 0.8 }),
};
function part(g, w, h, d, mat, x, y, z, rx) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); if (rx) m.rotation.x = rx; m.castShadow = true; g.add(m); return m; }
function cyl(g, r, l, mat, x, y, z) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 8), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); g.add(m); return m; }
// u : position le long de l'arme (positive vers le canon), v : hauteur. Le canon pointe vers -z.
function profile(g, pts, width, mat, x) {
  const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 });
  geo.translate(0, 0, -width / 2); geo.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(geo, mat); m.position.x = x || 0; m.castShadow = true; g.add(m); return m;
}
function tube(g, r, u0, u1, v, mat, x, seg) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, u1 - u0, seg || 12), mat); m.rotation.x = Math.PI / 2; m.position.set(x || 0, v, -(u0 + u1) / 2); m.castShadow = true; g.add(m); return m; }
function blk(g, w, h, l, u, v, mat, x) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat); m.position.set(x || 0, v, -u); m.castShadow = true; g.add(m); return m; }
function buildGarand(g) {
  profile(g, [[-0.36, -0.125], [-0.36, 0.024], [-0.3, 0.028], [-0.1, 0.004], [-0.06, -0.004], [-0.03, 0.012], [0.47, 0.012], [0.48, -0.012], [0.12, -0.034], [0.04, -0.038], [-0.02, -0.078], [-0.07, -0.082], [-0.11, -0.055], [-0.36, -0.125]], 0.042, M.wood);
  blk(g, 0.044, 0.152, 0.008, -0.364, -0.05, M.metal);
  blk(g, 0.034, 0.034, 0.22, 0.07, 0.029, M.park);
  blk(g, 0.02, 0.006, 0.05, 0.05, 0.048, M.brass);
  blk(g, 0.036, 0.022, 0.3, 0.31, 0.03, M.wood);
  tube(g, 0.011, 0.17, 0.8, 0.03, M.metal);
  tube(g, 0.012, 0.62, 0.77, 0.012, M.metal);
  blk(g, 0.006, 0.006, 0.36, 0.33, 0.02, M.metal, 0.021);
  blk(g, 0.006, 0.022, 0.012, 0.775, 0.05, M.metal);
  blk(g, 0.022, 0.024, 0.024, -0.02, 0.055, M.park);
  blk(g, 0.012, 0.006, 0.055, 0.015, -0.048, M.metal);
  blk(g, 0.004, 0.02, 0.004, 0.02, -0.035, M.metal);
}
function buildProcGrenade() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 1), M.olive); body.scale.set(1, 1.3, 1); body.castShadow = true; g.add(body);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.02, 8), M.park); top.position.y = 0.045; g.add(top);
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.012), M.park); spoon.position.set(0.024, 0.02, 0); spoon.rotation.z = -0.25; g.add(spoon);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.01, 0.002, 6, 12), M.metal); ring.position.set(-0.016, 0.05, 0); ring.rotation.y = Math.PI / 2; g.add(ring);
  return outline(g);
}
function buildProcWeapon(kind) {
  const g = new THREE.Group();
  if (kind === 'pistol') { // Colt M1911
    blk(g, 0.026, 0.032, 0.21, 0.065, 0.042, M.metal);
    blk(g, 0.024, 0.016, 0.15, 0.06, 0.018, M.park);
    profile(g, [[-0.048, 0.014], [0.002, 0.014], [-0.014, -0.088], [-0.062, -0.082]], 0.03, M.grip);
    blk(g, 0.026, 0.01, 0.05, -0.03, -0.088, M.park);
    blk(g, 0.008, 0.005, 0.04, 0.03, -0.004, M.metal);
    blk(g, 0.008, 0.016, 0.012, -0.046, 0.06, M.metal);
    tube(g, 0.009, 0.165, 0.175, 0.042, M.metal);
    blk(g, 0.004, 0.008, 0.01, 0.16, 0.062, M.metal);
    blk(g, 0.014, 0.008, 0.01, -0.03, 0.062, M.metal);
  } else if (kind === 'smg') { // Thompson M1A1
    profile(g, [[-0.34, -0.1], [-0.34, 0.022], [-0.1, 0.022], [-0.08, 0.004], [-0.08, -0.03], [-0.34, -0.1]], 0.036, M.wood);
    blk(g, 0.04, 0.055, 0.27, 0.05, 0.012, M.metal);
    tube(g, 0.012, 0.18, 0.38, 0.022, M.metal);
    blk(g, 0.004, 0.016, 0.008, 0.37, 0.038, M.metal);
    blk(g, 0.02, 0.02, 0.03, -0.05, 0.05, M.metal);
    profile(g, [[-0.065, -0.014], [-0.02, -0.014], [-0.04, -0.112], [-0.085, -0.108]], 0.03, M.wood);
    blk(g, 0.01, 0.005, 0.04, 0.0, -0.03, M.metal);
    blk(g, 0.024, 0.17, 0.044, 0.1, -0.098, M.park);
    blk(g, 0.034, 0.034, 0.13, 0.25, -0.008, M.wood);
    blk(g, 0.01, 0.012, 0.012, 0.09, 0.03, M.metal, 0.024);
  } else if (kind === 'rifle') { // M1 Garand
    buildGarand(g);
  } else if (kind === 'launcher') { // M1 Garand + lance-grenades M7
    buildGarand(g);
    tube(g, 0.014, 0.78, 0.88, 0.03, M.park);
    const nade = new THREE.Group(); g.add(nade);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), M.olive); body.scale.set(1, 1, 1.9); body.position.set(0, 0.03, -0.97); body.castShadow = true; nade.add(body);
    tube(nade, 0.01, 0.86, 0.92, 0.03, M.park);
    for (let i = 0; i < 4; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.034, 0.04), M.park); fin.position.set(0, 0.03, -0.88); fin.rotation.z = i * Math.PI / 4; nade.add(fin); }
    g.userData.nade = nade;
  } else if (kind === 'katana') {
    const steel = new THREE.MeshStandardMaterial({ color: 0xd8dadd, roughness: 0.18, metalness: 0.95 });
    const wrap = new THREE.MeshStandardMaterial({ color: 0x1f1f23, roughness: 0.85 });
    blk(g, 0.03, 0.034, 0.26, -0.1, 0, wrap);
    for (let i = 0; i < 6; i++) blk(g, 0.032, 0.006, 0.012, -0.2 + i * 0.04, 0.018, M.metal);
    const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.008, 18), M.metal); tsuba.rotation.x = Math.PI / 2; tsuba.position.z = -0.035; tsuba.castShadow = true; g.add(tsuba);
    blk(g, 0.016, 0.04, 0.03, 0.05, 0.002, M.brass);
    // lame légèrement courbée : segments qui remontent vers la pointe
    const seg = 6, L = 0.72;
    for (let i = 0; i < seg; i++) {
      const u0 = 0.065 + (L / seg) * i, curve = (i / seg) * (i / seg) * 0.05;
      const b = blk(g, 0.006, 0.03 - i * 0.002, L / seg + 0.004, u0 + L / seg / 2, curve, steel);
      b.rotation.x = (i / seg) * 0.12;
    }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 4), steel); tip.rotation.x = -Math.PI / 2 - 0.15; tip.position.set(0, 0.054, -(0.065 + L + 0.02)); tip.scale.x = 0.3; g.add(tip);
  }
  return g;
}
const MUZZLE_Z = { pistol: -0.18, smg: -0.39, rifle: -0.81, launcher: -1.03, katana: -0.5 };

// ---------- modèles 3D importés (Kenney) : remplacent les formes de base dès qu'ils sont prêts ----------
const MODEL_FIT = { pistol: [0.26, -0.07], smg: [0.74, -0.34], rifle: [1.16, -0.36], launcher: [0.85, -0.3], nade: [0.1, 0] };
const modelInstances = { pistol: [], smg: [], rifle: [], launcher: [], katana: [], nade: [] };
let MODELS = null;
function applyModel(g, kind) {
  if (g.userData.model) return;
  g.userData.proc.visible = false; g.userData.nade = null;
  const m = MODELS[kind].clone(true); outline(m); g.add(m); g.userData.model = m;
}
function wrapModel(kind, proc) {
  const g = new THREE.Group(); g.add(proc); g.userData.proc = proc;
  if (proc.userData.nade) g.userData.nade = proc.userData.nade;
  modelInstances[kind].push(g);
  if (MODELS && MODELS[kind]) applyModel(g, kind);
  return g;
}
function buildWeapon(kind) { return wrapModel(kind, buildProcWeapon(kind)); }
function buildGrenade(scale) { const g = wrapModel('nade', buildProcGrenade()); g.scale.setScalar(scale || 1); return g; }
const modelMat = new THREE.MeshStandardMaterial({ color: 0x3d3f44, roughness: 0.55, metalness: 0.35 });
function prepModel(root, kind) {
  const [len, rearU] = MODEL_FIT[kind], isNade = kind === 'nade';
  root.traverse((o) => { if (o.isMesh) { o.material = modelMat; o.castShadow = true; o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
  root.scale.setScalar(len / (isNade ? size.y : size.z));
  root.updateMatrixWorld(true);
  box.setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.set(-c.x, -c.y, isNade ? -c.z : -rearU - box.max.z);
  const wrap = new THREE.Group(); wrap.add(root);
  if (!isNade) MUZZLE_Z[kind] = -(rearU + len);
  return wrap;
}
async function loadModels() {
  const data = window.DEDALE_MODELS;
  if (!data) return;
  if (!THREE.GLTFLoader) await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js');
  if (!THREE.GLTFLoader) return;
  const loader = new THREE.GLTFLoader(), ready = {};
  for (const kind of Object.keys(data)) {
    try {
      const bin = Uint8Array.from(atob(data[kind]), (ch) => ch.charCodeAt(0)).buffer;
      const gltf = await new Promise((ok, ko) => loader.parse(bin, '', ok, ko));
      ready[kind] = prepModel(gltf.scene, kind);
    } catch (e) { reportError('modèle ' + kind + ' : ' + (e && e.message ? e.message : e)); }
  }
  MODELS = ready;
  for (const kind of Object.keys(ready)) for (const g of modelInstances[kind]) applyModel(g, kind);
}
// prise en main de chaque arme dans la vue à la première personne : main droite (poignée) et main gauche (garde)
const HANDS = { pistol: [[-0.03, -0.045], [-0.02, -0.065]], smg: [[-0.045, -0.065], [0.25, -0.032]], rifle: [[-0.04, -0.06], [0.32, -0.025]], launcher: [[-0.04, -0.06], [0.32, -0.025]], katana: [[-0.02, 0], [-0.17, 0]] };
function limb(g, from, to, r, mat) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), d = b.clone().sub(a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, len, 10), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.add(m); return m;
}
function buildViewmodel(kind) {
  const g = buildWeapon(kind);
  const [rh, lh] = HANDS[kind];
  if (kind === 'katana') { g.rotation.set(0.55, 0.15, -0.35); g.position.set(-0.02, -0.02, 0.06); }
  const R = [0.012, rh[1], -rh[0]], L = [kind === 'pistol' ? -0.02 : -0.004, lh[1] - 0.012, -lh[0]];
  limb(g, R, [0.09, -0.3, 0.32], 0.042, M.sleeve);
  const rhm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.09), M.skin); rhm.position.set(R[0] + 0.006, R[1], R[2]); g.add(rhm);
  limb(g, L, [-0.24, -0.32, 0.18], 0.042, M.sleeve);
  const lhm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.09), M.skin); lhm.position.set(L[0], L[1], L[2]); g.add(lhm);
  return outline(g);
}

// vue à la première personne
const viewmodels = {};
const vmRoot = new THREE.Group(); camera.add(vmRoot);
vmRoot.position.set(0.2, -0.2, -0.36);
for (const k of ORDER) { const g = buildViewmodel(k); g.visible = false; g.traverse((o) => { o.castShadow = false; }); vmRoot.add(g); viewmodels[k] = g; }
const flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(5, 3, 1.4), fog: false }));
flash.scale.set(1, 1, 2.4); flash.visible = false; vmRoot.add(flash);
const flashLight = new THREE.PointLight(0xffb36b, 0, 8); vmRoot.add(flashLight);

// ---------- audio ----------
let actx = null, master = null, verbIn = null, noiseBuf = null;
function initAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.2;
    master = actx.createGain(); master.gain.value = 0.55; master.connect(comp); comp.connect(actx.destination);
    const sr = actx.sampleRate;
    noiseBuf = actx.createBuffer(1, sr * 2, sr);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // réverbération courte de couloirs : bruit qui décroît, avec premières réflexions
    const len = Math.floor(sr * 1.4), ir = actx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const b = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) { const t = i / len; b[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.5) * (i < sr * 0.006 ? 0 : 1); }
      for (const e of [0.011, 0.019, 0.027, 0.041]) { const k = Math.floor(sr * (e + ch * 0.003)); b[k] += 0.6; }
    }
    const verb = actx.createConvolver(); verb.buffer = ir;
    verbIn = actx.createGain(); verbIn.gain.value = 0.5; verbIn.connect(verb); verb.connect(master);
  } catch (e) { actx = null; }
}
let me = null;
function spatial(at) {
  if (!at || !me) return { v: 1, d: 0, local: true };
  const d = Math.hypot(at.x - me.x, (at.y || 0) - me.feet - 1, at.z - me.z);
  return { v: Math.pow(clamp(1 - d / 85, 0, 1), 1.4) + 0.02, d, local: false };
}
function vol(x, y, z) { return spatial({ x, y, z }).v; }
// chaîne de sortie : volume, filtre selon la distance, part de réverbération
function bus(at, gain, wet) {
  const sp = spatial(at);
  const g = actx.createGain(); g.gain.value = gain * sp.v;
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = sp.local ? 18000 : Math.max(700, 16000 - sp.d * 420);
  const send = actx.createGain(); send.gain.value = (wet == null ? 0.22 : wet) + (sp.local ? 0 : Math.min(0.6, sp.d / 70));
  g.connect(lp); lp.connect(master); lp.connect(send); send.connect(verbIn);
  return { node: g, t: actx.currentTime + (sp.local ? 0 : Math.min(0.25, sp.d / 340)) };
}
function nz(dest, t, dur, type, f0, f1, q, v, attack) {
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; s.playbackRate.value = 0.9 + Math.random() * 0.2;
  f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + (attack || 0.001)); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}
function osc(dest, t, type, f0, f1, dur, v, attack) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + (attack || 0.002)); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
}
function click(dest, t, f, v, dur) { nz(dest, t, dur || 0.025, 'bandpass', f, f, 7, v); }
// détonation : claquement supersonique, souffle, basse, queue mécanique
const GUNS = {
  pistol: { crack: 0.7, body: 0.14, lp: 2200, th: [150, 55, 0.14], tail: 0.08, v: 0.8 },
  smg: { crack: 0.45, body: 0.09, lp: 2600, th: [170, 70, 0.09], tail: 0.05, v: 0.62 },
  rifle: { crack: 1, body: 0.22, lp: 3200, th: [115, 40, 0.22], tail: 0.12, v: 1 },
  launcher: { crack: 0.25, body: 0.24, lp: 900, th: [85, 32, 0.28], tail: 0.1, v: 0.9 },
};
const sfx = {
  gun(w, at) {
    if (!actx) return;
    const p = GUNS[w], b = bus(at, p.v, 0.3), t = b.t;
    nz(b.node, t, 0.018, 'highpass', 2500, 2500, 0.7, p.crack);
    nz(b.node, t, p.body, 'lowpass', p.lp, 300, 0.8, 0.9);
    osc(b.node, t, 'sine', p.th[0], p.th[1], p.th[2], 0.9);
    nz(b.node, t + 0.012, p.tail, 'bandpass', 1400, 900, 1.2, 0.18);
    if (w === 'launcher') { nz(b.node, t + 0.02, 0.35, 'bandpass', 500, 2400, 1.5, 0.25, 0.05); }
  },
  slash(at) { if (!actx) return; const b = bus(at, 0.55, 0.15); nz(b.node, b.t, 0.22, 'bandpass', 700, 4200, 2.2, 0.7, 0.07); },
  slice(at) { if (!actx) return; const b = bus(at, 0.6, 0.1); nz(b.node, b.t, 0.09, 'highpass', 3000, 3000, 0.8, 0.6); nz(b.node, b.t, 0.12, 'lowpass', 600, 150, 1, 0.7, 0.004); osc(b.node, b.t, 'sine', 4200, 3800, 0.4, 0.06); },
  ping(at) { if (!actx) return; const b = bus(at, 0.5, 0.35); osc(b.node, b.t + 0.03, 'sine', 2640, 2600, 0.7, 0.28); osc(b.node, b.t + 0.03, 'sine', 5250, 5200, 0.35, 0.07); click(b.node, b.t + 0.02, 3800, 0.3); },
  reload(w) {
    if (!actx) return;
    const b = bus(null, 0.55, 0.15), t = b.t, R = WEAPONS[w].reload;
    if (w === 'rifle') { click(b.node, t + 0.1, 1800, 0.4); nz(b.node, t + R * 0.55, 0.06, 'bandpass', 1200, 900, 3, 0.6); click(b.node, t + R * 0.85, 2400, 0.7, 0.04); nz(b.node, t + R * 0.86, 0.05, 'lowpass', 900, 300, 1, 0.5); }
    else if (w === 'launcher') { click(b.node, t + 0.1, 2200, 0.3); nz(b.node, t + R * 0.7, 0.08, 'bandpass', 700, 500, 2, 0.6); click(b.node, t + R * 0.75, 3000, 0.3); }
    else { click(b.node, t + 0.12, 2000, 0.45); nz(b.node, t + 0.15, 0.05, 'lowpass', 600, 200, 1, 0.3); click(b.node, t + R * 0.6, 1600, 0.6, 0.035); click(b.node, t + R * 0.85, 2800, 0.55, 0.03); click(b.node, t + R * 0.88, 3400, 0.4, 0.02); }
  },
  empty() { if (!actx) return; const b = bus(null, 0.5, 0.1); click(b.node, b.t, 3200, 0.5, 0.015); },
  draw() { if (!actx) return; const b = bus(null, 0.4, 0.1); nz(b.node, b.t, 0.08, 'bandpass', 900, 1600, 1.5, 0.3, 0.02); click(b.node, b.t + 0.09, 2600, 0.4); },
  hit(head) { if (!actx) return; const b = bus(null, 0.5, 0.05); nz(b.node, b.t, 0.06, 'bandpass', 900, 500, 1.4, 0.7); if (head) osc(b.node, b.t, 'triangle', 3100, 2900, 0.09, 0.18); },
  kill() { if (!actx) return; const b = bus(null, 0.5, 0.05); nz(b.node, b.t, 0.12, 'lowpass', 500, 120, 1, 0.8); osc(b.node, b.t + 0.02, 'sine', 900, 880, 0.18, 0.12); },
  hurt() { if (!actx) return; const b = bus(null, 0.7, 0.05); nz(b.node, b.t, 0.16, 'lowpass', 400, 90, 1, 1); osc(b.node, b.t, 'sine', 95, 45, 0.18, 0.6); },
  die() { if (!actx) return; const b = bus(null, 0.6, 0.3); nz(b.node, b.t, 0.4, 'lowpass', 600, 80, 1, 0.8); osc(b.node, b.t, 'sine', 70, 30, 0.6, 0.6); },
  whizz() { if (!actx) return; const b = bus(null, 0.45, 0.05); nz(b.node, b.t, 0.16, 'bandpass', 4200, 1300, 4, 0.7, 0.03); click(b.node, b.t + 0.05, 5000, 0.3, 0.01); },
  impact(at) { if (!actx) return; const b = bus(at, 0.35, 0.15); click(b.node, b.t, 1800 + Math.random() * 1500, 0.6, 0.03); nz(b.node, b.t, 0.06, 'lowpass', 800, 200, 1, 0.3); },
  step(at) { if (!actx) return; const b = bus(at, at ? 0.35 : 0.22, 0.08); nz(b.node, b.t, 0.07, 'lowpass', 520 + Math.random() * 200, 180, 1, 0.8, 0.004); click(b.node, b.t + 0.01, 2200, 0.08, 0.02); },
  jump() { if (!actx) return; const b = bus(null, 0.2, 0.05); nz(b.node, b.t, 0.08, 'bandpass', 700, 300, 1, 0.5, 0.01); },
  land(v) { if (!actx) return; const b = bus(null, clamp(v / 14, 0.15, 0.7), 0.1); nz(b.node, b.t, 0.12, 'lowpass', 450, 100, 1, 1, 0.003); click(b.node, b.t, 1800, 0.15); },
  rung() { if (!actx) return; const b = bus(null, 0.3, 0.12); click(b.node, b.t, 1300 + Math.random() * 300, 0.6, 0.05); osc(b.node, b.t, 'triangle', 820, 800, 0.08, 0.06); },
  boom(at) {
    if (!actx) return;
    const b = bus(at, 1.2, 0.6), t = b.t;
    nz(b.node, t, 0.03, 'highpass', 1800, 1800, 0.7, 1);
    nz(b.node, t, 1.4, 'lowpass', 1600, 70, 0.8, 1, 0.004);
    osc(b.node, t, 'sine', 75, 24, 1.1, 1);
    nz(b.node, t + 0.08, 2.2, 'lowpass', 260, 60, 1, 0.5, 0.15);
    for (let i = 0; i < 6; i++) click(b.node, t + 0.15 + Math.random() * 0.6, 2500 + Math.random() * 2500, 0.08, 0.02);
  },
  bounce(at) { if (!actx) return; const b = bus(at, 0.45, 0.15); click(b.node, b.t, 2800 + Math.random() * 600, 0.6, 0.04); osc(b.node, b.t, 'triangle', 1900, 1700, 0.06, 0.06); },
  thud(at) { if (!actx) return; const b = bus(at, 0.5, 0.15); nz(b.node, b.t, 0.09, 'lowpass', 500, 120, 1, 0.9, 0.003); },
  pin() { if (!actx) return; const b = bus(null, 0.45, 0.1); click(b.node, b.t, 4200, 0.5, 0.012); click(b.node, b.t + 0.08, 2600, 0.35, 0.02); nz(b.node, b.t + 0.12, 0.12, 'bandpass', 800, 1400, 1.5, 0.3, 0.03); },
  pickup() { if (!actx) return; const b = bus(null, 0.45, 0.1); nz(b.node, b.t, 0.07, 'bandpass', 900, 600, 2, 0.5); click(b.node, b.t + 0.06, 2400, 0.6, 0.03); click(b.node, b.t + 0.16, 3200, 0.4, 0.02); },
  box() { if (!actx) return; const b = bus(null, 0.35, 0.3); [880, 1175, 1480].forEach((f, i) => osc(b.node, b.t + i * 0.06, 'sine', f, f, 0.35, 0.18)); },
  item() { if (!actx) return; const b = bus(null, 0.4, 0.2); nz(b.node, b.t, 0.3, 'bandpass', 600, 2600, 1.2, 0.5, 0.05); },
  thunder() { if (!actx) return; const b = bus(null, 1, 0.8); nz(b.node, b.t, 0.05, 'highpass', 2000, 2000, 0.7, 1); nz(b.node, b.t + 0.05, 2.8, 'lowpass', 400, 60, 0.7, 0.9, 0.2); osc(b.node, b.t, 'sine', 60, 28, 2, 0.5, 0.1); },
  orb() { if (!actx) return; const b = bus(null, 0.4, 0.3); osc(b.node, b.t, 'sine', 1600, 1200, 0.25, 0.25); osc(b.node, b.t, 'sine', 2400, 1800, 0.2, 0.1); },
  missile(at) { if (!actx) return; const b = bus(at, 0.6, 0.4); nz(b.node, b.t, 1.6, 'bandpass', 900, 2200, 0.8, 0.6, 0.15); nz(b.node, b.t, 0.06, 'lowpass', 600, 200, 1, 0.6); },
  mineClick(at) { if (!actx) return; const b = bus(at, 0.6, 0.1); click(b.node, b.t, 3600, 0.8, 0.012); },
  start() { if (!actx) return; const b = bus(null, 0.35, 0.4); [392, 523, 659].forEach((f, i) => osc(b.node, b.t + i * 0.14, 'triangle', f, f, 0.3, 0.16)); },
  spawn() { if (!actx) return; const b = bus(null, 0.3, 0.2); nz(b.node, b.t, 0.25, 'bandpass', 500, 1500, 1.2, 0.3, 0.08); },
  nade() { sfx.pin(); },
};

// sons entendus par tous : l'hôte les relaie avec leur position
const NET_SOUNDS = ['gun', 'ping', 'impact', 'boom', 'bounce', 'thud', 'slash', 'slice', 'missile', 'mineClick'];
for (const name of NET_SOUNDS) {
  const orig = sfx[name];
  sfx[name] = function (...args) {
    orig.apply(sfx, args);
    if (ONLINE && NET.host && !NET.mute && !NET.applying) {
      const at = name === 'gun' ? 1 : 0, a = args.slice();
      const pos = a[at] || (me ? { x: me.x, y: me.feet + 1.5, z: me.z } : null);
      a[at] = pos ? [r2(pos.x), r2(pos.y || 0), r2(pos.z)] : null;
      NET.out.push(['a', name, a]);
    }
  };
}

// ---------- effets visuels ----------
const particles = [], tracers = [], rings = [];
const partGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const partMats = {};
function partMat(c) { const k = String(c); return partMats[k] || (partMats[k] = new THREE.MeshBasicMaterial({ color: c })); }
function burst(x, y, z, color, n, speed, life, size) {
  emit(['b', r2(x), r2(y), r2(z), color, n, speed, life, size || 0]);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, partMat(color)); m.position.set(x, y, z);
    if (size) m.scale.setScalar(size);
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
    scene.add(m); particles.push({ m, v, life: life * (0.6 + Math.random() * 0.6), max: life, s: size || 1, g: 14 });
  }
}
const decalTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  let g = x.createRadialGradient(32, 32, 0, 32, 32, 30); g.addColorStop(0, 'rgba(60,60,60,.35)'); g.addColorStop(1, 'rgba(60,60,60,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  g = x.createRadialGradient(32, 32, 0, 32, 32, 9); g.addColorStop(0, 'rgba(20,20,20,.95)'); g.addColorStop(0.7, 'rgba(40,40,40,.8)'); g.addColorStop(1, 'rgba(40,40,40,0)');
  x.fillStyle = g; x.beginPath(); x.arc(32, 32, 9, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(cv); return t;
})();
const decalMat = new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const decalGeo = new THREE.PlaneGeometry(0.14, 0.14);
const decals = [];
function surfaceNormal(p) {
  if (p[1] < 0.03) return [0, 1, 0];
  let best = null, bd = 0.08;
  for (const b of MAP.obstacles) {
    if (p[0] < b.minX - 0.05 || p[0] > b.maxX + 0.05 || p[2] < b.minZ - 0.05 || p[2] > b.maxZ + 0.05 || p[1] > b.h + 0.05) continue;
    const c = [[Math.abs(p[0] - b.minX), [-1, 0, 0]], [Math.abs(p[0] - b.maxX), [1, 0, 0]], [Math.abs(p[2] - b.minZ), [0, 0, -1]], [Math.abs(p[2] - b.maxZ), [0, 0, 1]], [Math.abs(p[1] - b.h), [0, 1, 0]]];
    for (const [d, n] of c) if (d < bd) { bd = d; best = n; }
  }
  return best;
}
function addDecal(p) {
  emit(['d', r2(p[0]), r2(p[1]), r2(p[2])]);
  const n = surfaceNormal(p); if (!n) return;
  const m = new THREE.Mesh(decalGeo, decalMat);
  m.position.set(p[0] + n[0] * 0.004, p[1] + n[1] * 0.004, p[2] + n[2] * 0.004);
  m.lookAt(p[0] + n[0], p[1] + n[1], p[2] + n[2]); m.rotateZ(Math.random() * 6.28); m.scale.setScalar(0.7 + Math.random() * 0.6);
  scene.add(m); decals.push(m);
  if (decals.length > 90) scene.remove(decals.shift());
}
function puff(x, y, z) {
  emit(['p', r2(x), r2(y), r2(z)]);
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), new THREE.MeshBasicMaterial({ color: 0xdedede, transparent: true, opacity: 0.6 }));
    m.position.set(x, y, z); scene.add(m);
    particles.push({ m, v: new THREE.Vector3(rand(-0.4, 0.4), rand(0.3, 0.9), rand(-0.4, 0.4)), life: rand(0.5, 0.9), max: 0.9, s: rand(1, 1.6), g: -0.5, smoke: true });
  }
}
function smoke(x, y, z, n) {
  emit(['s', r2(x), r2(y), r2(z), n]);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ color: 0xd9d5ce, transparent: true, opacity: 0.6 }));
    m.position.set(x + rand(-0.8, 0.8), y + rand(0, 0.8), z + rand(-0.8, 0.8));
    scene.add(m); particles.push({ m, v: new THREE.Vector3(rand(-1, 1), rand(1.5, 3), rand(-1, 1)), life: rand(1, 1.6), max: 1.6, s: rand(1, 2), g: -1, smoke: true });
  }
}
function tracer(a, b, color, src) {
  emit(['t', r2(a.x), r2(a.y), r2(a.z), r2(b.x), r2(b.y), r2(b.z), color && color.isColor ? color.getHex() : (color || 0x3a3a40), src || 0]);
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color || 0x3a3a40, transparent: true, opacity: 0.8, fog: false }));
  scene.add(l); tracers.push({ l, t: 0.07 });
}
const ringGeo = new THREE.RingGeometry(0.85, 1, 32);
function explosionFx(x, y, z, radius, color) {
  emit(['e', r2(x), r2(y), r2(z), radius]);
  NET.mute++;
  if (me) { const dme = Math.hypot(x - me.x, y - me.feet - 1, z - me.z); if (dme < radius * 3) me.shake = Math.max(me.shake || 0, (1 - dme / (radius * 3)) * 1.2); }
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(6, 3.2, 1.6), transparent: true, opacity: 1, fog: false }));
  ball.position.set(x, y, z); scene.add(ball);
  rings.push({ m: ball, t: 0, max: 0.45, grow: radius * 0.9, ball: true });
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: color || 0x26262b, transparent: true, side: THREE.DoubleSide, fog: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, Math.max(0.05, y - 0.6), z); scene.add(ring);
  rings.push({ m: ring, t: 0, max: 0.55, grow: radius * 1.3 });
  const light = new THREE.PointLight(0xffa64d, 6, radius * 4); light.position.set(x, y + 0.5, z); scene.add(light);
  rings.push({ m: light, t: 0, max: 0.3, light: true });
  burst(x, y, z, 0xff7a59, 18, 10, 0.8); burst(x, y, z, 0x3a3a40, 10, 7, 1.1); smoke(x, y, z, 7);
  NET.mute--;
}

// ---------- combattants ----------
function nameTag(name, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const x = cv.getContext('2d');
  x.font = '500 32px Outfit, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const w = Math.min(250, x.measureText(name).width + 28);
  x.fillStyle = 'rgba(255,255,255,.92)'; x.fillRect(128 - w / 2, 8, w, 48);
  x.fillStyle = color; x.fillRect(128 - w / 2, 53, w, 3);
  x.fillStyle = '#26262b'; x.fillText(name, 128, 32);
  const ntx = new THREE.CanvasTexture(cv);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ntx, transparent: true }));
  s.scale.set(1.6, 0.4, 1); s.position.y = 2.35;
  return s;
}
const orbGeo = new THREE.IcosahedronGeometry(0.2, 1);
const orbMat = new THREE.MeshStandardMaterial({ color: 0x7b62d9, emissive: 0x3d2a90, roughness: 0.4 });
function makeAvatar(f) {
  const g = new THREE.Group();
  const col = new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2f2f35, roughness: 0.6 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.9 });
  const legGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.84, 10);
  const leg = (x) => { const p = new THREE.Group(); p.position.set(x, 0.86, 0); const m = new THREE.Mesh(legGeo, paper); m.position.y = -0.42; m.castShadow = true; p.add(m); g.add(p); return p; };
  const legL = leg(-0.13), legR = leg(0.13);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.78, 16), col); torso.position.y = 1.24; torso.castShadow = true; g.add(torso);
  const head = new THREE.Group(); head.position.y = 1.78; g.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.23, 18, 14), paper); skull.castShadow = true; head.add(skull);
  part(head, 0.3, 0.07, 0.06, dark, 0, 0.02, -0.2);
  const arm = new THREE.Group(); arm.position.set(0.3, 1.42, -0.05); g.add(arm);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 10), col); sleeve.rotation.x = Math.PI / 2; sleeve.position.z = -0.12; arm.add(sleeve);
  const gunHold = new THREE.Group(); gunHold.position.set(-0.05, 0, -0.42); arm.add(gunHold);
  const guns = {};
  for (const k of ORDER) { const w = buildWeapon(k); w.visible = false; gunHold.add(w); guns[k] = w; }
  const tag = nameTag(f.name, f.color); g.add(tag);
  g.add(blob(1.3));
  const orbs = []; for (let i = 0; i < 3; i++) { const o = new THREE.Mesh(orbGeo, orbMat); o.visible = false; outline(o); scene.add(o); orbs.push(o); }
  outline(g); scene.add(g);
  return { g, head, arm, legL, legR, guns, tag, orbs, mats: [col, dark, paper], walk: 0, px: 0, pz: 0 };
}
const fighters = [];
function newFighter(id, name, color, isBot, remote) {
  const f = {
    id, name, color, isBot, x: 0, z: 0, feet: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0,
    onGround: true, groundTime: 1, ladder: null, rungAcc: 0, jumpBuf: 0, ladderJumpLock: false,
    hp: 100, alive: false, kills: 0, deaths: 0, respawnAt: 0, lastHitBy: null,
    weapons: {}, cur: 'pistol', grenades: 1, item: null, fireCd: 0, reloading: 0, trigger: false, scoped: false,
    boost: 0, star: 0, slow: 0, slip: 0, slipYaw: 0, orbs: 0, orbT: 0, orbAng: 0,
    bot: isBot ? { path: [], goal: null, stuckT: 0, lastX: 0, lastZ: 0, scanT: 0, target: null, seeT: 0, lastSeen: null, aimYaw: 0, aimPitch: 0, errY: 0, errP: 0, strafe: 1, strafeT: 0, itemT: 0, wanderT: 0 } : null,
  };
  if (isBot || remote) f.avatar = makeAvatar(f);
  f.remote = !!remote;
  fighters.push(f);
  if (f.avatar && CHAR) applyCharacter(f);
  return f;
}
let CHAR = null;
me = newFighter(ONLINE ? -1 : 0, 'Toi', COLORS[0], false);
if (!ONLINE) for (let i = 0; i < 4; i++) newFighter(i + 1, BOT_NAMES[i], COLORS[i + 1], true);
function resetLoadout(f) {
  f.weapons = { pistol: { mag: WEAPONS.pistol.mag, res: Infinity } };
  f.cur = 'pistol'; f.grenades = 1; f.item = null; f.reloading = 0; f.fireCd = 0.3; f.scoped = false;
  f.boost = f.star = f.slow = f.slip = 0; f.orbs = 0; f.orbT = 0;
}
function pickSpawn(self) {
  let best = MAP.spawns[0], bestScore = -1;
  for (const s of MAP.spawns) {
    let d = 1e9;
    for (const o of fighters) if (o !== self && o.alive) d = Math.min(d, Math.hypot(o.x - s.x, o.z - s.z));
    const score = Math.min(d, 60) + Math.random() * 6;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}
function spawn(f) {
  const s = pickSpawn(f);
  Object.assign(f, { x: s.x, z: s.z, feet: 0, vx: 0, vz: 0, vy: 0, yaw: Math.atan2(s.x, s.z), pitch: 0, onGround: true, ladder: null, hp: 100, alive: true, respawnAt: 0, lastHitBy: null });
  resetLoadout(f);
  if (f.bot) { f.bot.path = []; f.bot.goal = null; f.bot.target = null; f.bot.seeT = 0; f.bot.lastSeen = null; f.bot.aimYaw = f.yaw; }
  if (f === me) { $('death').hidden = true; sfx.spawn(); }
  else emit(['sp', f.id, r2(f.x), r2(f.z), r2(f.yaw)]);
}

// ---------- objets au sol : armes, grenades, caisses mystère ----------
function reachableTops() {
  const obs = MAP.obstacles.filter((b) => !b.prop), n = obs.length, par = obs.map((_, i) => i);
  const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = obs[i], b = obs[j];
    if (a.minX <= b.maxX + 0.01 && b.minX <= a.maxX + 0.01 && a.minZ <= b.maxZ + 0.01 && b.minZ <= a.maxZ + 0.01) par[find(i)] = find(j);
  }
  const reach = new Set();
  for (const l of MAP.ladders) { const x = l.x - l.nx * 0.3, z = l.z - l.nz * 0.3; obs.forEach((b, i) => { if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) reach.add(find(i)); }); }
  const tops = [];
  obs.forEach((b, i) => { if (reach.has(find(i)) && Math.max(b.maxX - b.minX, b.maxZ - b.minZ) >= C * 1.5) tops.push({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, y: H }); });
  return tops;
}
const pickups = [];
const padGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.04, 32);
const boxTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = '#26262b'; x.lineWidth = 4; x.strokeRect(10, 10, 108, 108);
  x.fillStyle = '#ff7a59'; x.font = '300 84px Outfit, Avenir Next, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('?', 64, 68);
  const t = new THREE.CanvasTexture(cv); return t;
})();
const boxMat = new THREE.MeshStandardMaterial({ map: boxTex, roughness: 0.8, emissive: 0x202020 });
const nadeGeo = new THREE.SphereGeometry(0.06, 8, 6);
const nadeMat = new THREE.MeshStandardMaterial({ color: 0x55555c, roughness: 0.6 });
function addPickup(kind, x, y, z, respawn) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({ color: kind === 'box' ? 0xff7a59 : 0xd6d1c7, roughness: 1 }));
  pad.position.y = 0.02; pad.receiveShadow = true; g.add(pad); g.add(blob(2.2));
  const show = new THREE.Group(); show.position.y = 1.0; g.add(show);
  if (kind === 'box') { const b = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.75, 0.75), boxMat); b.castShadow = true; show.add(b); }
  else if (kind === 'nade') { for (let i = 0; i < 3; i++) { const n = buildGrenade(3); n.position.set((i - 1) * 0.24, -0.1, 0); show.add(n); } }
  else { const w = buildWeapon(kind); w.scale.setScalar(kind === 'pistol' ? 2.2 : 1.2); w.rotation.y = Math.PI / 2; if (kind === 'katana') { w.rotation.z = 0.5; w.position.y = -0.2; } show.add(w); }
  outline(g); scene.add(g);
  pickups.push({ kind, x, y, z, g, show, ready: true, t: 0, respawn, phase: Math.random() * 6 });
}
{
  const pr = MAP.mulberry32(314);
  const used = new Set(['0,0']);
  const freeCell = () => { for (;;) { const r = Math.floor(pr() * N), c = Math.floor(pr() * N), k = r + ',' + c; if (!used.has(k)) { used.add(k); return cellCenter(r, c); } } };
  const ground = [['smg', 2], ['rifle', 2], ['katana', 2], ['nade', 2], ['box', 11]];
  for (const [k, n] of ground) for (let i = 0; i < n; i++) { const p = freeCell(); addPickup(k, p.x, 0, p.z, k === 'box' ? 8 : 15); }
  const tops = reachableTops();
  const take = () => tops.splice(Math.floor(pr() * tops.length), 1)[0];
  for (let i = 0; i < 2 && tops.length; i++) { const t = take(); addPickup('launcher', t.x, H, t.z, 20); }
  for (let i = 0; i < 2 && tops.length; i++) { const t = take(); addPickup('box', t.x, H, t.z, 8); }
}
function rankOf(f) { const sorted = fighters.slice().sort((a, b) => b.kills - a.kills); return sorted.indexOf(f); }
function rollItem(f) {
  const t = rankOf(f) / Math.max(1, fighters.length - 1);
  const entries = Object.keys(ITEM_W).map((k) => [k, ITEM_W[k][0] + (ITEM_W[k][1] - ITEM_W[k][0]) * t]);
  let sum = entries.reduce((s, e) => s + e[1], 0), r = Math.random() * sum;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return 'boost';
}
function tryPickups(f) {
  for (const p of pickups) {
    if (!p.ready) continue;
    if (Math.hypot(p.x - f.x, p.z - f.z) > 1.1 || Math.abs(p.y - f.feet) > 1) continue;
    if (p.kind === 'box') {
      if (f.item) continue;
      f.item = rollItem(f); if (f.bot) f.bot.itemT = rand(0.6, 3);
      if (f.remote) emit(['give', f.id, 'item', f.item]);
      if (f === me) { sfx.box(); toast('Bonus : ' + ITEMS[f.item].name); }
    } else if (p.kind === 'nade') {
      if (f.grenades >= NADE.max) continue;
      f.grenades = NADE.max; if (f === me) { sfx.pickup(); toast('Grenades rechargées'); }
      if (f.remote) emit(['give', f.id, 'nade']);
    } else {
      const W = WEAPONS[p.kind], have = f.weapons[p.kind];
      if (have && have.res >= W.reserve && !f.remote) continue;
      if (f.remote) emit(['give', f.id, 'w', p.kind]);
      if (have) have.res = W.reserve; else f.weapons[p.kind] = { mag: W.mag, res: W.reserve };
      if (!have) { f.cur = p.kind; f.reloading = 0; f.scoped = false; }
      if (f === me) { sfx.pickup(); toast(have ? W.name + ' : munitions' : W.name); }
    }
    p.ready = false; p.t = p.respawn; p.show.visible = false;
    burst(p.x, p.y + 1, p.z, 0xd6d1c7, 8, 3, 0.4);
  }
}

// ---------- dégâts ----------
let matchPhase = 'play', matchEnd = 0, gameTime = 0;
function damage(target, amount, attacker, kind, head, from) {
  if (!target.alive || matchPhase !== 'play') return false;
  if (target.star > 0) return false;
  if (target.orbs > 0 && kind !== 'star') {
    target.orbs--; sfx.orb();
    burst(target.x, target.feet + 1.2, target.z, 0x7b62d9, 10, 4, 0.5);
    if (attacker === me && target !== me) hitmark('');
    else if (attacker && attacker !== target) emit(['hm', attacker.id, '']);
    return false;
  }
  target.hp -= amount; target.lastHitBy = attacker;
  const fr = from || (attacker ? [attacker.x, attacker.z] : null);
  if (target === me) onHurt(fr);
  else if (fr) emit(['hurt', target.id, r2(fr[0]), r2(fr[1])]);
  if (attacker && attacker !== target && target.hp > 0) {
    if (attacker === me) { hitmark(head ? 'head' : ''); sfx.hit(head); }
    else emit(['hm', attacker.id, head ? 'head' : '']);
  }
  if (target.bot && attacker && attacker !== target) { target.bot.target = attacker; target.bot.lastSeen = { x: attacker.x, z: attacker.z, t: gameTime }; }
  if (target.hp <= 0) kill(target, attacker, kind, head);
  return true;
}
const KIND_LABEL = { katana: 'katana', pistol: 'pistolet', smg: 'mitraillette', rifle: 'fusil', launcher: 'lance-grenades', nade: 'grenade', missile: 'missile', bomb: 'bombe', mine: 'mine', star: 'surcharge', shield: 'orbes' };
function kill(v, k, kind, head) {
  emit(['kill', k ? k.id : 0, v.id, kind, head ? 1 : 0]);
  v.hp = 0; v.alive = false; v.deaths++; v.respawnAt = gameTime + RULES.respawn; v.ladder = null; v.scoped = false;
  if (k && k !== v) k.kills++;
  else if (k === v) v.kills = Math.max(0, v.kills - 1);
  if (v.avatar) { v.avatar.g.visible = false; for (const o of v.avatar.orbs) o.visible = false; }
  burst(v.x, v.feet + 1, v.z, v.color, 24, 7, 0.9); burst(v.x, v.feet + 1, v.z, 0xfbfaf7, 10, 5, 1);
  killFeedback(k, v, kind, head);
  if (k && k.kills >= RULES.killLimit) endMatch();
}
function killFeedback(k, v, kind, head) {
  feed(k, v, KIND_LABEL[kind] || '', head);
  if (k === me && v !== me) { hitmark('kill'); sfx.kill(); }
  if (v === me) { sfx.die(); setText($('deathTxt'), k && k !== me ? 'par ' + k.name + ' · ' + (KIND_LABEL[kind] || '') : 'par toi-même'); $('death').hidden = false; }
}
function explode(x, y, z, radius, maxDmg, owner, kind, direct, directDmg, killR) {
  killR = killR || 0;
  if (direct && direct.alive) damage(direct, directDmg, owner, kind, false, [x, z]);
  explosionFx(x, y, z, radius);
  sfx.boom({ x, y, z });
  for (const f of fighters) {
    if (!f.alive || f === direct) continue;
    const cx = f.x, cy = f.feet + 1.1, cz = f.z, d = Math.hypot(cx - x, cy - y, cz - z);
    if (d > radius) continue;
    if (!los(x, y + 0.2, z, cx, cy, cz) && !los(x, y + 0.2, z, cx, f.feet + 0.2, cz)) continue;
    // dans le rayon mortel : élimination en un coup ; au-delà : dégâts dégressifs
    let dmg = d <= killR ? 250 : maxDmg * (1 - ((d - killR) / Math.max(0.1, radius - killR)) * 0.7);
    if (f === owner) dmg *= 0.5;
    damage(f, Math.round(dmg), owner, kind, false, [x, z]);
  }
}

// ---------- tir ----------
function eyeOf(f) { return [f.x, f.feet + 1.65, f.z]; }
function hitscan(f, dir, W) {
  const o = eyeOf(f);
  const wall = MAP.rayWorld(o, dir, W.range);
  let best = wall, target = null;
  for (const t of fighters) {
    if (t === f || !t.alive) continue;
    const d = MAP.rayBox(o, dir, [t.x - 0.48, t.feet, t.z - 0.48], [t.x + 0.48, t.feet + 1.95, t.z + 0.48]);
    if (d >= 0 && d < best) { best = d; target = t; }
  }
  const end = [o[0] + dir[0] * best, o[1] + dir[1] * best, o[2] + dir[2] * best];
  return { o, end, target, head: target ? end[1] > target.feet + 1.5 : false, wall: !target && best < W.range - 0.01 };
}
const tmpV = new THREE.Vector3();
function posOf(f) { return { x: f.x, y: f.feet + 1.5, z: f.z }; }
function fire(f, extraSpread) {
  if (!f.alive || matchPhase !== 'play' || f.reloading > 0 || f.fireCd > 0 || f.slip > 0 && f.bot) return false;
  const W = WEAPONS[f.cur], st = f.weapons[f.cur];
  if (!st) return false;
  if (st.mag <= 0) { if (f === me) sfx.empty(); startReload(f); f.fireCd = 0.25; return false; }
  st.mag--; f.fireCd = W.interval;
  let spread = W.spread;
  if (f === me && !f.onGround) spread *= 1.6;
  if (f === me && f.cur === 'smg') spread *= 1 + Math.min(1, f.sprayHeat || 0);
  spread += extraSpread || 0;
  let pitch = f.pitch;
  if (W.proj && f.bot && f.bot.target) { const d = Math.hypot(f.bot.target.x - f.x, f.bot.target.z - f.z); pitch += Math.atan(GL.gravity * d / (2 * GL.speed * GL.speed)); }
  const dir = spreadDir(dirFrom(f.yaw, pitch), spread);
  if (f === me) {
    if (W.melee) { me.swing = 0.32; me.swingDir = -(me.swingDir || 1); }
    else {
      flashT = 0.05; me.kick = 1; me.pitch = clamp(me.pitch + W.kick, -1.55, 1.55);
      if (!W.proj) { me.yaw += (Math.random() - 0.5) * W.kick * 0.4; me.sprayHeat = (me.sprayHeat || 0) + 0.12; }
      sfx.gun(f.cur, null);
    }
  }
  if (!NET.host && f === me) {
    // joueur en ligne : on montre le tir tout de suite, l'hôte décide de ce qui est touché
    if (W.melee) sfx.slash(null);
    else if (!W.proj) {
      const o = eyeOf(me), dist = MAP.rayWorld(o, dir, W.range);
      camera.updateMatrixWorld(true); flash.getWorldPosition(tmpV);
      tracer(tmpV.clone(), new THREE.Vector3(o[0] + dir[0] * dist, o[1] + dir[1] * dist, o[2] + dir[2] * dist), 0x3a3a40);
    }
    netSend(['fire', f.cur, dir.map((v) => Math.round(v * 10000) / 10000)]);
  } else shootDir(f, dir);
  if (!W.melee) {
    if (st.mag === 0 && f.cur === 'rifle') sfx.ping(f === me ? null : posOf(f));
    if (st.mag === 0) setTimeout(() => startReload(f), 160);
  }
  return true;
}
// balle qui frôle le joueur local
function checkWhizz(a, e) {
  if (!me.alive) return;
  const abx = e[0] - a[0], aby = e[1] - a[1], abz = e[2] - a[2], L2 = abx * abx + aby * aby + abz * abz || 1;
  const hx = me.x, hy = me.feet + 1.5, hz = me.z, k = clamp(((hx - a[0]) * abx + (hy - a[1]) * aby + (hz - a[2]) * abz) / L2, 0, 1);
  if (Math.hypot(a[0] + abx * k - hx, a[1] + aby * k - hy, a[2] + abz * k - hz) < 1.6 && k > 0.05 && k < 0.98) sfx.whizz();
}
// effet réel du tir (exécuté par l'hôte, ou en solo)
function shootDir(f, dir) {
  const W = WEAPONS[f.cur];
  if (W.melee) { slash(f); return; }
  if (W.proj) { launchGL(f, dir); if (f !== me) sfx.gun(f.cur, posOf(f)); return; }
  const res = hitscan(f, dir, W);
  let from;
  if (f === me) { camera.updateMatrixWorld(true); flash.getWorldPosition(tmpV); from = tmpV.clone(); }
  else {
    from = new THREE.Vector3(f.x + Math.cos(f.yaw) * 0.3 - Math.sin(f.yaw) * 0.8, f.feet + 1.4, f.z - Math.sin(f.yaw) * 0.3 - Math.cos(f.yaw) * 0.8);
    sfx.gun(f.cur, posOf(f));
    if (res.target !== me) checkWhizz(res.o, res.end);
  }
  tracer(from, new THREE.Vector3(res.end[0], res.end[1], res.end[2]), f === me ? 0x3a3a40 : new THREE.Color(f.color), f.id);
  if (res.target) {
    const dmg = Math.round(W.dmg * (res.head ? 2 : 1));
    burst(res.end[0], res.end[1], res.end[2], 0xff5a4a, 5, 4, 0.35);
    damage(res.target, dmg, f, f.cur, res.head);
  } else if (res.wall) { burst(res.end[0], res.end[1], res.end[2], 0xbdbdbd, 4, 3, 0.3); addDecal(res.end); puff(res.end[0], res.end[1], res.end[2]); if (Math.random() < 0.5) sfx.impact({ x: res.end[0], y: res.end[1], z: res.end[2] }); }
}
function fireNet(f, w, d) {
  if (!f.alive || matchPhase !== 'play' || !WEAPONS[w] || !Array.isArray(d)) return;
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  f.cur = w;
  shootDir(f, [d[0] / l, d[1] / l, d[2] / l]);
}
function slash(f) {
  sfx.slash(f === me ? null : { x: f.x, y: f.feet + 1.4, z: f.z });
  const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
  let best = null, bd = 1e9;
  for (const t of fighters) {
    if (t === f || !t.alive) continue;
    const dx = t.x - f.x, dz = t.z - f.z, d = Math.hypot(dx, dz);
    if (d > WEAPONS.katana.range || Math.abs(t.feet - f.feet) > 1.6) continue;
    if (d > 0.5 && (dx * fx + dz * fz) / d < 0.55) continue;
    if (!los(f.x, f.feet + 1.4, f.z, t.x, t.feet + 1.2, t.z)) continue;
    if (d < bd) { bd = d; best = t; }
  }
  if (best) {
    burst(best.x, best.feet + 1.3, best.z, 0xd8dadd, 8, 5, 0.35);
    sfx.slice(f === me ? null : { x: f.x, y: f.feet + 1.4, z: f.z });
    damage(best, WEAPONS.katana.dmg, f, 'katana', false);
  }
}
function startReload(f) {
  const W = WEAPONS[f.cur], st = f.weapons[f.cur];
  if (!f.alive || !st || f.reloading > 0 || st.mag >= W.mag || st.res <= 0) return;
  f.reloading = W.reload; f.scoped = false;
  if (f === me) sfx.reload(f.cur);
}
function finishReload(f) {
  const W = WEAPONS[f.cur], st = f.weapons[f.cur]; if (!st) return;
  const need = W.mag - st.mag, take = Math.min(need, st.res);
  st.mag += take; if (st.res !== Infinity) st.res -= take;
}
function switchWeapon(f, k) {
  if (!f.weapons[k] || f.cur === k) return;
  f.cur = k; f.reloading = 0; f.scoped = false; f.fireCd = Math.max(f.fireCd, 0.25);
  if (f === me) sfx.draw();
}

// ---------- projectiles ----------
const projectiles = [];
const bombGeo = new THREE.SphereGeometry(0.32, 14, 10);
const bombMat = new THREE.MeshStandardMaterial({ color: 0x2f2f35, roughness: 0.4 });
const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const missileMat = new THREE.MeshStandardMaterial({ color: 0xfbfaf7, roughness: 0.6 });
const mineMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.6 });
const glMat = new THREE.MeshStandardMaterial({ color: 0x55555c, roughness: 0.5 });
const glGeo = new THREE.SphereGeometry(0.13, 10, 8);
function makeProjVisual(type) {
  if (type === 'nade') { const m = buildGrenade(2.2); scene.add(m); return { m }; }
  if (type === 'gl') {
    const m = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), M.olive); body.scale.set(1, 1, 1.9); m.add(body);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 8), M.park); tail.rotation.x = Math.PI / 2; tail.position.z = -0.12; m.add(tail);
    for (let i = 0; i < 4; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.06, 0.06), M.park); fin.position.z = -0.16; fin.rotation.z = i * Math.PI / 4; m.add(fin); }
    m.traverse((o) => { o.castShadow = true; }); outline(m); scene.add(m);
    return { m };
  }
  if (type === 'bomb') {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(bombGeo, bombMat); ball.castShadow = true; g.add(ball);
    const sh = blob(0.9); sh.position.y = -0.31; g.add(sh);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.04, 6, 20), stripeMat); g.add(band);
    const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff7a59 })); fuse.position.y = 0.36; g.add(fuse);
    outline(g); scene.add(g);
    return { m: g, ball, fuse };
  }
  if (type === 'missile') {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.9, 8), missileMat); body.rotation.x = Math.PI / 2; g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 8), missileMat); nose.rotation.x = -Math.PI / 2; nose.position.z = -0.6; g.add(nose);
    const fire_ = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 8), new THREE.MeshBasicMaterial({ color: 0xff7a59 })); fire_.rotation.x = Math.PI / 2; fire_.position.z = 0.7; g.add(fire_);
    outline(g); scene.add(g);
    return { m: g };
  }
  // mine : presque invisible, sans contour
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.025, 24), mineLook); base.position.y = 0.012; g.add(base);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.018, 10), new THREE.MeshBasicMaterial({ color: 0xc9c3b8, transparent: true, opacity: 0.5 }));
  led.rotation.x = -Math.PI / 2; led.position.y = 0.026; g.add(led);
  scene.add(g);
  return { m: g, led };
}
const PROJ_R = { nade: 0.16, gl: 0.13, bomb: 0.32, missile: 0.2, mine: 0 };
function addProj(o) {
  Object.assign(o, makeProjVisual(o.type));
  o.id = o.id || ++NET.projSeq;
  if (o.type === 'mine') o.m.position.set(o.x, o.y, o.z);
  projectiles.push(o);
  return o;
}
function launchGL(f, dir) {
  const e = eyeOf(f);
  addProj({ type: 'gl', owner: f, x: e[0] + dir[0] * 0.7, y: e[1] - 0.15 + dir[1] * 0.7, z: e[2] + dir[2] * 0.7, vx: dir[0] * GL.speed, vy: dir[1] * GL.speed, vz: dir[2] * GL.speed, t: 4, r: 0.13 });
}
function throwNade(f) {
  if (!f.alive || f.grenades <= 0 || matchPhase !== 'play') return;
  f.grenades--;
  if (!NET.host && f === me) { netSend(['nade', r2(f.yaw), r2(f.pitch)]); sfx.nade(); return; }
  const d = dirFrom(f.yaw, f.pitch + 0.22), sp = 16;
  addProj({ type: 'nade', owner: f, x: f.x + d[0] * 0.6, y: f.feet + 1.5, z: f.z + d[2] * 0.6, vx: d[0] * sp + f.vx * 0.5, vy: d[1] * sp + 1, vz: d[2] * sp + f.vz * 0.5, t: NADE.fuse, r: 0.16 });
  if (f === me) sfx.nade();
}
// rebond d'une sphère contre les murs (boîtes) : renvoie true si contact
function bounceBoxes(p, bounce) {
  let hit = false;
  for (const b of MAP.obstacles) {
    if (p.y - p.r >= b.h) continue;
    if (p.x < b.minX - p.r || p.x > b.maxX + p.r || p.z < b.minZ - p.r || p.z > b.maxZ + p.r) continue;
    const pen = [p.x - (b.minX - p.r), (b.maxX + p.r) - p.x, p.z - (b.minZ - p.r), (b.maxZ + p.r) - p.z, (b.h + p.r) - p.y];
    let k = 0; for (let i = 1; i < 5; i++) if (pen[i] < pen[k]) k = i;
    if (k === 0) { p.x = b.minX - p.r; if (p.vx > 0) p.vx = -p.vx * bounce; }
    else if (k === 1) { p.x = b.maxX + p.r; if (p.vx < 0) p.vx = -p.vx * bounce; }
    else if (k === 2) { p.z = b.minZ - p.r; if (p.vz > 0) p.vz = -p.vz * bounce; }
    else if (k === 3) { p.z = b.maxZ + p.r; if (p.vz < 0) p.vz = -p.vz * bounce; }
    else { p.y = b.h + p.r; if (p.vy < 0) p.vy = -p.vy * bounce; p.onTop = true; }
    hit = true;
  }
  return hit;
}
function launchBomb(f) {
  const d = dirFrom(f.yaw, 0), sp = 21;
  addProj({ type: 'bomb', owner: f, x: f.x + d[0] * 1.1, y: f.feet + 0.33, z: f.z + d[2] * 1.1, vx: d[0] * sp, vy: 0, vz: d[2] * sp, t: Infinity, arm: 0.5, r: 0.32, sp });
}
function launchMissile(f) {
  const targets = fighters.filter((o) => o !== f && o.alive).sort((a, b) => b.kills - a.kills);
  const target = targets[0];
  addProj({ type: 'missile', owner: f, target, x: f.x, y: f.feet + 2, z: f.z, vx: 0, vy: 14, vz: 0, t: 12, r: 0.2, trail: 0 });
  if (target) toastFor(target, f.name + ' a lancé un missile sur toi !');
}
const mineLook = new THREE.MeshStandardMaterial({ color: 0xe6e2da, roughness: 1, transparent: true, opacity: 0.35 });
function dropMine(f) {
  addProj({ type: 'mine', owner: f, x: f.x, y: f.feet, z: f.z, t: Infinity, arm: 1.5 });
}
function useItem(f) {
  if (!f.item || !f.alive || matchPhase !== 'play') return;
  if (!NET.host && f === me) { netSend(['use', f.item, r2(f.yaw)]); f.item = null; sfx.item(); return; }
  const it = f.item; f.item = null;
  if (f === me) sfx.item();
  if (it === 'missile') { launchMissile(f); sfx.missile({ x: f.x, y: f.feet, z: f.z }); }
  else if (it === 'bomb') launchBomb(f);
  else if (it === 'mine') dropMine(f);
  else if (it === 'boost') f.boost = 4;
  else if (it === 'star') f.star = 6;
  else if (it === 'shield') { f.orbs = 3; f.orbT = 25; }
  else if (it === 'storm') {
    for (const o of fighters) if (o !== f && o.alive && o.star <= 0) o.slow = 5;
    sfx.thunder(); stormFlash = 1;
    feedText(f.name + ' déclenche l’orage');
  }
}
function removeProj(i) { const p = projectiles[i]; scene.remove(p.m); projectiles.splice(i, 1); }
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.t -= dt;
    if (p.type === 'nade') {
      p.vy -= 20 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      let hit = bounceBoxes(p, 0.45);
      if (p.y < p.r) { p.y = p.r; if (p.vy < 0) { p.vy = -p.vy * 0.4; hit = true; } p.vx *= 0.8; p.vz *= 0.8; }
      if (p.onTop) { p.vx *= 0.97; p.vz *= 0.97; p.onTop = false; }
      if (hit && Math.hypot(p.vx, p.vy, p.vz) > 2) sfx.bounce(p);
      p.m.position.set(p.x, p.y, p.z); p.m.rotation.x += dt * 8;
      if (p.t <= 0) { removeProj(i); explode(p.x, p.y + 0.2, p.z, NADE.radius, NADE.dmg, p.owner, 'nade', null, 0, NADE.kill); }
    } else if (p.type === 'bomb') {
      p.arm -= dt;
      p.vy -= 20 * dt; p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
      const hitW = bounceBoxes(p, 1);
      if (p.y < p.r) { p.y = p.r; p.vy = 0; }
      if (p.onTop) { p.vy = 0; p.onTop = false; }
      // vitesse horizontale constante : elle roule sans s'arrêter
      const hs = Math.hypot(p.vx, p.vz) || 1; p.vx = p.vx / hs * p.sp; p.vz = p.vz / hs * p.sp;
      if (hitW) sfx.thud(p);
      p.m.position.set(p.x, p.y, p.z);
      p.ball.rotation.x += dt * p.sp * 3; p.m.rotation.y = Math.atan2(p.vx, p.vz);
      p.fuse.material.color.setHex(Math.sin(gameTime * 20) > 0 ? 0xff7a59 : 0xffffff);
      let boom = p.t <= 0, victim = null;
      for (const f of fighters) {
        if (boom) break;
        if (!f.alive || (f === p.owner && p.arm > 0)) continue;
        if (Math.hypot(f.x - p.x, f.z - p.z) < 0.95 && p.y > f.feet - 0.5 && p.y < f.feet + 1.9) { boom = true; victim = f; }
      }
      if (boom) { removeProj(i); explode(p.x, p.y + 0.3, p.z, 3, 70, p.owner, 'bomb', victim, 200); }
    } else if (p.type === 'missile') {
      if (p.target && !p.target.alive) {
        const alive = fighters.filter((o) => o !== p.owner && o.alive).sort((a, b) => b.kills - a.kills);
        p.target = alive[0] || null;
      }
      const cruise = 7;
      let tx, ty, tz;
      if (p.target) {
        tx = p.target.x; tz = p.target.z;
        const hd = Math.hypot(tx - p.x, tz - p.z);
        ty = hd > 5 ? cruise : p.target.feet + 1;
      } else { tx = p.x + p.vx; ty = cruise; tz = p.z + p.vz; }
      const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z, dl = Math.hypot(dx, dy, dz) || 1;
      const speed = 19, turn = Math.min(1, dt * 5);
      p.vx += (dx / dl * speed - p.vx) * turn; p.vy += (dy / dl * speed - p.vy) * turn; p.vz += (dz / dl * speed - p.vz) * turn;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.m.position.set(p.x, p.y, p.z);
      p.m.lookAt(p.x - p.vx, p.y - p.vy, p.z - p.vz);
      p.trail -= dt; if (p.trail <= 0) { p.trail = 0.04; smoke(p.x, p.y, p.z, 1); }
      let boom = p.t <= 0 || p.y < 0.2;
      // en piqué final, il passe au ras des murs pour ne pas rater sa cible
      const near = p.target && Math.hypot(p.target.x - p.x, p.target.z - p.z) < 6;
      if (!boom && !near) for (const b of MAP.obstacles) if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y < b.h) { boom = true; break; }
      let victim = null;
      if (!boom) for (const f of fighters) if (f.alive && f !== p.owner && Math.hypot(f.x - p.x, f.feet + 1 - p.y, f.z - p.z) < 1.3) { boom = true; victim = f; break; }
      if (boom) { removeProj(i); explode(p.x, p.y, p.z, 4, 80, p.owner, 'missile', victim, 250, 2.5); }
    } else if (p.type === 'gl') {
      p.vy -= GL.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.m.position.set(p.x, p.y, p.z);
      let boom = p.t <= 0 || p.y < p.r || bounceBoxes(p, 0), victim = null;
      if (!boom) for (const f of fighters) if (f.alive && f !== p.owner && Math.abs(f.x - p.x) < 0.55 && Math.abs(f.z - p.z) < 0.55 && p.y > f.feet && p.y < f.feet + 1.95) { boom = true; victim = f; break; }
      p.m.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      if (boom) { removeProj(i); explode(p.x, Math.max(0.3, p.y), p.z, GL.radius, GL.dmg, p.owner, 'launcher', victim, GL.direct, GL.kill); }
    } else if (p.type === 'mine') {
      p.arm -= dt;
      let boom = p.t <= 0, victim = null;
      if (p.arm <= 0) for (const f of fighters) {
        if (!f.alive || !f.onGround) continue;
        if (Math.hypot(f.x - p.x, f.z - p.z) < 0.5 && Math.abs(f.feet - p.y) < 0.15) { boom = true; victim = f; break; }
      }
      if (boom) { removeProj(i); if (victim) sfx.mineClick(p); explode(p.x, p.y + 0.4, p.z, 2.6, 60, p.owner, 'mine', victim, 250); }
    }
  }
}

// ---------- déplacement du joueur (identique à l'étape 1, avec les effets) ----------
const EYE = 1.65, R = 0.42;
function speedMult(f) { return (f.boost > 0 ? 1.6 : 1) * (f.star > 0 ? 1.2 : 1) * (f.slow > 0 ? 0.55 : 1); }
function accelerate(f, wx_, wz_, wishSpeed, accel, dt) {
  const cur = f.vx * wx_ + f.vz * wz_, add = wishSpeed - cur;
  if (add <= 0) return;
  let a = accel * dt * wishSpeed; if (a > add) a = add;
  f.vx += a * wx_; f.vz += a * wz_;
}
function friction(f, dt, k) {
  const sp = Math.hypot(f.vx, f.vz);
  if (sp < 0.05) { f.vx = f.vz = 0; return; }
  const m = Math.max(0, sp - Math.max(sp, 3) * k * dt) / sp; f.vx *= m; f.vz *= m;
}
function findLadder(f) {
  if (f.feet > H + 0.05) return null;
  for (const l of MAP.ladders) {
    const dx = f.x - l.x, dz = f.z - l.z, dn = dx * l.nx + dz * l.nz, dt = dx * l.tx + dz * l.tz;
    if (dn > 0 && dn < 0.95 && Math.abs(dt) < 0.65) return l;
  }
  return null;
}
const keys = {};
let hintText = '';
function moveBody(f, dt, fwd, str, jumpHeld, jumpBuf) {
  const mult = speedMult(f), gs = S.groundSpeed * mult;
  const sn = Math.sin(f.yaw), cs = Math.cos(f.yaw);
  let wxd = -sn * fwd + cs * str, wzd = -cs * fwd - sn * str;
  const wl = Math.hypot(wxd, wzd); if (wl > 0) { wxd /= wl; wzd /= wl; }
  const wantJump = jumpHeld || jumpBuf;
  const lad = f.slip > 0 ? null : findLadder(f);
  if (f.ladder && f.ladder !== lad) f.ladder = null;
  if (!f.ladder && lad && wl > 0 && (wxd * -lad.nx + wzd * -lad.nz) > 0.5) f.ladder = lad;
  if (f === me && !f.ladder && lad && f.onGround) hintText = 'Avance vers l’échelle pour grimper';
  let jumped = false;
  if (f.ladder) {
    const l = f.ladder, look = -sn * -l.nx + -cs * -l.nz, dir = fwd * (look >= -0.2 ? 1 : -1);
    f.vy = dir * S.climb * Math.min(1, mult);
    const side = str ? (cs * str * l.tx + -sn * str * l.tz) : 0;
    f.vx = l.tx * side * 2 - l.nx * 1.2; f.vz = l.tz * side * 2 - l.nz * 1.2;
    f.onGround = false;
    if (dir && f === me) { f.rungAcc += Math.abs(f.vy) * dt; if (f.rungAcc > 0.38) { f.rungAcc = 0; sfx.rung(); } }
    if (f.feet > H - 0.3 && dir > 0) { f.ladder = null; f.vy = 3.2; f.vx = -l.nx * 3.5; f.vz = -l.nz * 3.5; }
    else if (jumpHeld && !f.ladderJumpLock) { f.ladder = null; f.vy = S.jump * 0.75; f.vx = l.nx * 5; f.vz = l.nz * 5; f.ladderJumpLock = true; jumped = true; }
  } else if (f.slip > 0) {
    friction(f, dt, 0.25);
    f.yaw += f.slipYaw * dt;
  } else if (f.onGround) {
    if (wantJump) {
      const sp = Math.hypot(f.vx, f.vz);
      const chained = f.groundTime < 0.12 && sp > gs * 0.6;
      if (chained) { const target = Math.min(sp * S.hopGain, gs * S.hopMax); if (target > sp) { f.vx *= target / sp; f.vz *= target / sp; } }
      else { friction(f, dt, S.friction); accelerate(f, wxd, wzd, wl ? gs : 0, S.accel, dt); }
      f.vy = S.jump; f.onGround = false; jumped = true;
      if (f === me) sfx.jump();
    } else { friction(f, dt, S.friction); if (wl) accelerate(f, wxd, wzd, gs, S.accel, dt); }
  } else {
    if (wl) accelerate(f, wxd, wzd, gs, S.airAccel, dt);
    const sp = Math.hypot(f.vx, f.vz), cap = gs * S.hopMax;
    if (sp > cap) { f.vx *= cap / sp; f.vz *= cap / sp; }
  }
  if (!jumpHeld) f.ladderJumpLock = false;
  if (!f.ladder) f.vy -= S.gravity * dt;
  const bx = f.x + f.vx * dt, bz = f.z + f.vz * dt, o = { x: bx, z: bz };
  MAP.collide(o, R, f.feet);
  const px = o.x - bx, pz = o.z - bz, pl = Math.hypot(px, pz);
  if (pl > 1e-6) { const nx = px / pl, nz = pz / pl, d = f.vx * nx + f.vz * nz; if (d < 0) { f.vx -= nx * d; f.vz -= nz * d; } }
  f.x = clamp(o.x, -HALF, HALF); f.z = clamp(o.z, -HALF, HALF);
  f.feet += f.vy * dt;
  if (f.ladder) f.feet = Math.max(0, f.feet);
  const g = MAP.groundAt(f.x, f.z, R, f.feet);
  if (!f.ladder && f.feet <= g && f.vy <= 0) {
    if (!f.onGround) { f.groundTime = 0; if (f === me && f.vy < -4) sfx.land(-f.vy); }
    f.feet = g; f.vy = 0; f.onGround = true;
  } else if (!f.ladder && f.feet > g + 0.02) f.onGround = false;
  if (f.onGround) {
    f.groundTime += dt;
    f.stepAcc = (f.stepAcc || 0) + Math.hypot(f.vx, f.vz) * dt;
    if (f.stepAcc > 2.3) { f.stepAcc = 0; if (f === me) sfx.step(null); else if (Math.hypot(f.x - me.x, f.z - me.z) < 22) sfx.step({ x: f.x, y: f.feet, z: f.z }); }
  }
  return jumped;
}
function stepMe(dt) {
  hintText = '';
  if (!me.alive || matchPhase !== 'play') { moveBody(me, dt, 0, 0, false, false); return; }
  const fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const str = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  if (me.jumpBuf > 0) me.jumpBuf -= dt;
  if (moveBody(me, dt, fwd, str, !!keys.Space, me.jumpBuf > 0)) me.jumpBuf = 0;
}

// ---------- IA des bots ----------
function bfs(sr, sc, gr, gc) {
  const prev = new Int32Array(N * N).fill(-1), start = sr * N + sc, goal = gr * N + gc;
  const q = [start]; prev[start] = start;
  while (q.length) {
    const cur = q.shift(); if (cur === goal) break;
    const r = (cur / N) | 0, c = cur % N;
    const nb = [];
    if (r > 0 && !MAP.hW[r][c]) nb.push(cur - N);
    if (r < N - 1 && !MAP.hW[r + 1][c]) nb.push(cur + N);
    if (c > 0 && !MAP.vW[r][c]) nb.push(cur - 1);
    if (c < N - 1 && !MAP.vW[r][c + 1]) nb.push(cur + 1);
    for (const n of nb) if (prev[n] < 0) { prev[n] = cur; q.push(n); }
  }
  if (prev[goal] < 0) return [];
  const path = []; let c = goal;
  while (c !== start) { path.push(c); c = prev[c]; }
  return path.reverse().map((k) => cellCenter((k / N) | 0, k % N));
}
function botPathTo(b, x, z) {
  const [sr, sc] = cellOf(b.x, b.z), [gr, gc] = cellOf(x, z);
  b.bot.path = bfs(sr, sc, gr, gc);
  b.bot.path.push({ x, z });
  b.bot.goal = { x, z };
}
function botChooseGoal(b) {
  const bt = b.bot;
  const ground = pickups.filter((p) => p.ready && p.y === 0);
  let wanted = null;
  const hasPrimary = b.weapons.smg || b.weapons.rifle;
  if (!hasPrimary) wanted = ground.filter((p) => p.kind === 'smg' || p.kind === 'rifle');
  else if (!b.item) wanted = ground.filter((p) => p.kind === 'box');
  else if (b.grenades === 0) wanted = ground.filter((p) => p.kind === 'nade');
  if (wanted && wanted.length && Math.random() < 0.8) {
    wanted.sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z));
    const p = wanted[Math.random() < 0.7 ? 0 : Math.min(1, wanted.length - 1)];
    botPathTo(b, p.x, p.z); return;
  }
  // sinon : patrouille vers une case au hasard, plutôt vers un adversaire
  const others = fighters.filter((o) => o !== b && o.alive);
  if (others.length && Math.random() < 0.45) { const o = others[Math.floor(Math.random() * others.length)]; const [r, c] = cellOf(o.x, o.z); const cc = cellCenter(r, c); botPathTo(b, cc.x, cc.z); return; }
  const cc = cellCenter(Math.floor(Math.random() * N), Math.floor(Math.random() * N));
  botPathTo(b, cc.x, cc.z);
}
function botPickWeapon(b, dist) {
  const has = (k) => b.weapons[k] && (b.weapons[k].mag > 0 || b.weapons[k].res > 0);
  let want = 'pistol';
  if (dist < 2.6 && has('katana')) want = 'katana';
  else if (dist > 8 && dist < 26 && has('launcher') && Math.random() < 0.7) want = 'launcher';
  else if (dist < 12 && has('smg')) want = 'smg';
  else if (has('rifle')) want = 'rifle';
  else if (has('smg')) want = 'smg';
  if (want !== b.cur && b.reloading <= 0) switchWeapon(b, want);
}
function updateBot(b, dt) {
  const bt = b.bot, D = DIFF[S.diff];
  if (!b.alive || matchPhase !== 'play') { if (b.alive) moveBody(b, dt, 0, 0, false, false); return; }
  // perception
  bt.scanT -= dt;
  if (bt.scanT <= 0) {
    bt.scanT = 0.15;
    const ex = b.x, ey = b.feet + 1.65, ez = b.z;
    let best = null, bd = 1e9;
    for (const o of fighters) {
      if (o === b || !o.alive) continue;
      const d = Math.hypot(o.x - ex, o.z - ez);
      if (d > 48) continue;
      const fwdDot = (-Math.sin(b.yaw) * (o.x - ex) - Math.cos(b.yaw) * (o.z - ez)) / (d || 1);
      const prefer = o === bt.target ? -6 : 0;
      if (fwdDot < -0.2 && o !== bt.target && d > 6) continue; // ne voit pas derrière lui
      if (!los(ex, ey, ez, o.x, o.feet + 1.3, o.z)) continue;
      if (d + prefer < bd) { bd = d + prefer; best = o; }
    }
    if (best) {
      if (best !== bt.target) { bt.seeT = 0; bt.errY = rand(-0.12, 0.12); bt.errP = rand(-0.06, 0.06); }
      bt.target = best; bt.lastSeen = { x: best.x, z: best.z, t: gameTime };
      bt.seeT += 0.15;
    } else { bt.seeT = 0; if (bt.target && !bt.target.alive) bt.target = null; }
  }
  const tgt = bt.seeT > 0 && bt.target && bt.target.alive ? bt.target : null;

  // déplacement
  let fwd = 0, str = 0, moveYaw = b.yaw;
  if (tgt) {
    const d = Math.hypot(tgt.x - b.x, tgt.z - b.z);
    bt.strafeT -= dt; if (bt.strafeT <= 0) { bt.strafeT = rand(0.5, 1.4); bt.strafe = Math.random() < 0.5 ? -1 : 1; }
    if (b.weapons.katana && d < 7 && Math.random() < 0.5) { bt.path = [{ x: tgt.x, z: tgt.z }]; }
    else if (d > 14) { if (!bt.path.length || !bt.goal || Math.hypot(bt.goal.x - tgt.x, bt.goal.z - tgt.z) > 4) botPathTo(b, tgt.x, tgt.z); }
    else { bt.path = []; }
  } else if (bt.lastSeen && gameTime - bt.lastSeen.t < 4) {
    if (!bt.goal || Math.hypot(bt.goal.x - bt.lastSeen.x, bt.goal.z - bt.lastSeen.z) > 2) botPathTo(b, bt.lastSeen.x, bt.lastSeen.z);
  } else if (!bt.path.length) botChooseGoal(b);

  let mx = 0, mz = 0;
  if (bt.path.length) {
    const w = bt.path[0], dx = w.x - b.x, dz = w.z - b.z, dl = Math.hypot(dx, dz);
    if (dl < 0.7) bt.path.shift();
    else { mx = dx / dl; mz = dz / dl; }
  }
  if (tgt) { // déplacements latéraux en combat
    const dx = tgt.x - b.x, dz = tgt.z - b.z, dl = Math.hypot(dx, dz) || 1;
    mx += (-dz / dl) * bt.strafe * 0.7; mz += (dx / dl) * bt.strafe * 0.7;
  }
  // détection de blocage
  bt.wanderT -= dt;
  if (bt.wanderT <= 0) {
    bt.wanderT = 1.5;
    if (Math.hypot(b.x - bt.lastX, b.z - bt.lastZ) < 0.6 && !tgt) { bt.path = []; botChooseGoal(b); }
    bt.lastX = b.x; bt.lastZ = b.z;
  }
  // visée
  if (tgt) {
    const lead = 0.12;
    const tx = tgt.x + tgt.vx * lead, tz = tgt.z + tgt.vz * lead, ty = tgt.feet + (S.diff === 2 && Math.random() < 0.3 ? 1.65 : 1.25);
    const dx = tx - b.x, dz = tz - b.z, dy = ty - (b.feet + 1.65);
    const wantYaw = Math.atan2(-dx, -dz) + bt.errY * Math.max(0, 1 - bt.seeT), wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) + bt.errP * Math.max(0, 1 - bt.seeT);
    const ty_ = angDiff(b.yaw, wantYaw), tp = wantPitch - b.pitch;
    const maxT = D.turn * dt;
    b.yaw += clamp(ty_, -maxT, maxT); b.pitch += clamp(tp, -maxT, maxT);
    const dist = Math.hypot(dx, dz);
    botPickWeapon(b, dist);
    if (bt.seeT >= D.react && Math.abs(angDiff(b.yaw, wantYaw)) < 0.09 + 1 / Math.max(4, dist)) {
      const W = WEAPONS[b.cur];
      if ((W.auto || b.fireCd <= 0) && (!W.melee || dist < 2.3)) fire(b, b.cur === 'launcher' ? D.spread * 0.5 : D.spread);
    }
    // grenade
    if (b.grenades > 0 && dist > 7 && dist < 22 && Math.random() < D.nade * dt) {
      const saved = b.pitch; b.pitch = Math.atan2(dy, dist) + 0.18 + dist * 0.012; throwNade(b); b.pitch = saved;
    }
  } else if (mx || mz) {
    const wantYaw = Math.atan2(-mx, -mz);
    b.yaw += clamp(angDiff(b.yaw, wantYaw), -4 * dt, 4 * dt); b.pitch *= 0.9;
  }
  // bonus
  if (b.item) {
    bt.itemT -= dt;
    if (bt.itemT <= 0) {
      const it = b.item;
      const ok = it === 'missile' || it === 'shield' || it === 'boost' || (it === 'star' && tgt) || (it === 'bomb' && tgt) || (it === 'mine' && (bt.lastSeen && gameTime - bt.lastSeen.t < 2 || Math.random() < 0.3));
      if (ok) { if (it === 'bomb' && tgt) b.yaw = Math.atan2(-(tgt.x - b.x), -(tgt.z - b.z)); useItem(b); }
      bt.itemT = rand(0.5, 2);
    }
  }
  if (b.reloading <= 0 && b.weapons[b.cur] && b.weapons[b.cur].mag === 0) startReload(b);
  if (!tgt && b.reloading <= 0) { const st = b.weapons[b.cur]; if (st && st.mag < WEAPONS[b.cur].mag * 0.5) startReload(b); }
  // convertit la direction voulue en commandes clavier relatives à la vue
  const ml = Math.hypot(mx, mz);
  if (ml > 0.01) {
    mx /= ml; mz /= ml;
    const sn = Math.sin(b.yaw), cs = Math.cos(b.yaw);
    fwd = mx * -sn + mz * -cs; str = mx * cs + mz * -sn;
  }
  const speedScale = tgt ? 0.75 : 0.85; // les bots courent un peu moins vite que toi
  moveBody(b, dt, fwd * speedScale, str * speedScale, false, false);
}

// ---------- effets temporaires et respawn ----------
function localTimers(f, dt) {
  f.fireCd = Math.max(0, f.fireCd - dt);
  if (f.reloading > 0) { f.reloading -= dt; if (f.reloading <= 0) { f.reloading = 0; finishReload(f); } }
}
function updateFighter(f, dt) {
  localTimers(f, dt);
  f.boost = Math.max(0, f.boost - dt); f.slow = Math.max(0, f.slow - dt); f.slip = Math.max(0, f.slip - dt);
  if (f.star > 0) {
    f.star -= dt;
    for (const o of fighters) if (o !== f && o.alive && Math.hypot(o.x - f.x, o.z - f.z) < 1.15 && Math.abs(o.feet - f.feet) < 1.6) damage(o, 200, f, 'star', false);
  }
  if (f.orbs > 0) {
    f.orbT -= dt; f.orbAng += dt * 3.5;
    if (f.orbT <= 0) f.orbs = 0;
    for (let i = 0; i < f.orbs; i++) {
      const a = f.orbAng + i * Math.PI * 2 / 3, ox = f.x + Math.cos(a) * 1.05, oz = f.z + Math.sin(a) * 1.05;
      for (const o of fighters) if (o !== f && o.alive && o.star <= 0 && Math.hypot(o.x - ox, o.z - oz) < 0.6 && Math.abs(o.feet - f.feet) < 1.5) {
        f.orbs--; damage(o, 35, f, 'shield', false); burst(ox, f.feet + 1.2, oz, 0x7b62d9, 10, 4, 0.5); sfx.orb(); break;
      }
    }
  }
  if (!f.alive && matchPhase === 'play' && gameTime >= f.respawnAt) spawn(f);
  if (f.alive) tryPickups(f);
}

// ---------- match ----------
function startMatch() {
  for (const p of projectiles.slice()) scene.remove(p.m);
  projectiles.length = 0;
  for (const p of pickups) { p.ready = true; p.show.visible = true; }
  for (const f of fighters) { f.kills = 0; f.deaths = 0; f.alive = false; }
  for (const f of fighters) spawn(f);
  matchPhase = 'play'; matchEnd = gameTime + RULES.matchSeconds;
  $('board').hidden = true; $('feed').innerHTML = '';
  sfx.start();
  emit(['start']);
}
let endAt = 0;
function endMatch() {
  if (matchPhase !== 'play') return;
  matchPhase = 'end'; endAt = gameTime;
  emit(['end']);
  showBoard(true);
  unlock();
}

// ---------- HUD ----------
let flashT = 0, hitT = 0, toastT = 0, dmgT = 0, stormFlash = 0;
function hitmark(kind) { const h = $('hitmark'); h.className = 'on' + (kind ? ' ' + kind : ''); hitT = kind === 'kill' ? 0.3 : 0.12; }
function toast(t) { setText($('toast'), t); $('toast').classList.add('on'); toastT = 2.5; }
function toastFor(f, t) { if (f === me) toast(t); else if (f.remote) emit(['toast', f.id, t]); }
function onHurt(from) {
  me.hurt = 1; me.shake = Math.max(me.shake || 0, 0.4); sfx.hurt();
  if (from) { const ang = Math.atan2(from[0] - me.x, from[1] - me.z); const rel = ang - Math.atan2(-Math.sin(me.yaw), -Math.cos(me.yaw)); $('dmgDir').style.transform = 'rotate(' + (-rel) + 'rad)'; dmgT = 1; }
}
function feedRow(nodes) {
  const box = $('feed'), div = document.createElement('div');
  div.append(...nodes); box.prepend(div);
  while (box.children.length > 5) box.lastChild.remove();
  setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 450); }, 5000);
}
function nameEl(f) { const b = document.createElement('b'); b.textContent = f ? f.name : '?'; if (f) b.style.color = f.color; return b; }
function feed(k, v, label, head) {
  const nodes = [];
  if (!k || k === v) nodes.push(nameEl(v), document.createTextNode(' s’est éliminé'));
  else nodes.push(nameEl(k), document.createTextNode(' a éliminé '), nameEl(v));
  if (label) { const e = document.createElement('em'); e.textContent = label + (head ? ' · tête' : ''); if (head) e.className = 'h'; nodes.push(e); }
  feedRow(nodes);
}
function feedText(t) { feedRow([document.createTextNode(t)]); }
function sorted() { return fighters.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths); }
let boardHeld = false;
function showBoard(end) {
  const body = $('boardBody'); body.innerHTML = '';
  for (const f of sorted()) {
    const tr = document.createElement('tr'); if (f === me) tr.className = 'me';
    const td1 = document.createElement('td'); const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = f.color;
    td1.append(dot, document.createTextNode(f.name + (f.isBot ? ' (bot)' : ONLINE && f === me ? ' (toi)' : '')));
    const td2 = document.createElement('td'); td2.className = 'n'; td2.textContent = f.kills;
    const td3 = document.createElement('td'); td3.className = 'n'; td3.textContent = f.deaths;
    tr.append(td1, td2, td3); body.append(tr);
  }
  const top = sorted()[0];
  setText($('boardEyebrow'), end ? 'Fin de la manche' : 'Classement');
  setText($('boardTitle'), end ? (top === me ? 'Victoire !' : top.name + ' gagne') : 'Scores');
  $('boardActions').hidden = !end;
  $('again').hidden = ONLINE;
  setText($('endInfo'), end ? (top === me ? 'Bien joué.' : 'Tu finis ' + (sorted().indexOf(me) + 1) + 'e sur 5.') : '');
  $('board').hidden = !(end || boardHeld);
}
function renderSlots() {
  const box = $('slots');
  if (!box.children.length) ORDER.forEach((k, i) => { const s = document.createElement('span'); s.textContent = String(i + 1); s.title = WEAPONS[k].name; box.append(s); });
  ORDER.forEach((k, i) => { const s = box.children[i]; const cls = (me.weapons[k] ? 'own' : '') + (me.cur === k ? ' cur' : ''); if (s.className !== cls) s.className = cls; });
}
const map = $('map'), mctx = map.getContext('2d');
let showMap = true;
function drawMap() {
  const W = map.width, sc = W / (N * C + 4), off = (v) => (v + HALF + 2) * sc;
  mctx.clearRect(0, 0, W, W);
  mctx.fillStyle = '#d4d4d4';
  for (const b of MAP.obstacles) mctx.fillRect(off(b.minX), off(b.minZ), (b.maxX - b.minX) * sc, (b.maxZ - b.minZ) * sc);
  mctx.fillStyle = '#3a3a40';
  for (const l of MAP.ladders) mctx.fillRect(off(l.x + l.nx * 0.4) - 4, off(l.z + l.nz * 0.4) - 4, 8, 8);
  for (const p of pickups) {
    if (!p.ready) continue;
    mctx.beginPath(); mctx.arc(off(p.x), off(p.z), p.kind === 'box' ? 6 : 4, 0, Math.PI * 2);
    mctx.fillStyle = p.kind === 'box' ? '#ff7a59' : '#8b8780'; mctx.fill();
    if (p.y > 0) { mctx.lineWidth = 2; mctx.strokeStyle = '#26262b'; mctx.stroke(); }
  }
  mctx.save(); mctx.translate(off(me.x), off(me.z)); mctx.rotate(-me.yaw);
  mctx.beginPath(); mctx.moveTo(0, -11); mctx.lineTo(7, 8); mctx.lineTo(0, 4); mctx.lineTo(-7, 8); mctx.closePath();
  mctx.fillStyle = me.color; mctx.fill(); mctx.lineWidth = 2; mctx.strokeStyle = '#ffffff'; mctx.stroke();
  mctx.restore();
}
function updateHud(dt) {
  setText($('myKills'), String(me.kills));
  setText($('leadKills'), String(sorted()[0].kills));
  setText($('timer'), fmtClock(matchEnd - gameTime));
  const hp = Math.max(0, Math.ceil(me.hp));
  setText($('hp'), String(hp)); $('hpBar').style.width = hp + '%';
  $('hpBox').classList.toggle('low', hp <= 30);
  const W = WEAPONS[me.cur], st = me.weapons[me.cur] || { mag: 0, res: 0 };
  setText($('wName'), W.name);
  setText($('ammo'), W.melee ? '—' : String(st.mag));
  setText($('reserve'), W.melee ? 'corps à corps' : '/ ' + (st.res === Infinity ? '∞' : st.res));
  $('ammoBar').style.width = (me.reloading > 0 ? 1 - me.reloading / W.reload : st.mag / W.mag) * 100 + '%';
  setText($('reloadTxt'), me.reloading > 0 ? 'Rechargement' : st.mag === 0 ? (st.res > 0 ? 'R pour recharger' : 'Plus de munitions') : '');
  setText($('nades'), 'Grenades ' + me.grenades + ' · G');
  renderSlots();
  const ib = $('itemBox');
  if (me.item) { const it = ITEMS[me.item]; ib.hidden = false; ib.style.setProperty('--item', it.color); setText($('itemSw'), it.glyph); setText($('itemName'), it.name); setText($('itemDesc'), it.desc);  }
  else ib.hidden = true;
  const fx = [];
  if (me.boost > 0) fx.push(['Turbo', me.boost, '#c98a10']);
  if (me.star > 0) fx.push(['Surcharge', me.star, '#d29a00']);
  if (me.orbs > 0) fx.push(['Orbes ×' + me.orbs, me.orbT, '#7b62d9']);
  if (me.slow > 0) fx.push(['Ralenti', me.slow, '#3b6fd6']);
  if (me.slip > 0) fx.push(['Dérapage', me.slip, '#52cbb5']);
  const fxKey = fx.map((e) => e[0] + Math.ceil(e[1])).join('|');
  if (cache.get('fx') !== fxKey) {
    cache.set('fx', fxKey); const box = $('effects'); box.innerHTML = '';
    for (const [n, t, c] of fx) { const s = document.createElement('span'); s.textContent = n + ' ' + Math.ceil(t) + ' s'; s.style.setProperty('--c', c); box.append(s); }
  }
  const spread = me.cur === 'smg' ? (me.sprayHeat || 0) * 8 : 0;
  for (let i = 0; i < 4; i++) { const el = $('cross').children[i]; const s = [[0, -1], [0, 1], [-1, 0], [1, 0]][i]; el.style.transform = 'translate(' + s[0] * spread + 'px,' + s[1] * spread + 'px)'; }
  const hint = mode === 'game' && !locked ? 'Clique dans le jeu pour prendre la souris' : hintText;
  setText($('hint'), hint); $('hint').classList.toggle('on', !!hint && me.alive);
  if (ONLINE && matchPhase === 'end') setText($('endInfo'), 'Nouvelle manche dans ' + Math.max(0, Math.ceil(endAt + 12 - gameTime)) + ' s');
  if (!me.alive && matchPhase === 'play') setText($('deathTxt'), ($('deathTxt').textContent.split(' · retour')[0]) + ' · retour dans ' + Math.max(0, Math.ceil(me.respawnAt - gameTime)) + ' s');
  me.hurt = Math.max(0, (me.hurt || 0) - dt * 2); dmgT = Math.max(0, dmgT - dt * 1.2);
  $('vignette').style.opacity = Math.max(me.hurt * 0.85, hp <= 30 && me.alive ? 0.3 : 0);
  $('dmgDir').style.opacity = dmgT;
  $('stormTint').style.opacity = me.slow > 0 ? Math.min(1, me.slow) : 0;
  $('starTint').style.opacity = me.star > 0 ? 0.55 + Math.sin(gameTime * 14) * 0.3 : 0;
  stormFlash = Math.max(0, stormFlash - dt * 2.5); $('flashWhite').style.opacity = stormFlash * 0.7;
  if (hitT > 0) { hitT -= dt; if (hitT <= 0) $('hitmark').className = ''; }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('on'); }
  map.hidden = !showMap; if (showMap) drawMap();
}

// ---------- caméra et rendu des combattants ----------
function updateCamera(dt) {
  const sp = Math.hypot(me.vx, me.vz);
  if (me.onGround && sp > 1) me.bob = (me.bob || 0) + dt * sp * 1.25;
  const bob = me.onGround && !REDUCED ? Math.sin(me.bob || 0) * 0.035 * Math.min(1, sp / S.groundSpeed) : 0;
  me.shake = Math.max(0, (me.shake || 0) - dt * 2.5);
  const sh = REDUCED ? 0 : me.shake * 0.1;
  if (me.alive || matchPhase === 'end') camera.position.set(me.x + (Math.random() - 0.5) * sh, me.feet + EYE + bob + (Math.random() - 0.5) * sh, me.z + (Math.random() - 0.5) * sh);
  else camera.position.y += (me.feet + EYE + 2.5 - camera.position.y) * Math.min(1, dt * 2);
  camera.rotation.set(me.pitch, me.yaw, 0);
  const scoped = false;
  const target = baseFov + (REDUCED ? 0 : clamp((sp - S.groundSpeed) / S.groundSpeed, 0, 0.8) * 14);
  if (Math.abs(camera.fov - target) > 0.05) { camera.fov += (target - camera.fov) * Math.min(1, dt * (scoped ? 18 : 6)); camera.updateProjectionMatrix(); }
  me.kick = Math.max(0, (me.kick || 0) - dt * 9);
  me.sprayHeat = Math.max(0, (me.sprayHeat || 0) - dt * (me.trigger ? 0.6 : 3));
  let ry = 0, py = 0;
  const W = WEAPONS[me.cur];
  if (me.reloading > 0) { const k = Math.sin((1 - me.reloading / W.reload) * Math.PI); ry = -k * 0.8; py = -k * 0.15; }
  for (const k of ORDER) viewmodels[k].visible = me.alive && !scoped && k === me.cur;
  me.swing = Math.max(0, (me.swing || 0) - dt);
  if (me.cur === 'katana') {
    const k = me.swing > 0 ? Math.sin((1 - me.swing / 0.32) * Math.PI) : 0;
    const sd = me.swingDir || 1;
    viewmodels.katana.rotation.set(0.55 - k * 1.1, 0.15 + k * 0.9 * sd, -0.35 + k * 0.6 * sd);
    viewmodels.katana.position.set(-0.02 - k * 0.12 * sd, -0.02 + k * 0.05, 0.06 - k * 0.1);
  }
  vmRoot.position.set(0.2 + (me.onGround ? Math.cos((me.bob || 0) * 0.5) * 0.015 : 0), -0.2 + bob * 0.5 + py, -0.36 + me.kick * 0.06);
  if (viewmodels.launcher.userData.nade) viewmodels.launcher.userData.nade.visible = (me.weapons.launcher && me.weapons.launcher.mag > 0) && me.reloading <= 0;
  vmRoot.rotation.set(me.kick * 0.2 + ry, 0, ry * 0.4);
  flash.position.set(0, me.cur === 'pistol' ? 0.042 : me.cur === 'smg' ? 0.022 : 0.03, MUZZLE_Z[me.cur]); flashLight.position.copy(flash.position);
  flashT -= dt; flash.visible = flashT > 0 && !scoped; flashLight.intensity = flashT > 0 ? 2.2 : 0;
  if (flash.visible) flash.rotation.z = Math.random() * 3;
}
const starColors = [0xd29a00, 0xff7a59, 0x3aa58a, 0x7b62d9, 0x3b8fd6];
function updateAvatars(dt) {
  for (const f of fighters) {
    const a = f.avatar; if (!a) continue;
    a.g.visible = f.alive;
    if (!f.alive) { for (const o of a.orbs) o.visible = false; continue; }
    a.g.position.set(f.x, f.feet, f.z); a.g.rotation.y = f.yaw;
    a.head.rotation.x = f.pitch * 0.6; a.arm.rotation.x = f.pitch;
    const sp = Math.hypot(f.x - a.px, f.z - a.pz) / Math.max(dt, 1e-3); a.px = f.x; a.pz = f.z;
    a.walk += dt * sp * 1.6;
    const swing = f.onGround && sp > 0.5 ? Math.sin(a.walk) * 0.55 : f.ladder ? Math.sin(gameTime * 8) * 0.4 : 0;
    a.legL.rotation.x = swing; a.legR.rotation.x = -swing;
    if (ONLINE && f.onGround && sp > 1) {
      a.stepAcc = (a.stepAcc || 0) + sp * dt;
      if (a.stepAcc > 2.3) { a.stepAcc = 0; if (Math.hypot(f.x - me.x, f.z - me.z) < 22) sfx.step({ x: f.x, y: f.feet, z: f.z }); }
    }
    if (a.mixer) {
      const run = sp > 4.5, walk = !run && sp > 0.5;
      a.acts.run.setEffectiveWeight(run || !walk ? 1 : 0); a.acts.walk.setEffectiveWeight(walk ? 1 : 0);
      a.acts.run.timeScale = run ? sp / 7 : 0; a.acts.walk.timeScale = walk ? Math.max(0.6, sp / 2.2) : 0;
      a.mixer.update(dt);
      for (const m of a.charMats) m.emissive.setHex(f.star > 0 ? starColors[Math.floor(gameTime * 12) % 5] : 0x000000);
    }
    for (const k of ORDER) a.guns[k].visible = k === f.cur;
    a.mats[0].emissive.setHex(f.star > 0 ? starColors[Math.floor(gameTime * 12) % 5] : 0x000000);
    a.mats[0].emissiveIntensity = f.star > 0 ? 0.8 : 1;
    a.g.rotation.z = f.slip > 0 ? Math.sin(gameTime * 20) * 0.15 : 0;
  }
  // orbes : visibles pour tous, y compris les tiennes
  for (const f of fighters) {
    const orbs = f.avatar ? f.avatar.orbs : myOrbs;
    for (let i = 0; i < 3; i++) {
      const o = orbs[i], on = f.alive && i < f.orbs;
      o.visible = on;
      if (on) { const ang = f.orbAng + i * Math.PI * 2 / 3; o.position.set(f.x + Math.cos(ang) * 1.05, f.feet + 1.2 + Math.sin(gameTime * 3 + i) * 0.1, f.z + Math.sin(ang) * 1.05); }
    }
  }
}
const myOrbs = [0, 1, 2].map(() => { const o = new THREE.Mesh(orbGeo, orbMat); o.visible = false; scene.add(o); return o; });
function updatePickupsFx(dt) {
  for (const p of pickups) {
    if (!p.ready) { if (NET.host) { p.t -= dt; if (p.t <= 0) { p.ready = true; p.show.visible = true; } } continue; }
    p.show.rotation.y += dt * 1.6; p.show.position.y = 1.0 + Math.sin(gameTime * 2.4 + p.phase) * 0.12;
  }
}
function updateFx(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt; p.v.y -= p.g * dt; p.m.position.addScaledVector(p.v, dt);
    if (!p.smoke && p.m.position.y < 0.05) { p.m.position.y = 0.05; p.v.y *= -0.3; p.v.x *= 0.7; p.v.z *= 0.7; }
    const k = Math.max(0.01, p.life / p.max);
    if (p.smoke) { p.m.scale.setScalar(p.s * (1.6 - k)); p.m.material.opacity = 0.55 * k; }
    else p.m.scale.setScalar(p.s * k);
    if (p.life <= 0) { scene.remove(p.m); if (p.smoke) { p.m.geometry.dispose(); p.m.material.dispose(); } particles.splice(i, 1); }
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i]; t.t -= dt; t.l.material.opacity = Math.max(0, t.t / 0.07);
    if (t.t <= 0) { scene.remove(t.l); t.l.geometry.dispose(); t.l.material.dispose(); tracers.splice(i, 1); }
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.t += dt; const k = r.t / r.max;
    if (r.light) r.m.intensity = 6 * (1 - k);
    else { r.m.scale.setScalar(0.3 + k * r.grow); r.m.material.opacity = 1 - k; }
    if (k >= 1) { scene.remove(r.m); if (!r.light) r.m.material.dispose(); if (r.ball) r.m.geometry.dispose(); rings.splice(i, 1); }
  }
}

// ---------- erreurs visibles ----------
let lastErr = '';
function reportError(msg) {
  if (msg === lastErr) return; lastErr = msg;
  const box = $('err'); if (!box) return;
  box.hidden = false; box.textContent = 'Erreur technique : ' + msg + ' (envoie-moi ce message)';
}
window.addEventListener('error', (e) => reportError(e.message || 'inconnue'));

// ---------- post-traitement ----------
function applyQuality() {
  const q = S.quality, w = app.clientWidth, h = app.clientHeight;
  const pr = Math.min(window.devicePixelRatio || 1, q === 2 ? 1.5 : q === 1 ? 1.25 : 1);
  renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
  renderer.toneMappingExposure = S.exposure;
  const ms = q === 2 ? 4096 : q === 1 ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  if (composer) { try { composer.dispose && composer.dispose(); } catch (e) {} }
  composer = null;
  const A = ADDONS;
  if (q === 0 || !A || !A.EffectComposer || !A.RenderPass) return;
  try {
    const c = new A.EffectComposer(renderer);
    c.setPixelRatio(pr); c.setSize(w, h);
    let first = null;
    if (q === 2 && A.SSAOPass) {
      const ao = new A.SSAOPass(scene, camera, w, h);
      ao.kernelRadius = 0.45; ao.minDistance = 0.0001; ao.maxDistance = 0.0025;
      first = ao;
    }
    c.addPass(first || new A.RenderPass(scene, camera));
    if (A.UnrealBloomPass) c.addPass(new A.UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.3, 0.985));
    if (A.SMAAPass) c.addPass(new A.SMAAPass(w * pr, h * pr));
    composer = c;
  } catch (e) { composer = null; }
}
let composerFails = 0;
function renderFrame() {
  if (composer) {
    try { composer.render(); return; }
    catch (e) { composer = null; composerFails++; reportError('effets désactivés : ' + e.message); }
  }
  renderer.render(scene, camera);
}
function loadScript(src) {
  return new Promise((ok) => {
    const el = document.createElement('script'); el.src = src; el.async = false;
    el.onload = () => ok(true); el.onerror = () => ok(false);
    document.head.appendChild(el);
  });
}
async function loadAddons() {
  const base = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/';
  const files = ['shaders/CopyShader.js', 'postprocessing/EffectComposer.js', 'postprocessing/ShaderPass.js', 'postprocessing/RenderPass.js', 'postprocessing/MaskPass.js',
    'math/SimplexNoise.js', 'shaders/SSAOShader.js', 'postprocessing/SSAOPass.js', 'shaders/LuminosityHighPassShader.js', 'postprocessing/UnrealBloomPass.js',
    'shaders/SMAAShader.js', 'postprocessing/SMAAPass.js', 'geometries/RoundedBoxGeometry.js', 'environments/RoomEnvironment.js'];
  for (const f of files) await loadScript(base + f);
  const pick = (n) => (typeof THREE[n] === 'function' ? THREE[n] : null);
  ADDONS = {};
  for (const n of ['EffectComposer', 'RenderPass', 'SSAOPass', 'UnrealBloomPass', 'SMAAPass', 'RoomEnvironment', 'RoundedBoxGeometry']) ADDONS[n] = pick(n);
  if (ADDONS.RoundedBoxGeometry) { try { buildWalls(ADDONS.RoundedBoxGeometry); } catch (e) { buildWalls(null); } }
  if (ADDONS.RoomEnvironment) {
    try { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new ADDONS.RoomEnvironment(), 0.04).texture; hemi.intensity = 0.45; } catch (e) {}
  }
  applyQuality();
}
// ---------- personnage 3D animé (remplace la silhouette des bots) ----------
async function loadCharacter() {
  const data = window.DEDALE_CHAR;
  if (!data || !THREE.GLTFLoader) return;
  if (!THREE.SkeletonUtils) await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/utils/SkeletonUtils.js');
  if (!THREE.SkeletonUtils) return;
  let gltf;
  try {
    const bin = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)).buffer;
    gltf = await new Promise((ok, ko) => new THREE.GLTFLoader().parse(bin, '', ok, ko));
  } catch (e) { reportError('personnage : ' + (e && e.message ? e.message : e)); return; }
  const clip = (n) => gltf.animations.find((c) => c.name === n) || gltf.animations[0];
  CHAR = { gltf, runClip: clip('Rifle_Charge'), walkClip: clip('Walking') };
  for (const f of fighters) if (f.avatar) applyCharacter(f);
}
function applyCharacter(f) {
  const a = f.avatar; if (!a || a.mixer || !CHAR) return;
  try {
    const model = THREE.SkeletonUtils.clone(CHAR.gltf.scene);
    model.rotation.y = Math.PI; // le modèle regarde vers +z, nos personnages vers -z
    const tint = new THREE.Color(0xffffff).lerp(new THREE.Color(f.color), 0.28);
    a.charMats = [];
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.userData.noOutline = true;
        o.material = o.material.clone(); o.material.color.copy(tint); a.charMats.push(o.material);
      }
    });
    for (const c of a.g.children) if (c.isMesh && !c.userData.noOutline) c.visible = false;
    a.head.visible = false; a.legL.visible = false; a.legR.visible = false;
    for (const c of a.arm.children) if (c.isMesh) c.visible = false;
    a.arm.position.set(0.18, 1.3, -0.12);
    a.tag.position.y = 2.05;
    a.g.add(model);
    a.mixer = new THREE.AnimationMixer(model);
    a.acts = { run: a.mixer.clipAction(CHAR.runClip), walk: a.mixer.clipAction(CHAR.walkClip) };
    a.acts.run.play(); a.acts.walk.play(); a.acts.walk.setEffectiveWeight(0);
    a.acts.run.time = Math.random() * CHAR.runClip.duration;
  } catch (e) { reportError('personnage : ' + e.message); }
}
loadAddons().then(loadModels).then(loadCharacter);

// ---------- simulation ----------
function simulate(dt) {
  gameTime += dt;
  stepMe(dt);
  if (me.trigger && WEAPONS[me.cur].auto) fire(me);
  if (!NET.host) {
    localTimers(me, dt);
    for (const f of fighters) if (f !== me) netFollow(f, dt);
    mirrorProjectiles(dt);
    updatePickupsFx(dt);
    return;
  }
  for (const f of fighters) { if (f.isBot) updateBot(f, dt); else if (f !== me) netFollow(f, dt); updateFighter(f, dt); }
  updateProjectiles(dt);
  updatePickupsFx(dt);
  if (matchPhase === 'play' && gameTime >= matchEnd) endMatch();
  if (ONLINE && matchPhase === 'end' && gameTime >= endAt + 12) startMatch();
}


// ---------- réseau (version en ligne) ----------
function byId(id) { for (const f of fighters) if (f.id === id) return f; return null; }
// les joueurs distants glissent vers leur dernière position connue
function netFollow(f, dt) {
  if (f.nx === undefined) return;
  if (Math.hypot(f.nx - f.x, f.nz - f.z) > 4) { f.x = f.nx; f.z = f.nz; f.feet = f.nfeet; }
  const k = 1 - Math.exp(-dt * 16);
  f.x += (f.nx - f.x) * k; f.z += (f.nz - f.z) * k; f.feet += (f.nfeet - f.feet) * k;
  f.yaw += angDiff(f.yaw, f.nyaw) * k; f.pitch += (f.npitch - f.pitch) * k;
}
function buildSnap() {
  return {
    f: fighters.filter((f) => f.id >= 0).map((f) => [f.id, r2(f.x), r2(f.feet), r2(f.z), r2(f.yaw), r2(f.pitch), f.alive ? 1 : 0, Math.max(0, Math.round(f.hp)), f.kills, f.deaths, ORDER.indexOf(f.cur), r2(f.boost), r2(f.star), r2(f.slow), r2(f.slip), f.orbs, r2(f.orbT), f.onGround ? 1 : 0]),
    p: projectiles.map((p) => [p.id, p.type, r2(p.x), r2(p.y), r2(p.z), r2(p.vx || 0), r2(p.vy || 0), r2(p.vz || 0), p.owner ? p.owner.id : 0, p.t === Infinity ? -1 : r2(p.t), r2(p.arm || 0), p.sp || 0, p.target ? p.target.id : 0]),
    k: pickups.map((p) => (p.ready ? -1 : r2(Math.max(0, p.t)))),
    tl: r2(matchEnd - gameTime), ph: matchPhase === 'play' ? 1 : 0, et: r2(gameTime - endAt),
  };
}
function applySnap(sn) {
  for (const row of sn.f) {
    const f = byId(row[0]); if (!f) continue;
    if (f !== me) {
      const first = f.nx === undefined;
      f.nx = row[1]; f.nfeet = row[2]; f.nz = row[3]; f.nyaw = row[4]; f.npitch = row[5];
      if (first) { f.x = f.nx; f.feet = f.nfeet; f.z = f.nz; f.yaw = f.nyaw; }
      f.alive = !!row[6]; f.cur = ORDER[row[10]] || 'pistol'; f.onGround = !!row[17];
    } else if (!row[6] && me.alive) { me.alive = false; }
    f.hp = row[7]; f.kills = row[8]; f.deaths = row[9];
    f.boost = row[11]; f.star = row[12]; f.slow = row[13]; f.slip = row[14]; f.orbs = row[15]; f.orbT = row[16];
  }
  // projectiles : on affiche ce que l'hôte simule
  const seen = new Set();
  for (const row of sn.p) {
    seen.add(row[0]);
    let p = projectiles.find((q) => q.id === row[0]);
    if (!p) { p = addProj({ id: row[0], type: row[1], x: row[2], y: row[3], z: row[4], r: PROJ_R[row[1]] || 0.2, trail: 0 }); NET.projSeq = Math.max(NET.projSeq, row[0]); }
    Object.assign(p, { x: row[2], y: row[3], z: row[4], vx: row[5], vy: row[6], vz: row[7], owner: byId(row[8]), t: row[9] < 0 ? Infinity : row[9], arm: row[10], sp: row[11], target: byId(row[12]) });
  }
  for (let i = projectiles.length - 1; i >= 0; i--) if (!seen.has(projectiles[i].id)) removeProj(i);
  sn.k.forEach((t, i) => { const p = pickups[i]; if (!p) return; const ready = t < 0; if (ready !== p.ready) { p.ready = ready; p.show.visible = ready; } if (!ready) p.t = t; });
  matchEnd = gameTime + sn.tl; endAt = gameTime - sn.et;
  const ph = sn.ph ? 'play' : 'end';
  if (ph !== matchPhase) { matchPhase = ph; if (ph === 'end') showBoard(true); else $('board').hidden = true; }
}
// chez les autres joueurs, les projectiles avancent entre deux nouvelles de l'hôte
function mirrorProjectiles(dt) {
  for (const p of projectiles) {
    if (p.type === 'mine') continue;
    if (p.type === 'nade' || p.type === 'gl') p.vy -= (p.type === 'nade' ? 20 : GL.gravity) * dt;
    p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; p.z += (p.vz || 0) * dt;
    if (p.y < p.r) p.y = p.r;
    p.m.position.set(p.x, p.y, p.z);
    if (p.type === 'bomb') { p.ball.rotation.x += dt * (p.sp || 20) * 3; p.m.rotation.y = Math.atan2(p.vx || 0, p.vz || 1); p.fuse.material.color.setHex(Math.sin(gameTime * 20) > 0 ? 0xff7a59 : 0xffffff); }
    else if (p.type === 'missile' || p.type === 'gl') { const s = p.type === 'missile' ? -1 : 1; p.m.lookAt(p.x + s * (p.vx || 0), p.y + s * (p.vy || 0), p.z + s * (p.vz || 1)); }
    else if (p.type === 'nade') p.m.rotation.x += dt * 8;
  }
}
function giveWeapon(f, kind) {
  const W = WEAPONS[kind], have = f.weapons[kind];
  if (have) have.res = W.reserve; else f.weapons[kind] = { mag: W.mag, res: W.reserve };
  if (!have) { f.cur = kind; f.reloading = 0; }
  sfx.pickup(); toast(have ? W.name + ' : munitions' : W.name);
}
const ME = (id) => me && id === me.id;
// événements envoyés par l'hôte
function applyEvent(ev) {
  const t = ev[0];
  switch (t) {
    case 'b': burst(ev[1], ev[2], ev[3], ev[4], ev[5], ev[6], ev[7], ev[8] || undefined); break;
    case 'd': addDecal([ev[1], ev[2], ev[3]]); break;
    case 'p': puff(ev[1], ev[2], ev[3]); break;
    case 's': smoke(ev[1], ev[2], ev[3], ev[4]); break;
    case 't': {
      if (ME(ev[8])) break;
      tracer(new THREE.Vector3(ev[1], ev[2], ev[3]), new THREE.Vector3(ev[4], ev[5], ev[6]), ev[7]);
      checkWhizz([ev[1], ev[2], ev[3]], [ev[4], ev[5], ev[6]]);
      break;
    }
    case 'e': explosionFx(ev[1], ev[2], ev[3], ev[4]); break;
    case 'a': {
      const name = ev[1], a = ev[2], at = name === 'gun' ? 1 : 0, pos = a[at];
      if (pos) a[at] = { x: pos[0], y: pos[1], z: pos[2] };
      if ((name === 'gun' || name === 'slash' || name === 'ping') && pos && Math.hypot(pos[0] - me.x, pos[2] - me.z) < 1.0) break; // son de mon propre tir
      if (sfx[name]) sfx[name].apply(sfx, a);
      break;
    }
    case 'hm': if (ME(ev[1])) { hitmark(ev[2]); sfx.hit(ev[2] === 'head'); } break;
    case 'hurt': if (ME(ev[1])) onHurt([ev[2], ev[3]]); break;
    case 'kill': {
      const k = byId(ev[1]), v = byId(ev[2]);
      if (v) { v.alive = false; v.hp = 0; if (v === me) { me.ladder = null; me.respawnAt = gameTime + RULES.respawn; } }
      killFeedback(k, v, ev[3], !!ev[4]);
      break;
    }
    case 'sp': {
      const f = byId(ev[1]); if (!f) break;
      if (f === me) {
        Object.assign(me, { x: ev[2], z: ev[3], feet: 0, vx: 0, vz: 0, vy: 0, yaw: ev[4], pitch: 0, onGround: true, ladder: null, hp: 100, alive: true });
        resetLoadout(me); $('death').hidden = true; sfx.spawn();
      } else { f.x = f.nx = ev[2]; f.z = f.nz = ev[3]; f.feet = f.nfeet = 0; f.alive = true; }
      break;
    }
    case 'give': {
      if (!ME(ev[1])) break;
      if (ev[2] === 'item') { me.item = ev[3]; sfx.box(); toast('Bonus : ' + ITEMS[ev[3]].name); }
      else if (ev[2] === 'nade') { me.grenades = NADE.max; sfx.pickup(); toast('Grenades rechargées'); }
      else if (ev[2] === 'w') giveWeapon(me, ev[3]);
      break;
    }
    case 'toast': if (ME(ev[1])) toast(ev[2]); break;
    case 'start': for (const f of fighters) { f.kills = 0; f.deaths = 0; } matchPhase = 'play'; $('board').hidden = true; $('feed').innerHTML = ''; sfx.start(); break;
    case 'end': matchPhase = 'end'; endAt = gameTime; showBoard(true); break;
  }
}
// actions envoyées par un joueur à l'hôte
function applyInput(f, ev) {
  const t = ev[0];
  if (t === 'fire') fireNet(f, ev[1], ev[2]);
  else if (t === 'nade') { if (!f.alive) return; f.yaw = ev[1]; f.pitch = ev[2]; f.grenades = Math.max(f.grenades, 1); throwNade(f); }
  else if (t === 'use') { if (!f.alive || !ITEMS[ev[1]]) return; f.yaw = ev[2]; f.item = ev[1]; useItem(f); }
}
// devenir l'hôte (création de la partie, ou reprise si l'hôte part)
function becomeHost(fresh) {
  NET.host = true;
  if (fresh) { startMatch(); return; }
  for (const f of fighters) {
    if (f !== me && f.nx !== undefined) { f.x = f.nx; f.z = f.nz; f.feet = f.nfeet; }
    if (!f.alive) f.respawnAt = gameTime + 2;
    if (f !== me) f.item = null;
  }
  toast('Tu héberges maintenant la partie');
}
function netStatus(txt, err) { setText($('netStatus'), txt); $('netStatus').classList.toggle('err', !!err); }
function wsSend(m) { if (NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify(m)); }
function removeFighter(id) {
  const f = byId(id); if (!f || f === me) return;
  if (f.avatar) { scene.remove(f.avatar.g); for (const o of f.avatar.orbs) scene.remove(o); }
  fighters.splice(fighters.indexOf(f), 1);
}
function connect() {
  if (NET.ws && (NET.ws.readyState === 0 || NET.ws.readyState === 1)) return;
  const name = ($('pname').value || '').trim().slice(0, 16) || 'Joueur';
  lsSet('dedale-name', name);
  netStatus('Connexion au serveur…');
  $('play').disabled = true;
  let ws;
  try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); }
  catch (e) { netStatus('Impossible de joindre le serveur.', true); $('play').disabled = false; return; }
  NET.ws = ws;
  ws.onopen = () => wsSend({ t: 'join', room: ROOM, name });
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } try { onNet(m); } catch (err) { reportError(err.message); } };
  ws.onclose = () => {
    const was = NET.connected;
    NET.connected = false; NET.ws = null; $('play').disabled = false;
    if (was) { netStatus('Connexion perdue. Recharge la page pour revenir dans la partie.', true); mode = 'menu'; $('menu').hidden = false; unlock(); }
    else netStatus('Le serveur ne répond pas. Il se réveille peut-être : réessaie dans 30 secondes.', true);
  };
}
function onNet(m) {
  if (m.t === 'error') { netStatus(m.msg, true); return; }
  if (m.t === 'welcome') {
    NET.connected = true; $('play').disabled = false;
    me.id = m.id; me.name = m.you.name; me.color = m.you.color;
    for (const p of m.players) if (p.id !== me.id && !byId(p.id)) newFighter(p.id, p.name, p.color, false, true);
    netStatus('Connecté à la partie ' + ROOM + '.');
    started = true;
    if (m.host === me.id) becomeHost(true); else { NET.host = false; me.alive = false; }
    enterGame();
    return;
  }
  if (m.t === 'join') {
    if (!byId(m.p.id)) { const f = newFighter(m.p.id, m.p.name, m.p.color, false, true); if (NET.host) spawn(f); }
    toast(m.p.name + ' a rejoint la partie');
    return;
  }
  if (m.t === 'leave') {
    const f = byId(m.id); if (f) toast(f.name + ' a quitté la partie');
    removeFighter(m.id);
    if (m.host === me.id && !NET.host) becomeHost(false);
    return;
  }
  if (m.t === 'host') { if (m.id === me.id && !NET.host) becomeHost(false); else if (m.id !== me.id) NET.host = false; return; }
  if (m.t === 'h' && NET.host) { // message d'un joueur pour l'hôte
    const f = byId(m.from); if (!f) return;
    const d = m.d;
    if (d.st) { const s_ = d.st; f.nx = s_[0]; f.nfeet = s_[1]; f.nz = s_[2]; f.nyaw = s_[3]; f.npitch = s_[4]; f.vx = s_[5]; f.vz = s_[6]; f.onGround = !!s_[7]; if (ORDER[s_[8]]) f.cur = ORDER[s_[8]]; }
    if (d.i) for (const ev of d.i) applyInput(f, ev);
    return;
  }
  if (m.t === 'b' && !NET.host) { // nouvelles de l'hôte
    NET.applying = true;
    try { if (m.d.e) for (const ev of m.d.e) applyEvent(ev); } finally { NET.applying = false; }
    if (m.d.s) applySnap(m.d.s);
  }
}
if (ONLINE) {
  setInterval(() => {
    if (!NET.connected) return;
    if (NET.host) {
      wsSend({ t: 'b', d: { s: buildSnap(), e: NET.out } });
      NET.out = [];
    } else {
      const d = { st: [r2(me.x), r2(me.feet), r2(me.z), r2(me.yaw), r2(me.pitch), r2(me.vx), r2(me.vz), me.onGround ? 1 : 0, ORDER.indexOf(me.cur)] };
      if (NET.inq.length) { d.i = NET.inq; NET.inq = []; }
      wsSend({ t: 'h', d });
    }
  }, 50);
}

// ---------- boucle ----------
let mode = 'menu', started = false, locked = false, hadLock = false;
let last = performance.now(), menuT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  try { frame(now); } catch (e) { reportError(e.message); }
}
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (started && (mode === 'game' || ONLINE)) {
    const n = dt > 0.017 ? 2 : 1;
    for (let i = 0; i < n; i++) simulate(dt / n);
    updateCamera(dt);
    updateHud(dt);
  } else if (!started) {
    menuT += dt;
    const a = menuT * 0.05;
    camera.position.set(Math.sin(a) * 36, 19, Math.cos(a) * 36); camera.lookAt(0, 0, 0);
    for (const k of ORDER) viewmodels[k].visible = false;
  }
  updateAvatars(dt);
  if (mode !== 'game' || !started) updatePickupsFx(0);
  updateFx(dt);
  renderFrame();
}

// ---------- menus et entrées ----------
function lock() { const el = renderer.domElement; try { const r = el.requestPointerLock && el.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
function unlock() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {} }
function clearInput() { for (const k in keys) keys[k] = false; me.trigger = false; me.scoped = false; }
// partie privée en ligne : code dans l'adresse (#CODE)
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let ROOM = (location.hash || '').slice(1).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
if (ONLINE) {
  if (ROOM.length < 3) { ROOM = ''; for (let i = 0; i < 5; i++) ROOM += ALPHA[Math.floor(Math.random() * ALPHA.length)]; try { history.replaceState(null, '', '#' + ROOM); } catch (e) { location.hash = ROOM; } }
  const link = location.origin + location.pathname + '#' + ROOM;
  $('netBox').hidden = false; $('diffField').hidden = true;
  setText($('roomCode'), ROOM); setText($('linkBox'), link);
  $('pname').value = lsGet('dedale-name') || '';
  setText($('mLead'), 'Partie privée jusqu\u2019à 5 joueurs, chacun pour soi. Premier à 25 éliminations ou meilleur score au bout de 10 minutes. Envoie le lien à tes amis : ils arrivent directement dans ta partie.');
  setText($('mEyebrow'), 'En ligne · partie privée');
  $('copyLink').addEventListener('click', () => {
    const ok = () => netStatus('Lien copié. Colle-le à tes amis.');
    const ko = () => { const r = document.createRange(); r.selectNodeContents($('linkBox')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); netStatus('Lien sélectionné : copie-le avec Ctrl+C ou Cmd+C.'); };
    try { navigator.clipboard.writeText(link).then(ok, ko); } catch (e) { ko(); }
  });
  $('pname').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('play').click(); });
}
function enterGame() {
  mode = 'game'; $('menu').hidden = true; $('hud').hidden = false;
  camera.fov = baseFov; camera.updateProjectionMatrix();
  setText($('play'), 'Reprendre'); setText($('mEyebrow'), 'Partie ' + ROOM);
  last = performance.now(); lock();
}
function play() {
  initAudio();
  if (ONLINE) { if (!NET.connected) { connect(); return; } enterGame(); return; }
  if (!started) { started = true; startMatch(); }
  mode = 'game'; $('menu').hidden = true; $('hud').hidden = false;
  camera.fov = baseFov; camera.updateProjectionMatrix();
  setText($('mEyebrow'), 'Pause'); setText($('play'), 'Reprendre'); $('restart').hidden = false;
  last = performance.now(); lock();
}
function pause() {
  if (mode !== 'game') return;
  mode = 'menu'; clearInput(); $('menu').hidden = false;
}
$('play').addEventListener('click', play);
$('restart').addEventListener('click', () => { startMatch(); play(); });
$('again').addEventListener('click', () => { startMatch(); play(); });
for (const btn of $('diff').children) btn.addEventListener('click', () => { S.diff = +btn.dataset.v; saveOptions(); markDiff(); });
function markDiff() { for (const btn of $('diff').children) btn.setAttribute('aria-pressed', String(+btn.dataset.v === S.diff)); }
markDiff();
function bindOption(key, unit, digits) {
  const input = $(key), out = $(key + 'Out');
  input.value = S[key];
  const show = () => { out.textContent = S[key].toFixed(digits) + unit; };
  show();
  input.addEventListener('input', () => { S[key] = parseFloat(input.value); show(); saveOptions(); resize(); });
}
bindOption('sens', '', 1); bindOption('fov', '°', 0);
{
  const input = $('exposure'), out = $('exposureOut');
  input.value = S.exposure;
  const show = () => { out.textContent = Math.round(S.exposure * 100) + ' %'; };
  show();
  input.addEventListener('input', () => { S.exposure = parseFloat(input.value); renderer.toneMappingExposure = S.exposure; show(); saveOptions(); });
}
for (const btn of $('quality').children) btn.addEventListener('click', () => { S.quality = +btn.dataset.v; saveOptions(); markQuality(); applyQuality(); });
function markQuality() { for (const btn of $('quality').children) btn.setAttribute('aria-pressed', String(+btn.dataset.v === S.quality)); }
markQuality();

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (locked) hadLock = true;
  else if (mode === 'game' && hadLock && matchPhase === 'play') pause();
});
document.addEventListener('mousemove', (e) => {
  if (mode !== 'game' || (!locked && hadLock) || !me.alive) return;
  const k = S.sens * 0.001;
  me.yaw -= (e.movementX || 0) * k;
  me.pitch = clamp(me.pitch - (e.movementY || 0) * k, -1.55, 1.55);
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  if (mode !== 'game') return;
  if (!locked) { lock(); return; }
  if (e.button === 0) { me.trigger = true; fire(me); }
  if (e.button === 1) { e.preventDefault(); throwNade(me); }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) me.trigger = false; if (e.button === 2) me.scoped = false; });
document.addEventListener('wheel', (e) => {
  if (mode !== 'game' || !me.alive) return;
  const owned = ORDER.filter((k) => me.weapons[k]);
  const i = owned.indexOf(me.cur), n = owned.length;
  switchWeapon(me, owned[(i + (e.deltaY > 0 ? 1 : -1) + n) % n]);
}, { passive: true });
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && mode === 'game') { e.preventDefault(); if (!boardHeld) { boardHeld = true; if (matchPhase === 'play') showBoard(false); } return; }
  if (mode !== 'game') return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' && !keys.Space) me.jumpBuf = 0.18;
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'KeyR') startReload(me);
  if (e.code === 'KeyG') throwNade(me);
  if (e.code === 'KeyE') useItem(me);
  if (e.code === 'KeyM') showMap = !showMap;
  const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
  if (n >= 0 && me.alive) switchWeapon(me, ORDER[n]);
  if (e.code === 'KeyP' || (e.code === 'Escape' && !locked)) pause();
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') { boardHeld = false; if (matchPhase === 'play') $('board').hidden = true; }
});
window.addEventListener('blur', () => { clearInput(); boardHeld = false; if (matchPhase === 'play') $('board').hidden = true; });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  pause();
  // un hôte en arrière-plan ralentirait tout le monde : il passe la main
  if (ONLINE && NET.host && fighters.length > 1) wsSend({ t: 'yield' });
});

// accès de test (simulation accélérée)
window.__dedale = { NET, fighters, pickups, projectiles, fire, launchMissile, start: () => { started = true; startMatch(); }, sim: (sec) => { for (let t = 0; t < sec; t += 1 / 60) simulate(1 / 60); }, useItem, me };

requestAnimationFrame(loop);
})();
