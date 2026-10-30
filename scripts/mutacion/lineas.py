"""Líneas de la joyería (Plata, Rodio, Acero, Cover Gold) — pruebas de mutación. Se quita o se invierte UNA protección a la vez; alguna prueba DEBE fallar; luego se restaura el archivo.
Si una mutación NO se detecta, la protección se podía eliminar sin que nadie se enterara: las pruebas son insuficientes y hay que reforzarlas.

Uso (desde la raíz del repo; sin red ni base de datos: todo corre con repositorio en memoria y jsdom):
    python3 scripts/mutacion/lineas.py               # todas
    python3 scripts/mutacion/lineas.py --verificar   # solo comprueba que cada patrón aplica exactamente una vez
    python3 scripts/mutacion/lineas.py L01 F06       # solo esas
    (en Windows: PYTHONIOENCODING=utf-8 py -3 -X utf8 scripts/mutacion/lineas.py)

Cubre: a qué línea pertenece un material (palabras completas, alias, varias líneas), el conteo por línea y por categoría, la dirección (`?linea=`), el filtrado, las facetas, el servicio (líneas
desconocidas, líneas del negocio), el cableado (consulta, página y marco), y la pantalla (franja del inicio, menú, página de una línea, panel de filtros) con sus guardas de CSS."""
import atexit
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

LIN = "lib/catalogo/lineas.ts"
FIL = "lib/catalogo/filtros.ts"
INI = "lib/catalogo/inicio.ts"
SER = "lib/catalogo/service.ts"
CON = "lib/catalogo/consulta-publica.ts"
JOY = "lib/catalogo/joyeria.ts"
J = "components/catalogo-publico/tienda/joyeria/"
CRO, LST, FIU, BLO, INU = J + "CromoJoyeria.tsx", J + "ListadoJoyeria.tsx", J + "FiltrosJoyeria.tsx", J + "BloquesJoyeria.tsx", J + "TiendaInicioJoyeria.tsx"
PAG, LAY, CSS = "app/catalogo/[slug]/(tienda)/page.tsx", "app/catalogo/[slug]/(tienda)/layout.tsx", "app/globals.css"

T_LIN = ["lib/catalogo/lineas.test.ts"]
T_FIL = ["lib/catalogo/filtros-lineas.test.ts"]
T_SER = ["lib/catalogo/lineas-servicio.test.ts"]
T_CON = ["lib/catalogo/consulta-publica.test.ts"]
T_SSR = [J + "lineas.ssr.test.tsx"]
T_DOM = [J + "lineas.dom.test.tsx"]
T_FDOM = [J + "lineas-filtros.dom.test.tsx"]

