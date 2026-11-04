// Preventa con Yape o Plin (docs/preventa.md): con el número configurado (ya viene en PREVENTA), el checkout dice cuánto
// enviar y a qué número, y abre WhatsApp con el mensaje escrito; el pago de prueba queda solo en modo pruebas.
// Sin número, todo sigue como antes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar } from './ayuda.mjs';

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });

const dia = dias => new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10);
const pro = (hasta, extra = {}) => ({ plan: 'pro', periodo: 'ciclo', medio: 'yape', desde: dia(0), hasta, renovacion_automatica: false, demo: false, ...extra });

async function preparar(dispositivo, { pruebas = false, sub = null, simular = null } = {}) {
  const { ctx, pg, errores } = await abrir(nav, srv.url + (pruebas ? '?pruebas=1' : ''), dispositivo);
  let fila = sub;
  await ctx.route('**/rest/v1/rpc/mi_suscripcion', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fila || { plan: 'gratis' }) }));
  if (simular) await ctx.route('**/rest/v1/rpc/simular_pago', r => r.fulfill(simular));
  // La sesión que supabase-js guarda (sin ella, la app cierra la cuenta al abrir el cliente).
  const sesion = () => localStorage.setItem('lia.auth', JSON.stringify({ access_token: 'sesion-de-prueba', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: { id: 'u1', email: 'ana@correo.pe', aud: 'authenticated', role: 'authenticated' } }));
  await ctx.addInitScript(sesion);
  await registrar(pg);
  await pg.evaluate(sesion);
  await pg.evaluate(() => { state.cuenta = { id: 'u1', email: 'ana@correo.pe' }; save(); });
  if (sub) await pg.evaluate(() => refrescarPlan(false));
  return { ctx, pg, errores, activar: f => { fila = f; } };
}
const configurar = (pg, titular = '') => pg.evaluate(t => Object.assign(PREVENTA, { numero: '987654321', titular: t, whatsapp: '51987654321' }), titular);
const vaciar = pg => pg.evaluate(() => Object.assign(PREVENTA, { numero: '', titular: '', whatsapp: '' }));
const abrirPago = async pg => { await pg.evaluate(() => openPaywall('plans')); await pg.locator('.sheet').getByRole('button', { name: 'Continuar' }).click(); };
const revisar = hoja => hoja.getByRole('button', { name: 'Ya me activaron: revisar mi plan' }).click();

