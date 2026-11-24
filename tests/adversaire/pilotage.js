// Test de pbAdversaire_() (Pilotage_Boutique.gs, bloc [pb-adversaire]) : même résultat que la tablette.
// Lancer : node tests/adversaire/pilotage.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const gs = fs.readFileSync(path.join(__dirname, '../../apps-script/Pilotage_Boutique.gs'), 'utf8');
const bloc = gs.match(/\/\/ \[pb-adversaire\][\s\S]*?\/\/ \[\/pb-adversaire\]/);
assert(bloc, 'bloc [pb-adversaire] introuvable');
const ctx = {}; vm.runInNewContext(bloc[0] + '\nthis.f=pbAdversaire_;', ctx);
const cas = [
  ["France Avenir vs Cannes & Spacer's vs Paris", 'Paris'],
  ["France Avenir vs Nantes & Spacer’s vs Nice", 'Nice'],
  ["Spacer’s vs Poitiers", 'Poitiers'],
  ["Spacer's Vs Narbonne - Samedi 10 Octobre", 'Narbonne'],
  ["Spacer's vs Saint-Nazaire", 'Saint-Nazaire'],
  ["Spacers vs Royan", 'Royan'],
  ["France Avenir Vs Evreux", ''],
  ["France Avenir / Spacer’s vs Tours", 'Tours'],
];
let ok = 0;
cas.forEach(([nom, adv]) => { const r = ctx.f(nom); assert.strictEqual(r, adv, nom + ' → « ' + r + ' » (attendu « ' + adv + ' »)'); ok++; console.log('OK  ' + nom + ' → ' + (r || '(vide)')); });
console.log(ok + ' cas OK');
