# Agente Publi Bordados — 03 · Decisiones arquitectónicas (ADR)

> Acompaña a `02-ARQUITECTURA.md`. Base: `main` @ `dbff111`.
> Estados: **DECIDIDA** (por el responsable del proyecto) · **PROPUESTA** (recomendada, requiere
> aprobación) · **ABIERTA** (falta un dato o una decisión de negocio).

---

## ADR-01 · Módulo propio `lib/publibordados` — DECIDIDA

**Contexto.** `01-AUDITORIA.md` proponía un tipo `lead_qualification` dentro de `lib/agente`.
Eso obliga a modificar `lib/agente/config.ts`, `lib/agente/webhook.ts` y el `CHECK` de
`dulabs_agente_runtime_config.tipo`, todos compartidos con Delacour en producción.

**Decisión.** Toda la lógica funcional vive en `lib/publibordados/`. No se agrega ningún tipo a
`lib/agente`, no se reutiliza su máquina de estados y no se convierte `lib/agente` en
plataforma genérica. Sí se reutilizan, **sin modificarlas**, piezas realmente genéricas:
`lib/ia-proveedores`, `enviarTexto`/`enviarBotones`, `registrarMensaje`,
`incrementarUsoMensajes`, `esTelefonoBloqueado` y `resolverTelefonoRemitenteMeta`.

**Consecuencias.** PB duplica patrones que ya existen en `lib/agente` (buzón, lease, CAS,
trazas) con tablas propias. Es duplicación deliberada: su costo es menor que el riesgo de
tocar el agente de Delacour.

---

## ADR-02 · Punto de despacho: gancho E (eco síncrono) + gancho B (inicio de `procesarCambio`) — PROPUESTA (revisada en la Fase 0)

**Opciones.**

| Opción | Pros | Contras |
| --- | --- | --- |
| **A. Gancho E en `POST()` (ecos, antes del 200) + gancho B como primera instrucción de `procesarCambio` (cambio completo)** (propuesta) | Ningún motor puede robar el mensaje; PB ve media, `list_reply` y ecos crudos (`message_echoes`); cada eco tiene dos intentos idempotentes; el eco sobrevive a una muerte de `after()` | PB replica el `estado_entrega` de sus envíos y aplica por su cuenta la lista negra, QA y el cupo |
| A'. Ganchos dentro del bucle de ecos y del bucle de mensajes (versión anterior) | Menos código | El bloque de ecos lee la clave equivocada (`04` §0); el `return` anticipado puede descartar lotes mixtos |
| B. En `route.ts:1038`, junto a `lib/agente` | Hereda los gates existentes | La media y `list_reply` ya se descartaron; encuestas, campañas y onboarding atienden antes; el freno de ráfaga descarta mensajes; el candado espera hasta 20 s; el cupo silencia |
| C. Todo en `POST()` | Lo más temprano posible | El turno necesita `after()`; alarga el 200 de todos los tenants |

**Decisión propuesta: A.** Dos líneas y un `import` en `route.ts`, sin lógica de negocio.
Justificación completa en el `04` §12.

---

## ADR-03 · Activación por tabla propia + invariante `ia_pausada` — PROPUESTA

**Problema.** El dispatcher añade una lectura por mensaje. Si esa lectura falla, hay dos
opciones malas:
- tratar el error como "no es de PB": en el número de PB podría responder legacy;
- tratar el error como "es de PB": cambia el comportamiento de todos los tenants ante un error
  de una tabla nueva.

**Decisión propuesta.**
1. `dulabs_pb_config` (PK `phone_number_id`) es la **autoridad** de activación, con caché de
   30 s y último valor conocido.
2. Si la propiedad no se puede determinar, se devuelve "no es de PB": los demás tenants siguen
   **exactamente** igual que hoy.
3. **Invariante operativa:** el número de PB tiene `dulabs_clientes_config.ia_pausada = true`.
   Si un mensaje de PB cae alguna vez al camino existente, llega a `route.ts:914` y **calla**.
4. En consecuencia, PB **no** respeta `ia_pausada` (sería silencio perpetuo); su interruptor de
   apagado es `dulabs_pb_config.modo`.

**Alternativa descartada.** Columna `motor_dedicado` en `dulabs_clientes_config`: sin lectura
extra, pero cambia el esquema compartido y pierde el aislamiento de la configuración.

