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
el dibujo de las secciones, la siembra de la vitrina actual (SQL real en Postgres embebido) y los avisos y el enlace del editor."""
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
    ("M182", "la campaña se elige para el canal mayorista", VIT, 'const ev: ContextoEvaluacion = { snap, canal: "retail", ahora: ctx.ahora };', 'const ev: ContextoEvaluacion = { snap, canal: "wholesale", ahora: ctx.ahora };', T_VIT),
    ("M183", "una campaña sin portada ni productos ocupa el lugar de otra con contenido", VIT, "if (!p && productos.length === 0) continue;", "", T_VIT),
    ("M184", "la portada de la campaña ignora la imagen de la campaña", VIT, "p.imagen ?? c.contenido.imagen", "p.imagen", T_VIT),
    ("M185", "la imagen de la portada de una campaña no figura entre las publicadas", VIT, "    ver(c.contenido.portada?.imagen);\n", "", T_VIT + T_IMGPUB),
    ("M186", "la imagen del banner no figura entre las publicadas", VIT, "    ver(snap.home.contenido.banner?.imagen);\n", "", T_VIT + T_IMGPUB),
    # --- PR 3 · carga con respaldo -------------------------------------------------------------------------------------------------------------
    ("M187", "la tienda de tecnología consulta el CMS", VITPUB, 'if (registro.tema === "tecnologia") return deSiempre(registro);', "", T_VITPUB),
    ("M188", "se lee el CMS de «ningún negocio»", VITPUB, "return tenantId ? deps.cargar(tenantId) : null;", 'return deps.cargar(tenantId ?? "");', T_VITPUB),
    ("M189", "un CMS apagado se trata como una falla", VITPUB, "    if (!snap) return deSiempre(registro);\n", "", T_VITPUB),
    ("M190", "la vitrina del respaldo dice venir del CMS", VITPUB, 'origen: "cms" };', 'origen: "registro" };', T_VITPUB),
    ("M191", "una lectura lenta deja la tienda esperando el plazo largo", VITPUB, "deps.plazoMs ?? PLAZO_VITRINA_MS,", "PLAZO_VITRINA_MS,", T_VITPUB),
    ("M192", "un aviso que falla rompe la tienda", VITPUB, "    } catch {\n      /* el aviso nunca puede romper la tienda */\n    }\n", "    } finally {\n    }\n", T_VITPUB),
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
