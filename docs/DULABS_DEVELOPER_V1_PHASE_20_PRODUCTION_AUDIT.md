# DuLabs Developer V1 — Fase 20: Production Deployment Audit

**Fecha:** 2026-09-17 · **Modo:** READ-ONLY (sin push/merge/deploy/implementación)
**Rama:** `feature/developer-v1-fase20-production` @ `c95a638` (worktree `.claude/worktrees/f15-1-admin-flow-studio`)
**GCP:** proyecto `dulabs-developer-v1`, región `us-central1`, cuenta `vandusfor@gmail.com`
**Vercel:** scope `vandusfor-4970s-projects`, proyecto `dulabs` → www.dulabs.co
**Vocabulario de estado:** VERIFIED · PASS · FAIL · BLOCKED · NOT VERIFIED · ACCEPTED RISK

> Regla aplicada: ningún PASS/VERIFIED sin evidencia concreta. Lo externo sin acceso queda BLOCKED/NOT VERIFIED, nunca inventado. Nunca se imprimieron valores de secretos (solo nombres/prefijos/estructura).

---

## 1. Executive summary

La **infraestructura real existe y está bien construida**: Cloud Run (3 servicios + 1 Job) con SA dedicadas y non-root, Pub/Sub con OIDC + DLQ + retry, KMS envelope encryption, Secret Manager con IAM por recurso (least-privilege), y Supabase con las 17 tablas migradas, RLS activo, índices y planes sembrados. El código F11–F19 **compila (`next build` OK), pasa lint (0 errores) y test:flow (3544/3544, 0 fail)**.

**La beta NO es lanzable hoy** por 3 bloqueadores reales:

- **B1 — Developer V1 no está desplegado en producción.** Todas las superficies (`/developer-platform`, `/developers`, `/api/developers/plans`, `/api/developers/openapi`) responden **404** en www.dulabs.co. El stack vive solo en la rama local; `main` (lo que Vercel sirve) no lo contiene.
- **B2 — Mismatch de cifrado entre entornos (HIGH, con datos reales en prod).** Vercel cifra con clave estática (`dev1:`) y Cloud Run con KMS (`dev2:`); ninguno tiene la clave del otro. Ya existen en prod tokens con AMBOS prefijos → el worker de envío (Cloud Run) no puede descifrar el token `dev1:` escrito por el dashboard (Vercel).
- **B3 — `api.dulabs.dev` no existe en DNS** (NXDOMAIN incl. 8.8.8.8). El gateway solo responde por su URL `*.run.app`.

Además, hallazgos medios (version skew de imágenes, IAM del deploy SA amplio, default compute SA con Editor, GATEWAY_TRUSTED_PROXIES a validar, observabilidad/alertas no verificadas).

---

## 2. Git state — VERIFIED

| Ítem | Evidencia | Estado |
|---|---|---|
| Rama de trabajo | worktree `f15-1-admin-flow-studio` en `feature/developer-v1-fase20-production` | VERIFIED |
| HEAD | `c95a638af674fff441947b579ad7de82b2f3c893` | VERIFIED |
| Working tree | solo assets/scripts pre-existentes sin trackear; sin cambios F20 sin commit | VERIFIED |
| `main` intacto | `git ls-tree main -- app/developer-platform app/developers` → vacío | VERIFIED |
| `origin` sin F12–F19 | ramas nunca pusheadas (confirmado por el usuario) | VERIFIED |

## 3. F11–F19 evidence — VERIFIED

Closure reports presentes en la rama:
`PHASE_11_CLOSURE_REPORT`, `PHASE_11_PLANS_PRICING_DESIGN`, `PHASE_12_BILLING_DESIGN`, `PHASE_12_CLOSURE_REPORT`, `PHASE_13..17_CLOSURE_REPORT`, `PHASE_18_CLOSURE_REPORT`, `PHASE_18_PRODUCTION_RUNBOOK`, `PHASE_19_BETA_ACCEPTANCE`, `PHASE_19_BETA_RUNBOOK`, `PHASE_19_CLOSURE_REPORT`, `PHASE_19_PRODUCTION_GATE`. Código F11–F19 presente (billing, events-store, portal `/developers`, landing `/developer-platform`, beta-flags, services/gateway+workers+reconciliation).

## 4. Cloud Run — VERIFIED (infra) / hallazgos

