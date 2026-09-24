-- DuLabs — Bloque 11: un solo turno del agente a la vez por conversación.
--
-- 100 % ADITIVO. Solo tablas y funciones nuevas del agente. Sin esta migración el
-- agente funciona como antes (un turno por mensaje, protegido por el candado del chat).
--
-- Problema que resuelve: el candado del chat espera máximo 20 s y un turno del agente
-- puede tardar hasta 45 s; con dos mensajes seguidos, dos turnos podían correr en
-- PARALELO y el segundo pisaba al primero (carrito perdido, respuestas cruzadas).
--
--   dulabs_agente_buzon            cada mensaje para el agente entra aquí (único por wamid).
--                                  Conserva el mensaje citado (respuesta a una foto).
--                                  Al procesarse se borra el texto (no se duplica el historial).
--   dulabs_agente_turno            quién tiene el turno de la conversación y hasta cuándo.
--   dulabs_agente_tomar_turno      toma (o renueva) el turno si está libre o vencido. Atómico.
--   dulabs_agente_soltar_turno     suelta el turno SOLO si no quedan mensajes pendientes
--                                  (en la misma operación): ningún mensaje se queda sin atender.
--
-- Flujo: el mensaje entra al buzón -> quien consigue el turno atiende TODOS los pendientes
-- (la ráfaga completa) -> antes de soltar, si llegó algo más, sigue. Quien no consigue el
-- turno no hace nada más: su mensaje lo atiende el turno en curso. Si un proceso se cae,
-- el turno vence solo y el siguiente mensaje atiende también lo pendiente.
--
-- Rollback:
--   drop function if exists public.dulabs_agente_soltar_turno(text, text, text);
--   drop function if exists public.dulabs_agente_tomar_turno(uuid, text, text, text, integer);
--   drop table if exists public.dulabs_agente_turno;
--   drop table if exists public.dulabs_agente_buzon;
--
-- Se aplica manualmente en el SQL Editor de Supabase (ver PENDING_MIGRATIONS.md).

begin;

create table if not exists public.dulabs_agente_buzon (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  phone_number_id text not null check (char_length(phone_number_id) between 1 and 64),
  wa_id text not null check (wa_id ~ '^[0-9]{6,20}$'),
  wamid text not null check (char_length(wamid) between 1 and 200),
  -- null una vez procesado (el texto ya vive en dulabs_mensajes_log).
  texto text check (texto is null or char_length(texto) <= 4000),
  -- wamid del mensaje citado (p. ej. la foto a la que respondió) y si fue reenviado.
  responde_a text check (responde_a is null or char_length(responde_a) <= 200),
  reenviado boolean not null default false,
  recibido_at timestamptz not null default now(),
  procesado_at timestamptz,
  turno integer check (turno is null or turno >= 0),
  constraint dulabs_agente_buzon_wamid unique (wamid)
);

create index if not exists dulabs_agente_buzon_pendientes_idx
  on public.dulabs_agente_buzon (phone_number_id, wa_id, id)
  where procesado_at is null;

comment on table public.dulabs_agente_buzon is
  'Bloque 11 — buzón por conversación del agente: los mensajes se atienden en UN turno a la vez (la ráfaga completa). Único por wamid. Solo service_role.';

create table if not exists public.dulabs_agente_turno (
  phone_number_id text not null,
  wa_id text not null,
  id_tenant uuid not null,
  -- wamid del mensaje cuyo proceso tiene el turno (identifica al dueño).
  dueno text not null check (char_length(dueno) between 1 and 200),
  hasta timestamptz not null,
  primary key (phone_number_id, wa_id)
);

comment on table public.dulabs_agente_turno is
  'Bloque 11 — turno activo del agente por conversación (con vencimiento: un proceso caído no bloquea). Solo service_role.';

alter table public.dulabs_agente_buzon enable row level security;
alter table public.dulabs_agente_turno enable row level security;
revoke all on table public.dulabs_agente_buzon from anon, authenticated;
revoke all on table public.dulabs_agente_turno from anon, authenticated;

-- Toma o renueva el turno: true si quedó siendo del dueño indicado.
create or replace function public.dulabs_agente_tomar_turno(p_tenant uuid, p_pn text, p_wa text, p_dueno text, p_segundos integer)
returns boolean
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_ok boolean;
begin
  if p_tenant is null or p_pn is null or p_wa is null or p_dueno is null then
    raise exception 'dulabs_agente_tomar_turno: parámetros requeridos' using errcode = '22023';
  end if;
  insert into public.dulabs_agente_turno as t (phone_number_id, wa_id, id_tenant, dueno, hasta)
  values (p_pn, p_wa, p_tenant, p_dueno, now() + make_interval(secs => least(greatest(coalesce(p_segundos, 60), 10), 300)))
  on conflict (phone_number_id, wa_id) do update
     set dueno = excluded.dueno, hasta = excluded.hasta, id_tenant = excluded.id_tenant
   where t.id_tenant = excluded.id_tenant and (t.hasta < now() or t.dueno = excluded.dueno)
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- Suelta el turno si no hay pendientes: 'released' | 'pending' (hay mensajes: el dueño sigue) | 'lost' (ya no era suyo).
create or replace function public.dulabs_agente_soltar_turno(p_pn text, p_wa text, p_dueno text)
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
begin
  -- Bloquea la fila del turno: un mensaje que llega ahora espera a que esto termine.
  perform 1 from public.dulabs_agente_turno where phone_number_id = p_pn and wa_id = p_wa and dueno = p_dueno for update;
  if not found then
    return 'lost';
  end if;
  if exists (select 1 from public.dulabs_agente_buzon where phone_number_id = p_pn and wa_id = p_wa and procesado_at is null) then
    return 'pending';
  end if;
  delete from public.dulabs_agente_turno where phone_number_id = p_pn and wa_id = p_wa and dueno = p_dueno;
  return 'released';
end;
$$;

revoke all on function public.dulabs_agente_tomar_turno(uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.dulabs_agente_soltar_turno(text, text, text) from public, anon, authenticated;
grant execute on function public.dulabs_agente_tomar_turno(uuid, text, text, text, integer) to service_role;
grant execute on function public.dulabs_agente_soltar_turno(text, text, text) to service_role;

commit;
