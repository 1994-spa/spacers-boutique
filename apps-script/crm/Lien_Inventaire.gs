/**
 * ============================================================================
 *  SPACERS — Lien CRM Boutique  ->  Sheet « Inventaire 2026 2027 »
 * ============================================================================
 *  À coller comme NOUVEAU fichier (Lien_Inventaire.gs) dans le projet Apps Script
 *  du classeur SPACERS_BOUTIQUE_CRM_V2. Aucun doGet/doPost : les tablettes ne
 *  sont pas impactées, aucun redéploiement nécessaire.
 *
 *  Ce que fait le script (toutes les 15 min + à la demande) :
 *   1. Onglet « 🔄 STOCK LIVE »     : stock par article/taille — Dépôt (R),
 *      Boutique GP (B1), Boutique VIP (B2), Total, alerte seuil.
 *      + colonne « Compté (saisie) » libre pour Élise : conservée d'une MAJ à
 *      l'autre, avec l'écart calculé automatiquement.
 *   2. Onglet « 🔄 VENTES LIVE »    : dernières ventes (tablettes + Tickie + web).
 *   3. Onglet « 🔄 MOUVEMENTS LIVE »: transferts, dotations, casse, réceptions.
 *   4. Onglet « 🔄 VENTES PAR ARTICLE » : résumé de la saison article par article (lieux, offerts, CA, matchs).
 *  Les onglets existants d'Élise (Stock Total, En boutique, Dépot, Journal
 *  ventes…) ne sont JAMAIS modifiés (ils sont archivés par archiverAnciensTableaux).
 *  Fonction utilitaire renommée li_feuille_ : feuille_ existe aussi dans
 *  Organisation_Classeur.gs (même projet) et l'une écrasait l'autre.
 *
 *  Installation : exécuter une fois  installerLienInventaire()  depuis l'éditeur.
 * ============================================================================
 */

const LI = {
  CRM_ID: '1mE9gSCtetFgnWEt0kA6cS2lcgJDe7oPRLDiXdGhH2EQ',      // SPACERS_BOUTIQUE_CRM_V2
  INV_ID: '1b33hMr4zkgKcwByCRNKket3LpRClclxTssxs25M6xY8',      // Inventaire 2026 2027 (Élise)
  TAB_STOCK: '🔄 STOCK LIVE',
  TAB_VENTES: '🔄 VENTES LIVE',
  TAB_MVT: '🔄 MOUVEMENTS LIVE',
  TAB_RESUME: '🔄 VENTES PAR ARTICLE',
  NB_VENTES: 300,
  NB_MVT: 300,
  FREQ_MIN: 15,
  BLEU_NUIT: '#0B1B3F',
  BLEU_CIEL: '#DCEBFA',
  ORDRE_TAILLES: ['6y','6 ans','8y','8 ans','10y','10 ans','12y','12 ans','14y','14 ans',
                  '116','128','140','152','164',
                  'xs','s','m','l','xl','xxl','2xl','3xl','tu','//','']
};

/* ---------------------------------------------------------------- PUBLIC -- */

/** À lancer UNE fois : crée le déclencheur 15 min et fait une première MAJ. */
function installerLienInventaire() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'majInventaireElise')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('majInventaireElise').timeBased().everyMinutes(LI.FREQ_MIN).create();
  majInventaireElise();
  Logger.log('Lien inventaire installé : MAJ toutes les ' + LI.FREQ_MIN + ' min.');
}

