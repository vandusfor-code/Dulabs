"""Pie de página editable y páginas propias de la tienda (tipos «pie» y «pagina» del CMS) — pruebas de mutación. Se quita o se invierte UNA protección a la vez; alguna prueba DEBE fallar; luego se restaura el archivo.
Si una mutación NO se detecta, la protección se podía eliminar sin que nadie se enterara: las pruebas son insuficientes y hay que reforzarlas.

Uso (desde la raíz del repo; sin red ni base de datos real: el SQL corre en Postgres embebido, PGlite):
    python3 scripts/mutacion/pie.py               # todas
    python3 scripts/mutacion/pie.py --verificar   # solo comprueba que cada patrón aplica exactamente una vez
    python3 scripts/mutacion/pie.py P12 P40       # solo esas

Cubre: la seguridad de los enlaces (solo https, sin usuario ni puerto, sin red local ni dominios disfrazados, el dominio de cada red), el esquema estricto del pie (límites, destinos,
contacto, redes), la validación antes de publicar (enlace mayorista, categorías, avisos), el servicio (uno por negocio, aviso sin migración), el lector, el pie resuelto contra la tienda
(destinos que no existen, cinturón doble), su carga con respaldo, el SQL real (migración y reversa), el dibujo del pie (rejilla, enlaces externos, redes) y el panel (formulario,
pestañas, preguntas frecuentes y contexto de la tienda). Las páginas propias: su esquema y topes, la validación (HTML, enlace mayorista, enlaces del pie), el texto ↔ bloques, su carga, el lector,
el servicio, el HTML de la tienda y el panel (formulario, vista previa, historial y el selector del pie)."""
import atexit
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

C = "lib/cms-comercial/"
ENLACES, ESQ, VALID, SERV, LECTOR, PIE, PIEPUB = (C + n for n in ("enlaces.ts", "esquemas.ts", "validacion.ts", "servicio.ts", "lector.ts", "pie.ts", "pie-publico.ts"))
ADAPT = C + "adaptadores-supabase.ts"
PAGINA, PAGPUB, CONTRATO = C + "pagina.ts", C + "pagina-publica.ts", C + "contrato.ts"
SQL = "supabase/migrations/20261211000000_dulabs_cms_pie_y_paginas.sql"
SQLR = "supabase/rollbacks/20261211000000_dulabs_cms_pie_y_paginas.down.sql"
TIENDA = "components/catalogo-publico/tienda/joyeria/"
PIEJ, ICONOS, PAGHTML = TIENDA + "PieJoyeria.tsx", TIENDA + "IconosRedes.tsx", TIENDA + "PaginaTienda.tsx"
UI = "components/dashboard/tienda/"
FORMPIE, TIENDAAPP, PREGUNTAS, UIBASE = UI + "formulario-pie.tsx", UI + "TiendaApp.tsx", UI + "preguntas.tsx", UI + "ui.tsx"
FORMPAG, FORMATO, EDITOR, USARPAG, LISTA = UI + "formulario-pagina.tsx", UI + "formato.ts", UI + "editor.tsx", UI + "usar-paginas.ts", UI + "lista.tsx"
RUTA_CTX = "app/api/dashboard/tienda/contexto/route.ts"

T_ENL = [C + "enlaces.test.ts"]
T_ESQ = [C + "pie-esquema.test.ts"]
T_PIE = [C + "pie.test.ts", TIENDA + "pie-cms.test.tsx"]
T_PUB = [C + "pie-publico.test.ts"]
T_SERV = [C + "pie-servicio.pglite.test.ts", C + "servicio.pglite.test.ts"]
T_SQL = [C + "pie-y-paginas-sql.pglite.test.ts"]
T_PAG = [C + "pagina.test.ts"]
T_PAG_ESQ = [C + "pagina-esquema.test.ts"]
T_PAG_PUB = [C + "pagina-publica.test.ts"]
T_PAG_SERV = [C + "pagina-servicio.pglite.test.ts"]
T_PAG_DOM = [UI + "pagina.dom.test.tsx"]
T_PAG_HTML = [TIENDA + "pagina-tienda.test.tsx"]
T_FMT = [UI + "borrador-formato.test.ts"]
T_PIEJ = [TIENDA + "pie-cms.test.tsx", TIENDA + "pie-dorado.test.tsx"]
T_DOM = [UI + "pie.dom.test.tsx"]
T_CTX = ["app/api/dashboard/tienda/contexto.test.ts"]

