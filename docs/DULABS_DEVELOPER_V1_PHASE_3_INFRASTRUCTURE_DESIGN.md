# DuLabs Developer V1 — Fase 3: Diseño Técnico de Infraestructura GCP

**Estado de este documento: DISEÑO — NADA EJECUTADO.** Ningún recurso de GCP fue creado, modificado ni eliminado para producir este documento. Todos los nombres/comandos de abajo son **propuestas** pendientes de aprobación de ChatGPT antes de cualquier `gcloud create`/`update`/`deploy`.

Continúa directamente sobre la auditoría inicial de Fase 3 (mensaje anterior) y sobre las decisiones arquitectónicas aprobadas: **Pub/Sub push → Cloud Run** (no pull permanente), **dos Workers separados** (inbound/outbound), **Cloud Scheduler → Cloud Run Job de reconciliación cada 5 min**, **KMS + envelope encryption** (sin clave estática en producción), **service accounts explícitas siempre**, y **preservar intactas** las garantías de Fase 1/2 (idempotencia, leases/CAS, `physical_outcome`, `reconciliation_pending`, no blind resend).

**Hallazgo relevante para el diseño de cifrado**: verifiqué (lectura real, no asumida) que las tablas `dulabs_dev_whatsapp_numbers`, `dulabs_dev_webhook_configs`, `dulabs_dev_api_keys` y `dulabs_dev_jobs` tienen **0 filas reales en producción** — todo lo probado hasta ahora fue con workspaces desechables limpiados en cada test. Esto significa que la migración a KMS envelope encryption (sección J) es un **cutover limpio**, sin datos legados que re-cifrar.

---

## A. Arquitectura final

```
                         ┌─────────────────────────┐
Developer/Client App ───▶│  dulabs-gateway (Cloud   │
   POST /api/v1/messages │  Run, público, auth por  │
                         │  API key dl_live_...)    │
                         └──────────┬───────────────┘
                                    │ publish
                                    ▼
                         ┌─────────────────────┐
                         │ topic dulabs-outbound│
                         └──────────┬───────────┘
                                    │ PUSH (OIDC)
                                    ▼
                         ┌─────────────────────────┐        ┌─────────────────┐
                         │ dulabs-outbound-worker   │───────▶│ Meta Graph API   │
                         │ (Cloud Run, sin acceso   │        └─────────────────┘
                         │ público, solo Pub/Sub)   │
                         └──────────┬───────────────┘
                                    │ persiste vía lib/developer/jobs-store.ts
                                    ▼
                         ┌─────────────────────┐
                         │ PostgreSQL (Supabase)│◀───────────┐
                         └──────────┬───────────┘            │
                                    │ jobs en reconciliation_pending
                                    ▼                         │
Meta webhook (inbound) ──▶┌─────────────────────┐            │
   /webhook-dulabs         │ topic dulabs-inbound │           │
   (existente, Business)   └──────────┬───────────┘           │
   ó Gateway (a decidir)              │ PUSH (OIDC)            │
                                       ▼                        │
                         ┌─────────────────────────┐            │
                         │ dulabs-inbound-worker    │            │
                         │ (Cloud Run, sin acceso   │            │
                         │ público, solo Pub/Sub)   │            │
                         └──────────────────────────┘            │
                                                                  │
        Cloud Scheduler (*/5 * * * *) ──OIDC──▶ dulabs-reconciliation (Cloud Run Job) ─┘
                                                  consulta Meta, NUNCA blind resend

KMS (dulabs-developer-keyring) ── envelope encryption ── usado por: gateway (al escribir
   secretos nuevos) y outbound-worker (al leer el token de Meta para enviar)

Secret Manager ── secretos de infraestructura (Supabase service_role key, Meta App
   Secret compartido, etc.) ── inyectados como env vars respaldadas por secreto en
   cada Cloud Run service/job

Vercel ── frontend, landing, documentación, Y (mientras no se decida lo contrario,
   ver nota abajo) el dashboard/API de gestión de Business que ya existe hoy
```

**Decisión de producto que dejo explícitamente abierta, no la asumo**: el contrato de Fase 1 define el Gateway de Cloud Run específicamente como `POST /api/v1/messages` (y por extensión el webhook entrante de Meta). Las operaciones CRUD de gestión del desarrollador (crear API keys, conectar números, configurar webhooks — `lib/developer/api-keys-store.ts`, `whatsapp-numbers-store.ts`, `webhook-config-store.ts`) **no están definidas en el contrato de Fase 1 como parte del Gateway**. Hoy esas funciones son código de librería sin un runtime HTTP asignado. Hay dos caminos:

1. **Esas rutas CRUD viven en Cloud Run también** (dentro del mismo servicio `dulabs-gateway` o un servicio nuevo `dulabs-management-api`) — así todo lo que llama a KMS corre con la identidad nativa de Cloud Run (Workload Identity automática, sin credenciales exportadas).
2. **Esas rutas CRUD se quedan en Next.js/Vercel** (mismo patrón que el dashboard de Business hoy) — pero entonces Vercel necesita autenticarse contra KMS sin un JSON key descargado (prohibido explícitamente en este entorno). La única forma limpia es **Workload Identity Federation** (Vercel como proveedor de identidad externo) — una pieza de diseño adicional no cubierta todavía.

