/**
 * FASE 3B.8 — TEXTOS QUE EL SISTEMA LE ENVÍA AL CLIENTE (capa de comunicación).
 *
 * Reglas de esta capa (no del modelo):
 *   - Cada texto es CONFIGURACIÓN DEL NEGOCIO (checkout_opciones del número): el motor genérico no trae ningún texto comercial
 *     ni nombre de persona. Sin texto configurado el sistema NO inventa uno: no envía (decisiones) o usa el mensaje neutro y
 *     seguro que ya existía (derivaciones y errores).
 *   - Los textos se envían TAL CUAL. La única sustitución permitida son marcadores cerrados ({pedido} y, en rechazo y
 *     cancelación, {motivo}): nunca datos personales, nunca el documento, nunca algo que escriba el modelo.
 *   - Un texto nunca cambia el estado de un pedido: enviarlo no acepta, no confirma, no reserva, no despacha.
 *
 * Aquí viven solo funciones puras (validar y completar plantillas, elegir el texto de envíos). El envío, la idempotencia y la
 * ventana de 24 h están en lib/catalogo/pedidos/mensajes-decision.ts.
 */
import type { CheckoutOpciones } from "@/lib/agente/perfil-negocio";

// ---------------------------------------------------------------------------
// Decisiones humanas sobre un pedido pendiente de aceptación
// ---------------------------------------------------------------------------

export const DECISIONES_CON_TEXTO = ["aceptar", "rechazar", "cancelar"] as const;
export type DecisionConTexto = (typeof DECISIONES_CON_TEXTO)[number];

/** Clave del texto en `cierre.textos` de cada decisión. */
export const CLAVE_TEXTO_DECISION = { aceptar: "aceptado", rechazar: "rechazado", cancelar: "cancelado" } as const;
export type ClaveTextoDecision = (typeof CLAVE_TEXTO_DECISION)[DecisionConTexto];

/** Marcadores que admite cada plantilla (cerrados: cualquier otro es una configuración inválida). */
export const MARCADORES_PERMITIDOS: Readonly<Record<ClaveTextoDecision, readonly string[]>> = Object.freeze({
  aceptado: ["pedido"],
  rechazado: ["pedido", "motivo"],
  cancelado: ["pedido", "motivo"],
});

export const MARCADOR = /\{([^{}]*)\}/g;

/** Nombres de los marcadores {…} de una plantilla, en orden. */
export function marcadoresDe(plantilla: string): string[] {
  return [...plantilla.matchAll(MARCADOR)].map((m) => m[1]);
}

/**
 * ¿Es una plantilla válida? Solo marcadores permitidos y ninguna llave suelta (nada de "{{x}}", "{pedido" o "}" aislados:
 * lo que se guarda es exactamente lo que se envía).
 */
export function plantillaValida(plantilla: string, permitidos: readonly string[]): boolean {
  if (!marcadoresDe(plantilla).every((m) => permitidos.includes(m))) return false;
  return !plantilla.replace(MARCADOR, "").match(/[{}]/);
}

export const usaMotivo = (plantilla: string): boolean => marcadoresDe(plantilla).includes("motivo");

/** Número público de pedido (el único identificador que ve el cliente). */
export const PEDIDO_PUBLICO = /^DL-ORD-[0-9A-HJKMNP-TV-Z]{6}$/;

/**
 * Un motivo que parece contener un documento, un teléfono o una cuenta (7 o más dígitos seguidos, ignorando separadores)
 * no se envía al cliente: lo escribe una persona del equipo para el equipo y puede traer lo que no debe salir.
 */
export function motivoParecePersonal(motivo: string): boolean {
  return /\d{7,}/.test(motivo.replace(/[\s.\-–—_/]/g, ""));
}

export type ResultadoTexto = { ok: true; texto: string } | { ok: false; motivo: "plantilla_invalida" | "pedido_invalido" | "sin_motivo" | "motivo_sensible" };

/**
 * Completa la plantilla de una decisión con el número de pedido y, si la plantilla lo pide, el motivo que registró la persona
 * autorizada (entre 3 y 300 caracteres, sin saltos de línea ni caracteres de control). Si la plantilla usa {motivo} y no hay
 * un motivo utilizable, NO se envía nada (no se improvisa un motivo ni se omite en silencio).
 */
export function renderizarTextoDecision(clave: ClaveTextoDecision, plantilla: string, datos: { pedido: string; motivo: string | null }): ResultadoTexto {
  if (!plantillaValida(plantilla, MARCADORES_PERMITIDOS[clave])) return { ok: false, motivo: "plantilla_invalida" };
  if (!PEDIDO_PUBLICO.test(datos.pedido)) return { ok: false, motivo: "pedido_invalido" };
  let motivo: string | null = null;
  if (usaMotivo(plantilla)) {
    const limpio = (datos.motivo ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    if (limpio.length < 3 || limpio.length > 300) return { ok: false, motivo: "sin_motivo" };
    if (motivoParecePersonal(limpio)) return { ok: false, motivo: "motivo_sensible" };
    motivo = limpio;
  }
  // Una sola pasada: lo que se inserta (el motivo) nunca se vuelve a interpretar como marcador.
  const texto = plantilla.replace(MARCADOR, (_m, nombre: string) => (nombre === "pedido" ? datos.pedido : (motivo ?? "")));
  return texto.trim().length > 0 ? { ok: true, texto } : { ok: false, motivo: "plantilla_invalida" };
}

// ---------------------------------------------------------------------------
// Envíos (Fase 3B.6): lo que se le dice al cliente cuando el motor no puede dar tiempos
// ---------------------------------------------------------------------------

/**
 * Tres situaciones que NO se mezclan:
 *   sin_cobertura            la ciudad está EXCLUIDA explícitamente por el negocio (se sabe que no)
 *   cobertura_no_verificable el sistema no puede verificar (ciudad desconocida, fuera de la lista, departamento que no cuadra,
 *                            sin reglas o sin tiempo verificable): una persona lo confirma; NO se afirma que no haya cobertura
 *   error_consulta           falló algo técnico al consultar o al derivar a una persona
 */
export const CLAVES_TEXTO_ENVIO = ["sin_cobertura", "cobertura_no_verificable", "error_consulta"] as const;
export type ClaveTextoEnvio = (typeof CLAVES_TEXTO_ENVIO)[number];

/** El texto del NEGOCIO para esa situación, o null (entonces rige el mensaje neutro que ya existía). Nunca de otro negocio: sale de SU configuración. */
export function textoDeEnvio(envios: NonNullable<CheckoutOpciones["envios"]> | null | undefined, clave: ClaveTextoEnvio): string | null {
  return envios?.textos?.[clave] ?? null;
}
