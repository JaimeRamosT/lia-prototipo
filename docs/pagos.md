# LIA · Cobro real de LIA Pro: Mercado Pago y preventa con Yape

4 de noviembre de 2026. Especificación (paso 1 de `docs/fabrica.md`). Responde al supervisor («tráeme 100 ventas»). Coconut eligió **Mercado Pago Checkout Pro y, en paralelo, una preventa con Yape a mano**. Reemplaza la recomendación de Culqi de `docs/cuentas-y-planes.md` (sección «Qué revisar al crecer»).

> **Borrador, sin aprobar.** Coconut definirá la especificación de pagos cuando tenga los costos de los servicios (proyección en el libro «LIA-costos-por-usuarios»). Mientras, el desarrollo avanza **apagado**: no se lanza hasta que él lo indique. La preventa con Yape ya está aparte, en `docs/preventa.md`.

## Problema

Hoy LIA Pro solo se «compra» con un checkout de prueba (`simular_pago`) que no cobra, así que no hay ninguna venta real que mostrar. Para cobrar hace falta:
- una página de pago con los medios que usan los estudiantes (Yape y tarjeta);
- un servidor que confirme el pago antes de activar Pro;
- no recibir datos de tarjeta en la página de LIA, porque el plan gratuito de Cloudflare no lo permite.

## Objetivos

1. Una persona con cuenta de LIA paga Pro (mensual o por ciclo) con **Yape o tarjeta** y Pro se activa solo, sin intervención del equipo.
2. **Nunca** se activa Pro sin un pago aprobado, del monto correcto y en soles, ni dos veces por el mismo pago.
3. Las primeras ventas se pueden hacer **hoy**, con la preventa por Yape (`docs/preventa.md`), antes de terminar la integración.
4. Quien no está en la prueba sigue viendo el checkout de prueba de siempre, hasta que Coconut prenda el cobro real.

## No-objetivos

- **Renovación automática.** Al comienzo, cada periodo es un pago único, por mes o por ciclo. Yape no hace débito mes a mes. La suscripción con tarjeta de Mercado Pago queda para P2.
- **Comprobantes (boleta o factura).** Dependen del RUC. Validarlo con un contador antes de vender a desconocidos.
- **Devoluciones desde la app.** Se hacen desde el panel de Mercado Pago, y Pro se quita con SQL (pasos abajo).
- **Culqi, PagoEfectivo y Plin directo.** Culqi queda como plan B cuando haya RUC y volumen (comisión más baja).

## Decisión (ADR-007)

**Estado:** propuesta, 4-nov-2026. Decide Coconut cuando tenga los costos. La cuenta de Mercado Pago es suya, como persona natural.

| Opción | A favor | En contra | Decisión |
| --- | --- | --- | --- |
| **Mercado Pago Checkout Pro** | Tarjeta, Yape y saldo de Mercado Pago en la página de Mercado Pago. La tarjeta nunca pasa por Cloudflare. Sandbox con usuarios de prueba. Avisos firmados | Comisión alta en el plan mensual (≈ 16 % por el cargo fijo de S/ 1) | **Sí** |
| Culqi Checkout | Comisión menor (≈ 10 % en el mensual y 5,4 % en el ciclo), del BCP, acepta Yape | Pide RUC y una evaluación. Su ventana va dentro de LIA y hay que abrir la CSP | Plan B |
| Yape a mano (preventa) | Sin código, comisión 0 a 2,95 % | Cada pago se confirma a mano, se puede falsificar una captura y no escala | **Sí, en paralelo**, para las primeras ventas |
| API directa de Yape | La comisión más baja | Necesita un convenio con el BCP, que no es autoservicio | No |

**Piezas:**

