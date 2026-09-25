# Piloto de Delacour — preparación técnica (Bloque 24)

Estado al **24-sep-2026**. Este documento es el puente entre "probado localmente" y "piloto real":
qué quedó comprobado con el código real, qué solo se puede comprobar en producción y la lista
exacta de pruebas manuales para cuando se encienda Gemini.

**Veredicto: READY a nivel de código, CONDICIONADO a producción.**
- El sistema está listo **en el código**: la matriz de punta a punta pasa completa con el webhook
  real y PostgreSQL real.
- **No se verificó producción**: desde el entorno de desarrollo no hay acceso a Supabase, dulabs.co,
  Meta ni la clave de Gemini.
- Antes de encender deben quedar sin filas **CRITICO**:
  - `scripts/piloto/verificacion-produccion.sql` (solo lectura);
  - `scripts/piloto/auditar-fotos.mjs` (solo lectura).

---

## 1. Barreras del piloto (todas en el backend, antes de Gemini)

| Barrera | Dónde | Comprobado |
| --- | --- | --- |
| Números autorizados (`ia_restringida_a`) | webhook, antes del agente | E2E: el no autorizado no llega a Gemini ni recibe respuesta; su mensaje queda en el Inbox |
| Apagado inmediato (`ia_pausada = true`) | webhook | E2E: al activarlo, silencio; al volver a `false`, responde |
| Agente apagado (`habilitado = false`) | frontera del agente | E2E: silencio, sin caer a la IA legacy ni a otro proveedor |
| Proveedor distinto de Gemini | **CHECK en la BD** + registro | E2E: la BD rechaza `proveedor = 'anthropic'` (23514); modelo no soportado o herramientas desconocidas => fail-closed |
| Sin `GEMINI_KEY_DELACOUR` | registro de proveedores | E2E: fail-closed (`credential_missing`), sin respuesta |
| Asesora a cargo (pausa del chat) | webhook + última barrera antes de enviar | E2E: tras "quiero una asesora", ni Gemini ni respuesta |
| **Asesora que responde desde el celular** | webhook (eco de coexistencia) | **Corregido en B24**: antes el eco dejaba la pausa en 30 min y el agente volvía a hablar en medio de una conversación humana |
| Devolver a la IA (Inbox) | `liberarPausaChat` | E2E: el agente vuelve a responder |
| Aislamiento entre negocios | registro de fotos por negocio+número+cliente; herramientas por negocio | E2E: el cliente de otro negocio que cita una foto de Delacour no obtiene nada |
| Tope por cliente (8 mensajes/min, 300/día) | backend, antes de Gemini | E2E: pasado el tope, ni Gemini ni respuesta (`rate_limited`) |

Ninguna barrera depende de Gemini ni del prompt.

## 2. Diagnóstico de producción (sin datos personales)

Cada turno queda en `dulabs_agente_trazas` y se consulta con
`select * from dulabs_agente_diagnosticar('<tenant>', '<teléfono>', 30)`: el teléfono se convierte
en el mismo hash que guarda la traza y nunca se almacena.

| Qué | Dónde |
| --- | --- |
| 1. Mensaje recibido | `wamid` + `input` (cantidad y largo; el texto vive solo en el Inbox) |
| 2. Intención | `intencion` (lista cerrada) |
| 3–4. Herramienta y parámetros | `herramientas` (`nombre:resultado`) y `traza.tool_calls[].args` (referencias y números; de los textos libres, solo el largo) |
| 5–6. Validación y resultado del backend | código de resultado de cada herramienta (`ok`, `CHOICE_REQUIRED`, `PRICE_CHANGED`…) |
| 7. Respuesta generada | `traza.grounding` (si se corrigió o se bloqueó) + texto enviado en el Inbox (por `delivery.text_wamid`) |
| 8–9. Envío y Meta | `respuesta_enviada`, `entrega_texto` (enviado/entregado/leído/fallido) y `error_texto` (código de Meta) |
| 10. Asesora | `asesora_motivo` + `asesora_origen` |
| 11–13. Pedido, confirmación y reserva | `pedido` (DL-ORD-…) + `dulabs_catalogo_pedido_eventos` + `dulabs_catalogo_reservas` |

Comprobado en E2E:
- el diagnóstico reconstruye la confirmación (intención "confirmar", `confirm_order:ok`, entregado,
  DL-ORD-…), el intento rechazado por precio y el motivo de la asesora;
