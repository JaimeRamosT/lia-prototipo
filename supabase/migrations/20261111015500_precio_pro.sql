-- Precio de LIA Pro desde el 10 de noviembre de 2026: S/ 15 al mes y S/ 54.90 por ciclo de 4 meses (antes S/ 9.90 y S/ 34.90).
-- Debe coincidir con PRICES en index.html (lo revisa pruebas/precios.test.mjs).
-- Quien ya pagó sigue con Pro hasta su fecha: la preventa no se renueva sola. registrar_preventa() solo acepta el precio
-- nuevo, así que activa con el monto viejo los pagos que llegaron antes de aplicar esta migración.
-- Se puede aplicar dos veces sin error.

create or replace function public.precio(p_periodo text) returns numeric
language sql immutable set search_path = '' as $$
  select (case p_periodo when 'mes' then 15.00 when 'ciclo' then 54.90 end)::numeric
$$;

revoke all on function public.precio(text) from public, anon, authenticated;
