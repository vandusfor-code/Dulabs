/** Bloque 29 — muestra de la marca con la referencia (sin BD ni red). Uso: npx tsx scripts/catalogo/muestra-marca-referencia.mts <carpeta> */
import sharp from "sharp";
import { toWhatsappJpeg } from "@/lib/catalogo/imagen-whatsapp";
const out = process.argv[2];
// Foto de prueba: fondo claro con una "joya" dorada (círculos), 1600x1600 → 1200.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><defs><radialGradient id="g"><stop offset="0" stop-color="#fff6d8"/><stop offset="1" stop-color="#e9e2d6"/></radialGradient></defs><rect width="1600" height="1600" fill="url(#g)"/><circle cx="800" cy="760" r="330" fill="none" stroke="#c9a227" stroke-width="60"/><circle cx="800" cy="430" r="70" fill="#d8b43c"/></svg>`;
const src = await sharp(Buffer.from(svg)).webp().toBuffer();
const jpg = await toWhatsappJpeg(new Uint8Array(src), { marca: "DL-000123" });
await sharp(jpg).toFile(`${out}/muestra-marca-1200.jpg`);
// Como la ve el cliente tras comprimir WhatsApp (~800 px, calidad baja).
await sharp(jpg).resize(800).jpeg({ quality: 55 }).toFile(`${out}/muestra-marca-whatsapp.jpg`);
const w = await sharp(Buffer.from(svg)).resize(600, 900, { fit: "fill" }).webp().toBuffer();
await sharp(await toWhatsappJpeg(new Uint8Array(w), { marca: "ABCDEF-7894561" })).toFile(`${out}/muestra-marca-vertical.jpg`);
console.log("ok");