- ni las trazas ni los logs del agente contienen teléfonos, la clave de Gemini, el token de Meta ni
  ids internos de productos.

## 3. Matriz de pruebas automatizada

`scripts/piloto/matriz-piloto.e2e.ts`: **42/42**, contra PostgreSQL + PostgREST locales, con el
webhook real y el cliente HTTP real de Gemini. Solo se simulan las respuestas de Gemini y Meta.

| Bloque | Casos |
| --- | --- |
| A | "Hola" (el modelo no recibe el catálogo ni el teléfono; la clave solo en el header), "Busco aretes" (5 de 8, precios del backend), "Muéstrame más" (los otros 3, sin repetir), "aretes dorados" (solo dorados), "Algo parecido" (excluye el base), producto y precio inventados => mensaje fijo |
| B | Precio exacto por referencia; "DL-999999" => no existe; precio inventado para una referencia inexistente => no sale |
| C | Fotos por URL canónica pública + registro conversación→foto→producto; "quiero este" citando la 2.ª foto; "quiero el segundo"; "quiero 2 de este"; "quiero este" sin citar => `CHOICE_REQUIRED` |
| D | Agregar uno, agregar dos, cambiar cantidad, eliminar, consultar: precios, subtotales y total del servidor |
| E | Crear pedido (no aparta stock); **modificar cantidad tras la propuesta** (corregido en B24); precio cambiado antes del "sí" => no se confirma y "confirmado" no sale; producto borrado => ningún pedido; desactivado o sin stock suficiente => borrador con el problema |
| F | "Sí, confirmo" => reserva atómica exacta; reintento de Meta del mismo "sí" => sin segunda reserva; dos confirmaciones simultáneas => una reserva; última unidad entre dos clientes a la vez => una venta, la otra "agotado" |
| G | "Quiero hablar con una asesora" => sin Gemini, pausa 24 h; con la asesora a cargo (aunque conteste desde el celular) el agente calla; devolver a la IA => responde |
| H | Nota de voz => aviso fijo; sticker y reacción => nada; imagen, documento, ubicación y contacto => asesora, Inbox con el tipo, sin coordenadas ni teléfonos |
| Fallas | Gemini 504 => mensaje fijo, y a la segunda falla seguida => asesora; JSON inválido; herramienta inexistente => `TOOL_NOT_ALLOWED`; error de herramienta; Supabase caído; Meta rechaza el texto (código en la traza, sin token); Meta rechaza una foto (no se registra; las demás sí); producto sin foto |

Además, en la suite normal (CI) quedan `B24-1..3` y dos pruebas del eco en el webhook real. Cada
corrección de este bloque se verificó por mutación: al quitarla, su prueba falla.

## 4. Fotos

Revisado en el código y con la app compilada (`next start`) contra la base del piloto:

- **URL que se envía a Meta:** `https://dulabs.co/catalogo/{slug}/productos/{ref}/whatsapp.jpg?v={versión}`.
  Es pública, sin sesión ni cookies y sin rutas de Storage ni ids. La `v` es estable (cambia solo si
  cambia la foto): no depende de una URL temporal o firmada.
- **Formato:** JPEG generado en el servidor desde la original, a 1200 px como máximo, con fondo
  opaco. Queda muy por debajo de los 5 MB que admite Meta (unos 123 KB con la foto sintética de
  1600 px).
- **Redirecciones y aislamiento:**
  - sin `v`, 307 a la canónica;
  - con otra `v`, redirige;
  - otro negocio, producto inactivo, borrado o sin foto: 404 idéntico.
- **Límites y seguridad:** la ruta está excluida del límite de tasa de `/catalogo/*`, así que las
  descargas de Meta no se frenan. La CSP solo aplica a navegadores; Meta descarga de servidor a
  servidor.

**No verificado:** las fotos REALES de Delacour. Se verifican con `auditar-fotos.mjs` (solo
lectura; no reprocesa nada) y con los controles 17–19 de la verificación SQL (formato, medidas,
productos sin foto).

## 5. WhatsApp / Meta

- Texto e imagen por `link` con el formato de la Cloud API; primero el texto, después las fotos.
- Cada foto enviada queda ligada a su `wamid`: el cliente puede responderle sin escribir la
  referencia.
- Si Meta rechaza un mensaje, la traza guarda `meta_rejected <http>/<código>` y el log
  `agent_send_error` guarda `http_status` y `meta_code`, nunca el token ni el texto.
