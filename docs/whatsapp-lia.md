# LIA · Lía en WhatsApp, igual que en la app

4 de noviembre de 2026. Especificación (paso 1 de `docs/fabrica.md`) del pedido de Coconut del 3-nov: Lía en WhatsApp «igual que en la app». Entiende y propone los mismos cambios que el chat, la persona confirma con «sí» y LIA los guarda. Retoma WhatsApp el día en que Meta aprobó la plantilla `lia_codigo`. Completa `docs/canales.md`, donde WhatsApp solo lee.

## Problema

Hoy, por WhatsApp, Lía solo dice qué hay en la agenda y envía avisos. Para anotar un parcial, decir «hoy salgo tarde del trabajo» o marcar lo que estudió, la persona tiene que abrir LIA. Pero quien estudia y trabaja vive en WhatsApp: si anotar le cuesta abrir otra app, no lo anota, el horario se desactualiza y vuelve a amanecerse antes del examen. Además, la pregunta libre de WhatsApp usa Groq sin revisar si la cuenta es Pro y sin descontar del cupo (hallazgo del 3-nov).

## Objetivos

1. Lo que Lía entiende en el chat de la app, lo entiende igual por WhatsApp: las mismas reglas, la misma IA y las mismas preguntas cuando falta un dato.
2. Ningún cambio se guarda sin un «sí» de la persona. Lo confirmado aparece en LIA **en segundos** si está abierta y, si no, **al abrirla**, con Deshacer.
3. Pro y Gratis, como en la app: las reglas son para todos y la IA solo para Pro, con el mismo cupo de `usar_ia()` (25 al día y 300 al mes, compartido con el chat de la app).
4. El servidor nunca guarda el texto de los mensajes. Solo guarda lo mínimo para entender (evaluaciones y rutinas) y lo propuesto hasta guardarlo.

## No-objetivos

- **Guardar todo el horario en la cuenta.** Los datos siguen en el navegador (ADR-006, opción B descartada por ahora). El servidor no arma el plan: solo propone.
- **Fotos ni consolidados por WhatsApp.** Responde «Por ahora solo leo mensajes de texto (y audios, en LIA Pro)». Las notas de voz llegaron en la iteración 3, solo en Pro (ver «Audios»).
- **«¿Y si…?» por WhatsApp.** La simulación necesita el plan completo; por WhatsApp, Lía propone el cambio sin simular.
- **Cambiar ajustes** (horas de sueño, rutinas permanentes): como en la app, Lía dice que se cambian en Perfil.
- **Número propio y plantillas de avisos (Utility).** Siguen en `docs/canales.md` como pendientes.

## Decisión (ADR-006)

**Estado:** aceptada por Coconut el 4-nov-2026 (reglas y confirmación para todos; la IA solo en Pro).

**Contexto:** los datos de LIA viven en `localStorage`. El servidor (`lia-whatsapp`) no puede cambiarlos. Lía entiende con `interpret()` (bloque `LOGIC` de `index.html`) y, en Pro, con la IA de `lia-ia`. Las dos piezas viven hoy fuera del servidor de WhatsApp.

| Opción | A favor | En contra | Decisión |
| --- | --- | --- | --- |
| A. Solo lectura y un enlace que abre LIA con el mensaje escrito | Casi nada que construir | No es «igual que en la app»: obliga a abrir LIA | No |
| **B. Las reglas y la IA en el servidor; la propuesta confirmada se guarda en la base y la app la aplica** | Igual que la app; no mueve los datos; Deshacer en la app | Una copia de las reglas en el servidor (generada y probada); hay que publicar evaluaciones y rutinas | **Sí** |
| C. Guardar todo el horario en la cuenta (sincronizar) | WhatsApp vería el plan al día y cambiaría al instante | Cambio grande de arquitectura y de privacidad; es la pregunta abierta del plan («Guardar el horario en la cuenta») | Después, con su propio ADR |

**Piezas:**

