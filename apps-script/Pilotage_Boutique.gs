// ═══════════════════════════════════════════════════════════════════════════
// PILOTAGE BOUTIQUE — projet Apps Script SÉPARÉ (comme Tickie_Receiver)
// Ne touche ni à CRM_Boutique_V3.gs ni à Stock_Boutique.gs : ses doGet/doPost
// sont ceux de ce projet uniquement. Écrit dans le classeur « SPACERS — CRM Boutique ».
//
// Billetterie : Tickie (plateforme Vivenu, API https://vivenu.com/api).
//
// Flux jour de match :
//  1. Tableau de bord (pilotage.html) : choix du match Tickie → « match actif ».
//  2. Tablette en wifi : action=tablette → match + billets valides
//     (code-barres, id billet, tarif — ni nom ni email) pour scanner hors ligne.
//  3. Chaque vente part au fil de l'eau (file d'attente si hors ligne) :
//     action=ventes, idempotent → 20_VENTES_LIVE + 21_LIGNES_LIVE.
//  4. Déclencheur toutes les 10 min : billet scanné → acheteur Tickie
//     (id client, email, nom) dans 20_VENTES_LIVE, puis fiche 23_CLIENTS_BOUTIQUE.
//
// La synchronisation de fin de match vers 01_VENTES (stock, Pennylane) reste
// celle de CRM_Boutique_V3 : ce module ne sert qu'au pilotage et au lien acheteur.
//
// Propriétés du script : CRM_BOUTIQUE_ID (id du classeur), VIVENU_API_KEY,
// PILOTAGE_TOKEN (créé par installerPilotage). Le tableau de bord ne reçoit que des totaux.
// ═══════════════════════════════════════════════════════════════════════════

const PB = {
  CRM_ID_PAR_DEFAUT: '1mE9gSCtetFgnWEt0kA6cS2lcgJDe7oPRLDiXdGhH2EQ',  // à vérifier : le nom du classeur s'affiche à l'installation
  VIVENU_BASE: 'https://vivenu.com/api',
  PORTIER_BASE: 'https://portier.vivenu.com/api',
  ABONNEMENT_EVENT_ID: '69fc9d2b69a5578199f9d5e9',   // « Abonnement 2026-2027 » dans Tickie
  SH_LIVE: '20_VENTES_LIVE',
  SH_LIGNES: '21_LIGNES_LIVE',
  SH_TAB: '22_TABLETTES',
  SH_CLIENTS: '23_CLIENTS_BOUTIQUE',
  BOUTIQUES: { B1: 'Grand Public', B2: 'VIP' },
  NAVY: '#000037', GOLD: '#FFDC00',
};
const PB_LIVE_COLS = ['Reçu le', 'Horodatage', 'ID vente', 'ID événement Tickie', 'Match', 'Boutique', 'Session',
  'Bénévole', 'Mode', 'Total €', 'Articles', 'Détail', 'ID billet', 'Code-barres', 'Tarif billet',
  'Client Tickie', 'Email acheteur', 'Nom acheteur', 'Lien acheteur'];
const PB_I = {}; PB_LIVE_COLS.forEach(function (c, i) { PB_I[c] = i; });
const PB_NB = PB_LIVE_COLS.length;
const PB_LIGNES_COLS = ['ID vente', 'Horodatage', 'ID événement Tickie', 'Boutique', 'Réf.', 'Produit', 'Catégorie', 'Qté', 'PU TTC', 'CA TTC', 'Mode'];
const PB_CLIENTS_COLS = ['Email', 'Nom', 'Client Tickie', 'Achats', 'Articles', 'CA TTC', 'Premier achat', 'Dernier achat', 'Matchs', 'Tarifs', 'Mis à jour'];