- **`lia-pagos`** (Edge Function; `verify_jwt` apagado porque la llama Mercado Pago, y la app manda su sesión, que se revisa en la función):
  - `POST {accion:'estado'}`, con la sesión: devuelve el modo (`demo`, `prueba` o `real`) que ve esa cuenta.
  - `POST {accion:'crear', periodo}`, con la sesión:
    - Crea en la base un pago pendiente con el precio de `precio()`. El precio lo decide el servidor, nunca la app.
    - Crea una preferencia de Checkout Pro con un solo producto («LIA Pro · Mensual» o «LIA Pro · Por ciclo»), en soles, en 1 cuota, con `external_reference` igual al id del pago pendiente, las direcciones de regreso a LIA (`?pago=<id>`) y `notification_url` hacia esta función. Manda `X-Idempotency-Key` con el id del pago pendiente.
    - Devuelve la dirección de pago de Mercado Pago (`init_point`, también en las pruebas).
  - `POST` de Mercado Pago (aviso de pago):
    - Revisa la firma `x-signature` con `MP_WEBHOOK_SECRET`: HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
    - **Consulta el pago a la API** (`/v1/payments/<id>`) con `MP_ACCESS_TOKEN`; nunca se confía en el cuerpo del aviso.
    - Si está aprobado, en soles y por el monto del pago pendiente, llama a `registrar_pago_mp()`. Responde 200 en menos de 22 segundos.
  - `POST {accion:'revisar', ref}`, con la sesión: al volver de Mercado Pago, la app pide revisar ese pago (por si el aviso tarda). Busca en la API los pagos con ese `external_reference` y los registra igual que un aviso.
- **Base** (migración nueva):
  - `pagos_mp`: pago pendiente y su resultado (cuenta, periodo, monto, estado, id del pago en Mercado Pago único, medio). Sin permisos directos para nadie.
  - `crear_pago_mp(cuenta, periodo)`, `pago_mp_de(cuenta, id)` y `registrar_pago_mp(id, pago, estado, monto, moneda, medio)`, solo de `service_role`. `registrar_pago_mp` activa o extiende Pro con `demo = false` y anota el pago en `pagos` (`referencia = 'mp:<id del pago>'`). Es idempotente: el mismo pago de Mercado Pago no se registra dos veces, ni un pago pendiente se aprueba dos veces.
  - El medio de pago admite también `mercadopago` (saldo de la cuenta).
- **Dos banderas, las dos apagadas:**
  - En la app, `PAGOS_MP.activo` (junto a `PREVENTA`). Con `false`, la app no llama a `lia-pagos` para empezar un pago: todo sigue como hoy. (Solo lo llama al volver de un pago ya creado, con `?pago=`.)
  - En el servidor (en la cuenta, no en el navegador), el secreto `PAGOS_MODO`: `demo` (por defecto), `prueba` o `real`. Con `prueba`, solo ven Mercado Pago las cuentas de `PAGOS_CORREOS`; las demás siguen con el checkout de siempre. Así se prueba en la app instalada y en el celular sin que lo vea nadie más.
- **App:**
  - En el checkout, «Pagar con Mercado Pago» (Yape o tarjeta) lleva a la página de Mercado Pago.
  - Al volver (`?pago=…`), LIA muestra «Confirmando tu pago…» y revisa hasta 30 segundos.
  - Si se aprueba: «Ya tienes LIA Pro». Si queda pendiente: «Tu pago está en revisión; te aviso cuando se apruebe». Si se rechaza o se cancela: «No se te cobró nada».
  - En modo `demo`, todo sigue igual que hoy.

**Un pago real no se renueva solo.** `registrar_pago_mp` deja la renovación automática apagada y `cambiar_renovacion` ya no la deja prender en un Pro real: si no, «Reactivar renovación» en un mensual pagado con tarjeta haría que `mi_suscripcion` lo renovara gratis cada mes. En Perfil, ese botón solo aparece en el Pro de prueba. La renovación automática real (suscripciones de Mercado Pago) queda para P2.

**Privacidad y seguridad:**
- LIA nunca ve la tarjeta ni el Yape de la persona; solo el resultado y el medio («yape», «tarjeta»).
- `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` viven solo como secretos de las Edge Functions.
- Los registros nunca llevan tokens, correos, montos por persona ni ids de pago completos.
- La app sigue sin poder escribir en `suscripciones` ni en `pagos`.

