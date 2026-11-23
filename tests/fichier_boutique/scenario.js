const { creerContexte } = require('./harnais');
const pause = ms => { const t = Date.now(); while (Date.now() - t < ms) {} };
const assert = require('assert');
const T = creerContexte();
const { ctx, crm } = T;
const run = code => require('vm').runInContext(code, ctx);
let ok = 0;
const check = (cond, msg) => { assert(cond, msg); ok++; console.log('  ✓ ' + msg); };

// ---------- CRM de départ ----------
const P = crm.insertSheet('03_PRODUITS');
const H = ['produit', 'categorie', 'prix_vente', 'cout', 'stock_B1', 'stock_B2', 'actif', 'ref_boutique', 'modele', 'taille', 'seuil_alerte', 'stock_R'];
P.appendRow(H);
[['Écharpe', 'Accessoires', 15, 7, 16, 7, true, 'ECH-TU', 'Écharpe', 'TU', 3, 119],
 ['Maillot Bleu Nuit - L', 'Maillots', 62, 30, 3, 0, true, 'MAI-BNU-L', 'Maillot Bleu Nuit', 'L', 3, 4],
 ['Maillot Bleu Nuit - 152', 'Maillots', 62, 30, 1, 0, true, 'MAI-BNU-152', 'Maillot Bleu Nuit', '152', 3, 0],
 ['Gourde', 'Accessoires', 10, 4, 1, 1, true, 'GRD-TU', 'Gourde', 'TU', 3, 0],
 ['Bonnet Bleu', 'Accessoires', 0, 0, 0, 0, true, 'BON-BLE-TU', 'Bonnet', 'Bleu', 3, 0],
 ['Maillot partenaire Bleu Nuit - M', 'Maillots', 55, 30, 0, 11, true, 'MAP-BNU-M', 'Maillot partenaire Bleu Nuit', 'M', 3, 2],
 ['Maillot domicile', 'Maillots', 50, 20, 18, 20, false, '', '', '', '', 0]].forEach(r => P.appendRow(r));
const MV = crm.insertSheet('11_MOUVEMENTS_STOCK');
MV.appendRow(run('SB.ENTETES_MOUVEMENTS'));
const V = crm.insertSheet('01_VENTES');
V.appendRow(['date', 'source', 'commande', 'email', 'produit', 'categorie', 'quantite', 'prix_unitaire', 'CA', 'match_associe', 'boutique_id', 'saison', 'mode_paiement', 'prix_brut', 'remise']);
const A = crm.insertSheet('02_ACHATS');
A.appendRow(['date', 'fournisseur', 'produit', 'categorie', 'quantite', 'cout_unitaire', 'cout_total', 'compte_pennylane', 'reference_pennylane', 'ref_boutique', 'point_reception']);
const L = crm.insertSheet('21_LIGNES_LIVE');
L.appendRow(['ID vente', 'Horodatage', 'ID événement Tickie', 'Boutique', 'Réf.', 'Produit', 'Catégorie', 'Qté', 'PU TTC', 'CA TTC', 'Mode']);
const CAL = crm.insertSheet('04b_CALENDRIER');
CAL.appendRow(['ID événement Tickie', 'Date', 'Heure', 'Match', "Adversaire Spacer's", 'Statut', 'Tablettes', 'Jauge']);
CAL.appendRow(['ev1', new Date(2099, 10, 28), '18:00', "Spacer's vs Paris", 'Paris', '', '✅ tablettes', 4300]);
const RT = crm.insertSheet('17_RETRAITS');
RT.appendRow(['cle', 'transaction_id', 'evenement', 'date_evenement', 'date_achat', 'prenom', 'nom', 'email', 'produit', 'variant_id', 'quantite',
  'taille_requise', 'codes_billets', 'qte_remise', 'tailles_remises', 'refs_remises', 'statut']);
