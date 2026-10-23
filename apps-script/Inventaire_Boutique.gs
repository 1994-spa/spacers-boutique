// ═══════════════════════════════════════════════════════════════════════════
// INVENTAIRE BOUTIQUE — fichier AUTONOME à ajouter au projet du classeur CRM
// (App_Boutique). Met à jour le classeur « Inventaire 2026 2027 » tenu par la
// personne en charge de la boutique.
//
// Chaque article qui sort de la boutique est décompté UNE fois :
//   • vente en caisse (tablette)  → 21_LIGNES_LIVE (arrive pendant le match)
//   • retrait d'un add-on payé en ligne, remis au stand → 17b_REMISES
// Les transferts entre boutiques (24_TRANSFERTS_LIVE : course du volant pour un client,
// réassort) déplacent l'article : −qté dans le tableau du stand de départ, +qté dans celui
// d'arrivée (onglets « En boutique » et « Stock Total »). Pas de ligne dans « Journal ventes ».
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
  SH_TRF: '24_TRANSFERTS_LIVE',
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
  { nom: 'Polo femme',          produit: /polo.*(femme|women)/,           tableau: /polos?.*\b(women|femmes?)\b/ },
  { nom: 'Polo homme',          produit: /polo.*(homme|\bmen\b)/,        tableau: /polos?.*\b(men|man|hommes?)\b/ },
  { nom: 'Sweat zippé',         produit: /sweat|hoodie/,                  tableau: /sweats?|hoodies?/ },
  { nom: 'T-shirt sportif blanc', produit: /t-?shirt sportif.*blanc/,     tableau: /t-?shirts? sportifs? blancs?/ },
  { nom: 'T-shirt sportif bleu',  produit: /t-?shirt sportif.*(navy|bleu)/, tableau: /t-?shirts? sportifs? (bleus?|navy)/ },
  { nom: 'Porte-clés',          produit: /porte.?cles?/,                  tableau: /porte.?cles?/, tu: true },
  { nom: 'Sticker',             produit: /sticker/,                       tableau: /stickers?/,  tu: true },
  { nom: 'Mug',                 produit: /\bmugs?\b/,                    tableau: /\bmugs?\b/, tu: true },
  { nom: 'Casquette',           produit: /casquette/,                     tableau: /casquettes?/, tu: true },
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
  const msg = majInventaire_();
  Logger.log(msg);
  return msg;
}

