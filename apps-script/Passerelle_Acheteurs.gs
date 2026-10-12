// ═══════════════════════════════════════════════════════════════════════════
// PASSERELLE ACHETEURS — fichier AUTONOME : fonctionne dans le projet du classeur
// (App_Boutique) comme dans le projet « Pilotage Boutique ». Il ne dépend d'aucune
// fonction des autres fichiers ; toutes ses fonctions sont préfixées pa / PA.
//
// 1. 01_VENTES (CRM Boutique) : chaque ligne vendue en tablette reçoit l'acheteur
//    et le billet scanné (ID vente, client Tickie, email, nom, ID billet,
//    code-barres, tarif, profil). Colonnes ajoutées à droite, écrites par en-têtes :
//    la synchro de fin de match (CRM_Boutique_V3) n'est pas modifiée.
//    Rapprochement 01_VENTES ↔ 21_LIGNES_LIVE : même session de caisse, même produit,
//    même quantité, même CA, horodatage à ±3 min. Chaque ligne live ne sert qu'une fois.
//
// 2. CRM Billetterie : onglet BOUTIQUE_COMMANDES, une ligne par article vendu
//    (acheteur, billet, profil, match, produit, montant), reconstruit à chaque passage.
//    Pendant de BUVETTE_COMMANDES pour la buvette.
//
// Déclenchement : déclencheur horaire posé par installerPasserelle ; en plus, si ce
// fichier est dans le projet Pilotage, relierAcheteurs l'appelle dès qu'un billet est
// relié. Relançable à la main : ▶ passerelleAcheteurs.
//
// Propriété du script (facultative) : CRM_BILLETTERIE_ID — id du classeur
// « CRM_Billetterie_Spacers ». Par défaut : PA.BILLETTERIE_ID_PAR_DEFAUT.
// ═══════════════════════════════════════════════════════════════════════════

const PA = {
  BOUTIQUE_ID_PAR_DEFAUT: '1mE9gSCtetFgnWEt0kA6cS2lcgJDe7oPRLDiXdGhH2EQ',
  BILLETTERIE_ID_PAR_DEFAUT: '1aYRgYcKqQ17xGz4t52_rJlBS5DZq0SHwZdopxNHE10Q',
  SH_LIVE: '20_VENTES_LIVE',
  SH_LIGNES: '21_LIGNES_LIVE',
  NAVY: '#001E2D',
  SH_VENTES: '01_VENTES',
  SH_BILLETTERIE: 'BOUTIQUE_COMMANDES',
  SH_MATCHES: '🏆 MATCHES',
  TOLERANCE_MS: 3 * 60 * 1000,
};

// Colonnes ajoutées à 01_VENTES (créées si absentes, à droite des existantes)
const PA_COLS_VENTES = ['ID vente', 'Client Tickie', 'Email acheteur', 'Nom acheteur',
  'ID billet', 'Code-barres', 'Tarif billet', 'Profil acheteur'];

// Onglet BOUTIQUE_COMMANDES du CRM Billetterie
const PA_COLS_BILLETTERIE = ['ID vente', 'Date', 'Heure', 'ID_MATCH', 'Match', 'Boutique', 'Email', 'Nom',
  'Client Tickie', 'ID billet', 'Code-barres', 'Tarif billet', 'Profil', 'Réf.', 'Produit', 'Catégorie',
  'Qté', 'PU TTC €', 'CA TTC €', 'Paiement', 'Statut', 'Synchronisé le'];

// ── Installation (une fois : ▶ installerPasserelle) ──────────────────────
function installerPasserelle() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CRM_BILLETTERIE_ID')) props.setProperty('CRM_BILLETTERIE_ID', PA.BILLETTERIE_ID_PAR_DEFAUT);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'passerelleAcheteurs') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('passerelleAcheteurs').timeBased().everyHours(1).create();
  Logger.log('CRM Boutique : ' + paBoutiqueSS_().getName() + '\nCRM Billetterie : ' + paBilletterieSS_().getName());
  Logger.log(passerelleAcheteurs());
}

