/**
 * Motor determinístico del onboarding automático post-pago (bienvenida ->
 * elige Comenzar configuración o Hablar con soporte -> si configura, 3
 * preguntas abiertas fijas -> fin). Mismo principio que
 * lib/campaign-lead-engine.ts: puro, sin I/O, sin llamadas a IA -- el
 * backend decide y valida, nunca el modelo. Los mensajes son strings fijos,
 * nunca generados por el modelo.
 */

export type OnboardingEstado =
  | "menu_enviado"
  | "esperando_negocio"
  | "esperando_idea"
  | "esperando_adicional"
  | "completado"
  | "soporte_solicitado";

export interface OnboardingSession {
  estado: OnboardingEstado;
  customerName: string | null;
  plan: string;
  businessDescription: string | null;
  implementationIdea: string | null;
  additionalInformation: string | null;
}

export type OnboardingAction =
  | "iniciar_configuracion" // eligió el botón/intención de configurar -- se manda el mensaje de transición + pregunta 1
  | "pedir_pregunta_2"
  | "pedir_pregunta_3"
  | "completado" // se guardó la respuesta 3 -- mensaje final, fin del flujo
  | "soporte_solicitado" // eligió soporte -- mensaje de soporte, fin del flujo
  | "menu_no_entendido" // no se detectó ninguna intención clara -- se repiten los botones
  | "reenganche" // volvió después de abandonar y solo saludó -- se retoma la pregunta pendiente, sin guardar el saludo como respuesta
  | "already_closed"; // sesión en estado terminal, no se repite nada

