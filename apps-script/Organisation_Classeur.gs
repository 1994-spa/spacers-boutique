/**
 * ORGANISATION DU CLASSEUR — SPACERS_BOUTIQUE_CRM_V2
 * ------------------------------------------------------------------
 * À coller dans le projet Apps Script DU CLASSEUR (Extensions › Apps Script),
 * comme nouveau fichier « Organisation_Classeur ». Puis exécuter
 * organiserClasseur() une fois. Relançable à volonté (idempotent).
 *
 * Ce script ne renomme AUCUN onglet et ne touche à AUCUNE en-tête :
 * les automatisations (synchro tablettes, pilotage live, Tickie, Pennylane)
 * continuent d'écrire exactement au même endroit.
 *
 * Ce qu'il fait :
 *  1. Crée 📖 SOMMAIRE (rôle de chaque onglet, qui l'alimente, liens directs)
 *  2. Crée 📊 TABLEAU DE BORD (formules en direct, sélecteur de saison)
 *  3. Crée 🔎 RECHERCHE (un mot → toutes les lignes qui le contiennent)
 *  4. Range les onglets par familles, avec une couleur par famille
 *  5. Masque les onglets techniques, obsolètes ou de sauvegarde
 *  6. Sur chaque onglet de données : en-tête figée et stylée, filtre,
 *     note explicative sur chaque colonne, formats € et dates
 *  7. Pose un avertissement (non bloquant) sur les onglets remplis
 *     automatiquement, pour éviter les modifications à la main
 *
 * Pas de onOpen() ici : le projet en a déjà un (deux onOpen se marchent dessus).
 */

var ORG = {
  NIGHT: '#001E2D', DAY: '#91BEE6', PERI: '#C8D2EB', GRIS: '#9AA5B1', VERT: '#2E7D4F', ORANGE: '#B5651D',
  SOMMAIRE: '📖 SOMMAIRE', TDB: '📊 TABLEAU DE BORD', RECH: '🔎 RECHERCHE'
};

/* Familles d'onglets, dans l'ordre d'affichage.
   visible:false = masqué (toujours alimenté par les scripts, réaffichable via Affichage › Onglets masqués). */
