/**
 * ============================================================================
 *  Cloture_Match.gs — CRM Boutique Spacers (projet Apps Script App_Boutique)
 *  Contrôles « retail » de fin de match — 25/11/2026
 * ----------------------------------------------------------------------------
 *  Fichier NOUVEAU : il ne remplace rien et ne modifie aucune fonction existante.
 *  Il ajoute trois choses :
 *
 *   1. cm_gardeAvantEb_()  — verrou d'ordre « Synchroniser tout → comptage → eb_simuler → eb_appliquer ».
 *      Refuse tant que :
 *        • une vente reçue en direct (21_LIGNES_LIVE) n'est pas arrivée dans 01_VENTES (tablette pas synchronisée),
 *        • un transfert GP ↔ VIP de 24_TRANSFERTS_LIVE n'est pas encore appliqué,
 *        • on est pendant un match (de 1 h 30 avant à 3 h après l'heure du match, d'après 04b_CALENDRIER).
 *      À appeler en PREMIÈRE ligne de eb_appliquer (une ligne à coller, voir le rapport code-audit.md).
 *      cm_verifierAvantEb() : la même vérification, lancée à la main, sans rien écrire.
 *
 *   2. cm_apresImport_(payload) — appelé par le doPost « import_session » (une ligne à coller) :
 *        • 26_VENTES_TPE : une ligne par ligne de vente reçue, avec le TERMINAL CB utilisé et le bénévole
 *          (clé identique à 01_VENTES, idempotent : un rejeu n'ajoute rien) ;
 *        • 26b_CLOTURES_TABLETTE : le contrôle de caisse saisi à la clôture sur la tablette
 *          (ticket de fin de chaque terminal, tiroir compté), une ligne par terminal + une ligne espèces.
 *      01_VENTES n'est pas touché (format Pennylane / Ratio inchangé).
 *
 *   3. cm_rapportCloture(match) / cm_rapportDernierMatch() — rapport de clôture dans 27_CLOTURE_MATCH :
 *      synchro des tablettes, ventes par boutique et moyen de paiement (01_VENTES), CB par terminal
 *      (26_VENTES_TPE), montants des terminaux (28_TELECOLLECTES saisi d'après les PDF de télécollecte,
 *      sinon le ticket saisi sur la tablette), espèces (tiroir − fond de 30 €, ou 25_CONTROLES_CAISSE),
 *      écart SIGNÉ au centime et verdict avec tolérances (CB 0 €, espèces ±1 €).
 *      Lecture seule partout, sauf l'onglet 27_CLOTURE_MATCH (réécrit) et la création de 28_TELECOLLECTES vide.
 * ============================================================================
 */

const CM = {
  VENTES: '01_VENTES', LIVE: '21_LIGNES_LIVE', TRF: '24_TRANSFERTS_LIVE', CAL: '04b_CALENDRIER',
  CONTROLES: '25_CONTROLES_CAISSE',
  TPE: '26_VENTES_TPE', CLOT: '26b_CLOTURES_TABLETTE', RAPPORT: '27_CLOTURE_MATCH', TELE: '28_TELECOLLECTES',
  ENT_TPE: ['cle', 'horodatage', 'match', 'boutique', 'session', 'benevole', 'produit', 'quantite', 'mode', 'CA_TTC', 'terminal', 'recu_le'],
  ENT_CLOT: ['cle', 'cloture_le', 'match', 'date_match', 'boutique', 'session', 'saisi_par', 'type', 'terminal', 'tablette_EUR', 'compte_EUR', 'ecart_EUR', 'tickets', 'recu_le'],
  ENT_TELE: ['date_match', 'terminal', 'libelle', 'montant_EUR', 'nb_transactions', 'source (PDF / relevé)', 'saisi_par', 'commentaire'],
  // Terminaux (table de Clément du 24/11/2026) — même liste que la tablette
  TERMINAUX: {
    '2668544-001': { lib: 'D177 Boutique GP', boutique: 'B1' },
    '6053438-002': { lib: 'A920 Boutique VIP', boutique: 'B2' },
    '2668543-001': { lib: 'D177 Buvette 2', boutique: '' },
    '6053438-001': { lib: 'A920 Buvette 1', boutique: '' },
    '6053438-003': { lib: 'A920 Buvette 3', boutique: '' },
    '6053438-004': { lib: 'A920 Désoiffeur', boutique: '' },
  },
  FOND: 30, TOL_CB: 0, TOL_ESP: 1,
  AVANT_MATCH_MIN: 90, APRES_MATCH_MIN: 180, JOURS_CONTROLE: 21,
  TZ: 'Europe/Paris',
};

