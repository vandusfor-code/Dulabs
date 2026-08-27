import type { SupabaseClient } from "@supabase/supabase-js";
import { crearOnboardingSesionIdempotente } from "@/lib/onboarding-store";
import { textoBienvenida, BOTON_CONFIGURAR, BOTON_SOPORTE } from "@/lib/onboarding-engine";
import { enviarBotonesWhatsApp } from "@/lib/whatsapp-outbound";
import { DULABS_PHONE_NUMBER_ID } from "@/lib/site-contact";
import { PLANES, type PlanId } from "@/lib/planes";
import type { ClienteConfig } from "@/lib/supabase";

// Se llama SOLO después de que el webhook de Wompi confirma un pago real
// (estado "activa") y ya actualizó dulabs_suscripciones -- ver
// app/api/wompi/webhook/route.ts. Idempotente por diseño: la sesión es
// única por tenant (constraint unique en id_tenant, ver la migración), así
// que una renovación mensual del mismo tenant nunca vuelve a mandar la
// bienvenida -- crearOnboardingSesionIdempotente solo devuelve una fila la
// PRIMERA vez.
export async function dispararOnboardingSiAplica(supabase: SupabaseClient, idTenant: string): Promise<void> {
  const { data: suscripcion, error: susError } = await supabase
    .from("dulabs_suscripciones")
    .select("plan, telefono_onboarding")
    .eq("id_tenant", idTenant)
    .single();
  if (susError || !suscripcion) {
    console.error("[onboarding-trigger] no se pudo leer la suscripción:", susError?.message);
    return;
  }

  const planNombre = PLANES[suscripcion.plan as PlanId]?.nombre ?? suscripcion.plan;
  const telefono: string | null = suscripcion.telefono_onboarding;

  if (!telefono) {
    // Caso real esperado: tenants que ya estaban activos ANTES de que este
    // campo existiera. No se inventa ningún número -- se registra para que
    // el equipo lo detecte y complete a mano si hace falta.
    console.error(
      `[onboarding-trigger] ALERTA: pago confirmado para tenant ${idTenant} (plan ${planNombre}) pero sin telefono_onboarding -- no se pudo enviar el onboarding automático, revisar manualmente.`
    );
    return;
  }

  const sesionCreada = await crearOnboardingSesionIdempotente(supabase, {
    idTenant,
    phoneNumberId: DULABS_PHONE_NUMBER_ID,
    telefonoCliente: telefono,
    plan: planNombre,
  });
  if (!sesionCreada) {
    // El tenant ya tenía sesión (compra previa, renovación mensual, o
    // reintento del mismo evento de Wompi) -- no se manda una segunda
    // bienvenida.
    return;
  }

  const { data: authUser } = await supabase.auth.admin.getUserById(idTenant);
  const nombre = (authUser?.user?.user_metadata?.nombre as string | undefined) ?? null;

  const { data: clienteDulabs, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("*")
    .eq("phone_number_id", DULABS_PHONE_NUMBER_ID)
    .single();
  if (clienteError || !clienteDulabs) {
    console.error("[onboarding-trigger] no se encontró la config del número de DuLabs:", clienteError?.message);
    return;
  }

  // Un solo mensaje interactivo real (texto de bienvenida + los 2 botones
  // en el mismo envío) -- así es como WhatsApp entrega botones de verdad,
  // no un mensaje de texto seguido de otro con los botones.
  await enviarBotonesWhatsApp(supabase, clienteDulabs as ClienteConfig, telefono, textoBienvenida(nombre, planNombre), [
    { id: "onboarding_configurar", titulo: BOTON_CONFIGURAR },
    { id: "onboarding_soporte", titulo: BOTON_SOPORTE },
  ]);
}
