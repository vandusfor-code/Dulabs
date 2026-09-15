# DuLabs Developer V1 — Fase 3: Diseño Técnico de Infraestructura GCP

**Estado de este documento: DISEÑO FINAL PARA REVISIÓN — NADA EJECUTADO.** Ningún recurso de GCP fue creado, modificado ni eliminado para producir este documento. Todos los nombres/comandos de abajo son **propuestas** pendientes de aprobación final de ChatGPT antes de cualquier `gcloud create`/`update`/`deploy`.

Continúa sobre la auditoría inicial de Fase 3 y sobre las dos rondas de decisiones arquitectónicas ya cerradas por ChatGPT. Este documento incorpora **todas** las correcciones de la revisión final: identidad de invocación de Pub/Sub push separada de la identidad runtime de los Workers, Scheduler con autenticación OAuth (no OIDC) contra la API v2 de Cloud Run Jobs, endpoint inbound de Meta definido y cerrado dentro del Gateway, Management API cerrada en Cloud Run, Budget Alert de $20/mes, corrección del criterio de test de DLQ, y eliminación de `--max-instances=0` como mecanismo de rollback.

**Hallazgo relevante para el diseño de cifrado** (verificado por lectura real, no asumido): las tablas `dulabs_dev_whatsapp_numbers`, `dulabs_dev_webhook_configs`, `dulabs_dev_api_keys` y `dulabs_dev_jobs` tienen **0 filas reales en producción** — todo lo probado hasta ahora fue con workspaces desechables limpiados en cada test. La migración a KMS envelope encryption (sección J) es un **cutover limpio**, sin datos legados que re-cifrar.

---

## A. Arquitectura final

```
Developer App
   │ POST /api/v1/messages
   ▼
┌──────────────────────────────────────────────────────────┐
│  dulabs-gateway (Cloud Run, público, min-instances=0)      │
│  - POST /api/v1/messages        (auth: dl_live_ API key)   │
│  - GET/POST /api/v1/webhooks/meta (verificación + firma)   │
│  - CRUD de gestión Developer V1  (auth: sesión Supabase)   │
└──────────┬───────────────────────────────┬─────────────────┘
           │ publish                       │ publish
           ▼                               ▼
   topic dulabs-outbound            topic dulabs-inbound
           │ PUSH (OIDC,                    │ PUSH (OIDC,
           │ dulabs-pubsub-invoker)         │ dulabs-pubsub-invoker)
           ▼                               ▼
┌───────────────────────┐        ┌──────────────────────┐
│ dulabs-outbound-worker │        │ dulabs-inbound-worker │
│ (Cloud Run, privado)   │        │ (Cloud Run, privado)  │
└──────────┬─────────────┘        └──────────┬────────────┘
           │                                  │ persiste
           ▼                                  ▼
     Meta Graph API                  PostgreSQL (Supabase)
                                              │
                                              ▼
                                     Developer Webhook
                                     (firmado HMAC, Fase 1)

Cloud Scheduler (*/5 * * * *)
   │ OAuth token, dulabs-scheduler-invoker, roles/run.invoker
   │ sobre el Job (API v2 de Cloud Run Jobs)
   ▼
dulabs-reconciliation (Cloud Run Job)
   │ consulta estado real
   ▼
Meta Graph API
   (nunca reenvía físicamente por su cuenta — solo mueve jobs
    de reconciliation_pending a retry_pending, ver sección G)

KMS (dulabs-developer-keyring) ── envelope encryption de los secretos
   PERSISTENTES del modelo de datos de Developer V1 (token de Meta por
   número, secreto de webhook por número) ── usado por dulabs-gateway
   (al escribir, vía el CRUD) y por los Workers/Reconciliation (al leer)

Secret Manager ── secretos de INFRAESTRUCTURA/operación, compartidos,
   no por-tenant (credenciales de Supabase, App Secret de Meta a nivel
   de plataforma) ── inyectados como env vars respaldadas por secreto

Vercel ── EXCLUSIVAMENTE frontend, dashboard UI, landing, documentación.
   Ninguna llamada directa de Vercel a KMS. Todo el CRUD de gestión de
   Developer V1 vive en el backend Cloud Run (dulabs-gateway).
```

### Decisiones ahora cerradas (ya no son puntos abiertos)

- **Dónde vive el CRUD de gestión** (API keys, números de WhatsApp, webhook configs, configuraciones de Developer V1): **backend Cloud Run**, dentro de `dulabs-gateway`. Vercel queda exclusivamente como frontend/dashboard UI/landing/documentación. No hay llamada de Vercel a KMS. No se introduce Workload Identity Federation en esta fase — queda descartada como innecesaria porque todo lo que toca KMS corre dentro de Cloud Run con su identidad nativa.
- **Dónde vive el endpoint inbound de Meta**: dentro de `dulabs-gateway`, no se reutiliza el webhook de Business (`/webhook-dulabs`) y no queda como "a decidir". Ver diseño completo en la subsección siguiente.
- **Separación de Workers**: dos Cloud Run services independientes, cada uno con su propia service account (sección H).

**Nota de implementación, no de producto**: dejo a criterio técnico (no bloqueante) si el CRUD de gestión vive en el mismo servicio `dulabs-gateway` (como está dibujado arriba, menos recursos nuevos) o se separa en un servicio adicional `dulabs-management-api` más adelante si el volumen/aislamiento lo justifica — para V1 recomiendo mantenerlo unificado.

### Endpoint inbound de Meta — diseño completo

| Aspecto | Diseño |
|---|---|
| **Endpoint exacto** | `POST /api/v1/webhooks/meta` (recepción de eventos) + `GET /api/v1/webhooks/meta` (handshake de verificación de Meta), ambos en el servicio `dulabs-gateway` |
| **Verificación inicial de Meta (GET)** | Meta llama una sola vez, al configurar el webhook, con `hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`. El Gateway compara `hub.verify_token` contra el secreto `meta-webhook-verify-token` (Secret Manager, sección K). Si coincide: **200** con el valor exacto de `hub.challenge` en el cuerpo (texto plano). Si no coincide: **403**, sin revelar detalle. |
| **Autenticación/verificación de firma (POST)** | Meta firma cada webhook con la cabecera `X-Hub-Signature-256` (HMAC-SHA256 sobre el cuerpo crudo, con el App Secret de Meta a nivel de plataforma). El Gateway verifica esta firma **antes** de parsear o persistir nada — comparación en tiempo constante, mismo principio ya usado en `lib/developer/webhook-signature.ts` (ese módulo firma hacia el desarrollador; acá se necesita el verificador análogo para la firma que Meta envía hacia DuLabs). Firma inválida → **403** inmediato, nada se persiste. El App Secret vive en Secret Manager, nunca en variable de entorno plana. |
| **Validación del payload** | Se valida la forma mínima esperada (`entry[].changes[]`, estructura estándar de WhatsApp Cloud API). Un payload que no matchea la forma esperada se registra como evento `failed` (vía `registrarEvento`) y se responde igual 200 (ver "Respuesta HTTP" abajo) — no se publica a Pub/Sub. |
| **Dedupe** | Meta también reentrega webhooks (at-least-once de su lado). El Gateway calcula `event_id = SHA-256(canonicalización determinista del payload crudo)` — **no** el `wamid`/id del mensaje de WhatsApp (ver justificación y diseño exacto en la subsección "Diseño del `event_id`" más abajo) — y llama a `registrarEvento` (Fase 2, `UNIQUE(event_id)`) **antes** de publicar. Si `registrado: false` (ya se vio), el Gateway responde 200 sin publicar de nuevo — dedup estructural, no dependiente de que el código "recuerde" filtrar. |
| **Persistencia mínima antes de publicar** | El Gateway persiste el evento crudo (`registrarEvento`) de forma síncrona **antes** de intentar publicar a Pub/Sub. Si Pub/Sub falla después, el evento ya quedó trazado en Postgres, nunca se pierde silenciosamente. |
| **Publicación a `dulabs-inbound`** | Justo después de que la persistencia fue exitosa, el Gateway intenta publicar de forma **síncrona** en la misma request. Si el publish se confirma, marca `published_at = now()` en la misma fila (ver "Diseño del mecanismo de recuperación inbound" más abajo — reusa y extiende `dulabs_dev_events` de Fase 2, sin tabla paralela). El mensaje publicado lleva una referencia al evento ya persistido, no repite el payload completo de Meta. |
| **Respuesta HTTP** | Meta interpreta cualquier respuesta fuera de 200 (dentro de un plazo razonable) como fallo y reentrega agresivamente con su propio backoff. Por eso el Gateway responde **200 en casi todos los casos** — firma inválida es la única excepción dura (403). Payload malformado, evento duplicado, o cualquier caso ya manejado internamente responde 200 (ya quedó registrado como corresponde), evitando entrar en el ciclo de reintentos de Meta por razones que reintentar no arreglaría. |
| **Comportamiento si Pub/Sub falla** (evento ya persistido) | El Gateway responde igual 200 a Meta (el evento ya está seguro en Postgres, no se quiere que Meta reintente por un fallo que no es suyo) y deja la fila con `published_at = NULL`. **Mecanismo de recuperación ahora completamente definido** — ver subsección dedicada más abajo y sección G (el Job de reconciliación adopta esta responsabilidad adicional). Ya no es una pieza pendiente. |
| **Duplicados** | Cubiertos por el dedupe de `event_id` de arriba — estructural (`UNIQUE(event_id)`). |
| **Eventos fuera de orden** | Pub/Sub no garantiza orden de entrega entre mensajes distintos, aun con push. El diseño ya asume esto: el estado autoritativo de un job vive en `dulabs_dev_jobs.version_token` (Fase 2), nunca en el orden de llegada de eventos del log `dulabs_dev_events`. El Worker inbound no muta `dulabs_dev_jobs` a partir del orden de llegada — solo agrega al log de eventos y, si corresponde, dispara una transición que pasa por `outbound-state-machine.ts` (Fase 1), que ya rechaza transiciones inválidas sin importar el orden en que llegaron los eventos que las originan. |

