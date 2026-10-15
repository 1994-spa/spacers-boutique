/**
 * ============================================================================
 *  TRANSFERTS ENTRE BOUTIQUES — Spacer's Toulouse Volley — Saison 2026-2027
 * ----------------------------------------------------------------------------
 *  Les deux boutiques n'ont pas le même stock et il n'y a pas d'internet sur place.
 *  Quand un article manque au stand VIP, le volant va le chercher en Grand Public
 *  (ou rapporte un réassort). La tablette enregistre le transfert hors ligne et
 *  l'envoie au pilotage dès qu'elle a du réseau → onglet 24_TRANSFERTS_LIVE.
 *
 *  Ce fichier applique ces transferts à 03_PRODUITS :
 *    stock du stand de départ − qté, stock du stand d'arrivée + qté,
 *    deux mouvements TRANSFERT dans 11_MOUVEMENTS_STOCK (référence = ID transfert),
 *    colonne « Appliqué 03_PRODUITS » remplie : une ligne n'est jamais appliquée deux fois.
 *  La vente, elle, reste celle du stand qui a encaissé (synchro de fin de match inchangée).
 *
 *  INSTALLATION (une fois)
 *   1. Projet Apps Script du classeur CRM Boutique (là où est Stock_Boutique.gs) :
 *      ➕ Fichier › Script, nom « Transferts_Boutique », coller ce fichier.
 *   2. Sélectionner installerTransferts → ▶ Exécuter → autoriser.
 *      (déclencheur toutes les 10 min ; ▶ appliquerTransferts pour lancer à la main)
 *  Aucun nouveau déploiement Web App n'est nécessaire.
 * ============================================================================
 */

const TB = {
  ONGLET: '24_TRANSFERTS_LIVE',
  COL_FAIT: 'Appliqué 03_PRODUITS',
};

function installerTransferts() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'appliquerTransferts') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('appliquerTransferts').timeBased().everyMinutes(10).create();
  Logger.log('Déclencheur posé (10 min). ' + appliquerTransferts());
}

function appliquerTransferts() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TB.ONGLET);
  if (!sh || sh.getLastRow() < 2) return 'Transferts : aucun (onglet ' + TB.ONGLET + ' vide ou absent).';
  return sb_avecVerrou_(() => {
    const c = sb_assurerColonnes_(sh, [TB.COL_FAIT]);
    ['ID transfert', 'De', 'Vers', 'Produit', 'Qté'].forEach(k => {
      if (!c[k]) throw new Error('Colonne « ' + k + ' » absente de ' + TB.ONGLET + '.');
    });
    const n = sh.getLastRow() - 1;
    const data = sh.getRange(2, 1, n, sh.getLastColumn()).getValues();
    const g = (r, k) => (c[k] ? r[c[k] - 1] : '');
    const P = sb_lireProduits_();
    let nbOk = 0, nbPb = 0;

    data.forEach((r, i) => {
      if (String(g(r, TB.COL_FAIT)).trim()) return;   // déjà traitée (ou signalée)
      const id = String(g(r, 'ID transfert')).trim();
      const de = String(g(r, 'De')).trim(), vers = String(g(r, 'Vers')).trim();
      const q = Math.round(sb_num_(g(r, 'Qté')));
      const ref = String(g(r, 'Réf.')).trim(), nom = String(g(r, 'Produit')).trim();
      const marquer = v => sh.getRange(i + 2, c[TB.COL_FAIT]).setValue(v);
      if (!id || !(q > 0) || !SB.POINTS[de] || !SB.POINTS[vers] || de === vers) { marquer('⚠ ligne invalide'); nbPb++; return; }

      const x = P.rows.find(p => ref && p.ref === ref) || P.rows.find(p => sb_norm_(p.produit) === sb_norm_(nom));
      if (!x) { marquer('⚠ produit inconnu (' + (ref || nom) + ') : corriger puis vider cette cellule'); nbPb++; return; }

      const avant = x[de];
      sb_set_(P, x, 'stock_' + de, x[de] - q);
      sb_set_(P, x, 'stock_' + vers, x[vers] + q);
      const motif = String(g(r, 'Motif') || 'Transfert'), match = String(g(r, 'Match') || '');
      sb_mouvement_({ type: 'TRANSFERT', ref_boutique: x.ref, produit: x.produit, point: de, quantite: -q, cout_unitaire: x.cout,
        valeur: -q * x.cout, match: match, reference: id, commentaire: motif + ' tablette → ' + SB.POINTS[vers], auteur: 'tablette' });
      sb_mouvement_({ type: 'TRANSFERT', ref_boutique: x.ref, produit: x.produit, point: vers, quantite: q, cout_unitaire: x.cout,
        valeur: q * x.cout, match: match, reference: id, commentaire: motif + ' tablette ← ' + SB.POINTS[de], auteur: 'tablette' });
      const neg = avant - q < 0;
      marquer((neg ? '⚠ ' : '✓ ') + sb_fmt_(new Date()) + ' · ' + SB.POINTS[de] + ' ' + avant + '→' + (avant - q) + (neg ? ' (stock négatif : inventaire à vérifier)' : ''));
      if (neg) nbPb++; else nbOk++;
    });

    if (nbOk + nbPb && typeof rafraichirSynthese_ === 'function') {
      try { rafraichirSynthese_(); } catch (e) { console.warn('Synthèse stock : ' + e.message); }
    }
    return 'Transferts : ' + nbOk + ' appliqué(s), ' + nbPb + ' à vérifier.';
  });
}
