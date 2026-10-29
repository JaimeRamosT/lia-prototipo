# Lía con IA (Gemini): plan y especificación

**Estado:** aprobado el 26 de octubre de 2026, con las decisiones de la sección final · **Ramas:** `docs/ia-gemini`, `feat/ia-cupo`, `feat/ia-funcion`, `feat/ia-chat`

## Resumen

- **Qué:** Lía entiende lo que la persona escribe, como lo diría a un amigo, y lo convierte en cambios del horario que la persona revisa antes de aplicarlos. Después, lo mismo con sílabos (fase 2) y notas de voz (fase 3).
- **Cómo:** la app llama a una Edge Function de Supabase (`lia-ia`). La función revisa la sesión y el cupo, llama a Gemini con la clave guardada como secreto y devuelve una intención con el mismo formato que hoy devuelve `interpret()`. Así la app reutiliza la confirmación y los cambios que ya existen.
- **Modelo:** `gemini-3.5-flash-lite`, estable y el más barato de los que Google recomienda para proyectos nuevos. Pasamos a `gemini-3.8-flash` solo si la evaluación no llega a la meta.
- **Nivel de Gemini:** gratuito (decisión del equipo: sin prepago). No cuesta nada, pero Google puede usar los mensajes para mejorar sus productos y los límites de uso son menores. El aviso de privacidad lo dice así. Pasar al nivel pagado solo exige activar la facturación en AI Studio y cambiar el texto del aviso.
- **Para quién:** solo LIA Pro, con 25 mensajes por día y 300 por mes. Gratis sigue con las reglas.

## Problema

Hoy Lía entiende frases con reglas (`interpret()`). Funciona sin internet y es rápida, pero solo entiende frases que siguen sus patrones: la auditoría del 25 de octubre encontró varias que fallaban, y cada caso nuevo exige una regla nueva. Cuando no entiende, responde con ejemplos, y la persona tiene que aprender a escribir "como Lía quiere". Además, el plan Pro promete cosas que las reglas no pueden dar: que Lía lea sílabos y que entienda notas de voz.

## Objetivos

| Objetivo | Meta | Cómo se mide |
|---|---|---|
| Lía entiende frases reales | ≥ 90 % de las frases del set de evaluación con la intención y los datos correctos | `pruebas/ia/evaluar.mjs` (se compara con las reglas como línea base) |
| Nada cambia sin control | 100 % de las respuestas pasan la validación; nada se aplica sin la confirmación que hoy pide la app | Pruebas unitarias y de navegador |
| Rapidez | Mediana ≤ 2 s; 95 % de las respuestas ≤ 5 s | Registros de la función |
| Costo | ≤ US$ 0.10 por Pro al mes | Uso en AI Studio y tabla `uso_ia` |
| Utilidad en el piloto | ≥ 80 % de las propuestas aceptadas sin corregir | Contador en la app (sin guardar el texto) |

## Fuera de alcance de la versión 1

- **La IA no arma ni reorganiza el horario.** Lo siguen haciendo `plan()` y `planCongelado()`, que son deterministas y tienen pruebas.
- **La IA no inventa datos del horario.** "¿Qué tengo mañana?", el progreso y la próxima evaluación se responden con los datos de la app; la IA solo reconoce qué se pregunta.
- **No es un chat de temas generales.** Fuera del horario y el estudio, Lía responde en una línea y vuelve al tema.
- **Gratis sin cuenta no usa IA.** Sigue con las reglas, que funcionan sin internet.
- **No se guardan conversaciones en el servidor.** Solo se cuenta cuántos mensajes usa cada cuenta por día.
- **Sílabos y voz** quedan para las fases 2 y 3.

## Historias de usuario

**Estudiante con LIA Pro**
1. Quiero escribir como hablo ("el lunes me toca chamba hasta las 10 de la noche") para que Lía cambie mi horario sin tener que aprender frases exactas.
2. Quiero ver qué entendió Lía antes de que cambie algo, para corregirlo si se equivocó.
3. Si me falta un dato, quiero que Lía me pregunte solo eso ("¿Para qué curso es la PC2?") en vez de mostrarme ejemplos.
4. Sin internet o si la IA falla, quiero que Lía siga entendiendo lo básico, para no quedarme sin ayuda.
5. (Fase 2) Quiero subir el sílabo en PDF o foto y que Lía me proponga las evaluaciones del ciclo.
6. (Fase 3) Quiero mandar una nota de voz en el camino y que Lía la entienda igual que un mensaje.

