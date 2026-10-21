/**
 * ============================================================================
 *  GESTION STOCK — API de l'espace « Gestion » (gestion.html)
 *  Spacer's Toulouse Volley — Saison 2026-2027
 * ----------------------------------------------------------------------------
 *  La personne qui gère le stock ne travaille plus dans les onglets : elle utilise
 *  https://spacers-boutique.spacersytb.workers.dev/gestion.html (ordinateur).
 *  Ce fichier expose les fonctions de Stock_Boutique.gs à cette page, protégées
 *  par un code PIN :
 *    GET  ?action=gestion_etat&pin=XXXX[&match=…]   → stock, matchs, bilan, historique
 *    POST { action:'gestion', pin, op, par, data }    → reception | repartition |
 *         transfert | inventaire | dotation | vente_hors_match
 *  Règle : tout article et tout stock passent par le CRM ; le classeur
 *  « Inventaire 2026 2027 » n'en est qu'une copie (aucune saisie de stock dedans).
 *  Chaque écriture passe par les fonctions existantes (verrou, 03_PRODUITS,
 *  11_MOUVEMENTS_STOCK, 02_ACHATS, synthèse) : le Sheet « Inventaire 2026 2027 »
 *  est mis à jour par Inventaire_Boutique.gs comme aujourd'hui.
 *
 *  INSTALLATION (une fois)
 *   1. Projet Apps Script du classeur CRM Boutique : ➕ Fichier › Script,
 *      nom « Gestion_API », coller ce fichier.
 *   2. Remplacer CRM_Boutique_V3.gs et Stock_Boutique.gs par les versions du dépôt
 *      (2 lignes ajoutées dans doGet/doPost, 1 dans sb_mouvement_).
 *   3. Paramètres du projet › Propriétés du script : GESTION_PIN = un code à 4–6 chiffres.
 *   4. Déployer › Gérer les déploiements › ✏️ › Nouvelle version (URL inchangée).
 * ============================================================================
 */

var GESTION_AUTEUR_ = '';   // nom saisi dans la page, repris dans 11_MOUVEMENTS_STOCK (colonne auteur)

const GA = {
  OPS: {
    reception:   p => enregistrerReception(p),
    repartition: p => enregistrerRepartition(p),
    transfert:   p => enregistrerTransfert(p),
    inventaire:  p => enregistrerInventaire(p),
    dotation:    p => enregistrerDotation(p),
    vente_hors_match: p => ga_venteHorsMatch_(p)
  },
  TYPES_SORTIE_MATCH: ['VENTE_COMPTOIR', 'OFFERT_CAISSE']
};

/** Contrôle du PIN (propriété GESTION_PIN). Sans propriété : refus. */
function ga_verifierPin_(pin) {
  const attendu = PropertiesService.getScriptProperties().getProperty('GESTION_PIN');
  if (!attendu) throw new Error('Code PIN non configuré (propriété GESTION_PIN du script).');
  if (String(pin || '').trim() !== String(attendu).trim()) throw new Error('Code PIN incorrect.');
}

/** Appelé par doGet. */
function ga_doGet_(e) {
  ga_verifierPin_(e.parameter.pin);
  return ga_etat_(e.parameter.match || '');
}

/** Appelé par doPost AVANT le verrou global (les fonctions Stock_Boutique prennent le leur). */
function ga_doPost_(payload) {
  ga_verifierPin_(payload.pin);
  const op = GA.OPS[payload.op];
  if (!op) throw new Error('Opération inconnue : ' + payload.op);
  const par = String(payload.par || '').trim();
  if (!par) throw new Error('Indiquez votre prénom.');
  GESTION_AUTEUR_ = par + ' (gestion)';
  const data = payload.data || {};
  if (payload.op === 'inventaire' && !data.commentaire) data.commentaire = 'Inventaire — ' + par;
  if (payload.op === 'dotation' && !data.demandeur) data.demandeur = par;
  const message = op(data);
  return { message: message, etat: ga_etat_(payload.match || '') };
}

/* ================================ ÉTAT ====================================== */

function ga_etat_(matchDemande) {
  const P = sb_lireProduits_();
  const produits = P.rows.filter(x => x.actif && x.ref).map(x => ({
    ref: x.ref, produit: x.produit, modele: x.modele, taille: x.taille, categorie: String(x.categorie || ''),
    prix: x.prix_vente, cout: x.cout, R: x.R, B1: x.B1, B2: x.B2, seuil: x.seuil
  }));
  const matchs = ga_matchsVentes_();
  const match = matchDemande || (matchs[0] && matchs[0].label) || '';
  return {
    maj: sb_fmt_(new Date()),
    points: SB.POINTS,
    produits: produits,
    matchs: matchs,
    match: match,
    bilan: match ? ga_bilanMatch_(match, P) : null,
    historique: ga_historique_(40),
    enveloppes: sb_enveloppes_().filter(e => e.actif).map(e => ({ nom: e.nom, demarque: e.demarque, tva73: e.tva73 })),
    retraits: sb_retraitsEnAttente_().length
  };
}

