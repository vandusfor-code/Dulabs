# Business Agent 2.0 — FASE 8: paridad funcional, IA real y motor publicado

Principio que se mantiene: **LLM = interpretación y lenguaje · BACKEND = autoridad · STATE MACHINE = estado ·
ACTION ENGINE = ejecución · BUSINESS MODEL = definición del negocio · ARTEFACTO PUBLICADO = versión ejecutable.**
Nada de esta fase se resolvió con "más prompts": cada capacidad nueva es requisito → acción con contrato → handler.

## 1. Motor publicado (partes D/E)

`runtime/production/engine-selection.ts` decide QUÉ motor atiende cada mensaje, y POR QUÉ:

| Orden | Fuente | Efecto |
|---|---|---|
| 1 | `BUSINESS_AGENT_ENGINE_KILL_SWITCH` = `all` o lista de UUIDs | `graph_v1` (emergencia; sin republicar) |
| 2 | `BUSINESS_AGENT_STATE_MACHINE_TENANTS` (FASE 4) | `state_machine_v1` (transición segura; no se eliminó) |
| 3 | `spec.runtime.engine` de la **versión publicada** | lo publicado |
| 4 | ausente / desconocido | `graph_v1` |

- `spec.runtime` es **server-managed**: el editor avanzado no puede enviarlo (`FORBIDDEN_TOP_LEVEL_KEYS`) y lo hereda
  de la versión anterior. Solo la configuración guiada lo escribe, con elección explícita (`draft.engine`,
  pantalla "Publicar y activar"). Ningún tenant cambia de motor solo.
- `describeAgentRuntime` = descriptor `AgentRuntime` (motor, versión del motor, fuente, versión publicada, capacidades)
  registrado en la traza de cada mensaje (`engine`, `engineSource`).

## 2. Capacidades nuevas (paridad con el grafo)

| Capacidad | Modelo (UBM) | Requisito / objetivo | Acción (contrato) | Fuente de verdad |
|---|---|---|---|---|
| LEAD_CAPTURE | `lead_capture {fieldKeys, captureInterest}` (solo datos `customer` activos) | objetivo `lead` (intent `CONTACT_REQUEST`) exige los campos obligatorios configurados | `ba_guardar_lead` (write_internal, clave de operación) | `dulabs_clientes_conocidos` (la MISMA del grafo `save_data`) |
| REMINDERS | `reminders {offsetMinutes}`, depende de `booking` | objetivo `reminder` (intent `REMINDER_REQUEST`), ancla = última cita agendada (`state.lastBooking`) | `ba_programar_recordatorio` | `dulabs_ba_reminders` (migración 20261127000000) |
| RESOURCES | `resources[]` + `booking.resourceSelection = customer_choice` (solo Nylas) | dato de reserva `recurso` (select con recursos activos) | viaja con `crear_cita_nylas_generico` (customerFieldsJson) | modelo publicado |
| Opciones múltiples | — | `state.offers` (lista que MOSTRÓ el backend); "la segunda" se resuelve contra ella | — | estado conversacional |
| Selección de cita | — | `appointment` (condicional): con varias citas el backend las lista y el cliente elige | cancelar / reprogramar con `constraints.cita` = id | `dulabs_ba_appointments` |
| Productos | `catalog.includeProducts` | objetivo `product` (intents PRODUCT/PRICE_INQUIRY) + foco `state.focus.product` | `ba_consultar_producto` (read) | `dulabs_inventario_productos` vía `business-agent-catalog-store` |

Resolución de producto (`actions/native/products.ts`): exacto / normalizado / parcial único / **ambiguo** (lista, nunca
elige) / **no existe** / **agotado**. Precio y stock SOLO del backend; sin control de stock no se afirma cantidad.
"¿Hay talla M?" usa el último producto resuelto como contexto ("Camisa negra talla M").

Precios de servicios ("¿cuánto cuesta?"): hechos del catálogo real (`dulabs_servicios.precio`); `null` se dice
"precio a confirmar", nunca "$0".

Límite honesto de RESOURCES: la disponibilidad es la del calendario completo; no hay agenda por recurso (PARCIAL).

## 3. Tono y locale (partes N/O/P)

