# Delacour & Orus — lado de HOMBRE («Vértice»)

Pedido de la clienta (2026-11-12): separar la joyería de **mujer** y la de **hombre** en la tienda, que lo de hombre se vea en la paleta de su catálogo «Vértice» (grafito frío y plata: «que pase a ser
negra») y que la tienda se vea femenina y masculina a la vez. Quedó **construido en una rama** (`feat/delacour-hombre-vertice`) y **no está desplegado**: falta correr UNA migración y UN SQL en Supabase
(§4) y desplegar el código (la tienda pública está caída hasta que vuelva Vercel). Código: `lib/catalogo/genero.ts` · configuración: `lib/catalogo/vitrina.ts` (`delacour.joyeria.genero`) · colores:
`app/globals.css` («LADO DE HOMBRE») · pruebas: §8. No cambia ningún precio, inventario, carrito, pedido ni el agente de WhatsApp.

## 1. Cómo se ve

| Dónde | Qué hay |
|---|---|
| **Cabecera** (escritorio, desde 1280 px) | Selector **Mujer \| Hombre** antes de «Inicio»; el lado actual va en relleno. |
| **Menú lateral** (celular y escritorio) | El mismo selector arriba de todo, a todo el ancho; al elegir un lado el menú se cierra. |
| **Inicio** | Franja oscura **«Para él · Vértice»** entre «Nuestras líneas» y las categorías: el rótulo de la colección, el botón «Ver la colección» y las 4 piezas de hombre más recientes con foto. |
| **Inicio de hombre** (`?genero=hombre`) | Su propia portada de pantalla completa (grafito y acero, con el rótulo *Delacour · Colección masculina · VÉRTICE · Identidad forjada en acero* y el botón «Ver la colección»), su carrusel de categorías, sus productos destacados y, si la clienta sube videos, su video de portada, de colección y de marca. Detalle en §1b. |
| **Listado de hombre** (`?genero=hombre&todo=1`) | TODA la tienda (cabecera, listado, menú, filtros, buscador y pie) pasa a grafito y plata. Portada de la colección: *Delacour · Colección masculina · VÉRTICE · Identidad forjada en acero*. Migas `Inicio / Hombre`. El panel de filtros se queda en el lado de hombre. |
| **Ficha de una pieza de hombre** | También en grafito y plata, desde la primera pantalla (sin parpadeo de claro a oscuro). Migas `Inicio / Hombre / Categoría` y el rótulo «Delacour · Vértice». |
| **Lado de mujer** | **Idéntico al de siempre** (las pruebas comparan el HTML con y sin la separación). |

Al tocar «Hombre» o «Mujer» el color cambia al instante, sin esperar a que cargue la página nueva (lo decide la dirección, no la página). En el celular el selector también está bajo las migas del
listado; desde 1280 px sobra y se esconde (la cabecera ya trae el suyo).

## 1b. El inicio propio del lado de hombre («dos tiendas en una»)

«Hombre» abre un **inicio propio**, no solo un listado: `?genero=hombre` es su inicio y `?genero=hombre&todo=1` su listado (`genero` solo ya no abre el listado; lo abre `todo=1` o algún filtro, igual que el de mujer lleva `?todo=1`).
En el lado de hombre, «Inicio» y «Catálogo» (cabecera y menú) llevan a SU inicio y a SU listado, y «Catálogo» queda marcado en el listado de hombre.

| Bloque (en este orden) | De dónde sale |
|---|---|
| **Portada** de pantalla completa | Gráfica por defecto (grafito, destello de acero, rótulo de la colección). Si la clienta sube el **video de portada de hombre**, va detrás del texto con su velo. |
| **Categorías** (carrusel) | Las que tienen piezas de hombre, con la foto de una pieza de hombre; o las que la clienta elija (y su orden) y las imágenes que suba para cada una. Cada categoría lleva al listado de hombre de esa categoría. |
| **Productos destacados** | Lo más nuevo de hombre (con foto) o los que la clienta elija. La referencia `DL-…` va sobre cada foto. |
| **Video de colección** (opcional) | Solo si la clienta lo sube: video a pantalla completa con su título y botón. |
| **Marca** (opcional) | Solo si la clienta lo sube: texto y tarjeta de video. |

Nada del inicio de mujer aparece aquí (ni líneas, ni «Para él», ni mayoristas); el pie, las páginas y las preguntas frecuentes son de toda la tienda. Un bloque sin datos no se dibuja.

