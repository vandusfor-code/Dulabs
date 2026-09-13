-- Fase 8.5 (Connection Lifecycle, autorizado) — estado de conexión WhatsApp
-- explícito, INDEPENDIENTE de flow_activo/flow_id/trigger_routing_activo/
-- ia_pausada: hoy no existe ninguna forma de "desconectar" un número sin
-- borrarlo por completo (ver DELETE /api/dashboard/negocio, que es la
-- política de eliminación de datos de Meta -- irreversible a propósito, no
-- debe confundirse con esto). Esta columna representa el ciclo de vida REAL
-- de la conexión con Meta, para poder ofrecer un disconnect reversible que
-- preserve el negocio.
--
-- Default 'conectado' para TODA fila existente: hoy todo tenant con una fila
-- en esta tabla está, de hecho, conectado (o usando el fallback de token de
-- plataforma) -- cero cambio de comportamiento para AMORE/Daniela/
-- Charlotte/Solo Talento ni ningún otro tenant real hasta que alguien
-- desconecte un número a mano.
alter table public.dulabs_clientes_config
  add column if not exists estado_conexion text not null default 'conectado';

alter table public.dulabs_clientes_config
  drop constraint if exists dulabs_clientes_config_estado_conexion_valido;

alter table public.dulabs_clientes_config
  add constraint dulabs_clientes_config_estado_conexion_valido
  check (estado_conexion in ('conectado', 'desconectado', 'reconectando', 'error'));

-- Momento del último disconnect explícito (null mientras esté conectado o
-- nunca se haya desconectado) -- útil para soporte/auditoría, nunca leído
-- por ninguna lógica de negocio.
alter table public.dulabs_clientes_config
  add column if not exists desconectado_en timestamptz;

comment on column public.dulabs_clientes_config.estado_conexion is
  'Fase 8.5 — ciclo de vida de la conexión WhatsApp (conectado/desconectado/reconectando/error). Independiente de flow_activo/flow_id/trigger_routing_activo/ia_pausada: desconectar WhatsApp NUNCA implica desactivar el Flow. Default conectado — no afecta a ningún tenant existente.';
comment on column public.dulabs_clientes_config.desconectado_en is
  'Fase 8.5 — timestamp del último disconnect explícito vía POST /api/dashboard/negocio/desconectar. NULL si nunca se desconectó o si ya está reconectado.';

create index if not exists dulabs_clientes_config_estado_conexion_idx
  on public.dulabs_clientes_config (estado_conexion)
  where estado_conexion <> 'conectado';
