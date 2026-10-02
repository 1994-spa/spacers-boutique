/**
 * ============================================================
 * SPACERS CRM BOUTIQUE — Apps Script V3.1 (saison 2026-2027)
 * ============================================================
 * V3.1 = V3 + corrections + compatibilité module Stock_Boutique.gs
 * V3.2 (02/10/2026) : couleurs de la charte 26-27 (plus de jaune) + menu « 📖 Classeur »
 *                    si Organisation_Classeur.gs est présent
 *
 * CORRECTIONS V3.1
 *   - Synchro tablette : le stock est DÉCRÉMENTÉ des quantités vendues
 *     (au lieu d'être écrasé par le stock de clôture de la tablette),
 *     pour ne plus effacer les ventes Tickie / dotations faites pendant le match.
 *     Écart éventuel avec la tablette → signalé dans 99_DIAGNOSTIC.
 *   - Saison calculée depuis la date (juillet → juin), plus depuis la tablette.
 *   - Articles « Offert » exclus du CA partout (dashboard, analyse, saisons, corrélations).
 *   - Marge = CA − quantités × coût moyen (03_PRODUITS.cout), plus via 02_ACHATS.
 *   - Dashboard : KPIs écrits aux bons emplacements, marge % au bon format,
 *     top 5 déplacé en H9 (ne chevauche plus le tableau des matchs).
 *   - 10_SAISONS reconstruit à partir de 01_VENTES (nb_matchs juste, pas de double comptage).
 *   - Imports Pennylane Ventes/Achats, boutique en ligne et clients : colonnes réalignées
 *     sur les en-têtes réels des onglets. Les lignes Tickie de l'onglet 09 sont ignorées
 *     par l'import (elles sont déjà intégrées par le récepteur webhook).
 *   - doPost protégé par un verrou (deux tablettes qui synchronisent en même temps).
 * ============================================================
 */

// ─────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────
const SHEET = {
  DASHBOARD:        '00_DASHBOARD',
  VENTES:           '01_VENTES',
  ACHATS:           '02_ACHATS',
  PRODUITS:         '03_PRODUITS',
  MATCHS:           '04_MATCHS',
  CLIENTS:          '05_CLIENTS',
  PANIERS:          '06_PANIERS_ABANDONNES',
  IMPORT_RATIO:     '07_IMPORT_RATIO',
  IMPORT_PENNY_V:   '08_IMPORT_PENNYLANE_VENTES',
  IMPORT_PENNY_A:   '08b_IMPORT_PENNYLANE_ACHATS',
  IMPORT_BOUTIQUE:  '09_IMPORT_BOUTIQUE',
  SAISONS:          '10_SAISONS',
  ANALYSE_PRODUITS: '90_ANALYSE_PRODUITS',
  DIAGNOSTIC:       '99_DIAGNOSTIC',
};

// Colonnes de 03_PRODUITS (index 0-based) — les colonnes ajoutées par Stock_Boutique.gs sont après G
const COL_PROD = {
  NOM:        0,
  CATEGORIE:  1,
  PRIX_VENTE: 2,
  COUT:       3,
  STOCK_B1:   4,
  STOCK_B2:   5,
  ACTIF:      6,
};

// Colonnes de 01_VENTES (index 0-based)
const COL_VENTE = {
  DATE:          0,
  SOURCE:        1,
  COMMANDE:      2,
  EMAIL:         3,
  PRODUIT:       4,
  CATEGORIE:     5,
  QUANTITE:      6,
  PRIX_UNITAIRE: 7,
  CA:            8,
  MATCH_ASSOCIE: 9,
  BOUTIQUE_ID:   10,
  SAISON:        11,
  MODE_PAIEMENT: 12,
};

const FORMAT_EUR = '#,##0.00 "€"';
const TVA_BOUTIQUE = 0.20;   // CA stocké en TTC · coûts en HT · marge calculée sur le CA HT

// ─────────────────────────────────────────────────────────────
// UTILITAIRES GÉNÉRAUX
// ─────────────────────────────────────────────────────────────

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error(`Onglet introuvable : "${name}". Vérifiez la structure du classeur.`);
  return sh;
}

