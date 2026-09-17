# DuLabs Developer V1 — Fase 20: Remediación B2 (Crypto) — Closure Report

**Fecha:** 2026-09-17 · **Rama:** `feature/developer-v1-fase20-remediacion-b2` (derivada de `feature/developer-v1-fase20-production`)
**Alcance:** cerrar **B2** (incompatibilidad de cifrado entre runtimes). B1/B3 se reportan como estado, fuera del alcance de código de este ciclo.
**Decisión aprobada:** **KMS canónico (`dev2:`)**. Sin push / merge / deploy / cambios en `main` / cambios en producción.

## 1. Estado inicial

Auditoría Fase 20 (`docs/DULABS_DEVELOPER_V1_PHASE_20_PRODUCTION_AUDIT.md`) detectó:
- **B1** — Developer V1 no desplegado (404 en todas las superficies). *(No abordado en este ciclo.)*
- **B2** — Incompatibilidad de cifrado entre Vercel (escribe `dev1:` estático) y Cloud Run (escribe/lee `dev2:` KMS); ambos formatos existen en prod; sin cobertura de lectura cruzada. **HIGH.** *(Objetivo de este ciclo.)*
- **B3** — `api.dulabs.dev` NXDOMAIN. *(No abordado en este ciclo.)*

## 2. B1 — estado (sin cambios este ciclo)

**PENDING (deploy).** Requiere integrar la rama a release y desplegar (fuera de alcance B2). **Dependencia dura:** con el guard reforzado (§10), un build de producción en Vercel quedará **bloqueado** hasta que Vercel tenga el canónico `dev2` (ver B2 infra). Es decir, **B2-infra es precondición de B1**.

## 3. B3 — estado (sin cambios este ciclo)

**BLOCKED / NOT VERIFIED.** `api.dulabs.dev` no existe en DNS. Procedimiento reproducible pendiente (registro DNS + domain mapping Cloud Run + TLS). No abordado en este ciclo (B2-only).

## 4. B2 — root cause (evidencia)

Mapa real (mismo `@/lib/developer/secure-crypto` en ambos runtimes):

| Secreto | Escribe (cifra) | Lee (descifra) |
|---|---|---|
| `meta_token_cifrado` | Vercel `app/api/developer/whatsapp/connect` → `dev1:` · Cloud Run `services/gateway/management-handler` → `dev2:` | Cloud Run `services/worker-outbound/handler` (envío) + `services/gateway/outbound-handler` |
| `secret_cifrado` (webhook) | Vercel `app/api/developer/webhooks/route` → `dev1:` · Cloud Run `management/webhooks-handler` → `dev2:` | Vercel `app/api/developer/webhooks/ping` · Cloud Run `services/worker-inbound/handler` |

**Causa raíz:** `cifrarSecretoDev` elegía el mecanismo IMPLÍCITAMENTE por presencia de `KMS_KEY_NAME`. Vercel (solo `DEVELOPER_TOKEN_ENCRYPTION_KEY`) escribía `dev1:`; Cloud Run (solo `KMS_KEY_NAME`) escribía/leía `dev2:`. Como ambos runtimes **leen** ambos secretos y tenían material de clave disjunto, un `dev1:` (Vercel) no lo podía descifrar Cloud Run y un `dev2:` (Cloud Run) no lo podía descifrar Vercel. El release guard trataba KMS y static como **intercambiables** (`ok` = "hay alguna clave"), por eso el hueco pasó silencioso.

**Evidencia en prod (solo prefijos, nunca valores):** `dulabs_dev_whatsapp_numbers.meta_token_cifrado` tenía un `dev1:` y un `dev2:`; `dulabs_dev_webhook_configs.secret_cifrado` un `dev2:`.

**Recuperabilidad de datos existentes → Categoría A (recuperables):** `dev1:` = AES-256-GCM con `DEVELOPER_TOKEN_ENCRYPTION_KEY` (Vercel prod la tiene); `dev2:` = envelope KMS (Cloud Run tiene acceso). No hay datos irrecuperables → NO se requiere migración destructiva.