- La entrega real (entregado, leído o fallido) llega por los `statuses` del webhook y el
  diagnóstico la cruza con el turno.

No verificado aquí: el envío real a Meta (sin red hacia `graph.facebook.com`).

## 6. Gemini

- Único proveedor: CHECK en la BD (`proveedor in ('gemini')`), registro con un solo modelo
  soportado (`gemini-3.6-flash`) y ningún proveedor ni modelo por defecto.
- Sin fallback a Claude: la capa del agente no importa Anthropic ni la IA legacy (prueba
  estructural). Con la fila del agente presente, el número nunca cae a otro bot.
- La clave va solo en el header `x-goog-api-key`: nunca en la URL, el cuerpo, los errores ni los
  logs.
- Configuración: `modelo = 'gemini-3.6-flash'` coincide con la especificación del proyecto. **No se
  pudo leer la fila de producción**; lo muestra el control 4 de la verificación SQL. Si difiere, el
  agente calla (fail-closed): no se cambió nada.
- El modelo nunca recibe el catálogo completo: solo reglas, configuración, estado de la
  conversación, historial acotado y los resultados de las herramientas que pida.

## 7. Costo (del código y de las peticiones reales serializadas en la matriz)

| Parte | Tamaño |
| --- | --- |
| Instrucción del sistema (reglas + negocio + estado) | 4,5 KB medida (máx. teórico ~11 KB con la configuración del negocio llena) |
| Declaración de las 16 herramientas | 7,2 KB |
| Historial | ≤ 6.000 caracteres, ≤ 10 turnos, últimas 24 h |
| Mensaje del cliente | ≤ 4.000 caracteres |
| Respuesta | ≤ 1.024 tokens por llamada (+ razonamiento "low") |
| Petición medida en la matriz | promedio 12,4 KB, máximo 14,5 KB ≈ 3.100–4.100 tokens |

Uso por turno:
- **Típico:** 2 llamadas (herramienta + respuesta) ≈ 7.000 tokens de entrada y 100–300 de salida.
- **Peor caso por turno:** 6 llamadas (4 rondas + texto final + 1 corrección), con los resultados
  de hasta 8 herramientas acumulados en el turno ≈ 12–14 mil tokens por llamada. En total,
  ≈ 80.000 de entrada y ≈ 6.000 de salida.

Topes:
- 8 turnos/min y 300 turnos/día por cliente;
- 20 M tokens/día por negocio. Al llegar, pasa a una asesora con un mensaje fijo, sin Gemini.

Estimación del piloto: 5 probadores × 40 turnos × 7.000 ≈ **1,4 M tokens/día**.
Costo = tokens × precio vigente de `gemini-3.6-flash` (no se hicieron llamadas reales para medirlo).

## 8. Fail-safe

En ningún caso de la matriz se inventa un producto o un precio, se confirma sin el backend, se
descuenta stock dos veces ni se responde "pedido confirmado" sin confirmación. Lo último quedó
garantizado por **código** en B24: la guarda de anclaje bloquea esa afirmación si el backend no
devolvió un pedido confirmado en ese turno.

---

## Problemas encontrados y corregidos en B24

1. **El eco de la asesora acortaba la pausa.** Si la asesora contestaba desde el celular tras un
   traspaso (24 h) o tras "tomar" (30 días), la pausa bajaba a 30 min y el agente volvía a hablar.
   Corregido solo para números con agente (legacy intacto).
2. **"Pedido confirmado" dependía del prompt.** Ahora el anclaje lo bloquea sin evidencia del
   backend.
3. **Cambiar la cantidad después de la propuesta quedaba bloqueado** (`CHOICE_REQUIRED`): el
   cliente quedaba en "¿cuál?". Ahora lo que ya está en su pedido abierto cuenta como elegido.

No hubo migraciones.

## Riesgos restantes

1. **`ia_restringida_a` vacío = responde a TODOS.** Formato estricto: solo dígitos con indicativo,
   separados por coma. Otro formato hace que ese número no reciba respuesta (falla segura). Lo
   revisa el control 10.
2. **Sin la fila del agente y con `ia_pausada = false`, el número cae a la IA legacy (Claude).** Lo
   revisa el control 2 (CRITICO).
3. **El tope de 8 mensajes por minuto es silencioso.** Un probador que escribe muy rápido puede no
   recibir respuesta en ese minuto.
4. **El traspaso a asesora pausa 24 h.** Si nadie toma el chat ni lo devuelve en ese plazo, el
   agente vuelve a responder.