function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') return new Date((val - 25569) * 86400 * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function dateKey(d) {
  if (!d) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function logDiag(source, niveau, message) {
  try {
    const sh = getSheet(SHEET.DIAGNOSTIC);
    sh.appendRow([new Date(), source, niveau, message]);
  } catch (e) {
    console.warn('Diagnostic non disponible :', e.message);
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/** { nom_colonne: index 1-based } lu sur la ligne d'en-tête. */
function colsParNom_(sh) {
  const m = {};
  if (sh.getLastColumn() < 1) return m;
  sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].forEach((v, i) => {
    const k = String(v).trim();
    if (k && !m[k]) m[k] = i + 1;
  });
  return m;
}

/** Ajoute la colonne si absente, renvoie son index 1-based. */
function assurerColonne_(sh, nom) {
  const c = colsParNom_(sh);
  if (c[nom]) return c[nom];
  const col = sh.getLastColumn() + 1;
  if (col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
  sh.getRange(1, col).setValue(nom).setFontWeight('bold');
  return col;
}

function estOffert_(row) {
  return /offert/i.test(String(row[COL_VENTE.MODE_PAIEMENT] || ''));
}

/** CA d'une ligne de vente, 0 si l'article a été offert. */
function caVente_(row) {
  return estOffert_(row) ? 0 : (Number(row[COL_VENTE.CA]) || 0);
}

/** Saison sportive d'une date : juillet → juin (ex. 06/05/2026 → 2025-2026). */
function saisonDepuisDate_(val) {
  const d = toDate(val);
  if (!d) return '';
  const y = Number(Utilities.formatDate(d, 'Europe/Paris', 'yyyy'));
  const m = Number(Utilities.formatDate(d, 'Europe/Paris', 'M'));
  return m >= 7 ? y + '-' + (y + 1) : (y - 1) + '-' + y;
}

/** { slug(nom produit): coût moyen } depuis 03_PRODUITS. */
function coutsProduits_() {
  const data = getSheet(SHEET.PRODUITS).getDataRange().getValues();
  const m = {};
  for (let i = 1; i < data.length; i++) {
    const nom = String(data[i][COL_PROD.NOM] || '').trim();
    if (nom) m[slugify(nom)] = Number(data[i][COL_PROD.COUT]) || 0;
  }
  return m;
}

/** Crée ou met à jour un client dans 05_CLIENTS (par en-têtes). Renvoie true si créé. */
function upsertClient_(email, ca, date, source, prenom, nom) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return false;
  const sh = getSheet(SHEET.CLIENTS);
  const c = colsParNom_(sh);
  if (!c.email) return false;
  const n = sh.getLastRow() - 1;
  const emails = n > 0 ? sh.getRange(2, c.email, n, 1).getValues().map(r => String(r[0]).trim().toLowerCase()) : [];
  const i = emails.indexOf(email);
  if (i >= 0) {
    const l = i + 2;
    if (c.nb_commandes) sh.getRange(l, c.nb_commandes).setValue((Number(sh.getRange(l, c.nb_commandes).getValue()) || 0) + 1);
    if (c.ca_total) sh.getRange(l, c.ca_total).setValue((Number(sh.getRange(l, c.ca_total).getValue()) || 0) + (Number(ca) || 0));
    if (c.dernier_achat) sh.getRange(l, c.dernier_achat).setValue(date || new Date());
    if (prenom && c.prenom && !sh.getRange(l, c.prenom).getValue()) sh.getRange(l, c.prenom).setValue(prenom);
    if (nom && c.nom && !sh.getRange(l, c.nom).getValue()) sh.getRange(l, c.nom).setValue(nom);
    return false;
  }
  const row = new Array(sh.getLastColumn()).fill('');
  const set = (k, v) => { if (c[k]) row[c[k] - 1] = v; };
  set('email', email); set('prenom', prenom || ''); set('nom', nom || ''); set('nb_commandes', 1);
  set('ca_total', Number(ca) || 0); set('dernier_achat', date || new Date()); set('source_acquisition', source || '');
  sh.appendRow(row);
  return true;
}

// ─────────────────────────────────────────────────────────────
// API PWA TABLETTES
// ─────────────────────────────────────────────────────────────

/**
 * doGet() — ?action=get_catalogue&boutique=B1&saison=2026-2027  |  ?action=ping
 */
function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action || 'ping';

    if (action === 'ping') {
      return jsonResponse({ status: 'ok', app: 'boutique', version: 'V3.1', timestamp: new Date().toISOString() });
    }

    if (action === 'get_catalogue') {
      const boutique = e.parameter.boutique || 'B1';
      const saison   = e.parameter.saison   || '';
      const produits = getCatalogueForTablet(boutique, saison);
      return jsonResponse({ status: 'ok', app: 'boutique', boutique, saison, produits });
    }

    return jsonResponse({ status: 'error', message: 'Action inconnue : ' + action });

  } catch (err) {
    logDiag('doGet', 'ERROR', err.message);
    return jsonResponse({ status: 'error', message: err.message });
  }
}

/**
 * doPost() — { action: 'import_session', session: {...}, ventes: [...], stock_cloture: [...] }
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return jsonResponse({ status: 'error', message: 'Serveur occupé, réessayez dans un instant.' });
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: 'error', message: 'Payload manquant' });
    }

    const payload = JSON.parse(e.postData.contents);
    const action  = payload.action || '';

    if (action === 'import_session') {
      const result = importSessionDepuisTablet(payload);
      return jsonResponse({ status: 'ok', ...result });
    }

    return jsonResponse({ status: 'error', message: 'Action inconnue : ' + action });

  } catch (err) {
    logDiag('doPost', 'ERROR', err.message);
    return jsonResponse({ status: 'error', message: err.message });
  } finally {
    lock.releaseLock();
  }
}

/** Catalogue envoyé à une tablette : produits actifs + stock du point de vente. */
function getCatalogueForTablet(boutique, saison) {
  const sh   = getSheet(SHEET.PRODUITS);
  const data = sh.getDataRange().getValues();
  verifierColonnesProduits(sh, data[0]);
  const c = colsParNom_(sh);

  const produits = [];
  for (let i = 1; i < data.length; i++) {
    const row   = data[i];
    const nom   = String(row[COL_PROD.NOM] || '').trim();
    const actif = row[COL_PROD.ACTIF];
    if (!nom) continue;
    if (actif === false || String(actif).toLowerCase() === 'false' || String(actif).toLowerCase() === 'faux') continue;

    const stockCol = boutique === 'B2' ? COL_PROD.STOCK_B2 : COL_PROD.STOCK_B1;
    produits.push({
      id:         slugify(nom),
      ref:        c.ref_boutique ? String(row[c.ref_boutique - 1] || '') : '',
      nom:        nom,
      categorie:  String(row[COL_PROD.CATEGORIE] || '').trim(),
      prix_vente: Number(row[COL_PROD.PRIX_VENTE]) || 0,
      cout:       Number(row[COL_PROD.COUT]) || 0,
      stock:      Number(row[stockCol]) || 0,
      actif:      true,
    });
  }
  return produits;
}

/**
 * Importe une session envoyée par une tablette :
 *  1. ventes → 01_VENTES (anti-doublon sur la clé commande)
 *  2. stock  → décrément des quantités vendues/offertes (+ mouvements 11_MOUVEMENTS_STOCK)
 *  3. match  → création dans 04_MATCHS si absent
 *  4. 10_SAISONS, analyse, dashboard, synthèse stock
 */
