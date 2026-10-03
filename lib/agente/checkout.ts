/**
 * Bloque 27 — CHECKOUT CONVERSACIONAL: la IA conversa, el BACKEND decide.
 *
 * El modelo solo detecta la intención de comprar (create_order_request) o el backend la reconoce
 * con frases fijas; desde ahí esta máquina de estados conduce, SIN modelo:
 *
 *   nombre (si no hay uno confiable) -> entrega [tienda | domicilio]
 *     -> (domicilio) dirección -> ciudad -> referencia (opcional)
 *     -> pago [pago en tienda | transferencia] -> RESUMEN (del motor) [confirmar | modificar | cancelar]
 *
 * - Nunca se pregunta persona natural/empresa, razón social, teléfono ni modalidad (el canal es el
 *   del contacto y queda congelado en el pedido).
 * - El resumen sale del motor (precios, total y propuesta vigentes); solo ESA propuesta se confirma.
 * - Confirmar: una transacción del motor (re-verifica canal, productos, precios, stock y propuesta;
 *   aparta el stock y guarda los datos del checkout). Si algo cambió, no se confirma: se explica y
 *   se muestra el resumen nuevo.
 * - Modificar / cancelar: la propuesta se cancela (sin reserva, nada que devolver) y los productos
 *   vuelven a la selección de la conversación.
 * - Tras confirmar: una asesora sigue la conversación (pausa de la IA) con un mensaje FIJO.
 *
 * Todo detrás de dulabs_agente_runtime_config.checkout_conversacional (false por defecto).
 *
 * Bloque 28 — lenguaje humano (lib/agente/lenguaje): antes de leer el dato del paso, cada mensaje se
 * clasifica: salida (cancelar / modificar) · duda · espera · PREGUNTA (se responde sin tocar nada y se
 * repite la pregunta del paso) · cambio de productos (cantidad / quitar, con el producto claro o se
 * pregunta cuál) · CORRECCIÓN de entrega o pago (se cambia ESE dato) · respuesta del paso (estricta:
 * una intención o una risa nunca es un nombre ni una dirección). El nombre se guarda en el contacto
 * solo cuando el pedido se confirma.
 *
 * Multi-negocio: las entregas y los pagos que se ofrecen, su orden, sus políticas y los textos que
 * los enumeran salen del perfil del negocio (io.perfil, lib/agente/perfil-negocio.ts); igual el
 * vocabulario con que se reconoce un producto o un nombre. Una sola opción => no se pregunta. Más
 * de 3 => lista de WhatsApp (la decide quien envía). Antes de confirmar, el backend verifica que la
 * entrega y el pago sigan entre los ofrecidos.
 */
