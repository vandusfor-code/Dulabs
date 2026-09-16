# DuLabs Developer V1 — Fase 4: Developer API / Gateway — DISEÑO

**Estado: DISEÑO — NO IMPLEMENTADO.** Ningún cambio de código, infraestructura, IAM, Pub/Sub, KMS, Secret Manager o migración fue realizado para producir este documento. Solo lectura del repositorio real.

Fase 3: `docs/DULABS_DEVELOPER_V1_PHASE_3_CLOSURE_REPORT.md` — estado READY FOR FINAL REVIEW al momento de escribir esto (no encontré una actualización del documento a `FROZEN` en el repo; si ya la confirmaste fuera de esta conversación, avísame y actualizo el encabezado — no bloquea este diseño).

---

## 1. Estado actual encontrado (inspección real)

### 1.1 Lo que YA existe y debe reutilizarse tal cual

| Pieza | Archivo | Qué hace | Reutilizable para Fase 4 |
|---|---|---|---|
| API keys (generación, hash, verificación) | `lib/developer/api-keys.ts` | `dl_live_<32 bytes>`, SHA-256, comparación `timingSafeEqual`, lookup O(1) por índice único de hash | Sí, sin cambios |
| API keys (persistencia) | `lib/developer/api-keys-store.ts` | `crearApiKey`, `autenticarApiKey`, `revocarApiKey`, `listarApiKeys` | Sí, sin cambios |
| Idempotencia | `lib/developer/idempotency.ts` | `UNIQUE(workspace_id, idempotency_key)` real, hash de payload, sin ventana de carrera | Sí, sin cambios |
| Jobs + máquina de estados | `lib/developer/jobs-store.ts`, `lib/developer/outbound-state-machine.ts` | Lease/CAS, `crearJobConIdempotencia` (ya activa `reservarUso` desde el cierre de Fase 3) | Sí, sin cambios |
| Usage ledger | `lib/developer/usage-ledger.ts` | `reservarUso`/`confirmarUso`/`liberarUso`/`obtenerLedgerDelJob`, `UNIQUE(job_id)` | Sí, sin cambios — **falta una función de agregación por workspace** (ver 1.3) |
| Números de WhatsApp | `lib/developer/whatsapp-numbers-store.ts` | `registrarNumero`, `listarNumeros`, `obtenerNumeroDelWorkspace`, `obtenerNumeroPorPhoneNumberId` — ya excluye el token cifrado de las proyecciones públicas | Sí, sin cambios |
| Webhook config | `lib/developer/webhook-config-store.ts` | `configurarWebhook` (valida SSRF antes de persistir), `obtenerWebhookDelNumero` | Sí, sin cambios |
| SSRF guard | `lib/developer/ssrf-guard.ts` | Ya usado por `configurarWebhook` | Sí, sin cambios |
| Eventos | `lib/developer/events-store.ts` | Log de eventos **inbound únicamente** (recepción de Meta) | Sí, sin cambios — ver 3.7 sobre por qué NO se expone como endpoint todavía |
| Gateway HTTP | `services/gateway/server.ts` | Enrutador `node:http` puro — `/salud`, `/api/v1/webhooks/meta`, `/api/v1/messages`, `/api/v1/dev/*` | Se **extiende** (nuevas rutas), no se reescribe |
| Rate limiting genérico | `lib/rate-limit.ts` + RPC `dulabs_rate_limit_incrementar` (`supabase/migrations/20261001000000_dulabs_rate_limit.sql`) | Contador de ventana fija, atómico (`INSERT ... ON CONFLICT ... DO UPDATE`), **en Postgres — ya es distribuido, ya sobrevive múltiples instancias de Cloud Run**, fail-open, `EXECUTE` restringido a `service_role` | **Hallazgo clave — reutilizable directamente, ver sección 8** |

### 1.2 Endpoints que YA existen hoy

| Método | Path | Auth | Función |
|---|---|---|---|
| GET | `/salud` | ninguna | health check |
| GET/POST | `/api/v1/webhooks/meta` | firma de Meta | webhook inbound de Meta (no toca Developer API auth) |
| **POST** | **`/api/v1/messages`** | **Bearer `dl_live_...` (API key)** | Crea un Job saliente — el único endpoint público real hoy |
| POST/GET/DELETE | `/api/v1/dev/api-keys` | **Bearer `<sesión Supabase Auth>`** | CRUD de API keys — para el dashboard, NO para integraciones programáticas |
| POST/GET | `/api/v1/dev/numbers` | Bearer sesión Supabase Auth | CRUD de números — mismo modelo de auth que arriba |
| POST | `/api/v1/dev/webhooks` | Bearer sesión Supabase Auth | Configurar webhook — mismo modelo de auth que arriba |

**Hallazgo crítico #1 — dos superficies de autenticación coexisten hoy, deliberadamente separadas:**
- `/api/v1/messages` usa **API key** (`autenticarApiKey`) — pensado para que corra desde el backend del desarrollador.
- `/api/v1/dev/*` usa **sesión de Supabase Auth** (`conWorkspaceAutenticado` → `resolverWorkspaceDelUsuario`) — pensado para un humano logueado en un futuro dashboard, NO para un script/servidor del desarrollador.

Esto significa que **hoy no existe ningún endpoint de solo-lectura (números, uso, estado de mensaje) autenticado por API key** — un desarrollador que integra desde Python/Node/PHP/cURL puede CREAR mensajes, pero no puede CONSULTAR nada sin una sesión de navegador. Esto es exactamente el vacío que Fase 4 debe cerrar (ver sección 3).

### 1.3 Lo que NO existe todavía (funciones nuevas necesarias, no arquitectura nueva)

