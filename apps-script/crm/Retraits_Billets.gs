/**
 * ============================================================
 *  Retraits_Billets.gs — CRM Boutique Spacers (Apps Script V3.5)
 *  Produits add-on achetés avec les billets (écharpe, maillot…)
 *  à remettre au stand, retrouvés en scannant le billet.
 * ============================================================
 *  Circuit :
 *   1. preparerRetraitsBillets() (menu, ou toutes les heures si le déclencheur est installé)
 *      lit dans Tickie les transactions COMPLETE qui contiennent des produits,
 *      récupère les codes-barres des billets de chaque transaction
 *      et tient à jour l'onglet 17_RETRAITS (une ligne par transaction × produit).
 *   2. doGet ?action=get_retraits&boutique=B1 → page Retraits de la tablette :
 *      empreintes SHA-256 des codes-barres (jamais les codes en clair), prénom,
 *      produits dus, déjà remis, et tailles disponibles pour les maillots.
 *   3. doPost { action: 'remises_retraits', remises: [...] } : remises saisies au stand.
 *      Idempotent (id de remise unique, journal 17b_REMISES).
 *
 *  Stock (règle unique depuis le 21/10/2026, voir Tickie_Ventes.gs) :
 *   TOUS les articles sortent du stock À LA REMISE, de la boutique qui remet
 *   (03_PRODUITS, colonne du stand + 11_MOUVEMENTS_STOCK RETRAIT_ADDON).
 *   - Maillots : réf. de la taille choisie au stand.
 *   - Autres (écharpe) : réf. trouvée par variant_id Tickie, sinon par le nom.
 *   - Exception transitoire : un article déjà sorti par l'ancien import CSV
 *     (TICKIE_ADDONS « Stock décrémenté = O ») n'est pas décompté une 2e fois.
 *   La vente (CA) est enregistrée dans 01_VENTES dès l'achat par synchroVentesTickie.
 *
 *  Dépendances (CRM_Boutique_V3.gs) : vivenuGet_, empreinteCode_, getSheet, colsParNom_,
 *  logDiag, slugify, COL_PROD, SHEET. Optionnelles : sb_mouvement_ (Stock_Boutique.gs),
 *  TICKIE_JOURNAL_ENTETES / TICKIE_CFG (Tickie_Addons.gs).
 * ============================================================
 */

const RETRAITS_CFG = {
  FEUILLE:          '17_RETRAITS',
  FEUILLE_REMISES:  '17b_REMISES',
  DEBUT_SAISON:     '2026-07-01',          // transactions plus anciennes ignorées
  PRODUIT_A_TAILLE: /maillot/i,            // produits dont la taille est demandée au stand
  STATUT_BILLET_KO: /invalid|cancel|refund|annul/i,
  PAGE:             50,
};

const RETRAITS_ENTETES = [
  'cle', 'transaction_id', 'evenement', 'date_evenement', 'date_achat', 'prenom', 'nom', 'email',
  'produit', 'variant_id', 'quantite', 'taille_requise', 'codes_billets',
  'qte_remise', 'tailles_remises', 'refs_remises', 'statut', 'remis_le', 'remis_par', 'stand',
  'stock_traite', 'maj'
];

const RETRAITS_ENTETES_REMISES = [
  'id_remise', 'horodatage', 'cle', 'transaction_id', 'produit', 'quantite', 'taille', 'ref',
  'stand', 'benevole', 'match', 'recu_le', 'stock'
];

const RETRAITS_STATUT = { A_REMETTRE: 'À remettre', PARTIEL: 'Partiel', REMIS: 'Remis', ANNULE: 'Annulé' };
const RETRAITS_ORDRE_TAILLES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'TU'];

// ------------------------------------------------------------
//  Menu
// ------------------------------------------------------------