var ORG_FAMILLES = [
  { famille: 'Accueil', couleur: ORG.NIGHT, onglets: [
    { n: ORG.SOMMAIRE, role: 'Plan du classeur : à quoi sert chaque onglet.', par: 'Ce script', mode: 'lecture' },
    { n: ORG.TDB, role: 'Chiffres clés de la saison : CA, ventes par match, top produits, stock, alertes.', par: 'Formules (temps réel)', mode: 'lecture' },
    { n: ORG.RECH, role: 'Retrouver une vente, un client, un billet, un produit : tape un mot.', par: 'Formules', mode: 'saisie', note: 'Saisir seulement les cellules jaunes' }
  ]},
  { famille: 'Ventes', couleur: ORG.DAY, onglets: [
    { n: '01_VENTES', role: 'RÉFÉRENCE COMPTABLE — une ligne par article vendu, après clôture du match (tablettes) et ventes web Tickie.', par: 'Synchro tablettes + passerelle Tickie', mode: 'auto' },
    { n: '20_VENTES_LIVE', role: 'Ventes reçues en direct pendant le match, avec le billet scanné et l\'acheteur Tickie.', par: 'Pilotage live (tablettes, toutes les minutes)', mode: 'auto' },
    { n: '23_CLIENTS_BOUTIQUE', role: 'Fiche par acheteur identifié par son billet : achats, CA, matchs, tarif.', par: 'Pilotage (toutes les 10 min)', mode: 'auto' },
    { n: '04_MATCHS', role: 'Un match par ligne : date, adversaire, spectateurs, CA boutique.', par: 'Synchro tablettes', mode: 'auto+saisie', note: 'Compléter nb_spectateurs si vide' },
    { n: '09_IMPORT_BOUTIQUE', role: 'Commandes web Tickie à remettre au stand (statut de retrait).', par: 'Passerelle Tickie', mode: 'auto+saisie', note: 'Le retrait se valide depuis le panneau Stock' }
  ]},
  { famille: 'Stock', couleur: ORG.VERT, onglets: [
    { n: '03_PRODUITS', role: 'CATALOGUE : prix, coût, stock Réserve / GP (B1) / VIP (B2), référence, actif.', par: 'Saisie + panneau Stock', mode: 'saisie', note: 'Seul onglet stock à modifier à la main (prix, actif, seuil). Les quantités passent par le menu 📦' },
    { n: '02_ACHATS', role: 'Réceptions fournisseur (entrée en Réserve, coût HT).', par: 'Menu 📦 › Réception', mode: 'auto' },
    { n: '11_MOUVEMENTS_STOCK', role: 'Journal de tous les mouvements : réception, répartition, vente, don, casse, inventaire.', par: 'Menu 📦 Stock boutique', mode: 'auto' },
    { n: '12_SYNTHESE_STOCK', role: 'État du stock par produit et par point, valeur, dotations.', par: 'Menu 📦 › Synthèse', mode: 'auto' },
    { n: '14_ENVELOPPES_DOTATIONS', role: 'Règles des dons : responsable, budget, compte Pennylane, règle TVA 73 €.', par: 'Saisie', mode: 'saisie' }
  ]},
  { famille: 'Analyses', couleur: ORG.PERI, onglets: [
    { n: '10_SAISONS', role: 'Bilan par saison et par boutique.', par: 'Synchro tablettes', mode: 'auto' },
    { n: '90_ANALYSE_PRODUITS', role: 'Classement des produits (CA, marge).', par: 'Menu CRM', mode: 'auto', note: 'Marge fausse tant que le coût des maillots est à 0 dans 03_PRODUITS' }
  ]},
  { famille: 'Technique & archives (masqués)', couleur: ORG.GRIS, onglets: [
    { n: '00_DASHBOARD', role: 'Ancien tableau de bord (remplacé par 📊 TABLEAU DE BORD).', par: 'Script V3', mode: 'auto', visible: false },
    { n: '21_LIGNES_LIVE', role: 'Détail article par article des ventes live (sert au tableau de bord pilotage).', par: 'Pilotage', mode: 'auto', visible: false },
    { n: '22_TABLETTES', role: 'Dernier contact de chaque tablette.', par: 'Pilotage', mode: 'auto', visible: false },
    { n: '13_WEBHOOK_TICKIE', role: 'Journal brut des messages Tickie.', par: 'Passerelle Tickie', mode: 'auto', visible: false },
    { n: '08_IMPORT_PENNYLANE_VENTES', role: 'Import Pennylane (ventes).', par: 'Import Pennylane', mode: 'auto', visible: false },
    { n: '08b_IMPORT_PENNYLANE_ACHATS', role: 'Import Pennylane (achats).', par: 'Import Pennylane', mode: 'auto', visible: false },
    { n: '05_CLIENTS', role: 'Ancienne base clients web (remplacée par 23_CLIENTS_BOUTIQUE).', par: 'Import boutique en ligne V2', mode: 'auto', visible: false },
    { n: '06_PANIERS_ABANDONNES', role: 'Non utilisé avec Tickie.', par: '—', mode: 'auto', visible: false },
    { n: '07_IMPORT_RATIO', role: 'Ancienne billetterie Ratio (remplacée par Tickie).', par: '—', mode: 'auto', visible: false },
    { n: '99_DIAGNOSTIC', role: 'Contrôles techniques et écarts de stock signalés par la synchro.', par: 'Script V3', mode: 'auto', visible: false }
  ]}
];
// Onglets reconnus par motif (inventaires datés, sauvegardes)
var ORG_MOTIFS = [
  { re: /^15_INVENTAIRE/, famille: 'Stock', role: 'Inventaire de clôture (comptage du 30/06).', par: 'Menu 📦 › Inventaire', mode: 'auto', visible: true },
  { re: /_backup_/i, famille: 'Technique & archives (masqués)', role: 'Sauvegarde automatique avant migration (peut être supprimée).', par: 'Script V3', mode: 'auto', visible: false }
];

