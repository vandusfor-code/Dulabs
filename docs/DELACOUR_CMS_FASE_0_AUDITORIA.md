# CMS comercial de Delacour + fuente de verdad para ARIA

## FASE 0 — Auditoría de arquitectura y propuesta técnica

> **Estado:** auditoría de solo lectura. No se programó nada y no se tocó producción (las consultas a la base fueron solo `select`).
> **Rama:** `feat/delacour-cms-comercial` (sin cambios de código). **Fecha:** 2026-10-06.
> Este documento no contiene secretos, teléfonos ni datos de clientes. No está en ningún commit.

---

## Resumen en un minuto

1. **Lo que pides encaja con lo que ya existe.** El cableado de fondo está hecho: el negocio sale siempre de la membresía del usuario, los módulos se activan por negocio, hay roles, el catálogo ya separa precio detal y mayorista, ARIA solo usa herramientas de una lista cerrada, hay guardas anti-invención y el canal detal/mayorista lo decide el backend. Además existe un patrón de «versión publicada + puntero a la versión activa» (Business Agent) que se puede copiar.
2. **Hoy no hay nada administrable.** La portada y el banner de Delacour están escritos en código (`lib/catalogo/vitrina.ts`); los «destacados» son los 8 más recientes con foto; **no existen** ofertas, combos ni campañas; y las políticas, preguntas frecuentes y promociones viven como 24 textos dentro del prompt de ARIA.
3. **Hay tres conflictos reales entre la especificación y la arquitectura actual** (sección H). Los dejo documentados antes de programar:
   - el pedido cobra el precio de lista del producto y no conoce descuentos;
   - el pedido funciona con «una referencia = un precio» (la cotización firmada y la normalización fusionan por referencia), y un combo choca con eso;
   - las políticas, promociones y el mínimo mayorista están en dos lugares (prompt de ARIA y, mañana, el CMS).
4. **Propuesta:** un motor genérico de contenido versionado (borrador → validación → publicar → versión activa, historial inmutable y auditoría) con cuatro tipos de elemento (ofertas, combos, campañas y contenido) más la portada; reglas **puras y deterministas** para vigencia, modalidad y precio; **un solo punto de precio efectivo**; y cuatro herramientas de ARIA con su guarda anti-invención (el molde es `consultar_envio`).
5. **Entrega en 5 PRs encadenados.** Cada uno queda inerte hasta que se active el módulo para Delacour. Ninguna migración se corre sola y todas traen su rollback.
6. **Necesito 5 decisiones de negocio tuyas** (sección I). Para cada una dejo mi recomendación.

---

## A. Arquitectura actual encontrada

### A1. Negocio, acceso y módulos

- El negocio es `id_tenant`. Todo acceso del servidor usa la llave de servicio y el negocio sale **siempre de la membresía** (`dulabs_miembros_equipo`: `tenant_id`, `user_id`, `rol`, `estado`), nunca de lo que mande el navegador (`lib/team.ts`, `lib/catalogo/auth.ts`).
- Roles: `admin`, `agente`, `lectura`. En el catálogo, **leer** = los tres; **escribir** = solo `admin`; **pedidos** = `admin` y `agente` (`lib/catalogo/auth.ts:35-37`).
- Módulos por negocio: tabla `dulabs_tenant_modulos` y lista cerrada `MODULOS` (`lib/tenant-modulos.ts:19`). Agregar un módulo es agregar su id. El menú del Dashboard se arma por módulo y rol (`components/dashboard/shell/nav.ts`).
- Las rutas del Dashboard usan `withCatalog(request, modo, handler)` (`lib/catalogo/http.ts`): sesión, módulo habilitado, rol, límite de peticiones, validación con zod y errores estándar.

### A2. Catálogo, precios, stock y pedidos

- **Producto:** id interno y `referencia` (p. ej. DL-000184, asignada por la base de datos e inmutable); `precio` (detal) y `precio_mayor` (mayorista, puede ser nulo); stock con `controla_stock`; `activo`; categoría, material y color; fotos en Storage.
- **Dos contextos de precio** (`retail` / `wholesale`). El mayorista solo se alcanza con un enlace con token secreto (`/catalogo/{slug}/mayor/{token}`) que se puede rotar; el detal es `/catalogo/{slug}`. Los enlaces salen de `dulabs_catalogo_publicacion` (`slug`, `nombre_publico`, `publicado`, `token_mayor`).
- **Disponibilidad:** `availabilityOf` + reservas de stock atómicas (RPC) + `maxQuantity`.
- **Pedidos:** las líneas van por **referencia**. El motor toma el precio unitario del canal (`lib/catalogo/pedidos/motor.ts:310`) y firma una cotización `referencia → precio` (`lib/catalogo/pedido-firma.ts:103`) para detectar `price_changed`. `normalizeOrderItems` **fusiona** las líneas de la misma referencia (`lib/catalogo/pedido.ts:117`).
- **Búsqueda:** RPC `dulabs_catalogo_buscar`; el filtro de precio máximo usa el precio del canal (en SQL, sin conocer ofertas).
- **Fotos:** bucket público `inventario-productos`; subida directa con URL firmada, validación de formato, tamaño y firma del archivo, y rutas públicas tipo proxy (sin ids internos en las URLs).

