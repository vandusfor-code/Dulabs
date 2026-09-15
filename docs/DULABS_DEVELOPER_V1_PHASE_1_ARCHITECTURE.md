# DuLabs Developer V1 — Fase 1: Arquitectura y Contratos Técnicos

**Estado de esta fase: IN PROGRESS** (ver sección "Gate de cierre" al final — NO se declara FROZEN ni READY FOR AUDIT).

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

Todo lo anterior tiene tests reales en `lib/developer/*.test.ts` (ver reporte de tests, sección 8) — nunca `expect(true).toBe(true)`.

**Deliberadamente NO implementado en esta ronda** (requiere la infraestructura bloqueada, sección 9, o es de una fase posterior):
- El Gateway HTTP real (`POST /api/v1/messages`) como endpoint desplegado — el contrato está definido (sección 2), pero desplegarlo en Cloud Run requiere la infraestructura bloqueada. Podría exponerse temporalmente como ruta de Next.js/Vercel si el negocio decide no esperar a GCP — **esto es una PRODUCT DECISION REQUIRED**, ver sección 9.
- Outbound/Inbound Workers reales, colas Pub/Sub reales.
- KMS real (sección 9 explica la contradicción encontrada con el cifrado actual).
- Rate limiting de 2 msg/s por número a nivel de Developer (existe `lib/rate-limit.ts` para el dashboard, no se extendió a la API pública en esta ronda).

---

## 7. Evidencia de tests (regla de evidencia, sección 27 del brief)

Ver reporte completo al final de la respuesta de esta sesión (no repetido aquí para no duplicar). Resumen: pruebas reales de SSRF (localhost, RFC1918, metadata endpoint, IPv6, DNS rebinding con un resolver controlado), HMAC (firma válida, firma inválida, timestamp expirado, replay), state machine (las transiciones que el brief exige, incluida la prohibición de POST automático tras `uncertain`), e idempotencia con 5 inserciones concurrentes reales contra Supabase (Postgres real, no simulado).

---

## 8. Contradicciones encontradas entre el código actual y el Fase 0/1 (sección 1 del brief: documentar, no resolver en silencio)

### 8.1 KMS — CONTRADICCIÓN REAL

**Fase 1 exige (sección 17):** clave maestra protegida por KMS, `FAIL CLOSED` si KMS no está disponible, nunca un fallback criptográfico.

**Código actual (`lib/crypto.ts`):** `TOKEN_ENCRYPTION_KEY` es un env var plano (aunque cifrado en reposo por Vercel, no es KMS con auditoría/rotación/HSM), y `descifrarSecreto` tiene un **fallback explícito a texto plano** para valores legacy sin el prefijo `v1:` — es decir, hoy el sistema hace exactamente lo opuesto a "fail closed": si algo no está cifrado, lo acepta igual.

**Propuesta técnica:** para Developer V1 específicamente (no se toca el comportamiento legacy de Business, que depende de ese fallback para no romper datos ya migrados), las credenciales de desarrollador (API keys de IA de terceros que el desarrollador pudiera guardar, secretos de webhook) deben cifrarse con una ruta que **no tenga fallback a texto plano** — si `TOKEN_ENCRYPTION_KEY` falta, la operación de guardar/leer debe fallar con error explícito, nunca degradar. Implementado así en `lib/developer/` (no reutiliza `descifrarSecreto` tal cual, usa una variante estricta). El uso de un KMS real (Google Cloud KMS / AWS KMS) para la clave maestra en sí queda como **PRODUCT DECISION REQUIRED** — depende de qué nube se decida para Fase 3.

### 8.2 Infraestructura de cómputo — DECISIÓN DE PRODUCTO REQUERIDA

El Fase 0 no menciona GCP en ningún punto (habla de "infraestructura oficial de Meta", no de nube específica). El diagrama de Cloud Run/Pub/Sub/KMS aparece **por primera vez en el brief de Fase 1**, como arquitectura objetivo aprobada. Dado que:
- No hay cuenta GCP accesible desde este entorno.
- Vercel (donde corre hoy el 100% de DuLabs) también podría sostener la Fase 1 de forma más simple (funciones serverless + una cola gestionada tipo QStash, que **ya está en las dependencias del proyecto**: `@upstash/qstash` — usado hoy en producción para otra cosa, pero es literalmente una cola de mensajes con reintentos y firma, el mismo rol que cumpliría Pub/Sub).

**Pregunta que requiere decisión de negocio, no técnica:** ¿se provisiona una cuenta GCP nueva para Developer V1 (arquitectura tal como está en el brief), o se evalúa reusar QStash/Vercel para no duplicar plataformas de infraestructura? Ambas son válidas técnicamente; ninguna la puedo decidir por mi cuenta (cambiaría el diagrama aprobado de la sección 4 del brief de Fase 1, así que si se elige la segunda, debe registrarse y aprobarse como cambio, tal como pide la sección 1).

### 8.3 Worker de WhatsApp por QR (AMORE) — no es una contradicción, es scope

El repo tiene un mecanismo de conexión "no oficial" (Baileys/QR, `worker/`) usado hoy por un cliente real (AMORE) de DuLabs Business. El Fase 0, sección 11, excluye explícitamente "WhatsApp Web, QR no oficial, scraping, emulación" del alcance de Developer V1. Esto **no es una contradicción a resolver** — es simplemente scope: ese worker sigue existiendo para Business, nunca se expone ni se ofrece como opción dentro de Developer.

---

## 9. Bloqueadores (sección "F" del reporte)

1. **Sin acceso a GCP** (Cloud Run, Pub/Sub, KMS) desde este entorno — bloqueador de infraestructura real, no de código.
2. **Decisión de plataforma de cómputo** (GCP vs. Vercel+QStash) — PRODUCT DECISION REQUIRED, sección 8.2.
3. **KMS real para la clave maestra** — depende de la decisión anterior.
4. Los tests de "crash recovery" con Cloud Run Job real y los de Pub/Sub (DLQ, ack, retry) de la sección 26 del brief **no se pueden ejercitar sin la infraestructura del punto 1** — lo que sí se probó (idempotencia real con Postgres, SSRF real, HMAC real) se detalla en la sección 7.

---

## 10. Gate de cierre

**Estado de Fase 1: IN PROGRESS.**

No se declara `READY FOR AUDIT` ni `FROZEN` porque:
- Los contratos de API, idempotencia, state machine, SSRF y HMAC están definidos y **probados**.
- La arquitectura de cómputo real (Cloud Run/Pub/Sub/KMS) sigue bloqueada por falta de infraestructura provisionada — sección 9.
- Hay una decisión de producto pendiente (sección 8.2) que puede cambiar el diagrama aprobado.

Cuando se resuelvan los bloqueadores de la sección 9, esta fase puede pasar a `READY FOR AUDIT` sin necesidad de rehacer los contratos ya definidos aquí — el trabajo de esta ronda no se pierde, solo falta el Gateway/Workers reales que invoquen esta lógica ya construida.
