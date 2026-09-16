# DuLabs Developer V1 — Fase 2: Data Model + Security

**Estado de esta fase: IN PROGRESS** (bloqueada únicamente en aplicar la migración a producción — ver sección 8 "Bloqueadores"). No se declara `FROZEN` ni `READY FOR REVIEW` hasta tener evidencia real de los 6 tests de aislamiento RLS y de toda la suite E2E corriendo contra Postgres, tal como exige el brief ("no simular seguridad").

Continúa directamente sobre Fase 1 (`docs/DULABS_DEVELOPER_V1_PHASE_1_ARCHITECTURE.md`, estado `READY FOR AUDIT`, sin cambios estructurales en esta fase). Nada de Fase 3 (Cloud Run / Pub/Sub / KMS real) se toca ni se simula acá.

---

## 1. Decisión de fondo: qué es un "workspace"

Developer V1 **no crea una tabla `workspaces` nueva**. Un workspace de Developer ES un tenant de DuLabs — el mismo modelo `dulabs_miembros_equipo` / `auth.users` que ya usa Business. `workspace_id` en las 6 tablas nuevas de abajo **es** `tenant_id`/`id_tenant` en el resto del sistema.

Razón: evitar duplicar el sistema de identidad/auth/equipo que ya existe, probado y en producción. El desarrollador que usa Developer V1 se autentica igual que un usuario de Business (Supabase Auth + `dulabs_miembros_equipo`); lo único nuevo es qué tablas puede ver ese tenant.

---

## 2. Modelo de datos — ERD conceptual

```
dulabs_miembros_equipo (YA EXISTE, Business)
        │ tenant_id = workspace_id
        │
        ├──< dulabs_dev_api_keys
        │
        ├──< dulabs_dev_whatsapp_numbers ──< dulabs_dev_webhook_configs (1:1 por número)
        │             │
        │             └──< dulabs_dev_jobs ──< dulabs_dev_usage_ledger (1:1 por job)
        │                        │
        │                        └──< dulabs_dev_events (job_id opcional)
        │
dulabs_dev_idempotency_keys (Fase 1, sin FK hacia jobs — ver sección 5)
```

## 3. Tablas

### 3.1 `dulabs_dev_api_keys`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `workspace_id` | uuid not null | tenant dueño |
| `name` | text not null | etiqueta legible para el desarrollador |
| `key_hash` | text not null | SHA-256 de la key completa, **único global** |
| `prefix` | text not null | primeros 12 chars (`dl_live_XXXX`) para reconocimiento visual, insuficiente para reconstruir la key |
| `created_at`, `last_used_at`, `revoked_at` | timestamptz | `revoked_at` no nulo = inválida; no se borra fila (auditoría) |

**Índices:** `UNIQUE(key_hash)` global (no compuesto con `workspace_id` — una request entrante solo trae la key, no el workspace; el índice único es lo que permite resolver "¿de quién es este hash?" en O(1), y de paso garantiza estructuralmente que una key nunca puede pertenecer a dos workspaces). Índice parcial `(workspace_id) where revoked_at is null` para listar keys activas.

### 3.2 `dulabs_dev_whatsapp_numbers`

Números de WhatsApp de los **clientes del desarrollador** (no del desarrollador mismo). `estado`: `pendiente | conectado | desconectado | error`. `meta_token_cifrado` cifrado con `secure-crypto.ts`, nulo mientras el número está `pendiente`.

**Índices:** `UNIQUE(phone_number_id)` global — un `phone_number_id` de Meta es único en todo Meta, estructuralmente no puede pertenecer a dos workspaces. Esto es lo que hace imposible, a nivel de base de datos, que un workspace reclame un número que ya conectó otro.

### 3.3 `dulabs_dev_webhook_configs`

`whatsapp_number_id` FK a la tabla anterior (`on delete cascade`). `secret_cifrado` (HMAC secret cifrado). `UNIQUE(whatsapp_number_id)` — un webhook por número, estructural.

### 3.4 `dulabs_dev_jobs`

Respaldo persistente de la máquina de estados pura `lib/developer/outbound-state-machine.ts` (Fase 1, sin modificar). `status` y `physical_outcome` con `CHECK` reflejando exactamente los valores que la máquina de estados produce. `lease_id`/`locked_at` para ownership (sección 4). `version_token bigint` — contador optimista, incrementado en cada mutación real: sirve de CAS de ownership Y de guardia de monotonicidad (un `UPDATE` con `version_token` viejo simplemente no matchea ninguna fila).

**Índices:** parcial `(next_attempt_at) where status='retry_pending'` (consulta real de un Worker: "dame los jobs listos para reintentar"), parcial `(status) where status='reconciliation_pending'` (consulta de reconciliación), y `workspace_id`.

### 3.5 `dulabs_dev_usage_ledger`

`UNIQUE(job_id)` — la garantía anti-doble-cobro pedida explícitamente: un job jamás puede tener dos filas de ledger. `estado`: `reservado → confirmado | liberado`, siempre transición sobre la misma fila (`UPDATE`), nunca un `INSERT` nuevo.

