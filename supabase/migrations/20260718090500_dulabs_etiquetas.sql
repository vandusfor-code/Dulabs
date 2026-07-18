-- Etiquetas: catálogo de tags por tenant (nombre + color) y una tabla de
-- unión muchos-a-muchos que las aplica a una conversación. No existe una
-- tabla "conversaciones" (ver 20260718090200_conversacion_asignaciones_y_eventos.sql)
-- — igual que las asignaciones, una conversación es siempre el par
-- (phone_number_id, telefono_cliente). No se extiende el CHECK de
-- dulabs_conversacion_eventos.tipo para eventos de etiquetado: no hace
-- falta bitácora de auditoría para que esto sea funcional.

create table public.dulabs_etiquetas (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  nombre text not null,
  color text not null default '#c6ff3d',
  created_at timestamptz not null default now(),
  constraint dulabs_etiquetas_tenant_nombre_key unique (tenant_id, nombre)
);

create index dulabs_etiquetas_tenant_id_idx on public.dulabs_etiquetas (tenant_id);

comment on table public.dulabs_etiquetas is
  'Catálogo de etiquetas por tenant (nombre + color hex). Cualquier rol activo las puede ver; solo admin/agente las crean/borran.';

alter table public.dulabs_etiquetas enable row level security;

create policy tenant_select on public.dulabs_etiquetas
  for select to authenticated
  using (tenant_id = public.dulabs_tenant_del_usuario());

create table public.dulabs_conversacion_etiquetas (
  id bigint generated always as identity primary key,
  phone_number_id text not null,
  telefono_cliente text not null,
  etiqueta_id bigint not null references public.dulabs_etiquetas(id) on delete cascade,
  asignado_por bigint references public.dulabs_miembros_equipo(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint dulabs_conversacion_etiquetas_unica unique (phone_number_id, telefono_cliente, etiqueta_id)
);

create index dulabs_conversacion_etiquetas_conversacion_idx
  on public.dulabs_conversacion_etiquetas (phone_number_id, telefono_cliente);

comment on table public.dulabs_conversacion_etiquetas is
  'Unión muchos-a-muchos: qué etiquetas tiene aplicada una conversación (phone_number_id, telefono_cliente).';

alter table public.dulabs_conversacion_etiquetas enable row level security;

create policy tenant_select on public.dulabs_conversacion_etiquetas
  for select to authenticated
  using (phone_number_id in (select public.dulabs_numeros_del_tenant()));