**Estudiante con LIA Gratis**
7. Quiero que Lía me siga entendiendo con las reglas de siempre, sin cuenta y sin internet, y saber que la IA es parte de Pro sin que me interrumpan con muros.

**Equipo de LIA**
8. Quiero un tope de gasto en Google y un cupo por cuenta, para que un error o un abuso no nos cueste más de lo previsto.

## Requisitos

### P0: fase 1 (Lía entiende con IA)

1. **Edge Function `lia-ia`.** Solo acepta cuentas con sesión (`verify_jwt`), mensajes de hasta 500 caracteres y pedidos de hasta 8 KB. Responde en JSON.
   - [ ] Sin sesión: 401. Con Gratis: 403 `solo_pro`. Sin cupo: 429 `cupo_dia` o `cupo_mes`. Gemini caído, saturado o sin responder en 12 s: 503 `ocupado`.
   - [ ] Solo acepta llamadas desde las direcciones de LIA (producción, vistas previas y `localhost`).
   - [ ] Los registros nunca guardan el texto del mensaje: solo estado, modelo, tokens, tiempo y, si Lía preguntó algo, qué dato faltaba (`falta`).
2. **Cupo por cuenta.** Tabla `uso_ia` (cuenta, día en hora de Lima, mensajes) y función SQL `usar_ia(p_sumar)`. Con `false` solo revisa que el plan sea Pro y que quede cupo; con `true` además suma el mensaje. La función la llama antes de pedirle a Gemini y suma solo si Gemini respondió, así un error no le gasta un mensaje a nadie.
   - [ ] Tope de 25 mensajes por día y 300 por mes, en hora de Lima.
   - [ ] La app solo puede leer su propia fila; nadie escribe en la tabla salvo `usar_ia()` (misma regla que `suscripciones` y `pagos`).
3. **Respuesta con esquema fijo.** Gemini responde con un JSON Schema que replica las intenciones de `interpret()`: `add` (evaluaciones y compromisos), `except` (un día ocupado o libre), `log` (lo que ya estudió), `agenda`, `progress`, `next`, `replan`, `aviso`, más `pregunta` (falta un dato) y `help`.
4. **Validación en la app.** Una función nueva en el bloque LOGIC (`validarIA()`) revisa cada campo antes de usarlo: tipos de evaluación y de compromiso conocidos, fechas y horas válidas y en un rango razonable, horas de estudio entre 0.5 y 40, días de la semana entre 0 y 6, identificadores que existan y textos de largo limitado. Si algo no cuadra, se descarta y se usan las reglas.
5. **Flujo en el chat.** Con Pro e internet, el mensaje va a la IA: "Lía está pensando…", luego la propuesta con las mismas confirmaciones de hoy (agregar pide confirmar; los cambios de un día respetan la opción de autonomía; "Deshacer" sigue igual). Sin internet, con error o sin cupo, se usan las reglas y Lía lo dice en una línea.
6. **Privacidad.** Antes del primer uso, un aviso: Lía envía el mensaje y un resumen del horario a Gemini, de Google, en Estados Unidos. Como usamos el nivel gratuito, el aviso dice que Google puede usar esos mensajes para mejorar sus productos y pide no escribir datos personales. La persona elige «Usar Lía con IA» o «Ahora no», y puede cambiarlo en Perfil. Se envía lo mínimo: fecha y hora actuales, cursos, evaluaciones y horario fijo. Nunca el correo ni el nombre.
7. **Bandera.** Todo entró a `main` apagado detrás de `?ia=1` (solo el equipo) mientras se evaluaba. Se quitó en la versión 0.5.1 (29 de octubre de 2026): la bandera se guardaba en cada navegador, así que no llegaba a la app instalada (en iPhone, esa app tiene su propio almacenamiento), y tampoco protegía nada, porque cualquiera podía escribir `?ia=1`. Lo que limita el uso es el cupo de `usar_ia()`.
8. **Sin gasto.** En el nivel gratuito Google no cobra. Si se llega a sus límites, Gemini responde 429 y la app sigue con las reglas.

### P1: poco después de la fase 1

- **Seguimiento corto:** la función recibe los últimos 6 mensajes, para entender respuestas como "el de Cálculo" después de una pregunta de Lía.
- **Mover o borrar una evaluación** ("el profe movió el parcial al otro jueves"): una intención nueva con su confirmación. Hoy `interpret()` no lo hace.
- **Panel del equipo:** consultas SQL de uso por día, sin datos personales.

