-- Preventa de LIA Pro con Yape (docs/preventa.md, 4-nov-2026). Se puede aplicar dos veces sin error.
-- La persona yapea el precio, el equipo revisa en su app de Yape que llegó y activa Pro desde el SQL Editor con
-- registrar_preventa(). Es un pago real (demo = false) y queda en `pagos` con el número de operación de Yape, que no
-- se puede registrar dos veces. quitar_pro() deshace un Pro (por ejemplo, tras devolver un pago).
-- Solo para el SQL Editor: ni anon ni authenticated ni service_role pueden llamarlas.
-- cuentas_prueba: mientras esté vacía, el pago de prueba (simular_pago) sigue abierto para todos, como hasta hoy. Al
-- abrir la preventa, se agregan ahí los correos de quienes prueban, y para las demás cuentas el pago de prueba se cierra
-- también en el servidor (no solo en la app).

create table if not exists public.cuentas_prueba (
  correo text primary key,
  creado timestamptz not null default now()
);
alter table public.cuentas_prueba enable row level security;
revoke all on public.cuentas_prueba from anon, authenticated;

-- simular_pago como en 20261026005847_cuentas_y_suscripciones.sql, con el cierre de la preventa.
create or replace function public.simular_pago(p_periodo text, p_medio text) returns public.suscripciones
language plpgsql security definer set search_path = '' as $$
declare
  v_hoy date := public.hoy_lima();
  s public.suscripciones;
  v_base date;
begin
  if p_periodo is null or p_periodo not in ('mes', 'ciclo') then
    raise exception 'Plan no válido: %', p_periodo using errcode = '22023';
  end if;
  if p_medio is null or p_medio not in ('yape', 'plin', 'tarjeta') then
    raise exception 'Medio de pago no válido: %', p_medio using errcode = '22023';
  end if;
  s := public.mi_suscripcion();  -- también exige sesión iniciada
  -- Con la preventa abierta (hay cuentas en cuentas_prueba), solo esas cuentas simulan pagos.
  if exists (select 1 from public.cuentas_prueba)
     and not exists (select 1 from public.cuentas_prueba c join auth.users u on lower(u.email) = lower(c.correo) where u.id = s.user_id) then
    raise exception 'pago_de_prueba_cerrado' using errcode = '42501',
      hint = 'LIA Pro se paga con Yape (preventa): ver docs/preventa.md.';
  end if;

  -- Si ya es Pro, el nuevo periodo se suma al final del actual.
  v_base := case when s.plan = 'pro' and s.hasta > v_hoy then s.hasta else v_hoy end;
  update public.suscripciones
     set plan = 'pro',
         periodo = p_periodo,
         medio = p_medio,
         desde = case when s.plan = 'pro' then coalesce(s.desde, v_hoy) else v_hoy end,
         hasta = (v_base + make_interval(months => public.meses(p_periodo)))::date,
         renovacion_automatica = (p_periodo = 'mes' and p_medio = 'tarjeta'),
         demo = true,
         actualizado = now()
   where user_id = s.user_id
   returning * into s;
  insert into public.pagos (user_id, periodo, medio, monto, demo)
  values (s.user_id, p_periodo, p_medio, public.precio(p_periodo), true);
  return s;
end
$$;
revoke all on function public.simular_pago(text, text) from public, anon;
grant execute on function public.simular_pago(text, text) to authenticated;

alter table public.pagos add column if not exists referencia text;
comment on column public.pagos.referencia is 'Número de operación del pago real (Yape en la preventa). Único: el mismo pago no se registra dos veces.';
create unique index if not exists pagos_referencia_unica on public.pagos (referencia) where referencia is not null;

create or replace function public.registrar_preventa(p_correo text, p_periodo text, p_monto numeric, p_operacion text)
returns public.suscripciones
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_hoy date := public.hoy_lima();
  v_op text := nullif(regexp_replace(coalesce(p_operacion, ''), '\s', '', 'g'), '');
  v_activo boolean;
  s public.suscripciones;
begin
  if p_periodo is null or p_periodo not in ('mes', 'ciclo') then
    raise exception 'Plan no válido: %. Usa ''mes'' o ''ciclo''.', p_periodo using errcode = '22023';
  end if;
  if p_monto is null or p_monto <> public.precio(p_periodo) then
    raise exception 'El monto (S/ %) no coincide con el precio del plan % (S/ %).', p_monto, p_periodo, public.precio(p_periodo) using errcode = '22023';
  end if;
  if v_op is null or length(v_op) < 4 or length(v_op) > 40 then
    raise exception 'Falta el número de operación de Yape (lo ves en el detalle del yapeo).' using errcode = '22023';
  end if;
  if exists (select 1 from public.pagos where referencia = v_op) then
    raise exception 'La operación % ya se registró: no se activa dos veces.', v_op using errcode = '23505';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_correo));
  if v_uid is null then
    raise exception 'No hay ninguna cuenta de LIA con el correo %.', p_correo using errcode = 'P0002';
  end if;
  insert into public.suscripciones (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into s from public.suscripciones where user_id = v_uid for update;
  -- Si ya es Pro, el periodo nuevo se suma al final del actual (como simular_pago).
  v_activo := s.plan = 'pro' and s.hasta > v_hoy;
  update public.suscripciones
     set plan = 'pro',
         periodo = p_periodo,
         medio = 'yape',
         desde = case when v_activo then coalesce(s.desde, v_hoy) else v_hoy end,
         hasta = ((case when v_activo then s.hasta else v_hoy end) + make_interval(months => public.meses(p_periodo)))::date,
         renovacion_automatica = false,
         demo = false,
         actualizado = now()
   where user_id = v_uid
   returning * into s;
  insert into public.pagos (user_id, periodo, medio, monto, demo, referencia)
  values (v_uid, p_periodo, 'yape', p_monto, false, v_op);
  return s;
end
$$;

-- Quita Pro de una cuenta (vuelve a Gratis; sus datos se quedan). El historial de pagos no se borra.
create or replace function public.quitar_pro(p_correo text) returns public.suscripciones
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  s public.suscripciones;
begin
  select id into v_uid from auth.users where lower(email) = lower(trim(p_correo));
  if v_uid is null then
    raise exception 'No hay ninguna cuenta de LIA con el correo %.', p_correo using errcode = 'P0002';
  end if;
  update public.suscripciones
     set plan = 'gratis', periodo = null, medio = null, desde = null, hasta = null,
         renovacion_automatica = false, actualizado = now()
   where user_id = v_uid
   returning * into s;
  return s;
end
$$;

revoke all on function public.registrar_preventa(text, text, numeric, text) from public, anon, authenticated, service_role;
revoke all on function public.quitar_pro(text) from public, anon, authenticated, service_role;
