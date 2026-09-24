# Catálogo DuLabs

Fuente de verdad de los productos de un negocio. El HTML, la IA y el frontend
**no** son fuentes de verdad: leen o representan lo que vive aquí.

## Capas

```
app/dashboard/catalogo/*            UI (grid, nuevo, detalle/edición)
lib/catalogo-client.ts              cliente HTTP del navegador (+ subida directa a Storage)
app/api/dashboard/catalogo/*        adaptadores HTTP delgados (withCatalog)
lib/catalogo/http.ts                auth + rate limit + errores -> envelope
lib/catalogo/auth.ts                sesión + rol + módulo "catalogo" (tenant SIEMPRE de la membresía)
lib/catalogo/service.ts             casos de uso
lib/catalogo/domain.ts              modelo + reglas + validación (puro, sin I/O)
lib/catalogo/repository.ts          ÚNICO acceso a tablas y Storage
```

Datos: `dulabs_inventario_productos` (tabla compartida con AMORE, el Business
Agent y la cotización del agente, evolucionada de forma aditiva),
`dulabs_catalogo_{categorias,media,secuencias,eventos}`, `dulabs_tenant_modulos`.
Imágenes: bucket existente `inventario-productos`, ruta
`{id_tenant}/{producto_id}/{uuid}.{ext}` (+ `_thumb`).

## Reglas protegidas en la base de datos

- `referencia` (DL-000001…) la asigna un trigger con contador por tenant
  bloqueado por fila: segura ante concurrencia, única por tenant (UNIQUE),
  inmutable. Vale para cualquier camino de escritura.
- Auditoría append-only (`dulabs_catalogo_eventos`) por trigger, en la misma
  transacción del cambio. `escritura_id` evita atribuir a un usuario cambios
  hechos por otros caminos (AMORE, ventas, Business Agent).
- Media: principal única, `foto_url` sincronizada, ruta obligatoriamente bajo
  el tenant/producto dueños (RPC atómicas `dulabs_catalogo_adjuntar_media` /
  `dulabs_catalogo_eliminar_media`).
- `controla_stock`: `true` por defecto (comportamiento histórico). Desde la
  Fase 3 el Catálogo crea productos con `controla_stock = true` y el stock del
  formulario; fijar el stock al editar también lo activa. Los productos que el
  Catálogo creó antes (con `false`) siguen "disponibles sin control" hasta que
  el admin les defina un stock (sin migración ni cambio de datos).
- `stock integer not null default 0 check (stock >= 0)`: la BD garantiza que
  nunca es negativo (el dominio y el formulario lo validan antes).

## Fronteras futuras (no implementadas en la Fase 1)

- `lib/catalogo/import/` — importación masiva: Parse → Normalize → Validate →
  Preview → Confirm → ImportJob (QStash) → Products. Contratos en
  `import/types.ts`. Cada formato (CSV/XLSX, HTML) es un adaptador que solo
  produce `ImportCandidate`; nunca toca el dominio ni la BD.
- `lib/catalogo/export/html` — generar el catálogo HTML **desde** la BD (el
  HTML es una representación, nunca la fuente).
- Herramienta del agente `search_products()` sobre `CatalogService`: consulta
  bajo demanda y devuelve producto + referencia + precio + `image_url` reales.
  La IA nunca recibe el catálogo completo en el prompt ni inventa precios,
  referencias ni imágenes.

## Tienda pública y resolución por referencia (Fase 2)

Regla: **la IA conversa, el backend decide, el catálogo es la fuente de
verdad**. La referencia (`DL-000184`) es la identidad del producto: toda
resolución es por referencia exacta, nunca por nombre ni aproximación.

- **Tienda (detal)** — `app/catalogo/[slug]/(tienda)/`: un layout compartido
  (header, carrito, navegación) para inicio, listado/búsqueda y ficha
  (`/productos/{referencia}`). Datos desde `createPublicCatalogService`:
  `getStorefront`, `getHome`, `getCatalog`, `getProduct`, `resolveSelection`,
  `getImage` (principal + galería). El mayorista (`/mayor/{token}`) queda fuera
  del grupo, aislado.