| Servicio | Región | Imagen (commit) | SA | Ingress | Público | Escalado | Concurr. | Timeout | CPU/Mem |
|---|---|---|---|---|---|---|---|---|---|
| `dulabs-gateway` | us-central1 | `gateway:fde7fe7` | `dulabs-gateway@` | all | **allUsers** (API público, auth propia) | max 10 (min 0) | 80 | 30s | 1 / 512Mi |
| `dulabs-inbound-worker` | us-central1 | `worker-inbound:fde7fe7` | `dulabs-worker-inbound@` | all | **no** (IAM/OIDC) | max 20 (min 0) | 80 | 30s | 1 / 256Mi |
| `dulabs-outbound-worker` | us-central1 | `worker-outbound:`**`5fc3648`** | `dulabs-worker-outbound@` | all | **no** (IAM/OIDC) | max 20 (min 0) | 80 | 60s | 1 / 512Mi |
| `dulabs-reconciliation` (Job) | us-central1 | `reconciliation:fde7fe7` | `dulabs-reconciliation@` | n/a | invoker only | taskCount 1, maxRetries 1 | — | 300s | 1 / 512Mi |

- Revisiones activas Ready; imágenes en Artifact Registry `us-central1-docker.pkg.dev/dulabs-developer-v1/dulabs-developer`.
- Reconciliation disparado por Cloud Scheduler `dulabs-reconciliation-trigger` (`*/5 * * * *`, ENABLED) → `jobs/dulabs-reconciliation:run`. **Última ejecución exitosa** (succeeded=1, 2m9s). — VERIFIED
- **M2 (hallazgo):** `outbound-worker` está desplegado desde `5fc3648`, el resto desde `fde7fe7` → **version skew**. NOT ALIGNED.
- **ACCEPTED RISK:** `minScale` no configurado (min 0) → cold starts. Aceptable para beta; impacta latencia p99.
- **M3:** no hay path de health no autenticado externo confirmado (sondas a `/`,`/health`,`/healthz`,`/v1/health` → 404; el servicio responde = vivo).

## 5. IAM — VERIFIED (runtime least-privilege) / hallazgos

**SA runtime: sin roles a nivel proyecto** → permisos scoped por recurso (buen diseño):

| Recurso | Rol | Miembros |
|---|---|---|
| KMS key `dulabs-developer-master-key` | `cryptoKeyEncrypterDecrypter` | gateway, reconciliation, worker-inbound, worker-outbound |
| Secret `supabase-url` / `supabase-service-role-key` | `secretAccessor` | gateway, reconciliation, worker-inbound, worker-outbound |
| Secret `meta-app-secret` / `meta-webhook-verify-token` | `secretAccessor` | **solo gateway** |
| Topic `dulabs-inbound` / `dulabs-outbound` | `pubsub.publisher` | gateway, reconciliation |
| Service `*-worker` (run.invoker) | invoker | **solo `dulabs-pubsub-invoker@`** |
| Job `reconciliation` (run.invoker) | invoker | **solo `dulabs-scheduler-invoker@`** |

- **Hallazgo H1:** `dulabs-developer-deploy@` (SA de CI/CD) tiene roles **amplios**: `run.admin`, `secretmanager.admin`, `cloudkms.admin`, `pubsub.editor`, `artifactregistry.writer`, `cloudbuild.builds.editor`. Es una SA de deploy (esperablemente potente), pero `cloudkms.admin`/`secretmanager.admin` exceden lo necesario. — ACCEPTED RISK / hardening (least-privilege).
- **Hallazgo H2:** el **default compute SA** `654668494598-compute@developer.gserviceaccount.com` tiene `roles/editor`. Ningún servicio Developer corre con ella (usan SA dedicadas), pero es un riesgo latente (p.ej. Cloud Build). — ACCEPTED RISK / hardening.
- `user:vandusfor@gmail.com` = `roles/owner` (humano, esperado).

## 6. Pub/Sub + OIDC + DLQ — VERIFIED

| Sub | Push endpoint | OIDC SA | Audience = endpoint | ack | DLQ (maxDelivery) | Retry | Retención |
|---|---|---|---|---|---|---|---|
| `dulabs-inbound-worker` | `…inbound-worker…/push` | `dulabs-pubsub-invoker@` | sí | 20s | `dulabs-inbound-dlq` (5) | 10–300s | 7 días |
| `dulabs-outbound-worker` | `…outbound-worker…/push` | `dulabs-pubsub-invoker@` | sí | 30s | `dulabs-outbound-dlq` (5) | 10–300s | 7 días |
| `dulabs-inbound-dlq-inspect` / `dulabs-outbound-dlq-inspect` | pull | — | — | 10s | — | — | — |