### Diseño del `event_id` — corregido

**Problema con la versión anterior**: usar el `wamid` (id del mensaje de WhatsApp) como `event_id` es incorrecto porque un mismo mensaje produce *varios* webhooks distintos a lo largo de su ciclo de vida (`sent`, `delivered`, `read`), todos referenciando el mismo `wamid` — usar solo el `wamid` habría deduplicado incorrectamente eventos que son semánticamente distintos y que sí deben procesarse cada uno.

**Diseño corregido**: `event_id = SHA-256(canonicalización determinista del payload crudo del webhook)`.

1. **Qué datos participan**: el cuerpo JSON completo recibido en el `POST` de Meta — `object`, `entry[]` completo (incluye `id`, `changes[]`, y dentro de cada `change`, `field` y `value` con `metadata`, y `messages[]`/`statuses[]` según el tipo de evento, incluido su `timestamp` propio de Meta). No participan cabeceras HTTP, IP de origen, ni ningún dato generado por DuLabs al recibir la request (esos no son parte del evento que Meta describe, son metadata de transporte).
2. **Cómo se construye la canonicalización**: se parsea el JSON recibido y se re-serializa de forma determinista — las claves de cada objeto se ordenan alfabéticamente de forma recursiva en todos los niveles; el orden de los elementos dentro de arrays (`entry[]`, `changes[]`, `statuses[]`, `messages[]`) se preserva tal cual lo envía Meta (ese orden sí es parte del contenido semántico). El resultado se codifica en UTF-8 sin espacios/formato adicional, y se calcula `SHA-256` en hexadecimal sobre esos bytes. Esto neutraliza diferencias superficiales de serialización (orden de claves distinto, espacios) que podrían aparecer entre dos entregas del mismo evento sin que el contenido real haya cambiado — es la razón de canonicalizar en vez de hashear los bytes crudos de la request tal cual llegan.
3. **Por qué cumple los 3 requisitos exigidos**:
   - *Mismo webhook reentregado por Meta → mismo `event_id`*: una redelivery de Meta reenvía el mismo evento (mismo `timestamp`, mismo `status`/contenido) — la canonicalización produce el mismo string, el mismo hash.
   - *`sent` → `event_id` distinto de `delivered` → distinto de `read`*: Meta entrega cada transición de estado como un webhook HTTP separado, con `value.statuses[].status` y `value.statuses[].timestamp` distintos en cada caso — el payload canónico difiere estructuralmente entre los tres, y por lo tanto el hash difiere. Esto es una consecuencia estructural de cómo Meta emite estos eventos (nunca los combina en un solo webhook), no una regla que el código deba recordar aplicar.
4. **`UNIQUE(event_id)` se mantiene sin cambios** en `dulabs_dev_events` (Fase 2) — la corrección es exclusivamente sobre *cómo se calcula* el valor que se persiste ahí, no sobre la capa de persistencia/dedup en sí, que ya era correcta.

### Diseño del mecanismo de recuperación inbound — cerrado, sin dejarlo abierto

Resuelve el patrón `DB COMMIT → Pub/Sub PUBLISH → fallo/timeout/resultado incierto`, reusando y extendiendo `dulabs_dev_events` (Fase 2) — **sin tabla ni sistema paralelo**.

**A. Campo que identifica "persistido pero pendiente de publicación"**: se propone extender `dulabs_dev_events` (migración aditiva pequeña, **no aplicada en este documento**, a ejecutar en implementación) con dos columnas nuevas:
   - `published_at timestamptz null` — `NULL` = todavía no hay confirmación de publicación exitosa a Pub/Sub; no nulo = publicación confirmada, fila cerrada.
   - `intentos_publicacion int not null default 0` — contador de intentos de publicación (el síncrono del Gateway cuenta como el intento 1; cada barrido de recuperación que lo intenta de nuevo incrementa este contador).
   
   Índice parcial propuesto (mismo patrón ya usado en `dulabs_dev_jobs_reconciliation_idx` de Fase 2): `create index ... on dulabs_dev_events (created_at) where published_at is null` — hace barata la consulta de "qué está pendiente".

**B. Momento a partir del cual puede recuperarse**: `published_at IS NULL AND created_at < now() - interval '2 minutes'` — el margen de 2 minutos le da tiempo de sobra al intento síncrono original (Gateway, dentro de la misma request) para completarse por su cuenta antes de considerarlo "atascado".

**C. Proceso que lo recupera**: **no se crea un Cloud Run Job nuevo.** Se extiende el Job `dulabs-reconciliation` (sección G) — que de todas formas ya corre cada 5 minutos vía Cloud Scheduler — con un paso adicional al final de cada ejecución: barrer `dulabs_dev_events` con el filtro de B y republicar. Se elige reusar este Job (en vez de crear `dulabs-inbound-recovery` como recurso separado) precisamente para no introducir infraestructura nueva evitable, tal como se pidió — el costo marginal de esta responsabilidad extra sobre un Job que ya existe y ya se ejecuta es despreciable. Requiere una única IAM nueva sobre la SA ya existente: `dulabs-reconciliation@` necesita además `roles/pubsub.publisher` sobre el topic `dulabs-inbound` (agregado en la sección I).

**D. Cómo republica en `dulabs-inbound`**: para cada fila candidata, el Job publica un mensaje a `dulabs-inbound` con la misma referencia al evento que hubiera usado el Gateway (el `id`/`event_id` de la fila) — nunca reconstruye ni reinterpreta el payload, solo referencia la fila ya persistida. Si la llamada a `pubsub.publish()` se confirma exitosa, el Job ejecuta `UPDATE dulabs_dev_events SET published_at = now() WHERE id = :id AND published_at IS NULL` (mismo patrón CAS que el resto del proyecto) — si el `UPDATE` no afecta ninguna fila (porque el intento síncrono original del Gateway, o una ejecución paralela del barrido, ya la había marcado), no pasa nada más: no se duplica el estado.

