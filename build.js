// Reconstruit public/index.html à partir des sources (src/ et shared/maze.js).
// Usage : node build.js
'use strict';
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
let head = read('src/head.html');
if (!head.endsWith('<script>\n')) throw new Error('src/head.html doit se terminer par une balise <script> ouverte');
head = head.slice(0, -'<script>\n'.length);
const page = '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n'
  + head
  + '<script>window.DEDALE_MODELS = ' + read('src/weapons.json') + ';</script>\n'
  + '<script>window.DEDALE_CHAR = "' + read('src/character.b64').trim() + '";</script>\n'
  + '<script>window.DEDALE_ONLINE = true;</script>\n'
  + '<script>\n' + read('shared/maze.js') + read('src/game.js') + '</script>\n</body>\n</html>\n';
fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'public/index.html'), page);
console.log('public/index.html : ' + (page.length / 1e6).toFixed(1) + ' Mo');