5. **Clientes reales no autorizados.** Durante el piloto, los clientes reales que escriban no
   reciben respuesta automática: la asesora debe atenderlos.
6. **Propuesta anterior abierta.** Al cambiar la cantidad se crea una propuesta nueva; la anterior
   queda "pendiente" en el panel hasta que vence (72 h). No es confirmable desde la conversación.
7. **Calidad conversacional sin medir.** Las guardas del backend no dependen del modelo, pero la
   calidad de la conversación con el Gemini real (qué herramienta elige, cómo redacta) solo se
   puede ver en el piloto manual.
8. **Sin verificar desde aquí:** fotos reales, envío real a Meta y la fila real del agente.

---

## Pruebas manuales (cuando se decida encender)

### Antes de encender (solo lectura)
1. SQL Editor: `scripts/piloto/verificacion-produccion.sql`. Ninguna fila **CRITICO**. Revisar las
   ALERTA (fotos, pausas vigentes).
2. Consulta 2 del mismo archivo y luego
   `node scripts/piloto/auditar-fotos.mjs --base https://dulabs.co --slug <slug> --refs-file refs.txt`.
   Sin problemas en las referencias que se usarán.
3. Vercel (Production): existe la variable `GEMINI_KEY_DELACOUR`. Mirar solo que exista, no su
   valor.
4. `ia_restringida_a` = solo los números de prueba. Al final, `ia_pausada = false`.

### Conversaciones (desde un número autorizado, salvo la 1)
1. Desde un número **NO** autorizado: "Hola" → sin respuesta (el mensaje aparece en el Inbox).
2. "Hola" → saludo.
3. "Busco aretes" → lista numerada con precios iguales al panel. "Muéstrame más" → otros sin
   repetir. "Quiero unos aretes dorados". "Algo parecido".
4. "¿Cuánto cuesta DL-xxxxxx?" con una referencia real → precio del panel. "DL-999999" → no existe.
5. "Muéstrame fotos de …" → llegan las fotos.
   - Responder (deslizar) a la 2.ª foto "quiero este" → ese producto.
   - "quiero el segundo".
   - Responder a una foto "quiero 2 de este".
   - "quiero este" sin responder a ninguna → pregunta cuál.
6. Carrito: agregar, cambiar cantidad, quitar, "¿qué tengo?".
7. Pedido: "hagamos el pedido" → total. "mejor que sean 2" → total nuevo. "Sí, confirmo" →
   confirmado; en el panel aparece el pedido con el stock apartado. Luego **cancelarlo desde el
   panel** para devolver el stock.
8. Cambio de precio: con una propuesta pendiente, cambiar el precio de ese producto en el panel y
   responder "sí" → no confirma y explica. **Restaurar el precio**.
9. Asesora:
   - "Quiero hablar con una asesora" → mensaje de traspaso; el Inbox muestra el motivo.
   - Escribir otra vez → sin respuesta.
   - La asesora contesta desde WhatsApp y pasan 30 min → el agente sigue sin responder.
   - "Devolver a la IA" en el Inbox → vuelve a responder.
10. Sin texto:
    - nota de voz (y otra respondiendo a una foto) → aviso;
    - sticker y reacción → nada;
    - imagen, documento, ubicación y contacto (cada uno desde un número distinto, porque cada uno
      pausa el chat) → asesora.
11. Interruptor: `ia_pausada = true` → sin respuestas; volver a `false`.
12. Diagnóstico: `select * from dulabs_agente_diagnosticar('0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4', '<número de prueba>', 30)`
    → intención, herramientas, entrega y pedido de cada turno.
13. Limpieza:
    - cancelar desde el panel los pedidos de prueba (el stock vuelve);
    - devolver a la IA los chats de prueba;
    - pedidos de prueba sin confirmar: vencen solos a las 72 h.

---

# Bloque 25 — Clasificación detal / mayorista por contacto + panel de pedidos

## Qué hace

- **Saludo**: el primer mensaje a un contacto nuevo es un saludo aparte. Por defecto es
  "¡Hola! 💖 Te damos la bienvenida 💍", y cada negocio puede poner el suyo en `negocio.saludo`
  (ver "Activación", paso 5). Si hay que volver a preguntar, el saludo no se repite. Las flechas de
  los botones las dibuja WhatsApp y la API de Meta no permite quitarlas.
