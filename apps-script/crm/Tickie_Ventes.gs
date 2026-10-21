/**
 * ============================================================================
 *  TICKIE_VENTES — les ventes en ligne (add-ons Tickie) remontent toutes seules
 *  Spacer's Toulouse Volley — CRM Boutique — Saison 2026-2027
 * ----------------------------------------------------------------------------
 *  Règle unique pour TOUS les articles vendus en ligne avec un billet :
 *   1. Vente  → 01_VENTES (source « tickie », boutique « WEB », CA, client, match)
 *               dès que la commande est lue dans Tickie (toutes les heures).
 *               L'article est « réservé » : il est encore physiquement en boutique.
 *   2. Remise → au stand, le bénévole scanne le billet : l'article sort du stock
 *               de la boutique qui le remet (Retraits_Billets.gs), une seule fois.
 *   3. Annulation / remboursement Tickie avant remise → ligne négative dans 01_VENTES.
 *  Plus aucun import CSV à faire (Tickie_Addons.gs ne touche plus au stock).
 *
 *  Prix : celui réellement payé sur Tickie (lu dans la transaction), sinon prix_vente du CRM.
 *  Comptabilité : rien n'est envoyé à Pennylane. Ces ventes y sont déjà via la reddition
 *  des comptes Tickie (TVA collectée par Tickie) ; 01_VENTES sert au suivi boutique.
 *  ⚠ Ne pas réimporter dans 01_VENTES les écritures Pennylane de la reddition
 *  (importPennylaneVentes) : le CA boutique en ligne serait compté deux fois.
 *
 *  Source : l'onglet 17_RETRAITS, tenu à jour depuis l'API Tickie par
 *  preparerRetraitsBillets() (Retraits_Billets.gs). Rapprochement article :
 *  tickie_variante_id de 03_PRODUITS (= variant_id Tickie), sinon le nom.
 *
 *  INSTALLATION (une fois) : ▶ installerSynchroTickie
 *   (remplace le déclencheur horaire des retraits : retraits + ventes toutes les heures)
 * ============================================================================
 */

const TV = {
  SOURCE: 'tickie',
  BOUTIQUE: 'WEB',
  MODE: 'Tickie (payé en ligne)',
  PREFIXE: 'TK-'
};

/** ▶ À lancer une fois : un seul déclencheur horaire qui lit Tickie puis enregistre les ventes. */
function installerSynchroTickie() {
  ScriptApp.getProjectTriggers()
    .filter(t => ['preparerRetraitsBillets', 'synchroTickieHoraire'].indexOf(t.getHandlerFunction()) !== -1)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('synchroTickieHoraire').timeBased().everyHours(1).create();
  const msg = synchroTickieHoraire();
  Logger.log('Synchro Tickie installée (toutes les heures). ' + msg);
  return msg;
}

/** Déclencheur horaire : commandes Tickie → 17_RETRAITS → 01_VENTES. */
function synchroTickieHoraire() {
  let m1 = '';
  try { m1 = preparerRetraitsBillets(); } catch (e) { m1 = 'retraits : ' + e.message; logDiag('Tickie', 'WARN', m1); }
  const m2 = synchroVentesTickie();
  return m1 + ' ' + m2;
}

/** Index des articles du CRM : variant_id Tickie → ligne produit ; nom normalisé → ligne. */
function tv_indexProduits_() {
  const P = sb_lireProduits_();
  const c = P.c;
  const colVar = ['tickie_variante_id', 'tickie_variant_id'].map(k => c[k]).filter(Boolean);
  const n = P.sh.getLastRow() - 1;
  const data = n > 0 ? P.sh.getRange(2, 1, n, P.sh.getLastColumn()).getValues() : [];
  const parVariante = {}, parNom = {};
  P.rows.forEach(x => {
    const r = data[x.ligne - 2] || [];
    colVar.forEach(col => { const v = String(r[col - 1] || '').trim(); if (v) parVariante[v] = x; });
    parNom[sb_norm_(x.produit)] = parNom[sb_norm_(x.produit)] || x;
    parNom[sb_norm_(x.modele)] = parNom[sb_norm_(x.modele)] || x;
  });
  return { P: P, trouver: (variante, nom) => parVariante[String(variante || '').trim()] || parNom[sb_norm_(String(nom || '').replace(/[–—]/g, '-'))] || parNom[sb_norm_(nom)] || null };
}

