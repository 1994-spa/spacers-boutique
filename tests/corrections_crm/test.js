// Test de Corrections_CRM_20261124.gs sur maquette alimentée par l'export réel du CRM.
// Usage : node tests/corrections_crm/test.js [chemin/export_crm.xlsx]
// (l'export contient des données clients : il n'est pas versionné, il est converti à la volée)
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const { execFileSync } = require('child_process');
const { creerContexte } = require('../fichier_boutique/harnais');

const XLSX = process.argv[2] || '/home/claude/gc_work/data/crm.xlsx';
const CRM_DIR = path.join(__dirname, '../../apps-script/crm');
const EXPORT = JSON.parse(execFileSync('python3', ['-I', path.join(__dirname, 'export_json.py'), XLSX], { maxBuffer: 1 << 28 }).toString());
const B = "Spacer's vs Bordeaux", C = "Spacer's vs Cannes";

let ok = 0;
const check = (c, m) => { assert(c, m); ok++; console.log('  ✓ ' + m); };

/** Maquette : CRM chargé depuis l'export, Stock_Boutique + Fichier_Boutique + script de corrections. */
function monter(options) {
  const T = creerContexte();
  const { ctx, crm } = T;
  for (const nom of Object.keys(EXPORT)) {
    const sh = crm.insertSheet(nom);
    for (const k in EXPORT[nom]) {
      const v = EXPORT[nom][k];
      sh.g[k] = (v && v.$d) ? new Date(v.$d[0], v.$d[1] - 1, v.$d[2], v.$d[3], v.$d[4], v.$d[5]) : v;
    }
  }
  T.appels = [];
  ctx.reconstruireSaisons = () => T.appels.push('saisons');
  ctx.mettreAJourDashboard = () => T.appels.push('dashboard');
  ctx.logDiag = (s, n, m) => T.appels.push('diag:' + m);
  if (options && options.repriseAvant) {
    // État réel du 24/11 : reprise écrite avec l'ANCIENNE version (commit 9d0a4d1 : RV-05 en CB, RV-10 en « Bordeaux »)
    const ancien = execFileSync('git', ['show', '9d0a4d1:apps-script/crm/Reprise_Ventes_VIP.gs'], { cwd: path.join(__dirname, '../..') }).toString();
    vm.runInContext(ancien, ctx);
    vm.runInContext('rv_appliquer()', ctx);
  }
  vm.runInContext(fs.readFileSync(path.join(CRM_DIR, 'Corrections_CRM_20261124.gs'), 'utf8'), ctx);
  T.run = c => vm.runInContext(c, ctx);
  return T;
}

/** Instantané de toutes les cellules de tous les onglets. */
function photo(crm) {
  const o = {};
  crm.getSheets().forEach(s => { for (const k in s.g) o[s.name + '|' + k] = s.g[k] instanceof Date ? 'D' + s.g[k].getTime() : s.g[k]; });
  return o;
}
function diff(a, b) {
  const d = {};
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => { if (a[k] !== b[k]) d[k] = [a[k], b[k]]; });
  return d;
}
const colDe = (sh, nom) => sh.row(1, sh.getLastColumn()).map(x => String(x).trim()).indexOf(nom) + 1;
const nbAvec = (sh, nom, val) => { const c = colDe(sh, nom); let n = 0; for (let r = 2; r <= sh.getLastRow(); r++) if (sh.get(r, c) === val) n++; return n; };