## 5. Solución implementada (código)

1. **Formato canónico de escritura EXPLÍCITO y fail-closed** (`lib/developer/secure-crypto.ts`):
   - `DEVELOPER_TOKEN_ENCRYPTION_MODE = "kms" | "static"` fija el formato. Sin él, se infiere (kms si hay `KMS_KEY_NAME`; static si hay clave estática). Valor inválido → `ClaveNoDisponibleError`.
   - `modo "kms"` → `cifrarConKms` (`dev2:`). Si falta `KMS_KEY_NAME` o KMS es inalcanzable → **FAIL CLOSED** (nunca cae a `dev1:`). **La presencia de la clave estática ya NO desvía a `dev1:`** un runtime configurado para KMS.
2. **Lectura por prefijo (compat)** intacta: `dev2:`→KMS, `dev1:`→estático legacy, otro→error seguro. Un runtime que lea datos existentes durante la transición debe tener AMBAS claves.
3. **Proveedor KMS inyectable** (`ProveedorKms` + `_setProveedorKmsParaTests`): la única superficie que habla con GCP es envolver/desenvolver la DEK. Permite testear el roundtrip `dev2:` de forma determinista sin credenciales. Comportamiento de producción idéntico (proveedor real por defecto).
4. **Vercel → KMS vía WIF** (`estrategiaAuthKms` + `crearAuthClientKms`): si `GCP_WORKLOAD_IDENTITY_AUDIENCE` + `GCP_WORKLOAD_IDENTITY_SA_EMAIL` + `VERCEL_OIDC_TOKEN` están presentes, construye un `IdentityPoolClient` con `subjectTokenSupplier` (lee el OIDC token de Vercel) — **sin service-account key estática**. En Cloud Run cae a ADC (SA adjunta).
5. **Introspección de cobertura**: `formatoCanonicoEscritura()`, `puedeLeerFormato("dev1"|"dev2")`, `coberturaLecturaCompleta()`, `cifradoCanonicoDisponible()`.
6. **Connect route** (`app/api/developer/whatsapp/connect`): el guard pasó de `claveMaestraDisponible()` a `cifradoCanonicoDisponible()` — fail-closed contra el canónico, no contra "cualquier clave".

## 6. Compatibilidad

- Ningún contrato público `/api/v1` cambió. Ninguna semántica de autenticación cambió.
- Ningún dato existente se tocó, borró ni invalidó. Los `dev1:` legacy siguen siendo legibles por cualquier runtime que tenga la clave estática.
- Comportamiento local/CI sin cambios: sin modo explícito + clave estática → infiere `static` → escribe `dev1:` (los tests existentes siguen verdes).

## 7. Tests

- `lib/developer/secure-crypto.test.ts`: +19 casos (dev2 nuevo, roundtrip dev2, dev1 legacy, dev1/dev2 inválidos, prefijo desconocido, ciphertext corrupto, DEK incorrecta, modo kms sin KMS fail-closed, KMS inaccesible, sin fugas de secretos en errores, modo inválido, nunca-vuelve-a-dev1, lectura cruzada, solo-KMS, transición, introspección, estrategia WIF).
- `lib/config/release-crypto-config.test.ts`: +4 casos (canónico dev2 + cobertura; **fix B2**: modo kms sin KMS → !ok aunque exista static; transición completa sin advertencias; modo static explícito). Los 7 casos previos siguen pasando (contrato preservado).

**Resultados (evidencia real, este ciclo):**
- Suites crypto aisladas: **40/40 PASS**.
- `npm run test:flow`: **3566/3566 PASS, 0 fail** (antes 3544; +22). — PASS
- `tsc --noEmit`: **0 errores**. — PASS
- `npm run lint`: **0 errores, 33 warnings** (idéntico al baseline; 0 nuevos). — PASS
- `npm run build`: **Compiled successfully** (guard corre y reporta cobertura). — PASS
- `npm audit`: **7 total / 5 runtime, 0 critical** (sin cambios; no se añadieron deps).

