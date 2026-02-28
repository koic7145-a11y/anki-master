const CACHE_NAME = 'anki-master-v11-rollback';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './db.js',
    './supabase-sync.js',
    './manifest.json',
    './icon.svg',
    'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((names) =>
            Promise.all(
                names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // Never cache Supabase API requests
    if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) {
        e.respondWith(fetch(e.request));
        return;
    }

    e.respondWith(
        caches.match(e.request).then((response) => response || fetch(e.request))
    );
});
