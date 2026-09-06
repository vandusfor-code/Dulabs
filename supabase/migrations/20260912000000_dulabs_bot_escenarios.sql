-- Banco de escenarios/respuestas del bot conversacional (autorizado, AMORE
-- primer tenant). Auditado primero: no existía ninguna tabla de "FAQ" /
-- "información del negocio" / "escenarios" -- se unifican en UNA sola tabla
-- genérica (nunca 3 sistemas paralelos para el mismo concepto de "variantes
-- de activación -> respuesta/acción"): un FAQ y un dato fijo del salón
-- (horario, ubicación, contacto...) son, estructuralmente, el mismo tipo de
-- fila que un escenario conversacional, solo con `modo` distinto.
--
-- Reutiliza EXACTAMENTE la convención ya establecida por dulabs_flow_triggers
-- (migración 20260903090000): PK compuesta (tenant_id, id), trigger
-- dulabs_flow_set_updated_at() ya existente, RLS de lectura-tenant +
-- escritura-solo-service_role (la escritura real hoy es solo un script de
-- seed autorizado, nunca desde el body de un request de cliente).
--
-- Esta tabla NO ejecuta nada -- la resolución determinista (matching de
-- variantes, prioridad, extracción de entidades, selección de respuesta)
-- vive en código puro (lib/bot-escenarios/*), igual que
-- dulabs_flow_triggers/trigger-router.ts.
create table if not exists public.dulabs_bot_escenarios (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  -- Código estable legible (ej. "020_categoria_unas") -- identifica el
  -- escenario en seeds/tests/logs, nunca se usa para lógica de negocio.
  codigo text not null,
  nombre text not null,
  -- deterministic: respuesta fija, sin datos externos (saludo, despedida).
  -- catalog: consulta datos reales del catálogo/profesionales antes de responder.
  -- faq: pregunta frecuente, respuesta fija configurada (incluye info del
  --   salón: horario/ubicación/contacto/redes/pagos/promociones/políticas).
  -- ai: requiere generación con Claude, recibiendo SOLO datos ya filtrados.
  -- portal: intención de reservar -- siempre envía el link del portal.
  -- transfer: transferencia a humano (transferir_soporte, ya existente).
  modo text not null check (modo in ('deterministic', 'catalog', 'faq', 'ai', 'portal', 'transfer')),
  -- Mayor gana. Convención de rangos (ver seed): portal/transfer 900-999,
  -- servicio específico 500-599, categoría 400-499, faq/salón 250-349,
  -- recomendación 100-199, general 1-99, fallback 0.
  prioridad integer not null default 0,
  activo boolean not null default true,
  -- Variantes de activación: [{"tipo":"contains"|"starts_with"|"exact"|"keyword","valor":"..."}].
  -- Mismo vocabulario de matching que ya usa lib/flow-triggers/match-trigger.ts
  -- (reutilizado en código, nunca reimplementado).
  variantes jsonb not null default '[]'::jsonb,
  -- Plantillas de respuesta (variación real, nunca una IA elige la frase):
  -- ["Claro que sí 💗 El {{servicio}}...", "Te cuento ✨ El {{servicio}}..."].
  -- Se interpola con lib/flow/message-interpolation.ts (ya existente).
  respuestas jsonb not null default '[]'::jsonb,
  -- Config específica del modo: filtro de categoría/nombre y sinónimos
  -- (catalog), instrucción adicional acotada para el nodo IA (modo=ai),
  -- texto alterno cuando no se resuelve servicio/categoría (catalog). Nunca
  -- contiene información inventada -- solo referencias a datos reales o
  -- instrucciones de comportamiento. La duración de pausa de
  -- transferir_soporte (modo=transfer) es fija (24h, config estática del
  -- nodo del flow) -- esa acción compartida no lee params dinámicos, así que
  -- no vive acá.
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint dulabs_bot_escenarios_codigo_unico unique (tenant_id, codigo)
);

create index if not exists dulabs_bot_escenarios_tenant_activo_idx
  on public.dulabs_bot_escenarios (tenant_id, activo)
  where activo = true;

comment on table public.dulabs_bot_escenarios is
  'Banco de escenarios/FAQ/información del negocio del bot conversacional, por tenant. Unifica lo que antes hubiera sido 3 tablas paralelas: son, estructuralmente, la misma forma (variantes de activación -> respuesta/acción), solo distinguidas por `modo`.';

drop trigger if exists dulabs_bot_escenarios_updated_at on public.dulabs_bot_escenarios;
create trigger dulabs_bot_escenarios_updated_at
  before update on public.dulabs_bot_escenarios
  for each row execute function public.dulabs_flow_set_updated_at();

alter table public.dulabs_bot_escenarios enable row level security;

drop policy if exists tenant_select on public.dulabs_bot_escenarios;
create policy tenant_select on public.dulabs_bot_escenarios
  for select to authenticated
  using (tenant_id = public.dulabs_tenant_del_usuario());

-- Sin políticas de INSERT/UPDATE/DELETE para `authenticated` -- igual que
-- dulabs_flow_triggers/dulabs_flows: la escritura pasa siempre por
-- service_role (hoy, un script de seed autorizado; una futura UI de admin
-- pasaría por una API server-side, nunca por el cliente directo).