function menuRetraitsBillets_() {
  SpreadsheetApp.getUi().createMenu('🎁 Retraits add-ons')
    .addItem('Préparer les retraits (Tickie → tablettes)', 'preparerRetraitsBilletsMenu')
    .addItem('Rapprocher avec le journal add-ons', 'rapprocherRetraitsMenu')
    .addSeparator()
    .addItem('Mise à jour automatique toutes les heures', 'installerDeclencheurRetraits')
    .addItem('Arrêter la mise à jour automatique', 'supprimerDeclencheurRetraits')
    .addToUi();
}

function preparerRetraitsBilletsMenu() {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(preparerRetraitsBillets() + ' Rechargez la page Retraits des tablettes.', '🎁 Retraits', 10);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Préparation des retraits impossible', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function rapprocherRetraitsMenu() {
  try {
    const n = retraitsRapprocherJournal_();
    SpreadsheetApp.getActiveSpreadsheet().toast(n + ' ligne(s) du journal add-ons marquée(s) « décomptée à la remise ».', '🎁 Retraits', 8);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Rapprochement impossible', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function installerDeclencheurRetraits() {
  supprimerDeclencheurRetraits(true);
  ScriptApp.newTrigger('preparerRetraitsBillets').timeBased().everyHours(1).create();
  SpreadsheetApp.getActiveSpreadsheet().toast('Les retraits seront mis à jour toutes les heures.', '🎁 Retraits', 6);
}

function supprimerDeclencheurRetraits(silencieux) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'preparerRetraitsBillets')
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (silencieux !== true) SpreadsheetApp.getActiveSpreadsheet().toast('Mise à jour automatique arrêtée.', '🎁 Retraits', 5);
}

// ------------------------------------------------------------
//  1. Tickie → 17_RETRAITS
// ------------------------------------------------------------

