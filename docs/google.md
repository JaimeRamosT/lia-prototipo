# LIA · Conectar con Google (Google Calendar al instante)

3 de noviembre de 2026. Especificación (paso 1 de `docs/fabrica.md`) del pedido de Coconut del mismo día, después de probar la 0.9.0: «un cambio puede demorar horas… no será de utilidad para un usuario, ni siquiera uno de prueba. Necesito que el enlace entre ambas aplicaciones sea inmediato, que uno se convierta prácticamente en extensión del otro». Reemplaza, para quien conecta su cuenta, el enlace iCal de `docs/calendario.md`, que queda como plan B.

## Problema

Con el enlace iCal, Google tarda hasta 24 horas en mostrar lo de LIA, y LIA solo lee Google al abrirse. Nadie puede probarlo en una conversación ni confiar en que lo que ve está al día.

## Objetivos

1. Lo que la persona crea, mueve o borra en Google Calendar aparece en LIA **en segundos** si LIA está abierta, y al abrirla si estaba cerrada.
2. Lo que LIA arma o la persona anota en LIA aparece en Google Calendar **en segundos**, en un calendario «LIA».
3. Un solo botón, «Conectar con Google», sin copiar direcciones.
4. Sin costo: Google Cloud sin facturación (Google Calendar API es gratuita) y sin guardar en el servidor los eventos de la persona.

## No-objetivos

- **Editar desde Google lo que escribe LIA.** El calendario «LIA» lo maneja LIA: si la persona mueve ahí una sesión de estudio, LIA la vuelve a poner donde la armó. Para cambiar el estudio, se usa LIA.
- **Escribir en el calendario principal.** LIA solo escribe en el suyo (permiso `calendar.app.created`); en el principal solo lee.
- **Verificación de Google.** Por ahora, hasta 100 personas que Coconut agrega como usuarios de prueba, con el aviso «Google no verificó esta app».
- **Sincronizar sin la app abierta hacia los datos de LIA.** Los datos de LIA viven en el navegador: el servidor no puede cambiarlos. Los cambios de Google entran apenas se abre LIA.

## Decisión (ADR-005)

| Opción | A favor | En contra | Decisión |
| --- | --- | --- | --- |
| Enlace iCal (ADR-003/004) | Sin Google Cloud | Horas de retraso; no sirve para probar | Plan B |
| Puente con Apps Script | Sin Google Cloud | Cada persona instala un script: unos 10 pasos | No |
| **OAuth + Google Calendar API** | Segundos en los dos sentidos; un botón | Proyecto de Google Cloud (gratis, sin facturación), usuarios de prueba hasta la verificación | **Sí** |
| Un intermediario (Nylas, Cronofy) | Ellos ya están verificados | Costo y un tercero con los calendarios de los estudiantes | No |

Piezas:

- **`lia-google`** (Edge Function, `verify_jwt` apagado porque la llaman Google y `pg_cron`; la app manda su sesión y se revisa aquí):
  - `iniciar`: crea un estado de un solo uso (10 minutos) y devuelve la dirección de Google para dar permiso: `calendar.app.created` (crear y escribir el calendario «LIA») y `calendar.events.readonly` (leer los eventos).
  - `GET ?code&state` (regreso de Google): canjea el código, guarda el *refresh token* en Vault, crea el calendario «LIA», pide a Google que avise de cada cambio del calendario principal (`events.watch`) y vuelve a la app con `?google=ok`.
  - `POST` de Google (aviso de cambio, con `X-Goog-Channel-Token`): suma 1 a `google_senal` de esa persona. No lee ni guarda eventos.
  - `leer`: pide a Google los eventos del calendario principal (desde ayer hasta 120 días) y los devuelve como iCal. La app usa la misma lógica de la 0.9.0 (`leerIcs`, `deCalendario`, `fusionarGcal`).
  - `escribir`: recibe lo de LIA de los próximos 14 días y deja el calendario «LIA» igual: borra lo que sobra y crea lo que falta, con ids estables.
  - `desconectar`: deja de recibir avisos, revoca el permiso, borra el calendario «LIA» y la cuenta.
  - `pg_cron` (cada hora): renueva los avisos que vencen en menos de dos días (Google los da por 7 días).
- **Base** (`supabase/migrations/…_google.sql`): `google_cuentas` (calendario «LIA», canal de avisos y referencia al secreto de Vault; solo `service_role`), `google_estados` (los estados del permiso) y `google_senal` (un contador por persona, que la app lee con Realtime; cada uno ve solo el suyo).
- **App**: Perfil → «Google Calendar» → «Conectar con Google». Al volver, abre la vista previa de la 0.9.0 para elegir qué entra. Después, cada aviso de Realtime (o volver a la pestaña) trae los cambios solos, y cada cambio del plan escribe en Google.

Privacidad: el servidor no guarda eventos ni títulos; solo el permiso (en Vault), el id del calendario «LIA» y el canal de avisos. Los eventos pasan por `lia-google` en cada lectura o escritura y no se registran. El permiso de Google se puede quitar desde LIA («Desconectar») o desde la cuenta de Google.

## Requisitos (P0) y criterios de aceptación

1. **Conectar.** Sin `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, la tarjeta muestra el enlace iCal como hoy. Con ellos, «Conectar con Google» lleva a Google y vuelve a LIA. El estado es de un solo uso, vence a los 10 minutos y está atado a la cuenta de LIA. Solo se vuelve a direcciones de LIA.
2. **De Google a LIA.** La primera vez, vista previa con casillas. Después, un cambio en Google llega a la app abierta por Realtime y se aplica solo, con un aviso «Traje N cambios de tu Google Calendar». Al abrir LIA o volver a la pestaña (si pasó un minuto), también se lee.
3. **De LIA a Google.** Al cambiar el plan, en 3 segundos el calendario «LIA» queda igual a lo de LIA de los próximos 14 días: estudio, evaluaciones, eventos y rutinas, sin lo que vino de Google. Si la persona borró el calendario «LIA», se vuelve a crear.
4. **Errores.** Permiso vencido o quitado en Google → «Tu conexión con Google venció: vuelve a conectar». Sin permisos completos → lo dice y no guarda nada. Google lento → se reintenta en la siguiente lectura.
5. **Desconectar.** Revoca el permiso, deja de recibir avisos, borra el calendario «LIA» y pregunta qué hacer con lo traído (como en la 0.9.0).
6. **Registros.** Nunca tokens, códigos, correos, títulos ni ids de eventos.

## Lo que hace Coconut (una vez)

Proyecto de Google Cloud sin facturación, Google Calendar API habilitada, pantalla de consentimiento externa con usuarios de prueba, los dos permisos, cliente web con la URI `https://lvtthltugrpbqjezwnsd.supabase.co/functions/v1/lia-google`, y los secretos `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en Supabase. En modo de prueba, Google pide volver a conectar cada 7 días; al publicar la app (sin verificar), deja de pedirlo, pero muestra «Google no verificó esta app».

## Preguntas abiertas

- ¿Cuánto tarda en la práctica el aviso de Google? Se mide en la primera prueba (la documentación no da un tiempo).
- ¿Cuándo vale la pena verificar la app (política de privacidad, dominio propio, video)? Al pasar de 100 personas.
