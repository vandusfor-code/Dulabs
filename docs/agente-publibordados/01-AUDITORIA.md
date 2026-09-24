# Agente Publi Bordados — 01 · Auditoría del sistema existente

> Etapa: **AUDITORÍA** (sin código, sin migraciones, sin cambios de comportamiento).
> Base: `main` @ `268fa0a`. Todo lo afirmado aquí se verificó leyendo el código; donde algo
> depende de datos de producción (que no se pueden consultar desde este entorno) se marca
> **[VERIFICAR EN BD]**.

---

## 0. Resumen ejecutivo

1. **Ya existe el 70 % de la infraestructura que necesita el agente**, en `lib/agente` (Fase 8,
   en producción para Delacour): frontera fail-closed por número, buzón con **un turno a la vez
   por conversación**, estado con **compare-and-set**, deduplicación por `wamid` en tres capas,
   última barrera "una asesora tomó el chat", traspaso decidido por el backend sin modelo, topes
   de costo/abuso, trazas persistentes sin datos personales y un **contrato neutral de proveedor
   de IA** con reintento acotado.
2. **Lo que NO sirve tal cual**: el runtime (`runAgentTurn`), las herramientas y el estado de
   `lib/agente` son específicos de **venta por catálogo** (carrito, referencias, precios,
   pedidos). La configuración solo acepta `tipo = 'catalog_sales'` y cualquier otro tipo es
   rechazado (fail-closed). El agente de Publi Bordados es un **nuevo tipo de agente** sobre la
   misma infraestructura, no una variación del de catálogo.
3. **Business Agent / Flow no es la base correcta**: compila los "datos del cliente" a nodos
   `question`/`buttons` secuenciales — exactamente el bot rígido que Publi Bordados no quiere.
4. **Riesgos inmediatos que hay que resolver ANTES de construir** (sección 15): el número podría
   estar respondiendo hoy con la IA legacy genérica; las **imágenes y audios de clientes se
   descartan sin registrarse** en números que no usan Flow (crítico para un negocio de bordados:
   los clientes mandan fotos de su logo); y el chequeo "¿hay una asesora?" **falla abierto** ante
   un error de BD.
5. **Proveedor de IA**: la única infraestructura de agente con contrato neutral soporta hoy solo
   **Gemini (`gemini-3.6-flash`)**; Claude (`claude-sonnet-5`) se usa en la IA legacy, fuera de
   ese contrato. La elección queda como decisión pendiente (sección 16).

---

## 1. Qué infraestructura existente podemos reutilizar