**Riesgo aceptado.** Si alguien pone `ia_pausada = false` desde el panel, el número solo queda
expuesto a legacy en el caso de routing indeterminado. PB lo detecta en cada turno y lo traza
(`invariant_broken:ia_pausada`).

---

## ADR-04 · `HUMAN_ACTIVE` propio y sin vencimiento; pausa compartida solo como lectura — PROPUESTA

**Decisión.**
- `dulabs_pb_conversaciones.control` es la fuente de verdad. No caduca.
- `dulabs_pausas_chat` se **lee** como segunda barrera con una consulta propia fail-closed. No se
  usa `chatEnPausaHumana`, que es fail-open.
- PB **nunca escribe** en `dulabs_pausas_chat`.

**Motivos para no escribir en la pausa compartida.**
1. No aporta nada a PB: su estado propio ya es la autoridad.
2. Cada fila con `seguimiento_enviado = false` es candidata al cron `seguimiento-traspaso`
   (ADR-13).
3. `activarPausaChat` reemplaza la pausa y el eco la acorta a 30 min: es justo el mecanismo que
   no queremos que gobierne a PB.

**Consecuencia.** El Inbox de DuLabs no muestra a PB como "en pausa" por un traspaso de PB
(solo por ecos, que escribe el manejador compartido). Como la asesora no usa el Inbox, se
acepta.

---

## ADR-05 · Pre-autorización atómica con fencing; señales humanas pegajosas — PROPUESTA (revisada en la Fase 0)

**Decisión.** Antes de cada envío:
1. Lectura fail-closed de la pausa compartida. Si hay pausa → `HUMAN_ACTIVE` pegajoso.
2. RPC `pb_confirmar_turno`: `select … for update`, `control`, dueño, `epoch`, `version`, modo y
   entradas nuevas; reserva el envío. Es el **punto de linealización** frente a
   `pb_marcar_humano`.

Cualquier error → no enviar.

**Cambio frente a la versión anterior:** se elimina la barrera del log `manual`. La alimentaba el
manejador compartido de ecos, que no funciona (`04` §0), y sería redundante con el eco que PB
procesa por su cuenta.

**Confiabilidad de las señales** (`04` §4):
- el estado propio y la pre-autorización son la **autoridad**;
- el eco es la **única** detección de la asesora en el teléfono;
- la pausa compartida es complementaria.

**Ventana residual.** Si el eco llega a DuLabs *después* de la autorización, no hay forma de
saberlo en ese instante. Análisis de mecanismos en el `04` §5:
- el retraso controlado desplaza la ventana, no la achica;
- el outbox no la cierra;
- la Cloud API no ofrece revocar mensajes.

Se adopta: eco síncrono, menos envíos, protocolo operativo y **medición** (`L`,
`race_collision`). No se promete una garantía física que Meta no ofrece.

---

## ADR-06 · Handoff atómico — PROPUESTA

**Decisión.** `pb_ejecutar_handoff` cambia `control` a `HUMAN_ACTIVE` **y** reserva el slot del
mensaje final en la misma transacción. Después, el mensaje final se envía sin pasar por la
barrera 3: ya no puede pasarla, porque el control es humano, y la reserva actúa como su
autorización. Casos:
- Si un eco ganó antes → `ya_humano` y **no** se envía el mensaje final.
- Si el proceso muere entre la transacción y el envío → la conversación queda en silencio y el
  slot ocupado; se prefiere perder el mensaje final a duplicarlo.

**Motivo.** Si primero se envía y luego se cambia el estado, se abre una ventana en la que la IA
podría responder otra vez. Si primero se cambia el estado sin reservar el envío, la propia
regla de `HUMAN_ACTIVE` bloquearía el mensaje final.

---

## ADR-07 · La IA solo interpreta; las respuestas son plantillas — PROPUESTA

**Opciones.**

| Opción | Pros | Contras |
| --- | --- | --- |
| **A. Extracción con Gemini + respuestas por plantilla** (propuesta) | El modelo nunca escribe algo que el cliente lea: sin precios inventados, sin promesas, inyección acotada; 1 llamada por turno de texto y 0 por botón; tests deterministas | Menos variedad en la redacción |
| B. Extracción + redacción por el modelo con la decisión del backend (2 llamadas) | Más natural | Doble costo y latencia; exige validar el texto generado; posibilidad de inventar |
| C. Una llamada que extrae y redacta | Barato | El texto puede contradecir la decisión del backend |