RT.appendRow(['k1', 't1', 'Paris', new Date(2099, 10, 28), '', '', '', '', 'Écharpe', '', 2, '', '', 0, '', '', 'À remettre']);
RT.appendRow(['k2', 't2', 'Sète', new Date(2026, 9, 17), '', '', '', '', 'Maillot Blanc', '', 1, 'O', '', 0, '', '', 'À remettre']);
RT.appendRow(['k3', 't3', 'Tours', new Date(2026, 10, 21), '', '', '', '', 'Écharpe', '', 3, '', '', 3, '', '', 'Remis']);

const stock = ref => { const r = P.find(8, ref, 2); return { R: P.get(r, 12), B1: P.get(r, 5), B2: P.get(r, 6), cout: P.get(r, 4) }; };

// ---------- 1. Installation ----------
console.log('1. Installation');
const url = run('installerFichierBoutique()');
const F = T.fichiers[T.props.FICHIER_BOUTIQUE_ID];
check(!!F && /F1$/.test(url), 'classeur créé et identifiant mémorisé');
check(['📖 LISEZ-MOI', '1_COMMANDE', '2_BOUTIQUE', '3_JOURNAL_VENTES', '4_TOP_VENTES', '5_APRES_MATCH'].every(n => F.getSheetByName(n)), 'les 6 onglets existent');
check(!F.getSheetByName('Feuille 1'), 'feuille vide de départ supprimée');
check(T.triggers.map(t => t.h).sort().join() === 'fb_surModification,majFichierBoutique', 'déclencheurs : modification + 10 min');
const C = F.getSheetByName('1_COMMANDE'), B = F.getSheetByName('2_BOUTIQUE');
check(C.getLastRow() - 8 === 6, '6 articles actifs listés (l\'inactif « Maillot domicile » est exclu)');
const lc = C.find(1, 'ECH-TU', 9);
check(C.get(lc, 4) === 119 && C.get(lc, 5) === 16 && C.get(lc, 6) === 7 && C.get(lc, 7) === 142, 'écharpe : dépôt 119, GP 16, VIP 7, total 142 lus dans le CRM');
check(String(C.get(C.find(1, 'BON-BLE-TU', 9), 11)).indexOf('Rupture') !== -1, 'bonnet à 0 partout : alerte rupture');
run('installerFichierBoutique()');
check(T.triggers.length === 2 && T.fichiers.F2 === undefined, 'réinstallation : même classeur, pas de déclencheur en double');

