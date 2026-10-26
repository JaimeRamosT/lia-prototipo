# Cuentas y plan Pro con Supabase (fase 1)

**Estado:** propuesta en la rama `feat/cuentas-supabase`, con la base de datos ya aplicada en el proyecto del equipo · **Fecha:** 25 de octubre de 2026 · **Versión de la app:** 0.3.0

## En una frase

LIA tiene una sola versión: quien la abre sin cuenta usa **LIA Gratis**, y **LIA Pro** existe solo con una cuenta cuyo plan guarda Supabase. El checkout sigue siendo de prueba: no cobra nada.

## Especificación

### Problema

Con la bandera `pagos`, la diferencia entre Gratis y Pro no se podía probar como la vivirá un estudiante. Además, un Pro "comprado" vivía solo en el navegador: se perdía al cambiar de dispositivo y cualquiera podía activarlo editando los datos guardados. Sin cuentas no hay forma de medir quién llega a pagar ni de preparar el cobro real.

### Objetivos

1. Una sola versión: sin cuenta, Gratis; con cuenta y plan Pro vigente, todo disponible.
2. El plan vive en la base de datos y la app no puede cambiarlo por su cuenta.
3. El equipo puede crear una cuenta Pro de prueba en minutos y probar ambos planes en cualquier dispositivo.
4. Dejar listo el modelo de datos para el cobro real con Culqi sin rehacerlo.

### Fuera de alcance (fase 1)

- **Sincronizar horarios y evaluaciones entre dispositivos.** Siguen en el dispositivo: es otra fase, con su propia resolución de conflictos.
- **Cobro real.** Culqi necesita formalización (RUC, comprobantes) y un webhook en el servidor.
- **Inicio de sesión con Google.** Correo y contraseña bastan para probar.
- **Recuperar contraseña y borrar la cuenta desde la app.** Quedan como siguiente paso (P1).

### Historias

- Como estudiante sin cuenta, uso LIA con las funciones Gratis sin registrarme.
- Como estudiante que quiere Pro, creo una cuenta, elijo un plan y completo el pago de prueba; Pro se activa en ese momento.
- Como estudiante Pro, inicio sesión en otro dispositivo y tengo Pro ahí también (mis horarios todavía no viajan).
- Como estudiante con plan mensual pagado con tarjeta, cancelo la renovación y sigo con Pro hasta la fecha.
- Como estudiante, si cierro sesión, la app vuelve a Gratis en ese dispositivo y mis datos locales siguen ahí.
- Como integrante del equipo, otorgo Pro de cortesía a una cuenta desde el SQL Editor.

### Requisitos y criterios de aceptación (P0)

- [x] Sin cuenta, la app usa los límites de Gratis (3 evaluaciones próximas, semana fija, sin voz, sin modo sesión, sin reorganización automática).
- [x] "Pasarme a Pro" pide crear cuenta o iniciar sesión antes del checkout; al aprobar el pago de prueba, Pro queda guardado en Supabase.
- [x] Registro e inicio de sesión con correo y contraseña (mínimo 8 caracteres al crearla). Si el proyecto exige confirmar el correo, la app lo explica y completa el inicio al volver desde el enlace.
- [x] Perfil muestra la cuenta y permite cerrar sesión; al cerrarla, el dispositivo vuelve a Gratis sin borrar datos.
- [x] Sin internet, la app usa el último plan conocido hasta su fecha de fin y nunca bloquea el uso Gratis.
- [x] Si Supabase no está configurado, la app funciona en Gratis y explica que las cuentas aún no están listas.
- [x] Quien no usa cuentas no descarga el cliente de Supabase.

### Requisitos P1 (rama `fix/cuentas-y-correos`)