### P2: diseñar pensando en esto, sin construirlo aún

- Sílabos (fase 2) y notas de voz (fase 3), descritos abajo.
- IA para Gratis con cuenta, con un cupo pequeño.
- Cloudflare AI Gateway delante de Gemini (caché, registros y límites), si el uso crece.
- Sincronizar el horario por cuenta (es otro proyecto).

## Diseño técnico

```
Teléfono (PWA en Cloudflare)
  chat ── sin Pro o sin internet ──► interpret() (reglas, en el teléfono)
    │
    └─ Pro + internet ── POST /functions/v1/lia-ia (JWT de la sesión) ──┐
                                                                          ▼
Supabase · Edge Function lia-ia (Deno)
  1. verify_jwt: solo cuentas con sesión
  2. usar_ia(): plan Pro y cupo del día (SQL)
  3. arma el pedido: instrucciones + esquema + contexto mínimo + mensaje
  4. llama a Gemini ─────────── x-goog-api-key (secreto GEMINI_API_KEY) ──► API de Gemini (Google)
  5. revisa el JSON y responde {intent, …, texto, restantes}
                                                                          │
App: validarIA() → "Lía entendió…" → confirmar → applyItems / aplicarCambio (lo de hoy) → plan()
```

### Dónde vive la clave y por qué

| | Edge Function de Supabase (elegida) | Worker de Cloudflare | Firebase AI Logic |
|---|---|---|---|
| Clave | Secreto de Supabase | Secreto del Worker | No hay clave en la app (App Check) |
| Plan y cupo | En la misma base (SQL) | Tendría que consultar Supabase en cada mensaje | Difícil de atar al plan de Supabase |
| Despliegue | La integración de GitHub ya despliega al integrar a `main` | El Worker hoy no tiene código; habría que agregarlo | Otra plataforma más |
| CSP | Sin cambios (`connect-src` ya permite Supabase) | Sin cambios (mismo origen) | Hay que permitir dominios de Google y reCAPTCHA |
| Gratis | 500 000 invocaciones al mes | 100 000 solicitudes al día | Plan Spark |

Supabase gana porque el cupo depende del plan, y el plan ya vive ahí. Coincide con lo decidido al elegir el hosting: el servidor es Supabase y Cloudflare solo sirve archivos.

### Contrato entre la app y la función

Pedido:

```json
POST https://lvtthltugrpbqjezwnsd.supabase.co/functions/v1/lia-ia
Authorization: Bearer <JWT de la sesión>
apikey: <clave publicable>

{
  "mensaje": "el lunes me toca chamba hasta las 10 de la noche",
  "historial": [{ "de": "lia", "texto": "¿Para qué curso es la PC2?" }],
  "contexto": {
    "ahora": "2026-10-26T16:13:00-05:00",
    "despierto": "06:30", "duermo": "23:30",
    "evaluaciones": [{ "id": "e1", "curso": "Cálculo II", "tipo": "parcial", "fecha": "2026-10-29", "hora": "09:00" }],
    "compromisos": [{ "id": "c1", "nombre": "Trabajo", "tipo": "trabajo", "dias": [1, 2, 3, 4, 5], "inicio": "15:00", "fin": "19:00" }]
  }
}
```

Respuesta. La IA responde en español y con campos propios; la app los revisa con `validarIA()` y los convierte en la intención que hoy usa `handleText()`:

```json
{
  "ok": true,
  "respuesta": {
    "intent": "except",
    "texto": "Anoto que el lunes trabajas hasta las 10 de la noche.",
    "cambios": [{ "fecha": "2026-11-02", "inicio": "19:00", "fin": "22:00", "motivo": "Trabajo (más tarde)", "libera": false, "compromisoId": "c1" }]
  },
  "restantes_dia": 24,
  "restantes_mes": 299,
  "modelo": "gemini-3.5-flash-lite"
}
```

Errores: 401 `sesion`, 403 `solo_pro`, 429 `cupo_dia` o `cupo_mes`, 400 `pedido`, 503 `ocupado` (Gemini saturado, caído o sin responder en 12 s), 502 `respuesta` (Gemini respondió algo que no cumple el esquema) y 503 `sin_clave` (falta el secreto). En todos, la app sigue con las reglas.

### Datos (migración nueva)

Archivo: `supabase/migrations/<versión>_cupo_ia.sql`.