### A3. Tienda pública

- **Renderizado dinámico:** el proyecto no usa `cacheComponents` y las páginas de la tienda no tienen `revalidate`, `use cache` ni `unstable_cache`; `fetch` no se cachea por defecto en Next 16 (guía «Caching and Revalidating (Previous Model)»). Resultado: **lo que se publique se ve en la siguiente petición**, sin invalidar nada.
- **Contenido editorial escrito en código:** `lib/catalogo/vitrina.ts`, `REGISTRO` (línea 161): marca, portada con imagen en `/public`, título «Historias que brillan contigo», subtítulo, botón «Ver catálogo» y banner de regalo para Delacour; y el tema «tecnología» de ASLC. El propio archivo se declara temporal y define `CatalogStorefrontConfig` como el contrato que pasará a la base de datos. Se lee en 3 sitios: `app/catalogo/[slug]/(tienda)/page.tsx`, `.../(tienda)/layout.tsx` y `.../mayor/[token]/layout.tsx`.
- **Destacados:** política «recientes con foto», `FEATURED_LIMIT = 8` (`lib/catalogo/service.ts:466-481`). El código ya prevé que un campo administrable reemplace solo `featuredProducts`.

### A4. ARIA (Gemini)

- **Runtime y herramientas:** `lib/agente/runtime.ts`. Las herramientas son una lista cerrada (`AGENT_TOOL_NAMES`) y cada negocio habilita las suyas en `dulabs_agente_runtime_config.herramientas`. Las entradas usan zod estricto: **el modelo nunca pasa negocio, precio, stock ni canal**.
- **Canal detal/mayorista:** lo decide y guarda el backend por contacto (`lib/agente/clasificacion.ts`, RPC con bitácora inmutable). El modelo no lo ve. Si un cliente «pide» otro canal, pasa a una asesora.
- **Guarda de anclaje** (`lib/agente/anclaje.ts`): enlaces, montos, cantidades y estados deben estar respaldados por la evidencia de las herramientas **del mismo turno**. Si falla: una corrección y, si persiste, mensaje seguro o traspaso a una persona (`runtime.ts:1431-1446`). **No vigila porcentajes, ofertas, combos, vigencias ni políticas.**
- **Precedente a copiar:** `lib/agente/envios-anclaje.ts` (evidencia del turno + reglas con códigos estables; solo se activa en negocios con motor de envíos; una corrección y traspaso a una persona con texto fijo, `runtime.ts:1496`).
- **Conocimiento del negocio:** `negocio.conocimiento` (hasta 40 temas × 800 caracteres) se inyecta en el prompt en cada turno (`lib/agente/contexto.ts:75`).
- **Mínimo mayorista:** `negocio.pedido.minimo_mayorista` se aplica en el checkout conversacional como regla de compra inicial (`lib/agente/checkout.ts:881`), sobre `order.total`.

### A5. Convenciones de ingeniería que hay que respetar

- Migraciones idempotentes con encabezado de «RECUPERACIÓN»; rollbacks manuales en `supabase/rollbacks/*.down.sql`; pruebas SQL en `supabase/tests/*.test.sql` (contra un Postgres efímero); aprovisionamiento por negocio en `supabase/provisioning/<negocio>/` (lo corre el dueño); scripts de mutación en `scripts/mutacion/bNN.py`; repositorios en memoria para pruebas; tolerancia a esquema ausente (`isMissingSchema`, `repository.ts:437`).
- **Patrón de versionado ya probado:** `dulabs_ba_business_models` + `dulabs_ba_agent_artifacts` + `dulabs_ba_active_artifacts` (migración `20261125000000`): filas inmutables con trigger, puntero a la versión activa, publicación atómica con candado consultivo y control optimista, rollback = mover el puntero.
- **Herramientas de prueba disponibles aquí:** `npm run test:flow` (tsx), jsdom + Testing Library, navegador integrado. **No hay** Postgres local, Docker, `psql`, Playwright ni pglite instalados.

---

## B. Tablas existentes relevantes

| Tabla | Para qué sirve | ¿Se reutiliza? |
|---|---|---|
| `dulabs_inventario_productos` | Productos: `precio`, `precio_mayor`, stock, `activo`, `referencia`, `categoria_id`, material, color | Sí, **solo lectura**: el CMS apunta a productos por `referencia`, nunca los copia |
| `dulabs_catalogo_categorias` | Categorías | Sí (por id) |
| `dulabs_catalogo_media` | Fotos de producto | El patrón sí; la tabla no (las imágenes del CMS no son fotos de producto) |
| `dulabs_catalogo_publicacion` | `slug`, nombre público, publicado, token mayor | Sí (ancla pública de la tienda) |
| `dulabs_catalogo_pedidos` / `_pedido_eventos` | Pedidos e historial (líneas en jsonb) | Sí; sin cambios de esquema |
| `dulabs_catalogo_clientes_canal` | Canal detal/mayorista por contacto + bitácora | Sí (fuente del canal para ARIA) |
| `dulabs_catalogo_eventos` | Auditoría append-only del catálogo (650 eventos de Delacour) | La convención sí; el CMS tiene la suya |
| `dulabs_tenant_modulos` / `dulabs_miembros_equipo` | Módulos y roles | Sí |
| `dulabs_agente_runtime_config` | Herramientas, `negocio`, `checkout_opciones` | Sí (se habilitan herramientas nuevas por negocio) |
| `dulabs_ba_*` (modelos, artefactos, activos, FAQs, documentos) | Business Agent (otro producto y otro runtime) | **Solo el patrón.** Delacour tiene 0 filas ahí; mezclarlos rompería la separación de productos |
| `dulabs_clientes_config.base_conocimiento` / `dulabs_bot_conocimiento` | Conocimiento del runtime legado y de AMORE | No. Delacour no los usa (`base_conocimiento` vacío) |

