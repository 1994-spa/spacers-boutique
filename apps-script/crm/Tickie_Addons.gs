/**
 * ============================================================
 *  Tickie_Addons.gs — CRM Boutique Spacers (Apps Script V3)
 *  Import des ventes add-on Tickie (module « Gestion des produits »)
 *  -> journal TICKIE_ADDONS + décrément du stock dans 03_PRODUITS
 * ============================================================
 *  Points d'entrée (à brancher dans le menu) :
 *   - ouvrirImportTickie()   : fenêtre de choix du CSV exporté depuis Tickie
 *                              (Marketplace > Gestion des produits > événement > Exporter)
 *   - tickieAppliquerStock() : décrémente le stock des lignes contrôlées « OK »
 *                              pas encore décomptées (à relancer après un arbitrage)
 *
 *  Idempotent : une transaction déjà présente dans le journal n'est jamais réimportée,
 *  une ligne déjà décomptée (Stock décrémenté = O) ne l'est jamais deux fois.
 *
 *  Contrôle : « Revenu Produits » Tickie  vs  Σ (quantité × prix) des colonnes produits.
 *  L'export Tickie peut omettre une colonne produit (constaté sur Narbonne : maillot absent
 *  du CSV). L'écart est alors attribué au SEUL produit actif absent de l'export dont le prix
 *  divise l'écart ; sinon la ligne passe « À ARBITRER » (aucun mouvement de stock).
 *
 *  Paramétrage : feuille TICKIE_MAPPING (créée automatiquement au 1er import).
 *
 *  Dénomination unique (V3) : un libellé Tickie est relié à 03_PRODUITS, dans l'ordre,
 *  par la réf (ref_boutique), puis par la colonne tickie_produit, puis modele, puis produit
 *  (comparaison sans accents ni casse, jamais de correspondance partielle).
 *  Plusieurs lignes trouvées (tailles) -> « Taille à préciser » : liste déroulante des réfs
 *  dans la colonne Réf produit du journal, puis tickieAppliquerStock.
 *  tickieControlerDenominations() remplit tickie_produit / tickie_variante depuis
 *  modele / taille et liste les écarts de nom et de prix entre Tickie et le CRM.
 * ============================================================
 */

var TICKIE_CFG = {
  FEUILLE_PRODUITS: '03_PRODUITS',
  LIGNE_ENTETE_PRODUITS: 1,
  FEUILLE_JOURNAL: 'TICKIE_ADDONS',
  FEUILLE_MAPPING: 'TICKIE_MAPPING',
  COLONNE_STOCK: 'stock_B1',          // stock dans lequel les add-ons sont retirés le jour de match
  DECREMENTER_STOCK: false,           // 21/10/2026 : le stock sort à la remise au stand (Retraits_Billets.gs) ; l'import CSV n'est plus nécessaire
  STATUT_VALIDE: 'RECEIVED',
  TOLERANCE: 0.01,
  CANDIDATS_COL_REF: ['ref_boutique', 'ref', 'reference', 'ref_produit', 'reference_produit', 'id_produit', 'sku', 'code'],
  CANDIDATS_COL_NOM: ['produit', 'nom', 'nom_produit', 'libelle', 'designation', 'article'],
  CANDIDATS_COL_MODELE: ['modele', 'model'],
  CANDIDATS_COL_TAILLE: ['taille', 'size'],
  CANDIDATS_COL_ACTIF: ['actif', 'active'],
  CANDIDATS_COL_PRIX: ['prix_vente', 'prix'],
  PREFIXE_COL_TICKIE_PRODUIT: 'tickiepro',   // colonne « tickie_produit » de 03_PRODUITS
  PREFIXE_COL_TICKIE_VARIANTE: 'tickievar'   // colonne « tickie_variante » de 03_PRODUITS
};

var TICKIE_JOURNAL_ENTETES = [
  'ID transaction', 'Date transaction', 'Événement', 'Date événement', 'Client', 'Email',
  'Produit Tickie', 'Réf produit', 'Quantité', 'Prix unitaire', 'Montant', 'Source',
  'Contrôle', 'Note', 'Stock décrémenté', 'Importé le'
];

var TICKIE_MAPPING_ENTETES = [
  'Libellé Tickie', 'Type (PRODUIT/BILLET)', 'Réf produit (03_PRODUITS)', 'Prix unitaire (€)', 'Actif (O/N)', 'Note'
];

