/**
 * ============================================================================
 *  FICHIER BOUTIQUE D'ÉLISE  <->  CRM BOUTIQUE  <->  TABLETTES
 *  Spacer's Toulouse Volley — saison 2026-2027
 * ----------------------------------------------------------------------------
 *  Remplace le classeur « Inventaire 2026 2027 ». Organisation décidée le 19/11 :
 *    1_COMMANDE        réceptions de commandes → dépôt (avec facture et prix d'achat)
 *    2_BOUTIQUE        répartition GP / VIP avant le match, comptage, réassort
 *    3_JOURNAL_VENTES  ventes des tablettes (GP / VIP) et add-ons Tickie remis
 *    4_TOP_VENTES      classement des articles, bilan par match
 *    5_APRES_MATCH     contrôle de caisse (TPE, espèces) par boutique
 *
 *  RÈGLE : le CRM reste la seule source du stock. Le fichier est l'écran d'Élise.
 *   - Cases JAUNES : Élise saisit. À la validation, chaque saisie devient un
 *     mouvement du CRM (fonctions de Stock_Boutique.gs : réception, répartition,
 *     transfert, inventaire), signé de son prénom, puis la case se vide.
 *   - Cases GRISES : écrites par ce script depuis le CRM (toutes les 10 min et
 *     après chaque validation). Jamais saisies à la main.
 *   - Les tablettes lisent le stock du CRM à « Charger le match » et lui renvoient
 *     les ventes à « Synchroniser tout » : le fichier les affiche au passage suivant.
 *  Aucune valeur absolue n'est recopiée du fichier vers le CRM : pas d'écrasement
 *  des ventes, des retraits ou des réceptions.
 *
 *  Dépendances (même projet Apps Script, fichiers existants inchangés) :
 *   Stock_Boutique.gs : enregistrerReception, enregistrerRepartition,
 *     enregistrerTransfert, enregistrerInventaire, rafraichirSynthese_,
 *     sb_lireProduits_, sb_cols_, sb_ongletOuCree_, sb_assurerColonnes_,
 *     sb_fmt_, sb_num_, sb_norm_, SB.
 *
 *  INSTALLATION (une fois, ~5 min)
 *   1. Projet Apps Script du classeur SPACERS_BOUTIQUE_CRM_V2 : ➕ Fichier › Script,
 *      nom « Fichier_Boutique », coller ce fichier, enregistrer.
 *   2. Sélectionner installerFichierBoutique → ▶ Exécuter → autoriser.
 *      Le journal d'exécution affiche le lien du nouveau classeur.
 *   3. Partager ce classeur avec Élise (éditeur).
 *   4. Facultatif : Propriétés du script › FB_ALERTE_EMAIL = adresse d'Élise
 *      (alerte de réassort envoyée une fois par match).
 *  Aucun nouveau déploiement Web App : les tablettes ne changent pas.
 *
 *  Fin de la période en parallèle : ▶ arreterAncienInventaire (retire les
 *  déclencheurs qui écrivent dans l'ancien classeur ; rien n'est supprimé).
 * ============================================================================
 */

const FB = {
  NOM_FICHIER: "Boutique Spacer's — stock et ventes 2026-2027",
  PROP_ID: 'FICHIER_BOUTIQUE_ID',
  PROP_ALERTE: 'FB_ALERTE_EMAIL',
  PROP_ALERTE_FAITE: 'FB_ALERTE_DERNIER_MATCH',
  DEBUT_SAISON: new Date(2026, 6, 1),
  FREQ_MIN: 10,
  T: {
    LIRE: '📖 LISEZ-MOI', CDE: '1_COMMANDE', BTQ: '2_BOUTIQUE', JRN: '3_JOURNAL_VENTES',
    TOP: '4_TOP_VENTES', APR: '5_APRES_MATCH'
  },
  HDR: 7,                     // ligne des en-têtes des tableaux 1 et 2
  // 1_COMMANDE : 11 colonnes grises, 2 jaunes, 1 résultat
  CDE_COLS: ['Réf.', 'Article', 'Taille', 'Dépôt', 'Boutique GP', 'Boutique VIP', 'TOTAL',
             'Reçu (saison)', 'Vendu + remis (saison)', 'Prix d\'achat HT (CRM)', 'Alerte',
             '➕ Reçu (quantité)', 'Prix d\'achat HT (si différent)', 'Résultat'],
  CDE_GRIS: 11, CDE_JAUNE: 2,
  // 2_BOUTIQUE : 10 colonnes grises, 5 jaunes, 1 résultat
  BTQ_COLS: ['Réf.', 'Article', 'Taille', 'Dépôt', 'Boutique GP', 'Boutique VIP',
             'Vendu GP (dernier match)', 'Vendu VIP (dernier match)', 'Add-ons remis GP (dernier match)',
             'Réassort conseillé',
             'Compté GP', 'Compté VIP', 'Compté dépôt', '🎯 Mettre en GP (total)', '🎯 Mettre en VIP (total)', 'Résultat'],
  BTQ_GRIS: 10, BTQ_JAUNE: 5,
  JRN_COLS: ['Date', 'Match', 'Boutique', 'Type', 'Réf.', 'Article', 'Taille', 'Qté', 'PU TTC', 'CA TTC', 'Paiement', 'Remise', 'Remarque'],
  CONTROLES: '25_CONTROLES_CAISSE',
  ENTETES_CONTROLES: ['horodatage', 'match', 'boutique', 'CA_tablette_TTC', 'CB_tablette', 'CB_TPE', 'ecart_CB',
                      'especes_tablette', 'especes_comptees', 'ecart_especes', 'offerts_articles', 'controle_par', 'commentaire'],
  ORDRE_TAILLES: ['116', '128', '140', '152', '164', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'TU', ''],
  SORTIES_MATCH: ['VENTE_COMPTOIR', 'OFFERT_CAISSE'],
  JAUNE: '#fff2cc', GRIS: '#eef1f5', NUIT: '#0b1f3a', BLEU: '#1f5fbf', ROUGE: '#b3261e', VERT: '#15803d',
  NOTICE_VERSION: 'fb-notice-v1'
};