**E. Cómo evita publicar infinitamente**: cada intento incrementa `intentos_publicacion`. Al llegar a un máximo propuesto de **5 intentos** (mismo número que `maxDeliveryAttempts` del resto del diseño, por consistencia) sin lograr `published_at` no nulo, el Job deja de reintentar esa fila automáticamente — no hay una DLQ nueva para esto (evitando otro sistema paralelo); la fila queda consultable con `published_at IS NULL AND intentos_publicacion >= 5`, tratada como caso de observabilidad/intervención manual, igual en espíritu al DLQ de Pub/Sub pero sin crear un recurso GCP adicional para un volumen que se espera sea prácticamente nulo.

**F. Qué sucede en cada escenario de fallo**:
   - *Publish falla* (Pub/Sub responde error explícito): se cuenta el intento, `published_at` sigue `NULL`, se reintenta en el próximo ciclo (5 min después) hasta el máximo de E.
   - *Publish con resultado incierto* (timeout de red hacia la API de Pub/Sub, sin confirmación ni error): se trata igual que un fallo — conservador, `published_at` sigue `NULL`, se reintenta. Esto puede producir una publicación duplicada real en Pub/Sub si el intento original en realidad sí había llegado — **aceptado explícitamente**, ver G.
   - *Publish funciona pero la confirmación se pierde* (Pub/Sub sí aceptó el mensaje, pero la respuesta a la llamada no llegó): mismo caso que el anterior — se reintenta, riesgo de duplicado en Pub/Sub, cubierto por G.
   - *El recovery procesa el mismo evento dos veces* (dos ejecuciones solapadas del Job, o carrera con el intento síncrono original del Gateway): protegido por el mismo `UPDATE ... WHERE published_at IS NULL` de D — como mucho una de las dos marca la fila; ambas pueden haber llamado a `publish()`, ver G para por qué eso es inofensivo.

**G. Por qué la republicación repetida es segura**: el mismo mecanismo que ya protege el resto del sistema — `event_id` único (`UNIQUE(event_id)` en `dulabs_dev_events`, sección Fase 2) combinado con que el **Worker inbound es idempotente por diseño** (debe verificar el evento ya persistido antes de aplicar cualquier efecto secundario adicional, nunca reinsertar ciegamente). Con esos dos elementos, cualquier número de mensajes duplicados en Pub/Sub para el mismo evento (ya sea por reentrega nativa de Pub/Sub, por el propio Worker recibiendo una redelivery, o por este mecanismo de recuperación publicando dos veces bajo un resultado incierto) es inofensivo a nivel de negocio — el sistema tolera at-least-once en **todas** las capas (Meta→Gateway, Gateway→Pub/Sub, recovery→Pub/Sub) apoyándose siempre en el mismo dedup, sin necesitar exactly-once en ninguna de ellas.

**H. Estado final del evento**:
   - `published_at` no nulo → publicado confirmado, cerrado, no se vuelve a tocar.
   - `published_at` nulo + `intentos_publicacion < 5` → pendiente, se reintentará en el próximo ciclo de `dulabs-reconciliation`.
   - `published_at` nulo + `intentos_publicacion >= 5` → terminal sin publicar automáticamente; no hay pérdida de datos (el evento crudo sigue íntegro en Postgres), requiere revisión manual/observabilidad para decidir una republicación manual si corresponde.

---

## B. Cloud Run services

| Campo | `dulabs-gateway` | `dulabs-outbound-worker` | `dulabs-inbound-worker` |
|---|---|---|---|
| Propósito | `POST /api/v1/messages` (autentica por API key, reclama idempotencia, publica a `dulabs-outbound`); `GET`/`POST /api/v1/webhooks/meta` (inbound de Meta, ver sección A); CRUD de gestión Developer V1 (API keys, números, webhooks — autenticado por sesión, no por `dl_live_`) | Push subscriber de `dulabs-outbound` — adquiere lease, llama a Meta Graph API, aplica transición de estado real | Push subscriber de `dulabs-inbound` — persiste eventos entrantes ya publicados por el Gateway |
| Región | `us-central1` | `us-central1` | `us-central1` |
| Identidad | `dulabs-gateway@dulabs-developer-v1.iam.gserviceaccount.com` | `dulabs-worker-outbound@dulabs-developer-v1.iam.gserviceaccount.com` **(nueva, aprobada)** | `dulabs-worker-inbound@dulabs-developer-v1.iam.gserviceaccount.com` **(nueva, aprobada)** |
| Acceso público | **Sí** (`--allow-unauthenticated`) — es la API pública del desarrollador y el receptor del webhook de Meta; la seguridad real es la API key/firma de Meta a nivel de aplicación, no IAM de Cloud Run | **No** (`--no-allow-unauthenticated`) — solo invocable por `dulabs-pubsub-invoker@` | **No** (`--no-allow-unauthenticated`) — ídem |
| Escala a cero | Sí (`--min-instances=0`) | Sí (`--min-instances=0`) | Sí (`--min-instances=0`) |
| Costo esperado | Por request, capa gratuita de Cloud Run cubre el volumen inicial por completo | Por request (1 invocación push = 1 mensaje) | Por request |
| Dependencia | Imagen en Artifact Registry, Secret Manager, KMS | Imagen, Secret Manager, KMS (decrypt del token de Meta) | Imagen, Secret Manager |
| Configuración propuesta | `--cpu=1 --memory=512Mi --max-instances=10 --timeout=30s --service-account=dulabs-gateway@... --allow-unauthenticated` | `--cpu=1 --memory=512Mi --max-instances=20 --timeout=60s --service-account=dulabs-worker-outbound@... --no-allow-unauthenticated` | `--cpu=1 --memory=256Mi --max-instances=20 --timeout=30s --service-account=dulabs-worker-inbound@... --no-allow-unauthenticated` |

`--timeout` del Worker outbound (60s) debe ser mayor al `ackDeadlineSeconds` de su subscripción (sección D) para que el handler decida con calma entre `success_confirmed`/`meta_rechazo`/`incertidumbre_de_red` antes de que Cloud Run mate la request — pero el ack a Pub/Sub se emite en cuanto el job queda en un estado seguro (sección E).

---

## C. Pub/Sub topics

Ya existen, **no se recrean**: `dulabs-inbound`, `dulabs-outbound`. No se proponen topics nuevos aparte de los dos dead-letter topics de la sección E.

---

## D. Push subscriptions

Las subscripciones `dulabs-inbound-worker` y `dulabs-outbound-worker` **ya existen como pull** — no requieren borrarse/recrearse: `gcloud pubsub subscriptions modify-push-config` las convierte a push in-place, conservando nombre y topic.

| Campo | `dulabs-outbound-worker` | `dulabs-inbound-worker` |
|---|---|---|
| Push endpoint | URL del servicio `dulabs-outbound-worker` + `/push` | URL del servicio `dulabs-inbound-worker` + `/push` |
| Autenticación | OIDC token, audience = URL del propio servicio, firmado por `dulabs-pubsub-invoker@` (sección H) — **esta es la identidad de invocación, distinta de la identidad runtime del Worker; ver sección I para la distinción explícita** | Igual |
| `ackDeadlineSeconds` | **30s** (no el default de 10s) | **20s** |
| `retryPolicy.minimumBackoff` | 10s | 10s |
| `retryPolicy.maximumBackoff` | 300s | 300s |
| Dead-letter topic | `dulabs-outbound-dlq` | `dulabs-inbound-dlq` |
| `maxDeliveryAttempts` | 5 (ver nota de best-effort en sección E) | 5 |
| Configuración propuesta | `gcloud pubsub subscriptions modify-push-config dulabs-outbound-worker --push-endpoint=https://<url-worker>/push --push-auth-service-account=dulabs-pubsub-invoker@... --push-auth-token-audience=https://<url-worker>` + `gcloud pubsub subscriptions update dulabs-outbound-worker --min-retry-delay=10s --max-retry-delay=300s --dead-letter-topic=dulabs-outbound-dlq --max-delivery-attempts=5 --ack-deadline=30` | Análogo |

