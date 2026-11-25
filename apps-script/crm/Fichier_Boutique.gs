/**
 * ============================================================================
 *  FICHIER BOUTIQUE D'ÉLISE  <->  CRM BOUTIQUE  <->  TABLETTES
 *  Spacer's Toulouse Volley — saison 2026-2027
 * ----------------------------------------------------------------------------
 *  FICHIER UNIQUE (décision de Clément du 25/11) :
 *    1_COMMANDE        réceptions de commandes → dépôt (avec facture et prix d'achat)
 *    2_BOUTIQUE        inventaire GP / VIP / dépôt et sorties du dépôt vers GP / VIP
 *    3_JOURNAL_VENTES  ventes des tablettes (GP / VIP) et add-ons Tickie remis
 *    4_TOP_VENTES      classement des articles, bilan par match
 *    5_APRES_MATCH     contrôle de caisse (TPE, espèces) par boutique
 *
 *  RÈGLE : le CRM est la seule source du stock ; ce fichier est l'écran d'Élise.
 *   - Le classeur « Inventaire 2026 2027 » (onglet « En boutique ») est archivé
 *     depuis le 25/11 : il ne fait plus foi et n'alimente plus le CRM.
 *     eb_appliquer est désactivé (plus aucune recopie de valeurs absolues).
 *   - Cases JAUNES : Élise saisit. À la validation, chaque saisie devient un
 *     mouvement du CRM (Stock_Boutique.gs : réception, répartition, inventaire),
 *     signé de son prénom, puis la case se vide.
 *   - Cases GRISES : écrites par ce script depuis le CRM (toutes les 10 min et
 *     après chaque validation). Jamais saisies à la main.
 *   - Les tablettes prennent le stock du CRM à « Mettre à jour le catalogue » (puis
 *     « Charger le match ») et renvoient les ventes à « Synchroniser tout ».
 *     Aucun comptage pendant un match : après le match, « Synchroniser tout » sur
 *     les deux tablettes AVANT de compter.
 *
 *  Dépendances (même projet Apps Script, fichiers existants inchangés) :
 *   Stock_Boutique.gs : enregistrerReception, enregistrerRepartition,
 *     enregistrerInventaire, rafraichirSynthese_,
 *     sb_lireProduits_, sb_cols_, sb_ongletOuCree_, sb_assurerColonnes_,
 *     sb_fmt_, sb_num_, sb_norm_, SB.
 *
 *  INSTALLATION (une fois, ~5 min)
 *   1. Projet Apps Script du classeur SPACERS_BOUTIQUE_CRM_V2 : ➕ Fichier › Script,
 *      nom « Fichier_Boutique », coller ce fichier, enregistrer.
 *   2. Sélectionner installerFichierBoutique → ▶ Exécuter → autoriser.
 *      Le journal d'exécution affiche le lien du nouveau classeur.
 *   3. Partager ce classeur avec Élise (éditeur).
 *   4. L'alerte de réassort (une fois par match) part à l'adresse d'Élise
 *      (FB.ALERTE_DEFAUT) ; pour une autre adresse : Propriétés du script › FB_ALERTE_EMAIL.
 *  Aucun nouveau déploiement Web App : les tablettes ne changent pas.
 *
 *  Archivage de l'Inventaire : ▶ arreterAncienInventaire (retire les déclencheurs
 *  qui écrivaient dans l'ancien classeur ou en recopiaient « En boutique » ; rien
 *  n'est supprimé).
 * ============================================================================
 */

const FB = {
  NOM_FICHIER: "Boutique Spacer's — stock et ventes 2026-2027",
  PROP_ID: 'FICHIER_BOUTIQUE_ID',
  CRM_ID: '1mE9gSCtetFgnWEt0kA6cS2lcgJDe7oPRLDiXdGhH2EQ',   // SPACERS_BOUTIQUE_CRM_V2 (propriété CRM_BOUTIQUE_ID si différent)
  DUREE_MAX_MS: 4 * 60 * 1000,              // au-delà, on s'arrête proprement (limite Apps Script : 6 min)
  PROP_ALERTE: 'FB_ALERTE_EMAIL',
  PROP_ALERTE_FAITE: 'FB_ALERTE_DERNIER_MATCH',
  ALERTE_DEFAUT: 'carpreau.elise@gmail.com',   // adresse d'Élise pour l'alerte de réassort (propriété FB_ALERTE_EMAIL si différente)
  VIP_SEULEMENT: /^MAP-/,                       // maillots partenaires : vendus uniquement en VIP, jamais proposés en GP
  DEBUT_SAISON: new Date(2026, 6, 1),
  FREQ_MIN: 10,
  T: {
    LIRE: '📖 LISEZ-MOI', CDE: '1_COMMANDE', BTQ: '2_BOUTIQUE', JRN: '3_JOURNAL_VENTES',
    TOP: '4_TOP_VENTES', APR: '5_APRES_MATCH'
  },
  HDR: 8,                     // ligne des en-têtes des tableaux 1 et 2 (lignes 6-7 : bandeaux d'information)
  // 1_COMMANDE : 11 colonnes grises, 2 jaunes, 1 résultat
  CDE_COLS: ['Réf.', 'Article', 'Taille', 'Dépôt', 'Boutique GP', 'Boutique VIP', 'TOTAL',
             'Reçu (saison)', 'Vendu + remis (saison)', 'Prix d\'achat HT (CRM)', 'Alerte',
             '➕ Reçu (quantité)', 'Prix d\'achat HT (si différent)', 'Résultat'],
  CDE_GRIS: 11, CDE_JAUNE: 2,
  // 2_BOUTIQUE : 11 colonnes grises, 5 jaunes (3 comptages, 2 sorties du dépôt), 1 résultat
  BTQ_COLS: ['Réf.', 'Article', 'Taille', 'Dépôt', 'Boutique GP', 'Boutique VIP',
             'Vendu GP (dernier match)', 'Vendu VIP (dernier match)', 'Add-ons remis GP (dernier match)',
             'Réassort conseillé', 'Prix de vente TTC',
             'Compté GP', 'Compté VIP', 'Compté dépôt',
             '➡️ Sortir du dépôt vers GP (ajout)', '➡️ Sortir du dépôt vers VIP (ajout)', 'Résultat'],
  BTQ_GRIS: 11, BTQ_JAUNE: 5,
  JRN_COLS: ['Date', 'Match', 'Boutique', 'Type', 'Réf.', 'Article', 'Taille', 'Qté', 'PU TTC', 'CA TTC', 'Paiement', 'Remise', 'Remarque'],
  CONTROLES: '25_CONTROLES_CAISSE',
  ENTETES_CONTROLES: ['horodatage', 'match', 'boutique', 'CA_tablette_TTC', 'CB_tablette', 'CB_TPE', 'ecart_CB',
                      'especes_tablette', 'especes_comptees', 'ecart_especes', 'offerts_articles', 'controle_par', 'commentaire', 'statut'],
  // 25/11/2026 : tolérances de clôture (au-delà : « écart à expliquer »). CB : paiement électronique, 0 toléré.
  TOL_CB_EUR: 0, TOL_ESP_EUR: 0,   // Clément, 25/11 : 0 écart pour le moment
  ORDRE_TAILLES: ['116', '128', '140', '152', '164', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'TU', ''],
  SORTIES_MATCH: ['VENTE_COMPTOIR', 'OFFERT_CAISSE'],
  JAUNE: '#fff2cc', GRIS: '#eef1f5', NUIT: '#0b1f3a', BLEU: '#1f5fbf', ROUGE: '#b3261e', VERT: '#15803d',
  NOTICE_VERSION: 'fb-notice-v4-memos',
  MEMO_FOND: '#fff8e1', MEMO_BORD: '#e0b84d', MEMO_PX_LIGNE: 18
};

/**
 * 25/11/2026 (Clément) : un mémo par onglet, en ligne 2, pour Élise. Une ligne = un mot-clé en MAJUSCULES.
 * Cellules et libellés : ceux des constructeurs ci-dessous (B4 / E4 / J4 / H4 / L4, colonnes FB.*_COLS).
 */
const FB_MEMOS = {
  '1_COMMANDE': [
    'BUT : faire entrer une livraison au DÉPÔT (stock et facture partent dans le CRM).',
    'QUAND : à chaque livraison reçue.',
    'COMMENT : prénom en B4 · fournisseur en E4 · n° de facture en J4 (les deux obligatoires) · quantité reçue dans « ➕ Reçu (quantité) », sur la ligne de l\'article et de la taille.',
    'PRIX : « Prix d\'achat HT (si différent) » seulement s\'il a changé (sinon le prix du CRM est pris) · puis cocher « ✅ Valider » (H4).',
    'EXEMPLE : 50 écharpes, facture FA26081234 → E4 le fournisseur, J4 « FA26081234 », ligne ECH-TU « ➕ Reçu » = 50, Valider.',
    'ATTENTION : tout entre au DÉPÔT, rien en boutique. Pour mettre des pièces en boutique GP / VIP → onglet 2_BOUTIQUE.',
    'RÉSULTAT : ✅ = enregistré et case vidée · ❌ = rien enregistré, lire le message, corriger, recocher « Valider ».'
  ],
  '2_BOUTIQUE': [
    'BUT : compter le stock (GP, VIP, dépôt) et préparer les boutiques pour le match.',
    'QUAND : avant chaque match (J-2 / J-1), et après le match une fois « Synchroniser tout » fait sur les deux tablettes. Jamais pendant un match.',
    'COMMENT : prénom en B4 · « Compté GP / Compté VIP / Compté dépôt » = ce que tu as sous les yeux · case vide = pas compté · écris 0 s\'il n\'y en a plus.',
    'SORTIR : « ➡️ Sortir du dépôt vers GP / VIP » = pièces que tu AJOUTES (pas le total) · puis cocher « ✅ Valider » (H4). Le comptage passe avant la sortie.',
    'ASTUCE : cocher « 📝 Proposer le réassort » (L4) pré-remplit les sorties d\'après le dernier match : vérifie, corrige, puis Valider.',
    'EXEMPLE : dépôt compté 12 écharpes, sortir 5 vers GP → dépôt 7, GP +5.',
    'APRÈS : sur CHAQUE tablette, en wifi : « Mettre à jour le catalogue » puis « 🎫 Charger le match ».'
  ],
  '3_JOURNAL_VENTES': [
    'BUT : voir chaque vente des tablettes (GP, VIP, hors match) et chaque add-on Tickie remis au stand (lignes bleues).',
    'RIEN À SAISIR : l\'onglet se met à jour tout seul toutes les 10 min, une fois « Synchroniser tout » fait sur la tablette.',
    'SI UNE VENTE MANQUE : la tablette n\'a pas encore fait « Synchroniser tout », ou la vente n\'a pas été saisie en caisse → prévenir Clément.',
    'À SAVOIR : les ventes en ligne ne sont pas ici (suivies dans le CRM) · ligne rose ⚠ = article absent du catalogue → prévenir Clément.'
  ],
  '4_TOP_VENTES': [
    'BUT : voir ce qui se vend le mieux (à gauche, top 5 surligné) et le bilan de chaque match (à droite : CA GP, VIP, total).',
    'RIEN À SAISIR : l\'onglet se met à jour tout seul toutes les 10 min.',
    'SERT À : préparer le réassort (2_BOUTIQUE) et les prochaines commandes (1_COMMANDE).',
    'À SAVOIR : « Vendu » = ventes de caisse (GP + VIP + hors match) ; les add-ons Tickie remis sont dans une colonne à part.'
  ],
  '5_APRES_MATCH': [
    'BUT : contrôler la caisse de chaque boutique (GP et VIP). C\'est le seul contrôle de caisse à faire.',
    'QUAND : le lendemain du match, après « Synchroniser tout » sur les deux tablettes (sinon le contrôle est refusé).',
    'COMMENT : match en B4 · prénom en E4 · « CB relevé TPE » = total du ticket de fin de journée (D177 2668544-001 = GP, D177 2668543-001 = VIP).',
    'ESPÈCES : « Espèces comptées » = espèces dans la caisse MOINS les 30 € de fond de caisse · puis cocher « ✅ Valider le contrôle » (H4).',
    'TOLÉRANCE : 0 €. Tout écart (CB ou espèces) est enregistré « ❌ écart à expliquer » : écris l\'explication dans « Commentaire » (B5) avant de valider.',
    'UNE SEULE FOIS : un contrôle par match ; pour corriger, écrire en « Commentaire » « Correction : motif », puis recocher.'
  ]
};

