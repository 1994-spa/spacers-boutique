/**
 * ============================================================
 *  Tickie_Produits.gs — CRM Boutique Spacers (Apps Script V3)
 *  Prix des add-ons Tickie pilotés depuis 03_PRODUITS
 * ============================================================
 *  Prérequis : propriété du script TICKIE_API_KEY_BOUTIQUE
 *  (clé « App_Boutique – Produits (Apps Script) », droits Produits voir/créer/modifier).
 *
 *  tickieTesterProduits() : lit tous les produits Tickie et les écrit dans la
 *  feuille TICKIE_PRODUITS (id, nom, prix, actif + JSON brut complet).
 *  Aucune écriture vers Tickie.
 *
 *  PRIX UNIQUE : prix_vente de 03_PRODUITS est le prix du stand ET de l'add-on Tickie.
 *
 *  tickieRelierProduits() : ajoute si besoin la colonne tickie_id
 *  à 03_PRODUITS, relie chaque ligne active à son produit Tickie par le nom
 *  (tickie_produit, sinon modele, sinon produit — sans accents ni casse) et
 *  signale les produits dont prix_vente diffère du prix Tickie (sans rien modifier).
 *  Toutes les tailles d'un même maillot partagent le même produit Tickie.
 *
 *  tickiePousserPrix() : compare prix_vente (CRM) au prix Tickie, affiche les
 *  écarts, demande confirmation, met à jour Tickie, relit pour vérifier,
 *  aligne TICKIE_MAPPING et journalise dans TICKIE_PRIX_LOG.
 *  Le CRM est la référence : on modifie le prix dans prix_vente, jamais dans Tickie.
 * ============================================================
 */

var TKP_CFG = {
  PROPRIETE_CLE: 'TICKIE_API_KEY_BOUTIQUE',
  BASE: 'https://vivenu.com/api',
  FEUILLE: 'TICKIE_PRODUITS',
  FEUILLE_PRODUITS: '03_PRODUITS',
  FEUILLE_LOG: 'TICKIE_PRIX_LOG',
  FEUILLE_MAPPING: 'TICKIE_MAPPING',
  COL_ID: 'tickie_id',
  COL_PRIX: 'prix_vente',
  TAILLE_PAGE: 100,
  MAX_PAGES: 20
};

function tickieTesterProduits() {
  var ui = SpreadsheetApp.getUi();
  try {
    var produits = tkpLireTous_('/products');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(TKP_CFG.FEUILLE) || ss.insertSheet(TKP_CFG.FEUILLE);
    sh.clear();
    var entetes = ['ID Tickie', 'Nom', 'Prix', 'Actif', 'Variantes', 'JSON brut'];
    var lignes = produits.map(function (p) {
      var variantes = p.variants || p.variations || p.options || [];
      return [
        String(p._id || p.id || ''),
        String(p.name || p.title || ''),
        tkpPrix_(p),
        p.active === undefined ? '' : (p.active ? 'O' : 'N'),
        Array.isArray(variantes) ? variantes.length : '',
        JSON.stringify(p).slice(0, 49000)
      ];
    });
    sh.getRange(1, 1, 1, entetes.length).setValues([entetes])
      .setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff');
    if (lignes.length) sh.getRange(2, 1, lignes.length, entetes.length).setValues(lignes);
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, 5);
    sh.setColumnWidth(6, 400);
    ss.setActiveSheet(sh);
    ui.alert('Produits Tickie', produits.length + ' produit(s) lu(s) dans Tickie → feuille ' + TKP_CFG.FEUILLE
      + '.\n\nAucune modification n\'a été faite dans Tickie.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Produits Tickie — échec', e.message, ui.ButtonSet.OK);
  }
}

// ------------------------------------------------------------
//  API (lecture)
// ------------------------------------------------------------

function tkpCle_() {
  var k = PropertiesService.getScriptProperties().getProperty(TKP_CFG.PROPRIETE_CLE);
  if (!k || !k.trim()) {
    throw new Error('Propriété du script « ' + TKP_CFG.PROPRIETE_CLE + ' » absente.\n'
      + 'Apps Script › ⚙️ Paramètres du projet › Propriétés du script.');
  }
  return k.trim();
}