---

## E. DLQ y retry strategy

### Dead-letter topics nuevos

| Nombre | Propósito | Costo | Configuración propuesta |
|---|---|---|---|
| `dulabs-outbound-dlq` | Recibe mensajes de `dulabs-outbound-worker` que agotaron sus intentos de entrega | Mínimo | `gcloud pubsub topics create dulabs-outbound-dlq` |
| `dulabs-inbound-dlq` | Análogo, para `dulabs-inbound-worker` | Mínimo | `gcloud pubsub topics create dulabs-inbound-dlq` |
| `dulabs-outbound-dlq-inspect` (subscription pull, inspección manual) | Nunca procesa automáticamente | Mínimo | `gcloud pubsub subscriptions create dulabs-outbound-dlq-inspect --topic=dulabs-outbound-dlq` |
| `dulabs-inbound-dlq-inspect` (subscription pull) | Análoga | Mínimo | `gcloud pubsub subscriptions create dulabs-inbound-dlq-inspect --topic=dulabs-inbound-dlq` |

**Nota importante sobre `maxDeliveryAttempts`**: Pub/Sub cuenta los intentos de entrega de forma *best-effort*, no como una garantía exacta — el número real de entregas físicas antes de que un mensaje llegue al DLQ puede ser mayor o menor a 5 en casos límite (duplicados internos de Pub/Sub, ventanas de ack ambiguas). El diseño (y los tests de la sección Q) no dependen de que sea exactamente 5 — dependen de que el mensaje **eventualmente** llegue al DLQ, de que **no haya loop infinito**, y de que el comportamiento sea coherente con la política configurada.

**IAM requerido para que el dead-lettering funcione** — ver tabla completa y separada por identidad en la sección I. Resumen: es el *Pub/Sub service agent* (no ninguna SA runtime) quien necesita permisos sobre el DLQ y sobre la subscripción de origen.

### Ack behavior — el punto más delicado del diseño (outbound)

Garantiza "no duplicados físicos" bajo push + at-least-once + autoscaling de Cloud Run (varias instancias pueden recibir copias redundantes del mismo mensaje):

1. **El handler SIEMPRE intenta `adquirirLease` primero**, antes de tocar Meta. Si el resultado es `"ya_tomado"` (otra entrega concurrente del mismo mensaje ya tiene el lease), el handler responde **HTTP 200 inmediatamente** — la protección de Fase 2 funcionando exactamente como se diseñó. Pub/Sub ackea y no reintenta.
2. **Si el envío físico a Meta resulta en éxito confirmado o rechazo cierto de Meta** (`meta_confirmo_exito` / `meta_rechazo`), el handler aplica la transición vía `aplicarEventoJob` y responde **HTTP 200**.
3. **Regla crítica**: si el resultado es **incertidumbre de red** (`incertidumbre_de_red`), el handler transiciona el job a `reconciliation_pending` y responde **HTTP 200 también** — nunca un código que provoque que Pub/Sub reintregue el mensaje. Reintregar acá violaría directamente "no blind resend": la única vía autorizada para sacar un job de `reconciliation_pending` es el Job de reconciliación (sección G), nunca una redelivery de Pub/Sub.
4. **Errores transitorios de infraestructura** (Postgres momentáneamente inalcanzable, timeout antes de siquiera intentar el lease) — el handler responde **HTTP 5xx**, dejando que Pub/Sub reintente con el backoff configurado (sección D). En este punto todavía no se tocó Meta, así que un reintento es seguro.
5. **Errores permanentes de validación** (mensaje malformado, `job_id` inexistente) — el handler responde **HTTP 200** igual (ackea) después de registrar el evento como `failed` vía `registrarEvento` — reintentar un mensaje que nunca va a poder procesarse solo desperdicia intentos hasta el DLQ sin ganar nada.

**`retry_pending` nunca se dispara por una redelivery de Pub/Sub** — se re-encola explícitamente publicando un nuevo mensaje a `dulabs-outbound` (con el mismo `job_id`) desde el propio Worker o desde el Job de reconciliación, nunca dejando que Pub/Sub "reintente" el mensaje original después de que ya fue ackeado.

### Inbound

Menos crítico (no hay riesgo de "enviar dos veces" a Meta — solo de procesar dos veces un webhook entrante), mismo patrón: dedup por `event_id` vía `registrarEvento` **ya ocurrido en el Gateway antes de publicar** (sección A); el Worker inbound puede confiar en que lo que recibe ya está deduplicado, pero igual debe tratar su propio procesamiento de forma idempotente (una redelivery del mismo mensaje de Pub/Sub hacia el Worker inbound debe ser un no-op seguro).

---

## F. Cloud Scheduler

| Campo | Valor |
|---|---|
| Nombre propuesto | `dulabs-reconciliation-trigger` |
| Propósito | Disparar la ejecución del Cloud Run Job de reconciliación cada 5 minutos |
| Región | `us-central1` |
| Frecuencia | `*/5 * * * *` |
| Target | `POST https://run.googleapis.com/v2/projects/dulabs-developer-v1/locations/us-central1/jobs/dulabs-reconciliation:run` — **API v2 de Cloud Run Jobs** (patrón actual recomendado, corregido de la propuesta v1 anterior) |
| Identidad | `dulabs-scheduler-invoker@dulabs-developer-v1.iam.gserviceaccount.com` **(nueva, requerida)** |
| Permisos | `roles/run.invoker` **únicamente sobre el Job `dulabs-reconciliation`** (IAM a nivel de recurso específico, no de proyecto) |
| Autenticación | **OAuth token** (no OIDC) — se está invocando la API de administración de Cloud Run (`run.googleapis.com`), un endpoint estándar de Google Cloud, no la URL pública de un servicio Cloud Run directamente; OAuth es el patrón correcto para este caso (OIDC es para invocar directamente la URL de un servicio/función con audience = esa URL) |
| Costo esperado | Cloud Scheduler cobra por job configurado, no por ejecución — 3 jobs gratis por proyecto en el tier gratuito; con 1 solo job configurado, costo **$0** |
| Escala a cero | N/A (recurso de control, no de cómputo) |
| Configuración propuesta | `gcloud scheduler jobs create http dulabs-reconciliation-trigger --schedule="*/5 * * * *" --uri="https://run.googleapis.com/v2/projects/dulabs-developer-v1/locations/us-central1/jobs/dulabs-reconciliation:run" --http-method=POST --oauth-service-account-email=dulabs-scheduler-invoker@dulabs-developer-v1.iam.gserviceaccount.com --location=us-central1` |

---

## G. Reconciliation Job

| Campo | Valor |
|---|---|
| Nombre | `dulabs-reconciliation` (SA runtime ya existe, falta crear el Job en sí) |
| Propósito | **Dos responsabilidades por ejecución** (cada 5 min): (1) reconciliación outbound — consulta `dulabs_dev_jobs` con `status='reconciliation_pending'` (índice parcial `dulabs_dev_jobs_reconciliation_idx`, ya existe de Fase 2), pregunta a Meta el estado real de cada mensaje, y **solo si Meta confirma que el envío original nunca llegó**, aplica el evento `reconciliacion_confirmo_no_enviado` (Fase 1, `outbound-state-machine.ts`); (2) **barrido de recuperación inbound** — republica en `dulabs-inbound` los eventos de `dulabs_dev_events` con `published_at IS NULL` y `created_at` con más de 2 minutos, ver diseño completo en la sección A ("Diseño del mecanismo de recuperación inbound"). Se combinan en el mismo Job para no introducir un recurso GCP nuevo evitable. |
| Región | `us-central1` |
| Identidad | `dulabs-reconciliation@dulabs-developer-v1.iam.gserviceaccount.com` (ya existe) |
| Permisos | `roles/secretmanager.secretAccessor`, `roles/cloudkms.cryptoKeyEncrypterDecrypter` (leer el token de Meta para consultar estado), **`roles/pubsub.publisher` sobre el topic `dulabs-inbound`** (nuevo, para el barrido de recuperación — sección I) |
| Dependencia | Imagen en Artifact Registry, KMS, Secret Manager, Cloud Scheduler, migración aditiva de `dulabs_dev_events` (`published_at`, `intentos_publicacion` — sección A, no aplicada todavía) |
| Costo esperado | Solo mientras corre; 288 ejecuciones/día a 5 min de frecuencia; con 0 jobs/eventos reales hoy, costo prácticamente cero |
| Escala a cero | Sí por diseño — un Cloud Run Job no queda "encendido" entre ejecuciones |
| Configuración propuesta | `gcloud run jobs create dulabs-reconciliation --image=... --service-account=dulabs-reconciliation@... --region=us-central1 --max-retries=1 --task-timeout=300s` |

