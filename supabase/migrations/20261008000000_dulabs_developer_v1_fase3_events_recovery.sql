-- DuLabs Developer V1 -- Fase 3 (Infraestructura, autorizado, paso 0 del
-- orden de despliegue, ver docs/DULABS_DEVELOPER_V1_PHASE_3_INFRASTRUCTURE_DESIGN.md
-- sección A "Diseño del mecanismo de recuperación inbound").
--
-- Migración puramente ADITIVA sobre dulabs_dev_events (Fase 2, ya en
-- producción, 56+104 tests ya en verde) -- no se toca ninguna columna
-- existente, no se reinterpreta el contrato ya probado. Agrega el campo de
-- estado que permite distinguir "evento persistido pero todavía no
-- confirmado como publicado a Pub/Sub" de "publicación confirmada", y el
-- contador de intentos que evita que el barrido de recuperación
-- (dulabs-reconciliation, Fase 3) reintente indefinidamente una fila
-- atascada.

alter table public.dulabs_dev_events
  add column if not exists published_at timestamptz null,
  add column if not exists intentos_publicacion int not null default 0;

alter table public.dulabs_dev_events
  add constraint dulabs_dev_events_intentos_publicacion_check check (intentos_publicacion >= 0);

-- Consulta crítica del barrido de recuperación: "dame los eventos
-- pendientes de publicar, con más de N minutos de antigüedad" -- índice
-- parcial, mismo patrón ya usado en dulabs_dev_jobs_reconciliation_idx
-- (Fase 2).
create index if not exists dulabs_dev_events_pendiente_publicacion_idx
  on public.dulabs_dev_events (created_at)
  where published_at is null;

comment on column public.dulabs_dev_events.published_at is
  'NULL = todavía no hay confirmación de publicación exitosa a Pub/Sub (dulabs-inbound). No nulo = publicación confirmada, fila cerrada. Ver mecanismo de recuperación en el documento de Fase 3.';
comment on column public.dulabs_dev_events.intentos_publicacion is
  'Contador de intentos de publicación a Pub/Sub (el intento síncrono del Gateway cuenta como el primero). Tope operativo de 5 intentos antes de dejar de reintentar automáticamente -- ver documento de Fase 3.';

-- Incremento ATÓMICO de intentos_publicacion -- un único UPDATE evaluado
-- del lado de Postgres (nunca read -> incrementar en JS -> write, que
-- tendría una ventana de carrera real entre dos ejecuciones concurrentes
-- del barrido de recuperación). PostgREST/supabase-js no expresan
-- `columna = columna + 1` en un .update() normal -- de ahí la función.
create or replace function public.dulabs_dev_events_incrementar_intento(p_id bigint)
returns int
language sql
as $$
  update public.dulabs_dev_events
  set intentos_publicacion = intentos_publicacion + 1
  where id = p_id
  returning intentos_publicacion;
$$;

comment on function public.dulabs_dev_events_incrementar_intento(bigint) is
  'DuLabs Developer V1 (Fase 3). Incremento atómico de intentos_publicacion para el barrido de recuperación inbound -- ver lib/developer/events-store.ts::incrementarIntentoPublicacion.';
