// Service worker — Spacer's Boutique : la caisse s'ouvre même sans réseau.
// Pages : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
// Fichiers statiques (icônes, polices, lecteur QR) : cache d'abord.
const CACHE = 'spacers-boutique-v11';
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
  if (url.pathname.endsWith('/pilotage.html')) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return r; })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }
  if (url.origin === location.origin || STATIQUES.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return r;
    })));
  }
});