function importSessionDepuisTablet(payload) {
  const session      = payload.session       || {};
  const ventes       = payload.ventes        || [];
  const stockCloture = payload.stock_cloture || [];

  const boutiqueId = String(session.boutique_id || 'B1').trim();
  const matchLabel = String(session.match_label || '').trim();
  const dateMatch  = session.date || dateKey(new Date());
  const dMatch     = toDate(dateMatch) || new Date();
  const saison     = saisonDepuisDate_(dMatch);
  const saisonRecue = String(session.saison || '').trim();
  if (saisonRecue && saisonRecue !== saison) {
    logDiag('doPost', 'WARN', `Saison tablette « ${saisonRecue} » remplacée par « ${saison} » (date ${dateKey(dMatch)}). Corriger le réglage de la tablette.`);
  }

  logDiag('doPost', 'INFO', `Import session : ${matchLabel} | ${boutiqueId} | ${ventes.length} vente(s)`);

  // ── 1. Ventes ────────────────────────────────────────────────
  const shVentes = getSheet(SHEET.VENTES);
  verifierColonnesVentes(shVentes);
  const clesExist = new Set(shVentes.getDataRange().getValues().slice(1).map(r => String(r[COL_VENTE.COMMANDE]).trim()));

  const nouvelles = [];
  const sorties = {};
  for (const v of ventes) {
    const cle = session.id + '_' + (v.id || slugify(v.produit_nom) + '_' + v.timestamp);
    if (clesExist.has(cle)) continue;
    const q = Number(v.quantite) || 1;
    nouvelles.push([
      toDate(v.timestamp) || dMatch, 'tablette', cle, '',
      v.produit_nom || '', v.categorie || '', q,
      Number(v.prix_unitaire) || 0, Number(v.ca_ligne) || 0,
      matchLabel, boutiqueId, saison, v.mode_paiement || '',
    ]);
    clesExist.add(cle);
    const k = slugify(v.produit_nom || v.produit_id);
    sorties[k] = sorties[k] || { nom: v.produit_nom || v.produit_id, vendu: 0, offert: 0 };
    if (/offert/i.test(String(v.mode_paiement || ''))) sorties[k].offert += q; else sorties[k].vendu += q;
  }
  if (nouvelles.length) {
    shVentes.getRange(shVentes.getLastRow() + 1, 1, nouvelles.length, nouvelles[0].length).setValues(nouvelles);
  }

  // ── 2. Stock : décrément des sorties ─────────────────────────
  const shProd   = getSheet(SHEET.PRODUITS);
  const prodData = shProd.getDataRange().getValues();
  const cProd    = colsParNom_(shProd);
  const colStock = boutiqueId === 'B2' ? COL_PROD.STOCK_B2 : COL_PROD.STOCK_B1;
  const idxParSlug = {};
  for (let i = 1; i < prodData.length; i++) {
    const nom = String(prodData[i][COL_PROD.NOM] || '').trim();
    if (nom) idxParSlug[slugify(nom)] = i;
  }
  const attendu = {};
  stockCloture.forEach(sc => { attendu[slugify(sc.produit_nom || sc.produit_id)] = Number(sc.stock_restant); });

  let nbStocksMaj = 0;
  const inconnus = [];
  const ecarts = [];
  Object.keys(sorties).forEach(k => {
    const s = sorties[k];
    const i = idxParSlug[k];
    if (i === undefined) { inconnus.push(s.nom); return; }
    const apres = (Number(prodData[i][colStock]) || 0) - s.vendu - s.offert;
    shProd.getRange(i + 1, colStock + 1).setValue(apres);
    prodData[i][colStock] = apres;
    nbStocksMaj++;

    if (typeof sb_mouvement_ === 'function') {
      const cout = Number(prodData[i][COL_PROD.COUT]) || 0;
      const ref  = cProd.ref_boutique ? String(prodData[i][cProd.ref_boutique - 1] || '') : '';
      const nom  = String(prodData[i][COL_PROD.NOM]);
      if (s.vendu) sb_mouvement_({ type: 'VENTE_COMPTOIR', ref_boutique: ref, produit: nom, point: boutiqueId, quantite: -s.vendu,
        cout_unitaire: cout, valeur: -s.vendu * cout, match: matchLabel, reference: session.id || '', commentaire: 'synchro tablette' });
      if (s.offert) sb_mouvement_({ type: 'OFFERT_CAISSE', ref_boutique: ref, produit: nom, point: boutiqueId, quantite: -s.offert,
        cout_unitaire: cout, valeur: -s.offert * cout, match: matchLabel, reference: session.id || '', commentaire: 'offert saisi en caisse' });
    }
    if (k in attendu && attendu[k] !== apres) ecarts.push(`${s.nom} : tablette ${attendu[k]} / calculé ${apres}`);
  });
  if (inconnus.length) logDiag('doPost', 'WARN', `Produits inconnus dans 03_PRODUITS (stock non mis à jour) : ${inconnus.join(', ')}`);
  if (ecarts.length) logDiag('doPost', 'WARN', `Écarts de stock ${boutiqueId} (ventes web / dotations pendant le match ?) : ${ecarts.join(' · ')}`);

  // ── 3. Match ─────────────────────────────────────────────────
  const shMatchs = getSheet(SHEET.MATCHS);
  const dk = dateKey(dMatch);
  const existe = shMatchs.getDataRange().getValues().slice(1).some(r => dateKey(toDate(r[0])) === dk);
  if (!existe) {
    const parts = matchLabel.split(/ vs /i);
    shMatchs.appendRow([dMatch, session.competition || 'Ligue A', parts.length > 1 ? parts[1].trim() : matchLabel,
      '', 0, 0, `Import tablette ${boutiqueId}`]);
  }

  // ── 4. Recalculs ─────────────────────────────────────────────
  try { reconstruireSaisons();  } catch (e) { logDiag('doPost', 'WARN', 'saisons: ' + e.message); }
  try { analyserProduits();     } catch (e) { logDiag('doPost', 'WARN', 'analyserProduits: ' + e.message); }
  try { mettreAJourDashboard(); } catch (e) { logDiag('doPost', 'WARN', 'dashboard: ' + e.message); }
  if (typeof rafraichirSynthese_ === 'function') {
    try { rafraichirSynthese_(); } catch (e) { logDiag('doPost', 'WARN', 'synthèse stock: ' + e.message); }
  }

  logDiag('doPost', 'INFO', `Session ${matchLabel} importée — ${nouvelles.length} ventes, ${nbStocksMaj} stocks MAJ`);

  return {
    message:         'Session importée avec succès',
    ventes_ajoutees: nouvelles.length,
    stocks_maj:      nbStocksMaj,
    match:           matchLabel,
    date:            dateMatch,
  };
}

// ─────────────────────────────────────────────────────────────
// MULTI-SAISONS (10_SAISONS)
// ─────────────────────────────────────────────────────────────

function initialiserOngletSaisons() {
  const sh = getOrCreateSheet(SHEET.SAISONS);
  const data = sh.getDataRange().getValues();
  if (data.length === 0 || !data[0][0]) {
    sh.clearContents();
    const header = ['saison', 'boutique_id', 'nb_matchs', 'nb_ventes', 'ca_total', 'ca_B1', 'ca_B2', 'derniere_maj'];
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setBackground('#001E2D').setFontColor('#FFFFFF').setFontWeight('bold');
  }
  return sh;
}

