-- DuLabs Flow Builder — Triggers + Event Routing (Fase 3).
-- Declara CONDICIONES de match para decidir qué Flow debe activarse ante un
-- evento entrante. Esta tabla NO ejecuta nada -- la resolución determinista
-- vive en código puro (lib/flow-triggers/trigger-router.ts), nunca en SQL.
--
-- Reutiliza EXACTAMENTE la convención de dulabs_flows (Fase 3, migración
-- 20260828100000): PK compuesta (tenant_id, id), FK compuesta hacia
-- dulabs_flows, dulabs_flow_set_updated_at() ya existente, RLS de
-- lectura-tenant + escritura-solo-service_role.

create table if not exists public.dulabs_flow_triggers (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  flow_id uuid not null,
  type text not null
    check (type in (
      'conversation_started', 'user_message', 'keyword',
      'message_contains', 'message_starts_with', 'event', 'manual'
    )),
  enabled boolean not null default true,
  priority integer not null default 0,
  -- Solo los campos específicos del `type` (ej. {"keywords": [...]} o
  -- {"eventName": "..."}) -- `type` NUNCA se duplica dentro de config, es la
  -- columna de arriba la única fuente de verdad. Ver buildTriggerConfig()
  -- en lib/flow-triggers/types.ts, que reconstruye el TriggerConfig
  -- tipado a partir de (type, config) y descarta filas con forma inválida
  -- en vez de romper el routing completo del tenant.
  config jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint dulabs_flow_triggers_flow_fk
    foreign key (tenant_id, flow_id)
    references public.dulabs_flows (tenant_id, id)
    on delete cascade
);

-- Autoría: listar los triggers de UN Flow (Builder).
create index if not exists dulabs_flow_triggers_flow_idx
  on public.dulabs_flow_triggers (tenant_id, flow_id);

-- Routing: candidatos habilitados de un tenant completo (todos sus Flows).
create index if not exists dulabs_flow_triggers_tenant_enabled_idx
  on public.dulabs_flow_triggers (tenant_id, enabled)
  where enabled = true;

comment on table public.dulabs_flow_triggers is
  'Triggers que determinan qué Flow debe activarse para un evento entrante (Fase 3, Event Routing). Solo declara condiciones -- nunca ejecuta ni conoce el Flow Engine.';

drop trigger if exists dulabs_flow_triggers_updated_at on public.dulabs_flow_triggers;
create trigger dulabs_flow_triggers_updated_at
  before update on public.dulabs_flow_triggers
  for each row execute function public.dulabs_flow_set_updated_at();

alter table public.dulabs_flow_triggers enable row level security;

drop policy if exists tenant_select on public.dulabs_flow_triggers;
create policy tenant_select on public.dulabs_flow_triggers
  for select to authenticated
  using (tenant_id = public.dulabs_tenant_del_usuario());

-- Sin políticas de INSERT/UPDATE/DELETE para `authenticated` -- igual que
-- dulabs_flows/dulabs_flow_versions, la escritura pasa SIEMPRE por la API
-- (service_role, tenant_id derivado del usuario autenticado server-side,
-- nunca aceptado desde el body/query del request).
