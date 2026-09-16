# DuLabs Developer V1 — Fase 3 (Infraestructura GCP) — Reporte de Cierre Canónico

**Estado: READY FOR FINAL REVIEW (no FROZEN — pendiente de revisión final del usuario)**

Documento único y canónico. Consolida y **reemplaza** el reporte de cierre inicial, el *Closure Addendum* (riesgos #1/#3/#4/#5) y el *Usage Reservation Closure Addendum*. Numeración de riesgos unificada — no usar la numeración de los documentos anteriores.

Proyecto GCP: `dulabs-developer-v1` (654668494598) · Región: `us-central1` · Rama: `feature/developer-v1-fase1-arquitectura` · 10 commits locales, no pusheados · Working tree limpio.

---

## A. Arquitectura final implementada

```
Meta ──POST webhook──▶ Gateway (Cloud Run, público)
                          │ valida firma HMAC (App Secret real, Secret Manager)
                          │ calcula event_id = SHA-256(canonicalización determinista)
                          │ registrarEvento (dulabs_dev_events, UNIQUE event_id)
                          └─publish──▶ dulabs-inbound (topic) ──push+OIDC──▶ Worker inbound (privado)
                                                                                  │ CAS justo antes del relay real
                                                                                  │ descifra secreto webhook (KMS real)
                                                                                  └─▶ Developer Webhook (HMAC)

Developer ──POST /api/v1/messages──▶ Gateway
                                        └─autenticarApiKey → crearJobConIdempotencia
                                            ├─ dulabs_dev_jobs (INSERT)
                                            └─ dulabs_dev_usage_ledger (reservarUso, real)
                                        └─publish──▶ dulabs-outbound (topic) ──push+OIDC──▶ Worker outbound (privado)
                                                                                    │ lease/CAS → POST real a Meta
                                                                                    └─▶ confirmarUso / liberarUso

Cloud Scheduler (cada 5 min, OAuth) ──▶ dulabs-reconciliation (Cloud Run Job)
   ├─ reconciliación outbound: consulta a Meta (endpoint NO real hoy — ver riesgo #4) → nunca reenvía físicamente
   ├─ recovery inbound: barre dulabs_dev_events con published_at IS NULL y >2min, re-publica
   └─ reintento outbound: barre dulabs_dev_jobs en retry_pending, re-publica a dulabs-outbound
```

Todo el estado persistente reutiliza Fase 1/2 (`dulabs_dev_jobs`, `dulabs_dev_events`, `dulabs_dev_usage_ledger`, lease/CAS, usage-ledger, máquina de estados) — no se duplicó lógica de negocio en ningún momento de la Fase 3.

---

## B. Recursos GCP reales creados

| Recurso | Nombre | Propósito |
|---|---|---|
| Artifact Registry repo | `dulabs-developer` | Imágenes de los 4 servicios |
| Cloud Run service | `dulabs-gateway` | API pública (mensajes salientes, webhook Meta, management API) |
| Cloud Run service | `dulabs-outbound-worker` | Procesa envíos hacia Meta (privado) |
| Cloud Run service | `dulabs-inbound-worker` | Procesa/relee eventos entrantes (privado) |
| Cloud Run Job | `dulabs-reconciliation` | Reconciliación outbound + recovery inbound + reintento retry_pending |
| Pub/Sub topic | `dulabs-outbound` | Mensajes salientes pendientes |
| Pub/Sub topic | `dulabs-inbound` | Eventos entrantes pendientes de relay |
| Pub/Sub topic | `dulabs-outbound-dlq` / `dulabs-inbound-dlq` | Dead-letter de cada flujo |
| Pub/Sub subscription | `dulabs-outbound-worker`, `dulabs-inbound-worker` | Push OIDC hacia cada Worker |
| Pub/Sub subscription | `dulabs-outbound-dlq-inspect`, `dulabs-inbound-dlq-inspect` | Inspección manual de DLQ |
| KMS keyring | `dulabs-developer-keyring` | Contenedor de la clave maestra |
| KMS key | `dulabs-developer-master-key` | Root of trust — envelope encryption, rotación automática cada 90 días |
| Secret Manager | `supabase-url`, `supabase-service-role-key`, `meta-app-secret`, `meta-webhook-verify-token` | Secretos operativos/infra (no secretos por-tenant) |
| Cloud Scheduler job | `dulabs-reconciliation-trigger` (`*/5 * * * *`, OAuth) | Dispara el Job cada 5 min |
| Budget alert | `dulabs-developer-v1-budget-alert` | COP 80.000 (≈USD 20), umbrales 50/80/100%, sin hard cap |
| Service Accounts | 6 nuevas (ver sección C) | Identidades dedicadas por servicio |

---

## C. Service Accounts e IAM final

| SA | Uso | IAM real verificado |
|---|---|---|
| `dulabs-gateway@` | Runtime Gateway | `run.invoker` propio otorgado a `allUsers` (público); `secretAccessor` en los 4 secrets; `cloudkms.cryptoKeyEncrypterDecrypter` en la key |
| `dulabs-worker-outbound@` | Runtime Worker outbound | `secretAccessor` en `supabase-url`/`supabase-service-role-key`; `cloudkms.cryptoKeyEncrypterDecrypter` en la key |
| `dulabs-worker-inbound@` | Runtime Worker inbound | `secretAccessor` en `supabase-url`/`supabase-service-role-key`; **`cloudkms.cryptoKeyEncrypterDecrypter` en la key (otorgado en el cierre — riesgo #1, resuelto)** |
| `dulabs-reconciliation@` | Runtime Job | `secretAccessor` en `supabase-url`/`supabase-service-role-key`; `cloudkms.cryptoKeyEncrypterDecrypter` en la key; `pubsub.publisher` en `dulabs-inbound` y **`dulabs-outbound` (otorgado en el cierre — riesgo #2, resuelto)** |
| `dulabs-pubsub-invoker@` | Identidad de push OIDC | `run.invoker` en `dulabs-outbound-worker` y `dulabs-inbound-worker` únicamente |
| `dulabs-scheduler-invoker@` | Identidad OAuth de Scheduler | `run.invoker` en el Job `dulabs-reconciliation` únicamente |
| `dulabs-worker@` | Reservada, sin uso | Sin ningún binding de IAM — confirmado vacío, usada como identidad segura para recursos de prueba temporales |
| `dulabs-developer-deploy@` | CI/deploy | Roles de administración a nivel de proyecto (preexistente de la auditoría) |
| Default compute SA | — | No usada por ningún servicio |
| Pub/Sub service agent | Interno de Google | `publisher` en ambos topics DLQ; `subscriber` en ambas subscriptions de origen |

---

## D. Cloud Run — Gateway, Workers, Job

| Servicio | SA | Ingress | Revisión actual (incluye todos los fixes de cierre) |
|---|---|---|---|
| `dulabs-gateway` | `dulabs-gateway@` | público | `dulabs-gateway-00002-cs5` — usage_ledger activado |
| `dulabs-outbound-worker` | `dulabs-worker-outbound@` | privado | sin cambios desde la implementación inicial |
| `dulabs-inbound-worker` | `dulabs-worker-inbound@` | privado | `dulabs-inbound-worker-00004-jsw` — KMS + reorden de CAS |
| `dulabs-reconciliation` (Job) | `dulabs-reconciliation@` | — | imagen `cierre-fase3-riesgo34` — retry_pending + transición Meta-confirmó-envío |

Min-instances=0 en los 3 servicios (confirmado con cold starts reales observados). Ningún servicio usa `--max-instances=0` como rollback.

---

## E. Pub/Sub — topics, subscriptions, push/OIDC, retry/DLQ

| Subscription | Topic | DLQ | maxDeliveryAttempts | Retry backoff | ackDeadline |
|---|---|---|---|---|---|
| `dulabs-outbound-worker` | `dulabs-outbound` | `dulabs-outbound-dlq` | 5 | 10s–300s | 30s |
| `dulabs-inbound-worker` | `dulabs-inbound` | `dulabs-inbound-dlq` | 5 | 10s–300s | 20s |

`maxDeliveryAttempts=5` verificado como best-effort (probado con evidencia real, no exacto por garantía de Pub/Sub). DLQ probado de extremo a extremo con recurso aislado y temporal (ver sección I, categoría 4).

---

## F. KMS + envelope encryption

Key `dulabs-developer-master-key` (`GOOGLE_SYMMETRIC_ENCRYPTION`, rotación cada 90 días). Envelope real: DEK aleatorio por operación, envuelto/desenvuelto por KMS; formato `dev2:<dekWrapped>:<iv>:<authTag>:<ciphertext>`. Fallback Fase 1 (`dev1:`) sigue siendo legible (dispatch por prefijo del valor). Fail-closed verificado.

**Las 3 identidades con `cryptoKeyEncrypterDecrypter`** son ahora Gateway, Worker outbound, Worker inbound y Reconciliation (4 en total, tras el cierre del riesgo #1). Verificado en vivo: roundtrip real contra la key desplegada, detección de tamper (auth-tag GCM), y — específicamente para el Worker inbound — un secreto `dev2:` real descifrado correctamente y una firma HMAC generada y verificada de forma independiente contra un receptor de prueba aislado.

---

## G. Secret Manager — clasificación de secretos

| Secreto | Clasificación | Quién lo lee |
|---|---|---|
| `supabase-url` | Infraestructura/operacional | Gateway, ambos Workers, Reconciliation |
| `supabase-service-role-key` | Infraestructura/operacional | Gateway, ambos Workers, Reconciliation |
| `meta-app-secret` | Infraestructura/operacional (app-level de Meta) | Solo Gateway |
| `meta-webhook-verify-token` | Infraestructura/operacional | Solo Gateway |

Secretos **por-tenant** (token de Meta del cliente, secreto HMAC del webhook del cliente) permanecen fuera de Secret Manager, cifrados con KMS+DB — separación respetada.

**Sin valores expuestos en este documento**, por instrucción explícita.

---

## H. Cloud Scheduler

Job `dulabs-reconciliation-trigger`, `*/5 * * * *` (`Etc/UTC`), `ENABLED`. Target: Cloud Run Jobs API v2 (`:run`), auth OAuth (`dulabs-scheduler-invoker@`, scope `cloud-platform`). Verificado con ejecuciones reales, incluidas automáticas no disparadas manualmente.

---

## I. Las 10 categorías obligatorias de prueba — resultado final

| # | Categoría | Resultado | Evidencia |
|---|---|---|---|
| 1 | KMS envelope encryption (roundtrip + tamper) | PASS | Real contra la key desplegada, ambas direcciones (Worker outbound original, Worker inbound tras el cierre del riesgo #1) |
| 2 | event_id determinista (sent/delivered/read) | PASS | 3 event_id distintos para el mismo wamid, real contra Postgres |
| 3 | Dedupe inbound (mismo webhook 2 veces) | PASS | UNIQUE(event_id) real, 1 solo evento lógico |
| 4 | DLQ real (5xx → redelivery → dead-letter) | PASS | Servicio temporal aislado, 5 entregas reales, mensaje real en DLQ, cero impacto productivo |
| 5 | Cero duplicados físicos / cero doble cobro (outbound) | PASS | Redelivery real concurrente, 1 solo POST físico, 1 sola fila de ledger |
| 6 | Idempotencia inbound (redelivery real) | PASS | Duplicado real vía Pub/Sub, CAS correcto, incluye la corrección del reorden (riesgo #1) |
| 7 | Reconciliación outbound (nunca reenvía físicamente) | PASS | Única transición permitida verificada en código y test real |
| 8 | Recuperación inbound (evento atascado → recovery real) | PASS | Sweep automático real detectó y recuperó un evento sembrado |
| 9 | Scheduler → Cloud Run Jobs v2 real, cada 5 min | PASS | Ejecuciones reales, incluida al menos una automática |
| 10 | Suite completa Developer V1 contra Postgres real | PASS | **147/147**, ejecutada múltiples veces a lo largo del cierre, sin regresiones |

---

## J. Resultado final de la suite

**147/147 PASS, 0 fallas**, 21 suites, contra Postgres real. Composición: 104 de Fase 2 + ~30 de la implementación inicial de Fase 3 + 1 regresión (riesgo #1) + 2 unitarios + 4 E2E (riesgos #2/#3) + 5 E2E (usage_ledger, riesgo #6). Sin mocks en ningún test de integración.

---

## K. Aislamiento y cleanup de pruebas temporales

Todas las pruebas en infraestructura viva (DLQ, recuperación inbound, KMS del Worker inbound, smoke test del usage_ledger) usaron recursos/datos claramente etiquetados como TEST, aislados de tráfico productivo real, y fueron eliminados y verificados en 0 tras cada prueba. Ningún dato ni tráfico de un desarrollador real fue tocado en ningún momento de la Fase 3.

---

## L. Riesgos — numeración única y consolidada

| # | Riesgo | Estado |
|---|---|---|
| **1** | Worker inbound sin permiso KMS para descifrar secretos `dev2:` de webhook, y CAS de idempotencia mal ordenado (marcaba "procesado" antes del relay real) | **RESUELTO** — IAM otorgada (solo esa key), `KMS_KEY_NAME` configurado, CAS reordenado, probado en vivo con la identidad real antes/después del otorgamiento |
| **2** | Jobs en `retry_pending` sin ningún mecanismo real que los republicara — quedaban atascados para siempre | **RESUELTO** — barrido nuevo en `dulabs-reconciliation`, reusa el Worker outbound real sin duplicar lógica, IAM otorgada, probado en vivo |
| **3** | Reconciliación nunca transicionaba el job cuando Meta confirmaba que SÍ se había enviado — quedaba sin mutar para siempre | **RESUELTO** — nueva transición `reconciliacion_confirmo_enviado` en la máquina de estados de Fase 1, probado con Postgres real |
| **4** | `consultarEstadoEnMeta` (usado por la reconciliación outbound) **no usa un endpoint real de Meta** — la API Cloud de WhatsApp no ofrece ningún mecanismo para consultar activamente el estado de un mensaje ya enviado; el único mecanismo real es el webhook asíncrono de status, correlacionado por `wamid` | **DETERMINADO, NO RESUELTO — BLOQUEANTE para automatización real.** Consecuencia directa: **`reconciliation_pending` no tiene ninguna confirmación activa automática en V1** — cada ejecución del Job intenta un endpoint que no existe y siempre cae en `"sin_certeza_todavia"` (inofensivo, nunca muta incorrectamente, pero nunca resuelve nada por sí solo). La corrección del riesgo #3 es código correcto y ya probado, pero hoy nunca se dispara en producción real porque la señal que la activaría no existe. Tratar `reconciliation_pending` como cola operativa/manual hasta que el equipo decida un mecanismo real — decisión de producto, no de código. **No se modificó `consultarEstadoEnMeta` en este cierre, por instrucción explícita.** |
| **5** | `meta-app-secret` expuesto accidentalmente en texto plano (historial local de PowerShell + esta conversación) durante la implementación, por un uso incorrecto de `Read-Host -AsSecureString` | **PENDIENTE — acción del usuario.** El valor ya está correctamente en Secret Manager, pero el secreto original en el panel de Meta no ha sido rotado. Recomendación sin cambios: rotar en Meta (App Settings → Basic → App Secret → Reset), luego actualizar Secret Manager y Vercel. |
| **6** | `reservarUso()` (usage_ledger, Fase 2) existía pero nunca se invocaba desde código de producción — ni el Gateway ni el Worker outbound. El usage_ledger real nunca se creaba para ningún job real | **RESUELTO** — activado en `crearJobConIdempotencia`, único punto donde el `job_id` ya está atómicamente decidido; probado con 5 tests nuevos (incluida concurrencia real de 5 requests) y un smoke test contra la infraestructura desplegada |

**Pendiente operativo (no es un riesgo de diseño, es una tarea sin ejecutar):** el índice parcial `dulabs_dev_jobs_retry_pending_idx` (migración `20261010000000_dulabs_developer_v1_fase3_retry_pending_idx.sql`) fue escrito, verificado como seguro (`CREATE INDEX IF NOT EXISTS`, aditivo, no destructivo) y **entregado, pero no aplicado** — Claude no tiene ejecución de DDL directa contra Postgres/Supabase en este entorno. El riesgo #2 funciona correctamente sin él (solo es una optimización de consulta a escala). **Queda como pendiente hasta que el usuario lo aplique.**

---

## M. Clasificación explícita — qué está en cada categoría

**Implementado:**
Gateway, 2 Workers, Job de reconciliación (3 responsabilidades: reconciliación outbound, recovery inbound, reintento retry_pending), Pub/Sub push+OIDC+DLQ, KMS envelope encryption (4 identidades con acceso), Secret Manager, Cloud Scheduler v2+OAuth, Budget alert, usage_ledger real activado, máquina de estados de Fase 1 extendida con la transición de reconciliación confirmada.

**Probado (evidencia real, no declarativa):**
Las 10 categorías obligatorias (sección I), 147/147 tests contra Postgres real, 3 pruebas dedicadas en infraestructura viva (DLQ aislado, recuperación inbound, KMS del Worker inbound), 1 smoke test real del usage_ledger contra el Gateway desplegado.

**Pendiente:**
- Aplicar la migración `retry_pending_idx` (usuario).
- Rotar `meta-app-secret` en Meta (usuario).

**Bloqueante (para uso real con un desarrollador, no para el cierre de infraestructura):**
- Riesgo #4 — sin mecanismo real de Meta, `reconciliation_pending` nunca se resuelve automáticamente. No bloquea el cierre técnico de Fase 3 (la infraestructura y el código son correctos y honestos sobre esta limitación), pero sí debe resolverse — o aceptarse explícitamente como proceso manual — antes de depender de la reconciliación automática en un incidente real.

**Decisiones para fases futuras (ninguna implementada en este cierre):**
- Mecanismo real para resolver `reconciliation_pending` (riesgo #4) — posiblemente correlacionar por `wamid` vía el pipeline inbound existente, o tratarlo como cola manual/soporte.
- KMS key separada para secretos de webhook vs. tokens de Meta (endurecimiento de blast-radius, no urgente — ver análisis del riesgo #1 original).
- Fase 4: Embedded Signup real, Management API consumido desde un frontend real, cualquier UI.

---

## N. Confirmación — sin defectos funcionales conocidos adicionales

Todo defecto funcional real encontrado durante la Fase 3 (los 6 riesgos de la sección L) fue resuelto con código real y evidencia real, excepto el riesgo #4 (determinado como no resoluble con código — ausencia real de un endpoint de Meta) y el riesgo #5 (acción externa, no de código). No hay ningún otro defecto conocido sin reportar en este documento.

---

## Estado final

**FASE 3 — READY FOR FINAL REVIEW.**

No FROZEN. Pendiente de tu revisión final. Cuando confirmes, procedo a marcar `🔒 FASE 3 — FROZEN` y quedamos listos para iniciar Fase 4.