/** Recalcule entièrement 10_SAISONS depuis 01_VENTES (hors articles offerts). */
function reconstruireSaisons() {
  const sh = initialiserOngletSaisons();
  const data = getSheet(SHEET.VENTES).getDataRange().getValues().slice(1);
  const agg = {};
  data.forEach(r => {
    if (!r[0]) return;
    const b = String(r[COL_VENTE.BOUTIQUE_ID] || '').trim();
    if (!b) return;
    const s = String(r[COL_VENTE.SAISON] || '').trim() || saisonDepuisDate_(r[0]);
    const k = s + '|' + b;
    const a = agg[k] = agg[k] || { s: s, b: b, matchs: new Set(), nb: 0, ca: 0 };
    a.matchs.add(String(r[COL_VENTE.MATCH_ASSOCIE] || '').trim() || dateKey(toDate(r[0])));
    if (estOffert_(r)) return;
    a.nb += Number(r[COL_VENTE.QUANTITE]) || 1;
    a.ca += caVente_(r);
  });
  const now = new Date();
  const rows = Object.keys(agg).sort().map(k => {
    const a = agg[k];
    return [a.s, a.b, a.matchs.size, a.nb, a.ca, a.b === 'B1' ? a.ca : 0, a.b === 'B2' ? a.ca : 0, now];
  });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 8).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 8).setValues(rows);
    sh.getRange(2, 5, rows.length, 3).setNumberFormat(FORMAT_EUR);
  }
}

/** Recalcule la saison des ventes tablette / en ligne à partir de leur date. */
function corrigerSaisonsVentes() {
  const sh = getSheet(SHEET.VENTES);
  const n = sh.getLastRow() - 1;
  if (n < 1) return '01_VENTES vide : aucune saison à corriger.';
  const v = sh.getRange(2, 1, n, COL_VENTE.SAISON + 1).getValues();
  let nb = 0;
  v.forEach(r => {
    if (!r[COL_VENTE.DATE]) return;
    if (!/tablette|tickie|en_ligne/i.test(String(r[COL_VENTE.SOURCE]))) return;
    const s = saisonDepuisDate_(r[COL_VENTE.DATE]);
    if (s && String(r[COL_VENTE.SAISON]).trim() !== s) { r[COL_VENTE.SAISON] = s; nb++; }
  });
  if (nb) sh.getRange(2, COL_VENTE.SAISON + 1, n, 1).setValues(v.map(r => [r[COL_VENTE.SAISON]]));
  reconstruireSaisons();
  const msg = `${nb} ligne(s) de 01_VENTES : saison corrigée d'après la date.`;
  logDiag('corrigerSaisonsVentes', 'INFO', msg);
  return msg;
}

function corrigerSaisonsMenu() {
  SpreadsheetApp.getActiveSpreadsheet().toast(corrigerSaisonsVentes(), '✅ Saisons', 6);
}

// ─────────────────────────────────────────────────────────────
// MIGRATIONS — vérification des colonnes
// ─────────────────────────────────────────────────────────────

function verifierColonnesProduits(sh, headers) {
  const hasStockB1 = headers.some(h => String(h).trim().toLowerCase() === 'stock_b1');
  const hasStockB2 = headers.some(h => String(h).trim().toLowerCase() === 'stock_b2');
  if (!hasStockB1 || !hasStockB2) {
    for (let c = 0; c < headers.length; c++) {
      if (String(headers[c]).trim().toLowerCase() === 'stock') sh.getRange(1, c + 1).setValue('stock_B1');
    }
    if (!hasStockB2 && headers.length < COL_PROD.STOCK_B2 + 1) sh.getRange(1, COL_PROD.STOCK_B2 + 1).setValue('stock_B2');
  }
}

function verifierColonnesVentes(sh) {
  const data = sh.getDataRange().getValues();
  if (!data.length) return;
  const headers = data[0];
  const has = h => headers.some(x => String(x).trim().toLowerCase() === h);
  if (!has('boutique_id'))   sh.getRange(1, COL_VENTE.BOUTIQUE_ID   + 1).setValue('boutique_id');
  if (!has('saison'))        sh.getRange(1, COL_VENTE.SAISON        + 1).setValue('saison');
  if (!has('mode_paiement')) sh.getRange(1, COL_VENTE.MODE_PAIEMENT + 1).setValue('mode_paiement');
}

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─────────────────────────────────────────────────────────────
// IMPORTS MANUELS
// ─────────────────────────────────────────────────────────────

function importRatio() {
  const shImport = getSheet(SHEET.IMPORT_RATIO);
  const shMatchs = getSheet(SHEET.MATCHS);
  const shVentes = getSheet(SHEET.VENTES);

  const importData = shImport.getDataRange().getValues();
  if (importData.length < 2) { logDiag('importRatio', 'INFO', 'Aucune donnée dans 07_IMPORT_RATIO.'); return; }

  const COL_STATUT = Math.max(importData[0].length, 5);
  const matchsData = shMatchs.getDataRange().getValues();
  const matchsKeys = new Set(matchsData.slice(1).map(r => dateKey(toDate(r[0]))));
  const ventesData = shVentes.getDataRange().getValues().slice(1);

  let nbAjoutes = 0, nbIgnores = 0;
  for (let i = 1; i < importData.length; i++) {
    const row    = importData[i];
    const statut = row[COL_STATUT - 1] ? String(row[COL_STATUT - 1]).trim() : '';
    if (statut === 'traité') { nbIgnores++; continue; }
    if (!row[0]) continue;

    const dateMatch   = toDate(row[0]);
    const competition = String(row[1] || '').trim();
    const clubVis     = String(row[2] || '').trim();
    const nbSpect     = Number(row[3]) || 0;
    const cle         = dateKey(dateMatch);
    if (!cle) { logDiag('importRatio', 'WARN', `Ligne ${i + 1} ignorée : date invalide.`); continue; }

    const caBoutique = ventesData.filter(v => dateKey(toDate(v[0])) === cle).reduce((s, v) => s + caVente_(v), 0);
    const caPar = nbSpect > 0 ? caBoutique / nbSpect : 0;

    if (!matchsKeys.has(cle)) {
      shMatchs.appendRow([dateMatch, competition, clubVis, nbSpect, caBoutique, caPar, '']);
      matchsKeys.add(cle);
      nbAjoutes++;
    } else {
      const rowIdx = matchsData.findIndex(r => dateKey(toDate(r[0])) === cle);
      if (rowIdx > 0) {
        if (!matchsData[rowIdx][3]) shMatchs.getRange(rowIdx + 1, 4).setValue(nbSpect);
        shMatchs.getRange(rowIdx + 1, 5).setValue(caBoutique);
        shMatchs.getRange(rowIdx + 1, 6).setValue(caPar);
      }
      nbIgnores++;
    }
    shImport.getRange(i + 1, COL_STATUT).setValue('traité');
  }

  logDiag('importRatio', 'INFO', `Import Ratio : ${nbAjoutes} ajoutés | ${nbIgnores} déjà présents`);
  SpreadsheetApp.getActiveSpreadsheet().toast(`Import Ratio : ${nbAjoutes} match(s) ajouté(s).`, '✅ Import Ratio', 5);
}