- **/push protegido a nivel infra:** workers sin `allUsers`; solo `dulabs-pubsub-invoker@` tiene `run.invoker` + token OIDC con audience = endpoint. — VERIFIED
- **M4:** `expirationPolicy` de subs = **31 días** (expira por inactividad). Considerar TTL "never" para beta silenciosa. Topics sin `messageRetentionDuration` (default).

## 7. Vercel — VERIFIED (parcial) / BLOQUEADO (deploy)

- Proyecto `dulabs` → www.dulabs.co (Node 24). **No hay proyecto Vercel separado** para Developer.
- Env de **Production** presentes (solo nombres, sin valores): `DEVELOPER_TOKEN_ENCRYPTION_KEY`, `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_CONFIG_ID`, `META_APP_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*`, `CRON_SECRET`, `WOMPI_*` (Business), etc.
- **Ausentes (relevantes Developer):** `DEVELOPER_API_ENABLED` (default → habilitado, OK), `NEXT_PUBLIC_META_DEV_CONFIG_ID` (opcional, cae a Business), `DEVELOPER_BILLING_ENABLED` (default false), `DEVELOPER_WOMPI_*`/`DEVELOPER_BILLING_USD_COP_RATE` (billing off), `GATEWAY_TRUSTED_PROXIES`, `GCP_PROJECT`/`PUBSUB_TOPIC_*` (ver M1).
- `vercel.json` con crons Developer: `/api/developer/billing/cobro-recurrente` (15:00) y `/api/developer/maintenance/retencion` (04:30). — VERIFIED
- **M1:** Vercel no tiene `GCP_PROJECT`/`PUBSUB_TOPIC_*` ni credenciales GCP. Si algún endpoint de Vercel publica a Pub/Sub, faltaría config+credencial. (El enqueue de envío es el gateway en Cloud Run → probablemente OK; **a confirmar** contra la arquitectura de envío desde el dashboard.) — NOT VERIFIED

## 8. Supabase — VERIFIED (esquema/planes) / NOT VERIFIED (RLS live)

- **17 tablas `dulabs_dev_*` existen en prod** (migraciones aplicadas): accounts, workspace_plans, plans, plan_overrides, account_audit, api_keys, memberships, events, jobs, usage_ledger, webhook_configs, whatsapp_numbers, idempotency_keys, billing_customers, billing_events, billing_payments, billing_subscriptions. — VERIFIED
- **RLS habilitado en las 17 tablas** (migraciones), **16 policies**, **27 índices**, **12 unique constraints** (idempotencia/billing/eventos). Índices críticos: `dulabs_dev_idempotency_keys_workspace_key_idx` (único), `dulabs_dev_usage_ledger_job_idx` (único → uso idempotente), `dulabs_dev_whatsapp_numbers_phone_idx` (único), `dulabs_dev_jobs_retry_pending_idx`, `…_wamid_idx`. — VERIFIED (DDL)
- **Planes sembrados** (3): DEVELOPER (20000 msgs, 2 números, $19, ws1/mem1, sin adicionales), AGENCY (100000, 5 números, +$5, $45, ws5/mem5, adicionales), ENTERPRISE (override/null, $199, adicionales). — VERIFIED
- **Datos reales presentes:** whatsapp_numbers=2 (ambos `conectado`), jobs=1, usage_ledger=1, api_keys=1, webhook_configs=1, memberships=1, account_audit=7, accounts=0 (F11 aún materializa cuentas de forma perezosa; camino legacy en uso).
- **NOT VERIFIED:** deny-path de RLS en vivo (no hay `NEXT_PUBLIC_SUPABASE_ANON_KEY` en `.env.local` local; service role hace bypass de RLS). El aislamiento primario es a nivel app (ver §16 BETA-017).

## 9. DNS — FAIL

- `api.dulabs.dev` → **NXDOMAIN** (nslookup local y contra 8.8.8.8). No hay registro DNS ni domain mapping de Cloud Run. — FAIL / BLOQUEADOR B3
- `www.dulabs.co/developer-platform` → **404**; `/developers` → **404**; `/api/developers/plans` → **404**; `/api/developers/openapi` → **404** (rutas confirmadas existentes en la rama). — FAIL / BLOQUEADOR B1

## 10. HTTPS — PARCIAL

- Gateway responde por `https://dulabs-gateway-c37lomkpmq-uc.a.run.app` (TLS gestionado por Cloud Run); rutas reales bajo `/api/v1/*` (404 en rutas fuera de contrato = servicio vivo). — VERIFIED (endpoint run.app)
- HTTPS de `api.dulabs.dev` — imposible (no existe el dominio). — BLOCKED

