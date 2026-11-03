# LIA · Google Calendar en los dos sentidos

3 de noviembre de 2026. Especificación (paso 1 de `docs/fabrica.md`) del pedido de Coconut: «importar eventos desde Calendar hacia LIA y que los eventos que se registran con LIA se registren automáticamente en Calendar», sin Google Cloud (decisión del 2-nov, ADR-003 en `docs/canales.md`) y con la cuenta de Google como opción, no como requisito.

## Problema

Quien ya usa Google Calendar tiene que escribir dos veces lo mismo: sus clases, turnos y exámenes en Google y otra vez en LIA. Y lo que LIA arma (estudio) o lo que la persona anota en LIA (un evento, una rutina) no se ve en el calendario que mira todo el día. Cada dato que se copia a mano es una razón para dejar de usar LIA en la primera semana.

## Objetivos

1. Quien tiene sus clases en Google Calendar las ve en LIA en menos de 2 minutos, sin escribirlas.
2. Lo que se anota en LIA aparece en Google Calendar sin hacer nada más que agregar el enlace una vez.
3. Cero duplicados: lo que vino de Google no vuelve a Google, y lo que ya estaba en LIA no se trae dos veces.
4. Sin Google Cloud, sin permisos de Google y sin guardar el calendario de la persona en el servidor de LIA.

## No-objetivos

- **Cambios al instante.** Sin la API de Google (exige Google Cloud), Google actualiza los calendarios por enlace cada varias horas (hasta 24). Se dice en la pantalla.
- **Escribir dentro del calendario principal de Google.** Lo de LIA aparece en un calendario aparte, «LIA», que la persona puede ocultar o renombrar.
- **Repeticiones complejas** («el segundo martes de cada mes»): se cuentan como no traídas y se dicen.
- **Eventos de todo el día** (cumpleaños, feriados): no ocupan horas. Se omiten, salvo una entrega, que entra a las 23:59.
- **Leer el calendario desde el servidor sin la app abierta.** La dirección secreta se queda en el navegador; la sincronización ocurre al abrir LIA.

## Decisión (ADR-004)

| Opción | A favor | En contra | Decisión |
| --- | --- | --- | --- |
| API de Google Calendar con OAuth | Al instante, en los dos sentidos | Proyecto de Google Cloud, permisos sensibles y verificación de Google | No (Coconut no quiere Google Cloud) |
| La app lee el `.ics` directo | Nada pasa por el servidor | Google no permite leerlo desde otra página (CORS) | No es posible |
| **`lia-calendario` lee la dirección secreta y la devuelve a la app** | Sin Google Cloud; la app interpreta y decide; el servidor no guarda nada | La dirección pasa por el servidor en cada lectura (no se registra) | **Sí** |
| Guardar la dirección en el servidor y sincronizar con `pg_cron` | Sincroniza sin abrir la app | Guarda una llave a todo el calendario de la persona | No por ahora |

## Cómo funciona

**De Google Calendar a LIA**

1. Perfil → «Google Calendar y WhatsApp» → «Traer mi Google Calendar». La persona copia la «Dirección secreta en formato iCal» (Google Calendar en la computadora → ⋮ junto a su calendario → «Configuración y uso compartido» → «Integrar el calendario») y la pega.
2. La app la envía, con su sesión, a `lia-calendario` (`POST {accion:'importar', url}`). La función solo acepta direcciones `https` de `calendar.google.com/calendar/ical/`, de Outlook (`/owa/calendar/`) o de iCloud (`/published/`), con redirecciones solo dentro de esa lista, 10 s de espera como máximo, hasta 15 MB, y devuelve el texto sin lo que ya pasó. No guarda nada y su registro no lleva la dirección ni títulos.
3. La app lo lee (`leerIcs`, `deCalendario` en la lógica) y propone:
   - **Rutinas**: lo que se repite cada semana (o cada día) → una rutina con sus días y horas. Las fechas excluidas o movidas de los próximos 60 días quedan como «libre» ese día.
   - **Evaluaciones**: un evento de una vez cuyo título dice parcial, examen, final, práctica (PC1…), control, quiz, entrega, exposición o sustentación (próximos 120 días). El curso sale del resto del título.
   - **Eventos de un día**: el resto de lo que pasa una vez en los próximos 60 días, y las repeticiones que no son semanales (cada dos semanas, cada mes) como días sueltos.
4. Vista previa con casillas. Lo que ya está en LIA aparece marcado «Ya está en LIA» y sin elegir. «Agregar» lo guarda (con Deshacer). En Gratis, las evaluaciones respetan el límite de 3 próximas.
5. Cada vez que se abre LIA (si pasaron 6 horas) o con «Traer cambios ahora»: lo nuevo entra, lo que cambió en Google se actualiza y lo que se borró en Google (y aún no pasó) se quita. Lo que la persona cambió o borró en LIA se queda como lo dejó y ya no se toca.

**De LIA a Google Calendar**

- El enlace secreto que ya existe (`GET lia-calendario?t=…`, calendario «LIA») ahora lleva, además del estudio y las evaluaciones, los **eventos de un día** y las **rutinas** de los próximos 14 días. Las rutinas se pueden apagar («También mis rutinas»).
- Nunca se publica lo que vino de Google Calendar (evita duplicados).

## Historias

