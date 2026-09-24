// Rendimiento (Bloque 20) — la tienda en un CELULAR con red lenta (Chromium real, Playwright).
// Requiere la app compilada contra datos sintéticos (ver README: proxy-supabase.mjs + next start).
//
// Por página: LCP, bytes transferidos, fotos descargadas al abrir (sin hacer scroll) vs fotos en la
// página, y JavaScript descargado. Red "4G lenta" emulada: 1,6 Mbps de bajada, 150 ms de latencia.
//
// Uso: APP=http://127.0.0.1:3100 PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright node scripts/perf/movil.mjs
import { createRequire } from "node:module";

// Playwright puede estar instalado globalmente (no es dependencia del proyecto): se carga por ruta.
const cargar = createRequire(import.meta.url);
const { chromium } = cargar(process.env.PLAYWRIGHT_MODULE || "playwright");

const APP = process.env.APP || "http://127.0.0.1:3100";
const B = `${APP}/catalogo/${process.env.SLUG || "joyeria-sintetica"}`;
const REF = process.env.REF || "dl-000100";
const PAGINAS = [
  ["inicio", B],
  ["todo el catálogo p.1", `${B}?todo=1`],
  ["búsqueda 'aretes dorados'", `${B}?q=aretes%20dorados`],
  ["ficha de producto", `${B}/productos/${REF}`],
];

{
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const filas = [];
  for (const [nombre, url] of PAGINAS) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const recursos = [];
    page.on("requestfinished", async (req) => {
      const sizes = await req.sizes().catch(() => null);
      recursos.push({ url: req.url(), tipo: req.resourceType(), bytes: sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0 });
    });
    await page.addInitScript(() => {
      window.__lcp = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "networkidle", timeout: 180000 });
    const cargada = Date.now() - t0;
    const lcp = await page.evaluate(() => window.__lcp);
    const imgsEnPagina = await page.evaluate(() => document.querySelectorAll("img").length);
    const fotos = recursos.filter((r) => r.tipo === "image" && r.url.includes("/productos/"));
    const js = recursos.filter((r) => r.tipo === "script");
    filas.push({
      pagina: nombre,
      lcp_ms: Math.round(lcp),
      carga_total_ms: cargada,
      kb_total: Math.round(recursos.reduce((a, r) => a + r.bytes, 0) / 1024),
      fotos_descargadas: fotos.length,
      fotos_en_pagina: imgsEnPagina,
      kb_fotos: Math.round(fotos.reduce((a, r) => a + r.bytes, 0) / 1024),
      kb_js: Math.round(js.reduce((a, r) => a + r.bytes, 0) / 1024),
    });
    await context.close();
  }
  await browser.close();
  console.log("| Página (celular, 4G lenta, CPU ×4) | LCP ms | carga total ms | KB total | fotos descargadas / en la página | KB fotos | KB JS |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const f of filas) console.log(`| ${f.pagina} | ${f.lcp_ms} | ${f.carga_total_ms} | ${f.kb_total} | ${f.fotos_descargadas} / ${f.fotos_en_pagina} | ${f.kb_fotos} | ${f.kb_js} |`);
}