// ── Installation (à lancer une fois depuis l'éditeur : ▶ installerPilotage) ──
function installerPilotage() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CRM_BOUTIQUE_ID')) props.setProperty('CRM_BOUTIQUE_ID', PB.CRM_ID_PAR_DEFAUT);
  const ss = pbSS_();
  const mk = function (name, head) {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, head.length).setValues([head]).setBackground(PB.NAVY).setFontColor(PB.GOLD).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    return sh;
  };
  mk(PB.SH_LIVE, PB_LIVE_COLS);
  mk(PB.SH_LIGNES, PB_LIGNES_COLS);
  mk(PB.SH_TAB, ['Boutique', 'Match', 'Dernier chargement', 'Dernière remontée']);
  mk(PB.SH_CLIENTS, PB_CLIENTS_COLS);
  if (!props.getProperty('PILOTAGE_TOKEN')) props.setProperty('PILOTAGE_TOKEN', Utilities.getUuid().replace(/-/g, '').slice(0, 20));
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'relierAcheteurs') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('relierAcheteurs').timeBased().everyMinutes(10).create();
  afficherJeton();
}

function afficherJeton() {
  const p = PropertiesService.getScriptProperties();
  Logger.log('Classeur : ' + pbSS_().getName() + '\nJeton de pilotage : ' + (p.getProperty('PILOTAGE_TOKEN') || '(lancer installerPilotage)') +
    '\nClé API Tickie (VIVENU_API_KEY) : ' + (p.getProperty('VIVENU_API_KEY') ? 'renseignée' : 'MANQUANTE (Paramètres du projet → Propriétés du script)'));
}

// ── Utilitaires ──────────────────────────────────────────────────────────
function pbSS_() {
  const id = PropertiesService.getScriptProperties().getProperty('CRM_BOUTIQUE_ID') || PB.CRM_ID_PAR_DEFAUT;
  return SpreadsheetApp.openById(id);
}
function pbSheet_(n) { return pbSS_().getSheetByName(n); }
function pbJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function pbTokenOk_(t) { const ref = PropertiesService.getScriptProperties().getProperty('PILOTAGE_TOKEN'); return !!ref && t === ref; }
function pbTz_() { return 'Europe/Paris'; }
function pbDate_(d) { return Utilities.formatDate(new Date(d), pbTz_(), 'yyyy-MM-dd'); }
function pbNum_(v) { const n = Number(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; }

// ── Points d'entrée ──────────────────────────────────────────────────────
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'ping') return pbJson_({ status: 'ok', app: 'boutique-pilotage' });
  if (!pbTokenOk_(p.token)) return pbJson_({ status: 'error', message: 'Jeton refusé' });
  try {
    if (p.action === 'events') return pbJson_({ status: 'ok', events: pbMatchsTickie_(), actif: pbActif_() });
    if (p.action === 'dashboard') return pbJson_(Object.assign({ status: 'ok' }, pbDashboard_(p.eventId)));
    if (p.action === 'tablette') return pbJson_(Object.assign({ status: 'ok' }, pbChargerTablette_(p.boutique)));
    return pbJson_({ status: 'error', message: 'Action inconnue' });
  } catch (err) { return pbJson_({ status: 'error', message: String(err && err.message || err) }); }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (x) { return pbJson_({ status: 'error', message: 'JSON invalide' }); }
  if (!pbTokenOk_(body.token)) return pbJson_({ status: 'error', message: 'Jeton refusé' });
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    if (body.action === 'ventes') {
      const recus = pbEnregistrerVentes_(body.ventes || [], body.boutique || '');
      if (body.boutique) pbJournal_(body.boutique, null, 4);
      return pbJson_({ status: 'ok', recus: recus });
    }
    if (body.action === 'actif') return pbJson_(Object.assign({ status: 'ok' }, pbDefinirActif_(body.eventId)));
    return pbJson_({ status: 'error', message: 'Action inconnue' });
  } catch (err) { return pbJson_({ status: 'error', message: String(err && err.message || err) });
  } finally { lock.releaseLock(); }
}

