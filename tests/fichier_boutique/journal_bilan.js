// 26/11/2026 — Journal des ventes : une date sur chaque ligne ; ventes VIP reprises du journal papier (RV-…) classées VIP
// dans leur match ; « Hors match » avec son vrai CA ; somme du bilan par match = CA caisse saison du journal.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const { creerContexte } = require('./harnais');
const T = creerContexte(), { ctx, crm } = T;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/crm/Reprise_Ventes_VIP.gs'), 'utf8'), ctx);
const run = c => vm.runInContext(c, ctx);
let ok = 0; const check = (c, m) => { assert(c, m); ok++; console.log('  ✓ ' + m); };

// ---------- CRM ----------
const P = crm.insertSheet('03_PRODUITS');
P.appendRow(['produit', 'categorie', 'prix_vente', 'cout', 'stock_B1', 'stock_B2', 'actif', 'ref_boutique', 'modele', 'taille', 'seuil_alerte', 'stock_R']);
[['Maillot partenaire Bleu Nuit - L', 'MAP-BNU-L', 'Maillot partenaire Bleu Nuit', 'L'], ['Maillot partenaire Bleu Nuit - M', 'MAP-BNU-M', 'Maillot partenaire Bleu Nuit', 'M'],
 ['Maillot partenaire Blanc - L', 'MAP-BLC-L', 'Maillot partenaire Blanc', 'L'], ['Gourde', 'GRD-TU', 'Gourde', 'TU'],
 ['T-shirt Freetime M', 'TSH-FRT-M', 'T-shirt Freetime', 'M'], ['T-shirt Freetime L', 'TSH-FRT-L', 'T-shirt Freetime', 'L'],
 ['Écharpe', 'ECH-TU', 'Écharpe', 'TU'], ['Nara Tee M', 'TSH-NAR-M', 'Nara Tee', 'M'], ['Porte-clés', 'PCL-NAV-TU', 'Porte-clés', 'TU'],
 ['Mug', 'MUG-BLC-TU', 'Mug', 'TU']].forEach(([n, r, m, t]) => P.appendRow([n, 'Boutique', 10, 4, 5, 5, true, r, m, t, 3, 20]));
const MV = crm.insertSheet('11_MOUVEMENTS_STOCK');
MV.appendRow(run('SB.ENTETES_MOUVEMENTS'));
const V = crm.insertSheet('01_VENTES');
V.appendRow(['date', 'source', 'commande', 'email', 'produit', 'categorie', 'quantite', 'prix_unitaire', 'CA', 'match_associe', 'boutique_id', 'saison', 'mode_paiement', 'prix_brut', 'remise']);
const M4 = crm.insertSheet('04_MATCHS');
M4.appendRow(['date', 'competition', 'club_visiteur', 'spectateurs', 'ca_billetterie', 'ca_boutique', 'commentaire']);
M4.appendRow([new Date(2026, 10, 7), 'Ligue A', 'Plessis', '', 0, 0, 'Import tablette B1']);
crm.insertSheet('21_LIGNES_LIVE').appendRow(['ID vente', 'Horodatage', 'ID événement Tickie', 'Boutique', 'Réf.', 'Produit', 'Catégorie', 'Qté', 'PU TTC', 'CA TTC', 'Mode']);