function preparerRetraitsBillets() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) throw new Error('Une autre mise à jour est en cours, réessayez dans une minute.');
  try {
    const debut = new Date(RETRAITS_CFG.DEBUT_SAISON + 'T00:00:00Z');

    // Événements (nom + date)
    const evenements = {};
    retraitsPaginer_('/events', {}, ev => {
      evenements[ev._id] = { nom: ev.name || '', date: ev.start ? new Date(ev.start) : '' };
    });

    // Transactions complètes avec produits
    const txs = [];
    retraitsPaginer_('/transactions', { status: 'COMPLETE' }, t => {
      if (!t.products || !t.products.length) return;
      if (t.createdAt && new Date(t.createdAt) < debut) return;
      txs.push(t);
    });

    // Codes-barres des billets : /tickets n'accepte pas transactionId → lecture par client, filtre sur la transaction
    const billetsParClient = {};
    const codesDe = t => {
      const cid = t.customerId;
      if (!cid) return [];
      if (!billetsParClient[cid]) {
        billetsParClient[cid] = [];
        retraitsPaginer_('/tickets', { customerId: cid }, b => billetsParClient[cid].push(b));
      }
      return billetsParClient[cid]
        .filter(b => b.transactionId === t._id && b.barcode && !RETRAITS_CFG.STATUT_BILLET_KO.test(String(b.status || '')))
        .map(b => String(b.barcode).trim());
    };

    // Lignes attendues : transaction × produit
    const attendues = {};
    txs.forEach(t => {
      const codes = codesDe(t);
      const ev = evenements[t.eventId] || { nom: '', date: '' };
      t.products.forEach(p => {
        const nom = String(p.name || '').trim() || 'Produit';
        const cle = t._id + '|' + slugify(nom);
        const a = attendues[cle] || (attendues[cle] = {
          cle, transaction_id: t._id, evenement: ev.nom, date_evenement: ev.date,
          date_achat: t.createdAt ? new Date(t.createdAt) : '',
          prenom: String(t.prename || '').trim(), nom: String(t.lastname || '').trim(),
          email: String(t.email || '').trim().toLowerCase(),
          produit: nom, variant_id: p.productVariantId || '', quantite: 0,
          taille_requise: RETRAITS_CFG.PRODUIT_A_TAILLE.test(nom) ? 'O' : 'N',
          codes_billets: codes.join(' ')
        });
        a.quantite += Number(p.amount) || 1;
      });
    });

    // Fusion avec l'existant : on ne touche jamais aux colonnes de remise
    const sh = retraitsFeuille_();
    const n = sh.getLastRow() - 1;
    const data = n > 0 ? sh.getRange(2, 1, n, RETRAITS_ENTETES.length).getValues() : [];
    const I = retraitsIdx_(RETRAITS_ENTETES);
    const maintenant = new Date();
    const vues = {};
    let nbAnnulees = 0;

    data.forEach(r => {
      const cle = String(r[I.cle]);
      const a = attendues[cle];
      if (a) {
        ['evenement', 'date_evenement', 'prenom', 'nom', 'email', 'produit', 'variant_id', 'quantite', 'taille_requise', 'codes_billets']
          .forEach(k => { r[I[k]] = a[k]; });
        r[I.statut] = retraitsStatut_(r[I.quantite], r[I.qte_remise], r[I.statut]);
        r[I.maj] = maintenant;
        vues[cle] = true;
      } else if (r[I.statut] !== RETRAITS_STATUT.REMIS && r[I.statut] !== RETRAITS_STATUT.ANNULE && !(Number(r[I.qte_remise]) > 0)) {
        r[I.statut] = RETRAITS_STATUT.ANNULE;   // transaction plus COMPLETE (remboursée / annulée)
        r[I.maj] = maintenant;
        nbAnnulees++;
      }
    });

    let nbNouvelles = 0;
    Object.keys(attendues).forEach(cle => {
      if (vues[cle]) return;
      const a = attendues[cle];
      const r = RETRAITS_ENTETES.map(h => (h in a ? a[h] : ''));
      r[I.qte_remise] = 0;
      r[I.statut] = RETRAITS_STATUT.A_REMETTRE;
      r[I.maj] = maintenant;
      data.push(r);
      nbNouvelles++;
    });

    if (data.length) {
      sh.getRange(2, 1, data.length, RETRAITS_ENTETES.length).setValues(data);
      sh.getRange(2, I.codes_billets + 1, data.length, 1).setNumberFormat('@');
    }

    const sansCode = data.filter(r => r[I.statut] !== RETRAITS_STATUT.ANNULE && !String(r[I.codes_billets]).trim()).length;
    try { retraitsRapprocherJournal_(); } catch (e) { logDiag('Retraits', 'WARN', 'rapprochement journal : ' + e.message); }

    const msg = `${txs.length} commande(s) avec produits · ${nbNouvelles} nouvelle(s) ligne(s)`
      + (nbAnnulees ? ` · ${nbAnnulees} annulée(s)` : '')
      + (sansCode ? ` · ⚠ ${sansCode} ligne(s) sans code-barres (recherche par nom à la tablette)` : '') + '.';
    logDiag('Retraits', 'INFO', msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------
//  2. Liste pour les tablettes
// ------------------------------------------------------------

/**
 * { retraits: [{ id, h:[empreintes], p:prénom, i:initiale, ev, items:[{ cle, produit, q, qr, taille, tailles, remis_le, remis_par }] }],
 *   tailles: { slug(produit): [{ ref, taille, stock }] } }
 */
function getRetraitsPourTablette_(boutique) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RETRAITS_CFG.FEUILLE);
  if (!sh || sh.getLastRow() < 2) return { retraits: [], tailles: {} };
  const I = retraitsIdx_(RETRAITS_ENTETES);
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, RETRAITS_ENTETES.length).getValues();

  const parTx = {};
  const produitsATaille = {};
  data.forEach(r => {
    if (r[I.statut] === RETRAITS_STATUT.ANNULE) return;
    const tx = String(r[I.transaction_id]);
    const e = parTx[tx] || (parTx[tx] = {
      id: tx,
      h: String(r[I.codes_billets]).split(/\s+/).filter(String).map(empreinteCode_),
      p: String(r[I.prenom] || ''),
      i: String(r[I.nom] || '').charAt(0).toUpperCase(),
      ev: String(r[I.evenement] || ''),
      items: []
    });
    const taille = r[I.taille_requise] === 'O';
    if (taille) produitsATaille[slugify(r[I.produit])] = String(r[I.produit]);
    e.items.push({
      cle: String(r[I.cle]), produit: String(r[I.produit]),
      q: Number(r[I.quantite]) || 0, qr: Number(r[I.qte_remise]) || 0, taille,
      tailles: String(r[I.tailles_remises] || ''),
      remis_le: r[I.remis_le] instanceof Date ? r[I.remis_le].toISOString() : String(r[I.remis_le] || ''),
      remis_par: String(r[I.remis_par] || '')
    });
  });

  const tailles = {};
  Object.keys(produitsATaille).forEach(k => { tailles[k] = retraitsTaillesDisponibles_(produitsATaille[k], boutique); });
  return { retraits: Object.keys(parTx).map(k => parTx[k]), tailles };
}