---

## C. Datos que ya existen (Delacour hoy, consulta de solo lectura del 2026-10-06)

- **Tienda:** publicada (`delacour`, «Delacour & Orus Joyería», creada el 2026-09-23). **Módulos activos:** catálogo, pedidos, marca de referencia, notificaciones de pedidos y clientes de joyería.
- **Catálogo:** 227 productos (todos activos; 159 con precio mayorista; todos controlan stock; ninguno agotado), 11 categorías (Dije, Pulseras Balines, Candongas, Juegos, Aretes, Topos, Pulseras, Esclava, Cadenas, ALMA, Cadena con Dije) y 226 fotos.
- **Equipo:** una sola cuenta activa con rol `admin` (se dejan fuera los datos concretos del cliente: este repositorio es público).
- **ARIA:** agente `catalog_sales`, `gemini-3.6-flash` con razonamiento bajo, canal por defecto detal, clasificación de cliente y checkout conversacional activos, 16 herramientas (**sin** `consultar_envio`: Delacour no usa el motor de envíos), configuración `negocio` de unos 8,8 KB.
- **Textos de ARIA hoy en el prompt (24 temas):** Quiénes somos, Ubicación, Líneas y materiales, Dorado y plateado, Venta al detal, Venta al por mayor, Emprendimiento, Regalos, Hombre y mujer, Catálogo, Precios y disponibilidad, Envíos, Medios de pago, Horario, Garantías, Cambios y devoluciones, Separar mercancía, Promociones, Servicios, Colección Vida Eterna, Reclamos, Pago no identificado, Despedida y Datos del pedido (entre 100 y 400 caracteres cada uno).
- **Reglas de negocio ya configuradas:** `pedido.minimo_mayorista = 750000`; no hay `politicas` estructuradas.
- **Otras fuentes de conocimiento:** FAQs y documentos del Business Agent: 0 filas; `base_conocimiento` legado: vacío. **La única fuente de texto comercial de Delacour es `negocio.conocimiento`.**
- **Actividad:** de piloto (pocos pedidos y contactos, por catálogo y por ARIA, detal y mayorista); se omiten las cifras exactas porque este repositorio es público.
- **Hardcodeado en código:** portada, subtítulo, botón y banner (`vitrina.ts`), y la política de destacados.

---

## D. Qué se puede reutilizar

- **Acceso y permisos:** `withCatalog` como modelo para un `withCms` (sesión, módulo, rol, límite de peticiones, zod). Sin segundo sistema de autenticación.
- **Módulos:** un módulo nuevo en `MODULOS` aísla todo: sin módulo, comportamiento idéntico al de hoy.
- **Versionado:** el patrón `dulabs_ba_*` (inmutable + puntero activo + publicación atómica con candado consultivo y control optimista).
- **Imágenes:** URL firmada de subida, validación del archivo, procesamiento con `sharp` y ruta pública tipo proxy.
- **ARIA:** el patrón de `consultar_envio` (herramienta de solo lectura con entrada estricta + evidencia del turno + guarda por códigos + corrección y traspaso) y el canal decidido por el backend.
- **Pedidos:** la cotización firmada y `price_changed` ya protegen al cliente si el precio cambia entre el carrito y la confirmación; sirven tal cual para ofertas que empiezan o terminan.
- **Contratos del repo:** `CatalogStorefrontConfig` (la forma que ya está pensada para venir de la base de datos) y el punto único `featuredProducts`.
- **Pruebas:** repositorios en memoria, convención de `supabase/tests`, `supabase/rollbacks`, `scripts/mutacion`, y el arnés de Gemini real (`npm run test:amore-gemini`, clave de prueba `GEMINI_EVAL_KEY`) como molde para la evaluación de este bloque.

---

## E. Qué falta

