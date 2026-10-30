// LIA · service worker
// Guarda una copia de la app para abrirla sin internet. Con conexión, siempre pide la versión
// más nueva primero, así cada cambio publicado llega sin tener que tocar este archivo.
// El cliente de Supabase (vendor/) no se descarga al instalar: se guarda la primera vez que alguien usa su cuenta.

const VERSION = '0.6.0';
const CACHE = `lia-${VERSION}`;
// La app se guarda y se pide por la raíz del sitio ('./'), no por './index.html': en Cloudflare, /index.html
// redirige a la raíz, y una copia que viene de una redirección no sirve para abrir la página sin internet.
const SHELL = [
  './',
  './manifest.webmanifest',
  './config.js',
  './fonts/inter-latin-wght-normal.woff2',
  './icons/favicon.svg',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];
const WAIT_MS = 4000; // si la red tarda más, se usa la copia guardada
const APP = new URL('./', self.location).href;
const INDEX = new URL('./index.html', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lia-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.origin + url.pathname;
  if (req.mode === 'navigate') {
    // Solo la app (en la raíz o como /index.html); cualquier otra página del sitio va directo a la red.
    if (path !== APP && path !== INDEX) return;
    event.respondWith(networkFirst(event, new Request(APP, { cache: 'no-cache', credentials: 'same-origin' }), APP));
    return;
  }
  event.respondWith(networkFirst(event, req, req));
});

async function networkFirst(event, req, key) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then(async (res) => {
    if (res.ok && res.type === 'basic') await cache.put(key, res.clone());
    return res;
  });
  event.waitUntil(network.then(() => {}, () => {}));
  try {
    return sinRedireccion(await withTimeout(network, WAIT_MS));
  } catch (err) {
    const saved = await cache.match(key, { ignoreSearch: true });
    return saved ? sinRedireccion(saved) : network;
  }
}

// Una respuesta que vino de una redirección no puede usarse para abrir la página: se entrega una copia sin ese dato.
function sinRedireccion(res) {
  return res.redirected
    ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })
    : res;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tiempo de espera')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

// ---------- Recordatorios en el teléfono (LIA Pro, docs/notificaciones.md) ----------
// El servidor solo manda {tipo, ref, cuando}: el texto con el nombre del curso lo guardó la app en este teléfono
// (caché «datos-avisos»; no empieza con «lia-», así que no se borra al cambiar de versión). Si no está, va un texto
// genérico. En iPhone cada aviso tiene que mostrarse siempre: nunca se descarta en silencio.
const CACHE_AVISOS = 'datos-avisos';
const GENERICOS = {
  examen_manana: { titulo: 'Mañana tienes una evaluación', cuerpo: 'Abre LIA para ver a qué hora.' },
  examen_pronto: { titulo: 'Tu evaluación es en 2 horas', cuerpo: '¡Éxitos!' },
  sesion: { titulo: 'En 15 minutos te toca estudiar', cuerpo: 'Abre LIA para ver tu bloque de estudio.' },
  resumen: { titulo: 'Tu día con LIA', cuerpo: 'Abre LIA para ver qué estudias hoy.' },
  sin_marcar: { titulo: '¿Estudiaste hoy?', cuerpo: 'Si estudiaste, márcalo en LIA para que Lía cuente tu avance.' },
  prueba: { titulo: 'Recordatorios activos', cuerpo: 'Así te avisará Lía en este teléfono, aunque la app esté cerrada.' },
};

async function textoDeAviso(aviso) {
  try {
    const res = await (await caches.open(CACHE_AVISOS)).match('./avisos.json');
    const textos = res ? await res.json() : {};
    const t = textos[`${aviso.tipo}|${aviso.ref}`];
    if (t && t.titulo) return t;
  } catch (e) { /* va el genérico */ }
  return GENERICOS[aviso.tipo] || { titulo: 'LIA', cuerpo: 'Tienes un aviso de Lía.' };
}

self.addEventListener('push', (event) => {
  let aviso = {};
  try { aviso = event.data ? event.data.json() : {}; } catch (e) { aviso = {}; }
  event.waitUntil(textoDeAviso(aviso).then((t) => self.registration.showNotification(t.titulo, {
    body: t.cuerpo,
    icon: new URL('./icons/icon-192.png', self.location).href,
    tag: `${aviso.tipo || 'lia'}|${aviso.ref || ''}`,
    lang: 'es',
    data: { url: APP },
  })));
});

// Al tocar el aviso, abre LIA (o la trae al frente si ya estaba abierta).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
    const abierta = lista.find((c) => c.url.startsWith(APP));
    if (abierta) return abierta.focus();
    return self.clients.openWindow(APP);
  }));
});
