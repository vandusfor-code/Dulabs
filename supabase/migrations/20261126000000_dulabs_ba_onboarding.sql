-- DuLabs Business — Business Agent 2.0, FASE 6: configuración guiada (borrador) + publicación atómica.
--
-- Requiere: 20260828100000/20260828110000 (flows, versiones y dulabs_flow_publish_version), 20261018000000
-- (dulabs_business_agent_versions) y 20261125000000 (Universal Business Model y artefactos).
-- Tablas NUEVAS, aditivas. NO modifica ninguna tabla existente (solo escribe en ellas a través de sus funciones).
--
-- 1. dulabs_ba_onboarding_drafts — el borrador de la configuración guiada, uno por (tenant, agente), con REVISIÓN:
--    guardar exige la revisión vigente (otra pestaña/sesión => conflict, nunca se pisa en silencio).
-- 2. dulabs_ba_onboarding_publications — enlace inmutable entre la versión del modelo publicada, la versión del registro
--    que sirve producción (dulabs_flow_versions) y la revisión del borrador que se publicó.
-- 3. dulabs_ba_publish_onboarding — UNA transacción: revisión del borrador vigente → modelo + artefacto + versión activa
--    (dulabs_ba_publish_business_model) → versión del registro publicada (dulabs_flow_publish_version) → enlace.
--    Si cualquier paso falla, no queda nada a medias (ni el artefacto ni el puntero del registro).
--
-- SEGURIDAD: RLS habilitada sin políticas (solo service_role); funciones sin EXECUTE para public/anon/authenticated.
-- RECUPERACIÓN: aditivo. Para revertir: drop function ...; drop table dulabs_ba_onboarding_publications,
--   dulabs_ba_onboarding_drafts;

create table if not exists public.dulabs_ba_onboarding_drafts (
  id_tenant uuid not null,
  agent_id text not null check (char_length(agent_id) between 1 and 64),
  revision integer not null check (revision between 1 and 100000000),
  draft jsonb not null check (jsonb_typeof(draft) = 'object' and pg_column_size(draft) <= 262144),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (id_tenant, agent_id),
  constraint dulabs_ba_onboarding_drafts_version check (draft->>'version' = 'business-agent.onboarding-draft/1')
);

comment on table public.dulabs_ba_onboarding_drafts is
  'Borrador de la configuración guiada del Business Agent (FASE 6). Guardar no publica ni activa nada.';

create table if not exists public.dulabs_ba_onboarding_publications (
  id_tenant uuid not null,
  agent_id text not null,
  published_version integer not null,
  flow_version_id uuid not null,
  draft_revision integer not null check (draft_revision >= 1),
  published_at timestamptz not null default now(),
  primary key (id_tenant, agent_id, published_version),
  constraint dulabs_ba_onboarding_publications_artifact_fk foreign key (id_tenant, agent_id, published_version)
    references public.dulabs_ba_agent_artifacts (id_tenant, agent_id, published_version),
  constraint dulabs_ba_onboarding_publications_flow_version_fk foreign key (id_tenant, flow_version_id)
    references public.dulabs_flow_versions (tenant_id, id)
);

create index if not exists dulabs_ba_onboarding_publications_latest_idx
  on public.dulabs_ba_onboarding_publications (id_tenant, agent_id, published_version desc);

comment on table public.dulabs_ba_onboarding_publications is
  'Enlace inmutable: versión del modelo publicada <-> versión del registro servida <-> revisión del borrador (FASE 6).';

drop trigger if exists dulabs_ba_onboarding_publications_immutable on public.dulabs_ba_onboarding_publications;
create trigger dulabs_ba_onboarding_publications_immutable
  before update or delete on public.dulabs_ba_onboarding_publications
  for each row execute function public.dulabs_ba_immutable_guard();

alter table public.dulabs_ba_onboarding_drafts enable row level security;
alter table public.dulabs_ba_onboarding_publications enable row level security;

-- ---------------------------------------------------------------------------
-- Guardar borrador (revisión optimista)
-- ---------------------------------------------------------------------------
create or replace function public.dulabs_ba_save_onboarding_draft(
  p_tenant uuid,
  p_agent text,
  p_expected_revision integer,
  p_draft jsonb,
  p_user uuid
)
returns table (outcome text, revision integer)
language plpgsql
as $$
declare
  v_revision integer;
