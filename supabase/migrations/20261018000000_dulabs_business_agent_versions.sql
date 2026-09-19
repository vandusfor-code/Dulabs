-- DuLabs Business — Agent Compiler, Step 8A: Business Agent Registry.
--
-- Tabla NUEVA, aditiva. NO modifica dulabs_flows/dulabs_flow_versions ni
-- ninguna tabla existente. Justificación de por qué es necesaria (y no basta
-- con reusar definition_json de dulabs_flow_versions):
--
--   1. Los Guardrails (GateRules) del Business Agent viven DELIBERADAMENTE
--      fuera del FlowDefinition desde la Fase 7.1 ("Los guardrails NO se
--      generan dentro del FlowDefinition. Viven en el Business Guardrail
--      Gate" — evita duplicar el motor de guardrails dentro del Flow Engine).
--      dulabs_flow_versions.definition_json es consumido en TODA la app como
--      un FlowDefinition puro (parseFlowDefinition, validateFlowDefinition,
--      Flow Studio, el orquestador) — mezclar ahí las GateRules acoplaría
--      esa tabla compartida (usada también por flows hand-built de OTROS
--      productos/tenants) al concepto de Business Agent Compiler.
--   2. BusinessAgentSpec y CompiledBusinessAgentIR son necesarios para
--      auditoría/reproducibilidad ("¿exactamente qué configuración estaba
--      ejecutando el agente cuando ocurrió este mensaje?") pero NO son un
--      FlowDefinition ni deben interpretarse como tal.
--
-- Identity/Version/Publish/Rollback se REUTILIZAN sin cambios:
--   Agent Identity  = dulabs_flows           (slug fijo 'business-agent' por tenant)
--   Agent Version   = dulabs_flow_versions   (definition_json = FlowDefinition)
--   Publish/Rollback = dulabs_flow_publish_version (RPC existente, atómico,
--                       row-lock ya serializa publicaciones concurrentes del
--                       mismo flow; rollback = volver a apuntar published_version_id
--                       a una versión anterior, sin restricción de orden).
--   Binding WhatsApp → Agent = dulabs_clientes_config.flow_activo/.flow_id
--                       (ya existente, opt-in, CHECK que impide estado a medias).
--
-- Esta tabla es el eslabón 1:1 que le falta a una dulabs_flow_versions para
-- ser, ADEMÁS, un Business Agent: existencia de fila = "esta versión fue
-- producida por el Agent Compiler". Una dulabs_flow_versions SIN fila aquí es
-- un flow hand-built normal (Flow Studio) y sigue el camino Legacy/Flow normal,
-- nunca el Business Guardrail Gate.

create table if not exists public.dulabs_business_agent_versions (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  flow_id uuid not null,
  flow_version_id uuid not null,

  -- Artefactos completos (auditoría/reproducibilidad/debugging/rollback).
  spec_json jsonb not null,
  spec_checksum text not null,
  ir_json jsonb not null,
  ir_checksum text not null,
  gate_rules_json jsonb not null default '[]'::jsonb,
  -- Checksum del FlowDefinition ya persistido en dulabs_flow_versions.definition_json
  -- (recalculable) -- detecta corrupción/tampering comparando en el resolver.
  flow_checksum text not null,

  -- Validación de PUBLICACIÓN (validateFlowForPublish: end node + camino
  -- start->end). El compilador YA exige que definition_json pase
  -- validateFlowDefinition antes de persistir nada (si falla, no hay fila que
  -- crear) -- este status es la capa adicional de "¿puede PUBLICARSE?".
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'validated', 'failed')),
  validation_report jsonb not null default '[]'::jsonb,

  compiled_by uuid,
  compiled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  primary key (tenant_id, id),

  -- 1:1 real: nunca dos filas de artefactos para la misma versión de flow.
  constraint dulabs_business_agent_versions_version_key
    unique (tenant_id, flow_version_id),

  constraint dulabs_business_agent_versions_flow_fk
    foreign key (tenant_id, flow_id)
    references public.dulabs_flows (tenant_id, id)
    on delete restrict,

  constraint dulabs_business_agent_versions_version_fk
    foreign key (tenant_id, flow_version_id)
    references public.dulabs_flow_versions (tenant_id, id)
    on delete restrict
);

create index if not exists dulabs_business_agent_versions_flow_idx
  on public.dulabs_business_agent_versions (tenant_id, flow_id);

comment on table public.dulabs_business_agent_versions is
  'Artefactos del Agent Compiler (Spec/IR/GateRules/checksums) para una dulabs_flow_versions. 1:1. Existencia de fila = esta versión es un Business Agent (no un flow hand-built). Inmutable desde su creación (ver trigger guard).';

