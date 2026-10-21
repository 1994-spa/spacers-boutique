/**
 * ============================================================
 *  Tickie_ProduitsParTaille.gs — CRM Boutique Spacers (projet App_Boutique)
 *  Repli : un produit Tickie par coloris ET par taille (15 produits)
 * ============================================================
 *  Pourquoi : le checkout Tickie n'affiche pas de sélecteur de variante ;
 *  un maillot à 5 variantes est toujours ajouté en taille S.
 *
 *  Prérequis : Tickie_Produits.gs dans le même projet (tkpGet_, tkpEcrire_, TKP_CFG,
 *  clé TICKIE_API_KEY_BOUTIQUE) et Tickie_Variantes.gs (tkvObjectId_, tkvSansChampsServeur_).
 *
 *  Ce que fait tptCreerProduitsParTaille() :
 *    1. crée « Maillot Blanc – S » … « Maillot Bleu Nuit – XXL » (prix, TVA, image,
 *       catégorie et description repris du modèle ; meta ref_boutique = MAI-BLC-S…) ;
 *       un produit déjà créé (même nom) est réutilisé, jamais dupliqué ;
 *    2. remplace dans le flux Match_Saison les 3 maillots à variantes par les 15 produits
 *       (l'écharpe et tout autre produit du flux sont conservés, en tête) ;
 *    3. désactive les 3 anciens maillots à variantes (conservés, pas supprimés) ;
 *    4. écrit tickie_id et tickie_variante_id des 15 lignes de 03_PRODUITS (clé : ref_boutique).
 *
 *  Utilisation : lancer avec TPT_CFG.DRY_RUN = true (aperçu), puis false.
 * ============================================================
 */

var TPT_CFG = {
  DRY_RUN: false,                                   // passer à false pour écrire réellement
  FLUX_ID: '6a60cf617a7a52f38aa8f923',             // Match_Saison
  TAILLES: ['S', 'M', 'L', 'XL', 'XXL'],
  MODELES: [                                       // ordre d'affichage dans le flux
    { code: 'MAI-BLC', id: '6a0d85ea10006eb35e8230de' },   // Maillot Blanc
    { code: 'MAI-BCI', id: '6a0d85d30ead1dfb0b1c1bb2' },   // Maillot Bleu Ciel
    { code: 'MAI-BNU', id: '6a0d85b392a708a6a9c73b1e' }    // Maillot Bleu Nuit
  ],
  COL_REF: 'ref_boutique',
  COL_ID: 'tickie_id',
  COL_VAR: 'tickie_variante_id'
};

