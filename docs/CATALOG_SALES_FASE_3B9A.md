# catalog_sales · Fase 3B.9A — Aprovisionamiento de Aquí Sí Lo Compras (sin activar)

Estado: **código, SQL y pruebas listos; NADA aplicado en producción.** Sin commit, push ni merge. ASLC sigue pausado y restringido; el cierre con aceptación
humana sigue apagado (constante del código `FUNCIONES_3B_IMPLEMENTADAS.cierre_aceptacion_humana = false`); Patricia no se creó; el catálogo real no se cargó;
ningún mensaje se envió a ningún cliente.

## Lo que la sesión del 2026-10-02 NO pudo hacer (y por qué; el 2026-10-03 la lectura de solo lectura SÍ fue posible: ver §0)

Desde esta sesión no hay un canal autorizado para leer ni escribir en la base de producción (en fases anteriores las lecturas fueron bloqueadas y las
verificaciones las corrió el dueño en el SQL Editor; no se reintentó). Por eso **no se pudo confirmar el estado real** ni aplicar nada. Lo que sí quedó listo es
el paquete `supabase/provisioning/aslc/` (ver su README): una consulta de solo lectura que devuelve TODO el estado en un JSON sin secretos, el script de
aprovisionamiento (transaccional, con guardas, probado con datos ficticios en un Postgres local efímero) y su reversa.

## 0. Estado REAL de producción — verificado el 2026-10-03 (solo lectura, sin cambios)

Se leyó la base de producción con consultas `select` (sin secretos en la salida: tokens solo como "existe") y las variables de Vercel **solo por nombre**. No se escribió nada.

| Dato | Valor verificado |
|---|---|
| Negocio | `dulabs_clientes_config`: UNA fila, nombre "Aqui Si Lo Compras" (sin tilde), tenant `320121d7-2bc5-472d-944b-5191cc228e1f`, phone_number_id `1317599831437793` (coinciden con la Fase 3A) |
| Teléfono registrado | termina en **…8509** (no en …5088, el que informó el negocio). Conectado, calidad GREEN, nombre visible `NON_EXISTS`, verificación `NOT_VERIFIED` |
| IA | `ia_pausada = true`, `ia_restringida_a = …7388`, sin números bloqueados, `flow_activo = false` |
| Credenciales | token Meta propio: **existe**; WABA: existe; clave Gemini heredada y prompt heredado: no hay |
| Agente de ASLC | **sin fila** en `dulabs_agente_runtime_config` (la única fila de la plataforma es la de Delacour) |
| Módulos de ASLC | **ninguna fila**: ni `catalogo`, ni `pedidos`, ni `pedidos_por_aceptar` |
| Equipo | un solo miembro: admin "Aquí Si Lo Compras" (id 2776, activo). **No existe una persona responsable (Patricia)** |
| Catálogo y pedidos | 0 productos, 0 pedidos, 0 notificaciones |
| Inbox | 13 mensajes (7 entrantes / 6 salientes), del 2026-09-30 al 2026-10-02, 2 interlocutores (…4645 y …5088) |
| Vercel (producción) | `GEMINI_KEY_ASLC` **NO existe** (solo `GEMINI_KEY_DELACOUR`, `GEMINI_DU` y `GEMINI_KEY`) |
| Migración 20261208 | no verificable por API (es un CHECK de la tabla); ver sección K |

**Dos hallazgos que cambiaron el paquete:**

1. **El `02` original abortaba siempre.** Identificaba la fila por `telefono_negocio` (el que informó el negocio), pero la base tiene otro teléfono registrado → 0 filas. Fallaba seguro (no cambia nada) pero bloqueaba el aprovisionamiento. Ahora identifica por **tenant + phone_number_id + nombre** y nunca usa `telefono_negocio` (`IDENTIDAD_ASLC_PRODUCCION`).
2. **Sin el módulo `catalogo` no se pueden cargar productos** (gatea todo el catálogo: panel, API, importación y publicación) y ASLC no tenía ninguna fila de módulos. Ahora el `02` lo habilita junto con `pedidos` y `pedidos_por_aceptar`.

**Discrepancias que debe resolver el dueño:**

