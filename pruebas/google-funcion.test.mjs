// lia-google (docs/google.md): «Conectar con Google» con OAuth y Google Calendar API, con Google y Supabase simulados.
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00 en Lima.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../supabase/functions/lia-google/logica.js';
import { L } from './logica.mjs';

const SB = 'https://p.supabase.co', FN = `${SB}/functions/v1/lia-google`, CAL = 'https://www.googleapis.com/calendar/v3';
const ORIGEN = 'https://lia-prototipo.jaime-ramos-93c.workers.dev';
const AHORA = new Date('2026-10-26T15:00:00Z');
const ENV = { SUPABASE_URL: SB, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'srv', GOOGLE_CLIENT_ID: 'cliente.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secreto-del-cliente' };

// Google y la base, en memoria.
function simular({ env = ENV, cuenta = null, primario = [], lia = [], calLiaExiste = true, refreshVencido = false, alcances = G.ALCANCES } = {}) {
  const db = { estados: {}, cuentas: cuenta ? { u1: { ...cuenta } } : {}, senal: {}, llamadas: [] };
  const g = { primario, lia: [...lia], calLiaExiste, creados: [], borrados: [], calendariosCreados: 0, calendariosBorrados: 0, watch: [], stop: [], revocados: [], tokens: [] };
  const logs = [];
  const rpc = {
    google_nuevo_estado: ({ p_user, p_origen }) => { const e = 'estado' + (Object.keys(db.estados).length + 1); db.estados[e] = { user_id: p_user, origen: p_origen }; return e; },
    google_tomar_estado: ({ p_estado }) => { const e = db.estados[p_estado]; delete db.estados[p_estado]; return e || null; },
    google_guardar: a => { const v = db.cuentas[a.p_user] || {}; db.cuentas[a.p_user] = { ...v, refresh: a.p_refresh || v.refresh, cal_lia: a.p_cal, canal_id: a.p_canal_id, canal_recurso: a.p_canal_recurso, canal_token: a.p_canal_token, canal_vence: a.p_canal_vence, estado: 'activa' }; return null; },
    google_cuenta: ({ p_user }) => db.cuentas[p_user] || null,
    google_por_canal: ({ p_canal }) => { const [id, c] = Object.entries(db.cuentas).find(([, c]) => c.canal_id === p_canal) || []; return id ? { user_id: id, canal_token: c.canal_token } : null; },
    google_avisar: ({ p_user }) => { db.senal[p_user] = (db.senal[p_user] || 0) + 1; return null; },
    google_vencida: ({ p_user }) => { if (db.cuentas[p_user]) db.cuentas[p_user].estado = 'vencida'; return null; },
    google_borrar: ({ p_user }) => { delete db.cuentas[p_user]; return null; },
    google_cal_lia: ({ p_user, p_cal }) => { db.cuentas[p_user].cal_lia = p_cal; return null; },
    google_canales_por_vencer: () => Object.keys(db.cuentas).filter(u => db.cuentas[u].estado === 'activa' && new Date(db.cuentas[u].canal_vence || 0) < new Date(AHORA.getTime() + 2 * 864e5)),
    google_actualizar_canal: a => { Object.assign(db.cuentas[a.p_user], { canal_id: a.p_canal_id, canal_recurso: a.p_canal_recurso, canal_token: a.p_canal_token, canal_vence: a.p_canal_vence }); return null; },
    avisos_cron_ok: ({ p_secreto }) => p_secreto === 'cron-bueno',
  };
  const json = (cuerpo, status = 200) => new Response(cuerpo == null ? null : JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
  const deps = {
    env: k => env[k], log: d => logs.push(d), ahora: () => AHORA, id: (() => { let n = 0; return () => 'id' + (++n); })(),
    fetch: async (url, op = {}) => {
      url = String(url); const metodo = op.method || 'GET', cuerpo = op.body ? (typeof op.body === 'string' ? op.body : op.body.toString()) : '';
      db.llamadas.push({ url, metodo });
      if (url === `${SB}/auth/v1/user`) return op.headers.Authorization === 'Bearer bueno' ? json({ id: 'u1', email: 'ana@gmail.com' }) : json({}, 401);
      if (url.startsWith(`${SB}/rest/v1/rpc/`)) {
        assert.equal(op.headers.apikey, 'srv', 'las funciones de la base se llaman con la clave del servidor');
        const fn = url.split('/').pop(); const r = rpc[fn](JSON.parse(cuerpo || '{}')); return json(r === undefined ? null : r);
      }
      if (url === 'https://oauth2.googleapis.com/token') {
        const p = new URLSearchParams(cuerpo); g.tokens.push(Object.fromEntries(p));
        if (p.get('grant_type') === 'authorization_code') return p.get('code') === 'c1' ? json({ access_token: 'at1', refresh_token: 'rt1', scope: alcances.join(' '), expires_in: 3599, token_type: 'Bearer' }) : json({ error: 'invalid_grant' }, 400);
        return refreshVencido ? json({ error: 'invalid_grant' }, 400) : json({ access_token: 'at2', expires_in: 3599 });
      }
      if (url.startsWith('https://oauth2.googleapis.com/revoke')) { g.revocados.push(new URLSearchParams(cuerpo).get('token')); return json({}); }
      assert.ok(url.startsWith(CAL), url);
      assert.match(op.headers.Authorization, /^Bearer at[12]$/);
      const ruta = url.slice(CAL.length).split('?')[0], q = new URL(url).searchParams;
      if (ruta === '/calendars' && metodo === 'POST') { g.calendariosCreados++; g.calLiaExiste = true; g.nuevoCal = JSON.parse(cuerpo); return json({ id: 'lia-nuevo@group.calendar.google.com' }); }
      if (ruta === '/calendars/primary/events/watch') { const b = JSON.parse(cuerpo); g.watch.push(b); return json({ id: b.id, resourceId: 'recurso-' + b.id, expiration: String(AHORA.getTime() + 7 * 864e5) }); }
      if (ruta === '/channels/stop') { g.stop.push(JSON.parse(cuerpo)); return new Response(null, { status: 204 }); }
      if (ruta === '/calendars/primary/events') {
        g.consulta = Object.fromEntries(q);
        const pag = q.get('pageToken') === 'p2' ? 1 : 0, partes = [primario.slice(0, Math.ceil(primario.length / 2)), primario.slice(Math.ceil(primario.length / 2))];
        return json({ items: partes[pag], ...(pag === 0 && partes[1].length ? { nextPageToken: 'p2' } : {}) });
      }
      const m = /^\/calendars\/([^/]+)(\/events(?:\/([^/]+))?)?$/.exec(ruta);
      if (m) {
        if (!g.calLiaExiste) return json({ error: { code: 404 } }, 404);
        if (!m[2] && metodo === 'DELETE') { g.calendariosBorrados++; return new Response(null, { status: 204 }); }
        if (!m[2]) return json({ id: decodeURIComponent(m[1]) });
        if (m[3] && metodo === 'DELETE') { g.borrados.push(m[3]); g.lia = g.lia.filter(e => e.id !== m[3]); return new Response(null, { status: 204 }); }
        if (metodo === 'POST') { const b = JSON.parse(cuerpo); g.creados.push(b); g.lia.push(b); return json(b); }
        g.consultaLia = Object.fromEntries(q);
        return json({ items: g.lia });
      }
      throw new Error('ruta no simulada: ' + metodo + ' ' + url);
    },
  };
  return { deps, db, g, logs };
}
const app = (cuerpo, { token = 'bueno', origen = ORIGEN } = {}) => new Request(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'anon', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origen ? { Origin: origen } : {}) }, body: JSON.stringify(cuerpo) });
const leerJson = async r => [r.status, await r.json()];
const CUENTA = { refresh: 'rt1', cal_lia: 'lia@group.calendar.google.com', canal_id: 'canal1', canal_recurso: 'recurso1', canal_token: 'secreto-canal', canal_vence: '2026-10-27T15:00:00Z', estado: 'activa' };  // vence mañana
const sinSecretos = s => { const t = JSON.stringify(s); for (const x of ['rt1', 'at1', 'at2', 'secreto-del-cliente', 'secreto-canal', 'ana@gmail.com', 'Cálculo', 'Parcial', '"c1"', 'bueno']) assert.ok(!t.includes(x), `el registro lleva ${x}`); };

