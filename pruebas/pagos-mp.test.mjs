// lia-pagos (docs/pagos.md): cobro de LIA Pro con Mercado Pago Checkout Pro. Apagado por defecto (PAGOS_MODO=demo).
// Supabase, Auth y Mercado Pago simulados: nunca se confía en el cuerpo del aviso, el precio lo pone la base y los
// registros no llevan tokens, correos, montos ni ids de pago.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import * as P from '../supabase/functions/lia-pagos/logica.js';
import { readFileSync } from 'node:fs';

const SECRETO = 'clave-de-avisos', TOKEN = 'APP_USR-token-secreto', REF = '11111111-1111-4111-8111-111111111111';
const ORIGEN = 'https://lia-prototipo.jaime-ramos-93c.workers.dev';
const USUARIO = { id: 'u-ana', email: 'Ana@Correo.pe', email_confirmed_at: '2026-11-01T00:00:00Z' };

function pagos({ env = {}, rpc = {}, usuario = USUARIO, mp = {} } = {}) {
  const llamadas = [], logs = [], mpLlamadas = [];
  const E = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv', SUPABASE_ANON_KEY: 'pub', MP_ACCESS_TOKEN: TOKEN, MP_WEBHOOK_SECRET: SECRETO, PAGOS_MODO: 'prueba', PAGOS_CORREOS: 'otra@x.pe, ana@correo.pe', ...env };
  const R = { crear_pago_mp: { id: REF, periodo: 'ciclo', monto: 34.9, estado: 'pendiente' }, registrar_pago_mp: 'aprobado', pago_mp_de: { id: REF, estado: 'pendiente' }, ...rpc };
  const pago = { id: 777, status: 'approved', transaction_amount: 34.9, currency_id: 'PEN', external_reference: REF, payment_method_id: 'yape', payment_type_id: 'debit_card' };
  const MP = { pago, buscar: { results: [pago] }, preferencia: { id: 'pref-1', init_point: 'https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=pref-1' }, ...mp };
  const deps = {
    env: k => E[k], log: d => logs.push(d), crypto: webcrypto,
    fetch: async (url, op = {}) => {
      const body = op.body ? JSON.parse(op.body) : null;
      if (url.includes('/auth/v1/user')) return usuario ? new Response(JSON.stringify(usuario)) : new Response('{"msg":"bad jwt"}', { status: 401 });
      if (url.startsWith(P.MP_API)) {
        mpLlamadas.push({ url, op, body });
        if (url.includes('/checkout/preferences')) return MP.preferencia ? new Response(JSON.stringify(MP.preferencia), { status: 201 }) : new Response('{}', { status: 500 });
        if (url.includes('/v1/payments/search')) return new Response(JSON.stringify(MP.buscar));
        if (url.includes('/v1/payments/')) return MP.pago ? new Response(JSON.stringify(MP.pago)) : new Response('{}', { status: 404 });
      }
      const fn = url.split('/rpc/')[1];
      llamadas.push({ fn, body, op });
      const r = R[fn];
      return new Response(JSON.stringify(typeof r === 'function' ? r(body) : r ?? null));
    },
  };
  return { deps, llamadas, logs, mpLlamadas, fn: n => llamadas.filter(l => l.fn === n) };
}
const app = (cuerpo, { origen = ORIGEN } = {}) => new Request('https://p.supabase.co/functions/v1/lia-pagos', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-de-ana', apikey: 'pub', ...(origen ? { Origin: origen } : {}) }, body: JSON.stringify(cuerpo) });
function aviso({ id = '777', tipo = 'payment', firma = null, requestId = 'req-1', ts = '1762270000000' } = {}) {
  const v1 = firma ?? createHmac('sha256', SECRETO).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
  return new Request(`https://p.supabase.co/functions/v1/lia-pagos?data.id=${id}&type=${tipo}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
    body: JSON.stringify({ action: 'payment.updated', type: tipo, data: { id } }) });
}
const json = r => r.json();
const sinDatos = logs => {
  const t = JSON.stringify(logs);
  for (const x of [TOKEN, SECRETO, 'ana@correo.pe', 'Ana@Correo.pe', REF, '777', '34.9', 'jwt-de-ana']) assert.ok(!t.includes(x), `el registro no lleva ${x}`);
};

test('modoDe: demo por defecto; en prueba, solo los correos de la lista; en real, todos', () => {
  const env = o => k => o[k];
  assert.equal(P.modoDe(env({}), 'ana@correo.pe'), 'demo');
  assert.equal(P.modoDe(env({ PAGOS_MODO: 'prueba', PAGOS_CORREOS: 'ana@correo.pe' }), ' ANA@correo.pe '), 'prueba');
  assert.equal(P.modoDe(env({ PAGOS_MODO: 'prueba', PAGOS_CORREOS: 'ana@correo.pe' }), 'beto@correo.pe'), 'demo');
  assert.equal(P.modoDe(env({ PAGOS_MODO: 'real' }), 'beto@correo.pe'), 'real');
  assert.equal(P.modoDe(env({ PAGOS_MODO: 'cualquiera' }), 'ana@correo.pe'), 'demo');
});

test('medioDe: Yape, tarjeta o saldo de Mercado Pago', () => {
  assert.equal(P.medioDe({ payment_method_id: 'yape', payment_type_id: 'debit_card' }), 'yape');
  assert.equal(P.medioDe({ payment_method_id: 'visa', payment_type_id: 'credit_card' }), 'tarjeta');
  assert.equal(P.medioDe({ payment_method_id: 'debvisa', payment_type_id: 'debit_card' }), 'tarjeta');
  assert.equal(P.medioDe({ payment_method_id: 'account_money', payment_type_id: 'account_money' }), 'mercadopago');
});

test('firmaValida: HMAC-SHA256 de id, request-id y ts; rechaza firmas falsas o incompletas', async () => {
  const v1 = createHmac('sha256', SECRETO).update('id:abc123;request-id:r;ts:5;').digest('hex');
  assert.equal(await P.firmaValida({ dataId: 'ABC123', requestId: 'r', cabecera: `ts=5,v1=${v1}` }, SECRETO, webcrypto), true, 'el id alfanumérico va en minúsculas');
  assert.equal(await P.firmaValida({ dataId: 'abc123', requestId: 'r', cabecera: `ts=5,v1=${'0'.repeat(64)}` }, SECRETO, webcrypto), false);
  assert.equal(await P.firmaValida({ dataId: 'abc123', requestId: 'r', cabecera: 'v1=algo' }, SECRETO, webcrypto), false);
  assert.equal(await P.firmaValida({ dataId: 'abc123', requestId: 'r', cabecera: `ts=5,v1=${v1}` }, '', webcrypto), false, 'sin secreto, nada vale');
});

test('estado: la app pregunta qué modo ve esta cuenta', async () => {
  const t = pagos();
  assert.deepEqual(await json(await P.manejar(app({ accion: 'estado' }), t.deps)), { ok: true, modo: 'prueba' });
  const u = pagos({ env: { PAGOS_MODO: 'demo' } });
  assert.deepEqual(await json(await P.manejar(app({ accion: 'estado' }), u.deps)), { ok: true, modo: 'demo' });
});

test('crear: el precio lo pone la base y la preferencia va en soles, en 1 cuota, con la referencia y la vuelta a LIA', async () => {
  const t = pagos();
  const r = await P.manejar(app({ accion: 'crear', periodo: 'ciclo', monto: 0.01 }), t.deps);
  assert.equal(r.status, 200);
  assert.deepEqual(await json(r), { ok: true, ref: REF, url: 'https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=pref-1' });
  assert.deepEqual(t.fn('crear_pago_mp')[0].body, { p_uid: 'u-ana', p_periodo: 'ciclo' }, 'el monto de la app no llega a la base');
  const pref = t.mpLlamadas.find(l => l.url.endsWith('/checkout/preferences'));
  assert.equal(pref.op.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(pref.op.headers['X-Idempotency-Key'], REF);
  const b = pref.body;
  assert.deepEqual(b.items, [{ id: 'lia-pro-ciclo', title: 'LIA Pro · Por ciclo (4 meses)', quantity: 1, currency_id: 'PEN', unit_price: 34.9 }]);
  assert.equal(b.external_reference, REF);
  assert.deepEqual(b.back_urls, { success: `${ORIGEN}/?pago=${REF}`, failure: `${ORIGEN}/?pago=${REF}`, pending: `${ORIGEN}/?pago=${REF}` });
  assert.equal(b.auto_return, 'approved');
  assert.equal(b.notification_url, 'https://p.supabase.co/functions/v1/lia-pagos');
  assert.equal(b.payment_methods.installments, 1);
  assert.equal(JSON.stringify(b).includes('correo.pe'), false, 'no manda el correo de la persona a Mercado Pago');
  sinDatos(t.logs);
});

test('crear: en local (http) no pide volver sola, porque Mercado Pago exige https', async () => {
  const t = pagos();
  await P.manejar(app({ accion: 'crear', periodo: 'mes' }, { origen: 'http://localhost:8787' }), t.deps);
  const b = t.mpLlamadas.find(l => l.url.endsWith('/checkout/preferences')).body;
  assert.equal(b.back_urls.success, `http://localhost:8787/?pago=${REF}`);
  assert.equal(b.auto_return, undefined);
});

test('crear: apagado (demo o fuera de la lista), sin sesión, origen ajeno o plan raro', async () => {
  for (const [deps, pedido, opts, status, error] of [
    [pagos({ env: { PAGOS_MODO: 'demo' } }).deps, { accion: 'crear', periodo: 'mes' }, {}, 409, 'apagado'],
    [pagos({ env: { PAGOS_CORREOS: 'otra@x.pe' } }).deps, { accion: 'crear', periodo: 'mes' }, {}, 409, 'apagado'],
    [pagos({ usuario: null }).deps, { accion: 'crear', periodo: 'mes' }, {}, 401, 'sesion'],
    [pagos({ usuario: { ...USUARIO, email_confirmed_at: null } }).deps, { accion: 'crear', periodo: 'mes' }, {}, 401, 'sesion'],
    [pagos().deps, { accion: 'crear', periodo: 'mes' }, { origen: 'https://otro.sitio.pe' }, 403, 'origen'],
    [pagos().deps, { accion: 'crear', periodo: 'anual' }, {}, 400, 'periodo'],
    [pagos({ mp: { preferencia: null } }).deps, { accion: 'crear', periodo: 'mes' }, {}, 502, 'mercadopago'],
  ]) {
    const r = await P.manejar(app(pedido, opts), deps);
    assert.equal(r.status, status, error);
    assert.equal((await json(r)).error, error);
  }
});

test('aviso: con firma válida consulta el pago a la API (no al cuerpo) y lo registra', async () => {
  const t = pagos();
  const r = await P.manejar(aviso(), t.deps);
  assert.equal(r.status, 200);
  const consulta = t.mpLlamadas.find(l => /\/v1\/payments\/777$/.test(l.url));
  assert.ok(consulta, 'consulta /v1/payments/777');
  assert.equal(consulta.op.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(t.fn('registrar_pago_mp')[0].body, { p_id: REF, p_pago: '777', p_estado: 'approved', p_monto: 34.9, p_moneda: 'PEN', p_medio: 'yape' });
  assert.equal(t.fn('registrar_pago_mp')[0].op.headers.apikey, 'srv', 'con la clave del servidor');
  assert.deepEqual(t.logs.at(-1), { evento: 'aviso', resultado: 'aprobado' });
  sinDatos(t.logs);
});

test('aviso: un segundo pago del mismo pedido queda en el registro como duplicado, sin ids', async () => {
  const t = pagos({ rpc: { registrar_pago_mp: 'duplicado' } });
  assert.equal((await P.manejar(aviso(), t.deps)).status, 200);
  assert.deepEqual(t.logs.at(-1), { evento: 'aviso', resultado: 'duplicado' });
  sinDatos(t.logs);
});

test('el aviso usa el id de la dirección, no el del cuerpo', async () => {
  const t = pagos();
  const req = aviso();
  const otro = new Request(req.url.replace('data.id=777&', ''), { method: 'POST', headers: req.headers, body: JSON.stringify({ type: 'payment', data: { id: '777' } }) });
  assert.equal((await P.manejar(otro, t.deps)).status, 401, 'sin data.id en la dirección, la firma no cuadra');
});

test('config.toml: lia-pagos con verify_jwt apagado (Mercado Pago avisa sin sesión)', () => {
  const toml = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(toml, /\[functions\.lia-pagos\]\s*\nenabled = true\s*\nverify_jwt = false/);
});

test('aviso: firma falsa → 401 y nada cambia; otros tipos se ignoran; pagos ajenos a LIA también', async () => {
  const t = pagos();
  assert.equal((await P.manejar(aviso({ firma: 'f'.repeat(64) }), t.deps)).status, 401);
  assert.equal(t.mpLlamadas.length + t.llamadas.length, 0);
  const u = pagos();
  assert.equal((await P.manejar(aviso({ tipo: 'merchant_order' }), u.deps)).status, 200);
  assert.equal(u.fn('registrar_pago_mp').length, 0);
  const v = pagos({ mp: { pago: { id: 778, status: 'approved', transaction_amount: 9.9, currency_id: 'PEN', external_reference: 'otra-tienda-42' } } });
  assert.equal((await P.manejar(aviso({ id: '778' }), v.deps)).status, 200);
  assert.equal(v.fn('registrar_pago_mp').length, 0, 'external_reference que no es de LIA');
});

test('aviso: si Mercado Pago o la base fallan, responde 503 para que lo reintente', async () => {
  const t = pagos({ mp: { pago: null } });
  assert.equal((await P.manejar(aviso(), t.deps)).status, 503);
  const u = pagos({ rpc: { registrar_pago_mp: () => { throw new Error('x'); } } });
  u.deps.fetch = (f => async (url, op) => (url.includes('/rpc/') ? new Response('{}', { status: 500 }) : f(url, op)))(u.deps.fetch);
  assert.equal((await P.manejar(aviso(), u.deps)).status, 503);
});

test('revisar: al volver de Mercado Pago busca los pagos de esa referencia y devuelve el estado', async () => {
  const t = pagos();
  const r = await P.manejar(app({ accion: 'revisar', ref: REF }), t.deps);
  assert.deepEqual(await json(r), { ok: true, estado: 'aprobado' });
  assert.deepEqual(t.fn('pago_mp_de')[0].body, { p_uid: 'u-ana', p_id: REF }, 'solo un pago de esta cuenta');
  assert.ok(t.mpLlamadas.some(l => l.url.includes(`/v1/payments/search?external_reference=${REF}`)));
  assert.equal(t.fn('registrar_pago_mp').length, 1);
  sinDatos(t.logs);
  // Ya aprobado: no vuelve a preguntar a Mercado Pago.
  const u = pagos({ rpc: { pago_mp_de: { id: REF, estado: 'aprobado' } } });
  assert.deepEqual(await json(await P.manejar(app({ accion: 'revisar', ref: REF }), u.deps)), { ok: true, estado: 'aprobado' });
  assert.equal(u.mpLlamadas.length, 0);
  // Todavía sin pago en Mercado Pago: pendiente.
  const v = pagos({ mp: { buscar: { results: [] } } });
  assert.deepEqual(await json(await P.manejar(app({ accion: 'revisar', ref: REF }), v.deps)), { ok: true, estado: 'pendiente' });
  // Referencia de otra cuenta o inventada.
  const w = pagos({ rpc: { pago_mp_de: { id: null } } });
  assert.equal((await P.manejar(app({ accion: 'revisar', ref: REF }), w.deps)).status, 404);
  assert.equal((await P.manejar(app({ accion: 'revisar', ref: 'x' }), pagos().deps)).status, 400);
});

test('revisar: si hay un intento rechazado y otro aprobado, gana el aprobado', async () => {
  const pagosMp = [
    { id: 1, status: 'rejected', transaction_amount: 34.9, currency_id: 'PEN', external_reference: REF, payment_method_id: 'visa', payment_type_id: 'credit_card' },
    { id: 2, status: 'approved', transaction_amount: 34.9, currency_id: 'PEN', external_reference: REF, payment_method_id: 'yape', payment_type_id: 'debit_card' },
  ];
  const t = pagos({ mp: { buscar: { results: pagosMp } }, rpc: { registrar_pago_mp: b => (b.p_estado === 'approved' ? 'aprobado' : 'rechazado') } });
  assert.deepEqual(await json(await P.manejar(app({ accion: 'revisar', ref: REF }), t.deps)), { ok: true, estado: 'aprobado' });
});

test('CORS: la app de LIA puede llamar; otros sitios no', async () => {
  const r = await P.manejar(new Request('https://p.supabase.co/functions/v1/lia-pagos', { method: 'OPTIONS', headers: { Origin: ORIGEN } }), pagos().deps);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGEN);
  assert.equal(P.origenPermitido('https://feat-x-lia-prototipo.jaime-ramos-93c.workers.dev'), true);
  assert.equal(P.origenPermitido('https://lia-prototipo.evil.dev'), false);
});
