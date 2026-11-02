-- Lista de espera de LIA Pro (landing.html). Ver el plan del 31-oct-2026 (sección 4).
-- La página solo puede agregar un correo con unirse_lista_espera(); nadie puede leer la lista desde la app ni la página
-- (RLS sin políticas y sin permisos para anon ni authenticated). Se lee en el panel de Supabase.
-- Se puede aplicar dos veces sin error.

create table if not exists public.lista_espera (
  id bigint generated always as identity primary key,
  correo text not null unique check (length(correo) <= 254 and correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  universidad text check (universidad is null or length(universidad) <= 80),
  origen text check (origen is null or length(origen) <= 40),
  creado timestamptz not null default now()
);

alter table public.lista_espera enable row level security;
revoke all on table public.lista_espera from anon, authenticated;

-- Agrega un correo (en minúsculas). Si ya estaba, no hace nada y responde igual: así no se puede averiguar
-- quién está en la lista. Como freno contra el abuso, acepta hasta 300 correos nuevos por hora en total.
create or replace function public.unirse_lista_espera(p_correo text, p_universidad text default null, p_origen text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correo text := lower(btrim(coalesce(p_correo, '')));
begin
  if length(v_correo) > 254 or v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'correo_invalido' using errcode = '22023';
  end if;
  if (select count(*) from public.lista_espera where creado > now() - interval '1 hour') >= 300 then
    raise exception 'ocupado' using errcode = 'P0001';
  end if;
  insert into public.lista_espera (correo, universidad, origen)
  values (v_correo, nullif(left(btrim(coalesce(p_universidad, '')), 80), ''), nullif(left(btrim(coalesce(p_origen, '')), 40), ''))
  on conflict (correo) do nothing;
  return true;
end;
$$;

revoke all on function public.unirse_lista_espera(text, text, text) from public;
grant execute on function public.unirse_lista_espera(text, text, text) to anon, authenticated;
