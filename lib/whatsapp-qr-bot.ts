import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteConfig } from "@/lib/supabase";
import {
  atenderMensajeConFlow,
  cerrarEjecucionRotaParaReintento,
  decidirFallbackDesdeResultado,
} from "@/lib/flow-runtime-bridge";
import type { SendMessageDeps } from "@/lib/flow/executors/send-message-executor";
import { enviarMensajeWhatsApp } from "@/lib/whatsapp-worker-client";

// Hallazgo real (autorizado, incidente 573203803682) -- atenderMensajeConFlow
// puede terminar sin mandar ningún mensaje real (ej. ai-conversar-catalogo
// rechazado por claim-security, o un empty_output residual): antes, esta
// función devolvía {ok:true} SOLO porque no se lanzó ninguna excepción, sin
// mirar si de verdad se envió algo -- la clienta se quedaba sin respuesta y
// nadie se enteraba. Se reutiliza EXACTAMENTE la misma decisión que ya usa
// el fallback Flow->LEGACY de Cloud API (decidirFallbackDesdeResultado,
// lib/flow-runtime-bridge.ts) para detectar "no se envió nada" -- pero como
// WhatsApp-QR no tiene ningún LEGACY al que caer, en vez de ceder el turno
// se cierra la ejecución rota (cerrarEjecucionRotaParaReintento, mismo
// mecanismo real que ya usa ese fallback) y se reintenta un número acotado
// de veces con el MISMO texto/wamid -- getActiveExecution ya no ve la
// ejecución cerrada, así que el reintento arranca un "start" limpio, y
// insertEventIdempotent está indexado por flowExecutionId (no solo eventId),
// así que reusar el mismo wamid contra la ejecución NUEVA nunca se lee como
// evento duplicado.
const MAX_INTENTOS = 2;

/**
 * Bot real para WhatsApp-QR (autorizado) — conecta un flow YA PUBLICADO
 * (dulabs_flows) al canal de WhatsApp-QR/Baileys (worker/), reutilizando
 * EXACTAMENTE el mismo núcleo del Flow Engine que ya usan los tenants de
 * Cloud API (atenderMensajeConFlow, lib/flow-runtime-bridge.ts) -- nunca un
 * segundo motor de conversación.
 *
 * Se llama deliberadamente atenderMensajeConFlow (el núcleo LIMPIO, sin
 * I/O adicional) y NO atenderMensajeConFlowConFallback: ese wrapper trae
 * "hatches" de negocio hardcodeados de OTROS tenants (pestañas/Daniela,
 * inicio-ads/Solo Talento, ver lib/flow-pestanas-hatch.ts y
 * lib/flow-solotalento-inicio-hatch.ts) que solo hacen match de TEXTO, sin
 * ningún filtro por tenant -- usarlo acá podría, por ejemplo, redirigir a
 * una clienta de AMORE que pregunta por "pestañas" (un servicio real de
 * AMORE) hacia el flujo de transferencia de Daniela. atenderMensajeConFlow
 * no tiene ninguno de esos hatches.
 *
 * `dulabs_clientes_config` (la tabla que normalmente representa "un número
 * de Cloud API") NUNCA se toca acá: WhatsApp-QR no tiene phone_number_id de
 * Meta, así que se arma un ClienteConfig sintético, SOLO EN MEMORIA (nunca
 * insertado ni leído de esa tabla), con lo mínimo que
 * atenderMensajeConFlow/resolverConfigAgente realmente leen. El envío real
 * se redirige del todo con sendMessageDepsOverride hacia
 * enviarMensajeWhatsApp (el mismo cliente que ya usa Chats para mandar
 * texto por Baileys), nunca hacia la Graph API de Meta.
 */
