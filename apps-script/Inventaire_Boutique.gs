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
// Onglet « Journal ventes » (3 lieux de vente : Boutique GP, Boutique VIP, Hors match) :
//   • les ventes caisse et retraits web y sont AJOUTÉS automatiquement (Info « 🔄 … ») ;
//   • les ventes SAISIES À LA MAIN (VIP, GP ou Hors match/Autre) sont décomptées du stock
//     dès que la ligne est complète (date, article, taille si besoin, quantité, lieu).
//     GP/VIP → En boutique + Stock Total ; Hors match → Stock Total seulement.
//   • colonne « Stock MAJ » : ✓ quand la ligne a été décomptée (stock avant → après),
//     ⚠ si quelque chose est à vérifier. Une ligne marquée n'est jamais redécomptée.
// Trace technique (anti-doublon caisse) : onglet masqué « 🔄 MAJ auto (CRM) ».
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
  JOURNAL_VENTES: 'Journal ventes',
  COL_MAJ: 'Stock MAJ',
  PREFIXE_AUTO: '🔄',
  SH_LIGNES: '21_LIGNES_LIVE',
  SH_REMISES: '17b_REMISES',
  NAVY: '#001E2D',
  STAND: { B1: 'GP', B2: 'VIP' },
};

// Familles : reconnaissance du produit CRM → du tableau de l'inventaire.
// Ajouter une ligne ici pour un nouveau produit.
const INV_FAMILLES = [
  { nom: 'Maillot Bleu foncé',  produit: /mai-bnu|maillot.*bleu (nuit|fonce)/, tableau: /maillots? bleus? fonces?/ },
  { nom: 'Maillot Bleu clair',  produit: /mai-bci|maillot.*bleu (ciel|clair)/, tableau: /maillots? bleus? clairs?/ },
  { nom: 'Maillot Blanc',       produit: /mai-blc|maillot.*blanc/,       tableau: /maillots? blancs?/ },
  { nom: 'T-shirt Nara',        produit: /nara/,                          tableau: /nara/ },
  { nom: 'T-shirt Free time',   produit: /free ?time/,                    tableau: /free ?time/ },
  { nom: 'Écharpe',             produit: /ech-|echarpe/,                  tableau: /echarpes?/,  tu: true },
  { nom: 'Short',               produit: /sho-|short/,                    tableau: /shorts?/ },
  { nom: 'Gourde',              produit: /gourde/,                        tableau: /gourdes?/,   tu: true },
  { nom: 'Sac',                 produit: /\bsacs?\b/,                    tableau: /sacs?/,      tu: true },
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
  const t = invTableaux_(null);
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
    const log = ss.getSheetByName(INV.JOURNAL) || invCreerJournal_(ss);
    const deja = {};
    if (log.getLastRow() > 1) {
      log.getRange(2, 1, log.getLastRow() - 1, 1).getValues().forEach(function (r) { deja[String(r[0])] = 1; });
    }
    const auto = invMouvements_().filter(function (m) { return !deja[m.cle] && m.ts && m.ts >= depuis; });
    const meta = invMeta_(ss);
    const jv = invJournalVentes_(ss, meta);
    const manuelles = jv ? invLignesManuelles_(jv, depuis) : [];
    if (!auto.length && !manuelles.length) return 'Inventaire : rien de nouveau.';

    const tableaux = invTableaux_(meta);
    const maj = {};   // "sheetId|ligne|col" → { range, valeur }
    const traces = [];

    // 1. Ventes caisse + retraits web : décompte, puis ajout au Journal ventes
    const aEcrire = [];
    auto.forEach(function (m) {
      const r = invAppliquer_(tableaux, m, maj);
      traces.push(invTrace_(m.cle, m, r));
      aEcrire.push({ m: m, marque: r.marque, famille: r.famille });
    });

    // 2. Lignes saisies à la main dans Journal ventes
    manuelles.forEach(function (m) {
      const r = invAppliquer_(tableaux, m, maj);
      traces.push(invTrace_('M|' + Utilities.getUuid(), m, r));
      jv.sh.getRange(m.ligne, jv.cMaj).setValue(r.marque);
    });

    Object.keys(maj).forEach(function (k) { maj[k].range.setValue(maj[k].valeur); });
    if (jv && aEcrire.length) invEcrireJournal_(jv, aEcrire);
    log.getRange(log.getLastRow() + 1, 1, traces.length, INV_JOURNAL_COLS.length).setValues(traces);
    log.getRange(2, 2, log.getLastRow() - 1, 2).setNumberFormat('dd/MM/yyyy HH:mm');
    const nbOk = traces.filter(function (r) { return r[13] === 'OK'; }).length;
    return 'Inventaire : ' + auto.length + ' vente(s) caisse/retrait et ' + manuelles.length +
      ' saisie(s) manuelle(s) décomptée(s) — ' + nbOk + ' sans anomalie.';
  } finally {
    lock.releaseLock();
  }
}

