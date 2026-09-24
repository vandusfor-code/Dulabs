/**
 * LÍMITE DE TASA de las PÁGINAS públicas del catálogo (Bloque 21): /catalogo/{slug}/… (tienda
 * detal y mayorista: inicio, listado, categorías, búsqueda, paginación, fichas). Lo aplica
 * proxy.ts ANTES de renderizar; el carrito (…/seleccion) y el pedido (…/pedido) ya tienen el suyo
 * (limites-publicos.ts) y las fotos van por el CDN con URL canónica (foto-http.ts).
 *
 * Diseño:
 * - DISTRIBUIDO: el mismo contador en Postgres del resto del producto
 *   (dulabs_rate_limit_incrementar, ventana fija, se limpia solo). Vale para todas las instancias.
 * - Por CLIENTE (hash con sal de la IP normalizada: IPv6 por su /64), nunca por URL: cambiar
 *   ?q=, ?pagina=, ?categoria=, mayúsculas o el orden de los parámetros no abre un contador nuevo.
 * - Dos clases de petición:
 *     página    600/min por cliente. Una persona navegando (con las precargas del router) queda
 *               muy por debajo; un script recorriendo el catálogo a más de 10 páginas/s no.
 *     búsqueda  cuenta como página Y como búsqueda: 120/min por cliente (la consulta cuesta más
 *               que una página) y 3.000/min por catálogo (inundación desde muchas IPs). Al superar
 *               el tope del CATÁLOGO solo se frenan las BÚSQUEDAS: la tienda sigue navegable para
 *               todos. Un cliente frenado por páginas tampoco puede seguir buscando.
 * - Escudo local por instancia: un cliente ya bloqueado recibe 429 sin volver a consultar la BD
 *   hasta que abra su ventana (durante un ataque, el limitador no se convierte en la carga).
 * - Si el limitador no responde a tiempo o falla: se PERMITE (proteger no debe tumbar ventas).
 */
import { supabaseAdmin } from "@/lib/supabase";
import { verificarLimiteTasa, LIMITES_TASA, type CategoriaLimiteTasa, type ResultadoLimiteTasa } from "@/lib/rate-limit";
import { ipDe, refDeIp } from "@/lib/catalogo/limites-publicos";

export type ClasePagina = "pagina" | "busqueda";
export type Verificar = (input: { recurso: string; tenantId: string; categoria: CategoriaLimiteTasa }) => Promise<ResultadoLimiteTasa>;
export type DecisionPagina = { permitido: true } | { permitido: false; reintentarEnSeg: number; motivo: "cliente" | "catalogo" };

const ARCHIVO = /\.(webp|jpe?g|png|gif|avif|ico|svg|txt|xml|json)$/i;
/** Endpoints con límite propio (limites-publicos.ts): no se cuentan dos veces. */
const CON_LIMITE_PROPIO = new Set(["seleccion", "pedido"]);

/**
 * Qué se limita de una URL del catálogo. null = no pasa por este límite (fotos y archivos, que
 * van por el CDN; carrito y pedido, que tienen el suyo).
 */
export function clasificarPagina(url: URL): { slug: string; clase: ClasePagina } | null {
  const partes = url.pathname.split("/").filter(Boolean);
  if (partes[0] !== "catalogo" || !partes[1]) return null;
  const ultimo = partes[partes.length - 1];
  if (ARCHIVO.test(ultimo) || CON_LIMITE_PROPIO.has(ultimo)) return null;
  const q = url.searchParams.getAll("q").some((v) => v.trim() !== "");
  return { slug: partes[1].toLowerCase().slice(0, 60), clase: q ? "busqueda" : "pagina" };
}

const REGLAS: Record<ClasePagina, Array<{ recurso: string; categoria: CategoriaLimiteTasa; porCliente: boolean }>> = {
  pagina: [{ recurso: "catalogo-pagina-ip", categoria: "catalogoPaginaIp", porCliente: true }],
  busqueda: [
    { recurso: "catalogo-pagina-ip", categoria: "catalogoPaginaIp", porCliente: true },
    { recurso: "catalogo-busqueda-ip", categoria: "catalogoBusquedaIp", porCliente: true },
    { recurso: "catalogo-busqueda-catalogo", categoria: "catalogoBusquedaCatalogo", porCliente: false },
  ],
};

export interface LimitadorPaginasDeps {
  verificar: Verificar;
  ahora?: () => number;
  /** Tope de espera del limitador; si se pasa, se permite. */
  timeoutMs?: number;
  /** Máximo de clientes recordados en el escudo local de la instancia. */
  maxBloqueados?: number;
}