| Falta | Para qué | Tipo de cambio |
|---|---|---|
| `obtenerJobDelWorkspace` expuesto vía HTTP con proyección pública | `GET /api/v1/messages/:id` | Nuevo handler delgado sobre función YA existente (`lib/developer/jobs-store.ts`) |
| Función de agregación de uso por workspace | `GET /api/v1/usage` | Nueva función en `usage-ledger.ts` (un `SELECT`/`count` agregado sobre la tabla existente — no una tabla ni sistema nuevo) |
| Capa de autenticación por API key para rutas de **lectura** (`whatsapp-numbers`, `messages/:id`, `usage`, `me`, `webhooks`) | Todos los GET nuevos | Nuevo wrapper `conWorkspaceAutenticadoPorApiKey`, análogo a `conWorkspaceAutenticado` pero usando `autenticarApiKey` en vez de sesión |
| Categorías de rate limit para Developer API | Límite de Fase 0 (2 msg/s por número) | Nuevas entradas en el preset ya existente de `lib/rate-limit.ts`/nuevo uso de la RPC ya existente — no una tabla ni mecanismo nuevo |
| `request_id` por request pública | Observabilidad/trazabilidad | Nuevo (no existía ni en el diseño original de Fase 1 ni en el código real) |
| Envoltorio de error uniforme `{error:{code,message,request_id}}` | Todos los endpoints públicos | Nuevo — ver hallazgo #3 abajo |

### 1.4 Deuda técnica encontrada durante esta inspección (nueva, no reportada antes)

**Hallazgo #2 — el contrato real de `POST /api/v1/messages` divergió del diseño original de Fase 1, y la versión real (probada, desplegada) es la que manda:**

| | Fase 1 (diseño original, `docs/DULABS_DEVELOPER_V1_PHASE_1_ARCHITECTURE.md`) | Código real (Fase 3, 147/147 tests, desplegado) |
|---|---|---|
| Campo de número | `phone_number_id` (snake_case) | `whatsappNumberId` (camelCase, id interno de `dulabs_dev_whatsapp_numbers`, NO el `phone_number_id` crudo de Meta) |
| Status HTTP de éxito | `202` | `201` |
| Body de respuesta | `{job_id, status, correlation_id}` (snake_case) | `{jobId, status}` (camelCase, sin `correlation_id`) |
| Forma del error | `{error:{code,message}}` | `{error: "string plano"}` |

Ninguna de las dos versiones es "la correcta" por decreto — la real es la que tiene 147 tests reales y tráfico de smoke test real contra infraestructura viva. **Decisión que requiere tu aprobación explícita antes de implementar** (sección 22, decisión D1): mantener el contrato real tal cual (camelCase, 201, sin `correlation_id`) o normalizar a snake_case + envoltorio de error estructurado ahora, que es el único momento donde hacerlo no rompe a ningún desarrollador real (todavía no hay ninguno integrado).

**Hallazgo #3 — el error model hoy es inconsistente entre endpoints:** algunos devuelven `{error: "texto"}` (outbound-handler, management-handler), sin código ni `request_id`. Fase 4 necesita resolver esto de una vez para TODOS los endpoints, no solo los nuevos — ver sección 12.

**Hallazgo #4 — posible índice redundante en Fase 3, pendiente de aplicar:** la migración `20261010000000_dulabs_developer_v1_fase3_retry_pending_idx.sql` (cierre de Fase 3, riesgo #2, **todavía sin aplicar**) crea `dulabs_dev_jobs_retry_pending_idx on (status) where status='retry_pending'`. Pero la migración de Fase 2 (`20261007000000...`) **ya tiene** `dulabs_dev_jobs_retry_idx on (next_attempt_at) where status='retry_pending'` — un índice parcial con el mismo predicado. Postgres puede usar ese índice existente para filtrar por `status='retry_pending'` igual de bien para el patrón de consulta actual (no hay `ORDER BY next_attempt_at` en el barrido real). Recomendación: antes de aplicar la migración pendiente de Fase 3, evaluar si de verdad aporta algo sobre el índice ya existente, o si se puede descartar. No es un defecto funcional (el código funciona igual con o sin ella), es una posible duplicación de mantenimiento. Lo dejo señalado, no lo toco — no es parte del alcance de Fase 4 y tocar una migración de Fase 3 ahora violaría "no modifiques Fase 3".

**Hallazgo #5 — `lib/developer/events-store.ts` solo registra eventos INBOUND (recepción de Meta), no hay ningún log unificado de eventos outbound (creado/encolado/enviando/enviado/fallido) por job.** Esto es relevante para la decisión sobre `GET /api/v1/events` (sección 3.7) — hoy no existe una fuente de datos coherente para ese endpoint sin invertir en algo nuevo.

**No se encontró ninguna otra duplicación de lógica ni contradicción con Fase 1/2/3.**

---

## 2. Arquitectura de Fase 4

**No se agrega ningún componente de infraestructura nuevo.** Fase 4 es una capa de superficie HTTP (nuevos handlers delgados en `services/gateway/`) sobre los stores ya existentes. El Gateway sigue sin llamar a Meta directamente — sigue publicando a Pub/Sub, los Workers siguen siendo los únicos que tocan `graph.facebook.com`.

