/**
 * Bot comercial de Soluciones Financieras (tenant contacto@dulabs.co,
 * phone_number_id 1275440315656562, ver app/webhook-dulabs/route.ts).
 * Flujo fijo, sin configuración por campaña (a diferencia de
 * lib/campaign-lead-engine.ts): botón de producto -> UNA pregunta ->
 * respuesta del cliente -> mensaje de Charlotte -> handoff. Puro, sin I/O,
 * mismo principio que lib/campaign-lead-engine.ts y lib/survey-engine.ts.
 */

export type ProductoFinanciero = "libre_inversion" | "compra_cartera" | "hipotecario";

export interface SolicitudProductoSession {
  producto: ProductoFinanciero;
  respuestaCliente: string | null;
  estado: "esperando_dato" | "pendiente_asesor";
}

const PREGUNTA_POR_PRODUCTO: Record<ProductoFinanciero, string> = {
  libre_inversion: "Claro que sí 😊 ¿Me puedes indicar el monto que te gustaría adquirir?",
  compra_cartera: "Claro 😊 Confírmame, ¿qué obligaciones te gustaría recoger?",
  hipotecario: "Claro que sí 😊 ¿Me puedes indicar aproximadamente cuánto necesitas para adquirir tu vivienda?",
};

export const MENSAJE_CHARLOTTE =
  "¡Perfecto! 😊 Gracias por la información. En un momento Charlotte estará respondiéndote para continuar con tu asesoría.";

// Saludo de bienvenida: se manda UNA sola vez, en el primer mensaje real de
// un contacto nuevo (ver esPrimerContacto en app/webhook-dulabs/route.ts),
// sea cual sea su contenido -- reemplaza el menú anterior de 4 opciones. Va
// en DOS mensajes separados (pedido explícito: el saludo todo junto con los
// botones no gustó) -- el segundo es el cuerpo del mensaje de los botones.
export const MENSAJE_BIENVENIDA_1 = "👋🏼 ¡Hola! Qué gusto tenerte en Soluciones Financieras.\nEstamos aquí para ayudarte 😊";
export const MENSAJE_BIENVENIDA_2 = "¿Qué opción te interesa? 👇🏼";

// Botones interactivos (no de plantilla) que acompañan MENSAJE_BIENVENIDA_2,
// mandados con enviarBotonesWhatsApp (lib/whatsapp-outbound.ts) -- el título
// de cada uno debe calzar con una de las VARIANTES_POR_PRODUCTO de abajo.
export const BOTONES_BIENVENIDA: { id: string; titulo: string }[] = [
  { id: "producto_libre_inversion", titulo: "💰 Libre Inversión" },
  { id: "producto_compra_cartera", titulo: "💳 Compra Cartera" },
  { id: "producto_hipotecario", titulo: "🏠 Hipotecario" },
];

// Cualquier mensaje que no sea ni un tap de los 3 botones ni la respuesta a
// una pregunta ya en curso (texto libre, "Hola", una imagen, un audio...) se
// traspasa de una vez a Charlotte, sin que el bot intente responderlo.
export const MENSAJE_TRANSFERENCIA_FALLBACK =
  "¡Claro que sí! 😊 En un momento Charlotte estará respondiéndote para brindarte toda la información y ayudarte con tu solicitud.";

const norm = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// Deben calzar con el texto EXACTO de los botones QUICK_REPLY de la
// plantilla de Meta -- case/acento-insensible, mismo criterio que
// esSi/esNo en lib/campaign-lead-engine.ts. Un tap real siempre manda el
// texto exacto del botón (mensaje.button.text / interactive.button_reply.title,
// ver app/webhook-dulabs/route.ts) -- nunca dependemos del payload/id, que
// puede no venir en botones de plantilla.
//
// Varias variantes por producto (mismo criterio que SI_VARIANTES/NO_VARIANTES
// en campaign-lead-engine.ts): la plantilla pasó por más de una versión
// durante el diseño (con/sin "Info", con/sin emoji) y Meta puede aprobarla
// con cualquiera de estos textos -- reconocer todas evita tener que tocar
// código si el texto final difiere ligeramente del último borrador.
const VARIANTES_POR_PRODUCTO: Record<ProductoFinanciero, string[]> = {
  libre_inversion: ["💰 Libre Inversión", "Libre Inversión", "Info de Libre Inversión", "Info Libre Inversión"],
  compra_cartera: ["💳 Compra Cartera", "Compra Cartera", "Info Compra de Cartera", "Info de Compra de Cartera"],
  hipotecario: ["🏠 Hipotecario", "Hipotecario", "Info Hipotecario"],
};

const BOTON_A_PRODUCTO: Record<string, ProductoFinanciero> = Object.fromEntries(
  (Object.entries(VARIANTES_POR_PRODUCTO) as [ProductoFinanciero, string[]][]).flatMap(([producto, variantes]) =>
    variantes.map((v) => [norm(v), producto]),
  ),
);

/** null si el texto no corresponde a ninguno de los 3 botones de la plantilla. */
export function detectarProductoPorBoton(textoBoton: string): ProductoFinanciero | null {
  return BOTON_A_PRODUCTO[norm(textoBoton)] ?? null;
}

export function preguntaParaProducto(producto: ProductoFinanciero): string {
  return PREGUNTA_POR_PRODUCTO[producto];
}

export function crearSesionProducto(producto: ProductoFinanciero): SolicitudProductoSession {
  return { producto, respuestaCliente: null, estado: "esperando_dato" };
}

export type SolicitudProductoAccion = "capturado" | "ya_cerrado";

export interface SolicitudProductoResultado {
  session: SolicitudProductoSession;
  accion: SolicitudProductoAccion;
  mensajes: string[];
}

/**
 * El cliente ya tiene una solicitud activa (esperando_dato) y este mensaje
 * es su respuesta al dato pedido. No valida formato de monto/obligaciones
 * a propósito (spec: "no es necesario validar exhaustivamente el formato
 * en esta primera versión") -- cualquier texto no vacío se acepta como
 * respuesta válida y cierra el flujo hacia handoff humano.
 */
export function procesarRespuestaProducto(
  session: SolicitudProductoSession,
  textoCliente: string,
): SolicitudProductoResultado {
  if (session.estado === "pendiente_asesor") {
    return { session, accion: "ya_cerrado", mensajes: [] };
  }
  const s: SolicitudProductoSession = { ...session, respuestaCliente: textoCliente, estado: "pendiente_asesor" };
  return { session: s, accion: "capturado", mensajes: [MENSAJE_CHARLOTTE] };
}