// ---------- 2. Réception ----------
console.log('2. Réception (1_COMMANDE)');
C.getRange('B4').setValue('Élise'); C.getRange(lc, 12).setValue(50); C.getRange('H4').setValue(true);
run('fb_traiterDemandes()');
check(stock('ECH-TU').R === 119, 'sans facture : rien n\'est enregistré');
check(String(C.get(lc, 14)).indexOf('facture') !== -1 && C.get(lc, 12) === 50, 'message dans Résultat, saisie conservée');
C.getRange('E4').setValue('Fournisseur X'); C.getRange('H4').setValue(true);
run('fb_traiterDemandes()');
check(stock('ECH-TU').R === 119 && /J4/.test(C.get(lc, 14)), 'fournisseur sans n° de facture : refusé');
C.getRange('J4').setValue('FA26081234'); C.getRange('H4').setValue(true);
run('fb_traiterDemandes()');
check(stock('ECH-TU').R === 169, 'réception : dépôt 119 → 169 dans le CRM');
check(A.getLastRow() === 2 && A.get(2, 2) === 'Fournisseur X' && A.get(2, 9) === 'FA26081234' && A.get(2, 6) === 7, '02_ACHATS : fournisseur, n° de facture seul (Pennylane) et prix 7 € HT');
const mvA = MV.getLastRow();
check(MV.get(mvA, 2) === 'ENTREE_ACHAT' && MV.get(mvA, 14) === 'Fichier boutique · Élise', 'mouvement ENTREE_ACHAT signé « Fichier boutique · Élise »');
check(C.get(lc, 12) === '' && C.get(lc, 4) === 169 && String(C.get(lc, 14)).indexOf('✅') === 0, 'case vidée, dépôt affiché 169, résultat ✅');
check(C.get(5, 1).indexOf('✅') === 0 && C.get(4, 5) === '' && C.get(4, 10) === '', 'message général ✅, fournisseur et facture effacés');
check(/Valeur du stock .* total /.test(C.get(6, 1)), 'ligne « valeur du stock au coût d\'achat » affichée');
C.getRange('H4').setValue(true); run('fb_traiterDemandes()');
check(stock('ECH-TU').R === 169 && C.get(5, 1) === 'Aucune quantité saisie.', 'recocher sans saisie : aucun doublon');
// prix différent sur le maillot
const lm = C.find(1, 'MAI-BNU-L', 9);
C.getRange('E4').setValue('Mizuno'); C.getRange('J4').setValue('FA-77'); C.getRange(lm, 12).setValue(6); C.getRange(lm, 13).setValue(36); C.getRange('H4').setValue(true);
run('fb_traiterDemandes()');
check(stock('MAI-BNU-L').R === 10 && stock('MAI-BNU-L').cout === 32.77, 'maillot : +6 au prix saisi 36 € → coût moyen sur 13 pièces 32,77 €');
// quantité invalide
C.getRange('E4').setValue('Test'); C.getRange('J4').setValue('T1'); C.getRange(lm, 12).setValue(2.5); C.getRange('H4').setValue(true); run('fb_traiterDemandes()');
check(stock('MAI-BNU-L').R === 10 && String(C.get(lm, 14)).indexOf('❌') === 0, 'quantité 2,5 refusée');
C.getRange(lm, 12).setValue('');
// CRM occupé par une tablette : rien n'est perdu, rien n'est doublé
ctx.__verrouOccupe = true;
C.getRange(lm, 12).setValue(1); C.getRange('H4').setValue(true); run('fb_traiterDemandes()');
check(stock('MAI-BNU-L').R === 10 && C.get(lm, 12) === 1 && /⏸ CRM occupé/.test(C.get(lm, 14)), 'CRM occupé : ligne en attente, saisie conservée');
ctx.__verrouOccupe = false;
C.getRange('H4').setValue(true); run('fb_traiterDemandes()');
check(stock('MAI-BNU-L').R === 11 && C.get(lm, 12) === '', 'recoché ensuite : +1 enregistré une seule fois');

