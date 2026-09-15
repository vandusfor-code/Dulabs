# DuLabs Developer V1 — Fase 1: Arquitectura y Contratos Técnicos

**Estado de esta fase: READY FOR AUDIT** (ver sección "Gate de cierre" al final — NO se declara FROZEN; la siguiente etapa es auditoría adversarial, no producción).

**Decisión de plataforma (confirmada):** la arquitectura de cómputo queda **Google Cloud Run + Pub/Sub + PostgreSQL + Cloud Run Jobs (reconciliación) + Google Cloud KMS**, tal como estaba en el brief original de Fase 1. Se evaluó la alternativa de Vercel + QStash (sección 8.2 de una versión anterior de este documento) y se descartó explícitamente: el diseño ya está construido alrededor de ownership/leases, CAS, `physical_outcome`, reconciliación y semántica at-least-once de Pub/Sub — cambiar el backbone de ejecución ahora reabriría la arquitectura sin necesidad. Esta sección ya no es una decisión pendiente.

Basado en `DuLabs_Developer_V1_Fase_0_FROZEN_Definicion_Final.pdf` (leído completo antes de escribir este documento). Fase 0 se trata como FROZEN — este documento no reinterpreta el producto, solo lo traduce a contratos técnicos.

---

## 0. Resumen de la inspección del repositorio (Paso 1-3)

Estado real encontrado, verificado por grep/búsqueda directa, no asumido:

| Componente del brief | Estado en el repo |
|---|---|
| Producto "Developer" (cualquier código) | **No existe.** Cero coincidencias de `Developer V1`, `workspace` (como entidad), `dl_live_`, `/api/v1/`. |
| Cloud Run / Pub/Sub / KMS | **No existe ningún archivo de infraestructura** (`Dockerfile`, `cloudbuild.yaml`, terraform, etc.). `gcloud` CLI no está disponible en este entorno (confirmado, no asumido). |
| `/docs` | No existía — se crea en esta fase. |
| Frontend/backend actuales | Next.js 16 (App Router) en Vercel, todo el backend vive en `app/api/**/route.ts` (serverless functions), no hay un servidor persistente propio salvo `worker/` (proceso Node aparte para sesiones Baileys de AMORE — **no relacionado** con Developer V1, es infraestructura de WhatsApp *no oficial* QR, exactamente lo que la sección 11 del Fase 0 excluye del alcance de Developer). |
| Base de datos | Supabase (Postgres gestionado). No hay un Postgres separado para Developer todavía. |
| Auth | Supabase Auth (usuarios) + `dulabs_miembros_equipo` (tenant_id = id del primer usuario admin, rol admin/agente/lectura). Este modelo **ya es funcionalmente un "workspace"** — ver sección 3. |
| Integración con Meta | Ya existe y es real: `lib/meta-numero.ts`, `lib/meta-templates.ts`, `app/api/auth/meta-callback/route.ts` (Embedded Signup real), `app/webhook-dulabs/route.ts` (webhook único multi-tenant ya en producción). Usa `https://graph.facebook.com/{version}/...` — cumple la regla de la sección 15 del brief (nunca `facebook.com` a secas). |
| Integración con Flow | Flow Engine completo y en producción (`lib/flow/**`, `/flow-studio/[flowId]`). Reusable tal cual para la modalidad FLOW de Developer (sección 3 del Fase 0: "el desarrollador utiliza el Flow Builder existente"). |
| Cifrado de secretos | **Ya existe** `lib/crypto.ts` — AES-256-GCM, IV único de 12 bytes por operación, formato versionado (`v1:iv:authTag:ciphertext`). Usado hoy para tokens de Meta y API keys de IA de clientes. |
| API keys / autenticación por Bearer | Existe el patrón (comparación en tiempo constante SHA-256, ver `lib/auth.ts` del worker y `app/api/diagnostics/token-status/route.ts`), pero **no existe una tabla ni endpoint de API keys de desarrollador** todavía. |
| Idempotencia | Patrón ya establecido y probado en producción: `UPDATE ... WHERE <condición> IS NULL ... RETURNING` (CAS a nivel de fila de Postgres) — usado en `dulabs_reservar_suscripcion`, `dulabs_dunning_reclamar_reintento`, y el nuevo `reclamarEnvioBienvenidaMeta` (F16.2). Es exactamente el patrón que pide la sección 13/9 del brief — **no hay que inventar uno nuevo, hay que generalizarlo**. |
| Rate limiting | Existe `lib/rate-limit.ts` (categorías "escritura"/"costosa"), aplicado a rutas del dashboard. No aplicado a un API pública versionada todavía. |

