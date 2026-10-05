# DuLabs Developer V1 — Fase 10 (Onboarding + Conexión de WhatsApp) — CLOSURE REPORT

**STATUS: CLOSED** — verificado sobre una conexión REAL en producción (2026-09-16).

Producto separado de DuLabs Business; portal propio en `/developer`. Esta fase cierra el onboarding y la conexión real de un número de WhatsApp de un cliente vía Meta Embedded Signup, con intercambio server-side del token, cifrado fail-closed y registro atómico respetando el límite del plan. No toca Business/AMORE ni el flujo/contratos ya cerrados.

## Alcance cerrado
Meta Embedded Signup (FB JS SDK, `response_type=code`, postMessage `WA_EMBEDDED_SIGNUP` con validación EXACTA de origin) → `POST /api/developer/whatsapp/connect` → intercambio server-side del `code` por token permanente + descubrimiento/verificación del WABA y número contra Graph API → cifrado del token (`secure-crypto`, FAIL-CLOSED) → `registrarNumeroConLimite` (atómico, Fase 7) → persistencia en `dulabs_dev_whatsapp_numbers` → respuesta con SOLO metadata pública (el token de Meta nunca toca el navegador).

## Conexión REAL validada (producción, read-only)
- **Número:** +57 311 7238568 · **Display Name:** Dulabs Ventas
- **phone_number_id (Meta):** `1359526083904105` · **WABA ID:** `1447966503807955`
- **Registro:** `dulabs_dev_whatsapp_numbers.id = a9b857d1-4367-44b2-bfa4-f3403e6e337e`
- **workspace_id:** `e311154e-cfbb-4a5c-882f-952fcacba4d8` (workspace Developer de `enviaraduvan@gmail.com`, membresía OWNER activa)
- **estado:** `conectado` · **created_at = updated_at:** `2026-09-16T19:40:27Z` (inserción única y limpia, sin reintentos/estado parcial)
- **Token de Meta:** almacenado **cifrado** (`meta_token_cifrado`, formato `dev1:`, AES-256-GCM; valor nunca expuesto). La proyección pública (`CAMPOS_PUBLICOS`) excluye la columna del token en todo listado/respuesta.
- **Duplicados:** ninguno (exactamente 1 fila para ese `phone_number_id`; único global por constraint).
- **Scoping por workspace:** el registro es visible con el workspace correcto y **no** visible con un workspace ajeno (lógica `obtenerNumeroDelWorkspace`, scoped por `workspace_id`).
- **Errores de runtime:** ninguno asociado a la conexión (registro creado, token cifrado, estado `conectado`). La suscripción de webhooks es best-effort y no revierte la conexión.
- **Disconnect (verificado en código, no ejecutado):** `whatsapp-numbers-store.ts::desconectarNumero` marca `estado='desconectado'` y borra `meta_token_cifrado`, scoped por `workspace_id + id`; **no** elimina la fila ni jobs/usage/eventos históricos.

## Incidente de producción resuelto durante el cierre
Antes de esta conexión, `POST /connect` fallaba con `500 encryption_unavailable` porque Vercel Production no tenía `DEVELOPER_TOKEN_ENCRYPTION_KEY` ni `KMS_KEY_NAME` (solo `TOKEN_ENCRYPTION_KEY`, de Business). No era un rechazo de Meta ni un bug de flujo: `secure-crypto` es FAIL-CLOSED y cortaba antes de tocar Meta.
- **Fix:** se configuró `DEVELOPER_TOKEN_ENCRYPTION_KEY` (clave estática AES-256, `dev1:`) en Vercel Production. KMS no aplica en Vercel (no es Cloud Run, sin credenciales GCP).
- **Protección permanente (commit `ca0ff34`, PR #43):** `scripts/validate-release-config.mts` corre antes de `next build` y **bloquea la release de producción (exit 1)** si falta la config criptográfica obligatoria de Business o Developer (las distingue). Endpoint READ-ONLY `GET /api/developer/diagnostics/crypto-status` reporta disponibilidad sin exponer secretos.

## Commits/deploys relevantes
- `443f674` — endurecimiento del origin del Embedded Signup y selección de número (revisión Fase 10).
- `d086e67` — release Developer V1 (PR #41) a `main`.
- `ca0ff34` / merge `6a0734a` (PR #43) — guard criptográfico de release.
- Deploy de producción `dulabs-r1uwc9w33…` → Ready, aliased a https://www.dulabs.co.

## Cierre
Fase 10 no se reabre por mejoras no críticas; cualquier mejora entra como nueva tarea/revisión.

**Siguiente fase del roadmap: FASE 11 — PLANS / PRICING / SUBSCRIPTIONS** (no iniciada en esta ejecución).
