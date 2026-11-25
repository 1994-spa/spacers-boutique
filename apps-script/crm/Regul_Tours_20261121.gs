/**
 * ============================================================================
 *  Regul_Tours_20261121.gs — CRM Boutique Spacers (projet Apps Script App_Boutique)
 *  Régularisation du match Spacer's vs Tours (samedi 21/11/2026)
 * ----------------------------------------------------------------------------
 *  Ce qu'Élise a signalé le soir du match, et que les tablettes n'ont pas pu enregistrer :
 *   1. 1 polo vendu 40 € (étiquette 40 €, tablette 50 €) ............ vente hors tablette
 *   2. 1 veste (sweat zippé) vendue 60 € (étiquette 60 €, tablette 70 €) vente hors tablette
 *   3. 1 bonnet vendu : le bonnet n'existe pas au catalogue ........... création + vente
 *   4. 3 écharpes add-on Tickie remises au stand GP (scan sans effet) .. retraits
 *   5. Inventaire « En boutique » : chaussettes 39-42 et sac non décomptés par le script
 *   6. 1 maillot Bleu Ciel L offert à Jean-Claude Tardif (noté « Maillot GP XL 62 € – Maillot JC »
 *      dans le journal d'Élise : ce n'est PAS une vente) ................ dotation (cadeau)
 *
 *  Mise à jour du 24/11 (réponses d'Élise) : polo = POLO FEMME XL, veste = SWEAT M, bonnet = BLEU,
 *  tout en GP. Réf. des bonnets alignées sur le fichier d'Élise : BON-BLE-TU / BON-BLC-TU.
 *  Décision du 09/11 maintenue : « En boutique » fait foi. Chaque sortie de stock GP de ce script
 *  est aussi reportée dans « En boutique » (ventes : par majInventaire via 21_LIGNES_LIVE ;
 *  cadeau : par la correction 6 ci-dessous), donc eb_simuler doit ensuite afficher 0 écart.
 *
 *  Ce que fait ▶ rg_appliquer (après ▶ rg_simuler), dans cet ordre et sous un seul verrou :
 *   - 03_PRODUITS : prix décidés par Clément le 23/11 — polos 40 €, sweats zippés (« vestes ») 60 €
 *     (étaient 50 € et 70 € dans le CRM, donc sur les tablettes) ;
 *   - 03_PRODUITS : crée « Bonnet Spacer's - Bleu / - Blanc » (BON-BLEU, BON-BLANC) avec leur stock
 *     (GP 5 + VIP 2 chacun, comptage d'Élise ; dépôt = commandés − boutiques), mouvements tracés ;
 *   - chaque vente hors tablette : ligne 01_VENTES (source « tablette », match Tours, B1),
 *     stock GP −1, mouvement VENTE_COMPTOIR, et lignes 20_VENTES_LIVE / 21_LIGNES_LIVE
 *     → le script inventaire les reporte ensuite dans « En boutique » et « Journal ventes » ;
 *   - retraits : remise des écharpes add-on via enregistrerRemisesRetraits_ (17_RETRAITS,
 *     17b_REMISES, stock GP −1 par écharpe, mouvement RETRAIT_ADDON) ;
 *   - inventaire : renomme les tableaux « TableauN » des chaussettes et des bonnets en
 *     B_Chaussettes_GP/VIP et B_Bonnet_GP/VIP, puis corrige chaussettes 39-42 GP 6→4, VIP 2→1
 *     et sac GP 3→2 (seulement si les valeurs actuelles sont bien 6, 2 et 3).
 *
 *  Sécurité : rien n'est écrit par rg_simuler. rg_appliquer est relançable : chaque étape vérifie
 *  qu'elle n'a pas déjà été faite (identifiants RG-TOURS-…). Une ligne incomplète dans RG_CONFIG
 *  (taille, moyen de paiement, prix du bonnet) est sautée et signalée, le reste est appliqué.
 *
 *  ORDRE :
 *   0. Remplacer Inventaire_Boutique.gs et Crm boutique v3.gs par les versions du 23/11 (livrées avec ce fichier).
 *   1. Compléter RG_CONFIG ci-dessous (les « ??? »).
 *   2. ▶ rg_importerRetraits   (lit Tickie → 17_RETRAITS ; n'écrit ni vente ni stock)
 *      Si Tickie répond 403 « transactions:list » : la clé API n'a pas ce droit ; on peut passer à l'étape 3
 *      (les 3 écharpes sortent quand même du stock, voir RG_CONFIG.RETRAITS.sansImport).
 *   3. ▶ rg_simuler            (lecture seule : rapport dans le journal d'exécution)
 *   4. ▶ rg_appliquer
 *   5. ▶ majInventaire (ou attendre 10 min) : « En boutique » et « Journal ventes » se mettent à jour.
 * ============================================================================
 */