### 3.6 `dulabs_dev_events`

Log append-only. `UNIQUE(event_id)` — deduplicación real contra la entrega at-least-once de Pub/Sub; reentregar el mismo `event_id` nunca produce una segunda fila. La protección de monotonicidad del *estado* del job vive en `dulabs_dev_jobs.version_token`, no acá — este log es trazabilidad/auditoría, no la fuente de verdad del estado.

---

## 4. Ownership / leases (jobs)

`lib/developer/jobs-store.ts::adquirirLease` hace un CAS real: `UPDATE ... WHERE id=:job AND workspace_id=:ws AND (lease_id IS NULL OR locked_at < :umbral_vencimiento) RETURNING *`. Nunca se asume ownership por una lectura previa — se comprueba si el `UPDATE` devolvió fila. `LEASE_DURACION_MS = 60_000`: un lease sin refrescar más de 60s se considera vencido y **otro** Worker puede hacer takeover (cubre el caso "el Worker que tenía el job murió sin liberar").

`aplicarEventoJob` es el único punto real de mutación de un job, con dos capas de protección obligatorias:
1. **Ownership**: el `UPDATE` exige `lease_id = <el que trae el caller>`.
2. **Validez de transición**: se le pregunta a `transicionar()` (Fase 1) si el evento es válido, antes de tocar la base — nunca se persiste un estado que la máquina de estados no autorizó.

Ambas verificaciones se combinan en un único `UPDATE ... WHERE lease_id=:lease AND version_token=:version` — si no vuelve fila, el motivo es siempre `sin_ownership` (perdió el lease, o alguien más ya mutó el job entre la lectura y el intento de escritura).

---

## 5. Decisión: sin FK de `dulabs_dev_idempotency_keys` hacia `dulabs_dev_jobs`

`dulabs_dev_idempotency_keys` es de Fase 1, con 56/56 tests ya en verde. Agregarle una foreign key hacia `dulabs_dev_jobs` (tabla nueva de esta fase) habría significado alterar una tabla cuyo contrato ya está probado y cerrado — riesgo innecesario. En su lugar, `crearJobConIdempotencia` (Fase 2, `lib/developer/jobs-store.ts`) es la función nueva que conecta ambas tablas **hacia adelante**: reclama la idempotencia (Fase 1, sin tocar) y crea la fila de job con el mismo `id`, de forma atómica desde el punto de vista del caller (tolera `23505` como condición de carrera benigna si dos requests llegaran a competir).

---

## 6. Seguridad

### 6.1 RLS — capas reales, no teatro

Las 6 tablas tienen RLS habilitado y **una sola política**: `for select to authenticated using (workspace_id = public.dulabs_tenant_del_usuario())`. Deliberadamente **sin** políticas de `INSERT`/`UPDATE`/`DELETE` — toda mutación pasa exclusivamente por el backend con `service_role` (que ignora RLS por diseño de Supabase).

Esto significa que el valor protector real de estas políticas es un **segundo cinturón de seguridad**, no la única barrera: protege contra (a) un bug futuro de aplicación que ejecute una consulta bajo contexto `authenticated` en vez de `service_role`, o (b) una futura feature que exponga consultas directas del cliente vía PostgREST. Documentado así explícitamente para no sobrevender qué protege RLS aquí — el backend ya filtra por `workspace_id` en cada función de `lib/developer/*-store.ts` independientemente de RLS.

`public.dulabs_tenant_del_usuario()` (Fase 0 de Business, `SECURITY DEFINER`) se reusa sin modificar — resuelve el tenant activo del usuario autenticado vía `dulabs_miembros_equipo`.

### 6.2 Secretos

- Token de Meta (`whatsapp_numbers.meta_token_cifrado`) y secreto de webhook (`webhook_configs.secret_cifrado`): cifrados con `lib/developer/secure-crypto.ts` (Fase 1) — AES-256-GCM, fail-closed, prefijo `dev1:`, nunca comparte clave con `lib/crypto.ts` de Business. La conexión real a Google Cloud KMS (envelope encryption) queda pendiente de Fase 3 — no simulada.
- API keys: `key_hash` es SHA-256 de un solo sentido, estructuralmente irrecuperable — nunca se "descifra" para volver a mostrarla.

### 6.3 SSRF

`configurarWebhook` llama `validarUrlWebhookSegura` (Fase 1, `ssrf-guard.ts`) **antes** de tocar la base — una URL rechazada nunca deja una fila a medio persistir. Cubre localhost/loopback/RFC1918/link-local-metadata (`169.254.169.254`)/reservado/multicast, para IPv4 e IPv6, resolviendo DNS real (no solo el literal de IP).

---

## 7. Evidencia de tests (Fase 2)

