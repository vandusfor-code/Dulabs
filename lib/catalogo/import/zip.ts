/**
 * Lector ZIP mínimo SIN dependencias: índice central + descompresión nativa
 * (`DecompressionStream("deflate-raw")`, disponible en los navegadores
 * actuales y en Node >= 18). Solo lo que la carga masiva necesita: leer
 * fotos y la planilla de un .zip armado en Windows/macOS.
 *
 * Defensas: tope de entradas, tope de tamaño por entrada (se verifica el
 * tamaño REAL al descomprimir, no solo el declarado: protege de "zip bombs"),
 * rechazo de ZIP cifrados y de ZIP64 (> 4 GB, fuera de alcance).
 */

export class ZipError extends Error {
  constructor(
    readonly reason: "invalid" | "encrypted" | "zip64" | "too_many_entries" | "unsupported" | "too_large",
    message: string,
  ) {
    super(message);
  }
}

export interface ZipEntry {
  /** Ruta completa dentro del ZIP (con carpetas). */
  path: string;
  /** Tamaño declarado (sin comprimir). */
  size: number;
  /** Descomprime la entrada. `maxBytes` corta si el contenido real es mayor. */
  read(maxBytes: number): Promise<Uint8Array>;
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ZipError("too_large", "Un archivo dentro del ZIP es más grande de lo permitido.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const utf8 = new TextDecoder("utf-8");
const cp437ish = new TextDecoder("windows-1252");

export function readZipIndex(bytes: Uint8Array, maxEntries: number): ZipEntry[] {
  // Fin del directorio central: firma 0x06054b50 en los últimos 22..65557 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("invalid", "El archivo no es un ZIP válido.");
  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new ZipError("zip64", "El ZIP es demasiado grande. Divide las fotos en varios ZIP más pequeños.");
  }
  if (count > maxEntries) throw new ZipError("too_many_entries", `El ZIP tiene más de ${maxEntries} archivos.`);
  if (cdOffset + cdSize > bytes.length) throw new ZipError("invalid", "El ZIP está incompleto o dañado.");

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new ZipError("invalid", "El ZIP está dañado.");
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOffset = u32(bytes, p + 42);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    const path = (flags & 0x800 ? utf8 : cp437ish).decode(nameBytes);
    p += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/")) continue;
    if (flags & 0x1) throw new ZipError("encrypted", "El ZIP está protegido con contraseña. Crea uno sin contraseña.");

    entries.push({
      path,
      size,
      async read(maxBytes: number) {
        if (size > maxBytes) throw new ZipError("too_large", "Un archivo dentro del ZIP es más grande de lo permitido.");
        if (localOffset + 30 > bytes.length || u32(bytes, localOffset) !== 0x04034b50) throw new ZipError("invalid", "El ZIP está dañado.");
        const start = localOffset + 30 + u16(bytes, localOffset + 26) + u16(bytes, localOffset + 28);
        const data = bytes.subarray(start, start + compressedSize);
        if (data.byteLength !== compressedSize) throw new ZipError("invalid", "El ZIP está incompleto o dañado.");
        if (method === 0) return data.slice();
        if (method === 8) return inflateRaw(data, maxBytes);
        throw new ZipError("unsupported", "El ZIP usa una compresión no compatible. Créalo de nuevo con la opción normal de tu computador.");
      },
    });
  }
  return entries;
}

/** Entradas que son basura del sistema (macOS/Windows) y nunca deben procesarse. */
export function isSystemEntry(path: string): boolean {
  return /(^|\/)__MACOSX\//.test(path) || /(^|\/)\._/.test(path) || /(^|\/)\.DS_Store$/.test(path) || /(^|\/)Thumbs\.db$/i.test(path) || /(^|\/)desktop\.ini$/i.test(path);
}
