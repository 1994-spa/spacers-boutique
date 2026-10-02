/**
 * ============================================================================
 *  STOCK BOUTIQUE — Spacer's Toulouse Volley — Saison 2026-2027
 * ----------------------------------------------------------------------------
 *  Emplacements   : R = Réserve (réception) · B1 = Grand Public · B2 = VIP
 *  Prix           : prix d'achat HT (facture) · prix de vente TTC (caisse / Tickie)
 *                   → marges calculées en HT (TVA paramétrable : SB.TVA)
 *  Catalogue      : Maillot Blanc / Bleu Nuit / Bleu Ciel (S → XXL) + Écharpe
 *  Fonctions      : réception (prix d'achat HT → coût moyen pondéré), répartition,
 *                   sorties hors vente par ENVELOPPE budgétaire (bon numéroté,
 *                   demandeur, justificatif, compte Pennylane, contrôle TVA 73 €),
 *                   démarque, transferts, inventaire, inventaire de clôture 30/06,
 *                   retraits des ventes Tickie, synthèse stock / valorisation
 * ----------------------------------------------------------------------------
 *  INSTALLATION
 *   1. Coller ce fichier dans le projet Apps Script du CRM Boutique.
 *   2. Créer un fichier HTML nommé exactement « Stock_Sidebar ».
 *   3. Remplacer le script V3 par CRM_Boutique_V3.gs (V3.1) : son onOpen()
 *      appelle déjà menuStockBoutique_().
 *   4. Recharger le classeur → menu « 📦 Stock boutique » → Migration (1 fois).
 * ============================================================================
 */

const SB = {
  SAISON: '2026-2027',
  POINTS: { R: 'Réserve', B1: 'Grand Public', B2: 'VIP' },
  TVA: 0.20,                             // TVA sur les ventes boutique (0 si non assujetti)
  POINT_WEB: 'B1',                       // les ventes Tickie sont retirées au stand Grand Public
  TAILLES: ['S', 'M', 'L', 'XL', 'XXL'],
  SEUIL_ALERTE_DEFAUT: 3,
  COMPTE_ACHATS: '607000',
  CATALOGUE: [
    { code: 'MAI-BLC', modele: 'Maillot Blanc',     categorie: 'Maillots',    prix_vente: 75, tailles: true },
    { code: 'MAI-BNU', modele: 'Maillot Bleu Nuit', categorie: 'Maillots',    prix_vente: 75, tailles: true },
    { code: 'MAI-BCI', modele: 'Maillot Bleu Ciel', categorie: 'Maillots',    prix_vente: 75, tailles: true },
    { code: 'ECH',     modele: 'Écharpe',           categorie: 'Accessoires', prix_vente: 18, tailles: false }
  ],
  SEUIL_TVA_CADEAUX: 73,                 // € TTC par bénéficiaire et par exercice (CGI ann. II art. 206 IV 2 3°)
  ONGLET_ENVELOPPES: '14_ENVELOPPES_DOTATIONS',
  ENTETES_ENVELOPPES: ['enveloppe', 'responsable', 'budget_unites', 'budget_valeur_HT', 'compte_pennylane',
                       'regle_TVA_73', 'demarque', 'actif', 'commentaire'],
  // Comptes proposés : à valider avec l'expert-comptable
  ENVELOPPES_DEFAUT: [
    ['Contrepartie contractuelle partenaire', 'Partenariats', '', '', '', 'NON', 'NON', 'VRAI', 'Prévue au contrat de partenariat : fait partie de la prestation vendue, pas un cadeau'],
    ['Cadeau partenaire / prospect', 'Partenariats', '', '', '6234', 'OUI', 'NON', 'VRAI', 'Geste commercial hors contrat'],
    ['Protocole / collectivités / officiels', 'Direction', '', '', '6234', 'OUI', 'NON', 'VRAI', 'Élus et agents publics : rester sur des objets de faible valeur'],
    ['Jeu concours / réseaux sociaux', 'Communication', '', '', '6238', 'OUI', 'NON', 'VRAI', 'Justificatif : lien du post + règlement du jeu'],
    ["Animation match / Ticket d'or", 'Communication', '', '', '6238', 'OUI', 'NON', 'VRAI', ''],
    ['Presse / influence', 'Communication', '', '', '6234', 'OUI', 'NON', 'VRAI', ''],
    ['Joueurs / staff (dotation équipement)', 'Sportif', '', '', '6068', 'NON', 'NON', 'VRAI', 'Tenue de travail'],
    ['Bénévoles', 'Vie du club', '', '', '6068', 'NON', 'NON', 'VRAI', 'Tenue de mission'],
    ['Démarque — casse / défaut', 'Boutique', '', '', '', 'NON', 'OUI', 'VRAI', 'Pas de bénéficiaire ; constatée via la variation de stock'],
    ['Démarque — vol / perte / écart', 'Boutique', '', '', '', 'NON', 'OUI', 'VRAI', 'Pas de bénéficiaire ; constatée via la variation de stock'],
    ['Retour fournisseur', 'Boutique', '', '', '', 'NON', 'OUI', 'VRAI', 'Joindre le n° d\'avoir fournisseur']
  ],
  ONGLETS: { VENTES: '01', ACHATS: '02', PRODUITS: '03', MATCHS: '04', WEB: '09' },
  ONGLET_MOUVEMENTS: '11_MOUVEMENTS_STOCK',
  ONGLET_SYNTHESE: '12_SYNTHESE_STOCK',
  COLS_PRODUITS: ['ref_boutique', 'modele', 'taille', 'tickie_product_id', 'tickie_variant_id', 'seuil_alerte'],
  COLS_WEB: ['tickie_transaction_id', 'ref_boutique', 'variante', 'point_retrait', 'match_retrait', 'statut_retrait', 'date_retrait', 'statut_import'],
  COLS_ACHATS: ['ref_boutique', 'point_reception'],
  ENTETES_MOUVEMENTS: ['horodatage', 'type', 'ref_boutique', 'produit', 'point', 'quantite', 'cout_unitaire', 'valeur',
                       'type_dotation', 'beneficiaire', 'match', 'reference', 'commentaire', 'auteur',
                       'numero_bon', 'demandeur', 'compte_pennylane', 'valeur_TTC', 'alerte_tva'],
  ENTETES_01_ERRONES:  ['boutique_id', 'saison', 'mode_paiement', 'date', 'source', 'commande', 'email', 'produit',
                        'categorie', 'quantite', 'prix_unitaire', 'CA', 'match_associe'],
  ENTETES_01_CORRECTS: ['date', 'source', 'commande', 'email', 'produit', 'categorie', 'quantite', 'prix_unitaire',
                        'CA', 'match_associe', 'boutique_id', 'saison', 'mode_paiement']
};

