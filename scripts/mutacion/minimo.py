"""Mínimo de la compra inicial mayorista editable desde el panel (migración 20261214) — pruebas de mutación. Se quita o se invierte UNA protección a la vez; alguna prueba DEBE fallar; luego se restaura el archivo.
Si una mutación NO se detecta, la protección se podía eliminar sin que nadie se enterara: las pruebas son insuficientes y hay que reforzarlas.

Uso (desde la raíz del repo; sin red ni base de datos real: el SQL corre en Postgres embebido, PGlite):
    python3 scripts/mutacion/minimo.py               # todas
    python3 scripts/mutacion/minimo.py --verificar   # solo comprueba que cada patrón aplica exactamente una vez
    python3 scripts/mutacion/minimo.py M12 M40       # solo esas
    (en Windows: PYTHONIOENCODING=utf-8 py -3 -X utf8 scripts/mutacion/minimo.py)

Cubre: la base (rango del monto, control de concurrencia contra el mínimo y contra la configuración entera, las mismas líneas que vio la aplicación, que lo escrito sea una configuración con el mínimo nuevo, la
auditoría de solo añadir, los permisos y qué líneas se ven), el monto escrito a mano dentro de un texto (cómo se reconoce y se reemplaza), el cálculo con el esquema REAL del asistente (un texto que quedaría
demasiado largo no se toca), el adaptador (monto visto, líneas distintas, mismo monto, rango, quién cambia, errores sin filtrar, sin migración), la ruta (solo un administrador) y la pantalla."""
import atexit
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

SQL = "supabase/migrations/20261214000000_dulabs_agente_minimo_mayorista.sql"
C = "lib/cms-comercial/"
PURO, SERV, ADAPT = C + "minimo-mayorista.ts", C + "minimo-mayorista-servidor.ts", C + "minimo-mayorista-supabase.ts"
RUTA = "app/api/dashboard/tienda/minimo-mayorista/route.ts"
UI = "components/dashboard/tienda/"
TARJETA, PREGUNTAS = UI + "minimo-mayorista.tsx", UI + "preguntas.tsx"

T_PURO = [C + "minimo-mayorista.test.ts"]
T_SQL = [C + "minimo-mayorista.pglite.test.ts"]
T_RUTA = ["app/api/dashboard/tienda/minimo-mayorista.test.ts"]
T_DOM = [UI + "minimo-mayorista.dom.test.tsx"]

