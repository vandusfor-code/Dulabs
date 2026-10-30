"""Clasificar piezas en las líneas de la joyería desde el panel — pruebas de mutación. Se quita o se invierte UNA protección a la vez; alguna prueba DEBE fallar; luego se restaura el archivo.
Si una mutación NO se detecta, la protección se podía eliminar sin que nadie se enterara: las pruebas son insuficientes y hay que reforzarlas.

Uso (desde la raíz del repo; sin red ni base de datos: todo corre con repositorio en memoria, rutas reales y jsdom):
    python3 scripts/mutacion/lineas-clasificar.py               # todas
    python3 scripts/mutacion/lineas-clasificar.py --verificar   # solo comprueba que cada patrón aplica exactamente una vez
    python3 scripts/mutacion/lineas-clasificar.py C01 S05       # solo esas
    (en Windows: PYTHONIOENCODING=utf-8 py -3 -X utf8 scripts/mutacion/lineas-clasificar.py)

Cubre: el texto que queda en «Material» al elegir una línea (sin perder lo escrito, cambiando solo la palabra de la línea anterior, cabiendo en el campo, sin cortar palabras), el listado del panel por
línea o «sin línea» en el servidor (líneas del negocio, tope, página, total), la consulta y el cliente, y las pantallas: el selector del producto, la línea de cada fila con su selector, el filtro y
el guardado desde la lista."""
import atexit
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

LIN = "lib/catalogo/lineas.ts"
DOM = "lib/catalogo/domain.ts"
SER = "lib/catalogo/service.ts"
CLI = "lib/catalogo-client.ts"
D = "components/dashboard/catalogo/"
FLD, LST, HOK = D + "ProductFields.tsx", D + "ProductList.tsx", D + "use-lineas.ts"
PAG, IDP, NUE = "app/dashboard/catalogo/page.tsx", "app/dashboard/catalogo/[id]/page.tsx", "app/dashboard/catalogo/nuevo/page.tsx"

T_PURO = ["lib/catalogo/lineas-clasificar.test.ts"]
T_SRV = ["lib/catalogo/lineas-panel.test.ts"]
T_DOM = [D + "lineas-panel.dom.test.tsx"]