```
Developer (cualquier lenguaje/herramienta)
   │ Authorization: Bearer dl_live_...
   ▼
Cloud Run Gateway  (SIN CAMBIOS de infraestructura)
   │
   ├─ POST /api/v1/messages          (existe — sin cambios de lógica interna)
   ├─ GET  /api/v1/messages/:id      (nuevo — lee jobs-store + events-store)
   ├─ GET  /api/v1/whatsapp-numbers  (nuevo — lee whatsapp-numbers-store)
   ├─ GET  /api/v1/usage             (nuevo — lee usage-ledger, función nueva de agregación)
   ├─ GET  /api/v1/me                (nuevo — resuelve workspace + resumen mínimo)
   ├─ GET  /api/v1/webhooks          (nuevo — lee webhook-config-store)
   │
   └─ (sin cambios) /api/v1/dev/*, /api/v1/webhooks/meta
   │
   └─▶ Pub/Sub ─▶ Workers ─▶ Meta   (EXACTAMENTE igual que Fase 3)
```

Nueva capa de autenticación (`services/gateway/api-auth.ts`, propuesto): un wrapper análogo a `conWorkspaceAutenticado` pero para API key, reutilizando `autenticarApiKey` sin modificarla.

---

## 3. API Contract — endpoints

Todos bajo `Authorization: Bearer dl_live_...` salvo que se indique lo contrario. Todos devuelven `Content-Type: application/json`. Todos incluyen `X-Request-Id` en la respuesta (ver sección 13).

### 3.1 `POST /api/v1/messages` (existente, sin cambios de lógica)

Igual que hoy: `autenticarApiKey` → validación → `crearJobConIdempotencia` (idempotencia + reserva de uso, ya activa) → publish a `dulabs-outbound`.

**Cambio propuesto (solo envoltorio de respuesta, no de lógica):** adoptar el error model uniforme (sección 12) — sigue devolviendo `{jobId, status}` en éxito (decisión D1 pendiente sobre si normalizar nombres).

Rate limit: **2 mensajes/segundo por `whatsapp_number_id`** (Fase 0), verificado ANTES de `crearJobConIdempotencia` — una request rate-limited nunca reserva uso ni crea idempotencia.

### 3.2 `GET /api/v1/messages/:id` (nuevo)

| | |
|---|---|
| Auth | API key |
| Permisos | El job debe pertenecer al `workspace_id` de la API key — reusa `obtenerJobDelWorkspace(supabase, {workspaceId, jobId})`, que YA filtra por ambos campos en la misma query (no es "traer y comparar después") |
| Response 200 | `{ id, status: <PUBLIC status, ver sección 11>, to, whatsappNumberId, createdAt, updatedAt }` — nunca el payload interno completo de Meta, nunca `lease_id`/`version_token`/`physical_outcome` crudo |
| 404 | Job no encontrado en ese workspace (mismo código para "no existe" y "existe pero es de otro workspace" — nunca reveles la diferencia, ver sección 6) |
| Idempotencia | N/A (GET) |
| Rate limit | Categoría "lectura" (ver sección 8) |

### 3.3 `GET /api/v1/whatsapp-numbers` (nuevo)

| | |
|---|---|
| Auth | API key |
| Response 200 | `{ numbers: [{ id, phoneNumberId, displayName, status, createdAt }] }` — reusa `listarNumeros`, cuya proyección (`CAMPOS_PUBLICOS`) YA excluye el token cifrado de Meta |
| Permisos | `listarNumeros` ya filtra por `workspace_id` — sin cambios necesarios |

`GET /api/v1/whatsapp-numbers/:id` (variante con id) — recomendado agregar también, reusa `obtenerNumeroDelWorkspace`, mismo patrón de 404 que 3.2.

### 3.4 `GET /api/v1/usage` (nuevo)

| | |
|---|---|
| Auth | API key |
| Función nueva necesaria | `obtenerResumenUsoDelWorkspace(supabase, {workspaceId, desde?, hasta?})` en `lib/developer/usage-ledger.ts` — un `SELECT count(*) ... GROUP BY estado` sobre `dulabs_dev_usage_ledger` filtrado por `workspace_id`. **No es un sistema nuevo de billing** — es una lectura agregada sobre la tabla que ya existe y que Fase 3 ya activó. |
| Response 200 | `{ period: {from, to}, reserved: N, confirmed: N, released: N }` — cantidades técnicas, explícitamente NO un monto en dinero (eso es Fase 5+, billing comercial) |
| Preparación futura | El shape deja espacio para agregar `plan`/`limit`/`remaining` en una fase posterior sin romper el contrato — pero **no se implementa todavía**, por instrucción explícita |

### 3.5 `GET /api/v1/me` (nuevo, recomendado)

| | |
|---|---|
| Auth | API key |
| Response 200 | `{ workspaceId, apiKeyId, apiKeyPrefix, apiKeyName }` — nunca la key completa (estructuralmente irrecuperable de todos modos, ver `lib/developer/api-keys.ts`) |
| Utilidad | Permite a un desarrollador/script confirmar en una sola llamada que su API key funciona y a qué workspace pertenece — patrón estándar (`GET /v1/account` de Stripe, `GET /v2/me` de casi cualquier API pública) |

### 3.6 `GET /api/v1/webhooks` (nuevo, recomendado — ver decisión D2)

| | |
|---|---|
| Auth | API key |
| Response 200 | `{ webhooks: [{ whatsappNumberId, url, status, updatedAt }] }` — reusa `obtenerWebhookDelNumero` por cada número, o una función de listado nueva análoga a `listarNumeros`. **Nunca** el secreto HMAC (ya se maneja así hoy — `obtenerWebhookDelNumero` no lo proyecta) |
| Nota | Es de **solo lectura**. Configurar (`POST`) sigue siendo `/api/v1/dev/webhooks` (sesión) por ahora — ver decisión D2 sobre si esto debe cambiar |

### 3.7 `GET /api/v1/events` — **NO recomendado para V1**

