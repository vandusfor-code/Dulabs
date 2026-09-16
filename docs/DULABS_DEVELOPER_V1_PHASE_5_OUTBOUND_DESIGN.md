# DuLabs Developer V1 — Fase 5: Outbound WhatsApp — Auditoría + Diseño

**Estado: DISEÑO — NO IMPLEMENTADO.** Auditoría exhaustiva del código real (Fases 1–4, todas FROZEN/CERRADA) y diseño de Fase 5 sobre esa realidad. Cero cambios de código, tests, infraestructura o migraciones en este documento.

---

## 1. Objetivo

Cerrar el flujo outbound de extremo a extremo para que un envío real de WhatsApp vía `POST /api/v1/messages` llegue de verdad a Meta con el contrato correcto, sea observable, y mantenga —sin excepción— las garantías ya construidas en Fases 1–3: cero duplicados físicos, cero doble cobro, nunca blind resend ante incertidumbre.

## 2. Alcance

Solo outbound (Developer → Meta). No se toca: inbound, Developer API pública (Fase 4, FROZEN), billing comercial, dashboard, Embedded Signup, Developer Portal.

---

## 3. Arquitectura actual (verificada en código real)

```
Developer ──POST /api/v1/messages──▶ services/gateway/outbound-handler.ts::manejarMensajeSaliente
                                        │ conWorkspaceAutenticadoPorApiKey (services/gateway/api-auth.ts)
                                        │ validarIdempotencyKey / validarCuerpoMensajeSaliente (validation.ts)
                                        │ obtenerNumeroDelWorkspace (ownership, whatsapp-numbers-store.ts)
                                        │ verificarLimiteTasa x2 (lib/rate-limit.ts -- devOutboundPorNumero + devOutboundPorWorkspace)
                                        │ crearJobConIdempotencia (lib/developer/jobs-store.ts)
                                        │   ├─ reclamarIdempotencia (lib/developer/idempotency.ts)
                                        │   ├─ INSERT dulabs_dev_jobs (status=created, physical_outcome=pre_send)
                                        │   └─ reservarUso (lib/developer/usage-ledger.ts)
                                        └─publish──▶ publicarMensaje(dulabs-outbound, {workspaceId,jobId,requestId})
                                                        (services/shared/pubsub.ts)

Pub/Sub dulabs-outbound ──push+OIDC──▶ services/worker-outbound/server.ts ──▶ handler.ts::procesarMensajeOutbound
                                          │ adquirirLease (CAS, lib/developer/jobs-store.ts)
                                          │ aplicarEventoJob(encolar) / aplicarEventoJob(iniciar_envio)
                                          │ obtenerTokenMetaDelNumero (KMS-decrypt, whatsapp-numbers-store.ts)
                                          │ fetch POST https://graph.facebook.com/v21.0/{whatsapp_number_id}/messages
                                          │   body = job.payload SIN TRANSFORMAR (ver hallazgo F1, sección 6)
                                          │ aplicarEventoJob(meta_confirmo_exito | meta_rechazo | incertidumbre_de_red)
                                          │ confirmarUso / liberarUso
                                          └─ liberarLease

Cloud Scheduler (5 min) ──▶ dulabs-reconciliation (services/reconciliation/run.ts::ejecutarReconciliacion)
                              ├─ reconciliarOutbound: reconciliation_pending -> consultarEstadoEnMeta (endpoint FICTICIO, ver riesgo heredado R1) -> reconciliacion_confirmo_no_enviado | reconciliacion_confirmo_enviado
                              ├─ recuperarInbound: no relacionado a outbound
                              └─ reintentarOutbound: retry_pending -> republica {workspaceId,jobId} a dulabs-outbound (Fase 3 cierre, riesgo #2)
```

---

## 4. Flujo real reconstruido paso a paso (con archivos/funciones exactos)

