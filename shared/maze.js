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

  function build() {
    const N = 10, C = 5, TH = 2.2, H = 3.2, HALF = N * C / 2;
    const rnd = mulberry32(2026);
    const hW = [], vW = []; // hW[r][c] : mur horizontal sur z = r*C ; vW[r][c] : mur vertical sur x = c*C
    for (let r = 0; r <= N; r++) { hW[r] = []; for (let c = 0; c < N; c++) hW[r][c] = true; }
    for (let r = 0; r < N; r++) { vW[r] = []; for (let c = 0; c <= N; c++) vW[r][c] = true; }

    // labyrinthe parfait par exploration en profondeur
    const seen = [];
    for (let r = 0; r < N; r++) seen[r] = new Array(N).fill(false);
    const stack = [[0, 0]]; seen[0][0] = true;
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
    while (removed < 14) {
      if (rnd() < 0.5) { const r = 1 + Math.floor(rnd() * (N - 1)), c = Math.floor(rnd() * N); if (hW[r][c]) { hW[r][c] = false; removed++; } }
      else { const r = Math.floor(rnd() * N), c = 1 + Math.floor(rnd() * (N - 1)); if (vW[r][c]) { vW[r][c] = false; removed++; } }
    }
    // place centrale 2×2
    const m = N / 2;
    hW[m][m - 1] = hW[m][m] = false; vW[m - 1][m] = vW[m][m] = false;

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

    // 16 échelles, une par bloc d'une grille 4×4
    const ladders = [];
    const addLadder = (x, z, nx, nz) => ladders.push({ x, z, nx, nz, tx: nz, tz: -nx });
    const lr = mulberry32(99);
    const cut = (i) => Math.floor(i * N / 4);
    for (let bi = 0; bi < 4; bi++) for (let bj = 0; bj < 4; bj++) {
      const br = cut(bi), bh = cut(bi + 1) - br, bc = cut(bj), bw = cut(bj + 1) - bc;
      for (let tries = 0; tries < 20; tries++) {
        const r = br + Math.floor(lr() * bh), c = bc + Math.floor(lr() * bw);
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

    // petits blocs de décor posés dans les angles des cases (on peut sauter dessus)
    const props = [];
    const pr = mulberry32(404), P = 0.8;
    for (let tries = 0; props.length < 14 && tries < 400; tries++) {
      const r = Math.floor(pr() * N), c = Math.floor(pr() * N);
      if ((r < 1 && c < 1) || (Math.abs(r - (m - 0.5)) < 1 && Math.abs(c - (m - 0.5)) < 1)) continue;
      const left = pr() < 0.5, top = pr() < 0.5;
      const size = P * (0.85 + pr() * 0.4), h = size * (0.9 + pr() * 0.3);
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
      spawns.push({ x: wx(c) + C / 2, z: wz(r) + C / 2 });
    }

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

    return { N, C, TH, H, HALF, hW, vW, obstacles, ladders, spawns, props, collide, groundAt, rayBox, rayWorld, wx, wz, mulberry32 };
  }

  return { build };
});