# (id, descripción, archivo, texto a buscar (exactamente UNA vez), reemplazo, pruebas que deben detectarlo)
M = [
    # --- el texto que queda en «Material»
    ("C01", "una pieza que ya está en la línea se reescribe (cambia mayúsculas o espacios)", LIN, r"  if (actuales.some((l) => l.clave === clave)) return original;", "", T_PURO),
    ("C02", "sin material no queda el nombre de la línea", LIN, r'  if (texto === "") return nombre;', r'  if (texto === "") return original;', T_PURO),
    ("C03", "con un material de ninguna línea se PIERDE lo que la persona escribió", LIN, r'    nuevo = resto === "" ? nombre : `${nombre} · ${resto}`;', "    nuevo = nombre;", T_PURO),
    ("C04", "con el material de otra línea no se cambia solo esa palabra (se pierde el resto)", LIN, r'    nuevo = cambiarLinea(texto, actuales[0], nombre).replace(/\s+/g, " ").trim();', "    nuevo = nombre;", T_PURO),
    ("C05", "con varias líneas se deja todo el material y la pieza queda en más líneas", LIN, "    nuevo = nombre;\n  }\n  const sirve", "    nuevo = `${nombre} · ${texto}`;\n  }\n  const sirve", T_PURO),
    ("C06", "una clave que no es de la configuración cambia el material", LIN, r"  if (!elegida) return original;", "", T_PURO),
    ("C07", "no se vigila que el material quepa en 80 letras", LIN, "nuevo.length <= LARGO_MAX_MATERIAL && coincideLinea(nuevo, elegida)", "coincideLinea(nuevo, elegida)", T_PURO),
    ("C10", "al cambiar de línea solo se reemplaza la primera aparición", LIN, "  for (let i = 0; i < palabras.length; ) {", '  for (let i = 0; i < palabras.length && salida === ""; ) {', T_PURO),
    ("C11", "al cambiar de línea solo se reconoce el primer alias", LIN, "    for (const forma of formas) if (forma.length > largo && enPosicion(palabras, i, forma)) largo = forma.length;", "    for (const forma of formas.slice(0, 1)) if (forma.length > largo && enPosicion(palabras, i, forma)) largo = forma.length;", T_PURO),
    ("C12", "al recortar se deja un pedazo de palabra (que puede leerse como otra línea)", LIN, r'  if (/[\p{L}\p{M}\p{N}]/u.test(texto[max] ?? "") && /[\p{L}\p{M}\p{N}]$/u.test(corte)) corte = corte.replace(/[\p{L}\p{M}\p{N}]+$/u, "");', "", T_PURO),
    ("C13", "el recorte no descuenta el nombre de la línea ni el separador (se pasa de 80)", LIN, "LARGO_MAX_MATERIAL - nombre.length - 3", "LARGO_MAX_MATERIAL", T_PURO),
    ("C16", "una tilde suelta corta la palabra (las palabras ya no coinciden con las de la tienda)", LIN, r'  if (sinTilde === "") return null;', r'  if (sinTilde === "") return "";', T_PURO),
    ("C18", "los nombres de las líneas salen al revés (no respetan el orden de la configuración)", LIN, ".filter((l) => pertenece(palabras, formasDe(l))).map((l) => l.etiqueta);", ".filter((l) => pertenece(palabras, formasDe(l))).map((l) => l.etiqueta).reverse();", T_PURO),
    ("C19", "el tope de «Material» se separa del dominio (80)", LIN, "export const LARGO_MAX_MATERIAL = 80;", "export const LARGO_MAX_MATERIAL = 100;", T_PURO),
    ("C20", "la clave del filtro «sin línea» cambia en un lado y no en el otro", LIN, 'export const LINEA_SIN = "sin";', 'export const LINEA_SIN = "ninguna";', T_PURO + T_SRV + T_DOM),
    # --- el listado del panel en el servidor
    ("D01", "la consulta acepta una línea con mayúsculas", DOM, r"/^(?:sin|[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(v)", r"/^(?:sin|[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*)$/.test(v)", T_SRV),
    ("D02", "una línea vacía (o solo espacios) da error en vez de «todas»", DOM, 'v === "" || /^(?:sin|', "/^(?:sin|", T_SRV),
    ("D03", "una línea de más de 30 letras se acepta", DOM, "    .max(30)\n    .refine((v) => v ===", "    .refine((v) => v ===", T_SRV),
    ("S01", "el servidor ignora el filtro por línea", SER, "      if (query.linea) {", "      if (false && query.linea) {", T_SRV + T_DOM),
    ("S03", "una línea que el negocio no tiene vacía el listado en vez de ignorarse", SER, "lineas.some((l) => l.clave === query.linea)", "true", T_SRV),
    ("S04", "«sin línea» trae las piezas que SÍ tienen línea", SER, "return elegida === LINEA_SIN ? claves.length === 0 : claves.includes(elegida);", "return elegida === LINEA_SIN ? claves.length > 0 : claves.includes(elegida);", T_SRV + T_DOM),
    ("S05", "una pieza en dos líneas solo aparece en la primera", SER, ": claves.includes(elegida);", ": claves[0] === elegida;", T_SRV),
    ("S06", "se lee solo el primer lote (un catálogo grande queda cortado)", SER, "      if (lote.items.length === 0 || leidos >= lote.total) break;", "      break;", T_SRV),
    ("S07", "no hay tope: se lee sin fin", SER, "      if (leidos >= LINEA_FILTRO_MAX) throw new CatalogError(", "      if (false) throw new CatalogError(", T_SRV),
    ("S08", "el total es el de la página y no el de la línea", SER, "withPrimary(p, byProduct.get(p.id))), total: coinciden.length,", "withPrimary(p, byProduct.get(p.id))), total: pagina.length,", T_SRV + T_DOM),
    ("S09", "la página siempre sale del principio", SER, "const desde = (query.page - 1) * query.pageSize;", "const desde = 0;", T_SRV),
    ("S10", "el listado por línea ignora el estado, la categoría y la búsqueda", SER, "const filtro = { search: normalizeSearch(query.q), categoryId: query.categoryId, status: query.status };", 'const filtro = { search: undefined, categoryId: undefined, status: "ALL" as const };', T_SRV),
    ("S12", "las líneas de todos los negocios son las de Delacour", SER, "return publicacion ? lineasDeLaTienda(publicacion.slug) : [];", 'return lineasDeLaTienda("delacour");', T_SRV),
    ("S13", "un negocio sin líneas recorre todo su catálogo para filtrar (aunque no filtre nada)", SER, "lineas.length > 0 && (query.linea === LINEA_SIN", "(query.linea === LINEA_SIN", T_SRV),
    ("K01", "el cliente del navegador no manda la línea", CLI, '      if (params.linea) qs.set("linea", params.linea);', "", T_DOM),
    # --- el formulario del producto
    ("F01", "elegir una línea no escribe el material", FLD, "onClick={() => onChange(materialConLinea(material, l.clave, lineas))}", "onClick={() => onChange(material)}", T_DOM),
    ("F02", "ninguna línea aparece marcada", FLD, "          const activa = claves.includes(l.clave);", "          const activa = false;", T_DOM),
    ("F04", "un negocio con lista de líneas vacía igual ve el selector", FLD, "{lineas && lineas.length > 0 && <LineaDeLaTienda", "{lineas && <LineaDeLaTienda", T_DOM),
    ("F05", "con el formulario deshabilitado (solo lectura) se puede cambiar la línea", FLD, 'onChange={(material) => set("material", material)} disabled={disabled} />}', 'onChange={(material) => set("material", material)} disabled={false} />}', T_DOM),
    # --- la lista del catálogo
    ("L01", "con una lista de líneas vacía la lista igual cambia", LST, "const clasifica = clasificacion && clasificacion.lineas.length > 0 ? clasificacion : null;", "const clasifica = clasificacion ?? null;", T_DOM),
    ("L02", "el enlace ya no cubre toda la fila", LST, 'className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime/50"', 'className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime/50"', T_DOM),
    ("L03", "el selector queda por debajo del enlace que cubre la fila (no se puede usar)", LST, '"relative z-10 max-w-full rounded-md border', '"relative max-w-full rounded-md border', T_DOM),
    ("L04", "una pieza ya clasificada ofrece «sin línea»", LST, '{valor === "" && <option value="">', '{<option value="">', T_DOM),
    ("L05", "quien solo lee ve el selector", LST, "if (!puedeAsignar || claves.length > 1) {", "if (claves.length > 1) {", T_DOM),
    ("L06", "una pieza en dos líneas muestra un selector (que no puede representarla)", LST, "if (!puedeAsignar || claves.length > 1) {", "if (!puedeAsignar) {", T_DOM),
    ("L07", "mientras se guarda el selector sigue habilitado (doble guardado)", LST, "disabled={guardando !== undefined}", "disabled={false}", T_DOM),
    ("L08", "mientras se guarda el selector vuelve a la línea de antes", LST, 'const valor = guardando ?? claves[0] ?? "";', 'const valor = claves[0] ?? "";', T_DOM),
    ("L10", "toda fila se arma como fila clasificable (también en negocios sin líneas)", LST, "clasifica ? (", "true ? (", T_DOM),
    # --- la página del catálogo
    ("P01", "el filtro de línea no viaja al listado", PAG, "linea: linea || undefined, page, pageSize: PAGE_SIZE", "page, pageSize: PAGE_SIZE", T_DOM),
    ("P03", "una línea elegida no cuenta como filtro (no aparece «Limpiar filtros»)", PAG, 'status !== "ALL" || linea);', 'status !== "ALL");', T_DOM),
    ("P04", "«Limpiar filtros» no quita la línea", PAG, '    setLinea("");', "", T_DOM),
    ("P05", "con un filtro de línea puesto, clasificar no vuelve a pedir la página (la pieza sigue en la lista)", PAG, "if (lineaDelFiltro.current) setRecarga((n) => n + 1);", "if (false) setRecarga((n) => n + 1);", T_DOM),
    ("P06", "sin filtro, clasificar vuelve a pedir toda la lista", PAG, "if (lineaDelFiltro.current) setRecarga((n) => n + 1);", "setRecarga((n) => n + 1);", T_DOM),
    ("P07", "al guardar la línea se manda más que el material", PAG, '{ material: material === "" ? null : material }', '{ material: material === "" ? null : material, name: producto.name }', T_DOM),
    ("P09", "si no se puede guardar no se avisa el motivo", PAG, '      toast(r.error.message, "error");', "", T_DOM),
    ("P10", "si no se puede guardar el selector se queda bloqueado", PAG, "      resto.delete(producto.id);", "", T_DOM),
    ("P11", "al vaciar «sin línea» no avisa que no queda nada", PAG, '{linea === LINEA_SIN && !q && !categoryId && status === "ALL" ? (', "{false ? (", T_DOM),
    ("P12", "quien solo lee puede cambiar la línea desde la lista", PAG, "puedeAsignar: canWrite", "puedeAsignar: true", T_DOM),
    ("P14", "un negocio sin líneas ve el filtro de línea", PAG, "{lineas.length > 0 && (", "{true && (", T_DOM),
    ("H03", "las líneas se leen de otra tienda (no de la del negocio)", HOK, "lineasDeLaTienda(r.data.publication.slug)", 'lineasDeLaTienda("delacour")', T_DOM),
    ("W01", "editar un producto no recibe las líneas del negocio", IDP, "              lineas={lineas}", "", T_DOM),
    ("W02", "crear un producto no recibe las líneas del negocio", NUE, "              lineas={lineas}", "", T_DOM),
]