const RG_CONFIG = {
  MATCH: "Spacer's vs Tours",
  EVENT_ID: '6ac6b890b569fba6814b9760',
  DATE_MATCH: new Date(2026, 10, 21, 21, 0, 0),        // 21/11/2026 21:00 (heure des messages d'Élise)
  PREFIXE: 'RG-TOURS-20261121',
  BENEVOLE: 'Élise (régularisation)',
  BOUTIQUE: 'B1',                                     // ventes et retraits faits à la Boutique GP

  // ── 0. Prix décidés par Clément le 23/11/2026 (les étiquettes étaient justes) ──
  PRIX: [
    { refs: /^POL-/,     prix: 40, libelle: 'Polos Mizuno (homme et femme)' },
    { refs: /^SWT-NAV-/, prix: 60, libelle: 'Sweats zippés Mizuno navy (« vestes »)' },
  ],

  // ── 1-3. Ventes hors tablette ─────────────────────────────────────────────
  // ref : référence exacte de 03_PRODUITS (taille comprise). mode : 'CB' ou 'Espèces'.
  // prix : montant encaissé.
  VENTES: [
    // prix = montant ENCAISSÉ ; prix_brut + remise_type si une remise a été faite (registre : billet −5 %, abonné −10 %).
    // Polo et veste : CB avec remise billet −5 % (Élise, 24/11 : paiements de 38 € et 57 € vus sur l'appli du TPE).
    { code: 'POLO',   ref: 'POL-W-XL',   prix: 38, prix_brut: 40, remise_type: 'billet -5%', mode: 'CB', note: 'polo femme XL non saisi : tablette encore à 50 €' },
    { code: 'VESTE',  ref: 'SWT-NAV-M',  prix: 57, prix_brut: 60, remise_type: 'billet -5%', mode: 'CB', note: 'sweat zippé M non saisi : tablette encore à 70 €' },
    // ⬇ À COMPLÉTER : mode 'CB' ou 'Espèces' (et prix / prix_brut / remise_type si remise) — sinon la vente du bonnet est sautée
    { code: 'BONNET', ref: 'BON-BLE-TU', prix: 10, mode: 'CB', note: 'bonnet bleu absent des tablettes — 10 € CB (Clément, 25/11)' },
  ],

  // ── 3. Bonnets à créer ────────────────────────────────────────────────────
  // prix_vente : à fixer par Clément (null = création sautée). cout : coût d'achat HT (facture) si connu.
  BONNETS: {
    modele: "Bonnet Spacer's",
    categorie: 'Accessoires',
    prix_vente: 10,     // Clément, 25/11/2026 : bonnet vendu 10 € TTC
    cout: 5.5,          // facture Monprinteur F20261030-996 : 5,50 € HT pièce
    couleurs: [
      // stock compté par Élise (« En boutique » 23/11) ; dépôt = commandés (10 bleus, 15 blancs) − GP − VIP
      // B1 / B2 = « En boutique » AVANT la vente de Tours (le bonnet bleu vendu sort ensuite par la vente : GP 5 → 4)
      // dépôt mis à 0 : il sera compté à l'inventaire du 26/11 (facture : 15 + 15, journal d'Élise : 10 bleus) — pas de stock supposé
      { ref: 'BON-BLE-TU', taille: 'Bleu',  B1: 5, B2: 2, R: 0 },
      { ref: 'BON-BLC-TU', taille: 'Blanc', B1: 5, B2: 2, R: 0 },
    ],
  },

  // ── 4. Écharpes add-on remises au stand ──────────────────────────────────
  RETRAITS: {
    quantite: 3,
    produit: /echarpe|écharpe/i,
    evenement: /tours/i,              // commandes du match de Tours…
    noms: [/rastol/i],                // …+ la commande de la semaine précédente citée par Élise
    benevole: 'Méline',
    ref: 'ECH-TU',
    cles: [],                         // si le choix est ambigu : clés 17_RETRAITS à remettre, ex. ['6ac…|echarpe']
    // 23/11 : la clé API Tickie du CRM n'a pas la permission « transactions:list » → import impossible.
    // true = sortir quand même les 3 écharpes du stock GP (remise sans commande rattachée, tracée dans 17b_REMISES).
    sansImport: true,
  },

  // ── 5. Corrections « En boutique » (ventes de Tours non reconnues par le script) ─────
  INVENTAIRE: [
    { famille: 'Chaussettes', stand: 'GP',  taille: '3942', attendu: 6, nouveau: 4, motif: '2 paires vendues à Tours (tablette GP)' },
    { famille: 'Chaussettes', stand: 'VIP', taille: '3942', attendu: 2, nouveau: 1, motif: '1 paire vendue à Tours (tablette VIP)' },
    { famille: 'Sac',         stand: 'GP',  taille: 'TU',   attendu: 3, nouveau: 2, motif: '1 sac à dos Team vendu à Tours (tablette GP)' },
    // XL confirmé par Clément le 25/11 ; attendu null = valeur lue au moment de l'application, moins 1
    { famille: 'Maillot Bleu clair', stand: 'GP', taille: 'XL', attendu: null, moins: 1, motif: '1 maillot Bleu Ciel XL offert à Jean-Claude Tardif (21/11)', siDotation: true },
  ],

  // ── 6. Cadeau (dotation) : sort du stock GP du CRM, sans chiffre d'affaires, bon DOT-2627-… ──
  DOTATION: {
    code: 'DOT-JC',
    ref: 'MAI-BCI-XL',
    quantite: 1,
    beneficiaire: 'Jean-Claude Tardif',
    // ⬇ À COMPLÉTER : nom EXACT de l'enveloppe (onglet 14_ENVELOPPES_DOTATIONS), par exemple :
    //   'Contrepartie contractuelle partenaire' · 'Cadeau partenaire / prospect' · 'Protocole / collectivités / officiels'
    //   'Bénévoles' · 'Joueurs / staff (dotation équipement)'
    enveloppe: '???',
    commentaire: 'noté « Maillot GP XL 62 € – Maillot JC » dans le journal ; Bleu Ciel (Élise, 24/11), taille XL (Clément, 25/11)',
  },
  TABLEAUX: [   // tableaux « TableauN » de l'onglet « En boutique » à renommer (titre du bloc → nom attendu par le script)
    { titre: /chaussettes/i, nom: 'B_Chaussettes' },
    { titre: /bonnets?/i,    nom: 'B_Bonnet' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
//  Menu (appelé par onOpen de Crm boutique v3.gs)
// ─────────────────────────────────────────────────────────────────────────────
function menuRegulTours_() {
  SpreadsheetApp.getUi().createMenu('🧾 Régul. Tours 21/11')
    .addItem('1. Importer les retraits Tickie', 'rg_importerRetraits')
    .addItem('2. Simuler (aucune écriture)', 'rg_simuler')
    .addItem('3. Appliquer', 'rg_appliquer')
    .addToUi();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Points d'entrée
// ─────────────────────────────────────────────────────────────────────────────

/** Tickie → 17_RETRAITS (commandes d'add-ons). N'écrit ni vente ni stock. */
function rg_importerRetraits() {
  let msg;
  try {
    msg = preparerRetraitsBillets();
  } catch (e) {
    msg = 'Import impossible : ' + e.message +
      (/transactions:list|403/.test(e.message)
        ? '\n\nLa clé API Tickie du CRM (propriété VIVENU_API_KEY) n\'a pas le droit de lire les commandes. ' +
          'Ajoutez la permission « transactions:list » à cette clé dans Tickie, puis relancez cette étape.' +
          '\n\nEn attendant, « Simuler » puis « Appliquer » sortent quand même les 3 écharpes du stock (RG_CONFIG.RETRAITS.sansImport).'
        : '');
    rg_afficher_('Retraits Tickie', msg);
    return msg;
  }
  rg_afficher_('Retraits Tickie importés', msg + '\n\nLancez ensuite « Simuler ».');
  return msg;
}

function rg_simuler() {
  const r = rg_executer_(false);
  rg_afficher_('Régularisation Tours — SIMULATION (rien n\'a été écrit)', r);
  return r;
}

function rg_appliquer() {
  const ui = rg_ui_();
  if (ui) {
    const ok = ui.alert('Régularisation Tours 21/11',
      'Écrire les régularisations dans le CRM et dans « En boutique » ?\n(Lancez d\'abord « Simuler » si ce n\'est pas fait.)',
      ui.ButtonSet.OK_CANCEL);
    if (ok !== ui.Button.OK) return 'Annulé.';
  }
  const r = rg_executer_(true);
  rg_afficher_('Régularisation Tours — APPLIQUÉE', r + '\n\nÉtape suivante : ▶ majInventaire (ou attendre 10 min), puis « Charger le match » sur les deux tablettes.');
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Moteur
// ─────────────────────────────────────────────────────────────────────────────
function rg_executer_(ecrire) {
  // Garde-fou : la synchro automatique « En boutique → CRM » annulerait les sorties de stock
  // tant que le script inventaire n'a pas reporté les ventes dans « En boutique ».
  const ebAuto = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'eb_auto_');
  if (ebAuto && ecrire) {
    throw new Error('La synchro automatique « En boutique → CRM » (eb_auto_) est active : arrêtez-la avant d\'appliquer ' +
      '(menu Synchro En boutique › arrêter, ou supprimer le déclencheur eb_auto_), puis relancez.');
  }
  const out = [];
  if (ebAuto) out.push('⚠ Déclencheur eb_auto_ actif : à arrêter avant « Appliquer ».');

  const tache = () => {
    GESTION_AUTEUR_ = 'régularisation Tours 21/11';
    // L'inventaire d'abord : les tableaux bonnets/chaussettes doivent porter leur nom B_… AVANT que
    // majInventaire (même verrou) ne lise les nouvelles lignes de 21_LIGNES_LIVE.
    out.push('— 5. Inventaire « En boutique » —'); rg_inventaire_(ecrire, out);
    out.push('— 0. Prix polos / sweats —');      rg_prix_(ecrire, out);
    out.push('— 3. Bonnets —');                 rg_bonnets_(ecrire, out);
    out.push('— 1-3. Ventes hors tablette —');  rg_ventes_(ecrire, out);
    out.push('— 4. Écharpes add-on —');         rg_retraits_(ecrire, out);
    if (!ecrire) { out.push('— 6. Cadeau —'); rg_dotation_(false, out); }
    if (ecrire) {
      try { rafraichirSynthese_(); } catch (e) { out.push('⚠ synthèse : ' + e.message); }
      try { reconstruireSaisons(); } catch (e) { out.push('⚠ saisons : ' + e.message); }
      try { mettreAJourDashboard(); } catch (e) { out.push('⚠ tableau de bord : ' + e.message); }
    }
  };
  if (ecrire) sb_avecVerrou_(tache); else tache();
  // enregistrerDotation prend lui-même le verrou : appelé APRÈS, hors du verrou ci-dessus
  if (ecrire) { out.push('— 6. Cadeau —'); try { rg_dotation_(true, out); } catch (e) { out.push('⚠ cadeau : ' + e.message); } }

  const texte = out.join('\n');
  Logger.log(texte);
  if (ecrire) logDiag('Regul Tours', 'INFO', texte.slice(0, 45000));
  return texte;
}

// ── 0. Prix ─────────────────────────────────────────────────────────────────
function rg_prix_(ecrire, out) {
  const P = sb_lireProduits_();
  RG_CONFIG.PRIX.forEach(rgl => {
    const cibles = P.rows.filter(x => rgl.refs.test(x.ref));
    const aChanger = cibles.filter(x => x.prix_vente !== rgl.prix);
    if (!cibles.length) { out.push('⏸ ' + rgl.libelle + ' : aucune référence trouvée.'); return; }
    if (!aChanger.length) { out.push(rgl.libelle + ' : déjà à ' + rgl.prix + ' €.'); return; }
    const avant = Array.from(new Set(aChanger.map(x => x.prix_vente))).join(' / ');
    out.push((ecrire ? '✓ ' : '→ ') + rgl.libelle + ' : ' + avant + ' € → ' + rgl.prix + ' € (' + aChanger.length + ' réf. : ' +
      aChanger.map(x => x.ref).join(', ') + ')');
    if (!ecrire) return;
    aChanger.forEach(x => sb_set_(P, x, 'prix_vente', rgl.prix));
    logDiag('gestion', 'INFO', 'Catalogue modifié (décision Clément 23/11, régul. Tours) : ' + rgl.libelle + ' → prix ' + rgl.prix + ' € (avant ' + avant + ' €)');
  });
}

// ── 3. Bonnets ──────────────────────────────────────────────────────────────
function rg_bonnets_(ecrire, out) {
  const B = RG_CONFIG.BONNETS;
  const P = sb_lireProduits_();
  const existants = B.couleurs.filter(c => P.rows.some(r => r.ref === c.ref));
  if (existants.length === B.couleurs.length) { out.push('Bonnets déjà au catalogue : rien à faire.'); return; }
  if (!(Number(B.prix_vente) > 0)) {
    out.push('⏸ Bonnets non créés : prix de vente à fixer dans RG_CONFIG.BONNETS.prix_vente.');
    return;
  }
  if (ecrire) sb_assurerColonnes_(P.sh, ['ref_boutique', 'modele', 'taille', 'seuil_alerte', 'stock_R', 'prix_partenaire']);
  const c = sb_cols_(P.sh);
  B.couleurs.forEach(col => {
    if (P.rows.some(r => r.ref === col.ref)) { out.push(col.ref + ' existe déjà.'); return; }
    const nom = B.modele + ' - ' + col.taille;
    out.push((ecrire ? '✓ créé ' : '→ créerait ') + col.ref + ' « ' + nom + ' » à ' + B.prix_vente + ' € · GP ' + col.B1 + ' · VIP ' + col.B2 + ' · dépôt ' + col.R +
      (B.cout ? '' : ' · ⚠ coût d\'achat à renseigner'));
    if (!ecrire) return;
    const row = new Array(P.sh.getLastColumn()).fill('');
    const set = (k, v) => { if (c[k]) row[c[k] - 1] = v; };
    set('produit', nom); set('categorie', B.categorie); set('prix_vente', Number(B.prix_vente)); set('cout', Number(B.cout) || 0);
    set('stock_B1', col.B1); set('stock_B2', col.B2); set('stock_R', col.R); set('actif', true);
    set('ref_boutique', col.ref); set('modele', B.modele); set('taille', col.taille); set('seuil_alerte', SB.SEUIL_ALERTE_DEFAUT);
    P.sh.appendRow(row);
    [['B1', col.B1], ['B2', col.B2], ['R', col.R]].forEach(([pt, q]) => {
      if (!q) return;
      sb_mouvement_({ type: 'AJUSTEMENT_INVENTAIRE', ref_boutique: col.ref, produit: nom, point: pt, quantite: q,
        cout_unitaire: Number(B.cout) || 0, valeur: q * (Number(B.cout) || 0), reference: RG_CONFIG.PREFIXE + '-BONNETS',
        commentaire: 'création du bonnet au catalogue — stock compté par Élise (En boutique) / dépôt = commandés − boutiques' });
    });
  });
}

// ── 1-3. Ventes hors tablette ───────────────────────────────────────────────
// Chaque étape a son propre témoin (relance sûre après une erreur) :
//   stock + mouvement  → 11_MOUVEMENTS_STOCK (reference = id)
//   lignes live        → 20_VENTES_LIVE / 21_LIGNES_LIVE (ID vente = id)
//   vente              → 01_VENTES (commande = id), écrite en dernier
function rg_ventes_(ecrire, out) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shV = getSheet(SHEET.VENTES);
  const shM = ss.getSheetByName(SB.ONGLET_MOUVEMENTS);
  const shLive = ss.getSheetByName('20_VENTES_LIVE'), shLig = ss.getSheetByName('21_LIGNES_LIVE');
  const ventes = rg_valeursColonne_(shV, COL_VENTE.COMMANDE + 1);
  const mvts = rg_valeursEntete_(shM, 'reference');
  const live = rg_valeursEntete_(shLive, 'ID vente');
  const lignes = rg_valeursEntete_(shLig, 'ID vente');

  RG_CONFIG.VENTES.forEach(v => {
    const id = RG_CONFIG.PREFIXE + '-' + v.code;
    const fait = { mvt: mvts.has(id), live: live.has(id), lig: lignes.has(id), vente: ventes.has(id) };
    if (fait.mvt && fait.live && fait.lig && fait.vente) { out.push(v.code + ' : déjà enregistrée (' + id + ').'); return; }
    const manque = [];
    if (!v.ref || /\?/.test(v.ref)) manque.push('référence (taille)');
    if (!/^(CB|Espèces)$/.test(String(v.mode || ''))) manque.push('moyen de paiement (CB ou Espèces)');
    const P = sb_lireProduits_();
    const x = manque.length ? null : P.rows.find(r => r.ref === v.ref);
    if (!manque.length && !x) manque.push('référence « ' + v.ref + ' » introuvable dans 03_PRODUITS (bonnets créés ?)');
    const pu = v.prix === null || v.prix === undefined ? (x ? x.prix_vente : null) : Number(v.prix);
    if (!manque.length && !(pu > 0)) manque.push('prix');
    if (manque.length) { out.push('⏸ ' + v.code + ' sautée — à compléter dans RG_CONFIG.VENTES : ' + manque.join(', ') + '.'); return; }

    const pt = RG_CONFIG.BOUTIQUE, avant = x[pt];
    out.push((ecrire ? '✓ ' : '→ ') + v.code + ' : ' + x.produit + ' · ' + pu.toFixed(2) + ' € ' + v.mode +
      (Number(v.prix_brut) > pu ? ' (' + Number(v.prix_brut).toFixed(2) + ' € − ' + (v.remise_type || 'remise') + ')' : '') +
      (fait.mvt ? ' · stock déjà sorti' : ' · stock ' + pt + ' ' + avant + '→' + (avant - 1) + (avant < 1 ? ' ⚠ stock négatif' : '')) +
      (fait.live || fait.lig || fait.vente ? ' (reprise : ' + Object.keys(fait).filter(k => fait[k]).join(', ') + ' déjà faits)' : ''));
    if (!ecrire) return;

    if (!fait.mvt) {
      sb_set_(P, x, 'stock_' + pt, avant - 1);
      sb_mouvement_({ type: 'VENTE_COMPTOIR', ref_boutique: x.ref, produit: x.produit, point: pt, quantite: -1,
        cout_unitaire: x.cout, valeur: -x.cout, match: RG_CONFIG.MATCH, reference: id,
        commentaire: 'régularisation : vendu hors tablette le 21/11 (' + v.note + ') · ' + v.mode });
    }
    const recu = new Date();
    if (!fait.live) rg_appendParEntetes_(shLive, {
      'Reçu le': recu, 'Horodatage': RG_CONFIG.DATE_MATCH, 'ID vente': id, 'ID événement Tickie': RG_CONFIG.EVENT_ID,
      'Match': RG_CONFIG.MATCH, 'Boutique': pt, 'Session': id, 'Bénévole': RG_CONFIG.BENEVOLE,
      'Mode': v.mode, 'Total €': pu, 'Articles': 1, 'Détail': x.produit + ' ×1 (hors tablette)'
    });
    if (!fait.lig) rg_appendParEntetes_(shLig, {
      'ID vente': id, 'Horodatage': RG_CONFIG.DATE_MATCH, 'ID événement Tickie': RG_CONFIG.EVENT_ID, 'Boutique': pt,
      'Réf.': x.ref, 'Produit': x.produit, 'Catégorie': String(x.categorie || ''), 'Qté': 1, 'PU TTC': pu, 'CA TTC': pu, 'Mode': v.mode
    });
    if (!fait.vente) {
      const cV = colsParNom_(shV);
      const ligne = new Array(Math.max(shV.getLastColumn(), COL_VENTE.MODE_PAIEMENT + 1)).fill('');
      ligne[COL_VENTE.DATE] = RG_CONFIG.DATE_MATCH; ligne[COL_VENTE.SOURCE] = 'tablette'; ligne[COL_VENTE.COMMANDE] = id;
      ligne[COL_VENTE.PRODUIT] = x.produit; ligne[COL_VENTE.CATEGORIE] = String(x.categorie || '');
      ligne[COL_VENTE.QUANTITE] = 1; ligne[COL_VENTE.PRIX_UNITAIRE] = pu; ligne[COL_VENTE.CA] = Math.round(pu * 100) / 100;
      ligne[COL_VENTE.MATCH_ASSOCIE] = RG_CONFIG.MATCH; ligne[COL_VENTE.BOUTIQUE_ID] = pt;
      ligne[COL_VENTE.SAISON] = saisonDepuisDate_(RG_CONFIG.DATE_MATCH); ligne[COL_VENTE.MODE_PAIEMENT] = v.mode;
      const setV = (k, val) => { if (cV[k]) ligne[cV[k] - 1] = val; };
      const brut = Number(v.prix_brut) > 0 ? Number(v.prix_brut) : pu;
      setV('prix_brut', brut); setV('remise', Math.round((brut - pu) * 100) / 100);
      setV('remise_type', (v.remise_type ? v.remise_type + ' · ' : '') + 'régularisation hors tablette');
      setV('ID vente', id);
      shV.appendRow(ligne);
    }
  });
}

// ── 6. Cadeau (dotation) ────────────────────────────────────────────────────
function rg_dotation_(ecrire, out) {
  const D = RG_CONFIG.DOTATION;
  const id = RG_CONFIG.PREFIXE + '-' + D.code;
  const shM = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SB.ONGLET_MOUVEMENTS);
  if (rg_valeursEntete_(shM, 'reference').has(id)) { out.push(D.code + ' : déjà enregistré (' + id + ').'); return; }
  if (!D.enveloppe || /\?/.test(D.enveloppe)) { out.push('⏸ Cadeau sauté — à compléter dans RG_CONFIG.DOTATION.enveloppe.'); return; }
  const env = sb_enveloppes_().find(e => e.nom === D.enveloppe && e.actif);
  if (!env) { out.push('⏸ Cadeau sauté — enveloppe « ' + D.enveloppe + ' » absente ou inactive dans 14_ENVELOPPES_DOTATIONS.'); return; }
  const P = sb_lireProduits_();
  const x = P.rows.find(r => r.ref === D.ref);
  if (!x) { out.push('⏸ Cadeau sauté — référence ' + D.ref + ' introuvable.'); return; }
  const pt = RG_CONFIG.BOUTIQUE;
  out.push((ecrire ? '✓ ' : '→ ') + D.quantite + ' × ' + x.produit + ' offert à ' + D.beneficiaire + ' (' + D.enveloppe + ') · stock ' + pt + ' ' +
    x[pt] + '→' + (x[pt] - D.quantite) + ' · aucun chiffre d\'affaires');
  if (!ecrire) return;
  const r = enregistrerDotation({ ref: D.ref, quantite: D.quantite, point: pt, enveloppe: D.enveloppe, beneficiaire: D.beneficiaire,
    match: RG_CONFIG.MATCH, justificatif: id, commentaire: D.commentaire, demandeur: 'Élise' });
  out.push('  bon : ' + r);
}

function rg_valeursColonne_(sh, col) {
  if (!sh || sh.getLastRow() < 2) return new Set();
  return new Set(sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0])));
}
function rg_valeursEntete_(sh, entete) {
  if (!sh || sh.getLastColumn() < 1) return new Set();
  const ent = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v).trim());
  const i = ent.indexOf(entete);
  return i < 0 ? new Set() : rg_valeursColonne_(sh, i + 1);
}

