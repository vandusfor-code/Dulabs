# DuLabs Developer V1 — Fase 19: Beta Acceptance Tests

Checklist reproducible para aceptar la beta. **Status hoy:** los ítems de código/datos están
**PASS** (verificados por e2e/unit reproducibles); los que exigen un despliegue en vivo están
**BLOCKED** hasta que Developer V1 se despliegue (ver Production Gate: hoy no está desplegado).
Cada ítem: precondition · action · expected · status · evidence.

| ID | Precondition | Action | Expected | Status | Evidence |
|---|---|---|---|---|---|
| BETA-001 signup | usuario nuevo | signup en /login | cuenta creada + email | **BLOCKED (deploy)** | flujo Supabase Auth existente |
| BETA-002 login | cuenta creada | login → next=/developer | entra al dashboard | **BLOCKED (deploy)** | `/login?next=` (F18) |
| BETA-003 API key | sesión OWNER/ADMIN | POST /developer/api-keys | key `dl_live_…` UNA vez | **PASS (code)** | api-keys route + store |
| BETA-004 valid request | key válida | POST /api/v1/messages | 201 {jobId,created} | **PASS (e2e)** | outbound-handler.e2e |
| BETA-005 invalid auth | key inválida/sin key | GET /api/v1/me | 401 invalid/missing_api_key | **PASS (e2e)** | api-auth + identidad-acceso.e2e |
| BETA-006 idempotency | misma Idempotency-Key | 2× POST /messages | 1 solo job (dup/conflict) | **PASS (e2e)** | idempotency.e2e (concurrente) |
| BETA-007 webhook config | número conectado | configurar webhook | webhook activo | **PASS (code)** | webhook-config-store |
| BETA-008 webhook ping | webhook activo | POST /developer/webhooks/ping | firmado + status/latencia | **PASS (code)** | ping route (SSRF pin F17) |
| BETA-009 signed webhook | evento entregado | verificar HMAC | firma `ts.body` válida | **PASS (unit)** | webhook-signature + fase16 |
| BETA-010 event log | evento procesado | GET /developer/events | evento visible + estado | **PASS (e2e)** | fase13-events.e2e |
| BETA-011 delivery status | mensaje enviado | GET /messages/{id} | queued→sent/failed | **PASS (e2e)** | delivery-status.e2e |
| BETA-012 retry | webhook 5xx | reintento con backoff | fallido→reintento | **PASS (e2e)** | worker-inbound.e2e |
| BETA-013 DLQ | 4xx/URL insegura | entrega terminal | → DLQ | **PASS (e2e)** | worker-inbound.e2e |
| BETA-014 usage | mensajes consumidos | GET /developer/usage | uso mensual correcto | **PASS (e2e)** | usage-mensual.e2e |
| BETA-015 rate limit | exceso de requests | POST rápido | 429 + Retry-After | **PASS (e2e)** | read-rate-limit.e2e |
| BETA-016 billing | billing ON + pago | checkout/webhook Wompi | activación tras pago | **PASS (e2e)** | fase12-billing.e2e (10/10) · E2E Wompi real **BLOCKED** |
| BETA-017 tenant isolation | 2 workspaces | A intenta leer B | denegado | **PASS (e2e)** | multi-tenant-security.e2e |
| BETA-018 security | ataques adversariales | ver 19.9 | sin fugas/escalada | **PASS (tests)** | fase16/17/19 security tests |
| BETA-019 recovery | worker/evento fallido | replay desde DLQ | re-entrega idempotente | **PASS (e2e)** | events replay + chaos e2e |
| BETA-020 smoke production | Developer desplegado | `dev-smoke-test.mjs` | SMOKE OK | **BLOCKED (deploy)** | script listo (F18) |

**Resumen:** 15/20 **PASS (code/e2e reproducible)** · 5/20 **BLOCKED (requieren despliegue en vivo)**:
BETA-001, BETA-002, BETA-016 (Wompi real), BETA-020, y la validación viva de BETA-004..015 contra
producción (el código está probado, falta el entorno desplegado).

**Cómo ejecutar los PASS localmente:** `npm run test:flow` (unit/source) + los `.e2e` con
`--env-file=.env.local`. **Los BLOCKED** se ejecutan tras completar los 8 gates del runbook F18.