**Conclusión de la inspección:** no hay ningún código de Developer V1 que contradiga Fase 0 (no hay nada que reinterpretar). Las contradicciones reales están entre **la arquitectura objetivo del brief de Fase 1** (Cloud Run + Pub/Sub + KMS) y **la infraestructura real disponible en este entorno de trabajo** (Vercel + Supabase, sin cuenta GCP ni CLI configurada) — documentadas como bloqueadores en la sección 9.

---

## 1. Arquitectura objetivo (según el brief) vs. lo implementable ahora

```
DEVELOPER / CLIENT APP
         │ HTTPS
         ▼
  DULABS API GATEWAY (Cloud Run)
         │ Pub/Sub
   ┌─────┴─────┐
   ▼           ▼
Outbound    Inbound
Worker      Worker
(Cloud Run) (Cloud Run)
   │           │
   ▼           ▼
Meta Graph   Developer Webhook
```

Esta es la arquitectura **objetivo a largo plazo**, aprobada en el brief. Requiere una cuenta GCP con billing activo, Cloud Run, Pub/Sub y KMS provisionados — **nada de eso existe ni es accesible desde este entorno** (sin `gcloud`, sin credenciales de servicio, sin proyecto GCP configurado). Esto es un **BLOQUEADOR REAL**, no una decisión técnica que yo pueda resolver escribiendo código: requiere que alguien con acceso a una cuenta GCP (o la decisión explícita de usar otro proveedor equivalente) provisione la infraestructura base.

**Lo que sí se puede hacer en Fase 1 sin esa infraestructura**, y es lo que se implementó en esta ronda: diseñar y **probar de verdad** toda la lógica que es independiente de la plataforma de cómputo (corre igual en Cloud Run, en una función serverless de Vercel, o en cualquier otro runtime Node): los contratos, las máquinas de estado, la validación SSRF, la firma HMAC, el patrón de idempotencia/CAS contra Postgres. Cuando exista la infraestructura Cloud Run/Pub/Sub real, estas piezas se despliegan ahí sin reescribirse — el Gateway y los Workers son, en esencia, quien invoca esta lógica ya construida y probada.

---

## 2. API pública — contrato

### 2.1 Versionamiento y endpoint principal

```
POST /api/v1/messages
```

Prefijo `/api/v1/` obligatorio para toda ruta pública de Developer (permite `/api/v2/` en el futuro sin romper integraciones existentes).

### 2.2 Autenticación

```
Authorization: Bearer dl_live_<32+ bytes aleatorios en base62>
```

- La API key se muestra **una sola vez**, en el momento de creación (nunca se puede volver a consultar en claro).
- Se almacena como **SHA-256** del valor completo (incluido el prefijo `dl_live_`), nunca en texto plano — implementado y probado en `lib/developer/api-keys.ts` (ver sección 6).
- Pertenece a un `workspace_id` (ver sección 3).
- Revocable (marca `revoked_at`, no se borra la fila — necesario para auditoría).
- Rotable (crear una nueva sin invalidar la anterior hasta que el desarrollador confirme la migración — mismo criterio que rotación de claves ya usado en `TOKEN_ENCRYPTION_KEY`, prefijo de versión).

### 2.3 Request / Response — `POST /api/v1/messages`