const serie = (a, mo, j, h, mi) => (Date.UTC(a, mo, j, h, mi) - Date.UTC(1899, 11, 30)) / 86400000;   // n° de série Sheets
const tab = (date, cmd, produit, q, pu, match, b, mode) => V.appendRow([date, 'tablette', cmd, '', produit, '', q, pu, q * pu, match, b, '2026-2027', mode]);
// dates de toutes les formes rencontrées : objet Date, texte français, n° de série, cellule vide
tab(new Date(2026, 9, 10, 18, 41), 't1', 'Écharpe', 2, 14.25, "Spacer's vs Narbonne", 'B1', 'CB');
tab('17/10/2026 20:14:00', 't2', 'Nara Tee M', 1, 31.5, "Spacer's vs Sète", 'B1', 'CB');
tab(serie(2026, 9, 24, 17, 30), 't3', 'Gourde', 1, 10, "Spacer's vs Cannes", 'B1', 'Espèces');
tab('', 't4', 'Mug', 1, 8, "Spacer's vs Plessis", 'B1', 'CB');                       // sans date → 04_MATCHS (07/11)
tab(new Date(2026, 10, 21, 21, 30), 't5', 'Écharpe', 1, 15, "Spacer's vs Tours", 'B2', 'CB');
tab(new Date(2026, 10, 21, 20, 54), 't6', 'Écharpe', 1, 14.25, "Spacer's vs Tours", 'B1', 'Espèces');
// add-on remis sans horodatage → date du match (1re vente tablette de Tours)
MV.appendRow(['', 'RETRAIT_ADDON', 'ECH-TU', 'Écharpe', 'B1', -1, 4, -4, '', '', "Spacer's vs Tours", 'tx1', 'add-on Tickie remis au stand', '']);
// vente de la page Gestion : B2 mais occasion libre (pas un match) → reste « Hors match »
V.appendRow(['2026-11-12T10:00:00', 'hors_match', 'HM-20261112-100000-GRD-TU', '', 'Gourde', '', 1, 10, 10, 'Soirée partenaires', 'B2', '2026-2027', 'CB']);
// reprise du journal papier d'Élise (vrai script, 15 lignes, 525 €)
check(/APPLIQUÉE .*15 ligne\(s\), 525,00 €/.test(run('rv_appliquer()')), 'reprise RV : 15 lignes, 525 € écrites dans 01_VENTES (source hors_match)');
// une ligne reprise dont la date a disparu : repli sur la date du match
const rCannes = V.find(3, 'RV-10-TSH-FRT-L-2410', 2);
V.set(rCannes, 1, '');

// ---------- calcul ----------
const D = run('fb_donnees_()');
const J = D.journal;
const caisse = J.filter(j => j.type !== 'Retrait add-on');
const totalSaison = Math.round(caisse.reduce((s, j) => s + (Number(j.ca) || 0), 0) * 100) / 100;

console.log('1. Date sur chaque ligne');
check(run('fb_date_("17/10/2026 20:14:00")').getTime() === new Date(2026, 9, 17, 20, 14).getTime() && run('fb_date_("10/10/2026")').getDate() === 10 &&
      run('fb_date_("31/02/2026")') === null && run('fb_date_("n\'importe quoi")') === null && run(`fb_date_(new Date('x'))`) === null,
      'fb_date_ : texte jj/mm/aaaa lu à la française (pas à l\'américaine), date impossible ou illisible → null');
check(run(`fb_date_(${serie(2026, 9, 24, 17, 30)})`).getTime() === new Date(2026, 9, 24, 17, 30).getTime(), 'fb_date_ : n° de série Sheets → 24/10/2026 17:30');
check(J.length === 6 + 1 + 1 + 15 && J.every(j => j.d instanceof Date && !isNaN(j.d) && j.d.getFullYear() === 2026), J.length + ' lignes au journal, toutes datées (aucune vide, aucune 1970)');
const jd = (pred) => J.find(pred);
check(jd(j => j.type === 'Vente' && j.match === "Spacer's vs Sète").d.getTime() === new Date(2026, 9, 17, 20, 14).getTime(), 'texte « 17/10/2026 20:14:00 » → 17/10 20:14');
check(jd(j => j.type === 'Vente' && j.match === "Spacer's vs Cannes").d.getTime() === new Date(2026, 9, 24, 17, 30).getTime(), 'n° de série → 24/10 17:30');
check(jd(j => j.type === 'Vente' && j.match === "Spacer's vs Plessis").d.getTime() === new Date(2026, 10, 7).getTime(), 'vente sans date → date du match dans 04_MATCHS (07/11)');
check(jd(j => j.type === 'Retrait add-on').d.getTime() === new Date(2026, 10, 21, 20, 54).getTime(), 'add-on remis sans horodatage → début du match (1re vente tablette de Tours)');
check(jd(j => j.match === "Spacer's vs Cannes" && j.boutique === 'VIP').d.getTime() === new Date(2026, 9, 24, 17, 30).getTime(), 'reprise RV-10 sans date → date du match de Cannes');
check(jd(j => j.paiement === 'Groupama').d.getTime() === new Date(2026, 9, 15, 20, 0).getTime(), 'reprise Groupama : sa propre date (15/10 20:00)');

