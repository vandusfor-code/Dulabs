"""CMS comercial (Bloque 29) — pruebas de mutación. Se quita o se invierte UNA protección a la vez; alguna prueba DEBE fallar; luego se restaura el archivo.
Si una mutación NO se detecta, la protección se podía eliminar sin que nadie se enterara: las pruebas son insuficientes y hay que reforzarlas.

Uso (desde la raíz del repo; sin red ni base de datos real: el SQL corre en Postgres embebido, PGlite):
    python3 scripts/mutacion/cms.py               # todas
    python3 scripts/mutacion/cms.py --verificar   # solo comprueba que cada patrón aplica exactamente una vez
    python3 scripts/mutacion/cms.py M12 M40       # solo esas

Cubre: fechas y vigencia, modalidad/audiencia, campañas, prioridad y desempate de ofertas, precio efectivo y redondeo, combos, contenido y variables, validación
antes de publicar, esquemas, ciclo de publicación (permisos, conflictos, restauración), lector verificado, SQL (aislamiento por negocio, publicadas solamente, permisos,
inmutabilidad, auditoría), autorización y rutas HTTP.
PR 2 (administración de tienda en el Dashboard): verificación y re-codificación de imágenes en el servidor, el servicio de imágenes (permisos, rutas por negocio, límites),
las rutas de productos y contexto, el cliente del navegador, los ayudantes puros del editor (borrador, resumen de cambios, vista previa) y las protecciones de la pantalla
(guardar antes de revisar, publicar exactamente la revisión validada, cambios sin guardar, diálogos accesibles).
PR 3 (la tienda lee del CMS): el paso de lo publicado a la vitrina (imágenes listas, destinos que existen y están activos, portada nunca a medias, secciones, campaña vigente),
la carga con respaldo (la tienda nunca se cae por el CMS), la ruta pública de imágenes (solo lo listo, publicado y del propio negocio), el inicio con lo que elige el CMS,
el dibujo de las secciones, la siembra de la vitrina actual (SQL real en Postgres embebido) y los avisos y el enlace del editor.
PR 5 (ARIA y el CMS): lo que ARIA puede saber de lo publicado (consultas puras), las cuatro herramientas comerciales (contrato estricto, negocio y canal del turno, «no disponible» nunca un vacío
falso), la guarda de anclaje comercial (porcentajes, descuentos, ofertas, combos, campañas, vigencias, ausencias, fuga mayorista y cifras de políticas), su integración en el runtime (turno
normal y pregunta del checkout), el cableado real de producción y los scripts de migración de los textos del prompt (04 a 06, SQL real en Postgres embebido).
PILOTO por número (negocio.comercial_piloto): quién recibe las herramientas comerciales (runtime), el esquema de la configuración y los scripts 05, 05b, 05 reversa, 06 y 07 (SQL real en Postgres embebido;
cada mutante de un script corre solo la suite de ESE script, para que las ~25 mutaciones no tarden horas)."""
import atexit
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

C = "lib/cms-comercial/"
TIEMPO, CONTRATO, EVAL, VALID, ESQ, SERV, LECTOR = (C + n for n in ("tiempo.ts", "contrato.ts", "evaluacion.ts", "validacion.ts", "esquemas.ts", "servicio.ts", "lector.ts"))
REPO, AUTH, HTTP, CHK = C + "repositorio-supabase.ts", C + "auth.ts", C + "http.ts", C + "checksum.ts"
SQL = "supabase/migrations/20261210000000_dulabs_cms_comercial.sql"
RUTA_ACCION = "app/api/dashboard/tienda/entidades/[id]/[accion]/route.ts"
IMG_SRV, IMGS, ADAPT, PREVIA = C + "imagen-servidor.ts", C + "imagenes.ts", C + "adaptadores-supabase.ts", C + "previa.ts"
CLIENTE = "lib/cms-comercial-client.ts"
RUTA_PROD = "app/api/dashboard/tienda/productos/route.ts"
RUTA_CTX = "app/api/dashboard/tienda/contexto/route.ts"
UI = "components/dashboard/tienda/"
BORR, FORMATO, EDITOR, FORMS, UI_BASE, LISTA, PANELES = (UI + n for n in ("borrador.ts", "formato.ts", "editor.tsx", "formularios.tsx", "ui.tsx", "lista.tsx", "paneles.tsx"))

T_TIEMPO = [C + "tiempo.test.ts"]
T_EVAL = [C + "evaluacion.test.ts"]
T_VALID = [C + "validacion.test.ts"]
T_ESQ = [C + "esquemas.test.ts"]
T_SERV = [C + "servicio.pglite.test.ts"]
T_SQL = [C + "sql.pglite.test.ts"]
T_LECTOR = [C + "lector.test.ts", C + "servicio.pglite.test.ts"]
T_AUTH = [C + "auth.test.ts", "app/api/dashboard/tienda/rutas.test.ts"]
T_RUTAS = ["app/api/dashboard/tienda/rutas.test.ts", C + "http.test.ts"]
T_IMG_SRV = [C + "imagen-servidor.test.ts", C + "imagenes.pglite.test.ts"]
T_IMGS = [C + "imagenes.pglite.test.ts", "app/api/dashboard/tienda/rutas-editor.test.ts"]
T_EDITOR = ["app/api/dashboard/tienda/rutas-editor.test.ts"]
T_CLIENTE = ["lib/cms-comercial-client.test.ts"]
T_BORR = [UI + "borrador-formato.test.ts"]
T_PREVIA = [C + "previa.test.ts"]
T_DOM = [UI + "tienda.dom.test.tsx"]

# PR 3
VIT, VITPUB, IMGPUB, SIEMBRA = C + "vitrina.ts", C + "vitrina-publica.ts", C + "imagen-publica.ts", C + "siembra-vitrina.ts"
SERVICE = "lib/catalogo/service.ts"
INICIO = "components/catalogo-publico/tienda/TiendaInicio.tsx"
TIENDA_APP = UI + "TiendaApp.tsx"
SQL_SIEMBRA = "supabase/provisioning/delacour/03_sembrar_vitrina_actual.sql"
SQL_REVERSA = "supabase/provisioning/delacour/03_sembrar_vitrina_actual.reversa.sql"
T_VIT = [C + "vitrina.test.ts"]
T_VITPUB = [C + "vitrina-publica.test.ts"]
T_IMGPUB = [C + "imagen-publica.test.ts"]
T_HOME = ["lib/catalogo/inicio-cms.test.ts"]
T_INICIO = ["components/catalogo-publico/tienda/inicio-cms.test.tsx", "components/catalogo-publico/tienda/inicio-dorado.test.tsx"]
T_SIEMBRA = [C + "siembra-vitrina.pglite.test.ts"]
T_SIEMBRA_GEN = [C + "siembra-vitrina.test.ts"]

# PR 4 (el precio efectivo)
PRECIOS, PRECIOS_CMS, PEDIDO, RESOL = "lib/catalogo/precios.ts", C + "precios.ts", "lib/catalogo/pedido.ts", "lib/catalogo/resolucion.ts"
CARRITO, PEDIDO_HTTP, TIENDA_CTX = "lib/catalogo/carrito.ts", "lib/catalogo/pedido-http.ts", "components/catalogo-publico/tienda/TiendaContext.tsx"
MOTOR, HERR_PED, REPO_PED, CONTRATO_PED, PANEL = ("lib/catalogo/pedidos/" + n for n in ("motor.ts", "herramientas.ts", "repositorio.ts", "contrato.ts", "panel.ts"))
CHECKOUT = "lib/agente/checkout.ts"
TIENDA_UI = "components/catalogo-publico/tienda/"
HOJA, FICHA, TARJETA = TIENDA_UI + "HojaCarrito.tsx", TIENDA_UI + "FichaProducto.tsx", TIENDA_UI + "TarjetaProducto.tsx"
T_DECISION = ["lib/catalogo/precios.test.ts", C + "precios.test.ts", "lib/catalogo/precios-efectivos.test.ts"]
T_PUERTO = [C + "precios.test.ts", "lib/catalogo/precios-efectivos.test.ts"]
T_SERVICIO = ["lib/catalogo/precios-efectivos.test.ts", "lib/agente/agente-ofertas-precio-efectivo.test.ts"]
T_PEDIDO = ["lib/catalogo/pedido.test.ts", "lib/catalogo/precios-efectivos.test.ts"]
T_RESOL = ["lib/catalogo/resolucion-ofertas.test.ts", "lib/agente/agente-ofertas-precio-efectivo.test.ts"]
T_MOTOR = ["lib/agente/agente-ofertas-precio-efectivo.test.ts", "lib/catalogo/pedidos/lineas-oferta-persistencia.test.ts"]
T_PERSIST = ["lib/catalogo/pedidos/lineas-oferta-persistencia.test.ts"]
T_PANEL = ["components/dashboard/catalogo/lineas-pedido-oferta.test.tsx"]
T_CARRITO = ["lib/catalogo/carrito.test.ts", TIENDA_UI + "ofertas-ui.dom.test.tsx"]
T_UI_OFERTAS = [TIENDA_UI + "ofertas-ui.dom.test.tsx", TIENDA_UI + "inicio-cms.test.tsx", TIENDA_UI + "inicio-dorado.test.tsx"]
T_E2E_PRECIOS = [C + "precios.pglite.test.ts"]

PRECIOS_SUPA, PUB_SUPA, PUBLIC_LOADER, PRODUCCION = C + "precios-supabase.ts", C + "publico-supabase.ts", "lib/catalogo/public-loader.ts", "lib/catalogo/pedidos/produccion.ts"
T_REAL = [C + "tienda-real.pglite.test.ts"]

# PR 5 (ARIA y el CMS: herramientas comerciales, guarda de anclaje, cableado de producción y migración de los textos del prompt)
CONSULTA, HERR, ANCL_C, ANCL, RUNTIME, CONTEXTO, APROV, NOMBRES, WEBHOOK = C + "consulta.ts", "lib/agente/herramientas.ts", "lib/agente/comercial-anclaje.ts", "lib/agente/anclaje.ts", "lib/agente/runtime.ts", "lib/agente/contexto.ts", "lib/agente/aprovisionamiento.ts", "lib/agente/nombres-herramientas.ts", "lib/agente/webhook.ts"
PROV = "supabase/provisioning/delacour/"
SQL04, SQL04R, SQL05, SQL05R, SQL06, SQL06R = (PROV + n for n in ("04_migrar_textos_a_borradores.sql", "04_migrar_textos_a_borradores.reversa.sql", "05_habilitar_herramientas_comerciales.sql", "05_habilitar_herramientas_comerciales.reversa.sql", "06_retirar_textos_del_prompt.sql", "06_retirar_textos_del_prompt.reversa.sql"))
T_CONSULTA = [C + "consulta.test.ts", "lib/agente/agente-comercial-aria.test.ts"]
T_ARIA = ["lib/agente/agente-comercial-aria.test.ts"]
T_GUARDA = ["lib/agente/comercial-anclaje.test.ts", "lib/agente/agente-comercial-aria.test.ts"]
T_RUNTIME_ARIA = ["lib/agente/agente-comercial-aria.test.ts", "lib/agente/agente-comercial-checkout.test.ts"]
T_CHECKOUT_ARIA = ["lib/agente/agente-comercial-checkout.test.ts"]
T_PROD_ARIA = ["lib/agente/agente-comercial-produccion.pglite.test.ts"]
T_MIGRACION = [C + "migracion-textos.pglite.test.ts"]

# Piloto por número: el código del runtime y del esquema, y la suite de cada script SQL (se filtra por el nombre de su describe).
PILOTO_TS, CONFIG_TS = "lib/agente/piloto-comercial.ts", "lib/agente/config.ts"
SQL05B, SQL07 = PROV + "05b_abrir_herramientas_comerciales_a_todos.sql", PROV + "07_estado_migracion_textos_solo_lectura.sql"
T_PILOTO = ["lib/agente/agente-comercial-aria.test.ts", C + "migracion-textos.test.ts"]


def suite(nombre):
    return ["--test-name-pattern=" + nombre, C + "migracion-textos.pglite.test.ts"]


T_M05 = suite(r"05_habilitar_herramientas_comerciales\.sql")
T_M05B = suite(r"05b_abrir_herramientas_comerciales_a_todos\.sql")
T_M05R = suite(r"05_habilitar_herramientas_comerciales\.reversa\.sql")
T_M06 = suite(r"06_retirar_textos_del_prompt\.sql")
T_M07 = suite(r"07_estado_migracion_textos_solo_lectura\.sql")

LECTURA = C + "lectura-publicada.ts"
T_LECTURA = [C + "lectura-publicada.test.ts"]

