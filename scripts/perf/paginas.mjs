// Rendimiento (Bloque 20) — la app COMPILADA extremo a extremo (lo que recibe el navegador).
// Requiere proxy-supabase.mjs + `next start` (ver README). Nunca contra Supabase ni producción.
//
// Por URL: estado, tiempo p50/p95, bytes HTML (y gzip), datos de React incrustados, imágenes en el
// HTML (cuántas, cuántas diferidas), consultas a la BD por petición y bytes BD→servidor.
// Después, concurrencia (N clientes a la vez) sobre las páginas más usadas.
//
// Uso: APP=http://127.0.0.1:3100 PROXY=http://127.0.0.1:54450 PERF_REST=http://127.0.0.1:54441 \
//      node scripts/perf/paginas.mjs [--rondas 10] [--json salida.json]
import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const APP = process.env.APP ?? "http://127.0.0.1:3100";
const PROXY = process.env.PROXY ?? "http://127.0.0.1:54450";
const REST = process.env.PERF_REST ?? "http://127.0.0.1:54441";
const arg = (n, d) => (process.argv.indexOf(`--${n}`) > 0 ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const RONDAS = Number(arg("rondas", "10"));
const TENANT = "aaaaaaaa-0000-4000-8000-0000000000a1";
const SLUG = "joyeria-sintetica";

const rest = async (path) => (await fetch(`${REST}/${path}`)).json();
const [pub] = await rest(`dulabs_catalogo_publicacion?id_tenant=eq.${TENANT}&select=token_mayor`);
const refs = (await rest(`dulabs_inventario_productos?id_tenant=eq.${TENANT}&activo=is.true&select=referencia&order=referencia&limit=60`)).map((r) => r.referencia);
const [cat] = await rest(`dulabs_catalogo_categorias?id_tenant=eq.${TENANT}&select=id&limit=1`);
const B = `${APP}/catalogo/${SLUG}`;
const M = `${B}/mayor/${pub.token_mayor}`;

const stats = async () => (await fetch(`${PROXY}/__stats`)).json();
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const r1 = (n) => Math.round(n * 10) / 10;

// URL canónica de una foto (la que publica la tienda, con su `v`): la que el CDN cachea.
const canonica = async (url) => {
  const r = await fetch(url, { redirect: "manual" });
  await r.arrayBuffer();
  return r.status === 307 ? new URL(r.headers.get("location"), APP).href : url;
};

const paginas = [
  ["tienda: inicio", `${B}`],
  ["tienda: todo el catálogo p.1", `${B}?todo=1`],
  ["tienda: todo el catálogo p.100 (profunda)", `${B}?todo=1&pagina=100`],
  ["tienda: categoría", `${B}?categoria=${cat.id}`],
  ["tienda: búsqueda 'aretes dorados'", `${B}?q=aretes%20dorados`],
  ["tienda: búsqueda sin tildes 'corazon'", `${B}?q=corazon`],
  ["tienda: búsqueda referencia exacta", `${B}?q=${refs[7]}`],
  ["tienda: búsqueda sin resultados", `${B}?q=zzqxw`],
  ["tienda: ficha de producto", `${B}/productos/${refs[3]}`],
  ["mayor: todo el catálogo p.1", `${M}?todo=1`],
  ["mayor: ficha", `${M}/productos/${refs[3]}`],
  ["api: selección 10 refs", `${B}/seleccion?${refs.slice(0, 10).map((r) => `ref=${r}`).join("&")}`],
  ["api: selección 60 refs (máx)", `${B}/seleccion?${refs.map((r) => `ref=${r}`).join("&")}`],
  ["foto: miniatura", await canonica(`${B}/productos/${refs[3]}/thumb.webp`)],
  ["foto: principal", await canonica(`${B}/productos/${refs[3]}/main.webp`)],
  ["foto: whatsapp.jpg (conversión)", await canonica(`${B}/productos/${refs[3]}/whatsapp.jpg`)],
  ["foto: referencia inexistente", `${B}/productos/XX-999999/thumb.webp`],
  ["foto: v inventada (redirige, sin Storage)", `${B}/productos/${refs[3]}/whatsapp.jpg?v=inventada`],
];

async function una(url) {
  await stats();
  const t = performance.now();
  const res = await fetch(url, { redirect: "manual" });
  const buf = Buffer.from(await res.arrayBuffer());
  const ms = performance.now() - t;
  const s = await stats();
  return { status: res.status, ms, bytes: buf.length, buf, type: res.headers.get("content-type") ?? "", cache: res.headers.get("cache-control") ?? "", s };
}

const out = [];
for (const [nombre, url] of paginas) {
  await una(url); // calentamiento
  const tiempos = [];
  let last;
  for (let i = 0; i < RONDAS; i++) {
    last = await una(url);
    tiempos.push(last.ms);
  }
  const fila = { pagina: nombre, status: last.status, p50: r1(pct(tiempos, 50)), p95: r1(pct(tiempos, 95)), kb: r1(last.bytes / 1024), consultas: last.s.rest, kb_bd: r1(last.s.bytes_rest / 1024), cache: last.cache };
  if (last.type.includes("text/html")) {
    const html = last.buf.toString("utf8");
    const imgs = html.match(/<img\b[^>]*>/g) ?? [];
    fila.kb_gzip = r1(gzipSync(last.buf).length / 1024);
    fila.imgs = imgs.length;
    fila.imgs_lazy = imgs.filter((i) => /loading="lazy"/.test(i)).length;
    fila.imgs_originales = imgs.filter((i) => /\/main\.|\/[0-9]+\.(webp|jpg|png)/.test(i)).length;
    // Datos de React incrustados en el HTML (lo que hidrata el navegador): cuánto del HTML son datos.
    fila.kb_datos_react = r1((html.match(/self\.__next_f\.push\((.*?)\)<\/script>/gs) ?? []).reduce((a, x) => a + x.length, 0) / 1024);
  }
  out.push(fila);
}

console.log("| Página / endpoint | estado | p50 ms | p95 ms | KB | KB gzip | KB datos React | imgs (diferidas) | consultas BD | KB BD |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const f of out)
  console.log(`| ${f.pagina} | ${f.status} | ${f.p50} | ${f.p95} | ${f.kb} | ${f.kb_gzip ?? ""} | ${f.kb_datos_react ?? ""} | ${f.imgs !== undefined ? `${f.imgs} (${f.imgs_lazy})` : ""} | ${f.consultas} | ${f.kb_bd} |`);

// Concurrencia: N clientes distintos a la vez (sin CDN delante: el peor caso, todo llega al servidor).
const concurrencia = [];
for (const [nombre, url, n] of [
  ["50 clientes: listado", `${B}?todo=1`, 50],
  ["50 clientes: búsquedas distintas", null, 50],
  ["50 clientes: fichas distintas", null, 50],
  ["100 clientes: selección 10 refs", `${B}/seleccion?${refs.slice(0, 10).map((r) => `ref=${r}`).join("&")}`, 100],
]) {
  const palabras = ["anillo", "aretes", "collar dorado", "plata", "luna", "corazon", "perla", "oro rosa", "pulsera", "dije"];
  const urls = Array.from({ length: n }, (_, i) =>
    url ?? (nombre.includes("búsquedas") ? `${B}?q=${encodeURIComponent(palabras[i % palabras.length])}&pagina=${1 + (i % 3)}` : `${B}/productos/${refs[i % refs.length]}`),
  );
  const t = performance.now();
  const res = await Promise.all(urls.map(async (u) => { const s = performance.now(); const r = await fetch(u); await r.arrayBuffer(); return { ok: r.ok, ms: performance.now() - s }; }));
  const total = performance.now() - t;
  const ms = res.map((r) => r.ms);
  concurrencia.push({ escenario: nombre, total_ms: Math.round(total), por_segundo: Math.round((n / total) * 1000), p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), errores: res.filter((r) => !r.ok).length });
}
console.log("\n| Concurrencia | total ms | por segundo | p50 ms | p95 ms | errores |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
for (const c of concurrencia) console.log(`| ${c.escenario} | ${c.total_ms} | ${c.por_segundo} | ${c.p50} | ${c.p95} | ${c.errores} |`);

const json = arg("json", "");
if (json) writeFileSync(json, JSON.stringify({ paginas: out, concurrencia }, null, 2));
