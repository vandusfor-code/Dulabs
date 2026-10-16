/**
 * CMS comercial — un MP4 SINTÉTICO para las pruebas: la estructura de cajas de un video de verdad (ftyp, moov con sus pistas, mdat), con los datos que cada prueba necesita variar (códec,
 * medidas, giro, duración, fotogramas por segundo, sonido, índice al final, fragmentado…). No contiene imagen decodificable: sirve para probar el ANÁLISIS del contenedor, no la reproducción
 * (para eso las pruebas usan los videos reales de public/catalogo/delacour/video y, en el navegador, Chrome de verdad).
 */
import { ajustarDesplazamientos } from "@/lib/cms-comercial/video-mp4";

export interface OpcionesMp4 {
  /** Medidas de la pista (antes de aplicar el giro). Por defecto 1280×720. */
  ancho?: number;
  alto?: number;
  giro?: 0 | 90 | 180 | 270;
  /** Formato de las muestras de video: `avc1` (H.264) por defecto; `hvc1` (HEVC), `vp09`, `av01`… */
  formato?: string;
  perfilAvc?: number;
  nivelAvc?: number;
  duracionSeg?: number;
  fps?: number;
  audio?: boolean;
  /** Pistas que no son ni de video ni de audio (por ejemplo subtítulos). */
  otrasPistas?: number;
  moovAlFinal?: boolean;
  fragmentado?: boolean;
  /** Tamaño de los datos (mdat) en bytes. Por defecto 1000. */
  bytesDeDatos?: number;
  marca?: string;
  /** Cajas de versión 1 (tiempos de 64 bits) y desplazamientos de 64 bits (co64). */
  version1?: boolean;
  co64?: boolean;
  /** Corta el archivo en este largo (para probar archivos truncados). */
  cortarEn?: number;
}