**Decisión propuesta: A.** La sensación de "agente moderno" viene de entender texto libre, varios
datos en un mensaje, correcciones y aclaraciones, no de prosa generada. Las plantillas usan el
nombre del cliente y un saludo solo en la primera respuesta. Se puede pasar a B en una V2 con
evidencia.

---

## ADR-08 · Gemini por el contrato existente, credencial propia — DECIDIDA / PROPUESTA

**Decisión.**
- Se usa `lib/ia-proveedores` **sin modificarlo**, con el modelo `gemini-3.6-flash` y
  `env:GEMINI_KEY_PUBLIBORDADOS`, que el patrón de `CREDENTIAL_ENV` ya admite.
- Sin fallback de proveedor ni de clave.
- Fallo → repregunta con plantilla; 2 fallos seguidos → handoff `ia_no_disponible`.
- Nunca cae a legacy.

**Nota.** El contrato solo ofrece `toolMode: "auto" | "none"` (Gemini `VALIDATED`). No hay modo
"llamada obligatoria". PB trata una respuesta sin llamada a la herramienta como salida
malformada; no hace falta modificar el contrato.

---

## ADR-09 · UX de productos (4 opciones, máximo 3 botones) — PROPUESTA

**Restricción verificada.** Los botones de respuesta de WhatsApp admiten como máximo 3, con
títulos de hasta 20 caracteres (`lib/whatsapp-outbound.ts`). Los mensajes de lista admiten
hasta 10 filas, pero `list_reply` no está soportado en el webhook global.

**Opciones analizadas.**

| Opción | Toques por opción | Pros | Contras |
| --- | --- | --- | --- |
| **A. [🧢 Gorras] [👕 Prendas de vestir] [➕ Más opciones] → [🦺 Uniformes] [🧵 Otros] [↩️ Volver]** (preferencia inicial; propuesta) | 1 para Gorras y Prendas; 2 para Uniformes y Otros | Botones visibles, sin dependencia nueva, reversible con "Volver"; texto libre aceptado en ambas páginas | Uniformes y Otros quedan un paso más lejos |
| B. Mensaje de lista ("Ver productos" → 4 filas con emoji y descripción) | 2 para todas (abrir y elegir) | Las 4 opciones en una sola pantalla | Se descubre peor en algunos clientes; con el gancho B de ADR-02, PB recibe `list_reply` crudo **sin** tocar el soporte global, pero el registro síncrono de `POST()` no lo guarda en `dulabs_mensajes_log` (la asesora lo ve igual en su teléfono) |
| C. [🧢 Gorras] [👕 Prendas] [🦺 Uniformes] + "¿Otro producto? Escríbenos cuál" | 1 para 3 opciones; texto para Otros | La más rápida | "Otros" deja de ser un botón (no es lo que pidió el cliente) |
| D. Lista numerada en texto | Escribir | Sin límites | Se siente como un formulario antiguo |

**Decisión propuesta: A.** Motivos:
1. Respeta la preferencia expresada y la experiencia de botones.
2. Las dos opciones más frecuentes (probablemente Gorras y Prendas, a confirmar con datos) quedan
   a un toque.
3. No depende de `list_reply` ni de cambios en el registro síncrono.
4. "Más opciones" es un estado de UI (`ui.productos_pagina`), no una etapa de negocio: un texto
   libre ("uniformes") funciona en cualquier página.

Queda B como alternativa si las trazas muestran abandono en la página 2.

**Detalle.**
- "👕 Prendas de vestir" cabe en 20 caracteres; si Meta lo trunca en algún cliente, se usa
  "👕 Prendas".
- IDs versionados: `pb1:prod:gorras | prendas_de_vestir | mas | uniformes | otros | volver`.
- Un botón viejo se procesa por su ID, no por su posición.
- **Verificado en la Fase 0 (`04` §13):** `enviarBotones` no valida la cantidad de botones, la
  unicidad ni los ids, y recorta el título con `slice(0,20)` en unidades UTF-16. PB valida antes
  de llamarlo, con una función pura, y **no** modifica el wrapper. Los 8 títulos miden ≤ 20
  unidades ("👕 Prendas de vestir" = 20 exactas).

---

## ADR-10 · Concurrencia: buzón + lease con epoch + supresión de respuesta superada — PROPUESTA