| Componente | Archivo | Qué garantiza realmente (verificado) | Uso en Publi Bordados |
| --- | --- | --- | --- |
| Webhook Meta | `app/webhook-dulabs/route.ts` | Firma HMAC-SHA256 con `timingSafeEqual` (`lib/meta-firma.ts`); tenant por `phone_number_id`; registro síncrono del entrante; dedupe por `wamid`; gates (lista negra, `ia_pausada`, `ia_restringida_a`, pausa humana, cupo IA del plan, freno de ráfaga, candado). | **Reutilizar sin cambios** (ya enruta a `lib/agente` antes que Flow/legacy). |
| Frontera del agente | `lib/agente/webhook.ts` | `none` → sigue el webhook; `disabled`/`invalid`/sin credencial → **silencio, nunca cae a otro bot**; reintento de lectura de config; `flush` de trazas antes de terminar (serverless). | **Extender**: despachar por `tipo`. |
| Config por número | `lib/agente/config.ts` + tabla `dulabs_agente_runtime_config` | Fila validada entera con zod; `tenant_mismatch` si la fila no es del tenant del webhook; proveedor/modelo/credencial **sin default**; credencial por referencia `env:GEMINI_KEY_*` (nunca el secreto en BD). | **Extender** (nuevo `tipo` + su configuración). |
| Buzón + turno único | `lib/agente/buzon.ts` + `dulabs_agente_buzon`, `dulabs_agente_turno`, RPC `dulabs_agente_tomar_turno`/`soltar_turno` | Único por `wamid`; un solo dueño del turno (lease 75 s); la ráfaga se atiende en **un** turno; soltar es atómico ("si llegó algo, sigue"); pendientes > 15 min se cierran sin responder; turno caído vence solo. | **Reutilizar tal cual**. |
| Estado con CAS | `lib/agente/estado.ts` + `dulabs_agente_conversaciones` | `save(…, expectedVersion)` → `false` si otra escritura ganó; estado ilegible → se reinicia (nunca a medias). | **Reutilizar el patrón**; el *schema* es de catálogo (ver §13). |
| Proveedor de IA | `lib/ia-proveedores/{contrato,registro,gemini,reintentos,simulado}.ts` | Contrato neutral (un paso = texto y/o tool calls); errores normalizados sin secretos; Gemini con `functionCallingConfig: VALIDATED` + `allowedFunctionNames`; 1 reintento solo para errores transitorios y dentro del plazo; **sin fallback** de proveedor; proveedor simulado para tests. | **Reutilizar tal cual**. |
| Intención "quiero una persona" | `lib/agente/intencion.ts` (`asksForHuman`) | Determinista, sin modelo; excluye "no quiero un asesor" y preguntas sobre la asesora. | **Reutilizar** (vocabulario "asesora" ya coincide). |
| Topes de costo/abuso | `lib/agente/limites.ts` + RPC `dulabs_agente_consumo` | Por minuto/día por cliente y tokens/día por negocio, leídos de las trazas; si no se puede medir, sigue (no frena ventas). | **Reutilizar tal cual**. |
| Trazas | `lib/agente/trazas.ts` + `dulabs_agente_trazas`, RPC `dulabs_agente_diagnosticar` | Una fila por turno, sin texto del cliente (`contact_ref` = hash); entrega real de Meta; purga a 90 días. | **Reutilizar** + campos de calificación. |
| Pausa humana | `lib/pausas-chat.ts` + `dulabs_pausas_chat` | Fuente única de "¿la IA puede responder?"; `activarPausaChat` (upsert idempotente), `liberarPausaChat` ("devolver a IA"). | **Reutilizar** (con una variante fail-closed, §15.3). |
| Human Inbox | `app/api/dashboard/conversaciones/handoff` | `tomar` (pausa 30 días) / `devolver_a_ia`; auth por sesión + rol `admin`/`agente` + número del **mismo tenant** + rate limit. | **Reutilizar sin cambios**. |
| Envío WhatsApp | `lib/whatsapp.ts` (`enviarTexto`), `lib/whatsapp-outbound.ts` | Envío + registro en `dulabs_mensajes_log` (origen `ia`) + uso del plan. | **Reutilizar** (vía el `AgentSender` de `lib/agente/webhook.ts`). |
| Red de seguridad | `app/api/cron/mensajes-sin-respuesta` (QStash) | Entrantes sin `procesado_at` entre 3 y 30 min → alerta al canal interno. | **Reutilizar**. |

**Considerado y descartado como base:**

| Candidato | Por qué no |
| --- | --- |
| Business Agent (`lib/agent-compiler`) + Flow Engine | `customerData.fields` se compila a nodos `question`/`buttons` **secuenciales** (`lib/customer-data.ts`). Es el patrón rígido que el cliente rechaza. Además está acoplado al orquestador de Flow. |
| `lib/campaign-lead-engine.ts` | Máquina de estados fija de una campaña (SÍ/NO → RUT → teléfono → compañía), con extracción de Chile. No configurable por campos. |
| `lib/lead-solicitud-ia.ts` (`captura_leads`) | Específico de Du/314, llama a Gemini fuera del contrato neutral, sin buzón ni CAS. Útil solo como referencia de patrón (`responseSchema` + validación backend). |
| IA legacy (`lib/ia.ts`) | Texto libre de Claude sin estado estructurado, sin herramientas, sin validación: incumple el principio "la IA no es la autoridad". |

---

## 2. Cómo entra hoy un mensaje de WhatsApp

```
Meta ──POST /webhook-dulabs──► POST()
  1. Lee el body CRUDO y verifica x-hub-signature-256 (HMAC con META_APP_SECRET) ─ inválida → 401
  2. JSON.parse ─ inválido → 400
  3. Por cada change:
       · reenvío síncrono a DuMo si aplica (solo números con forward_to_dumo)
       · registrarMensajesEntrantesSincrono(): INSERT en dulabs_mensajes_log
         (procesado_at = null)  ◄── ANTES de responder 200
         ⚠ solo si hay texto/botón/interactivo, o media en números con Flow (ver §15.2)
       · after(() => procesarCambio(...))   ◄── trabajo diferido (Vercel, maxDuration 120 s)
  4. Responde 200 "EVENT_RECEIVED" (siempre, tras firma válida)

procesarCambio(phone_number_id)
  · dulabs_clientes_config por phone_number_id → tenant (sin fila → se ignora)
  · estado_conexion = 'desconectado' → se ignora
  · ecos de coexistencia (el dueño respondió desde su celular) → pausa del chat 30 min
  · statuses (entregado/leído) → actualiza campañas
  · por cada mensaje: botón/interactivo se normaliza a texto; media se DESCARTA salvo Flow
  · atenderMensaje(cliente, mensaje, nombreContacto, remitente)
```