for (const dispositivo of ['iPhone', 'Computadora']) {
  test(`${dispositivo}: con el número configurado, el checkout es la preventa con Yape o Plin y abre WhatsApp con el mensaje`, async () => {
    const { ctx, pg, errores, activar } = await preparar(dispositivo);
    await configurar(pg);
    await abrirPago(pg);
    const hoja = pg.locator('.sheet');
    await hoja.getByRole('heading', { name: 'Pagar LIA Pro' }).waitFor();
    const texto = await hoja.innerText();
    assert.match(texto, /Preventa · Por ciclo · S\/ 34\.90/i);
    assert.match(texto, /Tienes Pro por 4 meses desde que lo activemos\./);
    assert.match(texto, /Envía S\/ 34\.90 por Yape o Plin al 987 654 321\./);
    assert.match(texto, /Si pagas con Yape, elige «Plin» como destino\. Antes de confirmar, revisa que el número sea 987 654 321\./);
    assert.equal(await hoja.getByRole('button', { name: 'Simular pago aprobado' }).count(), 0, 'sin pago gratis');
    const wa = hoja.getByRole('link', { name: 'Enviar por WhatsApp (se abre en una pestaña nueva)' });
    const href = await wa.getAttribute('href');
    assert.ok(href.startsWith('https://wa.me/51987654321?text='));
    assert.match(decodeURIComponent(href.split('text=')[1]), /quiero LIA Pro por ciclo \(S\/ 34\.90\)\. Ya pagué\. Mi correo en LIA es ana@correo\.pe\. Número de operación: $/);
    // Todavía no activado: el aviso queda dentro de la hoja (role="status"), y después sí.
    await revisar(hoja);
    await hoja.getByRole('status').getByText('Tu Pro aún no está activo. Si ya nos enviaste el número de operación, lo activamos en menos de 24 horas.').waitFor();
    assert.equal(await hoja.getByRole('button', { name: 'Ya me activaron: revisar mi plan' }).getAttribute('aria-disabled'), null, 'el botón vuelve a estar disponible');
    activar(pro(dia(120)));
    await revisar(hoja);
    await pg.getByText(/^Listo: tienes LIA Pro hasta el /).waitFor();
    assert.equal(await pg.evaluate(() => isPro()), true);
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}

test('quien ya es Pro y renueva no ve «Listo» hasta que su Pro se alarga', async () => {
  const hasta = dia(10);
  const { ctx, pg, errores, activar } = await preparar('iPhone', { sub: pro(hasta) });
  await configurar(pg);
  await pg.evaluate(() => { ui.pay = { why: 'plans', ctx: null, period: 'mes', method: 'yape' }; ui.sheet = sheetPreventa(); render(); });
  const hoja = pg.locator('.sheet');
  assert.match(await hoja.innerText(), /Se suma 1 mes al final de tu Pro actual \(hasta el /);
  await revisar(hoja);
  await hoja.getByRole('status').getByText(/^Todavía no vemos tu nuevo pago\./).waitFor();
  assert.equal(await pg.locator('.sheet').count(), 1, 'la hoja sigue abierta');
  activar(pro(dia(40), { periodo: 'mes' }));
  await revisar(hoja);
  await pg.getByText(/^Listo: tienes LIA Pro hasta el /).waitFor();
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('«Copiar número» copia el número para pagar', async () => {
  const { ctx, pg, errores } = await preparar('Computadora');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.url });
  await configurar(pg);
  await abrirPago(pg);
  await pg.locator('.sheet').getByRole('button', { name: 'Copiar número' }).click();
  await pg.getByText('Número copiado.').waitFor();
  assert.equal(await pg.evaluate(() => navigator.clipboard.readText()), '987654321');
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('en modo pruebas, si el servidor cerró el pago de prueba a esta cuenta, «Intentar de nuevo» lleva a la preventa', async () => {
  const { ctx, pg, errores } = await preparar('iPhone', { pruebas: true,
    simular: { status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'pago_de_prueba_cerrado', details: null, hint: null }) } });
  await configurar(pg);
  await abrirPago(pg);
  const hoja = pg.locator('.sheet');
  await hoja.getByRole('button', { name: 'Simular pago aprobado' }).click();
  await hoja.getByText(/Ese pago de prueba ya no está disponible\. Ahora LIA Pro se paga con Yape/).waitFor();
  await hoja.getByRole('button', { name: 'Intentar de nuevo' }).click();
  await hoja.getByRole('heading', { name: 'Pagar LIA Pro' }).waitFor();
  assert.equal(await hoja.getByRole('link', { name: /Enviar por WhatsApp/ }).count(), 1);
  assert.deepEqual(errores.filter(e => !/403/.test(e)), []);
  await ctx.close();
});

test('con el nombre del titular, avisa qué nombre mostrará la app al pagar', async () => {
  const { ctx, pg, errores } = await preparar('Android');
  await configurar(pg, 'Coco Pérez');
  await abrirPago(pg);
  await pg.locator('.sheet').getByText(/Si pagas con Yape, elige «Plin» como destino\. Antes de confirmar, tu app te mostrará el nombre Coco Pérez\. Si no coincide, no envíes el pago\./).waitFor();
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('el número de Coconut ya viene configurado', async () => {
  const { ctx, pg, errores } = await preparar('Computadora');
  await abrirPago(pg);
  const texto = await pg.locator('.sheet').innerText();
  assert.match(texto, /Envía S\/ 34\.90 por Yape o Plin al 956 387 807\./);
  assert.ok((await pg.locator('.sheet').getByRole('link', { name: /Enviar por WhatsApp/ }).getAttribute('href')).startsWith('https://wa.me/51956387807?text='));
  assert.deepEqual(errores, []);
  await ctx.close();
});

test('sin el número configurado, o en modo pruebas, sigue el checkout de prueba', async () => {
  let { ctx, pg, errores } = await preparar('iPhone');
  await vaciar(pg);
  await abrirPago(pg);
  await pg.locator('.sheet').getByRole('button', { name: 'Simular pago aprobado' }).waitFor();
  assert.deepEqual(errores, []);
  await ctx.close();
  ({ ctx, pg, errores } = await preparar('iPhone', { pruebas: true }));
  await configurar(pg);
  await abrirPago(pg);
  await pg.locator('.sheet').getByRole('button', { name: 'Simular pago aprobado' }).waitFor();
  assert.deepEqual(errores, []);
  await ctx.close();
});