- Almacén de contenido administrable con borrador, publicación, versiones, restauración y auditoría.
- Entidades: portada/página principal, oferta, combo, campaña y contenido comercial (FAQ, políticas, horarios, pagos, envíos, garantías, cambios, devoluciones, mayoristas, materiales, promociones, información general).
- Reglas deterministas: vigencia (con zona horaria), aplicabilidad, modalidad, prioridad, redondeo, disponibilidad del combo.
- **Precio efectivo** (hoy no existe el concepto de descuento en ningún punto del flujo).
- Combos en el flujo de pedidos (hoy imposibles: una referencia = un precio).
- Herramientas de ARIA para ofertas, combos, campañas y contenido, y la **guarda anti-invención comercial** (porcentajes, ofertas, combos, vigencias, filtración mayorista, cifras de políticas).
- Dashboard «Administración de tienda» con vista previa y validaciones claras.
- Subida de imágenes del CMS (portada, banner, ofertas, combos).
- Variables controladas en los textos (p. ej. `{{minimo_mayorista}}`) para que el número exista **una sola vez**.
- Migración ordenada de los 24 textos del prompt y retiro posterior del prompt.
- Aprovisionamiento de Delacour (activar módulo, sembrar la portada actual para que la tienda se vea igual).
- Forma de ejecutar SQL de verdad en pruebas sin Postgres local.

---

## F. Propuesta de arquitectura

### F1. Principios

1. **Una sola fuente de verdad:** la base de datos. Nada comercial en el prompt de sistema.
2. **El modelo interpreta, el backend autoriza.** Gemini entiende la pregunta; solo el backend decide qué oferta, precio, combo, política o vigencia existe y se puede decir.
3. **Reglas puras con reloj inyectado.** Vigencia, aplicabilidad, prioridad y precio son funciones sin I/O que reciben «ahora», el canal y los datos. Se prueban con tiempo falso y se someten a mutación.
4. **Lo publicado y los borradores no se mezclan nunca.** El lector público, el de ARIA y el de precios solo ven lo publicado; los borradores solo los lee el editor del Dashboard.
5. **Aditivo y apagable.** Todo cuelga del módulo `cms_comercial`. Módulo apagado = salida idéntica a la de hoy (pruebas «doradas» lo demuestran).
6. **Genérico:** el motor no sabe nada de joyería. Delacour es el primer negocio; ASLC (cuya portada también está en `vitrina.ts`) u otro podrían usarlo después.

### F2. Flujo general

```
Administradora ─ Dashboard /dashboard/tienda (rol admin) ─► API withCms ─► servicio CMS
                                                               │ guardar borrador (jsonb)
                                                               │ validar (función pura, mensajes en español)
                                                               │ publicar (RPC atómica: versión inmutable + puntero activo + auditoría)
                                                               ▼
                                           lectura de lo PUBLICADO (única puerta)
                     ┌─────────────────────────┼───────────────────────────────┐
                 Tienda web               Precio efectivo                 Herramientas de ARIA
          (portada, destacados,     (tienda · carrito · pedido ·     consultar_ofertas / _combos /
           secciones)                búsqueda · cotización firmada)   _campanas / _contenido_comercial
                                                                              │
                                                                  guarda anti-invención comercial
                                                                  (1 corrección → traspaso a asesora)
```

### F3. Modelo de datos (3 tablas nuevas, aditivas)

| Tabla | Contenido |
|---|---|
| `dulabs_cms_entidades` | Una fila por elemento: `id`, `id_tenant`, `tipo` (`home`, `oferta`, `combo`, `campana`, `contenido`), `clave`, `estado` (`borrador`, `publicada`, `pausada`), `borrador` jsonb (copia de trabajo; nulo si no hay cambios pendientes), `version_activa`, columnas **proyectadas solo por la función de publicar** (`modalidad`, `vigencia_desde`, `vigencia_hasta`, `prioridad`) para índices y poda, y quién/cuándo creó, editó y publicó |
| `dulabs_cms_versiones` | **Append-only** (trigger). Instantánea validada e inmutable de cada publicación: `version`, `contenido` jsonb, `checksum`, `accion` (`publicar`/`restaurar`), `nota`, quién y cuándo |
| `dulabs_cms_auditoria` | **Append-only.** Quién, negocio, entidad, id, acción, valor anterior, valor nuevo y fecha. Solo se guardan cargas ya validadas por zod (no existen campos para secretos) |

- Funciones (solo `service_role`, sin permiso para `anon`/`authenticated`, RLS activa sin políticas, como el resto del repo): `dulabs_cms_publicar`, `dulabs_cms_despublicar`, `dulabs_cms_pausar`/`reanudar`, `dulabs_cms_restaurar` y `dulabs_cms_lectura_activa(p_tenant, p_tipos)`. Candado consultivo por (negocio, entidad) y control optimista con `p_expected_version`. Restaurar = publicar de nuevo una versión anterior como versión nueva (la historia nunca se borra).
- Claves foráneas compuestas e `id_tenant` en cada tabla e índice: una fila nunca puede colgar de otro negocio.
- **Estado «vencida» derivado, no guardado:** se calcula al leer con el reloj. Así una oferta deja de valer en el segundo exacto de su fin, sin depender de un proceso programado que se retrase.
- Migración `20261210000000_dulabs_cms_comercial.sql`, rollback `supabase/rollbacks/…down.sql` (se niega a correr si hay contenido publicado) y pruebas `supabase/tests/…test.sql`.

### F4. Entidades y reglas

