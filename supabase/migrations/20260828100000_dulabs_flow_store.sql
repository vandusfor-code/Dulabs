-- DuLabs Flow Builder — capa Store (Fase 3).
-- Tablas multi-tenant con FKs compuestas (tenant_id, id).
-- Append-only: events, effects, node_transitions.
-- Inmutabilidad: definition_json tras published_at.
--
-- FRONTERA JSONB: agentId, integrationId, memberId, tagId dentro de
-- definition_json NO tienen FK en PostgreSQL. validateFlowForPublish + API
-- deben verificar tenant ownership antes de publicar.

-- ---------------------------------------------------------------------------
-- 1. dulabs_flows
-- ---------------------------------------------------------------------------

create table if not exists public.dulabs_flows (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  published_version_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint dulabs_flows_tenant_slug_key unique (tenant_id, slug)
);

create index if not exists dulabs_flows_tenant_status_idx
  on public.dulabs_flows (tenant_id, status);

comment on table public.dulabs_flows is
  'Flow lógico por tenant. Sin secretos. published_version_id apunta a versión publicada activa.';

-- ---------------------------------------------------------------------------
-- 2. dulabs_flow_versions (inmutable tras publicación)
-- ---------------------------------------------------------------------------

create table if not exists public.dulabs_flow_versions (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  flow_id uuid not null,
  version_number int not null check (version_number > 0),
  definition_json jsonb not null,
  published_at timestamptz,
  retired_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint dulabs_flow_versions_tenant_flow_version_key
    unique (tenant_id, flow_id, version_number),
  constraint dulabs_flow_versions_flow_fk
    foreign key (tenant_id, flow_id)
    references public.dulabs_flows (tenant_id, id)
    on delete restrict
);

create index if not exists dulabs_flow_versions_flow_idx
  on public.dulabs_flow_versions (tenant_id, flow_id, version_number desc);

alter table public.dulabs_flows
  add constraint dulabs_flows_published_version_fk
  foreign key (tenant_id, published_version_id)
  references public.dulabs_flow_versions (tenant_id, id)
  on delete set null;

comment on table public.dulabs_flow_versions is
  'Versiones inmutables del grafo. definition_json no puede modificarse tras published_at.';

create or replace function public.dulabs_flow_versions_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.published_at is not null then
    if tg_op = 'DELETE' then
      raise exception 'dulabs_flow_versions: no se puede eliminar una versión publicada (id=%)', old.id;
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

drop trigger if exists dulabs_flow_versions_guard_immutable on public.dulabs_flow_versions;
create trigger dulabs_flow_versions_guard_immutable
  before update or delete on public.dulabs_flow_versions
  for each row execute function public.dulabs_flow_versions_guard_immutable();

-- ---------------------------------------------------------------------------
-- 3. dulabs_flow_integrations (registry tenant-scoped)
-- ---------------------------------------------------------------------------

create table if not exists public.dulabs_flow_integrations (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  slug text not null,
  display_name text not null,
  description text,
  capability text not null,
  criticality text not null default 'critical'
    check (criticality in ('critical', 'elevated', 'standard')),
  requires_failure_branch boolean not null default true,
  url text not null,
  http_method text not null default 'POST'
    check (http_method in ('GET', 'POST', 'PUT', 'PATCH')),
  input_contract jsonb not null default '{}'::jsonb,
  output_contract jsonb not null default '{}'::jsonb,
  headers_template jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'revoked')),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint dulabs_flow_integrations_tenant_slug_key unique (tenant_id, slug)
);

create index if not exists dulabs_flow_integrations_tenant_status_idx
  on public.dulabs_flow_integrations (tenant_id, status);

comment on table public.dulabs_flow_integrations is
  'Integraciones/webhooks aprobados por tenant. El Flow referencia integrationId, no URL ni secretos.';

-- ---------------------------------------------------------------------------
-- 4. dulabs_flow_credentials (solo service_role)
-- ---------------------------------------------------------------------------

create table if not exists public.dulabs_flow_credentials (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  integration_id uuid not null,
  credential_key text not null,
  encrypted_value text not null,
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint dulabs_flow_credentials_integration_key unique (tenant_id, integration_id, credential_key),
  constraint dulabs_flow_credentials_integration_fk
    foreign key (tenant_id, integration_id)
    references public.dulabs_flow_integrations (tenant_id, id)
    on delete restrict
);

comment on table public.dulabs_flow_credentials is
  'Secretos cifrados (lib/crypto.ts + TOKEN_ENCRYPTION_KEY). Sin acceso authenticated.';

-- ---------------------------------------------------------------------------
-- 5. dulabs_flow_executions
-- ---------------------------------------------------------------------------