- **Búsqueda** (Bloque 15) — `getCatalog` con `q` usa la MISMA búsqueda de
  texto completo del agente (`dulabs_catalogo_buscar`: sin tildes, plurales y
  prefijos; nombre, categoría, color/material y descripción; por relevancia):
  todas las palabras, o si ninguno las tiene todas, alguna (`search.relaxed`,
  se avisa). Páginas de 20 y tope de 220 resultados (`search.capped`: se pide
  afinar). Una referencia completa (`DL-000184`, `dl000184`) va a ese producto
  exacto; un fragmento (`000184`) busca en las referencias. Sin la migración
  de búsqueda: la búsqueda anterior (frase en nombre/referencia).
- **Límite de tasa** (Bloque 18, `limites-publicos.ts`) — `POST …/pedido`: 20 por IP cada
  10 min y 1.000 por catálogo por hora; `GET …/seleccion`: 120 por IP por minuto. Limitador
  distribuido (`dulabs_rate_limit_incrementar`); la IP solo como hash con sal; 429 con
  `Retry-After`. Si el limitador falla, se permite.
- **Carrito** — dominio puro `carrito.ts` + store `carrito-store.ts` (uno por
  catálogo y contexto de precio). El navegador solo es dueño de referencias y
  cantidades; nombre/precio/foto/disponibilidad se reconcilian con
  `GET /catalogo/{slug}/seleccion` al abrir "Tu selección". Lo que un backend
  debe aceptar es `selectionSnapshot` (referencia + cantidad). (Fase 3: ver
  abajo el pedido estructurado y el formato de WhatsApp.)
- **Disponibilidad** — ver Fase 3.
- **Resolución interna** — `resolucion.ts` (`createResolucionCatalogo`): para el
  webhook, el agente o la asesora; `tenantId` lo aporta el backend autenticado.
  Devuelve ambos precios, inventario, disponibilidad, imagen y estado. Sin
  endpoint público.
- **Destacados** — política explícita `FeaturedPolicy` en el servicio (hoy
  "activos recientes con foto"). Cuando exista `destacado = true/false` solo
  cambia `featuredProducts`; la vista y el contrato `PublicHome` no.
- **Vitrina** — `vitrina.ts`: contrato `CatalogStorefrontConfig` (misma forma que
  tendrá `catalog_config` en la BD). Fuente temporal: registro en código por
  slug. Siguiente paso: leerlo de `dulabs_catalogo_publicacion`.

## Stock, pedido estructurado y WhatsApp (Fase 3)

### Stock y disponibilidad (una sola función de dominio)

`domain.ts` → `availabilityOf(product)`:

| Condición                                   | Estado       | Público             |
| ------------------------------------------- | ------------ | ------------------- |
| inactivo                                    | `sold_out`   | (no se publica)     |
| sin control de inventario (legado)          | `available`  | Disponible          |
| con control, `stock <= 0`                   | `sold_out`   | Agotado             |
| con control, `stock <= LOW_STOCK_THRESHOLD` | `low`        | Últimas unidades    |
| con control, más                            | `available`  | Disponible          |

`LOW_STOCK_THRESHOLD = 3`. `maxOrderableUnits` = stock (con control), `null`
(sin control) o 0 (agotado). La proyección pública lleva `availability` y
`maxQuantity` (el máximo pedible). **Decisión:** exponer ese máximo es lo que
permite decir "Solo quedan 2 unidades disponibles." y acotar el carrito en el
navegador; el stock exacto de un producto con control queda así visible para
quien lea la respuesta. Lo agotado sigue visible en la tienda, pero no se
puede agregar.

### Carrito robusto (el navegador nunca es la fuente de verdad)