**Regla que el Job debe respetar sin excepción, en su rol de reconciliación outbound** (ya validada en Fase 2, se reusa sin modificar): el Job **nunca** reenvía físicamente un mensaje por su cuenta — su único rol es consultar a Meta y, si Meta confirma "nunca llegó", **delegar** el reintento pasando el job a `retry_pending`; el reenvío físico real ocurre después, cuando el Worker outbound recoge ese job re-encolado. `--max-retries=1` a nivel de Cloud Run (no del mensaje) evita que una ejecución fallida del Job mismo se reintente indefinidamente sin visibilidad.

**En su rol de barrido de recuperación inbound**, el Job nunca reinterpreta ni reconstruye el payload del evento — solo republica una referencia a la fila ya persistida en `dulabs_dev_events`, y respeta el tope de 5 intentos antes de dejar de reintentar una fila (sección A).

---

## H. Service Accounts

**Decisión cerrada**: 6 identidades runtime/invocación:

| SA | Estado | Usada por |
|---|---|---|
| `dulabs-gateway@...` | Ya existe | Cloud Run service `dulabs-gateway` |
| `dulabs-worker-outbound@...` | **Nueva, aprobada** | Cloud Run service `dulabs-outbound-worker` |
| `dulabs-worker-inbound@...` | **Nueva, aprobada** | Cloud Run service `dulabs-inbound-worker` |
| `dulabs-reconciliation@...` | Ya existe | Cloud Run Job `dulabs-reconciliation` |
| `dulabs-pubsub-invoker@...` | **Nueva, requerida** | Identidad que Pub/Sub usa para firmar el OIDC token de cada push — **no es la identidad runtime de ningún Worker**, es exclusivamente la identidad de invocación (ver distinción explícita en sección I) |
| `dulabs-scheduler-invoker@...` | **Nueva, requerida** | Identidad que Cloud Scheduler usa para invocar el Job (OAuth) |
| `dulabs-worker@...` | Ya existe, **queda sin uso por ahora** — no se elimina | — |
| Default compute SA | Ya existe, **nunca se usa** — no se elimina | — |

**Sobre `dulabs-worker@` (la SA original, genérica)**: por decisión de ChatGPT, se mantiene sin uso y sin eliminar. Los dos Workers nuevos usan identidades separadas y dedicadas (`dulabs-worker-outbound@`, `dulabs-worker-inbound@`) por *blast radius*: el Worker outbound necesita `cloudkms.cryptoKeyEncrypterDecrypter` (toca el token de Meta para enviar); el Worker inbound solo persiste eventos entrantes, no descifra nada para enviar. Compartir una sola identidad habría dado al path inbound (superficie más expuesta, procesa payloads de terceros) permisos de KMS que no necesita.

**Cómo evitamos que un deploy caiga accidentalmente en la default compute SA** (documentado, no ejecutado): todo `gcloud run deploy` / `gcloud run jobs create` / `gcloud run jobs execute` en este proyecto **debe** llevar `--service-account=<SA explícita>` sin excepción. Si se omite ese flag, Cloud Run usa la default compute SA (`roles/editor`) por defecto — por eso cada comando propuesto en este documento (secciones B, F, G) ya incluye el flag explícito, y cualquier script/pipeline de deploy que se construya en la implementación debe fallar (linter de script, checklist de PR, o revisión manual) si ese flag falta.

---

## I. IAM mínimo necesario

Separado explícitamente en las 6 categorías pedidas — **nada de esto se aplicó todavía**.

### 1. Deployer permissions (ya existentes, sin cambios en esta fase)

`dulabs-developer-deploy@` ya tiene, a nivel de proyecto (confirmado en la auditoría, sin tocar): `run.admin`, `artifactregistry.writer`, `cloudbuild.builds.editor`, `pubsub.editor`, `cloudkms.admin`, `secretmanager.admin`. En implementación (no ahora) deberá extenderse con `roles/iam.serviceAccountUser` también sobre las 4 SAs nuevas (`worker-outbound`, `worker-inbound`, `pubsub-invoker`, `scheduler-invoker`) para poder desplegarlas — hoy solo lo tiene sobre `gateway`/`worker`/`reconciliation` (las 3 originales).

### 2. Runtime permissions (lo que cada Cloud Run service/job necesita para SU PROPIA lógica, nunca para "recibir" la invocación)

| Runtime SA | Rol | Alcance | Para qué |
|---|---|---|---|
| `dulabs-gateway@` | `roles/pubsub.publisher` | Topics `dulabs-outbound` y `dulabs-inbound` | Publicar el job saliente y el evento entrante ya persistido |
| `dulabs-gateway@` | `roles/secretmanager.secretAccessor` | Secretos específicos (sección K) | Leer credenciales de infraestructura |
| `dulabs-gateway@` | `roles/cloudkms.cryptoKeyEncrypterDecrypter` | Solo `dulabs-developer-master-key` | Cifrar secretos nuevos al crearlos vía el CRUD de gestión |
| `dulabs-worker-outbound@` | `roles/secretmanager.secretAccessor` | Secretos específicos | Cadena de conexión a Postgres, etc. |
| `dulabs-worker-outbound@` | `roles/cloudkms.cryptoKeyEncrypterDecrypter` | Solo la key | Descifrar el token de Meta antes de llamar a Graph API |
| `dulabs-worker-inbound@` | `roles/secretmanager.secretAccessor` | Secretos específicos | Persistir eventos entrantes |
| `dulabs-reconciliation@` | `roles/secretmanager.secretAccessor` | Secretos específicos | Igual |
| `dulabs-reconciliation@` | `roles/cloudkms.cryptoKeyEncrypterDecrypter` | Solo la key | Leer el token de Meta para consultar estado real |
| `dulabs-reconciliation@` | `roles/pubsub.publisher` | **Solo el topic `dulabs-inbound`** | **Nuevo** — necesario para su responsabilidad adicional de barrido de recuperación inbound (sección A/G); no publica en `dulabs-outbound` bajo ninguna circunstancia (nunca reenvía físicamente por su cuenta) |

**Corrección explícita respecto a una versión anterior de este documento**: ninguna SA runtime (`worker-outbound`, `worker-inbound`) necesita `roles/pubsub.subscriber` para RECIBIR mensajes vía push. Un Cloud Run service que recibe un push de Pub/Sub no necesita "ser subscriptor" a nivel de IAM — la entrega push es simplemente una llamada HTTP autenticada por OIDC, y lo único que decide quién puede invocar el servicio es `roles/run.invoker` sobre la identidad que firma esa llamada (la de push, categoría 3 abajo), no un rol de Pub/Sub sobre la SA runtime del Worker. `dulabs-gateway@` sí tiene `pubsub.publisher` porque es quien efectivamente *publica* mensajes — un rol distinto, correctamente justificado, que no se confunde con "recibir".

### 3. Pub/Sub push identity (quién firma el OIDC que invoca a los Workers) — distinta de la identidad runtime de cada Worker

| Identidad | Rol | Alcance |
|---|---|---|
| `dulabs-pubsub-invoker@` | `roles/run.invoker` | Solo `dulabs-outbound-worker` y `dulabs-inbound-worker` (no el Gateway, no el Job) |
| Pub/Sub service agent (`service-654668494598@gcp-sa-pubsub.iam.gserviceaccount.com`) | `roles/iam.serviceAccountTokenCreator` | Sobre `dulabs-pubsub-invoker@` — requisito de GCP para que Pub/Sub pueda "actuar como" esta SA y firmar el token OIDC de cada push |

