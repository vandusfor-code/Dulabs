# Agente Publi Bordados — 05 · Fase 2A: Shadow Observer

> Objetivo único: **observar** con datos reales cómo llegan a DuLabs los eventos de WhatsApp
> Coexistence del número de Publi Bordados (cliente, asesora desde el teléfono, asesora desde
> WhatsApp Web, duplicados), sin cambiar nada del comportamiento actual.
> No hay agente, ni Gemini, ni envíos, ni preguntas, ni handoff, ni `HUMAN_ACTIVE`.

---

## 1. Arquitectura

```
Meta ──POST /webhook-dulabs──► POST()
   firma · JSON
   recibidoAt = now()
   por cada change:
     ├─► [NUEVO] if (observadorPublibordadosActivo())            ← síncrono, sin I/O: lee PUBLIBORDADOS_ENABLED
     │          after(observarCambioPublibordados(change, recibidoAt))
     │             copia síncrona del change → (después de responder) ¿número con config PB habilitada?
     │             → ¿tenant de la config = tenant real del número? → extraer → clasificar → RPC dulabs_pb_observar
     │             → nunca lanza ni rechaza; errores solo al log técnico
     └─► TODO lo existente, idéntico: DuMo · historial · registro síncrono · after(procesarCambio)
   200
```

- **Cambio en `route.ts`:** 5 líneas añadidas y ninguna modificada: el `import`, `recibidoAt`, un
  comentario de dos líneas y la línea del gancho.
- **Todo lo demás** vive en `lib/publibordados/observador/`:

| Archivo | Rol |
| --- | --- |
| `observador.ts` | Interruptor maestro, caché de configuración (30 s), orquestación y garantía de "nunca rechaza" |
| `extraer.ts` | Extracción **pura** de observaciones de un `change` y clasificación de ecos por `wamid` |
| `clave.ts` | Clave de conversación (igual a la función SQL) |
| `repositorio.ts` | Única capa con Supabase: 3 lecturas + 1 RPC propia |

## 2. Tablas (migración `20261119000000_dulabs_pb_observador.sql`)

**Infraestructura existente revisada:** no hay ninguna tabla equivalente.
- `dulabs_agente_trazas` es por turno del agente de catálogo y exige `tipo in ('turn','boundary')`.
- `dulabs_mensajes_log` guarda texto y teléfonos y no registra ecos (defecto global del `04` §0).

Por eso se crean tablas propias, sin duplicar infraestructura.

| Tabla | Contenido |
| --- | --- |
| `dulabs_pb_config` | `phone_number_id` (PK), `id_tenant`, `enabled` (defecto `false`), `shadow_mode` (defecto `true`, **`check (shadow_mode)`**: en 2A no se puede configurar otro modo), `created_at`, `updated_at`. **Sin secretos.** |
| `dulabs_pb_observaciones` | Una fila por evento (ver §3). Unique `(phone_number_id, clave)`. Índices por conversación y por fecha. |
| `dulabs_pb_mensajes_enviados` | `wamid` (PK), tenant, número y clave de conversación. **Vacía en 2A**: la llenará el agente (2B) para que un eco con ese `wamid` sea `AI_MESSAGE`. |

**Funciones:**
- `dulabs_pb_observar(jsonb)`: inserción en lote, idempotente. Solo acepta filas cuyo
  `(phone_number_id, id_tenant)` tenga config **habilitada**.
- `dulabs_pb_clave_conversacion(uuid, text, text)`.
- `dulabs_pb_observaciones_purgar(int)`, con 30 días por defecto.

Todo tiene RLS sin políticas y `revoke` para `anon`/`authenticated`. Solo `service_role`.

## 3. Eventos y columnas

| `event_type` | Cuándo |
| --- | --- |
| `CLIENT_MESSAGE` | `value.messages[]` con `from` ≠ número del negocio |
| `HUMAN_MESSAGE_ECHO` | Eco cuyo `wamid` **no** está registrado como enviado por DuLabs (candidato a asesora) |
| `AI_MESSAGE` | Eco cuyo `wamid` está en `dulabs_pb_mensajes_enviados` (no ocurre en 2A) |
| `PLATFORM_MESSAGE_ECHO` | Eco cuyo `wamid` DuLabs envió por la API por otra vía (Inbox, legacy, campañas: `dulabs_mensajes_log` con origen ≠ `manual`). Respuesta directa a "¿la API genera eco?" (P4) |
| `ECHO_UNCLASSIFIED` | Eco que no se pudo clasificar (falló la consulta del registro): `classification = UNKNOWN` |
| `STATUS` | `value.statuses[]` (sent/delivered/read/failed). `metadata.origen_envio` = `pb` / `dulabs:<origen>` / `no_registrado` (este último sería la señal S5: estados de mensajes que DuLabs no envió) |
| `UNKNOWN_EVENT` | Campo del webhook no conocido (p. ej. `history`) o claves desconocidas en `value`. **Nunca se descarta en silencio.** |