## 3. Cómo se decide qué agente atiende

`atenderMensaje` (orden exacto, primera que devuelve `true` gana):

| # | Paso | Nota |
| --- | --- | --- |
| 0 | Marcar `procesado_at` (`UPDATE … WHERE procesado_at IS NULL`) | Dedupe (§5). |
| 1 | Lista negra (`ia_numeros_bloqueados`) | Silencio. |
| 2 | Migración AMORE (solo su `phone_number_id`) | No aplica. |
| 3 | Encuesta activa del contacto | Solo si el contacto tiene sesión. |
| 4 | Lead de campaña del contacto | Solo si el contacto tiene fila. |
| 5 | Soluciones Financieras (solo su `phone_number_id`) | No aplica. |
| 6 | Onboarding post-pago del contacto | Solo si tiene sesión. |
| 7 | `ia_pausada` del número | Silencio total (**interruptor de emergencia**). |
| 8 | `ia_restringida_a` | Solo remitentes autorizados (**útil para QA real**). |
| 9 | Pausa humana del chat (`dulabs_pausas_chat`) | Silencio. |
| 10 | Cupo mensual de IA del plan del tenant | Silencio al agotarse. |
| 11 | Freno de ráfaga (2,5 s: si llegó uno más nuevo, este se encola en el buzón del agente y calla) | |
| 12 | Marca leído + "escribiendo…"; candado del chat (`dulabs_chat_lock`) | Best-effort (§6). |
| 13 | **Agente por número (`lib/agente`)** — si hay fila en `dulabs_agente_runtime_config` | Con fila, **el mensaje es suyo** (nunca cae a otro bot). |
| 14 | Flow / Business Agent (`flow_activo`) | |
| 15 | Legacy (Claude, `prompt_sistema` del número) | Por defecto para un número recién conectado. |

**Consecuencia para Publi Bordados:** basta una fila en `dulabs_agente_runtime_config` para su
`phone_number_id` para que el agente tome el número por delante de Flow y legacy, sin tocar el
webhook. Los pasos 7 y 8 dan un interruptor de emergencia y una QA con remitentes controlados.

## 4. Cómo funciona hoy `lib/agente`

```
atenderConAgenteSiAplica(input)                        lib/agente/webhook.ts
  loadAgentConfig (1 reintento) ─ ilegible → silencio "unavailable"
  none → handled:false | disabled/invalid → silencio | ok → provider por config (sin fallback)
  enqueueAndDrain(buzón)                               lib/agente/buzon.ts
    ¿tengo el turno? no → "queued" (lo atiende el turno en curso)
    sí → [pendientes → UN runAgentTurn → markProcessed]* (máx. 3 turnos / 45 s) → soltar
runAgentTurn                                           lib/agente/runtime.ts
  config coincide con tenant/número/proveedor (defensa en profundidad)
  estado.load ─ falla → mensaje fijo técnico
  todos los wamid ya en recentWamids → "duplicate" (sin modelo)
  humanTookOver() → "preempted" (sin modelo)
  topes → throttle (silencio) | handoff (mensaje fijo)
  asksForHuman(texto) → handoff sin modelo
  bucle modelo↔herramientas (≤4 rondas, ≤8 tools, 1 escritura, 45 s, 15 s por llamada)
  anclaje: la respuesta no puede traer referencias/montos que no vinieron del backend
  humanTookOver() otra vez → no se envía nada
  envío → estado.save(CAS) → traza
```

Lo **genérico** (buzón, CAS, dedupe, barreras de asesora, topes, `asksForHuman`, traza, sender,
proveedor) está bien separado en módulos. Lo **específico de catálogo** está dentro de
`runAgentTurn` (canal, carrito, selección, fotos, anclaje de precios, mensajes fijos de
catálogo), de `estado.ts` (schema del carrito) y de `herramientas.ts` (16 herramientas de pedidos).

## 5. Deduplicación (cómo se hace hoy)