- **Reglas en el servidor.** `supabase/functions/lia-whatsapp/reglas.js` se **genera** a partir del bloque `LOGIC` de `index.html` (`node supabase/functions/lia-whatsapp/copiar.mjs`). Lo mismo con la lógica de la IA: `ia.js` es una copia exacta de `lia-ia/logica.js`. Una prueba falla si alguna de las dos copias se desactualiza. Así hay una sola fuente de verdad y las 365 pruebas de las reglas valen para WhatsApp.
- **Consentimiento.** La tarjeta de WhatsApp en Perfil dice qué se guarda en el servidor y que, en Pro, el mensaje puede pasar por la IA. Quien vincula su número desde la app lo acepta en el mismo formulario. Quien ya estaba vinculado ve «Activar Lía en WhatsApp». Sin aceptar (`settings.waLia`), la app no publica el contexto y WhatsApp sigue como antes: agenda y avisos. Para anotar, Lía dice cómo activarlo. Lo que se confirmó se guarda en cualquier dispositivo con la cuenta, porque no envía nada al servidor.
- **Contexto publicado.** Con Lía activada en WhatsApp, la app publica lo que Lía necesita para entender: horas de despertar y de dormir, evaluaciones desde hace 14 días (curso, tipo, fecha, hora, horas, lo estudiado y lo que quedó sin hueco) y rutinas (nombre, tipo, días y horas). Es lo mismo que ya va a la IA en cada mensaje (`contextoIA`), más el avance y cuántas evaluaciones próximas cuenta la app (para el límite de Gratis). Se reemplaza cuando cambia y se borra al desvincular WhatsApp. Sin nombre, correo ni lo que vino de Google Calendar.
- **Propuestas** (tabla `propuestas_whatsapp`, solo mediante funciones):
  - `borrador`: Lía preguntó un dato (vence a los 10 minutos, como en la app).
  - `pendiente`: Lía mostró el cambio y espera el «sí» (vence a los 30 minutos; una nueva reemplaza a la anterior).
  - `confirmada`: la persona dijo «sí»; espera a que la app la guarde (vence a los 14 días).
  - La app las guarda y las borra. Nunca guardan el texto del mensaje, solo la intención ya entendida.
- **`whatsapp_senal`**: un contador por persona, como `google_senal`. Al confirmar suma 1 y la app abierta lo escucha con Realtime.
- **Cupo.** `usar_ia_whatsapp(numero, sumar)` (solo `service_role`) busca la cuenta del número y llama a la misma `usar_ia()` con esa cuenta como usuario, solo dentro de esa transacción. El cupo sigue cambiando solo mediante `usar_ia()`.
- **Mensajes repetidos.** Meta puede reenviar un mensaje si tardamos. `whatsapp_visto()` guarda el hash del id del mensaje por 2 días y la función no responde dos veces.

## Flujo

1. Llega un mensaje de texto, o el toque de un botón, de un número vinculado.
2. «pausa», «avisos», «hoy», «mañana» y «semana» funcionan como hoy.
3. Si hay un `pendiente` y el mensaje es «sí» (o «dale», «confirmo», «guárdalo», o el botón «Sí, guárdalo»), pasa a `confirmada`. «ok», «ya» y «listo» solo confirman si la propuesta es de los últimos 5 minutos. Si es «no» (o «cancela», o el botón «No, déjalo»), se descarta. Cada botón lleva el id de su propuesta: uno de un mensaje viejo responde «Ese mensaje ya no vale» y no hace nada.
4. Si hay un `borrador`, el mensaje puede ser la respuesta (`respuestaBorrador`, como en la app).
5. Si no, entienden las reglas (`interpret`). Si no entienden (`pideIA`) y la cuenta es Pro con cupo, la IA (`lia-ia`: Groq y, si no responde, Gemini), revisada con `validarIA`. Se descuenta 1 del cupo solo si la IA respondió. Los atajos «hoy», «mañana» y «semana» responden la agenda directo en una frase de hasta 4 palabras; en una más larga, en Pro, va primero la IA («hoy salí tarde y no pude estudiar» no es la agenda).
6. Según lo entendido:
   - **Agregar** (evaluación o rutina), **un cambio de un día**, **estudio hecho**, **mover o quitar una evaluación**: Lía resume lo que entendió y pregunta «¿Lo guardo?», con los botones «Sí, guárdalo» y «No».
   - **Falta un dato**: Lía pregunta ese dato y guarda el borrador.
   - **Próxima evaluación** y **avance**: responde con el contexto publicado.
   - **Agenda de un día**: como «hoy» o «mañana», con `agenda_canales`.
   - **Reorganizar**: «Eso lo hago en LIA: ábrela y toca Rearmar» (Gratis) o «Reorganizo tu semana apenas abras LIA» (Pro).
   - **Charla**: lo mismo que en la app, sin botones.
   - **No entendió**: la ayuda de WhatsApp con ejemplos. En Gratis no se usa la IA.