/* ============================ 1. VERROU AVANT eb_appliquer ============================ */

/** Lève une erreur (rien n'est écrit) si eb_appliquer ne doit pas tourner maintenant. */
function cm_gardeAvantEb_(maintenant) {
  const pb = cm_problemesAvantEb_(maintenant || new Date());
  if (pb.length) throw new Error('eb_appliquer REFUSÉ — ' + pb.join(' · ') +
    ' (ordre : « Synchroniser tout » sur les 2 tablettes → comptage d\'Élise dans « En boutique » → eb_simuler → eb_appliquer).');
  return true;
}

/** ▶ À lancer à la main : dit si eb_appliquer peut tourner. N'écrit rien. */
function cm_verifierAvantEb() {
  const pb = cm_problemesAvantEb_(new Date());
  const txt = pb.length ? '⛔ Pas maintenant : ' + pb.join(' · ') : '✅ Les deux tablettes sont synchronisées, aucun transfert en attente, pas de match en cours : eb_simuler puis eb_appliquer possibles.';
  Logger.log(txt);
  return txt;
}

function cm_problemesAvantEb_(maintenant) {
  const ss = SpreadsheetApp.getActive();
  const pb = [];
  // a) ventes reçues en direct mais pas encore dans 01_VENTES (comparaison des quantités par jour et par boutique)
  const ns = cm_nonSynchro_(ss, new Date(maintenant.getTime() - CM.JOURS_CONTROLE * 864e5));
  // (un jour déjà expliqué — ex. course « introuvable » restée dans le direct — se déclare dans CM_JOURS_VERIFIES)
  const verifies = String(PropertiesService.getScriptProperties().getProperty('CM_JOURS_VERIFIES') || '').split(',').map(x => x.trim());
  Object.keys(ns).filter(k => verifies.indexOf(k) === -1).sort().forEach(k => { const [j, b] = k.split('|'); pb.push(ns[k] + ' article(s) ' + cm_nomB_(b) + ' du ' + j + ' pas encore synchronisé(s)'); });
  // a bis) l'inverse : ventes synchronisées mais JAMAIS reçues en direct (pilotage non configuré, tablette hors ligne tout le
  //        match…) : majInventaire ne les a pas retirées de « En boutique », et eb_appliquer les remettrait en stock.
  const jv = cm_jamaisVuesEnDirect_(ss, new Date(maintenant.getTime() - CM.JOURS_CONTROLE * 864e5));
  Object.keys(jv).sort().forEach(k => { const [j, b] = k.split('|'); pb.push(jv[k] + ' article(s) ' + cm_nomB_(b) + ' du ' + j +
    ' synchronisé(s) mais jamais reçu(s) en direct : « En boutique » ne les a pas décomptés (les retirer dans « En boutique », puis noter dans la propriété CM_JOURS_VERIFIES « ' + j + '|' + b + ' »)'); });
  // b) transferts GP ↔ VIP reçus mais pas encore appliqués à 03_PRODUITS
  const trf = cm_lire_(ss, CM.TRF);
  const colFait = trf.entetes.find(h => /^(appliqu|trait|fait)/i.test(h));
  if (colFait) {
    const att = trf.lignes.filter(l => !String(l[colFait] || '').trim() && String(l['ID transfert'] || '').trim()).length;
    if (att) pb.push(att + ' transfert(s) GP ↔ VIP pas encore appliqué(s) (lancer appliquerTransferts)');
  }
  // c) match en cours (04b_CALENDRIER)
  const m = cm_matchEnCours_(ss, maintenant);
  if (m) pb.push('match en cours (' + m + ') : aucun recalage pendant un match');
  return pb;
}

