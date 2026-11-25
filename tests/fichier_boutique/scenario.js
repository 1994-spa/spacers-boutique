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
CAL.appendRow(['ev1', new Date(2099, 10, 28), '18:00', "France Avenir vs Cannes & Spacer's vs Paris", 'Paris', '', '✅ tablettes', 4300]);   // double affiche
const RT = crm.insertSheet('17_RETRAITS');
RT.appendRow(['cle', 'transaction_id', 'evenement', 'date_evenement', 'date_achat', 'prenom', 'nom', 'email', 'produit', 'variant_id', 'quantite',
  'taille_requise', 'codes_billets', 'qte_remise', 'tailles_remises', 'refs_remises', 'statut']);
RT.appendRow(['k1', 't1', 'Paris', new Date(2099, 10, 28), '', '', '', '', 'Écharpe', '', 2, '', '', 0, '', '', 'À remettre']);
RT.appendRow(['k2', 't2', 'Sète', new Date(2026, 9, 17), '', '', '', '', 'Maillot Blanc', '', 1, 'O', '', 0, '', '', 'À remettre']);
RT.appendRow(['k4', 't4', 'Paris', new Date(2099, 10, 28), '', '', '', '', 'Echarpe', '', 1, '', '', 0, '', '', 'À remettre']);
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

