-- AMORE / DuLabs (Fase 7, fidelización, autorizado) — idempotencia real:
-- el mismo cliente no puede entrar dos veces a la misma regla por la MISMA
-- visita, sin importar cuántas veces corra el motor. Mismo patrón ya
-- probado en dulabs_cumpleanos_procesados (Fase 6A) y en
-- dulabs_idempotencia_reservas (Fase 4): la garantía la da la restricción
-- UNIQUE de Postgres, nunca un lock de aplicación.
--
-- (regla_id, cita_id) ya es suficiente por sí solo: una regla pertenece a
-- UN servicio (unique en dulabs_fidelizacion_reglas), así que una cita
-- jamás puede calificar para dos reglas a la vez -- id_tenant se agrega de
-- todas formas para poder filtrar/aislar sin hacer join, igual que el resto
-- del esquema.

create table if not exists public.dulabs_fidelizacion_oportunidades (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  regla_id bigint not null references public.dulabs_fidelizacion_reglas(id) on delete cascade,
  cita_id bigint not null references public.dulabs_citas_especialista(id) on delete cascade,
  cliente_id bigint not null references public.dulabs_clientes_conocidos(id) on delete cascade,
  telefono_cliente text not null,
  fecha_visita timestamptz not null,
  dias_regla smallint not null,
  mensaje_renderizado text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'contactado', 'descartado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_fidelizacion_oportunidades_unico unique (id_tenant, regla_id, cita_id)
);

create index if not exists dulabs_fidelizacion_oportunidades_tenant_estado_idx
  on public.dulabs_fidelizacion_oportunidades (id_tenant, estado);

alter table public.dulabs_fidelizacion_oportunidades enable row level security;

comment on table public.dulabs_fidelizacion_oportunidades is
  'Oportunidades de fidelización generadas (Fase 7): una fila por (regla, cita) -- la restricción UNIQUE (id_tenant, regla_id, cita_id) es el mecanismo real de idempotencia, igual que dulabs_cumpleanos_procesados. "estado" es el flujo MANUAL del panel (pendiente/contactado/descartado), no un estado de envío -- esta fase no envía WhatsApp.';
comment on column public.dulabs_fidelizacion_oportunidades.estado is
  '"pendiente" = recién generada, nadie la trabajó todavía; "contactado" = el negocio ya se comunicó (manualmente, fuera de DuLabs en esta fase); "descartado" = no aplica/no se va a contactar.';