Razón (hallazgo #5): `dulabs_dev_events` hoy solo registra eventos **inbound** (mensajes recibidos de Meta), no hay ningún log unificado del ciclo de vida outbound (creado→encolado→enviando→confirmado/fallido) indexado por job de forma que tenga sentido como endpoint público. Construir eso ahora sería lógica nueva no pedida explícitamente ("no dupliques lógica existente" corta en ambos sentidos: tampoco inventar una nueva donde no hay una clara). El caso de uso real ("¿qué pasó con mi mensaje?") ya lo cubre `GET /api/v1/messages/:id`. Recomendación: diferir a una fase posterior si surge una necesidad real de auditoría más granular.

---

## 4. Authentication

Sin cambios al mecanismo (`lib/developer/api-keys.ts`, ya correcto y probado):

- **Timing attacks**: `verificarApiKey` usa `timingSafeEqual` sobre hashes de longitud fija — ya mitigado. El lookup real (`autenticarApiKey`) además usa un índice único por hash (O(1)), no itera filas, así que no hay canal de timing por "cuántas filas comparó".
- **Brute force / enumeración**: el espacio de 32 bytes aleatorios hace inviable adivinar una key completa. Recomendación nueva para Fase 4: agregar rate limiting específico sobre intentos de auth FALLIDOS por IP (categoría nueva, ver sección 8) — hoy un atacante puede probar keys inválidas sin límite (**riesgo real, ver sección 14, amenaza #1**).
- **Replay**: no aplica en el sentido clásico — la API key no es un token de un solo uso, es una credencial persistente (como cualquier API key de la industria). El vector real es el robo del valor, no el replay de una request firmada.
- **Expiración/revocación**: `revoked_at` ya existe y ya se verifica en `autenticarApiKey`. No hay expiración automática por tiempo (TTL) — **decisión pendiente** (sección 22, D3): ¿se quiere TTL para V1, o revocación manual es suficiente?
- **Rotación**: no existe una función `rotarApiKey` dedicada, y no hace falta una nueva — el patrón ya soportado (crear una nueva vía `POST /api/v1/dev/api-keys`, revocar la vieja vía `DELETE` cuando el desarrollador confirme la migración) ya cubre rotación segura con los dos primitivos existentes.
- **Scopes futuros**: la tabla `dulabs_dev_api_keys` no tiene columna de scopes hoy. Documentado como extensión futura (Fase 5+), no bloqueante para V1 (todas las API keys son de alcance completo sobre su workspace, consistente con "múltiples números desde un mismo workspace" del objetivo de Fase 4).
- **Nunca en logs/errores/respuestas posteriores**: ya es el comportamiento real — `crearApiKey` devuelve la clave en claro UNA vez, nunca se vuelve a leer de la base (`key_hash` es de un solo sentido). Falta verificar (acción de Fase 4, no de este documento): que ningún `console.log`/log de Cloud Run imprima el header `Authorization` completo — recomendación explícita para el test plan (sección 18).

---

## 5. Authorization / Multi-tenancy

**Regla ya estructuralmente garantizada hoy, no una promesa de código de aplicación:** cada función de store que lee un recurso por id (`obtenerJobDelWorkspace`, `obtenerNumeroDelWorkspace`, `obtenerWebhookDelNumero`, `obtenerLedgerDelJob`) filtra por `id` Y `workspace_id` **en la misma query** — nunca "traer por id, comparar workspace_id después en JS". Esto ya es la mitigación real contra IDOR, probada explícitamente en `lib/developer/rls-isolation.e2e.test.ts` y en tests individuales de cada store ("un workspace no puede leer el job de otro aunque conozca el jobId exacto").

Cadena de validación para Fase 4 (todos los endpoints nuevos deben seguirla, sin excepción):

```
API Key → autenticarApiKey → workspaceId (nunca confiado del cliente)
   → cualquier recurso (jobId, whatsappNumberId, webhookId)
      → SIEMPRE consultado como (id, workspaceId) en una sola condición WHERE
```

RLS (`dulabs_tenant_del_usuario()`) sigue siendo defensa en profundidad para el caso de acceso directo a Postgres con una sesión de usuario — el Gateway corre con `service_role` (bypassea RLS por diseño), así que la validación real y obligatoria vive en el código de los stores, no en RLS. Esto ya está así desde Fase 2/3, sin cambios.

---

## 6. Idempotencia

Sin cambios — `lib/developer/idempotency.ts` + `crearJobConIdempotencia` ya implementan exactamente el contrato pedido:

| Caso | Comportamiento actual (a preservar) |
|---|---|
| Misma key + mismo payload | `200`, mismo `jobId`, cero reserva nueva (ya validado en el cierre de Fase 3) |
| Misma key + payload distinto | `409` |
| N requests concurrentes, misma key | `UNIQUE(workspace_id, idempotency_key)` real de Postgres deja pasar solo una a "nuevo" — probado con 5 requests concurrentes reales |
| Reserva de usage duplicada | Imposible — `UNIQUE(job_id)` en `dulabs_dev_usage_ledger` |
| Envío físico duplicado | Imposible — lease/CAS del Worker outbound, probado con Worker A/B concurrentes reales |

**Límites de tamaño de key**: no hay un límite explícito hoy (columna `text`). Recomendación para el contrato público V1: documentar un máximo razonable (ej. 255 caracteres) y rechazar con `400 invalid_request` antes de tocar la base — validación nueva y trivial, no cambia el mecanismo.

**Expiración futura**: la tabla no tiene TTL/limpieza automática todavía (documentado ya en Fase 1 como "ventana de retención lógica: 24h, aplicada por limpieza periódica, no por diseño de la tabla" — esa limpieza periódica **nunca se implementó**). Señalado como pendiente operativo, no bloqueante para V1 (la tabla simplemente crece; a la escala de "50 desarrolladores" no es un problema inmediato, sí lo será a mayor escala — **riesgo de rendimiento a largo plazo, ver sección 15**).

---

## 7. Public Job States — separación INTERNAL vs. PUBLIC

| Estado interno | `physical_outcome` | Status público propuesto | Por qué se oculta el interno |
|---|---|---|---|
| `created` | `pre_send` | `queued` | El desarrollador no necesita saber si ya se le asignó un lease o no |
| `queued` | `pre_send` | `queued` | — |
| `sending` | `pre_send` | `queued` | Exponer "sending" en tiempo real no aporta nada útil y puede confundir (la ventana es de milisegundos) |
| `success_confirmed` | `success_confirmed` | `sent` | Terminal, éxito |
| `failed_by_meta` | `pre_send` | `failed` | Terminal, fallo cierto |
| `retry_pending` | `pre_send` | `queued` | El desarrollador no debe diferenciar "primer intento" de "reintento interno" — es un detalle de implementación |
| `reconciliation_pending` | `uncertain` | `queued` | **Decisión importante, ver D4**: exponer `uncertain`/`processing` en vez de `queued` sería más honesto (el mensaje puede o no haberse enviado), pero también expone un detalle interno delicado (riesgo #4 de Fase 3: hoy este estado no tiene resolución automática real). Recomendación: exponer como `queued` para V1, y documentar honestamente en la respuesta con un campo opcional adicional si se decide (ver D4) |

Cuatro valores públicos: `queued`, `sent`, `failed`, y opcionalmente un quinto si se aprueba D4. Nunca se expone `lease_id`, `version_token`, `network_attempts`, ni `physical_outcome` crudo.

---

## 8. Rate Limiting

**No se necesita un mecanismo nuevo — ya existe uno real, distribuido, atómico y en Postgres** (`lib/rate-limit.ts` + RPC `dulabs_rate_limit_incrementar`, Fase 11 del producto Business, ya en producción). Es exactamente la solución que la instrucción pide ("si se necesita persistencia/estado distribuido, propón la solución compatible con la arquitectura actual") — ya está construida.

Por qué es seguro reutilizarlo bajo carga de Cloud Run: el contador vive en una tabla Postgres (`dulabs_rate_limit_counters`) con `PRIMARY KEY (clave, ventana_inicio)` y un `UPSERT` atómico — no importa cuántas instancias de Cloud Run escalen simultáneamente, todas comparten el mismo contador real. Ventana fija (no sliding), fail-open (nunca bloquea la request real si el rate limiter falla).

**Propuesta para Fase 4** (nuevas categorías/claves, mismo mecanismo, sin cambios al código genérico):

| Límite | Clave | Ventana | Límite | Dónde se verifica |
|---|---|---|---|---|
| Fase 0: 2 msg/s por número | `dev-outbound:<whatsappNumberId>` | 1s | 2 | En `manejarMensajeSaliente`, ANTES de `crearJobConIdempotencia` — una request limitada nunca reserva uso |
| Protección de abuso por workspace | `dev-workspace-outbound:<workspaceId>` | 60s | configurable (ej. 300) | Mismo punto — protege contra un workspace con muchos números todos a tope simultáneamente |
| Auth fallida (mitiga brute force, hallazgo de la sección 4) | `dev-auth-fail:<hash-parcial-de-IP-o-key-prefix>` | 60s | ej. 20 | Antes de `autenticarApiKey`, o justo después si falla |
| Lectura (GET nuevos) | `dev-read:<workspaceId>` | 60s | ej. 300 (generoso, son solo lecturas) | En cada GET nuevo |

Response `429`: incluye `Retry-After` real (el mecanismo ya lo calcula, `respuestaSiLimiteTasaExcedido` ya construye ese header hoy para las rutas de dashboard — mismo patrón).

Sobre **bursts/backpressure a nivel de Pub/Sub**: sin cambios — Pub/Sub ya absorbe bursts de publicación real (probado en Fase 3, DLQ y retry/backoff reales); el rate limit del Gateway protege el ingreso, no hace falta backpressure adicional entre Gateway y Worker.

---

## 9. Usage

Ya activado en producción desde el cierre de Fase 3 (riesgo #6). Fase 4 solo agrega **lectura** (`GET /api/v1/usage`, sección 3.4) sobre la tabla ya existente — cero cambios a `reservarUso`/`confirmarUso`/`liberarUso`. Explícitamente **sin** checkout, sin planes, sin límites duros todavía (el shape de respuesta deja espacio para agregarlos después sin romper el contrato).

---

## 10. Error Model

Adopta y **cierra** el modelo que Fase 1 ya había diseñado pero que el código real nunca implementó consistentemente (hallazgo #3):

```json
{
  "error": {
    "code": "invalid_api_key",
    "message": "mensaje legible, nunca un detalle de infraestructura",
    "request_id": "req_..."
  }
}
```

Códigos (extiende, no reemplaza, la lista ya documentada en Fase 1 — `invalid_request`, `unauthorized`→se especializa, `forbidden`, `rate_limited`, `idempotency_conflict`, `internal_error`):

| Código | HTTP | Caso |
|---|---|---|
| `missing_api_key` | 401 | Sin header `Authorization` |
| `invalid_api_key` | 401 | Key con formato inválido, no encontrada, o revocada |
| `invalid_request` | 400 | Body/campos inválidos |
| `invalid_whatsapp_number` | 400 | `whatsappNumberId` con formato inválido (antes de ni siquiera consultar la DB) |
| `forbidden` | 403 | Recurso existe pero pertenece a otro workspace — **usar con cuidado, ver sección 6 sobre por qué `messages/:id` prefiere 404** |
| `not_found` | 404 | Recurso no existe (o pertenece a otro workspace — mismo código, nunca reveles la diferencia) |
| `idempotency_conflict` | 409 | Misma key, payload distinto |
| `rate_limit_exceeded` | 429 | Ver sección 8 |
| `usage_limit_exceeded` | 429 | Reservado para cuando exista un límite real de plan (Fase 5+) — no se activa en V1 |
| `upstream_error` | 502/503 | Reservado para cuando el Gateway necesite reportar un fallo aguas abajo verificado (hoy no aplica — el Gateway nunca llama a Meta directamente) |
| `internal_error` | 500 | Nunca debe filtrar mensaje de infraestructura real (mismo criterio ya usado en el Worker) |

**Decisión pendiente (D5)**: ¿usar `403` o `404` quirúrgicamente para "existe pero es de otro workspace"? Recomendación: **siempre 404** para ese caso específico (no revela ni siquiera la existencia del recurso a quien no es su dueño) — `403` se reserva para casos donde el recurso SÍ es visible pero la acción está prohibida por otra razón (ninguno identificado todavía para V1).

---

## 11. Public Job States

Ver sección 7 (integrado ahí para evitar duplicar la tabla).

---

## 12. Error Model

Ver sección 10 (el índice del enunciado original los separa; en este documento se consolidan para no repetir la tabla).

---

## 13. Request IDs / Observabilidad

**Nuevo — no existía ni en el diseño de Fase 1 ni en el código real** (el `correlation_id` que Fase 1 prometía nunca se implementó).

Propuesta mínima, sin infraestructura nueva:

- El Gateway genera un `request_id` (`req_<uuid>`) al inicio de cada request pública.
- Se incluye en TODA respuesta (éxito y error) como header `X-Request-Id` y dentro del body de error (`error.request_id`).
- Se propaga como **atributo del mensaje de Pub/Sub** (`attributes: {requestId}`, Pub/Sub ya soporta atributos, no se usa hoy pero no requiere cambio de infraestructura) — así un log del Worker puede correlacionarse con el request original sin tocar la base de datos.
- Se incluye en cualquier log real (`console.log`/Cloud Logging) que el Gateway o los Workers ya emiten — no se agregan nuevos sistemas de logging, se enriquece el existente.

Cadena de trazabilidad resultante: `request_id` (Gateway) → `job_id` (ya existe) → `event_id` (ya existe, inbound) — suficiente para reconstruir "qué pasó con esta request" sin exponer nunca secretos en logs (regla ya vigente en todo el proyecto).

---

## 14. Security Threat Model (adversarial)

| # | Ataque | Impacto | Mitigación (existente o propuesta) | Test requerido |
|---|---|---|---|---|
| 1 | Robar API Keys (phishing, logs, repos) | Acceso total al workspace | Ya mitigado: hash irreversible, nunca se muestra dos veces, nunca en logs (verificar en test plan) | Grep de logs reales de Cloud Run buscando el header `Authorization` — debe salir vacío |
| 2 | Acceder a otro workspace (IDOR) | Lectura/escritura cross-tenant | Ya mitigado estructuralmente (sección 5) — extender a los 5 endpoints nuevos | E2E: crear recurso en workspace A, intentar leerlo con key de workspace B → 404 |
| 3 | Enumerar números/jobs por id secuencial | Descubrir recursos de otros | IDs son `uuid` (no secuenciales) — ya mitigado por diseño de esquema | Confirmar que ningún endpoint nuevo devuelve IDs incrementales |
| 4 | Duplicar mensajes | Costo/spam duplicado | Idempotencia + lease/CAS ya probados (Fase 3) | Ya cubierto por la suite existente, sin cambios |
| 5 | Forzar doble reserva de usage | Ledger incorrecto | `UNIQUE(job_id)` ya lo hace estructuralmente imposible | Ya cubierto (Fase 3, cierre) |
| 6 | Bypassear rate limit (multi-IP, multi-key) | Abuso/costo | Rate limit por `whatsapp_number_id`/`workspace_id`, no por IP — un atacante con la key real de un workspace ya "es" ese workspace, no hay bypass vía IP | Test de concurrencia real contra el límite (mismo patrón ya usado en Fase 3 para usage_ledger) |
| 7 | Cargas masivas (muchos mensajes rápido) | Costo, saturación | Rate limit por número + por workspace (sección 8) | Test de burst real |
| 8 | Explotar payloads (mensajes malformados, muy grandes) | DoS, error 500 no controlado | Validación de tamaño/forma ANTES de tocar la DB — nuevo, trivial de agregar | Test con payload de 10MB, con campos faltantes, con tipos incorrectos |
| 9 | Abusar de mensajes de error para inferir info | Enumeración indirecta | Mismo código (404) para "no existe" y "es de otro workspace" (sección 10, D5) | Test que compara timing/shape de ambas respuestas — deben ser indistinguibles |
| 10 | Provocar costos (spam de mensajes válidos hacia números reales) | Costo de Meta, reputación del número | Rate limit + usage ledger ya activo (visibilidad real de consumo) | N/A nuevo, ya cubierto |
| 11 | Provocar retries artificiales | Carga en Pub/Sub/Workers | Ya mitigado — el Gateway nunca devuelve un código que dispare redelivery salvo error transitorio real (mismo criterio ya usado en los Workers) | Sin cambios |
| 12 | Race conditions en creación concurrente de jobs | Doble Job/doble reserva | Ya mitigado (idempotencia atómica, Fase 1/3) | Ya cubierto |
| 13 | Explotar autoscaling de Cloud Run (cold starts, rate limit "por instancia") | Bypass de límites si el rate limiter fuera en memoria | **Por diseño, no aplica** — el rate limiter propuesto es Postgres, no en memoria (sección 8) | Test con múltiples invocaciones simuladas concurrentes reales |
| 14 | Atacar Pub/Sub indirectamente (mensajes basura) | Solo alcanzable ya autenticado y con `whatsapp_number_id` válido del propio workspace — superficie ya acotada | Sin cambios, ya mitigado por la validación previa | N/A |
| 15 | Explotar endpoints internos (`/dev/*` desde fuera) | Confusión de superficies de auth | Documentar explícitamente que `/dev/*` NUNCA debe aceptar una API key `dl_live_` como sesión, y viceversa — **verificar en test plan que están genuinamente separados** | Test: enviar una API key real como si fuera token de sesión a `/dev/numbers` → debe fallar, no debe "funcionar por accidente" |
| 16 | Timing/errores para inferir si una key existe pero está revocada vs. no existe | Enumeración de keys válidas | `autenticarApiKey` ya devuelve el mismo `401` genérico en ambos casos (revisar que el mensaje no diferencie) | Test de comparación de respuestas |
| 17 | Manipular `Idempotency-Key` (muy larga, con caracteres de control, vacía) | DoS/corrupción de datos | Validación de tamaño/forma nueva (sección 6) | Test con keys adversariales |
| 18 | Manipular IDs (`whatsappNumberId` de otro workspace, UUID inventado) | IDOR | Ya mitigado (sección 5) | Ya cubierto por el patrón de test de la sección 5 |
| 19 | SSRF vía configuración de webhook | Acceso a red interna de GCP | Ya mitigado — `ssrf-guard.ts`, probado en Fase 2/3 | Sin cambios, ya cubierto |
| 20 | Privilege escalation (de lectura a escritura, de un recurso a gestión) | Acceso no autorizado a `/dev/*` con una API key | Los wrappers de auth deben ser **genuinamente distintos** (no un `if` que acepte ambos tipos de token) — ver amenaza #15 | Mismo test que #15 |

---

## 15. Performance / Escalabilidad

Diseñado para crecer más allá de "50 desarrolladores mañana" sin rediseño:

| Punto | Análisis |
|---|---|
| Cloud Run concurrency | Sin cambios — el Gateway ya es stateless, escala horizontalmente sin coordinación (ya probado con cold starts reales en Fase 3) |
| Conexiones a Postgres | Supabase ya pool-ea vía PgBouncer (Supavisor) — el patrón `supabase-js` con `service_role` ya usado en los 4 servicios no abre conexiones directas persistentes por instancia. Sin cambios necesarios para V1; a escala mucho mayor (cientos de instancias Cloud Run concurrentes) esto merece revisión, no ahora |
| Contención de Postgres / hot rows | El riesgo real es el contador de rate limit por número muy activo (`dulabs_rate_limit_counters`, `UPSERT` por mensaje) — ya diseñado para esto (Fase 11), con cleanup oportunista sin cron dedicado. A "2 msg/s por número" el volumen de escritura es trivial incluso con cientos de números activos simultáneos |
| Índices | `whatsapp-numbers`/`jobs`/`usage_ledger` ya indexados por `workspace_id` (Fase 2). `GET /api/v1/usage` con agregación necesita confirmar que el índice de `workspace_id` en `usage_ledger` (ya existe) es suficiente para un `count`/`group by` rápido — sí, a la escala actual |
| Locks/CAS | Sin cambios — lease/CAS de jobs y `UNIQUE` de usage_ledger ya probados bajo concurrencia real (Fase 3) |
| Bursts | Absorbidos por Pub/Sub (sin cambios) y por el rate limiter de ventana fija (acepta hasta 2x el límite en el borde de una ventana — limitación conocida y aceptada, documentada ya en el diseño original del rate limiter) |
| Backpressure | No se necesita uno nuevo — Pub/Sub + DLQ ya son el mecanismo de backpressure real, probado en Fase 3 |

---

## 16. Database Impact

**Cero migraciones destructivas.** Cambios de esquema propuestos (a implementar solo tras aprobación, NO ahora):

- Ninguna tabla nueva obligatoria. `GET /api/v1/usage` se resuelve con una query de agregación sobre `dulabs_dev_usage_ledger` (existente).
- Posible índice nuevo (a evaluar en implementación, no decidido aquí): si `GET /api/v1/usage` con filtro de fechas resulta lento a escala, un índice sobre `(workspace_id, created_at)` en `dulabs_dev_usage_ledger` — hoy solo existe `(workspace_id)`. **No implementar preventivamente** — medir primero.
- Ninguna migración de Fase 1/2/3 se modifica.

---

## 17. Migration Requirements

Ninguna migración es estrictamente necesaria para el contrato mínimo de Fase 4 (todos los `SELECT`s nuevos funcionan sobre el esquema ya existente). Si en implementación se decide agregar el índice mencionado en la sección 16, sería la única migración nueva de esta fase — aditiva, `CREATE INDEX IF NOT EXISTS`, mismo patrón ya usado en todas las migraciones de Developer V1.

La migración pendiente de Fase 3 (`retry_pending_idx`) permanece **fuera del alcance de Fase 4** — no se toca, no se revierte, queda pendiente de tu decisión (hallazgo #4).

---

## 18. Test Plan (a ejecutar solo tras aprobación e implementación)

Mismo estándar que Fase 3 (E2E reales contra Postgres, sin mocks en integración):

1. Cada endpoint nuevo: caso feliz + cada código de error de la sección 10.
2. Multi-tenancy: para cada endpoint nuevo, crear el recurso en workspace A, intentar acceder con key de workspace B → `404`.
3. Idempotencia en `POST /api/v1/messages`: sin cambios (ya cubierto), pero agregar un test específico de tamaño/forma de `Idempotency-Key` inválida.
4. Rate limiting: test de concurrencia real (N requests simultáneas) contra el límite de 2 msg/s por número — mismo patrón que la prueba de concurrencia del usage_ledger en el cierre de Fase 3.
5. Auth: API key inválida en cada endpoint nuevo → `401` uniforme; intentar usar una sesión Supabase Auth en un endpoint de API key (y viceversa) → debe fallar genuinamente (amenaza #15/#20).
6. Request ID: presente y consistente en éxito y error, en headers y en el body de error.
7. Grep de logs reales de Cloud Run (tras un deploy real a un entorno de prueba) buscando el valor de `Authorization` — debe estar ausente.
8. Regresión completa: los 147 tests actuales de Developer V1 deben seguir en verde — ningún cambio de Fase 4 debe tocar `outbound-state-machine.ts`, `jobs-store.ts` (mutación), `usage-ledger.ts` (mutación), ni la lógica interna de los Workers.

---

## 19. Rollout Plan (propuesto, no ejecutado)

1. Implementar los handlers nuevos + wrapper de auth por API key, sin tocar ningún handler existente.
2. Desplegar detrás del mismo Gateway (nueva imagen, mismo servicio Cloud Run) — igual patrón que cada fix de Fase 3 (build → deploy → smoke test real).
3. Verificar con smoke tests reales contra la infraestructura desplegada (mismo patrón ya establecido en Fase 3) antes de considerar el rollout completo.
4. Sin flag de feature necesario — son endpoints nuevos, aditivos, no hay tráfico real de terceros todavía que pueda romperse.

## 20. Rollback Plan (propuesto)

Mismo mecanismo ya usado y probado en Fase 3: revertir el tráfico del servicio Cloud Run `dulabs-gateway` a la revisión anterior (`gcloud run services update-traffic`). Ningún cambio de esquema destructivo significa que un rollback de código nunca deja datos huérfanos o inconsistentes.

---

## 21. Riesgos

1. **Riesgo heredado de Fase 3 (riesgo #4, sin resolver, fuera de alcance de Fase 4)**: `reconciliation_pending` sigue sin confirmación automática real — un job en ese estado, consultado vía `GET /api/v1/messages/:id`, se expondrá como `queued` (sección 7), lo cual es honesto pero no informa al desarrollador que hay incertidumbre real. Documentar en la documentación pública de la API cuando exista (fuera de alcance de este documento).
2. **Ventana fija del rate limiter permite ráfagas de hasta ~2x en el borde de una ventana** — limitación conocida y aceptada del mecanismo ya existente, no introducida por Fase 4.
3. **Sin TTL real en `dulabs_dev_idempotency_keys`** — crecimiento no acotado a largo plazo (decisión D6, sección 22).
4. **Índice potencialmente redundante de Fase 3 sin aplicar** (hallazgo #4) — no es un riesgo de Fase 4, pero afecta la decisión de si aplicar esa migración pendiente.
5. **Decisión D1 sin resolver bloquea el contrato final de `POST /api/v1/messages`** — cualquier normalización de nombres de campo debe decidirse ANTES de que exista un desarrollador real integrado (es la única ventana sin costo de breaking change).

---

## 22. Decisiones que requieren tu aprobación antes de implementar

- **D1** — ¿Mantener el contrato real de `POST /api/v1/messages` tal cual (camelCase, `201`, sin `correlation_id`), o normalizar a snake_case + `correlation_id` ahora (única ventana sin breaking change real)?
- **D2** — ¿`POST /api/v1/webhooks` (configurar) debe aceptar también autenticación por API key en Fase 4, o se mantiene exclusivamente por sesión (`/api/v1/dev/webhooks`) hasta una fase posterior?
- **D3** — ¿Se quiere TTL/expiración automática por tiempo para las API keys en V1, o revocación manual es suficiente?
- **D4** — ¿Se expone `reconciliation_pending` de alguna forma distinguible al desarrollador (ej. un status público `processing` en vez de agruparlo bajo `queued`), aceptando que hoy no tiene resolución automática real (riesgo #4 de Fase 3)?
- **D5** — Confirmar el criterio de `404` (no `403`) para "recurso de otro workspace" en todos los endpoints nuevos.
- **D6** — ¿Implementar ya un cleanup periódico real para `dulabs_dev_idempotency_keys` (nunca se hizo, documentado desde Fase 1), o diferirlo?
- **D7** — ¿`GET /api/v1/whatsapp-numbers/:id` se agrega en V1 (recomendado, trivial) o se difiere?
- **D8** — Confirmar los valores numéricos exactos de rate limit por workspace (sección 8 propone un valor ilustrativo, no definitivo) — depende de decisiones de producto que Claude no puede tomar unilateralmente.

---

## Archivos revisados en esta inspección

`lib/developer/*.ts` (los 14 stores + sus pares de test), `services/gateway/*.ts` (server, outbound-handler, inbound-handler, management-handler, index), `services/worker-outbound/*.ts`, `services/worker-inbound/*.ts`, `services/reconciliation/*.ts`, `services/shared/*.ts`, las 5 migraciones de `supabase/migrations/*developer*`, `lib/rate-limit.ts`, `supabase/migrations/20261001000000_dulabs_rate_limit.sql`, y los 4 documentos de `docs/DULABS_DEVELOPER_V1_PHASE_*`.

**Ningún test fue ejecutado durante esta inspección** — fue lectura de código y esquema únicamente, sin necesidad de correr la suite para producir este diseño.

---

## Estado

**FASE 4 — DISEÑO, pendiente de aprobación.** No implementar hasta recibir luz verde explícita sobre las decisiones de la sección 22.
