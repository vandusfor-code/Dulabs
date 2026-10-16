"""Fotos y videos del inicio de la tienda (tipo «multimedia» del CMS) — pruebas de mutación. Se quita o se invierte UNA protección a la vez; alguna prueba DEBE fallar; luego se restaura el archivo.
Si una mutación NO se detecta, la protección se podía eliminar sin que nadie se enterara: las pruebas son insuficientes y hay que reforzarlas.

Uso (desde la raíz del repo; sin red ni base de datos real: el SQL corre en Postgres embebido, PGlite):
    python3 scripts/mutacion/multimedia.py               # todas
    python3 scripts/mutacion/multimedia.py --verificar   # solo comprueba que cada patrón aplica exactamente una vez
    python3 scripts/mutacion/multimedia.py V12 V40       # solo esas
En Windows: PYTHONIOENCODING=utf-8 py -3 -X utf8 scripts/mutacion/multimedia.py

Cubre: el lector de MP4 (fragmentado, giro, sonido, códec, perfil, fotogramas, duración, índice al principio, archivo cortado y el movimiento del índice con sus desplazamientos), los requisitos de
cada espacio (peso, duración, fotogramas, perfil, sonido, proporción, medidas, estructura y la comprobación del navegador), la revisión en el navegador, el servicio de videos (tipo y peso, tope,
permisos, rutas, idempotencia, reintentos, rechazo con borrado y el índice al principio), la ruta pública con Range (lista blanca, caché, 416, rangos que no se entienden), lo que dibuja la tienda
(cada video solo en su espacio, vuelta a lo de siempre, categorías), el esquema y la validación (incluida la red de seguridad al publicar), el servicio del CMS, la migración y su reversa en SQL real,
las rutas de la API, el cliente y el panel (formulario, pestaña, historial y vista previa)."""
import atexit
import os
import subprocess
import sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

C = "lib/cms-comercial/"
MP4, REQ, NAV, VID, PUB = (C + n for n in ("video-mp4.ts", "video-requisitos.ts", "video-navegador.ts", "videos.ts", "video-publico.ts"))
TIENDA, PUBLICA, ESQ, VALID, SERV, VITR, IMG, HTTPESQ = (C + n for n in ("multimedia-tienda.ts", "multimedia-publica.ts", "esquemas.ts", "validacion.ts", "servicio.ts", "vitrina.ts", "imagenes.ts", "http-esquemas.ts"))
CLIENTE = "lib/cms-comercial-client.ts"
SQL = "supabase/migrations/20261212000000_dulabs_cms_multimedia.sql"
SQLR = "supabase/rollbacks/20261212000000_dulabs_cms_multimedia.down.sql"
UI = "components/dashboard/tienda/"
FORM, TIENDAAPP, EDITOR, FORMATO = UI + "formulario-multimedia.tsx", UI + "TiendaApp.tsx", UI + "editor.tsx", UI + "formato.ts"
API = "app/api/dashboard/tienda/"
RUTA_SUBIDA, RUTA_CONFIRMAR, RUTA_LISTA, RUTA_CTX = API + "videos/upload-url/route.ts", API + "videos/[id]/confirmar/route.ts", API + "videos/route.ts", API + "contexto/route.ts"
NEXT = "next.config.ts"

T_MP4 = [C + "video-mp4.test.ts", C + "video-requisitos.test.ts"]
T_REQ = [C + "video-requisitos.test.ts", C + "video-navegador.test.ts", C + "guia-videos.test.ts"]
T_NAV = [C + "video-navegador.test.ts"]
T_VID = [C + "videos.pglite.test.ts"]
T_PUB = [C + "video-publico.test.ts", C + "video-publico.pglite.test.ts"]
T_TIENDA = [C + "multimedia-tienda.test.ts", "components/catalogo-publico/tienda/joyeria/inicio-multimedia.test.tsx"]
T_ESQ = [C + "multimedia-esquema.test.ts"]
T_SERV = [C + "multimedia-servicio.pglite.test.ts"]
T_SQL = [C + "multimedia-sql.pglite.test.ts"]
T_DOM = [UI + "multimedia.dom.test.tsx"]
T_FMT = [UI + "multimedia-formato.test.ts"]
T_CLIENTE = ["lib/cms-comercial-client-videos.test.ts"]
T_RUTAS = [API + "rutas-videos.test.ts"]
T_CTX = [API + "contexto.test.ts"]
T_CSP = ["lib/catalogo/inicio-video.test.ts"]
T_PUBLICA = [C + "multimedia-tienda.test.ts"]