// ───────────────────── Scénario A : export du 23/11 tel quel ─────────────────────
console.log('A. Export du 23/11 23h (avant la reprise VIP)');
{
  const T = monter(), { crm } = T;
  const V = crm.getSheetByName('01_VENTES'), M = crm.getSheetByName('11_MOUVEMENTS_STOCK'), L = crm.getSheetByName('20_VENTES_LIVE');
  check(nbAvec(V, 'match_associe', B) === 18 && nbAvec(M, 'match', B) === 13 && nbAvec(L, 'Match', B) === 10,
        'export : 18 / 13 / 10 lignes « ' + B + ' »');

  const p0 = photo(crm);
  const sim = T.run('cc_simuler()');
  check(Object.keys(diff(p0, photo(crm))).length === 0 && T.appels.length === 0, 'simulation : aucune cellule écrite, aucun recalcul');
  check(/01_VENTES : 18\b/.test(sim) && /11_MOUVEMENTS_STOCK : 13\b/.test(sim) && /20_VENTES_LIVE : 10\b/.test(sim) && /04_MATCHS : 1\b/.test(sim),
        'simulation : totaux 18 / 13 / 10 / 04_MATCHS 1');
  check(/21_LIGNES_LIVE : 0/.test(sim) && /17b_REMISES : 0/.test(sim) && /25_CONTROLES_CAISSE : onglet absent/.test(sim),
        'simulation : 21_LIGNES_LIVE 0, 17b_REMISES 0, 25_CONTROLES_CAISSE absent (signalé)');
  check(/RV-05-MAP-BLC-L-1010 absente/.test(sim), 'simulation : RV-05 absente de l\'export → signalée (pas d\'erreur)');
  check(/01_VENTES L153 \[match_associe\] : « Spacer's vs Bordeaux » → « Spacer's vs Cannes »/.test(sim), 'journal : onglet, ligne, colonne, avant → après');

  const app = T.run('cc_appliquer()');
  const d = diff(p0, photo(crm));
  const attendu = { '01_VENTES': 18, '11_MOUVEMENTS_STOCK': 13, '20_VENTES_LIVE': 10, '04_MATCHS': 1 };
  const parOnglet = {};
  Object.keys(d).forEach(k => { const o = k.split('|')[0]; parOnglet[o] = (parOnglet[o] || 0) + 1; });
  check(Object.keys(attendu).length === Object.keys(parOnglet).length && Object.keys(attendu).every(o => parOnglet[o] === attendu[o]), 'application : cellules modifiées par onglet = ' + JSON.stringify(parOnglet));
  check(Object.keys(d).every(k => {
    const [o, rc] = k.split('|'); const c = Number(rc.split(',')[1]); const sh = crm.getSheetByName(o);
    const [av, ap] = d[k];
    if (o === '04_MATCHS') return c === colDe(sh, 'club_visiteur') && av === 'Bordeaux' && ap === 'Cannes';
    const col = { '01_VENTES': 'match_associe', '11_MOUVEMENTS_STOCK': 'match', '20_VENTES_LIVE': 'Match' }[o];
    return c === colDe(sh, col) && av === B && ap === C;
  }), 'application : seules les colonnes match / club_visiteur changent, Bordeaux → Cannes');
  const intouches = ['04b_CALENDRIER', '17_RETRAITS', 'DATA_BILLETTERIE', '99_DIAGNOSTIC', '📊 TABLEAU DE BORD', '00_DASHBOARD', '03_PRODUITS'];
  check(intouches.every(o => !parOnglet[o]) && crm.getSheetByName('04b_CALENDRIER').get(5, 4) === "France Avenir vs Bordeaux & Spacer's vs Cannes",
        '04b_CALENDRIER, 17_RETRAITS, DATA_BILLETTERIE, 99_DIAGNOSTIC, dashboards, 03_PRODUITS intacts');
  check(T.appels[0] === 'saisons' && T.appels[1] === 'dashboard' && /^diag:CORRECTIONS APPLIQUÉES — 42/.test(T.appels[2]),
        'recalculs reconstruireSaisons + mettreAJourDashboard, puis log 99_DIAGNOSTIC');
  check(/CORRECTIONS APPLIQUÉES — 42 correction/.test(app), 'application : 42 corrections annoncées');

  const p1 = photo(crm); T.appels.length = 0;
  const app2 = T.run('cc_appliquer()');
  check(/— 0 correction/.test(app2) && Object.keys(diff(p1, photo(crm))).length === 0 && !T.appels.includes('saisons'),
        'seconde application : 0 changement, aucun recalcul');
  check(/04_MATCHS L5 : adversaire déjà « Cannes »/.test(app2), 'seconde application : 04_MATCHS reconnu comme déjà corrigé');
}

