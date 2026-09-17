# DuLabs Developer V1 — Fase 20: Production Completion Report

**Fecha:** 2026-09-17 · **Rama:** `feature/developer-v1-fase20-remediacion-b2` (superconjunto de `main`; 55 commits adelante, `HEAD..main = 0`)
**Sin push / merge a main / deploy a producción.** GCP: proyecto `dulabs-developer-v1` (aislado de Business/AMORE).
**Estados:** PASS · VERIFIED · FIXED · BLOCKED · NOT VERIFIED · ACCEPTED RISK

> Nota de integridad: no se fabricó evidencia E2E. Los flujos que requieren un dominio público registrado, un deploy a la web viva compartida, valores de secretos que no debo manipular, o credenciales externas (Meta test number / Wompi sandbox) se marcan **BLOCKED** con el comando exacto para resolverlos.

## 1. Estado inicial
F11–F19 implementado; F20 auditado; B2 código corregido (infra pendiente); B3 DNS pendiente; B1 deploy pendiente; beta no lanzada.

## 2. Problemas encontrados (este ciclo)
- B2 requería infra real Vercel→KMS (no existía WIF).
- **B3: `dulabs.dev` NO está registrado** (apex NXDOMAIN, sin NS) — no solo el subdominio `api`.
- B1: se creía que la rama estaba detrás de main (riesgo de revertir AMORE). **Falso:** la rama es superconjunto de main.
- Dependencias externas no resolubles desde este entorno (dominio, secretos, Meta/Wompi live, enable OIDC en Vercel).

## 3. Root cause
- B2: mecanismo de cifrado elegido implícitamente por env; runtimes con material de clave disjunto (ver `DULABS_DEVELOPER_V1_PHASE_20_REMEDIATION_REPORT.md`).
- B3: dominio inexistente en DNS.
- B1: la divergencia con main era en realidad "rama adelantada", no "atrasada".

## 4. Cambios realizados (código — FIXED/PASS)
Commit `564f19f` en la rama. Ver §14 del remediation report para el detalle. Resumen: canónico dev2 explícito + fail-closed, lectura por prefijo, proveedor KMS inyectable, Vercel→KMS por WIF, guard/diagnóstico de cobertura, +23 tests.

## 5. Infra modificada (GCP `dulabs-developer-v1` — VERIFIED, aislada, reversible)
Creado en este ciclo (aditivo, no afecta Business/AMORE):
- **SA** `dulabs-vercel-kms@dulabs-developer-v1.iam.gserviceaccount.com` (dedicada para Vercel).
- **KMS binding**: `roles/cloudkms.cryptoKeyEncrypterDecrypter` a esa SA **solo sobre** `dulabs-developer-master-key` (confirmado en la policy de la key). Mínimo privilegio.
- **WIF pool** `dulabs-vercel-pool` + **provider OIDC** `dulabs-vercel-provider` (issuer `https://oidc.vercel.com/vandusfor-4970s-projects` — validado por gcloud al crear; `allowed-audiences=https://vercel.com/vandusfor-4970s-projects`; `attribute-condition` = `project=='dulabs' && environment=='production'`).
- **workloadIdentityUser**: la SA es impersonable por `principalSet://…/attribute.project/dulabs` (scoped al proyecto Vercel `dulabs`).

**Recurso audience (para Vercel):** `//iam.googleapis.com/projects/654668494598/locations/global/workloadIdentityPools/dulabs-vercel-pool/providers/dulabs-vercel-provider`

**NOT VERIFIED (runtime):** el intercambio WIF real solo se puede probar con la app desplegada en Vercel con OIDC habilitado (no hay `VERCEL_OIDC_TOKEN` fuera de runtime). Ver §6/§9.

## 6. Variables configuradas (NOMBRES, nunca valores)
**Pendiente de setear en Vercel Production (comandos en §23):** `DEVELOPER_TOKEN_ENCRYPTION_MODE=kms`, `KMS_KEY_NAME=…`, `GCP_WORKLOAD_IDENTITY_AUDIENCE=…`, `GCP_WORKLOAD_IDENTITY_SA_EMAIL=…`, conservar `DEVELOPER_TOKEN_ENCRYPTION_KEY` (lectura legacy). **No se modificó el proyecto Vercel compartido** (evita acoplar Business con una config a medias antes del deploy).
**Pendiente en Cloud Run:** `DEVELOPER_TOKEN_ENCRYPTION_KEY` (lectura de `dev1:` legacy) — **BLOCKED**: requiere el VALOR de la clave (vive cifrado en Vercel; no debo manipular plaintext de secretos). Debe hacerlo el owner vía Secret Manager reusando el mismo valor.

## 7. Deployments
**Ninguno.** B1 preparado pero **no ejecutado**: desplegar a `www.dulabs.co` es publicar en la web viva compartida con Business/AMORE. Aunque la rama es superconjunto de main (sin regresión por commits faltantes), el deploy es outward-facing e irreversible en caliente y depende de §8/§9 → requiere tu autorización explícita de publicación.

