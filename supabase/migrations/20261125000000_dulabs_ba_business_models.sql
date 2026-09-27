-- DuLabs Business — Business Agent 2.0, FASE 5: Universal Business Model (versiones) + artefactos publicados.
--
-- Tablas NUEVAS, aditivas. NO modifica ninguna tabla existente.
--
-- 1. dulabs_ba_business_models — cada versión publicada del modelo del negocio (append-only: no hay UPDATE ni DELETE).
-- 2. dulabs_ba_agent_artifacts — el artefacto compilado de cada versión (append-only). Su jsonb debe declarar el MISMO
--    tenant, agente, versión, checksum y huella de ejecución que las columnas (CHECK), y apunta al modelo del mismo
--    tenant/agente/versión (FK compuesta: un artefacto nunca puede colgar del modelo de otro tenant).
-- 3. dulabs_ba_active_artifacts — puntero a la versión ACTIVA por (tenant, agente). Publicar lo mueve a la nueva
--    versión; un rollback lo mueve a una versión anterior sin borrar historia.
--
-- Publicación atómica (dulabs_ba_publish_business_model): candado consultivo por (tenant, agente), control optimista
-- (p_expected_version = versión vigente), versión = max + 1, modelo + artefacto + puntero en UNA transacción.
--
-- SEGURIDAD: RLS habilitada sin políticas (solo service_role); funciones sin EXECUTE para public/anon/authenticated.
-- RECUPERACIÓN: todo es aditivo. Para revertir: drop function ...; drop table dulabs_ba_active_artifacts,
--   dulabs_ba_agent_artifacts, dulabs_ba_business_models; (sin efecto sobre otras tablas).