var TICKIE_MAPPING_DEFAUT = [
  ['Echarpe', 'PRODUIT', '', 15, 'O', 'Prix constaté sur Narbonne (90 € / 6)'],
  ['Maillot Bleu Nuit', 'PRODUIT', '', 55, 'O', 'Prix constaté sur Narbonne (110 € / 2)'],
  ['Maillot Blanc', 'PRODUIT', '', 55, 'N', 'Prix à confirmer avant activation'],
  ['Maillot Bleu Ciel', 'PRODUIT', '', 55, 'N', 'Prix à confirmer avant activation'],
  ['Tarif Unique', 'BILLET', '', '', '', 'Billetterie : ignoré par la boutique']
];

var TICKIE_CLES_STANDARD = [
  'idtransaction', 'client', 'email', 'telephone', 'datetransaction', 'montanttotal',
  'revenuproduits', 'devise', 'statut', 'commentaires', 'bundles'
];

// ------------------------------------------------------------
//  Points d'entrée
// ------------------------------------------------------------

function ouvrirImportTickie() {
  var html = HtmlService.createHtmlOutput(tickieHtml_()).setWidth(480).setHeight(420);
  SpreadsheetApp.getUi().showModalDialog(html, 'Import des ventes add-on Tickie');
}

function tickieImporterTexte(texte) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var mapping = tickieLireMapping_(ss);
    var parse = tickieParserExport_(texte);
    if (!parse.entetes) {
      throw new Error('En-tête « ID Transaction » introuvable : est-ce bien l\'export « Analyse des ventes par produit » ?');
    }
    var analyse = tickieAnalyser_(parse, mapping);

    var journal = tickieFeuilleJournal_(ss);
    var dejaVus = tickieIdsJournal_(journal);
    var aEcrire = [];
    var nouvelles = 0;
    var doublons = 0;
    var maintenant = new Date();
    var dateEvt = tickieDate_(parse.meta.dateEvenement);

    analyse.transactions.forEach(function (t) {
      if (!t.lignes.length) return;
      if (dejaVus[t.id]) { doublons++; return; }
      nouvelles++;
      t.lignes.forEach(function (l) {
        aEcrire.push([
          t.id, t.date, parse.meta.evenement, dateEvt, t.client, t.email,
          l.produit, l.ref, l.quantite, l.prix, l.montant, l.source,
          l.controle, l.note, 'N', maintenant
        ]);
      });
    });

    if (aEcrire.length) {
      journal.getRange(journal.getLastRow() + 1, 1, aEcrire.length, TICKIE_JOURNAL_ENTETES.length).setValues(aEcrire);
    }

    var stock = TICKIE_CFG.DECREMENTER_STOCK ? tickieAppliquerStockInterne_(ss) : null;
    return tickieResume_(parse, analyse, nouvelles, doublons, stock);
  } finally {
    lock.releaseLock();
  }
}

