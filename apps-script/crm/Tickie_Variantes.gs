/**
 * ============================================================
 *  Tickie_Variantes.gs — CRM Boutique Spacers (projet App_Boutique)
 *  Tailles S à XXL des maillots, créées comme variantes dans Tickie
 * ============================================================
 *  Prérequis : Tickie_Produits.gs dans le même projet (clé TICKIE_API_KEY_BOUTIQUE,
 *  colonne tickie_id remplie par tickieRelierProduits).
 *  Les identifiants Tickie sont lus dans 03_PRODUITS : plus rien à recopier à la main.
 *
 *  Ordre d'utilisation :
 *    1. lireMaillotBlanc()     → structure actuelle du produit (journal d'exécution)
 *    2. ajouterTaillesBlanc()  → TKV_CFG.DRY_RUN = true : aperçu, rien n'est envoyé
 *    3. DRY_RUN = false, relancer ajouterTaillesBlanc(), contrôler dans Tickie
 *    4. Si OK : ajouterTaillesCiel() puis ajouterTaillesBleuNuit()
 *
 *  Sécurités : même prix / TVA pour toutes les tailles (copie de la variante d'origine,
 *  dont l'ID est conservé) ; relecture après envoi ; si Tickie ne garde pas les noms de
 *  taille, le produit est remis à l'état initial. En cas de succès, l'ID Tickie de chaque
 *  taille est écrit dans la colonne tickie_variante_id de 03_PRODUITS.
 *
 *  v2.1 (04/10/2026) : _id généré pour chaque nouvelle taille (exigé par Tickie).
 *  v2 (04/10/2026) : noms préfixés (plus de const globales génériques BASE_URL / api_),
 *  IDs lus dans 03_PRODUITS, compte rendu à l'écran.
 * ============================================================
 */

var TKV_CFG = {
  DRY_RUN: true,                         // passer à false pour écrire réellement dans Tickie
  TAILLES: ['S', 'M', 'L', 'XL', 'XXL'],
  CHAMPS_SERVEUR: ['_id', 'createdAt', 'updatedAt', '__v', 'sellerId'],
  COL_VARIANTE_ID: 'tickie_variante_id'
};

function lireMaillotBlanc()       { tkvLire_('Maillot Blanc'); }
function ajouterTaillesBlanc()    { tkvAjouterTailles_('Maillot Blanc'); }
function ajouterTaillesCiel()     { tkvAjouterTailles_('Maillot Bleu Ciel'); }
function ajouterTaillesBleuNuit() { tkvAjouterTailles_('Maillot Bleu Nuit'); }

// ------------------------------------------------------------