function majInventaire_() {
  if (PropertiesService.getScriptProperties().getProperty('INVENTAIRE_ARCHIVE')) {
    return 'Inventaire : anciens tableaux archivés, plus de décompte (le stock se lit dans 🔄 STOCK LIVE).';
  }
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
      if (m.transfert) { traces.push(invTrace_(m.cle, m, invAppliquerTransfert_(tableaux, m, maj))); return; }
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
    const nbT = auto.filter(function (m) { return m.transfert; }).length;
    return 'Inventaire : ' + (auto.length - nbT) + ' vente(s) caisse/retrait, ' + nbT + ' transfert(s) entre boutiques et ' + manuelles.length +
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

// Transfert : −qté au stand de départ, +qté au stand d'arrivée, dans chaque onglet.
// Trace : colonnes « avant / après » = stand de départ.
function invAppliquerTransfert_(tableaux, m, maj) {
  const fam = invFamille_(m.produit + ' ' + (m.ref || ''));
  if (!fam) { const x = { statut: 'article non reconnu' }; return { b: x, s: x, statut: 'À vérifier : article non reconnu' }; }
  const res = {}, pb = [];
  INV.ONGLETS.forEach(function (o) {
    const sort = invDecompter_(tableaux, o, fam, m.transfert.de, m.taille, m.qte, maj);
    const entre = invDecompter_(tableaux, o, fam, m.transfert.vers, m.taille, -m.qte, maj);
    [sort, entre].forEach(function (x) { if (x.statut !== 'OK') pb.push(x.statut); });
    res[o] = { statut: sort.statut, avant: sort.avant, apres: sort.apres };
  });
  return { b: res['En boutique'], s: res['Stock Total'], statut: pb.length ? 'À vérifier : ' + pb.join(' / ') : 'OK', famille: fam };
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
  const shT = crm.getSheetByName(INV.SH_TRF);
  if (shT && shT.getLastRow() > 1) {
    const d = shT.getRange(1, 1, shT.getLastRow(), shT.getLastColumn()).getValues();
    const h = invEntetes_(d[0]);
    const g = function (r, n) { const i = h[invNorm_(n)]; return i === undefined ? '' : r[i]; };
    d.slice(1).forEach(function (r) {
      const id = String(g(r, 'ID transfert') || ''), produit = String(g(r, 'Produit') || ''), ref = String(g(r, 'Réf.') || '');
      const qte = Number(g(r, 'Qté')) || 0, de = INV.STAND[String(g(r, 'De'))], vers = INV.STAND[String(g(r, 'Vers'))];
      if (!id || !produit || qte <= 0 || !de || !vers || de === vers) return;
      out.push({ cle: 'T|' + id, origine: 'Transfert ' + de + ' → ' + vers + ' (' + String(g(r, 'Motif') || '') + ')',
        ts: invDate_(g(r, 'Remis le')) || invDate_(g(r, 'Horodatage')), match: String(g(r, 'Match') || ''),
        stand: de + '→' + vers, produit: produit, ref: ref, taille: invTailleProduit_(produit, ref), qte: qte,
        transfert: { de: de, vers: vers } });
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
    const marque = String(r[c.maj] || '');
    if (!article || qte <= 0 || (marque && marque.indexOf('— non décompté') !== 0) ||
        String(r[c.info] || '').indexOf(INV.PREFIXE_AUTO) === 0) return;
    const d = invDate_(r[c.date]), lieu = invLieu_(r[c.lieu]);
    if (!d || !lieu) return;                                      // ligne incomplète
    if (d < debutJour) {                                          // antérieure : signalée, jamais décomptée
      jv.sh.getRange(jv.hdr + 1 + i, jv.cMaj).setValue('— non décompté : daté avant la mise en service (' +
        Utilities.formatDate(depuis, 'Europe/Paris', 'dd/MM/yy') + '). Corriger la date pour le décompter.');
      return;
    }
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

// ── Archivage des anciens tableaux (▶ archiverAnciensTableaux, une fois) ──
// Règle : tout article et tout stock passent par le CRM ; le classeur Inventaire n'en est qu'une copie.
// Les tableaux faits main (« En boutique », « Stock Total », « Dépot », « Journal ventes ») tenaient un
// second stock, décompté à part : il se décalait du CRM (réceptions et répartitions jamais reportées).
// Cette fonction : arrête leur décompte, supprime le déclencheur 10 min, les masque (rien n'est effacé :
// clic droit sur la barre des onglets › « Afficher la feuille » pour les revoir).
// Le stock se lit dans « 🔄 STOCK LIVE » ; la préparation et le contrôle se font dans
// « 📦 PRÉPARATION STOCK » / « 🏁 APRÈS MATCH » ou sur la page Gestion ; les ventes hors match sur la page Gestion.
// Les onglets de comptage du matériel club (Panneautique, Gilets, chasubles, gobelets…) ne sont pas touchés.
const INV_ARCHIVES = ['En boutique', 'Stock Total', 'Dépot', 'Journal ventes'];

function archiverAnciensTableaux() {
  PropertiesService.getScriptProperties().setProperty('INVENTAIRE_ARCHIVE', new Date().toISOString());
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'majInventaire') ScriptApp.deleteTrigger(t);
  });
  const ss = invSS_();
  const faits = [];
  INV_ARCHIVES.forEach(function (nom) {
    const sh = ss.getSheetByName(nom);
    if (!sh) return;
    sh.setTabColor('#9aa4b2');
    if (!sh.isSheetHidden()) sh.hideSheet();
    faits.push(nom);
  });
  const live = ss.getSheetByName('🔄 STOCK LIVE');
  if (live) { ss.setActiveSheet(live); }
  const msg = 'Archivés et masqués : ' + (faits.join(', ') || 'aucun') + '. Décompte automatique arrêté.';
  Logger.log(msg);
  return msg;
}

// Pour revenir en arrière (▶ annulerArchivage) : réaffiche les onglets et relance le décompte.
function annulerArchivage() {
  PropertiesService.getScriptProperties().deleteProperty('INVENTAIRE_ARCHIVE');
  const ss = invSS_();
  INV_ARCHIVES.forEach(function (nom) { const sh = ss.getSheetByName(nom); if (sh && sh.isSheetHidden()) sh.showSheet(); });
  ScriptApp.newTrigger('majInventaire').timeBased().everyMinutes(10).create();
  Logger.log('Onglets réaffichés, décompte relancé.');
}

// ── Correction de l'affichage (▶ corrigerAffichageInventaire, une fois) ──────────
// Élise garde SES tableaux (En boutique, Stock Total, Dépot, Journal ventes) : réaffichés,
// et de nouveau mis à jour automatiquement par les ventes caisse, les retraits web et les
// transferts (décompte toutes les 10 min, rattrapage immédiat de ce qui s'est passé depuis l'archivage).
// Les onglets techniques alimentés par le CRM sont masqués (rien n'est effacé, ils continuent
// d'être mis à jour en arrière-plan) : 🔄 STOCK / VENTES / MOUVEMENTS LIVE, 🔄 MAJ auto,
// 📦 PRÉPARATION STOCK, 🏁 APRÈS MATCH, 📖 MODE D'EMPLOI.
// Les onglets du matériel club (Panneautique, Gilets, chasubles, gobelets, ramasseurs…) ne bougent pas.
const INV_TECHNIQUES = ['🔄 STOCK LIVE', '🔄 VENTES LIVE', '🔄 MOUVEMENTS LIVE', INV.JOURNAL,
                        '📦 PRÉPARATION STOCK', '🏁 APRÈS MATCH', '📖 MODE D\'EMPLOI', '📖 MODE DEMPLOI'];

function corrigerAffichageInventaire() {
  const p = PropertiesService.getScriptProperties();
  p.deleteProperty('INVENTAIRE_ARCHIVE');
  const ss = invSS_();
  const montres = [], masques = [];
  INV_ARCHIVES.forEach(function (nom) {
    const sh = ss.getSheetByName(nom);
    if (!sh) return;
    sh.setTabColor(null);
    if (sh.isSheetHidden()) { sh.showSheet(); montres.push(nom); }
  });
  const premier = ss.getSheetByName('En boutique') || ss.getSheetByName('Stock Total');
  if (premier) ss.setActiveSheet(premier);
  INV_TECHNIQUES.forEach(function (nom) {
    const sh = ss.getSheetByName(nom);
    if (sh && !sh.isSheetHidden()) { sh.hideSheet(); masques.push(nom); }
  });
  // Décompte automatique : un seul déclencheur 10 min
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'majInventaire') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('majInventaire').timeBased().everyMinutes(10).create();
  let rattrapage = '';
  try { rattrapage = majInventaire_(); } catch (e) { rattrapage = 'rattrapage : ' + e.message; }
  const msg = 'Réaffichés : ' + (montres.join(', ') || 'déjà visibles') + '.\nMasqués : ' + (masques.join(', ') || 'déjà masqués') +
    '.\nDécompte automatique relancé (toutes les 10 min). ' + rattrapage;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('Classeur Inventaire', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return msg;
}

// ── Fusion de la copie « Inventaire 2026 2027 – 21 octobre » (▶ fusionnerCopie21Octobre, une fois) ──
// Tous les scripts (décompte des ventes, onglets 🔄, CRM) travaillent sur le classeur d'origine.
// Élise a continué le 22/10 dans une copie : ses modifications y sont ramenées, puis la copie est
// renommée « ⚠ ARCHIVE – ne plus utiliser » (rien n'est supprimé).
//  - Stock Total : chaque case « Stock » des tableaux est alignée sur la copie (même tableau, même taille).
//  - Onglets ajoutés dans la copie (Stock 2110, Stock facture…) : copiés dans l'original.
//  - En boutique, Dépot, Journal ventes : identiques dans les deux, rien à faire (vérifié).
const INV_COPIE_ID = '1F9H9A_ySMTbddU2BvHVsBg2KQmTVyBTOhxaOkjChjLs';

function fusionnerCopie21Octobre() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const rapport = [];
  try {
    const orig = invSS_();
    const copie = SpreadsheetApp.openById(INV_COPIE_ID);
    if (orig.getId() === copie.getId()) throw new Error('La copie et l\'original sont le même fichier.');

    // 1. Stock Total : valeurs « Stock » des tableaux
    const lire = function (ss) {
      const meta = invMeta_(ss), out = {};
      (meta.sheets || []).forEach(function (s) {
        if (s.properties.title !== 'Stock Total') return;
        const sh = ss.getSheetByName('Stock Total');
        (s.tables || []).forEach(function (t) {
          const g = t.range, r0 = (g.startRowIndex || 0) + 1, c0 = (g.startColumnIndex || 0) + 1;
          const nbL = g.endRowIndex - (g.startRowIndex || 0), nbC = g.endColumnIndex - (g.startColumnIndex || 0);
          if (nbL < 2) return;
          const v = sh.getRange(r0, c0, nbL, nbC).getValues();
          const h = invEntetes_(v[0]), cS = h[invNorm_('Stock')], cT = h[invNorm_('Taille')];
          if (cS === undefined) return;
          out[t.name] = v.slice(1).map(function (row, i) {
            return { taille: cT === undefined ? '' : String(row[cT]).trim(), stock: row[cS], range: sh.getRange(r0 + 1 + i, c0 + cS) };
          });
        });
      });
      return out;
    };
    const A = lire(orig), B = lire(copie);
    let nb = 0;
    Object.keys(B).forEach(function (nom) {
      if (!A[nom]) { rapport.push('Stock Total › tableau « ' + nom + ' » absent de l\'original : non repris'); return; }
      B[nom].forEach(function (lb, i) {
        const la = A[nom].filter(function (x) { return x.taille === lb.taille; })[0] || A[nom][i];
        if (!la || String(la.stock) === String(lb.stock)) return;
        la.range.setValue(lb.stock);
        rapport.push('Stock Total › ' + nom.replace(/_/g, ' ').trim() + (lb.taille && lb.taille !== '//' ? ' ' + lb.taille : '') + ' : ' + la.stock + ' → ' + lb.stock);
        nb++;
      });
    });

    // 2. Onglets présents seulement dans la copie
    const noms = orig.getSheets().map(function (s) { return s.getName(); });
    copie.getSheets().forEach(function (s) {
      const nom = s.getName();
      if (noms.indexOf(nom) !== -1) return;
      const n = s.copyTo(orig);
      n.setName(nom);
      rapport.push('Onglet « ' + nom + ' » copié dans l\'original');
    });

    // 3. La copie devient une archive
    if (copie.getName().indexOf('ARCHIVE') === -1) copie.rename('⚠ ARCHIVE – ne plus utiliser – ' + copie.getName());
    rapport.push('Copie renommée : « ' + copie.getName() + ' »');
    const msg = (nb ? nb + ' case(s) de stock reprise(s).\n' : 'Aucune case de stock différente.\n') + rapport.join('\n') +
      '\n\nÀ partir de maintenant, Élise travaille uniquement dans : ' + orig.getUrl();
    Logger.log(msg);
    try { SpreadsheetApp.getUi().alert('Fusion de la copie du 21 octobre', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
    return msg;
  } finally {
    lock.releaseLock();
  }
}

// ── Masquer des onglets du classeur Inventaire (▶ masquerOngletsMateriel) ─────────
// Rien n'est effacé : clic droit sur la barre des onglets › « Afficher la feuille » pour les revoir.
const INV_A_MASQUER = ['ramasseurs', 'gobelet', 'chasubles'];

function masquerOngletsMateriel() {
  const ss = invSS_();
  const faits = [], absents = [];
  INV_A_MASQUER.forEach(function (nom) {
    const sh = ss.getSheets().filter(function (s) { return invNorm_(s.getName()) === invNorm_(nom); })[0];
    if (!sh) { absents.push(nom); return; }
    if (!sh.isSheetHidden()) { sh.hideSheet(); faits.push(sh.getName()); }
  });
  const msg = 'Masqués : ' + (faits.join(', ') || 'déjà masqués') + (absents.length ? '. Introuvables : ' + absents.join(', ') : '') + '.';
  Logger.log(msg);
  return msg;
}

// ═══════════════════════════════════════════════════════════════════════════
// FUSION DES TABLEAUX GP + VIP DE L'ONGLET « En boutique » (23/10/2026)
// ▶ apercuFusionEnBoutique  : montre ce qui va être fait (rien n'est modifié)
// ▶ fusionnerEnBoutique     : fait la fusion (une fois)
// ▶ annulerFusionEnBoutique : remet l'ancien onglet si besoin
//
// Pour chaque article SAUF les maillots de match, le tableau rouge (GP) et le tableau bleu (VIP)
// deviennent UN tableau « … boutiques » = stock total en boutique (GP + VIP), taille par taille,
// tailles adultes puis tailles enfants juste en dessous.
// Les maillots de match restent séparés : GP = maillots classiques, VIP = maillots Sohei.
// Le décompte automatique (ventes caisse, retraits web, transferts) suit tout seul :
// une vente GP ou VIP se retire du tableau commun ; un transfert GP ↔ VIP ne change rien.
// L'ancien onglet est gardé, masqué, sous le nom « En boutique (avant fusion) ».
// ═══════════════════════════════════════════════════════════════════════════
const FUS = {
  ONGLET: 'En boutique',
  ANCIEN: 'En boutique (avant fusion)',
  COLS: [1, 7, 13, 19],               // A, G, M, S : 4 tableaux par rangée, comme avant
  ENTETES: ['Caractéristique', 'Stock', 'Taille', 'Notes'],
  NAVY: { red: 0 / 255, green: 30 / 255, blue: 45 / 255 },
  BANDE1: { red: 1, green: 1, blue: 1 },
  BANDE2: { red: 238 / 255, green: 242 / 255, blue: 247 / 255 },
};
const FUS_ADULTES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', 'TU'];

function apercuFusionEnBoutique() {
  const plan = fusPlan_(invSS_());
  const msg = fusResume_(plan) + '\n\nRien n\'a été modifié. Pour appliquer : ▶ fusionnerEnBoutique';
  Logger.log(msg);
  return msg;
}

function fusionnerEnBoutique() {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  const ss = invSS_();
  let neuf = null, ancien = null;
  try {
    if (ss.getSheetByName(FUS.ANCIEN)) throw new Error('Fusion déjà faite (l\'onglet « ' + FUS.ANCIEN + ' » existe). Pour recommencer : ▶ annulerFusionEnBoutique');
    // Décomptes en attente appliqués d'abord sur les anciens tableaux
    try { Logger.log(majInventaire_()); } catch (e) { Logger.log('Décompte préalable : ' + e.message); }
    const plan = fusPlan_(ss);
    ancien = ss.getSheetByName(FUS.ONGLET);
    const pos = ancien.getIndex();
    ancien.setName(FUS.ANCIEN);
    neuf = ss.insertSheet(FUS.ONGLET, pos - 1);
    fusEcrire_(ss, neuf, plan);
    ancien.hideSheet();
    ss.setActiveSheet(neuf);
    const msg = 'Fusion faite.\n' + fusResume_(plan) + '\n\nAncien onglet gardé (masqué) : « ' + FUS.ANCIEN + ' ».\n\n' + diagnosticInventaire();
    Logger.log(msg);
    try { SpreadsheetApp.getUi().alert('En boutique : tableaux GP + VIP fusionnés', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
    return msg;
  } catch (e) {
    // Retour à l'état d'origine si quelque chose a échoué en cours de route
    if (neuf) { try { ss.deleteSheet(neuf); } catch (x) {} }
    if (ancien && ancien.getName() === FUS.ANCIEN) { ancien.setName(FUS.ONGLET); if (ancien.isSheetHidden()) ancien.showSheet(); }
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function annulerFusionEnBoutique() {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    const ss = invSS_(), ancien = ss.getSheetByName(FUS.ANCIEN);
    if (!ancien) throw new Error('Pas d\'onglet « ' + FUS.ANCIEN + ' » : rien à annuler.');
    const neuf = ss.getSheetByName(FUS.ONGLET);
    if (neuf) { neuf.setName('En boutique (fusion annulée ' + Utilities.formatDate(new Date(), 'Europe/Paris', 'dd-MM HH:mm') + ')'); neuf.hideSheet(); }
    ancien.setName(FUS.ONGLET); ancien.showSheet(); ss.setActiveSheet(ancien);
    const msg = 'Ancien onglet « En boutique » remis. Attention : les ventes décomptées depuis la fusion l\'ont été dans l\'onglet fusionné (masqué, gardé pour contrôle).';
    Logger.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

// ── Lecture des tableaux actuels et regroupement ─────────────────────────
function fusPlan_(ss) {
  const sh = ss.getSheetByName(FUS.ONGLET);
  if (!sh) throw new Error('Onglet « ' + FUS.ONGLET + ' » introuvable.');
  const meta = fusMeta_(ss);
  const feuille = (meta.sheets || []).filter(function (s) { return s.properties.title === FUS.ONGLET; })[0];
  if (!feuille || !(feuille.tables || []).length) throw new Error('Aucun tableau dans « ' + FUS.ONGLET + ' ».');
  const tabs = [];
  feuille.tables.forEach(function (t) {
    const g = t.range, r0 = (g.startRowIndex || 0) + 1, c0 = (g.startColumnIndex || 0) + 1;
    const nbL = g.endRowIndex - (g.startRowIndex || 0), nbC = g.endColumnIndex - (g.startColumnIndex || 0);
    if (nbL < 1 || nbC < 2) return;
    const v = sh.getRange(r0, c0, nbL, nbC).getValues();
    const h = invEntetes_(v[0]);
    const cS = h[invNorm_('Stock')], cT = h[invNorm_('Taille')], cN = h[invNorm_('Notes')], cC = h[invNorm_('Caractéristique')];
    if (cS === undefined) return;
    const nomNorm = invNorm_(String(t.name).replace(/_\d+$/, '')).replace(/_/g, ' ');
    const stand = /\bvip\b/.test(nomNorm) ? 'VIP' : (/\bgp\b/.test(nomNorm) ? 'GP' : '');
    const fam = INV_FAMILLES.filter(function (f) { return f.tableau.test(nomNorm); })[0] || null;
    const lignes = [];
    v.slice(1).forEach(function (r) {
      const brut = cT === undefined ? '' : r[cT];
      if (String(brut).trim() === '' && String(r[cS]).trim() === '' && (cN === undefined || String(r[cN]).trim() === '')) return;
      lignes.push({ taille: brut, cle: (cT === undefined ? 'TU' : invNormTaille_(brut)) || 'TU', stock: r[cS],
        note: cN === undefined ? '' : String(r[cN] || '').trim(), carac: cC === undefined ? '' : String(r[cC] || '').trim() });
    });
    tabs.push({ nom: t.name, nomNorm: nomNorm, stand: stand, fam: fam, r0: r0, c0: c0, lignes: lignes, style: t.rowsProperties || null,
      maillot: /maillot/.test(nomNorm) });
  });
  tabs.sort(function (a, b) { return a.r0 - b.r0 || a.c0 - b.c0; });

  // Maillots de match : gardés tels quels (GP classique / VIP Sohei)
  const maillotsGP = tabs.filter(function (t) { return t.maillot && t.stand !== 'VIP'; });
  const maillotsVIP = tabs.filter(function (t) { return t.maillot && t.stand === 'VIP'; });
  // Autres articles : regroupés par article (famille reconnue, sinon nom sans GP/VIP)
  const groupes = [], parCle = {};
  tabs.filter(function (t) { return !t.maillot; }).forEach(function (t) {
    const cle = t.fam ? 'F|' + t.fam.nom : 'N|' + t.nomNorm.replace(/\b(gp|vip)\b/g, '').replace(/\s+/g, ' ').trim().replace(/s\b/g, '');
    if (!parCle[cle]) { parCle[cle] = { cle: cle, sources: [], fam: t.fam }; groupes.push(parCle[cle]); }
    parCle[cle].sources.push(t);
  });
  const noms = {};
  groupes.forEach(function (g) {
    const base = fusNomBase_(g.sources[0].nom);
    let nom = base + '_boutiques', i = 2;
    while (noms[nom]) nom = base + '_boutiques_' + (i++);
    noms[nom] = 1;
    g.nom = nom;
    g.lignes = fusFusionnerLignes_(g.sources);
  });
  return { maillotsGP: maillotsGP, maillotsVIP: maillotsVIP, groupes: groupes };
}

// « Tshirts_Nara_VIP » → « Tshirts_Nara » ; « Polo_Women_GP » → « Polo_Women »
function fusNomBase_(nom) {
  return String(nom).replace(/_\d+$/, '').split('_').filter(function (m) { return m && !/^(gp|vip)$/i.test(m); }).join('_') || 'Article';
}

// Additionne les stocks taille par taille ; tailles adultes puis enfants
function fusFusionnerLignes_(sources) {
  const parTaille = {}, ordre = [];
  sources.forEach(function (t) {
    const lieu = t.stand || (sources.length > 1 ? 'GP' : '');
    t.lignes.forEach(function (l) {
      if (!parTaille[l.cle]) { parTaille[l.cle] = { taille: l.taille, cle: l.cle, stock: 0, texte: [], notes: [], carac: [] }; ordre.push(l.cle); }
      const x = parTaille[l.cle];
      if (typeof l.stock === 'number') x.stock += l.stock;
      else if (String(l.stock).trim() !== '') x.texte.push((lieu ? lieu + ' : ' : '') + l.stock);
      if (l.note) x.notes.push((lieu ? lieu + ' : ' : '') + l.note);
      if (l.carac && x.carac.indexOf(l.carac) < 0) x.carac.push(l.carac);
      if (String(x.taille).trim() === '' && String(l.taille).trim() !== '') x.taille = l.taille;
    });
  });
  const rang = function (cle) {
    const age = fusAge_(cle);
    if (age !== null) return 100 + age;
    const i = FUS_ADULTES.indexOf(cle);
    return i < 0 ? 50 : i;
  };
  return ordre.map(function (k) { return parTaille[k]; }).sort(function (a, b) { return rang(a.cle) - rang(b.cle); }).map(function (x) {
    // Stock non chiffré (« Environ 120 ») : gardé en texte, avec la part chiffrée s'il y en a une
    const stock = x.texte.length ? (x.stock ? x.stock + ' + ' : '') + x.texte.join(' + ') : x.stock;
    return { taille: x.taille === '' ? '//' : x.taille, stock: stock, note: x.notes.join(' · '), carac: x.carac.join(' · ') };
  });
}
// Âge d'une taille enfant normalisée (« 8Y » → 8, « 128 » → 8) ; null pour une taille adulte
function fusAge_(cle) {
  let m = String(cle).match(/^(\d{1,2})Y$/);
  if (m) return +m[1];
  m = String(cle).match(/^(\d{3})$/);
  if (m && +m[1] >= 90 && +m[1] <= 176) return Math.round((+m[1] - 80) / 6);
  return null;
}

function fusResume_(plan) {
  const l = [];
  l.push('Maillots de match gardés séparés — GP (classique) : ' + plan.maillotsGP.map(function (t) { return t.nom; }).join(', '));
  l.push('Maillots de match gardés séparés — VIP (Sohei) : ' + plan.maillotsVIP.map(function (t) { return t.nom; }).join(', '));
  l.push('');
  l.push('Tableaux fusionnés (GP + VIP) :');
  plan.groupes.forEach(function (g) {
    const tot = g.lignes.reduce(function (s, x) { return s + (typeof x.stock === 'number' ? x.stock : 0); }, 0);
    l.push('• ' + g.nom + ' ← ' + g.sources.map(function (t) { return t.nom; }).join(' + ') + ' : ' +
      g.lignes.map(function (x) { return (String(x.taille) === '//' ? '' : x.taille + ' ') + x.stock; }).join(' | ') + ' (total ' + tot + ')' +
      (g.fam ? '' : '  ⚠ article non relié au décompte automatique'));
  });
  return l.join('\n');
}

// ── Écriture du nouvel onglet ─────────────────────────────────────────────
function fusEcrire_(ss, sh, plan) {
  const reqs = [], sid = sh.getSheetId();
  let ligne = 1;
  const titre = function (texte) {
    sh.getRange(ligne, 1).setValue(texte).setFontWeight('bold').setFontSize(13).setFontColor('#001E2D');
    ligne += 2;
  };
  // Pose une rangée de tableaux (max 4) à partir de « ligne »
  const rangee = function (items) {
    let haut = 0;
    items.forEach(function (it, i) {
      const c0 = FUS.COLS[i], n = it.lignes.length;
      const vals = [FUS.ENTETES].concat(it.lignes.map(function (x) { return [x.carac || '', x.stock, x.taille, x.note || '']; }));
      sh.getRange(ligne, c0, vals.length, 4).setValues(vals);
      sh.getRange(ligne + 1, c0 + 2, Math.max(1, n), 1).setNumberFormat('@');
      sh.getRange(ligne, c0 + 4).setFormula('="TOTAL : "&SUM(' + sh.getRange(ligne + 1, c0 + 1, Math.max(1, n), 1).getA1Notation() + ')')
        .setBackground('#EAD1DC').setFontWeight('bold');
      sh.getRange(ligne - 1, c0).setValue(it.titre).setFontWeight('bold').setFontColor('#001E2D');
      reqs.push({ addTable: { table: {
        name: it.nom,
        range: { sheetId: sid, startRowIndex: ligne - 1, endRowIndex: ligne + Math.max(1, n), startColumnIndex: c0 - 1, endColumnIndex: c0 + 3 },
        columnProperties: FUS.ENTETES.map(function (e, j) { return { columnIndex: j, columnName: e }; }),
        rowsProperties: it.style || { headerColorStyle: { rgbColor: FUS.NAVY }, firstBandColorStyle: { rgbColor: FUS.BANDE1 }, secondBandColorStyle: { rgbColor: FUS.BANDE2 } },
      } } });
      haut = Math.max(haut, n + 1);
    });
    ligne += haut + 3;
  };
  const paquets = function (liste) { const out = []; for (let i = 0; i < liste.length; i += 4) out.push(liste.slice(i, i + 4)); return out; };
  const maillot = function (t, lieu) {
    // Nom unique dans le classeur (les anciens tableaux restent dans l'onglet masqué)
    return { nom: t.nom.replace(/_\d+$/, '') + '_match', titre: t.nom.replace(/_\d+$/, '').replace(/_/g, ' ') + ' (' + lieu + ')',
      lignes: t.lignes.map(function (l) { return { taille: l.taille, stock: l.stock, note: l.note, carac: l.carac }; }), style: t.style };
  };

  ligne = 2;
  titre('MAILLOTS DE MATCH — séparés : GP = classique · VIP = Sohei');
  if (plan.maillotsGP.length) paquets(plan.maillotsGP.map(function (t) { return maillot(t, 'GP · classique'); })).forEach(rangee);
  if (plan.maillotsVIP.length) paquets(plan.maillotsVIP.map(function (t) { return maillot(t, 'VIP · Sohei'); })).forEach(rangee);
  titre('AUTRES ARTICLES — stock total en boutique (GP + VIP)');
  paquets(plan.groupes.map(function (g) {
    return { nom: g.nom, titre: g.nom.replace(/_boutiques(_\d+)?$/, '').replace(/_/g, ' ') + ' — GP + VIP', lignes: g.lignes, style: null };
  })).forEach(rangee);

  [1, 7, 13, 19].forEach(function (c) {
    sh.setColumnWidth(c, 130); sh.setColumnWidth(c + 1, 70); sh.setColumnWidth(c + 2, 80); sh.setColumnWidth(c + 3, 170);
    sh.setColumnWidth(c + 4, 100);
    if (c + 5 <= 24) sh.setColumnWidth(c + 5, 20);
  });
  sh.setFrozenRows(0);
  SpreadsheetApp.flush();
  fusBatch_(ss, reqs);
}

function fusMeta_(ss) {
  const champs = 'sheets(properties(sheetId,title),tables(name,range,rowsProperties))';
  if (typeof Sheets !== 'undefined' && Sheets.Spreadsheets) return Sheets.Spreadsheets.get(ss.getId(), { fields: champs });
  const r = UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/' + ss.getId() + '?fields=' + encodeURIComponent(champs),
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('Lecture des tableaux impossible (' + r.getResponseCode() + ') : ' + r.getContentText().slice(0, 300));
  return JSON.parse(r.getContentText());
}

function fusBatch_(ss, reqs) {
  if (!reqs.length) return;
  if (typeof Sheets !== 'undefined' && Sheets.Spreadsheets) { Sheets.Spreadsheets.batchUpdate({ requests: reqs }, ss.getId()); return; }
  const r = UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/' + ss.getId() + ':batchUpdate', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ requests: reqs }),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('Création des tableaux impossible (' + r.getResponseCode() + ') : ' + r.getContentText().slice(0, 400));
}