/* ================================ INSTALLATION ================================ */

/** Crée le classeur (une seule fois), ses onglets et les déclencheurs. Relançable sans risque. */
function installerFichierBoutique() {
  fb_activerCRM_();
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(FB.PROP_ID);
  let ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(FB.NOM_FICHIER);
    try { ss.setSpreadsheetLocale('fr_FR'); ss.setSpreadsheetTimeZone('Europe/Paris'); } catch (e) { /* facultatif */ }
    id = ss.getId();
    props.setProperty(FB.PROP_ID, id);
  }
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['fb_surModification', 'majFichierBoutique', 'fb_traiterDemandes'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('fb_surModification').forSpreadsheet(id).onEdit().create();
  ScriptApp.newTrigger('majFichierBoutique').timeBased().everyMinutes(FB.FREQ_MIN).create();

  if (!props.getProperty(FB.PROP_ALERTE) && FB.ALERTE_DEFAUT) props.setProperty(FB.PROP_ALERTE, FB.ALERTE_DEFAUT);
  // Les déclencheurs de l'ancien Inventaire se retirent à part : ▶ arreterAncienInventaire.
  fb_construireTout_(ss, true);
  const feuille1 = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (feuille1 && ss.getSheets().length > 1) ss.deleteSheet(feuille1);

  Logger.log('Classeur : ' + ss.getUrl());
  Logger.log('Déclencheurs du projet : ' + ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()).join(', '));
  Logger.log('Déclencheurs posés : modification du classeur + mise à jour toutes les ' + FB.FREQ_MIN + ' min.');
  Logger.log('Alerte de réassort envoyée à : ' + props.getProperty(FB.PROP_ALERTE) + ' (propriété ' + FB.PROP_ALERTE + ').');
  Logger.log('Étape suivante : partager le classeur avec Élise (éditeur).');
  return ss.getUrl();
}

/** Retire les déclencheurs du fichier (le classeur reste en place). */
function desinstallerFichierBoutique() {
  return fb_retirerDeclencheurs_(h => ['fb_surModification', 'majFichierBoutique', 'fb_traiterDemandes'].indexOf(h) !== -1);
}

/**
 * Archivage de l'ancien « Inventaire 2026 2027 » (décision du 25/11 : le CRM est la seule source,
 * Élise saisit tout dans ce fichier). Retire les déclencheurs de Lien_Inventaire, Saisie_Inventaire,
 * Inventaire_Boutique et Sync_EnBoutique (eb_*). Aucun onglet ni aucune donnée n'est supprimé.
 * Le projet Apps Script propre à l'ancien classeur (déclencheurs Topventes) n'est pas touché.
 */
function arreterAncienInventaire() {
  const anciens = ['majInventaireElise', 'majSaisieInventaire', 'si_surModification', 'si_traiterDemandes', 'majInventaire'];
  const r = fb_retirerDeclencheurs_(h => anciens.indexOf(h) !== -1 || /^eb_/.test(h));
  Logger.log(r.length ? 'Ancien Inventaire archivé — déclencheurs retirés : ' + r.join(', ') + '.'
                      : 'Aucun déclencheur de l\'ancien Inventaire trouvé : rien à retirer.');
  Logger.log('Le CRM est désormais la seule source du stock ; Élise saisit dans le fichier boutique (2_BOUTIQUE pour l\'inventaire GP / VIP / dépôt).');
  Logger.log('Déclencheurs restants : ' + (ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()).join(', ') || 'aucun'));
  return r;
}

/** Toutes les 10 min : traite les validations en attente puis rafraîchit les données du CRM. */
function majFichierBoutique() {
  fb_activerCRM_();
  const ss = fb_fichier_();
  if (!fb_prendreJeton_()) return;
  try {
    fb_traiterDemandes_(ss);
    fb_alerteReassort_(fb_construireTout_(ss, false));
  } finally { fb_rendreJeton_(); }
}

/**
 * Déclencheur « à la modification » du classeur d'Élise.
 * Il n'écrit qu'un message et programme le traitement dans la minute :
 * le traitement tourne dans le contexte du CRM (fonctions de Stock_Boutique.gs).
 */
function fb_surModification(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const nom = sh.getName();
  const a1 = e.range.getA1Notation();
  const coche = e.range.getValue() === true;
  const msg = {};
  msg[FB.T.CDE + '|H4'] = 'A5';
  msg[FB.T.BTQ + '|H4'] = 'A5';
  msg[FB.T.BTQ + '|L4'] = 'A5';
  msg[FB.T.APR + '|H4'] = 'A6';
  if (nom === FB.T.APR && a1 === 'B4') {
    sh.getRange('A6').setValue('⏳ Chargement du match… (1 à 2 minutes)');
    fb_programmer_();
    return;
  }
  const cible = msg[nom + '|' + a1];
  if (cible && coche) {
    sh.getRange(cible).setValue(a1 === 'L4' ? '⏳ Calcul du réassort… (1 à 2 minutes)'
      : '⏳ Validation reçue : prise en compte dans 1 à 2 minutes. Ne pas modifier les cases jaunes en attendant.');
    fb_programmer_();
  }
}

/** Traitement immédiat (déclencheur ponctuel posé par fb_surModification). */
function fb_traiterDemandes() {
  fb_retirerDeclencheurs_(h => h === 'fb_traiterDemandes');
  fb_activerCRM_();
  const ss = fb_fichier_();
  if (!fb_prendreJeton_()) { fb_programmer_(); return; }
  try {
    fb_traiterDemandes_(ss);
    fb_alerteReassort_(fb_construireTout_(ss, false));
  } finally { fb_rendreJeton_(); }
}

/* ============================ TRAITEMENT DES SAISIES ============================ */

function fb_traiterDemandes_(ss) {
  let fait = false;
  const cde = ss.getSheetByName(FB.T.CDE);
  if (cde && cde.getRange('H4').getValue() === true) {
    let msg; try { msg = fb_validerCommande_(cde); } catch (err) { msg = '❌ ' + err.message; }
    cde.getRange('H4').setValue(false); cde.getRange('A5').setValue(msg); fait = true;
  }
  const btq = ss.getSheetByName(FB.T.BTQ);
  if (btq && btq.getRange('L4').getValue() === true) {
    let msg; try { msg = fb_proposerReassort_(btq); } catch (err) { msg = '❌ ' + err.message; }
    btq.getRange('L4').setValue(false); btq.getRange('A5').setValue(msg);
  }
  if (btq && btq.getRange('H4').getValue() === true) {
    let msg; try { msg = fb_validerBoutique_(btq); } catch (err) { msg = '❌ ' + err.message; }
    btq.getRange('H4').setValue(false); btq.getRange('A5').setValue(msg); fait = true;
  }
  const apr = ss.getSheetByName(FB.T.APR);
  if (apr && apr.getRange('H4').getValue() === true) {
    let msg; try { msg = fb_validerCaisse_(apr); } catch (err) { msg = '❌ ' + err.message; }
    apr.getRange('H4').setValue(false); apr.getRange('A6').setValue(msg); fait = true;
  }
  return fait;
}

/** 1_COMMANDE : réceptions au dépôt (02_ACHATS, coût moyen, 11_MOUVEMENTS_STOCK). */
function fb_validerCommande_(sh) {
  const auteur = String(sh.getRange('B4').getValue()).trim();
  if (!auteur) throw new Error('Indiquez votre prénom en B4, puis cochez à nouveau « Valider ».');
  const fournisseur = String(sh.getRange('E4').getValue()).trim();
  const facture = String(sh.getRange('J4').getValue()).trim();
  const n = sh.getLastRow() - FB.HDR;
  if (n < 1) return 'Aucune ligne.';
  const nbC = FB.CDE_COLS.length;
  const data = sh.getRange(FB.HDR + 1, 1, n, nbC).getValues();
  const P = sb_lireProduits_();
  const saisies = data.map(r => ({ ref: String(r[0]).trim(), q: r[FB.CDE_GRIS], prix: r[FB.CDE_GRIS + 1] }));
  const plan = fb_planCommande(saisies, P.rows, !!(fournisseur && facture));
  if (!plan.ok.length) {
    fb_ecrireResultats_(sh, plan.resultats, nbC);
    return plan.resultats.some(r => r) ? '⚠ Rien n\'a été enregistré : voir la colonne Résultat.' : 'Aucune quantité saisie.';
  }
  fb_ecrireResultats_(sh, plan.resultats, nbC);            // refus de contrôle affichés tout de suite
  const heure = sb_fmt_(new Date(), 'dd/MM HH:mm');
  const t0 = Date.now();
  let nb = 0, arret = '';
  fb_sansSynthese_(() => {
    for (const o of plan.ok) {
      const ligne = FB.HDR + 1 + o.i;
      if (arret || Date.now() - t0 > FB.DUREE_MAX_MS) { arret = arret || 'temps'; fb_resultat_(sh, ligne, nbC, '⏸ pas encore traité : recocher « Valider » dans 2 minutes'); continue; }
      try {
        fb_appel_(enregistrerReception, { lignes: [{ ref: o.ref, R: o.q }], prix_achat: o.prix,
          fournisseur: fournisseur, reference: facture }, auteur, '', o.ref);
      } catch (err) {
        if (fb_estVerrou_(err)) { arret = 'verrou'; fb_resultat_(sh, ligne, nbC, '⏸ CRM occupé par une tablette : rien n\'a été enregistré, recocher « Valider » dans 2 minutes'); continue; }
        fb_resultat_(sh, ligne, nbC, '❌ ' + err.message + ' — rien n\'a été enregistré pour cette ligne');
        continue;
      }
      sh.getRange(ligne, FB.CDE_GRIS + 1, 1, 2).clearContent();   // appliqué = vidé, avant toute autre écriture
      fb_resultat_(sh, ligne, nbC, '✅ ' + heure + ' · +' + o.q + ' au dépôt à ' + fb_eur_(o.prix) + ' HT · facture ' + facture);
      nb++;
    }
  });
  const pb = plan.resultats.filter(r => r && String(r).indexOf('❌') === 0).length;
  if (nb && !pb && !arret) { sh.getRange('E4').clearContent(); sh.getRange('J4').clearContent(); }
  return (nb ? '✅ ' : '⚠ ') + heure + ' — ' + nb + ' réception(s) enregistrée(s) dans le CRM par ' + auteur +
         (pb ? ' · ⚠ ' + pb + ' ligne(s) refusée(s) : voir la colonne Résultat.' : '') +
         (arret ? ' · ⏸ CRM occupé ou traitement long : recocher « Valider » dans 2 minutes pour finir.' : '.');
}

/**
 * Plan des réceptions (sans écriture). Exporté pour les tests.
 * Règles : quantité entière > 0 ; facture obligatoire ; prix HT = saisi sinon coût du CRM, et > 0.
 */
function fb_planCommande(saisies, produits, aFacture) {
  const ok = [], resultats = [];
  saisies.forEach((s, i) => {
    const vide = (s.q === '' || s.q === null || s.q === undefined) && (s.prix === '' || s.prix === null || s.prix === undefined);
    if (vide) { resultats.push(null); return; }
    const x = produits.find(p => p.ref === s.ref);
    if (!x) { resultats.push('❌ référence inconnue du CRM'); return; }
    const q = Number(String(s.q).replace(',', '.'));
    if (!(q > 0) || Math.round(q) !== q) { resultats.push('❌ quantité reçue : nombre entier positif'); return; }
    const prixSaisi = s.prix === '' || s.prix === null || s.prix === undefined ? null : Number(String(s.prix).replace(',', '.'));
    if (prixSaisi !== null && !(prixSaisi > 0)) { resultats.push('❌ prix d\'achat HT invalide'); return; }
    const prix = prixSaisi !== null ? prixSaisi : x.cout;
    if (!(prix > 0)) { resultats.push('❌ prix d\'achat inconnu : l\'écrire dans « Prix d\'achat HT »'); return; }
    if (!aFacture) { resultats.push('❌ écrire le fournisseur (E4) et le n° de facture (J4)'); return; }
    ok.push({ i: i, ref: x.ref, x: x, q: q, prix: Math.round(prix * 100) / 100 });
    resultats.push('');
  });
  return { ok: ok, resultats: resultats };
}