- **Contacto nuevo** → el agente pregunta, con mensaje fijo y botones y **sin llamar a Gemini**:
  "¿Tu compra es al detal o al por mayor?" con los botones [Comprar al detal] y
  [Comprar al por mayor]. Si responde otra cosa, se le vuelve a preguntar. Antes de elegir no ve
  ni precios ni catálogo.
- La elección queda **en la base de datos**, no en la memoria del modelo:
  - `dulabs_catalogo_clientes_canal`: una fila por número del negocio + cliente;
  - `dulabs_catalogo_clientes_canal_eventos`: bitácora **inmutable**.
- Si el contacto llega con una solicitud abierta de la tienda, esa solicitud lo clasifica: la
  tienda mayorista exige el enlace firmado; la tienda detal lo deja al detal.
- Cada turno cotiza con el canal del contacto. Las herramientas no aceptan otro canal: un
  argumento `channel` se rechaza. El enlace del catálogo es el del canal del contacto.
- Los pedidos quedan marcados con ese canal y con los precios de ese canal (motor de pedidos
  existente, sin cambios).
- **Pedir el otro canal** ("precio al por mayor", "soy mayorista", "catálogo mayorista") → el
  cliente pasa a una asesora, con mensaje fijo y sin Gemini. Pedirlo no cambia nada.
- **Pedido abierto de otro canal** (por ejemplo, una solicitud de la tienda mayorista de un
  cliente al detal) → pasa a una asesora con el pedido (motivo `order_issue`). El chat no puede
  validarlo ni confirmarlo (`FORBIDDEN`).
- **Cambio de modalidad**: lo hace solo una asesora (admin o agente) desde **Catálogo → Pedidos →
  Pasar a detal / mayorista**. El cambio:
  - exige un motivo;
  - usa compare-and-set: si la modalidad cambió mientras tanto, responde 409 y no toca nada;
  - queda en la bitácora: quién, cuándo, de qué modalidad a cuál y por qué.

  Los pedidos abiertos **conservan su canal y sus precios**, porque nada se recalcula en
  silencio. La asesora los cancela o los cierra. El carrito solo guarda referencias y cantidades,
  así que su precio sale siempre de la modalidad vigente.
- **Panel de pedidos**: cada pedido muestra
  - cliente: nombre, teléfono y modalidad. El teléfono completo solo lo ven admin y agente;
    el rol lectura ve los últimos 4 dígitos;
  - fechas: creado, confirmado y vencimiento (de la reserva o de la propuesta);
  - productos con foto, precio unitario y subtotal;
  - tipo de precio, reserva y asesora (asignada, motivo y quién la pidió).

  Filtros por estado (propuestas, confirmados, con asesora) y por modalidad. Historial: venta
  cerrada, cancelados y vencidos. Acciones: venta cerrada, cancelar, tomar conversación (la misma
  del Inbox), abrir en Inbox y cambiar modalidad. Desde la UI **no** se editan stock, precios ni
  reservas.
- "En preparación" **no existe** en el motor de pedidos (los estados son propuesta, confirmado,
  con asesora, venta cerrada, cancelado y vencido), así que no se muestra.

## Activación (manual, en el SQL Editor de Supabase)

1. Pegar completa `supabase/migrations/20261120000000_dulabs_catalogo_clientes_canal.sql`.
   Es aditiva e idempotente, con RLS y sin políticas (solo service_role). **No cambia nada**
   mientras el interruptor siga en `false`.
2. Verificar la migración (solo lectura):
   ```sql
   select
     (select count(*) from information_schema.columns where table_name = 'dulabs_agente_runtime_config' and column_name = 'clasificacion_cliente') as columna_interruptor,
     to_regclass('public.dulabs_catalogo_clientes_canal') is not null as tabla_canal,
     to_regclass('public.dulabs_catalogo_clientes_canal_eventos') is not null as tabla_bitacora,
     (select count(*) from pg_proc where proname = 'dulabs_catalogo_cliente_canal_fijar') as funcion,
     (select relrowsecurity from pg_class where relname = 'dulabs_catalogo_clientes_canal') as rls_canal,
     (select relrowsecurity from pg_class where relname = 'dulabs_catalogo_clientes_canal_eventos') as rls_bitacora,
     (select clasificacion_cliente from dulabs_agente_runtime_config where phone_number_id = '1428584886997210') as delacour_encendido;
   -- Esperado: 1 | true | true | 1 | true | true | false
   ```