/** 08 (date, numero_piece, libelle, compte, montant_ht, tva, montant_ttc, statut) → 01_VENTES. */
function importPennylaneVentes() {
  const shImport = getSheet(SHEET.IMPORT_PENNY_V);
  const shVentes = getSheet(SHEET.VENTES);

  const importData = shImport.getDataRange().getValues();
  if (importData.length < 2) { logDiag('importPennylaneVentes', 'INFO', 'Aucune donnée.'); return; }

  const COL_STATUT  = importData[0].length;
  const piecesExist = new Set(shVentes.getDataRange().getValues().slice(1).map(r => String(r[COL_VENTE.COMMANDE]).trim()));
  let nbAjoutes = 0, nbIgnores = 0, nbFiltres = 0;

  for (let i = 1; i < importData.length; i++) {
    const row    = importData[i];
    const statut = String(row[COL_STATUT - 1] || '').trim();
    if (statut === 'traité' || statut === 'ignoré') { nbIgnores++; continue; }
    if (!row[0]) continue;

    const compte = String(row[3] || '').trim();
    if (!compte.startsWith('7')) {
      nbFiltres++;
      shImport.getRange(i + 1, COL_STATUT).setValue('ignoré');
      continue;
    }

    const numPiece = String(row[1] || '').trim();
    if (piecesExist.has(numPiece)) {
      nbIgnores++;
      shImport.getRange(i + 1, COL_STATUT).setValue('traité');
      continue;
    }

    const date      = toDate(row[0]);
    const montantTt = Number(row[6]) || Number(row[4]) || 0;
    shVentes.appendRow([
      date, 'pennylane', numPiece, '', String(row[2] || '').trim(), '', 1,
      montantTt, montantTt, '', '', saisonDepuisDate_(date), '',
    ]);
    piecesExist.add(numPiece);
    nbAjoutes++;
    shImport.getRange(i + 1, COL_STATUT).setValue('traité');
  }

  logDiag('importPennylaneVentes', 'INFO', `Pennylane Ventes : ${nbAjoutes} | ${nbIgnores} doublons | ${nbFiltres} filtrées`);
  SpreadsheetApp.getActiveSpreadsheet().toast(`Pennylane Ventes : ${nbAjoutes} ligne(s).`, '✅ Import Pennylane Ventes', 5);
}

/** 08b (date, numero_piece, fournisseur, compte, montant_ht, tva, montant_ttc, statut) → 02_ACHATS (par en-têtes). */
function importPennylaneAchats() {
  const shImport = getSheet(SHEET.IMPORT_PENNY_A);
  const shAchats = getSheet(SHEET.ACHATS);

  const importData = shImport.getDataRange().getValues();
  if (importData.length < 2) { logDiag('importPennylaneAchats', 'INFO', 'Aucune donnée.'); return; }

  const c = colsParNom_(shAchats);
  ['date', 'fournisseur', 'cout_total', 'compte_pennylane', 'reference_pennylane'].forEach(k => {
    if (!c[k]) throw new Error(`Colonne « ${k} » absente de 02_ACHATS.`);
  });
  const n = shAchats.getLastRow() - 1;
  const piecesExist = new Set(n > 0 ? shAchats.getRange(2, c.reference_pennylane, n, 1).getValues().map(r => String(r[0]).trim()) : []);
  const COL_STATUT = importData[0].length;
  let nbAjoutes = 0, nbIgnores = 0;

  for (let i = 1; i < importData.length; i++) {
    const row    = importData[i];
    const statut = String(row[COL_STATUT - 1] || '').trim();
    if (statut === 'traité') { nbIgnores++; continue; }
    if (!row[0]) continue;

    const numPiece = String(row[1] || '').trim();
    if (numPiece && piecesExist.has(numPiece)) {
      nbIgnores++;
      shImport.getRange(i + 1, COL_STATUT).setValue('traité');
      continue;
    }

    const ligne = new Array(shAchats.getLastColumn()).fill('');
    const set = (k, v) => { if (c[k]) ligne[c[k] - 1] = v; };
    set('date', toDate(row[0])); set('fournisseur', String(row[2] || '').trim());
    set('cout_total', Number(row[4]) || 0); set('compte_pennylane', String(row[3] || '').trim());
    set('reference_pennylane', numPiece);
    shAchats.appendRow(ligne);
    piecesExist.add(numPiece);
    nbAjoutes++;
    shImport.getRange(i + 1, COL_STATUT).setValue('traité');
  }

  logDiag('importPennylaneAchats', 'INFO', `Pennylane Achats : ${nbAjoutes} | ${nbIgnores} doublons`);
  SpreadsheetApp.getActiveSpreadsheet().toast(`Pennylane Achats : ${nbAjoutes} ligne(s).`, '✅ Import Pennylane Achats', 5);
}

/**
 * 09_IMPORT_BOUTIQUE (par en-têtes) → 01_VENTES + 05_CLIENTS.
 * Les lignes Tickie (tickie_transaction_id rempli) sont ignorées : le récepteur webhook les a déjà intégrées.
 */
