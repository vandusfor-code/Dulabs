# DuLabs Developer V1 — Fase 18: Production Runbook (verificación de infra externa)

> Este runbook contiene los comandos exactos para **verificar y aplicar** la
> configuración de infraestructura que **NO puede comprobarse desde el repo**
> (Cloud Run, Pub/Sub, IAM, Vercel, DNS). Cada bloque marca qué es VERIFY
> (solo lectura) y qué es APPLY (cambia infra). **No ejecutar APPLY a ciegas.**
> Constantes conocidas del repo: proyecto GCP `dulabs-developer-v1`, región
> `us-central1`, Artifact Registry `us-central1-docker.pkg.dev/dulabs-developer-v1/dulabs-developer`.
> Servicios: `gateway`, `worker-inbound`, `worker-outbound` (Cloud Run services)
> + `reconciliation` (Cloud Run Job). Placeholders en MAYÚSCULAS entre <...>.

---

## 18.1 — Cloud Run security

**VERIFY (por cada servicio):**
```bash
for S in gateway worker-inbound worker-outbound; do
  echo "== $S =="
  gcloud run services describe $S --project=dulabs-developer-v1 --region=us-central1 \
    --format="yaml(spec.template.spec.serviceAccountName, spec.template.spec.containerConcurrency, spec.template.spec.timeoutSeconds, metadata.annotations.'run.googleapis.com/ingress', spec.template.metadata.annotations)"
  # ¿permite invocación no autenticada? (NO debe permitir allUsers salvo el gateway público)
  gcloud run services get-iam-policy $S --project=dulabs-developer-v1 --region=us-central1 --format=json
done
```
**Criterio:**
- `worker-inbound`, `worker-outbound`: ingress `internal` + **sin** `allUsers` en `roles/run.invoker` (solo la SA de Pub/Sub). El gateway es público (recibe API keys) → ingress `all`, pero la auth es por API key en la app.
- Cada servicio con **su propia** service account (no la default de Compute).
- `containerConcurrency`, `timeoutSeconds`, `min/max-instances`, `memory`, `cpu` definidos.

**APPLY (ejemplo worker-inbound, privado):**
```bash
gcloud run services update worker-inbound --project=dulabs-developer-v1 --region=us-central1 \
  --no-allow-unauthenticated --ingress=internal \
  --service-account=<SA_WORKER_INBOUND>@dulabs-developer-v1.iam.gserviceaccount.com \
  --min-instances=0 --max-instances=<N> --concurrency=<C> --timeout=<T>s \
  --memory=<M>Mi --cpu=<CPU>
```

## 18.2 — Pub/Sub (OIDC push + DLQ)

**VERIFY:**
```bash
gcloud pubsub subscriptions describe <SUB_INBOUND> --project=dulabs-developer-v1 \
  --format="yaml(pushConfig.pushEndpoint, pushConfig.oidcToken, ackDeadlineSeconds, retryPolicy, deadLetterPolicy)"
```
**Criterio:** `pushConfig.oidcToken.serviceAccountEmail` = SA dedicada de Pub/Sub;
`pushEndpoint` = URL del worker + `/push`; `deadLetterPolicy` con `deadLetterTopic`
y `maxDeliveryAttempts`; `retryPolicy` con backoff. La SA de push debe tener
`roles/run.invoker` **solo** sobre el worker destino.

**APPLY (ejemplo):**
```bash
gcloud pubsub subscriptions update <SUB_INBOUND> --project=dulabs-developer-v1 \
  --push-endpoint=https://<WORKER_INBOUND_URL>/push \
  --push-auth-service-account=<SA_PUBSUB_PUSH>@dulabs-developer-v1.iam.gserviceaccount.com \
  --dead-letter-topic=<DLQ_TOPIC> --max-delivery-attempts=5 \
  --min-retry-delay=10s --max-retry-delay=600s
```
> Defensa en profundidad opcional (código): validar el JWT OIDC en `/push`
> (audience + email de la SA). Hoy el `/push` confía solo en IAM (documentado en
> `worker-inbound/server.ts`). No implementado en F18 por no ser verificable aquí.

## 18.3 — Service Accounts / IAM (mínimo privilegio)

**VERIFY:**
```bash
gcloud projects get-iam-policy dulabs-developer-v1 --format=json | \
  jq '.bindings[] | select(.role|test("owner|editor|admin";"i"))'
```
**Matriz objetivo (sin `Owner`/`Editor`/`*Admin` en SAs de runtime):**