## 2. Cómo se decide si una pieza es de hombre

Una columna nueva, **`genero`**, en `dulabs_inventario_productos`: `'mujer'` (por defecto) o `'hombre'`. Todo lo que ya existía y todo lo que se cree nace **de mujer**; el panel lo cambia pieza por pieza
(§5) y el SQL del §4 marca de una vez las 76 de Vértice.

La tienda **separa los lados solo si se cumplen las tres cosas**: (a) la configuración de la tienda trae `genero` (hoy solo Delacour), (b) la migración está aplicada y (c) hay al menos **una pieza de
hombre activa**. Si falta cualquiera, la tienda es EXACTAMENTE la de siempre (ni selector, ni franja, ni color). Con la separación activa:

- El listado de siempre (sin `genero`) es el de **mujer** (sin las piezas de hombre); `?genero=hombre` es el de hombre. Las opciones y conteos de los filtros se calculan dentro del lado elegido.
- La **búsqueda por texto es global**: encuentra piezas de los dos lados.
- Los destacados automáticos y las portadas de categoría son solo de mujer (lo que la administradora eligió a mano en el CMS no se toca).
- La página y el catálogo de **mayoristas no se separan**.
- Un enlace viejo `?genero=hombre` en una tienda sin piezas de hombre se ignora (no pinta de oscuro una tienda que no tiene ese lado).

## 3. Los colores (paleta de la clienta)

Tomados de su catálogo `DELACOUR_VERTICE_DIJES_ACERO_CLIENTES.html`. Se aplican redefiniendo las MISMAS variables del tema (`--color-ink`, `--color-fg`…) cuando la página dice «lado de hombre»
(`data-tema-genero="hombre"`, lo pone `TemaGenero.tsx`), y solo dentro de la franja «Para él» del inicio (`.joy-vertice`).

| Uso | Color | Contraste |
|---|---|---|
| Fondo | `#111416` (grafito, no negro puro) · segundo fondo `#171c1f` · paneles `#1b2023` · líneas `#394147` | — |
| Texto principal | `#f4f5f5` | 16,9 : 1 sobre el fondo · 15,1 sobre los paneles |
| Texto de apoyo | `#9ba5aa` | 7,4 : 1 sobre el fondo · 6,5 sobre los paneles · 4,6 sobre lo más claro del degradado |
| Plata (enlaces, antetítulos, lema) | `#c2c9cc` (al pasar: `#e3e9eb`) | 11,0 : 1 sobre el fondo · 9,8 sobre los paneles |
| Botones llenos de plata | texto **oscuro** `#111416` | 11,0 : 1 (el blanco de siempre daba 1,7 : 1: no se lee) |
| Acero decorativo (filetes, rombos) | `#a7b7bd` | 8,9 : 1 |
| Controles de los filtros (casilla, perilla) | mezcla de gris y panel | 4,8 : 1 (mínimo exigido 3 : 1) |
| Degradado de la portada | `#303b40` → fondo | el de Vértice |

Pasar de un lado al otro **solo cambia colores**: ninguna medida, posición ni movimiento (una prueba lee el CSS y lo exige). La cabecera de vidrio conserva su respaldo sin transparencia. Detrás de la
tienda (rebote del celular, barras de desplazamiento) también es grafito.

## 4. Lo que hay que correr en Supabase (lo corre el dueño en el SQL Editor)

**Estado: ✅ corridos en producción el 12-nov-2026** por el dueño, en una sola pegada de ambos archivos. Verificación: columna `true`, hombres `76`, mujeres `708` (784 piezas de Delacour). Para esta función no queda nada por correr: el inicio propio de hombre y su edición desde el panel no llevan SQL (§5).

| Orden | Archivo | Qué hace |
|---|---|---|
| 1 | `supabase/migrations/20261215000000_dulabs_catalogo_genero.sql` | Agrega `genero` (por defecto `'mujer'`, solo admite `mujer`/`hombre`) y un índice parcial de las piezas de hombre. **Aditiva e idempotente**: no cambia ningún dato existente. |
| 2 | `supabase/provisioning/delacour/08_marcar_vertice_como_hombre.sql` | Marca como de hombre **exactamente las 76** piezas de la carga (DL-000769 a DL-000844, material «Acero», nombre «Santo · ref»). Una sola sentencia atómica con guardas: se niega si falta la migración, si no hay UNA sola tienda `delacour`, o si las piezas que cumplen el patrón no son 76 (dice cuántas hay y no marca nada). Solo toca `genero`. Se puede repetir. |

