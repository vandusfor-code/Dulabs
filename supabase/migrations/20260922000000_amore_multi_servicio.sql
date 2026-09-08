-- AMORE (autorizado, Fase 3 multi-servicio) — tabla puente normalizada
-- cita <-> servicio, para permitir hasta 3 servicios en UNA sola reserva
-- (mismo profesional, un solo bloque continuo de tiempo). Migración
-- puramente ADITIVA: no toca ninguna fila existente, no borra ni renombra
-- ninguna columna, no hace backfill. servicio/servicio_id de
-- dulabs_citas_especialista SIGUEN representando el primer servicio de la
-- cita -- todo el código legado que los lee sigue funcionando sin ningún
-- cambio, tanto para citas históricas de un solo servicio como para las
-- nuevas.
--
-- id_tenant se agrega en la fila del puente (más allá de cita_id/servicio_id/
-- orden) porque es la ÚNICA forma de anclar una FK compuesta real hacia
-- dulabs_servicios, cuya PK es (id_tenant, id) -- MISMO patrón exacto ya
-- usado por dulabs_servicio_especialista
-- (20260904030000_daniela_reservas_modelo_v1.sql) para el mismo problema.

create table public.dulabs_cita_servicios (
  id bigint generated always as identity primary key,
  cita_id bigint not null references public.dulabs_citas_especialista(id) on delete cascade,
  id_tenant uuid not null,
  servicio_id uuid not null,
  orden smallint not null,
  created_at timestamptz not null default now(),
  constraint dulabs_cita_servicios_servicio_fk
    foreign key (id_tenant, servicio_id)
    references public.dulabs_servicios (id_tenant, id),
  -- Nunca el mismo servicio dos veces dentro de la misma cita.
  constraint dulabs_cita_servicios_sin_duplicado unique (cita_id, servicio_id),
  -- Orden real dentro de la cita (1..3, ver regla de máximo 3 servicios) --
  -- nunca dos servicios con el mismo número de orden en la misma cita.
  constraint dulabs_cita_servicios_orden_valido check (orden between 1 and 3),
  constraint dulabs_cita_servicios_orden_unico unique (cita_id, orden)
);

create index dulabs_cita_servicios_cita_idx on public.dulabs_cita_servicios (cita_id);
create index dulabs_cita_servicios_servicio_idx on public.dulabs_cita_servicios (id_tenant, servicio_id);

alter table public.dulabs_cita_servicios enable row level security;

comment on table public.dulabs_cita_servicios is
  'AMORE (Fase 3) -- fuente de verdad de los servicios de una cita multi-servicio (hasta 3, mismo profesional, un solo bloque continuo). Una cita de un solo servicio puede o no tener fila acá -- dulabs_citas_especialista.servicio/servicio_id siguen siendo el primer servicio, para compatibilidad histórica total.';

-- precio_total: SOLO se llena para citas multi-servicio reales (suma de los
-- precios de dulabs_cita_servicios). NULL para toda cita existente y para
-- cualquier cita nueva de un solo servicio -- el código que calcula precio
-- sigue usando dulabs_servicios.precio vía servicio_id cuando este campo es
-- NULL (ver lib/contabilidad/consultas.ts).
alter table public.dulabs_citas_especialista
  add column if not exists precio_total integer;

comment on column public.dulabs_citas_especialista.precio_total is
  'AMORE (Fase 3) -- suma real de precios cuando la cita tiene más de un servicio (ver dulabs_cita_servicios). NULL para citas de un solo servicio (históricas o nuevas) -- en ese caso el precio real sigue siendo dulabs_servicios.precio vía servicio_id, sin ningún cambio de comportamiento.';

-- dulabs_agenda_v2_sesiones.servicios_ids (Fase 3, autorizado) — necesidad
-- real detectada durante la implementación del Bloque 4: `servicio_id` de la
-- SESIÓN (no de la cita) es una sola columna uuid, y una sesión debe poder
-- recordar de 1 a 3 servicios elegidos mientras avanza por
-- S2_PROFESIONAL..S5_CONFIRMAR (opciones_mostradas cambia de forma en cada
-- paso, así que no puede usarse para esto). Deliberadamente NULL siempre que
-- la selección sea de un solo servicio -- en ese caso el comportamiento
-- quedó IDÉNTICO al anterior a esta fase (servicio_id sigue siendo la única
-- fuente de verdad de la sesión, sin ningún cambio). Solo se llena cuando de
-- verdad hay 2 o 3 servicios seleccionados.
alter table public.dulabs_agenda_v2_sesiones
  add column if not exists servicios_ids jsonb;

comment on column public.dulabs_agenda_v2_sesiones.servicios_ids is
  'AMORE (Fase 3) -- lista ordenada de servicio_id (uuid como texto) cuando la sesión tiene 2 o 3 servicios seleccionados. NULL para una selección de un solo servicio (comportamiento anterior a Fase 3 sin ningún cambio) -- en ese caso servicio_id de la propia sesión sigue siendo la única fuente de verdad.';
