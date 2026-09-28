# Business Agent 2.0 — FASE 9: hardening de producción

Pregunta de la fase: *si mañana varios negocios reales usan el Business Agent a la vez, ¿opera, detecta fallos, se
recupera, evita duplicados, aísla tenants y permite diagnóstico sin que Duvan entre a corregir cada agente?*
Este documento registra SOLO lo implementado y verificado en esta fase, con la evidencia que lo respalda. Lo que no se
pudo verificar aquí está marcado como tal.

Principio sin cambios: **la IA interpreta y redacta; el backend decide y ejecuta.** Ninguna pieza de FASE 9 le da a la IA
poder sobre tenant, versión, disponibilidad, precios, acciones o confirmaciones.

## 1. Pendientes de FASE 8

| # | Pendiente | Estado actual | Acción | Estado |
|---|---|---|---|---|
| A | Migración 20261127 (recordatorios) | No aplicada en producción | Aplicar 20261127 y la nueva 20261128 (ver §12) | PRODUCTION ACTION REQUIRED — cadena verificada en Postgres 16 local |
| B | Despachador de recordatorios | Existía sin programar; dos defectos reales (abajo) | Corregidos + verificación de desconocidos + latido + circuito | Código VERIFICADO local; programarlo = PRODUCTION ACTION REQUIRED |
| C | Evaluación en vivo con IA (20 conversaciones) | `real-ai-eval.live.test.ts` existe | Correrla con `GEMINI_KEY` | NOT VERIFIED (sin clave en este entorno; el test se salta y lo dice) |
| D | Mecanismo de pilotos | Solo elección explícita por agente | Despliegue OFF → PILOT → CANARY → GENERAL (§8) | VERIFICADO (tests); elegir pilotos = PRODUCTION ACTION REQUIRED |
| E | Disponibilidad por recurso | La disponibilidad es la del calendario completo | Sin cambio (requiere agendas por recurso) | PARTIALLY VERIFIED — riesgo residual (§13) |
| F | Circuit breaker | Uno por proceso, solo para la IA | Circuitos por dependencia y tenant (§6) | VERIFICADO (tests 9, 22, 24) |
| G | Traspaso sin IA | Frases fijas en español en una lista suelta | Tabla por locale + test que ata la frase sugerida al reconocedor (§10) | VERIFICADO (test 18) |

**Defectos reales encontrados en la auditoría de recordatorios (B):**
1. El texto del recordatorio se guardaba al programar: si la cita se reprogramaba, el recordatorio salía con la hora
   VIEJA. Ahora el texto se renderiza al enviar con el inicio vigente (`renderReminderText`).
2. Cancelar o reprogramar una cita cuyo recordatorio el despachador YA había tomado (`sending`) no lo afectaba: se
   enviaba igual. Ahora se invalida y el despachador pregunta `dulabs_ba_reminder_begin_send` justo antes de enviar.

**Otro defecto de FASE 8 encontrado por los tests de esta fase:** el tono estaba dentro de los params compilados de
`ba_programar_recordatorio`, es decir, en la huella de ejecución (contradecía la doc de FASE 8). Ahora viaja con el paso
(`StepContext.tone`) y la huella no cambia con el tono (test 15). Efecto: los artefactos con recordatorios cambian de
huella una vez al recompilarse (una solicitud pendiente se re-evalúa como STALE; nunca se ejecuta con otra versión).

## 2. Migración 20261128000000_dulabs_ba_production_hardening (aditiva, requiere 20261127)