- [x] **Recuperar la contraseña.** *¿Olvidaste tu contraseña?* envía un enlace sin revelar si la cuenta existe. Al abrirlo en el mismo dispositivo, la app pide la contraseña nueva y deja la sesión iniciada. Si el enlace venció o ya se usó, la app lo explica y abre *Inicia sesión*.
- [x] **Reenviar el correo de confirmación** desde *Revisa tu correo* y desde el error de iniciar sesión sin haber confirmado. Entre un envío y otro se espera un minuto, como exige Auth.
- [x] **Mostrar la contraseña** en todos los campos de contraseña. Si hay un error, lo escrito no se pierde.
- [x] **Mensajes claros** para correo no válido, envío fallido, correo no autorizado (correo integrado de Supabase), límite de envíos, espera entre correos, contraseña repetida y correo que ya tiene cuenta. Con la confirmación activada, Auth no dice que un correo ya existe: responde un usuario sin identidades y no envía nada. La app lo detecta y pasa a *Inicia sesión*.
- [x] **Seguir al pago después de confirmar el correo.** Si la cuenta se creó desde el muro de pago, al volver del enlace se abre el pago con el plan elegido, aunque la página se haya recargado. El pago pendiente se guarda en `lia.alConfirmar` y vence a los 3 días.
- [x] **Herramientas del equipo solo en modo pruebas.** *Simular el fin del periodo* aparece solo al abrir la app con `?pruebas=1`. El modo se recuerda en ese navegador (`lia.pruebas`) y `?pruebas=0` lo apaga.

Queda para después: borrar la cuenta y cambiar la contraseña desde Perfil.
P2: sincronizar el estado del horario por cuenta, webhook de Culqi en lugar de `simular_pago`, inicio de sesión con Google.

### Cómo sabremos si funciona (en la prueba con 15 a 20 estudiantes)

- Porcentaje de quienes abren el muro de pago que crean una cuenta.
- Porcentaje de cuentas que completan el pago de prueba (tabla `pagos`, `demo = true`).
- Errores de registro reportados.

### Preguntas abiertas

