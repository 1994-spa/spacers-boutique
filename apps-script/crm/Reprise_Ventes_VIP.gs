/**
 * ============================================================================
 *  REPRISE DES VENTES VIP / PARTENAIRES DU JOURNAL D'ÉLISE DANS 01_VENTES
 *  Décision de Clément du 24/11/2026.
 * ----------------------------------------------------------------------------
 *  15 ventes notées à la main dans « Journal ventes » (classeur Inventaire 2026 2027)
 *  entre le 10/10 et le 07/11, absentes de 01_VENTES : 525,00 € TTC.
 *
 *  CHIFFRE D'AFFAIRES SEULEMENT, AUCUN MOUVEMENT DE STOCK :
 *  ces pièces sont déjà sorties du stock du CRM par les recalages sur le comptage
 *  d'Élise (rc_appliquer du 05/11, eb_appliquer des 20 et 21/11). Les sortir une
 *  seconde fois fausserait le stock.
 *
 *  Lignes écrites en source « hors_match » (comme la page Gestion) : elles comptent
 *  dans le CA de la saison et le journal du fichier boutique, mais pas dans les
 *  contrôles de caisse des tablettes (qui ne lisent que la source « tablette »).
 *  majInventaire lit 21_LIGNES_LIVE, pas 01_VENTES : « En boutique » n'est pas touché.
 *
 *  UTILISATION (projet Apps Script App_Boutique, classeur SPACERS_BOUTIQUE_CRM_V2) :
 *   1. ▶ rv_simuler  → journal d'exécution : les lignes qui seraient ajoutées.
 *   2. ▶ rv_appliquer → ajoute les lignes absentes. Relançable : une ligne déjà
 *      reprise (même n° « RV-… ») n'est jamais ajoutée deux fois.
 *   3. ▶ rv_annuler  → retire les lignes RV-… (en cas d'erreur).
 * ============================================================================
 */

const RV = {
  CRM_ID: '1mE9gSCtetFgnWEt0kA6cS2lcgJDe7oPRLDiXdGhH2EQ',
  SAISON: '2026-2027',
  // [jj/mm/aaaa, réf., quantité, prix unitaire TTC, lieu (B2 = VIP, R = autre), match, paiement, remarque du journal]
  LIGNES: [
    ['10/10/2026', 'MAP-BNU-L',  1, 55, 'B2', "Spacer's vs Narbonne", 'CB', ''],
    ['10/10/2026', 'GRD-TU',     1, 10, 'B2', "Spacer's vs Narbonne", 'CB', ''],
    ['10/10/2026', 'TSH-FRT-M',  1, 20, 'B2', "Spacer's vs Narbonne", 'CB', ''],
    ['10/10/2026', 'TSH-FRT-L',  1, 20, 'B2', "Spacer's vs Narbonne", 'CB', ''],
    ['10/10/2026', 'MAP-BLC-L',  1, 62, 'R',  "Spacer's vs Narbonne", 'CB', 'Autre · CB LEAD (prix noté 62 €)'],
    ['15/10/2026', 'ECH-TU',    12, 15, 'R',  'Hors match',           'Groupama', 'Autre · 12 écharpes Groupama (180 €)'],
    ['17/10/2026', 'TSH-NAR-M',  1, 35, 'B2', "Spacer's vs Sète",     'À confirmer', 'journal : « Marqué boutique accueil ? »'],
    ['17/10/2026', 'ECH-TU',     1, 15, 'B2', "Spacer's vs Sète",     'CB', ''],
    ['17/10/2026', 'MAP-BNU-M',  1, 55, 'B2', "Spacer's vs Sète",     'CB', ''],
    ['24/10/2026', 'TSH-FRT-L',  1, 20, 'B2', "Spacer's vs Bordeaux", 'CB', ''],
    ['07/11/2026', 'PCL-NAV-TU', 1,  5, 'B2', "Spacer's vs Plessis",  'À confirmer', 'paiement non noté'],
    ['07/11/2026', 'ECH-TU',     1, 15, 'B2', "Spacer's vs Plessis",  'À confirmer', 'paiement non noté'],
    ['07/11/2026', 'MUG-BLC-TU', 1,  8, 'B2', "Spacer's vs Plessis",  'À confirmer', 'paiement non noté'],
    ['07/11/2026', 'GRD-TU',     1, 10, 'B2', "Spacer's vs Plessis",  'À confirmer', 'paiement non noté'],
    ['07/11/2026', 'ECH-TU',     1, 15, 'B2', "Spacer's vs Plessis",  'À confirmer', 'paiement non noté'],
  ]
};

function rv_simuler() { return rv_executer_(false); }
function rv_appliquer() { return rv_executer_(true); }