/** 2_BOUTIQUE : comptages GP / VIP / dépôt (écarts tracés), puis sorties du dépôt vers GP / VIP. */
function fb_validerBoutique_(sh) {
  const auteur = String(sh.getRange('B4').getValue()).trim();
  if (!auteur) throw new Error('Indiquez votre prénom en B4, puis cochez à nouveau « Valider ».');
  const n = sh.getLastRow() - FB.HDR;
  if (n < 1) return 'Aucune ligne.';
  const nbC = FB.BTQ_COLS.length;
  const data = sh.getRange(FB.HDR + 1, 1, n, nbC).getValues();
  const P = sb_lireProduits_();                       // stock du CRM au moment de la validation
  const g = FB.BTQ_GRIS;
  const saisies = data.map(r => ({ ref: String(r[0]).trim(), cGP: r[g], cVIP: r[g + 1], cR: r[g + 2], aGP: r[g + 3], aVIP: r[g + 4] }));
  const plan = fb_planBoutique(saisies, P.rows);
  if (!plan.ok.length) {
    fb_ecrireResultats_(sh, plan.resultats, nbC);
    return plan.resultats.some(r => r) ? '⚠ Rien n\'a été enregistré : voir la colonne Résultat.' : 'Aucune saisie.';
  }
  fb_ecrireResultats_(sh, plan.resultats, nbC);
  const heure = sb_fmt_(new Date(), 'dd/MM HH:mm');
  const match = fb_matchTablettes_();
  const t0 = Date.now();
  let nb = 0, arret = '';
  fb_sansSynthese_(() => {
    plan.ok.forEach(o => {
      const ligne = FB.HDR + 1 + o.i;
      const faits = [];
      if (arret || Date.now() - t0 > FB.DUREE_MAX_MS) { arret = arret || 'temps'; plan.resultats[o.i] = '⏸ pas encore traité : recocher « Valider » dans 2 minutes'; fb_resultat_(sh, ligne, nbC, plan.resultats[o.i]); return; }
      for (const op of o.ops) {
        try {
          if (op.type === 'rien') {
            /* 0 pièce à sortir : on vide seulement la case */
          } else if (op.type === 'inventaire') {   // comptage : écarts tracés en AJUSTEMENT_INVENTAIRE
            fb_appel_(enregistrerInventaire, { lignes: [{ ref: o.ref, R: op.R, B1: op.B1, B2: op.B2 }],
              commentaire: 'Comptage ' + auteur }, auteur, match, o.ref);
          } else if (op.type === 'repartition') {  // TRANSFERT dépôt → GP / VIP
            fb_appel_(enregistrerRepartition, { lignes: [{ ref: o.ref, B1: op.B1, B2: op.B2 }] }, auteur, match, o.ref);
          } else {
            throw new Error('opération inconnue');
          }
        } catch (err) {
          if (fb_estVerrou_(err)) arret = 'verrou';
          plan.resultats[o.i] = (fb_estVerrou_(err) ? '⏸ CRM occupé par une tablette' : '❌ ' + err.message) +
                                (faits.length ? ' — déjà enregistré : ' + faits.join(', ') : ' — rien n\'a été enregistré') +
                                ' — vérifier puis revalider';
          fb_resultat_(sh, ligne, nbC, plan.resultats[o.i]);
          return;
        }
        sh.getRange(ligne, g + 1 + op.colonne, 1, op.nbCols || 1).clearContent();   // case appliquée = case vidée
        faits.push(op.libelle);
      }
      plan.resultats[o.i] = '✅ ' + heure + ' · ' + faits.join(', ') +
                            ' · maintenant dépôt ' + o.apres.R + ' / GP ' + o.apres.B1 + ' / VIP ' + o.apres.B2;
      fb_resultat_(sh, ligne, nbC, plan.resultats[o.i]);
      nb++;
    });
  });
  const pb = plan.resultats.filter(r => r && String(r).indexOf('❌') === 0).length;
  return (nb ? '✅ ' : '⚠ ') + heure + ' — ' + nb + ' article(s) enregistré(s) dans le CRM par ' + auteur +
         (pb ? ' · ⚠ ' + pb + ' ligne(s) refusée(s) : voir la colonne Résultat.' : '.') +
         (arret ? ' · ⏸ CRM occupé ou traitement long : recocher « Valider » dans 2 minutes pour finir.' : '') +
         (nb ? ' Tablettes : « Mettre à jour le catalogue » puis « Charger le match » pour prendre ce stock.' : '');
}

/**
 * Plan d'une ligne de 2_BOUTIQUE (sans écriture). Exporté pour les tests.
 * saisies : { ref, cGP, cVIP, cR, aGP, aVIP } — case vide = non compté / rien à sortir.
 *  1. « Compté GP / VIP / dépôt » : ce qu'Élise a sous les yeux. Une seule opération d'inventaire
 *     (enregistrerInventaire) corrige le CRM de l'écart (AJUSTEMENT_INVENTAIRE) ; le non-compté est laissé vide.
 *  2. « Sortir du dépôt vers GP / VIP » = nombre de pièces AJOUTÉES en boutique, APRÈS le comptage :
 *     TRANSFERT dépôt → boutique (enregistrerRepartition). Le dépôt (compté s'il vient de l'être) doit suffire.
 *  Case à 0 dans une sortie : vidée sans mouvement.
 *  La ligne est refusée entière si un contrôle échoue : rien n'est appliqué à moitié.
 *  apres = { R, B1, B2 } après comptage et sorties.
 */
function fb_planBoutique(saisies, produits) {
  const ok = [], resultats = [];
  const lire = v => {
    if (v === '' || v === null || v === undefined) return { vide: true };
    const q = Number(String(v).replace(',', '.'));
    return (q >= 0 && Math.round(q) === q) ? { vide: false, q: q } : { vide: false, invalide: true };
  };
  saisies.forEach((s, i) => {
    const c = { B1: lire(s.cGP), B2: lire(s.cVIP), R: lire(s.cR) };
    const a1 = lire(s.aGP), a2 = lire(s.aVIP);
    const toutes = [c.B1, c.B2, c.R, a1, a2];
    if (toutes.every(v => v.vide)) { resultats.push(null); return; }
    const x = produits.find(p => p.ref === s.ref);
    if (!x) { resultats.push('❌ référence inconnue du CRM'); return; }
    if (toutes.some(v => v.invalide)) { resultats.push('❌ nombres entiers positifs uniquement'); return; }

    const ops = [];
    let R = x.R, B1 = x.B1, B2 = x.B2;
    // 1. comptages (colonnes 0, 1, 2 des cases jaunes)
    if (!c.B1.vide || !c.B2.vide || !c.R.vide) {
      const lib = [];
      if (!c.B1.vide) { lib.push('compté GP ' + c.B1.q + (c.B1.q !== B1 ? ' (' + fb_signe_(c.B1.q - B1) + ')' : '')); B1 = c.B1.q; }
      if (!c.B2.vide) { lib.push('compté VIP ' + c.B2.q + (c.B2.q !== B2 ? ' (' + fb_signe_(c.B2.q - B2) + ')' : '')); B2 = c.B2.q; }
      if (!c.R.vide)  { lib.push('compté dépôt ' + c.R.q + (c.R.q !== R ? ' (' + fb_signe_(c.R.q - R) + ')' : '')); R = c.R.q; }
      ops.push({ type: 'inventaire', R: c.R.vide ? '' : c.R.q, B1: c.B1.vide ? '' : c.B1.q, B2: c.B2.vide ? '' : c.B2.q,
                 colonne: 0, nbCols: 3, libelle: lib.join(', ') });
    }
    // 2. sorties du dépôt (colonnes 3 et 4), après le comptage
    const gp = a1.vide ? 0 : a1.q, vip = a2.vide ? 0 : a2.q;
    if (gp + vip > R) {
      resultats.push('❌ il faut ' + (gp + vip) + ' au dépôt, il y en a ' + R + (c.R.vide ? '' : ' (compté)') +
                     ' : baisser la quantité ou enregistrer la réception — rien n\'a été enregistré');
      return;
    }
    if (gp > 0 || vip > 0) {
      const lib = [];
      if (gp > 0) lib.push(gp + ' dépôt → GP');
      if (vip > 0) lib.push(vip + ' dépôt → VIP');
      ops.push({ type: 'repartition', B1: gp, B2: vip, colonne: gp > 0 ? 3 : 4, nbCols: gp > 0 && vip > 0 ? 2 : 1, libelle: lib.join(', ') });
      R -= gp + vip; B1 += gp; B2 += vip;
    }
    if (!a1.vide && gp === 0) ops.push({ type: 'rien', colonne: 3, nbCols: 1, libelle: '0 à sortir vers GP' });
    if (!a2.vide && vip === 0) ops.push({ type: 'rien', colonne: 4, nbCols: 1, libelle: '0 à sortir vers VIP' });
    ok.push({ i: i, ref: x.ref, x: x, ops: ops, apres: { R: R, B1: B1, B2: B2 } });
    resultats.push('');
  });
  return { ok: ok, resultats: resultats };
}

/** Case « 📝 Proposer le réassort » : pré-remplit les sorties du dépôt (rien n'est enregistré). */
function fb_proposerReassort_(sh) {
  const n = sh.getLastRow() - FB.HDR;
  if (n < 1) return 'Aucune ligne.';
  const D = fb_donnees_();
  const g = FB.BTQ_GRIS;
  const refs = sh.getRange(FB.HDR + 1, 1, n, 1).getValues().map(r => String(r[0]).trim());
  let lignes = 0, pieces = 0;
  refs.forEach((ref, i) => {
    const s = D.reassort[ref];
    if (!s) return;
    if (s.gp > 0) { sh.getRange(FB.HDR + 1 + i, g + 4).setValue(s.gp); pieces += s.gp; }     // « Sortir … vers GP »
    if (s.vip > 0) { sh.getRange(FB.HDR + 1 + i, g + 5).setValue(s.vip); pieces += s.vip; }  // « Sortir … vers VIP »
    if (s.gp > 0 || s.vip > 0) lignes++;
  });
  return lignes ? '📝 Réassort proposé sur ' + lignes + ' article(s) (' + pieces + ' pièce(s)) dans « ➡️ Sortir du dépôt » (nombre de pièces à ajouter). Vérifier, corriger si besoin, puis cocher « ✅ Valider ».'
                : 'Rien à réassortir : les boutiques sont au niveau du dernier match (ou le dépôt est vide).';
}