- `uso_ia (user_id, dia, mensajes)`, con RLS: cada cuenta solo lee lo suyo y nadie escribe desde la app.
- `usar_ia(p_sumar boolean)` (security definer): usa `mi_suscripcion()` para saber si el plan es Pro (así aplica vencimientos y renovaciones igual que el resto), bloquea a la cuenta un instante para que dos mensajes a la vez no pasen el tope y devuelve `{permitido, motivo, restantes_dia, restantes_mes}`.

El asesor de seguridad marcará `usar_ia()` con el aviso 0029, igual que las cuatro funciones de las cuentas. Es a propósito: con ella cada cuenta solo puede gastar su propio cupo, y como mucho sumarse mensajes a sí misma.

### Cómo se le pide a Gemini

- **Modelo:** `gemini-3.5-flash-lite`, guardado en un secreto (`GEMINI_MODELO`) para cambiarlo sin tocar código.
- **Salida estructurada:** JSON Schema con las intenciones y sus campos. Los tipos de evaluación y de compromiso son los de `EVAL_TYPES` y `COMMIT_TYPES`; una prueba unitaria revisa que coincidan.
- **Razonamiento:** `thinkingConfig.thinkingLevel: "minimal"` (lo normal en Flash-Lite), para responder rápido.
- **Sin `temperature`:** Google la ignora en los modelos nuevos y anuncia que pronto dará error.
- **Instrucciones:** en español peruano, con tuteo y respuestas cortas. Las fechas se calculan desde "ahora", en hora de Lima, con un calendario de los próximos 21 días para no equivocarse de día de la semana. Nunca se inventan cursos, fechas ni horas que la persona no dijo: nada se guarda sin hora (decisión del 28-oct). Incluyen ejemplos con expresiones peruanas ("chamba", "PC2", "el otro jueves", "pasado mañana", "a las 9 de la noche").
- **Lía pide lo que falta (iteración 2):** las instrucciones traen lo que necesita cada cosa (evaluación: curso, fecha y hora; entrega: curso, fecha y hora en que vence; rutina: días, inicio y fin; algo de un solo día: fecha, inicio y fin; estudio hecho: evaluación y minutos). Si falta un dato, Gemini responde `pregunta`, pone en `falta` cuál es (`curso`, `fecha`, `hora`, `dias`, `horario`, `evaluacion` o `minutos`) y deja en `evaluaciones`, `compromisos`, `cambios` o `estudio` lo que ya entendió, sin inventar lo que falta. Por eso el esquema solo exige el tipo de cada cosa. «Fuera de tema» es solo para mensajes que no hablan de horarios, estudios ni rutinas.
- **En la app:** `validarIA()` guarda lo entendido como borrador (`state.borrador`, 10 minutos) y muestra la pregunta con respuestas rápidas que arma la app según el dato que falta (por ejemplo, «23:59 · Otra hora» para una entrega). Un toque completa el borrador sin otro mensaje con IA; una respuesta escrita se intenta leer primero con las reglas y, si no se entiende, va a la IA con la conversación reciente. Sin IA, las reglas (`interpret()`) usan la misma tabla.
- **Endpoint:** `POST /v1beta/models/{modelo}:generateContent` con `fetch`, sin SDK, y la clave en la cabecera `x-goog-api-key`. La salida va con `generationConfig.responseFormat.text` (`mimeType: APPLICATION_JSON` y `schema`); si la API no reconoce ese campo, la función reintenta una vez con los nombres anteriores (`responseMimeType` y `responseJsonSchema`).

### Seguridad

- La clave solo existe como secreto en Supabase (`GEMINI_API_KEY`), restringida a la API de Gemini en AI Studio. Nunca va en `config.js`, en el repositorio ni en el chat.
- El texto de la persona no es de confianza (puede intentar dar órdenes al modelo). Por eso la salida está atada al esquema, la app la valida y nada se aplica sin las confirmaciones de siempre. La función no tiene otras herramientas ni efectos además de sumar el cupo.
- Hay límites de tamaño y un cupo por día y por mes.
- La función solo responde a las direcciones de LIA (producción, vistas previas y `localhost`) y nunca escribe en sus registros el texto de los mensajes.

## Costos

**Hoy: US$ 0.** El equipo decidió usar el nivel gratuito de Gemini. A cambio, Google puede usar los mensajes para mejorar sus productos y los límites de uso son menores (se ven en AI Studio, por proyecto; los diarios se reinician a la medianoche del Pacífico).