- **Teléfono.** El negocio informó un número que termina en …5088; la base tiene conectado a Meta uno que termina en …8509. Un interlocutor del número conectado termina en …5088, es decir, el informado se comporta como un teléfono de cliente/dueño y no como la línea conectada. Hay que confirmar CUÁL es la línea que atenderá el agente y que esa sea la conectada por Coexistence.
- **Correo.** Hay dos versiones del correo del negocio (la de la versión anterior de este doc y la del mensaje del dueño del 2026-10-03). Ningún código lo usa; confirmar la correcta. No se publica aquí: el repositorio es público.
- **`GEMINI_KEY_ASLC`** debe crearse (clave propia de Google AI Studio) y cargarse en Vercel, solo en Production. Sin ella el agente queda inválido y calla.

**Verificación del SQL corregido (base local efímera, nunca producción):** 30 comprobaciones sobre el DDL real de las migraciones (20261109–20261207) y la forma real de los datos de ASLC: `02` aprovisiona sin error; deja la fila deshabilitada, con candado, solo contra entrega y sin `confirm_order`; los tres módulos quedan habilitados y ningún otro; `ia_pausada`/`ia_restringida_a`, Delacour y un negocio señuelo con nombre parecido quedan **idénticos**; repetir `02` aborta; cada guarda aborta sin dejar cambios; `04` revierte y se puede volver a aprovisionar; `01` no modifica nada, no filtra secretos y alerta si hay más de una fila parecida a ASLC.

## A. Tenant

- Datos entregados por el negocio: WhatsApp (termina en **…5088**), correo (no se publica: el repositorio es público) y nombre **Aquí Sí Lo Compras**.
- Identificadores de la Fase 3A, **verificados el 2026-10-03** contra la base (ver §0): tenant `320121d7-2bc5-472d-944b-5191cc228e1f`, phone_number_id `1317599831437793`,
  número de prueba autorizado `…7388`. El script 02 actúa SOLO si coinciden los tres (tenant + phone_number_id + nombre), exige exactamente UNA fila y aborta si no
  coincide; el 01 muestra además el teléfono registrado (enmascarado) para que se vea la discrepancia con el informado.
- WABA y token de Meta: existen (verificado); el 01 los entrega enmascarados: WABA con 4+4 dígitos, token solo "existe / largo".

## B. Estado inicial (VERIFICADO el 2026-10-03, ver §0)

`ia_pausada = true`; `ia_restringida_a` = número de prueba del dueño; **sin fila de agente** (la única de la plataforma es la de Delacour); `cierre_aceptacion_humana`
= `false` (constante del código); **módulos de ASLC: ninguna fila**; migración 20261207 aplicada (verificada por el dueño el 2026-10-02); 20261208 no verificable por API.

## C. Estado final preparado (al correr 01 → 02 → 01)

Sin cambios en `ia_pausada` ni `ia_restringida_a`. Fila del agente creada **deshabilitada** y con **candado de activación**; módulos `catalogo`, `pedidos` y
`pedidos_por_aceptar` habilitados; nada más. Hoy, en producción, **no cambió nada** (el `02` está listo y probado, esperando la autorización del dueño).

## D. Módulos

| Módulo | Acción | Razón |
|---|---|---|
| `pedidos` | habilitar | Dashboard → Pedidos (necesario para "Por aceptar") |
| `pedidos_por_aceptar` | habilitar | menú, página y API de aceptación humana (3B.7); sin él no existen para el negocio |
| `notificaciones_pedidos` | **NO** | solo se necesita para los mensajes tras aceptar/rechazar/cancelar, cuyos textos están sin aprobar; además activaría las plantillas del Bloque 31 de Delacour (💖) en las etapas posteriores |
| `catalogo` | **habilitar** (cambió el 2026-10-03) | sin él no se pueden cargar ni actualizar productos, precios y fotos (panel, API, importación y publicación); ASLC no tenía ninguna fila de módulos |

El script habilita SOLO `catalogo`, `pedidos` y `pedidos_por_aceptar`; el 01 compara la huella de módulos de TODOS los negocios: tras aprovisionar, solo debe cambiar la de ASLC (Delacour
intacto; verificado en la base local con datos ficticios).

## E. Configuración (fila base)

