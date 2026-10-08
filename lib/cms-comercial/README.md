# CMS comercial (Bloque 29)

Contenido comercial **administrable por negocio** (página principal, ofertas, combos, campañas y contenido como preguntas frecuentes o políticas) con un ciclo único:

```
BORRADOR → VALIDACIÓN → PUBLICAR → VERSIÓN ACTIVA   (+ pausar · despublicar · restaurar · archivar · historial y auditoría)
```

Lo único que ven la tienda, el carrito/pedido y ARIA es lo **publicado, vigente y aplicable al canal del cliente**. Los borradores solo los lee el editor del Dashboard.
Un negocio sin el módulo `cms_comercial` no tiene nada de esto: ni API, ni menú, ni lectura publicada (todo se comporta exactamente como antes).

## Principios (cada uno tiene su prueba y su mutante en `scripts/mutacion/cms.py`)

1. **Una sola fuente de verdad**: la base de datos. Ningún dato comercial vive en el prompt de ARIA.
2. **Lo que escribe la administradora es DATO, nunca instrucción.** El contenido llega a ARIA solo como resultado de una herramienta del backend; además se bloquean las frases que intentan dar órdenes al asistente, el HTML y las claves pegadas (`texto-seguro.ts`).
3. **El modelo interpreta, el backend autoriza.** Vigencia, modalidad (detal/mayorista), campaña, prioridad y precio los decide `evaluacion.ts`, pura y con el reloj y el canal inyectados. El canal lo decide el backend, nunca el modelo.
4. **Publicado y borrador no se mezclan**: un único lector (`lector.ts`) y una única función SQL (`dulabs_cms_lectura_activa`) entregan lo publicado.
5. **«Vencida» se deriva al leer**, sin procesos programados: una oferta deja de valer en el instante exacto de su fin (hora de Bogotá, `[desde, hasta)`).
6. **Aditivo y apagable**: tablas nuevas, ninguna existente cambia; todo cuelga del módulo.

## Piezas