/** { 'aaaa-mm-jj|B1': manque } : articles vus en direct (21_LIGNES_LIVE) mais absents de 01_VENTES (source tablette). */
function cm_nonSynchro_(ss, depuis) {
  const recu = {}, synchro = {};
  cm_lire_(ss, CM.LIVE).lignes.forEach(l => {
    const d = cm_date_(l['Horodatage']);
    if (!d || d < depuis || cm_estDivers_(l['Réf.'], l['Produit'])) return;
    const k = cm_jour_(d) + '|' + cm_b_(l['Boutique']);
    recu[k] = (recu[k] || 0) + cm_num_(l['Qté']);
  });
  cm_lire_(ss, CM.VENTES).lignes.forEach(v => {
    if (String(v['source'] || '').trim() !== 'tablette') return;
    const d = cm_date_(v['date']);
    if (!d || d < depuis || cm_estDivers_('', v['produit'])) return;
    const k = cm_jour_(d) + '|' + cm_b_(v['boutique_id']);
    synchro[k] = (synchro[k] || 0) + cm_num_(v['quantite']);
  });
  const out = {};
  Object.keys(recu).forEach(k => { const manque = recu[k] - (synchro[k] || 0); if (manque > 0) out[k] = manque; });
  return out;
}

/** { 'aaaa-mm-jj|B1': surplus } : articles dans 01_VENTES (tablette) au-delà de ce que 21_LIGNES_LIVE a reçu ce jour-là.
 *  Un jour déjà régularisé à la main se déclare dans la propriété de script CM_JOURS_VERIFIES (« 2026-11-07|B1,2026-11-21|B2 »). */
function cm_jamaisVuesEnDirect_(ss, depuis) {
  const recu = {}, synchro = {};
  cm_lire_(ss, CM.LIVE).lignes.forEach(l => {
    const d = cm_date_(l['Horodatage']);
    if (!d || d < depuis || cm_estDivers_(l['Réf.'], l['Produit'])) return;
    const k = cm_jour_(d) + '|' + cm_b_(l['Boutique']); recu[k] = (recu[k] || 0) + cm_num_(l['Qté']);
  });
  cm_lire_(ss, CM.VENTES).lignes.forEach(v => {
    if (String(v['source'] || '').trim() !== 'tablette') return;
    const d = cm_date_(v['date']);
    if (!d || d < depuis || cm_estDivers_('', v['produit'])) return;
    const k = cm_jour_(d) + '|' + cm_b_(v['boutique_id']); synchro[k] = (synchro[k] || 0) + cm_num_(v['quantite']);
  });
  const ok = String(PropertiesService.getScriptProperties().getProperty('CM_JOURS_VERIFIES') || '').split(',').map(x => x.trim());
  const out = {};
  Object.keys(synchro).forEach(k => { const surplus = synchro[k] - (recu[k] || 0); if (surplus > 0 && ok.indexOf(k) === -1) out[k] = surplus; });
  return out;
}

