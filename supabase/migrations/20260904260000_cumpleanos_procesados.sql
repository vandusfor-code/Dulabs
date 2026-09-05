-- AMORE (Fase 6A, cumpleaños automáticos, autorizado) — idempotencia real:
-- un cliente no puede recibir dos mensajes de cumpleaños el mismo año sin
-- importar cuántas veces corra el cron. Mismo patrón ya probado en
-- dulabs_idempotencia_reservas (20260904050000_daniela_reserva_idempotencia.sql):
-- la garantía la da la restricción UNIQUE de Postgres, nunca un lock de
-- aplicación -- el motor intenta el INSERT primero; si otra ejecución
-- (o una concurrente) ya lo hizo, Postgres responde 23505 y el motor sabe
-- que no debe enviar nada.

create table if not exists public.dulabs_cumpleanos_procesados (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  cliente_id bigint not null references public.dulabs_clientes_conocidos(id) on delete cascade,
  anio smallint not null,
  telefono_cliente text not null,
  estado text not null default 'registrado' check (estado in ('registrado', 'enviado', 'simulado', 'fallido')),
  mensaje_enviado text,
  detalle text,
  procesado_at timestamptz not null default now(),
  constraint dulabs_cumpleanos_procesados_unico unique (id_tenant, cliente_id, anio)
);

create index if not exists dulabs_cumpleanos_procesados_tenant_anio_idx
  on public.dulabs_cumpleanos_procesados (id_tenant, anio);

alter table public.dulabs_cumpleanos_procesados enable row level security;

comment on table public.dulabs_cumpleanos_procesados is
  'Registro de qué cliente ya fue procesado por cumpleaños en qué año (Fase 6A). La restricción UNIQUE (id_tenant, cliente_id, anio) es el mecanismo real de idempotencia: un segundo intento de la MISMA combinación cliente+tenant+año siempre falla con 23505, sin importar ejecuciones repetidas o concurrentes del cron.';
comment on column public.dulabs_cumpleanos_procesados.estado is
  '"registrado" = reclamado pero todavía procesando; "enviado" = WhatsApp real enviado (lib/whatsapp-outbound.ts); "simulado" = corrida de prueba con un enviador mock, nunca tocó Meta; "fallido" = se reclamó pero el envío falló (ej. teléfono inválido) -- no bloquea al resto del lote.';