/** Tailles d'un produit dans 03_PRODUITS (rapprochement par tickie_produit, modele puis nom). */
function retraitsTaillesDisponibles_(produit, boutique) {
  const sh = getSheet(SHEET.PRODUITS);
  const data = sh.getDataRange().getValues();
  const c = colsParNom_(sh);
  const cle = retraitsCle_(produit);
  const colStock = boutique === 'B2' ? COL_PROD.STOCK_B2 : COL_PROD.STOCK_B1;
  const colTickie = Object.keys(c).find(h => retraitsCle_(h).indexOf('tickiepro') === 0);
  // Passes : égalité sur tickie_produit, modele, nom ; puis nom commençant par le libellé (« Maillot Bleu Nuit – M »)
  const passes = [colTickie ? c[colTickie] : 0, c.modele || 0, COL_PROD.NOM + 1].filter(x => x > 0)
    .map(col => ({ col, ok: v => retraitsCle_(v) === cle }));
  passes.push({ col: COL_PROD.NOM + 1, ok: v => cle.length > 3 && retraitsCle_(v).indexOf(cle) === 0 });

  for (const passe of passes) {
    const col = passe.col;
    const lignes = [];
    for (let i = 1; i < data.length; i++) {
      if (!passe.ok(data[i][col - 1])) continue;
      const actif = data[i][COL_PROD.ACTIF];
      if (actif === false || /^(false|faux|non|n)$/i.test(String(actif).trim())) continue;
      lignes.push({
        ref: c.ref_boutique ? String(data[i][c.ref_boutique - 1] || '').trim() : '',
        nom: String(data[i][COL_PROD.NOM] || '').trim(),
        taille: c.taille ? String(data[i][c.taille - 1] || '').trim().toUpperCase() : '',
        stock: Number(data[i][colStock]) || 0
      });
    }
    if (lignes.length) {
      lignes.forEach(l => { if (!l.taille) l.taille = (l.nom.match(/\b(XXS|XS|S|M|L|XL|XXL|2XL|3XL)\b\s*$/i) || ['', '?'])[1].toUpperCase(); });
      lignes.sort((a, b) => retraitsRangTaille_(a.taille) - retraitsRangTaille_(b.taille));
      return lignes;
    }
  }
  logDiag('Retraits', 'WARN', `Aucune taille trouvée dans 03_PRODUITS pour « ${produit} » (tickie_produit / modele / nom).`);
  return [];
}

// ------------------------------------------------------------
//  3. Remises envoyées par les tablettes
// ------------------------------------------------------------

/**
 * payload.remises = [{ id, horodatage, cle, produit, quantite, taille, ref, stand, benevole, match }]
 * Une remise = une unité ou un lot d'un même produit (et d'une même taille pour les maillots).
 */