**Decisión.**
- Buzón con PK `wamid`.
- Lease de 90 s por conversación mediante RPC atómica; `epoch` como fencing token.
- Ventana de coalescencia de ~1,5 s.
- La barrera 3 rechaza el envío si llegaron entradas nuevas (re-ejecución acotada a 2).
- Soltar el turno es atómico ("si quedan pendientes, sigo").

**Descartado:**
- `dulabs_chat_lock`: es de mejor esfuerzo y procesa igual a los 20 s.
- El buzón y el turno de `lib/agente`: son tablas y RPC del agente de catálogo; usarlos acopla PB
  a Delacour.

---

## ADR-11 · Idempotencia por constraints — PROPUESTA

Ver `02` §11. Principio: **como máximo una vez** para envíos (slot único reservado antes de
enviar) y **exactamente una vez** para transiciones y eventos (CAS + `unique`). Nada depende de
banderas en memoria.

---

## ADR-12 · Media → registro + handoff sin interpretar — PROPUESTA (detallada en la Fase 0)

**Decisión** (tabla completa en el `04` §17). Imagen, audio, documento, video, ubicación, contacto
o tipo desconocido en `AI_ACTIVE`:
1. registro en `dulabs_mensajes_log` con contenido fijo (`[imagen]`…), idempotente por `wamid`, y
   marca de `procesado_at`;
2. buzón con el tipo;
3. handoff `media_recibida` con el mensaje final.

En `HUMAN_ACTIVE`: solo el registro. Los stickers se registran sin respuesta; las reacciones se
ignoran. Nunca va a Gemini. No se guarda el pie de foto ni el id del archivo.

**Motivo.** En bordados, una foto suele ser el logo: es un lead para una persona. El mensaje no
desaparece: queda en el historial de DuLabs y la asesora lo ve en el teléfono.

---

## ADR-13 · Cron `seguimiento-traspaso` — PROPUESTA (revisada en la Fase 0)

**Hechos verificados** (`04` §10):
- no está en `vercel.json` ni en ningún workflow;
- su comentario dice que no está programado en QStash (**NO VERIFICADO**: V4 y C6);
- la consulta no tiene filtro de tenant;
- envía el mensaje de "Dani".

**¿Afecta a PB?** Solo si existe una pausa compartida en un chat de PB:
- PB no las escribe;
- hoy los ecos tampoco (`04` §0);
- queda el Inbox "tomar".

Si alguien corrige el defecto global de ecos, cada mensaje de la asesora crearía una pausa y el
cron (si está activo) enviaría el mensaje de "Dani" en **todos** los tenants con Coexistence.

**Decisión propuesta:**
- no tocar el cron mientras V4 y C6 no demuestren que está activo;
- runbook: no usar "tomar" del Inbox en el número de PB;
- si está activo, o antes de corregir el defecto de ecos: filtro opt-in explícito
  (vacío = no envía), inicializado con los números de Daniela, probado con el patrón
  `soloPhoneNumberId`, en un PR separado **con tu aprobación**. Es un cambio de comportamiento
  para otros tenants: dejan de recibir un mensaje que no les corresponde.

**Descartado:** que PB marque `seguimiento_enviado = true` en filas compartidas.

---

## ADR-14 · Gates de seguridad dentro de PB — PROPUESTA

| Gate | En PB |
| --- | --- |
| Lista negra | Se respeta (`esTelefonoBloqueado`) |
| `ia_pausada` | No se respeta (ADR-03); el interruptor de apagado es `modo` |
| `ia_restringida_a` | Sustituido por `modo = 'qa'` + `qa_remitentes` |
| Pausa compartida | Barrera 2, fail-closed |
| Encuestas, campañas, onboarding | No se ejecutan en el número de PB; el checklist exige no configurarlos |

---

## ADR-15 · Cupo mensual de IA del plan — DECIDIDA (propuesta c)

Cupo agotado → `HUMAN_ACTIVE` con `motivo = cupo_agotado`, **sin enviar** (enviar consumiría
cupo). La asesora atiende desde el teléfono. Plan contratado por PB: **[VERIFICAR con C7]**.

---

## ADR-16 · Datos personales y retención — PROPUESTA

- Se guardan `wa_id` (necesario para responder) y `nombre` (dato de negocio solicitado).
- El texto del buzón se pone en `null` al procesarse.
- Eventos y trazas: sin texto libre, sin nombre, sin teléfono; `name_captured` guarda solo la
  longitud.