// Classeur CRM Boutique : celui du projet s'il est lié au classeur, sinon par identifiant
function paBoutiqueSS_() {
  const id = PropertiesService.getScriptProperties().getProperty('CRM_BOUTIQUE_ID');
  if (id) return SpreadsheetApp.openById(id);
  const actif = SpreadsheetApp.getActiveSpreadsheet();
  return actif || SpreadsheetApp.openById(PA.BOUTIQUE_ID_PAR_DEFAUT);
}
function paSheet_(nom) { return paBoutiqueSS_().getSheetByName(nom); }
function paNum_(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v == null ? '' : v).replace(/[\s\u00a0€]/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
function paFamilleTarif_(tarif, code) {
  if (!tarif) return code ? 'Billet à vérifier' : 'Sans billet';
  if (/abonn|commandant|pilote|spationaute/i.test(tarif)) return 'Abonné';
  if (/invitation|gratuit|licenci/i.test(tarif)) return 'Invité / gratuit';
  return 'Billet payant';
}

function paBilletterieSS_() {
  const id = PropertiesService.getScriptProperties().getProperty('CRM_BILLETTERIE_ID') || PA.BILLETTERIE_ID_PAR_DEFAUT;
  return SpreadsheetApp.openById(id);
}

// ── Point d'entrée ───────────────────────────────────────────────────────
function passerelleAcheteurs() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'Passerelle déjà en cours : rien fait.';
  try {
    const live = paLireLive_();
    const n01 = paEnrichirVentes_(live);
    const nBil = paPousserBilletterie_(live);
    const msg = '01_VENTES : ' + n01 + ' ligne(s) complétée(s) · BOUTIQUE_COMMANDES : ' + nBil + ' ligne(s).';
    Logger.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

// ── Lecture de 20_VENTES_LIVE + 21_LIGNES_LIVE ───────────────────────────
// Renvoie { ventes: {idVente: {...}}, lignes: [{...}] }
function paLireLive_() {
  const sh = paSheet_(PA.SH_LIVE), shL = paSheet_(PA.SH_LIGNES);
  const ventes = {}, lignes = [];
  if (sh && sh.getLastRow() > 1) {
    const d = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    const h = paIndexEntetes_(d[0]);
    const g = function (r, nom) { const i = h[paNorm_(nom)]; return i === undefined ? '' : r[i]; };
    d.slice(1).forEach(function (r) {
      const id = String(g(r, 'ID vente') || '').trim();
      if (!id) return;
      const tarif = String(g(r, 'Tarif billet') || ''), code = String(g(r, 'Code-barres') || '');
      ventes[id] = {
        id: id, ts: paDate_(g(r, 'Horodatage')), eventId: String(g(r, 'ID événement Tickie') || ''),
        match: String(g(r, 'Match') || ''), boutique: String(g(r, 'Boutique') || ''),
        session: String(g(r, 'Session') || ''), mode: String(g(r, 'Mode') || ''),
        idBillet: String(g(r, 'ID billet') || ''), code: code, tarif: tarif,
        client: String(g(r, 'Client Tickie') || ''),
        email: String(g(r, 'Email acheteur') || '').toLowerCase().trim(),
        nom: String(g(r, 'Nom acheteur') || ''),
        profil: (tarif || code) ? paFamilleTarif_(tarif, code) : '',
      };
    });
  }
  if (shL && shL.getLastRow() > 1) {
    const d = shL.getRange(1, 1, shL.getLastRow(), shL.getLastColumn()).getValues();
    const h = paIndexEntetes_(d[0]);
    const g = function (r, nom) { const i = h[paNorm_(nom)]; return i === undefined ? '' : r[i]; };
    d.slice(1).forEach(function (l) {
      const id = String(g(l, 'ID vente') || '').trim();
      if (!id || !ventes[id]) return;
      lignes.push({
        idVente: id, ts: paDate_(g(l, 'Horodatage')), ref: String(g(l, 'Réf.') || ''),
        produit: String(g(l, 'Produit') || ''), cat: String(g(l, 'Catégorie') || ''),
        qte: paNum_(g(l, 'Qté')), pu: paNum_(g(l, 'PU TTC')), ca: paNum_(g(l, 'CA TTC')),
        mode: String(g(l, 'Mode') || ventes[id].mode),
      });
    });
  }
  return { ventes: ventes, lignes: lignes };
}

// ── 1. 01_VENTES : acheteur et billet sur chaque ligne tablette ──────────
function paEnrichirVentes_(live) {
  const sh = paSheet_(PA.SH_VENTES);
  if (!sh || sh.getLastRow() < 2) return 0;

  const cols = paAssurerColonnes_(sh, PA_COLS_VENTES);            // {nom: n° colonne 1-based}
  const nbCol = sh.getLastColumn();
  const data = sh.getRange(1, 1, sh.getLastRow(), nbCol).getValues();
  const h = paIndexEntetes_(data[0]);
  const ic = function (nom) { return h[paNorm_(nom)]; };
  const iSource = ic('source'), iCmd = ic('commande'), iEmail = ic('email'), iProd = ic('produit'),
        iQte = ic('quantite'), iCA = ic('CA'), iDate = ic('date');
  if ([iSource, iCmd, iProd, iQte, iCA, iDate].some(function (x) { return x === undefined; })) {
    throw new Error('01_VENTES : en-têtes attendus introuvables (source, commande, produit, quantite, CA, date).');
  }
  const iIdV = cols['ID vente'] - 1;

  // Lignes live déjà attribuées lors d'un passage précédent (clé vente + produit + quantité)
  const cleLigne = function (idVente, produit, qte) { return idVente + '|' + paNorm_(produit) + '|' + qte; };
  const prises = {};
  data.slice(1).forEach(function (r) {
    const v = String(r[iIdV] || '');
    if (!v) return;
    const k = cleLigne(v, r[iProd], paNum_(r[iQte]));
    prises[k] = (prises[k] || 0) + 1;
  });

  // Index des lignes live par session de caisse
  const parSession = {};
  live.lignes.forEach(function (l, i) {
    const s = live.ventes[l.idVente].session;
    if (!s) return;
    (parSession[s] = parSession[s] || []).push({ i: i, l: l, libre: true });
  });
  // Neutralise les lignes live déjà rattachées lors d'un passage précédent
  Object.keys(parSession).forEach(function (s) {
    parSession[s].forEach(function (c) {
      const k = cleLigne(c.l.idVente, c.l.produit, c.l.qte);
      if (prises[k] > 0) { prises[k]--; c.libre = false; }
    });
  });

  let maj = 0;
  const sortie = data.slice(1).map(function (r) { return r.slice(); });
  sortie.forEach(function (r) {
    if (String(r[iSource]) !== 'tablette') return;
    const v0 = String(r[iIdV] || '');
    // Ligne déjà rattachée : on complète seulement l'acheteur s'il est arrivé depuis
    if (v0) {
      const v = live.ventes[v0];
      if (v && v.email && !r[cols['Email acheteur'] - 1]) { paEcrireAcheteur_(r, cols, iEmail, v); maj++; }
      return;
    }
    const session = String(r[iCmd] || '').split('_')[0];
    const cands = parSession[session];
    if (!cands) return;
    const prod = paNorm_(r[iProd]), qte = paNum_(r[iQte]), ca = paNum_(r[iCA]), ts = paDate_(r[iDate]);
    let best = null, ecart = Infinity;
    cands.forEach(function (c) {
      if (!c.libre || paNorm_(c.l.produit) !== prod || c.l.qte !== qte || Math.abs(c.l.ca - ca) > 0.01) return;
      const d = ts && c.l.ts ? Math.abs(ts - c.l.ts) : 0;
      if (d <= PA.TOLERANCE_MS && d < ecart) { best = c; ecart = d; }
    });
    if (!best) return;
    best.libre = false;
    const v = live.ventes[best.l.idVente];
    r[iIdV] = v.id;
    paEcrireAcheteur_(r, cols, iEmail, v);
    maj++;
  });

  if (maj) {
    // Écriture limitée aux colonnes concernées (n'écrase rien d'autre)
    const cibles = PA_COLS_VENTES.map(function (n) { return cols[n] - 1; });
    if (iEmail !== undefined) cibles.push(iEmail);
    cibles.forEach(function (c) {
      sh.getRange(2, c + 1, sortie.length, 1).setValues(sortie.map(function (r) { return [r[c]]; }));
    });
  }
  return maj;
}

function paEcrireAcheteur_(r, cols, iEmail, v) {
  r[cols['Client Tickie'] - 1] = v.client;
  r[cols['Email acheteur'] - 1] = v.email;
  r[cols['Nom acheteur'] - 1] = v.nom;
  r[cols['ID billet'] - 1] = v.idBillet;
  r[cols['Code-barres'] - 1] = v.code;
  r[cols['Tarif billet'] - 1] = v.tarif;
  r[cols['Profil acheteur'] - 1] = v.profil || 'Sans billet';
  if (iEmail !== undefined && !r[iEmail] && v.email) r[iEmail] = v.email;   // colonne « email » historique
}

// ── 2. CRM Billetterie : BOUTIQUE_COMMANDES ──────────────────────────────
function paPousserBilletterie_(live) {
  const ss = paBilletterieSS_();
  const sh = ss.getSheetByName(PA.SH_BILLETTERIE) || paCreerOnglet_(ss, PA.SH_BILLETTERIE, PA_COLS_BILLETTERIE);
  const idMatch = paIdsMatchs_(ss);
  const tz = 'Europe/Paris', now = new Date();
  const tsDe = function (l) { return l.ts || live.ventes[l.idVente].ts || now; };
  const rows = live.lignes.slice().sort(function (a, b) { return tsDe(b) - tsDe(a); }).map(function (l) {
    const v = live.ventes[l.idVente];
    const ts = tsDe(l);
    const offert = /offert/i.test(l.mode);
    return [v.id, Utilities.formatDate(ts, tz, 'dd/MM/yyyy'), Utilities.formatDate(ts, tz, 'HH:mm'),
      idMatch[v.eventId] || '', v.match, v.boutique, v.email, v.nom, v.client, v.idBillet, v.code, v.tarif,
      v.profil || 'Sans billet', l.ref, l.produit, l.cat, l.qte, l.pu, offert ? 0 : l.ca, l.mode,
      offert ? 'OFFERT' : 'VALIDE', now];
  });

  const n = PA_COLS_BILLETTERIE.length;
  sh.getRange(1, 1, 1, n).setValues([PA_COLS_BILLETTERIE]);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(n, sh.getLastColumn())).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, n).setValues(rows);
    sh.getRange(2, 17, rows.length, 1).setNumberFormat('0');
    sh.getRange(2, 18, rows.length, 2).setNumberFormat('#,##0.00 "€"');
    sh.getRange(2, n, rows.length, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  }
  return rows.length;
}