**Request:**
```
Headers:
  Authorization: Bearer dl_live_...
  Content-Type: application/json
  Idempotency-Key: <string, requerido>

Body:
{
  "to": "573001234567",       // E.164, solo dígitos
  "phone_number_id": "...",   // debe pertenecer al workspace del API key
  "type": "text" | "template",
  "text": { "body": "..." },           // si type=text
  "template": { "name": "...", "language": "es_CO", "components": [...] } // si type=template
}
```

**Response 202 (aceptado, encolado):**
```json
{
  "job_id": "uuid",
  "status": "queued",
  "correlation_id": "req_..."
}
```

**Errores (siempre el mismo shape):**
```json
{ "error": { "code": "invalid_request" | "unauthorized" | "forbidden" | "rate_limited" | "idempotency_conflict" | "internal_error", "message": "..." } }
```

| Código HTTP | Caso |
|---|---|
| 202 | Job aceptado y encolado |
| 200 | Reintento con la misma `Idempotency-Key` + mismo payload → devuelve el job ya existente |
| 400 | Payload inválido |
| 401 | API key ausente/inválida/revocada |
| 403 | `phone_number_id` no pertenece al workspace del API key (aislamiento) |
| 409 | Misma `Idempotency-Key`, payload **distinto** (ver 2.4) |
| 429 | Rate limit del workspace/número excedido |
| 500 | Error interno — nunca debe filtrar detalle de infraestructura |

### 2.4 Idempotencia — contrato exacto

- Clave real de deduplicación: `(workspace_id, idempotency_key)` — única por workspace, no global.
- Almacenamiento: tabla `dulabs_dev_idempotency_keys` (ver sección 5), con un **hash del payload** (SHA-256 del JSON canónico) además de la clave.
- Ventana de retención: **24 horas** desde la creación (después de eso, la misma clave puede reutilizarse — evita crecimiento indefinido; 24h cubre con margen cualquier reintento razonable de un cliente HTTP).
- Mismo `workspace_id` + misma `Idempotency-Key` + **mismo hash de payload** → se devuelve el job ya creado, HTTP 200, nunca se vuelve a encolar.
- Mismo `workspace_id` + misma `Idempotency-Key` + **hash de payload distinto** → **409** `idempotency_conflict` (nunca se procesa silenciosamente un payload diferente bajo la misma clave).
- Concurrencia real (N requests simultáneos, misma clave): el INSERT de la fila de idempotencia usa `UNIQUE(workspace_id, idempotency_key)` — Postgres garantiza que solo **una** transacción gana la inserción; las demás reciben el conflicto de unicidad y consultan la fila ganadora para devolver su resultado. Implementado y **probado con 5 inserciones concurrentes reales** contra Supabase — ver sección 7.

---

## 3. Workspaces

El brief pide una entidad "workspace" propia del desarrollador, con múltiples números de clientes.

**Decisión técnica (no de producto):** reusar el modelo de tenant existente (`dulabs_miembros_equipo`, `tenant_id` = UUID del primer usuario admin) como el `workspace_id` de Developer, en vez de crear una segunda jerarquía de identidad paralela. Es exactamente el mismo concepto (un espacio aislado con miembros y roles) que ya existe y está probado en producción para DuLabs Business. Esto respeta la sección 20 del Fase 0 ("Developer amplía el ecosistema... sin reemplazar Business") sin duplicar el modelo de autenticación/aislamiento.

`dulabs_clientes_config.phone_number_id` (ya existente) se reusa igual para los números que el desarrollador conecta a nombre de sus clientes — cada número sigue perteneciendo a un `id_tenant` (= workspace), con aislamiento ya garantizado por las políticas RLS existentes.

---

## 4. Outbound state machine

```
created → queued → sending → success_confirmed
                           ↘ failed_by_meta
                           ↘ retry_pending → sending (máx. 2 intentos físicos)
                           ↘ reconciliation_pending
```

`physical_outcome` (independiente del estado lógico, sección 10-11 del brief):

