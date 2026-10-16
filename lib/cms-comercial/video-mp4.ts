/**
 * CMS comercial — ANÁLISIS de un archivo MP4 (PURO: sin I/O y sin APIs del navegador ni de Node; solo `Uint8Array` y `DataView`).
 *
 * Lo usan dos lugares con el MISMO código: el navegador (aviso inmediato antes de subir un video pesado) y el servidor (la autoridad al confirmar la subida y al publicar). Lee la
 * estructura del contenedor (las «cajas» del MP4) y saca lo que hace falta para decidir si un video sirve como video ambiental de la tienda: el códec, las medidas de pantalla (ya con el
 * giro de los videos grabados con el celular en vertical), la duración, los fotogramas por segundo, si trae sonido y si el índice (`moov`) está al principio.
 *
 * Es defensivo a propósito: el archivo lo elige una persona y puede estar dañado o ser hostil. Toda lectura está acotada, la cantidad de cajas tiene tope (y la profundidad es la fija de un MP4: solo se baja por los niveles conocidos, nunca de forma recursiva) y nada lanza:
 * lo que no se puede leer queda anotado en `problemas` y el análisis devuelve lo que sí pudo leer.
 */

export type CodecVideo = "h264" | "hevc" | "vp9" | "av1" | "mpeg4" | "prores" | "otro";

export interface PistaMp4 {
  tipo: "video" | "audio" | "otra";
  /** El código de cuatro letras del formato de las muestras (`avc1`, `hvc1`, `mp4a`…), o null si no se pudo leer. */
  formato: string | null;
  codec: CodecVideo | null;
  /** Medidas de PANTALLA en píxeles (ya giradas si la pista lleva giro de 90° o 270°). Solo en las pistas de video. */
  ancho: number | null;
  alto: number | null;
  /** Giro con el que se muestra: 0, 90, 180 o 270 grados. */
  giro: 0 | 90 | 180 | 270;
  /** H.264: el `profile_idc` (66 base, 77 principal, 100 alto, 110/122/244 de más de 8 bits o 4:2:2/4:4:4) y el `level_idc` (31 = 3.1, 40 = 4.0…). */
  perfilAvc: number | null;
  nivelAvc: number | null;
  /** Cantidad de muestras (fotogramas, en una pista de video) y fotogramas por segundo. */
  muestras: number | null;
  fps: number | null;
  duracionSeg: number | null;
}

export type ProblemaMp4 = "no_es_mp4" | "truncado" | "sin_moov" | "sin_mdat" | "sin_pistas" | "demasiado_complejo";

export interface AnalisisMp4 {
  bytes: number;
  /** Marca principal de la caja `ftyp` (`isom`, `mp42`, `qt  `…), o null si no hay. */
  marca: string | null;
  /** ¿Es un MP4 que se puede leer: `ftyp`, `moov` y `mdat` completos? */
  legible: boolean;
  problemas: ProblemaMp4[];
  /** El índice (`moov`) va antes de los datos (`mdat`): el video empieza a verse sin esperar a que baje entero. */
  indiceAlPrincipio: boolean;
  /** MP4 fragmentado (por trozos, para transmisión): no se admite. */
  fragmentado: boolean;
  duracionSeg: number | null;
  pistas: PistaMp4[];
  /** La primera pista de video (o null). */
  video: PistaMp4 | null;
  tieneAudio: boolean;
  /** Pistas que no son de video ni de audio (subtítulos, metadatos…). */
  otrasPistas: number;
}

const MAX_CAJAS = 20_000;
const MAX_PISTAS = 16;

// ---------------------------------------------------------------------------
// Lectura binaria acotada
// ---------------------------------------------------------------------------

