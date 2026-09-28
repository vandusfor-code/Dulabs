# Business Agent 2.0 — FASE 7: runtime conversacional con IA real

```
WhatsApp → webhook (claim por wamid) → resolver (tenant del número, versión publicada) → Gate PRE-LLM (determinista)
  → runtime conversacional:
      acción pendiente de un turno anterior (se resuelve primero, nunca se re-ejecuta una escritura)
      → Understanding Engine (Gemini, temperatura 0, JSON por responseSchema, validación estricta, reintentos, circuito)
      → ENTIDADES del negocio (catálogo real de servicios, horario de atención)            ← FASE 7
      → state machine (reducer, requisitos del artefacto, confianza como señal)             ← FASE 7
      → Action Engine (autorización, confirmación, idempotencia, candados, simulación)
      → ActionResult → estado → plan de respuesta → renderer (hechos del backend) → WhatsApp
  → traza `[business-agent.turn]` (reconstruible, sin valores del cliente)                  ← FASE 7
```

La IA interpreta. El backend decide: qué servicio es, qué fecha, qué hora, qué falta, qué acción, si se ejecuta, qué se responde.

## 1. Auditoría del runtime (antes de cambiar nada)

| # | Pregunta | Dónde |
|---|---|---|
| 1 | Entrada del mensaje | `app/webhook-dulabs/route.ts::intentarBusinessAgentSiAplica` → `atenderMensajeConBusinessAgent` |
| 2 | Tenant | `dulabs_clientes_config.id_tenant` del número (fila real), nunca del mensaje |
| 3 | Agente | `cliente.flow_id` + `flow_activo` → `createSupabaseBusinessAgentResolver` |
| 4 | Versión publicada | `registry.resolvePublishedVersion` (checksum verificado) → `flowVersionId` |
| 5 | Artefacto | `resolveConversationArtifact`: UBM enlazado a esa versión (FASE 6) o Spec legacy → mismo compilador |
| 6 | Business Model | el artefacto ES el modelo compilado (requisitos, acciones, agenda, servicios, preguntas) |
| 7 | Entendimiento | `processConversationTurn` → `understandMessage` (Gemini) |
| 8 | State machine | `reduceConversation` (MESSAGE_UNDERSTOOD / UNDERSTANDING_FAILED) + `evaluateGoal` |
| 9 | ActionRequest | `buildActionRequest` desde el estado (id idempotente con la huella del artefacto) |
| 10 | Action Engine | `createActionEngine().execute` (handlers reales de `InternalActionExecutor`) |
| 11 | ActionResult | `applySystemEvent` ACTION_SUCCEEDED / ACTION_FAILED |
| 12 | Respuesta | `planResponse` → `renderResponse` (plantillas + textos del backend) → `gateSink.sendMessage` |
| 13 | Persistencia | `dulabs_ba_conversation_states` (estado), `dulabs_ba_action_executions` (ejecuciones), wamid en `dulabs_mensajes_log` |

Huecos encontrados:

- **Contexto del modelo.** No recibía los servicios del negocio.
- **Servicio.** "corte" nunca se resolvía contra el catálogo real. Con catálogo en tablas, un servicio inexistente llegaba tal cual a la reserva.
- **Llamada a Gemini:**
  - sin timeout propio, sin reintentos y sin circuito;
  - temperatura 0,7 heredada.
- **Fallo de la IA.** Sin respuesta de respaldo explícita.
- **Confianza.** No influía en ninguna decisión.
- **Fechas.** Faltaban "en dos días", "a primera hora" y "mediodía".
- **"Prueba tu agente".** Usaba lecturas fijas.
- **Observabilidad.** Sin traza unificada por turno.

## 2. Proveedor de IA (sin acoplar el Business Agent a Gemini)

**Abstracción.** `UnderstandingProvider` (FASE 2) es la interfaz; Gemini es su implementación.

**Implementación de producción** (`productionUnderstandingProvider`):