/* ================================ INSTALLATION ================================ */

/** Crée le classeur (une seule fois), ses onglets et les déclencheurs. Relançable sans risque. */
function installerFichierBoutique() {
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

  const retires = fb_retirerDeclencheurs_(h => /^eb_/.test(h));   // « En boutique fait foi » : plus jamais de recopie absolue
  fb_construireTout_(ss, true);
  const feuille1 = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (feuille1 && ss.getSheets().length > 1) ss.deleteSheet(feuille1);

  Logger.log('Classeur : ' + ss.getUrl());
  Logger.log('Déclencheurs posés : modification du classeur + mise à jour toutes les ' + FB.FREQ_MIN + ' min.');
  if (retires.length) Logger.log('Déclencheurs « En boutique → CRM » retirés : ' + retires.join(', '));
  Logger.log('Étape suivante : partager le classeur avec Élise (éditeur).');
  return ss.getUrl();
}

/** Retire les déclencheurs du fichier (le classeur reste en place). */
function desinstallerFichierBoutique() {
  return fb_retirerDeclencheurs_(h => ['fb_surModification', 'majFichierBoutique', 'fb_traiterDemandes'].indexOf(h) !== -1);
}

/**
 * Fin de la période en parallèle : l'ancien « Inventaire 2026 2027 » n'est plus alimenté.
 * Retire les déclencheurs de Lien_Inventaire, Saisie_Inventaire, Inventaire_Boutique et Sync_EnBoutique.
 * Aucun onglet ni aucune donnée n'est supprimé.
 */
function arreterAncienInventaire() {
  // Liste fermée : Lien_Inventaire, Saisie_Inventaire, Inventaire_Boutique (projet du CRM) et Sync_EnBoutique (eb_*).
  // Le projet Apps Script propre au fichier d'Élise (déclencheurs Topventes) n'est pas touché.
  const anciens = ['majInventaireElise', 'majSaisieInventaire', 'si_surModification', 'si_traiterDemandes', 'majInventaire'];
  const r = fb_retirerDeclencheurs_(h => anciens.indexOf(h) !== -1 || /^eb_/.test(h));
  Logger.log(r.length ? 'Déclencheurs retirés : ' + r.join(', ') : 'Aucun déclencheur de l\'ancien inventaire trouvé.');
  Logger.log('Déclencheurs restants : ' + ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()).join(', '));
  return r;
}

/** Toutes les 10 min : traite les validations en attente puis rafraîchit les données du CRM. */
function majFichierBoutique() {
  const ss = fb_fichier_();
  if (!fb_prendreJeton_()) return;
  try {
    fb_traiterDemandes_(ss);
    fb_construireTout_(ss, false);
    fb_alerteReassort_();
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
  const ss = fb_fichier_();
  if (!fb_prendreJeton_()) { fb_programmer_(); return; }
  try {
    const fait = fb_traiterDemandes_(ss);
    fb_construireTout_(ss, false);
    if (fait) fb_alerteReassort_();
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
  const facture = String(sh.getRange('E4').getValue()).trim();
  const n = sh.getLastRow() - FB.HDR;
  if (n < 1) return 'Aucune ligne.';
  const nbC = FB.CDE_COLS.length;
  const data = sh.getRange(FB.HDR + 1, 1, n, nbC).getValues();
  const P = sb_lireProduits_();
  const saisies = data.map(r => ({ ref: String(r[0]).trim(), q: r[FB.CDE_GRIS], prix: r[FB.CDE_GRIS + 1] }));
  const plan = fb_planCommande(saisies, P.rows, !!facture);
  if (!plan.ok.length) {
    fb_ecrireResultats_(sh, plan.resultats, nbC);
    return plan.resultats.some(r => r) ? '⚠ Rien n\'a été enregistré : voir la colonne Résultat.' : 'Aucune quantité saisie.';
  }
  const heure = sb_fmt_(new Date(), 'dd/MM HH:mm');
  let nb = 0;
  fb_sansSynthese_(() => {
    plan.ok.forEach(o => {
      const ligne = FB.HDR + 1 + o.i;
      try {
        fb_appel_(enregistrerReception, { lignes: [{ ref: o.ref, R: o.q }], prix_achat: o.prix,
          fournisseur: facture, reference: facture }, auteur, '');
        sh.getRange(ligne, FB.CDE_GRIS + 1, 1, 2).clearContent();
        plan.resultats[o.i] = '✅ ' + heure + ' · +' + o.q + ' au dépôt à ' + fb_eur_(o.prix) + ' HT · dépôt ' + (o.x.R + o.q);
        nb++;
      } catch (err) {
        plan.resultats[o.i] = '❌ ' + err.message + ' — rien n\'a été enregistré pour cette ligne';
      }
    });
  });
  fb_ecrireResultats_(sh, plan.resultats, nbC);
  if (nb && plan.resultats.every(r => !r || String(r).indexOf('❌') !== 0)) sh.getRange('E4').clearContent();
  const pb = plan.resultats.filter(r => r && String(r).indexOf('❌') === 0).length;
  return (nb ? '✅ ' : '⚠ ') + heure + ' — ' + nb + ' réception(s) enregistrée(s) dans le CRM par ' + auteur +
         (pb ? ' · ⚠ ' + pb + ' ligne(s) refusée(s) : voir la colonne Résultat.' : '.');
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
    if (!aFacture) { resultats.push('❌ écrire le fournisseur et le n° de facture en E4'); return; }
    ok.push({ i: i, ref: x.ref, x: x, q: q, prix: Math.round(prix * 100) / 100 });
    resultats.push('');
  });
  return { ok: ok, resultats: resultats };
}

