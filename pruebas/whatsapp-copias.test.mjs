// Lía en WhatsApp (docs/whatsapp-lia.md): lia-whatsapp entiende con copias generadas de las reglas de la app
// (bloque LOGIC de index.html) y de la lógica de la IA (lia-ia/logica.js). Si una copia queda vieja, WhatsApp
// entendería distinto que la app: estas pruebas lo impiden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generar } from '../supabase/functions/lia-whatsapp/copiar.mjs';
import { L as Lapp } from './logica.mjs';
import { L as Lserv } from '../supabase/functions/lia-whatsapp/reglas.js';
import * as IAapp from '../supabase/functions/lia-ia/logica.js';
import * as IAserv from '../supabase/functions/lia-whatsapp/ia.js';
import { estadoEval, ahoraLocal, cargarFrases } from './ia/evaluar.mjs';

const dir = new URL('../supabase/functions/lia-whatsapp/', import.meta.url);

test('las copias de lia-whatsapp están al día (si falla: node supabase/functions/lia-whatsapp/copiar.mjs)', () => {
  for (const [nombre, texto] of Object.entries(generar())) {
    assert.equal(readFileSync(new URL(nombre, dir), 'utf8').replace(/\r\n/g, '\n'), texto, `${nombre} no coincide con su original`);
  }
});

test('las reglas del servidor (módulo estricto) entienden las 105 frases igual que la app', () => {
  const s = estadoEval(), n = ahoraLocal();
  for (const f of cargarFrases()) {
    assert.deepEqual(JSON.parse(JSON.stringify(Lserv.interpret(f.frase, s, n))), JSON.parse(JSON.stringify(Lapp.interpret(f.frase, s, n))), f.id);
  }
});

test('la IA del servidor usa las mismas instrucciones, esquema y proveedores que lia-ia', () => {
  assert.equal(IAserv.INSTRUCCIONES, IAapp.INSTRUCCIONES);
  assert.deepEqual(IAserv.esquemaEstricto(), IAapp.esquemaEstricto());
  assert.deepEqual(Object.keys(IAserv.PROVEEDORES), Object.keys(IAapp.PROVEEDORES));
});