/** 17_RETRAITS → 01_VENTES : une ligne par transaction × article, idempotent (clé commande TK-…). */
function synchroVentesTickie() {
  return sb_avecVerrou_(() => {
    const sh = SpreadsheetApp.getActive().getSheetByName(RETRAITS_CFG.FEUILLE);
    if (!sh || sh.getLastRow() < 2) return 'Ventes Tickie : rien à enregistrer.';
    const I = retraitsIdx_(RETRAITS_ENTETES);
    const R = sh.getRange(2, 1, sh.getLastRow() - 1, RETRAITS_ENTETES.length).getValues();

    const shV = getSheet(SHEET.VENTES);
    const deja = new Set(shV.getLastRow() > 1 ? shV.getRange(2, COL_VENTE.COMMANDE + 1, shV.getLastRow() - 1, 1).getValues().map(r => String(r[0]).trim()) : []);
    const IX = tv_indexProduits_();
    const lignes = [], inconnus = [];
    const txCache = {};
    const prixPaye = (txId, variante, nom) => {
      if (!(txId in txCache)) {
        try { txCache[txId] = vivenuGet_('/transactions/' + txId); } catch (e) { txCache[txId] = null; }
      }
      const t = txCache[txId];
      if (!t || !Array.isArray(t.products)) return null;
      const p = t.products.find(x => String(x.productVariantId || '') === String(variante || '')) ||
                t.products.find(x => sb_norm_(x.name) === sb_norm_(nom));
      if (!p) return null;
      const q = Number(p.amount) || 1;
      const u = [p.price, p.unitPrice, p.regularPrice].map(Number).find(v => v > 0);
      if (u) return u;
      const tot = [p.total, p.totalPrice].map(Number).find(v => v > 0);
      return tot ? Math.round(tot / q * 100) / 100 : null;
    };

    R.forEach(r => {
      const cle = String(r[I.cle] || '').trim();
      if (!cle) return;
      const q = Number(r[I.quantite]) || 0;
      if (!(q > 0)) return;
      const k = TV.PREFIXE + cle, kAnnul = k + '-ANNUL';
      const annule = r[I.statut] === RETRAITS_STATUT.ANNULE;
      if (deja.has(k) && (!annule || deja.has(kAnnul))) return;
      const x = IX.trouver(r[I.variant_id], r[I.produit]);
      if (!x) { inconnus.push(String(r[I.produit])); }
      const lu = prixPaye(String(r[I.transaction_id]), r[I.variant_id], r[I.produit]);
      const pu = lu !== null ? lu : (x ? x.prix_vente : 0);
      const notePrix = lu !== null ? '' : 'prix CRM (prix Tickie non lu)';
      const d = r[I.date_achat] instanceof Date ? r[I.date_achat] : new Date();
      const base = (cleV, qte, note) => {
        const l = new Array(Math.max(shV.getLastColumn(), COL_VENTE.MODE_PAIEMENT + 1)).fill('');
        l[COL_VENTE.DATE] = cleV === kAnnul ? new Date() : d; l[COL_VENTE.SOURCE] = TV.SOURCE; l[COL_VENTE.COMMANDE] = cleV;
        l[COL_VENTE.EMAIL] = String(r[I.email] || ''); l[COL_VENTE.PRODUIT] = x ? x.produit : String(r[I.produit]);
        l[COL_VENTE.CATEGORIE] = x ? String(x.categorie || '') : ''; l[COL_VENTE.QUANTITE] = qte;
        l[COL_VENTE.PRIX_UNITAIRE] = pu; l[COL_VENTE.CA] = Math.round(qte * pu * 100) / 100;
        l[COL_VENTE.MATCH_ASSOCIE] = String(r[I.evenement] || ''); l[COL_VENTE.BOUTIQUE_ID] = TV.BOUTIQUE;
        l[COL_VENTE.SAISON] = saisonDepuisDate_(d); l[COL_VENTE.MODE_PAIEMENT] = TV.MODE + (note ? ' · ' + note : '');
        return l;
      };
      if (!deja.has(k)) { lignes.push(base(k, q, notePrix)); deja.add(k); }
      if (annule && !deja.has(kAnnul)) { lignes.push(base(kAnnul, -q, 'annulée / remboursée')); deja.add(kAnnul); }
    });

    if (lignes.length) shV.getRange(shV.getLastRow() + 1, 1, lignes.length, lignes[0].length).setValues(lignes);
    if (inconnus.length) logDiag('Tickie', 'WARN', 'Articles Tickie sans correspondance dans 03_PRODUITS (prix 0) : ' + inconnus.filter((v, i, a) => a.indexOf(v) === i).join(', '));
    if (lignes.length) { try { reconstruireSaisons(); } catch (e) { logDiag('Tickie', 'WARN', 'saisons : ' + e.message); } }
    const msg = 'Ventes Tickie : ' + lignes.length + ' ligne(s) ajoutée(s) à 01_VENTES.';
    logDiag('Tickie', 'INFO', msg);
    return msg;
  });
}

