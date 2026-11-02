// Saludos y charla: «hola», «gracias», «ok», «chau», «¿quién eres?», «¿qué puedes hacer?», «estoy cansado».
// Lía responde corto, sin la IA, y solo cuando el mensaje no trae nada más. Plan del 31-oct (P0: «Lía que no falla»).
// Hoy, en estas pruebas, es lunes 26 de octubre de 2026 a las 10:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { L, estado, ahora, LUN_A_VIE } from './logica.mjs';

const s = estado({ compromisos: [{ name: 'Trabajo', type: 'trabajo', days: LUN_A_VIE, start: '08:00', end: '13:00' }], evaluaciones: [{ course: 'Cálculo', date: '2026-10-30' }] });
const leer = f => L.interpret(f, s, ahora());

test('mensajes sociales: cada uno con su tipo y sin pasar a la IA', () => {
  const cases = {
    saludo: ['hola', 'Hola Lía!', 'holaa', 'buenos días', 'buenas noches', '¿cómo estás?', 'qué tal'],
    gracias: ['gracias', 'muchas gracias lía', 'ok gracias', 'mil gracias por todo'],
    ok: ['ok', 'listo', 'perfecto', 'ya', 'sí', 'todo bien', 'dale'],
    despedida: ['chau', 'adiós', 'nos vemos', 'hasta mañana'],
    quien: ['¿quién eres?', '¿eres un bot?', 'cómo te llamas'],
    ayuda: ['¿qué puedes hacer?', 'ayuda', 'hola, ¿qué puedes hacer?', 'cómo funcionas'],
    animo: ['estoy cansado', 'estoy muy estresada', 'no tengo ganas de estudiar', 'qué flojera'],
  };
  for (const [tipo, frases] of Object.entries(cases))
    for (const f of frases) {
      const r = leer(f);
      assert.deepEqual(r, { intent: 'charla', tipo }, f);
      assert.equal(L.pideIA(r), false, f);
    }
});

test('si el mensaje trae algo más, se lee como siempre', () => {
  const ev = leer('hola lía, tengo examen de cálculo el viernes a las 9');
  assert.equal(ev.intent, 'add');
  assert.deepEqual([ev.items[0].course, ev.items[0].date, ev.items[0].time], ['Cálculo', '2026-10-30', '09:00']);
  assert.equal(leer('ya estudié 2 horas de cálculo').intent, 'log');
  assert.deepEqual(leer('hola, ¿qué tengo mañana?'), { intent: 'agenda', date: '2026-10-27' });
  assert.equal(leer('que hay para el sábado').intent, 'agenda');
  assert.equal(leer('estoy ocupado el sábado').intent, 'except');
  // Lo que no es social ni se entiende sigue yendo a la ayuda (y, en Pro, a la IA).
  for (const f of ['no', 'ayuda con mi horario de la otra semana que no sé', 'asdfgh']) assert.equal(leer(f).intent, 'help', f);
});

test('«ok» o «gracias» como respuesta a una pregunta de Lía no completan nada', () => {
  const r = leer('tengo examen de cálculo el viernes');
  assert.equal(r.intent, 'pregunta');
  const b = { ...r.borrador, at: ahora().getTime() };
  for (const f of ['ok', 'gracias']) assert.equal(L.respuestaBorrador(b, f, s, ahora()), null, f);
});
