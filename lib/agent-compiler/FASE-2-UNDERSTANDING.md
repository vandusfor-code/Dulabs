# Business Agent 2.0 — FASE 2: Understanding Engine

Principio (FASE 1): **el LLM interpreta, el backend decide.** En esta fase el LLM convierte un mensaje humano en un entendimiento **estructurado, versionado y validado**. No ejecuta, no reserva, no decide disponibilidad ni cambia estado.

```
USER MESSAGE → NORMALIZATION → UNDERSTANDING (Gemini) → VALIDATION → STRUCTURED UNDERSTANDING → (FASE 3: decisión del backend)
```

Código: `lib/agent-compiler/understanding/`. Tests: `understanding.test.ts` (30 casos obligatorios + fronteras) y `real-cases.test.ts` (9 casos reales).

## 1. Auditoría: qué se reutiliza, qué queda como candidato a deprecar

| Pieza existente | Decisión |
|---|---|
| `GeminiExecutor` (EffectExecutor kind "ai", `GEMINI_KEY`) en modo `extract` | **Se reutiliza** como transporte del proveedor: API key, JSON forzado por `responseSchema`, presupuesto, chequeo de tenant, rechazo de campos de evidencia y clasificación de errores. |
| `buildAiOutputToolSchema` | Se extiende de forma **aditiva**: `extractSchema` opcional (solo modo extract), también en `ClaudeExecutor` por simetría. Sin él, todo Flow existente sigue igual (test de retrocompatibilidad). |
| Prompt builder TRUSTED / UNTRUSTED (compartido por Gemini y Claude) | Se reutiliza. La instrucción del entendimiento va en la parte confiable y el mensaje en "USER CONTENT (UNTRUSTED)". `contextConfig.includeVariables=false`: no entran variables del flujo. |
| `resolverFechaSolicitada`, `resolverHoraSolicitada`, `parseHoraColombia` | Se reutilizan para normalizar fecha y hora (el texto del cliente manda; la lectura del modelo solo se acepta si los números del cliente la respaldan). |
| `HUMAN_REQUEST_PHRASES` (Gate) | Se reutilizan como señal determinista de handoff. |
| `lib/customer-data.ts` (`WELL_KNOWN_FIELDS`, `CUSTOM_FIELD_KEY_RE`) | Se reutiliza para derivar los slots del negocio desde `spec.customerData`. |
| Contrato de errores de FASE 1 | Toda falla sale como `{category, code, message}` (`AI_OUTPUT_ERROR`, `TENANT_ERROR`, `VALIDATION_ERROR`, `USER_ERROR`, `EXTERNAL_SERVICE_ERROR`). |
| `CANCEL_INTENT_PHRASES` / `RESCHEDULE_INTENT_PHRASES` (`flow-compiler.ts`), la heurística del `"?"` en el primer mensaje y los nodos classify del grafo compilado | **Candidatos a deprecar** cuando la FASE 3 enrute por intent. Siguen activos; no se borró nada. |
| Clasificador semántico del Gate | Se mantiene: evalúa **políticas** del negocio, no intenciones. |
| `lib/agente` (agente conversacional con su propia clasificación) | **No se tocó** (proyecto de la joyería en construcción). |

**Proveedor: todo el Business Agent usa Gemini.**

- Antes de este cambio, los nodos de IA del grafo compilado (que no declaran `provider`) iban a **Claude** por el default de `ai-provider-router.ts`, y el clasificador del Gate usaba `ClaudeExecutor` directo.
- Ahora el runtime del Business Agent arma el router con `defaultProvider: "gemini"` (`atender-business-agent.ts`), y el Gate usa `createGeminiSemanticClassifier` (`ports.ts`).
- El default del router sigue siendo Claude para los demás productos (Flow Studio, etc.). Un nodo que declara su proveedor lo conserva.
- Requisito: `GEMINI_KEY` configurada en el entorno de producción. Si falta, la IA falla cerrada (`gemini_api_key_missing`, `EXTERNAL_SERVICE_ERROR`).

## 2. Contratos

- **Salida del modelo** (`contract.ts::llmUnderstandingSchema`, Zod estricto): `primaryIntent`, `secondaryIntents` (≤2), `slots[]` (`name`, `raw` literal, `value` opcional, `correction` opcional), `ambiguities[]`, `language`. El modelo nunca devuelve alcance (tenant, conversación), IDs, fechas normalizadas ni decisiones.
- **Entendimiento estructurado** (`StructuredUnderstanding`, `contractVersion: "business-agent.understanding/1.0.0"`, `taxonomyVersion: "1.0.0"`): alcance del servidor, idioma, metadata de normalización, intents con banda de confianza, slots normalizados con `change` (new/restated/corrected/conflict), slots rechazados, ambigüedades, slots faltantes, señales (unknown, handoff, confirmación, cancelación, reprogramación, corrección), contexto temporal y procedencia.

## 3. Taxonomía (18 intents, universal)

