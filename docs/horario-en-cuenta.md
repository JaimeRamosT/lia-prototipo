# Tu horario en tu cuenta (LIA Pro)

**Estado:** propuesta en la rama `feat/horario-en-cuenta` · **Fecha:** 4 de noviembre de 2026 · **Versión de la app:** 0.11.0

## ADR 1 · El horario de quien tiene Pro se guarda en su cuenta

### Contexto

Hasta la 0.10.6, todo el horario vivía solo en el navegador (`lia.app.v1`). Quien abría LIA en el celular y en la computadora tenía dos horarios distintos. Si Safari borraba los datos, se perdía todo. Además, tres ideas de «Qué sigue» dependen de que el servidor conozca el horario: el mismo horario en todos los dispositivos, WhatsApp que cambie cosas y estudiar en grupo.

### Decisión (4-nov-2026, Coconut)

| Pregunta | Decisión | Lo que se descartó |
|---|---|---|
| ¿Quién lo tiene? | **Solo LIA Pro.** Es una razón más para pagar. | Toda cuenta, Gratis incluida |
| ¿Qué pasa si se cambió en dos dispositivos sin conexión? | **LIA pregunta cuál conservar** y muestra un resumen de cada uno. Nunca reemplaza nada sin avisar. | Que gane el último cambio; mezclar los dos |
| ¿Qué pasa al cerrar sesión? | **LIA pregunta** si deja una copia en ese dispositivo o la borra de ahí. | Dejarla siempre; borrarla siempre |
| ¿El chat se guarda? | **No, solo el horario.** | Subir también el chat |

**Cómo se guarda:** un documento por cuenta (`jsonb`) con un número de versión (`rev`), que sale de una secuencia de todas las cuentas y nunca se repite, aunque la copia se borre y se vuelva a crear. La app sube el documento entero y solo se guarda si la versión que conocía la app sigue siendo la última. Si no, hay conflicto y la app pregunta. No se mezcla por partes: un horario de una persona pesa pocos KB y los conflictos son raros. Una sola regla («el documento entero, con versión») es más fácil de probar que una mezcla por elemento.

### Consecuencias

- **Privacidad:** cambia lo que el servidor sabe. Con Pro, Supabase guarda las rutinas (con su nombre), las evaluaciones (curso y fecha), los días libres, lo estudiado y los ajustes. Sigue sin guardar el chat ni nada que vino de Google Calendar. Los textos de la app ya no dicen «solo en este navegador» a quien tiene Pro.
- **Legal (abierto, igual que los correos):** los datos quedan en Supabase, en EE. UU. (Ley 29733, flujo transfronterizo). Falta la consulta al abogado y una línea en el aviso de privacidad del piloto.
- **Gratis no cambia:** sin Pro no se sube nada, aunque haya cuenta.
- **Si Pro termina:** la copia de la cuenta se queda, pero deja de actualizarse. Al volver a Pro, LIA compara las dos copias y pregunta si son distintas.
- **Desbloquea:** WhatsApp con cambios (Lía puede leer el horario en el servidor) y estudiar en grupo. Cada uno con su propia especificación.

## Especificación

### Historias

- Como estudiante Pro, abro LIA en la computadora, inicio sesión y veo el mismo horario que en el celular.
- Como estudiante Pro, cambio algo en el celular y, al volver a la computadora, ya está.
- Como estudiante Pro sin internet, sigo usando LIA. Lo que cambié se guarda en mi cuenta cuando vuelve la conexión.
- Como estudiante Pro que cambió cosas en dos dispositivos sin conexión, elijo cuál conservar.
- Como estudiante Pro en una computadora prestada, al cerrar sesión borro mi horario de ahí.
- Como estudiante Pro, puedo dejar de guardar mi horario en la cuenta, y eso borra la copia del servidor.

### Requisitos y criterios de aceptación (P0)

- [ ] Solo con Pro vigente se sube y se baja el horario. `mi_horario()` y `guardar_horario()` lo revisan en la base con `mi_suscripcion()`. Gratis con cuenta no sube nada.
- [ ] Se sube: `onboarded`, `completar`, `settings` (menos `avisos`, que es de cada dispositivo), `commitments`, `evals`, `exceptions`, `done` y `frozen`.
- [ ] No se sube: el chat ni el borrador de Lía, el plan (`sub`), la cuenta, `gcal` (con la dirección secreta) ni nada que vino de Google (lo que tiene `gcal`, y los días libres que apuntan a una rutina o a un evento de Google). La base rechaza un documento con `gcal`, `chat`, `sub`, `cuenta` o `borrador` en cualquier nivel.
- [ ] Al bajar, lo de Google y los avisos de cada dispositivo se quedan como estaban.
- [ ] La primera vez en un dispositivo:
  - si el navegador está vacío (sin datos y sin haber terminado la bienvenida), LIA trae el horario de la cuenta y se salta la bienvenida;
  - si la cuenta está vacía, sube el del navegador;
  - si los dos tienen algo y son distintos, pregunta.