/** Libellé du match si maintenant ∈ [heure − 1 h 30 ; heure + 3 h] un jour de match, sinon ''. */
function cm_matchEnCours_(ss, maintenant) {
  const cal = cm_lire_(ss, CM.CAL);
  for (const l of cal.lignes) {
    const d = cm_date_(l['Date']);
    if (!d || cm_jour_(d) !== cm_jour_(maintenant)) continue;
    const h = l['Heure'] instanceof Date ? Utilities.formatDate(l['Heure'], CM.TZ, 'HH:mm') : String(l['Heure'] || '18:00');
    const mm = /(\d{1,2})[:hH](\d{2})/.exec(h); if (!mm) continue;
    const debut = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(mm[1]), Number(mm[2]));
    if (maintenant >= new Date(debut.getTime() - CM.AVANT_MATCH_MIN * 6e4) && maintenant <= new Date(debut.getTime() + CM.APRES_MATCH_MIN * 6e4))
      return String(l["Adversaire Spacer's"] ? "Spacer's vs " + l["Adversaire Spacer's"] : l['Match'] || '') + ' à ' + h;
  }
  return '';
}

/* ============================ 2. APRÈS IMPORT D'UNE SESSION ============================ */

/**
 * Appelé sous le verrou du doPost, juste après importSessionDepuisTablet(payload).
 * Idempotent : la clé d'une ligne de vente est celle de 01_VENTES (session.id + '_' + vente.id).
 */
function cm_apresImport_(payload) {
  const s = (payload && payload.session) || {}, ventes = (payload && payload.ventes) || [];
  if (!s.id) return { tpe: 0, cloture: 0 };
  const ss = SpreadsheetApp.getActive(), now = new Date();
  const b = String(s.boutique_id || 'B1').trim(), match = String(s.match_label || '').trim();

  const shT = cm_onglet_(ss, CM.TPE, CM.ENT_TPE);
  const dejaT = cm_cles_(shT);
  const rowsT = [];
  ventes.forEach(v => {
    const cle = s.id + '_' + (v.id || '');
    if (!v.id || dejaT[cle]) return;
    dejaT[cle] = 1;
    rowsT.push([cle, cm_date_(v.timestamp) || now, match, b, s.id, String(v.benevole || s.benevole || ''), String(v.produit_nom || ''),
      cm_num_(v.quantite), String(v.mode_paiement || ''), cm_r2_(v.ca_ligne), String(v.tpe || ''), now]);
  });
  if (rowsT.length) shT.getRange(shT.getLastRow() + 1, 1, rowsT.length, CM.ENT_TPE.length).setValues(rowsT);

  const c = s.controle;
  const rowsC = [];
  if (c && typeof c === 'object') {
    const shC = cm_onglet_(ss, CM.CLOT, CM.ENT_CLOT);
    const dejaC = cm_cles_(shC);
    const base = (type, terminal, tab, compte, tickets) => {
      const cle = s.id + '|' + type + '|' + (terminal || '');
      if (dejaC[cle]) return;
      dejaC[cle] = 1;
      const vide = compte === '' || compte === null || compte === undefined;
      rowsC.push([cle, cm_date_(c.ts) || now, match, String(s.date || ''), b, s.id, String(c.saisi_par || s.benevole || ''), type, terminal || '',
        cm_r2_(tab), vide ? '' : cm_r2_(compte), vide ? '' : cm_r2_(cm_num_(compte) - cm_num_(tab)), tickets === undefined ? '' : tickets, now]);
    };
    (c.tpe || []).forEach(t => base('CB', String(t.tpe || ''), t.cb_tablette, t.tpe_saisi, t.tickets));
    // espèces : la tablette fait compter TOUT le tiroir (fond compris) ; on enregistre net du fond
    const fond = cm_num_(c.fond === undefined ? CM.FOND : c.fond);
    const tiroir = c.esp_comptees_tiroir;
    base('Espèces (net du fond de ' + fond + ' €)', '', c.esp_tablette, (tiroir === '' || tiroir === null || tiroir === undefined) ? '' : cm_num_(tiroir) - fond);
    if (rowsC.length) shC.getRange(shC.getLastRow() + 1, 1, rowsC.length, CM.ENT_CLOT.length).setValues(rowsC);
  }
  return { tpe: rowsT.length, cloture: rowsC.length };
}