### 4. Scheduler identity

| Identidad | Rol | Alcance |
|---|---|---|
| `dulabs-scheduler-invoker@` | `roles/run.invoker` | Únicamente el Job `dulabs-reconciliation` |

Autenticación: **OAuth**, no OIDC (sección F).

### 5. Pub/Sub service agent — permisos adicionales para dead-lettering

| Rol | Alcance |
|---|---|
| `roles/pubsub.publisher` | Sobre `dulabs-outbound-dlq` y `dulabs-inbound-dlq` (los topics DLQ) |
| `roles/pubsub.subscriber` | Sobre `dulabs-outbound-worker` y `dulabs-inbound-worker` (las **subscripciones de origen**, no los topics DLQ) — necesario para que el service agent pueda leer el mensaje que agotó sus intentos y republicarlo en el DLQ correspondiente |

`gcloud pubsub subscriptions update --dead-letter-topic=...` configura esto automáticamente si quien lo ejecuta tiene permisos suficientes (el deployer los tiene).

### 6. Resource-level IAM — regla dura que se mantiene sin excepción

Ninguna identidad runtime recibe `roles/editor`, `roles/*.admin`, ni ningún rol a nivel de **proyecto**. Todo IAM de runtime/invocación de esta sección es a nivel de recurso específico (la key de KMS puntual, el secreto puntual, el topic/subscripción puntual, el servicio/Job puntual). Los únicos roles de administración de proyecto (`cloudkms.admin`, `secretmanager.admin`, `run.admin`, `pubsub.editor`, `artifactregistry.writer`, `cloudbuild.builds.editor`) siguen exclusivamente en `dulabs-developer-deploy@`, sin cambios.

---

## J. KMS + envelope encryption

| Campo | Valor |
|---|---|
| Keyring propuesto | `dulabs-developer-keyring` |
| Región | `us-central1` (regional, coherente con el resto de la infraestructura) |
| Key propuesta | `dulabs-developer-master-key` |
| Propósito | `ENCRYPT_DECRYPT` |
| Nivel de protección | `SOFTWARE` (HSM queda como mejora futura opcional, no necesaria al volumen actual) |
| Rotación | Automática, 90 días — KMS mantiene versiones anteriores activas para descifrado, un dato cifrado con una versión vieja sigue siendo legible sin re-cifrar nada al rotar |
| Costo esperado | ~$0.06/mes por versión de key activa + ~$0.03/10.000 operaciones — despreciable al volumen actual |
| Configuración propuesta | `gcloud kms keyrings create dulabs-developer-keyring --location=us-central1` + `gcloud kms keys create dulabs-developer-master-key --keyring=dulabs-developer-keyring --location=us-central1 --purpose=encryption --rotation-period=90d --next-rotation-time=...` |

### Patrón de envelope encryption propuesto

Extiende `lib/developer/secure-crypto.ts` (Fase 1/2, sin romper su interfaz pública `cifrarSecretoDev`/`descifrarSecretoDev`) con un nuevo formato versionado `dev2:` — dado que no hay datos reales en producción todavía (hallazgo del encabezado), el cutover puede ser directo, sin necesidad real de soporte dual prolongado:

1. **Al cifrar**: generar una DEK aleatoria de 32 bytes localmente → cifrar el secreto real con AES-256-GCM usando esa DEK (mismo código que ya existe) → envolver esa DEK con la KMS key vía la API de KMS → persistir `dev2:<dekEnvueltaBase64>:<iv>:<authTag>:<ciphertext>`.
2. **Al descifrar**: desenvolver la DEK vía KMS → usarla en memoria (nunca persistida) para descifrar con AES-256-GCM como hoy.
3. **Fail-closed idéntico**: si KMS no está disponible o falla, se propaga el error igual que `ClaveNoDisponibleError` hoy — nunca fallback a clave estática en producción. `DEVELOPER_TOKEN_ENCRYPTION_KEY` queda reservado exclusivamente para entornos locales/CI sin acceso a GCP, nunca como ruta válida en producción.
4. **Quién puede envolver/desenvolver**: solo identidades con `roles/cloudkms.cryptoKeyEncrypterDecrypter` sobre esta key específica (sección I, categoría 2) — ni Gateway ni Workers reciben permisos de administración de la key.

**Decisión técnica que sí tomo** (no de producto): DEK por operación (no una DEK fija reusada) — patrón estándar recomendado por Google, minimiza el *blast radius* de una DEK filtrada, costo adicional despreciable al volumen de Developer V1.

---

## K. Secret Manager

Distinción explícita entre las dos categorías de secretos, pedida por ChatGPT:

### Secret Manager — secretos de infraestructura/operación (compartidos, NO por-tenant)

| Secreto | Contenido | Usado por | Por qué acá y no en KMS+DB |
|---|---|---|---|
| `supabase-service-role-key` | `SUPABASE_SERVICE_ROLE_KEY` | Gateway, ambos Workers, Reconciliation | Credencial de infraestructura compartida por todos los servicios, no pertenece a ningún tenant/workspace individual |
| `supabase-url` | `SUPABASE_URL` | Igual | Igual |
| `meta-app-secret` | App Secret de Meta a nivel de **plataforma** DuLabs (verifica `X-Hub-Signature-256` del webhook entrante) | Gateway | Secreto de la cuenta de plataforma de Meta de DuLabs, no de un desarrollador individual |
| `meta-webhook-verify-token` | Token del handshake `GET` de configuración del webhook de Meta | Gateway | Igual, nivel plataforma |

### KMS + envelope encryption — secretos PERSISTENTES del modelo de datos de Developer V1 (por-tenant, viven cifrados en Postgres, NUNCA en Secret Manager)

| Dato | Tabla/columna | Por qué acá y no en Secret Manager |
|---|---|---|
| Token de Meta de cada número WhatsApp conectado por un desarrollador | `dulabs_dev_whatsapp_numbers.meta_token_cifrado` | Potencialmente miles de estos (uno por número por workspace) — Secret Manager está pensado para secretos de infraestructura en cantidad acotada, no un secreto por fila de una tabla de negocio; además necesita quedar asociado relacionalmente al número, no como un recurso GCP aparte |
| Secreto HMAC de cada webhook configurado por un desarrollador | `dulabs_dev_webhook_configs.secret_cifrado` | Misma razón |

Cada Cloud Run service/job referencia los secretos de Secret Manager como variables de entorno respaldadas por secreto (`--set-secrets=SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest`), nunca como valor plano en la configuración del servicio.

---

## L. Docker/build strategy

- Un `Dockerfile` por runtime o un único Dockerfile multi-stage con `ENTRYPOINT` seleccionado por variable de entorno — decisión técnica a definir en la implementación, no bloquea el diseño.
- Imagen base recomendada: `node:22-slim` (o la LTS vigente), consistente con el resto del repo.
- Build: `gcloud builds submit --tag us-central1-docker.pkg.dev/dulabs-developer-v1/dulabs-developer/<servicio>:<tag>`, manual al principio (el deployer ya tiene `cloudbuild.builds.editor`); automatización vía Cloud Build Trigger conectado a GitHub queda como mejora posterior.
- Tag de imagen: SHA corto del commit (`git rev-parse --short HEAD`), nunca `:latest` en producción — necesario para el rollback (sección P).

---

## M. Cost-control strategy

- **Todos** los Cloud Run services con `--min-instances=0`.
- Cloud Run Jobs sin costo fuera de su ejecución por diseño.
- Sin Compute Engine, sin Kubernetes, sin Cloud SQL, sin VPC connector (salvo necesidad real futura, no identificada hoy).
- Cloud Scheduler: 1 solo job configurado → dentro del tier gratuito.
- Pub/Sub: usage-based, costo $0 al volumen actual (0 jobs reales), sigue despreciable incluso en los primeros meses de operación real dado el límite de 20k mensajes/mes del plan Developer.
- Artifact Registry: mínimo, solo las imágenes necesarias (sin acumular tags viejos indefinidamente — limpieza periódica queda como mejora futura, no bloqueante).
- KMS/Secret Manager: costo fijo pequeño, despreciable.
- `--max-instances` explícito en cada servicio (10 Gateway, 20 cada Worker) — control duro contra un pico de tráfico inesperado o un loop de reintentos.