**Recomiendo la opción 1** (evita por completo el problema de credenciales externas hacia GCP, cumple "sin JSON keys" de forma estructural), pero la dejo como punto explícito para tu aprobación, no la doy por decidida.

---

## B. Cloud Run services

| Campo | `dulabs-gateway` | `dulabs-outbound-worker` | `dulabs-inbound-worker` |
|---|---|---|---|
| Propósito | Recibe `POST /api/v1/messages`, autentica por API key, valida payload, reclama idempotencia (`crearJobConIdempotencia`), publica a `dulabs-outbound` | Push subscriber de `dulabs-outbound` — adquiere lease, llama a Meta Graph API, aplica transición de estado real | Push subscriber de `dulabs-inbound` — persiste eventos entrantes de Meta (status updates, mensajes de clientes) |
| Región | `us-central1` | `us-central1` | `us-central1` |
| Identidad | `dulabs-gateway@dulabs-developer-v1.iam.gserviceaccount.com` | `dulabs-worker@...` *(recomendado: SA dedicada `dulabs-worker-outbound@...`, ver sección H)* | `dulabs-worker@...` *(recomendado: SA dedicada `dulabs-worker-inbound@...`)* |
| Acceso público | **Sí** (`--allow-unauthenticated`) — es la API pública del desarrollador; la seguridad real es la API key a nivel de aplicación, no IAM de Cloud Run | **No** (`--no-allow-unauthenticated`) — solo invocable por el SA de push de Pub/Sub | **No** (`--no-allow-unauthenticated`) |
| Escala a cero | Sí (`--min-instances=0`) | Sí (`--min-instances=0`) | Sí (`--min-instances=0`) |
| Costo esperado | Por request, capa gratuita de Cloud Run cubre el volumen inicial de Developer V1 por completo | Por request (1 invocación push = 1 mensaje) | Por request |
| Dependencia | Imagen en Artifact Registry, Secret Manager (Supabase key), KMS (si opción 1 de la sección A) | Imagen, Secret Manager, KMS (decrypt del token de Meta) | Imagen, Secret Manager |
| Configuración propuesta | `--cpu=1 --memory=512Mi --max-instances=10 --timeout=30s --service-account=dulabs-gateway@... --allow-unauthenticated` | `--cpu=1 --memory=512Mi --max-instances=20 --timeout=60s --service-account=... --no-allow-unauthenticated` | `--cpu=1 --memory=256Mi --max-instances=20 --timeout=30s --service-account=... --no-allow-unauthenticated` |

`--timeout` del Worker outbound (60s) debe ser mayor al ack deadline de su subscripción (sección D) para que el handler pueda decidir con calma entre `success_confirmed`/`meta_rechazo`/`incertidumbre_de_red` antes de que Cloud Run mate la request — pero el ack a Pub/Sub debe emitirse en cuanto el job queda en un estado seguro (ver sección E, "ack behavior").

---

## C. Pub/Sub topics

Ya existen, **no se recrean**: `dulabs-inbound`, `dulabs-outbound` (confirmado en la auditoría). No se proponen topics nuevos aparte de los dos dead-letter topics de la sección E.

---

## D. Push subscriptions

Las subscripciones `dulabs-inbound-worker` y `dulabs-outbound-worker` **ya existen como pull** — no requieren borrarse/recrearse: `gcloud pubsub subscriptions modify-push-config` las convierte a push in-place, conservando el nombre y el topic asociado.

| Campo | `dulabs-outbound-worker` | `dulabs-inbound-worker` |
|---|---|---|
| Push endpoint | URL del servicio `dulabs-outbound-worker` + `/push` | URL del servicio `dulabs-inbound-worker` + `/push` |
| Autenticación | OIDC token, audience = URL del propio servicio, firmado por una SA dedicada (ver sección H, `dulabs-pubsub-invoker`) | Igual |
| `ackDeadlineSeconds` | **30s** (no el default de 10s — ver riesgo detectado en la auditoría) | **20s** |
| `retryPolicy.minimumBackoff` | 10s | 10s |
| `retryPolicy.maximumBackoff` | 300s | 300s |
| Dead-letter topic | `dulabs-outbound-dlq` | `dulabs-inbound-dlq` |
| `maxDeliveryAttempts` | **5** | **5** |
| Configuración propuesta | `gcloud pubsub subscriptions modify-push-config dulabs-outbound-worker --push-endpoint=https://<url-worker>/push --push-auth-service-account=dulabs-pubsub-invoker@... --push-auth-token-audience=https://<url-worker>` + `gcloud pubsub subscriptions update dulabs-outbound-worker --min-retry-delay=10s --max-retry-delay=300s --dead-letter-topic=dulabs-outbound-dlq --max-delivery-attempts=5 --ack-deadline=30` | Análogo |

---

## E. DLQ y retry strategy

### Dead-letter topics nuevos