- **Portada / página principal (una por negocio):** imagen (con texto alternativo obligatorio y punto focal), eyebrow, título, subtítulo, botón (texto y destino), visibilidad; orden y visibilidad de secciones; categorías destacadas y productos destacados (lista **ordenada** de referencias). Sin destacados publicados, rige la política actual «recientes con foto» (la tienda nunca queda vacía).
- **Oferta:** nombre, descripción, imagen opcional, modalidad (detal / mayorista / ambas), beneficio (`porcentaje`, `monto_fijo` o `precio_especial`; con valores **por canal** cuando la modalidad es «ambas»), alcance (referencias y/o categorías), vigencia, condiciones (texto que se muestra tal cual), prioridad, campaña opcional.
- **Combo:** nombre, descripción, imagen, modalidad, componentes (`referencia` + cantidad), precio del combo, vigencia, condiciones. El **precio normal** y la **disponibilidad** los calcula el backend: el combo está disponible solo si cada componente está activo y alcanza para la cantidad que pide; el stock del combo es el mínimo entre componentes.
- **Campaña:** nombre, descripción, vigencia, estado, modalidad y prioridad. Agrupa ofertas, combos, destacados y contenido de portada. **Efectivo = elemento activo Y campaña activa**: una campaña inactiva no influye en nada y no hace falta mutar datos para lograrlo.
- **Contenido comercial:** tema (información general, horarios, ubicación, pagos, envíos, garantías, cambios, devoluciones, mayoristas, materiales, promociones, preguntas frecuentes), **audiencia** (todos / detal / mayorista), título o pregunta, texto o respuesta, vigencia opcional y orden. Texto plano, nunca HTML. **Variables de lista cerrada** (`{{minimo_mayorista}}`, `{{direccion_tienda}}`, `{{whatsapp}}`…) que el backend rellena desde su configuración: el 750.000 existe una sola vez y el FAQ no puede contradecirlo.
- **Vigencia:** fechas guardadas como instante; si el editor escribe solo una fecha, se interpreta en **America/Bogotá** (inicio 00:00:00 y fin 23:59:59 del día final, inclusivo). Una oferta publicada solo es utilizable si está publicada, no pausada, vigente y aplicable.
- **Prioridad y precio:** una sola oferta por producto (la de mayor prioridad; empate: el mejor precio para el cliente; luego el id más antiguo; pendiente de tu decisión 3). Precio en pesos enteros, redondeo al peso más cercano. Una oferta nunca puede subir el precio ni dejarlo negativo. Si el producto no tiene precio («a consultar») no hay oferta que aplicar: jamás se inventa un precio.
- **Validación previa a publicar** (puro): errores que bloquean con mensajes claros («Esta oferta no puede publicarse porque no tiene productos asociados», «Esta fecha de finalización ya pasó», «El precio especial no puede ser negativo», «Este combo no ahorra nada frente a comprar por separado») y advertencias que no bloquean. Se rechaza pegar el enlace mayorista dentro de contenido visible para detal.

### F5. Precio efectivo: un solo punto

Hoy el precio sale del producto por canal en un solo lugar del pedido (`motor.ts:310`) y en otro de la tienda. Propuesta: una función `resolverPrecios(negocio, canal, productos, ahora)` que devuelve `precio_lista`, `precio_final` y la oferta aplicada. Se enchufa en:

1. la resolución de productos (`lib/catalogo/resolucion.ts`; el `prices` de lista no cambia de significado);
2. el motor de pedidos (`motor.ts:310`): `unitPrice` = precio final, y la línea guarda `precio_lista` y `oferta` para poder explicar el cobro;
3. la tienda (precio tachado, precio final y «vigente hasta»);
4. las herramientas de producto de ARIA (que devuelven ambos precios y la oferta de forma estructurada);
5. la cotización firmada: si la oferta empieza o termina entre el carrito y la confirmación, `price_changed` ya obliga a reconfirmar.

Esto es compatible con «una referencia = un precio» siempre que las ofertas sean **modificadores del precio unitario**. Las promociones por cantidad (2x1, 3x2) quedan fuera y se cubren con combos. El filtro de precio máximo de la búsqueda seguirá usando el precio de lista en SQL (devuelve un subconjunto seguro: nunca algo que supere el presupuesto); mejora posterior, documentada.

Con el módulo apagado o sin ofertas vigentes, el resultado debe ser **idéntico** al actual (pruebas doradas sobre las suites existentes).

### F6. Combos

Dos formas posibles, que dependen de tu decisión 2:

- **Etapa 1 (recomendada):** el combo se administra, se muestra en la tienda y ARIA lo consulta (componentes, cantidades, precio, disponibilidad, vigencia); la venta la cierra la asesora o el cliente agrega los componentes por separado. No toca pedidos.
- **Etapa 2 (PR aparte):** el combo se compra desde el carrito y ARIA. Es una **línea de pedido de tipo combo** (`combo_id`, nombre, cantidad, precio del combo y componentes) cuyo stock se reserva expandido a componentes (sumando lo que el mismo cliente compre suelto). Exige tocar normalización, cotización (llave por línea, no por referencia), reservas, panel de pedidos, documentos y avisos. Es la parte más riesgosa del bloque y por eso va aparte y con su propia batería de regresión.