/* Explication de chaque colonne (note sur l'en-tête). Clé = en-tête exacte. */
var ORG_COLS = {
  '01_VENTES': {
    date: 'Date et heure de la vente', source: 'tablette = vente au stand · tickie = vente web', commande: 'Identifiant technique de la ligne',
    email: 'Email client (ventes web uniquement)', produit: 'Nom du produit', categorie: 'Famille de produit', quantite: 'Nombre d\'articles',
    prix_unitaire: 'Prix de vente TTC unitaire', CA: 'Montant TTC de la ligne (les « Offert » ne comptent pas dans le CA)',
    match_associe: 'Match pendant lequel la vente a eu lieu', boutique_id: 'B1 = Grand Public · B2 = VIP · WEB = Tickie',
    saison: 'Saison (juillet → juin)', mode_paiement: 'CB · Espèces · Offert'
  },
  '20_VENTES_LIVE': {
    'Reçu le': 'Heure de réception au classeur', 'Horodatage': 'Heure de la vente sur la tablette', 'ID vente': 'Identifiant unique (anti-doublon)',
    'ID événement Tickie': 'Match Tickie', 'Match': 'Nom du match', 'Boutique': 'B1 = Grand Public · B2 = VIP', 'Session': 'Session de caisse',
    'Bénévole': 'Bénévole(s) au stand', 'Mode': 'CB · Espèces · Offert', 'Total €': 'Montant TTC du panier', 'Articles': 'Nombre d\'articles',
    'Détail': 'Contenu du panier', 'ID billet': 'Billet scanné (vide si non scanné)', 'Code-barres': 'Code du QR billet',
    'Tarif billet': 'Tarif du billet scanné', 'Client Tickie': 'Identifiant acheteur Tickie (rempli automatiquement)',
    'Email acheteur': 'Rempli automatiquement depuis Tickie', 'Nom acheteur': 'Rempli automatiquement depuis Tickie', 'Lien acheteur': 'Ouvre la fiche Tickie'
  },
  '23_CLIENTS_BOUTIQUE': {
    'Email': 'Acheteur du billet scanné', 'Achats': 'Nombre de paniers', 'Articles': 'Nombre d\'articles achetés', 'CA TTC': 'Total dépensé en boutique',
    'Matchs': 'Matchs où il a acheté', 'Tarifs': 'Types de billets/abonnements', 'Mis à jour': 'Dernier recalcul'
  },
  '03_PRODUITS': {
    produit: 'Nom affiché sur les tablettes', categorie: 'Famille (onglets des tablettes)', prix_vente: 'Prix de vente TTC',
    cout: 'Coût d\'achat HT unitaire (CMUP, recalculé à chaque réception) — indispensable pour la marge',
    stock_B1: 'Stock Grand Public (B1)', stock_B2: 'Stock VIP (B2)', stock_R: 'Stock en Réserve (avant répartition)',
    actif: 'VRAI = visible sur les tablettes', ref_boutique: 'Référence unique (ex. MAI-BLC-M) — clé de liaison avec Tickie',
    modele: 'Regroupe les tailles sur la tablette', taille: 'S, M, L, XL, XXL ou TU', tickie_product_id: 'Identifiant produit Tickie',
    tickie_variant_id: 'Identifiant variante (taille) Tickie', seuil_alerte: 'Alerte quand le stock passe sous ce nombre'
  },
  '02_ACHATS': {
    date: 'Date de réception', fournisseur: 'Fournisseur', produit: 'Produit reçu', quantite: 'Quantité reçue', cout_unitaire: 'Coût HT unitaire',
    cout_total: 'Coût HT total', compte_pennylane: 'Compte de charge (607000)', reference_pennylane: 'N° de facture fournisseur',
    ref_boutique: 'Référence produit', point_reception: 'R = Réserve'
  },
  '11_MOUVEMENTS_STOCK': {
    horodatage: 'Date et heure', type: 'reception · repartition · vente · don · casse · vol · inventaire…', ref_boutique: 'Référence produit',
    point: 'R = Réserve · B1 = GP · B2 = VIP', quantite: 'Entrée (+) ou sortie (−)', cout_unitaire: 'Coût HT unitaire', valeur: 'Valeur HT du mouvement',
    type_dotation: 'Enveloppe de dotation (dons)', beneficiaire: 'Qui a reçu l\'article (dons)', match: 'Match concerné',
    reference: 'N° de bon (ex. DOT-2627-0001)', commentaire: 'Précisions', auteur: 'Qui a saisi'
  },
  '09_IMPORT_BOUTIQUE': {
    tickie_transaction_id: 'Commande Tickie', point_retrait: 'Stand où le client retire', match_retrait: 'Match du retrait',
    statut_retrait: 'À retirer · Retiré', date_retrait: 'Date de remise au client', statut_import: 'Traitement par la passerelle'
  },
  '04_MATCHS': {
    nb_spectateurs: 'Spectateurs (billets + abonnés) — visible au tableau de bord pilotage', ca_boutique_jour: 'CA TTC boutique du match',
    ca_par_spectateur: 'CA boutique ÷ spectateurs'
  }
};
var ORG_EUROS = /(^CA|prix|cout|valeur|montant|Total €|CA TTC|PU TTC|budget_valeur|ca_)/i;
var ORG_DATES = /^(date|horodatage|Reçu le|Horodatage|Premier achat|Dernier achat|Mis à jour|dernier_achat|date_retrait|derniere_maj|Dernier chargement|Dernière remontée)$/i;

