# LIA · Preventa de LIA Pro con Yape

4 de noviembre de 2026. Pedido de Coconut: tener lista la preventa con Yape mientras se construye el cobro con Mercado Pago (`docs/pagos.md`, en borrador hasta tener los costos). Pago único por mes (S/ 9.90) o por ciclo (S/ 34.90). Sin renovación automática.

## Cómo funciona

1. En la app, «Pasarme a Pro» → elige el plan → **Continuar**. Sin cuenta, primero la crea.
2. El checkout le dice cuánto yapear y a qué número (con **Copiar número**), y le avisa qué nombre le mostrará Yape antes de confirmar: si no coincide, que no yapee. **Enviar por WhatsApp** abre el chat del equipo con el mensaje ya escrito: el plan, el monto y su correo en LIA. Solo le falta agregar el número de operación de Yape.
3. El equipo revisa en su app de Yape que llegó el monto y, en Supabase → SQL Editor, activa Pro:

   ```sql
   select * from public.registrar_preventa('correo@de-la-persona.pe', 'ciclo', 34.90, 'NUMERO-DE-OPERACION');
   ```

   - El monto tiene que ser el precio del plan, y el número de operación es obligatorio (de 4 a 40 letras, números o guiones; se guarda sin espacios y en mayúsculas): la misma operación no se registra dos veces.
   - Pro dura el periodo desde el día en que lo activas, no desde que la persona yapeó: actívalo el mismo día.
   - Si la cuenta ya es Pro, el periodo se suma al final.
   - Es un pago real: `demo = false`, con el medio `yape` y la operación en `pagos.referencia`.
4. La persona toca **Ya me activaron: revisar mi plan**, o simplemente abre LIA, y ya tiene Pro. Si todavía no está activo (o, si ya era Pro, si su Pro no se alargó), el aviso aparece en la misma hoja.

## Abrir la preventa (una vez)

1. En `index.html`, completa `PREVENTA` (junto a `PRICES`) y publica la app (PR a `main`):
   - `yape`: el número de Yape, 9 dígitos.
   - `titular`: el nombre que verá la persona al yapear.
   - `whatsapp`: el número para recibir el aviso, con 51 y sin espacios.

   **Ese número queda visible para quien abra el checkout.** Mientras `PREVENTA` esté vacío, el checkout sigue en modo demo, como hasta ahora.
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