// ── API Tickie (Vivenu) ──────────────────────────────────────────────────
function pbApi_(base, path, query) {
  const key = PropertiesService.getScriptProperties().getProperty('VIVENU_API_KEY');
  if (!key) throw new Error('Clé API Tickie manquante (propriété VIVENU_API_KEY)');
  const qs = Object.keys(query || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&');
  const r = UrlFetchApp.fetch(base + path + (qs ? '?' + qs : ''), { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('Tickie ' + r.getResponseCode() + ' sur ' + path);
  return JSON.parse(r.getContentText());
}
function pbCache_(key, ttl, fn) {
  const c = CacheService.getScriptCache(), hit = c.get(key);
  if (hit) return JSON.parse(hit);
  const v = fn();
  try { c.put(key, JSON.stringify(v), ttl); } catch (e) {}   // > 100 Ko : pas de cache, recalcul
  return v;
}
function pbMatchsTickie_() {
  return pbCache_('pb_events', 600, function () {
    const res = pbApi_(PB.VIVENU_BASE, '/events', { top: 100 });
    return (res.rows || res.docs || []).filter(function (ev) { return ev._id !== PB.ABONNEMENT_EVENT_ID; })
      .map(function (ev) { return { id: ev._id, nom: ev.name, date: ev.start, dateMatch: pbDate_(ev.start), jauge: ev.maxAmount || null }; })
      .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  });
}
function pbEvent_(eventId) { return pbMatchsTickie_().filter(function (x) { return x.id === eventId; })[0] || null; }
function pbParcourirBillets_(eventId, fn) {
  let skip = 0;
  while (true) {
    const res = pbApi_(PB.VIVENU_BASE, '/tickets', { event: eventId, status: 'VALID', top: 1000, skip: skip });
    const rows = res.rows || [];
    rows.forEach(function (t) { if (!t.status || t.status === 'VALID') fn(t); });
    skip += rows.length;
    if (!rows.length || skip >= (res.total || 0)) break;
  }
}
function pbCompterBillets_(eventId, ttl) {
  return pbCache_('pb_billets_' + eventId, ttl, function () {
    const o = { total: 0, payants: 0, invitations: 0, parTarif: {} };
    pbParcourirBillets_(eventId, function (t) {
      o.total++;
      if ((t.realPrice || 0) > 0) o.payants++;
      if (/invitation/i.test(t.ticketName || '')) o.invitations++;
      o.parTarif[t.ticketName || 'Autre'] = (o.parTarif[t.ticketName || 'Autre'] || 0) + 1;
    });
    return o;
  });
}
function pbListerBillets_(eventId) {   // [code-barres, id billet, tarif] — ni nom ni email
  const out = [];
  pbParcourirBillets_(eventId, function (t) { if (t.barcode) out.push([t.barcode, t._id, t.ticketName || '']); });
  return out;
}
function pbCompterEntrees_(eventId) {   // null si le contrôle d'accès n'est pas accessible
  try {
    return pbCache_('pb_entrees_' + eventId, 60, function () {
      const vus = {}; let skip = 0;
      while (true) {
        const res = pbApi_(PB.PORTIER_BASE, '/scans', { eventId: eventId, top: 1000, skip: skip });
        const rows = res.rows || res.docs || [];
        rows.forEach(function (s) {
          if (s.scanResult && s.scanResult !== 'approved') return;
          if (s.type === 'checkout') delete vus[s.ticketId || s.barcode]; else vus[s.ticketId || s.barcode] = 1;
        });
        skip += rows.length;
        if (!rows.length || skip >= (res.total || 0)) break;
      }
      return Object.keys(vus).length;
    });
  } catch (e) { return null; }
}

// ── Match actif des tablettes ────────────────────────────────────────────
function pbActif_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('PB_MATCH_ACTIF') || 'null'); } catch (e) { return null; } }
function pbDefinirActif_(eventId) {
  const ev = pbEvent_(eventId);
  if (!ev) throw new Error('Match introuvable dans Tickie');
  const a = { eventId: ev.id, nom: ev.nom, date: ev.date, dateMatch: ev.dateMatch, saved: new Date().toISOString() };
  PropertiesService.getScriptProperties().setProperty('PB_MATCH_ACTIF', JSON.stringify(a));
  return { actif: a, tablettes: pbLireJournal_() };
}