/* ============================== MENU / PANNEAU ============================== */

function menuStockBoutique_() {
  SpreadsheetApp.getUi().createMenu('📦 Stock boutique')
    .addItem('Ouvrir le panneau stock', 'ouvrirPanneauStock')
    .addItem('Actualiser la synthèse', 'rafraichirSynthese')
    .addItem('Paramétrer les enveloppes de dotation', 'ouvrirEnveloppes')
    .addItem('Inventaire de clôture (photo du stock valorisé)', 'inventaireCloture')
    .addSeparator()
    .addItem('Migration saison 26-27 (une seule fois)', 'migrationSaison2627')
    .addToUi();
}

function ouvrirPanneauStock() {
  const html = HtmlService.createHtmlOutputFromFile('Stock_Sidebar').setTitle('Stock boutique');
  SpreadsheetApp.getUi().showSidebar(html);
}

function ouvrirEnveloppes() {
  const sh = sb_enveloppesOnglet_();
  SpreadsheetApp.getActive().setActiveSheet(sh);
  SpreadsheetApp.getActive().toast('Renseignez budgets (unités et/ou valeur HT) et responsables. Les comptes proposés sont à valider avec l\'expert-comptable.', 'Enveloppes', 8);
}

function rafraichirSynthese() {
  rafraichirSynthese_();
  SpreadsheetApp.getActive().toast('Synthèse stock mise à jour.', 'Stock boutique', 4);
}

/* ================================ MIGRATION ================================= */

function migrationSaison2627() {
  const ui = SpreadsheetApp.getUi();
  const rep = ui.alert('Migration saison 2026-2027',
    'Cette opération :\n' +
    '• sauvegarde 01_VENTES et 03_PRODUITS (copies _backup_)\n' +
    '• remet les en-têtes de 01_VENTES dans l\'ordre des données\n' +
    '• recalcule la saison des ventes d\'après leur date\n' +
    '• ajoute le catalogue 26-27 (3 maillots × 5 tailles + écharpe)\n' +
    '• désactive les anciens produits, sans les supprimer\n' +
    '• ajoute les colonnes de liaison Tickie (03, 09, 02)\n' +
    '• crée les onglets 11_MOUVEMENTS_STOCK et 12_SYNTHESE_STOCK\n\nContinuer ?',
    ui.ButtonSet.YES_NO);
  if (rep !== ui.Button.YES) return;

  const rapport = sb_avecVerrou_(() => {
    const ss = SpreadsheetApp.getActive();
    const r = [];
    const stamp = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyyMMdd_HHmm');
    const shV = sb_onglet_(SB.ONGLETS.VENTES);
    const shP = sb_onglet_(SB.ONGLETS.PRODUITS);
    [shV, shP].forEach(sh => sh.copyTo(ss).setName(sh.getName() + '_backup_' + stamp));
    r.push('✓ Sauvegardes créées (suffixe _backup_' + stamp + ').');

    // 1. En-têtes 01_VENTES
    const nb = SB.ENTETES_01_ERRONES.length;
    if (shV.getLastColumn() >= nb) {
      const h = shV.getRange(1, 1, 1, nb).getValues()[0].map(x => String(x).trim());
      if (h.join('|') === SB.ENTETES_01_ERRONES.join('|')) {
        shV.getRange(1, 1, 1, nb).setValues([SB.ENTETES_01_CORRECTS]);
        r.push('✓ 01_VENTES : en-têtes remis dans l\'ordre des données.');
      } else {
        r.push('• 01_VENTES : en-têtes laissés tels quels (ordre différent de celui attendu).');
      }
    }

    // 1b. Saisons des ventes (fonction de CRM_Boutique_V3.gs)
    if (typeof corrigerSaisonsVentes === 'function') r.push('✓ ' + corrigerSaisonsVentes());

    // 2. Catalogue 03_PRODUITS
    sb_assurerColonnes_(shP, SB.COLS_PRODUITS);
    const P = sb_lireProduits_();
    const refsCatalogue = [];
    const aAjouter = [];
    let adoptes = 0;
    SB.CATALOGUE.forEach(m => (m.tailles ? SB.TAILLES : ['TU']).forEach(t => {
      const ref = m.code + '-' + t;
      const nom = m.tailles ? m.modele + ' - ' + t : m.modele;
      refsCatalogue.push(ref);
      if (P.rows.some(x => x.ref === ref)) return;
      // reprise d'une ligne existante du même nom (ex. « Écharpe ») : on garde son stock et son coût
      const existant = P.rows.find(x => !x.ref && x.produit === nom);
      if (existant) {
        sb_set_(P, existant, 'ref_boutique', ref);
        sb_set_(P, existant, 'modele', m.modele);
        sb_set_(P, existant, 'taille', t);
        sb_set_(P, existant, 'actif', true);
        if (P.c.seuil_alerte) sb_set_(P, existant, 'seuil_alerte', SB.SEUIL_ALERTE_DEFAUT);
        adoptes++;
        return;
      }
      aAjouter.push({ ref, nom, modele: m.modele, taille: t, categorie: m.categorie, prix_vente: m.prix_vente });
    }));

    const desactives = [];
    P.rows.forEach(x => {
      if (x.actif && refsCatalogue.indexOf(x.ref) === -1) {
        sb_set_(P, x, 'actif', false);
        desactives.push(x.produit + ' (stock GP ' + x.B1 + ' / VIP ' + x.B2 + ')');
      }
    });

    if (aAjouter.length) {
      const larg = shP.getLastColumn();
      const lignes = aAjouter.map(a => {
        const l = new Array(larg).fill('');
        const set = (k, v) => { if (P.c[k]) l[P.c[k] - 1] = v; };
        set('produit', a.nom); set('categorie', a.categorie); set('prix_vente', a.prix_vente); set('cout', 0);
        set('stock_B1', 0); set('stock_B2', 0); set('actif', true);
        set('ref_boutique', a.ref); set('modele', a.modele); set('taille', a.taille);
        set('seuil_alerte', SB.SEUIL_ALERTE_DEFAUT);
        return l;
      });
      shP.getRange(shP.getLastRow() + 1, 1, lignes.length, larg).setValues(lignes);
    }
    r.push('✓ 03_PRODUITS : ' + aAjouter.length + ' référence(s) créée(s), ' + adoptes + ' reprise(s) avec leur stock.');
    if (desactives.length) r.push('• Désactivés (conservés) : ' + desactives.join(', ') + '.');

    // 3. Onglets 09 / 02 / 11
    try { sb_assurerColonnes_(sb_onglet_(SB.ONGLETS.WEB), SB.COLS_WEB); r.push('✓ Onglet 09 : colonnes Tickie ajoutées.'); }
    catch (e) { r.push('⚠ Onglet 09 : ' + e.message); }
    try { sb_assurerColonnes_(sb_onglet_(SB.ONGLETS.ACHATS), SB.COLS_ACHATS); r.push('✓ Onglet 02 : colonnes ref/point ajoutées.'); }
    catch (e) { r.push('⚠ Onglet 02 : ' + e.message); }
    sb_ongletOuCree_(SB.ONGLET_MOUVEMENTS, SB.ENTETES_MOUVEMENTS);
    r.push('✓ ' + SB.ONGLET_MOUVEMENTS + ' prêt.');

    rafraichirSynthese_();
    r.push('✓ ' + SB.ONGLET_SYNTHESE + ' généré.');
    r.push('\nÉtape suivante : saisir le stock via « Ouvrir le panneau stock » › Réception.');
    return r;
  });
  ui.alert('Migration terminée', rapport.join('\n'), ui.ButtonSet.OK);
}