GREETING, FAREWELL, INFORMATION_REQUEST, PRODUCT_INQUIRY, SERVICE_INQUIRY, PRICE_INQUIRY, AVAILABILITY_INQUIRY, BOOKING_REQUEST, ORDER_REQUEST, CANCELLATION, RESCHEDULING, CONFIRMATION, REJECTION, COMPLAINT, HUMAN_HANDOFF, FOLLOW_UP, CORRECTION, UNKNOWN.

- `PURCHASE_INTENT` no se incluyó porque se solapa con ORDER_REQUEST y PRODUCT_INQUIRY. La fuerza de la intención se expresa con la confianza.
- Nada es específico de una industria: "corte clásico", "mesa para 4" o "talla M" son **slots**.

## 4. Slots

- **Universales:** customer_name, service, product, quantity, party_size, date, time, time_range, location, phone, email, order_reference, payment_method, notes.
- **Del negocio:** los campos personalizados encendidos de `spec.customerData`. Los campos conocidos (nombreCliente, correoCliente…) ya son slots universales.

Reglas:

- Un slot solo se acepta si su `raw` aparece en el mensaje **actual**. Si no aparece, va a `rejectedSlots` con el motivo `not_in_message`.
- Un nombre de slot fuera del catálogo del turno se rechaza con `AI_OUTPUT_ERROR`.
- La normalización es del backend:
  - Fecha anclada a "hoy" en la zona del negocio.
  - Hora y franja solo si el texto del cliente las respalda.
  - Cantidades, teléfono, correo, opción de select.
- No se resuelve contra el catálogo ni se crean IDs; eso es FASE 3.

## 5. Contexto y tiempo

- Hay cuatro capas: `CURRENT_MESSAGE`, `CONVERSATION_CONTEXT`, `BUSINESS_CONTEXT` y `SYSTEM_CONTEXT`. Cada capa trae su alcance.
- Si una capa es de otro tenant o agente, se rechaza con `TENANT_ERROR`. Si es de otra conversación o contacto, con `VALIDATION_ERROR`. En ambos casos se rechaza **antes** de llamar al modelo.
- Hay un solo reloj inyectado, que se lee una vez por turno. `businessDate` se calcula en la zona IANA del negocio (`spec.identity.timezone`, por defecto `America/Bogota`).

## 6. Validación

**parse → schema → consistencia → normalización**, sin reparaciones:

| Caso | Resultado |
|---|---|
| Salida vacía | `understanding_empty_output` |
| JSON inválido o truncado | `understanding_malformed_json` (o `understanding_provider_output_invalid` si lo detecta el executor) |
| Campo desconocido | `understanding_unknown_field` |
| Tipo incorrecto | `understanding_schema_invalid` |
| Confianza fuera de [0,1] | `understanding_confidence_invalid` |
| Intent inexistente | `understanding_unknown_intent` |
| Slot inexistente | `understanding_unknown_slot` |
| Campo de evidencia prohibido | `understanding_prohibited_field` |
| Más de 2 intents secundarios | `understanding_too_many_intents` |
| Intents duplicados | `understanding_duplicate_intent` |
| Orden de intents inválido | `understanding_intent_order_invalid` |
| UNKNOWN con otros intents | `understanding_inconsistent_unknown` |
| Confirmación y rechazo a la vez | `understanding_inconsistent_confirmation` |

## 7. Señales (nunca acciones)

- **Handoff:** lo marca el modelo, la frase determinista o ambos. El modelo no puede "olvidar" una petición explícita.
- **Confirmación y rechazo:** solo tienen `pendingRef` si el sistema dejó una confirmación pendiente. Si no, se registra la ambigüedad `confirmation_without_pending`.
- **Corrección:** reemplaza un valor solo si el modelo la marca **y** el texto contiene una expresión de corrección. Un valor distinto sin corrección es un `conflict` y no reemplaza nada.
- `merge.ts::mergeUnderstoodSlots`: lo que no se menciona **no se borra**.

## 8. Integración (FASE 3)

`understandMessage()` no está conectado al runtime. El punto de integración previsto es `runtime/agent-runtime.ts::runAgentTurn`, después del Gate PRE-LLM y antes del orquestador. Conectarlo agrega una llamada a Gemini por mensaje: es una decisión de la FASE 3.

## 9. Riesgos conocidos

- La calidad de la interpretación de Gemini real no se midió: los tests no tienen red ni `GEMINI_KEY`. Los tests prueban el backend (contrato, validación, normalización, aislamiento).
- `GeminiExecutor` no fija temperatura por nodo y el cliente usa 0,7 por defecto. Para una tarea de clasificación conviene bajarla (FASE 3).
- El `responseSchema` usa solo el subconjunto básico (type, properties, required, items, enum, maxItems). Los rangos y largos los impone Zod.
- La hora "a las 8" se resuelve a 20:00 solo con la lectura del modelo validada por los números del cliente. Queda marcada `normalizedBy: "validated_model_reading"` para que la FASE 3 decida si confirma.
- `missingSlots` es una pista por intent. La obligatoriedad real es del negocio (p. ej., una mesa de restaurante no necesita `service`).