**Duplicado (`DUPLICATE_EVENT`):** no se crea otra fila; se suma `entregas` y se actualiza
`ultima_recepcion_at`. Duplicado = `entregas > 1`.

**Ecos, sin suponer la forma:** se registran desde los tres lugares posibles y se guarda cuál llegó
en `array_key`:
- `message_echoes` (forma documentada por Meta);
- `smb_message_echoes` (forma que asume el webhook);
- `messages` con `from` = número del negocio.

`source` guarda el `field` del webhook tal como llegó.

**Columnas:**
- `id_tenant`, `phone_number_id`, `conversation_key`, `event_type`, `direction`
  (entrante/saliente/ninguna), `classification` (AI/HUMAN/PLATFORM/UNKNOWN) y `evidencia` (por
  qué: `wamid_en_pb_enviados`, `wamid_en_mensajes_log:<origen>`, `wamid_no_registrado`,
  `registro_no_consultado`, `eco_sin_wamid`);
- `wamid`, `related_wamid` (mensaje citado);
- `remitente` y `destinatario` (**roles**: cliente/negocio/desconocido, nunca números);
- `source`, `array_key`;
- `event_timestamp` (Meta), `received_at` (llegada al webhook), `latencia_ms`;
- `entregas`, `ultima_recepcion_at`;
- `metadata` (solo forma: `tipo`, `longitud_texto`, `interactivo`, `es_respuesta`, `reenviado`,
  `estado`, `error_codigo`, `claves_value`, `claves_desconocidas`, `sin_destinatario`,
  `origen_envio`).

## 4. Clasificación: solo evidencia estructural

- La clasificación usa **únicamente el `wamid`**, contra el registro de envíos. **Nunca** se
  usa el texto.
- No cambia ningún estado: es una observación. `HUMAN` significa "ningún registro de DuLabs
  explica este mensaje saliente"; es un **candidato** a asesora, no una decisión.
- Si la consulta del registro falla, el eco queda `UNKNOWN`: no se inventa.
- El observador **no llama** a la IA, **no escribe** `dulabs_pausas_chat` y **no** tiene
  `HUMAN_ACTIVE` (no existe en 2A).

## 5. Clave de conversación

`conversation_key = sha256("dulabs:pb:v1:" + tenant + ":" + phone_number_id + ":" + wa_id_en_dígitos)`.
- Aísla por tenant, número y cliente: la misma persona tiene claves distintas en otro número o
  tenant.
- La calcula igual la SQL `dulabs_pb_clave_conversacion`. Un vector compartido se prueba en los
  dos lados.
- No usa secreto a propósito: un operador puede encontrar una conversación desde el SQL Editor sin
  que el teléfono se guarde.
- La inclusión del `uuid` del tenant evita que alguien que solo conoce el número calcule la clave
  sin acceso a la BD.
- La del cliente sale de `from` (mensaje) o de `to` (eco), así que un eco y el mensaje del mismo
  cliente comparten la clave **si** Meta entrega el mismo número en ambos lados. El observador lo
  mide.

## 6. Idempotencia

`clave` semántica por evento:
- `msg:<wamid>`, `echo:<wamid>`;
- `status:<wamid>:<estado>` (sent, delivered y read son eventos distintos);
- `unk:<sha256 del evento>` para lo que no trae `wamid`. El hash solo sirve para deduplicar; no
  permite recuperar el contenido.

Unique `(phone_number_id, clave)` + `insert … on conflict do update set entregas = entregas + 1`
en una sola sentencia: atómico ante reentregas concurrentes de Meta.

## 7. Privacidad

**No se guarda:** texto de mensajes, nombres de perfil, teléfonos (ni del cliente ni del negocio),
ids o URLs de media, tokens ni credenciales. **Sí se guarda:** `wamid`, roles, tiempos, tipo,
largo del texto y la clave de conversación (hash). Retención: `dulabs_pb_observaciones_purgar(30)`.

**Log técnico** (Vercel): una línea por evento con `phone_number_id`, campo, tipos de evento y
contadores. Sin texto ni teléfonos del cliente.

## 8. Fail-safe

