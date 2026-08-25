-- Registro de fallos de la IA. Hasta ahora, cualquier error de Anthropic
-- (sin saldo, key revocada, rate limit) hacía que la IA se callara sin que
-- nadie se enterara: el catch de lib/ia.ts devolvía null y el cliente final
-- simplemente no recibía respuesta. Esta tabla los deja visibles y sirve
-- además de control de repetición para no mandar cientos de alertas
-- seguidas cuando el fallo es global (ver VENTANA_DEDUPE_MS en lib/alertas.ts).

create table if not exists public.dulabs_fallos_ia (
  id bigserial primary key,
  id_tenant uuid,
  phone_number_id text,
  tipo text not null,
  mensaje text,
  http_status int,
  alertado_at timestamptz,
  created_at timestamptz not null default now()
);

-- La consulta de repetición filtra por tipo + alertado_at reciente.
create index if not exists dulabs_fallos_ia_tipo_alertado_idx
  on public.dulabs_fallos_ia (tipo, alertado_at desc);

-- El panel lista los fallos recientes de un tenant.
create index if not exists dulabs_fallos_ia_tenant_creado_idx
  on public.dulabs_fallos_ia (id_tenant, created_at desc);

-- RLS activo sin políticas: solo el service_role (backend) la toca, igual
-- que el resto de tablas de la plataforma.
alter table public.dulabs_fallos_ia enable row level security;

comment on table public.dulabs_fallos_ia is
  'Fallos de generación de la IA (Anthropic), para visibilidad en el panel y para no repetir alertas del mismo tipo.';
comment on column public.dulabs_fallos_ia.tipo is
  'sin_saldo | key_invalida | rate_limit | sobrecarga | sin_key | otro — ver clasificarFalloIA en lib/alertas.ts.';
comment on column public.dulabs_fallos_ia.alertado_at is
  'Cuándo se avisó por WhatsApp al dueño. NULL = se registró pero no se alertó (ya se había avisado de este tipo hace poco).';
