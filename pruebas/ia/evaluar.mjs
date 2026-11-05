// Evaluación de Lía con Gemini: pasa las frases de frases.json por el modelo real, con las mismas instrucciones,
// esquema y revisión que usan la función lia-ia y la app, y compara el resultado con las reglas de hoy (interpret()).
//
// Se corre en tu computadora con tu clave de Google AI Studio (la misma que guardaste en Supabase). La clave
// solo se lee de la variable de entorno: nunca la escribas en un archivo del repositorio.
//   PowerShell:    $env:GEMINI_API_KEY="tu-clave"; node pruebas/ia/evaluar.mjs
//   macOS o Linux: GEMINI_API_KEY=tu-clave node pruebas/ia/evaluar.mjs
// Opciones:
//   --modelo=gemini-3.5-flash-lite   otro modelo (por defecto, el de la función)
//   --pausa=4500                     milisegundos entre pedidos (el nivel gratuito limita los pedidos por minuto)
//   --solo=eval-01,cambio-03         solo esas frases
//   --meta=0.9                       exactitud mínima para aprobar
//   --detalle                        muestra la respuesta de Gemini en las frases que fallan
//   --salida=resultado.json          guarda todos los resultados en ese archivo
//   --solo-reglas                    sin Gemini: cuánto entienden las reglas y qué frases irían a la IA (no necesita clave)
//   --proveedor=groq                 otro proveedor: groq, cerebras u openrouter (por defecto, gemini). Usa su clave:
//                                    GROQ_API_KEY, CEREBRAS_API_KEY u OPENROUTER_API_KEY. Ejemplo (PowerShell):
//                                    $env:GROQ_API_KEY="tu-clave"; node pruebas/ia/evaluar.mjs --proveedor=groq
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { L, estado } from '../logica.mjs';
import { MODELO, TIEMPO_GEMINI, PROVEEDORES, leerPedido, pedirGemini, proveedorDe } from '../../supabase/functions/lia-ia/logica.js';
// Pausa entre pedidos por proveedor, para no pasar el límite gratuito con ~2 700 tokens por pedido
// (Groq: 8 000 tokens por minuto; Cerebras: 5 pedidos por minuto).
const PAUSA = { gemini: 4500, groq: 21000, cerebras: 13000, openrouter: 3500 };

// ---------- El contexto fijo de las frases ----------
export const AHORA = '2026-10-26T10:00:00-05:00';                // lunes, como lo envía la app desde Lima
export const ahoraLocal = () => new Date(2026, 9, 26, 10, 0);     // la misma hora en el reloj de esta computadora
export function estadoEval() {
  return estado({
    compromisos: [
      { id: 'c1', name: 'Trabajo', type: 'trabajo', days: [1, 2, 3, 4, 5], start: '15:00', end: '19:00' },
      { id: 'c2', name: 'Clases', type: 'clase', days: [1, 2, 3, 4, 5], start: '08:00', end: '12:00' },
      { id: 'c3', name: 'Inglés', type: 'otro', days: [6], start: '09:00', end: '11:00' },
      // Iteración 3: un curso para ligar evaluaciones («pc3 de emprendimiento» → «Emprendimiento»).
      { id: 'c4', name: 'Emprendimiento', type: 'clase', days: [6], start: '14:00', end: '17:00' },
    ],
    // Iteración 3: un evento de un día para quitar («quita la reunión del jueves»). La IA no ve los eventos de un día.
    excepciones: [{ id: 'x1', date: '2026-10-29', start: '13:00', end: '14:00', label: 'Reunión de grupo', cat: 'otro' }],
    evaluaciones: [
      { id: 'e1', type: 'parcial', course: 'Cálculo II', date: '2026-10-29', time: '09:00', hours: 5 },
      { id: 'e2', type: 'entrega', course: 'Informe de Química', date: '2026-10-30', time: '23:59', hours: 4 },
      { id: 'e3', type: 'practica', course: 'Física', date: '2026-11-03', time: '19:00', hours: 3 },
    ],
  });
}
// Lo que enviaría la app (contextoIA), con la hora de Lima aunque esta computadora esté en otra zona.
export const contextoEval = s => ({ ...L.contextoIA(s, ahoraLocal()), ahora: AHORA });