`carrito.ts`: `quantityLimit` / `canAddMore` (nunca más que `maxQuantity`, ni
agregar lo agotado), `reconcileWithChanges` (devuelve qué cambió: `removed`,
`sold_out`, `reduced`, para avisar al cliente) y persistencia compatible con
carritos guardados antes de existir `maxQuantity`.

### Pedido estructurado (`pedido.ts`) — contrato único

```json
{ "items": [{ "reference": "DL-000184", "quantity": 2 }] }
```

- `orderRequestSchema` (zod estricto): rechaza precios, nombres, totales,
  cantidades no enteras, fuera de 1–99 o más de 60 líneas.
- `prepareOrder(items, verdad)`: determinista. Suma duplicados y, por cada
  referencia, usa el producto real → precio vigente → stock vigente →
  disponibilidad. Devuelve líneas + `adjustments` (`not_found`, `sold_out`,
  `quantity_reduced`). Nunca concede más que el stock.
- `POST /catalogo/{slug}/pedido` (tienda detal): valida el cuerpo (≤ 16 KB),
  llama a `createPublicCatalogService().prepareOrder` (tenant + publicación +
  módulo + referencia exacta ACTIVA) y responde `ready` (con el link de
  WhatsApp armado en el servidor), `adjusted` (el cliente revisa y confirma de
  nuevo) o `no_whatsapp`. Solo `ready` abre WhatsApp. El servicio ya admite
  `context: "wholesale"` + token para cuando el mayorista tenga carrito; hoy el
  mayorista (`/mayor/{token}`) pide pieza por pieza con el mismo formato
  (`whatsappOrderLink`, 1 unidad) y lo agotado no ofrece el botón.

### Formato de WhatsApp (centralizado: `orderWhatsappMessage`)

```
Hola, me interesan estos productos:

• DL-000184 · Dije corazón — 2 unidades
• DL-000186 · Anillo esencia — 1 unidad

Quiero información para realizar la compra.
```

El mayorista agrega `(precio mayorista)` a la primera línea. La referencia va
primero en cada línea: es lo que lee la máquina. El nombre acompaña para la
asesora humana. `parseOrderMessage` lo lee de forma determinista (también el
formato de la Fase 2) y nunca interpreta nombres ni texto libre.

### Contrato para el agente (no implementado)

```
WhatsApp (mensaje entrante)
  -> webhook (tenant = número de WhatsApp del negocio, lo resuelve el backend)
  -> parseOrderMessage(texto)            => { context, items: OrderItem[] }
  -> createResolucionCatalogo().resolverReferencias(tenantId, refs)
                                          => producto real (ambos precios, stock, estado, imagen)
  -> prepareOrder(items, verdad)          => líneas + ajustes (misma regla que la tienda)
  -> contexto del agente                  => el agente CONVERSA con esos datos; nunca los inventa
```

El agente no decide precios ni disponibilidad: los recibe del backend. Si
`items` viene vacío, el mensaje no es un pedido del catálogo y el agente
conversa sin contexto de pedido.

### Importación masiva

Implementada en la Fase 4: ver la sección de abajo.

## Carga masiva (Fase 4)

Dashboard → Catálogo → **Carga masiva**. Planilla XLSX/CSV + fotos
(selección, carpeta o ZIP) → análisis en el servidor → preview corregible →
creación por lotes con `createProduct` (misma regla que el formulario) →
fotos a la galería existente → resultado e historial. Decisiones, límites y
seguridad: [`import/README.md`](import/README.md). Migración aditiva:
`20261107000000_dulabs_catalogo_importaciones.sql`.

## Solicitud de pedido estructurada → WhatsApp → contrato del agente (Fase 6)

```
CATÁLOGO (detal o mayorista) → carrito (solo referencia + cantidad)
  → GET …/seleccion : verdad del backend + COTIZACIÓN FIRMADA de los precios vistos
  → POST …/pedido   : { items, quote, requestKey }
       publicación → canal (el mayorista lo autoriza el token de la RUTA)
       → referencia → producto ACTIVO de ESE negocio → precio del canal → stock REAL
       → validación ATÓMICA (agotado, menos stock, retirado, precio cambiado)
       → OrderDraft + DL-ORD-XXXXXX + mensaje + evento catalog.order_request.created
  → WhatsApp (link wa.me con el mensaje armado en el servidor)
  → [futuro] agente IA: herramientas deterministas de resolucion.ts
```