`observarCambioPublibordados`:
- toma la copia del evento de forma síncrona (una mutación posterior del webhook no la altera);
- se ejecuta en `after()` (después de responder a Meta);
- **nunca lanza ni rechaza**: tabla ausente, Supabase caído, RPC con error, payload basura, JSON
  circular o no clonable → estado `error` + línea en el log técnico.

El webhook no espera su resultado ni lo usa para nada.

## 9. Pruebas ejecutadas

| Suite | Resultado |
| --- | --- |
| `lib/publibordados/observador/observador.test.ts`: Supabase en memoria con el store **real**; red bloqueada | **17/17** |
| `app/webhook-dulabs/publibordados-observador-aislamiento.test.ts`: guarda estructural sobre el código fuente | **6/6** |
| `supabase/tests/20261119000000_dulabs_pb_observador.test.sql`: Postgres 16 local efímero; migración aplicada **dos veces** | **9/9 bloques** |
| Pruebas del webhook existentes (firma, lista negra, media, …) | Verde |
| Evidencia de routing de la Fase 0 (11 pruebas sobre `procesarCambio` real), repetida con el gancho | **11/11**: comportamiento idéntico |
| `npm run test:flow` completo | 4972/4974. Las **2 fallas son previas y ajenas**: `lib/agenda-v2/disponibilidad-cadena-real.test.ts` y `lib/amore-conversacion-matriz.test.ts` ("después de las 5"); se reproducen igual en `main` sin este cambio |
| `tsc --noEmit`, `eslint` de los archivos tocados | Limpio |

**Mapa de los tests pedidos:**

| # | Test |
| --- | --- |
| 1 | Cliente → `CLIENT_MESSAGE` con tiempos, `wamid`, clave y latencia |
| 2 | Eco sin registro → `HUMAN_MESSAGE_ECHO`; las tres formas; misma clave que el cliente. 2b: consulta fallida → `UNKNOWN` |
| 3 | Eco de un `wamid` enviado por PB → `AI_MESSAGE`; por el Inbox → `PLATFORM_MESSAGE_ECHO`; su `STATUS` relacionado |
| 4 | Duplicado → 1 fila, `entregas = 2`. 4b: sent/delivered/read = 3 eventos |
| 5 | Otro número → nada y sin llamar a la RPC. 5b: tenant distinto → nada |
| 6 | Interruptor apagado (ausente, `false`, `TRUE`, `1`) → **cero** consultas. 6b: `enabled = false` → nada |
| 7 | Tabla ausente, RPC caída, payloads basura, circulares o no clonables → nunca rechaza |
| 8 | Evento desconocido y claves desconocidas → `UNKNOWN_EVENT` |

Extra:
- **privacidad:** ninguna observación contiene texto, teléfonos ni nombre;
- **copia síncrona** (probada con mutación);
- **vector compartido con la SQL.**

Comprobación de mutación: se rompieron a propósito el interruptor, la clasificación por `wamid` y
la copia síncrona, y las pruebas fallaron en cada caso. Después se restauró el código.

## 10. ¿El observador puede modificar comportamiento existente? **NO.**

| Garantía | Prueba |
| --- | --- |
| Sin el interruptor no ejecuta nada (ni siquiera una consulta) | Test 6 (`db.requests.length === 0`); el gancho está condicionado de forma síncrona |
| No altera el flujo del webhook: su resultado no se espera ni se usa | Guarda estructural: sin `await`, sin asignación, sin `return`; solo `after(...)` |
| No puede romper el webhook | Nunca rechaza (Test 7); la copia síncrona va dentro de `try` |
| No envía, no responde, no llama IA, no pausa, no toca Flow ni agentes | Guarda estructural: imports permitidos = `node:crypto`, `@/lib/supabase`, `@supabase/supabase-js` y archivos propios; sin `fetch` |
| Solo escribe en tablas de PB | Guarda estructural: sin `insert`/`update`/`upsert`/`delete` directos; única RPC `dulabs_pb_observar`; lecturas limitadas a 4 tablas |
| No afecta a otros tenants | Test 5 / 5b; la RPC rechaza filas sin config habilitada del mismo tenant (SQL bloques 2, 4 y 5) |
| El procesamiento existente es idéntico | 11/11 de routing de la Fase 0 con el gancho presente; suites del webhook en verde |

**Único efecto con el interruptor encendido:** una lectura por `change` (con caché de 30 s) y, solo
para el número de PB, unas pocas lecturas e inserciones en tablas propias, todo **después** de
responder a Meta.

## 11. Activación y desactivación

