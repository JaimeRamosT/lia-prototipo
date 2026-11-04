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
  - `iniciar`: crea un estado de un solo uso (10 minutos) atado a la cuenta de LIA y al hash de un nonce que guarda ese navegador, y devuelve la dirección de Google para dar permiso: `calendar.app.created` (crear y escribir el calendario «LIA») y `calendar.events.readonly` (leer los eventos).
  - `GET ?code&state` (regreso de Google): canjea el código, deja el *refresh token* pendiente en Vault y vuelve a la app con `?google=ok&e=<estado>`.
  - `confirmar`: la app, con su sesión y su nonce, cierra la conexión: crea (o reusa) el calendario «LIA», pide a Google que avise de cada cambio del calendario principal (`events.watch`) y guarda la cuenta. Así nadie puede atar su Google a la cuenta de otro ni el de otro a la suya (hallazgo del revisor: CSRF de vinculación).
  - `POST` de Google (aviso de cambio, con `X-Goog-Channel-Token`): suma 1 a `google_senal` de esa persona. No lee ni guarda eventos. Un canal que todavía no está guardado o que ya no existe responde 200 sin hacer nada (ver «Los avisos de Google que no llegaban»).
  - `leer`: pide a Google los eventos del calendario principal (desde ayer hasta 120 días) y los devuelve como iCal. La app usa la misma lógica de la 0.9.0 (`leerIcs`, `deCalendario`, `fusionarGcal`).
  - `escribir`: recibe lo de LIA de los próximos 14 días y deja el calendario «LIA» igual desde hoy: borra lo que sobra y crea lo que falta, con ids estables, de a 3 y reintentando ante los límites de Google. Cada evento lleva una alerta emergente de Google: 2 horas antes en evaluaciones y 15 minutos antes en lo demás (desde el 4-nov); los que ya estaban sin esa alerta se actualizan (PUT). Si falla, la app espera 1, 2, 4… hasta 15 minutos.
  - `desconectar`: deja de recibir avisos, revoca el permiso, borra el calendario «LIA» y la cuenta.
  - `pg_cron` (cada hora): renueva los avisos que vencen en menos de dos días (Google los da por 7 días).
- **Base** (`supabase/migrations/…_google.sql`): `google_cuentas` (calendario «LIA», canal de avisos y referencia al secreto de Vault; solo `service_role`), `google_estados` (los estados del permiso y el permiso pendiente) y `google_senal` (un contador por persona, que la app lee con Realtime; cada uno ve solo el suyo). Al borrar una cuenta (también si se borra el usuario), su secreto sale de Vault.
- Si Google no acepta el aviso (`events.watch`), la conexión igual funciona: la app lee al abrirse y al volver a la pestaña, y la tarjeta lo dice.
- **App**: Perfil → «Google Calendar» → «Conectar con Google». Al volver, abre la vista previa de la 0.9.0 para elegir qué entra. Después, cada aviso de Realtime (o volver a la pestaña) trae los cambios solos, y cada cambio del plan escribe en Google.

Privacidad: el servidor no guarda eventos ni títulos; solo el permiso (en Vault), el id del calendario «LIA» y el canal de avisos. Los eventos pasan por `lia-google` en cada lectura o escritura y no se registran. El permiso de Google se puede quitar desde LIA («Desconectar») o desde la cuenta de Google.

## Requisitos (P0) y criterios de aceptación