export async function ejecutarBotWhatsAppQR(params: {
  supabase: SupabaseClient;
  idTenant: string;
  telefono: string;
  texto: string;
  wamid: string;
}): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const { data: flow } = await params.supabase
    .from("dulabs_flows")
    .select("id")
    .eq("tenant_id", params.idTenant)
    .eq("status", "published")
    .limit(1)
    .maybeSingle();
  if (!flow) return { ok: false, motivo: "sin_flow_publicado" };

  const ahora = new Date().toISOString();
  const clienteSintetico: ClienteConfig & { flow_activo: true; flow_id: string } = {
    id: `whatsapp-qr:${params.idTenant}`,
    id_tenant: params.idTenant,
    nombre_negocio: "WhatsApp-QR",
    whatsapp_business_account_id: "whatsapp-qr",
    phone_number_id: `whatsapp-qr:${params.idTenant}`,
    telefono_negocio: "",
    prompt_sistema: null,
    api_key_ia: null,
    // Texto plano a propósito -- descifrarSecreto() (lib/crypto.ts) devuelve
    // tal cual cualquier valor que no tenga el formato versionado cifrado
    // real ("valor legacy en texto plano"), así que resolverTokenMeta()
    // nunca falla acá. El valor en sí nunca se usa de verdad: enviarTexto/
    // enviarBotones están sobreescritos más abajo y jamás llaman a Meta.
    meta_permanent_token: "whatsapp-qr-sin-token-meta",
    estado_pausa: false,
    pausado_hasta: null,
    plan: null,
    mensajes_usados_mes: 0,
    mes_actual: "",
    base_conocimiento: null,
    base_conocimiento_nombre_archivo: null,
    base_conocimiento_actualizado_at: null,
    calidad: null,
    limite_mensajeria: null,
    estado_verificacion: null,
    estado_nombre_visible: null,
    ultima_sincronizacion_meta: null,
    nombre_agente: null,
    ia_pausada: false,
    ia_restringida_a: null,
    ia_numeros_bloqueados: null,
    forward_to_dumo: false,
    captura_leads: false,
    agente_id: null,
    marketplace_activacion_id: null,
    flow_activo: true,
    flow_id: flow.id as string,
    created_at: ahora,
    updated_at: ahora,
  };

  const enviarComoBot = async (telefono: string, texto: string): Promise<{ wamid: string | null }> => {
    const resultado = await enviarMensajeWhatsApp({ tenantId: params.idTenant, telefono, mensaje: texto, origen: "automatico" });
    if (!resultado.ok) throw new Error(resultado.error);
    // El worker no devuelve el wamid real de Baileys en esta llamada (solo
    // {ok:true}) -- no hace falta: el propio worker ya persiste este mismo
    // mensaje saliente cuando le llega su propio eco de messages.upsert.
    return { wamid: null };
  };

  const sendMessageDepsOverride: Partial<SendMessageDeps> = {
    resolverCliente: async () => clienteSintetico,
    enviarTexto: async ({ para, texto }) => enviarComoBot(para, texto),
    // Baileys/WhatsApp-QR no tiene botones interactivos en este alcance
    // (spec Chats: solo texto/emoji/audio) -- si el flow llegara a generar
    // uno, se manda el cuerpo como texto plano en vez de fallar en seco.
    enviarBotones: async ({ para, cuerpo }) => enviarComoBot(para, cuerpo),
    incrementarUsoMensajes: async () => {}, // WhatsApp-QR no usa cupos de dulabs_clientes_config
    registrarMensaje: async () => false, // ya registrado por el worker vía persistirMensajeEntrante
  };

  let motivo = "sin_respuesta_tras_reintentos";
  try {
    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      const result = await atenderMensajeConFlow({
        supabase: params.supabase,
        cliente: clienteSintetico,
        telefonoCliente: params.telefono,
        texto: params.texto,
        wamid: params.wamid,
        sendMessageDepsOverride,
      });

      const decision = decidirFallbackDesdeResultado(result);
      if (decision.handled && decision.motivo !== "sin_intencion_reconocida") return { ok: true };

      // "sin_intencion_reconocida" (el enrutador no reconoció ninguna
      // intención y terminó sin decir nada a propósito) no es una ejecución
      // rota -- reintentar no cambiaría nada, así que se rinde sin insistir.
      motivo = decision.motivo;
      if (decision.motivo === "sin_intencion_reconocida") break;

      if (decision.requiereMarcarFallida && result.executionRowId && intento < MAX_INTENTOS) {
        await cerrarEjecucionRotaParaReintento({
          supabase: params.supabase,
          tenantId: params.idTenant,
          executionRowId: result.executionRowId,
        });
        continue;
      }
      break;
    }
    return { ok: false, motivo };
  } catch (err) {
    return { ok: false, motivo: err instanceof Error ? err.message : "error_desconocido" };
  }
}
