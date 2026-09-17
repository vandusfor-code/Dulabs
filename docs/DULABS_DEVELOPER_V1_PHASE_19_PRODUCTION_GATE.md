# DuLabs Developer V1 — Fase 19: Production Gate (verificación real de los 8 gates de Fase 18)

**Fecha:** 2026-09-17 · **Rama:** `feature/developer-v1-fase19-controlled-beta`
**Método:** evidencia real donde fue posible (Supabase vía `.env.local`, browser no destructivo
contra producción). Sin inventar resultados; sin `gcloud`/`vercel`/Docker en el entorno.

## Hallazgo mayor (con evidencia)
**Developer V1 NO está desplegado en producción.** El browser alcanza `dulabs.co` sin problema,
pero:
- `https://www.dulabs.co/developer-platform` → **404** (redirige a `dulabs.co`, "This page could not be found").
- `https://www.dulabs.co/api/developers/plans` → **404**.
- `https://api.dulabs.dev` → **navegación denegada/fallida** (dominio del gateway no resuelve/expone).

Es el estado esperado: todo F11–F19 vive en ramas feature sin merge/deploy (regla de oro).
Consecuencia: los gates de compute/deploy no son "FAIL de código" sino **BLOCKED: no existe
despliegue Developer V1 en producción todavía**. La capa de datos SÍ está provista.

## Matriz de gates

| Gate | Expected | Actual | Evidence | Status | Remediation |
|---|---|---|---|---|---|
| 1 Cloud Run IAM/ingress/SA | workers privados, SA propia | sin despliegue verificable | `api.dulabs.dev` no responde | **BLOCKED** | desplegar + `gcloud run services describe` (runbook F18 §18.1) |
| 2 Pub/Sub OIDC/DLQ/retry | push OIDC + DLQ | no verificable | requiere `gcloud` | **BLOCKED** | runbook F18 §18.2 |
| 3 IAM mínimo privilegio | sin Owner/Editor/*Admin | no verificable | requiere `gcloud` | **BLOCKED** | runbook F18 §18.3 |
| 4 Vercel env/preview | vars Developer en prod; secretos no en preview | Developer no desplegado (404) | rutas Developer 404 en prod | **BLOCKED** | `vercel env ls` + runbook §18.4 |
| 5 DNS/HTTPS `api.dulabs.dev` /salud | 200 + cert válido | **no resuelve/expone** | navegación denegada/fallida | **FAILED (no desplegado)** | crear domain mapping/LB al gateway |
| 6 Migraciones `dulabs_dev_*` aplicadas | tablas + seed | **13/13 tablas OK + planes $19/$45/$199** | query Supabase (`.env.local`) | **VERIFIED** (instancia configurada) | confirmar en consola que esa instancia == prod |
| 7 Docker build + `USER node` | build OK + smoke | no ejecutable aquí | sin Docker | **BLOCKED** | `docker build -f services/<svc>/Dockerfile .` |
| 8 Smoke real | SMOKE OK | nada que smokear (no desplegado) | 404 en prod | **BLOCKED** | correr `scripts/dev-smoke-test.mjs` tras desplegar |

## Evidencia detallada

**Gate 6 — Supabase (VERIFIED en la instancia de `.env.local`):**
```
OK dulabs_dev_plans · accounts · api_keys · events · idempotency_keys · jobs ·
   webhook_configs · usage_ledger · billing_events · billing_payments ·
   memberships · workspace_plans · account_audit   (13/13)
planes seed: DEVELOPER=$19, AGENCY=$45, ENTERPRISE=$199
```
Caveat: **NOT VERIFIED** que esta instancia sea exactamente la de producción (memoria indica que el
worker usa la misma Supabase de prod; confírmese en consola qué proyecto usa el deploy de prod).

**Gates 5/8 — Producción (browser, no destructivo):** `dulabs.co` responde; las rutas Developer
(`/developer-platform`, `/api/developers/plans`) dan 404 y `api.dulabs.dev` no responde → Developer
V1 no está desplegado.

## Conclusión del gate
- **Código + datos:** listos (regresión verde F18/F19; 13/13 tablas + seed).
- **Compute/deploy:** **no existe despliegue Developer V1 en producción** → los gates 1–5,7,8 quedan
  BLOCKED hasta que se despliegue (merge + deploy, fuera de alcance por la regla no-push/merge/deploy).
- **La beta NO es lanzable hoy** por ausencia de despliegue, no por defectos de código.
