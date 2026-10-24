// ═══════════════════════════════════════════════════════════════════════════
// MAJ TABLETTE BOUTIQUE — fichier AUTONOME à ajouter au projet App_Boutique (CRM)
// Aligne le stock des tablettes (03_PRODUITS) sur l'onglet « En boutique » du classeur
// « Inventaire 2026 2027 » (tableaux 🔵 BOUTIQUE GP et 🔴 BOUTIQUE VIP).
//
// ▶ apercuMajTabletteGP  : montre ce qui va changer dans stock_B1 (rien n'est écrit)
// ▶ majTabletteGP        : écrit stock_B1 (boutique GP)
// ▶ apercuMajTabletteVIP / majTabletteVIP : idem pour stock_B2 (boutique VIP)
//
// Ensuite, sur la tablette : Synchronisation › « Mettre à jour le catalogue ».
//
// Règles :
//  • seule la colonne de la boutique visée change (stock_B1 OU stock_B2) ; dépôt (stock_R) jamais touché ;
//  • articles reconnus par leur référence (MAI-BNU-…, TSH-NARJ-…) ; maillots partenaires (MAP-…) jamais touchés ;
//  • tailles enfants en cm (116 à 164) : « Size 128 », « 128y », « 8 ans » = 128 ;
//  • case Stock vide : article laissé tel quel ; « Environ 120 » : 120 retenu (signalé) ;
//  • taille enfant présente dans l'inventaire mais absente du CRM : article créé en copiant
//    la ligne d'une autre taille enfant du même article (prix, coût, catégorie), stocks à 0 sauf la boutique visée ;
//  • chaque changement est tracé dans l'onglet « MAJ_TABLETTE_<boutique>_AAAAMMJJ ».
// Ne lit pas les « tableaux » Google Sheets via l'API : lit la mise en page de l'onglet
// (en-tête Caractéristique | Stock | Taille | Notes, étiquette BOUTIQUE GP / VIP, titre de l'article).
// ═══════════════════════════════════════════════════════════════════════════

const MTB = {
  INV_ID: '1b33hMr4zkgKcwByCRNKket3LpRClclxTssxs25M6xY8',
  CRM_ID: '1mE9gSCtetFgnWEt0kA6cS2lcgJDe7oPRLDiXdGhH2EQ',
  ONGLET: 'En boutique',
  PRODUITS: '03_PRODUITS',
  COL: { GP: 'stock_B1', VIP: 'stock_B2' },
  // Titre de l'article dans l'inventaire → préfixes de référence CRM
  ARTICLES: [
    { titre: 'maillot de match bleu fonce', refs: ['MAI-BNU'] },
    { titre: 'maillot de match bleu clair', refs: ['MAI-BCI'] },
    { titre: 'maillot de match blanc',      refs: ['MAI-BLC'] },
    { titre: 'polo femme',                  refs: ['POL-W'] },
    { titre: 'polo homme',                  refs: ['POL-M'] },
    { titre: 't-shirt freetime',            refs: ['TSH-FRT'] },
    { titre: 't-shirt nara',                refs: ['TSH-NAR', 'TSH-NARJ'] },
    { titre: 'gourde',                      refs: ['GRD'] },
    { titre: 'sac a dos',                   refs: ['SAC'] },
    { titre: 'sweat zippe',                 refs: ['SWT'] },
    { titre: 't-shirt sportif blanc',       refs: ['TSH-BLC'] },
    { titre: 't-shirt sportif bleu',        refs: ['TSH-NAV'] },
    { titre: 'casquette',                   refs: ['CAS'] },
    { titre: 'echarpe',                     refs: ['ECH'] },
    { titre: 'porte-cles',                  refs: ['PCL'] },
    { titre: 'short',                       refs: ['SHO'] },
    { titre: 'stickers',                    refs: ['STK'] },
    { titre: 'mug',                         refs: ['MUG'] },
  ],
};

function apercuMajTabletteGP()  { return mtbLancer_('GP', false); }
function majTabletteGP()        { return mtbLancer_('GP', true); }
function apercuMajTabletteVIP() { return mtbLancer_('VIP', false); }
function majTabletteVIP()       { return mtbLancer_('VIP', true); }