# (id, descripción, archivo, buscar, reemplazar, pruebas)
M = [
    # --- Fechas y vigencia -------------------------------------------------------------------------------------------------------------------
    ("M01", "«hasta el 31» ya no incluye todo el día 31", TIEMPO, "aInstante(p, p.soloFecha ? DIA_MS : 0)", "aInstante(p, 0)", T_TIEMPO + T_EVAL),
    ("M02", "el desfase de Bogotá deja de ser -5", TIEMPO, "const DESFASE_MS = -5 * 60 * 60 * 1000;", "const DESFASE_MS = -4 * 60 * 60 * 1000;", T_TIEMPO),
    ("M03", "la oferta vale un milisegundo de más al terminar", TIEMPO, "if (hasta !== null && ahora >= hasta) return \"vencida\";", "if (hasta !== null && ahora > hasta) return \"vencida\";", T_TIEMPO + T_EVAL),
    ("M04", "la oferta no vale en el instante exacto de empezar", TIEMPO, "if (desde !== null && ahora < desde) return \"programada\";", "if (desde !== null && ahora <= desde) return \"programada\";", T_TIEMPO + T_EVAL),
    ("M05", "una vigencia ilegible se trata como vigente", TIEMPO, "if (!intervalo) return \"vencida\";", "if (!intervalo) return \"sin_limite\";", T_TIEMPO + T_EVAL),
    ("M06", "una vigencia con el fin antes del inicio queda vigente", TIEMPO, "if (desde !== null && hasta !== null && hasta <= desde) return \"vencida\";", "", T_TIEMPO + T_EVAL),
    ("M07", "una fecha imposible (30 de febrero) se acepta", TIEMPO, "if (utc.getUTCFullYear() !== anio || utc.getUTCMonth() !== mes - 1 || utc.getUTCDate() !== dia) return null;", "", T_TIEMPO),
    # --- Modalidad y audiencia ---------------------------------------------------------------------------------------------------------------
    ("M08", "«ambas» deja de servir a los dos canales", CONTRATO, "  if (modalidad === \"ambas\") return true;\n  return modalidad === \"detal\"", "  if (modalidad === \"ambas\") return false;\n  return modalidad === \"detal\"", T_EVAL),
    ("M09", "el cliente detal recibe lo mayorista y viceversa (modalidad)", CONTRATO, "  return modalidad === \"detal\" ? canal === \"retail\" : canal === \"wholesale\";", "  return modalidad === \"detal\" ? canal === \"wholesale\" : canal === \"retail\";", T_EVAL),
    ("M10", "el contenido «mayorista» llega al cliente detal (audiencia)", CONTRATO, "  return audiencia === \"detal\" ? canal === \"retail\" : canal === \"wholesale\";\n}\n\nexport const TEMAS_CONTENIDO", "  return audiencia === \"detal\" ? canal === \"wholesale\" : canal === \"retail\";\n}\n\nexport const TEMAS_CONTENIDO", T_EVAL),
    ("M11", "el contenido para «todos» no llega a nadie", CONTRATO, "  if (audiencia === \"todos\") return true;", "  if (audiencia === \"todos\") return false;", T_EVAL),
    # --- Ofertas, campañas y precio efectivo ------------------------------------------------------------------------------------------------
    ("M12", "las ofertas vencidas siguen activas", EVAL, " && vigenteAhora(o.contenido.vigencia, ctx.ahora) && permiteCampana(o.contenido.campana, campanas))", " && permiteCampana(o.contenido.campana, campanas))", T_EVAL),
    ("M13", "una oferta de una campaña inactiva sigue valiendo", EVAL, " && permiteCampana(o.contenido.campana, campanas))", ")", T_EVAL),
    ("M14", "una campaña que no existe deja valer a sus ofertas", EVAL, "return campana === undefined || activas.has(campana);", "return true;", T_EVAL),
    ("M15", "los combos vencidos siguen activos", EVAL, " && vigenteAhora(c.contenido.vigencia, ctx.ahora) && permiteCampana(c.contenido.campana, campanas))", " && permiteCampana(c.contenido.campana, campanas))", T_EVAL),
    ("M16", "una campaña vencida sigue activa", EVAL, "&& vigenteAhora(campana.contenido.vigencia, ctx.ahora);", ";", T_EVAL),
    ("M17", "gana la oferta de MENOR prioridad", EVAL, "return a.contenido.prioridad > b.contenido.prioridad;", "return a.contenido.prioridad < b.contenido.prioridad;", T_EVAL),
    ("M18", "en empate gana el PEOR precio para el cliente", EVAL, "return finalA < finalB;", "return finalA > finalB;", T_EVAL),
    ("M19", "en empate total gana la oferta más NUEVA", EVAL, "return a.creadaAt < b.creadaAt;", "return a.creadaAt > b.creadaAt;", T_EVAL),
    ("M20", "el último desempate sigue el orden alfabético inverso", EVAL, "return a.clave < b.clave;", "return a.clave > b.clave;", T_EVAL),
    ("M21", "una «oferta» puede dejar el mismo precio", EVAL, "if (!Number.isInteger(final) || final < 1 || final >= precioLista) return null;", "if (!Number.isInteger(final) || final < 1 || final > precioLista) return null;", T_EVAL),
    ("M22", "una oferta puede dejar el precio en cero o negativo", EVAL, "final < 1 || final >= precioLista", "final >= precioLista", T_EVAL),
    ("M23", "el porcentaje trunca en vez de redondear al peso más cercano", EVAL, "(precioLista * (100 - beneficio.valor) + 50) / 100", "(precioLista * (100 - beneficio.valor)) / 100", T_EVAL),
    ("M24", "el cliente mayorista recibe el valor detal del descuento", EVAL, "const valor = canal === \"retail\" ? beneficio.detal : beneficio.mayorista;\n    if (valor === undefined || !Number.isInteger(valor) || valor < 1) return null;", "const valor = canal === \"retail\" ? beneficio.mayorista : beneficio.detal;\n    if (valor === undefined || !Number.isInteger(valor) || valor < 1) return null;", T_EVAL),
    ("M25", "toda oferta aplica a todo producto", EVAL, "return a.todos || a.referencias.includes(producto.referencia)", "return true || a.referencias.includes(producto.referencia)", T_EVAL),
    ("M26", "las ofertas se ignoran por completo en el precio", EVAL, "if (mejor === null || mejorQue(o, final, mejor.o, mejor.final)) mejor = { o, final };", "", T_EVAL + T_SERV),
    # --- Combos ------------------------------------------------------------------------------------------------------------------------------
    ("M27", "un combo inactivo (vencido, otra modalidad) igual tiene vista", EVAL, "if (!activos.some((a) => a.id === combo.id && a.version === combo.version)) return null;", "", T_EVAL),
    ("M28", "el precio normal ignora la cantidad de cada componente", EVAL, "normal += p.precioLista * comp.cantidad;", "normal += p.precioLista;", T_EVAL),
    ("M29", "un combo sigue «disponible» con stock justo menos uno", EVAL, "else if (p.maxCantidad !== null && p.maxCantidad < comp.cantidad) problema = \"stock_insuficiente\";", "else if (p.maxCantidad !== null && p.maxCantidad <= comp.cantidad) problema = \"stock_insuficiente\";", T_EVAL),
    ("M30", "un componente agotado no apaga el combo", EVAL, "else if (p.disponibilidad === \"sold_out\") problema = \"componente_agotado\";", "", T_EVAL),
    # --- Contenido y variables ---------------------------------------------------------------------------------------------------------------
    ("M31", "un texto con una variable sin resolver se entrega con las llaves", EVAL, "    if (!titulo.ok || !texto.ok) {", "    if (false) {", T_EVAL),
    ("M32", "una variable desconocida se acepta y reemplaza", "lib/cms-comercial/variables.ts", "if (!esVariable(nombre)) desconocidas.push(nombre);", "", ["lib/cms-comercial/variables.test.ts", C + "evaluacion.test.ts"]),
    # --- Validación antes de publicar --------------------------------------------------------------------------------------------------------
    ("M33", "una oferta sin productos se puede publicar", VALID, "err(\"oferta_sin_productos\", \"alcance\", \"Esta oferta no puede publicarse porque no tiene productos asociados.\");", "", T_VALID + T_SERV),
    ("M34", "una fecha de fin que ya pasó se puede publicar", VALID, "if (fin !== null && fin <= ctx.ahora) err(", "if (false) err(", T_VALID + T_SERV),
    ("M35", "una orden al asistente en un texto se puede publicar", VALID, "if (orden) err(\"texto_instruccion\"", "if (false) err(\"texto_instruccion\"", T_VALID + T_SERV),
    ("M36", "una clave pegada en un texto se puede publicar", VALID, "if (pareceSecreto(texto)) err(\"texto_secreto\"", "if (false) err(\"texto_secreto\"", T_VALID),
    ("M37", "se puede escribir el mínimo mayorista a mano", VALID, "if (ctx.minimoMayorista !== null && escribioMontoAMano(valor, ctx.minimoMayorista)) {", "if (false) {", T_VALID + T_SERV),
    ("M38", "el enlace mayorista se puede escribir para clientes detal", VALID, "if (c.audiencia !== \"mayorista\" && contieneEnlaceMayorista(valor)) err(", "if (false) err(", T_VALID),
    ("M39", "un combo sin ahorro se puede publicar", VALID, "if (completo && precio !== undefined && precio >= normal) {", "if (completo && precio !== undefined && precio > normal) {", T_VALID + T_SERV),
    ("M40", "una referencia que no existe se acepta", VALID, "if (!p) err(\"producto_inexistente\", campo, `El producto ${valor} no existe en tu catálogo.`);", "if (!p) {}", T_VALID),
    ("M41", "un botón puede apuntar a una oferta sin publicar", VALID, "    } else if (el.estado !== \"publicada\") {\n      err(\"destino_no_publicado\"", "    } else if (false) {\n      err(\"destino_no_publicado\"", T_VALID),
    ("M42", "una imagen sin terminar de subir se acepta", VALID, "else if (a.estado !== \"listo\") err(\"imagen_pendiente\"", "else if (false) err(\"imagen_pendiente\"", T_VALID + T_SERV),
    ("M43", "las variables se aceptan fuera del contenido comercial", VALID, "if (tipo !== \"contenido\" && /\\{\\{|\\}\\}/.test(texto)) err(", "if (false) err(", T_VALID),
    ("M44", "una variable sin valor configurado se acepta", VALID, "else if (typeof ctx.variables[nombre] !== \"string\" || ctx.variables[nombre] === \"\") err(", "else if (false) err(", T_VALID),
    # --- Esquemas ----------------------------------------------------------------------------------------------------------------------------
    ("M45", "el tope de descuento deja de proteger (90 → 100)", ESQ, "export const MAX_PORCENTAJE = 90;", "export const MAX_PORCENTAJE = 100;", T_ESQ),
    ("M46", "la imagen estática puede venir de cualquier ruta o sitio", ESQ, "const SRC_ESTATICO = /^\\/catalogo\\/", "const SRC_ESTATICO = /^.*\\/catalogo\\/", T_ESQ),
    ("M47", "el borrador acepta claves de contaminación de prototipos", ESQ, "if (CLAVES_PROHIBIDAS.has(clave)) throw new BorradorInvalido(`Campo no permitido: ${clave}.`);", "", T_ESQ),
    ("M48", "el borrador acepta claves que no son del tipo", ESQ, "if (!permitidas.includes(clave)) return { ok: false, mensaje: `Campo no permitido: ${clave}.` };", "", T_ESQ + T_SERV),
    ("M49", "el valor de un canal que no aplica se acepta", ESQ, "if (!pideDetal && valores.detal !== undefined) ctx.addIssue(", "if (false) ctx.addIssue(", T_ESQ),
    ("M50", "el fin de una vigencia puede ser anterior al inicio", ESQ, "if (intervalo && intervalo.desde !== null && intervalo.hasta !== null && intervalo.hasta <= intervalo.desde) {", "if (false) {", T_ESQ),
    # --- Servicio: permisos, publicación, conflictos, restauración ---------------------------------------------------------------------------
    ("M51", "cualquier rol del equipo puede modificar la tienda (servicio)", SERV, "if (!CMS_ROLES_ESCRITURA.includes(actor.rol)) throw new CmsError(\"FORBIDDEN\", \"Solo un administrador puede modificar la tienda.\");", "", T_SERV),
    ("M52", "se publica sin validar", SERV, "if (!resultado.ok) throw new CmsError(\"NOT_PUBLISHABLE\", \"Corrige los problemas marcados antes de publicar.\", resultado.errores);", "", T_SERV + T_RUTAS),
    ("M53", "se publica con una revisión vieja del cliente", SERV, "if (e.rev !== input.rev) throw new CmsError(\"CONFLICT\", \"Otra persona cambió este elemento mientras lo editabas. Recarga la página para ver la versión más reciente.\");\n      const resultado = validar(e.tipo, e.borrador", "const resultado = validar(e.tipo, e.borrador", T_SERV + T_RUTAS),
    ("M54", "se publica la revisión nueva en vez de la que se validó", SERV, "revEsperada: e.rev, versionEsperada: e.versionActiva ?? 0, checksum: checksumDe(e.borrador)", "revEsperada: 0, versionEsperada: e.versionActiva ?? 0, checksum: checksumDe(e.borrador)", T_SERV),
    ("M55", "se restaura sin volver a validar", SERV, "if (bloqueos.length > 0) throw new CmsError(\"NOT_PUBLISHABLE\", \"Esa versión ya no se puede restaurar porque algo de lo que usaba cambió.\", bloqueos);", "", T_SERV),
    ("M56", "se restaura sin verificar el checksum", SERV, "if (checksumDe(v.contenido) !== v.checksum) throw", "if (false) throw", T_SERV),
    ("M57", "no hay tope de elementos por tipo (una sola página principal)", SERV, "if (existentes.length >= LIMITE_POR_TIPO[input.tipo]) {", "if (false) {", T_SERV),
    ("M58", "un archivado se puede publicar", SERV, "if (e.archivadaAt !== null) throw new CmsError(\"ARCHIVED\", \"Este elemento está archivado. Desarchívalo para poder publicarlo.\");", "", T_SERV),
    # --- Lector verificado -------------------------------------------------------------------------------------------------------------------
    ("M59", "el lector entrega contenido con checksum distinto", LECTOR, "if (checksumDe(e.contenido) !== e.checksum) {", "if (false) {", T_LECTOR),
    ("M60", "el lector entrega contenido que no cumple el esquema", LECTOR, "if (!parseo.success) {", "if (false) {", T_LECTOR),
    ("M61", "el lector entrega lo que no está publicado", LECTOR, "if (e.estado !== \"publicada\") {", "if (false) {", [C + "lector.test.ts"]),
    ("M62", "el lector ignora que el módulo esté apagado", REPO, "if (!r.habilitado) return null;", "", T_LECTOR),
    # --- Checksum ----------------------------------------------------------------------------------------------------------------------------
    ("M63", "el checksum depende del orden de las claves", C + "json-canonico.ts", "    .sort()\n", "", [C + "checksum.test.ts", C + "servicio.pglite.test.ts"]),
    # --- SQL: aislamiento, publicadas solamente, estados, permisos, inmutabilidad, auditoría -------------------------------------------------
    ("M64", "SQL: la lectura pública incluye lo PAUSADO", SQL, "where e.id_tenant = p_tenant and e.estado = 'publicada' and e.archivada_at is null), '[]'::jsonb),", "where e.id_tenant = p_tenant and e.estado in ('publicada', 'pausada') and e.archivada_at is null), '[]'::jsonb),", T_SQL + T_SERV),
    ("M65", "SQL: la lectura pública ignora si el módulo está habilitado", SQL, "if p_tenant is null or not exists (select 1 from public.dulabs_tenant_modulos m where m.id_tenant = p_tenant and m.modulo = 'cms_comercial' and m.habilitado) then", "if p_tenant is null then", T_SQL + T_SERV),
    ("M66", "SQL: la lectura pública incluye lo archivado", SQL, "where e.id_tenant = p_tenant and e.estado = 'publicada' and e.archivada_at is null), '[]'::jsonb),", "where e.id_tenant = p_tenant and e.estado = 'publicada'), '[]'::jsonb),", T_SQL),
    ("M67", "SQL: la lectura pública mezcla negocios", SQL, "where e.id_tenant = p_tenant and e.estado = 'publicada' and e.archivada_at is null), '[]'::jsonb),", "where e.estado = 'publicada' and e.archivada_at is null), '[]'::jsonb),", T_SQL + T_SERV),
    ("M68", "SQL: publicar ignora la revisión y la versión esperadas", SQL, "if e.rev <> p_rev_esperada or coalesce(e.version_activa, 0) <> p_version_esperada then", "if false then", T_SQL + T_SERV),
    ("M69", "SQL: guardar borrador ignora la revisión esperada", SQL, "if e.rev <> p_rev_esperada then return jsonb_build_object('resultado', 'conflicto', 'rev', e.rev, 'version_activa', e.version_activa); end if;", "", T_SQL + T_SERV),
    ("M70", "SQL: publicar no deja auditoría", SQL, "perform public.dulabs_cms_auditar(e.id_tenant, e.tipo, e.id, 'publicar', v_nueva, p_nota, v_antes, e.borrador, p_actor, p_etiqueta);", "", T_SQL + T_SERV),
    ("M71", "SQL: las versiones se pueden editar o borrar", SQL, "create trigger dulabs_cms_versiones_inmutable\n  before update or delete on public.dulabs_cms_versiones\n  for each row execute function public.dulabs_cms_inmutable();", "", T_SQL),
    ("M72", "SQL: un elemento de otro negocio se puede bloquear y modificar", SQL, "select * into v_fila from public.dulabs_cms_entidades where id = p_id and id_tenant = p_tenant for update;", "select * into v_fila from public.dulabs_cms_entidades where id = p_id for update;", T_SQL + T_SERV),
    ("M73", "SQL: obtener un elemento no filtra por negocio", SQL, "   where e.id = p_id and e.id_tenant = p_tenant;\n$$;\n\n-- Registro de auditoría", "   where e.id = p_id;\n$$;\n\n-- Registro de auditoría", T_SQL + T_SERV),
    ("M74", "SQL: listar mezcla negocios", SQL, "   where e.id_tenant = p_tenant\n     and (p_tipo is null or e.tipo = p_tipo)", "   where (p_tipo is null or e.tipo = p_tipo)", T_SQL + T_SERV),
    ("M75", "SQL: anon puede ejecutar las funciones", SQL, "      execute format('revoke all on function %s from anon', r.firma);", "", T_SQL),
    ("M76", "SQL: se puede pausar lo que no está publicado", SQL, "  if e.estado <> 'publicada' then return jsonb_build_object('resultado', 'estado_invalido', 'estado', e.estado); end if;\n  update public.dulabs_cms_entidades set estado = 'pausada'", "  update public.dulabs_cms_entidades set estado = 'pausada'", T_SQL + T_SERV),
    ("M77", "SQL: se puede archivar lo que está en vivo", SQL, "  if e.estado <> 'borrador' then return jsonb_build_object('resultado', 'estado_invalido', 'estado', e.estado); end if;\n  if e.archivada_at is not null", "  if e.archivada_at is not null", T_SQL + T_SERV),
    ("M78", "SQL: una ruta de imagen puede escapar con «..»", SQL, " and storage_path !~ '\\.\\.'", "", T_SQL),
    ("M79", "SQL: despublicar pierde el contenido que estaba en vivo", SQL, "borrador = coalesce(e.borrador, v_activo), rev = e.rev + 1", "borrador = e.borrador, rev = e.rev + 1", T_SQL + T_SERV),
    ("M80", "SQL: restaurar copia el contenido equivocado", SQL, "values (e.id_tenant, e.id, v_nueva, v.contenido, v.checksum, 'restaurar', p_version, p_nota, p_actor, p_etiqueta);", "values (e.id_tenant, e.id, v_nueva, coalesce(e.borrador, v.contenido), v.checksum, 'restaurar', p_version, p_nota, p_actor, p_etiqueta);", T_SQL + T_SERV),
    # --- Autorización y rutas ----------------------------------------------------------------------------------------------------------------
    ("M81", "el agente y el de lectura pueden modificar (autorización)", AUTH, "const roles = input.mode === \"write\" ? CMS_ROLES_ESCRITURA : CMS_ROLES_LECTURA;", "const roles = CMS_ROLES_LECTURA;", T_AUTH),
    ("M82", "un negocio sin el módulo puede usar la API", AUTH, "if (!input.moduleEnabled) {", "if (false) {", T_AUTH),
    ("M83", "si falla la verificación del módulo, se permite", AUTH, "    return { ok: false, response: apiError(\"INTERNAL_ERROR\", \"No se pudo verificar el acceso a la administración de la tienda.\", 500) };\n  }\n\n  const decision", "    moduleEnabled = true;\n  }\n\n  const decision", T_AUTH),
    ("M84", "se acepta un cuerpo gigante", HTTP, "if (texto.length > MAX_CUERPO_CMS) return", "if (false) return", T_RUTAS),
    ("M85", "un id que no es UUID llega a la base", HTTP, "if (!uuid.safeParse(id).success) return", "if (false) return", T_RUTAS),
    ("M86", "un error interno se filtra al cliente", HTTP, "return apiError(\"INTERNAL_ERROR\", \"No se pudo completar la operación de la tienda.\", 500);\n}\n\n/** Tope", "return apiError(\"INTERNAL_ERROR\", String(err instanceof Error ? err.message : err), 500);\n}\n\n/** Tope", T_RUTAS),
    ("M87", "se aceptan acciones de estado que no existen", RUTA_ACCION, "    if (!esAccionDeEstado(accion)) return apiError(\"NOT_FOUND\", \"Esa acción no existe.\", 404);\n", "", T_RUTAS),
    # --- PR 2 · imágenes: verificación y re-codificación en el servidor ---------------------------------------------------------------------
    ("M88", "una imagen de más de 6 MB se acepta", IMG_SRV, '  if (entrada.byteLength > MAX_BYTES_SUBIDA) throw new ImagenInvalida("La imagen supera el tamaño máximo permitido (6 MB).");\n', "", T_IMG_SRV),
    ("M89", "se acepta cualquier archivo que la librería sepa leer (GIF, SVG…), no solo JPG, PNG y WebP", IMG_SRV, "  if (!formato) throw new ImagenInvalida(NO_ES_IMAGEN);\n", "", T_IMG_SRV),
    ("M90", "no hay límite de píxeles (bomba de descompresión)", IMG_SRV, "limitInputPixels: MAX_PIXELES", "limitInputPixels: false", T_IMG_SRV),
    ("M91", "se aceptan imágenes animadas", IMG_SRV, '  if ((meta.pages ?? 1) > 1) throw new ImagenInvalida("No se admiten imágenes animadas. Sube una imagen fija.");\n', "", T_IMG_SRV),
    ("M92", "se aceptan imágenes diminutas", IMG_SRV, "if (width < LADO_MINIMO || height < LADO_MINIMO) throw", "if (false) throw", T_IMG_SRV),
    ("M93", "la imagen publicada conserva los metadatos (ubicación, autor…)", IMG_SRV, "      .webp({ quality: 86 })", "      .keepMetadata()\n      .webp({ quality: 86 })", T_IMG_SRV),
    ("M94", "la imagen publicada no se reduce de tamaño", IMG_SRV, '      .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: "inside", withoutEnlargement: true })\n', "", T_IMG_SRV),
    ("M95", "no se aplica la orientación EXIF (fotos de celular de lado)", IMG_SRV, "      .rotate() // aplica la orientación EXIF antes de descartar los metadatos\n", "", T_IMG_SRV),
    ("M96", "una imagen pequeña se amplía", IMG_SRV, "withoutEnlargement: true", "withoutEnlargement: false", T_IMG_SRV),
    # --- PR 2 · servicio de imágenes ----------------------------------------------------------------------------------------------------------
    ("M97", "un agente o una persona de solo lectura puede pedir una subida", IMGS, "    async solicitarSubida(actor, input) {\n      exigirEscritura(actor);\n", "    async solicitarSubida(actor, input) {\n", T_IMGS),
    ("M98", "un agente o una persona de solo lectura puede confirmar una imagen", IMGS, "    async confirmar(actor, id) {\n      exigirEscritura(actor);\n", "    async confirmar(actor, id) {\n", T_IMGS),
    ("M99", "se aceptan tipos que no son JPG, PNG o WebP", IMGS, '      if (!(TIPOS_SUBIDA as readonly string[]).includes(input.mimeType)) throw new CmsError("VALIDATION_ERROR", "Usa una imagen JPG, PNG o WebP.");\n', "", T_IMGS),
    ("M100", "se acepta declarar más de 6 MB", IMGS, '      if (input.bytes > MAX_BYTES_SUBIDA) throw new CmsError("VALIDATION_ERROR", "La imagen supera el tamaño máximo permitido (6 MB).");\n', "", T_IMGS),
    ("M101", "no hay tope de imágenes por negocio", IMGS, "if ((await repo.listarAssets(actor.tenantId, 500)).length >= LIMITE_IMAGENES) {", "if (false) {", T_IMGS),
    ("M102", "las imágenes se guardan SIN la carpeta del negocio", IMGS, "({ final: `${tenantId}/cms/${id}/imagen.webp`, temporal: `${tenantId}/cms/${id}/subida` })", "({ final: `cms/${id}/imagen.webp`, temporal: `cms/${id}/subida` })", T_IMGS),
    ("M103", "al confirmar se guarda lo subido tal cual, sin re-codificar", IMGS, "await almacen.escribir(final, procesada.bytes, procesada.mimeType);", 'await almacen.escribir(final, origen, "image/png");', T_IMGS),
    ("M104", "la subida temporal no se borra al confirmar", IMGS, "      await almacen.escribir(final, procesada.bytes, procesada.mimeType);\n      await almacen.borrar([temporal]);\n", "      await almacen.escribir(final, procesada.bytes, procesada.mimeType);\n", T_IMGS),
    ("M105", "un archivo rechazado queda guardado en Storage", IMGS, "      } catch (err) {\n        await almacen.borrar([temporal]);\n        if (err instanceof ImagenInvalida)", "      } catch (err) {\n        if (err instanceof ImagenInvalida)", T_IMGS),
    ("M106", "se confirma una imagen cuya ruta no es la del negocio y el id", IMGS, 'if (asset.storagePath !== final) throw new CmsError("INTERNAL_ERROR", "No se pudo verificar la imagen. Intenta de nuevo.");', "", T_IMGS),
    ("M107", "confirmar dos veces vuelve a procesar la imagen", IMGS, 'if (asset.estado === "listo") return vista(asset); // confirmar dos veces es idempotente', "", T_IMGS),
    # --- PR 2 · productos y contexto (lectura para el editor) ---------------------------------------------------------------------------------
    ("M108", "una consulta de productos acepta cualquier cantidad de referencias", RUTA_PROD, '      if (referencias.length > MAX_REFERENCIAS) return apiError("VALIDATION_ERROR", `Máximo ${MAX_REFERENCIAS} referencias por consulta.`, 400);\n', "", T_EDITOR),
    ("M109", "las referencias mal escritas llegan al catálogo", RUTA_PROD, '      if (!referencias.every(isReference)) return apiError("VALIDATION_ERROR", "Una de las referencias no tiene un formato válido (por ejemplo DL-000184).", 400);\n', "", T_EDITOR),
    ("M110", "el texto de búsqueda llega al catálogo sin limpiar", RUTA_PROD, 'normalizeSearch(q.data.q) ?? ""', 'q.data.q ?? ""', T_EDITOR),
    ("M111", "una variable sin configurar se inventa un valor vacío en vez de «sin valor»", RUTA_CTX, "valor: vars.variables[id] ?? null", 'valor: vars.variables[id] ?? ""', T_EDITOR),
    ("M112", "la búsqueda de productos ofrece también los inactivos", ADAPT, 'status: "ACTIVE", offset: 0', "offset: 0", T_EDITOR),
    ("M113", "un precio en cero se toma como un precio válido", ADAPT, "v > 0 ? v : null", "v >= 0 ? v : null", T_EDITOR),
    ("M114", "un producto inactivo se informa como activo", ADAPT, 'activo: p.status === "ACTIVE",', "activo: true,", T_EDITOR),
    # --- PR 2 · cliente del navegador ---------------------------------------------------------------------------------------------------------
    ("M115", "las llamadas no llevan la sesión", CLIENTE, "headers: { Authorization: `Bearer ${accessToken}`, ", "headers: { ", T_CLIENTE),
    ("M116", "guardar un borrador no manda la revisión que se editó", CLIENTE, "body: JSON.stringify({ borrador, rev })", "body: JSON.stringify({ borrador })", T_CLIENTE),
    ("M117", "los problemas de validación no llegan a la pantalla", CLIENTE, 'const problemas = typeof err === "object" ? err?.diagnostics?.problemas : undefined;', "const problemas = undefined;", T_CLIENTE),
    ("M118", "un 200 sin datos se da por bueno", CLIENTE, "respuesta.ok && cuerpo.success && cuerpo.data !== undefined", "respuesta.ok && cuerpo.success", T_CLIENTE),
    ("M119", "se confirma la imagen aunque Storage haya fallado", CLIENTE, "      if (!subida.ok) return subida;\n", "", T_CLIENTE),
    ("M120", "no se avisa de la etapa «confirmando»", CLIENTE, '      opts.onEtapa?.("confirmando");\n', "", T_CLIENTE),
    ("M121", "una foto de más de 5,5 MB se sube sin comprimir", CLIENTE, "if (archivo.size <= MAX_BYTES_SIN_COMPRIMIR) return", "if (archivo.size < MAX_BYTES_SIN_COMPRIMIR) return", T_CLIENTE),
    ("M122", "el navegador acepta cualquier tipo de archivo como imagen", CLIENTE, "if (!(TIPOS_IMAGEN_PERMITIDOS as readonly string[]).includes(archivo.type)) throw", "if (false) throw", T_CLIENTE),
    ("M123", "el límite de solicitudes se muestra como un error desconocido", CLIENTE, 'respuesta.status === 429 ? "RATE_LIMITED" : "UNKNOWN"', '"UNKNOWN"', T_CLIENTE),
    ("M124", "se sigue la subida aunque el servidor no haya dado la URL firmada", CLIENTE, "      if (!ticket.ok) return ticket;\n", "", T_CLIENTE),
    # --- PR 2 · ayudantes puros del editor ----------------------------------------------------------------------------------------------------
    ("M125", "borrar un campo deja la clave vacía en el borrador", BORR, "      if (esVacio(valor)) delete copia[paso];\n      else copia[paso] = valor;", "      copia[paso] = valor;", T_BORR),
    ("M126", "cambiar un campo modifica el borrador anterior (no es una copia)", BORR, "const copia: Record<string, unknown> = { ...(esObjeto(actual) ? actual : {}) };", "const copia: Record<string, unknown> = (esObjeto(actual) ? actual : {}) as Record<string, unknown>;", T_BORR),
    ("M127", "«subir» baja y «bajar» sube", BORR, "const destino = indice + delta;", "const destino = indice - delta;", T_BORR),
    ("M128", "«750.000» se lee como 750", BORR, r'''return Number(limpio.replace(/[.\s$]/g, "").replace(",", "."));''', r'''return Number(limpio.replace(/[\s$]/g, "").replace(",", "."));''', T_BORR),
    ("M129", "dos borradores iguales para el servidor se ven como distintos", BORR, "if (na.ok && nb.ok) return", "if (false) return", T_BORR),
    ("M130", "un borrador nuevo se marca «Cambios sin publicar»", FORMATO, 'if (r.tieneCambios && r.estado !== "borrador") chips.push', "if (r.tieneCambios) chips.push", T_BORR),
    ("M131", "un borrador se marca «Vencida» o «Programada»", FORMATO, '  if (r.estado !== "borrador") {\n    if (r.estadoVigencia === "vencida")', '  if (true) {\n    if (r.estadoVigencia === "vencida")', T_BORR),
    ("M132", "los pesos del historial salen como números sueltos", FORMATO, r'''if (CAMPOS_PESOS.test(ruta) && !/(^|\.)cantidad$/.test(ruta)) return formatearPesos(v);''', "", T_BORR),
    ("M133", "las secciones ocultas cuentan como cambios en el historial", FORMATO, ".filter((s) => esObjeto(s) && s.visible === true)", ".filter((s) => esObjeto(s))", T_BORR),
    ("M134", "una imagen nueva siempre cuenta el punto focal por defecto como cambio", FORMATO, '    if (ruta.endsWith(".foco") && ((va === undefined && vd === "50% 50%") || (vd === undefined && va === "50% 50%"))) continue;\n', "", T_BORR),
    ("M135", "los datos técnicos de la imagen salen en el historial", FORMATO, r'''const RUIDO = /(^|\.)imagen\.(origen|src|ancho|alto)$/;''', "const RUIDO = /$^/;", T_BORR),
    ("M136", "el historial muestra el código interno de la imagen", FORMATO, 'const esImagen = ruta.endsWith(".asset");', "const esImagen = false;", T_BORR),
    ("M137", "el historial muestra el código de la categoría en vez de su nombre", FORMATO, 'const legible = conocido ?? v.split(", ").map((x) => categorias.get(x) ?? x).join(", ");', "const legible = conocido ?? v;", T_BORR),
    ("M138", "el historial de un combo repite una fila por clave interna", FORMATO, "copia.componentes = contenido.componentes.map((c) => (esObjeto(c) ? `${c.cantidad ?? 1} × ${c.referencia}` : String(c)));", "copia.componentes = contenido.componentes;", T_BORR),
    ("M139", "la vista previa de una oferta detal muestra precios mayoristas", PREVIA, "for (const canal of canalesDe(o.modalidad)) {", 'for (const canal of canalesDe("ambas")) {', T_PREVIA),
    ("M140", "la vista previa de un combo detal muestra el canal mayorista", PREVIA, "porCanal: canalesDe(c.modalidad).map((canal) => {", 'porCanal: canalesDe("ambas").map((canal) => {', T_PREVIA),
    ("M141", "la vista previa muestra todos los ejemplos, sin tope", PREVIA, "if (ejemplos.filter((e) => e.canal === canal).length < maxEjemplos)", "if (true)", T_PREVIA),
    ("M142", "la vista previa de una oferta incluye productos a los que no alcanza", PREVIA, "const enAlcance = muestra.filter((p) => ofertaAlcanzaProducto(o, { referencia: p.referencia, categoriaId: p.categoriaId, precioLista: null }));", "const enAlcance = [...muestra];", T_PREVIA),
    # --- PR 2 · pantalla (jsdom contra la API y el SQL reales) --------------------------------------------------------------------------------
    ("M143", "se publica una revisión vieja (no la que se validó)", EDITOR, "const r = await client.publicar(id, detalle.rev, nota.trim() || null);", "const r = await client.publicar(id, 0, nota.trim() || null);", T_DOM),
    ("M144", "se revisa o se publica sin guardar antes lo que se está editando", EDITOR, "if (canWrite && sucio && (await guardar()) === null) return null;", "if (false) return null;", T_DOM),
    ("M145", "la pantalla no se entera de que hay cambios sin guardar", EDITOR, "!mismoContenido(detalle.tipo, borrador, detalle.contenido)", "false", T_DOM),
    ("M146", "un enlace del menú con cambios sin guardar navega sin avisar", EDITOR, "      e.preventDefault();\n      e.stopPropagation();\n      setDestinoPendiente(", "      setDestinoPendiente(", T_DOM),
    ("M147", "se puede restaurar una versión con cambios sin guardar (se perderían)", EDITOR, "bloqueadoPor={sucio ?", "bloqueadoPor={false ?", T_DOM),
    ("M148", "al cambiar a «Solo detal» quedan valores mayoristas ocultos", FORMS, "  if (modalidad === \"detal\") poner(`${rutaValores}.mayorista`, undefined);\n", "", T_DOM),
    ("M149", "un botón nuevo no guarda el destino que muestra la pantalla", FORMS, 'destino: actual?.destino ?? { tipo: "catalogo" }', "destino: actual?.destino", T_DOM),
    ("M150", "apagar un banner sin imagen deja un banner roto en el borrador", FORMS, '            else poner("banner", undefined);\n', '            else poner("banner.visible", false);\n', T_DOM),
    ("M151", "insertar una variable escribe una variable que no existe", FORMS, "{{${id}}}", "{${id}}", T_DOM),
    ("M152", "escribir en un diálogo le quita el foco al campo", UI_BASE, "  }, [abierto]);\n  if (!abierto) return null;", "  }, [abierto, onCerrar]);\n  if (!abierto) return null;", T_DOM),
    ("M153", "Escape no cierra los diálogos", UI_BASE, '      if (e.key === "Escape") {\n        cerrar.current();\n        return;\n      }\n', "", T_DOM),
    ("M154", "un diálogo de confirmación enfoca el botón que confirma", UI_BASE, '"[data-acciones] button:not([disabled])"', '"[data-acciones] button:not([disabled]):last-of-type"', T_DOM),
    ("M155", "Tab se sale del diálogo", UI_BASE, '      if (e.key !== "Tab" || !dialogo) return;\n', "      return;\n", T_DOM),
    ("M156", "la búsqueda en la lista distingue las tildes", LISTA, r'''s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()''', 's.normalize("NFD").toLowerCase()', T_DOM),
    ("M157", "un contenido nuevo se crea sin su título", LISTA, '{ ...borradorInicial(tipo), [tipo === "contenido" ? "titulo" : "nombre"]: nombre }', "{ ...borradorInicial(tipo), nombre }", T_DOM),
    ("M158", "restaurar pide siempre la versión 1 en vez de la elegida", PANELES, "client.restaurar(id, aRestaurar.version, nota.trim() || null)", "client.restaurar(id, 1, nota.trim() || null)", T_DOM),
    ("M159", "las versiones se listan de la más vieja a la más nueva", PANELES, "setVersiones([...r.data.versiones].sort((a, b) => b.version - a.version));", "setVersiones([...r.data.versiones].sort((a, b) => a.version - b.version));", T_DOM),
    # --- PR 3 · de lo publicado a la vitrina ---------------------------------------------------------------------------------------------------
    ("M160", "la tienda de tecnología deja de ser intocable para el CMS", VIT, 'if (registro.tema === "tecnologia" || snap.home === null) return registro;', "if (snap.home === null) return registro;", T_VIT),
    ("M161", "sin página principal publicada se arma una vitrina vacía en vez de devolver el registro", VIT, 'if (registro.tema === "tecnologia" || snap.home === null) return registro;', 'if (registro.tema === "tecnologia") return registro;', T_VIT),
    ("M162", "una imagen del CMS sin medidas válidas se muestra", VIT, "if (!asset || !(asset.ancho > 0) || !(asset.alto > 0)) return null;", "if (!asset) return null;", T_VIT),
    ("M163", "una imagen del CMS que no está lista se muestra", VIT, "if (!asset || !(asset.ancho > 0) || !(asset.alto > 0)) return null;", "if (false) return null;", T_VIT),
    ("M164", "la imagen del CMS sale con la dirección de Storage", VIT, "src: rutaImagenCms(slug, asset.id),", "src: asset.storagePath,", T_VIT),
    ("M165", "la imagen toma las medidas del contenido en vez de las del archivo", VIT, "width: asset.ancho, height: asset.alto,", "width: 1600, height: 900,", T_VIT),
    ("M166", "un botón a una categoría borrada se muestra", VIT, "ctx.categorias.has(destino.categoria_id) ?", "true ?", T_VIT),
    ("M167", "la búsqueda del botón no se codifica", VIT, "encodeURIComponent(destino.consulta.trim())", "destino.consulta.trim()", T_VIT),
    ("M168", "una búsqueda vacía lleva a un enlace", VIT, 'destino.consulta.trim() === "" ? null :', "false ? null :", T_VIT),
    ("M169", "un número de WhatsApp demasiado corto se usa", VIT, "digitos.length >= 8 && digitos.length <= 15", "digitos.length >= 1 && digitos.length <= 15", T_VIT),
    ("M170", "un número de WhatsApp absurdamente largo se usa", VIT, "digitos.length >= 8 && digitos.length <= 15", "digitos.length >= 8 && digitos.length <= 99", T_VIT),
    ("M171", "un botón a ofertas lleva a una sección que la tienda no dibuja", VIT, 'dibujadas.includes("ofertas") && ofertasActivas(ev)', "ofertasActivas(ev)", T_VIT),
    ("M172", "un botón a una oferta inexistente lleva a la sección", VIT, ".some((o) => o.clave === destino.clave)", ".some(() => true)", T_VIT),
    ("M173", "un botón a un combo inexistente lleva a la sección", VIT, "combosActivos(ev).some((c) => c.clave === destino.clave)", "combosActivos(ev).some(() => true)", T_VIT),
    ("M174", "un botón a una campaña inexistente lleva a la sección", VIT, "campanasActivas(ev).some((c) => c.clave === destino.clave)", "campanasActivas(ev).some(() => true)", T_VIT),
    ("M175", "la portada oculta (visible: false) se muestra", VIT, 'h.portada.visible && se("portada") ?', 'se("portada") ?', T_VIT),
    ("M176", "la portada con su sección apagada se muestra", VIT, 'h.portada.visible && se("portada") ?', "h.portada.visible ?", T_VIT),
    ("M177", "un botón cuyo destino desapareció sigue mostrando su texto", VIT, 'config.heroCta = h.portada.boton && href ? h.portada.boton.texto : "";', 'config.heroCta = h.portada.boton ? h.portada.boton.texto : "";', T_VIT),
    ("M178", "un banner oculto se muestra", VIT, 'h.banner && h.banner.visible && se("banner")', 'h.banner && se("banner")', T_VIT),
    ("M179", "se piden secciones que la tienda no sabe dibujar", VIT, "visibles.filter((s) => dibujadas.includes(s))", "visibles", T_VIT),
    ("M180", "los destacados elegidos pasan aunque su sección esté apagada", VIT, 'if (secciones.includes("destacados") && h.productos_destacados.length > 0)', "if (h.productos_destacados.length > 0)", T_VIT),
    ("M181", "las categorías elegidas pasan aunque su sección esté apagada", VIT, 'if (secciones.includes("categorias") && h.categorias_destacadas.length > 0)', "if (h.categorias_destacadas.length > 0)", T_VIT),
    ("M182", "la campaña se elige para el canal mayorista", VIT, 'const ev: ContextoEvaluacion = { snap, canal: "retail", ahora: ctxEntrada.ahora };', 'const ev: ContextoEvaluacion = { snap, canal: "wholesale", ahora: ctxEntrada.ahora };', T_VIT),
    ("M183", "una campaña sin portada ni productos ocupa el lugar de otra con contenido", VIT, "return campanasActivas(ev).find((c) => c.contenido.portada || c.contenido.productos_destacados.length > 0);", "return campanasActivas(ev)[0];", T_VIT),
    ("M184", "la portada de la campaña ignora la imagen de la campaña", VIT, "p.imagen ?? c.contenido.imagen", "p.imagen", T_VIT),
    ("M185", "la imagen de la portada de una campaña no figura entre las publicadas", VIT, "    ver(c.contenido.portada?.imagen);\n", "", T_VIT + T_IMGPUB),
    ("M186", "la imagen del banner no figura entre las publicadas", VIT, "    ver(snap.home.contenido.banner?.imagen);\n", "", T_VIT + T_IMGPUB),
    # --- PR 3 · carga con respaldo -------------------------------------------------------------------------------------------------------------
    ("M187", "la tienda de tecnología consulta el CMS", VITPUB, 'if (registro.tema === "tecnologia") return deSiempre(registro);', "", T_VITPUB),
    ("M188", "se lee el CMS de «ningún negocio»", VITPUB, "const snap = tenantId ? await deps.cargar(tenantId) : null;", 'const snap = await deps.cargar(tenantId ?? "");', T_VITPUB),
    ("M189", "un CMS apagado se trata como una falla", VITPUB, "    if (!leido) return deSiempre(registro);\n", "", T_VITPUB),
    ("M190", "la vitrina del respaldo dice venir del CMS", VITPUB, 'origen: "cms" };', 'origen: "registro" };', T_VITPUB),
    ("M191", "una lectura lenta deja la tienda esperando el plazo largo", VITPUB, "deps.plazoMs ?? PLAZO_VITRINA_MS,", "PLAZO_VITRINA_MS,", T_VITPUB),
    ("M192", "un aviso que falla rompe la tienda", VITPUB, "  } catch {\n    /* el aviso nunca puede romper la tienda */\n  }\n", "  } finally {\n  }\n", T_VITPUB),
    ("M193", "una lista vacía de destacados se pide al catálogo", VITPUB, "config.destacados && config.destacados.length > 0 ?", "config.destacados ?", T_VITPUB),
    # --- PR 3 · imagen pública ------------------------------------------------------------------------------------------------------------------
    ("M194", "la ruta de imágenes acepta nombres con algo después de .webp", IMGPUB, r"\.webp$/;", r"\.webp/;", T_IMGPUB),
    ("M195", "la ruta de imágenes acepta nombres con algo antes del id", IMGPUB, "const ARCHIVO = /^(", "const ARCHIVO = /(", T_IMGPUB),
    ("M196", "una instantánea de otro negocio se sirve", IMGPUB, "if (!snap || snap.tenantId !== tenantId) return noEncontrada();", "if (!snap) return noEncontrada();", T_IMGPUB),
    ("M197", "una imagen subida pero no publicada (borrador) se sirve", IMGPUB, "if (!asset || asset.id !== id || !assetsReferenciados(snap).has(id)) return noEncontrada();", "if (!asset || asset.id !== id) return noEncontrada();", T_IMGPUB),
    ("M198", "una imagen guardada en la carpeta de otro negocio se sirve", IMGPUB, "!asset.storagePath.startsWith(`${tenantId}/cms/`) || ", "", T_IMGPUB),
    ("M199", "una ruta con «..» se sirve", IMGPUB, ' || asset.storagePath.includes("..")', "", T_IMGPUB),
    ("M200", "un objeto que no está en Storage rompe la ruta", IMGPUB, "    if (!imagen) return noEncontrada();\n", "", T_IMGPUB),
    ("M201", "una falla interna de imagen se cachea", IMGPUB, 'headers: { "Cache-Control": "no-store" } }', 'headers: { "Cache-Control": "public, max-age=60" } }', T_IMGPUB),
    # --- PR 3 · el inicio con lo que elige el CMS --------------------------------------------------------------------------------------------------
    ("M202", "un destacado desactivado aparece en el inicio", SERVICE, '    const found = await repo.getProductsByReferences(tenantId, references);\n    const byReference = new Map(found.filter((p) => p.status === "ACTIVE")', "    const found = await repo.getProductsByReferences(tenantId, references);\n    const byReference = new Map(found", T_HOME),
    ("M203", "destacados elegidos que no sirven dejan el inicio sin productos", SERVICE, 'if (items.length > 0) return { items, policy: "cms" };', 'return { items, policy: "cms" };', T_HOME),
    ("M204", "los destacados elegidos no tienen tope", SERVICE, "normalizeReferences(raw).slice(0, limit)", "normalizeReferences(raw)", T_HOME),
    ("M205", "sin categorías válidas el inicio queda sin categorías", SERVICE, "chosen.length > 0 ? chosen : categories", "chosen", T_HOME),
    ("M206", "una categoría repetida sale dos veces", SERVICE, "[...new Set(opciones.categorias ?? [])]", "(opciones.categorias ?? [])", T_HOME),
    ("M207", "el inicio trae una campaña aunque nadie la pidió", SERVICE, "...(campaignItems ? { campana: pick(campaignItems) } : {}),", "campana: pick(campaignItems ?? []),", T_HOME),
    ("M208", "una lista vacía de campaña cuenta como campaña pedida", SERVICE, "(opciones.campana?.length ?? 0) > 0", "opciones.campana !== undefined", T_HOME),
    ("M209", "el negocio de una tienda sin publicar se entrega", SERVICE, "return (await openPublication(slug))?.tenantId ?? null;", "return (await repo.getPublicationBySlug(slug))?.tenantId ?? null;", T_HOME),
    # --- PR 3 · el dibujo de las secciones -----------------------------------------------------------------------------------------------------------
    ("M210", "una portada sin botón dibuja igual el botón", INICIO, 'hero.cta !== "" && (', "true && (", T_INICIO),
    ("M211", "el botón de la portada ignora su destino", INICIO, "hero.href ?? listPath", "listPath", T_INICIO),
    ("M212", "los enlaces externos (WhatsApp) no abren en pestaña nueva", INICIO, 'if (href.startsWith("https://")) {', "if (false) {", T_INICIO),
    ("M213", "los enlaces externos dejan el control a la otra página", INICIO, 'rel="noopener noreferrer"', 'rel="opener"', T_INICIO),
    ("M214", "sin lista de secciones se usa otro orden que el de siempre", INICIO, "config.secciones ?? ORDEN_INICIO_CLASICO", 'config.secciones ?? ["portada", "destacados"]', T_INICIO),
    ("M215", "una campaña sin portada ni productos dibuja un bloque vacío", INICIO, "if (!portada && productos.length === 0) return null;", "", T_INICIO),
    ("M216", "con la portada apagada la página se queda sin título principal", INICIO, '!hero || !secciones.includes("portada") ?', "!hero ?", T_INICIO),
    ("M217", "el banner con destino no es un enlace", INICIO, "{config.bannerHref ? (", "{false ? (", T_INICIO),
    # --- PR 3 · la siembra de la vitrina actual (SQL real) -------------------------------------------------------------------------------------------
    ("M218", "la siembra corre aunque la tienda esté duplicada o no exista", SQL_SIEMBRA, "  if v_tienda <> 1 then\n", "  if false then\n", T_SIEMBRA),
    ("M219", "la siembra corre con el módulo apagado", SQL_SIEMBRA, "  if not exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'cms_comercial' and habilitado) then\n", "  if false then\n", T_SIEMBRA),
    ("M220", "la siembra pisa o duplica una página principal existente", SQL_SIEMBRA, "  if exists (select 1 from public.dulabs_cms_entidades where id_tenant = v_tenant and tipo = 'home') then\n", "  if false then\n", T_SIEMBRA),
    ("M221", "la siembra se publica esperando una versión que no existe", SQL_SIEMBRA, "::integer, 0, '", "::integer, 1, '", T_SIEMBRA),
    ("M222", "la reversa despublica aunque la administradora ya publicó cambios", SQL_REVERSA, "  if coalesce(v_e.version_activa, 0) > 1 and coalesce(current_setting('dulabs.confirmar_reversa_siembra', true), '') <> 'si' then\n", "  if false then\n", T_SIEMBRA),
    ("M223", "la reversa intenta despublicar lo que no está publicado", SQL_REVERSA, "  if v_e.estado not in ('publicada', 'pausada') then\n", "  if false then\n", T_SIEMBRA),
    ("M224", "la siembra de Delacour siembra un banner que no existe", SIEMBRA, "...(banner ? { banner: { visible: true, imagen: estatica(banner) } } : {}),", "banner: { visible: true, imagen: estatica(banner as StorefrontImage) },", T_SIEMBRA_GEN),
    ("M225", "la siembra deja las secciones de ofertas, combos y campaña encendidas", SIEMBRA, 'const visibles = new Set<string>(["portada", "categorias", "destacados", ...(banner ? ["banner"] : [])]);', 'const visibles = new Set<string>(["portada", "categorias", "destacados", "ofertas", "combos", "campana", ...(banner ? ["banner"] : [])]);', T_SIEMBRA_GEN),
    ("M226", "el script de siembra admite un slug con comillas", SIEMBRA, 'const nombre = slug.replace(/[^a-z0-9-]/g, "");\n  if (nombre !== slug || slug === "") throw new Error("Slug no válido para el script SQL.");\n  const titulo = slug.charAt(0).toUpperCase() + slug.slice(1);\n  return `-- CMS COMERCIAL (Bloque 29) — SEMBRAR', 'const titulo = slug.charAt(0).toUpperCase() + slug.slice(1);\n  return `-- CMS COMERCIAL (Bloque 29) — SEMBRAR', T_SIEMBRA_GEN),
    # --- PR 3 · avisos y enlace del editor -----------------------------------------------------------------------------------------------------------
    ("M227", "no avisa que la página no tiene ninguna sección visible", VALID, "if (!h.secciones.some((s) => s.visible)) adv(", "if (false) adv(", T_VALID),
    ("M228", "no avisa que la portada visible tiene su sección apagada", VALID, 'h.portada.imagen && !visible("portada")', 'h.portada.imagen && visible("portada")', T_VALID),
    ("M229", "no avisa que el banner visible tiene su sección apagada", VALID, 'h.banner?.visible && !visible("banner")', 'h.banner?.visible && visible("banner")', T_VALID),
    ("M230", "no avisa que la sección del banner no tiene banner", VALID, 'visible("banner") && !h.banner', 'visible("banner") && h.banner', T_VALID),
    ("M231", "«Ver mi tienda» lleva a una tienda sin publicar", ADAPT, "return publicacion?.published ? retailPath(publicacion.slug) : null;", "return publicacion ? retailPath(publicacion.slug) : null;", T_EDITOR),
    ("M232", "una falla al buscar la tienda rompe el contexto del editor", RUTA_CTX, ".then((r) => r ?? null, () => null)", ".then((r) => r ?? null)", T_EDITOR),
    ("M233", "«Ver mi tienda» deja el control a la otra página", TIENDA_APP, 'rel="noopener noreferrer" className={cn(actionBtn, "text-[13px]")}', 'className={cn(actionBtn, "text-[13px]")}', T_DOM),
    # --- PR 4 · la decisión del precio efectivo (una sola para lo que se muestra, se firma y se cobra) ---------------------------------------------------
    ("M234", 'una oferta evaluada sobre OTRO precio de lista se aplica', PRECIOS, 'efectivo.precioLista === lista && ', '', T_DECISION),
    ("M235", 'una oferta puede dejar el precio en cero', PRECIOS, 'efectivo.precio >= 1 && ', '', T_DECISION),
    ("M236", 'una «oferta» que deja el mismo precio de lista rige', PRECIOS, 'efectivo.precio < lista) {', 'efectivo.precio <= lista) {', T_DECISION),
    ("M237", 'una oferta con un precio con decimales rige', PRECIOS, 'Number.isInteger(efectivo.precio) && ', '', T_DECISION),
    ("M238", 'un precio sin oferta reemplaza al de lista', PRECIOS, 'if (efectivo && oferta !== null && ', 'if (efectivo && ', T_DECISION),
    ("M239", 'el precio de lista se toma del otro canal', PRECIOS, 'const lista = priceFor(producto, canal);\n  const oferta', 'const lista = priceFor(producto, "retail");\n  const oferta', T_DECISION),
    # --- PR 4 · del módulo del CMS al evaluador de precios ----------------------------------------------------------------------------------------------
    ("M240", '«-20%» pierde el signo menos', PRECIOS_CMS, 'return `-${beneficio.valor}%`;', 'return `${beneficio.valor}%`;', T_PUERTO),
    ("M241", 'el monto fijo se rotula «Precio especial»', PRECIOS_CMS, 'if (beneficio.tipo === "monto_fijo") return', 'if (false) return', T_PUERTO),
    ("M242", 'la vigencia de la oferta no se cuenta al cliente', PRECIOS_CMS, 'vigencia: o.vigencia.hasta ? describirVigencia({ hasta: o.vigencia.hasta }) : null,', 'vigencia: null,', T_PUERTO),
    ("M243", 'el cliente mayorista recibe las ofertas del detal', PRECIOS_CMS, 'wholesale: ofertasActivas({ snap, canal: "wholesale", ahora }),', 'wholesale: ofertasActivas({ snap, canal: "retail", ahora }),', T_PUERTO),
    ("M244", 'el precio efectivo ignora la oferta y se cobra el de lista', PRECIOS_CMS, 'return { precio: r.precioFinal, precioLista: r.precioLista, oferta: ofertaDePrecio(r.oferta) };', 'return { precio: lista, precioLista: r.precioLista, oferta: ofertaDePrecio(r.oferta) };', T_PUERTO),
    ("M245", 'sin ofertas publicadas no hay evaluador (el módulo encendido deja de contar)', PRECIOS_CMS, 'return snap ? crearEvaluadorPrecios(snap, deps.ahora()) : null;', 'return snap && snap.ofertas.length > 0 ? crearEvaluadorPrecios(snap, deps.ahora()) : null;', T_PUERTO),
    ("M246", 'el precio efectivo usa el reloj del servidor y no el inyectado', PRECIOS_CMS, 'crearEvaluadorPrecios(snap, deps.ahora())', 'crearEvaluadorPrecios(snap, Date.now())', T_PUERTO),
    ("M247", 'un error al leer lo publicado se traga y se cobra la lista', PRECIOS_CMS, 'const snap = await deps.cargar(tenantId);', 'const snap = await deps.cargar(tenantId).catch(() => null);', T_PUERTO),
    ("M248", 'las ofertas se leen del negocio equivocado', PRECIOS_CMS, 'const snap = await deps.cargar(tenantId);', 'const snap = await deps.cargar("otro-negocio");', T_PUERTO),
    # --- PR 4 · el servicio público: mostrar, firmar y cobrar con el mismo precio ------------------------------------------------------------------------
    ("M249", 'si no se pudieron verificar las ofertas, la cotización y el pedido siguen con un precio sin verificar', SERVICE, 'if (estricto) throw new PreciosNoDisponibles(error);', '', T_SERVICIO),
    ("M250", 'si no se pudieron verificar las ofertas, la tienda se cae en vez de mostrar el precio de lista', SERVICE, 'console.error("[catalogo/precios] no se pudieron verificar las ofertas; se muestra el precio de lista:", error instanceof Error ? error.message : error);', 'throw error;', T_SERVICIO),
    ("M251", 'la selección con ofertas queda en cachés compartidas (no avisa los precios dinámicos)', SERVICE, '...(evaluador ? { dynamicPricing: true } : {}), products: activos, evaluador };', 'products: activos, evaluador };', T_SERVICIO),
    ("M252", 'el pedido se prepara sin la verificación estricta de las ofertas', SERVICE, '        context,\n        true,\n', '        context,\n        false,\n', T_SERVICIO),
    ("M253", 'la selección exige verificar las ofertas y se cae si no se pueden leer', SERVICE, 'const resolved = await resolveFor(pub, input.references, context, false);', 'const resolved = await resolveFor(pub, input.references, context, true);', T_SERVICIO),
    ("M254", 'el pedido cobra el precio de lista aunque se mostró la oferta', SERVICE, 'price: rige.precio,', 'price: rige.precioLista ?? rige.precio,', T_SERVICIO),
    ("M255", 'el pedido pierde la evidencia de la oferta', SERVICE, '...(rige.oferta && rige.precioLista !== null ? { listPrice: rige.precioLista, offer: { key: rige.oferta.clave, name: rige.oferta.nombre, version: rige.oferta.version } } : {}),', '', T_SERVICIO),
    ("M256", 'la solicitud guardada pierde la evidencia de la oferta', SERVICE, '...(l.listPrice !== undefined && l.offer ? { listPrice: l.listPrice, offer: l.offer } : {}),', '', T_SERVICIO),
    ("M257", 'el mensaje de WhatsApp no cuenta el ahorro', SERVICE, ', savings: order.savings });', ' });', T_SERVICIO),
    ("M258", 'la ficha del producto muestra el precio de lista', SERVICE, 'toPublicProduct(product, context, gallery[0] ?? null, evaluador?.de(product, context))', 'toPublicProduct(product, context, gallery[0] ?? null)', T_SERVICIO),
    ("M259", 'el listado muestra el precio de lista', SERVICE, 'products: await project(pub, listing.items, input.context, evaluador),', 'products: await project(pub, listing.items, input.context),', T_SERVICIO),
    ("M260", 'el inicio muestra el precio de lista', SERVICE, 'const projected = await project(pub, [...unique.values()], "retail", evaluador);', 'const projected = await project(pub, [...unique.values()], "retail");', T_SERVICIO),
    ("M261", 'la cotización firma el precio de lista y no el que se muestra', SERVICE, 'new Map(items.map((p) => [p.reference, p.price]))', 'new Map(items.map((p) => [p.reference, p.listPrice ?? p.price]))', T_SERVICIO),
    # --- PR 4 · el pedido y su mensaje ------------------------------------------------------------------------------------------------------------------
    ("M262", 'la línea del pedido pierde la evidencia de la oferta', PEDIDO, '...(product.listPrice !== undefined && product.offer ? { listPrice: product.listPrice, offer: product.offer } : {}),', '', T_PEDIDO),
    ("M263", 'el ahorro ignora la cantidad', PEDIDO, '(l.listPrice - l.unitPrice) * l.quantity : 0), 0);', '(l.listPrice - l.unitPrice) : 0), 0);', T_PEDIDO),
    ("M264", 'el ahorro cuenta líneas cuyo precio de lista no es mayor', PEDIDO, 'l.unitPrice !== null && l.listPrice > l.unitPrice ? (l.listPrice - l.unitPrice) * l.quantity', 'l.unitPrice !== null ? (l.listPrice - l.unitPrice) * l.quantity', T_PEDIDO),
    ("M265", 'el mensaje muestra un ahorro de cero', PEDIDO, 'if (extra.savings !== undefined && extra.savings > 0) resumen.push(', 'if (extra.savings !== undefined) resumen.push(', T_PEDIDO),
    # --- PR 4 · la resolución interna (motor de pedidos y ARIA) y las herramientas del agente ---------------------------------------------------------
    ("M266", 'el motor y ARIA leen el precio de lista y no el efectivo', RESOL, 'prices: { retail: detal.precio, wholesale: mayor.precio },', 'prices: { retail: p.pricing.retail, wholesale: p.pricing.wholesale },', T_RESOL),
    ("M267", 'el pedido de un canal lleva la oferta del otro canal', RESOL, 'const oferta = p.offers?.[channel] ?? null;', 'const oferta = p.offers?.retail ?? null;', T_RESOL),
    ("M268", 'el pedido de un canal lleva el precio de lista del otro canal', RESOL, 'const lista = p.listPrices?.[channel];', 'const lista = p.listPrices?.retail;', T_RESOL),
    ("M269", 'si no se pueden verificar las ofertas, la resolución sigue con el precio de lista', RESOL, 'const evaluador = repo.precios ? await repo.precios.paraNegocio(tenantId) : null;', 'const evaluador = repo.precios ? await repo.precios.paraNegocio(tenantId).catch(() => null) : null;', T_RESOL),
    ("M270", 'el motor guarda la oferta del otro canal', MOTOR, 'const oferta = p.offers?.[channel] ?? null;', 'const oferta = p.offers?.retail ?? null;', T_MOTOR),
    ("M271", 'el motor no guarda la evidencia de la oferta al calcular el pedido', MOTOR, '...(oferta && typeof lista === "number" ? { listPrice: lista, offer: { key: oferta.clave, name: oferta.nombre, version: oferta.version } } : {}),', '', T_MOTOR),
    ("M272", 'el motor no guarda la evidencia de la oferta de la solicitud del catálogo', MOTOR, '...(l.listPrice !== undefined && l.offer ? { listPrice: l.listPrice, offer: l.offer } : {}),', '', T_MOTOR),
    ("M273", 'ARIA ve la oferta del otro canal', HERR_PED, 'const oferta = p.offers?.[channel] ?? null;', 'const oferta = p.offers?.retail ?? null;', T_SERVICIO),
    ("M274", 'el pedido que ve ARIA pierde la evidencia de la oferta', CONTRATO_PED, '...(l.listPrice !== undefined && l.offer ? { list_price: l.listPrice, offer: l.offer.name } : {}),', '', T_SERVICIO),
    ("M275", 'el pedido que ve ARIA muestra el código interno de la oferta', CONTRATO_PED, 'offer: l.offer.name }', 'offer: l.offer.key }', T_SERVICIO),
    ("M276", 'el mínimo mayorista exige más que el mínimo (no cuenta el valor exacto)', CHECKOUT, 'order.total >= minimum) return null;', 'order.total > minimum) return null;', T_SERVICIO),
    # --- PR 4 · la evidencia de la oferta en la base de datos y en el panel ----------------------------------------------------------------------------
    ("M277", 'las líneas guardadas pierden la evidencia de la oferta', REPO_PED, '...(l.listPrice !== undefined && l.offer ? { list_price: l.listPrice, offer: l.offer } : {}),', '', T_PERSIST),
    ("M278", 'las líneas leídas pierden la evidencia de la oferta', REPO_PED, '...(l.list_price !== undefined && l.offer ? { listPrice: l.list_price, offer: l.offer } : {}),', '', T_PERSIST),
    ("M279", 'el panel pierde la evidencia de la oferta', PANEL, '...(l.listPrice !== undefined && l.offer ? { precio_lista: l.listPrice, oferta: l.offer.name } : {}),', '', T_PANEL),
    ("M280", 'el panel muestra el código interno de la oferta', PANEL, 'oferta: l.offer.name }', 'oferta: l.offer.key }', T_PANEL),
    # --- PR 4 · el carrito del cliente -----------------------------------------------------------------------------------------------------------------
    ("M281", 'el ahorro del carrito cuenta lo agotado', CARRITO, 'return orderableLines(state).reduce((sum, l) =>', 'return state.lines.reduce((sum, l) =>', T_CARRITO),
    ("M282", 'el ahorro del carrito ignora la cantidad', CARRITO, '(l.listPrice - l.unitPrice) * l.quantity : 0), 0);', '(l.listPrice - l.unitPrice) : 0), 0);', T_CARRITO),
    ("M283", 'el ahorro del carrito cuenta líneas sin descuento', CARRITO, 'l.unitPrice !== null && l.listPrice > l.unitPrice ? (l.listPrice - l.unitPrice) * l.quantity', 'l.unitPrice !== null ? (l.listPrice - l.unitPrice) * l.quantity', T_CARRITO),
    ("M284", 'agregar de nuevo conserva el precio tachado de una oferta que terminó', CARRITO, '? { ...sinOferta(l), name: product.name,', '? { ...l, name: product.name,', T_CARRITO),
    ("M285", 'reconciliar conserva el precio tachado de una oferta que se pausó', CARRITO, 'const next: CartLine = { ...sinOferta(l), name: fresh.name,', 'const next: CartLine = { ...l, name: fresh.name,', T_CARRITO),
    ("M286", 'el carrito guardado acepta un precio de lista que no es mayor al efectivo', CARRITO, 'unitPrice !== null && l.listPrice > unitPrice ? l.listPrice : undefined', 'unitPrice !== null ? l.listPrice : undefined', T_CARRITO),
    ("M287", 'el carrito guardado acepta una etiqueta enorme', CARRITO, 'l.offerLabel.length <= 40', 'true', T_CARRITO),
    ("M288", 'el carrito guardado conserva una etiqueta sin precio de lista', CARRITO, '...(listPrice !== undefined ? { listPrice, ...(offerLabel ? { offerLabel } : {}) } : {}),', '...(listPrice !== undefined ? { listPrice } : {}), ...(offerLabel ? { offerLabel } : {}),', T_CARRITO),
    ("M289", 'un precio de lista que no es número se guarda en el carrito', CARRITO, 'product.listPrice !== undefined && Number.isFinite(product.listPrice) ?', 'product.listPrice !== undefined ?', T_CARRITO),
    ("M290", 'el producto de la tienda llega al carrito sin su oferta', TIENDA_CTX, '...(product.listPrice !== undefined && product.offer ? { listPrice: product.listPrice, offerLabel: product.offer.label } : {}),', '', T_CARRITO),
    ("M291", 'la selección de la tienda no lleva la oferta al carrito', PEDIDO_HTTP, '...(p.listPrice !== undefined && p.offer ? { listPrice: p.listPrice, offerLabel: p.offer.label } : {}),', '', T_SERVICIO),
    ("M292", 'las respuestas con ofertas se guardan en cachés compartidas', PEDIDO_HTTP, 'canal.context === "wholesale" || resolved.dynamicPricing', 'canal.context === "wholesale"', T_SERVICIO),
    ("M293", 'las respuestas mayoristas se guardan en cachés compartidas', PEDIDO_HTTP, 'canal.context === "wholesale" || resolved.dynamicPricing', 'resolved.dynamicPricing', T_SERVICIO + ["lib/catalogo/pedido-fase6.test.ts"]),
    # --- PR 4 · lo que ve el cliente: tarjeta, ficha y hoja «Tu selección» ------------------------------------------------------------------------------
    ("M294", 'la hoja no cuenta cuánto se ahorra', HOJA, '{ahorro > 0 && (', '{false && (', T_UI_OFERTAS),
    ("M295", 'la hoja anuncia un ahorro de cero', HOJA, '{ahorro > 0 && (', '{true && (', T_UI_OFERTAS),
    ("M296", 'la hoja no muestra el precio de lista de cada producto', HOJA, '{l.listPrice !== undefined && (', '{false && (', T_UI_OFERTAS),
    ("M297", 'la ficha no muestra el precio de lista tachado', FICHA, '{producto.listPrice !== undefined && (', '{false && (', T_UI_OFERTAS),
    ("M298", 'la ficha no muestra la etiqueta de la oferta', FICHA, '{producto.offer && <span className="rounded-full', '{false && <span className="rounded-full', T_UI_OFERTAS),
    ("M299", 'la ficha no muestra el recuadro de la oferta', FICHA, '{producto.offer && (', '{false && (', T_UI_OFERTAS),
    ("M300", 'la ficha no muestra hasta cuándo vale la oferta', FICHA, '{producto.offer.until && <p className="mt-0.5 text-mist">Vigente {producto.offer.until}</p>}', '', T_UI_OFERTAS),
    ("M301", 'la ficha no muestra las condiciones de la oferta', FICHA, '{producto.offer.conditions && <p', '{false && <p', T_UI_OFERTAS),
    ("M302", 'la tarjeta no muestra la etiqueta de la oferta', TARJETA, '{product.offer && (', '{false && (', T_UI_OFERTAS),
    ("M303", 'la tarjeta no cuenta en qué consiste la oferta', TARJETA, '{product.offer && <p className="mt-1 text-[11.5px]', '{false && <p className="mt-1 text-[11.5px]', T_UI_OFERTAS),
    ("M304", 'la tarjeta no muestra el precio de lista tachado', TARJETA, ') : product.listPrice !== undefined ? (', ') : false ? (', T_UI_OFERTAS),
    ("M305", 'la sección de ofertas se dibuja sin ofertas', INICIO, 'return config.ofertas && config.ofertas.length > 0 ? (', 'return config.ofertas ? (', T_UI_OFERTAS),
    ("M306", 'el combo muestra un ahorro que no existe (sin ahorro calculado)', INICIO, '{c.precioNormal !== null && c.ahorro !== undefined && (', '{c.precioNormal !== null && (', T_UI_OFERTAS),
    # --- PR 4 · del CMS a la home: ofertas y combos -----------------------------------------------------------------------------------------------------
    ("M307", '«Ver productos» lleva a una categoría que no existe', VIT, 'ctx.categorias.has(alcance.categorias[0])', 'true', T_VIT),
    ("M308", '«Ver productos» de una oferta con varias categorías lleva a una sola', VIT, 'alcance.categorias.length === 1 &&', 'alcance.categorias.length >= 1 &&', T_VIT),
    ("M309", 'una oferta de toda la tienda se anuncia por productos', VIT, 'if (a.todos) return "Toda la tienda";', '', T_VIT),
    ("M310", 'los combos no disponibles salen primero', VIT, 'return [...salida.filter((c) => c.disponible), ...salida.filter((c) => !c.disponible)];', 'return [...salida.filter((c) => !c.disponible), ...salida.filter((c) => c.disponible)];', T_VIT),
    ("M311", 'un combo no disponible ofrece el enlace de pedido', VIT, 'consultaHref: v.disponible ? consultaDeCombo(ctx.whatsapp, v.nombre, v.clave) : null,', 'consultaHref: consultaDeCombo(ctx.whatsapp, v.nombre, v.clave),', T_VIT),
    ("M312", 'el mensaje de pedido del combo se manda sin codificar', VIT, 'encodeURIComponent(`Hola, me interesa el combo «${nombre}» (código ${clave}).`)', '`Hola, me interesa el combo «${nombre}» (código ${clave}).`', T_VIT),
    ("M313", 'los combos se arman sin los datos reales de sus componentes', VIT, 'if (secciones.includes("combos") && productos) {', 'if (secciones.includes("combos")) {', T_VIT),
    ("M314", 'las secciones que la tienda no dibuja siguen en la lista', VIT, 'const secciones = visibles.filter((s) => dibujadas.includes(s));', 'const secciones = visibles;', T_VIT),
    ("M315", 'los botones no saben qué secciones están en la página', VIT, 'const ctx: ContextoVitrina = { ...ctxEntrada, dibujadas: secciones, campanaMostrada: campana?.clave ?? null };', 'const ctx: ContextoVitrina = { ...ctxEntrada, campanaMostrada: campana?.clave ?? null };', T_VIT),
    ("M316", 'el botón de una campaña lleva a otra campaña distinta de la que se muestra', VIT, 'const llevaAlBloque = ctx.campanaMostrada !== undefined ? ctx.campanaMostrada === destino.clave : campanasActivas(ev).some((c) => c.clave === destino.clave);', 'const llevaAlBloque = campanasActivas(ev).some((c) => c.clave === destino.clave);', T_VIT),
    ("M317", 'un botón lleva a la sección de ofertas aunque no esté en la página', VIT, 'dibujadas.includes("ofertas") && ofertasActivas(ev)', 'ofertasActivas(ev)', T_VIT),
    ("M318", 'un botón lleva a la sección de combos aunque no esté en la página', VIT, 'dibujadas.includes("combos") && combosActivos(ev)', 'combosActivos(ev)', T_VIT),
    ("M319", 'se consultan los componentes de los combos mayoristas', VIT, 'combosActivos({ snap, canal: "retail", ahora })', 'combosActivos({ snap, canal: "wholesale", ahora })', T_VIT),
    ("M320", 'se consulta dos veces el mismo producto de los combos', VIT, 'return [...new Set(combosActivos({ snap, canal: "retail", ahora }).flatMap((c) => c.contenido.componentes.map((x) => x.referencia)))];', 'return combosActivos({ snap, canal: "retail", ahora }).flatMap((c) => c.contenido.componentes.map((x) => x.referencia));', T_VIT),
    # --- PR 4 · la carga de la vitrina con los productos de los combos ----------------------------------------------------------------------------------
    ("M321", 'se consultan productos aunque no haya combos vigentes', VITPUB, 'if (deps.productosDeCombos && referencias.length > 0) {', 'if (deps.productosDeCombos) {', T_VITPUB),
    ("M322", 'una falla al consultar productos no se avisa', VITPUB, '            avisar(deps, error);\n            return undefined;', '            return undefined;', T_VITPUB),
    ("M323", 'una falla al consultar productos tumba toda la vitrina', VITPUB, 'deps.productosDeCombos(tenantId, referencias).catch((error: unknown) => {\n            avisar(deps, error);\n            return undefined;\n          });', 'deps.productosDeCombos(tenantId, referencias);', T_VITPUB),
    ("M324", 'los productos de los combos se consultan en el negocio equivocado', VITPUB, 'productos = await deps.productosDeCombos(tenantId, referencias)', 'productos = await deps.productosDeCombos("otro-negocio", referencias)', T_VITPUB),
    ("M325", 'los productos consultados no llegan a la vitrina', VITPUB, '{ ...ctx, ahora }, leido.productos)', '{ ...ctx, ahora }, undefined)', T_VITPUB),
    # --- PR 4 · el cableado REAL de producción (adaptadores de Supabase) ------------------------------------------------------------------------
    ("M326", 'el cableado real de producción no trae los precios efectivos', PRECIOS_SUPA, 'conPrecios(createSupabaseCatalogRepository(supabase), crearPuertoPreciosSupabase(supabase))', 'conPrecios(createSupabaseCatalogRepository(supabase), null)', T_REAL),
    ("M327", 'el cableado real de producción usa un reloj que no es el del servidor', PRECIOS_SUPA, 'ahora: () => Date.now()', 'ahora: () => 0', T_REAL),
    ("M328", 'los productos de los combos se consultan con el precio de lista y no con el efectivo', PUB_SUPA, 'createResolucionCatalogo({ repo: dep().conPrecios })', 'createResolucionCatalogo({ repo: dep().repo })', T_REAL),
    ("M329", 'las rutas de selección y pedido de la tienda no usan los precios efectivos', PEDIDO_HTTP, 'createPublicCatalogService({ repo: repositorioConPrecios(supabase), orders })', 'createPublicCatalogService({ repo: { ...repositorioConPrecios(supabase), precios: undefined }, orders })', T_REAL),
    ("M330", 'las páginas de la tienda no usan los precios efectivos', PUBLIC_LOADER, 'createPublicCatalogService({ repo: repositorioConPrecios(supabaseAdmin()) })', 'createPublicCatalogService({ repo: { ...repositorioConPrecios(supabaseAdmin()), precios: undefined } })', T_REAL),
    ("M331", 'las herramientas de ARIA de producción no usan los precios efectivos', PRODUCCION, '    catalog: repositorioConPrecios(supabase),\n    async ownsPhoneNumber', '    catalog: { ...repositorioConPrecios(supabase), precios: undefined },\n    async ownsPhoneNumber', T_REAL),
    ("M332", 'el motor de pedidos de producción no usa los precios efectivos', PRODUCCION, '    catalog: repositorioConPrecios(supabase),\n    key,', '    catalog: { ...repositorioConPrecios(supabase), precios: undefined },\n    key,', T_REAL),
    # --- PR 4 · una sola lectura de lo publicado por página -------------------------------------------------------------------------------------
    ("M333", 'la lectura de lo publicado se guarda para siempre (nunca ve lo que se publica después)', LECTURA, 'export const leerPublicado = cache(', 'export const leerPublicado = ((fn) => { const guardadas = new Map<string, unknown>(); return ((s: SupabaseClient, t: string) => { if (!guardadas.has(t)) guardadas.set(t, fn(s, t)); return guardadas.get(t); }) as typeof fn; })(', T_LECTURA),
    ("M334", 'la lectura de lo publicado entrega la del primer negocio a todos los demás', LECTURA, 'export const leerPublicado = cache(', 'export const leerPublicado = ((fn) => { let primera: unknown; return ((s: SupabaseClient, t: string) => (primera ??= fn(s, t))) as typeof fn; })(', T_LECTURA),
    ("M335", 'la lectura de lo publicado lee un negocio distinto al pedido', LECTURA, 'crearLectorSupabase(supabase).cargar(tenantId));', 'crearLectorSupabase(supabase).cargar("otro-negocio"));', T_LECTURA),
    # --- PR 5 · ARIA y el CMS: consultas, herramientas, guarda de anclaje, runtime, cableado de producción y migración de los textos ------------------------------
    ("M336", 'las ofertas vigentes nunca se declaran vacías', CONSULTA, 'empty: offers.length === 0,', 'empty: false,', T_CONSULTA),
    ("M337", 'la oferta de un producto muestra el precio de lista como el que paga hoy', CONSULTA, 'list_price: precio.oferta.precioLista, price: precio.oferta.precioFinal }],', 'list_price: precio.oferta.precioLista, price: precio.oferta.precioLista }],', T_CONSULTA),
    ("M338", 'el producto consultado muestra el precio de lista como el que paga hoy', CONSULTA, 'price: precio.precioFinal, list_price: precio.precioLista };', 'price: precio.precioLista, list_price: precio.precioLista };', T_CONSULTA),
    ("M339", 'los combos no disponibles salen primero', CONSULTA, 'const ordenados = [...combos.filter((x) => x.available), ...combos.filter((x) => !x.available)];', 'const ordenados = [...combos.filter((x) => !x.available), ...combos.filter((x) => x.available)];', T_CONSULTA),
    ("M340", 'un combo no disponible no dice por qué', CONSULTA, 'unavailable_reason: v.motivoNoDisponible ? MOTIVO[v.motivoNoDisponible] : null,', 'unavailable_reason: null,', T_CONSULTA),
    ("M341", 'un texto con una variable sin valor no avisa que quedó incompleto', CONSULTA, 'const incomplete = descartados.length > 0;', 'const incomplete = false;', T_CONSULTA),
    ("M342", 'los combos de un cliente mayorista se arman con el precio detal', CONSULTA, 'precioLista: canal === "wholesale" ? p.prices.wholesale : p.prices.retail };', 'precioLista: p.prices.retail };', T_CONSULTA),
    ("M343", 'una campaña lista las ofertas de todas las campañas', CONSULTA, 'offers: ofertas.filter((o) => o.contenido.campana === k.clave).map(', 'offers: ofertas.map(', T_CONSULTA),
    ("M344", 'la consulta por categoría deja de incluir las ofertas de toda la tienda', CONSULTA, 'activas = activas.filter((o) => o.contenido.alcance.todos || o.contenido.alcance.categorias.includes(id));', 'activas = activas.filter((o) => o.contenido.alcance.categorias.includes(id));', T_CONSULTA),
    ("M345", 'el canal se informa al revés', CONSULTA, 'const CANAL_TEXTO = (canal: Canal) => (canal === "retail" ? ("retail" as const) : ("wholesale" as const));', 'const CANAL_TEXTO = (canal: Canal) => (canal === "retail" ? ("wholesale" as const) : ("retail" as const));', T_CONSULTA),
    ("M346", 'los combos dicen que se compran desde el carrito', CONSULTA, 'const COMO_COMPRAR = "Los combos no se compran desde el carrito: los cierra una asesora. Si el cliente lo quiere, ofrécele pasar con una asesora.";', 'const COMO_COMPRAR = "Los combos se compran desde el carrito.";', T_CONSULTA),
    ("M347", 'una categoría que no existe se declara encontrada', CONSULTA, 'category: { name: filtro.categoria.nombre, found: false }', 'category: { name: filtro.categoria.nombre, found: true }', T_CONSULTA),
    ("M348", 'un tema de contenido nunca se declara vacío', CONSULTA, 'empty: items.length === 0,', 'empty: false,', T_CONSULTA),
    ("M349", 'ARIA lee el CMS de una conversación que no es de este negocio', HERR, '  // Defensa en profundidad (igual que las herramientas de catálogo): el número debe ser de este negocio.\n  if (!(await deps.ownsPhoneNumber(ctx.tenantId, ctx.phoneNumberId))) return { ok: false, out: fail("FORBIDDEN", "Esta conversación no pertenece a este negocio.") };\n  let snap: InstantaneaCms | null;', '  let snap: InstantaneaCms | null;', T_ARIA),
    ("M350", 'se acepta la instantánea del CMS de otro negocio', HERR, 'if (snap === null || snap.tenantId !== ctx.tenantId) return noDisponible();', 'if (snap === null) return noDisponible();', T_ARIA),
    ("M351", 'una falla de lectura del CMS explota en vez de decir «no disponible»', HERR, '    return noDisponible();\n  }\n  if (snap === null || snap.tenantId !== ctx.tenantId) return noDisponible();', '    throw err;\n  }\n  if (snap === null || snap.tenantId !== ctx.tenantId) return noDisponible();', T_ARIA),
    ("M352", 'consultar_ofertas deja de ser estricta (el modelo puede pasar negocio o canal)', HERR, '        categoria: z.string().trim().min(1).max(60).optional(),\n      })\n      .strict(),', '        categoria: z.string().trim().min(1).max(60).optional(),\n      }),', T_ARIA),
    ("M353", 'el tema del contenido ya no es de una lista cerrada', HERR, 'input: z.object({ tema: z.enum(TEMAS_CONTENIDO) }).strict(),', 'input: z.object({ tema: z.string() }).strict(),', T_ARIA),
    ("M354", 'el código del combo acepta cualquier texto', HERR, '.regex(/^[a-z0-9][a-z0-9-]{0,79}$/, { message: "Código de combo inválido." })', '.regex(/.*/)', T_ARIA),
    ("M355", 'consultar_ofertas acepta una referencia que nunca salió en la conversación', HERR, '        const blocked = checkProvenance(ctx, input.referencia, false);\n        if (blocked) return blocked;\n', '', T_ARIA),
    ("M356", 'los combos se arman siempre con el precio detal', HERR, 'productoParaCombo(p, ctx.channel)', 'productoParaCombo(p)', T_ARIA),
    ("M357", 'la oferta de un producto se evalúa sobre el precio ya rebajado', HERR, 'const lista = r.product.listPrices?.[ctx.channel] ?? r.product.prices[ctx.channel];', 'const lista = r.product.prices[ctx.channel];', T_ARIA),
    ("M358", 'una categoría ambigua elige la primera que se parezca', HERR, 'const elegida = exacta ?? (parecidas.length === 1 ? parecidas[0] : null);', 'const elegida = exacta ?? parecidas[0] ?? null;', T_ARIA),
    ("M359", 'un porcentaje que ninguna herramienta devolvió sale al cliente', ANCL_C, 'if (!r.porcentajes.has(n) && !ecoNegado(t, m.index ?? 0, n)) out.add(', 'if (false) out.add(', T_GUARDA),
    ("M360", 'un porcentaje escrito en palabras sale sin respaldo', ANCL_C, 'if (n >= 0 && !r.porcentajes.has(n)) out.add(', 'if (false) out.add(', T_GUARDA),
    ("M361", 'un condicional con porcentaje se trata como afirmación', ANCL_C, '    if (!hipotetica) {\n      for (const m of t.matchAll(PORCENTAJE)) {', '    if (true) {\n      for (const m of t.matchAll(PORCENTAJE)) {', T_GUARDA),
    ("M362", 'un «2x1» inventado sale al cliente', ANCL_C, 'if (!hipotetica && !negada) for (const m of t.matchAll(MULTI))', 'if (false) for (const m of t.matchAll(MULTI))', T_GUARDA),
    ("M363", '«no hay promociones» sale sin una lectura vacía que lo respalde', ANCL_C, 'if (!r.vacias[grupo] && !(calificada && consultada)) out.add(', 'if (false) out.add(', T_GUARDA),
    ("M364", '«no tengo información de promociones» se trata como afirmar que no existen', ANCL_C, 'if (aus && !SIN_DATO.test(aus[1]) && !hipotetica) {', 'if (aus && !hipotetica) {', T_GUARDA),
    ("M365", '«tenemos descuentos» sale sin ninguna oferta respaldada', ANCL_C, 'if (promo && !r.hayPromo) out.add("discount_unbacked");', 'if (false) out.add("discount_unbacked");', T_GUARDA),
    ("M366", '«tenemos combos» sale sin ningún combo respaldado', ANCL_C, 'if (combo && !r.hayCombos) out.add("combo_unbacked");', 'if (false) out.add("combo_unbacked");', T_GUARDA),
    ("M367", '«estamos en la campaña» sale sin ninguna campaña respaldada', ANCL_C, 'if (campana && !r.hayCampanas) {', 'if (false) {', T_GUARDA),
    ("M368", 'una negación («ese producto no tiene descuento») se bloquea como afirmación', ANCL_C, '    if (!negada && !hipotetica) {\n      if (promo && !r.hayPromo)', '    if (!hipotetica) {\n      if (promo && !r.hayPromo)', T_GUARDA),
    ("M369", 'el nombre de una oferta inventada sale al cliente', ANCL_C, 'if (!respaldaNombre(nombre, r.nombres)) {', 'if (false) {', T_GUARDA),
    ("M370", 'una palabra común tras «oferta» se toma por un nombre propio', ANCL_C, 'if (NO_ES_NOMBRE.has(fold(nombre))) continue;', '', T_GUARDA),
    ("M371", 'una temporada inventada («Black Friday») sale junto a una promoción', ANCL_C, '      if (contextoPromo) {\n        for (const temporada of TEMPORADAS) {', '      if (false) {\n        for (const temporada of TEMPORADAS) {', T_GUARDA),
    ("M372", '«sigue vigente» sale sin ninguna promoción respaldada', ANCL_C, 'if (!negada && !hipotetica && CONTINUA_VIGENTE.test(t)', 'if (false && CONTINUA_VIGENTE.test(t)', T_GUARDA),
    ("M373", 'una fecha de vigencia inventada sale al cliente', ANCL_C, 'for (const m of t.matchAll(FECHA)) if (!r.fechas.has(', 'for (const m of t.matchAll(FECHA)) if (false && !r.fechas.has(', T_GUARDA),
    ("M374", 'un «hasta el 20» inventado sale al cliente', ANCL_C, 'for (const m of t.matchAll(HASTA_DIA)) if (!r.diasDeFecha.has(', 'for (const m of t.matchAll(HASTA_DIA)) if (false && !r.diasDeFecha.has(', T_GUARDA),
    ("M375", 'una urgencia inventada («solo por hoy») sale al cliente', ANCL_C, 'for (const m of t.matchAll(URGENCIA)) if (!r.texto.includes(m[1]))', 'for (const m of t.matchAll(URGENCIA)) if (false && !r.texto.includes(m[1]))', T_GUARDA),
    ("M376", '«vale hasta el 20 de noviembre» sale sin la palabra promoción', ANCL_C, '(VIGENCIA_CUE.test(t) || HASTA_FECHA.test(t) || RANGO_FECHAS.test(t))', '(VIGENCIA_CUE.test(t) || RANGO_FECHAS.test(t))', T_GUARDA),
    ("M377", 'un rango de fechas inventado sale sin la palabra promoción', ANCL_C, '(VIGENCIA_CUE.test(t) || HASTA_FECHA.test(t) || RANGO_FECHAS.test(t))', '(VIGENCIA_CUE.test(t) || HASTA_FECHA.test(t))', T_GUARDA),
    ("M378", 'la fecha de entrega de un pedido se trata como una vigencia', ANCL_C, '(VIGENCIA_CUE.test(t) || HASTA_FECHA.test(t) || RANGO_FECHAS.test(t)) && !CUE_ENVIO.test(t);', '(VIGENCIA_CUE.test(t) || HASTA_FECHA.test(t) || RANGO_FECHAS.test(t));', T_GUARDA),
    ("M379", 'el precio mayorista se le cuenta también al cliente mayorista como fuga', ANCL_C, 'if (ev.channel === "retail" && MAYORISTA.test(t)', 'if (MAYORISTA.test(t)', T_GUARDA),
    ("M380", 'la compra inicial mayorista se bloquea como fuga', ANCL_C, '!negada && !hipotetica && !MINIMO.test(t)) {', '!negada && !hipotetica) {', T_GUARDA),
    ("M381", 'el tiempo de envío se vigila dos veces (la guarda de envíos y la comercial)', ANCL_C, 'if (!negada && !hipotetica && CUE_POLITICA.test(t) && !(opts.shippingGuardActive && CUE_ENVIO.test(t))) {', 'if (!negada && !hipotetica && CUE_POLITICA.test(t)) {', T_GUARDA),
    ("M382", 'un plazo de garantía inventado sale al cliente', ANCL_C, 'if (!respaldo) out.add(', 'if (false) out.add(', T_GUARDA),
    ("M383", 'una lectura con resultados se toma por vacía', ANCL_C, 'const noVacio = (fs: HechoComercial[]) => fs.some((f) => f.data.empty === false);', 'const noVacio = (fs: HechoComercial[]) => fs.some((f) => f.data.empty === true);', T_GUARDA),
    ("M384", 'una lectura vacía no respalda «no hay»', ANCL_C, 'const vacia = (fs: HechoComercial[]) => fs.some((f) => f.data.empty === true);', 'const vacia = (fs: HechoComercial[]) => fs.some((f) => f.data.empty === false);', T_GUARDA),
    ("M385", 'solo las ofertas (y no las campañas ni los combos) respaldan hablar de promociones', ANCL_C, 'hayPromo: hayOfertas || hayCombos || hayCampanas,', 'hayPromo: hayOfertas,', T_GUARDA),
    ("M386", 'la oferta de la vista de un producto no respalda «tiene descuento»', ANCL_C, 'const hayOfertas = noVacio(ofertas) || ev.productOffers.length > 0;', 'const hayOfertas = noVacio(ofertas);', T_GUARDA),
    ("M387", 'las preguntas del modelo se vigilan como afirmaciones', ANCL_C, '.filter((o) => o.trim() !== "" && !o.includes("¿") && !o.trim().endsWith("?"));', '.filter((o) => o.trim() !== "");', T_GUARDA),
    ("M388", 'lo que devuelve una herramienta no respalda sus propias cifras, fechas y plazos', ANCL, '    ev.comercial?.texts.push(value);\n', '', T_GUARDA),
    ("M389", 'la guarda comercial nunca se ejecuta', ANCL, 'if (ev.comercial?.active) for (const v of checkCommercialClaims(', 'if (false) for (const v of checkCommercialClaims(', T_GUARDA),
    ("M390", 'una oferta de la vista de un producto no se recuerda como respaldo', ANCL, 'ev.comercial.productOffers.push((oferta as { name: string }).name);', 'void 0;', T_GUARDA),
    ("M391", 'la guarda comercial no se activa aunque el número tenga las herramientas', RUNTIME, 'const commercialGuard = deps.config.tools.some(esHerramientaComercial);', 'const commercialGuard = false;', T_RUNTIME_ARIA),
    ("M392", 'las herramientas comerciales trabajan con el reloj en cero', RUNTIME, 'valores: variablesDeNegocio(deps.config.business).variables, nowMs: now() };', 'valores: variablesDeNegocio(deps.config.business).variables, nowMs: 0 };', T_RUNTIME_ARIA),
    ("M393", 'las variables de los textos ({{minimo_mayorista}}) no se resuelven', RUNTIME, 'valores: variablesDeNegocio(deps.config.business).variables, nowMs: now() };', 'valores: {}, nowMs: now() };', T_RUNTIME_ARIA),
    ("M394", 'el modelo que insiste con algo comercial sin respaldo no pasa a una asesora', RUNTIME, '} else if (failure === "unverified" && trace.grounding.violations.includes("commercial") && !ctx.handedOff) {', '} else if (false) {', T_RUNTIME_ARIA),
    ("M395", 'el mensaje fijo de la salida comercial es otro', RUNTIME, 'reply = FALLBACK_MESSAGES.commercial;', 'reply = FALLBACK_MESSAGES.handoff;', T_RUNTIME_ARIA),
    ("M396", 'las preguntas del checkout no pueden consultar lo comercial', RUNTIME, '  "consultar_ofertas",\n  "consultar_combos",\n  "consultar_campanas",\n  "consultar_contenido_comercial",\n];', '];', T_CHECKOUT_ARIA),
    ("M397", 'lo que devuelven las herramientas comerciales no respalda al turno normal', RUNTIME, '          if (outcome.ok) registrarHechoComercial(evidence.comercial, tc.name, outcome.data);', '', T_RUNTIME_ARIA),
    ("M398", 'lo que devuelven las herramientas comerciales no respalda a la pregunta del checkout', RUNTIME, '            if (outcome.ok) registrarHechoComercial(ev.comercial, tc.name, outcome.data);', '', T_CHECKOUT_ARIA),
    ("M399", 'la traza del turno no guarda los tipos de afirmación comercial sin respaldo', RUNTIME, '      registrarCodigosComerciales(trace, check.violations);\n      const montos =', '      const montos =', T_RUNTIME_ARIA),
    ("M400", 'la pregunta del checkout no recibe el contexto comercial', RUNTIME, '      comercial: commercialToolContext,\n    };\n    const ev = emptyEvidence();', '    };\n    const ev = emptyEvidence();', T_CHECKOUT_ARIA),
    ("M401", 'el turno normal no recibe el contexto comercial', RUNTIME, '    shipping: { rules: enviosRules, nowMs: now() },\n    comercial: commercialToolContext,\n  };\n\n  let writes = 0;', '    shipping: { rules: enviosRules, nowMs: now() },\n  };\n\n  let writes = 0;', T_RUNTIME_ARIA),
    ("M402", 'el turno normal no crea la evidencia comercial', RUNTIME, 'if (commercialGuard) evidence.comercial = emptyComercialEvidence(channel);', '', T_RUNTIME_ARIA),
    ("M403", 'la pregunta del checkout no crea la evidencia comercial', RUNTIME, 'if (commercialGuard) ev.comercial = emptyComercialEvidence(channel);', '', T_CHECKOUT_ARIA),
    ("M404", 'las reglas comerciales van en el prompt de TODOS los negocios', CONTEXTO, '...(config.tools.some(esHerramientaComercial) ?', '...(true ?', T_ARIA),
    ("M405", 'ASLC recibe las herramientas comerciales', APROV, 'AGENT_TOOL_NAMES.filter((t) => t !== "confirm_order" && !esHerramientaComercial(t))', 'AGENT_TOOL_NAMES.filter((t) => t !== "confirm_order")', T_ARIA),
    ("M406", 'una herramienta comercial deja de contarse como comercial', NOMBRES, '"consultar_campanas", "consultar_contenido_comercial"] as const satisfies', '"consultar_contenido_comercial"] as const satisfies', T_ARIA),
    ("M407", 'la frontera de producción no le entrega el lector del CMS a ARIA', WEBHOOK, '        comercial: { cargar: (tenantId) => crearLectorSupabase(supabase).cargar(tenantId) },\n', '', T_PROD_ARIA),
    ("M408", 'la frontera de producción lee el CMS de otro negocio', WEBHOOK, 'crearLectorSupabase(supabase).cargar(tenantId) },', 'crearLectorSupabase(supabase).cargar("otro-negocio") },', T_PROD_ARIA),
    ("M409", 'la frontera de producción memoiza la lectura del CMS entre turnos', WEBHOOK, 'comercial: { cargar: (tenantId) => crearLectorSupabase(supabase).cargar(tenantId) },', 'comercial: { cargar: ((c: { p?: Promise<never> }) => (tenantId: string) => (c.p ??= crearLectorSupabase(supabase).cargar(tenantId) as Promise<never>))({}) },', T_PROD_ARIA),
    ("M410", 'el script 04 migra aunque no haya UNA sola tienda con ese slug', SQL04, 'if v_tienda <> 1 then', 'if false then', T_MIGRACION),
    ("M411", 'el script 04 migra con el módulo del CMS apagado', SQL04, "if not exists (select 1 from public.dulabs_tenant_modulos where id_tenant = v_tenant and modulo = 'cms_comercial' and habilitado) then", 'if false then', T_MIGRACION),
    ("M412", 'el script 04 sigue con dos configuraciones de ARIA (o ninguna)', SQL04, 'if v_filas <> 1 then', 'if false then', T_MIGRACION),
    ("M413", 'el script 04 falla al repetirse (no salta lo que ya existe)', SQL04, "elsif v_r->>'resultado' = 'clave_existente' then", "elsif v_r->>'resultado' = 'otro_resultado' then", T_MIGRACION),
    ("M414", 'el script 04 reemplaza el monto aunque venga dentro de otro número (1750000)', SQL04, '(?:\\$\\s?)?(?<![\\d.,])(?:', '(?:\\$\\s?)?(?:', T_MIGRACION),
    ("M415", 'el script 04 reemplaza el monto aunque siga con más dígitos o decimales', SQL04, "')(?!\\d|[.,]\\d)';", "')';", T_MIGRACION),
    ("M416", 'el script 04 ignora la audiencia de la tabla (todo para todos)', SQL04, "'audiencia', v_m.audiencia,", "'audiencia', 'todos',", T_MIGRACION),
    ("M417", 'el script 04 deja espacios de más en el título', SQL04, "regexp_replace(btrim(v_item->>'tema'), '\\s+', ' ', 'g')", "btrim(v_item->>'tema')", T_MIGRACION),
    ("M418", 'el script 04 no convierte el mínimo mayorista en variable', SQL04, 'if v_patron is not null then', 'if false then', T_MIGRACION),
    ("M419", 'el script 04 migra temas vacíos', SQL04, "if v_texto is null or btrim(v_texto) = '' then", 'if false then', T_MIGRACION),
    ("M420", 'la reversa del 04 archiva lo que la administradora ya editó', SQL04R, "if v_e.estado = 'borrador' and v_e.rev = 1 and v_e.created_by is null then", "if v_e.estado = 'borrador' then", T_MIGRACION),
    ("M421", 'la reversa del 04 archiva lo que la administradora ya editó (solo mira quién lo creó, no si cambió)', SQL04R, "if v_e.estado = 'borrador' and v_e.rev = 1 and v_e.created_by is null then", "if v_e.estado = 'borrador' and v_e.created_by is null then", T_MIGRACION),
    ("M422", 'el script 05 habilita las herramientas sin ningún texto publicado', SQL05, 'if v_publicados = 0 then', 'if false then', T_MIGRACION),
    ("M423", 'el script 05 habilita las herramientas con temas críticos sin publicar', SQL05, "if v_sin_publicar is not null and coalesce(current_setting('dulabs.permitir_temas_sin_publicar', true), '') <> 'si' then", 'if false then', T_MIGRACION),
    ("M424", 'el script 05 ignora la confirmación explícita de la administradora', SQL05, "coalesce(current_setting('dulabs.permitir_temas_sin_publicar', true), '') <> 'si'", 'true', T_MIGRACION),
    ("M425", 'el script 05 cuenta como pendiente un tema crítico archivado', SQL05, "e.archivada_at is null and e.estado <> 'publicada'", "e.estado <> 'publicada'", T_MIGRACION),
    ("M426", 'el script 05 deja pasar más de 30 herramientas', SQL05, 'if v_nuevas is not null and cardinality(v_cfg.herramientas) + cardinality(v_nuevas) > 30 then', 'if false then', T_M05),
    ("M427", 'el script 05 duplica las herramientas que ya estaban', SQL05, '   where not (h = any (v_cfg.herramientas));', '   where true;', T_MIGRACION),
    ("M428", 'el script 05 falla al repetirse (no detecta que ya están habilitadas)', SQL05, "if v_nuevas is null and (v_cfg.negocio->'comercial_piloto') is not distinct from to_jsonb(v_numeros) then", 'if false then', T_M05),
    ("M429", 'la reversa del 05 apaga las herramientas aunque un tema crítico ya solo viva en el CMS', SQL05R, "if v_retirados is not null and coalesce(current_setting('dulabs.confirmar_reversa_herramientas', true), '') <> 'si' then", 'if false then', T_MIGRACION),
    ("M430", 'el script 06 retira del prompt sin las herramientas habilitadas', SQL06, 'if not (v_cfg.herramientas @> array', 'if false and (v_cfg.herramientas @> array', T_MIGRACION),
    ("M431", 'el script 06 corre sin que le indiquen los temas', SQL06, "if v_lista = '' then", 'if false then', T_MIGRACION),
    ("M432", 'el script 06 acepta una clave que no es de la tabla', SQL06, 'if v_legado is null then', 'if false then', T_MIGRACION),
    ("M433", 'el script 06 retira un tema que no está publicado', SQL06, "if v_ent.id is null or v_ent.estado <> 'publicada' or v_ent.archivada_at is not null then", 'if false then', T_MIGRACION),
    ("M434", 'el script 06 quita del prompt todos los temas MENOS el indicado', SQL06, "'g'))) is distinct from lower(", "'g'))) = lower(", T_MIGRACION),
    ("M435", 'el script 06 deja el conocimiento vacío', SQL06, "set negocio = jsonb_set(negocio, '{conocimiento}', v_conocimiento, true)", "set negocio = jsonb_set(negocio, '{conocimiento}', '[]'::jsonb, true)", T_MIGRACION),
    ("M436", 'la reversa del 06 restaura textos de más de 800 caracteres', SQL06R, 'if char_length(v_texto) > 800 then', 'if false then', T_MIGRACION),
    ("M437", 'la reversa del 06 pasa de 40 temas', SQL06R, 'if jsonb_array_length(v_conocimiento) >= 40 then', 'if false then', T_MIGRACION),
    ("M438", 'la reversa del 06 restaura un texto con el mínimo sin configurar', SQL06R, 'if v_minimo is null then raise exception', 'if false then raise exception', T_MIGRACION),
    ("M439", 'la reversa del 06 restaura un tema que no está publicado', SQL06R, "if v_ent.id is null or v_ent.estado <> 'publicada' or v_ent.archivada_at is not null then", 'if false then', T_MIGRACION),
    ("M440", 'la reversa del 06 restaura un texto con una variable desconocida', SQL06R, "if v_texto ~ '\\{\\{' then", 'if false then', T_MIGRACION),
    ("M441", 'la reversa del 06 restaura la dirección de la tienda sin estar configurada', SQL06R, "if coalesce(btrim(v_cfg.negocio->'pedido'->>'direccion_tienda'), '') = '' then raise exception", 'if false then raise exception', T_MIGRACION),
    ("M442", 'la reversa del 06 restaura el nombre del negocio sin estar configurado', SQL06R, "if coalesce(btrim(v_cfg.negocio->>'nombre_negocio'), '') = '' then raise exception", 'if false then raise exception', T_MIGRACION),
    ("M443", 'un número que el cliente escribió y la frase NIEGA se bloquea como afirmación', ANCL_C, '!r.porcentajes.has(n) && !ecoNegado(t, m.index ?? 0, n)', '!r.porcentajes.has(n)', T_GUARDA),
    ("M444", 'la guarda no recibe los números que escribió el cliente', ANCL, ', customerNumbers: ev.customerNumbers }', ' }', T_GUARDA),
    ("M445", 'negar un descuento calificado («adicional», «por pago de contado») se bloquea como ausencia', ANCL_C, 'if (!r.vacias[grupo] && !(calificada && consultada)) out.add(', 'if (!r.vacias[grupo]) out.add(', T_GUARDA),
    ("M446", 'negar un descuento calificado se permite aunque la herramienta NO se haya consultado', ANCL_C, '!(calificada && consultada)', '!calificada', T_GUARDA),
    ("M447", '«la campaña de Amor y Amistad» se bloquea aunque una herramienta devolvió esa oferta', ANCL_C, 'if (!nombrada) out.add("campaign_unbacked");', 'out.add("campaign_unbacked");', T_GUARDA),
    ("M448", '«no tengo el historial de promociones» se toma por afirmar que no existen', ANCL_C, '|cerca|historial|registro|registros|antecedentes|memoria|recuerdo|archivo)', '|cerca)', T_GUARDA),
    # --- Piloto por número ---------------------------------------------------------------------------------------------------------------------
    ("M449", 'el contacto del piloto también pierde las herramientas', PILOTO_TS, 'if (!piloto || piloto.includes(waId)) return deps;', 'if (!piloto) return deps;', T_ARIA),
    ("M450", 'sin piloto (abierto a todos) nadie recibe las herramientas', PILOTO_TS, 'if (!piloto || piloto.includes(waId)) return deps;', 'if (piloto && piloto.includes(waId)) return deps;', T_ARIA),
    ("M451", 'un contacto fuera del piloto conserva las herramientas comerciales', PILOTO_TS, '  return { ...deps, config: { ...deps.config, tools: deps.config.tools.filter((t) => !esHerramientaComercial(t)) } };', '  return deps;', T_ARIA),
    ("M452", 'a un contacto fuera del piloto solo se le quita UNA herramienta comercial', PILOTO_TS, 'tools: deps.config.tools.filter((t) => !esHerramientaComercial(t))', 'tools: deps.config.tools.filter((t) => t !== "consultar_ofertas")', T_ARIA),
    ("M453", 'el runtime no aplica el piloto', RUNTIME, 'let deps = aplicarPilotoComercial(depsEntrada, input.waId);', 'let deps = depsEntrada;', T_ARIA),
    ("M454", 'el runtime compara el piloto con otro dato del mensaje (no con el número del contacto)', RUNTIME, 'let deps = aplicarPilotoComercial(depsEntrada, input.waId);', 'let deps = aplicarPilotoComercial(depsEntrada, input.wamid);', T_ARIA),
    ("M455", 'el esquema acepta un piloto vacío', CONFIG_TS, '{7,14}$/)).min(1).max(20).optional()', '{7,14}$/)).max(20).optional()', T_PILOTO),
    ("M456", 'el esquema acepta más de 20 números de piloto', CONFIG_TS, '{7,14}$/)).min(1).max(20).optional()', '{7,14}$/)).min(1).max(200).optional()', T_PILOTO),
    ("M457", 'el esquema acepta cualquier texto como número de piloto', CONFIG_TS, 'z.array(z.string().regex(/^[1-9][0-9]{7,14}$/))', 'z.array(z.string())', T_PILOTO),
    ("M458", 'el script 05 habilita las herramientas sin números de piloto (las abre al público)', SQL05, "if v_piloto_txt = '' then", 'if false then', T_M05),
    ("M459", 'el script 05 acepta un celular sin el indicativo (nunca coincidiría con un número de WhatsApp)', SQL05, "if v_n ~ '^3[0-9]{9}$' then", 'if false then', T_M05),
    ("M460", 'el script 05 acepta cualquier texto como número de piloto', SQL05, "if v_n !~ '^[1-9][0-9]{7,14}$' then", 'if false then', T_M05),
    ("M461", 'el script 05 admite más de 20 números de piloto', SQL05, 'if cardinality(v_numeros) > 20 then', 'if false then', T_M05),
    ("M462", 'el script 05 cuenta los números de piloto repetidos', SQL05, 'array_agg(distinct u.n order by u.n)', 'array_agg(u.n order by u.n)', T_M05),
    ("M463", 'el script 05 no guarda el piloto (las herramientas quedarían abiertas a todos)', SQL05, "negocio = jsonb_set(negocio, '{comercial_piloto}', to_jsonb(v_numeros), true),", 'negocio = negocio,', T_M05),
    ("M464", 'el script 05 repetido con OTROS números no los cambia', SQL05, "if v_nuevas is null and (v_cfg.negocio->'comercial_piloto') is not distinct from to_jsonb(v_numeros) then", 'if v_nuevas is null then', T_M05),
    ("M465", 'el script 05 acepta volver a un piloto con las herramientas ya abiertas a todos (los textos retirados del prompt se perderían para los demás)', SQL05, "if v_cfg.herramientas @> array['consultar_ofertas', 'consultar_combos', 'consultar_campanas', 'consultar_contenido_comercial']::text[] and (v_cfg.negocio->'comercial_piloto') is null then", 'if false then', T_M05),
    ("M466", 'el script 05b abre a todos sin que las herramientas estén habilitadas', SQL05B, "if not (v_cfg.herramientas @> array['consultar_ofertas', 'consultar_combos', 'consultar_campanas', 'consultar_contenido_comercial']::text[]) then", 'if false then', T_M05B),
    ("M467", 'el script 05b abre a todos sin ningún texto publicado', SQL05B, 'if v_publicados = 0 then', 'if false then', T_M05B),
    ("M468", 'el script 05b abre a todos con temas críticos sin publicar', SQL05B, "if v_sin_publicar is not null and coalesce(current_setting('dulabs.permitir_temas_sin_publicar', true), '') <> 'si' then", 'if false then', T_M05B),
    ("M469", 'el script 05b borra más que el piloto', SQL05B, "set negocio = negocio - 'comercial_piloto', updated_at = now()", "set negocio = '{}'::jsonb, updated_at = now()", T_M05B),
    ("M470", 'el script 05b repetido cambia la configuración (la fecha de actualización)', SQL05B, "if (v_cfg.negocio->'comercial_piloto') is null then", 'if false then', T_M05B),
    ("M471", 'la reversa del 05 deja el piloto en la configuración', SQL05R, "negocio = negocio - 'comercial_piloto',", 'negocio = negocio,', T_M05R),
    ("M472", 'la reversa del 05 no limpia un piloto que quedó sin herramientas', SQL05R, " or (negocio->'comercial_piloto') is not null);", ');', T_M05R),
    ("M473", 'el script 06 retira textos del prompt con las herramientas todavía en piloto', SQL06, "if (v_cfg.negocio->'comercial_piloto') is not null then", 'if false then', T_M06),
    ("M474", 'el estado (07) dice «abiertas a todos» aunque haya piloto', SQL07, "when (select negocio->'comercial_piloto' from aria) is null then 'abiertas a TODOS los clientes'", "when true then 'abiertas a TODOS los clientes'", T_M07),
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
