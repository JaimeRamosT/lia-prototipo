// Web Push de lia-avisos: cifrado aes128gcm (RFC 8291), firma VAPID (RFC 8292) y la función con todo simulado.
// El descifrado de estas pruebas está escrito aparte, del lado del teléfono, a partir del RFC. El 29-oct también se
// comprobó contra las bibliotecas http_ece y web-push de npm (fuera del repositorio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cifrar, cabeceraVapid, enviarPush, aB64url, deB64url } from '../supabase/functions/lia-avisos/webpush.js';
import { manejar, ttlPara, claveServidor, ORIGENES as ORIGENES_AVISOS } from '../supabase/functions/lia-avisos/logica.js';
import { ORIGENES as ORIGENES_IA } from '../supabase/functions/lia-ia/logica.js';

const S = globalThis.crypto.subtle, te = new TextEncoder();
const unir = (...p) => { const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const hkdf = async (sal, ikm, info, n) => new Uint8Array(await S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sal, info }, await S.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));

// Un "teléfono": sus claves de suscripción y cómo descifra lo que le llega.
async function telefono() {
  const par = await S.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publica = new Uint8Array(await S.exportKey('raw', par.publicKey)), auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return {
    p256dh: aB64url(publica), auth: aB64url(auth),
    async descifrar(cuerpo) {
      const sal = cuerpo.slice(0, 16), rs = new DataView(cuerpo.buffer, cuerpo.byteOffset + 16, 4).getUint32(0), idlen = cuerpo[20];
      const asPublica = cuerpo.slice(21, 21 + idlen), cifrado = cuerpo.slice(21 + idlen);
      const as = await S.importKey('raw', asPublica, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const comp = new Uint8Array(await S.deriveBits({ name: 'ECDH', public: as }, par.privateKey, 256));
      const ikm = await hkdf(auth, comp, unir(te.encode('WebPush: info\0'), publica, asPublica), 32);
      const cek = await hkdf(sal, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(sal, ikm, te.encode('Content-Encoding: nonce\0'), 12);
      const claro = new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: nonce }, await S.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cifrado));
      assert.equal(claro.at(-1), 2, 'el último registro termina con el delimitador 2');
      return { rs, texto: new TextDecoder().decode(claro.slice(0, -1)) };
    },
  };
}
async function vapid() {
  const par = await S.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { publica: aB64url(await S.exportKey('raw', par.publicKey)), privada: (await S.exportKey('jwk', par.privateKey)).d, contacto: 'https://lia.example', par };
}

test('cifrar(): el teléfono descifra exactamente el mensaje (aes128gcm, registro de 4096)', async () => {
  const t = await telefono(), msg = JSON.stringify({ tipo: 'examen_manana', ref: 'e1', cuando: '2026-10-30T01:00:00.000Z' });
  const r = await t.descifrar(await cifrar(msg, t.p256dh, t.auth));
  assert.deepEqual(r, { rs: 4096, texto: msg });
});

test('cifrar(): rechaza claves de teléfono que no son P-256', async () => {
  await assert.rejects(cifrar('x', aB64url(new Uint8Array(10)), aB64url(new Uint8Array(16))), /p256dh/);
});

test('cabeceraVapid(): JWT ES256 para el origen del servicio de push, firmado con la clave privada', async () => {
  const v = await vapid(), ahora = Date.UTC(2026, 9, 29, 12);
  const cab = await cabeceraVapid('https://web.push.apple.com/QGuQyavXutnMH', v, ahora);
  const m = cab.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, cab);
  assert.equal(m[4], v.publica);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(deB64url(m[1]))), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(deB64url(m[2]))), { aud: 'https://web.push.apple.com', exp: ahora / 1000 + 12 * 3600, sub: 'https://lia.example' });
  const ok = await S.verify({ name: 'ECDSA', hash: 'SHA-256' }, v.par.publicKey, deB64url(m[3]), te.encode(`${m[1]}.${m[2]}`));
  assert.equal(ok, true);
});