function mtbLancer_(boutique, ecrire) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const inv = SpreadsheetApp.openById(MTB.INV_ID);
    const crm = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(MTB.CRM_ID);
    const plan = mtbPlan_(inv, crm, boutique);
    if (ecrire) mtbEcrire_(crm, plan, boutique);
    const msg = mtbResume_(plan, boutique, ecrire);
    Logger.log(msg);
    try { SpreadsheetApp.getUi().alert('Tablette ' + boutique, msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
    return msg;
  } finally {
    lock.releaseLock();
  }
}

// ── Lecture de l'onglet « En boutique » ───────────────────────────────────
function mtbTableaux_(inv) {
  const sh = inv.getSheetByName(MTB.ONGLET);
  if (!sh) throw new Error('Onglet « ' + MTB.ONGLET + ' » introuvable dans le classeur Inventaire.');
  const G = sh.getRange(1, 1, sh.getLastRow() + 1, Math.max(26, sh.getLastColumn())).getDisplayValues();
  const val = sh.getRange(1, 1, sh.getLastRow() + 1, Math.max(26, sh.getLastColumn())).getValues();
  const cell = function (r, c) { return r >= 1 && c >= 1 && r <= G.length && c <= G[0].length ? G[r - 1][c - 1] : ''; };
  const brut = function (r, c) { return r >= 1 && c >= 1 && r <= val.length && c <= val[0].length ? val[r - 1][c - 1] : ''; };
  const out = [];
  for (let r = 1; r <= G.length; r++) {
    for (let c = 2; c <= G[0].length - 2; c++) {
      if (mtbNorm_(cell(r, c)) !== 'stock' || mtbNorm_(cell(r, c + 1)) !== 'taille' || mtbNorm_(cell(r, c - 1)) !== 'caracteristique') continue;
      const c0 = c - 1;
      const lab = [1, 2, 3].map(function (k) { return mtbNorm_(cell(r - k, c0)); }).join(' ');
      const boutique = /boutique vip/.test(lab) ? 'VIP' : (/boutique gp/.test(lab) ? 'GP' : '');
      const cTitre = (c0 === 1 || c0 === 13) ? c0 : c0 - 6;
      const titre = mtbNorm_(cell(r - 3, cTitre)).replace(/\(.*$/, '').trim();
      const lignes = [];
      for (let i = r + 1; i <= G.length; i++) {
        const v = [cell(i, c0), cell(i, c0 + 1), cell(i, c0 + 2), cell(i, c0 + 3)];
        if (v.every(function (x) { return String(x).trim() === ''; })) break;
        lignes.push({ ligne: i, tailleBrute: v[2], taille: mtbTaille_(v[2]) || 'TU', stock: brut(i, c0 + 1), affiche: v[1] });
      }
      out.push({ boutique: boutique, titre: titre, ligne: r, lignes: lignes });
    }
  }
  return out;
}

// ── Plan : quoi changer dans 03_PRODUITS ─────────────────────────────────
function mtbPlan_(inv, crm, boutique) {
  const sh = crm.getSheetByName(MTB.PRODUITS);
  if (!sh) throw new Error('Onglet ' + MTB.PRODUITS + ' introuvable : lancer depuis le projet App_Boutique (classeur CRM).');
  const d = sh.getDataRange().getValues();
  const h = {};
  d[0].forEach(function (v, i) { const k = String(v).trim(); if (k && !(k in h)) h[k] = i; });
  ['produit', 'ref_boutique', 'taille', 'actif', MTB.COL[boutique]].forEach(function (k) {
    if (h[k] === undefined) throw new Error('Colonne « ' + k + ' » introuvable dans ' + MTB.PRODUITS + '.');
  });
  const col = h[MTB.COL[boutique]];
  const produits = d.slice(1).map(function (r, i) {
    return { ligne: i + 2, row: r, nom: String(r[h.produit] || ''), ref: String(r[h.ref_boutique] || '').toUpperCase().trim(),
      taille: mtbTaille_(r[h.taille]) || 'TU', actif: r[h.actif] !== false && String(r[h.actif]).toUpperCase() !== 'FALSE',
      stock: Number(r[col]) || 0 };
  }).filter(function (p) { return p.nom && p.actif; });

  const tableaux = mtbTableaux_(inv).filter(function (t) { return t.boutique === boutique; });
  if (!tableaux.length) throw new Error('Aucun tableau « BOUTIQUE ' + boutique + ' » trouvé dans l\'onglet ' + MTB.ONGLET + '.');
  const changes = [], egaux = [], ignores = [], creations = [], inconnus = [], horsInventaire = [];
  const vus = {};
  tableaux.forEach(function (t) {
    const art = MTB.ARTICLES.filter(function (a) { return a.titre === t.titre; })[0];
    if (!art) { inconnus.push(t.titre || '(sans titre, ligne ' + t.ligne + ')'); return; }
    const famille = produits.filter(function (p) {
      return art.refs.some(function (pre) { return p.ref.indexOf(pre + '-') === 0; });
    });
    t.lignes.forEach(function (l) {
      const lib = mtbNomAffiche_(t.titre) + ' ' + (l.taille === 'TU' ? '' : l.taille);
      // Valeur de stock
      let q = l.stock, approx = false;
      if (String(q).trim() === '') { ignores.push(lib.trim() + ' : case Stock vide, laissé tel quel'); return; }
      if (typeof q !== 'number') {
        const m = String(q).match(/\d+/);
        if (!m) { ignores.push(lib.trim() + ' : « ' + q + ' » illisible, laissé tel quel'); return; }
        q = Number(m[0]); approx = true;
      }
      const cands = famille.filter(function (p) { return p.taille === l.taille; });
      if (!cands.length) {
        // Taille enfant absente du CRM : création par copie d'une autre taille enfant du même article
        const modele = /^\d{3}$/.test(l.taille) ? famille.filter(function (p) { return /^\d{3}$/.test(p.taille); })[0] : null;
        if (modele) creations.push({ modele: modele, taille: l.taille, qte: q, lib: lib.trim(), approx: approx });
        else ignores.push(lib.trim() + ' : aucun article CRM à cette taille');
        return;
      }
      const p = cands[0];
      vus[p.ligne] = 1;
      if (p.stock === q) { egaux.push(p); return; }
      changes.push({ p: p, avant: p.stock, apres: q, approx: approx });
    });
    famille.forEach(function (p) { if (!vus[p.ligne] && !/^MAP-/.test(p.ref)) horsInventaire.push(p); });
  });
  return { sh: sh, h: h, col: col, changes: changes, egaux: egaux, ignores: ignores, creations: creations,
    inconnus: inconnus, horsInventaire: horsInventaire.filter(function (p, i, a) { return a.indexOf(p) === i && !vus[p.ligne]; }) };
}

// ── Écriture ─────────────────────────────────────────────────────────────
function mtbEcrire_(crm, plan, boutique) {
  const sh = plan.sh, h = plan.h;
  plan.changes.forEach(function (c) { sh.getRange(c.p.ligne, plan.col + 1).setValue(c.apres); });
  plan.creations.forEach(function (c) {
    const r = c.modele.row.slice();
    const t = c.taille;
    r[h.produit] = String(r[h.produit]).replace(/\s*[-–]?\s*\d{3}\s*$/, '').trim() + ' - ' + t;
    r[h.ref_boutique] = String(r[h.ref_boutique]).replace(/-[^-]+$/, '-' + t);
    r[h.taille] = Number(t);
    ['stock_B1', 'stock_B2', 'stock_R'].forEach(function (k) { if (h[k] !== undefined) r[h[k]] = 0; });
    ['tickie_product_id', 'tickie_variant_id', 'tickie_id', 'tickie_variante_id'].forEach(function (k) { if (h[k] !== undefined) r[h[k]] = ''; });
    r[plan.col] = c.qte;
    sh.appendRow(r);
    c.cree = r[h.produit] + ' (' + r[h.ref_boutique] + ')';
  });
  // Trace
  const nom = 'MAJ_TABLETTE_' + boutique + '_' + Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyyMMdd');
  const log = crm.getSheetByName(nom) || crm.insertSheet(nom);
  if (log.getLastRow() === 0) {
    log.getRange(1, 1, 1, 6).setValues([['Horodatage', 'Ligne 03_PRODUITS', 'Article', 'Réf.', MTB.COL[boutique] + ' avant', MTB.COL[boutique] + ' après']])
      .setFontWeight('bold').setBackground(boutique === 'GP' ? '#1E5BB8' : '#C62828').setFontColor('#FFFFFF');
    log.setFrozenRows(1);
  }
  const now = new Date();
  const lignes = plan.changes.map(function (c) { return [now, c.p.ligne, c.p.nom, c.p.ref, c.avant, c.apres + (c.approx ? ' (≈)' : '')]; })
    .concat(plan.creations.map(function (c) { return [now, 'créé', c.cree, '', '', c.qte + (c.approx ? ' (≈)' : '')]; }));
  if (lignes.length) log.getRange(log.getLastRow() + 1, 1, lignes.length, 6).setValues(lignes);
  log.getRange(2, 1, Math.max(1, log.getLastRow() - 1), 1).setNumberFormat('dd/MM/yyyy HH:mm');
}

// ── Compte rendu ─────────────────────────────────────────────────────────
function mtbResume_(plan, boutique, ecrit) {
  const l = [];
  l.push((ecrit ? '✅ Stock ' : '👀 APERÇU — stock ') + 'boutique ' + boutique + ' (' + MTB.COL[boutique] + ') aligné sur l\'onglet « En boutique »');
  l.push('');
  l.push(plan.changes.length ? plan.changes.length + ' changement(s) :' : 'Aucun changement de stock.');
  plan.changes.forEach(function (c) { l.push('   • ' + c.p.nom + ' : ' + c.avant + ' → ' + c.apres + (c.approx ? ' (≈ valeur approximative)' : '')); });
  if (plan.creations.length) {
    l.push('');
    l.push('Article(s) ' + (ecrit ? 'créé(s)' : 'à créer') + ' (taille absente du CRM) :');
    plan.creations.forEach(function (c) { l.push('   • ' + (c.cree || c.lib) + ' : stock ' + c.qte + ' (prix et coût copiés de « ' + c.modele.nom + ' »)'); });
  }
  l.push('');
  l.push(plan.egaux.length + ' article(s) déjà au bon stock.');
  if (plan.ignores.length) { l.push(''); l.push('Laissé(s) tel(s) quel(s) :'); plan.ignores.forEach(function (x) { l.push('   • ' + x); }); }
  if (plan.horsInventaire.length) {
    l.push('');
    l.push('Taille(s) du CRM absente(s) de l\'inventaire (non touchées) :');
    l.push('   ' + plan.horsInventaire.map(function (p) { return p.nom + ' (' + p.stock + ')'; }).join(', '));
  }
  if (plan.inconnus.length) { l.push(''); l.push('⚠ Tableau(x) non relié(s) : ' + plan.inconnus.join(', ')); }
  l.push('');
  l.push(ecrit ? 'Tablette ' + boutique + ' : Synchronisation › « Mettre à jour le catalogue ».'
    : 'Rien n\'a été écrit. Pour appliquer : ▶ majTablette' + boutique);
  return l.join('\n');
}

// ── Utilitaires ──────────────────────────────────────────────────────────
function mtbNorm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[🔵🔴]/gu, '').trim().toLowerCase();
}
// Taille normalisée : XXL = 2XL ; enfants en cm (« Size 128 », « 128y », « 8 ans », « 128.0 » → 128) ; « // » = TU
function mtbTaille_(v) {
  let t = String(v == null ? '' : v).trim().toUpperCase().replace(/^SIZE\s*/, '').replace(/\s+/g, '');
  if (!t) return '';
  if (t === '//' || t === 'TU' || t === 'UNIQUE') return 'TU';
  if (t === 'XXL') t = '2XL';
  if (t === 'XXXL') t = '3XL';
  t = t.replace(/ANS$/, 'Y');
  const age = t.match(/^(\d{1,2})(Y|A)$/);
  if (age && +age[1] >= 4 && +age[1] <= 16) t = String(116 + (+age[1] - 6) * 6);
  t = t.replace(/^(\d{3})(\.0+|Y|CM)$/, '$1');
  return t;
}
function mtbNomAffiche_(titre) {
  return String(titre).replace(/^maillot de match /, 'Maillot ').replace(/^./, function (x) { return x.toUpperCase(); });
}