### Budget Alert — aprobado

**US$20/mes**, vía Cloud Billing Budgets sobre la cuenta `01BBF2-7703E1-FCC174`. Aclaración explícita: esto es una **alerta de notificación**, no un *hard spending cap* — GCP no corta servicios ni bloquea gasto automáticamente al alcanzar el umbral salvo que se configure una respuesta automatizada adicional (ej. una función que deshabilite billing, algo mucho más agresivo y **no propuesto acá**). El Budget Alert solo notifica (por correo/Pub/Sub) que el gasto se acerca o superó $20/mes, para que se revise manualmente.

---

## N. Security controls

- Ningún servicio/Job usa la default compute SA (sección H).
- Workers y Job de reconciliación sin acceso público — únicamente invocables por las identidades de push/scheduler dedicadas (sección I).
- Gateway público, pero la autenticación real es a nivel de aplicación (API key `dl_live_...` para `/api/v1/messages`, firma HMAC de Meta para `/api/v1/webhooks/meta`, sesión Supabase para el CRUD de gestión) — IAM de Cloud Run no reemplaza esa capa, la complementa.
- SSRF guard (`ssrf-guard.ts`, Fase 1) se reusa sin cambios para validar cualquier URL de webhook configurada por un desarrollador.
- Firma HMAC de webhooks salientes (`webhook-signature.ts`, Fase 1) se reusa sin cambios.
- KMS como raíz de confianza única para cifrado — sin clave estática en producción (sección J).
- Ningún secreto se loguea — convención ya establecida en todo el repo, se mantiene en el logging estructurado de Cloud Run.
- Sin VPC/Compute Engine habilitado — decisión ya confirmada en la auditoría, no se reabre.
- IAM siempre a nivel de recurso específico para las identidades runtime/invocación, nunca a nivel de proyecto (sección I).
- **Se preservan intactas, sin modificar código**, todas las garantías de Fase 1/2: idempotencia (`lib/developer/idempotency.ts`), leases/CAS (`jobs-store.ts`), `physical_outcome`/`reconciliation_pending` (`outbound-state-machine.ts`), no blind resend, usage ledger anti-doble-cobro (`usage-ledger.ts`), dedup de eventos (`events-store.ts`), cifrado fail-closed (`secure-crypto.ts`, extendido no reemplazado). Este diseño de infraestructura es la capa que INVOCA ese código ya probado — no lo reinterpreta.

---

## O. Deployment order

0. Aplicar la migración aditiva de `dulabs_dev_events` (`published_at`, `intentos_publicacion` + índice parcial — sección A) — prerrequisito de datos antes de que el Gateway/Job puedan usar el mecanismo de recuperación inbound. Puramente aditiva sobre una tabla de Fase 2 ya en producción, sin romper su contrato existente.
1. Crear keyring + key de KMS (sección J).
2. Crear los secretos en Secret Manager (sección K) con sus valores reales.
3. Crear las 4 SAs nuevas: `dulabs-worker-outbound`, `dulabs-worker-inbound`, `dulabs-pubsub-invoker`, `dulabs-scheduler-invoker`.
4. Extender `iam.serviceAccountUser` del deployer sobre las 4 SAs nuevas (sección I.1).
5. Aplicar todos los bindings IAM de la sección I (runtime, push identity, scheduler identity, service agent) — todos a nivel de recurso.
6. Construir y subir las imágenes Docker a Artifact Registry (hoy vacío).
7. Desplegar los 3 Cloud Run services (Gateway, Worker outbound, Worker inbound) con `--service-account` explícito y `--no-allow-unauthenticated` donde corresponda.
8. Crear el Cloud Run Job `dulabs-reconciliation`.
9. Crear los 2 dead-letter topics + sus subscripciones de inspección — **antes** del paso 10, porque una subscripción no puede referenciar un dead-letter-topic inexistente.
10. Convertir `dulabs-inbound-worker`/`dulabs-outbound-worker` de pull a push (`modify-push-config` + `update` con retry/DLQ policy) — único paso que toca recursos ya existentes, al final, cuando los Workers que van a recibir el push ya están desplegados y respondiendo.
11. Crear el job de Cloud Scheduler apuntando al Job de reconciliación ya desplegado.
12. Ejecutar los tests de infraestructura reales de la sección Q.
13. Configurar el Budget Alert de $20/mes (sección M).

---

## P. Rollback strategy

- **Cloud Run services**: cada deploy crea una nueva revisión; `gcloud run services update-traffic <servicio> --to-revisions=<revisión-anterior>=100` revierte el tráfico al 100% a la revisión previa sin rehacer el build. Ninguna imagen se sobreescribe (`:latest` prohibido) — la revisión anterior siempre tiene su imagen intacta en Artifact Registry.
- **Cloud Run Job**: análogo — se puede volver a ejecutar una revisión anterior del Job si una nueva versión de la reconciliación tuviera un bug.
- **Pub/Sub push**: interruptor de emergencia real — `gcloud pubsub subscriptions modify-push-config <sub> --push-endpoint=""` **revierte la subscripción a pull** de inmediato, deteniendo toda entrega automática sin borrar ni la subscripción ni los mensajes en vuelo, mientras se investiga un problema en el Worker.
- **KMS**: nunca se destruye una versión de key manualmente ante un incidente — se **deshabilita** (`gcloud kms keys versions disable`), reversible (`enable` de nuevo) si el "incidente" resulta ser una falsa alarma.
- **Corrección respecto a una versión anterior de este documento**: `--max-instances=0` **NO** se usa como interruptor de emergencia para detener un Cloud Run service. Fijar `max-instances=0` en un servicio que recibe push de Pub/Sub no lo "pausa" limpiamente — las invocaciones push seguirían llegando y fallarían (sin instancias disponibles para atenderlas), lo cual cuenta como intentos de entrega fallidos y puede terminar mandando mensajes sanos al DLQ innecesariamente. Los mecanismos de emergencia válidos son, en orden de preferencia: (1) revertir tráfico a una revisión anterior conocida-buena, (2) `modify-push-config` para volver la subscripción a pull (detiene la entrega automática sin que Cloud Run reciba invocaciones fallidas), (3) retirar temporalmente `roles/run.invoker` de `dulabs-pubsub-invoker@` sobre el servicio afectado (bloquea la invocación a nivel de IAM, sin tocar la subscripción ni el servicio).

---

## Q. Tests de infraestructura (planeados, no ejecutados — nada existe todavía para probar)

1. **Auth de push real**: un `curl` directo al endpoint del Worker sin token OIDC válido debe devolver 401/403.
2. **Ack correcto bajo incertidumbre**: publicar un mensaje sintético a `dulabs-outbound` contra un fixture que simule un timeout de red hacia Meta, confirmar que el job termina en `reconciliation_pending` (no en `retry_pending`) y que Pub/Sub no reintenta la entrega.
3. **Cero duplicados físicos y cero doble cobro bajo redelivery real — fortalecido**. El test debe demostrar, con evidencia real contra infraestructura desplegada (no simulada en un solo proceso), la secuencia completa:
   - **Primera entrega** → llega a una instancia del Worker outbound ("Worker A") → `adquirirLease()` adquiere el lease (CAS real) → POST físico real a Meta → resultado se persiste de forma segura (`success_confirmed`, `meta_rechazo`, o `reconciliation_pending` según corresponda) → HTTP 200.
   - **Redelivery forzada** del mismo mensaje (expirando el `ackDeadline` a propósito, o republicando manualmente el mismo mensaje) → llega a una instancia **distinta** del Worker outbound ("Worker B" — una segunda request/instancia real, no la misma invocación) → `adquirirLease()` devuelve `"ya_tomado"` (o el job ya está en un estado que la máquina de estados no permite reabrir) → responde **HTTP 200** → **NO hay un segundo POST físico a Meta** (verificable por el contador/log real del fixture de Meta usado en el test, mismo estándar que `crash-recovery.test.ts` de Fase 1 — nunca `physicalPostCount = 1` asumido, siempre contado).
   - **Verificación adicional en `dulabs_dev_usage_ledger`**: una consulta real (`select count(*) ... where job_id = :id`) debe confirmar **una sola fila** de ledger para ese job — cero doble registro económico, aunque hubo dos entregas de Pub/Sub para el mismo mensaje.
   - El test es válido solo si demuestra las tres cosas a la vez: cero duplicados físicos, cero doble cobro, y que el mecanismo de lease/CAS funcionó entre dos requests/instancias reales distintas (no dos llamadas de función dentro del mismo proceso Node, que no probaría nada sobre concurrencia real de Cloud Run).
