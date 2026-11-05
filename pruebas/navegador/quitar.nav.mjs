// Quitar desde el chat de Lía (iteración 3, docs/iteracion-3.md §4): «borra la reunión de mañana» y «elimina el trabajo
// del miércoles» → «Toda la rutina». Lía muestra lo que va a quitar con «Quitar» y «Mantener»; al quitar, guarda con un
// solo Deshacer. Con el reloj en el lunes 9 de noviembre de 2026 a las 8:00, en un iPhone, un Android y una computadora.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar, pestana, anchoDeMas, DISPOSITIVOS } from './ayuda.mjs';

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });

const reunion = { id: 'x1', date: '2026-11-10', start: '13:00', end: '14:00', label: 'Reunión', cat: 'otro' };
const guardado = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')));
const ultimo = pg => pg.evaluate(() => [...document.querySelectorAll('#chat .msg')].at(-1).innerText.replace(/\n/g, ' | '));
async function escribir(pg, frase) { await pg.fill('#chat-in', frase); await pg.keyboard.press('Enter'); await pg.waitForTimeout(400); }

for (const disp of Object.keys(DISPOSITIVOS)) {
  test(`${disp}: el chat quita un evento y una rutina, con «Mantener», «Quitar» y Deshacer`, async () => {
    const { ctx, pg, errores } = await abrir(nav, 'about:blank', disp);
    await pg.clock.install({ time: new Date('2026-11-09T08:00:00-05:00') });
    await pg.goto(srv.url);
    await registrar(pg, { rutinas: ['trabajo de lunes a viernes de 9 a 6'], evals: ['examen de cálculo el viernes a las 7 de la noche'] });
    await pg.evaluate(x => { state.exceptions.push(x); save(); render(); }, reunion);
    await pestana(pg, 'Lía');

    // Un evento de un día: Lía dice qué quita y espera.
    await escribir(pg, 'borra la reunión de mañana');
    const tarjeta = pg.locator('#chat .msg').last();
    await tarjeta.getByText('Quito «Reunión» de mañana a la 1:00 p. m.').waitFor();
    assert.match(await tarjeta.innerText(), /Mar 10 nov · 13:00 – 14:00/);
    assert.equal(await anchoDeMas(pg), false, 'la tarjeta no se sale de la pantalla');
    assert.ok((await guardado(pg)).exceptions.some(x => x.id === 'x1'), 'sin confirmar no se quita nada');
    // «Mantener» no quita nada.
    await tarjeta.getByRole('button', { name: 'Mantener' }).click();
    await pg.getByText('Ok, «Reunión» sigue en tu horario.').waitFor();
    assert.ok((await guardado(pg)).exceptions.some(x => x.id === 'x1'));
    // «Quitar» la quita, con Deshacer.
    await escribir(pg, 'borra la reunión de mañana');
    await pg.locator('#chat .msg').last().getByRole('button', { name: 'Quitar' }).click();
    await pg.getByText(/^Listo, quité «Reunión» del mar 10 nov\./).waitFor();
    assert.ok(!(await guardado(pg)).exceptions.some(x => x.id === 'x1'), 'se quitó');
    await pg.locator('#chat .msg').last().getByRole('button', { name: 'Deshacer' }).click();
    await pg.getByText('Listo, lo dejé como estaba.').waitFor();
    assert.ok((await guardado(pg)).exceptions.some(x => x.id === 'x1'), 'Deshacer la devuelve');

    // Una rutina: Lía pregunta si solo ese día o toda; «Toda la rutina» muestra qué se quita.
    await escribir(pg, 'elimina el trabajo del miércoles a las 9');
    assert.match(await ultimo(pg), /«Trabajo» es una rutina de lunes a viernes, de 09:00 a 18:00\. ¿La quito solo el miércoles o toda la rutina\?/);
    await pg.getByRole('button', { name: 'Toda la rutina' }).click();
    await pg.waitForTimeout(300);
    const tr = pg.locator('#chat .msg').last();
    await tr.getByText('Quito la rutina «Trabajo» completa.').waitFor();
    assert.match(await tr.innerText(), /Lun a Vie · 09:00 – 18:00/);
    assert.ok((await guardado(pg)).commitments.some(c => c.name === 'Trabajo'), 'sin confirmar sigue');
    await tr.getByRole('button', { name: 'Quitar' }).click();
    await pg.getByText(/^Listo, quité la rutina «Trabajo»/).waitFor();
    let s = await guardado(pg);
    assert.ok(!s.commitments.some(c => c.name === 'Trabajo'), 'se quitó la rutina');
    assert.ok(s.exceptions.some(x => x.id === 'x1'), 'lo demás sigue');
    await pg.locator('#chat .msg').last().getByRole('button', { name: 'Deshacer' }).click();
    await pg.getByText('Listo, lo dejé como estaba.').waitFor();
    s = await guardado(pg);
    assert.ok(s.commitments.some(c => c.name === 'Trabajo'), 'Deshacer devuelve la rutina');
    // Ya no se ve la ayuda: Lía entendió.
    assert.doesNotMatch(await pg.locator('#chat').innerText(), /Todavía entiendo frases simples/);
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}

// En LIA Pro el plan se rearma solo: Lía dice qué hizo con el tiempo libre (sin cuenta real: se simula isPro()).
test('Android, LIA Pro: al quitar un evento, Lía reorganiza el estudio', async () => {
  const { ctx, pg, errores } = await abrir(nav, 'about:blank', 'Android');
  await pg.clock.install({ time: new Date('2026-11-09T08:00:00-05:00') });
  await pg.goto(srv.url);
  await registrar(pg, { rutinas: ['trabajo de lunes a viernes de 9 a 6'], evals: ['examen de cálculo el viernes a las 7 de la noche'] });
  await pg.evaluate(x => { window.isPro = () => true; state.exceptions.push({ ...x, start: '18:00', end: '23:00' }); save(); render(); }, reunion);
  await pestana(pg, 'Lía');
  await escribir(pg, 'cancela la reunión de mañana');
  await pg.locator('#chat .msg').last().getByRole('button', { name: 'Quitar' }).click();
  await pg.getByText(/^Listo, quité «Reunión» del mar 10 nov(\. Usé ese tiempo para estudiar Cálculo\.| y reorganicé tu estudio\.)/).waitFor();
  assert.ok(!(await guardado(pg)).exceptions.some(x => x.id === 'x1'));
  assert.deepEqual(errores, []);
  await ctx.close();
});
