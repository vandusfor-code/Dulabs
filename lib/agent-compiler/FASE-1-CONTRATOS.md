# Business Agent 2.0 — FASE 1: Core Hardening & Contracts

Principio: **LLM = interpreta · backend = decide · domain = valida · action engine = ejecuta · database = persiste · integration = comunica.**

Este documento es la referencia de las fronteras que establece la FASE 1. Cada afirmación apunta al código que la implementa y al test que la verifica.

## 1. Contratos de acción

`lib/agent-compiler/contracts/action-contracts.ts` — un contrato por acción que un Business Agent puede ejecutar (10 hoy).

| Campo | Significado |
|---|---|
| `llmArguments` | **Allowlist Zod** de lo único que la IA puede proponer (tipo + tamaño). Todo lo demás se descarta. |
| `runtimeInjected` | Lo que inyecta el runtime desde el contexto autenticado: `tenantId`, `conversation.*`, `executionRowId`, `effectId`, `now`. Nunca es argumento. |
| `businessConfiguredParams` | Params que el compilador embebe en el nodo (horario, datos requeridos, fuentes…). Ganan siempre (`mergeParams`). |
| `reads` / `outputs` | Variables que la acción lee de la ejecución / produce (RUNTIME-DERIVED). |
| `permission` / `tenantScope` | `runtime_internal` (solo `InternalActionExecutor` con `context.internal`) / `runtime_context`. |
| `sideEffects`, `idempotency`, `timeoutMs`, `errors` | Declarados por acción. El timeout efectivo hoy es el global de `executor-framework.ts` (30 s); aplicarlo por acción es FASE 4. |

**Aplicación:** `lib/agent-compiler/contracts/argument-policy.ts` implementa `ProposalArgumentPolicy` (`lib/flow/ai-runtime/ai-proposal-bridge.ts`). El orquestador la recibe como dependencia opcional (`proposalArgumentPolicy`) y **solo el runtime de Business Agent la pasa** (`atender-business-agent.ts`). Flow Studio y los flows de otros productos no cambian.

| Caso | Resultado |
|---|---|
| Campo fuera del contrato | Se descarta (`not_in_contract`) |
| Campo que choca con una variable protegida | Se descarta (`protected:<categoría>`) |
| Valor inválido para el contrato | Se rechaza la propuesta (`VALIDATION_ERROR` → rama de fallo del nodo) |
| Acción sin contrato / tenant ausente | Se rechaza (`SECURITY_REJECTED`) |

Cada decisión deja un evento `[business-agent.action-contract]` (tenant, flow, versión, ejecución, nodo, acción, versión del contrato, resultado, claves descartadas, categoría de error; **nunca valores**) y la traza queda en `dulabs_flow_effects.raw_payload.argumentPolicy`.

Tests: `lib/agent-compiler/contracts/contracts.test.ts`.

## 2. Variables protegidas

`lib/agent-compiler/contracts/variable-policy.ts` — clasificación derivada del **flow compilado** (no de listas a mano):

| Categoría | Origen | ¿La IA puede escribirla? |
|---|---|---|
| USER_CONTROLLED | `question` / `buttons` / `save_data` (lo que dijo el cliente y el sistema capturó) | No |
| BUSINESS_CONFIGURED | params estáticos de las acciones | No |
| RUNTIME_DERIVED | salidas de acciones con contrato, canal (`telefonoCliente`, primer mensaje) | No, salvo la sugerencia de la **propia** acción que la produce |
| SYSTEM_INTERNAL | `__*`, tenant, flow, versión, ejecución, efecto, número… | No (**todo flow**, `lib/flow/ai-runtime/protected-variables.ts`) |

La capa SYSTEM_INTERNAL es global: antes de la FASE 1 la IA podía sobrescribir `__dulabsAiBudget` (su propio presupuesto), `__verifiedResults` (la evidencia) o `__firstMessageText` en cualquier flow.

## 3. Contrato de errores

`lib/agent-compiler/contracts/errors.ts` — 8 categorías: `USER_ERROR`, `BUSINESS_RULE_ERROR`, `VALIDATION_ERROR`, `AUTHORIZATION_ERROR`, `TENANT_ERROR`, `EXTERNAL_SERVICE_ERROR`, `AI_OUTPUT_ERROR`, `INTERNAL_ERROR`. Traduce las clasificaciones del Flow Engine sin reemplazarlas. Hacia afuera solo viaja `{category, code, message}`; el detalle real se registra internamente. Usado en: política de argumentos, trazas del runtime (`errorCategory`) y gate de activación.

## 4. Prohibiciones y traspasos

- El IR conserva `description` de prohibiciones y traspasos (`ir.ts`, `compile.ts`).
- Las reglas del Gate llevan `semantic.description` normalizada (sin saltos de línea ni caracteres de control, ≤300) — `guardrail-gate.ts::normalizePolicyText`.
- El clasificador de producción recibe **una línea por política** (`- <id>: <significado>`) y solo puede devolver etiquetas descritas (`ports.ts::buildClassifierInstruction`). Una regla semántica sin contenido no se envía (no se adivina).
- Versiones publicadas antes de la FASE 1 se completan desde el Spec de la misma versión (`withSemanticContent`), sin recompilar.
- **Demostración verificable:** `contracts/policy-manifest.ts` compara Spec ↔ reglas que sirve el runtime. Una regla sin camino al runtime bloquea la publicación (`POLICY_NOT_IN_RUNTIME`). El manifiesto viaja en `GET /api/business-agent/readiness` (`policyManifest`).
- **Limitación documentada:** una prohibición descrita solo con palabras (sin condición) se aplica con un clasificador de IA. No es 100 % determinista. La evaluación con intención/slots estructurados es la FASE 2.

