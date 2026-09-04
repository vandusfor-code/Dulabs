import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

/**
 * Fase 4 (sistema de reservas de Daniela) — idempotencia REAL para
 * operaciones de escritura expuestas públicamente (hoy: reservarCitaPorServicio
 * desde el portal). No es específica del portal -- cualquier consumidor
 * futuro (WhatsApp nuevo, panel) puede reutilizarla igual.
 *
 * Patrón "claim + fill" sobre dulabs_idempotencia_reservas (Fase 4,
 * 20260904050000_daniela_reserva_idempotencia.sql), mismo criterio que
 * dulabs_flow_events: la garantía de "solo una vez" la da la PK compuesta de
 * Postgres (id_tenant, idempotency_key), nunca un lock de aplicación ni un
 * sleep/retry artificial.
 */

export type ResultadoIdempotente<T> =
  | { estado: "ejecutado"; resultado: T }
  | { estado: "repetido"; resultado: T }
  | { estado: "en_progreso" }
  | { estado: "conflicto" };

/** Hash estable de los parámetros de negocio -- nunca se guarda el dato crudo del cliente en texto plano en esta tabla de control. */
export function huellaSolicitud(partes: (string | number | null | undefined)[]): string {
  const canonica = partes.map((p) => (p === null || p === undefined ? "" : String(p))).join("|");
  return createHash("sha256").update(canonica).digest("hex");
}

/**
 * Ejecuta `operacion` una única vez por (idTenant, idempotencyKey):
 * - Primera vez: hace el "claim" (INSERT), corre `operacion`, guarda el
 *   resultado en la misma fila, y lo devuelve (`estado: "ejecutado"`).
 * - Reintento con la MISMA huella: devuelve el resultado YA guardado, sin
 *   volver a ejecutar `operacion` (`estado: "repetido"`) -- una cita nunca
 *   se duplica por un doble clic o un retry de red.
 * - Reintento mientras la primera solicitud SIGUE en vuelo (resultado_json
 *   todavía null): `estado: "en_progreso"` -- el caller decide qué decirle
 *   al usuario, nunca se inventa un resultado ni se espera con un sleep.
 * - Misma clave con una huella DISTINTA (parámetros distintos): `estado:
 *   "conflicto"` -- se rechaza, nunca se reutiliza el resultado de otra
 *   solicitud.
 */
export async function ejecutarConIdempotencia<T>(
  supabase: SupabaseClient,
  params: { idTenant: string; idempotencyKey: string; huella: string; operacion: () => Promise<T> }
): Promise<ResultadoIdempotente<T>> {
  const { error: claimError } = await supabase
    .from("dulabs_idempotencia_reservas")
    .insert({ id_tenant: params.idTenant, idempotency_key: params.idempotencyKey, request_hash: params.huella })
    .select("id_tenant")
    .maybeSingle();

  if (claimError) {
    // 23505 = ya existe una fila con esta (id_tenant, idempotency_key) --
    // exactamente la carrera/reintento que esta función existe para manejar.
    if (claimError.code !== "23505") throw claimError;

    const { data: existente } = await supabase
      .from("dulabs_idempotencia_reservas")
      .select("request_hash, resultado_json")
      .eq("id_tenant", params.idTenant)
      .eq("idempotency_key", params.idempotencyKey)
      .maybeSingle();

    if (!existente || existente.request_hash !== params.huella) {
      return { estado: "conflicto" };
    }
    if (existente.resultado_json === null) {
      return { estado: "en_progreso" };
    }
    return { estado: "repetido", resultado: existente.resultado_json as T };
  }

  // Ganamos el claim -- somos la única ejecución real de `operacion` para
  // esta clave. Cualquier error de `operacion` se guarda también (como
  // resultado, no como excepción sin resolver) para que un retry posterior
  // reciba el MISMO error en vez de reintentar ciegamente contra Postgres.
  let resultado: T;
  try {
    resultado = await params.operacion();
  } catch (err) {
    await supabase
      .from("dulabs_idempotencia_reservas")
      .delete()
      .eq("id_tenant", params.idTenant)
      .eq("idempotency_key", params.idempotencyKey);
    throw err;
  }

  await supabase
    .from("dulabs_idempotencia_reservas")
    .update({ resultado_json: resultado as object, updated_at: new Date().toISOString() })
    .eq("id_tenant", params.idTenant)
    .eq("idempotency_key", params.idempotencyKey);

  return { estado: "ejecutado", resultado };
}
