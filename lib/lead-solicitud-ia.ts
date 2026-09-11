import { createGeminiGenerateContentClient, resolveGeminiApiKeyFromEnv, GEMINI_DEFAULT_MODEL } from "@/lib/flow/gemini/gemini-client";
import { classifyGeminiError } from "@/lib/flow/gemini/gemini-error-classifier";
import { EFFECT_RESULT_CLASSIFICATIONS } from "@/lib/flow/executor-types";
import type { GeminiContentPart, GeminiGenerateContentClient } from "@/lib/flow/gemini/gemini-types";
import { registrarFalloIA, enviarAlertaWhatsApp, type TipoFalloIA } from "@/lib/alertas";
import { construirMensajesConHistorial, type MensajeHistorialIA } from "@/lib/historial-conversacion";
import { guardarLeadEnterprise, notificarLeadEnterprise } from "@/lib/enterprise-leads";
import { activarPausaChat } from "@/lib/pausas-chat";
import type { ClienteConfig } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

// Du (314) -- migrado de Anthropic a Gemini (Fase 1, migración autorizada).
// Arquitectura: Gemini nunca ejecuta nada directamente -- solo propone una
// acción vía JSON estructurado (responseSchema), el backend la valida y la
// ejecuta. Mismo espíritu que lib/flow/executors/gemini-executor.ts (mode /
// propose_action / validación backend / ejecución backend), pero SIN pasar
// por la maquinaria genérica del Flow Engine (budget, prohibited fields,
// sesión de conversación) -- ese aparato es de Flow, 314 tiene
// flow_activo=false a propósito y no debe acoplarse a él. El patrón que sí
// se sigue al pie de la letra es el de lib/amore-entrada-gemini.ts: cliente
// Gemini real + system instruction propio + responseSchema propio, sin una
// segunda implementación del boundary HTTP.

// Traspaso a soporte humano: 24h es suficiente para que una persona del
// equipo tome la conversación de verdad, sin dejarla en silencio para
// siempre como sí tiene sentido en el onboarding ya completado (ver
// PAUSA_ONBOARDING_MS en app/webhook-dulabs/route.ts) -- acá, si la persona
// vuelve días después por otro tema, la IA debe poder atenderla de nuevo.
const PAUSA_SOPORTE_MS = 24 * 60 * 60 * 1000;

// Du usa su propia credencial dedicada (GEMINI_DU) en vez de la GEMINI_KEY
// compartida que usan AMORE/Flow Engine -- aísla el tráfico/cuota de Du del
// resto de la plataforma. Si por algún motivo no está configurada, cae a
// GEMINI_KEY como respaldo (nunca deja a Du sin poder resolver ninguna
// key si ambas existen).
export function resolverApiKeyDu(): string | null {
  return process.env.GEMINI_DU ?? resolveGeminiApiKeyFromEnv();
}

