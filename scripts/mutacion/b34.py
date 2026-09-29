"""Bloque 34 — pruebas de mutación: registrar / editar / importar clientes y el asistente que ya los
conoce (saludo con su nombre, sin mínimo para clientes antiguos). Se quita UNA protección, alguna
prueba DEBE fallar; luego se restaura el archivo.
Uso: python3 scripts/mutacion/b34.py (desde la raíz del repo; sin BD ni red). La tabla y el listado SQL
tienen su prueba en PostgreSQL real (supabase/tests/20261203000000_dulabs_catalogo_clientes_ficha.test.sql)
y la matriz E2E (bloque P)."""
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SV = "lib/catalogo/clientes/servicio.ts"
MO = "lib/catalogo/clientes/modelo.ts"
RT = "lib/agente/runtime.ts"
CK = "lib/agente/checkout.ts"
T = ["lib/catalogo/clientes/registro-b34.test.ts", "lib/agente/agente-clientes-b34.test.ts"]
M = [
    ("M1 el mismo celular se registra dos veces", SV,
     "  if (existente) return apiError(\"ALREADY_EXISTS\",", "  if (false) return apiError(\"ALREADY_EXISTS\","),
    ("M2 la modalidad se escribe contra la actual, no contra la que se VIO", SV,
     "const esperado = datos.esperado !== undefined ? datos.esperado : (actual?.channel ?? null);", "const esperado = actual?.channel ?? null;"),
    ("M3 un conflicto de modalidad sigue escribiendo nombre y ficha", SV,
     "      if (w.result === \"conflicto\") return \"conflicto\";\n", ""),
    ("M4 cambiar la modalidad sin motivo", SV,
     "  if (cambiaModalidad && guardada && (motivo.length < 3", "  if (false && (motivo.length < 3"),
    ("M5 número de WhatsApp de otro negocio aceptado", SV,
     "nums.includes(pedido) ? { ok: true, pn: pedido }", "true ? { ok: true, pn: pedido }"),
    ("M6 con varios números se elige uno sin preguntar", SV,
     "  if (nums.length === 1) return { ok: true, pn: nums[0] };", "  if (nums.length >= 1) return { ok: true, pn: nums[0] };"),
    ("M7 celular colombiano sin indicativo", MO,
     "  if (/^3\\d{9}$/.test(d)) return `57${d}`;", "  if (/^3\\d{9}$/.test(d)) return d;"),
    ("M8 número extranjero sin '+' aceptado", MO,
     "return texto.trim().startsWith(\"+\") && /^\\d{8,15}$/.test(d) ? d : null;", "return /^\\d{8,15}$/.test(d) ? d : null;"),
    ("M9 nombre con etiquetas o llaves", MO,
     " && !/[<>{}]/.test(n) ? n : null;", " ? n : null;"),
    ("M10 celular repetido en el archivo", MO,
     "    if (vistos.has(telefono)) return error(\"Celular repetido en el archivo.\");\n", ""),
    ("M11 la vista previa no distingue a los existentes", MO,
     "accion: existentes.has(telefono) ? \"actualizar\" : \"nuevo\"", "accion: \"nuevo\""),
    ("M12 aplicar no vuelve a validar las filas", SV,
     "    if (!wa || !nombre) {\n", "    if (false) {\n"),
    ("M13 una fila que falla frena la importación", SV,
     "      errores.push({ telefono: f.telefono, motivo: \"No se pudo guardar\" });", "      throw new Error(\"importación interrumpida\");"),
    ("M14 más de 500 clientes por archivo", MO,
     "  if (datos.length > IMPORTAR_MAX_FILAS) return", "  if (false) return"),
    ("M15 número de fila del Excel corrido", MO,
     ".map((f, i) => ({ f, n: i + 2 }))", ".map((f, i) => ({ f, n: i + 1 }))"),
    ("M16 'ya es cliente' del formulario no se guarda", SV,
     "yaCompro: b.data.yaCompro ?? false, esperado: null", "yaCompro: false, esperado: null"),
    ("M17 el registrado no queda marcado como registrado", SV,
     "miembroId, \"Registrado por el equipo\", true);", "miembroId, \"Registrado por el equipo\", false);"),
    ("M18 'mayorista nuevo' aunque ya es cliente", MO,
     "c.compras === 0 && !c.yaCompro;", "c.compras === 0;"),
    ("M19 el checkout ignora 'ya es cliente'", CK,
     "(io.alreadyCustomer ? await io.alreadyCustomer().catch(() => false) : false)", "false"),
    ("M20 si la ficha falla, se exime del mínimo (fail-open)", CK,
     "io.alreadyCustomer().catch(() => false)", "io.alreadyCustomer().catch(() => true)"),
    ("M21 el runtime no pasa 'ya es cliente' al checkout", RT,
     "alreadyCustomer: deps.tools.customerIsExisting ? () => deps.tools.customerIsExisting!(key) : undefined,", "alreadyCustomer: undefined,"),
    ("M22 saludo fijo también a mitad de la conversación", RT,
     "=== \"known\" && loaded.state.turn === 0 && !state.checkout", "=== \"known\" && !state.checkout"),
    ("M23 saludo fijo aunque el mensaje traiga una pregunta", RT,
     " && !startAction && esSoloSaludo(input.text)) {", " && !startAction) {"),
    ("M24 saludo fijo con un pedido abierto", RT,
     " && !(activeOrder && ![\"completed\", \"cancelled\", \"expired\", \"rejected\"].includes(activeOrder.status)) && !startAction && esSoloSaludo", " && !startAction && esSoloSaludo"),
    ("M25 saludo con un 'nombre' inválido", RT,
     "/^\\p{L}[\\p{L}'’-]*$/u.test(primero)", "primero.length > 0"),
    ("M26 saludo fijo sin configurarlo (otros negocios cambian)", RT,
     "    if (inicio?.saludo_conocido && trace.classification", "    if (trace.classification"),
    ("M27 el webhook lee la ficha de otro contacto", "lib/agente/webhook.ts",
     ".yaCompro(k.tenantId, k.phoneNumberId, k.waId)", ".yaCompro(k.tenantId, k.phoneNumberId, k.phoneNumberId)"),
    ("M28 importar sin exigir el módulo Clientes", "app/api/dashboard/clientes/importar/route.ts",
     "{ module: CLIENTS_MODULE, recurso: \"clientes_importar\" }", "{ recurso: \"clientes_importar\" }"),
    ("M29 archivo sin tope de tamaño", "app/api/dashboard/clientes/importar/route.ts",
     "      if (archivo.size > ARCHIVO_MAX_BYTES) return apiError", "      if (false) return apiError"),
    ("M31 editar sin exigir el módulo Clientes", "app/api/dashboard/clientes/[cliente]/route.ts",
     "{ module: CLIENTS_MODULE, recurso: \"clientes_escritura\" }", "{ recurso: \"clientes_escritura\" }"),
    ("M32 registrar lo puede hacer el rol lectura", "app/api/dashboard/clientes/route.ts",
     "  return withCatalog(\n    request,\n    \"orders\",", "  return withCatalog(\n    request,\n    \"read\","),
    ("M30 'solo saludo' acepta cualquier texto que empiece con hola", "lib/agente/lenguaje/interpretar.ts",
     "  return saludos > 0 && t === \"\";", "  return saludos > 0;"),
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
        r = subprocess.run(["npx", "tsx", "--test", *T], capture_output=True, text=True, timeout=900)
        failed = [line for line in r.stdout.splitlines() if line.startswith("# fail")]
        det = r.returncode != 0
        print(f"{nombre}: {'DETECTADA' if det else 'NO DETECTADA'} ({failed[0] if failed else '?'})")
        if not det:
            fallos += 1
    finally:
        open(f, "w").write(orig)
print(f"\n{len(M) - fallos}/{len(M)} mutaciones detectadas")
sys.exit(1 if fallos else 0)