/** Matchs présents dans 01_VENTES (ventes tablette), du plus récent au plus ancien. */
function ga_matchsVentes_() {
  const sh = getSheet(SHEET.VENTES);
  if (sh.getLastRow() < 2) return [];
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, COL_VENTE.MODE_PAIEMENT + 1).getValues();
  const m = {};
  data.forEach(r => {
    const label = String(r[COL_VENTE.MATCH_ASSOCIE] || '').trim();
    if (!label || String(r[COL_VENTE.SOURCE]) !== 'tablette') return;
    const d = r[COL_VENTE.DATE] instanceof Date ? r[COL_VENTE.DATE] : null;
    if (!m[label]) m[label] = { label: label, date: d, ca: 0 };
    if (d && (!m[label].date || d < m[label].date)) m[label].date = d;
    if (!/offert/i.test(String(r[COL_VENTE.MODE_PAIEMENT]))) m[label].ca += Number(r[COL_VENTE.CA]) || 0;
  });
  return Object.keys(m).map(k => m[k])
    .sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0))
    .map(x => ({ label: x.label, date: x.date ? sb_fmt_(x.date, 'dd/MM/yyyy') : '', ca: Math.round(x.ca * 100) / 100 }));
}

/**
 * Bilan d'un match : ventes par boutique (01_VENTES) rapprochées des sorties de stock
 * (11_MOUVEMENTS_STOCK, VENTE_COMPTOIR / OFFERT_CAISSE). Écart = vendu en caisse ≠ sorti du stock.
 */
function ga_bilanMatch_(match, P) {
  const parSlug = {};
  P.rows.forEach(x => { parSlug[slugify(x.produit)] = x; });

  const lignes = {};
  const cle = (pt, nom) => pt + '|' + slugify(nom);
  const ligne = (pt, nom) => {
    const k = cle(pt, nom);
    if (!lignes[k]) {
      const x = parSlug[slugify(nom)];
      lignes[k] = { point: pt, produit: nom, ref: x ? x.ref : '', vendu: 0, offert: 0, sorti: 0, ca: 0,
                    stock: x ? x[pt] || 0 : null, reserve: x ? x.R : 0 };
    }
    return lignes[k];
  };
  const paiements = {}, ca = { B1: 0, B2: 0 }, nbVentes = { B1: 0, B2: 0 };

  const shV = getSheet(SHEET.VENTES);
  if (shV.getLastRow() > 1) {
    shV.getRange(2, 1, shV.getLastRow() - 1, COL_VENTE.MODE_PAIEMENT + 1).getValues().forEach(r => {
      if (String(r[COL_VENTE.MATCH_ASSOCIE] || '').trim() !== match || String(r[COL_VENTE.SOURCE]) !== 'tablette') return;
      const pt = String(r[COL_VENTE.BOUTIQUE_ID] || 'B1') === 'B2' ? 'B2' : 'B1';
      const q = Number(r[COL_VENTE.QUANTITE]) || 0;
      const mode = String(r[COL_VENTE.MODE_PAIEMENT] || '—');
      const l = ligne(pt, String(r[COL_VENTE.PRODUIT] || ''));
      if (/offert/i.test(mode)) { l.offert += q; return; }
      const montant = Number(r[COL_VENTE.CA]) || 0;
      l.vendu += q; l.ca += montant; ca[pt] += montant; nbVentes[pt]++;
      paiements[mode] = (paiements[mode] || 0) + montant;
    });
  }

  const shM = SpreadsheetApp.getActive().getSheetByName(SB.ONGLET_MOUVEMENTS);
  if (shM && shM.getLastRow() > 1) {
    const c = sb_cols_(shM);
    const g = (r, k) => (c[k] ? r[c[k] - 1] : '');
    shM.getRange(2, 1, shM.getLastRow() - 1, shM.getLastColumn()).getValues().forEach(r => {
      if (String(g(r, 'match')).trim() !== match || GA.TYPES_SORTIE_MATCH.indexOf(String(g(r, 'type'))) === -1) return;
      const pt = String(g(r, 'point')) === 'B2' ? 'B2' : 'B1';
      ligne(pt, String(g(r, 'produit'))).sorti += -sb_num_(g(r, 'quantite'));
    });
  }

  const arr = Object.keys(lignes).map(k => lignes[k]);
  arr.forEach(l => {
    l.ca = Math.round(l.ca * 100) / 100;
    l.ecart = l.sorti - (l.vendu + l.offert);
  });
  arr.sort((a, b) => a.point.localeCompare(b.point) || (b.vendu + b.offert) - (a.vendu + a.offert));
  const r2 = v => Math.round(v * 100) / 100;
  Object.keys(paiements).forEach(k => { paiements[k] = r2(paiements[k]); });
  return {
    match: match,
    lignes: arr,
    ca: { B1: r2(ca.B1), B2: r2(ca.B2), total: r2(ca.B1 + ca.B2) },
    ventes: nbVentes,
    paiements: paiements,
    articles: arr.reduce((s, l) => s + l.vendu, 0),
    offerts: arr.reduce((s, l) => s + l.offert, 0),
    ecarts: arr.filter(l => l.ecart !== 0).length
  };
}

