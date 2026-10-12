// ═══════════════════════════════════════════════════════════════════════════
// INVENTAIRE BOUTIQUE — fichier AUTONOME à ajouter au projet du classeur CRM
// (App_Boutique). Met à jour le classeur « Inventaire 2026 2027 » tenu par la
// personne en charge de la boutique.
//
// Chaque article qui sort de la boutique est décompté UNE fois :
//   • vente en caisse (tablette)  → 21_LIGNES_LIVE (arrive pendant le match)
//   • retrait d'un add-on payé en ligne, remis au stand → 17b_REMISES
// dans les tableaux de l'onglet « En boutique » ET de l'onglet « Stock Total »
// dont le nom correspond au produit et au stand (ex. « Maillots Bleus foncés GP »,
// « Echarpes VIP »), sur la ligne de la bonne taille, colonne « Stock ».
// B1 (Grand Public) → tableaux « … GP » ; B2 (VIP) → tableaux « … VIP ».
// L'onglet « Dépot » n'est jamais touché (une vente ne sort pas du dépôt).
//
// Journal : onglet « 🔄 MAJ auto (CRM) » du classeur Inventaire — une ligne par
// article décompté, avec le stock avant/après. Il sert aussi d'anti-doublon.
//
// Déclencheur toutes les 10 min (posé par installerInventaire). Les mouvements
// antérieurs à la mise en service sont ignorés (déjà comptés à la main).
//
// Propriétés du script (posées par l'installation) : INVENTAIRE_ID,
// INVENTAIRE_DEPUIS (date ISO de mise en service).
// ═══════════════════════════════════════════════════════════════════════════

const INV = {
  ID_PAR_DEFAUT: '1b33hMr4zkgKcwByCRNKket3LpRClclxTssxs25M6xY8',
  ONGLETS: ['En boutique', 'Stock Total'],
  JOURNAL: '🔄 MAJ auto (CRM)',
  SH_LIGNES: '21_LIGNES_LIVE',
  SH_REMISES: '17b_REMISES',
  NAVY: '#001E2D',
  STAND: { B1: 'GP', B2: 'VIP' },
};

// Familles : reconnaissance du produit CRM → du tableau de l'inventaire.
// Ajouter une ligne ici pour un nouveau produit.
const INV_FAMILLES = [
  { nom: 'Maillot Bleu Nuit',   produit: /mai-bnu|maillot.*bleu nuit/,   tableau: /maillots? bleus? fonces?/ },
  { nom: 'Maillot Bleu Ciel',   produit: /mai-bci|maillot.*bleu ciel/,   tableau: /maillots? bleus? clairs?/ },
  { nom: 'Maillot Blanc',       produit: /mai-blc|maillot.*blanc/,       tableau: /maillots? blancs?/ },
  { nom: 'T-shirt Nara',        produit: /nara/,                          tableau: /nara/ },
  { nom: 'T-shirt Freetime',    produit: /free ?time/,                    tableau: /free ?time/ },
  { nom: 'Écharpe',             produit: /ech-|echarpe/,                  tableau: /echarpes?/ },
  { nom: 'Short',               produit: /sho-|short/,                    tableau: /shorts?/ },
  { nom: 'Gourde',              produit: /gourde/,                        tableau: /gourdes?/ },
  { nom: 'Sac',                 produit: /sac/,                           tableau: /sacs?/ },
];

const INV_JOURNAL_COLS = ['Clé', 'Traité le', 'Date mouvement', 'Origine', 'Match', 'Stand', 'Article',
  'Taille', 'Qté', 'En boutique avant', 'En boutique après', 'Stock Total avant', 'Stock Total après', 'Statut'];

// ── Installation (une fois : ▶ installerInventaire) ──────────────────────
function installerInventaire() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('INVENTAIRE_ID')) p.setProperty('INVENTAIRE_ID', INV.ID_PAR_DEFAUT);
  if (!p.getProperty('INVENTAIRE_DEPUIS')) p.setProperty('INVENTAIRE_DEPUIS', new Date().toISOString());
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'majInventaire') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('majInventaire').timeBased().everyMinutes(10).create();
  const ss = invSS_();
  Logger.log('Inventaire : ' + ss.getName() + ' · mouvements pris en compte à partir du ' +
    Utilities.formatDate(new Date(p.getProperty('INVENTAIRE_DEPUIS')), 'Europe/Paris', 'dd/MM/yyyy HH:mm'));
  Logger.log(diagnosticInventaire());
}