/* ============================ DONNÉES DU PANNEAU ============================ */

function getDonneesPanneau() {
  const P = sb_lireProduits_();
  const modeles = [];
  P.rows.filter(x => x.actif && x.ref).forEach(x => {
    let m = modeles.find(y => y.modele === x.modele);
    if (!m) { m = { modele: x.modele, categorie: String(x.categorie), prix_vente: x.prix_vente, lignes: [] }; modeles.push(m); }
    m.lignes.push({ ref: x.ref, taille: x.taille, produit: x.produit, R: x.R, B1: x.B1, B2: x.B2, cout: x.cout });
  });
  return {
    modeles: modeles,
    points: SB.POINTS,
    enveloppes: sb_enveloppes_().filter(e => e.actif).map(e => ({
      nom: e.nom, demarque: e.demarque, tva73: e.tva73, compte: e.compte,
      reste_u: e.budget_u ? e.budget_u - e.conso_u : null, reste_v: e.budget_v ? Math.round((e.budget_v - e.conso_v) * 100) / 100 : null
    })),
    tva: SB.TVA,
    matchs: sb_listeMatchs_().concat(sb_mouvementsExercice_().map(m => m.match)).filter((v, i, a) => v && a.indexOf(v) === i),
    beneficiaires: (() => { const vus = {}; sb_mouvementsExercice_().forEach(m => { const k = sb_norm_(m.beneficiaire); if (k && !vus[k]) vus[k] = m.beneficiaire; });
      return Object.keys(vus).map(k => vus[k]).sort(); })(),
    retraits: sb_retraitsEnAttente_()
  };
}

/* ================================ ACTIONS =================================== */

/** Entrée en stock dans la RÉSERVE : quantités par taille, prix d'achat HT → coût moyen pondéré (CMUP HT). */
function enregistrerReception(p) {
  return sb_avecVerrou_(() => {
    const prixAchat = sb_num_(p.prix_achat);
    const nouveauPV = (p.prix_vente === '' || p.prix_vente === null || p.prix_vente === undefined) ? null : sb_num_(p.prix_vente);
    const brut = (p.lignes || []).map(l => ({ ref: l.ref, q: Math.round(sb_num_(l.R)) }));
    if (brut.some(l => l.q < 0)) throw new Error('Les quantités ne peuvent pas être négatives (utilisez l\'inventaire pour corriger).');
    const lignes = brut.filter(l => l.q > 0);
    if (!lignes.length && nouveauPV === null) throw new Error('Aucune quantité saisie.');
    if (lignes.length && !(prixAchat > 0)) throw new Error('Indiquez le prix d\'achat unitaire HT.');

    const P = sb_lireProduits_();
    let achats = null;
    try { achats = sb_onglet_(SB.ONGLETS.ACHATS); } catch (e) { achats = null; }
    const ca = achats ? sb_cols_(achats) : {};
    let total = 0;

    lignes.forEach(l => {
      const x = sb_trouverRef_(P, l.ref);
      const stockValorise = x.cout > 0 ? Math.max(0, x.R + x.B1 + x.B2) : 0;
      const cmup = (stockValorise * x.cout + l.q * prixAchat) / (stockValorise + l.q);
      sb_set_(P, x, 'stock_R', x.R + l.q);
      sb_set_(P, x, 'cout', Math.round(cmup * 100) / 100);
      sb_mouvement_({
        type: 'ENTREE_ACHAT', ref_boutique: x.ref, produit: x.produit, point: 'R', quantite: l.q,
        cout_unitaire: prixAchat, valeur: l.q * prixAchat, reference: p.reference || '', commentaire: p.fournisseur || ''
      });
      if (achats) {
        const ligneA = new Array(achats.getLastColumn()).fill('');
        const set = (k, v) => { if (ca[k]) ligneA[ca[k] - 1] = v; };
        set('date', new Date()); set('fournisseur', p.fournisseur || ''); set('produit', x.produit);
        set('categorie', x.categorie); set('quantite', l.q); set('cout_unitaire', prixAchat);
        set('cout_total', Math.round(l.q * prixAchat * 100) / 100); set('compte_pennylane', SB.COMPTE_ACHATS);
        set('reference_pennylane', p.reference || ''); set('ref_boutique', x.ref); set('point_reception', 'Réserve');
        achats.appendRow(ligneA);
      }
      total += l.q;
    });

    if (nouveauPV !== null) {
      if (!(nouveauPV > 0)) throw new Error('Prix de vente invalide.');
      P.rows.filter(x => x.actif && x.modele === p.modele).forEach(x => sb_set_(P, x, 'prix_vente', nouveauPV));
    }
    rafraichirSynthese_();
    return (total ? total + ' article(s) entré(s) en réserve' : 'Aucune entrée') +
           (nouveauPV !== null ? ' · prix de vente TTC ' + p.modele + ' : ' + nouveauPV + ' €' : '') + '.';
  });
}