4. **DLQ real — corregido**: `maxDeliveryAttempts=5` se mantiene como configuración, pero el criterio del test **no exige exactamente 5 entregas físicas** (Pub/Sub cuenta intentos de forma best-effort, no garantizada). El criterio real es: DLQ configurado correctamente, el mensaje diseñado para fallar siempre termina eventualmente en `dulabs-outbound-dlq`, se observan múltiples intentos de entrega (no uno solo), no hay loop infinito, y el comportamiento es coherente con la política configurada.
5. **Cloud Scheduler real**: confirmar en `gcloud run jobs executions list` que el trigger de Scheduler ejecuta el Job cada 5 minutos.
6. **KMS real**: roundtrip de cifrado/descifrado contra la key real (no mock), confirmar que un ciphertext manipulado un solo byte sigue fallando por auth-tag de GCM.
7. **IAM real — corregido**: confirmar que invocar directamente la URL de `dulabs-outbound-worker` (o `dulabs-inbound-worker`) sin la identidad `dulabs-pubsub-invoker@` es rechazado por Cloud Run IAM (401/403) — la prueba real es que solo esa identidad específica puede invocar, no que las SAs runtime tengan o no un rol de Pub/Sub (que, per la corrección de la sección I, no aplica).

---

## R. Riesgos residuales

1. **Ventana entre `ackDeadline` y el tiempo real de un request a Meta**: mitigado por `ackDeadlineSeconds=30` (vs. default 10) y por el lease bloqueando redelivery concurrente, pero sigue siendo una ventana a monitorear en producción real.
2. **KMS como dependencia dura**: si KMS tiene una interrupción, cifrado/descifrado falla-cerrado (correcto por diseño), pero Gateway/Workers no podrían operar sobre secretos durante ese tiempo — tradeoff de disponibilidad vs. seguridad ya implícito en "KMS como raíz de confianza", señalado explícitamente.
3. **Autoscaling + push genera concurrencia real distinta a la probada en local** (Fase 2 probó CAS con `Promise.all` dentro de un mismo proceso; en Cloud Run real la concurrencia viene de múltiples contenedores). El mecanismo (UPDATE atómico en Postgres) debería sostenerse igual, pero merece el test dedicado de la sección Q.3 antes de confiar en él a escala.
4. **DLQ sin alerta configurada todavía** — un mensaje en el DLQ hoy quedaría sin que nadie se entere hasta revisión manual. Recomendación no incluida en el plan: alerta de Cloud Monitoring sobre el conteo de mensajes en las subscripciones de inspección del DLQ.
5. **Rate limits de Meta Graph API durante la reconciliación** si el volumen de jobs en `reconciliation_pending` crece — el diseño actual no especifica paginación/backpressure explícita dentro del Job; a definir en implementación real.
6. **Migración aditiva de `dulabs_dev_events` pendiente de aplicar** (`published_at`, `intentos_publicacion`, índice parcial — sección A) — el mecanismo de recuperación inbound ya está completamente diseñado, pero requiere este prerrequisito de esquema antes de poder implementarse; incluido como paso 0 del orden de despliegue (sección O).
7. **Cadencia del barrido de recuperación inbound acoplada a la de reconciliación outbound** (ambas cada 5 min, mismo Job) — es una elección deliberada para no crear un recurso nuevo, pero significa que un evento inbound atascado puede tardar hasta 5+2=7 minutos en el peor caso antes del primer intento de recuperación. Aceptable para V1 dado el volumen esperado; si el volumen de eventos inbound creciera mucho más que el de jobs outbound, podría justificar separar la cadencia (o el Job) más adelante — no bloqueante ahora.
8. **Volumen/aislamiento del CRUD de gestión dentro del mismo servicio `dulabs-gateway`** — nota de implementación (sección A), no bloqueante; se puede separar más adelante si se justifica.

---

## Resumen de cambios — ronda 3 (correcciones bloqueantes antes de implementación)

- **Sección A — `event_id` corregido**: ya no se usa el `wamid`/id del mensaje de WhatsApp (un mismo mensaje produce varios webhooks — `sent`/`delivered`/`read` — todos con el mismo `wamid`, lo cual habría deduplicado incorrectamente). Nuevo diseño: `event_id = SHA-256(canonicalización determinista del payload crudo del webhook)`, con la canonicalización (orden de claves recursivo, preservando orden de arrays) documentada explícitamente para neutralizar diferencias de serialización entre reentregas del mismo evento. `UNIQUE(event_id)` se mantiene sin cambios.
- **Sección A/G/I — mecanismo de recuperación inbound cerrado por completo**: ya no es una pieza pendiente. Se extiende `dulabs_dev_events` (Fase 2) con `published_at`/`intentos_publicacion` (migración aditiva, no aplicada todavía) en vez de crear una tabla/sistema paralelo; el Job `dulabs-reconciliation` adopta esta responsabilidad adicional (barrido cada 5 min, sin crear un Cloud Run Job nuevo), con el permiso `pubsub.publisher` sobre `dulabs-inbound` agregado a su identidad. Documentados los 8 puntos exigidos: campo de estado, momento de elegibilidad, proceso que recupera, cómo republica, cómo evita loop infinito, comportamiento ante cada escenario de fallo, por qué la republicación repetida es segura (mismo `event_id` + Worker inbound idempotente), y estado final del evento.
- **Sección Q.3 — test de redelivery outbound fortalecido**: ahora exige explícitamente demostrar, con dos instancias/requests reales distintas (no dos llamadas dentro del mismo proceso), la secuencia completa Worker A (lease + POST físico + resultado seguro) → Worker B (lease ya tomado → 200 → sin segundo POST) → y una verificación real de `dulabs_dev_usage_ledger` confirmando una sola fila (cero doble cobro), no solo cero duplicados físicos.
- **Sección O**: agregado el paso 0 (migración aditiva de `dulabs_dev_events`) como prerrequisito antes del resto del despliegue.
- **Sección R**: riesgo del mecanismo de recuperación inbound cerrado (ya no es "pendiente de detalle"), reemplazado por dos riesgos más precisos: la migración pendiente de aplicar, y la cadencia de 5 min compartida entre reconciliación outbound y barrido inbound.
- **Nada más se tocó** — todas las decisiones ya cerradas en rondas anteriores (Gateway, dos Workers, Pub/Sub push + OIDC, `dulabs-pubsub-invoker`, Scheduler API v2 + OAuth, KMS + envelope encryption, Secret Manager, Management API en Gateway, Vercel solo frontend, Budget Alert $20, `max-instances=0` descartado, DLQ best-effort, SAs explícitas, no default compute SA) permanecen intactas, sin reabrir.

## Cierre

Este documento es **diseño final para revisión** — no se creó, modificó ni eliminó ningún recurso de GCP para producirlo. No quedan decisiones de producto ni mecanismos técnicos sin definir. Las únicas notas pendientes son de implementación menor, explícitamente no bloqueantes (sección R.7 y R.8) y no impiden la aprobación de este diseño.
