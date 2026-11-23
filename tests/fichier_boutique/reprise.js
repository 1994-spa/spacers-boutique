// Test de Reprise_Ventes_VIP.gs sur maquette
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const { creerContexte, Sheet } = require('./harnais');
Sheet.prototype.deleteRow = function (r) {
  const g = {}; for (const k in this.g) { const [a, b] = k.split(',').map(Number); if (a < r) g[k] = this.g[k]; else if (a > r) g[(a - 1) + ',' + b] = this.g[k]; } this.g = g;
};
const T = creerContexte(), { ctx, crm } = T;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/crm/Reprise_Ventes_VIP.gs'), 'utf8'), ctx);
const run = c => vm.runInContext(c, ctx);
const P = crm.insertSheet('03_PRODUITS');
P.appendRow(['produit', 'categorie', 'prix_vente', 'cout', 'stock_B1', 'stock_B2', 'actif', 'ref_boutique']);
[['Maillot partenaire Bleu Nuit - L', 'MAP-BNU-L'], ['Gourde', 'GRD-TU'], ['T-shirt Freetime M', 'TSH-FRT-M'], ['T-shirt Freetime L', 'TSH-FRT-L'],
 ['Maillot partenaire Blanc - L', 'MAP-BLC-L'], ['Écharpe', 'ECH-TU'], ['Nara Tee M', 'TSH-NAR-M'], ['Maillot partenaire Bleu Nuit - M', 'MAP-BNU-M'],
 ['Porte-clés Spacer\'s', 'PCL-NAV-TU'], ['Mug Spacer\'s', 'MUG-BLC-TU']].forEach(([n, r]) => P.appendRow([n, 'Accessoires', 10, 4, 5, 5, true, r]));
const V = crm.insertSheet('01_VENTES');
V.appendRow(['date', 'source', 'commande', 'email', 'produit', 'categorie', 'quantite', 'prix_unitaire', 'CA', 'match_associe', 'boutique_id', 'saison', 'mode_paiement', 'prix_brut', 'remise']);
V.appendRow([new Date(), 'tablette', 'x', '', 'Écharpe', '', 1, 15, 15, "Spacer's vs Tours", 'B2', '2026-2027', 'CB']);
const stockAvant = JSON.stringify(P.g);
let ok = 0; const check = (c, m) => { assert(c, m); ok++; console.log('  ✓ ' + m); };
check(/SIMULATION .*15 ligne\(s\), 525,00 €/.test(run('rv_simuler()')) && V.getLastRow() === 2, 'simulation : 15 lignes, 525 €, rien écrit');
check(/APPLIQUÉE .*15 ligne\(s\)/.test(run('rv_appliquer()')) && V.getLastRow() === 17, 'application : 15 lignes ajoutées');
let ca = 0; for (let r = 3; r <= 17; r++) ca += V.get(r, 9);
check(ca === 525 && V.get(8, 7) === 12 && V.get(8, 9) === 180 && V.get(8, 11) === 'R', 'CA total 525 € ; Groupama 12 écharpes = 180 €, hors boutique');
check([...Array(15).keys()].every(i => V.get(3 + i, 2) === 'hors_match'), 'source « hors_match » (hors contrôles de caisse tablette)');
check(JSON.stringify(P.g) === stockAvant && !crm.getSheetByName('11_MOUVEMENTS_STOCK'), 'aucun stock ni mouvement touché');
check(/0 ligne\(s\)/.test(run('rv_appliquer()')) && V.getLastRow() === 17, 'relancé : aucun doublon');
check(run('rv_annuler()') === 15 && V.getLastRow() === 2, 'annulation : les 15 lignes retirées, la vente tablette reste');
console.log(ok + ' contrôles OK');
