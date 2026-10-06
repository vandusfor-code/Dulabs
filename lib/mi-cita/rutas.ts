/**
 * AMORE — «MI CITA»: manejadores HTTP (sin Next) de /api/mi-cita/{token}/…. Las rutas de app/api/mi-cita/ son solo la cáscara de estas funciones, para poder
 * probarlas con dependencias falsas sin levantar Next.
 *
 * Todas las respuestas: sin caché, sin referrer y fuera de los buscadores (el token es el secreto, nunca debe quedar en un caché, en un Referer ni en un índice).
 * Un token mal formado se rechaza sin tocar la base; uno inexistente, revocado o vencido responde IGUAL (404, sin pistas).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { esTokenBienFormado, hashDeToken } from "@/lib/mi-cita/enlaces";
import { cancelarMiCita, horariosParaReprogramar, reprogramarMiCita, verMiCita, type DepsMiCita, type ResultadoMiCita } from "@/lib/mi-cita/gestion";

const CABECERAS = {
  "cache-control": "no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
} as const;

const json = (status: number, body: unknown): Response => Response.json(body, { status, headers: CABECERAS });

export interface EntornoMiCita {
  deps: () => DepsMiCita;
  /** Límite de tasa por enlace (Postgres). Mejor esfuerzo: si el limitador no está disponible, la petición sigue. Las pruebas lo omiten. */
  limite?: (supabase: SupabaseClient, token: string) => Promise<Response | null>;
}

/** Entorno de PRODUCCIÓN: dependencias reales y límite de tasa por token. */
export function entornoProduccionMiCita(crear: () => DepsMiCita): EntornoMiCita {
  return {
    deps: crear,
    limite: (supabase, token) => respuestaSiLimiteTasaExcedido(supabase, { recurso: `mi-cita:${hashDeToken(token).slice(0, 16)}`, tenantId: AMORE_TENANT_ID, categoria: "miCita" }),
  };
}

function respuesta<T>(r: ResultadoMiCita<T>): Response {
  if (r.ok) return json(200, { success: true, data: r.data });
  return json(r.status, { success: false, error: r.mensaje, codigo: r.codigo });
}

async function conEntorno(token: unknown, entorno: EntornoMiCita, accion: (deps: DepsMiCita) => Promise<Response>): Promise<Response> {
  if (!esTokenBienFormado(token)) return json(404, { success: false, error: "Este enlace no es válido o ya venció.", codigo: "enlace_invalido" });
  try {
    const deps = entorno.deps();
    const limitada = await entorno.limite?.(deps.supabase, token);
    if (limitada) return limitada;
    return await accion(deps);
  } catch (err) {
    console.error("[mi-cita] error no controlado:", err instanceof Error ? err.message : "error desconocido");
    return json(500, { success: false, error: "Tuvimos un problema procesando tu solicitud. Por favor intenta de nuevo en un momento.", codigo: "error" });
  }
}

export const atenderVerMiCita = (token: unknown, entorno: EntornoMiCita) => conEntorno(token, entorno, async (deps) => respuesta(await verMiCita(deps, token)));

export const atenderCancelarMiCita = (token: unknown, entorno: EntornoMiCita) => conEntorno(token, entorno, async (deps) => respuesta(await cancelarMiCita(deps, token)));

export const atenderHorariosMiCita = (token: unknown, fecha: unknown, entorno: EntornoMiCita) => conEntorno(token, entorno, async (deps) => respuesta(await horariosParaReprogramar(deps, token, fecha)));

export async function atenderReprogramarMiCita(token: unknown, cuerpo: unknown, entorno: EntornoMiCita): Promise<Response> {
  const b = cuerpo && typeof cuerpo === "object" ? (cuerpo as Record<string, unknown>) : {};
  return conEntorno(token, entorno, async (deps) => respuesta(await reprogramarMiCita(deps, token, { fecha: b.fecha, hora: b.hora, idempotenciaDelCliente: b.idempotencyKey })));
}