La IA no participa en nada de esto: **WhatsApp funciona con la IA apagada**.

### Decisiones

- **Una sola ruta de código para detal y mayorista** (`pedido-http.ts`): el
  canal lo fija la ruta (`/catalogo/{slug}` o `/catalogo/{slug}/mayor/{token}`),
  nunca un parámetro del navegador. La tienda mayorista usa ahora el MISMO
  motor que el detal (carrito, ficha, validación); antes tenía un link directo
  a WhatsApp por producto sin validación (eliminado).
- **OrderDraft** (`pedido.ts`): la intención del cliente. No descuenta stock,
  no reserva, no es una venta. Lo calcula todo el servidor.
- **"El precio cambió" sin aceptar precios del navegador**: la cotización es
  un dato opaco firmado con HMAC por el backend (`pedido-firma.ts`), ligado al
  negocio y al canal. Alterada, de otro negocio o de otro canal => se trata
  como ausente ("review": el cliente ve los precios vigentes y confirma).
- **Id de solicitud y evento DETERMINISTAS, sin tabla nueva**: `DL-ORD-` + 6
  símbolos base32 (30 bits) y `evt_` + 26 (130 bits), derivados con HMAC de
  (negocio, canal, clave de idempotencia del intento, líneas). Doble toque,
  reintento o volver de WhatsApp y tocar de nuevo => mismo id, mismo mensaje,
  mismo evento. (Fase 7: la solicitud ya se persiste como pedido canónico;
  ver la sección siguiente.)
- **Clave de firma**: `CATALOG_ORDER_SECRET` o, si no existe, derivada de la
  clave de servicio de Supabase con separación de dominio (nunca se usa tal
  cual). Sin ninguna => el pedido responde 503 (falla cerrado).
- **Stock discreto**: el público ve Disponible / Últimas unidades / Agotado;
  el máximo exacto solo se publica cuando es ≤ `PUBLIC_STOCK_VISIBLE` (10).
  El backend valida siempre contra el stock real.
- **Formato del mensaje** (solo `orderWhatsappMessage`): REFERENCIA + PRODUCTO
  + CANTIDAD por línea, totales, total estimado (formato de la tienda) e id de
  solicitud. `parseOrderMessage` sigue leyendo los formatos anteriores. El
  texto lo puede editar el cliente: canal e id son pistas; el agente confirma
  con el evento y vuelve a resolver cada referencia.

### Herramientas del agente (`resolucion.ts`, todas con el tenant del backend)

| Herramienta | Resultado | Nunca |
| --- | --- | --- |
| `resolveByReference("DL-000184")` | found / not_found («No encontramos la referencia DL-000184.») / invalid_reference | buscar "parecidos" |
| `resolveByExactAttributes({ name, color?, material?, category? })` | found / ambiguous (candidatos) / not_found | similitud |
| `searchProducts(texto)` | candidates (activos, ≤ 10) | elegir por el cliente |
| `resolveOrder(canal, items)` | pedido validado con la verdad actual | confiar en el mensaje |
| `extractReferences(texto)` | referencias escritas literalmente | interpretar nombres |

Cada producto resuelto trae referencia, nombre, categoría, descripción,
precios detal y mayor, stock, disponibilidad, imagen y estado.

## WhatsApp + motor de pedidos para el agente (Fase 7)

**La IA conversa. El backend decide. El catálogo es la fuente de verdad.**
Todo vive en `lib/catalogo/pedidos/`; no hay webhook nuevo ni arquitectura
paralela.

### Qué se reutiliza

