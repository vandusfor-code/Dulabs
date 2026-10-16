/**
 * CMS comercial — REQUISITOS de los videos de la tienda y la comprobación de un archivo contra ellos. PURO.
 *
 * Un video ambiental no es «cualquier video»: va detrás del texto de la portada, sin sonido y en bucle, se descarga en el celular de quien visita la tienda y tiene que arrancar en TODOS
 * los navegadores. Aquí están, en un solo lugar, las reglas (peso, duración, formato, medidas por espacio) y el texto que se le muestra a la administradora: la misma lista alimenta la guía del
 * panel, el aviso inmediato en el navegador (antes de subir) y la verificación del servidor (la que manda). Cambiar un límite es cambiar una constante de este archivo.
 */
import type { Multimedia } from "@/lib/cms-comercial/esquemas";
import type { AnalisisMp4 } from "@/lib/cms-comercial/video-mp4";

// ---------------------------------------------------------------------------
// Los espacios y sus archivos
// ---------------------------------------------------------------------------

export const ESPACIOS_VIDEO = ["portada", "coleccion", "marca", "mayoristas"] as const;
export type EspacioVideo = (typeof ESPACIOS_VIDEO)[number];

export const ORIENTACIONES_VIDEO = ["horizontal", "vertical"] as const;
export type OrientacionVideo = (typeof ORIENTACIONES_VIDEO)[number];

/** Cada archivo de video que acepta la tienda: el espacio y su orientación. `marca` y `mayoristas` solo llevan uno (horizontal). */
export const ARCHIVOS_VIDEO = ["portada.horizontal", "portada.vertical", "coleccion.horizontal", "coleccion.vertical", "marca.horizontal", "mayoristas.horizontal"] as const;
export type ArchivoVideoId = (typeof ARCHIVOS_VIDEO)[number];

export const archivoDe = (espacio: EspacioVideo, orientacion: OrientacionVideo): ArchivoVideoId | null => {
  const id = `${espacio}.${orientacion}`;
  return (ARCHIVOS_VIDEO as readonly string[]).includes(id) ? (id as ArchivoVideoId) : null;
};

export interface Medidas {
  ancho: number;
  alto: number;
}

export interface EspecificacionArchivo {
  id: ArchivoVideoId;
  espacio: EspacioVideo;
  orientacion: OrientacionVideo;
  /** Cómo se llama para la administradora. */
  titulo: string;
  /** Dónde se ve y por qué tiene esas medidas. */
  descripcion: string;
  /** Las medidas con las que mejor se ve (las de los videos que trae la tienda). */
  ideal: Medidas;
  minimo: Medidas;
  maximo: Medidas;
  /** Proporción (ancho ÷ alto) que se acepta. */
  relacion: { min: number; max: number };
  /** La proporción dicha como la dice la gente. */
  proporcion: string;
}

