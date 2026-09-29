"""Bloque 33 — pruebas de mutación: módulo Clientes (listado, ficha, nota, CSV, permisos). Se quita
UNA protección, alguna prueba DEBE fallar; luego se restaura el archivo.
Uso: python3 scripts/mutacion/b33.py (desde la raíz del repo; sin BD ni red). La función SQL tiene su
prueba en PostgreSQL real (supabase/tests/20261202000000_dulabs_catalogo_clientes.test.sql) y la matriz E2E."""
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SV = "lib/catalogo/clientes/servicio.ts"
MO = "lib/catalogo/clientes/modelo.ts"
RE = "lib/catalogo/clientes/repositorio.ts"
T = "lib/catalogo/clientes/clientes.test.ts"
M = [
    ("M1 nota para un contacto que no es cliente del negocio", SV,
     "  if (!(await buscar(repo, tenantId, k.phoneNumberId, k.waId))) return apiError(\"NOT_FOUND\", \"No encontramos ese cliente.\", 404);\n", ""),
    ("M2 ficha de un contacto ajeno", SV,
     "  if (!cliente) return apiError(\"NOT_FOUND\", \"No encontramos ese cliente.\", 404);\n", ""),
    ("M3 nota más larga que el tope", SV,
     "  if (texto.length > NOTA_MAX) return", "  if (false) return"),
    ("M4 dos ediciones a la vez: la vieja pisa", RE,
     "      if ((actual?.version ?? 0) !== version) return null;\n", ""),
    ("M5 una celda del CSV puede ser una fórmula de Excel", MO,
     "  if (typeof valor === \"string\" && /^[=+\\-@\\t\\r]/.test(s)) s = `'${s}`;\n", ""),
    ("M6 CSV sin BOM (tildes rotas en Excel)", MO,
     "  return `\\uFEFF${[cabecera", "  return `${[cabecera"),
    ("M7 teléfono como número en Excel", MO,
     "      telefonoCsv(c.waId),", "      c.waId,"),
    ("M8 la exportación ignora el filtro", SV,
     "  const { filas } = await repo.listar(tenantId, { q: c.q, filtro: c.filtro, limite: CLIENTES_EXPORTAR_MAX, offset: 0 });",
     "  const { filas } = await repo.listar(tenantId, { q: c.q, filtro: \"todos\", limite: CLIENTES_EXPORTAR_MAX, offset: 0 });"),
    ("M9 un filtro inválido llega a la BD", MO,
     "? (f as FiltroClientes) : \"todos\";", "? (f as FiltroClientes) : (f as FiltroClientes);"),
    ("M10 clave de URL sin validar", MO,
     "  const m = /^([A-Za-z0-9-]{1,64})_([0-9]{6,20})$/.exec(clave);", "  const m = /^(.+)_(.+)$/.exec(clave);"),
    ("M11 'mayorista nuevo' con compras", MO,
     "c.canal === \"wholesale\" && c.compras === 0;", "c.canal === \"wholesale\" && c.compras <= 1;"),
    ("M12 la lista la ve el rol lectura", "app/api/dashboard/clientes/route.ts",
     "withCatalog(request, \"orders\",", "withCatalog(request, \"read\","),
    ("M13 la ficha no exige el módulo Clientes", "app/api/dashboard/clientes/[cliente]/route.ts",
     "{ module: CLIENTS_MODULE, recurso: \"clientes_lectura\" }", "{ recurso: \"clientes_lectura\" }"),
    ("M14 sin el módulo, el mensaje es el del catálogo", "lib/catalogo/auth.ts",
     "          : input.module === CLIENTS_MODULE\n", "          : false\n"),
    ("M15 la paginación ignora la página pedida", SV,
     "offset: (c.pagina - 1) * CLIENTES_POR_PAGINA", "offset: 0"),
]
fallos = 0
for nombre, f, a, b in M:
    orig = open(f).read()
    if orig.count(a) != 1:
        print(f"{nombre}: NO APLICA (patrón {orig.count(a)} veces)")
        fallos += 1
        continue
    open(f, "w").write(orig.replace(a, b))
    try:
        r = subprocess.run(["npx", "tsx", "--test", T], capture_output=True, text=True, timeout=900)
        failed = [line for line in r.stdout.splitlines() if line.startswith("# fail")]
        det = r.returncode != 0
        print(f"{nombre}: {'DETECTADA' if det else 'NO DETECTADA'} ({failed[0] if failed else '?'})")
        if not det:
            fallos += 1
    finally:
        open(f, "w").write(orig)
print(f"\n{len(M) - fallos}/{len(M)} mutaciones detectadas")
sys.exit(1 if fallos else 0)