function tkpGet_(chemin, params) {
  var url = TKP_CFG.BASE + chemin;
  var qs = Object.keys(params || {}).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  if (qs) url += (url.indexOf('?') < 0 ? '?' : '&') + qs;
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + tkpCle_(), Accept: 'application/json' }
  });
  var code = resp.getResponseCode();
  var corps = resp.getContentText();
  if (code === 401) throw new Error('401 — clé refusée : vérifie la valeur de ' + TKP_CFG.PROPRIETE_CLE + '.');
  if (code === 403) throw new Error('403 — droit manquant sur la clé : ' + corps.slice(0, 200));
  if (code < 200 || code >= 300) throw new Error(code + ' sur ' + chemin + ' — ' + corps.slice(0, 200));
  try { return JSON.parse(corps); } catch (e) { throw new Error('Réponse non-JSON sur ' + chemin); }
}

function tkpLireTous_(chemin) {
  var tous = [];
  for (var page = 0; page < TKP_CFG.MAX_PAGES; page++) {
    var data = tkpGet_(chemin, { top: TKP_CFG.TAILLE_PAGE, skip: page * TKP_CFG.TAILLE_PAGE });
    var lot = Array.isArray(data) ? data : (data.docs || data.rows || data.items || []);
    tous = tous.concat(lot);
    if (lot.length < TKP_CFG.TAILLE_PAGE) return tous;
  }
  throw new Error('Plus de ' + (TKP_CFG.MAX_PAGES * TKP_CFG.TAILLE_PAGE) + ' produits : lecture interrompue.');
}

function tkpPrix_(p) {
  if (Array.isArray(p.variants) && p.variants.length) return p.variants[0].price;
  var v = p.price !== undefined ? p.price : '';
  if (v && typeof v === 'object') v = v.amount !== undefined ? v.amount : '';
  return v;
}

function tkpEcrire_(methode, chemin, corps) {
  var resp = UrlFetchApp.fetch(TKP_CFG.BASE + chemin, {
    method: methode,
    muteHttpExceptions: true,
    contentType: 'application/json',
    payload: JSON.stringify(corps),
    headers: { Authorization: 'Bearer ' + tkpCle_(), Accept: 'application/json' }
  });
  return { code: resp.getResponseCode(), corps: resp.getContentText() };
}

// ------------------------------------------------------------
//  Lien 03_PRODUITS <-> produits Tickie
// ------------------------------------------------------------

