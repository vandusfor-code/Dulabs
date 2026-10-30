"""Flujo de COMPRA de AMORE que ya no secuestra la conversación (lib/amore-compra-vigencia.ts + el gate interceptarCompraProductoAmore) — pruebas de mutación. Se quita o se invierte UNA protección a la vez;
alguna prueba DEBE fallar; luego se restaura el archivo. Si una mutación NO se detecta, la protección se podía eliminar sin que nadie se enterara: las pruebas son insuficientes y hay que reforzarlas.

Uso (desde la raíz del repo; sin red ni base de datos real: todo corre con dobles y una base en memoria):
    python3 scripts/mutacion/compra-vigencia.py               # todas
    python3 scripts/mutacion/compra-vigencia.py --verificar   # solo comprueba que cada patrón aplica exactamente una vez
    python3 scripts/mutacion/compra-vigencia.py C01 G07       # solo esas
    (en Windows: PYTHONIOENCODING=utf-8 py -3 -X utf8 scripts/mutacion/compra-vigencia.py)

Cubre: la regla (persona atendiendo y su defensa por texto, cuántos avisos seguidos, recordatorio ya enviado, cambio de tema, qué se suelta primero) y el gate (suelta el flujo sin mandar nada ni marcar el
wamid, deja pasar el mensaje, el recordatorio solo cuando toca, un botón «Comprar» nuevo reinicia el flujo, lee el historial solo cuando hace falta)."""
import atexit
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

VIG = "lib/amore-compra-vigencia.ts"
ROUTER = "lib/amore-entrada-router.ts"

T_VIG = ["lib/amore-compra-vigencia.test.ts"]
T_ROUTER = ["lib/amore-entrada-router.test.ts"]
T_PIPE = ["lib/amore-saludo-unico.test.ts"]

SUELTA = 'await actualizarEntrada(params.supabase, idFila, { modo: "gemini" });\n        return { manejado: false };'

