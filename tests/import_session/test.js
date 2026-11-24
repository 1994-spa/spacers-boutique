// doPost « import_session » de bout en bout (CRM_Boutique_V3.gs + Stock_Boutique.gs + Cloture_Match.gs) :
// idempotence au rejeu, stock décompté une fois, article retrouvé par sa référence après un renommage,
// DIVERS sans mouvement de stock, terminal CB enregistré à côté de 01_VENTES (format inchangé).
// Lancer : node tests/import_session/test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { creerContexte } = require('../fichier_boutique/harnais');
const DIR = path.join(__dirname, '../../apps-script/crm');
const T = creerContexte(), { ctx, crm } = T;
Object.assign(ctx, {
  ContentService: { createTextOutput: t => ({ t, setMimeType() { return JSON.parse(this.t); } }), MimeType: { JSON: 'json' } },
});
ctx.Session.getScriptTimeZone = () => 'Europe/Paris';
ctx.SpreadsheetApp.getActiveSpreadsheet = ctx.SpreadsheetApp.getActive;
vm.runInContext(fs.readFileSync(DIR + '/CRM_Boutique_V3.gs', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(DIR + '/Cloture_Match.gs', 'utf8'), ctx);
['reconstruireSaisons', 'analyserProduits', 'mettreAJourDashboard', 'rafraichirSynthese_'].forEach(f => { ctx[f] = () => {}; });
let ok = 0; const check = (c, m) => { assert(c, m); ok++; console.log('  ✓ ' + m); };

const P = crm.insertSheet('03_PRODUITS');
P.appendRow(['produit', 'categorie', 'prix_vente', 'cout', 'stock_B1', 'stock_B2', 'actif', 'ref_boutique', 'modele', 'taille', 'seuil_alerte', 'stock_R']);
P.appendRow(['Écharpe', 'Accessoires', 15, 7, 16, 6, true, 'ECH-TU', 'Écharpe', 'TU', 3, 119]);
P.appendRow(['Maillot Blanc - M', 'Maillots', 62, 30, 4, 0, true, 'MAI-BLC-M', 'Maillot Blanc', 'M', 3, 5]);
const MV = crm.insertSheet('11_MOUVEMENTS_STOCK'); MV.appendRow(vm.runInContext('SB.ENTETES_MOUVEMENTS', ctx));
const V = crm.insertSheet('01_VENTES');
const ENT_V = ['date', 'source', 'commande', 'email', 'produit', 'categorie', 'quantite', 'prix_unitaire', 'CA', 'match_associe', 'boutique_id', 'saison', 'mode_paiement'];
V.appendRow(ENT_V);
crm.insertSheet('04_MATCHS').appendRow(['date', 'competition', 'adversaire', 'x', 'y', 'z', 'commentaire']);
crm.insertSheet('99_DIAGNOSTIC').appendRow(['horodatage', 'source', 'niveau', 'message']);

const ts = '2026-11-28T17:00:00.000Z';
const payload = { action: 'import_session',
  session: { id: 'sGP', boutique_id: 'B1', match_label: "Spacer's vs Paris", date: '2026-11-28', saison: '2026-2027', benevole: 'Lucie' },
  ventes: [
    { id: 'a', produit_id: 'echarpe', produit_ref: 'ECH-TU', produit_nom: 'Écharpe', quantite: 2, prix_unitaire: 14.25, ca_ligne: 28.5, prix_brut: 15, remise: 1.5, mode_paiement: 'CB', tpe: '2668544-001', timestamp: ts },
    // catalogue chargé AVANT un renommage « Maillot Blanc - M » → « Maillot Blanc – M » : le nom ne correspond plus, la réf. si
    { id: 'b', produit_id: 'maillot-blanc-m', produit_ref: 'MAI-BLC-M', produit_nom: 'Maillot Blanc (ancien nom) - M', quantite: 1, prix_unitaire: 55.8, ca_ligne: 55.8, prix_brut: 62, remise: 6.2, mode_paiement: 'Espèces', timestamp: ts },
    { id: 'c', produit_id: 'DIVERS-x', produit_ref: 'DIVERS', produit_nom: 'Divers – Bonnet bleu', quantite: 1, prix_unitaire: 19, ca_ligne: 19, prix_brut: 20, remise: 1, mode_paiement: 'CB', tpe: '2668544-001', timestamp: ts },
  ] };
const post = p => vm.runInContext('doPost', ctx)({ postData: { contents: JSON.stringify(p) } });
const stock = r => ({ B1: P.get(r, 5), B2: P.get(r, 6), R: P.get(r, 12) });

const r1 = post(payload);
check(r1.status === 'ok' && r1.ventes_ajoutees === 3, 'import : 3 lignes dans 01_VENTES');
check(stock(2).B1 === 14 && stock(3).B1 === 3 && stock(2).R === 119, 'stock GP : écharpe 16 → 14, maillot (retrouvé par sa réf. malgré l\'ancien nom) 4 → 3, dépôt intact');
check(MV.getLastRow() === 3, '2 mouvements VENTE_COMPTOIR (rien pour l\'article hors catalogue)');
const diag = crm.getSheetByName('99_DIAGNOSTIC');
const msgs = []; for (let r = 2; r <= diag.getLastRow(); r++) msgs.push(String(diag.get(r, 4)));
check(msgs.some(m => /Produits inconnus.*Divers – Bonnet bleu/.test(m)) && !msgs.some(m => /inconnus.*ancien nom/.test(m)), '99_DIAGNOSTIC : seul le DIVERS est « inconnu » (à régulariser), plus le maillot renommé');
check(V.row(1, 13).join() === ENT_V.join(), '01_VENTES : 13 premières colonnes inchangées (format Pennylane / Ratio)');
const TP = crm.getSheetByName('26_VENTES_TPE');
check(TP && TP.getLastRow() === 4 && TP.get(2, 11) === '2668544-001' && r1.cloture && r1.cloture.tpe === 3, 'terminal CB enregistré dans 26_VENTES_TPE (3 lignes)');
const r2 = post(payload);
check(r2.status === 'ok' && r2.ventes_ajoutees === 0 && stock(2).B1 === 14 && stock(3).B1 === 3 && MV.getLastRow() === 3 && TP.getLastRow() === 4,
  'rejeu de la même session (réseau coupé avant la réponse) : 0 ligne, stock et mouvements inchangés');
check(vm.runInContext('SB_VERROU_PROFONDEUR_', ctx) === 0, 'compteur du verrou revenu à 0 après le doPost');
console.log(ok + ' contrôles OK');