console.log('2. Ventes VIP reprises classées VIP dans leur match');
const vip = m => caisse.filter(j => j.match === "Spacer's vs " + m && j.boutique === 'VIP' && j.type !== 'Vente');
const som = l => Math.round(l.reduce((s, j) => s + j.ca, 0) * 100) / 100;
check(vip('Plessis').length === 5 && som(vip('Plessis')) === 53, 'Plessis : 5 lignes VIP reprises, 53 €');
check(vip('Narbonne').length === 4 && som(vip('Narbonne')) === 105, 'Narbonne : 4 lignes VIP reprises, 105 €');
check(vip('Sète').length === 3 && som(vip('Sète')) === 105 && vip('Sète').some(j => j.article === 'Nara Tee' && j.ca === 35), 'Sète : 3 lignes VIP (Nara 35 + écharpe 15 + maillot partenaire 55 = 105 €)');
check(vip('Cannes').length === 1 && som(vip('Cannes')) === 20, 'Cannes : 1 ligne VIP (T-shirt Freetime 20 €)');
check(vip('Plessis').every(j => j.type === 'Vente VIP hors tablette' && /journal papier/.test(j.remarque)), 'type « Vente VIP hors tablette », remarque « reprise du journal papier »');
const lead = jd(j => j.ref === 'MAP-BLC-L');
check(lead.match === "Spacer's vs Narbonne" && lead.boutique === 'Hors stand' && lead.type === 'Vente hors stand', 'RV-05 (lieu R, facture LEAD) : Narbonne, « Hors stand » — ni VIP ni hors match');
const hm = caisse.filter(j => j.boutique === 'Hors match');
check(hm.length === 2 && hm.every(j => j.match === 'Hors match' && j.type === 'Vente hors match') && som(hm) === 190,
      'Hors match : 12 écharpes Groupama (180 €) + vente Gestion « Soirée partenaires » B2 (10 €) — une occasion libre n\'est pas un match');

console.log('3. Bilan par match (4_TOP_VENTES) et contrôle de caisse');
const bil = m => D.matchs.find(x => x.match === m).bilan;
check(bil("Spacer's vs Plessis").VIP === 53 && bil("Spacer's vs Plessis").GP === 8, 'bilan Plessis : CA VIP 53 €, CA GP 8 €');
check(bil("Spacer's vs Narbonne").VIP === 105 && bil("Spacer's vs Narbonne").autre === 62 && bil("Spacer's vs Narbonne").GP === 28.5, 'bilan Narbonne : VIP 105 €, autre 62 € (facture LEAD), GP 28,50 €');
check(bil("Spacer's vs Sète").VIP === 105 && bil("Spacer's vs Cannes").VIP === 20 && bil("Spacer's vs Tours").VIP === 15, 'bilan Sète VIP 105 €, Cannes VIP 20 €, Tours VIP 15 € (tablette)');
check(bil('Hors match').autre === 190 && bil('Hors match').GP === 0 && bil('Hors match').VIP === 0, 'bilan Hors match : 190 € (plus 0 €)');
const sommeBilan = Math.round(D.matchs.reduce((s, m) => s + m.bilan.GP + m.bilan.VIP + m.bilan.autre, 0) * 100) / 100;
check(sommeBilan === totalSaison && totalSaison === Math.round((28.5 + 31.5 + 10 + 8 + 15 + 14.25 + 10 + 525) * 100) / 100,
      'somme des « CA total » du bilan (' + sommeBilan + ' €) = CA caisse saison du journal (' + totalSaison + ' €)');