# (id, descripción, archivo, texto a buscar (exactamente UNA vez), reemplazo, pruebas que deben detectarlo)
M = [
    # --- enlaces.ts: la seguridad de una dirección externa ---
    ("P01", "se aceptan direcciones http (sin cifrar)", ENLACES, r'if (!/^https:\/\//i.test(valor)) return false;', "", T_ENL),
    ("P02", "se aceptan barras invertidas en la dirección (cada navegador las entiende distinto)", ENLACES, 'if (tieneEspacioOControl(valor) || valor.includes("\\\\")) return false;', "if (tieneEspacioOControl(valor)) return false;", T_ENL),
    ("P03", "se acepta usuario y clave dentro de la dirección (https://instagram.com@sitio-malo.com)", ENLACES, 'u.username !== "" || u.password !== "" || ', "", T_ENL),
    ("P04", "se acepta un puerto en la dirección", ENLACES, ' || u.port !== "") return false;', ") return false;", T_ENL),
    ("P05", "se aceptan direcciones numéricas (IP)", ENLACES, ' || IPV4.test(host)) return false;', ") return false;", T_ENL),
    ("P06", "se acepta un nombre sin punto (localhost, intranet)", ENLACES, '!host.includes(".") || ', "", T_ENL),
    ("P07", "se aceptan nombres de la red local (.local, .internal…)", ENLACES, ' || SUFIJOS_INTERNOS.test(host)) return false;', ") return false;", T_ENL),
    ("P08", "se aceptan dominios con letras disfrazadas (punycode)", ENLACES, 'parte.startsWith("xn--")', "false", T_ENL),
    ("P09", "no hay tope de largo en la dirección", ENLACES, "valor.length > MAX_LARGO_URL", "false", T_ENL),
    ("P10", "una red acepta cualquier dominio que CONTENGA el suyo (instagram.com.sitio-malo.com)", ENLACES, "host === dominio || host.endsWith(`.${dominio}`)", "host.includes(dominio)", T_ENL),
    ("P11", "una dirección ilegible se da por buena para una red", ENLACES, "if (host === null) return false;\n  return DOMINIOS_RED", "if (host === null) return true;\n  return DOMINIOS_RED", T_ENL),
    ("P12", "un teléfono acepta más de 15 dígitos", ENLACES, "digitos >= 7 && digitos <= 15", "digitos >= 7", T_ENL),
    ("P13", "el enlace de teléfono pierde el + inicial", ENLACES, 'valor.trim().startsWith("+") ? "+" : ""', '""', T_ENL),
    ("P14", "una publicación de Instagram se toma por un perfil", ENLACES, "NO_PERFIL.has(limpio.toLowerCase()) ? null : `@${limpio}`", "`@${limpio}`", T_ENL),
    ("P15", "el perfil de TikTok sale sin la @", ENLACES, "`https://tiktok.com/@${usuario}`", "`https://tiktok.com/${usuario}`", T_ENL),
    ("P16", "una dirección de varias líneas cuenta una menos", ENLACES, 'valor.split("\\n").length', 'valor.split("\\n").length - 1', T_ESQ),
    # --- esquemas.ts: el pie ---
    ("P17", "se admiten más de 3 columnas de enlaces", ESQ, '.max(3, { message: "Máximo 3 columnas de enlaces." })', '.max(30, { message: "Máximo 3 columnas de enlaces." })', T_ESQ),
    ("P18", "una columna puede quedar sin enlaces", ESQ, '.min(1, { message: "Una columna necesita al menos un enlace." })', '.min(0, { message: "Una columna necesita al menos un enlace." })', T_ESQ),
    ("P19", "se admiten más de 10 enlaces por columna", ESQ, '.max(10, { message: "Máximo 10 enlaces por columna." })', '.max(100, { message: "Máximo 10 enlaces por columna." })', T_ESQ),
    ("P20", "se admiten más de 8 redes sociales", ESQ, '.max(8, { message: "Máximo 8 redes sociales." })', '.max(80, { message: "Máximo 8 redes sociales." })', T_ESQ),
    ("P21", "una red social puede repetirse", ESQ, '.refine((r) => sinRepetidos(r.map((x) => x.red)), { message: "Una red social no puede repetirse." })', ".refine(() => true)", T_ESQ),
    ("P22", "una red acepta la dirección de otro dominio", ESQ, "if (!perteneceARed(r.red, r.url))", "if (false)", T_ESQ),
    ("P23", "el destino «externo» acepta cualquier texto", ESQ, 'url: urlExterna("La dirección del enlace") }),', "url: z.string() }),", T_ESQ),
    ("P24", "las direcciones externas no pasan por la revisión de enlaces", ESQ, ".refine(esUrlHttpsSegura, {", ".refine(() => true, {", T_ESQ),
    ("P25", "el correo no se revisa", ESQ, ".refine(esCorreoValido,", ".refine(() => true,", T_ESQ),
    ("P26", "el teléfono no se revisa", ESQ, ".refine(esTelefonoValido,", ".refine(() => true,", T_ESQ),
    ("P27", "la dirección admite más de 3 líneas", ESQ, "numeroDeLineas(s) <= 3", "numeroDeLineas(s) <= 30", T_ESQ),
    ("P28", "el destino «mayoristas» no existe en el esquema", ESQ, 'z.strictObject({ tipo: z.literal("mayoristas") }),', "", T_ESQ),
    ("P29", "el borrador del pie no deja guardar sus propias claves", ESQ, "pie: Object.keys(pieSchema.shape),", "pie: [],", T_ESQ),
    # --- validacion.ts ---
    ("P30", "el enlace del catálogo mayorista no se busca en el pie ni en las páginas", VALID, 'if (tipo === "pie" || tipo === "pagina") revisarEnlaceMayoristaVisible(tipo, borrador, err);', "", T_ESQ + T_PAG_ESQ),
    ("P31", "el pie y las páginas aceptan el enlace del catálogo mayorista (lo verían todos)", VALID, 'if (contieneEnlaceMayorista(texto)) err(', 'if (false) err(', T_ESQ + T_PAG_ESQ),
    ("P32", "las categorías de los enlaces del pie no se comprueban", VALID, '} else if (tipo === "pie") {', "} else if (false) {", T_ESQ),
    ("P33", "no avisa de un contacto vacío", VALID, "if (contactoVacio) adv(", "if (false) adv(", T_ESQ),
    ("P34", "no avisa de un pie vacío", VALID, 'if (!hayAlgo) adv("pie_vacio"', 'if (false) adv("pie_vacio"', T_ESQ),
    # --- servicio.ts y lector.ts ---
    ("P35", "el pie no es único por negocio (su código sale del nombre)", SERV, 'const unico = input.tipo === "home" || input.tipo === "pie";', 'const unico = input.tipo === "home";', T_SERV),
    ("P36", "el tope del pie no es uno", SERV, "pie: 1, pagina: 30 }", "pie: 9, pagina: 30 }", T_SERV),
    ("P37", "sin la migración el aviso de crear el pie dice «el contenido no es válido»", SERV, 'if (input.tipo === "pie" || input.tipo === "pagina") throw new CmsError("FEATURE_UNAVAILABLE"', 'if (input.tipo === "pagina") throw new CmsError("FEATURE_UNAVAILABLE"', T_SERV),
    ("P38", "el resumen de un contenido no trae su orden", SERV, 'orden: e.tipo === "contenido" && typeof mostrado.orden === "number" ? mostrado.orden : null,', "orden: null,", T_DOM),
    ("P39", "el lector acepta dos pies", LECTOR, 'if (pie !== null) descartar("repetida");', 'if (false) descartar("repetida");', T_PUB),
    ("P40", "el lector no entrega el pie", LECTOR, "snap: { ...instantaneaVacia(tenantId), home, pie, paginas, ofertas,", "snap: { ...instantaneaVacia(tenantId), home, paginas, ofertas,", T_PUB),
    # --- pie.ts: lo que dibuja el pie ---
    ("P41", "«Mayoristas» sale aunque la tienda no tenga mayoristas", PIE, "return ctx.mayoristaHref ? { href: ctx.mayoristaHref, externo: false } : null;", 'return { href: ctx.mayoristaHref ?? "", externo: false };', T_PIE),
    ("P42", "una categoría borrada sigue enlazada", PIE, "ctx.categorias.some((c) => c.id === destino.categoria_id) ?", "true ?", T_PIE),
    ("P43", "WhatsApp se abre en la misma pestaña", PIE, "return ctx.whatsappHref ? { href: ctx.whatsappHref, externo: true } : null;", "return ctx.whatsappHref ? { href: ctx.whatsappHref, externo: false } : null;", T_PIE),
    ("P44", "una dirección externa insegura llega al navegador", PIE, "return esUrlHttpsSegura(destino.url) ? { href: destino.url, externo: true } : null;", "return { href: destino.url, externo: true };", T_PIE),
    ("P45", "una red con dominio equivocado llega al navegador", PIE, "if (!esUrlHttpsSegura(r.url) || !perteneceARed(r.red, r.url)) continue;", "", T_PIE),
    ("P46", "una columna sin ningún enlace disponible sale vacía", PIE, "if (enlaces.length > 0) columnas.push(", "if (true) columnas.push(", T_PIE),
    ("P47", "las categorías salen aunque la administradora las apagó", PIE, "categorias: pie.mostrar_categorias ? categoriasDelPie(ctx) : null,", "categorias: categoriasDelPie(ctx),", T_PIE),
    ("P48", "el contacto por WhatsApp sale aunque no se pidió", PIE, "whatsapp: c.whatsapp ? ctx.whatsappHref : null,", "whatsapp: ctx.whatsappHref,", T_PIE),
    ("P49", "un contacto sin nada que mostrar sale igual", PIE, "return hayAlgo ? vista : null;", "return vista;", T_PIE),
    ("P50", "la columna de categorías sale sin categorías", PIE, "if (ctx.categorias.length === 0) return null;", "", T_PIE),
    ("P51", "no hay «Ver todas» con muchas categorías", PIE, "if (ctx.categorias.length > CATEGORIAS_EN_PIE) enlaces.push(", "if (false) enlaces.push(", T_PIE),
    ("P52", "la dirección sale en una sola línea", PIE, 'c.direccion.split("\\n").filter((l) => l.trim() !== "")', "[c.direccion]", T_PIE),
    ("P53", "la línea de derechos ignora lo que escribió la administradora", PIE, "derechos ?? `${marca}. Todos los derechos reservados.`", "`${marca}. Todos los derechos reservados.`", T_PIE),
    ("P54", "el pie de arranque trae «Mayoristas» aunque la tienda no tenga", PIE, '...(opciones.mayoristas ? [{ texto: "Mayoristas", destino: { tipo: "mayoristas" as const } }] : []),', '{ texto: "Mayoristas", destino: { tipo: "mayoristas" as const } },', T_PIE),
    ("P55", "las redes salen sin su usuario", PIE, "usuario: usuarioDeRed(r.red, r.url) }", "usuario: null }", T_PIE),
    # --- pie-publico.ts ---
    ("P56", "la carga no entrega el pie publicado", PIEPUB, "pie: snap.pie?.contenido ?? null,", "pie: null,", T_PUB),
    ("P57", "un error de la base de datos no deja aviso", PIEPUB, "    avisar(deps, error);\n    return sinDatos();", "    return sinDatos();", T_PUB),
    ("P58", "una tienda que no existe también lee el CMS", PIEPUB, "if (!tenantId) return sinDatos();", "", T_PUB),
    # --- SQL: migración y reversa ---
    ("P59", "el pie puede llamarse de cualquier forma (no solo «pie»)", SQL, "check (tipo <> 'pie' or clave = 'pie')", "check (true)", T_SQL),
    ("P60", "la base no admite el tipo «pie»", SQL, "check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie', 'pagina'))", "check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pagina'))", T_SQL),
    ("P61", "el historial no admite el tipo «pie»", SQL, "check (entidad_tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie', 'pagina', 'imagen'))", "check (entidad_tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pagina', 'imagen'))", T_SQL),
    ("P62", "la migración corre sin la migración base", SQL, "if to_regclass('public.dulabs_cms_entidades') is null or to_regclass('public.dulabs_cms_auditoria') is null then", "if false then", T_SQL),
    ("P63", "la reversa borra la posibilidad de volver atrás aunque ya exista un pie o una página", SQLR, "if v_elementos > 0 or v_historial > 0 then", "if false then", T_SQL),
    ("P64", "la reversa no vuelve a estrechar los tipos", SQLR, "check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido'));", "check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie'));", T_SQL),
    # --- PieJoyeria.tsx e IconosRedes.tsx ---
    ("P65", "un enlace externo del pie no lleva rel=noopener noreferrer", PIEJ, '<a href={enlace.href} target="_blank" rel="noopener noreferrer" className={ENLACE}>', '<a href={enlace.href} target="_blank" className={ENLACE}>', T_PIEJ),
    ("P66", "los iconos de redes no tienen nombre para lectores de pantalla", PIEJ, "aria-label={r.etiqueta} title={r.etiqueta}", "title={r.etiqueta}", T_PIEJ),
    ("P67", "con cuatro bloques la rejilla no cambia", PIEJ, "bloques.length === 4 ?", "bloques.length === 3 ?", T_PIEJ),
    ("P68", "sin bloques queda una rejilla vacía", PIEJ, "{bloques.length > 0 && <div", "{true && <div", T_PIEJ),
    ("P69", "las categorías no salen en el pie publicado", PIEJ, "if (v.categorias) bloques.push(", "if (false) bloques.push(", T_PIEJ),
    ("P70", "las redes no salen en el pie publicado", PIEJ, "if (v.redes.length > 0) bloques.push(", "if (false) bloques.push(", T_PIEJ),
    ("P71", "no se muestran los usuarios bajo los iconos", PIEJ, "const usuarios = redes.flatMap((r) => (r.usuario ? [r.usuario] : []));", "const usuarios: string[] = [];", T_PIEJ),
    ("P72", "el pie ignora lo publicado y dibuja siempre el de siempre", PIEJ, "    vista ??\n", "", T_PIEJ),
    ("P73", "la dirección sale pegada, sin una línea por renglón", PIEJ, '<span key={i} className="block">', "<span key={i}>", T_PIEJ),
    ("P74", "el icono de Facebook desaparece", ICONOS, 'facebook: <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />,', "facebook: <></>,", T_PIEJ),
    ("P75", "los iconos se anuncian a los lectores de pantalla", ICONOS, "className={className} aria-hidden>", "className={className}>", T_PIEJ),
    # --- panel ---
    ("P76", "al salir del campo no se completa el @usuario", UIBASE, "onBlur={onSalir} ", "", T_DOM),
    ("P77", "el @usuario no se convierte en la dirección del perfil", FORMPIE, "if (url && url !== r.url) cambiarRed(i, { url });", "", T_DOM),
    ("P78", "el pie y las páginas se ofrecen en cualquier tienda", TIENDAAPP, '...(tienda?.tema === "joyeria"', "...(true", T_DOM + T_PAG_DOM),
    ("P79", "las preguntas se ofrecen en cualquier tienda", TIENDAAPP, "...(tienda?.paginaMayoristas ? [", "...(true ? [", T_DOM),
    ("P80", "las preguntas no se ordenan por su número", PREGUNTAS, ".sort(porOrden);", ";", T_DOM),
    ("P81", "una pregunta nueva no va al final del orden", PREGUNTAS, "Math.max(m, p.orden ?? 0)", "m", T_DOM),
    ("P82", "una pregunta nueva no es del tema Mayoristas", PREGUNTAS, "tema: TEMA_PREGUNTAS, audiencia:", 'tema: "faq", audiencia:', T_DOM),
    ("P83", "lo que no se muestra en la página aparece mezclado con las preguntas", PREGUNTAS, "const noSeMuestran = todos.filter((i) => omitidas.has(i.clave));", "const noSeMuestran: EntidadResumen[] = [];", T_DOM),
    # --- contexto de la tienda ---
    ("P84", "el contexto dice que toda tienda es de tema joyería", RUTA_CTX, "tema: temaDe(config),", 'tema: "joyeria" as const,', T_CTX),
    ("P85", "el contexto dice que toda tienda tiene mayoristas", RUTA_CTX, "mayoristas: Boolean(joyeria?.mayoristas),", "mayoristas: true,", T_CTX),
    ("P86", "el contexto usa el nombre público en vez del de la marca", RUTA_CTX, "nombre: config.brand?.name ?? publicada.nombre,", "nombre: publicada.nombre,", T_CTX),
    ("P87", "el contexto da la tienda aunque no esté publicada", ADAPT, "return publicacion?.published ? { slug: publicacion.slug, nombre: publicacion.publicName } : null;", "return publicacion ? { slug: publicacion.slug, nombre: publicacion.publicName } : null;", T_CTX),
    # --- páginas propias: esquema, validación, servicio y lector ---
    ("P88", "el tope de páginas por negocio no es 30", SERV, "pie: 1, pagina: 30 }", "pie: 1, pagina: 99 }", T_SERV + T_PAG_SERV),
    ("P89", "sin la migración el aviso de crear una página dice «el contenido no es válido»", SERV, 'if (input.tipo === "pie" || input.tipo === "pagina") throw new CmsError("FEATURE_UNAVAILABLE"', 'if (input.tipo === "pie") throw new CmsError("FEATURE_UNAVAILABLE"', T_PAG_SERV),
    ("P90", "el lector no entrega las páginas", LECTOR, "snap: { ...instantaneaVacia(tenantId), home, pie, paginas, ofertas,", "snap: { ...instantaneaVacia(tenantId), home, pie, ofertas,", T_PAG_PUB),
    ("P91", "la carga del pie no entrega las páginas publicadas", PIEPUB, "paginas: clavesDePaginas(snap) }", "paginas: [] }", T_PUB + T_PAG_PUB),
    ("P92", "la base no admite el tipo «pagina»", SQL, "check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie', 'pagina'))", "check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie'))", T_SQL),
    ("P93", "el historial no admite el tipo «pagina»", SQL, "check (entidad_tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie', 'pagina', 'imagen'))", "check (entidad_tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie', 'imagen'))", T_SQL),
    ("P96", "la reversa deja entrar las páginas aunque se revirtió la migración", SQLR, "check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido'));", "check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pagina'));", T_SQL),
    ("P97", "se acepta HTML en el texto de una página", ESQ, ".refine((s) => !contieneHtml(s), {", ".refine(() => true, {", T_PAG_ESQ),
    ("P98", "un párrafo admite campos de más (por ejemplo un enlace escondido)", ESQ, 'z.strictObject({ tipo: z.literal("parrafo"), texto:', 'z.object({ tipo: z.literal("parrafo"), texto:', T_PAG_ESQ),
    ("P99", "no hay tope de largo de un párrafo", ESQ, 'texto("El párrafo", MAX_PARRAFO_PAGINA)', 'texto("El párrafo", 99999)', T_PAG_ESQ + T_PAG),
    ("P100", "una lista puede quedar vacía", ESQ, '.min(1, { message: "Una lista necesita al menos un elemento." })', '.min(0, { message: "Una lista necesita al menos un elemento." })', T_PAG_ESQ),
    ("P101", "una lista admite cualquier cantidad de elementos", ESQ, ".max(MAX_ELEMENTOS_LISTA_PAGINA, {", ".max(99999, {", T_PAG_ESQ + T_PAG),
    ("P102", "una página puede publicarse sin texto", ESQ, '.min(1, { message: "Escribe el texto de la página." })', '.min(0, { message: "Escribe el texto de la página." })', T_PAG_ESQ),
    ("P103", "no hay tope de bloques por página", ESQ, ".max(MAX_BLOQUES_PAGINA, { message: MENSAJE_PAGINA_CON_MUCHOS_BLOQUES })", ".max(99999, { message: MENSAJE_PAGINA_CON_MUCHOS_BLOQUES })", T_PAG_ESQ),
    ("P104", "no hay tope de caracteres por página", ESQ, "if (caracteresDePagina(p.bloques) > MAX_CARACTERES_PAGINA)", "if (false)", T_PAG_ESQ),
    ("P105", "las listas no cuentan para el tope de caracteres de la página", ESQ, 'b.tipo === "lista" ? b.items.reduce((m, i) => m + i.length, 0) : b.texto.length', 'b.tipo === "lista" ? 0 : b.texto.length', T_PAG_ESQ + T_PAG),
    ("P106", "una página puede llamarse de una sola letra", ESQ, 'texto("El título de la página", 80, 3)', 'texto("El título de la página", 80, 1)', T_PAG_ESQ),
    ("P107", "el destino «pagina» acepta cualquier texto como código", ESQ, 'z.strictObject({ tipo: z.literal("pagina"), clave: claveSchema })', 'z.strictObject({ tipo: z.literal("pagina"), clave: z.string() })', T_PAG_ESQ),
    ("P108", "el enlace del catálogo mayorista no se busca en las páginas", VALID, 'if (tipo === "pie" || tipo === "pagina") revisarEnlaceMayoristaVisible(', 'if (tipo === "pie") revisarEnlaceMayoristaVisible(', T_PAG_ESQ),
    ("P109", "el enlace del catálogo mayorista no se busca en el pie", VALID, 'if (tipo === "pie" || tipo === "pagina") revisarEnlaceMayoristaVisible(', 'if (tipo === "pagina") revisarEnlaceMayoristaVisible(', T_ESQ),
    ("P110", "el pie no anota de qué páginas depende", VALID, 'tipo === "campana" || tipo === "pagina") && cadena(o.clave))', 'tipo === "campana") && cadena(o.clave))', T_PAG_ESQ),
    ("P111", "un enlace a una página sin publicar no avisa", VALID, 'if (el.estado !== "publicada") adv("pagina_no_publicada"', 'if (false) adv("pagina_no_publicada"', T_PAG_ESQ + T_PAG_SERV),
    ("P112", "un enlace a una página sin publicar impide publicar el pie", VALID, 'adv("pagina_no_publicada"', 'err("pagina_no_publicada"', T_PAG_ESQ),
    ("P113", "el nombre de una página no sale de su título", CONTRATO, 'tipo === "contenido" || tipo === "pagina" ? c.titulo : c.nombre', 'tipo === "contenido" ? c.titulo : c.nombre', T_PAG_ESQ),
    ("P114", "las páginas son únicas por negocio (su código sale del tipo)", SERV, 'const unico = input.tipo === "home" || input.tipo === "pie";', 'const unico = input.tipo === "home" || input.tipo === "pie" || input.tipo === "pagina";', T_PAG_SERV),
    ("P115", "el lector no clasifica las páginas", LECTOR, 'paginas.push({ ...base, contenido: parseo.data as PublicadaCms<"pagina">["contenido"] });', "", T_PAG_PUB),
    # --- pagina.ts: el texto ↔ los bloques, la dirección, lo que se muestra ---
    ("P116", "«####» se toma por un subtítulo", PAGINA, r"const SUBTITULO = /^#{1,3}[ \t]+(\S.*)$/;", r"const SUBTITULO = /^#{1,6}[ \t]+(\S.*)$/;", T_PAG),
    ("P117", "«•» y «*» no son marcas de lista", PAGINA, r"const ELEMENTO = /^[ \t]*[-•*][ \t]+(\S.*)$/;", r"const ELEMENTO = /^[ \t]*[-][ \t]+(\S.*)$/;", T_PAG),
    ("P118", "una línea en blanco no corta la lista", PAGINA, "cerrarParrafo();\n      cerrarLista();\n      continue;", "cerrarParrafo();\n      continue;", T_PAG),
    ("P119", "las líneas de un párrafo conservan su sangría", PAGINA, "parrafo.push(linea.trim());", "parrafo.push(linea);", T_PAG),
    ("P120", "no se reconocen los fines de línea de Windows", PAGINA, r'entrada.replace(/\r\n?/g, "\n")', "entrada", T_PAG),
    ("P121", "el código de una página puede empezar con guion", PAGINA, r"/^[a-z0-9][a-z0-9-]{0,79}$/.test(valor)", r"/^[a-z0-9-]{1,80}$/.test(valor)", T_PAG),
    ("P122", "la dirección de una página no lleva /p/", PAGINA, "`${basePath}/${SEGMENTO_PAGINAS}/${clave}`", "`${basePath}/${clave}`", T_PAG + T_PIE),
    ("P123", "la fecha de actualización es la de creación", PAGINA, "actualizadaAt: p.publicadaAt }", "actualizadaAt: p.creadaAt }", T_PAG),
    ("P124", "el comienzo de un bloque no se recorta", PAGINA, "return texto.length > 40 ?", "return texto.length > 4000 ?", T_PAG),
    ("P125", "un bloque cambiado cuenta dos veces (se quita y se agrega)", PAGINA, "const cambiados = Math.max(quitados, nuevos);", "const cambiados = quitados + nuevos;", T_PAG + T_FMT),
    ("P126", "dos textos de distinto largo se toman por iguales", PAGINA, "a.length === b.length && a.every(", "a.every(", T_PAG),
    ("P127", "un bloque con elementos que no son texto se cuela en el formulario", PAGINA, 'items.every((i) => typeof i === "string")', "true", T_PAG),
    ("P128", "los problemas del texto no se calculan con el esquema", PAGINA, "if (r.success) continue;", "continue;", T_PAG),
    ("P129", "la fecha de la página se dice en hora de Greenwich", PAGINA, 'timeZone: "America/Bogota"', 'timeZone: "UTC"', T_PAG),
    ("P130", "el pie no sabe qué páginas están publicadas", PAGINA, "(snap?.paginas ?? []).map((p) => p.clave)", "[]", T_PAG + T_PAG_PUB),
    ("P131", "la página que se muestra es la primera, no la del código", PAGINA, "snap?.paginas.find((x) => x.clave === clave)", "snap?.paginas[0]", T_PAG + T_PAG_PUB),
    # --- pagina-publica.ts ---
    ("P132", "un código que no es un código también consulta la base", PAGPUB, 'if (!esClavePagina(clave)) return { estado: "no_existe" };', "", T_PAG_PUB),
    ("P133", "un fallo de la base se hace pasar por «la página no existe»", PAGPUB, 'return { estado: "error" };', 'return { estado: "no_existe" };', T_PAG_PUB),
    ("P134", "una tienda que no existe también lee el CMS", PAGPUB, 'if (!tenantId) return { estado: "no_existe" };', "", T_PAG_PUB),
    ("P135", "un fallo al leer una página no deja aviso", PAGPUB, '    avisar(deps, error);\n    return { estado: "error" };', '    return { estado: "error" };', T_PAG_PUB),
    ("P136", "el plazo de una página no es de 2,5 s", PAGPUB, "export const PLAZO_PAGINA_MS = 2500;", "export const PLAZO_PAGINA_MS = 25000;", T_PAG_PUB),
    # --- pie.ts: el enlace a una página ---
    ("P137", "una página sin publicar sigue enlazada en el pie", PIE, "return (ctx.paginas ?? []).includes(destino.clave) ? { href: rutaPagina(ctx.basePath, destino.clave), externo: false } : null;", "return { href: rutaPagina(ctx.basePath, destino.clave), externo: false };", T_PIE),
    ("P138", "el enlace a una página se abre en una pestaña nueva", PIE, "{ href: rutaPagina(ctx.basePath, destino.clave), externo: false }", "{ href: rutaPagina(ctx.basePath, destino.clave), externo: true }", T_PIE + T_PIEJ),
    ("P139", "el enlace a una página lleva a la raíz de la tienda", PIE, "{ href: rutaPagina(ctx.basePath, destino.clave), externo: false }", "{ href: ctx.basePath, externo: false }", T_PIE),
    # --- PaginaTienda.tsx ---
    ("P140", "el texto de una página se dibuja como HTML", PAGHTML, "<p key={i} className={TEXTO}>", "<p key={i} className={TEXTO} dangerouslySetInnerHTML={{ __html: b.texto }}>", T_PAG_HTML),
    ("P141", "los saltos de línea de un párrafo se pierden", PAGHTML, 'const TEXTO = "whitespace-pre-line [overflow-wrap:anywhere]";', 'const TEXTO = "[overflow-wrap:anywhere]";', T_PAG_HTML),
    ("P142", "la fecha de actualización no se muestra", PAGHTML, '{fecha && <p className="mt-5 text-xs text-mist">Última actualización: {fecha}</p>}', "", T_PAG_HTML),
    # --- panel: el formulario de la página, el pie y el historial ---
    ("P143", "lo que se escribe no se convierte en bloques", FORMPAG, 'poner("bloques", bloquesDeTexto(valor));', "", T_PAG_DOM),
    ("P144", "el campo pisa lo que se está escribiendo", FORMPAG, "if (!mismosBloques(bloquesDeTexto(escritoAhora.current), bloques)) setEscrito(delBorrador);", "if (true) setEscrito(delBorrador);", T_PAG_DOM),
    ("P145", "el campo no adopta el texto del borrador cuando cambia por otra causa (descartar, restaurar)", FORMPAG, "if (!mismosBloques(bloquesDeTexto(escritoAhora.current), bloques)) setEscrito(delBorrador);", "if (false) setEscrito(delBorrador);", T_PAG_DOM),
    ("P146", "«Agregar un subtítulo» pega la marca al texto", FORMPAG, r"`${base}\n\n${marca}`", "`${base}${marca}`", T_PAG_DOM),
    ("P147", "los problemas del texto no salen mientras se escribe", FORMPAG, "[...problemasDeBloques(bloques), ...delServidor]", "[...delServidor]", T_PAG_DOM),
    ("P148", "los problemas de la revisión no salen junto al texto", FORMPAG, "[...problemasDeBloques(bloques), ...delServidor]", "[...problemasDeBloques(bloques)]", T_PAG_DOM),
    ("P149", "«Una de mis páginas» se ofrece aunque no haya páginas", FORMPIE, 'const hayPaginas = (paginas?.length ?? 0) > 0 || tipo === "pagina";', "const hayPaginas = true;", T_PAG_DOM),
    ("P150", "al elegir una página no se propone su título como texto del enlace", FORMPIE, '...(d.tipo === "pagina" && !enlace.texto?.trim() ? { texto: tituloDePagina(paginas, d.clave) } : {})', "...({})", T_PAG_DOM),
    ("P151", "al elegir «Una de mis páginas» se propone una sin publicar", FORMPIE, '(paginas?.find((x) => x.estado === "publicada") ?? paginas?.[0])?.clave ?? ""', 'paginas?.[0]?.clave ?? ""', T_PAG_DOM),
    ("P152", "una página sin publicar se puede abrir en la tienda desde el panel", EDITOR, 'tipo === "pagina" && detalle.estado === "publicada" && !detalle.archivada', 'tipo === "pagina" && !detalle.archivada', T_PAG_DOM),
    ("P153", "el panel no pide las páginas del negocio", USARPAG, 'client.listar({ tipo: "pagina" })', 'client.listar({ tipo: "contenido" })', T_PAG_DOM),
    ("P154", "la lista de páginas no dice la dirección de cada una", LISTA, 'tipo === "pagina" ? rutaPagina("", i.clave) : null,', "null,", T_PAG_DOM),
    ("P155", "el historial no resume el texto de una página", FORMATO, "if (texto) cambios.push(", "if (false) cambios.push(", T_FMT + T_PAG_DOM),
    ("P156", "el historial no nombra una página por su título", FORMATO, 'r.entidadTipo === "contenido" || r.entidadTipo === "pagina" ? contenido.titulo', 'r.entidadTipo === "contenido" ? contenido.titulo', T_FMT),
    ("P157", "el historial no dice «Una de mis páginas»", FORMATO, 'pagina: "Una de mis páginas", ', "", T_FMT),
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
    elegidas = {a for a in argv if a.startswith("P")}
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
