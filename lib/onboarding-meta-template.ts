import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarPlantilla, consultarEstadoPlantilla } from "@/lib/meta-templates";
import { crearOnboardingSesionIdempotente, reclamarEnvioBienvenidaMeta, marcarBienvenidaMetaFallida } from "@/lib/onboarding-store";
import { avisarNuevoClienteDulabs } from "@/lib/onboarding-trigger";
import { DULABS_PHONE_NUMBER_ID } from "@/lib/site-contact";
import { PLANES, type PlanId } from "@/lib/planes";

// F16.2 (Onboarding comercial: pago -> conectar WhatsApp con Meta -> plantilla,
// autorizado) -- se llama SOLO desde app/api/auth/meta-callback/route.ts,
// justo después de que Meta confirma la conexión real del número del
// cliente (WABA + phone_number_id + suscripción al webhook, nunca antes).
// Nunca se llama por un evento del frontend sin verificación real -- ver
// ese archivo para la cadena completa de verificación contra la Graph API.

const NOMBRE_PLANTILLA_BIENVENIDA = "bienvenida_dulabs";
// "Spanish (COL)" tal como la creó el negocio en Meta (ver brief F16.2).
const IDIOMA_PLANTILLA_BIENVENIDA = "es_CO";

// WABA propio de DuLabs (tenant "Dulabs", daf555ef-8a0c...), confirmado
// directo en dulabs_clientes_config antes de hardcodearlo -- mismo criterio
// que lib/site-contact.ts::DULABS_PHONE_NUMBER_ID (ambos son el mismo
// negocio/número: la plantilla la manda DuLabs, no el número nuevo del
// cliente -- el mensaje dice literalmente "te saluda el equipo de DuLabs").
const DULABS_WABA_ID = "1399061204706262";

export type ResultadoBienvenidaMeta =
  | { enviado: true }
  | { enviado: false; motivo: "pago_no_confirmado" | "sin_telefono_contacto" | "ya_procesado" | "plantilla_no_aprobada" | "credenciales_alerta_faltantes" | "error_envio"; detalle?: string };