/** 2_BOUTIQUE : comptages (écarts) puis niveaux voulus en GP / VIP (mouvements depuis / vers le dépôt). */
function fb_validerBoutique_(sh) {
  const auteur = String(sh.getRange('B4').getValue()).trim();
  if (!auteur) throw new Error('Indiquez votre prénom en B4, puis cochez à nouveau « Valider ».');
  const n = sh.getLastRow() - FB.HDR;
  if (n < 1) return 'Aucune ligne.';
  const nbC = FB.BTQ_COLS.length;
  const data = sh.getRange(FB.HDR + 1, 1, n, nbC).getValues();
  const P = sb_lireProduits_();                       // stock du CRM au moment de la validation
  const g = FB.BTQ_GRIS;
  const saisies = data.map(r => ({ ref: String(r[0]).trim(), cGP: r[g], cVIP: r[g + 1], cR: r[g + 2], tGP: r[g + 3], tVIP: r[g + 4] }));
  const plan = fb_planBoutique(saisies, P.rows);
  if (!plan.ok.length) {
    fb_ecrireResultats_(sh, plan.resultats, nbC);
    return plan.resultats.some(r => r) ? '⚠ Rien n\'a été enregistré : voir la colonne Résultat.' : 'Aucune saisie.';
  }
  const heure = sb_fmt_(new Date(), 'dd/MM HH:mm');
  const match = fb_matchTablettes_();
  let nb = 0;
  fb_sansSynthese_(() => {
    plan.ok.forEach(o => {
      const ligne = FB.HDR + 1 + o.i;
      const faits = [];
      for (const op of o.ops) {
        try {
          if (op.type === 'rien') {
            /* niveau déjà atteint : on vide seulement la case */
          } else if (op.type === 'inventaire') {
            fb_appel_(enregistrerInventaire, { lignes: [{ ref: o.ref, R: op.R, B1: op.B1, B2: op.B2 }],
              commentaire: 'Comptage ' + auteur }, auteur, match);
          } else if (op.type === 'repartition') {
            fb_appel_(enregistrerRepartition, { lignes: [{ ref: o.ref, B1: op.B1, B2: op.B2 }] }, auteur, match);
          } else {
            fb_appel_(enregistrerTransfert, { ref: o.ref, quantite: op.q, de: op.de, vers: op.vers }, auteur, match);
          }
        } catch (err) {
          plan.resultats[o.i] = '❌ ' + err.message + (faits.length ? ' — déjà enregistré : ' + faits.join(', ') : '') +
                                ' — vérifier puis revalider';
          return;
        }
        sh.getRange(ligne, g + 1 + op.colonne, 1, op.nbCols || 1).clearContent();   // case appliquée = case vidée
        faits.push(op.libelle);
      }
      plan.resultats[o.i] = '✅ ' + heure + ' · ' + faits.join(', ') + ' · maintenant dépôt ' + o.apres.R + ' / GP ' + o.apres.B1 + ' / VIP ' + o.apres.B2;
      nb++;
    });
  });
  fb_ecrireResultats_(sh, plan.resultats, nbC);
  const pb = plan.resultats.filter(r => r && String(r).indexOf('❌') === 0).length;
  return (nb ? '✅ ' : '⚠ ') + heure + ' — ' + nb + ' article(s) mis à jour dans le CRM par ' + auteur +
         (pb ? ' · ⚠ ' + pb + ' ligne(s) refusée(s) : voir la colonne Résultat.' : '.') +
         (nb ? ' Tablettes : « 🎫 Charger le match » pour prendre ce stock.' : '');
}