function organiserClasseur() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById('1mE9gSCtetFgnWEt0kA6cS2lcgJDe7oPRLDiXdGhH2EQ');
  var journal = [];
  construireTableauDeBord_(ss); journal.push('📊 Tableau de bord créé / mis à jour');
  construireRecherche_(ss); journal.push('🔎 Recherche créée / mise à jour');
  var plan = planComplet_(ss);
  construireSommaire_(ss, plan); journal.push('📖 Sommaire créé / mis à jour');

  // Ordre, couleurs, visibilité
  var pos = 1;
  plan.forEach(function (o) {
    var sh = ss.getSheetByName(o.n); if (!sh) return;
    sh.setTabColor(o.couleur);
    ss.setActiveSheet(sh); ss.moveActiveSheet(pos++);
  });
  // Onglets inconnus du plan : laissés visibles, à la fin
  plan.forEach(function (o) {
    var sh = ss.getSheetByName(o.n); if (!sh) return;
    if (o.visible === false) { if (!sh.isSheetHidden()) sh.hideSheet(); }
    else if (sh.isSheetHidden()) sh.showSheet();
  });
  journal.push(plan.filter(function (o) { return o.visible === false && ss.getSheetByName(o.n); }).length + ' onglets techniques masqués');

  // Mise en forme des onglets de données
  var nb = 0;
  plan.forEach(function (o) {
    var sh = ss.getSheetByName(o.n); if (!sh || o.special) return;
    if (/^(00_DASHBOARD|12_SYNTHESE_STOCK|99_DIAGNOSTIC)$/.test(o.n) || /_backup_/i.test(o.n)) return; // mises en page propres à leur script
    if (formaterOngletDonnees_(sh, o)) nb++;
  });
  journal.push(nb + ' onglets de données mis en forme (en-tête figée, filtre, notes, formats)');

  ss.setActiveSheet(ss.getSheetByName(ORG.SOMMAIRE));
  Logger.log(journal.join('\n'));
  try { SpreadsheetApp.getUi().alert('Classeur réorganisé', journal.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { /* exécution hors interface */ }
  return journal;
}

/* Plan complet : familles connues + onglets reconnus par motif + onglets inconnus */
function planComplet_(ss) {
  var plan = [], connus = {};
  ORG_FAMILLES.forEach(function (f) {
    f.onglets.forEach(function (o) {
      var x = {}; for (var k in o) x[k] = o[k];
      x.famille = f.famille; x.couleur = f.couleur; x.special = (o.n === ORG.SOMMAIRE || o.n === ORG.TDB || o.n === ORG.RECH);
      plan.push(x); connus[o.n] = true;
    });
  });
  var autres = [];
  ss.getSheets().forEach(function (sh) {
    var n = sh.getName(); if (connus[n]) return;
    var m = ORG_MOTIFS.filter(function (r) { return r.re.test(n); })[0];
    var fam = m ? m.famille : 'Autres';
    var coul = (ORG_FAMILLES.filter(function (f) { return f.famille === fam; })[0] || { couleur: ORG.ORANGE }).couleur;
    autres.push({ n: n, famille: fam, couleur: coul, role: m ? m.role : 'Onglet non répertorié — à vérifier', par: m ? m.par : '?', mode: m ? m.mode : '?', visible: m ? m.visible : true });
  });
  // Insère chaque onglet reconnu à la fin de sa famille
  autres.forEach(function (o) {
    var idx = -1; plan.forEach(function (p, i) { if (p.famille === o.famille) idx = i; });
    if (idx < 0) plan.push(o); else plan.splice(idx + 1, 0, o);
  });
  return plan;
}

function feuille_(ss, nom, position) {
  var sh = ss.getSheetByName(nom);
  if (!sh) sh = ss.insertSheet(nom, position || 0);
  return sh;
}

/* ── 📖 SOMMAIRE ─────────────────────────────────────────────── */
function construireSommaire_(ss, plan) {
  var sh = feuille_(ss, ORG.SOMMAIRE, 0);
  sh.clear(); sh.clearNotes();
  try { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart(); } catch (e) {}
  sh.setHiddenGridlines(true);
  sh.getRange('A1').setValue('SPACERS — CRM BOUTIQUE · SOMMAIRE').setFontSize(18).setFontWeight('bold').setFontColor(ORG.NIGHT);
  sh.getRange('A2').setValue('Clique sur un nom d\'onglet pour l\'ouvrir. Légende : ✍️ à remplir à la main · 🤖 rempli automatiquement, ne pas modifier · 👀 consultation').setFontColor('#55606B').setFontStyle('italic');
  var lignes = [['Onglet', 'À quoi il sert', 'Alimenté par', 'Usage', 'À savoir']];
  var formats = [], fam = null, r = 4, liens = [];
  plan.forEach(function (o) {
    var sheet = ss.getSheetByName(o.n);
    if (!sheet && !o.special) return;
    if (o.famille !== fam) { fam = o.famille; lignes.push([fam.toUpperCase(), '', '', '', '']); formats.push({ ligne: lignes.length, type: 'famille', couleur: o.couleur }); }
    var usage = o.mode === 'saisie' ? '✍️ Saisie' : o.mode === 'auto+saisie' ? '🤖 + ✍️ compléter' : o.mode === 'lecture' ? '👀 Consultation' : '🤖 Automatique';
    lignes.push([o.n, o.role, o.par, usage, (o.visible === false ? '🙈 Masqué · ' : '') + (o.note || '')]);
    liens.push({ ligne: lignes.length, nom: o.n });
  });
  var rg = sh.getRange(r, 1, lignes.length, 5);
  rg.setValues(lignes).setVerticalAlignment('middle').setWrap(true).setFontSize(11);
  sh.getRange(r, 1, 1, 5).setBackground(ORG.NIGHT).setFontColor('#FFFFFF').setFontWeight('bold');
  formats.forEach(function (f) {
    sh.getRange(r + f.ligne - 1, 1, 1, 5).merge().setBackground(f.couleur).setFontColor(f.couleur === ORG.PERI || f.couleur === ORG.DAY ? ORG.NIGHT : '#FFFFFF').setFontWeight('bold').setFontSize(10);
  });
  // Liens cliquables vers chaque onglet (après création, pour avoir les identifiants)
  liens.forEach(function (l) {
    var s = ss.getSheetByName(l.nom); if (!s) return;
    sh.getRange(r + l.ligne - 1, 1).setFormula(fx_('=HYPERLINK("#gid=' + s.getSheetId() + '","' + l.nom.replace(/"/g, '""') + '")')).setFontWeight('bold');
  });
  sh.setColumnWidth(1, 230); sh.setColumnWidth(2, 470); sh.setColumnWidth(3, 230); sh.setColumnWidth(4, 150); sh.setColumnWidth(5, 330);
  sh.setFrozenRows(4);
  var fin = r + lignes.length + 1;
  var routine = [
    ['ROUTINE', ''],
    ['Réception de marchandise', 'Menu 📦 Stock boutique › Réception (entre en Réserve, coût HT, n° facture)'],
    ['Avant chaque match', 'Menu 📦 › Répartition Réserve → B1 / B2, puis sur chaque tablette : Synchronisation › « Mettre à jour le catalogue »'],
    ['Pendant le match', 'Les ventes arrivent seules dans 20_VENTES_LIVE (et sur le tableau de bord pilotage)'],
    ['Après le match', 'Clôturer sur la tablette, puis Synchroniser : les ventes arrivent dans 01_VENTES'],
    ['Un don / une casse', 'Menu 📦 › Sortie / don : pas de bon, pas de sortie'],
    ['Retrouver une info', 'Onglet 🔎 RECHERCHE : un nom, un email, un code billet, un produit…'],
    ['30 juin', 'Comptage physique puis Menu 📦 › Inventaire de clôture']
  ];
  sh.getRange(fin, 1, routine.length, 2).setValues(routine).setWrap(true).setVerticalAlignment('middle');
  sh.getRange(fin, 1, 1, 5).merge().setBackground(ORG.NIGHT).setFontColor('#FFFFFF').setFontWeight('bold');
  sh.getRange(fin + 1, 1, routine.length - 1, 1).setFontWeight('bold');
  for (var i = 1; i < routine.length; i++) sh.getRange(fin + i, 2, 1, 4).merge();
  sh.getRange(fin + routine.length + 1, 1).setValue('Mis à jour le ' + Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm') + ' — relancer organiserClasseur() après l\'ajout d\'un onglet.').setFontColor('#8A949E').setFontStyle('italic').setFontSize(9);
  avertir_(sh, 'Page générée par organiserClasseur() : elle sera réécrite.');
}

/* ── 📊 TABLEAU DE BORD (formules, rien à lancer) ───────────────── */
function construireTableauDeBord_(ss) {
  var sh = feuille_(ss, ORG.TDB, 1);
  sh.clear(); sh.clearNotes(); sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  try { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart(); } catch (e) {}
  if (sh.getMaxColumns() < 14) sh.insertColumnsAfter(sh.getMaxColumns(), 14 - sh.getMaxColumns());
  sh.setHiddenGridlines(true);
  var V = "'01_VENTES'", P = "'03_PRODUITS'", L = "'20_VENTES_LIVE'";

  sh.getRange('A1').setValue('SPACERS — BOUTIQUE · TABLEAU DE BORD').setFontSize(18).setFontWeight('bold').setFontColor(ORG.NIGHT);
  sh.getRange('A2').setValue('Saison').setFontWeight('bold');
  var saisons = saisonsConnues_(ss);
  sh.getRange('B2').setValue(saisonCourante_()).setBackground('#FFF7D6').setFontWeight('bold')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(saisons, true).setAllowInvalid(false).build());
  sh.getRange('C2').setValue('← choisir la saison. Source : 01_VENTES (ventes clôturées et synchronisées). Les « Offert » sont exclus du CA.').setFontColor('#55606B').setFontStyle('italic');

  // Ligne de KPI
  var cond = V + "!$L:$L,$B$2," + V + '!$M:$M,"<>Offert"';
  var kpis = [
    ['CA TTC', '=SUMIFS(' + V + '!$I:$I,' + cond + ')', '€'],
    ['Articles vendus', '=SUMIFS(' + V + '!$G:$G,' + cond + ')', 'n'],
    ['Matchs', '=IFERROR(COUNTUNIQUE(FILTER(' + V + '!$J$2:$J,' + V + '!$L$2:$L=$B$2,' + V + '!$J$2:$J<>"")),0)', 'n'],
    ['CA moyen / match', '=IFERROR(A5/E5,0)', '€'],
    ['dont CB', '=SUMIFS(' + V + '!$I:$I,' + V + '!$L:$L,$B$2,' + V + '!$M:$M,"CB")', '€'],
    ['dont Espèces', '=SUMIFS(' + V + '!$I:$I,' + V + '!$L:$L,$B$2,' + V + '!$M:$M,"Espèces")', '€'],
    ['Offerts (articles)', '=SUMIFS(' + V + '!$G:$G,' + V + '!$L:$L,$B$2,' + V + '!$M:$M,"Offert")', 'n']
  ];
  // KPI : libellé ligne 4, valeur ligne 5, une colonne sur deux (A, C, E, G, I, K, M)
  kpis.forEach(function (k, i) {
    var col = 1 + i * 2;
    sh.getRange(4, col, 1, 2).merge().setValue(k[0]).setFontColor('#55606B').setFontSize(9).setFontWeight('bold');
    var c = sh.getRange(5, col, 1, 2).merge().setFormula(fx_(k[1])).setFontSize(20).setFontWeight('bold').setFontColor(ORG.NIGHT).setHorizontalAlignment('left');
    c.setNumberFormat(k[2] === '€' ? '#,##0 "€"' : '0');
  });
  sh.getRange(4, 1, 2, 14).setBackground('#EEF2F8');

  // Tableaux (ligne 8) : CA par match · Top produits · Stock
  titre_(sh, 'A8', 'CA PAR MATCH');
  sh.getRange('A9').setFormula(fx_('=IFERROR(QUERY(' + V + '!$A:$M,"select J, sum(I), sum(G) where L = \'"&$B$2&"\' and M <> \'Offert\' and J is not null group by J order by sum(I) desc label J \'Match\', sum(I) \'CA TTC\', sum(G) \'Articles\'",1),"Aucune vente sur cette saison")'));
  titre_(sh, 'E8', 'TOP PRODUITS');
  sh.getRange('E9').setFormula(fx_('=IFERROR(QUERY(' + V + '!$A:$M,"select E, sum(G), sum(I) where L = \'"&$B$2&"\' and M <> \'Offert\' and E is not null group by E order by sum(I) desc limit 10 label E \'Produit\', sum(G) \'Qté\', sum(I) \'CA TTC\'",1),"Aucune vente sur cette saison")'));
  titre_(sh, 'I8', 'STOCK DU CATALOGUE ACTIF');
  // Produits actifs (VRAI/TRUE) ; cellules vides comptées 0
  // Colonnes de 03_PRODUITS lues sur les en-têtes (Stock_Boutique.gs ajoute des colonnes à droite)
  var shP = ss.getSheetByName('03_PRODUITS');
  var L_ = function (nom, defaut) { return lettreCol_(shP, nom, defaut); };
  var cNom = L_('produit', 'A'), cCout = L_('cout', 'D'), cB1 = L_('stock_B1', 'E'), cB2 = L_('stock_B2', 'F'),
      cAct = L_('actif', 'G'), cSeuil = L_('seuil_alerte', 'M'), cR = L_('stock_R', 'N');
  var num = function (c) { return 'IF(ISNUMBER(' + P + '!$' + c + '$2:$' + c + '),' + P + '!$' + c + '$2:$' + c + ',0)'; };
  var G_ = P + '!$' + cAct + '$2:$' + cAct, A_ = P + '!$' + cNom + '$2:$' + cNom;
  var actif = '((' + G_ + '=TRUE)+(' + G_ + '="VRAI")+(' + G_ + '="TRUE")>0)';
  var seuil = 'IF(ISNUMBER(' + P + '!$' + cSeuil + '$2:$' + cSeuil + '),' + P + '!$' + cSeuil + '$2:$' + cSeuil + ',3)';
  var tot = '(' + num(cR) + '+' + num(cB1) + '+' + num(cB2) + ')';
  sh.getRange('I9').setFormula(fx_('=ARRAYFORMULA(IFERROR({"Produit","Réserve","GP (B1)","VIP (B2)","Total";FILTER({' + A_ + ',' + num(cR) + ',' + num(cB1) + ',' + num(cB2) + ',' + tot + '},' + actif + ',' + A_ + '<>"")},"Catalogue vide"))'));
  sh.getRange('C9:C60').setNumberFormat('#,##0 "€"'); sh.getRange('B9:B60').setNumberFormat('#,##0 "€"');
  sh.getRange('G9:G60').setNumberFormat('#,##0 "€"');

  // Alertes (sous le CA par match, colonne A ligne 30)
  titre_(sh, 'A30', '⚠️ À TRAITER');
  sh.getRange('A31').setFormula(fx_('=ARRAYFORMULA(IFERROR(FILTER(' + A_ + '&" — stock bas ("&' + tot + '&")",' + actif + ',' + A_ + '<>"",' + tot + '<=' + seuil + '),"Aucun produit en stock bas"))'));
  sh.getRange('E31').setFormula(fx_('=ARRAYFORMULA(IFERROR(FILTER(' + A_ + '&" — coût d\'achat manquant (marge faussée)",' + actif + ',' + A_ + '<>"",' + num(cCout) + '=0),"Tous les coûts sont renseignés"))'));

  // Live du dernier match (pilotage)
  titre_(sh, 'I30', 'EN DIRECT — VENTES LIVE PAR MATCH');
  sh.getRange('I31').setFormula(fx_('=IFERROR(QUERY(' + L + '!$A:$S,"select E, count(C), sum(J), count(M) where C is not null group by E label E \'Match\', count(C) \'Paniers\', sum(J) \'CA TTC\', count(M) \'Billets scannés\'",1),"Aucune vente live pour l\'instant")'));
  sh.getRange('K31:K60').setNumberFormat('#,##0 "€"');

  [1, 5, 9].forEach(function (c) { sh.setColumnWidth(c, 230); });
  [2, 3, 4, 6, 7, 8, 10, 11, 12, 13].forEach(function (c) { sh.setColumnWidth(c, 90); });
  sh.setColumnWidth(14, 40);
  sh.setFrozenRows(5);
  avertir_(sh, 'Tableau de bord en formules : seule la saison (B2) se modifie.');
}
/** Lettre de la colonne portant cet en-tête (ligne 1), sinon la lettre par défaut. */
function lettreCol_(sh, nom, defaut) {
  if (!sh || sh.getLastColumn() < 1) return defaut;
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); });
  var i = h.indexOf(nom); if (i < 0) return defaut;
  var n = i + 1, l = '';
  while (n > 0) { var m = (n - 1) % 26; l = String.fromCharCode(65 + m) + l; n = Math.floor((n - 1) / 26); }
  return l;
}
/**
 * Adapte une formule écrite à l'anglaise (virgules) aux réglages régionaux du classeur.
 * En français : séparateur d'arguments « ; », séparateur de colonnes dans { } « \ ».
 */
