// Lance tous les tests : node tests/tout.js   (fuseau Europe/Paris imposé)
const { spawnSync } = require('child_process'), path = require('path');
const T = ['caisse/test.js', 'adversaire/test.js', 'adversaire/pilotage.js', 'fichier_boutique/scenario.js', 'fichier_boutique/reprise.js',
           'cloture/test.js', 'verrou/test.js', 'import_session/test.js', 'corrections_crm/test.js'];
let ko = 0;
for (const t of T) {
  const r = spawnSync(process.execPath, [path.join(__dirname, t)], { env: Object.assign({}, process.env, { TZ: 'Europe/Paris' }), encoding: 'utf8' });
  const der = (r.stdout || '').trim().split('\n').pop();
  if (r.status === 0) console.log('OK  ' + t + ' — ' + der);
  else { ko++; console.log('KO  ' + t + '\n' + (r.stdout || '').split('\n').slice(-5).join('\n') + (r.stderr || '').split('\n').slice(0, 8).join('\n')); }
}
console.log(ko ? ko + ' fichier(s) en échec' : 'Tous les tests passent');
process.exit(ko ? 1 : 0);