# (id, descripción, archivo, texto a buscar (exactamente UNA vez), reemplazo, pruebas que deben detectarlo)
M = [
    # --- la regla ---
    ("C01", "una persona atendiendo nunca se detecta", VIG, 'return ultimo?.origen === "humano" && !esTextoDelAsistente(ultimo.texto);', "return false;", T_VIG + T_ROUTER),
    ("C02", "sin la defensa: un envío del asistente mal marcado como «humano» se toma por una persona", VIG, 'ultimo?.origen === "humano" && !esTextoDelAsistente(ultimo.texto)', 'ultimo?.origen === "humano"', T_VIG + T_ROUTER),
    ("C03", "el saludo con el nombre del producto no se reconoce como texto del asistente", VIG, "TEXTOS_FIJOS_DEL_ASISTENTE.has(compacto) || compacto.startsWith(COMIENZO_SALUDO_COMPRA)", "TEXTOS_FIJOS_DEL_ASISTENTE.has(compacto)", T_VIG + T_ROUTER),
    ("C04", "el menú de compra no figura entre los textos del asistente", VIG, "    MENSAJE_COMPRA_MENU,\n    MENSAJE_COMPRA_OPCION_INVALIDA,", "    MENSAJE_COMPRA_OPCION_INVALIDA,", T_VIG + T_ROUTER),
    ("C05", "los avisos se cuentan aunque no sean seguidos", VIG, "compactar(saliente.texto) !== aviso) break;", "compactar(saliente.texto) !== aviso) continue;", T_VIG),
    ("C06", "el tope de avisos baja a 1 (no se tolera ni un solo mensaje equivocado)", VIG, "export const MAX_AVISOS_OPCION_COMPRA_SEGUIDOS = 2;", "export const MAX_AVISOS_OPCION_COMPRA_SEGUIDOS = 1;", T_VIG + T_ROUTER + T_PIPE),
    ("C07", "el tope de avisos sube a 3 (se sigue insistiendo)", VIG, "export const MAX_AVISOS_OPCION_COMPRA_SEGUIDOS = 2;", "export const MAX_AVISOS_OPCION_COMPRA_SEGUIDOS = 3;", T_VIG + T_ROUTER + T_PIPE),
    ("C08", "nunca se sabe que ya se le recordó el pago (el recordatorio se repite)", VIG, "return ultimo != null && compactar(ultimo) === compactar(MENSAJE_COMPRA_RECORDATORIO_PAGO);", "return false;", T_VIG + T_ROUTER + T_PIPE),
    ("C09", "las instrucciones de pago cuentan como si ya fueran el recordatorio", VIG, "compactar(ultimo) === compactar(MENSAJE_COMPRA_RECORDATORIO_PAGO);", "compactar(ultimo) === compactar(MENSAJE_COMPRA_RECORDATORIO_PAGO) || compactar(ultimo) === compactar(MENSAJE_COMPRA_METODOS_PAGO_PENDIENTE);", T_VIG + T_ROUTER),
    ("C10", "pedir una cita no cuenta como cambiar de tema", VIG, "return pideCitaNueva(texto) || detectarIntencionGestionCitas(texto) !== null;", "return detectarIntencionGestionCitas(texto) !== null;", T_VIG + T_ROUTER + T_PIPE),
    ("C11", "gestionar la cita no cuenta como cambiar de tema", VIG, "return pideCitaNueva(texto) || detectarIntencionGestionCitas(texto) !== null;", "return pideCitaNueva(texto);", T_VIG + T_ROUTER),
    ("C12", "una respuesta válida («1» o «2») se descarta por los avisos anteriores", VIG, "if (!params.esOpcion && avisosDeOpcionInvalidaSeguidos(params.salientes) >= MAX_AVISOS_OPCION_COMPRA_SEGUIDOS)", "if (avisosDeOpcionInvalidaSeguidos(params.salientes) >= MAX_AVISOS_OPCION_COMPRA_SEGUIDOS)", T_VIG + T_ROUTER),
    ("C13", "el menú no se suelta por una persona atendiendo", VIG, 'if (atiendeUnaPersona(params.salientes)) return "atiende_una_persona";', "", T_VIG + T_ROUTER + T_PIPE),
    ("C14", "el menú no se suelta por cambio de tema", VIG, 'if (cambiaDeTema(params.texto)) return "cambio_de_tema";', "", T_VIG + T_ROUTER + T_PIPE),
    ("C15", "esperando el pago el asistente no calla cuando una persona atiende", VIG, 'if (atiendeUnaPersona(params.salientes)) return "callar_atiende_una_persona";', "", T_VIG + T_ROUTER + T_PIPE),
    ("C16", "esperando el pago el recordatorio se repite con cada mensaje", VIG, 'if (yaSeLeRecordoElPago(params.salientes)) return "callar_ya_se_recordo";', "", T_VIG + T_ROUTER + T_PIPE),
    ("C17", "esperando el pago un cambio de tema no suelta el flujo", VIG, 'if (cambiaDeTema(params.texto)) return "soltar_cambio_de_tema";', "", T_VIG + T_ROUTER + T_PIPE),
    # --- el gate ---
    ("G01", "el gate nunca suelta el menú de compra", ROUTER, "        if (motivo) return await soltar(motivo);\n", "", T_ROUTER + T_PIPE),
    ("G02", "al soltar el flujo se marca el mensaje como ya atendido (se pierde)", ROUTER, SUELTA, 'await actualizarEntrada(params.supabase, idFila, { modo: "gemini", ultimoWamidProcesado: params.wamid });\n        return { manejado: false };', T_ROUTER + T_PIPE),
    ("G03", "al soltar el flujo el mensaje se da por manejado (nadie más lo ve)", ROUTER, SUELTA, 'await actualizarEntrada(params.supabase, idFila, { modo: "gemini" });\n        return { manejado: true };', T_ROUTER + T_PIPE),
    ("G04", "el flujo no se suelta de verdad (sigue en el mismo paso)", ROUTER, SUELTA, "await actualizarEntrada(params.supabase, idFila, {});\n        return { manejado: false };", T_ROUTER + T_PIPE),
    ("G05", "esperando el pago el recordatorio se manda siempre", ROUTER, 'if (decision === "recordar") {', "if (true) {", T_ROUTER + T_PIPE),
    ("G06", "esperando el pago un cambio de tema no suelta el flujo (el gate lo ignora)", ROUTER, 'if (decision === "soltar_cambio_de_tema") return await soltar(decision);', "", T_ROUTER + T_PIPE),
    ("G07", "un botón «Comprar» nuevo recibe «No reconocí esa opción» en vez de reiniciar el flujo", ROUTER, "if (fila && MODOS_COMPRA.has(fila.modo) && extraerProductoDeLinkTienda(params.texto) === null) {", "if (fila && MODOS_COMPRA.has(fila.modo)) {", T_ROUTER + T_PIPE),
    ("G08", "se lee un solo mensaje del historial (no alcanza para contar avisos)", ROUTER, "limite: SALIENTES_COMPRA_A_REVISAR }", "limite: 1 }", T_ROUTER + T_PIPE),
    ("G09", "toda respuesta se toma por una opción válida del menú", ROUTER, 'esOpcion: texto === "1" || texto === "2"', "esOpcion: true", T_ROUTER + T_PIPE),
    ("G10", "se lee el historial incluso para reconocer «Ya pagué»", ROUTER, '      // fila.modo === "compra_esperando_pago"\n      if (detectarConfirmacionPago(texto)) {', '      // fila.modo === "compra_esperando_pago"\n      await leer();\n      if (detectarConfirmacionPago(texto)) {', T_ROUTER),
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
    elegidas = {a for a in argv if a[:1] in ("C", "G") and a[1:].isdigit()}
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
