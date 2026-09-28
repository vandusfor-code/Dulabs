# Business Agent 2.0 — FASE 6: configuración guiada (onboarding)

```
Interfaz (preguntas humanas) ──autosave──► Borrador en servidor (revisión optimista)
                                              │
                   assembleDraft ─────────────┼──► UBM (FASE 5) ─► validar ─► compilar ─► artefacto
                   buildRuntimeSpec ──────────┘──► Spec (registro existente) ─► misma huella que el artefacto
                                                         │
                          dulabs_ba_publish_onboarding (UNA transacción): modelo + artefacto + versión activa
                                                         + versión del registro + enlace inmutable
                                                         │
                          Activación: gate FASE 1 existente (evaluateBusinessAgentActivation) + bind del número
```

Código:

- Dominio: `lib/agent-compiler/onboarding/`.
- Rutas: `app/api/business-agent/onboarding/`.
- Interfaz: `components/dashboard/business-agent/onboarding/` y `app/dashboard/business-agent/onboarding/page.tsx`.
- Migración: `supabase/migrations/20261126000000_dulabs_ba_onboarding.sql`. Se verifica en Postgres real con `scripts/verify-ba-onboarding.sh`.

## 1. Una sola fuente de verdad

La persona nunca edita JSON, capacidades ni el modelo. El borrador del onboarding es un esquema estricto de nivel humano (`draft.ts`) con estas secciones:

- negocio;
- oferta;
- citas;
- horario;
- atención;
- datos del cliente;
- tono;
- temas restringidos.

El backend deriva de ese borrador:

- **UBM** (`assembleDraft` → `draftToModel`). Las capacidades salen en orden fijo según las respuestas; los servicios y productos usan la autoridad `business_tables`, es decir, las tablas existentes del negocio y no un segundo catálogo.
- **Spec del registro** (`buildRuntimeSpec`), que es lo que sirve el webhook actual. Conserva las reglas avanzadas del agente existente (todo lo que no empieza con `onb-`).

Al publicar se exige que la huella del Spec (según el adaptador legacy) sea IGUAL a la `executionFingerprint` del artefacto. Si no coinciden, la publicación falla con `PROJECTION_MISMATCH` (BA-PUB-005).

El borrador **no puede** contener nada de lo siguiente; `.strict()` lo rechaza en cualquier nivel (tests AI 26 y 28):

- tenant o agente;
- checksum;
- versión del compilador;
- capacidades o acciones.

## 2. Estados

| Estado | Qué lo produce (`deriveOnboardingStatus`) |
|---|---|
| NOT_STARTED | Sin borrador, sin agente previo y sin publicación. |
| DRAFT | Borrador sin errores cuya preparación con datos reales todavía no se pudo evaluar. |
| INCOMPLETE | Errores de configuración o bloqueos de datos reales (readiness FASE 1), con paso, campo y código. |
| READY | Sin errores y con datos reales listos: se puede publicar. |
| PUBLISHING | Solo en la interfaz, mientras llegan las etapas reales de la publicación. |
| PUBLISHED | La publicación enlazada es la que sirve el registro y corresponde a la revisión guardada. |
| ACTIVE / PAUSED | Publicación enlazada y lifecycle FASE 1 activo o en pausa. |
| ERROR | Lifecycle FASE 1 en ERROR (la versión publicada no se puede servir o el número lo atiende otro motor). |

`pendingChanges` es verdadero si la publicación no está enlazada a la versión que sirve el registro o si su revisión es distinta a la del borrador guardado. Con cambios pendientes no se puede activar (BA-ACT-002).

## 3. Publicación (atómica)

Las etapas se transmiten en vivo y cada una corresponde a una operación real de `publishOnboarding`:

1. `review`: la revisión esperada.
2. `validate`: el ensamblado del UBM.
3. `compile`: el artefacto y el Spec.
4. `verify`: readiness con datos reales y huella.
5. `save`: la versión del registro validada.
6. `publish`: la RPC atómica.

La RPC `dulabs_ba_publish_onboarding` toma `pg_advisory_xact_lock` por (tenant, agente) y ejecuta en orden:

1. Revisión del borrador.
2. `dulabs_ba_publish_business_model` (FASE 5).
3. `dulabs_flow_publish_version` (la función real del registro).
4. Enlace inmutable.

