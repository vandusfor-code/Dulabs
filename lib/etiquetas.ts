import type { SupabaseClient } from "@supabase/supabase-js";

// FASE F7 (Contacts + Variables + Tags, autorizado) — lógica compartida de
// etiquetas por conversación, reutilizando el modelo real ya existente
// (dulabs_etiquetas / dulabs_conversacion_etiquetas, ver
// 20260718090500_dulabs_etiquetas.sql). NO crea tablas paralelas.
//
// app/api/dashboard/conversaciones/etiquetas/route.ts (panel, ya en
// producción) mantiene su propia verificación de tenant inline -- no se
// modifica ese archivo (fuera de alcance de F7, cero riesgo de romper el
// panel). Este archivo es el punto de entrada NUEVO para el Flow Engine
// (lib/flow/executors/internal-action-executor.ts, caso
// "etiquetar_conversacion") y sigue el mismo criterio de verificación de
// tenant que esa ruta: la etiqueta debe pertenecer al tenant_id del evento.

export type EtiquetaOperationResult =
  | { ok: true; nombre: string }
  | { ok: false; motivo: "tag_not_found" | "operation_failed" };

async function resolverEtiquetaDelTenant(
  supabase: SupabaseClient,
  tenantId: string,
  etiquetaId: number
): Promise<{ id: number; nombre: string } | null> {
  const { data } = await supabase
    .from("dulabs_etiquetas")
    .select("id, nombre")
    .eq("id", etiquetaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as number, nombre: data.nombre as string };
}

// Agrega una etiqueta a una conversación. Dedup: el unique existente
// (phone_number_id, telefono_cliente, etiqueta_id) hace que un 23505 se
// trate como éxito idempotente -- mismo criterio exacto que ya usa
// app/api/dashboard/conversaciones/etiquetas/route.ts.
export async function agregarEtiquetaAConversacion(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    phoneNumberId: string;
    telefonoCliente: string;
    etiquetaId: number;
    asignadoPor?: number;
  }
): Promise<EtiquetaOperationResult> {
  const etiqueta = await resolverEtiquetaDelTenant(supabase, params.tenantId, params.etiquetaId);
  if (!etiqueta) return { ok: false, motivo: "tag_not_found" };

  const { error } = await supabase.from("dulabs_conversacion_etiquetas").insert({
    phone_number_id: params.phoneNumberId,
    telefono_cliente: params.telefonoCliente,
    etiqueta_id: params.etiquetaId,
    ...(params.asignadoPor ? { asignado_por: params.asignadoPor } : {}),
  });
  if (error && error.code !== "23505") {
    return { ok: false, motivo: "operation_failed" };
  }
  return { ok: true, nombre: etiqueta.nombre };
}

// Quita una etiqueta de una conversación. Idempotente: si no estaba
// asignada, el delete no afecta filas y de todos modos se responde ok.
export async function quitarEtiquetaDeConversacion(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    phoneNumberId: string;
    telefonoCliente: string;
    etiquetaId: number;
  }
): Promise<EtiquetaOperationResult> {
  const etiqueta = await resolverEtiquetaDelTenant(supabase, params.tenantId, params.etiquetaId);
  if (!etiqueta) return { ok: false, motivo: "tag_not_found" };

  const { error } = await supabase
    .from("dulabs_conversacion_etiquetas")
    .delete()
    .eq("phone_number_id", params.phoneNumberId)
    .eq("telefono_cliente", params.telefonoCliente)
    .eq("etiqueta_id", params.etiquetaId);
  if (error) return { ok: false, motivo: "operation_failed" };
  return { ok: true, nombre: etiqueta.nombre };
}

// FASE F7 -- nombres de las etiquetas YA asignadas a una conversación (para
// sembrar `tag:<nombre>` en state.variables al iniciar una ejecución, mismo
// patrón que 'hoy'/'baseConocimiento'). phone_number_id ya está anclado a un
// único tenant (verificado aguas arriba por el propio Flow Engine antes de
// llegar acá) -- no hace falta refiltrar por tenant_id en esta lectura,
// mismo criterio que ya usa el panel en la ruta de etiquetas de conversación.
// Nunca lanza: una falla acá degrada a "sin tags" en vez de romper el turno.
export async function listarEtiquetasDeConversacion(
  supabase: SupabaseClient,
  params: { phoneNumberId: string; telefonoCliente: string }
): Promise<string[]> {
  try {
    const { data } = await supabase
      .from("dulabs_conversacion_etiquetas")
      .select("dulabs_etiquetas(nombre)")
      .eq("phone_number_id", params.phoneNumberId)
      .eq("telefono_cliente", params.telefonoCliente);
    if (!data) return [];
    return data
      .map((row) => {
        const rel = (row as { dulabs_etiquetas?: { nombre?: string } | { nombre?: string }[] })
          .dulabs_etiquetas;
        const nombre = Array.isArray(rel) ? rel[0]?.nombre : rel?.nombre;
        return nombre;
      })
      .filter((nombre): nombre is string => typeof nombre === "string");
  } catch (err) {
    console.error(
      "[etiquetas] error listando etiquetas de conversación:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
