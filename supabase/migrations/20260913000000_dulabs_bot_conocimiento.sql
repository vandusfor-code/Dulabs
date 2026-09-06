-- Base de conocimiento del bot conversacional (autorizado, AMORE primer
-- tenant). Separada DELIBERADAMENTE de dulabs_servicios (hechos confirmados
-- de AMORE: existencia/nombre/categoría/precio/duración) y de
-- dulabs_bot_escenarios (qué hacer ante cada intención) -- esta tabla solo
-- guarda explicación profesional general por servicio, con su nivel de
-- confianza explícito, para que la IA nunca la confunda con un protocolo
-- específico de AMORE.
--
-- El FK real hacia dulabs_servicios es la única barrera que importa: es
-- estructuralmente imposible crear una ficha de conocimiento para un
-- servicio que no existe en el catálogo real (ej. "Secado Rápido"/"Base
-- Rubber"/"Acrílicas" -- ninguno tiene fila en dulabs_servicios hoy).
--
-- dulabs_servicios usa PK COMPUESTA (id_tenant, id) -- nunca `id` solo es
-- referenciable por un FK de una sola columna (Postgres exige que las
-- columnas referenciadas tengan su propia UNIQUE/PK). Por eso el FK de acá
-- es compuesto (tenant_id, servicio_id) -> dulabs_servicios(id_tenant, id):
-- además de impedir servicios inventados, esto impide ESTRUCTURALMENTE que
-- una ficha de conocimiento de un tenant apunte al servicio de OTRO tenant.
--
-- Misma convención ya establecida por dulabs_bot_escenarios (migración
-- 20260912000000): PK compuesta (tenant_id, id), trigger
-- dulabs_flow_set_updated_at() ya existente, RLS de lectura-tenant +
-- escritura-solo-service_role.
create table if not exists public.dulabs_bot_conocimiento (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  servicio_id uuid not null,
  -- confirmado_amore: dato que el propio salón confirmó (hoy, ninguna fila
  --   usa este valor -- toda esta siembra inicial es conocimiento_general).
  -- conocimiento_general: explicación profesional general del servicio,
  --   nunca un protocolo específico de AMORE.
  -- no_confirmado: reservado para marcar explícitamente que algo NO se sabe
  --   (uso futuro; hoy basta con dejar el campo en null).
  fuente text not null
    check (fuente in ('confirmado_amore', 'conocimiento_general', 'no_confirmado')),
  que_es text,
  para_que_sirve text,
  -- Nunca se le muestra tal cual a la clienta -- es una restricción para la
  -- IA (qué NO debe afirmar sobre este servicio: productos, marcas,
  -- protocolo exacto, duración del resultado, etc.).
  limites text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint dulabs_bot_conocimiento_servicio_fk
    foreign key (tenant_id, servicio_id)
    references public.dulabs_servicios (id_tenant, id)
    on delete cascade,
  constraint dulabs_bot_conocimiento_servicio_unico
    unique (tenant_id, servicio_id)
);

create index if not exists dulabs_bot_conocimiento_tenant_activo_idx
  on public.dulabs_bot_conocimiento (tenant_id, activo)
  where activo = true;

comment on table public.dulabs_bot_conocimiento is
  'Conocimiento explicativo general por servicio (qué es / para qué sirve / límites), separado de los hechos confirmados de AMORE (dulabs_servicios) y de los escenarios (dulabs_bot_escenarios). El FK a dulabs_servicios impide crear fichas para servicios que no existen en el catálogo real.';

drop trigger if exists dulabs_bot_conocimiento_updated_at on public.dulabs_bot_conocimiento;
create trigger dulabs_bot_conocimiento_updated_at
  before update on public.dulabs_bot_conocimiento
  for each row execute function public.dulabs_flow_set_updated_at();

alter table public.dulabs_bot_conocimiento enable row level security;

drop policy if exists tenant_select on public.dulabs_bot_conocimiento;
create policy tenant_select on public.dulabs_bot_conocimiento
  for select to authenticated
  using (tenant_id = public.dulabs_tenant_del_usuario());

-- Sin políticas de INSERT/UPDATE/DELETE para `authenticated` -- igual que
-- dulabs_bot_escenarios: la escritura pasa siempre por service_role (hoy,
-- un script de seed autorizado).