def leer(ruta):
    with open(ruta, "rb") as f:
        return f.read().decode("utf-8")


def escribir(ruta, texto):
    with open(ruta, "wb") as f:
        f.write(texto.encode("utf-8"))


originales = {}


def restaurar_todo():
    for ruta, texto in originales.items():
        escribir(ruta, texto)


atexit.register(restaurar_todo)


def aplicar_patron(texto, buscar):
    """Los archivos del repo pueden tener CRLF en el árbol de trabajo: se busca con el fin de línea del archivo."""
    if "\r\n" in texto and "\n" in buscar and "\r\n" not in buscar:
        return buscar.replace("\n", "\r\n")
    return buscar


def main(argv):
    solo_verificar = "--verificar" in argv
    elegidas = {a for a in argv if not a.startswith("--")}
    lista = [m for m in M if not elegidas or m[0] in elegidas]
    malos = 0
    for id_, _desc, ruta, buscar, _reemplazo, _pruebas in lista:
        texto = leer(ruta)
        n = texto.count(aplicar_patron(texto, buscar))
        if n != 1:
            print(f"{id_}: NO APLICA (el patrón aparece {n} veces en {ruta})")
            malos += 1
    if solo_verificar or malos:
        print(f"{len(lista) - malos}/{len(lista)} patrones aplican exactamente una vez")
        sys.exit(1 if malos else 0)

    fallos = 0
    for id_, desc, ruta, buscar, reemplazo, pruebas in lista:
        texto = leer(ruta)
        originales[ruta] = texto
        patron = aplicar_patron(texto, buscar)
        nuevo = texto.replace(patron, reemplazo.replace("\n", "\r\n") if "\r\n" in texto else reemplazo, 1)
        escribir(ruta, nuevo)
        try:
            r = subprocess.run(["npx", "tsx", "--test", *pruebas], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900, shell=(os.name == "nt"))
            fallaron = [linea for linea in r.stdout.splitlines() if linea.startswith("ℹ fail")]
            detectada = r.returncode != 0
            print(f"{id_} {desc}: {'DETECTADA' if detectada else 'NO DETECTADA'} ({fallaron[0] if fallaron else '?'})", flush=True)
            if not detectada:
                fallos += 1
        finally:
            escribir(ruta, texto)
            originales.pop(ruta, None)
    print(f"\n{len(lista) - fallos}/{len(lista)} mutaciones detectadas")
    sys.exit(1 if fallos else 0)


if __name__ == "__main__":
    main(sys.argv[1:])
