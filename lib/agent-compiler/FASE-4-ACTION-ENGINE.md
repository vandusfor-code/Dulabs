# Business Agent 2.0 — FASE 4: Action Engine

```
LLM → Understanding → State Machine → ActionRequest → ACTION ENGINE
      (validar → autorizar → estado/stale → confirmación → idempotencia → candado → ejecutar) → ActionResult
      → State Machine → Response Plan → Renderer → WhatsApp
```

Código:

- `lib/agent-compiler/actions/`: motor, registro, resultado y stores.
- `conversation/renderer.ts`.
- `runtime/production/conversation-runtime*.ts`.

Migración: `supabase/migrations/20261124000000_dulabs_ba_action_engine.sql`. Verificación real: `scripts/verify-ba-action-engine.sh`.

## 1. Auditoría: qué existe realmente

| Pieza | Estado |
|---|---|
| Handlers de acciones del Business Agent | **Existen**, en `InternalActionExecutor`: Nylas (disponibilidad, crear, listar, cancelar y reprogramar citas), agenda interna (`agendar_cita_especialista`), cotización, conocimiento, catálogo y transferencia. El motor los reutiliza: no se reimplementó ninguna integración. |
| Contratos de acción (FASE 1) | Existen. El motor valida cada solicitud con el mismo `llmArguments` Zod, en modo estricto. |
| Idempotencia existente | `ejecutarConIdempotencia` (por solicitud) dentro de la reserva Nylas. **No** evita que dos clientes distintos reserven el mismo horario: verifica el calendario y crea, sin exclusión entre ambos pasos. |
| Timeouts | El framework de executors aplica un timeout global de 30 s. El motor aplica uno propio por acción, con `AbortSignal`. |
| Zona horaria | Los handlers de agenda usan un offset fijo de Colombia (`-05:00`). El motor **rechaza** agendar si el negocio tiene otra zona (`TIMEZONE_NOT_SUPPORTED`). |
| Pedidos / pagos | **No existen** en el runtime (`CAPABILITY_BACKING.orders/payments.available = false`). No hay acción en el registro. |

## 2. Registro (`actions/registry.ts`)

| Acción | Capacidad | Efecto | Confirmación | Timeout | Reintentos | Candado |
|---|---|---|---|---|---|---|
| buscar_disponibilidad_nylas_generico | scheduling (nylas) | lectura externa | no | 10 s | 2 (backoff 300 ms) | no |
| crear_cita_nylas_generico | scheduling (nylas) | **escritura** | **sí** | 20 s | 1 | `booking:<fecha>` |
| agendar_cita_especialista | scheduling (internal) | **escritura** | **sí** | 20 s | 1 | `booking:<fecha>` |
| cancelar_cita_cliente | scheduling (nylas) | **escritura** | **sí** | 20 s | 1 | no |
| reprogramar_cita_cliente | scheduling (nylas) | **escritura** | **sí** | 20 s | 1 | `booking:<fecha>` |
| calcular_cotizacion | sales | lectura | no | 8 s | 2 | no |
| buscar_conocimiento | faq | lectura | no | 8 s | 2 | no |
| listar_catalogo_servicios | catalog | lectura | no | 8 s | 2 | no |
| transferir_soporte | humanHandoff | pausa real | no | 10 s | 1 | no |

- **Cancelar / reprogramar:** se ejecutan solo si el cliente tiene **exactamente una** cita próxima. Con varias, el resultado es `APPOINTMENT_SELECTION_REQUIRED` y se ofrece una persona; elegir cuál no está implementado.
- **Configuración del negocio:** horario, datos del cliente, política y horas de pausa se leen del **flow publicado** (params que embebió el compilador), nunca del modelo. Una acción de agenda sin esa configuración no se ejecuta.

## 3. Ciclo de ejecución

1. **Validar:**
   - schema de la `ActionRequest`;
   - acción registrada;
   - contrato y versión;
   - efecto declarado;
   - argumentos estrictos: un campo extra es rechazo;
   - claves de `constraints` y `customerData`;
   - propósito.
2. **Alcance:** el estado vigente es de este tenant, agente, conversación y contacto, derivados del canal. Si no, `TENANT_ERROR`.
3. **Autorizar:** capacidad activa en el Spec publicado, con respaldo real del runtime, y proveedor de agenda correcto. Si no, `UNAUTHORIZED`.
4. **Estado vigente:**
   - la solicitud debe ser exactamente la `pendingAction` del estado;
   - recalculada desde los slots, debe dar el mismo id;
   - si no, `STALE_ACTION_REQUEST`.
5. **Confirmación:** `confirmationId` debe ser igual a hash(objetivo + argumentos). Si no, `CONFIRMATION_REQUIRED`.
6. **Zona horaria soportada** para acciones de agenda.
7. **Claim atómico** en Postgres (`dulabs_ba_action_claim`). Posibles resultados:
   - `completed` → replay del resultado guardado;
   - `in_progress` → `IN_PROGRESS`;
   - `mismatch` → `IDEMPOTENCY_CONFLICT`;
   - `unknown` → `TIMED_OUT` ambiguo.
8. **`ACTION_STARTED`:** se registra en el estado **antes** de cualquier efecto. Si el estado ya no corresponde, no se ejecuta.
9. **Candado de reserva** (`dulabs_ba_booking_lock_acquire`).
10. **Handler real**, con timeout y reintentos según la política.
11. **Resultado:** solo datos declarados, validados con `actionResultSchema`. Se cierra con fencing por intento (`dulabs_ba_action_complete`).
12. **Traza:** `[business-agent.action]` con tenant, agente, conversación (en hash), ejecución, acción, contrato, estado, intento, duración y código de error. Sin valores del cliente.