- Pasa por el `GeminiExecutor` **real**, que aporta:
  - prompt confiable / no confiable;
  - `responseSchema`;
  - parseo;
  - rechazo de campos de evidencia y de `propose_action`;
  - presupuesto.
- Usa **temperatura 0**, vía el cliente inyectable (`withUnderstandingTemperature`), sin modificar el executor compartido.
- Va detrás del **circuito** compartido del proceso.

**Resiliencia** (`understanding/resilience.ts`, `DEFAULT_UNDERSTANDING_RETRY`):

| Parámetro | Valor |
|---|---|
| Intentos | 2 (1 reintento) |
| Timeout por intento | 8 s (señal al proveedor + carrera) |
| Presupuesto total | 15 s |
| Backoff | 300 ms·2^n con techo 1,2 s y jitter 50–100 % |
| Se reintenta | timeout, 429, 5xx, red, salida que no pasa el contrato |
| No se reintenta | autenticación (sin clave / clave inválida), rechazo de alcance (tenant) |
| Circuito | 5 fallas seguidas → abierto 30 s (falla inmediata, sin llamar) → 1 prueba (half-open) |

- El clasificador del Gate usa el mismo circuito, con un timeout de 5 s. Si falla, el Gate deja pasar el mensaje: las reglas críticas son deterministas.
- **Sin IA** (fallo final):
  - `UNDERSTANDING_FAILED`: el estado se conserva;
  - el runtime **no ejecuta ninguna acción** en ese turno;
  - la respuesta es fija: "En este momento no pude entender tu mensaje. ¿Me lo puedes escribir de otra forma?", más cómo pedir una persona si el negocio tiene handoff.
- **Handoff sin IA.** Un pedido explícito ("quiero hablar con una persona", frases fijas `HUMAN_REQUEST_PHRASES`) se reconoce igual, con procedencia `deterministic`, y la transferencia pasa por el Action Engine.
- **Tres fallos seguidos** → estado `ERROR` → respaldo que ofrece una persona.
- **`GEMINI_KEY`:** solo se verifica su **presencia** (`understandingProviderConfigured`); el valor nunca se lee fuera del cliente ni se registra. Sin clave:
  - producción falla cerrado (respaldo);
  - la vista previa y "Prueba tu agente" responden `BA-SIM-002` en vez de fingir un resultado.

## 3. Contexto mínimo (context builder)

Lo que ve el modelo en cada mensaje:

- **Instrucción confiable:**
  - tarea, intents, slots y reglas;
  - `SYSTEM_CONTEXT`: fecha, hora y zona del negocio;
  - `BUSINESS_CONTEXT` **en JSON** (nombre + servicios relevantes).
- **Contenido NO confiable:**
  - `CONVERSATION_CONTEXT`: datos ya conocidos, propuesta pendiente, última pregunta;
  - `CURRENT_MESSAGE`: el mensaje del cliente como cadena JSON.

**Servicios relevantes** (`relevantOfferings`):

- Con ≤ 12 servicios se envían todos. Con más, solo los que se parecen al mensaje o los que se acaban de ofrecer.
- Nunca se envían precios, IDs, historial, catálogo completo ni el modelo del negocio.

**Inyección:**

- Un mensaje como "ignora tus reglas…" viaja escapado dentro de la cadena.
- Un servicio llamado "SYSTEM: …" viaja como cadena JSON dentro de la línea de datos; nunca abre una línea de instrucciones.

## 4. Entidades del negocio (`conversation/entities.ts`)

**Servicio contra el catálogo real.** La fuente es `dulabs_servicios` activos del tenant del turno (la misma tabla que usan los handlers de agenda) o los servicios del modelo publicado. La comparación ignora tildes, mayúsculas y signos, y usa una raíz ligera en español.