1. **Conectar.** Sin `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, la tarjeta muestra el enlace iCal como hoy. Con ellos, «Conectar con Google» lleva a Google y vuelve a LIA. El estado es de un solo uso, vence a los 10 minutos y está atado a la cuenta de LIA. Solo se vuelve a direcciones de LIA.
2. **De Google a LIA.** La primera vez, vista previa con casillas. Después, un cambio en Google llega a la app abierta por Realtime y se aplica solo, con un aviso «Traje N cambios de tu Google Calendar». Al abrir LIA o volver a la pestaña (si pasó un minuto), también se lee.
3. **De LIA a Google.** Al cambiar el plan, en 3 segundos el calendario «LIA» queda igual a lo de LIA de los próximos 14 días: estudio, evaluaciones, eventos y rutinas, sin lo que vino de Google. Si la persona borró el calendario «LIA», se vuelve a crear.
4. **Errores.** Permiso vencido o quitado en Google → «Tu conexión con Google venció: vuelve a conectar». Sin permisos completos → lo dice y no guarda nada. Google lento → se reintenta en la siguiente lectura.
5. **Desconectar.** Revoca el permiso, deja de recibir avisos, borra el calendario «LIA» y pregunta qué hacer con lo traído (como en la 0.9.0).
6. **Registros.** Nunca tokens, códigos, correos, títulos ni ids de eventos.

## Los avisos de Google que no llegaban (3 y 4-nov, iteración 3)

**Síntoma.** Después de conectar, un cambio en Google Calendar no aparecía en LIA hasta abrirla o volver a la pestaña: Realtime nunca avisaba.

**Causa (comprobada en producción).** Al pedir los avisos (`events.watch`), Google manda enseguida el primer aviso del canal, con `X-Goog-Resource-State: sync`. Llega **antes** de que `google_guardar` (o `google_actualizar_canal`, al renovar) guarde el canal en la base. `google_por_canal` no lo encontraba y `lia-google` respondía 404 (registro del 3-nov, 22:49). Para Google, un 404 es una falla del mensaje (solo reintenta los 5xx) y, en la práctica, no volvió a avisar en ese canal.

**Arreglo.**
- `lia-google` responde **200** a un aviso de un canal que no encuentra, sea `sync` o no, y no hace nada: no suma señal ni lee eventos. Lo registra como `paso: 'aviso'`, `resultado: 'desconocido'` (con el estado del recurso, sin tokens ni ids). Si el canal existe pero el secreto (`X-Goog-Channel-Token`) no coincide, sigue el 403.
- La migración `20261104160000_iteracion3_avisos.sql` pone `canal_vence = now()` en los canales que ya existen. La renovación de cada hora (`pg_cron` `lia-google`, que toma lo que vence en menos de dos días con `google_canales_por_vencer`) los vuelve a crear y cierra los viejos. Así, como máximo una hora después de aplicarla, cada cuenta conectada tiene un canal que Google sí avisa.
- Pruebas (`pruebas/google-funcion.test.mjs`): el `sync` que llega antes de guardar el canal da 200 y el aviso siguiente suma la señal; lo mismo al renovar; un canal desconocido da 200 sin hacer nada.

**Alertas en el calendario «LIA».** Para que el recordatorio llegue aunque LIA esté cerrada, cada evento lleva `reminders: { useDefault: false, overrides: [{ method: 'popup', minutes }] }`: 120 en evaluaciones y 15 en lo demás. Los que ya estaban se actualizan en la siguiente escritura, que la app hace siempre al abrirse.

## Limitaciones conocidas

- **iPhone con LIA instalada:** Google se abre fuera de la app y vuelve a Safari, que tiene otro almacenamiento. Hay que conectar desde Safari con la misma cuenta; después, la app instalada ve la conexión (es de la cuenta). La tarjeta lo dice.
- **Modo de prueba de Google:** la pantalla «Google no verificó esta app» y las dos casillas de permiso. La tarjeta avisa antes de ir.

## Lo que hace Coconut (una vez)

Proyecto de Google Cloud sin facturación, Google Calendar API habilitada, pantalla de consentimiento externa con usuarios de prueba, los dos permisos, cliente web con la URI `https://lvtthltugrpbqjezwnsd.supabase.co/functions/v1/lia-google`, y los secretos `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en Supabase. En modo de prueba, Google pide volver a conectar cada 7 días; al publicar la app (sin verificar), deja de pedirlo, pero muestra «Google no verificó esta app».

## Preguntas abiertas

- ¿Cuánto tarda en la práctica el aviso de Google? Se mide en la primera prueba (la documentación no da un tiempo).
- ¿Cuándo vale la pena verificar la app (política de privacidad, dominio propio, video)? Al pasar de 100 personas.
