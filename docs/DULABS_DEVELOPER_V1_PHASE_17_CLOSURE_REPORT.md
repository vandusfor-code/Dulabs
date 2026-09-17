# DuLabs Developer V1 — Fase 17: Infra Hardening + E2E/Load/Chaos + Release Readiness (cierre)

**Fecha:** 2026-09-17
**Rama:** `feature/developer-v1-fase17-hardening` (apilada sobre Fase 16; `main` intacto en `65cb842`)
**Estado:** ✅ Auditoría + correcciones + gate de release. **NO PUSH · NO MERGE · NO DEPLOY.**

> Regla aplicada: **auditar → decidir con evidencia → corregir**. Nada se declara PASS solo
> porque exista un test. Lo que no puede verificarse desde el repo se marca **NOT VERIFIED**.

---

## 1. Bloques ejecutados

| Bloque | Entregable | Estado |
|---|---|---|
| 17.1 | SSRF IP pinning (resuelve P2 DNS rebinding) | ✅ implementado + 16 tests |
| 17.2 | X-Forwarded-For hardening (resuelve P3) | ✅ implementado + 8 tests |
| 17.3 | Dependency/supply-chain audit + fix crítico | ✅ Next 16.2.10→16.3.5 (0 critical) |
| 17.4 | Infrastructure security audit | ✅ verificable documentado; resto NOT VERIFIED |
| 17.5 | E2E extremo a extremo | ✅ inventario de cobertura real (evidencia) |
| 17.6 | Load / concurrency | ✅ cobertura existente + gap: claim concurrente |
| 17.7 | Chaos / failure | ✅ cobertura existente + gap: webhook duplicado |
| 17.8 | Release readiness gate | ✅ checklist objetivo (abajo) |
| 17.9 | Test matrix + closure | ✅ este documento |

---

## 2. 17.1 — SSRF IP pinning (P2 resuelto)

**Problema (F16 residual):** el guard validaba DNS y luego `fetch` re-resolvía → la IP podía
cambiar entre validación y conexión (rebinding TOCTOU).

**Solución:** `lib/developer/secure-webhook-delivery.ts` (`entregarWebhookSeguro`) usa
`node:https`/`node:http` `request` con un `lookup` custom que **resuelve, valida TODAS las IPs
con la política real** (`motivoIpBloqueada`, exportada de `ssrf-guard.ts`) y **conecta solo a la
IP validada** — una única resolución sirve para validar y conectar (sin TOCTOU). Garantías:
- IP literal en la URL validada antes (node no llama `lookup` para literales).
- No sigue redirects (node:https no los sigue) → un 3xx nunca lleva a un destino no validado.
- TLS/SNI intacto: servername = hostname, certificado validado contra el hostname; **nunca** se
  desactiva la verificación de certificado. Sin dependencias nuevas (solo built-ins de Node).
- `worker-inbound` y el `ping` usan el helper; `fetchImpl` se adapta para no romper e2e previos.

**Tests (16):** metadata (169.254.169.254), RFC1918 (10/172.16/192.168), loopback, IPv6 `::1`,
IPv4-mapped a interno, **rebinding multi-IP** (una interna ⇒ rechaza sin conectar), IP literal
interna, protocolo no-https; y mecánica real contra server local: 200, **302 no seguido** (el
destino del Location nunca se golpea), 500, timeout, connection refused, body+firma entregados.

## 3. 17.2 — X-Forwarded-For hardening (P3 resuelto)

**Problema:** `gateway/server.ts` tomaba el token izquierdo de XFF (spoofeable: `X-Forwarded-For:
1.2.3.4` evadía el rate-limit por IP).

**Solución:** `lib/developer/client-ip.ts` (`extraerIpConfiable`) cuenta **desde la derecha** (la
infra confiable anexa la IP real al final; el cliente solo antepone a la izquierda). Default 0
hops = toma el último (no falsificable por el cliente). Configurable por `GATEWAY_TRUSTED_PROXIES`
según topología. **Tests (8).**

**NOT VERIFIED (config de infra):** el número exacto de hops confiables depende del despliegue
(Cloud Run directo = 0; detrás de HTTPS LB externo puede ser 1). **Requiere verificación en
consola** y fijar `GATEWAY_TRUSTED_PROXIES` en consecuencia.