// Liste les tableaux reconnus (à lancer pour vérifier la correspondance)
function diagnosticInventaire() {
  const t = invTableaux_();
  const lignes = t.map(function (x) {
    return x.onglet + ' › ' + x.nom + ' → ' + (x.famille ? x.famille.nom + ' ' + (x.stand || '(tous stands)') : 'non relié') +
      ' (' + x.lignes.length + ' taille(s))';
  });
  return 'Tableaux trouvés :\n' + lignes.join('\n');
}

// Pour intégrer après coup un match passé (ex. 10/10/2026) : ▶ inclureDepuis_10_10
function inclureDepuis_10_10() {
  PropertiesService.getScriptProperties().setProperty('INVENTAIRE_DEPUIS', new Date(2026, 9, 10).toISOString());
  Logger.log(majInventaire());
}

// ── Point d'entrée (déclencheur 10 min) ──────────────────────────────────
function majInventaire() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'Mise à jour déjà en cours.';
  try {
    const depuis = new Date(PropertiesService.getScriptProperties().getProperty('INVENTAIRE_DEPUIS') || Date.now());
    const ss = invSS_();
    const journal = ss.getSheetByName(INV.JOURNAL) || invCreerJournal_(ss);
    const deja = {};
    if (journal.getLastRow() > 1) {
      journal.getRange(2, 1, journal.getLastRow() - 1, 1).getValues().forEach(function (r) { deja[String(r[0])] = 1; });
    }
    const mouvements = invMouvements_().filter(function (m) { return !deja[m.cle] && m.ts && m.ts >= depuis; });
    if (!mouvements.length) return 'Inventaire : rien de nouveau.';

    const tableaux = invTableaux_();
    const maj = {};   // "sheetId|ligne|col" → { range, valeur }
    const sorties = mouvements.map(function (m) {
      const fam = invFamille_(m.produit + ' ' + m.ref);
      const res = {};
      INV.ONGLETS.forEach(function (onglet) {
        res[onglet] = fam ? invDecompter_(tableaux, onglet, fam, m.stand, m.taille, m.qte, maj) : { statut: 'produit non reconnu' };
      });
      const b = res['En boutique'], s = res['Stock Total'];
      const statuts = [b, s].map(function (x) { return x.statut; }).filter(function (x) { return x !== 'OK'; });
      return [m.cle, new Date(), m.ts, m.origine, m.match, m.stand || '', m.produit, m.taille || 'TU', m.qte,
        b.avant === undefined ? '' : b.avant, b.apres === undefined ? '' : b.apres,
        s.avant === undefined ? '' : s.avant, s.apres === undefined ? '' : s.apres,
        statuts.length ? 'À vérifier : ' + statuts.join(' / ') : 'OK'];
    });

    Object.keys(maj).forEach(function (k) { maj[k].range.setValue(maj[k].valeur); });
    journal.getRange(journal.getLastRow() + 1, 1, sorties.length, INV_JOURNAL_COLS.length).setValues(sorties);
    journal.getRange(2, 2, journal.getLastRow() - 1, 2).setNumberFormat('dd/MM/yyyy HH:mm');
    const nbOk = sorties.filter(function (r) { return r[13] === 'OK'; }).length;
    return 'Inventaire : ' + sorties.length + ' article(s) décompté(s), dont ' + nbOk + ' sans anomalie.';
  } finally {
    lock.releaseLock();
  }
}