function tkvLire_(modele) {
  var ui = SpreadsheetApp.getUi();
  try {
    var id = tkvIdProduit_(modele);
    var p = tkpGet_('/products/' + id);
    Logger.log(JSON.stringify(p, null, 2));
    var resume = (p.variants || []).map(function (v) {
      return (v.name || '(sans nom)') + ' — ' + tkpEuros_(v.price)
    }).join('\n');
    ui.alert(p.name, (p.variants || []).length + ' variante(s) :\n' + resume
      + '\n\nDétail complet : Apps Script › Exécutions.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert(modele + ' — échec', e.message, ui.ButtonSet.OK);
  }
}

function tkvAjouterTailles_(modele) {
  var ui = SpreadsheetApp.getUi();
  try {
    var id = tkvIdProduit_(modele);
    var p = tkpGet_('/products/' + id);
    if (!Array.isArray(p.variants) || !p.variants.length) throw new Error('Produit sans variante de prix : structure inattendue.');

    var T = TKV_CFG.TAILLES;
    var variantes = p.variants.map(function (v) { return JSON.parse(JSON.stringify(v)); });
    var nom0 = String(variantes[0].name || '').trim().toUpperCase();
    if (T.indexOf(nom0) < 0) variantes[0].name = T[0];   // la variante d'origine devient S (ID conservé)
    var deja = variantes.map(function (v) { return String(v.name || '').trim().toUpperCase(); });
    T.forEach(function (t) {
      if (deja.indexOf(t) >= 0) return;
      var v = JSON.parse(JSON.stringify(p.variants[0]));
      v._id = tkvObjectId_(); delete v.id;   // Tickie exige un _id fourni par le client
      if ('gtin' in v) v.gtin = '';
      v.name = t;
      variantes.push(v);
    });

    var corps = tkvSansChampsServeur_(p);
    corps.variants = variantes;
    var apercu = variantes.map(function (v) { return v.name + ' — ' + tkpEuros_(v.price); }).join('\n');

    if (TKV_CFG.DRY_RUN) {
      Logger.log('DRY_RUN — corps du PUT :\n' + JSON.stringify(corps, null, 2));
      ui.alert(p.name + ' — aperçu (rien envoyé)', 'Variantes qui seraient enregistrées :\n' + apercu
        + '\n\nPour écrire réellement : TKV_CFG.DRY_RUN = false, puis relancer.', ui.ButtonSet.OK);
      return;
    }

    if (ui.alert('Créer les tailles dans Tickie ?', p.name + '\n' + apercu, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

    var r = tkpEcrire_('put', '/products/' + id, corps);
    if (r.code < 200 || r.code >= 300) throw new Error('PUT refusé (' + r.code + ') : ' + r.corps.slice(0, 200) + '\nRien n\'a changé dans Tickie.');

    var apres = tkpGet_('/products/' + id);
    var noms = (apres.variants || []).map(function (v) { return String(v.name || '').trim().toUpperCase(); });
    var ok = T.every(function (t) { return noms.indexOf(t) >= 0; });
    if (!ok) {
      tkpEcrire_('put', '/products/' + id, tkvSansChampsServeur_(p));
      Logger.log('Variantes renvoyées par Tickie :\n' + JSON.stringify(apres.variants, null, 2));
      ui.alert(p.name + ' — échec', 'Tickie n\'a pas conservé les noms de taille (reçu : ' + JSON.stringify(noms) + ').\n'
        + 'Le produit a été remis à son état initial.', ui.ButtonSet.OK);
      return;
    }

    var ecrits = tkvEcrireIdsVariantes_(modele, apres.variants);
    ui.alert(p.name + ' — tailles créées', apres.variants.map(function (v) { return v.name + ' → ' + v._id; }).join('\n')
      + '\n\n' + ecrits + ' ligne(s) de 03_PRODUITS reliée(s) à leur taille Tickie (' + TKV_CFG.COL_VARIANTE_ID + ').', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert(modele + ' — échec', e.message, ui.ButtonSet.OK);
  }
}

// ------------------------------------------------------------

/** ID Tickie du modèle, lu dans la colonne tickie_id de 03_PRODUITS. */
function tkvIdProduit_(modele) {
  if (typeof tkpContexte_ !== 'function') throw new Error('Tickie_Produits.gs absent du projet.');
  var ctx = tkpContexte_(false);
  if (ctx.cId < 0) throw new Error('Colonne tickie_id absente : lancer d\'abord tickieRelierProduits.');
  var k = tkpCle2_(modele);
  for (var i = 1; i < ctx.pv.length; i++) {
    var m = ctx.cModele >= 0 ? ctx.pv[i][ctx.cModele] : ctx.pv[i][ctx.cNom];
    var id = String(ctx.pv[i][ctx.cId]).trim();
    if (tkpCle2_(m) === k && id) return id;
  }
  throw new Error('« ' + modele + ' » n\'est relié à aucun produit Tickie dans 03_PRODUITS (tickieRelierProduits).');
}

/** Identifiant au format MongoDB ObjectId (24 caractères hexadécimaux) : horodatage + aléa. */
function tkvObjectId_() {
  var ts = ('00000000' + Math.floor(Date.now() / 1000).toString(16)).slice(-8);
  return ts + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function tkvSansChampsServeur_(p) {
  var c = JSON.parse(JSON.stringify(p));
  TKV_CFG.CHAMPS_SERVEUR.forEach(function (k) { delete c[k]; });
  return c;
}

/** Écrit l'ID de chaque variante Tickie sur la ligne 03_PRODUITS de même modèle et même taille. */
function tkvEcrireIdsVariantes_(modele, variantes) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TKP_CFG.FEUILLE_PRODUITS);
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(tkpCle2_);
  var cVar = h.indexOf(tkpCle2_(TKV_CFG.COL_VARIANTE_ID));
  if (cVar < 0) {
    cVar = sh.getLastColumn();
    sh.getRange(1, cVar + 1).setValue(TKV_CFG.COL_VARIANTE_ID);
  }
  var cModele = h.indexOf('modele');
  var cTaille = h.indexOf('taille');
  if (cModele < 0 || cTaille < 0) return 0;
  var parTaille = {};
  variantes.forEach(function (v) { parTaille[String(v.name || '').trim().toUpperCase()] = v._id; });
  var pv = sh.getDataRange().getValues();
  var n = 0;
  for (var i = 1; i < pv.length; i++) {
    if (tkpCle2_(pv[i][cModele]) !== tkpCle2_(modele)) continue;
    var vid = parTaille[String(pv[i][cTaille]).trim().toUpperCase()];
    if (vid) { sh.getRange(i + 1, cVar + 1).setValue(vid); n++; }
  }
  return n;
}
function lireFlux() {
  var r = tkpGet_('/products/streams/rich');
  Logger.log(JSON.stringify(r, null, 2));
}