`habilitado = false` · `tipo catalog_sales` · Gemini `gemini-3.6-flash` (único modelo soportado por el registro) · credencial `env:GEMINI_KEY_ASLC` (propia) ·
`canal retail` · `vocabulario null` (neutral) · `clasificacion_cliente`, `checkout_conversacional`, `transcripcion_audio` = false · `meta_token_plataforma = false`
(no usa el token de la plataforma: necesita su token propio de Meta) · herramientas = todas **menos `confirm_order`** (la aceptación es de una persona; el modelo no
confirma) · `negocio = { nombre_negocio }` (sin saludo, sin conocimiento, sin políticas: nada inventado) · `checkout_opciones = { entregas: ["domicilio"], pagos:
[contra_entrega], activacion_pendiente: true }` (solo contra entrega; ni pago en tienda, ni transferencia, ni link de pago, ni recoger en tienda).

**Cuatro candados** contra una activación accidental: (1) `ia_pausada = true`, (2) fila `habilitado = false`, (3) `activacion_pendiente: true` (con la fila habilitada
por error la configuración es inválida y el agente calla; **nuevo en esta fase**), (4) la compuerta `cierre_aceptacion_humana` del código.

## F. Patricia — `PATRICIA_REAL_PENDIENTE`

No hay en el repositorio ningún dato real de la persona responsable (nombre, `miembro_id`, rol, correo, canal). No se creó nada ni se usó un id inventado. Para activar
hacen falta: nombre real, que sea miembro **activo** del equipo de ASLC (el 01 lista `equipo_aslc`), `miembro_id`, respaldo (opcional) y canal de aviso (`panel` hoy). El
backend valida que sea del mismo negocio y esté activo (3B.5); puede aceptar/rechazar/cancelar solo ella, su respaldo y, si el negocio lo decide, los administradores.

## G. Gemini — `GEMINI_CREDENCIAL_PENDIENTE`

No se puede verificar la variable en Vercel desde aquí. Debe existir **`GEMINI_KEY_ASLC`** (solo en el entorno de producción, valor propio de ASLC). Sin ella el agente
queda inválido y calla (`credential_missing`); nunca usa `GEMINI_KEY_DELACOUR`, `GEMINI_KEY` ni otro proveedor (probado). Límites por defecto: 8 turnos/min y 300/día por
cliente, 20 M tokens/día por negocio; 4 rondas, 8 herramientas y 1 escritura por turno; 45 s por turno y 15 s por llamada al modelo; si Gemini falla: mensaje técnico
fijo y, al segundo fallo seguido, una persona (nunca otro bot).

## H. Audio

Infraestructura de 3B.2 lista y probada con ASLC: descarga con el token de Meta del negocio, transcribe con SU clave de Gemini, el texto entra al flujo normal y, si no
se puede (error, sin voz, formato, tamaño, sin token, tope de costo), se pide escrito. En el aprovisionamiento queda **apagado** (`transcripcion_audio = false`): el audio
se enciende en la activación, solo si las pruebas reales salieron bien. Requiere el token propio de Meta del número y `GEMINI_KEY_ASLC`.

## I. Textos — `TEXTO_PENDIENTE`

Aprobado y guardado EXACTO en `textos-aprobados.json`: **el aviso obligatorio** (747 bytes, SHA-256 `c0bf58e0…175a`). **Pendientes (no se rellenó ninguno):**
`tras_aviso_confirma` (el dueño dio un ejemplo, no un texto aprobado), `aceptado`, `rechazado`, `cancelado`, `saludo`, `envios.sin_cobertura`,
`envios.cobertura_no_verificable`, `envios.error_consulta` y los textos de tiempos (Bogotá, antes/después de las 11:30, resto con cobertura).

## J. Envíos

Aprobado: envío gratis; Inter Rapidísimo como transportadora habitual; otras ciudades normalmente 2 a 3 días hábiles; Bogotá antes de las 11:30 a. m. puede tener entrega el
mismo día; sin certeza, una persona. **No se pudo configurar el bloque `envios`:** el esquema exige la cobertura (lista de ciudades o "todo el país salvo…") y los textos de
tiempos, y no existe una fuente real de cobertura ni textos aprobados (`COBERTURA_PENDIENTE`, `TEXTO_PENDIENTE`); tampoco se entregaron los días de la regla horaria ni la política de
festivos. Una lista ficticia o "todo el país" sería convertir la ausencia de información en cobertura. **Comportamiento hasta entonces (fail-closed, probado):** cualquier
pregunta de envío pasa a una persona; el guardián de afirmaciones sobre envíos ahora actúa también sin reglas cuando el número tiene la herramienta `consultar_envio`, así que el
modelo no puede decir "gratis", tiempos, cobertura ni transportadora.

