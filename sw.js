// Service worker — Spacer's Boutique : la caisse s'ouvre même sans réseau.
// Pages : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
// Fichiers statiques (icônes, polices, lecteur QR) : cache d'abord.
// v20 (25/11/2026) : index.html — délais réseau partout, vente en une transaction, terminal CB par vente, contrôle de caisse
//   à la clôture, article hors catalogue au prix étiquette ; retraits.html GP seulement ; ancienne caisse sans no-cors.
// v19 (24/11/2026) : index.html — double affiche Tickie : adversaire pris dans le segment « Spacer's », heure 18:00 si début < 16:00.
// v18 (23/11/2026) : index.html corrigé (envoi à la sortie de veille, délai max 20 s, bénévole obligatoire, article hors catalogue).
const CACHE = 'spacers-boutique-v20';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './fonts/sansation-bold.woff2', './fonts/heaters.woff2',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const STATIQUES = ['cdn.jsdelivr.net'];

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Jamais de cache pour l'Apps Script, le relais Tickie ou le tableau de bord
  if (url.hostname.includes('script.google') || url.hostname.includes('googleusercontent') || url.hostname.includes('tickie-proxy')) return;
  if (url.pathname.endsWith('/pilotage.html') || url.pathname.endsWith('/gestion.html')) return;

  if (req.mode === 'navigate') {
    // Réseau lent (salle pleine) : au-delà de 4 s on sert la version en cache. Seules les vraies pages (200) sont mises en cache
    // (jamais une page de portail wifi ou d'erreur).
    const cache = () => caches.match('./index.html').then(r => r || caches.match('./'));
    const reseau = fetch(req).then(r => {
      const page = url.pathname.replace(/^.*\//, '');
      if (r.ok && r.type === 'basic' && (page === '' || page === 'index.html')) { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); }
      return r;
    });
    e.respondWith(new Promise(resolve => {
      let fini = false;
      const t = setTimeout(() => cache().then(r => { if (r && !fini) { fini = true; resolve(r); } }), 4000);
      reseau.then(r => { if (!fini) { fini = true; clearTimeout(t); resolve(r); } })
        .catch(() => cache().then(r => { if (!fini) { fini = true; clearTimeout(t); resolve(r || Response.error()); } }));
    }));
    return;
  }
  if (url.origin === location.origin || STATIQUES.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return r;
    })));
  }
});
