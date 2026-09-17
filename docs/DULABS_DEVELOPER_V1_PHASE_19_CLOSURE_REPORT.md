# DuLabs Developer V1 — Fase 19: Controlled Beta / Production Validation (cierre)

**Fecha:** 2026-09-17 · **Rama:** `feature/developer-v1-fase19-controlled-beta` (sobre Fase 18; `main` intacto en `65cb842`)
**Veredicto:** ⚠️ **BETA NO LANZABLE HOY — por ausencia de despliegue, no por defectos de código.**
El código y la base de datos están listos y verificados; **Developer V1 no está desplegado en
producción** (evidencia real abajo). **NO PUSH · NO MERGE · NO DEPLOY.**

> Léxico: VERIFIED (evidencia en repo) · PASS (prueba reproducible ejecutada) · NOT VERIFIED
> (no comprobable con lo disponible) · BLOCKED (requiere acción externa) · FAILED · ACCEPTED RISK.
> No se convirtió ningún "no pude verificar" en PASS; no se inventó infraestructura ni resultados.

## 1. Alcance
Convertir el sistema construido (F1–F18) en una beta controlada: validar los 8 gates de F18 con
evidencia real donde fuese posible, endurecer con controles de beta donde hubiese gaps reales,
onboarding del primer developer reutilizando lo existente, observabilidad, runbook de incidentes,
acceptance tests, revisión adversarial y criterios de salida. Sin features nuevas arbitrarias.

## 2. Estado inicial (heredado de F18)
78/78 unit/source + 74/74 e2e, 0 critical, build PASS. F18 dejó 8 gates de infra NOT VERIFIED y
CONDITIONAL PRODUCTION READINESS.

## 3. Cambios realizados
- **19.5 Beta safety controls (gaps reales):** kill switch `DEVELOPER_API_ENABLED`
  (`lib/developer/beta-flags.ts`) → 503 en todo `/api/v1` sin deploy; tope de API keys por
  workspace (`MAX_API_KEYS_ACTIVAS=20`) contra creación masiva. Nuevo código de error
  `service_unavailable` (aditivo; conformidad F14 verde). Tests: 6 unit + 3 e2e.
- **19.11 Product quality:** guard de enlaces muertos del dashboard (12/12 secciones alcanzables).
- **Docs:** Production Gate (19.1), Beta Runbook (19.7), Beta Acceptance (19.8), este closure (19.12).
- `.env.example`: `DEVELOPER_API_ENABLED` documentado.
- **No** se tocó Business/AMORE; no se cambiaron contratos salvo la adición aditiva de un código de error.

## 4. Production gate (evidencia real)
Ver `PHASE_19_PRODUCTION_GATE.md`. Resumen:
- **Gate 6 (Supabase): VERIFIED** — 13/13 tablas `dulabs_dev_*` + seed ($19/$45/$199) en la instancia
  de `.env.local`. (Que esa instancia == prod: NOT VERIFIED, confirmar en consola.)
- **Gate 5 (DNS `api.dulabs.dev`): FAILED (no desplegado)** — dominio no responde.
- **Gates 1–4, 7, 8: BLOCKED** — no existe despliegue Developer V1 en producción
  (`/developer-platform` y `/api/developers/plans` dan **404** en `dulabs.co`; el browser sí alcanza
  `dulabs.co`, así que es ausencia de deploy, no de red).

## 5. Infraestructura VERIFICADA
- Base de datos Developer provista y migrada (13 tablas + seed) en la instancia configurada.
- Código: kill switch + tope de keys + todo lo de F16/F17 (SSRF pinning, XFF, HMAC, idempotencia,
  leases, RLS, search_path) probado por tests reproducibles.

## 6. Infraestructura NO VERIFICABLE (requiere consola/deploy)
Cloud Run (IAM/ingress/SA/recursos), Pub/Sub (OIDC/DLQ/retry), IAM mínimo privilegio, Vercel
(env/preview), DNS/HTTPS del gateway, Docker build con `USER node`, y el smoke real. Todo con
comandos exactos en `PHASE_18_PRODUCTION_RUNBOOK.md` + `PHASE_19_PRODUCTION_GATE.md`.

## 7. Beta acceptance
Ver `PHASE_19_BETA_ACCEPTANCE.md`: **15/20 PASS** (code/e2e reproducible), **5/20 BLOCKED** (requieren
despliegue en vivo: signup/login vivos, Wompi real, smoke prod).