| Nombre | Propósito | Región | Costo | Configuración propuesta |
|---|---|---|---|---|
| `dulabs-outbound-dlq` | Recibe mensajes de `dulabs-outbound-worker` que agotaron 5 intentos de entrega | `us-central1` (topics de Pub/Sub no son regionales, pero la subscripción de inspección sí) | Mínimo (solo paga por volumen, y el volumen esperado de mensajes muertos es ~0 en operación normal) | `gcloud pubsub topics create dulabs-outbound-dlq` |
| `dulabs-inbound-dlq` | Análogo, para `dulabs-inbound-worker` | — | Mínimo | `gcloud pubsub topics create dulabs-inbound-dlq` |
| `dulabs-outbound-dlq-inspect` (subscription) | Subscripción **pull** sobre el DLQ, para inspección manual/alerta — nunca procesa automáticamente | — | Mínimo | `gcloud pubsub subscriptions create dulabs-outbound-dlq-inspect --topic=dulabs-outbound-dlq` |
| `dulabs-inbound-dlq-inspect` (subscription) | Análoga | — | Mínimo | `gcloud pubsub subscriptions create dulabs-inbound-dlq-inspect --topic=dulabs-inbound-dlq` |

**IAM requerido para que el dead-lettering funcione** (GCP lo exige explícitamente, no es opcional): el *service agent* de Pub/Sub (`service-654668494598@gcp-sa-pubsub.iam.gserviceaccount.com`, ya visible en la auditoría con `roles/pubsub.serviceAgent`) necesita `roles/pubsub.publisher` sobre cada DLQ topic y `roles/pubsub.subscriber` sobre la subscripción de origen. `gcloud pubsub subscriptions update --dead-letter-topic=...` lo configura automáticamente si quien ejecuta el comando tiene permisos suficientes (el deployer los tiene: `pubsub.editor`).

### Ack behavior — el punto más delicado del diseño (outbound)

Esta es la pieza que garantiza "no duplicados físicos" bajo push + at-least-once + autoscaling de Cloud Run (varias instancias pueden recibir copias redundantes del mismo mensaje):

1. **El handler SIEMPRE intenta `adquirirLease` primero**, antes de tocar Meta. Si el resultado es `"ya_tomado"` (otra entrega concurrente del mismo mensaje ya tiene el lease), el handler responde **HTTP 200 inmediatamente** — no es un error, es la protección de Fase 2 funcionando exactamente como se diseñó. Pub/Sub ackea y no reintenta.
2. **Si el envío físico a Meta resulta en éxito confirmado o rechazo cierto de Meta** (`meta_confirmo_exito` / `meta_rechazo`), el handler aplica la transición vía `aplicarEventoJob` y responde **HTTP 200**. El job queda en un estado terminal o en `retry_pending` (que se re-encola de forma explícita y controlada, no por redelivery de Pub/Sub — ver nota abajo).
3. **Regla crítica**: si el resultado es **incertidumbre de red** (`incertidumbre_de_red`), el handler transiciona el job a `reconciliation_pending` y responde **HTTP 200 también** — nunca un código que provoque que Pub/Sub reintregue el mensaje. Reintregar acá violaría directamente "no blind resend": la única vía autorizada para sacar un job de `reconciliation_pending` es el Job de reconciliación (sección G), nunca una redelivery de Pub/Sub.
4. **Errores transitorios de infraestructura** (Postgres momentáneamente inalcanzable, timeout antes de siquiera intentar el lease) — el handler responde **HTTP 5xx**, dejando que Pub/Sub reintente con el backoff configurado (sección D). En este punto todavía no se tocó Meta, así que un reintento es seguro.
5. **Errores permanentes de validación** (mensaje malformado, `job_id` inexistente) — el handler responde **HTTP 200** igual (ackea) después de registrar el evento como `failed` vía `registrarEvento`, porque reintentar un mensaje que nunca va a poder procesarse solo desperdicia los 5 intentos hasta el DLQ sin ganar nada; se prefiere que quede trazado como evento fallido de inmediato y sea visible en logs/monitoring.

**`retry_pending` nunca se dispara por una redelivery de Pub/Sub** — se re-encola explícitamente publicando un nuevo mensaje a `dulabs-outbound` (con el mismo `job_id`) desde el propio Worker o desde el Job de reconciliación, nunca dejando que Pub/Sub "reintente" el mensaje original después de que ya fue ackeado.

### Inbound

Menos crítico (no hay riesgo de "enviar dos veces" — solo de procesar dos veces un webhook entrante), pero usa el mismo patrón: dedup por `event_id` vía `registrarEvento` (Fase 2, `UNIQUE(event_id)`) ANTES de cualquier efecto secundario; si `registrado: false` (duplicado), el handler responde 200 sin reprocesar.

---

## F. Cloud Scheduler

| Campo | Valor |
|---|---|
| Nombre propuesto | `dulabs-reconciliation-trigger` |
| Propósito | Disparar la ejecución del Cloud Run Job de reconciliación cada 5 minutos |
| Región | `us-central1` |
| Frecuencia | `*/5 * * * *` (cada 5 min, confirmado por la decisión) |
| Target | HTTP, `POST https://us-central1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/dulabs-developer-v1/jobs/dulabs-reconciliation:run` (API de ejecución de Cloud Run Jobs) |
| Identidad | **Nueva SA requerida**: `dulabs-scheduler-invoker@dulabs-developer-v1.iam.gserviceaccount.com` (no existe todavía) |
| Permisos | `roles/run.invoker` sobre el Job `dulabs-reconciliation` específicamente (IAM a nivel de recurso, no de proyecto) |
| Autenticación | OIDC token generado por Cloud Scheduler con esa SA como firmante |
| Costo esperado | Cloud Scheduler cobra por job configurado (no por ejecución) — 3 jobs gratis por proyecto en el tier gratuito; con 1 solo job (`dulabs-reconciliation-trigger`) el costo es **$0** |
| Escala a cero | N/A (Scheduler es un recurso de control, no de cómputo) |
| Configuración propuesta | `gcloud scheduler jobs create http dulabs-reconciliation-trigger --schedule="*/5 * * * *" --uri=".../jobs/dulabs-reconciliation:run" --http-method=POST --oidc-service-account-email=dulabs-scheduler-invoker@... --location=us-central1` |

