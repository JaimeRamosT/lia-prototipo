// LIA · lógica de la Edge Function lia-google: «Conectar con Google» (docs/google.md, ADR-005). Google Calendar al instante
// en los dos sentidos con OAuth y Google Calendar API, sin facturación en Google Cloud.
//   - POST de la app (con la sesión de la persona): {accion:'estado'|'iniciar'|'confirmar'|'leer'|'escribir'|'desconectar'}.
//   - GET ?code&state: el regreso de Google después de dar permiso. Guarda el permiso como pendiente y vuelve a la app con
//     ?google=ok&e=<estado> (o cancelado|permisos|error). La conexión se cierra con 'confirmar', que exige la misma cuenta
//     de LIA y el nonce que guardó ese navegador al iniciar: así nadie puede atar su Google a la cuenta de otro, ni el de
//     otro a la suya (CSRF de vinculación, hallazgo del revisor).
//   - POST de Google (X-Goog-Channel-ID): aviso de que cambió el calendario principal. Solo suma una señal (google_senal);
//     la app la recibe por Realtime y pide los eventos con 'leer'. Un canal que aún no está guardado (el «sync» llega
//     antes) o que ya no existe responde 200 sin hacer nada: con un error, Google deja de avisar.
//   - POST de pg_cron (x-lia-cron): renueva los avisos que vencen pronto.
// verify_jwt está apagado porque Google y pg_cron no tienen sesión; cada llamada se revisa aquí. El permiso de Google
// (refresh token) vive en Vault. No se guardan eventos ni títulos, y los registros nunca llevan tokens, códigos, correos,
// títulos ni ids de eventos.

export const ALCANCES = ['https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/calendar.events.readonly'];
export const API = 'https://www.googleapis.com/calendar/v3';
export const ZONA = 'America/Lima';
export const ORIGENES = [
  'https://lia-prototipo.jaime-ramos-93c.workers.dev',
  /^https:\/\/[a-z0-9-]+-lia-prototipo\.jaime-ramos-93c\.workers\.dev$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?$/,
];
export const origenPermitido = o => !!o && ORIGENES.some(x => (typeof x === 'string' ? x === o : x.test(o)));
export const cabecerasCors = o => ({
  'Access-Control-Allow-Origin': origenPermitido(o) ? o : ORIGENES[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});
const TIPOS = new Set(['estudio', 'evaluacion', 'clase', 'otro']);
export const DESCRIPCION = { evaluacion: 'Evaluación anotada en LIA.', estudio: 'Sesión de estudio armada por LIA en tus horas libres.', clase: 'Clase anotada en LIA.', otro: 'Anotado en LIA.' };

export function claveServidor(env) {
  try {
    const nuevas = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}');
    const k = nuevas.default || Object.values(nuevas)[0];
    if (k) return { apikey: k };
  } catch { /* sigue con la antigua */ }
  const vieja = env('SUPABASE_SERVICE_ROLE_KEY');
  return vieja ? { apikey: vieja, Authorization: `Bearer ${vieja}` } : null;
}
const urlFuncion = env => `${env('SUPABASE_URL')}/functions/v1/lia-google`;
const configurado = env => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'));
async function sha256(texto) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Compara secretos sin cortar en la primera diferencia.
export function iguales(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0 && a.length > 0;
}
const esperar = (deps, ms) => (deps.esperar ? deps.esperar(ms) : new Promise(r => setTimeout(r, ms)));
function aleatorio(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Hoy y ayer a las 00:00 en Lima (UTC−5, sin horario de verano).
const diaLima = (ahora, dias = 0) => {
  const d = new Date(ahora.getTime() - 5 * 3600e3);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + dias, 5));
};