7. La app, al abrirse, al volver a la pestaña o con el aviso de Realtime, lee las confirmadas, las vuelve a revisar con el estado real (la evaluación todavía existe, en Gratis hay espacio para otra…), las guarda con un solo Deshacer y avisa «Guardé 2 cambios que me pediste por WhatsApp». Lo que ya no se puede guardar lo explica. Después publica la agenda y el contexto, y WhatsApp queda al día.

## Textos de Lía (WhatsApp)

| Momento | Texto |
| --- | --- |
| Propuesta | «Entendí: Parcial de Cálculo II, jue 5 nov a las 09:00. ¿Lo guardo en tu LIA?» + botones «Sí, guárdalo» y «No» |
| Confirmó | «Listo, lo guardé. Aparece en LIA en unos segundos si la tienes abierta; si no, apenas la abras, y ahí reacomodo tu estudio.» |
| Dijo que no | «Ok, no guardé nada.» |
| «sí» sin nada pendiente | «No tengo nada por guardar. Cuéntame qué anoto, por ejemplo «parcial de Cálculo el jueves a las 9».» |
| Falta un dato | La misma pregunta que en la app («¿A qué hora es el parcial de Cálculo del jueves?»), y hasta 3 respuestas rápidas como botones |
| Gratis sin espacio | El mismo aviso de la app: «En Gratis puedes tener hasta 3 evaluaciones próximas y ya tienes 3. Con LIA Pro no hay límite.» |
| Sin cupo de IA (Pro) | «Ya usaste tus 25 mensajes con IA de hoy. Hasta mañana te entiendo frases simples, como en LIA.» |
| Agenda con cambios por guardar | Al final: «Ojo: tienes 1 cambio que guardo cuando abras LIA.» |

Los revisa `design:ux-copy` antes de programar.

## Requisitos (P0) y criterios de aceptación

1. **Mismas reglas.** `reglas.js` es el bloque `LOGIC` de `index.html` sin cambios. Una prueba lo regenera y falla si difiere. Las frases de `pruebas/ia/frases.json` que las reglas entienden dan la misma intención en el servidor.
2. **Hora de Lima.** El servidor entiende «mañana», «el jueves» y «hoy en la noche» con la hora de Lima, aunque corra en UTC. Hay una prueba a las 23:30 y otra a las 00:30.
3. **Confirmar.** Sin «sí» no se guarda nada. «sí» confirma solo la última propuesta pendiente de ese número y de menos de 30 minutos. Un «sí» repetido (o reenviado por Meta) no confirma dos veces.
4. **IA solo en Pro y con cupo.** Gratis nunca llega a la IA. En Pro, cada mensaje que va a la IA descuenta 1 del mismo cupo del chat de la app; si la IA falla, no descuenta. La pregunta libre que hoy va a Groq sin revisar el plan desaparece: pasa por el mismo camino.
5. **La app guarda lo confirmado.** Con LIA abierta, el cambio aparece en ≤ 5 segundos. Si no, al abrirla. Un solo Deshacer deshace todo lo que llegó junto. Nada se guarda dos veces, aunque la app se abra en dos pestañas o falle al marcarla como guardada.
6. **Revisar antes de guardar.** Si la evaluación o la rutina ya no existe, si la fecha ya pasó (salvo el estudio hecho, que puede ser de los últimos 14 días) o si en Gratis ya no hay espacio, no se guarda y el aviso dice por qué.
7. **Privacidad.** Los registros nunca llevan textos, títulos ni números. La base nunca guarda el texto de los mensajes. El contexto y las propuestas se borran al desvincular WhatsApp, y al borrarse la cuenta. La tarjeta de WhatsApp en Perfil lo dice antes de vincular.
8. **Sin romper lo de hoy.** Vincular con «LIA 123456» o con el código por plantilla, los avisos, «pausa», «avisos» y la agenda siguen igual. Las pruebas actuales de `lia-whatsapp` siguen en verde.

## P1

- Botones de respuesta rápida en las preguntas (hasta 3, de 20 caracteres como máximo, como manda Meta).
- Métrica anónima `whatsapp` en `eventos_uso` (una vez por día, si se usó Lía por WhatsApp).

## P2

- Que WhatsApp vea el plan al día sin abrir LIA: requiere ADR C (guardar el horario en la cuenta).
- ~~Notas de voz con Whisper~~: hecho el 4-nov, solo en Pro (ver «Audios»).

## Audios (iteración 3, 4-nov, solo Pro)