export const ESPECIFICACIONES: Readonly<Record<ArchivoVideoId, EspecificacionArchivo>> = {
  "portada.horizontal": {
    id: "portada.horizontal",
    espacio: "portada",
    orientacion: "horizontal",
    titulo: "Portada · pantalla horizontal",
    descripcion: "El video de fondo de la portada en computadores y tablets (pantallas más anchas que altas). El texto de la portada se pone encima, a la izquierda.",
    ideal: { ancho: 1280, alto: 720 },
    minimo: { ancho: 960, alto: 540 },
    maximo: { ancho: 1920, alto: 1080 },
    relacion: { min: 1.6, max: 1.95 },
    proporcion: "16:9",
  },
  "portada.vertical": {
    id: "portada.vertical",
    espacio: "portada",
    orientacion: "vertical",
    titulo: "Portada · pantalla vertical (celular)",
    descripcion: "El video de fondo de la portada en celulares en vertical. Es opcional: si no lo subes, el celular usa el horizontal (recortado).",
    ideal: { ancho: 720, alto: 1280 },
    minimo: { ancho: 540, alto: 960 },
    maximo: { ancho: 1080, alto: 1920 },
    relacion: { min: 0.51, max: 0.625 },
    proporcion: "9:16",
  },
  "coleccion.horizontal": {
    id: "coleccion.horizontal",
    espacio: "coleccion",
    orientacion: "horizontal",
    titulo: "Colección · pantalla horizontal",
    descripcion: "El video a pantalla completa de la colección, que sube sobre la portada, en computadores y tablets.",
    ideal: { ancho: 1280, alto: 720 },
    minimo: { ancho: 960, alto: 540 },
    maximo: { ancho: 1920, alto: 1080 },
    relacion: { min: 1.6, max: 1.95 },
    proporcion: "16:9",
  },
  "coleccion.vertical": {
    id: "coleccion.vertical",
    espacio: "coleccion",
    orientacion: "vertical",
    titulo: "Colección · pantalla vertical (celular)",
    descripcion: "El video de la colección en celulares en vertical. Es opcional: si no lo subes, el celular usa el horizontal (recortado).",
    ideal: { ancho: 720, alto: 1280 },
    minimo: { ancho: 540, alto: 960 },
    maximo: { ancho: 1080, alto: 1920 },
    relacion: { min: 0.51, max: 0.625 },
    proporcion: "9:16",
  },
  "marca.horizontal": {
    id: "marca.horizontal",
    espacio: "marca",
    orientacion: "horizontal",
    titulo: "Marca · tarjeta",
    descripcion: "El video de la tarjeta de «la marca», junto al texto de presentación. Es una tarjeta casi cuadrada, un poco más alta que ancha.",
    ideal: { ancho: 720, alto: 900 },
    minimo: { ancho: 576, alto: 720 },
    maximo: { ancho: 1080, alto: 1350 },
    relacion: { min: 0.75, max: 0.85 },
    proporcion: "4:5",
  },
  "mayoristas.horizontal": {
    id: "mayoristas.horizontal",
    espacio: "mayoristas",
    orientacion: "horizontal",
    titulo: "Mayoristas · banda de fondo",
    descripcion: "El video de fondo de la banda «Compra al por mayor» (y de la página de mayoristas): una franja muy ancha detrás del texto.",
    ideal: { ancho: 1280, alto: 576 },
    minimo: { ancho: 960, alto: 432 },
    maximo: { ancho: 1920, alto: 864 },
    relacion: { min: 1.6, max: 2.4 },
    proporcion: "20:9 (o 16:9)",
  },
};

export const NOMBRES_ESPACIO: Readonly<Record<EspacioVideo, string>> = {
  portada: "Portada",
  coleccion: "Colección",
  marca: "Marca",
  mayoristas: "Mayoristas",
};

// ---------------------------------------------------------------------------
// Reglas generales
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;
/** El peso máximo de un archivo (también lo exige el servidor antes de leerlo). */
export const MAX_BYTES_VIDEO = 3 * MB;
/** Con este peso o menos, el video carga rápido hasta con datos móviles. */
export const IDEAL_BYTES_VIDEO = 2 * MB;
export const MIN_DURACION_SEG = 4;
export const MAX_DURACION_SEG = 15;
/** Se tolera un poco de redondeo (29,97 y 30,0 son «30»). */
export const MAX_FPS = 30;
const TOLERANCIA_FPS = 0.6;
/** H.264 de 8 bits y 4:2:0, los únicos perfiles que se ven en todos los navegadores: base (66), principal (77) y alto (100). */
export const PERFILES_AVC = [66, 77, 100] as const;
export const NOMBRE_PERFIL: Readonly<Record<number, string>> = { 66: "Baseline", 77: "Main", 88: "Extended", 100: "High", 110: "High 10", 122: "High 4:2:2", 244: "High 4:4:4" };
/** Nivel máximo de H.264: 4.2 (el celular medio decodifica hasta 1080p a 60 cuadros). */
export const MAX_NIVEL_AVC = 42;
/** Lo más que se acepta subir de golpe (la verificación lo rechaza por peso mucho antes; esto evita leer en el navegador un archivo de gigas). */
export const MAX_BYTES_A_LEER = 60 * MB;