Tests: `lib/agent-compiler/contracts/policies.test.ts`, `runtime/guardrail-gate.test.ts`.

## 5. Reglas informativas

| ¿Se almacena? | ¿Se compila? | ¿Llega al runtime? | ¿Se aplica? |
|---|---|---|---|
| Sí (Spec) | Sí (`ir.rules`) | Sí — `ResolvedBusinessAgent.informationalRules` (normalizadas) | **NO IMPLEMENTADO** (`enforcement: "not_enforced"`) |

La UI ya no promete que funcionan (Wizard) y la readiness avisa `INFORMATIONAL_RULES_NOT_ENFORCED`. Su aplicación (grounding o reglas de diálogo) corresponde a FASE 2/3.

## 6. Activación y estado

- `lifecycle/activation-gate.ts` (solo flows que **son** Business Agent): número del tenant → versión publicada servible (validada + checksum) → readiness con datos reales → plan activo → ningún otro motor en el número. Aplicado en `/api/flows/[id]/activate` antes de escribir.
- Rollback pasa por la misma readiness que publicar.
- `lifecycle/lifecycle.ts`: estado derivado `DRAFT · CONFIGURED · PUBLISHED · ACTIVE · PAUSED · ERROR` en `GET /api/business-agent` (campo `lifecycle`, aditivo). No reemplaza los estados existentes; es la capa sobre la que se construye la state machine de FASE 3.

## 7. Frontera única del runtime y precedencia de motores (estado actual, sin cambios en esta fase)

Punto de entrada real del Business Agent: `app/webhook-dulabs/route.ts::intentarBusinessAgentSiAplica` → `lib/agent-compiler/runtime/production/atender-business-agent.ts::atenderMensajeConBusinessAgent`.

Orden en `atenderMensaje` (el primero que atiende gana):

1. Dedupe atómico por wamid (`dulabs_mensajes_log.procesado_at`) y lista negra del número.
2. Migración AMORE (por `phone_number_id`).
3. Sesión de encuesta activa → bot de encuestas.
4. Lead de campaña → bot de campañas.
5. Soluciones Financieras (por `phone_number_id`).
6. Sesión de onboarding post-pago.
7. `ia_pausada` → silencio. `ia_restringida_a` → solo remitentes autorizados. Pausa humana por chat → silencio. Cupo mensual de IA agotado (o sin plan) → silencio.
8. Espera de ráfaga (2,5 s) + candado por chat.
9. **Agente conversacional** (`lib/agente`): si el número tiene CUALQUIER fila en `dulabs_agente_runtime_config` (aunque esté apagada), es dueño del mensaje.
10. Si `flow_activo && flow_id` (y no aplica el piloto de Daniela):
    - **Business Agent**: si el flow tiene una versión del Registry publicada → atiende (o falla cerrado).
    - Si no es Business Agent → Flow hecho a mano (`atenderMensajeConFlowConFallback`) → si no atiende, sigue.
11. Legacy: agenda IA (`resolverContextoMensaje` modo agenda) → Daniela → especialistas → bot legacy por prompt (`prompt_sistema`).

Cambios de la FASE 1 en esta cadena:
- Un Business Agent real con checksum alterado, no validado o de otro tenant ahora **falla cerrado** (antes caía al paso 10b, sin Gate ni contratos).
- Número sin `id_tenant` → falla cerrado.
- La activación bloquea el conflicto con el paso 9.

La unificación en un router declarativo corresponde a FASE 2/3.

## 8. Idempotencia (análisis) y brechas para FASE 4

| Operación | Protección actual | Riesgo |
|---|---|---|
| Mensaje entrante duplicado | Claim atómico por wamid + `dulabs_flow_events` (event_id = wamid) + claim opcional en `runAgentTurn` | Cubierto (tests: `agent-runtime.test.ts` #11) |
| Crear cita Nylas | `ejecutarConIdempotencia` por `(ejecución, efecto)` + huella | Replay cubierto (`nylas-generic-booking.test.ts` #9). **Brecha:** dos clientes distintos pueden reservar el mismo cupo entre la consulta y la creación (sin bloqueo por cupo) → FASE 4. |
| Reprogramar cita | Clave por efecto | Igual que arriba para el nuevo cupo → FASE 4. |
| Cancelar cita | Idempotente por estado | Cubierto. |
| Agendar con especialistas (`internal`) | Solo el dedupe del webhook | **Brecha** declarada en su contrato (`upstream_dedupe_only`) → FASE 4. |
| Traspaso a humano | Idempotente por estado (pausa) | Cubierto. |
| Envío de WhatsApp | Reintentos con backoff por clasificación | Un reintento tras un envío que Meta aceptó pero no confirmó puede duplicar el mensaje → FASE 4. |

## 9. Decisiones que no se tomaron en esta fase

- **Suscripciones manuales sin vencimiento** (`planDelTenant` solo mira `estado = 'activa'`; el cron excluye las que no tienen fuente de pago en Wompi). Corregirlo afecta a clientes reales en producción (período de gracia, aviso, corte): requiere una decisión de negocio.
- **Timeout por acción**: declarado en el contrato; aplicarlo es FASE 4.
- **Vista previa real** (mismo runtime, sin efectos): FASE 6. Hoy la vista previa es simulada y lo dice.
