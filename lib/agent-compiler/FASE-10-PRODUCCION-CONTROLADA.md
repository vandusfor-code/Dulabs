# Business Agent 2.0 — FASE 10: producción controlada, autoservicio y piloto

```
PAGO → TENANT → ONBOARDING (borrador) → VALIDAR → COMPILAR → VISTA PREVIA → PRUEBA → PUBLICAR → GATE DE ACTIVACIÓN
     → ACTIVAR → MOTOR (despliegue controlado por DuLabs) → MENSAJE → ENTENDIMIENTO (IA) → REGLAS (backend)
     → ACCIÓN SEGURA (Action Engine) → RESPUESTA (renderer) → OBSERVABILIDAD (traza, uso, incidentes)
```

Principio: la IA interpreta lenguaje; el backend decide qué se ejecuta; la base de datos es la realidad; la versión
publicada es la fuente de verdad. Esta fase no agrega un motor ni un catálogo nuevo: prueba de punta a punta lo
construido en FASES 1–9 y corrige lo que esa prueba encontró.

## 1. Estado de partida (auditoría)

- `main` contiene FASES 1–9 (PR #148) y la corrección del despachador (PR #150).
- **Despachador de recordatorios: PARTIALLY VERIFIED.**
  - El código está desplegado. Hubo una ejecución real correcta: 14:22:05 UTC del 28-09, `last_ok = true`.
  - Los FAILED de esa mañana fueron por la ruta todavía no desplegada; la "Duration" de QStash incluye sus reintentos (FASE 9 §15).
  - Desde las 13:50 UTC la cuenta de QStash (plan Free) agotó su cuota diaria (1,2 mil de 1 mil) y dejó de crear mensajes para TODOS sus schedules. Es un límite externo, no un defecto del código.
  - Falta ver varias ejecuciones seguidas después del reinicio de la cuota (00:00 UTC).
- Por eso el piloto queda **preparado pero NO activado** (§9).

## 2. Defectos encontrados y corregidos

| # | Defecto | Causa raíz | Corrección | Prueba |
|---|---|---|---|---|
| 1 | Un negocio nuevo quedaba con horario lunes–viernes 09:00–18:00 **inventado**: con agenda de calendario el agente reservaba en ese horario aunque el negocio nunca lo indicara. | `emptyDraft()` usaba `defaultHours()` como valor por defecto. | El borrador empieza sin horario (`emptyHours()`); con calendario, la validación exige marcar días. La plantilla 9–18 solo se aplica si la persona pulsa «Usar lunes a viernes 9:00–18:00». | golden path (borrador nuevo sin horario), DOM E2E 1, fase8 onboarding |
| 2 | Una credencial **requerida** que faltaba (token de WhatsApp/Meta; Nylas con agenda de calendario) no bloqueaba la activación: solo se listaba. | `evaluateEngineReadiness` marcaba `required` pero no agregaba bloqueo. | Bloqueos `WHATSAPP_CREDENTIAL_MISSING` y `CALENDAR_CREDENTIAL_MISSING`. | golden path §5 |
| 3 | Los bloqueos de activación decían solo "qué", sin "por qué" ni "cómo". | El gate devolvía un mensaje suelto. | `explainActivationBlocker` (una sola fuente, backend) agrega por qué y cómo, y el paso del configurador. La pantalla muestra los tres y «Cómo solucionarlo →». | golden path §5 |
| 4 | Elegir el motor conversacional en el configurador bastaba para usarlo: no había selección explícita de DuLabs. | Etapa `pilot` = "quien lo eligió". | Despliegue controlado con listas explícitas (§5). Sin admisión, el agente sigue en el motor clásico (`rollout_not_selected`). | fase9 despliegue, golden path §6 |
| 5 | «¿Cuánto cuesta X?» como **primer** mensaje, en un negocio sin cotización, ignoraba el precio real del catálogo. Contestaba desde la búsqueda de conocimiento: sin FAQ, «no tengo esa información». | `priceFactsFor` solo miraba el estado (vacío en el primer mensaje) y el renderer descartaba los precios al completar la búsqueda. | Se usa el servicio nombrado en ESE mensaje (resuelto contra el catálogo). Los precios reales van primero; un servicio inexistente no lista precios de otros; sin servicio, lista los precios. | golden path «defecto encontrado», safety 4 |
| 6 | El nombre del asistente configurado («Leo») lo usaba el motor clásico pero el conversacional lo ignoraba. | El artefacto no lo llevaba. | `presentation.assistantName` (estilo: no entra en la huella de ejecución) en los 4 tonos. | golden path §7 |
| 7 | `dispatcher-budget.test.ts` (PR #150) no estaba en el manifiesto de `npm run test:flow`. | Omisión. | Agregado (y los tests nuevos). | manifiesto |

## 3. Golden path (`e2e/golden-path-fase10.test.ts`)

Cada negocio se configura por el **servicio real del onboarding**, se publica y el runtime se arma con el **artefacto publicado activo**. Es lo que carga producción cuando el enlace coincide con la versión servida. Se comprueba además que su huella de ejecución es la del Spec servido.

**Barbería:**
- **Configuración:** nombre, descripción, asistente, servicios con precio, horario propio (martes a sábado 9–19), zona, aviso mínimo, cambios, recordatorios 120 min, traspaso con pausa de 8 h, tono profesional, tema restringido.
- **Antes de publicar:** negocio nuevo → validar → vista previa (reserva simulada) → «Prueba tu agente» (todos los escenarios, sin efectos reales).
- **Publicación:** publicar (6 etapas reales).
- **Gate de activación:** el gate REAL explica la credencial faltante y el plan inactivo; luego permite.
- **Motor:** solo como piloto admitido; con kill switch vuelve al motor clásico.
- **Mensajes contra lo publicado:**
  - saludo con el nombre del asistente;
  - precio calculado por el backend;
  - cita del martes a las 6:30 p. m. (existe con su horario y no con una plantilla), creada tras confirmar, en la zona del negocio;
  - recordatorio a 120 min;
  - doble «sí» y wamid repetido → una reserva;
  - regla y traspaso sin acciones.
- **Traza:** tenant, agente, versión (`ubm-v1`), huella, acción, estado y latencia, sin texto ni nombre del cliente.

**Tienda sin citas:**
- Se publica **sin horario ni agenda** (no se le exigen).
- El artefacto no tiene NINGUNA acción de citas.
- Precio y talla M salen del inventario real; un producto inexistente no se inventa y uno agotado no ofrece stock.
- El inventario de otro tenant nunca aparece.
- Pedir cita o recordatorio → sin acción.

**Híbrido:**
- Un producto se consulta en el inventario y **no se agenda** como servicio.
- Un servicio da el precio del catálogo de servicios, sin mezclar precios.
- La cita se crea con el servicio correcto y el tenant correcto.

## 4. Gate de activación y matriz (backend decide, pantalla muestra)

Un agente NO se activa si alguna de estas condiciones se cumple. Cada una tiene su código:

| Condición | Código |
|---|---|
| Sin publicar | NOT_PUBLISHED |
| Versión inválida o con checksum distinto | AGENT_INVALID |
| Cambios sin publicar | BA-ACT-002, capa del onboarding |
| Datos o integraciones que faltan para lo que ofrece | READINESS_BLOCKED + código de readiness |
| Motor que no ejecuta una capacidad encendida | ENGINE_CAPABILITY_UNSUPPORTED |
| IA no configurada | AI_CREDENTIAL_MISSING |
| Artefacto no compilable | ARTIFACT_INVALID |
| Credencial de WhatsApp o calendario ausente | *_CREDENTIAL_MISSING |
| Sin plan | BILLING_REQUIRED |
| El número lo atiende otro motor | ENGINE_CONFLICT |

- La matriz y el gate usan la MISMA función: `lifecycle/supabase.ts::evaluateEngineReport`.
- La explicación humana es única, en `lifecycle/activation-gate.ts::explainActivationBlocker`.
- Nunca se muestra solo «Activation failed».
- **No cubierto:** «dependencia crítica caída» no es un bloqueo de activación. Los circuitos son por proceso y el despachador es un cron: lo informa la readiness (`/api/business-agent/health?check=ready`), no el gate.

## 5. Despliegue controlado (`runtime/production/engine-selection.ts`)

| Etapa (`BUSINESS_AGENT_ENGINE_ROLLOUT`) | Quién usa el motor conversacional |
|---|---|
| `off` | nadie |
| `canary` | solo `BUSINESS_AGENT_CANARY_TENANTS` (tenants internos de prueba de DuLabs): 0 % de clientes |
| `pilot` (también sin valor o con valor inválido) | canary + `BUSINESS_AGENT_PILOT_TENANTS` (negocios seleccionados por DuLabs) |
| `limited:N` (`canary:N` de FASE 9 = alias) | pilot + N % estable (hash del tenant) de agentes elegibles |
| `general` | todos los elegibles |

Orden de decisión:
1. Kill switch.
2. `off`.
3. Lista de compatibilidad FASE 4 (`BUSINESS_AGENT_STATE_MACHINE_TENANTS`, no se tocó).
4. Una elección explícita del motor clásico nunca se pisa.
5. Elección explícita del conversacional: solo si el tenant está admitido. Si no, motor clásico con fuente `rollout_not_selected`; la pantalla dice «se habilita por DuLabs negocio por negocio».
6. Admitido y elegible → conversacional.

Detalles:
- Las listas solo aceptan UUIDs: un error de escritura no admite a nadie.
- La readiness muestra la etapa y cuántos tenants tiene cada lista, sin sus ids.
- Volver atrás = cambiar la variable, sin republicar ni tocar configuración.

## 6. Kill switch y rollback

- **Kill switch:** `BUSINESS_AGENT_ENGINE_KILL_SWITCH=all` o una lista de UUIDs → motor clásico al instante, por encima de todo, sin tocar la configuración.
  - Es reversible: se quita la variable.
  - Lo prueban fase9 («kill switch») y golden path §6.
  - Auditoría del cambio: el historial de variables y despliegues de Vercel.
  - Auditoría del efecto: cada turno registra `engine` y `engineSource` en su traza.
- **Rollback de versión:** re-apuntar la versión publicada y el artefacto activo (FASE 9 §9, test 13, SQL PASS 9). Las versiones son append-only.
- **Recordatorios:** `BUSINESS_AGENT_REMINDERS_DISABLED=1` detiene el despacho (el latido sigue).

## 7. Seguridad, concurrencia e idempotencia

`e2e/safety-fase10.test.ts` corre sobre un negocio publicado por el onboarding. En los 10 casos no hay acción indebida:
1. inyección en el mensaje;
2. slot inventado por el modelo, no presente en el texto;
3. nombre de producto con instrucciones;
4. instrucciones ocultas en la descripción;
5. acciones no habilitadas (cancelar o reprogramar sin permiso, pagos);
6. servicio o recurso inexistente;
7. tenant cruzado con los mismos stores;
8. webhook repetido;
9. timeout del calendario: una sola llamada, sin éxito inventado, se ofrece persona;
10. concurrencia.

| Carrera | Gana | Pierde | Lo que recibe el cliente | En la base |
|---|---|---|---|---|
| Misma confirmación dos veces a la vez | la primera toma de la clave | la segunda ve la ejecución existente | una confirmación | 1 ejecución, 1 cita |
| Dos clientes, mismo negocio y día, a la vez | quien toma el candado (tenant, fecha) | CONFLICT reintentable (BOOKING_IN_PROGRESS) | el perdedor nunca recibe «quedó agendada» | 1 cita |
| Dos cancelaciones o reprogramaciones | la primera | la segunda devuelve el resultado guardado o «ya cancelada» | un efecto | 1 cambio (fase9 test 11) |
| Mismo mensaje / webhook repetido | el primer claim por wamid | `duplicate` sin IA ni acciones | una respuesta | 1 turno (fase9 test 5) |
| Dos publicaciones | la primera (candado por tenant y agente) | `draft_conflict` / `version_conflict` | «cambió en otra sesión» | 1 versión (AI 11, SQL real) |
| Dos activaciones | ambas escriben lo mismo | — | activo | `UPDATE flow_activo, flow_id` idempotente por tenant |
| Programar recordatorio en paralelo | — | — | — | 1 activo (migración 29, C3) |
| Despachadores en paralelo | — | — | — | cada recordatorio 1 vez (C1, C12) |

**Idempotencia** (la misma operación repetida produce un solo efecto):
- publicación: revisión esperada;
- activación: UPDATE idempotente;
- reserva, cancelación, reprogramación, interesado y traspaso: clave de operación en `dulabs_ba_action_executions` (única por tenant);
- recordatorio: clave + un activo por cita;
- envío del recordatorio: claim + fencing por `attempts`; un desenlace desconocido se verifica y nunca se reenvía.

## 8. Observabilidad, incidentes y costo

- **Cada turno** registra:
  - tenant, agente, versión servida y huella del artefacto;
  - motor y su fuente;
  - intención y estado de los slots (sin texto);
  - acciones con estado y código;
  - latencias por etapa y tokens;
  - `correlationId` (hash de tenant + wamid) y `supportRef`.
- **Incidentes:** `dulabs_ba_incidents`, con clase USER / CONFIG / AI / INTEGRATION / SYSTEM, dependencia y causa saneada.
- **Uso y costo por tenant y día:** `dulabs_ba_usage_daily` (estimación con tarifas declaradas).
- **Límites** (fallan abierto): contacto 30/min, tenant 1 000/min, IA 600/min, escrituras 10/h por conversación; bucles cortados a la 3.ª/4.ª repetición. Nada de esto cambió en FASE 10.
- **Fallas de dependencias** (FASE 9, tests 7–9 y 24):
  - IA o Gemini caídos: sin acciones, estado conservado, se ofrece persona.
  - Calendar caído: circuito por tenant.
  - WhatsApp caído: recordatorio reintentable o desconocido y verificado.
  - Postgres lento: timeouts por llamada en el despachador.
  - QStash duplicado: claim `SKIP LOCKED`.
  - QStash retrasado: el recordatorio se envía al tomarse si sigue vigente; nunca después de la cita.

## 9. Piloto (preparado, NO activado)

Checklist antes de activar el ÚNICO piloto:
1. **Despachador verificado:** varias ejecuciones seguidas DELIVERED en QStash tras el reinicio de la cuota, y latido `reminders_dispatch` con `hace` < 5 min.
2. **Selección explícita del negocio:** la decide el dueño del producto, no el código.
3. **Readiness:** en la pantalla «Publicar y activar» del negocio, sin bloqueos.
4. **WhatsApp:** token presente y número del tenant.
5. **Calendario** (si agenda con calendario): conectado y calendario elegido.
6. **Publicación enlazada** y sin cambios pendientes.
7. **Motor:** poner su UUID en `BUSINESS_AGENT_PILOT_TENANTS` y la etapa en `pilot` (o dejarla vacía). Con eso es el único admitido: la etapa `pilot` sin otros UUIDs no admite a nadie más.
8. **Activar** desde la pantalla (gate real).
9. **Observar** con `scripts/ba-pilot-report.sql`.
10. **Kill switch listo:** `BUSINESS_AGENT_ENGINE_KILL_SWITCH=<uuid>`.

## 10. Métricas del piloto (`scripts/ba-pilot-report.sql`, solo lectura)

27 métricas, cada una con su fuente real:
- mensajes y llamadas a la IA;
- tokens, costo estimado y latencia promedio;
- errores de turno;
- acciones ejecutadas, rechazadas, fallidas y con desenlace desconocido;
- reservas, cancelaciones, reprogramaciones y traspasos por acción;
- recordatorios (programados, enviados, fallidos, desconocidos);
- errores de IA, integración y sistema;
- efectos duplicados reales;
- tasas de fallback de IA, fallo de acciones, efecto duplicado y desenlace desconocido.

Sin datos, las tasas salen NULL, nunca un 0 % inventado. `scripts/verify-ba-pilot-report.sh` lo verifica contra PostgreSQL 16 real:
- valores exactos;
- nada de otro tenant ni fuera de la ventana;
- solo lectura (transacción READ ONLY).

**Sin fuente real (no se inventan):**
- respuestas enviadas: están en `dulabs_mensajes_log`, pero no separadas por motor;
- traspasos por frase del Gate: pausan en `dulabs_pausas_chat` sin marcar el origen;
- timeouts de IA separados de otros errores de IA.

## 11. Rendimiento (`scripts/perf/ba-fase10-onboarding.ts`, en proceso, n = 30)

| Operación | p50 ms | p95 ms |
|---|---|---|
| guardar borrador | 0,48 | 1,14 |
| validar | 18,97 | 31,79 |
| vista previa | 20,16 | 34,86 |
| prueba del agente (5 escenarios) | 27,76 | 43,79 |
| publicar (compilar + verificar + RPC en memoria) | 40,24 | 57,22 |
| activar | 0,17 | 0,25 |
| runtime: saludo | 1,20 | 2,11 |
| runtime: precio | 2,28 | 3,37 |

Es solo CPU del código: sin red, Postgres ni IA. En producción manda la IA (~1–3 s por mensaje) y las consultas. Nada justificó optimizar.

## 12. Revisión visual y autoservicio

Revisión en Chromium (Playwright) sobre `next dev`, con la página real y el servicio del onboarding en memoria:
- **Alcance:** 17 escenarios × 3 tamaños (1440×900, 768×1024 y 390×844) = 51 capturas.
- **Escenarios:** nuevo, los 8 pasos, horario sin configurar, errores de horario, cargando, prueba ejecutada, publicado, bloqueo de activación explicado, motor no habilitado por DuLabs y conflicto entre pestañas.

**Resultados:**
- **Sin scroll horizontal** de página en ningún tamaño. Los elementos «fuera del ancho» que marca el detector están dentro de la tira de pasos, que es `overflow-x-auto` a propósito (se desplaza sola al paso actual).
- **Objetivos táctiles en móvil:**
  - las casillas de 16 px están dentro de etiquetas de 44 px (días del horario) o de tarjetas `<label>` completas (Atención);
  - el enlace nuevo «Cómo solucionarlo →» mide 44 px de alto.
- **Consola:** solo 409 esperados (el bloqueo de activación y el conflicto entre pestañas) y el aviso de `eval` del modo desarrollo.
- **Horario sin configurar:** error claro («Marca al menos un día abierto…»), sin días inventados, y la plantilla como acción explícita.
- **Bloqueo de activación** (el plan vence entre la carga de la pantalla y el clic; el servidor bloquea): el banner muestra qué falta, por qué y cómo solucionarlo. El harness de la API en proceso no pasaba `blockers` como la ruta real; se alineó.
- **Motor no habilitado:** «Motor clásico (el motor conversacional se habilita por DuLabs negocio por negocio…)».

**Accesibilidad y movimiento:** sin cambios en FASE 10. Las animaciones siguen respetando `prefers-reduced-motion` (FASE 7, `motion.tsx`). No se agregaron animaciones nuevas: la prioridad fue la corrección.

## 13. Qué NO se verificó

- La IA real (Gemini), Nylas y Meta desde este entorno: sin credenciales, con la red bloqueada.
- Producción después de estos cambios: la rama no está desplegada.
- El despachador tras el reinicio de la cuota de QStash.
- Un piloto real: no se activó ningún tenant.

## 14. Riesgos restantes

- **Cuota de QStash (Free, 1 000/día):**
  - con solotalento borrado el uso estimado es ~730/día;
  - un job que falle multiplica ×4 por los reintentos;
  - si se agota, se detienen TODOS los schedules de la cuenta.
- **Candado de reserva por (tenant, fecha):** dos clientes del mismo negocio el mismo día a la vez → uno recibe «inténtalo de nuevo» aunque pidan horas distintas.
- **Disponibilidad por recurso:** se usa el calendario completo.
- **Circuitos por proceso**, no distribuidos.
- **Costo:** es una estimación, no facturación.
- **Retención:** sin política automática para incidentes y uso.
- **Nombre del asistente:** solo en el camino del artefacto UBM (publicado por la configuración guiada); el adaptador legacy no lo toma.
- **Zona horaria por defecto:** el borrador nuevo propone America/Bogota (visible y editable en el primer paso; no es un horario ni un precio).
