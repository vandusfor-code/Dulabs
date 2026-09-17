# DuLabs Developer V1 — Fase 18: Production Readiness / Release Hardening (cierre)

**Fecha:** 2026-09-17
**Rama:** `feature/developer-v1-fase18-production-readiness` (sobre Fase 17; `main` intacto en `65cb842`)
**Veredicto:** ⚠️ **CONDITIONAL PRODUCTION READINESS** — el código está listo y verificado; el
release depende de verificaciones de infra en consola (enumeradas). **NO PUSH · NO MERGE · NO DEPLOY.**

> Léxico estricto: **VERIFIED** (evidencia real en repo) · **PASS** (prueba reproducible ejecutada)
> · **NOT VERIFIED** (no comprobable desde repo/herramientas) · **BLOCKED** (requiere acción externa
> que no puedo ejecutar) · **ACCEPTED RISK** (conocido, documentado, aceptado). No se convirtió
> ningún "no pude verificarlo" en PASS. No se inventó configuración de Cloud Run/Pub-Sub/Vercel/DNS/IAM.

## 1. Objetivo
Cerrar la brecha entre "código endurecido/probado" (Fases 16–17) y "listo para producción":
verificar y endurecer infraestructura, configuración, despliegue, secretos, permisos,
observabilidad y readiness operacional — sin funcionalidades nuevas.

## 2. Estado inicial (heredado de Fase 17)
SSRF IP pinning, XFF hardening, Next 16.3.5 (0 critical), concurrencia/idempotencia/caos probados;
78 unit/source + 74 e2e verdes. Residuales de infra explícitamente NO verificados (Cloud Run IAM,
Pub/Sub OIDC, Vercel env, dominio) — el foco de esta fase.

## 3. Auditoría (read-only) — resumen
Se auditaron A–U (Cloud Run, Pub/Sub, IAM, Vercel, env, Dockerfiles, Cloud Build, cron, gateway,
workers, reconciliation, Supabase, Meta, Wompi, DNS, observabilidad, health, rate limits, secretos,
staging/prod, deployment). Evidencia clave:
- `cloudbuild.yaml` **solo** construye/pushea imágenes (proyecto `dulabs-developer-v1`, `us-central1`);
  no hay `gcloud run deploy`/IAM/ingress en el repo.
- 4 Dockerfiles `node:22-slim`, corrían como **root**, runtime vía `tsx`.
- `/salud` en gateway + ambos workers; reconciliation es Job.
- `worker-inbound/server.ts` `/push` confía en Cloud Run IAM (sin OIDC en código).
- Observabilidad = `request_id` (240) + `correlation_id` (20) + tablas de estado/auditoría; **solo
  `console.*`** (sin pino/OTel/Sentry) y **sin alertas**.
- `api.dulabs.dev/api/v1` hardcoded en OpenAPI/landing/dashboard.
- `.env.example` **no** tenía sección Developer (faltaban Wompi Developer, encryption key, billing,
  `GATEWAY_TRUSTED_PROXIES`, Pub/Sub, GCP/KMS).

## 4. Hallazgos priorizados
| # | Hallazgo | Sev | Naturaleza |
|---|---|---|---|
| 1 | Cloud Run IAM/ingress/SA + Pub/Sub OIDC push no verificables desde repo | alto | **NOT VERIFIED** (consola) |
| 2 | `.env.example` incompleto para Developer | medio | repo-fixable |
| 3 | Contenedores como root | medio | repo-fixable (build **BLOCKED** aquí) |
| 4 | Dominio `api.dulabs.dev` + separación prod/preview Vercel + migraciones aplicadas | medio | **NOT VERIFIED** (consola) |
| 5 | Sin smoke tests reproducibles | medio | repo-fixable |
| 6 | Sin alertas / retención de logs; deps build-tooling (F17) | bajo | **ACCEPTED RISK** |
| 7 | `/push` sin OIDC en código (confía en IAM) | medio | **ACCEPTED RISK** + recomendación |

## 5. Correcciones aplicadas (repo-verificables)
- **18.4** `.env.example`: sección completa de Developer V1 (nombres/placeholders, nunca valores),
  con scope Vercel/Cloud Run. **VERIFIED** (inspección).
- **18.6** `USER node` en los 4 Dockerfiles (runtime de solo lectura). **VERIFIED en repo**;
  **BLOCKED** a nivel build/smoke (sin Docker aquí) → comandos en el runbook.
- **18.13** `scripts/dev-smoke-test.mjs`: smoke no destructivo (health, auth requerida, key inválida,
  endpoints públicos, sin secretos); exige URLs por entorno. **PASS** (corre y sale 2 sin configurar).
- Runbook `DULABS_DEVELOPER_V1_PHASE_18_PRODUCTION_RUNBOOK.md`: comandos exactos VERIFY/APPLY para
  Cloud Run, Pub/Sub OIDC, IAM mínimo privilegio, Vercel, DNS.

No se aplicaron cambios a Business/AMORE ni a contratos del API. No se corrió deploy/push/merge.

## 6. Tests (18.16) — números exactos, sin regresión
| Suite | Resultado |
|---|---|
| Unit/source F12–F17 | **78/78 PASS** |
| E2E F11/F12/F13/F15/F17 + gateway/worker | **74/74 PASS** (F11 16, F12 10, F13 6, F15 4, chaos 2, worker 11, delivery 7, gateway webhooks/outbound/multi-tenant) |
| npm audit | **7 vulns, 0 critical**, 0 en runtime Developer |
| TypeScript | 0 errores |
| ESLint | 0 errores (33 warnings de estilo, no bloqueantes) |
| Build | PASS (Next 16.3.5) |
Suites NO ejecutadas: E2E contra Meta/Pub-Sub/Wompi **reales** (requieren staging/sandbox) →
**BLOCKED BY EXTERNAL CONFIG**. Los `.e2e` corrieron con `--env-file=.env.local`.