// ---------- 3. Préparation des boutiques ----------
console.log('3. Préparation (2_BOUTIQUE)');
B.getRange('B4').setValue('Élise');
const be = B.find(1, 'ECH-TU', 9), bm = B.find(1, 'MAI-BNU-L', 9), bg = B.find(1, 'GRD-TU', 9), b152 = B.find(1, 'MAI-BNU-152', 9);
B.getRange(be, 15).setValue(20); B.getRange(be, 16).setValue(5);          // GP 16 → 20 ; VIP 7 → 5
B.getRange(bm, 12).setValue(1); B.getRange(bm, 15).setValue(3);           // compté GP 1 (CRM 3), puis 3 en GP
B.getRange(bg, 15).setValue(5);                                            // dépôt 0 : refus
B.getRange(b152, 15).setValue(1);                                          // déjà 1 : rien
B.getRange('H4').setValue(true);
run('fb_traiterDemandes()');
let s = stock('ECH-TU');
check(s.B1 === 20 && s.B2 === 5 && s.R === 167, 'écharpe : GP 20, VIP 5, dépôt 169 − 4 + 2 = 167');
s = stock('MAI-BNU-L');
check(s.B1 === 3 && s.R === 9, 'maillot L : comptage GP 3 → 1 puis +2 du dépôt (11 → 9)');
check(MV.row(MV.getLastRow() - 0, 3)[1] === 'TRANSFERT', 'mouvements TRANSFERT tracés');
const types = []; for (let r = 2; r <= MV.getLastRow(); r++) types.push(MV.get(r, 2));
check(types.indexOf('AJUSTEMENT_INVENTAIRE') !== -1, 'écart de comptage tracé (AJUSTEMENT_INVENTAIRE)');
check(stock('GRD-TU').B1 === 1 && String(B.get(bg, 17)).indexOf('❌') === 0 && B.get(bg, 15) === 5, 'gourde : dépôt vide → ligne refusée, saisie conservée');
check(B.get(b152, 15) === '' && String(B.get(b152, 17)).indexOf('déjà à 1') !== -1, 'niveau déjà atteint : case vidée, aucun mouvement');
check(B.get(be, 15) === '' && B.get(be, 16) === '' && B.get(bm, 12) === '', 'cases appliquées vidées');
check(B.get(be, 11) === 15, 'prix de vente TTC affiché (15 €)');
check(B.get(be, 5) === 20 && B.get(be, 6) === 5, 'tableau relu : GP 20 / VIP 5');
const mvB = MV.getLastRow();
check(MV.get(mvB, 11) === "Spacer's vs Paris" && /Élise/.test(MV.get(mvB, 14)), 'mouvements signés Élise, match des tablettes recopié');
B.getRange(bg, 15).setValue('');
check(/🎁 .*2 Écharpe.*1 Maillot Blanc \(dont 1 de matchs passés/.test(B.get(7, 1)), 'bandeau add-ons à remettre : 2 écharpes, 1 maillot Blanc d\'un match passé');
pause(5);

// ---------- 4. Match : ventes tablettes + add-on ----------
console.log('4. Après les ventes du match');
const match = "Spacer's vs Paris";
const d = new Date();
const vente = (prod, q, pu, b, mode, id) => {
  V.appendRow([d, 'tablette', 'sess_' + id, '', prod, '', q, pu, q * pu, match, b, '2026-2027', mode]);
  const r = P.find(1, prod, 2);
  const col = b === 'B2' ? 6 : 5;
  P.set(r, col, P.get(r, col) - q);
  MV.appendRow([d, /offert/i.test(mode) ? 'OFFERT_CAISSE' : 'VENTE_COMPTOIR', P.get(r, 8), prod, b, -q, 0, 0, '', '', match, 'sess', '', '']);
  L.appendRow([id, d, 'ev1', b, P.get(r, 8), prod, '', q, pu, q * pu, mode]);
};
vente('Écharpe', 6, 14.25, 'B1', 'CB', 'v1');
vente('Écharpe', 2, 15, 'B2', 'Espèces', 'v2');
vente('Maillot Bleu Nuit - L', 1, 58.9, 'B1', 'CB', 'v3');
vente('Gourde', 1, 10, 'B1', 'Offert', 'v4');
V.appendRow([d, 'tablette', 'sess_v5', '', 'Divers – porte-clés', '', 1, 5, 5, match, 'B1', '2026-2027', 'Espèces']);
// add-on remis au stand GP
const re = P.find(8, 'ECH-TU', 2); P.set(re, 5, P.get(re, 5) - 3);
MV.appendRow([d, 'RETRAIT_ADDON', 'ECH-TU', 'Écharpe', 'B1', -3, 7, -21, '', '', match, 'tx1', 'add-on Tickie remis au stand', '']);
// vente encore dans la tablette VIP (pas de Synchroniser tout)
L.appendRow(['v9', d, 'ev1', 'B2', 'ECH-TU', 'Écharpe', '', 1, 15, 15, 'CB']);
run('majFichierBoutique()');
const Jn = F.getSheetByName('3_JOURNAL_VENTES');
check(Jn.getLastRow() - 5 === 6, 'journal : 5 lignes de caisse + 1 retrait add-on');
const jr = Jn.find(4, 'Retrait add-on', 6);
check(jr > 0 && Jn.get(jr, 8) === 3 && Jn.get(jr, 3) === 'GP', 'retrait add-on : 3 écharpes, boutique GP');
const jd = Jn.find(6, 'Divers – porte-clés', 6);
check(jd > 0 && Jn.get(jd, 5) === 'DIVERS' && Jn.get(jd, 13) === 'article hors catalogue', 'vente « Divers » reconnue, sans fausse alerte');
check(String(Jn.get(3, 1)).indexOf('pas encore synchronisées : 1 article(s) VIP') !== -1, 'bandeau : 1 vente VIP pas encore synchronisée');
const Tp = F.getSheetByName('4_TOP_VENTES');
check(Tp.get(6, 2) === 'Écharpe' && Tp.get(6, 3) === 8 && Tp.get(6, 4) === 6 && Tp.get(6, 5) === 2 && Tp.get(6, 6) === 3, 'top 1 : écharpe 8 vendues (6 GP, 2 VIP) + 3 add-ons');
const be2 = B.find(1, 'ECH-TU', 9);
check(B.get(be2, 7) === 6 && B.get(be2, 8) === 2 && B.get(be2, 9) === 3, 'boutique : vendu GP 6, VIP 2, add-ons 3 au dernier match');
check(String(B.get(be2, 10)).indexOf('+9 GP') !== -1 && String(B.get(be2, 10)).indexOf('+2 VIP') !== -1, 'réassort conseillé : +9 GP, +2 VIP');
const bm2 = B.find(1, 'MAI-BNU-L', 9), b1522 = B.find(1, 'MAI-BNU-152', 9), bmap = B.find(1, 'MAP-BNU-M', 9), bbon = B.find(1, 'BON-BLE-TU', 9);
check(String(B.get(bm2, 10)).indexOf('+1 GP') !== -1, 'maillot L : 1 vendu → +1 GP');
check(String(B.get(b1522, 10)).indexOf('manque 2') !== -1, 'maillot 152 : seuil 3 en GP, dépôt vide → « manque 2 »');
check(B.get(bmap, 10) === '', 'maillot partenaire (VIP seulement) : jamais proposé en GP');
check(String(B.get(bbon, 10)).indexOf('🔁') === -1, 'bonnet jamais en boutique : rien proposé');
check(T.props.FB_ALERTE_EMAIL === 'carpreau.elise@gmail.com', 'adresse d\'alerte d\'Élise réglée à l\'installation');
check(T.mails.length === 0, 'pas d\'alerte tant qu\'une tablette n\'a pas synchronisé');
V.appendRow([d, 'tablette', 'sess_v9', '', 'Écharpe', '', 1, 15, 15, match, 'B2', '2026-2027', 'CB']);
{ const r9 = P.find(8, 'ECH-TU', 2); P.set(r9, 6, P.get(r9, 6) - 1); MV.appendRow([d, 'VENTE_COMPTOIR', 'ECH-TU', 'Écharpe', 'B2', -1, 0, 0, '', '', match, 'sess', '', '']); }
run('majFichierBoutique()');
check(!/pas encore synchronisées/.test(Jn.get(3, 1)) || (run('majFichierBoutique()'), !/pas encore synchronisées/.test(F.getSheetByName('3_JOURNAL_VENTES').get(3, 1))), 'après « Synchroniser tout » de la VIP : bandeau rouge disparu');
check(T.mails.length === 1 && /réassort après Spacer's vs Paris/.test(T.mails[0].subject), 'alerte réassort envoyée une fois…');
run('majFichierBoutique()');
check(T.mails.length === 1, '…et pas deux fois pour le même match');

// ---------- 5. Proposer puis valider le réassort ----------
console.log('5. Réassort');
B.getRange('L4').setValue(true); run('fb_traiterDemandes()');
check(B.get(be2, 15) === 20 && B.get(be2, 16) === 5, 'proposé : écharpe GP 11 → 20, VIP 2 → 5');
const bg2 = B.find(1, 'GRD-TU', 9);
check(B.get(bg2, 15) === '', 'gourde : dépôt vide → rien proposé');
check(B.get(bm2, 15) === 3, 'maillot L proposé : GP 2 → 3');
check(stock('ECH-TU').B1 === 11, 'proposer n\'enregistre rien');
B.getRange('B4').setValue('Élise'); B.getRange('H4').setValue(true); run('fb_traiterDemandes()');
s = stock('ECH-TU');
check(s.B1 === 20 && s.B2 === 5 && s.R === 155, 'réassort validé : GP 20, VIP 5, dépôt 167 − 12 = 155');
check(String(B.get(be2, 10)).indexOf('🔁') === -1, 'après réassort : plus rien de conseillé pour l\'écharpe');
B.getRange('L4').setValue(true); run('fb_traiterDemandes()');
check(B.get(be2, 15) === '' && B.get(be2, 16) === '', 'recocher « Proposer » : écharpe pas reproposée (pas de double réassort)');
check(stock('ECH-TU').B1 === 20, 'stock écharpe inchangé');

// ---------- 6. Contrôle de caisse ----------
console.log('6. Caisse (5_APRES_MATCH)');
const Ap = F.getSheetByName('5_APRES_MATCH');
check(Ap.get(4, 2) === match, 'match proposé par défaut : le dernier');
check(Ap.get(9, 3) === 149.4 && Ap.get(9, 4) === 144.4 && Ap.get(9, 5) === 5 && Ap.get(9, 6) === 1, 'GP : CA 149,40 € dont CB 144,40 €, espèces 5 €, 1 offert');
check(Ap.get(10, 3) === 45 && Ap.get(10, 5) === 30 && Ap.get(10, 4) === 15, 'VIP : 45 € dont 30 € en espèces et 15 € en CB');
Ap.getRange('H4').setValue(true); run('fb_traiterDemandes()');
check(String(Ap.get(6, 1)).indexOf('prénom') !== -1, 'sans prénom : refus');
Ap.getRange('E4').setValue('Élise'); Ap.getRange(9, 7).setValue(140); Ap.getRange(9, 8).setValue(5); Ap.getRange(10, 8).setValue(30);
run('majFichierBoutique()');
check(Ap.get(9, 7) === 140 && Ap.get(10, 8) === 30 && Ap.get(9, 9) === -4.4, 'mise à jour automatique : saisies TPE et espèces conservées, écart calculé');
Ap.getRange('H4').setValue(true); run('fb_traiterDemandes()');
const CC = crm.getSheetByName('25_CONTROLES_CAISSE');
check(CC && CC.getLastRow() === 3 && CC.get(2, 7) === -4.4 && CC.get(3, 10) === 0, '25_CONTROLES_CAISSE : écart CB GP −4,40 €, espèces VIP 0');
check(T.mails.some(m => /caisse/.test(m.subject)), 'rapport de caisse envoyé par mail');
check(Ap.get(9, 7) === '' && Ap.get(9, 8) === '', 'saisies de caisse vidées');

// ---------- 7. Arrêt de l'ancien Inventaire ----------
console.log('7. Arrêt de l\'ancien inventaire');
['majInventaireElise', 'majSaisieInventaire', 'si_surModification', 'majInventaire', 'eb_executer', 'synchroRetraitsHoraire', 'Topventes'].forEach(h => run(`ScriptApp.newTrigger('${h}').create()`));
const r = run('arreterAncienInventaire()');
const restants = T.triggers.map(t => t.h).sort().join();
check(r.length === 5, '5 déclencheurs de l\'ancien inventaire retirés');
check(restants === 'Topventes,fb_surModification,majFichierBoutique,synchroRetraitsHoraire', 'retraits horaires, Topventes et fichier boutique conservés');

console.log('\n' + ok + ' contrôles OK');
