/**
 * ============================================================================
 *  CORRECTIONS CRM DU 24/11/2026 — demandées par Clément
 * ----------------------------------------------------------------------------
 *  1. Reprise RV-05 (01_VENTES, commande « RV-05-MAP-BLC-L-1010 ») : le maillot
 *     partenaire Blanc L à 62 € du 10/10 a été facturé à l'Agence LEAD
 *     (facture F202610-301, 51,67 € HT). Ce n'est pas une vente CB.
 *     → mode_paiement = « Facture LEAD F202610-301 ». CA et stock inchangés.
 *
 *  2. Match du 24/10/2026 : la tablette a pris le premier « vs » de l'événement
 *     Tickie « France Avenir vs Bordeaux & Spacer's vs Cannes ». Le match des
 *     Spacer's est contre CANNES.
 *     → « Spacer's vs Bordeaux » devient « Spacer's vs Cannes » dans :
 *        01_VENTES (match_associe), 11_MOUVEMENTS_STOCK (match),
 *        20_VENTES_LIVE (Match), et si le libellé y figure : 21_LIGNES_LIVE,
 *        17b_REMISES, 25_CONTROLES_CAISSE, 24_TRANSFERTS_LIVE, 22_TABLETTES.
 *     → 04_MATCHS : club_visiteur du 24/10 « Bordeaux » devient « Cannes ».
 *     NON TOUCHÉS (volontairement) : 04b_CALENDRIER, 17_RETRAITS, DATA_BILLETTERIE
 *     (vrai nom Tickie de la double affiche), 99_DIAGNOSTIC (journal).
 *     Les tableaux de bord sont recalculés ensuite (reconstruireSaisons,
 *     mettreAJourDashboard).
 *
 *  Garde-fous : colonnes retrouvées par leur en-tête ; seule une cellule dont la
 *  valeur entière est « Spacer's vs Bordeaux » (éventuellement suivie d'une date
 *  entre parenthèses) est modifiée ; une ligne datée d'un autre jour que le
 *  24/10/2026 est signalée et laissée telle quelle. Aucune autre cellule n'est
 *  écrite. Pennylane n'est pas concerné par ce script.
 *
 *  UTILISATION (projet Apps Script App_Boutique, classeur SPACERS_BOUTIQUE_CRM_V2) :
 *   1. Coller ce fichier dans le projet (Fichier > Nouveau > Script,
 *      nom « Corrections_CRM_20261124 »), enregistrer.
 *   2. ▶ cc_simuler   → lecture seule. Le journal d'exécution liste chaque
 *      cellule : onglet, ligne, avant → après, et le total par onglet.
 *   3. Vérifier les nombres : 01_VENTES 19 (18 ventes tablette + reprise RV-10
 *      du 24/10), 11_MOUVEMENTS_STOCK 13, 20_VENTES_LIVE 10, 04_MATCHS 1,
 *      RV-05 1. Un écart ou une ligne « ⚠ » mérite un coup d'œil avant d'appliquer.
 *   4. ▶ cc_appliquer → écrit les corrections (sous le verrou des tablettes),
 *      puis recalcule 10_SAISONS et le dashboard. Relançable : une seconde
 *      exécution annonce « 0 correction ».
 * ============================================================================
 */