## 11. Docker — VERIFIED

- Base `node:22-slim` (los 4). **`USER node` (non-root) en los 4** → resuelto el riesgo ACCEPTED de F17. — VERIFIED
- Sin secretos en build (solo `package*.json`, `tsconfig.json`, `lib/developer`, `services`; `npm ci`). `EXPOSE 8080` (servicios). — VERIFIED
- **ACCEPTED RISK:** runtime corre TypeScript vía `tsx` (`node_modules/.bin/tsx services/**/index.ts`) → sin type-check en build de servicios y `npm ci` instala devDependencies en la imagen. Funciona; recomendable precompilar y `--omit=dev` a futuro.
- Sin `HEALTHCHECK` en Dockerfile (Cloud Run sondea por puerto). — ACCEPTED RISK

## 12. Dependencies (npm audit) — hallazgos (no bloqueante)

- **Total:** 7 (4 high, 3 moderate). **Runtime/producción (`--omit=dev`):** 5 (2 high, 3 moderate). Ninguna **critical**.
- Runtime: `brace-expansion` (HIGH, DoS por expansión no acotada), `nanoid` (HIGH, loop con size=0), `baseline-browser-mapping` (MOD, DoS input inválido), `exceljs`→`uuid` (MOD), `uuid` (MOD, bounds check v3/v5/v6).
- Todas son DoS por input a funciones específicas, transitivas, **no claramente alcanzables** desde input no confiable del API público. — ACCEPTED RISK / remediar con `npm audit fix` (mayoría no-breaking) antes de GA.

## 13. Tests — PASS

- `npm run test:flow` → **tests 3544 · pass 3544 · fail 0 · duration ~118s**. Los e2e Developer contra Postgres **se saltan** sin `.env.local` (no se tocó prod). — PASS
- `npm run build` (`validate-release-config` + `next build`) → **compila OK**, manifiesto de rutas completo (incluye `/developers/*`). Guard de release-crypto no abortó. — PASS
- `npm run lint` → **0 errores, 33 warnings** (unused vars en tests, `no-unused-expressions` en smoke, 1 `eslint-disable` obsoleto). — PASS
- Runner seguro: `run-test-flow.mjs` excluye explícitamente `worker/src/**` (evita el incidente histórico contra la Supabase de prod). — VERIFIED

## 14. Meta / WhatsApp — VERIFIED (infra) / BLOCKED (smoke real)

- Gateway carga `meta-app-secret` + `meta-webhook-verify-token` desde Secret Manager (`services/gateway/index.ts`) y **verifica firma** del webhook (`verificarFirmaMeta`, `x-hub-signature-256`) + verificación `hub.challenge`. — VERIFIED (código + secretos existen + acceso solo gateway)
- Vercel tiene `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_CONFIG_ID`, `META_APP_SECRET` (Embedded Signup reusa la misma Meta App). — VERIFIED (presencia)
- **BLOCKED / NOT VERIFIED (requiere consola Meta):** a qué app apunta el webhook de prod, suscripción de campos, `config_id` de Developer, estado de permisos/revisión, y smoke real de envío (no enviar a clientes; requiere número de prueba/WABA de sandbox).

## 15. Wompi / Billing — OFF por diseño (VERIFIED estado)

- `DEVELOPER_BILLING_ENABLED` ausente en Vercel → **false** (comportamiento F11, sin cobro). — VERIFIED
- Sin env `DEVELOPER_WOMPI_*`/`DEVELOPER_BILLING_USD_COP_RATE` (fail-closed: sin tasa no se cobra). Tablas billing existen, **vacías**. — VERIFIED
- Lógica/precios F12 intactos (no auditados en profundidad; no tocar). Existencia de comercio Wompi Developer y llaves → **NOT VERIFIED** (consola Wompi). Correcto mantener OFF para la beta.

## 16. Beta acceptance (BETA-001..020) — de `PHASE_19_BETA_ACCEPTANCE.md`

| Estado | IDs |
|---|---|
| **PASS (code/e2e)** 15 | 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 017, 018, 019 (nota: 16 lista 15+016 code) |
| **PASS (code) con E2E real BLOCKED** | 016 billing (fase12-billing.e2e 10/10; Wompi real BLOCKED) |
| **BLOCKED (deploy)** 5 | 001 signup, 002 login→/developer, 016 (Wompi real), 020 smoke prod, y validación viva de 004–015 contra prod |