| Capa | Mecanismo | Garantía |
| --- | --- | --- |
| 1 | `dulabs_mensajes_log.wamid` **UNIQUE** (`20260806090000_dedupe_mensajes_entrantes.sql`) + `UPDATE procesado_at WHERE procesado_at IS NULL` | Solo una ejecución "gana" un `wamid`, incluso con reintentos de Meta en paralelo. |
| 2 | `dulabs_agente_buzon.wamid` **UNIQUE** | Un `wamid` entra una vez al buzón (`duplicate`). |
| 3 | `estado.recentWamids` (últimos 10) | Un turno cuyos `wamid` ya se atendieron no llama al modelo ni responde. |
| Handoff | `activarPausaChat` = upsert por `(phone_number_id, telefono_cliente)` | Repetirlo no duplica la pausa. |

**Hueco residual (verificado):** Meta no acepta clave de idempotencia en el envío. Si el proceso
muere **después** de que Meta aceptó el texto y **antes** de `markProcessed`/`estado.save`, el
siguiente mensaje del cliente drena ese pendiente otra vez → respuesta duplicada. Ventana de
milisegundos, pero existe (§15.6).

## 6. Control de concurrencia (cómo se hace hoy)

| Mecanismo | Alcance | Comportamiento ante fallo |
| --- | --- | --- |
| Freno de ráfaga (2,5 s) | Webhook | Heurístico; el mensaje superado entra al buzón del agente. |
| `dulabs_chat_lock` (`lib/chat-lock.ts`) | Webhook, todos los motores | **Best-effort**: espera máx. 20 s y luego **procesa igual**; ante error de BD deja pasar. |
| Buzón + turno (`dulabs_agente_turno`, RPC atómicas) | Solo `lib/agente` | **Garantía real**: nunca dos turnos del agente en paralelo en la misma conversación. |
| CAS por `version` (`dulabs_agente_conversaciones`) | Estado del agente | Una escritura perdida devuelve `false`; nada se pisa en silencio. |

## 7. Handoff (cómo funciona hoy)

- **Estado real**: una fila en `dulabs_pausas_chat` con `pausado_hasta > now()`. No hay una
  máquina de estados explícita; es "pausado / no pausado" por chat.
- **Quién la crea**: la asesora desde el Inbox (`tomar`, 30 días), el eco de coexistencia
  (30 min), el agente (`requestHandoff` → `pauseConversation`, **24 h** en
  `lib/catalogo/pedidos/produccion.ts`), `asksForHuman` o los topes (sin modelo).
- **Mientras dura**: el webhook no llama a ningún motor (gate de recepción, paso 9) y
  `lib/agente` revisa `humanTookOver()` **al empezar y justo antes de enviar**: si una asesora
  tomó el chat mientras el modelo pensaba, no sale nada (`preempted`). Los mensajes se siguen
  registrando.
- **Devolver a la IA**: Inbox → `devolver_a_ia` borra la fila; el siguiente mensaje lo atiende
  la IA. Los pendientes del buzón con más de 15 min se cierran sin responder.
- ⚠ `chatEnPausaHumana` **falla abierto**: ante un error de lectura devuelve `false`
  (la IA puede responder con una asesora activa). Decisión deliberada del legacy (§15.3).
- ⚠ El handoff de `lib/agente` pasa por el **motor de pedidos** (`deps.tools.engine.requestHandoff`):
  está acoplado al catálogo aunque, sin pedido, solo termina en `activarPausaChat`.

## 8. Cómo se almacenan las conversaciones

No existe una tabla "conversación" única y transversal. Hoy:

| Dato | Tabla | Clave |
| --- | --- | --- |
| Memoria estructurada del agente | `dulabs_agente_conversaciones` (`estado` jsonb + `version`) | `(phone_number_id, wa_id)` + `id_tenant` |
| Turno en curso | `dulabs_agente_turno` | `(phone_number_id, wa_id)` |
| Mensajes pendientes | `dulabs_agente_buzon` | `wamid` único |
| Traza por turno | `dulabs_agente_trazas` | `id_tenant`, `contact_ref`, `wamid` |
| Pausa humana | `dulabs_pausas_chat` | `(phone_number_id, telefono_cliente)` |
| Nombre conocido del cliente | `dulabs_clientes_conocidos` | `(phone_number_id, telefono_cliente)` |

La **identidad de una conversación** es `(id_tenant, phone_number_id, wa_id)`.

## 9. Cómo se almacenan los mensajes

`dulabs_mensajes_log`: `phone_number_id`, `telefono_cliente`, `direccion` (entrante/saliente),
`contenido` (texto), `origen` (`entrante`, `ia`, `manual`, `campaña`…), `wamid` (UNIQUE),
`procesado_at`, `created_at`. Es el historial que ven el Inbox y el contexto del agente
(`lib/agente/contexto.ts`: últimos **10** turnos dentro de **24 h**, excluye campañas).