class Lector {
  readonly datos: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.datos = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get largo() {
    return this.bytes.byteLength;
  }
  u8(o: number): number | null {
    return o >= 0 && o + 1 <= this.largo ? this.datos.getUint8(o) : null;
  }
  u16(o: number): number | null {
    return o >= 0 && o + 2 <= this.largo ? this.datos.getUint16(o) : null;
  }
  u32(o: number): number | null {
    return o >= 0 && o + 4 <= this.largo ? this.datos.getUint32(o) : null;
  }
  i32(o: number): number | null {
    return o >= 0 && o + 4 <= this.largo ? this.datos.getInt32(o) : null;
  }
  /** Entero de 64 bits como número; null si no cabe en un entero seguro. */
  u64(o: number): number | null {
    if (o < 0 || o + 8 > this.largo) return null;
    const alto = this.datos.getUint32(o);
    const bajo = this.datos.getUint32(o + 4);
    return alto > 0x1f_ffff ? null : alto * 0x1_0000_0000 + bajo;
  }
  cuatro(o: number): string | null {
    if (o < 0 || o + 4 > this.largo) return null;
    return String.fromCharCode(this.bytes[o], this.bytes[o + 1], this.bytes[o + 2], this.bytes[o + 3]);
  }
}

interface Caja {
  tipo: string;
  /** Dónde empieza la caja (su cabecera) y dónde empieza su contenido. */
  inicio: number;
  cuerpo: number;
  /** Dónde termina (exclusivo), ya acotado al archivo. */
  fin: number;
  /** La caja dice ser más larga que el archivo: está cortada. */
  truncada: boolean;
}

/** Las cajas hermanas entre `desde` y `hasta`. Se detiene ante una cabecera imposible; cuenta cada caja contra el tope general. */
function cajas(l: Lector, desde: number, hasta: number, contador: { n: number }): Caja[] {
  const salida: Caja[] = [];
  let o = desde;
  while (o + 8 <= hasta) {
    if (++contador.n > MAX_CAJAS) break;
    const tamano32 = l.u32(o);
    const tipo = l.cuatro(o + 4);
    if (tamano32 === null || tipo === null) break;
    let cabecera = 8;
    let tamano = tamano32;
    if (tamano32 === 1) {
      const grande = l.u64(o + 8);
      if (grande === null) break;
      cabecera = 16;
      tamano = grande;
    } else if (tamano32 === 0) {
      tamano = hasta - o; // hasta el final del contenedor
    }
    if (tamano < cabecera) break; // cabecera imposible
    const fin = o + tamano;
    salida.push({ tipo, inicio: o, cuerpo: o + cabecera, fin: Math.min(fin, hasta), truncada: fin > hasta });
    o = fin;
    if (tamano === 0) break;
  }
  return salida;
}

const hijo = (l: Lector, padre: Caja, tipo: string, contador: { n: number }): Caja | null => cajas(l, padre.cuerpo, padre.fin, contador).find((c) => c.tipo === tipo) ?? null;
const hijos = (l: Lector, padre: Caja, tipo: string, contador: { n: number }): Caja[] => cajas(l, padre.cuerpo, padre.fin, contador).filter((c) => c.tipo === tipo);

// ---------------------------------------------------------------------------
// Pistas
// ---------------------------------------------------------------------------

/** Escala (ticks por segundo) y duración (en ticks) de `mvhd` y `mdhd`, que comparten formato. */
function escalaYDuracion(l: Lector, c: Caja): { escala: number; duracion: number } | null {
  const version = l.u8(c.cuerpo);
  if (version === null) return null;
  const escala = version === 1 ? l.u32(c.cuerpo + 20) : l.u32(c.cuerpo + 12);
  const duracion = version === 1 ? l.u64(c.cuerpo + 24) : l.u32(c.cuerpo + 16);
  if (escala === null || duracion === null || escala <= 0) return null;
  return { escala, duracion };
}

function codecDe(formato: string | null): CodecVideo | null {
  if (formato === null) return null;
  if (formato === "avc1" || formato === "avc3") return "h264";
  if (formato === "hvc1" || formato === "hev1" || formato === "dvh1" || formato === "dvhe") return "hevc";
  if (formato === "vp09") return "vp9";
  if (formato === "av01") return "av1";
  if (formato === "mp4v") return "mpeg4";
  if (formato === "apch" || formato === "apcn" || formato === "apcs" || formato === "apco" || formato === "ap4h" || formato === "ap4x") return "prores";
  return "otro";
}