// ─────── Scénario B : état réel du 24/11 (reprise VIP déjà écrite par l'ancienne version) ───────
console.log('B. Après la reprise VIP du 24/11 (RV-05 en CB, RV-10 en « Bordeaux »)');
{
  const T = monter({ repriseAvant: true }), { crm } = T;
  const V = crm.getSheetByName('01_VENTES');
  const cCmd = colDe(V, 'commande'), cMode = colDe(V, 'mode_paiement'), cCA = colDe(V, 'CA'), cQ = colDe(V, 'quantite');
  const rv05 = V.find(cCmd, 'RV-05-MAP-BLC-L-1010', 2);
  check(rv05 > 0 && V.get(rv05, cMode) === 'CB' && nbAvec(V, 'match_associe', B) === 19, 'avant : RV-05 en CB, 19 lignes Bordeaux (18 + RV-10)');
  const ligneAvant = V.row(rv05, V.getLastColumn());
  const p0 = photo(crm);
  const sim = T.run('cc_simuler()');
  check(Object.keys(diff(p0, photo(crm))).length === 0, 'simulation : rien écrit');
  check(/RV-05 mode_paiement\) : 1/.test(sim) && /01_VENTES : 19\b/.test(sim), 'simulation : RV-05 1, 01_VENTES 19');
  T.run('cc_appliquer()');
  const d = diff(p0, photo(crm));
  check(Object.keys(d).length === 44, 'application : 44 cellules (01_VENTES 19 dont RV-10, 13, 10, 04_MATCHS 1, RV-05 1)');
  const ligneApres = V.row(rv05, V.getLastColumn());
  check(ligneApres[cMode - 1] === 'Facture LEAD F202610-301' && ligneApres[cCA - 1] === 62 && ligneApres[cQ - 1] === 1 &&
        ligneApres.every((x, i) => i === cMode - 1 || x === ligneAvant[i]), 'RV-05 : mode = Facture LEAD F202610-301, CA 62 € et reste de la ligne inchangés');
  check(!Object.keys(d).some(k => /^(03_PRODUITS|11_MOUVEMENTS_STOCK)\|/.test(k) && !/,11$/.test(k)), 'aucun stock touché (03_PRODUITS intact, 11_ seulement la colonne match)');
  const p1 = photo(crm);
  check(/— 0 correction/.test(T.run('cc_appliquer()')) && Object.keys(diff(p1, photo(crm))).length === 0, 'seconde application : 0 changement');
}

// ─────────────────────────── Scénario C : garde-fous ───────────────────────────
console.log('C. Garde-fous');
{
  const T = monter(), { crm, ctx } = T;
  const M = crm.getSheetByName('11_MOUVEMENTS_STOCK');
  const r = M.getLastRow() + 1;
  M.set(r, colDe(M, 'horodatage'), new Date(2026, 10, 30, 20, 0, 0)); M.set(r, colDe(M, 'match'), B);
  const p0 = photo(crm);
  const app = T.run('cc_appliquer()');
  check(M.get(r, colDe(M, 'match')) === B && /11_MOUVEMENTS_STOCK L\d+ : « Spacer's vs Bordeaux » daté du 2026-11-30/.test(app),
        'ligne « Bordeaux » datée d\'un autre jour : signalée, non modifiée');
  check(Object.keys(diff(p0, photo(crm))).length === 42, 'les 42 cellules du 24/10 corrigées quand même');

  const T2 = monter(); const p2 = photo(T2.crm);
  T2.crm.getSheetByName('20_VENTES_LIVE').set(1, colDe(T2.crm.getSheetByName('20_VENTES_LIVE'), 'Match'), 'Rencontre');
  const p2b = photo(T2.crm);
  assert.throws(() => T2.run('cc_appliquer()'), /Colonne « Match » absente de 20_VENTES_LIVE/);
  check(Object.keys(diff(p2b, photo(T2.crm))).length === 0, 'colonne requise absente : erreur claire, rien écrit');

  const T3 = monter(); T3.crm.deleteSheet(T3.crm.getSheetByName('04_MATCHS')); const p3 = photo(T3.crm);
  assert.throws(() => T3.run('cc_appliquer()'), /Onglet 04_MATCHS introuvable/);
  check(Object.keys(diff(p3, photo(T3.crm))).length === 0, 'onglet requis absent : erreur claire, rien écrit');

  const T4 = monter(); const p4 = photo(T4.crm); T4.ctx.__verrouOccupe = true;
  assert.throws(() => T4.run('cc_appliquer()'), /Lock timeout/);
  check(Object.keys(diff(p4, photo(T4.crm))).length === 0, 'verrou occupé (tablette en cours d\'envoi) : rien écrit');

  const T5 = monter(); const autre = T5.ctx.SpreadsheetApp.create('Autre classeur'); T5.ctx.SpreadsheetApp.setActiveSpreadsheet(autre);
  const p5 = photo(T5.crm);
  T5.run('cc_appliquer()');
  check(Object.keys(diff(p5, photo(T5.crm))).length === 42, 'classeur actif ≠ CRM : CRM ouvert par son id, corrections appliquées');
}
console.log(ok + ' contrôles OK');