**Precondiciones:**
1. Aplicar la migración (`PENDING_MIGRATIONS.md`).
2. Conocer el `phone_number_id` y el tenant del número (consulta C1 del `04`).
3. M1: que la app esté suscrita a `smb_message_echoes`; si no lo está, marcarlo en el panel de
   Meta.

**Activar (shadow):**

```sql
insert into dulabs_pb_config (phone_number_id, id_tenant, enabled)
values ('<phone_number_id de PB>', '<id_tenant de PB>', true)
on conflict (phone_number_id) do update set enabled = true, updated_at = now();
```

Después, en Vercel, `PUBLIBORDADOS_ENABLED=true` y redeploy.

**Desactivar:**
- `update dulabs_pb_config set enabled = false, updated_at = now() where phone_number_id = '…';`
  tarda como máximo 30 s en aplicarse, por la caché;
- o `PUBLIBORDADOS_ENABLED=false` (apaga todo PB y requiere redeploy).

**Importante:** el observador **no** cambia quién responde en el número. Si hoy responde algún
motor (legacy, Flow…), sigue respondiendo igual. Sus mensajes aparecerán como
`PLATFORM_MESSAGE_ECHO` (si Meta los hiciera eco) o como `STATUS` con `origen_envio = dulabs:…`.

## 12. Pruebas reales e interpretación

Guion (≥ 10 repeticiones donde aplique), con teléfonos internos:
- **P1:** el cliente escribe "Hola".
- **P2:** la asesora responde desde el teléfono ("Prueba asesora 001"), anotando la hora exacta.
- **P3:** lo mismo desde WhatsApp Web.
- **P4:** un operador envía desde el Inbox de DuLabs.
- **P5:** repeticiones para medir la latencia.
- **P6:** edición o borrado.
- **P7:** foto y audio.

```sql
-- ¿Qué forma de eco llega realmente?
select source, array_key, event_type, count(*), sum(entregas - 1) as reentregas
from dulabs_pb_observaciones where phone_number_id = :pid group by 1,2,3 order by 4 desc;

-- Latencia por tipo (llegada − timestamp de Meta)
select event_type, count(*),
       percentile_cont(0.5)  within group (order by latencia_ms) as p50_ms,
       percentile_cont(0.95) within group (order by latencia_ms) as p95_ms,
       max(latencia_ms) as max_ms
from dulabs_pb_observaciones where phone_number_id = :pid and latencia_ms is not null group by 1;

-- Línea de tiempo de una conversación de prueba (sin guardar el teléfono)
select event_timestamp, received_at, event_type, classification, evidencia, array_key, wamid, entregas, metadata
from dulabs_pb_observaciones
where phone_number_id = :pid
  and conversation_key = dulabs_pb_clave_conversacion(:tenant, :pid, '<wa_id del teléfono de prueba>')
order by coalesce(event_timestamp, received_at), id;

-- ¿Llegan estados de mensajes que DuLabs no envió? (señal S5)
select metadata->>'origen_envio' as origen, metadata->>'estado' as estado, count(*)
from dulabs_pb_observaciones where phone_number_id = :pid and event_type = 'STATUS' group by 1,2;

-- Eventos desconocidos
select source, metadata->'claves_desconocidas', count(*) from dulabs_pb_observaciones
where phone_number_id = :pid and event_type = 'UNKNOWN_EVENT' group by 1,2;
```

| Resultado | Lectura |
| --- | --- |
| P2 aparece como `HUMAN_MESSAGE_ECHO` con `array_key = message_echoes` | Se confirma la forma real (y el defecto global) |
| P2 **no** aparece | No hay suscripción a `smb_message_echoes` o no hay eco: **bloqueante** para 2B |
| P3 igual que P2 | Web usa el mismo mecanismo |
| P4 **sin** eco (solo `STATUS` con `origen_envio = dulabs:…`) | La API no genera eco (lo esperado) |
| P4 **con** `PLATFORM_MESSAGE_ECHO` | La API genera eco: en 2B la clasificación por `wamid` es imprescindible (ya diseñada) |
| La clave del eco (P2) coincide con la del cliente (P1) | `to` = `from` |
| La echo latency del 04 §22.1 (`T3 − hora anotada por la asesora`) | Se calcula uniendo la hora anotada con `received_at`. `latencia_ms` usa el timestamp de Meta |

## 13. Fuera de alcance (Fase 2B)

Gemini, prompts, preguntas, botones, tipo de cliente, productos, cantidad, segmento, handoff,
`HUMAN_ACTIVE`, envío de WhatsApp, catálogo y CRM.

