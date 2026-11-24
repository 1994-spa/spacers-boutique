/**
 * ============================================================
 *  Benevoles_Remise.gs — CRM Boutique Spacers (Apps Script)
 *  Remise bénévole au stand, sur scan de l'accréditation.
 * ============================================================
 *  Avantage de palier de l'appli bénévoles (Satellite −10 %, etc.),
 *  valable à la boutique du Palais uniquement, sans débit de points.
 *
 *  Le CRM sert de relais entre les tablettes et l'appli bénévoles :
 *   1. doGet ?action=get_benevoles → liste pour les tablettes, SOUS FORME
 *      D'EMPREINTES SHA-256 des QR d'accréditation (jamais le QR en clair),
 *      avec prénom, initiale du nom et taux de remise. Utilisable hors ligne.
 *   2. doPost { action: 'remises_benevoles', remises: [...] } → journal des
 *      remises accordées, transmis à l'appli bénévoles. Idempotent
 *      (identifiant de vente unique).
 *
 *  INSTALLATION (une fois)
 *   A. Ajouter ce fichier au projet Apps Script « CRM Boutique ».
 *   B. Paramètres du projet → Propriétés du script :
 *        BENEVOLES_SUPABASE_ANON = clé publique (anon) de l'appli bénévoles
 *                                  (celle de public/config.js du dépôt spacers-benevoles)
 *        BENEVOLES_BOUTIQUE_CLE  = clé partagée, à lire dans Supabase :
 *                                  select value from public._app_secrets where key = 'boutique_cle';
 *   C. Dans CRM_Boutique_V3.gs, ajouter les deux branchements ci-dessous.
 *   D. Exécuter testBenevolesRemise() : le journal doit afficher le nombre d'accréditations.
 *   E. Déployer → Gérer les déploiements → ✏️ → Nouvelle version.
 *
 *  BRANCHEMENTS À AJOUTER DANS CRM_Boutique_V3.gs
 *
 *   Dans doGet(), à côté de « if (action === 'get_abonnes') » :
 *
 *     if (action === 'get_benevoles') {
 *       if (typeof bn_getBenevolesPourTablette_ !== 'function') return jsonResponse({ status: 'error', message: 'Benevoles_Remise.gs absent du projet Apps Script' });
 *       return jsonResponse(Object.assign({ status: 'ok', app: 'boutique' }, bn_getBenevolesPourTablette_()));
 *     }
 *
 *   Dans doPost(), à côté de « if (action === 'transferts') » :
 *
 *     if (action === 'remises_benevoles') {
 *       if (typeof bn_recevoirRemises_ !== 'function') return jsonResponse({ status: 'error', message: 'Benevoles_Remise.gs absent du projet Apps Script' });
 *       return jsonResponse(Object.assign({ status: 'ok' }, bn_recevoirRemises_(payload.remises || [])));
 *     }
 *
 *  Dépendances (CRM_Boutique_V3.gs) : jsonResponse, logDiag (optionnelle).
 * ============================================================
 */

const BENEVOLES_CFG = {
  URL_DEFAUT: 'https://xphuolvbamdkizydveij.supabase.co',
  PROP_URL:   'BENEVOLES_SUPABASE_URL',   // optionnelle : à renseigner seulement si l'adresse change
  PROP_ANON:  'BENEVOLES_SUPABASE_ANON',
  PROP_CLE:   'BENEVOLES_BOUTIQUE_CLE',
  CACHE_CLE:  'bn_liste_tablettes_v1',
  CACHE_S:    300,                        // la liste est gardée 5 min : un match = quelques appels seulement
  LOT_MAX:    200,
};

function bn_journal_(niveau, message) {
  try { if (typeof logDiag === 'function') logDiag('Benevoles_Remise', niveau, message); } catch (e) {}
}