/** 5_APRES_MATCH : contrôle de caisse → 25_CONTROLES_CAISSE + mail. */
function fb_validerCaisse_(sh) {
  const match = String(sh.getRange('B4').getValue()).trim();
  const auteur = String(sh.getRange('E4').getValue()).trim();
  if (!match) throw new Error('Choisissez le match en B4.');
  if (!auteur) throw new Error('Indiquez votre prénom en E4, puis cochez à nouveau « Valider le contrôle ».');
  if (String(sh.getRange('B4').getNote() || '') !== match) throw new Error('Le tableau ne correspond pas encore au match choisi : attendre sa mise à jour puis recocher.');
  const commentaire = String(sh.getRange('B5').getValue()).trim();
  const lignes = sh.getRange(9, 1, 2, 10).getValues();
  if (lignes.every(r => r[6] === '' && r[7] === '')) throw new Error('Saisir au moins le relevé TPE ou les espèces comptées.');
  // 25/11/2026 : pas de contrôle de caisse sur un CA incomplet — toutes les ventes du jour du match doivent être synchronisées
  const D = fb_donnees_();
  const mD = D.matchs.find(x => x.match === match);
  if (mD && mD.d) {
    const j = mD.d.getFullYear() + '-' + (mD.d.getMonth() + 1) + '-' + mD.d.getDate();
    const manque = ['GP', 'VIP'].filter(b => (D.nonSyncJours || {})[j + '|' + b] > 0);
    if (manque.length) throw new Error('Ventes du ' + sb_fmt_(mD.d, 'dd/MM') + ' pas encore synchronisées (' + manque.map(b => D.nonSyncJours[j + '|' + b] + ' article(s) ' + b).join(', ') +
      ') : « Synchroniser tout » sur la tablette ' + manque.join(' et ') + ', attendre la mise à jour (10 min) puis recocher.');
  }
  const shC = sb_ongletOuCree_(FB.CONTROLES, FB.ENTETES_CONTROLES);
  const cC = sb_assurerColonnes_(shC, FB.ENTETES_CONTROLES);
  // 25/11/2026 : un seul contrôle par match et par boutique, sauf correction motivée (trace gardée : les lignes s'ajoutent)
  if (!/^\s*correction/i.test(commentaire) && shC.getLastRow() > 1) {
    const ex = shC.getRange(2, 1, shC.getLastRow() - 1, shC.getLastColumn()).getValues();
    const deja = lignes.filter(r => !(r[6] === '' && r[7] === '')).map(r => r[0])
      .filter(b => ex.some(e => String(e[cC.match - 1]).trim() === match && String(e[cC.boutique - 1]).trim() === b));
    if (deja.length) throw new Error('Contrôle déjà validé pour ' + match + ' (' + deja.join(', ') + '). Pour le refaire, écrire en commentaire « Correction : motif », puis recocher.');
  }
  const statut = r => {
    const eC = r[6] === '' ? null : Math.abs(fb_r2_(r[6] - r[3])), eE = r[7] === '' ? null : Math.abs(fb_r2_(r[7] - r[4]));
    if ((eC !== null && eC > FB.TOL_CB_EUR) || (eE !== null && eE > FB.TOL_ESP_EUR)) return '❌ écart à expliquer';
    return (eC === null || eE === null) ? '⏳ incomplet' : '✅ dans la tolérance';
  };
  lignes.forEach(r => {
    if (r[6] === '' && r[7] === '') return;   // boutique sans aucune saisie : pas de ligne (le rapport de clôture la montre « non contrôlée »)
    const row = new Array(shC.getLastColumn()).fill('');
    const set = (k, v) => { if (cC[k]) row[cC[k] - 1] = v; };
    set('horodatage', new Date()); set('match', match); set('boutique', r[0]); set('CA_tablette_TTC', r[2]);
    set('CB_tablette', r[3]); set('CB_TPE', r[6]); set('ecart_CB', r[6] === '' ? '' : fb_r2_(r[6] - r[3]));
    set('especes_tablette', r[4]); set('especes_comptees', r[7]); set('ecart_especes', r[7] === '' ? '' : fb_r2_(r[7] - r[4]));
    set('offerts_articles', r[5]); set('controle_par', auteur); set('commentaire', commentaire); set('statut', statut(r));
    shC.appendRow(row);
  });
  const heure = sb_fmt_(new Date(), 'dd/MM HH:mm');
  try {
    const dest = [Session.getEffectiveUser().getEmail()];
    const copie = PropertiesService.getScriptProperties().getProperty(FB.PROP_ALERTE);
    if (copie && /@/.test(copie)) dest.push(copie);
    MailApp.sendEmail({ to: dest.join(','), subject: '🏁 Boutique — caisse ' + match + ' (' + auteur + ')',
      htmlBody: fb_mailCaisse_(match, auteur, lignes, commentaire) });
  } catch (e) { console.warn('Mail caisse : ' + e.message); }
  sh.getRange(9, 7, 2, 2).clearContent();
  sh.getRange('B5').clearContent();
  sh.getRange('A3').setValue('Dernier contrôle validé : ' + match + ' — ' + heure + ' par ' + auteur).setFontColor(FB.VERT);
  return '✅ ' + heure + ' — contrôle de caisse enregistré (' + lignes.map(r => r[0] + ' ' + fb_eur_(r[2])).join(', ') + ') · rapport envoyé par mail.';
}

/* ============================== LECTURE DU CRM ============================== */

/**
 * Toutes les données utiles au fichier, lues une fois dans le CRM.
 * Ventes : 01_VENTES (tablette, hors match). Retraits add-ons : 11_MOUVEMENTS_STOCK.
 */
function fb_donnees_() {
  const crm = SpreadsheetApp.getActive();
  const P = sb_lireProduits_();
  const produits = P.rows.filter(x => x.ref && x.actif);
  const mvts = fb_lireOnglet_(crm, SB.ONGLET_MOUVEMENTS);
  const ventes = fb_lireOnglet_(crm, '01_VENTES');
  const live = fb_lireOnglet_(crm, '21_LIGNES_LIVE');
  const retraits = fb_lireOnglet_(crm, '17_RETRAITS');
  return fb_calculer(produits, P.rows, mvts, ventes, live, FB.DEBUT_SAISON, retraits);
}

/**
 * Calculs purs (sans accès au classeur) — exportés pour les tests.
 * produits : articles actifs avec réf. ; tousProduits : tout 03_PRODUITS (pour relier un nom vendu à sa réf.)
 * mvts / ventes / live : tableaux d'objets { en-tête: valeur }.
 */