export function cargarFrases(archivo = new URL('./frases.json', import.meta.url)) {
  return JSON.parse(readFileSync(archivo, 'utf8')).frases;
}

// ---------- Revisión: ¿la app hace lo que se espera? ----------
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const vale = (esperado, real) => esperado === undefined || (Array.isArray(esperado) ? esperado.includes(real) : esperado === real);
const mismosDias = (a, b) => Array.isArray(b) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function itemCoincide(e, i) {
  if (!i || e.kind !== i.kind) return false;
  if (e.kind === 'eval') return vale(e.type, i.type) && norm(i.course).includes(norm(e.course)) && vale(e.date, i.date) && vale(e.time, i.time);
  return vale(e.type, i.type) && (e.days === undefined || mismosDias(e.days, i.days)) && vale(e.start, i.start) && vale(e.end, i.end);
}
function cambioCoincide(e, x) {
  if (!x || x.date !== e.date) return false;
  if (e.libre) return x.libre === true && vale(e.ref, x.ref) && vale(e.start, x.start) && vale(e.end, x.end);
  return !x.libre && vale(e.start, x.start) && vale(e.end, x.end);
}
// Cada esperado con un resultado distinto; con «exacto», sin cosas de más (la IA no debe inventar).
function emparejar(esperados, reales, coincide, exacto) {
  const usados = new Set();
  for (const e of esperados) {
    const k = reales.findIndex((r, j) => !usados.has(j) && coincide(e, r));
    if (k < 0) return false;
    usados.add(k);
  }
  return !exacto || usados.size === reales.length;
}
// Lo que Lía pregunta: el dato que le falta al borrador (iteración 2: Lía pide lo que falta, con IA y sin IA).
const faltaDe = r => (r && r.intent === 'pregunta' && r.borrador ? L.faltaDe(r.borrador.items[r.borrador.i]) : null);

// r: la intención que usa la app; origen: 'ia' o 'reglas'; ia: la intención que eligió Gemini (antes de la revisión);
// faltaIA: el dato que Gemini dijo que preguntaba.
export function revisar(espera, { r, origen, ia, faltaIA = null }) {
  return (Array.isArray(espera) ? espera : [espera]).some(e => {
    const exacto = e.exacto !== false;
    switch (e.intent) {
      case 'add': return r.intent === 'add' && emparejar(e.items, r.items, itemCoincide, exacto);
      case 'except': return r.intent === 'except' && emparejar(e.exs, r.exs, cambioCoincide, exacto);
      case 'log': return r.intent === 'log' && r.evalId === e.evalId && vale(e.date, r.date) && vale(e.min, r.min);
      case 'agenda': return r.intent === 'agenda' && r.date === e.date;
      case 'progress': case 'next': case 'replan': return r.intent === e.intent;
      // Pregunta lo que falta: con borrador (y respuestas rápidas) o, con IA, al menos el dato correcto en «falta».
      case 'pregunta': return (r.intent === 'pregunta' && vale(e.falta, faltaDe(r))) || (origen === 'ia' && ia === 'pregunta' && vale(e.falta, faltaIA));
      case 'aviso': return origen === 'ia' ? ia === 'aviso' : r.intent === 'aviso';
      case 'fuera': return origen === 'ia' ? ia === 'fuera' : r.intent === 'help';
      // Cambiar o quitar lo que ya está (solo las reglas lo proponen; la app pide confirmar).
      case 'cambiaEval': return r.intent === 'cambiaEval' && r.evalId === e.evalId && vale(e.date, r.date) && vale(e.time, r.time);
      case 'quitaEval': return r.intent === 'quitaEval' && r.evalId === e.evalId;
      case 'quitaEvento': return r.intent === 'quitaEvento' && r.exId === e.exId;
      case 'quitaRutina': return r.intent === 'quitaRutina' && mismosDias(e.ids, r.ids);
      case 'sin_cambios': return !['add', 'except', 'log', 'replan', 'cambiaEval', 'quitaEval', 'quitaEvento', 'quitaRutina'].includes(r.intent);
      default: return false;
    }
  });
}

