-- LIA · recordatorios en el teléfono (Web Push), solo LIA Pro. Ver docs/notificaciones.md.
--
-- El servidor no guarda nombres de cursos ni de evaluaciones: por cada aviso, solo la hora, el tipo y una referencia
-- interna. El teléfono arma el texto al recibirlo. La app solo LEE sus filas; todo cambio pasa por estas funciones.
-- Las claves de firma (VAPID) las crea la función lia-avisos la primera vez y viven en Vault; el secreto con el que
-- pg_cron llama a la función lo crea esta migración. Nadie las copia a mano ni pasan por el repositorio.
--
-- Esta migración se puede aplicar más de una vez sin error.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------- Teléfonos ----------
create table if not exists public.dispositivos_push (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth text not null check (length(auth) between 10 and 100),
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
comment on table public.dispositivos_push is 'Teléfonos de cada cuenta Pro que activaron los recordatorios (suscripción Web Push). Solo cambia mediante funciones.';
create index if not exists dispositivos_push_user_idx on public.dispositivos_push (user_id);

-- ---------- Avisos programados ----------
create table if not exists public.avisos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  cuando timestamptz not null,
  tipo text not null check (tipo in ('examen_manana', 'examen_pronto', 'sesion', 'resumen', 'sin_marcar')),
  ref text not null check (length(ref) <= 60),
  enviado timestamptz
);
comment on table public.avisos is 'Recordatorios programados por cada teléfono: hora, tipo y una referencia interna, sin nombres de cursos.';
create index if not exists avisos_pendientes_idx on public.avisos (cuando) where enviado is null;
create index if not exists avisos_user_idx on public.avisos (user_id);

alter table public.dispositivos_push enable row level security;
alter table public.avisos enable row level security;
drop policy if exists "Cada cuenta ve sus teléfonos" on public.dispositivos_push;
create policy "Cada cuenta ve sus teléfonos" on public.dispositivos_push
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Cada cuenta ve sus avisos" on public.avisos;
create policy "Cada cuenta ve sus avisos" on public.avisos
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on table public.dispositivos_push, public.avisos from anon, authenticated;
grant select on table public.dispositivos_push, public.avisos to authenticated;

-- ---------- Secreto de pg_cron (lo crea la base de datos) ----------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'lia_avisos_secreto') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'lia_avisos_secreto', 'Con este valor pg_cron llama a la función lia-avisos');
  end if;
end
$$;

-- ---------- Funciones para la app (cuentas Pro con sesión) ----------
create or replace function public.solo_pro() returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.suscripciones;
begin
  s := public.mi_suscripcion();  -- exige sesión iniciada y aplica vencimientos
  if s.plan <> 'pro' then
    raise exception 'Los recordatorios en el teléfono son parte de LIA Pro' using errcode = 'P0001', hint = 'solo_pro';
  end if;
  return s.user_id;
end
$$;
revoke all on function public.solo_pro() from public, anon, authenticated;

-- La clave pública VAPID (es pública por diseño). Null hasta que lia-avisos la crea.
create or replace function public.clave_publica_avisos() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'lia_vapid_publica' limit 1
$$;
revoke all on function public.clave_publica_avisos() from public, anon;
grant execute on function public.clave_publica_avisos() to authenticated;