function tickieAppliquerStock() {
  if (!TICKIE_CFG.DECREMENTER_STOCK) {
    SpreadsheetApp.getUi().alert('Stock add-ons Tickie', 'Plus nécessaire : les articles vendus en ligne sortent du stock à la remise au stand (scan du billet), et la vente remonte toute seule dans 01_VENTES.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var res = tickieAppliquerStockInterne_(SpreadsheetApp.getActiveSpreadsheet());
    var msg = 'Lignes décomptées du ' + TICKIE_CFG.COLONNE_STOCK + ' : ' + res.decomptes;
    if (res.aPreciser) msg += '\n\nTaille à préciser : ' + res.aPreciser + ' ligne(s) — choisir la réf dans la colonne « Réf produit » de ' + TICKIE_CFG.FEUILLE_JOURNAL + ', puis relancer.';
    if (res.stockNegatif.length) msg += '\n\n⚠ Stock négatif : ' + res.stockNegatif.join(', ');
    if (res.erreurs.length) msg += '\n\n⚠ Non décomptées :\n- ' + res.erreurs.join('\n- ');
    SpreadsheetApp.getUi().alert('Stock add-ons Tickie', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------
//  Lecture / analyse de l'export (fonctions pures)
// ------------------------------------------------------------

function tickieParserExport_(texte) {
  var lignes = String(texte || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  var meta = { evenement: '', dateEvenement: '', dateExport: '' };
  var entetes = null;
  var donnees = [];
  var finDonnees = false;

  for (var i = 0; i < lignes.length; i++) {
    var l = lignes[i];
    var brut = l.replace(/^\uFEFF/, '').trim();
    if (brut.charAt(0) === '#') {
      if (entetes) finDonnees = true;
      var p = brut.indexOf(':');
      if (p > 0) {
        var cle = tickieCle_(brut.slice(1, p));
        var val = brut.slice(p + 1).trim();
        if (cle === 'evenement') meta.evenement = val;
        else if (cle === 'datedevenement') meta.dateEvenement = val;
        else if (cle === 'datedexport') meta.dateExport = val;
      }
      continue;
    }
    if (!brut) { if (entetes) finDonnees = true; continue; }
    if (!entetes) { entetes = tickieCsvLigne_(l); continue; }
    if (finDonnees) continue;
    donnees.push(tickieCsvLigne_(l));
  }
  return { meta: meta, entetes: entetes, lignes: donnees };
}

function tickieAnalyser_(parse, mapping) {
  var H = parse.entetes;
  var idx = {};
  var colsProduits = [];
  var presentes = {};
  var anomalies = [];
  var mapParCle = {};
  mapping.forEach(function (m) { mapParCle[m.cle] = m; });

  H.forEach(function (h, j) {
    var c = tickieCle_(h);
    if (TICKIE_CLES_STANDARD.indexOf(c) >= 0) { if (!(c in idx)) idx[c] = j; return; }
    var m = mapParCle[c];
    if (m) {
      presentes[c] = true;
      if (m.type === 'PRODUIT') colsProduits.push({ j: j, m: m });
      return;
    }
    if (tickieColonneQuantite_(parse.lignes, j)) {
      anomalies.push('Colonne « ' + h + ' » absente de ' + TICKIE_CFG.FEUILLE_MAPPING + ' (produit ou billet ?) : ignorée.');
    }
  });

  ['idtransaction', 'statut', 'revenuproduits'].forEach(function (c) {
    if (!(c in idx)) throw new Error('Colonne obligatoire absente de l\'export : ' + c);
  });
  colsProduits.forEach(function (cp) {
    if (!(cp.m.prix > 0)) anomalies.push('Prix manquant pour « ' + cp.m.libelle + ' » dans ' + TICKIE_CFG.FEUILLE_MAPPING + ' : contrôle impossible.');
  });

  var manquants = mapping.filter(function (m) {
    return m.type === 'PRODUIT' && m.actif && !presentes[m.cle] && m.prix > 0;
  });

  var transactions = [];
  var totaux = {};
  var ignorees = 0;
  var aArbitrer = 0;

  parse.lignes.forEach(function (r) {
    var v = function (c) { return (c in idx) ? String(r[idx[c]] == null ? '' : r[idx[c]]).trim() : ''; };
    var id = v('idtransaction');
    if (!id) return;
    if (v('statut').toUpperCase() !== TICKIE_CFG.STATUT_VALIDE) { ignorees++; return; }

    var revenu = tickieMontant_(v('revenuproduits'));
    var lignes = [];
    var calc = 0;

    colsProduits.forEach(function (cp) {
      var q = parseInt(r[cp.j], 10) || 0;
      if (q <= 0) return;
      var pu = cp.m.prix > 0 ? cp.m.prix : 0;
      calc += q * pu;
      lignes.push({ produit: cp.m.libelle, ref: cp.m.ref, quantite: q, prix: pu, montant: tickieArrondi_(q * pu),
        source: 'EXPORT', controle: 'OK', note: '' });
    });

    var ecart = tickieArrondi_(revenu - calc);
    if (Math.abs(ecart) > TICKIE_CFG.TOLERANCE) {
      var cands = ecart > 0 ? manquants.filter(function (m) {
        var q = ecart / m.prix;
        return Math.round(q) >= 1 && Math.abs(q - Math.round(q)) < 1e-6;
      }) : [];
      if (cands.length === 1) {
        var m = cands[0];
        var qd = Math.round(ecart / m.prix);
        lignes.push({ produit: m.libelle, ref: m.ref, quantite: qd, prix: m.prix, montant: ecart,
          source: 'DÉDUIT', controle: 'OK',
          note: 'Colonne absente de l\'export : ' + qd + ' × ' + tickieEuros_(m.prix) + ' déduits de l\'écart' });
      } else {
        aArbitrer++;
        var noms = cands.map(function (c) { return c.libelle; }).join(' / ');
        lignes.push({ produit: '?', ref: '', quantite: '', prix: '', montant: ecart,
          source: 'ÉCART', controle: 'À ARBITRER',
          note: 'Revenu produits ' + tickieEuros_(revenu) + ' vs ' + tickieEuros_(calc) + ' calculés'
            + (noms ? ' — candidats : ' + noms : ' — aucun produit actif ne l\'explique')
            + '. Renseigner Produit + Quantité, passer Contrôle à OK, puis lancer tickieAppliquerStock.' });
      }
    }

    lignes.forEach(function (l) {
      if (l.controle !== 'OK') return;
      var t = totaux[l.produit] || (totaux[l.produit] = { q: 0, ca: 0, deduit: false });
      t.q += l.quantite;
      t.ca = tickieArrondi_(t.ca + l.montant);
      if (l.source === 'DÉDUIT') t.deduit = true;
    });

    transactions.push({ id: id, date: tickieDate_(v('datetransaction')), client: v('client'),
      email: v('email'), revenu: revenu, lignes: lignes });
  });

  return { transactions: transactions, totaux: totaux, ignorees: ignorees, aArbitrer: aArbitrer, anomalies: anomalies };
}

// ------------------------------------------------------------
//  Stock
// ------------------------------------------------------------

function tickieAppliquerStockInterne_(ss) {
  var res = { decomptes: 0, erreurs: [], stockNegatif: [], aPreciser: 0 };
  var journal = ss.getSheetByName(TICKIE_CFG.FEUILLE_JOURNAL);
  if (!journal || journal.getLastRow() < 2) return res;

  var ctx = tickieContexteProduits_(ss);
  if (ctx.cStock < 0) throw new Error('Colonne « ' + TICKIE_CFG.COLONNE_STOCK + ' » introuvable dans ' + TICKIE_CFG.FEUILLE_PRODUITS + '.');
  var pv = ctx.pv;

  var refsMapping = {};
  tickieLireMapping_(ss).forEach(function (m) { if (m.ref) refsMapping[m.cle] = m.ref; });

  var J = {};
  TICKIE_JOURNAL_ENTETES.forEach(function (h, i) { J[h] = i; });
  var n = journal.getLastRow() - 1;
  var jv = journal.getRange(2, 1, n, TICKIE_JOURNAL_ENTETES.length).getValues();
  var lignesModifiees = {};
  var validations = [];

  jv.forEach(function (row, k) {
    if (String(row[J['Stock décrémenté']]).toUpperCase() === 'O') return;
    if (String(row[J['Contrôle']]).toUpperCase().indexOf('OK') !== 0) return;
    var q = Number(row[J['Quantité']]);
    if (!(q > 0)) return;

    var produit = String(row[J['Produit Tickie']]).trim();
    var ref = String(row[J['Réf produit']]).trim() || refsMapping[tickieCle_(produit)] || '';
    var r = tickieChercherProduit_(ctx, ref, produit);

    if (r.i < 0) {
      if (r.candidats.length) {
        var refs = ctx.cRef >= 0
          ? r.candidats.map(function (x) { return String(pv[x][ctx.cRef]).trim(); }).filter(String)
          : [];
        row[J['Note']] = tickieNoteStock_(row[J['Note']], 'Taille à préciser : choisir la réf dans la liste ('
          + r.candidats.length + ' tailles) puis « Appliquer le stock »');
        if (refs.length) validations.push({ ligne: k + 2, refs: refs });
        res.aPreciser++;
      } else {
        row[J['Note']] = tickieNoteStock_(row[J['Note']], r.refInconnue
          ? 'Réf « ' + ref + ' » absente de ' + TICKIE_CFG.FEUILLE_PRODUITS
          : 'Dénomination « ' + produit + ' » absente de ' + TICKIE_CFG.FEUILLE_PRODUITS
            + ' (tickie_produit / modele / produit) : lancer tickieControlerDenominations');
        res.erreurs.push(produit + ' — transaction ' + row[J['ID transaction']]);
      }
      return;
    }

    var i = r.i;
    var avant = Number(pv[i][ctx.cStock]) || 0;
    pv[i][ctx.cStock] = avant - q;
    lignesModifiees[i] = true;
    if (avant - q < 0 && res.stockNegatif.indexOf(produit) < 0) res.stockNegatif.push(produit);
    var refLigne = ctx.cRef >= 0 ? String(pv[i][ctx.cRef]).trim() : '';
    // Journal des mouvements de stock (Stock_Boutique.gs), comme la synchro tablette.
    if (typeof sb_mouvement_ === 'function') {
      try {
        var cout = ctx.cCout >= 0 ? (Number(pv[i][ctx.cCout]) || 0) : 0;
        sb_mouvement_({
          type: 'VENTE_TICKIE', ref_boutique: refLigne,
          produit: ctx.cNom >= 0 ? String(pv[i][ctx.cNom]) : produit,
          point: TICKIE_CFG.COLONNE_STOCK.replace(/^stock_/i, ''), quantite: -q,
          cout_unitaire: cout, valeur: -q * cout,
          match: String(row[J['Événement']] || ''), reference: String(row[J['ID transaction']] || ''),
          commentaire: 'add-on Tickie'
        });
      } catch (eMvt) { /* le journal ne doit jamais bloquer le décompte */ }
    }
    row[J['Réf produit']] = refLigne || ref;
    row[J['Note']] = tickieNoteStock_(row[J['Note']], '');
    row[J['Stock décrémenté']] = 'O';
    res.decomptes++;
  });

  // Écriture cellule par cellule : préserve d'éventuelles formules ailleurs dans la colonne stock.
  Object.keys(lignesModifiees).forEach(function (key) {
    var i = Number(key);
    ctx.sh.getRange(i + 1, ctx.cStock + 1).setValue(pv[i][ctx.cStock]);
  });

  var cJ = J['Réf produit'];
  journal.getRange(2, cJ + 1, n, 1).setValues(jv.map(function (r) { return [r[cJ]]; }));
  var cN = J['Note'];
  journal.getRange(2, cN + 1, n, 2).setValues(jv.map(function (r) { return [r[cN], r[cN + 1]]; }));

  validations.forEach(function (v) {
    var regle = SpreadsheetApp.newDataValidation().requireValueInList(v.refs, true).setAllowInvalid(true).build();
    journal.getRange(v.ligne, cJ + 1).setDataValidation(regle).setBackground('#fff2cc');
  });
  return res;
}

function tickieContexteProduits_(ss) {
  var sh = ss.getSheetByName(TICKIE_CFG.FEUILLE_PRODUITS);
  if (!sh) throw new Error('Feuille ' + TICKIE_CFG.FEUILLE_PRODUITS + ' introuvable.');
  var pv = sh.getDataRange().getValues();
  var L = TICKIE_CFG.LIGNE_ENTETE_PRODUITS - 1;
  var ph = pv[L].map(tickieCle_);
  return {
    sh: sh, pv: pv, L: L,
    cStock: ph.indexOf(tickieCle_(TICKIE_CFG.COLONNE_STOCK)),
    cRef: tickieTrouverCol_(ph, TICKIE_CFG.CANDIDATS_COL_REF),
    cNom: tickieTrouverCol_(ph, TICKIE_CFG.CANDIDATS_COL_NOM),
    cModele: tickieTrouverCol_(ph, TICKIE_CFG.CANDIDATS_COL_MODELE),
    cTaille: tickieTrouverCol_(ph, TICKIE_CFG.CANDIDATS_COL_TAILLE),
    cActif: tickieTrouverCol_(ph, TICKIE_CFG.CANDIDATS_COL_ACTIF),
    cPrix: tickieTrouverCol_(ph, TICKIE_CFG.CANDIDATS_COL_PRIX),
    cCout: tickieTrouverCol_(ph, ['cout']),
    cTickieProduit: tickieColPrefixe_(ph, TICKIE_CFG.PREFIXE_COL_TICKIE_PRODUIT),
    cTickieVariante: tickieColPrefixe_(ph, TICKIE_CFG.PREFIXE_COL_TICKIE_VARIANTE)
  };
}

/**
 * Relie un libellé Tickie à 03_PRODUITS. Correspondance exacte (sans accents ni casse) uniquement.
 * Retour : { i: ligne trouvée ou -1, candidats: [lignes] si plusieurs (tailles), col: colonne ayant matché }
 */
function tickieChercherProduit_(ctx, ref, produit) {
  var pv = ctx.pv;
  var i;
  if (ref && ctx.cRef >= 0) {
    for (i = ctx.L + 1; i < pv.length; i++) {
      if (String(pv[i][ctx.cRef]).trim() === ref) return { i: i, candidats: [], col: ctx.cRef };
    }
    return { i: -1, candidats: [], col: -1, refInconnue: true };
  }
  var k = tickieCle_(produit);
  if (!k || produit === '?') return { i: -1, candidats: [], col: -1 };
  var cols = [ctx.cTickieProduit, ctx.cModele, ctx.cNom];
  for (var c = 0; c < cols.length; c++) {
    var col = cols[c];
    if (col < 0) continue;
    var lignes = [];
    for (i = ctx.L + 1; i < pv.length; i++) if (tickieCle_(pv[i][col]) === k) lignes.push(i);
    if (!lignes.length) continue;
    if (ctx.cActif >= 0) {
      var actives = lignes.filter(function (x) { return tickieEstActif_(pv[x][ctx.cActif]); });
      if (actives.length) lignes = actives;
    }
    if (lignes.length === 1) return { i: lignes[0], candidats: [], col: col };
    return { i: -1, candidats: lignes, col: col };
  }
  return { i: -1, candidats: [], col: -1 };
}

function tickieNoteStock_(note, msg) {
  var parts = String(note || '').split(' | ').filter(function (p) {
    p = p.trim();
    return p && p.indexOf('[Stock] ') !== 0 && p.indexOf('Produit introuvable') !== 0;
  });
  if (msg) parts.push('[Stock] ' + msg);
  return parts.join(' | ');
}

// ------------------------------------------------------------
//  Dénominations Tickie <-> CRM
// ------------------------------------------------------------

function tickieControlerDenominations() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var ctx = tickieContexteProduits_(ss);
  var pv = ctx.pv;
  var out = [];

  // 1. Remplir tickie_produit / tickie_variante depuis modele / taille (cellules vides, produits actifs).
  var remplis = 0;
  if (ctx.cTickieProduit >= 0) {
    for (var i = ctx.L + 1; i < pv.length; i++) {
      if (ctx.cActif >= 0 && !tickieEstActif_(pv[i][ctx.cActif])) continue;
      var base = ctx.cModele >= 0 && String(pv[i][ctx.cModele]).trim() ? pv[i][ctx.cModele] : (ctx.cNom >= 0 ? pv[i][ctx.cNom] : '');
      if (!String(base).trim()) continue;
      if (!String(pv[i][ctx.cTickieProduit]).trim()) {
        pv[i][ctx.cTickieProduit] = String(base).trim();
        ctx.sh.getRange(i + 1, ctx.cTickieProduit + 1).setValue(pv[i][ctx.cTickieProduit]);
        remplis++;
      }
      if (ctx.cTickieVariante >= 0 && ctx.cTaille >= 0 && !String(pv[i][ctx.cTickieVariante]).trim()) {
        var t = String(pv[i][ctx.cTaille]).trim();
        if (t && tickieCle_(t) !== 'tu') {
          pv[i][ctx.cTickieVariante] = t;
          ctx.sh.getRange(i + 1, ctx.cTickieVariante + 1).setValue(t);
        }
      }
    }
    out.push('Colonne tickie_produit complétée : ' + remplis + ' ligne(s).');
  } else {
    out.push('⚠ Colonne tickie_produit introuvable dans ' + TICKIE_CFG.FEUILLE_PRODUITS + ' : rapprochement par modele / produit.');
  }
  out.push('');

  // 2. Comparer chaque libellé Tickie au CRM.
  var mapping = tickieLireMapping_(ss).filter(function (m) { return m.type === 'PRODUIT'; });
  var clesTickie = {};
  mapping.forEach(function (m) {
    clesTickie[m.cle] = true;
    var r = tickieChercherProduit_(ctx, m.ref, m.libelle);
    var idx = r.i >= 0 ? [r.i] : r.candidats;
    var etat = m.actif ? '' : ' (inactif)';
    if (!idx.length) {
      out.push('✗ « ' + m.libelle + ' »' + etat + ' : aucun produit correspondant dans le CRM');
      return;
    }
    var nomCRM = String(pv[idx[0]][r.col]).trim();
    var ligne = (nomCRM === m.libelle ? '✓ « ' : '≈ « ') + m.libelle + ' »' + etat;
    if (nomCRM !== m.libelle) ligne += ' ↔ CRM « ' + nomCRM + ' » : orthographe à harmoniser';
    if (idx.length > 1) ligne += ' — ' + idx.length + ' tailles, taille non transmise par Tickie';
    if (ctx.cPrix >= 0 && m.prix > 0) {
      var prixCRM = tickieMontant_(pv[idx[0]][ctx.cPrix]);
      if (Math.abs(prixCRM - m.prix) > TICKIE_CFG.TOLERANCE) {
        ligne += '\n     ⚠ prix Tickie ' + tickieEuros_(m.prix) + ' ≠ prix_vente CRM ' + tickieEuros_(prixCRM);
      }
    }
    out.push(ligne);
  });

  // 3. Produits actifs du CRM sans libellé Tickie.
  var absents = {};
  for (var j = ctx.L + 1; j < pv.length; j++) {
    if (ctx.cActif >= 0 && !tickieEstActif_(pv[j][ctx.cActif])) continue;
    var nom = ctx.cTickieProduit >= 0 && String(pv[j][ctx.cTickieProduit]).trim() ? pv[j][ctx.cTickieProduit]
      : (ctx.cModele >= 0 && String(pv[j][ctx.cModele]).trim() ? pv[j][ctx.cModele] : (ctx.cNom >= 0 ? pv[j][ctx.cNom] : ''));
    nom = String(nom).trim();
    if (nom && !clesTickie[tickieCle_(nom)]) absents[nom] = true;
  }
  var listeAbsents = Object.keys(absents);
  if (listeAbsents.length) {
    out.push('');
    out.push('Produits actifs du CRM absents de ' + TICKIE_CFG.FEUILLE_MAPPING + ' : ' + listeAbsents.join(', '));
  }

  ui.alert('Dénominations Tickie ↔ CRM', out.join('\n'), ui.ButtonSet.OK);
}

function tickieColPrefixe_(entetesCles, prefixe) {
  for (var i = 0; i < entetesCles.length; i++) if (entetesCles[i].indexOf(prefixe) === 0) return i;
  return -1;
}

function tickieEstActif_(v) {
  return v === true || /^(true|vrai|o|oui|1)$/i.test(String(v).trim());
}

// ------------------------------------------------------------
//  Feuilles
// ------------------------------------------------------------

function tickieLireMapping_(ss) {
  var sh = ss.getSheetByName(TICKIE_CFG.FEUILLE_MAPPING);
  if (!sh) {
    sh = ss.insertSheet(TICKIE_CFG.FEUILLE_MAPPING);
    sh.getRange(1, 1, 1, TICKIE_MAPPING_ENTETES.length).setValues([TICKIE_MAPPING_ENTETES]);
    sh.getRange(2, 1, TICKIE_MAPPING_DEFAUT.length, TICKIE_MAPPING_ENTETES.length).setValues(TICKIE_MAPPING_DEFAUT);
    tickieStyleEntete_(sh, TICKIE_MAPPING_ENTETES.length);
  }
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, TICKIE_MAPPING_ENTETES.length).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      return {
        libelle: String(r[0]).trim(),
        cle: tickieCle_(r[0]),
        type: String(r[1]).trim().toUpperCase() || 'PRODUIT',
        ref: String(r[2]).trim(),
        prix: typeof r[3] === 'number' ? r[3] : tickieMontant_(r[3]),
        actif: /^o/i.test(String(r[4]).trim())
      };
    });
}

function tickieFeuilleJournal_(ss) {
  var sh = ss.getSheetByName(TICKIE_CFG.FEUILLE_JOURNAL);
  if (!sh) {
    sh = ss.insertSheet(TICKIE_CFG.FEUILLE_JOURNAL);
    sh.getRange(1, 1, 1, TICKIE_JOURNAL_ENTETES.length).setValues([TICKIE_JOURNAL_ENTETES]);
    tickieStyleEntete_(sh, TICKIE_JOURNAL_ENTETES.length);
    sh.getRange('B:B').setNumberFormat('dd/MM/yyyy');
    sh.getRange('D:D').setNumberFormat('dd/MM/yyyy');
    sh.getRange('J:K').setNumberFormat('#,##0.00 €');
    sh.getRange('P:P').setNumberFormat('dd/MM/yyyy HH:mm');
  }
  return sh;
}

function tickieIdsJournal_(sh) {
  var vus = {};
  if (sh.getLastRow() < 2) return vus;
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
    var id = String(r[0]).trim();
    if (id) vus[id] = true;
  });
  return vus;
}

