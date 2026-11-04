// Cobro con Mercado Pago (docs/pagos.md, borrador): apagado por defecto. Con PAGOS_MP.activo y el servidor en
// «prueba» para la cuenta, el checkout lleva a Mercado Pago y, al volver, LIA confirma el pago con lia-pagos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar, pestana } from './ayuda.mjs';

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });

const REF = '11111111-1111-4111-8111-111111111111';
const dia = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

async function preparar(dispositivo, { modo = 'prueba', revisar = ['aprobado'], crear = null, sub = null, url = srv.url, guardado = false, revisarFalla = null } = {}) {
  const { ctx, pg, errores } = await abrir(nav, url, dispositivo);
  // El pago empezó en este navegador (lo que guarda «Pagar con Mercado Pago» antes de ir a Mercado Pago).
  if (guardado) await ctx.addInitScript(ref => { if (!sessionStorage.getItem('ya')) { sessionStorage.setItem('ya', '1'); localStorage.setItem('lia.pagoMp', JSON.stringify({ ref, why: 'plans', period: 'ciclo', t: Date.now() })); } }, REF);
  const m = { pedidos: [], fila: sub, revisar: [...revisar] };
  await ctx.route('**/rest/v1/rpc/mi_suscripcion', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m.fila || { plan: 'gratis' }) }));
  await ctx.route('**/functions/v1/lia-pagos', async r => {
    const b = r.request().postDataJSON(), resp = (d, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(d) });
    m.pedidos.push(b);
    if (r.request().headers().authorization !== 'Bearer sesion-de-prueba') return resp({ ok: false, error: 'sesion' }, 401);
    if (b.accion === 'estado') return resp({ ok: true, modo });
    if (b.accion === 'crear') return crear ? resp(crear, 409) : resp({ ok: true, ref: REF, url: 'https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=p1' });
    if (b.accion === 'revisar' && revisarFalla) return resp({ ok: false, error: revisarFalla }, 401);
    if (b.accion === 'revisar') {
      const estado = m.revisar.length > 1 ? m.revisar.shift() : m.revisar[0];
      if (estado === 'aprobado') m.fila = { plan: 'pro', periodo: 'ciclo', medio: 'yape', desde: dia(0), hasta: dia(120), renovacion_automatica: false, demo: false };
      return resp({ ok: true, estado });
    }
  });
  // Mercado Pago cobra y vuelve a LIA con la referencia (y sus propios parámetros).
  await ctx.route('https://www.mercadopago.com.pe/**', r => r.fulfill({ status: 302, headers: { Location: `${srv.url}?pago=${REF}&collection_status=approved&payment_id=999&external_reference=${REF}` } }));
  const sesion = () => localStorage.setItem('lia.auth', JSON.stringify({ access_token: 'sesion-de-prueba', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: { id: 'u1', email: 'ana@correo.pe', aud: 'authenticated', role: 'authenticated' } }));
  await ctx.addInitScript(sesion);
  await registrar(pg);
  await pg.evaluate(sesion);
  await pg.evaluate(() => { state.cuenta = { id: 'u1', email: 'ana@correo.pe' }; save(); });
  if (sub) await pg.evaluate(() => refrescarPlan(false));
  return { ctx, pg, errores, m };
}
const activar = pg => pg.evaluate(() => { PAGOS_MP.activo = true; });
const abrirPago = async pg => { await pg.evaluate(() => openPaywall('plans')); await pg.locator('.sheet').getByRole('button', { name: 'Continuar' }).click(); };