-- Guarda este teléfono (o lo pasa a esta cuenta). Como máximo 5 teléfonos por cuenta: se borra el más antiguo.
create or replace function public.guardar_dispositivo(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.solo_pro();
begin
  insert into public.dispositivos_push (user_id, endpoint, p256dh, auth)
  values (v_uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = v_uid, p256dh = excluded.p256dh, auth = excluded.auth, actualizado = now();
  delete from public.dispositivos_push where id in (
    select id from public.dispositivos_push where user_id = v_uid order by actualizado desc offset 5);
end
$$;
revoke all on function public.guardar_dispositivo(text, text, text) from public, anon;
grant execute on function public.guardar_dispositivo(text, text, text) to authenticated;

-- Quita este teléfono (al desactivar los recordatorios). No exige Pro: también sirve al dejar de serlo.
create or replace function public.quitar_dispositivo(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Necesitas iniciar sesión' using errcode = '42501'; end if;
  delete from public.dispositivos_push where endpoint = p_endpoint and user_id = auth.uid();
  if not exists (select 1 from public.dispositivos_push where user_id = auth.uid()) then
    delete from public.avisos where user_id = auth.uid() and enviado is null;
  end if;
end
$$;
revoke all on function public.quitar_dispositivo(text) from public, anon;
grant execute on function public.quitar_dispositivo(text) to authenticated;

-- Reemplaza los avisos futuros de la cuenta por los que calcula el teléfono: [{cuando, tipo, ref}], hasta 150, en los
-- próximos 9 días. Devuelve cuántos quedaron programados.
create or replace function public.programar_avisos(p_avisos jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.solo_pro(); v_n integer;
begin
  if jsonb_typeof(p_avisos) <> 'array' or jsonb_array_length(p_avisos) > 150 then
    raise exception 'Lista de avisos no válida' using errcode = '22023';
  end if;
  delete from public.avisos where user_id = v_uid and enviado is null and cuando > now();
  insert into public.avisos (user_id, cuando, tipo, ref)
  select distinct v_uid, x.cuando, x.tipo, left(x.ref, 60)
  from jsonb_to_recordset(p_avisos) as x(cuando timestamptz, tipo text, ref text)
  where x.cuando > now() and x.cuando < now() + interval '9 days'
    and x.tipo in ('examen_manana', 'examen_pronto', 'sesion', 'resumen', 'sin_marcar') and x.ref is not null;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function public.programar_avisos(jsonb) from public, anon;
grant execute on function public.programar_avisos(jsonb) to authenticated;

-- ---------- Funciones para lia-avisos (solo service_role) ----------
create or replace function public.avisos_cron_ok(p_secreto text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'lia_avisos_secreto' and decrypted_secret = p_secreto)
$$;

-- Las claves VAPID: la función las crea la primera vez; una vez guardadas no se reemplazan.
create or replace function public.claves_vapid() returns table (publica text, privada text)
language sql stable security definer set search_path = '' as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'lia_vapid_publica' limit 1),
         (select decrypted_secret from vault.decrypted_secrets where name = 'lia_vapid_privada' limit 1)
$$;
create or replace function public.guardar_claves_vapid(p_publica text, p_privada text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('lia_vapid', 0));
  if exists (select 1 from vault.secrets where name in ('lia_vapid_publica', 'lia_vapid_privada')) then return false; end if;
  perform vault.create_secret(p_publica, 'lia_vapid_publica', 'Clave pública VAPID de los recordatorios de LIA');
  perform vault.create_secret(p_privada, 'lia_vapid_privada', 'Clave privada VAPID de los recordatorios de LIA');
  return true;
end
$$;

-- Marca como enviados los avisos que ya tocan y devuelve a qué teléfonos mandarlos (solo cuentas Pro vigentes,
-- y solo si no pasó más de 1 hora: un aviso viejo ya no sirve). Borra los avisos de hace más de 2 días.
create or replace function public.tomar_avisos_vencidos()
returns table (aviso_id bigint, user_id uuid, tipo text, ref text, cuando timestamptz, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.avisos a where a.cuando < now() - interval '2 days';
  return query
  with tomados as (
    update public.avisos a set enviado = now()
    where a.id in (select b.id from public.avisos b where b.enviado is null and b.cuando <= now()
                   order by b.cuando limit 500 for update skip locked)
    returning a.id, a.user_id, a.tipo, a.ref, a.cuando)
  select t.id, t.user_id, t.tipo, t.ref, t.cuando, d.endpoint, d.p256dh, d.auth
  from tomados t
  join public.suscripciones s on s.user_id = t.user_id and s.plan = 'pro' and s.hasta > public.hoy_lima()
  join public.dispositivos_push d on d.user_id = t.user_id
  where t.cuando > now() - interval '1 hour';
end
$$;

revoke all on function public.avisos_cron_ok(text), public.claves_vapid(), public.guardar_claves_vapid(text, text),
  public.tomar_avisos_vencidos() from public, anon, authenticated;
grant execute on function public.avisos_cron_ok(text), public.claves_vapid(), public.guardar_claves_vapid(text, text),
  public.tomar_avisos_vencidos() to service_role;

-- ---------- Cada minuto, pg_cron pide a lia-avisos que envíe lo que toca ----------
select cron.schedule('lia-avisos', '* * * * *', $cron$
  select net.http_post(
    url := 'https://lvtthltugrpbqjezwnsd.supabase.co/functions/v1/lia-avisos',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-lia-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'lia_avisos_secreto')),
    body := '{"accion":"enviar"}'::jsonb,
    timeout_milliseconds := 25000)
$cron$);