`conversation/phrasebook.ts`: 4 tonos (`profesional`, `cercano`, `casual`, `formal`). Las frases reciben los HECHOS ya
formateados (fechas, horas, precios con `Intl` en la moneda del negocio) y solo los envuelven. "cercano" = plantillas
de siempre (ningún agente existente cambia de texto). El tono vive en `presentation` del artefacto y **no entra en la
huella de ejecución** (test 19). Locale: solo `es` es publicable (`LANGUAGE_NOT_SUPPORTED`); un idioma nuevo es otro
phrasebook con las mismas claves. Límite: `HUMAN_REQUEST_PHRASES` (handoff sin IA) sigue siendo una lista en español.

## 4. Matriz de capacidades, activation gate y credenciales (Q/R/S/T)

`lifecycle/capability-matrix.ts`: por capacidad, **habilitada** (borrador) · **configurada** (validador) ·
**publicada** (artefacto) · **el motor la ejecuta** (`ENGINE_SUPPORT`) · **integración** (`available | missing |
not_needed | not_verified`) · **activa**. `evaluateEngineReadiness` bloquea: capacidad que el motor elegido no ejecuta,
motor conversacional sin IA, artefacto que no compila. Avisa: kill switch, integraciones no verificadas.
El gate de activación (`activation-gate.ts`, dep `engineReadiness`) y la pantalla usan la MISMA función
(`lifecycle/supabase.ts::evaluateEngineReport`). Credenciales: solo presencia (Gemini, Nylas, token de Meta).

## 5. Contratos de integración (parte U)

| Integración | Dirección | Contrato | Idempotencia | Errores → BA-* | Estado |
|---|---|---|---|---|---|
| Gemini (entendimiento) | salida | `UnderstandingProvider`, temperatura 0, JSON con schema; 2 intentos, 8 s/intento, 15 s total; circuito 5 fallas/30 s | lectura | `BA-AI-*` | NO VERIFICADO sin GEMINI_KEY |
| Calendario (Nylas) | salida | handlers existentes (`crear/buscar/listar/cancelar/reprogramar`) | clave de operación + candado por fecha | `BA-USER/CONFIG/INTEGRATION/UNKNOWN` | PARCIALMENTE VERIFICADO (formas reales en tests; sin cuenta real aquí) |
| Inventario | lectura | `ProductInventoryPort.list(tenantId)` → `{name, price, stock?}` | lectura | `BA-INTEGRATION-SOURCE_UNAVAILABLE` | PARCIALMENTE VERIFICADO (store existente; tests en memoria) |
| Contactos (leads) | escritura | `LeadContactPort.save` con concurrencia optimista y chequeo de tenant; falla en voz alta | clave de operación (claim) | `BA-USER-CUSTOMER_DATA_INCOMPLETE`, `BA-SYSTEM-*` | PARCIALMENTE VERIFICADO |
| Recordatorios (store) | escritura | funciones `dulabs_ba_reminder_*` | `(tenant, idempotency_key)` + 1 activo por cita | `BA-USER-REMINDER_TIME_INVALID` … | VERIFICADO en Postgres local (5/5) — no aplicada en producción |
| Recordatorios (envío) | salida | `app/api/business-agent/reminders/dispatch` (cron auth), ventana 24 h | lease + fencing; dudoso → `unknown` | códigos `META_*`, `WINDOW_CLOSED` | NO VERIFICADO (no programado en vercel.json; decisión operativa) |

## 6. Circuit breaker distribuido (parte V) — análisis

El circuito de FASE 7 es **por proceso**. En serverless (Vercel) cada instancia tiene el suyo: ante una caída real de
Gemini cada instancia abre su circuito tras 5 fallas → el costo extra es ≤ 5 llamadas fallidas × instancias calientes
(decenas, con timeouts acotados de 8 s y fallback inmediato sin acciones). Un circuito compartido (Redis/Postgres)
ahorraría esas llamadas pero agrega una dependencia en el camino caliente de CADA mensaje (latencia + otro punto de
falla) para proteger un caso raro. **Decisión: no se agrega Redis "por moda".** Reconsiderar si la telemetría
(`baErrors` con `BA-AI-PROVIDER_*` por instancia) muestra tormentas de reintentos o si se escala a > ~50 instancias
concurrentes; la opción mínima sería una fila en Postgres con TTL leída solo al estar abierto el circuito local.