| Servicio | Service Account | Roles necesarios | NO debe tener |
|---|---|---|---|
| gateway | `SA_GATEWAY` | `roles/pubsub.publisher` (outbound), acceso a Secret Manager de sus secretos | Editor, Owner, cloudsql.admin |
| worker-inbound | `SA_WORKER_INBOUND` | (invocado por Pub/Sub) + Secret Manager propio | pubsub.admin |
| worker-outbound | `SA_WORKER_OUTBOUND` | `roles/pubsub.subscriber` o invoker, Secret Manager propio | — |
| reconciliation (Job) | `SA_RECONCIL` | Secret Manager propio | invoker de otros servicios |
| Pub/Sub push | `SA_PUBSUB_PUSH` | `roles/run.invoker` SOLO sobre el worker destino | run.invoker global |

Supabase se accede con `SUPABASE_SERVICE_ROLE_KEY` (secreto por env), no vía IAM de GCP.

## 18.4 — Vercel (Production / Preview / Development)

**VERIFY (nombres y scope; nunca imprime valores):**
```bash
vercel env ls
```
**Matriz de variables Developer (todas deben EXISTIR en Production; los secretos NO deben estar en Preview):**

| Variable | Scope esperado | Sensible |
|---|---|---|
| DEVELOPER_TOKEN_ENCRYPTION_KEY | Production (+Preview solo si Preview usa Developer) | 🔒 |
| DEVELOPER_BILLING_ENABLED | Production/Preview | no |
| DEVELOPER_BILLING_USD_COP_RATE | Production | no |
| DEVELOPER_WOMPI_PRIVATE_KEY / INTEGRITY_KEY / EVENTS_KEY | **Production only** | 🔒 |
| NEXT_PUBLIC_DEVELOPER_WOMPI_PUBLIC_KEY | Production/Preview | pública |
| NEXT_PUBLIC_DEVELOPER_SALES_EMAIL | Production/Preview | no |
| GATEWAY_TRUSTED_PROXIES | (gateway corre en Cloud Run, no Vercel) | no |
| CRON_SECRET, DIAGNOSTICS_SECRET | **Production only** | 🔒 |
| SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY | Production (service role 🔒) | 🔒 |

**Criterio clave:** las claves privadas de Wompi Developer y `SUPABASE_SERVICE_ROLE_KEY`
**no** deben estar disponibles en Preview (evita que un deploy de PR acceda a producción).

## 18.5 — Cron / jobs

`vercel.json` (en repo) declara: `cobro-recurrente` (0 15 * * *) y `maintenance/retencion`
(30 4 * * *). Ambos exigen `Authorization: Bearer CRON_SECRET` (fail-closed, F16).
**VERIFY:** `vercel crons ls` (o el dashboard) y confirmar que `CRON_SECRET` existe en Production.
Idempotencia/solapamiento: el billing recurrente dedup por transacción y la retención es
idempotente por diseño (F12/F13). No tocar los crons de Business (`/api/wompi/*`).

## 18.14 — Dominio / DNS

`api.dulabs.dev/api/v1` está hardcodeado en `openapi.ts`, la landing y el dashboard.
**VERIFY:**
```bash
dig +short api.dulabs.dev
curl -sSI https://api.dulabs.dev/salud   # debe dar 200 y cert válido
```
**Criterio:** el dominio resuelve al gateway de Cloud Run (domain mapping o LB), HTTPS con
cert válido, y `/salud` responde 200. Confirmar que el server URL del OpenAPI coincide con el
dominio real desplegado.

---

## Checklist de verificación (marcar tras ejecutar en consola)

- [ ] Cloud Run: workers `--no-allow-unauthenticated` + ingress internal + SA propia
- [ ] Cloud Run: gateway con SA propia y recursos (min/max/concurrency/timeout) definidos
- [ ] Pub/Sub: push OIDC + DLQ + retry por subscription
- [ ] IAM: sin Owner/Editor/*Admin en SAs de runtime; push SA con invoker acotado
- [ ] Vercel: variables Developer presentes; secretos NO en Preview
- [ ] DNS: `api.dulabs.dev` → gateway, HTTPS válido, `/salud` 200
- [ ] Supabase: migraciones `dulabs_developer_v1_*` aplicadas en producción
- [ ] Smoke: `GATEWAY_BASE_URL=... APP_BASE_URL=... node scripts/dev-smoke-test.mjs` → SMOKE OK
- [ ] Contenedores: `docker build -f services/<svc>/Dockerfile .` OK con `USER node` + `/salud` responde