/** Derniers mouvements de stock, lisibles. */
function ga_historique_(n) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SB.ONGLET_MOUVEMENTS);
  if (!sh || sh.getLastRow() < 2) return [];
  const c = sb_cols_(sh);
  const debut = Math.max(2, sh.getLastRow() - n * 2 + 1);
  const g = (r, k) => (c[k] ? r[c[k] - 1] : '');
  return sh.getRange(debut, 1, sh.getLastRow() - debut + 1, sh.getLastColumn()).getValues().reverse()
    .slice(0, n).map(r => ({
      date: sb_fmt_(g(r, 'horodatage')), type: String(g(r, 'type')), produit: String(g(r, 'produit')),
      point: String(g(r, 'point')), qte: sb_num_(g(r, 'quantite')), match: String(g(r, 'match') || ''),
      commentaire: String(g(r, 'commentaire') || g(r, 'type_dotation') || ''), auteur: String(g(r, 'auteur') || '')
    }));
}

/* ========================= VENTE HORS MATCH ================================ */

/**
 * Vente en dehors d'un match (bureau, événement, commande d'un partenaire) :
 * ligne dans 01_VENTES (source « hors_match »), sortie du stock du lieu choisi, mouvement tracé.
 * Remplace la saisie manuelle dans « Journal ventes » du classeur Inventaire.
 */
function ga_venteHorsMatch_(p) {
  return sb_avecVerrou_(() => {
    const q = Math.round(sb_num_(p.quantite));
    if (!(q > 0)) throw new Error('Quantité invalide.');
    if (!SB.POINTS[p.point]) throw new Error('Choisissez le lieu d\'où sort l\'article.');
    const mode = String(p.mode || '').trim();
    if (!mode) throw new Error('Indiquez le moyen de paiement.');
    const P = sb_lireProduits_();
    const x = sb_trouverRef_(P, p.ref);
    if (x[p.point] < q) throw new Error('Stock insuffisant (' + SB.POINTS[p.point] + ' : ' + x[p.point] + ' disponible).');
    const pu = p.prix === '' || p.prix === null || p.prix === undefined ? x.prix_vente : sb_num_(p.prix);
    if (!(pu >= 0)) throw new Error('Prix invalide.');
    const occasion = String(p.occasion || '').trim() || 'Hors match';
    const now = new Date();
    const cle = 'HM-' + Utilities.formatDate(now, 'Europe/Paris', 'yyyyMMdd-HHmmss') + '-' + x.ref;

    const shV = getSheet(SHEET.VENTES);
    const ligne = new Array(Math.max(shV.getLastColumn(), COL_VENTE.MODE_PAIEMENT + 1)).fill('');
    ligne[COL_VENTE.DATE] = now; ligne[COL_VENTE.SOURCE] = 'hors_match'; ligne[COL_VENTE.COMMANDE] = cle;
    ligne[COL_VENTE.EMAIL] = String(p.email || ''); ligne[COL_VENTE.PRODUIT] = x.produit;
    ligne[COL_VENTE.CATEGORIE] = String(x.categorie || ''); ligne[COL_VENTE.QUANTITE] = q;
    ligne[COL_VENTE.PRIX_UNITAIRE] = pu; ligne[COL_VENTE.CA] = /offert/i.test(mode) ? 0 : Math.round(pu * q * 100) / 100;
    ligne[COL_VENTE.MATCH_ASSOCIE] = occasion; ligne[COL_VENTE.BOUTIQUE_ID] = p.point;
    ligne[COL_VENTE.SAISON] = saisonDepuisDate_(now); ligne[COL_VENTE.MODE_PAIEMENT] = mode;
    shV.appendRow(ligne);

    sb_set_(P, x, 'stock_' + p.point, x[p.point] - q);
    sb_mouvement_({ type: 'VENTE_HORS_MATCH', ref_boutique: x.ref, produit: x.produit, point: p.point, quantite: -q,
      cout_unitaire: x.cout, valeur: -q * x.cout, match: occasion, reference: cle,
      beneficiaire: String(p.client || ''), commentaire: mode + (p.client ? ' · ' + p.client : '') });
    try { reconstruireSaisons(); } catch (e) { logDiag('gestion', 'WARN', 'saisons: ' + e.message); }
    rafraichirSynthese_();
    return q + ' × ' + x.produit + ' vendu(s) hors match (' + mode + ', ' + (pu * q).toFixed(2) + ' €) · sorti(s) de ' + SB.POINTS[p.point] + '.';
  });
}

