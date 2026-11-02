-- Métricas de uso anónimas (ver docs/metricas.md): registro completo y regreso al día 1 y al día 3.
-- La app solo puede agregar eventos con registrar_evento(); nadie los lee desde la app (RLS sin políticas).
-- Cada fila: un identificador al azar de la instalación, el evento, el día, el tipo de teléfono, si la app está instalada
-- y si es Pro. Nunca horarios, cursos, mensajes, nombre ni correo. Se puede aplicar dos veces sin error.

create table if not exists public.eventos_uso (
  instalacion uuid not null,
  evento text not null check (evento in ('instalacion', 'registro', 'abre')),
  dia date not null,
  plataforma text not null default 'otro' check (plataforma in ('ios', 'android', 'otro')),
  instalada boolean not null default false,
  pro boolean not null default false,
  creado timestamptz not null default now(),
  primary key (instalacion, evento, dia)
);
create index if not exists eventos_uso_dia on public.eventos_uso (dia);

alter table public.eventos_uso enable row level security;
revoke all on table public.eventos_uso from anon, authenticated;

-- Agrega un evento. Repetido el mismo día no cuenta dos veces. El día lo manda el teléfono (su fecha local), pero solo
-- se acepta entre ayer y mañana según el servidor en Lima, para que nadie llene días pasados o futuros.
-- Freno contra el abuso: hasta 5 000 eventos por hora en total.
create or replace function public.registrar_evento(p_instalacion uuid, p_evento text, p_dia date, p_plataforma text default 'otro', p_instalada boolean default false, p_pro boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  if p_instalacion is null or p_evento not in ('instalacion', 'registro', 'abre') or p_dia is null or p_dia not between v_hoy - 1 and v_hoy + 1 then
    raise exception 'evento_invalido' using errcode = '22023';
  end if;
  if (select count(*) from public.eventos_uso where creado > now() - interval '1 hour') >= 5000 then
    raise exception 'ocupado' using errcode = 'P0001';
  end if;
  insert into public.eventos_uso (instalacion, evento, dia, plataforma, instalada, pro)
  values (p_instalacion, p_evento, p_dia, case when p_plataforma in ('ios', 'android') then p_plataforma else 'otro' end, coalesce(p_instalada, false), coalesce(p_pro, false))
  on conflict (instalacion, evento, dia) do nothing;
  return true;
end;
$$;

revoke all on function public.registrar_evento(uuid, text, date, text, boolean, boolean) from public;
grant execute on function public.registrar_evento(uuid, text, date, text, boolean, boolean) to anon, authenticated;
