-- AMORE / DuLabs (Fase 8, confirmaciones y recordatorios, autorizado) —
-- idempotencia real: la MISMA cita no puede recibir dos veces el MISMO tipo
-- de comunicación (confirmación/recordatorio), sin importar cuántas veces
-- corra el motor ni si dos ejecuciones coinciden en el tiempo. Mismo patrón
-- ya probado en dulabs_cumpleanos_procesados (Fase 6A) y
-- dulabs_fidelizacion_oportunidades (Fase 7): la garantía la da la
-- restricción UNIQUE de Postgres, nunca un lock de aplicación.
--
-- Una sola tabla genérica para ambos tipos (columna `tipo`) en vez de dos
-- tablas separadas -- exactamente la clave pedida es "cita + tipo de
-- comunicación", así que un UNIQUE (id_tenant, cita_id, tipo) la modela
-- directamente sin duplicar la estructura por tipo.

create table if not exists public.dulabs_comunicaciones_procesadas (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  cita_id bigint not null references public.dulabs_citas_especialista(id) on delete cascade,
  tipo text not null check (tipo in ('confirmacion', 'recordatorio')),
  telefono_cliente text not null,
  mensaje_renderizado text not null,
  estado text not null default 'simulado' check (estado in ('simulado', 'enviado', 'fallido')),
  detalle text,
  procesado_at timestamptz not null default now(),
  constraint dulabs_comunicaciones_procesadas_unico unique (id_tenant, cita_id, tipo)
);

create index if not exists dulabs_comunicaciones_procesadas_tenant_idx
  on public.dulabs_comunicaciones_procesadas (id_tenant, tipo);

alter table public.dulabs_comunicaciones_procesadas enable row level security;

comment on table public.dulabs_comunicaciones_procesadas is
  'Registro de qué cita ya recibió qué tipo de comunicación (Fase 8). UNIQUE (id_tenant, cita_id, tipo) es el mecanismo real de idempotencia: "cita 3057 + confirmación" y "cita 3057 + recordatorio" son dos filas independientes, cada una procesable una sola vez.';
comment on column public.dulabs_comunicaciones_procesadas.estado is
  '"simulado" = corrida real de esta fase (sin canal de envío todavía, ver lib/comunicaciones/adaptador.ts); "enviado"/"fallido" quedan preparados para cuando exista un adaptador real (WhatsApp QR, Fase 9).';