/** Retire le déclencheur (les onglets restent en place). */
function desinstallerLienInventaire() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'majInventaireElise')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/** Mise à jour complète (appelée par le déclencheur, ou à la main après une synchro). */
function majInventaireElise() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const crm = SpreadsheetApp.openById(LI.CRM_ID);
    const inv = SpreadsheetApp.openById(LI.INV_ID);
    const maj = Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm');

    ecrireStock_(crm, inv, maj);
    ecrireVentes_(crm, inv, maj);
    ecrireMouvements_(crm, inv, maj);
    ecrireResume_(crm, inv, maj);
  } catch (e) {
    try { journal_(SpreadsheetApp.openById(LI.CRM_ID), 'ERREUR', String(e && e.stack || e)); } catch (_) {}
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/* ----------------------------------------------------------------- STOCK -- */

function ecrireStock_(crm, inv, maj) {
  const t = lireTable_(crm, '03_PRODUITS');
  if (!t) throw new Error('Onglet 03_PRODUITS introuvable');
  const c = {
    produit: col_(t.h, ['produit']),
    cat:     col_(t.h, ['categorie']),
    actif:   col_(t.h, ['actif']),
    ref:     col_(t.h, ['ref_boutique', 'ref_bo']),
    modele:  col_(t.h, ['modele']),
    taille:  col_(t.h, ['taille']),
    seuil:   col_(t.h, ['seuil_alerte', 'seuil']),
    r:       col_(t.h, ['stock_r']),
    b1:      col_(t.h, ['stock_b1']),
    b2:      col_(t.h, ['stock_b2'])
  };

  // Comptages saisis par Élise (conservés par référence)
  const sh = li_feuille_(inv, LI.TAB_STOCK);
  const comptes = {};
  if (sh.getLastRow() > 4) {
    sh.getRange(5, 1, sh.getLastRow() - 4, 10).getValues().forEach(r => {
      if (r[0] && r[8] !== '' && r[8] !== null) comptes[String(r[0])] = r[8];
    });
  }

  const lignes = [];
  t.rows.forEach(r => {
    const R = num_(r[c.r]), B1 = num_(r[c.b1]), B2 = num_(r[c.b2]);
    const actif = c.actif < 0 ? true : vrai_(r[c.actif]);
    if (!actif && R + B1 + B2 === 0) return;           // anciens produits vides : masqués
    const produit = String(r[c.produit] || '').trim();
    if (!produit) return;
    const ref = c.ref >= 0 && r[c.ref] ? String(r[c.ref]).trim() : produit;
    const modele = c.modele >= 0 && r[c.modele] ? String(r[c.modele]).trim() : produit;
    const taille = c.taille >= 0 ? libTaille_(r[c.taille]) : '';
    const seuil = c.seuil >= 0 ? num_(r[c.seuil]) : 0;
    const total = R + B1 + B2;
    lignes.push({
      ref, modele, taille, cat: c.cat >= 0 ? String(r[c.cat] || '') : '',
      R, B1, B2, total, seuil,
      alerte: !actif ? 'Inactif' : (total === 0 ? 'RUPTURE' : (seuil && total <= seuil ? 'Seuil bas' : ''))
    });
  });

  lignes.sort((a, b) =>
    ((a.alerte === 'Inactif') - (b.alerte === 'Inactif')) || a.cat.localeCompare(b.cat) || a.modele.localeCompare(b.modele) || rangTaille_(a.taille) - rangTaille_(b.taille));

  // Écriture
  sh.clear(); sh.clearConditionalFormatRules();
  sh.getRange('A1').setValue('STOCK LIVE — CRM Boutique (mis à jour automatiquement)')
    .setFontSize(14).setFontWeight('bold').setFontColor(LI.BLEU_NUIT);
  sh.getRange('A2').setValue('Dernière MAJ : ' + maj + '  •  Ne pas modifier sauf la colonne « Compté (saisie) ». '
    + 'Règle : tout article et tout stock passent par le CRM (page Gestion ou caisse) ; ce classeur n\'en est qu\'une copie.')
    .setFontColor('#555555').setFontStyle('italic');

  const ent = ['Réf.', 'Article', 'Taille', 'Dépôt', 'Boutique GP', 'Boutique VIP', 'TOTAL', 'Alerte',
               'Compté (saisie)', 'Écart (à la MAJ)'];
  sh.getRange(4, 1, 1, ent.length).setValues([ent])
    .setBackground(LI.BLEU_NUIT).setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');

  if (lignes.length) {
    // Écart calculé par le script (pas de formule : #ERROR! dans ce classeur selon ses paramètres régionaux)
    const vals = lignes.map(l => {
      const cpt = comptes[l.ref] !== undefined ? comptes[l.ref] : '';
      const ecart = cpt === '' ? '' : num_(cpt) - l.total;
      return [l.ref, l.modele, l.taille || 'TU', l.R, l.B1, l.B2, l.total, l.alerte, cpt, ecart];
    });
    const n = vals.length;
    sh.getRange(5, 3, n, 1).setNumberFormat('@');                       // tailles en texte
    sh.getRange(5, 1, n, ent.length).setValues(vals).setFontColor('#000000');
    sh.getRange(5, 3, n, 1).setHorizontalAlignment('center');
    sh.getRange(5, 4, n, 4).setHorizontalAlignment('center');
    sh.getRange(5, 9, n, 2).setHorizontalAlignment('center');
    sh.getRange(5, 7, n, 1).setFontWeight('bold');
    sh.getRange(5, 9, n, 1).setBackground('#FFF8DC');                    // zone saisie
    // Bandes par modèle
    let bande = false, prec = null;
    for (let i = 0; i < n; i++) {
      if (lignes[i].modele !== prec) { bande = !bande; prec = lignes[i].modele; }
      if (bande) sh.getRange(5 + i, 1, 1, 8).setBackground(LI.BLEU_CIEL);
    }
    // Totaux
    const lt = 5 + n;
    sh.getRange(lt, 2).setValue('TOTAL').setFontWeight('bold');
    const tot = [lignes.reduce((x, l) => x + l.R, 0), lignes.reduce((x, l) => x + l.B1, 0),
                 lignes.reduce((x, l) => x + l.B2, 0), lignes.reduce((x, l) => x + l.total, 0)];
    sh.getRange(lt, 4, 1, 4).setValues([tot]).setFontWeight('bold').setHorizontalAlignment('center');
    sh.getRange(lt, 1, 1, ent.length).setBorder(true, null, null, null, null, null);

    // Couleurs d'alerte
    const rgA = sh.getRange(5, 8, n, 1), rgE = sh.getRange(5, 10, n, 1);
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('RUPTURE')
        .setBackground('#F8D7DA').setFontColor('#A30000').setBold(true).setRanges([rgA]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Seuil bas')
        .setBackground('#FFE8CC').setFontColor('#9A5200').setBold(true).setRanges([rgA]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenNumberNotEqualTo(0)
        .setBackground('#F8D7DA').setFontColor('#A30000').setRanges([rgE]).build()
    ]);
  }

  sh.setFrozenRows(4);
  sh.setColumnWidths(1, 1, 110); sh.setColumnWidth(2, 220); sh.setColumnWidths(3, 8, 105);
  proteger_(sh, 'I5:I');
}

/* ---------------------------------------------------------------- VENTES -- */

function ecrireVentes_(crm, inv, maj) {
  const t = lireTable_(crm, '01_VENTES');
  if (!t) return;
  const c = {
    date: col_(t.h, ['date']), source: col_(t.h, ['source']), produit: col_(t.h, ['produit']),
    qte: col_(t.h, ['quantite']), pu: col_(t.h, ['prix_u']), ca: col_(t.h, ['ca']),
    match: col_(t.h, ['match']), boutique: col_(t.h, ['boutique']), mode: col_(t.h, ['mode_p']),
    idv: col_(t.h, ['id vente']), cmd: col_(t.h, ['commande'])
  };

  // Cases déjà cochées par Élise (conservées par clé de vente)
  const sh = li_feuille_(inv, LI.TAB_VENTES);
  const NB_COL = 11;                                   // A = case, B..J = données, K = clé (masquée)
  const coches = {}, notes = {};
  if (sh.getLastRow() > 4 && sh.getLastColumn() >= NB_COL) {
    sh.getRange(5, 1, sh.getLastRow() - 4, NB_COL + 1).getValues().forEach(r => {
      const cle = String(r[NB_COL - 1] || '');
      if (!cle) return;
      if (r[0] === true) coches[cle] = true;
      if (r[NB_COL]) notes[cle] = r[NB_COL];
    });
  }

  const vus = {};
  const lignes = t.rows.filter(r => r[c.produit]).map(r => {
    const d = dateObj_(r[c.date]);
    let cle = [v_(r, c.idv) || v_(r, c.cmd), v_(r, c.produit), num_(r[c.qte]),
               d instanceof Date ? d.getTime() : String(d)].join('|');
    vus[cle] = (vus[cle] || 0) + 1;                    // doublons stricts : clé suffixée
    if (vus[cle] > 1) cle += '#' + vus[cle];
    return { d, cle, r };
  })
  .sort((a, b) => (b.d || 0) - (a.d || 0))
  .slice(0, LI.NB_VENTES);

  sh.clear(); sh.clearConditionalFormatRules();
  sh.getRange(1, 1, sh.getMaxRows(), 1).clearDataValidations();
  sh.getRange('A1').setValue('VENTES LIVE — ' + LI.NB_VENTES + ' dernières ventes (tablettes, Tickie, web)')
    .setFontSize(14).setFontWeight('bold').setFontColor(LI.BLEU_NUIT);
  sh.getRange('A2').setValue('Dernière MAJ : ' + maj + '  •  Cochez la colonne A une fois la vente contrôlée / sortie du stock physique. '
    + 'Les cases et la colonne Remarque sont conservées à chaque mise à jour.')
    .setFontColor('#555555').setFontStyle('italic');

  const ent = ['✔ Pointé', 'Date', 'Source', 'Article', 'Qté', 'PU TTC', 'Montant TTC', 'Boutique', 'Paiement', 'Match', 'clé', 'Remarque'];
  sh.getRange(4, 1, 1, ent.length).setValues([ent])
    .setBackground(LI.BLEU_NUIT).setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');

  if (lignes.length) {
    const n = lignes.length;
    const vals = lignes.map(l => [
      coches[l.cle] === true,
      l.d, v_(l.r, c.source), v_(l.r, c.produit), num_(l.r[c.qte]), num_(l.r[c.pu]), num_(l.r[c.ca]),
      libBoutique_(v_(l.r, c.boutique), v_(l.r, c.source)), v_(l.r, c.mode), v_(l.r, c.match),
      l.cle, notes[l.cle] || ''
    ]);
    sh.getRange(5, 1, n, ent.length).setValues(vals);
    sh.getRange(5, 1, n, 1).insertCheckboxes().setHorizontalAlignment('center');
    sh.getRange(5, 2, n, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange(5, 6, n, 2).setNumberFormat('#,##0.00 €');
    sh.getRange(5, 5, n, 1).setHorizontalAlignment('center');
    sh.getRange(5, 12, n, 1).setBackground('#FFF8DC');
    // Ligne entière en vert quand cochée
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$A5=TRUE')
        .setBackground('#D4EDDA').setRanges([sh.getRange(5, 1, n, ent.length)]).build()
    ]);
    // Compteur
    const nbPointees = vals.filter(v => v[0] === true).length;
    sh.getRange('H2').setValue('Pointées : ' + nbPointees + ' / ' + n + ' (à la MAJ)')
      .setFontWeight('bold').setFontColor(LI.BLEU_NUIT);
  } else {
    sh.getRange(5, 2).setValue('Aucune vente pour le moment.');
  }

  sh.setFrozenRows(4);
  sh.autoResizeColumns(2, 9);
  sh.setColumnWidth(1, 80); sh.setColumnWidth(12, 220);
  sh.hideColumns(11);
  proteger_(sh, null, ['A5:A', 'L5:L']);
}

