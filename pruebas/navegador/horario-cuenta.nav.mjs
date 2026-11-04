// Tu horario en tu cuenta (docs/horario-en-cuenta.md), con una cuenta Pro en un iPhone y en una computadora.
// Supabase se simula: el plan, el inicio de sesión y las funciones mi_horario, guardar_horario y borrar_horario.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar, pestana, decir, anchoDeMas } from './ayuda.mjs';

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });

const USUARIO = { id: 'u1', email: 'ana@correo.pe', aud: 'authenticated', role: 'authenticated' };
const SESION = { access_token: 'sesion-de-prueba', token_type: 'bearer', expires_in: 3600, refresh_token: 'r', user: USUARIO };
const PLAN = { user_id: 'u1', plan: 'pro', periodo: 'mes', medio: 'yape', desde: '2026-11-01', hasta: '2099-01-01', renovacion_automatica: false, demo: true };

// La cuenta en «el servidor»: la comparten los dos dispositivos.
const nube = { rev: 0, datos: null, actualizado: null, guardados: [], sinRed: false };
async function conectar(ctx) {
  const json = (r, d) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
  await ctx.route('**/auth/v1/token**', r => json(r, { ...SESION, expires_at: Math.floor(Date.now() / 1000) + 3600 }));
  await ctx.route('**/rest/v1/rpc/**', r => {
    const fn = r.request().url().split('/rpc/')[1].split('?')[0], b = r.request().postDataJSON() || {};
    if (fn === 'mi_suscripcion') return json(r, PLAN);
    if (fn === 'mi_horario') return nube.sinRed ? r.abort() : json(r, nube.rev ? { pro: true, rev: nube.rev, datos: nube.datos, actualizado: nube.actualizado } : { pro: true, rev: 0 });
    if (fn === 'guardar_horario') {
      if (nube.sinRed) return r.abort();
      if (b.p_rev !== nube.rev) return json(r, { ok: false, motivo: 'conflicto', rev: nube.rev });
      nube.guardados.push(b.p_datos); Object.assign(nube, { rev: nube.rev + 1, datos: b.p_datos, actualizado: '2026-11-04T03:10:00Z' });
      return json(r, { ok: true, rev: nube.rev, actualizado: nube.actualizado });
    }
    if (fn === 'borrar_horario') { Object.assign(nube, { rev: 0, datos: null }); return json(r, null); }
    return json(r, null);
  });
}
const guardado = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1') || 'null'));
const meta = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('lia.horario') || 'null'));
// Lía muestra lo que entendió y se confirma.
async function anotar(pg, frase) { await decir(pg, frase); await pg.locator('.msg').last().getByRole('button', { name: 'Confirmar' }).click(); await pg.waitForTimeout(300); }
const esperar = async (fn, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };

test('se guarda desde el iPhone, se trae en la computadora y, si cambian los dos, Lía pregunta', async () => {
  // iPhone: se registra con su horario y ya tiene sesión Pro.
  const a = await abrir(nav, srv.url, 'iPhone');
  await conectar(a.ctx);
  await registrar(a.pg);
  await a.pg.evaluate(s => { localStorage.setItem('lia.auth', JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) + 3600 })); state.cuenta = { id: 'u1', email: 'ana@correo.pe' }; save(); }, SESION);
  await a.pg.reload();
  assert.ok(await esperar(() => nube.rev === 1), 'sube el horario la primera vez');
  assert.ok(!/chat|gcal|cuenta|ana@correo/.test(JSON.stringify(nube.datos)), 'sin chat ni cuenta');
  assert.equal(nube.datos.commitments.length, 2);
  assert.equal((await meta(a.pg)).rev, 1);

  // Un cambio en el iPhone se sube solo.
  await pestana(a.pg, 'Lía');
  await anotar(a.pg, 'examen de física el viernes a las 9');
  assert.ok(await esperar(() => nube.rev === 2), 'sube el cambio');
  assert.deepEqual(nube.datos.evals.map(e => e.course).sort(), ['Cálculo', 'Física']);

  // Computadora nueva: «Ya tengo cuenta» en la bienvenida y trae el horario.
  const b = await abrir(nav, srv.url, 'Computadora');
  await conectar(b.ctx);
  await b.pg.getByRole('button', { name: 'Ya tengo cuenta' }).click();
  await b.pg.fill('#cu-email', 'ana@correo.pe'); await b.pg.fill('#cu-pass', 'clave-de-prueba');
  await b.pg.locator('.sheet button[type=submit]').click();
  await b.pg.getByText('Listo: traje tu horario de tu cuenta.').waitFor({ timeout: 10000 });
  let s = await guardado(b.pg);
  assert.equal(s.onboarded, true, 'se salta la bienvenida');
  assert.deepEqual(s.evals.map(e => e.course).sort(), ['Cálculo', 'Física']);
  assert.equal(await b.pg.locator('.welcome').count(), 0);
  assert.equal(nube.rev, 2, 'traer no vuelve a subir');

  // Los dos cambian sin conexión: la computadora no puede subir y el iPhone sube primero.
  nube.sinRed = true;
  await pestana(b.pg, 'Lía');
  await anotar(b.pg, 'examen de química el jueves a las 7');
  await b.pg.waitForTimeout(2600);
  nube.sinRed = false;
  await anotar(a.pg, 'entrega de arte el miércoles a las 11');
  assert.ok(await esperar(() => nube.rev === 3), 'el iPhone sube su cambio');
  // La computadora vuelve a tener internet.
  await b.pg.evaluate(() => window.dispatchEvent(new Event('online')));
  const hoja = b.pg.locator('.sheet');
  await hoja.getByRole('heading', { name: 'Cambiaste tu horario en dos lugares' }).waitFor({ timeout: 10000 });
  assert.match(await hoja.innerText(), /Química/);
  assert.match(await hoja.innerText(), /Arte/);
  assert.ok(!(await anchoDeMas(b.pg)), 'sin desborde');
  await hoja.getByRole('button', { name: 'Usar el de mi cuenta' }).click();
  s = await guardado(b.pg);
  assert.deepEqual(s.evals.map(e => e.course).sort(), ['Arte', 'Cálculo', 'Física'], 'quedó el de la cuenta');
  assert.equal((await meta(b.pg)).rev, 3);
  await b.pg.waitForTimeout(2600);
  assert.equal(nube.rev, 3, 'elegir la cuenta no sube nada');

  // Cerrar sesión en la computadora y borrar el horario de ahí; en la cuenta sigue.
  await pestana(b.pg, 'Perfil');
  assert.match(await b.pg.locator('.card', { hasText: 'Tu cuenta' }).innerText(), /guardado en tu cuenta/);
  await b.pg.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await b.pg.locator('.sheet').getByRole('button', { name: 'Cerrar sesión y borrarlo de aquí' }).click();
  await b.pg.getByText('Cerraste sesión y borré tu horario de este dispositivo.').waitFor();
  s = await guardado(b.pg);
  assert.ok(!s || (!s.evals.length && !s.commitments.length), 'no queda horario en la computadora');
  assert.equal(await meta(b.pg), null);
  assert.equal(await b.pg.locator('.welcome').count(), 1, 'vuelve a la bienvenida');
  assert.equal(nube.rev, 3, 'la cuenta conserva el horario');

  for (const x of [a, b]) { assert.deepEqual(x.errores, []); await x.ctx.close(); }
});
