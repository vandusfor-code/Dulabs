# DuLabs Developer V1 — Fase 4: Developer API — Reporte de Cierre Canónico

**Estado: FINAL REVIEW — NO FROZEN.** Este documento reemplaza al diseño (`DULABS_DEVELOPER_V1_PHASE_4_API_DESIGN.md`) como fuente de verdad del contrato real desplegado. El código real es la referencia; donde el diseño original difiere de la implementación, se documenta la implementación real y se marca la diferencia explícitamente.

Commit: `930f6ef`. Revisión desplegada y sirviendo 100% del tráfico: `dulabs-gateway-00004-qil` (imagen `gateway:fase4-developer-api-v2`).

---

## 1. Contrato público final (código real, verificado línea por línea)

Todos autenticados por `Authorization: Bearer dl_live_...` salvo que se indique. Todos devuelven `X-Request-Id`. Errores: `{error:{code,message,request_id}}`.

| Endpoint | Ownership | Rate limit real aplicado |
|---|---|---|
| `POST /api/v1/messages` | `obtenerNumeroDelWorkspace(workspaceId, whatsappNumberId)` antes de crear el job | `devOutboundPorNumero` (2/1s) **+** `devOutboundPorWorkspace` (1200/60s), ambos antes de `crearJobConIdempotencia` |
| `GET /api/v1/messages/:id` | `obtenerJobDelWorkspace(workspaceId, jobId)` — filtro compuesto en una sola query | **Ninguno** (ver hallazgo 1 abajo) |
| `GET /api/v1/whatsapp-numbers` | `listarNumeros(workspaceId)` | **Ninguno** |
| `GET /api/v1/whatsapp-numbers/:id` | `obtenerNumeroDelWorkspace(workspaceId, numeroId)` | **Ninguno** |
| `GET /api/v1/usage` | `obtenerResumenUsoDelWorkspace(workspaceId, ...)` — `workspaceId` siempre de `ctx`, nunca de query params | **Ninguno** |
| `GET /api/v1/me` | N/A (devuelve el propio contexto de auth) | **Ninguno** |
| `GET /api/v1/webhooks` | `listarWebhooksDelWorkspace(workspaceId)` | **Ninguno** |
| `POST /api/v1/webhooks` | `obtenerNumeroDelWorkspace(workspaceId, whatsappNumberId)` antes de `configurarWebhook` | **Ninguno** |

Todas las rutas (incluidas las sin rate limit de lectura) pasan por `conWorkspaceAutenticadoPorApiKey`, que sí aplica `devAuthFallida` (20/60s por IP) — pero eso protege intentos de autenticación fallidos, no lectura legítima repetida.

Response shapes, headers y códigos de error: confirmados exactamente como en el reporte de implementación anterior — no repetidos acá para mantener este documento como fuente única sin duplicar el código.

---

## 2. Request ID — decisión definitiva (código real, no el diseño original)

```
Gateway (generarRequestId(), services/shared/request-id.ts)
  → header X-Request-Id en toda respuesta (éxito y error)
  → error.request_id en el body de error
  → payload del mensaje publicado a Pub/Sub: {workspaceId, jobId, requestId}
  → (NO se propaga automáticamente a los logs de Cloud Run de requests exitosas)
```

**El diseño original hablaba de "atributo" de Pub/Sub — la implementación real usa el BODY del mensaje.** Es técnicamente correcto y suficiente para el objetivo (trazabilidad `request → job`): el Worker que procese ese mensaje tiene el `requestId` disponible si alguna vez necesita loggearlo, sin que esto requiera tocar `services/shared/pubsub.ts` ni el contrato de mensaje que los Workers ya parsean. Se conserva tal cual, según tu instrucción explícita de no cambiar la implementación solo para que coincida con el documento — **este es ahora el documento actualizado para reflejar la realidad**.

**Precisión importante encontrada en esta auditoría**: `request_id` permite correlación real a nivel de *datos de la aplicación* (misma cadena en la respuesta HTTP y en el mensaje Pub/Sub), pero **no aparece automáticamente en las entradas de Cloud Logging de Cloud Run** para requests exitosas — el Gateway solo lo loggea explícitamente en la ruta de error 500 (`console.error` en `server.ts`). Confirmado con una lectura real de logs (1h, 63 entradas): 0 ocurrencias de `req_<uuid>` en el texto de los logs. Esto no es un defecto (evita logging ruidoso/costoso de cada request exitosa) pero corrijo la afirmación de que "permite correlacionar en Cloud Logging directamente" — la correlación real es entre la respuesta al cliente y el payload de Pub/Sub, no vía grep de logs de Cloud Run salvo en el camino de error.