| # | Paso | Archivo::función | Nota real |
|---|---|---|---|
| 1 | HTTP entra, se genera `request_id` | `services/gateway/server.ts` | `generarRequestId()`, header `X-Request-Id` en toda respuesta |
| 2 | Auth por API key | `services/gateway/api-auth.ts::conWorkspaceAutenticadoPorApiKey` | hash SHA-256 + `timingSafeEqual`, `devAuthFallida` (20/60s/IP) antes de autenticar |
| 3 | Validación de `Idempotency-Key` | `services/gateway/validation.ts::validarIdempotencyKey` | máx. 255 chars, rechaza vacío/control |
| 4 | Validación de body | `validation.ts::validarCuerpoMensajeSaliente` | solo `type:"text"` soportado; produce `{whatsappNumberId, to, type, text}` |
| 5 | Ownership | `lib/developer/whatsapp-numbers-store.ts::obtenerNumeroDelWorkspace` | filtro `(id, workspace_id)` en una sola query (fix de Fase 4) |
| 6 | Rate limit (2 checks) | `lib/rate-limit.ts::verificarLimiteTasa` | `devOutboundPorNumero` (2/1s) + `devOutboundPorWorkspace` (1200/60s), AMBOS antes de tocar `jobs`/`usage_ledger` |
| 7 | Idempotencia + creación de Job + reserva de usage | `lib/developer/jobs-store.ts::crearJobConIdempotencia` | atómico, UNIQUE real de Postgres, `reservarUso` en el mismo punto (Fase 3 cierre) |
| 8 | Publish a Pub/Sub | `services/shared/pubsub.ts::publicarMensaje` | topic `dulabs-outbound`, body `{workspaceId, jobId, requestId}` |
| 9 | Response al developer | `outbound-handler.ts` | `201 {jobId,status:"created"}` / `200 {jobId,status:"duplicado_identico"}` / `409` / `429` / `400` |
| 10 | Push real de Pub/Sub | `services/worker-outbound/server.ts` | OIDC, `dulabs-pubsub-invoker@`, decodifica `message.data` base64 |
| 11 | Lease CAS | `jobs-store.ts::adquirirLease` | `UPDATE ... WHERE lease_id IS NULL OR locked_at < ahora-60s` |
| 12 | Chequeo de estado ya resuelto | `worker-outbound/handler.ts` | `success_confirmed`/`failed_by_meta`/`reconciliation_pending` → ACK sin tocar Meta |
| 13 | `encolar` (si `created`) | `aplicarEventoJob` | → `queued` |
| 14 | `iniciar_envio` | `aplicarEventoJob` | → `sending`, `networkAttempts+1`, bloqueado si ya `>= MAX_INTENTOS_FISICOS (2)` |
| 15 | Token de Meta | `whatsapp-numbers-store.ts::obtenerTokenMetaDelNumero` | KMS real (`descifrarSecretoDev`), filtrado por `(id, workspace_id)` |
| 16 | POST físico real | `worker-outbound/handler.ts` línea 102-107 | `https://graph.facebook.com/v21.0/{whatsapp_number_id}/messages`, timeout 15s, body = `job.payload` **sin transformar** |
| 17 | Resultado | `worker-outbound/handler.ts` | ver máquina de estados, sección 9 |
| 18 | Reconciliación (async, 5 min) | `reconciliation/run.ts` | ver sección 3 |

---

## 5. Componentes reutilizados (NO se tocan, NO se reimplementan)

Idempotencia (Fase 1), lease/CAS + máquina de estados (Fase 1/2), KMS envelope encryption (Fase 3), usage ledger (Fase 2, activado Fase 3), rate limiting genérico Postgres (Fase 11 Business, extendido Fase 4), ownership multi-tenant (Fase 4), Pub/Sub push+OIDC+DLQ (Fase 3), Cloud Scheduler → Reconciliation Job (Fase 3), reintento de `retry_pending` (Fase 3 cierre), transición `reconciliacion_confirmo_enviado` (Fase 3 cierre). Todo esto es **A. YA IMPLEMENTADO Y VALIDADO** — ver clasificación completa en sección 7.

---

## 6. Gaps encontrados (hallazgos nuevos de esta auditoría)

### F1 — CRÍTICO: el payload enviado a Meta no tiene el shape real que Meta exige

`worker-outbound/handler.ts` línea 105 envía `JSON.stringify(iniciar.job.payload)` **sin ninguna transformación**. `job.payload` es exactamente lo que `validarCuerpoMensajeSaliente` produjo: `{whatsappNumberId, to, type:"text", text:{body}}`.

La API real de WhatsApp Cloud (confirmado contra la integración YA EXISTENTE y funcionando de Business, `lib/whatsapp-outbound.ts` líneas 179-190) **requiere** `messaging_product: "whatsapp"` en el body — campo que Developer V1 **nunca envía**. Además envía `whatsappNumberId`, un campo interno que Meta no espera (Meta normalmente ignora campos desconocidos, así que esto por sí solo no rompe la llamada, pero confirma que nunca hubo una capa de mapeo request-público → request-Meta).

**Consecuencia real**: con la más alta probabilidad, un envío real hoy sería rechazado por Meta con un error de validación (`messaging_product` faltante) — nunca se ha probado contra la Meta Graph API real en todo este proyecto (todos los tests usan `fetchImpl` fixtures; los smoke tests reales de Fase 3/4 usaron números sin token real de Meta, así que nunca llegaron al POST real). **Esto bloquea el objetivo completo de Fase 5** si no se corrige.

### F2 — El `wamid` de Meta nunca se captura ni se persiste

En `meta_confirmo_exito` (`respuestaMeta.ok`), el código nunca lee `respuestaMeta.json()`. El `messages[0].id` (wamid) que Meta devuelve se descarta. `dulabs_dev_jobs` no tiene columna para guardarlo. Sin esto: imposible correlacionar un job interno con eventos de status reales de Meta (sent/delivered/read/failed vía webhook), e imposible dar soporte a un desarrollador que reporta "mi mensaje X no llegó" con evidencia real de qué pasó del lado de Meta.

### F3 — NUEVO, encontrado en esta auditoría: inconsistencia real en el usage_ledger cuando un rechazo 4xx todavía tiene reintentos disponibles