## 10. Cómo se configura un agente por número

Una fila en `dulabs_agente_runtime_config` (solo `service_role`, RLS sin políticas):
`id_tenant`, `phone_number_id` (UNIQUE), `tipo` (**CHECK `in ('catalog_sales')`**), `habilitado`,
`proveedor` (**CHECK `in ('gemini')`**), `modelo` (validado contra la lista cerrada del código),
`credencial_ref` (`env:GEMINI_KEY_*`), `nivel_razonamiento`, `herramientas` (allowlist),
`canal`, `negocio` (jsonb ≤ 8 KB: nombre del agente, presentación, tono, políticas), `limites`.
No hay UI: se escribe por SQL siguiendo el runbook del README ("Activación segura").

## 11. Multi-tenant

- El tenant **nunca** viene del mensaje: se resuelve por `phone_number_id` (dato de Meta dentro
  de un payload firmado) → `dulabs_clientes_config.id_tenant`.
- `lib/agente` revalida: la fila de config debe ser del mismo tenant y número
  (`tenant_mismatch` → fail-closed) y `runAgentTurn` vuelve a comprobarlo.
- Todas las tablas del agente llevan `id_tenant` y están cerradas a `anon`/`authenticated`;
  solo el backend (`service_role`) las toca. Las RPC del agente (turno, consumo, diagnóstico)
  tienen `revoke` a `public`/`anon`/`authenticated` y `grant execute` solo a `service_role`.
- Credenciales de IA por referencia a variables de entorno, **por negocio** si se quiere
  (`GEMINI_KEY_DELACOUR`): aísla cuota y costo.
- El Inbox valida que el `phone_number_id` pertenezca al tenant del usuario.

## 12. Proveedor/modelo de IA en uso

| Camino | Proveedor / modelo | Vía |
| --- | --- | --- |
| `lib/agente` (contrato neutral) | **Gemini `gemini-3.6-flash`** (único registrado) | `lib/ia-proveedores/gemini.ts` (REST, function calling VALIDATED) |
| IA legacy | **Claude `claude-sonnet-5`** | `lib/ia.ts` (SDK `@anthropic-ai/sdk`), fuera del contrato |
| Flow (nodo IA) | Claude o Gemini (configurable por nodo) | `lib/flow/executors/*` |
| Leads Du/314, AMORE | Gemini | `lib/flow/gemini/gemini-client.ts` |

Agregar Claude al contrato neutral = un adaptador nuevo + modelos soportados + tests de
contrato (el diseño lo prevé explícitamente; hoy no existe).

## 13. Qué partes debemos extender

1. **`dulabs_agente_runtime_config.tipo`**: nuevo tipo (propuesta: `lead_qualification`).
   Requiere **migración** (el CHECK solo admite `catalog_sales`) → cambio estructural a validar.
2. **`lib/agente/config.ts`**: `parseAgentConfig` hoy devuelve `kind_unsupported` para cualquier
   otro tipo; debe despachar por tipo y validar la configuración de calificación (campos,
   opciones, reglas, mensajes) con zod estricto.
3. **`lib/agente/webhook.ts`**: `build()` hoy arma dependencias de catálogo
   (`productionAgentToolDeps`; si no están, `runtime_deps_unavailable`). Debe armar las del
   tipo correspondiente y llamar al runtime de ese tipo.
4. **Nuevo runtime de calificación** que reutilice buzón, CAS, dedupe, barreras de asesora,
   topes, `asksForHuman`, sender, proveedor y trazas. **No** se modifica `runAgentTurn`.
5. **Persistencia de la calificación**: el schema de `dulabs_agente_conversaciones.estado` es
   estricto y de catálogo (un estado de otra forma se "reinicia"). El lead calificado es dato
   de negocio que la asesora necesita ver → tabla propia, consultable (propuesta en §17).
6. **Handoff sin motor de pedidos**: un puerto de traspaso propio que termine en
   `activarPausaChat` (sin pasar por `lib/catalogo/pedidos`).
7. **Trazas**: campos de calificación (reglas evaluadas, versión de config, motivo) para
   responder "¿por qué terminó en handoff?" con una consulta.

## 14. Qué NO debemos tocar

- El orden de motores y los gates de `app/webhook-dulabs/route.ts` (ya enruta al agente).
- `runAgentTurn`, `herramientas.ts`, `seleccion.ts`, `anclaje.ts`, `medios.ts`, `etapa.ts` y todo
  `lib/catalogo/**` (producción de Delacour).