function rv_executer_(appliquer) {
  const ss = rv_crm_();
  const sh = ss.getSheetByName('01_VENTES');
  if (!sh) throw new Error('Onglet 01_VENTES introuvable.');
  const nbCol = sh.getLastColumn();
  const entetes = sh.getRange(1, 1, 1, nbCol).getValues()[0].map(x => String(x).trim());
  const col = n => { const i = entetes.indexOf(n); if (i === -1) throw new Error('Colonne « ' + n + ' » absente de 01_VENTES.'); return i; };
  const C = { date: col('date'), source: col('source'), commande: col('commande'), produit: col('produit'), categorie: col('categorie'),
              quantite: col('quantite'), pu: col('prix_unitaire'), ca: col('CA'), match: col('match_associe'), boutique: col('boutique_id'),
              saison: col('saison'), mode: col('mode_paiement') };
  const deja = new Set(sh.getLastRow() > 1 ? sh.getRange(2, C.commande + 1, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0]).trim()) : []);
  const produits = rv_produits_(ss);

  const aAjouter = [], journal = [];
  let total = 0;
  RV.LIGNES.forEach((l, i) => {
    const [jour, ref, q, pu, lieu, match, mode, remarque] = l;
    const cle = 'RV-' + String(i + 1).padStart(2, '0') + '-' + ref + '-' + jour.slice(0, 5).replace('/', '');
    const p = produits[ref];
    if (!p) { journal.push('❌ ' + cle + ' : réf. ' + ref + ' absente de 03_PRODUITS (ligne non reprise)'); return; }
    if (deja.has(cle)) { journal.push('= ' + cle + ' déjà reprise'); return; }
    const [d, m, a] = jour.split('/').map(Number);
    const ligne = new Array(nbCol).fill('');
    ligne[C.date] = new Date(a, m - 1, d, 20, 0, 0);
    ligne[C.source] = 'hors_match';
    ligne[C.commande] = cle;
    ligne[C.produit] = p.produit;
    ligne[C.categorie] = p.categorie;
    ligne[C.quantite] = q;
    ligne[C.pu] = pu;
    ligne[C.ca] = Math.round(q * pu * 100) / 100;
    ligne[C.match] = match;
    ligne[C.boutique] = lieu;
    ligne[C.saison] = RV.SAISON;
    ligne[C.mode] = mode;
    aAjouter.push(ligne);
    total += q * pu;
    journal.push('+ ' + cle + ' · ' + jour + ' · ' + q + ' × ' + p.produit + ' à ' + pu + ' € · ' + (lieu === 'B2' ? 'VIP' : 'autre') +
                 ' · ' + mode + (remarque ? ' · ' + remarque : ''));
  });

  const titre = (appliquer ? 'REPRISE APPLIQUÉE' : 'SIMULATION (rien n\'est écrit)') + ' — ' + aAjouter.length + ' ligne(s), ' +
                total.toFixed(2).replace('.', ',') + ' € TTC, aucun mouvement de stock';
  if (appliquer && aAjouter.length) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      sh.getRange(sh.getLastRow() + 1, 1, aAjouter.length, nbCol).setValues(aAjouter);
    } finally { lock.releaseLock(); }
    try { if (typeof reconstruireSaisons === 'function') reconstruireSaisons(); } catch (e) { Logger.log('10_SAISONS : ' + e.message); }
    try { if (typeof logDiag === 'function') logDiag('rv_appliquer', 'INFO', titre); } catch (e) { /* facultatif */ }
  }
  Logger.log(titre + '\n' + journal.join('\n'));
  return titre;
}

/** Retire les lignes reprises (n° de commande commençant par « RV- »). */
function rv_annuler() {
  const sh = rv_crm_().getSheetByName('01_VENTES');
  const entetes = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim());
  const c = entetes.indexOf('commande') + 1;
  let n = 0;
  for (let r = sh.getLastRow(); r >= 2; r--) {
    if (/^RV-\d{2}-/.test(String(sh.getRange(r, c).getValue()))) { sh.deleteRow(r); n++; }
  }
  try { if (typeof reconstruireSaisons === 'function') reconstruireSaisons(); } catch (e) { /* facultatif */ }
  Logger.log(n + ' ligne(s) de reprise retirée(s) de 01_VENTES.');
  return n;
}

function rv_produits_(ss) {
  const sh = ss.getSheetByName('03_PRODUITS');
  const v = sh.getDataRange().getValues();
  const h = v[0].map(x => String(x).trim());
  const iP = h.indexOf('produit'), iC = h.indexOf('categorie'), iR = h.indexOf('ref_boutique');
  const o = {};
  v.slice(1).forEach(r => { const ref = String(r[iR] || '').trim(); if (ref) o[ref] = { produit: r[iP], categorie: r[iC] }; });
  return o;
}

function rv_crm_() {
  const actif = SpreadsheetApp.getActive();
  if (actif && actif.getId() === RV.CRM_ID) return actif;
  return SpreadsheetApp.openById(RV.CRM_ID);
}
