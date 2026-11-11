# LIA · Preventa de LIA Pro con Yape o Plin

4 de noviembre de 2026. Pedido de Coconut: tener lista la preventa con Yape mientras se construye el cobro con Mercado Pago (`docs/pagos.md`, en borrador y pospuesto hasta que Coconut lo indique). El número del equipo (956 387 807) recibe por **Plin**, no tiene Yape: desde 2023 Yape y Plin se pueden enviar dinero entre sí, así que la persona paga con cualquiera de los dos (en Yape elige «Plin» como destino). Pago único por mes (S/ 15) o por ciclo de 4 meses (S/ 54.90), desde el 10 de noviembre de 2026 (antes S/ 9.90 y S/ 34.90). Sin renovación automática.

## Cómo funciona

1. En la app, «Pasarme a Pro» → elige el plan → **Continuar**. Sin cuenta, primero la crea.
2. El checkout le dice cuánto enviar por Yape o Plin y a qué número (con **Copiar número**). Si `PREVENTA.titular` tiene el nombre que muestra la app al pagar, le avisa: si no coincide, que no envíe el pago; si está vacío, le pide revisar el número antes de confirmar. **Enviar por WhatsApp** abre el chat del equipo con el mensaje ya escrito: el plan, el monto y su correo en LIA. Solo le falta agregar el número de operación.
3. El equipo revisa en su app de Plin que llegó el monto y, en Supabase → SQL Editor, activa Pro (el último dato es con qué pagó la persona: `'yape'` o `'plin'`; si no se pone, queda `'yape'`):

   ```sql
   select * from public.registrar_preventa('correo@de-la-persona.pe', 'ciclo', 54.90, 'NUMERO-DE-OPERACION', 'plin');
   ```

   - El monto tiene que ser el precio del plan, y el número de operación es obligatorio (de 4 a 40 letras, números o guiones; se guarda sin espacios y en mayúsculas): la misma operación no se registra dos veces.
   - Pro dura el periodo desde el día en que lo activas, no desde que la persona yapeó: actívalo el mismo día.
   - Si la cuenta ya es Pro, el periodo se suma al final.
   - Es un pago real: `demo = false`, con el medio (`yape` o `plin`) y la operación en `pagos.referencia`.
4. La persona toca **Ya me activaron: revisar mi plan**, o simplemente abre LIA, y ya tiene Pro. Si todavía no está activo (o, si ya era Pro, si su Pro no se alargó), el aviso aparece en la misma hoja.

## Mensaje para quien pide Pro por WhatsApp

Cuando alguien escribe al equipo (o se interesa en persona) sin pasar por la app, envíale este mensaje. Pide lo mismo que el mensaje que arma la app: el plan, el correo de su cuenta en LIA y el número de operación. Si cambia el precio, el número o el plazo de activación, cambia también este texto.

```text
Hola, gracias por tu interés en LIA Pro. Para activarlo:

1. Elige tu plan: *Mensual, S/ 15.00* o *Por ciclo (4 meses), S/ 54.90*.
2. Envía el monto por Yape o Plin al *956 387 807*. Si pagas con Yape, elige «Plin» como destino. Antes de confirmar, revisa que el número sea ese.
3. Respóndenos por aquí con:
   - el plan que elegiste,
   - el correo con el que entras a LIA (si aún no tienes cuenta, créala en Perfil → «Crear cuenta»: https://lia-prototipo.jaime-ramos-93c.workers.dev),
   - el número de operación que te muestra tu app al pagar.

Activamos tu Pro en menos de 24 horas y te avisamos por aquí. Tu Pro empieza el día que lo activamos. Es un pago único: no se renueva solo, y al terminar vuelves a Gratis sin perder tus datos.
```

Con su respuesta, activa Pro con `registrar_preventa` (paso 3). Si el correo no tiene cuenta, la función lo avisa: pídele que la cree con ese correo.