// Resumen corto de lo que haría la app, para el informe.
export function resumir(r) {
  if (!r) return '—';
  switch (r.intent) {
    case 'add': return 'agrega ' + r.items.map(i => i.kind === 'eval' ? `${i.type} «${i.course}» ${i.date} ${i.time}` : `${i.type} «${i.name}» [${i.days.join(',')}] ${i.start}–${i.end}`).join(' + ');
    case 'pregunta': return `pregunta (${faltaDe(r)}): «${r.texto}»`;
    case 'except': return r.exs.map(x => `${x.libre ? 'libera' + (x.ref ? ' ' + x.ref : '') : 'ocupa'} ${x.date} ${x.start}–${x.end}${x.label ? ` «${x.label}»` : ''}`).join(' + ');
    case 'log': return `anota ${r.min} min de ${r.evalId} el ${r.date}`;
    case 'agenda': return `agenda del ${r.date}`;
    case 'aviso': return `dice: «${r.texto}»`;
    case 'cambiaEval': return `cambia ${r.evalId} al ${r.date || '(misma fecha)'} ${r.time || '(misma hora)'}`;
    case 'quitaEval': return `quita la evaluación ${r.evalId}`;
    case 'quitaEvento': return `quita el evento ${r.exId} del ${r.date}`;
    case 'quitaRutina': return `quita la rutina ${r.ids.join(', ')}`;
    default: return r.intent;
  }
}

// Sin IA, una respuesta corta («a las 6 de la tarde») completa el borrador de la pregunta anterior, como en la app.
export function reglasConCharla(f, s, n) {
  const yo = (f.historial || []).filter(h => h.de === 'yo').at(-1);
  if (yo) { const antes = L.interpret(yo.texto, s, n); if (antes.intent === 'pregunta') { const r = L.respuestaBorrador({ ...antes.borrador }, f.frase, s, n); if (r) return r; } }
  return L.interpret(f.frase, s, n);
}

// ---------- Una frase ----------
export async function evaluarFrase(f, { fetch = globalThis.fetch, clave, modelo = MODELO, tiempo = TIEMPO_GEMINI, soloReglas = false, pedir = null } = {}) {
  const s = estadoEval(), n = ahoraLocal();
  const reglas = reglasConCharla(f, s, n);
  const base = { id: f.id, frase: f.frase, reglas: revisar(f.espera, { r: reglas, origen: 'reglas', ia: null }), resumenReglas: resumir(reglas), vaIA: L.pideIA(reglas) };
  if (soloReglas) return base;
  const pedido = leerPedido(JSON.stringify({ mensaje: f.frase, historial: f.historial || [], contexto: contextoEval(s) }));
  if (pedido.error) throw new Error(`La frase ${f.id} no pasa leerPedido()`);
  const t0 = Date.now();
  const g = pedir ? await pedir({ fetch }, pedido, { tiempo }) : await pedirGemini({ fetch }, modelo, clave, pedido, { tiempo });
  const ms = Date.now() - t0;
  if (g.error) return { ...base, ms, error: g.error, httpStatus: g.httpStatus || null, soloIA: false, conRespaldo: base.reglas, origen: 'reglas', resumenIA: `(error: ${g.error})` };
  const v = L.validarIA(g.respuesta, s, n), ia = g.respuesta.intent, faltaIA = g.respuesta.falta || null;
  // Como en la app: primero las reglas (pideIA). La IA responde solo si las reglas no entienden y si su propuesta,
  // revisada, deja algo útil. Gemini se consulta igual en todas las frases para informar «Solo la IA».
  const usaIA = L.pideIA(reglas) && v.intent !== 'help';
  return {
    ...base, ms, error: null, uso: g.uso, formato: g.formato, ia, respuesta: g.respuesta, resumenIA: resumir(v),
    soloIA: revisar(f.espera, { r: v, origen: 'ia', ia, faltaIA }),
    conRespaldo: usaIA ? revisar(f.espera, { r: v, origen: 'ia', ia, faltaIA }) : base.reglas,
    origen: usaIA ? 'ia' : 'reglas',
  };
}