comment on column public.dulabs_business_agent_versions.gate_rules_json is
  'GateRule[] del Business Guardrail Gate (lib/agent-compiler/runtime/guardrail-gate.ts). Vive fuera de definition_json a propósito (Fase 7.1): el Gate no es parte del Flow Engine genérico.';

comment on column public.dulabs_business_agent_versions.flow_checksum is
  'Checksum (sha256) del FlowDefinition calculado en compileIRToFlowDefinition. Permite detectar si dulabs_flow_versions.definition_json fue alterado fuera del pipeline del compiler.';

-- ---------------------------------------------------------------------------
-- Inmutabilidad DESDE LA CREACIÓN (más estricta que dulabs_flow_versions, que
-- solo se vuelve inmutable tras publicar). Justificación: un artefacto de
-- compilación es un hecho histórico ("esto fue lo que el compiler produjo en
-- este intento") desde el instante en que existe, publicado o no -- nunca se
-- corrige en el lugar; una recompilación crea una fila NUEVA (nuevo
-- flow_version). Esto es más simple y más seguro que permitir edición
-- pre-publish, y es consistente con "el Compiler nunca hace best-effort ni
-- corrige en silencio" (Steps 5/6).
-- ---------------------------------------------------------------------------

create or replace function public.dulabs_business_agent_versions_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'dulabs_business_agent_versions: fila inmutable, no se puede eliminar (id=%)', old.id;
  end if;
  if tg_op = 'UPDATE' then
    if new.spec_json is distinct from old.spec_json
      or new.ir_json is distinct from old.ir_json
      or new.gate_rules_json is distinct from old.gate_rules_json
      or new.flow_checksum is distinct from old.flow_checksum
      or new.spec_checksum is distinct from old.spec_checksum
      or new.ir_checksum is distinct from old.ir_checksum
      or new.flow_id is distinct from old.flow_id
      or new.flow_version_id is distinct from old.flow_version_id
      or new.tenant_id is distinct from old.tenant_id
    then
      raise exception 'dulabs_business_agent_versions: los artefactos son inmutables tras la creación (id=%)', old.id;
    end if;
    -- Únicamente validation_status/validation_report pueden avanzar (ej. una
    -- simulación posterior marca failed), nunca los artefactos en sí.
  end if;
  return new;
end;
$$;

drop trigger if exists dulabs_business_agent_versions_guard_immutable on public.dulabs_business_agent_versions;
create trigger dulabs_business_agent_versions_guard_immutable
  before update or delete on public.dulabs_business_agent_versions
  for each row execute function public.dulabs_business_agent_versions_guard_immutable();

-- ---------------------------------------------------------------------------
-- retired_at: activamos el uso de una columna YA EXISTENTE (sin uso) en
-- dulabs_flow_versions para marcar SUPERSEDED de forma auditable. No requiere
-- ALTER TABLE (la columna ya existe desde la migración original del Flow
-- Store) -- la usaremos solo desde el TS del Registry (UPDATE simple, el
-- trigger de inmutabilidad de esa tabla NO protege retired_at/published_at).
-- Se documenta aquí para dejar constancia de la decisión de diseño.
-- ---------------------------------------------------------------------------

comment on column public.dulabs_flow_versions.retired_at is
  'Marca de auditoría best-effort: cuándo esta versión dejó de ser la publicada (superseded por otra). NO es la fuente de verdad de "superseded" -- eso se deriva de published_at is not null AND id <> flows.published_version_id. Seteado por el Business Agent Registry (lib/agent-compiler/registry) al publicar una versión nueva.';

-- ---------------------------------------------------------------------------
-- RLS — mismo patrón que dulabs_flow_versions: lectura tenant-scoped para
-- authenticated (futura UI de auditoría/version history), escritura solo
-- service_role. Sin secretos en esta tabla (Spec/IR/GateRules son config de
-- negocio, nunca tokens/credenciales -- el pipeline del compiler ya está
-- probado para nunca embeber secretos, ver detectEmbeddedSecrets en
-- dulabs_flow_versions y los tests de Steps 5/6).
-- ---------------------------------------------------------------------------

alter table public.dulabs_business_agent_versions enable row level security;

drop policy if exists tenant_select on public.dulabs_business_agent_versions;
create policy tenant_select on public.dulabs_business_agent_versions
  for select to authenticated
  using (tenant_id = public.dulabs_tenant_del_usuario());