---

# Validación real de Shadow (runbook y resultados)

## 14. Estado: la validación en producción NO se ejecutó

Desde este entorno **no hay** credenciales ni red hacia Supabase, Meta, QStash ni Vercel
(comprobado: todas las conexiones responden `000`). Además, el código **no está desplegado**:
- sigue sin commit ni push, por instrucción;
- Meta solo entrega los webhooks a la URL de producción (`…/webhook-dulabs`); un preview de Vercel
  no los recibe.

**Ninguna prueba real P1–P7 pudo ejecutarse.** No hay resultados inventados.

**Lo que sí se ejecutó:** una prueba de punta a punta **local** sobre el `POST()` **real** del
webhook:
- payload firmado con HMAC → verificación de firma → `after()` capturado → observador **y** routing
  existente juntos;
- Supabase en memoria, Meta simulado, red bloqueada;
- el número de PB con `ia_pausada = true`;
- archivo desechable fuera del repositorio, ejecutado con
  `npx tsx --experimental-test-module-mocks --test`.

Resultado: **11/11**.

## 15. Resultados

| Prueba | Resultado | Evidencia | Conclusión |
| --- | --- | --- | --- |
| P1 Cliente | **PENDIENTE (real)** · Local ✓ | E2E: `CLIENT_MESSAGE`, `wamid`, clave de conversación; el entrante sigue en `dulabs_mensajes_log`; 0 envíos a Meta | Listo para validar en producción |
| P2 Asesora teléfono | **PENDIENTE (real)** · Local ✓ con la forma de Meta | E2E: `field = smb_message_echoes`, `array_key = message_echoes` → `HUMAN_MESSAGE_ECHO`, misma clave que el cliente; el manejador existente no pausa (defecto global) | La forma real **solo** la confirma la prueba en producción |
| P3 WhatsApp Web | **PENDIENTE (real)** | Sin evidencia posible fuera de producción | Bloqueante hasta medirlo |
| P4 Duplicado | **PENDIENTE (real)** · Local ✓ | E2E: el mismo webhook dos veces → 1 fila, `entregas = 2`; SQL real (Postgres 16) bloque 3 | Controlado |
| P5 Estados | **PENDIENTE (real)** · Local ✓ | E2E: sent/delivered/read/failed → 4 `STATUS` distintos, separados de los mensajes, `origen_envio` | Diferenciados |
| P6 Desconocido | **PENDIENTE (real)** · Local ✓ | E2E: campo desconocido → `UNKNOWN_EVENT` | Visible |
| P7 Latencia | **PENDIENTE (real)** | Solo medible con tráfico real (§16.7) | Sin dato |
| IA simulada | Local ✓ | E2E: eco con `wamid` registrado en `dulabs_pb_mensajes_enviados` → `AI_MESSAGE` / `AI` | Identificable por `wamid` |
| PLATFORM | Local ✓ | E2E: eco con `wamid` enviado por el Inbox (origen `agente`) → `PLATFORM`, nunca `HUMAN` | Diferenciable |
| Aislamiento | Local ✓ · real **PENDIENTE** | E2E: tenant B → 0 observaciones, `dulabs_pb_config` intacta, su routing sigue igual; SQL bloques 4 y 5 | Por confirmar con §16.9 |
| Independencia de `ia_pausada` | Local ✓ | E2E: el observador registra con `ia_pausada` true y false; el gancho está en `POST()`, antes del routing, y solo lee `id_tenant` de `dulabs_clientes_config` | El observador no depende de ningún motor |
| Interruptor apagado | Local ✓ | E2E: `POST` idéntico y 0 observaciones | Inerte |
| Ningún mensaje automático | Local ✓ · real **PENDIENTE** | E2E: 0 envíos a Meta en todos los casos | Por confirmar con §16.10 |

## 16. Runbook para la validación real (en este orden)

> Regla general: si algo no da lo esperado, **detener → documentar el payload o la consulta →
> identificar la causa → proponer → esperar aprobación.** Sin parches sobre producción.

### 16.0 Despliegue (requiere tu autorización de push)

1. Commit + push de esta rama → PR → revisión → merge a `main`. Vercel despliega **sin**
   `PUBLIBORDADOS_ENABLED`, así que el código queda **inerte** (probado).
2. Comprobar en Vercel que la variable no existe o vale `false`. No tocar ninguna otra variable
   (`GEMINI_KEY*`, `META_*`, Flow, AMORE, Business Agent).

### 16.1 Estado real del número (solo lectura: C1, C3 y C10 del `04` §8 y §21.1)