Pedido de Coconut del 4-nov (`docs/iteracion-3.md`, sección 3): Lía escucha las notas de voz en LIA Pro. La lógica está en `supabase/functions/lia-whatsapp/audio.js`; `logica.js` decide quién puede.

**Flujo** de un mensaje `type: 'audio'`:
1. Número sin vincular: lo mismo que a un texto (`SIN_VINCULAR`).
2. Gratis: «Los audios son de LIA Pro. Escríbeme lo mismo y lo entiendo.» Sin descargar nada ni tocar el cupo.
3. Pro sin Lía activada en WhatsApp (`settings.waLia`, sin contexto publicado): no se manda a Groq; Lía dice cómo activarla. El aviso de esa tarjeta en Perfil es el consentimiento y debe decir que los audios los transcribe Groq y no se guardan.
4. Pro sin cupo (`usar_ia_whatsapp`, el mismo de `usar_ia()`): «Ya usaste tus 25 mensajes con IA de hoy, y cada audio cuenta como uno…».
5. Se piden a Meta los datos del audio (`GET https://graph.facebook.com/<versión>/<media_id>`, con `WHATSAPP_TOKEN`; la versión es la misma de los mensajes, `WHATSAPP_API_VERSION` o `v23.0`) y luego el archivo, con el mismo token y solo a direcciones de Meta. Hasta 10 segundos.
6. Más de **5 MB** (por `file_size` antes de descargar, o por lo descargado) o más de **2 minutos** (la duración de la nota de voz Ogg/Opus, leída de su última página, sin decodificarla): «Ese audio es muy largo: mándame uno de menos de 2 minutos o escríbelo.» No se transcribe ni descuenta.
7. Groq lo transcribe: `POST https://api.groq.com/openai/v1/audio/transcriptions`, multipart, con `GROQ_API_KEY`, `model=whisper-large-v3-turbo`, `language=es` y `response_format=json`. Hasta 15 segundos. Si falla, tarda o viene vacío: «No pude escuchar ese audio. ¿Me lo escribes?», sin descontar.
8. Con el texto, se descuenta **1** del cupo y se atiende **exactamente como un mensaje escrito**: «sí» confirma, una evaluación se propone, y si las reglas no entienden y es Pro, va a la IA, que cuenta como cualquier mensaje escrito (un audio que además necesita la IA usa 2 del cupo).

**Privacidad.** El audio y la transcripción solo viven en la memoria de esa llamada: no se guardan en la base ni en los registros. A Groq va el audio para transcribirlo. El registro de `lia-whatsapp` lleva solo el tipo: `audio:ok:<lo que respondió>` (por ejemplo `audio:ok:propuesta:add`), `audio:pro`, `audio:sin_contexto`, `audio:cupo`, `audio:largo` y `audio:error:<paso>` (`sin_clave`, `meta`, `descarga`, `groq`, `limite`, `tiempo`, `vacio`, `red`). Nunca el número, el texto ni la dirección del archivo.

**Pruebas:** `pruebas/whatsapp-audio.test.mjs` (Meta y Groq simulados): Pro con cupo, «sí» por audio, audio que pasa a la IA, Gratis, sin cupo, sin activar, sin vincular, más de 5 MB, más de 2 minutos, fallas de Groq (500, 429, vacío y tiempo), fallas de Meta, sin clave, token solo a Meta y registros sin datos.

**Lo que hace Coconut:** nada nuevo en Meta. `GROQ_API_KEY` ya está en los secretos de las Edge Functions (la usa la IA); hay que volver a desplegar `lia-whatsapp`. El plan gratuito de Groq limita los segundos de audio por hora y por día: con 5 personas de prueba alcanza.

## Frases de prueba (con un horario de ejemplo)

| Frase | Lía por WhatsApp |
| --- | --- |
| «tengo parcial de cálculo el jueves a las 9» | Propone el parcial con «¿Lo guardo?» |
| «sí» | Confirma; la app abierta lo muestra en segundos |
| «el otro jueves entrego el informe de química» | Pregunta la hora y guarda el borrador |
| «a las 11:59 de la noche» | Completa el borrador y propone |
| «hoy salgo del trabajo a las 9» | Propone el cambio de un día |
| «ayer estudié 2 horas de cálculo» | Propone el estudio hecho |
| «pasaron mi parcial de cálculo al viernes» | Propone mover la evaluación |
| «¿cuál es mi próxima evaluación?» | Responde con el contexto |
| «¿cómo voy?» | Responde el avance |
| «me pidió quedarme toda la tarde el jueves» (Pro) | Va a la IA y pregunta el horario |
| La misma frase en Gratis | Ayuda con ejemplos, sin IA |
| «no» con una propuesta pendiente | Descarta |