/** Répartition de la réserve vers les stands : quantités par taille pour Grand Public et VIP. */
function enregistrerRepartition(p) {
  return sb_avecVerrou_(() => {
    const P = sb_lireProduits_();
    const lignes = (p.lignes || []).map(l => ({ ref: l.ref, B1: Math.round(sb_num_(l.B1)), B2: Math.round(sb_num_(l.B2)) }))
      .filter(l => l.B1 || l.B2);
    if (!lignes.length) throw new Error('Aucune quantité à répartir.');
    lignes.forEach(l => {
      const x = sb_trouverRef_(P, l.ref);
      if (l.B1 < 0 || l.B2 < 0) throw new Error('Quantité négative pour ' + x.produit + '.');
      if (l.B1 + l.B2 > x.R) throw new Error(x.produit + ' : ' + (l.B1 + l.B2) + ' demandé(s), ' + x.R + ' en réserve.');
    });
    const detail = [];
    lignes.forEach(l => {
      const x = sb_trouverRef_(P, l.ref);
      ['B1', 'B2'].forEach(pt => {
        if (!l[pt]) return;
        sb_set_(P, x, 'stock_R', x.R - l[pt]);
        sb_set_(P, x, 'stock_' + pt, x[pt] + l[pt]);
        sb_mouvement_({ type: 'TRANSFERT', ref_boutique: x.ref, produit: x.produit, point: 'R', quantite: -l[pt], cout_unitaire: x.cout, valeur: -l[pt] * x.cout, commentaire: 'répartition vers ' + SB.POINTS[pt] });
        sb_mouvement_({ type: 'TRANSFERT', ref_boutique: x.ref, produit: x.produit, point: pt, quantite: l[pt], cout_unitaire: x.cout, valeur: l[pt] * x.cout, commentaire: 'répartition depuis Réserve' });
      });
      detail.push(x.taille + ' (GP ' + l.B1 + ' / VIP ' + l.B2 + ')');
    });
    rafraichirSynthese_();
    return 'Répartition enregistrée : ' + detail.join(' · ') + '.';
  });
}

/**
 * Sortie hors vente, rattachée à une ENVELOPPE (partenaire, protocole, jeu concours, sportif, démarque…).
 * Bon numéroté DOT-2627-0001, valorisé au coût moyen HT, compte Pennylane de l'enveloppe,
 * contrôle du seuil TVA « cadeaux de faible valeur » (73 € TTC / bénéficiaire / exercice).
 */
function enregistrerDotation(p) {
  return sb_avecVerrou_(() => {
    const q = Math.round(sb_num_(p.quantite));
    if (!(q > 0)) throw new Error('Quantité invalide.');
    if (!SB.POINTS[p.point]) throw new Error('Emplacement de prélèvement invalide.');
    const env = sb_enveloppes_().find(e => e.nom === p.enveloppe && e.actif);
    if (!env) throw new Error('Choisissez une enveloppe.');
    const benef = String(p.beneficiaire || '').trim();
    if (!env.demarque && !benef) throw new Error('Indiquez le bénéficiaire.');
    if (!env.demarque && !String(p.match || '').trim()) throw new Error('Indiquez l\'événement ou l\'occasion (match, soirée partenaires, jeu concours…).');

    const P = sb_lireProduits_();
    const x = sb_trouverRef_(P, p.ref);
    if (x[p.point] < q) throw new Error('Stock insuffisant (' + SB.POINTS[p.point] + ' : ' + x[p.point] + ' disponible).');

    const valeurHT = Math.round(q * x.cout * 100) / 100;
    const valeurTTC = Math.round(valeurHT * (1 + SB.TVA) * 100) / 100;
    const hist = sb_mouvementsExercice_();

    // Seuil TVA : cumul TTC du bénéficiaire sur l'exercice, enveloppes soumises à la règle
    let alerte = '';
    if (env.tva73 && benef) {
      const cle = sb_norm_(benef);
      const envs73 = sb_enveloppes_().filter(e => e.tva73).map(e => e.nom);
      const cumul = hist.filter(m => m.type === 'DOTATION' && sb_norm_(m.beneficiaire) === cle && envs73.indexOf(m.enveloppe) !== -1)
        .reduce((s, m) => s + m.valeurTTC, 0);
      if (cumul + valeurTTC > SB.SEUIL_TVA_CADEAUX) {
        alerte = 'TVA à régulariser : ' + benef + ' cumule ' + (cumul + valeurTTC).toFixed(2) + ' € TTC sur l\'exercice (seuil ' + SB.SEUIL_TVA_CADEAUX + ' €)';
      }
    }

    // Budget de l'enveloppe (non bloquant)
    let budget = '';
    if (env.budget_u && env.conso_u + q > env.budget_u) budget = 'Budget unités dépassé (' + (env.conso_u + q) + ' / ' + env.budget_u + ')';
    if (env.budget_v && env.conso_v + valeurHT > env.budget_v) budget = (budget ? budget + ' · ' : '') + 'Budget valeur dépassé (' + (env.conso_v + valeurHT).toFixed(2) + ' / ' + env.budget_v + ' € HT)';

    const prefixe = 'DOT-' + SB.SAISON.slice(2, 4) + SB.SAISON.slice(7, 9) + '-';
    const numero = prefixe + String(hist.filter(m => String(m.numero_bon).indexOf(prefixe) === 0)
      .map(m => m.numero_bon).filter((v, i, a) => a.indexOf(v) === i).length + 1).padStart(4, '0');

    sb_set_(P, x, 'stock_' + p.point, x[p.point] - q);
    sb_mouvement_({
      type: env.demarque ? 'DEMARQUE' : 'DOTATION', ref_boutique: x.ref, produit: x.produit, point: p.point, quantite: -q,
      cout_unitaire: x.cout, valeur: -valeurHT, type_dotation: env.nom, beneficiaire: benef, match: p.match || '',
      reference: p.justificatif || '', commentaire: p.commentaire || '', numero_bon: numero, demandeur: p.demandeur || '',
      compte_pennylane: env.compte, valeur_TTC: -valeurTTC, alerte_tva: alerte ? 'OUI' : ''
    });
    rafraichirSynthese_();
    return numero + ' · ' + q + ' × ' + x.produit + (benef ? ' → ' + benef : '') + ' (' + env.nom + ', ' + valeurHT.toFixed(2) + ' € HT)' +
           (alerte ? '\n⚠ ' + alerte + '.' : '') + (budget ? '\n⚠ ' + budget + '.' : '');
  });
}

/** Transfert de stock entre le stand Grand Public et le stand VIP. */
function enregistrerTransfert(p) {
  return sb_avecVerrou_(() => {
    const q = Math.round(sb_num_(p.quantite));
    if (!(q > 0)) throw new Error('Quantité invalide.');
    if (!SB.POINTS[p.de] || !SB.POINTS[p.vers] || p.de === p.vers) throw new Error('Choisissez deux emplacements différents.');
    const P = sb_lireProduits_();
    const x = sb_trouverRef_(P, p.ref);
    if (x[p.de] < q) throw new Error('Stock insuffisant au point ' + SB.POINTS[p.de] + ' (' + x[p.de] + ' disponible).');
    sb_set_(P, x, 'stock_' + p.de, x[p.de] - q);
    sb_set_(P, x, 'stock_' + p.vers, x[p.vers] + q);
    sb_mouvement_({ type: 'TRANSFERT', ref_boutique: x.ref, produit: x.produit, point: p.de, quantite: -q, cout_unitaire: x.cout, valeur: -q * x.cout, commentaire: 'vers ' + SB.POINTS[p.vers] });
    sb_mouvement_({ type: 'TRANSFERT', ref_boutique: x.ref, produit: x.produit, point: p.vers, quantite: q, cout_unitaire: x.cout, valeur: q * x.cout, commentaire: 'depuis ' + SB.POINTS[p.de] });
    rafraichirSynthese_();
    return q + ' × ' + x.produit + ' : ' + SB.POINTS[p.de] + ' → ' + SB.POINTS[p.vers] + '.';
  });
}