```
pre_send        -- todavía no se ejecutó ningún POST físico a Meta
uncertain        -- se ejecutó el POST pero no hay confirmación de si Meta lo recibió (timeout, crash, red)
success_confirmed -- Meta confirmó recepción (2xx + message id en la respuesta)
```

**Regla crítica implementada literalmente (sección 11):** un timeout NUNCA se interpreta como "no enviado". Si `physical_outcome` pasa a `uncertain`, el job va a `reconciliation_pending` y **ningún Worker vuelve a hacer POST automáticamente** hasta que un proceso de reconciliación confirme contra Meta (vía `GET` del estado del mensaje, cuando exista, o intervención manual) que el primer POST no llegó a ejecutarse del lado de Meta.

Implementado como tipo + función pura de transición en `lib/developer/outbound-state-machine.ts` (sección 6) — **probado con la matriz completa de transiciones válidas e inválidas**, sin depender de ningún Worker ni cola real.

---

## 5. Modelo de datos — entidades mínimas (sección 23 del brief)

Solo las que tienen responsabilidad clara, ninguna "por si acaso":

| Tabla | Responsabilidad |
|---|---|
| `dulabs_dev_api_keys` | API keys por workspace. `key_hash` (SHA-256), `workspace_id`, `created_at`, `revoked_at`, `last_used_at`. Nunca guarda el valor en claro. |
| `dulabs_dev_idempotency_keys` | `(workspace_id, idempotency_key)` UNIQUE, `payload_hash`, `job_id`, `created_at`. TTL lógico de 24h (limpieza por cron, no por diseño de la tabla). |
| `dulabs_dev_outbound_jobs` | Un job por mensaje saliente vía API. `status`, `physical_outcome`, `network_attempts`, `next_attempt_at`, `lease_id`, `version_token`, `locked_at`, `workspace_id`, `phone_number_id`, `payload` (el request original, para poder reintentar sin volver a confiar en memoria). |
| `dulabs_dev_usage_ledger` | `UNIQUE(job_id)` — un cargo lógico por job, nunca dos. Consolidado en la misma transacción corta que el cierre del job (sección 20). |
| `dulabs_dev_webhook_config` | Por número: URL del webhook del desarrollador, secreto HMAC vigente (cifrado con `lib/crypto.ts`), rotación (secreto anterior válido durante ventana de gracia). |
| `dulabs_dev_webhook_events` | Log de eventos entrantes reenviados al desarrollador — `event_id` único (deduplicación real contra el at-least-once de Pub/Sub, sección 19), estado de entrega, reintentos. |

No se crean tablas de "workspace" ni "developer_user" separadas — ver sección 3 (se reusa `dulabs_miembros_equipo` / Supabase Auth).

---

## 6. Lo que se implementó y se probó de verdad en esta ronda (Paso 7-9)

Todo el código nuevo vive bajo `lib/developer/` — deliberadamente aislado del resto de DuLabs Business, sin tocar ni un archivo existente (Fase 0, sección 1: no reconstruir lo que ya funciona).

1. **`lib/developer/api-keys.ts`** — generación (`dl_live_` + 32 bytes aleatorios en base62), hash SHA-256 para almacenamiento, verificación en tiempo constante. Puro, sin red.
2. **`lib/developer/ssrf-guard.ts`** — valida que una URL de webhook de desarrollador sea segura de invocar: bloquea localhost/loopback, RFC1918, link-local, metadata endpoints (169.254.169.254 y variantes), multicast, reservado, y el equivalente IPv6 de cada uno. Resuelve DNS explícitamente (`family`/`all`) y valida la **IP real resuelta**, no solo el hostname que escribió el desarrollador (para no ser vulnerable a DNS rebinding: un hostname público que resuelve a una IP privada se bloquea igual).
3. **`lib/developer/webhook-signature.ts`** — firma/verificación HMAC-SHA256 de los eventos salientes hacia el desarrollador (`X-DuLabs-Signature`, `X-DuLabs-Timestamp`, `X-DuLabs-Event-ID`), comparación en tiempo constante, tolerancia temporal configurable (protección contra replay).
4. **`lib/developer/outbound-state-machine.ts`** — tipos + función pura `transicionValida(estadoActual, evento)` para el ciclo de vida del job saliente (sección 4 de este documento).
5. **`lib/developer/idempotency.ts`** — contrato de idempotencia contra Postgres (Supabase) usando el mismo patrón CAS ya validado en producción (`INSERT ... ON CONFLICT`), con hash de payload para detectar conflictos reales.
6. **`lib/developer/secure-crypto.ts`** — cifrado AES-256-GCM estricto, fail-closed, para credenciales de Developer V1 (sección 8.1).