- **Equipo:** ¿confirmación de correo activada? Para el piloto, sí, con un SMTP propio (ver [Piloto con estudiantes](#piloto-con-estudiantes)). El correo integrado de Supabase solo escribe a miembros del equipo y como máximo 2 veces por hora: en las pruebas del equipo ya devolvió errores 429 (demasiados correos).
- **Abogado:** los correos se guardan en Supabase, fuera del Perú (Ley 29733, flujo transfronterizo).

## Diseño técnico

```
Navegador (PWA en GitHub Pages)
  index.html ─ localStorage: horario (lia.app.v1) y sesión (lia.auth)
  config.js  ─ URL y clave publicable (públicas)
  vendor/supabase.js ─ se carga solo al usar cuentas
        │ HTTPS con el JWT de la sesión
        ▼
Supabase
  Auth (correo + contraseña) ──trigger──► public.suscripciones (nace en Gratis)
  /rest/v1/rpc ──► funciones SECURITY DEFINER ──► suscripciones, pagos
  RLS: cada cuenta solo LEE lo suyo; sin permisos de escritura para la app
```

**Datos** (`supabase/migrations/20261026005847_cuentas_y_suscripciones.sql`):

| Tabla | Para qué |
|---|---|
| `suscripciones` | Una fila por cuenta: `plan` (`gratis`/`pro`), `periodo`, `medio`, `desde`, `hasta`, `renovacion_automatica`, `demo` |
| `pagos` | Historial; en modo demo nadie pagó (`demo = true`) |

**Funciones** (la app solo puede llamar las cuatro primeras, y solo con sesión iniciada):

| Función | Qué hace |
|---|---|
| `mi_suscripcion()` | Devuelve el plan vigente y aplica vencimientos y renovaciones de prueba |
| `simular_pago(periodo, medio)` | Pago de prueba: activa o extiende Pro y registra el pago. Se reemplaza por el webhook de Culqi |
| `cambiar_renovacion(activa)` | Cancela o reactiva la renovación (solo mensual con tarjeta) |
| `simular_fin_periodo()` | Modo demo: adelanta el fin del periodo para probar renovaciones y vencimientos |
| `otorgar_pro(correo, periodo)` | Solo administradores, desde el SQL Editor: Pro de cortesía para cuentas de prueba |

**Decisiones y por qué:**

- **El plan lo decide la base de datos.** La app guarda una copia para funcionar sin internet, pero nunca la usa para darse Pro: sin cuenta, cualquier Pro guardado se descarta.
- **Las fechas se calculan en hora de Lima** (`hoy_lima()`). Pro termina al empezar el día `hasta`; así no vence 5 horas antes por usar UTC.
- **Solo hay claves públicas en el repositorio.** La URL y la clave publicable son públicas por diseño; la seguridad la dan RLS y los permisos de las funciones. La clave secreta y la `service_role` nunca van al repositorio ni a la app.
- **El cliente de Supabase está en el repositorio** (`vendor/`, versión 2.118.0, licencia MIT) y no en un CDN: funciona sin internet y no depende de terceros. Pesa 218 KB (56 KB comprimido) y solo lo descarga quien usa cuentas.
- **Precios duplicados a propósito.** Están en la migración (`precio()`) y en `index.html` (`PRICES`): si cambian, cambia ambos.
- **Avisos esperados de los asesores de Supabase.** El de seguridad marca (WARN 0029) que una cuenta con sesión puede ejecutar cuatro funciones `SECURITY DEFINER`: `mi_suscripcion`, `simular_pago`, `cambiar_renovacion` y `simular_fin_periodo`. Es a propósito: son la única vía para cambiar el plan, y cada una solo toca la fila de quien llama. Los avisos de `simular_*` desaparecen cuando se quiten para el cobro real. El de rendimiento sobre `pagos_user_id_idx` (índice sin uso) es normal en una tabla nueva: el índice sirve a la política RLS y al borrado en cascada.

**Qué revisar al crecer:** sincronizar el horario por cuenta (tabla con el estado en `jsonb`), mover el cobro a una función de servidor con Culqi y quitar `simular_pago`/`simular_fin_periodo`, y llevar el hosting a un servicio que permita uso comercial antes de cobrar.

## Puesta en marcha

1. **Crear las tablas.** En el proyecto del equipo ya están: la migración quedó registrada como `20261026005847` el 25 de octubre de 2026. Para otro proyecto, elige una vía; la migración se puede aplicar dos veces sin error:
   - **Integración con GitHub:** en Supabase → Project Settings → Integrations → GitHub, con *Working directory* `.` y *Deploy to production* activado, la migración se aplica sola al integrar esta rama en `main`.
   - **A mano:** copia el contenido de `supabase/migrations/20261026005847_cuentas_y_suscripciones.sql` en Supabase → SQL Editor y ejecútalo.
2. **Conectar la app.** `config.js` ya apunta al proyecto del equipo. Para otro proyecto, pega ahí la *Project URL* y la clave *publishable* (o la *anon* heredada) de Supabase → Project Settings → API Keys.
3. **Ajustar Auth** en Supabase → Authentication:
   - *URL Configuration*: *Site URL* con tu dirección de GitHub Pages y, en *Redirect URLs*, `http://localhost:8000/` y `https://jaimeramost.github.io/lia-prototipo/`.
   - *Sign In / Providers → Email*: para probar rápido, desactiva *Confirm email*; si lo dejas activo, el correo integrado solo llega a miembros del equipo del proyecto.
   - Contraseña mínima de 8 caracteres, igual que en la app.
4. **Crear la cuenta Pro de prueba.** Abre la app (`python3 -m http.server 8000`), ve a Perfil → *Crear cuenta*, y luego:
   - **Desde la app:** *Pasarme a Pro* → elige plan → *Simular pago aprobado*; o
   - **Desde el SQL Editor:** `select * from public.otorgar_pro('tu-correo@ejemplo.com');` (Pro de cortesía por un ciclo).

### Prueba manual contra tu proyecto

- [ ] Sin cuenta: la 4.ª evaluación abre el muro de pago.
- [ ] Crear cuenta → checkout → *Simular pago aprobado* → Pro; en el SQL Editor, `select * from suscripciones;` muestra la fila en `pro`.
- [ ] Recargar la página: sigue en Pro.
- [ ] Abrir la app con `?pruebas=1` → Perfil → *Pruebas: simular el fin del periodo* → vuelve a Gratis. Sin `?pruebas=1`, ese enlace no aparece.
- [ ] *Iniciar sesión* → *¿Olvidaste tu contraseña?* → abrir el enlace del correo en el mismo dispositivo → guardar una contraseña nueva → iniciar sesión con ella.
- [ ] Crear una cuenta con la confirmación activada → *Reenviar el correo* (después de un minuto) → llega un segundo correo.
- [ ] Desde el muro de pago, crear una cuenta → abrir el enlace de confirmación → se abre el pago con el plan elegido.
- [ ] Cerrar sesión e iniciarla en otro navegador o teléfono: el plan acompaña a la cuenta.
- [ ] `otorgar_pro('otro-correo')` y luego iniciar sesión con esa cuenta: Pro de cortesía.

### Si algo falla

- **El registro falla con "Database error saving new user":** quita el trigger con `drop trigger if exists al_crear_cuenta on auth.users;`. Las cuentas siguen funcionando, porque `mi_suscripcion()` crea la fila que falte.
- **Las cuentas fallan en la app:** deja vacíos `url` y `key` en `config.js` e integra ese cambio en `main`. La app deja de ofrecer cuentas y sigue en Gratis sin borrar horarios; quien ya tenía Pro en un dispositivo lo conserva ahí hasta su fecha de fin.
- **Deshacer la base de datos:** borra el trigger `al_crear_cuenta`, las funciones de la migración y las tablas `pagos` y `suscripciones`. Se pierden los planes y el historial de pagos de prueba.

## Piloto con estudiantes

Antes de invitar a los 15 a 20 estudiantes:

1. **SMTP propio.** En Supabase → Authentication → Emails → *SMTP Settings*, conecta el correo de un proveedor de correo transaccional con un remitente del equipo. Sin esto, los correos de confirmación y de recuperación solo llegan a miembros del proyecto y como máximo 2 por hora; la app lo explica («Por ahora, solo el equipo de LIA puede crear cuentas»).
2. **Límite de envíos.** En Authentication → *Rate Limits*, sube *Emails sent per hour* según el proveedor (por ejemplo, 30). Auth exige además un minuto entre dos correos a la misma persona; la app lo respeta.
3. **Direcciones de regreso.** En Authentication → *URL Configuration*, la *Site URL* y las *Redirect URLs* deben incluir la dirección de GitHub Pages (`https://jaimeramost.github.io/lia-prototipo/`). Los enlaces de confirmación y de recuperación vuelven a la dirección desde la que se pidieron; si no está en la lista, Auth los manda a la *Site URL*.
4. **Correos en español.** En Authentication → Emails → *Templates*, traduce *Confirm signup* («Confirma tu cuenta de LIA») y *Reset password* («Crea una contraseña nueva para LIA»). Deja el enlace `{{ .ConfirmationURL }}` tal cual.
5. **Confirmación activada.** En *Sign In / Providers → Email*, deja *Confirm email* activado.
6. **Modo pruebas solo para el equipo.** Comparte la dirección sin `?pruebas=1`. Quien la abra con `?pruebas=1` ve *Simular el fin del periodo*; `?pruebas=0` lo apaga en ese navegador.

**Si alguien no puede entrar:**

- *No le llegó el correo:* que revise spam y promociones, y use *Reenviar el correo*. Si sigue sin llegar, en Authentication → Users se puede confirmar la cuenta a mano.
- *Olvidó la contraseña:* *Iniciar sesión* → *¿Olvidaste tu contraseña?*. El enlace se abre en el mismo teléfono donde usa LIA.
- *El enlace venció o ya se usó:* la app abre *Inicia sesión* y lo explica; desde ahí se pide otro.
- *Pagó en una cuenta y abrió otra:* el plan es de la cuenta, no del teléfono; que inicie sesión con la cuenta correcta.