// Capa 1 de AIM-O ("contexto del contacto", Fase 1 autorizado): solo lo que
// se puede verificar de verdad hoy con los datos que ya tenemos, nunca una
// simulación. Deliberadamente NO intenta distinguir "cliente actual" de
// "prospecto" -- no existe ninguna tabla que ligue un teléfono a una cuenta
// de DuLabs paga, e inventar esa señal sería exactamente lo que la Fase 1
// prohíbe ("no inventar capacidades"). Nunca lanza: un fallo acá no puede
// tumbar la respuesta real. 100% independiente del proveedor de IA -- no
// cambió nada acá en la migración a Gemini.
export async function resolverContextoContacto(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoRemitente: string
): Promise<string | null> {
  try {
    const [{ data: leadPrevio }, { data: primerMensaje }] = await Promise.all([
      supabase
        .from("dulabs_enterprise_leads")
        .select("nombre, empresa, necesidad, created_at")
        .eq("telefono", telefonoRemitente)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("dulabs_mensajes_log")
        .select("created_at")
        .eq("phone_number_id", phoneNumberId)
        .eq("telefono_cliente", telefonoRemitente)
        .eq("direccion", "entrante")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    const lineas: string[] = [];
    const esPrimeraVez = !primerMensaje;
    lineas.push(esPrimeraVez ? "Es la primera vez que este número escribe." : "Este número ya había escrito antes.");
    if (leadPrevio) {
      lineas.push(
        `Ya dejó un lead registrado anteriormente: ${leadPrevio.nombre ?? "(sin nombre)"} de ${leadPrevio.empresa ?? "(sin empresa)"}, necesidad: "${leadPrevio.necesidad ?? "(no especificada)"}". No vuelvas a pedirle estos datos si ya los tienes aquí -- confírmalos solo si algo cambió.`
      );
    }
    return `[Contexto del sistema -- información real, no escrita por la persona, úsala en silencio: ${lineas.join(" ")}]`;
  } catch (err) {
    console.error("[lead-solicitud-ia] error resolviendo contexto del contacto:", err instanceof Error ? err.message : err);
    return null;
  }
}

// --- Acciones disponibles (backend valida y ejecuta, Gemini solo propone) ---
//
// Corrección de integridad estructural (autorizada): antes había un único
// campo "action" con un "type" libre + todos los demás campos opcionales --
// nada obligaba estructuralmente a Gemini a llenar nombre/empresa/correo/
// necesidad, así que a veces proponía la acción con todo en null (Caso 12
// de la batería real). Ahora cada acción es su PROPIO campo, nullable, y
// sus campos internos SÍ son "required" en el schema -- si Gemini quiere
// proponer guardar_lead_interesado, el schema lo obliga a llenar los 4
// datos; si no los tiene, la única salida válida es dejar el campo en null
// y seguir preguntando (ver DU_ADAPTADOR_ACCIONES, que instruye
// explícitamente a NUNCA inventar un valor solo para satisfacer el schema).

type AccionGuardarLeadInteresado = {
  nombre: string;
  empresa: string;
  correo: string;
  necesidad: string;
  detalle: string | null;
};

type AccionTransferirASoporte = {
  motivo: string;
};

type SalidaGemini = {
  mode: "reply" | "propose_action";
  reply_text: string;
  guardar_lead_interesado: AccionGuardarLeadInteresado | null;
  transferir_a_soporte: AccionTransferirASoporte | null;
};

// Subconjunto de JSON Schema que acepta Gemini (nunca additionalProperties,
// mismo criterio que lib/flow/gemini/gemini-schema.ts) -- escrito a mano,
// como lib/amore-entrada-gemini.ts, sin pasar por el builder genérico del
// Flow Engine (ese deriva de buildAiOutputToolSchema/claude-output-schema,
// pensado para acciones arbitrarias de un flow con budget/prohibited
// fields -- Du solo tiene 2 acciones fijas, ese aparato es infraestructura
// que no aplica y que esta migración NO debe introducir). "required" DENTRO
// de cada acción es justo lo que faltaba: ya confirmado en AMORE
// (lib/amore-entrada-gemini.ts) que Gemini respeta "required" junto con
// "nullable" en este mismo tipo de objeto -- acá se aplica "required" un
// nivel más adentro (dentro de cada acción, no en el objeto raíz), sin
// necesitar oneOf/if-then (no confirmado que Gemini los soporte, así que no
// se usan).
export const DU_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["reply", "propose_action"] },
    reply_text: { type: "string" },
    guardar_lead_interesado: {
      type: "object",
      nullable: true,
      properties: {
        nombre: { type: "string" },
        empresa: { type: "string" },
        correo: { type: "string" },
        necesidad: { type: "string" },
        detalle: { type: "string", nullable: true },
      },
      required: ["nombre", "empresa", "correo", "necesidad"],
    },
    transferir_a_soporte: {
      type: "object",
      nullable: true,
      properties: {
        motivo: { type: "string" },
      },
      required: ["motivo"],
    },
  },
  required: ["mode", "reply_text"],
};