function importBoutiqueLigne() {
  const shImport = getSheet(SHEET.IMPORT_BOUTIQUE);
  const shVentes = getSheet(SHEET.VENTES);
  const shMatchs = getSheet(SHEET.MATCHS);

  if (shImport.getLastRow() < 2) { logDiag('importBoutiqueLigne', 'INFO', 'Aucune donnée.'); return; }
  const colStatut  = assurerColonne_(shImport, 'statut_import');
  const c          = colsParNom_(shImport);
  const importData = shImport.getDataRange().getValues();
  const g = (row, k) => (c[k] ? row[c[k] - 1] : '');

  const piecesExist = new Set(shVentes.getDataRange().getValues().slice(1).map(r => String(r[COL_VENTE.COMMANDE]).trim()));
  const matchsData  = shMatchs.getDataRange().getValues().slice(1);
  let nbAjoutes = 0, nbIgnores = 0, nbClients = 0;

  for (let i = 1; i < importData.length; i++) {
    const row = importData[i];
    if (String(g(row, 'tickie_transaction_id')).trim()) continue;
    if (String(row[colStatut - 1] || '').trim().indexOf('traité') === 0 || String(g(row, 'statut_commande')).trim() === 'traité') { nbIgnores++; continue; }
    if (!g(row, 'date')) continue;

    const numCommande = String(g(row, 'commande') || '').trim();
    if (numCommande && piecesExist.has(numCommande)) {
      nbIgnores++;
      shImport.getRange(i + 1, colStatut).setValue('traité');
      continue;
    }

    const dateCommande = toDate(g(row, 'date'));
    const produit      = String(g(row, 'produit') || '').trim();
    const quantite     = Number(g(row, 'quantite')) || 1;
    const prixUnitaire = Number(g(row, 'prix_unitaire')) || 0;
    const caLigne      = Number(g(row, 'ca')) || quantite * prixUnitaire;
    const email        = String(g(row, 'email') || '').trim().toLowerCase();

    let matchAssocie = '';
    if (dateCommande) {
      const MS_24H = 24 * 3600 * 1000;
      let minDelta = Infinity;
      for (const m of matchsData) {
        const dm = toDate(m[0]);
        if (!dm) continue;
        const delta = Math.abs(dateCommande.getTime() - dm.getTime());
        if (delta <= MS_24H && delta < minDelta) { minDelta = delta; matchAssocie = dateKey(dm) + ' — ' + String(m[2] || '').trim(); }
      }
    }

    shVentes.appendRow([
      dateCommande, 'en_ligne', numCommande, email, produit, String(g(row, 'categorie') || ''),
      quantite, prixUnitaire, caLigne, matchAssocie, 'WEB', saisonDepuisDate_(dateCommande),
      String(g(row, 'mode_paiement') || 'en ligne'),
    ]);
    if (numCommande) piecesExist.add(numCommande);
    nbAjoutes++;
    if (upsertClient_(email, caLigne, dateCommande, 'Boutique en ligne')) nbClients++;
    shImport.getRange(i + 1, colStatut).setValue('traité');
  }

  logDiag('importBoutiqueLigne', 'INFO', `Boutique en ligne : ${nbAjoutes} | ${nbClients} nouveaux clients`);
  SpreadsheetApp.getActiveSpreadsheet().toast(`Boutique en ligne : ${nbAjoutes} ligne(s).`, '✅ Import Boutique', 5);
}

// ─────────────────────────────────────────────────────────────
// ANALYSES
// ─────────────────────────────────────────────────────────────

/** 90_ANALYSE_PRODUITS : CA TTC, coût HT (quantités × coût moyen 03_PRODUITS), marge HT — hors offerts. */
function analyserProduits() {
  const shVentes  = getSheet(SHEET.VENTES);
  const shAnalyse = getSheet(SHEET.ANALYSE_PRODUITS);
  const couts     = coutsProduits_();

  const vMap = {};
  for (const v of shVentes.getDataRange().getValues().slice(1)) {
    const produit = String(v[COL_VENTE.PRODUIT] || '').trim();
    if (!produit || estOffert_(v)) continue;
    const qty = Number(v[COL_VENTE.QUANTITE]) || 1;
    const ca  = Number(v[COL_VENTE.CA]) || qty * (Number(v[COL_VENTE.PRIX_UNITAIRE]) || 0);
    const b   = String(v[COL_VENTE.BOUTIQUE_ID]).trim();
    const m   = vMap[produit] = vMap[produit] || { nb: 0, ca: 0, cout: 0, b1: 0, b2: 0 };
    m.nb += qty;
    m.ca += ca;
    m.cout += qty * (couts[slugify(produit)] || 0);
    if (b === 'B1') m.b1 += ca;
    if (b === 'B2') m.b2 += ca;
  }

  const r2 = x => Math.round(x * 100) / 100;
  const tableau = Object.keys(vMap).map(p => {
    const t = vMap[p];
    const caHT  = t.ca / (1 + TVA_BOUTIQUE);
    const marge = caHT - t.cout;
    return [0, p, t.nb, r2(t.ca), r2(t.cout), r2(marge), caHT > 0 ? Math.round(marge / caHT * 1000) / 10 : 0, r2(t.b1), r2(t.b2)];
  }).sort((a, b) => b[3] - a[3]);
  tableau.forEach((r, i) => { r[0] = i + 1; });

  const header = ['Rang', 'Produit', 'Nb ventes', 'CA TTC (€)', 'Coût HT (€)', 'Marge HT (€)', 'Marge % (sur HT)', 'CA TTC B1', 'CA TTC B2'];
  shAnalyse.clearContents();
  shAnalyse.getRange(1, 1, 1, 9).setValues([header]).setBackground('#001E2D').setFontColor('#FFFFFF').setFontWeight('bold');
  if (tableau.length) {
    shAnalyse.getRange(2, 1, tableau.length, 9).setValues(tableau);
    shAnalyse.getRange(2, 7, tableau.length, 1).setNumberFormat('0.0');
  }

  logDiag('analyserProduits', 'INFO', `${tableau.length} produit(s) analysé(s).`);
  SpreadsheetApp.getActiveSpreadsheet().toast(`Analyse : ${tableau.length} produit(s).`, '✅ Analyse Produits', 5);
}