## 8. DNS — BLOCKED
`dulabs.dev` **no está registrado** (apex NXDOMAIN, sin NS en resolvers públicos). No puedo registrar un dominio ni crear registros de una zona inexistente.
**Opciones (decisión + acceso a registrador):** (a) registrar `dulabs.dev` y delegar NS; (b) usar `api.dulabs.co` (subdominio del dominio ya operativo) — solo requiere un registro en la zona de `dulabs.co`. En ambos casos: crear el domain mapping de Cloud Run al gateway. **Requiere acceso al registrador/DNS (no disponible aquí).**

## 9. KMS / WIF — CÓDIGO PASS · GCP VERIFIED · runtime NOT VERIFIED
GCP creado y confirmado (§5). Falta (externo): (a) **habilitar OIDC** en el proyecto Vercel `dulabs` (Settings → Secure Backend Access / OIDC; inyecta `VERCEL_OIDC_TOKEN`); (b) setear las 4 vars (§23); (c) legacy key en Cloud Run (§6). Verificación viva: `GET /api/developer/diagnostics/crypto-status` debe dar `mecanismo=kms, formato_canonico_escritura=dev2, puede_leer_dev1=true, puede_leer_dev2=true, cobertura_lectura_completa=true` **tras el deploy**.

## 10. Cloud Run — VERIFIED (auditoría F20, sin cambios)
gateway + inbound-worker + outbound-worker + Job reconciliation: revisiones Ready, SA dedicadas, non-root, secretos por Secret Manager, ingress correcto, workers IAM-locked (OIDC), reconciliation Scheduler 5m con última ejecución OK. **Pendiente:** legacy key (§6) + alinear outbound-worker (skew `5fc3648` vs `fde7fe7`).

## 11. Pub/Sub — VERIFIED (auditoría F20)
topics inbound/outbound + 2 DLQ; subs push OIDC (`dulabs-pubsub-invoker@`, audience=endpoint), ack 20/30s, DLQ maxDelivery 5, retry 10–300s, retención 7d. `/push` protegido por IAM. Prueba de flujo E2E: **BLOCKED** (requiere deploy + webhook Meta real).

## 12. Vercel — PARCIAL
Proyecto `dulabs` → www.dulabs.co (Node 24). La rama es deployable (build PASS). **No desplegado** (§7). Env de producción: §6/§23. Separación Preview/Production respetada (no se tocó).

## 13. Supabase — VERIFIED (auditoría F20)
17 tablas migradas, RLS + índices + 3 planes sembrados. Datos reales presentes (2 números, ambos `conectado`; uno `dev1:` uno `dev2:`). Sin cambios este ciclo.

## 14. Meta / WhatsApp — BLOCKED (E2E)
Código de Embedded Signup + firma de webhook VERIFIED (auditoría). E2E real (connect → inbound → outbound) **BLOCKED**: requiere app desplegada + dominio + número de prueba controlado. No se envían mensajes reales.

## 15. Wompi / Billing — OFF (por diseño) / E2E BLOCKED
`DEVELOPER_BILLING_ENABLED` ausente → false. E2E de checkout/webhook **BLOCKED**: requiere deploy + credenciales Wompi (sandbox/test) no disponibles aquí. No se hacen cargos reales.

## 16. E2E — BLOCKED
El recorrido Signup→Billing→Workspace→Embedded Signup→WhatsApp→inbound→flow→outbound→webhook→usage→limits **no es ejecutable** sin: dominio registrado, deploy a la web viva, número Meta de prueba y credenciales Wompi. No se fabrica evidencia.

## 17. Security — PASS (código) / VERIFIED (infra F20)
Ver adversarial review de la auditoría F20 (IDOR/cross-tenant, SSRF/XFF F16/17, firma webhook, rate limit, OIDC push, secretos en Secret Manager/KMS). B2 refuerza: fail-closed, sin fugas de secretos en errores (test dedicado), WIF sin key JSON, mínimo privilegio KMS. `default compute SA = roles/editor`: **ACCEPTED RISK** — quitarlo puede romper Cloud Build/otros workloads; comando en §23 para el owner.

## 18. Tests — PASS (evidencia real, este ciclo)
`test:flow` **3566/3566, 0 fail** · `tsc --noEmit` **0** · `lint` **0 err / 33 warn** (baseline) · `build` **Compiled successfully** · `npm audit` **7 total / 5 runtime, 0 critical**. Suites crypto aisladas 40/40.

## 19. Rollback — VERIFIED (path)
Código: revertir commit `564f19f` (no pusheado). GCP: `gcloud iam workload-identity-pools (providers) delete`, `service-accounts delete`, `kms keys remove-iam-policy-binding` (todo reversible). Runtime: kill switch `DEVELOPER_API_ENABLED=false`; billing OFF; prefijos dev1/dev2 auto-describibles (mantener ambas claves en lectores evita pérdida de acceso).

