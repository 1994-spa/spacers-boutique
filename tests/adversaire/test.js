// Test de infoMatchTickie() extraite telle quelle de index.html (bloc [match-tickie]).
// Lancer : TZ=Europe/Paris node tests/adversaire/test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const bloc = html.match(/\/\/ \[match-tickie\][\s\S]*?\/\/ \[\/match-tickie\]/);
assert(bloc, 'bloc [match-tickie] introuvable dans index.html');
const ctx = {}; vm.runInNewContext(bloc[0] + '\nthis.f=infoMatchTickie;', ctx);
const f = ctx.f;
const cas = [
  // nom Tickie, début Tickie (UTC), adversaire, libellé, heure attendue (Paris)
  ["France Avenir vs Cannes & Spacer's vs Paris", '2026-11-28T13:00:00Z', 'Paris', "Spacer's vs Paris", '18:00'],
  ["France Avenir vs Bordeaux & Spacer's vs Cannes", '2026-10-24T12:00:00Z', 'Cannes', "Spacer's vs Cannes", '18:00'],
  ["France Avenir vs Nantes & Spacer's vs Nice", '2026-12-05T13:00:00Z', 'Nice', "Spacer's vs Nice", '18:00'],
  ["Spacer's Vs Sète", '2026-11-21T19:00:00Z', 'Sète', "Spacer's vs Sète", '20:00'],
  ["Spacer's Vs Narbonne - Samedi 10 Octobre", '2026-10-10T18:00:00Z', 'Narbonne', "Spacer's vs Narbonne", '20:00'],
  ["Spacer’s vs Chaumont", '2026-12-12T19:00:00Z', 'Chaumont', "Spacer's vs Chaumont", '20:00'],
  ["France Avenir Vs Evreux", '2026-11-14T13:00:00Z', 'Evreux', "Spacer's vs Evreux", '14:00'], // pas de double affiche : inchangé
  ["France Avenir / Spacer’s vs Tours", '2026-11-21T13:00:00Z', 'Tours', "Spacer's vs Tours", '18:00'],
  ["Spacer's vs Saint-Nazaire", '2026-11-07T19:00:00Z', 'Saint-Nazaire', "Spacer's vs Saint-Nazaire", '20:00'],
];
let ko = 0;
for (const [nom, date, adv, label, heure] of cas) {
  const r = f(nom, date);
  const ok = r.adv === adv && r.label === label && r.heure === heure;
  if (!ok) ko++;
  console.log((ok ? 'OK  ' : 'KO  ') + nom + ' → ' + JSON.stringify({ adv: r.adv, label: r.label, heure: r.heure, double: r.double }));
}
console.log(ko ? ko + ' échec(s)' : 'Tous les cas passent (' + cas.length + ')');
process.exit(ko ? 1 : 0);