/** Inventaire : saisie des quantités comptées, écarts enregistrés et valorisés. Champ vide = non compté. */
function enregistrerInventaire(p) {
  return sb_avecVerrou_(() => {
    const P = sb_lireProduits_();
    const ecarts = [];
    (p.lignes || []).forEach(l => {
      const x = sb_trouverRef_(P, l.ref);
      ['R', 'B1', 'B2'].forEach(pt => {
        if (l[pt] === '' || l[pt] === null || l[pt] === undefined) return;
        const compte = Math.round(sb_num_(l[pt]));
        if (compte < 0) throw new Error('Quantité comptée négative pour ' + x.produit + '.');
        const ecart = compte - x[pt];
        if (ecart === 0) return;
        sb_set_(P, x, 'stock_' + pt, compte);
        sb_mouvement_({
          type: 'AJUSTEMENT_INVENTAIRE', ref_boutique: x.ref, produit: x.produit, point: pt, quantite: ecart,
          cout_unitaire: x.cout, valeur: Math.round(ecart * x.cout * 100) / 100, commentaire: p.commentaire || 'Inventaire'
        });
        ecarts.push(x.produit + ' ' + SB.POINTS[pt] + ' ' + (ecart > 0 ? '+' : '') + ecart);
      });
    });
    rafraichirSynthese_();
    return ecarts.length ? ecarts.length + ' écart(s) corrigé(s) : ' + ecarts.join(' · ') : 'Inventaire conforme, aucun écart.';
  });
}

/** Retrait au comptoir d'un article acheté en ligne (le stock a déjà été sorti à la vente). */
function marquerRetire(ligne) {
  return sb_avecVerrou_(() => {
    const sh = sb_onglet_(SB.ONGLETS.WEB);
    const c = sb_cols_(sh);
    if (!c.statut_retrait) throw new Error('Colonnes Tickie absentes de l\'onglet 09 : lancer la migration.');
    const statut = String(sh.getRange(ligne, c.statut_retrait).getValue());
    if (statut.toLowerCase().indexOf('à retirer') !== 0) throw new Error('Cette ligne n\'est plus en attente (' + statut + ').');
    sh.getRange(ligne, c.statut_retrait).setValue('Retiré');
    if (c.date_retrait) sh.getRange(ligne, c.date_retrait).setValue(new Date());
    const produit = c.produit ? sh.getRange(ligne, c.produit).getValue() : '';
    return 'Retrait enregistré : ' + produit + '.';
  });
}

/** Photo du stock valorisé (coût moyen HT) à transmettre à l'expert-comptable (stock final, compte 37). */
function inventaireCloture() {
  const ui = SpreadsheetApp.getUi();
  const rep = ui.alert('Inventaire de clôture',
    'Faites d\'abord le comptage physique (panneau › Inventaire) pour que le stock soit juste.\n\nCréer la photo du stock valorisé maintenant ?',
    ui.ButtonSet.YES_NO);
  if (rep !== ui.Button.YES) return;
  const ss = SpreadsheetApp.getActive();
  const P = sb_lireProduits_();
  const nom = '15_INVENTAIRE_' + Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyyMMdd');
  const ancien = ss.getSheetByName(nom);
  if (ancien) ss.deleteSheet(ancien);
  const sh = ss.insertSheet(nom);
  const H = ['Réf', 'Produit', 'Actif', 'Réserve', 'Grand Public', 'VIP', 'Quantité totale', 'Coût moyen HT (€)', 'Valeur HT (€)'];
  const rows = P.rows.filter(x => x.R + x.B1 + x.B2 !== 0 || x.actif).map(x => {
    const t = x.R + x.B1 + x.B2;
    return [x.ref || '—', x.produit, x.actif ? 'oui' : 'non', x.R, x.B1, x.B2, t, x.cout, Math.round(t * x.cout * 100) / 100];
  });
  const total = rows.reduce((s, r) => s + r[8], 0);
  sh.getRange(1, 1).setValue('INVENTAIRE DE CLÔTURE — ' + Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm') +
    ' · valorisation au coût moyen pondéré HT').setFontWeight('bold').setFontSize(13);
  sh.getRange(3, 1, 1, H.length).setValues([H]).setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff');
  if (rows.length) {
    sh.getRange(4, 1, rows.length, H.length).setValues(rows);
    sh.getRange(4, 8, rows.length, 2).setNumberFormat('#,##0.00 "€"');
  }
  sh.getRange(5 + rows.length, 8, 1, 2).setValues([['TOTAL', Math.round(total * 100) / 100]]).setFontWeight('bold');
  sh.getRange(5 + rows.length, 9).setNumberFormat('#,##0.00 "€"');
  sh.getRange(7 + rows.length, 1).setValue('Signature du responsable : ____________________     Date : ____/____/______').setFontStyle('italic');
  sh.setFrozenRows(3);
  ss.setActiveSheet(sh);
  ui.alert('Inventaire de clôture', 'Onglet ' + nom + ' créé. Valeur du stock : ' + total.toFixed(2) + ' € HT.\nÀ transmettre à l\'expert-comptable (stock final).', ui.ButtonSet.OK);
}

/* ================================ SYNTHÈSE ================================== */