## 8. Seguridad

- Fail-closed en cifrado y descifrado; sin fallback silencioso entre mecanismos; nunca texto plano.
- Sin plaintext/token/secret/ciphertext-completo/clave/credencial en logs ni en mensajes de error (test dedicado).
- Sin secretos en código, tests ni commits. Sin service-account key estática (WIF).
- Mínimo privilegio KMS: `cryptoKeyEncrypterDecrypter` a nivel de la CryptoKey (ambos runtimes cifran y descifran — Vercel descifra en `webhooks/ping`, por eso necesita ambos; ver §11). No se tocaron SSRF/XFF (sin hallazgo ligado a B2).

## 9. Infraestructura pendiente (NOT VERIFIED — requiere consola GCP/Vercel)

El código está listo; la **habilitación de KMS desde Vercel es externa** y no verificable desde el repo:

- **GCP (una vez):**
  - Crear Workload Identity Pool + Provider que confíe en el emisor OIDC de Vercel (`https://oidc.vercel.com/<team>`), con `attribute-condition` restringiendo al proyecto/entorno Vercel correctos.
  - Crear SA dedicada `dulabs-vercel-kms@dulabs-developer-v1.iam.gserviceaccount.com`.
  - `gcloud kms keys add-iam-policy-binding dulabs-developer-master-key --location=us-central1 --keyring=dulabs-developer-keyring --member="serviceAccount:dulabs-vercel-kms@..." --role="roles/cloudkms.cryptoKeyEncrypterDecrypter"`
  - Permitir al pool impersonar la SA: `gcloud iam service-accounts add-iam-policy-binding dulabs-vercel-kms@... --role="roles/iam.workloadIdentityUser" --member="principalSet://iam.googleapis.com/projects/<N>/locations/global/workloadIdentityPools/<POOL>/*"`
  - **Cloud Run (lectura legacy):** añadir `DEVELOPER_TOKEN_ENCRYPTION_KEY` (misma clave estática de Vercel) a gateway + worker-inbound + worker-outbound + reconciliation, para leer `dev1:` durante la transición. (Ya tienen KMS.)
- **Vercel (Production):** habilitar OIDC del proyecto; setear `DEVELOPER_TOKEN_ENCRYPTION_MODE=kms`, `KMS_KEY_NAME=projects/dulabs-developer-v1/locations/us-central1/keyRings/dulabs-developer-keyring/cryptoKeys/dulabs-developer-master-key`, `GCP_WORKLOAD_IDENTITY_AUDIENCE`, `GCP_WORKLOAD_IDENTITY_SA_EMAIL`, y **conservar** `DEVELOPER_TOKEN_ENCRYPTION_KEY` (lectura legacy).
- **Verificación viva (tras configurar):** `GET /api/developer/diagnostics/crypto-status` (Bearer `DIAGNOSTICS_SECRET`) debe devolver `mecanismo=kms`, `formato_canonico_escritura=dev2`, `puede_leer_dev1=true`, `puede_leer_dev2=true`, `cobertura_lectura_completa=true`, `advertencias=[]`.

## 10. Migración de datos legacy `dev1:` (plan por fases, NO ejecutado)

- **Fase A** — ambos formatos legibles (código + claves en ambos runtimes). *(código listo)*
- **Fase B** — todas las nuevas escrituras → `dev2` (`MODE=kms`). *(código listo)*
- **Fase C** — identificar registros `dev1:` restantes: `select id from dulabs_dev_whatsapp_numbers where meta_token_cifrado like 'dev1:%'` (+ `dulabs_dev_webhook_configs.secret_cifrado`). READ-ONLY.
- **Fase D** — re-cifrado explícito y reversible `dev1→dev2` (script operacional dedicado, con backup/trazabilidad, en un entorno con AMBAS claves). **NO** durante requests normales; **NO** borrado automático de `dev1`. *(fuera del alcance de este ciclo; requiere acceso productivo controlado)*