// ---------- 1 bis. Mémo de chaque onglet (25/11) ----------
console.log('1 bis. Mémos');
{
  const memo = run('FB_MEMOS');
  const att = { '1_COMMANDE': [14, 3], '2_BOUTIQUE': [17, 3], '3_JOURNAL_VENTES': [13, 0], '4_TOP_VENTES': [14, 0], '5_APRES_MATCH': [11, 0] };
  const texte = sh => (sh.get(2, 1) + '\n' + sh.get(2, 4));
  const fusions2 = sh => sh.merges.filter(m => m.r === 2 || m.r + m.nr - 1 >= 2 && m.r <= 2);
  Object.keys(att).forEach(n => {
    const sh = F.getSheetByName(n), [nb, fig] = att[n], L = memo[n];
    check(L && L.length >= 4 && L.length <= 7 && L.every(l => /^[A-ZÀ-Ý][A-ZÀ-Ý ]+ : /.test(l)), n + ' : mémo de ' + (L || []).length + ' lignes, chacune ouverte par un mot-clé en MAJUSCULES');
    const f = fusions2(sh);
    const ok = fig ? (f.length === 2 && f[0].c === 1 && f[0].nc === fig && f[1].c === fig + 1 && f[1].c + f[1].nc - 1 === nb && sh.get(2, 1) === '📌 MÉMO' && sh.get(2, fig + 1) === L.join('\n'))
                   : (f.length === 1 && f[0].c === 1 && f[0].nc === nb && sh.get(2, 1) === '📌 MÉMO\n' + L.join('\n'));
    check(ok, n + ' : encadré « 📌 MÉMO » fusionné en ligne 2 sur ' + nb + ' colonnes' + (fig ? ' (A–C figées à part, Sheets refuse la fusion à cheval)' : ''));
    check(sh.bg['2,1'] === '#fff8e1' && sh.bords.some(b => b.r === 2 && b.c === 1 && b.nc === nb && b.on), n + ' : fond #fff8e1 et bordure sur toute la largeur');
    check(sh.hauteurs[2] === (L.length + (fig ? 0 : 1)) * 18 + 14, n + ' : hauteur de ligne 2 = ' + sh.hauteurs[2] + ' px (18 px par ligne)');
  });
  check(C.get(8, 1) === 'Réf.' && C.get(4, 1) === 'Saisi par :' && C.get(4, 4) === 'Fournisseur :' && C.get(4, 9) === 'N° de facture :' && C.find(1, 'ECH-TU', 9) === lc,
        '1_COMMANDE : en-tête en ligne 8, B4 / E4 / J4 et lignes d\'articles non décalés');
  check(B.get(8, 12) === 'Compté GP' && B.get(4, 7) === '✅ Valider →' && B.get(4, 9) === '📝 Proposer le réassort →', '2_BOUTIQUE : en-tête ligne 8, Valider H4 et Proposer L4 en place');
  const Ap0 = F.getSheetByName('5_APRES_MATCH');
  check(Ap0.get(4, 1) === 'Match :' && Ap0.get(4, 4) === 'Contrôlé par :' && Ap0.get(5, 1) === 'Commentaire :' && Ap0.get(8, 7) === 'CB relevé TPE' && Ap0.get(8, 8) === 'Espèces comptées',
        '5_APRES_MATCH : B4 / E4 / B5 et colonnes « CB relevé TPE » / « Espèces comptées » non décalés');
  // chaque libellé cité dans les mémos existe bien dans l'onglet
  const cite = (n, motif) => memo[n].join(' ').indexOf(motif) !== -1;
  check(cite('1_COMMANDE', '« ➕ Reçu (quantité) »') && run('FB.CDE_COLS').indexOf('➕ Reçu (quantité)') !== -1 && cite('1_COMMANDE', '« Prix d\'achat HT (si différent) »') && run('FB.CDE_COLS').indexOf('Prix d\'achat HT (si différent)') !== -1,
        '1_COMMANDE : libellés du mémo = colonnes réelles');
  check(['Compté GP', 'Compté dépôt', '➡️ Sortir du dépôt vers GP (ajout)'].every(x => run('FB.BTQ_COLS').indexOf(x) !== -1) && cite('2_BOUTIQUE', '(L4)') && cite('2_BOUTIQUE', '(H4)'),
        '2_BOUTIQUE : libellés et cases du mémo = onglet réel');
  // idempotence : reconstruire deux fois ne crée ni fusion en double ni erreur ; une ancienne consigne A2 non fusionnée est remplacée
  const J0 = F.getSheetByName('3_JOURNAL_VENTES');
  J0.merges = J0.merges.filter(m => m.r !== 2); J0.getRange('A2').setValue('Automatique, depuis le CRM : rien à saisir.');
  run('installerFichierBoutique()'); run('majFichierBoutique()');
  check(Object.keys(att).every(n => fusions2(F.getSheetByName(n)).length === (att[n][1] ? 2 : 1)), 'reconstructions répétées : toujours une seule fusion de mémo par onglet');
  check(J0.get(2, 1).indexOf('📌 MÉMO') === 0 && !/Automatique, depuis/.test(J0.get(2, 1)), 'ancienne consigne A2 (version précédente) remplacée par le mémo');
  check(Object.keys(att).every(n => { const sh = F.getSheetByName(n); for (let c = 2; c <= 30; c++) if (c !== att[n][1] + 1 && sh.get(2, c) !== '') return false; return true; }),
        'ligne 2 : aucun texte résiduel hors des cellules du mémo');
}

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

// ---------- 2 bis. Traitement lancé depuis le classeur d'Élise (cas réel du 23/11) ----------
console.log('2 bis. Classeur actif = celui d\'Élise');
ctx.__actif = F;                       // getActive() renvoie le classeur d'Élise, pas le CRM
C.getRange('E4').setValue('Test'); C.getRange('J4').setValue('T2'); C.getRange(lm, 12).setValue(1); C.getRange('H4').setValue(true);
run('fb_traiterDemandes()');
check(!/introuvable/.test(C.get(5, 1)) && stock('MAI-BNU-L').R === 12 && C.get(lm, 12) === '', 'le CRM est désigné explicitement : réception enregistrée (+1, dépôt 12)');
check(ctx.__actif === crm, 'classeur actif rétabli sur le CRM');
ctx.__actif = null;

// ---------- 3. Inventaire et préparation des boutiques (fichier unique, 25/11) ----------
console.log('3. Inventaire et préparation (2_BOUTIQUE, mode complet)');
check(B.get(8, 12) === 'Compté GP' && B.get(8, 13) === 'Compté VIP' && B.get(8, 14) === 'Compté dépôt' &&
      /Sortir du dépôt vers GP \(ajout\)/.test(B.get(8, 15)) && /vers VIP \(ajout\)/.test(B.get(8, 16)) && B.get(8, 17) === 'Résultat',
      'colonnes jaunes : Compté GP / VIP / dépôt, puis sorties du dépôt vers GP / VIP, puis Résultat');
