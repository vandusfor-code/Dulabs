# DuLabs Developer V1 — Fase 13 (Webhooks + Eventos + Logs) — CLOSURE REPORT

**STATUS: IMPLEMENTADA Y VERIFICADA (código + tests + build).** Sin push/merge/deploy. Rama `feature/developer-v1-fase13-events` (apilada sobre `feature/developer-v1-fase12-billing`). `main` intacto (`65cb842`).

Fase 13 **no reconstruye** el pipeline de eventos/webhooks (ya existe, Fases 2–6). **Expone, observa y opera** ese sistema hacia el Developer, con aislamiento por workspace y proyección segura, sin duplicar idempotencia/firmas/DLQ/backoff/out-of-order y sin exponer datos sensibles ni eventos de Wompi (internos).

## Alcance implementado
- **13.1 Events & Logs API + UI:** `GET /api/developer/events` (paginado por cursor, filtros por tipo/estado de entrega/rango/job/correlation_id, tenant scope server-side, **proyección segura + payload redactado**) + página `/developer/events`.
- **13.2 Observabilidad de entrega:** expone `entrega_estado`, `entrega_intentos`, `entrega_next_attempt_at`, `entrega_ultimo_error`, `entregadoEn`, `replayable` (columnas ya existentes; solo lectura, sin tocar el worker).
- **13.5 Retención/pruning:** `podarEventosAntiguos` (borra SOLO `entregado`/`sin_webhook` > 90 días; **nunca** pendiente/entregando/fallido/dlq) + `limpiarIdempotencyKeysVencidas` (24h) + cron `POST /api/developer/maintenance/retencion` (CRON_SECRET).
- **13.4 Test/ping de webhook:** `POST /api/developer/webhooks/ping` (OWNER/ADMIN, SSRF obligatorio, firma HMAC con el secreto del webhook, timeout 5s, `redirect:manual`, evento `webhook.ping` — no se confunde con Meta ni se persiste) + botón "Probar" por webhook en la UI.
- **13.3 Re-entrega / DLQ replay:** `POST /api/developer/events/[id]/replay` (OWNER/ADMIN, rate-limited `costosa`, tenant-scoped, auditado). **Re-encola** (estado→`pendiente`, intentos=0, next_attempt_at=ahora) para que el loop de reintento EXISTENTE (services/reconciliation → worker-inbound) la re-entregue. **No** crea otra cola ni modifica el worker. Solo desde dlq/fallido.
- **13.6 Métricas:** `GET /api/developer/events/metrics` (total, por estado de entrega, tasa de entrega) + tarjetas en la UI.
- **13.7 Seguridad + regresión + closure** (abajo).

## Archivos modificados
- `lib/developer/events-store.ts` — proyección segura + redacción, `listarEventosDelWorkspace`, `obtenerEventoDelWorkspace`, `reencolarEntregaParaReplay`, `metricasDeEntrega`, `podarEventosAntiguos`.
- `lib/developer/idempotency.ts` — `limpiarIdempotencyKeysVencidas`.
- `app/api/developer/events/route.ts`, `.../events/metrics/route.ts`, `.../events/[id]/replay/route.ts`, `.../webhooks/ping/route.ts`, `.../maintenance/retencion/route.ts` (nuevos).
- `lib/dev-dashboard/dev-client.ts` — `events.{list,metrics,replay}`, `webhooks.ping` + tipos.
- `app/developer/events/page.tsx` (nueva UI), `app/developer/webhooks/page.tsx` (botón ping), `components/developer/nav.ts` (item Events).
- `vercel.json` — cron de retención (aditivo).
- Tests: `lib/developer/events-fase13.test.ts`, `app/api/developer/events/fase13-events.e2e.test.ts` + `scripts/test-flow-manifest.txt`.

## Migraciones
**Ninguna.** Fase 13 solo lee/poda tablas ya existentes (`dulabs_dev_events`, `dulabs_dev_idempotency_keys`) y usa índices ya presentes (`dulabs_dev_events_workspace_idx`, etc.). Cero cambios de esquema.