Resumen del doc: **15/20 PASS reproducible · 5/20 BLOCKED por despliegue en vivo.** Ningún BLOCKED convertido a PASS. La beta solo pasa cuando B1/B2/B3 estén resueltos con evidencia viva.

## 17. Adversarial review — VERIFIED (código/infra) / notas

| Vector | Estado | Evidencia |
|---|---|---|
| IDOR / cross-tenant | VERIFIED (e2e) | `multi-tenant-security.e2e` (BETA-017) + workspace scoping server-side + RLS defense-in-depth |
| API key enumeration / brute force | PASS (code) / NOT VERIFIED (live) | Bearer `dl_live_` comparación en tiempo constante; rate limit; brute force a escala no probado en vivo |
| Replay / duplicate webhook | PASS (e2e) | idempotency único + HMAC `ts.body` (BETA-006/009) |
| Duplicate billing | PASS (code) / N/A | idempotencia billing; billing OFF hoy |
| SSRF / DNS rebinding / XFF | PASS (code) | F16/F17 IP pinning + XFF hardening; **GATEWAY_TRUSTED_PROXIES no seteado (default 0)** — validar al montar `api.dulabs.dev` tras LB |
| Webhook signature bypass | VERIFIED | `verificarFirmaMeta` con app secret de Secret Manager (solo gateway) |
| Rate-limit bypass | PASS (e2e) | `read-rate-limit.e2e` (BETA-015) |
| Unauthorized `/push` | VERIFIED (infra) | workers IAM-locked a `pubsub-invoker@`, audience OIDC = endpoint |
| Public Cloud Run | VERIFIED | gateway allUsers intencional (auth propia); workers **no** públicos |
| Public Pub/Sub | VERIFIED | topics/subs IAM scoped; publisher solo gateway+reconciliation |
| Excessive IAM | ACCEPTED RISK | runtime least-privilege; deploy SA amplio (H1); default compute Editor (H2) |
| Secret exposure | VERIFIED / **ver B2** | Secret Manager + KMS envelope, fail-closed, sin secretos en build; **pero mismatch de mecanismo entre entornos** |
| Cost abuse / resource exhaustion | PASS (code) + VERIFIED (infra) | entitlements + past_due bloquea consumo + kill switch; maxScale 10/20 |

## 18. Deployment plan (propuesto — NO ejecutado)

Orden validado contra la arquitectura (Supabase ya migrada; el bloqueo es app + dominio + crypto):

0. **Resolver B2 (crypto)** — precondición dura. Decidir estrategia de claves para que **cualquier runtime descifre `dev1:` y `dev2:`** (recomendado: dar a los servicios Cloud Run también `DEVELOPER_TOKEN_ENCRYPTION_KEY`, y/o a Vercel acceso KMS). Re-conectar/re-cifrar el número con token `dev1:` si aplica.
1. **Supabase** — ya aplicado (VERIFIED). Solo confirmar no-drift antes del deploy.
2. **Cloud Run**: alinear versión (M2, re-build outbound desde el mismo commit) → re-deploy gateway → workers → job. SA/permesos ya correctos.
3. **Pub/Sub** — ya configurado; opcional ajustar `expirationPolicy` (M4).
4. **Vercel**: integrar la rama a una rama de release/`main` **sin tocar Business/AMORE**, `next build` OK, deploy. Setear env restantes (kill switch explícito, GATEWAY_TRUSTED_PROXIES si aplica, billing OFF).
5. **DNS/HTTPS**: crear `api.dulabs.dev` (registro DNS + domain mapping Cloud Run + TLS) y apuntar la base pública del API.
6. **Smoke tests** (§ plan abajo) contra prod con número de prueba.
7. **Beta acceptance** viva (BETA-001..020) → **Production gate**.

**Variables por servicio:** Cloud Run (KMS_KEY_NAME, GCP_PROJECT, PUBSUB_TOPIC_*, Supabase via Secret Manager, + `DEVELOPER_TOKEN_ENCRYPTION_KEY` si se adopta el fix B2). Vercel (las §7 presentes + kill switch/billing/trusted proxies).
**Service accounts:** ya provisionadas y scoped (§5).

## 19. Rollback plan