---

## 3. Security regression — los dos hallazgos de ownership

### A. Webhook hijacking

**Código corregido**: `services/gateway/management-handler.ts::manejarConfigurarWebhook` (superficie de sesión) y `services/gateway/webhooks-handler.ts::manejarConfigurarWebhookPublico` (superficie de API key, nueva). Ambos ahora llaman `obtenerNumeroDelWorkspace(workspaceId, whatsappNumberId)` y devuelven `404` si el número no pertenece al workspace autenticado, **antes** de llamar a `configurarWebhook`.

**Por qué el ataque ya no funciona**: el ataque explotaba que `configurarWebhook` hacía `upsert` sobre `dulabs_dev_webhook_configs` con `onConflict: "whatsapp_number_id"` — como ese índice único NO es compuesto con `workspace_id`, pasar el `whatsappNumberId` real de otro workspace sobrescribía su fila. Ahora, la verificación de ownership ocurre antes de siquiera llamar a `configurarWebhook`, así que un `whatsappNumberId` ajeno nunca llega a esa función.

**Test que lo demuestra**: `services/gateway/webhooks-handler.e2e.test.ts` — dos tests reales ("POST con whatsappNumberId de OTRO workspace" para la superficie pública, y "REGRESIÓN DE SEGURIDAD... manejarConfigurarWebhook" para la superficie de sesión), ambos verifican real contra Postgres que la fila de la víctima nunca cambia.

**Confirmado que afecta ambas superficies**: sí — session y API key, mismo fix, mismo patrón, dos tests independientes.

### B. Orphan / cross-tenant job creation

**Código corregido**: `services/gateway/outbound-handler.ts::manejarMensajeSaliente` — `obtenerNumeroDelWorkspace` antes de `crearJobConIdempotencia`.

**Por qué "el ataque ya no funciona"**: en este caso nunca hubo una fuga real de datos ni un envío real por el número de otro workspace (`obtenerTokenMetaDelNumero`, ya existente, siempre filtró por `workspace_id` antes de esta corrección). El impacto real era la creación de filas huérfanas (job/idempotency/usage-ledger) referenciando un número ajeno, sin ningún efecto físico. Ahora se rechaza con `400 invalid_whatsapp_number` antes de crear nada.

**Test**: `services/gateway/outbound-handler.e2e.test.ts`, "Fase 4 -- whatsappNumberId de OTRO workspace se rechaza... ANTES de crear job o reservar usage".

**No se volvió a tocar esta lógica en esta auditoría** — solo se confirmó que sigue protegida (releída línea por línea, sección 1).

---

## 4. Public status — confirmado

Mapeo real (`services/gateway/job-status.ts`), verificado byte a byte contra el pedido:

```
created / queued / retry_pending  -> queued
sending                            -> processing
success_confirmed                  -> sent
failed_by_meta                     -> failed
reconciliation_pending             -> processing
```

