// LIA · lógica de la Edge Function lia-calendario: Google Calendar en los dos sentidos, sin Google Cloud ni permisos
// de Google (ver docs/canales.md y docs/calendario.md).
//   - GET ?t=<token>: el enlace iCal secreto que la persona agrega en Google Calendar («Otros calendarios → Desde URL»),
//     con lo que publicó la app (publicar_agenda()): estudio, evaluaciones, eventos de un día y rutinas.
//   - POST {accion:'importar', url} de la app, con la sesión de la persona: lee la «dirección secreta en formato iCal» de
//     su calendario (Google no deja leerla desde otra página) y la devuelve sin lo que ya pasó. No guarda nada.
// verify_jwt está apagado porque Google pide el enlace sin sesión: el token largo y secreto es la llave; el POST revisa
// la sesión aquí. Los registros nunca llevan el token, la dirección ni los títulos.

export function claveServidor(env) {
  try {
    const nuevas = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}');
    const k = nuevas.default || Object.values(nuevas)[0];
    if (k) return { apikey: k };
  } catch { /* sigue con la antigua */ }
  const vieja = env('SUPABASE_SERVICE_ROLE_KEY');
  return vieja ? { apikey: vieja, Authorization: `Bearer ${vieja}` } : null;
}

// Texto de iCal: barra, punto y coma, coma y saltos de línea escapados.
export const escapar = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Líneas de hasta 75 bytes; las siguientes empiezan con un espacio (RFC 5545, 3.1). No corta un carácter a la mitad.
export function doblar(linea) {
  const te = new TextEncoder(), out = [];
  let actual = '', bytes = 0, limite = 75;
  for (const ch of linea) {
    const n = te.encode(ch).length;
    if (bytes + n > limite) { out.push(actual); actual = ' '; bytes = 1; limite = 75; }
    actual += ch; bytes += n;
  }
  out.push(actual);
  return out.join('\r\n');
}
export const fechaIcs = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Un identificador estable por evento (misma hora y mismo título → mismo UID), para que Google no lo duplique.
export function uid(e) {
  let h = 2166136261;
  for (const ch of `${e.inicio}|${e.titulo}`) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return `lia-${new Date(e.inicio).getTime()}-${h.toString(36)}@lia-prototipo`;
}

export const DESCRIPCION = { evaluacion: 'Evaluación anotada en LIA.', estudio: 'Sesión de estudio armada por LIA en tus horas libres.', clase: 'Clase anotada en LIA.', otro: 'Anotado en LIA.' };
export const CATEGORIA = { evaluacion: 'Evaluación', estudio: 'Estudio', clase: 'Clases', otro: 'LIA' };

export function calendarioIcs(eventos, ahora = new Date()) {
  const stamp = fechaIcs(ahora.toISOString());
  const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LIA//Grupo 8//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:LIA', 'X-WR-TIMEZONE:America/Lima', 'X-WR-CALDESC:Tu semana en LIA: estudio\\, evaluaciones\\, eventos y rutinas.',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const e of eventos || []) {
    if (!e || !e.inicio || !e.fin || !e.titulo) continue;
    l.push('BEGIN:VEVENT', `UID:${uid(e)}`, `DTSTAMP:${stamp}`, `DTSTART:${fechaIcs(e.inicio)}`, `DTEND:${fechaIcs(e.fin)}`,
      `SUMMARY:${escapar(e.titulo)}`,
      `DESCRIPTION:${escapar(DESCRIPCION[e.tipo] || DESCRIPCION.otro)}`,
      `CATEGORIES:${CATEGORIA[e.tipo] || CATEGORIA.otro}`,
      'TRANSP:OPAQUE', 'END:VEVENT');
  }
  l.push('END:VCALENDAR');
  return l.map(doblar).join('\r\n') + '\r\n';
}