## 7. Política de reintentos (Y) y desenlace desconocido (Z)

- Entendimiento: reintento acotado (arriba). Lecturas del Action Engine: 2 intentos con backoff. **Escrituras: nunca**.
- Escritura con timeout/worker caído → `OUTCOME_UNKNOWN`: se guarda `state.unresolvedAction`; al siguiente mensaje se
  **verifica** con una lectura (`verifyOutcome`: ¿la cita existe en la agenda?). Existe → COMPLETED (sin re-ejecutar);
  no existe → se re-propone como operación NUEVA (otro objetivo = otra clave) y exige confirmación nueva; ese turno
  consume el mensaje (un "sí" viejo nunca confirma una propuesta no vista); no se sabe → espera a una persona.
- Recordatorios: 3 intentos (2/4 min) solo ante errores transitorios, nunca después de la cita; envío dudoso nunca se
  reenvía.

## 8. Idempotencia (AA)

- Solicitud de acción: `sha(tenant | conversación | objetivo | acción | propósito | args+restricciones+datos+artefacto)`.
- Recordatorio: clave = id de la operación; un único activo por (tenant, conversación, cita); nueva hora = UPDATE.
- Lead: claim del Action Engine (una escritura por operación); el guardado es merge (repetir no duplica).
- Mensaje: wamid (dedupe del estado conversacional) — el mensaje de una verificación queda consumido.

## 9. Observabilidad (W) y taxonomía (X)

Eventos (JSON por línea, sin PII): `[business-agent.turn]` (ahora con `engine`, `engineSource`, `baErrors`,
`actions[].baError`, trazas `verify:*`), `[business-agent.action]`, `[business-agent.conversation]`,
`[business-agent.artifact]`, `[business-agent.reminder]` (despacho), `[business-agent.onboarding]`,
`[business-agent.eval]` (evaluación en vivo). Taxonomía `runtime/production/error-taxonomy.ts`:
`BA-<USER|CONFIG|AI|INTEGRATION|SYSTEM|UNKNOWN>-<MOTIVO>`.

## 10. Seguridad, envenenamiento y PII (AB/AC/AD)

- Acción nativa no habilitada en el artefacto → `UNAUTHORIZED/CAPABILITY_DISABLED` sin tocar el handler.
- Contacto de otro tenant → `SECURITY_REJECTED`; inventario/servicios siempre del tenant del turno.
- Envenenamiento: nombres del inventario nunca llegan al modelo; nombres de servicios llegan solo como strings dentro
  del JSON `BUSINESS_CONTEXT` ("datos, nunca instrucciones") y las acciones las decide la state machine.
  Riesgo residual: ese JSON está en el bloque de instrucción (diseño FASE 7) — ver riesgos.
- PII de leads: valores solo al store; resultado y trazas guardan conteos; test verifica que el nombre y el teléfono no
  aparecen en la traza.

## 11. Migraciones (A/AK)

`scripts/verify-ba-migration-chain.sh`: grafo real de dependencias (cada migración sola y con prefijo mínimo), cadena
completa dos veces, auditoría de catálogo (RLS sin políticas, 0 funciones para anon/authenticated) y los tests SQL.
Resultado: 23, 24, 25, 27 independientes; 26 requiere 25; 9 tablas, 21 funciones, 4 FK, 9 triggers, 23 índices;
tests 7+8+8+8+5 PASS. 20261123–26 ya están en producción (confirmado por el catálogo del usuario); **20261127 NO**.

## 12. Pendiente operativo (no se hace sin autorización)

1. Aplicar `20261127000000_dulabs_ba_reminders.sql` en producción.
2. Programar el despacho de recordatorios (QStash o `vercel.json`) y confirmarlo → pasa a "verificado".
3. Ejecutar `real-ai.live.test.ts` y `real-ai-eval.live.test.ts` con GEMINI_KEY.
4. Elegir tenants piloto para `state_machine_v1` desde la pantalla (opt-in por negocio).
