# DuLabs Developer V1 — Fase 16: Security / Compliance / Hardening (cierre)

**Fecha:** 2026-09-17
**Rama:** `feature/developer-v1-fase16-security` (apilada sobre Fase 15; `main` intacto en `65cb842`)
**Estado:** ✅ Auditoría completa + correcciones confirmadas. **NO PUSH · NO MERGE · NO DEPLOY.**

> Metodología: **primero auditar (read-only), después corregir.** Cada hallazgo tiene
> evidencia concreta en el código/config. No se declaran vulnerabilidades hipotéticas.
> Tests funcionales verdes ≠ seguridad; por eso se añadieron tests adversariales.

---

## 1. Threat model

**Actores:** A) developer legítimo · B) developer malicioso autenticado · C) anónimo · D) API key robada · E) sesión robada · F) tenant→otro tenant · G) manipulación de requests · H) doble cobro · I) consumo masivo · J) SSRF vía webhook · K) replay/doble entrega · L) workers/retries/DLQ · M) cron/endpoints internos.

**Fronteras de confianza / flujos:**
```
Internet ─▶ Vercel/Next ─service_role─▶ Supabase        (dashboard: sesión Supabase Auth)
Internet ─▶ Gateway/Cloud Run ─API key─▶ Supabase       (API pública /api/v1: Bearer dl_live_)
Meta ────▶ Gateway ─X-Hub-Signature-256─▶ Pub/Sub ─▶ worker-inbound ─▶ webhook del Developer
Developer ▶ Dashboard ─▶ Billing ─▶ Wompi ─webhook(firma)─▶ subscription state
Vercel Cron ─Bearer CRON_SECRET─▶ cobro-recurrente / retención
```
Frontera crítica de egress: **worker-inbound → Internet** (SSRF). El backend corre con
`service_role` (bypassa RLS) → el aislamiento por tenant vive en la **capa de aplicación**
(filtros `workspace_id`/`account_id`) con **RLS como defensa en profundidad**.

---

## 2. Superficie auditada (read-only)

Endpoints: 25 rutas `/api/developer/*` (dashboard, sesión), 2 `/api/developers/*` (público),
7 handlers del gateway `/api/v1/*` (API key), webhook de Meta, webhook de Wompi, `cobro-recurrente`,
`maintenance/retencion`, `diagnostics/crypto-status`, worker-inbound (entrega).

Verificado con evidencia (**seguro salvo lo listado en §3**):