| Archivo | Qué es |
|---|---|
| `contrato.ts` | Tipos y constantes compartidas (estados, modalidades, roles, auditoría) |
| `esquemas.ts` | Esquemas zod de cada tipo (contenido PUBLICABLE, estricto) y `normalizarBorrador` (JSON seguro, aunque esté incompleto) |
| `tiempo.ts` | Fechas de Bogotá, `estadoDeVigencia`, fechas en palabras para el cliente |
| `texto-seguro.ts` | Texto plano, órdenes al asistente, enlace mayorista, secretos |
| `variables.ts` | Variables cerradas (`{{minimo_mayorista}}`): un número que ya existe en la configuración no se escribe a mano |
| `validacion.ts` | Errores que bloquean y advertencias, con mensajes claros; recibe un contexto ya cargado |
| `evaluacion.ts` | **El único lugar** donde se decide qué está activo, qué oferta aplica a un producto, a qué precio y qué combo está disponible |
| `publicado.ts` · `lector.ts` | La instantánea de lo publicado; el lector verifica estado, checksum y esquema y descarta lo que no pase |
| `servicio.ts` | El ciclo completo con permisos por rol |
| `repositorio.ts` · `repositorio-supabase.ts` | Contrato y adaptador: TODO pasa por funciones SQL `dulabs_cms_*` |
| `adaptadores-supabase.ts` | Puertos de solo lectura al catálogo (productos y categorías) y a las variables del negocio |
| `auth.ts` · `http.ts` · `http-esquemas.ts` | Sesión + rol + módulo (fail-closed), límite de peticiones, envelope de errores |
| `imagen-servidor.ts` · `almacen.ts` · `imagenes.ts` | **Imágenes** (PR 2): la foto sube directo a Storage con URL firmada; el servidor la verifica (firma real, ≤ 6 MB, ≤ 40 megapíxeles, no animada) y la re-codifica a WebP ≤ 2400 px sin metadatos, siempre bajo `{negocio}/cms/{id}/` |
| `previa.ts` | **Vista previa** (PR 2): usa las MISMAS funciones de `evaluacion.ts` (precio con oferta, ahorro, precio normal y disponibilidad del combo, variables): lo que se ve es lo que el backend calcularía |
| `json-canonico.ts` | JSON canónico apto para el navegador (checksum del servidor y detección de cambios del editor) |
| `../cms-comercial-client.ts` | Cliente del navegador de `/api/dashboard/tienda/*`: resultados tipados que nunca lanzan; la subida de imágenes en etapas (preparar → URL firmada → Storage → confirmar) |
| `vitrina.ts` | **La tienda lee del CMS** (PR 3), PURO: `vitrinaDesdeCms` convierte lo publicado en la vitrina de la tienda; `hrefDeDestino` decide a dónde lleva un botón (solo si el destino existe y está activo hoy); `imagenDeVitrina` y `assetsReferenciados` (qué imágenes puede servir la ruta pública) |
| `vitrina-publica.ts` · `publico-supabase.ts` | Carga de la vitrina CON RESPALDO (inyectable) y su cableado real (perezoso): ante cualquier problema la tienda usa la vitrina de siempre, sin error para el cliente |
| `lectura-publicada.ts` | La lectura de lo publicado que comparte una página (`cache` de React): la vitrina, los combos y los precios de un mismo inicio leen el contenido UNA vez por render (antes eran 3 lecturas); fuera de un render del servidor (rutas, motor de pedidos, ARIA) no memoiza |
| `precios.ts` · `precios-supabase.ts` | **El precio efectivo** (PR 4): implementa el puerto de precios del catálogo con lo PUBLICADO (`crearEvaluadorPrecios`, `crearPuertoPreciosCms`) y su cableado real (`repositorioConPrecios`) |
| `imagen-publica.ts` | Ruta pública de imágenes `/catalogo/{tienda}/vitrina/{id}.webp`: solo imágenes LISTAS, usadas por contenido PUBLICADO y de la carpeta del propio negocio; todo lo demás, el mismo 404 |
| `siembra-vitrina.ts` | Genera la página principal equivalente a la tienda de hoy y el SQL que la siembra (y su reversa) en `supabase/provisioning/<tienda>/` |
| `testing/` | Fixtures, Postgres embebido (PGlite), el puente que lleva las llamadas `rpc/dulabs_cms_*` de las rutas al SQL real, un almacén de imágenes en memoria y `fetch-rutas.ts` (lleva el cliente del navegador a las rutas reales) |

## Datos (migración `20261210000000_dulabs_cms_comercial.sql`)

- `dulabs_cms_entidades`: un elemento por fila, con `borrador`, `estado` (`borrador|publicada|pausada`), `version_activa` y `rev` (control optimista).
- `dulabs_cms_versiones`: instantánea **inmutable** (append-only) de cada publicación o restauración, con checksum SHA-256 del JSON canónico.
- `dulabs_cms_auditoria`: quién, qué, cuándo, antes y después (append-only), escrita en la **misma transacción** del cambio.
- `dulabs_cms_assets`: imágenes subidas; la ruta queda siempre bajo `{negocio}/cms/{id}/`.

Aislamiento: `id_tenant` en cada tabla, claves foráneas compuestas (una versión o un puntero nunca cuelgan de otro negocio), cada función recibe el negocio y lo filtra siempre; RLS sin políticas y funciones ejecutables solo por `service_role`.

## Ciclo de vida

```
crear ──► borrador ──guardar──► (rev+1)
              │ publicar (valida; publica EXACTAMENTE la revisión validada)
              ▼
          publicada ◄──reanudar── pausada
              │  ▲ restaurar (versión nueva)
              │  └──────────────────────────────┐
              └──despublicar──► borrador ──archivar──► archivada
```

- Publicar exige que la validación no tenga errores y que `rev` y la versión activa sean las esperadas (si no: conflicto, no se publica nada).
- Restaurar copia una versión anterior como versión **nueva**, la vuelve a validar con las reglas de hoy y verifica su checksum; no descarta el borrador pendiente.
- Despublicar conserva lo que estaba publicado como borrador: no se pierde nada.