create table if not exists public.dulabs_flow_executions (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  flow_id uuid not null,
  flow_version_id uuid not null,
  execution_id text not null,
  phone_number_id text not null,
  telefono_cliente text not null,
  status text not null
    check (status in ('running', 'waiting_input', 'waiting_effect', 'completed', 'failed', 'transferred')),
  current_node_id text,
  variables jsonb not null default '{}'::jsonb,
  expected_input text check (expected_input is null or expected_input in ('text', 'button')),
  pending_effect jsonb,
  exports jsonb not null default '{"lead":{},"custom_fields":{},"webhook_body":{}}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint dulabs_flow_executions_tenant_execution_id_key unique (tenant_id, execution_id),
  constraint dulabs_flow_executions_flow_fk
    foreign key (tenant_id, flow_id)
    references public.dulabs_flows (tenant_id, id)
    on delete restrict,
  constraint dulabs_flow_executions_version_fk
    foreign key (tenant_id, flow_version_id)
    references public.dulabs_flow_versions (tenant_id, id)
    on delete restrict
);

create index if not exists dulabs_flow_executions_lookup_idx
  on public.dulabs_flow_executions (tenant_id, phone_number_id, telefono_cliente, status);

create index if not exists dulabs_flow_executions_flow_idx
  on public.dulabs_flow_executions (tenant_id, flow_id);

create index if not exists dulabs_flow_executions_version_idx
  on public.dulabs_flow_executions (tenant_id, flow_version_id);

create index if not exists dulabs_flow_executions_execution_id_idx
  on public.dulabs_flow_executions (tenant_id, execution_id);

comment on table public.dulabs_flow_executions is
  'Estado operativo de una ejecución. flow_version_id fijado al crear — nunca migra automáticamente.';

comment on column public.dulabs_flow_executions.execution_id is
  'ID estable del engine (FlowEngineState.executionId). UNIQUE por tenant.';

-- ---------------------------------------------------------------------------
-- 6. dulabs_flow_events (append-only)
-- ---------------------------------------------------------------------------

create table if not exists public.dulabs_flow_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  flow_execution_id uuid not null,
  event_id text not null,
  event_type text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dulabs_flow_events_idempotent unique (tenant_id, flow_execution_id, event_id),
  constraint dulabs_flow_events_execution_fk
    foreign key (tenant_id, flow_execution_id)
    references public.dulabs_flow_executions (tenant_id, id)
    on delete restrict
);

create index if not exists dulabs_flow_events_execution_idx
  on public.dulabs_flow_events (tenant_id, flow_execution_id, created_at);

create index if not exists dulabs_flow_events_event_id_idx
  on public.dulabs_flow_events (tenant_id, event_id);

comment on table public.dulabs_flow_events is
  'Eventos append-only. event_id = wamid (WhatsApp) o UUID (runtime). INSERT ON CONFLICT DO NOTHING para idempotencia.';

-- ---------------------------------------------------------------------------
-- 7. dulabs_flow_effects (append-only / historial)
-- ---------------------------------------------------------------------------

create table if not exists public.dulabs_flow_effects (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  flow_execution_id uuid not null,
  effect_id text not null,
  node_id text not null,
  kind text not null,
  integration_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'expired')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  result_payload_raw jsonb,
  result_payload_applied jsonb,
  provider text,
  provider_model text,
  created_at timestamptz not null default now(),
  constraint dulabs_flow_effects_idempotent unique (tenant_id, flow_execution_id, effect_id),
  constraint dulabs_flow_effects_execution_fk
    foreign key (tenant_id, flow_execution_id)
    references public.dulabs_flow_executions (tenant_id, id)
    on delete restrict,
  constraint dulabs_flow_effects_integration_fk
    foreign key (tenant_id, integration_id)
    references public.dulabs_flow_integrations (tenant_id, id)
    on delete restrict
);

create index if not exists dulabs_flow_effects_execution_idx
  on public.dulabs_flow_effects (tenant_id, flow_execution_id, status);

create index if not exists dulabs_flow_effects_effect_id_idx
  on public.dulabs_flow_effects (tenant_id, effect_id);

comment on table public.dulabs_flow_effects is
  'Historial de efectos externos. effect_id correlaciona con FlowEngineState.pendingEffect.';

-- ---------------------------------------------------------------------------
-- 8. dulabs_flow_node_transitions (auditoría append-only)
-- ---------------------------------------------------------------------------

create table if not exists public.dulabs_flow_node_transitions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  flow_execution_id uuid not null,
  event_id text,
  from_node_id text,
  to_node_id text not null,
  source_handle text,
  occurred_at timestamptz not null default now(),
  constraint dulabs_flow_node_transitions_execution_fk
    foreign key (tenant_id, flow_execution_id)
    references public.dulabs_flow_executions (tenant_id, id)
    on delete restrict
);