function fx_(f) {
  if (ORG_SEP === null) ORG_SEP = detecterSeparateur_();
  if (ORG_SEP === ',') return f;
  var out = '', pile = [], q = false;
  for (var i = 0; i < f.length; i++) {
    var c = f.charAt(i);
    if (c === '"') { q = !q; out += c; continue; }
    if (q) { out += c; continue; }
    if (c === '(' || c === '{') pile.push(c);
    else if (c === ')' || c === '}') pile.pop();
    else if (c === ',') { out += (pile[pile.length - 1] === '{') ? '\\' : ';'; continue; }
    out += c;
  }
  return out;
}
var ORG_SEP = null;
/** Séparateur d'arguments selon les paramètres régionaux du classeur. */
function detecterSeparateur_() {
  var loc = String(SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetLocale() || '');
  return /^(en|ja|zh|ko|th|he|hi|ms|fil|sw)/i.test(loc) ? ',' : ';';
}
function titre_(sh, a1, txt) { sh.getRange(a1).setValue(txt).setFontWeight('bold').setFontColor(ORG.NIGHT).setFontSize(11); }

/* ── 🔎 RECHERCHE ─────────────────────────────────────────────── */
var ORG_RECH = [
  ['Ventes live (billets scannés)', '20_VENTES_LIVE', 'S'],
  ['Ventes (référence)', '01_VENTES', 'M'],
  ['Clients boutique', '23_CLIENTS_BOUTIQUE', 'K'],
  ['Produits', '03_PRODUITS', 'N'],
  ['Mouvements de stock', '11_MOUVEMENTS_STOCK', 'N'],
  ['Commandes web à retirer', '09_IMPORT_BOUTIQUE', 'R'],
  ['Achats fournisseurs', '02_ACHATS', 'K'],
  ['Matchs', '04_MATCHS', 'G']
];
function construireRecherche_(ss) {
  var sh = feuille_(ss, ORG.RECH, 2);
  sh.clear(); sh.clearNotes(); sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  try { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart(); } catch (e) {}
  sh.setHiddenGridlines(true);
  sh.getRange('A1').setValue('🔎 RECHERCHE').setFontSize(18).setFontWeight('bold').setFontColor(ORG.NIGHT);
  sh.getRange('A3').setValue('Mot à chercher').setFontWeight('bold');
  sh.getRange('A4').setValue('Où chercher').setFontWeight('bold');
  sh.getRange('B3:D3').merge().setValue('').setBackground('#FFF7D6').setFontSize(14).setBorder(true, true, true, true, false, false, ORG.NIGHT, SpreadsheetApp.BorderStyle.SOLID);
  var dispo = ORG_RECH.filter(function (t) { return ss.getSheetByName(t[1]); });
  sh.getRange('B4:D4').merge().setValue(dispo[0][0]).setBackground('#FFF7D6').setFontWeight('bold')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(dispo.map(function (t) { return t[0]; }), true).setAllowInvalid(false).build());
  sh.getRange('E3').setValue('Nom, prénom, email, code billet, produit, référence, match, bénévole… (majuscules et accents indifférents pour les lettres)').setFontColor('#55606B').setFontStyle('italic').setWrap(false);
  sh.getRange('A5').setValue('Résultats').setFontWeight('bold');
  sh.getRange('B5').setFormula(fx_('=IF(OR($B$3="",NOT(ISTEXT(A7))),0,MAX(0,COUNTA(A7:A)-1))')).setFontWeight('bold');

  var branches = dispo.map(function (t) {
    var q = "'" + t[1] + "'", R = q + '!A2:' + t[2], H = q + '!A1:' + t[2] + '1';
    return '"' + t[0] + '",IFERROR({' + H + ';FILTER(' + R + ',ISNUMBER(SEARCH($B$3,BYROW(' + R + ',LAMBDA(ligne,TEXTJOIN(" ",TRUE,ligne))))))},"Aucun résultat")';
  });
  sh.getRange('A7').setFormula(fx_('=IF($B$3="","← Tape un mot en B3",SWITCH($B$4,' + branches.join(',') + '))'));
  sh.getRange('A7:Z7').setFontWeight('bold').setBackground('#EEF2F8');
  sh.setFrozenRows(7);
  sh.setColumnWidth(1, 170);
  for (var c = 2; c <= 20; c++) sh.setColumnWidth(c, 130);
  avertir_(sh, 'Recherche en formules : saisir seulement les cellules jaunes (B3 et B4).');
}

