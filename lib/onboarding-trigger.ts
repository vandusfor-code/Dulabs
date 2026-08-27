import type { SupabaseClient } from "@supabase/supabase-js";
import { crearOnboardingSesionIdempotente } from "@/lib/onboarding-store";
import { textoBienvenida, BOTON_CONFIGURAR, BOTON_SOPORTE } from "@/lib/onboarding-engine";
import { enviarBotonesWhatsApp } from "@/lib/whatsapp-outbound";
import { DULABS_PHONE_NUMBER_ID } from "@/lib/site-contact";
import { PLANES, type PlanId } from "@/lib/planes";
import type { ClienteConfig } from "@/lib/supabase";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;

// Aviso interno de "nuevo cliente" para operar DuLabs (Fase 15 del Panel de
// Operaciones). Reusa EXACTAMENTE el mismo canal ya configurado para las
// alertas de fallos de IA (ALERTAS_PHONE_NUMBER_ID/ALERTAS_META_TOKEN/
// ALERTAS_DESTINO, ver lib/alertas.ts) -- cero credenciales nuevas. Nunca
// lanza: un aviso que falla no puede tumbar el flujo de onboarding real.
async function avisarNuevoClienteDulabs(texto: string): Promise<void> {
  const phoneNumberId = process.env.ALERTAS_PHONE_NUMBER_ID;
  const token = process.env.ALERTAS_META_TOKEN;
  const destino = process.env.ALERTAS_DESTINO;
  if (!phoneNumberId || !token || !destino) return;
  try {
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: destino, type: "text", text: { body: texto } }),
    });
    if (!res.ok) {
      console.error(`[onboarding-trigger] Meta rechazó el aviso de nuevo cliente (${res.status})`);
    }
  } catch (err) {
    console.error("[onboarding-trigger] error enviando aviso de nuevo cliente:", err instanceof Error ? err.message : err);
  }
}

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
    .select("plan, telefono_onboarding, wompi_customer_email")
    .eq("id_tenant", idTenant)
    .single();
  if (susError || !suscripcion) {
    console.error("[onboarding-trigger] no se pudo leer la suscripción:", susError?.message);
    return;
  }

  const planNombre = PLANES[suscripcion.plan as PlanId]?.nombre ?? suscripcion.plan;
  const telefono: string | null = suscripcion.telefono_onboarding;
  const correo = suscripcion.wompi_customer_email ?? "sin correo";

  if (!telefono) {
    // Caso real esperado: tenants que ya estaban activos ANTES de que este
    // campo existiera. No se inventa ningún número -- se registra para que
    // el equipo lo detecte y complete a mano si hace falta. También queda
    // visible en el Panel de Operaciones ("Necesita tu atención"), pero un
    // aviso directo evita depender de que alguien entre a revisar el panel.
    console.error(
      `[onboarding-trigger] ALERTA: pago confirmado para tenant ${idTenant} (plan ${planNombre}) pero sin telefono_onboarding -- no se pudo enviar el onboarding automático, revisar manualmente.`
    );
    await avisarNuevoClienteDulabs(
      `🎉 Nuevo cliente DuLabs — plan ${planNombre}\n${correo}\n\n⚠️ Sin WhatsApp guardado: no se le pudo mandar el onboarding automático. Revisa en el Panel de Operaciones.`
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

  await avisarNuevoClienteDulabs(`🎉 Nuevo cliente DuLabs — plan ${planNombre}\n${nombre ?? correo}\nYa se le mandó el onboarding automático.`);
}