---

## G. Reconciliation Job

| Campo | Valor |
|---|---|
| Nombre | `dulabs-reconciliation` (ya existe la SA runtime, falta el Job en sí) |
| Propósito | Cada 5 min: consulta `dulabs_dev_jobs` con `status='reconciliation_pending'` (el índice parcial de Fase 2, `dulabs_dev_jobs_reconciliation_idx`, ya existe exactamente para esta consulta), para cada uno pregunta a Meta el estado real del mensaje, y **solo si Meta confirma que el envío original NUNCA llegó**, aplica el evento `reconciliacion_confirmo_no_enviado` (Fase 1, `outbound-state-machine.ts`) — que mueve el job a `retry_pending` (si quedan intentos) o `failed_by_meta` (si no) |
| Región | `us-central1` |
| Identidad | `dulabs-reconciliation@dulabs-developer-v1.iam.gserviceaccount.com` (ya existe) |
| Permisos | `roles/secretmanager.secretAccessor`, `roles/cloudkms.cryptoKeyEncrypterDecrypter` (para leer el token de Meta y consultar el estado), acceso a Postgres vía Secret Manager (misma cadena de conexión que el resto) |
| Dependencia | Imagen en Artifact Registry, KMS, Secret Manager, Cloud Scheduler (trigger) |
| Costo esperado | Solo mientras corre — una ejecución de reconciliación de duración corta (segundos a pocos minutos según volumen de jobs pendientes), 288 ejecuciones/día a 5 min de frecuencia; con el volumen actual de Developer V1 (0 jobs reales todavía) el costo es prácticamente cero |
| Escala a cero | Sí por diseño — un Cloud Run Job no queda "encendido" entre ejecuciones |
| Configuración propuesta | `gcloud run jobs create dulabs-reconciliation --image=... --service-account=dulabs-reconciliation@... --region=us-central1 --max-retries=1 --task-timeout=300s` |

**Regla que el Job debe respetar sin excepción** (ya validada en Fase 2 vía `jobs-store.ts`/`outbound-state-machine.ts`, se reusa sin modificar): el Job **nunca** reenvía físicamente un mensaje por su cuenta — su único rol es consultar a Meta y, si Meta confirma "nunca llegó", **delegar** el reintento pasando el job a `retry_pending`; el reenvío físico real solo ocurre después, cuando el Worker outbound recoge ese job re-encolado. `--max-retries=1` en el propio Job (a nivel de Cloud Run, no del mensaje) evita que una ejecución fallida del Job mismo (ej. error de conexión a Postgres) se reintente indefinidamente sin visibilidad.

---

## H. Service Accounts

| SA | Estado | Usada por | Permisos nuevos requeridos (sección I) |
|---|---|---|---|
| `dulabs-gateway@...` | Ya existe | Cloud Run service `dulabs-gateway` | Pub/Sub publisher, Secret Manager accessor, KMS (si aplica opción 1 de la sección A) |
| `dulabs-worker@...` | Ya existe (única, genérica) | — | Ver recomendación abajo |
| `dulabs-worker-outbound@...` | **Nueva, recomendada** | Cloud Run service `dulabs-outbound-worker` | Pub/Sub subscriber (solo sobre `dulabs-outbound-worker`), Secret Manager accessor, KMS encrypter/decrypter |
| `dulabs-worker-inbound@...` | **Nueva, recomendada** | Cloud Run service `dulabs-inbound-worker` | Pub/Sub subscriber (solo sobre `dulabs-inbound-worker`), Secret Manager accessor |
| `dulabs-reconciliation@...` | Ya existe | Cloud Run Job `dulabs-reconciliation` | Secret Manager accessor, KMS encrypter/decrypter |
| `dulabs-pubsub-invoker@...` | **Nueva, requerida** | Identidad que Pub/Sub usa para firmar el OIDC token de cada push | `roles/run.invoker` sobre `dulabs-outbound-worker` y `dulabs-inbound-worker` (no más) |
| `dulabs-scheduler-invoker@...` | **Nueva, requerida** | Identidad que Cloud Scheduler usa para invocar el Job | `roles/run.invoker` sobre el Job `dulabs-reconciliation` (no más) |
| Default compute SA | Ya existe, **nunca se usa** | — | Ninguno — se recomienda no tocarla activamente pero garantizar por convención (`--service-account` explícito siempre) que ningún deploy caiga en ella por omisión |

