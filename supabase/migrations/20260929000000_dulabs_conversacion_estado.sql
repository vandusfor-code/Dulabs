-- Fase 9 (Human Inbox, autorizado) — estado explícito (open/pending/closed)
-- y marca de lectura de una conversación. Mismo criterio EXACTO que
-- dulabs_conversacion_asignaciones/dulabs_conversacion_eventos
-- (20260718090200_conversacion_asignaciones_y_eventos.sql): tabla LATERAL
-- que se une (LEFT JOIN) sobre el historial ya deduplicado de
-- dulabs_mensajes_log en app/api/dashboard/conversaciones/route.ts -- NO se
-- crea una tabla "conversaciones" completa, esa decisión de diseño ya
-- estaba tomada y documentada antes de esta fase, y sigue siendo correcta:
-- la fuente de verdad del historial real sigue siendo dulabs_mensajes_log,
-- esto solo le agrega metadata operativa por (phone_number_id,
-- telefono_cliente).
--
-- Sin fila = comportamiento por defecto (estado 'open' implícito,
-- leido_hasta = época 0 = todo lo entrante cuenta como no leído) -- ninguna
-- conversación existente cambia de comportamiento hasta que alguien la
-- toque desde el Inbox.
create table if not exists public.dulabs_conversacion_estado (
  id bigint generated always as identity primary key,
  phone_number_id text not null,
  telefono_cliente text not null,
  estado text not null default 'open',
  cerrado_en timestamptz,
  -- Mensajes ENTRANTES con created_at > leido_hasta cuentan como no leídos
  -- (calculado en la API, no una columna contadora -- evita otra fuente de
  -- verdad que se pueda desincronizar). Default época 0: toda conversación
  -- sin fila propia empieza "sin leer" desde siempre, nunca falso-negativo.
  leido_hasta timestamptz not null default 'epoch',
  updated_at timestamptz not null default now(),
  constraint dulabs_conversacion_estado_unica unique (phone_number_id, telefono_cliente)
);

alter table public.dulabs_conversacion_estado
  drop constraint if exists dulabs_conversacion_estado_valido;
alter table public.dulabs_conversacion_estado
  add constraint dulabs_conversacion_estado_valido
  check (estado in ('open', 'pending', 'closed'));

create index if not exists dulabs_conversacion_estado_conversacion_idx
  on public.dulabs_conversacion_estado (phone_number_id, telefono_cliente);

comment on table public.dulabs_conversacion_estado is
  'Fase 9 (Human Inbox) — estado (open/pending/closed) y marca de lectura de una conversación derivada (phone_number_id, telefono_cliente). Sin fila = open + no leída (default seguro). Una conversación closed reopens automáticamente (calculado en la API) en cuanto llega un mensaje entrante posterior a cerrado_en, sin necesitar un write del webhook.';

alter table public.dulabs_conversacion_estado enable row level security;