test('enviarPush(): cabeceras del protocolo y qué hacer con cada respuesta', async () => {
  const t = await telefono(), v = await vapid(), pedidos = [];
  const fetchCon = estado => async (url, op) => { pedidos.push({ url, op }); return { status: estado }; };
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: t.p256dh, auth: t.auth };
  assert.deepEqual(await enviarPush(fetchCon(201), sub, { tipo: 'sesion' }, v, { ttl: 900 }), { estado: 201, ok: true, borrar: false });
  const h = pedidos[0].op.headers;
  assert.equal(h['Content-Encoding'], 'aes128gcm'); assert.equal(h.TTL, '900'); assert.equal(h.Urgency, 'high'); assert.match(h.Authorization, /^vapid t=/);
  assert.equal(JSON.parse((await t.descifrar(pedidos[0].op.body)).texto).tipo, 'sesion');
  assert.deepEqual(await enviarPush(fetchCon(410), sub, {}, v), { estado: 410, ok: false, borrar: true });
  assert.deepEqual(await enviarPush(fetchCon(404), sub, {}, v), { estado: 404, ok: false, borrar: true });
  assert.deepEqual(await enviarPush(fetchCon(429), sub, {}, v), { estado: 429, ok: false, borrar: false });
  assert.deepEqual(await enviarPush(async () => { throw new Error('red'); }, sub, {}, v), { estado: 0, ok: false, borrar: false });
});

test('ttlPara(): hasta 1 hora después de la hora del aviso, entre 1 minuto y 1 hora', () => {
  const ahora = Date.UTC(2026, 9, 29, 12);
  assert.equal(ttlPara(new Date(ahora).toISOString(), ahora), 3600);
  assert.equal(ttlPara(new Date(ahora - 30 * 60000).toISOString(), ahora), 1800);
  assert.equal(ttlPara(new Date(ahora - 2 * 3600000).toISOString(), ahora), 60);
});