| Dato | Consulta | Valor requerido para la prueba |
| --- | --- | --- |
| `phone_number_id`, `id_tenant`, WABA | C1 | Anotar: son las únicas fuentes de la config |
| `ia_pausada` | C1 | `true` (ver §16.2) |
| `flow_activo` | C1 | `false` |
| `forward_to_dumo` | C1 | `false`; además, en Vercel, que `DUMO_PHONE_NUMBER_ID` no contenga ese `phone_number_id` |
| `marketplace_activacion_id`, `captura_leads` | C1 | Anotar (solo aplican si `ia_pausada = false`) |
| Agente runtime (`dulabs_agente_runtime_config`) | C3 | 0 |
| Encuestas (config y sesiones), campañas (bot y leads), onboarding, especialistas | C3 | 0 en todas |
| Pausas vigentes | C3 | Anotar |
| Constantes AMORE / Soluciones Financieras | C10 | Ambas `false` |
| ¿Quién respondió en los últimos 30 días? | C4 | Anotar: si hay `origen = 'ia'`, hoy responde un bot |

### 16.2 Garantizar que nadie responda automáticamente (antes de activar)

- El observador **no responde nunca**: está probado y no depende de `ia_pausada`.
- Lo que puede responder es el **routing existente** del número. El mapa de gates está en el
  `04` §11:
  - con `ia_pausada = true` y C3 = 0, **nada** responde (probado por ejecución, R1 y E2E P1);
  - si C3 ≠ 0, la encuesta, campaña u onboarding de ese contacto responde **aunque**
    `ia_pausada = true` (R2). Hay que resolverlo antes.
- **Si C1 muestra `ia_pausada = false`**, se necesita tu **autorización explícita** para:

  ```sql
  update dulabs_clientes_config set ia_pausada = true where phone_number_id = '<pid de C1>';
  ```

  Afecta **solo** a ese número y apaga cualquier bot que hoy responda en él. La asesora atiende
  todo a mano durante la prueba. No se ejecuta sin tu aprobación.

### 16.3 Migración

Aplicar **solo** `supabase/migrations/20261119000000_dulabs_pb_observador.sql` en el SQL Editor
(es idempotente). Verificar:

```sql
select c.relname, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('dulabs_pb_config','dulabs_pb_observaciones','dulabs_pb_mensajes_enviados');
-- esperado: 3 filas, rls = true

select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'dulabs_pb_%' order by 1;
-- esperado: dulabs_pb_clave_conversacion, dulabs_pb_observaciones_purgar, dulabs_pb_observar

select has_function_privilege('anon','public.dulabs_pb_observar(jsonb)','execute') as anon_ejecuta;
-- esperado: false

select count(*) from dulabs_pb_config;  -- esperado: 0
```

### 16.4 Configuración de PB (con los valores de C1, sin suponer)

```sql
insert into dulabs_pb_config (phone_number_id, id_tenant, enabled, shadow_mode)
values ('<phone_number_id de C1>', '<id_tenant de C1>', true, true);

select phone_number_id, id_tenant, enabled, shadow_mode from dulabs_pb_config;
-- esperado: 1 fila; enabled = true; shadow_mode = true
-- (la tabla rechaza shadow_mode = false: en 2A no existe ningún modo que responda)
```

### 16.5 Meta (solo lectura; no cambiar nada sin autorización)

- **Panel:** App Dashboard → WhatsApp → Configuración → Webhook, y M1/M2/M3 del `04` §21.2.
- **Cómo leerlo:**
  - `smb_message_echoes` es el **nombre del campo de suscripción** (lo que aparece en el panel y
    en `fields` de M1);
  - `message_echoes` es el **nombre del arreglo dentro del payload** (según la documentación, sin
    confirmar).
  - No son alternativas: se espera ver `smb_message_echoes` en el panel y `message_echoes` en las
    observaciones (`source` frente a `array_key`). Anotar exactamente lo que aparezca.
- **Si `smb_message_echoes` no está suscrito:** detener y pedir autorización para activarlo (sin
  eso no llega ningún eco).
- Confirmar que el `phone_number_id` y la WABA de M2/M3 coinciden con C1.

### 16.6 Activar el observador

En Vercel, **solo** `PUBLIBORDADOS_ENABLED=true` → redeploy. Verificación:

- en los logs de Vercel, buscar `[publibordados-observador]`: con el primer mensaje debe aparecer
  una línea `phone=<pid> … eventos=… nuevas=…`;
- `select count(*) from dulabs_pb_observaciones;` crece.