// ── Sources : ventes caisse (21_LIGNES_LIVE) + retraits web (17b_REMISES) ──
function invMouvements_() {
  const crm = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty('CRM_BOUTIQUE_ID') || '1mE9gSCtetFgnWEt0kA6cS2lcgJDe7oPRLDiXdGhH2EQ');
  const out = [];

  const shL = crm.getSheetByName(INV.SH_LIGNES);
  if (shL && shL.getLastRow() > 1) {
    const d = shL.getRange(1, 1, shL.getLastRow(), shL.getLastColumn()).getValues();
    const h = invEntetes_(d[0]);
    const g = function (r, n) { const i = h[invNorm_(n)]; return i === undefined ? '' : r[i]; };
    const vus = {};
    d.slice(1).forEach(function (r) {
      const id = String(g(r, 'ID vente') || ''), produit = String(g(r, 'Produit') || ''), ref = String(g(r, 'Réf.') || '');
      const qte = Number(g(r, 'Qté')) || 0;
      if (!id || !produit || qte <= 0) return;
      let cle = 'V|' + id + '|' + (ref || produit);
      vus[cle] = (vus[cle] || 0) + 1;
      if (vus[cle] > 1) cle += '|' + vus[cle];
      out.push({ cle: cle, origine: 'Vente caisse', ts: invDate_(g(r, 'Horodatage')), match: '',
        stand: INV.STAND[String(g(r, 'Boutique'))] || '', produit: produit, ref: ref,
        taille: invTailleProduit_(produit, ref), qte: qte });
    });
  }

  const shR = crm.getSheetByName(INV.SH_REMISES);
  if (shR && shR.getLastRow() > 1) {
    const d = shR.getRange(1, 1, shR.getLastRow(), shR.getLastColumn()).getValues();
    const h = invEntetes_(d[0]);
    const g = function (r, n) { const i = h[invNorm_(n)]; return i === undefined ? '' : r[i]; };
    d.slice(1).forEach(function (r) {
      const id = String(g(r, 'id_remise') || ''), produit = String(g(r, 'produit') || '');
      const ref = String(g(r, 'ref') || ''), qte = Number(g(r, 'quantite')) || 0;
      if (!id || !produit || qte <= 0) return;
      out.push({ cle: 'R|' + id, origine: 'Retrait web', ts: invDate_(g(r, 'horodatage')), match: String(g(r, 'match') || ''),
        stand: INV.STAND[String(g(r, 'stand'))] || 'GP', produit: produit, ref: ref,
        taille: invNormTaille_(g(r, 'taille')) || invTailleProduit_(produit, ref), qte: qte });
    });
  }
  return out;
}

// ── Tableaux de l'inventaire (API Sheets : noms et plages des tableaux) ──
function invTableaux_() {
  const ss = invSS_();
  const champs = 'sheets(properties(sheetId,title),tables(name,range))';
  let meta;
  if (typeof Sheets !== 'undefined' && Sheets.Spreadsheets) {
    // Service avancé « Google Sheets API » ajouté au projet (Services ➕) : rien à activer ailleurs
    meta = Sheets.Spreadsheets.get(ss.getId(), { fields: champs });
  } else {
    const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + ss.getId() + '?fields=' + encodeURIComponent(champs);
    const r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (r.getResponseCode() >= 300) throw new Error('Lecture des tableaux impossible (' + r.getResponseCode() + '). ' +
      'Dans l\'éditeur Apps Script : Services ➕ › « Google Sheets API » › Ajouter, puis relancer.');
    meta = JSON.parse(r.getContentText());
  }
  const out = [];
  (meta.sheets || []).forEach(function (s) {
    const onglet = s.properties.title;
    if (INV.ONGLETS.indexOf(onglet) < 0) return;
    const sh = ss.getSheetByName(onglet);
    (s.tables || []).forEach(function (t) {
      const g = t.range, r0 = (g.startRowIndex || 0) + 1, c0 = (g.startColumnIndex || 0) + 1;
      const nbL = g.endRowIndex - (g.startRowIndex || 0), nbC = g.endColumnIndex - (g.startColumnIndex || 0);
      if (nbL < 2 || nbC < 2) return;
      const vals = sh.getRange(r0, c0, nbL, nbC).getValues();
      const h = invEntetes_(vals[0]);
      const cS = h[invNorm_('Stock')], cT = h[invNorm_('Taille')];
      if (cS === undefined) return;
      const nomNorm = invNorm_(String(t.name).replace(/_\d+$/, '')).replace(/_/g, ' ');
      const stand = /\bvip\b/.test(nomNorm) ? 'VIP' : (/\bgp\b/.test(nomNorm) ? 'GP' : '');
      const lignes = [];
      vals.slice(1).forEach(function (v, i) {
        const taille = cT === undefined ? 'TU' : (invNormTaille_(v[cT]) || 'TU');
        if (cT !== undefined && v[cT] === '' && v[cS] === '') return;   // ligne vide du tableau
        lignes.push({ taille: taille, range: sh.getRange(r0 + 1 + i, c0 + cS), valeur: Number(v[cS]) || 0, cle: s.properties.sheetId + '|' + (r0 + 1 + i) + '|' + (c0 + cS) });
      });
      out.push({ onglet: onglet, nom: t.name, stand: stand, famille: INV_FAMILLES.filter(function (f) { return f.tableau.test(nomNorm); })[0] || null, lignes: lignes });
    });
  });
  return out;
}