// ── 4. Écharpes add-on ──────────────────────────────────────────────────────
function rg_retraits_(ecrire, out) {
  const R = RG_CONFIG.RETRAITS;
  const shJ = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RETRAITS_CFG.FEUILLE_REMISES);
  const dejaFaits = shJ && shJ.getLastRow() > 1
    ? shJ.getRange(2, 1, shJ.getLastRow() - 1, 1).getValues().map(r => String(r[0])).filter(id => id.indexOf(RG_CONFIG.PREFIXE) === 0)
    : [];
  if (dejaFaits.length) { out.push('Retraits déjà enregistrés (' + dejaFaits.length + ' remise(s) ' + RG_CONFIG.PREFIXE + '-RET-…).'); return; }

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RETRAITS_CFG.FEUILLE);
  const I = retraitsIdx_(RETRAITS_ENTETES);
  const data = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, RETRAITS_ENTETES.length).getValues() : [];
  const majMax = data.reduce((m, r) => (r[I.maj] instanceof Date && r[I.maj] > m ? r[I.maj] : m), new Date(0));
  out.push('17_RETRAITS : ' + data.length + ' ligne(s), dernière mise à jour ' +
    Utilities.formatDate(majMax, 'Europe/Paris', 'dd/MM/yyyy HH:mm') + '.');

  const reste = r => (Number(r[I.quantite]) || 0) - (Number(r[I.qte_remise]) || 0);
  const ouverts = data.filter(r => r[I.statut] !== RETRAITS_STATUT.ANNULE && r[I.statut] !== RETRAITS_STATUT.REMIS && reste(r) > 0 &&
    R.produit.test(String(r[I.produit])));
  let choisis;
  if (R.cles && R.cles.length) {
    choisis = ouverts.filter(r => R.cles.indexOf(String(r[I.cle])) >= 0);
  } else {
    choisis = ouverts.filter(r => R.evenement.test(String(r[I.evenement])) ||
      R.noms.some(n => n.test(String(r[I.nom]) + ' ' + String(r[I.prenom]))));
  }
  const total = choisis.reduce((s, r) => s + reste(r), 0);
  choisis.forEach(r => out.push('  · ' + r[I.cle] + ' — ' + r[I.prenom] + ' ' + String(r[I.nom]).charAt(0) + '. · ' + r[I.evenement] +
    ' · ' + reste(r) + ' à remettre'));
  if (total !== R.quantite) {
    if (total === 0 && R.sansImport) { rg_retraitsSansImport_(ecrire, out); return; }
    out.push('⏸ ' + total + ' écharpe(s) trouvée(s) pour ' + R.quantite + ' remises par Méline : choix ambigu. ' +
      'Indiquez les clés exactes dans RG_CONFIG.RETRAITS.cles (liste ci-dessus), puis relancez.');
    return;
  }
  const remises = choisis.map(r => ({
    id: RG_CONFIG.PREFIXE + '-RET-' + String(r[I.cle]).replace(/[^A-Za-z0-9]/g, '').slice(-24),
    horodatage: RG_CONFIG.DATE_MATCH.toISOString(), cle: String(r[I.cle]), produit: String(r[I.produit]),
    quantite: reste(r), taille: '', ref: R.ref, stand: RG_CONFIG.BOUTIQUE, benevole: R.benevole, match: RG_CONFIG.MATCH
  }));
  if (!ecrire) { out.push('→ ' + total + ' remise(s) d\'écharpe à enregistrer (stock GP −' + total + ').'); return; }
  const res = enregistrerRemisesRetraits_({ remises: remises });
  out.push('✓ ' + res.enregistrees + ' remise(s) enregistrée(s), ' + res.doublons + ' doublon(s), ' + res.inconnues + ' inconnue(s)' +
    (res.stock_negatif.length ? ' · ⚠ stock négatif : ' + res.stock_negatif.join(', ') : '') + '.');
}