| Pieza | Qué hace |
|---|---|
| `dulabs_ba_reminders` + columnas | `tone`, `invalidated_at`, `cancel_requested`, `last_claimed_at`, `verification`, `provider_message_id` |
| guard | un `unknown` solo puede pasar a `sent` (verificado), nunca volver a `scheduled` |
| `dulabs_ba_reminder_schedule` (13 args) | igual que la de 12 + tono (la de 12 se conserva; el store cae a ella si 28 falta) |
| `cancel` / `reschedule` | además invalidan lo que está `sending`; reprogramar a un momento pasado cancela |
| `claim_due` | registra `last_claimed_at`; el lease vencido pasa a `unknown` con verificación pendiente |
| `begin_send` | `go` / `cancelled` / `rescheduled` / `lost` (fencing por `attempts`) |
| `unverified` / `resolve_unknown` | cola de desconocidos; encontrado → `sent`/`verified_sent`; no encontrado → sigue `unknown`/`not_found` |
| `mark_sent` | cierre con el id del mensaje del proveedor (fencing) |
| `dulabs_ba_rate_counters` + `rate_limit_hit` / `prune` | contadores de ventana fija atómicos (`INSERT … ON CONFLICT DO UPDATE`) |
| `dulabs_ba_usage_daily` + `usage_record` | uso por tenant y día (turnos, llamadas de IA, tokens, costo estimado, acciones, errores, latencia) |
| `dulabs_ba_incidents` | errores BA-* con referencia de soporte; único (tenant, ref, código); formato validado |
| `dulabs_ba_job_runs` + `job_heartbeat` | latido del despacho (readiness) |

Todo con RLS sin políticas y funciones solo para `service_role`. **Evidencia:** `scripts/verify-ba-migration-chain.sh`
→ grafo (28 requiere 27), cadena aplicada dos veces, 13 tablas / 30 funciones / 0 expuestas a anon/authenticated,
tests SQL 7+8+8+8+5+**9** PASS (el 9.º de 28 es rollback sin borrar historia).

## 3. Recordatorios y despachador

```
verificar desconocidos → claim (lease + SKIP LOCKED) → begin_send → ventana 24 h → texto AHORA → envío (circuito WhatsApp)
→ mark_sent | retry (política, jitter, nunca después de la cita) | failed | unknown → latido (+ poda de contadores)
```

| Garantía | Cómo | Evidencia |
|---|---|---|
| Un recordatorio activo por cita | índice único parcial + `schedule` = upsert por clave, serializado por cita (20261129) | test 1; Postgres C2/C3 (C3: 5 rondas × 10) |
| Reprogramar ⇒ el viejo no sale | `reschedule` mueve/invalida; texto al enviar | test 4; SQL PASS 1/3 |
| Cancelar ⇒ cancelado (aun tomado) | `cancel` invalida `sending`; `begin_send` lo cierra | test 3; SQL PASS 2; Postgres C4 (50 carreras, 0 inconsistentes) |
| Evento duplicado ⇒ nada duplicado | clave de la operación del Action Engine | test 1 |
| Dos workers ⇒ uno gana | `FOR UPDATE SKIP LOCKED` + fencing por `attempts` | test 2; Postgres C1 (8 procesos, 300 recordatorios, 0 duplicados) |
| Timeout / resultado desconocido | `unknown` → VERIFICAR en `dulabs_mensajes_log` (mismo texto, mismo cliente, desde el claim) | test 11; SQL PASS 4; C10 |
| Worker reiniciado | lease vence → `unknown`; su cierre tardío se rechaza | test 24; C11 |

"No encontrado" no prueba que Meta no lo entregó (un envío cortado nunca se registra): por eso queda `unknown/not_found`
y **no se reenvía**. Elección de infraestructura para programarlo: **QStash** (ya integrado: `lib/cron-auth.ts` valida
su firma y `developer/whatsapp-jobs` lo usa). Los crons de `vercel.json` son todos diarios; un recordatorio necesita
granularidad de minutos, que Vercel Cron solo da en planes que no está verificado que la cuenta tenga.

## 4. Idempotencia por acción

