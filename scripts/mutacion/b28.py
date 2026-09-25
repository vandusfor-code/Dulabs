"""Bloque 28 — pruebas de mutación del lenguaje humano: se quita UNA protección, alguna prueba DEBE fallar;
luego se restaura el archivo. Uso: python3 scripts/mutacion/b28.py (desde la raíz del repo; sin BD ni red)."""
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
LG = "lib/agente/agente-lenguaje.test.ts"
CK = "lib/agente/agente-checkout.test.ts"
CK_ = "lib/agente/checkout.ts"
IN = "lib/agente/lenguaje/interpretar.ts"
M = [
    ("M1 una pregunta se toma como dato", CK_,
     "    if (esPregunta(text) || pideCatalogo(text)) return answerAndRepeat(io, state, ck, text);\n", "", LG),
    ("M2 nombre acepta intenciones", IN,
     "  if (!sinIntencionDeNombre(raw)) return null;\n", "", LG),
    ("M3 'recojo en tienda' también cambia el pago", IN,
     "  const pago = nombraPago(t) ? leerPago(text, entregaActual) : null;", "  const pago = leerPago(text, entregaActual);", LG),
    ("M4 corrección aplicada al paso actual", CK_,
     "    if (corr && ((corr.entrega && ck.step !== \"delivery\") || (corr.pago && ck.step !== \"payment\"))) return corregir(io, state, ck, corr);\n", "", LG),
    ("M5 nombre al contacto antes de confirmar", CK_,
     "      return move(save({ customerName: name }));",
     "      await io.rememberName?.(name).catch(() => undefined);\n      return move(save({ customerName: name }));", CK),
    ("M6 cantidad ambigua fuera del checkout", "lib/agente/herramientas.ts",
     "      if (ctx.cartTargetAmbiguous && ", "      if (false && ctx.cartTargetAmbiguous && ", LG),
    ("M7 respuesta lateral con herramientas de escritura", "lib/agente/runtime.ts",
     "const outcome = await executeAgentTool(tc.name, tc.args, readOnly, qCtx, deps.tools);",
     "const outcome = await executeAgentTool(tc.name, tc.args, allowed, qCtx, deps.tools);", LG),
    ("M8 estado del pedido inventado", "lib/agente/anclaje.ts",
     "  for (const e of claimed.estados) if (!ev.estados?.has(e)) add({ kind: \"order_status\", value: e });\n", "", LG),
    ("M9 dirección acepta cualquier texto", IN,
     "  if (intencion || leerEntrega(valor) || leerPago(valor)) return null;\n  if (alguna(normalizar(valor), UBICACION_VAGA) || ws.length >= 2) return { tipo: \"vaga\" };\n  return null;",
     "  return { tipo: \"ok\", valor };", LG),
    ("M10 con varios productos se asume el objetivo", CK_,
     "  return sel.selected.length === 1 ? sel.selected[0].reference : \"ambiguo\";",
     "  return sel.selected.length === 1 ? sel.selected[0].reference : lines[0].reference;", LG),
    ("M11 ubicación en la dirección pasa a una asesora", "lib/agente/runtime.ts",
     "    if (ckStep === \"address\" && policy.kind === \"location\") {", "    if (false) {", LG),
    ("M12 contra entrega con domicilio se acepta", IN,
     "  if (segun && !transfer && !tienda && entrega === \"domicilio\") return \"no_disponible\";\n", "", LG),
    ("M13 'los dos' no selecciona ambos", "lib/agente/seleccion.ts",
     " || (BOTH.test(t) && shown.length === 2)", "", LG),
    ("M14 'Tienda La Perla' se lee como entrega", IN,
     "  const soloOpcion = ws.length <= 4 && ws.every((w) => PALABRAS_DE_OPCION.has(w));", "  const soloOpcion = ws.length <= 4;", LG),
    ("M15 tras Modificar se pierde el nombre", CK_,
     "  const next: ConversationState = { ...backToCart(state, order), ...(name ? { checkoutName: name } : {}) };", "  const next: ConversationState = backToCart(state, order);", LG),
    ("M16 un número suelto cambia cantidades", CK_,
     "  if (c && !/^(\\d{1,2}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)$/.test(t)) return { cambio: c, objetivoTexto: text };",
     "  if (c) return { cambio: c, objetivoTexto: text };", LG),
    ("M17 'sí' en el resumen confirma", CK_,
     "      const afirma = esAfirmacion(text) || isExplicitConfirmation(text) || /\\bconfirm/i.test(normalizar(text));",
     "      const afirma = false;", LG),
]
fallos = 0
for nombre, f, a, b, test in M:
    orig = open(f).read()
    if orig.count(a) != 1:
        print(f"{nombre}: NO APLICA (patrón {orig.count(a)} veces)")
        fallos += 1
        continue
    open(f, "w").write(orig.replace(a, b))
    try:
        r = subprocess.run(["npx", "tsx", "--test", test], capture_output=True, text=True, timeout=900)
        failed = [line for line in r.stdout.splitlines() if line.startswith("# fail")]
        det = r.returncode != 0
        print(f"{nombre}: {'DETECTADA' if det else 'NO DETECTADA'} ({failed[0] if failed else '?'})")
        if not det:
            fallos += 1
    finally:
        open(f, "w").write(orig)
print(f"\n{len(M) - fallos}/{len(M)} mutaciones detectadas")
sys.exit(1 if fallos else 0)
