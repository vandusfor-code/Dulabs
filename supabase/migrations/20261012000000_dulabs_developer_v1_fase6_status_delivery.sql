-- DuLabs Developer V1 -- Fase 6 (Inbound WhatsApp + Status webhooks,
-- autorizado). Migración PURAMENTE ADITIVA. No modifica el significado de
-- ninguna columna existente, no toca la máquina de estados congelada de
-- Fase 1 (status/physical_outcome), no elimina valores de ningún enum.
--
-- Cubre: (1) delivery_status como dimensión ORTOGONAL al Job lifecycle,
-- (2) índice de correlación por wamid (la columna la creó Fase 5),
-- (3) extensión aditiva del CHECK de dulabs_dev_events.tipo con
-- delivered/read, (4) estado de reintentos/DLQ de la entrega al webhook
-- del Developer.

-- ============================================================
-- 1. DELIVERY STATUS (ortogonal al Job lifecycle congelado)
-- ============================================================
-- delivery_status NO es parte de la máquina de estados (status sigue
-- siendo created/queued/sending/success_confirmed/failed_by_meta/
-- retry_pending/reconciliation_pending, sin cambios). Es el estado REAL de
-- entrega que Meta reporta vía status webhooks (sent/delivered/read/failed),
-- correlacionado por wamid. delivery_status_rank hace cumplir la
-- monotonicidad (sent=1 < delivered=2 < read=3; failed=4 terminal) sin que
-- un status atrasado pueda retroceder el valor.
alter table public.dulabs_dev_jobs
  add column if not exists delivery_status text
    check (delivery_status is null or delivery_status in ('sent', 'delivered', 'read', 'failed')),
  add column if not exists delivery_status_at timestamptz,
  add column if not exists delivery_status_rank int not null default 0;

comment on column public.dulabs_dev_jobs.delivery_status is
  'DuLabs Developer V1 (Fase 6). Estado REAL de entrega reportado por Meta vía status webhooks (sent/delivered/read/failed), correlacionado por wamid. Dimensión ORTOGONAL a status/physical_outcome (la máquina de estados de Fase 1 NO se modifica). NULL = todavía no llegó ningún status de Meta.';
comment on column public.dulabs_dev_jobs.delivery_status_rank is
  'DuLabs Developer V1 (Fase 6). Rango monotónico del delivery_status (sent=1, delivered=2, read=3, failed=4). Un status atrasado nunca retrocede el valor: solo se actualiza si el nuevo rank es mayor (o failed, terminal). 0 = sin status aún.';

-- ============================================================
-- 2. ÍNDICE DE CORRELACIÓN POR WAMID
-- ============================================================
-- La columna wamid la agregó Fase 5 (20261011000000). Fase 6 la indexa
-- para correlacionar status webbooks -> Job en O(log n). Parcial: solo los
-- jobs que realmente tienen wamid (los que llegaron a un 2xx real de Meta).
create index if not exists dulabs_dev_jobs_wamid_idx
  on public.dulabs_dev_jobs (wamid) where wamid is not null;

-- ============================================================
-- 3. EXTENSIÓN ADITIVA DEL CHECK DE tipo DE EVENTOS
-- ============================================================
-- Fase 2 definió tipo IN (received, queued, sending, sent, failed) como
-- CHECK inline (nombre autogenerado dulabs_dev_events_tipo_check). Se
-- extiende ADITIVAMENTE con delivered/read para poder registrar el ciclo de
-- vida completo de status de Meta. No se elimina ni reinterpreta ningún
-- valor existente -> backward-compatible con todas las filas actuales.
alter table public.dulabs_dev_events drop constraint if exists dulabs_dev_events_tipo_check;
alter table public.dulabs_dev_events
  add constraint dulabs_dev_events_tipo_check
  check (tipo in ('received', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed'));

-- ============================================================
-- 4. RETRY / DLQ DE LA ENTREGA AL WEBHOOK DEL DEVELOPER
-- ============================================================
-- Fase 3 dejó la entrega al webhook del Developer como at-most-once
-- (procesado_en). Fase 6 (decisión D2) la convierte en entrega ACOTADA con
-- reintentos + DLQ, reusando el patrón next_attempt_at/backoff/CAS ya usado
-- en el outbound. Aditivo sobre dulabs_dev_events; procesado_en se mantiene
-- (se sigue seteando cuando entrega_estado='entregado', para no romper el
-- contrato de observabilidad existente).
alter table public.dulabs_dev_events
  add column if not exists entrega_estado text not null default 'pendiente'
    check (entrega_estado in ('pendiente', 'entregando', 'entregado', 'fallido', 'dlq', 'sin_webhook')),
  add column if not exists entrega_intentos int not null default 0,
  add column if not exists entrega_next_attempt_at timestamptz,
  add column if not exists entrega_ultimo_error text;

alter table public.dulabs_dev_events
  add constraint dulabs_dev_events_entrega_intentos_check check (entrega_intentos >= 0);

comment on column public.dulabs_dev_events.entrega_estado is
  'DuLabs Developer V1 (Fase 6, D2). Estado de la entrega al webhook del Developer: pendiente -> entregando (claim CAS) -> entregado | fallido (reintentable, con next_attempt_at) | dlq (agotó intentos o error terminal) | sin_webhook. Idempotencia de entrega: una vez entregado/dlq, una reentrega de Pub/Sub es no-op.';
comment on column public.dulabs_dev_events.entrega_ultimo_error is
  'DuLabs Developer V1 (Fase 6). Último motivo de fallo de entrega, SANITIZADO (ej. "http_502", "timeout", "ssrf_bloqueado"). NUNCA contiene secretos, tokens ni el cuerpo de la respuesta del Developer.';

-- Barrido de reintentos de entrega (dulabs-reconciliation): eventos listos
-- para (re)entregar -- entrega_estado reintentable y next_attempt_at ya
-- alcanzado (o nulo = listo de inmediato). Incluye 'entregando' vencido
-- para recuperar un worker que murió a mitad de un intento.
create index if not exists dulabs_dev_events_entrega_pendiente_idx
  on public.dulabs_dev_events (entrega_next_attempt_at)
  where entrega_estado in ('pendiente', 'fallido', 'entregando');
