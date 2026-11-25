// Tests des calculs de caisse de la tablette (index.html) : remises au centime, packs, article hors catalogue,
// totaux de clôture par terminal, écart signé, délai réseau. Les fonctions sont extraites telles quelles d'index.html.
// Lancer : node tests/caisse/test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const js = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

/** Source d'une fonction (« function nom( … } ») ou d'une constante sur une ligne (« const nom=… »). */
function extraire(nom) {
  let i = js.search(new RegExp('(^|\\n)\\s*(async\\s+)?function ' + nom + '\\('));
  if (i >= 0) {
    i = js.indexOf('function', i); if (js.slice(i - 6, i) === 'async ') i -= 6;
    let j = js.indexOf('{', i), n = 0, k = j;
    for (; k < js.length; k++) { if (js[k] === '{') n++; else if (js[k] === '}' && --n === 0) break; }
    return js.slice(i, k + 1);
  }
  const m = js.match(new RegExp('(^|\\n)(const ' + nom + '=[^\\n]*)'));
  assert(m, nom + ' introuvable dans index.html');
  return m[2];
}
const NOMS = ['r2', 'tauxRemise', 'typeRemise', 'refOf', 'estComposant', 'totaux', 'totauxCloture', 'ecartSigne', 'fetchJSON'];
const ctx = { CFG: { boutique_id: 'B1' }, ABO: { remise: 0.10 }, REG: { remise_billet: 0.05, packs: [] }, AbortController, setTimeout, clearTimeout, Math, Number, String, Set, Object, JSON, Error, RegExp, Promise };
vm.createContext(ctx);
vm.runInContext(NOMS.map(extraire).join('\n') + '\n;this.X={' + NOMS.join(',') + '};', ctx);
const X = ctx.X;
let ok = 0;
const check = (c, m) => { assert(c, m); ok++; console.log('  ✓ ' + m); };
const art = (nom, prix, qty, o) => Object.assign({ id: nom, nom, ref_boutique: nom, prix_vente: prix, qty: qty || 1, k: nom, src: '' }, o || {});
const ABO = { valide: true, abo: true }, BIL = { valide: true }, HL = { valide: true, nonVerifie: true };

console.log('1. Remises au centime (registre : abonné −10 %, billet −5 %, non cumulées)');
{
  let T = X.totaux([art('Maillot Blanc - M', 62)], ABO);
  check(T.remise === 6.2 && T.net === 55.8, 'maillot 62 € abonné : −6,20 € → 55,80 €');
  T = X.totaux([art('Écharpe', 15)], BIL);
  check(T.remise === 0.75 && T.net === 14.25, 'écharpe 15 € billet : −0,75 € → 14,25 € (chiffres de Tours)');
  T = X.totaux([art('Écharpe', 15, 3)], BIL);
  check(T.brut === 45 && T.remise === 2.25 && T.net === 42.75, '3 écharpes billet : 45 − 2,25 = 42,75 €');
  T = X.totaux([art('Maillot Blanc - M', 62)], Object.assign({ abo: true, valide: true }, {}));
  check(T.taux === 0.1, 'abonné : 10 % (jamais 10 % + 5 %)');
  T = X.totaux([art('Écharpe', 15)], HL);
  check(T.remise === 0, 'billet non vérifié (hors ligne) : pas de remise');
  T = X.totaux([art('Maillot partenaire', 55, 1, { tarif: 'partenaire' })], ABO);
  check(T.remise === 0 && T.net === 55, 'tarif partenaire : jamais de remise');
  T = X.totaux([art('Gourde', 10)], ABO, { sansRemise: true });
  check(T.remise === 0, 'offert : pas de remise');
  // somme des lignes = total, au centime, sur des prix « difficiles »
  const prix = [14.25, 33.33, 19.99, 7.45, 62, 40, 60, 12.5, 0.99];
  let maxEcart = 0;
  for (const b of [ABO, BIL, null]) for (let q = 1; q <= 4; q++) {
    const T2 = X.totaux(prix.map((p, i) => art('A' + i, p, q)), b);
    const somme = Math.round(T2.lignes.reduce((s, l) => s + Math.round(l.net * 100), 0)) / 100;
    maxEcart = Math.max(maxEcart, Math.abs(somme - T2.net), Math.abs(T2.brut - T2.remise - T2.net));
    T2.lignes.forEach(l => { assert(Math.round(l.net * 100) === l.net * 100 || Math.abs(Math.round(l.net * 100) - l.net * 100) < 1e-6, 'ligne au centime'); });
  }
  check(maxEcart < 0.005, 'total = somme des lignes = brut − remise, au centime (108 paniers testés)');
}