/**
 * Articles vendus en ligne, payés, pas encore remis : par réf. du CRM.
 * Ils sont encore en boutique mais ne sont plus à vendre. Les écharpes importées
 * par l'ancien CSV (déjà sorties du stock à l'import) ne sont pas comptées.
 */
function tv_reserves_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(RETRAITS_CFG.FEUILLE);
  if (!sh || sh.getLastRow() < 2) return {};
  const I = retraitsIdx_(RETRAITS_ENTETES);
  const IX = tv_indexProduits_();
  const importes = tv_dejaDecomptesImport_();
  const res = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, RETRAITS_ENTETES.length).getValues().forEach(r => {
    if (r[I.statut] === RETRAITS_STATUT.ANNULE) return;
    const reste = (Number(r[I.quantite]) || 0) - (Number(r[I.qte_remise]) || 0);
    if (!(reste > 0)) return;
    if (importes[String(r[I.transaction_id]) + '|' + retraitsCle_(r[I.produit])]) return;
    const x = IX.trouver(r[I.variant_id], r[I.produit]);
    if (x && x.ref) res[x.ref] = (res[x.ref] || 0) + reste;
  });
  return res;
}

/** Transactions × article déjà sorties du stock par l'ancien import CSV (TICKIE_ADDONS, avant cette règle). */
function tv_dejaDecomptesImport_() {
  const out = {};
  if (typeof TICKIE_CFG === 'undefined' || typeof TICKIE_JOURNAL_ENTETES === 'undefined') return out;
  const sh = SpreadsheetApp.getActive().getSheetByName(TICKIE_CFG.FEUILLE_JOURNAL);
  if (!sh || sh.getLastRow() < 2) return out;
  const J = retraitsIdx_(TICKIE_JOURNAL_ENTETES);
  sh.getRange(2, 1, sh.getLastRow() - 1, TICKIE_JOURNAL_ENTETES.length).getValues().forEach(r => {
    if (String(r[J['Stock décrémenté']]).toUpperCase() !== 'O') return;
    if (String(r[J['Note']] || '').indexOf('remise au stand') !== -1) return;   // décompté à la remise : pas par l'import
    out[String(r[J['ID transaction']]).trim() + '|' + retraitsCle_(r[J['Produit Tickie']])] = true;
  });
  return out;
}