function invDecompter_(tableaux, onglet, fam, stand, taille, qte, maj) {
  const memeProduit = tableaux.filter(function (t) { return t.onglet === onglet && t.famille === fam; });
  let cands = memeProduit.filter(function (t) { return t.stand === stand; });
  if (!cands.length) cands = memeProduit.filter(function (t) { return !t.stand; });   // tableau sans GP/VIP
  if (!cands.length) return { statut: onglet + ' : pas de tableau « ' + fam.nom + ' ' + (stand || '') + ' »' };
  const t = cands[0];
  const tl = taille || 'TU';
  let ligne = t.lignes.filter(function (l) { return l.taille === tl; })[0];
  if (!ligne && tl === 'TU' && t.lignes.length === 1) ligne = t.lignes[0];
  if (!ligne) return { statut: onglet + ' : taille ' + tl + ' absente de « ' + t.nom + ' »' };
  const cur = maj[ligne.cle] ? maj[ligne.cle].valeur : ligne.valeur;
  const apres = cur - qte;
  maj[ligne.cle] = { range: ligne.range, valeur: apres };
  return { statut: apres < 0 ? onglet + ' : stock négatif' : 'OK', avant: cur, apres: apres };
}

// ── Utilitaires ──────────────────────────────────────────────────────────
function invSS_() {
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('INVENTAIRE_ID') || INV.ID_PAR_DEFAUT);
}
function invCreerJournal_(ss) {
  const sh = ss.insertSheet(INV.JOURNAL);
  sh.getRange(1, 1, 1, INV_JOURNAL_COLS.length).setValues([INV_JOURNAL_COLS])
    .setBackground(INV.NAVY).setFontColor('#FFFFFF').setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.hideColumns(1);
  return sh;
}
function invFamille_(texte) {
  const n = invNorm_(texte);
  return INV_FAMILLES.filter(function (f) { return f.produit.test(n); })[0] || null;
}
// « Maillot Bleu Nuit - 152 » → 152 ; « Nara Tee 3XL » → 3XL ; ref MAI-BNU-140 → 140 ; Écharpe → TU
function invTailleProduit_(produit, ref) {
  const r = String(ref || '').match(/-([A-Z0-9]+)$/i);
  if (r && !/^TU$/i.test(r[1]) && !/^(BNU|BCI|BLC|NAR)$/i.test(r[1])) return invNormTaille_(r[1]);
  const m = String(produit || '').match(/(?:-\s*|\s)(\d{2,3}|[2-4]?XS|[2-4]?XL|XXX?L|S|M|L|\d{1,2}\s?(?:y|ans))\s*$/i);
  return m ? invNormTaille_(m[1]) : 'TU';
}
function invNormTaille_(v) {
  let t = String(v == null ? '' : v).trim().toUpperCase().replace(/^SIZE\s*/, '').replace(/\s+/g, '');
  if (!t) return '';
  if (t === '//' || t === 'TU' || t === 'UNIQUE') return 'TU';
  if (t === 'XXL') t = '2XL';
  if (t === 'XXXL') t = '3XL';
  t = t.replace(/ANS$/, 'Y');
  return t;
}
function invNorm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}
function invEntetes_(ligne) {
  const h = {};
  ligne.forEach(function (v, i) { const k = invNorm_(v); if (k && !(k in h)) h[k] = i; });
  return h;
}
function invDate_(v) {
  if (v instanceof Date) return v;
  if (!v) return null;
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
