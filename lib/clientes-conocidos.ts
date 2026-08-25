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
export async function recordarNombreCliente(
  supabase: SupabaseClient,
  params: { idTenant: string; phoneNumberId: string; telefonoCliente: string; nombre: string }
): Promise<void> {
  const nombre = params.nombre.trim();
  if (!nombre) return;
  try {
    await supabase.from("dulabs_clientes_conocidos").upsert(
      {
        id_tenant: params.idTenant,
        phone_number_id: params.phoneNumberId,
        telefono_cliente: params.telefonoCliente,
        nombre,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number_id,telefono_cliente" }
    );
  } catch (err) {
    console.error("[clientes-conocidos] error guardando nombre:", err instanceof Error ? err.message : err);
  }
}