- **Cloud Run:** `gcloud run services update-traffic <svc> --to-revisions <REV_ANTERIOR>=100` (revisiones previas retenidas). Job: re-apuntar imagen anterior.
- **Vercel:** promover el deployment anterior (rollback instantáneo).
- **Kill switch:** `DEVELOPER_API_ENABLED=false` → 503 en todo `/api/v1` autenticado, sin deploy (fail-safe).
- **Billing:** `DEVELOPER_BILLING_ENABLED=false` (ya OFF).
- **Pub/Sub:** DLQ + subs inspect para drenar/replay sin pérdida (retención 7 días).
- **Crypto (B2):** si el fix causa problemas, los prefijos `dev1/dev2` son auto-describibles; mantener ambas claves en el reader evita pérdida de acceso.

## 20. Launch blockers

- **B1 (FAIL):** Developer V1 no desplegado (404 en todas las superficies).
- **B2 (HIGH):** mismatch de cifrado Vercel(static `dev1:`) ↔ Cloud Run(KMS `dev2:`); ya hay ambos prefijos en prod → el token `dev1:` no es descifrable por el worker de envío.
- **B3 (FAIL):** `api.dulabs.dev` inexistente en DNS.
- Medios (no bloqueantes pero previos a GA): M1 (Pub/Sub publish desde Vercel), M2 (version skew), M3 (health endpoint), M4 (sub expiration), H1/H2 (IAM hardening), deps (§12), RLS live (§8), Meta/Wompi consola (§14/§15).

## 21. Matriz VERIFIED / PASS / FAIL / BLOCKED / NOT VERIFIED

| Área | Estado | Evidencia | Acción requerida |
|---|---|---|---|
| Git | VERIFIED | rama/HEAD/worktree/main intacto | — |
| Cloud Run Gateway | VERIFIED | revisión Ready, allUsers+auth propia, 1/512Mi | alinear versión / health |
| Cloud Run Worker (in/out) | VERIFIED | IAM-locked, OIDC /push, DLQ | M2 (outbound skew) |
| Reconciliation | VERIFIED | Scheduler 5m, última exec OK | — |
| IAM | VERIFIED (+hardening) | runtime scoped; deploy SA amplio; default compute Editor | H1/H2 least-privilege |
| Pub/Sub | VERIFIED | topics+subs+retry+DLQ 7d | M4 expiration |
| OIDC | VERIFIED | invoker solo pubsub-invoker, audience=endpoint | — |
| DLQ | VERIFIED | inbound/outbound-dlq (maxDelivery 5) + inspect | — |
| Vercel | PARCIAL / BLOCKED | proyecto+env presentes; developer no desplegado | B1 |
| Supabase | VERIFIED / NOT VERIFIED (RLS live) | 17 tablas, RLS+índices+planes | probe anon key |
| DNS | FAIL | api.dulabs.dev NXDOMAIN; /developer* 404 | B1, B3 |
| HTTPS | PARCIAL / BLOCKED | run.app OK; dominio no existe | B3 |
| Docker | VERIFIED | node:22-slim, USER node, sin secretos build | tsx/devDeps (ACCEPTED) |
| Secrets | VERIFIED / **B2** | Secret Manager + KMS; **mismatch de mecanismo** | **B2** |
| Tests | PASS | test:flow 3544/3544, build OK, lint 0 err | — |
| Billing | OFF (VERIFIED) | flag off, tablas vacías | activar post-beta |
| Meta | VERIFIED (infra) / BLOCKED (smoke) | firma+secretos; consola no accesible | consola Meta |
| Wompi | NOT VERIFIED | flag off; comercio no verificable | consola Wompi |

## 22. Exact next actions (esperando autorización explícita)

1. **Decidir estrategia de B2 (crypto)** y aplicarla (env de claves en ambos entornos) — sin esto, los envíos con tokens del dashboard fallan.
2. **B3:** provisionar `api.dulabs.dev` (DNS + domain mapping + TLS).
3. **M2:** re-build/deploy de `outbound-worker` desde el commit común.
4. **B1:** integrar la rama a release/`main` (sin tocar Business/AMORE) y desplegar a Vercel; confirmar 200 en las 4 superficies Developer.
5. **Setear env faltantes** (kill switch explícito, GATEWAY_TRUSTED_PROXIES, billing OFF confirmado; M1 si aplica).
6. **Smoke test** (§13 plan) con número de prueba; luego **Beta acceptance viva** y **Production gate**.
7. **Hardening previo a GA:** `npm audit fix`, least-privilege deploy SA / default compute SA, sub expiration, health endpoint, precompilar contenedores.

---

*Auditoría read-only. No se implementó código, ni se hizo push/merge/deploy, ni se modificó producción. Cualquier cambio requiere autorización explícita del owner.*