const CC = {
  CRM_ID: '1mE9gSCtetFgnWEt0kA6cS2lcgJDe7oPRLDiXdGhH2EQ',
  JOUR_MATCH: '2026-10-24',
  RV05: { commande: 'RV-05-MAP-BLC-L-1010', mode: 'Facture LEAD F202610-301' },
  // Libellé complet uniquement : « Spacer's vs Bordeaux » ou « Spacer's vs Bordeaux (24/10/2026) »
  MOTIF: /^Spacer['’]s vs Bordeaux(\s*\([^)]*\))?$/,
  // requis : l'onglet et la colonne doivent exister. col null = toutes les colonnes.
  // dates : colonne(s) de date servant de garde-fou (la première trouvée est utilisée).
  CIBLES: [
    { onglet: '01_VENTES',           col: 'match_associe', dates: ['date'],                    requis: true },
    { onglet: '11_MOUVEMENTS_STOCK', col: 'match',         dates: ['horodatage'],              requis: true },
    { onglet: '20_VENTES_LIVE',      col: 'Match',         dates: ['Horodatage', 'Reçu le'],   requis: true },
    { onglet: '21_LIGNES_LIVE',      col: null,            dates: ['Horodatage'],              requis: false },
    { onglet: '17b_REMISES',         col: null,            dates: ['horodatage'],              requis: false },
    { onglet: '25_CONTROLES_CAISSE', col: null,            dates: [],                          requis: false },
    { onglet: '24_TRANSFERTS_LIVE',  col: null,            dates: ['Horodatage'],              requis: false },
    { onglet: '22_TABLETTES',        col: null,            dates: [],                          requis: false },
  ]
};

function cc_simuler()   { return cc_executer_(false); }
function cc_appliquer() { return cc_executer_(true); }

function cc_executer_(appliquer) {
  const ss = cc_crm_();
  let res;
  if (appliquer) {
    res = cc_verrou_(() => {
      const plan = cc_planifier_(ss);               // relu sous le verrou
      plan.changements.forEach(ch => ch.sh.getRange(ch.ligne, ch.colonne).setValue(ch.apres));
      return plan;
    });
  } else {
    res = cc_planifier_(ss);
  }

  const n = res.changements.length;
  const titre = (appliquer ? 'CORRECTIONS APPLIQUÉES' : 'SIMULATION (rien n\'est écrit)') + ' — ' + n + ' correction(s)' +
                (res.alertes.length ? ', ' + res.alertes.length + ' point(s) d\'attention' : '');
  const totaux = Object.keys(res.totaux).map(k => '   ' + k + ' : ' + res.totaux[k]);
  const detail = res.changements.map(ch => '   ' + ch.sh.getName() + ' L' + ch.ligne + ' [' + ch.entete + '] : « ' +
                                     ch.avant + ' » → « ' + ch.apres + ' »');
  const texte = [titre, 'TOTAL PAR ONGLET :'].concat(totaux, ['DÉTAIL :'], detail.length ? detail : ['   (aucune cellule à modifier)'],
                res.infos.length ? ['INFOS :'].concat(res.infos.map(x => '   ' + x)) : [],
                res.alertes.length ? ['POINTS D\'ATTENTION :'].concat(res.alertes.map(x => '   ⚠ ' + x)) : []).join('\n');
  Logger.log(texte);

  if (appliquer) {
    const recalc = cc_recalculer_(ss, n > 0);
    if (recalc) Logger.log(recalc);
    cc_diag_(ss, titre + ' · ' + Object.keys(res.totaux).map(k => k + ' ' + res.totaux[k]).join(', '));
  }
  return texte;
}

/** Calcule la liste exacte des cellules à modifier, sans rien écrire. */
function cc_planifier_(ss) {
  const tz = (ss.getSpreadsheetTimeZone && ss.getSpreadsheetTimeZone()) || 'Europe/Paris';
  const jour = v => (v instanceof Date && !isNaN(v.getTime())) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : '';
  const changements = [], alertes = [], infos = [], totaux = {};

  // ── 1. RV-05 ────────────────────────────────────────────────
  const shV = ss.getSheetByName('01_VENTES');
  if (!shV) throw new Error('Onglet 01_VENTES introuvable dans le classeur ' + ss.getName() + '.');
  {
    const v = shV.getDataRange().getValues();
    const h = cc_entetes_(v[0]);
    const iCmd = cc_col_(h, 'commande', '01_VENTES'), iMode = cc_col_(h, 'mode_paiement', '01_VENTES');
    let trouve = 0, n = 0;
    for (let r = 1; r < v.length; r++) {
      if (String(v[r][iCmd]).trim() !== CC.RV05.commande) continue;
      trouve++;
      const avant = String(v[r][iMode]);
      if (avant.trim() === CC.RV05.mode) continue;
      if (avant.trim() !== 'CB') alertes.push('RV-05 L' + (r + 1) + ' : mode actuel « ' + avant + ' » (attendu « CB ») — remplacé quand même.');
      changements.push({ sh: shV, ligne: r + 1, colonne: iMode + 1, entete: 'mode_paiement', avant: avant, apres: CC.RV05.mode });
      n++;
    }
    if (!trouve) alertes.push('Ligne ' + CC.RV05.commande + ' absente de 01_VENTES : lancer d\'abord rv_appliquer (Reprise_Ventes_VIP.gs), puis relancer.');
    if (trouve > 1) alertes.push(trouve + ' lignes ' + CC.RV05.commande + ' dans 01_VENTES (doublon ?) — toutes corrigées.');
    if (trouve && !n) infos.push('RV-05 déjà en « ' + CC.RV05.mode + ' ».');
    totaux['01_VENTES (RV-05 mode_paiement)'] = n;
  }

  // ── 2. Libellé du match du 24/10 ────────────────────────────
  CC.CIBLES.forEach(c => {
    const sh = ss.getSheetByName(c.onglet);
    if (!sh) {
      if (c.requis) throw new Error('Onglet « ' + c.onglet + ' » introuvable : rien n\'a été modifié.');
      infos.push(c.onglet + ' : onglet absent (rien à corriger).');
      return;
    }
    if (sh.getLastRow() < 2) { totaux[c.onglet] = 0; return; }
    const v = sh.getDataRange().getValues();
    const h = cc_entetes_(v[0]);
    const cols = c.col ? [cc_col_(h, c.col, c.onglet)] : h.map((_, i) => i);
    const iDate = c.dates.map(d => h.indexOf(d)).find(i => i !== -1);
    let n = 0;
    for (let r = 1; r < v.length; r++) {
      cols.forEach(j => {
        const avant = v[r][j];
        if (typeof avant !== 'string' || !CC.MOTIF.test(avant.trim())) return;
        const d = iDate === undefined ? '' : jour(v[r][iDate]);
        if (d && d !== CC.JOUR_MATCH) {
          alertes.push(c.onglet + ' L' + (r + 1) + ' : « ' + avant + ' » daté du ' + d + ' (≠ 24/10) — laissé tel quel.');
          return;
        }
        changements.push({ sh: sh, ligne: r + 1, colonne: j + 1, entete: h[j], avant: avant,
                           apres: avant.replace('Bordeaux', 'Cannes') });
        n++;
      });
    }
    totaux[c.onglet] = n;
  });

  // ── 3. 04_MATCHS : adversaire du 24/10 ──────────────────────
  const shM = ss.getSheetByName('04_MATCHS');
  if (!shM) throw new Error('Onglet 04_MATCHS introuvable : rien n\'a été modifié.');
  {
    const v = shM.getDataRange().getValues();
    const h = cc_entetes_(v[0]);
    const iD = cc_col_(h, 'date', '04_MATCHS'), iA = cc_col_(h, 'club_visiteur', '04_MATCHS');
    let n = 0, du24 = 0;
    for (let r = 1; r < v.length; r++) {
      if (jour(v[r][iD]) !== CC.JOUR_MATCH) continue;
      du24++;
      const avant = String(v[r][iA]).trim();
      if (avant === 'Cannes') { infos.push('04_MATCHS L' + (r + 1) + ' : adversaire déjà « Cannes ».'); continue; }
      if (avant !== 'Bordeaux') { alertes.push('04_MATCHS L' + (r + 1) + ' : adversaire du 24/10 = « ' + avant + ' » (ni Bordeaux ni Cannes) — laissé tel quel.'); continue; }
      changements.push({ sh: shM, ligne: r + 1, colonne: iA + 1, entete: h[iA], avant: v[r][iA], apres: 'Cannes' });
      n++;
    }
    if (!du24) alertes.push('04_MATCHS : aucune ligne datée du 24/10/2026.');
    if (du24 > 1) alertes.push('04_MATCHS : ' + du24 + ' lignes datées du 24/10/2026 (doublon ?).');
    totaux['04_MATCHS'] = n;
  }

  return { changements: changements, alertes: alertes, infos: infos, totaux: totaux };
}

/* ================================ OUTILS ==================================== */

function cc_entetes_(ligne) { return ligne.map(x => String(x).trim()); }

function cc_col_(h, nom, onglet) {
  const i = h.indexOf(nom);
  if (i === -1) throw new Error('Colonne « ' + nom + ' » absente de ' + onglet + ' (en-têtes : ' + h.filter(String).join(', ') +
                                ') : rien n\'a été modifié.');
  return i;
}

function cc_crm_() {
  const actif = SpreadsheetApp.getActive();
  if (actif && actif.getId() === CC.CRM_ID) return actif;
  return SpreadsheetApp.openById(CC.CRM_ID);
}

/** Même verrou que le doPost des tablettes (sb_avecVerrou_ de Stock_Boutique.gs). */
function cc_verrou_(fn) {
  if (typeof sb_avecVerrou_ === 'function') return sb_avecVerrou_(fn);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Les fonctions V3 lisent le classeur actif : on s'assure que c'est le CRM. */
function cc_crmActif_(ss) {
  const actif = SpreadsheetApp.getActive();
  if (actif && actif.getId() === ss.getId()) return true;
  try { SpreadsheetApp.setActiveSpreadsheet(ss); return true; } catch (e) { return false; }
}

function cc_recalculer_(ss, utile) {
  if (!utile) return 'Recalculs non relancés (aucune correction écrite).';
  if (!cc_crmActif_(ss)) return '⚠ Le CRM n\'est pas le classeur actif : lancer reconstruireSaisons et mettreAJourDashboard depuis le CRM.';
  const out = [];
  [['reconstruireSaisons', '10_SAISONS'], ['mettreAJourDashboard', '00_DASHBOARD']].forEach(([f, lib]) => {
    try {
      const fn = (typeof globalThis !== 'undefined' ? globalThis : this)[f];
      if (typeof fn !== 'function') { out.push(lib + ' : fonction ' + f + ' absente du projet (non recalculé).'); return; }
      fn();
      out.push(lib + ' : recalculé.');
    } catch (e) { out.push('⚠ ' + lib + ' : ' + e.message); }
  });
  return 'RECALCULS :\n   ' + out.join('\n   ');
}

function cc_diag_(ss, message) {
  try { if (typeof logDiag === 'function' && cc_crmActif_(ss)) logDiag('cc_appliquer', 'INFO', message); } catch (e) { /* facultatif */ }
}