/* ============================ 3. RAPPORT DE CLÔTURE ============================ */

/** ▶ Rapport du dernier match vendu en tablette. */
function cm_rapportDernierMatch() {
  const v = cm_lire_(SpreadsheetApp.getActive(), CM.VENTES).lignes.filter(x => String(x['source']).trim() === 'tablette' && String(x['match_associe'] || '').trim());
  if (!v.length) throw new Error('Aucune vente tablette dans 01_VENTES.');
  v.sort((a, b) => (cm_date_(b['date']) || 0) - (cm_date_(a['date']) || 0));
  return cm_rapportCloture(String(v[0]['match_associe']).trim());
}

/**
 * ▶ Rapport de clôture d'un match (« Spacer's vs Paris »). Écrit seulement 27_CLOTURE_MATCH.
 * @return {string} résumé (aussi en tête de l'onglet)
 */
function cm_rapportCloture(match) {
  const ss = SpreadsheetApp.getActive();
  match = String(match || '').trim();
  if (!match) throw new Error('Indiquer le match, ex. cm_rapportCloture("Spacer\'s vs Paris").');
  const R = cm_calculerCloture_(ss, match);
  cm_onglet_(ss, CM.TELE, CM.ENT_TELE);   // créé vide s'il n'existe pas, pour la saisie des télécollectes
  cm_ecrireRapport_(ss, R);
  return R.resume;
}