console.log('2. Article hors catalogue (DIVERS)');
{
  const div = art('Divers – Bonnet bleu', 20, 1, { ref_boutique: 'DIVERS', libre: true });
  const T = X.totaux([div], ABO);
  check(T.remise === 2 && T.net === 18, 'bonnet 20 € (prix étiquette) abonné : une seule remise −2 € → 18 €');
  ctx.REG.packs = [{ nom: 'Pack Maillot + Écharpe', a: 'maillot', b: '[ée]charpe', prix: { B1: 70, B2: 70 } }];
  const P = X.totaux([art('Maillot Blanc - M', 62), art('Écharpe', 15)], BIL);
  check(P.nbPacks === 1 && P.net === 70 && P.remise === 7, 'pack maillot + écharpe : 77 € → 70 € (plus avantageux que −5 %)');
  check(P.lignes[0].remise + P.lignes[1].remise === 7 && P.lignes[0].remise === 5.64, 'remise du pack répartie au prorata, au centime (5,64 + 1,36)');
  const D = X.totaux([art('Maillot Blanc - M', 62), art('Divers – écharpe', 15, 1, { ref_boutique: 'DIVERS', libre: true })], BIL);
  check(D.nbPacks === 0 && D.remise === 3.85, 'une ligne DIVERS « écharpe » ne déclenche jamais le pack (−5 % sur les deux : 3,85 €)');
  ctx.REG.packs = [];
}

console.log('3. Clôture : CB par terminal, écart signé');
{
  const v = [
    { groupe: 'g1', mode_paiement: 'CB', ca_ligne: 14.25, tpe: '2668544-001', quantite: 1 },
    { groupe: 'g1', mode_paiement: 'CB', ca_ligne: 55.8, tpe: '2668544-001', quantite: 1 },
    { groupe: 'g2', mode_paiement: 'CB', ca_ligne: 57, tpe: '2668543-001', quantite: 1 },
    { groupe: 'g3', mode_paiement: 'Espèces', ca_ligne: 14.25, quantite: 1 },
    { groupe: 'g4', mode_paiement: 'Offert', ca_ligne: 0, quantite: 2 },
  ];
  const T = X.totauxCloture(v);
  const t1 = T.tpe.find(t => t.tpe === '2668544-001'), t2 = T.tpe.find(t => t.tpe === '2668543-001');
  check(T.cb === 127.05 && T.esp === 14.25 && T.offerts === 2 && T.nb === 3, 'CB 127,05 € · espèces 14,25 € · 2 offerts · 3 tickets payants');
  check(t1.cb === 70.05 && t1.nb === 1 && t2.cb === 57, 'par terminal : D177 GP 70,05 € (1 ticket), D177 Buvette 2 57 €');
  check(X.ecartSigne(14, 15) === -1 && X.ecartSigne('15,00'.replace(',', '.'), 15) === 0 && X.ecartSigne(16.5, 15) === 1.5, 'écart signé : 14 − 15 = −1 ; 16,50 − 15 = +1,50');
  check(X.ecartSigne('', 15) === null && X.ecartSigne(null, 15) === null, 'rien saisi : pas d\'écart (null, pas 0)');
}

(async () => {
  console.log('4. Délai réseau (fetchJSON)');
  ctx.fetch = (url, opt) => Promise.resolve({ status: 200, text: () => new Promise((res, rej) => { opt.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) });
  const t0 = Date.now();
  await assert.rejects(() => X.fetchJSON('https://x', {}, 80), /délai dépassé/);
  check(Date.now() - t0 < 1000, 'corps de réponse bloqué : abandon au bout du délai (le minuteur couvre la lecture du JSON)');
  ctx.fetch = () => Promise.resolve({ status: 200, text: () => Promise.resolve('{"status":"ok","n":2}') });
  const d = await X.fetchJSON('https://x', {}, 80);
  check(d.status === 'ok' && d.n === 2, 'réponse normale : JSON lu');
  ctx.fetch = () => Promise.resolve({ status: 302, text: () => Promise.resolve('<html>') });
  await assert.rejects(() => X.fetchJSON('https://x', {}, 80), /réponse illisible \(HTTP 302\)/);
  check(true, 'réponse non JSON (page de connexion Google…) : erreur claire, rien marqué comme envoyé');
  console.log(ok + ' contrôles OK');
})().catch(e => { console.error(e); process.exit(1); });