/**
 * Plan d'une ligne de 2_BOUTIQUE (sans écriture). Exporté pour les tests.
 *  1. Comptés (GP, VIP, dépôt) : corrigent le stock du CRM (AJUSTEMENT_INVENTAIRE).
 *  2. Niveaux voulus « Mettre en GP / VIP » (totaux) : on rapporte d'abord au dépôt
 *     ce qui est en trop, puis on sort du dépôt ce qui manque. Le dépôt doit suffire.
 *  La ligne est refusée entière si un contrôle échoue : rien n'est appliqué à moitié.
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
    const t = { B1: lire(s.tGP), B2: lire(s.tVIP) };
    const toutes = [c.B1, c.B2, c.R, t.B1, t.B2];
    if (toutes.every(v => v.vide)) { resultats.push(null); return; }
    const x = produits.find(p => p.ref === s.ref);
    if (!x) { resultats.push('❌ référence inconnue du CRM'); return; }
    if (toutes.some(v => v.invalide)) { resultats.push('❌ nombres entiers positifs uniquement'); return; }

    const ops = [];
    let R = x.R, B1 = x.B1, B2 = x.B2;
    if (!c.B1.vide || !c.B2.vide || !c.R.vide) {
      const inv = { type: 'inventaire', R: c.R.vide ? '' : c.R.q, B1: c.B1.vide ? '' : c.B1.q, B2: c.B2.vide ? '' : c.B2.q,
                    colonne: 0, nbCols: 3 };
      const lib = [];
      if (!c.B1.vide) { lib.push('compté GP ' + c.B1.q + (c.B1.q !== B1 ? ' (' + fb_signe_(c.B1.q - B1) + ')' : '')); B1 = c.B1.q; }
      if (!c.B2.vide) { lib.push('compté VIP ' + c.B2.q + (c.B2.q !== B2 ? ' (' + fb_signe_(c.B2.q - B2) + ')' : '')); B2 = c.B2.q; }
      if (!c.R.vide)  { lib.push('compté dépôt ' + c.R.q + (c.R.q !== R ? ' (' + fb_signe_(c.R.q - R) + ')' : '')); R = c.R.q; }
      inv.libelle = lib.join(', ');
      ops.push(inv);
    }
    const d1 = t.B1.vide ? 0 : t.B1.q - B1;
    const d2 = t.B2.vide ? 0 : t.B2.q - B2;
    // retours au dépôt d'abord
    if (d1 < 0) { ops.push({ type: 'transfert', q: -d1, de: 'B1', vers: 'R', colonne: 3, libelle: (-d1) + ' GP → dépôt' }); R += -d1; B1 += d1; }
    if (d2 < 0) { ops.push({ type: 'transfert', q: -d2, de: 'B2', vers: 'R', colonne: 4, libelle: (-d2) + ' VIP → dépôt' }); R += -d2; B2 += d2; }
    const besoin = Math.max(0, d1) + Math.max(0, d2);
    if (besoin > R) {
      resultats.push('❌ il faut ' + besoin + ' au dépôt, il y en a ' + R + (c.R.vide ? '' : ' (compté)') +
                     ' : baisser le niveau voulu ou enregistrer la réception — rien n\'a été enregistré');
      return;
    }
    if (d1 > 0 || d2 > 0) {
      const lib = [];
      if (d1 > 0) lib.push(d1 + ' dépôt → GP');
      if (d2 > 0) lib.push(d2 + ' dépôt → VIP');
      ops.push({ type: 'repartition', B1: Math.max(0, d1), B2: Math.max(0, d2), colonne: 3, nbCols: 2, libelle: lib.join(', ') });
      R -= besoin; B1 += Math.max(0, d1); B2 += Math.max(0, d2);
    }
    // niveau voulu déjà atteint : on vide la case sans mouvement
    if (!t.B1.vide && d1 === 0) ops.push({ type: 'rien', colonne: 3, libelle: 'GP déjà à ' + t.B1.q });
    if (!t.B2.vide && d2 === 0) ops.push({ type: 'rien', colonne: 4, libelle: 'VIP déjà à ' + t.B2.q });
    // l'ordre des cases vidées : une répartition vide GP et VIP ; si une seule cible a bougé, ne vider que la sienne
    ops.forEach(op => {
      if (op.type === 'repartition' && !(d1 > 0 && d2 > 0)) { op.nbCols = 1; op.colonne = d1 > 0 ? 3 : 4; }
    });
    ok.push({ i: i, ref: x.ref, x: x, ops: ops, apres: { R: R, B1: B1, B2: B2 } });
    resultats.push('');
  });
  return { ok: ok, resultats: resultats };
}

/** Case « 📝 Proposer le réassort » : pré-remplit les niveaux voulus (rien n'est enregistré). */
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
    if (s.gp > 0) { sh.getRange(FB.HDR + 1 + i, g + 4).setValue(s.cibleGP); pieces += s.gp; }
    if (s.vip > 0) { sh.getRange(FB.HDR + 1 + i, g + 5).setValue(s.cibleVIP); pieces += s.vip; }
    if (s.gp > 0 || s.vip > 0) lignes++;
  });
  return lignes ? '📝 Réassort proposé sur ' + lignes + ' article(s) (' + pieces + ' pièce(s)) dans « 🎯 Mettre en GP / VIP ». Vérifier, corriger si besoin, puis cocher « ✅ Valider ».'
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
  const shC = sb_ongletOuCree_(FB.CONTROLES, FB.ENTETES_CONTROLES);
  const cC = sb_assurerColonnes_(shC, FB.ENTETES_CONTROLES);
  lignes.forEach(r => {
    const row = new Array(shC.getLastColumn()).fill('');
    const set = (k, v) => { if (cC[k]) row[cC[k] - 1] = v; };
    set('horodatage', new Date()); set('match', match); set('boutique', r[0]); set('CA_tablette_TTC', r[2]);
    set('CB_tablette', r[3]); set('CB_TPE', r[6]); set('ecart_CB', r[6] === '' ? '' : fb_r2_(r[6] - r[3]));
    set('especes_tablette', r[4]); set('especes_comptees', r[7]); set('ecart_especes', r[7] === '' ? '' : fb_r2_(r[7] - r[4]));
    set('offerts_articles', r[5]); set('controle_par', auteur); set('commentaire', commentaire);
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
  return fb_calculer(produits, P.rows, mvts, ventes, live, FB.DEBUT_SAISON);
}

/**
 * Calculs purs (sans accès au classeur) — exportés pour les tests.
 * produits : articles actifs avec réf. ; tousProduits : tout 03_PRODUITS (pour relier un nom vendu à sa réf.)
 * mvts / ventes / live : tableaux d'objets { en-tête: valeur }.
 */
function fb_calculer(produits, tousProduits, mvts, ventes, live, debut) {
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
    if (['VENTE_COMPTOIR', 'OFFERT_CAISSE', 'RETRAIT_ADDON', 'VENTE_HORS_MATCH'].indexOf(type) !== -1) s.sorti += -q;
    if ((FB.SORTIES_MATCH.indexOf(type) !== -1 || type === 'RETRAIT_ADDON') && match) {
      recentes.push({ d: d || new Date(0), match: match });
      const k = match + '|' + ref;
      const o = sortiesMatch[k] = sortiesMatch[k] || { B1: 0, B2: 0, addon: 0 };
      if (type === 'RETRAIT_ADDON') o.addon += -q;
      else if (m.point === 'B2') o.B2 += -q; else o.B1 += -q;
    }
  });
  recentes.sort((a, b) => b.d - a.d);
  const dernierMatch = recentes.length ? recentes[0].match : '';

  // --- réassort conseillé : remettre le niveau de départ du dernier match, dans la limite du dépôt
  const reassort = {};
  produits.forEach(x => {
    const o = sortiesMatch[dernierMatch + '|' + x.ref];
    if (!o) return;
    const sortGP = o.B1 + o.addon, sortVIP = o.B2;
    let dispo = x.R;
    const gp = Math.min(sortGP, dispo); dispo -= gp;
    const vip = Math.min(sortVIP, dispo);
    reassort[x.ref] = { gp: gp, vip: vip, cibleGP: x.B1 + gp, cibleVIP: x.B2 + vip, manque: (sortGP - gp) + (sortVIP - vip) };
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

  // --- ventes reçues en direct mais pas encore synchronisées (« Synchroniser tout » pas fait)
  const cles = ventes.map(v => String(v.commande || ''));
  const nonSync = {};
  live.forEach(l => {
    const id = String(l['ID vente'] || '').trim();
    if (!id) return;
    const d = date(l['Horodatage']);
    if (d && d < debut) return;
    if (cles.some(c => c.indexOf(id) !== -1)) return;
    const b = String(l['Boutique']).trim() === 'B2' ? 'VIP' : 'GP';
    nonSync[b] = (nonSync[b] || 0) + num(l['Qté']);
  });

  return { produits: produits, saison: saison, dernierMatch: dernierMatch, sortiesMatch: sortiesMatch,
           reassort: reassort, journal: journal, top: topListe, matchs: matchs, nonSync: nonSync };
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
}

function fb_ordre_(produits) {
  const rang = t => { const i = FB.ORDRE_TAILLES.indexOf(String(t || '').toUpperCase()); return i === -1 ? 50 : i; };
  return produits.slice().sort((a, b) =>
    String(a.modele).localeCompare(String(b.modele), 'fr') || rang(a.taille) - rang(b.taille) || String(a.ref).localeCompare(String(b.ref)));
}

/** Tableau à saisie : les colonnes grises sont réécrites, les saisies jaunes sont conservées par référence. */
function fb_tableauSaisie_(ss, nom, titre, consigne, cols, nbGris, nbJaune, lignesGrises, entete) {
  let sh = ss.getSheetByName(nom);
  const neuf = !sh;
  const nbC = cols.length;
  if (neuf) {
    sh = ss.insertSheet(nom);
    sh.getRange('A1').setValue(titre).setFontSize(14).setFontWeight('bold').setFontColor(FB.NUIT);
    sh.getRange('A2').setValue(consigne).setFontColor('#555555');
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
  sh.getRange('A3').setValue('Données du CRM lues le ' + sb_fmt_(new Date()) + ' (mise à jour automatique toutes les ' + FB.FREQ_MIN + ' min)')
    .setFontColor('#888888').setFontSize(9);
  return sh;
}

function fb_construireCommande_(ss, D, ordre) {
  const lignes = ordre.map(x => {
    const s = D.saison[x.ref] || { recu: 0, sorti: 0 };
    const total = x.R + x.B1 + x.B2;
    const alerte = total <= 0 ? '❌ Rupture totale' : (x.R <= 0 ? 'Dépôt vide' : (total <= (x.seuil || 0) ? '⚠ Stock bas' : ''));
    return [x.ref, x.modele || x.produit, x.taille || 'TU', x.R, x.B1, x.B2, total, s.recu, s.sorti, x.cout || '', alerte];
  });
  const sh = fb_tableauSaisie_(ss, FB.T.CDE, '1 · COMMANDES ET STOCK — réceptions au dépôt',
    'Livraison reçue : prénom en B4 · fournisseur et n° de facture en E4 · quantité reçue (et prix d\'achat HT s\'il a changé) dans les cases JAUNES · cocher « ✅ Valider ». Tout entre au DÉPÔT.',
    FB.CDE_COLS, FB.CDE_GRIS, FB.CDE_JAUNE, lignes, sh => {
      sh.getRange('D4').setValue('Fournisseur / n° facture :').setFontWeight('bold').setHorizontalAlignment('right');
      sh.getRange('E4:F4').merge().setBackground(FB.JAUNE);
      [110, 200, 60, 70, 85, 85, 70, 80, 95, 90, 130, 95, 110, 360].forEach((w, i) => sh.setColumnWidth(i + 1, w));
      sh.getRange(FB.HDR, 7).setBackground('#000000');
    });
  sh.getRange(FB.HDR + 1, 10, Math.max(lignes.length, 1), 1).setNumberFormat('#,##0.00 €');
  fb_couleursAlertes_(sh, 11, lignes.length);
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
    return [x.ref, x.modele || x.produit, x.taille || 'TU', x.R, x.B1, x.B2, o.B1 || '', o.B2 || '', o.addon || '', conseil];
  });
  const sh = fb_tableauSaisie_(ss, FB.T.BTQ, '2 · BOUTIQUES GP ET VIP — préparation du match',
    'Avant le match : prénom en B4 · « 🎯 Mettre en GP / VIP » = combien tu veux en boutique (TOTAL, pas l\'ajout) · « Compté » = ce que tu comptes · cocher « ✅ Valider ». Le dépôt est ajusté tout seul.',
    FB.BTQ_COLS, FB.BTQ_GRIS, FB.BTQ_JAUNE, lignes, sh => {
      sh.getRange('I4').setValue('📝 Proposer le réassort →').setFontWeight('bold').setHorizontalAlignment('right');
      sh.getRange('I4:K4').merge();
      sh.getRange('L4').insertCheckboxes().setBackground(FB.JAUNE);
      [110, 200, 60, 70, 85, 85, 85, 85, 95, 200, 75, 75, 75, 95, 95, 380].forEach((w, i) => sh.setColumnWidth(i + 1, w));
      sh.getRange(FB.HDR, 5).setBackground(FB.BLEU); sh.getRange(FB.HDR, 6).setBackground(FB.ROUGE);
      sh.getRange(FB.HDR, 14).setBackground(FB.BLEU); sh.getRange(FB.HDR, 15).setBackground(FB.ROUGE);
    });
  const mt = fb_matchTablettes_();
  sh.getRange('A6').setValue('Dernier match vendu : ' + (D.dernierMatch || '—') + '   ·   Match des tablettes : ' + (mt || '—') +
    fb_texteNonSync_(D)).setFontColor(Object.keys(D.nonSync).length ? FB.ROUGE : '#555555').setFontSize(9).setFontWeight('bold');
  fb_couleursAlertes_(sh, 10, lignes.length);
}