function fb_calculer(produits, tousProduits, mvts, ventes, live, debut, retraits) {
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const num = v => { const n = Number(String(v === null || v === undefined ? '' : v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  const date = v => v instanceof Date ? v : (v ? new Date(v) : null);
  const parNom = {}, parRef = {};
  tousProduits.forEach(x => { if (x.produit) parNom[norm(x.produit)] = x; if (x.ref) parRef[x.ref] = x; });

  // --- mouvements de la saison, par réf.
  const saison = {}, sortiesMatch = {};
  const recentes = [];
  mvts.forEach(m => {
    const d = date(m.horodatage);
    if (d && d < debut) return;
    const ref = String(m.ref_boutique || '').trim();
    const type = String(m.type || '').trim();
    const q = num(m.quantite);
    const match = String(m.match || '').trim();
    if (!ref) return;
    const s = saison[ref] = saison[ref] || { recu: 0, sorti: 0 };
    if (type === 'ENTREE_ACHAT') s.recu += q;
    if (['VENTE_COMPTOIR', 'OFFERT_CAISSE', 'RETRAIT_ADDON', 'VENTE_HORS_MATCH', 'VENTE_TICKIE', 'VENTE_WEB'].indexOf(type) !== -1) s.sorti += -q;
    if ((FB.SORTIES_MATCH.indexOf(type) !== -1 || type === 'RETRAIT_ADDON') && match) {
      recentes.push({ d: d || new Date(0), match: match, retrait: type === 'RETRAIT_ADDON' });
      const k = match + '|' + ref;
      const o = sortiesMatch[k] = sortiesMatch[k] || { B1: 0, B2: 0, addon: 0 };
      if (type === 'RETRAIT_ADDON') o.addon += -q;
      else if (m.point === 'B2') o.B2 += -q; else o.B1 += -q;
    }
  });

  // --- journal : ventes tablette et hors match + retraits add-ons
  const journal = [];
  ventes.forEach(v => {
    const src = String(v.source || '').trim();
    if (src !== 'tablette' && src !== 'hors_match') return;
    const d = date(v.date);
    if (d && d < debut) return;
    const nom = String(v.produit || '').trim();
    const x = parNom[norm(nom)];
    const mode = String(v.mode_paiement || '').trim();
    const offert = /offert/i.test(mode);
    journal.push({
      d: d || new Date(0), match: String(v.match_associe || '').trim() || (src === 'hors_match' ? 'Hors match' : ''),
      boutique: src === 'hors_match' ? 'Hors match' : (String(v.boutique_id).trim() === 'B2' ? 'VIP' : 'GP'),
      type: offert ? 'Offert' : (src === 'hors_match' ? 'Vente hors match' : 'Vente'),
      ref: x ? x.ref : (/^divers/i.test(nom) ? 'DIVERS' : ''), article: x ? (x.modele || x.produit) : nom, taille: x ? (x.taille || 'TU') : '',
      q: num(v.quantite), pu: num(v.prix_unitaire), ca: offert ? 0 : num(v.CA), paiement: mode,
      remise: num(v.remise) ? fb_r2_(num(v.remise)) : '',
      remarque: x ? '' : (/^divers/i.test(nom) ? 'article hors catalogue' : '⚠ article absent du catalogue : stock non sorti')
    });
  });
  mvts.forEach(m => {
    if (String(m.type).trim() !== 'RETRAIT_ADDON') return;
    const d = date(m.horodatage);
    if (d && d < debut) return;
    const x = parRef[String(m.ref_boutique || '').trim()];
    journal.push({
      d: d || new Date(0), match: String(m.match || '').trim(), boutique: m.point === 'B2' ? 'VIP' : 'GP', type: 'Retrait add-on',
      ref: String(m.ref_boutique || ''), article: x ? (x.modele || x.produit) : String(m.produit || ''), taille: x ? (x.taille || 'TU') : '',
      q: -num(m.quantite), pu: '', ca: '', paiement: 'payé en ligne', remise: '', remarque: String(m.commentaire || '')
    });
  });
  journal.sort((a, b) => b.d - a.d);

  // --- dernier match = celui de la vente de caisse la plus récente (heure de vente, pas heure de synchro)
  const ventesMatch = journal.filter(j => (j.type === 'Vente' || j.type === 'Offert') && j.match && (j.boutique === 'GP' || j.boutique === 'VIP'));
  const plusRecente = ventesMatch.reduce((m, j) => (!m || j.d > m.d ? j : m), null);
  const dernierMatch = plusRecente ? plusRecente.match : '';

  // --- réassort conseillé
  //  Niveau de départ du dernier match = stock actuel − tous les mouvements de la boutique depuis le début
  //  du match (ventes, offerts, retraits, comptages, réassorts déjà faits) : ce qui est déjà remis n'est
  //  jamais reproposé. En GP, on vise au moins le seuil d'alerte (sauf articles réservés au VIP).
  //  Le dépôt limite tout ; la GP est servie en premier.
  // début du match = première vente de caisse ou premier retrait d'add-on de ce match
  const debutMatch = ventesMatch.filter(j => j.match === dernierMatch).map(j => j.d)
    .concat(recentes.filter(r => r.match === dernierMatch && r.retrait).map(r => r.d))
    .reduce((m, d) => (!m || d < m ? d : m), null);
  const net = {};
  if (debutMatch) mvts.forEach(m => {
    const d = date(m.horodatage);
    const ref = String(m.ref_boutique || '').trim();
    const pt = String(m.point || '').trim();
    if (!d || d < debutMatch || !ref || (pt !== 'B1' && pt !== 'B2')) return;
    const o = net[ref] = net[ref] || { B1: 0, B2: 0 };
    o[pt] += num(m.quantite);
  });
  const reassort = {};
  produits.forEach(x => {
    const n = net[x.ref] || { B1: 0, B2: 0 };
    const departGP = x.B1 - n.B1, departVIP = x.B2 - n.B2;
    const seuil = FB.VIP_SEULEMENT.test(x.ref) ? 0 : (Number(x.seuil) || 0);
    const veutGP = Math.max(0, Math.max(departGP, (departGP > 0 || x.B1 > 0 || sortiesMatch[dernierMatch + '|' + x.ref]) ? seuil : 0) - x.B1);
    const veutVIP = Math.max(0, departVIP - x.B2);
    if (!veutGP && !veutVIP) return;
    let dispo = Math.max(0, x.R);
    const gp = Math.min(veutGP, dispo); dispo -= gp;
    const vip = Math.min(veutVIP, dispo);
    const manqueGP = Math.max(0, Math.max(0, departGP - x.B1) - gp);    // le seuil seul ne crée pas d'alerte « manque »
    const manque = manqueGP + (veutVIP - vip);
    if (!gp && !vip && !manque) return;
    reassort[x.ref] = { gp: gp, vip: vip, cibleGP: x.B1 + gp, cibleVIP: x.B2 + vip, manque: manque };
  });

  // --- add-ons Tickie encore à remettre (boutique GP), par produit
  const aRemettre = {};
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  (retraits || []).forEach(r => {
    const st = String(r.statut || '').trim();
    if (st !== 'À remettre' && st !== 'Partiel') return;
    const reste = num(r.quantite) - num(r.qte_remise);
    if (reste <= 0) return;
    const brut = String(r.produit || '').replace(/\s*[-–—]\s*(XS|S|M|L|XL|XXL|2XL|3XL|\d{3})$/i, '').trim() || 'Article';
    const cle = norm(brut);
    const o = aRemettre[cle] = aRemettre[cle] || { nom: brut, q: 0, passes: 0 };
    if (/[^\x00-\x7f]/.test(brut) && !/[^\x00-\x7f]/.test(o.nom)) o.nom = brut;   // garder l'orthographe accentuée
    o.q += reste;
    const de = date(r.date_evenement);
    if (de && de < auj) o.passes += reste;
  });

  // --- top ventes par article (modèle), saison et dernier match
  const top = {};
  journal.forEach(j => {
    const k = j.article || '(inconnu)';
    const t = top[k] = top[k] || { article: k, q: 0, gp: 0, vip: 0, addon: 0, ca: 0, dernier: 0 };
    if (j.type === 'Retrait add-on') t.addon += j.q;
    else { t.q += j.q; if (j.boutique === 'VIP') t.vip += j.q; else if (j.boutique === 'GP') t.gp += j.q; t.ca += num(j.ca); }
    if (j.match && j.match === dernierMatch) t.dernier += j.q;
  });
  const topListe = Object.keys(top).map(k => top[k]).sort((a, b) => (b.q + b.addon) - (a.q + a.addon) || b.ca - a.ca);

  // --- bilan par match (caisse) : CA, CB, espèces, offerts par boutique
  const parMatch = {};
  journal.forEach(j => {
    if (j.type === 'Retrait add-on' || !j.match) return;
    const m = parMatch[j.match] = parMatch[j.match] || { match: j.match, d: j.d, GP: fb_caisseVide_(), VIP: fb_caisseVide_() };
    if (j.d > m.d) m.d = j.d;
    const b = j.boutique === 'VIP' ? m.VIP : (j.boutique === 'GP' ? m.GP : null);
    if (!b) return;
    b.articles += j.q;
    if (j.type === 'Offert') { b.offerts += j.q; return; }
    b.ca += num(j.ca);
    if (/esp/i.test(j.paiement)) b.esp += num(j.ca); else b.cb += num(j.ca);
  });
  const matchs = Object.keys(parMatch).map(k => parMatch[k]).sort((a, b) => b.d - a.d);

  // --- ventes reçues en direct (21_LIGNES_LIVE) mais pas encore synchronisées (« Synchroniser tout » pas fait) :
  //     comparaison des quantités par jour et par boutique, indépendante du format des identifiants.
  const jour = d => d ? d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() : '';
  const recu = {}, synchro = {};
  live.forEach(l => {
    const d = date(l['Horodatage']);
    if (!d || d < debut || /^divers/i.test(String(l['Réf.'] || l['Produit'] || ''))) return;
    const k = jour(d) + '|' + (String(l['Boutique']).trim() === 'B2' ? 'VIP' : 'GP');
    recu[k] = (recu[k] || 0) + num(l['Qté']);
  });
  journal.forEach(j => {
    if ((j.type !== 'Vente' && j.type !== 'Offert') || j.ref === 'DIVERS') return;
    const k = jour(j.d) + '|' + j.boutique;
    synchro[k] = (synchro[k] || 0) + j.q;
  });
  const nonSync = {}, nonSyncJours = {};
  Object.keys(recu).forEach(k => {
    const manque = recu[k] - (synchro[k] || 0);
    if (manque > 0) { const b = k.split('|')[1]; nonSync[b] = (nonSync[b] || 0) + manque; nonSyncJours[k] = manque; }
  });

  return { produits: produits, saison: saison, dernierMatch: dernierMatch, sortiesMatch: sortiesMatch,
           reassort: reassort, journal: journal, top: topListe, matchs: matchs, nonSync: nonSync, nonSyncJours: nonSyncJours, aRemettre: aRemettre };
}

/* ============================ ÉCRITURE DU FICHIER ============================ */

function fb_construireTout_(ss, complet) {
  const D = fb_donnees_();
  const ordre = fb_ordre_(D.produits);
  if (complet) fb_construireNotice_(ss);
  fb_construireCommande_(ss, D, ordre);
  fb_construireBoutique_(ss, D, ordre);
  fb_construireJournal_(ss, D);
  fb_construireTop_(ss, D);
  fb_construireApres_(ss, D);
  if (complet) {
    [FB.T.LIRE, FB.T.CDE, FB.T.BTQ, FB.T.JRN, FB.T.TOP, FB.T.APR].forEach((t, i) => {
      const sh = ss.getSheetByName(t);
      if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); }
    });
  }
  return D;
}

function fb_ordre_(produits) {
  const rang = t => { const i = FB.ORDRE_TAILLES.indexOf(String(t || '').toUpperCase()); return i === -1 ? 50 : i; };
  return produits.slice().sort((a, b) =>
    String(a.modele).localeCompare(String(b.modele), 'fr') || rang(a.taille) - rang(b.taille) || String(a.ref).localeCompare(String(b.ref)));
}

/** Tableau à saisie : les colonnes grises sont réécrites, les saisies jaunes sont conservées par référence. */
function fb_tableauSaisie_(ss, nom, titre, cols, nbGris, nbJaune, lignesGrises, entete) {
  let sh = ss.getSheetByName(nom);
  const nbC = cols.length;
  // changement de colonnes (version précédente du fichier) : l'onglet est refait à neuf
  if (sh) {
    const lu = sh.getRange(FB.HDR, 1, 1, Math.max(nbC, sh.getLastColumn())).getValues()[0].map(x => String(x).trim());
    const attendu = cols.concat(new Array(Math.max(0, lu.length - nbC)).fill(''));
    if (lu.some((x, i) => x !== attendu[i])) { ss.deleteSheet(sh); sh = null; }
  }
  const neuf = !sh;
  if (neuf) {
    sh = ss.insertSheet(nom);
    sh.getRange('A1').setValue(titre).setFontSize(14).setFontWeight('bold').setFontColor(FB.NUIT);
    sh.getRange('A4').setValue('Saisi par :').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('B4').setBackground(FB.JAUNE).setFontWeight('bold');
    sh.getRange('G4').setValue('✅ Valider →').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('H4').insertCheckboxes().setBackground(FB.JAUNE);
    sh.getRange('A5').setValue('Prêt.').setFontStyle('italic');
    sh.getRange(FB.HDR, 1, 1, nbC).setValues([cols]).setFontWeight('bold').setBackground(FB.NUIT).setFontColor('#ffffff')
      .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
    sh.getRange(FB.HDR, nbGris + 1, 1, nbJaune).setBackground('#8a6d00');
    sh.setRowHeight(FB.HDR, 46);
    sh.setFrozenRows(FB.HDR);
    sh.setFrozenColumns(3);
    sh.setHiddenGridlines(true);
    if (entete) entete(sh);
  }
  // saisies en cours, par réf.
  const enCours = {}, ordre = [];
  const n0 = Math.max(0, sh.getLastRow() - FB.HDR);
  if (!neuf && n0 > 0) {
    sh.getRange(FB.HDR + 1, 1, n0, nbC).getValues().forEach(r => {
      const ref = String(r[0]).trim();
      ordre.push(ref);
      if (ref) enCours[ref] = { saisie: r.slice(nbGris, nbGris + nbJaune), resultat: r[nbC - 1] };
    });
  }
  const r0 = FB.HDR + 1;
  if (!neuf && n0 === lignesGrises.length && lignesGrises.every((l, i) => ordre[i] === l[0])) {
    if (lignesGrises.length) sh.getRange(r0, 1, lignesGrises.length, nbGris).setValues(lignesGrises);
  } else {
    const lignes = lignesGrises.map(l => {
      const s = enCours[l[0]] || { saisie: new Array(nbJaune).fill(''), resultat: '' };
      return l.concat(s.saisie, [s.resultat]);
    });
    if (n0 > 0) sh.getRange(r0, 1, n0, nbC).clearContent().clearDataValidations().setBackground(null);
    if (lignes.length) {
      sh.getRange(r0, 1, lignes.length, nbC).setValues(lignes).setFontFamily('Arial').setFontSize(10);
      sh.getRange(r0, 1, lignes.length, nbGris).setBackground(FB.GRIS);
      sh.getRange(r0, 2, lignes.length, 1).setFontWeight('bold');
      sh.getRange(r0, 4, lignes.length, nbGris - 3).setHorizontalAlignment('center');
      const zone = sh.getRange(r0, nbGris + 1, lignes.length, nbJaune);
      zone.setBackground(FB.JAUNE).setHorizontalAlignment('center');
      zone.setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0)
        .setAllowInvalid(false).setHelpText('Nombre positif').build());
      sh.getRange(r0, nbC, lignes.length, 1).setFontSize(9).setFontColor('#444444');
    }
    fb_protegerAvertissement_(sh, 'fb_gris_' + nom, sh.getRange(r0, 1, Math.max(lignesGrises.length, 1), nbGris));
  }
  fb_memo_(sh, nbC, FB_MEMOS[nom]);
  sh.getRange('A3').setValue('Données du CRM lues le ' + sb_fmt_(new Date()) + ' (mise à jour automatique toutes les ' + FB.FREQ_MIN + ' min)')
    .setFontColor('#888888').setFontSize(9);
  return sh;
}

/**
 * Mémo de l'onglet en ligne 2 (encadré jaune pâle, multi-lignes). Idempotent : appelé à chaque reconstruction.
 * Ne décale rien : seule la ligne 2 est touchée (en-tête à FB.HDR, saisies en ligne 4 inchangées).
 * Google Sheets refuse de fusionner à cheval sur les colonnes figées (1_COMMANDE, 2_BOUTIQUE : A–C) :
 * dans ce cas la partie figée porte « 📌 MÉMO » et le texte est fusionné sur le reste de la largeur, dans le même cadre.
 */