function tickieStyleEntete_(sh, nbCol) {
  sh.getRange(1, 1, 1, nbCol).setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, nbCol);
}

// ------------------------------------------------------------
//  Résumé
// ------------------------------------------------------------

function tickieResume_(parse, analyse, nouvelles, doublons, stock) {
  var out = [];
  out.push((parse.meta.evenement || 'Événement inconnu') + (parse.meta.dateEvenement ? ' (' + parse.meta.dateEvenement + ')' : ''));
  var avecProduits = analyse.transactions.filter(function (t) { return t.lignes.length; }).length;
  out.push('Transactions avec produits : ' + avecProduits + ' — nouvelles : ' + nouvelles + ', déjà importées : ' + doublons
    + (analyse.ignorees ? ', statut non reçu : ' + analyse.ignorees : ''));
  out.push('');
  out.push('Ventes add-on contrôlées (export complet) :');
  var tq = 0;
  var tca = 0;
  Object.keys(analyse.totaux).forEach(function (p) {
    var t = analyse.totaux[p];
    tq += t.q;
    tca = tickieArrondi_(tca + t.ca);
    out.push(' • ' + p + ' : ' + t.q + ' → ' + tickieEuros_(t.ca) + (t.deduit ? '  (dont quantités déduites)' : ''));
  });
  out.push(' = ' + tq + ' articles, ' + tickieEuros_(tca));
  out.push('');
  out.push('À arbitrer : ' + analyse.aArbitrer + (analyse.aArbitrer ? '  → voir ' + TICKIE_CFG.FEUILLE_JOURNAL : ''));
  if (stock) {
    out.push('Lignes décomptées du ' + TICKIE_CFG.COLONNE_STOCK + ' : ' + stock.decomptes);
    if (stock.aPreciser) out.push('Taille à préciser : ' + stock.aPreciser + ' ligne(s) → choisir la réf dans ' + TICKIE_CFG.FEUILLE_JOURNAL + ' puis « Appliquer le stock »');
    if (stock.stockNegatif.length) out.push('⚠ Stock négatif : ' + stock.stockNegatif.join(', '));
    if (stock.erreurs.length) out.push('⚠ Non décomptées : ' + stock.erreurs.join(' ; '));
  } else {
    out.push('Stock non modifié (DECREMENTER_STOCK = false).');
  }
  if (analyse.anomalies.length) {
    out.push('');
    out.push('Alertes :');
    analyse.anomalies.forEach(function (a) { out.push(' ⚠ ' + a); });
  }
  return out.join('\n');
}

