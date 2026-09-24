import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fase 9 (Human Inbox, autorizado) — estado (open/pending/closed) y marca de
 * lectura de una conversación derivada (phone_number_id, telefono_cliente).
 * Ver supabase/migrations/20260929000000_dulabs_conversacion_estado.sql --
 * NO aplicada todavía desde esta sesión (mismo bloqueo documentado en Fase
 * 8.5: sin acceso a DDL de Supabase). Toda función de este archivo tolera
 * la tabla inexistente (Postgres 42P01, undefined_table) y cae al default
 * seguro (estado 'open', sin leer) en vez de romper el Inbox ya
 * desplegado -- se autoactiva solo, sin otro deploy, en cuanto se aplique
 * la migración.
 */

export type EstadoConversacion = "open" | "pending" | "closed";

const CODIGO_TABLA_INEXISTENTE = "42P01";

function esTablaEstadoInexistente(error: { code?: string } | null): boolean {
  return error?.code === CODIGO_TABLA_INEXISTENTE;
}

export interface FilaEstadoConversacion {
  phone_number_id: string;
  telefono_cliente: string;
  estado: EstadoConversacion;
  cerrado_en: string | null;
  leido_hasta: string;
}

/**
 * Lee el estado/lectura de TODAS las conversaciones de los phone_number_id
 * dados en una sola consulta (evita N+1 -- ver app/api/dashboard/conversaciones/route.ts,
 * que ya resuelve pausas/asignaciones/etiquetas con el mismo patrón de un
 * solo `.in()`). Sin tabla o sin fila para una conversación -> esa
 * conversación no aparece en el mapa devuelto; el caller debe tratar la
 * ausencia como el default (open, leido_hasta = época 0).
 */
export async function leerEstadosConversacion(
  supabase: SupabaseClient,
  phoneNumberIds: string[],
): Promise<Map<string, FilaEstadoConversacion>> {
  if (phoneNumberIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("dulabs_conversacion_estado")
    .select("phone_number_id, telefono_cliente, estado, cerrado_en, leido_hasta")
    .in("phone_number_id", phoneNumberIds);
  if (error) {
    if (!esTablaEstadoInexistente(error)) {
      console.error("[conversacion-estado] error leyendo estados:", error.message);
    }
    return new Map();
  }
  return new Map((data as FilaEstadoConversacion[]).map((f) => [`${f.phone_number_id}:${f.telefono_cliente}`, f]));
}

export type ResultadoEscrituraEstado = { ok: true } | { ok: false; motivo: "migracion_pendiente" | "error_db"; mensaje?: string };

/** Cambia el estado explícito (open/pending/closed) de una conversación. */
export async function actualizarEstadoConversacion(
  supabase: SupabaseClient,
  params: { phoneNumberId: string; telefonoCliente: string; estado: EstadoConversacion },
): Promise<ResultadoEscrituraEstado> {
  const { error } = await supabase.from("dulabs_conversacion_estado").upsert(
    {
      phone_number_id: params.phoneNumberId,
      telefono_cliente: params.telefonoCliente,
      estado: params.estado,
      cerrado_en: params.estado === "closed" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "phone_number_id,telefono_cliente" },
  );
  if (error) {
    if (esTablaEstadoInexistente(error)) return { ok: false, motivo: "migracion_pendiente" };
    return { ok: false, motivo: "error_db", mensaje: error.message };
  }
  return { ok: true };
}

/** Marca la conversación como leída HASTA ahora (unread vuelve a 0 hasta el próximo mensaje entrante). */
export async function marcarConversacionLeida(
  supabase: SupabaseClient,
  params: { phoneNumberId: string; telefonoCliente: string },
): Promise<ResultadoEscrituraEstado> {
  const ahora = new Date().toISOString();
  // Upsert preservando `estado` si ya existía una fila -- por eso primero
  // intenta un UPDATE puntual y solo si no tocó ninguna fila hace el INSERT
  // con el default 'open' (evita pisar un estado 'closed'/'pending' ya
  // guardado con un upsert ciego que no lo incluyera).
  const { data: actualizada, error: errorUpdate } = await supabase
    .from("dulabs_conversacion_estado")
    .update({ leido_hasta: ahora, updated_at: ahora })
    .eq("phone_number_id", params.phoneNumberId)
    .eq("telefono_cliente", params.telefonoCliente)
    .select("id")
    .maybeSingle();
  if (errorUpdate) {
    if (esTablaEstadoInexistente(errorUpdate)) return { ok: false, motivo: "migracion_pendiente" };
    return { ok: false, motivo: "error_db", mensaje: errorUpdate.message };
  }
  if (actualizada) return { ok: true };

  const { error: errorInsert } = await supabase.from("dulabs_conversacion_estado").insert({
    phone_number_id: params.phoneNumberId,
    telefono_cliente: params.telefonoCliente,
    leido_hasta: ahora,
  });
  if (errorInsert) {
    // 23505 = ya la creó otra petición concurrente -- inofensivo, el UPDATE de arriba ya cumplió su función para esa fila.
    if (errorInsert.code === "23505") return { ok: true };
    if (esTablaEstadoInexistente(errorInsert)) return { ok: false, motivo: "migracion_pendiente" };
    return { ok: false, motivo: "error_db", mensaje: errorInsert.message };
  }
  return { ok: true };
}

/**
 * Estado EFECTIVO para mostrar en el Inbox: una conversación 'closed' vuelve
 * a verse 'open' si llegó un mensaje entrante DESPUÉS de cerrarla -- sin
 * necesitar que el webhook escriba nada (cero riesgo para el pipeline de
 * mensajería real), calculado acá con lo que la API ya tiene en memoria.
 */
export function estadoEfectivo(fila: FilaEstadoConversacion | undefined, ultimaFechaEntrante: string | null): EstadoConversacion {
  if (!fila) return "open";
  if (fila.estado === "closed" && fila.cerrado_en && ultimaFechaEntrante && ultimaFechaEntrante > fila.cerrado_en) {
    return "open";
  }
  return fila.estado;
}

/**
 * Bloque 17 — al TOMAR una conversación pendiente, pasa a "open" (la atiende una persona).
 * Condicional en la BD (solo si sigue en 'pending'): no pisa un cierre ni un cambio que otra
 * asesora hizo al mismo tiempo. Sin la tabla de estado: no hace nada.
 */
export async function marcarAbiertaSiPendiente(supabase: SupabaseClient, phoneNumberId: string, telefonoCliente: string): Promise<void> {
  const { error } = await supabase
    .from("dulabs_conversacion_estado")
    .update({ estado: "open", cerrado_en: null, updated_at: new Date().toISOString() })
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .eq("estado", "pending");
  if (error && !esTablaEstadoInexistente(error)) console.error("[conversacion-estado] error marcando abierta:", error.code ?? "");
}