function fb_memo_(sh, nbCols, lignes) {
  lignes = lignes || [];
  const ligne2 = sh.getRange(2, 1, 1, Math.max(nbCols, sh.getMaxColumns()));
  ligne2.breakApart();                                  // ancienne fusion (ou ancienne consigne) : remplacée proprement
  ligne2.clearContent().setBackground(null).setBorder(false, false, false, false, false, false);
  const fig = sh.getFrozenColumns ? sh.getFrozenColumns() : 0;
  const cadre = sh.getRange(2, 1, 1, nbCols);
  const style = r => r.setWrap(true).setVerticalAlignment('top').setFontSize(10).setFontFamily('Arial')
    .setFontColor('#3b2f00').setFontWeight('normal').setFontStyle('normal').setBackground(FB.MEMO_FOND);
  // valeur écrite dans la 1re cellule seulement (pas dans les cellules masquées par la fusion)
  if (fig > 0 && fig < nbCols) {
    style(sh.getRange(2, 1, 1, fig).merge()).setFontSize(12).setFontWeight('bold').setHorizontalAlignment('center');
    style(sh.getRange(2, fig + 1, 1, nbCols - fig).merge()).setHorizontalAlignment('left');
    sh.getRange(2, 1).setValue('📌 MÉMO');
    sh.getRange(2, fig + 1).setValue(lignes.join('\n'));
  } else {
    style(cadre.merge()).setHorizontalAlignment('left');
    sh.getRange(2, 1).setValue('📌 MÉMO\n' + lignes.join('\n'));
  }
  cadre.setBorder(true, true, true, true, false, false, FB.MEMO_BORD, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  const nb = lignes.length + (fig > 0 && fig < nbCols ? 0 : 1);
  sh.setRowHeight(2, nb * FB.MEMO_PX_LIGNE + 14);
}

function fb_construireCommande_(ss, D, ordre) {
  const lignes = ordre.map(x => {
    const s = D.saison[x.ref] || { recu: 0, sorti: 0 };
    const total = x.R + x.B1 + x.B2;
    const alerte = total <= 0 ? '❌ Rupture totale' : (x.R <= 0 ? 'Dépôt vide' : (total <= (x.seuil || 0) ? '⚠ Stock bas' : ''));
    return [x.ref, x.modele || x.produit, x.taille || 'TU', x.R, x.B1, x.B2, total, s.recu, s.sorti, x.cout || '', alerte];
  });
  const sh = fb_tableauSaisie_(ss, FB.T.CDE, '1 · COMMANDES ET STOCK — réceptions au dépôt',
    FB.CDE_COLS, FB.CDE_GRIS, FB.CDE_JAUNE, lignes, sh => {
      sh.getRange('D4').setValue('Fournisseur :').setFontWeight('bold').setHorizontalAlignment('right');
      sh.getRange('E4:F4').merge().setBackground(FB.JAUNE);
      sh.getRange('I4').setValue('N° de facture :').setFontWeight('bold').setHorizontalAlignment('right');
      sh.getRange('J4:K4').merge().setBackground(FB.JAUNE);
      [110, 200, 60, 70, 85, 85, 70, 80, 95, 90, 130, 95, 110, 360].forEach((w, i) => sh.setColumnWidth(i + 1, w));
      sh.getRange(FB.HDR, 7).setBackground('#000000');
    });
  sh.getRange(FB.HDR + 1, 10, Math.max(lignes.length, 1), 1).setNumberFormat('#,##0.00 €');
  fb_couleursAlertes_(sh, 11, lignes.length);
  const val = { R: 0, B1: 0, B2: 0 }, sansCout = [];
  D.produits.forEach(x => { ['R', 'B1', 'B2'].forEach(p => { val[p] += Math.max(0, x[p]) * (x.cout || 0); }); if (!(x.cout > 0) && x.R + x.B1 + x.B2 > 0) sansCout.push(x.ref); });
  sh.getRange('A6').setValue('Valeur du stock au coût d\'achat HT : dépôt ' + fb_eur_(val.R) + ' · GP ' + fb_eur_(val.B1) + ' · VIP ' + fb_eur_(val.B2) +
    ' · total ' + fb_eur_(val.R + val.B1 + val.B2) + (sansCout.length ? '   ·   ⚠ prix d\'achat inconnu : ' + sansCout.join(', ') : ''))
    .setFontSize(9).setFontWeight('bold').setFontColor(sansCout.length ? FB.ROUGE : '#555555');
}

function fb_construireBoutique_(ss, D, ordre) {
  const lignes = ordre.map(x => {
    const o = D.sortiesMatch[D.dernierMatch + '|' + x.ref] || { B1: 0, B2: 0, addon: 0 };
    const r = D.reassort[x.ref];
    let conseil = '';
    if (x.B1 + x.B2 <= 0 && x.R > 0) conseil = '⚠ vide en boutique, ' + x.R + ' au dépôt';
    else if (x.B1 + x.B2 + x.R <= 0) conseil = '❌ rupture totale';
    if (r && (r.gp || r.vip)) conseil = '🔁 ' + [r.gp ? '+' + r.gp + ' GP' : '', r.vip ? '+' + r.vip + ' VIP' : ''].filter(Boolean).join(' · ') + (r.manque ? ' (manque ' + r.manque + ')' : '');
    else if (r && r.manque) conseil = '❌ manque ' + r.manque + ' : dépôt vide';
    return [x.ref, x.modele || x.produit, x.taille || 'TU', x.R, x.B1, x.B2, o.B1 || '', o.B2 || '', o.addon || '', conseil, x.prix_vente || ''];
  });
  const sh = fb_tableauSaisie_(ss, FB.T.BTQ, '2 · BOUTIQUES GP / VIP ET DÉPÔT — inventaire et préparation du match',
    FB.BTQ_COLS, FB.BTQ_GRIS, FB.BTQ_JAUNE, lignes, sh => {
      sh.getRange('I4').setValue('📝 Proposer le réassort →').setFontWeight('bold').setHorizontalAlignment('right');
      sh.getRange('I4:K4').merge();
      sh.getRange('L4').insertCheckboxes().setBackground(FB.JAUNE);
      [110, 200, 60, 70, 85, 85, 85, 85, 95, 200, 80, 75, 75, 80, 110, 110, 400].forEach((w, i) => sh.setColumnWidth(i + 1, w));
      sh.getRange(FB.HDR, 5).setBackground(FB.BLEU); sh.getRange(FB.HDR, 6).setBackground(FB.ROUGE);
      // Compté GP / Sortir vers GP en bleu, Compté VIP / Sortir vers VIP en rouge
      sh.getRange(FB.HDR, 12).setBackground(FB.BLEU); sh.getRange(FB.HDR, 15).setBackground(FB.BLEU);
      sh.getRange(FB.HDR, 13).setBackground(FB.ROUGE); sh.getRange(FB.HDR, 16).setBackground(FB.ROUGE);
    });
  sh.getRange(FB.HDR + 1, 11, Math.max(lignes.length, 1), 1).setNumberFormat('#,##0.00 €');
  const mt = fb_matchTablettes_();
  sh.getRange('A6').setValue('Dernier match vendu : ' + (D.dernierMatch || '—') + '   ·   Match des tablettes : ' + (mt || '—') +
    fb_texteNonSync_(D)).setFontColor(Object.keys(D.nonSync).length ? FB.ROUGE : '#555555').setFontSize(9).setFontWeight('bold');
  const ar = Object.keys(D.aRemettre);
  sh.getRange('A7').setValue(ar.length
    ? '🎁 Add-ons Tickie à remettre en boutique GP (payés en ligne, à garder en stock GP) : ' +
      ar.map(k => D.aRemettre[k].q + ' ' + D.aRemettre[k].nom + (D.aRemettre[k].passes ? ' (dont ' + D.aRemettre[k].passes + ' de matchs passés : à vérifier)' : '')).join(' · ') +
      (ar.some(k => /maillot/.test(k)) ? ' — maillots : taille choisie au retrait' : '')
    : '🎁 Aucun add-on Tickie en attente de retrait.').setFontSize(9).setFontWeight('bold').setFontColor(ar.length ? '#8a6d00' : '#555555');
  fb_couleursAlertes_(sh, 10, lignes.length);
}

function fb_construireJournal_(ss, D) {
  let sh = ss.getSheetByName(FB.T.JRN);
  const nbC = FB.JRN_COLS.length;
  if (!sh) {
    sh = ss.insertSheet(FB.T.JRN);
    sh.getRange('A1').setValue('3 · JOURNAL DES VENTES — tablettes GP / VIP, ventes hors match, add-ons remis').setFontSize(14).setFontWeight('bold').setFontColor(FB.NUIT);
    sh.getRange(5, 1, 1, nbC).setValues([FB.JRN_COLS]).setFontWeight('bold').setBackground(FB.NUIT).setFontColor('#ffffff');
    sh.setFrozenRows(5);
    [120, 200, 80, 120, 110, 200, 60, 50, 70, 80, 90, 70, 260].forEach((w, i) => sh.setColumnWidth(i + 1, w));
    sh.setHiddenGridlines(true);
  }
  fb_memo_(sh, nbC, FB_MEMOS[FB.T.JRN]);
  const lignes = D.journal.map(j => [j.d, j.match, j.boutique, j.type, j.ref, j.article, j.taille, j.q, j.pu, j.ca, j.paiement, j.remise, j.remarque]);
  const n0 = Math.max(0, sh.getLastRow() - 5);
  if (n0 > 0) sh.getRange(6, 1, n0, nbC).clearContent();
  if (lignes.length) {
    sh.getRange(6, 1, lignes.length, nbC).setValues(lignes).setFontFamily('Arial').setFontSize(9);
    sh.getRange(6, 1, lignes.length, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange(6, 9, lignes.length, 2).setNumberFormat('#,##0.00 €');
    sh.getRange(6, 1, lignes.length, nbC).setBackgrounds(lignes.map(l => {
      const c = l[3] === 'Retrait add-on' ? '#e8f1fb' : (String(l[12]).indexOf('⚠') === 0 ? '#fde2e1' : null);
      return new Array(nbC).fill(c);
    }));
  }
  const tot = D.journal.reduce((s, j) => s + (j.type === 'Retrait add-on' ? 0 : Number(j.ca) || 0), 0);
  const inconnus = D.journal.filter(j => String(j.remarque).indexOf('⚠') === 0).length;
  sh.getRange('A3').setValue(lignes.length + ' ligne(s) · CA caisse saison ' + fb_eur_(tot) + ' · lu le ' + sb_fmt_(new Date()) +
    (inconnus ? ' · ⚠ ' + inconnus + ' vente(s) d\'un article absent du catalogue (stock non sorti) : prévenir Clément' : '') + fb_texteNonSync_(D))
    .setFontSize(9).setFontColor(inconnus || Object.keys(D.nonSync).length ? FB.ROUGE : '#888888').setFontWeight('bold');
}

function fb_construireTop_(ss, D) {
  let sh = ss.getSheetByName(FB.T.TOP);
  if (!sh) {
    sh = ss.insertSheet(FB.T.TOP);
    sh.getRange('A1').setValue('4 · TOP VENTES — saison 2026-2027').setFontSize(14).setFontWeight('bold').setFontColor(FB.NUIT);
    sh.setHiddenGridlines(true);
    [40, 220, 80, 70, 70, 90, 100, 110, 20, 230, 100, 100, 100, 100].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  }
  fb_memo_(sh, 14, FB_MEMOS[FB.T.TOP]);   // deux tableaux : A–H (articles) et J–N (matchs)
  sh.getRange(5, 1, Math.max(sh.getMaxRows() - 4, 1), 14).clearContent().setBackground(null).setFontWeight('normal');
  const H = ['Rang', 'Article', 'Vendu', 'dont GP', 'dont VIP', 'Add-ons remis', 'CA TTC', 'Dernier match'];
  sh.getRange(5, 1, 1, H.length).setValues([H]).setFontWeight('bold').setBackground(FB.NUIT).setFontColor('#ffffff');
  const L = D.top.map((t, i) => [i + 1, t.article, t.q, t.gp, t.vip, t.addon, fb_r2_(t.ca), t.dernier || '']);
  if (L.length) {
    sh.getRange(6, 1, L.length, H.length).setValues(L).setFontFamily('Arial').setFontSize(10);
    sh.getRange(6, 7, L.length, 1).setNumberFormat('#,##0.00 €');
    sh.getRange(6, 1, Math.min(5, L.length), H.length).setBackground('#dce9fb').setFontWeight('bold');
  }
  const M = ['Match', 'CA GP', 'CA VIP', 'CA total', 'Articles'];
  sh.getRange(5, 10, 1, M.length).setValues([M]).setFontWeight('bold').setBackground(FB.NUIT).setFontColor('#ffffff');
  const LM = D.matchs.map(m => [m.match, fb_r2_(m.GP.ca), fb_r2_(m.VIP.ca), fb_r2_(m.GP.ca + m.VIP.ca), m.GP.articles + m.VIP.articles]);
  if (LM.length) {
    sh.getRange(6, 10, LM.length, M.length).setValues(LM).setFontFamily('Arial').setFontSize(10);
    sh.getRange(6, 11, LM.length, 3).setNumberFormat('#,##0.00 €');
  }
  sh.getRange('A3').setValue('Dernier match : ' + (D.dernierMatch || '—') + ' · lu le ' + sb_fmt_(new Date())).setFontSize(9).setFontColor('#888888');
}

function fb_construireApres_(ss, D) {
  let sh = ss.getSheetByName(FB.T.APR);
  if (!sh) {
    sh = ss.insertSheet(FB.T.APR);
    sh.getRange('A1').setValue('5 · APRÈS LE MATCH — contrôle de caisse').setFontSize(14).setFontWeight('bold').setFontColor(FB.NUIT);
    sh.getRange('A4').setValue('Match :').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('B4:C4').merge().setBackground(FB.JAUNE).setFontWeight('bold');
    sh.getRange('D4').setValue('Contrôlé par :').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('E4').setBackground(FB.JAUNE);
    sh.getRange('F4:G4').merge().setValue('✅ Valider le contrôle →').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('H4').insertCheckboxes().setBackground(FB.JAUNE);
    sh.getRange('A5').setValue('Commentaire :').setFontWeight('bold').setHorizontalAlignment('right');
    sh.getRange('B5:K5').merge().setBackground(FB.JAUNE);
    sh.getRange('A6').setValue('Prêt.').setFontStyle('italic');
    const H = ['Boutique', 'Articles', 'CA TTC tablette', 'dont CB', 'dont espèces', 'Offerts (articles)', 'CB relevé TPE', 'Espèces comptées', 'Écart CB', 'Écart espèces'];
    sh.getRange(8, 1, 1, H.length).setValues([H]).setFontWeight('bold').setBackground(FB.NUIT).setFontColor('#ffffff').setWrap(true);
    [130, 80, 120, 100, 100, 100, 120, 120, 100, 110].forEach((w, i) => sh.setColumnWidth(i + 1, w));
    sh.setHiddenGridlines(true);
  }
  fb_memo_(sh, 11, FB_MEMOS[FB.T.APR]);   // A–K : tableau A–J et commentaire B5:K5
  const liste = D.matchs.map(m => m.match);
  if (liste.length) sh.getRange('B4').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(liste.slice(0, 50), true).setAllowInvalid(true).build());
  let match = String(sh.getRange('B4').getValue()).trim();
  if (!match && liste.length) { match = liste[0]; sh.getRange('B4').setValue(match); }
  const m = D.matchs.find(x => x.match === match);
  const saisi = sh.getRange(9, 7, 2, 2).getValues();
  const lignes = ['GP', 'VIP'].map((b, i) => {
    const c = m ? m[b] : fb_caisseVide_();
    const tpe = saisi[i][0], esp = saisi[i][1];
    return [b === 'GP' ? 'Boutique GP' : 'Boutique VIP', c.articles, fb_r2_(c.ca), fb_r2_(c.cb), fb_r2_(c.esp), c.offerts,
            tpe, esp, tpe === '' ? '' : fb_r2_(tpe - c.cb), esp === '' ? '' : fb_r2_(esp - c.esp)];
  });
  sh.getRange(9, 1, 2, 6).setValues(lignes.map(l => l.slice(0, 6))).setFontFamily('Arial');
  sh.getRange(9, 9, 2, 2).setValues(lignes.map(l => l.slice(8, 10)));
  sh.getRange(9, 1, 2, 6).setBackground(FB.GRIS);
  sh.getRange(9, 7, 2, 2).setBackground(FB.JAUNE);
  sh.getRange(9, 9, 2, 2).setBackground(FB.GRIS);
  sh.getRange(9, 3, 2, 3).setNumberFormat('#,##0.00 €');
  sh.getRange(9, 6, 2, 1).setNumberFormat('0');
  sh.getRange(9, 7, 2, 2).setNumberFormat('#,##0.00 €');
  sh.getRange(9, 9, 2, 2).setNumberFormat('#,##0.00 €;[Red]-#,##0.00 €');
  sh.getRange('B4').setNote(m ? match : '');
  sh.getRange('A11').setValue('Écart positif = plus en caisse que prévu ; négatif = manque. Le relevé TPE doit couvrir uniquement le terminal de cette boutique.')
    .setFontSize(9).setFontColor('#888888');
  sh.getRange('A12').setValue(fb_texteNonSync_(D).replace(/^ · /, '')).setFontSize(9).setFontColor(FB.ROUGE).setFontWeight('bold');
  fb_protegerAvertissement_(sh, 'fb_gris_caisse', sh.getRange(9, 1, 2, 6));
}

function fb_construireNotice_(ss) {
  let sh = ss.getSheetByName(FB.T.LIRE);
  if (sh && sh.getRange('A1').getNote() === FB.NOTICE_VERSION) return;
  if (sh) sh.clear(); else sh = ss.insertSheet(FB.T.LIRE, 0);
  const L = [
    ["📖 BOUTIQUE SPACER'S — mode d'emploi", 'T'],
    ['C\'est le SEUL fichier de la boutique. Il est relié au CRM du club et donc aux deux tablettes : ce que tu valides ici part dans le CRM en 1 à 2 minutes ; les ventes des tablettes reviennent ici toutes seules. L\'ancien classeur « Inventaire 2026 2027 » est archivé depuis le 25/11 : on n\'y saisit plus rien.', 'I'],
    ['', 'V'],
    ['LES 5 RÈGLES', 'S'],
    ['🟨 Cases JAUNES = c\'est toi qui les remplis.   ⬜ Cases GRISES = elles viennent du CRM, on n\'y touche jamais (Google avertit si on essaie).', 'E'],
    ['☑️ Rien n\'est enregistré tant que tu n\'as pas coché « ✅ Valider ». Ton prénom est obligatoire.', 'E'],
    ['✅ Après validation, la colonne « Résultat » dit ce qui a été fait et les cases jaunes appliquées se vident : impossible de compter deux fois.', 'E'],
    ['📌 Chaque onglet a son MÉMO en haut (cadre jaune pâle, ligne 2) : relis-le avant de saisir.', 'E'],
    ['🔢 Tout le stock (dépôt, boutique GP, boutique VIP) se compte et se corrige ICI, dans 2_BOUTIQUE. Les ventes des tablettes sont retirées toutes seules : ne les retire jamais à la main.', 'A'],
    ['', 'V'],
    ['① UNE COMMANDE ARRIVE — onglet 1_COMMANDE', 'S'],
    ['1. Prénom en B4. Fournisseur en E4 et n° de facture en J4 (obligatoires : ils partent en comptabilité).', 'E'],
    ['2. Sur la ligne de l\'article et de la taille : quantité reçue dans « ➕ Reçu ». Si le prix d\'achat HT a changé, l\'écrire à côté (sinon le prix connu du CRM est pris).', 'E'],
    ['3. Cocher « ✅ Valider ». Tout entre au DÉPÔT. Pour mettre ensuite des pièces en boutique : onglet 2_BOUTIQUE.', 'E'],
    ['EXEMPLE : 50 écharpes reçues, facture FA26081234 → E4 « Fournisseur X », J4 « FA26081234 », ligne ECH-TU « ➕ Reçu » = 50, Valider.', 'X'],
    ['', 'V'],
    ['② INVENTAIRE ET PRÉPARATION DU MATCH — onglet 2_BOUTIQUE', 'S'],
    ['1. Prénom en B4.', 'E'],
    ['2. Inventaire : « Compté GP », « Compté VIP », « Compté dépôt » = ce que tu as sous les yeux, pièce par pièce. Case vide = pas compté (le CRM n\'est pas touché). Le CRM est corrigé de l\'écart, et l\'écart est gardé dans l\'historique.', 'E'],
    ['3. Répartition : « ➡️ Sortir du dépôt vers GP » ou « … vers VIP » = le NOMBRE DE PIÈCES QUE TU AJOUTES dans la boutique (pas le total). Elles quittent le dépôt et entrent en boutique. Il faut assez de pièces au dépôt, sinon la ligne est refusée.', 'E'],
    ['4. Comptage et sortie peuvent être sur la même ligne : le comptage passe d\'abord, la sortie se fait ensuite à partir du dépôt compté.', 'E'],
    ['   Raccourci : coche « 📝 Proposer le réassort » : les quantités conseillées (retour au niveau du dernier match, dans la limite du dépôt) sont pré-remplies dans « ➡️ Sortir du dépôt ». Vérifie, corrige, puis Valider.', 'I'],
    ['   La ligne 🎁 en haut de l\'onglet donne les add-ons Tickie encore à remettre : garde-les en boutique GP.', 'I'],
    ['5. Cocher « ✅ Valider ». Puis, sur CHAQUE tablette, en wifi : « Mettre à jour le catalogue » (c\'est ce qui charge le stock), puis « 🎫 Charger le match ».', 'E'],
    ['EXEMPLE : écharpe. Tu comptes 2 en GP, 7 en VIP, 100 au dépôt, et tu veux 20 en GP → « Compté GP » = 2, « Compté VIP » = 7, « Compté dépôt » = 100, « Sortir du dépôt vers GP » = 18. Valider. Résultat : « … 18 dépôt → GP · maintenant dépôt 82 / GP 20 / VIP 7 ».', 'X'],
    ['', 'V'],
    ['③ PENDANT LE MATCH — les tablettes', 'S'],
    ['Les bénévoles vendent sur les tablettes, même sans internet. Les add-ons Tickie (écharpe, maillot achetés avec le billet) se remettent uniquement à la boutique GP, en scannant le billet : ils sortent du stock GP tout seuls.', 'I'],
    ['Pendant le match : aucun comptage, aucune saisie de stock.', 'A'],
    ['À la fermeture : clôturer la caisse puis « Synchroniser tout » sur CHAQUE tablette dès qu\'il y a du réseau. Sans ça, les ventes ne sont pas déduites du stock.', 'A'],
    ['', 'V'],
    ['④ APRÈS LE MATCH — dans cet ordre', 'S'],
    ['1. « Synchroniser tout » fait sur les deux tablettes (plus de bandeau rouge ici).  2. Seulement ensuite : tu comptes, et tu saisis tes comptages dans 2_BOUTIQUE (« Compté GP / VIP / dépôt »), puis Valider.', 'E'],
    ['3_JOURNAL_VENTES et 4_TOP_VENTES se remplissent tout seuls (ventes GP / VIP, add-ons remis). 2_BOUTIQUE montre ce qui s\'est vendu au dernier match et le « Réassort conseillé ».', 'I'],
    ['5_APRES_MATCH : saisir le relevé TPE et les espèces comptées (sans le fond de caisse de 30 €) de chaque boutique, ton prénom, puis « ✅ Valider le contrôle ». Le rapport part par mail. C\'est le seul contrôle de caisse à faire.', 'E'],
    ['', 'V'],
    ['CE QUI NE SE FAIT PAS ICI', 'S'],
    ['Dons, cadeaux partenaires, casse, vente en dehors d\'un match : page Gestion (spacers-boutique.spacersytb.workers.dev/gestion.html). Nouvel article ou prix de vente : prévenir Clément.', 'I'],
    ['EN CAS DE SOUCI', 'S'],
    ['❌ dans « Résultat » : la ligne n\'a PAS été enregistrée (le message dit pourquoi). Corriger puis recocher « Valider ».', 'E'],
    ['⏸ dans « Résultat » : le CRM était occupé (une tablette synchronisait) : rien n\'est perdu, recocher « Valider » 2 minutes plus tard.', 'E'],
    ['Rien ne bouge après 5 minutes, ou un message que tu ne comprends pas : ne recoche pas, envoie une photo à Clément.', 'E'],
  ];
  sh.getRange(1, 1, L.length, 1).setValues(L.map(l => [l[0]]));
  sh.setColumnWidth(1, 1000);
  sh.getRange(1, 1, L.length, 1).setWrap(true).setVerticalAlignment('middle').setFontSize(11).setFontFamily('Arial');
  const st = { T: ['#0b1f3a', '#ffffff', 16, true], S: ['#0b1f3a', '#ffffff', 12, true], E: ['#ffffff', '#111111', 11, false],
               X: ['#fff2cc', '#5b4400', 11, false], I: ['#eef1f5', '#333333', 11, false], A: ['#fde2e1', '#991b1b', 11, true], V: ['#ffffff', '#111111', 6, false] };
  L.forEach((l, i) => {
    const s = st[l[1]], r = sh.getRange(i + 1, 1);
    r.setBackground(s[0]).setFontColor(s[1]).setFontSize(s[2]).setFontWeight(s[3] ? 'bold' : 'normal');
    if (l[1] === 'X') r.setFontStyle('italic');
    if (l[1] === 'V' || l[1] === 'T') sh.setRowHeight(i + 1, l[1] === 'V' ? 8 : 36);
  });
  sh.getRange('A1').setNote(FB.NOTICE_VERSION);
  sh.setHiddenGridlines(true);
  sh.setTabColor('#f59e0b');
}

/* ================================ ALERTE RÉASSORT ================================ */

/** Une fois par match, dès que ses ventes sont arrivées : mail à FB_ALERTE_EMAIL avec le réassort conseillé. */
function fb_alerteReassort_(D) {
  const props = PropertiesService.getScriptProperties();
  const dest = props.getProperty(FB.PROP_ALERTE);
  if (!dest || !/@/.test(dest) || !D) return;
  if (!D.dernierMatch || props.getProperty(FB.PROP_ALERTE_FAITE) === D.dernierMatch) return;
  if (Object.keys(D.nonSync).length) return;      // une tablette n'a pas encore fait « Synchroniser tout » : on attend
  const lignes = D.produits.filter(x => D.reassort[x.ref] && (D.reassort[x.ref].gp || D.reassort[x.ref].vip || D.reassort[x.ref].manque));
  const vides = D.produits.filter(x => x.B1 + x.B2 + x.R <= 0);
  let h = '<h2 style="color:#0b1f3a">Boutique — réassort après ' + D.dernierMatch + '</h2>';
  if (lignes.length) {
    h += '<table style="border-collapse:collapse;font-family:Arial;font-size:13px"><tr>' +
         ['Article', 'Taille', 'Reste GP', 'Reste VIP', 'Dépôt', 'À remettre'].map(t => '<th style="border:1px solid #ddd;padding:4px 8px;background:#0b1f3a;color:#fff">' + t + '</th>').join('') + '</tr>';
    lignes.forEach(x => {
      const r = D.reassort[x.ref];
      const td = v => '<td style="border:1px solid #ddd;padding:4px 8px">' + v + '</td>';
      h += '<tr>' + td(x.modele || x.produit) + td(x.taille || 'TU') + td(x.B1) + td(x.B2) + td(x.R) +
           td([r.gp ? '+' + r.gp + ' GP' : '', r.vip ? '+' + r.vip + ' VIP' : '', r.manque ? 'manque ' + r.manque : ''].filter(Boolean).join(' · ')) + '</tr>';
    });
    h += '</table>';
  } else h += '<p>Rien à réassortir.</p>';
  if (vides.length) h += '<p><b>En rupture totale :</b> ' + vides.map(x => (x.modele || x.produit) + ' ' + (x.taille || '')).join(', ') + '.</p>';
  h += '<p>Avant tout : « Synchroniser tout » fait sur les deux tablettes.<br>Puis, dans le fichier boutique, onglet 2_BOUTIQUE : cocher « 📝 Proposer le réassort », vérifier, « ✅ Valider » (les pièces passent du dépôt aux boutiques).<br>Enfin, sur chaque tablette : « Mettre à jour le catalogue » puis « Charger le match ».</p>';
  try {
    MailApp.sendEmail({ to: dest, subject: '🔁 Boutique — réassort après ' + D.dernierMatch, htmlBody: h });
    props.setProperty(FB.PROP_ALERTE_FAITE, D.dernierMatch);
  } catch (e) { console.warn('Alerte réassort : ' + e.message); }
}

/* ==================================== OUTILS ==================================== */

/**
 * Le CRM doit être le classeur « actif » : les fonctions de Stock_Boutique.gs le lisent par getActive().
 * Lancé depuis un déclencheur posé par une modification du classeur d'Élise, getActive() ne renvoie pas
 * le CRM (constaté le 23/11 : « Onglet 03… introuvable ») : on le désigne explicitement.
 */
function fb_activerCRM_() {
  const id = PropertiesService.getScriptProperties().getProperty('CRM_BOUTIQUE_ID') || FB.CRM_ID;
  const actif = SpreadsheetApp.getActive();
  if (actif && actif.getId() === id) return actif;
  const crm = SpreadsheetApp.openById(id);
  SpreadsheetApp.setActiveSpreadsheet(crm);
  return crm;
}

function fb_fichier_() {
  const id = PropertiesService.getScriptProperties().getProperty(FB.PROP_ID);
  if (!id) throw new Error('Fichier boutique non installé : lancer installerFichierBoutique.');
  return SpreadsheetApp.openById(id);
}

function fb_programmer_() {
  const deja = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'fb_traiterDemandes');
  if (!deja) ScriptApp.newTrigger('fb_traiterDemandes').timeBased().after(5 * 1000).create();
}

