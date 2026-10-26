// Carga la lógica de LIA (el bloque entre /*LOGIC-START*/ y /*LOGIC-END*/ de index.html)
// para probar el motor de horarios y la lectura de frases sin abrir el navegador.
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bloque = html.match(/\/\*LOGIC-START\*\/([\s\S]*?)\/\*LOGIC-END\*\//);
if (!bloque) throw new Error('No encontré el bloque de lógica en index.html');
const nombres = [...bloque[1].matchAll(/^(?:function\s+([\w$]+)|const\s+([\w$]+)\s*=)/gm)].map(m => m[1] || m[2]);
export const L = new Function(`${bloque[1]}\nreturn {${nombres.join(',')}};`)();

// Estado mínimo con los ajustes por defecto de la app.
export function estado({ compromisos = [], evaluaciones = [], hechos = [], excepciones = [], ajustes = {} } = {}) {
  return {
    v: 1,
    settings: { wake: '07:00', sleep: '23:00', maxDay: 180, block: 60, minBlock: 30, autonomy: 'auto', name: '', ...ajustes },
    commitments: compromisos.map((c, i) => ({ id: 'c' + i, type: 'trabajo', ...c })),
    evals: evaluaciones.map((e, i) => ({ id: 'e' + i, type: 'parcial', time: '09:00', hours: 5, ...e })),
    done: hechos,
    exceptions: excepciones,
  };
}

// Hora local. Por defecto, lunes 26 de octubre de 2026 a las 10:00.
export const ahora = (dia = 26, h = 10, mi = 0) => new Date(2026, 9, dia, h, mi);
export const LUN_A_VIE = [1, 2, 3, 4, 5];
export const minutos = p => p.blocks.reduce((a, b) => a + b.e - b.s, 0);
export const faltan = p => Object.values(p.unmet).reduce((a, b) => a + b, 0);
export const choca = (bloques, fecha, s, e) => bloques.some(b => b.date === fecha && b.s < e && b.e > s);
