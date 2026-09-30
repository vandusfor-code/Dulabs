/**
 * Validación del token de sesión con memoria corta (rendimiento del panel).
 *
 * Cada llamada del panel valida el token contra Supabase Auth (una ida y vuelta de red). Aquí se
 * recuerda el resultado POSITIVO hasta 60 s (nunca más allá de la expiración del propio token) en la
 * instancia del servidor, para que las llamadas seguidas de la misma persona no repitan esa ida y
 * vuelta. Lo que NO se recuerda: tokens inválidos (siempre se vuelven a consultar), ni el rol / estado
 * del miembro del equipo (eso se sigue leyendo en cada llamada: una suspensión aplica de inmediato).
 * La llave es el SHA-256 del token (el token nunca se guarda) y la memoria es por cliente de Supabase.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const SESION_TTL_MS = 60_000;
const MAX_ENTRADAS = 1000;

type Usuario = { id: string; email: string | null };
const memorias = new WeakMap<SupabaseClient, Map<string, { usuario: Usuario; vence: number }>>();

/** Expiración del JWT (ms) si se puede leer; null si no. Solo acota la memoria: la validez la decide Supabase. */
function expiraJwt(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Usuario del token (id y correo) o null si el token no es válido. */
export async function usuarioDeToken(supabase: SupabaseClient, token: string, ahora: () => number = Date.now): Promise<Usuario | null> {
  let memoria = memorias.get(supabase);
  if (!memoria) {
    memoria = new Map();
    memorias.set(supabase, memoria);
  }
  const llave = createHash("sha256").update(token).digest("hex");
  const t = ahora();
  const guardado = memoria.get(llave);
  if (guardado && guardado.vence > t) return guardado.usuario;
  if (guardado) memoria.delete(llave);

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const usuario: Usuario = { id: data.user.id, email: data.user.email ?? null };
  const exp = expiraJwt(token);
  const vence = Math.min(t + SESION_TTL_MS, exp ?? Number.POSITIVE_INFINITY);
  if (vence > t) {
    if (memoria.size >= MAX_ENTRADAS) memoria.delete(memoria.keys().next().value as string);
    memoria.set(llave, { usuario, vence });
  }
  return usuario;
}