/** Appelle une fonction de l'appli bénévoles. Lève une erreur lisible si la configuration manque. */
function bn_rpc_(fonction, corps) {
  const props = PropertiesService.getScriptProperties();
  const url  = (props.getProperty(BENEVOLES_CFG.PROP_URL) || BENEVOLES_CFG.URL_DEFAUT).replace(/\/+$/, '');
  const anon = props.getProperty(BENEVOLES_CFG.PROP_ANON);
  const cle  = props.getProperty(BENEVOLES_CFG.PROP_CLE);
  if (!anon || !cle) throw new Error('Propriétés du script manquantes : ' + BENEVOLES_CFG.PROP_ANON + ' et ' + BENEVOLES_CFG.PROP_CLE);

  const rep = UrlFetchApp.fetch(url + '/rest/v1/rpc/' + fonction, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: anon, Authorization: 'Bearer ' + anon },
    payload: JSON.stringify(Object.assign({ p_cle: cle }, corps || {})),
    muteHttpExceptions: true,
  });
  const code = rep.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Appli bénévoles : erreur ' + code);
  const d = JSON.parse(rep.getContentText() || '{}');
  if (!d || d.ok !== true) throw new Error('Appli bénévoles : ' + ((d && d.code) || 'réponse invalide'));
  return d;
}

/** Liste minimale pour les tablettes : empreinte, prénom, initiale, taux (en %). Aucun QR, nom ni e-mail en clair. */
function bn_getBenevolesPourTablette_() {
  const cache = CacheService.getScriptCache();
  const garde = cache.get(BENEVOLES_CFG.CACHE_CLE);
  if (garde) { try { return JSON.parse(garde); } catch (e) {} }

  const d = bn_rpc_('boutique_liste_benevoles', {});
  const benevoles = (d.benevoles || [])
    .filter(b => b && b.h && Number(b.t) > 0)
    .map(b => ({ h: String(b.h), p: String(b.p || '').trim(), f: String(b.f || '').trim(), t: Number(b.t) }));
  const resultat = { maj: new Date().toISOString(), benevoles: benevoles };
  try { cache.put(BENEVOLES_CFG.CACHE_CLE, JSON.stringify(resultat), BENEVOLES_CFG.CACHE_S); } catch (e) {} // liste trop longue pour le cache : sans gravité
  return resultat;
}

/**
 * Remises accordées au stand : [{ id, h, pct, brut, remise, ts, boutique }].
 * Transmises telles quelles à l'appli bénévoles, qui ignore les doublons (id de vente unique).
 * En cas d'échec, une erreur est levée : la tablette garde le lot et le renverra.
 */
function bn_recevoirRemises_(remises) {
  const lot = (Array.isArray(remises) ? remises : [])
    .filter(r => r && r.id && r.h)
    .slice(0, BENEVOLES_CFG.LOT_MAX)
    .map(r => ({
      id: String(r.id), h: String(r.h).toLowerCase(), pct: Number(r.pct) || 0,
      brut: Number(r.brut) || 0, remise: Number(r.remise) || 0,
      ts: String(r.ts || new Date().toISOString()), boutique: String(r.boutique || ''),
    }));
  if (!lot.length) return { recues: 0, enregistrees: 0, ignorees: 0 };

  const d = bn_rpc_('boutique_enregistrer_remises', { p_remises: lot });
  bn_journal_('INFO', 'Remises bénévoles : ' + d.recues + ' reçue(s), ' + d.enregistrees + ' enregistrée(s), ' + d.ignorees + ' ignorée(s)');
  return { recues: d.recues, enregistrees: d.enregistrees, ignorees: d.ignorees };
}

/** À lancer une fois après l'installation : vérifie la configuration et la liaison avec l'appli bénévoles. */
function testBenevolesRemise() {
  CacheService.getScriptCache().remove(BENEVOLES_CFG.CACHE_CLE);
  const r = bn_getBenevolesPourTablette_();
  const parTaux = {};
  r.benevoles.forEach(b => { parTaux[b.t] = (parTaux[b.t] || 0) + 1; });
  const detail = Object.keys(parTaux).sort().map(t => parTaux[t] + ' à −' + t + ' %').join(', ');
  Logger.log('Liaison OK : ' + r.benevoles.length + ' accréditation(s) avec remise' + (detail ? ' (' + detail + ')' : ''));
  return r.benevoles.length;
}
