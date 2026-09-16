-- DuLabs Developer V1 -- Fase 1 (Arquitectura y Contratos Técnicos,
-- autorizado). Migración puramente aditiva, aislada del esquema de DuLabs
-- Business (ninguna tabla existente se modifica).
--
-- Alcance de esta migración: SOLO lo necesario para probar de verdad el
-- contrato de idempotencia (sección 9/13 del brief de Fase 1) contra
-- Postgres real. Las tablas de jobs/API keys/webhooks completas (sección 23
-- del brief) quedan para cuando exista el Gateway real que las use --
-- crearlas ahora sin nada que las escriba violaría la regla de "cada tabla
-- debe tener una responsabilidad clara, no crear tablas para tenerlas".

create table if not exists public.dulabs_dev_idempotency_keys (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  idempotency_key text not null,
  payload_hash text not null,
  job_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- La clave real de deduplicación es (workspace_id, idempotency_key) -- ver
-- sección 2.4 del documento de arquitectura. Este constraint es lo que
-- convierte "dos requests concurrentes, misma clave" en una carrera que
-- Postgres resuelve de forma atómica: solo uno de los dos INSERT gana, el
-- otro recibe una violación de unicidad y el llamador reacciona a eso
-- consultando la fila ganadora, en vez de confiar en una lectura previa
-- ("if (!existe) insertar" tiene una ventana de carrera real).
create unique index if not exists dulabs_dev_idempotency_keys_workspace_key_idx
  on public.dulabs_dev_idempotency_keys (workspace_id, idempotency_key);

alter table public.dulabs_dev_idempotency_keys enable row level security;

comment on table public.dulabs_dev_idempotency_keys is
  'DuLabs Developer V1 (Fase 1). Deduplicación real de POST /api/v1/messages por (workspace_id, idempotency_key). payload_hash detecta el caso "misma clave, payload distinto" (409, nunca se procesa en silencio). Ventana de retención lógica: 24h, aplicada por limpieza periódica, no por el diseño de la tabla.';