// ---------- Traer el calendario de la persona (POST importar) ----------
// Direcciones desde las que la app puede pedirlo (las mismas que lia-ia y lia-whatsapp).
export const ORIGENES = [
  'https://lia-prototipo.jaime-ramos-93c.workers.dev',
  /^https:\/\/[a-z0-9-]+-lia-prototipo\.jaime-ramos-93c\.workers\.dev$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?$/,
];
export const origenPermitido = o => !o || ORIGENES.some(x => (typeof x === 'string' ? x === o : x.test(o)));
export const cabecerasCors = o => ({
  'Access-Control-Allow-Origin': o && origenPermitido(o) ? o : ORIGENES[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});
// bytes: lo más que se lee de Google; salida: lo más que se devuelve ya recortado; ms: espera; saltos: redirecciones.
export const LIMITES = { bytes: 15 * 1024 * 1024, salida: 4 * 1024 * 1024, ms: 10000, saltos: 3 };
// Solo calendarios por dirección secreta: Google, Outlook e iCloud. Nada más (ni la propia función).
const PERMITIDAS = [
  [/^calendar\.google\.com$/, /^\/calendar\/ical\//],
  [/^outlook\.(live|office365|office)\.com$/, /^\/owa\/calendar\//],
  [/^p\d{1,3}-caldav\.icloud\.com$/, /^\/published\//],
];
export function urlCalendario(texto) {
  const s = String(texto ?? '').trim().replace(/^webcals?:\/\//i, 'https://');
  if (!s || s.length > 2048) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  return PERMITIDAS.some(([h, r]) => h.test(u.hostname) && r.test(u.pathname)) ? u.toString() : null;
}
// Quita lo que ya pasó para no mandar años de historia al teléfono: se queda lo que se repite, sus cambios recientes y
// lo de ayer en adelante (un día de margen: en UTC, lo de anoche puede tener la fecha de hoy o de ayer).
export function recortarIcs(texto, hoy) {
  const d = new Date(`${hoy}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const corte = d.toISOString().slice(0, 10).replace(/-/g, '');
  const fecha = (t, n, conHora) => { const m = new RegExp(`^${n}[^:\\n]*:(\\d{8})${conHora ? 'T' : ''}`, 'm').exec(t); return m ? m[1] : null; };
  const seQueda = b => {
    const t = b.join('\n').replace(/\n[ \t]/g, '');
    if (/^RRULE[;:]/m.test(t)) return true;
    const f = [fecha(t, 'DTSTART'), fecha(t, 'RECURRENCE-ID'), fecha(t, 'DTEND', true)].filter(Boolean);
    return !f.length || f.some(x => x >= corte);
  };
  const out = [];
  let bloque = null;
  for (const l of String(texto).split(/\r?\n/)) {
    if (bloque) { bloque.push(l); if (/^END:VEVENT/i.test(l)) { if (seQueda(bloque)) out.push(...bloque); bloque = null; } continue; }
    if (/^BEGIN:VEVENT/i.test(l)) { bloque = [l]; continue; }
    if (l !== '') out.push(l);
  }
  return out.join('\r\n') + '\r\n';
}
async function leerCuerpo(res, max) {
  if (!res.body) { const t = await res.text(); if (t.length > max) throw { error: 'muy_grande' }; return t; }
  const lector = res.body.getReader(), trozos = [];
  let n = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await lector.cancel(); } catch { /* ya está */ } throw { error: 'muy_grande' }; }
    trozos.push(value);
  }
  const todo = new Uint8Array(n);
  let i = 0;
  for (const t of trozos) { todo.set(t, i); i += t.length; }
  return new TextDecoder().decode(todo);
}
const hoyLima = deps => new Date((deps.ahora ? deps.ahora() : new Date()).getTime() - 5 * 3600e3).toISOString().slice(0, 10);

async function importar(req, deps, origen, responder) {
  const lim = { ...LIMITES, ...(deps.limites || {}) };
  if (!origenPermitido(origen)) return responder(403, { ok: false, error: 'origen' });
  const autorizacion = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/.test(autorizacion)) return responder(401, { ok: false, error: 'sesion' });
  let pedido;
  try { pedido = JSON.parse(await req.text()); } catch { pedido = null; }
  if (!pedido || pedido.accion !== 'importar') return responder(400, { ok: false, error: 'pedido' });
  try {
    const r = await deps.fetch(`${deps.env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: req.headers.get('apikey') || deps.env('SUPABASE_ANON_KEY') || '', Authorization: autorizacion } });
    if (!r.ok) return responder(401, { ok: false, error: 'sesion' });
  } catch { return responder(503, { ok: false, error: 'ocupado' }); }
  let url = urlCalendario(pedido.url);
  if (!url) return responder(400, { ok: false, error: 'no_permitida' });
  const control = new AbortController(), reloj = setTimeout(() => control.abort(), lim.ms);
  try {
    let res;
    for (let salto = 0; ; salto++) {
      res = await deps.fetch(url, { redirect: 'manual', signal: control.signal, headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1', 'User-Agent': 'LIA-calendario/1.0' } });
      const destino = res.status >= 300 && res.status < 400 && res.headers.get('location');
      if (!destino) break;
      let sig = null;
      try { sig = urlCalendario(new URL(destino, url).toString()); } catch { sig = null; }
      if (!sig || salto >= lim.saltos) return responder(400, { ok: false, error: 'no_permitida' }, { http: res.status, salto });
      url = sig;
    }
    if (res.status === 404 || res.status === 410) return responder(404, { ok: false, error: 'no_encontrado' }, { http: res.status });
    if (!res.ok) return responder(502, { ok: false, error: 'no_responde' }, { http: res.status });
    if (Number(res.headers.get('content-length') || 0) > lim.bytes) return responder(413, { ok: false, error: 'muy_grande' });
    const texto = await leerCuerpo(res, lim.bytes);
    if (!/^\s*BEGIN:VCALENDAR/i.test(texto)) return responder(422, { ok: false, error: 'no_es_calendario' });
    const ics = recortarIcs(texto, hoyLima(deps));
    if (ics.length > lim.salida) return responder(413, { ok: false, error: 'muy_grande' }, { bytes: texto.length });
    return responder(200, { ok: true, ics }, { bytes: texto.length, recortado: ics.length, eventos: (ics.match(/BEGIN:VEVENT/g) || []).length });
  } catch (e) {
    if (e && e.error === 'muy_grande') return responder(413, { ok: false, error: 'muy_grande' });
    if (control.signal.aborted || (e && e.name === 'AbortError')) return responder(504, { ok: false, error: 'tiempo' });
    return responder(502, { ok: false, error: 'no_responde' });
  } finally { clearTimeout(reloj); }
}

export async function manejar(req, deps) {
  const inicio = Date.now(), origen = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabecerasCors(origen) });
  if (req.method === 'POST') {
    return importar(req, deps, origen, (status, cuerpo, extra = {}) => {
      deps.log({ evento: 'lia-calendario', paso: 'importar', estado: status, ms: Date.now() - inicio, ...(cuerpo.error ? { error: cuerpo.error } : {}), ...extra });
      return new Response(JSON.stringify(cuerpo), { status, headers: { ...cabecerasCors(origen), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    });
  }
  const responder = (status, cuerpo, tipo = 'text/plain; charset=utf-8', extra = {}) => {
    deps.log({ evento: 'lia-calendario', estado: status, ms: Date.now() - inicio, ...extra });
    return new Response(cuerpo, { status, headers: { 'Content-Type': tipo, 'Cache-Control': status === 200 ? 'private, max-age=300' : 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return responder(405, 'Método no permitido');
  const token = new URL(req.url).searchParams.get('t') || '';
  if (!/^[a-f0-9]{32,80}$/.test(token)) return responder(404, 'No encontrado');
  const url = deps.env('SUPABASE_URL'), cab = claveServidor(deps.env);
  if (!url || !cab) return responder(503, 'Sin configuración');
  let filas;
  try {
    const res = await deps.fetch(`${url}/rest/v1/rpc/agenda_por_token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...cab }, body: JSON.stringify({ p_token: token }),
    });
    if (!res.ok) return responder(503, 'Inténtalo más tarde', undefined, { http: res.status });
    filas = await res.json();
  } catch {
    return responder(503, 'Inténtalo más tarde');
  }
  // Un enlace que ya no existe (se dejó de compartir) responde vacío, no con un error: Google deja de mostrar eventos.
  return responder(200, req.method === 'HEAD' ? '' : calendarioIcs(Array.isArray(filas) ? filas : []), 'text/calendar; charset=utf-8', { eventos: Array.isArray(filas) ? filas.length : 0 });
}
