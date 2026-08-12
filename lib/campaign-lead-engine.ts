/**
 * Motor determinístico de captación de leads por campaña (SÍ/NO → RUT +
 * teléfono + compañía actual → lead capturado). Mismo principio que
 * lib/survey-engine.ts: puro, sin I/O, sin llamadas a IA — el backend
 * decide y valida, nunca el modelo. Diseñado para poder correr incluso en
 * números con ia_pausada=true (conectados a DuMo), siempre que el llamador
 * lo revise ANTES de ese gate, igual que ya hace atenderMensajeEncuesta.
 */

import { extraerDatosLead, type OperadorChileno } from "@/lib/campaign-lead-extraction";

export type CampaignLeadEstado = "waiting_response" | "requesting_data" | "lead_captured" | "not_interested" | "expired";

export interface CampaignLeadSession {
  estado: CampaignLeadEstado;
  customerName: string | null;
  rut: string | null;
  phoneProvided: string | null;
  currentCompanyRaw: string | null;
  currentOperator: OperadorChileno | null;
  capturedAt: string | null;
}

export function crearSesionCampaña(customerName: string | null = null): CampaignLeadSession {
  return {
    estado: "waiting_response",
    customerName,
    rut: null,
    phoneProvided: null,
    currentCompanyRaw: null,
    currentOperator: null,
    capturedAt: null,
  };
}

export interface CampaignBotConfig {
  campaignLabel: string;
  yesButtonText: string;
  noButtonText: string;
  /**
   * Si es false, el SÍ captura el lead de inmediato (sin pedir RUT/teléfono/
   * compañía) y solo envía confirmTemplate. Algunas campañas sí necesitan
   * esos datos (ver oferta_equipo_pie_cero); otras solo quieren transferir
   * el contacto a una ejecutiva sin hacerlo esperar un formulario.
   */
  collectData: boolean;
  /** Primera pregunta de la secuencia (teléfono). Solo se usa si collectData. */
  askDataTemplate: string;
  /** Segunda pregunta de la secuencia (compañía actual). Solo se usa si collectData. */
  askCompanyTemplate: string;
  /** Tercera y última pregunta de la secuencia (RUT). Solo se usa si collectData. */
  askRutTemplate: string;
  confirmTemplate: string;
  declineTemplate: string | null;
}

export type CampaignEngineAction =
  | "ask_data" // SÍ presionado -> se pide RUT/teléfono/compañía
  | "declined" // NO presionado -> flujo terminado, sin pedir datos
  | "missing_fields" // llegaron datos pero falta algo -> se pide solo lo faltante
  | "captured" // los 3 datos completos -> lead capturado + confirmación
  | "already_closed" // sesión en estado terminal, no se repite nada
  | "ignored"; // esperando SÍ/NO y llegó algo que no es ninguno de los dos

export interface CampaignEngineResult {
  session: CampaignLeadSession;
  action: CampaignEngineAction;
  messages: string[];
}

const norm = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// Variantes típicas escritas a mano, además del texto exacto del botón
// configurado — un tap real siempre manda el texto exacto del botón, esto
// es solo una red de seguridad para quien responde escribiendo en vez de
// tocar (sección 25 del spec: robustez, no la vía principal).
const SI_VARIANTES = new Set(["si", "sí", "s", "claro", "dale", "obvio", "me interesa"]);
const NO_VARIANTES = new Set(["no", "n", "no gracias", "no me interesa", "paso"]);

function esSi(texto: string, config: CampaignBotConfig): boolean {
  const n = norm(texto);
  return n === norm(config.yesButtonText) || SI_VARIANTES.has(n);
}
function esNo(texto: string, config: CampaignBotConfig): boolean {
  const n = norm(texto);
  return n === norm(config.noButtonText) || NO_VARIANTES.has(n);
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/** Procesa un mensaje entrante (ya normalizado a texto si venía de un botón). */
export function procesarMensajeCampaña(
  config: CampaignBotConfig,
  session: CampaignLeadSession,
  userText: string
): CampaignEngineResult {
  const s: CampaignLeadSession = { ...session };

  if (s.estado === "lead_captured" || s.estado === "not_interested" || s.estado === "expired") {
    return { session: s, action: "already_closed", messages: [] };
  }

  if (s.estado === "waiting_response") {
    if (esSi(userText, config)) {
      if (!config.collectData) {
        // Sin formulario: SÍ captura directo, sin pedir nada, y se
        // transfiere de inmediato a la ejecutiva.
        s.estado = "lead_captured";
        s.capturedAt = new Date().toISOString();
        return {
          session: s,
          action: "captured",
          messages: [fill(config.confirmTemplate, { campaign: config.campaignLabel })],
        };
      }
      s.estado = "requesting_data";
      return { session: s, action: "ask_data", messages: [config.askDataTemplate] };
    }
    if (esNo(userText, config)) {
      s.estado = "not_interested";
      return {
        session: s,
        action: "declined",
        messages: config.declineTemplate ? [config.declineTemplate] : [],
      };
    }
    // No es ni SÍ ni NO: no se asume nada, no se pide nada (sección 25 — no
    // activar por cualquier mensaje). El mensaje igual queda en el
    // historial porque el webhook lo registra antes de llegar aquí.
    return { session: s, action: "ignored", messages: [] };
  }

  // s.estado === "requesting_data"
  // Extrae de forma tolerante TODO lo que venga en el mensaje (el cliente
  // puede adelantarse y mandar más de un dato a la vez), pero nunca pisa un
  // dato ya confirmado con uno vacío.
  const extraido = extraerDatosLead(userText);
  if (extraido.telefono && !s.phoneProvided) s.phoneProvided = extraido.telefono;
  if (extraido.companiaRaw && !s.currentCompanyRaw) {
    s.currentCompanyRaw = extraido.companiaRaw;
    s.currentOperator = extraido.companiaOperador;
  }
  if (extraido.rut && !s.rut) s.rut = extraido.rut;

  // Secuencia fija de UNA pregunta a la vez: teléfono -> compañía -> RUT.
  // Si el cliente ya adelantó un dato posterior, ese paso se salta solo
  // (arriba ya quedó guardado) y se sigue exactamente donde falte.
  if (!s.phoneProvided) {
    return { session: s, action: "missing_fields", messages: [config.askDataTemplate] };
  }
  if (!s.currentCompanyRaw) {
    return { session: s, action: "missing_fields", messages: [config.askCompanyTemplate] };
  }
  if (!s.rut) {
    return { session: s, action: "missing_fields", messages: [config.askRutTemplate] };
  }

  s.estado = "lead_captured";
  s.capturedAt = new Date().toISOString();
  return {
    session: s,
    action: "captured",
    messages: [fill(config.confirmTemplate, { campaign: config.campaignLabel })],
  };
}