Todo lo anterior tiene tests reales en `lib/developer/*.test.ts` (ver reporte de tests, sección 8) — nunca `expect(true).toBe(true)`.

**Deliberadamente NO implementado en esta ronda** (requiere la infraestructura bloqueada, sección 9, o es de una fase posterior):
- El Gateway HTTP real (`POST /api/v1/messages`) como endpoint desplegado — el contrato está definido (sección 2), pero desplegarlo en Cloud Run requiere la infraestructura bloqueada. Podría exponerse temporalmente como ruta de Next.js/Vercel si el negocio decide no esperar a GCP — **esto es una PRODUCT DECISION REQUIRED**, ver sección 9.
- Outbound/Inbound Workers reales, colas Pub/Sub reales.
- KMS real (sección 9 explica la contradicción encontrada con el cifrado actual).
- Rate limiting de 2 msg/s por número a nivel de Developer (existe `lib/rate-limit.ts` para el dashboard, no se extendió a la API pública en esta ronda).

---

## 7. Evidencia de tests (regla de evidencia, sección 27 del brief)

**Suite completa de Developer V1: 56/56 tests en verde**, corrida real (`node --test`), no `expect(true).toBe(true)`:

| Archivo | Tests | Qué prueba, con evidencia real |
|---|---|---|
| `api-keys.test.ts` | 7 | Generación, hash SHA-256, verificación en tiempo constante, rechazo de clave incorrecta |
| `ssrf-guard.test.ts` | 13 | localhost, RFC1918, metadata endpoint (169.254.169.254), multicast, reservado, IPv6 (`::1`, `fe80::`, `fd00::`, `::ffff:127.0.0.1`), **DNS rebinding real** (resolver inyectado que hace que un hostname con apariencia pública resuelva a `10.0.0.99` -- se bloquea igual, verificado también con múltiples IPs candidatas) |
| `webhook-signature.test.ts` | 9 | Firma válida/inválida, cuerpo alterado, timestamp expirado, **replay real simulado** (evento capturado y reenviado con el reloj avanzado), tolerancia configurable |
| `outbound-state-machine.test.ts` | 9 | Ciclo completo de transiciones, **la regla crítica de la sección 11 probada explícitamente dos veces** (incertidumbre nunca va a retry_pending, sin importar intentos restantes), máximo de intentos físicos respetado |
| `crash-recovery.test.ts` | 1 | Servidor HTTP **real** (fixture), POST **real**, contador incrementado por el servidor (no por el código bajo prueba), crash simulado tras el POST, recovery, **cero segundo POST físico**. Evidencia impresa: `physical POST count before recovery: 1` / `after recovery attempt: 1` / `final job state: reconciliation_pending` / `second POST: NOT EXECUTED` |
| `secure-crypto.test.ts` | 10 | Roundtrip real, fail-closed sin clave (cifrar Y descifrar), clave de longitud inválida, **prohibición de plaintext fallback** (formato inválido, formato legado de Business, string vacío -- todos lanzan), **dato manipulado** (byte corrompido en el ciphertext real, falla la autenticación GCM), nonce único por operación |
| `idempotency.e2e.test.ts` | 7 | **Postgres real (Supabase)**: primera vez = nuevo job; misma clave + mismo payload = mismo job_id; misma clave + payload distinto = conflicto; aislamiento real entre 2 workspaces; **5 reclamos concurrentes reales con `Promise.all` → exactamente 1 gana, confirmado también contra la tabla directamente (`count === 1`)**; repetición tardía tras "completarse" la operación → mismo job_id, dos veces seguidas |