function tickieRelierProduits() {
  var ui = SpreadsheetApp.getUi();
  try {
    var produits = tkpLireTous_('/products');
    var parNom = {};
    produits.forEach(function (p) {
      var k = tkpCle2_(p.name);
      if (k) (parNom[k] = parNom[k] || []).push(p);
    });

    var ctx = tkpContexte_(true);
    var pv = ctx.pv;
    var relies = 0, ecartsPrix = {}, sansProduit = {}, utilises = {}, doublons = [];

    for (var i = 1; i < pv.length; i++) {
      if (ctx.cActif >= 0 && !tkpActif_(pv[i][ctx.cActif])) continue;
      var noms = [ctx.cTickieProduit, ctx.cModele, ctx.cNom]
        .filter(function (c) { return c >= 0 && String(pv[i][c]).trim(); })
        .map(function (c) { return String(pv[i][c]).trim(); });
      if (!noms.length) continue;
      var trouve = null;
      for (var n = 0; n < noms.length && !trouve; n++) {
        var lst = parNom[tkpCle2_(noms[n])];
        if (lst && lst.length === 1) trouve = lst[0];
        else if (lst && lst.length > 1 && doublons.indexOf(noms[n]) < 0) doublons.push(noms[n]);
      }
      if (!trouve) { sansProduit[noms[0]] = true; continue; }
      utilises[trouve._id] = true;
      if (String(pv[i][ctx.cId]).trim() !== trouve._id) {
        ctx.sh.getRange(i + 1, ctx.cId + 1).setValue(trouve._id);
        relies++;
      }
      if (ctx.cPrixTickie >= 0 && tkpPrix_(trouve) !== ''
          && Math.abs(tkpMontant_(pv[i][ctx.cPrixTickie]) - Number(tkpPrix_(trouve))) > 0.001) {
        ecartsPrix[trouve.name] = tkpEuros_(tkpMontant_(pv[i][ctx.cPrixTickie])) + ' CRM / ' + tkpEuros_(tkpPrix_(trouve)) + ' Tickie';
      }
    }

    var nonUtilises = produits.filter(function (p) { return !utilises[p._id]; })
      .map(function (p) { return p.name + ' (' + tkpEuros_(tkpPrix_(p)) + ')'; });
    var out = [
      'Lignes reliées ou mises à jour : ' + relies,
    ];
    var ecarts = Object.keys(ecartsPrix).map(function (k) { return k + ' : ' + ecartsPrix[k]; });
    out.push(ecarts.length ? '\nPrix à envoyer (tickiePousserPrix) : ' + ecarts.join(', ') : 'Prix CRM et Tickie identiques.');
    if (Object.keys(sansProduit).length) out.push('', 'Actifs CRM sans produit Tickie : ' + Object.keys(sansProduit).join(', '));
    if (nonUtilises.length) out.push('', 'Produits Tickie non reliés : ' + nonUtilises.join(', '));
    if (doublons.length) out.push('', '⚠ Nom porté par plusieurs produits Tickie : ' + doublons.join(', '));
    ui.alert('Lien CRM ↔ Tickie', out.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Lien CRM ↔ Tickie — échec', e.message, ui.ButtonSet.OK);
  }
}

// ------------------------------------------------------------
//  Envoi des prix CRM -> Tickie
// ------------------------------------------------------------

function tickiePousserPrix() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ctx = tkpContexte_(false);
    if (ctx.cId < 0 || ctx.cPrixTickie < 0) throw new Error('Colonnes tickie_id / prix_vente absentes : lance d\'abord tickieRelierProduits.');
    var pv = ctx.pv;

    // 1. Un prix par produit Tickie (toutes les tailles doivent être d'accord).
    var groupes = {}, ordre = [], incoherents = [];
    for (var i = 1; i < pv.length; i++) {
      var id = String(pv[i][ctx.cId]).trim();
      if (!id) continue;
      if (ctx.cActif >= 0 && !tkpActif_(pv[i][ctx.cActif])) continue;
      var brut = pv[i][ctx.cPrixTickie];
      if (String(brut).trim() === '') continue;
      var prix = tkpMontant_(brut);
      var nom = ctx.cModele >= 0 && String(pv[i][ctx.cModele]).trim() ? pv[i][ctx.cModele] : pv[i][ctx.cNom];
      if (!groupes[id]) { groupes[id] = { prix: prix, nom: String(nom).trim() }; ordre.push(id); }
      else if (Math.abs(groupes[id].prix - prix) > 0.001 && incoherents.indexOf(groupes[id].nom) < 0) incoherents.push(groupes[id].nom);
    }
    if (incoherents.length) throw new Error('prix_vente différent selon la taille pour : ' + incoherents.join(', ')
      + '.\nUn produit Tickie n\'a qu\'un prix : aligne toutes ses lignes.');

    // 2. Comparaison avec Tickie.
    var changements = [], ignores = [];
    ordre.forEach(function (id) {
      var p = tkpGet_('/products/' + id);
      if (!Array.isArray(p.variants) || !p.variants.length) {
        ignores.push(p.name + ' (aucune variante de prix)');
        return;
      }
      // Toutes les variantes (tailles) portent le même prix : on aligne celles qui s'écartent.
      var prixVariantes = p.variants.map(function (v) { return Number(v.price); });
      var actuel = prixVariantes[0];
      var aCorriger = prixVariantes.some(function (x) { return Math.abs(x - groupes[id].prix) > 0.001; });
      if (aCorriger) changements.push({ id: id, produit: p, avant: actuel, apres: groupes[id].prix,
        nbVariantes: p.variants.length });
    });

    if (!changements.length) {
      ui.alert('Prix Tickie', 'Tous les prix Tickie sont déjà alignés sur prix_vente.'
        + (ignores.length ? '\n\nNon traités : ' + ignores.join(', ') : ''), ui.ButtonSet.OK);
      return;
    }

    var apercu = changements.map(function (c) {
      return '• ' + c.produit.name + ' : ' + tkpEuros_(c.avant) + ' → ' + tkpEuros_(c.apres)
        + (c.nbVariantes > 1 ? ' (' + c.nbVariantes + ' tailles)' : '');
    }).join('\n');
    var rep = ui.alert('Mettre à jour Tickie ?', apercu
      + '\n\nLe nouveau prix s\'applique à tous les événements qui proposent ce produit.'
      + (ignores.length ? '\n\nNon traités : ' + ignores.join(', ') : ''), ui.ButtonSet.YES_NO);
    if (rep !== ui.Button.YES) return;

    // 3. Mise à jour, relecture, journal.
    var ok = 0, erreurs = [], log = [], maintenant = new Date(), qui = tkpUtilisateur_();
    changements.forEach(function (c) {
      var corps = tkpCorpsProduit_(c.produit, c.apres);
      var r = tkpEcrire_('put', '/products/' + c.id, corps);
      if (r.code === 404 || r.code === 405) r = tkpEcrire_('patch', '/products/' + c.id, { variants: corps.variants });
      var verifie = '';
      if (r.code >= 200 && r.code < 300) {
        var relu = tkpGet_('/products/' + c.id);
        var tous = (relu.variants || []).map(function (v) { return Number(v.price); });
        verifie = tous.length && tous.every(function (x) { return Math.abs(x - c.apres) < 0.001; }) ? c.apres : (tous[0] || 0);
      }
      if (verifie !== '' && Math.abs(verifie - c.apres) < 0.001) {
        ok++;
        log.push([maintenant, c.produit.name, c.id, c.avant, c.apres, 'OK', qui]);
        tkpMajMapping_(c.produit.name, c.apres);
      } else {
        var msg = r.code >= 200 && r.code < 300 ? 'prix relu ' + verifie : r.code + ' — ' + r.corps.slice(0, 150);
        erreurs.push(c.produit.name + ' : ' + msg);
        log.push([maintenant, c.produit.name, c.id, c.avant, c.apres, 'ÉCHEC ' + msg, qui]);
      }
    });
    tkpJournal_(log);

    ui.alert('Prix Tickie', ok + ' produit(s) mis à jour et vérifiés dans Tickie.'
      + (erreurs.length ? '\n\n⚠ Échecs :\n' + erreurs.join('\n') : '')
      + '\n\nDétail dans ' + TKP_CFG.FEUILLE_LOG + '.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Prix Tickie — échec', e.message, ui.ButtonSet.OK);
  }
}