## 4. 17.3 — Dependency / supply-chain audit

`npm audit`: **10 → 7 vulns** tras actualizar **Next 16.2.10 → 16.3.5** (0 critical, 0 en runtime
Developer). Detalle por vulnerabilidad:

| Paquete | Sev | ¿Runtime Developer? | Vía | Decisión |
|---|---|---|---|---|
| **next** (critical) | crit | sí | directo | **CORREGIDO** → 16.3.5. Sub-CVEs igualmente N/A aquí (sin middleware, sin Server Actions, sin SVG/remotePatterns, host Vercel-Linux) |
| brace-expansion | high | no | eslint/ts-eslint→minimatch; exceljs→archiver | ACCEPTED (build/tooling + Business) |
| browserslist | high | no | tooling de build (targets) | ACCEPTED (build-time) |
| js-yaml | high | no (0 imports en Developer) | tooling | ACCEPTED (no en runtime Developer) |
| nanoid | high | no | @tailwindcss/postcss→postcss | ACCEPTED (build-time CSS) |
| baseline-browser-mapping | mod | no | tooling de build | ACCEPTED (build-time) |
| exceljs | mod | no (Business) | directo (xlsx de Business) | ACCEPTED (fuera de Developer) |
| uuid | mod | no | exceljs→uuid | ACCEPTED (Developer usa node:crypto randomUUID) |

Evidencia: `grep` de imports en `app/lib/services` no encontró `js-yaml`/`nanoid`/`exceljs` en el
runtime de Developer; `npm ls` confirma que las 7 restantes son de build-tooling o de Business.
No se hicieron upgrades indiscriminados. **Sin secretos** en repo/logs/tests/fixtures (verificado
en F16 y aquí).

## 5. 17.4 — Infrastructure security audit

**Verificable desde repo → PASS:**
- Supabase RLS en 17 tablas `dulabs_dev_*`; 16/16 `SECURITY DEFINER` con `search_path=public`.
- Cron `CRON_SECRET` (fail-closed, constant-time); `vercel.json` declara los crons de Developer.
- Headers/CSP/HSTS/XFO/nosniff (Next); gateway sin CORS (correcto server-to-server).
- Dockerfiles: `node:22-slim`, `EXPOSE 8080`; `services/cloudbuild.yaml` **solo construye/pushea
  imágenes** (no contiene flags de `gcloud run deploy`).

**NOT VERIFIED — requiere consola (no está en el repo):**
- Cloud Run: `--no-allow-unauthenticated`, service accounts por servicio, ingress, y permisos
  mínimos hacia Supabase. El `/push` de `worker-inbound/server.ts` **confía en Cloud Run IAM**
  (documentado en código), no verifica el OIDC en código.
- Pub/Sub: autenticación OIDC del push, service account, política de retry, DLQ y permisos.
- Vercel: separación prod/preview, valores reales de env (`CRON_SECRET`, billing, `NEXT_PUBLIC_*`).
- Dominio real del gateway.

**Hardening recomendado (documentado, NO aplicado por no poder validar el build de imagen aquí):**
- Contenedores corren como root (sin `USER` en los Dockerfiles) → agregar `USER node` tras validar.
- Defensa en profundidad: verificar el token OIDC de Pub/Sub en el `/push` (además de IAM).

## 6. 17.5/17.6/17.7 — E2E / Load / Chaos (evidencia)

**Cobertura NUEVA (Fase 17):**
- Claim de entrega concurrente: 8 "workers" reclaman el mismo evento → **exactamente 1** (lease
  atómico, sin doble entrega). `fase17-chaos-concurrency.e2e.test.ts`.
- Webhook de billing duplicado/concurrente (mismo `provider_event_id`) → **exactamente 1 'nuevo'**
  (dedup por unique, efecto único, sin doble cobro/activación). Íbid.
- SSRF pinning + XFF (arriba).

**Cobertura EXISTENTE reutilizada como evidencia (no se reconstruye):**
- Idempotencia: 5 reclamos concurrentes misma key → 1 gana (`idempotency.e2e`).
- Cuota: 12 reservas concurrentes con límite 3 → exactamente 3 + rollback atómico sin huérfanos
  (`usage-mensual.e2e`).