**Sobre inbound/outbound**: recomiendo separar (`dulabs-worker-outbound` / `dulabs-worker-inbound`) en vez de reusar la única `dulabs-worker` existente, por *blast radius*: el Worker outbound necesita `cloudkms.cryptoKeyEncrypterDecrypter` (toca el token de Meta para enviar) y acceso de escritura a `dulabs_dev_jobs`/`dulabs_dev_usage_ledger`; el Worker inbound solo necesita persistir eventos entrantes, no descifra nada de Meta para enviar. Darle a ambos la misma identidad significa que un bug/compromiso en el path inbound (superficie más expuesta, procesa payloads de terceros) heredaría permisos de KMS que no necesita. Es una recomendación técnica de menor privilegio, no una decisión de producto — la dejo para tu aprobación explícita ya que agrega 2 SAs nuevas a las 4 ya inventariadas.

**Regla dura, ya acordada**: todo `gcloud run deploy` / `gcloud run jobs create` / `gcloud run jobs execute` en este proyecto debe llevar `--service-account=<SA explícita>`. Nunca se omite (lo cual caería en la default compute SA con `roles/editor`).

---

## I. IAM mínimo necesario

Resumen de todos los bindings nuevos propuestos (ninguno aplicado todavía):

| Identidad | Rol | Alcance | Motivo |
|---|---|---|---|
| `dulabs-gateway@...` | `roles/pubsub.publisher` | Topic `dulabs-outbound` (y `dulabs-inbound` si el webhook de Meta entra por el Gateway) | Publicar el job tras `crearJobConIdempotencia` |
| `dulabs-gateway@...` | `roles/secretmanager.secretAccessor` | Secretos específicos (sección K), no `secretmanager.admin` | Leer la cadena de conexión a Supabase, etc. |
| `dulabs-gateway@...` | `roles/cloudkms.cryptoKeyEncrypterDecrypter` | Solo la key `dulabs-developer-master-key` | Si el CRUD de secretos vive en el Gateway (opción 1, sección A) |
| `dulabs-worker-outbound@...` (o `dulabs-worker`) | `roles/pubsub.subscriber` | Solo la subscripción `dulabs-outbound-worker` | Recibir push (técnicamente el rol se valida vía el push auth, pero el subscriber es necesario para que la subscripción funcione) |
| `dulabs-worker-outbound@...` | `roles/secretmanager.secretAccessor` | Secretos específicos | Cadena de conexión a Postgres |
| `dulabs-worker-outbound@...` | `roles/cloudkms.cryptoKeyEncrypterDecrypter` | Solo `dulabs-developer-master-key` | Descifrar el token de Meta antes de llamar a Graph API |
| `dulabs-worker-inbound@...` (o `dulabs-worker`) | `roles/pubsub.subscriber` | Solo `dulabs-inbound-worker` | Recibir push |
| `dulabs-worker-inbound@...` | `roles/secretmanager.secretAccessor` | Secretos específicos | Persistir eventos entrantes |
| `dulabs-reconciliation@...` | `roles/secretmanager.secretAccessor` | Secretos específicos | Igual que Worker |
| `dulabs-reconciliation@...` | `roles/cloudkms.cryptoKeyEncrypterDecrypter` | Solo `dulabs-developer-master-key` | Leer el token de Meta para consultar el estado real |
| `dulabs-pubsub-invoker@...` | `roles/run.invoker` | Solo `dulabs-outbound-worker` y `dulabs-inbound-worker` | Permitir que Pub/Sub invoque los Workers vía push |
| Pub/Sub service agent (`service-654668494598@gcp-sa-pubsub...`) | `roles/iam.serviceAccountTokenCreator` | Sobre `dulabs-pubsub-invoker@...` | Requisito de GCP: Pub/Sub necesita poder "actuar como" la SA de invoker para firmar el OIDC token de cada push |
| `dulabs-scheduler-invoker@...` | `roles/run.invoker` | Solo el Job `dulabs-reconciliation` | Permitir que Cloud Scheduler ejecute el Job |

**Principio aplicado en toda la tabla**: ningún rol a nivel de proyecto, todo scoped al recurso específico (`--resource-name` en cada `gcloud ... add-iam-policy-binding`). Ninguna de estas identidades recibe `roles/*.admin` ni `roles/editor` — eso se queda exclusivamente en el deployer (`dulabs-developer-deploy`), que ya lo tiene y no se toca.

---

## J. KMS + envelope encryption

| Campo | Valor |
|---|---|
| Keyring propuesto | `dulabs-developer-keyring` |
| Región | `us-central1` (regional, coherente con el resto de la infraestructura; no hay necesidad de una key global) |
| Key propuesta | `dulabs-developer-master-key` |
| Propósito | `ENCRYPT_DECRYPT` |
| Nivel de protección | `SOFTWARE` (HSM queda como mejora futura opcional, no necesaria para el volumen actual — agrega costo sin beneficio de seguridad adicional relevante en esta etapa) |
| Rotación | Automática, período propuesto de 90 días — KMS mantiene versiones anteriores activas para descifrado, así que dato cifrado con una versión vieja sigue siendo legible sin necesidad de re-cifrar nada al rotar |
| Costo esperado | ~$0.06/mes por versión de key activa + ~$0.03 por cada 10.000 operaciones de encrypt/decrypt — despreciable al volumen actual |
| Configuración propuesta | `gcloud kms keyrings create dulabs-developer-keyring --location=us-central1` + `gcloud kms keys create dulabs-developer-master-key --keyring=dulabs-developer-keyring --location=us-central1 --purpose=encryption --rotation-period=90d --next-rotation-time=...` |

