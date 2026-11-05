// Recordatorios por WhatsApp de toda la agenda (iteración 3, docs/iteracion-3.md sección 2 y docs/canales.md): estudio,
// clases y eventos o rutinas 15 minutos antes y evaluaciones 2 horas antes (eso lo decide tomar_avisos_whatsapp(),
// probada en pruebas/sql/recordatorios.sql.mjs). Aquí, el texto de cada tipo y el envío desde pg_cron, con o sin la
// plantilla Utility. Supabase y Meta simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import * as W from '../supabase/functions/lia-whatsapp/logica.js';

const NUM = '51987654321';
// Lunes 2 de noviembre de 2026 en Lima: 13:00 es 18:00 en UTC.
const FILAS = [
  { numero: NUM, titulo: 'Estudiar Cálculo II', inicio: '2026-11-02T23:00:00Z', fin: '2026-11-03T01:00:00Z', tipo: 'estudio' },
  { numero: NUM, titulo: 'Parcial de Física', inicio: '2026-11-03T14:00:00Z', fin: '2026-11-03T15:00:00Z', tipo: 'evaluacion' },
  { numero: NUM, titulo: 'Clase de Química', inicio: '2026-11-02T15:00:00Z', fin: '2026-11-02T17:00:00Z', tipo: 'clase' },
  { numero: NUM, titulo: 'Almuerzo', inicio: '2026-11-02T18:00:00Z', fin: '2026-11-02T19:30:00Z', tipo: 'otro' },
];

function cron({ env = {}, filas = FILAS, metaFalla = 0 } = {}) {
  const enviados = [], logs = [], llamadas = [];
  const E = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv', WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '123', ...env };
  let fallas = metaFalla;
  const deps = {
    env: k => E[k], log: d => logs.push(d), crypto: webcrypto, ahora: () => new Date('2026-11-02T17:45:00Z'),
    fetch: async (url, op) => {
      const body = op.body ? JSON.parse(op.body) : null;
      if (url.includes('graph.facebook.com')) { enviados.push(body); return fallas-- > 0 ? new Response('{"error":{"code":131047}}', { status: 400 }) : new Response('{}'); }
      const fn = url.split('/rpc/')[1];
      llamadas.push(fn);
      return new Response(JSON.stringify(fn === 'avisos_cron_ok' ? true : fn === 'tomar_avisos_whatsapp' ? filas : null));
    },
  };
  const correr = async () => (await W.manejar(new Request('https://x/lia-whatsapp', { method: 'POST', headers: { 'x-lia-cron': 's' }, body: '{"accion":"avisos"}' }), deps)).json();
  return { deps, enviados, logs, llamadas, correr };
}

test('textoAviso: estudio y evaluaciones como antes; clases y eventos dicen qué empieza y hasta qué hora', () => {
  const [estudio, evaluacion, clase, otro] = FILAS.map(W.textoAviso);
  assert.equal(estudio, 'Hola, soy Lía. A las 18:00 empieza tu sesión: Estudiar Cálculo II (hasta las 20:00). Escribe «pausa» si no quieres estos avisos.');
  assert.equal(evaluacion, 'Hola, soy Lía. A las 09:00 tienes Parcial de Física. ¡Éxitos!');
  assert.equal(clase, 'Hola, soy Lía. A las 10:00 empieza: Clase de Química (hasta las 12:00). Escribe «pausa» si no quieres estos avisos.');
  assert.equal(otro, 'Hola, soy Lía. A las 13:00 empieza: Almuerzo (hasta las 14:30). Escribe «pausa» si no quieres estos avisos.');
  assert.match(W.textoAviso({ ...FILAS[3], tipo: 'raro' }), /A las 13:00 empieza: Almuerzo/, 'un tipo desconocido, como «otro»');
});

test('pg_cron: sin plantilla, cada aviso va como texto (llega si la persona escribió en las últimas 24 horas)', async () => {
  const c = cron();
  assert.deepEqual(await c.correr(), { ok: true, enviados: 4 });
  assert.deepEqual(c.enviados.map(e => [e.to, e.type]), FILAS.map(() => [NUM, 'text']));
  assert.match(c.enviados[3].text.body, /A las 13:00 empieza: Almuerzo \(hasta las 14:30\)/);
  assert.match(c.enviados[2].text.body, /A las 10:00 empieza: Clase de Química/);
});

test('pg_cron: con la plantilla Utility, todos los tipos van como plantilla con la hora y lo que toca', async () => {
  const c = cron({ env: { WHATSAPP_PLANTILLA: 'recordatorio_lia' } });
  assert.deepEqual(await c.correr(), { ok: true, enviados: 4 });
  assert.ok(c.enviados.every(e => e.type === 'template' && e.template.name === 'recordatorio_lia' && e.template.language.code === 'es'));
  assert.deepEqual(c.enviados.map(e => e.template.components[0].parameters.map(p => p.text)),
    [['18:00', 'Estudiar Cálculo II'], ['09:00', 'Parcial de Física'], ['10:00', 'Clase de Química'], ['13:00', 'Almuerzo']]);
});

test('pg_cron: si Meta no entrega (fuera de 24 h sin plantilla), lo cuenta sin números ni títulos en el registro', async () => {
  const c = cron({ metaFalla: 2 });
  assert.deepEqual(await c.correr(), { ok: true, enviados: 2 });
  const log = c.logs.at(-1);
  assert.deepEqual([log.avisos, log.enviados, log.errores], [4, 2, [400, 400]]);
  const t = JSON.stringify(c.logs);
  assert.ok(!t.includes(NUM) && !t.includes('Almuerzo') && !t.includes('Química'), t);
});

test('vincular y «avisos» dicen que avisa de cada actividad, no solo del estudio', async () => {
  const llega = async (texto, rpc) => {
    const enviados = [];
    const deps = { env: k => ({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv', WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '123', WHATSAPP_APP_SECRET: 's' })[k], log: () => {}, crypto: webcrypto,
      fetch: async (url, op) => { if (url.includes('graph.facebook.com')) { enviados.push(JSON.parse(op.body)); return new Response('{}'); } return new Response(JSON.stringify(rpc[url.split('/rpc/')[1]] ?? null)); } };
    const c = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: NUM, type: 'text', text: { body: texto } }] } }] }] });
    await W.manejar(new Request('https://x', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', 's').update(c).digest('hex') }, body: c }), deps);
    return enviados[0].text.body;
  };
  assert.match(await llega('LIA 123456', { vincular_whatsapp: true }), /Te aviso 15 minutos antes de cada actividad y 2 horas antes de cada evaluación\./);
  assert.match(await llega('avisos', { whatsapp_estado: { avisos: false, pro: false, contexto: null, propuesta: null, confirmadas: 0 } }), /te vuelvo a avisar antes de cada actividad y evaluación/);
});