**Reversas:** `supabase/provisioning/delacour/08_marcar_vertice_como_hombre.reversa.sql` (las 76 vuelven a mujer) y `supabase/rollbacks/20261215000000_dulabs_catalogo_genero.down.sql` (quita la
columna; **se niega** si todavía hay piezas de hombre, para no perder la clasificación).

**Orden respecto al despliegue del código: indiferente.** El código lee el «para quién» aparte y tolera que la columna no exista:

| Situación | Qué se ve |
|---|---|
| Código desplegado, migración sin correr | La tienda es la de siempre; el panel no muestra «Para». |
| Migración corrida, sin el SQL 08 (ninguna pieza de hombre) | Igual: la tienda es la de siempre (hace falta al menos una pieza de hombre activa); el panel ya muestra «Para». |
| Migración + 08 + código | Aparece el lado de hombre con las 76 piezas. |

**Antes de correr el 08:** se probó contra un Postgres embebido (PGlite) con el SQL real: marca solo las 76, no toca precios, stock, nombres ni estado, deja un evento de auditoría por pieza
(`genero: mujer → hombre`, sin actor porque viene del SQL Editor: la auditoría del Catálogo limpia `updated_by` cuando una escritura no viene del panel), no toca a otros negocios y no deja nada a
medias si una guarda falla.

## 5. Panel (Tienda → Catálogo)

- **Lista:** filtro **«Para: todos / Mujer / Hombre»** y un selector por fila para cambiarlo ahí mismo (quien solo puede leer ve la etiqueta). Con un filtro «Para» puesto, al pasar una pieza al otro lado
  sale de esa lista. Un aviso confirma (««Dije» quedó para Hombre.»). Solo se manda `gender`: no se toca nada más de la pieza.
- **Formulario del producto:** «Para» (Mujer \| Hombre) con el aviso de en qué lado de la tienda aparecerá. **Nuevo producto** arranca en Mujer y conserva el lado al cargar varias piezas seguidas.
- Todo esto aparece **solo** en negocios cuya tienda separa (hoy Delacour) y con la migración aplicada; los demás negocios ven el panel exactamente como siempre. El servidor también lo exige (no solo
  la pantalla): marcar el lado en un negocio sin separación se rechaza con un aviso claro antes de tocar nada.
- **Interruptor «Mujer | Hombre»** (Tienda → **Página principal** y **Fotos y videos**; solo en tiendas con lado de hombre): con «Hombre» la clienta edita LO MISMO que en mujer —videos de portada, colección y marca (con las mismas reglas y la misma guía: MP4 H.264, hasta 3 MB, 4–15 s, sin sonido), la imagen de cada categoría, las categorías y los productos destacados— y lo guarda y publica con el mismo botón «Publicar» (un borrador, un publicar). Lo de hombre se guarda dentro del mismo contenido, bajo la clave `hombre`: **no hay migración nueva**. No hay un video «de siempre» de hombre al que volver: un espacio sin video no se muestra («Quitar el video»). Los mayoristas, el pie, las páginas y las preguntas frecuentes son de toda la tienda.
- **Carga masiva (Excel):** todavía **no tiene columna «Para»**: las piezas que se importen nacen de mujer y hay que pasarlas a Hombre desde la lista (o con un SQL como el 08). Está en §7.

## 6. Lo que NO cambia

Precios, carrito, pedidos, stock, mayoristas y el agente de WhatsApp. La **referencia `DL-…` sigue sobre cada foto** (tarjetas del listado, de la franja «Para él» y galería de la ficha: el módulo
`marca_referencia`) y debajo del nombre, para que el cliente o el bot puedan identificar la pieza; las pruebas lo comprueban en cada sitio donde se dibuja una pieza de hombre. Las fotos de la franja
«Para él» se cargan al acercarse (no le quitan prioridad de carga a la portada).

## 7. Decisiones y pendientes