// Reemplaza las explicaciones de tool-use nativo de la versión Anthropic
// (que ya no aplican) por el contrato JSON real que Gemini debe seguir acá.
// La identidad/AIM-O/líneas rojas/etc. NO están acá -- viven en
// cliente.prompt_sistema (scripts/_prompt-314.txt), sin cambios por esta
// migración.
export const DU_ADAPTADOR_ACCIONES =
  `--- Cómo actuar en este entorno (Gemini, sin tool-calling nativo) ---\n` +
  `No tienes llamado de herramientas nativo. Cada respuesta tuya es un JSON con "mode" ("reply" o "propose_action") y "reply_text" (tu mensaje real para la persona, con las mismas reglas de formato de siempre). El backend valida y ejecuta de verdad -- tú nunca ejecutas nada directamente.\n\n` +
  `Acciones disponibles (dos campos separados, cada uno en null si no aplica a este turno):\n` +
  `- "guardar_lead_interesado": si lo llenas, el schema exige nombre/empresa/correo/necesidad completos (detalle es opcional) -- SOLO llénalo cuando la persona haya mostrado interés real en contratar o cotizar Y ya tengas los 4 datos, extraídos del mensaje actual o del historial de la conversación. "Empresa" puede ser el tipo o nombre de negocio que haya mencionado (ej. "clínica odontológica") si no dio una razón social formal. Regla crítica: que el schema exija estos 4 campos NUNCA es permiso para inventar, inferir especulativamente o fabricar un valor que la persona no dio -- ni razón social, ni correo, ni teléfono, ni nombre comercial, ni ningún otro dato no proporcionado. Si falta cualquiera de los 4 datos reales, deja este campo entero en null y sigue preguntando de a uno con mode="reply" -- nunca propongas la acción con un dato inventado solo para completarla.\n` +
  `- "transferir_a_soporte": si lo llenas, el schema exige "motivo" (string breve y claro, basado únicamente en lo que el cliente expresó o el contexto real de la conversación -- nunca inventado). Úsalo cuando corresponda (pide soporte, ya es cliente con un problema, pide hablar con alguien, caso sensible). Si no hay una razón real para transferir, deja este campo en null. Tu "reply_text" en ese mismo turno debe ser el mensaje de despedida/traspaso, nunca prometas un tiempo de respuesta concreto.\n\n` +
  `Confirmaciones -- regla estricta: nunca afirmes en "reply_text" que algo YA se registró, guardó, envió, transfirió o completó hasta que el backend te haya confirmado que esa acción se ejecutó con éxito. En el MISMO turno en que propones una acción (mode="propose_action"), esa acción todavía NO ha pasado -- tu reply_text de ese turno debe sonar a "lo estoy gestionando" (ej. "dame un momento, ya te confirmo"), nunca a "ya quedó registrado" / "ya te registré" / "ya te transferí". Solo puedes confirmar el resultado cuando veas un bloque "[Resultado de tu acción -- información real del sistema: ...]" en el historial -- ESA es la única fuente real de si funcionó o no. Si dice que falló, discúlpate brevemente y ofrece intentarlo de nuevo -- nunca digas que sí funcionó. Nunca repitas la misma acción si el resultado ya dijo que funcionó.`;

function parsearAccionGuardarLead(raw: unknown): AccionGuardarLeadInteresado | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const nombre = typeof o.nombre === "string" ? o.nombre.trim() : "";
  const empresa = typeof o.empresa === "string" ? o.empresa.trim() : "";
  const correo = typeof o.correo === "string" ? o.correo.trim() : "";
  const necesidad = typeof o.necesidad === "string" ? o.necesidad.trim() : "";
  if (!nombre || !empresa || !correo || !necesidad) return null;
  return { nombre, empresa, correo, necesidad, detalle: typeof o.detalle === "string" ? o.detalle.trim() || null : null };
}

