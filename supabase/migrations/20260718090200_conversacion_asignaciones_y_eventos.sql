-- Asignación manual (Fase 1: solo autoasignación / asignación manual, sin
-- round-robin ni reglas de enrutamiento) de una conversación derivada
-- (phone_number_id, telefono_cliente) a un miembro del equipo. No existe una
-- tabla "conversaciones": esta es una tabla lateral que se une (LEFT JOIN)
-- sobre el historial ya deduplicado en app/api/dashboard/conversaciones/route.ts.
create table public.dulabs_conversacion_asignaciones (
  id bigint generated always as identity primary key,
  phone_number_id text not null,
  telefono_cliente text not null,
  miembro_id bigint references public.dulabs_miembros_equipo(id) on delete set null,
  asignado_por bigint references public.dulabs_miembros_equipo(id) on delete set null,
  asignado_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_conversacion_asignaciones_conversacion_key unique (phone_number_id, telefono_cliente)
);

comment on table public.dulabs_conversacion_asignaciones is
  'Asignación manual (Fase 1) de una conversación a un miembro del equipo. Una fila por (phone_number_id, telefono_cliente); miembro_id null = sin asignar.';

alter table public.dulabs_conversacion_asignaciones enable row level security;

-- Bitácora de eventos de asignación y de envíos manuales desde el Inbox web,
-- pensada para reportes de desempeño de equipo más adelante, sin tener que
-- rearquitecturar nada hoy.
create table public.dulabs_conversacion_eventos (
  id bigint generated always as identity primary key,
  phone_number_id text not null,
  telefono_cliente text not null,
  tipo text not null,
  miembro_id bigint references public.dulabs_miembros_equipo(id) on delete set null,
  detalle jsonb,
  created_at timestamptz not null default now(),
  constraint dulabs_conversacion_eventos_tipo_check check (tipo in ('asignado', 'reasignado', 'liberado', 'mensaje_enviado'))
);

create index dulabs_conversacion_eventos_conversacion_idx
  on public.dulabs_conversacion_eventos (phone_number_id, telefono_cliente, created_at desc);

comment on table public.dulabs_conversacion_eventos is
  'Bitácora de eventos de asignación y envío manual desde el Inbox web.';

alter table public.dulabs_conversacion_eventos enable row level security;