## Requisitos (P0) y criterios de aceptación

1. **Pagar.** Dada una cuenta en `PAGOS_CORREOS` con `PAGOS_MODO=prueba`, cuando toca «Pagar con Mercado Pago», va a la página de Mercado Pago con el monto de `precio()`. Ahí paga con Yape o tarjeta de prueba, vuelve a LIA y Pro aparece activo en 30 segundos o menos.
2. **Nada sin pago aprobado.**
   - Un aviso sin firma válida no cambia nada (401).
   - Un pago rechazado, pendiente, de otro monto o en otra moneda no activa Pro.
   - El mismo pago avisado dos veces (o avisado y revisado) suma el periodo una sola vez.
3. **Extender.** Si ya es Pro, el periodo nuevo se suma al final del actual, como en `simular_pago`.
4. **Sin bandera, sin cambios.** Con `PAGOS_MODO=demo`, o para una cuenta fuera de `PAGOS_CORREOS` en `prueba`, el checkout es el de hoy. Las pruebas actuales siguen en verde.
5. **Registros.** Nunca llevan tokens, correos ni datos de pago.

## P1

- En la hoja de Mercado Pago, un enlace «Prefiero yapear directo» a la preventa (`docs/preventa.md`), si sigue abierta.
- Métrica anónima `pago` en `eventos_uso` (cuántos llegan a pagar), sin montos ni personas.

## P2

- Suscripción mensual automática con tarjeta (API de suscripciones de Mercado Pago). Su documentación dice que también acepta Yape: hay que probarlo.
- Pasar a Culqi cuando haya RUC y volumen; `pagos_mp` y `registrar_pago_mp` ya separan la pasarela del plan.

## Configurar (Coconut, con su cuenta de Mercado Pago)

1. En mercadopago.com.pe, crea o usa tu cuenta. En **Tus integraciones**, crea una aplicación de tipo «Pagos online» → **Checkout Pro**.
2. En **Cuentas de prueba**, crea dos usuarios de prueba: un vendedor y un comprador. Entra al panel de desarrolladores con el **vendedor de prueba**, crea ahí la misma aplicación y copia sus **credenciales de producción** (así lo pide Mercado Pago para probar Checkout Pro; no cobran porque la cuenta es de prueba).
3. En **Webhooks** → **Configurar notificaciones**:
   - URL: `https://lvtthltugrpbqjezwnsd.supabase.co/functions/v1/lia-pagos`
   - Evento: **Pagos**
   - Guarda y copia la **clave secreta**.
4. En Supabase → Edge Functions → **Secrets**:

   | Secreto | Valor |
   | --- | --- |
   | `MP_ACCESS_TOKEN` | El Access Token de producción del vendedor de prueba (después, el de tu cuenta) |
   | `MP_WEBHOOK_SECRET` | La clave secreta de los webhooks |
   | `PAGOS_MODO` | `prueba` |
   | `PAGOS_CORREOS` | Tu correo de LIA (y el de quien pruebe), separados por comas |

5. Paga desde la app con el **comprador de prueba** (inicia sesión con él en la página de Mercado Pago). Como documento usa «Otro» con 9 dígitos; las tarjetas de prueba están en la documentación de Mercado Pago.
6. Para cobrar de verdad:
   - Cambia `MP_ACCESS_TOKEN` por el de producción de tu cuenta y vuelve a copiar la clave de los webhooks de esa aplicación.
   - **Antes de `PAGOS_MODO=real`, cierra el pago de prueba:** `cuentas_prueba` debe tener al menos un correo (`docs/preventa.md`, «Abrir la preventa»). Si está vacía, `simular_pago` sigue abierto a toda cuenta y cualquiera tendría Pro gratis.
   - Pon `PAGOS_MODO=real` y `PAGOS_MP.activo = true` en `index.html`. Antes, valida lo tributario con un contador.