### 16.7 Pruebas P1–P7 (teléfono interno T1 y la asesora)

| # | Acción | Consulta | Esperado |
| --- | --- | --- | --- |
| P1 | T1 envía "Prueba PB 001" | Línea de tiempo (§12) con el `wa_id` de T1 | `CLIENT_MESSAGE`; **ninguna** respuesta en T1 |
| P2 | La asesora responde desde el teléfono "Prueba PB ASESORA 001" y anota la hora | ídem | Una fila de eco: anotar `source`, `array_key`, `event_type`, `wamid`, `event_timestamp`, `received_at`, `latencia_ms`, `conversation_key` (igual a la de P1) |
| P3 | Igual desde WhatsApp Web, "Prueba PB WEB 001" | ídem | Comparar con P2: mismo `source`/`array_key` = mismo mecanismo |
| P4 | Duplicados reales: `select wamid, entregas from dulabs_pb_observaciones where phone_number_id=:pid and entregas > 1;` | — | Filas con `entregas > 1` y sin filas repetidas. Opcional: §16.8 |
| P5 | Estados | Consulta S5 (§12) | `STATUS` separados; anotar `origen_envio` |
| P6 | Desconocidos | Consulta de desconocidos (§12) | Anotar lo que aparezca (p. ej. `history`) |
| P7 | La asesora envía ≥ 10 mensajes a T1, espaciados | Abajo | Distribución de latencia |

```sql
-- P7: latencia del eco (llegada a DuLabs − timestamp de Meta del envío de la asesora)
select count(*) as n, min(latencia_ms), max(latencia_ms), round(avg(latencia_ms)) as promedio,
       percentile_cont(0.95) within group (order by latencia_ms) as p95
from dulabs_pb_observaciones
where phone_number_id = :pid and event_type in ('HUMAN_MESSAGE_ECHO','ECHO_UNCLASSIFIED')
  and received_at > now() - interval '1 day';
```

`latencia_ms` usa el `timestamp` de Meta, con precisión de segundos. Para "asesora escribió →
DuLabs recibió" se compara además la hora anotada por la asesora con `received_at`.

### 16.8 Pruebas sintéticas en producción (OPCIONALES, requieren tu aprobación)

Sirven para P4 bajo demanda, IA simulada, PLATFORM y P6: un POST **firmado** al webhook de
producción con formas que el manejador existente **ignora** (demostrado: E1 y E2E P2):

```bash
PID='<pid>'; DISPLAY='<display_phone_number sin +>'; T1='<wa_id de T1>'
BODY=$(printf '{"object":"whatsapp_business_account","entry":[{"id":"sintetico","changes":[{"field":"smb_message_echoes","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"%s","phone_number_id":"%s"},"message_echoes":[{"from":"%s","to":"%s","id":"%s","timestamp":"%s","type":"text","text":{"body":"sintetico"}}]}}]}]}' "$DISPLAY" "$PID" "$DISPLAY" "$T1" "$WAMID" "$(date +%s)")
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$META_APP_SECRET" | sed 's/^.* //')
curl -sS -X POST "https://<dominio>/webhook-dulabs" -H "Content-Type: application/json" -H "X-Hub-Signature-256: sha256=$SIG" --data "$BODY"
```

- **IA simulada:**
  1. `insert into dulabs_pb_mensajes_enviados (wamid, id_tenant, phone_number_id, conversation_key) values ('wamid.PBSIM-001', '<tenant>', '<pid>', dulabs_pb_clave_conversacion('<tenant>','<pid>','<T1>'));`
  2. POST con `WAMID=wamid.PBSIM-001`.
  3. Esperado: `AI_MESSAGE` / `AI`.
  4. Después, borrar esa fila.
- **PLATFORM:** enviar un mensaje a T1 desde el Inbox; tomar su `wamid` de `dulabs_mensajes_log`;
  POST con ese `WAMID`. Esperado: `PLATFORM_MESSAGE_ECHO`. Además, si Meta generara un eco **real**
  de ese envío, aparecería solo; es la respuesta a "¿la API genera eco?".
- **P4:** repetir el mismo POST. Esperado: `entregas = 2`.
- **P6:** cambiar `"field":"smb_message_echoes"` por `"field":"pb_campo_desconocido"`. Esperado:
  `UNKNOWN_EVENT`.

### 16.9 Aislamiento real

```sql
select phone_number_id, count(*) from dulabs_pb_observaciones group by 1;
-- esperado: una sola fila, el pid de PB
select count(*) from dulabs_pb_config;                                    -- esperado: 1
select count(distinct id_tenant) from dulabs_pb_observaciones;            -- esperado: 1 (el de PB)
```

