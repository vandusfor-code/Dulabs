-- AMORE / DuLabs (Fase 7, fidelización, autorizado) — reglas GENÉRICAS de
-- fidelización por tenant+servicio. Ningún dato de cliente ni de reserva
-- vive acá -- eso sigue siendo dulabs_clientes_conocidos/
-- dulabs_citas_especialista, sin cambios. Aditiva: tabla nueva.
--
-- servicio_id referencia el catálogo real (dulabs_servicios) con la MISMA
-- FK compuesta (id_tenant, servicio_id) ya usada en
-- dulabs_servicio_especialista/dulabs_citas_especialista (Fase 1/6A): a
-- nivel de Postgres, una regla nunca puede apuntar a un servicio de OTRO
-- tenant. Un servicio admite como máximo UNA regla por tenant (unique) --
-- así una cita nunca puede calificar para dos reglas distintas a la vez.

create table if not exists public.dulabs_fidelizacion_reglas (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  servicio_id uuid not null,
  dias smallint not null check (dias > 0),
  activa boolean not null default true,
  mensaje text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_fidelizacion_reglas_servicio_fk
    foreign key (id_tenant, servicio_id)
    references public.dulabs_servicios (id_tenant, id)
    on delete cascade,
  constraint dulabs_fidelizacion_reglas_unico unique (id_tenant, servicio_id)
);

create index if not exists dulabs_fidelizacion_reglas_tenant_activa_idx
  on public.dulabs_fidelizacion_reglas (id_tenant)
  where activa;

alter table public.dulabs_fidelizacion_reglas enable row level security;

comment on table public.dulabs_fidelizacion_reglas is
  'Reglas de fidelización por tenant (Fase 7): cuántos días después de un servicio COMPLETADO se considera momento de volver a contactar a la clienta. Genérica -- cualquier tenant puede tener sus propias reglas, no es exclusiva de AMORE. Sin reglas reales todavía para ningún tenant -- se configuran en una subfase posterior.';
comment on column public.dulabs_fidelizacion_reglas.mensaje is
  'Plantilla del mensaje de fidelización. Soporta {{nombre}}, {{servicio}} y {{dias}}. Debe ser de seguimiento, NUNCA de venta directa -- sin descuentos, promociones ni botones de reserva (ver lib/fidelizacion/mensaje.ts).';
