# Business Agent 2.0 — FASE 3: Conversation State Machine

```
MESSAGE → UNDERSTANDING (FASE 2) → STATE UPDATE (reducer) → STATE VALIDATION (Zod + Postgres) → NEXT STEP → RESPONSE PLAN
                                                                                        └→ ACTION REQUEST → (FASE 4)
```

El LLM interpreta. El backend mantiene el estado, decide la transición, decide qué falta y qué acción puede pedirse.

Código: `lib/agent-compiler/conversation/`. Migración: `supabase/migrations/20261123000000_dulabs_ba_conversation_states.sql`.

## 1. Auditoría: qué se reutiliza

| Pieza | Uso en FASE 3 |
|---|---|
| Understanding Engine (FASE 2) | Único origen de interpretación. Recibe del estado los `knownSlots`, la confirmación pendiente y la última pregunta. |
| Contratos de acción (FASE 1) | Los argumentos de cada `ActionRequest` se validan con el mismo schema Zod `llmArguments`. |
| Contrato de errores (FASE 1) | Todo rechazo sale como `{category, code, message}`. |
| Patrón del Flow Store | Concurrencia optimista `UPDATE … WHERE state_version = esperado`, `23505` en la creación, trigger `updated_at`, RLS solo `service_role`. |
| `lib/pausas-chat.ts::chatEnPausaHumana` | Pausa humana, en **solo lectura**, con las reglas existentes (incluido su fail-open ante error de lectura). |
| Spec (capabilities, scheduling, catalog, customerData) y `CAPABILITY_BACKING` | Requisitos de cada objetivo. |
| `flow-compiler.ts::bookingCreateAction` | Se exportó (sin cambiar su lógica) para elegir la acción de reserva según el proveedor. |

**Por qué no se usa `dulabs_flow_executions`:**

- Una ejecución del grafo termina al completarse, y la siguiente arranca con variables vacías.
- Su `state_version` sube en cada nodo del grafo. Compartirla haría que la máquina y el motor del grafo se generen conflictos entre sí.

La tabla nueva reutiliza el mismo patrón, pero su ciclo de vida es el de la conversación.

## 2. Estados

`NEW · COLLECTING_INFORMATION · AWAITING_CONFIRMATION · READY_FOR_ACTION · EXECUTING · COMPLETED · CANCELLED · HANDOFF_PENDING · HANDED_OFF · PAUSED · ERROR`

- `UNDERSTANDING` no se persiste: interpretar ocurre dentro de un turno atómico, con versión esperada.
- `EXECUTING` existe para que el Action Engine bloquee cambios de datos mientras ejecuta.

## 3. Eventos

**Entrada.** Son lo único que puede cambiar el estado:

- `MESSAGE_UNDERSTOOD` y `UNDERSTANDING_FAILED`, del mensaje.
- `ACTION_STARTED`, `ACTION_SUCCEEDED` y `ACTION_FAILED`, del Action Engine.
- `HUMAN_TOOK_OVER`, `RESUMED` y `TIMEOUT`, del sistema.

**Dominio.** Registran lo que ocurrió en el turno; el evento decisivo es la clave de la transición:

- Datos: `SLOT_UPDATED`, `SLOT_CORRECTED`, `ADDITIONAL_INFORMATION`, `AMBIGUITY_DETECTED`, `STALE_MESSAGE`.
- Objetivo y propuesta: `GOAL_STARTED`, `CONFIRMATION_RECEIVED`, `CONFIRMATION_IGNORED`, `REJECTION_RECEIVED`, `GOAL_ABANDONED`.
- Traspaso y acciones: `HANDOFF_REQUESTED`, `ACTION_REQUESTED`.
- Además: `MESSAGE_RECEIVED` y los eventos de entrada del sistema.

## 4. Transiciones

La tabla está en `transitions.ts::TRANSITIONS`. Es la fuente única de lo permitido: `from`, `event`, `to` y `sideEffects`.