## Cambio de precio (10 de noviembre de 2026)

- LIA Pro pasó de S/ 9.90 a **S/ 15 al mes** y de S/ 34.90 a **S/ 54.90 por ciclo** (8.5 % menos que 4 meses sueltos: la app muestra «Ahorras S/ 5.10 (8%)», porque redondea hacia abajo para no prometer más ahorro del real).
- El precio está en `PRICES` (`index.html`) y en `precio()` (migración `20261111015500_precio_pro.sql`). `pruebas/precios.test.mjs` revisa que digan lo mismo.
- **Antes de aplicar la migración, activa los pagos que llegaron con el precio anterior.** Después, `registrar_preventa` solo acepta el precio nuevo.
- **Aplica la migración el mismo día que integras a `main`.** Mientras la app muestre un precio y la base tenga el otro, `registrar_preventa` rechaza lo que la persona pagó. Comprueba en el SQL Editor con `select public.precio('mes'), public.precio('ciclo');`: debe dar 15.00 y 54.90. Al 10-nov, la lista de migraciones de producción llega solo hasta el 3-nov, así que revisa que esta se aplique.
- **Si alguien paga el precio anterior después del cambio** (por ejemplo, con la app abierta desde antes), no se puede activar con ese monto. Pídele la diferencia y activa con el precio nuevo y la operación del primer pago (anota la segunda operación fuera de la base), o devuélvele lo que pagó.
- Quien ya tiene Pro lo mantiene hasta su fecha: la preventa no se renueva sola.

## Abrir la preventa (una vez)

1. En `index.html`, `PREVENTA` (junto a `PRICES`) ya tiene los datos de Coconut (4-nov-2026):
   - `numero`: 956387807, el número que recibe (por Plin), 9 dígitos.
   - `titular`: vacío por ahora. Opcional: el nombre que verá la persona al pagar.
   - `whatsapp`: 51956387807, el número para recibir el aviso, con 51 y sin espacios.

   **Esos números quedan visibles para quien abra el checkout.** Si `numero` o `whatsapp` quedan vacíos, el checkout vuelve a ser el de prueba.
2. Aplica la migración `20261104140000_preventa.sql` en el SQL Editor (ya la tienes como archivo).
3. Cierra el pago de prueba para el público, también en el servidor. Agrega los correos de quienes prueban:

   ```sql
   insert into public.cuentas_prueba (correo) values ('tu-correo@ejemplo.com');
   ```

   Con al menos un correo en `cuentas_prueba`:
   - `simular_pago` solo funciona para esas cuentas, y solo si ya confirmaron su correo. Para ellas, el checkout de prueba se ve con `?pruebas=1`.
   - Un Pro de prueba con renovación automática (mensual con tarjeta, demo) ya no se renueva gratis en las demás cuentas: al vencer vuelve a Gratis (`mi_suscripcion`).
   - Si alguien fuera de la lista abre `?pruebas=1` y toca «Simular pago aprobado», el servidor lo rechaza y «Intentar de nuevo» lo lleva a la preventa con Yape.

   Para reabrirlo a todos: `delete from public.cuentas_prueba;`.

## Devolver o corregir

- Devuelve el dinero por Yape y quita Pro: `select * from public.quitar_pro('correo');`. El historial de pagos se queda (`pagos` no admite montos negativos): anota la devolución fuera de la base.
- Si te equivocaste de plan, quita Pro y vuelve a registrar con otra operación. La anterior ya quedó usada: anota la corrección.

## Seguridad

- `registrar_preventa`, `quitar_pro`, `prueba_permitida` y `cuentas_prueba` son solo del SQL Editor. Ni la app (`anon`, `authenticated`) ni las Edge Functions (`service_role`) pueden llamarlas o leerlas.
- La app sigue sin escribir en `suscripciones` ni en `pagos`.
- Lo tributario (comprobantes, RUC) se valida con un contador antes de vender a desconocidos.