// ---------- Informe ----------
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0) + ' %';
const percentil = (xs, p) => { const o = [...xs].sort((a, b) => a - b); return o.length ? o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)] : 0; };
export function informe(res, { modelo, meta, soloReglas }) {
  const n = res.length, cuenta = k => res.filter(r => r[k]).length;
  const lineas = [];
  if (soloReglas) {
    lineas.push(`Solo las reglas (sin Gemini): ${cuenta('reglas')}/${n} (${pct(cuenta('reglas'), n)})`);
    lineas.push(`Van a la IA (las reglas no entienden): ${res.filter(r => r.vaIA).length} (${res.filter(r => r.vaIA).map(r => r.id).join(', ') || 'ninguna'})`);
    return { lineas, aprueba: true };
  }
  const ok = cuenta('conRespaldo'), vanIA = res.filter(r => r.vaIA), errores = res.filter(r => r.error), esquema = errores.filter(r => ['esquema', 'larga', 'bloqueado', 'vacia'].includes(r.error));
  const empeora = res.filter(r => r.reglas && !r.conRespaldo), ms = res.filter(r => r.ms !== undefined).map(r => r.ms);
  const tok = k => { const xs = res.map(r => r.uso && r.uso[k]).filter(x => typeof x === 'number'); return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0; };
  const aprueba = ok / n >= meta && esquema.length === 0;
  lineas.push(`Modelo ${modelo} · ${n} frases · contexto del lunes 26 de octubre de 2026`);
  lineas.push(`Lo que ve la persona (reglas, y la IA si las reglas no entienden): ${ok}/${n} (${pct(ok, n)}) · meta ${pct(meta * 100, 100)}: ${aprueba ? 'CUMPLE' : 'NO CUMPLE'}`);
  lineas.push(`Solo la IA: ${cuenta('soloIA')}/${n} (${pct(cuenta('soloIA'), n)}) · Solo las reglas (hoy): ${cuenta('reglas')}/${n} (${pct(cuenta('reglas'), n)})`);
  lineas.push(`Van a la IA (las reglas no entienden): ${vanIA.length} · la IA acierta en ${vanIA.filter(r => r.conRespaldo).length}`);
  lineas.push(`Peor que las reglas: ${empeora.length}${empeora.length ? ' (' + empeora.map(r => r.id).join(', ') + ')' : ''}`);
  lineas.push(`Respuestas que no siguen el esquema: ${esquema.length} · Otros errores de Gemini: ${errores.length - esquema.length}${errores.length ? ' (' + errores.map(r => `${r.id}: ${r.error}`).join(', ') + ')' : ''}`);
  lineas.push(`Tiempo del modelo: mediana ${percentil(ms, 50)} ms · 95 % ≤ ${percentil(ms, 95)} ms (meta: 2000 y 5000 ms)`);
  lineas.push(`Tokens por frase (promedio): entrada ${tok('promptTokenCount')} · salida ${tok('candidatesTokenCount')} · razonamiento ${tok('thoughtsTokenCount')}`);
  return { lineas, aprueba };
}

