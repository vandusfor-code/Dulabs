-- Sistema de planes Start/Growth/Scale/Enterprise (ver lib/planes.ts):
-- agentes de IA desacoplados de los números y candado de concurrencia de
-- campañas. Migración puramente aditiva: no modifica ni borra ninguna
-- columna existente. prompt_sistema/base_conocimiento/api_key_ia/
-- nombre_agente siguen en dulabs_clientes_config como ruta "legada" —
-- válida mientras agente_id sea null, retrocompatible con todos los
-- números ya configurados hoy (incluido el número real de Du Labs).

create table if not exists public.dulabs_agentes (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  nombre text not null default 'Nuevo agente',
  prompt_sistema text,
  base_conocimiento text,
  base_conocimiento_nombre_archivo text,
  base_conocimiento_actualizado_at timestamptz,
  api_key_ia text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dulabs_agentes_tenant_idx on public.dulabs_agentes (id_tenant);

alter table public.dulabs_agentes enable row level security;

drop policy if exists tenant_select on public.dulabs_agentes;
create policy tenant_select on public.dulabs_agentes
  for select to authenticated
  using (id_tenant = public.dulabs_tenant_del_usuario());

comment on table public.dulabs_agentes is
  'Perfil de IA reutilizable (prompt + base de conocimiento + api key propia), desacoplado del número. Un número usa uno vía dulabs_clientes_config.agente_id; si es null, sigue usando su prompt legado propio.';

-- Qué agente responde en cada número. null = ruta legada (prompt propio de
-- la fila, comportamiento de hoy sin cambios).
alter table public.dulabs_clientes_config
  add column if not exists agente_id bigint references public.dulabs_agentes(id) on delete set null;

-- Candado de concurrencia de campañas: cuántos envíos masivos tiene un
-- tenant en curso ahora mismo, para no dejarlo superar el límite de su plan
-- (dulabs_suscripciones no sirve para esto porque un tenant sin fila ahí
-- -- como Du Labs antes de suscribirse -- no tendría dónde contar).
create table if not exists public.dulabs_campanas_concurrencia (
  id_tenant uuid primary key,
  en_curso int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.dulabs_campanas_concurrencia enable row level security;

drop policy if exists tenant_select on public.dulabs_campanas_concurrencia;
create policy tenant_select on public.dulabs_campanas_concurrencia
  for select to authenticated
  using (id_tenant = public.dulabs_tenant_del_usuario());

comment on table public.dulabs_campanas_concurrencia is
  'Contador de campañas en curso por tenant, incrementado/decrementado atómicamente por dulabs_intentar_iniciar_campana/dulabs_finalizar_campana. Solo el backend (service role, vía RPC) lo escribe.';

-- Intenta reservar un cupo de envío concurrente para el tenant. Atómico
-- (upsert + update condicional en una sola sentencia): evita la carrera de
-- "leer contador, decidir, escribir" que tendría hacer el mismo chequeo
-- desde el backend con dos llamadas REST separadas.
create or replace function public.dulabs_intentar_iniciar_campana(p_tenant uuid, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_en_curso int;
begin
  insert into public.dulabs_campanas_concurrencia (id_tenant, en_curso)
  values (p_tenant, 0)
  on conflict (id_tenant) do nothing;

  update public.dulabs_campanas_concurrencia
  set en_curso = en_curso + 1, updated_at = now()
  where id_tenant = p_tenant and en_curso < p_max
  returning en_curso into v_en_curso;

  return v_en_curso is not null;
end;
$$;

revoke all on function public.dulabs_intentar_iniciar_campana(uuid, int) from public;
grant execute on function public.dulabs_intentar_iniciar_campana(uuid, int) to service_role;

create or replace function public.dulabs_finalizar_campana(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dulabs_campanas_concurrencia
  set en_curso = greatest(0, en_curso - 1), updated_at = now()
  where id_tenant = p_tenant;
end;
$$;

revoke all on function public.dulabs_finalizar_campana(uuid) from public;
grant execute on function public.dulabs_finalizar_campana(uuid) to service_role;

comment on function public.dulabs_intentar_iniciar_campana(uuid, int) is
  'Reserva atómicamente un cupo de campaña concurrente para el tenant si en_curso < p_max; devuelve false si ya está en el tope de su plan. Llamar SIEMPRE junto con dulabs_finalizar_campana en un try/finally.';
comment on function public.dulabs_finalizar_campana(uuid) is
  'Libera el cupo de campaña concurrente reservado por dulabs_intentar_iniciar_campana. Idempotente (greatest(0, ...)) — nunca baja de 0.';
