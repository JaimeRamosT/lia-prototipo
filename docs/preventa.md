# LIA · Preventa de LIA Pro con Yape o Plin

4 de noviembre de 2026. Pedido de Coconut: tener lista la preventa con Yape mientras se construye el cobro con Mercado Pago (`docs/pagos.md`, en borrador y pospuesto hasta que Coconut lo indique). El número del equipo (956 387 807) recibe por **Plin**, no tiene Yape: desde 2023 Yape y Plin se pueden enviar dinero entre sí, así que la persona paga con cualquiera de los dos (en Yape elige «Plin» como destino). Pago único por mes (S/ 9.90) o por ciclo (S/ 34.90). Sin renovación automática.

## Cómo funciona

1. En la app, «Pasarme a Pro» → elige el plan → **Continuar**. Sin cuenta, primero la crea.
2. El checkout le dice cuánto enviar por Yape o Plin y a qué número (con **Copiar número**). Si `PREVENTA.titular` tiene el nombre que muestra la app al pagar, le avisa: si no coincide, que no envíe el pago; si está vacío, le pide revisar el número antes de confirmar. **Enviar por WhatsApp** abre el chat del equipo con el mensaje ya escrito: el plan, el monto y su correo en LIA. Solo le falta agregar el número de operación.
3. El equipo revisa en su app de Plin que llegó el monto y, en Supabase → SQL Editor, activa Pro (el último dato es con qué pagó la persona: `'yape'` o `'plin'`; si no se pone, queda `'yape'`):

   ```sql
   select * from public.registrar_preventa('correo@de-la-persona.pe', 'ciclo', 34.90, 'NUMERO-DE-OPERACION', 'plin');
   ```

   - El monto tiene que ser el precio del plan, y el número de operación es obligatorio (de 4 a 40 letras, números o guiones; se guarda sin espacios y en mayúsculas): la misma operación no se registra dos veces.
   - Pro dura el periodo desde el día en que lo activas, no desde que la persona yapeó: actívalo el mismo día.
   - Si la cuenta ya es Pro, el periodo se suma al final.
   - Es un pago real: `demo = false`, con el medio (`yape` o `plin`) y la operación en `pagos.referencia`.
4. La persona toca **Ya me activaron: revisar mi plan**, o simplemente abre LIA, y ya tiene Pro. Si todavía no está activo (o, si ya era Pro, si su Pro no se alargó), el aviso aparece en la misma hoja.

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
