// sb_avecVerrou_ ré-entrant (Stock_Boutique.gs) : un appel imbriqué ne relâche pas le verrou de l'appelant.
// Lancer : node tests/verrou/test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../apps-script/crm/Stock_Boutique.gs'), 'utf8');
const bloc = src.match(/var SB_VERROU_PROFONDEUR_ = 0;[\s\S]*?\r?\n}\r?\n/)[0];
let tenu = 0, prises = 0, relaches = 0;
const ctx = { LockService: { getScriptLock: () => ({ waitLock() { if (tenu) throw new Error('Lock timeout'); tenu = 1; prises++; }, releaseLock() { tenu = 0; relaches++; } }) } };
vm.createContext(ctx); vm.runInContext(bloc, ctx);
let ok = 0; const check = (c, m) => { assert(c, m); ok++; console.log('  ✓ ' + m); };
let pendant;
ctx.sb_avecVerrou_(() => { ctx.sb_avecVerrou_(() => 1); pendant = tenu; });
check(pendant === 1 && prises === 1 && relaches === 1 && tenu === 0, 'appel imbriqué : verrou pris une fois, toujours tenu après l\'appel interne, relâché une fois à la fin');
assert.throws(() => ctx.sb_avecVerrou_(() => { throw new Error('x'); }), /x/);
check(tenu === 0 && ctx.SB_VERROU_PROFONDEUR_ === 0, 'erreur dans la fonction : verrou relâché, compteur remis à 0');
// doPost : prend le verrou lui-même puis incrémente le compteur → un sb_avecVerrou_ appelé dedans ne relâche rien
tenu = 1; ctx.SB_VERROU_PROFONDEUR_++; ctx.sb_avecVerrou_(() => 1); const apres = tenu; ctx.SB_VERROU_PROFONDEUR_--; tenu = 0;
check(apres === 1, 'sous le verrou du doPost : sb_avecVerrou_ ne le relâche pas');
console.log(ok + ' contrôles OK');
