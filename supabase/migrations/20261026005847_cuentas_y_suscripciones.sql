-- LIA · cuentas, plan Gratis/Pro y pagos de prueba.
--
-- Cada cuenta tiene una fila en `suscripciones` con su plan vigente y un historial en `pagos`.
-- La app solo puede LEER lo suyo; todo cambio pasa por las funciones de abajo, que validan quién llama.
-- El checkout sigue en modo demo: `simular_pago` reemplaza al cobro real hasta integrar Culqi.
--
-- Esta migración se puede aplicar más de una vez sin error, así que sirve igual si la aplica la
-- integración de GitHub (al integrar en main) o si se pega en el SQL Editor de Supabase.

-- ---------- Tablas ----------

create table if not exists public.suscripciones (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'gratis' check (plan in ('gratis', 'pro')),
  periodo text check (periodo in ('mes', 'ciclo')),
  medio text check (medio in ('yape', 'plin', 'tarjeta', 'cortesia')),
  desde date,
  hasta date,
  renovacion_automatica boolean not null default false,
  demo boolean not null default true,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  constraint pro_completo check (plan = 'gratis' or (periodo is not null and medio is not null and hasta is not null))
);
comment on table public.suscripciones is 'Plan vigente de cada cuenta de LIA. Solo cambia mediante las funciones de este esquema.';
comment on column public.suscripciones.hasta is 'Pro termina al empezar este día, en hora de Lima.';
comment on column public.suscripciones.demo is 'true mientras el plan venga de pagos simulados o de cortesía.';

create table if not exists public.pagos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  creado timestamptz not null default now(),
  periodo text not null check (periodo in ('mes', 'ciclo')),
  medio text not null check (medio in ('yape', 'plin', 'tarjeta', 'cortesia')),
  monto numeric(8, 2) not null check (monto >= 0),
  renovacion boolean not null default false,
  demo boolean not null default true
);
comment on table public.pagos is 'Historial de pagos de cada cuenta. En modo demo no hubo cobro real.';
create index if not exists pagos_user_id_idx on public.pagos (user_id);

-- ---------- Seguridad: cada cuenta solo lee lo suyo y nadie escribe desde la app ----------

alter table public.suscripciones enable row level security;
alter table public.pagos enable row level security;

drop policy if exists "Cada cuenta ve su suscripción" on public.suscripciones;
create policy "Cada cuenta ve su suscripción" on public.suscripciones
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Cada cuenta ve sus pagos" on public.pagos;
create policy "Cada cuenta ve sus pagos" on public.pagos
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.suscripciones, public.pagos from anon, authenticated;
grant select on table public.suscripciones, public.pagos to authenticated;

-- ---------- Funciones auxiliares (solo las usan las funciones de abajo) ----------

create or replace function public.hoy_lima() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Lima')::date
$$;

create or replace function public.precio(p_periodo text) returns numeric
language sql immutable set search_path = '' as $$
  select (case p_periodo when 'mes' then 9.90 when 'ciclo' then 34.90 end)::numeric
$$;

create or replace function public.meses(p_periodo text) returns integer
language sql immutable set search_path = '' as $$
  select case p_periodo when 'mes' then 1 when 'ciclo' then 4 end
$$;

-- ---------- Alta: toda cuenta nueva empieza en Gratis ----------

