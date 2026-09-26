"""Bloque 29 — pruebas de mutación: fotos del cliente, marca con la referencia y ST03. Se quita UNA
protección, alguna prueba DEBE fallar; luego se restaura el archivo.
Uso: python3 scripts/mutacion/b29.py (desde la raíz del repo; sin BD ni red)."""
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
LG = "lib/agente/agente-lenguaje.test.ts"
FH = "lib/catalogo/foto-http.test.ts"
MR = "lib/catalogo/marca-referencia.test.ts"
RT = "lib/agente/runtime.ts"
M = [
    ("M1 un posible comprobante no pasa a una asesora", RT,
     'if (kind !== "video" && ck.paymentMethod === "transferencia" && ck.paymentStatus === "pendiente")', "if (false)", LG),
    ("M2 foto sobre un pedido entregado no pasa a una asesora", RT,
     'if (ck.stage === "enviado" || ck.stage === "entregado")', "if (false)", LG),
    ("M3 la leyenda de la foto se ignora", RT,
     '    if (texto && !ckStep) return { tipo: "leyenda", texto };\n', "", LG),
    ("M4 'sí' tras el aviso de la foto no pasa a una asesora", RT,
     "loaded.state.fotoPedidaTurn === loaded.state.turn && esAfirmacion", "false && esAfirmacion", LG),
    ("M5 el manejo nuevo se aplica a todos los negocios", RT,
     "deps.config.checkoutEnabled && MEDIA_DEL_CLIENTE.has(policy.kind)", "MEDIA_DEL_CLIENTE.has(policy.kind)", LG),
    ("M6 varias fotos seguidas => varios avisos", RT,
     "          // Varias fotos seguidas: un solo aviso (anti-spam).\n          trace.state_saved = await deps.state.save(key, next, loaded.version).catch(() => false);\n          return finish(\"rate_limited\", null);\n", "", LG),
    ("M7 'me alegra saber que ya tienes tu pedido' sin respaldo sale", "lib/agente/anclaje.ts",
     "|\\bya\\s+tienes\\s+(?:contigo\\s+)?(?:tu|el|su)\\s+(?:pedido|compra|orden)\\b", "", LG),
    ("M8 la marca sale aunque el módulo esté apagado", "lib/catalogo/service.ts",
     "if (input.whatsapp && (await referenceMarkOf(pub.tenantId))) {", "if (input.whatsapp) {", FH),
    ("M9 la conversión ignora la marca", "lib/catalogo/imagen-whatsapp.ts",
     "if (!opts.marca) return", "if (true) return", MR),
    ("M10 descarga con referencia sin el módulo", "lib/catalogo/service.ts",
     '      if (!(await repo.isReferenceMarkEnabled?.(actor.tenantId))) throw new CatalogError("NOT_FOUND", "La marca con la referencia no está habilitada para este negocio.");\n', "", FH),
    ("M11 la tienda muestra la referencia sin el módulo", "lib/catalogo/service.ts",
     "return (await repo.isReferenceMarkEnabled?.(tenantId).catch(() => false)) ?? false;", "return true;", FH),
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
