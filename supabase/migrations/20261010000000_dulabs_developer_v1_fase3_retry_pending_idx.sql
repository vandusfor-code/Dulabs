-- DuLabs Developer V1 -- Fase 3, cierre (riesgo #3 del reporte de Fase 3).
-- Índice parcial para el barrido de reintento de jobs en retry_pending que
-- hace dulabs-reconciliation -- mismo patrón que
-- dulabs_dev_jobs_reconciliation_idx (status = 'reconciliation_pending').
-- Sin este barrido, un job en retry_pending (ya sea por un rechazo cierto
-- de Meta con intentos disponibles, o por una reconciliación que confirmó
-- "no enviado") quedaba atascado para siempre -- nada lo republicaba a
-- dulabs-outbound.

create index if not exists dulabs_dev_jobs_retry_pending_idx
  on public.dulabs_dev_jobs (status)
  where status = 'retry_pending';