// ---------- Programa ----------
async function main() {
  const op = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
  const soloReglas = !!op['solo-reglas'];
  const nombre = String(op.proveedor || 'gemini').toLowerCase();
  if (!PROVEEDORES[nombre]) { console.error(`No conozco el proveedor «${nombre}». Usa: ${Object.keys(PROVEEDORES).join(', ')}.`); process.exit(2); }
  const P = PROVEEDORES[nombre];
  const env = k => (k === 'IA_PROVEEDOR' ? nombre : k === P.modelo && op.modelo ? String(op.modelo) : process.env[k]);
  const prov = proveedorDe(env), clave = prov.clave;
  if (!soloReglas && !clave) {
    console.error(`Falta la clave. Ejecútalo así (PowerShell): $env:${P.clave}="tu-clave"; node pruebas/ia/evaluar.mjs${nombre === 'gemini' ? '' : ' --proveedor=' + nombre}\nO sin modelo, solo con las reglas: node pruebas/ia/evaluar.mjs --solo-reglas`);
    process.exit(2);
  }
  const modelo = prov.modelo, pausa = Number(op.pausa || PAUSA[nombre]), meta = Number(op.meta || 0.9);
  let frases = cargarFrases();
  if (op.solo) { const ids = String(op.solo).split(','); frases = frases.filter(f => ids.includes(f.id)); }
  console.log(soloReglas ? `Reglas · ${frases.length} frases\n` : `${nombre === 'gemini' ? 'Gemini' : nombre} ${modelo} · ${frases.length} frases · una cada ${pausa / 1000} s (unos ${Math.ceil((frases.length * (pausa + 1000)) / 60000)} min)\n`);
  const res = [];
  let seguidos400 = 0;
  for (const [i, f] of frases.entries()) {
    let r;
    for (let intento = 0; ; intento++) {
      r = await evaluarFrase(f, { clave, modelo, soloReglas, pedir: prov.pedir });
      if (r.error !== 'limite' || intento === 3) break;
      console.log('  El proveedor pide esperar (límite por minuto del nivel gratuito): sigo en 60 s…');
      await new Promise(ok => setTimeout(ok, 60000));
    }
    if (r.error === 'clave') { console.error(`El proveedor rechazó la clave (401 o 403). Revisa ${P.clave}.`); process.exit(2); }
    seguidos400 = ['gemini_400', 'proveedor_400'].includes(r.error) ? seguidos400 + 1 : 0;
    if (seguidos400 === 3) { console.error(`El proveedor rechaza los pedidos (400). ¿Existe el modelo «${modelo}» y admite salida JSON estricta?`); process.exit(2); }
    res.push(r);
    const marca = soloReglas ? (r.reglas ? '✓' : '✗') : (r.conRespaldo ? '✓' : '✗');
    console.log(`${marca} ${r.id.padEnd(12)} ${soloReglas ? '' : `reglas ${r.reglas ? '✓' : '✗'}  ${String(r.ms).padStart(5)} ms  `}${r.frase}`);
    if ((soloReglas ? !r.reglas : !r.conRespaldo)) {
      console.log(`    espera: ${JSON.stringify(f.espera)}`);
      if (!soloReglas) console.log(`    IA: ${r.resumenIA}${r.origen === 'reglas' ? ' → la app usó las reglas' : ''}`);
      console.log(`    reglas: ${r.resumenReglas}`);
      if (op.detalle && r.respuesta) console.log(`    Modelo: ${JSON.stringify(r.respuesta)}`);
    }
    if (!soloReglas && i < frases.length - 1) await new Promise(ok => setTimeout(ok, pausa));
  }
  const { lineas, aprueba } = informe(res, { modelo, meta, soloReglas });
  console.log('\n' + lineas.join('\n'));
  if (op.salida) { writeFileSync(String(op.salida), JSON.stringify({ proveedor: nombre, modelo, fecha: new Date().toISOString(), resultados: res }, null, 2)); console.log(`\nGuardé el detalle en ${op.salida}.`); }
  process.exit(aprueba ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e); process.exit(1); });