### Patrón de envelope encryption propuesto

Extiende `lib/developer/secure-crypto.ts` (Fase 1/2, sin romper su interfaz pública `cifrarSecretoDev`/`descifrarSecretoDev`) con un nuevo formato versionado `dev2:` que coexiste con el `dev1:` actual durante la transición (aunque, dado que no hay datos reales en producción todavía, el cutover puede ser directo — sin necesidad real de soporte dual):

1. **Al cifrar**: generar una DEK (Data Encryption Key) aleatoria de 32 bytes localmente → cifrar el secreto real con AES-256-GCM usando esa DEK (exactamente el mismo código que ya existe) → envolver (`encrypt`) esa DEK con la KMS key vía la API de KMS → persistir `dev2:<dekEnvueltaBase64>:<iv>:<authTag>:<ciphertext>`.
2. **Al descifrar**: desenvolver (`decrypt`) la DEK vía KMS → usar la DEK en claro (solo en memoria, nunca persistida) para descifrar con AES-256-GCM como hoy.
3. **Fail-closed se mantiene idéntico**: si KMS no está disponible o la llamada falla, se propaga el error tal como `ClaveNoDisponibleError` hoy — nunca hay fallback a la clave estática de entorno en producción. `DEVELOPER_TOKEN_ENCRYPTION_KEY` queda reservado exclusivamente para entornos locales/CI sin acceso a GCP (tests, igual que hoy), nunca como ruta válida en producción.
4. **Quién puede envolver/desenvolver**: solo las identidades con `roles/cloudkms.cryptoKeyEncrypterDecrypter` sobre esta key específica (sección I) — ni el Gateway ni los Workers reciben permisos de administración de la key (`cloudkms.admin` se queda exclusivamente en el deployer, igual que hoy).

**Decisión técnica que SÍ tomo** (no es de producto): usar envelope encryption con DEK por operación (no una DEK fija reusada) — es el patrón estándar recomendado por Google para este caso, minimiza el "blast radius" de una DEK filtrada (cada secreto tiene la suya), y el costo adicional de una llamada a KMS por operación es despreciable al volumen de Developer V1.

---

## K. Secret Manager

| Secreto propuesto | Contenido | Usado por | Costo | Configuración propuesta |
|---|---|---|---|---|
| `supabase-service-role-key` | La misma `SUPABASE_SERVICE_ROLE_KEY` que hoy vive en Vercel | Gateway, ambos Workers, Reconciliation | Mínimo (~$0.06/versión activa/mes) | `gcloud secrets create supabase-service-role-key --replication-policy=automatic` |
| `supabase-url` | `SUPABASE_URL` | Igual | Mínimo | Igual |
| `meta-app-secret` | App Secret de Meta compartido a nivel de plataforma DuLabs (si aplica — distinto del token por-desarrollador que va cifrado en la DB vía KMS) | Gateway (verificación de firma del webhook de Meta, si entra por acá) | Mínimo | A confirmar si ya existe un equivalente en Vercel hoy |

**Lo que NO va en Secret Manager**: los tokens de Meta por-workspace y los secretos de webhook por-desarrollador — esos ya están diseñados para vivir cifrados en Postgres vía KMS (Fase 2), no duplicados en Secret Manager. Secret Manager es exclusivamente para credenciales de infraestructura compartidas entre todos los workspaces, no para datos por-tenant.

Cada Cloud Run service/job referencia estos secretos como variables de entorno respaldadas por secreto (`--set-secrets=SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest`), nunca como valor plano en la configuración del servicio.

---

## L. Docker/build strategy

- Un `Dockerfile` por runtime (`Dockerfile.gateway`, `Dockerfile.worker-outbound`, `Dockerfile.worker-inbound`, `Dockerfile.reconciliation`) o un único Dockerfile multi-stage con distinto `ENTRYPOINT` seleccionado por variable de entorno — **decisión técnica a definir en la implementación**, no bloquea el diseño.
- Imagen base recomendada: `node:22-slim` (o la versión LTS vigente en ese momento), consistente con el resto del repo (Next.js 16 ya requiere Node moderno).
- Build: `gcloud builds submit --tag us-central1-docker.pkg.dev/dulabs-developer-v1/dulabs-developer/<servicio>:<tag>` usando el `cloudbuild.builds.editor` que el deployer ya tiene — **manual al principio** (ejecutado por el deployer bajo demanda), automatización vía Cloud Build Trigger conectado al repo de GitHub queda como mejora posterior, no bloqueante para el primer despliegue.
- Tag de imagen: usar el SHA corto del commit (`git rev-parse --short HEAD`), nunca `:latest` en producción — necesario para el rollback de la sección P.

---

## M. Cost-control strategy

