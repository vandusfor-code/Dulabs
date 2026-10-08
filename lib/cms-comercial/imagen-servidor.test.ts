/**
 * CMS comercial — procesamiento de imágenes en el servidor (sharp REAL, con imágenes sintéticas): lo que sale siempre es un WebP limpio y acotado; lo que no es
 * una imagen, está manipulado o es desmesurado se rechaza con un mensaje claro.
 */
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { describe, it } from "node:test";
import sharp from "sharp";
import { LADO_MAXIMO, MAX_BYTES_SUBIDA, MAX_PIXELES, ImagenInvalida, formatoPorFirma, procesarImagen } from "@/lib/cms-comercial/imagen-servidor";

const base = (w: number, h: number, canales: 3 | 4 = 3) => sharp({ create: { width: w, height: h, channels: canales, background: { r: 200, g: 40, b: 40, alpha: canales === 4 ? 0.5 : 1 } } });
const png = (w: number, h: number, canales: 3 | 4 = 3) => base(w, h, canales).png().toBuffer();
const jpeg = (w: number, h: number) => base(w, h).jpeg().toBuffer();
const webp = (w: number, h: number) => base(w, h).webp().toBuffer();

async function rechaza(bytes: Uint8Array, mensaje: RegExp) {
  await assert.rejects(procesarImagen(bytes), (err: unknown) => {
    assert.ok(err instanceof ImagenInvalida, `se esperaba ImagenInvalida y llegó ${String(err)}`);
    assert.match(err.message, mensaje);
    return true;
  });
}

/** Un PNG con la cabecera válida (CRC incluido) que DICE ser de ancho × alto, sin datos de píxeles: el caso de una «bomba de descompresión». */
function pngQueMiente(ancho: number, alto: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // color RGB
  const trozo = (tipo: string, datos: Buffer) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length, 0);
    const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo) >>> 0, 0);
    return Buffer.concat([largo, cuerpo, crc]);
  };
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo("IHDR", ihdr), trozo("IEND", Buffer.alloc(0))]));
}

describe("formatoPorFirma — por los primeros bytes, no por lo que declare quien sube", () => {
  it("reconoce JPEG, PNG y WebP", async () => {
    assert.equal(formatoPorFirma(await jpeg(20, 20)), "jpeg");
    assert.equal(formatoPorFirma(await png(20, 20)), "png");
    assert.equal(formatoPorFirma(await webp(20, 20)), "webp");
  });

  it("rechaza todo lo demás (GIF, PDF, texto, SVG, ejecutables, vacío)", () => {
    const bytes = (s: string) => new TextEncoder().encode(s);
    for (const malo of [bytes("GIF89a\u0001\u0000"), bytes("%PDF-1.7"), bytes("hola, esto es un texto"), bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"), new Uint8Array([0x4d, 0x5a, 0x90, 0]), new Uint8Array(), new Uint8Array([0xff, 0xd8])]) {
      assert.equal(formatoPorFirma(malo), null);
    }
  });
});

describe("procesarImagen — sale SIEMPRE un WebP limpio y acotado", () => {
  it("convierte PNG, JPEG y WebP a WebP y conserva el formato original en el resultado", async () => {
    for (const [formato, bytes] of [["png", await png(300, 200)], ["jpeg", await jpeg(300, 200)], ["webp", await webp(300, 200)]] as const) {
      const r = await procesarImagen(bytes);
      assert.equal(r.mimeType, "image/webp");
      assert.equal(r.formatoOriginal, formato);
      assert.equal(formatoPorFirma(r.bytes), "webp", formato);
      assert.deepEqual([r.ancho, r.alto], [300, 200]);
      const meta = await sharp(r.bytes).metadata();
      assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 300, 200]);
    }
  });

  it("reduce lo grande al lado máximo conservando la proporción, y nunca amplía lo pequeño", async () => {
    const grande = await procesarImagen(await jpeg(3600, 2400));
    assert.deepEqual([grande.ancho, grande.alto], [LADO_MAXIMO, 1600]);
    const alta = await procesarImagen(await jpeg(2400, 4800));
    assert.deepEqual([alta.ancho, alta.alto], [1200, LADO_MAXIMO]);
    const chica = await procesarImagen(await png(100, 50));
    assert.deepEqual([chica.ancho, chica.alto], [100, 50]);
  });

  it("conserva la transparencia de un PNG", async () => {
    const r = await procesarImagen(await png(64, 64, 4));
    assert.equal((await sharp(r.bytes).metadata()).hasAlpha, true);
  });

  it("aplica la orientación EXIF antes de descartar los metadatos", async () => {
    const girada = await base(120, 60).jpeg().withMetadata({ orientation: 6 }).toBuffer(); // «rotar 90°»
    const r = await procesarImagen(girada);
    assert.deepEqual([r.ancho, r.alto], [60, 120]);
    assert.equal((await sharp(r.bytes).metadata()).orientation, undefined);
  });

  it("elimina los metadatos (EXIF con datos personales como autor o ubicación)", async () => {
    const conExif = await base(80, 80).jpeg().withExif({ IFD0: { Copyright: "Persona Privada", Artist: "Ana" }, IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "W" } }).toBuffer();
    assert.ok((await sharp(conExif).metadata()).exif, "la entrada sí traía EXIF");
    const r = await procesarImagen(conExif);
    const meta = await sharp(r.bytes).metadata();
    assert.equal(meta.exif, undefined);
    assert.equal(Buffer.from(r.bytes).includes(Buffer.from("Persona Privada")), false);
  });
});

