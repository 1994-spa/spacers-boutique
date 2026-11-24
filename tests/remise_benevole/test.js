// Test de la remise bénévole : reconnaissance du QR d'accréditation, empreinte, calcul des totaux.
// Fonctions extraites telles quelles de index.html. Lancer : node tests/remise_benevole/test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const prendre = re => { const m = html.match(re); assert(m, 'introuvable : ' + re); return m[0]; };
const code = [
  prendre(/const r2=n=>.*\n/),
  prendre(/function tauxRemise\(b\)\{[\s\S]*?\n\}\n/),
  prendre(/const typeRemise=.*\n/),
  prendre(/function estComposant\(l,motif\)\{[\s\S]*?\n\}\n/),
  prendre(/function totaux\(items,b,opt\)\{[\s\S]*?\n\}\n/),
  prendre(/async function sha256Hex\(txt\)\{[\s\S]*?\n\}\n/),
  prendre(/\/\/ \[remise-benevole\][\s\S]*?\/\/ \[\/remise-benevole\]/),
].join('\n');
const TOKEN = '0123456789ABCDEF0123456789ABCDEF';
const H = crypto.createHash('sha256').update(TOKEN).digest('hex');
const ctx = { crypto: crypto.webcrypto, TextEncoder, window: { crypto: crypto.webcrypto },
  ABO: { remise: 0.10 }, REG: { remise_billet: 0.05, packs: [] }, CFG: { boutique_id: 'B1' },
  BEN: { liste: { [H]: ['Méline', 'P', 0.10] } }, refOf: l => l.ref || '' };
vm.runInNewContext(code + '\nthis.api={totaux,tauxRemise,typeRemise,tokenAccred,chercherBenevole};', ctx);
const { totaux, tauxRemise, typeRemise, tokenAccred, chercherBenevole } = ctx.api;
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('OK  ' + m); };
(async () => {
  ok(tokenAccred('SPB:' + TOKEN) === TOKEN, 'QR accréditation reconnu');
  ok(tokenAccred('spb:' + TOKEN.toLowerCase()) === TOKEN, 'QR en minuscules reconnu');
  ok(tokenAccred('4012345678') === null, 'code de billet Tickie ignoré');
  ok(tokenAccred(TOKEN) === null, 'sans préfixe SPB: → pas une accréditation');
  ok(tokenAccred('SPB:' + TOKEN + 'AB') === null, 'jeton trop long refusé');
  const b = await chercherBenevole('SPB:' + TOKEN);
  ok(b.connu && b.h === H && b.prenom === 'Méline' && b.taux === 0.10, 'bénévole trouvé par son empreinte, taux 10 %');
  const inc = await chercherBenevole('SPB:' + 'F'.repeat(32));
  ok(inc && !inc.connu && inc.taux === 0, 'accréditation hors liste : reconnue, sans remise');
  ok(await chercherBenevole('4012345678') === null, 'un billet ne passe pas par la branche bénévole');

  const ben = { valide: true, ben: true, taux: 0.10, ben_h: H };
  const panier = [{ id: 'a', nom: 'Écharpe', prix_vente: 20, qty: 1 }, { id: 'b', nom: 'Mug', prix_vente: 12.5, qty: 2 }];
  let T = totaux(panier, ben);
  ok(T.typ === 'benevole' && T.taux === 0.10 && T.brut === 45 && T.remise === 4.5 && T.net === 40.5, 'bénévole −10 % : 45,00 → 40,50');
  ok(T.lignes.every(l => l.remise_type === 'benevole'), 'lignes marquées « benevole »');
  T = totaux(panier, Object.assign({}, ben, { taux: 0.20 }));
  ok(T.net === 36, 'palier Étoile −20 % : 45,00 → 36,00');
  T = totaux([{ id: 'a', nom: 'Écharpe', prix_vente: 20, qty: 1, tarif: 'partenaire' }], ben);
  ok(T.remise === 0, 'jamais de remise sur une ligne au tarif partenaire');
  T = totaux(panier, ben, { sansRemise: true });
  ok(T.remise === 0, 'pas de remise sur un article offert');
  ok(tauxRemise({ valide: true, abo: true }) === 0.10 && typeRemise({ abo: true }) === 'abonne', 'abonné inchangé (−10 %)');
  ok(tauxRemise({ valide: true }) === 0.05 && typeRemise({}) === 'billet', 'billet inchangé (−5 %)');
  ok(tauxRemise({ valide: true, nonVerifie: true }) === 0, 'billet non vérifié : toujours sans remise');
  ok(tauxRemise(null) === 0, 'sans scan : aucune remise');
  console.log('Tous les cas passent (' + n + ')');
})().catch(e => { console.error('KO  ' + e.message); process.exit(1); });