Si falla cualquier paso, no queda nada escrito. PASS 6 lo prueba haciendo fallar el registro DESPUÉS de insertar el modelo.

Si la revisión o la versión cambió, el resultado es `draft_conflict` o `version_conflict`, que la interfaz muestra como "Esta configuración cambió en otra sesión. Actualiza antes de publicar." En cualquier error el borrador se conserva intacto.

**El runtime** (`resolveConversationArtifact`) usa el artefacto UBM solo si el enlace de la versión activa coincide con la versión de flow que sirve el registro. Si no coincide, usa el adaptador legacy del Spec servido (AI 13).

## 4. Simulación (vista previa y "Prueba tu agente")

- `ActionRequest.simulation: true` forma parte del id y del `argsHash`.
- El **servidor** fija `ActionExecutionContext.simulation`. El motor rechaza cualquier discrepancia (`UNAUTHORIZED / SIMULATION_MISMATCH`), así que el frontend no puede pedir una ejecución real desde la vista previa ni al revés.
- En simulación, una mutación confirmada devuelve `SUCCEEDED` con `simulated: true`, sin claim, sin candado y sin llamar al handler.
- Las lecturas pasan por `readOnlyHandler`, que bloquea escrituras como defensa en profundidad.
- Los stores de ejecución y de estado son efímeros y viven en memoria.
- El Gate corre antes que el runtime, igual que en producción.
- El handoff se describe; no pausa ningún chat.
- La vista previa usa el borrador **guardado** (`borrador-r{revisión}`), no lo publicado.

## 5. API (el tenant siempre sale de la sesión)

| Ruta | Método | Roles |
|---|---|---|
| `/api/business-agent/onboarding` | GET (resumen) / PUT (guardar `{expectedRevision, draft}`) | admin+agente / admin |
| `/validate` | POST | admin, agente |
| `/publish` | POST `{expectedRevision}` → NDJSON | admin |
| `/status` | GET | admin, agente |
| `/preview` | POST `{text, state}` | admin, agente |
| `/test` | POST | admin, agente |
| `/activate` | POST `{phoneNumberId}` | admin |

Todas las rutas aplican:

- `requireFlowAccess`;
- límite de tasa;
- cuerpo con claves permitidas (una clave extra devuelve 400 BA-DRF-001);
- envelope `apiOk` / `apiError` con código de soporte.

Códigos de soporte:

- `BA-DRF` (borrador);
- `BA-VAL` (validación);
- `BA-RDY` (datos reales);
- `BA-PUB` (publicación);
- `BA-ACT` (activación);
- `BA-SIM` (simulación);
- en el cliente: `BA-NET-001`, `BA-AUTH-001/002`, `BA-RATE-001`, `BA-PUB-008` (resultado desconocido por corte).

Eventos de observabilidad (`ONBOARDING_EVENTS`), que llevan solo ids, revisión, código y duración, sin datos personales:

- `onboarding_started`;
- `draft_saved`;
- `validation_failed` / `validation_passed`;
- `publish_started` / `publish_succeeded` / `publish_failed`;
- `preview_started`;
- `activation_started` / `activation_succeeded` / `activation_failed`.

## 6. Límites conocidos (dichos explícitamente)

- Las migraciones 20261124, 20261125 y 20261126 **no están aplicadas en producción**. Sin ellas, las rutas responden error de store (BA-DRF-003 / BA-PUB-006), nunca un falso éxito.
- La vista previa necesita `GEMINI_KEY` (entendimiento real). "Prueba tu agente" usa lecturas fijas por mensaje, y la interfaz lo dice. Sus verificaciones sí son reales: el Gate, el runtime, el motor y las llamadas registradas.
- La máquina de estados sigue controlada por `BUSINESS_AGENT_STATE_MACHINE_TENANTS`, que no se modificó. Para los demás tenants se publica el Spec del registro con la misma huella.
- Una publicación perdedora o fallida puede dejar una versión de registro en borrador (`validated`) sin publicar. No se sirve, pero ocupa una fila.
- `whenUnknown = handoff` solo ofrece una persona en el runtime de la máquina de estados.
- Los datos del cliente solo aplican cuando hay citas: el Spec exige leadCapture o agenda. La interfaz lo explica.
- El número de WhatsApp se lee de `dulabs_clientes_config` sin tocar la integración global de Meta. La activación usa el gate y el `bind` existentes.