// Décompte un mouvement selon le lieu : GP/VIP → En boutique + Stock Total ; HORS → Stock Total
function invAppliquer_(tableaux, m, maj) {
  const fam = invFamille_(m.produit + ' ' + (m.ref || ''));
  const res = {};
  if (!fam) {
    res['En boutique'] = res['Stock Total'] = { statut: 'article non reconnu' };
  } else if (m.stand === 'HORS') {
    res['En boutique'] = { statut: 'OK', horsMatch: true };
    let st = invDecompter_(tableaux, 'Stock Total', fam, 'GP', m.taille, m.qte, maj);
    if (/pas de tableau/.test(st.statut)) st = invDecompter_(tableaux, 'Stock Total', fam, 'VIP', m.taille, m.qte, maj);
    res['Stock Total'] = st;
  } else {
    INV.ONGLETS.forEach(function (o) { res[o] = invDecompter_(tableaux, o, fam, m.stand, m.taille, m.qte, maj); });
  }
  const b = res['En boutique'], s = res['Stock Total'];
  const pb = [b, s].map(function (x) { return x.statut; }).filter(function (x) { return x !== 'OK'; });
  const fmt = function (lib, x) { return x.avant === undefined ? '' : lib + ' ' + x.avant + '→' + x.apres; };
  const detail = [fmt('Boutique', b), fmt('Total', s)].filter(Boolean).join(' · ');
  return { b: b, s: s, statut: pb.length ? 'À vérifier : ' + pb.join(' / ') : 'OK',
    marque: (pb.length ? '⚠ ' + pb.join(' / ') : '✓ ' + detail), famille: fam };
}

function invTrace_(cle, m, r) {
  const v = function (x) { return x === undefined ? '' : x; };
  return [cle, new Date(), m.ts || '', m.origine, m.match || '', m.stand || '', m.produit, m.taille || 'TU', m.qte,
    v(r.b.avant), v(r.b.apres), v(r.s.avant), v(r.s.apres), r.statut];
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
        taille: invTailleProduit_(produit, ref), qte: qte, prix: invNum_(g(r, 'CA TTC')), mode: String(g(r, 'Mode') || '') });
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
        taille: invNormTaille_(g(r, 'taille')) || invTailleProduit_(produit, ref), qte: qte, prix: '', mode: '' });
    });
  }
  return out;
}

// ── Tableaux de l'inventaire (API Sheets : noms et plages des tableaux) ──
function invMeta_(ss) {
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
  return meta;
}