| Pieza existente | Uso en la Fase 7 |
| --- | --- |
| `app/webhook-dulabs/route.ts` (firma HMAC de Meta, `dulabs_mensajes_log` con `wamid` único, `procesarCambio`) | Única entrada. Se añadió `entry.id` (WABA) como parámetro opcional y un llamado a la entrada de pedidos antes de `atenderMensaje`. |
| `dulabs_clientes_config` (`phone_number_id` UNIQUE → `id_tenant`) | Resolución del negocio. Nunca por nombre. |
| `resolverTelefonoRemitenteMeta` | Contacto = `wa_id` del remitente. Conversación = (`phone_number_id`, `wa_id`), la misma identidad del Inbox. |
| `resolucion.ts`, `pedido.ts`, `pedido-firma.ts`, `domain.ts` (Fases 2–6) | Resolución de referencias, reglas de stock, formato del mensaje, derivación HMAC de ids. |
| `activarPausaChat` + `dulabs_conversacion_estado` | Handoff: la IA calla 24 h en ESE chat (igual que `transferir_soporte`) y la conversación queda `pending` en el Inbox. |
| Lista negra (`ia_numeros_bloqueados`) | También excluye el registro de pedidos. |

### Cadena de resolución

```
Meta (firma HMAC) → entry.id (WABA) → metadata.phone_number_id → dulabs_clientes_config.id_tenant
  → messages[].from (wa_id) → conversación (phone_number_id + wa_id) → pedido → herramientas
```

Si el WABA de la entrega no coincide con el del negocio del número, no se
registra nada. Idempotencia de entrada: `wamid` (nunca el timestamp).

### Contrato canónico (`contrato.ts`)

`order_id` público (`DL-ORD-XXXXXX`), `channel` (retail | wholesale), `source`
(catalog | whatsapp | agent | manual), `status`, líneas (referencia, nombre
resuelto, cantidad, precio unitario, subtotal), `total`, `currency`,
`created_at`. El id interno, el negocio y el contacto NUNCA salen en la vista
pública (`publicView`). Precio, subtotal, total, stock, negocio, canal e id de
producto no los puede fijar ni el cliente ni la IA.

### Estados

| Desde | Hacia | Quién |
| --- | --- | --- |
| draft | validated | system |
| draft / validated / pending_confirmation / confirmed | handoff | system, agent, human |
| validated | pending_confirmation | system, agent |
| validated / pending_confirmation | draft | system (algo cambió) |
| pending_confirmation | confirmed | agent, human (con la propuesta vigente) |
| handoff | confirmed | human |
| confirmed / handoff | completed | human |
| draft / validated | cancelled | system, human |
| pending_confirmation / confirmed / handoff | cancelled | human |
| draft / validated / pending_confirmation | expired | system |

La MISMA tabla está en la BD (`dulabs_catalogo_pedido_transicion_valida`); un
test compara ambas. Las transiciones son compare-and-set en una transacción
con su evento.

**Confirmación contextual**: el backend emite una propuesta
(`confirmation.id`, total, vence en 30 min). `confirm_order` exige ese id,
que no haya vencido y que precio y stock sigan iguales; si algo cambió, el
pedido vuelve a `draft` con el problema. Un "sí" suelto no confirma nada.
No descuenta stock, no reserva, no cobra.

### Evento `catalog.order_request.created` (v2, `eventos.ts`)

`{ event_id, event_type, version: 2, occurred_at, business, customer, channel,
source, order, transition? }`. También `order.created`,
`order.status_changed` y `order.handoff_requested`. Se guardan en
`dulabs_catalogo_pedido_eventos` (inmutable, `event_id` único) en la misma
transacción que el cambio; a los registros va un resumen sin teléfono.

### Herramientas del agente (`herramientas.ts`)

