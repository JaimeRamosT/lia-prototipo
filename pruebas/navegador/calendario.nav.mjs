// Google Calendar → LIA (docs/calendario.md) en un iPhone simulado y en una computadora: pegar la dirección secreta,
// elegir qué entra, traer cambios y un error claro. lia-calendario y la sesión se simulan (sin internet).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servir, lanzar, abrir, registrar, pestana, anchoDeMas } from './ayuda.mjs';

const GOOGLE = 'https://calendar.google.com/calendar/ical/ana%40gmail.com/private-0123456789abcdef/basic.ics';
const pad = n => String(n).padStart(2, '0');
const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
const lunesPasado = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
const cal = (...extra) => ['BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:calculo@google.com', `DTSTART;TZID=America/Lima:${lunesPasado()}T080000`, `DTEND;TZID=America/Lima:${lunesPasado()}T100000`, 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH', 'SUMMARY:Cálculo II', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:trabajo@google.com', `DTSTART;TZID=America/Lima:${lunesPasado()}T150000`, `DTEND;TZID=America/Lima:${lunesPasado()}T190000`, 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'SUMMARY:Trabajo', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:fisica@google.com', `DTSTART;TZID=America/Lima:${dia(5)}T090000`, `DTEND;TZID=America/Lima:${dia(5)}T110000`, 'SUMMARY:Parcial de Física', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:dentista@google.com', `DTSTART;TZID=America/Lima:${dia(2)}T160000`, `DTEND;TZID=America/Lima:${dia(2)}T170000`, 'SUMMARY:Cita con el dentista', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:cumple@google.com', `DTSTART;VALUE=DATE:${dia(3)}`, `DTEND;VALUE=DATE:${dia(4)}`, 'SUMMARY:Cumpleaños de Ana', 'END:VEVENT',
  ...extra, 'END:VCALENDAR', ''].join('\r\n');

let srv, nav;
before(async () => { srv = await servir(); nav = await lanzar(); });
after(async () => { await nav?.close(); await srv?.cerrar(); });

async function preparar(dispositivo) {
  const { ctx, pg, errores } = await abrir(nav, srv.url, dispositivo);
  const pedidos = [];
  let ics = cal();
  await ctx.route('**/functions/v1/lia-calendario', async r => {
    const cuerpo = r.request().postDataJSON();
    pedidos.push({ cuerpo, auth: r.request().headers().authorization });
    if (cuerpo.url !== GOOGLE) return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'no_permitida' }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ics }) });
  });
  await registrar(pg);
  await pg.evaluate(() => { state.cuenta = { id: 'u1', email: 'ana@correo.pe' }; ui.canales = {}; save(); tokenSesion = async () => 'sesion-de-prueba'; });
  await pestana(pg, 'Perfil');
  return { ctx, pg, errores, pedidos, cambiar: t => { ics = t; } };
}
const guardado = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('lia.app.v1')));

for (const dispositivo of ['iPhone', 'Computadora']) {
  test(`${dispositivo}: trae el Google Calendar, deja elegir y no duplica lo que ya está`, async () => {
    const { ctx, pg, errores, pedidos, cambiar } = await preparar(dispositivo);
    await pg.getByRole('button', { name: 'Traer mi Google Calendar' }).click();
    await pg.fill('#gcal-url', GOOGLE);
    await pg.getByRole('button', { name: 'Traer mis eventos' }).click();
    const hoja = pg.locator('.sheet');
    await hoja.getByRole('button', { name: 'Agregar a LIA' }).waitFor();
    assert.equal(pedidos[0].auth, 'Bearer sesion-de-prueba');
    const texto = await hoja.innerText();
    assert.match(texto, /Cálculo II/);
    assert.match(texto, /Parcial de Física/);
    assert.match(texto, /Cita con el dentista/);
    assert.match(texto, /1 de todo el día/);
    assert.equal(await hoja.getByRole('checkbox', { name: /Trabajo.*Ya está en LIA/s }).isChecked(), false, 'el trabajo ya estaba');
    assert.equal(await anchoDeMas(pg), false, 'la hoja no se sale de la pantalla');
    await hoja.getByRole('checkbox', { name: /Cita con el dentista/ }).uncheck();
    await hoja.getByRole('button', { name: 'Agregar a LIA' }).click();
    await pg.getByText(/Agregué 2 de tu Google Calendar/).waitFor();
    let s = await guardado(pg);
    assert.equal(s.gcal.url, GOOGLE, 'la dirección se queda en este navegador');
    assert.deepEqual(s.commitments.filter(c => c.gcal).map(c => [c.name, c.days, c.start, c.end]), [['Cálculo II', [2, 4], '08:00', '10:00']]);
    assert.equal(s.commitments.filter(c => c.name === 'Trabajo').length, 1, 'sin duplicar el trabajo');
    assert.deepEqual(s.evals.filter(e => e.gcal).map(e => [e.type, e.course, e.time]), [['parcial', 'Física', '09:00']]);
    assert.ok(!s.exceptions.some(x => x.label === 'Cita con el dentista'));
    // Traer cambios: un evento nuevo en Google.
    cambiar(cal('BEGIN:VEVENT', 'UID:charla@google.com', `DTSTART;TZID=America/Lima:${dia(4)}T180000`, `DTEND;TZID=America/Lima:${dia(4)}T190000`, 'SUMMARY:Charla de empleabilidad', 'END:VEVENT'));
    await pg.getByRole('button', { name: 'Traer cambios ahora' }).click();
    await pg.getByText(/Traje 1 cambio de tu Google Calendar/).waitFor();
    s = await guardado(pg);
    assert.ok(s.exceptions.some(x => x.label === 'Charla de empleabilidad' && x.gcal));
    assert.ok(!s.exceptions.some(x => x.label === 'Cita con el dentista'), 'lo que no elegiste no vuelve');
    // Al cerrar sesión se olvida la dirección; lo traído se queda.
    await pg.evaluate(() => cerrarSesion());
    s = await guardado(pg);
    assert.equal(s.gcal.url, undefined);
    assert.ok(s.commitments.some(c => c.gcal));
    assert.deepEqual(errores, []);
    await ctx.close();
  });

  test(`${dispositivo}: una dirección que no es del calendario muestra qué hacer`, async () => {
    const { ctx, pg, errores } = await preparar(dispositivo);
    await pg.getByRole('button', { name: 'Traer mi Google Calendar' }).click();
    await pg.fill('#gcal-url', 'https://calendar.google.com/calendar/u/0/r');
    await pg.getByRole('button', { name: 'Traer mis eventos' }).click();
    await pg.getByRole('alert').waitFor();
    assert.match(await pg.getByRole('alert').innerText(), /Dirección secreta en formato iCal/);
    assert.equal(await pg.locator('#gcal-url').getAttribute('aria-invalid'), 'true');
    assert.equal((await guardado(pg)).gcal, undefined, 'no guarda nada');
    assert.deepEqual(errores, []);
    await ctx.close();
  });
}
