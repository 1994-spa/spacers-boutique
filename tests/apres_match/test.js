// Ancien onglet 🏁 APRÈS MATCH (Saisie_Inventaire.gs) : « En boutique » fait foi → plus d'écriture absolue de GP / VIP,
// plus de 2e contrôle de caisse dans 25_CONTROLES_CAISSE ; seul le comptage du dépôt part au CRM.
// Lancer : node tests/apres_match/test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { creerContexte } = require('../fichier_boutique/harnais');
const T = creerContexte(), { ctx, crm } = T;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/crm/Saisie_Inventaire.gs'), 'utf8'), ctx);
let ok = 0; const check = (c, m) => { assert(c, m); ok++; console.log('  ✓ ' + m); };
const P = crm.insertSheet('03_PRODUITS');
P.appendRow(['produit', 'categorie', 'prix_vente', 'cout', 'stock_B1', 'stock_B2', 'actif', 'ref_boutique', 'modele', 'taille', 'seuil_alerte', 'stock_R']);
P.appendRow(['Écharpe', 'Accessoires', 15, 7, 16, 6, true, 'ECH-TU', 'Écharpe', 'TU', 3, 119]);
crm.insertSheet('11_MOUVEMENTS_STOCK').appendRow(vm.runInContext('SB.ENTETES_MOUVEMENTS', ctx));
const inv = ctx.SpreadsheetApp.create('Inventaire');
const A = inv.insertSheet('🏁 APRÈS MATCH');
A.getRange('B4').setValue("Spacer's vs Paris"); A.getRange('E4').setValue('Élise'); A.getRange('B5').setNote("Spacer's vs Paris");
A.getRange(9, 1, 2, 11).setValues([['Boutique GP', '', '', 100, 80, 20, 0, 80, 20, '', ''], ['Boutique VIP', '', '', 0, 0, 0, 0, '', '', '', '']]);
const ligne = new Array(21).fill(''); ligne[0] = 'ECH-TU'; ligne[1] = 'Écharpe'; ligne[2] = 'TU'; ligne[8] = 10; ligne[11] = 2; ligne[14] = 117;
A.getRange(15, 1, 1, 21).setValues([ligne]);
const msg = vm.runInContext('si_validerControle_', ctx)(inv, A);
check(P.get(2, 5) === 16 && P.get(2, 6) === 6, 'comptés GP 10 / VIP 2 : B1 / B2 du CRM inchangés (16 / 6) — « En boutique » fait foi');
check(P.get(2, 12) === 117, 'comptage du dépôt appliqué : 119 → 117');
check(!crm.getSheetByName('25_CONTROLES_CAISSE'), 'aucun contrôle de caisse écrit ici (il se fait dans 5_APRES_MATCH)');
check(/comptages GP \/ VIP ignorés \(1\)/.test(msg) && /5_APRES_MATCH/.test(msg), 'message : comptages GP / VIP ignorés, caisse à valider dans 5_APRES_MATCH');
console.log(ok + ' contrôles OK');