## 11. Riesgos

- **Reachability KMS no verificable localmente** (sin creds): el WIF de Vercel podría fallar en runtime pese a tipar/compilar. Mitigación: `crypto-status` como smoke antes de exponer el flujo; fail-closed no persiste tokens ilegibles.
- **Guard más estricto bloquea el build de producción** hasta configurar KMS en Vercel (intencional; es la precondición de B1).
- **Vercel necesita encrypt+decrypt** (por `webhooks/ping`), no solo encrypt → no se pudo separar el privilegio a solo-encrypt. Documentado.
- **Ventana de transición**: mientras existan `dev1:`, todo runtime lector debe tener la clave estática; si se retira antes de migrar, esos registros dejan de leerse (fail-closed, no corrupción).

## 12. Rollback

- Código: revertir la rama (no está mergeada ni desplegada).
- Config: quitar `DEVELOPER_TOKEN_ENCRYPTION_MODE` (vuelve a inferencia) — pero eso reintroduce B2; preferible mantener el código y solo ajustar env.
- Runtime: los prefijos `dev1/dev2` son auto-describibles; mantener ambas claves en los lectores evita cualquier pérdida de acceso ante un rollback parcial.

## 13. Checklist de deployment (para cuando se autorice B2-infra + B1)

1. GCP: WIF pool/provider + SA `dulabs-vercel-kms` + binding KMS encrypterDecrypter + workloadIdentityUser.
2. Cloud Run: añadir `DEVELOPER_TOKEN_ENCRYPTION_KEY` (lectura legacy) a los 4 servicios.
3. Vercel: OIDC on + `DEVELOPER_TOKEN_ENCRYPTION_MODE=kms` + `KMS_KEY_NAME` + `GCP_WORKLOAD_IDENTITY_*` + conservar clave estática.
4. Verificar `crypto-status` = kms/dev2/cobertura completa en ambos runtimes.
5. (Transición) migrar `dev1→dev2` (Fase D) cuando haya ventana controlada.
6. Recién entonces: build de producción (guard pasa) → deploy (B1).

## 14. Archivos modificados (este ciclo)

- `lib/developer/secure-crypto.ts` — canónico dev2 explícito, proveedor KMS inyectable, WIF, introspección.
- `lib/config/release-crypto-config.ts` — `ok`=canónico-escribible; campos de cobertura + advertencias.
- `scripts/validate-release-config.mts` — bloqueo en producción si no-dev2; muestra cobertura/advertencias.
- `app/api/developer/diagnostics/crypto-status/route.ts` — expone formato canónico + cobertura de lectura.
- `app/api/developer/whatsapp/connect/route.ts` — guard usa `cifradoCanonicoDisponible()`.
- `lib/developer/secure-crypto.test.ts`, `lib/config/release-crypto-config.test.ts` — +23 tests.
- `.env.example` — `DEVELOPER_TOKEN_ENCRYPTION_MODE` + variables WIF documentadas.
- `docs/DULABS_DEVELOPER_V1_PHASE_20_REMEDIATION_REPORT.md` — este reporte.

**Commits:** ninguno todavía (pendiente de tu revisión, según la regla 14).

## 15. Estado final

| Bloqueador | Código | Infraestructura |
|---|---|---|
| **B2** | **PASS** (canónico dev2, compat lectura, fail-closed, guard/diagnóstico, 23 tests, regresión verde) | **NOT VERIFIED / BLOCKED** — falta WIF en GCP + envs en Vercel/Cloud Run (§9). No se puede verificar KMS-desde-Vercel sin esa config. |
| **B1** | — | **PENDING (deploy)** — depende de B2-infra (guard lo exige). |
| **B3** | — | **BLOCKED / NOT VERIFIED** — DNS `api.dulabs.dev` inexistente. |

**B2 NO se declara completamente resuelto**: el **código = PASS**, pero la **infraestructura (Vercel→KMS) = NOT VERIFIED** hasta ejecutar la configuración externa de §9/§13 y confirmar `crypto-status`.