**Si después se pasa al nivel pagado** (vincular facturación y prepagar desde US$ 5), esto es lo que costaría. Supuestos: 2 000 tokens de entrada (instrucciones, ejemplos, contexto y mensaje) y 250 de salida por mensaje; 60 mensajes por Pro al mes (el supuesto del modelo de costos en Notion); S/ 3.44 por US$. Precios al 26 de octubre de 2026.

| Modelo | Por mensaje | Pro al mes (60 mensajes) | Tope de 300 mensajes al mes |
|---|---|---|---|
| `gemini-3.5-flash-lite` (US$ 0.30 entrada / US$ 2.50 salida por millón) | US$ 0.0012 | US$ 0.07 (S/ 0.25) | US$ 0.37 (S/ 1.26) |
| `gemini-3.8-flash` hasta el 31 de diciembre de 2026 | US$ 0.0024 | US$ 0.15 (S/ 0.50) | US$ 0.73 (S/ 2.52) |
| `gemini-3.8-flash` desde enero de 2027 (el precio sube al doble) | US$ 0.0049 | US$ 0.29 (S/ 1.01) | US$ 1.46 (S/ 5.03) |

- **Sílabos (fase 2):** unos US$ 0.005 por sílabo con Flash-Lite; con 5 sílabos por ciclo, S/ 0.09 por ciclo.
- **Piloto (20 Pro × 60 mensajes):** unos US$ 1.50 al mes en el nivel pagado. El prepago mínimo de US$ 5 alcanzaría para unos 4 000 mensajes.
- **Modelo de costos:** con el nivel pagado, el costo de la IA bajaría de S/ 0.56 a unos S/ 0.27 por Pro al mes.
- **Antes de invitar a muchos estudiantes,** conviene revisar esta decisión: en el nivel pagado Google no usa los mensajes y los límites son mayores.

## Pruebas

| Capa | Qué se prueba | Herramienta |
|---|---|---|
| Lógica (unitarias) | `validarIA()`: cada campo, rangos, identificadores que no existen, textos largos o con HTML; cuándo se usa la IA y cuándo las reglas; que el contexto no lleve correo ni nombre; que los tipos coincidan con `EVAL_TYPES` y `COMMIT_TYPES` | `node --test` en `pruebas/` |
| Función | Respuesta correcta, JSON roto, 429 y 5xx de Gemini, tiempo agotado, sin cupo, sin sesión, origen no permitido, pedido demasiado grande | `node --test` con Gemini simulado (`pruebas/ia-funcion.test.mjs`; la lógica de la función está en `logica.js`, sin nada propio de Deno) |
| Navegador | Chat con IA (pensando, propuesta, confirmar, deshacer), sin internet → reglas, sin cupo, error → reglas, Gratis nunca llama a la función, sin bloqueos de la CSP | Playwright con la función simulada |
| Modelo real | Set de 60 a 100 frases (las de la auditoría, expresiones peruanas, frases ambiguas, temas ajenos e intentos de dar órdenes al modelo): exactitud por campo, JSON válido, tiempo y tokens; se compara con las reglas | `pruebas/ia/frases.json` (77 frases) y `pruebas/ia/evaluar.mjs`; `pruebas/ia-evaluar.test.mjs` revisa el set y la forma de calificar |

La evaluación con el modelo real se corre cada vez que cambian las instrucciones, el esquema o el modelo. Ni el contenedor de Claude ni la VM de la computadora llegan a Google ni a Supabase, así que la corre Coconut en su computadora con su clave de Google AI Studio en la variable `GEMINI_API_KEY` (ver el README). Llama a Gemini directamente, con las mismas instrucciones, esquema y revisión que la función y la app: así no gasta el cupo de 25 mensajes de una cuenta. La meta se mide con lo que vería la persona (la IA, y las reglas cuando la IA no sirve), y el informe también muestra la IA sola, las reglas solas y las frases en las que la IA empeora lo que hacían las reglas.

## Plan por fases