function invTableaux_(meta) {
  const ss = invSS_();
  meta = meta || invMeta_(ss);
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

// ── Journal ventes (onglet de la personne en charge de la boutique) ─────
function invJournalVentes_(ss, meta) {
  const sh = ss.getSheetByName(INV.JOURNAL_VENTES);
  if (!sh) return null;
  const nbC = Math.max(8, sh.getLastColumn());
  const tete = sh.getRange(1, 1, Math.min(5, Math.max(1, sh.getLastRow())), nbC).getValues();
  let hdr = -1;
  tete.forEach(function (r, i) {
    if (hdr < 0 && r.some(function (v) { return invNorm_(v) === 'article'; })) hdr = i;
  });
  if (hdr < 0) return null;
  const h = {};
  tete[hdr].forEach(function (v, i) {
    const k = invNorm_(v);
    if (k === 'date') h.date = i; else if (k === 'article') h.article = i; else if (k === 'taille') h.taille = i;
    else if (/^quantit/.test(k)) h.qte = i; else if (k === 'prix') h.prix = i; else if (/^(boutique|lieu)/.test(k)) h.lieu = i;
    else if (/^infos?$/.test(k)) h.info = i; else if (k === invNorm_(INV.COL_MAJ)) h.maj = i;
  });
  // positions par défaut (A Date, B Article, C Taille, D Quantité, E Prix, F Lieu, G Info)
  ['date', 'article', 'taille', 'qte', 'prix', 'lieu', 'info'].forEach(function (k, i) { if (h[k] === undefined) h[k] = i; });
  if (h.maj === undefined) {
    h.maj = Math.max(h.date, h.article, h.taille, h.qte, h.prix, h.lieu, h.info) + 1;
    sh.getRange(hdr + 1, h.maj + 1).setValue(INV.COL_MAJ).setFontWeight('bold');
  }
  // Fin de la zone : juste avant un éventuel tableau placé dessous (titre + 1 ligne vide)
  let limite = sh.getMaxRows();
  const feuille = (meta.sheets || []).filter(function (x) { return x.properties.title === INV.JOURNAL_VENTES; })[0];
  ((feuille && feuille.tables) || []).forEach(function (t) {
    const debut = t.range.startRowIndex || 0;
    if (debut > hdr) limite = Math.min(limite, debut - 2);
  });
  return { sh: sh, hdr: hdr + 1, c: h, cMaj: h.maj + 1, limite: limite };
}

function invLignesManuelles_(jv, depuis) {
  const n = jv.limite - jv.hdr;
  if (n < 1) return [];
  const debutJour = new Date(depuis.getFullYear(), depuis.getMonth(), depuis.getDate());
  const vals = jv.sh.getRange(jv.hdr + 1, 1, n, jv.cMaj).getValues(), c = jv.c, out = [];
  vals.forEach(function (r, i) {
    const article = String(r[c.article] || '').trim(), qte = invNum_(r[c.qte]);
    if (!article || qte <= 0 || r[c.maj] !== '' || String(r[c.info] || '').indexOf(INV.PREFIXE_AUTO) === 0) return;
    const d = invDate_(r[c.date]), lieu = invLieu_(r[c.lieu]);
    if (!d || d < debutJour || !lieu) return;                     // ligne incomplète ou antérieure
    const fam = invFamille_(article), taille = invNormTaille_(r[c.taille]);
    if (!taille && !(fam && fam.tu)) return;                       // taille pas encore saisie
    out.push({ ligne: jv.hdr + 1 + i, origine: 'Saisie Journal ventes', ts: d, match: '', stand: lieu,
      produit: article, ref: '', taille: taille || 'TU', qte: qte });
  });
  return out;
}

function invEcrireJournal_(jv, items) {
  const c = jv.c, nbCol = jv.cMaj;
  const n = Math.max(0, jv.limite - jv.hdr);
  const vals = n ? jv.sh.getRange(jv.hdr + 1, 1, n, nbCol).getValues() : [];
  const libres = [];
  vals.forEach(function (r, i) { if (!String(r[c.article] || '').trim()) libres.push(jv.hdr + 1 + i); });
  if (libres.length < items.length) {
    const manque = items.length - libres.length, apres = Math.max(jv.hdr, jv.limite);
    jv.sh.insertRowsAfter(apres, manque);
    for (let k = 1; k <= manque; k++) libres.push(apres + k);
  }
  items.sort(function (a, b) { return a.m.ts - b.m.ts; }).forEach(function (it, k) {
    const m = it.m, ligne = new Array(nbCol).fill('');
    ligne[c.date] = Utilities.formatDate(m.ts, 'Europe/Paris', 'dd/MM/yy');
    ligne[c.article] = (it.famille || invFamille_(m.produit + ' ' + (m.ref || '')) || { nom: m.produit }).nom;
    ligne[c.taille] = invTailleAffichee_(m.taille);
    ligne[c.qte] = m.qte;
    ligne[c.prix] = m.prix === '' ? '' : m.prix;
    ligne[c.lieu] = m.stand || '';
    ligne[c.info] = INV.PREFIXE_AUTO + ' ' + (m.origine === 'Retrait web' ? 'Retrait add-on payé en ligne' :
      'Caisse ' + Utilities.formatDate(m.ts, 'Europe/Paris', 'HH:mm') + (m.mode ? ' · ' + m.mode : ''));
    ligne[c.maj] = it.marque;
    jv.sh.getRange(libres[k], 1, 1, nbCol).setValues([ligne]);
    if (m.prix !== '') jv.sh.getRange(libres[k], c.prix + 1).setNumberFormat('#,##0.00 "€"');
  });
}

function invLieu_(v) {
  const n = invNorm_(v);
  if (!n) return '';
  if (/vip/.test(n)) return 'VIP';
  if (/\bgp\b|grand public/.test(n)) return 'GP';
  if (/hors|autre|bureau|match/.test(n)) return 'HORS';
  return '';
}
function invTailleAffichee_(t) {
  if (!t || t === 'TU') return '';
  return /^\d{3}$/.test(t) ? 'Size ' + t : t;
}
function invNum_(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v == null ? '' : v).replace(/[\s €]/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
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
  sh.hideSheet();
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
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