/** Calcul pur du rapport (exporté pour les tests). */
function cm_calculerCloture_(ss, match) {
  const V = cm_lire_(ss, CM.VENTES).lignes.filter(v => String(v['match_associe'] || '').trim() === match && String(v['source'] || '').trim() === 'tablette');
  const jours = {};
  V.forEach(v => { const d = cm_date_(v['date']); if (d) jours[cm_jour_(d)] = (jours[cm_jour_(d)] || 0) + 1; });
  const jour = Object.keys(jours).sort((a, b) => jours[b] - jours[a])[0] || '';

  // a) synchro des tablettes pour le jour du match
  const ns = jour ? cm_nonSynchro_(ss, new Date(jour + 'T00:00:00')) : {};
  const synchro = ['B1', 'B2'].map(b => ({ boutique: b, manque: ns[jour + '|' + b] || 0 }));

  // b) ventes par boutique et moyen de paiement (01_VENTES fait foi pour le CA)
  const bq = {};
  const B = b => bq[b] = bq[b] || { boutique: b, tickets: {}, articles: 0, ca: 0, cb: 0, esp: 0, autre: 0, offerts: 0, divers: 0, divers_ca: 0 };
  V.forEach(v => {
    const x = B(cm_b_(v['boutique_id'])), mode = String(v['mode_paiement'] || ''), q = cm_num_(v['quantite']), ca = cm_num_(v['CA']);
    x.articles += q; x.tickets[String(v['commande'] || '').split('_')[0]] = 1;
    if (cm_estDivers_('', v['produit'])) { x.divers += q; x.divers_ca += ca; }
    if (/offert/i.test(mode)) { x.offerts += q; return; }
    x.ca += ca;
    if (/^cb|carte/i.test(mode)) x.cb += ca; else if (/esp/i.test(mode)) x.esp += ca; else x.autre += ca;
  });
  Object.keys(bq).forEach(k => ['ca', 'cb', 'esp', 'autre', 'divers_ca'].forEach(f => { bq[k][f] = cm_r2_(bq[k][f]); }));

  // c) CB par terminal (26_VENTES_TPE)
  const parTpe = {};
  cm_lire_(ss, CM.TPE).lignes.filter(l => String(l['match']).trim() === match && /^cb/i.test(String(l['mode']))).forEach(l => {
    const t = String(l['terminal'] || '').trim() || '(non indiqué)';
    const k = cm_b_(l['boutique']) + '|' + t;
    parTpe[k] = parTpe[k] || { boutique: cm_b_(l['boutique']), terminal: t, cb: 0 };
    parTpe[k].cb += cm_num_(l['CA_TTC']);
  });

  // d) montants des terminaux : télécollecte (28) > ticket saisi sur la tablette (26b)
  const tele = {};
  cm_lire_(ss, CM.TELE).lignes.forEach(l => {
    const d = cm_date_(l['date_match']); if (!d || cm_jour_(d) !== jour) return;
    const t = String(l['terminal'] || '').trim(); if (!t) return;
    tele[t] = { montant: cm_r2_((tele[t] ? tele[t].montant : 0) + cm_num_(l['montant_EUR'])), source: 'télécollecte' };
  });
  const clot = cm_lire_(ss, CM.CLOT).lignes.filter(l => String(l['match']).trim() === match);
  const ticket = {};
  clot.filter(l => String(l['type']) === 'CB' && l['compte_EUR'] !== '').forEach(l => {
    const t = String(l['terminal'] || '').trim(); ticket[t] = cm_r2_((ticket[t] || 0) + cm_num_(l['compte_EUR']));
  });
  const terminaux = {};
  Object.keys(parTpe).forEach(k => { const p = parTpe[k]; (terminaux[p.terminal] = terminaux[p.terminal] || { terminal: p.terminal, B1: 0, B2: 0 })[p.boutique] += p.cb; });
  Object.keys(tele).forEach(t => { if (CM.TERMINAUX[t] && CM.TERMINAUX[t].boutique) terminaux[t] = terminaux[t] || { terminal: t, B1: 0, B2: 0 }; });
  const lignesTpe = Object.keys(terminaux).sort().map(t => {
    const x = terminaux[t], info = CM.TERMINAUX[t] || { lib: t === '(non indiqué)' ? 'terminal non indiqué (vente faite avant la v20)' : 'terminal inconnu', boutique: '' };
    const tab = cm_r2_(x.B1 + x.B2);
    const src = tele[t] ? tele[t] : (t in ticket ? { montant: ticket[t], source: 'ticket saisi sur la tablette' } : null);
    const boutiqueSeule = !!info.boutique;   // terminal dédié à une boutique : comparaison directe
    const ecart = src && boutiqueSeule ? cm_r2_(src.montant - tab) : null;
    return { terminal: t, lib: info.lib, dedie: info.boutique, B1: cm_r2_(x.B1), B2: cm_r2_(x.B2), tablette: tab,
      compte: src ? src.montant : '', source: src ? src.source : '', ecart: ecart,
      note: !boutiqueSeule && t !== '(non indiqué)' ? 'terminal d\'un autre stand : ' + cm_eur_(tab) + ' de ventes boutique encaissés ici, à réaffecter de la buvette vers la boutique (Pennylane 7071 → 7072)' : '' };
  });

  // e) espèces : tiroir saisi sur la tablette (net du fond) ou 25_CONTROLES_CAISSE
  const ctl = cm_lire_(ss, CM.CONTROLES).lignes.filter(l => String(l['match']).trim() === match);
  const esp = ['B1', 'B2'].filter(b => bq[b]).map(b => {
    const t = clot.filter(l => cm_b_(l['boutique']) === b && /^esp/i.test(String(l['type'])) && l['compte_EUR'] !== '');
    const f = ctl.filter(l => cm_b_(String(l['boutique']).replace(/^Boutique\s+/i, '')) === b && l['especes_comptees'] !== '');
    let compte = '', source = '';
    if (f.length) { compte = cm_r2_(cm_num_(f[f.length - 1]['especes_comptees'])); source = '25_CONTROLES_CAISSE (fichier d\'Élise)'; }
    else if (t.length) { compte = t.reduce((s, l) => s + cm_num_(l['compte_EUR']), 0); source = 'tiroir saisi sur la tablette − fond'; }
    return { boutique: b, tablette: bq[b].esp, compte: compte === '' ? '' : cm_r2_(compte), source: source, ecart: compte === '' ? null : cm_r2_(compte - bq[b].esp) };
  });

  // f) verdict : « problèmes » bloquent la clôture ; « actions » sont à faire mais ne faussent pas la caisse
  const pbs = [], actions = [];
  synchro.filter(s => s.manque > 0).forEach(s => pbs.push(cm_nomB_(s.boutique) + ' : ' + s.manque + ' article(s) pas synchronisé(s)'));
  lignesTpe.forEach(l => {
    if (l.terminal === '(non indiqué)') return;
    if (l.dedie && l.compte === '') pbs.push(l.lib + ' : télécollecte non saisie (28_TELECOLLECTES)');
    else if (l.ecart !== null && Math.abs(l.ecart) > CM.TOL_CB) pbs.push(l.lib + ' : écart ' + cm_signe_(l.ecart));
    if (l.note) actions.push(l.lib + ' : ' + cm_eur_(l.tablette) + ' de ventes boutique à réaffecter dans Pennylane');
  });
  // CB de 01_VENTES sans détail par terminal (ventes d'avant la v20, ou 26_VENTES_TPE absent) : non rapprochables
  ['B1', 'B2'].filter(b => bq[b]).forEach(b => {
    const vu = Object.keys(parTpe).filter(k => parTpe[k].boutique === b && parTpe[k].terminal !== '(non indiqué)').reduce((s, k) => s + parTpe[k].cb, 0);
    const manque = cm_r2_(bq[b].cb - vu);
    if (manque > 0.005) pbs.push(cm_nomB_(b) + ' : CB sans terminal indiqué : ' + cm_eur_(manque) + ' (rapprocher à la main avec les télécollectes)');
  });
  esp.forEach(e => {
    if (e.ecart === null) pbs.push('espèces ' + cm_nomB_(e.boutique) + ' non comptées');
    else if (Math.abs(e.ecart) > CM.TOL_ESP) pbs.push('espèces ' + cm_nomB_(e.boutique) + ' : écart ' + cm_signe_(e.ecart));
  });
  Object.keys(bq).forEach(b => { if (bq[b].divers) actions.push(cm_nomB_(b) + ' : ' + bq[b].divers + ' article(s) hors catalogue (stock non décompté, à régulariser)'); });
  const total = cm_r2_(Object.keys(bq).reduce((s, b) => s + bq[b].ca, 0));
  const resume = (pbs.length ? '❌ CLÔTURE À FINIR' : '✅ CLÔTURE CONFORME') + ' — ' + match + ' (' + (jour || 'date ?') + ') · CA tablettes ' + cm_eur_(total) +
    (pbs.length ? ' · ' + pbs.join(' · ') : '') + (actions.length ? ' · À faire : ' + actions.join(' · ') : '');
  return { match: match, jour: jour, synchro: synchro, boutiques: ['B1', 'B2'].filter(b => bq[b]).map(b => Object.assign({}, bq[b], { sessions: Object.keys(bq[b].tickets).length })),
           terminaux: lignesTpe, especes: esp, problemes: pbs, actions: actions, total: total, resume: resume };
}

