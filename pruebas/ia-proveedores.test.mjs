// lia-ia con otro proveedor (Groq, Cerebras, OpenRouter: API compatible con OpenAI), con Supabase y el proveedor simulados.
// Gemini sigue siendo el de siempre si no se configura IA_PROVEEDOR. Plan del 31-oct (sección 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../supabase/functions/lia-ia/logica.js';

const PROD = 'https://lia-prototipo.jaime-ramos-93c.workers.dev';
const pedidoBase = () => ({
  mensaje: 'el lunes me toca chamba hasta las 10 de la noche',
  historial: [],
  contexto: { ahora: '2026-10-26T17:58:00-05:00', despierto: '06:30', duermo: '23:30', evaluaciones: [], compromisos: [{ id: 'c1', nombre: 'Trabajo', tipo: 'trabajo', dias: [1, 2, 3, 4, 5], inicio: '15:00', fin: '19:00' }] },
});
// Lo que devuelve un modelo con esquema estricto: todos los campos, los que no aplican en null.
const estricta = {
  intent: 'except', texto: 'Anoto que el lunes trabajas hasta las 22:00.', evaluaciones: null, compromisos: null,
  cambios: [{ fecha: '2026-11-02', inicio: '19:00', fin: '22:00', motivo: 'Trabajo (más tarde)', libera: false, compromisoId: null }],
  estudio: null, falta: null, fecha: null,
};
const completions = (obj, extra = {}) => ({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(obj) }, finish_reason: 'stop', ...extra }], usage: { prompt_tokens: 2600, completion_tokens: 90, completion_tokens_details: { reasoning_tokens: 40 } } });

