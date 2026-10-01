/**
 * PERFIL COMERCIAL DE CADA NEGOCIO (catalog_sales multi-negocio).
 *
 * Lo que cambia de un negocio a otro SIN tocar el motor:
 *   - vocabulario (columna dulabs_agente_runtime_config.vocabulario): cómo se nombra lo que vende
 *     (botón de búsqueda, ejemplos, palabras que señalan un producto o que nunca son un nombre).
 *   - opciones del checkout (columna checkout_opciones): entregas y pagos que el negocio OFRECE, en
 *     qué orden, con qué política (un pago solo con cierta entrega) y sus textos propios.
 *
 * Los MÉTODOS son un catálogo CERRADO de la plataforma (DELIVERY_TYPES / PAYMENT_METHODS, los mismos
 * valores que los CHECK de la BD): cada negocio elige un subconjunto, nunca inventa uno, y el modelo
 * no los decide (los lee y valida el backend).
 *
 * Neutral por defecto: sin vocabulario configurado se habla de "producto" (nunca de joyas). Sin
 * opciones de checkout, un número con checkout conversacional es config INVÁLIDA (fail-closed).
 *
 * PERFIL_LEGADO = el comportamiento ANTERIOR a esta generalización (el de Delacour, único negocio con
 * agente). Solo se usa cuando la fila se leyó SIN las columnas nuevas (la migración
 * 20261205000000_dulabs_agente_perfil_negocio.sql aún no se aplicó): así el despliegue del código antes
 * que la migración no cambia nada. La migración escribe ese mismo perfil EXPLÍCITO en la fila de
 * Delacour (la prueba de paridad verifica que sean idénticos).
 */
import { z } from "zod";
import { DELIVERY_TYPES, PAYMENT_METHODS, type DeliveryType, type PaymentMethod } from "@/lib/catalogo/pedidos/contrato";
import { normalizar } from "@/lib/agente/lenguaje/normalizar";

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

/** Palabra o frase ya normalizada (minúsculas, sin tildes ni signos): se compara con el texto normalizado. */
const frase = z
  .string()
  .min(2)
  .max(40)
  .refine((w) => normalizar(w) === w, "debe estar normalizada (minúsculas, sin tildes ni signos)");
/** UNA palabra normalizada (sin espacios). */
const palabra = frase.refine((w) => !w.includes(" "), "una sola palabra");

export const vocabularioSchema = z
  .object({
    /** Sustantivo de lo que vende, sin artículo: "qué {producto} buscas". */
    producto: z.string().trim().min(2).max(30),
    /** Título del botón de búsqueda del menú de inicio (WhatsApp: máximo 20 caracteres). */
    boton_buscar: z.string().trim().min(2).max(20),
    /** Ejemplos REALES de búsqueda del negocio. El texto corto usa los dos primeros; el largo, todos. */
    ejemplos: z.array(z.string().trim().min(2).max(40)).max(5),
    /** Qué conviene entender al inicio (orientación del modelo), p. ej. "tipo de producto, presupuesto". */
    pistas_busqueda: z.string().trim().min(3).max(160),
    /** Palabras o frases que señalan que el cliente pide un producto ("quiero dos aretes"). */
    palabras_producto: z.array(frase).max(120),
    /**
     * Palabras de producto que, en el paso de la dirección y sin número, indican que el mensaje no es
     * una dirección. Opcional: sin ella se usan las palabras de `palabras_producto` (de una palabra).
     */
    palabras_producto_direccion: z.array(palabra).max(120).optional(),
    /** Palabras que nunca forman parte del nombre de una persona (productos del negocio). */
    no_es_nombre: z.array(palabra).max(120),
    /** Palabras de `no_es_nombre` que sí aparecen en nombres de negocio ("Joyas Mary"): válidas junto a una palabra propia. */
    nombre_comercial: z.array(palabra).max(30),
  })
  .strict();

export type Vocabulario = z.infer<typeof vocabularioSchema>;

/** Vocabulario NEUTRAL de la plataforma: "producto". Nunca supone un rubro. */
export const VOCABULARIO_NEUTRAL: Vocabulario = Object.freeze({
  producto: "producto",
  boton_buscar: "🔎 Buscar producto",
  ejemplos: [],
  pistas_busqueda: "tipo de producto, características, presupuesto",
  palabras_producto: [],
  no_es_nombre: [],
  nombre_comercial: [],
});

// ---------------------------------------------------------------------------
// Opciones del checkout
// ---------------------------------------------------------------------------

const entregaSchema = z.enum(DELIVERY_TYPES);
const pagoSchema = z.enum(PAYMENT_METHODS);

