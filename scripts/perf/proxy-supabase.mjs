// Rendimiento (Bloque 20) — "Supabase" LOCAL para medir la app COMPILADA (`next start`) extremo a
// extremo, sin tocar Supabase: /rest/v1/* va al PostgREST local (sin JWT, como en bench.ts) y
// /storage/v1/object/public/* devuelve una foto WebP sintética (miniatura o principal según el
// nombre; 404 si el nombre contiene "sin-foto"). Cuenta consultas y bytes: GET /__stats (y reinicia).
//
// Uso: PERF_REST=http://127.0.0.1:54440 node scripts/perf/proxy-supabase.mjs   (escucha en :54450)
//      SUPABASE_URL=http://127.0.0.1:54450 SUPABASE_SERVICE_ROLE_KEY=local npx next start -p 3100
import http from "node:http";
import sharp from "sharp";

const REST = process.env.PERF_REST ?? "http://127.0.0.1:54440";
const PORT = Number(process.env.PERF_PROXY_PORT ?? 54450);

// Fotos sintéticas con ruido (no comprimen a casi nada como un color plano): tamaño realista.
async function foto(lado) {
  const raw = Buffer.alloc(lado * lado * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width: lado, height: lado, channels: 3 } }).blur(1.2).webp({ quality: 78 }).toBuffer();
}
const FOTOS = { thumb: await foto(480), main: await foto(1600) };

let stats = { rest: 0, storage: 0, bytes_rest: 0, bytes_storage: 0, rutas: [] };

http
  .createServer(async (req, res) => {
    const url = req.url ?? "/";
    if (url === "/__stats") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(stats));
      stats = { rest: 0, storage: 0, bytes_rest: 0, bytes_storage: 0, rutas: [] };
      return;
    }
    if (url.startsWith("/storage/v1/object/public/")) {
      stats.storage++;
      const nombre = decodeURIComponent(url.split("?")[0].split("/").pop() ?? "");
      if (nombre.includes("sin-foto") || !nombre.endsWith(".webp")) {
        res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not_found"}');
        return;
      }
      const body = nombre.includes("thumb") ? FOTOS.thumb : FOTOS.main;
      stats.bytes_storage += body.length;
      res.writeHead(200, { "content-type": "image/webp", "content-length": String(body.length) }).end(body);
      return;
    }
    if (!url.startsWith("/rest/v1/")) {
      res.writeHead(404).end();
      return;
    }
    stats.rest++;
    stats.rutas.push(`${req.method} ${url.split("?")[0].slice("/rest/v1/".length)}`);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = { ...req.headers };
    for (const h of ["authorization", "apikey", "host", "content-length", "connection"]) delete headers[h];
    try {
      const r = await fetch(REST + url.slice("/rest/v1".length), {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      const buf = Buffer.from(await r.arrayBuffer());
      stats.bytes_rest += buf.length;
      const out = {};
      r.headers.forEach((v, k) => {
        if (!["content-encoding", "transfer-encoding", "content-length", "connection"].includes(k)) out[k] = v;
      });
      res.writeHead(r.status, out).end(buf);
    } catch (e) {
      res.writeHead(502).end(String(e));
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`proxy supabase local en :${PORT} → ${REST}`));
