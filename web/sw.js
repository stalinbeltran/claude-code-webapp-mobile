// Service worker: que la app ABRA sin red. Nada más.
//
// ⚠⚠ RED PRIMERO, CACHÉ DESPUÉS — y esto no es una preferencia de rendimiento.
// El resto de este servidor manda `cache-control: no-store` a propósito, porque
// **un armazón viejo servido desde caché es indistinguible de un servidor
// caído**: abres la app, ves lo de siempre, y no hay forma de saber que estás
// mirando una versión de hace tres despliegues. Un service worker que sirviera
// de caché por defecto reintroduciría ese fallo por la puerta de atrás.
//
// Así que: se intenta la red **siempre**; la caché sólo entra cuando la red
// falla, que es el caso para el que existe (el metro, el ascensor, el móvil sin
// Tailscale un momento). Y cada respuesta buena refresca la copia.
//
// ⚠ Y NO se cachea `/api/`: los datos siempre vienen del servidor. Enseñar una
// conversación de ayer como si fuera de ahora es exactamente lo que el aviso de
// «el bot parece parado» existe para evitar.

const CACHE = 'armazon-v2';

// Lo mínimo para que la app arranque y pinte. Los datos NO están aquí.
const ARMAZON = [
  '/', '/app.js', '/estilo.css', '/markdown.js', '/plantilla.js', '/diagnostico.js',
  '/vendor/vue.esm-browser.prod.js', '/vendor/markdown-it.min.js',
  '/manifest.webmanifest', '/icono.svg',
];

self.addEventListener('install', (e) => {
  // `skipWaiting`: al desplegar (`git pull` + reiniciar) la versión nueva entra
  // en el siguiente arranque, sin tener que cerrar todas las pestañas.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARMAZON)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Fuera las cachés de versiones anteriores: si no, ocupan sitio para siempre.
    for (const n of await caches.keys()) if (n !== CACHE) await caches.delete(n);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Los datos, el aviso en vivo y cualquier cosa de fuera: sin tocar.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin
      || url.pathname.startsWith('/api/')) return;

  e.respondWith((async () => {
    try {
      const r = await fetch(e.request);
      if (r && r.ok) {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {});
      }
      return r;
    } catch (err) {
      // Sólo aquí entra la caché: cuando de verdad no hay red.
      const guardada = await caches.match(e.request);
      if (guardada) return guardada;
      throw err;
    }
  })());
});