function rafraichirSynthese_() {
  const ss = SpreadsheetApp.getActive();
  const P = sb_lireProduits_();
  const actifs = P.rows.filter(x => x.actif && x.ref);

  // Mouvements : dotations et ventes web
  const agg = {};
  const parType = {};
  const mv = ss.getSheetByName(SB.ONGLET_MOUVEMENTS);
  if (mv && mv.getLastRow() > 1) {
    const cm = sb_cols_(mv);
    mv.getRange(2, 1, mv.getLastRow() - 1, mv.getLastColumn()).getValues().forEach(r => {
      const ref = String(r[cm.ref_boutique - 1]);
      const type = String(r[cm.type - 1]);
      const q = sb_num_(r[cm.quantite - 1]);
      const val = sb_num_(r[cm.valeur - 1]);
      const a = agg[ref] = agg[ref] || { dote: 0, valDote: 0, web: 0, demarque: 0 };
      if (type === 'DOTATION' || type === 'DEMARQUE') {
        if (type === 'DOTATION') { a.dote += -q; a.valDote += -val; } else { a.demarque += -q; }
        const t = String(r[cm.type_dotation - 1] || 'Autre');
        parType[t] = parType[t] || { q: 0, v: 0 };
        parType[t].q += -q; parType[t].v += -val;
      }
      if (type === 'VENTE_WEB') a.web += -q;
    });
  }

  // Ventes comptoir (01_VENTES), payées vs « Offert » saisi en caisse
  const comptoir = {};
  try {
    const v = sb_onglet_(SB.ONGLETS.VENTES);
    const cv = sb_cols_(v);
    if (cv.produit && cv.quantite && v.getLastRow() > 1) {
      v.getRange(2, 1, v.getLastRow() - 1, v.getLastColumn()).getValues().forEach(r => {
        if (cv.source && String(r[cv.source - 1]).trim() !== 'tablette') return;   // comptoir = ventes tablettes uniquement
        const n = String(r[cv.produit - 1]).trim();
        const q = sb_num_(r[cv.quantite - 1]);
        const offert = cv.mode_paiement && /offert/i.test(String(r[cv.mode_paiement - 1]));
        const o = comptoir[n] = comptoir[n] || { vendu: 0, offert: 0 };
        if (offert) o.offert += q; else o.vendu += q;
      });
    }
  } catch (e) { /* onglet 01 absent : synthèse sans ventes comptoir */ }

  const H = ['Réf', 'Produit', 'Réserve', 'Stock GP', 'Stock VIP', 'Total', 'Alerte', 'CMUP HT (€)', 'PV TTC (€)', 'PV HT (€)',
             'Marge unit. HT (€)', 'Valeur stock achat HT (€)', 'Valeur stock vente TTC (€)', 'Vendu comptoir', 'Vendu web',
             'Offert caisse', 'Doté', 'Valeur dotée HT (€)', 'Démarque'];
  const T = { va: 0, vv: 0, mh: 0, q: 0, d: 0, vd: 0 };
  const r2 = n => Math.round(n * 100) / 100;
  const rows = actifs.map(x => {
    const tot = x.R + x.B1 + x.B2;
    const pvHT = r2(x.prix_vente / (1 + SB.TVA));
    const a = agg[x.ref] || { dote: 0, valDote: 0, web: 0, demarque: 0 };
    const c = comptoir[x.produit] || { vendu: 0, offert: 0 };
    const alerte = tot < 0 ? 'NÉGATIF' : (tot <= x.seuil ? 'RÉASSORT' : '');
    T.va += tot * x.cout; T.vv += tot * x.prix_vente; T.mh += tot * (pvHT - x.cout); T.q += tot; T.d += a.dote; T.vd += a.valDote;
    return [x.ref, x.produit, x.R, x.B1, x.B2, tot, alerte, x.cout, x.prix_vente, pvHT, r2(pvHT - x.cout),
            r2(tot * x.cout), r2(tot * x.prix_vente), c.vendu, a.web, c.offert, a.dote, r2(a.valDote), a.demarque];
  });

  const sh = ss.getSheetByName(SB.ONGLET_SYNTHESE) || ss.insertSheet(SB.ONGLET_SYNTHESE);
  sh.clear();
  const EUR = '#,##0.00 "€"';
  sh.getRange(1, 1).setValue('SYNTHÈSE STOCK BOUTIQUE — ' + SB.SAISON + ' · mise à jour ' +
    Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm') + ' · TVA ' + Math.round(SB.TVA * 100) + ' %')
    .setFontWeight('bold').setFontSize(13);

  sh.getRange(3, 1, 2, 6).setValues([
    ['Valeur stock (achat HT)', 'Valeur stock (vente TTC)', 'Marge potentielle HT', 'Articles en stock', 'Articles dotés', 'Valeur dotée HT'],
    [r2(T.va), r2(T.vv), r2(T.mh), T.q, T.d, r2(T.vd)]
  ]);
  sh.getRange(3, 1, 1, 6).setFontWeight('bold').setBackground('#e8eef7');
  sh.getRange(4, 1, 1, 6).setFontSize(12);
  [1, 2, 3, 6].forEach(col => sh.getRange(4, col).setNumberFormat(EUR));

  sh.getRange(6, 1, 1, H.length).setValues([H]).setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff').setWrap(true);
  if (rows.length) {
    sh.getRange(7, 1, rows.length, H.length).setValues(rows);
    [8, 9, 10, 11, 12, 13, 18].forEach(col => sh.getRange(7, col, rows.length, 1).setNumberFormat(EUR));
    rows.forEach((r, i) => { if (r[6]) sh.getRange(7 + i, 1, 1, H.length).setBackground(r[6] === 'NÉGATIF' ? '#f8d7da' : '#fff3cd'); });
  }

  let y = 7 + rows.length + 2;
  const envs = sb_enveloppes_();
  sh.getRange(y, 1).setValue('SORTIES HORS VENTE PAR ENVELOPPE — exercice en cours').setFontWeight('bold');
  sh.getRange(y + 1, 1, 1, 8).setValues([['Enveloppe', 'Responsable', 'Compte', 'Quantité', 'Valeur HT (€)', 'Budget unités', 'Budget HT (€)', 'Reste']])
    .setFontWeight('bold').setBackground('#e8eef7');
  const D = envs.filter(e => e.actif || e.conso_u).map(e => {
    const reste = e.budget_v ? (Math.round((e.budget_v - e.conso_v) * 100) / 100) + ' €' : (e.budget_u ? (e.budget_u - e.conso_u) + ' u.' : '');
    return [e.nom, e.responsable, e.compte, e.conso_u, Math.round(e.conso_v * 100) / 100, e.budget_u || '', e.budget_v || '', reste];
  });
  if (D.length) {
    sh.getRange(y + 2, 1, D.length, 8).setValues(D);
    sh.getRange(y + 2, 5, D.length, 1).setNumberFormat(EUR);
    D.forEach((d, i) => { if (String(d[7]).indexOf('-') === 0) sh.getRange(y + 2 + i, 1, 1, 8).setBackground('#f8d7da'); });
  }

  // Bénéficiaires au-delà du seuil TVA
  const envs73 = envs.filter(e => e.tva73).map(e => e.nom);
  const parBenef = {};
  sb_mouvementsExercice_().filter(m => m.type === 'DOTATION' && m.beneficiaire && envs73.indexOf(m.enveloppe) !== -1).forEach(m => {
    const k = sb_norm_(m.beneficiaire);
    parBenef[k] = parBenef[k] || { nom: m.beneficiaire, ttc: 0, n: 0 };
    parBenef[k].ttc += m.valeurTTC; parBenef[k].n += m.quantite;
  });
  const B = Object.keys(parBenef).map(k => parBenef[k]).filter(b => b.ttc > SB.SEUIL_TVA_CADEAUX)
    .map(b => [b.nom, b.n, Math.round(b.ttc * 100) / 100]);
  let y2 = y + D.length + 4;
  sh.getRange(y2, 1).setValue('BÉNÉFICIAIRES AU-DELÀ DE ' + SB.SEUIL_TVA_CADEAUX + ' € TTC SUR L\'EXERCICE — TVA à régulariser (à signaler à l\'expert-comptable)').setFontWeight('bold');
  if (B.length) {
    sh.getRange(y2 + 1, 1, 1, 3).setValues([['Bénéficiaire', 'Articles', 'Cumul TTC (€)']]).setFontWeight('bold').setBackground('#e8eef7');
    sh.getRange(y2 + 2, 1, B.length, 3).setValues(B);
    sh.getRange(y2 + 2, 3, B.length, 1).setNumberFormat(EUR);
  } else {
    sh.getRange(y2 + 1, 1).setValue('Aucun.');
  }
  // Dons par bénéficiaire et par événement (hors démarque)
  const dons = sb_mouvementsExercice_().filter(m => m.type === 'DOTATION');
  const regrouper = (cle, libelle) => {
    const g = {};
    dons.forEach(m => {
      const brut = String(m[cle] || '').trim() || '(non renseigné)';
      const k = sb_norm_(brut) || '(non renseigne)';
      const o = g[k] = g[k] || { nom: brut, n: 0, v: 0, art: {} };
      o.n += m.quantite; o.v += m.valeurHT;
      o.art[m.produit] = (o.art[m.produit] || 0) + m.quantite;
    });
    return Object.keys(g).map(k => g[k]).sort((a, b) => b.v - a.v)
      .map(o => [o.nom, o.n, Math.round(o.v * 100) / 100, Object.keys(o.art).map(p => o.art[p] + ' × ' + p).join(', ')]);
  };
  let y3 = y2 + B.length + 4;
  [['beneficiaire', 'DONS PAR BÉNÉFICIAIRE (partenaire, collectivité, gagnant…)', 'Bénéficiaire'],
   ['match', 'DONS PAR ÉVÉNEMENT / OCCASION', 'Événement']].forEach(([cle, titre, col]) => {
    const T2 = regrouper(cle);
    sh.getRange(y3, 1).setValue(titre).setFontWeight('bold');
    sh.getRange(y3 + 1, 1, 1, 4).setValues([[col, 'Articles', 'Coût HT (€)', 'Détail']]).setFontWeight('bold').setBackground('#e8eef7');
    if (T2.length) {
      sh.getRange(y3 + 2, 1, T2.length, 4).setValues(T2);
      sh.getRange(y3 + 2, 3, T2.length, 1).setNumberFormat(EUR);
      const tot = T2.reduce((a, r) => [a[0] + r[1], a[1] + r[2]], [0, 0]);
      sh.getRange(y3 + 2 + T2.length, 1, 1, 3).setValues([['TOTAL DES DONS', tot[0], Math.round(tot[1] * 100) / 100]]).setFontWeight('bold');
      sh.getRange(y3 + 2 + T2.length, 3).setNumberFormat(EUR);
      y3 += T2.length + 5;
    } else {
      sh.getRange(y3 + 2, 1).setValue('Aucun don enregistré.');
      y3 += 5;
    }
  });
  y2 = y3 - B.length - 3;
  sh.getRange(y2 + B.length + 3, 1).setValue('Détail ligne à ligne : onglet ' + SB.ONGLET_MOUVEMENTS + ' (types DOTATION / DEMARQUE, n° de bon).')
    .setFontStyle('italic').setFontColor('#666666');
  sh.setColumnWidth(2, 190);
  for (let col = 3; col <= H.length; col++) sh.setColumnWidth(col, 105);
  sh.setFrozenRows(6);
}

/* ================================ OUTILS ==================================== */

function sb_avecVerrou_(fn) {
  const lock = LockService.getScriptLock();   // même verrou que le doPost des tablettes
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function sb_onglet_(cle) {
  const feuilles = SpreadsheetApp.getActive().getSheets().filter(s => s.getName().indexOf('_backup_') === -1);
  const sh = feuilles.find(s => s.getName().indexOf(cle) === 0) || feuilles.find(s => s.getName().indexOf(cle) !== -1);
  if (!sh) throw new Error('Onglet « ' + cle + '… » introuvable.');
  return sh;
}

function sb_ongletOuCree_(nom, entetes) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(nom);
  if (!sh) {
    sh = ss.insertSheet(nom);
    sh.getRange(1, 1, 1, entetes.length).setValues([entetes]).setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function sb_cols_(sh) {
  const m = {};
  if (sh.getLastColumn() < 1) return m;
  sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].forEach((v, i) => {
    const k = String(v).trim();
    if (k && !m[k]) m[k] = i + 1;
  });
  return m;
}

function sb_assurerColonnes_(sh, noms) {
  const c = sb_cols_(sh);
  let last = sh.getLastColumn();
  noms.forEach(n => {
    if (c[n]) return;
    last++;
    if (last > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    sh.getRange(1, last).setValue(n).setFontWeight('bold');
    c[n] = last;
  });
  return c;
}

function sb_lireProduits_() {
  const sh = sb_onglet_(SB.ONGLETS.PRODUITS);
  sb_assurerColonnes_(sh, ['stock_R']);
  const c = sb_cols_(sh);
  ['produit', 'prix_vente', 'cout', 'stock_B1', 'stock_B2', 'actif'].forEach(k => {
    if (!c[k]) throw new Error('Colonne « ' + k + ' » absente de ' + sh.getName() + ' (ligne 1).');
  });
  const n = sh.getLastRow() - 1;
  const data = n > 0 ? sh.getRange(2, 1, n, sh.getLastColumn()).getValues() : [];
  const g = (r, k) => (c[k] ? r[c[k] - 1] : '');
  const rows = data.map((r, i) => ({
    ligne: i + 2,
    ref: String(g(r, 'ref_boutique')).trim(),
    produit: String(g(r, 'produit')).trim(),
    categorie: g(r, 'categorie'),
    modele: String(g(r, 'modele')).trim() || String(g(r, 'produit')).trim(),
    taille: String(g(r, 'taille')).trim(),
    prix_vente: sb_num_(g(r, 'prix_vente')),
    cout: sb_num_(g(r, 'cout')),
    R: sb_num_(g(r, 'stock_R')),
    B1: sb_num_(g(r, 'stock_B1')),
    B2: sb_num_(g(r, 'stock_B2')),
    actif: sb_estActif_(g(r, 'actif')),
    seuil: g(r, 'seuil_alerte') === '' ? SB.SEUIL_ALERTE_DEFAUT : sb_num_(g(r, 'seuil_alerte'))
  })).filter(x => x.produit);
  return { sh: sh, c: c, rows: rows };
}

function sb_trouverRef_(P, ref) {
  const x = P.rows.find(r => r.ref === ref);
  if (!x) throw new Error('Référence inconnue : ' + ref);
  return x;
}

function sb_set_(P, x, champ, val) {
  if (!P.c[champ]) throw new Error('Colonne « ' + champ + ' » absente de 03_PRODUITS.');
  P.sh.getRange(x.ligne, P.c[champ]).setValue(val);
  const alias = { stock_R: 'R', stock_B1: 'B1', stock_B2: 'B2', ref_boutique: 'ref' };
  x[alias[champ] || champ] = val;
}

function sb_mouvement_(m) {
  const sh = sb_ongletOuCree_(SB.ONGLET_MOUVEMENTS, SB.ENTETES_MOUVEMENTS);
  const c = sb_assurerColonnes_(sh, SB.ENTETES_MOUVEMENTS);
  let auteur = '';
  try { auteur = Session.getActiveUser().getEmail() || ''; } catch (e) { auteur = ''; }
  const row = new Array(sh.getLastColumn()).fill('');
  const vals = Object.assign({}, m, { horodatage: new Date(), auteur: m.auteur || auteur });
  Object.keys(c).forEach(k => { if (vals[k] !== undefined) row[c[k] - 1] = vals[k]; });
  sh.appendRow(row);
}

function sb_enveloppesOnglet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SB.ONGLET_ENVELOPPES);
  if (!sh) {
    sh = ss.insertSheet(SB.ONGLET_ENVELOPPES);
    sh.getRange(1, 1, 1, SB.ENTETES_ENVELOPPES.length).setValues([SB.ENTETES_ENVELOPPES])
      .setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff');
    sh.getRange(2, 1, SB.ENVELOPPES_DEFAUT.length, SB.ENTETES_ENVELOPPES.length).setValues(SB.ENVELOPPES_DEFAUT);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 260);
    sh.setColumnWidth(9, 420);
  }
  return sh;
}