- **AuthN/AuthZ** (`dev-api-http.ts`, `session-workspace.ts`): identidad vía `auth.getUser`; el header `X-Dulabs-Workspace` se valida contra las membresías reales del usuario (nunca se confía en un workspace_id del cliente); gate de rol OWNER/ADMIN/MEMBER coherente en todas las rutas.
- **IDOR / tenant isolation**: `numbers/[id]`, `members/[id]`, `api-keys/[id]`, `events/[id]/replay`, subscription/* → los stores filtran por `workspace_id`/`account_id` en el WHERE; el `accountId` se deriva del contexto (nunca del body). Cross-tenant → `not_found`/`forbidden`.
- **API keys** (`api-keys.ts`, `api-keys-store.ts`): SHA-256 at rest (nunca plaintext), `timingSafeEqual`, lookup O(1) por hash (sin enumeración), revocación efectiva en el momento de autenticar, prefijo de 12 chars, límite anti-fuerza-bruta por IP, error genérico "inválida o revocada".
- **Billing** (`checkout`, `billing/webhook`, `cobro-recurrente`): precio/plan/monto/FX **server-side** (catálogo + env); el webhook Wompi verifica firma → registra → dedup por checksum → orden (pago más reciente) → efecto; el monto/plan salen de la **fila de pago persistida**, nunca del payload; activación idempotente solo en transición a APPROVED; Enterprise sin checkout self-service.
- **Idempotencia + límites** (outbound): reserva **atómica** job+idempotency+usage con advisory lock por cuenta → sin doble-efecto ni bypass de cuota por concurrencia; `idempotency_conflict` en misma key con payload distinto.
- **Firmas**: saliente `HMAC(ts.body)` constant-time + tolerancia 5 min (anti-replay); Meta `HMAC(body crudo)` constant-time pre-parse.
- **Claims/lease** (jobs y entregas): UPDATE atómico con `lease_id`+expiry → dos workers no procesan el mismo evento.
- **Cron/diagnóstico**: `CRON_SECRET`/`DIAGNOSTICS_SECRET` constant-time, **fail-closed** (sin env → 403).
- **Supabase**: RLS habilitada en **17 tablas** `dulabs_dev_*`; **16/16** funciones `SECURITY DEFINER` con `set search_path = public` (sin escalada por search_path).
- **Headers/CSP/CORS**: Next fija HSTS(preload)/CSP/XFO/nosniff/Referrer-Policy/Permissions-Policy; CSP restringe orígenes a Meta/Wompi/Supabase; el gateway (API server-to-server) **no** emite CORS → sin `ACAO:*` con credenciales.
- **Secretos/logs/`NEXT_PUBLIC_*`**: solo claves públicas expuestas (Wompi/Supabase públicas, IDs de Meta/analytics); sin secretos hardcodeados en el repo; logs no imprimen tokens/keys/payloads sensibles.
- **Open redirect `?next=`**: bloquea `//`, `/\` y no-`/`.

---

## 3. Vulnerabilidades / hardening (con evidencia y severidad)

### 🔴 P1 — SSRF por redirect en la entrega de webhooks — **CORREGIDO**
- **Evidencia:** `services/worker-inbound/handler.ts` (fetch de entrega) no fijaba `redirect`. El SSRF guard valida la IP de `webhook.url` **antes** del fetch, pero `fetch` sigue 3xx por defecto → el destino final lo elige el endpoint del Developer.
- **Escenario (actor J):** webhook `https://evil.tld/hook` (IP pública, pasa el guard) responde `302 → http://169.254.169.254/...` o `http://10.x`; el worker (Cloud Run) seguía el redirect → **SSRF a metadata/red interna** con el egress del worker.
- **Corrección:** `redirect: "manual"` en el fetch de entrega (idéntico criterio al ping). Un 3xx queda no-`ok` y no reintentable → **DLQ terminal**. Sin migración; sin impacto en Business/AMORE.
- **Test:** `fase16-security.test.ts` (guard bloquea metadata/interno + source-guard de `redirect:"manual"` en worker y ping). Regresión de entrega: `delivery-status.e2e` + `webhooks-handler.e2e` 8/8.

### 🟠 P2 — DNS rebinding (TOCTOU) en la validación SSRF — **RIESGO RESIDUAL (documentado/aceptado)**
- **Evidencia:** `ssrf-guard.ts` resuelve DNS y valida; luego `fetch(webhook.url)` re-resuelve por su cuenta (ping y worker). Un DNS atacante con TTL bajo puede devolver IP pública al guard e interna al fetch.
- **Por qué no se corrige ahora:** el fix robusto es pinnear la IP validada (dispatcher `undici` con `lookup` propio que re-valida por conexión) — invasivo y con riesgo de regresión en TLS/SNI. Con **P1 corregido** el vector práctico principal (redirect) queda cerrado, y el guard ya valida **todas** las IPs resueltas.
- **Recomendación (F17/F18):** IP pinning en el fetch de entrega/ping. Aceptado como residual para F16.

### 🟡 P3 — `X-Forwarded-For` spoofeable en el gateway — **RIESGO ACEPTADO (documentado)**
- **Evidencia:** `services/gateway/server.ts` toma `xff.split(",")[0]` (token izquierdo, controlable por el cliente). Afecta solo el throttle anti-fuerza-bruta por IP (`dev-auth-fail`).
- **Impacto:** bajo — las API keys son de 32 bytes (fuerza bruta inviable) y los demás límites son por workspace, no por IP. **Recomendación:** derivar la IP de la posición confiable del XFF de Cloud Run.

### 🟡 P3 — Secreto de diagnóstico en query param — **CORREGIDO (aditivo)**
- **Evidencia:** `diagnostics/crypto-status` leía solo `?key=` (secreto en URL → logs/referrer).
- **Corrección:** ahora acepta también `Authorization: Bearer` (preferido), manteniendo `?key=` por compatibilidad. Constant-time; solo reporta el mecanismo, nunca valores.

### ⚪ Nota (no explotable) — sesgo módulo en base62 de API keys
- `api-keys.ts` usa `byte % 62`: sesgo marginal, pero quedan **>180 bits** de entropía. Sin acción (cambiarlo no aporta seguridad y tocaría la generación de claves).

---

## 4. Tests creados (adversariales)

`lib/developer/fase16-security.test.ts` — **15/15 PASS**:
- SSRF: metadata (169.254.169.254), RFC1918 (10/172.16/192.168), loopback, IPv6 `::1`, IPv4-mapped a interno, IP literal directa, **rebinding multi-IP** (una interna ⇒ rechaza), destino público permitido, esquema no-https rechazado.
- SSRF por redirect (P1): worker + ping usan `redirect:"manual"`.
- Firma de webhook: válida aceptada; **replay** (ts viejo) rechazado; **tampering** (body alterado) rechazado; secreto equivocado rechazado; firma de longitud inválida no crashea.
- Cron: `cobro-recurrente` sin `Authorization` y `retencion` con secreto equivocado → **403** antes de tocar la DB.

Añadido a `scripts/test-flow-manifest.txt`.

---

## 5. Regresión — PASS

| Suite | Resultado |
|---|---|
| Fase 11 (E2E) | 16/16 ✓ |
| Fase 12 (unit / billing ON) | 9/9 ✓ / 10/10 ✓ |
| Fase 13 (unit / E2E) | 4/4 ✓ / 6/6 ✓ |
| Fase 14 | 7/7 ✓ |
| Fase 15 (unit+source / e2e) | 19/19 ✓ / 4/4 ✓ |
| **Fase 16 (security)** | **15/15 ✓** |
| Worker/gateway delivery e2e (seguridad del fix P1) | 8/8 ✓ |
| TypeScript / ESLint / Build | 0 / 0 / PASS ✓ |

Totales de esta corrida: **54 unit/source + 36 e2e + 8 delivery = PASS**. Ninguna prueba se
ignoró ni se marcó como "preexistente".

---

## 6. Migraciones

**Ninguna.** Las correcciones (P1 redirect, P3 header de diagnóstico) son solo código de
aplicación. No se requiere SQL, no hay cambios de esquema, no hay migración destructiva.

---

## 7. Business / AMORE

**Sin cambios.** Todas las correcciones son en superficie Developer
(`services/worker-inbound`, `app/api/developer/diagnostics`). No se detectó riesgo transversal
que exija tocar Business/AMORE.

---

## 8. Estado de infraestructura y secretos

- **Infraestructura:** Gateway sin CORS (correcto server-to-server); worker con timeout 10s,
  SSRF send-time + redirect:"manual"; claims con lease atómico + DLQ. RPCs `SECURITY DEFINER`
  con `search_path` fijo. **Pendiente de verificación fuera del repo** (no auditable en código):
  IAM/service accounts de Cloud Run, autenticación push de Pub/Sub, y el dominio real del gateway.
- **Secretos:** sin secretos en el repo; `NEXT_PUBLIC_*` solo con valores públicos; logs sin
  material sensible. Clasificación: PUBLIC (`NEXT_PUBLIC_*`), SERVER (`SUPABASE_SERVICE_ROLE_KEY`,
  `META_APP_SECRET`, `DEVELOPER_TOKEN_ENCRYPTION_KEY`, `DEVELOPER_BILLING_*`), SECRET (`CRON_SECRET`,
  `DIAGNOSTICS_SECRET`, Wompi private), gestionados por entorno (Vercel/Cloud Run). Ningún valor se
  muestra en este reporte.

---

## 9. Riesgos que permanecen

- **P2 DNS rebinding (residual):** requiere IP pinning en el fetch (F17/F18).
- **P3 XFF spoofing (aceptado):** impacto bajo por entropía de las keys; ajustar extracción de IP.
- **Infra no auditable en código:** IAM Cloud Run, Pub/Sub push auth, separación prod/preview de
  Vercel, y dependencias (no se corrió `npm audit` en esta fase) → llevar a F17/F18.

---

## 10. Git

Rama `feature/developer-v1-fase16-security` (sobre `6697783`, Fase 15). Commits:

```
6057130 test(developer): Fase 16.6 — tests adversariales de seguridad
556b57c fix(developer): Fase 16.3 — SSRF hardening (P1 redirect + P3 diagnostics header)
```
(+ este closure report como 16.7.)

Working tree limpio salvo `supabase/.temp/` (untracked, ajeno). **NO PUSH · NO MERGE · NO DEPLOY. `main` intacto.**

---

## 11. Criterio de cierre — cumplido

Threat model ✓ · endpoints auditados ✓ · tenant isolation ✓ · authz ✓ · API keys ✓ · webhook
security ✓ · SSRF ✓ (P1 corregido) · idempotencia ✓ · billing ✓ · usage/limits ✓ · cron ✓ ·
Supabase (RLS + search_path) ✓ · headers/CORS ✓ · secrets/logs ✓ · tests adversariales
ejecutados ✓ · vulnerabilidades corregidas o documentadas ✓ · regresión verde ✓ · closure report ✓.

**Qué intentamos romper:** cross-tenant/IDOR, escalada de rol, abuso de API key, replay y
tampering de firma, doble cobro / manipulación de precio, bypass de cuota por concurrencia, SSRF
(metadata/interno/rebinding/redirect), acceso a cron sin secreto, fuga de secretos/PII.
**Qué encontramos:** 1×P1 (SSRF redirect), 2×P3, 1×P2 residual, 1 nota. **Qué corregimos:** P1 +
P3-diagnostics. **Qué permanece:** P2 (rebinding), P3-XFF, verificación de infra fuera del repo.