/* ================== MAILLOTS PARTENAIRES (une seule fois) =================== */

/**
 * ▶ migrerMaillotsPartenaires — à lancer UNE fois depuis l'éditeur Apps Script.
 * Les maillots vendus uniquement aux partenaires sont un article à part. Jusqu'ici le CRM n'en avait
 * pas : le comptage du 17/10 les a rangés dans le stock VIP des maillots grand public.
 * Ce script crée les références « Maillot partenaire … » (MAP-…) et y déplace ces quantités
 * (stock VIP compté le 17/10 : Bleu foncé M 11 · L 1 · XL 1 ; Bleu clair L 1 ; Blanc M 1).
 * Relançable sans risque : une référence déjà créée n'est ni recréée ni re-déplacée.
 */
const GA_PARTENAIRES = [
  // [code couleur, libellé, taille, quantité en boutique VIP à reclasser]
  ['BNU', 'Bleu Nuit', 'M', 11], ['BNU', 'Bleu Nuit', 'L', 1], ['BNU', 'Bleu Nuit', 'XL', 1],
  ['BCI', 'Bleu Ciel', 'L', 1],
  ['BLC', 'Blanc', 'M', 1], ['BLC', 'Blanc', 'L', 0]
];
const GA_PRIX_PARTENAIRE = 55;

function migrerMaillotsPartenaires() {
  const rapport = sb_avecVerrou_(() => {
    GESTION_AUTEUR_ = 'migration maillots partenaires';
    const P = sb_lireProduits_();
    const sh = P.sh;
    sb_assurerColonnes_(sh, ['ref_boutique', 'modele', 'taille', 'seuil_alerte', 'stock_R', 'prix_partenaire']);
    const c = sb_cols_(sh);
    const lignes = [];
    GA_PARTENAIRES.forEach(t => {
      const ref = 'MAP-' + t[0] + '-' + t[2];
      if (P.rows.some(r => r.ref === ref)) { lignes.push(ref + ' existe déjà : inchangé'); return; }
      const grandPublic = P.rows.find(r => r.ref === 'MAI-' + t[0] + '-' + t[2]);
      const aDeplacer = grandPublic ? Math.min(t[3], Math.max(0, grandPublic.B2)) : 0;
      const nom = 'Maillot partenaire ' + t[1] + ' - ' + t[2];
      const row = new Array(sh.getLastColumn()).fill('');
      const set = (k, v) => { if (c[k]) row[c[k] - 1] = v; };
      set('produit', nom); set('categorie', 'Maillots'); set('prix_vente', GA_PRIX_PARTENAIRE);
      set('prix_partenaire', GA_PRIX_PARTENAIRE); set('cout', grandPublic ? grandPublic.cout : 0);
      set('stock_B1', 0); set('stock_B2', aDeplacer); set('stock_R', 0); set('actif', true);
      set('ref_boutique', ref); set('modele', 'Maillot partenaire ' + t[1]); set('taille', t[2]); set('seuil_alerte', 0);
      sh.appendRow(row);
      if (aDeplacer) {
        sb_set_(P, grandPublic, 'stock_B2', grandPublic.B2 - aDeplacer);
        const cout = grandPublic.cout || 0;
        sb_mouvement_({ type: 'AJUSTEMENT_INVENTAIRE', ref_boutique: grandPublic.ref, produit: grandPublic.produit, point: 'B2',
          quantite: -aDeplacer, cout_unitaire: cout, valeur: -aDeplacer * cout, commentaire: 'reclassé en ' + nom + ' (comptage 17/10)' });
        sb_mouvement_({ type: 'AJUSTEMENT_INVENTAIRE', ref_boutique: ref, produit: nom, point: 'B2',
          quantite: aDeplacer, cout_unitaire: cout, valeur: aDeplacer * cout, commentaire: 'reclassé depuis ' + grandPublic.produit + ' (comptage 17/10)' });
      }
      lignes.push(ref + ' créé · ' + aDeplacer + ' en boutique VIP' + (grandPublic && t[3] > aDeplacer ? ' (⚠ ' + t[3] + ' attendus, ' + grandPublic.B2 + ' trouvés)' : ''));
    });
    rafraichirSynthese_();
    return lignes.join('\n');
  });
  Logger.log(rapport);
  try { SpreadsheetApp.getUi().alert('Maillots partenaires', rapport + '\n\nPense à recharger le catalogue de la tablette VIP.', SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return rapport;
}
