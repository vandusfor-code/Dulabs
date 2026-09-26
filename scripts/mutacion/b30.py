"""Bloque 30 — pruebas de mutación: ráfaga de fotos, aviso de espera y botones sin freno. Se quita
UNA protección, alguna prueba DEBE fallar; luego se restaura el archivo.
Uso: python3 scripts/mutacion/b30.py (desde la raíz del repo; sin BD ni red)."""
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
LG = "lib/agente/agente-lenguaje.test.ts"
FH = "lib/catalogo/foto-http.test.ts"
MR = "lib/catalogo/marca-referencia.test.ts"
RT = "lib/agente/runtime.ts"
RF = "lib/agente/agente-rafaga-fotos.test.ts"
WH = "lib/agente/webhook.ts"
M = [
    ("M1 un botón espera el freno de ráfaga", WH,
     "return input.agenteListo && input.esBoton ? 0 : ESPERA_RAFAGA_MS;", "return false ? 0 : ESPERA_RAFAGA_MS;", RF),
    ("M2 el aviso de espera puede salir después de la respuesta", RT,
     "  const beforeSend = async () => {\n    stop();\n", "  const beforeSend = async () => {\n", RF),
    ("M3 el aviso de espera se aplica a todos los negocios", RT,
     "if (deps.config.checkoutEnabled && holdMs > 0) {", "if (holdMs > 0) {", RF),
    ("M4 una foto superada responde por su cuenta", WH,
     "if (fotoEnBuzon !== null && input.soloEncolar) {", "if (false) {", RF),
    ("M5 las fotos no pasan por el buzón", WH,
     "fotoEnBuzon = await fotoParaBuzon(deps2, mailbox, key, input).catch(() => null);", "fotoEnBuzon = null;", RF),
    ("M6 sin tope de lecturas por ráfaga", WH,
     ".length < MAX_FOTOS_LEIDAS_POR_RAFAGA;", ".length < 1_000;", RF),
    ("M7 una ráfaga partida en dos turnos pide la referencia dos veces", RT,
     "        return finish(\"rate_limited\", null);\n      }\n      const text = MEDIA_MESSAGES.pideReferencia(\"image\", lineas.length);", "      }\n      const text = MEDIA_MESSAGES.pideReferencia(\"image\", lineas.length);", RF),
    ("M8 'escribiendo…' temprano para números sin agente", "app/webhook-dulabs/route.ts",
     "  if (agenteListo && tokenMeta) {\n", "  if (tokenMeta) {\n", RF),
    ("M9 con el registro del pedido en curso la foto va al buzón", WH,
     "  if (ckStep) return null;\n", "", RF),
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