check(/BOUTIQUES GP \/ VIP ET DÉPÔT/.test(B.get(1, 1)) && !/En boutique/.test(B.get(2, 4)) && /comptage passe avant la sortie/.test(B.get(2, 4)),
      'titre et mémo du mode complet, sans renvoi à « En boutique »');
B.getRange('B4').setValue('Élise');
const be = B.find(1, 'ECH-TU', 9), bm = B.find(1, 'MAI-BNU-L', 9), bg = B.find(1, 'GRD-TU', 9), bmap = B.find(1, 'MAP-BNU-M', 9);
const totalEch0 = stock('ECH-TU').R + stock('ECH-TU').B1 + stock('ECH-TU').B2;
const nbMv0 = MV.getLastRow();
B.getRange(be, 15).setValue(4); B.getRange(be, 16).setValue(0);            // sortie seule : +4 en GP, 0 en VIP
B.getRange(bm, 14).setValue(10); B.getRange(bm, 15).setValue(2);           // même ligne : dépôt compté 10 (CRM 12), puis +2 en GP
B.getRange(bg, 15).setValue(5);                                            // dépôt 0 : refus
B.getRange(bmap, 14).setValue(1); B.getRange(bmap, 16).setValue(2);        // dépôt compté 1 (CRM 2), sortie 2 : refus
B.getRange('H4').setValue(true);
run('fb_traiterDemandes()');
let s = stock('ECH-TU');
check(s.B1 === 20 && s.B2 === 7 && s.R === 165, 'sortie seule : 4 dépôt → GP (GP 16 → 20, VIP 7 inchangé, dépôt 169 → 165)');
check(s.R + s.B1 + s.B2 === totalEch0, 'sortie du dépôt : aucune pièce créée ni perdue');
check(/4 dépôt → GP/.test(B.get(be, 17)) && /maintenant dépôt 165 \/ GP 20 \/ VIP 7/.test(B.get(be, 17)) && !/En boutique|👉/.test(B.get(be, 17)),
      'résultat : « maintenant dépôt 165 / GP 20 / VIP 7 », plus aucun rappel « En boutique »');
