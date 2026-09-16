# DuLabs Developer V1 — Fase 5 (Outbound WhatsApp) — CLOSURE REPORT

**STATUS: FROZEN / CLOSED**

Producto separado de DuLabs Business (ver decisión de arquitectura de producto; Developer tendrá su propia entrada/Dashboard en `/developer`). Esta fase cierra únicamente el motor técnico outbound; no toca Business/AMORE ni construye el Developer Dashboard.

## Alcance cerrado
Envío outbound real Developer API → Gateway → Job → Pub/Sub → Worker Outbound → Meta Graph API → wamid → `success_confirmed` → usage confirmado, con lease/CAS, sin duplicación física y sin "blind resend" ante incertidumbre.

## Commit validado
`5fc3648` — árbol limpio. Imagen desplegada `worker-outbound:5fc3648`, digest `sha256:d4546951389bfa3aefd8c80286266da619b157a8fd8cfaae6800168c480ba0b6`.

## Correcciones implementadas (D2–D9 + hallazgos)
- **Mapper público→Meta** (`lib/developer/meta-message-mapper.ts`): Meta recibe `messaging_product:"whatsapp"`; `whatsappNumberId` nunca viaja en el body.
- **phone_number_id real** (`whatsapp-numbers-store.ts::obtenerNumeroParaEnvioMeta` + `worker-outbound/handler.ts`): la URL de Meta usa `/{phone_number_id}/messages` con el ID numérico real de Meta, **nunca** el UUID interno de `dulabs_dev_whatsapp_numbers.id`.
- **wamid** (`extraerWamid`): captura `response.messages[0].id`, valida formato, nunca inventa; persistido en columna aditiva `dulabs_dev_jobs.wamid` (migración `20261011000000`).
- **Usage** (D3): reserva se mantiene en `retry_pending`; se libera solo en `failed_by_meta`; se confirma en `success_confirmed`; `reconciliation_pending` no libera.
- **Clasificación de errores Meta** (`meta-error-classifier.ts`): permanente / retryable / incertidumbre, según documentación real de Meta.
- **Backoff** (D6): `next_attempt_at` + índice parcial existente `dulabs_dev_jobs_retry_idx`.
- **Lease/CAS**: `lease_id`, `version_token`, `locked_at`, `physical_outcome` intactos.
- **Seguridad**: token de Meta nunca en logs/reportes/commits; endurecimiento SSRF send-time en el relay inbound (`d12ddbf`).

## Evidencia
- Regresión Developer V1: **212/212** tests (Postgres real).
- **E2E real contra Meta** (aislado, local, worker `5fc3648`): Meta HTTP 200, 1 POST físico, wamid real, `success_confirmed`, `physical_outcome=success_confirmed`, usage `confirmado`, 0 duplicados. Datos temporales `E2E-FASE5` creados y limpiados; producción no modificada durante el E2E.
- **Promoción a producción**: revisión `dulabs-outbound-worker-00005-voc` a 100% de tráfico; smoke tests OK (worker `/salud` 200, Gateway `/salud` 200, auth 401 sin key). Rollback disponible a `00003-fzs` (no eliminada).

## Riesgos residuales conocidos (no bloquean el cierre)
- **Job huérfano en `sending`** (hallazgo D7): si el lease expira con un POST "en vuelo", no hay duplicado físico pero el job puede quedar en `sending` sin barrido automático. Documentado; corrección natural en una revisión futura.
- **Reconciliación de `reconciliation_pending`**: `services/reconciliation/run.ts::consultarEstadoEnMeta` usa un endpoint de status ficticio y el UUID interno; **diferido a Fase 6** por decisión D1, falla cerrado (`sin_certeza`, sin blind resend). La columna `wamid` ya queda lista para la correlación real vía status webhooks de Fase 6.

## Cierre
Fase 5 no se reabre por mejoras no críticas; cualquier mejora entra como nueva tarea/revisión de fase.