## Reglas comerciales (decididas por el negocio)

- Las ofertas modifican el precio efectivo real; no se acumulan: gana UNA (mayor prioridad; empate: mejor precio final para el cliente; luego la más antigua; luego el código).
- Los combos se administran, se muestran y ARIA los consulta; **no** se compran desde el carrito (los cierra una asesora).
- El mínimo mayorista se calcula sobre el valor final tras descuentos y existe una sola vez (`negocio.pedido.minimo_mayorista`; los textos usan `{{minimo_mayorista}}`).
- Un cliente detal nunca recibe precios, ofertas, combos ni enlaces mayoristas; sí puede recibir información general sobre la venta mayorista y su mínimo.

## API (`/api/dashboard/tienda/*`)

Lectura (admin, agente, lectura) y escritura (solo admin). El negocio sale de la sesión.
`GET/POST entidades` · `GET entidades/{id}` · `PUT entidades/{id}/borrador` · `POST entidades/{id}/{validar|publicar|restaurar|pausar|reanudar|despublicar|archivar|desarchivar}` · `GET entidades/{id}/versiones` · `GET auditoria`.
Para el editor (PR 2): `GET imagenes` (galería) · `POST imagenes/upload-url` (URL firmada; solo admin) · `POST imagenes/{id}/confirmar` (verifica y re-codifica; idempotente; solo admin) · `GET productos` (`?q=` o `?referencias=`; sin ids internos) · `GET contexto` (categorías, variables con su valor, zona horaria).

## Dashboard · «Tienda» (`/dashboard/tienda`, PR 2)

Entrada del menú **Tienda**, visible solo en los negocios con el módulo `cms_comercial` (todos los roles consultan; la API exige administrador para modificar). Pestañas: Página principal · Ofertas · Combos · Campañas · Contenido · Historial.
Cada elemento se edita con el ciclo **borrador → revisar → vista previa → publicar → versiones → restaurar**:

- Se guarda un borrador sin afectar la tienda; **Revisar** valida en el servidor (mismos mensajes claros de siempre, marcados junto a cada campo); **Publicar** guarda lo pendiente, revisa y publica EXACTAMENTE la revisión validada (si otra persona cambió algo, hay conflicto y no se publica nada).
- Antes de publicar se muestra qué cambia («Porcentaje de descuento: 20% → 25%»); el historial y las versiones usan el mismo resumen. Restaurar crea una versión nueva y no se permite con cambios sin guardar.
- Cambios sin guardar: el navegador avisa al cerrar y la pantalla pregunta al volver o al tocar un enlace del menú.
- Todo el contenido editable es **dato**: no hay campos para «instrucciones»; el servidor rechaza textos con órdenes al asistente, HTML y claves, y el editor lo dice en cada campo de texto.
- Un administrador edita; agente y lectura ven todo sin poder tocar nada (y aunque una pantalla manipulada lo intentara, la API responde 403).

## La tienda pública lee del CMS (PR 3)

El inicio de la tienda (`/catalogo/{tienda}`) usa lo PUBLICADO en la página principal del CMS. El catálogo sigue siendo la fuente de productos, precios y fotos: el CMS solo **elige** qué mostrar y en qué orden. Este PR **no cambia ningún precio** (el precio efectivo llega con el PR 4, más abajo).