/** Produit complet renvoyé à Tickie, prix de toutes les variantes (tailles) remplacé, champs système retirés. */
function tkpCorpsProduit_(p, prix) {
  var corps = JSON.parse(JSON.stringify(p));
  ['_id', 'sellerId', 'createdAt', 'updatedAt', '__v'].forEach(function (k) { delete corps[k]; });
  corps.variants.forEach(function (v) { v.price = prix; });
  return corps;
}

function tkpMajMapping_(nom, prix) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TKP_CFG.FEUILLE_MAPPING);
  if (!sh || sh.getLastRow() < 2) return;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  for (var i = 0; i < v.length; i++) {
    if (tkpCle2_(v[i][0]) === tkpCle2_(nom)) sh.getRange(i + 2, 4).setValue(prix);
  }
}

function tkpJournal_(lignes) {
  if (!lignes.length) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TKP_CFG.FEUILLE_LOG);
  if (!sh) {
    sh = ss.insertSheet(TKP_CFG.FEUILLE_LOG);
    sh.getRange(1, 1, 1, 7).setValues([['Date', 'Produit Tickie', 'ID Tickie', 'Prix avant', 'Prix après', 'Résultat', 'Par']])
      .setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange('D:E').setNumberFormat('#,##0.00 €');
  }
  sh.getRange(sh.getLastRow() + 1, 1, lignes.length, 7).setValues(lignes);
}