function calculerCorrelations() {
  const shMatchs = getSheet(SHEET.MATCHS);
  const shVentes = getSheet(SHEET.VENTES);
  const shDash   = getSheet(SHEET.DASHBOARD);

  const matchsData = shMatchs.getDataRange().getValues();
  const ventesData = shVentes.getDataRange().getValues().slice(1);
  if (matchsData.length < 2) return;

  const caParJour = {};
  for (const v of ventesData) {
    const dk = dateKey(toDate(v[0]));
    if (dk) caParJour[dk] = (caParJour[dk] || 0) + caVente_(v);
  }

  const corrTable = [['Date match', 'Compétition', 'Club visiteur', 'Nb spectateurs', 'CA boutique (€)', 'CA/spectateur (€)']];
  for (let i = 1; i < matchsData.length; i++) {
    const row = matchsData[i];
    const dateMatch = toDate(row[0]);
    if (!dateMatch) continue;
    const nbSpect  = Number(row[3]) || 0;
    const caBoutiq = caParJour[dateKey(dateMatch)] || 0;
    const caPar    = nbSpect > 0 ? parseFloat((caBoutiq / nbSpect).toFixed(2)) : 0;
    shMatchs.getRange(i + 1, 5).setValue(caBoutiq);
    shMatchs.getRange(i + 1, 6).setValue(caPar);
    corrTable.push([Utilities.formatDate(dateMatch, Session.getScriptTimeZone(), 'dd/MM/yyyy'),
      String(row[1] || ''), String(row[2] || ''), nbSpect, caBoutiq, caPar]);
  }

  shDash.getRange(10, 1, 50, 6).clearContent();
  shDash.getRange(10, 1, corrTable.length, 6).setValues(corrTable);
  shDash.getRange(10, 1, 1, 6).setBackground('#001E2D').setFontColor('#FFFFFF').setFontWeight('bold');
  if (corrTable.length > 1) shDash.getRange(11, 5, corrTable.length - 1, 2).setNumberFormat(FORMAT_EUR);
  logDiag('calculerCorrelations', 'INFO', `Corrélations : ${matchsData.length - 1} match(s).`);
}

/**
 * 00_DASHBOARD
 *   A2       : horodatage
 *   A4:H6    : KPIs (libellés / valeurs / explications)
 *   A10:F…   : corrélation billetterie / boutique
 *   H9:N15   : top 5 produits
 */