// Ce que la tablette emporte en boutique pour scanner hors ligne
function pbChargerTablette_(boutique) {
  if (!PB.BOUTIQUES[boutique]) throw new Error('Boutique inconnue (B1 ou B2)');
  const a = pbActif_();
  if (!a) throw new Error('Aucun match actif : choisis le match dans le tableau de bord');
  let billets = [], billetsOk = true;
  try { billets = pbListerBillets_(a.eventId).concat(pbListerBillets_(PB.ABONNEMENT_EVENT_ID)); } catch (e) { billetsOk = false; }
  pbJournal_(boutique, a.nom, 3);
  return { match: a, boutique: boutique, billets: billets, billetsOk: billetsOk, charge: new Date().toISOString() };
}

// ── Réception des ventes (idempotent sur l'ID vente) ─────────────────────
function pbEnregistrerVentes_(ventes, boutique) {
  const sh = pbSheet_(PB.SH_LIVE), shL = pbSheet_(PB.SH_LIGNES);
  if (!sh || !shL) throw new Error('Pilotage non installé (lancer installerPilotage)');
  const last = sh.getLastRow(), deja = {};
  if (last > 1) sh.getRange(2, PB_I['ID vente'] + 1, last - 1, 1).getValues().forEach(function (r) { deja[String(r[0])] = 1; });
  const rows = [], lignes = [], recus = [], now = new Date();
  ventes.forEach(function (v) {
    if (!v || !v.id) return;
    recus.push(v.id);
    if (deja[String(v.id)]) return;
    deja[String(v.id)] = 1;
    const t = v.ticket || {}, ts = new Date(v.ts || Date.now()), b = v.boutique || boutique || '';
    const ls = (v.lignes || []).filter(function (l) { return l && pbNum_(l.qte) > 0; });
    const nbArt = ls.reduce(function (s, l) { return s + pbNum_(l.qte); }, 0);
    rows.push([now, ts, v.id, v.eventId || '', v.match || '', b, v.session || '', v.benevole || '', v.mode || '',
      pbNum_(v.total), nbArt, ls.map(function (l) { return l.nom + ' ×' + l.qte; }).join(' · '),
      t.ticket_id || '', t.barcode || '', t.tarif || '', '', '', '', '']);
    ls.forEach(function (l) {
      const q = pbNum_(l.qte), pu = pbNum_(l.pu);
      lignes.push([v.id, ts, v.eventId || '', b, l.ref || '', l.nom || '', l.cat || '', q, pu, q * pu, v.mode || '']);
    });
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, PB_NB).setValues(rows);
  if (lignes.length) shL.getRange(shL.getLastRow() + 1, 1, lignes.length, PB_LIGNES_COLS.length).setValues(lignes);
  return recus;
}

function pbJournal_(boutique, match, col) {
  const sh = pbSheet_(PB.SH_TAB);
  if (!sh) return;
  const data = sh.getDataRange().getValues();
  let r = data.findIndex(function (row, i) { return i > 0 && row[0] === boutique; });
  if (r < 0) { sh.appendRow([boutique, '', '', '']); r = sh.getLastRow() - 1; }
  if (match) sh.getRange(r + 1, 2).setValue(match);
  sh.getRange(r + 1, col).setValue(new Date());
}
function pbLireJournal_() {
  const sh = pbSheet_(PB.SH_TAB), out = {};
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
    out[r[0]] = { match: r[1], chargement: r[2] || null, remontee: r[3] || null };
  });
  return out;
}

// ── Tableau de bord (totaux uniquement) ──────────────────────────────────
function pbFamilleTarif_(tarif, code) {
  if (!tarif) return code ? 'Billet à vérifier' : 'Sans billet';
  if (/abonn|commandant|pilote|spationaute/i.test(tarif)) return 'Abonné';
  if (/invitation|gratuit|licenci/i.test(tarif)) return 'Invité / gratuit';
  return 'Billet payant';
}

