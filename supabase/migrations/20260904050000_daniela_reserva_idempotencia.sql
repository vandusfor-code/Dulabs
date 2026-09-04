-- Fase 4 del sistema de reservas de Daniela (autorizado) — idempotencia real
-- para la reserva pública. Aditiva: tabla nueva, no toca nada existente.
--
-- Patrón: mismo criterio ya usado por dulabs_flow_events (Fase de Flow
-- Store, 20260828100000_dulabs_flow_store.sql) -- "claim" con un INSERT que
-- falla si la clave (id_tenant, idempotency_key) ya existe (23505), luego se
-- completa esa MISMA fila con el resultado real. No es un lock de
-- aplicación: la garantía la da la PK compuesta de Postgres.
--
-- request_hash guarda un hash de los parámetros de negocio de la solicitud
-- (especialista, servicio, inicio, teléfono, nombre) -- si la MISMA clave
-- llega de nuevo con parámetros DISTINTOS, se detecta y se rechaza (nunca se
-- reutiliza ciegamente el resultado guardado).
--
-- resultado_json es NULL mientras la operación original todavía está en
-- vuelo (entre el INSERT-claim y el UPDATE final) -- una clave repetida que
-- encuentra resultado_json NULL significa "la primera solicitud todavía se
-- está procesando", no un error.

create table public.dulabs_idempotencia_reservas (
  id_tenant uuid not null,
  idempotency_key text not null,
  request_hash text not null,
  resultado_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id_tenant, idempotency_key)
);

create index dulabs_idempotencia_reservas_created_idx
  on public.dulabs_idempotencia_reservas (created_at);

comment on table public.dulabs_idempotencia_reservas is
  'Fase 4 -- idempotencia de reservarCitaPorServicio para el portal público. Filas viejas se pueden purgar periódicamente en el futuro (no implementado todavía, bajo volumen esperado en V1); no bloquea ninguna operación existente.';

alter table public.dulabs_idempotencia_reservas enable row level security;
