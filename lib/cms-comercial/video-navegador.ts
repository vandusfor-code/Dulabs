/**
 * CMS comercial — lo que se hace con un video EN EL NAVEGADOR de la administradora ANTES de subirlo: leerlo, analizarlo con el mismo código que usa el servidor, comprobar que su navegador lo
 * abre y tomarle la imagen fija (el fotograma que se ve mientras el video carga). Así el aviso de «este video no sirve» es inmediato y explica qué arreglar, sin esperar a subir 3 MB.
 *
 * Todo lo que toca el navegador (leer el archivo, abrir un <video>, dibujar un canvas) vive detrás de `HerramientasVideo` y se puede reemplazar: las pruebas de los componentes usan
 * herramientas falsas y las del análisis usan videos reales. La verificación que MANDA es la del servidor (videos.ts); esta es la misma regla, adelantada.
 */
import { analizarMp4 } from "@/lib/cms-comercial/video-mp4";
import { ESPECIFICACIONES, MAX_BYTES_A_LEER, agregarComprobacionNavegador, comprobarPeso, evaluarVideo, type ArchivoVideoId, type ResultadoRequisitos } from "@/lib/cms-comercial/video-requisitos";

/** Lo que el navegador pudo hacer con el archivo. */
export interface SondeoVideo {
  reproducible: boolean;
  ancho: number | null;
  alto: number | null;
  duracionSeg: number | null;
  /** La imagen fija (JPEG) tomada del video; null si no se pudo. */
  imagenFija: Blob | null;
}

export interface HerramientasVideo {
  /** Los bytes del archivo. */
  leerBytes(archivo: Blob): Promise<Uint8Array>;
  /** Abre el archivo como video en el navegador y le toma la imagen fija. Nunca lanza: un video que no abre es `reproducible: false`. */
  sondear(archivo: File): Promise<SondeoVideo>;
  /** Una dirección temporal para previsualizar un archivo (o una imagen) que todavía está solo en este navegador. */
  urlTemporal(blob: Blob): string;
  liberar(url: string): void;
}

/** Lado más largo de la imagen fija: más no se nota (se ve detrás del texto de la portada) y pesa. */
export const LADO_MAXIMO_IMAGEN_FIJA = 1280;
/** Cuánto se espera a que el navegador abra el video antes de darlo por no reproducible. */
const ESPERA_MS = 8000;
/** El fotograma que se toma: un quinto del video (el primer plano suele ser un fundido a negro), sin pasar de dos segundos. */
export const MOMENTO_IMAGEN_FIJA = { fraccion: 0.2, maximoSeg: 2, minimoSeg: 0.1 } as const;

/** El instante (en segundos) del que se toma la imagen fija, según lo que dura el video. */
export function momentoDeImagenFija(duracionSeg: number): number {
  if (!Number.isFinite(duracionSeg) || duracionSeg <= 0) return 0;
  return Math.min(Math.max(duracionSeg * MOMENTO_IMAGEN_FIJA.fraccion, MOMENTO_IMAGEN_FIJA.minimoSeg), MOMENTO_IMAGEN_FIJA.maximoSeg);
}

/** Escala (≤ 1) para que el lado más largo no pase de `lado`. */
export function escalaPara(ancho: number, alto: number, lado = LADO_MAXIMO_IMAGEN_FIJA): number {
  const mayor = Math.max(ancho, alto);
  return mayor > lado ? lado / mayor : 1;
}

function esperarEvento(el: HTMLVideoElement, evento: string, ms: number): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const limpiar = () => {
      clearTimeout(reloj);
      el.removeEventListener(evento, bien);
      el.removeEventListener("error", mal);
    };
    const bien = () => (limpiar(), resolver());
    const mal = () => (limpiar(), rechazar(new Error("el navegador no pudo abrir el video")));
    const reloj = setTimeout(() => (limpiar(), rechazar(new Error("el navegador tardó demasiado en abrir el video"))), ms);
    el.addEventListener(evento, bien, { once: true });
    el.addEventListener("error", mal, { once: true });
  });
}

const NO_REPRODUCIBLE: SondeoVideo = { reproducible: false, ancho: null, alto: null, duracionSeg: null, imagenFija: null };