- Gemini recibe solo el texto pendiente del turno.
- Retención: trazas 90 días; conversaciones y calificaciones mientras el tenant esté activo
  **(ABIERTA, D7)**. La purga se hará sin crons nuevos compartidos (por ejemplo, borrado
  oportunista en la propia RPC o un cron propio de PB, a decidir).

---

## ADR-17 · Devolución a IA — PROPUESTA

- En V1 la única salida de `HUMAN_ACTIVE` es la RPC `pb_devolver_a_ia(conv, actor, motivo)`,
  ejecutable solo con `service_role` desde el runbook, con evento auditado.
- Abre un ciclo nuevo con datos vacíos.
- El "Devolver a IA" del Inbox **no** la invoca.
- Un botón en DuLabs, si se quiere, será un endpoint aparte, autenticado, con rol `admin` y
  validación del tenant, en una versión posterior.

---

## ADR-18 · Ecos de Coexistence: parser propio de PB; el defecto global no se corrige en V1 — PROPUESTA (Fase 0)

**Contexto.** El webhook lee `value.smb_message_echoes`; según la referencia de Meta (citada por
fuentes secundarias) y dos proyectos que corrigieron lo mismo, el arreglo llega en
`value.message_echoes` (`04` §0).

**Decisión.**
- PB lee `value.message_echoes` y, por tolerancia, `value.smb_message_echoes` y `messages` con
  `from == display_phone_number`. Registra en modo sombra cuál llega.
- PB registra el eco en `dulabs_mensajes_log` como `manual` (idempotente por `wamid`), para que el
  historial de DuLabs quede completo.
- **No** se corrige el manejador global en V1: es un cambio global y activaría el riesgo del cron
  (ADR-13) para todos los tenants. Se reporta como defecto de plataforma, con su propio plan
  (cron filtrado primero, parser después).

---

## ADR-19 · Interruptor maestro y modo sombra — PROPUESTA (Fase 0)

**Decisión.**
- `PUBLIBORDADOS_ENABLED` (entorno, por defecto `false`): sin él, los ganchos no leen nada.
- `dulabs_pb_config.modo` por número: `apagado` · `sombra` · `qa` · `activo`.
- En `sombra`, PB es dueño del número pero **solo** escribe `dulabs_pb_observaciones`: sin buzón,
  sin Gemini, sin envíos.
- Ningún `phone_number_id` en el código; la fila se inserta por el runbook.

Diseño en el `04` §6–§7.

---

## Decisiones de negocio de V1 (cerradas por el responsable)

| Tema | Regla |
| --- | --- |
| Tipo | Persona natural / Empresa |
| Nombre | "¿Cuál es tu nombre?" (un solo campo, sin pregunta por la empresa) |
| Producto | Gorras / Prendas de vestir / Uniformes / Otros (dos páginas de botones; sin descripción libre de "Otros") |
| Cantidad | "¿Cuántas unidades necesitas?" → `>= 6` mayorista, `< 6` detal; ambos al asesor |
| Varios productos | Una aclaración; si se repite → handoff `varios_productos` |
| Cliente que regresa | `HUMAN_ACTIVE` permanente; devolución solo explícita |
| Media | Registro + handoff, sin interpretar |

---

## ADR-20 · Identificación IA frente a asesora sin texto como autoridad — PROPUESTA (Fase 0, ronda 2)

Un eco es propio **solo** si su `id` coincide con un `wamid` registrado en `dulabs_pb_envios`
(la respuesta de la API al enviar). Mientras hay un envío en curso sin `wamid`, la
clasificación espera como máximo el plazo de envío y vuelve a comparar. El hash del texto se
guarda solo como diagnóstico. Detalle en el `04` §23.

## ADR-21 · P6–P10 como compuertas de aceptación, no como salida de la Fase 0 — PROPUESTA

P6–P10 prueban el comportamiento de PB, que todavía no existe; exigirlas antes de escribirlo es
circular. Pasan a ser **obligatorias antes de `modo = 'activo'`**, ejecutadas en QA con
teléfonos internos. La carrera se provoca con un proveedor de IA simulado de latencia
configurable, solo en QA y nunca como espera en producción. La Fase 0 se cierra con P1–P5,
C1/C3/C10, M1/M2 y Q1/C6 (`04` §27).