/** Enveloppes paramétrées + consommation de l'exercice en cours (unités, valeur HT). */
function sb_enveloppes_() {
  const sh = sb_enveloppesOnglet_();
  const c = sb_cols_(sh);
  const n = sh.getLastRow() - 1;
  const data = n > 0 ? sh.getRange(2, 1, n, sh.getLastColumn()).getValues() : [];
  const g = (r, k) => (c[k] ? r[c[k] - 1] : '');
  const conso = {};
  sb_mouvementsExercice_().filter(m => m.type === 'DOTATION' || m.type === 'DEMARQUE').forEach(m => {
    conso[m.enveloppe] = conso[m.enveloppe] || { u: 0, v: 0 };
    conso[m.enveloppe].u += m.quantite; conso[m.enveloppe].v += m.valeurHT;
  });
  return data.filter(r => String(g(r, 'enveloppe')).trim()).map(r => {
    const nom = String(g(r, 'enveloppe')).trim();
    const k = conso[nom] || { u: 0, v: 0 };
    return {
      nom: nom, responsable: String(g(r, 'responsable') || ''), compte: String(g(r, 'compte_pennylane') || ''),
      budget_u: sb_num_(g(r, 'budget_unites')), budget_v: sb_num_(g(r, 'budget_valeur_HT')),
      tva73: sb_estActif_(g(r, 'regle_TVA_73')), demarque: sb_estActif_(g(r, 'demarque')),
      actif: g(r, 'actif') === '' ? true : sb_estActif_(g(r, 'actif')), conso_u: k.u, conso_v: k.v
    };
  });
}