create index if not exists dulabs_flow_node_transitions_execution_idx
  on public.dulabs_flow_node_transitions (tenant_id, flow_execution_id, occurred_at);

comment on table public.dulabs_flow_node_transitions is
  'Auditoría de transiciones — reconstrucción de caminos por ejecución.';

-- ---------------------------------------------------------------------------
-- updated_at triggers (convención DuLabs)
-- ---------------------------------------------------------------------------

create or replace function public.dulabs_flow_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dulabs_flows_updated_at on public.dulabs_flows;
create trigger dulabs_flows_updated_at
  before update on public.dulabs_flows
  for each row execute function public.dulabs_flow_set_updated_at();

drop trigger if exists dulabs_flow_integrations_updated_at on public.dulabs_flow_integrations;
create trigger dulabs_flow_integrations_updated_at
  before update on public.dulabs_flow_integrations
  for each row execute function public.dulabs_flow_set_updated_at();

drop trigger if exists dulabs_flow_credentials_updated_at on public.dulabs_flow_credentials;
create trigger dulabs_flow_credentials_updated_at
  before update on public.dulabs_flow_credentials
  for each row execute function public.dulabs_flow_set_updated_at();

drop trigger if exists dulabs_flow_executions_updated_at on public.dulabs_flow_executions;
create trigger dulabs_flow_executions_updated_at
  before update on public.dulabs_flow_executions
  for each row execute function public.dulabs_flow_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — lectura tenant-scoped; escritura solo service_role (convención DuLabs)
-- ---------------------------------------------------------------------------

alter table public.dulabs_flows enable row level security;
alter table public.dulabs_flow_versions enable row level security;
alter table public.dulabs_flow_integrations enable row level security;
alter table public.dulabs_flow_credentials enable row level security;
alter table public.dulabs_flow_executions enable row level security;
alter table public.dulabs_flow_events enable row level security;
alter table public.dulabs_flow_effects enable row level security;
alter table public.dulabs_flow_node_transitions enable row level security;

-- flows
drop policy if exists tenant_select on public.dulabs_flows;
create policy tenant_select on public.dulabs_flows
  for select to authenticated
  using (tenant_id = public.dulabs_tenant_del_usuario());

-- versions
drop policy if exists tenant_select on public.dulabs_flow_versions;
create policy tenant_select on public.dulabs_flow_versions
  for select to authenticated
  using (tenant_id = public.dulabs_tenant_del_usuario());

-- integrations (sin secretos en fila)
drop policy if exists tenant_select on public.dulabs_flow_integrations;
create policy tenant_select on public.dulabs_flow_integrations
  for select to authenticated
  using (tenant_id = public.dulabs_tenant_del_usuario());

-- credentials: sin políticas authenticated — solo service_role

-- executions (scoped por tenant_id directo)
drop policy if exists tenant_select on public.dulabs_flow_executions;
create policy tenant_select on public.dulabs_flow_executions
  for select to authenticated
  using (tenant_id = public.dulabs_tenant_del_usuario());

-- events / effects / transitions — lectura vía join implícito al tenant del execution
drop policy if exists tenant_select on public.dulabs_flow_events;
create policy tenant_select on public.dulabs_flow_events
  for select to authenticated
  using (tenant_id = public.dulabs_tenant_del_usuario());

drop policy if exists tenant_select on public.dulabs_flow_effects;
create policy tenant_select on public.dulabs_flow_effects
  for select to authenticated
  using (tenant_id = public.dulabs_tenant_del_usuario());

drop policy if exists tenant_select on public.dulabs_flow_node_transitions;
create policy tenant_select on public.dulabs_flow_node_transitions
  for select to authenticated
  using (tenant_id = public.dulabs_tenant_del_usuario());

-- Prohibir DELETE en tablas de auditoría (defensa adicional)
create or replace function public.dulabs_flow_deny_audit_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'DELETE prohibido en tabla de auditoría %', tg_table_name;
end;
$$;

drop trigger if exists dulabs_flow_events_deny_delete on public.dulabs_flow_events;
create trigger dulabs_flow_events_deny_delete
  before delete on public.dulabs_flow_events
  for each row execute function public.dulabs_flow_deny_audit_delete();

drop trigger if exists dulabs_flow_effects_deny_delete on public.dulabs_flow_effects;
create trigger dulabs_flow_effects_deny_delete
  before delete on public.dulabs_flow_effects
  for each row execute function public.dulabs_flow_deny_audit_delete();

drop trigger if exists dulabs_flow_node_transitions_deny_delete on public.dulabs_flow_node_transitions;
create trigger dulabs_flow_node_transitions_deny_delete
  before delete on public.dulabs_flow_node_transitions
  for each row execute function public.dulabs_flow_deny_audit_delete();
