-- Fase 3B — Trigger Router SaaS: activación por número (opt-in explícito).
--
-- Mismo criterio EXACTO que ya usa flow_activo/flow_id
-- (20260829120000_dulabs_flow_activacion_opt_in.sql): columna nueva,
-- default false, CERO cambio de comportamiento para cualquier fila
-- existente hasta que alguien la active a mano. Para el mecanismo NUEVO,
-- cumple el mismo rol que hoy cumple TRIGGER_ROUTING_TEST_SENDERS
-- (lib/flow-routing.ts) -- ese allowlist sigue existiendo SIN TOCAR, en
-- paralelo, hasta que una fase posterior conecte y compare ambos
-- mecanismos antes de retirarlo (ver reporte de Fase 3A/3B).
--
-- Por qué esta columna, en ESTA tabla, alcanza para representar
-- tenant_id + phone_number_id -> flow_id sin ambigüedad (verificado en
-- Fase 3B, Paso 0, con evidencia real de schema): `phone_number_id` tiene
-- un UNIQUE INDEX sobre TODA la tabla desde su creación
-- (20260713120000_create_dulabs_clientes_config.sql:19-20,
-- `dulabs_clientes_config_phone_number_id_idx`, nunca alterado desde
-- entonces), e `id_tenant` es NOT NULL
-- (20260713150000_embedded_signup_columns.sql:25). Por lo tanto, una fila
-- de esta tabla localizada por `phone_number_id` ES la tupla
-- (tenant_id, phone_number_id) -> flow_id, sin necesitar tenant_id como
-- filtro adicional: dos tenants nunca pueden compartir el mismo
-- phone_number_id (el índice único lo rechazaría al insertar).
--
-- Limitación conocida y documentada (no bloqueante para esta fase): como
-- `flow_id` es una sola columna (no una lista/tabla puente), esta tabla
-- resuelve UN solo Flow candidato por número -- no permite que varios
-- Flows compitan por trigger dentro del MISMO número (ej. "precio" -> Flow
-- Ventas, "soporte" -> Flow Soporte, ambos en el mismo phone_number_id).
-- Eso requeriría un modelo distinto (columna de canal en
-- dulabs_flow_triggers, o una tabla de activaciones N:1), fuera de alcance
-- de esta fase -- ver reporte de Fase 3A, sección 11.

alter table public.dulabs_clientes_config
  add column if not exists trigger_routing_activo boolean not null default false;

comment on column public.dulabs_clientes_config.trigger_routing_activo is
  'Fase 3B — opt-in explícito del Trigger Router SaaS para este número. Default false: ningún tenant existente cambia de comportamiento hasta activarse a mano. Requiere flow_activo=true (ver constraint abajo) -- no tiene sentido activar el Router sin un Flow base configurado para este número.';

-- Invariante: no tiene sentido activar el Trigger Router SaaS para un
-- número que ni siquiera tiene Flow activo -- mismo criterio exacto que el
-- constraint ya existente de flow_activo/flow_id
-- (dulabs_clientes_config_flow_activo_requiere_flow_id).
alter table public.dulabs_clientes_config
  drop constraint if exists dulabs_clientes_config_trigger_routing_requiere_flow_activo;

alter table public.dulabs_clientes_config
  add constraint dulabs_clientes_config_trigger_routing_requiere_flow_activo
  check (
    trigger_routing_activo = false
    or (flow_activo = true and flow_id is not null)
  );

-- Consulta operativa futura ("¿qué números tienen el Router SaaS activo?"),
-- mismo patrón exacto que dulabs_clientes_config_flow_activo_idx.
create index if not exists dulabs_clientes_config_trigger_routing_activo_idx
  on public.dulabs_clientes_config (trigger_routing_activo)
  where trigger_routing_activo = true;
