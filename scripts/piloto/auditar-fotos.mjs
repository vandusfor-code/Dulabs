// Bloque 24 — auditoría de las fotos que el agente envía por WhatsApp, TAL COMO LAS PIDE META:
// GET público (sin sesión ni cookies, user-agent de Meta) de la URL canónica
//   {base}/catalogo/{slug}/productos/{referencia}/whatsapp.jpg
// Solo lectura: no descarga ni reprocesa nada más, no escribe en ningún lado.
//
// Uso:
//   node scripts/piloto/auditar-fotos.mjs --base https://dulabs.co --slug delacour --refs DL-000001,DL-000002
//   node scripts/piloto/auditar-fotos.mjs --base https://dulabs.co --slug delacour --refs-file refs.txt [--otro-slug otra-tienda]
//
// Por cada referencia comprueba (requisitos de la Cloud API de Meta para imágenes por `link`):
//   - sin `v`: 307 a la URL canónica con `v` (nunca a Storage ni a una URL firmada/temporal);
//   - canónica: 200, Content-Type image/jpeg, <= 5 MB, JPEG real (marcador SOI) de <= 1200 px,
//     cacheable (Cache-Control public), sin cookies ni autenticación;
//   - con `--otro-slug`: la misma referencia bajo OTRO negocio no devuelve esta foto.
// Salida: una línea por referencia y un resumen JSON (ok / problemas con el motivo).
import { argv, exit } from "node:process";
import { readFileSync } from "node:fs";

const arg = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i > 0 ? argv[i + 1] : undefined;
};
const base = (arg("base") ?? "").replace(/\/+$/, "");
const slug = arg("slug");
const otroSlug = arg("otro-slug");
const refs = (arg("refs") ?? (arg("refs-file") ? readFileSync(arg("refs-file"), "utf8") : ""))
  .split(/[\s,]+/)
  .map((r) => r.trim().toUpperCase())
  .filter((r) => /^[A-Z]{1,6}-\d{6,}$/.test(r));
if (!base || !slug || refs.length === 0) {
  console.error("Uso: --base <url> --slug <slug> --refs DL-000001,DL-000002 | --refs-file archivo [--otro-slug <slug>]");
  exit(2);
}
const UA = "facebookexternalua";
const MAX_BYTES = 5 * 1024 * 1024;

/** Dimensiones de un JPEG leyendo sus marcadores (SOF0..SOF15, salvo DHT/JPG/DAC). */
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

async function auditar(ref) {
  const problemas = [];
  const ruta = `/catalogo/${slug}/productos/${ref.toLowerCase()}/whatsapp.jpg`;
  const r0 = await fetch(base + ruta, { redirect: "manual", headers: { "user-agent": UA } });
  if (r0.status === 404) return { ref, ok: false, problemas: ["404: sin foto, producto inactivo o catálogo no publicado"] };
  if (r0.status !== 307) problemas.push(`sin v: esperado 307, fue ${r0.status}`);
  const loc = r0.headers.get("location") ?? "";
  const canonica = new URL(loc, base);
  if (!/\/whatsapp\.jpg\?v=[0-9a-z]+$/i.test(canonica.pathname + canonica.search)) problemas.push(`redirección inesperada: ${canonica.pathname}`);
  if (canonica.origin !== new URL(base).origin || /supabase|storage|token=|sign/i.test(loc)) problemas.push("redirige fuera del catálogo (Storage o URL temporal)");
  const r = await fetch(canonica, { redirect: "manual", headers: { "user-agent": UA } });
  const tipo = r.headers.get("content-type") ?? "";
  const cache = r.headers.get("cache-control") ?? "";
  const buf = Buffer.from(await r.arrayBuffer());
  if (r.status !== 200) problemas.push(`canónica: HTTP ${r.status}`);
  if (tipo !== "image/jpeg") problemas.push(`Content-Type ${tipo || "(vacío)"}`);
  if (buf.length > MAX_BYTES) problemas.push(`pesa ${(buf.length / 1048576).toFixed(1)} MB (> 5 MB)`);
  const dim = jpegSize(buf);
  if (!dim) problemas.push("no es un JPEG válido");
  else if (Math.max(dim.width, dim.height) > 1200 || Math.min(dim.width, dim.height) < 100) problemas.push(`dimensiones ${dim.width}×${dim.height}`);
  if (!/public/.test(cache)) problemas.push(`no cacheable (${cache})`);
  if (r.headers.get("set-cookie")) problemas.push("envía cookies");
  if (otroSlug) {
    const o = await fetch(`${base}/catalogo/${otroSlug}/productos/${ref.toLowerCase()}/whatsapp.jpg${canonica.search}`, { redirect: "manual", headers: { "user-agent": UA } });
    if (o.status === 200) {
      const ob = Buffer.from(await o.arrayBuffer());
      if (ob.equals(buf)) problemas.push(`la misma foto responde bajo el negocio ${otroSlug}`);
    }
  }
  return { ref, ok: problemas.length === 0, bytes: buf.length, ...(dim ?? {}), cache, problemas };
}

const resultados = [];
for (const ref of refs) {
  try {
    const r = await auditar(ref);
    resultados.push(r);
    console.log(`${r.ok ? "OK " : "XX "} ${ref}${r.width ? ` ${r.width}×${r.height} ${Math.round(r.bytes / 1024)} KB` : ""}${r.problemas.length ? " — " + r.problemas.join("; ") : ""}`);
  } catch (err) {
    resultados.push({ ref, ok: false, problemas: [`error de red: ${err instanceof Error ? err.message : err}`] });
    console.log(`XX  ${ref} — error de red`);
  }
}
const malas = resultados.filter((r) => !r.ok);
console.log(JSON.stringify({ revisadas: resultados.length, ok: resultados.length - malas.length, con_problemas: malas.map((r) => ({ ref: r.ref, motivos: r.problemas })) }, null, 2));
exit(malas.length > 0 ? 1 : 0);
