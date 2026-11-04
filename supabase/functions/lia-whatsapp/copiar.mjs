// LIA · genera las copias que lia-whatsapp necesita para entender igual que la app (docs/whatsapp-lia.md):
//   - reglas.js: el bloque LOGIC de index.html (interpret, validarIA, preguntaPara…), como módulo.
//   - ia.js: copia exacta de supabase/functions/lia-ia/logica.js (proveedores, instrucciones y esquema de la IA).
// Una sola fuente de verdad: no edites las copias. Cambia index.html o lia-ia/logica.js y corre
//   node supabase/functions/lia-whatsapp/copiar.mjs
// pruebas/whatsapp-copias.test.mjs falla si alguna copia quedó vieja.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raiz = new URL('../../../', import.meta.url);
const AVISO = '// GENERADO por supabase/functions/lia-whatsapp/copiar.mjs. No lo edites: cambia el original y vuelve a correrlo.\n';

export function generar() {
  const html = readFileSync(new URL('index.html', raiz), 'utf8').replace(/\r\n/g, '\n');
  const m = html.match(/\/\*LOGIC-START\*\/([\s\S]*?)\/\*LOGIC-END\*\//);
  if (!m) throw new Error('No encontré el bloque LOGIC en index.html');
  const nombres = [...m[1].matchAll(/^(?:function\s+([\w$]+)|const\s+([\w$]+)\s*=)/gm)].map(x => x[1] || x[2]);
  const reglas = `${AVISO}// Origen: el bloque entre /*LOGIC-START*/ y /*LOGIC-END*/ de index.html.\nfunction crear() {\n${m[1]}\nreturn { ${nombres.join(', ')} };\n}\nexport const L = crear();\n`;
  const ia = AVISO + '// Origen: supabase/functions/lia-ia/logica.js.\n'
    + readFileSync(new URL('supabase/functions/lia-ia/logica.js', raiz), 'utf8').replace(/\r\n/g, '\n');
  return { 'reglas.js': reglas, 'ia.js': ia };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [nombre, texto] of Object.entries(generar())) {
    writeFileSync(new URL(nombre, import.meta.url), texto);
    console.log(`Escribí supabase/functions/lia-whatsapp/${nombre} (${texto.length} caracteres)`);
  }
}