La `conversation_key` incluye el tenant y el número: no puede coincidir con la de otro tenant
aunque el cliente sea el mismo (probado en la unidad y en SQL).

### 16.10 Ningún mensaje automático durante la prueba

```sql
select origen, count(*) from dulabs_mensajes_log
where phone_number_id = :pid and direccion = 'saliente' and created_at >= '<inicio de la prueba>'
group by 1;
-- esperado: ninguna fila con origen 'ia'; 'agente' solo si se usó el Inbox a propósito (PLATFORM)
select metadata->>'origen_envio', count(*) from dulabs_pb_observaciones
where phone_number_id = :pid and event_type = 'STATUS' group by 1;
-- esperado: ningún 'dulabs:ia'
```

### 16.11 Detener o revertir

- **Observador:** `update dulabs_pb_config set enabled = false, updated_at = now() where phone_number_id = '<pid>';`
  (≤ 30 s) o `PUBLIBORDADOS_ENABLED=false` + redeploy.
- `ia_pausada`, si se cambió en §16.2: volver al valor anotado en C1 **solo** con tu aprobación.
- Datos: `select dulabs_pb_observaciones_purgar(0);` borra todo lo de más de 1 día (el mínimo son
  1 día), o `delete from dulabs_pb_observaciones where phone_number_id = '<pid>';`.

---

## 17. Despliegue controlado (24-sep-2026)

| Paso | Estado | Evidencia |
| --- | --- | --- |
| Revisión de alcance | ✓ | Archivos existentes: solo **líneas añadidas** en `route.ts` (+5), `scripts/test-flow-manifest.txt` (+2) y `PENDING_MIGRATIONS.md` (sección nueva). El resto son archivos nuevos de PB. Nada de AMORE, Business Agent, Flow, Delacour, legacy, otros webhooks ni agentes |
| Commit | ✓ | `a1e48bf feat(pb): add isolated shadow observer` |
| Integración de `main` | ✓ | `7eb7a55` (merge commit, sin reescribir historia). `main` agregó `20261118000000_dulabs_catalogo_pedidos_historial.sql` (**misma versión**), así que la migración de PB se renombró a **`20261119000000_dulabs_pb_observador.sql`** (aún no aplicada en ningún entorno) |
| Revalidación tras el merge | ✓ | `tsc` 0 · `eslint` 0 · webhook + PB 74/74 · SQL 9/9 (migración ×2) · `test:flow` 4999/5001 (las 2 fallas previas de AMORE) · `next build` OK |
| Push | ✓ | `origin/claude/beautiful-fermi-xyjyui` |
| PR | ✓ | vandusfor-code/Dulabs#133 |
| Deploy a producción (merge a `main`) | Ver el informe final | El despliegue llega **inerte**: `PUBLIBORDADOS_ENABLED` no existe |
| C1/C3/C10, migración en Supabase, variable en Vercel, verificación en Meta, fila de config | **NO EJECUTADO** | Este entorno no tiene credenciales ni red hacia Supabase, Vercel ni Meta; los pasos son manuales (§16) |

## 18. Resultados reales

**No se marca nada con ✓ sin evidencia real de producción.**

| Prueba | Resultado | Evidencia | Conclusión |
| --- | --- | --- | --- |
| Cliente → DuLabs | **NO VERIFICADO** | Solo E2E local (§15) | Pendiente de §16.7 P1 |
| Asesora → DuLabs | **NO VERIFICADO** | Solo E2E local con la forma documentada | Pendiente de P2 |
| WhatsApp Web | **NO VERIFICADO** | Ninguna | Pendiente de P3 |
| Echo real (campo y arreglo) | **NO VERIFICADO** | Ninguna | Pendiente de P2/P3 + §16.5 |
| IA simulada | **NO VERIFICADO en producción** · Local ✓ | E2E local | §16.8 (requiere aprobación) |
| PLATFORM | **NO VERIFICADO en producción** · Local ✓ | E2E local | §16.8 |
| Duplicado | **NO VERIFICADO en producción** · Local ✓ + SQL ✓ | E2E local; Postgres 16 | §16.7 P4 / §16.8 |
| Latencia | **NO VERIFICADO** | Ninguna | §16.7 P7 |
| Tenant B | **NO VERIFICADO en producción** · Local ✓ | E2E local; SQL bloques 4 y 5 | §16.9 |
| Mensajes automáticos | **NO VERIFICADO en producción** · Local ✓ (0) | E2E local | §16.10 |