**Fase 0: lo que hace el equipo (hecho el 26 de octubre de 2026)**
1. En [Google AI Studio](https://aistudio.google.com/), crear un proyecto y una clave restringida a la API de Gemini (*Restrict to Gemini API only*).
2. Guardar la clave en Supabase → Edge Functions → *Secrets* como `GEMINI_API_KEY`. Nunca pegarla en el chat ni en el repositorio.
3. Nivel gratuito, sin facturación (decisión del equipo).
4. Pendiente del despliegue: en Supabase → Authentication → URL Configuration, *Site URL* `https://lia-prototipo.jaime-ramos-93c.workers.dev/` y, en *Redirect URLs*, esa misma dirección y `https://*-lia-prototipo.jaime-ramos-93c.workers.dev/**`.

**Fase 1: Lía entiende con IA (Claude, una semana, ramas cortas)**
1. `docs/ia-gemini`: esta especificación y reglas nuevas en CLAUDE.md (dónde vive la clave y cuándo correr la evaluación).
2. `feat/ia-cupo`: migración de `uso_ia` y `usar_ia()`, probada en una transacción que se deshace, y los asesores de Supabase.
3. `feat/ia-funcion`: la Edge Function `lia-ia`, su entrada en `supabase/config.toml` y sus pruebas. Se despliega sola al integrar a `main`.
4. `feat/ia-chat`: `validarIA()`, el flujo del chat detrás de `?ia=1`, el aviso de privacidad (revisado con `design:ux-copy`) y las pruebas de navegador.
5. Evaluación con el modelo real y ajuste de las instrucciones hasta llegar a la meta.
6. Encender para Pro (quitar la bandera) y medir en el piloto. La bandera se quitó en la versión 0.5.1, el 29 de octubre de 2026. Falta volver a correr la evaluación con el modelo real con las frases de la iteración 2.

**Fase 2: sílabos (3 a 4 días).** Subir un PDF o una foto → la función lo envía a Gemini → lista de evaluaciones para revisar → agregar. Con cupo propio de sílabos.

**Fase 3: notas de voz (unos 3 días).** Grabar en la app → Gemini (entrada de audio) → mismo flujo que un mensaje. Revisar la CSP (`media-src` para la grabación) y el precio del modelo de audio, que aún no está confirmado.

## Riesgos

| Riesgo | Qué hacemos |
|---|---|
| Google retira o cambia modelos (ya apagó Gemini 2.0 y limitó 2.5) | El modelo es un secreto, no código; con el set de frases se valida uno nuevo en minutos |
| Suben los precios (3.8 Flash dobla en enero de 2027) | Flash-Lite por defecto; hoy, nivel gratuito |
| Se alcanzan los límites del nivel gratuito | Gemini responde 429, la app sigue con las reglas y la persona no pierde el mensaje del cupo |
| Gemini se equivoca con una fecha o un curso | Contexto con fecha, día de la semana y cursos; validación; confirmación antes de aplicar |
| Red lenta en el celular | Límite de 12 s; si se pasa, se usan las reglas |
| Abuso con una cuenta Pro | Cupo por día y por mes, y límite de tamaño del pedido |

## Decisiones (26 de octubre de 2026)

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿La IA es solo para Pro? | Sí. Gratis sigue con las reglas |
| 2 | ¿Cuántos mensajes por cuenta? | 25 por día y 300 por mes |
| 3 | ¿Nivel gratuito o pagado de Gemini? | Gratuito, sin prepago. El aviso de privacidad lo explica |
| 4 | ¿Aviso de privacidad? | Aviso corto antes del primer uso y opción para apagarla en Perfil. Pendiente: que lo revise un abogado (Ley 29733) |
| 5 | ¿La versión 1 incluye sílabos? | No: primero el chat, después los sílabos |

## Fuentes

- [Modelos de la API de Gemini](https://ai.google.dev/gemini-api/docs/models)
- [Precios de la API de Gemini](https://ai.google.dev/gemini-api/docs/pricing)
- [Facturación: nivel gratuito y pagado](https://ai.google.dev/gemini-api/docs/billing)
- [Límites de uso](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Regiones disponibles (incluye Perú)](https://ai.google.dev/gemini-api/docs/available-regions)
- [Salida estructurada](https://ai.google.dev/gemini-api/docs/structured-output)
- [Razonamiento (thinking)](https://ai.google.dev/gemini-api/docs/thinking-mode)
- [Uso seguro de las claves](https://ai.google.dev/gemini-api/docs/api-key)
- [Límites de las Edge Functions de Supabase](https://supabase.com/docs/guides/functions/limits)
- [Autorización en las Edge Functions](https://supabase.com/docs/guides/functions/auth-headers)
- [Integración de GitHub de Supabase](https://supabase.com/docs/guides/deployment/branching/github-integration)
