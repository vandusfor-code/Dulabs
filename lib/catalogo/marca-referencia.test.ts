/**
 * Bloque 29 — marca con la referencia en las fotos: trazos vectoriales (sin fuentes del servidor),
 * esquina inferior derecha, tamaño proporcional, y la conversión real a JPEG la estampa.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { svgMarcaReferencia, textoDeMarca } from "@/lib/catalogo/marca-referencia";
import { toWhatsappJpeg } from "@/lib/catalogo/imagen-whatsapp";

async function fotoLisa(w: number, h: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: "#f0e6d2" } }).webp().toBuffer());
}

/** Luminancia media de un recorte (0 = negro, 255 = blanco). */
async function luz(jpeg: Buffer, left: number, top: number, width: number, height: number): Promise<number> {
  const { data } = await sharp(jpeg).extract({ left, top, width, height }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return data.reduce((a, b) => a + b, 0) / data.length;
}

describe("B29 · marca con la referencia", () => {
  it("solo trazos (path), nunca <text>: no depende de fuentes; todas las letras y dígitos de una referencia tienen glifo", () => {
    const svg = svgMarcaReferencia(1200, 1200, "DL-000123")!;
    assert.ok(svg.includes("<path"));
    assert.ok(!svg.includes("<text"));
    assert.equal(textoDeMarca("abcdefghijklmnopqrstuvwxyz-0123456789"), "ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789".slice(0, 24));
    assert.equal(textoDeMarca("DL-000123<script>"), "DL-000123SCRIPT", "nada fuera de A-Z, 0-9 y guion llega al SVG");
  });

  it("foto muy pequeña o referencia vacía: sin marca (nunca se deforma la foto)", () => {
    assert.equal(svgMarcaReferencia(40, 40, "DL-000123"), null);
    assert.equal(svgMarcaReferencia(1200, 1200, "¿?"), null);
  });

  it("la conversión real a JPEG la estampa en la esquina inferior derecha y deja el resto intacto", async () => {
    const src = await fotoLisa(1600, 1600);
    const sin = await toWhatsappJpeg(src);
    const con = await toWhatsappJpeg(src, { marca: "DL-000123" });
    const meta = await sharp(con).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.width, 1200);
    // Esquina inferior derecha: la etiqueta oscura baja la luz; la esquina superior izquierda no cambia.
    assert.ok((await luz(con, 1000, 1110, 150, 40)) < (await luz(sin, 1000, 1110, 150, 40)) - 30);
    assert.ok(Math.abs((await luz(con, 0, 0, 200, 200)) - (await luz(sin, 0, 0, 200, 200))) < 2);
  });
});
