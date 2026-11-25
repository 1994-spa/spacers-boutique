// Tests de Cloture_Match.gs (verrou avant eb_appliquer, terminaux CB, rapport de clôture) sur la maquette du CRM.
// Lancer : node tests/cloture/test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { creerContexte } = require('../fichier_boutique/harnais');
const GS = fs.readFileSync(path.join(__dirname, '../../apps-script/crm/Cloture_Match.gs'), 'utf8');
let ok = 0;
const check = (c, m) => { assert(c, m); ok++; console.log('  ✓ ' + m); };

function monter() {
  const T = creerContexte(), { ctx, crm } = T;
  vm.runInContext(GS, ctx);
  const V = crm.insertSheet('01_VENTES');
  V.appendRow(['date', 'source', 'commande', 'email', 'produit', 'categorie', 'quantite', 'prix_unitaire', 'CA', 'match_associe', 'boutique_id', 'saison', 'mode_paiement']);
  const L = crm.insertSheet('21_LIGNES_LIVE');
  L.appendRow(['ID vente', 'Horodatage', 'ID événement Tickie', 'Boutique', 'Réf.', 'Produit', 'Catégorie', 'Qté', 'PU TTC', 'CA TTC', 'Mode']);
  const TR = crm.insertSheet('24_TRANSFERTS_LIVE');
  TR.appendRow(['Reçu le', 'Horodatage', 'Remis le', 'ID transfert', 'De', 'Vers', 'Réf.', 'Produit', 'Qté', 'Motif', 'Match', 'Session', 'Bénévole', 'ID vente', 'ID événement Tickie', 'appliqué']);
  const CAL = crm.insertSheet('04b_CALENDRIER');
  CAL.appendRow(['ID événement Tickie', 'Date', 'Heure', 'Match', "Adversaire Spacer's", 'Statut', 'Tablettes', 'Jauge']);
  CAL.appendRow(['ev1', new Date(2026, 10, 28), '18:00', "France Avenir vs Cannes & Spacer's vs Paris", 'Paris', '', '✅ tablettes', 4300]);
  return Object.assign(T, { V, L, TR, CAL, run: c => vm.runInContext(c, ctx) });
}
const MATCH = "Spacer's vs Paris";
const d = (h, m) => new Date(2026, 10, 28, h, m || 0);

// Une session tablette telle que la v20 l'envoie (index.html : tpe et bénévole sur chaque ligne, contrôle de clôture)
function session(b, id) {
  return {
    session: { id, boutique_id: b, match_label: MATCH, date: '2026-11-28', benevole: 'Lucie',
      controle: { ts: d(21, 30).toISOString(), saisi_par: 'Lucie', fond: 30, cb_tablette: b === 'B1' ? 175.65 : 15, esp_tablette: b === 'B1' ? 14.25 : 0,
        tpe: b === 'B1' ? [{ tpe: '2668544-001', cb_tablette: 118.65, tickets: 3, tpe_saisi: 118.65 }, { tpe: '2668543-001', cb_tablette: 57, tickets: 1, tpe_saisi: '' }]
                        : [{ tpe: '6053438-002', cb_tablette: 15, tickets: 1, tpe_saisi: 14 }],
        esp_comptees_tiroir: b === 'B1' ? 44.25 : 30 } },
    ventes: b === 'B1' ? [
      { id: 'v1', timestamp: d(16, 40).toISOString(), produit_nom: 'Écharpe', quantite: 1, ca_ligne: 14.25, mode_paiement: 'CB', tpe: '2668544-001', benevole: 'Lucie' },
      { id: 'v2', timestamp: d(16, 45).toISOString(), produit_nom: 'Maillot Blanc - M', quantite: 1, ca_ligne: 55.8, mode_paiement: 'CB', tpe: '2668544-001' },
      { id: 'v3', timestamp: d(17, 5).toISOString(), produit_nom: 'Polo femme - L', quantite: 1, ca_ligne: 48.6, mode_paiement: 'CB', tpe: '2668544-001' },
      { id: 'v4', timestamp: d(17, 10).toISOString(), produit_nom: 'Sweat - M', quantite: 1, ca_ligne: 57, mode_paiement: 'CB', tpe: '2668543-001' },
      { id: 'v5', timestamp: d(17, 20).toISOString(), produit_nom: 'Écharpe', quantite: 1, ca_ligne: 14.25, mode_paiement: 'Espèces' },
      { id: 'v6', timestamp: d(17, 30).toISOString(), produit_nom: 'Gourde', quantite: 1, ca_ligne: 0, mode_paiement: 'Offert' },
    ] : [
      { id: 'w1', timestamp: d(19, 0).toISOString(), produit_nom: 'Écharpe', quantite: 1, ca_ligne: 15, mode_paiement: 'CB', tpe: '6053438-002' },
    ],
  };
}
// Ce que importSessionDepuisTablet écrit dans 01_VENTES (clé = session.id + '_' + vente.id)
function versVentes(T, p) {
  p.ventes.forEach(v => T.V.appendRow([new Date(v.timestamp), 'tablette', p.session.id + '_' + v.id, '', v.produit_nom, '', v.quantite, v.ca_ligne, v.ca_ligne, MATCH, p.session.boutique_id, '2026-2027', v.mode_paiement]));
}
function versLive(T, p) {
  p.ventes.forEach(v => T.L.appendRow([v.id, new Date(v.timestamp), 'ev1', p.session.boutique_id, '', v.produit_nom, '', v.quantite, v.ca_ligne, v.ca_ligne, v.mode_paiement]));
}