Corrido también: `npx tsc --noEmit` (0 errores), `npx eslint lib/developer/` (0 errores/warnings), y la suite completa del manifiesto del repo (`scripts/run-test-flow.mjs`) para confirmar que nada de DuLabs Business se rompió.

---

## 8. Contradicciones encontradas entre el código actual y el Fase 0/1 (sección 1 del brief: documentar, no resolver en silencio)

### 8.1 KMS — CONTRADICCIÓN REAL, CORREGIDA para Developer V1

**Fase 1 exige (sección 17):** clave maestra protegida por KMS, `FAIL CLOSED` si KMS no está disponible, nunca un fallback criptográfico.

**Código de Business (`lib/crypto.ts`, sin modificar):** `TOKEN_ENCRYPTION_KEY` es un env var plano (cifrado en reposo por Vercel, pero no es KMS con auditoría/rotación/HSM), y `descifrarSecreto` tiene un **fallback explícito a texto plano** para valores legacy sin el prefijo `v1:`. Esto sigue siendo correcto para Business (datos ya migrados dependen de ese fallback) — **no se tocó**, no era el pedido.

**Corrección implementada para Developer V1:** `lib/developer/secure-crypto.ts` (ruta completamente separada, aislada, greenfield):
- `DEVELOPER_TOKEN_ENCRYPTION_KEY` — variable de entorno propia, nunca comparte ni reemplaza `TOKEN_ENCRYPTION_KEY` de Business.
- Clave ausente o de longitud inválida → `ClaveNoDisponibleError`, tanto al cifrar como al descifrar. Sin excepciones, sin clave por defecto, sin clave cero.
- Valor a descifrar mal formado (incluido el formato legado `v1:...` de Business, que se rechaza a propósito — no hay compatibilidad cruzada) → `DescifradoFallidoError`. **Nunca** se devuelve el valor de entrada como si fuera texto plano.
- Autenticación GCM fallida (ciphertext manipulado) → `DescifradoFallidoError`. Probado corrompiendo un byte real del ciphertext y confirmando el rechazo.
- 10 tests reales en `lib/developer/secure-crypto.test.ts`, incluida la garantía de nonce único por operación (dos cifrados del mismo texto producen IVs distintos).

**Lo que sigue pendiente, honestamente (no resuelto ni simulado):** `obtenerClaveMaestra()` hoy lee la clave de una variable de entorno, no de una llamada real a Google Cloud KMS. Está marcado con un comentario `TODO(Fase 3, infraestructura real)` explícito en el código — es el único punto que habría que cambiar cuando exista una cuenta GCP con KMS provisionado (envelope encryption: KMS desenvolvería la clave real). La *regla de negocio* ("sin clave válida, fail closed, siempre") está implementada y probada ahora; la *fuente* de esa clave (env var vs. KMS real) es intercambiable sin tocar el resto del sistema, y depende del bloqueador de infraestructura de la sección 9.

### 8.2 Infraestructura de cómputo — DECISIÓN TOMADA

~~Pendiente~~ **Resuelto por decisión explícita del negocio:** se mantiene la arquitectura Google Cloud Run + Pub/Sub + PostgreSQL + Cloud Run Jobs + Google Cloud KMS, tal como estaba aprobada en el brief original. Se evaluó la alternativa Vercel + QStash y se descartó a propósito para no reabrir un diseño ya construido alrededor de ownership/leases/CAS/reconciliación. Ver el encabezado de este documento.

### 8.3 Worker de WhatsApp por QR (AMORE) — no es una contradicción, es scope

El repo tiene un mecanismo de conexión "no oficial" (Baileys/QR, `worker/`) usado hoy por un cliente real (AMORE) de DuLabs Business. El Fase 0, sección 11, excluye explícitamente "WhatsApp Web, QR no oficial, scraping, emulación" del alcance de Developer V1. Esto **no es una contradicción a resolver** — es simplemente scope: ese worker sigue existiendo para Business, nunca se expone ni se ofrece como opción dentro de Developer.