## Endpoints
`GET /events`, `GET /events/metrics`, `POST /events/[id]/replay`, `POST /webhooks/ping`, `POST /maintenance/retencion` (cron). Todos bajo `/api/developer/*`, tenant scope server-side.

## UI
`/developer/events` (métricas + filtros + tabla con tipo/fecha/estado de entrega/intentos/último error + "Ver" detalle con payload redactado + "Reintentar" para dlq/fallido) · botón "Probar" en `/developer/webhooks` · item "Events" en el nav.

## Seguridad
- Tenant scope: `workspace_id` SIEMPRE de la sesión (`ctx.workspaceId`), nunca del cliente; `reencolarEntregaParaReplay` y `obtenerEventoDelWorkspace` filtran por `workspace_id` en el WHERE (aislamiento a nivel de dato). Cross-tenant probado → 404.
- Proyección segura: nunca expone `request_id`/`published_at`/`intentos_publicacion`; payload redactado (claves token/secret/authorization/api_key/password/... → `[redactado]`).
- Replay: OWNER/ADMIN, rate-limit `costosa`, solo dlq/fallido, auditado (`EVENT_REPLAY`); un 2º replay del mismo evento devuelve no_replayable (anti-abuso natural) — sin doble entrega (reusa lease/idempotencia del worker; el Developer dedup por `X-DuLabs-Event-ID`).
- Ping: OWNER/ADMIN, SSRF obligatorio (send-time), firma HMAC, timeout, `redirect:manual`, secreto nunca expuesto.
- Wompi: `dulabs_dev_billing_events` NO se exponen (internos).

## Replay / DLQ
Re-encolado que reusa la máquina de estados existente; el worker corta en estados terminales y su ruta de reintento usa `reclamarEntrega` (por `entrega_estado`, no por `procesado_en`), así que el evento re-encolado (pendiente, intentos 0) fluye por el pipeline existente. **Dependencia operativa (no bloqueo):** requiere que el loop de reintento (services/reconciliation, Cloud Run) esté agendado — el mismo que ya usan todos los reintentos.

## Pruning
Criterio conservador probado por E2E: borra `entregado`/`sin_webhook` antiguos; **conserva siempre** pendiente/entregando/fallido/dlq y los recientes. Idempotency keys > 24h limpiadas.

## Métricas
Conteos por estado de entrega + tasa de entrega, por rango, sin traer filas (head counts). Tenant scope.

## Tests (resultados verificados)
- Unit Fase 13 (redacción/proyección): **4/4 PASS**
- E2E Fase 13 (tenant isolation, listing redactado, replay re-encolado, cross-tenant 404, MEMBER 403, pruning seguro, idempotency 24h): **6/6 PASS**
- TypeScript: **PASS** · ESLint: **PASS** · Build: **PASS**

## Regresiones
- Fase 11 con billing OFF: **16/16 PASS**
- Fase 12: unit **9/9**, billing ON **10/10 PASS**
- Sin cambios a Business/AMORE/Fases 1–10 (el diff solo toca `app/developer/*`, `app/api/developer/*`, `lib/developer/*`, `lib/dev-dashboard/*`, `components/developer/*`, `vercel.json`, docs, manifest).

## Riesgos restantes
- 🟡 El replay depende de que el loop de reintento de Cloud Run esté agendado (dependencia operativa preexistente de todos los reintentos, no introducida por Fase 13).
- 🟢 Pruning: criterio conservador probado; no borra eventos no resueltos.
- 🟢 Sin exposición de secretos/PII (redacción); sin impacto en billing/Business.

## Estado de Git
Rama `feature/developer-v1-fase13-events` (sobre `feature/developer-v1-fase12-billing`). Commits locales por bloque. **Sin push/merge/deploy.** `main` intacto `65cb842`. Working tree limpio salvo `supabase/.temp/`.

## Pendiente para promoción
- Merge (stacked): primero Fase 12 (`feature/developer-v1-fase12-billing → main`), luego Fase 13. Requiere tu autorización.
- (Operativo) Asegurar que el loop de reintento de entregas (services/reconciliation) esté agendado en el entorno de ejecución.