async function sondearEnNavegador(archivo: File): Promise<SondeoVideo> {
  const url = URL.createObjectURL(archivo);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.disablePictureInPicture = true;
  try {
    video.src = url;
    try {
      await esperarEvento(video, "loadeddata", ESPERA_MS / 2);
    } catch {
      // Algunos navegadores de celular (por ejemplo, un iPhone con ahorro de batería) no cargan un video hasta que algo intenta reproducirlo.
      video.play().catch(() => {});
      await esperarEvento(video, "loadeddata", ESPERA_MS / 2);
      video.pause();
    }
    const ancho = video.videoWidth;
    const alto = video.videoHeight;
    if (!(ancho > 0) || !(alto > 0)) return NO_REPRODUCIBLE;
    const duracionSeg = Number.isFinite(video.duration) ? video.duration : null;
    const momento = momentoDeImagenFija(duracionSeg ?? 0);
    if (momento > 0) {
      video.currentTime = momento;
      await esperarEvento(video, "seeked", ESPERA_MS);
    }
    const escala = escalaPara(ancho, alto);
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(ancho * escala));
    lienzo.height = Math.max(1, Math.round(alto * escala));
    const contexto = lienzo.getContext("2d");
    if (!contexto) return { reproducible: true, ancho, alto, duracionSeg, imagenFija: null };
    contexto.drawImage(video, 0, 0, lienzo.width, lienzo.height);
    const imagenFija = await new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, "image/jpeg", 0.86));
    return { reproducible: true, ancho, alto, duracionSeg, imagenFija };
  } catch {
    return NO_REPRODUCIBLE;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Las herramientas de verdad (solo en el navegador). */
export const herramientasReales: HerramientasVideo = {
  leerBytes: async (archivo) => new Uint8Array(await archivo.arrayBuffer()),
  sondear: sondearEnNavegador,
  urlTemporal: (blob) => URL.createObjectURL(blob),
  liberar: (url) => URL.revokeObjectURL(url),
};

/** El resultado de revisar un archivo antes de subirlo. */
export interface RevisionVideo {
  nombre: string;
  bytes: number;
  archivo: ArchivoVideoId;
  resultado: ResultadoRequisitos;
  /** La imagen fija tomada del video (solo si el navegador lo abrió). */
  imagenFija: Blob | null;
  /** Se leyó el archivo completo (false = pesaba demasiado y ni se abrió). */
  leido: boolean;
}

/**
 * Revisa un archivo contra los requisitos de un espacio: peso (sin leerlo, si es enorme), estructura del MP4, códec, sonido, duración, proporción y medidas, y que este navegador lo abra.
 * Nunca lanza: un archivo que no se puede leer es un resultado con la regla «no es un MP4» incumplida.
 */
export async function revisarArchivo(archivo: File, destino: ArchivoVideoId, herramientas: HerramientasVideo): Promise<RevisionVideo> {
  const base = { nombre: archivo.name, bytes: archivo.size, archivo: destino };
  if (archivo.size > MAX_BYTES_A_LEER) {
    // Un archivo de decenas de megas no se abre en el navegador solo para decirle que pesa demasiado.
    const peso = comprobarPeso(archivo.size, ESPECIFICACIONES[destino]);
    return { ...base, resultado: { cumple: false, comprobaciones: [peso], fallos: [peso], seCorrigeSolo: [], recomendaciones: [] }, imagenFija: null, leido: false };
  }
  let bytes: Uint8Array;
  try {
    bytes = await herramientas.leerBytes(archivo);
  } catch {
    const resultado = evaluarVideo(analizarMp4(new Uint8Array(0)), destino);
    return { ...base, resultado, imagenFija: null, leido: false };
  }
  const resultado = evaluarVideo(analizarMp4(bytes), destino);
  const legible = resultado.comprobaciones.some((c) => c.id === "formato" && c.ok);
  if (!legible) return { ...base, resultado, imagenFija: null, leido: true };
  const sondeo = await herramientas.sondear(archivo).catch((): SondeoVideo => NO_REPRODUCIBLE);
  return { ...base, resultado: agregarComprobacionNavegador(resultado, { reproducible: sondeo.reproducible, imagenFija: sondeo.imagenFija !== null }), imagenFija: sondeo.imagenFija, leido: true };
}