| Herramienta | Permiso | Conversación | Errores deterministas |
| --- | --- | --- | --- |
| `search_products` | catalog:read | no | — (solo candidatos) |
| `resolve_product` | catalog:read | no | NOT_FOUND, AMBIGUOUS, PRODUCT_UNAVAILABLE |
| `get_product_by_reference` | catalog:read | no | REFERENCE_NOT_FOUND, PRODUCT_UNAVAILABLE |
| `get_product_availability` | catalog:read | no | REFERENCE_NOT_FOUND |
| `get_order` | orders:read | sí | NOT_FOUND |
| `validate_order` | orders:write | sí | NOT_FOUND, CONFLICT |
| `create_order` | orders:write | sí | CONFLICT (misma clave, otro contenido) |
| `confirm_order` | orders:write | sí | CONFIRMATION_MISMATCH, CONFIRMATION_EXPIRED, PRICE_CHANGED, OUT_OF_STOCK, INVALID_TRANSITION |
| `handoff_to_human` | conversation:handoff | sí | INVALID_TRANSITION, UNAVAILABLE |

Comunes: INVALID_INPUT (esquema estricto: un campo de más como `price`,
`total`, `business_id` o `channel` se rechaza), FORBIDDEN (módulo apagado,
contexto inválido, número que no es del negocio), UNAVAILABLE (migración sin
aplicar o falla). El contexto (tenant, canal, conversación) lo arma el
backend. Las salidas se validan con esquemas estrictos. `agentToolDefinitions()`
entrega los JSON Schema para el modelo. **En esta fase ningún runtime de IA
las expone todavía**: quedan listas y probadas para conectarlas.

### Entrada por WhatsApp (`intake.ts` + `whatsapp.ts`)

- Solo texto de clientes con forma de pedido del catálogo (líneas `• REF · …
  — N unidades` o `Solicitud: DL-ORD-…`). Cualquier otro mensaje sigue su
  camino normal, sin consultar la BD.
- Con `Solicitud:` de una solicitud del catálogo aún sin conversación: se
  vincula a esta conversación (una sola vez), manda lo GUARDADO (si el texto
  difiere: `message_mismatch`), se re-valida y queda propuesta o en `draft`.
- Sin id, reenviado desde otra conversación o vencido: pedido nuevo de
  WhatsApp, canal DETAL (el texto no autoriza precio mayorista:
  `wholesale_unverified`). Una cantidad ilegible, 0, negativa o mayor a 99 es
  un problema (`invalid_quantity`), nunca un ajuste silencioso.
- Registra y devuelve una respuesta estructurada; **no responde por
  WhatsApp** en esta fase.

### Persistencia (migración `20261108000000_dulabs_catalogo_pedidos.sql`)

Sin la migración, la tienda y el webhook funcionan exactamente como antes
(sonda `available()`, caché de 60 s) y las herramientas de pedido responden
UNAVAILABLE.

### Registros

Una línea JSON `catalog_order` por operación: `request_id`, `event_id`,
`business_id`, `operation`, `result`, `duration_ms`, `error_code`/`reason`,
`order_id`, `status` y `contact_ref` (hash del wa_id). Nunca el teléfono, el
texto del mensaje, tokens ni secretos.

## Reserva de stock al confirmar (Bloque 19)

Regla del negocio: **el stock se descuenta al CONFIRMAR** el pedido. Lo decide la BD, nunca el
navegador ni Gemini (migración `20261116000000_dulabs_catalogo_reservas_stock.sql`):

| Estado del pedido | Stock |
| --- | --- |
| `confirmed` | se aparta (todo o nada; si falta, `CT010` y la confirmación entera se revierte) |
| `handoff` | la reserva sigue (la asesora decide; no vence sola) |
| `completed` (venta cerrada) | la reserva se consume: el stock queda descontado |
| `cancelled` / `expired` | la reserva se libera: el stock vuelve |
| `confirmed` sin cerrar 72 h | vence (`dulabs_catalogo_reservas_vencer`): pasa a `expired` y el stock vuelve |