# (id, descripción, archivo, texto a buscar (exactamente UNA vez), reemplazo, pruebas que deben detectarlo)
M = [
    # --- video-mp4.ts: lo que se lee de un archivo ---
    ("V01", "un MP4 con fragmentos (moof) no se marca como fragmentado", MP4, 'resultado.fragmentado = raiz.some((c) => c.tipo === "moof");', "resultado.fragmentado = false;", T_MP4),
    ("V02", "un índice con mvex no se marca como fragmentado", MP4, "if (mvex) resultado.fragmentado = true;", "if (mvex) resultado.fragmentado = false;", T_MP4),
    ("V03", "un video girado 90° se lee sin giro", MP4, "if (b > 0 && c < 0) return 90;", "if (b > 0 && c < 0) return 0;", T_MP4),
    ("V04", "un video girado 270° se lee sin giro", MP4, "if (b < 0 && c > 0) return 270;", "if (b < 0 && c > 0) return 0;", T_MP4),
    ("V05", "las medidas de pantalla no se cambian al girar", MP4, "pista.ancho = girada ? alto : ancho;", "pista.ancho = ancho;", T_MP4),
    ("V06", "la pista de audio no se detecta", MP4, 'resultado.tieneAudio = resultado.pistas.some((p) => p.tipo === "audio");', "resultado.tieneAudio = false;", T_MP4),
    ("V07", "una pista de sonido se toma por «otra»", MP4, 'manejador === "soun" ? "audio" : "otra"', '"otra"', T_MP4),
    ("V08", "HEVC se toma por H.264", MP4, 'formato === "dvhe") return "hevc";', 'formato === "dvhe") return "h264";', T_MP4),
    ("V09", "el perfil de H.264 se lee de otro byte", MP4, "pista.perfilAvc = l.u8(avcC.cuerpo + 1);", "pista.perfilAvc = l.u8(avcC.cuerpo + 2);", T_MP4),
    ("V10", "el nivel de H.264 se lee de otro byte", MP4, "pista.nivelAvc = l.u8(avcC.cuerpo + 3);", "pista.nivelAvc = l.u8(avcC.cuerpo + 2);", T_MP4),
    ("V11", "los fotogramas por segundo se calculan mal", MP4, "pista.fps = muestras / (medio.duracion / medio.escala);", "pista.fps = muestras / medio.duracion;", T_MP4),
    ("V12", "la duración de las cajas de 64 bits se lee de la posición de las de 32", MP4, "const duracion = version === 1 ? l.u64(c.cuerpo + 24) : l.u32(c.cuerpo + 16);", "const duracion = l.u32(c.cuerpo + 16);", T_MP4),
    ("V13", "el índice siempre se da por al principio", MP4, "mdats.length === 0 || moov.inicio < mdats[0].inicio", "true", T_MP4),
    ("V14", "un archivo cortado no se marca como truncado", MP4, 'if (raiz.some((c) => c.truncada)) resultado.problemas.push("truncado");', 'if (false) resultado.problemas.push("truncado");', T_MP4),
    ("V15", "un archivo sin datos no se marca", MP4, 'if (mdats.length === 0) resultado.problemas.push("sin_mdat");', 'if (false) resultado.problemas.push("sin_mdat");', T_MP4),
    ("V16", "un MP4 sin pistas se da por legible", MP4, ' || p === "sin_pistas"', "", T_MP4),
    ("V17", "con el índice al principio se vuelve a armar el archivo (en vez de devolver los mismos bytes)", MP4, "if (moov.inicio < mdat.inicio) return bytes;", "if (false) return bytes;", T_MP4),
    ("V18", "se intenta mover el índice aunque haya varios bloques de datos", MP4, "if (moovs.length !== 1 || mdats.length !== 1) return null;", "if (moovs.length < 1 || mdats.length < 1) return null;", T_MP4),
    ("V19", "al mover el índice los desplazamientos se corrigen al revés", MP4, "const nuevo = datos.getUint32(pos) + delta;", "const nuevo = datos.getUint32(pos) - delta;", T_MP4),
    ("V20", "los desplazamientos de 64 bits pierden su parte alta", MP4, "datos.setUint32(pos, Math.floor(nuevo / 0x1_0000_0000));", "datos.setUint32(pos, 0);", T_MP4),
    ("V21", "un desplazamiento que se sale de rango se acepta", MP4, "if (nuevo < 0 || nuevo > 0xffff_ffff) return false;", "if (false) return false;", T_MP4),
    ("V22", "el archivo reordenado no se compara con el original en tamaño", MP4, "return o === bytes.byteLength ? salida : null;", "return salida;", T_MP4),
    ("V23", "un archivo cortado o fragmentado también se intenta reordenar", MP4, 'if (raiz.some((c) => c.truncada || c.tipo === "moof")) return null;', "if (false) return null;", T_MP4),
    # --- video-requisitos.ts: las reglas ---
    ("V30", "el peso máximo sube a 30 MB", REQ, "export const MAX_BYTES_VIDEO = 3 * MB;", "export const MAX_BYTES_VIDEO = 30 * MB;", T_REQ),
    ("V31", "no hay duración mínima", REQ, "export const MIN_DURACION_SEG = 4;", "export const MIN_DURACION_SEG = 0;", T_REQ),
    ("V32", "la duración máxima sube a 150 s", REQ, "export const MAX_DURACION_SEG = 15;", "export const MAX_DURACION_SEG = 150;", T_REQ),
    ("V33", "los fotogramas por segundo suben a 300", REQ, "export const MAX_FPS = 30;", "export const MAX_FPS = 300;", T_REQ),
    ("V34", "los fotogramas por segundo no se revisan", REQ, "const fpsOk = fps === null || fps <= MAX_FPS + TOLERANCIA_FPS;", "const fpsOk = true;", T_REQ),
    ("V35", "el perfil High 10 se acepta", REQ, "export const PERFILES_AVC = [66, 77, 100] as const;", "export const PERFILES_AVC = [66, 77, 100, 110] as const;", T_REQ),
    ("V36", "el nivel de H.264 sube a 6.2", REQ, "export const MAX_NIVEL_AVC = 42;", "export const MAX_NIVEL_AVC = 62;", T_REQ),
    ("V37", "el códec no se revisa", REQ, 'const codecOk = video?.codec === "h264";', "const codecOk = true;", T_REQ),
    ("V38", "un video con sonido se acepta", REQ, "ok: !analisis.tieneAudio,", "ok: true,", T_REQ),
    ("V39", "un MP4 fragmentado se acepta", REQ, 'if (analisis.fragmentado) poner({ id: "estructura", ok: false,', 'if (false) poner({ id: "estructura", ok: false,', T_REQ),
    ("V40", "la proporción no se revisa", REQ, "const ok = relacion >= espec.relacion.min && relacion <= espec.relacion.max;", "const ok = true;", T_REQ),
    ("V41", "las medidas en píxeles no se revisan", REQ, "const ok = ancho >= espec.minimo.ancho && alto >= espec.minimo.alto && ancho <= espec.maximo.ancho && alto <= espec.maximo.alto;", "const ok = true;", T_REQ),
    ("V42", "la duración no se revisa", REQ, "const duracionOk = d !== null && d >= MIN_DURACION_SEG - 0.05 && d <= MAX_DURACION_SEG + 0.05;", "const duracionOk = true;", T_REQ),
    ("V44", "un índice al final ya no se avisa como «lo arreglamos por ti»", REQ, "if (!analisis.indiceAlPrincipio) seCorrigeSolo.push(", "if (false) seCorrigeSolo.push(", T_REQ),
    ("V45", "un video pesado (2 a 3 MB) ya no trae recomendación", REQ, "if (pesoComprobado.ok && analisis.bytes > IDEAL_BYTES_VIDEO) recomendaciones.push(", "if (false && analisis.bytes > IDEAL_BYTES_VIDEO) recomendaciones.push(", T_REQ),
    ("V46", "un video vertical en un espacio horizontal ya no dice dónde subirlo", REQ, 'if (esVertical && espec.orientacion === "horizontal") arreglo =', 'if (false && espec.orientacion === "horizontal") arreglo =', T_REQ),
    ("V47", "la imagen fija no cuenta para la comprobación del navegador", REQ, "const ok = n.reproducible && n.imagenFija;", "const ok = n.reproducible;", T_REQ),
    ("V48", "se le pregunta al navegador por algo que ni se pudo leer", REQ, 'if (!r.comprobaciones.some((c) => c.id === "formato" && c.ok)) return r;', "if (false) return r;", T_REQ),
    ("V49", "justo por encima del tope se dice «3 MB» (parece que cumple)", REQ, "bytes > MAX_BYTES_VIDEO && pesoLegible(bytes) === pesoLegible(MAX_BYTES_VIDEO)", "false", T_REQ),
    ("V50", "un archivo enorme sí se lee en el navegador", REQ, "export const MAX_BYTES_A_LEER = 60 * MB;", "export const MAX_BYTES_A_LEER = 6000 * MB;", T_REQ),
    ("V51", "un .mov de QuickTime ya no trae recomendación", REQ, 'if (analisis.marca === "qt  ") recomendaciones.push(', "if (false) recomendaciones.push(", T_REQ),
    ("V52", "el peso máximo no se exige", REQ, "const ok = bytes >= 1 && bytes <= MAX_BYTES_VIDEO;", "const ok = bytes >= 1;", T_REQ),
    ("V53", "al publicar no se revisan las medidas del video guardado", REQ, "[comprobarProporcion(asset.ancho, asset.alto, espec), comprobarMedidas(asset.ancho, asset.alto, espec)]", "[comprobarProporcion(asset.ancho, asset.alto, espec)]", T_ESQ + T_SERV),
    ("V54", "los usos de video de un contenido no se listan", REQ, "if (ref) salida.push({ archivo, video: ref.video, poster: ref.poster });", "if (false) salida.push({ archivo, video: ref.video, poster: ref.poster });", T_ESQ + T_SERV),
    # --- video-navegador.ts: la revisión antes de subir ---
    ("V60", "la imagen fija se toma sin tope de tiempo", NAV, "return Math.min(Math.max(duracionSeg * MOMENTO_IMAGEN_FIJA.fraccion, MOMENTO_IMAGEN_FIJA.minimoSeg), MOMENTO_IMAGEN_FIJA.maximoSeg);", "return Math.max(duracionSeg * MOMENTO_IMAGEN_FIJA.fraccion, MOMENTO_IMAGEN_FIJA.minimoSeg);", T_NAV),
    ("V61", "la imagen fija puede salir más grande que el tope", NAV, "return mayor > lado ? lado / mayor : 1;", "return lado / mayor;", T_NAV),
    ("V62", "un archivo enorme se lee entero en el navegador", NAV, "if (archivo.size > MAX_BYTES_A_LEER) {", "if (false) {", T_NAV),
    ("V63", "un archivo que no es un video también se abre en el navegador", NAV, "if (!legible) return { ...base, resultado, imagenFija: null, leido: true };", "", T_NAV),
    ("V64", "si la comprobación del navegador revienta, se da por reproducible", NAV, ".catch((): SondeoVideo => NO_REPRODUCIBLE)", ".catch((): SondeoVideo => ({ reproducible: true, ancho: null, alto: null, duracionSeg: null, imagenFija: new Blob([]) }))", T_NAV),
    # --- videos.ts: el servicio de videos ---
    ("V70", "se acepta pedir la subida de cualquier tipo de archivo", VID, "if (input.mimeType !== TIPO_VIDEO) throw", "if (false) throw", T_VID),
    ("V71", "se acepta pedir la subida de un video de cualquier peso", VID, "if (input.bytes > MAX_BYTES_VIDEO) throw", "if (false) throw", T_VID),
    ("V72", "no hay tope de videos por negocio", VID, ".filter(esVideo).length >= LIMITE_VIDEOS", ".filter(esVideo).length >= LIMITE_VIDEOS + 1000", T_VID),
    ("V73", "por la ruta de los videos se puede confirmar una imagen", VID, "if (!asset || !esVideo(asset)) throw", "if (!asset) throw", T_VID),
    ("V74", "el espacio donde se usa el video no se valida", VID, "if (!(ARCHIVOS_VIDEO as readonly string[]).includes(archivo)) throw", "if (false) throw", T_VID),
    ("V75", "cualquier rol puede subir y confirmar videos", VID, "if (!CMS_ROLES_ESCRITURA.includes(actor.rol)) throw", "if (false) throw", T_VID),
    ("V76", "confirmar dos veces vuelve a leer y a escribir", VID, 'if (asset.estado === "listo") return { video: vista(asset), duracionSeg: null', 'if (false) return { video: vista(asset), duracionSeg: null', T_VID),
    ("V77", "la ruta guardada del video no se compara con la que le toca", VID, "if (asset.storagePath !== final) throw", "if (false) throw", T_VID),
    ("V78", "un archivo subido de más de 3 MB se lee igual", VID, "if (infoTemporal && infoTemporal.size !== null && infoTemporal.size > MAX_BYTES_VIDEO) {", "if (false) {", T_VID),
    ("V79", "un reintento no busca el video ya escrito", VID, "if (!origen) origen = await almacen.leer(final, MAX_BYTES_VIDEO);", "", T_VID),
    ("V80", "un video que no cumple se acepta", VID, "if (!evaluacion.cumple || !analisis.video || !medidas) {", "if (false) {", T_VID),
    ("V81", "un video rechazado deja su archivo subido en el almacén", VID, "        await almacen.borrar([temporal]);\n        const problemas: Problema[]", "        const problemas: Problema[]", T_VID),
    ("V82", "el índice de reproducción nunca se mueve al principio", VID, "if (!analisis.indiceAlPrincipio) {", "if (false) {", T_VID),
    ("V83", "se acepta el archivo reordenado aunque cambie de tamaño", VID, "movido.byteLength === origen.byteLength &&", "true &&", T_VID),
    ("V84", "se acepta el archivo reordenado aunque el índice no haya quedado al principio", VID, "reanalisis.indiceAlPrincipio &&", "true &&", T_VID),
    ("V85", "se guarda el video original en lugar del reordenado", VID, "await almacen.escribir(final, bytes, TIPO_VIDEO);", "await almacen.escribir(final, origen, TIPO_VIDEO);", T_VID),
    ("V86", "las medidas reales no llegan a la base", VID, "ancho: medidas.ancho, alto: medidas.alto, actor", "ancho: 16, alto: 16, actor", T_VID),
    ("V87", "la lista de videos incluye las imágenes", VID, ".filter(esVideo).map(vista)", ".map(vista)", T_VID),
    ("V88", "el archivo subido no se borra del almacén al confirmar", VID, "      await almacen.borrar([temporal]);\n\n      const r = await repo.confirmarAsset(", "      const r = await repo.confirmarAsset(", T_VID),
    # --- imagenes.ts: las imágenes y los videos no se mezclan ---
    ("V90", "por la ruta de las imágenes se puede confirmar un video", IMG, "if (!asset || !esImagen(asset)) throw", "if (!asset) throw", T_VID),
    ("V91", "la galería de imágenes muestra los videos", IMG, ".filter(esImagen).slice(0, 200).map(vista)", ".slice(0, 200).map(vista)", T_VID),
    ("V92", "los videos gastan el tope de imágenes", IMG, ".filter(esImagen).length >= LIMITE_IMAGENES", ".length >= LIMITE_IMAGENES", T_VID),
    # --- video-publico.ts: la ruta pública ---
    ("V100", "la ruta pública acepta nombres sin el fin exacto «.mp4»", PUB, r"\.mp4$/;", r"\.mp4/;", T_PUB),
    ("V101", "se sirve un video que ningún contenido publicado usa", PUB, "!videosReferenciados(snap).has(id)", "false", T_PUB),
    ("V102", "se sirve un archivo que no es un MP4", PUB, 'asset.mimeType !== "video/mp4" ||', "", T_PUB),
    ("V103", "no se comprueba que la ruta sea la carpeta del propio negocio", PUB, "if (asset.storagePath !== `${tenantId}/cms/${id}/video.mp4`) return noEncontrado();", "", T_PUB),
    ("V104", "se sirve una instantánea de otro negocio", PUB, "if (!snap || snap.tenantId !== tenantId) return noEncontrado();", "if (!snap) return noEncontrado();", T_PUB),
    ("V105", "un pedazo (206) se guarda en cachés compartidas", PUB, "headers.set(\"Cache-Control\", CACHE_PEDAZO);", "headers.set(\"Cache-Control\", CACHE_COMPLETO);", T_PUB),
    ("V106", "un rango imposible (416) se guarda en caché", PUB, 'headers.set("Cache-Control", "no-store");', "headers.set(\"Cache-Control\", CACHE_COMPLETO);", T_PUB),
    ("V107", "la respuesta no anuncia que entiende rangos", PUB, '"Accept-Ranges": "bytes",', "", T_PUB),
    ("V108", "un rango al revés se reenvía", PUB, "if (desde !== undefined && hasta !== undefined && Number(desde) > Number(hasta)) return null;", "", T_PUB),
    ("V109", "un rango vacío se reenvía", PUB, "if (desde === undefined && hasta === undefined) return null;", "", T_PUB),
    ("V110", "un rango con números enormes se reenvía", PUB, r"/^bytes=(\d{1,12})?-(\d{1,12})?$/;", r"/^bytes=(\d+)?-(\d+)?$/;", T_PUB),
    ("V111", "el rango pedido no se reenvía a Storage", PUB, "...(rango ? { headers: { Range: rango } } : {})", "...({})", T_PUB),
    ("V112", "se acepta de Storage un archivo que no es un MP4", PUB, '|| contentType !== "video/mp4") {', ") {", T_PUB),
    ("V113", "se acepta un 206 sin Content-Range", PUB, "if (res.status === 206 && !contentRange) {", "if (false) {", T_PUB),
    ("V114", "un 416 de Storage no se devuelve como 416", PUB, "if (video.status === 416) {", "if (false) {", T_PUB),
    ("V115", "el rango se reenvía tal cual sin revisarlo", PUB, "const pedido = rangoSimple(rango);", "const pedido = rango ?? null;", T_PUB),
    # --- multimedia-tienda.ts / multimedia-publica.ts: lo que dibuja la tienda ---
    ("V120", "la tienda usa un archivo que no es un MP4 como video", TIENDA, 'v.mimeType !== "video/mp4" ||', "", T_TIENDA),
    ("V121", "la imagen fija puede ser un video", TIENDA, '!p.mimeType.startsWith("image/")', "false", T_TIENDA),
    ("V122", "la tienda no vuelve a comprobar las medidas del video contra el espacio", TIENDA, "if (!comprobarProporcion(v.ancho, v.alto, espec).ok || !comprobarMedidas(v.ancho, v.alto, espec).ok) return null;", "", T_TIENDA),
    ("V123", "un espacio sin video horizontal que sirva usa igual el vertical", TIENDA, "if (!h) continue;", "", T_TIENDA),
    ("V124", "el video vertical nuevo se ignora", TIENDA, "...(v ? { vertical: v } : {})", "...{}", T_TIENDA),
    ("V125", "el punto focal del video de siempre se hereda al nuevo", TIENDA, "etiqueta: original.etiqueta })", "etiqueta: original.etiqueta, foco: original.foco })", T_TIENDA),
    ("V126", "con un video horizontal nuevo el celular sigue con el vertical de siempre", TIENDA, "...(nuevo.vertical ? { vertical: nuevo.vertical } : {}),", "vertical: nuevo.vertical ?? original.vertical,", T_TIENDA),
    ("V127", "sin cambios la configuración no es la misma de siempre", TIENDA, "return cambio ? sig : joyeria;", "return sig;", T_TIENDA),
    ("V128", "se pone un video de mayoristas donde la tienda no tiene video", TIENDA, "if (mayoristas && joyeria.mayoristas?.video) {", "if (mayoristas && joyeria.mayoristas) {", T_TIENDA),
    ("V129", "sin cambios las categorías no son la misma lista", TIENDA, "return cambio ? salida : categorias;", "return salida;", T_TIENDA),
    ("V130", "la imagen elegida de una categoría no reemplaza la foto del producto", TIENDA, "return { ...c, coverUrl: imagen.src };", "return c;", T_TIENDA),
    ("V131", "con nada que mostrar igual se devuelve algo", TIENDA, "return Object.keys(videos).length === 0 && categorias.size === 0 ? null : { videos, categorias };", "return { videos, categorias };", T_TIENDA),
    ("V132", "el panel no sabe cuáles son los videos de mayoristas de siempre", TIENDA, 'poner("mayoristas", joyeria.mayoristas?.video);', "", T_CTX),
    ("V133", "el plazo de la carga de la tienda sube a 20 s", PUBLICA, "export const PLAZO_MULTIMEDIA_MS = 2000;", "export const PLAZO_MULTIMEDIA_MS = 20_000;", T_PUBLICA),
    ("V134", "una falla de la carga no se avisa", PUBLICA, "    avisar(deps, error);\n    return null;", "    return null;", T_PUBLICA),
    # --- esquemas.ts y validacion.ts ---
    ("V140", "se puede elegir un video vertical sin horizontal", ESQ, "{ horizontal: archivoVideoSchema, vertical: archivoVideoSchema.optional() }", "{ horizontal: archivoVideoSchema.optional(), vertical: archivoVideoSchema.optional() }", T_ESQ),
    ("V141", "la marca acepta un video vertical (y lo ignora)", ESQ, "const videoUnico = z.strictObject(", "const videoUnico = z.object(", T_ESQ),
    ("V142", "no hay tope de categorías con imagen", ESQ, "export const MAX_CATEGORIAS_CON_IMAGEN = 60;", "export const MAX_CATEGORIAS_CON_IMAGEN = 6000;", T_ESQ),
    ("V143", "una categoría puede repetirse", ESQ, ".refine((c) => sinRepetidos(c.map((x) => x.categoria_id))", ".refine(() => true", T_ESQ),
    ("V144", "un video acepta campos de más (como una dirección externa)", ESQ, "export const archivoVideoSchema = z.strictObject({", "export const archivoVideoSchema = z.object({", T_ESQ),
    ("V150", "un archivo que no es un video pasa como video", VALID, 'else if (v.mime !== undefined && v.mime !== "video/mp4")', "else if (false)", T_ESQ + T_SERV),
    ("V151", "un video sin terminar de subir se publica", VALID, 'else if (v.estado !== "listo") err("video_pendiente"', 'else if (false) err("video_pendiente"', T_ESQ + T_SERV),
    ("V152", "no se revisan el peso y las medidas del video guardado", VALID, "else if (v.ancho !== undefined && v.alto !== undefined && v.bytes !== undefined) {", "else if (false) {", T_ESQ + T_SERV),
    ("V153", "una imagen que es un video pasa como imagen", VALID, 'else if (a.mime !== undefined && !a.mime.startsWith("image/")) err(', "else if (false) err(", T_ESQ + T_SERV),
    ("V154", "publicar sin nada elegido no avisa que no cambia nada", VALID, "if (!hayVideos && !hayCategorias) adv(", "if (false) adv(", T_ESQ),
    ("V155", "los videos del borrador no se buscan", VALID, "if (cadena(ref.video)) dep.videos.push(", "if (false) dep.videos.push(", T_ESQ + T_SERV),
    ("V156", "las imágenes fijas del borrador no se buscan", VALID, "if (cadena(ref.poster)) dep.assets.push(", "if (false) dep.assets.push(", T_ESQ + T_SERV),
    ("V157", "las categorías del borrador no se buscan", VALID, "if (cadena(item.categoria_id)) dep.categorias.push(", "if (false) dep.categorias.push(", T_ESQ + T_SERV),
    ("V158", "un video que no existe se da por existente", VALID, 'if (!v) err("video_inexistente"', 'if (false) err("video_inexistente"', T_ESQ + T_SERV),
    ("V160", "se pueden crear varias fotos y videos por negocio sin aviso claro", SERV, ', multimedia: "Las fotos y videos ya existen." };', " };", T_SERV),
    ("V161", "el servicio no carga los videos del borrador al revisar", SERV, "const assets = unicos([...dep.assets.map((a) => a.valor), ...dep.videos.map((v) => v.valor)]);", "const assets = unicos([...dep.assets.map((a) => a.valor)]);", T_SERV),
    # --- vitrina.ts: qué se puede servir ---
    ("V170", "la imagen fija de un video no se sirve", VITR, "for (const u of usosDeVideo(snap.multimedia.contenido)) ids.add(u.poster);", "", T_SERV + T_PUB),
    ("V171", "la imagen de una categoría no se sirve", VITR, "for (const c of snap.multimedia.contenido.categorias ?? []) ver(c.imagen);", "", T_SERV),
    ("V172", "ningún video se considera usado por lo publicado", VITR, "snap.multimedia ? usosDeVideo(snap.multimedia.contenido).map((u) => u.video) : []", "[]", T_SERV + T_PUB),
    ("V173", "la ruta de un video de la tienda termina en .webp", VITR, "${assetId}.mp4`;", "${assetId}.webp`;", T_TIENDA),
    # --- http-esquemas.ts y las rutas de la API ---
    ("V180", "la API acepta pedir la subida de un video de cualquier peso", HTTPESQ, ".max(MAX_BYTES_VIDEO, { message:", ".max(MAX_BYTES_VIDEO * 100, { message:", T_RUTAS),
    ("V181", "la API acepta pedir la subida de cualquier tipo", HTTPESQ, 'z.literal(TIPO_VIDEO, { message: "Usa un video MP4 (con video H.264)." })', "z.string()", T_RUTAS),
    ("V182", "la API acepta cualquier espacio al confirmar", HTTPESQ, 'z.enum(ARCHIVOS_VIDEO, { message: "El espacio del video no es válido." })', "z.string()", T_RUTAS),
    ("V183", "cualquier rol pide la subida de un video", RUTA_SUBIDA, 'withCms(request, "write",', 'withCms(request, "read",', T_RUTAS),
    ("V184", "cualquier rol confirma un video", RUTA_CONFIRMAR, 'withCms(request, "write",', 'withCms(request, "read",', T_RUTAS),
    ("V185", "solo un administrador ve la lista de videos", RUTA_LISTA, 'withCms(request, "read",', 'withCms(request, "write",', T_RUTAS),
    ("V186", "un id que no es UUID llega hasta la base", RUTA_CONFIRMAR, "    if (!id.ok) return id.response;\n", "", T_RUTAS),
    ("V187", "el panel no se entera de los videos de siempre de la tienda", RUTA_CTX, "videosDeSiempre: videosDeSiempre(joyeria),", "videosDeSiempre: {},", T_CTX),
    # --- el cliente del navegador ---
    ("V190", "la imagen fija del video no se reduce a 1280 px", CLIENTE, "const imagen = await subirImagen(foto, { ladoMaximo: 1280 });", "const imagen = await subirImagen(foto);", T_CLIENTE),
    ("V191", "si la imagen fija falla, igual se sube el video", CLIENTE, "      if (!imagen.ok) return imagen;\n", "", T_CLIENTE),
    ("V192", "el video se declara de otro tipo", CLIENTE, '{ mimeType: "video/mp4", bytes: archivo.size, nombreOriginal: archivo.name }', '{ mimeType: archivo.type, bytes: archivo.size, nombreOriginal: archivo.name }', T_CLIENTE),
    ("V193", "al confirmar no se dice para qué espacio es el video", CLIENTE, "{ archivo: destino }", "{}", T_CLIENTE),
    # --- el panel ---
    ("V200", "un video que no cumple se puede usar", FORM, "&& fase.revision.resultado.cumple && fase.revision.imagenFija !== null", "&& fase.revision.imagenFija !== null", T_DOM),
    ("V201", "el video vertical se puede subir sin el horizontal", FORM, "bloqueadoPor={refH ? undefined :", "bloqueadoPor={true ? undefined :", T_DOM),
    ("V202", "«Volver al video de siempre» solo quita el horizontal", FORM, "onClick={() => poner(`videos.${espacio}`, undefined)}", "onClick={() => poner(`videos.${espacio}.horizontal`, undefined)}", T_DOM),
    ("V203", "«Quitar mi video» quita el horizontal en vez del vertical", FORM, "onQuitar={() => poner(`videos.${espacio}.vertical`, undefined)}", "onQuitar={() => poner(`videos.${espacio}.horizontal`, undefined)}", T_DOM),
    ("V204", "la imagen de una categoría arranca sin descripción", FORM, "altSugerido={t(`Imagen de la categoría ${c.nombre}`,", "altSugerido={t(``,", T_DOM),
    ("V205", "las imágenes de categoría no se reducen a 1200 px", FORM, "ladoMaximo={1200}", "ladoMaximo={undefined}", T_DOM),
    ("V206", "una categoría borrada del catálogo no se puede quitar", FORM, "const eliminadas = entradas.filter(", "const eliminadas = ([] as EntradaCategoria[]).filter(", T_DOM),
    ("V207", "al quitar la última imagen de categoría queda una lista vacía en el borrador", FORM, "lista.length === 0 ? undefined : lista", "lista", T_DOM),
    ("V208", "un resultado que llega tarde pisa al video elegido después", FORM, "if (n !== contador.current) return; // eligió otro mientras tanto", "", T_DOM),
    ("V209", "el video subido queda elegido con la imagen fija al revés", FORM, "onCambio({ video: r.data.video.id, poster: r.data.imagen.id });", "onCambio({ video: r.data.imagen.id, poster: r.data.video.id });", T_DOM),
    ("V210", "un rechazo del servidor se toma como éxito", FORM, 'if (!r.ok) {\n      setFase({ fase: "error", mensaje: r.error.message', 'if (false) {\n      setFase({ fase: "error", mensaje: r.error.message', T_DOM),
    ("V211", "la pestaña «Fotos y videos» se ofrece en cualquier tienda", TIENDAAPP, '...(tienda?.tema === "joyeria" ? [{ id: "multimedia" as const', '...(true ? [{ id: "multimedia" as const', T_DOM),
    ("V212", "se ofrece archivar las fotos y videos (y la tienda no podría volver a crearlas)", EDITOR, 'tipo !== "home" && tipo !== "pie" && tipo !== "multimedia" && (', 'tipo !== "home" && (', T_DOM),
    ("V213", "el historial no distingue un video de una imagen", FORMATO, 'if (esRegistroDeVideo(r)) return ingles ? "Uploaded a video" : "Subió un video";', "", T_FMT),
    ("V215", "la vista previa de la imagen de una categoría no tiene la forma de la tarjeta", UI + "selectores.tsx", 'vertical ? "aspect-[4/5] w-36" : "h-32 w-full sm:w-52"', '"h-32 w-full sm:w-52"', T_DOM),
    ("V216", "las demás imágenes del panel también quedan con la vista previa vertical", UI + "selectores.tsx", 'vertical ? "aspect-[4/5] w-36" : "h-32 w-full sm:w-52"', '"aspect-[4/5] w-36"', T_DOM),
    ("V214", "el historial de categorías pierde la imagen", FORMATO, 'porCategoria[c.categoria_id as string] = imagen.asset ?? imagen.src ?? "";', 'porCategoria[c.categoria_id as string] = "";', T_FMT),
    # --- la migración y su reversa ---
    ("V220", "la migración no admite el tipo «multimedia»", SQL, "'contenido', 'pie', 'pagina', 'multimedia'));", "'contenido', 'pie', 'pagina'));", T_SQL),
    ("V221", "la migración no admite el tipo en el historial", SQL, "'pagina', 'multimedia', 'imagen'));", "'pagina', 'imagen'));", T_SQL),
    ("V222", "la migración no admite videos MP4", SQL, "'image/png', 'video/mp4'));", "'image/png'));", T_SQL),
    ("V223", "se pueden crear varias fotos y videos por negocio o con otro código", SQL, "check (tipo <> 'multimedia' or clave = 'multimedia');", "check (true);", T_SQL),
    ("V224", "la migración se aplica aunque no esté la del pie", SQL, " and pg_get_constraintdef(oid) like '%''pagina''%'", "", T_SQL),
    ("V225", "la reversa corre aunque ya haya videos guardados", SQLR, "if v_elementos > 0 or v_historial > 0 or v_videos > 0 then", "if v_elementos > 0 or v_historial > 0 then", T_SQL),
    ("V226", "la reversa deja los videos MP4 admitidos", SQLR, "check (mime_type in ('image/webp', 'image/jpeg', 'image/png'));", "check (mime_type in ('image/webp', 'image/jpeg', 'image/png', 'video/mp4'));", T_SQL),
    ("V227", "la reversa deja la regla del código fijo", SQLR, "alter table public.dulabs_cms_entidades drop constraint if exists dulabs_cms_entidades_multimedia_ck;", "", T_SQL),
    # --- la política de seguridad de contenido ---
    ("V230", "la política de seguridad deja cargar videos de cualquier sitio", NEXT, "\"media-src 'self' blob: https://*.supabase.co\",", '"media-src *",', T_CSP),
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
    elegidas = {a for a in argv if a.startswith("V")}
    lista = [m for m in M if not elegidas or m[0] in elegidas]
    ids = [m[0] for m in M]
    if len(ids) != len(set(ids)):
        print("hay identificadores repetidos")
        sys.exit(1)
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