- **Todos** los Cloud Run services con `--min-instances=0` — cero costo de cómputo fuera de request activo.
- Cloud Run Jobs no tienen costo fuera de su ejecución por diseño.
- Cloud Scheduler: 1 solo job configurado → dentro del tier gratuito de 3 jobs/mes.
- Pub/Sub: cobra por volumen de mensajes/almacenamiento — al volumen actual (0 jobs reales) el costo es $0; sigue siendo despreciable incluso en los primeros meses de operación real de Developer V1 dado el límite de 20k mensajes/mes del plan Developer ($19/mes, Fase 0).
- KMS/Secret Manager: costo fijo pequeño por key/secreto + por operación, despreciable.
- `--max-instances` explícito en cada servicio (propuesto: 10 para Gateway, 20 para cada Worker) — control duro contra un pico de tráfico inesperado o un bug que genere un loop de reintentos.
- **Recomendación no incluida en el inventario original**: crear un *Budget Alert* en Cloud Billing (ej. alertar a partir de $20/mes) — es un recurso nuevo, lo dejo como sugerencia para aprobación explícita, no lo doy por incluido en el plan de despliegue.

---

## N. Security controls

- Ningún servicio/Job usa la default compute SA (regla dura, sección H).
- Workers y Job de reconciliación **sin acceso público** — únicamente invocables por las identidades de push/scheduler dedicadas.
- Gateway público, pero la autenticación real es a nivel de aplicación (API key `dl_live_...`, ya construida y probada en Fase 1/2) — IAM de Cloud Run no reemplaza esa capa, la complementa.
- SSRF guard (`ssrf-guard.ts`, Fase 1) se reusa sin cambios para validar cualquier URL de webhook configurada por un desarrollador, sin importar desde qué runtime se invoque.
- Firma HMAC de webhooks salientes (`webhook-signature.ts`, Fase 1) se reusa sin cambios.
- KMS como raíz de confianza única para cifrado — sin clave estática en producción (sección J).
- Ningún secreto se loguea — convención ya establecida en todo el repo, debe mantenerse en el logging estructurado de Cloud Run (Cloud Logging captura stdout/stderr automáticamente, así que el mismo cuidado de "nunca `console.log` un secreto" aplica igual ahí).
- Sin VPC/Compute Engine habilitado — decisión ya confirmada en la auditoría (Supabase se alcanza por HTTPS público, igual que hoy desde Vercel), no se reabre.
- IAM siempre a nivel de recurso específico, nunca de proyecto, para las identidades runtime (sección I).

---

## O. Deployment order

Orden propuesto, cada paso depende del anterior — **nada de esto se ejecuta ahora**:

1. Crear keyring + key de KMS (sección J) — es la base de confianza, todo lo demás puede depender de que exista.
2. Crear los secretos en Secret Manager (sección K) con sus valores reales.
3. Crear las 2 SAs nuevas (`dulabs-pubsub-invoker`, `dulabs-scheduler-invoker`) y, si se aprueba la recomendación de la sección H, las 2 SAs de Worker separadas.
4. Aplicar todos los bindings IAM de la sección I (a nivel de recurso, no de proyecto).
5. Construir y subir las imágenes Docker a Artifact Registry (sección L) — hoy está vacío.
6. Desplegar los 3 Cloud Run services (Gateway, Worker outbound, Worker inbound) con `--service-account` explícito y `--no-allow-unauthenticated` donde corresponda.
7. Crear el Cloud Run Job `dulabs-reconciliation`.
8. Crear los 2 dead-letter topics + sus subscripciones de inspección (sección E) — **antes** del paso 9, porque una subscripción no puede referenciar un dead-letter-topic que no existe todavía.
9. Convertir `dulabs-inbound-worker`/`dulabs-outbound-worker` de pull a push (`modify-push-config` + `update` con retry/DLQ policy) — este es el único paso que toca recursos ya existentes, y se hace al final, cuando los Workers que van a recibir el push ya están desplegados y respondiendo.
10. Crear el job de Cloud Scheduler (sección F) apuntando al Job de reconciliación ya desplegado.
11. Ejecutar los tests de infraestructura reales de la sección Q.
12. (Opcional, recomendado) Configurar el Budget Alert de la sección M.

---

## P. Rollback strategy

- **Cloud Run services**: cada deploy crea una nueva revisión; `gcloud run services update-traffic <servicio> --to-revisions=<revisión-anterior>=100` revierte el tráfico al 100% a la revisión previa sin rehacer el build. Ninguna imagen se sobreescribe (`:latest` prohibido, sección L) — la revisión anterior siempre tiene su imagen intacta en Artifact Registry.
- **Cloud Run Job**: análogo — se puede volver a ejecutar una revisión anterior del Job (`gcloud run jobs executions ...` referenciando la imagen previa) si una nueva versión del Job de reconciliación tuviera un bug.
- **Pub/Sub push**: interruptor de emergencia real — `gcloud pubsub subscriptions modify-push-config <sub> --push-endpoint=""` **revierte la subscripción a pull** de inmediato, deteniendo toda entrega automática sin borrar ni la subscripción ni los mensajes en vuelo, mientras se investiga un problema en el Worker.
- **KMS**: nunca se destruye una versión de key manualmente ante un incidente — se **deshabilita** (`gcloud kms keys versions disable`), lo cual bloquea nuevas operaciones pero (a diferencia de destruir) sigue siendo reversible (`enable` de nuevo) si el "incidente" resulta ser una falsa alarma.
- **Frenar todo sin borrar nada**: bajar `--max-instances=0` en un Worker específico detiene su procesamiento por completo (los mensajes se acumulan en la subscripción, dentro de la ventana de retención de 7 días) sin eliminar ninguna configuración — útil como pausa de emergencia mientras se decide un rollback más fino.

