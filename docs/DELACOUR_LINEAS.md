# Delacour & Orus — líneas de la tienda (Plata · Rodio · Acero · Cover Gold)

Pedido de la clienta (2026-10-30): «que se creen las líneas plata, acero, rodio y cover gold y en cada una podamos encontrar las mismas categorías» (anillos, cadenas, aretes…). Quedaron **construidas
y funcionando**: las cuatro líneas existen en la tienda desde ya, con las MISMAS categorías de la tienda dentro de cada una. Código: `lib/catalogo/lineas.ts` · configuración: `lib/catalogo/vitrina.ts`
(`delacour.joyeria.lineas`) · pruebas: ver §7. **No hay migración ni SQL**, no se toca ningún dato y no cambia ningún precio, inventario, carrito ni pedido.

## 1. Cómo se ve

| Dónde | Qué hay |
|---|---|
| **Cabecera** (escritorio, desde 1280 px) | «Inicio · Catálogo · **Líneas** · Categorías · …». «Líneas» baja a la franja del inicio. |
| **Menú lateral** (celular y escritorio) | Acordeón **«Líneas»** → una fila por línea (Plata, Rodio, Acero, Cover Gold) → al abrir una: «Toda la línea» y las mismas categorías de la tienda. Una sola línea abierta a la vez. |
| **Inicio** | Franja **«Nuestras líneas»** justo después del video de la colección: cuatro opciones (2×2 en el celular, 4 en fila desde la tableta). |
| **Página de una línea** (`?linea=plata`) | Título y migas con la línea (`Inicio / Catálogo / Plata`), una fila de categorías para moverse dentro de ella (en el celular se desliza; desde la tableta, todas a la vista) con cuántas piezas tiene cada una **en esa línea**, y los productos. |
| **Panel de filtros** | Grupo **«Línea»** arriba de «Categoría del producto». Con una línea elegida, el conteo de las categorías es el de esa línea. |

Las direcciones se pueden compartir y funcionan sin JavaScript: `…/catalogo/delacour?linea=plata`, `…?linea=plata&categoria=<id>`, `…?linea=rodio&linea=acero` (varias líneas: las piezas de cualquiera
de ellas). Una línea que la tienda no tiene (`?linea=oro`) se ignora: nunca deja la lista vacía ni da error.

**Las líneas sin piezas existen igual** (hoy Plata, Acero y Cover Gold): se ven en el menú, el inicio y los filtros, con todas sus categorías, y su página muestra el aviso de siempre de la tienda
(«No encontramos productos con esos filtros»). No hay carteles de «próximamente» ni conteos en cero. Se llenan solas en cuanto haya piezas.

## 2. A qué línea pertenece una pieza

Por el campo **Material** que ya tiene cada producto en el panel (nada nuevo que llenar). Se reconoce por **palabras completas**, sin mayúsculas, tildes ni signos:

| Material escrito | Línea |
|---|---|
| `Rodio`, `RODIO`, `Rodio · 3cm`, `Rodio · 2.5cm`, `Rodio platinado` | Rodio |
| `Plata`, `Plata 925`, `plata ley 925` | Plata |
| `Acero`, `Acero inoxidable`, `Acero quirúrgico` | Acero |
| `Cover Gold`, `COVERGOLD`, `Cover-Gold`, `Cover gold 18k` | Cover Gold |
| `Acero y Rodio` | **las dos** (Acero y Rodio) |
| `Plateado`, `Platería`, `Platino`, `Rodiado`, `Gold` | **ninguna** (otra palabra: «Plateado» es un color) |
| (vacío) | ninguna: la pieza sigue en todo el catálogo y en su categoría, pero no está en una línea |

**Lo que tiene que hacer el negocio:** en cada producto nuevo escribir el material como arriba (`Plata`, `Rodio`, `Acero`, `Cover Gold`; se puede agregar la ley, la medida o el acabado después). Por
la Carga masiva (Excel) es la columna **Material**. Estado el 2026-10-30 (tienda pública): ~700 piezas activas, ~600 con material «Rodio…» (ya están en su línea), ninguna de las otras tres líneas y
~90 sin material (no están en ninguna línea hasta que se les escriba uno).

## 3. Cómo está hecho (para quien mantenga el código)