function cm_ecrireRapport_(ss, R) {
  let sh = ss.getSheetByName(CM.RAPPORT);
  if (!sh) sh = ss.insertSheet(CM.RAPPORT);
  sh.clear();
  const L = [];
  const push = (...x) => L.push(x);
  push('🏁 CLÔTURE DE MATCH — ' + R.match, 'jour : ' + R.jour, 'calculé le ' + Utilities.formatDate(new Date(), CM.TZ, 'dd/MM/yyyy HH:mm'));
  push(R.resume);
  push('');
  push('1. Synchronisation des tablettes', 'articles vus en direct mais pas dans 01_VENTES');
  R.synchro.forEach(s => push(cm_nomB_(s.boutique), s.manque, s.manque ? '❌ faire « Synchroniser tout »' : '✅'));
  push('');
  push('2. Ventes (01_VENTES)', 'sessions tablette', 'articles', 'CA TTC', 'dont CB', 'dont espèces', 'autre', 'offerts (art.)', 'hors catalogue (art.)');
  R.boutiques.forEach(b => push(cm_nomB_(b.boutique), b.sessions, b.articles, b.ca, b.cb, b.esp, b.autre, b.offerts, b.divers));
  push('Total', '', '', R.total);
  push('');
  push('3. CB par terminal', 'libellé', 'CB tablette GP', 'CB tablette VIP', 'CB tablette total', 'montant terminal', 'source', 'écart signé', 'remarque');
  R.terminaux.forEach(t => push(t.terminal, t.lib, t.B1, t.B2, t.tablette, t.compte, t.source, t.ecart === null ? '' : t.ecart, t.note));
  push('');
  push('4. Espèces (net du fond de ' + CM.FOND + ' €)', 'tablette', 'compté', 'source', 'écart signé');
  R.especes.forEach(e => push(cm_nomB_(e.boutique), e.tablette, e.compte, e.source, e.ecart === null ? '' : e.ecart));
  push('');
  push('Tolérances : CB ' + CM.TOL_CB + ' € par terminal, espèces ±' + CM.TOL_ESP + ' € par boutique. Écart = compté − tablette (+ = trop encaissé, − = manque).');
  push('Montants des terminaux : saisir chaque télécollecte (PDF) dans 28_TELECOLLECTES (date du match, n° du terminal, montant) ; à défaut, le ticket saisi sur la tablette à la clôture est utilisé.');
  const w = Math.max.apply(null, L.map(l => l.length));
  sh.getRange(1, 1, L.length, w).setValues(L.map(l => l.concat(new Array(w - l.length).fill(''))));
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  sh.getRange(2, 1).setFontWeight('bold').setFontColor(R.problemes.length ? '#b3261e' : '#15803d');
  return sh;
}

