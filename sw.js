/* Service worker de la PWA Gases Medicinales. Al cambiar archivos, subir la versión: -v1 → -v2. */
var CACHE = 'gases-medicinales-v1';
var ARCHIVOS = ['./', 'index.html', 'estilos.css', 'config.js', 'datos.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (claves) {
    // Solo se borran las cachés viejas de ESTA app; las de otras apps del mismo sitio no se tocan.
    return Promise.all(claves.filter(function (k) { return k.indexOf('gases-medicinales-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // el servidor (POST) nunca se guarda
  e.respondWith(fetch(e.request).then(function (r) {
    var copia = r.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copia); });
    return r;
  }).catch(function () { return caches.match(e.request).then(function (r) { return r || caches.match('index.html'); }); }));
});