# (id, descripción, archivo, texto a buscar (exactamente UNA vez), reemplazo, pruebas que deben detectarlo)
M = [
    # --- a qué línea pertenece un material
    ("L01", "se reconoce por pedazos de palabra («Plateado» sería Plata)", LIN, "frase.every((p, j) => palabras[i + j] === p)", "frase.every((p, j) => palabras[i + j].startsWith(p))", T_LIN),
    ("L02", "unos alias vacíos reconocen cualquier material", LIN, "return textos.map(palabrasDe).filter((p) => p.length > 0);", "return textos.map(palabrasDe);", T_LIN),
    ("L05", "las categorías de cada línea no se cuentan", LIN, "categorias?.set(fila.categoryId, (categorias.get(fila.categoryId) ?? 0) + 1);", "void categorias;", T_LIN + T_SER + T_FIL),
    ("L06", "las líneas sin piezas se omiten (la estructura dependería del catálogo)", LIN, "  return lineas.map((l) => ({", "  return lineas.filter((l) => (totales.get(l.clave) ?? 0) > 0).map((l) => ({", T_LIN + T_SER + T_FIL),
    ("L07", "una pieza en dos líneas solo cuenta en la primera", LIN, "for (const clave of claves) {", "for (const clave of claves.slice(0, 1)) {", T_LIN),
    ("L08", "las líneas salen al revés (no respetan el orden de la clienta)", LIN, "  return lineas.map((l) => ({", "  return [...lineas].reverse().map((l) => ({", T_LIN + T_SER + T_FIL),
    ("L09", "se dejan pasar las líneas que el negocio no tiene", LIN, "claves.filter((c) => conocidas.has(c))", "claves.filter((c) => conocidas.has(c) || true)", T_LIN + T_SER),
    ("L10", "una clave de línea puede llevar mayúsculas", LIN, "const CLAVE_LINEA = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;", "const CLAVE_LINEA = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;", T_LIN),
    # --- la dirección y el filtrado
    ("F01", "la línea no se lee de la dirección", FIL, "    ...(lineas.length > 0 ? { lineas } : {}),\n    categorias:", "    categorias:", T_FIL),
    ("F02", "la línea no viaja en la dirección", FIL, '    ...(f.lineas ?? []).map((l): [string, string] => ["linea", l]),\n', "", T_FIL + T_FDOM),
    ("F04", "una línea no cuenta como filtro", FIL, "f.materiales.length > 0 || (f.lineas?.length ?? 0) > 0 || f.precioMin !== undefined", "f.materiales.length > 0 || f.precioMin !== undefined", T_FIL + T_SER),
    ("F05", "con una línea, una categoría sigue siendo «solo una categoría»", FIL, "&& !f.lineas?.length && f.precioMin === undefined", "&& f.precioMin === undefined", T_FIL + T_SER),
    ("F06", "la pieza cumple aunque no sea de la línea", FIL, "    if (!f.lineas.some((l) => deLaFila.includes(l))) return false;\n", "", T_FIL + T_SER),
    ("F08", "las categorías del panel no se cuentan dentro de la línea elegida", FIL, "const dentro = lineas && lineasElegidas && lineasElegidas.length > 0 ? filas.filter((f) => lineasDeMaterial(f.material, lineas).some((l) => lineasElegidas.includes(l))) : filas;", "const dentro = filas;", T_FIL + T_SER),
    ("F09", "las facetas no traen las líneas", FIL, "    ...(lineas && lineas.length > 0 ? { lineas: calcularLineas(filas, lineas) } : {}),\n", "", T_FIL + T_SER + T_SSR),
    ("F11", "una clave de línea mal formada se acepta", FIL, ".filter(esClaveDeLinea)", ".filter(() => true)", T_FIL),
    ("I01", "una `?linea=` no hace que la dirección sea un listado", INI, '"todo", "linea", "color"', '"todo", "color"', T_FIL),
    # --- el servicio y el cableado
    ("S01", "el servicio no descarta las líneas que el negocio no tiene", SER, "const filtrosEntrada = input.filters ? conLineasConocidas(input.filters, lineasDelNegocio) : undefined;", "const filtrosEntrada = input.filters;", T_SER),
    ("S03", "las facetas no reciben las líneas del negocio", SER, "categories, lineasDelNegocio, filtrar?.lineas)", "categories)", T_SER + T_SSR),
    ("S04", "el listado filtrado no recibe las líneas del negocio", SER, "activos ?? null, evaluador, lineasDelNegocio))", "activos ?? null, evaluador))", T_SER),
    ("S05", "las categorías de las facetas no se condicionan a la línea elegida", SER, "categories, lineasDelNegocio, filtrar?.lineas)", "categories, lineasDelNegocio)", T_SER),
    ("Q01", "la consulta no entrega las líneas", CON, "    ...(lineas.length > 0 ? { lineas } : {}),\n", "", T_CON),
    ("Q02", "la consulta ignora las líneas de la tienda", CON, "const lineas = lineasDeLaTienda(a.slug);", "const lineas: ReturnType<typeof lineasDeLaTienda> = [];", T_CON),
    ("J05", "las líneas de la tienda no salen de su configuración", JOY, "return joyeriaOf(storefrontConfigFor(slug))?.lineas?.lineas ?? [];", "return [];", T_CON + T_SSR),
    ("G01", "la página no ve la línea al decidir si es un listado", PAG, "todo: param(sp.todo), linea: param(sp.linea), color:", "todo: param(sp.todo), color:", T_CON),
    ("G02", "la página no entrega las líneas al listado", PAG, "        lineas={lineasDelNegocio}\n", "", T_CON),
    ("G03", "el marco no entrega las líneas a la cabecera", LAY, " lineas={lineas} lineasHref={hrefLineas(basePath)} />", " />", T_CON),
    # --- lo que se ve: menú, cabecera, inicio, página de una línea y panel
    ("J01", "el menú de cada línea no trae todas las categorías", JOY, "categorias: categorias.map((c) => ({", "categorias: categorias.slice(0, 3).map((c) => ({", T_LIN + T_DOM + T_SSR),
    ("J02", "una línea no lleva a su listado", JOY, "href: urlFiltros(basePath, { ...SIN_FILTROS, lineas: [l.clave] }),", "href: basePath,", T_DOM + T_SSR),
    ("J04", "el acceso «Líneas» de la cabecera no lleva a la franja del inicio", JOY, "return `${basePath}#lineas`;", "return basePath;", T_DOM + T_CON),
    ("C01", "tocar una línea abierta no la cierra", CRO, "onClick={() => setLineaAbierta(abierta ? null : l.clave)}", "onClick={() => setLineaAbierta(l.clave)}", T_DOM),
    ("C02", "con líneas la cabecera no usa el ancho amplio", CRO, "const cab = paginas.length > 0 || lineas.length > 0 ? CABECERA.ancha : CABECERA.normal;", "const cab = paginas.length > 0 ? CABECERA.ancha : CABECERA.normal;", T_DOM),
    ("C03", "el acceso «Líneas» de la cabecera lleva al inicio sin la franja", CRO, "href={lineasHref ?? `${basePath}#lineas`}", "href={basePath}", T_DOM),
    ("C04", "«Toda la línea» lleva al inicio", CRO, '<Link href={l.href} onClick={cerrarMenu} className="joy-fila-menu joy-fila-sub">', '<Link href={basePath} onClick={cerrarMenu} className="joy-fila-menu joy-fila-sub">', T_DOM),
    ("C05", "todas las categorías de una línea llevan a la línea (sin la categoría)", CRO, "<Link key={c.id} href={c.href} onClick={cerrarMenu}", "<Link key={c.id} href={l.href} onClick={cerrarMenu}", T_DOM),
    ("B02", "la franja usa la clase ajena del filete dorado (salía diminuta)", BLO, 'className="joy-franja-linea font-serif-tienda"', 'className="joy-linea font-serif-tienda"', T_SSR),
    ("B03", "la franja omite una línea", BLO, "{lineas.map((l) => (", "{lineas.slice(0, 3).map((l) => (", T_SSR),
    ("T01", "la franja se dibuja aunque la configuración del negocio no tenga líneas", INU, "{joyeria.lineas && lineas.length > 0 && (", "{lineas.length > 0 && (", T_SSR),
    ("LI01", "la página de una línea no trae los chips de categorías", LST, "{lineaActual && data.categories.length > 0 && (", "{false && (", T_SSR),
    ("LI03", "al cambiar de categoría se pierden los demás filtros", LST, "urlFiltros(basePath, { ...filtros, categorias: [c.id] })", "urlFiltros(basePath, { ...SIN_FILTROS, lineas: filtros.lineas, categorias: [c.id] })", T_SSR),
    ("LI04", "las migas no nombran la línea", LST, "{hayFiltros && lineaActual && (", "{false && (", T_SSR),
    ("LI05", "el conteo de las categorías es el de toda la tienda, no el de la línea", LST, "const n = conteoLinea?.categorias.find((x) => x.id === c.id)?.n ?? 0;", "const n = facetas?.categorias.find((x) => x.id === c.id)?.n ?? 0;", T_SSR),
    ("LI06", "una sola línea elegida no es «la página de esa línea»", LST, "const claveLinea = conPanel && filtros.lineas?.length === 1 ? filtros.lineas[0] : undefined;", "const claveLinea = undefined as string | undefined;", T_SSR),
    ("LI07", "la página de una línea muestra siempre la primera línea", LST, "lineas.find((l) => l.clave === claveLinea)", "lineas[0]", T_SSR),
    ("FI01", "el panel no ofrece el grupo «Línea»", FIU, "{facetas.lineas && facetas.lineas.length > 0 && (", "{false && (", T_SSR + T_FDOM),
    ("FI02", "una línea sin piezas dice «(0)»", FIU, "n={l.n > 0 ? l.n : null}", "n={l.n}", T_SSR + T_FDOM),
    ("FI03", "marcar una línea escribe otro filtro en la dirección", FIU, 'alCambiar={() => alternar("lineas", l.clave)}', 'alCambiar={() => alternar("categorias", l.clave)}', T_FDOM),
    ("FI04", "la línea no cuenta en el botón «Filtrar» del celular", FIU, "(f.lineas?.length ?? 0) + f.categorias.length + f.colores.length", "f.categorias.length + f.colores.length", T_FDOM),
    ("CS01", "una línea de la franja fija un ancho (se encoge)", CSS, "  height: 5.25rem;\n  align-items: center;", "  height: 5.25rem;\n  width: 4rem;\n  align-items: center;", T_CON),
    ("CS02", "la franja tiene tres columnas desde la tableta", CSS, "    grid-template-columns: repeat(4, minmax(0, 1fr));", "    grid-template-columns: repeat(3, minmax(0, 1fr));", T_CON),
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
    elegidas = {a for a in argv if a[:1] in "LFISQJGCBTLFC" and a[1:2].isalnum() and not a.startswith("--")}
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