test('claveServidor(): la secreta nueva solo en apikey; la service_role antigua también en Authorization', () => {
  assert.deepEqual(claveServidor(n => ({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}' })[n]), { apikey: 'sb_secret_x' });
  assert.deepEqual(claveServidor(n => ({ SUPABASE_SERVICE_ROLE_KEY: 'eyJ.x' })[n]), { apikey: 'eyJ.x', Authorization: 'Bearer eyJ.x' });
  assert.equal(claveServidor(() => undefined), null);
});

test('los orígenes permitidos son los mismos que los de lia-ia', () => {
  assert.deepEqual(ORIGENES_AVISOS.map(String), ORIGENES_IA.map(String));
});

// ---------- La función completa, con Supabase y los servicios de push simulados ----------
async function mundo({ secretoOk = true, filas = [], plan = 'pro', subs = [], push = 201, vapidGuardadas = null } = {}) {
  const v = vapidGuardadas || null, log = [], llamadas = [], borrados = [];
  let claves = v;
  const env = n => ({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}' })[n];
  const fetch = async (url, op = {}) => {
    llamadas.push(url.replace('https://p.supabase.co', ''));
    const json = d => ({ ok: true, status: 200, json: async () => d });
    if (url.endsWith('/rpc/avisos_cron_ok')) { assert.equal(op.headers.apikey, 'sb_secret_x'); return json(secretoOk && JSON.parse(op.body).p_secreto === 'buen-secreto'); }
    if (url.endsWith('/rpc/claves_vapid')) return json([claves || { publica: null, privada: null }]);
    if (url.endsWith('/rpc/guardar_claves_vapid')) { const b = JSON.parse(op.body); claves = { publica: b.p_publica, privada: b.p_privada }; return json(true); }
    if (url.endsWith('/rpc/tomar_avisos_vencidos')) return json(filas);
    if (url.endsWith('/auth/v1/user')) return op.headers.Authorization === 'Bearer jwt-ok' ? json({ id: 'u1' }) : { ok: false, status: 401, json: async () => ({}) };
    if (url.endsWith('/rpc/mi_suscripcion')) return json({ plan });
    if (url.includes('/rest/v1/dispositivos_push?user_id=')) return json(subs);
    if (op.method === 'DELETE') { borrados.push(decodeURIComponent(url.split('endpoint=eq.')[1])); return json(null); }
    if (url.startsWith('https://push.')) return { status: typeof push === 'function' ? push(url) : push };
    throw new Error('URL inesperada ' + url);
  };
  return { deps: { env, fetch, log: d => log.push(d) }, log, llamadas, borrados, claves: () => claves };
}
const pedido = (cab = {}, cuerpo = '{"accion":"enviar"}') => new Request('https://p.supabase.co/functions/v1/lia-avisos', { method: 'POST', headers: cab, body: cuerpo });

test('pg_cron con un secreto equivocado no envía nada', async () => {
  const m = await mundo({ secretoOk: false });
  const r = await manejar(pedido({ 'x-lia-cron': 'malo' }), m.deps);
  assert.equal(r.status, 401);
  assert.ok(!m.llamadas.some(u => u.includes('tomar_avisos')));
});

test('pg_cron: crea las claves VAPID la primera vez, envía lo que toca y borra los teléfonos que ya no existen', async () => {
  const t1 = await telefono(), t2 = await telefono(), cuando = new Date().toISOString();
  const filas = [
    { aviso_id: 1, user_id: 'u1', tipo: 'examen_manana', ref: 'e1', cuando, endpoint: 'https://push.a/1', p256dh: t1.p256dh, auth: t1.auth },
    { aviso_id: 1, user_id: 'u1', tipo: 'examen_manana', ref: 'e1', cuando, endpoint: 'https://push.b/viejo', p256dh: t2.p256dh, auth: t2.auth },
  ];
  const m = await mundo({ filas, push: url => (url.includes('viejo') ? 410 : 201) });
  const r = await manejar(pedido({ 'x-lia-cron': 'buen-secreto' }), m.deps);
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual([d.enviados, d.fallidos, d.borrados], [1, 1, 1]);
  assert.deepEqual(m.borrados, ['https://push.b/viejo']);
  assert.equal(deB64url(m.claves().publica).length, 65, 'guardó una clave pública P-256');
  // El registro no lleva direcciones de teléfonos ni textos.
  assert.ok(!JSON.stringify(m.log).includes('push.a'));
});

test('pg_cron sin avisos pendientes responde rápido', async () => {
  const m = await mundo({ vapidGuardadas: await vapid() });
  const d = await (await manejar(pedido({ 'x-lia-cron': 'buen-secreto' }), m.deps)).json();
  assert.deepEqual(d, { ok: true, enviados: 0 });
});

test('aviso de prueba: exige sesión, Pro y un origen permitido; manda a los teléfonos de la cuenta', async () => {
  const t = await telefono(), v = await vapid(), app = { origin: 'https://lia-prototipo.jaime-ramos-93c.workers.dev', apikey: 'sb_publishable_x' };
  const cuerpo = '{"accion":"prueba"}';
  let m = await mundo({ vapidGuardadas: v });
  assert.equal((await manejar(pedido({ ...app, authorization: 'Bearer jwt-malo' }, cuerpo), m.deps)).status, 401);
  assert.equal((await manejar(pedido({ ...app, origin: 'https://otra.app', authorization: 'Bearer jwt-ok' }, cuerpo), m.deps)).status, 403);
  m = await mundo({ vapidGuardadas: v, plan: 'gratis' });
  assert.deepEqual(await (await manejar(pedido({ ...app, authorization: 'Bearer jwt-ok' }, cuerpo), m.deps)).json(), { ok: false, error: 'solo_pro' });
  m = await mundo({ vapidGuardadas: v, subs: [] });
  assert.equal((await manejar(pedido({ ...app, authorization: 'Bearer jwt-ok' }, cuerpo), m.deps)).status, 404);
  m = await mundo({ vapidGuardadas: v, subs: [{ endpoint: 'https://push.a/1', p256dh: t.p256dh, auth: t.auth }] });
  const d = await (await manejar(pedido({ ...app, authorization: 'Bearer jwt-ok' }, cuerpo), m.deps)).json();
  assert.deepEqual([d.ok, d.enviados], [true, 1]);
});
