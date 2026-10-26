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

P1: recuperar contraseña, reenviar el correo de confirmación, borrar la cuenta, SMTP propio para escribir a estudiantes.
P2: sincronizar el estado del horario por cuenta, webhook de Culqi en lugar de `simular_pago`, inicio de sesión con Google.

### Cómo sabremos si funciona (en la prueba con 15 a 20 estudiantes)

- Porcentaje de quienes abren el muro de pago que crean una cuenta.
- Porcentaje de cuentas que completan el pago de prueba (tabla `pagos`, `demo = true`).
- Errores de registro reportados.

### Preguntas abiertas

- **Equipo:** ¿confirmación de correo activada? El correo integrado de Supabase solo escribe a miembros del equipo y como máximo 2 veces por hora.
- **Equipo:** configurar un SMTP propio antes de invitar estudiantes.
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
- [ ] *Modo demo: simular el fin del periodo* → vuelve a Gratis.
- [ ] Cerrar sesión e iniciarla en otro navegador o teléfono: el plan acompaña a la cuenta.
- [ ] `otorgar_pro('otro-correo')` y luego iniciar sesión con esa cuenta: Pro de cortesía.