test('iniciar: sin las claves de Google, lo dice; con ellas, la dirección de permiso con un estado de un solo uso', async () => {
  let s = simular({ env: { ...ENV, GOOGLE_CLIENT_ID: '' } });
  assert.deepEqual(await leerJson(await G.manejar(app({ accion: 'iniciar' }), s.deps)), [503, { ok: false, error: 'sin_configurar' }]);
  s = simular();
  const [st, r] = await leerJson(await G.manejar(app({ accion: 'iniciar' }), s.deps));
  assert.equal(st, 200);
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('client_id'), ENV.GOOGLE_CLIENT_ID);
  assert.equal(u.searchParams.get('redirect_uri'), FN);
  assert.deepEqual([u.searchParams.get('response_type'), u.searchParams.get('access_type'), u.searchParams.get('prompt')], ['code', 'offline', 'consent']);
  assert.deepEqual(u.searchParams.get('scope').split(' '), G.ALCANCES);
  assert.equal(u.searchParams.get('state'), 'estado1');
  assert.deepEqual(s.db.estados.estado1, { user_id: 'u1', origen: ORIGEN });
  sinSecretos(s.logs);
});

test('estado: configurado y conectado, sin datos de la cuenta', async () => {
  const s = simular({ cuenta: CUENTA });
  assert.deepEqual(await leerJson(await G.manejar(app({ accion: 'estado' }), s.deps)), [200, { ok: true, configurado: true, conectado: true, estado: 'activa' }]);
  const n = simular({ env: { ...ENV, GOOGLE_CLIENT_SECRET: '' } });
  assert.deepEqual((await leerJson(await G.manejar(app({ accion: 'estado' }), n.deps)))[1], { ok: true, configurado: false, conectado: false, estado: null });
});

