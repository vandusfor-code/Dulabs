import type { SupabaseClient } from "@supabase/supabase-js";
import type { OnboardingEstado, OnboardingSession } from "@/lib/onboarding-engine";

export interface OnboardingSesionRow {
  id: number;
  id_tenant: string;
  phone_number_id: string;
  telefono_cliente: string;
  plan: string;
  estado: OnboardingEstado;
  business_description: string | null;
  implementation_idea: string | null;
  additional_information: string | null;
  bienvenida_enviada_at: string | null;
}

function filaASesion(fila: OnboardingSesionRow): OnboardingSession {
  return {
    estado: fila.estado,
    customerName: null, // el nombre no se guarda en la sesión, se resuelve aparte (auth.users) al mandar la bienvenida
    plan: fila.plan,
    businessDescription: fila.business_description,
    implementationIdea: fila.implementation_idea,
    additionalInformation: fila.additional_information,
  };
}

// Único punto de inserción -- ver dulabs_crear_onboarding_sesion_idempotente
// en la migración. Devuelve null si el tenant YA tenía sesión (no se creó
// nada, no hay que mandar bienvenida); devuelve la fila si de verdad se creó.
export async function crearOnboardingSesionIdempotente(
  supabase: SupabaseClient,
  params: { idTenant: string; phoneNumberId: string; telefonoCliente: string; plan: string }
): Promise<OnboardingSesionRow | null> {
  const { data, error } = await supabase.rpc("dulabs_crear_onboarding_sesion_idempotente", {
    p_tenant: params.idTenant,
    p_phone_number_id: params.phoneNumberId,
    p_telefono_cliente: params.telefonoCliente,
    p_plan: params.plan,
  });
  if (error) {
    console.error("[onboarding-store] error creando sesión idempotente:", error.message);
    return null;
  }
  const filas = data as OnboardingSesionRow[] | null;
  return filas && filas.length > 0 ? filas[0] : null;
}

export async function obtenerOnboardingSesionActivaPorTelefono(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string
): Promise<OnboardingSesionRow | null> {
  const { data, error } = await supabase
    .from("dulabs_onboarding_sesiones")
    .select("*")
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .maybeSingle();
  if (error) {
    console.error("[onboarding-store] error buscando sesión:", error.message);
    return null;
  }
  return (data as OnboardingSesionRow) ?? null;
}

// Marca que la bienvenida real (con botones) ya se envió -- se llama con el
// PRIMER mensaje que escribe el cliente (el del link wa.me del checkout),
// antes de tratarlo como una respuesta del flujo. Evita mandarla dos veces
// si Meta reintrega el mismo webhook.
export async function marcarBienvenidaEnviada(supabase: SupabaseClient, id: number): Promise<void> {
  const { error } = await supabase
    .from("dulabs_onboarding_sesiones")
    .update({ bienvenida_enviada_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("bienvenida_enviada_at", null);
  if (error) {
    console.error("[onboarding-store] error marcando bienvenida enviada:", error.message);
  }
}

export async function guardarOnboardingSesion(supabase: SupabaseClient, id: number, session: OnboardingSession): Promise<void> {
  const cambios: Record<string, unknown> = {
    estado: session.estado,
    business_description: session.businessDescription,
    implementation_idea: session.implementationIdea,
    additional_information: session.additionalInformation,
    updated_at: new Date().toISOString(),
  };
  if (session.estado === "completado" || session.estado === "soporte_solicitado") {
    cambios.completado_at = new Date().toISOString();
  }
  const { error } = await supabase.from("dulabs_onboarding_sesiones").update(cambios).eq("id", id);
  if (error) {
    console.error("[onboarding-store] error guardando sesión:", error.message);
  }
}

export { filaASesion };