export const REQUISITOS_GENERALES = {
  formato: "MP4 con video H.264 (el formato que se ve en todos los navegadores y celulares)",
  pesoMaximo: `${MAX_BYTES_VIDEO / MB} MB por archivo (lo ideal: ${IDEAL_BYTES_VIDEO / MB} MB o menos)`,
  duracion: `De ${MIN_DURACION_SEG} a ${MAX_DURACION_SEG} segundos (lo ideal: 6 a 10); el video se repite sin fin`,
  fotogramas: `Hasta ${MAX_FPS} fotogramas por segundo (24 o 30)`,
  sonido: "Sin sonido (ni pista de audio): se ve siempre en silencio y así pesa menos y no se filtra una conversación grabada sin querer",
  contenido: "Sin texto dentro del video (el texto de la tienda se escribe encima y se lee mejor), sin destellos ni parpadeos fuertes y con el motivo principal hacia el centro",
  derechos: "Solo videos y música propios o con licencia (sin música: el video va sin sonido)",
} as const;

// ---------------------------------------------------------------------------
// La comprobación
// ---------------------------------------------------------------------------

export type IdComprobacion = "formato" | "peso" | "duracion" | "codec" | "perfil" | "sonido" | "fotogramas" | "proporcion" | "medidas" | "estructura" | "navegador";

export interface Comprobacion {
  id: IdComprobacion;
  ok: boolean;
  /** La regla, dicha en positivo («Pesa 3 MB o menos»). */
  titulo: string;
  /** Lo que se encontró en el archivo. */
  detalle: string;
  /** Qué hacer para arreglarlo (solo cuando falla). */
  arreglo?: string;
}

export interface ResultadoRequisitos {
  /** Todas las comprobaciones obligatorias pasaron. */
  cumple: boolean;
  comprobaciones: Comprobacion[];
  fallos: Comprobacion[];
  /** Cosas que el sistema arregla solo (por ejemplo, mover el índice al principio). */
  seCorrigeSolo: string[];
  /** No impiden subir, pero conviene saberlas (pesa más de lo ideal, dura más de 10 s…). */
  recomendaciones: string[];
}