// Un id estable por evento de LIA (misma hora y mismo título → mismo id), con las letras que acepta Google (a-v y 0-9).
export function idEvento(e) {
  const hash = semilla => { let h = semilla; for (const ch of `${e.inicio}|${e.fin}|${e.titulo}`) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(32); };
  return `lia${new Date(e.inicio).getTime().toString(32)}${hash(2166136261)}${hash(374761393)}`;
}
// La alerta de Google (aviso emergente) de cada evento de LIA: 2 horas antes de una evaluación y 15 minutos antes de lo
// demás, igual que los recordatorios por WhatsApp (iteración 3). Avisa aunque LIA esté cerrada.
export const alertasGoogle = tipo => ({ useDefault: false, overrides: [{ method: 'popup', minutes: tipo === 'evaluacion' ? 120 : 15 }] });
// ¿El evento que ya está en el calendario «LIA» tiene la alerta que le toca? Los de antes del 4-nov no la tienen.
function conAlertas(item, tipo) {
  const r = item && item.reminders, o = r && Array.isArray(r.overrides) ? r.overrides : [], q = alertasGoogle(tipo).overrides[0];
  return !!r && r.useDefault === false && o.length === 1 && o[0].method === q.method && Number(o[0].minutes) === q.minutes;
}
export function eventoGoogle(e) {
  return {
    id: idEvento(e), summary: String(e.titulo).slice(0, 80), description: DESCRIPCION[e.tipo] || DESCRIPCION.otro,
    start: { dateTime: e.inicio, timeZone: ZONA }, end: { dateTime: e.fin, timeZone: ZONA }, transparency: 'opaque',
    reminders: alertasGoogle(e.tipo),
    extendedProperties: { private: { lia: '1', tipo: e.tipo || 'otro' } },
  };
}

// ---------- Google → iCal: los eventos de la API se convierten en el iCal que ya entiende la app (leerIcs) ----------
const escapar = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// La hora de pared en una zona: las repeticiones (BYDAY) de Google son en la zona del evento, no en UTC.
function pared(iso, zona) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(iso))) p[x.type] = x.value;
  return `${p.year}${p.month}${p.day}T${String(+p.hour % 24).padStart(2, '0')}${p.minute}${p.second}`;
}
function fecha(nombre, t, recurrente) {
  if (!t) return null;
  if (t.date) return `${nombre};VALUE=DATE:${t.date.replace(/-/g, '')}`;
  if (!t.dateTime) return null;
  if (recurrente && t.timeZone) { try { return `${nombre};TZID=${t.timeZone}:${pared(t.dateTime, t.timeZone)}`; } catch { /* zona rara: en UTC */ } }
  return `${nombre}:${utc(t.dateTime)}`;
}
export function icsDeEventos(items) {
  const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LIA//lia-google//ES'];
  for (const e of items || []) {
    if (!e || !e.iCalUID) continue;
    if (e.eventType === 'workingLocation' || e.eventType === 'birthday') continue;
    if ((e.attendees || []).some(a => a.self && a.responseStatus === 'declined')) continue;
    const cancelada = e.status === 'cancelled';
    if (cancelada && !e.recurringEventId) continue;
    const inicio = cancelada ? e.originalStartTime : e.start, rec = Array.isArray(e.recurrence) && e.recurrence.length > 0;
    const ini = fecha('DTSTART', inicio, rec);
    if (!ini) continue;
    l.push('BEGIN:VEVENT', `UID:${e.iCalUID}`, ini);
    const fin = !cancelada && fecha('DTEND', e.end, rec);
    if (fin) l.push(fin);
    if (rec) for (const r of e.recurrence) if (/^(RRULE|EXDATE|RDATE)[;:]/.test(r)) l.push(r);
    if (e.recurringEventId && e.originalStartTime) { const r = fecha('RECURRENCE-ID', e.originalStartTime, false); if (r) l.push(r); }
    if (e.summary) l.push(`SUMMARY:${escapar(e.summary)}`);
    if (cancelada) l.push('STATUS:CANCELLED');
    if (e.transparency === 'transparent') l.push('TRANSP:TRANSPARENT');
    l.push('END:VEVENT');
  }
  l.push('END:VCALENDAR');
  return l.join('\r\n') + '\r\n';
}