function tptCreerProduitsParTaille() {
  var ui = SpreadsheetApp.getUi();
  try {
    var existants = tptIndexParNom_();
    var plan = [];   // { ref, nom, corps, existant }

    TPT_CFG.MODELES.forEach(function (m) {
      var base = tkpGet_('/products/' + m.id);
      var v0 = base.variants[0];
      TPT_CFG.TAILLES.forEach(function (t) {
        var nom = base.name + ' – ' + t;
        var ref = m.code + '-' + t;
        var desc = String(base.description || '')
          .replace(/Tailles disponibles\s*:[^.\n]*\.?/i, 'Taille : ' + t + '.');
        plan.push({
          ref: ref,
          nom: nom,
          existant: existants[tptCle_(nom)] || null,
          corps: {
            name: nom,
            image: base.image,
            type: 'product',
            active: true,
            categoryIds: base.categoryIds || [],
            description: desc,
            isFulfillable: base.isFulfillable,
            meta: { ref_boutique: ref, modele: m.code, taille: t, boutique: 'oui', saison: '2026-2027' },
            variants: [{
              _id: tkvObjectId_(),
              price: v0.price,
              compareAtPrice: null,
              taxable: v0.taxable,
              taxRate: v0.taxRate,
              priceType: v0.priceType,
              addOnSettings: null
            }]
          }
        });
      });
    });

    var apercu = plan.map(function (p) {
      return (p.existant ? '= ' : '+ ') + p.nom + ' — ' + p.corps.variants[0].price + ' €';
    }).join('\n');

    if (TPT_CFG.DRY_RUN) {
      Logger.log('DRY_RUN — produits prévus :\n' + apercu + '\n\nExemple de corps POST :\n'
        + JSON.stringify(plan[0].corps, null, 2));
      ui.alert('Aperçu (rien envoyé)', apercu + '\n\n+ = à créer, = = déjà présent.\n'
        + 'Pour écrire : TPT_CFG.DRY_RUN = false, puis relancer.', ui.ButtonSet.OK);
      return;
    }

    if (ui.alert('Créer les produits par taille ?', apercu
      + '\n\nLe flux Match_Saison sera mis à jour et les 3 maillots à variantes désactivés.',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

    // 1. Création (ou réutilisation)
    var crees = [];
    plan.forEach(function (p) {
      var prod = p.existant;
      if (!prod) {
        var r = tkpEcrire_('post', '/products', p.corps);
        if (r.code < 200 || r.code >= 300) {
          throw new Error('Création refusée pour « ' + p.nom + ' » (' + r.code + ') : ' + r.corps.slice(0, 200)
            + '\n' + crees.length + ' produit(s) déjà créé(s) : relancer réutilisera ceux-ci sans doublon.');
        }
        prod = JSON.parse(r.corps);
      }
      crees.push({ ref: p.ref, nom: p.nom, id: prod._id, vid: prod.variants[0]._id });
    });

    // 2. Flux Match_Saison
    var anciens = TPT_CFG.MODELES.map(function (m) { return m.id; });
    var flux = tkpGet_('/products/streams/' + TPT_CFG.FLUX_ID);
    var nouveaux = crees.map(function (c) { return c.id; });
    var garde = (flux.products || []).filter(function (id) {
      return anciens.indexOf(id) < 0 && nouveaux.indexOf(id) < 0;
    });
    var corpsFlux = tkvSansChampsServeur_(flux);
    corpsFlux.products = garde.concat(nouveaux);
    var rf = tkpEcrire_('put', '/products/streams/' + TPT_CFG.FLUX_ID, corpsFlux);
    var fluxOk = rf.code >= 200 && rf.code < 300;

    // 3. Désactivation des anciens maillots à variantes
    var desact = 0;
    if (fluxOk) {
      anciens.forEach(function (id) {
        var p = tkpGet_('/products/' + id);
        var c = tkvSansChampsServeur_(p);
        c.active = false;
        var r = tkpEcrire_('put', '/products/' + id, c);
        if (r.code >= 200 && r.code < 300) desact++;
      });
    }

    // 4. 03_PRODUITS
    var lignes = tptEcrireIds_(crees);

    Logger.log(crees.map(function (c) { return c.ref + ' → ' + c.id + ' / ' + c.vid; }).join('\n'));
    ui.alert('Produits par taille — terminé',
      crees.length + ' produit(s) prêts dans Tickie.\n'
      + (fluxOk ? 'Flux Match_Saison mis à jour.' : 'ATTENTION : flux NON mis à jour (' + rf.code + ') : '
        + rf.corps.slice(0, 150) + '\nLes anciens maillots n\'ont pas été désactivés.') + '\n'
      + desact + ' ancien(s) maillot(s) désactivé(s).\n'
      + lignes + ' ligne(s) de 03_PRODUITS mises à jour.\n\nDétail : Apps Script › Exécutions.',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Produits par taille — échec', e.message, ui.ButtonSet.OK);
  }
}

// ------------------------------------------------------------

function tptCle_(s) {
  return String(s || '').toLowerCase().replace(/[–—-]/g, '-').replace(/\s+/g, ' ').trim();
}

/** Tous les produits Tickie, indexés par nom normalisé. */
function tptIndexParNom_() {
  var r = tkpGet_('/products?top=200');
  var liste = Array.isArray(r) ? r : (r.docs || r.rows || []);
  var idx = {};
  liste.forEach(function (p) { idx[tptCle_(p.name)] = p; });
  return idx;
}

/** Écrit tickie_id et tickie_variante_id sur les lignes 03_PRODUITS, clé ref_boutique. */
function tptEcrireIds_(crees) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TKP_CFG.FEUILLE_PRODUITS);
  var data = sh.getDataRange().getValues();
  var h = data[0].map(function (x) { return String(x).trim().toLowerCase(); });
  var cRef = h.indexOf(TPT_CFG.COL_REF), cId = h.indexOf(TPT_CFG.COL_ID), cVar = h.indexOf(TPT_CFG.COL_VAR);
  if (cRef < 0 || cId < 0 || cVar < 0) throw new Error('Colonnes ref_boutique / tickie_id / tickie_variante_id introuvables dans 03_PRODUITS.');
  var parRef = {};
  crees.forEach(function (c) { parRef[c.ref] = c; });
  var n = 0;
  for (var i = 1; i < data.length; i++) {
    var c = parRef[String(data[i][cRef]).trim().toUpperCase()];
    if (!c) continue;
    sh.getRange(i + 1, cId + 1).setValue(c.id);
    sh.getRange(i + 1, cVar + 1).setValue(c.vid);
    n++;
  }
  return n;
}