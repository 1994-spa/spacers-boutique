/**
 * DRIVE BOUTIQUE — factures fournisseurs & ventes de la boutique en ligne
 * ------------------------------------------------------------------------
 * Dossiers créés à côté du classeur (dans le même dossier Drive) :
 *   📥 Factures fournisseurs        → déposer les factures (PDF, photo…)
 *   📥 Ventes en ligne (extractions) → déposer l'extraction du site (xlsx ou csv)
 *
 * importerDepuisDrive() :
 *   • chaque nouvelle facture → une ligne dans 17_FACTURES (lien, canal, à compléter)
 *   • chaque nouvelle extraction → 16_VENTES_EN_LIGNE (détail brut, sans doublon)
 *     puis 01_VENTES (source « site », boutique « SITE », montants TTC) et 05_CLIENTS
 *   • un fichier déjà traité n'est jamais relu (identifiant gardé dans le registre)
 *
 * Lecture des .xlsx : service avancé « Drive API » (v3) activé dans le projet.
 */

var DB = {
  DOSSIER_FACTURES: '📥 Factures fournisseurs',
  DOSSIER_VENTES: '📥 Ventes en ligne (extractions)',
  ONGLET_FACTURES: '17_FACTURES',
  ONGLET_SITE: '16_VENTES_EN_LIGNE',
  TVA: 0.20,
  ENTETES_FACTURES: ['ajoutée le', 'fichier', 'lien', 'canal', 'fournisseur', 'n° facture', 'date facture', 'échéance',
                     'montant HT', 'TVA', 'montant TTC', 'détail (lu sur la facture)', 'statut', 'commentaire', 'id_fichier'],
  ENTETES_SITE: ['importé le', 'fichier source', 'clé', 'Id', 'Ref commande', 'Date commande', 'Ref produit',
                 'Ref fournisseur', 'Nom fournisseur', 'Email client', 'Produit', 'Personnalisation', 'Typologie produit',
                 'Quantité', 'Prix vente € HT', 'Total vente € HT', 'Remboursement € HT', 'Net € HT', 'Net € TTC',
                 'Payplug ID', 'Facture', 'Date Facture', 'Saison']
};

/* ── Menu (appelé par onOpen de CRM_Boutique_V3.gs) ── */
function menuDriveBoutique_() {
  SpreadsheetApp.getUi().createMenu('📥 Drive')
    .addItem('Importer factures et ventes en ligne', 'importerDepuisDrive')
    .addItem('Ouvrir le dossier des factures', 'ouvrirDossierFactures')
    .addItem('Ouvrir le dossier des extractions du site', 'ouvrirDossierVentes')
    .addSeparator()
    .addItem('Import automatique chaque nuit (activer)', 'activerImportQuotidien')
    .addToUi();
}

function importerDepuisDrive() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var f = importerFactures_();
    var v = importerVentesEnLigne_();
    var msg = f + '\n' + v;
    try { if (typeof reconstruireSaisons === 'function') reconstruireSaisons(); } catch (e) {}
    Logger.log(msg);
    try { SpreadsheetApp.getActive().toast(msg, '📥 Import Drive', 10); } catch (e) {}
    return msg;
  } finally { lock.releaseLock(); }
}

function activerImportQuotidien() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'importerDepuisDrive') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('importerDepuisDrive').timeBased().everyDays(1).atHour(6).create();
  try { SpreadsheetApp.getActive().toast('Import des factures et ventes en ligne tous les jours vers 6 h.', '📥 Drive', 6); } catch (e) {}
  return 'Déclencheur quotidien installé (6 h).';
}

function ouvrirDossierFactures() { ouvrirLien_(dossier_(DB.DOSSIER_FACTURES).getUrl(), 'Dossier des factures'); }
function ouvrirDossierVentes() { ouvrirLien_(dossier_(DB.DOSSIER_VENTES).getUrl(), 'Dossier des extractions du site'); }
function ouvrirLien_(url, titre) {
  var h = HtmlService.createHtmlOutput('<p style="font-family:Arial"><a href="' + url + '" target="_blank">Ouvrir : ' + titre + '</a></p>' +
    '<script>window.open(' + JSON.stringify(url) + ',"_blank");</script>').setWidth(360).setHeight(80);
  SpreadsheetApp.getUi().showModalDialog(h, titre);
}

