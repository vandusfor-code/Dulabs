/**
 * Salud de la aplicación para el alojamiento (Render, Cloud Run, pings de QStash) y, a pedido, un sondeo HONESTO de Supabase Auth: así nadie ve un inicio de sesión que parece funcionar cuando el servicio
 * de autenticación no responde. Puro: el `fetch`, las variables y el reloj llegan por parámetro (se prueba sin red). NUNCA devuelve URLs, llaves ni el cuerpo de lo que contestó Supabase: solo un estado y un motivo.
 */

export type EstadoAuth = "ok" | "no-disponible" | "lento" | "sin-configurar";
export type MotivoAuth = "dns" | "conexion" | "http-402" | "http-4xx" | "http-5xx" | "tiempo";
export interface SaludAuth {
  estado: EstadoAuth;
  motivo?: MotivoAuth;
}

/** Cuánto se espera a Supabase antes de decir «lento» (sin bloquear: un sondeo lento NO es una caída). */
export const ESPERA_SONDEO_MS = 3_000;
/** Un mismo resultado se reutiliza este tiempo: el sondeo público no puede usarse para golpear a Supabase. */
export const VIGENCIA_SONDEO_MS = 10_000;

function motivoDeError(err: unknown): MotivoAuth {
  const e = err as { name?: string; cause?: { code?: string } } | undefined;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "tiempo";
  const codigo = e?.cause?.code;
  if (codigo === "ENOTFOUND" || codigo === "EAI_AGAIN") return "dns";
  return "conexion";
}

/**
 * Pregunta a `/auth/v1/health` de Supabase con la llave PÚBLICA (anon): 200 = ok; 402 (proyecto restringido), 4xx (el proyecto no existe o la llave no es de él) y 5xx = no disponible; sin respuesta a tiempo =
 * lento (puede estar bien); sin DNS o sin conexión = no disponible. Sin URL o sin llave = sin configurar.
 */
export async function sondearAuth(opciones: { url?: string | null; llave?: string | null; fetchFn?: typeof fetch; esperaMs?: number }): Promise<SaludAuth> {
  const { url, llave } = opciones;
  if (!url || !llave) return { estado: "sin-configurar" };
  const fetchFn = opciones.fetchFn ?? fetch;
  try {
    const res = await fetchFn(`${url.replace(/\/+$/, "")}/auth/v1/health`, {
      headers: { apikey: llave },
      signal: AbortSignal.timeout(opciones.esperaMs ?? ESPERA_SONDEO_MS),
      cache: "no-store",
    });
    await res.arrayBuffer().catch(() => undefined);
    if (res.ok) return { estado: "ok" };
    if (res.status === 402) return { estado: "no-disponible", motivo: "http-402" };
    if (res.status >= 500) return { estado: "no-disponible", motivo: "http-5xx" };
    return { estado: "no-disponible", motivo: "http-4xx" };
  } catch (err) {
    const motivo = motivoDeError(err);
    return motivo === "tiempo" ? { estado: "lento", motivo } : { estado: "no-disponible", motivo };
  }
}

let ultimo: { en: number; valor: SaludAuth } | null = null;

/** Igual que `sondearAuth`, pero reutiliza el último resultado durante `VIGENCIA_SONDEO_MS` (una sola consulta a Supabase cada 10 s por instancia, sin importar cuántos la pidan). */
export async function sondearAuthConCache(opciones: Parameters<typeof sondearAuth>[0], ahora: () => number = Date.now): Promise<SaludAuth> {
  const t = ahora();
  if (ultimo && t - ultimo.en < VIGENCIA_SONDEO_MS) return ultimo.valor;
  const valor = await sondearAuth(opciones);
  ultimo = { en: ahora(), valor };
  return valor;
}

/** Solo para pruebas: olvida el último resultado. */
export function olvidarSondeoParaPruebas(): void {
  ultimo = null;
}