function entorno({ env = {}, resp } = {}) {
  const llamadas = [], logs = [];
  const deps = {
    env: k => ({ SUPABASE_URL: 'https://proyecto.supabase.co', SUPABASE_ANON_KEY: 'anon', ...env })[k],
    log: d => logs.push(d), tiempo: 200,
    fetch: async (url, op) => {
      if (url.includes('/rest/v1/rpc/usar_ia')) return new Response(JSON.stringify({ permitido: true, motivo: null, restantes_dia: 24, restantes_mes: 299 }));
      llamadas.push({ url, headers: op.headers, body: JSON.parse(op.body) });
      return resp(op);
    },
  };
  return { deps, llamadas, logs };
}
const pedir = (deps, cuerpo = pedidoBase()) => F.manejar(new Request('https://x/functions/v1/lia-ia', {
  method: 'POST', headers: { origin: PROD, authorization: 'Bearer token', apikey: 'anon', 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
}), deps);

test('sin IA_PROVEEDOR sigue Gemini; con uno desconocido, no responde', () => {
  assert.equal(F.proveedorDe(k => ({ GEMINI_API_KEY: 'g' })[k]).nombre, 'gemini');
  const groq = F.proveedorDe(k => ({ IA_PROVEEDOR: 'Groq', GROQ_API_KEY: 'k' })[k]);
  assert.deepEqual([groq.nombre, groq.modelo, groq.clave], ['groq', 'openai/gpt-oss-120b', 'k']);
  assert.equal(F.proveedorDe(k => ({ IA_PROVEEDOR: 'groq', GROQ_MODELO: 'openai/gpt-oss-20b' })[k]).modelo, 'openai/gpt-oss-20b');
  assert.equal(F.proveedorDe(k => ({ IA_PROVEEDOR: 'otro' })[k]), null);
});

test('esquema estricto: todo obligatorio, sin campos extra y lo opcional acepta null', () => {
  const e = F.esquemaEstricto();
  const revisar = (n, ruta) => {
    if (n.properties) {
      assert.equal(n.additionalProperties, false, ruta);
      assert.deepEqual(n.required, Object.keys(n.properties), ruta);
      for (const [k, v] of Object.entries(n.properties)) revisar(v, `${ruta}.${k}`);
    }
    if (n.items) revisar(n.items, ruta + '[]');
    for (const k of ['format', 'minimum', 'maximum', 'minItems', 'maxItems']) assert.equal(k in n, false, `${ruta} sin ${k}`);
  };
  revisar(e, 'raíz');
  assert.equal(e.properties.intent.type, 'string', 'intent sigue obligatorio y sin null');
  assert.deepEqual(e.properties.falta.type, ['string', 'null']);
  assert.ok(e.properties.falta.enum.includes(null));
  assert.deepEqual(e.properties.evaluaciones.type, ['array', 'null']);
  assert.equal(e.properties.evaluaciones.items.properties.tipo.type, 'string', 'el tipo de una evaluación es obligatorio');
  assert.deepEqual(e.properties.evaluaciones.items.properties.curso.type, ['string', 'null']);
});

test('con Groq: pide a chat/completions con su clave y JSON estricto, y responde igual que con Gemini', async () => {
  const { deps, llamadas, logs } = entorno({ env: { IA_PROVEEDOR: 'groq', GROQ_API_KEY: 'clave-groq-de-prueba' }, resp: () => new Response(JSON.stringify(completions(estricta))) });
  const res = await pedir(deps), cuerpo = await res.json();
  assert.equal(res.status, 200);
  assert.equal(llamadas.length, 1);
  const ll = llamadas[0];
  assert.equal(ll.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(ll.headers.Authorization, 'Bearer clave-groq-de-prueba');
  assert.equal(ll.body.model, 'openai/gpt-oss-120b');
  assert.equal(ll.body.reasoning_effort, 'low');
  assert.deepEqual([ll.body.response_format.type, ll.body.response_format.json_schema.strict], ['json_schema', true]);
  assert.deepEqual(ll.body.messages.map(m => m.role), ['system', 'user']);
  assert.match(ll.body.messages[1].content, /MENSAJE\nel lunes me toca chamba/);
  // Los null del esquema estricto no llegan a la app.
  assert.deepEqual(cuerpo.respuesta, { intent: 'except', texto: 'Anoto que el lunes trabajas hasta las 22:00.', cambios: [{ fecha: '2026-11-02', inicio: '19:00', fin: '22:00', motivo: 'Trabajo (más tarde)', libera: false }] });
  assert.equal(cuerpo.modelo, 'openai/gpt-oss-120b');
  // El registro dice proveedor, modelo y tokens; nunca el texto del mensaje.
  const log = logs.at(-1);
  assert.deepEqual([log.proveedor, log.modelo, log.tokens.entrada, log.tokens.salida, log.tokens.razonamiento], ['groq', 'openai/gpt-oss-120b', 2600, 90, 40]);
  assert.ok(!JSON.stringify(logs).includes('chamba'));
  assert.ok(!JSON.stringify(logs).includes('clave-groq'));
});

test('con Groq: errores del proveedor', async () => {
  const casos = [
    [() => new Response('{}', { status: 429 }), 503, 'ocupado', 'limite'],
    [() => new Response('{}', { status: 401 }), 503, 'ocupado', 'clave'],
    [() => new Response('{"error":{"message":"json_schema not supported"}}', { status: 400 }), 503, 'ocupado', 'proveedor_400'],
    [() => new Response(JSON.stringify(completions(estricta, { finish_reason: 'length' }))), 502, 'respuesta', 'larga'],
    [() => new Response(JSON.stringify(completions({ intent: 'inventada', texto: 'x' }))), 502, 'respuesta', 'esquema'],
    [() => new Response(JSON.stringify({ choices: [{ message: { content: 'no es json' }, finish_reason: 'stop' }] })), 502, 'respuesta', 'esquema'],
    [op => new Promise((_, no) => op.signal.addEventListener('abort', () => no(new Error('abort')))), 503, 'ocupado', 'tiempo'],
  ];
  for (const [resp, status, error, detalle] of casos) {
    const { deps, logs } = entorno({ env: { IA_PROVEEDOR: 'groq', GROQ_API_KEY: 'k' }, resp });
    const res = await pedir(deps);
    assert.equal(res.status, status, detalle);
    assert.equal((await res.json()).error, error, detalle);
    assert.equal(logs.at(-1).detalle, detalle);
  }
});

test('sin la clave del proveedor elegido, no llama a nadie', async () => {
  for (const env of [{ IA_PROVEEDOR: 'groq', GEMINI_API_KEY: 'g' }, { IA_PROVEEDOR: 'no-existe', GEMINI_API_KEY: 'g' }]) {
    const { deps, llamadas } = entorno({ env, resp: () => { throw new Error('no debía llamar'); } });
    const res = await pedir(deps);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'sin_clave');
    assert.equal(llamadas.length, 0);
  }
});

test('Cerebras y OpenRouter usan su dirección y su modelo', () => {
  assert.equal(F.PROVEEDORES.cerebras.url, 'https://api.cerebras.ai/v1/chat/completions');
  assert.equal(F.PROVEEDORES.openrouter.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(F.cuerpoCompatible(pedidoBase(), 'qwen-3-32b').reasoning_effort, undefined, 'reasoning_effort solo para gpt-oss');
});