- **Trigger** sobre `dulabs_catalogo_pedidos`: cualquier camino (agente, asesora, cron, SQL) aplica
  la regla en la misma transacción. Descuento `stock = stock - n WHERE stock >= n` (Postgres
  re-evalúa tras el bloqueo), productos bloqueados en orden de referencia (sin deadlocks),
  `CHECK (stock >= 0)` como última barrera. Solo productos del mismo negocio con
  `controla_stock = true`. Cada cambio queda en `dulabs_catalogo_eventos` (auditoría) y en
  `dulabs_catalogo_reservas` (qué pedido, cuánto, hasta cuándo).
- **Motor** (`pedidos/motor.ts`): si otro cliente se llevó las unidades entre la propuesta y el
  "sí", `confirm_order` responde `OUT_OF_STOCK`/`PRODUCT_UNAVAILABLE` y el pedido vuelve a
  borrador con el problema real ("se agotó", "quedan N"). `closeOrder` (asesora: completar o
  cancelar, idempotente), `listOpenOrders` (vence lo vencido al abrir el panel),
  `expireReservations` (cron).
- **Panel** `/dashboard/catalogo/pedidos` (API `GET/POST /api/dashboard/catalogo/pedidos[/{DL-ORD-…}]`):
  pedidos abiertos con el stock apartado y su vencimiento; "Venta cerrada" y "Cancelar". Ver:
  cualquier rol del catálogo; cerrar: admin y asesoras (`agente`). Sin ids internos.
- **El stock del producto es el DISPONIBLE**: lo apartado ya está descontado. Si la asesora
  corrige el stock en el formulario, escribe lo que hay para vender (sin contar lo apartado);
  cancelar o vencer después suma lo apartado de vuelta.
- **Cron** `/api/cron/catalogo-reservas` (diario en `vercel.json` por el plan; con QStash puede
  ir cada hora).
- Pruebas: `supabase/tests/20261116000000_*.test.sql` (12), `*.concurrencia.sh` (sesiones
  paralelas reales), `pedidos/reservas-stock.test.ts` y el caso 11b del flujo comercial del agente.

## Rendimiento y escalabilidad (Bloque 20)

Medido con datos **sintéticos** en PostgreSQL y PostgREST locales, sin datos reales. Cómo
reproducirlo está en `scripts/perf/README.md`.

**Búsqueda indexada.** La migración `20261117000000_dulabs_catalogo_busqueda_indice.sql` agrega
la tabla `dulabs_catalogo_busqueda_doc`. Guarda el documento FTS precalculado de cada producto y
lo indexa con GIN. Unos triggers la mantienen en la misma transacción, y solo para negocios con
Catálogo. `dulabs_catalogo_buscar` tiene la misma firma y el mismo resultado; la paridad se
comprobó con 0 diferencias. Con 10.000 productos:

- una búsqueda bajó de ~450 ms a ~20 ms;
- 50 búsquedas simultáneas pasaron de 8/s a 110/s.

**Nombre exacto por índice.** `resolveByExactAttributes` usa `findByExactName`, que llama a la RPC
`dulabs_catalogo_por_nombre`. Solo trae los candidatos con ese nombre normalizado y después
aplica la misma regla exacta del backend. Sin la migración cae al camino anterior, que lee todas
las claves.

**Gemini** recibe solo el resultado de cada herramienta, entre 0,4 y 1,9 KB. Nunca recibe el
catálogo.

**Aún no necesitan optimización.** Las operaciones siguientes hacen un número constante de
consultas (no hay N+1):

| Operación | Tiempo o volumen |
| --- | --- |
| listado y ficha | 8–27 ms |
| carrito de 60 referencias | 11 ms |
| validar un pedido | 22 ms |
| confirmar con reserva | ~16 ms |
| panel | ~12 ms, tope de 100 pedidos |
| búsqueda por fragmento de referencia (ILIKE) | 35 ms con 10.000 productos |

Para la búsqueda por fragmento, si crece se puede agregar un índice trigram. La vista previa de
importación sigue leyendo todas las claves del negocio (`listProductKeys`), pero es una acción
de administración puntual.