test('regreso de Google: canjea el código, crea el calendario «LIA», pide avisos y vuelve a la app', async () => {
  const s = simular();
  await G.manejar(app({ accion: 'iniciar' }), s.deps);
  const r = await G.manejar(new Request(`${FN}?code=c1&state=estado1&scope=x`), s.deps);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('Location'), `${ORIGEN}/?google=ok`);
  assert.equal(s.g.tokens[0].redirect_uri, FN);
  assert.equal(s.g.tokens[0].client_secret, ENV.GOOGLE_CLIENT_SECRET);
  assert.deepEqual([s.g.nuevoCal.summary, s.g.nuevoCal.timeZone], ['LIA', 'America/Lima']);
  assert.equal(s.g.watch[0].address, FN);
  assert.equal(s.g.watch[0].type, 'web_hook');
  assert.ok(s.g.watch[0].token && s.g.watch[0].token.length >= 32, 'el aviso lleva un secreto largo');
  const c = s.db.cuentas.u1;
  assert.deepEqual([c.refresh, c.cal_lia, c.canal_recurso], ['rt1', 'lia-nuevo@group.calendar.google.com', 'recurso-' + s.g.watch[0].id]);
  assert.equal(s.db.estados.estado1, undefined, 'el estado se usa una sola vez');
  sinSecretos(s.logs);
});

test('regreso de Google: errores vuelven a la app sin guardar nada', async () => {
  const casos = [
    ['?code=c1&state=otro', 'error'],
    ['?error=access_denied&state=estado1', 'cancelado'],
    ['?code=malo&state=estado1', 'error'],
  ];
  for (const [q, motivo] of casos) {
    const s = simular();
    await G.manejar(app({ accion: 'iniciar' }), s.deps);
    const r = await G.manejar(new Request(FN + q), s.deps);
    assert.equal(r.headers.get('Location'), `${ORIGEN}/?google=${motivo}`, q);
    assert.deepEqual(s.db.cuentas, {}, q);
  }
  // Sin el permiso de leer los eventos, no sirve.
  const s = simular({ alcances: [G.ALCANCES[0]] });
  await G.manejar(app({ accion: 'iniciar' }), s.deps);
  assert.equal((await G.manejar(new Request(`${FN}?code=c1&state=estado1`), s.deps)).headers.get('Location'), `${ORIGEN}/?google=permisos`);
  assert.deepEqual(s.db.cuentas, {});
  // Solo se vuelve a direcciones de LIA; una vista previa también vale.
  const p = simular(), previa = 'https://feat-x-lia-prototipo.jaime-ramos-93c.workers.dev';
  await G.manejar(app({ accion: 'iniciar' }, { origen: previa }), p.deps);
  assert.equal((await G.manejar(new Request(`${FN}?code=c1&state=estado1`), p.deps)).headers.get('Location'), `${previa}/?google=ok`);
  const o = simular();
  assert.equal((await leerJson(await G.manejar(app({ accion: 'iniciar' }, { origen: 'https://otra.pe' }), o.deps)))[0], 403);
});

