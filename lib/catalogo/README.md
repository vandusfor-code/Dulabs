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
  mismo evento. Por qué no persistir todavía: nadie lee aún la solicitud
  (el agente no existe), el mensaje ya lleva el contrato estructurado y el
  agente debe volver a resolver todo igual. Cuando exista el consumidor, el
  adaptador `OrderRequestEventSink` pasa de "registro JSON" a una tabla con
  `UNIQUE(event_id)` (o una cola) sin tocar el dominio.
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