## K. Migración 20261208 (`…pedido_notificaciones_aceptado.sql`) — NO ejecutada

- **Contenido:** amplía el CHECK de `tipo` de `dulabs_catalogo_pedido_notificaciones` con `'aceptado'` (rechazado y cancelado ya existían). Bloque `do $$`: si la tabla no existe no hace nada;
  quita cualquier CHECK que liste los tipos y crea `dulabs_catalogo_pedido_notificaciones_tipo_check` con los 8 tipos. No toca filas, columnas, índices, la clave única ni las políticas.
- **Dependencia:** tabla creada por `20261130000000_dulabs_catalogo_pedido_notificaciones.sql` (el 01 informa si existe).
- **¿Aplicada?** No se pudo comprobar. El 01 lo dice: `migraciones.m20261208_aplicada_tipo_aceptado` (true si la definición del CHECK incluye `aceptado`).
- **¿Es peligroso aplicarla de nuevo?** No: es idempotente (probada dos veces en la base local) y solo reemplaza un CHECK en una tabla pequeña (bloqueo muy breve).
- **Si NO está aplicada, SQL exacto:** el contenido de `supabase/migrations/20261208000000_dulabs_catalogo_pedido_notificaciones_aceptado.sql` (ya en el repositorio, sin modificar).
  **Impacto:** habilita el registro idempotente del aviso "aceptado"; sin ella, ese aviso queda "no disponible" y no envía nada (rechazado/cancelado no dependen). Mientras no haya textos aprobados ni el módulo
  `notificaciones_pedidos` encendido, no sale ningún mensaje de todos modos.
- **Comprobaciones previas:** 01 → `tabla_notificaciones_existe = true` y `m20261208_aplicada_tipo_aceptado = false`.
- **Comprobaciones posteriores:** 01 → `m20261208_aplicada_tipo_aceptado = true` y un único CHECK de tipo (`check_tipo_notificaciones` con un solo elemento).
- **Rollback:** `supabase/rollbacks/20261208000000_dulabs_catalogo_pedido_notificaciones_aceptado.down.sql` (se niega a correr si ya hay filas `aceptado`).
- **No es urgente ni bloquea 3B.9B/QA:** hace falta antes de activar los avisos al cliente. Requiere tu autorización expresa para aplicarla.

## L. Aislamiento (pruebas)

ASLC no hereda de Delacour: prompt, saludo por defecto, métodos de pago, entregas, textos del checkout, productos, fotos, precios, pedidos ni credencial (pruebas con ambos negocios en
la misma base en memoria). **Dos fugas reales encontradas y corregidas** (solo para negocios con vocabulario NEUTRAL; Delacour y los demás: el texto de siempre, byte a byte): (1) el
saludo por defecto con 💍 (`DEFAULT_WELCOME`) si un negocio con clasificación de clientes no tenía saludo propio; (2) la regla 14 del prompt, que daba "aretes, collares, anillos" como ejemplo a
TODOS los modelos. Delacour no recibe nada de ASLC: no tiene la herramienta `consultar_envio`, ni `envios`, ni `cierre`, ni audio.

## M. Legacy — hallazgo y garantía

El webhook evalúa, en este orden: pausa del número → restricción → **agente conversacional** → Business Agent → Flow → legacy. **Sin fila de agente** (kind `none`) el mensaje cae a esos caminos; **con fila**
(aunque esté deshabilitada, inválida o sin credencial) el mensaje es del agente (`handled: true`): silencio, nunca otro bot. Por eso el aprovisionamiento crea la fila base ya, y por eso
tiene el candado. Matriz probada (todas `handled: true`, nada enviado, ningún modelo): fila deshabilitada, fila habilitada por error (candado), configuración completa con la compuerta cerrada,
falta la credencial de Gemini, sin credencial de Meta propia, configuración ilegible, guardia de aceptación ausente o ilegible, dependencias del runtime no disponibles; y en el turno: Gemini caído
(mensaje técnico fijo; dos fallos → persona), una herramienta que falla (no sale lo inventado).