**Preventa con Yape:** ver `docs/preventa.md`.

**Devolver un pago:** devuélvelo en el panel de Mercado Pago (o por Yape) y quita Pro con `select * from public.quitar_pro('correo');`.

**Revisar en los registros de `lia-pagos`** (sin ids ni correos; búscalos en el panel de Mercado Pago):
- `duplicado`: alguien pagó dos veces el mismo pedido. LIA suma el periodo una sola vez: devuelve el segundo pago.
- `devuelto`: Mercado Pago devolvió o desconoció un pago ya aprobado. Pro se queda hasta que uses `quitar_pro`.
- `monto_distinto`: se pagó un monto que no es el precio. No se activa Pro; la app le ofrece escribir por el WhatsApp de la preventa (`PREVENTA.whatsapp`).

## Frases de prueba

| Caso | Resultado esperado |
| --- | --- |
| Cuenta en la prueba, paga el ciclo con tarjeta de prueba | Pro hasta 4 meses después; un pago real en `pagos` |
| El mismo aviso llega 3 veces | Un solo pago y un solo periodo |
| Aviso con firma falsa | 401, nada cambia |
| Pago rechazado | «No se te cobró nada», Pro sin cambios |
| Pago aprobado por S/ 1.00 | No se activa; queda anotado como «monto distinto» |
| Cuenta fuera de `PAGOS_CORREOS` | Checkout de prueba como hoy |
| Volver con `?pago=` antes de que llegue el aviso | «Confirmando tu pago…» y Pro activo en 30 s o menos |
| `PAGOS_MP = false` en la app | Ninguna llamada a `lia-pagos`, checkout de siempre |

## Métricas

- Ventas reales, contando preventa y Mercado Pago: meta 10 en la primera semana del piloto y 100 hacia el fin de ciclo (pedido del supervisor).
- De quienes tocan «Pagar con Mercado Pago», cuántos vuelven con Pro: meta ≥ 60 %.
- Pagos con Pro activado sin intervención: 100 %.

## Estado del desarrollo (4-nov-2026)

En la rama `feat/pagos-mercadopago`, sin publicar ni desplegar:
- Migración `20261104150000_pagos_mp.sql`, con pruebas en `pruebas/sql/pagos_mp.sql.mjs`.
- `supabase/functions/lia-pagos/` (`logica.js` e `index.ts`), con pruebas en `pruebas/pagos-mp.test.mjs`.
- App: `PAGOS_MP`, `sheetMercadoPago`, `alVolverDePago`, con pruebas en `pruebas/navegador/pagos-mp.nav.mjs` (iPhone, Android y computadora).

Límites conocidos (no bloquean: el aviso de Mercado Pago activa Pro igual):
- Si la persona vuelve sin sesión iniciada, o cierra «Confirmando tu pago», la app deja de preguntar; ve su Pro al abrir LIA con su cuenta.
- La referencia guardada en el navegador (`lia.pagoMp`) se borra al confirmarse el pago o al rechazarse; si no, queda hasta el próximo pago.

Falta, cuando Coconut lo indique: aplicar la migración, desplegar `lia-pagos` (`verify_jwt` apagado), poner los secretos y probar con los usuarios de prueba de Mercado Pago en el celular y en la app instalada.

## Esfuerzo

Unos 2 días con la fábrica: base y `lia-pagos` (1), app (0.5), pruebas, revisión y experiencia (0.5). La preventa queda lista el primer día.

## Preguntas abiertas

- **Coconut:** precio y forma de cobro definitivos, cuando tengas los costos. Si alguien pide su dinero de vuelta, ¿quién lo devuelve? (La cuenta de Mercado Pago es tuya, como persona natural.)
- **Probar en el iPhone:** si la app instalada vuelve bien desde la página de Mercado Pago (en iOS, la página de pago puede abrirse fuera de la app instalada).
- **Contador:** comprobantes de pago y régimen tributario (Nuevo RUS o RER).