# (id, descripción, archivo, texto a buscar (exactamente UNA vez), reemplazo, pruebas que deben detectarlo)
M = [
    # --- la base: lo que se garantiza sin importar quién la llame ---
    ("M01", "el mínimo puede ser menor de $10.000", SQL, "p_nuevo < 10000", "p_nuevo < 10", T_SQL),
    ("M02", "el mínimo puede superar $100.000.000", SQL, "p_nuevo > 100000000", "p_nuevo > 1000000000", T_SQL),
    ("M03", "se acepta no decir qué mínimo se estaba viendo", SQL, "p_esperado is null or ", "", T_SQL),
    ("M04", "se acepta no entregar ninguna línea (o algo que no es una lista)", SQL, "if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then", "if false then", T_SQL),
    ("M05", "sin ninguna línea con mínimo se sigue adelante", SQL, "if v_telefonos is null then", "if false then", T_SQL),
    ("M06", "no se exige que sean las mismas líneas que vio la aplicación", SQL, "if v_vistos is distinct from v_telefonos then", "if false then", T_SQL),
    ("M07", "no se compara el mínimo que se veía con el actual (se pisa el cambio de otra persona)", SQL, "if (v_actual #>> '{pedido,minimo_mayorista}') is distinct from p_esperado::text then", "if false then", T_SQL),
    ("M08", "no se compara la configuración entera (se pisa un cambio ajeno a otro texto)", SQL, "if v_actual is distinct from (v_item -> 'antes') then", "if false then", T_SQL),
    ("M09", "se acepta un mínimo escrito como texto en la configuración nueva", SQL, "\n       or jsonb_typeof(v_item #> '{despues,pedido,minimo_mayorista}') is distinct from 'number'", "", T_SQL),
    ("M10", "se acepta una configuración nueva con OTRO mínimo", SQL, "\n       or (v_item #>> '{despues,pedido,minimo_mayorista}') is distinct from p_nuevo::text then", " then", T_SQL),
    ("M11", "la auditoría no dice quién cambió", SQL, "      p_actor,\n", "      null,\n", T_SQL + T_RUTA),
    ("M12", "la auditoría no guarda cómo eran los textos", SQL, "coalesce(v_item -> 'textos_antes', '{}'::jsonb)", "'{}'::jsonb", T_SQL),
    ("M13", "ver incluye las líneas apagadas", SQL, "    and c.habilitado is true\n    and jsonb_typeof(c.negocio #> '{pedido,minimo_mayorista}') = 'number'\n$$;", "    and jsonb_typeof(c.negocio #> '{pedido,minimo_mayorista}') = 'number'\n$$;", T_SQL + T_RUTA),
    ("M14", "ver mezcla las líneas de todos los negocios", SQL, "  where c.id_tenant = p_tenant\n    and c.habilitado is true", "  where true\n    and c.habilitado is true", T_SQL + T_RUTA),
    ("M15", "la auditoría se puede borrar", SQL, "before update or delete on public.dulabs_agente_config_cambios", "before update on public.dulabs_agente_config_cambios", T_SQL),
    ("M16", "cualquiera con la llave pública puede cambiar el mínimo", SQL, "revoke all on function public.dulabs_agente_minimo_mayorista_aplicar(uuid, uuid, bigint, bigint, jsonb) from public, anon, authenticated;", "revoke all on function public.dulabs_agente_minimo_mayorista_aplicar(uuid, uuid, bigint, bigint, jsonb) from public;", T_SQL),
    # --- el monto escrito a mano dentro de un texto ---
    ("M20", "el monto se confunde con el final de otro número (1.750.000)", PURO, "(?<![\\\\d.,])", "", T_PURO),
    ("M21", "el monto se confunde con el principio de otro (750.000,50)", PURO, "(?!\\\\d|[.,]\\\\d)", "(?!\\\\d)", T_PURO),
    ("M22", "solo se cambia la primera vez que aparece el monto", PURO, '\\\\d)`, "g");', '\\\\d)`, "");', T_PURO),
    ("M23", "no se reconoce el monto escrito sin puntos", PURO, "|${Math.round(monto)})", ")", T_PURO),
    ("M24", "no se reconoce el monto escrito con puntos de miles", PURO, "${escapar(conPuntosDeMiles(monto))}|${Math.round(monto)}", "${Math.round(monto)}", T_PURO),
    ("M25", "el monto nuevo siempre se escribe con puntos, aunque el viejo no los tuviera", PURO, 'escrito.includes(".") ? conPuntosDeMiles(nuevo) : String(Math.round(nuevo))', "conPuntosDeMiles(nuevo)", T_PURO),
    ("M26", "dentro de la configuración no se cambia ningún texto", PURO, "if (typeof valor === \"string\") return montoEnTexto(valor, viejo, nuevo) as T;", "if (typeof valor === \"string\") return valor as T;", T_PURO),
    ("M27", "también se cambian las claves que parecen un monto", PURO, "[k, montoEnJson(v, viejo, nuevo)]", "[montoEnJson(k, viejo, nuevo), montoEnJson(v, viejo, nuevo)]", T_PURO),
    ("M28", "las rutas de los textos salen sin orden ni sin quitar repetidas", PURO, 'return ruta === "" ? [...new Set(salida)].sort() : salida;', "return salida;", T_PURO),
    ("M29", "el mensaje del inicio por mayor se cuenta como otro texto", PURO, 'if (ruta === "inicio.mayor") return "mayor";', "", T_PURO),
    ("M30", "el mínimo mínimo del esquema baja a $1.000", PURO, "export const MINIMO_MAYORISTA_MIN = 10_000;", "export const MINIMO_MAYORISTA_MIN = 1_000;", T_PURO),
    # --- el cálculo con el esquema real del asistente ---
    ("M31", "un texto que quedaría demasiado largo con el monto nuevo se cambia igual (el asistente dejaría de responder)", SERV, "if (!luego.success) return", "if (false) return", T_PURO + T_SQL + T_RUTA + T_DOM),
    ("M32", "una configuración que hoy ya no cumple el esquema se toca igual", SERV, "if (!hoy.success) return", "if (false) return", T_PURO),
    ("M33", "el número del mínimo no se cambia (solo los textos)", SERV, "pedido: { ...pedido, minimo_mayorista: nuevo }", "pedido", T_PURO),
    ("M34", "varias líneas con montos distintos se dan por iguales", SERV, "new Set(minimos).size === 1", "true", T_PURO),
    # --- el adaptador ---
    ("M40", "no se compara el monto que la persona veía con el actual", ADAPT, "if (vista.minimo !== esperado) throw", "if (false) throw", T_PURO + T_SQL + T_RUTA),
    ("M41", "con líneas de montos distintos se elige uno por la persona", ADAPT, "if (!vista.uniforme) throw", "if (false) throw", T_PURO + T_RUTA + T_DOM),
    ("M42", "cambiar al mismo monto escribe igual (y deja auditoría)", ADAPT, "if (nuevo === vista.minimo) return", "if (false) return", T_PURO + T_RUTA),
    ("M43", "un monto fuera de rango llega hasta la base", ADAPT, "nuevo < MINIMO_MAYORISTA_MIN || nuevo > MINIMO_MAYORISTA_MAX", "false", T_PURO + T_RUTA),
    ("M44", "la auditoría no recibe quién cambió", ADAPT, "p_actor: actorUserId", "p_actor: null", T_PURO + T_RUTA),
    ("M45", "se entrega a la base otro «mínimo que se veía»", ADAPT, "p_esperado: esperado,", "p_esperado: nuevo,", T_PURO + T_SQL),
    ("M46", "un error desconocido de la base se le muestra a la persona", ADAPT, 'return new CmsError("INTERNAL_ERROR", MENSAJE_GENERAL);\n}', 'return new CmsError("INTERNAL_ERROR", motivo);\n}', T_PURO + T_RUTA),
    ("M47", "sin la migración se dice «error» en vez de «todavía no está activo»", ADAPT, 'new Set(["PGRST202", "PGRST205", "42883", "42P01"])', 'new Set(["PGRST205", "42883", "42P01"])', T_PURO + T_SQL + T_RUTA),
    # --- la ruta ---
    ("M50", "cualquiera que pueda consultar puede cambiar el mínimo", RUTA, 'withCms(request, "write", async ({ supabase, actor }) => {', 'withCms(request, "read", async ({ supabase, actor }) => {', T_RUTA),
    ("M51", "sin la migración la consulta del monto falla en vez de mostrar el de siempre", RUTA, 'if (!isCmsError(err) || err.code !== "FEATURE_UNAVAILABLE") throw err;', "throw err;", T_RUTA + T_DOM),
    # --- la pantalla ---
    ("M60", "la pantalla no avisa que el monto ya es el actual", TARJETA, "if (nuevo === vista.minimo) return setErrorCampo(", "if (false) return setErrorCampo(", T_DOM),
    ("M61", "la pantalla no revisa el rango del monto", TARJETA, "nuevo < MINIMO_MAYORISTA_MIN || nuevo > MINIMO_MAYORISTA_MAX", "false", T_DOM),
    ("M62", "si cambió mientras decidía no se vuelve a leer el monto", TARJETA, "if (r.error.status === 409) {", "if (false) {", T_DOM),
    ("M63", "el campo del monto admite letras y símbolos", TARJETA, '.replace(/\\D/g, "")', "", T_DOM),
    ("M64", "quien solo consulta ve el campo para cambiar el monto", TARJETA, "Boolean(vista && canWrite && ", "Boolean(vista && ", T_DOM),
    ("M65", "la confirmación no dice qué textos del asistente cambian", TARJETA, "{grupos.length > 0 && (", "{false && (", T_DOM),
    ("M66", "la tarjeta del monto no está en «Preguntas frecuentes»", PREGUNTAS, "<MinimoMayorista />", "", T_DOM),
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
    elegidas = {a for a in argv if a.startswith("M")}
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