/**
 * Commandes Tickie non lisibles (permission « transactions:list » absente) : les écharpes remises sortent
 * quand même du stock GP. Une ligne 17b_REMISES sans commande rattachée garde la trace (et le script
 * inventaire la reporte dans « En boutique »). Quand l'import Tickie fonctionnera, ces 3 commandes
 * apparaîtront « À remettre » dans 17_RETRAITS : les passer à « Remis » à la main, sans nouvelle remise.
 */
function rg_retraitsSansImport_(ecrire, out) {
  const R = RG_CONFIG.RETRAITS, pt = RG_CONFIG.BOUTIQUE, id = RG_CONFIG.PREFIXE + '-RET-SANSIMPORT';
  const P = sb_lireProduits_();
  const x = P.rows.find(r => r.ref === R.ref);
  if (!x) { out.push('⏸ Référence ' + R.ref + ' introuvable.'); return; }
  out.push((ecrire ? '✓ ' : '→ ') + R.quantite + ' écharpe(s) add-on remise(s) sans commande rattachée (import Tickie impossible) · stock ' +
    pt + ' ' + x[pt] + '→' + (x[pt] - R.quantite) + ' · à pointer « Remis » dans 17_RETRAITS quand l\'import Tickie marchera.');
  if (!ecrire) return;
  sb_set_(P, x, 'stock_' + pt, x[pt] - R.quantite);
  sb_mouvement_({ type: 'RETRAIT_ADDON', ref_boutique: x.ref, produit: x.produit, point: pt, quantite: -R.quantite,
    cout_unitaire: x.cout, valeur: -R.quantite * x.cout, match: RG_CONFIG.MATCH, reference: id,
    commentaire: 'régularisation : ' + R.quantite + ' écharpes add-on Tickie remises au stand le 21/11 par ' + R.benevole +
      ' (scan sans effet, commandes non importées)' });
  const shJ = retraitsFeuilleRemises_();
  const ligne = RETRAITS_ENTETES_REMISES.map(h => ({
    id_remise: id, horodatage: RG_CONFIG.DATE_MATCH, cle: '', transaction_id: '', produit: x.produit, quantite: R.quantite,
    taille: '', ref: x.ref, stand: pt, benevole: R.benevole, match: RG_CONFIG.MATCH, recu_le: new Date(),
    stock: 'décompté ' + pt + ' — régul. sans import Tickie (commandes à pointer « Remis » après import)'
  })[h] ?? '');
  shJ.appendRow(ligne);
}