// Idempotente de verdad (ver lib/onboarding-store.ts::reclamarEnvioBienvenidaMeta
// -- UPDATE...WHERE...IS NULL, no "if (!sent) send()"): si Meta reenvía el
// mismo evento de conexión, o si el callback y un reintento corren en
// paralelo, como mucho UNA llamada gana el reclamo y manda la plantilla.
export async function dispararBienvenidaMetaSiAplica(supabase: SupabaseClient, idTenant: string): Promise<ResultadoBienvenidaMeta> {
  const { data: suscripcion, error: susError } = await supabase
    .from("dulabs_suscripciones")
    .select("estado, plan, telefono_onboarding")
    .eq("id_tenant", idTenant)
    .maybeSingle();
  if (susError || !suscripcion) {
    console.error("[onboarding-meta-template] no se pudo leer la suscripción:", susError?.message);
    return { enviado: false, motivo: "pago_no_confirmado" };
  }

  // Condición #1 del brief: solo dispara si el pago YA está confirmado. Si
  // el cliente conecta Meta antes de que el pago termine de confirmarse
  // (ej. 3DS pendiente), este evento simplemente no hace nada -- cuando el
  // webhook de Wompi confirme el pago más tarde, dispararOnboardingSiAplica
  // crea la sesión, pero la plantilla necesita un segundo disparo real de
  // Meta (reconectar) para mandarse. Documentado como bloqueador conocido,
  // no se intenta adivinar "ya debe estar conectado" desde el lado de pagos.
  if (suscripcion.estado !== "activa") {
    return { enviado: false, motivo: "pago_no_confirmado" };
  }

  const telefono: string | null = suscripcion.telefono_onboarding;
  if (!telefono) {
    console.error(`[onboarding-meta-template] ALERTA: tenant ${idTenant} conectó WhatsApp pero no tiene telefono_onboarding -- no se puede mandar la bienvenida, revisar manualmente.`);
    await avisarNuevoClienteDulabs(
      `⚠️ Tenant ${idTenant} conectó su WhatsApp con Meta pero no tiene un teléfono de contacto guardado -- no se le pudo mandar bienvenida_dulabs. Revisa en el Panel de Operaciones.`
    );
    return { enviado: false, motivo: "sin_telefono_contacto" };
  }

  // Asegura que exista la fila de onboarding (normalmente ya la creó
  // dispararOnboardingSiAplica al confirmarse el pago, que en el nuevo
  // orden pago->Meta siempre corre primero -- esto es solo una red de
  // seguridad para el orden inverso o una fila perdida).
  await crearOnboardingSesionIdempotente(supabase, {
    idTenant,
    phoneNumberId: DULABS_PHONE_NUMBER_ID,
    telefonoCliente: telefono,
    plan: PLANES[suscripcion.plan as PlanId]?.nombre ?? suscripcion.plan,
  });

  const reclamo = await reclamarEnvioBienvenidaMeta(supabase, idTenant);
  if (!reclamo) {
    // 0 filas: o ya se había mandado antes (el caso normal de idempotencia:
    // Meta reenvió el mismo evento), o la sesión sigue sin existir por algún
    // error ya logueado arriba -- en ambos casos no se debe mandar nada.
    return { enviado: false, motivo: "ya_procesado" };
  }

  const tokenAlertas = process.env.ALERTAS_META_TOKEN;
  const phoneNumberIdAlertas = process.env.ALERTAS_PHONE_NUMBER_ID;
  if (!tokenAlertas || !phoneNumberIdAlertas) {
    await marcarBienvenidaMetaFallida(supabase, idTenant, "Faltan ALERTAS_META_TOKEN/ALERTAS_PHONE_NUMBER_ID en el servidor");
    return { enviado: false, motivo: "credenciales_alerta_faltantes" };
  }

  // Sección 14 del brief: NUNCA asumir que la plantilla está aprobada --
  // consultar el estado REAL contra Meta antes de intentar mandarla. Un
  // envío contra una plantilla PENDING/rechazada falla igual en Meta, pero
  // consultarlo primero da un motivo claro y evita gastar el intento en un
  // 400 genérico.
  let estadoPlantilla: string | null = null;
  try {
    estadoPlantilla = await consultarEstadoPlantilla({ wabaId: DULABS_WABA_ID, token: tokenAlertas, nombre: NOMBRE_PLANTILLA_BIENVENIDA });
  } catch (err) {
    console.error("[onboarding-meta-template] error consultando estado de la plantilla:", err instanceof Error ? err.message : err);
  }
  if (estadoPlantilla !== "APPROVED") {
    const detalle = `Plantilla ${NOMBRE_PLANTILLA_BIENVENIDA} en estado "${estadoPlantilla ?? "desconocido"}" (no APPROVED todavía)`;
    await marcarBienvenidaMetaFallida(supabase, idTenant, detalle);
    console.error(`[onboarding-meta-template] BLOQUEADOR EXTERNO: ${detalle} -- tenant ${idTenant} quedó con WhatsApp conectado pero sin bienvenida, no es un bug del código.`);
    return { enviado: false, motivo: "plantilla_no_aprobada", detalle };
  }

  try {
    await enviarPlantilla({
      phoneNumberId: phoneNumberIdAlertas,
      token: tokenAlertas,
      para: telefono,
      nombrePlantilla: NOMBRE_PLANTILLA_BIENVENIDA,
      idioma: IDIOMA_PLANTILLA_BIENVENIDA,
    });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    await marcarBienvenidaMetaFallida(supabase, idTenant, mensaje);
    console.error(`[onboarding-meta-template] falló el envío de bienvenida_dulabs (tenant ${idTenant}):`, mensaje);
    // Sección 19: el fallo debe quedar visible para DuLabs, y el onboarding
    // NO debe volver a CONECTAR_WHATSAPP -- el número sí está conectado,
    // solo falló el mensaje. reclamarEnvioBienvenidaMeta ya no vuelve a
    // reintentar solo (evita spamear reintentos infinitos); el reintento
    // manual queda para /admin (ver sección 19 del brief -- pendiente,
    // documentado como mejora futura en el reporte final).
    await avisarNuevoClienteDulabs(
      `⚠️ Falló el envío de bienvenida_dulabs a un cliente nuevo (tenant ${idTenant}) -- WhatsApp SÍ quedó conectado. Error: ${mensaje}. Revisa en el Panel de Operaciones.`
    );
    return { enviado: false, motivo: "error_envio", detalle: mensaje };
  }

  // Éxito: transición idempotente PENDIENTE -> EN_CONFIGURACION (sección 13
  // del brief). El .eq("estado_implementacion","PENDIENTE") es a propósito:
  // si un operador ya adelantó el estado a mano (ej. EN_PRUEBAS) antes de
  // que este evento llegara, este UPDATE no lo retrocede.
  const ahora = new Date().toISOString();
  await supabase
    .from("dulabs_onboarding_sesiones")
    .update({ estado_implementacion: "EN_CONFIGURACION", implementacion_iniciada_at: ahora, updated_at: ahora })
    .eq("id_tenant", idTenant)
    .eq("estado_implementacion", "PENDIENTE");

  // Sección 24: alerta interna real, con los campos pedidos.
  const { data: authUser } = await supabase.auth.admin.getUserById(idTenant);
  const nombreCliente = (authUser?.user?.user_metadata?.nombre as string | undefined) ?? authUser?.user?.email ?? idTenant;
  const planNombre = PLANES[suscripcion.plan as PlanId]?.nombre ?? suscripcion.plan;
  await avisarNuevoClienteDulabs(
    `✅ Nuevo cliente listo para configuración\nCliente: ${nombreCliente}\nPlan: ${planNombre}\nTeléfono: ${telefono}\nFecha: ${ahora}\nEstado: EN_CONFIGURACION\nSiguiente acción: configurar IA y Flow, luego pasar a pruebas desde /admin.`
  );

  return { enviado: true };
}
