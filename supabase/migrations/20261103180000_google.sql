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

-- Estados del permiso (un solo uso, 10 minutos). El regreso de Google deja el permiso pendiente (token_id, listo) y solo
-- la app de esa cuenta, con el nonce que guardó ese navegador (nonce_hash), lo confirma: nadie puede atar su Google a la
-- cuenta de otro ni el de otro a la suya.
create table if not exists public.google_estados (
  estado text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  origen text not null,
  nonce_hash text not null,
  token_id uuid,
  listo boolean not null default false,
  vence timestamptz not null
);
create index if not exists google_estados_user on public.google_estados (user_id);

-- Al borrar una cuenta de Google o un permiso pendiente (también en cascada desde auth.users), su secreto sale de Vault.
create or replace function public.google_borrar_secreto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.token_id is not null then delete from vault.secrets where id = old.token_id; end if;
  return old;
end $$;
revoke all on function public.google_borrar_secreto() from public, anon, authenticated;
drop trigger if exists google_cuentas_secreto on public.google_cuentas;
create trigger google_cuentas_secreto after delete on public.google_cuentas for each row execute function public.google_borrar_secreto();
drop trigger if exists google_estados_secreto on public.google_estados;
create trigger google_estados_secreto after delete on public.google_estados for each row execute function public.google_borrar_secreto();

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
create or replace function public.google_nuevo_estado(p_user uuid, p_origen text, p_nonce text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if p_nonce is null or length(p_nonce) < 32 then raise exception 'nonce'; end if;
  delete from public.google_estados where vence < now() or user_id = p_user;
  insert into public.google_estados (estado, user_id, origen, nonce_hash, vence)
  values (v, p_user, left(coalesce(p_origen, ''), 200), p_nonce, now() + interval '10 minutes');
  return v;
end $$;

-- El regreso de Google: a qué cuenta y a qué dirección de LIA volver (sin consumir el estado).
create or replace function public.google_ver_estado(p_estado text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('user_id', user_id, 'origen', origen) from public.google_estados
  where estado = p_estado and not listo and vence > now()
$$;

-- Guarda el permiso recién dado como pendiente (en Vault) por 10 minutos más.
create or replace function public.google_estado_listo(p_estado text, p_refresh text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.google_estados where estado = p_estado and not listo and vence > now()) then return false; end if;
  v_id := vault.create_secret(p_refresh, 'google_pend_' || p_estado, 'Permiso de Google pendiente de confirmar');
  update public.google_estados set token_id = v_id, listo = true, vence = now() + interval '10 minutes' where estado = p_estado;
  return true;
end $$;

-- La app confirma con su sesión y su nonce: devuelve el permiso una sola vez (y lo saca de los pendientes).
create or replace function public.google_confirmar_estado(p_estado text, p_user uuid, p_nonce text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.google_estados; v text;
begin
  select * into r from public.google_estados where estado = p_estado and listo and vence > now() and user_id = p_user and nonce_hash = p_nonce;
  if r.estado is null then return null; end if;
  select decrypted_secret into v from vault.decrypted_secrets where id = r.token_id;
  delete from public.google_estados where estado = p_estado;
  return jsonb_build_object('refresh', v);
end $$;

create or replace function public.google_limpiar_estados() returns void
language sql security definer set search_path = '' as $$
  delete from public.google_estados where vence < now()
$$;

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
language sql security definer set search_path = '' as $$
  delete from public.google_cuentas where user_id = p_user;   -- el disparador saca el secreto de Vault
  delete from public.google_estados where user_id = p_user;
$$;

revoke all on function public.google_nuevo_estado(uuid, text, text), public.google_ver_estado(text), public.google_estado_listo(text, text),
  public.google_confirmar_estado(text, uuid, text), public.google_limpiar_estados(),
  public.google_guardar(uuid, text, text, text, text, text, timestamptz), public.google_cuenta(uuid), public.google_por_canal(text),
  public.google_avisar(uuid), public.google_cal_lia(uuid, text), public.google_vencida(uuid), public.google_canales_por_vencer(),
  public.google_actualizar_canal(uuid, text, text, text, timestamptz), public.google_borrar(uuid) from public, anon, authenticated;
grant execute on function public.google_nuevo_estado(uuid, text, text), public.google_ver_estado(text), public.google_estado_listo(text, text),
  public.google_confirmar_estado(text, uuid, text), public.google_limpiar_estados(),
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