### F7. Tienda

Reemplazar las 3 lecturas de `storefrontConfigFor(slug)` por una carga asíncrona `cargarVitrina(negocio)` que devuelve **el mismo contrato** `CatalogStorefrontConfig`: CMS publicado primero y el `REGISTRO` actual como respaldo (también cuando falta el esquema o el módulo está apagado). La vista previa vive en el Dashboard (solo admin, `noindex`, sin caché) y es la única que lee borradores. No hay despliegue ni revalidación al publicar, por el renderizado dinámico de A3. Si más adelante hiciera falta caché por consumo de Supabase: `unstable_cache` con etiqueta y `revalidateTag` al publicar (modelo previo documentado en Next 16).

### F8. ARIA

- **Cuatro herramientas** (nombres en español como `consultar_envio`; menos viajes que las nueve del borrador):
  - `consultar_ofertas` (opcional: referencia o categoría),
  - `consultar_combos` (opcional: id),
  - `consultar_campanas`,
  - `consultar_contenido_comercial` (tema de una lista cerrada).
- **Contrato de cada herramienta:** entrada estricta sin negocio, canal ni precio (salen del contexto del turno); devuelve solo lo **publicado + vigente + aplicable** al canal del cliente, con `ahora` del backend, `vacio: true/false`, precios y condiciones ya calculados y textos «para citar tal cual». «No tenemos promociones» solo puede decirse con `vacio: true` en ese mismo turno.
- **Guarda `lib/agente/comercial-anclaje.ts`** (molde: `envios-anclaje.ts`), activa solo en negocios con el módulo y las herramientas habilitadas. Códigos estables, por ejemplo: `percent_unbacked`, `discount_unbacked`, `offer_unbacked`, `combo_unbacked`, `campaign_unbacked`, `validity_unbacked`, `wholesale_leak`, `policy_figure_unbacked`. Una corrección y, si persiste, traspaso a asesora con texto fijo; **nunca se envía lo que el sistema no respalda**.
- **Contratos duros** (la especificación, Fase 8): precio, stock, oferta, vigencia, modalidad, publicación, combo, campaña y negocio. Los de filtro (modalidad, publicación, vigencia, campaña, negocio) viven en **una sola capa de evaluación**; los de precio y stock, en el precio efectivo y la disponibilidad.
- **Prompt:** cero datos comerciales. Solo 3 o 4 líneas genéricas en las reglas de plataforma («para ofertas, combos, campañas y políticas consulta la herramienta y no afirmes nada que no devuelva»).
- **Migración de los 24 textos:** se importan como contenido (script idempotente que tú revisas tema por tema) y, **solo después de verificar**, se retiran del prompt de Delacour. Hasta entonces conviven, con el cambio apagado.
- **Límite honesto de la guarda:** puede verificar cifras, montos, porcentajes, plazos, fechas, nombres y qué categorías de ofertas existen; **no** puede demostrar cualquier paráfrasis cualitativa de una política. Mitigación: las políticas se devuelven como bloque a citar literal, la guarda vigila toda cifra o plazo, y la evaluación con Gemini real mide el resto. Queda como riesgo residual explícito.

### F9. Dashboard «Administración de tienda»

`/dashboard/tienda` (módulo `cms_comercial`; ver: `admin`, `agente`, `lectura`; crear, editar, publicar, pausar, despublicar y restaurar: **solo `admin`**, igual que el catálogo). Pestañas: Página principal · Destacados · Ofertas · Combos · Campañas · Contenido · Historial. Acciones: crear, editar, guardar borrador, previsualizar, publicar, pausar, despublicar y restaurar versión; indicador «tiene cambios sin publicar»; validaciones claras; historial con valor anterior y nuevo. Más adelante se puede agregar un panel «Qué sabe ARIA hoy» (solo lectura, por canal y fecha).

### F10. Imágenes

Mismo patrón que las fotos de producto: URL firmada, ruta decidida por el servidor (`{negocio}/cms/{uploadId}`), validación de tipo, tamaño, firma del archivo y dimensiones, variantes WebP con `sharp` (para no penalizar la carga de la portada) y ruta pública tipo proxy. Texto alternativo obligatorio.

### F11. Seguridad y aislamiento

- Negocio siempre desde la membresía; `id_tenant` en cada consulta, RPC e índice; RLS activa sin políticas; pruebas con **dos negocios**.
- Texto plano siempre (React escapa; sin `dangerouslySetInnerHTML`); destinos de botón de lista cerrada (catálogo, categoría, búsqueda, oferta o campaña, WhatsApp; **sin enlaces externos** en v1); límites de tamaño y de cantidad.
- Lo editado por el administrador viaja a ARIA como **dato de herramienta**, no como instrucción de sistema.
- Sin secretos en auditoría ni en contenido; el token del enlace mayorista nunca entra al CMS.

### F12. Despliegue gradual y reversa (instrucciones que se entregarán al final)