create or replace function public.crear_suscripcion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.suscripciones (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end
$$;

drop trigger if exists al_crear_cuenta on auth.users;
create trigger al_crear_cuenta
  after insert on auth.users
  for each row execute function public.crear_suscripcion();

-- Cuentas que ya existían antes de esta migración.
insert into public.suscripciones (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ---------- Plan vigente (aplica vencimientos y renovaciones de prueba) ----------

create or replace function public.mi_suscripcion() returns public.suscripciones
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hoy date := public.hoy_lima();
  s public.suscripciones;
  v_vueltas integer := 0;
begin
  if v_uid is null then
    raise exception 'Necesitas iniciar sesión' using errcode = '42501';
  end if;
  insert into public.suscripciones (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into s from public.suscripciones where user_id = v_uid for update;

  -- La mensual con tarjeta se renueva sola (en modo demo, sin cobro); lo demás vuelve a Gratis.
  while s.plan = 'pro' and s.hasta <= v_hoy and v_vueltas < 60 loop
    v_vueltas := v_vueltas + 1;
    if s.renovacion_automatica then
      insert into public.pagos (user_id, periodo, medio, monto, renovacion, demo)
      values (v_uid, s.periodo, s.medio, public.precio(s.periodo), true, s.demo);
      s.hasta := (s.hasta + make_interval(months => public.meses(s.periodo)))::date;
    else
      s.plan := 'gratis';
      s.periodo := null;
      s.medio := null;
      s.desde := null;
      s.hasta := null;
      s.renovacion_automatica := false;
    end if;
  end loop;

  if v_vueltas > 0 then
    update public.suscripciones
       set plan = s.plan, periodo = s.periodo, medio = s.medio, desde = s.desde, hasta = s.hasta,
           renovacion_automatica = s.renovacion_automatica, actualizado = now()
     where user_id = v_uid
     returning * into s;
  end if;
  return s;
end
$$;

-- ---------- Modo demo: pago simulado (se reemplaza por el webhook de Culqi) ----------

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

-- Cancelar o reactivar la renovación automática (solo la mensual con tarjeta se renueva sola).
create or replace function public.cambiar_renovacion(p_activa boolean) returns public.suscripciones
language plpgsql security definer set search_path = '' as $$
declare
  s public.suscripciones;
begin
  s := public.mi_suscripcion();
  if s.plan <> 'pro' or s.periodo <> 'mes' or s.medio <> 'tarjeta' then
    raise exception 'Solo el plan mensual con tarjeta se renueva solo' using errcode = '22023';
  end if;
  update public.suscripciones
     set renovacion_automatica = coalesce(p_activa, false), actualizado = now()
   where user_id = s.user_id
   returning * into s;
  return s;
end
$$;

-- Modo demo: adelanta el fin del periodo a hoy para probar renovaciones y vencimientos.
create or replace function public.simular_fin_periodo() returns public.suscripciones
language plpgsql security definer set search_path = '' as $$
declare
  s public.suscripciones;
begin
  s := public.mi_suscripcion();
  if s.plan <> 'pro' then
    return s;
  end if;
  if not s.demo then
    raise exception 'Solo disponible en modo demo' using errcode = '42501';
  end if;
  update public.suscripciones set hasta = public.hoy_lima(), actualizado = now() where user_id = s.user_id;
  return public.mi_suscripcion();
end
$$;

-- ---------- Administración: Pro de cortesía para cuentas de prueba ----------
-- Úsala desde el SQL Editor:  select * from public.otorgar_pro('correo@ejemplo.com');
create or replace function public.otorgar_pro(p_correo text, p_periodo text default 'ciclo') returns public.suscripciones
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_hoy date := public.hoy_lima();
  s public.suscripciones;
begin
  if p_periodo is null or p_periodo not in ('mes', 'ciclo') then
    raise exception 'Plan no válido: %', p_periodo using errcode = '22023';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_correo));
  if v_uid is null then
    raise exception 'No hay ninguna cuenta con el correo %', p_correo using errcode = 'P0002';
  end if;
  insert into public.suscripciones (user_id) values (v_uid) on conflict (user_id) do nothing;
  update public.suscripciones
     set plan = 'pro',
         periodo = p_periodo,
         medio = 'cortesia',
         desde = v_hoy,
         hasta = (v_hoy + make_interval(months => public.meses(p_periodo)))::date,
         renovacion_automatica = false,
         demo = true,
         actualizado = now()
   where user_id = v_uid
   returning * into s;
  insert into public.pagos (user_id, periodo, medio, monto, demo)
  values (v_uid, p_periodo, 'cortesia', 0, true);
  return s;
end
$$;

-- ---------- Permisos de las funciones ----------
-- Postgres permite ejecutar funciones a PUBLIC por defecto y Supabase las expone en su API:
-- se quitan esos permisos y solo se devuelven los necesarios.

revoke all on function public.hoy_lima(), public.precio(text), public.meses(text), public.crear_suscripcion()
  from public, anon, authenticated;

revoke all on function public.mi_suscripcion(), public.simular_pago(text, text),
  public.cambiar_renovacion(boolean), public.simular_fin_periodo()
  from public, anon;
grant execute on function public.mi_suscripcion(), public.simular_pago(text, text),
  public.cambiar_renovacion(boolean), public.simular_fin_periodo()
  to authenticated;

revoke all on function public.otorgar_pro(text, text) from public, anon, authenticated;