/* ── Dossiers (à côté du classeur) ── */
function dossierParent_() {
  var parents = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents();
  return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
}
function dossier_(nom) {
  var p = dossierParent_(), it = p.getFoldersByName(nom);
  return it.hasNext() ? it.next() : p.createFolder(nom);
}
function onglet_(nom, entetes) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(nom);
  if (!sh) {
    sh = ss.insertSheet(nom);
    sh.getRange(1, 1, 1, entetes.length).setValues([entetes]).setFontWeight('bold').setBackground('#001E2D').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}
function colonnes_(sh) {
  var m = {};
  sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].forEach(function (v, i) { var k = String(v).trim(); if (k && !m[k]) m[k] = i + 1; });
  return m;
}
function nombre_(v) {
  if (typeof v === 'number') return v;
  var n = Number(String(v === null || v === undefined ? '' : v).replace(/\s|€/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
function date_(v) {
  if (v instanceof Date) return v;
  var s = String(v || '').trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  if ((m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/))) return new Date(+m[3], +m[2] - 1, +m[1], 12);
  return s ? new Date(s) : '';
}
function saison_(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  var y = d.getFullYear(); return d.getMonth() >= 6 ? y + '-' + (y + 1) : (y - 1) + '-' + y;
}

/* ── 1. FACTURES ── */
function importerFactures_() {
  var sh = onglet_(DB.ONGLET_FACTURES, DB.ENTETES_FACTURES), c = colonnes_(sh);
  var n = sh.getLastRow() - 1;
  var connus = {};
  if (n > 0) sh.getRange(2, c.id_fichier, n, 1).getValues().forEach(function (r) { connus[r[0]] = true; });
  var it = dossier_(DB.DOSSIER_FACTURES).getFiles(), ajout = 0;
  while (it.hasNext()) {
    var f = it.next();
    if (connus[f.getId()] || f.isTrashed()) continue;
    var nom = f.getName(), ligne = sh.getLastRow() + 1;
    var row = new Array(sh.getLastColumn()).fill('');
    var set = function (k, v) { if (c[k]) row[c[k] - 1] = v; };
    set('ajoutée le', new Date());
    set('fichier', nom);
    set('lien', '=HYPERLINK("' + f.getUrl() + '";"📄 ouvrir")');
    set('canal', /mizuno|site|en.?ligne|web/i.test(nom) ? 'Boutique en ligne' : 'Boutique match');
    var lu = lireFacture_(f);
    set('fournisseur', lu.fournisseur || '');
    set('n° facture', lu.numero || (nom.match(/\b(FA\d{5,})\b/i) || [])[1] || '');
    set('date facture', lu.date || '');
    set('échéance', lu.echeance || '');
    set('montant HT', lu.ht === null ? '' : lu.ht);
    set('détail (lu sur la facture)', lu.detail || '');
    if (/echarpe|écharpe|scarf/i.test(nom + ' ' + (lu.detail || ''))) set('commentaire', 'Écharpes');
    set('id_fichier', f.getId());
    sh.getRange(ligne, 1, 1, row.length).setValues([row]);
    // Statut : facture du stand → doit apparaître dans 02_ACHATS (réception) ; facture site → coût des ventes en ligne
    sh.getRange(ligne, c.statut).setFormula('=IF(' + a1_(ligne, c['n° facture']) + '="";"⚠️ compléter n° et montant";IF(' +
      a1_(ligne, c.canal) + '="Boutique en ligne";"✓ coût ventes en ligne";IF(COUNTIF(\'02_ACHATS\'!$I:$I;' + a1_(ligne, c['n° facture']) +
      ')>0;"✓ réceptionnée en stock";"⏳ à réceptionner (menu 📦)")))');
    sh.getRange(ligne, c.TVA).setFormula('=IF(' + a1_(ligne, c['montant HT']) + '="";"";ROUND(' + a1_(ligne, c['montant HT']) + '*' + String(DB.TVA).replace('.', ',') + ';2))');
    sh.getRange(ligne, c['montant TTC']).setFormula('=IF(' + a1_(ligne, c['montant HT']) + '="";"";' + a1_(ligne, c['montant HT']) + '+' + a1_(ligne, c.TVA) + ')');
    ajout++;
  }
  if (ajout) {
    var dv = SpreadsheetApp.newDataValidation().requireValueInList(['Boutique match', 'Boutique en ligne', 'Mixte'], true).build();
    sh.getRange(2, c.canal, sh.getLastRow() - 1, 1).setDataValidation(dv);
    sh.getRange(2, c['montant HT'], sh.getLastRow() - 1, 3).setNumberFormat('#,##0.00 "€"');
    sh.getRange(2, c['date facture'], sh.getLastRow() - 1, 2).setNumberFormat('dd/mm/yyyy');
    sh.getRange(2, c['détail (lu sur la facture)'], sh.getLastRow() - 1, 1).setWrap(true);
    sh.getRange(2, c['ajoutée le'], sh.getLastRow() - 1, 1).setNumberFormat('dd/mm/yyyy');
  }
  return ajout + ' facture(s) ajoutée(s) au registre ' + DB.ONGLET_FACTURES + '.';
}
/**
 * Lit une facture PDF / image : copie temporaire en Google Doc avec reconnaissance de texte (Drive v3),
 * puis repère numéro, dates, total HT, fournisseur et lignes article (format Full Ace et formats courants).
 */
function lireFacture_(f) {
  var r = { numero: '', date: '', echeance: '', ht: null, fournisseur: '', detail: '' };
  if (!/pdf|image/i.test(f.getMimeType())) return r;
  var txt = '';
  try {
    var doc = Drive.Files.copy({ name: '_tmp_ocr_' + f.getName(), mimeType: MimeType.GOOGLE_DOCS }, f.getId(), { ocrLanguage: 'fr' });
    try { txt = DocumentApp.openById(doc.id).getBody().getText(); } finally { DriveApp.getFileById(doc.id).setTrashed(true); }
  } catch (e) { Logger.log('Lecture impossible ' + f.getName() + ' : ' + e.message); return r; }
  var m;
  if ((m = txt.match(/\b(FA\d{5,}|F[A-Z]?-?\d{4,}-?\d*)\b/))) r.numero = m[1];
  var dates = (txt.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || []).map(date_);
  if (dates[0]) r.date = dates[0];
  if (dates[1]) r.echeance = dates[1];
  var tot = txt.match(/TOTAL HT[ \t:]*([\d .\u00a0\u202f]+,\d{2})\s*€/g);
  if (tot) r.ht = nombre_(tot[tot.length - 1].replace(/TOTAL HT/, '').replace(/[\u00a0\u202f]/g, ''));
  if ((m = txt.match(/\b(?:SAS|SARL|SA|EURL|SASU)\s+([A-Z][A-Z0-9 &'-]{2,40})/))) r.fournisseur = m[1].trim();
  // Lignes article : « désignation  quantité  PU HT  total HT »
  var lignes = [];
  var precedente = '';
  txt.split(/\n/).forEach(function (l) {
    var x = l.match(/^\s*(.*?)\s*(\d{1,5})\s+([\d\s]+,\d{2,3})\s*€\s+([\d\s]+,\d{2})\s*€/);
    if (x && !/total/i.test(x[1])) lignes.push(x[2] + ' × ' + (x[1].trim() || precedente) + ' à ' + x[3].trim() + ' € HT');
    if (l.trim()) precedente = l.trim();
  });
  r.detail = lignes.join('\n');
  return r;
}

function a1_(r, c) { var l = '', n = c; while (n > 0) { var m = (n - 1) % 26; l = String.fromCharCode(65 + m) + l; n = Math.floor((n - 1) / 26); } return l + r; }

/* ── 2. VENTES EN LIGNE ── */
function importerVentesEnLigne_() {
  var sh = onglet_(DB.ONGLET_SITE, DB.ENTETES_SITE), c = colonnes_(sh);
  var n = sh.getLastRow() - 1;
  var cles = {}, fichiersVus = {};
  if (n > 0) sh.getRange(2, 1, n, sh.getLastColumn()).getValues().forEach(function (r) {
    cles[r[c['clé'] - 1]] = true; fichiersVus[String(r[c['fichier source'] - 1])] = true;
  });
  var it = dossier_(DB.DOSSIER_VENTES).getFiles(), lignesSite = [], fichiers = 0;
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    var etiquette = f.getName() + ' [' + f.getId().slice(-6) + ']';
    if (fichiersVus[etiquette]) continue;
    var tab = lireTableau_(f);
    if (!tab || tab.length < 2) continue;
    fichiers++;
    var h = tab[0].map(function (x) { return String(x).trim(); });
    var col = function (nom) { return h.indexOf(nom); };
    if (col('Ref commande') < 0 || col('Total vente € HT') < 0) { Logger.log('Format inconnu : ' + f.getName()); continue; }
    var agg = {};
    tab.slice(1).forEach(function (r) {
      var g = function (nom) { var i = col(nom); return i < 0 ? '' : r[i]; };
      if (!g('Ref commande')) return;
      var cle = [g('Ref commande'), g('Ref produit'), g('Personnalisation')].join('|');
      var a = agg[cle] = agg[cle] || { r: r, g: g, q: 0, ht: 0, remb: 0 };
      a.q += nombre_(g('Quantité')); a.ht += nombre_(g('Total vente € HT')); a.remb += nombre_(g('Remboursement € HT'));
    });
    Object.keys(agg).forEach(function (cle) {
      if (cles[cle]) return;
      cles[cle] = true;
      var a = agg[cle], g = a.g, d = date_(g('Date commande')), net = Math.round((a.ht - a.remb) * 100) / 100;
      lignesSite.push({ cle: cle, d: d, q: a.q, net: net, ttc: Math.round(net * (1 + DB.TVA) * 100) / 100, g: g, fichier: etiquette });
    });
  }
  if (!lignesSite.length) return fichiers ? 'Ventes en ligne : aucune nouvelle ligne (déjà importées).' : 'Ventes en ligne : aucune nouvelle extraction dans le dossier.';

  // 16_VENTES_EN_LIGNE (détail brut)
  var now = new Date();
  var rows = lignesSite.map(function (l) {
    var g = l.g, row = new Array(sh.getLastColumn()).fill('');
    var set = function (k, v) { if (c[k]) row[c[k] - 1] = v; };
    set('importé le', now); set('fichier source', l.fichier); set('clé', l.cle); set('Id', g('Id')); set('Ref commande', g('Ref commande'));
    set('Date commande', l.d); set('Ref produit', g('Ref produit')); set('Ref fournisseur', g('Ref fournisseur'));
    set('Nom fournisseur', g('Nom fournisseur')); set('Email client', String(g('Email client') || '').toLowerCase()); set('Produit', g('Nom'));
    set('Personnalisation', String(g('Personnalisation') || '').replace(/^;$/, '')); set('Typologie produit', g('Typologie produit'));
    set('Quantité', l.q); set('Prix vente € HT', l.q ? Math.round(l.net / l.q * 100) / 100 : 0); set('Total vente € HT', nombre_(g('Total vente € HT')));
    set('Remboursement € HT', nombre_(g('Remboursement € HT'))); set('Net € HT', l.net); set('Net € TTC', l.ttc);
    set('Payplug ID', g('Payplug ID')); set('Facture', g('Facture')); set('Date Facture', date_(g('Date Facture'))); set('Saison', saison_(l.d));
    return row;
  });
  var debut = sh.getLastRow() + 1;
  sh.getRange(debut, 1, rows.length, rows[0].length).setValues(rows);
  ['Prix vente € HT', 'Total vente € HT', 'Remboursement € HT', 'Net € HT', 'Net € TTC'].forEach(function (k) {
    if (c[k]) sh.getRange(debut, c[k], rows.length, 1).setNumberFormat('#,##0.00 "€"');
  });
  ['Date commande', 'Date Facture', 'importé le'].forEach(function (k) { if (c[k]) sh.getRange(debut, c[k], rows.length, 1).setNumberFormat('dd/mm/yyyy'); });

  // 01_VENTES (référence) : même structure que les autres canaux, montants TTC
  var v = SpreadsheetApp.getActive().getSheetByName('01_VENTES'), ajout01 = 0;
  if (v) {
    var exist = {};
    if (v.getLastRow() > 1) v.getRange(2, 3, v.getLastRow() - 1, 1).getValues().forEach(function (r) { exist[String(r[0])] = true; });
    var r01 = lignesSite.filter(function (l) { return !exist['SITE_' + l.cle]; }).map(function (l) {
      var g = l.g;
      return [l.d, 'site', 'SITE_' + l.cle, String(g('Email client') || '').toLowerCase(), g('Nom'), g('Typologie produit') || 'Boutique en ligne',
              l.q, l.q ? Math.round(l.ttc / l.q * 100) / 100 : 0, l.ttc, '', 'SITE', saison_(l.d), 'En ligne (Payplug)'];
    });
    if (r01.length) { v.getRange(v.getLastRow() + 1, 1, r01.length, r01[0].length).setValues(r01); ajout01 = r01.length; }
  }
  // 05_CLIENTS : base clients de la boutique en ligne (fonction de CRM_Boutique_V3.gs)
  var clients = 0;
  if (typeof upsertClient_ === 'function') {
    var parCommande = {};
    lignesSite.forEach(function (l) {
      var k = l.g('Ref commande'); parCommande[k] = parCommande[k] || { email: l.g('Email client'), ttc: 0, d: l.d };
      parCommande[k].ttc += l.ttc;
    });
    Object.keys(parCommande).forEach(function (k) { var o = parCommande[k]; if (upsertClient_(o.email, o.ttc, o.d, 'Boutique en ligne')) clients++; });
  }
  var total = lignesSite.reduce(function (s, l) { return s + l.net; }, 0);
  return 'Ventes en ligne : ' + lignesSite.length + ' ligne(s) importée(s) (' + Math.round(total * 100) / 100 + ' € HT), ' +
    ajout01 + ' ajoutée(s) à 01_VENTES, ' + clients + ' nouveau(x) client(s).';
}

/** Lit un .xlsx, .csv ou Google Sheet du Drive et renvoie un tableau de lignes. */
function lireTableau_(f) {
  var mime = f.getMimeType();
  if (mime === MimeType.CSV || /\.csv$/i.test(f.getName())) {
    var txt = f.getBlob().getDataAsString('UTF-8');
    var sep = (txt.split('\n')[0].match(/;/g) || []).length > (txt.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    return Utilities.parseCsv(txt, sep);
  }
  if (mime === MimeType.GOOGLE_SHEETS) return SpreadsheetApp.openById(f.getId()).getSheets()[0].getDataRange().getValues();
  if (/spreadsheetml|excel/i.test(mime) || /\.xlsx?$/i.test(f.getName())) {
    // Conversion temporaire en Google Sheet (service avancé Drive v3), lecture, puis suppression de la copie
    var copie = Drive.Files.copy({ name: '_tmp_import_' + f.getName(), mimeType: MimeType.GOOGLE_SHEETS }, f.getId());
    try { return SpreadsheetApp.openById(copie.id).getSheets()[0].getDataRange().getDisplayValues(); }
    finally { DriveApp.getFileById(copie.id).setTrashed(true); }
  }
  return null;
}

/* ── 3. ENVELOPPE « Événement partenaires / tournoi » (une fois) ── */
function ajouterEnveloppeEvenement() {
  var sh = SpreadsheetApp.getActive().getSheetByName('14_ENVELOPPES_DOTATIONS');
  if (!sh) return 'Onglet 14 absent : ouvrir d\'abord le panneau stock.';
  var noms = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 1).getValues().map(function (r) { return String(r[0]).trim(); });
  var nom = 'Événement partenaires / tournoi (lots, cadeaux)';
  if (noms.indexOf(nom) !== -1) return 'Enveloppe déjà présente.';
  sh.appendRow([nom, 'Partenariats', '', '', '6238', 'OUI', 'NON', 'VRAI', 'Soirée partenaires, tournoi, séminaire : bénéficiaire = partenaire ou « lots tournoi X »']);
  return 'Enveloppe « ' + nom + ' » ajoutée.';
}