test('aviso de Google: con el secreto del canal suma una señal; sin él, nada', async () => {
  const s = simular({ cuenta: CUENTA });
  const aviso = (estado, token = 'secreto-canal', canal = 'canal1') => new Request(FN, { method: 'POST', headers: { 'X-Goog-Channel-ID': canal, 'X-Goog-Channel-Token': token, 'X-Goog-Resource-State': estado, 'X-Goog-Resource-ID': 'recurso1' } });
  assert.equal((await G.manejar(aviso('sync'), s.deps)).status, 200);
  assert.equal(s.db.senal.u1, undefined, 'el primer aviso solo confirma el canal');
  assert.equal((await G.manejar(aviso('exists'), s.deps)).status, 200);
  assert.equal(s.db.senal.u1, 1);
  assert.equal((await G.manejar(aviso('exists', 'otro'), s.deps)).status, 403);
  assert.equal((await G.manejar(aviso('exists', 'secreto-canal', 'desconocido'), s.deps)).status, 404);
  assert.equal(s.db.senal.u1, 1);
  assert.ok(!s.db.llamadas.some(l => l.url.startsWith(CAL)), 'no lee eventos al recibir el aviso');
  sinSecretos(s.logs);
});

// Eventos como los devuelve la API (singleEvents=false): una serie con excepción y una instancia cancelada.
const API = [
  { id: 'calc', iCalUID: 'calc@google.com', status: 'confirmed', summary: 'Cálculo II', start: { dateTime: '2026-08-24T08:00:00-05:00', timeZone: 'America/Lima' }, end: { dateTime: '2026-08-24T10:00:00-05:00', timeZone: 'America/Lima' },
    recurrence: ['RRULE:FREQ=WEEKLY;UNTIL=20261212T045959Z;BYDAY=MO,WE', 'EXDATE;TZID=America/Lima:20261102T080000'] },
  { id: 'calc_20261028T130000Z', iCalUID: 'calc@google.com', recurringEventId: 'calc', status: 'confirmed', summary: 'Cálculo II (recuperación)', originalStartTime: { dateTime: '2026-10-28T08:00:00-05:00' },
    start: { dateTime: '2026-10-29T10:00:00-05:00' }, end: { dateTime: '2026-10-29T12:00:00-05:00' } },
  { id: 'calc_20261104T130000Z', iCalUID: 'calc@google.com', recurringEventId: 'calc', status: 'cancelled', originalStartTime: { dateTime: '2026-11-04T08:00:00-05:00' } },
  { id: 'fis', iCalUID: 'fis@google.com', status: 'confirmed', summary: 'Parcial de Física; aula 3', start: { dateTime: '2026-11-05T14:00:00Z' }, end: { dateTime: '2026-11-05T16:00:00Z' } },
  { id: 'cumple', iCalUID: 'cumple@google.com', status: 'confirmed', summary: 'Cumpleaños', start: { date: '2026-11-03' }, end: { date: '2026-11-04' } },
  { id: 'luz', iCalUID: 'luz@google.com', status: 'confirmed', summary: 'Pagar luz', transparency: 'transparent', start: { dateTime: '2026-10-27T12:00:00-05:00' }, end: { dateTime: '2026-10-27T12:15:00-05:00' } },
  { id: 'no', iCalUID: 'no@google.com', status: 'confirmed', summary: 'Reunión que rechacé', attendees: [{ email: 'ana@gmail.com', self: true, responseStatus: 'declined' }], start: { dateTime: '2026-10-28T18:00:00-05:00' }, end: { dateTime: '2026-10-28T19:00:00-05:00' } },
  { id: 'casa', iCalUID: 'casa@google.com', status: 'confirmed', eventType: 'workingLocation', summary: 'Casa', start: { date: '2026-10-27' }, end: { date: '2026-10-28' } },
];