console.log('1. Verrou avant eb_appliquer');
{
  const T = monter();
  const s1 = session('B1', 'sGP'), s2 = session('B2', 'sVIP');
  versLive(T, s1); versLive(T, s2);       // ventes reçues en direct par le pilotage
  versVentes(T, s1);                       // seule la GP a fait « Synchroniser tout »
  const apres = 'new Date(2026, 10, 29, 10, 0)';
  assert.throws(() => T.run('cm_gardeAvantEb_(' + apres + ')'), /eb_appliquer REFUSÉ — 1 article\(s\) Boutique VIP du 2026-11-28 pas encore synchronisé/);
  check(true, 'VIP pas synchronisée : eb_appliquer refusé, message clair');
  versVentes(T, s2);
  check(T.run('cm_gardeAvantEb_(' + apres + ')') === true, 'les deux tablettes synchronisées : eb_appliquer autorisé');
  T.TR.appendRow([d(18), d(18), d(18), 'T1', 'B1', 'B2', 'ECH-TU', 'Écharpe', 2, 'reassort', MATCH, 'sGP', 'Lucie', '', 'ev1', '']);
  assert.throws(() => T.run('cm_gardeAvantEb_(' + apres + ')'), /1 transfert\(s\) GP ↔ VIP pas encore appliqué/);
  check(true, 'transfert reçu non appliqué : refusé');
  T.TR.set(2, 16, '✓ appliqué');
  check(T.run('cm_gardeAvantEb_(' + apres + ')') === true, 'transfert appliqué : autorisé');
  assert.throws(() => T.run('cm_gardeAvantEb_(new Date(2026, 10, 28, 19, 0))'), /match en cours \(Spacer's vs Paris à 18:00\)/);
  check(true, 'pendant le match (19 h) : refusé même si tout est synchronisé');
  check(T.run('cm_gardeAvantEb_(new Date(2026, 10, 28, 21, 5))') === true, 'après 21 h (18 h + 3 h) et tout synchronisé : autorisé le soir même');
  check(/^✅/.test(T.run('cm_verifierAvantEb()')), 'cm_verifierAvantEb (à la main) : même contrôle, réponse lisible');
  // vente synchronisée mais jamais reçue en direct (pilotage absent) : « En boutique » pas décompté → eb la remettrait en stock
  T.V.appendRow([d(20), 'tablette', 'sGP_zz', '', 'Écharpe', '', 2, 15, 30, MATCH, 'B1', '2026-2027', 'CB']);
  assert.throws(() => T.run('cm_gardeAvantEb_(' + apres + ')'), /2 article\(s\) Boutique GP du 2026-11-28 synchronisé\(s\) mais pas encore reçu\(s\) en direct/);
  check(true, 'vente jamais reçue en direct : refusé (sinon eb_appliquer annulerait la vente dans le stock)');
  T.props.CM_JOURS_VERIFIES = '2026-11-28|B1';
  check(T.run('cm_gardeAvantEb_(' + apres + ')') === true, 'jour régularisé à la main et déclaré (CM_JOURS_VERIFIES) : autorisé');
  T.L.appendRow(['d1', d(17), 'ev1', 'B1', 'DIVERS', 'Divers – bonnet', '', 1, 12, 12, 'CB']);
  check(T.run('cm_gardeAvantEb_(' + apres + ')') === true, 'article hors catalogue reçu en direct : ne bloque pas (il n\'a pas de stock)');
}

console.log('2. Terminaux CB et contrôle de clôture (cm_apresImport_)');
const T = monter();
const s1 = session('B1', 'sGP'), s2 = session('B2', 'sVIP');
[s1, s2].forEach(p => { versLive(T, p); versVentes(T, p); });
T.ctx.__p1 = s1; T.ctx.__p2 = s2;
const r1 = T.run('cm_apresImport_(__p1)'), r2 = T.run('cm_apresImport_(__p2)');
const TP = T.crm.getSheetByName('26_VENTES_TPE'), CL = T.crm.getSheetByName('26b_CLOTURES_TABLETTE');
check(r1.tpe === 6 && r2.tpe === 1 && TP.getLastRow() === 8, '26_VENTES_TPE : 7 lignes (une par ligne de vente)');
check(TP.get(2, 1) === 'sGP_v1' && TP.get(2, 11) === '2668544-001' && TP.get(2, 6) === 'Lucie', 'clé identique à 01_VENTES, terminal et bénévole enregistrés');
check(r1.cloture === 3 && r2.cloture === 2 && CL.getLastRow() === 6, '26b_CLOTURES_TABLETTE : 2 terminaux + espèces (GP), 1 terminal + espèces (VIP)');
const espGP = CL.find(8, 'Espèces (net du fond de 30 €)', 2);
check(espGP > 0 && CL.get(espGP, 11) === 14.25 && CL.get(espGP, 12) === 0, 'espèces GP : tiroir 44,25 − fond 30 = 14,25 € compté, écart 0');
const again = T.run('cm_apresImport_(__p1)');
check(again.tpe === 0 && again.cloture === 0 && TP.getLastRow() === 8 && CL.getLastRow() === 6, 'rejeu de la même session : rien en double (idempotent)');

console.log('3. Rapport de clôture');
{
  const R = T.run('cm_calculerCloture_(SpreadsheetApp.getActive(), "' + MATCH + '")');
  const gp = R.boutiques.find(b => b.boutique === 'B1'), vip = R.boutiques.find(b => b.boutique === 'B2');
  check(gp.ca === 189.9 && gp.cb === 175.65 && gp.esp === 14.25 && gp.offerts === 1 && gp.sessions === 1, 'GP : CA 189,90 € = CB 175,65 € + espèces 14,25 €, 1 offert (au centime)');
  check(vip.ca === 15 && vip.cb === 15, 'VIP : 15 € CB');
  const tGP = R.terminaux.find(t => t.terminal === '2668544-001'), tB2 = R.terminaux.find(t => t.terminal === '2668543-001'), tV = R.terminaux.find(t => t.terminal === '6053438-002');
  check(tGP.tablette === 118.65 && tGP.compte === 118.65 && tGP.ecart === 0 && tGP.source === 'ticket saisi sur la tablette', 'D177 GP : 118,65 € tablette = ticket, écart 0');
  check(tB2.tablette === 57 && tB2.ecart === null && /réaffecter/.test(tB2.note), 'D177 Buvette 2 : 57 € de ventes boutique signalés à réaffecter (pas d\'écart calculé : terminal partagé)');
  check(tV.ecart === -1, 'A920 VIP : ticket 14 € vs 15 € tablette → écart −1,00 € (signé)');
  check(/❌ CLÔTURE À FINIR/.test(R.resume) && /A920 Boutique VIP : écart -1,00 €/.test(R.resume) && /télécollecte non saisie/.test(R.resume) === false, 'verdict : à finir à cause de l\'écart VIP (tolérance CB 0 €)');
  check(R.actions.some(a => /D177 Buvette 2 : 57,00 €/.test(a)), 'action : réaffecter 57 € du D177 Buvette 2 vers la boutique');
  // la télécollecte (PDF) prime sur le ticket saisi sur la tablette
  T.run('cm_rapportCloture("' + MATCH + '")');
  const TL = T.crm.getSheetByName('28_TELECOLLECTES');
  check(TL && TL.getLastRow() === 1, '28_TELECOLLECTES créé vide pour la saisie');
  TL.appendRow([new Date(2026, 10, 28), '6053438-002', 'A920 Boutique VIP', 15, 1, 'PDF télécollecte 29/11', 'Clément', '']);
  const R2 = T.run('cm_calculerCloture_(SpreadsheetApp.getActive(), "' + MATCH + '")');
  check(R2.terminaux.find(t => t.terminal === '6053438-002').ecart === 0 && R2.terminaux.find(t => t.terminal === '6053438-002').source === 'télécollecte', 'télécollecte saisie : prime sur le ticket tablette, écart 0');
  check(/✅ CLÔTURE CONFORME/.test(R2.resume), 'tout rapproché : clôture conforme (actions à faire listées à part)');
  const sh = T.crm.getSheetByName('27_CLOTURE_MATCH');
  check(sh && /CLÔTURE DE MATCH/.test(sh.get(1, 1)), '27_CLOTURE_MATCH écrit');
  // vente non synchronisée → clôture à finir
  T.L.appendRow(['x9', d(20), 'ev1', 'B2', '', 'Écharpe', '', 1, 15, 15, 'CB']);
  const R3 = T.run('cm_calculerCloture_(SpreadsheetApp.getActive(), "' + MATCH + '")');
  check(/Boutique VIP : 1 article\(s\) pas synchronisé/.test(R3.resume), 'une vente VIP encore dans la tablette : clôture à finir');
  // vente CB d'avant la v20 (sans terminal)
  T.V.appendRow([d(20, 30), 'tablette', 'sOld_z1', '', 'Écharpe', '', 1, 15, 15, MATCH, 'B2', '2026-2027', 'CB']);
  T.ctx.__p3 = { session: { id: 'sOld', boutique_id: 'B2', match_label: MATCH }, ventes: [{ id: 'z1', timestamp: d(20, 30).toISOString(), produit_nom: 'Écharpe', quantite: 1, ca_ligne: 15, mode_paiement: 'CB' }] };
  T.run('cm_apresImport_(__p3)');
  const R4 = T.run('cm_calculerCloture_(SpreadsheetApp.getActive(), "' + MATCH + '")');
  check(/CB sans terminal indiqué : 15,00 €/.test(R4.resume), 'vente CB sans terminal (ancienne version) : signalée');
}
console.log(ok + ' contrôles OK');