- **Respaldo total**: sin el módulo, sin migración, sin página principal publicada, con la tienda de tecnología (tiene su propio contenido), ante un error de la base o una lectura de más de 2,5 s, la tienda usa su vitrina de siempre. El HTML del inicio con la configuración de hoy queda guardado en `components/catalogo-publico/tienda/__dorados__/` y una prueba exige que sea idéntico byte a byte.
- **Nunca a medias**: la portada solo sale con imagen LISTA y título; un botón o banner solo existe si su destino existe y está activo hoy (categoría borrada, oferta vencida, campaña de otra modalidad, número de WhatsApp inválido: no se muestra).
- **Imágenes**: salen por `/catalogo/{tienda}/vitrina/{id}.webp` (nunca la dirección de Storage), con las medidas reales del archivo y solo si están usadas por contenido publicado.
- **Secciones**: las visibles que la tienda sabe dibujar (portada, categorías, destacados, banner, campaña y —desde el PR 4— ofertas y combos), en el orden elegido. Si no hay lista, el orden de siempre.
- **Destacados, categorías y productos de la campaña** se resuelven contra el catálogo real (activos y del negocio); si ninguno sirve, el criterio automático de siempre.
- **Campaña**: una sola, la vigente de mayor prioridad que tenga portada o productos (modalidad detal, `[desde, hasta)` en hora de Bogotá).
- **Siembra**: `supabase/provisioning/delacour/03_sembrar_vitrina_actual.sql` (generado por `siembra-vitrina.ts`) publica la portada y el banner de hoy como versión 1; la tienda leída del CMS es idéntica a la de hoy (prueba `inicio-siembra.pglite.test.tsx`).

## El precio efectivo: ofertas y combos en la tienda, el carrito y el pedido (PR 4)

**Una sola decisión de precio.** El precio que se *muestra* (tarjeta, ficha, carrito), el que se *firma* (cotización) y el que se *cobra* (pedido, motor de pedidos, herramientas de ARIA) sale del mismo cálculo: la oferta publicada baja el precio de verdad y no puede existir una diferencia entre lo mostrado y lo cobrado.

- **Puerto** (`lib/catalogo/precios.ts`, sin dependencia del CMS): `precioQueRige(producto, canal, efectivo)` es la decisión única. La oferta solo rige si deja un precio entero, positivo y MENOR que el de lista del mismo producto y canal, y fue calculada sobre ese mismo precio de lista; en cualquier otro caso rige el precio de lista. El repositorio del catálogo puede traer un `PuertoPrecios` opcional (`conPrecios`); sin él —módulo apagado, sin migración— el precio es exactamente el de lista de siempre.
- **CMS** (`precios.ts`): implementa el puerto preguntando a `evaluacion.ts` con lo PUBLICADO y el reloj inyectado. Una sola oferta por producto (mayor prioridad; empate: mejor precio para el cliente; luego la más antigua; luego el código). Con el módulo encendido siempre hay evaluador (aunque no haya ofertas): así la tienda sabe que sus precios pueden cambiar al publicar. `precios-supabase.ts` es el cableado real (`repositorioConPrecios`).
- **Falla cerrada para quien cobra.** La cotización y el pedido verifican las ofertas de forma ESTRICTA: si el negocio usa ofertas y no se pudieron leer, el pedido no se prepara (`PreciosNoDisponibles`). Las vitrinas y listados NO se caen: muestran el precio de lista y dejan el aviso en el registro.
- **Sin precios viejos**: con ofertas (o en el canal mayorista) la selección de la tienda responde `private, no-store`; sin el módulo queda la caché corta de siempre. Si una oferta se pausa o vence entre la cotización y el pedido, el pedido NO sale con el precio viejo: se ajusta (`price_changed`) y el cliente confirma de nuevo.
- **Evidencia en el pedido**: la línea guarda el precio efectivo y, solo si una oferta fijó ese precio, `list_price` y `offer {key, name, version}` en el mismo JSON de las líneas (la función SQL solo lee referencia y cantidad: sin migración). Los eventos v2 del pedido NO cambian de contrato (precio efectivo y nada más). El panel y la vista de ARIA muestran el precio de lista y el nombre público de la oferta, nunca su código.
- **Mensaje de WhatsApp**: solo suma «Incluye ofertas vigentes (ahorro: $X)» (un monto): ningún texto escrito por la administradora entra al mensaje que lee el webhook.
- **Mínimo mayorista**: se calcula sobre `order.total`, que ya es el valor final con las ofertas aplicadas.
- **Canal** siempre por backend: la oferta mayorista no toca el precio detal ni viceversa, y el cliente detal jamás recibe precios, ofertas ni combos mayoristas.
- **Combos (Etapa 1)**: se muestran en el inicio con lo que incluyen, su precio, el «precio normal» (la suma de lo que se paga hoy por separado, ofertas incluidas) y su disponibilidad (la calcula el backend con el inventario real; nunca el stock exacto). No se compran desde el carrito: el único botón es «Pedir con una asesora» (WhatsApp) y solo aparece si el combo está disponible y el negocio tiene un número válido.
- **Ofertas en la home**: la sección anuncia el beneficio, qué cubre, hasta cuándo y las condiciones; los botones y banners solo llevan a una sección que está en la página (o a la campaña que esa sección muestra), nunca a un ancla vacía.
- **Una lectura por página**: la vitrina, los datos de los combos y los precios del inicio comparten una sola lectura de lo publicado (`lectura-publicada.ts`); las rutas de selección y pedido, el motor de pedidos y ARIA no memoizan: siempre leen lo vigente en ese momento. Cada visita a la tienda de un negocio SIN el módulo suma una consulta pequeña que responde «sin CMS» (si esto pesara, el siguiente paso sería recordar «sin CMS» unos segundos por negocio).
- **Límite conocido**: el filtro de precio máximo de la búsqueda de ARIA (consulta SQL sobre el precio de lista) puede no incluir un producto con descuento cuyo precio de lista supere el máximo; nunca incluye de más.