## N. Pruebas

`lib/agente/aprovisionamiento-aslc.test.ts` (48) + 22 mutaciones (cada una rompe una garantía y la suite falla; archivos restaurados con hash verificado). Doce casos con catálogo vacío (saludo, pregunta
general, producto sin catálogo, precio sin producto, envío, ciudad desconocida, persona, pago anticipado, Nequi, transferencia, audio, fuera de conocimiento): lo que no se sabe se responde con
"no encontré" o pasa a una persona; precios, referencias, productos, tiempos y costos inventados no salen. SQL: base local efímera (pglite) con datos ficticios — aprovisiona, se niega a
repetir, cada guarda aborta sin dejar cambios, la reversa deja todo como estaba y Delacour queda idéntico.

**Límite conocido:** una afirmación SIN cifras ni referencias sobre políticas del negocio (garantía, dirección, horarios) no tiene un guardián determinista: depende del modelo y del prompt (regla 2) y de que el
negocio cargue su información oficial (`negocio.conocimiento`). Debe revisarse con Gemini real en el QA (pendiente: la credencial).

## Cambios de código de esta fase (todos aditivos y solo para el negocio que los necesita)

- `checkout_opciones.activacion_pendiente` (candado) + motivo `activation_pending` en `lib/agente/config.ts`.
- Negocio NEUTRAL: saludo por defecto sin 💍 y regla 14 sin ejemplos de joyería (`esVocabularioNeutral`, `platformRulesFor`).
- Respuesta fija a pagos no ofrecidos (Nequi, Daviplata, transferencia, anticipo…) fuera del checkout, solo con cierre por aceptación humana (`respuestaPagoNoOfrecido`).
- Guardián de envíos activo si el número tiene la herramienta `consultar_envio` aunque no haya reglas.
- `lib/agente/aprovisionamiento.ts` + `scripts/generar-aprovisionamiento-aslc.ts` + `supabase/provisioning/aslc/`.

## Hallazgos para el catálogo real (no se cargó nada)

El módulo reutilizable soporta: nombre, referencia comercial (la genera la base; formato `XX-000001`), descripción, color, material, precio detal/mayor, stock y estado (ACTIVE/INACTIVE), disponibilidad
(agotado con stock 0), fotos (hasta 12 por producto, una principal), productos similares, búsqueda por nombre/color, envío de foto por WhatsApp, actualización de precio/stock/descripción/estado sin
desarrollo y carga masiva (planilla XLSX/CSV + fotos). **Requisito operativo:** las fotos y el enlace del catálogo salen de la **publicación** del catálogo del negocio; sin publicarlo (`catalog_not_published`)
no se envía ninguna foto. No hay modelo de variantes: cada color o referencia es un producto con su `color`.

## Qué falta

**Para cargar el catálogo:** correr 01 (y pegar el resultado) y 02 con tu autorización; confirmar que `catalogo` está habilitado para ASLC; publicar el catálogo; los datos de los ~12 productos (nombre,
descripción, precio, stock, color/referencia, fotos); usuarios del equipo en el Dashboard; decidir si se usa `marca_referencia`.

**Para activar (3B.9B+, solo con tu autorización expresa):** responsable real (Patricia) y su `miembro_id`; textos aprobados (respuesta al "sí", aceptado/rechazado/cancelado, saludo, textos de envíos);
fuente real de cobertura y textos de tiempos de entrega (días de la regla horaria y festivos); decisiones D1–D18 pendientes (reserva, vencimiento, quién acepta, validación del resumen, documento, oficina…);
`GEMINI_KEY_ASLC` en Vercel; token de Meta propio del número (verificar); aplicar la migración 20261208 si se quieren los avisos al cliente; decidir `notificaciones_pedidos`; QA completo con Gemini real y catálogo
real; luego, en este orden: configuración completa (sin candado), `cierre_aceptacion_humana = true` en el código y despliegue, audio, `habilitado = true`, y al final quitar `ia_pausada`/`ia_restringida_a`.