## 4. Idempotencia y concurrencia

- **Clave:** determinista, formada por tenant + conversación + objetivo + acción + propósito + argumentos. Viene de la FASE 3.
- **Una sola ejecución efectiva:**
  - La garantiza `INSERT ... ON CONFLICT DO NOTHING` dentro de `dulabs_ba_action_claim`.
  - Verificado con 12 sesiones de PostgreSQL simultáneas: 1 `claimed`, 11 `in_progress`, 1 fila.
- **Escritura con worker caído o timeout:** el desenlace es **desconocido**. Nunca se re-ejecuta: queda `TIMED_OUT` / `OUTCOME_UNKNOWN`.
  - La state machine pasa a `ERROR` y **no vuelve a proponer** la operación.
  - El cliente recibe "no pude confirmar; una persona lo revisará".
- **Lecturas:** se retoman (intento + 1) tras un lease vencido o un fallo reintentable.
- **Fencing:** `complete` exige `RUNNING` y el mismo intento. Un worker viejo no pisa el resultado de otro.
- **Doble reserva entre conversaciones del mismo negocio:**
  - El candado con lease serializa "verificar calendario → crear evento" por negocio y fecha.
  - Verificado con 12 sesiones: exactamente 1 obtiene el candado.
- **Límite honesto:** una reserva hecha **fuera** de DuLabs directamente en el calendario del negocio puede cruzarse en la ventana entre la verificación y la creación. Nylas no ofrece una creación condicional atómica, así que esa garantía no existe y no se simula.

## 5. Errores y reintentos

- **Códigos:**
  - `REJECTED` (no se ejecutó nada): `INVALID_ACTION`, `INVALID_CONTRACT`, `INVALID_ARGUMENTS`, `UNAUTHORIZED`, `TENANT_ERROR`, `STALE_ACTION_REQUEST`, `CONFIRMATION_REQUIRED`, `INVALID_STATE`, `IDEMPOTENCY_CONFLICT`.
  - Fallos al ejecutar: `BUSINESS_RULE_VIOLATION`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `EXTERNAL_ERROR`, `INTERNAL_ERROR`, `TIMEOUT`.
- **Metadatos de cada error:** `reason` (motivo estable, p. ej. `SLOT_TAKEN`), `retryable`, `ambiguous` e `invalidSlots` (el dato que el cliente puede cambiar).
- **Reintentos:** solo en lecturas, solo ante errores transitorios, con backoff exponencial y máximo 2 intentos. Las escrituras no se reintentan.

## 6. Integración con la state machine

| Resultado | Efecto en el estado |
|---|---|
| `ACTION_SUCCEEDED` | fulfill → `COMPLETED`; lookup → se re-evalúa; handoff → `HANDED_OFF` |
| `ACTION_FAILED` recuperable con dato señalado | El dato queda `INVALID` y se vuelve a preguntar. El contexto se conserva. |
| `ACTION_FAILED` recuperable **sin** dato que cambiar | `ERROR` (se ofrece una persona). No se re-propone lo mismo. |
| `ACTION_FAILED` técnico | `ERROR` |
| `ACTION_FAILED` ambiguo en una escritura | `ERROR`, y la conversación espera a una persona |

Recuperación: antes de interpretar un mensaje, el runtime resuelve cualquier acción pendiente de un turno anterior (replay del resultado o desenlace desconocido).

## 7. Integración con el webhook

La conexión está en `runAgentTurn`, **después del Gate PRE-LLM**, que sigue bloqueando prohibiciones antes de todo.

- Si el tenant está en `BUSINESS_AGENT_STATE_MACHINE_TENANTS` (lista explícita de UUID, sin comodín), `atenderMensajeConBusinessAgent` arma el runtime conversacional de producción. Ese runtime se encarga del turno en lugar del orquestador del grafo.
- Para el resto de negocios, el grafo compilado sigue igual.
- Si el motor lanza una excepción, el turno falla cerrado (`conversation_runtime_error`); nunca cae al grafo ni a LEGACY.

**Requisitos para activar un negocio:**

1. Migraciones `20261123000000` y `20261124000000` aplicadas.
2. `GEMINI_KEY` configurada.
3. El UUID del tenant en `BUSINESS_AGENT_STATE_MACHINE_TENANTS`.

## 8. Renderer (frontera de respuesta)

`conversation/renderer.ts` usa plantillas fijas más los textos que ya redacta el backend (`reservaTexto`, `cotizacionTexto`, `respuestaDirecta`). No hay LLM.

- "Tu cita quedó agendada" solo aparece con un `ACTION_SUCCEEDED` de reserva en ese mismo turno.
- Un timeout ambiguo nunca se presenta como éxito.

La redacción más natural (con LLM y grounding) es una capa posterior sobre este contrato.

## 9. Normalización horaria del Business Agent

"4:30" sin am/pm: el parser compartido (`lib/parse-hora-colombia.ts`, **no modificado**) lo lee como 04:30.

- En el Business Agent (`understanding/slots.ts`) queda **ambiguo**, salvo que la lectura del modelo esté respaldada por los números del cliente (04:30 o 16:30).
- Una hora que cae fuera de la franja que el propio cliente pidió también se aclara (FASE 3).
- Las franjas ("después de las 4", "entre 4 y 6") se conservan como franjas; nunca se convierten en una hora inventada.