describe("procesarImagen — lo que NO es una imagen o es peligroso se rechaza", () => {
  it("vacío, texto, GIF, PDF y SVG: «no es una imagen válida»", async () => {
    await rechaza(new Uint8Array(), /vacío/);
    for (const malo of ["hola, esto es un texto", "GIF89a\u0001\u0000", "%PDF-1.7 cualquier cosa", "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"]) {
      await rechaza(new TextEncoder().encode(malo), /no es una imagen válida/);
    }
  });

  it("un archivo con firma de imagen pero contenido roto o truncado", async () => {
    const entera = await png(400, 300);
    await rechaza(entera.subarray(0, Math.floor(entera.length / 2)), /no es una imagen válida|No pudimos procesar/);
    const corrupta = Buffer.from(entera);
    for (let i = 64; i < Math.min(corrupta.length, 400); i++) corrupta[i] ^= 0xff;
    await rechaza(corrupta, /no es una imagen válida|No pudimos procesar/);
    await rechaza(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), /no es una imagen válida|No pudimos procesar/);
  });

  it("un GIF, un TIFF o un SVG VÁLIDOS (que la librería sí sabría abrir) se rechazan por su firma: solo se admiten JPG, PNG y WebP", async () => {
    const base = sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } } });
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/><script>alert(1)</script></svg>');
    const archivos: Array<[string, Uint8Array]> = [
      ["gif", await base.clone().gif().toBuffer()],
      ["tiff", await base.clone().tiff().toBuffer()],
      ["svg", svg],
    ];
    for (const [nombre, bytes] of archivos) {
      assert.equal((await sharp(bytes).metadata()).width, 64, `${nombre}: la librería SÍ lo abre (la prueba es válida)`);
      assert.equal(formatoPorFirma(bytes.subarray(0, 16)), null, nombre);
      await rechaza(bytes, /no es una imagen válida/);
    }
  });

  it("más de 6 MB", async () => {
    const enorme = new Uint8Array(MAX_BYTES_SUBIDA + 1);
    enorme.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await rechaza(enorme, /6 MB/);
  });

  it("una imagen animada (un WebP con varios cuadros) se rechaza: la tienda solo muestra imágenes fijas", async () => {
    const cuadro = (background: { r: number; g: number; b: number }) => sharp({ create: { width: 64, height: 64, channels: 3, background } }).png().toBuffer();
    const animada = await sharp([await cuadro({ r: 255, g: 0, b: 0 }), await cuadro({ r: 0, g: 0, b: 255 })], { join: { animated: true } }).webp().toBuffer();
    assert.equal((await sharp(animada).metadata()).pages, 2, "la prueba parte de una imagen que de verdad es animada");
    await rechaza(animada, /animadas/);
    // un WebP fijo con las mismas dimensiones sí pasa
    assert.equal((await procesarImagen(await sharp(await cuadro({ r: 1, g: 2, b: 3 })).webp().toBuffer())).mimeType, "image/webp");
  });

  it("demasiado pequeña", async () => {
    await rechaza(await png(8, 8), /demasiado pequeña/);
    await rechaza(await png(15, 400), /demasiado pequeña/);
  });

  it("más de 40 megapíxeles (aunque el archivo pese muy poco): «demasiado grande», sin decodificarla", async () => {
    assert.ok(7000 * 7000 > MAX_PIXELES);
    const enorme = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png({ compressionLevel: 9 }).toBuffer();
    assert.ok(enorme.length < 1_000_000, "un PNG liso de 49 megapíxeles pesa menos de 1 MB: justo el caso de una bomba de descompresión");
    await rechaza(enorme, /demasiado grande/);
  });

  it("justo por debajo del límite de píxeles SÍ se acepta (y se reduce)", async () => {
    const grande = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png({ compressionLevel: 9 }).toBuffer();
    const r = await procesarImagen(grande);
    assert.deepEqual([r.ancho, r.alto], [LADO_MAXIMO, LADO_MAXIMO]);
  });

  it("una cabecera que miente (anuncia miles de millones de píxeles y no trae datos) se rechaza", async () => {
    await rechaza(pngQueMiente(30000, 30000), /demasiado grande|no es una imagen válida/);
    await rechaza(pngQueMiente(8000, 8000), /demasiado grande|no es una imagen válida/);
  });

  it("un mensaje en español, sin detalles técnicos de la librería", async () => {
    for (const malo of [new TextEncoder().encode("texto"), pngQueMiente(30000, 30000)]) {
      try {
        await procesarImagen(malo);
        assert.fail("debía rechazar");
      } catch (err) {
        assert.ok(err instanceof ImagenInvalida);
        assert.equal(/vips|sharp|libpng|pixel limit|Input/i.test(err.message), false, err.message);
      }
    }
  });
});