function enregistrerRemisesRetraits_(payload) {
  const remises = Array.isArray(payload.remises) ? payload.remises : [];
  const res = { enregistrees: 0, doublons: 0, inconnues: 0, stock_negatif: [] };
  if (!remises.length) return res;

  const shR = retraitsFeuille_();
  const shJ = retraitsFeuilleRemises_();
  const I = retraitsIdx_(RETRAITS_ENTETES);
  const nR = shR.getLastRow() - 1;
  const data = nR > 0 ? shR.getRange(2, 1, nR, RETRAITS_ENTETES.length).getValues() : [];
  const ligneDe = {};
  data.forEach((r, k) => { ligneDe[String(r[I.cle])] = k; });

  const idsVus = new Set(shJ.getLastRow() > 1 ? shJ.getRange(2, 1, shJ.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : []);

  const shP = getSheet(SHEET.PRODUITS);
  const prod = shP.getDataRange().getValues();
  const cP = colsParNom_(shP);
  const ligneProduit = {};
  if (cP.ref_boutique) for (let i = 1; i < prod.length; i++) {
    const ref = String(prod[i][cP.ref_boutique - 1] || '').trim();
    if (ref) ligneProduit[ref] = i;
  }

  const journal = [];
  const maintenant = new Date();
  let modifie = false;

  remises.forEach(rm => {
    const id = String(rm.id || '').trim();
    if (!id) return;
    if (idsVus.has(id)) { res.doublons++; return; }
    idsVus.add(id);

    const q = Math.max(1, Number(rm.quantite) || 1);
    const stand = String(rm.stand || 'B1').trim() === 'B2' ? 'B2' : 'B1';
    const quand = rm.horodatage ? new Date(rm.horodatage) : maintenant;
    const k = ligneDe[String(rm.cle || '')];
    let etatStock = '';

    if (k === undefined) {
      res.inconnues++;
      etatStock = 'ligne 17_RETRAITS introuvable';
      logDiag('Retraits', 'WARN', `Remise ${id} : clé « ${rm.cle} » absente de ${RETRAITS_CFG.FEUILLE}.`);
    } else {
      const r = data[k];
      r[I.qte_remise] = (Number(r[I.qte_remise]) || 0) + q;
      if (rm.taille) r[I.tailles_remises] = retraitsAjouter_(r[I.tailles_remises], q > 1 ? q + '×' + rm.taille : rm.taille);
      if (rm.ref) r[I.refs_remises] = retraitsAjouter_(r[I.refs_remises], q > 1 ? q + '×' + rm.ref : rm.ref);
      r[I.remis_le] = quand;
      r[I.remis_par] = String(rm.benevole || '').trim();
      r[I.stand] = stand;
      r[I.statut] = retraitsStatut_(r[I.quantite], r[I.qte_remise], r[I.statut]);
      r[I.maj] = maintenant;
      if (Number(r[I.qte_remise]) > Number(r[I.quantite])) {
        logDiag('Retraits', 'WARN', `Remise ${id} : ${r[I.qte_remise]} remis pour ${r[I.quantite]} acheté(s) (${r[I.produit]}, transaction ${r[I.transaction_id]}).`);
      }
      modifie = true;

      // Stock : tous les articles sortent à la remise (sauf déjà sortis par l'ancien import CSV)
      if (r[I.taille_requise] !== 'O' && typeof tv_dejaDecomptesImport_ === 'function' && !rm.ref) {
        const x = typeof tv_indexProduits_ === 'function' ? tv_indexProduits_().trouver(r[I.variant_id], r[I.produit]) : null;
        if (x && x.ref) rm.ref = x.ref;
      }
      const dejaImporte = typeof tv_dejaDecomptesImport_ === 'function' &&
        !!tv_dejaDecomptesImport_()[String(r[I.transaction_id]) + '|' + retraitsCle_(r[I.produit])];
      if (dejaImporte) {
        etatStock = 'déjà sorti du stock par l\'import add-ons';
      } else if (r[I.taille_requise] === 'O' || typeof tv_dejaDecomptesImport_ === 'function') {
        const ref = String(rm.ref || '').trim();
        const i = ligneProduit[ref];
        if (!ref || i === undefined) {
          etatStock = 'réf « ' + ref + ' » introuvable : stock à corriger à la main';
          logDiag('Retraits', 'WARN', `Remise ${id} : ${etatStock}.`);
        } else {
          const col = stand === 'B2' ? COL_PROD.STOCK_B2 : COL_PROD.STOCK_B1;
          const apres = (Number(prod[i][col]) || 0) - q;
          prod[i][col] = apres;
          shP.getRange(i + 1, col + 1).setValue(apres);
          if (apres < 0) res.stock_negatif.push(ref);
          if (typeof sb_mouvement_ === 'function') {
            try {
              const cout = Number(prod[i][COL_PROD.COUT]) || 0;
              sb_mouvement_({ type: 'RETRAIT_ADDON', ref_boutique: ref, produit: String(prod[i][COL_PROD.NOM]), point: stand,
                quantite: -q, cout_unitaire: cout, valeur: -q * cout, match: String(rm.match || r[I.evenement] || ''),
                reference: String(r[I.transaction_id]), commentaire: 'add-on Tickie remis au stand (taille ' + (rm.taille || '?') + ')' });
            } catch (eMvt) { /* le journal ne doit jamais bloquer la remise */ }
          }
          etatStock = 'décompté ' + stand;
          r[I.stock_traite] = 'O';
        }
      } else {
        etatStock = 'géré par l\'import add-ons';   // Tickie_Ventes.gs absent : ancien fonctionnement
      }
    }

    journal.push([id, quand, String(rm.cle || ''), k === undefined ? '' : data[k][I.transaction_id], String(rm.produit || ''),
      q, String(rm.taille || ''), String(rm.ref || ''), stand, String(rm.benevole || ''), String(rm.match || ''), maintenant, etatStock]);
    res.enregistrees++;
  });

  if (modifie) shR.getRange(2, 1, data.length, RETRAITS_ENTETES.length).setValues(data);
  if (journal.length) shJ.getRange(shJ.getLastRow() + 1, 1, journal.length, RETRAITS_ENTETES_REMISES.length).setValues(journal);

  try { retraitsRapprocherJournal_(); } catch (e) { logDiag('Retraits', 'WARN', 'rapprochement journal : ' + e.message); }
  if (typeof rafraichirSynthese_ === 'function') { try { rafraichirSynthese_(); } catch (e) { /* non bloquant */ } }
  if (res.stock_negatif.length) logDiag('Retraits', 'WARN', 'Stock négatif après remise : ' + res.stock_negatif.join(', '));
  logDiag('Retraits', 'INFO', `${res.enregistrees} remise(s) enregistrée(s), ${res.doublons} doublon(s), ${res.inconnues} inconnue(s).`);
  return res;
}

// ------------------------------------------------------------
//  Rapprochement avec TICKIE_ADDONS (Tickie_Addons.gs)
// ------------------------------------------------------------

/**
 * Les maillots dont le stock a été décompté à la remise sont marqués « Stock décrémenté = O »
 * dans le journal TICKIE_ADDONS, pour que tickieAppliquerStock ne les décompte pas une 2e fois.
 * Renvoie le nombre de lignes du journal marquées.
 */
function retraitsRapprocherJournal_() {
  if (typeof TICKIE_JOURNAL_ENTETES === 'undefined' || typeof TICKIE_CFG === 'undefined') return 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shJ = ss.getSheetByName(TICKIE_CFG.FEUILLE_JOURNAL);
  const shR = ss.getSheetByName(RETRAITS_CFG.FEUILLE);
  if (!shJ || shJ.getLastRow() < 2 || !shR || shR.getLastRow() < 2) return 0;

  const I = retraitsIdx_(RETRAITS_ENTETES);
  const traites = {};
  shR.getRange(2, 1, shR.getLastRow() - 1, RETRAITS_ENTETES.length).getValues().forEach(r => {
    if (r[I.stock_traite] !== 'O') return;
    traites[String(r[I.transaction_id]) + '|' + retraitsCle_(r[I.produit])] = String(r[I.refs_remises] || '');
  });

  const J = retraitsIdx_(TICKIE_JOURNAL_ENTETES);
  const n = shJ.getLastRow() - 1;
  const jv = shJ.getRange(2, 1, n, TICKIE_JOURNAL_ENTETES.length).getValues();
  let nb = 0;
  const MARQUE = '[Stock] décompté à la remise au stand (17_RETRAITS)';
  jv.forEach((row, k) => {
    const refs = traites[String(row[J['ID transaction']]).trim() + '|' + retraitsCle_(row[J['Produit Tickie']])];
    if (refs === undefined) return;
    const l = k + 2;
    if (String(row[J['Stock décrémenté']]).toUpperCase() === 'O') {
      // Déjà marquée par ce module : on met seulement à jour les réfs (remises successives)
      if (String(row[J['Note']]).indexOf(MARQUE) >= 0 && String(row[J['Réf produit']]) !== refs) shJ.getRange(l, J['Réf produit'] + 1).setValue(refs);
      return;
    }
    shJ.getRange(l, J['Réf produit'] + 1).clearDataValidations().setBackground(null).setValue(refs);
    shJ.getRange(l, J['Note'] + 1).setValue(retraitsAjouter_(
      String(row[J['Note']] || '').split(' | ').filter(p => p.indexOf('[Stock] ') !== 0).join(' | '),
      MARQUE, ' | '));
    shJ.getRange(l, J['Stock décrémenté'] + 1).setValue('O');
    nb++;
  });
  return nb;
}

// ------------------------------------------------------------
//  Utilitaires
// ------------------------------------------------------------

function retraitsPaginer_(path, params, cb) {
  let skip = 0, total = Infinity, garde = 0;
  while (skip < total && garde++ < 200) {
    const d = vivenuGet_(path, Object.assign({}, params, { top: RETRAITS_CFG.PAGE, skip }));
    const rows = Array.isArray(d) ? d : (d.rows || d.docs || []);
    total = Number(d.total);
    if (!isFinite(total)) total = rows.length < RETRAITS_CFG.PAGE ? skip + rows.length : Infinity;
    if (!rows.length) break;
    rows.forEach(cb);
    skip += rows.length;
  }
}

function retraitsFeuille_() {
  return retraitsCreerFeuille_(RETRAITS_CFG.FEUILLE, RETRAITS_ENTETES, sh => {
    sh.getRange('D:E').setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange('R:R').setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange('V:V').setNumberFormat('dd/MM/yyyy HH:mm');
  });
}

function retraitsFeuilleRemises_() {
  return retraitsCreerFeuille_(RETRAITS_CFG.FEUILLE_REMISES, RETRAITS_ENTETES_REMISES, sh => {
    sh.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange('L:L').setNumberFormat('dd/MM/yyyy HH:mm');
  });
}

function retraitsCreerFeuille_(nom, entetes, format) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nom);
  if (!sh) {
    sh = ss.insertSheet(nom);
    sh.getRange(1, 1, 1, entetes.length).setValues([entetes])
      .setBackground('#001E2D').setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setFrozenRows(1);
    if (format) format(sh);
  } else {
    const actuels = sh.getRange(1, 1, 1, entetes.length).getValues()[0].map(String);
    if (actuels.join('|') !== entetes.join('|')) {
      throw new Error(`En-têtes inattendus dans ${nom} : ne pas réordonner ni renommer ses colonnes.`);
    }
  }
  return sh;
}

function retraitsIdx_(entetes) {
  const m = {};
  entetes.forEach((h, i) => { m[h] = i; });
  return m;
}

function retraitsStatut_(quantite, remis, actuel) {
  if (actuel === RETRAITS_STATUT.ANNULE && !(Number(remis) > 0)) return RETRAITS_STATUT.A_REMETTRE; // de nouveau COMPLETE
  const q = Number(quantite) || 0, r = Number(remis) || 0;
  if (r <= 0) return RETRAITS_STATUT.A_REMETTRE;
  return r >= q ? RETRAITS_STATUT.REMIS : RETRAITS_STATUT.PARTIEL;
}

function retraitsCle_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function retraitsRangTaille_(t) {
  const i = RETRAITS_ORDRE_TAILLES.indexOf(String(t).toUpperCase());
  return i < 0 ? 99 : i;
}

function retraitsAjouter_(liste, valeur, sep) {
  const a = String(liste || '').trim();
  return a ? a + (sep || ', ') + valeur : valeur;
}