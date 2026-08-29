-- Fase 3.1 — correcciones críticas del Flow Store.
-- C1: ejecución activa única por conversación (índice parcial).
-- C2: optimistic concurrency (state_version).
-- C4: publicación atómica vía RPC.
-- Inmutabilidad: published_at no reversible.

-- ---------------------------------------------------------------------------
-- C2 — state_version en ejecuciones
-- ---------------------------------------------------------------------------

alter table public.dulabs_flow_executions
  add column if not exists state_version integer not null default 0;

comment on column public.dulabs_flow_executions.state_version is
  'Versión optimista del estado. Incrementa en cada saveExecutionState exitoso.';

-- ---------------------------------------------------------------------------
-- C1 — una sola ejecución activa por conversación
-- ---------------------------------------------------------------------------

create unique index if not exists dulabs_flow_executions_active_conversation_uidx
  on public.dulabs_flow_executions (tenant_id, phone_number_id, telefono_cliente)
  where status in ('running', 'waiting_input', 'waiting_effect');

comment on index public.dulabs_flow_executions_active_conversation_uidx is
  'Garantiza una sola ejecución no terminal por (tenant, phone_number_id, telefono_cliente).';

-- ---------------------------------------------------------------------------
-- Inmutabilidad — published_at no reversible
-- ---------------------------------------------------------------------------

create or replace function public.dulabs_flow_versions_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.published_at is not null then
    if tg_op = 'DELETE' then
      raise exception 'dulabs_flow_versions: no se puede eliminar una versión publicada (id=%)', old.id;
    end if;
    if new.published_at is null then
      raise exception 'dulabs_flow_versions: published_at no puede revertirse a NULL (id=%)', old.id;
    end if;
    if new.definition_json is distinct from old.definition_json then
      raise exception 'dulabs_flow_versions: definition_json es inmutable tras publicación (id=%)', old.id;
    end if;
    if new.version_number is distinct from old.version_number then
      raise exception 'dulabs_flow_versions: version_number es inmutable tras publicación';
    end if;
    if new.flow_id is distinct from old.flow_id then
      raise exception 'dulabs_flow_versions: flow_id es inmutable tras publicación';
    end if;
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'dulabs_flow_versions: tenant_id es inmutable';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- C4 — publicación atómica tenant-safe
-- ---------------------------------------------------------------------------
-- RETURNS TABLE usa prefijo result_* para evitar ambigüedad con columnas
-- tenant_id/flow_id en el cuerpo PL/pgSQL (error 42702 en PostgreSQL).

drop function if exists public.dulabs_flow_publish_version(uuid, uuid, uuid);

create or replace function public.dulabs_flow_publish_version(
  p_tenant_id uuid,
  p_flow_id uuid,
  p_version_id uuid
) returns table (
  result_tenant_id uuid,
  result_flow_id uuid,
  result_version_id uuid,
  result_published_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_version record;
begin
  -- Serializa publicaciones concurrentes del mismo flow.
  perform 1
  from public.dulabs_flows f
  where f.tenant_id = p_tenant_id
    and f.id = p_flow_id
  for update;

  select v.*
  into v_version
  from public.dulabs_flow_versions v
  where v.tenant_id = p_tenant_id
    and v.id = p_version_id;

  if not found then
    raise exception 'FLOW_PUBLISH_VERSION_NOT_FOUND'
      using errcode = 'P0001';
  end if;

  if v_version.flow_id is distinct from p_flow_id then
    raise exception 'FLOW_PUBLISH_TENANT_MISMATCH'
      using errcode = 'P0001';
  end if;

  if v_version.published_at is null then
    update public.dulabs_flow_versions fv
    set published_at = v_now
    where fv.tenant_id = p_tenant_id
      and fv.id = p_version_id
      and fv.flow_id = p_flow_id
      and fv.published_at is null;
  end if;

  update public.dulabs_flows f
  set published_version_id = p_version_id,
      status = 'published',
      updated_at = v_now
  where f.tenant_id = p_tenant_id
    and f.id = p_flow_id;

  return query
  select p_tenant_id, p_flow_id, p_version_id, coalesce(v_version.published_at, v_now);
end;
$$;

revoke all on function public.dulabs_flow_publish_version(uuid, uuid, uuid) from public;
grant execute on function public.dulabs_flow_publish_version(uuid, uuid, uuid) to service_role;

comment on function public.dulabs_flow_publish_version is
  'Publica una versión de flow de forma atómica: published_at + published_version_id + status en una transacción. Tenant-safe.';