**Costo en escritura.** Indexar agrega ~1,3 ms por producto, y solo cuando cambia algo buscable
(nombre, color, material, descripción, categoría o estado). Cambiar el precio o el stock no
reindexa.

**Segunda parte: la app compilada de punta a punta.** Detalle en `scripts/perf/README.md`.

- **Fotos públicas:** solo se sirve la URL canónica (la `v` vigente).
  - Cualquier otra `v`, una referencia en mayúsculas o una extensión distinta redirige (307) a la
    canónica sin abrir Storage ni convertir a JPEG.
  - Antes, una `v` aleatoria evitaba el CDN y forzaba descargas y conversiones: 30 peticiones a la
    vez saturaban la CPU.
  - El servicio separa `locateImage` (solo BD, calcula la versión y la URL canónica) de
    `openLocatedImage` (Storage).
- **Celular:** las 4 primeras tarjetas cargan su foto de inmediato, y la primera fila con prioridad
  alta (`cargaDeFoto`). El LCP con 4G lenta bajó de ~3,2 s a ~1,9–2,2 s. El resto de las fotos
  sigue diferido: al abrir el listado se descargan 11 de 43.
- **`request_product_images`:** los ids internos, que se usan para registrar las fotos enviadas,
  salen de una sola consulta por lote y nunca llegan a Gemini.

## Cierre de producción (Bloque 21)

La guía operativa está en `DELACOUR_PRODUCTION_READINESS.md` (raíz del repo).

**Límite de tasa de las páginas públicas.**

- Lo aplica `proxy.ts`, con la lógica en `limite-paginas.ts`, sobre `/catalogo/*`: tienda detal,
  mayorista, búsqueda, paginación y fichas.
- Las fotos, el carrito y el pedido quedan fuera: las fotos van por el CDN y el carrito y el
  pedido ya tienen su propio límite en `limites-publicos.ts`.
- Es **distribuido**: el mismo contador en Postgres (`dulabs_rate_limit_incrementar`) vale para
  todas las instancias.
- Cuenta **por cliente**, con un hash con sal de la IP; en IPv6 usa el prefijo /64. Nunca cuenta
  por URL, así que cambiar parámetros no abre un contador nuevo.

| Clase de petición | Límite |
| --- | --- |
| Páginas | 600 por cliente por minuto |
| Búsquedas | 120 por cliente por minuto, y además cuentan como página |
| Búsquedas por catálogo | 3.000 por minuto; al superarse solo se frenan las búsquedas y la tienda sigue navegable |

- Cada instancia recuerda a los clientes bloqueados y les responde 429 sin volver a consultar la
  BD.
- Si el limitador no responde en 400 ms, se permite la visita.
- Pruebas: `limite-paginas.test.ts` (U) y `scripts/perf/limite-concurrencia.ts` (Postgres real:
  de 700 peticiones simultáneas pasan exactamente 600).

**Precarga por intención (`EnlaceIntencion`).**

- Las tarjetas de producto y las listas de categorías precargan la ficha solo cuando el usuario
  pasa el mouse, toca o enfoca el enlace.
- Medido con el `Link` por defecto: abrir el listado y hacer scroll disparaba 53 precargas, que
  sumaban 470 consultas a la BD por visita. Ahora son 2.

**Historial de pedidos.**

- En el panel está la pestaña **Historial**: pedidos completados, cancelados y vencidos, de a 25,
  con "Ver más".
- Se pagina por cursor (keyset por creación y número público), con un cursor opaco que se valida;
  si llega manipulado, se responde 400.
- Muestra qué pasó con el stock: vendido (reserva consumida), devuelto (reserva liberada) o sin
  reserva.
- No expone ids internos.
- API: `GET /api/dashboard/catalogo/pedidos/historial?estado=&limite=&cursor=`.
- Índice opcional en la migración `20261118000000`.
- Pruebas: `pedidos/historial.test.ts` y `supabase/tests/20261118000000_*.test.sql`.