- La semántica actual de `chatEnPausaHumana` (la usan legacy, Flow y catálogo): si se necesita
  fail-closed, se agrega una variante, no se cambia la existente.
- `lib/chat-lock.ts`, `dulabs_mensajes_log` y su dedupe, Flow Engine, Business Agent, IA legacy.
- Migraciones ya aplicadas (solo migraciones nuevas y aditivas).
- Configuraciones de otros clientes (Delacour, Du/314, AMORE, el Publibordados histórico de Flow).

Cualquier cambio en `config.ts` / `webhook.ts` (compartidos con Delacour) debe pasar sus 10
suites de `lib/agente` + `lib/ia-proveedores` sin modificarlas.

## 15. Riesgos

| # | Riesgo | Severidad | Evidencia | Mitigación propuesta |
| --- | --- | --- | --- | --- |
| 15.1 | El número de Publi Bordados podría estar respondiendo **hoy** con la IA legacy genérica (sin conocimiento del negocio; si `prompt_sistema = ''` responde **sin instrucciones**: `construirSystemPrompt` usa `??`). | **Alta** | `lib/ia.ts:18-20`; panel: "Sin entrenar · Agente heredado". **[VERIFICAR EN BD]** | Decidir ya: `ia_pausada = true` hasta la QA, o `ia_restringida_a` a números de prueba. |
| 15.2 | **Imágenes, audios y documentos** de clientes se descartan en números sin Flow: ni se responden **ni se registran** (la asesora no los ve en el Inbox). En bordados el cliente manda fotos del logo. | **Alta** | `route.ts` `registrarMensajesEntrantesSincrono` y `procesarCambio` (`esMediaHaciaFlow`). | Requiere cambio en el webhook (fuera de `lib/agente`): registrar la media y que el agente la reciba como evento (acuse + traspaso). Decisión estructural a validar. |
| 15.3 | "¿Hay una asesora?" **falla abierto** ante error de BD. | Media | `lib/pausas-chat.ts` `chatEnPausaHumana`. | Variante fail-closed solo para este agente (no enviar si no se puede verificar). |
| 15.4 | Procesamiento en `after()`: si la función muere, el mensaje queda registrado pero **nadie lo reintenta**; solo una alerta interna (3-30 min). | Media | `route.ts` POST; cron `mensajes-sin-respuesta`. | Aceptable en fase 1 (alerta + Inbox); a futuro, reproceso idempotente de pendientes. |
| 15.5 | Buzón: lo que queda pendiente al agotar el presupuesto de 45 s espera al **siguiente mensaje** del cliente. | Baja | `buzon.ts` `leftPending`. | Aceptable (turnos de calificación son cortos); medir en trazas. |
| 15.6 | Respuesta duplicada si el proceso muere entre "Meta aceptó" y "marcar procesado". | Baja | §5. | Registrar el `wamid` saliente en el estado antes de marcar; documentar como riesgo residual. |
| 15.7 | `enviarTexto` sin timeout en el camino del agente: Meta colgado = función colgada hasta 120 s. | Baja | `lib/whatsapp.ts` (el `signal` es opcional y el sender no lo pasa). | `AbortSignal` con plazo en el sender del nuevo tipo. |
| 15.8 | Cambios en `config.ts`/`webhook.ts` pueden **romper a Delacour** (producción). | Media | Código compartido. | Cambios aditivos + suites existentes intactas + tests de no regresión por tipo. |
| 15.9 | Cupo mensual de IA del plan: al agotarse, silencio (antes del agente). | Media | `dentroDelCupoIA`. | Confirmar plan de Publi Bordados y su tope. |
| 15.10 | Historial ambiguo "Publibordados": ya hubo un tenant con ese nombre en Flow. | Media | Commits `838e7a3`, `f9be63b`. **[VERIFICAR EN BD]** | Confirmar si "Publibordados web" es el mismo tenant u otro; nunca reutilizar su Flow ni su config. |
| 15.11 | `contact_ref` = SHA-256 truncado de `wa_id` **sin sal**: seudonimización débil (los teléfonos se pueden enumerar). | Baja | `lib/catalogo/pedidos/log.ts`. | No agravarlo: no guardar más datos personales en trazas; evaluar sal por entorno a futuro (fuera de alcance). |
| 15.12 | Migraciones manuales (`PENDING_MIGRATIONS.md`): código desplegado antes que su migración. | Media | Historial de despliegues. | El código nuevo debe degradar a "sin agente" o fail-closed si falta su tabla (patrón ya usado en `config.ts`). |
| 15.13 | Ventana de 24 h de WhatsApp: seguimientos proactivos requieren plantillas aprobadas. | Baja | Política de Meta. | Fase 1 solo responde; sin seguimientos proactivos. |