function pbDashboard_(eventId) {
  const ev = pbEvent_(eventId);
  let billetterie = null;
  if (ev) {
    const b = pbCompterBillets_(ev.id, 120);
    let abonnes = null;
    try { abonnes = pbCompterBillets_(PB.ABONNEMENT_EVENT_ID, 3600).total; } catch (e) {}
    billetterie = { billets: b.total, payants: b.payants, invitations: b.invitations, parTarif: b.parTarif,
      abonnes: abonnes, entrees: pbCompterEntrees_(ev.id), jauge: ev.jauge };
  }
  const appartient = function (evId, ts) { return evId ? String(evId) === eventId : (ev && pbDate_(ts) === ev.dateMatch); };

  const sh = pbSheet_(PB.SH_LIVE);
  const data = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, PB_NB).getValues() : [];
  const rows = data.filter(function (r) { return appartient(r[PB_I['ID événement Tickie']], r[PB_I['Horodatage']]); });

  const bq = { ca: 0, ventes: 0, articles: 0, offerts: { ventes: 0, valeur: 0 }, parMode: {}, parBoutique: {}, parQuartHeure: {},
    reliees: { ventes: 0, ca: 0 }, acheteurs: 0, parFamilleTarif: {} };
  Object.keys(PB.BOUTIQUES).forEach(function (k) { bq.parBoutique[k] = { nom: PB.BOUTIQUES[k], ca: 0, ventes: 0, articles: 0 }; });
  const acheteurs = {};
  rows.forEach(function (r) {
    const tot = pbNum_(r[PB_I['Total €']]), mode = String(r[PB_I['Mode']] || ''), b = r[PB_I['Boutique']] || '?';
    if (mode === 'Offert') { bq.offerts.ventes++; bq.offerts.valeur += tot; return; }   // « Offert » neutralisé : hors CA
    bq.ca += tot; bq.ventes++; bq.articles += pbNum_(r[PB_I['Articles']]);
    bq.parMode[mode] = (bq.parMode[mode] || 0) + tot;
    bq.parBoutique[b] = bq.parBoutique[b] || { nom: b, ca: 0, ventes: 0, articles: 0 };
    bq.parBoutique[b].ca += tot; bq.parBoutique[b].ventes++; bq.parBoutique[b].articles += pbNum_(r[PB_I['Articles']]);
    const d = new Date(r[PB_I['Horodatage']]);
    const q = Utilities.formatDate(new Date(Math.floor(d.getTime() / 900000) * 900000), pbTz_(), 'HH:mm');
    bq.parQuartHeure[q] = (bq.parQuartHeure[q] || 0) + tot;
    const fam = pbFamilleTarif_(r[PB_I['Tarif billet']], r[PB_I['Code-barres']]);
    bq.parFamilleTarif[fam] = bq.parFamilleTarif[fam] || { ventes: 0, ca: 0 };
    bq.parFamilleTarif[fam].ventes++; bq.parFamilleTarif[fam].ca += tot;
    if (r[PB_I['ID billet']] || r[PB_I['Code-barres']]) { bq.reliees.ventes++; bq.reliees.ca += tot; }
    const cle = r[PB_I['Client Tickie']] || r[PB_I['Email acheteur']];
    if (cle) acheteurs[cle] = 1;
  });
  bq.acheteurs = Object.keys(acheteurs).length;

  // Produits : 21_LIGNES_LIVE
  const shL = pbSheet_(PB.SH_LIGNES), parProduit = {};
  if (shL && shL.getLastRow() > 1) shL.getRange(2, 1, shL.getLastRow() - 1, PB_LIGNES_COLS.length).getValues().forEach(function (l) {
    if (!appartient(l[2], l[1]) || l[10] === 'Offert') return;
    const k = l[5] || l[4];
    parProduit[k] = parProduit[k] || { qte: 0, ca: 0, cat: l[6] || '' };
    parProduit[k].qte += pbNum_(l[7]); parProduit[k].ca += pbNum_(l[9]);
  });

  return { event: ev, actif: pbActif_(), billetterie: billetterie, boutique: bq, produits: parProduit,
    tablettes: pbLireJournal_(), maj: new Date().toISOString() };
}