function giroDe(l: Lector, tkhd: Caja): 0 | 90 | 180 | 270 {
  const version = l.u8(tkhd.cuerpo) ?? 0;
  const m = tkhd.cuerpo + (version === 1 ? 52 : 40);
  const a = l.i32(m);
  const b = l.i32(m + 4);
  const c = l.i32(m + 12);
  const d = l.i32(m + 16);
  if (a === null || b === null || c === null || d === null) return 0;
  if (a === 0 && d === 0) {
    if (b > 0 && c < 0) return 90;
    if (b < 0 && c > 0) return 270;
    return 0;
  }
  if (a < 0 && d < 0) return 180;
  return 0;
}

function leerPista(l: Lector, trak: Caja, contador: { n: number }): PistaMp4 {
  const pista: PistaMp4 = { tipo: "otra", formato: null, codec: null, ancho: null, alto: null, giro: 0, perfilAvc: null, nivelAvc: null, muestras: null, fps: null, duracionSeg: null };
  const mdia = hijo(l, trak, "mdia", contador);
  if (!mdia) return pista;
  const hdlr = hijo(l, mdia, "hdlr", contador);
  const manejador = hdlr ? l.cuatro(hdlr.cuerpo + 8) : null;
  pista.tipo = manejador === "vide" ? "video" : manejador === "soun" ? "audio" : "otra";

  const mdhd = hijo(l, mdia, "mdhd", contador);
  const medio = mdhd ? escalaYDuracion(l, mdhd) : null;
  if (medio) pista.duracionSeg = medio.duracion / medio.escala;

  const minf = hijo(l, mdia, "minf", contador);
  const stbl = minf ? hijo(l, minf, "stbl", contador) : null;
  if (stbl) {
    const stsd = hijo(l, stbl, "stsd", contador);
    if (stsd && (l.u32(stsd.cuerpo + 4) ?? 0) >= 1) {
      const entrada = stsd.cuerpo + 8;
      pista.formato = l.cuatro(entrada + 4);
      if (pista.tipo === "video") {
        pista.codec = codecDe(pista.formato);
        // Cajas dentro de la entrada de video: empiezan 86 bytes después del inicio de la entrada (8 de cabecera, 8 de la entrada de muestras y 70 de campos visuales).
        const tamanoEntrada = l.u32(entrada);
        const finEntrada = tamanoEntrada === null ? stsd.fin : Math.min(stsd.fin, entrada + tamanoEntrada);
        const avcC = cajas(l, entrada + 86, finEntrada, contador).find((c) => c.tipo === "avcC");
        if (avcC) {
          pista.perfilAvc = l.u8(avcC.cuerpo + 1);
          pista.nivelAvc = l.u8(avcC.cuerpo + 3);
        }
        pista.ancho = l.u16(entrada + 8 + 24);
        pista.alto = l.u16(entrada + 8 + 26);
      }
    }
    const stts = hijo(l, stbl, "stts", contador);
    if (stts) {
      const n = l.u32(stts.cuerpo + 4) ?? 0;
      let muestras = 0;
      for (let i = 0; i < Math.min(n, 100_000); i++) {
        const cuenta = l.u32(stts.cuerpo + 8 + i * 8);
        if (cuenta === null) break;
        muestras += cuenta;
      }
      pista.muestras = muestras;
      if (medio && muestras > 0 && medio.duracion > 0) pista.fps = muestras / (medio.duracion / medio.escala);
    }
  }

  if (pista.tipo === "video") {
    const tkhd = hijo(l, trak, "tkhd", contador);
    if (tkhd) {
      const version = l.u8(tkhd.cuerpo) ?? 0;
      const w = l.u32(tkhd.cuerpo + (version === 1 ? 88 : 76));
      const h = l.u32(tkhd.cuerpo + (version === 1 ? 92 : 80));
      pista.giro = giroDe(l, tkhd);
      // El tamaño de la pista (16.16) manda; si falta, el de la entrada de muestras.
      const ancho = w !== null && w >= 0x10000 ? Math.round(w / 0x10000) : pista.ancho;
      const alto = h !== null && h >= 0x10000 ? Math.round(h / 0x10000) : pista.alto;
      const girada = pista.giro === 90 || pista.giro === 270;
      pista.ancho = girada ? alto : ancho;
      pista.alto = girada ? ancho : alto;
    } else if (pista.giro === 90 || pista.giro === 270) {
      [pista.ancho, pista.alto] = [pista.alto, pista.ancho];
    }
  }
  return pista;
}