## Pruebas

`npm run test:flow` (los archivos están en `scripts/test-flow-manifest.txt`). El SQL se ejecuta de verdad en Postgres embebido (`@electric-sql/pglite`): migración desde cero, sobre un estado previo, varias veces y con su reversa; el repositorio, el servicio y las rutas corren sobre ese SQL.
Las pruebas de **pantalla** (`components/dashboard/tienda/tienda.dom.test.tsx`, jsdom + Testing Library) recorren la interfaz completa contra la API REAL y el SQL REAL: pantalla → cliente → rutas (sesión, rol, módulo) → servicio → base. Importan `@electric-sql/pglite` ANTES que jsdom (PGlite decide de dónde carga su WASM al cargarse el módulo).
Mutación: `python3 scripts/mutacion/cms.py` (quita o invierte una protección a la vez; alguna prueba debe fallar).

## Activación en producción (nada se ejecuta solo)

1. Se fusiona y despliega el código: **inerte** (módulo apagado; sin la migración, el CMS «no existe» y todo sigue igual).
2. El dueño corre `supabase/migrations/20261210000000_dulabs_cms_comercial.sql` (idempotente). Reversa: `supabase/rollbacks/20261210000000_dulabs_cms_comercial.down.sql` (se niega a correr si hay contenido).
3. Se habilita el módulo `cms_comercial` del negocio (fila en `dulabs_tenant_modulos`).
4. El PR 2 (Dashboard) no agrega migraciones: la entrada **Tienda** aparece sola donde el módulo esté habilitado.
5. PR 3 (la tienda lee del CMS): sin cambios de esquema. Con el módulo habilitado y NADA publicado, la tienda sigue idéntica. Se corre `supabase/provisioning/delacour/03_sembrar_vitrina_actual.sql` (después del 02): publica la portada y el banner de hoy como contenido del CMS (la tienda se ve igual) y la administradora los encuentra listos para editar. Reversa: `03_sembrar_vitrina_actual.reversa.sql`.
6. PR 4 (precio efectivo): sin cambios de esquema ni SQL nuevo. Con el módulo habilitado la tienda empieza a leer las ofertas y los combos que la administradora publique; mientras no publique nada, todo sigue idéntico (precio de lista). Para apagarlo basta deshabilitar el módulo del negocio: vuelve el precio de lista.
7. El siguiente PR conecta ARIA (herramientas de consulta con contratos estrictos).