export function crearLimitadorPaginas({ verificar, ahora = Date.now, timeoutMs = 400, maxBloqueados = 5000 }: LimitadorPaginasDeps) {
  // clave del contador -> hasta cuándo está bloqueada (ms). Solo bloqueos: nunca crece con el tráfico normal.
  const bloqueados = new Map<string, number>();

  function recordar(clave: string, hasta: number) {
    if (bloqueados.size >= maxBloqueados) {
      const t = ahora();
      for (const [k, v] of bloqueados) if (v <= t) bloqueados.delete(k);
      if (bloqueados.size >= maxBloqueados) bloqueados.delete(bloqueados.keys().next().value!);
    }
    bloqueados.set(clave, hasta);
  }

  async function conTope<T>(p: Promise<T>): Promise<T | "timeout"> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tope = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    try {
      return await Promise.race([p, tope]);
    } finally {
      clearTimeout(timer);
    }
  }

  return async function decidir(request: Request): Promise<DecisionPagina | null> {
    const pagina = clasificarPagina(new URL(request.url));
    if (!pagina) return null;
    const cliente = refDeIp(ipDe(request));
    const reglas = REGLAS[pagina.clase].map((regla) => ({
      ...regla,
      clave: `${regla.recurso}:${regla.porCliente ? cliente : pagina.slug}`,
      motivo: (regla.porCliente ? "cliente" : "catalogo") as "cliente" | "catalogo",
    }));
    const t = ahora();
    // Escudo local primero: un bloqueo conocido responde sin consultar la BD.
    for (const regla of reglas) {
      const hasta = bloqueados.get(regla.clave);
      if (hasta !== undefined && hasta > t) return { permitido: false, reintentarEnSeg: Math.max(1, Math.ceil((hasta - t) / 1000)), motivo: regla.motivo };
    }
    // Los contadores de la petición se consultan EN PARALELO (la latencia es la de uno solo).
    let resultados: Array<ResultadoLimiteTasa | "timeout">;
    try {
      resultados = await Promise.all(reglas.map((regla) => conTope(verificar({ recurso: regla.recurso, tenantId: regla.porCliente ? cliente : pagina.slug, categoria: regla.categoria }))));
    } catch {
      return { permitido: true };
    }
    // En orden de prioridad: primero lo que frena al CLIENTE, después el tope del catálogo.
    for (const [i, r] of resultados.entries()) {
      if (r === "timeout" || r.permitido) continue;
      const regla = reglas[i];
      const ventanaMs = LIMITES_TASA[regla.categoria].ventanaSeg * 1000;
      const fin = r.reiniciaEn ? new Date(r.reiniciaEn).getTime() : t + ventanaMs;
      const finSeguro = Math.min(Math.max(fin, t + 1000), t + ventanaMs);
      recordar(regla.clave, finSeguro);
      return { permitido: false, reintentarEnSeg: Math.ceil((finSeguro - t) / 1000), motivo: regla.motivo };
    }
    return { permitido: true };
  };
}

/** Respuesta 429 de la tienda: página liviana en español, nunca cacheada, sin datos internos. */
export function respuesta429(decision: Extract<DecisionPagina, { permitido: false }>): Response {
  const texto =
    decision.motivo === "catalogo"
      ? "La búsqueda está muy solicitada en este momento. Puedes seguir navegando el catálogo e intentar buscar de nuevo en unos segundos."
      : "Estás navegando más rápido de lo normal. Espera unos segundos y vuelve a intentarlo.";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Un momento</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#2b2420;background:#f7f3ee"><h1 style="font-size:1.4rem;font-weight:600">Un momento, por favor</h1><p style="line-height:1.5">${texto}</p></body></html>`;
  return new Response(html, {
    status: 429,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(decision.reintentarEnSeg),
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

let limitadorReal: ReturnType<typeof crearLimitadorPaginas> | null = null;

/** Producción (proxy.ts): contador distribuido; cualquier falla del limitador => se permite. */
export async function limitarPaginaCatalogo(request: Request): Promise<Response | null> {
  try {
    limitadorReal ??= crearLimitadorPaginas({ verificar: (i) => verificarLimiteTasa(supabaseAdmin(), i) });
    const decision = await limitadorReal(request);
    return decision && !decision.permitido ? respuesta429(decision) : null;
  } catch (error) {
    console.error("[catalogo/limite-paginas] limitador no disponible:", error instanceof Error ? error.message : "?");
    return null;
  }
}
