-- Fase 0 — Migración a Flow (Daniela): opt-in explícito por número.
--
-- Requisito de la auditoría: debe existir una forma INEQUÍVOCA, explícita y
-- opt-in de decidir qué phone_number_id usa el motor Flow en vez de LEGACY.
-- Nada heurístico (no "si tiene especialistas entonces Flow"), nada que
-- pueda activarse por accidente para un tenant que no lo pidió.
--
-- Default false / null en ambas columnas: CERO cambio de comportamiento para
-- cualquier tenant existente, incluida Daniela, hasta que alguien active
-- flow_activo=true a mano para un phone_number_id puntual.

alter table public.dulabs_clientes_config
  add column if not exists flow_activo boolean not null default false;

alter table public.dulabs_clientes_config
  add column if not exists flow_id uuid references public.dulabs_flows (id);

comment on column public.dulabs_clientes_config.flow_activo is
  'Opt-in explícito: true = este número usa el motor Flow (dulabs_flow_executions) en vez del motor LEGACY. Default false — no afecta a ningún tenant existente hasta activarse a mano.';

comment on column public.dulabs_clientes_config.flow_id is
  'Flow publicado que atiende este número cuando flow_activo=true. NULL mientras flow_activo sea false.';

-- Invariante: no tiene sentido tener flow_id sin flow_activo=true, ni
-- flow_activo=true sin un flow_id que ejecutar -- exigirlo aquí evita un
-- estado a medias que silenciosamente no haga nada (o rompa) en el webhook.
alter table public.dulabs_clientes_config
  drop constraint if exists dulabs_clientes_config_flow_activo_requiere_flow_id;

alter table public.dulabs_clientes_config
  add constraint dulabs_clientes_config_flow_activo_requiere_flow_id
  check (
    (flow_activo = false and flow_id is null)
    or (flow_activo = true and flow_id is not null)
  );

create index if not exists dulabs_clientes_config_flow_activo_idx
  on public.dulabs_clientes_config (flow_activo)
  where flow_activo = true;