| Acción | Clave de idempotencia | Persistencia | Reintento seguro | Desenlace desconocido | Concurrencia |
|---|---|---|---|---|---|
| Reservar (`crear_cita_nylas_generico`) | sha(tenant, conversación, objetivo, acción, propósito, args, artefacto) | `dulabs_ba_action_executions` (claim) + effectId en el handler | No (escritura externa) | Verifica listando citas (FASE 8) | claim único + candado `booking:(tenant,fecha)` |
| Reprogramar | igual | igual | No | **FASE 9:** verifica: cita a la hora nueva → hecho; la elegida sigue a otra hora → no | claim + candado por fecha |
| Cancelar | igual | igual | No | **FASE 9:** verifica: la cita ya no está → hecho; sigue → no; sin id y quedan citas → persona | claim |
| Recordatorio (programar) | id de la operación | `dulabs_ba_reminders` (tenant, clave) + 1 activo por cita | **Sí** (FASE 9: upsert) | No aplica (repetir = mismo resultado) | Postgres C2/C3 |
| Recordatorio (enviar) | fila + `attempts` | lease + estados | Solo transitorio ANTES de enviar | Verifica en el historial; nunca reenvía | SKIP LOCKED + fencing |
| Interesado (`ba_guardar_lead`) | id de la operación | claim + merge con versión optimista | **Sí** (FASE 9: merge) | No aplica | claim + versión optimista |
| Traspaso (`transferir_soporte`) | id de la operación | claim + pausa en `dulabs_pausas_chat` | No | Sin verificador: queda a una persona | claim |
| Mensaje entrante | wamid | `dulabs_mensajes_log.procesado_at` (webhook) + `recentEventIds` en el estado persistido | — | — | UPDATE … WHERE procesado_at IS NULL + versión optimista del estado |
| Respuesta por WhatsApp | un envío por turno procesado | historial de salientes | No (Meta) | No verificable por API: no se reenvía | un turno por mensaje (arriba) |

## 5. Política de reintentos (`runtime/production/retry-policy.ts`)

Una sola: backoff `base·2^(n−1)` con techo y jitter en [50 %, 100 %], máximo de intentos y timeout por dependencia.
Clases: RETRYABLE (timeout antes del efecto, 429, 5xx, red), NON_RETRYABLE (validación, config, seguridad, 4xx, circuito
abierto), AMBIGUOUS (escritura no idempotente cortada: se verifica, nunca se repite).

| Dependencia | Intentos | Base / techo | Timeout |
|---|---|---|---|
| understanding (Gemini) | 2 | 300 / 1 200 ms | 8 s (presupuesto del turno 15 s) |
| action_read | 2 | 300 / 1 200 ms | 8 s |
| action_idempotent_write | 2 | 300 / 1 200 ms | 8 s |
| action_write | 1 | — | 20 s |
| reminder_send | 3 | 2 / 10 min | 10 s |

La usan el entendimiento, el Action Engine y el despachador (tests 10, 10b).

## 6. Circuitos por dependencia (`runtime/production/circuits.ts`)

| Dependencia | Alcance | Umbral / enfriamiento | Dónde |
|---|---|---|---|
| gemini | proceso (clave única de la plataforma) | 5 / 30 s | entendimiento (el mismo de FASE 7) |
| nylas_calendar | (dependencia, tenant) | 3 / 60 s | Action Engine (ejecución y verificación) |
| whatsapp | (dependencia, tenant) | 3 / 120 s | despachador de recordatorios |

Solo cuentan fallas de integración; abierto = `BA-INTEGRATION-CIRCUIT_OPEN` sin llamar (nunca ambiguo); half-open deja
pasar una prueba y siempre se registra su desenlace. Memoria acotada (LRU 2 000). Sin Redis: la justificación de FASE 8
sigue vigente y ahora el costo se limita además por tenant. Lo que NO tiene circuito: las respuestas del turno a
WhatsApp (sin ellas no hay nada que degradar; un circuito solo perdería mensajes más rápido).

## 7. Límites, bucles, costo, correlación e incidentes (`runtime/production/operations.ts`)

- **Límites (Postgres, fallan ABIERTO):** 30 msg/min por contacto y 1 000/min por tenant en la frontera (sin IA ni
  acciones; un incidente por ventana); 600 llamadas de IA/min por tenant (por FUERA del circuito de Gemini: el exceso
  de uno no abre el circuito de todos); 10 escrituras/hora por conversación en el Action Engine. Los endpoints del panel
  ya tenían su límite (`lib/rate-limit.ts`, categoría "costosa" para la IA). Claves de contacto con hash (sin teléfono).
- **Bucles:** la MISMA respuesta a la MISMA conversación por 3.ª vez en 15 min se reemplaza por una salida (persona o
  reformular); desde la 4.ª no se responde (corta bucles bot↔bot). `BA-SYSTEM-LOOP_DETECTED` en la traza.