// ---------------------------------------------------------------------------
// Análisis
// ---------------------------------------------------------------------------

export function analizarMp4(bytes: Uint8Array): AnalisisMp4 {
  const l = new Lector(bytes);
  const resultado: AnalisisMp4 = { bytes: bytes.byteLength, marca: null, legible: false, problemas: [], indiceAlPrincipio: false, fragmentado: false, duracionSeg: null, pistas: [], video: null, tieneAudio: false, otrasPistas: 0 };
  const contador = { n: 0 };

  if (bytes.byteLength < 16 || l.cuatro(4) !== "ftyp") {
    resultado.problemas.push("no_es_mp4");
    return resultado;
  }
  const raiz = cajas(l, 0, bytes.byteLength, contador);
  if (contador.n > MAX_CAJAS) resultado.problemas.push("demasiado_complejo");
  const ftyp = raiz.find((c) => c.tipo === "ftyp");
  if (!ftyp) {
    resultado.problemas.push("no_es_mp4");
    return resultado;
  }
  resultado.marca = l.cuatro(ftyp.cuerpo);

  const moov = raiz.find((c) => c.tipo === "moov") ?? null;
  const mdats = raiz.filter((c) => c.tipo === "mdat");
  resultado.fragmentado = raiz.some((c) => c.tipo === "moof");
  if (raiz.some((c) => c.truncada)) resultado.problemas.push("truncado");
  if (!moov) resultado.problemas.push("sin_moov");
  if (mdats.length === 0) resultado.problemas.push("sin_mdat");
  if (moov) resultado.indiceAlPrincipio = mdats.length === 0 || moov.inicio < mdats[0].inicio;
  if (!moov) return resultado;

  const mvex = hijo(l, moov, "mvex", contador);
  if (mvex) resultado.fragmentado = true;

  const mvhd = hijo(l, moov, "mvhd", contador);
  const general = mvhd ? escalaYDuracion(l, mvhd) : null;
  if (general) resultado.duracionSeg = general.duracion / general.escala;

  const trak = hijos(l, moov, "trak", contador);
  for (const t of trak.slice(0, MAX_PISTAS)) resultado.pistas.push(leerPista(l, t, contador));
  if (trak.length > MAX_PISTAS) resultado.problemas.push("demasiado_complejo");
  if (resultado.pistas.length === 0) resultado.problemas.push("sin_pistas");

  resultado.video = resultado.pistas.find((p) => p.tipo === "video") ?? null;
  resultado.tieneAudio = resultado.pistas.some((p) => p.tipo === "audio");
  resultado.otrasPistas = resultado.pistas.filter((p) => p.tipo === "otra").length;
  if (resultado.duracionSeg === null && resultado.video?.duracionSeg != null) resultado.duracionSeg = resultado.video.duracionSeg;

  resultado.legible = !resultado.problemas.some((p) => p === "no_es_mp4" || p === "truncado" || p === "sin_moov" || p === "sin_mdat" || p === "sin_pistas" || p === "demasiado_complejo");
  return resultado;
}

// ---------------------------------------------------------------------------
// Optimizar para la web: el índice (`moov`) al principio
// ---------------------------------------------------------------------------

/**
 * Suma `delta` (puede ser negativo) a TODOS los desplazamientos de datos (`stco` y `co64`) de un índice `moov` que se entrega completo, cabecera incluida, y lo modifica en su lugar.
 * Devuelve false (y puede dejar el índice a medias: quien llama descarta la copia) si algo no cuadra: tablas cortadas o un desplazamiento que se sale del rango.
 */