// ------------------------------------------------------------
//  Utilitaires 03_PRODUITS
// ------------------------------------------------------------

/** Lit 03_PRODUITS ; avecCreation = ajoute tickie_id en fin de tableau si absente. */
function tkpContexte_(avecCreation) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TKP_CFG.FEUILLE_PRODUITS);
  if (!sh) throw new Error('Feuille ' + TKP_CFG.FEUILLE_PRODUITS + ' introuvable.');
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(tkpCle2_);
  if (avecCreation) {
    [TKP_CFG.COL_ID].forEach(function (nom) {
      if (h.indexOf(tkpCle2_(nom)) < 0) {
        var col = sh.getLastColumn() + 1;
        sh.getRange(1, col).setValue(nom);
        h.push(tkpCle2_(nom));
      }
    });
  }
  var pv = sh.getDataRange().getValues();
  var col = function (noms) {
    for (var i = 0; i < noms.length; i++) { var p = h.indexOf(tkpCle2_(noms[i])); if (p >= 0) return p; }
    return -1;
  };
  var prefixe = function (pre) { for (var i = 0; i < h.length; i++) if (h[i].indexOf(pre) === 0) return i; return -1; };
  return {
    sh: sh, pv: pv,
    cId: col([TKP_CFG.COL_ID]),
    cPrixTickie: col([TKP_CFG.COL_PRIX]),
    cNom: col(['produit', 'nom']),
    cModele: col(['modele']),
    cActif: col(['actif']),
    cTickieProduit: prefixe('tickiepro')
  };
}

function tkpCle2_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tkpActif_(v) {
  return v === true || /^(true|vrai|o|oui|1)$/i.test(String(v).trim());
}

function tkpMontant_(s) {
  if (typeof s === 'number') return s;
  var n = parseFloat(String(s == null ? '' : s).replace(/[^\d,.\-]/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function tkpEuros_(n) {
  return (n === '' || n == null) ? '?' : Number(n).toFixed(2).replace('.', ',') + ' €';
}

function tkpUtilisateur_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

// ------------------------------------------------------------
//  Menu (appelé par onOpen de Crm boutique v3.gs)
// ------------------------------------------------------------

function menuTickieBoutique_() {
  var menu = SpreadsheetApp.getUi().createMenu('🎟️ Add-ons Tickie');
  if (typeof ouvrirImportTickie === 'function') {
    menu.addItem('📥 Importer les ventes add-on (CSV Tickie)', 'ouvrirImportTickie')
        .addItem('📦 Appliquer le stock (après choix des tailles)', 'tickieAppliquerStock')
        .addSeparator();
  }
  menu.addItem('💶 Envoyer les prix vers Tickie', 'tickiePousserPrix')
      .addItem('🔗 Relier les produits CRM ↔ Tickie', 'tickieRelierProduits')
      .addSeparator()
      .addItem('🔍 Lire les produits Tickie (lecture seule)', 'tickieTesterProduits');
  if (typeof tickieControlerDenominations === 'function') {
    menu.addItem('🏷️ Contrôler les dénominations', 'tickieControlerDenominations');
  }
  if (typeof ajouterTaillesBlanc === 'function') {
    menu.addSeparator()
        .addSubMenu(SpreadsheetApp.getUi().createMenu('👕 Tailles des maillots')
          .addItem('Lire le maillot Blanc', 'lireMaillotBlanc')
          .addItem('Tailles : Maillot Blanc', 'ajouterTaillesBlanc')
          .addItem('Tailles : Maillot Bleu Ciel', 'ajouterTaillesCiel')
          .addItem('Tailles : Maillot Bleu Nuit', 'ajouterTaillesBleuNuit'));
  }
  menu.addToUi();
}