- **Costo por tenant:** cada turno registra uso (tokens reportados por la API, llamadas, acciones, errores, latencia)
  en `dulabs_ba_usage_daily` (día UTC). Costo = ESTIMACIÓN con tarifas declaradas (`BUSINESS_AGENT_COST_*_PER_MTOK_USD`,
  por defecto 0,30 / 2,50 USD por millón); no es facturación. Los turnos del grafo cuentan turno/latencia/errores (sus
  tokens no están disponibles en la frontera).
- **Correlación:** `correlationId = sha256(tenant|wamid)` (determinista: el reintento de Meta da la misma) y
  `supportRef` de 8 caracteres (alfabeto sin 0/O/1/I). En la traza del turno y del boundary.
- **Incidentes:** errores BA-* que no son del cliente (USER) se guardan con referencia, tenant, versión, motor,
  dependencia, causa (solo la primera línea, sin rutas) y hora. El cliente ve `(Ref. XXXXXXXX)` SOLO en los textos de
  error.

## 8. Despliegue seguro (`BUSINESS_AGENT_ENGINE_ROLLOUT`)

Orden: kill switch → `off` → lista de compatibilidad → elección explícita publicada → despliegue gradual → publicado →
default. `off` = nadie en el motor conversacional; vacío/`pilot`/inválido = FASE 8 (solo quien lo eligió);
`canary:N` = N % estable de tenants (hash) SIN elección explícita y elegibles; `general` = todos esos. Elegible = el
motor conversacional ejecuta todas sus capacidades encendidas y su versión publicada compila. Una elección explícita
(`spec.runtime.engineChoice = "explicit"`, la escribe el onboarding al elegir motor y se hereda) nunca se pisa. Volver
atrás = cambiar la variable. Pantalla: fuentes "despliegue gradual de DuLabs" / "motor conversacional pausado".

## 9. Deriva, rollback, salud, diagnóstico

- **Deriva** (`lifecycle/drift.ts`): artefacto ligado a otra versión que la servida, publicación fuera de la guía,
  activo sin número, rollback vigente, borrador sin publicar. Se muestra en "Publicar y activar"; nunca "corrige" nada.
- **Rollback:** registro (re-apuntar `published_version_id`) y artefacto (`dulabs_ba_activate_business_model_version`);
  versiones inmutables (append-only). Test 13 + SQL PASS 9.
- **Salud:** `GET /api/business-agent/health` = liveness (público, sin dependencias). `?check=ready` (auth de cron) =
  readiness: base + tablas base (not_ready si faltan), migraciones 27/28, IA configurada y su circuito, circuitos por
  dependencia (sin ids de tenants), latido del despacho (nunca corrió / detenido > 15 min / falló), kill switch y etapa
  de despliegue. 200 ready/degraded, 503 not_ready.
- **Diagnóstico:** `GET /api/business-agent/diagnostics[?ref=]` con sesión: incidentes del tenant de la sesión con
  mensaje humano, responsable, código, versión, motor, dependencia, correlación y hora. Una referencia de otro tenant no
  existe (404).

## 10. Traspaso

`HUMAN_REQUEST_PHRASES_BY_LOCALE` (es/en); la lista combinada conserva contenido y orden (agentes publicados sin cambio).
Test 18: el traspaso persiste entre instancias (el agente no contesta mientras está en manos de una persona), funciona
con la IA caída (frases fijas) y la frase que sugiere cada tono la reconoce el backend.

## 11. Estado distribuido

| Estado | Dónde | Por qué es seguro |
|---|---|---|
| Caché de artefactos / compilación legacy / elegibilidad de despliegue | memoria (por proceso) | claves por versión publicada o checksum (inmutables) |
| Circuitos | memoria (por proceso) | decisión explícita (§6); solo afecta cuántas llamadas fallidas hay |
| Deduplicación de mensajes | Postgres (`procesado_at`, `recentEventIds`) | — |
| Claims / candados / ejecuciones | Postgres | — |
| Recordatorios / desconocidos | Postgres | — |
| Límites y bucles | Postgres (`dulabs_ba_rate_counters`) | — |
| Uso, incidentes, latidos | Postgres | — |
| Pausa humana | Postgres (`dulabs_pausas_chat`) | — |

## 12. Evidencia