function fb_retirerDeclencheurs_(filtre) {
  const r = [];
  ScriptApp.getProjectTriggers().forEach(t => {
    const h = t.getHandlerFunction();
    if (filtre(h)) { ScriptApp.deleteTrigger(t); r.push(h); }
  });
  return r;
}

/**
 * Évite deux traitements simultanés du fichier. Verrou du DOCUMENT (CRM), distinct du verrou du script
 * que prennent les fonctions de stock et l'import des tablettes. Libéré automatiquement en fin d'exécution.
 */
let FB_JETON_ = null;
function fb_prendreJeton_() {
  FB_JETON_ = LockService.getDocumentLock();
  return !!FB_JETON_ && FB_JETON_.tryLock(1000);
}
function fb_rendreJeton_() { try { if (FB_JETON_) FB_JETON_.releaseLock(); } catch (e) { /* déjà libéré */ } }

/**
 * Appelle une fonction de Stock_Boutique.gs, puis signe SES mouvements (auteur, match).
 * Seules les lignes de la même réf. et d'un type écrit par le fichier sont signées : une vente de tablette
 * importée au même moment n'est jamais attribuée à Élise. Un échec de signature ne remet pas en cause l'opération.
 */
function fb_appel_(fn, p, auteur, match, ref) {
  const signature = 'Fichier boutique · ' + auteur;
  const ss = SpreadsheetApp.getActive();
  const sh0 = ss.getSheetByName(SB.ONGLET_MOUVEMENTS);
  const avant = sh0 ? sh0.getLastRow() : 1;
  const avecGestion = typeof GESTION_AUTEUR_ !== 'undefined';
  if (avecGestion) GESTION_AUTEUR_ = signature;           // repris par sb_mouvement_ pendant l'opération
  let msg;
  try { msg = fn(p); } finally { if (avecGestion) GESTION_AUTEUR_ = ''; }
  try {
    const sh = ss.getSheetByName(SB.ONGLET_MOUVEMENTS);
    if (sh && sh.getLastRow() > avant) {
      const c = sb_cols_(sh);
      const nb = sh.getLastRow() - avant;
      const v = sh.getRange(avant + 1, 1, nb, sh.getLastColumn()).getValues();
      const types = ['ENTREE_ACHAT', 'TRANSFERT', 'AJUSTEMENT_INVENTAIRE'];
      v.forEach((r, i) => {
        if (String(r[c.ref_boutique - 1]).trim() !== ref || types.indexOf(String(r[c.type - 1]).trim()) === -1) return;
        if (c.auteur) sh.getRange(avant + 1 + i, c.auteur).setValue(signature);
        if (c.match && match && !r[c.match - 1]) sh.getRange(avant + 1 + i, c.match).setValue(match);
      });
    }
  } catch (e) { console.warn('Signature des mouvements : ' + e.message); }
  return msg;
}

