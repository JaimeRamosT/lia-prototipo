// LIA · lógica de la Edge Function lia-calendario: el enlace iCal secreto que la persona agrega en Google Calendar
// («Otros calendarios → Desde URL»), sin Google Cloud ni permisos de Google (ver docs/canales.md).
// GET ?t=<token> → text/calendar con las sesiones de estudio y evaluaciones que publicó la app (publicar_agenda()).
// verify_jwt está apagado porque Google pide el enlace sin sesión: el token largo y secreto es la llave.
// Los registros nunca llevan el token ni los títulos.

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

export function calendarioIcs(eventos, ahora = new Date()) {
  const stamp = fechaIcs(ahora.toISOString());
  const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LIA//Grupo 8//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:LIA · Estudio', 'X-WR-TIMEZONE:America/Lima', 'X-WR-CALDESC:Tus sesiones de estudio y evaluaciones\\, armadas por LIA.',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const e of eventos || []) {
    if (!e || !e.inicio || !e.fin || !e.titulo) continue;
    l.push('BEGIN:VEVENT', `UID:${uid(e)}`, `DTSTAMP:${stamp}`, `DTSTART:${fechaIcs(e.inicio)}`, `DTEND:${fechaIcs(e.fin)}`,
      `SUMMARY:${escapar(e.titulo)}`,
      `DESCRIPTION:${escapar(e.tipo === 'evaluacion' ? 'Evaluación anotada en LIA.' : e.tipo === 'estudio' ? 'Sesión de estudio armada por LIA en tus horas libres.' : 'Anotado en LIA.')}`,
      `CATEGORIES:${e.tipo === 'evaluacion' ? 'Evaluación' : e.tipo === 'estudio' ? 'Estudio' : 'LIA'}`,
      'TRANSP:OPAQUE', 'END:VEVENT');
  }
  l.push('END:VCALENDAR');
  return l.map(doblar).join('\r\n') + '\r\n';
}

export async function manejar(req, deps) {
  const inicio = Date.now();
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