export const checkoutOpcionesSchema = z
  .object({
    /** Entregas que ofrece el negocio, en el orden de los botones. Una sola => no se pregunta. */
    entregas: z.array(entregaSchema).min(1).max(DELIVERY_TYPES.length),
    /**
     * Pagos que ofrece, en el orden de los botones. `solo_con` = política: ese pago solo se ofrece con
     * esas entregas (sin ella, con todas; "contra_entrega" siempre es solo con domicilio).
     */
    pagos: z
      .array(z.object({ metodo: pagoSchema, solo_con: z.array(entregaSchema).min(1).max(DELIVERY_TYPES.length).optional() }).strict())
      .min(1)
      .max(PAYMENT_METHODS.length),
    /** Textos propios (opcionales). Sin ellos se arman con los nombres de los métodos ofrecidos. */
    mensajes: z
      .object({
        /** El cliente duda sin decir qué cambia ("me equivoqué"). */
        duda: z.string().trim().min(1).max(400).optional(),
        /** Pide un pago que no se ofrece para su entrega ("contra entrega" con domicilio, si no se ofrece). */
        pago_no_disponible: z.string().trim().min(1).max(400).optional(),
        /** Recordatorio del paso de la entrega (p. ej. tras una nota de voz). */
        recordatorio_entrega: z.string().trim().min(1).max(200).optional(),
        /** Recordatorio del paso del pago. */
        recordatorio_pago: z.string().trim().min(1).max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (new Set(o.entregas).size !== o.entregas.length) issue("entregas repetidas");
    if (new Set(o.pagos.map((p) => p.metodo)).size !== o.pagos.length) issue("pagos repetidos");
    for (const p of o.pagos) {
      if (p.solo_con && new Set(p.solo_con).size !== p.solo_con.length) issue(`${p.metodo}: solo_con repetido`);
      if (p.solo_con?.some((e) => !o.entregas.includes(e))) issue(`${p.metodo}: solo_con con una entrega que no se ofrece`);
      if (p.metodo === "contra_entrega" && p.solo_con?.includes("tienda")) issue("contra_entrega solo aplica a domicilio");
      if (entregasDelPago(o, p).length === 0) issue(`${p.metodo}: no aplica a ninguna entrega ofrecida`);
    }
    // Cada entrega ofrecida debe tener al menos un pago: si no, el checkout no podría terminar.
    for (const e of o.entregas) if (pagosPara(o, e).length === 0) issue(`${e}: sin ningún pago disponible`);
  });

export type CheckoutOpciones = z.infer<typeof checkoutOpcionesSchema>;

/** Entregas con las que se ofrece un pago (contra entrega: solo domicilio). */
function entregasDelPago(o: Pick<CheckoutOpciones, "entregas">, p: CheckoutOpciones["pagos"][number]): DeliveryType[] {
  const base = p.solo_con ?? o.entregas;
  return p.metodo === "contra_entrega" ? base.filter((e) => e === "domicilio") : [...base];
}

/** Pagos ofrecidos con ESA entrega (en el orden configurado). Sin entrega: todos los ofrecidos. */
export function pagosPara(o: Pick<CheckoutOpciones, "entregas" | "pagos">, entrega: DeliveryType | null): PaymentMethod[] {
  return o.pagos.filter((p) => entrega === null || entregasDelPago(o, p).includes(entrega)).map((p) => p.metodo);
}

/**
 * Cómo se presenta cada método del catálogo de la plataforma (botón, palabra en los textos fijos,
 * línea del resumen, "anotado", nombre). Igual para todos los negocios: lo que cambia es cuáles ofrece.
 */
export const ENTREGA_INFO: Readonly<Record<DeliveryType, { boton: { id: string; title: string }; palabra: string; resumen: string; anotado: string }>> = {
  tienda: { boton: { id: "checkout_tienda", title: "🏬 Recoger en tienda" }, palabra: "recoger en tienda", resumen: "🏬 Entrega: Recoger en tienda", anotado: "Anotado: *recoger en tienda* 🏬" },
  domicilio: { boton: { id: "checkout_domicilio", title: "🏠 Domicilio" }, palabra: "domicilio", resumen: "🏠 Entrega: Domicilio", anotado: "Anotado: entrega a *domicilio* 🏠" },
};

export const PAGO_INFO: Readonly<Record<PaymentMethod, { boton: { id: string; title: string }; palabra: string; resumen: string; anotado: string; nombre: string }>> = {
  pago_en_tienda: { boton: { id: "checkout_pago_tienda", title: "💵 Pago en tienda" }, palabra: "pago en tienda", resumen: "Pago en tienda", anotado: "Anotado: pago *en tienda* 💵", nombre: "pago en tienda" },
  transferencia: { boton: { id: "checkout_transferencia", title: "🏦 Transferencia" }, palabra: "transferencia", resumen: "Transferencia", anotado: "Anotado: pago por *transferencia* 🏦", nombre: "pago por transferencia" },
  contra_entrega: { boton: { id: "checkout_contra_entrega", title: "🚚 Contra entrega" }, palabra: "contra entrega", resumen: "Contra entrega", anotado: "Anotado: pago *contra entrega* 🚚", nombre: "pago contra entrega" },
  link_pago: { boton: { id: "checkout_link_pago", title: "💳 Link de pago" }, palabra: "link de pago", resumen: "Link de pago", anotado: "Anotado: pago con *link de pago* 💳", nombre: "pago con link de pago" },
};

/** ¿El negocio ofrece esa entrega? */
export const ofreceEntrega = (o: Pick<CheckoutOpciones, "entregas">, e: DeliveryType) => o.entregas.includes(e);

/** ¿Ese pago se ofrece con esa entrega? (la última palabra del backend antes de registrar un pedido) */
export const pagoPermitido = (o: Pick<CheckoutOpciones, "entregas" | "pagos">, pago: PaymentMethod, entrega: DeliveryType | null) => pagosPara(o, entrega).includes(pago);

// ---------------------------------------------------------------------------
// Perfil completo y perfil anterior a la generalización
// ---------------------------------------------------------------------------

/** Lo que el lenguaje del checkout necesita de un negocio. */
export interface PerfilNegocio {
  vocabulario: Vocabulario;
  opciones: CheckoutOpciones;
}

/** Vocabulario anterior a la generalización (Delacour Joyería). Ver el encabezado. */
export const VOCABULARIO_LEGADO: Vocabulario = Object.freeze({
  producto: "joya",
  boton_buscar: "🔎 Buscar una joya",
  ejemplos: ["dijes", "aretes dorados", "collar corazón"],
  pistas_busqueda: "tipo de joya, color, material, presupuesto",
  palabras_producto: [
    "arete", "aretes", "collar", "collares", "dije", "dijes", "pulsera", "pulseras", "anillo", "anillos", "cadena", "cadenas",
    "tobillera", "tobilleras", "candonga", "candongas", "joya", "joyas", "otra joya",
  ],
  palabras_producto_direccion: ["aretes", "collar", "dije", "dijes", "pulsera", "anillo"],
  no_es_nombre: ["arete", "aretes", "collar", "collares", "dije", "dijes", "pulsera", "pulseras", "anillo", "anillos", "cadena", "cadenas", "joya", "joyas"],
  nombre_comercial: ["joya", "joyas"],
});

/** Opciones del checkout anteriores a la generalización (Delacour): tienda o domicilio; pago en tienda o transferencia (sin contra entrega). */
export const CHECKOUT_OPCIONES_LEGADO: CheckoutOpciones = Object.freeze({
  entregas: ["tienda", "domicilio"],
  pagos: [{ metodo: "pago_en_tienda" }, { metodo: "transferencia" }],
  mensajes: {
    duda: "Claro 😊 ¿Qué quieres cambiar? Puedes escribirme, por ejemplo, *recoger en tienda*, *domicilio*, *transferencia* o *pago en tienda*. Para cambiar cantidades dime cuántas y de cuál producto.",
    pago_no_disponible: "Por ahora no manejamos pago contra entrega 🙏 Puedes pagar por *transferencia* o *en la tienda*.",
    recordatorio_entrega: "Escríbeme si prefieres *domicilio* o *recoger en tienda*.",
    recordatorio_pago: "Escríbeme si pagas por *transferencia* o *en tienda*.",
  },
}) as CheckoutOpciones;

export const PERFIL_LEGADO: PerfilNegocio = Object.freeze({ vocabulario: VOCABULARIO_LEGADO, opciones: CHECKOUT_OPCIONES_LEGADO });

/**
 * Columna `vocabulario` de la fila:
 *   undefined (fila leída sin la columna: migración pendiente) -> el de antes (legado)
 *   null (sin configurar)                                       -> NEUTRAL
 *   objeto                                                      -> el del negocio (estricto) o inválido
 */
export function resolverVocabulario(raw: unknown): { ok: true; vocabulario: Vocabulario; legado: boolean } | { ok: false } {
  if (raw === undefined) return { ok: true, vocabulario: VOCABULARIO_LEGADO, legado: true };
  if (raw === null) return { ok: true, vocabulario: VOCABULARIO_NEUTRAL, legado: false };
  const v = vocabularioSchema.safeParse(raw);
  return v.success ? { ok: true, vocabulario: v.data, legado: false } : { ok: false };
}

/**
 * Columna `checkout_opciones` de la fila:
 *   undefined (sin la columna: migración pendiente) -> las de antes (legado)
 *   null (sin configurar)                           -> null (con checkout encendido: config inválida)
 *   objeto                                          -> las del negocio (estrictas) o inválido
 */
export function resolverCheckoutOpciones(raw: unknown): { ok: true; opciones: CheckoutOpciones | null; legado: boolean } | { ok: false } {
  if (raw === undefined) return { ok: true, opciones: CHECKOUT_OPCIONES_LEGADO, legado: true };
  if (raw === null) return { ok: true, opciones: null, legado: false };
  const o = checkoutOpcionesSchema.safeParse(raw);
  return o.success ? { ok: true, opciones: o.data, legado: false } : { ok: false };
}