| Archivo | Qué prueba |
|---|---|
| `lib/developer/rls-isolation.e2e.test.ts` | Aislamiento RLS REAL entre dos workspaces (sesión autenticada real, no `service_role`) sobre las 6 tablas nuevas: el dueño lee su fila, un workspace ajeno no ve nada (ni filtrando explícitamente por el `workspace_id` del otro), y ni siquiera el dueño puede `UPDATE`/`DELETE` vía rol `authenticated` (confirmado con lectura de control por `service_role`, no solo "la llamada no dio error"). |
| `lib/developer/api-keys-store.e2e.test.ts` | Creación, hash real (nunca el valor en claro almacenado), autenticación por hash, revocación con ownership real por `workspace_id`, aislamiento entre workspaces, listado aislado. |
| `lib/developer/whatsapp-numbers-store.e2e.test.ts` | Registro, unicidad global real de `phone_number_id` (rechazo de reclamo cruzado), reconexión sin duplicar fila, aislamiento de lectura, cifrado real del token de Meta con descifrado correcto. |
| `lib/developer/webhook-config-store.e2e.test.ts` | Creación con secreto cifrado, rechazo SSRF real (localhost, metadata endpoint) antes de tocar la base, aislamiento entre workspaces, rotación de secreto al reconfigurar. |
| `lib/developer/jobs-store.e2e.test.ts` | Creación con estado inicial correcto, aislamiento de lectura, adquisición/bloqueo/takeover de lease con CAS real, liberación solo por el dueño real, transición inválida rechazada, ciclo feliz completo con `version_token` avanzando, regla crítica de incertidumbre de red (nunca auto-retry), CAS de `version_token` bajo concurrencia real (`Promise.all`). |
| `lib/developer/usage-ledger.e2e.test.ts` | Reserva única por job (incluida una prueba de 5 reservas concurrentes reales), confirmación/liberación con CAS (`estado='reservado'` como guardia), no se puede liberar un uso ya confirmado. |
| `lib/developer/events-store.e2e.test.ts` | Dedup real de `event_id` (incluida una prueba de 5 reentregas concurrentes reales), aislamiento por workspace + job. |

Todos siguen el patrón ya establecido en Fase 1 (`idempotency.e2e.test.ts`): workspaces/usuarios desechables, limpieza en `after()`, contra Postgres real — nunca mocks.

**Técnica usada para RLS real sin `NEXT_PUBLIC_SUPABASE_ANON_KEY`** (vacío en este entorno local, mismo patrón de secretos en blanco visto en el resto del repo): reusa `lib/test-helpers/sesion-prueba.ts`, ya validado por el resto de la suite E2E del repo (`f12`–`f16`). `signInWithPassword` con `SERVICE_ROLE_KEY` como `apikey` del cliente produce un `access_token` de usuario normal, idéntico al que emitiría el anon key real — el rol Postgres (`authenticated` vs `service_role`) lo decide el claim `role` del JWT en `Authorization`, no la `apikey` usada para firmar el login. El test arma un cliente aparte que envía ese token como `Authorization: Bearer <token>` en cada request — así sí queda sujeto a RLS de verdad. Patrón exclusivo de test, documentado como tal.

---

## 8. Bloqueadores

| Bloqueador | Estado |
|---|---|
| Migración `20261007000000_dulabs_developer_v1_fase2_data_model.sql` aplicada a producción | **Pendiente** — entregada al usuario para aplicar vía SQL Editor de Supabase. Ningún test de Fase 2 puede correr contra Postgres real hasta que esto esté hecho. |
| Suite completa de Fase 2 ejecutada con evidencia real | **Pendiente**, depende del bloqueador anterior. |
| Infraestructura GCP real (Cloud Run/Pub/Sub/KMS) | Fuera de alcance de esta fase — sigue perteneciendo a Fase 3, no simulada acá (igual que en Fase 1). |

---

## 9. Riesgos conocidos / límites

- RLS en estas tablas es defensa en profundidad, no la barrera primaria — el backend con `service_role` sigue siendo responsable de filtrar por `workspace_id` en cada consulta. Un bug de aplicación que olvide ese filtro en una ruta que use `service_role` **no** sería detectado por RLS.
- `dulabs_dev_idempotency_keys` (Fase 1) sigue sin FK hacia `dulabs_dev_jobs` — la consistencia entre ambas tablas depende de que todo código nuevo pase por `crearJobConIdempotencia`, no de un constraint de base de datos. Riesgo aceptado explícitamente (sección 5).
- El cifrado de secretos (`secure-crypto.ts`) depende de una clave de entorno (`DEVELOPER_TOKEN_ENCRYPTION_KEY`) gestionada manualmente hasta que Fase 3 conecte KMS real — hasta entonces, rotar esa clave a mano invalidaría los secretos ya cifrados (mismo límite ya documentado en Fase 1).

---

## 10. Gate de cierre

Esta fase **no se declara `FROZEN` ni `READY FOR REVIEW`** todavía — falta la evidencia real de ejecución (bloqueada en la aplicación de la migración, sección 8). Estado actual: **IN PROGRESS**. Próximo paso, una vez aplicada la migración: correr toda la suite E2E de Fase 2 contra Postgres real, documentar resultados exactos, y recién entonces declarar el estado final de la fase.