const pl = D.matchs.find(x => x.match === "Spacer's vs Plessis");
check(pl.VIP.ca === 0 && pl.GP.ca === 8 && D.matchs.find(x => x.match === "Spacer's vs Tours").VIP.ca === 15,
      'contrôle de caisse (5_APRES_MATCH) : tablettes seulement — Plessis VIP 0 € (reprise hors caisse), Tours VIP 15 €');
check(D.dernierMatch === "Spacer's vs Tours" && Object.keys(D.nonSync).length === 0, 'dernier match (Tours) et rapprochement 21_LIGNES_LIVE inchangés par la reprise');
const top = D.top.find(t => t.article === 'Écharpe');
check(top.vip === 1 + 1 + 2 && top.gp === 3, 'top ventes écharpe : VIP 4 (1 tablette + 3 reprises), GP 3');

console.log('4. Fichier : onglets écrits');
run('installerFichierBoutique()');
const F = T.fichiers[T.props.FICHIER_BOUTIQUE_ID];
const Jn = F.getSheetByName('3_JOURNAL_VENTES'), Tp = F.getSheetByName('4_TOP_VENTES');
const nJ = Jn.getLastRow() - 5;
const fmt = d => run('sb_fmt_')(d, 'dd/MM/yyyy HH:mm');
check(nJ === J.length && Array.from({ length: nJ }, (_, i) => Jn.get(6 + i, 1)).every(v => v instanceof Date && /^\d{2}\/\d{2}\/2026 \d{2}:\d{2}$/.test(fmt(v))),
      '3_JOURNAL_VENTES : colonne Date remplie sur les ' + nJ + ' lignes (dd/MM/yyyy HH:mm)');
const lP = Array.from({ length: nJ }, (_, i) => 6 + i).filter(r => Jn.get(r, 2) === "Spacer's vs Plessis" && Jn.get(r, 3) === 'VIP');
check(lP.length === 5 && lP.every(r => fmt(Jn.get(r, 1)) === '07/11/2026 20:00'), 'journal : 5 lignes Plessis en Boutique « VIP », datées 07/11/2026 20:00');
const caTxt = /CA caisse saison ([\d,]+) €/.exec(Jn.get(3, 1))[1];
check(Tp.get(5, 10) === 'Match' && Tp.get(5, 13) === 'CA autre' && Tp.get(5, 14) === 'CA total' && Tp.get(5, 15) === 'Articles', '4_TOP_VENTES : bilan J–O (Match, CA GP, CA VIP, CA autre, CA total, Articles)');
const lignesM = []; for (let r = 6; Tp.get(r, 10) !== ''; r++) lignesM.push(Tp.row(r, 15).slice(9));
const lm = m => lignesM.find(l => l[0] === m);
check(lm("Spacer's vs Plessis")[2] === 53 && lm("Spacer's vs Narbonne")[2] === 105 && lm("Spacer's vs Sète")[2] === 105 && lm("Spacer's vs Cannes")[2] === 20,
      '4_TOP_VENTES : CA VIP 53 / 105 / 105 / 20 € (Plessis, Narbonne, Sète, Cannes) au lieu de 0');
check(lm('Hors match')[4] === 190 && lm('Hors match')[3] === 190, '4_TOP_VENTES : ligne « Hors match » à 190 € (et non 0)');
const totBilan = Math.round(lignesM.reduce((s, l) => s + l[4], 0) * 100) / 100;
check(totBilan.toFixed(2).replace('.', ',') === caTxt, '4_TOP_VENTES : somme des CA total ' + totBilan + ' € = « CA caisse saison » en tête du journal (' + caTxt + ' €)');
console.log(ok + ' contrôles OK');
