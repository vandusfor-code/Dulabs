# Business Agent 2.0 — FASE 5: Universal Business Model

```
Business Model (UBM) → validateBusinessModel (fail-closed) → compileBusinessModel → Artefacto publicado (inmutable)
                                                                                     → State Machine + Action Engine
Spec legacy → legacyModelFromSpec → (mismo validador y compilador) ─────────────────┘
```

Código: `lib/agent-compiler/business-model/`. Migración: `supabase/migrations/20261125000000_dulabs_ba_business_models.sql` (verificación real: `scripts/verify-ba-business-models.sh`).

## 1. Qué controla el modelo (real, no solo tipos)

| Pieza del modelo | Quién la consume en runtime |
|---|---|
| Capacidades activas | El compilador habilita acciones → el **Action Engine** solo ejecuta `artifact.actions` (UNAUTHORIZED si no está). |
| Config por capacidad | Config por **paso** del handler (`artifact.actions[a].steps`): horario, aviso mínimo, datos del cliente, política de cancelación, fuentes de conocimiento, horas de pausa. |
| Requisitos | `deriveRequirements` (única derivación) → **state machine** (qué pedir, qué acción cumple cada objetivo). |
| Servicios (autoridad `model`) | Action Engine: `SERVICE_NOT_OFFERED` antes de tocar la agenda y `duracionMin` del servicio al handler Nylas. |
| `maximumAdvanceDays` | Action Engine: `DATE_TOO_FAR` antes de tocar la agenda. |
| Zona horaria | Única fuente (`identity.timezone`): contexto del entendimiento, estado, motor. La agenda solo publica con `America/Bogota`. |
| Datos del cliente | Slots del negocio (entendimiento), requisitos, `customerFieldsJson` del handler, preguntas del renderer. |
| Handoff | Horas de pausa (handler) y mensaje (renderer). |
| Conocimiento | `fuentes` (handler) y mensaje sin respuesta (renderer). |
| `policies.unsupportedRequest` | Renderer: ofrecer o no una persona. |
| `identity.category` | **Nada** (metadato; test AI 18). |

**Solo modelado (sin efecto en runtime, dicho explícitamente):**

- `price` de servicios y productos: la cotización lee las tablas del negocio.
- `products` con autoridad `model`: catálogo y cotización no se pueden activar con esa autoridad.
- `resources`: el runtime no elige recurso; `resourceSelection: "customer_choice"` se rechaza al publicar.
- `contact` y `location`.
- `metadata`.

## 2. Validación de publicación

`PUBLICATION_REJECTED` con `{code, path, message}`. Códigos:

- **Esquema y capacidades:**
  - `SCHEMA_INVALID` (esquema estricto: un campo desconocido es rechazo);
  - `UNKNOWN_CAPABILITY`, `DUPLICATE_CAPABILITY`;
  - `UNSUPPORTED_CAPABILITY_VERSION`;
  - `CAPABILITY_CONFIG_INVALID`;
  - `CAPABILITY_NOT_AVAILABLE` (pedidos y pagos);
  - `CAPABILITY_DEPENDENCY_MISSING`.
- **Identidad:** `TIMEZONE_INVALID`, `TIMEZONE_NOT_SUPPORTED`, `LANGUAGE_NOT_SUPPORTED`, `CURRENCY_INVALID`.
- **Catálogo:** `CATALOG_AUTHORITY_CONFLICT` (sin doble verdad entre modelo y tablas).
- **Horario:** `BUSINESS_HOURS_REQUIRED`, `BUSINESS_HOURS_INVALID`, `BUSINESS_HOURS_OVERLAP`.
- **Agenda:**
  - `BOOKING_BUFFER_NOT_SUPPORTED`;
  - `RESOURCE_SELECTION_NOT_SUPPORTED`;
  - `BOOKING_POLICY_NOT_SUPPORTED`;
  - `BOOKING_WITHOUT_BOOKABLE_SERVICE`.
- **Servicios, productos y recursos:** `DUPLICATE_ID`, `DUPLICATE_NAME`, `UNKNOWN_REFERENCE`, `PRICE_CURRENCY_MISMATCH`.
- **Campos personalizados:**
  - `CUSTOMER_FIELD_INVALID`, `METADATA_INVALID`;
  - `PROTECTED_FIELD`: tenant, permisos, capacidades, autorización, acción, identidad del agente, claves reservadas del runtime.
- **Políticas:** `POLICY_REQUIRES_CAPABILITY`.

## 3. Versión publicada: conversación empezada en v17, publicada v18

- Cada solicitud de acción lleva `artifactRef`, la huella de ejecución del artefacto. La huella también entra en su identidad (id idempotente) y en el hash que se confirma.
- **Solicitud `requested` de v17 frente a un artefacto v18:**
  - El motor responde `STALE_ACTION_REQUEST / AGENT_VERSION_CHANGED` sin ejecutar.
  - La state machine la re-evalúa con v18: se vuelve a proponer y a confirmar, o se informa que ya no está disponible.
  - Un "sí" a una propuesta de v17 se ignora (`proposalStillCurrent`).
- **Solicitud `executing` de v17 (modo `resolve_only`):** nunca se vuelve a ejecutar.
  - Si ya había un resultado, se reproduce.
  - Si su desenlace es desconocido, se trata como tal.
  - Si nunca llegó a empezar, se cierra `REJECTED` sin efecto.
- **Cambios que no afectan la ejecución:** con la misma huella (nombre, categoría, descripción), las propuestas en curso siguen válidas.
- **Rollback:** `dulabs_ba_activate_business_model_version` mueve el puntero activo sin borrar historia.

## 4. Persistencia

- `dulabs_ba_business_models`: append-only, con triggers que impiden UPDATE y DELETE.
- `dulabs_ba_agent_artifacts`: append-only.
  - CHECK de que el jsonb declara el mismo tenant, agente, versión, checksum, huella y origen que las columnas.
  - FK compuesta al modelo del mismo tenant, agente y versión.
- `dulabs_ba_active_artifacts`: puntero a la versión activa.
- `dulabs_ba_publish_business_model`: candado consultivo, control optimista y `max + 1`, todo en una transacción.
- Seguridad: RLS sin políticas; solo `service_role` ejecuta las funciones.

La migración está **creada y verificada** en un PostgreSQL 16 efímero (PASS 0–9, con 12 publicaciones concurrentes). **No está aplicada en producción.** Sin ella, la carga devuelve `store_unavailable` y el turno falla cerrado solo para los tenants de `BUSINESS_AGENT_STATE_MACHINE_TENANTS`.

## 5. Legacy

- **Ruta:** Spec → `legacyModelFromSpec` → UBM → mismo validador y compilador. `buildAgentRequirements(spec)` usa la misma derivación.
- **Paridad:** la config por paso es idéntica a los params del flow compilado (test AI 21). Única diferencia: la disponibilidad de una reserva nueva ya no hereda `modoReprogramar` del nodo de reprogramación. Era un defecto de FASE 4 que hacía fallar esa consulta en producción.
- **Notas del adaptador:**
  - moneda por defecto COP;
  - `leadCapture` solo existe en el grafo;
  - `scheduling.resources` no se mapea;
  - prohibiciones, reglas y handoff por palabra clave siguen en el Gate PRE-LLM (FASE 1);
  - personalidad no usada por el renderer;
  - recordatorios de confirmación no mapeados.