export interface OnboardingEngineResult {
  session: OnboardingSession;
  action: OnboardingAction;
  messages: string[];
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

// Coincidencia por palabra clave, mismo criterio que esSi/esNo en
// campaign-lead-engine.ts -- nunca IA para esto.
const PALABRAS_CONFIGURAR = ["configura", "configurar", "empezar", "empezamos", "iniciar", "comenzar", "comenzemos", "comencemos"];
const PALABRAS_SOPORTE = ["soporte", "hablar con alguien", "hablar con un asesor", "ayuda", "asesor", "humano", "persona"];

function detectarIntencion(texto: string): "configurar" | "soporte" | null {
  const n = norm(texto);
  if (PALABRAS_CONFIGURAR.some((p) => n.includes(p))) return "configurar";
  if (PALABRAS_SOPORTE.some((p) => n.includes(p))) return "soporte";
  return null;
}

// Si el cliente abandonó el flujo a mitad de una pregunta y vuelve horas
// después con un simple "hola", eso NO es la respuesta real a la pregunta
// pendiente -- se re-engancha con la misma pregunta en vez de guardar el
// saludo como si fuera el dato.
const SALUDOS_SUELTOS = new Set([
  "hola", "holaa", "holaaa", "buenas", "buenos dias", "buenas tardes", "buenas noches",
  "hey", "hi", "hello", "hay alguien", "hola?", "buenas!",
]);

function esSoloUnSaludo(texto: string): boolean {
  const n = norm(texto).replace(/[!¡?¿.]/g, "").trim();
  return SALUDOS_SUELTOS.has(n);
}

// --- Textos fijos del flujo (brief del usuario, secciones 11-18) --------------

export function textoBienvenida(nombre: string | null, plan: string): string {
  const saludo = nombre ? `¡Hola, ${nombre}! 👋` : "¡Hola! 👋";
  return (
    `${saludo}\n\n` +
    `¡Bienvenido/a a DuLabs!\n\n` +
    `Hemos confirmado tu pago del plan ${plan} y ya podemos comenzar con la configuración de tu servicio.\n\n` +
    `¿Qué deseas hacer?`
  );
}

export const TEXTO_TRANSICION_CONFIGURACION =
  "Perfecto. 🚀\n\nAntes de comenzar, queremos conocer un poco sobre tu negocio y sobre lo que te gustaría implementar con DuLabs.\n\nSon solo unas preguntas.";

export const TEXTO_PREGUNTA_1 = "Cuéntanos un poco sobre tu negocio.\n\n¿Qué haces, qué productos o servicios ofreces y qué deberíamos conocer para entenderlo?";

export const TEXTO_PREGUNTA_2 =
  "Ahora cuéntanos qué te gustaría implementar con DuLabs. 🚀\n\nPuedes contarnos tu idea sin límites, aunque sea algo sencillo, complejo o que todavía no sepas si es posible.\n\n¿Qué te gustaría que DuLabs hiciera por ti?";

export const TEXTO_PREGUNTA_3 = "¿Hay algo más que quieras que tengamos en cuenta?\n\nPuedes contarnos cualquier detalle, proceso, herramienta o necesidad que consideres importante.";

export function textoFinalConfiguracion(nombre: string | null): string {
  const nombreParte = nombre ? `, ${nombre}` : "";
  return (
    `¡Perfecto${nombreParte}! 🙌\n\n` +
    `Ya tenemos una idea mucho más clara de lo que necesitas.\n\n` +
    `Hemos registrado la información que nos compartiste. Un especialista de DuLabs revisará tu solicitud y continuará contigo para comenzar la configuración de tu solución.\n\n` +
    `¡Gracias por confiar en DuLabs!`
  );
}

export const TEXTO_SOPORTE =
  "Claro. 👋\n\nHemos recibido tu solicitud. Un especialista de soporte continuará contigo por este medio.\n\nGracias por contactar a DuLabs.";

export const TEXTO_MENU_NO_ENTENDIDO = "Claro. Elige una opción:\n\n🚀 Comenzar configuración\n💬 Hablar con soporte";

// Re-enganche cuando el cliente vuelve después de abandonar a mitad de una
// pregunta y solo saluda -- retoma exactamente donde quedó, sin repetir
// preguntas ya respondidas ni tratar el saludo como si fuera la respuesta.
const REENGANCHE: Record<"esperando_negocio" | "esperando_idea" | "esperando_adicional", string> = {
  esperando_negocio: "Nos quedamos en la información de tu negocio.",
  esperando_idea: "Nos quedamos en qué te gustaría implementar con DuLabs.",
  esperando_adicional: "Ya casi terminamos, solo falta un último detalle.",
};
const PREGUNTA_POR_ESTADO: Record<"esperando_negocio" | "esperando_idea" | "esperando_adicional", string> = {
  esperando_negocio: TEXTO_PREGUNTA_1,
  esperando_idea: TEXTO_PREGUNTA_2,
  esperando_adicional: TEXTO_PREGUNTA_3,
};

export const BOTON_CONFIGURAR = "🚀 Comenzar configuración";
export const BOTON_SOPORTE = "💬 Hablar con soporte";

/** Procesa un mensaje entrante (ya normalizado a texto si venía de un botón). */
export function procesarMensajeOnboarding(session: OnboardingSession, userText: string): OnboardingEngineResult {
  const s: OnboardingSession = { ...session };

  if (s.estado === "completado" || s.estado === "soporte_solicitado") {
    return { session: s, action: "already_closed", messages: [] };
  }

  if (s.estado === "menu_enviado") {
    const intencion = detectarIntencion(userText);
    if (intencion === "configurar") {
      s.estado = "esperando_negocio";
      return { session: s, action: "iniciar_configuracion", messages: [TEXTO_TRANSICION_CONFIGURACION, TEXTO_PREGUNTA_1] };
    }
    if (intencion === "soporte") {
      s.estado = "soporte_solicitado";
      return { session: s, action: "soporte_solicitado", messages: [TEXTO_SOPORTE] };
    }
    return { session: s, action: "menu_no_entendido", messages: [TEXTO_MENU_NO_ENTENDIDO] };
  }

  if (s.estado === "esperando_negocio" || s.estado === "esperando_idea" || s.estado === "esperando_adicional") {
    if (esSoloUnSaludo(userText)) {
      return {
        session: s,
        action: "reenganche",
        messages: [`¡Hola! 👋\n\n${REENGANCHE[s.estado]}\n\n${PREGUNTA_POR_ESTADO[s.estado]}`],
      };
    }
  }

  if (s.estado === "esperando_negocio") {
    s.businessDescription = userText;
    s.estado = "esperando_idea";
    return { session: s, action: "pedir_pregunta_2", messages: [TEXTO_PREGUNTA_2] };
  }

  if (s.estado === "esperando_idea") {
    s.implementationIdea = userText;
    s.estado = "esperando_adicional";
    return { session: s, action: "pedir_pregunta_3", messages: [TEXTO_PREGUNTA_3] };
  }

  // s.estado === "esperando_adicional"
  s.additionalInformation = userText;
  s.estado = "completado";
  return { session: s, action: "completado", messages: [textoFinalConfiguracion(s.customerName)] };
}