1. Se fusiona y despliega el código: **inerte** (módulo apagado y tolerante a esquema ausente).
2. El dueño corre la migración (idempotente); se verifica con las pruebas SQL.
3. Aprovisionamiento de Delacour: activar módulo y sembrar la portada actual (la tienda se ve igual).
4. Se enciende lector de tienda → herramientas y guarda de ARIA → migración de los 24 textos.
5. Cada paso se revierte apagando el módulo o la herramienta; el rollback SQL queda como último recurso.

### F13. Plan de pruebas (se reportará con números, no con «funciona»)

- **Unitarias:** vigencia (bordes, Bogotá), precio (redondeo, prioridad, sin precio), validación, disponibilidad de combos, variables.
- **Integración:** servicio + repositorio en memoria; máquina de estados borrador → publicada → pausada → restaurada.
- **Aislamiento:** dos negocios; ninguna lectura ni escritura cruza.
- **Permisos:** matriz 3 roles × todos los endpoints.
- **Publicación y vigencia:** el borrador nunca se ve; la oferta vencida, pausada o de campaña inactiva nunca llega a ARIA.
- **ARIA:** los 12 casos obligatorios y las 18 preguntas adversariales como pruebas por tabla contra herramientas + guarda con un modelo guionizado; evaluación opcional con Gemini real y clave de prueba (`GEMINI_EVAL_KEY`; nunca se imprime ni se guarda ni se usa la de Delacour).
- **Regresión:** pruebas doradas (módulo apagado = misma salida) sobre catálogo, búsqueda, carrito, checkout, reservas, pedidos, asesora, límites, lenguaje; AMORE y Publi Bordados sin cambios.
- **Mutación:** `scripts/mutacion/cms.py` (uso `cms` y no `b29`: ese nombre ya lo tiene el bloque de la marca de referencia). Si una protección se puede quitar sin que falle ninguna prueba, se refuerzan.
- **SQL:** se ejecutan las pruebas de verdad con `@electric-sql/pglite` (devDependency, Postgres en WASM) si se puede instalar: desde cero, sobre el estado actual, doble ejecución, aislamiento, rollback. Si no, quedan escritas para un Postgres efímero y se avisa.
- **E2E:** flujo completo con datos sintéticos (nunca contra Delacour ni contra producción) y revisión visual en el navegador integrado con API simulada, como en AMORE.

### F14. Entrega en 5 PRs encadenados (cada uno se puede fusionar por separado y no cambia nada hasta activarse)

| PR | Contenido | Fases de la especificación |
|---|---|---|
| 1 | **Fundación:** módulo, migración + rollback + pruebas SQL, dominio puro, repositorios (memoria y Supabase), API, versiones y auditoría. Sin pantallas ni consumidores | 1, 3–6 (modelo), 8 (reglas), 9, 10, 15 |
| 2 | **Dashboard** de administración, validaciones, vista previa, imágenes | 1, 2, 11 |
| 3 | **Tienda:** portada, secciones y destacados desde el CMS (respaldo `REGISTRO`); sin tocar precios | 2, 12 |
| 4 | **Precio efectivo + ofertas** en tienda, carrito, pedido y búsqueda; combos consultables (compra según decisión 2) | 3, 4, 5, 8, 12 |
| 5 | **ARIA:** herramientas, guarda, contratos, migración de los 24 textos y evaluación con Gemini | 6, 7, 13, 14, 18 |
| Final | Informe de 16 puntos con números, riesgos, pendientes e instrucciones exactas de producción | 16, 17, 19 |

Las pruebas de regresión (fase 16) y la matriz (fase 17) corren en **cada** PR. Me detengo antes del merge en todos.

---

## G. Riesgos

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| 1 | El precio efectivo toca el camino caliente de los pedidos (resolución → motor → cotización): un error cobraría mal | Alta | Un solo punto, interruptor por negocio, pruebas doradas, mutación sobre el motor, `price_changed` ya protege el cambio de precio |
| 2 | Combos en pedidos: choca con «una referencia = un precio» (normalización, cotización, reservas, panel, avisos) | Alta | Decisión 2; PR aparte; línea de tipo combo con componentes |
| 3 | Dos fuentes de verdad al migrar (prompt vs. CMS) y el 750.000 duplicado | Alta | Variables controladas; cambio por negocio y por etapas con tu revisión; prueba de que el prompt ya no trae cifras comerciales |
| 4 | La guarda no puede probar paráfrasis cualitativas de políticas | Alta (residual) | Bloques a citar literal + guarda de cifras y plazos + traspaso a asesora + evaluación con Gemini real; riesgo documentado |
| 5 | Zona horaria y bordes de vigencia («hasta el 31») | Media | Bogotá explícita, fin de día inclusivo, reloj inyectado, «vencida» derivada |
| 6 | Fuga de borradores a la tienda o a ARIA | Media | Lector público y lector de borradores separados por tipo + pruebas + mutación |
| 7 | Fuga detal ↔ mayorista | Media | Filtro de modalidad en una sola capa, canal solo desde el backend, adversariales, mutación |
| 8 | Fuga entre negocios | Media | `id_tenant` en todo, claves compuestas, RLS sin políticas, pruebas con dos negocios |
| 9 | Consumo de Supabase y latencia (incidente de cuota 2026-09-19) | Media | Una consulta compacta por vista; imágenes por CDN; caché con etiqueta solo si hace falta |
| 10 | Contenido editado como vector de inyección de prompt o XSS | Media | Texto plano, destinos cerrados, límites, dato de herramienta y no instrucción |
| 11 | No hay Postgres local: las pruebas SQL de la convención no corren aquí | Media | `pglite` como devDependency o script para un Postgres efímero; nunca contra producción |
| 12 | Más herramientas = más latencia y el modelo podría no llamarlas | Media | La guarda exige respaldo; evaluación real; límite de herramientas por turno ya existente |
| 13 | El filtro de precio máximo usa precio de lista (subconjunto seguro) | Baja | Documentado; mejora posterior |
| 14 | Colisión de nombre «Bloque 29» con el de marca de referencia | Baja | Nombres `cms-*` |
| 15 | Delacour tiene un solo administrador | Baja (operativo) | Recomendar un segundo administrador antes de entregar |
| 16 | La tienda mayorista no tiene portada propia | Baja | v1 cubre la tienda detal; documentado |