## 8. Security review (19.9 — adversarial)
| Vector | Estado | Evidencia |
|---|---|---|
| API key brute force / enumeration | **PASS** | hash lookup O(1), timingSafeEqual, throttle devAuthFallida |
| Cross-tenant IDs / IDOR | **PASS** | filtros workspace/account + RLS + multi-tenant.e2e |
| Webhook secret exposure | **PASS** | secretos nunca en responses/logs |
| Replay / duplicate / idempotency abuse | **PASS** | dedup unique + reserva atómica + tolerancia HMAC |
| Rate limit bypass / XFF spoof | **PASS** | F17.2 XFF derecha + límites por workspace |
| SSRF / redirect abuse | **PASS** | F17.1 IP pinning + no-redirect |
| DLQ replay abuse | **PASS** | replay solo DLQ/fallido, rate-limited, mismo pipeline |
| API endpoint enumeration / docs leakage | **PASS** | superficie pública acotada, sin secretos |
| Billing / price / usage / workspace manipulation | **PASS** | precio server-side, dedup, tenant scope |
| Unauthorized webhook modification | **PASS** | scope por workspace + rol |
| **Creación masiva de API keys** | **PASS (nuevo 19.5)** | tope MAX_API_KEYS_ACTIVAS |
| **Emergencia / abuso general** | **PASS (nuevo 19.5)** | kill switch DEVELOPER_API_ENABLED |
Sin hallazgos críticos nuevos. Los dos gaps reales de beta se cerraron en 19.5.

## 9. Observability
`request_id` (240) + `correlation_id` + `X-Request-Id`; tablas de estado (`dulabs_dev_events` con
estado/intentos/último_error, `dulabs_dev_jobs`, `dulabs_dev_billing_events`, `dulabs_dev_account_audit`).
**Gap (ACCEPTED/externo):** solo `console.*`, sin pino/OTel/Sentry ni **alertas proactivas** →
configurar en Cloud Logging/Vercel (post-beta).

## 10. Incident runbook
`PHASE_19_BETA_RUNBOOK.md`: incidentes A–L (gateway/worker/PubSub/DLQ/webhooks/duplicado/perdido/
key comprometida/billing/tenant/rate-limit/Meta) con detectar→contener→verificar→recuperar→auditar→
comunicar, + procedimiento del kill switch.

## 11. Test matrix (19.10) — sin regresión
| Suite | Resultado |
|---|---|
| Unit/source F12–F19 | **86/86 PASS** |
| E2E F11–F19 + gateway/worker | **86/86 PASS** |
| TypeScript / ESLint / Build | 0 / 0 errores / PASS |
| npm audit | 7 (0 critical; 4 high build-tooling, 0 en runtime Developer) |
No ejecutado (BLOCKED): E2E vivo contra Meta/Wompi/Pub-Sub reales; smoke prod; `docker build`.

## 12. Riesgos restantes
- **Bloqueante de beta:** no hay despliegue Developer V1 en producción (gates 1–5,7,8).
- **NOT VERIFIED (consola):** IAM/OIDC/ingress/env/DNS/migraciones-en-prod.
- **ACCEPTED:** sin alertas proactivas; vulns de build-tooling; `/push` sin OIDC en código (IAM);
  contenedores `USER node` sin smoke de build aquí.

## 13. Rollback plan
- **Hoy (pre-deploy):** trivial — nada está desplegado ni mergeado; `main` (65cb842) es el punto de
  retorno. Descartar la pila de ramas feature no afecta producción.
- **Post-deploy:** (a) `DEVELOPER_API_ENABLED=false` (corte inmediato sin deploy); (b) redeploy de la
  imagen anterior en Cloud Run (`gcloud run services update-traffic --to-revisions=<prev>=100`);
  (c) revertir el merge en Vercel (deploy anterior); (d) la DB es aditiva (sin migraciones
  destructivas), así que un rollback de compute no requiere rollback de datos.

## 14. Criterios para SALIR DE BETA
Todos deben ser PASS con evidencia:
- 8 gates de F18 VERIFIED (Cloud Run/PubSub/IAM/Vercel/DNS/Supabase/Docker/Smoke).
- Smoke real PASS contra el dominio desplegado.
- BETA-001..020 PASS (incluidos los 5 hoy BLOCKED).
- Sin hallazgos de seguridad críticos; tenant isolation, webhook delivery, idempotencia, billing (si ON) PASS en vivo.
- Observabilidad operativa con alertas; recuperación de incidente probada (DLQ replay real).
- Rollback probado en staging.

## 15. Criterios para GA
- Beta estable con ≥1 developer real por un período definido, sin incidentes P0/P1 abiertos.
- Billing en vivo validado (cobro + dunning + downgrade + cancelación) si se comercializa.
- Alertas + on-call + SLOs definidos; runbook ejercitado en un incidente real o simulacro.
- Documentación consistente y pricing estable; `api.dulabs.dev` estable con cert.
- Revisión de seguridad externa (opcional pero recomendada) sin críticos.

## 16. Git
Rama `feature/developer-v1-fase19-controlled-beta` (sobre `da43f5c`, F18). Commits:
```
19.5 beta safety (kill switch + tope API keys) · 19.1/19.7/19.8 gate+runbook+acceptance ·
19.11 dashboard dead-link guard · 19.12 closure
```
Working tree limpio salvo `supabase/.temp/` (untracked). **NO PUSH · NO MERGE · NO DEPLOY.**