| Qué | Resultado |
|---|---|
| `lib/agent-compiler/runtime/fase9.test.ts` | 30/30 (tests 1–24 + 10b + kill switch, despliegue, onboarding, soporte) |
| `lib/agent-compiler/runtime/fase8.test.ts` | 46/46 |
| `scripts/verify-ba-migration-chain.sh` | 48 tests SQL PASS (9 de 28 + 3 de 29) |
| `scripts/verify-ba-concurrency.sh` | 11/11 casos con sesiones psql paralelas |
| `scripts/perf/ba-fase9-pgbench.sh` | 10/50/100 clientes: 0 transacciones fallidas, uso exacto |
| `scripts/perf/ba-fase9-load.ts` | 10/50/100 tenants × 3 conversaciones en proceso: 0 estados cruzados, reservas exactas |
| Rutas reales (`next dev`) | liveness 200; readiness sin auth 401; diagnóstico sin sesión 401 |
| Revisión visual (Playwright, 1440×900 y 390×844) | 10 escenarios × 2; sin scroll horizontal; banner de deriva visible |
| Regresión completa | 6458 tests · 6438 pass · 20 fallas = las MISMAS 20 históricas de FASE 8 (0 nuevas) |
| TypeScript / Lint / Build | 0 errores / 0 errores (33 advertencias históricas) / OK sin advertencias nuevas |
| Evaluación en vivo con Gemini | NOT VERIFIED (sin `GEMINI_KEY`; el test se salta y lo declara) |

Tests existentes ajustados al contrato NUEVO (no para "ponerlos en verde"): `action-engine.test.ts` 12 (backoff con
jitter acotado en vez de 300 ms exactos) y "política coherente" (el reintento solo se permite a las dos escrituras
idempotentes propias; toda otra escritura sigue con 1 intento); `fase7.test.ts` AI 16 / AI 24 (el texto de error ahora
lleva `(Ref. XXXXXXXX)` con formato exacto).

## 13. Riesgos residuales

- Candado de reserva por (tenant, fecha), sin espera: dos clientes del MISMO negocio confirmando el MISMO día en el mismo
  instante → uno recibe CONFLICT (reintentable) aunque pidan horas distintas (medido en la carga: `mismo_dia`).
- Disponibilidad por recurso: se usa el calendario completo.
- Envío de WhatsApp de desenlace desconocido que no quedó registrado: queda `unknown/not_found` para una persona.
- Cancelación sin id elegido con otras citas vivas: la verificación devuelve "no se sabe" (persona).
- Circuitos por proceso: cada instancia descubre la caída por su cuenta (≤ umbral × instancias).
- Costo: estimación con tarifas declaradas; los turnos del grafo no reportan tokens.
- Sin política automática de retención para `dulabs_ba_incidents` / `dulabs_ba_usage_daily` (crecen por día y error).
- Nada de esto fue verificado contra Meta, Nylas o Gemini reales (sin credenciales en este entorno).

## 14. Verificación de producción (posterior a FASE 9)

**Defecto encontrado y corregido — `20261129000000_dulabs_ba_reminder_schedule_lock`.** `dulabs_ba_reminder_schedule`
(20261127) buscaba el recordatorio activo con `SELECT … FOR UPDATE`; si aún no existía no había fila que bloquear y dos
operaciones DISTINTAS para la misma cita en paralelo insertaban ambas: la segunda fallaba con `unique_violation` en
`dulabs_ba_reminders_activo_uidx` en lugar de devolver `updated`. El invariante (un solo activo) se mantenía y en la app
el reintento de la escritura idempotente lo absorbía, pero la función fallaba. El reporte de FASE 9 dio C3 por PASS con
UNA corrida (la carrera no ocurrió); al repetirla falló (4 de 5 rondas con errores). Corrección: candado transaccional
`pg_advisory_xact_lock` por (tenant, conversación, cita) al inicio de la MISMA función (misma firma; la de 13
argumentos delega en ella). C3 ahora son 5 rondas × 10 sesiones: sin 20261129 falla; con ella 3/3 corridas completas OK.