function mettreAJourDashboard() {
  const shDash    = getSheet(SHEET.DASHBOARD);
  const shPaniers = getSheet(SHEET.PANIERS);
  const shAnalyse = getSheet(SHEET.ANALYSE_PRODUITS);

  const lignes  = getSheet(SHEET.VENTES).getDataRange().getValues().slice(1).filter(r => r[0] && !estOffert_(r));
  const somme   = arr => arr.reduce((s, r) => s + caVente_(r), 0);
  const caTotal = somme(lignes);
  const nb      = lignes.length;
  const caB1    = somme(lignes.filter(r => String(r[COL_VENTE.BOUTIQUE_ID]).trim() === 'B1'));
  const caB2    = somme(lignes.filter(r => String(r[COL_VENTE.BOUTIQUE_ID]).trim() === 'B2'));
  const caWeb   = somme(lignes.filter(r => /tickie|en_ligne/i.test(String(r[COL_VENTE.SOURCE]))));

  const analyseData = shAnalyse.getDataRange().getValues().slice(1).filter(r => r[0]);
  const margeBrute  = analyseData.reduce((s, r) => s + (Number(r[5]) || 0), 0);
  const nbAbandonnes = shPaniers.getDataRange().getValues().slice(1)
    .filter(r => String(r[4] || '').trim().toLowerCase() === 'abandonné' && !r[5]).length;

  shDash.getRange('A2:J2').clearContent();
  shDash.getRange('A2').setValue('Mise à jour : ' + Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm'));

  shDash.getRange(4, 1, 3, 8).setValues([
    ['CA total TTC (€)', 'Lignes vendues', 'CA moyen / ligne TTC (€)', 'Marge brute HT (€)', 'CA Grand Public TTC (€)', 'CA VIP TTC (€)', 'CA en ligne TTC (€)', 'Paniers à relancer'],
    [caTotal, nb, nb ? caTotal / nb : 0, margeBrute, caB1, caB2, caWeb, nbAbandonnes],
    ['hors articles offerts', 'lignes payées 01_VENTES', 'CA total / lignes', 'CA HT − coût moyen HT', 'tablette B1', 'tablette B2', 'Tickie + import', '06_PANIERS'],
  ]);
  shDash.getRange(4, 1, 1, 8).setFontWeight('bold');
  shDash.getRange(5, 1, 1, 8).setNumberFormat(FORMAT_EUR).setFontSize(12);
  shDash.getRange(5, 2).setNumberFormat('0');
  shDash.getRange(5, 8).setNumberFormat('0');
  shDash.getRange(6, 1, 1, 8).setFontStyle('italic').setFontColor('#666666');

  // Nettoyage des restes de l'ancienne mise en page (en-tête doublon, top 5 en ligne 25, « 10000 % »)
  shDash.getRange('A9:G9').clearContent();
  shDash.getRange('A21:G40').clearContent();

  calculerCorrelations();

  const top5 = analyseData.sort((a, b) => (Number(b[3]) || 0) - (Number(a[3]) || 0)).slice(0, 5)
    .map((r, i) => [i + 1, r[1], r[3], r[5], (Number(r[6]) || 0) / 100, r[7], r[8]]);
  shDash.getRange('H9:N20').clearContent();
  shDash.getRange('H9').setValue('TOP 5 PRODUITS').setFontWeight('bold');
  shDash.getRange(10, 8, 1, 7).setValues([['Rang', 'Produit', 'CA TTC', 'Marge HT', 'Marge %', 'CA B1', 'CA B2']])
    .setBackground('#001E2D').setFontColor('#FFFFFF').setFontWeight('bold');
  if (top5.length) {
    shDash.getRange(11, 8, top5.length, 7).setValues(top5);
    shDash.getRange(11, 10, top5.length, 2).setNumberFormat(FORMAT_EUR);
    shDash.getRange(11, 12, top5.length, 1).setNumberFormat('0.0%');
    shDash.getRange(11, 13, top5.length, 2).setNumberFormat(FORMAT_EUR);
  }

  logDiag('mettreAJourDashboard', 'INFO', 'Dashboard V3.1 mis à jour.');
  SpreadsheetApp.getActiveSpreadsheet().toast('Dashboard mis à jour.', '✅ Dashboard V3.1', 4);
}

function verifierPaniers() {
  const shPaniers = getSheet(SHEET.PANIERS);
  const data      = shPaniers.getDataRange().getValues();
  if (data.length < 2) return;

  // 06_PANIERS_ABANDONNES : date, email, produit, prix, statut, relance1, relance2, relance3
  const maintenant = new Date();
  const MS_24H = 24 * 3600 * 1000, MS_72H = 72 * 3600 * 1000, MS_168H = 168 * 3600 * 1000;
  const colAction = assurerColonne_(shPaniers, 'action');
  let nbActions = 0;

  for (let i = 1; i < data.length; i++) {
    const row     = data[i];
    const datePan = toDate(row[0]);
    const statut  = String(row[4] || '').trim().toLowerCase();
    if (!datePan || statut !== 'abandonné') continue;

    const ecart = maintenant.getTime() - datePan.getTime();
    let action = '';
    if (!row[5] && ecart > MS_24H)                           action = 'À relancer J+1';
    else if (row[5] && !row[6] && ecart > MS_72H)            action = 'À relancer J+3';
    else if (row[5] && row[6] && !row[7] && ecart > MS_168H) action = 'À relancer J+7';

    if (action) { shPaniers.getRange(i + 1, colAction).setValue(action); nbActions++; }
  }

  logDiag('verifierPaniers', 'INFO', `${nbActions} action(s) de relance.`);
  if (nbActions > 0) SpreadsheetApp.getActiveSpreadsheet().toast(`${nbActions} panier(s) à relancer.`, '⚠️ Paniers abandonnés', 6);
}

// ─────────────────────────────────────────────────────────────
// IMPORT COMPLET
// ─────────────────────────────────────────────────────────────

function lancerImportComplet() {
  const etapes = [
    { nom: 'Import Ratio',             fn: importRatio            },
    { nom: 'Import Pennylane Ventes',  fn: importPennylaneVentes  },
    { nom: 'Import Pennylane Achats',  fn: importPennylaneAchats  },
    { nom: 'Import Boutique en ligne', fn: importBoutiqueLigne    },
    { nom: 'Saisons',                  fn: reconstruireSaisons    },
    { nom: 'Analyse produits',         fn: analyserProduits       },
    { nom: 'Mise à jour dashboard',    fn: mettreAJourDashboard   },
  ];
  if (typeof rafraichirSynthese_ === 'function') etapes.push({ nom: 'Synthèse stock', fn: rafraichirSynthese_ });

  const erreurs = [];
  for (const etape of etapes) {
    try {
      etape.fn();
    } catch (e) {
      logDiag('lancerImportComplet', 'ERROR', `Erreur dans "${etape.nom}" : ${e.message}`);
      erreurs.push(etape.nom);
    }
  }

  const bilan = erreurs.length === 0
    ? '✅ Import complet terminé avec succès.'
    : `⚠️ Import terminé avec erreurs : ${erreurs.join(', ')} (voir 99_DIAGNOSTIC).`;
  SpreadsheetApp.getActiveSpreadsheet().toast(bilan, '🏪 CRM Boutique V3.1', 8);
  logDiag('lancerImportComplet', 'INFO', bilan);
}

// ─────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────

function setupV3() {
  initialiserOngletSaisons();
  const shProd   = getSheet(SHEET.PRODUITS);
  const prodData = shProd.getDataRange().getValues();
  if (prodData.length > 0) verifierColonnesProduits(shProd, prodData[0]);
  verifierColonnesVentes(getSheet(SHEET.VENTES));
  logDiag('setupV3', 'INFO', 'Setup V3 terminé — onglet 10_SAISONS créé, colonnes vérifiées.');
  SpreadsheetApp.getActiveSpreadsheet().toast('Setup V3 OK.', '🚀 Setup V3', 6);
}

// ─────────────────────────────────────────────────────────────
// MENU
// ─────────────────────────────────────────────────────────────

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🏪 CRM Boutique V3')
    .addItem('🔄 Import complet', 'lancerImportComplet')
    .addSeparator()
    .addItem('--- Tablettes PWA ---',          'menuTitre1')
    .addItem('🚀 Setup V3 (1 seule fois)',     'setupV3')
    .addItem('Test connexion tablette',         'testConnexion')
    .addSeparator()
    .addItem('--- Imports manuels ---',         'menuTitre2')
    .addItem('Import Ratio (billetterie)',      'importRatio')
    .addItem('Import Pennylane Ventes',         'importPennylaneVentes')
    .addItem('Import Pennylane Achats',         'importPennylaneAchats')
    .addItem('Import Boutique en ligne',        'importBoutiqueLigne')
    .addSeparator()
    .addItem('--- Analyses ---',                'menuTitre3')
    .addItem('Analyser produits',               'analyserProduits')
    .addItem('Calculer corrélations',           'calculerCorrelations')
    .addItem('Mettre à jour dashboard',         'mettreAJourDashboard')
    .addSeparator()
    .addItem('--- Maintenance ---',             'menuTitre4')
    .addItem('Vérifier paniers abandonnés',     'verifierPaniers')
    .addItem('Corriger les saisons (01_VENTES)', 'corrigerSaisonsMenu')
    .addItem('Reconstruire 10_SAISONS',         'reconstruireSaisons')
    .addToUi();

  if (typeof menuStockBoutique_ === 'function') menuStockBoutique_();
  if (typeof menuDriveBoutique_ === 'function') menuDriveBoutique_();
  if (typeof organiserClasseur === 'function') {
    ui.createMenu('📖 Classeur')
      .addItem('Réorganiser (sommaire, tableau de bord, recherche)', 'organiserClasseur')
      .addToUi();
  }
}

function testConnexion() {
  SpreadsheetApp.getActiveSpreadsheet().toast('API V3.1 opérationnelle — doGet et doPost déployés.', '✅ Connexion OK', 5);
}

function menuTitre1() {}
function menuTitre2() {}
function menuTitre3() {}
function menuTitre4() {}