3. Encender **solo** para Delacour, cuando se decida:
   ```sql
   update dulabs_agente_runtime_config set clasificacion_cliente = true
    where phone_number_id = '1428584886997210' and id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4';
   ```
   Para apagar, el mismo `update` con `false`: el agente vuelve a usar la columna `canal`, como
   antes. Las clasificaciones guardadas se conservan.
4. Revisar las clasificaciones y los cambios (solo lectura):
   ```sql
   select canal, origen, count(*) from dulabs_catalogo_clientes_canal
    where id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4' group by 1, 2 order by 1, 2;
   select created_at, canal_anterior, canal_nuevo, origen, miembro_id, motivo
     from dulabs_catalogo_clientes_canal_eventos
    where id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4' order by created_at desc limit 50;
   ```

5. Saludo propio de Delacour (opcional; **solo después** de que esté desplegado el código que lo
   admite, porque un campo desconocido en `negocio` invalida la configuración):
   ```sql
   update dulabs_agente_runtime_config
      set negocio = negocio || '{"saludo": "¡Hola! 💖 Bienvenid@ a Delacour Joyería 💍"}'::jsonb
    where phone_number_id = '1428584886997210';
   ```

## Pruebas

- `lib/agente/agente-clasificacion.test.ts`: pruebas A–L del bloque, más las barreras (inyección
  sin palabras clave, pedido de otro canal, fail-closed y traza).
- `lib/catalogo/pedidos/panel-b25.test.ts`: panel enriquecido, teléfono por rol, fuentes que
  fallan, cambio de modalidad (409, 404 por otro negocio, 400) y adaptadores Supabase.
- `supabase/tests/20261120000000_dulabs_catalogo_clientes_canal.test.sql`: la RPC en PostgreSQL
  (10 controles, incluidos la bitácora inmutable, el aislamiento y RLS).
- `scripts/piloto/matriz-piloto.e2e.ts`, bloque I: webhook real con el botón de Meta, RPC real,
  bitácora inmutable y precio mayorista tras el cambio de una asesora.

---

# Bloque 26 — Flujo inicial: modalidad → intención

Aplica solo a los números con `clasificacion_cliente = true` (hoy, solo Delacour). Ningún paso usa
Gemini hasta que el cliente escribe lo que busca.

1. **Contacto nuevo que saluda**: un solo mensaje con el saludo del negocio (`negocio.saludo`) y
   debajo "¿Tu compra es al detal o al por mayor?", con los botones **🛍️ Compra al detal** /
   **📦 Compra por mayor**. Meta limita cada botón a 20 caracteres y "📦 Comprar al por mayor" no
   cabe; por eso el texto es "Compra …".
2. **Detal** (botón, o si el cliente escribe solo "detal") → queda guardado como DETAL. Luego recibe
   "¡Perfecto! ✨ ¿Qué quieres hacer?" con **🔎 Buscar una joya** / **📖 Ver catálogo**.
3. **Buscar una joya** → "Cuéntame qué estás buscando y te ayudo a encontrarlo. Por ejemplo:
   dijes, aretes dorados, collar corazón…". Lo que el cliente escriba después entra a la búsqueda
   normal del agente, con sus herramientas y sin el catálogo en el prompt.
4. **Ver catálogo** → el backend envía el enlace **real** de la publicación para la modalidad
   **guardada**: detal → tienda detal; mayorista → enlace mayorista firmado. El modelo no interviene.
5. **Mayorista** → queda guardado como MAYORISTA y el agente conversa como antes, con precios y
   catálogo mayoristas.

Cómo se decide la acción de cada botón: por su id (`canal_detal`, `canal_mayor`, `accion_buscar`,
`accion_catalogo`) cuando el id llega, o por el texto **exacto** del botón. En producción los
mensajes pasan por el buzón, que guarda solo el texto, así que ahí se usa el texto exacto. Un
mensaje con más contenido ("detal, busco aretes") va directo a la búsqueda del agente.

Todas las protecciones siguen igual: clientes ya clasificados, pedidos del catálogo, cambio solo
por asesora, pedidos de otra modalidad, `ia_pausada`, números autorizados y pausa humana.

Saludo de Delacour (texto del Bloque 26):
```sql
update dulabs_agente_runtime_config
   set negocio = negocio || '{"saludo": "¡Hola! 💖 Bienvenido/a a Delacour Joyería 💍"}'::jsonb
 where phone_number_id = '1428584886997210';
```