/** Sorties de l'exercice en cours (1er juillet → 30 juin), quantités et valeurs en positif. */
function sb_mouvementsExercice_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SB.ONGLET_MOUVEMENTS);
  if (!sh || sh.getLastRow() < 2) return [];
  const c = sb_cols_(sh);
  const now = new Date();
  const y = Number(Utilities.formatDate(now, 'Europe/Paris', 'yyyy'));
  const m = Number(Utilities.formatDate(now, 'Europe/Paris', 'M'));
  const debut = new Date(m >= 7 ? y : y - 1, 6, 1);
  const g = (r, k) => (c[k] ? r[c[k] - 1] : '');
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues()
    .filter(r => { const d = g(r, 'horodatage'); return d instanceof Date ? d >= debut : true; })
    .map(r => ({
      type: String(g(r, 'type')), enveloppe: String(g(r, 'type_dotation') || ''), beneficiaire: String(g(r, 'beneficiaire') || ''),
      quantite: -sb_num_(g(r, 'quantite')), valeurHT: -sb_num_(g(r, 'valeur')),
      valeurTTC: g(r, 'valeur_TTC') === '' ? -sb_num_(g(r, 'valeur')) * (1 + SB.TVA) : -sb_num_(g(r, 'valeur_TTC')),
      numero_bon: String(g(r, 'numero_bon') || ''), match: String(g(r, 'match') || ''), produit: String(g(r, 'produit') || '')
    }));
}

function sb_norm_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function sb_listeMatchs_() {
  try {
    const sh = sb_onglet_(SB.ONGLETS.MATCHS);
    const c = sb_cols_(sh);
    if (!c.club_visiteur || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues()
      .filter(r => r[c.club_visiteur - 1])
      .map(r => "Spacer's vs " + r[c.club_visiteur - 1] + (c.date && r[c.date - 1] ? ' (' + sb_fmt_(r[c.date - 1], 'dd/MM/yyyy') + ')' : ''));
  } catch (e) { return []; }
}

function sb_retraitsEnAttente_() {
  try {
    const sh = sb_onglet_(SB.ONGLETS.WEB);
    const c = sb_cols_(sh);
    if (!c.statut_retrait || sh.getLastRow() < 2) return [];
    const g = (r, k) => (c[k] ? String(r[c[k] - 1] instanceof Date ? sb_fmt_(r[c[k] - 1]) : r[c[k] - 1]) : '');
    return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues()
      .map((r, i) => ({ r: r, ligne: i + 2 }))
      .filter(o => String(o.r[c.statut_retrait - 1]).toLowerCase().indexOf('à retirer') === 0)
      .map(o => ({
        ligne: o.ligne, date: g(o.r, 'date'), email: g(o.r, 'email'), produit: g(o.r, 'produit'),
        quantite: g(o.r, 'quantite'), commande: g(o.r, 'commande'), statut: g(o.r, 'statut_retrait'), match: g(o.r, 'match_retrait')
      }));
  } catch (e) { return []; }
}

function sb_fmt_(d, motif) {
  return d instanceof Date ? Utilities.formatDate(d, 'Europe/Paris', motif || 'dd/MM/yyyy HH:mm') : String(d || '');
}

function sb_num_(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v === null || v === undefined ? '' : v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function sb_estActif_(v) {
  return v === true || /^(vrai|true|oui|1)$/i.test(String(v).trim());
}