## Métricas

- Personas con WhatsApp vinculado que confirman al menos un cambio en su primera semana: meta 50 % en el piloto.
- Propuestas confirmadas que la app guarda: meta ≥ 95 % (lo demás, explicado al abrir).
- Mensajes con IA por WhatsApp sobre el total: se mide en los registros (sin textos).

## Preguntas abiertas

- ~~¿Confirmación para todos o todo de Pro?~~ Coconut (4-nov): igual que la app, reglas y confirmación para todos y la IA solo en Pro.
- **Equipo:** cuándo pasar al número propio de WhatsApp (el de prueba solo llega a 5 números verificados).

## Pruebas

| Capa | Dónde | Qué cubre |
| --- | --- | --- |
| Copias | `pruebas/whatsapp-copias.test.mjs` | `reglas.js` e `ia.js` iguales a sus originales; las reglas del servidor (módulo estricto) entienden las 105 frases igual que la app |
| Servidor | `pruebas/whatsapp-lia.test.mjs` (Meta, Supabase y Groq simulados) | Proponer, «sí», «no», botones, borrador con respuestas rápidas, hora de Lima a las 23:30 y 00:30, límite de Gratis, IA solo Pro y cupo, mensajes repetidos, registros sin textos |
| Audios | `pruebas/whatsapp-audio.test.mjs` (Meta, Supabase y Groq simulados) | Ver «Audios» |
| Recordatorios | `pruebas/whatsapp-avisos.test.mjs` y `pruebas/sql/recordatorios.sql.mjs` | El texto de cada tipo, con y sin plantilla; qué se avisa y cuándo (ver `docs/canales.md`, «Recordatorios») |
| App | `pruebas/whatsapp-app.test.mjs` | `contextoWhatsapp()` sin datos personales ni lo de Google; `revisarPropuesta()` con cada motivo |
| Base | `pruebas/sql/whatsapp.sql.mjs` (PGlite, también en la CI) | Permisos de cada función, aplicar dos veces, reemplazar, confirmar una vez, vencer, tope de 20, evaluaciones confirmadas para el límite, mismo cupo que `usar_ia()`, `auth.uid()` vuelve a vacío, desvincular y borrar la cuenta (59 comprobaciones) |
| Navegador | `pruebas/navegador/whatsapp.nav.mjs` (iPhone y computadora) | Guardar al abrir; sin «Activar», nada al servidor; varias juntas con un solo Deshacer (cambio de un día, estudio hecho, mover y quitar); no repetir si el servidor no borró; límite de Gratis y lo que ya no existe; sin red al abrir no ofrece vincular de nuevo |

Revisión de la fábrica (4-nov): el agente `revisor` (otro modelo) encontró 1 punto bloqueante (botones viejos que confirmaban otra propuesta) y 4 importantes (consentimiento de quien ya estaba vinculado, prueba de la base en el repositorio, atajos de agenda antes de la IA y el límite de Gratis contado distinto que la app), además de 8 menores; el agente `ux` encontró 2 altos (privacidad honesta y cómo responder sin botones) y varios textos. Todos corregidos antes de publicar, salvo lo que queda en «Limitaciones conocidas».

Lo que queda para la prueba con Meta real: botones interactivos en el celular, Realtime en la app abierta y el tiempo de respuesta con la IA.

## Limitaciones conocidas

- Lo que vino de Google Calendar no se publica en el contexto (la base nunca guarda eventos ni títulos de Google). Por WhatsApp, «mañana no tengo clases» no libera una clase traída de Google; en la app sí.
- El consentimiento vive en el dispositivo (`settings.waLia`): en otro navegador, o en la app instalada en iPhone, Perfil vuelve a ofrecer «Activar». Hasta activarlo ahí, ese dispositivo no actualiza el contexto.
- `whatsapp_visto` marca el mensaje antes de atenderlo: si la función se cae a mitad, Meta lo reenvía y no se responde. La persona vuelve a escribir.
- La agenda de WhatsApp se ve al día cuando la app publica. Lo confirmado por WhatsApp aparece en la agenda después de abrir LIA (Lía lo avisa: «Ojo: tienes 1 cambio…»).

## Esfuerzo

Unos 2 días con la fábrica: migración y funciones (0.5), `lia-whatsapp` con las reglas y la IA (0.5), app (0.5), pruebas, revisión y experiencia (0.5).