import { formatCop } from "@/lib/business-agent-quote";
import { publicView, type DeliveryType, type OrderChannel, type OrderPublicView, type PaymentMethod } from "@/lib/catalogo/pedidos/contrato";
import { OrderError, conversationKey, requestFingerprint, type CheckoutData, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { extractReferences } from "@/lib/catalogo/resolucion";
import type { OrderContact } from "@/lib/catalogo/pedidos/repositorio";
import { MAX_CART_LINES, type CheckoutState, type CheckoutStep, type ConversationState } from "@/lib/agente/estado";
import { isExplicitConfirmation } from "@/lib/agente/etapa";
import { resolveSelection } from "@/lib/agente/seleccion";
import {
  anunciaDireccion,
  esAfirmacion,
  esEspera,
  esPregunta,
  sinIntencionDeNombre,
  esRelleno,
  leerCantidad,
  leerCiudad,
  leerCorreccion,
  ciudadEnDireccion,
  leerDireccion,
  leerEntrega,
  leerNombre,
  leerPago,
  leerSalida,
  pideCatalogo,
  pideElPedido,
  pideProducto,
  pideQuitar,
  pistasCheckout,
  type Cantidad,
} from "@/lib/agente/lenguaje/interpretar";
import { NUMEROS_EN_LETRAS, PAGO } from "@/lib/agente/lenguaje/lexico";
import { normalizar } from "@/lib/agente/lenguaje/normalizar";
import {
  ENTREGA_INFO,
  PAGO_INFO,
  VOCABULARIO_NEUTRAL,
  cierreConAceptacion,
  ofreceEntrega,
  pagoPermitido,
  pagosPara,
  tipoDocumento,
  type CheckoutOpciones,
  type PerfilNegocio,
  type Vocabulario,
} from "@/lib/agente/perfil-negocio";
import { leerDepartamento } from "@/lib/agente/lenguaje/departamentos";
import { textoDeEnvio } from "@/lib/agente/textos-cliente";
import { normalizarCelular } from "@/lib/catalogo/clientes/modelo";
import { maskDocument, sealDocument, type DocumentCipher } from "@/lib/catalogo/pedidos/documento";
import type { AcceptancePolicy } from "@/lib/catalogo/pedidos/contrato";

type Button = { id: string; title: string };

/** Botón de cada entrega y de cada pago del catálogo de la plataforma (cada negocio ofrece un subconjunto). */
export const DELIVERY_BUTTONS: Readonly<Record<DeliveryType, Button>> = {
  tienda: ENTREGA_INFO.tienda.boton,
  domicilio: ENTREGA_INFO.domicilio.boton,
  // Fase 3B: existe en el catálogo, pero ningún negocio puede ofrecerla hasta la Fase 3B.4 (funcionesNoDisponibles).
  oficina_transportadora: ENTREGA_INFO.oficina_transportadora.boton,
};
export const PAYMENT_BUTTONS: Readonly<Record<PaymentMethod, Button>> = {
  pago_en_tienda: PAGO_INFO.pago_en_tienda.boton,
  transferencia: PAGO_INFO.transferencia.boton,
  contra_entrega: PAGO_INFO.contra_entrega.boton,
  link_pago: PAGO_INFO.link_pago.boton,
};

/** Botones de entrega que ofrece el negocio (en su orden). */
export const deliveryButtons = (o: Pick<CheckoutOpciones, "entregas">): Button[] => o.entregas.map((e) => DELIVERY_BUTTONS[e]);
/** Botones de pago que ofrece el negocio con esa entrega (en su orden). */
export const paymentButtons = (o: Pick<CheckoutOpciones, "entregas" | "pagos">, entrega: DeliveryType | null): Button[] => pagosPara(o, entrega).map((p) => PAYMENT_BUTTONS[p]);

export const CHECKOUT_BUTTONS = {
  reference: [{ id: "checkout_sin_referencia", title: "Sin referencia" }],
  summary: [
    { id: "checkout_confirmar", title: "✅ Confirmar pedido" },
    { id: "checkout_modificar", title: "✏️ Modificar pedido" },
    { id: "checkout_cancelar", title: "❌ Cancelar" },
  ],
} as const satisfies Record<string, readonly Button[]>;

/** Todos los botones del checkout de ESE negocio, por paso (los de pago: los que ofrece con cualquier entrega). */
export const checkoutButtons = (o: CheckoutOpciones) => ({ ...CHECKOUT_BUTTONS, delivery: deliveryButtons(o), payment: paymentButtons(o, null) });

/**
 * Fase 3B.4 — botones del checkout CON ACEPTACIÓN (títulos ≤ 20 caracteres: límite de Meta para botones;
 * el texto del mensaje explica cada uno). "Datos correctos" NO es aceptar la compra: solo valida los datos.
 */
export const ACEPTACION_BUTTONS = {
  phone: [{ id: "checkout_mismo_numero", title: "📱 Este mismo número" }],
  summary: [
    { id: "checkout_datos_correctos", title: "✅ Datos correctos" },
    { id: "checkout_corregir", title: "✏️ Corregir dato" },
    { id: "checkout_cancelar", title: "❌ Cancelar" },
  ],
} as const satisfies Record<string, readonly Button[]>;

/** Datos que se pueden corregir desde el resumen (lista de WhatsApp: más de 3 opciones). */
type CampoCorregible = "name" | "phone" | "city" | "department" | "address" | "neighborhood" | "office" | "document" | "products";
const CAMPOS_CORREGIBLES: ReadonlyArray<{ id: string; title: string; campo: CampoCorregible; palabras: readonly string[] }> = [
  { id: "checkout_corregir_nombre", title: "Nombre", campo: "name", palabras: ["nombre", "mi nombre", "el nombre"] },
  { id: "checkout_corregir_telefono", title: "Teléfono", campo: "phone", palabras: ["telefono", "celular", "numero", "el telefono", "el numero", "mi numero"] },
  { id: "checkout_corregir_ciudad", title: "Ciudad", campo: "city", palabras: ["ciudad", "la ciudad", "municipio"] },
  { id: "checkout_corregir_departamento", title: "Departamento", campo: "department", palabras: ["departamento", "el departamento"] },
  { id: "checkout_corregir_direccion", title: "Dirección", campo: "address", palabras: ["direccion", "la direccion"] },
  { id: "checkout_corregir_barrio", title: "Barrio", campo: "neighborhood", palabras: ["barrio", "el barrio"] },
  { id: "checkout_corregir_oficina", title: "Oficina", campo: "office", palabras: ["oficina", "la oficina"] },
  { id: "checkout_corregir_documento", title: "Documento", campo: "document", palabras: ["documento", "cedula", "el documento", "la cedula"] },
  { id: "checkout_corregir_productos", title: "Productos", campo: "products", palabras: ["productos", "producto", "cantidad", "cantidades", "el pedido"] },
];

/** Fase 3B.4 — textos FIJOS del checkout con aceptación (sin IA; neutros: sin rubro). La versión final de los textos es la Fase 3B.8. */
export const ACEPTACION_MESSAGES = {
  intro: "¡Perfecto! Vamos a registrar tu pedido 😊",
  askName: "¿Cuál es tu nombre completo (nombre y apellido)?",
  askNameAgain: "Por favor escríbeme tu nombre y apellido.",
  askPhone: (mismo: boolean) =>
    mismo
      ? "¿A qué número celular te contactamos para la entrega? Si es este mismo de WhatsApp, toca *Este mismo número* o escríbeme *este mismo*."
      : "¿A qué número celular te contactamos para la entrega?",
  phoneAgain: "Ese número no parece un celular válido. Escríbemelo con sus 10 dígitos (por ejemplo: 300 123 4567).",
  phoneWriteIt: "Por favor escríbeme el número celular para la entrega.",
  askCity: "¿En qué ciudad o municipio recibes el pedido?",
  cityAgain: "Por favor escríbeme la ciudad o el municipio donde recibes el pedido.",
  askDepartment: "¿En qué departamento?",
  departmentAgain: "No reconocí ese departamento. Escríbemelo completo (por ejemplo: Antioquia, Cundinamarca o Valle del Cauca).",
  askNeighborhood: "¿En qué barrio?",
  neighborhoodAgain: "Escríbeme el barrio (o la vereda o el sector, si no hay barrio).",
  askOffice: (t: string) => `¿En qué oficina de ${t} vas a reclamar el pedido? Escríbeme el nombre o la dirección de la oficina.`,
  officeAgain: (t: string) => `Escríbeme el nombre o la dirección de la oficina de ${t} donde vas a reclamar el pedido.`,
  officeNoted: (t: string) => `Anotado: reclamas el pedido en una oficina de ${t} 📦`,
  askDocument: "Para reclamar en la oficina necesito tu número de documento de identidad.",
  documentAgain: "No pude leer ese número de documento. Escríbemelo solo con números (y letras, si las tiene).",
  documentRefused: "Entiendo 🙏 Sin el documento no puedo registrar la entrega en la oficina. Te comunico con una persona de nuestro equipo para ayudarte.",
  documentUnavailable: "No puedo registrar la entrega en la oficina en este momento. Te comunico con una persona de nuestro equipo para ayudarte.",
  coverageHandoff: "Para tu ciudad necesito confirmar el envío con una persona de nuestro equipo. En breve te escribe.",
  summaryPrompt: "¿Tus datos están correctos?\n\nSi todo está bien toca ✅ *Datos correctos*. Si quieres cambiar algo, toca ✏️ *Corregir dato*.",
  summaryFallback: "Respóndeme *datos correctos*, *corregir* o *cancelar*.",
  tapDataOk: "Si tus datos están bien, toca ✅ *Datos correctos* (o escríbeme *mis datos están correctos*).",
  fixWhich: "¿Qué dato quieres corregir?",
  fixProducts: "Para cambiar cantidades dime cuántas y de cuál producto. Para agregar o quitar productos escríbeme *modificar pedido*.",
  questionFallback: "Ese detalle te lo confirma nuestro equipo apenas registremos tu pedido 😊",
  questionHandoff: "Ese detalle te lo confirma una persona de nuestro equipo. En breve te escribe.",
  alreadySubmitted: "Tu pedido ya quedó registrado. En breve una persona de nuestro equipo continúa contigo.",
  unavailable: "Disculpa, no pude registrar tu pedido en este momento: no quedó registrado. ¿Me escribes de nuevo en un momento?",
} as const;

/** Mensajes FIJOS (sin IA). Nunca dicen "pago recibido", "enviado" ni "completado". */
export const CHECKOUT_MESSAGES = {
  intro: "¡Perfecto! 💖 Vamos a registrar tu pedido.",
  askName: "¿A nombre de quién registramos tu pedido?",
  askNameAgain: "Por favor escríbeme solo el nombre de la persona a nombre de quien registramos el pedido.",
  delivery: "¿Cómo deseas recibir tu pedido?",
  address: "Perfecto. Envíame la dirección donde deseas recibir tu pedido.",
  addressAgain: "Por favor envíame la dirección completa donde deseas recibir tu pedido (calle, número y barrio si aplica).",
  city: "¿En qué ciudad?",
  cityAgain: "Por favor escríbeme la ciudad donde deseas recibir tu pedido.",
  reference: "¿Tienes alguna referencia para facilitar la entrega?",
  referenceFallback: "¿Tienes alguna referencia para facilitar la entrega? (Si no tienes, respóndeme *no*.)",
  payment: "¿Cómo deseas pagar?",
  summaryPrompt: "¿Confirmas tu pedido?",
  summaryFallback: "Respóndeme *confirmar*, *modificar* o *cancelar*.",
  chooseOption: "Para continuar, elige una opción:",
  /** "sí", "confirmo", "ok"… en el resumen: solo el botón registra el pedido (acción inequívoca). */
  tapToConfirm: "Para registrar tu pedido toca el botón ✅ Confirmar pedido.",
  confirmed: (business: string | null, note?: string | null, storeAddress?: string | null) =>
    `✅ Tu pedido quedó registrado correctamente.\n\nUna asesora continuará contigo para coordinar el pago y los siguientes pasos.${note ? `\n\n${note}` : ""}${storeAddress ? `\n\n📍 Te esperamos en: ${storeAddress}` : ""}\n\n${business ? `Gracias por comprar en ${business} 💖` : "¡Gracias por tu compra! 💖"}`,
  alreadyConfirmed: "✅ Tu pedido ya quedó registrado. Una asesora continuará contigo para coordinar el pago y los siguientes pasos.",
  modify: "Claro 😊 Tus productos siguen guardados.\n\nDime qué deseas cambiar (agregar, quitar o cambiar cantidades). Cuando quieras terminar, escríbeme *finalizar pedido*.",
  cancelled: "Listo, cancelé el registro de tu pedido: no quedó ninguna compra ni reserva.\n\nTus productos siguen guardados por si quieres retomarlo; escríbeme *finalizar pedido* cuando quieras.",
  stale: "Ese resumen ya no está vigente. Escríbeme *finalizar pedido* y te muestro el resumen actualizado.",
  updatedSummary: "Te comparto el resumen actualizado:",
  // --- Bloque 28: lenguaje humano dentro del checkout (fijos, sin IA) ---
  /** Pregunta que el asistente no pudo responder con datos verificados: nunca se inventa. */
  questionFallback: "Ese detalle te lo confirma una asesora apenas registremos tu pedido 😊",
  waiting: "Claro, aquí te espero 😊",
  productsViaModify: "Para agregar otros productos escríbeme *modificar pedido* (lo que ya elegiste se conserva). Si solo quieres cambiar cantidades, dime cuántas y de cuál producto.",
  whichProduct: (c: { tipo: "fijar" | "sumar" | "restar" | "quitar"; n: number }, lines: ReadonlyArray<{ product_name: string; quantity: number }>) =>
    `${c.tipo === "quitar" ? "Claro. ¿Cuál producto quieres quitar?" : c.tipo === "fijar" ? `Claro. ¿De cuál producto quieres ${c.n} ${c.n === 1 ? "unidad" : "unidades"}?` : "Claro. ¿De cuál producto?"}\n\n${lines
      .map((l, i) => `${i + 1}. ${l.product_name} (${l.quantity})`)
      .join("\n")}\n\nRespóndeme con el número.`,
  onlyProduct: "Ese es el único producto de tu pedido. Si ya no lo quieres, toca ❌ Cancelar; si quieres seguir, continuemos 😊",
  updated: "Listo, actualicé tu pedido ✨",
  noChange: (name: string, qty: number) => `Tu pedido ya tiene ${qty} ${qty === 1 ? "unidad" : "unidades"} de ${name}.`,
  noted: (c: { entrega?: DeliveryType; pago?: PaymentMethod }) =>
    [c.entrega ? ENTREGA_INFO[c.entrega].anotado : null, c.pago ? PAGO_INFO[c.pago].anotado : null].filter(Boolean).join("\n"),
  addressVague: "Para que llegue sin problema necesito la dirección exacta: calle o carrera, número y barrio 📍",
  addressAnnounce: "Claro, envíamela cuando quieras 😊",
  referenceAsk: "Claro, escríbeme la referencia (por ejemplo: portón azul, frente al parque).",
  /** Ubicación compartida en el paso de la dirección (Bloque 28): se pide escrita, sin pasar a una asesora. */
  locationNeedsText: "Recibí tu ubicación 📍, pero para registrar el pedido necesito la dirección escrita: calle o carrera, número y barrio.",
  /** Foto o documento en el paso de la dirección o la ciudad (p. ej. captura de la dirección): se pide escrito. */
  mediaNeedsText: (step: "address" | "city") =>
    step === "address"
      ? "Recibí tu archivo 📎, pero para registrar el pedido necesito la dirección escrita: calle o carrera, número y barrio."
      : "Recibí tu archivo 📎, pero para registrar el pedido necesito que me escribas la ciudad.",
  notConfirmed: "Tu pedido NO quedó confirmado y no se reservó nada. Dime qué deseas cambiar y te ayudo.",
  /** Falla conocida (nada se escribió). */
  failed: "Disculpa, no pude registrar tu pedido en este momento; no quedó confirmado. ¿Me escribes de nuevo en un momento?",
  /** Resultado desconocido (la escritura pudo quedar hecha): ni "listo" ni "falló". */
  pending: "Estoy verificando el estado de tu pedido. Escríbeme de nuevo en un momento y te confirmo cómo quedó.",
} as const;

/** "a", "a o b", "a, b o c". */
const listaO = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} o ${xs[xs.length - 1]}`);
const negrita = (s: string) => `*${s}*`;

/**
 * Textos FIJOS (sin IA) que enumeran lo que el negocio OFRECE. Salen de sus opciones: nunca nombran
 * un método que no ofrece. Los que el negocio escribió (`mensajes`) van tal cual.
 */
/** Fase 3B.4 — entregas que se MENCIONAN: la oficina "solo si el cliente la pide" (D2) nunca se ofrece sola. */
export function entregasVisibles(o: CheckoutOpciones): CheckoutOpciones["entregas"] {
  return o.oficina?.oferta === "solo_si_cliente_pide" ? o.entregas.filter((e) => e !== "oficina_transportadora") : o.entregas;
}

export function checkoutOptionTexts(o: CheckoutOpciones) {
  const m = o.mensajes ?? {};
  const entregas = entregasVisibles(o).map((e) => ENTREGA_INFO[e].palabra);
  const pagos = (entrega: DeliveryType | null) => pagosPara(o, entrega).map((p) => PAGO_INFO[p].palabra);
  const cambiables = [...(entregas.length > 1 ? entregas : []), ...(pagos(null).length > 1 ? pagos(null) : [])];
  return {
    deliveryFallback: `${CHECKOUT_MESSAGES.delivery} Respóndeme ${listaO(entregas.map(negrita))}.`,
    /** "Respóndeme *a* o *b*." con los pagos de ESA entrega. */
    paymentChoices: (entrega: DeliveryType | null) => `Respóndeme ${listaO(pagos(entrega).map(negrita))}.`,
    doubt:
      m.duda ??
      `Claro 😊 ¿Qué quieres cambiar? ${cambiables.length > 0 ? `Puedes escribirme, por ejemplo, ${listaO(cambiables.map(negrita))}. ` : ""}Para cambiar cantidades dime cuántas y de cuál producto.`,
    /** Pidió un pago que no se ofrece con su entrega. */
    paymentUnavailable: (pedido: PaymentMethod, entrega: DeliveryType | null) =>
      m.pago_no_disponible ?? `Por ahora no manejamos ${PAGO_INFO[pedido].nombre} 🙏 Puedes pagar con ${listaO(pagos(entrega).map(negrita))}.`,
    /** Pidió una entrega que el negocio no ofrece. */
    deliveryUnavailable: (pedida: DeliveryType) => `Por ahora no manejamos ${ENTREGA_INFO[pedida].palabra} 🙏 Podemos hacerlo por ${listaO(entregas.map(negrita))}.`,
    deliveryHint: m.recordatorio_entrega ?? `Escríbeme si prefieres ${listaO(entregas.map(negrita))}.`,
    paymentHint: (entrega: DeliveryType | null) => m.recordatorio_pago ?? `Escríbeme cómo pagas: ${listaO(pagos(entrega).map(negrita))}.`,
  };
}

// ---------------------------------------------------------------------------
// Lectura determinista de lo que escribió el cliente
// ---------------------------------------------------------------------------

/** Minúsculas, sin tildes ni signos/emojis, un espacio. */
const bare = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const ENTREGA_POR_ID = new Map<string, DeliveryType>(Object.entries(DELIVERY_BUTTONS).map(([e, b]) => [b.id, e as DeliveryType]));
const PAGO_POR_ID = new Map<string, PaymentMethod>(Object.entries(PAYMENT_BUTTONS).map(([p, b]) => [b.id, p as PaymentMethod]));
/** Títulos del resumen y de la referencia (iguales para todos los negocios). */
const FIXED_TITLES = new Map<string, string>(Object.values(CHECKOUT_BUTTONS).flatMap((list) => list.map((b) => [bare(b.title), b.id] as const)));

/**
 * Botones que ESTE negocio puede haber enviado: sus entregas, sus pagos, la referencia y el resumen.
 * Fase 3B.4: con aceptación, los suyos (nunca "Confirmar pedido": ese botón no existe en ese flujo).
 */
function offeredButtons(o: CheckoutOpciones): Button[] {
  if (cierreConAceptacion(o)) {
    return [...deliveryButtons(o), ...paymentButtons(o, null), ...ACEPTACION_BUTTONS.phone, ...ACEPTACION_BUTTONS.summary, ...CAMPOS_CORREGIBLES.map(({ id, title }) => ({ id, title }))];
  }
  return [...deliveryButtons(o), ...paymentButtons(o, null), ...Object.values(CHECKOUT_BUTTONS).flat()];
}

/**
 * Id de botón del checkout: el que llegó, o el del título EXACTO (el buzón guarda solo el texto). Solo
 * botones de lo que el negocio ofrece: el título de un método que no ofrece no es un botón.
 */
function buttonOf(text: string, buttonId: string | null | undefined, o: CheckoutOpciones): string | null {
  const offered = offeredButtons(o);
  if (buttonId && buttonId.startsWith("checkout_")) return offered.some((b) => b.id === buttonId) ? buttonId : null;
  const t = bare(text);
  return offered.find((b) => bare(b.title) === t)?.id ?? null;
}

/** ¿Es el texto/id de un botón del checkout de este negocio? (un clic en un resumen viejo fuera del checkout) */
export function isCheckoutButton(text: string, buttonId: string | null | undefined, o: CheckoutOpciones): boolean {
  return buttonOf(text, buttonId, o) !== null;
}

/**
 * Nombre escrito por el cliente ("Laura Gómez", "me llamo Laura", "es Duvan", "a nombre de Laura").
 * Bloque 28: nunca un teléfono, una intención ("quiero dos aretes"), una pregunta, una risa ni un "ok".
 */
export function parseCustomerName(text: string, vocabulario: Vocabulario = VOCABULARIO_NEUTRAL): string | null {
  return leerNombre(text, vocabulario);
}

/** Nombre guardado confiable: con letras, sin ser (ni contener) un número de teléfono ni palabras que no son de un nombre. */
export function isTrustedName(name: string | null | undefined, vocabulario: Vocabulario = VOCABULARIO_NEUTRAL): name is string {
  const t = (name ?? "").trim();
  if (t.length < 2 || t.length > 60) return false;
  if (!/\p{L}/u.test(t)) return false;
  if ((t.match(/\d/g) ?? []).length >= 3) return false;
  return sinIntencionDeNombre(t, vocabulario);
}

/** Entrega elegida, solo entre las que ofrece el negocio. */
export function parseDelivery(text: string, o: CheckoutOpciones, buttonId: string | null = null): DeliveryType | null {
  const b = buttonOf(text, buttonId, o);
  const porBoton = b ? ENTREGA_POR_ID.get(b) : undefined;
  if (porBoton) return porBoton;
  const e = leerEntrega(text);
  return e && ofreceEntrega(o, e) ? e : null;
}

/** Pago elegido, solo entre los que ofrece el negocio. `entrega` resuelve "cuando llegue" / "contra entrega" (si no se ofrece => null). */
export function parsePayment(text: string, o: CheckoutOpciones, buttonId: string | null = null, entrega: DeliveryType | null = null): PaymentMethod | null {
  const b = buttonOf(text, buttonId, o);
  const porBoton = b ? PAGO_POR_ID.get(b) : undefined;
  if (porBoton) return porBoton;
  const p = leerPago(text, entrega, o);
  return p === "no_disponible" ? null : p;
}

/**
 * Confirmar es SOLO el botón (su id o su título exacto: el buzón de producción guarda el texto).
 * "sí", "confirmo", "ok", "dale" NO confirman un pedido real: el backend pide tocar el botón.
 */
const CONFIRM_TITLE = bare(CHECKOUT_BUTTONS.summary[0].title);
const MODIFY_WORDS = new Set(["modificar pedido", "modificar", "modificar mi pedido", "quiero modificar", "quiero modificar el pedido", "cambiar pedido", "cambiar mi pedido"]);
const CANCEL_WORDS = new Set(["cancelar", "cancelar pedido", "cancela", "cancelar mi pedido", "cancelar el pedido", "quiero cancelar", "cancelalo"]);

/**
 * Qué eligió el cliente frente al resumen. ESTRICTO: confirmar = el botón (id o título exacto; una
 * ráfaga de dos clics iguales cuenta como uno). Modificar / cancelar: el botón o la palabra exacta.
 */
export function parseSummaryAction(text: string, buttonId?: string | null): "confirm" | "modify" | "cancel" | null {
  const one = (b: string | null, t: string) =>
    b === "checkout_confirmar" || t === CONFIRM_TITLE ? "confirm" : b === "checkout_modificar" || MODIFY_WORDS.has(t) ? "modify" : b === "checkout_cancelar" || CANCEL_WORDS.has(t) ? "cancel" : null;
  if (buttonId && buttonId.startsWith("checkout_")) return one(buttonId, "");
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  // Una pregunta ("¿sí?") nunca es una decisión.
  if (lines.length === 0 || lines.length > 4 || /[?¿]/.test(text)) return null;
  const actions = new Set(lines.map((l) => one(FIXED_TITLES.get(bare(l)) ?? null, bare(l))));
  return actions.size === 1 ? ([...actions][0] ?? null) : null;
}

/** En cualquier paso: el cliente cancela o quiere modificar (nunca "sí"). Bloque 28: también "cancela porfa", "ya no quiero", "mejor quiero otro". */
export function parseEscape(text: string, buttonId?: string | null): "modify" | "cancel" | null {
  const a = parseSummaryAction(text, buttonId);
  if (a === "confirm") return null;
  if (a) return a;
  if (buttonId && buttonId.startsWith("checkout_")) return null;
  const s = leerSalida(text);
  return s === "cancel" || s === "modify" ? s : null;
}

const ENTRY = [
  /^(quiero |me gustaria |deseo |vamos a |voy a |puedo |como puedo |como hago para )?(finalizar|terminar|cerrar|completar|hacer|realizar|confirmar|registrar)( (el|mi|la|este|esta|ese|esa))? (pedido|compra|orden)( (por favor|ya|ahora))?$/,
  /^(si )?(quiero|deseo) (comprar|pedir|llevar)(lo|la|los|las|melo|mela|melos|melas)?( (eso|esto|todo|todos|ya|ahora|por favor))*$/,
  /^(si )?(me )?(lo|la|los|las) llevo( (todo|todos|ya|por favor))*$/,
  /^(como|donde) (pago|puedo pagar|hago el pedido|hago la compra)$/,
  /^(quiero )?(comprar|pagar|finalizar)( pedido| compra)?$/,
];

/** Frase FIJA de "quiero comprar lo que tengo" (sin productos nuevos). */
export function wantsCheckout(text: string): boolean {
  // Bloque 28: sobre el texto NORMALIZADO ("kiero el pedido", "QUIEROOO COMPRAR", "hagamos el pedido").
  const t = normalizar(text).replace(/^(hola|buenas|buenos dias|buenas tardes|buenas noches|ok|listo|perfecto|dale|bueno)( |$)/, "").trim();
  return (t.length > 0 && t.length <= 60 && ENTRY.some((re) => re.test(t))) || pideElPedido(text);
}

function freeText(text: string, min: number, max: number): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length < min || t.length > max) return null;
  if (!/[\p{L}\p{N}]/u.test(t)) return null;
  return t;
}
const NO_REFERENCE = new Set(["no", "nop", "ninguna", "ninguno", "no tengo", "sin referencia", "no hay", "nada", "no gracias", "asi esta bien", "no tengo referencia", "no ninguna", "no hay referencia", "ninguna referencia", "sin", "no necesito"]);

// ---------------------------------------------------------------------------
// Fase 3B.4 — lectura determinista del checkout CON ACEPTACIÓN (sin modelo)
// ---------------------------------------------------------------------------

const palabras = (s: string) => s.trim().split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length;

const MISMO_NUMERO = /^(si |es )?(el |este |ese )?(mismo|mismito)( numero| celular| whatsapp)?$|^(este|ese) (numero|celular|whatsapp)$|^(al|el) que (te )?escribo$|^(desde )?el (de|del) (whatsapp|chat)$|^(el )?(mismo|este) (de|del) (whatsapp|chat)$/;

/** Teléfono para la entrega: "este mismo" (si el negocio lo acepta) => el WhatsApp del cliente; si no, un celular válido. */
export function leerTelefono(text: string, opts: { aceptaMismo: boolean; waId: string; buttonId?: string | null }): { telefono: string } | { error: "invalido" | "escribelo" } {
  const t = normalizar(text);
  const mismo = opts.buttonId === "checkout_mismo_numero" || MISMO_NUMERO.test(t);
  if (mismo) {
    if (!opts.aceptaMismo) return { error: "escribelo" };
    const propio = normalizarCelular(`+${opts.waId}`) ?? (/^[0-9]{7,15}$/.test(opts.waId) ? opts.waId : null);
    return propio ? { telefono: propio } : { error: "escribelo" };
  }
  const n = normalizarCelular(text);
  return n ? { telefono: n } : { error: "invalido" };
}

/** Barrio (o vereda / sector): texto libre con letras; nunca una pregunta, un relleno ni un "no". */
export function leerBarrio(text: string): string | null {
  const raw = text.trim().replace(/\s+/g, " ").replace(/^(el |mi )?barrio( es| se llama)?:?\s*/i, "").replace(/^(en el|en la|en)\s+/i, "").trim();
  if (!raw || esPregunta(raw) || esRelleno(raw) || NO_REFERENCE.has(normalizar(raw))) return null;
  return freeText(raw, 2, 80) && /\p{L}{2,}/u.test(raw) ? raw : null;
}

/** Oficina de la transportadora: texto libre, guardado TAL CUAL lo escribe el cliente (D2: no hay catálogo de oficinas). */
export function leerOficina(text: string): string | null {
  const raw = text.trim().replace(/\s+/g, " ");
  if (!raw || esPregunta(raw) || esRelleno(raw) || NO_REFERENCE.has(normalizar(raw))) return null;
  return freeText(raw, 2, 160) && /\p{L}|\d/u.test(raw) ? raw : null;
}

/** Número de documento escrito por el cliente: solo las partes con dígitos ("mi cédula es 1.020.345.678" => "1.020.345.678"). */
export function extraerDocumento(text: string): string {
  return text
    .split(/\s+/)
    .filter((w) => /\d/.test(w))
    .join("");
}

/** El cliente se niega (o no puede) dar el documento: el checkout NO sigue solo (pasa a una persona). */
export function niegaDocumento(text: string): boolean {
  const t = normalizar(text);
  if (/^(no|nop|nel|no gracias|no se puede|eso no|mejor no|prefiero que no)$/.test(t)) return true;
  if (/\bprefiero no\b/.test(t)) return true;
  if (/\bno (tengo|cuento con|manejo) (la |el |mi )?(cedula|documento|identificacion|cc)\b/.test(t)) return true;
  return /\bno (te |le |les |se )?(lo |la )?(voy a |quiero |puedo |pienso )?(dar|doy|enviar|envio|mandar|mando|compartir|comparto|pasar|paso|entregar|entrego|suministrar)\b/.test(t);
}

/**
 * Un medio de pago que el negocio NO ofrece (transferencia, Nequi, Daviplata, PSE, link de pago…), aunque
 * venga como pregunta ("¿puedo pagar por Nequi?"): se responde con lo que sí ofrece, sin pasar por el
 * modelo (nunca datos de cuentas). "efectivo" no cuenta: contra entrega también se paga en efectivo.
 */
export function pagoNoOfrecido(text: string, o: CheckoutOpciones): PaymentMethod | null {
  const t = ` ${normalizar(text)} `;
  const ofrecidos = pagosPara(o, null);
  for (const metodo of ["transferencia", "link_pago"] as const) {
    if (!ofrecidos.includes(metodo) && PAGO[metodo].some((f) => t.includes(` ${f} `))) return metodo;
  }
  return null;
}

/**
 * Fase 3B.9A — pago ANTICIPADO (anticipo, adelanto, abono, "pagar antes"…). Solo es "no ofrecido" cuando el negocio no ofrece ningún
 * medio que se pague antes del envío (transferencia o link de pago): un negocio solo contra entrega o en tienda no recibe anticipos.
 */
const ANTICIPO = /\b(anticipo|anticipos|anticipado|anticipada|adelanto|adelantado|adelantada|abono|abonar|abono inicial|por adelantado|pagar antes|pago antes|pagarte antes|separar con|dejar sena|una sena|la sena)\b/;

/**
 * Respuesta FIJA (sin modelo) a quien pide un medio de pago que el negocio NO ofrece (Nequi, Daviplata, transferencia, link de pago,
 * anticipo…) FUERA del checkout. null = el mensaje no pide eso. Sale de la configuración del negocio (sus métodos ofrecidos o su texto
 * de "pago no disponible"): nunca nombra un método que el negocio no ofrece como disponible, ni datos de cuentas.
 */
export function respuestaPagoNoOfrecido(text: string, o: CheckoutOpciones): string | null {
  const metodo = pagoNoOfrecido(text, o);
  if (metodo) return checkoutOptionTexts(o).paymentUnavailable(metodo, null);
  const ofrecidos = pagosPara(o, null);
  if (ofrecidos.includes("transferencia") || ofrecidos.includes("link_pago")) return null;
  if (!ANTICIPO.test(normalizar(text))) return null;
  return o.mensajes?.pago_no_disponible ?? `Por ahora no manejamos pagos anticipados 🙏 Puedes pagar con ${listaO(ofrecidos.map((p) => PAGO_INFO[p].palabra).map(negrita))}.`;
}

/** Texto sin números largos (para una pregunta hecha en el paso del documento: el documento nunca va al modelo). */
const sinNumeros = (text: string) => text.replace(/\d[\d.\s-]{3,}\d/g, "[número]");

/**
 * El cliente PIDE recibir en una oficina de la transportadora (D2: solo así se ofrece). Estricto para no
 * confundir "oficina 301" de una dirección: el nombre de la transportadora o "reclamar/recoger en oficina".
 */
export function pideOficina(text: string, o: CheckoutOpciones): boolean {
  if (!o.oficina || !o.entregas.includes("oficina_transportadora")) return false;
  const t = normalizar(text);
  const nombre = normalizar(o.oficina.transportadora);
  if (nombre.length >= 4 && (t.includes(nombre) || t.replace(/\s+/g, "").includes(nombre.replace(/\s+/g, "")))) return true;
  if (/\b(reclamar|reclamo|reclamarlo|reclamarla|recoger|recojo|recogerlo|recogerla|retirar|retiro|retirarlo|retirarla|ir por el|ir a buscarlo)\b[^.?!]{0,30}\boficina\b/.test(t)) return true;
  if (/\b(envi\w*|mand\w*|dej\w*|que llegue|lo llevan|llevenlo)\b[^.?!]{0,20}\b(a|en) (la |una )?oficina\b/.test(t)) return true;
  return /^(en |a |por )?(la |una )?oficina( de la transportadora| de envios)?$/.test(t);
}

/** Qué eligió el cliente frente al resumen CON ACEPTACIÓN: datos correctos, corregir o cancelar (nunca "sí" a secas). */
export function parseResumenAceptacion(text: string, buttonId?: string | null): "ok" | "fix" | "cancel" | null {
  if (buttonId === "checkout_datos_correctos") return "ok";
  if (buttonId === "checkout_corregir") return "fix";
  if (buttonId === "checkout_cancelar") return "cancel";
  if (buttonId && buttonId.startsWith("checkout_")) return null;
  if (/[?¿]/.test(text)) return null;
  const t = normalizar(text);
  if (t === bare(ACEPTACION_BUTTONS.summary[0].title)) return "ok";
  if (t === bare(ACEPTACION_BUTTONS.summary[1].title)) return "fix";
  if (/^(si |ya )?(mis |los )?datos (estan |son )?(correctos|bien)( todo)?$/.test(t) || /^(si )?(todo )?(esta |estan )?(todo )?(correcto|correctos)$/.test(t) || /^(si )?todo (esta )?bien$/.test(t)) return "ok";
  if (/^(quiero |necesito |deseo )?(corregir|cambiar|modificar|arreglar) (un |algun |unos |los |mis |el |la )?dato(s)?$/.test(t) || /^(quiero )?corregir$/.test(t)) return "fix";
  return CANCEL_WORDS.has(t) ? "cancel" : null;
}

/** Qué dato quiere corregir (botón de la lista o la palabra). */
function campoACorregir(text: string, buttonId: string | null | undefined, o: CheckoutOpciones, ck: CheckoutState): CampoCorregible | null {
  const disponibles = camposCorregibles(o, ck);
  const porBoton = buttonId ? disponibles.find((c) => c.id === buttonId) : undefined;
  if (porBoton) return porBoton.campo;
  const t = normalizar(text).replace(/^(quiero |el |la |mi |corregir |cambiar )+/, "").trim();
  const porTexto = disponibles.find((c) => bare(c.title) === t || c.palabras.includes(t));
  return porTexto?.campo ?? null;
}

/** Datos corregibles de ESTE checkout (según la entrega y lo que pide el negocio). */
function camposCorregibles(o: CheckoutOpciones, ck: CheckoutState) {
  const oficina = ck.delivery === "oficina_transportadora";
  return CAMPOS_CORREGIBLES.filter((c) => {
    if (c.campo === "phone") return o.campos?.telefono?.modo === "requerido";
    if (c.campo === "department") return o.campos?.departamento === true;
    if (c.campo === "address") return !oficina || o.oficina?.pide_direccion === true;
    if (c.campo === "neighborhood") return oficina ? o.oficina?.pide_barrio === true : o.campos?.barrio === true;
    if (c.campo === "office") return oficina;
    if (c.campo === "document") return oficina && o.oficina?.documento.modo === "requerido";
    return true;
  });
}

// ---------------------------------------------------------------------------
// Resumen (del motor, nunca de la IA)
// ---------------------------------------------------------------------------

/**
 * Datos completos del checkout, o null. Con `o`, además, la entrega y el pago deben estar entre los que
 * el negocio OFRECE (la última verificación del backend antes de registrar el pedido).
 */
export function checkoutData(ck: CheckoutState, o?: CheckoutOpciones): CheckoutData | null {
  if (!ck.customerName || !ck.delivery || !ck.paymentMethod) return null;
  if (o && (!ofreceEntrega(o, ck.delivery) || !pagoPermitido(o, ck.paymentMethod, ck.delivery))) return null;
  if (ck.delivery === "domicilio" && (!ck.address || !ck.city)) return null;
  const oficina = ck.delivery === "oficina_transportadora";
  if (oficina && (!ck.office || !ck.city)) return null;
  // Fase 3B.4 — con aceptación: los datos que el negocio exige (sin ellos no hay resumen ni envío).
  if (o && cierreConAceptacion(o) && nextStepAceptacion(ck, o) !== "summary") return null;
  return {
    customerName: ck.customerName,
    paymentMethod: ck.paymentMethod,
    delivery: ck.delivery,
    address: ck.delivery === "domicilio" || (oficina && o?.oficina?.pide_direccion) ? ck.address : null,
    city: ck.delivery === "domicilio" || oficina ? ck.city : null,
    deliveryReference: ck.delivery === "domicilio" ? ck.deliveryReference : null,
    // Solo si existen (los pedidos de siempre quedan idénticos).
    ...(ck.phone ? { contactPhone: ck.phone } : {}),
    ...(ck.department ? { department: ck.department } : {}),
    ...(ck.neighborhood ? { neighborhood: ck.neighborhood } : {}),
    ...(oficina && ck.office ? { carrierOffice: ck.office } : {}),
  };
}

/** Bloque 32: textos del negocio para el checkout (config `negocio.pedido`). Todo opcional. */
export interface CheckoutTexts {
  paymentQuestion?: string;
  shippingNote?: string;
  /** Compra INICIAL mayorista (COP): la primera compra de un mayorista no se registra por debajo. */
  wholesaleMinimum?: number;
  confirmedNote?: string;
  /** Dirección de la tienda (resumen y mensaje final cuando recoge en tienda). */
  storeAddress?: string;
}

/** Mensaje FIJO cuando la primera compra mayorista no llega al mínimo (el pedido no se registra). */
export const wholesaleMinimumBlocked = (total: number, minimum: number) =>
  `Tu pedido suma *${formatCop(total)}* 💎\n\nPara tu primera compra al por mayor, el pedido mínimo es de *${formatCop(minimum)}*: te faltan *${formatCop(minimum - total)}*.\n\nTus productos siguen guardados: puedes agregar más referencias y, cuando quieras, escríbeme *finalizar pedido*. Si prefieres, te comunico con una asesora ✨`;

export function summaryText(order: OrderPublicView, data: CheckoutData, texts: CheckoutTexts = {}): string {
  const lines = order.lines.map((l) => `• ${l.product_name} (${l.reference}) × ${l.quantity} — ${l.subtotal === null ? "precio a consultar" : formatCop(l.subtotal)}`);
  const out = [`📋 *Resumen de tu pedido* (${order.order_id})`, "", ...lines, "", `*Total: ${formatCop(order.total)}*`];
  if (order.unpriced_units > 0) out.push("Algunos productos tienen precio a consultar: una asesora te confirma su valor.");
  out.push("", `👤 A nombre de: ${data.customerName}`);
  if (data.delivery === "tienda") {
    out.push(ENTREGA_INFO.tienda.resumen);
    if (texts.storeAddress) out.push(`📍 Dirección de la tienda: ${texts.storeAddress}`);
  }
  else {
    out.push(ENTREGA_INFO.domicilio.resumen, `📍 Dirección: ${data.address}, ${data.city}`);
    if (data.deliveryReference) out.push(`📝 Referencia: ${data.deliveryReference}`);
  }
  out.push(`💳 Pago: ${PAGO_INFO[data.paymentMethod].resumen}`);
  if (data.delivery === "domicilio" && texts.shippingNote) out.push(`🚚 ${texts.shippingNote}`);
  return out.join("\n");
}

/** "573001234567" => "300 123 4567" (Colombia); otro país: +indicativo. */
function telefonoLegible(t: string): string {
  return /^573\d{9}$/.test(t) ? `${t.slice(2, 5)} ${t.slice(5, 8)} ${t.slice(8)}` : `+${t}`;
}

/**
 * Fase 3B.4 — resumen del checkout CON ACEPTACIÓN: productos y total DEL MOTOR, todos los datos del
 * pedido, documento ENMASCARADO, pago y envío. No marca nada como venta.
 */
export function summaryTextAceptacion(order: OrderPublicView, data: CheckoutData, ck: CheckoutState, o: CheckoutOpciones, texts: CheckoutTexts = {}): string {
  const cierre = cierreConAceptacion(o);
  const lines = order.lines.map((l) => `• ${l.product_name} (${l.reference}) × ${l.quantity} — ${l.subtotal === null ? "precio a consultar" : formatCop(l.subtotal)}`);
  const titulo = cierre?.mostrar_numero_pedido ? `📋 *Resumen de tu pedido* (${order.order_id})` : "📋 *Resumen de tu pedido*";
  const out = [titulo, "", ...lines, "", `*Total: ${formatCop(order.total)}*`];
  if (order.unpriced_units > 0) out.push("Algunos productos tienen precio a consultar: nuestro equipo te confirma su valor.");
  out.push("", `👤 Nombre: ${data.customerName}`);
  if (data.contactPhone) out.push(`📱 Teléfono: ${telefonoLegible(data.contactPhone)}`);
  out.push(`📍 Ciudad: ${data.city}${data.department ? `, ${data.department}` : ""}`);
  if (data.delivery === "oficina_transportadora") {
    out.push(`📦 Entrega: reclamar en una oficina de ${o.oficina?.transportadora ?? "la transportadora"}`, `🏢 Oficina: ${data.carrierOffice}`);
    if (data.address) out.push(`🏡 Dirección: ${data.address}`);
    if (data.neighborhood) out.push(`🏘️ Barrio: ${data.neighborhood}`);
    if (ck.document) out.push(`🪪 Documento: ${maskDocument(ck.document.last4)}`);
  } else {
    out.push(ENTREGA_INFO.domicilio.resumen, `🏡 Dirección: ${data.address}`);
    if (data.neighborhood) out.push(`🏘️ Barrio: ${data.neighborhood}`);
  }
  out.push(`💳 Pago: ${PAGO_INFO[data.paymentMethod].resumen}`);
  if (texts.shippingNote) out.push(`🚚 ${texts.shippingNote}`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Máquina de estados
// ---------------------------------------------------------------------------

export interface CheckoutIO {
  engine: Pick<OrderEngine, "validateOrder" | "confirmOrder" | "cancelProposal" | "getOrder" | "createOrder"> &
    Partial<Pick<OrderEngine, "hasPurchase" | "submitForAcceptance" | "recordAcceptanceNotice">>;
  /**
   * Fase 3B.4 — políticas del envío a aceptación (de la configuración del negocio, explícitas). Sin ellas
   * el checkout con aceptación NO registra nada (fail-closed; nunca cae a confirmOrder).
   */
  acceptancePolicy?: AcceptancePolicy | null;
  /** Fase 3B.4 — cifra el documento al recibirlo (producción: lib/crypto.ts). Sin esto, la entrega en oficina pasa a una persona. */
  documentCipher?: DocumentCipher;
  /** Fase 3B.4 — wamid de los mensajes de este turno (el que trae el documento se oculta del historial del modelo). */
  wamids?: readonly string[];
  /**
   * Fase 3B.4 — ¿hay certeza de cobertura para esa ciudad? Lo dará la Fase 3B.6; sin esta función el
   * checkout no consulta nada (nunca inventa cobertura).
   */
  cityCoverage?(city: string): Promise<"cubierta" | "sin_certeza">;
  tenantId: string;
  contact: OrderContact;
  channel: OrderChannel;
  requestId: string;
  turn: number;
  /** Nombre del negocio para el mensaje final (config del negocio; null = genérico). */
  businessName: string | null;
  /** Perfil del negocio: su vocabulario y las entregas/pagos que OFRECE (config explícita, nunca del modelo). */
  perfil: PerfilNegocio;
  /** Bloque 32: textos del negocio (pregunta de pago, nota de envío, mínimo mayorista, nota final). */
  texts?: CheckoutTexts;
  /** Bloque 34: el equipo lo marcó como cliente antiguo (ya compró fuera del bot): sin compra inicial. */
  alreadyCustomer?: () => Promise<boolean>;
  /** Texto enviado (o null si no salió). */
  sendText(text: string): Promise<string | null>;
  /** Botones; si no salen, el texto alternativo. Devuelve lo enviado (o null). */
  sendMenu(body: string, buttons: readonly Button[], fallback: string): Promise<string | null>;
  /** Nombre conocido del cliente (puede ser el teléfono como marcador: se valida aquí). */
  knownName(): Promise<string | null>;
  rememberName?(name: string): Promise<void>;
  /** Pausa la IA en ESTA conversación (una asesora sigue). false = no se pudo. */
  handOff(reason: string): Promise<boolean>;
  /** Bloque 28: wamid del mensaje (idempotencia al rehacer la propuesta por un cambio de cantidad). */
  wamid?: string;
  /**
   * Bloque 28: responde una PREGUNTA del cliente sin tocar el checkout (el modelo, solo con herramientas
   * de LECTURA y el anclaje). null = sin respuesta verificable: se dice que una asesora lo confirma.
   */
  answerQuestion?(text: string, step: CheckoutStep): Promise<string | null>;
}

export type CheckoutAction =
  | "started"
  | "asked"
  | "invalid"
  | "summary"
  | "confirmed"
  | "already_confirmed"
  | "resummarized"
  | "not_confirmed"
  | "modified"
  | "cancelled"
  | "stale"
  | "failed"
  | "pending"
  // Bloque 28
  | "question"
  | "waiting"
  | "doubt"
  | "corrected"
  | "updated"
  | "unchanged"
  | "ask_target"
  | "only_product"
  | "products_via_modify"
  // Fase 3B.4
  | "submitted"
  | "fix"
  | "document_refused"
  | "coverage_handoff"
  | "question_handoff";

export interface CheckoutResult {
  state: ConversationState;
  reply: string | null;
  action: CheckoutAction;
  step: CheckoutStep | null;
  /** true si la conversación quedó en manos de una asesora (IA pausada). */
  handedOff: boolean;
}

const done = (state: ConversationState, reply: string | null, action: CheckoutAction, handedOff = false): CheckoutResult => ({
  state,
  reply,
  action,
  step: state.checkout?.step ?? null,
  handedOff,
});

/**
 * Fase 3B.4 — orden del checkout CON ACEPTACIÓN: nombre completo → teléfono → ciudad → departamento →
 * entrega (domicilio: dirección y barrio · oficina: oficina y documento) → pago → resumen.
 */
function nextStepAceptacion(ck: CheckoutState, o: CheckoutOpciones): CheckoutStep {
  if (!ck.customerName || (o.campos?.nombre_completo && palabras(ck.customerName) < 2)) return "name";
  if (o.campos?.telefono?.modo === "requerido" && !ck.phone) return "phone";
  if (!ck.city) return "city";
  if (o.campos?.departamento && !ck.department) return "department";
  if (!ck.delivery) return "delivery";
  if (ck.delivery === "domicilio") {
    if (!ck.address) return "address";
    if (o.campos?.barrio && !ck.neighborhood) return "neighborhood";
  }
  if (ck.delivery === "oficina_transportadora") {
    if (!ck.office) return "office";
    if (o.oficina?.pide_direccion && !ck.address) return "address";
    if (o.oficina?.pide_barrio && !ck.neighborhood) return "neighborhood";
    if (o.oficina?.documento.modo === "requerido" && !ck.document) return "document";
  }
  if (!ck.paymentMethod) return "payment";
  return "summary";
}

/** El paso que sigue según lo que ya se tiene (orden fijo). Con aceptación, el orden de la Fase 3B.4. */
function nextStep(ck: CheckoutState, o?: CheckoutOpciones): CheckoutStep {
  if (o && cierreConAceptacion(o)) return nextStepAceptacion(ck, o);
  if (!ck.customerName) return "name";
  if (!ck.delivery) return "delivery";
  if (ck.delivery === "domicilio") {
    if (!ck.address) return "address";
    if (!ck.city) return "city";
    if (ck.step === "reference") return "reference";
  }
  if (!ck.paymentMethod) return "payment";
  return "summary";
}

/**
 * Lo que decide el NEGOCIO, no el cliente: un pago que ya no aplica a la entrega elegida se borra (se
 * vuelve a preguntar) y una opción ÚNICA se llena sola (no se pregunta). Con dos o más, nada cambia.
 */
function completar(ck: CheckoutState, o: CheckoutOpciones): CheckoutState {
  let n = ck;
  // Fase 3B.4 (D2): la oficina solo si el cliente la pide; mientras tanto, la entrega es a domicilio.
  if (!n.delivery && o.oficina?.oferta === "solo_si_cliente_pide" && o.entregas.includes("domicilio")) n = { ...n, delivery: "domicilio" };
  if (!n.delivery && o.entregas.length === 1) n = { ...n, delivery: o.entregas[0] };
  if (n.paymentMethod && n.delivery && !pagoPermitido(o, n.paymentMethod, n.delivery)) n = { ...n, paymentMethod: null };
  if (!n.paymentMethod && n.delivery) {
    const pagos = pagosPara(o, n.delivery);
    if (pagos.length === 1) n = { ...n, paymentMethod: pagos[0] };
  }
  return n;
}

async function ask(io: CheckoutIO, step: CheckoutStep, prefix: string | null, entrega: DeliveryType | null): Promise<string | null> {
  // Un prefijo largo (p. ej. una respuesta a una pregunta) va aparte: el cuerpo con botones admite 1024 caracteres.
  if (prefix && prefix.length > 700) {
    const first = await io.sendText(prefix);
    const rest = await ask(io, step, null, entrega);
    return first && rest ? `${first}\n\n${rest}` : (first ?? rest);
  }
  const p = (s: string) => (prefix ? `${prefix}\n\n${s}` : s);
  const o = io.perfil.opciones;
  const t = checkoutOptionTexts(o);
  // Fase 3B.4 — preguntas del checkout con aceptación (los pasos de siempre siguen abajo, sin cambios).
  const cierre = cierreConAceptacion(o);
  if (cierre) {
    const transportadora = o.oficina?.transportadora ?? "la transportadora";
    switch (step) {
      case "name":
        return io.sendText(p(ACEPTACION_MESSAGES.askName));
      case "phone": {
        const mismo = o.campos?.telefono?.modo === "requerido" && o.campos.telefono.acepta_mismo_whatsapp;
        return mismo
          ? io.sendMenu(p(ACEPTACION_MESSAGES.askPhone(true)), ACEPTACION_BUTTONS.phone, p(ACEPTACION_MESSAGES.askPhone(true)))
          : io.sendText(p(ACEPTACION_MESSAGES.askPhone(false)));
      }
      case "city":
        return io.sendText(p(ACEPTACION_MESSAGES.askCity));
      case "department":
        return io.sendText(p(ACEPTACION_MESSAGES.askDepartment));
      case "neighborhood":
        return io.sendText(p(ACEPTACION_MESSAGES.askNeighborhood));
      case "office":
        return io.sendText(p(ACEPTACION_MESSAGES.askOffice(transportadora)));
      case "document":
        return io.sendText(p(ACEPTACION_MESSAGES.askDocument));
      case "summary":
        return io.sendMenu(p(ACEPTACION_MESSAGES.summaryPrompt), ACEPTACION_BUTTONS.summary, p(`${ACEPTACION_MESSAGES.summaryPrompt}\n\n${ACEPTACION_MESSAGES.summaryFallback}`));
      default:
        break;
    }
  }
  switch (step) {
    case "phone":
    case "department":
    case "neighborhood":
    case "office":
    case "document":
      // Solo existen con aceptación (arriba). Defensa: nunca se llega aquí sin ella.
      return io.sendText(p(ACEPTACION_MESSAGES.unavailable));
    case "fix":
      return io.sendText(p(ACEPTACION_MESSAGES.fixWhich));
    case "name":
      return io.sendText(p(CHECKOUT_MESSAGES.askName));
    case "delivery":
      return io.sendMenu(p(CHECKOUT_MESSAGES.delivery), deliveryButtons(o), p(t.deliveryFallback));
    case "address":
      return io.sendText(p(CHECKOUT_MESSAGES.address));
    case "city":
      return io.sendText(p(CHECKOUT_MESSAGES.city));
    case "reference":
      return io.sendMenu(p(CHECKOUT_MESSAGES.reference), CHECKOUT_BUTTONS.reference, p(CHECKOUT_MESSAGES.referenceFallback));
    case "payment": {
      const question = io.texts?.paymentQuestion;
      return question
        ? io.sendMenu(p(question), paymentButtons(o, entrega), p(`${question}\n\n${t.paymentChoices(entrega)}`))
        : io.sendMenu(p(CHECKOUT_MESSAGES.payment), paymentButtons(o, entrega), p(`${CHECKOUT_MESSAGES.payment} ${t.paymentChoices(entrega)}`));
    }
    case "summary":
      return io.sendMenu(p(CHECKOUT_MESSAGES.summaryPrompt), CHECKOUT_BUTTONS.summary, p(`${CHECKOUT_MESSAGES.summaryPrompt} ${CHECKOUT_MESSAGES.summaryFallback}`));
  }
}

/** Los productos del pedido vuelven a la selección (modificar / cancelar / no se pudo confirmar). */
function backToCart(state: ConversationState, order: OrderPublicView | null): ConversationState {
  const cart = order ? order.lines.filter((l) => l.quantity > 0).map((l) => ({ reference: l.reference, quantity: Math.min(l.quantity, 99) })).slice(0, MAX_CART_LINES) : state.cart;
  return { ...state, checkout: null, proposal: null, activeOrderId: null, ambiguity: null, cart };
}

/**
 * Bloque 32 — regla de COMPRA INICIAL mayorista (config `negocio.pedido.minimo_mayorista`): si es la
 * primera compra del contacto (ningún pedido confirmado o completado) y el pedido no llega al mínimo,
 * no se registra. Devuelve el mensaje a enviar, o null si el pedido puede seguir. Si no se puede saber
 * si ya compró, se aplica la regla (la asesora puede atenderlo igual).
 */
async function minimoMayorista(io: CheckoutIO, order: OrderPublicView): Promise<string | null> {
  const minimum = io.texts?.wholesaleMinimum;
  if (!minimum || io.channel !== "wholesale" || order.channel !== "wholesale" || order.total >= minimum) return null;
  const bought =
    (io.engine.hasPurchase ? await io.engine.hasPurchase({ tenantId: io.tenantId, contact: io.contact }).catch(() => false) : false) ||
    (io.alreadyCustomer ? await io.alreadyCustomer().catch(() => false) : false);
  return bought ? null : wholesaleMinimumBlocked(order.total, minimum);
}

/** El pedido no llega a la compra inicial: se anula la propuesta y los productos vuelven al carrito. */
async function blockedByMinimum(io: CheckoutIO, state: ConversationState, order: OrderPublicView, message: string, prefix: string | null = null): Promise<CheckoutResult> {
  await io.engine.cancelProposal({ tenantId: io.tenantId, contact: io.contact, orderId: order.order_id, reason: "minimo_mayorista", requestId: io.requestId }).catch(() => null);
  return done(backToCart(state, order), await io.sendText([prefix, message].filter(Boolean).join("\n\n")), "not_confirmed");
}

/**
 * Empieza el checkout sobre una propuesta del motor (pending_confirmation) de ESTA conversación.
 * El nombre se reutiliza si hay uno confiable (nunca el teléfono).
 */
export async function startCheckout(io: CheckoutIO, state: ConversationState, order: OrderPublicView, textoCompra: string | null = null): Promise<CheckoutResult> {
  // Bloque 32: la primera compra mayorista por debajo del mínimo no empieza el registro.
  const bloqueo = await minimoMayorista(io, order);
  if (bloqueo) return blockedByMinimum(io, state, order, bloqueo);
  const known = await io.knownName().catch(() => null);
  const { vocabulario, opciones } = io.perfil;
  // Bloque 28: lo que el cliente YA dijo en el mismo mensaje ("soy Laura…, domicilio y transferencia") llena
  // campos vacíos; las preguntas del mensaje nunca cuentan. El resumen y el botón siguen siendo obligatorios.
  const pistas = textoCompra ? pistasCheckout(textoCompra, io.perfil) : {};
  const entrega = pistas.entrega && ofreceEntrega(opciones, pistas.entrega) ? pistas.entrega : null;
  let ck: CheckoutState = {
    orderId: order.order_id,
    step: "name",
    // El nombre dado en un checkout anterior de ESTA conversación (se salió con Modificar) va antes que el del contacto.
    customerName: pistas.nombre ?? (isTrustedName(state.checkoutName, vocabulario) ? state.checkoutName : isTrustedName(known, vocabulario) ? known.trim() : null),
    delivery: entrega,
    address: null,
    city: null,
    deliveryReference: null,
    paymentMethod: pistas.pago ?? null,
    summary: null,
    startedTurn: io.turn,
    pendingChange: null,
  };
  ck = completar(ck, opciones);
  ck.step = nextStep(ck, opciones);
  const next: ConversationState = { ...state, checkout: ck, activeOrderId: order.order_id, cart: [], ambiguity: null };
  const intro = cierreConAceptacion(opciones) ? ACEPTACION_MESSAGES.intro : CHECKOUT_MESSAGES.intro;
  if (ck.step === "summary") return summarize(io, next, ck, intro);
  const reply = await ask(io, ck.step, intro, ck.delivery);
  return done(next, reply, "started");
}

/** Resumen desde el MOTOR (re-valida precios/stock y renueva la propuesta si hizo falta). */
async function summarize(io: CheckoutIO, state: ConversationState, ckIn: CheckoutState, prefix: string | null): Promise<CheckoutResult> {
  const ck = completar(ckIn, io.perfil.opciones);
  const data = checkoutData(ck, io.perfil.opciones);
  if (!data) {
    const step = nextStep(ck, io.perfil.opciones);
    const next = { ...state, checkout: { ...ck, step } };
    return done(next, await ask(io, step, prefix, ck.delivery), "asked");
  }
  let order: OrderPublicView;
  const validate = async () => publicView(await io.engine.validateOrder({ tenantId: io.tenantId, contact: io.contact, orderId: ck.orderId, actor: "agent", requestId: io.requestId }));
  try {
    order = await validate();
    // Solo cambió el precio (el motor deja el pedido en borrador con el aviso): se re-valida con el
    // precio nuevo y se muestra el resumen NUEVO explicando el cambio. Stock o productos: no se arregla solo.
    if (order.status === "draft" && order.issues.length > 0 && order.issues.every((i) => i.code === "price_changed")) {
      const aviso = order.issues.map((i) => i.message).join("\n");
      order = await validate();
      if (order.status === "pending_confirmation") prefix = [prefix, `${aviso}\n\n${CHECKOUT_MESSAGES.updatedSummary}`].filter(Boolean).join("\n\n");
    }
  } catch (err) {
    if (!(err instanceof OrderError)) throw err;
    return done({ ...state, checkout: { ...ck, step: "payment" } }, await io.sendText(CHECKOUT_MESSAGES.failed), "failed");
  }
  if (order.channel !== io.channel) {
    // Modalidad congelada: un pedido de otro canal nunca se registra por aquí.
    return done(backToCart(state, null), await io.sendText(CHECKOUT_MESSAGES.failed), "failed");
  }
  if (order.status !== "pending_confirmation" || !order.confirmation) {
    // El catálogo cambió y hay problemas (agotado, retirado…): se explica y no se confirma nada.
    const issues = order.issues.map((i) => i.message).slice(0, 5);
    await io.engine.cancelProposal({ tenantId: io.tenantId, contact: io.contact, orderId: ck.orderId, reason: "checkout_issues", requestId: io.requestId }).catch(() => null);
    const text = [prefix, ...issues, CHECKOUT_MESSAGES.notConfirmed].filter(Boolean).join("\n\n");
    return done(backToCart(state, order), await io.sendText(text), "not_confirmed");
  }
  // Bloque 32: si al revisar el pedido (p. ej. bajó cantidades) queda por debajo de la compra inicial.
  const bloqueo = await minimoMayorista(io, order);
  if (bloqueo) return blockedByMinimum(io, state, order, bloqueo, prefix);
  const nextCk: CheckoutState = { ...ck, step: "summary", summary: { confirmationId: order.confirmation.id, total: order.confirmation.total, turn: io.turn } };
  const next: ConversationState = { ...state, checkout: nextCk, activeOrderId: order.order_id };
  // Fase 3B.4 — con aceptación: resumen completo y validación de DATOS (no es aceptar la compra).
  const cierre = cierreConAceptacion(io.perfil.opciones);
  if (cierre) {
    const head = [prefix, summaryTextAceptacion(order, data, nextCk, io.perfil.opciones, io.texts)].filter(Boolean).join("\n\n");
    if (cierre.validacion_resumen === "sin_validacion") {
      // El negocio eligió no validar: resumen y, enseguida, el aviso y el envío a aceptación.
      const first = await io.sendText(head);
      const r = await enviarAAceptacion(io, next, nextCk, order);
      return { ...r, reply: first && r.reply ? `${first}\n\n${r.reply}` : (first ?? r.reply) };
    }
    const body = `${head}\n\n${ACEPTACION_MESSAGES.summaryPrompt}`;
    if (body.length <= 1000) {
      const reply = await io.sendMenu(body, ACEPTACION_BUTTONS.summary, `${body}\n\n${ACEPTACION_MESSAGES.summaryFallback}`);
      return done(next, reply, "summary");
    }
    const first = await io.sendText(head);
    const menu = await ask(io, "summary", null, ck.delivery);
    return done(next, first && menu ? `${first}\n\n${menu}` : (first ?? menu), "summary");
  }
  const summary = summaryText(order, data, io.texts);
  const head = [prefix, summary].filter(Boolean).join("\n\n");
  const body = `${head}\n\n${CHECKOUT_MESSAGES.summaryPrompt}`;
  // El cuerpo de un mensaje con botones admite 1024 caracteres: un resumen largo va antes, en texto.
  if (body.length <= 1000) {
    const reply = await io.sendMenu(body, CHECKOUT_BUTTONS.summary, `${body} ${CHECKOUT_MESSAGES.summaryFallback}`);
    return done(next, reply, "summary");
  }
  const first = await io.sendText(head);
  const menu = await ask(io, "summary", null, ck.delivery);
  return done(next, first && menu ? `${first}\n\n${menu}` : (first ?? menu), "summary");
}

async function confirm(io: CheckoutIO, state: ConversationState, ck: CheckoutState, order: OrderPublicView): Promise<CheckoutResult> {
  // Fase 3B.4 — con aceptación NUNCA se confirma una venta desde la conversación (defensa: ese botón no existe ahí).
  if (cierreConAceptacion(io.perfil.opciones)) return done(state, await ask(io, "summary", ACEPTACION_MESSAGES.tapDataOk, ck.delivery), "invalid");
  // Entrega y pago entre los que el negocio ofrece (si cambió su configuración, se vuelve a preguntar).
  const data = checkoutData(ck, io.perfil.opciones);
  // Solo el resumen MOSTRADO y vigente se confirma; si el pedido cambió, se muestra el nuevo.
  if (!data || !ck.summary || order.confirmation?.id !== ck.summary.confirmationId || order.confirmation.total !== ck.summary.total) {
    return summarize(io, state, ck, CHECKOUT_MESSAGES.updatedSummary);
  }
  try {
    await io.engine.confirmOrder({
      tenantId: io.tenantId,
      contact: io.contact,
      orderId: ck.orderId,
      confirmationId: ck.summary.confirmationId,
      actor: "agent",
      requestId: io.requestId,
      checkout: data,
      expectedChannel: io.channel,
    });
  } catch (err) {
    if (!(err instanceof OrderError)) {
      // No se sabe si quedó confirmado: nunca "listo" ni "falló". El próximo mensaje ve el estado real.
      return done(state, await io.sendText(CHECKOUT_MESSAGES.pending), "pending");
    }
    if (["PRICE_CHANGED", "OUT_OF_STOCK", "PRODUCT_UNAVAILABLE", "CONFIRMATION_EXPIRED", "CONFIRMATION_MISMATCH", "ORDER_HAS_ISSUES", "REFERENCE_NOT_FOUND"].includes(err.code)) {
      const r = await summarize(io, state, { ...ck, summary: null }, `${err.message}\n\n${CHECKOUT_MESSAGES.updatedSummary}`.trim());
      return { ...r, action: r.action === "summary" ? "resummarized" : r.action };
    }
    return done(state, await io.sendText(CHECKOUT_MESSAGES.failed), "failed");
  }
  return finishConfirmed(io, state);
}

/** Pedido confirmado: se cierra el checkout y una asesora sigue (mensaje FIJO, nunca de la IA). */
async function finishConfirmed(io: CheckoutIO, state: ConversationState): Promise<CheckoutResult> {
  // Bloque 28: el nombre se guarda en el contacto SOLO con el pedido confirmado (antes era un dato en curso).
  const name = state.checkout?.customerName;
  if (name && isTrustedName(name, io.perfil.vocabulario)) await io.rememberName?.(name).catch(() => undefined);
  const next: ConversationState = { ...state, checkout: null, proposal: null, cart: [], ambiguity: null };
  delete next.checkoutName;
  const paused = await io.handOff("pedido confirmado").catch(() => false);
  // Bloque 32: quien recoge en tienda recibe la dirección del local al final.
  const store = state.checkout?.delivery === "tienda" ? io.texts?.storeAddress : undefined;
  const reply = await io.sendText(CHECKOUT_MESSAGES.confirmed(io.businessName, io.texts?.confirmedNote, store));
  return done(paused ? { ...next, handoffTurn: io.turn } : next, reply, "confirmed", paused);
}

/**
 * Fase 3B.4 — el cliente validó sus DATOS: el pedido se ENVÍA A ACEPTACIÓN del negocio. Orden:
 *   1) submitForAcceptance: pending_acceptance con todos los datos. NO es una venta: no llama a
 *      confirmOrder, no hay confirmedAt, etapa, pago ni reserva (salvo política explícita).
 *   2) el aviso obligatorio EXACTO (texto de la configuración, tal cual, sin botones);
 *   3) se registra que el aviso salió (una sola vez);
 *   4) la IA calla en esta conversación (traspaso existente: pausa + Inbox "pendiente"). Asignar y avisar a
 *      la persona responsable es la Fase 3B.5.
 * Se guarda ANTES de enviar: nunca sale un aviso sin pedido detrás. Si el aviso no sale, el pedido queda
 * pendiente con el aviso sin registrar y la conversación igual pasa a una persona.
 * Sin política o sin el motor de aceptación: no se registra nada (fail-closed; nunca cae a confirmOrder).
 */
async function enviarAAceptacion(io: CheckoutIO, state: ConversationState, ck: CheckoutState, order: OrderPublicView): Promise<CheckoutResult> {
  const o = io.perfil.opciones;
  if (!cierreConAceptacion(o) || !io.acceptancePolicy || !io.engine.submitForAcceptance || !io.engine.recordAcceptanceNotice) {
    return done(state, await io.sendText(ACEPTACION_MESSAGES.unavailable), "failed");
  }
  const data = checkoutData(ck, o);
  // Solo el resumen MOSTRADO y vigente: si el pedido cambió, se muestra el nuevo.
  if (!data || !ck.summary || order.confirmation?.id !== ck.summary.confirmationId || order.confirmation.total !== ck.summary.total) {
    return summarize(io, state, ck, CHECKOUT_MESSAGES.updatedSummary);
  }
  try {
    await io.engine.submitForAcceptance({
      tenantId: io.tenantId,
      contact: io.contact,
      orderId: ck.orderId,
      confirmationId: ck.summary.confirmationId,
      checkout: data,
      policy: io.acceptancePolicy,
      document: ck.document ? { type: ck.document.type, sealed: { cipherText: ck.document.cipherText, last4: ck.document.last4 } } : null,
      expectedChannel: io.channel,
      requestId: io.requestId,
    });
  } catch (err) {
    if (!(err instanceof OrderError)) return done(state, await io.sendText(CHECKOUT_MESSAGES.pending), "pending");
    if (["PRICE_CHANGED", "OUT_OF_STOCK", "PRODUCT_UNAVAILABLE", "CONFIRMATION_EXPIRED", "CONFIRMATION_MISMATCH", "ORDER_HAS_ISSUES", "REFERENCE_NOT_FOUND"].includes(err.code)) {
      const r = await summarize(io, state, { ...ck, summary: null }, `${err.message}\n\n${CHECKOUT_MESSAGES.updatedSummary}`.trim());
      return { ...r, action: r.action === "summary" ? "resummarized" : r.action };
    }
    return done(state, await io.sendText(ACEPTACION_MESSAGES.unavailable), "failed");
  }
  return avisoYTraspaso(io, state, ck);
}

/** Fase 3B.4 — el aviso EXACTO, su registro y el traspaso (el pedido ya está pendiente de aceptación). */
async function avisoYTraspaso(io: CheckoutIO, state: ConversationState, ck: CheckoutState): Promise<CheckoutResult> {
  const cierre = cierreConAceptacion(io.perfil.opciones);
  const enviado = cierre ? await io.sendText(cierre.textos.aviso) : null;
  if (enviado) await io.engine.recordAcceptanceNotice?.({ tenantId: io.tenantId, contact: io.contact, orderId: ck.orderId, requestId: io.requestId }).catch(() => null);
  const name = ck.customerName;
  if (name && isTrustedName(name, io.perfil.vocabulario)) await io.rememberName?.(name).catch(() => undefined);
  const paused = await io.handOff("pedido pendiente de aceptación").catch(() => false);
  const next: ConversationState = { ...state, checkout: null, proposal: null, cart: [], ambiguity: null };
  delete next.checkoutName;
  return done(paused ? { ...next, handoffTurn: io.turn } : next, enviado, "submitted", paused);
}

/**
 * Fase 3B.4 — el pedido YA está pendiente de aceptación (la respuesta anterior no alcanzó a guardarse): si
 * el aviso no quedó registrado se envía ahora; si ya salió, solo se cierra el checkout (nada se repite).
 */
async function cerrarYaEnviado(io: CheckoutIO, state: ConversationState, ck: CheckoutState): Promise<CheckoutResult> {
  const actual = await io.engine.getOrder({ tenantId: io.tenantId, contact: io.contact, orderId: ck.orderId, requestId: io.requestId }).catch(() => null);
  if (actual?.acceptance && !actual.acceptance.noticeSentAt) return avisoYTraspaso(io, state, ck);
  const paused = await io.handOff("pedido pendiente de aceptación").catch(() => false);
  const next: ConversationState = { ...state, checkout: null, proposal: null, cart: [], ambiguity: null };
  delete next.checkoutName;
  return done(paused ? { ...next, handoffTurn: io.turn } : next, await io.sendText(ACEPTACION_MESSAGES.alreadySubmitted), "already_confirmed", paused);
}

async function leave(io: CheckoutIO, state: ConversationState, ck: CheckoutState, order: OrderPublicView | null, kind: "modify" | "cancel"): Promise<CheckoutResult> {
  try {
    await io.engine.cancelProposal({ tenantId: io.tenantId, contact: io.contact, orderId: ck.orderId, reason: kind === "modify" ? "checkout_modify" : "checkout_cancelled_by_customer", requestId: io.requestId });
  } catch (err) {
    if (!(err instanceof OrderError)) return done(state, await io.sendText(CHECKOUT_MESSAGES.pending), "pending");
    // Ya confirmado por otro camino: no se cancela por aquí.
    if (err.code === "INVALID_TRANSITION") return done({ ...state, checkout: null }, await io.sendText(CHECKOUT_MESSAGES.alreadyConfirmed), "already_confirmed");
    if (err.code !== "NOT_FOUND") return done(state, await io.sendText(CHECKOUT_MESSAGES.failed), "failed");
  }
  // El nombre se conserva SOLO en esta conversación (no en el contacto) para no volver a pedirlo tras modificar.
  const name = isTrustedName(ck.customerName, io.perfil.vocabulario) ? ck.customerName : state.checkoutName;
  const next: ConversationState = { ...backToCart(state, order), ...(name ? { checkoutName: name } : {}) };
  return done(next, await io.sendText(kind === "modify" ? CHECKOUT_MESSAGES.modify : CHECKOUT_MESSAGES.cancelled), kind === "modify" ? "modified" : "cancelled");
}

// ---------------------------------------------------------------------------
// Bloque 28 — lenguaje humano dentro del checkout
// ---------------------------------------------------------------------------

type Entrega = DeliveryType;
type Pago = PaymentMethod;
type Cambio = { tipo: "fijar" | "sumar" | "restar" | "quitar"; n: number };
type Linea = OrderPublicView["lines"][number];

/** Lo que se le recuerda al cliente en cada paso que no depende del negocio. */
const STEP_HINT: Readonly<Record<Exclude<CheckoutStep, "delivery" | "payment">, string>> = {
  name: "Escríbeme el nombre de la persona a nombre de quien registramos el pedido.",
  address: "Escríbeme la dirección (calle o carrera, número y barrio).",
  city: "Escríbeme la ciudad.",
  reference: "Escríbeme si tienes alguna referencia para la entrega (o *sin referencia*).",
  summary: "Toca ✅ Confirmar pedido, ✏️ Modificar pedido o ❌ Cancelar.",
  // Fase 3B.4 (solo existen en el checkout con aceptación)
  phone: "Escríbeme el número celular para la entrega (o *este mismo*).",
  department: "Escríbeme el departamento.",
  neighborhood: "Escríbeme el barrio.",
  office: "Escríbeme la oficina donde vas a reclamar el pedido.",
  document: "Escríbeme tu número de documento de identidad.",
  fix: "Dime qué dato quieres corregir.",
};

/** Lo que se le recuerda al cliente en cada paso (p. ej. tras una nota de voz): entrega y pago, con lo que el negocio ofrece. */
export function checkoutStepHint(o: CheckoutOpciones, step: CheckoutStep, entrega: DeliveryType | null): string {
  if (step === "delivery") return checkoutOptionTexts(o).deliveryHint;
  if (step === "payment") return checkoutOptionTexts(o).paymentHint(entrega);
  if (cierreConAceptacion(o)) {
    if (step === "summary") return "Toca ✅ Datos correctos, ✏️ Corregir dato o ❌ Cancelar.";
    if (step === "name") return ACEPTACION_MESSAGES.askNameAgain;
    if (step === "city") return ACEPTACION_MESSAGES.cityAgain;
  }
  return STEP_HINT[step];
}

/**
 * Pregunta del cliente: se responde (solo lectura) y se repite la pregunta del paso. Nada cambia.
 * Fase 3B.4: en el paso del documento, los números nunca van al modelo; sin respuesta verificable, el
 * negocio decide (D12): pasar a una persona o seguir con un texto neutro.
 */
async function answerAndRepeat(io: CheckoutIO, state: ConversationState, ck: CheckoutState, text: string): Promise<CheckoutResult> {
  const cierre = cierreConAceptacion(io.perfil.opciones);
  const pregunta = cierre && ck.step === "document" ? sinNumeros(text) : text;
  const answer = io.answerQuestion ? await io.answerQuestion(pregunta, ck.step).catch(() => null) : null;
  if (!answer?.trim() && cierre?.pregunta_sin_respuesta === "handoff_inmediato") {
    const paused = await io.handOff("pregunta sin respuesta verificable durante el registro").catch(() => false);
    if (paused) return done({ ...state, handoffTurn: io.turn }, await io.sendText(ACEPTACION_MESSAGES.questionHandoff), "question_handoff", true);
  }
  const fallback = cierre ? ACEPTACION_MESSAGES.questionFallback : CHECKOUT_MESSAGES.questionFallback;
  return done(state, await ask(io, ck.step, answer?.trim() || fallback, ck.delivery), "question");
}

/**
 * Corrige entrega y/o pago (en cualquier paso) y sigue con lo que falte (o un resumen NUEVO). Lo que el
 * negocio no ofrece no se anota: se dice qué sí ofrece y se repite la pregunta del paso.
 */
async function corregir(io: CheckoutIO, state: ConversationState, ck: CheckoutState, pedido: { entrega?: Entrega; pago?: Pago }): Promise<CheckoutResult> {
  const o = io.perfil.opciones;
  const t = checkoutOptionTexts(o);
  const c: { entrega?: Entrega; pago?: Pago } = {};
  if (pedido.entrega && ofreceEntrega(o, pedido.entrega)) c.entrega = pedido.entrega;
  const entrega = c.entrega ?? ck.delivery;
  if (pedido.pago && pagoPermitido(o, pedido.pago, entrega)) c.pago = pedido.pago;
  if (!c.entrega && !c.pago) {
    const aviso = pedido.entrega && !ofreceEntrega(o, pedido.entrega) ? t.deliveryUnavailable(pedido.entrega) : t.paymentUnavailable(pedido.pago!, ck.delivery);
    return done(state, await ask(io, ck.step, aviso, ck.delivery), "invalid");
  }
  let n: CheckoutState = { ...ck, summary: null, pendingChange: null };
  if (c.entrega) n = cierreConAceptacion(o) ? aplicarEntregaAceptacion(n, c.entrega, o) : c.entrega === "tienda" ? { ...n, delivery: "tienda", address: null, city: null, deliveryReference: null } : { ...n, delivery: "domicilio" };
  if (c.pago) n = { ...n, paymentMethod: c.pago };
  n = completar(n, o);
  const step = nextStep(n, o);
  const prefix = c.entrega === "oficina_transportadora" && o.oficina ? [ACEPTACION_MESSAGES.officeNoted(o.oficina.transportadora), c.pago ? PAGO_INFO[c.pago].anotado : null].filter(Boolean).join("\n") : CHECKOUT_MESSAGES.noted(c);
  if (step === "summary") return summarize(io, state, { ...n, step }, prefix);
  return done({ ...state, checkout: { ...n, step } }, await ask(io, step, prefix, n.delivery), "corrected");
}

/**
 * Fase 3B.4 — cambio de entrega en el checkout con aceptación: a domicilio se quitan la oficina y el
 * documento (el documento solo existe con oficina); a la oficina se quitan la dirección y el barrio, salvo
 * que el negocio los pida también con oficina. Ciudad y departamento se conservan.
 */
function aplicarEntregaAceptacion(ck: CheckoutState, entrega: Entrega, o: CheckoutOpciones): CheckoutState {
  const { office: _office, document: _document, neighborhood, ...resto } = ck;
  void _office;
  void _document;
  if (entrega === "domicilio") return { ...resto, ...(neighborhood ? { neighborhood } : {}), delivery: "domicilio" };
  if (entrega === "oficina_transportadora") {
    return {
      ...resto,
      delivery: "oficina_transportadora",
      address: o.oficina?.pide_direccion ? ck.address : null,
      deliveryReference: null,
      ...(o.oficina?.pide_barrio && neighborhood ? { neighborhood } : {}),
      ...(ck.delivery === "oficina_transportadora" && ck.office ? { office: ck.office } : {}),
      ...(ck.delivery === "oficina_transportadora" && ck.document ? { document: ck.document } : {}),
    };
  }
  return { ...resto, delivery: entrega };
}

const NUMERO = (w: string): number | null => (/^\d{1,2}$/.test(w) ? Number(w) : (NUMEROS_EN_LETRAS[w] ?? null));

/** El producto del pedido al que se refiere el mensaje: el único, o el que la selección determinista señala. */
function objetivo(text: string, lines: readonly Linea[]): string | "ambiguo" {
  if (lines.length === 1) return lines[0].reference;
  const sel = resolveSelection(
    text,
    lines.map((l) => ({ reference: l.reference, name: l.product_name })),
    { typedReferences: extractReferences(text), lenguaje: true },
  );
  return sel.selected.length === 1 ? sel.selected[0].reference : "ambiguo";
}

/** Cambio de cantidad EXPLÍCITO (no un número suelto: en un paso con opciones "2" puede ser la opción 2). */
function cambioDeCantidad(text: string): { cambio: Cambio; objetivoTexto: string } | null {
  const c: Cantidad | null = leerCantidad(text);
  const t = normalizar(text);
  if (c && !/^(\d{1,2}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)$/.test(t)) return { cambio: c, objetivoTexto: text };
  // "3 del primero", "quiero 2 del dorado", "ponme 4 de la pulsera"
  const m = /^(?:(?:quiero|ponme|dame|mejor|no|que sean|eran|cambia a|solo)\s+)*(\d{1,2}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)(?:\s+(?:unidades?|und|uds|u))?\s+(?:del|de la|de el|de los|de las|de)\s+(.+)$/.exec(t);
  if (m) {
    const n = NUMERO(m[1]);
    if (n && n >= 1 && n <= 99) return { cambio: { tipo: "fijar", n }, objetivoTexto: m[2] };
  }
  return null;
}

/** Cambia cantidades / quita un producto del pedido en curso: se rehace la propuesta y se conservan los datos del checkout. */
async function aplicarCambio(io: CheckoutIO, state: ConversationState, ck: CheckoutState, order: OrderPublicView, ref: string, cambio: Cambio): Promise<CheckoutResult> {
  const lines = order.lines.filter((l) => l.quantity > 0);
  const actual = lines.find((l) => l.reference === ref);
  if (!actual) return done(state, await ask(io, ck.step, checkoutOptionTexts(io.perfil.opciones).doubt, ck.delivery), "doubt");
  const base: CheckoutState = { ...ck, pendingChange: null };
  const q = Math.min(99, cambio.tipo === "fijar" ? cambio.n : cambio.tipo === "sumar" ? actual.quantity + 1 : cambio.tipo === "restar" ? actual.quantity - 1 : 0);
  const items = lines.map((l) => ({ reference: l.reference, quantity: l.reference === ref ? q : l.quantity })).filter((l) => l.quantity > 0);
  if (items.length === 0) {
    const cancel = CHECKOUT_BUTTONS.summary[2];
    return done({ ...state, checkout: base }, await io.sendMenu(CHECKOUT_MESSAGES.onlyProduct, [cancel], `${CHECKOUT_MESSAGES.onlyProduct} (escríbeme *cancelar* si ya no lo quieres)`), "only_product");
  }
  if (q === actual.quantity) return done({ ...state, checkout: base }, await ask(io, ck.step, CHECKOUT_MESSAGES.noChange(actual.product_name, q), ck.delivery), "unchanged");
  return rehacer(io, state, base, items);
}

/**
 * Rehace la propuesta con las cantidades nuevas (el pedido confirmado nunca se toca: esto es ANTES de
 * confirmar). La propuesta vieja se cancela (sin reserva, nada que devolver); la nueva sale del motor
 * con precios y stock vigentes. Nombre, entrega y pago se conservan; el resumen se vuelve a mostrar.
 */
async function rehacer(io: CheckoutIO, state: ConversationState, ck: CheckoutState, items: Array<{ reference: string; quantity: number }>): Promise<CheckoutResult> {
  try {
    await io.engine.cancelProposal({ tenantId: io.tenantId, contact: io.contact, orderId: ck.orderId, reason: "checkout_quantity_change", requestId: io.requestId });
  } catch (err) {
    if (!(err instanceof OrderError)) return done(state, await io.sendText(CHECKOUT_MESSAGES.pending), "pending");
    if (err.code === "INVALID_TRANSITION") return done({ ...state, checkout: null }, await io.sendText(CHECKOUT_MESSAGES.alreadyConfirmed), "already_confirmed");
    if (err.code !== "NOT_FOUND") return done(state, await io.sendText(CHECKOUT_MESSAGES.failed), "failed");
  }
  let created;
  try {
    created = await io.engine.createOrder({
      tenantId: io.tenantId,
      channel: io.channel,
      source: "agent",
      contact: io.contact,
      items,
      // Idempotente por mensaje + contenido: el reintento del mismo mensaje no crea otra propuesta.
      idempotencyKey: conversationKey("agent", io.contact, `${io.wamid ?? io.requestId}|${requestFingerprint(io.channel, items)}|checkout`),
      requestId: io.requestId,
    });
  } catch (err) {
    if (!(err instanceof OrderError)) throw err;
    return done({ ...state, checkout: null, proposal: null, activeOrderId: null, cart: items.slice(0, MAX_CART_LINES) }, await io.sendText(CHECKOUT_MESSAGES.failed), "failed");
  }
  const o = publicView(created.order);
  if (o.status !== "pending_confirmation" || !o.confirmation) {
    const issues = o.issues.map((i) => i.message).slice(0, 5);
    await io.engine.cancelProposal({ tenantId: io.tenantId, contact: io.contact, orderId: o.order_id, reason: "checkout_issues", requestId: io.requestId }).catch(() => null);
    return done(backToCart(state, o), await io.sendText([...issues, CHECKOUT_MESSAGES.notConfirmed].join("\n\n")), "not_confirmed");
  }
  const n: CheckoutState = completar({ ...ck, orderId: o.order_id, summary: null, pendingChange: null }, io.perfil.opciones);
  const next: ConversationState = { ...state, activeOrderId: o.order_id };
  const step = ck.step === "summary" ? "summary" : nextStep(n, io.perfil.opciones);
  if (step === "summary") return summarize(io, next, { ...n, step }, CHECKOUT_MESSAGES.updated);
  return done({ ...next, checkout: { ...n, step } }, await ask(io, step, CHECKOUT_MESSAGES.updated, n.delivery), "updated");
}

/** Cambio de productos dentro del checkout (cantidad, quitar, "¿de cuál?" pendiente) o null si el mensaje no es eso. */
async function cambiarProductos(io: CheckoutIO, state: ConversationState, ck: CheckoutState, order: OrderPublicView, text: string): Promise<CheckoutResult | null> {
  const lines = order.lines.filter((l) => l.quantity > 0);
  // Respuesta a "¿de cuál producto?": el número de la lista, la referencia, la posición o un nombre inequívoco.
  if (ck.pendingChange) {
    const t = normalizar(text);
    const k = /^\d{1,2}$/.test(t) ? Number(t) : null;
    const ref = k && k >= 1 && k <= lines.length ? lines[k - 1].reference : objetivo(text, lines);
    if (ref !== "ambiguo") return aplicarCambio(io, state, ck, order, ref, ck.pendingChange);
  }
  const cant = cambioDeCantidad(text);
  const quitar = !cant && pideQuitar(text);
  if (!cant && !quitar) return pideProducto(text, io.perfil.vocabulario) ? done(state, await ask(io, ck.step, CHECKOUT_MESSAGES.productsViaModify, ck.delivery), "products_via_modify") : null;
  const cambio: Cambio = cant ? cant.cambio : { tipo: "quitar", n: 0 };
  const ref = objetivo(cant ? cant.objetivoTexto : text, lines);
  if (ref === "ambiguo") return done({ ...state, checkout: { ...ck, pendingChange: cambio } }, await io.sendText(CHECKOUT_MESSAGES.whichProduct(cambio, lines)), "ask_target");
  return aplicarCambio(io, state, ck, order, ref, cambio);
}

/**
 * Fase 3B.4 — el mensaje de ESTE turno puede traer el documento: su wamid se anota para reemplazarlo en el
 * historial que ve el modelo ("[documento de identidad]"). `siempre` = aunque no tenga números (el paso del
 * documento); si no, solo si trae una secuencia de 4+ dígitos.
 */
function conWamidsDocumento(state: ConversationState, io: CheckoutIO, text: string, siempre = false): ConversationState {
  if (!siempre && !/\d[\d.\s-]{2,}\d/.test(text)) return state;
  const nuevos = io.wamids?.length ? io.wamids : io.wamid ? [io.wamid] : [];
  if (nuevos.length === 0) return state;
  const todos = [...(state.documentoWamids ?? []).filter((w) => !nuevos.includes(w)), ...nuevos.map((w) => w.slice(0, 200))].slice(-20);
  return { ...state, documentoWamids: todos };
}

/** Fase 3B.4 — "Corregir dato": la lista de los datos de ESTE checkout (lista de WhatsApp; si no sale, en texto). */
async function pedirCampo(io: CheckoutIO, state: ConversationState, ck: CheckoutState): Promise<CheckoutResult> {
  const opciones = camposCorregibles(io.perfil.opciones, ck).map(({ id, title }) => ({ id, title }));
  const fallback = `${ACEPTACION_MESSAGES.fixWhich} Escríbeme: ${listaO(opciones.map((x) => negrita(x.title.toLowerCase())))}.`;
  const reply = await io.sendMenu(ACEPTACION_MESSAGES.fixWhich, opciones, fallback);
  return done({ ...state, checkout: { ...ck, step: "fix", summary: null, pendingChange: null } }, reply, "fix");
}

/** Fase 3B.4 — se borra el dato elegido y se vuelve a pedir; con todo completo, sale el resumen NUEVO. */
async function corregirCampo(io: CheckoutIO, state: ConversationState, ck: CheckoutState, campo: CampoCorregible): Promise<CheckoutResult> {
  const o = io.perfil.opciones;
  const base: CheckoutState = { ...ck, summary: null, pendingChange: null };
  if (campo === "products") return done({ ...state, checkout: { ...base, step: "summary" } }, await io.sendText(ACEPTACION_MESSAGES.fixProducts), "fix");
  const { phone, department, neighborhood, office, document, ...resto } = base;
  const limpio: CheckoutState =
    campo === "name"
      ? { ...base, customerName: null }
      : campo === "city"
        ? { ...base, city: null }
        : campo === "address"
          ? { ...base, address: null }
          : {
              ...resto,
              ...(campo !== "phone" && phone ? { phone } : {}),
              ...(campo !== "department" && department ? { department } : {}),
              ...(campo !== "neighborhood" && neighborhood ? { neighborhood } : {}),
              ...(campo !== "office" && office ? { office } : {}),
              ...(campo !== "document" && document ? { document } : {}),
            };
  const step = nextStep(limpio, o);
  if (step === "summary") return summarize(io, state, limpio, null);
  return done({ ...state, checkout: { ...limpio, step } }, await ask(io, step, null, limpio.delivery), "asked");
}

/**
 * Un mensaje con el checkout en curso. null = el checkout ya no aplica (el pedido cambió por otro
 * camino: vencido, cancelado, en manos de una asesora): quien llama lo cierra y el turno sigue normal.
 *
 * Orden (Bloque 28): salida → botón de otro paso (corrección) → "¿de cuál?" pendiente → duda → espera
 * → PREGUNTA (se responde, nada cambia) → cambio de productos → corrección de entrega/pago → dato del paso.
 */
export async function continueCheckout(
  io: CheckoutIO,
  state: ConversationState,
  input: { text: string; buttonId?: string | null },
  order: (OrderPublicView & { next_step?: string }) | null,
): Promise<CheckoutResult | null> {
  const ck = state.checkout;
  if (!ck) return null;
  if (order && order.order_id === ck.orderId && order.status === "confirmed") {
    // Ya quedó confirmado (p. ej. la respuesta anterior no llegó a guardarse): se cierra igual, una vez.
    return finishConfirmed(io, state);
  }
  // Fase 3B.4: ya se envió a aceptación (la respuesta anterior no alcanzó a guardarse): se cierra, sin repetir.
  if (order && order.order_id === ck.orderId && order.status === "pending_acceptance" && cierreConAceptacion(io.perfil.opciones)) {
    return cerrarYaEnviado(io, state, ck);
  }
  if (!order || order.order_id !== ck.orderId || order.status !== "pending_confirmation") {
    return null;
  }
  const text = input.text;
  const escape = parseEscape(text, input.buttonId);
  if (escape) return leave(io, state, ck, order, escape);

  const { vocabulario, opciones } = io.perfil;
  const textos = checkoutOptionTexts(opciones);
  const btn = buttonOf(text, input.buttonId, opciones);
  // Botón de entrega o de pago de un mensaje anterior, tocado en otro paso: corrige ESE dato.
  const btnEntrega = btn ? ENTREGA_POR_ID.get(btn) : undefined;
  const btnPago = btn ? PAGO_POR_ID.get(btn) : undefined;
  if (btnEntrega && ck.step !== "delivery") return corregir(io, state, ck, { entrega: btnEntrega });
  if (btnPago && ck.step !== "payment") return corregir(io, state, ck, { pago: btnPago });

  // Fase 3B.4 — checkout CON ACEPTACIÓN: lo propio de este flujo, antes que lo genérico.
  const cierre = cierreConAceptacion(opciones);
  /** Pasos que esperan un DATO (un número, un barrio "20 de Julio"…): nunca se leen como cambio de cantidades. */
  const pasoDeDato = cierre !== null && ["phone", "document", "neighborhood", "office", "department"].includes(ck.step);
  if (cierre) {
    // Documento: negarse (o no poder) => una persona; el checkout NO sigue solo.
    if (ck.step === "document" && !btn && niegaDocumento(text)) {
      const paused = await io.handOff("el cliente no entrega el documento para reclamar en la oficina").catch(() => false);
      const base = conWamidsDocumento(state, io, text);
      return paused
        ? done({ ...base, handoffTurn: io.turn }, await io.sendText(ACEPTACION_MESSAGES.documentRefused), "document_refused", true)
        : done(base, await io.sendText(ACEPTACION_MESSAGES.documentUnavailable), "document_refused");
    }
    // Un medio de pago que no se ofrece (Nequi, transferencia…): se dice cuál sí, sin modelo; el paso sigue.
    const pagoNo = !btn && ck.step !== "document" ? pagoNoOfrecido(text, opciones) : null;
    if (pagoNo) return done(state, await ask(io, ck.step, textos.paymentUnavailable(pagoNo, ck.delivery), ck.delivery), "invalid");
    // D2: la oficina solo si el cliente la PIDE; y de vuelta a domicilio si lo dice.
    if (!btn && ck.step !== "office" && ck.step !== "document" && ck.delivery !== "oficina_transportadora" && pideOficina(text, opciones)) {
      return corregir(io, state, ck, { entrega: "oficina_transportadora" });
    }
    // (Corrección EXPLÍCITA y corta: "¿el envío tiene costo?" es una pregunta, nunca un cambio de entrega.)
    if (!btn && ck.delivery === "oficina_transportadora" && !pasoDeDato && ck.step !== "address" && leerCorreccion(text, ck.delivery, opciones)?.entrega === "domicilio") {
      return corregir(io, state, ck, { entrega: "domicilio" });
    }
    // Resumen: datos correctos (=> aviso y envío a aceptación) o corregir un dato. Cancelar ya salió arriba.
    if (ck.step === "summary") {
      const a = parseResumenAceptacion(text, input.buttonId);
      if (a === "ok") return enviarAAceptacion(io, state, ck, order);
      if (a === "fix") return pedirCampo(io, state, ck);
    }
    if (ck.step === "fix") {
      const campo = campoACorregir(text, input.buttonId, opciones, ck);
      if (campo) return corregirCampo(io, state, ck, campo);
    }
  }

  if (!btn) {
    if (ck.pendingChange && !pasoDeDato) {
      const r = await cambiarProductos(io, state, ck, order, text);
      if (r) return r;
    }
    if (leerSalida(text) === "doubt") return done(state, await ask(io, ck.step, textos.doubt, ck.delivery), "doubt");
    if (esEspera(text)) return done(state, await io.sendText(CHECKOUT_MESSAGES.waiting), "waiting");
    if (ck.step === "address" && anunciaDireccion(text)) return done(state, await io.sendText(CHECKOUT_MESSAGES.addressAnnounce), "waiting");
    // Una PREGUNTA nunca es un dato: se responde y se repite la pregunta del paso (sin tocar nada).
    // ("link de pago" en el paso del pago, si el negocio lo ofrece, es la respuesta, no un pedido del catálogo.)
    const eligeLinkDePago = ck.step === "payment" && leerPago(text, ck.delivery, opciones) === "link_pago";
    if (esPregunta(text) || (pideCatalogo(text) && !eligeLinkDePago)) {
      const r = await answerAndRepeat(io, state, ck, text);
      // Una pregunta con números en el paso del documento también se oculta del historial del modelo.
      return ck.step === "document" && cierre ? { ...r, state: conWamidsDocumento(r.state, io, text) } : r;
    }
    if (!pasoDeDato) {
      const cambio = await cambiarProductos(io, state, ck, order, text);
      if (cambio) return cambio;
    }
    const corr = leerCorreccion(text, ck.delivery, opciones);
    if (corr && ((corr.entrega && ck.step !== "delivery") || (corr.pago && ck.step !== "payment"))) return corregir(io, state, ck, corr);
  }

  const save = (patch: Partial<CheckoutState>) => ({ ...ck, ...patch, pendingChange: null });
  const move = async (nextCkIn: CheckoutState, prefix: string | null = null, base: ConversationState = state) => {
    const nextCk = completar(nextCkIn, opciones);
    const step = nextStep(nextCk, opciones);
    if (step === "summary") return summarize(io, base, nextCk, prefix);
    return done({ ...base, checkout: { ...nextCk, step } }, await ask(io, step, prefix, nextCk.delivery), "asked");
  };
  const again = async (text: string, step: CheckoutStep) => done(state, await ask(io, step, text, ck.delivery), "invalid");
  /** Otro dato que vino en el MISMO mensaje ("domicilio y transferencia"): solo llena lo vacío (y solo con un pago que se ofrece). */
  const extra = (c: CheckoutState): CheckoutState => {
    if (btn) return c;
    const x = leerCorreccion(text, c.delivery, opciones);
    return { ...c, ...(x?.pago && !c.paymentMethod && ck.step !== "payment" && pagoPermitido(opciones, x.pago, c.delivery) ? { paymentMethod: x.pago } : {}) };
  };

  switch (ck.step) {
    case "name": {
      const name = parseCustomerName(text, vocabulario);
      if (!name) return done(state, await io.sendText(cierre ? ACEPTACION_MESSAGES.askNameAgain : CHECKOUT_MESSAGES.askNameAgain), "invalid");
      // Fase 3B.4: nombre COMPLETO (nombre y apellido) si el negocio lo pide.
      if (cierre && opciones.campos?.nombre_completo && palabras(name) < 2) return done(state, await io.sendText(ACEPTACION_MESSAGES.askNameAgain), "invalid");
      // Bloque 28: el nombre queda en el pedido en curso; se guarda en el contacto solo al confirmar.
      return move(save({ customerName: name }));
    }
    case "delivery": {
      const d = parseDelivery(text, opciones, input.buttonId);
      if (!d) return again(CHECKOUT_MESSAGES.chooseOption, "delivery");
      if (cierre) return move(extra(aplicarEntregaAceptacion(save({}), d, opciones)));
      const patch: Partial<CheckoutState> = d === "tienda" ? { delivery: d, address: null, city: null, deliveryReference: null } : { delivery: d };
      return move(extra(save(patch)));
    }
    case "address": {
      const a = leerDireccion(text, io.perfil);
      if (a?.tipo === "vaga") return done(state, await io.sendText(CHECKOUT_MESSAGES.addressVague), "invalid");
      if (a?.tipo === "anuncio") return done(state, await io.sendText(CHECKOUT_MESSAGES.addressAnnounce), "waiting");
      if (!a || NO_REFERENCE.has(normalizar(a.valor))) return done(state, await io.sendText(CHECKOUT_MESSAGES.addressAgain), "invalid");
      // Fase 3B.4: con aceptación la ciudad ya se pidió antes (no se toma de la dirección).
      if (cierre) return move(save({ address: a.valor }));
      // Bloque 32: si la dirección ya trae la ciudad al final, no se vuelve a preguntar.
      const conCiudad = ciudadEnDireccion(a.valor);
      if (conCiudad && leerDireccion(conCiudad.direccion, io.perfil)?.tipo === "ok") return move(save({ address: conCiudad.direccion, city: conCiudad.ciudad, step: "reference" }));
      return move(save({ address: a.valor }));
    }
    case "city": {
      if (cierre) {
        // "Medellín, Antioquia": ciudad y departamento en el mismo mensaje.
        const [primera, ...resto] = text.split(",").map((s) => s.trim()).filter(Boolean);
        const ciudad = leerCiudad(primera ?? text, io.perfil) ?? leerCiudad(text, io.perfil);
        if (!ciudad || NO_REFERENCE.has(normalizar(ciudad))) return done(state, await io.sendText(ACEPTACION_MESSAGES.cityAgain), "invalid");
        const departamento = resto.length > 0 ? leerDepartamento(resto.join(" ")) : null;
        // Cobertura (Fase 3B.6): sin certeza => una persona. Hoy no hay fuente estructurada: no se consulta nada.
        if (io.cityCoverage && opciones.envios?.ciudad_desconocida_en_checkout === "handoff") {
          const cobertura = await io.cityCoverage(ciudad).catch(() => "sin_certeza" as const);
          if (cobertura === "sin_certeza") {
            const paused = await io.handOff("ciudad sin certeza de cobertura").catch(() => false);
            if (paused) return done({ ...state, handoffTurn: io.turn }, await io.sendText(textoDeEnvio(opciones.envios, "cobertura_no_verificable") ?? ACEPTACION_MESSAGES.coverageHandoff), "coverage_handoff", true);
          }
        }
        return move(save({ city: ciudad, ...(departamento && opciones.campos?.departamento ? { department: departamento } : {}) }));
      }
      const c = leerCiudad(text, io.perfil);
      if (!c || NO_REFERENCE.has(normalizar(c))) return done(state, await io.sendText(CHECKOUT_MESSAGES.cityAgain), "invalid");
      // La referencia es opcional, pero se pregunta (paso explícito).
      return move(save({ city: c, step: "reference" }));
    }
    // --- Fase 3B.4: pasos del checkout con aceptación ---
    case "phone": {
      const tel = opciones.campos?.telefono;
      const r = leerTelefono(text, { aceptaMismo: tel?.modo === "requerido" && tel.acepta_mismo_whatsapp, waId: io.contact.waId, buttonId: input.buttonId });
      if ("error" in r) return done(state, await io.sendText(r.error === "escribelo" ? ACEPTACION_MESSAGES.phoneWriteIt : ACEPTACION_MESSAGES.phoneAgain), "invalid");
      return move(save({ phone: r.telefono }));
    }
    case "department": {
      const d = leerDepartamento(text);
      if (!d) return done(state, await io.sendText(ACEPTACION_MESSAGES.departmentAgain), "invalid");
      return move(save({ department: d }));
    }
    case "neighborhood": {
      const b = leerBarrio(text);
      if (!b) return done(state, await io.sendText(ACEPTACION_MESSAGES.neighborhoodAgain), "invalid");
      return move(save({ neighborhood: b }));
    }
    case "office": {
      const of = leerOficina(text);
      if (!of) return done(state, await io.sendText(ACEPTACION_MESSAGES.officeAgain(opciones.oficina?.transportadora ?? "la transportadora")), "invalid");
      return move(save({ office: of }));
    }
    case "document": {
      // El mensaje se oculta del historial del modelo sea válido o no (puede traer el número).
      const base = conWamidsDocumento(state, io, text, true);
      const tipo = tipoDocumento(opciones);
      const sellado = sealDocument(extraerDocumento(text), io.documentCipher);
      if (!sellado.ok && sellado.error === "document_invalid") return done(base, await io.sendText(ACEPTACION_MESSAGES.documentAgain), "invalid");
      if (!sellado.ok || !tipo) {
        // Sin forma segura de guardarlo (o sin configuración): nunca en claro; pasa a una persona.
        const paused = await io.handOff("no se pudo guardar el documento de forma segura").catch(() => false);
        return done(paused ? { ...base, handoffTurn: io.turn } : base, await io.sendText(ACEPTACION_MESSAGES.documentUnavailable), "failed", paused);
      }
      return move(save({ document: { type: tipo, cipherText: sellado.sealed.cipherText, last4: sellado.sealed.last4 } }), null, base);
    }
    case "fix":
      // No se entendió qué dato: se vuelve a mostrar la lista.
      return pedirCampo(io, state, ck);
    case "reference": {
      const skip = btn === "checkout_sin_referencia" || NO_REFERENCE.has(normalizar(text));
      if (!skip && esAfirmacion(text)) return done(state, await io.sendText(CHECKOUT_MESSAGES.referenceAsk), "invalid");
      const r = skip ? null : esRelleno(text) ? null : freeText(text, 2, 300);
      if (!skip && !r) return again(CHECKOUT_MESSAGES.chooseOption, "reference");
      return move(save({ deliveryReference: r, step: "payment" }));
    }
    case "payment": {
      const m = btn ? parsePayment(text, opciones, input.buttonId) : leerPago(text, ck.delivery, opciones);
      // "Contra entrega" / "cuando llegue" con un pago que no se ofrece para esa entrega: se explica qué sí.
      if (m === "no_disponible") return again(textos.paymentUnavailable(ck.delivery === "tienda" ? "pago_en_tienda" : "contra_entrega", ck.delivery), "payment");
      if (!m) return again(CHECKOUT_MESSAGES.chooseOption, "payment");
      // Autoridad del backend: un botón de un pago que no aplica a ESTA entrega no se anota.
      if (!pagoPermitido(opciones, m, ck.delivery)) return again(textos.paymentUnavailable(m, ck.delivery), "payment");
      return move(save({ paymentMethod: m, step: "summary" }));
    }
    case "summary": {
      // Fase 3B.4: con aceptación solo valen sus botones (arriba); "sí", "ok"… piden el botón de datos correctos.
      if (cierre) return again(ACEPTACION_MESSAGES.tapDataOk, "summary");
      const action = parseSummaryAction(text, input.buttonId);
      if (action === "confirm") return confirm(io, state, ck, order);
      // "sí", "sii", "confirmo", "ok", "dale"…: nunca confirman; se pide el botón (acción inequívoca).
      const afirma = esAfirmacion(text) || isExplicitConfirmation(text) || /\bconfirm/i.test(normalizar(text));
      return again(afirma ? CHECKOUT_MESSAGES.tapToConfirm : CHECKOUT_MESSAGES.chooseOption, "summary");
    }
  }
}

/**
 * Clic en un botón del checkout SIN checkout en curso (un resumen viejo): nunca confirma nada.
 * Si el pedido de la conversación ya está confirmado, se dice; si no, el resumen ya no vale.
 */
export async function staleCheckoutButton(io: CheckoutIO, state: ConversationState, order: OrderPublicView | null): Promise<CheckoutResult> {
  // Fase 3B.4: ya enviado a aceptación: se dice que quedó registrado (nunca se confirma ni se repite nada).
  if (order?.status === "pending_acceptance") return done(state, await io.sendText(ACEPTACION_MESSAGES.alreadySubmitted), "already_confirmed");
  const confirmed = order && (order.status === "confirmed" || order.status === "handoff");
  return done(state, await io.sendText(confirmed ? CHECKOUT_MESSAGES.alreadyConfirmed : CHECKOUT_MESSAGES.stale), confirmed ? "already_confirmed" : "stale");
}