begin
  if p_expected_revision = 0 then
    insert into public.dulabs_ba_onboarding_drafts (id_tenant, agent_id, revision, draft, updated_by)
    values (p_tenant, p_agent, 1, p_draft, p_user)
    on conflict (id_tenant, agent_id) do nothing;
    if found then
      return query select 'saved'::text, 1;
      return;
    end if;
  else
    update public.dulabs_ba_onboarding_drafts d
       set revision = d.revision + 1, draft = p_draft, updated_by = p_user, updated_at = now()
     where d.id_tenant = p_tenant and d.agent_id = p_agent and d.revision = p_expected_revision
    returning d.revision into v_revision;
    if v_revision is not null then
      return query select 'saved'::text, v_revision;
      return;
    end if;
  end if;
  select d.revision into v_revision from public.dulabs_ba_onboarding_drafts d where d.id_tenant = p_tenant and d.agent_id = p_agent;
  return query select 'conflict'::text, coalesce(v_revision, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Publicación atómica
-- ---------------------------------------------------------------------------
create or replace function public.dulabs_ba_publish_onboarding(
  p_tenant uuid,
  p_agent text,
  p_flow_version_id uuid,
  p_expected_revision integer,
  p_expected_version integer,
  p_model jsonb,
  p_model_checksum text,
  p_artifact jsonb,
  p_artifact_checksum text,
  p_execution_fingerprint text
)
returns table (outcome text, published_version integer)
language plpgsql
as $$
declare
  v_revision integer;
  v_prev uuid;
  r record;
begin
  -- Mismo candado que dulabs_ba_publish_business_model (reentrante en la misma sesión): serializa por (tenant, agente).
  perform pg_advisory_xact_lock(hashtextextended('dulabs_ba_publish:' || p_tenant::text || ':' || p_agent, 0));

  -- 1. Se publica EXACTAMENTE la revisión que la persona vio.
  select d.revision into v_revision from public.dulabs_ba_onboarding_drafts d
   where d.id_tenant = p_tenant and d.agent_id = p_agent for update;
  if v_revision is null or v_revision <> p_expected_revision then
    return query select 'draft_conflict'::text, null::integer;
    return;
  end if;

  -- 2. La versión del registro es de este tenant/agente y pasó la validación de publicación del compilador.
  if not exists (
    select 1 from public.dulabs_business_agent_versions b
     where b.tenant_id = p_tenant and b.flow_version_id = p_flow_version_id and b.flow_id::text = p_agent and b.validation_status = 'validated'
  ) then
    return query select 'invalid'::text, null::integer;
    return;
  end if;

  -- 3. Modelo + artefacto + versión activa del modelo (FASE 5: control optimista, contenido = columnas).
  select * into r from public.dulabs_ba_publish_business_model(p_tenant, p_agent, p_expected_version, p_model, p_model_checksum, p_artifact, p_artifact_checksum, p_execution_fingerprint);
  if r.outcome = 'conflict' then
    return query select 'version_conflict'::text, null::integer;
    return;
  end if;
  if r.outcome <> 'published' then
    return query select 'invalid'::text, null::integer;
    return;
  end if;

  -- 4. La versión que sirve producción (mismo RPC atómico de siempre). Si lanza, TODO se revierte (también el paso 3).
  select f.published_version_id into v_prev from public.dulabs_flows f where f.tenant_id = p_tenant and f.id = p_agent::uuid;
  perform public.dulabs_flow_publish_version(p_tenant, p_agent::uuid, p_flow_version_id);
  if v_prev is not null and v_prev <> p_flow_version_id then
    update public.dulabs_flow_versions v set retired_at = now()
     where v.tenant_id = p_tenant and v.id = v_prev and v.retired_at is null;
  end if;

  -- 5. Enlace inmutable.
  insert into public.dulabs_ba_onboarding_publications (id_tenant, agent_id, published_version, flow_version_id, draft_revision)
  values (p_tenant, p_agent, r.published_version, p_flow_version_id, p_expected_revision);

  return query select 'published'::text, r.published_version;
end;
$$;

-- Última publicación de la configuración guiada.
create or replace function public.dulabs_ba_onboarding_last_publication(p_tenant uuid, p_agent text)
returns table (published_version integer, flow_version_id uuid, draft_revision integer, published_at timestamptz)
language sql
stable
as $$
  select p.published_version, p.flow_version_id, p.draft_revision, p.published_at
    from public.dulabs_ba_onboarding_publications p
   where p.id_tenant = p_tenant and p.agent_id = p_agent
   order by p.published_version desc
   limit 1;
$$;

-- Versión del registro enlazada al artefacto ACTIVO del modelo (el runtime conversacional solo usa ese artefacto si
-- corresponde a la versión que el registro sirve hoy; si no, usa la versión del registro vía el adaptador legacy).
create or replace function public.dulabs_ba_active_artifact_flow_version(p_tenant uuid, p_agent text)
returns uuid
language sql
stable
as $$
  select p.flow_version_id
    from public.dulabs_ba_active_artifacts a
    join public.dulabs_ba_onboarding_publications p
      on p.id_tenant = a.id_tenant and p.agent_id = a.agent_id and p.published_version = a.published_version
   where a.id_tenant = p_tenant and a.agent_id = p_agent;
$$;

-- Versión máxima publicada del modelo (para compilar la siguiente con su número).
create or replace function public.dulabs_ba_latest_model_version(p_tenant uuid, p_agent text)
returns integer
language sql
stable
as $$
  select coalesce(max(m.version), 0) from public.dulabs_ba_business_models m where m.id_tenant = p_tenant and m.agent_id = p_agent;
$$;

revoke all on function public.dulabs_ba_save_onboarding_draft(uuid, text, integer, jsonb, uuid) from public;
revoke all on function public.dulabs_ba_publish_onboarding(uuid, text, uuid, integer, integer, jsonb, text, jsonb, text, text) from public;
revoke all on function public.dulabs_ba_onboarding_last_publication(uuid, text) from public;
revoke all on function public.dulabs_ba_active_artifact_flow_version(uuid, text) from public;
revoke all on function public.dulabs_ba_latest_model_version(uuid, text) from public;
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.dulabs_ba_save_onboarding_draft(uuid, text, integer, jsonb, uuid)',
    'public.dulabs_ba_publish_onboarding(uuid, text, uuid, integer, integer, jsonb, text, jsonb, text, text)',
    'public.dulabs_ba_onboarding_last_publication(uuid, text)',
    'public.dulabs_ba_active_artifact_flow_version(uuid, text)',
    'public.dulabs_ba_latest_model_version(uuid, text)'
  ] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', fn); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
  end loop;
end;
$$;
