# DuLabs Developer V1 — Fase 19: Beta / Incident Runbook

Guía operativa de la beta controlada. Cada incidente: **detectar → contener → verificar →
recuperar → auditar → comunicar**. Herramientas base: logs de Cloud Run/Vercel, tablas de estado
(`dulabs_dev_events`, `dulabs_dev_jobs`, `dulabs_dev_billing_events`, `dulabs_dev_account_audit`),
`request_id`/`correlation_id`, y el **kill switch** `DEVELOPER_API_ENABLED` (Fase 19.5).

> Contención global inmediata: `DEVELOPER_API_ENABLED=false` (+ reinicio del gateway) rechaza todo
> `/api/v1` con 503 sin deploy. Úsalo ante abuso/incidente grave mientras se diagnostica.

## A. Gateway caído
- **Detectar:** `/salud` no responde; errores 5xx; alertas de Cloud Run.
- **Contener:** revisar min-instances/escalado; si es abuso, kill switch.
- **Verificar:** logs del servicio `gateway` por `request_id`.
- **Recuperar:** redeploy de la última imagen buena; `gcloud run services describe gateway`.
- **Auditar/Comunicar:** ventana de indisponibilidad; avisar a beta testers.

## B. Worker caído (inbound/outbound)
- **Detectar:** eventos sin `entrega_estado` avanzando; `dulabs_dev_events` con `pendiente` viejos.
- **Contener:** Pub/Sub retiene y reintenta; no se pierden mensajes (ack solo tras procesar).
- **Verificar:** logs del worker; backlog de la subscription.
- **Recuperar:** redeploy del worker; el backlog se drena solo (idempotencia + lease).
- **Auditar:** contar eventos represados; confirmar cero doble efecto (dedup/lease).

## C. Pub/Sub backlog
- **Detectar:** `num_undelivered_messages` alto en la subscription.
- **Contener:** escalar workers (max-instances); si es tormenta, kill switch de outbound.
- **Recuperar:** el backlog se procesa; verificar que no crece la DLQ.

## D. DLQ creciendo
- **Detectar:** `dulabs_dev_events` con `entrega_estado='dlq'` en aumento.
- **Contener:** identificar causa (webhook del developer caído, URL insegura, 4xx).
- **Verificar:** `entrega_ultimo_error` (sanitizado) por evento.
- **Recuperar:** corregida la causa, **replay** desde `/developer/events` (usa el mismo pipeline/
  lease/idempotencia — no crea camino paralelo). Replay rate-limited (costosa 10/min).
- **Auditar:** `dulabs_dev_account_audit` registra cada `EVENT_REPLAY`.

## E. Webhooks fallando (endpoint del developer)
- **Detectar:** entregas en `fallido`/`dlq`; el developer reporta no recibir.
- **Verificar:** `/developer/webhooks` ping; confirmar firma HMAC + `redirect:manual` + SSRF pin.
- **Recuperar:** el developer arregla su endpoint; replay de los DLQ.

## F. Developer reporta evento duplicado
- **Verificar:** dedup por `event_id` (unique) + `X-DuLabs-Event-ID` para dedup at-least-once del lado del developer.
- **Recomendación:** el developer debe deduplicar por `X-DuLabs-Event-ID` (documentado en /developers/webhooks).

## G. Developer reporta evento perdido
- **Verificar:** buscar el `event_id` en `dulabs_dev_events`; ver `entrega_estado`, intentos, error.
- **Recuperar:** si está en DLQ/fallido → replay. Si nunca entró → revisar Meta webhook + firma.

## H. API key comprometida
- **Contener:** el developer revoca/rota desde `/developer/api-keys` (efecto inmediato en auth).
- **Verificar:** `last_used_at` de la key; actividad anómala en `dulabs_dev_jobs`.
- **Auditar:** confirmar que la key revocada ya no autentica (F16: revocación efectiva).

## I. Wompi / billing failure
- **Detectar:** `dulabs_dev_billing_events` con `status='failed'`; suscripción en `past_due`.
- **Verificar:** firma del webhook Wompi (dedup por checksum, orden por pago más reciente).
- **Recuperar:** reprocesar el evento persistido; el cron de dunning maneja renovaciones fallidas.
- **Regla:** activación SOLO tras pago confirmado (transición a APPROVED). Nunca doble cobro (dedup).

## J. Tenant isolation incident
- **Contener:** kill switch si hay sospecha de fuga cross-tenant.
- **Verificar:** toda query filtra por `workspace_id`/`account_id` + RLS; revisar logs por `request_id`.
- **Auditar:** confirmar que no hubo acceso cruzado; es P0 → post-mortem.

## K. Rate limit abuse
- **Detectar:** 429 elevados; `devAuthFallida`/`devOutbound` saturados.
- **Contener:** los límites por workspace/número ya aplican; kill switch si escala.
- **Verificar:** XFF anti-spoof (F17.2) — la IP no es falsificable trivialmente.

## L. Meta webhook failure
- **Detectar:** no entran eventos; firma X-Hub-Signature-256 inválida en logs.
- **Verificar:** `META_APP_SECRET` correcto; el gateway verifica la firma sobre el body crudo.
- **Recuperar:** corregir credencial/config de Meta; los eventos reintenta Meta.

## Kill switch — procedimiento
1. `DEVELOPER_API_ENABLED=false` en el entorno del gateway → reiniciar.
2. Confirmar 503 en `/api/v1/me`.
3. Diagnosticar/contener.
4. `DEVELOPER_API_ENABLED=true` → reiniciar → confirmar 200/401 normales.
