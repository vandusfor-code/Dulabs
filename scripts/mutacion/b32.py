"""Bloque 32 — pruebas de mutación: asesora "Aria" (personalidad, conocimiento, bienvenidas, ciudad en
la dirección, textos del pedido). Se quita UNA protección, alguna prueba DEBE fallar; luego se
restaura el archivo. Uso: python3 scripts/mutacion/b32.py (desde la raíz del repo; sin BD ni red)."""
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
CX = "lib/agente/contexto.ts"
RT = "lib/agente/runtime.ts"
CK = "lib/agente/checkout.ts"
IN = "lib/agente/lenguaje/interpretar.ts"
T = "lib/agente/agente-asesora-b32.test.ts"
M = [
    ("M1 el conocimiento oficial no llega al modelo", CX,
     "  if (b.conocimiento?.length) {", "  if (false) {"),
    ("M2 la personalidad no llega al modelo", CX,
     "    b.personalidad ? `Cómo conversas y vendes: ${b.personalidad}` : null,\n", ""),
    ("M3 sin regla de no enumerar categorías de memoria", CX,
     "\n14. No enumeres de memoria", "\nNo enumeres de memoria"),
    ("M4 la bienvenida mayorista la escribe el modelo", RT,
     "if (inicio?.mayor && trace.classification?.action", "if (false && trace.classification?.action"),
    ("M5 la bienvenida mayorista sale también a quien no la configuró", RT,
     "if (inicio?.mayor && trace.classification?.action === \"classified\" && current.channel === \"wholesale\" && buttonChoice === \"wholesale\") {\n      return startDone(\"wholesale_welcome\", await sendMenu(inicio.mayor,",
     "if (trace.classification?.action === \"classified\" && current.channel === \"wholesale\" && buttonChoice === \"wholesale\") {\n      return startDone(\"wholesale_welcome\", await sendMenu(inicio?.mayor ?? \"\","),
    ("M6 detal sin el botón de regalo", RT,
     "const buttons = [INTENT_MENU.buttons[0], RETAIL_GIFT_BUTTON, INTENT_MENU.buttons[1]];", "const buttons = [...INTENT_MENU.buttons];"),
    ("M7 'Buscar una joya' ignora el texto del negocio", RT,
     "const prompt = inicio?.buscar ?? START_MESSAGES.searchPrompt;", "const prompt = START_MESSAGES.searchPrompt;"),
    ("M8 un barrio con nombre de ciudad se toma como ciudad", IN,
     "  if (!antes || ANTES_DE_BARRIO.has(antes)) return null;", "  if (!antes) return null;"),
    ("M9 vuelve a preguntar la ciudad que ya venía en la dirección", CK,
     "      const conCiudad = ciudadEnDireccion(a.valor);", "      const conCiudad = null as ReturnType<typeof ciudadEnDireccion>;"),
    ("M10 la nota de envío sale también al recoger en tienda", CK,
     "  if (data.delivery === \"domicilio\" && texts.shippingNote)", "  if (texts.shippingNote)"),
    ("M11 aviso de compra inicial mayorista también al detal", CK,
     "  if (order.channel === \"wholesale\" && texts.wholesaleMinimum", "  if (texts.wholesaleMinimum"),
    ("M12 aviso de compra inicial aunque el pedido la supere", CK,
     "&& order.total < texts.wholesaleMinimum) {", "&& order.total > 0) {"),
    ("M13 la pregunta de pago ignora el texto del negocio", CK,
     "      return io.texts?.paymentQuestion\n", "      return false\n"),
    ("M14 el mensaje final ignora la nota del negocio", CK,
     "CHECKOUT_MESSAGES.confirmed(io.businessName, io.texts?.confirmedNote)", "CHECKOUT_MESSAGES.confirmed(io.businessName)"),
]
# No se incluye "aceptar la dirección sin revalidarla": es una mutación EQUIVALENTE (si la dirección
# completa es válida, sin la ciudad conserva los mismos números y marcas, así que también lo es). La
# revalidación queda como defensa en profundidad.
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