check(B.get(be, 15) === '' && B.get(be, 16) === '', 'case à 0 vidée sans mouvement, case appliquée vidée');
s = stock('MAI-BNU-L');
check(s.R === 8 && s.B1 === 5 && s.B2 === 0, 'comptage + sortie sur la même ligne : dépôt compté 10 (−2), puis 2 dépôt → GP (dépôt 8, GP 5)');
check(/compté dépôt 10 \(/.test(B.get(bm, 17)) && /maintenant dépôt 8 \/ GP 5 \/ VIP 0/.test(B.get(bm, 17)), 'résultat maillot L : comptage puis sortie, état final');
check(B.get(bm, 14) === '' && B.get(bm, 15) === '', 'maillot L : cases comptage et sortie vidées');
check(stock('GRD-TU').B1 === 1 && String(B.get(bg, 17)).indexOf('❌') === 0 && B.get(bg, 15) === 5, 'gourde : dépôt vide → ligne refusée, saisie conservée');
s = stock('MAP-BNU-M');
check(s.R === 2 && s.B2 === 11 && /❌ il faut 2 au dépôt, il y en a 1 \(compté\)/.test(B.get(bmap, 17)) && B.get(bmap, 14) === 1 && B.get(bmap, 16) === 2,
      'sortie > dépôt compté : ligne entière refusée (pas même le comptage), saisies conservées');
const mvs = []; for (let r = nbMv0 + 1; r <= MV.getLastRow(); r++) mvs.push({ type: MV.get(r, 2), ref: MV.get(r, 3), pt: MV.get(r, 5), q: MV.get(r, 6) });
check(mvs.filter(m => m.type === 'AJUSTEMENT_INVENTAIRE').map(m => m.ref + ' ' + m.pt + ' ' + m.q).join() === 'MAI-BNU-L R -2', 'un seul écart tracé : maillot L dépôt −2 (AJUSTEMENT_INVENTAIRE)');
check(mvs.filter(m => m.type === 'TRANSFERT').length === 4 && !mvs.some(m => m.ref === 'GRD-TU' || m.ref === 'MAP-BNU-M'), 'sorties tracées en TRANSFERT (2 × 2 lignes), rien pour les lignes refusées');
check(/Mettre à jour le catalogue/.test(B.get(5, 1)) && /Charger le match/.test(B.get(5, 1)) && !/En boutique|eb_simuler/.test(B.get(5, 1)), 'message général : « Mettre à jour le catalogue » puis « Charger le match »');
check(B.get(be, 11) === 15, 'prix de vente TTC affiché (15 €)');
check(B.get(be, 5) === 20 && B.get(be, 6) === 7, 'tableau relu : GP 20 / VIP 7');
const mvB = MV.getLastRow();
check(MV.get(mvB, 11) === "Spacer's vs Paris" && /Élise/.test(MV.get(mvB, 14)), 'double affiche : mouvements signés « Spacer\'s vs Paris » (comme les tablettes), par Élise');
check(/Match des tablettes : Spacer's vs Paris/.test(B.get(6, 1)), 'bandeau : match des tablettes « Spacer\'s vs Paris »');
check(/🎁 .*3 Écharpe.*1 Maillot Blanc \(dont 1 de matchs passés/.test(B.get(7, 1)) && !/Echarpe/.test(B.get(7, 1)), 'bandeau add-ons : « Echarpe » et « Écharpe » regroupées (3), 1 maillot Blanc d\'un match passé');

// deuxième passage : comptage seul GP / VIP / dépôt, nombres invalides
B.getRange(bg, 15).setValue(''); B.getRange(bmap, 14).setValue(''); B.getRange(bmap, 16).setValue('');
const b152 = B.find(1, 'MAI-BNU-152', 9);
const nbMv1 = MV.getLastRow();
B.getRange(bmap, 12).setValue(0); B.getRange(bmap, 13).setValue(10); B.getRange(bmap, 14).setValue(2);   // CRM : GP 0, VIP 11, dépôt 2
B.getRange(b152, 12).setValue(-1);
B.getRange('H4').setValue(true); run('fb_traiterDemandes()');
s = stock('MAP-BNU-M');
check(s.R === 2 && s.B1 === 0 && s.B2 === 10, 'comptage seul GP / VIP / dépôt : VIP 11 → 10, GP et dépôt conformes');
const aj2 = []; for (let r = nbMv1 + 1; r <= MV.getLastRow(); r++) aj2.push(MV.get(r, 2) + ' ' + MV.get(r, 5) + ' ' + MV.get(r, 6) + ' ' + MV.get(r, 13));
check(aj2.length === 1 && /^AJUSTEMENT_INVENTAIRE B2 -1 Comptage Élise/.test(aj2[0]), 'un seul mouvement : écart VIP −1 tracé (AJUSTEMENT_INVENTAIRE, « Comptage Élise »)');
check(/compté GP 0, compté VIP 10 \(.1\), compté dépôt 2 · maintenant dépôt 2 \/ GP 0 \/ VIP 10/.test(B.get(bmap, 17)) && B.get(bmap, 12) === '' && B.get(bmap, 13) === '' && B.get(bmap, 14) === '',
      'résultat du comptage, les 3 cases comptées vidées');
check(/❌ nombres entiers positifs/.test(B.get(b152, 17)) && stock('MAI-BNU-152').B1 === 1 && B.get(b152, 12) === -1, 'compté négatif : refusé, rien enregistré');
B.getRange(b152, 12).setValue('');
// plan seul (sans écriture) : cases vides = non comptées
{
  const pl = run(`fb_planBoutique([{ ref: 'X', cGP: '', cVIP: 3, cR: '', aGP: 1, aVIP: '' }], [{ ref: 'X', R: 4, B1: 2, B2: 5 }])`);
  const inv = pl.ok[0].ops[0], rep = pl.ok[0].ops[1];
  check(inv.type === 'inventaire' && inv.B1 === '' && inv.B2 === 3 && inv.R === '' && rep.type === 'repartition' && rep.B1 === 1 && rep.colonne === 3 &&
        pl.ok[0].apres.R === 3 && pl.ok[0].apres.B1 === 3 && pl.ok[0].apres.B2 === 3, 'fb_planBoutique : non compté laissé vide, apres = { R 3, B1 3, B2 3 }');
}
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
check(String(B.get(be2, 10)).indexOf('+9 GP') !== -1 && String(B.get(be2, 10)).indexOf('+2 VIP') !== -1, 'réassort conseillé : +9 GP, +2 VIP (vente VIP pas encore synchronisée)');
const bm2 = B.find(1, 'MAI-BNU-L', 9), b1522 = B.find(1, 'MAI-BNU-152', 9), bmap2 = B.find(1, 'MAP-BNU-M', 9), bbon = B.find(1, 'BON-BLE-TU', 9);
check(String(B.get(bm2, 10)).indexOf('+1 GP') !== -1, 'maillot L : 1 vendu → +1 GP');
check(B.get(b1522, 10) === '', 'maillot 152 non vendu, dépôt vide : pas d\'alerte rouge due au seul seuil');
const bg3 = B.find(1, 'GRD-TU', 9);
check(/❌ manque 1 : dépôt vide/.test(B.get(bg3, 10)), 'gourde offerte au match, dépôt vide → « manque 1 »');
check(B.get(bmap2, 10) === '', 'maillot partenaire (VIP seulement) : jamais proposé en GP');
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
check(B.get(be2, 15) === 9 && B.get(be2, 16) === 3 && B.get(be2, 12) === '' && B.get(be2, 13) === '' && B.get(be2, 14) === '', 'proposer : « Sortir du dépôt » rempli (+9 GP, +3 VIP), cases de comptage intactes');
const bg2 = B.find(1, 'GRD-TU', 9);
check(B.get(bg2, 15) === '', 'gourde : dépôt vide → rien proposé');
check(B.get(bm2, 15) === 1, 'maillot L proposé : +1 GP');
check(stock('ECH-TU').B1 === 11, 'proposer n\'enregistre rien');
B.getRange('B4').setValue('Élise'); B.getRange('H4').setValue(true); run('fb_traiterDemandes()');
s = stock('ECH-TU');
check(s.B1 === 20 && s.B2 === 7 && s.R === 153, 'réassort validé : GP 20, VIP 7, dépôt 165 − 12 = 153');
check(/9 dépôt → GP, 3 dépôt → VIP · maintenant dépôt 153 \/ GP 20 \/ VIP 7/.test(B.get(be2, 17)), 'résultat : 9 dépôt → GP, 3 dépôt → VIP, maintenant dépôt 153 / GP 20 / VIP 7');
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

// 25/11/2026 : statut / tolérance, pas de double contrôle, pas de contrôle tant qu'une vente n'est pas synchronisée
{
  const cSt = CC.row(1, CC.getLastColumn()).map(String).indexOf('statut') + 1;
  check(cSt > 0 && CC.get(2, cSt) === '❌ écart à expliquer' && CC.get(3, cSt) === '⏳ incomplet', 'statut : GP −4,40 € « à expliquer », VIP sans relevé TPE « incomplet »');
  Ap.getRange('E4').setValue('Élise'); Ap.getRange(9, 7).setValue(144.4); Ap.getRange(9, 8).setValue(5);
  Ap.getRange('H4').setValue(true); run('fb_traiterDemandes()');
  check(/déjà validé/.test(String(Ap.get(6, 1))) && CC.getLastRow() === 3, 'second contrôle du même match sans « Correction » : refusé, rien ajouté');
  Ap.getRange(9, 7).setValue(144.4); Ap.getRange(9, 8).setValue(5); Ap.getRange('B5').setValue('Correction : ticket TPE relu');
  Ap.getRange('H4').setValue(true); run('fb_traiterDemandes()');
  check(CC.getLastRow() === 4 && CC.get(4, 7) === 0 && CC.get(4, cSt) === '✅ dans la tolérance', 'correction motivée : ligne ajoutée (historique gardé), écart 0 → dans la tolérance');
  L.appendRow(['v10', d, 'ev1', 'B1', 'ECH-TU', 'Écharpe', '', 2, 15, 30, 'CB']);   // vente encore dans la tablette GP
  run('majFichierBoutique()');
  Ap.getRange('E4').setValue('Élise'); Ap.getRange(9, 7).setValue(174.4); Ap.getRange('B5').setValue('Correction : après vente oubliée');
  Ap.getRange('H4').setValue(true); run('fb_traiterDemandes()');
  check(/pas encore synchronisées \(2 article\(s\) GP\)/.test(String(Ap.get(6, 1))) && CC.getLastRow() === 4, 'vente GP pas encore synchronisée : contrôle refusé (CA incomplet), rien ajouté');
}

// ---------- 7. Archivage de l'ancien Inventaire ----------
console.log('7. Archivage de l\'ancien Inventaire (25/11)');
['majInventaireElise', 'majSaisieInventaire', 'si_surModification', 'si_traiterDemandes', 'majInventaire', 'eb_appliquer', 'eb_simuler', 'Topventes'].forEach(h => run(`ScriptApp.newTrigger('${h}').create()`));
const r = run('arreterAncienInventaire()');
check(r.slice().sort().join() === 'eb_appliquer,eb_simuler,majInventaire,majInventaireElise,majSaisieInventaire,si_surModification,si_traiterDemandes',
      'arreterAncienInventaire : déclencheurs de l\'Inventaire et eb_* retirés');
check(T.triggers.map(t => t.h).sort().join() === 'Topventes,fb_surModification,majFichierBoutique', 'déclencheurs du fichier boutique (et Topventes) conservés');
check(run('arreterAncienInventaire()').length === 0, 'relancée : rien à retirer');
run(`ScriptApp.newTrigger('eb_simuler').create()`);
run('installerFichierBoutique()');
check(T.triggers.some(t => t.h === 'eb_simuler') && T.triggers.filter(t => /^fb_surModification|majFichierBoutique$/.test(t.h)).length === 2, 'installerFichierBoutique ne touche pas aux autres déclencheurs');
{ const N = F.getSheetByName('📖 LISEZ-MOI'); const txt = Array.from({ length: 60 }, (_, i) => N.get(i + 1, 1)).join('\n');
  check(N.getRange('A1').getNote() === 'fb-notice-v4-memos' && /INVENTAIRE ET PRÉPARATION DU MATCH/.test(txt) && /MÉMO en haut/.test(txt) && !/En boutique|eb_simuler/.test(txt), 'notice v4 : renvoi aux mémos, inventaire complet + répartition, plus de renvoi à « En boutique »'); }

// ---------- 8. Passage de la disposition du 24/11 (« En boutique ») au mode complet ----------
console.log('8. Mise à jour d\'un onglet 2_BOUTIQUE de la version du 24/11');
{ const Bo = F.getSheetByName('2_BOUTIQUE');
  Bo.getRange(8, 12).setValue('Compté dépôt'); Bo.getRange(8, 13).setValue('➡️ Sortir du dépôt vers GP (ajout)');
  Bo.getRange(8, 14).setValue('➡️ Sortir du dépôt vers VIP (ajout)'); Bo.getRange(8, 15).setValue('Résultat');
  Bo.getRange(8, 16).setValue(''); Bo.getRange(8, 17).setValue(''); }
run('majFichierBoutique()');
const B2n = F.getSheetByName('2_BOUTIQUE');
check(B2n.get(8, 12) === 'Compté GP' && B2n.get(8, 14) === 'Compté dépôt' && B2n.get(8, 17) === 'Résultat' && B2n.find(1, 'ECH-TU', 9) > 0, 'ancien onglet refait automatiquement avec les colonnes du mode complet');

console.log('\n' + ok + ' contrôles OK');