- Números: 5 altas concurrentes con límite 2 → exactamente 2; cross-tenant aislado (`numeros-limite.e2e`).
- Dedup de eventos: 5 reentregas concurrentes → 1 fila (`events-store.e2e`).
- Checkout concurrente → `checkout_en_curso` anti doble-cobro (`fase12-billing.e2e`).
- Entrega: 5xx→retry→200, 4xx→DLQ terminal, rebinding send-time→DLQ, redelivery idempotente
  (`worker-inbound/handler.e2e`, `delivery-status.e2e`).
- Multi-tenant: aislamiento por workspace/número/evento (`multi-tenant-security.e2e`, `rls-isolation.e2e`).

**Límite honesto:** el flujo real contra Meta/Pub/Sub/Wompi vivos solo puede probarse contra
staging/sandbox (no destructivo en prod). Aquí se prueba con handlers reales + DB real + mocks de
la frontera externa. **NOT VERIFIED:** comportamiento contra Meta/Pub/Sub/Wompi reales en staging.

## 7. 17.8 — Release readiness gate

**SECURITY**
- auth (sesión / API key) — **PASS** (F8/F16; `auth.getUser`, hash+timingSafeEqual)
- authz / roles / workspace scope — **PASS** (F16; gate de rol + tenant derivado del contexto)
- tenant isolation — **PASS** (RLS + filtros app; e2e cross-tenant)
- API keys (hash, revocación, rotación) — **PASS** (F16)
- SSRF (rebinding incl.) — **PASS** (17.1 IP pinning + no redirects)
- HMAC firmas (in/out) — **PASS** (constant-time, F16)
- replay protection — **PASS** (tolerancia timestamp; F16)
- secrets — **PASS** (repo/logs limpios); valores en env **NOT VERIFIED** (consola)
- headers / CSP — **PASS** (Next)
- CORS — **PASS** (gateway sin CORS)
- open redirect `?next=` — **PASS** (F16)
- X-Forwarded-For anti-spoof — **PASS** (código, 17.2); nº de hops **NOT VERIFIED** (consola)

**RELIABILITY**
- idempotency — **PASS** (e2e concurrente)
- retries / DLQ — **PASS** (worker e2e)
- leases (jobs + entrega) — **PASS** (claim concurrente 17.6)
- out-of-order — **PASS** (billing "pago más reciente"; delivery monotónico)
- recovery — **PASS** (`crash-recovery`, barrido de reconciliación)

**BILLING**
- pricing server-side — **PASS** (checkout resuelve precio del catálogo)
- payment state / duplicate webhook / duplicate charge — **PASS** (dedup + orden + activación en transición; 17.7)
- dunning / downgrade / cancellation — **PASS** (F12 e2e billing ON 10/10)

**API**
- OpenAPI conformity — **PASS** (F14 conformidad)
- errors / rate limits / versioning / docs — **PASS** (F14)

**INFRA**
- Cloud Run — **NOT VERIFIED** (IAM/ingress/SA fuera del repo)
- Pub/Sub — **NOT VERIFIED** (OIDC push/DLQ/retry fuera del repo)
- Vercel — **PASS** parcial (crons + headers en repo); env/preview **NOT VERIFIED**
- Supabase — **PASS** (RLS/search_path)

**OBSERVABILITY**
- event logs / delivery attempts / metrics / audit — **PASS** (F13; auditoría append-only)

**OPERATIONS**
- cron auth — **PASS** (CRON_SECRET)
- retention — **PASS** (maintenance/retencion)
- alerts — **NOT VERIFIED** (no hay sistema de alertas en repo; recomendado para F18)
- recovery — **PASS** (replay/DLQ/reconciliación)

**ACCEPTED RISK (documentados):** vulnerabilidades de build-tooling/Business (17.3);
contenedores como root; dependencia del IAM de Cloud Run para el `/push` (sin OIDC en código).

## 8. 17.9 — Test matrix

| Suite | Resultado |
|---|---|
| Unit/source F12–F17 | **78/78 PASS** (billing 9, events 4, openapi 7, portal…, planes/landing 19, F16 security 15, secure-delivery 16, client-ip 8) |
| E2E F11/F12/F13/F15/F17 + gateway/worker | **74/74 PASS** (F11 16, F12 10, F13 6, F15 4, chaos 2, worker 11, delivery 7, gateway webhooks/outbound/multi-tenant) |
| Dependency audit | 7 vulns (0 critical, 0 en runtime Developer) — documentadas |
| TypeScript | 0 errores |
| ESLint | 0 errores (28 warnings preexistentes de estilo) |
| Build | PASS (Next 16.3.5) |