/* ---------------------------------------------------- VENTES PAR ARTICLE -- */

/**
 * Onglet « 🔄 VENTES PAR ARTICLE » : résumé de la saison en cours (juillet → juin), une ligne par
 * article et taille : quantités par lieu de vente, offerts, CA TTC, puis une colonne par match.
 * Les « Offert » sont comptés en quantité mais exclus du CA. Lecture seule, recalculé à chaque MAJ.
 */
function ecrireResume_(crm, inv, maj) {
  const t = lireTable_(crm, '01_VENTES');
  if (!t) return;
  const c = {
    date: col_(t.h, ['date']), source: col_(t.h, ['source']), produit: col_(t.h, ['produit']),
    qte: col_(t.h, ['quantite']), ca: col_(t.h, ['ca']), match: col_(t.h, ['match']),
    boutique: col_(t.h, ['boutique']), mode: col_(t.h, ['mode_p']), saison: col_(t.h, ['saison'])
  };
  const now = new Date();
  const debut = new Date(now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1, 6, 1);
  const art = {}, matchs = {};
  t.rows.forEach(r => {
    const produit = String(v_(r, c.produit)).trim();
    if (!produit) return;
    const d = dateObj_(r[c.date]);
    if (d instanceof Date && d < debut) return;
    const q = num_(r[c.qte]);
    const offert = norm_(v_(r, c.mode)).indexOf('offert') === 0;
    const lieu = libBoutique_(v_(r, c.boutique), v_(r, c.source));
    const a = art[produit] = art[produit] || { produit, q: 0, gp: 0, vip: 0, web: 0, hm: 0, off: 0, ca: 0, m: {} };
    a.q += q;
    if (offert) a.off += q;
    else a.ca += num_(r[c.ca]);
    if (lieu === 'Boutique GP') a.gp += q;
    else if (lieu === 'Boutique VIP') a.vip += q;
    else if (lieu.indexOf('Hors match') === 0) a.hm += q;
    else a.web += q;
    const m = String(v_(r, c.match)).trim();
    if (m && lieu.indexOf('Boutique') === 0) {
      a.m[m] = (a.m[m] || 0) + q;
      if (!matchs[m] || (d instanceof Date && d < matchs[m])) matchs[m] = d instanceof Date ? d : new Date(0);
    }
  });
  const listeMatchs = Object.keys(matchs).sort((x, y) => matchs[y] - matchs[x]);   // plus récent d'abord
  const lignes = Object.keys(art).map(k => art[k])
    .sort((x, y) => x.produit.localeCompare(y.produit, 'fr', { numeric: true }));

  const sh = li_feuille_(inv, LI.TAB_RESUME);
  sh.clear(); sh.clearConditionalFormatRules();
  sh.getRange('A1').setValue('VENTES PAR ARTICLE — saison ' + debut.getFullYear() + '-' + (debut.getFullYear() + 1))
    .setFontSize(14).setFontWeight('bold').setFontColor(LI.BLEU_NUIT);
  sh.getRange('A2').setValue('Dernière MAJ : ' + maj + '  •  Une ligne par article et taille (tablettes, Tickie, site, hors match). '
    + 'Les offerts sont comptés en quantité mais pas dans le CA. Colonnes de droite : quantités vendues en boutique par match. Lecture seule.')
    .setFontColor('#555555').setFontStyle('italic');
  const ent = ['Article', 'Qté totale', 'Boutique GP', 'Boutique VIP', 'Web / site', 'Hors match', 'dont offerts', 'CA TTC']
    .concat(listeMatchs);
  sh.getRange(4, 1, 1, ent.length).setValues([ent])
    .setBackground(LI.BLEU_NUIT).setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center').setWrap(true);
  if (!lignes.length) { sh.getRange(5, 1).setValue('Aucune vente cette saison.'); sh.setFrozenRows(4); proteger_(sh, null); return; }

  const arr = x => Math.round(x * 100) / 100;
  const vals = lignes.map(l => [l.produit, l.q, l.gp, l.vip, l.web, l.hm, l.off, arr(l.ca)]
    .concat(listeMatchs.map(m => l.m[m] || '')));
  const n = vals.length;
  const tot = ['TOTAL'].concat(ent.slice(1).map((_, k) => arr(vals.reduce((x, v) => x + (Number(v[k + 1]) || 0), 0))));
  sh.getRange(5, 1, n, ent.length).setValues(vals);
  sh.getRange(5 + n, 1, 1, ent.length).setValues([tot]).setFontWeight('bold').setBackground(LI.BLEU_CIEL);
  sh.getRange(5, 2, n + 1, ent.length - 1).setHorizontalAlignment('center');
  sh.getRange(5, 8, n + 1, 1).setNumberFormat('#,##0.00 €');
  sh.getRange(5, 2, n + 1, 1).setFontWeight('bold');
  for (let i = 0; i < n; i += 2) sh.getRange(5 + i, 1, 1, 8).setBackground('#F4F8FC');
  sh.setFrozenRows(4); sh.setFrozenColumns(1);
  sh.setColumnWidth(1, 300); sh.setColumnWidths(2, 7, 95);
  if (listeMatchs.length) sh.setColumnWidths(9, listeMatchs.length, 120);
  sh.setRowHeight(4, 42);
  proteger_(sh, null);
}