test('apagado (como se publica): no llama a lia-pagos y el checkout es el de siempre', async () => {
  const { ctx, pg, errores, m } = await preparar('iPhone');
  await abrirPago(pg);
  await pg.locator('.sheet').getByRole('button', { name: 'Simular pago aprobado' }).waitFor();
  assert.equal(m.pedidos.length, 0);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('activo, pero la cuenta no está en la prueba: checkout de siempre', async () => {
  const { ctx, pg, errores, m } = await preparar('iPhone', { modo: 'demo' });
  await activar(pg);
  await abrirPago(pg);
  await pg.locator('.sheet').getByRole('button', { name: 'Simular pago aprobado' }).waitFor();
  assert.deepEqual(m.pedidos.map(p => p.accion), ['estado']);
  assert.deepEqual(errores, []);
  await ctx.close();
});

for (const dispositivo of ['iPhone', 'Android', 'Computadora']) {
  test(`${dispositivo}: paga en Mercado Pago, vuelve y LIA confirma el Pro`, async () => {
    const { ctx, pg, errores, m } = await preparar(dispositivo, { revisar: ['pendiente', 'aprobado'] });
    await activar(pg);
    await abrirPago(pg);
    const hoja = pg.locator('.sheet');
    await hoja.getByRole('button', { name: 'Pagar con Mercado Pago' }).waitFor();
    const texto = await hoja.innerText();
    assert.match(texto, /Te llevamos a Mercado Pago para que pagues con Yape o tarjeta, y luego vuelves aquí\./);
    assert.match(texto, /Modo prueba\./);
    assert.equal(await hoja.getByRole('button', { name: 'Simular pago aprobado' }).count(), 0);
    await Promise.all([pg.waitForURL(u => u.searchParams.get('pago') === null && !u.href.includes('mercadopago'), { waitUntil: 'load' }).catch(() => {}),
      hoja.getByRole('button', { name: 'Pagar con Mercado Pago' }).click()]);
    assert.deepEqual(m.pedidos.find(p => p.accion === 'crear'), { accion: 'crear', periodo: 'ciclo' }, 'la app no manda el monto');
    await pg.getByRole('heading', { name: 'Ya tienes LIA Pro' }).waitFor({ timeout: 15000 });
    assert.ok(m.pedidos.filter(p => p.accion === 'revisar').every(p => p.ref === REF));
    assert.equal(new URL(pg.url()).search, '', 'la dirección queda limpia');
    assert.equal(await pg.evaluate(() => isPro()), true);
    assert.equal(await pg.evaluate(() => localStorage.getItem('lia.pagoMp')), null);
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}

test('al volver con un pago rechazado: «No se te cobró nada» e «Intentar de nuevo» vuelve a Mercado Pago', async () => {
  const { ctx, pg, errores } = await preparar('iPhone', { revisar: ['rechazado'], guardado: true });
  await pg.goto(`${srv.url}?pago=${REF}`);
  await activar(pg);
  const hoja = pg.locator('.sheet');
  await hoja.getByText(/No se te cobró nada\. Mercado Pago no aprobó el pago/).waitFor({ timeout: 10000 });
  await hoja.getByRole('button', { name: 'Intentar de nuevo' }).click();
  await hoja.getByRole('button', { name: 'Pagar con Mercado Pago' }).waitFor();
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('si no llega el pago: a los pocos segundos se puede cerrar y al final dice que no se cobró nada', async () => {
  const { ctx, pg, errores, m } = await preparar('iPhone', { revisar: ['pendiente'], guardado: true });
  await pg.clock.install();
  await pg.goto(`${srv.url}?pago=${REF}`);
  const hoja = pg.locator('.sheet');
  await hoja.getByRole('heading', { name: 'Confirmando tu pago' }).waitFor();
  for (let i = 0; i < 3; i++) { await pg.clock.runFor(3100); await pg.waitForTimeout(50); }
  await hoja.getByText('Sigue en marcha. Puedes cerrar: si pagaste, tu Pro se activa solo.').waitFor();
  await hoja.getByRole('button', { name: 'Cerrar' }).waitFor();
  for (let i = 0; i < 8; i++) { await pg.clock.runFor(3100); await pg.waitForTimeout(50); }
  await hoja.getByRole('heading', { name: 'Aún no vemos tu pago' }).waitFor();
  assert.match(await hoja.innerText(), /Si no llegaste a pagar, no se te cobró nada\./);
  assert.equal(m.pedidos.filter(p => p.accion === 'revisar').length, 10);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('cerrar mientras confirma deja de preguntar', async () => {
  const { ctx, pg, errores, m } = await preparar('Computadora', { revisar: ['pendiente'], guardado: true });
  await pg.clock.install();
  await pg.goto(`${srv.url}?pago=${REF}`);
  const hoja = pg.locator('.sheet');
  for (let i = 0; i < 3; i++) { await pg.clock.runFor(3100); await pg.waitForTimeout(50); }
  await hoja.getByRole('button', { name: 'Cerrar' }).click();
  const antes = m.pedidos.filter(p => p.accion === 'revisar').length;
  for (let i = 0; i < 4; i++) { await pg.clock.runFor(3100); await pg.waitForTimeout(50); }
  assert.ok(m.pedidos.filter(p => p.accion === 'revisar').length <= antes + 1);
  assert.equal(await pg.locator('.sheet').count(), 0);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('monto distinto: no promete Pro y ofrece escribir por WhatsApp', async () => {
  const { ctx, pg, errores } = await preparar('iPhone', { revisar: ['monto_distinto'] });
  await pg.evaluate(() => { PAGOS_MP.activo = true; Object.assign(PREVENTA, { yape: '987654321', titular: 'Coco Pérez', whatsapp: '51987654321' }); });
  await pg.evaluate(ref => { history.replaceState(null, '', '?pago=' + ref); alVolverDePago(); }, REF);
  const hoja = pg.locator('.sheet');
  await hoja.getByRole('heading', { name: 'No pudimos activar tu Pro' }).waitFor();
  const href = await hoja.getByRole('link', { name: 'Escribir por WhatsApp (se abre en una pestaña nueva)' }).getAttribute('href');
  assert.ok(href.startsWith('https://wa.me/51987654321?text='));
  assert.doesNotMatch(await hoja.innerText(), /No se te cobró nada/);
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('apagado: un enlace con ?pago= que no empezó aquí no llama a lia-pagos y deja la dirección limpia', async () => {
  const { ctx, pg, errores, m } = await preparar('Android');
  await pg.goto(`${srv.url}?pago=${REF}&collection_status=approved`);
  await pg.waitForTimeout(400);
  assert.equal(m.pedidos.length, 0);
  assert.equal(await pg.locator('.sheet').count(), 0);
  assert.equal(new URL(pg.url()).search, '');
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('sesión vencida al volver: lo dice, en vez de «no se te cobró nada»', async () => {
  const { ctx, pg, errores } = await preparar('iPhone', { guardado: true, revisarFalla: 'sesion' });
  await pg.goto(`${srv.url}?pago=${REF}`);
  const hoja = pg.locator('.sheet');
  await hoja.getByRole('heading', { name: 'Entra de nuevo a tu cuenta' }).waitFor();
  assert.doesNotMatch(await hoja.innerText(), /no se te cobró nada/i);
  assert.deepEqual(errores.filter(e => !/401/.test(e)), []);
  await ctx.close();
});

test('si el servidor lo apagó entre tanto, lo dice en la hoja', async () => {
  const { ctx, pg, errores } = await preparar('Computadora', { crear: { ok: false, error: 'apagado' } });
  await activar(pg);
  await abrirPago(pg);
  const hoja = pg.locator('.sheet');
  await hoja.getByRole('button', { name: 'Pagar con Mercado Pago' }).click();
  await hoja.getByRole('status').getByText('El pago con Mercado Pago no está disponible por ahora. Inténtalo más tarde.').waitFor();
  assert.equal(await hoja.getByRole('button', { name: 'Pagar con Mercado Pago' }).getAttribute('aria-disabled'), null);
  assert.deepEqual(errores.filter(e => !/409/.test(e)), []);
  await ctx.close();
});

test('un mensual real pagado con tarjeta no ofrece reactivar la renovación', async () => {
  const { ctx, pg, errores } = await preparar('iPhone', { sub: { plan: 'pro', periodo: 'mes', medio: 'tarjeta', desde: dia(0), hasta: dia(30), renovacion_automatica: false, demo: false } });
  await pestana(pg, 'Perfil');
  const plan = pg.locator('.card', { hasText: 'Tu plan' });
  await plan.getByText(/Tarjeta de débito o crédito · pago único/).waitFor();
  assert.equal(await plan.getByRole('button', { name: 'Reactivar renovación' }).count(), 0);
  await plan.getByRole('button', { name: 'Renovar ahora' }).waitFor();
  assert.deepEqual(errores, []);
  await ctx.close();
});