// ------------------------------------------------------------
//  Utilitaires
// ------------------------------------------------------------

function tickieCsvLigne_(ligne) {
  var res = [];
  var cur = '';
  var guill = false;
  for (var i = 0; i < ligne.length; i++) {
    var ch = ligne.charAt(i);
    if (guill) {
      if (ch === '"') {
        if (ligne.charAt(i + 1) === '"') { cur += '"'; i++; } else { guill = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      guill = true;
    } else if (ch === ',') {
      res.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  res.push(cur);
  return res.map(function (c) { return c.replace(/^\uFEFF/, ''); });
}

function tickieColonneQuantite_(lignes, j) {
  var remplies = 0;
  for (var i = 0; i < lignes.length; i++) {
    var v = String(lignes[i][j] == null ? '' : lignes[i][j]).trim();
    if (!v) continue;
    if (!/^\d+$/.test(v)) return false;
    remplies++;
  }
  return remplies > 0;
}

function tickieNorm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function tickieCle_(s) {
  return tickieNorm_(s).replace(/[^a-z0-9]/g, '');
}

function tickieTrouverCol_(entetesCles, candidats) {
  for (var i = 0; i < candidats.length; i++) {
    var p = entetesCles.indexOf(tickieCle_(candidats[i]));
    if (p >= 0) return p;
  }
  return -1;
}

function tickieMontant_(s) {
  if (typeof s === 'number') return s;
  var t = String(s == null ? '' : s).replace(/[^\d,.\-]/g, '').replace(',', '.');
  var n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}

function tickieArrondi_(n) {
  return Math.round(n * 100) / 100;
}

function tickieEuros_(n) {
  return Number(n).toFixed(2).replace('.', ',') + ' €';
}

function tickieDate_(s) {
  var m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  // Midi : la date reste la bonne quel que soit l'écart de fuseau entre le script et le classeur.
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12) : String(s || '');
}

function tickieJoindre_(a, b) {
  a = String(a || '').trim();
  return a ? a + ' | ' + b : b;
}

function tickieHtml_() {
  return [
    '<div style="font-family:Arial,sans-serif;font-size:13px;color:#0b1f3a">',
    '<p>Dans Tickie : <b>Marketplace › Gestion des produits › l’événement › Exporter</b>, puis choisis le CSV :</p>',
    '<input type="file" id="f" accept=".csv,text/csv">',
    '<p><button id="b" onclick="go()" style="background:#0b1f3a;color:#fff;border:0;padding:8px 16px;border-radius:4px;cursor:pointer">Importer</button></p>',
    '<pre id="r" style="white-space:pre-wrap;background:#f4f4f4;padding:8px;max-height:240px;overflow:auto"></pre>',
    '<script>',
    'function go(){',
    ' var f=document.getElementById("f").files[0],r=document.getElementById("r"),b=document.getElementById("b");',
    ' if(!f){r.textContent="Choisis d’abord le fichier CSV.";return;}',
    ' b.disabled=true;r.textContent="Import en cours…";',
    ' var fr=new FileReader();',
    ' fr.onload=function(){',
    '  google.script.run',
    '   .withSuccessHandler(function(t){r.textContent=t;b.disabled=false;})',
    '   .withFailureHandler(function(e){r.textContent="Erreur : "+e.message;b.disabled=false;})',
    '   .tickieImporterTexte(fr.result);',
    ' };',
    ' fr.readAsText(f,"UTF-8");',
    '}',
    '</script>',
    '</div>'
  ].join('\n');
}