/* ------------------------------------------------------------ MOUVEMENTS -- */

function ecrireMouvements_(crm, inv, maj) {
  const t = lireTable_(crm, '11_MOUVEMENTS_STOCK');
  if (!t) return;
  const c = {
    date: col_(t.h, ['horodatage', 'horoda']), type: col_(t.h, ['type']), ref: col_(t.h, ['ref_boutique', 'ref_bo']),
    produit: col_(t.h, ['produit']), point: col_(t.h, ['point']), qte: col_(t.h, ['quantite']),
    benef: col_(t.h, ['beneficiaire', 'benefi']), match: col_(t.h, ['match']),
    com: col_(t.h, ['commentaire', 'commen']), auteur: col_(t.h, ['auteur']), bon: col_(t.h, ['numero'])
  };
  const rows = t.rows.filter(r => r[c.produit] || r[c.ref])
    .map(r => [
      dateObj_(r[c.date]), v_(r, c.type), v_(r, c.ref), v_(r, c.produit), libPoint_(v_(r, c.point)),
      num_(r[c.qte]), v_(r, c.benef), v_(r, c.match), v_(r, c.bon), v_(r, c.auteur), v_(r, c.com)
    ])
    .sort((a, b) => (b[0] || 0) - (a[0] || 0))
    .slice(0, LI.NB_MVT);

  const ent = ['Date', 'Type', 'Réf.', 'Article', 'Emplacement', 'Qté', 'Bénéficiaire', 'Match', 'N° bon', 'Saisi par', 'Commentaire'];
  ecrireJournal_(inv, LI.TAB_MVT, 'MOUVEMENTS LIVE — réceptions, transferts Dépôt → boutiques, dotations, casse',
                 maj, ent, rows, { dateCol: 1, euroCols: [] });
}