---

## Q. Tests de infraestructura (planeados, no ejecutados — nada existe todavía para probar)

Siguiendo la misma disciplina de evidencia real usada en Fase 1/2 (nunca `PASS PASS PASS` simulado), una vez implementado esto se deben correr, contra los recursos reales:

1. **Auth de push real**: un `curl` directo al endpoint del Worker sin token OIDC válido debe devolver 401/403 — confirma que Pub/Sub push está realmente protegido, no accesible públicamente por error.
2. **Ack correcto bajo incertidumbre**: publicar un mensaje sintético a `dulabs-outbound` contra un fixture que simule un timeout de red hacia Meta, confirmar que el job termina en `reconciliation_pending` (no en `retry_pending`) y que Pub/Sub NO reintenta la entrega (mirar métricas de la subscripción).
3. **Cero duplicados físicos bajo redelivery forzada**: forzar una redelivery real (dejar que expire el `ackDeadline` una vez a propósito) sobre un job que S\Í se pudo enviar a tiempo, y confirmar con una consulta real a `dulabs_dev_jobs`/`dulabs_dev_usage_ledger` que no hay una segunda fila de ledger ni una segunda llamada física a Meta — mismo estándar de evidencia que `crash-recovery.test.ts` de Fase 1 (contador real, no un mock).
4. **DLQ real**: un mensaje diseñado para fallar siempre (ej. un `job_id` que no existe) debe terminar en `dulabs-outbound-dlq` después de exactamente 5 intentos, verificado leyendo la subscripción de inspección.
5. **Cloud Scheduler real**: confirmar en el historial de ejecuciones del Job (`gcloud run jobs executions list`) que el trigger de Scheduler efectivamente lo ejecuta cada 5 minutos.
6. **KMS real**: roundtrip de cifrado/descifrado contra la key real (no mock), y confirmar que un ciphertext manipulado un solo byte sigue fallando por auth-tag de GCM — mismo criterio que `secure-crypto.test.ts` local, ahora contra la infraestructura real.
7. **IAM real**: confirmar que un intento de invocar el Worker outbound con la identidad del Worker inbound (o cualquier identidad no autorizada) es rechazado por Cloud Run IAM — prueba real de que el principio de menor privilegio de la sección I efectivamente se aplica, no solo se documentó.

---

## R. Riesgos residuales

1. **Ventana entre `ackDeadline` y el tiempo real de un request a Meta**: si Meta responde lento, el handler podría no alcanzar a decidir el estado antes de que Pub/Sub considere el mensaje no-ackeado y lo redelivere — mitigado por el `ackDeadlineSeconds=30` propuesto (vs. el default de 10) y por el hecho de que una redelivery concurrente queda bloqueada por el lease (sección E, punto 1), pero sigue siendo una ventana a monitorear en producción real.
2. **KMS como dependencia dura**: si KMS tiene una interrupción, todo el cifrado/descifrado falla-cerrado (por diseño, correcto) pero eso significa que el Gateway/Workers no podrían operar sobre secretos durante ese tiempo — es un tradeoff de disponibilidad vs. seguridad ya implícito en la decisión de "KMS como raíz de confianza", lo señalo para que quede explícito, no lo cuestiono.
3. **Autoscaling + push puede generar más concurrencia real de la que hay hoy en local** — el lease/CAS de Fase 2 fue probado con concurrencia simulada (`Promise.all` dentro de un mismo proceso Node); en Cloud Run real la concurrencia viene de múltiples contenedores/instancias distintas. El mecanismo (UPDATE atómico en Postgres) es el mismo y debería sostenerse igual, pero merece un test de infraestructura real dedicado (sección Q, punto 3) antes de confiar en él a escala.
4. **DLQ sin alerta configurada todavía** — un mensaje que cae en el DLQ hoy quedaría ahí sin que nadie se entere hasta que alguien lo revise manualmente. Recomiendo (sin asumirlo como parte del plan) una alerta de Cloud Monitoring sobre el conteo de mensajes en las subscripciones de inspección del DLQ.
5. **Rate limits de Meta Graph API durante la reconciliación**: si el volumen de jobs en `reconciliation_pending` crece, el Job cada 5 minutos podría acercarse a los límites de la API de Meta — el diseño actual no especifica paginación/backpressure explícita dentro del Job; a definir en la implementación real, no bloquea el diseño de infraestructura.
6. **Ambigüedad de dónde vive el CRUD de gestión** (sección A) — mientras no se resuelva, no se puede finalizar con certeza el conjunto exacto de permisos KMS del Gateway.
7. **Separar o no las SAs de Worker inbound/outbound** (sección H) sigue pendiente de tu aprobación — el resto del diseño funciona igual con una sola SA compartida, solo cambia el radio de exposición.

---

## Cierre

Este documento es **diseño puro**. No se creó, modificó ni eliminó ningún recurso de GCP. Quedan explícitas 3 decisiones que no me correspondía tomar unilateralmente (sección A: dónde vive el CRUD de gestión; sección H: SAs de Worker separadas o compartidas; sección M: Budget Alert) — el resto son decisiones técnicas dentro del marco ya aprobado por ChatGPT, listas para implementación en cuanto se autorice.