export function ajustarDesplazamientos(moovBytes: Uint8Array, delta: number): boolean {
  const l = new Lector(moovBytes);
  const contador = { n: 0 };
  const moov = cajas(l, 0, moovBytes.byteLength, contador)[0];
  if (!moov || moov.tipo !== "moov") return false;
  for (const trak of hijos(l, moov, "trak", contador)) {
    const mdia = hijo(l, trak, "mdia", contador);
    const minf = mdia ? hijo(l, mdia, "minf", contador) : null;
    const stbl = minf ? hijo(l, minf, "stbl", contador) : null;
    if (!stbl) continue;
    for (const c of cajas(l, stbl.cuerpo, stbl.fin, contador)) {
      if (c.tipo !== "stco" && c.tipo !== "co64") continue;
      const n = l.u32(c.cuerpo + 4);
      if (n === null) return false;
      const ancho = c.tipo === "stco" ? 4 : 8;
      if (c.cuerpo + 8 + n * ancho > c.fin) return false;
      const datos = l.datos;
      for (let i = 0; i < n; i++) {
        const pos = c.cuerpo + 8 + i * ancho;
        if (c.tipo === "stco") {
          const nuevo = datos.getUint32(pos) + delta;
          if (nuevo < 0 || nuevo > 0xffff_ffff) return false;
          datos.setUint32(pos, nuevo);
        } else {
          const actual = l.u64(pos);
          if (actual === null) return false;
          const nuevo = actual + delta;
          if (nuevo < 0) return false;
          datos.setUint32(pos, Math.floor(nuevo / 0x1_0000_0000));
          datos.setUint32(pos + 4, nuevo % 0x1_0000_0000);
        }
      }
    }
  }
  return true;
}

/**
 * Mueve el índice (`moov`) al principio del archivo y corrige las posiciones de los datos, como `qt-faststart`: es solo reordenar bytes, sin volver a codificar nada. Muchos celulares y
 * programas lo dejan al final, y así el video no empieza a verse hasta bajar entero; con esto la persona no tiene que saber qué es.
 *
 * Devuelve los MISMOS bytes si el índice ya va al principio, los bytes nuevos si lo movió, y null si no se puede hacer con seguridad (varios `mdat`, archivo fragmentado, cortado, etc.).
 */
export function optimizarParaWeb(bytes: Uint8Array): Uint8Array | null {
  const l = new Lector(bytes);
  const contador = { n: 0 };
  const raiz = cajas(l, 0, bytes.byteLength, contador);
  if (raiz.length === 0 || raiz[0].tipo !== "ftyp" || contador.n > MAX_CAJAS) return null;
  if (raiz.some((c) => c.truncada || c.tipo === "moof")) return null;
  const moovs = raiz.filter((c) => c.tipo === "moov");
  const mdats = raiz.filter((c) => c.tipo === "mdat");
  if (moovs.length !== 1 || mdats.length !== 1) return null;
  const moov = moovs[0];
  const mdat = mdats[0];
  if (moov.inicio < mdat.inicio) return bytes;

  // Orden nuevo: ftyp, moov, y después todo lo demás en su orden (incluido mdat).
  const moovCopia = bytes.slice(moov.inicio, moov.fin);
  if (!ajustarDesplazamientos(moovCopia, moov.fin - moov.inicio)) return null;

  const salida = new Uint8Array(bytes.byteLength);
  let o = 0;
  const poner = (trozo: Uint8Array) => {
    salida.set(trozo, o);
    o += trozo.byteLength;
  };
  poner(bytes.subarray(raiz[0].inicio, raiz[0].fin));
  poner(moovCopia);
  for (const c of raiz.slice(1)) if (c !== moov) poner(bytes.subarray(c.inicio, c.fin));
  // Bytes sueltos al final que no forman una caja (relleno): se conservan tal cual.
  const ultimo = raiz[raiz.length - 1];
  if (ultimo.fin < bytes.byteLength) poner(bytes.subarray(ultimo.fin));
  return o === bytes.byteLength ? salida : null;
}