/** «1,4 MB» / «820 KB». */
export function pesoLegible(bytes: number): string {
  if (bytes < MB / 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} MB`;
}

/** El peso dicho en una frase. Justo por encima del tope «3 MB» se vería igual que el tope: ahí se dice «un poco más de 3 MB». */
export function pesoDicho(bytes: number): string {
  return bytes > MAX_BYTES_VIDEO && pesoLegible(bytes) === pesoLegible(MAX_BYTES_VIDEO) ? `un poco más de ${pesoLegible(MAX_BYTES_VIDEO)}` : pesoLegible(bytes);
}

const medidas = (m: Medidas) => `${m.ancho}×${m.alto}`;
const segundos = (s: number) => `${s.toLocaleString("es-CO", { maximumFractionDigits: 1 })} s`;

const ERROR_FORMATO: Readonly<Record<string, string>> = {
  no_es_mp4: "El archivo no es un video MP4 (puede ser MOV, AVI, MKV o WebM, o no ser un video).",
  truncado: "El archivo está incompleto o dañado (se cortó al copiarlo o al exportarlo).",
  sin_moov: "El archivo no tiene la información del video (está dañado o no terminó de exportarse).",
  sin_mdat: "El archivo no tiene imagen (está vacío o dañado).",
  sin_pistas: "El archivo no tiene ninguna pista de video.",
  demasiado_complejo: "El archivo tiene una estructura demasiado compleja o extraña para una tienda.",
};

/** Cómo exportar el video con casi cualquier programa. */
const COMO_EXPORTAR = "Expórtalo de nuevo como MP4 con video H.264, sin sonido, a 30 fotogramas por segundo (por ejemplo con HandBrake, CapCut, Canva, Clipchamp o Adobe Express).";

/** El peso del archivo contra el tope. */
export function comprobarPeso(bytes: number, espec: EspecificacionArchivo): Comprobacion {
  const ok = bytes >= 1 && bytes <= MAX_BYTES_VIDEO;
  return {
    id: "peso",
    ok,
    titulo: `Pesa ${MAX_BYTES_VIDEO / MB} MB o menos`,
    detalle: `Pesa ${pesoDicho(bytes)}.`,
    ...(ok ? {} : { arreglo: `Redúcelo a ${MAX_BYTES_VIDEO / MB} MB o menos (lo ideal: ${IDEAL_BYTES_VIDEO / MB} MB): baja las medidas a ${medidas(espec.ideal)}, recórtalo a 6–10 segundos y exporta con calidad media. En HandBrake: «Fast 720p30» y calidad (RF) 28.` }),
  };
}

/** La proporción (ancho ÷ alto) contra la del espacio; si es la de la otra orientación, dice dónde subirlo. */
export function comprobarProporcion(ancho: number, alto: number, espec: EspecificacionArchivo): Comprobacion {
  const relacion = ancho / alto;
  const ok = relacion >= espec.relacion.min && relacion <= espec.relacion.max;
  const esVertical = relacion < 0.95;
  const esHorizontal = relacion > 1.05;
  let arreglo = `Recorta el video a ${espec.proporcion} (lo ideal: ${medidas(espec.ideal)}).`;
  if (!ok) {
    const otro = archivoDe(espec.espacio, esVertical ? "vertical" : "horizontal");
    if (esVertical && espec.orientacion === "horizontal") arreglo = `Este espacio es horizontal (${espec.proporcion}) y tu video es vertical.${otro ? ` Súbelo en «${ESPECIFICACIONES[otro].titulo}».` : ""} Para este espacio exporta uno horizontal de ${medidas(espec.ideal)}.`;
    else if (esHorizontal && espec.orientacion === "vertical") arreglo = `Este espacio es vertical (${espec.proporcion}) y tu video es horizontal.${otro ? ` Súbelo en «${ESPECIFICACIONES[otro].titulo}».` : ""} Para este espacio exporta uno vertical de ${medidas(espec.ideal)}.`;
  }
  return { id: "proporcion", ok, titulo: `Proporción ${espec.proporcion}`, detalle: `Es de ${ancho}×${alto} (proporción ${relacion.toLocaleString("es-CO", { maximumFractionDigits: 2 })}).`, ...(ok ? {} : { arreglo }) };
}

/** Las medidas en píxeles contra el rango del espacio. */
export function comprobarMedidas(ancho: number, alto: number, espec: EspecificacionArchivo): Comprobacion {
  const ok = ancho >= espec.minimo.ancho && alto >= espec.minimo.alto && ancho <= espec.maximo.ancho && alto <= espec.maximo.alto;
  return {
    id: "medidas",
    ok,
    titulo: `Medidas entre ${medidas(espec.minimo)} y ${medidas(espec.maximo)} píxeles (ideal ${medidas(espec.ideal)})`,
    detalle: `Mide ${ancho}×${alto} píxeles.`,
    ...(ok ? {} : { arreglo: ancho > espec.maximo.ancho || alto > espec.maximo.alto ? `Es demasiado grande: redúcelo a ${medidas(espec.ideal)}. Más resolución no se nota y hace que pese mucho.` : `Es demasiado pequeño y se vería borroso: usa al menos ${medidas(espec.minimo)}, lo ideal ${medidas(espec.ideal)}.` }),
  };
}

/**
 * Lo que se puede comprobar de un video YA GUARDADO sin volver a abrirlo: lo que la base de datos conoce de él (peso y medidas de pantalla). Es la red de seguridad al publicar: aunque alguien
 * eludiera el aviso del navegador y la verificación al subir, un video de otro tamaño o de otra proporción que la del espacio no se publica. Devuelve solo los fallos.
 */
export function comprobarArchivoGuardado(asset: { ancho: number; alto: number; bytes: number }, archivo: ArchivoVideoId): Comprobacion[] {
  const espec = ESPECIFICACIONES[archivo];
  return [comprobarPeso(asset.bytes, espec), ...(asset.ancho > 0 && asset.alto > 0 ? [comprobarProporcion(asset.ancho, asset.alto, espec), comprobarMedidas(asset.ancho, asset.alto, espec)] : [])].filter((c) => !c.ok);
}

/**
 * Comprueba un video ya analizado contra los requisitos de un archivo (espacio y orientación). Devuelve TODAS las comprobaciones, las que pasan y las que no, para mostrar una lista
 * completa; `cumple` es true solo si ninguna obligatoria falla. No decide nada del navegador (si lo puede reproducir): eso lo agrega quien corre en el navegador.
 */
export function evaluarVideo(analisis: AnalisisMp4, archivo: ArchivoVideoId): ResultadoRequisitos {
  const espec = ESPECIFICACIONES[archivo];
  const comprobaciones: Comprobacion[] = [];
  const recomendaciones: string[] = [];
  const seCorrigeSolo: string[] = [];
  const poner = (c: Comprobacion) => void comprobaciones.push(c);
  const video = analisis.video;

  // Formato / estructura
  const fallosDeFormato = analisis.problemas.map((p) => ERROR_FORMATO[p]).filter((m): m is string => Boolean(m));
  if (analisis.legible && video) poner({ id: "formato", ok: true, titulo: "Es un archivo MP4 con video", detalle: "El archivo se leyó completo." });
  else {
    // Si ni siquiera se puede leer, el resto de la lista no dice nada útil: solo el formato y el peso (que se conoce sin leerlo).
    poner({ id: "formato", ok: false, titulo: "Es un archivo MP4 con video", detalle: fallosDeFormato[0] ?? ERROR_FORMATO.no_es_mp4, arreglo: COMO_EXPORTAR });
    const pesoSolo = analisis.bytes >= 1 && analisis.bytes <= MAX_BYTES_VIDEO;
    poner({ id: "peso", ok: pesoSolo, titulo: `Pesa ${MAX_BYTES_VIDEO / MB} MB o menos`, detalle: `Pesa ${pesoDicho(analisis.bytes)}.`, ...(pesoSolo ? {} : { arreglo: `Redúcelo a ${MAX_BYTES_VIDEO / MB} MB o menos.` }) });
    return { cumple: false, comprobaciones, fallos: comprobaciones.filter((c) => !c.ok), seCorrigeSolo, recomendaciones };
  }

  if (analisis.fragmentado) poner({ id: "estructura", ok: false, titulo: "Es un MP4 normal (no fragmentado)", detalle: "El archivo está dividido en fragmentos (el formato de la transmisión en vivo).", arreglo: COMO_EXPORTAR });
  else if (analisis.legible) {
    poner({ id: "estructura", ok: true, titulo: "Es un MP4 normal (no fragmentado)", detalle: "Estructura normal." });
    if (!analisis.indiceAlPrincipio) seCorrigeSolo.push("El video tiene la información de reproducción al final del archivo: se mueve al principio automáticamente para que empiece a verse más rápido.");
  }

  // Peso
  const pesoComprobado = comprobarPeso(analisis.bytes, espec);
  poner(pesoComprobado);
  if (pesoComprobado.ok && analisis.bytes > IDEAL_BYTES_VIDEO) recomendaciones.push(`Pesa ${pesoLegible(analisis.bytes)}: se acepta, pero con ${IDEAL_BYTES_VIDEO / MB} MB o menos carga más rápido en los celulares.`);
  // Un .mov (QuickTime) con video H.264 se ve en casi todos los navegadores, pero no es lo que la web espera: se acepta y se avisa.
  if (analisis.marca === "qt  ") recomendaciones.push("El archivo viene de QuickTime (un .mov, por ejemplo de un iPhone o un Mac): se acepta y se ve en la mayoría de los navegadores, pero un MP4 exportado con HandBrake, CapCut o Canva es más seguro.");

  // Duración
  // Una duración de cero (los MP4 fragmentados la dejan en cero) es lo mismo que no saberla.
  const d = analisis.duracionSeg !== null && analisis.duracionSeg > 0 ? analisis.duracionSeg : null;
  const duracionOk = d !== null && d >= MIN_DURACION_SEG - 0.05 && d <= MAX_DURACION_SEG + 0.05;
  poner({
    id: "duracion",
    ok: duracionOk,
    titulo: `Dura entre ${MIN_DURACION_SEG} y ${MAX_DURACION_SEG} segundos`,
    detalle: d === null ? "No se pudo leer la duración." : `Dura ${segundos(d)}.`,
    ...(duracionOk ? {} : { arreglo: d === null ? COMO_EXPORTAR : d > MAX_DURACION_SEG ? `Recórtalo a unos 8 segundos: el video se repite sin fin, y uno largo pesa más y se hace pesado.` : `Alárgalo o repítelo hasta que dure al menos ${MIN_DURACION_SEG} segundos (lo ideal: 6 a 10).` }),
  });
  if (duracionOk && d !== null && d > 10.5) recomendaciones.push(`Dura ${segundos(d)}: se acepta, pero entre 6 y 10 segundos se repite mejor.`);

  // Códec y perfil
  const codecOk = video?.codec === "h264";
  const nombreCodec = video?.codec === "hevc" ? "H.265 (HEVC), el formato de los iPhone y de muchas cámaras" : video?.codec === "vp9" ? "VP9 (WebM)" : video?.codec === "av1" ? "AV1" : video?.codec === "prores" ? "ProRes" : video?.codec === "mpeg4" ? "MPEG-4 antiguo" : (video?.formato ?? "desconocido");
  poner({
    id: "codec",
    ok: codecOk,
    titulo: "El video es H.264",
    detalle: video ? (codecOk ? "El video es H.264." : `El video es ${nombreCodec}.`) : "No se encontró el video.",
    ...(codecOk ? {} : { arreglo: video?.codec === "hevc" ? "Expórtalo como H.264. En un iPhone: Ajustes › Cámara › Formatos › «Más compatible»; o conviértelo con HandBrake («Fast 720p30»)." : COMO_EXPORTAR }),
  });
  if (codecOk && video) {
    const perfil = video.perfilAvc;
    const nivel = video.nivelAvc;
    const perfilOk = perfil !== null && (PERFILES_AVC as readonly number[]).includes(perfil) && (nivel === null || nivel <= MAX_NIVEL_AVC);
    poner({
      id: "perfil",
      ok: perfilOk,
      titulo: "Perfil H.264 estándar (Baseline, Main o High, 8 bits)",
      detalle: perfil === null ? "No se pudo leer el perfil." : `Perfil ${NOMBRE_PERFIL[perfil] ?? perfil}${nivel !== null ? `, nivel ${(nivel / 10).toFixed(1)}` : ""}.`,
      ...(perfilOk ? {} : { arreglo: "Expórtalo con perfil «Main» o «High» a 8 bits (sin 10 bits ni 4:2:2) y nivel 4.2 o menor. En HandBrake: «H.264 (x264)», perfil Main." }),
    });
  }

  // Sonido
  poner({
    id: "sonido",
    ok: !analisis.tieneAudio,
    titulo: "No tiene sonido",
    detalle: analisis.tieneAudio ? "Trae una pista de audio." : "Sin pista de audio.",
    ...(analisis.tieneAudio ? { arreglo: "Quítale el sonido al exportar (en CapCut: silenciar el clip; en HandBrake: borra la pista de audio; en Canva: «Silenciar»). Aunque en la tienda no suena, quedaría guardado en el archivo y cualquiera podría descargarlo." } : {}),
  });

  // Fotogramas
  const fps = video?.fps ?? null;
  const fpsOk = fps === null || fps <= MAX_FPS + TOLERANCIA_FPS;
  poner({
    id: "fotogramas",
    ok: fpsOk,
    titulo: `Hasta ${MAX_FPS} fotogramas por segundo`,
    detalle: fps === null ? "No se pudo leer (se acepta)." : `Tiene ${fps.toLocaleString("es-CO", { maximumFractionDigits: 1 })} fotogramas por segundo.`,
    ...(fpsOk ? {} : { arreglo: "Exporta a 30 fotogramas por segundo (o 24): con más pesa el doble y no se nota en una portada." }),
  });

  // Medidas y proporción
  const ancho = video?.ancho ?? null;
  const alto = video?.alto ?? null;
  if (ancho !== null && alto !== null && ancho > 0 && alto > 0) {
    poner(comprobarProporcion(ancho, alto, espec));
    poner(comprobarMedidas(ancho, alto, espec));
  } else {
    poner({ id: "medidas", ok: false, titulo: `Medidas entre ${medidas(espec.minimo)} y ${medidas(espec.maximo)} píxeles (ideal ${medidas(espec.ideal)})`, detalle: "No se pudieron leer las medidas del video.", arreglo: COMO_EXPORTAR });
  }

  const fallos = comprobaciones.filter((c) => !c.ok);
  return { cumple: fallos.length === 0, comprobaciones, fallos, seCorrigeSolo, recomendaciones };
}

/** Lo que el navegador de quien sube el video pudo hacer con él (solo el navegador lo puede saber). */
export interface ResultadoNavegador {
  /** El navegador lo abrió y mostró un fotograma. */
  reproducible: boolean;
  /** Se pudo tomar la imagen fija (el primer plano del video) que se ve mientras carga. */
  imagenFija: boolean;
}

/**
 * Suma al resultado la comprobación que solo hace el navegador: que ESTE navegador abre el video y se le puede tomar una imagen fija. Un video que cumple todo lo demás pero que el navegador de la
 * propia administradora no abre es casi seguro un video dañado o con un formato raro que el análisis del archivo no vio. Si el archivo ni siquiera se pudo leer, no se suma nada (no tiene sentido
 * preguntarle al navegador por algo que no es un video).
 */
export function agregarComprobacionNavegador(r: ResultadoRequisitos, n: ResultadoNavegador): ResultadoRequisitos {
  if (!r.comprobaciones.some((c) => c.id === "formato" && c.ok)) return r;
  const ok = n.reproducible && n.imagenFija;
  const comprobacion: Comprobacion = {
    id: "navegador",
    ok,
    titulo: "Se reproduce en tu navegador",
    detalle: !n.reproducible ? "Tu navegador no pudo abrirlo." : !n.imagenFija ? "Se abrió, pero no se pudo tomar la imagen fija." : "Se abrió y se vio bien.",
    ...(ok ? {} : { arreglo: `${COMO_EXPORTAR} Si ya lo hiciste y sigue sin abrirse, prueba con otro programa para exportarlo.` }),
  };
  const comprobaciones = [...r.comprobaciones, comprobacion];
  const fallos = comprobaciones.filter((c) => !c.ok);
  return { ...r, comprobaciones, fallos, cumple: fallos.length === 0 };
}

/**
 * El comando de ffmpeg que prepara un video para un archivo de la tienda (para quien trabaja con ffmpeg: recorta al centro, quita el sonido, 30 fps, H.264 estándar, índice al principio y
 * un tope de velocidad que mantiene el peso por debajo de 2 MB en 10 segundos).
 */
export function comandoFfmpeg(archivo: ArchivoVideoId): string {
  const { ideal } = ESPECIFICACIONES[archivo];
  return `ffmpeg -i entrada.mp4 -an -t 10 -vf "scale=${ideal.ancho}:${ideal.alto}:force_original_aspect_ratio=increase,crop=${ideal.ancho}:${ideal.alto},fps=30" -c:v libx264 -profile:v main -level 4.0 -pix_fmt yuv420p -crf 28 -preset slow -maxrate 1500k -bufsize 3000k -movflags +faststart salida.mp4`;
}

// ---------------------------------------------------------------------------
// Dónde usa un contenido sus videos
// ---------------------------------------------------------------------------

export interface UsoDeVideo {
  /** El archivo (espacio y orientación) donde se usa. */
  archivo: ArchivoVideoId;
  /** Id del video subido y de su imagen fija. */
  video: string;
  poster: string;
}

/** Cada video que el contenido de «fotos y videos» usa, con el espacio donde va (en el orden de `ARCHIVOS_VIDEO`). */
export function usosDeVideo(contenido: Pick<Multimedia, "videos">): UsoDeVideo[] {
  const salida: UsoDeVideo[] = [];
  const videos = (contenido.videos ?? {}) as Record<string, Partial<Record<OrientacionVideo, { video: string; poster: string }>> | undefined>;
  for (const archivo of ARCHIVOS_VIDEO) {
    const [espacio, orientacion] = archivo.split(".") as [EspacioVideo, OrientacionVideo];
    const ref = videos[espacio]?.[orientacion];
    if (ref) salida.push({ archivo, video: ref.video, poster: ref.poster });
  }
  return salida;
}