- [ ] Si nadie más cambió nada, cada cambio se sube a los 2 segundos. Sin conexión, se sube al volver (`online`) o al regresar a la pestaña.
- [ ] Al abrir LIA o volver a la pestaña:
  - si la cuenta cambió y aquí no hay cambios sin subir, se trae sola;
  - si cambiaron las dos, pregunta.
- [ ] La pregunta muestra en cada lado cuántas rutinas, evaluaciones próximas y sesiones de estudio hay, con las próximas evaluaciones y la hora del último guardado en la cuenta. «Decidir después», o cerrar la hoja de cualquier forma, la deja para la próxima vez que se abra LIA y, mientras tanto, no sube nada.
- [ ] Al cerrar sesión con el horario en la cuenta, LIA ofrece «Dejar mi horario aquí» o «Borrarlo de este dispositivo». Para borrar, primero comprueba con la cuenta que el horario está ahí y sube lo que falte. Sin conexión, con una pregunta pendiente o si la cuenta ya no guarda el horario, no borra y explica por qué.
- [ ] La bienvenida tiene «Ya tengo cuenta» para iniciar sesión en un dispositivo nuevo.
- [ ] En Perfil, la tarjeta de la cuenta dice si el horario está guardado en la cuenta, si tiene cambios por subir o si el servidor lo rechazó (por ejemplo, por tamaño). Con Pro, ofrece «Dejar de guardarlo en mi cuenta», que borra la copia del servidor y se puede volver a activar. En los otros dispositivos, cada uno se queda con su copia y deja de subir cambios.
- [ ] «Borrar todo» con el horario en la cuenta avisa que también se borra de la cuenta y de los otros dispositivos.
- [ ] La tabla de planes muestra «Tu horario en todos tus dispositivos» en Pro.

### Fuera de alcance

- Lo estudiado para una evaluación que vino de Google no pasa a los otros dispositivos. Se sube sin el título, pero esa evaluación se crea en cada dispositivo con otro id, así que el otro no la reconoce.
- Ver el cambio al instante en el otro dispositivo (Realtime): por ahora se trae al abrir LIA o al volver a la pestaña.
- Historial de versiones y recuperar una versión anterior.
- Mezclar por elemento.

### Cómo sabremos si funciona

- En el piloto, cuántas cuentas Pro usan LIA en más de un dispositivo: `select count(*) from horarios` frente a las cuentas Pro.
- Reportes de «perdí mi horario»: la meta es cero.

## Diseño técnico

```
Navegador A ──guardar_horario(datos, rev conocida)──► horarios (user_id, datos jsonb, rev, actualizado)
     ▲                                                    │
     └──────────────mi_horario() al abrir / volver────────┘ ◄── Navegador B (igual)
lia.horario (en cada navegador) = { uid, rev, firma } o { uid, apagado: true }
```

**Base** (`supabase/migrations/20261104120000_horario_en_cuenta.sql`):

| Objeto | Para qué |
|---|---|
| `horarios` | Una fila por cuenta. RLS activado, sin permisos para `anon` ni `authenticated`: se lee y se escribe solo con las funciones. Se borra con la cuenta (`on delete cascade`). |
| `mi_horario()` | `{pro:false}`, `{pro:true, rev:0}` (sin copia) o `{pro:true, rev, datos, actualizado}`. |
| `guardar_horario(p_datos, p_rev)` | Solo Pro. Guarda si `p_rev` es la versión actual (0 si no hay copia); la nueva versión sale de la secuencia `horarios_rev`. Si no, devuelve `{ok:false, motivo:'conflicto', rev}`. Rechaza documentos de más de 512 KB y los que traen `gcal`, `chat`, `sub`, `cuenta` o `borrador`. Una sola escritura a la vez por cuenta (`pg_advisory_xact_lock`). |
| `borrar_horario()` | Cualquier cuenta con sesión: borra su copia. |

**App** (`index.html`):

- Las funciones `horarioParaCuenta`, `firmaHorario`, `aplicarHorario`, `decidirHorario` y `resumenHorario` están en el bloque de lógica y se prueban en `pruebas/horario-cuenta.test.mjs`. La firma ordena las claves, porque `jsonb` las guarda en otro orden.
- `lia.horario` guarda la versión y la firma de lo último que este navegador tiene en común con la cuenta. «Hay cambios sin subir» significa que la firma actual es distinta.
- `decidirHorario(local, cuenta, meta, uid)` devuelve una de estas acciones: `nada`, `alinear`, `subir`, `bajar`, `apagar` (otro dispositivo dejó de guardarlo) o `preguntar`, con su motivo: `otro-dispositivo`, `primera-vez` o `cuenta-vacia`.

**Avisos esperados del asesor:** 0029 para `mi_horario`, `guardar_horario` y `borrar_horario` (las llaman las cuentas a propósito) y 0008 (RLS sin políticas) para `horarios`, igual que en `canales`.

## Puesta en marcha

1. En Supabase → SQL Editor, ejecuta `supabase/migrations/20261104120000_horario_en_cuenta.sql`. Se puede ejecutar dos veces sin error.
2. Corre los asesores de seguridad y de rendimiento. Deben salir solo los avisos esperados.
3. Integra el PR. Prueba con una cuenta Pro de prueba en dos navegadores.