Suites **NO ejecutadas** en este cierre y por qué:
- E2E contra Meta/Pub/Sub/Wompi **reales**: requieren staging/sandbox con credenciales; no se
  ejecutan contra prod (no destructivo). Impacto: la frontera externa real no está validada aquí.
- Los `.e2e` se saltan solos sin `SUPABASE_URL`/`SERVICE_ROLE_KEY`; en esta corrida SÍ se
  ejecutaron con `--env-file=.env.local`.

---

## 9. Respuestas a los criterios de éxito

1. **¿SSRF por DNS rebinding?** No con la corrección 17.1 (IP pinning: conecta solo a la IP
   validada; rebinding → `ErrorDestinoNoSeguro` → DLQ). Verificado por test.
2. **¿Manipular X-Forwarded-For?** Ya no trivialmente (17.2 cuenta desde la derecha). El nº de
   hops confiables debe fijarse por config (NOT VERIFIED en consola).
3. **¿Dependencias vulnerables explotables?** No en el runtime de Developer. El crítico (Next) se
   corrigió; las 7 restantes son build-tooling/Business (ACCEPTED, documentadas).
4. **¿Cloud Run/Pub/Sub con permisos excesivos?** **NOT VERIFIED** — requiere consola (IAM/SA/OIDC
   no están en el repo). Recomendado como bloqueo de F18.
5. **¿Doble procesamiento?** No: leases atómicos (claim concurrente → 1) e idempotencia. Verificado.
6. **¿Idempotencia bajo concurrencia?** Sí resiste (e2e: misma key concurrente → 1 efecto).
7. **¿Retries/DLQ sobreviven fallos?** Sí (worker e2e 5xx→retry, 4xx/rebinding→DLQ, recovery).
8. **¿Billing resiste duplicados?** Sí: dedup por `provider_event_id` + activación solo en
   transición + orden por pago más reciente. Verificado (17.7).
9. **¿Aislamiento multi-tenant bajo carga?** Sí (e2e cross-tenant + RLS + concurrencia).
10. **¿Qué infra NO está verificada?** Cloud Run IAM/ingress, Pub/Sub OIDC/DLQ, Vercel env/preview,
    dominio del gateway, y el flujo contra Meta/Wompi reales. Todo listado como NOT VERIFIED.

---

## 10. Riesgos que permanecen

- **NOT VERIFIED (infra, consola):** Cloud Run IAM/ingress/SA, Pub/Sub OIDC push + DLQ/retry,
  Vercel prod/preview y valores de env, dominio del gateway. → **bloqueo de F18** (production readiness).
- **ACCEPTED (documentado):** vulnerabilidades de build-tooling/Business; contenedores root; `/push`
  sin OIDC en código; `GATEWAY_TRUSTED_PROXIES` requiere fijarse según topología real.
- **NOT VERIFIED (funcional):** flujo E2E contra Meta/Pub/Sub/Wompi reales (staging/sandbox).

## 11. Git

Rama `feature/developer-v1-fase17-hardening` (sobre `1b80b02`, Fase 16). Commits:

```
17.1 SSRF IP pinning · 17.2 XFF hardening · 17.3 Next 16.3.5 (critical fix) ·
17.6/17.7 gaps de concurrencia/caos · (ajuste) guard de redirects del ping · 17.9 closure
```
Working tree limpio salvo `supabase/.temp/` (untracked). **NO PUSH · NO MERGE · NO DEPLOY. `main` intacto.**

## 12. Para Fase 18 (Production Readiness / Deploy)
1. Verificar en consola: Cloud Run `--no-allow-unauthenticated` + SA por servicio + ingress;
   Pub/Sub OIDC push + DLQ/retry; separación prod/preview y env en Vercel; fijar
   `GATEWAY_TRUSTED_PROXIES`; confirmar dominio del gateway.
2. Aplicar hardening de imagen (`USER node`) validando el build; evaluar OIDC en `/push`.
3. E2E contra staging/sandbox (Meta/Wompi) y sistema de alertas/observabilidad de producción.