/* ── Mise en forme d'un onglet de données ───────────────────────── */
function formaterOngletDonnees_(sh, o) {
  var lc = sh.getLastColumn(); if (lc < 1) return false;
  var hdr = sh.getRange(1, 1, 1, lc).getValues()[0];
  if (!hdr.some(function (h) { return String(h).trim(); })) return false;
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, lc).setBackground(ORG.NIGHT).setFontColor('#FFFFFF').setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');
  if (!sh.getFilter()) { try { sh.getRange(1, 1, sh.getMaxRows(), lc).createFilter(); } catch (e) {} }
  var notes = ORG_COLS[o.n] || {};
  var maxR = sh.getMaxRows();
  hdr.forEach(function (h, i) {
    h = String(h).trim(); if (!h) return;
    if (notes[h]) sh.getRange(1, i + 1).setNote(notes[h]);
    if (maxR > 1) {
      var col = sh.getRange(2, i + 1, maxR - 1, 1);
      if (ORG_DATES.test(h)) col.setNumberFormat('dd/mm/yyyy hh:mm');
      else if (ORG_EUROS.test(h) && !/compte|reference|id/i.test(h)) col.setNumberFormat('#,##0.00 "€"');
    }
  });
  if (o.mode === 'auto') avertir_(sh, 'Onglet rempli automatiquement (' + o.par + '). Une modification à la main peut fausser les chiffres.');
  return true;
}

/* Avertissement non bloquant (les scripts écrivent toujours) */
function avertir_(sh, msg) {
  var p = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  var prot = p.length ? p[0] : sh.protect();
  prot.setDescription(msg).setWarningOnly(true);
}

function saisonCourante_() { var d = new Date(), y = d.getFullYear(); return d.getMonth() >= 6 ? y + '-' + (y + 1) : (y - 1) + '-' + y; }
function saisonsConnues_(ss) {
  var set = {}; set[saisonCourante_()] = true;
  var v = ss.getSheetByName('01_VENTES');
  if (v && v.getLastRow() > 1) v.getRange(2, 12, v.getLastRow() - 1, 1).getValues().forEach(function (r) { if (/^\d{4}-\d{4}$/.test(String(r[0]))) set[r[0]] = true; });
  return Object.keys(set).sort().reverse();
}
