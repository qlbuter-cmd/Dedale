// Reconstruit public/index.html à partir des sources (src/ et shared/maze.js).
// Usage : node build.js
'use strict';
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const zlib = require('zlib');
// modèles 3D compressés en gzip (le jeu les décompresse au chargement) : la page reste sous 16 Mo
const gz = (b64) => zlib.gzipSync(Buffer.from(b64.trim(), 'base64'), { level: 9 }).toString('base64');
const gzFile = (p) => zlib.gzipSync(fs.readFileSync(path.join(__dirname, p)), { level: 9 }).toString('base64');
let head = read('src/head.html');
if (!head.endsWith('<script>\n')) throw new Error('src/head.html doit se terminer par une balise <script> ouverte');
head = head.slice(0, -'<script>\n'.length);
const page = '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n'
  + head
  + '<script>window.DEDALE_MODELS = ' + read('src/weapons.json') + ';</script>\n'
  + '<script>window.DEDALE_CHARS = { nico: "' + gz(read('src/nico.b64')) + '", anto: "' + gz(read('src/anto.b64')) + '", dav: "' + gz(read('src/dav.b64')) + '", marc: "' + gz(read('src/marc.b64')) + '", jul: "' + gz(read('src/jul.b64')) + '" };</script>\n'
  + '<script>window.DEDALE_AVATARS = { nico: "data:image/jpeg;base64,' + read('src/nico.jpg.b64').trim() + '", anto: "data:image/jpeg;base64,' + read('src/anto.jpg.b64').trim() + '", dav: "data:image/jpeg;base64,' + read('src/dav.jpg.b64').trim() + '", marc: "data:image/jpeg;base64,' + read('src/marc.jpg.b64').trim() + '", jul: "data:image/jpeg;base64,' + read('src/jul.jpg.b64').trim() + '" };</script>\n'
  + '<script>window.DEDALE_STAR = "' + read('src/star.b64').trim() + '";</script>\n'
  + '<script>window.DEDALE_THEME = "' + read('src/theme.b64').trim() + '";</script>\n'
  + '<script>window.DEDALE_DUEL = "' + read('src/duel.b64').trim() + '";</script>\n'
  + '<script>window.DEDALE_ARMS = "' + gz(read('src/arms.b64')) + '";</script>\n'
  + '<script>window.DEDALE_SFX = ' + read('src/sfx.json') + ';</script>\n'
  + '<script>window.DEDALE_FISTS = "' + gz(read('src/fists.b64')) + '";</script>\n'
  + '<script>window.DEDALE_TOUJANE = "' + gzFile('src/toujane.glb') + '";</script>\n'
  + '<script>window.DEDALE_TOUJANE_COL = ' + read('src/toujane-col.json') + ';</script>\n'
  + (process.argv[2] === 'solo' ? '' : '<script>window.DEDALE_ONLINE = true;</script>\n')
  + '<script>\n' + read('shared/maze.js') + read('src/game.js') + '</script>\n</body>\n</html>\n';
fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
const out = process.argv[2] === 'solo' ? (process.argv[3] || 'solo.html') : path.join(__dirname, 'public/index.html');
fs.writeFileSync(out, page);
console.log(out + ' : ' + (page.length / 1e6).toFixed(1) + ' Mo');