// ---------- Supabase y Google ----------
async function rpc(deps, fn, args) {
  const res = await deps.fetch(`${deps.env('SUPABASE_URL')}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...claveServidor(deps.env) }, body: JSON.stringify(args || {}),
  });
  if (!res.ok) throw { error: 'base', http: res.status };
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
async function tokenAcceso(deps, usuario, cuenta) {
  const res = await deps.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: deps.env('GOOGLE_CLIENT_ID'), client_secret: deps.env('GOOGLE_CLIENT_SECRET'), refresh_token: cuenta.refresh, grant_type: 'refresh_token' }).toString(),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) {
    if (d.error === 'invalid_grant') { await rpc(deps, 'google_vencida', { p_user: usuario }); throw { error: 'vencida', status: 401 }; }
    throw { error: 'google', http: res.status };
  }
  return d.access_token;
}
// Con límites de Google (429, 403 por cuota) o fallas pasajeras (5xx), reintenta dos veces con espera.
async function google(deps, token, metodo, ruta, cuerpo) {
  for (let intento = 0; ; intento++) {
    const res = await deps.fetch(ruta.startsWith('http') ? ruta : API + ruta, {
      method: metodo, headers: { Authorization: `Bearer ${token}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) }, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    });
    if (res.status === 204) return { status: 204, datos: null };
    const datos = await res.json().catch(() => null);
    const razon = datos && datos.error && Array.isArray(datos.error.errors) && datos.error.errors[0] && datos.error.errors[0].reason;
    const limite = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(String(razon)));
    if (!limite || intento >= 2) return { status: res.status, datos };
    await esperar(deps, 400 * 3 ** intento);
  }
}
async function crearCalendario(deps, token) {
  const r = await google(deps, token, 'POST', '/calendars', { summary: 'LIA', description: 'Tu estudio, evaluaciones, eventos y rutinas de LIA. LIA lo mantiene al día: los cambios aquí se pierden.', timeZone: ZONA });
  if (r.status !== 200 || !r.datos || !r.datos.id) throw { error: 'google', http: r.status, paso: 'calendario' };
  return r.datos.id;
}
async function pedirAvisos(deps, token) {
  const canalId = deps.id ? deps.id() : crypto.randomUUID(), secreto = aleatorio();
  const r = await google(deps, token, 'POST', '/calendars/primary/events/watch', { id: canalId, type: 'web_hook', address: urlFuncion(deps.env), token: secreto, params: { ttl: String(7 * 86400) } });
  if (r.status !== 200 || !r.datos) return null;   // sin avisos, la app igual lee al abrirse y al volver a la pestaña
  return { id: canalId, recurso: r.datos.resourceId, token: secreto, vence: new Date(Number(r.datos.expiration) || deps.ahora().getTime() + 7 * 864e5).toISOString() };
}
// Cierra la conexión con un permiso recién dado: el calendario «LIA» (el de antes si sigue), los avisos y la cuenta.
async function conectar(deps, usuario, refresh, accessToken) {
  const previa = await rpc(deps, 'google_cuenta', { p_user: usuario });
  const token = accessToken || await tokenAcceso(deps, usuario, { refresh });
  let cal = previa && previa.cal_lia;
  if (cal) { const r = await google(deps, token, 'GET', `/calendars/${encodeURIComponent(cal)}`); if (r.status !== 200) cal = null; }
  if (!cal) cal = await crearCalendario(deps, token);
  if (previa) await pararAvisos(deps, token, previa);
  const canal = await pedirAvisos(deps, token);
  await rpc(deps, 'google_guardar', { p_user: usuario, p_refresh: refresh, p_cal: cal, p_canal_id: canal ? canal.id : null, p_canal_recurso: canal ? canal.recurso : null, p_canal_token: canal ? canal.token : null, p_canal_vence: canal ? canal.vence : null });
  return !!canal;
}
const pararAvisos = (deps, token, c) => c.canal_id && c.canal_recurso ? google(deps, token, 'POST', '/channels/stop', { id: c.canal_id, resourceId: c.canal_recurso }).catch(() => null) : null;

// Lo que la app manda para escribir: hasta 300 eventos con fechas válidas y títulos cortos.
function validarEventos(ev) {
  if (!Array.isArray(ev) || ev.length > 300) return null;
  const out = [];
  for (const e of ev) {
    if (!e || typeof e.inicio !== 'string' || typeof e.fin !== 'string' || typeof e.titulo !== 'string' || !e.titulo.trim()) return null;
    const a = Date.parse(e.inicio), b = Date.parse(e.fin);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(e.inicio) || !/^\d{4}-\d{2}-\d{2}T/.test(e.fin) || !(a < b) || b - a > 24 * 3600e3) return null;
    out.push({ inicio: e.inicio, fin: e.fin, titulo: e.titulo.slice(0, 80), tipo: TIPOS.has(e.tipo) ? e.tipo : 'otro' });
  }
  return out;
}
async function enTandas(lista, n, fn) {   // pocas a la vez: Google limita las ráfagas de creación
  for (let i = 0; i < lista.length; i += n) await Promise.all(lista.slice(i, i + n).map(fn));
}