`worker-outbound/handler.ts` línea 129-131:
```ts
await aplicarEventoJob(..., { tipo: "meta_rechazo", codigoError: String(respuestaMeta.status) });
await liberarUso(supabase, { workspaceId, jobId }).catch(() => {});
```
`liberarUso` se llama **incondicionalmente**, sin importar si la transición resultante es `failed_by_meta` (terminal, correcto liberar) o `retry_pending` (todavía puede reintentarse). Si el job después se reintenta (vía `reintentarOutbound`, Fase 3 cierre) y ese segundo intento **sí** tiene éxito, `confirmarUso` intenta transicionar desde `estado='reservado'` — pero la fila ya está en `liberado` (CAS falla silenciosamente, `confirmado:false`, sin error). **Resultado real: un job que se envió exitosamente en el segundo intento queda registrado para siempre como `liberado` en el ledger, nunca como `confirmado`** — viola directamente la propiedad pedida en la sección 8 de esta directiva ("un envío físico exitoso = una confirmación de usage"). Ningún test existente cubre este escenario (el test actual de `meta_rechazo` solo verifica el primer rechazo aislado, nunca el ciclo completo rechazo→reintento→éxito).

### F4 — Meta trata errores retryables (rate limit) y permanentes de forma indistinguible

Investigado contra la documentación real de Meta (ver sección 12): errores como `130429` (rate limit) deberían reintentarse con backoff; errores como `131026` (número inválido) nunca deberían reintentarse. El código actual solo mira el status HTTP (`>=400 && <500`) y trata TODOS los 4xx igual (`meta_rechazo` → consume un intento físico de los 2 disponibles). Un rate-limit real de Meta gastaría uno de los únicos 2 intentos físicos permitidos sin necesidad.

### F5 — `next_attempt_at` existe en el esquema pero nunca se usa

Columna + índice (`dulabs_dev_jobs_retry_idx`, Fase 2) sin ningún código que los escriba o los lea. El barrido `reintentarOutbound` republica TODOS los `retry_pending` en cada corrida de 5 minutos, sin ningún backoff diferenciado por job.

### F6 — Comentario desactualizado en `worker-outbound/handler.ts`