`EstadoPublicoJob` es un union type de solo 4 valores (`"queued" | "processing" | "sent" | "failed"`) — estructuralmente imposible devolver otra cosa. Confirmado en el smoke test real contra infraestructura desplegada: `lease_id`, `version_token`, `physical_outcome`, `network_attempts` ausentes (`undefined`) en la respuesta real de `GET /api/v1/messages/:id`. El comentario en el código deja explícito que `processing` no implica confirmación de Meta (riesgo #4 de Fase 3, sin resolver, no se inventó nada acá).

---

## 5. API key security — confirmado

| Propiedad | Estado |
|---|---|
| Hash irreversible (SHA-256) | ✅ `lib/developer/api-keys.ts`, sin cambios |
| `timingSafeEqual` | ✅ `verificarApiKey`, sin cambios |
| `revoked_at` verificado | ✅ `autenticarApiKey`, sin cambios en la lógica (solo se agregó `prefix`/`name` al tipo de retorno) |
| API key nunca en logs | ✅ confirmado con grep real de logs desplegados (0 ocurrencias de `dl_live_`) |
| `Authorization` nunca en logs | ✅ confirmado (0 ocurrencias) |
| API key no funciona contra `/dev/*` | ✅ `services/gateway/multi-tenant-security.e2e.test.ts`, test real |
| Sesión de Supabase no funciona como Developer API key | ✅ mismo archivo, test real |
| Rate limit de fallos de auth existe | ✅ `devAuthFallida` (20/60s por IP), aplicado en `conWorkspaceAutenticadoPorApiKey` antes de siquiera llamar a `autenticarApiKey` |

Sin TTL agregado — confirmado, tal como se instruyó.

---

## 6. Multi-tenant final check

Verificado endpoint por endpoint (sección 1: columna "Ownership"). Los 5 recursos pedidos:

- **messages**: `obtenerJobDelWorkspace` — probado con test cross-tenant real (`404`).
- **whatsapp numbers**: `obtenerNumeroDelWorkspace` — probado.
- **webhooks**: `obtenerNumeroDelWorkspace` antes de `configurarWebhook`, y `listarWebhooksDelWorkspace` filtra por `workspace_id` — probado (hallazgo de seguridad, sección 3A).
- **usage**: `workspace_id` siempre viene de `ctx` (autenticación), nunca de un parámetro del cliente — no hay superficie de IDOR posible aquí porque no hay ningún id de recurso que el cliente pueda manipular.
- **me**: mismo criterio — no expone ni acepta ningún id de otro recurso.

Ningún endpoint confía en un `workspace_id` enviado por el cliente en ningún caso — siempre se deriva de la API key autenticada.

---

## 7. Rate limit final

| Límite | Valor real implementado | Aplicado antes de Job/usage | Mecanismo |
|---|---|---|---|
| Per-number | 2 msg/s (`devOutboundPorNumero`, ventana 1s) | ✅ | RPC `dulabs_rate_limit_incrementar`, Postgres real |
| Workspace outbound | 1200 req/min (`devOutboundPorWorkspace`, ventana 60s) | ✅ | Idéntico |
| Auth failure | 20/60s por IP (`devAuthFallida`) | ✅ (antes de autenticar) | Idéntico |
| **Reads** | **300/60s (`devLectura`) — DEFINIDO pero NUNCA APLICADO** | ❌ | N/A |

**HALLAZGO — no corregido en esta auditoría, por instrucción explícita de no agregar/cambiar funcionalidad**: la categoría `devLectura` existe en `lib/rate-limit.ts` (agregada durante la implementación) pero **ningún handler de lectura la invoca**. Confirmado con `grep` real: `verificarLimiteTasa` solo se llama desde `api-auth.ts` (auth-fail) y `outbound-handler.ts` (los dos límites de outbound). `GET /api/v1/messages/:id`, `GET /api/v1/whatsapp-numbers(+/:id)`, `GET /api/v1/usage`, `GET /api/v1/me`, `GET /api/v1/webhooks` **no tienen ningún rate limit de lectura real hoy**, más allá del límite genérico de fallos de auth (que no protege lecturas legítimas repetidas). Esto es un **gap real de la implementación de Fase 4**, no algo introducido por esta auditoría — lo encontré revisando el código real contra lo pedido. No lo corregí porque esta auditoría es explícitamente de solo-lectura ("realiza únicamente una auditoría"). Queda como bloqueo técnico documentado, pendiente de tu decisión.

El resto del mecanismo (distribuido vía Postgres, atómico, fail-open) sigue siendo el mismo ya verificado.

---

## 8. Idempotency final — confirmado sin cambios

Mismo mecanismo de Fase 1/2/3, sin tocar. Verificado (relectura de código + 174/174 tests, incluidos los de concurrencia real de Fase 4): misma key + mismo payload → mismo Job; payload distinto → `409`; concurrencia real → un solo Job; un Job → una sola reserva de usage.

---

## 9. Webhook security — confirmado

`POST /api/v1/webhooks`: valida ownership (sección 3A) ✅, usa `ssrf-guard.ts` existente vía `configurarWebhook` (sin duplicar) ✅, nunca guarda el secreto en claro (cifrado con `secure-crypto.ts`, sin cambios) ✅, nunca devuelve el secreto en `GET` ✅ (confirmado en smoke test real), nunca expone el token de Meta (no relacionado, no se toca en esta superficie) ✅, no permite cross-tenant takeover (sección 3A) ✅. `/api/v1/dev/webhooks` (sesión) tiene la misma corrección de ownership aplicada — seguridad equivalente confirmada.

---

## 10. Payload security — confirmado

`services/gateway/validation.ts`, sin cambios en esta auditoría: `Idempotency-Key` máx. 255 caracteres, rechaza vacío y caracteres de control; `text.body` máx. 4096 caracteres; `to` máx. 32 caracteres; JSON inválido → `400` antes de tocar cualquier store; `type` distinto de `"text"` → rechazado (V1 no amplía tipos soportados). Todo probado con tests reales que confirman cero escritura en DB ante un payload inválido.

---

## 11. Observability — confirmado, con una precisión

Logs reales del Gateway (ventana de 1h, 63 entradas reales) — **0 ocurrencias** de `Authorization`, `dl_live_`, `whsec_`, `meta_token`, o cualquier material de KMS. `request_id` permite correlación real a nivel de datos de la aplicación (respuesta HTTP ↔ payload de Pub/Sub) — ver la precisión importante de la sección 2 sobre que esto no equivale a poder grepear Cloud Logging directamente para una request exitosa.

---

## 12. Regression — PASS

**174/174 PASS**, 0 fallas, ejecutada de nuevo al inicio de esta auditoría, sin ninguna modificación de código. Ningún test fue tocado.

---

## PASS/FAIL por punto (1–12)

| # | Punto | Resultado |
|---|---|---|
| 1 | Contrato público final | ✅ PASS |
| 2 | Request ID — decisión definitiva | ✅ PASS (documentado, implementación real conservada) |
| 3 | Security regression (A y B) | ✅ PASS |
| 4 | Public status | ✅ PASS |
| 5 | API key security | ✅ PASS |
| 6 | Multi-tenant final check | ✅ PASS |
| 7 | Rate limit final | ⚠️ **PARTIAL — reads sin rate limit real aplicado (hallazgo, sin corregir)** |
| 8 | Idempotency final | ✅ PASS |
| 9 | Webhook security | ✅ PASS |
| 10 | Payload security | ✅ PASS |
| 11 | Observability | ✅ PASS (con precisión documentada) |
| 12 | Regression | ✅ PASS (174/174) |

---

## Cambios documentales realizados

Este documento (`docs/DULABS_DEVELOPER_V1_PHASE_4_CLOSURE_REPORT.md`) es nuevo — reemplaza al documento de diseño como fuente de verdad del contrato real. No se modificó ningún otro documento. No se modificó ningún archivo de código, test, migración, ni configuración de infraestructura en esta auditoría.

## Tests ejecutados

Los 26 archivos de la suite completa Developer V1 (174 tests) — ninguno modificado.

## Resultado

174/174 PASS.

## Commit

Ningún cambio de código nuevo — el commit de implementación vigente sigue siendo `930f6ef`. Este documento se commitea por separado, como commit de documentación exclusivamente (sin tocar ningún archivo de código, test o configuración).

## Working tree

Limpio, sin cambios de código. Este documento se commitea por separado (ver sección "Commit" — commit de documentación, ningún cambio de código).

## Riesgos restantes

1. **Rate limit de lectura no aplicado (sección 7)** — bloqueo técnico real, encontrado en esta auditoría.
2. Heredado de Fase 3: `reconciliation_pending`/`processing` sin confirmación automática real (riesgo #4, sin cambios).
3. Rotación pendiente de `meta-app-secret` (sin tocar, como se instruyó).
4. Migración `retry_pending_idx` sigue sin aplicar (sin tocar, como se instruyó).

## Confirmación de que NO se agregó funcionalidad nueva

Confirmado — esta auditoría fue exclusivamente de lectura de código, ejecución de tests, lectura de logs reales, y redacción de este documento. Cero líneas de código de producción modificadas.

---

**NO declaro FASE 4 — FROZEN.** Existe un bloqueo técnico real (rate limit de lectura no aplicado, sección 7) que impide un PASS limpio en todos los puntos. Queda a tu decisión: aceptarlo como deuda técnica documentada para V1, o autorizar una corrección puntual antes del freeze definitivo.
