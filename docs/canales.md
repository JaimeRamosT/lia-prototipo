# LIA · Canales: Google Calendar y WhatsApp

2 de noviembre de 2026. Responde a la observación del supervisor (30-oct) y a la guía que Coconut adoptó ese día: LIA se usa desde los canales que la gente ya usa; la app web es donde se configura y se ve la semana. La cuenta de Google es opcional: se usan las cuentas de LIA de siempre.

## Decisión (ADR-003)

| Opción | A favor | En contra | Decisión |
| --- | --- | --- | --- |
| Google Calendar con OAuth (API de Google) | Cambios al instante; leer el calendario | Exige un proyecto de Google Cloud; todos los permisos de Calendar son sensibles: sin verificación, 100 usuarios y autorizaciones de 7 días | No por ahora (Coconut no quiere Google Cloud) |
| **Enlace iCal secreto** | Sin Google Cloud ni permisos; funciona en Google, Apple y Outlook | Google lo actualiza cada cierto tiempo (no instantáneo); solo de LIA hacia el calendario | **Sí** |
| WhatsApp por la Cloud API de Meta | Donde ya está la gente; avisos y consultas sin instalar nada | Número de prueba: 5 destinatarios; fuera de 24 h hace falta una plantilla aprobada; costo por mensaje con número real | **Sí**, empezando con el número de prueba |

Lo que cambia en la privacidad: al activar un canal, la app publica en Supabase las sesiones de estudio y evaluaciones de los próximos 14 días **con su nombre** («Estudiar Cálculo II»). Sin eso, el calendario y WhatsApp no podrían mostrarlas. La persona lo lee en la tarjeta antes de activar; al desactivar los dos canales, se borra. No se publican rutinas, mensajes del chat, nombre ni correo.

## Piezas

- **Base** (`supabase/migrations/…_canales.sql`): `canales` (token del calendario y número de WhatsApp de cada cuenta) y `agenda_canales` (lo publicado). Sin permisos directos: solo funciones. Para la app: `canales_estado`, `activar_calendario`, `desactivar_calendario`, `pedir_codigo_whatsapp`, `quitar_whatsapp`, `avisos_whatsapp`, `publicar_agenda`. Para las funciones (solo `service_role`): `agenda_por_token`, `vincular_whatsapp`, `agenda_whatsapp`, `whatsapp_vinculado`, `avisos_whatsapp_numero`, `tomar_avisos_whatsapp`. `pg_cron` llama a `lia-whatsapp` cada minuto con el secreto de Vault de `lia-avisos`.
- **`lia-calendario`** (Edge Function, `verify_jwt` apagado): `GET ?t=<token>` devuelve el calendario iCal. El token de 64 caracteres es la llave; «Dejar de compartir» lo borra.
- **`lia-whatsapp`** (Edge Function, `verify_jwt` apagado): webhook de Meta firmado con `X-Hub-Signature-256`; vincula con «LIA 123456»; responde «hoy», «mañana», «semana», «pausa» y «avisos»; las preguntas libres, con Groq (solo lectura de la agenda). Avisos: 15 minutos antes de estudiar y 2 horas antes de una evaluación.
- **App** (`index.html`): Perfil → «Google Calendar y WhatsApp». La agenda se publica sola cuando cambia el plan (`publicarCanales`).

## Configurar WhatsApp (Coconut, con su cuenta de Meta)

1. En [developers.facebook.com](https://developers.facebook.com/) → tu app → WhatsApp → **API Setup**: copia el **Phone number ID** del número de prueba y genera un **token de acceso** (el temporal dura 24 horas; para que no venza, crea un usuario del sistema en el Business Manager con permiso `whatsapp_business_messaging`).
2. En **API Setup → To**, agrega y verifica **tu número** (el que vas a probar). Con el número de prueba, solo esos números (hasta 5) reciben mensajes.
3. En Supabase → Edge Functions → **Secrets**, agrega:

   | Secreto | Valor |
   | --- | --- |
   | `WHATSAPP_TOKEN` | El token de acceso |
   | `WHATSAPP_PHONE_ID` | El Phone number ID |
   | `WHATSAPP_APP_SECRET` | App settings → Basic → App secret |
   | `WHATSAPP_VERIFY_TOKEN` | Una palabra secreta que inventes (la misma del paso 4) |
   | `WHATSAPP_PLANTILLA` | Opcional: el nombre de la plantilla del paso 5 |
   | `WHATSAPP_PLANTILLA_CODIGO` | El nombre de la plantilla de autenticación del paso 7 |

4. En WhatsApp → **Configuration → Webhook**: URL `https://lvtthltugrpbqjezwnsd.supabase.co/functions/v1/lia-whatsapp`, «Verify token» = `WHATSAPP_VERIFY_TOKEN`. Luego suscríbete al campo **messages**.
5. Opcional, para avisos fuera de las 24 horas: en WhatsApp Manager crea una plantilla de categoría **Utility**, idioma español (`es`), con el cuerpo «Hola, soy Lía. A las {{1}} empieza: {{2}}. Escribe «pausa» si no quieres estos avisos.» y pon su nombre en `WHATSAPP_PLANTILLA`. Sin plantilla, los avisos llegan solo si la persona le escribió a LIA en las últimas 24 horas.
6. El número de LIA (el de prueba, con código de país y sin «+») va en `WA_LIA` de `index.html` (hoy `15551404567`).
7. **Plantilla del código (para vincular recibiendo el código, pedido de Coconut del 2-nov):** en WhatsApp Manager → Plantillas de mensajes → Crear plantilla → categoría **Autenticación** → nombre `lia_codigo` → idioma **Español** → entrega del código «**Copiar código**» → enviar a revisión. Cuando esté aprobada, agrega el secreto `WHATSAPP_PLANTILLA_CODIGO` = `lia_codigo` (y `WHATSAPP_PLANTILLA_CODIGO_IDIOMA` si el idioma no es `es`).
8. En LIA (con tu cuenta) → Perfil → WhatsApp → escribe tu número → «Vincular WhatsApp». LIA te envía el código por WhatsApp y lo escribes en la app. Sin la plantilla, la app muestra el código y tú se lo envías a LIA («LIA 123456»): ese camino necesita que Meta entregue los mensajes que llegan (paso 4).

## Si LIA no recibe los mensajes que le escribes

La función registra cada mensaje que llega (sin textos ni números). Si en Supabase → Edge Functions → lia-whatsapp → Logs no aparece ninguno:

1. En WhatsApp → Configuration → Webhook fields, junto a **messages**, toca **Test**. Si el registro muestra `"error":"firma"`, `WHATSAPP_APP_SECRET` no coincide con App settings → Basic → App secret.
2. Si la prueba llega pero tus mensajes reales no, la app no está suscrita a tu cuenta de WhatsApp Business: en el Graph API Explorer, con tu token, haz `POST /<WABA_ID>/subscribed_apps` (el WABA ID está en API Setup).
3. Si sigue sin llegar, pasa la app a modo **Live** (pide una URL de política de privacidad).

## Pendiente

- Leer Google Calendar hacia LIA (importar clases y pendientes) sin Google Cloud: con la «dirección secreta en formato iCal» que da Google.
- Que WhatsApp también cambie el horario (hoy solo lee): requiere llevar las reglas de `interpret()` al servidor.
- Número propio de WhatsApp, verificación del negocio y precio por mensaje en Perú.
- Versión para escritorio de la app web.