function fb_construireJournal_(ss, D) {
  let sh = ss.getSheetByName(FB.T.JRN);
  const nbC = FB.JRN_COLS.length;
  if (!sh) {
    sh = ss.insertSheet(FB.T.JRN);
    sh.getRange('A1').setValue('3 · JOURNAL DES VENTES — tablettes GP / VIP, ventes hors match, add-ons remis').setFontSize(14).setFontWeight('bold').setFontColor(FB.NUIT);
    sh.getRange('A2').setValue('Automatique, depuis le CRM : rien à saisir. Les ventes d\'un match arrivent après « Synchroniser tout » sur chaque tablette. Les ventes en ligne sont suivies dans le CRM.').setFontColor('#555555');
    sh.getRange(5, 1, 1, nbC).setValues([FB.JRN_COLS]).setFontWeight('bold').setBackground(FB.NUIT).setFontColor('#ffffff');
    sh.setFrozenRows(5);
    [120, 200, 80, 120, 110, 200, 60, 50, 70, 80, 90, 70, 260].forEach((w, i) => sh.setColumnWidth(i + 1, w));
    sh.setHiddenGridlines(true);
  }
  const lignes = D.journal.map(j => [j.d, j.match, j.boutique, j.type, j.ref, j.article, j.taille, j.q, j.pu, j.ca, j.paiement, j.remise, j.remarque]);
  const n0 = Math.max(0, sh.getLastRow() - 5);
  if (n0 > 0) sh.getRange(6, 1, n0, nbC).clearContent().setBackground(null);
  if (lignes.length) {
    sh.getRange(6, 1, lignes.length, nbC).setValues(lignes).setFontFamily('Arial').setFontSize(9);
    sh.getRange(6, 1, lignes.length, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange(6, 9, lignes.length, 2).setNumberFormat('#,##0.00 €');
    lignes.forEach((l, i) => {
      if (l[3] === 'Retrait add-on') sh.getRange(6 + i, 1, 1, nbC).setBackground('#e8f1fb');
      else if (String(l[12]).indexOf('⚠') === 0) sh.getRange(6 + i, 1, 1, nbC).setBackground('#fde2e1');
    });
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
    sh.getRange('A2').setValue('Automatique. Vendu = caisse (GP + VIP + hors match) ; les add-ons Tickie remis au stand sont comptés à part.').setFontColor('#555555');
    sh.setHiddenGridlines(true);
    [40, 220, 80, 70, 70, 90, 100, 110, 20, 230, 100, 100, 100, 100].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  }
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
    sh.getRange('A2').setValue('1. Match en B4 · 2. « CB relevé TPE » = ticket de fin de journée du terminal · « Espèces comptées » = espèces dans la caisse MOINS le fond de caisse (30 € par boutique) · 3. Prénom en E4 · 4. Cocher « ✅ Valider le contrôle ». Le comptage du stock se fait dans 2_BOUTIQUE.').setFontColor('#555555');
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
  sh.getRange(9, 1, 2, 10).setValues(lignes).setFontFamily('Arial');
  sh.getRange(9, 1, 2, 6).setBackground(FB.GRIS);
  sh.getRange(9, 7, 2, 2).setBackground(FB.JAUNE);
  sh.getRange(9, 9, 2, 2).setBackground(FB.GRIS);
  sh.getRange(9, 3, 2, 6).setNumberFormat('#,##0.00 €');
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
    ['Ce classeur remplace « Inventaire 2026 2027 ». Il est relié au CRM du club et donc aux deux tablettes : ce que tu valides ici part dans le CRM en 1 à 2 minutes ; les ventes des tablettes reviennent ici toutes seules.', 'I'],
    ['', 'V'],
    ['LES 3 RÈGLES', 'S'],
    ['🟨 Cases JAUNES = c\'est toi qui les remplis.   ⬜ Cases GRISES = elles viennent du CRM, on n\'y touche jamais (Google avertit si on essaie).', 'E'],
    ['☑️ Rien n\'est enregistré tant que tu n\'as pas coché « ✅ Valider ». Ton prénom est obligatoire.', 'E'],
    ['✅ Après validation, la colonne « Résultat » dit ce qui a été fait et les cases jaunes appliquées se vident : impossible de compter deux fois.', 'E'],
    ['', 'V'],
    ['① UNE COMMANDE ARRIVE — onglet 1_COMMANDE', 'S'],
    ['1. Prénom en B4. Fournisseur et n° de facture en E4 (obligatoire).', 'E'],
    ['2. Sur la ligne de l\'article et de la taille : quantité reçue dans « ➕ Reçu ». Si le prix d\'achat HT a changé, l\'écrire à côté (sinon le prix connu du CRM est pris).', 'E'],
    ['3. Cocher « ✅ Valider ». Tout entre au DÉPÔT. Le prix d\'achat sert au calcul de la marge et à la comptabilité.', 'E'],
    ['EXEMPLE : 50 écharpes reçues, facture FA26081234 → E4 « Fournisseur X FA26081234 », ligne ECH-TU « ➕ Reçu » = 50, Valider.', 'X'],
    ['', 'V'],
    ['② AVANT LE MATCH — onglet 2_BOUTIQUE', 'S'],
    ['1. Prénom en B4.', 'E'],
    ['2. Si tu as compté : « Compté GP », « Compté VIP », « Compté dépôt » (case vide = pas compté). Le CRM est corrigé de l\'écart.', 'E'],
    ['3. Dans « 🎯 Mettre en GP » et « 🎯 Mettre en VIP », écris le NOMBRE TOTAL que tu veux dans chaque boutique (pas l\'ajout). Le dépôt est ajusté tout seul : ce qui manque sort du dépôt, ce qui est en trop y retourne.', 'E'],
    ['   Raccourci : coche « 📝 Proposer le réassort » : les niveaux du dernier match sont pré-remplis (dans la limite du dépôt). Vérifie, corrige, puis Valider.', 'I'],
    ['4. Cocher « ✅ Valider ». Puis, sur CHAQUE tablette, en wifi : Synchronisation → « 🎫 Charger le match ». C\'est ce qui envoie ton stock aux tablettes.', 'E'],
    ['EXEMPLE : il reste 2 écharpes en GP, tu en veux 20 → « 🎯 Mettre en GP » = 20. Résultat : « 18 dépôt → GP · maintenant dépôt 101 / GP 20 / VIP 7 ».', 'X'],
    ['', 'V'],
    ['③ PENDANT LE MATCH — les tablettes', 'S'],
    ['Les bénévoles vendent sur les tablettes, même sans internet. Les add-ons Tickie (écharpe, maillot achetés avec le billet) se remettent uniquement à la boutique GP, en scannant le billet : ils sortent du stock GP tout seuls.', 'I'],
    ['À la fermeture : clôturer la caisse puis « Synchroniser tout » sur chaque tablette dès qu\'il y a du réseau. Sans ça, les ventes ne sont pas déduites du stock.', 'A'],
    ['', 'V'],
    ['④ APRÈS LE MATCH', 'S'],
    ['3_JOURNAL_VENTES et 4_TOP_VENTES se remplissent tout seuls (ventes GP / VIP, add-ons remis). Un bandeau rouge signale une tablette qui n\'a pas fait « Synchroniser tout ».', 'I'],
    ['2_BOUTIQUE montre ce qui s\'est vendu au dernier match et le « Réassort conseillé ». Si une adresse d\'alerte est réglée, tu reçois aussi un mail de réassort une fois par match.', 'I'],
    ['5_APRES_MATCH : saisir le relevé TPE et les espèces comptées (sans le fond de caisse de 30 €) de chaque boutique, ton prénom, puis « ✅ Valider le contrôle ». Le rapport part par mail.', 'E'],
    ['', 'V'],
    ['CE QUI NE SE FAIT PAS ICI', 'S'],
    ['Dons, cadeaux partenaires, casse, vente en dehors d\'un match : page Gestion (spacers-boutique.spacersytb.workers.dev/gestion.html). Nouvel article ou prix de vente : prévenir Clément.', 'I'],
    ['EN CAS DE SOUCI', 'S'],
    ['❌ dans « Résultat » : la ligne n\'a PAS été enregistrée (le message dit pourquoi). Corriger puis recocher « Valider ».', 'E'],
    ['Rien ne bouge après 5 minutes : recocher « Valider » ; si ça continue, prévenir Clément.', 'E'],
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
function fb_alerteReassort_() {
  const props = PropertiesService.getScriptProperties();
  const dest = props.getProperty(FB.PROP_ALERTE);
  if (!dest || !/@/.test(dest)) return;
  const D = fb_donnees_();
  if (!D.dernierMatch || props.getProperty(FB.PROP_ALERTE_FAITE) === D.dernierMatch) return;
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
  h += '<p>Dans le fichier boutique, onglet 2_BOUTIQUE : cocher « 📝 Proposer le réassort », vérifier, puis « ✅ Valider ».</p>';
  try {
    MailApp.sendEmail({ to: dest, subject: '🔁 Boutique — réassort après ' + D.dernierMatch, htmlBody: h });
    props.setProperty(FB.PROP_ALERTE_FAITE, D.dernierMatch);
  } catch (e) { console.warn('Alerte réassort : ' + e.message); }
}

/* ==================================== OUTILS ==================================== */

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

/** Évite deux traitements simultanés du fichier (le verrou du script reste aux fonctions de stock et aux tablettes). */
function fb_prendreJeton_() {
  const c = CacheService.getScriptCache();
  if (c.get('fb_en_cours')) return false;
  c.put('fb_en_cours', '1', 300);
  return true;
}
function fb_rendreJeton_() { CacheService.getScriptCache().remove('fb_en_cours'); }

/** Appelle une fonction de Stock_Boutique.gs et signe les mouvements créés (auteur, match). */
function fb_appel_(fn, p, auteur, match) {
  const ss = SpreadsheetApp.getActive();
  const sh0 = ss.getSheetByName(SB.ONGLET_MOUVEMENTS);
  const avant = sh0 ? sh0.getLastRow() : 1;
  const msg = fn(p);
  const sh = ss.getSheetByName(SB.ONGLET_MOUVEMENTS);
  if (sh && sh.getLastRow() > avant) {
    const c = sb_cols_(sh);
    const nb = sh.getLastRow() - avant;
    if (c.auteur) sh.getRange(avant + 1, c.auteur, nb, 1).setValue('Fichier boutique · ' + auteur);
    if (c.match && match) {
      const rg = sh.getRange(avant + 1, c.match, nb, 1);
      rg.setValues(rg.getValues().map(v => [v[0] || match]));
    }
  }
  return msg;
}

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
    const auj = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd');
    const L = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().map(r => {
      const d = r[c['Date'] - 1] instanceof Date ? r[c['Date'] - 1] : new Date(r[c['Date'] - 1]);
      return { nom: String(r[c['Match'] - 1]).trim(), jour: isNaN(d) ? '' : Utilities.formatDate(d, 'Europe/Paris', 'yyyy-MM-dd'),
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