- Como estudiante que tiene sus clases en Google Calendar, quiero traerlas a LIA para que arme mi estudio sin que yo las escriba otra vez.
- Como estudiante que anota sus parciales en Google Calendar, quiero que LIA los reconozca como evaluaciones para que me reparta horas de estudio antes de cada uno.
- Como estudiante que mira su celular todo el día, quiero ver en Google Calendar lo que anoto en LIA (un turno extra, mi rutina de gimnasio, mis sesiones de estudio) para no revisar dos apps.
- Como estudiante que cambia una clase en Google, quiero que LIA se actualice sola al abrirla.
- Como estudiante que corrigió algo en LIA, quiero que mi corrección no se pierda la próxima vez que LIA lea Google.
- Como estudiante con cuenta de la universidad, quiero entender por qué no encuentro la dirección secreta (el administrador puede haberla desactivado) y qué hacer.

## Requisitos

### P0

1. **Leer la dirección secreta en el servidor, sin guardarla.**
   - [ ] Sin sesión → 401. Origen que no es de LIA → 403.
   - [ ] Una dirección fuera de la lista (incluida la propia de `lia-calendario`) → `no_permitida`, sin pedirla.
   - [ ] Una redirección hacia fuera de la lista no se sigue.
   - [ ] Más de 15 MB → `muy_grande`; más de 10 s → `tiempo`; lo que no empieza con `BEGIN:VCALENDAR` → `no_es_calendario`; 404 de Google → `no_encontrado`.
   - [ ] El registro solo lleva estado, milisegundos, bytes y eventos (nunca la dirección ni títulos).
2. **Interpretar el calendario.**
   - [ ] Horas en UTC (`Z`), con `TZID` (cualquier zona de `Intl` y los nombres de Windows más comunes) y flotantes, convertidas a hora de Lima.
   - [ ] `RRULE` semanal y diaria con `BYDAY`, `UNTIL`, `COUNT` e `INTERVAL`; `EXDATE`; instancias movidas o canceladas (`RECURRENCE-ID`).
   - [ ] Se omiten: cancelados, «Disponible» (`TRANSP:TRANSPARENT`), de todo el día (salvo entregas), de más de 16 horas, y lo que ya pasó. La vista previa dice cuántos y por qué.
   - [ ] Una rutina que terminó (`UNTIL` o `COUNT` en el pasado) no se trae; una que empieza en más de 7 días llega en una sincronización posterior.
3. **Vista previa y guardado.**
   - [ ] Agrupada en Rutinas, Evaluaciones y Eventos de un día, con casillas; lo que ya está en LIA, sin elegir.
   - [ ] Lo que no se eligió no vuelve a proponerse.
   - [ ] Deshacer devuelve todo como estaba, incluida la conexión.
   - [ ] En Gratis, solo entran evaluaciones hasta el límite; la vista previa lo dice.
4. **Sincronizar al abrir.**
   - [ ] Con sesión y dirección guardada, a las 6 horas de la última lectura.
   - [ ] Nuevo en Google → entra; cambió en Google → se actualiza; se borró en Google y es futuro → se quita (con lo estudiado para esa evaluación).
   - [ ] Lo editado o borrado en LIA no se toca nunca más.
   - [ ] Solo avisa si algo cambió («Traje 2 cambios de Google Calendar», con Deshacer).
5. **Publicar lo de LIA en Google Calendar.**
   - [ ] Eventos de un día (no los «No disponible» que crea mover un bloque) y rutinas de los próximos 14 días, sin las horas que una excepción «libre» liberó.
   - [ ] Nada que tenga origen en Google.
   - [ ] Las rutinas se pueden apagar; por defecto van.
6. **Privacidad.**
   - [ ] La dirección secreta vive solo en el navegador (en los datos de LIA) y se borra al cerrar sesión.
   - [ ] La tarjeta dice qué se publica (estudio, evaluaciones, eventos y rutinas con su nombre) antes de activar.

### P1

- Elegir la categoría de cada rutina en la vista previa (hoy se adivina por el título: «gym» → Deporte).
- «Traer de Google Calendar» también en el menú Agregar y en el registro.
- Repeticiones mensuales con `BYDAY` («el primer lunes»).

### P2

- Sincronización desde el servidor sin abrir la app (guardaría la dirección: requiere decidir su cifrado).
- API de Google con OAuth para cambios al instante, si algún día se acepta Google Cloud.

## Métricas

- **Adopción**: % de cuentas con sesión que traen su calendario en la primera semana. Meta: 30 % (estiramiento 50 %). Se cuenta con los registros de `lia-calendario` (`paso: importar`), que no llevan quién ni qué: no hace falta una migración de `registrar_evento()`.
- **Éxito de la lectura**: % de lecturas con estado 200 en esos registros. Meta ≥ 90 %; si `no_encontrado` o `no_permitida` superan el 10 %, revisar los textos de ayuda.
- **Retención**: regreso al día 3 de quien trajo su calendario frente a quien no.

## Preguntas abiertas

- ¿Las cuentas de la universidad (UTEC, PUCP, UPC) permiten la dirección secreta? Bloquea solo a esas cuentas; lo responde Coconut probando con una (no bloquea la entrega).
- ¿Cada cuánto actualiza Google el calendario «LIA» en la práctica? Lo mide Coconut el primer día (no bloquea).

## Fases

1. Esta rama: P0 completo, más la vista de escritorio (la app se usa como página web).
2. Siguiente: P1, según lo que digan las primeras pruebas con estudiantes.
