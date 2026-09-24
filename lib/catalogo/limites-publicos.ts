/**
 * LÍMITES DE TASA de los endpoints PÚBLICOS del catálogo (Bloque 18).
 *
 *   POST …/pedido      cada solicitud "ready" queda guardada como pedido del catálogo: sin
 *                      límite, cualquiera podía llenar la tabla de pedidos desde un script.
 *   GET  …/seleccion   resolución del carrito (consulta la BD por referencia).
 *
 * Mismo limitador DISTRIBUIDO del resto del producto (dulabs_rate_limit_incrementar, ventana
 * fija en Postgres; el de proxy.ts es por instancia y no cubre estas rutas). La IP nunca se
 * guarda: la clave lleva un hash corto con sal. Límites:
 *   pedido     20 por IP cada 10 min  +  1.000 por catálogo por hora (inundación distribuida)
 *   seleccion  120 por IP por minuto
 * Si el limitador no responde (sin migración, error), se permite: proteger no debe tumbar ventas.
 */
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { verificarLimiteTasa, type CategoriaLimiteTasa, type ResultadoLimiteTasa } from "@/lib/rate-limit";

export type RecursoPublico = "pedido" | "seleccion";
export type DecisionLimite = { permitido: true } | { permitido: false; reintentarEnSeg: number };
export type LimitadorPublico = (input: { recurso: RecursoPublico; slug: string; request: Request }) => Promise<DecisionLimite>;
type Verificar = (input: { recurso: string; tenantId: string; categoria: CategoriaLimiteTasa }) => Promise<ResultadoLimiteTasa>;

/** IP del cliente según Vercel (x-real-ip; si no, el primer x-forwarded-for). */
export function ipDe(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (real || forwarded || "sin-ip").slice(0, 64);
}

/** Hash corto con sal: identifica la IP en el contador sin guardarla. */
export function refDeIp(ip: string): string {
  return createHash("sha256").update(`dulabs:ip:${ip}`).digest("hex").slice(0, 16);
}

const REGLAS: Record<RecursoPublico, Array<{ recurso: string; categoria: CategoriaLimiteTasa; porIp: boolean }>> = {
  pedido: [
    { recurso: "catalogo-pedido-ip", categoria: "catalogoPedidoIp", porIp: true },
    { recurso: "catalogo-pedido-catalogo", categoria: "catalogoPedidoCatalogo", porIp: false },
  ],
  seleccion: [{ recurso: "catalogo-seleccion-ip", categoria: "catalogoSeleccionIp", porIp: true }],
};

export function crearLimitadorPublico(verificar: Verificar, ahora: () => number = Date.now): LimitadorPublico {
  return async ({ recurso, slug, request }) => {
    const ip = refDeIp(ipDe(request));
    const catalogo = slug.slice(0, 60);
    // En orden: si la IP ya está bloqueada, no cuenta contra el catálogo.
    for (const regla of REGLAS[recurso]) {
      const r = await verificar({ recurso: regla.recurso, tenantId: regla.porIp ? ip : catalogo, categoria: regla.categoria });
      if (!r.permitido) {
        const reintentar = r.reiniciaEn ? Math.ceil((new Date(r.reiniciaEn).getTime() - ahora()) / 1000) : 60;
        return { permitido: false, reintentarEnSeg: Math.min(Math.max(reintentar, 1), 3600) };
      }
    }
    return { permitido: true };
  };
}

/** Producción: el limitador distribuido; cualquier falla del limitador => se permite. */
export const limitadorPublicoReal: LimitadorPublico = async (input) => {
  try {
    return await crearLimitadorPublico((i) => verificarLimiteTasa(supabaseAdmin(), i))(input);
  } catch (error) {
    console.error("[catalogo/limites] limitador no disponible:", error instanceof Error ? error.message : "?");
    return { permitido: true };
  }
};

/** Sin límite (pruebas del flujo; nunca en producción). */
export const sinLimitePublico: LimitadorPublico = async () => ({ permitido: true });
