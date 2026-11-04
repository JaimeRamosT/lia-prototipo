-- Cobro de LIA Pro con Mercado Pago Checkout Pro (docs/pagos.md, borrador del 4-nov-2026). Se puede aplicar dos veces.
-- Apagado mientras PAGOS_MODO no sea «prueba» o «real» (secreto de lia-pagos) y PAGOS_MP sea false en index.html.
-- lia-pagos (service_role) crea un pago pendiente con el precio de precio(), Mercado Pago avisa cuando se paga, y
-- registrar_pago_mp() activa o extiende Pro con demo = false. Es idempotente: el mismo pago no suma dos veces.
-- La app no tiene permisos sobre nada de esto: solo lee su plan con mi_suscripcion().

-- El saldo de la cuenta de Mercado Pago es un medio más.
alter table public.suscripciones drop constraint if exists suscripciones_medio_check;
alter table public.suscripciones add constraint suscripciones_medio_check check (medio in ('yape', 'plin', 'tarjeta', 'cortesia', 'mercadopago'));
alter table public.pagos drop constraint if exists pagos_medio_check;
alter table public.pagos add constraint pagos_medio_check check (medio in ('yape', 'plin', 'tarjeta', 'cortesia', 'mercadopago'));

create table if not exists public.pagos_mp (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  periodo text not null check (periodo in ('mes', 'ciclo')),
  monto numeric(8, 2) not null check (monto > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso', 'rechazado', 'monto_distinto', 'aprobado')),
  mp_pago text unique,          -- id del pago en Mercado Pago que lo aprobó (o que no cuadró)
  medio text check (medio in ('yape', 'tarjeta', 'mercadopago')),
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
comment on table public.pagos_mp is 'Pagos de LIA Pro con Mercado Pago (docs/pagos.md). Solo los usan las funciones de lia-pagos.';
create index if not exists pagos_mp_cuenta on public.pagos_mp (user_id, creado desc);
alter table public.pagos_mp enable row level security;
revoke all on public.pagos_mp from anon, authenticated, service_role;

-- Un pago pendiente con el precio del servidor (la app nunca dice cuánto cobrar).
create or replace function public.crear_pago_mp(p_uid uuid, p_periodo text) returns public.pagos_mp
language plpgsql security definer set search_path = '' as $$
declare
  r public.pagos_mp;
begin
  if p_periodo is null or p_periodo not in ('mes', 'ciclo') then
    raise exception 'Plan no válido: %', p_periodo using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_uid) then
    raise exception 'No existe la cuenta' using errcode = 'P0002';
  end if;
  -- Freno a los clics repetidos: como mucho 20 intentos por hora.
  if (select count(*) from public.pagos_mp where user_id = p_uid and creado > now() - interval '1 hour') >= 20 then
    raise exception 'demasiados_pagos' using errcode = '54000';
  end if;
  insert into public.pagos_mp (user_id, periodo, monto) values (p_uid, p_periodo, public.precio(p_periodo))
  returning * into r;
  return r;
end
$$;

-- El pago pendiente de esa cuenta (o una fila vacía si no es suyo).
create or replace function public.pago_mp_de(p_uid uuid, p_id uuid) returns public.pagos_mp
language sql stable security definer set search_path = '' as $$
  select * from public.pagos_mp where id = p_id and user_id = p_uid
$$;

-- Lo que Mercado Pago dice de un pago (lia-pagos lo consulta a su API, nunca confía en el aviso).
-- Devuelve: aprobado, en_proceso, rechazado, monto_distinto, repetido (ese pago ya aprobó otro), desconocido, y, cuando
-- ya estaba aprobado: duplicado (otro pago aprobado de la misma preferencia: se cobró dos veces, hay que devolverlo a
-- mano) o devuelto (Mercado Pago devolvió o desconoció el pago: Pro se queda hasta que el equipo use quitar_pro).
-- Ninguno de los dos cambia el plan: lia-pagos lo deja en su registro (sin ids) para que el equipo lo revise.
create or replace function public.registrar_pago_mp(p_id uuid, p_pago text, p_estado text, p_monto numeric, p_moneda text, p_medio text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  r public.pagos_mp;
  s public.suscripciones;
  v_hoy date := public.hoy_lima();
  v_medio text := case when p_medio in ('yape', 'tarjeta', 'mercadopago') then p_medio else 'mercadopago' end;
  v_activo boolean;
begin
  if p_pago is null or p_pago !~ '^[0-9]{1,30}$' then
    raise exception 'Id de pago no válido' using errcode = '22023';
  end if;
  select * into r from public.pagos_mp where id = p_id for update;
  if not found then
    return 'desconocido';
  end if;
  if r.estado = 'aprobado' then
    if p_pago <> r.mp_pago and p_estado = 'approved' then
      return 'duplicado';
    elsif p_pago = r.mp_pago and p_estado in ('refunded', 'charged_back') then
      return 'devuelto';
    end if;
    return 'aprobado';   -- el mismo aviso otra vez, o uno viejo que llega tarde: nada cambia
  end if;
  if exists (select 1 from public.pagos_mp where mp_pago = p_pago and id <> p_id) then
    return 'repetido';
  end if;

  if p_estado = 'approved' then
    if p_moneda is distinct from 'PEN' or p_monto is null or p_monto <> r.monto then
      update public.pagos_mp set estado = 'monto_distinto', mp_pago = p_pago, medio = v_medio, actualizado = now() where id = p_id;
      return 'monto_distinto';
    end if;
    insert into public.suscripciones (user_id) values (r.user_id) on conflict (user_id) do nothing;
    select * into s from public.suscripciones where user_id = r.user_id for update;
    -- Si ya es Pro, el periodo nuevo se suma al final del actual (como registrar_preventa).
    v_activo := s.plan = 'pro' and s.hasta > v_hoy;
    update public.suscripciones
       set plan = 'pro',
           periodo = r.periodo,
           medio = v_medio,
           desde = case when v_activo then coalesce(s.desde, v_hoy) else v_hoy end,
           hasta = ((case when v_activo then s.hasta else v_hoy end) + make_interval(months => public.meses(r.periodo)))::date,
           renovacion_automatica = false,
           demo = false,
           actualizado = now()
     where user_id = r.user_id;
    insert into public.pagos (user_id, periodo, medio, monto, demo, referencia)
    values (r.user_id, r.periodo, v_medio, r.monto, false, 'mp:' || p_pago);
    update public.pagos_mp set estado = 'aprobado', mp_pago = p_pago, medio = v_medio, actualizado = now() where id = p_id;
    return 'aprobado';
  elsif p_estado in ('rejected', 'cancelled', 'refunded', 'charged_back') then
    -- Un intento rechazado no ocupa el pago: la persona puede volver a intentar con otro medio.
    update public.pagos_mp set estado = 'rechazado', actualizado = now() where id = p_id;
    return 'rechazado';
  else
    update public.pagos_mp set estado = 'en_proceso', actualizado = now() where id = p_id;
    return 'en_proceso';
  end if;
end
$$;

-- cambiar_renovacion como en 20261026005847_cuentas_y_suscripciones.sql, pero solo para el Pro de prueba: un pago real
-- (Mercado Pago o preventa) es único y no se renueva solo todavía. Sin esto, «Reactivar renovación» en un mensual pagado
-- con tarjeta haría que mi_suscripcion lo renovara gratis cada mes.
create or replace function public.cambiar_renovacion(p_activa boolean) returns public.suscripciones
language plpgsql security definer set search_path = '' as $$
declare
  s public.suscripciones;
begin
  s := public.mi_suscripcion();
  if s.plan <> 'pro' or s.periodo <> 'mes' or s.medio <> 'tarjeta' then
    raise exception 'Solo el plan mensual con tarjeta se renueva solo' using errcode = '22023';
  end if;
  if not s.demo and coalesce(p_activa, false) then
    raise exception 'Un pago real todavía no se renueva solo' using errcode = '22023';
  end if;
  update public.suscripciones
     set renovacion_automatica = coalesce(p_activa, false), actualizado = now()
   where user_id = s.user_id
   returning * into s;
  return s;
end
$$;
revoke all on function public.cambiar_renovacion(boolean) from public, anon;
grant execute on function public.cambiar_renovacion(boolean) to authenticated;

revoke all on function public.crear_pago_mp(uuid, text) from public, anon, authenticated;
revoke all on function public.pago_mp_de(uuid, uuid) from public, anon, authenticated;
revoke all on function public.registrar_pago_mp(uuid, text, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.crear_pago_mp(uuid, text) to service_role;
grant execute on function public.pago_mp_de(uuid, uuid) to service_role;
grant execute on function public.registrar_pago_mp(uuid, text, text, numeric, text, text) to service_role;