// ── Billets scannés → acheteur Tickie (déclencheur 10 min) ───────────────
function relierAcheteurs() {
  const sh = pbSheet_(PB.SH_LIVE);
  if (!sh || sh.getLastRow() < 2) return;
  const rg = sh.getRange(2, 1, sh.getLastRow() - 1, PB_NB);
  const data = rg.getValues(), memo = {}, debut = Date.now();
  let relies = 0;
  data.forEach(function (r) {
    if (Date.now() - debut > 270000) return;               // marge sous la limite d'exécution
    const id = r[PB_I['ID billet']], code = r[PB_I['Code-barres']];
    if ((!id && !code) || r[PB_I['Lien acheteur']]) return;
    const key = id || ('bc:' + code);
    if (!(key in memo)) {
      try {
        let t = null;
        if (id) t = pbApi_(PB.VIVENU_BASE, '/tickets/' + id, {});
        else { const res = pbApi_(PB.VIVENU_BASE, '/tickets', { barcode: code, top: 5 }); t = (res.rows || []).filter(function (x) { return x.barcode === code; })[0] || null; }
        memo[key] = t ? { customerId: t.customerId || '', email: String(t.email || '').toLowerCase().trim(),
          nom: [t.firstname, t.lastname].filter(Boolean).join(' '), tarif: t.ticketName || '', id: t._id } : null;
      } catch (e) { memo[key] = undefined; }
    }
    const c = memo[key];
    if (c === undefined) return;                            // erreur réseau : on réessaiera
    if (c === null) { r[PB_I['Lien acheteur']] = 'billet introuvable'; return; }
    r[PB_I['Client Tickie']] = c.customerId;
    r[PB_I['Email acheteur']] = c.email;
    r[PB_I['Nom acheteur']] = c.nom;
    if (!r[PB_I['ID billet']]) r[PB_I['ID billet']] = c.id;
    if (!r[PB_I['Tarif billet']]) r[PB_I['Tarif billet']] = c.tarif;
    r[PB_I['Lien acheteur']] = 'relié';
    relies++;
  });
  rg.setValues(data);
  if (relies) majClientsBoutique();
}

// 23_CLIENTS_BOUTIQUE : une ligne par acheteur identifié (hors « Offert »)
function majClientsBoutique() {
  const sh = pbSheet_(PB.SH_LIVE), out = pbSheet_(PB.SH_CLIENTS);
  if (!sh || !out || sh.getLastRow() < 2) return;
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, PB_NB).getValues(), cl = {};
  data.forEach(function (r) {
    const email = r[PB_I['Email acheteur']], cid = r[PB_I['Client Tickie']];
    if ((!email && !cid) || r[PB_I['Mode']] === 'Offert') return;
    const k = email || cid, ts = new Date(r[PB_I['Horodatage']]);
    const c = cl[k] = cl[k] || { email: email, nom: r[PB_I['Nom acheteur']], cid: cid, achats: 0, articles: 0, ca: 0, premier: ts, dernier: ts, matchs: {}, tarifs: {} };
    c.achats++; c.articles += pbNum_(r[PB_I['Articles']]); c.ca += pbNum_(r[PB_I['Total €']]);
    if (ts < c.premier) c.premier = ts;
    if (ts > c.dernier) c.dernier = ts;
    if (r[PB_I['Match']]) c.matchs[r[PB_I['Match']]] = 1;
    if (r[PB_I['Tarif billet']]) c.tarifs[r[PB_I['Tarif billet']]] = 1;
  });
  const now = new Date();
  const rows = Object.keys(cl).map(function (k) { const c = cl[k];
    return [c.email || '', c.nom || '', c.cid || '', c.achats, c.articles, Math.round(c.ca * 100) / 100, c.premier, c.dernier,
      Object.keys(c.matchs).length, Object.keys(c.tarifs).join(', '), now]; })
    .sort(function (a, b) { return b[5] - a[5]; });
  if (out.getLastRow() > 1) out.getRange(2, 1, out.getLastRow() - 1, PB_CLIENTS_COLS.length).clearContent();
  if (rows.length) out.getRange(2, 1, rows.length, PB_CLIENTS_COLS.length).setValues(rows);
}