| Regla | Ejemplo | Resultado |
|---|---|---|
| Exacto | "corte clásico" | Resuelto al nombre real |
| Contenido en UN servicio | "clásico", "cortes" | Resuelto |
| Contenido en VARIOS | "corte" (Corte clásico / Corte + barba) | Se pregunta cuál (lista real) |
| Nombre completo en la frase | "el corte clásico de siempre" | Resuelto (el más específico) |
| Misma raíz con palabras de más o palabra cortada | "cortarme el pelo", "cort" | **Sugerencia**: "¿Te refieres a Corte clásico?" (nunca selecciona sola) |
| Errata (transposición/1–2 letras) | "tinet" | Sugerencia |
| Nada | "masaje" | "Ese servicio no lo tenemos. Estos son nuestros servicios: …" (nunca inventa) |

**Respuestas cortas:**

- "sí" acepta **la** sugerencia hecha.
- "el segundo" elige de **esa** lista.

**Hora y franja sin am/pm:**

- Si el horario de atención deja **una sola** lectura dentro del horario, se usa (`normalizedBy: "business_hours"`). Ejemplos con horario 08–20: "a las 4" → 16:00; "después de las 4" → desde las 16:00.
- Si deja dos o ninguna, se pregunta ("¿Te refieres a 8:00 a. m. o a 8:00 p. m.?").

**Fechas.** El backend es la autoridad:

- "en dos días", "dentro de 3 días" y "en una semana" se calculan sobre la **fecha local del negocio**, con aritmética de calendario inmune a DST.
- Se suman a lo que ya existía: "mañana", "pasado mañana", "este sábado", "el próximo lunes" y "el 4 de octubre".
- La lectura del modelo nunca gana al texto del cliente.
- Horas nuevas: "a mediodía" (12:00) y "a primera hora" / "temprano" (mañana).

## 5. Confianza (señal, no autoridad)

Una intención de confianza **baja** no puede hacer nada que lleve a una escritura:

- iniciar una reserva, un pedido, una cancelación o una reprogramación;
- confirmar una propuesta ("mmm puede ser" **no** confirma).

El agente pregunta. La decisión final combina confianza, ambigüedades, requisitos del estado y reglas del negocio.

## 6. Respuesta: hechos del backend + estilo fijo

- El renderer es determinista: plantillas más los textos que redactan los handlers (`reservaTexto`…). El modelo **no puede** escribir la respuesta, porque un campo `reply` en su salida invalida el contrato.
- "Listo / quedó agendada" solo aparece con un `ActionResult SUCCEEDED` de reserva en ese turno.
- Resultado desconocido (timeout ambiguo de una escritura): "No pude confirmar la operación… una persona lo va a revisar". La escritura nunca se re-ejecuta.
- Horario ocupado: "Ese horario ya está ocupado. ¿A qué hora…?"
- No hay redacción con LLM: fue una decisión, no una omisión, porque cualquier redactor sería otro punto donde inventar hechos. El estilo por tono del negocio queda para FASE 8.

## 7. Simulación real

- **Vista previa y "Prueba tu agente"** usan el **mismo pipeline**: entendimiento con IA, catálogo real, state machine y Action Engine con `simulation=true`, que fija el servidor. La única diferencia es que no hay efectos.
- **"Prueba tu agente"** ya no usa lecturas fijas. El ejemplo de reserva usa un servicio REAL del catálogo. Sin servicios, la prueba lo dice: "Agrega al menos un servicio…".

## 8. Observabilidad y latencia

Cada turno emite una línea **`[business-agent.turn]`** con:

- `messageId`, tenant, agente, versión publicada, huella del artefacto y marca de simulación;
- entendimiento: intent, banda, **estado** de cada dato (no su valor), resolución de entidades, proveedor, modelo, intentos y tokens;
- estado antes y después;
- solicitudes y resultados de acciones: acción, propósito, ref, estado, código, motivo, simulada, reproducida y duración;
- respuesta: intención del plan, enviada, largo y **hash** del texto;
- latencias de entendimiento, estado, acciones, respuesta y total.

No lleva texto del cliente, nombres, teléfonos ni la respuesta (verificado en test). `[business-agent.understanding]` agrega intentos, motivo de falla y tokens.