test('icsDeEventos: lo de la API se lee con la misma lógica de la app (rutinas, libres, movidas y canceladas)', () => {
  const c = L.deCalendario(L.leerIcs(G.icsDeEventos(API)), '2026-10-26');
  assert.deepEqual(c.rutinas, [{ gcal: 'r:calc@google.com', name: 'Cálculo II', type: 'otro', days: [1, 3], start: '08:00', end: '10:00', hasta: '2026-12-11' }]);
  assert.deepEqual(c.libres.map(l => l.date).sort(), ['2026-10-28', '2026-11-02', '2026-11-04'], 'excluida, movida y cancelada');
  assert.deepEqual(c.eventos.map(e => [e.gcal, e.date, e.start, e.end, e.label]), [['e:calc@google.com:2026-10-28', '2026-10-29', '10:00', '12:00', 'Cálculo II (recuperación)']]);
  assert.deepEqual(c.evals.map(e => [e.type, e.course, e.date, e.time]), [['parcial', 'Física; aula 3', '2026-11-05', '09:00']]);
  assert.equal(c.omitidos.disponibles, 1);
  assert.equal(c.omitidos.todoElDia, 1, 'el cumpleaños; la ubicación de trabajo ni se cuenta');
});

test('icsDeEventos: una serie de las 20:00 en Lima (01:00 en UTC) no se corre de día', () => {
  const c = L.deCalendario(L.leerIcs(G.icsDeEventos([{ id: 'noche', iCalUID: 'noche@google.com', status: 'confirmed', summary: 'Inglés',
    start: { dateTime: '2026-10-19T20:00:00-05:00', timeZone: 'America/Lima' }, end: { dateTime: '2026-10-19T22:00:00-05:00', timeZone: 'America/Lima' },
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'] }])), '2026-10-26');
  assert.deepEqual([c.rutinas[0].days, c.rutinas[0].start, c.rutinas[0].end], [[1], '20:00', '22:00']);
});

test('leer: pide el calendario principal desde ayer, todas las páginas, y lo devuelve como iCal', async () => {
  const s = simular({ cuenta: CUENTA, primario: API });
  const [st, r] = await leerJson(await G.manejar(app({ accion: 'leer' }), s.deps));
  assert.equal(st, 200);
  assert.match(r.ics, /^BEGIN:VCALENDAR/);
  assert.equal((r.ics.match(/BEGIN:VEVENT/g) || []).length, 6, 'sin el rechazado ni la ubicación de trabajo');
  assert.equal(s.g.consulta.singleEvents, 'false');
  assert.equal(s.g.consulta.timeMin, '2026-10-25T05:00:00.000Z');
  assert.equal(s.g.tokens[0].grant_type, 'refresh_token');
  sinSecretos(s.logs);
});

test('leer: un permiso vencido o quitado en Google se marca y se pide volver a conectar', async () => {
  const s = simular({ cuenta: CUENTA, refreshVencido: true });
  assert.deepEqual(await leerJson(await G.manejar(app({ accion: 'leer' }), s.deps)), [401, { ok: false, error: 'vencida' }]);
  assert.equal(s.db.cuentas.u1.estado, 'vencida');
  const n = simular();
  assert.deepEqual((await leerJson(await G.manejar(app({ accion: 'leer' }), n.deps)))[1], { ok: false, error: 'no_conectado' });
  const x = simular({ cuenta: CUENTA });
  assert.equal((await leerJson(await G.manejar(app({ accion: 'leer' }, { token: 'malo' }), x.deps)))[0], 401);
});

const evLia = (inicio, fin, titulo, tipo = 'estudio') => ({ inicio, fin, titulo, tipo });

test('escribir: el calendario «LIA» queda igual a lo de LIA, por diferencia y con ids estables', async () => {
  const quiero = [evLia('2026-10-27T19:00:00-05:00', '2026-10-27T21:00:00-05:00', 'Estudiar Cálculo II'), evLia('2026-11-05T09:00:00-05:00', '2026-11-05T10:00:00-05:00', 'Parcial de Física', 'evaluacion')];
  const ya = { id: G.idEvento(quiero[0]), summary: 'Estudiar Cálculo II', start: { dateTime: '2026-10-28T00:00:00Z' }, end: { dateTime: '2026-10-28T02:00:00Z' } };
  const sobra = { id: G.idEvento(evLia('2026-10-28T19:00:00-05:00', '2026-10-28T20:00:00-05:00', 'Estudiar Química')), summary: 'Estudiar Química', start: { dateTime: '2026-10-29T00:00:00Z' }, end: { dateTime: '2026-10-29T01:00:00Z' } };
  const s = simular({ cuenta: CUENTA, lia: [ya, sobra] });
  const [st, r] = await leerJson(await G.manejar(app({ accion: 'escribir', eventos: quiero }), s.deps));
  assert.deepEqual([st, r], [200, { ok: true, creados: 1, borrados: 1 }]);
  assert.deepEqual(s.g.borrados, [sobra.id]);
  const c = s.g.creados[0];
  assert.equal(c.id, G.idEvento(quiero[1]));
  assert.match(c.id, /^[a-v0-9]{5,1024}$/, 'formato de id de Google');
  assert.deepEqual([c.summary, c.start.dateTime, c.end.dateTime, c.start.timeZone], ['Parcial de Física', '2026-11-05T09:00:00-05:00', '2026-11-05T10:00:00-05:00', 'America/Lima']);
  assert.match(c.description, /Evaluación anotada en LIA/);
  assert.equal(s.g.consultaLia.timeMin, '2026-10-25T05:00:00.000Z', 'lo de antes de ayer no se toca');
  // Una segunda escritura igual no cambia nada.
  assert.deepEqual((await leerJson(await G.manejar(app({ accion: 'escribir', eventos: quiero }), s.deps)))[1], { ok: true, creados: 0, borrados: 0 });
  sinSecretos(s.logs);
});

test('escribir: si la persona borró el calendario «LIA», se vuelve a crear; los datos raros no pasan', async () => {
  const s = simular({ cuenta: CUENTA, calLiaExiste: false });
  const [st, r] = await leerJson(await G.manejar(app({ accion: 'escribir', eventos: [evLia('2026-10-27T19:00:00-05:00', '2026-10-27T21:00:00-05:00', 'Estudiar')] }), s.deps));
  assert.deepEqual([st, r.creados], [200, 1]);
  assert.equal(s.g.calendariosCreados, 1);
  assert.equal(s.db.cuentas.u1.cal_lia, 'lia-nuevo@group.calendar.google.com');
  for (const malo of [{ eventos: 'x' }, { eventos: Array(301).fill(evLia('2026-10-27T19:00:00-05:00', '2026-10-27T21:00:00-05:00', 'E')) }, { eventos: [{ inicio: 'ayer', fin: 'hoy', titulo: 'x' }] }])
    assert.deepEqual(await leerJson(await G.manejar(app({ accion: 'escribir', ...malo }), simular({ cuenta: CUENTA }).deps)), [400, { ok: false, error: 'pedido' }]);
});

test('desconectar: deja de avisar, revoca el permiso, borra el calendario «LIA» y la cuenta', async () => {
  const s = simular({ cuenta: CUENTA });
  assert.deepEqual(await leerJson(await G.manejar(app({ accion: 'desconectar' }), s.deps)), [200, { ok: true }]);
  assert.deepEqual(s.g.stop, [{ id: 'canal1', resourceId: 'recurso1' }]);
  assert.deepEqual(s.g.revocados, ['rt1']);
  assert.equal(s.g.calendariosBorrados, 1);
  assert.deepEqual(s.db.cuentas, {});
  sinSecretos(s.logs);
});

test('pg_cron: renueva los avisos que vencen pronto; sin el secreto, nada', async () => {
  const s = simular({ cuenta: CUENTA });
  const cron = secreto => new Request(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lia-cron': secreto }, body: '{"accion":"renovar"}' });
  assert.equal((await G.manejar(cron('malo'), s.deps)).status, 401);
  const [st, r] = await leerJson(await G.manejar(cron('cron-bueno'), s.deps));
  assert.deepEqual([st, r], [200, { ok: true, renovados: 1 }]);
  assert.deepEqual(s.g.stop, [{ id: 'canal1', resourceId: 'recurso1' }], 'el canal viejo se cierra');
  assert.notEqual(s.db.cuentas.u1.canal_id, 'canal1');
  assert.equal(s.db.cuentas.u1.canal_vence, new Date(AHORA.getTime() + 7 * 864e5).toISOString());
  sinSecretos(s.logs);
});

test('CORS para la app', async () => {
  const r = await G.manejar(new Request(FN, { method: 'OPTIONS', headers: { Origin: ORIGEN } }), simular().deps);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGEN);
});
