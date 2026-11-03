-- LIA · «Conectar con Google» (docs/google.md, ADR-005). Google Calendar al instante en los dos sentidos.
-- La base no guarda eventos ni títulos: solo el permiso de Google (en Vault), el calendario «LIA», el canal de avisos y
-- un contador por persona que la app escucha con Realtime. Sin permisos directos sobre las tablas: solo funciones.
-- Se puede aplicar dos veces sin error.

create table if not exists public.google_cuentas (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token_id uuid,                 -- secreto de Vault con el refresh token
  cal_lia text,                  -- id del calendario «LIA» en Google
  canal_id text,
  canal_recurso text,
  canal_token text,
  canal_vence timestamptz,
  estado text not null default 'activa' check (estado in ('activa', 'vencida')),
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists google_cuentas_canal on public.google_cuentas (canal_id);

-- Estados del permiso (un solo uso, 10 minutos), para que nadie pueda conectar su Google a la cuenta de otro.
create table if not exists public.google_estados (
  estado text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  origen text not null,
  vence timestamptz not null
);
create index if not exists google_estados_user on public.google_estados (user_id);

-- La señal: cada aviso de Google suma 1. La app la escucha con Realtime y pide los eventos a lia-google.
create table if not exists public.google_senal (
  user_id uuid primary key references auth.users (id) on delete cascade,
  n bigint not null default 0,
  actualizado timestamptz not null default now()
);

alter table public.google_cuentas enable row level security;
alter table public.google_estados enable row level security;
alter table public.google_senal enable row level security;
revoke all on public.google_cuentas, public.google_estados, public.google_senal from anon, authenticated;
grant select on public.google_senal to authenticated;
drop policy if exists google_senal_propia on public.google_senal;
create policy google_senal_propia on public.google_senal for select to authenticated using ((select auth.uid()) = user_id);

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'google_senal') then
    alter publication supabase_realtime add table public.google_senal;
  end if;
end $$;

-- ---------- Para lia-google (solo service_role) ----------
create or replace function public.google_nuevo_estado(p_user uuid, p_origen text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  delete from public.google_estados where vence < now() or user_id = p_user;
  insert into public.google_estados (estado, user_id, origen, vence) values (v, p_user, left(coalesce(p_origen, ''), 200), now() + interval '10 minutes');
  return v;
end $$;

create or replace function public.google_tomar_estado(p_estado text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.google_estados;
begin
  delete from public.google_estados where estado = p_estado returning * into r;
  if r.estado is null or r.vence < now() then return null; end if;
  return jsonb_build_object('user_id', r.user_id, 'origen', r.origen);
end $$;

create or replace function public.google_guardar(p_user uuid, p_refresh text, p_cal text, p_canal_id text, p_canal_recurso text,
  p_canal_token text, p_canal_vence timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select token_id into v_id from public.google_cuentas where user_id = p_user;
  if p_refresh is not null then
    if v_id is not null and exists (select 1 from vault.secrets where id = v_id) then
      perform vault.update_secret(v_id, p_refresh);
    else
      v_id := vault.create_secret(p_refresh, 'google_rt_' || p_user::text || '_' || extract(epoch from now())::bigint, 'Permiso de Google Calendar de una cuenta de LIA');
    end if;
  end if;
  insert into public.google_cuentas as c (user_id, token_id, cal_lia, canal_id, canal_recurso, canal_token, canal_vence, estado, actualizado)
  values (p_user, v_id, p_cal, p_canal_id, p_canal_recurso, p_canal_token, p_canal_vence, 'activa', now())
  on conflict (user_id) do update set token_id = excluded.token_id, cal_lia = excluded.cal_lia, canal_id = excluded.canal_id,
    canal_recurso = excluded.canal_recurso, canal_token = excluded.canal_token, canal_vence = excluded.canal_vence, estado = 'activa', actualizado = now();
  insert into public.google_senal (user_id) values (p_user) on conflict (user_id) do nothing;
end $$;

create or replace function public.google_cuenta(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('refresh', (select decrypted_secret from vault.decrypted_secrets s where s.id = c.token_id), 'cal_lia', c.cal_lia,
    'canal_id', c.canal_id, 'canal_recurso', c.canal_recurso, 'canal_token', c.canal_token, 'canal_vence', c.canal_vence, 'estado', c.estado)
  from public.google_cuentas c where c.user_id = p_user
$$;

create or replace function public.google_por_canal(p_canal text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('user_id', user_id, 'canal_token', canal_token) from public.google_cuentas where canal_id = p_canal and estado = 'activa' limit 1
$$;

create or replace function public.google_avisar(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.google_senal as s (user_id, n, actualizado) values (p_user, 1, now())
  on conflict (user_id) do update set n = s.n + 1, actualizado = now()
$$;

create or replace function public.google_cal_lia(p_user uuid, p_cal text) returns void
language sql security definer set search_path = '' as $$
  update public.google_cuentas set cal_lia = p_cal, actualizado = now() where user_id = p_user
$$;

create or replace function public.google_vencida(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  update public.google_cuentas set estado = 'vencida', actualizado = now() where user_id = p_user
$$;

create or replace function public.google_canales_por_vencer() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(user_id), '[]'::jsonb) from public.google_cuentas
  where estado = 'activa' and (canal_vence is null or canal_vence < now() + interval '2 days')
$$;

create or replace function public.google_actualizar_canal(p_user uuid, p_canal_id text, p_canal_recurso text, p_canal_token text, p_canal_vence timestamptz) returns void
language sql security definer set search_path = '' as $$
  update public.google_cuentas set canal_id = p_canal_id, canal_recurso = p_canal_recurso, canal_token = p_canal_token, canal_vence = p_canal_vence, actualizado = now()
  where user_id = p_user
$$;

create or replace function public.google_borrar(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select token_id into v_id from public.google_cuentas where user_id = p_user;
  if v_id is not null then delete from vault.secrets where id = v_id; end if;
  delete from public.google_cuentas where user_id = p_user;
  delete from public.google_estados where user_id = p_user;
end $$;

revoke all on function public.google_nuevo_estado(uuid, text), public.google_tomar_estado(text),
  public.google_guardar(uuid, text, text, text, text, text, timestamptz), public.google_cuenta(uuid), public.google_por_canal(text),
  public.google_avisar(uuid), public.google_cal_lia(uuid, text), public.google_vencida(uuid), public.google_canales_por_vencer(),
  public.google_actualizar_canal(uuid, text, text, text, timestamptz), public.google_borrar(uuid) from public, anon, authenticated;
grant execute on function public.google_nuevo_estado(uuid, text), public.google_tomar_estado(text),
  public.google_guardar(uuid, text, text, text, text, text, timestamptz), public.google_cuenta(uuid), public.google_por_canal(text),
  public.google_avisar(uuid), public.google_cal_lia(uuid, text), public.google_vencida(uuid), public.google_canales_por_vencer(),
  public.google_actualizar_canal(uuid, text, text, text, timestamptz), public.google_borrar(uuid) to service_role;

-- ---------- Cada hora, pg_cron pide a lia-google que renueve los avisos que vencen pronto ----------
-- Usa el mismo secreto de Vault que lia-avisos. Sin las claves de Google, la función no tiene cuentas que renovar.
select cron.schedule('lia-google', '23 * * * *', $cron$
  select net.http_post(
    url := 'https://lvtthltugrpbqjezwnsd.supabase.co/functions/v1/lia-google',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-lia-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'lia_avisos_secreto')),
    body := '{"accion":"renovar"}'::jsonb,
    timeout_milliseconds := 25000)
$cron$);
