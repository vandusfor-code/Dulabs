import type { SupabaseClient } from "@supabase/supabase-js";

// Busca el nombre conocido de esta clienta, si alguna vez lo dio de verdad
// al agendar (no el nombre de perfil de WhatsApp, que no es confiable).
export async function nombreConocido(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string
): Promise<string | null> {
  const { data } = await supabase
    .from("dulabs_clientes_conocidos")
    .select("nombre")
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .maybeSingle();
  return data?.nombre ?? null;
}

// Guarda o actualiza el nombre de esta clienta. Nunca lanza: recordar un
// nombre es un extra de cortesía, no puede tumbar el flujo que lo dispara
// (crear una cita, etc.) si falla.
//
// Fase 3 (sistema de reservas de Daniela) — `correo` es opcional y aditivo
// (ver dulabs_clientes_conocidos.correo, 20260904030000_daniela_reservas_modelo_v1.sql).
// Ningún caller LEGACY lo pasa -- al omitirlo, el upsert ni siquiera incluye
// esa columna en el UPDATE, así que un correo ya guardado antes NUNCA se
// borra por reservar sin él. No es CRM: solo se conserva si el canal que
// crea la reserva de verdad lo tiene (ej. portal, Fase 4).
export async function recordarNombreCliente(
  supabase: SupabaseClient,
  params: { idTenant: string; phoneNumberId: string; telefonoCliente: string; nombre: string; correo?: string | null }
): Promise<void> {
  const nombre = params.nombre.trim();
  if (!nombre) return;
  try {
    const correo = params.correo?.trim();
    await supabase.from("dulabs_clientes_conocidos").upsert(
      {
        id_tenant: params.idTenant,
        phone_number_id: params.phoneNumberId,
        telefono_cliente: params.telefonoCliente,
        nombre,
        ...(correo ? { correo } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number_id,telefono_cliente" }
    );
  } catch (err) {
    console.error("[clientes-conocidos] error guardando nombre:", err instanceof Error ? err.message : err);
  }
}