---

## H. Conflictos entre la especificación y la arquitectura actual (documentados antes de implementar)

1. **Precio.** La especificación quiere ofertas con descuento y que ARIA «use el nuevo precio». Hoy el pedido cobra `precio` o `precio_mayor` del producto y no existe el concepto de descuento. → Se resuelve con el precio efectivo (F5). **Necesita tu confirmación** (decisión 1).
2. **Combos.** La especificación quiere combos con precio propio. Hoy `normalizeOrderItems` fusiona líneas por referencia y la cotización guarda un precio por referencia. → F6, por etapas. **Decisión 2.**
3. **Fuente de verdad.** Políticas, promociones y mayoristas están hoy en el prompt (`negocio.conocimiento`) y el mínimo mayorista en la configuración y en un texto. → Una sola fuente tras la migración (F8). **Decisión 5.**
4. **Estados de oferta.** La especificación lista `VENCIDA` como estado. → Se guarda `borrador`/`publicada`/`pausada` y `vencida` se **deriva** al leer (sin proceso programado).
5. **Roles.** La especificación dice que el agente tiene «los permisos existentes». Hoy en el catálogo el agente solo puede ver (escribir es solo admin). → Ver para los tres roles, editar y publicar solo admin.
6. **Guarda de anclaje.** Hoy no vigila porcentajes, ofertas, combos ni vigencias, justo lo que piden los casos adversariales. → Guarda nueva (F8).
7. **Pruebas SQL.** La convención exige Postgres efímero y aquí no hay. → `pglite` (F13).

---

## I. Decisiones de negocio que necesito de ti (con mi recomendación)

1. **¿Una oferta debe cambiar lo que se cobra en el pedido?** *Recomiendo sí.* Si no, ARIA o la tienda podrían prometer un precio que el pedido no respeta. Si la oferta termina entre el carrito y la confirmación, el sistema ya le avisa al cliente que el precio cambió.
2. **Combos: ¿se compran completos desde el carrito y ARIA en esta entrega?** *Recomiendo etapa 1:* primero se administran, se muestran y ARIA los consulta; la asesora cierra la venta; la compra por carrito va en un PR siguiente. La otra opción es comprar el combo completo desde el inicio, que toca pedidos, reservas, panel y avisos.
3. **Si dos ofertas aplican al mismo producto, ¿se acumulan o aplica una sola?** *Recomiendo una sola:* la de mayor prioridad (empate: la que deja mejor precio al cliente).
4. **Mayoristas:** (a) ¿el mínimo de $750.000 se mide sobre el valor **con** descuento (lo que realmente paga) o **sin** descuento? *Recomiendo con descuento.* (b) ¿Qué puede ver un cliente detal de lo mayorista? *Recomiendo solo lo informativo* (cómo funciona y el mínimo de compra); nunca precios, ofertas, combos ni catálogo mayorista.
5. **Los 24 textos de ARIA:** ¿los paso al CMS como contenido administrable y los quito del prompt, revisándolos contigo tema por tema? *Recomiendo sí, por etapas:* primero los comerciales (Promociones, Venta al por mayor, Envíos, Medios de pago, Garantías, Cambios y devoluciones, Horario, Ubicación) y dejo identidad y tono («Quiénes somos», «Despedida», etc.) en el perfil.

### Decisiones técnicas que tomo y documento (las cambio si me dices otra cosa)

- Editar y publicar: solo `admin`; `agente` y `lectura`: solo consultar.
- Tipos de beneficio v1: porcentaje, monto fijo y precio especial. Promos por cantidad: vía combos.
- Botones de portada: destinos internos y WhatsApp; sin enlaces externos.
- Pesos enteros, redondeo al peso más cercano.
- Portada solo en la tienda detal (la mayorista conserva su encabezado actual).
- Nombres de tablas y código `cms`; módulo `cms_comercial`.
- Cinco PRs encadenados; me detengo antes de cada merge.
- Nada se ejecuta en producción: migración, aprovisionamiento y activación los corres tú, con sus rollbacks.