// ---------- Acciones de la app ----------
async function accionApp(req, deps, origen, responder) {
  if (!origenPermitido(origen)) return responder(403, { ok: false, error: 'origen' });
  const autorizacion = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/.test(autorizacion)) return responder(401, { ok: false, error: 'sesion' });
  let pedido;
  try { pedido = JSON.parse(await req.text()); } catch { pedido = null; }
  const accion = pedido && pedido.accion;
  if (!['estado', 'iniciar', 'confirmar', 'leer', 'escribir', 'desconectar'].includes(accion)) return responder(400, { ok: false, error: 'pedido' });
  let usuario;
  try {
    const r = await deps.fetch(`${deps.env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: req.headers.get('apikey') || deps.env('SUPABASE_ANON_KEY') || '', Authorization: autorizacion } });
    const u = r.ok ? await r.json() : null;
    if (!u || !u.id) return responder(401, { ok: false, error: 'sesion' });
    usuario = u.id;
  } catch { return responder(503, { ok: false, error: 'ocupado' }); }
  const extra = { paso: accion };
  if (accion !== 'estado' && !configurado(deps.env)) return responder(503, { ok: false, error: 'sin_configurar' }, extra);

  if (accion === 'iniciar') {
    // El nonce lo guarda este navegador; solo su hash va a la base.
    if (typeof pedido.nonce !== 'string' || !/^[a-f0-9]{32,128}$/.test(pedido.nonce)) return responder(400, { ok: false, error: 'pedido' }, extra);
    const estado = await rpc(deps, 'google_nuevo_estado', { p_user: usuario, p_origen: origen || ORIGENES[0], p_nonce: await sha256(pedido.nonce) });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [k, v] of Object.entries({ client_id: deps.env('GOOGLE_CLIENT_ID'), redirect_uri: urlFuncion(deps.env), response_type: 'code', scope: ALCANCES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: estado })) url.searchParams.set(k, v);
    return responder(200, { ok: true, url: url.toString() }, extra);
  }
  if (accion === 'confirmar') {
    if (typeof pedido.estado !== 'string' || typeof pedido.nonce !== 'string') return responder(400, { ok: false, error: 'pedido' }, extra);
    const p = await rpc(deps, 'google_confirmar_estado', { p_estado: pedido.estado, p_user: usuario, p_nonce: await sha256(pedido.nonce) });
    if (!p || !p.refresh) return responder(403, { ok: false, error: 'estado' }, extra);
    try {
      const avisos = await conectar(deps, usuario, p.refresh, null);
      return responder(200, { ok: true, avisos }, { ...extra, avisos });
    } catch (e) {
      return responder(e && e.error === 'vencida' ? 401 : 502, { ok: false, error: e && e.error === 'vencida' ? 'vencida' : 'google' }, { ...extra, http: e && e.http, en: e && e.paso });
    }
  }
  const cuenta = await rpc(deps, 'google_cuenta', { p_user: usuario });
  if (accion === 'estado') return responder(200, { ok: true, configurado: configurado(deps.env), conectado: !!cuenta, estado: cuenta ? cuenta.estado : null, avisos: !!(cuenta && cuenta.canal_id) }, extra);
  if (!cuenta) return responder(409, { ok: false, error: 'no_conectado' }, extra);
  if (cuenta.estado !== 'activa' && accion !== 'desconectar') return responder(401, { ok: false, error: 'vencida' }, extra);
  let eventos;
  if (accion === 'escribir') { eventos = validarEventos(pedido.eventos); if (!eventos) return responder(400, { ok: false, error: 'pedido' }, extra); }
  try {
    // Al desconectar con el permiso ya quitado en Google, igual se borra lo de LIA; con otra falla, se puede reintentar.
    const token = await tokenAcceso(deps, usuario, cuenta).catch(e => { if (accion === 'desconectar' && e && e.error === 'vencida') return null; throw e; });

    if (accion === 'desconectar') {
      if (token) {
        await pararAvisos(deps, token, cuenta);
        if (cuenta.cal_lia) await google(deps, token, 'DELETE', `/calendars/${encodeURIComponent(cuenta.cal_lia)}`).catch(() => null);
      }
      await deps.fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: cuenta.refresh }).toString() }).catch(() => null);
      await rpc(deps, 'google_borrar', { p_user: usuario });
      return responder(200, { ok: true }, extra);
    }

    if (accion === 'leer') {
      const items = [];
      let pagina = '';
      // Con singleEvents y showDeleted en falso, Google igual manda las instancias canceladas de una serie (documentación de
      // events.list): son las que dejan libre ese día. No hace falta showDeleted.
      for (let i = 0; i < 10; i++) {
        const q = new URLSearchParams({ singleEvents: 'false', maxResults: '2500', timeMin: diaLima(deps.ahora(), -1).toISOString(), timeMax: diaLima(deps.ahora(), 121).toISOString(), ...(pagina ? { pageToken: pagina } : {}) });
        const r = await google(deps, token, 'GET', `/calendars/primary/events?${q}`);
        if (r.status !== 200 || !r.datos) throw { error: 'google', http: r.status, paso: 'leer' };
        items.push(...(r.datos.items || []));
        pagina = r.datos.nextPageToken;
        if (!pagina) break;
      }
      return responder(200, { ok: true, ics: icsDeEventos(items) }, { ...extra, eventos: items.length });
    }

    // escribir: el calendario «LIA» queda igual a lo que manda la app, de hoy a los próximos 16 días (lo de antes se queda).
    let cal = cuenta.cal_lia;
    const listar = c => google(deps, token, 'GET', `/calendars/${encodeURIComponent(c)}/events?${new URLSearchParams({ timeMin: diaLima(deps.ahora(), 0).toISOString(), timeMax: diaLima(deps.ahora(), 16).toISOString(), maxResults: '2500', singleEvents: 'true', showDeleted: 'false' })}`);
    let lista = cal ? await listar(cal) : { status: 404 };
    if (lista.status === 404 || lista.status === 410) {
      cal = await crearCalendario(deps, token);
      await rpc(deps, 'google_cal_lia', { p_user: usuario, p_cal: cal });
      lista = await listar(cal);
    }
    if (lista.status !== 200 || !lista.datos) throw { error: 'google', http: lista.status, paso: 'listar' };
    const quiero = new Map(eventos.map(e => [idEvento(e), e])), hay = new Map((lista.datos.items || []).map(e => [e.id, e]));
    const sobran = [...hay.keys()].filter(id => !quiero.has(id)), faltan = [...quiero.keys()].filter(id => !hay.has(id));
    // Los que ya estaban (mismo id: misma hora y título) sin la alerta que les toca se actualizan.
    const sinAlerta = [...quiero.keys()].filter(id => hay.has(id) && !conAlertas(hay.get(id), quiero.get(id).tipo));
    let errores = 0;
    const evento = id => `/calendars/${encodeURIComponent(cal)}/events/${id}`;
    await enTandas(sobran, 3, async id => { const r = await google(deps, token, 'DELETE', evento(id)); if (r.status >= 300 && r.status !== 404 && r.status !== 410) errores++; });
    await enTandas(faltan, 3, async id => {
      const r = await google(deps, token, 'POST', `/calendars/${encodeURIComponent(cal)}/events`, eventoGoogle(quiero.get(id)));
      if (r.status === 409) {   // ya existía (borrado antes): se reemplaza
        const u = await google(deps, token, 'PUT', evento(id), { ...eventoGoogle(quiero.get(id)), status: 'confirmed' });
        if (u.status >= 300) errores++;
      } else if (r.status >= 300) errores++;
    });
    await enTandas(sinAlerta, 3, async id => { const u = await google(deps, token, 'PUT', evento(id), eventoGoogle(quiero.get(id))); if (u.status >= 300) errores++; });
    const totales = { creados: faltan.length, borrados: sobran.length, actualizados: sinAlerta.length };
    if (errores) return responder(502, { ok: false, error: 'google', ...totales }, { ...extra, errores });
    return responder(200, { ok: true, ...totales }, extra);
  } catch (e) {
    if (e && e.error === 'vencida') return responder(401, { ok: false, error: 'vencida' }, extra);
    return responder(502, { ok: false, error: 'google' }, { ...extra, http: e && e.http, en: e && e.paso });
  }
}

// ---------- Regreso de Google (OAuth) ----------
async function regreso(url, deps, log) {
  const q = url.searchParams, volver = (origen, motivo, extra = {}) => {
    log({ paso: 'regreso', resultado: motivo, ...extra });
    return new Response(null, { status: 302, headers: { Location: `${origenPermitido(origen) ? origen : ORIGENES[0]}/?google=${motivo}`, 'Cache-Control': 'no-store' } });
  };
  let est = null;
  try { est = q.get('state') ? await rpc(deps, 'google_ver_estado', { p_estado: q.get('state') }) : null; } catch { est = null; }
  if (!est || !est.user_id) return volver(null, 'error', { estado: 'invalido' });
  if (q.get('error')) return volver(est.origen, 'cancelado');
  if (!q.get('code') || !configurado(deps.env)) return volver(est.origen, 'error');
  try {
    const res = await deps.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: q.get('code'), client_id: deps.env('GOOGLE_CLIENT_ID'), client_secret: deps.env('GOOGLE_CLIENT_SECRET'), redirect_uri: urlFuncion(deps.env), grant_type: 'authorization_code' }).toString(),
    });
    const t = await res.json().catch(() => ({}));
    if (!res.ok || !t.access_token) return volver(est.origen, 'error', { http: res.status });
    const dados = String(t.scope || '').split(/\s+/);
    if (!ALCANCES.every(a => dados.includes(a))) return volver(est.origen, 'permisos');
    if (!t.refresh_token) return volver(est.origen, 'error', { sin: 'refresh' });
    // Pendiente hasta que la app de esa cuenta, en ese navegador, lo confirme.
    const listo = await rpc(deps, 'google_estado_listo', { p_estado: q.get('state'), p_refresh: t.refresh_token });
    if (!listo) return volver(est.origen, 'error', { estado: 'vencido' });
    log({ paso: 'regreso', resultado: 'ok' });
    return new Response(null, { status: 302, headers: { Location: `${origenPermitido(est.origen) ? est.origen : ORIGENES[0]}/?google=ok&e=${encodeURIComponent(q.get('state'))}`, 'Cache-Control': 'no-store' } });
  } catch (e) {
    return volver(est.origen, 'error', { http: e && e.http, en: e && e.paso });
  }
}

// ---------- pg_cron: renovar los avisos ----------
async function renovar(deps, responder) {
  await rpc(deps, 'google_limpiar_estados', {}).catch(() => null);   // permisos que nadie confirmó
  const usuarios = await rpc(deps, 'google_canales_por_vencer', {});
  let renovados = 0, fallidos = 0;
  for (const u of usuarios || []) {
    try {
      const c = await rpc(deps, 'google_cuenta', { p_user: u });
      if (!c) continue;
      const token = await tokenAcceso(deps, u, c);
      const canal = await pedirAvisos(deps, token);
      if (!canal) { fallidos++; continue; }
      await pararAvisos(deps, token, c);
      await rpc(deps, 'google_actualizar_canal', { p_user: u, p_canal_id: canal.id, p_canal_recurso: canal.recurso, p_canal_token: canal.token, p_canal_vence: canal.vence });
      renovados++;
    } catch { fallidos++; }
  }
  return responder(200, { ok: true, renovados }, { paso: 'renovar', fallidos });
}

export async function manejar(req, deps) {
  const inicio = Date.now(), origen = req.headers.get('origin') || '', url = new URL(req.url);
  const log = d => deps.log({ evento: 'lia-google', ms: Date.now() - inicio, ...d });
  const responder = (status, cuerpo, extra = {}) => {
    log({ estado: status, ...(cuerpo && cuerpo.error ? { error: cuerpo.error } : {}), ...extra });
    return new Response(JSON.stringify(cuerpo), { status, headers: { ...cabecerasCors(origen), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  };
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabecerasCors(origen) });
    if (req.method === 'GET') return regreso(url, deps, log);
    if (req.method !== 'POST') return responder(405, { ok: false, error: 'metodo' });
    // Aviso de Google: solo con el secreto de ese canal.
    const canal = req.headers.get('x-goog-channel-id');
    if (canal) {
      const estado = req.headers.get('x-goog-resource-state');
      const c = await rpc(deps, 'google_por_canal', { p_canal: canal });
      // Google manda el primer aviso del canal («sync») apenas lo crea, antes de que google_guardar (o
      // google_actualizar_canal) lo guarde. Con un 404, Google dejó de avisar (registro del 3-nov, 22:49). Un canal
      // desconocido, sync o no, responde 200 y no hace nada: no hay a quién avisar.
      if (!c) return responder(200, { ok: true }, { paso: 'aviso', resultado: 'desconocido', recurso: estado });
      if (!iguales(c.canal_token, req.headers.get('x-goog-channel-token'))) return responder(403, { ok: false }, { paso: 'aviso' });
      if (estado !== 'sync') await rpc(deps, 'google_avisar', { p_user: c.user_id });
      return responder(200, { ok: true }, { paso: 'aviso', recurso: estado });
    }
    const cron = req.headers.get('x-lia-cron');
    if (cron !== null) {
      if (!(await rpc(deps, 'avisos_cron_ok', { p_secreto: cron }))) return responder(401, { ok: false, error: 'secreto' }, { paso: 'renovar' });
      return renovar(deps, responder);
    }
    return accionApp(req, deps, origen, responder);
  } catch (e) {
    return responder(503, { ok: false, error: 'ocupado' }, { http: e && e.http });
  }
}