/* --------------------------------------------------------------- HELPERS -- */

function ecrireJournal_(inv, nom, titre, maj, ent, rows, opt) {
  const sh = li_feuille_(inv, nom);
  sh.clear();
  sh.getRange('A1').setValue(titre).setFontSize(14).setFontWeight('bold').setFontColor(LI.BLEU_NUIT);
  sh.getRange('A2').setValue('Dernière MAJ : ' + maj + '  •  Onglet alimenté automatiquement par le CRM Boutique — lecture seule.')
    .setFontColor('#555555').setFontStyle('italic');
  sh.getRange(4, 1, 1, ent.length).setValues([ent])
    .setBackground(LI.BLEU_NUIT).setFontColor('#FFFFFF').setFontWeight('bold');
  if (rows.length) {
    sh.getRange(5, 1, rows.length, ent.length).setValues(rows.map(r => r.map(x => x === null ? '' : x)));
    sh.getRange(5, opt.dateCol, rows.length, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    opt.euroCols.forEach(k => sh.getRange(5, k, rows.length, 1).setNumberFormat('#,##0.00 €'));
  } else {
    sh.getRange(5, 1).setValue('Aucune donnée pour le moment.');
  }
  sh.setFrozenRows(4);
  sh.autoResizeColumns(1, ent.length);
  proteger_(sh, null);
}

function li_feuille_(ss, nom) {
  return ss.getSheetByName(nom) || ss.insertSheet(nom, 0);
}

/** Protection « avertissement » : Élise peut passer outre, mais est prévenue. */
function proteger_(sh, plageLibre, plages) {
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
  const p = sh.protect().setDescription('Alimenté par le CRM Boutique — ne pas modifier').setWarningOnly(true);
  const libres = (plages || []).concat(plageLibre ? [plageLibre] : []);
  if (libres.length) p.setUnprotectedRanges(libres.map(a => sh.getRange(a)));
}

function lireTable_(ss, nom) {
  const sh = ss.getSheetByName(nom);
  if (!sh || sh.getLastRow() < 2) return sh ? { h: [], rows: [] } : null;
  const v = sh.getDataRange().getValues();
  return { h: v[0].map(x => norm_(x)), rows: v.slice(1) };
}

/** Index de colonne par nom d'en-tête (exact, puis « commence par »). -1 si absent. */
function col_(h, noms) {
  for (const n of noms) { const i = h.indexOf(norm_(n)); if (i >= 0) return i; }
  for (const n of noms) { const i = h.findIndex(x => x.indexOf(norm_(n)) === 0); if (i >= 0) return i; }
  return -1;
}

function norm_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
function v_(r, i) { return i >= 0 && r[i] !== null && r[i] !== undefined ? r[i] : ''; }
function num_(x) {
  if (typeof x === 'number') return x;
  const n = parseFloat(String(x || '').replace(/\s/g, '').replace('€', '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
function vrai_(x) {
  if (x === true) return true;
  const s = norm_(x);
  return s === 'true' || s === 'vrai' || s === 'oui' || s === '1' || s === 'x';
}
function dateObj_(x) {
  if (x instanceof Date) return x;
  if (!x) return '';
  const m = String(x).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(y, +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  }
  const d = new Date(x);
  return isNaN(d) ? String(x) : d;
}
function libTaille_(x) {
  const s = String(x === null || x === undefined ? '' : x).trim();
  return s.replace(/^size\s*/i, '');
}
function rangTaille_(t) {
  const i = LI.ORDRE_TAILLES.indexOf(norm_(t));
  return i < 0 ? 50 : i;
}
function libBoutique_(b, source) {
  const s = norm_(b);
  if (s === 'b1' || s.indexOf('gp') >= 0 || s.indexOf('grand') >= 0) return 'Boutique GP';
  if (s === 'b2' || s.indexOf('vip') >= 0) return 'Boutique VIP';
  if (s === 'web' || norm_(source) === 'tickie') return 'Web / Tickie';
  if (norm_(source) === 'hors_match') return s === 'r' ? 'Hors match (dépôt)' : 'Hors match (' + (s === 'b2' ? 'VIP' : 'GP') + ')';
  return b || '';
}
function libPoint_(p) {
  const s = norm_(p);
  if (s === 'r' || s.indexOf('reserve') >= 0 || s.indexOf('depot') >= 0) return 'Dépôt';
  if (s === 'b1') return 'Boutique GP';
  if (s === 'b2') return 'Boutique VIP';
  return p || '';
}
function journal_(crm, statut, detail) {
  const sh = crm.getSheetByName('99_DIAGNOSTIC');
  if (!sh) return;
  sh.appendRow(['Lien inventaire Élise', statut, String(detail).slice(0, 500), new Date()]);
}