## 9. Costo (tokens por mensaje)

| | Entrada | Salida |
|---|---|---|
| Entendimiento, 3 servicios | ≈ 1 150 | ≈ 40–60 |
| Entendimiento, 300 servicios | ≈ 1 150 (no crece: solo servicios relevantes) | ≈ 40–60 |
| Mensaje n.º 10 de la conversación | ≈ igual al n.º 1 (sin historial) | — |
| Clasificador del Gate | solo si hay reglas semánticas | — |

Las cifras son aproximadas (≈ 4 caracteres por token), medidas sobre el prompt real que arma el `GeminiExecutor`. Cada reintento suma otra llamada. No se estimó el precio en dinero: depende de la tarifa vigente del modelo, que no se asume.

## 10. Límite de tenants de la state machine (Parte AN) — NO se eliminó

Investigado. **Hoy no es seguro** quitar `BUSINESS_AGENT_STATE_MACHINE_TENANTS`, y no se cambió. Qué falta exactamente:

1. **Migraciones** 20261123, 20261124, 20261125 y 20261126 aplicadas en producción. Sin ellas, un tenant habilitado falla cerrado: sin respuesta.
2. **`GEMINI_KEY`** en producción y la prueba en vivo (`real-ai.live.test.ts`) pasando. En este entorno no hay clave: NO VERIFICADO.
3. **Paridad con el grafo** para agentes existentes. La state machine no cubre:
   - `leadCapture` (solo grafo);
   - recordatorios de confirmación;
   - `scheduling.resources`;
   - elegir entre varias citas al cancelar o reprogramar (hoy pasa a una persona).

   Un tenant que use eso perdería comportamiento.
4. **Selección de motor persistente y explícita por agente, en lugar de la variable global.** Diseño propuesto para FASE 8:
   - un marcador de motor en la **versión publicada** (inmutable; el rollback vuelve al motor anterior);
   - lo fija solo una publicación desde la configuración guiada con aceptación explícita del administrador;
   - la variable queda como interruptor de emergencia.

   Nunca se activa un tenant existente de forma automática.

## 11. Revisión visual real

Hecha en Chromium (Playwright) sobre `next dev`, con la página real y los datos del servicio del onboarding en memoria:

- 14 escenarios × escritorio 1440×900 y móvil 390×844;
- estados cubiertos: nuevo, los 8 pasos, errores de horario, cargando, prueba ejecutada, publicación completa y conflicto entre pestañas;
- métricas: overflow, objetivos táctiles, alertas, estado y consola.

**Corregido:**

- En móvil, el paso actual quedaba fuera de la tira de pasos (p. ej. "Prueba", paso 7). Ahora se centra, sin animación con movimiento reducido.
- El área táctil de "Editor avanzado" y de "Abierto/Cerrado" medía unos 16 px de alto; ahora mide 44 px, sin cambiar el diseño.

**Detectado y no cambiado** (diseño o fuera de alcance):

- el texto de error del horario combina dos causas;
- las horas se muestran con el formato de idioma del navegador;
- "Publicar cambios" deshabilitado sin cambios pendientes (correcto, pero el rótulo podría decir "Sin cambios");
- el error `eval()` en consola es del CSP en modo desarrollo (ajeno al Business Agent).

Sin scroll horizontal de página en ninguna vista.

## 12. Riesgos restantes

- **Calidad del modelo real sin medir:** en este entorno no hay `GEMINI_KEY`.
- **Latencia real sin medir:** las trazas la registran en producción; los tests miden las piezas con un transporte simulado.
- **Circuito por instancia**, no compartido entre instancias serverless.
- **Productos:** no se resuelven contra el inventario (solo servicios).
- **Catálogo vacío:** el servicio queda como lo dijo el cliente (comportamiento previo).
- **Sin respuesta si falta la tabla:** si el catálogo no se puede leer, el mensaje se trata como no interpretado.