- Los eventos del sistema que no están permitidos se **rechazan** sin tocar el estado.
- Una confirmación sin propuesta pendiente se degrada a `CONFIRMATION_IGNORED`.

Ejemplos:

| Desde | Evento | Hacia |
|---|---|---|
| `COLLECTING_INFORMATION` | datos completos | `AWAITING_CONFIRMATION`, o `READY_FOR_ACTION` si la acción no requiere confirmación |
| `AWAITING_CONFIRMATION` | `CONFIRMATION_RECEIVED` (misma propuesta y sin cambios en el mensaje) | `READY_FOR_ACTION` |
| `AWAITING_CONFIRMATION` | `REJECTION_RECEIVED` | `COLLECTING_INFORMATION` (pregunta qué cambiar) |
| cualquier estado controlado por el agente | `HANDOFF_REQUESTED` | `HANDOFF_PENDING` |
| objetivo abierto | `GOAL_ABANDONED` ("no quiero reservar") | `CANCELLED` |

## 5. Slots

**Ciclo de vida:** `KNOWN · CORRECTED · CONFIRMED · AMBIGUOUS · INVALID`. `MISSING` no se guarda: se deriva de los requisitos.

**Procedencia:** `CURRENT_MESSAGE · BUSINESS_DATA · SYSTEM · ACTION_RESULT`. `CONVERSATION_STATE` es cómo se ve un valor de un turno anterior. Un valor de `ACTION_RESULT` solo completa datos faltantes; nunca le gana a lo que dijo el cliente.

**Reglas:**

- **Corrección:** reemplaza (y conserva `previous`) si FASE 2 la marcó como explícita, o si el contexto la implica: una propuesta pendiente o la pregunta por ese dato.
- **"también / además":** agrega el valor en `additional` y no reemplaza.
- **Valor distinto sin corrección ni contexto:** el slot queda `AMBIGUOUS` con ambos candidatos y se pregunta.
- **Hora fuera de la franja que el mismo cliente pidió:** el slot queda `AMBIGUOUS` (por ejemplo, 04:30 / 16:30).
- **Mensajes fuera de orden:** un mensaje con `sentAt` anterior al del valor vigente no lo pisa.

## 6. Requisitos configurables

`requirements.ts::buildAgentRequirements(spec)` los deriva de la configuración:

| Objetivo | Requisito |
|---|---|
| booking | `service` (si el negocio usa servicios) + `date` + `time` + los campos obligatorios de `customerData` |
| rescheduling / cancellation | Solo con agenda Nylas y una política que lo permita |
| quote | Requiere la capacidad de ventas |
| order | **No soportado**: hoy no existe acción de pedidos en el runtime (`CAPABILITY_BACKING.orders.available = false`). Se atiende como cotización si el negocio cotiza; si no, el siguiente paso es `UNSUPPORTED` y se ofrece una persona |

Ninguna industria está escrita en el código.

## 7. Persistencia, concurrencia e idempotencia

**Tabla `dulabs_ba_conversation_states`:**

- Clave única `(id_tenant, phone_number_id, telefono_cliente, agent_id)`.
- `state` en jsonb, acotado a 64 KB.
- Columna `status` espejo del estado, validada por la base.
- Triggers: la clave no se puede cambiar y `state_version` solo avanza +1.
- RLS sin políticas: solo `service_role`.

**Concurrencia:** si dos turnos compiten por la misma versión, uno gana. El otro recarga el estado ganador y reprocesa, incluido el entendimiento, que depende de lo ya conocido. Hace hasta 3 intentos y luego falla cerrado.

**Idempotencia:**

- Guarda los últimos 50 `eventId` (wamid o evento del sistema).
- Un replay no llama al modelo y no escribe.
- Esto se suma al claim por wamid que el webhook ya hace antes.

**Verificación contra PostgreSQL real:** `scripts/verify-ba-conversation-states.sh` levanta un Postgres local efímero y comprueba:

- migración idempotente;
- unicidad;
- CAS;
- versión monotónica;
- clave inmutable;
- validación;
- RLS;
- concurrencia real con dos sesiones: una sola escritura gana.

## 8. Tenant isolation

- Toda carga exige la clave completa; no existe "cargar por conversationId".
- El estado cargado debe coincidir **exactamente** con la clave (tenant, conversación, contacto, agente). Si no coincide, se descarta y no se usa.
- El contexto de negocio de otro tenant o agente se rechaza.
- Nada del modelo llega al alcance, a los permisos ni a la autorización.

## 9. Handoff y pausa

- **Handoff:** `HANDOFF_PENDING` más una `ActionRequest` de `transferir_soporte`. La ejecuta el Action Engine; su éxito lleva a `HANDED_OFF`.
- **Pausa humana activa:** si se detecta al procesar un mensaje, pasa a `PAUSED` (o de `HANDOFF_PENDING` a `HANDED_OFF`). No se llama al modelo y el plan es `NO_RESPONSE`.
- **Fin de la pausa:** con el siguiente mensaje se aplica `RESUMED` y la conversación retoma con los datos intactos. Una propuesta vieja no se da por confirmada.

## 10. Siguiente paso y plan de respuesta

**`determineNextStep(state, requirements)`** devuelve uno de: `ASK_FOR_INFORMATION(slot, reason)`, `ASK_FOR_CHANGE`, `WAIT_FOR_CONFIRMATION`, `READY_FOR_ACTION(request)`, `WAIT_FOR_ACTION`, `HANDOFF`, `WAIT_FOR_HUMAN`, `COMPLETE`, `CANCEL`, `UNSUPPORTED`, `CLARIFY_INTENT`, `RESPOND`, `ERROR`.

**`planResponse`** convierte ese paso en una intención de respuesta (`ASK_FOR_SLOT`, `CONFIRM_ACTION`, `HANDOFF_MESSAGE`, …) con los datos validados que se pueden usar, **sin lenguaje**. Tras 3 preguntas por el mismo dato, el plan ofrece una persona.

## 11. Frontera con FASE 4 (Action Engine)

`ActionRequest` contiene:

- `id`: clave de idempotencia determinista;
- `action` y `contractVersion`;
- `purpose` (`lookup`, `fulfill` o `handoff`);
- `arguments`: validados contra el contrato de FASE 1;
- `constraints` y `customerData`;
- `requiresConfirmation` y `confirmationId`.

El Action Engine la ejecuta (validación, autorización, idempotencia real, ejecución) y reporta con `applySystemEvent`:

- `ACTION_STARTED` pasa a `EXECUTING`.
- `ACTION_SUCCEEDED`: un `fulfill` pasa a `COMPLETED`, un `lookup` vuelve a evaluar y un `handoff` pasa a `HANDED_OFF`.
- `ACTION_FAILED`: una regla de negocio marca el dato `INVALID` y se vuelve a preguntar; un error técnico pasa a `ERROR`.

Un resultado que no coincide con la acción pendiente se rechaza.

## 12. Integración con el runtime (pendiente, decisión explícita)

`processConversationTurn()` **no está conectado al webhook**. Hoy el Business Agent sigue atendiendo con el grafo compilado (Flow Engine).

Para que la máquina sea dueña del turno falta:

- el Action Engine (FASE 4), que ejecute las `ActionRequest`;
- la redacción: plan de respuesta → plantillas o LLM → mensaje.

Punto de integración previsto: `runtime/agent-runtime.ts::runAgentTurn`, después del Gate PRE-LLM, con la clave derivada del canal. Dependencias de producción:

- `createSupabaseConversationStateStore`;
- `createPausaChatHumanControl`;
- `understandMessage` con `createExecutorUnderstandingProvider()` (Gemini);
- `buildAgentRequirements(spec publicado)`.

**Requisito previo:** aplicar la migración `20261123000000` en Supabase.