// tickie_event_id → match_id depuis 🏆 MATCHES (en-tête cherché dans les 5 premières lignes)
function paIdsMatchs_(ss) {
  const out = {}, shM = ss.getSheetByName(PA.SH_MATCHES);
  if (!shM || shM.getLastRow() < 2) return out;
  const data = shM.getRange(1, 1, shM.getLastRow(), shM.getLastColumn()).getValues();
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const h = paIndexEntetes_(data[i]);
    const iId = h[paNorm_('match_id')], iEv = h[paNorm_('tickie_event_id')];
    if (iId === undefined || iEv === undefined) continue;
    data.slice(i + 1).forEach(function (r) { if (r[iEv]) out[String(r[iEv]).trim()] = String(r[iId]); });
    break;
  }
  return out;
}

// ── Utilitaires ──────────────────────────────────────────────────────────
function paCreerOnglet_(ss, nom, entetes) {
  const sh = ss.insertSheet(nom);
  sh.getRange(1, 1, 1, entetes.length).setValues([entetes])
    .setBackground(PA.NAVY).setFontColor('#FFFFFF').setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}
function paNorm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}
function paIndexEntetes_(ligne) {
  const h = {};
  ligne.forEach(function (v, i) {
    // Les en-têtes peuvent porter un titre avant la dernière ligne (cellule fusionnée) : on garde le dernier mot-clé
    const k = paNorm_(String(v).split('\n').pop());
    if (k && !(k in h)) h[k] = i;
  });
  return h;
}
function paDate_(v) {
  if (v instanceof Date) return v;
  if (!v) return null;
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
function paAssurerColonnes_(sh, noms) {
  const lastCol = Math.max(1, sh.getLastColumn());
  const h = paIndexEntetes_(sh.getRange(1, 1, 1, lastCol).getValues()[0]);
  const out = {};
  let next = lastCol + 1;
  noms.forEach(function (n) {
    const k = paNorm_(n);
    if (k in h) { out[n] = h[k] + 1; return; }
    sh.getRange(1, next).setValue(n).setFontWeight('bold');
    out[n] = next; h[k] = next - 1; next++;
  });
  return out;
}