- **Nombre de la colección: «Vértice»** (decidido por el dueño; si cambia, un solo lugar: `lib/catalogo/vitrina.ts` → `delacour.joyeria.genero.hombre`).
- **Stock 15 por pieza** en las 76 (provisional; la clienta lo ajusta).
- **Videos de hombre:** el sistema no trae ninguno incrustado (no se pueden inventar): se suben desde Tienda → Fotos y videos → Hombre. El 13-nov-2026 se publicaron 5 videos de PRUEBA hechos con las fotos de Vértice (portada y colección en horizontal y vertical, y marca) para que el lado de hombre no se viera vacío; la clienta los reemplaza cuando tenga los suyos, y si quita uno, ese bloque deja de dibujarse. Ojo si se hacen otros: las fotos de Vértice traen etiquetas de medida incrustadas («2.0 cm», «4 cm») y un video con ellas lleva texto dentro (el panel pide videos sin texto); hay que usar solo las fotos limpias o recortarlas.
- Pendientes, a decidir con la clienta: la **segunda marca «Orus»** («Delacour & Orus», relanzamiento: el código hoy tiene un solo nombre de colección para el lado de hombre); las **sublíneas de hombre**
  que saldrían de Plata y Acero; una columna **«Para» en la Carga masiva**; que el **agente de WhatsApp** distinga hombre y mujer al recomendar; y que el menú lateral, en el lado de hombre, ofrezca solo las
  categorías que tengan piezas de hombre (hoy ofrece todas).

## 8. Pruebas

| Archivo | Qué cubre | Pruebas |
|---|---|---|
| `lib/catalogo/genero.test.ts` | El «para quién», la dirección `?genero=`, cuándo se pinta el tema, el filtro y los esquemas | 17 |
| `lib/catalogo/genero-servicio.test.ts` | El servicio (panel y tienda) con la migración aplicada y sin aplicar; el mismo resultado que sin separación | 26 |
| `lib/catalogo/genero-sql.pglite.test.ts` | La migración y la lectura/escritura contra el SQL real (PGlite) | 11 |
| `lib/catalogo/genero-provisioning.pglite.test.ts` | Los SQL 08 y su reversa contra el SQL real, con sus guardas | 20 |
| `lib/catalogo/genero-css.test.ts` | Paleta de la clienta, contrastes, variables completas, «solo colores», señal y clases | 24 |
| `components/catalogo-publico/tienda/joyeria/genero.ssr.test.tsx` | HTML del servidor: selector, portada, migas, ficha, franja «Para él» y la referencia `DL-` sobre cada foto | 26 |
| `components/catalogo-publico/tienda/joyeria/genero.dom.test.tsx` | Lo que hace el cliente: señal del tema, selector de la cabecera y del menú, filtros que conservan el lado | 19 |
| `components/catalogo-publico/tienda/joyeria/inicio-hombre.ssr.test.tsx` | El inicio de hombre en el HTML del servidor: portada, categorías, destacados con `DL-`, videos opcionales y nada del inicio de mujer | 14 |
| `lib/cms-comercial/hombre-contenido.test.ts` | El contenido de hombre en el CMS: esquemas, validación, archivos que puede servir la ruta pública y lo que se dibuja de lo publicado | 17 |
| `components/dashboard/tienda/hombre.dom.test.tsx` | El panel de punta a punta: interruptor, subir un video de hombre, categorías, publicar y que la tienda lo lea por su lado | 11 |
| `components/dashboard/catalogo/genero-panel.dom.test.tsx` | El panel: formulario, lista y la página real con las rutas reales y una base en memoria | 30 |

```bash
node node_modules/tsx/dist/cli.mjs --test lib/catalogo/genero.test.ts lib/catalogo/genero-servicio.test.ts lib/catalogo/genero-sql.pglite.test.ts lib/catalogo/genero-provisioning.pglite.test.ts lib/catalogo/genero-css.test.ts
node node_modules/tsx/dist/cli.mjs --test components/catalogo-publico/tienda/joyeria/genero.ssr.test.tsx components/catalogo-publico/tienda/joyeria/genero.dom.test.tsx components/dashboard/catalogo/genero-panel.dom.test.tsx
```

Todas están en `scripts/test-flow-manifest.txt`.

## 9. Apagarlo

- Devolver las 76 a mujer: `08_marcar_vertice_como_hombre.reversa.sql`. Sin piezas de hombre activas la tienda vuelve a ser la de siempre, sin tocar código.
- Apagarlo para siempre en el código: quitar `genero` de `delacour.joyeria` en `lib/catalogo/vitrina.ts`.
- Quitar la columna: `supabase/rollbacks/20261215000000_dulabs_catalogo_genero.down.sql` (después de devolver las piezas a mujer).