## 20. Evidencia
- GCP WIF/KMS: outputs de creación + `get-iam-policy` de la key mostrando `dulabs-vercel-kms` con encrypterDecrypter + provider `describe`.
- Tests: contadores arriba.
- Git: `HEAD..main = 0`, `main..HEAD = 55` (rama superconjunto de main).
- DNS: NXDOMAIN de `dulabs.dev` (apex, resolver 8.8.8.8).

## 21. Issues restantes (BLOCKED — externos / no ejecutables aquí)
| # | Item | Estado | Bloqueo |
|---|---|---|---|
| 1 | Registrar/DNS `dulabs.dev` (o usar `api.dulabs.co`) + domain mapping | BLOCKED | Acceso a registrador/DNS |
| 2 | Habilitar OIDC en Vercel `dulabs` | BLOCKED | Setting de proyecto (dashboard/API) |
| 3 | Vercel Production env (4 vars) | PENDING | §23 (no toqué el proyecto compartido) |
| 4 | Legacy key `DEVELOPER_TOKEN_ENCRYPTION_KEY` en Cloud Run | BLOCKED | Valor de secreto (no debo manipularlo) |
| 5 | Deploy a producción (B1) | BLOCKED | Autorización de publicación en web viva |
| 6 | Migración `dev1→dev2` | BLOCKED | Depende de 3/4/5 + verificación viva |
| 7 | Meta E2E (número de prueba) | BLOCKED | Credencial/entorno externo |
| 8 | Wompi E2E (sandbox) | BLOCKED | Credencial externa |

## 22. Beta readiness
**BETA READY = NO.** Código: **PASS**. B2: **código PASS + GCP VERIFIED + runtime NOT VERIFIED**. B3: **BLOCKED (dominio)**. B1: **preparado, no desplegado**. E2E: **BLOCKED**. Los bloqueos restantes son **externos** (registrador, publicación en web viva, valores de secretos, credenciales Meta/Wompi, enable OIDC), no de código.

## 23. Qué puede hacer un cliente HOY, y comandos exactos para desbloquear
**Hoy, en producción:** nada del producto Developer (no está desplegado; las superficies dan 404 y no hay dominio de API). Localmente todo el stack pasa tests/build.

**Comandos exactos (owner) para llevar a operativo:**

1) **Vercel env (Production)** — no-secretos:
```bash
vercel env add DEVELOPER_TOKEN_ENCRYPTION_MODE production   # valor: kms
vercel env add KMS_KEY_NAME production                      # projects/dulabs-developer-v1/locations/us-central1/keyRings/dulabs-developer-keyring/cryptoKeys/dulabs-developer-master-key
vercel env add GCP_WORKLOAD_IDENTITY_AUDIENCE production    # //iam.googleapis.com/projects/654668494598/locations/global/workloadIdentityPools/dulabs-vercel-pool/providers/dulabs-vercel-provider
vercel env add GCP_WORKLOAD_IDENTITY_SA_EMAIL production    # dulabs-vercel-kms@dulabs-developer-v1.iam.gserviceaccount.com
# conservar DEVELOPER_TOKEN_ENCRYPTION_KEY (ya existe) para lectura de dev1 legacy
```
2) **Habilitar OIDC** en el proyecto Vercel `dulabs` (Settings → Secure Backend Access / OIDC Federation) para que se inyecte `VERCEL_OIDC_TOKEN`.
3) **Cloud Run legacy key** (reusar el MISMO valor que Vercel `DEVELOPER_TOKEN_ENCRYPTION_KEY`, vía Secret Manager):
```bash
printf %s "<VALOR_CLAVE_ESTATICA_BASE64>" | gcloud secrets create developer-token-encryption-key --data-file=- --project=dulabs-developer-v1
for SA in dulabs-gateway dulabs-worker-inbound dulabs-worker-outbound dulabs-reconciliation; do gcloud secrets add-iam-policy-binding developer-token-encryption-key --member="serviceAccount:${SA}@dulabs-developer-v1.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor --project=dulabs-developer-v1; done
# luego: gcloud run services update <svc> --update-secrets DEVELOPER_TOKEN_ENCRYPTION_KEY=developer-token-encryption-key:latest --region=us-central1   (y el Job)
```
4) **DNS**: registrar `dulabs.dev` (o decidir `api.dulabs.co`) + `gcloud run domain-mappings create --service dulabs-gateway --domain api.dulabs.<tld> --region us-central1` + crear el registro que devuelva el mapping.
5) **Deploy** (tras 1–4): promover la rama a producción (PR a main o `vercel --prod` desde la rama, según tu política).
6) **Verificar B2 vivo**: `curl -H "Authorization: Bearer <DIAGNOSTICS_SECRET>" https://www.dulabs.co/api/developer/diagnostics/crypto-status` → `mecanismo=kms, cobertura_lectura_completa=true`.
7) **Migración dev1→dev2** (tras 6): identificar `where meta_token_cifrado like 'dev1:%'` / `secret_cifrado like 'dev1:%'`, re-cifrar (decrypt→encrypt KMS) idempotente con conteo antes/después (script dedicado; NO durante requests; NO borrar dev1).
8) **Smoke E2E**: `scripts/dev-smoke-test.mjs` + connect con número de prueba.
