# Recordatorios en el teléfono (LIA Pro)

Especificación de las notificaciones de LIA: avisos que llegan al teléfono, también con la app cerrada y en la pantalla bloqueada, como en cualquier app. Decidido con Coconut el 29 de octubre de 2026.

## Qué recibe cada plan

| Aviso | Cuándo | Texto de ejemplo | Plan |
|---|---|---|---|
| Examen mañana | 20:00 del día anterior | «Mañana: examen de Cálculo II» · «A las 10:00. Repasa lo justo y duerme bien.» | Pro |
| Examen pronto | 2 horas antes (no antes de la hora de despertar) | «En 2 horas: examen de Cálculo II» · «A las 10:00. ¡Éxitos!» | Pro |
| Antes de estudiar | 15 minutos antes de cada bloque de estudio | «En 15 min: estudia Cálculo II» · «De 19:00 a 20:00, para tu parcial del lun 2 nov.» | Pro |
| Resumen de la mañana | A la hora de despertar, si ese día hay estudio o una evaluación | «Hoy estudias 2 h» · «Cálculo II a las 19:00 y Física a las 20:10.» | Pro |
| Estudio sin marcar | 30 minutos antes de dormir, si quedó estudio de ese día sin marcar | «¿Estudiaste hoy?» · «Te quedan 2 bloques sin marcar. Márcalos para que Lía cuente tu avance.» | Pro |

- **Solo Pro.** En Gratis, Perfil muestra «Recordatorios en tu teléfono» con el candado PRO, que abre los planes. Dentro de la app, Gratis sigue viendo sus avisos de siempre (por ejemplo, «Mañana tienes evaluación» en Hoy).
- Cada tipo se puede apagar en Perfil. Vienen todos prendidos (`state.settings.avisos`, sin cambiar `v:1`).
- Si se abren a Gratis más adelante, será con cuenta (decisión pendiente del piloto).

## Requisitos del teléfono

- **Android (Chrome):** funciona con la app instalada o abierta en el navegador.
- **iPhone (iOS 16.4 o más nuevo):** solo con LIA **instalada en la pantalla de inicio** y abierta desde su ícono. En Safari, Perfil explica cómo instalarla.
- El permiso se pide al tocar «Activar recordatorios», nunca al abrir la app.
- Si la persona negó el permiso, Perfil explica cómo volver a darlo en los ajustes del teléfono.

## Privacidad

El servidor **no guarda nombres de cursos ni de evaluaciones**. Solo guarda, por cada aviso, la hora, el tipo y una referencia interna (por ejemplo, el identificador aleatorio de una evaluación). El texto con el nombre del curso lo arma el teléfono al recibir el aviso, con una copia local que la app guarda en el propio teléfono (Cache Storage `datos-avisos`). Si esa copia no está (por ejemplo, porque se borraron los datos del sitio), el aviso sale con un texto genérico: «Mañana tienes una evaluación».

## Cómo funciona

```
Teléfono (app abierta)
  1. «Activar recordatorios» → permiso del teléfono → PushManager.subscribe (clave pública VAPID)
  2. guardar_dispositivo()           → Supabase: tabla dispositivos_push (solo Pro)
  3. programar_avisos([{cuando, tipo, ref}])  → Supabase: tabla avisos (próximos 8 días, se reemplazan)
     y guarda los textos en el teléfono (Cache Storage datos-avisos)
     Se repite cuando cambia el horario (2 s después) y al abrir la app.

Supabase
  pg_cron, cada minuto → Edge Function lia-avisos (con un secreto propio, sin sesión)
    tomar_avisos_vencidos(): marca como enviados los avisos que ya tocan (solo cuentas Pro vigentes)
    Web Push a cada dispositivo de la cuenta: {tipo, ref, cuando}, cifrado (RFC 8291) y firmado (VAPID)
    Si el servicio de push responde 404 o 410, borra ese dispositivo.

Teléfono (app cerrada)
  sw.js «push» → busca el texto en datos-avisos → showNotification (pantalla bloqueada)
  sw.js «notificationclick» → abre LIA
```

- **Aviso de prueba.** En Perfil, «Enviarme un aviso de prueba» llama a `lia-avisos` con la sesión de la cuenta y manda un aviso inmediato a sus teléfonos.
- **Si el teléfono no está en línea** cuando se programa, los avisos quedan como estaban hasta que la app se abra con internet.
- **Si se pierde Pro**, el servidor deja de enviar (lo revisa al enviar) y la app borra la programación la próxima vez que se abre.

## Datos en Supabase

- `dispositivos_push` (cuenta, endpoint, claves p256dh y auth): una fila por teléfono, como máximo 5 por cuenta. RLS: cada cuenta solo lee los suyos; nadie escribe salvo las funciones.
- `avisos` (cuenta, cuándo, tipo, ref, enviado): RLS de solo lectura de los propios. Los enviados se borran a los 2 días.
- Funciones: `guardar_dispositivo`, `quitar_dispositivo` y `programar_avisos` (cuentas Pro con sesión) y `tomar_avisos_vencidos` (solo `service_role`, la usa la función).
- `pg_cron` llama a `lia-avisos` cada minuto con `pg_net`. La dirección de la función y el secreto viven en Vault (`lia_avisos_url`, `lia_avisos_secreto`), no en el repositorio.

## Claves y secretos (nadie los copia a mano)

| Qué | Dónde | Quién lo crea |
|---|---|---|
| Claves VAPID (firma de los avisos) | Vault: `lia_vapid_publica` y `lia_vapid_privada` | La función `lia-avisos`, la primera vez que corre. La pública la lee la app con `clave_publica_avisos()`. |
| Secreto de `pg_cron` | Vault: `lia_avisos_secreto` | La migración `avisos`, con valores aleatorios de la base de datos. |
| Contacto VAPID | `CONTACTO` en `supabase/functions/lia-avisos/logica.js` | Es la dirección de la app (Apple y Google lo piden en la firma). |

Ninguna clave privada pasa por el repositorio, por el chat ni por el panel. Si se borran las claves VAPID de Vault, la función crea otras y todos los teléfonos tienen que volver a activar los recordatorios.

## Límites conocidos

- Android puede atrasar un aviso unos minutos si el teléfono está en ahorro de batería.
- El aviso llega aunque el horario haya cambiado en otro teléfono, porque cada teléfono programa sus propios avisos con sus datos (los horarios no se sincronizan entre teléfonos).
- Sin internet en el teléfono, el aviso llega cuando vuelve la conexión, si todavía está a tiempo (hasta 1 hora después).

## Pruebas

- `node --test`: cálculo de los avisos (`avisosDe()`), cifrado y firma Web Push (`pruebas/avisos-envio.test.mjs`) y la función con Supabase y el servicio de push simulados.
- Navegador (Playwright): activar en Pro, candado en Gratis, programación enviada a Supabase y un aviso entregado al service worker con el protocolo de DevTools.
- En el teléfono real: «Enviarme un aviso de prueba» en Android y en un iPhone con la app instalada.