El comentario de cabecera (líneas 12-21) todavía describe el "GAP DE DISEÑO... el re-encolado real como un mecanismo pendiente de decisión explícita" — esto **ya se resolvió** en el cierre de Fase 3 (`reintentarOutbound`, riesgo #2). Deuda de documentación, no de código — el código funciona correctamente, el comentario está obsoleto.

### R1 — Heredado de Fase 3, sin resolver, confirmado que sigue igual

`consultarEstadoEnMeta` (`reconciliation/run.ts`) apunta a `GET /{phone_number_id}/message_status?job_id=...` — **no existe** en la API real de Meta (ya determinado en el cierre de Fase 3). En producción real, esta llamada siempre falla/404, así que `reconciliarOutbound` siempre resuelve `sin_certeza_todavia` — **ningún job en `reconciliation_pending` se resuelve automáticamente hoy**. Confirmado que sigue exactamente igual, no se tocó ni se debía tocar.

### R2 — Migración `retry_pending_idx` (Fase 3, cierre) — estado sin confirmar en esta auditoría

`obtenerJobsListosParaReintento` referencia el índice `dulabs_dev_jobs_retry_pending_idx` (migración `20261010000000...`). En el último estado conocido de la sesión, esta migración seguía sin aplicarse por el usuario. El código funciona igual sin ella (solo es una optimización de consulta) — no se re-verificó contra la base de datos real en esta auditoría (auditoría centrada en código, sin tocar infraestructura). **Confirmar su estado real antes de Fase 5.**

---

## 7. Clasificación por componente

| Componente | Clasificación | Evidencia |
|---|---|---|
| Idempotencia (`Idempotency-Key`) | **A** | Fase 1/3, probado con concurrencia real |
| Lease/CAS/`version_token` | **A** | Fase 2/3, probado con Worker A/B concurrentes reales |
| Máquina de estados pura | **A** | `outbound-state-machine.test.ts`, unit tests exhaustivos |
| Cero duplicados físicos / cero doble POST | **A** | `worker-outbound/handler.e2e.test.ts`, test de concurrencia real |
| `retry_pending` → republicación | **A** | Fase 3 cierre, riesgo #2, tests reales + verificado en infra viva |
| `reconciliacion_confirmo_enviado` | **A** | Fase 3 cierre, riesgo #3, tests reales |
| KMS envelope encryption del token de Meta | **A** | Fase 3, roundtrip real verificado contra la key desplegada |
| Ownership de `whatsappNumberId` (Gateway) | **A** | Fase 4, fix de seguridad + test real |
| Rate limiting (número + workspace) | **A** | Fase 4, verificado en infraestructura real |
| Reserva de usage activada | **A** | Fase 3 cierre, hallazgo del usage_ledger, tests reales incl. concurrencia |
| Payload real enviado a Meta (`messaging_product`, shape) | **D / E** | F1 — falta implementar, riesgo crítico de producción |
| Captura/persistencia de `wamid` | **D** | F2 — falta implementar |
| Liberación de usage en `meta_rechazo` con reintentos disponibles | **C / E** | F3 — implementado pero demostrablemente incorrecto en un escenario real |
| Diferenciación de errores retryables vs. permanentes de Meta | **D** | F4 — falta implementar |
| Backoff real entre reintentos (`next_attempt_at`) | **D** | F5 — columna existe, sin uso |
| Reconciliación activa contra Meta (`consultarEstadoEnMeta`) | **C** | R1 — implementado pero contra un endpoint que no existe, nunca resuelve nada en producción real |
| `dulabs_dev_jobs_retry_pending_idx` aplicada | **C (a confirmar)** | R2 |

---

## 8. Contrato Meta — documentado del código real, sin inventar nada nuevo

| Aspecto | Valor real en código |
|---|---|
| Base URL | `https://graph.facebook.com` (`META_GRAPH_API_BASE_URL`, `worker-outbound/index.ts`), forzado a `https://` en producción |
| Versión | `v21.0` (hardcoded fallback en `handler.ts`, overrideable por `metaApiVersion`) |
| Endpoint | `POST /{whatsapp_number_id}/messages` — usa el **id interno** de `dulabs_dev_whatsapp_numbers`, que es también el `phone_number_id` real de Meta (mismo valor, ver `registrarNumero`) |
| Auth | `Authorization: Bearer <token descifrado vía KMS>` |
| Timeout | 15000ms (`AbortSignal.timeout(15_000)`) |
| Body actual (INCORRECTO, ver F1) | `{whatsappNumberId, to, type:"text", text:{body}}` |
| Body real que Meta requiere | `{messaging_product:"whatsapp", to, type:"text", text:{body}}` (confirmado contra `lib/whatsapp-outbound.ts`, integración Business ya funcionando) |
| `wamid` | Nunca leído (F2) |
| Códigos HTTP manejados | `2xx` → éxito; `400-499` → rechazo cierto; `5xx` → incertidumbre; excepción de fetch (timeout/reset) → incertidumbre |
| Distinción de error Meta por código (`error.code`) | **No implementada** (F4) |
| Rate limits de Meta | No manejados de forma diferenciada — un 429/130429 real de Meta hoy se trataría como rechazo cierto |

---

## 9. Máquina de estados — auditoría exhaustiva de escenarios

Basado en `lib/developer/outbound-state-machine.ts` (pura, sin cambios desde Fase 1) + `jobs-store.ts` (persistencia + CAS).

| Escenario | ¿Puede ocurrir? | Transición real | ¿Puede duplicar el WhatsApp? |
|---|---|---|---|
| Meta confirma 2xx | Sí | `sending → success_confirmed` | No — termina, ledger confirmado |
| Meta responde 4xx | Sí | `sending → retry_pending` (si quedan intentos) o `failed_by_meta` | No físicamente, pero ver F3 (ledger inconsistente) |
| Timeout/conexión cortada ANTES de que Meta procese | Sí | `sending → reconciliation_pending` (`uncertain`) | No — nunca blind resend |
| Timeout DESPUÉS de que Meta ya aceptó (Meta procesó pero la respuesta se perdió) | Sí, indistinguible del caso anterior a nivel de código | Igual: `reconciliation_pending` | **No puede duplicar por diseño** — el único camino de vuelta a `sending` exige `reconciliacion_confirmo_no_enviado`, que requiere que Meta confirme explícitamente que NO llegó (hoy imposible de verificar realmente, ver R1 — el job queda atascado, pero nunca se reenvía a ciegas) |
| Worker muere a mitad del POST | Sí | Lease expira a los 60s (`LEASE_DURACION_MS`); otro Worker hace takeover; si el job seguía en `sending` sin resolver, el nuevo Worker lo encuentra en `sending`... **ver gap abajo** | Ver nota crítica |
| Pub/Sub redelivera el mismo mensaje | Sí (at-least-once) | `adquirirLease` con CAS — si el lease sigue vivo, `lease_no_adquirido:ya_tomado`, ACK sin tocar Meta | No |
| Dos Workers procesan el mismo Job concurrentemente | Sí (redelivery real) | Solo uno adquiere el lease; probado con concurrencia real (`Worker A / Worker B`) | No — probado |
| Lease expira mientras el Worker sigue vivo pero lento (>60s) | Sí, posible | Otro Worker puede adquirir el lease y re-procesar mientras el primero SIGUE en medio de su propio `fetch` a Meta | **Ver nota crítica** |

**Nota crítica (encontrada en esta auditoría, categoría E)**: si un Worker A adquiere el lease, pasa a `sending`, y su llamada a Meta tarda más de 60s (el timeout de la llamada es 15s, pero el lease podría vencer por otras razones: proceso lento, GC pause, etc.) antes de que A alcance a procesar la respuesta y liberar el lease, un Worker B podría adquirir el lease (vencido) mientras A **todavía tiene una request HTTP en vuelo hacia Meta**. B vería el job en `sending` — pero `iniciar_envio` exige `status IN (queued, retry_pending)`, **no `sending`** — así que B no podría re-iniciar el envío mientras el job siga en `sending` (la máquina de estados lo bloquea correctamente). El riesgo real no es un segundo POST, sino que **ambos Workers intenten mutar el estado cuando A finalmente responde** — pero `aplicarEventoJob` exige `lease_id = el que trae el caller`, y B ya tiene un lease_id distinto — la mutación de A fallaría con `sin_ownership` en cuanto B haya tomado el lease. Esto significa: **si A pierde la carrera del lease mientras su POST físico ya se envió a Meta, el resultado real de ese envío nunca se registra** (A no puede persistir `meta_confirmo_exito` porque perdió el lease) — el job queda "huérfano" en el estado en que B lo dejó (probablemente también `sending`, o lo que B haga después). Es un escenario de baja probabilidad (requiere una ventana de exactamente 60s+ de lentitud) pero **no está cubierto por ningún test actual** y merece una decisión explícita (ver D7).

---

## 10. Regla absoluta contra duplicados — auditoría de la propiedad exacta

Verificado línea por línea en `outbound-state-machine.ts` + `worker-outbound/handler.ts`:

```
pre_send    → puede intentar Meta                         ✅ (vía iniciar_envio, gated por MAX_INTENTOS_FISICOS)
uncertain   → NUNCA puede hacer blind resend               ✅ (incertidumbre_de_red SOLO permite sending→reconciliation_pending;
                                                                ninguna transición vuelve a sending sin pasar por reconciliación)
uncertain   → reconciliation_pending                        ✅ (única transición posible desde sending ante timeout/5xx)
success_confirmed → NO volver a enviar                       ✅ (ESTADOS_TERMINALES_O_EN_RECONCILIACION en el Worker; iniciar_envio
                                                                 exige queued/retry_pending, nunca success_confirmed)
```

**Prueba real existente**: `worker-outbound/handler.e2e.test.ts`, "CERO DUPLICADOS FÍSICOS y CERO DOBLE COBRO bajo redelivery real" — Worker A adquiere lease + hace el POST real; Worker B (segunda entrega real, lease ya tomado) → HTTP 200 sin segundo POST, una sola fila de ledger. **Clasificación: A, ya validado.**

---

## 11. Retries — auditoría exacta

| Pregunta | Respuesta real |
|---|---|
| ¿Quién hace retries? | Dos mecanismos DISTINTOS y no superpuestos (ver más abajo) |
| ¿Cuántos intentos físicos totales? | `MAX_INTENTOS_FISICOS = 2` (constante en `outbound-state-machine.ts`) |
| ¿Dónde se cuenta? | `network_attempts` en `dulabs_dev_jobs`, incrementado solo en `iniciar_envio` |
| ¿Quién republica a Pub/Sub? | `services/reconciliation/run.ts::reintentarOutbound` (Fase 3 cierre) — el Worker mismo **deliberadamente nunca se auto-publica** |
| ¿Cómo evita duplicación? | El mensaje republicado es idéntico a uno nuevo (`{workspaceId,jobId}`); el lease/CAS del Worker protege igual que cualquier entrega |
| ¿Interacción con reconciliation? | `reconciliarOutbound` (consulta a Meta, hoy siempre `sin_certeza`) y `reintentarOutbound` (republica `retry_pending`) corren en el MISMO `Promise.all`, son responsabilidades separadas |
| ¿Qué pasa con Pub/Sub redelivery? | Mecanismo COMPLETAMENTE SEPARADO — solo ocurre si el Worker devuelve `httpStatus:500` (únicamente el catch-all de error transitorio ANTES de tocar Meta); nunca se dispara por resultados relacionados con Meta (todos esos devuelven 200) |
| ¿Qué pasa con `retry_pending`? | Queda atascado indefinidamente HASTA que `reintentarOutbound` lo recoja en su siguiente corrida de 5 min (sin backoff, F5) |
| ¿Qué pasa tras el máximo de intentos? | `failed_by_meta`, terminal — ni el Worker ni la reconciliación vuelven a tocarlo |

**No existe ningún sistema de retry nuevo que diseñar desde cero** — el mecanismo YA existe y está correctamente separado en dos capas (transporte/Pub/Sub vs. aplicación/máquina de estados). Fase 5 solo necesita: (a) corregir F3 (usage_ledger), (b) decidir si vale la pena implementar backoff real (F5, D-pendiente), (c) decidir sobre diferenciación de errores retryables (F4, D-pendiente).

---

## 12. Limitaciones reales de Meta (sin inventar nada)

Confirmado en el cierre de Fase 3 y re-confirmado en esta auditoría: **no existe un endpoint real en la API Cloud de WhatsApp para consultar activamente "¿este mensaje que envié se procesó?"**. El único mecanismo real de status es el webhook asíncrono de status (`sent`/`delivered`/`read`/`failed`), correlacionado por `wamid` — que hoy Developer V1 ni siquiera captura (F2). `consultarEstadoEnMeta` sigue apuntando a un endpoint ficticio; **no se reimplementa acá, sigue como decisión abierta (D1)**.

Investigación adicional de esta auditoría (WebSearch, documentación real de Meta): los errores de Meta se distinguen por un `error.code` propio en el cuerpo de la respuesta, no solo por el status HTTP — ej. `130429` (rate limit del throughput de la Cloud API) es transitorio y debería reintentarse con backoff exponencial; `131026` (número de destino inválido) es permanente y nunca debería reintentarse. Developer V1 hoy no distingue ninguno de los dos (F4).

---

## 13. Seguridad — amenazas específicas de outbound

| Amenaza | Impacto | Control existente | Test existente | Gap |
|---|---|---|---|---|
| Cross-tenant: usar un `whatsappNumberId` de otro workspace | Job/ledger huérfano (nunca envío real, ver más abajo) | `obtenerNumeroDelWorkspace` en el Gateway (Fase 4) + `obtenerTokenMetaDelNumero` filtra por `workspace_id` en el Worker (defensa en profundidad real, dos capas) | `outbound-handler.e2e.test.ts` ("whatsappNumberId de OTRO workspace se rechaza") | Ninguno — doble capa confirmada |
| Robo del token de Meta ajeno | Envío real por cuenta ajena, costo/reputación | KMS envelope encryption, nunca en claro, `obtenerTokenMetaDelNumero` scoped por workspace | Fase 3, roundtrip KMS real | Ninguno nuevo |
| Abuso de API key (spam de envíos) | Costo, rate limiting de Meta contra el número compartido | `devOutboundPorNumero`/`devOutboundPorWorkspace` (Fase 4) | Concurrencia real probada | Ninguno nuevo |
| Replay de un mismo mensaje | Doble envío/doble cobro | Idempotencia + lease/CAS | Probado exhaustivamente | Ninguno |
| Race condition en concurrencia (2 Workers) | Doble POST físico | Lease/CAS | Probado | Ninguno |
| Robo de lease (lease theft) | Un Worker sin ownership real muta el job | `aplicarEventoJob` exige `lease_id` exacto + `version_token` CAS | Probado (`sin_ownership`) | Ninguno |
| Bypass de `version_token` | Estado inconsistente | UPDATE con `WHERE version_token = X`, `rowCount` verificado | Probado con concurrencia real | Ninguno |
| Manipulación directa del estado del job | Saltarse la máquina de estados | Toda mutación pasa por `transicionar()`, nunca un UPDATE directo de `status` | Unit tests exhaustivos | Ninguno |
| Payload de Pub/Sub falsificado | Un actor con acceso directo a Pub/Sub podría intentar procesar jobs ajenos | Push OIDC (`dulabs-pubsub-invoker@`, `run.invoker` exclusivo), el mensaje solo trae `{workspaceId,jobId}` — sin ese lease/CAS ya cubierto, no hay nada más que "falsificar" útilmente | Fase 3, IAM real verificado | Ninguno nuevo |
| Fuga de secretos en logs (token de Meta, `Authorization`) | Compromiso de credenciales | Nunca se loggea el token ni el header Authorization en ningún `console.*` de `services/worker-outbound/` | Confirmado por grep de logs reales (Fase 3/4) | Ninguno nuevo — **repetir el grep específicamente para el payload de Meta si Fase 5 llega a loggear más detalle de la respuesta (ej. al capturar el wamid, F2)** |
| Amplificación de costo vía reintentos | Cada intento físico cuesta (cuota de Meta) | `MAX_INTENTOS_FISICOS=2` acota el máximo real | — | F4: un rate-limit de Meta tratado como rechazo cierto gasta un intento innecesariamente |
| SSRF | No aplica a outbound — la URL de Meta es fija (`META_GRAPH_API_BASE_URL`), nunca viene del cliente | — | — | N/A |

---

## 14. Concurrencia — confirmado

| Escenario | ¿Duplicado físico posible? | ¿Doble usage posible? | Evidencia |
|---|---|---|---|
| 2 Workers, mismo Job | No | No | Test real, Worker A/B |
| Pub/Sub redelivery | No | No | Lease/CAS ya cubre esto |
| 2 requests, misma Idempotency-Key | No (1 solo Job) | No (`UNIQUE(job_id)`) | Test real, 5 concurrentes |
| 2 retries simultáneos (dos pasadas de `reintentarOutbound` antes de que el Worker procese la primera) | No | No | Test real (Fase 3 cierre, "republicar dos veces seguidas") |
| Lease expiration + Worker lento | **Job huérfano posible, ver sección 9 "nota crítica"** | Depende del caso — no probado | **Sin test, riesgo E real, D7** |
| Reconciliación simultánea con Worker (mismo job en `reconciliation_pending`, Worker también intenta tocarlo) | No — `reconciliarOutbound` también usa `adquirirLease` | No | Mismo mecanismo de lease, compartido |
| Reserva de usage simultánea | No | No (`UNIQUE(job_id)`) | Test real, Fase 3 cierre |

---

## 15. Observabilidad — qué sabemos hoy, qué falta

| Dato | ¿Disponible hoy? | Dónde |
|---|---|---|
| `job_id` | Sí | Respuesta HTTP, `dulabs_dev_jobs` |
| `request_id` | Sí (en la respuesta HTTP y en el payload de Pub/Sub) | No aparece en logs de Cloud Run para requests exitosas (confirmado en Fase 4) |
| `workspace_id` | Sí | Todas las tablas |
| `whatsapp_number_id` | Sí | `dulabs_dev_jobs` |
| `status` público | Sí | `GET /api/v1/messages/:id` (Fase 4) |
| `network_attempts` | Sí, en DB, pero **nunca expuesto públicamente** (decisión correcta de Fase 4 — no es información pública) | `dulabs_dev_jobs` |
| `wamid` | **No** — F2 | — |
| Timestamp de cada transición | Solo `updated_at` (se sobreescribe en cada mutación) — **no hay historial de transiciones** | `dulabs_dev_jobs` |
| Logs del Worker | Mínimos — solo errores (`console.error` implícito vía excepción no capturada en `server.ts`), ningún log estructurado por resultado (éxito/rechazo/incertidumbre) | `worker-outbound/server.ts` |

**Gap real para diagnosticar un envío en producción**: hoy, para saber "qué pasó con el mensaje X", solo se puede consultar `GET /api/v1/messages/:id` (status público) o leer directamente la fila de `dulabs_dev_jobs` — no hay ningún log estructurado por transición, ni `wamid`, ni un historial de qué pasó en cada intento (`network_attempts` es un contador, no un log). Esto es suficiente para el contrato público actual, pero insuficiente para soporte/debugging real de un incidente.

---

## 16. Failure scenarios (resumen ejecutivo, detalle en sección 9)

Timeout antes del POST → incertidumbre → reconciliation_pending, nunca blind resend. Timeout durante/después del POST → indistinguible del caso anterior, mismo resultado seguro (nunca duplica, pero puede quedar atascado si Meta sí procesó — ver R1). Worker crash → lease expira, otro Worker hace takeover normalmente, SALVO el caso borde de la sección 9. Pub/Sub duplicate delivery → cubierto. 4xx real → retry_pending/failed_by_meta, CON el bug de ledger de F3.

## 17. Recovery scenarios

`retry_pending` se recupera automáticamente cada 5 min vía `reintentarOutbound` (Fase 3 cierre). `reconciliation_pending` **NO se recupera automáticamente hoy** (R1) — requiere intervención manual o una decisión de producto (D1) para definir un mecanismo real. Lease expirado se recupera automáticamente vía takeover — salvo el caso borde de concurrencia de la sección 9.

---

## 18. Riesgos (consolidado)

1. **F1 (crítico)** — el payload real enviado a Meta no cumple el contrato de Meta. Bloquea el objetivo de Fase 5 si no se corrige primero.
2. **F3** — usage_ledger puede quedar inconsistente (`liberado` en vez de `confirmado`) para un job que tuvo éxito en su segundo intento tras un rechazo 4xx inicial.
3. **F2** — sin `wamid`, no hay forma de correlacionar con eventos reales de Meta ni de dar soporte real a un desarrollador.
4. **F4** — errores retryables de Meta (rate limit) se tratan igual que errores permanentes, gastando intentos innecesariamente.
5. **Nota crítica de la sección 9** — ventana teórica de job huérfano si un Worker pierde el lease mientras su POST físico sigue en vuelo.
6. **R1 heredado** — `reconciliation_pending` sin resolución automática real (sin mecanismo real de Meta disponible).
7. **R2** — confirmar si `retry_pending_idx` ya se aplicó.
8. **F5** — sin backoff real entre reintentos (menor, aceptable para V1 si se decide explícitamente).

---

## 19. Decisiones pendientes (requieren tu aprobación)

- **D1** — Mecanismo real para resolver `reconciliation_pending` (heredado de Fase 3, riesgo #4/#5, sin mecanismo real de Meta disponible). ¿Se acepta como cola manual/soporte para V1, o se investiga una alternativa real (ej. correlación por `wamid` vía el pipeline inbound existente, que requeriría implementar F2 primero)?
- **D2** — Corregir F1 (shape real del payload a Meta): ¿dónde vive la transformación? Propuesta a evaluar: una función pura nueva en `lib/developer/` (ej. `meta-message-mapper.ts`) que traduzca `{to,type,text}` público → `{messaging_product:"whatsapp",to,type,text}` real de Meta, invocada por el Worker justo antes del POST — sin tocar el contrato público de `POST /api/v1/messages` (Fase 4, FROZEN), sin tocar cómo se persiste `job.payload` hoy (se transformaría al momento de enviar, no al guardar).
- **D3** — Corregir F3 (usage_ledger): mover `liberarUso` para que solo se ejecute cuando la transición resultante sea REALMENTE terminal (`failed_by_meta`), no cuando quede en `retry_pending`. Requiere que el Worker sepa el resultado de la transición (`aplicarEventoJob` ya lo devuelve) antes de decidir si liberar.
- **D4** — Implementar F2 (captura de `wamid`): requiere una columna nueva en `dulabs_dev_jobs` (migración aditiva) y leer `respuestaMeta.json()` en el camino de éxito.
- **D5** — Implementar F4 (diferenciar errores retryables de Meta): requiere parsear `error.code` del cuerpo de la respuesta 4xx/5xx de Meta y mapear un conjunto conocido de códigos transitorios (ej. `130429`) para NO consumir un intento físico de los 2 disponibles, o tratarlos explícitamente distinto. ¿Se autoriza research adicional de la lista real de códigos antes de implementar, o se define una lista mínima ahora?
- **D6** — Implementar F5 (backoff real vía `next_attempt_at`): ¿vale la pena para V1, dado que `MAX_INTENTOS_FISICOS=2` ya acota el daño, o se difiere?
- **D7** — Caso borde de lease + Worker lento (sección 9): ¿se acepta el riesgo residual (baja probabilidad, requiere >60s de lentitud real) documentado, o se diseña una mitigación (ej. reducir `LEASE_DURACION_MS`, o hacer que el Worker verifique su propio lease_id justo antes de escribir el resultado final, lo cual YA hace `aplicarEventoJob` vía el CAS de `lease_id` — technically ya mitigado a nivel de "nunca corrompe datos", el riesgo real es solo "el job queda huérfano/atascado", no "se duplica")?
- **D8** — ¿Se actualiza el comentario desactualizado de F6 como parte de Fase 5 (housekeeping trivial) o se deja para una limpieza aparte?
- **D9** — Confirmar el estado real de la migración `retry_pending_idx` (R2) antes de cualquier trabajo de Fase 5.

---

## 20. Matriz de tests requerida (a ejecutar tras implementación, no ahora)

| Caso | Qué debe demostrar |
|---|---|
| Happy path real | Developer → Gateway → Job → Pub/Sub → Worker → **Meta real de verdad, contrato correcto** (`messaging_product` presente) → `success_confirmed`, `wamid` capturado, `confirmarUso` |
| Meta 4xx permanente (ej. número inválido) | `retry_pending`/`failed_by_meta` según intentos, sin retry indebido, `liberarUso` solo si terminal |
| Meta 4xx transitorio (rate limit, si D5 se aprueba) | No consume intento físico indebidamente, o backoff real aplicado |
| Meta 5xx | Incertidumbre real, `reconciliation_pending`, nunca blind resend |
| Timeout antes del POST | Recuperación sin duplicar |
| Timeout durante/después del POST | Incertidumbre, `reconciliation_pending`, nunca blind resend |
| Worker crash (lease expira) | Recuperación correcta vía takeover |
| Worker lento + lease robado mientras el POST sigue en vuelo (D7) | Comportamiento documentado y probado explícitamente (nuevo, no existe hoy) |
| Pub/Sub duplicate delivery | Cero segundo POST físico |
| Concurrent workers | Cero doble envío (ya existe, mantener en regresión) |
| Concurrent retries | Cero doble envío (ya existe, mantener en regresión) |
| Usage: rechazo 4xx con reintentos → reintento exitoso | **Nuevo — demuestra la corrección de F3**: ledger termina en `confirmado`, nunca `liberado`, tras un éxito en el segundo intento |
| Usage: un Job = una reserva | Ya cubierto, mantener en regresión |
| Security: Workspace A no puede enviar con número de Workspace B | Ya cubierto (Fase 4), mantener en regresión |
| Secrets nunca en logs | Grep real de logs desplegados, incluyendo cualquier log nuevo que capture la respuesta de Meta (wamid) — confirmar que el token nunca se loggea junto con él |
| Meta real controlada | Si el entorno lo permite: un envío real de prueba a un número de test propio de Meta (WhatsApp Test Number, no a un usuario final sin autorización) para confirmar el contrato corregido (F1) de extremo a extremo — **requiere autorización explícita antes de ejecutar, no se ejecuta en esta etapa** |

---

## Archivos que eventualmente habría que modificar (si se aprueban D2-D6)

`services/worker-outbound/handler.ts` (D2, D3, D4, D5), nuevo `lib/developer/meta-message-mapper.ts` o similar (D2), `lib/developer/jobs-store.ts` (D4, si `wamid` se persiste vía una función existente extendida), `services/reconciliation/run.ts` (D1, si se define un mecanismo real), migración nueva aditiva para columna `wamid` (D4).

## Migraciones eventualmente necesarias

Una migración aditiva para `wamid` en `dulabs_dev_jobs` (D4), si se aprueba. Ninguna otra identificada.

## Infraestructura eventualmente necesaria

Ninguna nueva — todo lo identificado (D1-D9) se resuelve con cambios de código sobre la infraestructura ya existente (Cloud Run, Pub/Sub, KMS, Secret Manager, Postgres), salvo que D1 requiera explorar un mecanismo real distinto que hoy no se puede anticipar sin decisión de producto.

---

## Archivos revisados en esta auditoría

`services/worker-outbound/handler.ts`, `services/worker-outbound/index.ts`, `services/gateway/outbound-handler.ts`, `services/gateway/validation.ts`, `services/gateway/api-auth.ts`, `lib/developer/jobs-store.ts`, `lib/developer/outbound-state-machine.ts`, `lib/developer/usage-ledger.ts`, `lib/developer/whatsapp-numbers-store.ts`, `lib/developer/secure-crypto.ts` (referencia), `services/reconciliation/run.ts`, `lib/rate-limit.ts`, `lib/whatsapp-outbound.ts` (referencia, Business, para confirmar el contrato real de Meta), migraciones de `dulabs_dev_jobs`/`dulabs_dev_usage_ledger` (Fase 2), los 3 reportes de cierre previos (Fase 3 inicial + 2 addendums, Fase 4 diseño + cierre).

**Ningún archivo de código, test, migración o infraestructura fue modificado.**

---

## Estado

**FASE 5 — DESIGN READY FOR REVIEW.**