- **Puro**: `lib/catalogo/lineas.ts` (a qué líneas pertenece un material, conteos por línea y por categoría), `lib/catalogo/consulta-publica.ts` (la consulta de la tienda al servicio, con las líneas del
  negocio) y `lib/catalogo/joyeria.ts` (`lineasVisibles`, `lineasDeLaTienda`, `hrefLineas`).
- **Filtros** (`lib/catalogo/filtros.ts`): `FiltrosCatalogo.lineas` es opcional; sin línea los filtros, las direcciones y las facetas tienen EXACTAMENTE la forma de siempre. `calcularFacetas` trae `lineas`
  (conteo de cada línea, también las vacías) y cuenta las categorías dentro de la línea elegida.
- **Servicio** (`lib/catalogo/service.ts`): `getCatalog` recibe las líneas del negocio; sin ellas (otros negocios) una `?linea=` se ignora y el listado es el de siempre. Solo lectura.
- **Menú e inicio no leen productos**: se arman con la configuración y las categorías que cada pantalla ya cargaba, así la estructura nunca depende de contar piezas ni agrega consultas. Los conteos solo
  salen en la página de listado (que ya leía los productos activos para los filtros).
- **Pantalla**: `CromoJoyeria` (cabecera y menú), `BloquesJoyeria.FranjaLineas` + `TiendaInicioJoyeria` (inicio), `ListadoJoyeria` (página de una línea), `FiltrosJoyeria` (grupo «Línea»). Clases de CSS
  propias (`joy-franja-*`): **no reutilizar `joy-linea`**, que es el filete dorado de la portada (una clase compartida por error dejó cada línea de 4 rem de ancho; hay una guarda en las pruebas).
- **Configuración**: `lib/catalogo/vitrina.ts` → `delacour.joyeria.lineas` = `{ titulo: "Nuestras líneas", lineas: [{ clave, etiqueta, alias? }] }` en el orden que pidió la clienta. Para **agregar o renombrar
  una línea** se edita ahí (clave en minúsculas, números y guiones; `alias` solo si se escribe de otras formas, como `["cover gold", "covergold"]`) y se despliega. Otros negocios no tienen `lineas`: su
  tienda no cambia.

## 4. Lo que NO cambia

Precios, stock, carrito, pedidos, el CMS comercial, la tienda mayorista y los demás negocios. El filtro **Material** del panel sigue como estaba (con sus variantes «Rodio · 3cm»…) y `?material=` sigue
funcionando; las líneas lo complementan, no lo reemplazan.

## 5. Límites y decisiones

- **No hay editor en el panel**: las líneas son configuración de la tienda (código), como el resto del contenido editorial de Delacour (anuncios, videos, textos del inicio). Cambiarlas es un cambio
  pequeño y no necesita migración.
- Una **pieza sin material** no está en ninguna línea. Un material con una palabra distinta («Rodiado») tampoco; si la clienta lo usa, se agrega como `alias` de la línea.
- Como los demás filtros, las líneas se calculan en memoria sobre los productos activos y solo para catálogos de hasta **2.000** piezas activas (`FILTRO_MAX`); por encima de ese tope la tienda deja de
  ofrecer filtros (también el de línea) y muestra el listado de siempre. Delacour tiene ~700.
- Con búsqueda por texto (`?q=`) los filtros no aplican, como siempre.

## 6. Verificación en vivo (después de desplegar)

Abrir `https://www.dulabs.co/catalogo/delacour`: «Líneas» en la cabecera y en el menú, la franja «Nuestras líneas» en el inicio, `?linea=rodio` con ~600 piezas, `?linea=plata` vacía sin errores,
`?linea=rodio&categoria=<id>` con la categoría marcada y el grupo «Línea» en el panel de filtros.

## 7. Pruebas

`lib/catalogo/lineas.test.ts` (a qué línea pertenece un material y conteos), `lib/catalogo/filtros-lineas.test.ts` (dirección, filtrado y facetas), `lib/catalogo/lineas-servicio.test.ts` (servicio real
con repositorio en memoria), `lib/catalogo/consulta-publica.test.ts` (la consulta de la tienda, el cableado de la página y el marco, y guardas del CSS), y en
`components/catalogo-publico/tienda/joyeria/`: `lineas.ssr.test.tsx` (franja del inicio, página de una línea y panel, en el HTML del servidor), `lineas.dom.test.tsx` (cabecera y menú lateral) y
`lineas-filtros.dom.test.tsx` (marcar y desmarcar líneas en el panel). Sabotajes: `scripts/mutacion/lineas.py` (50 mutaciones).