---

## 9. Bloqueadores reales de infraestructura (sección "F" del reporte — actualizado tras la decisión de plataforma)

La decisión de plataforma (sección 8.2) ya no es un bloqueador — el diagrama queda fijo en GCP. Lo que sigue bloqueado es el **acceso real** a esa infraestructura desde este entorno de trabajo, algo que ninguna decisión de arquitectura resuelve por sí sola:

1. **Sin cuenta/credenciales GCP ni `gcloud` CLI en este entorno** (confirmado con `which gcloud` → no encontrado, `gcloud config list` → comando no existe). No se puede provisionar ni invocar Cloud Run, Pub/Sub ni Cloud KMS reales desde acá.
2. **Google Cloud KMS real** — `lib/developer/secure-crypto.ts` implementa y prueba la regla "fail closed" (sección 8.1), pero la fuente de la clave sigue siendo una variable de entorno, no una llamada real a KMS. Requiere el punto 1 resuelto.
3. Los tests de Pub/Sub (DLQ, ack, redelivery at-least-once real) y de Cloud Run Job de reconciliación de la sección 26 del brief **no se pueden ejercitar sin infraestructura real** — no se simulan como si lo fueran. Lo que sí se probó de verdad, sin necesitar esa infraestructura, se detalla en la sección 7 (actualizada).

**Qué puede validarse localmente vs. qué requiere GCP (instrucción explícita de documentar esto sin ambigüedad):**

| Validable ahora, sin GCP (hecho) | Requiere GCP real (pendiente de infraestructura) |
|---|---|
| Contratos de API (forma de request/response) | El Gateway HTTP desplegado en Cloud Run |
| Idempotencia -- Postgres real (Supabase hoy, mismo motor que el Postgres final) | Pub/Sub real (topics, ack, DLQ, retención, at-least-once real) |
| SSRF guard -- resolución DNS real, IPs reales | Cloud Run Jobs de reconciliación ejecutándose de verdad |
| Firma/verificación HMAC | Cloud KMS real protegiendo la clave maestra |
| Máquina de estados del job saliente (lógica pura) | Autoscaling / networking real de Cloud Run |
| Fail-closed del cifrado (regla de negocio) | Observabilidad/tracing real en el entorno de nube |
| Crash recovery -- servidor HTTP fixture real, POST real, contador real | Crash recovery de un Cloud Run Job real (el fixture prueba la LÓGICA, no el entorno de ejecución real) |

---

## 10. Gate de cierre

**Estado de Fase 1: READY FOR AUDIT.**

Por qué ya no es `IN PROGRESS`:
- Los contratos de API, idempotencia, state machine, SSRF y HMAC están definidos y **probados con evidencia real** (sección 7).
- La decisión de plataforma de cómputo está **tomada y documentada** (GCP Cloud Run/Pub/Sub/KMS, sección 8.2) -- ya no es una pregunta abierta.
- La contradicción de KMS/fail-closed está **corregida e implementada** para Developer V1 (sección 8.1), con la parte pendiente (conexión real a KMS) marcada explícitamente como dependencia de infraestructura, no como algo simulado o ignorado.
- La prueba de idempotencia con concurrencia real, payload distinto, y repetición post-completado está **hecha contra Postgres real**, no pendiente.

Por qué NO es `FROZEN`:
- Sigue bloqueado el acceso real a GCP (sección 9) -- el Gateway, los Workers, Pub/Sub y KMS reales no existen desplegados todavía, solo la lógica que los va a respaldar.
- La siguiente etapa, según tu instrucción, es **auditoría adversarial** -- Fase 1 se congela después de esa revisión, no antes.

No se avanzó a checkout, billing, pricing UI, landing, Agency, Enterprise, dashboard completo ni V2 -- fuera de alcance de esta fase, tal como se pidió explícitamente.