/** Erreur de verrou (CRM occupé par l'import d'une tablette) : on s'arrête et on demande de recocher. */
function fb_estVerrou_(err) {
  return /lock|verrou|timed out|délai|trop de temps/i.test(String(err && err.message || err));
}

function fb_resultat_(sh, ligne, col, texte) { sh.getRange(ligne, col).setValue(texte); }

/** Suspend le recalcul de 12_SYNTHESE_STOCK pendant une série d'opérations ; une seule synthèse à la fin. */
function fb_sansSynthese_(fn) {
  const original = rafraichirSynthese_;
  rafraichirSynthese_ = function () {};
  try { return fn(); }
  finally {
    rafraichirSynthese_ = original;
    try { rafraichirSynthese_(); } catch (e) { console.warn('Synthèse stock : ' + e.message); }
  }
}

function fb_lireOnglet_(ss, nom) {
  const sh = ss.getSheetByName(nom);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const h = v[0].map(x => String(x).trim());
  return v.slice(1).map(r => { const o = {}; h.forEach((k, i) => { if (k && !(k in o)) o[k] = r[i]; }); return o; });
}

/** Match envoyé aux tablettes (04b_CALENDRIER, colonne « Tablettes »), sinon le prochain match. */
function fb_matchTablettes_() {
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName('04b_CALENDRIER');
    if (!sh || sh.getLastRow() < 2) return '';
    const c = sb_cols_(sh);
    const entetes = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim());
    const cAdv = entetes.findIndex(x => /^adversaire/i.test(x));        // « Adversaire Spacer's »
    const auj = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd');
    const L = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().map(r => {
      const d = r[c['Date'] - 1] instanceof Date ? r[c['Date'] - 1] : new Date(r[c['Date'] - 1]);
      const adv = cAdv === -1 ? '' : String(r[cAdv] || '').trim();
      // même libellé que les tablettes (« Spacer's vs Paris »), y compris les soirs de double affiche
      return { nom: adv ? "Spacer's vs " + adv : String(r[c['Match'] - 1]).trim(),
               jour: isNaN(d) ? '' : Utilities.formatDate(d, 'Europe/Paris', 'yyyy-MM-dd'),
               tab: String(r[c['Tablettes'] - 1] || '').indexOf('✅') === 0 };
    }).filter(m => m.nom && m.jour >= auj);
    const m = L.find(x => x.tab) || L[0];
    return m ? m.nom : '';
  } catch (e) { return ''; }
}

function fb_texteNonSync_(D) {
  const k = Object.keys(D.nonSync);
  if (!k.length) return '';
  return ' · ⚠ ventes pas encore synchronisées : ' + k.map(b => D.nonSync[b] + ' article(s) ' + b).join(', ') +
         ' → « Synchroniser tout » sur la tablette ' + k.join(' et ');
}

function fb_couleursAlertes_(sh, col, n) {
  if (!n) return;
  const rg = sh.getRange(FB.HDR + 1, col, n, 1);
  const v = rg.getValues();
  rg.setBackgrounds(v.map(r => {
    const s = String(r[0]);
    return [s.indexOf('❌') === 0 || s.indexOf('⚠') === 0 ? '#f8b4b4' : (s.indexOf('🔁') === 0 ? '#ffd9a0' : (s ? '#fff7d6' : FB.GRIS))];
  }));
}

function fb_ecrireResultats_(sh, resultats, col) {
  resultats.forEach((r, i) => { if (r !== null) sh.getRange(FB.HDR + 1 + i, col).setValue(r); });
}

function fb_protegerAvertissement_(sh, cle, range) {
  try {
    sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).filter(p => p.getDescription() === cle).forEach(p => p.remove());
    range.protect().setDescription(cle).setWarningOnly(true);
  } catch (e) { /* protection facultative */ }
}

function fb_mailCaisse_(match, auteur, lignes, commentaire) {
  const td = 'style="border:1px solid #ddd;padding:4px 8px"';
  const th = 'style="border:1px solid #ddd;padding:4px 8px;background:#0b1f3a;color:#fff"';
  const ec = (a, b) => (a === '' || a === null ? '—' : fb_eur_(a - b));
  let h = '<h2 style="color:#0b1f3a">Boutique — caisse ' + match + '</h2><p>Contrôle saisi par <b>' + auteur + '</b> le ' + sb_fmt_(new Date()) + '.</p>';
  h += '<table style="border-collapse:collapse;font-family:Arial;font-size:13px"><tr>' +
       ['Boutique', 'Articles', 'CA TTC', 'CB tablette', 'CB TPE', 'Écart CB', 'Espèces tablette', 'Espèces comptées', 'Écart espèces'].map(t => '<th ' + th + '>' + t + '</th>').join('') + '</tr>';
  lignes.forEach(r => {
    h += '<tr><td ' + td + '>' + r[0] + '</td><td ' + td + '>' + r[1] + '</td><td ' + td + '>' + fb_eur_(r[2]) + '</td><td ' + td + '>' + fb_eur_(r[3]) +
         '</td><td ' + td + '>' + (r[6] === '' ? '—' : fb_eur_(r[6])) + '</td><td ' + td + '>' + ec(r[6], r[3]) + '</td><td ' + td + '>' + fb_eur_(r[4]) +
         '</td><td ' + td + '>' + (r[7] === '' ? '—' : fb_eur_(r[7])) + '</td><td ' + td + '>' + ec(r[7], r[4]) + '</td></tr>';
  });
  h += '</table>';
  if (commentaire) h += '<h3>Commentaire</h3><p>' + String(commentaire).replace(/</g, '&lt;') + '</p>';
  return h;
}

function fb_caisseVide_() { return { articles: 0, ca: 0, cb: 0, esp: 0, offerts: 0 }; }
function fb_signe_(n) { return (n > 0 ? '+' : '') + n; }
function fb_r2_(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function fb_eur_(v) { return (Number(v) || 0).toFixed(2).replace('.', ',') + ' €'; }

if (typeof module !== 'undefined') module.exports = { fb_planCommande, fb_planBoutique, fb_calculer, FB };