## 16. Información que necesitamos antes de comenzar

**Datos (consultas de solo lectura, sin columnas secretas):**
1. Fila de `dulabs_clientes_config` del +57 301 291 3038: `id_tenant`, `phone_number_id`,
   `ia_pausada`, `ia_restringida_a`, `flow_activo`, `captura_leads`, `forward_to_dumo`,
   `prompt_sistema` (¿null o `''`?), `estado_conexion`.
2. ¿Tiene fila en `dulabs_agente_runtime_config`? ¿Otros números en el mismo tenant (Flow)?
3. ¿Ya hay respuestas con `origen = 'ia'` en `dulabs_mensajes_log` para ese número?
4. Plan del tenant y cupo mensual de mensajes de IA.

**Negocio (Publi Bordados):**
5. Regla de 6 unidades: con `cantidad ≥ 6`, ¿se traspasa **en cuanto** se sabe, o después de
   tener tipo de cliente + nombre + producto? ¿Y con `cantidad < 6` (detal)? ¿Traspaso también,
   un mensaje informativo, o cierre?
6. "Empresa": ¿se pide el nombre de la empresa además del de la persona?
7. "Otros": ¿se pide describir el producto (texto libre) o basta la categoría?
8. ¿Hay datos que el agente pueda responder (horarios, ubicación, tiempos de entrega, "¿hacen
   bordado 3D?")? ¿O toda pregunta fuera de las tres se traspasa?
9. ¿Quién atiende el traspaso y desde dónde: el **Inbox de DuLabs** (Mensajes) o el celular en
   coexistencia? ¿Horario de asesoras y qué decir fuera de horario?
10. Mensaje de saludo, tono y nombre del agente; emojis de las opciones (🧢 👕 🦺 🧵) sí/no.
11. ¿Qué hacer cuando el cliente manda una **foto del logo** o un **audio** (ver 15.2)?
12. ¿Un cliente que ya fue calificado y vuelve días después empieza de cero o se le recuerda?

**Técnicas (decisiones para validar, ver propuesta):**
13. Proveedor de IA: Gemini vía el contrato existente (cero adaptadores nuevos) o agregar el
    adaptador de Claude al contrato antes de empezar.
14. Aprobación de los cambios estructurales: nuevo `tipo` (migración del CHECK), tabla de
    calificaciones, y el cambio del webhook para media (15.2).

---

## 17. Propuesta de arquitectura (para validar; sin implementar)

### 17.1 Principio

Un **nuevo tipo de agente `lead_qualification` dentro de `lib/agente`**, sobre la misma frontera,
buzón, CAS, barreras, topes, trazas y contrato de IA. El núcleo es un **motor de recopilación
configurable**; la IA solo interpreta y redacta.

```
webhook (sin cambios)
  └─ lib/agente/webhook.ts ── tipo = lead_qualification ──┐
                                                          ▼
                     buzón + turno único (reutilizado) ─► runQualificationTurn
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ 1. dedupe (recentWamids) · asesora activa (fail-closed) · topes          │
   │ 2. asksForHuman → traspaso sin modelo                                    │
   │ 3. INTERPRETAR  (IA, 1 llamada, herramienta obligatoria `registrar_datos`│
   │    con JSON Schema GENERADO desde la config)                             │
   │ 4. VALIDAR      (zod por campo: opciones cerradas, entero 1..100000,     │
   │    nombre acotado; campos desconocidos → descartados y trazados)         │
   │ 5. FUSIONAR     estado ← datos válidos (corrección explícita = nuevo     │
   │    valor + evento; contradicción = pedir confirmación, no sobrescribir)  │
   │ 6. REGLAS       motor determinista (config versionada): ¿qué falta?,     │
   │    ¿cumple condición comercial?, ¿traspaso?                              │
   │ 7. REDACTAR     (IA, 2ª llamada sin herramientas, con la DECISIÓN del    │
   │    backend como contexto confiable) → validación de la respuesta         │
   │    (no pregunta lo ya sabido, no promete precios) → si falla, plantilla  │
   │ 8. asesora activa otra vez → enviar → estado (CAS) → eventos → traza     │
   └──────────────────────────────────────────────────────────────────────────┘
```

### 17.2 Estados de la calificación (derivados/persistidos por el backend)

`collecting` → `qualified` → `handoff_requested` → (`human_active` = pausa vigente en
`dulabs_pausas_chat`, fuente única existente) → `returned_to_ai` / `closed`. Cada transición es
un UPDATE con `version` (CAS) + un evento; una transición repetida es no-op (idempotente).
`HUMAN_ACTIVE` **no** se duplica en otra tabla: se lee de `dulabs_pausas_chat` para no tener dos
verdades.

### 17.3 Datos (propuesta, a validar)

- `dulabs_agente_calificaciones`: una fila por conversación (`id_tenant`, `phone_number_id`,
  `wa_id`, `estado`, `datos` jsonb validado, `config_version`, `version`, fechas de calificado y
  traspaso). Consultable por la asesora.
- `dulabs_agente_calificacion_eventos`: `campo_registrado`, `campo_corregido`, `regla_cumplida`,
  `traspaso`, `devuelto_a_ia`… con `request_id`, `wamid`, `regla_id`, `config_version`.
  Responde "¿por qué terminó en traspaso?" con un `select`.
- Configuración del tipo: campos, opciones, reglas y mensajes en jsonb **versionado** y validado
  con zod (sin panel en fase 1).

### 17.4 Configuración inicial de Publi Bordados (ejemplo, NO en código)

```json
{
  "campos": [
    { "clave": "tipo_cliente", "tipo": "opcion", "opciones": ["persona_natural", "empresa"], "obligatorio": true },
    { "clave": "nombre", "tipo": "texto", "max": 80, "obligatorio": true },
    { "clave": "producto", "tipo": "opcion", "opciones": ["gorras", "prendas_de_vestir", "uniformes", "otros"], "obligatorio": true },
    { "clave": "cantidad", "tipo": "entero", "min": 1, "max": 100000, "obligatorio": true }
  ],
  "reglas": [
    { "id": "mayorista", "si": { "campo": "cantidad", "op": ">=", "valor": 6 }, "entonces": { "etiqueta": "mayorista" } },
    { "id": "traspaso_completo", "si": { "todos_obligatorios": true }, "entonces": { "accion": "traspaso", "motivo": "calificado" } }
  ]
}
```
(El comportamiento exacto de la regla de 6 unidades depende de la respuesta a §16.5.)

### 17.5 Decisiones que requieren tu validación antes de implementar

| # | Decisión | Recomendación | Alternativa |
| --- | --- | --- | --- |
| D1 | Base | Nuevo tipo en `lib/agente` | Motor separado (duplicaría buzón/CAS/trazas: rechazado) |
| D2 | Runtime | Nuevo `runQualificationTurn` que reutiliza módulos; **no** refactorizar `runAgentTurn` ahora | Extraer un "caparazón de turno" común (mejor a futuro, riesgo para Delacour hoy) |
| D3 | IA por turno | 2 llamadas (interpretar con herramienta obligatoria → redactar con la decisión) | 1 llamada con texto + datos (más barato, la respuesta puede contradecir la decisión) |
| D4 | Proveedor | Gemini `gemini-3.6-flash` vía contrato existente, credencial propia `GEMINI_KEY_PUBLIBORDADOS` | Adaptador de Claude al contrato (trabajo adicional + tests) |
| D5 | Persistencia | Tablas propias de calificación + eventos | Reusar `estado` jsonb de `dulabs_agente_conversaciones` (no consultable, schema de catálogo) |
| D6 | Asesora activa | Variante fail-closed solo para este tipo | Mantener fail-open (riesgo de responder con asesora activa) |
| D7 | Media entrante | Cambio acotado del webhook: registrar + evento al agente (acuse y traspaso) | Dejarlo como está (se pierden fotos de logos) |

### 17.6 Plan por etapas (siguiente paso después de validar)

1. **Arquitectura detallada** (`ARCHITECTURE.md` + `ARCHITECTURAL_DECISIONS.md`) con contratos
   JSON, schemas y migraciones propuestas.
2. **Implementación** en capas: config/validación → motor de reglas puro → estado/eventos →
   interpretación (proveedor simulado) → redacción → frontera.
3. **Testing**: la matriz del brief (orden libre, varios campos, corrección, ráfaga, duplicado,
   dos mensajes simultáneos, doble traspaso, JSON inválido, inyección, IA caída, Meta 4xx/5xx,
   BD caída) + no regresión de Delacour.
4. **QA real** con `ia_restringida_a` (solo números de prueba) sobre el número real.
5. **Producción**: fila habilitada + monitoreo por trazas y eventos.
