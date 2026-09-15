import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

// DuLabs Developer V1 -- Fase 1 (autorizado, sección 2.4 del documento de
// arquitectura / sección 9 y 13 del brief). Contrato de idempotencia real
// para POST /api/v1/messages, respaldado en Postgres (Supabase hoy --
// mismo motor que usaría el Postgres final de Cloud Run, el contrato no
// cambia si se migra la infraestructura de cómputo).
//
// Deliberadamente NO usa "SELECT primero, INSERT si no existe": esa
// secuencia tiene una ventana de carrera real entre el SELECT y el INSERT.
// Usa el UNIQUE(workspace_id, idempotency_key) de la migración como el
// único árbitro real -- se intenta insertar directo, y el resultado del
// INSERT (éxito vs. violación de unicidad) es lo que decide el camino.

export function hashPayload(payload: unknown): string {
  // JSON.stringify de un objeto ya parseado normaliza el orden de claves de
  // forma determinística para el MISMO objeto en JS (V8 preserva el orden
  // de inserción) -- suficiente para este contrato: el payload_hash se
  // calcula siempre del lado del servidor sobre el body ya parseado, nunca
  // sobre el texto crudo del cliente (que sí podría variar en espacios/orden
  // sin cambiar el significado).
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export type ResultadoIdempotencia =
  | { resultado: "nuevo"; jobId: string }
  | { resultado: "duplicado_identico"; jobId: string }
  | { resultado: "conflicto_payload_distinto" };

/**
 * Reclama una Idempotency-Key para un workspace. Si es la primera vez que
 * se ve esa combinación (workspace_id, idempotency_key), la registra y
 * devuelve "nuevo" -- el llamador debe proceder a crear el job real. Si ya
 * existía con el MISMO payload, devuelve "duplicado_identico" con el
 * job_id ya existente (el llamador responde 200 sin volver a encolar). Si
 * ya existía con un payload DISTINTO, devuelve "conflicto_payload_distinto"
 * (el llamador responde 409, nunca procesa el nuevo payload bajo la clave
 * de otro).
 */
export async function reclamarIdempotencia(
  supabase: SupabaseClient,
  params: { workspaceId: string; idempotencyKey: string; payload: unknown }
): Promise<ResultadoIdempotencia> {
  const payloadHash = hashPayload(params.payload);

  const { data: insertado, error: errorInsert } = await supabase
    .from("dulabs_dev_idempotency_keys")
    .insert({ workspace_id: params.workspaceId, idempotency_key: params.idempotencyKey, payload_hash: payloadHash })
    .select("job_id")
    .maybeSingle();

  if (!errorInsert && insertado) {
    return { resultado: "nuevo", jobId: insertado.job_id as string };
  }

  // 23505 = violación de unicidad de Postgres -- exactamente el caso
  // esperado de "ya existe esta clave para este workspace", no un error
  // real. Cualquier otro código sí se relanza: ocultarlo dejaría pasar un
  // fallo real de infraestructura como si fuera una colisión normal.
  if (errorInsert && errorInsert.code !== "23505") {
    throw new Error(`[developer/idempotency] error inesperado reclamando idempotencia: ${errorInsert.message}`);
  }

  const { data: existente, error: errorLectura } = await supabase
    .from("dulabs_dev_idempotency_keys")
    .select("job_id, payload_hash")
    .eq("workspace_id", params.workspaceId)
    .eq("idempotency_key", params.idempotencyKey)
    .single();
  if (errorLectura || !existente) {
    throw new Error(`[developer/idempotency] no se pudo leer la fila existente tras conflicto: ${errorLectura?.message ?? "sin fila"}`);
  }

  if (existente.payload_hash === payloadHash) {
    return { resultado: "duplicado_identico", jobId: existente.job_id as string };
  }
  return { resultado: "conflicto_payload_distinto" };
}