// ── 5. Inventaire « En boutique » ───────────────────────────────────────────
function rg_inventaire_(ecrire, out) {
  const ss = invSS_();
  const sh = ss.getSheetByName('En boutique');
  if (!sh) { out.push('⏸ Onglet « En boutique » introuvable.'); return; }

  // a. Renommer les tableaux « TableauN » des chaussettes et des bonnets
  const meta = Sheets.Spreadsheets.get(ss.getId(), { fields: 'sheets(properties(sheetId,title),tables(tableId,name,range))' });
  const feuille = (meta.sheets || []).filter(s => s.properties.title === 'En boutique')[0] || { tables: [] };
  const pris = new Set((meta.sheets || []).reduce((a, s) => a.concat((s.tables || []).map(t => t.name)), []));
  const requetes = [];
  (feuille.tables || []).forEach(t => {
    if (!/^Tableau\d+$/i.test(String(t.name))) return;
    const r0 = (t.range.startRowIndex || 0) + 1, c0 = (t.range.startColumnIndex || 0) + 1;
    const titre = rg_titreBloc_(sh, r0, c0), stand = rg_standBloc_(sh, r0, c0);
    const regle = RG_CONFIG.TABLEAUX.filter(x => x.titre.test(titre))[0];
    if (!regle || !stand) return;
    const nom = regle.nom + '_' + stand;
    if (pris.has(nom)) { out.push('Tableau ' + nom + ' existe déjà : ' + t.name + ' non renommé.'); return; }
    pris.add(nom);
    out.push((ecrire ? '✓ renommé ' : '→ renommerait ') + t.name + ' (' + sh.getRange(r0, c0).getA1Notation() + ', bloc « ' + titre + ' » ' + stand + ') en ' + nom);
    requetes.push({ updateTable: { table: { tableId: t.tableId, name: nom }, fields: 'name' } });
  });
  if (!requetes.length) out.push('Tableaux chaussettes / bonnets : rien à renommer.');
  if (ecrire && requetes.length) {
    Sheets.Spreadsheets.batchUpdate({ requests: requetes }, ss.getId());
    SpreadsheetApp.flush();
  }

  // b. Corrections de stock (seulement si la valeur actuelle est celle attendue)
  const log = ss.getSheetByName(INV.JOURNAL);
  const deja = new Set(log && log.getLastRow() > 1 ? log.getRange(2, 1, log.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : []);
  let tableaux;
  try { tableaux = invTableaux_(null); } catch (e) { out.push('⏸ Lecture des tableaux impossible : ' + e.message); return; }
  const traces = [];
  RG_CONFIG.INVENTAIRE.forEach(k => {
    const cle = RG_CONFIG.PREFIXE + '|' + k.famille + '|' + k.stand + '|' + k.taille;
    if (deja.has(cle)) { out.push(k.famille + ' ' + k.stand + ' ' + k.taille + ' : déjà corrigé.'); return; }
    // le cadeau (étape 6) et sa correction « En boutique » passent ensemble
    if (k.siDotation && (!RG_CONFIG.DOTATION.enveloppe || /\?/.test(RG_CONFIG.DOTATION.enveloppe))) { out.push('⏸ ' + k.famille + ' ' + k.stand + ' ' + k.taille + ' : attend l\'enveloppe du cadeau (étape 6).'); return; }
    // en simulation, le tableau peut encore s'appeler « TableauN » : recherche par famille OU par position
    let t = tableaux.filter(x => x.onglet === 'En boutique' && x.famille && x.famille.nom === k.famille && x.stand === k.stand)[0];
    if (!t && !ecrire) { out.push('→ ' + k.famille + ' ' + k.stand + ' : sera lisible après le renommage (' + k.attendu + '→' + k.nouveau + ' si la valeur est bien ' + k.attendu + ').'); return; }
    if (!t) { out.push('⏸ ' + k.famille + ' ' + k.stand + ' : tableau introuvable.'); return; }
    const l = t.lignes.filter(x => x.taille === invNormTaille_(k.taille))[0] || (t.lignes.length === 1 ? t.lignes[0] : null);
    if (!l) { out.push('⏸ ' + k.famille + ' ' + k.stand + ' : taille ' + k.taille + ' absente de ' + t.nom + '.'); return; }
    if (k.attendu === null) k = Object.assign({}, k, { attendu: l.valeur, nouveau: Number(l.valeur) - (k.moins || 1) });   // 25/11 : sortie relative
    if (l.valeur !== k.attendu) {
      out.push('⏸ ' + k.famille + ' ' + k.stand + ' ' + k.taille + ' : valeur actuelle ' + l.valeur + ' (attendu ' + k.attendu + ') — déjà corrigé à la main ? Laissé tel quel.');
      return;
    }
    out.push((ecrire ? '✓ ' : '→ ') + k.famille + ' ' + k.stand + ' ' + k.taille + ' : ' + k.attendu + '→' + k.nouveau + ' (' + k.motif + ')');
    if (!ecrire) return;
    l.range.setValue(k.nouveau);
    traces.push([cle, new Date(), RG_CONFIG.DATE_MATCH, 'Régularisation', RG_CONFIG.MATCH, k.stand, k.famille, k.taille,
      k.attendu - k.nouveau, k.attendu, k.nouveau, '', '', 'OK']);
  });
  if (ecrire && traces.length && log) log.getRange(log.getLastRow() + 1, 1, traces.length, traces[0].length).setValues(traces);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Utilitaires
// ─────────────────────────────────────────────────────────────────────────────

/** Titre du bloc : première cellule non vide à gauche, 1 à 3 lignes au-dessus du tableau (ex. « CHAUSSETTES »). */
function rg_titreBloc_(sh, r0, c0) {
  for (let dr = 3; dr >= 1; dr--) {
    if (r0 - dr < 1) continue;
    const debut = Math.max(1, c0 - 12);
    const vals = sh.getRange(r0 - dr, debut, 1, c0 - debut + 1).getValues()[0];
    for (let i = vals.length - 1; i >= 0; i--) {
      const v = String(vals[i] || '').trim();
      if (v && v === v.toUpperCase() && /[A-ZÀ-Ü]{4,}/.test(v) && !/BOUTIQUE/.test(v)) return v;
    }
  }
  return '';
}

/** Stand du bloc : « 🔵 BOUTIQUE GP » / « 🔴 BOUTIQUE VIP » juste au-dessus du tableau, même colonne. */
function rg_standBloc_(sh, r0, c0) {
  for (let dr = 1; dr <= 3; dr++) {
    if (r0 - dr < 1) continue;
    const v = String(sh.getRange(r0 - dr, c0).getValue() || '');
    if (/VIP/i.test(v)) return 'VIP';
    if (/\bGP\b/i.test(v)) return 'GP';
  }
  return '';
}

function rg_appendParEntetes_(sh, valeurs) {
  if (!sh) return;
  const ent = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v).trim());
  const row = ent.map(h => (h in valeurs ? valeurs[h] : ''));
  sh.appendRow(row);
}

function rg_ui_() { try { return SpreadsheetApp.getUi(); } catch (e) { return null; } }

function rg_afficher_(titre, texte) {
  Logger.log(titre + '\n' + texte);
  const ui = rg_ui_();
  if (ui) { try { ui.alert(titre, texte.length > 1800 ? texte.slice(0, 1800) + '\n…(suite dans le journal d\'exécution)' : texte, ui.ButtonSet.OK); } catch (e) {} }
}