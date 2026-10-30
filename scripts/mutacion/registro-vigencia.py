"""Registro de clienta de AMORE que ya no se retoma cuando está abandonado (lib/amore-registro-vigencia.ts + el gate de registro del router) — pruebas de mutación. Se quita o se invierte UNA protección a la vez;
alguna prueba DEBE fallar; luego se restaura el archivo. Si una mutación NO se detecta, la protección se podía eliminar sin que nadie se enterara: las pruebas son insuficientes y hay que reforzarlas.

Uso (desde la raíz del repo; sin red ni base de datos real: todo corre con dobles y una base en memoria):
    python3 scripts/mutacion/registro-vigencia.py               # todas
    python3 scripts/mutacion/registro-vigencia.py --verificar   # solo comprueba que cada patrón aplica exactamente una vez
    python3 scripts/mutacion/registro-vigencia.py V01 L02       # solo esas
    (en Windows: PYTHONIOENCODING=utf-8 py -3 -X utf8 scripts/mutacion/registro-vigencia.py)

Cubre: la regla (una persona atendiendo, registro vencido y su límite, avisos seguidos y su tope, qué cuenta como aviso), el lector del historial (solo lo enviado, de esa clienta y ese negocio, del más
nuevo al más viejo, límite, errores) y el gate (suelta el registro, no marca el wamid, deja pasar el mensaje, lee solo lo necesario)."""
import atexit
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

VIG = "lib/amore-registro-vigencia.ts"
ROUTER = "lib/amore-entrada-router.ts"
LECTOR = "lib/chats/salientes-recientes.ts"

T_VIG = ["lib/amore-registro-vigencia.test.ts"]
T_LECTOR = ["lib/chats/salientes-recientes.test.ts"]
T_ROUTER = ["lib/amore-entrada-router.test.ts"]
T_PIPE = ["lib/amore-saludo-unico.test.ts"]

SUELTA = '{ modo: "gemini" });\n      return { manejado: false };'

# (id, descripción, archivo, texto a buscar (exactamente UNA vez), reemplazo, pruebas que deben detectarlo)
M = [
    # --- la regla ---
    ("V01", "una persona atendiendo NO suelta el registro", VIG, 'if (ultimo.origen === "humano") return "atiende_una_persona";', "", T_VIG + T_ROUTER + T_PIPE),
    ("V02", "un registro nunca vence", VIG, 'if (Number.isFinite(enviadoMs) && ahoraMs - enviadoMs > REGISTRO_VENCE_MS) return "registro_vencido";', "", T_VIG + T_ROUTER + T_PIPE),
    ("V03", "el límite de vencimiento es inclusivo", VIG, "ahoraMs - enviadoMs > REGISTRO_VENCE_MS", "ahoraMs - enviadoMs >= REGISTRO_VENCE_MS", T_VIG + T_ROUTER),
    ("V04", "una hora que no se puede leer vence el registro", VIG, "Number.isFinite(enviadoMs) && ahoraMs - enviadoMs > REGISTRO_VENCE_MS", "!(ahoraMs - enviadoMs <= REGISTRO_VENCE_MS)", T_VIG),
    ("V05", "los avisos se cuentan aunque no sean seguidos", VIG, "!AVISOS_DE_RESPUESTA_INVALIDA.has(compactar(saliente.texto))) break;", "!AVISOS_DE_RESPUESTA_INVALIDA.has(compactar(saliente.texto))) continue;", T_VIG),
    ("V06", "el tope de avisos baja a 1 (no se tolera ni un error de formato)", VIG, "export const MAX_AVISOS_INVALIDOS_SEGUIDOS = 2;", "export const MAX_AVISOS_INVALIDOS_SEGUIDOS = 1;", T_VIG + T_ROUTER + T_PIPE),
    ("V07", "el tope de avisos sube a 3 (se sigue insistiendo)", VIG, "export const MAX_AVISOS_INVALIDOS_SEGUIDOS = 2;", "export const MAX_AVISOS_INVALIDOS_SEGUIDOS = 3;", T_VIG + T_ROUTER + T_PIPE),
    ("V08", "el aviso del mes no cuenta como insistencia", VIG, "new Set([compactar(MENSAJE_DIA_INVALIDO), compactar(MENSAJE_MES_INVALIDO)])", "new Set([compactar(MENSAJE_DIA_INVALIDO)])", T_VIG + T_ROUTER),
    ("V09", "un espacio de más en el texto guardado impide reconocer el aviso", VIG, 'const compactar = (texto: string) => texto.replace(/\\s+/g, " ").trim();', "const compactar = (texto: string) => texto;", T_VIG),
    ("V10", "el registro vence al minuto (en vez de a las 6 horas)", VIG, "export const REGISTRO_VENCE_MS = 6 * 60 * 60 * 1000;", "export const REGISTRO_VENCE_MS = 60 * 1000;", T_ROUTER + T_PIPE),
    ("V11", "sin historial legible se suelta el registro a ciegas", VIG, "if (!salientes || !ultimo) return null;", 'if (!salientes || !ultimo) return "registro_vencido";', T_VIG + T_ROUTER + T_PIPE),
    # --- el lector del historial ---
    ("L01", "se mezclan los mensajes que escribió la clienta con los enviados", LECTOR, '      .eq("direccion", "saliente")\n', "", T_LECTOR),
    ("L02", "los mensajes salen del más viejo al más nuevo", LECTOR, '.order("id", { ascending: false })', '.order("id", { ascending: true })', T_LECTOR + T_PIPE),
    ("L03", "no se filtra por negocio (se mezclan las clientas de otros negocios)", LECTOR, '.eq("id_tenant", params.idTenant)\n      .eq("telefono", params.telefono)', '.eq("telefono", params.telefono)', T_LECTOR),
    ("L04", "un error de la base se toma por «sin conversación»", LECTOR, "if (errorConversacion) throw errorConversacion;", "", T_LECTOR),
    ("L05", "el límite pedido se ignora", LECTOR, ".limit(params.limite ?? LIMITE_POR_DEFECTO)", ".limit(LIMITE_POR_DEFECTO)", T_LECTOR),
    ("L06", "un origen desconocido se toma por válido", LECTOR, 'origen: fila.origen === "humano" || fila.origen === "automatico" ? fila.origen : null,', 'origen: (fila.origen as "humano" | "automatico" | null | undefined) ?? null,', T_LECTOR),
    # --- el gate de registro ---
    ("R01", "el gate nunca suelta un registro abandonado", ROUTER, "if (motivoAbandono) {", "if (false) {", T_ROUTER + T_PIPE),
    ("R02", "al soltar el registro se marca el mensaje como ya atendido (se pierde)", ROUTER, SUELTA, '{ modo: "gemini", ultimoWamidProcesado: params.wamid });\n      return { manejado: false };', T_ROUTER + T_PIPE),
    ("R03", "al soltar el registro el mensaje se da por manejado (nadie más lo ve)", ROUTER, SUELTA, '{ modo: "gemini" });\n      return { manejado: true };', T_ROUTER + T_PIPE),
    ("R04", "el registro no se suelta de verdad (sigue en el mismo paso)", ROUTER, SUELTA, "{});\n      return { manejado: false };", T_ROUTER + T_PIPE),
    ("R05", "se lee un solo mensaje del historial (no alcanza para contar avisos)", ROUTER, "limite: SALIENTES_A_REVISAR }", "limite: 1 }", T_ROUTER + T_PIPE),
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
    elegidas = {a for a in argv if a[:1] in ("V", "L", "R") and a[1:].isdigit()}
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