/* ================================== OUTILS ================================== */

function cm_lire_(ss, nom) {
  const sh = ss.getSheetByName(nom);
  if (!sh || sh.getLastRow() < 2) return { entetes: sh && sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim()) : [], lignes: [] };
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const h = v[0].map(x => String(x).trim());
  return { entetes: h, lignes: v.slice(1).map(r => { const o = {}; h.forEach((k, i) => { if (k && !(k in o)) o[k] = r[i]; }); return o; }) };
}
function cm_onglet_(ss, nom, entetes) {
  let sh = ss.getSheetByName(nom);
  if (!sh) {
    sh = ss.insertSheet(nom);
    sh.getRange(1, 1, 1, entetes.length).setValues([entetes]).setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}
function cm_cles_(sh) {
  const o = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(r => { o[String(r[0])] = 1; });
  return o;
}
function cm_date_(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (v === '' || v === null || v === undefined) return null;
  const s = String(v).trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s); return isNaN(d) ? null : d;
}
function cm_jour_(d) { return Utilities.formatDate(d, CM.TZ, 'yyyy-MM-dd'); }
function cm_num_(v) { const n = Number(String(v === undefined || v === null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }
function cm_r2_(v) { return Math.round(cm_num_(v) * 100) / 100; }
function cm_b_(v) { const s = String(v || '').trim().toUpperCase(); return s === 'B2' || s === 'VIP' ? 'B2' : 'B1'; }
function cm_nomB_(b) { return b === 'B2' ? 'Boutique VIP' : 'Boutique GP'; }
function cm_estDivers_(ref, produit) { return /^divers/i.test(String(ref || '').trim()) || /^divers/i.test(String(produit || '').trim()); }
function cm_eur_(v) { return cm_r2_(v).toFixed(2).replace('.', ',') + ' €'; }
function cm_signe_(v) { return (v > 0 ? '+' : '') + cm_eur_(v); }