create table if not exists public.dulabs_ba_business_models (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null,
  agent_id text not null check (char_length(agent_id) between 1 and 64),
  version integer not null check (version between 1 and 1000000),
  schema_version text not null check (schema_version ~ '^business-agent\.business-model/[0-9]+\.[0-9]+\.[0-9]+$'),
  model jsonb not null check (jsonb_typeof(model) = 'object' and pg_column_size(model) <= 524288),
  model_checksum text not null check (model_checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint dulabs_ba_business_models_version unique (id_tenant, agent_id, version),
  constraint dulabs_ba_business_models_ref unique (id, id_tenant, agent_id, version),
  constraint dulabs_ba_business_models_schema check (model->>'schemaVersion' = schema_version)
);

create table if not exists public.dulabs_ba_agent_artifacts (
  id uuid primary key default gen_random_uuid(),
  id_tenant uuid not null,
  agent_id text not null check (char_length(agent_id) between 1 and 64),
  published_version integer not null check (published_version between 1 and 1000000),
  business_model_id uuid not null,
  artifact jsonb not null check (jsonb_typeof(artifact) = 'object' and pg_column_size(artifact) <= 524288),
  artifact_checksum text not null check (artifact_checksum ~ '^[a-f0-9]{64}$'),
  execution_fingerprint text not null check (execution_fingerprint ~ '^[a-f0-9]{32}$'),
  compiler_version text not null check (compiler_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  artifact_schema text not null check (artifact_schema ~ '^business-agent\.artifact/[0-9]+\.[0-9]+\.[0-9]+$'),
  published_at timestamptz not null default now(),
  constraint dulabs_ba_agent_artifacts_version unique (id_tenant, agent_id, published_version),
  constraint dulabs_ba_agent_artifacts_model unique (business_model_id),
  constraint dulabs_ba_agent_artifacts_ref unique (id, id_tenant, agent_id, published_version),
  constraint dulabs_ba_agent_artifacts_model_fk foreign key (business_model_id, id_tenant, agent_id, published_version)
    references public.dulabs_ba_business_models (id, id_tenant, agent_id, version),
  -- El contenido declara exactamente lo mismo que las columnas (no se puede servir un artefacto de otro tenant/versión).
  constraint dulabs_ba_agent_artifacts_consistent check (
    artifact->>'tenantId' = id_tenant::text
    and artifact->>'agentId' = agent_id
    and artifact->'version'->>'publishedVersion' = published_version::text
    and artifact->>'checksum' = artifact_checksum
    and artifact->>'executionFingerprint' = execution_fingerprint
    and artifact->>'compilerVersion' = compiler_version
    and artifact->>'artifactSchema' = artifact_schema
    and artifact->>'source' = 'business_model'
  )
);

create table if not exists public.dulabs_ba_active_artifacts (
  id_tenant uuid not null,
  agent_id text not null check (char_length(agent_id) between 1 and 64),
  published_version integer not null,
  artifact_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (id_tenant, agent_id),
  constraint dulabs_ba_active_artifacts_fk foreign key (artifact_id, id_tenant, agent_id, published_version)
    references public.dulabs_ba_agent_artifacts (id, id_tenant, agent_id, published_version)
);

comment on table public.dulabs_ba_business_models is
  'Universal Business Model del Business Agent (FASE 5): una fila inmutable por versión publicada (tenant, agente, versión).';
comment on table public.dulabs_ba_agent_artifacts is
  'Artefacto compilado e inmutable de cada versión publicada del Business Agent (FASE 5). Lo único que consume el runtime conversacional.';
comment on table public.dulabs_ba_active_artifacts is
  'Versión activa del artefacto por (tenant, agente). Publicar la avanza; rollback la mueve a una versión previa.';

-- Inmutabilidad: una versión publicada no se edita ni se borra (append-only).
create or replace function public.dulabs_ba_immutable_guard()
returns trigger
language plpgsql
as $$
begin
  raise exception '%: las versiones publicadas son inmutables (append-only)', tg_table_name using errcode = 'check_violation';
end;
$$;

drop trigger if exists dulabs_ba_business_models_immutable on public.dulabs_ba_business_models;
create trigger dulabs_ba_business_models_immutable
  before update or delete on public.dulabs_ba_business_models
  for each row execute function public.dulabs_ba_immutable_guard();

drop trigger if exists dulabs_ba_agent_artifacts_immutable on public.dulabs_ba_agent_artifacts;
create trigger dulabs_ba_agent_artifacts_immutable
  before update or delete on public.dulabs_ba_agent_artifacts
  for each row execute function public.dulabs_ba_immutable_guard();

alter table public.dulabs_ba_business_models enable row level security;
alter table public.dulabs_ba_agent_artifacts enable row level security;
alter table public.dulabs_ba_active_artifacts enable row level security;

-- ---------------------------------------------------------------------------
-- Publicación atómica
-- ---------------------------------------------------------------------------
create or replace function public.dulabs_ba_publish_business_model(
  p_tenant uuid,
  p_agent text,
  p_expected_version integer,
  p_model jsonb,
  p_model_checksum text,
  p_artifact jsonb,
  p_artifact_checksum text,
  p_execution_fingerprint text
)
returns table (outcome text, published_version integer, artifact_id uuid)
language plpgsql
as $$
declare
  v_current integer;
  v_new integer;
  v_model uuid;
  v_artifact uuid;
begin
  if p_tenant is null or p_agent is null or p_expected_version is null or p_expected_version < 0 then
    return query select 'invalid'::text, null::integer, null::uuid;
    return;
  end if;
  -- Serializa publicaciones del mismo agente (dos editores a la vez: una gana, la otra ve 'conflict').
  perform pg_advisory_xact_lock(hashtextextended('dulabs_ba_publish:' || p_tenant::text || ':' || p_agent, 0));
  select coalesce(max(m.version), 0) into v_current
    from public.dulabs_ba_business_models m where m.id_tenant = p_tenant and m.agent_id = p_agent;
  if v_current <> p_expected_version then
    return query select 'conflict'::text, v_current, null::uuid;
    return;
  end if;
  v_new := v_current + 1;
  begin
    insert into public.dulabs_ba_business_models (id_tenant, agent_id, version, schema_version, model, model_checksum)
    values (p_tenant, p_agent, v_new, p_model->>'schemaVersion', p_model, p_model_checksum)
    returning id into v_model;
    insert into public.dulabs_ba_agent_artifacts (id_tenant, agent_id, published_version, business_model_id, artifact, artifact_checksum,
                                                  execution_fingerprint, compiler_version, artifact_schema)
    values (p_tenant, p_agent, v_new, v_model, p_artifact, p_artifact_checksum, p_execution_fingerprint,
            p_artifact->>'compilerVersion', p_artifact->>'artifactSchema')
    returning id into v_artifact;
  exception when check_violation or not_null_violation or foreign_key_violation then
    return query select 'invalid'::text, null::integer, null::uuid;
    return;
  end;
  insert into public.dulabs_ba_active_artifacts (id_tenant, agent_id, published_version, artifact_id)
  values (p_tenant, p_agent, v_new, v_artifact)
  on conflict (id_tenant, agent_id) do update
    set published_version = excluded.published_version, artifact_id = excluded.artifact_id, updated_at = now();
  return query select 'published'::text, v_new, v_artifact;
end;
$$;

-- Rollback: activa una versión ya publicada (no crea ni borra nada).
create or replace function public.dulabs_ba_activate_business_model_version(p_tenant uuid, p_agent text, p_version integer)
returns boolean
language plpgsql
as $$
declare
  v_artifact uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('dulabs_ba_publish:' || p_tenant::text || ':' || p_agent, 0));
  select a.id into v_artifact from public.dulabs_ba_agent_artifacts a
   where a.id_tenant = p_tenant and a.agent_id = p_agent and a.published_version = p_version;
  if v_artifact is null then
    return false;
  end if;
  insert into public.dulabs_ba_active_artifacts (id_tenant, agent_id, published_version, artifact_id)
  values (p_tenant, p_agent, p_version, v_artifact)
  on conflict (id_tenant, agent_id) do update
    set published_version = excluded.published_version, artifact_id = excluded.artifact_id, updated_at = now();
  return true;
end;
$$;

-- Lectura del artefacto activo (con su modelo, para recompilar si cambió la versión del compilador).
create or replace function public.dulabs_ba_active_business_artifact(p_tenant uuid, p_agent text)
returns table (published_version integer, artifact jsonb, artifact_checksum text, model jsonb)
language sql
stable
as $$
  select a.published_version, a.artifact, a.artifact_checksum, m.model
    from public.dulabs_ba_active_artifacts p
    join public.dulabs_ba_agent_artifacts a
      on a.id = p.artifact_id and a.id_tenant = p.id_tenant and a.agent_id = p.agent_id
    join public.dulabs_ba_business_models m
      on m.id = a.business_model_id and m.id_tenant = a.id_tenant
   where p.id_tenant = p_tenant and p.agent_id = p_agent;
$$;

revoke all on function public.dulabs_ba_publish_business_model(uuid, text, integer, jsonb, text, jsonb, text, text) from public;
revoke all on function public.dulabs_ba_activate_business_model_version(uuid, text, integer) from public;
revoke all on function public.dulabs_ba_active_business_artifact(uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.dulabs_ba_publish_business_model(uuid, text, integer, jsonb, text, jsonb, text, text) from anon';
    execute 'revoke all on function public.dulabs_ba_activate_business_model_version(uuid, text, integer) from anon';
    execute 'revoke all on function public.dulabs_ba_active_business_artifact(uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.dulabs_ba_publish_business_model(uuid, text, integer, jsonb, text, jsonb, text, text) from authenticated';
    execute 'revoke all on function public.dulabs_ba_activate_business_model_version(uuid, text, integer) from authenticated';
    execute 'revoke all on function public.dulabs_ba_active_business_artifact(uuid, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.dulabs_ba_publish_business_model(uuid, text, integer, jsonb, text, jsonb, text, text) to service_role';
    execute 'grant execute on function public.dulabs_ba_activate_business_model_version(uuid, text, integer) to service_role';
    execute 'grant execute on function public.dulabs_ba_active_business_artifact(uuid, text) to service_role';
  end if;
end;
$$;