**Estado del despliegue (evidencia de GitHub):** el código de FASE 1–9 está en `claude/hola-a9cgg2` y NO en `main`
(último commit de `main`: merge #147). Si producción despliega `main`, las rutas `/api/business-agent/health`,
`/diagnostics` y `/reminders/dispatch` no existen allí. Desde este entorno no se pudo consultar `www.dulabs.co` ni QStash
(la política de red los bloquea) ni Supabase (sin credenciales): la verificación en vivo queda pendiente con las
consultas de solo lectura de verificación (esquema y ejecución).

## 15. Investigación del despachador en producción (28-09-2026)

**Evidencia (QStash Logs, hora local UTC−5, y `dulabs_ba_job_runs`).** Mensajes del schedule `*/5` a
`/api/business-agent/reminders/dispatch`: 08:15–08:45 FAILED, 08:50 DELIVERED. La "Duration" de QStash es el tiempo del
mensaje desde su creación hasta su estado final, **incluidos los reintentos**, no el tiempo de una ejecución. Backoff
por defecto de QStash (documentación oficial): `delay = min(86400, e^(2.5·n))` → 12 s + 2 m 28 s + 30 m 8 s = 32 m 49 s
para 3 reintentos. Duración media observada de los 8 mensajes: 32 m 58 s. Ninguna ejecución individual puede durar
30 minutos: la ruta tiene `maxDuration = 60`.

**Causa de los FAILED.** Hasta el merge del PR #148 (14:15 UTC) la ruta no existía en `main`: en el commit `d262514`
(base del PR) no hay `app/api/business-agent/reminders/dispatch/route.ts`, y `proxy.ts` no intercepta
`/api/business-agent`. Cada intento recibía una respuesta no-2xx; tras 4 intentos QStash marcaba FAILED (DLQ). El
código HTTP exacto no se pudo leer desde este entorno (QStash bloqueado por la red): queda por confirmar en el detalle
del mensaje en la consola.

**Por qué 08:50 fue DELIVERED.** Su último reintento (creación 13:50:00 UTC + 32 m 05 s) llegó a las 14:22:05 UTC, ya con
el despliegue activo. El latido de producción marca `last_finished_at = 14:22:05.78 UTC`, `last_ok = true`,
`claimed = 0`. El último intento de 08:45 (14:17:35 UTC) todavía falló, así que el despliegue quedó activo entre
14:17:35 y 14:19:44 UTC (primer `/health` = `alive`).

**Defecto latente encontrado en la auditoría y corregido.** El despacho tomaba el lote completo (hasta 50) con un lease de
60 s y lo recorría en serie, sin presupuesto de tiempo y sin timeout en las llamadas a Postgres, dentro de una función de
60 s. Si la plataforma la cortaba a mitad del lote, los recordatorios que NUNCA llegaron a Meta quedaban en `sending`; el
siguiente despacho los marcaba `unknown`, la verificación no los encontraba y, por diseño, no se reenvían: el cliente no
recibía el recordatorio, la respuesta era 504 y no quedaba latido. Reproducción: `dispatcher-budget.test.ts` D1
(50 vencidos, 1,5 s c/u → `rem-42…rem-50` quedaban `unknown` sin intento; ejecución cortada a 61,5 s).
Corrección:
- se toma DE A UNO (`claim_due(1, 60)`) justo antes de procesar cada recordatorio, mientras quede presupuesto
  (`DISPATCH_BUDGET_MS = 15 s`); los que no alcanzan siguen `scheduled` para la próxima ejecución;
- cliente de Postgres propio de la ruta con timeout por llamada (`DISPATCH_DB_TIMEOUT_MS = 3 s`);
- peor caso: 15 + (8·3 + 10) + 2·3 = 55 s < 60 s, así que siempre hay respuesta y latido.

No cambia el SQL: sin migración nueva. La idempotencia (claim con `SKIP LOCKED` + fencing por `attempts`), la
cancelación y reprogramación (`begin_send`), el desenlace desconocido con verificación y el aislamiento por tenant siguen
iguales. Evidencia: D1–D4, FASE 8 (46/46), FASE 9 (30/30), regresión del Business Agent 865/865,
`verify-ba-concurrency.sh` 12/12 (C12: 8 despachadores tomando de a uno, 200 recordatorios, 0 duplicados), tsc, lint y
build.