function parsearAccionTransferirSoporte(raw: unknown): AccionTransferirASoporte | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const motivo = typeof o.motivo === "string" ? o.motivo.trim() : "";
  if (!motivo) return null;
  return { motivo };
}

/** Parseo defensivo: cualquier forma inesperada (JSON roto, campos con tipo equivocado, mode desconocido, acción con datos incompletos) devuelve null en la parte afectada -- nunca lanza, nunca inventa un campo que no vino. */
export function parsearSalidaGemini(texto: string | null): SalidaGemini | null {
  if (!texto) return null;
  let data: unknown;
  try {
    data = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (obj.mode !== "reply" && obj.mode !== "propose_action") return null;
  if (typeof obj.reply_text !== "string") return null;

  return {
    mode: obj.mode,
    reply_text: obj.reply_text,
    guardar_lead_interesado: parsearAccionGuardarLead(obj.guardar_lead_interesado),
    transferir_a_soporte: parsearAccionTransferirSoporte(obj.transferir_a_soporte),
  };
}

/**
 * Valida y ejecuta la acción propuesta por Gemini (a lo sumo una: ya viene
 * pre-validada por parsearSalidaGemini -- si llegó no-null acá, sus campos
 * obligatorios ya son strings no vacíos reales, nunca inventados por este
 * código). Checklist real (Fase 1, autorizado):
 * 1-2. existe/permitida -- solo estos dos campos nombrados existen en el
 *      schema, no hay un "type" libre que pueda traer otra cosa; si ambos
 *      vienen null (nada válido que ejecutar), se rechaza sin ejecutar nada.
 * 3.   formato correcto -- ya validado en el parseo (required real del
 *      schema + chequeo de string no vacío), no se repite acá.
 * 4.   pertenece al contacto actual -- el teléfono NUNCA sale de la acción
 *      parseada (el modelo no lo controla ni lo ve como campo editable),
 *      siempre es `telefonoRemitente`, resuelto por el webhook real de Meta.
 * 5.   autorizada -- para Du, ambas acciones están siempre autorizadas (no
 *      hay roles/permisos por ahora); el candado real es el paso 1-2.
 * 6.   solo entonces se ejecuta -- reutiliza EXACTAMENTE las mismas
 *      funciones que la versión Anthropic (guardarLeadEnterprise/
 *      notificarLeadEnterprise, activarPausaChat/enviarAlertaWhatsApp).
 * Devuelve un resumen en texto plano para que el modelo conozca el
 * resultado REAL en su siguiente turno -- nunca se le dice "éxito" si no lo
 * fue (ver DU_ADAPTADOR_ACCIONES).
 */
export async function ejecutarAccion(
  supabase: SupabaseClient,
  cliente: Pick<ClienteConfig, "phone_number_id">,
  telefonoRemitente: string,
  salida: Pick<SalidaGemini, "guardar_lead_interesado" | "transferir_a_soporte">
): Promise<{ success: boolean; resumen: string }> {
  if (salida.transferir_a_soporte) {
    const motivo = salida.transferir_a_soporte.motivo;
    const resultado = await activarPausaChat(supabase, cliente.phone_number_id, telefonoRemitente, PAUSA_SOPORTE_MS);
    if (!resultado.ok) {
      return { success: false, resumen: "No se pudo transferir a soporte, intenta de nuevo." };
    }
    // A diferencia de la versión Anthropic original (antes de la corrección
    // previa), esto sigue notificando activamente al equipo -- Fase 1
    // exige explícitamente NO revertir esa corrección en la migración.
    await enviarAlertaWhatsApp(
      `🙋 Traspaso a soporte -- DuLabs (314)\n\n` +
        `Cliente: ${telefonoRemitente}\n` +
        `Motivo: ${motivo}\n\n` +
        `La IA queda en pausa para este chat puntual (no para todo el número).`
    );
    return { success: true, resumen: "transferir_a_soporte se ejecutó correctamente: el chat quedó en pausa y el equipo ya fue notificado." };
  }

  if (salida.guardar_lead_interesado) {
    const accion = salida.guardar_lead_interesado;
    const lead = {
      nombre: accion.nombre,
      empresa: accion.empresa,
      correo: accion.correo,
      telefono: telefonoRemitente,
      necesidad: accion.necesidad,
      detalle: accion.detalle ?? undefined,
    };
    const guardado = await guardarLeadEnterprise(supabase, lead);
    if (!guardado.success) {
      return { success: false, resumen: "No se pudo guardar el lead, intenta de nuevo." };
    }
    await notificarLeadEnterprise(lead);
    return { success: true, resumen: "guardar_lead_interesado se ejecutó correctamente: el lead quedó registrado y el equipo ya fue notificado." };
  }

  return { success: false, resumen: "No se propuso ninguna acción válida o completa -- no se ejecutó nada." };
}

/** Gemini -> TipoFalloIA (taxonomía del canal de alertas al dueño, lib/alertas.ts), reutilizando classifyGeminiError en vez de reimplementar detección de errores. */
function mapearErrorGemini(err: unknown): TipoFalloIA {
  const clasificado = classifyGeminiError(err);
  switch (clasificado.classification) {
    case EFFECT_RESULT_CLASSIFICATIONS.AUTH_ERROR:
      return "key_invalida";
    case EFFECT_RESULT_CLASSIFICATIONS.RATE_LIMIT:
      return "rate_limit";
    case EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE:
      return "sobrecarga";
    default:
      return "otro";
  }
}

export type DepsLeadGemini = {
  geminiClient?: GeminiGenerateContentClient;
  resolveApiKey?: () => string | null;
};

// Igual que generarRespuestaConEspecialistaIA (lib/especialista-solicitud-ia.ts),
// pero para el propio número de DuLabs: en vez de agendar una cita, las
// acciones reales disponibles son dejar registrado un lead comercial (misma
// tabla que usa el formulario "Enterprise" de la landing,
// dulabs_enterprise_leads) o transferir a soporte. `deps` es opcional y
// solo existe para poder inyectar un cliente Gemini falso en tests (mismo
// patrón que DepsClasificarGemini en lib/amore-entrada-gemini.ts) -- ningún
// llamador real necesita pasarlo.
export async function generarRespuestaConLeadIA(
  params: {
    supabase: SupabaseClient;
    cliente: ClienteConfig;
    textoUsuario: string;
    telefonoRemitente: string;
    historial?: MensajeHistorialIA[];
  },
  deps: DepsLeadGemini = {}
): Promise<string | null> {
  const resolveApiKey = deps.resolveApiKey ?? resolverApiKeyDu;
  const apiKey = resolveApiKey();
  if (!apiKey) {
    await registrarFalloIA({
      tipo: "sin_key",
      mensaje: "No hay GEMINI_KEY configurada en el servidor",
      idTenant: params.cliente.id_tenant,
      phoneNumberId: params.cliente.phone_number_id,
      nombreNegocio: params.cliente.nombre_negocio,
    });
    return null;
  }

  const client = deps.geminiClient ?? createGeminiGenerateContentClient(apiKey);

  const systemFinal =
    `${params.cliente.prompt_sistema ?? ""}\n\n` +
    (params.cliente.base_conocimiento ? `--- Información de referencia de DuLabs ---\n${params.cliente.base_conocimiento}\n\n` : "") +
    DU_ADAPTADOR_ACCIONES;

  const MENSAJE_RESPALDO =
    "¡Uy, disculpa! Tuve un problema técnico respondiéndote 😅 ¿me escribes de nuevo en un momento? Ya reviso qué pasó.";

  async function respaldoPorFalloSilencioso(mensaje: string): Promise<string> {
    await registrarFalloIA({
      tipo: "otro",
      mensaje,
      idTenant: params.cliente.id_tenant,
      phoneNumberId: params.cliente.phone_number_id,
      nombreNegocio: params.cliente.nombre_negocio,
    });
    return MENSAJE_RESPALDO;
  }

  // Enrutamiento silencioso (Fase 1, autorizado) -- sin cambios por la
  // migración, 100% independiente del proveedor.
  const contextoContacto = await resolverContextoContacto(params.supabase, params.cliente.phone_number_id, params.telefonoRemitente);
  const textoParaIA = contextoContacto ? `${contextoContacto}\n\n${params.textoUsuario}` : params.textoUsuario;

  // Reutiliza EXACTAMENTE la misma función de historial que usa todo el
  // resto de la plataforma (misma ventana de 24h, mismo límite de 20 turnos
  // / 12.000 caracteres, mismo merge de mensajes consecutivos) -- nunca se
  // reimplementa. Solo se traduce la forma: Anthropic usa "assistant",
  // Gemini usa "model" (mismo mapeo exacto que ya usa
  // lib/flow/executors/gemini-executor.ts:140-143).
  const contents: GeminiContentPart[] = construirMensajesConHistorial(params.historial ?? [], textoParaIA).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));

  const MAX_TURNOS_ACCION = 3;

  for (let turno = 0; turno < MAX_TURNOS_ACCION; turno++) {
    let resultado;
    try {
      resultado = await client.generateContent({
        model: GEMINI_DEFAULT_MODEL,
        systemInstruction: systemFinal,
        contents,
        responseSchema: DU_RESPONSE_SCHEMA,
        // 1024 truncaba la salida JSON en ~12% de los casos reales (batería
        // de 26 escenarios) porque gemini-3.6-flash descuenta sus tokens de
        // "pensamiento" interno del mismo presupuesto -- verificado con
        // Prueba A (2048, sin thinkingLevel): 0 truncamientos técnicos.
        maxOutputTokens: 2048,
        temperature: 0.7,
      });
    } catch (err) {
      await registrarFalloIA({
        tipo: mapearErrorGemini(err),
        mensaje: err instanceof Error ? err.message : String(err),
        idTenant: params.cliente.id_tenant,
        phoneNumberId: params.cliente.phone_number_id,
        nombreNegocio: params.cliente.nombre_negocio,
      });
      return MENSAJE_RESPALDO;
    }

    const salida = parsearSalidaGemini(resultado.text);
    if (!salida) {
      return respaldoPorFalloSilencioso(
        `Gemini devolvió una salida fuera del schema esperado: "${(resultado.text ?? "").slice(0, 200)}"`
      );
    }

    if (salida.mode === "reply") {
      const texto = salida.reply_text.trim();
      if (texto) return texto;
      return respaldoPorFalloSilencioso(
        `Gemini devolvió reply_text vacío. Mensaje del usuario: "${params.textoUsuario.slice(0, 200)}"`
      );
    }

    // mode === "propose_action": el backend valida y ejecuta, NUNCA Gemini
    // directamente. Pasa por ejecutarAccion SIEMPRE -- incluso si el parseo
    // no logró completar ninguna acción válida (datos incompletos, ambas
    // quedaron null) -- así el reply_text optimista de este turno nunca
    // llega al cliente sin haber sido confrontado con el resultado real. El
    // resultado REAL se le informa a Gemini en el siguiente turno -- nunca
    // se asume que su reply_text de este turno ya reflejaba la verdad
    // (mismo espíritu que el tool_result de la versión Anthropic: el
    // modelo nunca queda creyendo que algo pasó si no pasó).
    const ejecucion = await ejecutarAccion(params.supabase, params.cliente, params.telefonoRemitente, salida);
    contents.push({ role: "model", text: JSON.stringify(salida) });
    contents.push({
      role: "user",
      text: `[Resultado de tu acción -- información real del sistema, no escrita por la persona: ${ejecucion.resumen}]`,
    });
  }

  return respaldoPorFalloSilencioso(`Se agotaron los ${MAX_TURNOS_ACCION} turnos de acción sin devolver una respuesta final.`);
}