const texto = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));
const u8 = (...n: number[]) => Uint8Array.from(n);
const u16 = (n: number) => u8((n >>> 8) & 0xff, n & 0xff);
const u32 = (n: number) => u8((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
const i32 = (n: number) => u32(n >>> 0);
const u64 = (n: number) => u8(...u32(Math.floor(n / 0x1_0000_0000)), ...u32(n % 0x1_0000_0000));
const ceros = (n: number) => new Uint8Array(n);

function unir(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((s, p) => s + p.byteLength, 0);
  const salida = new Uint8Array(total);
  let o = 0;
  for (const p of partes) {
    salida.set(p, o);
    o += p.byteLength;
  }
  return salida;
}

/** Una caja: tamaño + tipo + contenido. */
export function caja(tipo: string, ...contenido: Uint8Array[]): Uint8Array {
  const cuerpo = unir(...contenido);
  return unir(u32(8 + cuerpo.byteLength), texto(tipo), cuerpo);
}

const completa = (tipo: string, version: number, ...contenido: Uint8Array[]) => caja(tipo, u8(version, 0, 0, 0), ...contenido);

function matriz(giro: 0 | 90 | 180 | 270): Uint8Array {
  const uno = 0x10000;
  const [a, b, c, d] = giro === 90 ? [0, uno, -uno, 0] : giro === 270 ? [0, -uno, uno, 0] : giro === 180 ? [-uno, 0, 0, -uno] : [uno, 0, 0, uno];
  return unir(i32(a), i32(b), i32(0), i32(c), i32(d), i32(0), i32(0), i32(0), i32(0x4000_0000));
}

interface DatosPista {
  tipo: "vide" | "soun" | "text";
  id: number;
  formato: string;
  muestras: number;
  escala: number;
  duracion: number;
  desplazamiento: number;
}

function pista(o: Required<Pick<OpcionesMp4, "ancho" | "alto" | "giro" | "perfilAvc" | "nivelAvc" | "version1" | "co64">>, p: DatosPista): Uint8Array {
  const v = o.version1 ? 1 : 0;
  const duracionBytes = o.version1 ? u64(p.duracion) : u32(p.duracion);
  const tkhd = completa(
    "tkhd",
    v,
    ...(o.version1 ? [u64(0), u64(0), u32(p.id), u32(0), duracionBytes] : [u32(0), u32(0), u32(p.id), u32(0), duracionBytes]),
    ceros(8),
    u16(0),
    u16(0),
    u16(p.tipo === "soun" ? 0x100 : 0),
    u16(0),
    matriz(p.tipo === "vide" ? o.giro : 0),
    u32(p.tipo === "vide" ? o.ancho * 0x10000 : 0),
    u32(p.tipo === "vide" ? o.alto * 0x10000 : 0),
  );
  const mdhd = completa("mdhd", v, ...(o.version1 ? [u64(0), u64(0), u32(p.escala), u64(p.duracion)] : [u32(0), u32(0), u32(p.escala), u32(p.duracion)]), u16(0x55c4), u16(0));
  const hdlr = completa("hdlr", 0, u32(0), texto(p.tipo), ceros(12), u8(0));
  let entrada: Uint8Array;
  if (p.tipo === "vide") {
    const avcC = caja("avcC", u8(1, o.perfilAvc, 0, o.nivelAvc, 0xff, 0xe0, 0));
    entrada = caja(p.formato, ceros(6), u16(1), ceros(16), u16(o.ancho), u16(o.alto), u32(0x480000), u32(0x480000), u32(0), u16(1), ceros(32), u16(0x18), u16(0xffff), ...(p.formato === "avc1" || p.formato === "avc3" ? [avcC] : []));
  } else if (p.tipo === "soun") {
    entrada = caja(p.formato, ceros(6), u16(1), ceros(8), u16(2), u16(16), u16(0), u16(0), u32(48000 * 0x10000));
  } else {
    entrada = caja(p.formato, ceros(6), u16(1));
  }
  const stsd = completa("stsd", 0, u32(1), entrada);
  const stts = completa("stts", 0, u32(1), u32(p.muestras), u32(Math.max(1, Math.round(p.duracion / Math.max(1, p.muestras)))));
  const stsz = completa("stsz", 0, u32(0), u32(p.muestras), ...Array.from({ length: p.muestras }, () => u32(100)));
  const stsc = completa("stsc", 0, u32(1), u32(1), u32(p.muestras), u32(1));
  const stco = o.co64 ? completa("co64", 0, u32(1), u64(p.desplazamiento)) : completa("stco", 0, u32(1), u32(p.desplazamiento));
  const stbl = caja("stbl", stsd, stts, stsc, stsz, stco);
  const dinf = caja("dinf", completa("dref", 0, u32(1), completa("url ", 0)));
  const medioMinf = caja("minf", p.tipo === "vide" ? completa("vmhd", 0, ceros(8)) : p.tipo === "soun" ? completa("smhd", 0, ceros(4)) : completa("nmhd", 0), dinf, stbl);
  return caja("trak", tkhd, caja("mdia", mdhd, hdlr, medioMinf));
}

/** Construye el MP4. */
export function crearMp4(opciones: OpcionesMp4 = {}): Uint8Array {
  const o = {
    ancho: opciones.ancho ?? 1280,
    alto: opciones.alto ?? 720,
    giro: opciones.giro ?? 0,
    formato: opciones.formato ?? "avc1",
    perfilAvc: opciones.perfilAvc ?? 100,
    nivelAvc: opciones.nivelAvc ?? 40,
    duracionSeg: opciones.duracionSeg ?? 8,
    fps: opciones.fps ?? 30,
    audio: opciones.audio ?? false,
    otrasPistas: opciones.otrasPistas ?? 0,
    moovAlFinal: opciones.moovAlFinal ?? false,
    fragmentado: opciones.fragmentado ?? false,
    bytesDeDatos: opciones.bytesDeDatos ?? 1000,
    marca: opciones.marca ?? "isom",
    version1: opciones.version1 ?? false,
    co64: opciones.co64 ?? false,
  };
  const escala = 1000;
  const duracion = Math.round(o.duracionSeg * escala);
  const muestrasVideo = Math.max(1, Math.round(o.duracionSeg * o.fps));
  const ftyp = caja("ftyp", texto(o.marca), u32(512), texto("isom"), texto("iso2"), texto("avc1"), texto("mp41"));
  const datos = caja("mdat", ceros(o.bytesDeDatos));

  const moov = (desplazamientoDatos: number): Uint8Array => {
    const mvhd = completa(
      "mvhd",
      o.version1 ? 1 : 0,
      ...(o.version1 ? [u64(0), u64(0), u32(escala), u64(duracion)] : [u32(0), u32(0), u32(escala), u32(duracion)]),
      u32(0x10000),
      u16(0x100),
      u16(0),
      ceros(8),
      matriz(0),
      ceros(24),
      u32(opciones.audio ? 3 : 2),
    );
    const pistas = [pista(o, { tipo: "vide", id: 1, formato: o.formato, muestras: muestrasVideo, escala, duracion, desplazamiento: desplazamientoDatos })];
    if (o.audio) pistas.push(pista(o, { tipo: "soun", id: 2, formato: "mp4a", muestras: Math.round(o.duracionSeg * 43), escala, duracion, desplazamiento: desplazamientoDatos + 500 }));
    for (let i = 0; i < o.otrasPistas; i++) pistas.push(pista(o, { tipo: "text", id: 3 + i, formato: "tx3g", muestras: 1, escala, duracion, desplazamiento: desplazamientoDatos + 600 }));
    return caja("moov", mvhd, ...pistas, ...(o.fragmentado ? [caja("mvex", completa("trex", 0, u32(1), u32(1), u32(0), u32(0), u32(0)))] : []));
  };

  // El tamaño del índice no depende de los desplazamientos (son campos de largo fijo): se arma una vez para medirlo y otra con los desplazamientos buenos.
  const medida = moov(0).byteLength;
  const todo = o.moovAlFinal
    ? unir(ftyp, datos, moov(ftyp.byteLength + 8))
    : unir(ftyp, moov(ftyp.byteLength + medida + 8), datos);
  const conFragmentos = o.fragmentado ? unir(todo, caja("moof", completa("mfhd", 0, u32(1))), caja("mdat", ceros(10))) : todo;
  return opciones.cortarEn !== undefined ? conFragmentos.slice(0, opciones.cortarEn) : conFragmentos;
}

/** Parte el archivo en sus cajas de primer nivel (solo lee cabeceras: independiente del analizador). */
export function cajasDeArchivo(b: Uint8Array): Array<{ tipo: string; inicio: number; fin: number }> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const salida: Array<{ tipo: string; inicio: number; fin: number }> = [];
  for (let o = 0; o + 8 <= b.byteLength; ) {
    const tamano = v.getUint32(o);
    salida.push({ tipo: String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]), inicio: o, fin: o + tamano });
    o += tamano;
  }
  return salida;
}

/** El inverso de optimizarParaWeb: deja el índice al final y corrige los desplazamientos (restándolos), como lo dejan muchos celulares. */
export function moverIndiceAlFinal(b: Uint8Array): Uint8Array {
  const c = cajasDeArchivo(b);
  const moov = c.find((x) => x.tipo === "moov");
  if (!moov) throw new Error("el archivo no tiene índice (moov)");
  const copia = b.slice(moov.inicio, moov.fin);
  if (!ajustarDesplazamientos(copia, -(moov.fin - moov.inicio))) throw new Error("no se pudieron ajustar los desplazamientos");
  const partes = [...c.filter((x) => x.tipo !== "moov").map((x) => b.subarray(x.inicio, x.fin)), copia];
  const salida = new Uint8Array(b.byteLength);
  let o = 0;
  for (const p of partes) {
    salida.set(p, o);
    o += p.byteLength;
  }
  return salida;
}