## 7. Infra VERIFICADA (repo)
- Supabase: RLS en 17 tablas `dulabs_dev_*`; 16/16 `SECURITY DEFINER` con `search_path=public`;
  UNIQUE/dedup (idempotency, events, billing_events); RPCs con advisory lock; solo service_role.
- Health `/salud` en gateway + workers.
- Cron Developer en `vercel.json` con `CRON_SECRET` fail-closed (aislado de Business).
- Headers/CSP/HSTS (Next); gateway sin CORS (correcto server-to-server).
- Container: `USER node` en los 4 Dockerfiles.
- Sin secretos en repo/logs; `NEXT_PUBLIC_*` solo con valores públicos.

## 8. Infra NO VERIFICADA (requiere consola — comandos en el runbook)
- Cloud Run: `--no-allow-unauthenticated` en workers, ingress internal, SA por servicio, min/max/
  concurrency/timeout/memoria/cpu.
- Pub/Sub: OIDC push + SA de push acotada + DLQ + retry policy.
- IAM: ausencia de Owner/Editor/*Admin en SAs de runtime.
- Vercel: separación Production/Preview y existencia/scope de cada variable (secretos NO en Preview).
- DNS: `api.dulabs.dev` → gateway con HTTPS/cert válido.
- Migraciones `dulabs_developer_v1_*` realmente aplicadas en la instancia de producción.
- Docker: `docker build` de cada servicio con `USER node` + smoke `/salud`.

## 9. Riesgos aceptados (documentados)
- Solo `console.*` (sin pino/OTel/Sentry) y **sin alertas** → diagnóstico posible vía request/
  correlation IDs + tablas de estado, pero sin detección proactiva. Recomendado para post-F18.
- Sin límite/retención de logs a nivel app (lo maneja Cloud Logging/Vercel).
- 7 vulns de build-tooling / Business (exceljs) — ninguna en runtime Developer.
- `/push` sin verificación OIDC en código (confía en IAM de Cloud Run).

## 10. Bloqueos externos (no ejecutables aquí)
- `docker build`/smoke de imágenes (sin Docker en el entorno).
- E2E contra Meta/Wompi/Pub-Sub reales (requiere staging/sandbox con credenciales).
- Toda verificación de GCP/Vercel/DNS (requiere `gcloud`/`vercel`/`dig` autenticados).

## 11. Release gate (18.17)
| Categoría | Estado | Nota |
|---|---|---|
| SECURITY | **PASS** (código) | authz/tenant/API keys/SSRF pinning/HMAC/replay/headers/open-redirect/XFF verificados por test |
| RELIABILITY | **PASS** | idempotencia/retries/DLQ/leases/out-of-order/recovery probados |
| BILLING | **PASS** (código) | precio server-side, dedup webhook, anti doble-cobro; E2E sandbox **NOT VERIFIED** |
| API | **PASS** | OpenAPI conformidad, errores, rate limits, sin superficie interna documentada |
| WEBHOOKS | **PASS** | firma/timestamp/event-id/idempotencia/retry/DLQ/lease/SSRF pinning/no-redirect |
| DATABASE | **PASS** (repo) | RLS/search_path/constraints; migraciones aplicadas en prod **NOT VERIFIED** |
| INFRA | **NOT VERIFIED** | Cloud Run/Pub-Sub/IAM fuera del repo (runbook) |
| OBSERVABILITY | **ACCEPTED RISK** | IDs + tablas OK; sin alertas |
| OPERATIONS | **PASS** parcial | cron auth + retención OK; alertas **NOT VERIFIED** |
| DEPLOYMENT | **NOT VERIFIED** | `gcloud run deploy`/dominio/prod-preview fuera del repo |
| DEPENDENCIES | **PASS** | 0 critical; runtime Developer sin vulnerabilidades explotables |

## 12. Recomendación final de readiness
**CONDITIONAL PRODUCTION READINESS.** El código de DuLabs Developer V1 está endurecido, probado y
sin regresiones (78 unit/source + 74 e2e, 0 critical). **No** es READY FOR PRODUCTION incondicional
porque hay elementos de infraestructura que **solo pueden verificarse en consola** y que son
condición de release:

**Bloqueadores de release (ejecutar el runbook y marcar el checklist):**
1. Cloud Run workers `--no-allow-unauthenticated` + ingress internal + SA por servicio.
2. Pub/Sub push con OIDC + SA acotada + DLQ + retry.
3. IAM sin roles amplios en SAs de runtime.
4. Vercel: variables Developer presentes; secretos (Wompi Developer, service role, CRON/DIAGNOSTICS)
   **no** en Preview; `GATEWAY_TRUSTED_PROXIES` fijado según topología.
5. DNS `api.dulabs.dev` → gateway, HTTPS válido, `/salud` 200.
6. Migraciones `dulabs_developer_v1_*` aplicadas en producción.
7. `docker build` de los 4 servicios con `USER node` + smoke `/salud`.
8. `node scripts/dev-smoke-test.mjs` contra staging → SMOKE OK.

Al completar 1–8 con evidencia, el veredicto pasa a **READY FOR PRODUCTION**.

## 13. Git
Rama `feature/developer-v1-fase18-production-readiness` (sobre `642675f`, Fase 17). Commits:
```
Fase 18.6 container hardening (USER node) · 18.4/18.13 env + smoke + runbook · 18.18 closure
```
Working tree limpio salvo `supabase/.temp/` (untracked). **NO PUSH · NO MERGE · NO DEPLOY. `main` intacto.**
