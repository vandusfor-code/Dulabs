/**
 * CMS comercial — ESQUEMAS de cada tipo de contenido (zod). PURO.
 *
 * Son los esquemas del contenido PUBLICABLE: estrictos (clave desconocida = error), con límites y mensajes en español para la administradora. Se usan en tres
 * momentos, siempre los mismos:
 *   1. al VALIDAR un borrador antes de publicar (validacion.ts),
 *   2. al LEER lo publicado (lector.ts): un contenido que no cumpla el esquema se descarta, jamás se muestra a medias,
 *   3. para derivar los tipos que usan la tienda, el pedido y ARIA.
 * El BORRADOR es más laxo a propósito (puede estar incompleto): `normalizarBorrador` solo garantiza que el JSON sea seguro (tamaño, profundidad, claves
 * permitidas, texto normalizado); la completitud la exige validar().
 *
 * Todo texto es DATO plano: se rechaza HTML y los espacios o caracteres de control sobrantes (el borrador ya se guarda normalizado).
 */
import { z } from "zod";
import { isReference } from "@/lib/catalogo/domain";
import { AUDIENCIAS, LIMITE_JSON_CONTENIDO, MODALIDADES, SECCIONES_HOME, TEMAS_CONTENIDO, type TipoEntidad } from "@/lib/cms-comercial/contrato";
import { contieneHtml, normalizarTexto } from "@/lib/cms-comercial/texto-seguro";
import { esFechaLocalValida, intervaloDe } from "@/lib/cms-comercial/tiempo";

/** Tope de un descuento por porcentaje: un valor mayor casi seguro es un error de digitación (95% en lugar de 15%). */
export const MAX_PORCENTAJE = 90;
export const MAX_PRIORIDAD = 1000;
export const MAX_PESOS = 1_000_000_000;

// ---------------------------------------------------------------------------
// Primitivas
// ---------------------------------------------------------------------------

/** Texto plano con límites. `min` 0 = puede ir vacío (pero el borrador no guarda cadenas vacías: la clave simplemente no existe). */
export function texto(etiqueta: string, max: number, min = 1) {
  return z
    .string({ error: (iss) => (iss.input === undefined ? `${etiqueta} es obligatorio.` : `${etiqueta} debe ser un texto.`) })
    .min(min, { message: min <= 1 ? `${etiqueta} es obligatorio.` : `${etiqueta} debe tener al menos ${min} caracteres.` })
    .max(max, { message: `${etiqueta} no puede superar ${max} caracteres.` })
    .refine((s) => normalizarTexto(s) === s, { message: `${etiqueta} tiene espacios sobrantes o caracteres no permitidos.` })
    .refine((s) => !contieneHtml(s), { message: `${etiqueta} no puede contener etiquetas HTML: escribe texto plano.` });
}

const pesos = (etiqueta: string) =>
  z
    .number({ error: (iss) => (iss.input === undefined ? `${etiqueta} es obligatorio.` : `${etiqueta} debe ser un número.`) })
    .int({ message: `${etiqueta} debe ser un valor entero en pesos.` })
    .superRefine((n, ctx) => {
      if (n < 0) ctx.addIssue({ code: "custom", message: `${etiqueta} no puede ser negativo.` });
      else if (n === 0) ctx.addIssue({ code: "custom", message: `${etiqueta} debe ser mayor que cero.` });
      else if (n > MAX_PESOS) ctx.addIssue({ code: "custom", message: `${etiqueta} es demasiado grande.` });
    });

const referencia = z.string({ message: "La referencia debe ser un texto." }).refine(isReference, { message: "La referencia no tiene un formato válido (por ejemplo DL-000184)." });
const uuid = (etiqueta: string) => z.uuid({ message: `${etiqueta} no es un identificador válido.` });
/** Código público estable de un elemento (oferta, combo, campaña). */
export const claveSchema = z.string({ message: "El código debe ser un texto." }).regex(/^[a-z0-9][a-z0-9-]{0,79}$/, { message: "El código solo admite minúsculas, números y guiones." });
const fechaLocal = z.string({ message: "La fecha debe ser un texto." }).refine(esFechaLocalValida, { message: "La fecha no es válida. Usa el formato AAAA-MM-DD (o AAAA-MM-DDTHH:mm)." });

const sinRepetidos = (valores: readonly string[]) => new Set(valores).size === valores.length;

// ---------------------------------------------------------------------------
// Vigencia
// ---------------------------------------------------------------------------

function finDespuesDeInicio(v: { desde?: string; hasta?: string }, ctx: z.RefinementCtx) {
  const intervalo = intervaloDe(v);
  if (intervalo && intervalo.desde !== null && intervalo.hasta !== null && intervalo.hasta <= intervalo.desde) {
    ctx.addIssue({ code: "custom", path: ["hasta"], message: "La fecha de fin debe ser posterior a la de inicio." });
  }
}

/** Ofertas, combos y campañas SIEMPRE llevan inicio y fin: así ninguna promoción queda activa por olvido. */
export const vigenciaObligatoriaSchema = z.strictObject({ desde: fechaLocal, hasta: fechaLocal }).superRefine(finDespuesDeInicio);
/** El contenido (preguntas, políticas) puede no tener fechas. */
export const vigenciaOpcionalSchema = z.strictObject({ desde: fechaLocal.optional(), hasta: fechaLocal.optional() }).superRefine(finDespuesDeInicio);

// ---------------------------------------------------------------------------
// Imagen y destino de un botón
// ---------------------------------------------------------------------------

const foco = z.string().regex(/^\d{1,3}% \d{1,3}%$/, { message: "El punto focal debe verse así: 50% 50%." });

/** Archivos que el equipo de DuLabs deja en /public/catalogo/<tienda>/ (la portada actual de Delacour): solo para sembrar el estado inicial; el editor sube imágenes propias. */
const SRC_ESTATICO = /^\/catalogo\/[a-z0-9-]{2,40}\/[A-Za-z0-9._-]{1,100}\.(?:png|jpe?g|webp)$/;

export const imagenSchema = z.discriminatedUnion("origen", [
  z.strictObject({ origen: z.literal("cms"), asset: uuid("La imagen"), alt: texto("El texto alternativo de la imagen", 160, 3), foco: foco.optional() }),
  z.strictObject({
    origen: z.literal("estatico"),
    src: z.string().regex(SRC_ESTATICO, { message: "La ruta de la imagen no es válida." }),
    ancho: z.number().int().min(16).max(10000),
    alto: z.number().int().min(16).max(10000),
    alt: texto("El texto alternativo de la imagen", 160, 3),
    foco: foco.optional(),
  }),
]);
export type Imagen = z.infer<typeof imagenSchema>;

/**
 * Destino de un botón: una lista CERRADA. No hay enlaces externos (un botón no puede mandar a un sitio ajeno aunque alguien tome la cuenta de la
 * administradora) ni rutas libres: la tienda sabe construir cada destino y solo ofrece los que existen.
 */
export const destinoSchema = z.discriminatedUnion("tipo", [
  z.strictObject({ tipo: z.literal("catalogo") }),
  z.strictObject({ tipo: z.literal("categoria"), categoria_id: uuid("La categoría") }),
  z.strictObject({ tipo: z.literal("busqueda"), consulta: texto("La búsqueda", 60) }),
  z.strictObject({ tipo: z.literal("oferta"), clave: claveSchema }),
  z.strictObject({ tipo: z.literal("combo"), clave: claveSchema }),
  z.strictObject({ tipo: z.literal("campana"), clave: claveSchema }),
  z.strictObject({ tipo: z.literal("whatsapp") }),
]);
export type Destino = z.infer<typeof destinoSchema>;

const botonSchema = z.strictObject({ texto: texto("El texto del botón", 30, 2), destino: destinoSchema });

// ---------------------------------------------------------------------------
// Página principal (una por negocio)
// ---------------------------------------------------------------------------

export const homeSchema = z.strictObject({
  portada: z.strictObject({
    visible: z.boolean({ message: "Indica si la portada está visible." }),
    imagen: imagenSchema.optional(),
    etiqueta: texto("La etiqueta", 40).optional(),
    titulo: texto("El título de la portada", 90, 3),
    subtitulo: texto("El subtítulo", 200).optional(),
    boton: botonSchema.optional(),
  }),
  banner: z
    .strictObject({
      visible: z.boolean({ message: "Indica si el banner está visible." }),
      imagen: imagenSchema,
      destino: destinoSchema.optional(),
    })
    .optional(),
  /** Orden en que se pintan las secciones y cuáles se ven. Una sección que no esté en la lista no se muestra. */
  secciones: z
    .array(z.strictObject({ tipo: z.enum(SECCIONES_HOME, { message: "Sección desconocida." }), visible: z.boolean() }))
    .max(SECCIONES_HOME.length, { message: "Hay demasiadas secciones." })
    .refine((s) => sinRepetidos(s.map((x) => x.tipo)), { message: "Una sección no puede repetirse." }),
  categorias_destacadas: z
    .array(uuid("La categoría"))
    .max(12, { message: "Máximo 12 categorías destacadas." })
    .refine(sinRepetidos, { message: "Una categoría destacada no puede repetirse." }),
  productos_destacados: z
    .array(referencia)
    .max(24, { message: "Máximo 24 productos destacados." })
    .refine(sinRepetidos, { message: "Un producto destacado no puede repetirse." }),
});
export type Home = z.infer<typeof homeSchema>;

// ---------------------------------------------------------------------------
// Oferta
// ---------------------------------------------------------------------------

export const beneficioSchema = z.discriminatedUnion("tipo", [
  z.strictObject({
    tipo: z.literal("porcentaje"),
    valor: z
      .number({ message: "El porcentaje debe ser un número." })
      .int({ message: "El porcentaje debe ser un número entero." })
      .min(1, { message: "El porcentaje debe ser al menos 1%." })
      .max(MAX_PORCENTAJE, { message: `El porcentaje no puede superar ${MAX_PORCENTAJE}%: revisa que no sea un error de digitación.` }),
  }),
  z.strictObject({ tipo: z.literal("monto_fijo"), detal: pesos("El descuento detal").optional(), mayorista: pesos("El descuento mayorista").optional() }),
  z.strictObject({ tipo: z.literal("precio_especial"), detal: pesos("El precio especial detal").optional(), mayorista: pesos("El precio especial mayorista").optional() }),
]);
export type Beneficio = z.infer<typeof beneficioSchema>;

export const alcanceSchema = z.strictObject({
  /** true = toda la tienda (todos los productos con precio). */
  todos: z.boolean({ message: "Indica si la oferta aplica a toda la tienda." }),
  referencias: z.array(referencia).max(300, { message: "Máximo 300 productos por oferta." }).refine(sinRepetidos, { message: "Un producto no puede repetirse en la oferta." }),
  categorias: z.array(uuid("La categoría")).max(50, { message: "Máximo 50 categorías por oferta." }).refine(sinRepetidos, { message: "Una categoría no puede repetirse en la oferta." }),
});

/** Valores por canal que exige una modalidad (monto fijo, precio especial y precio de combo). Rechaza lo que falta y lo que sobra. */
function valoresPorModalidad(modalidad: (typeof MODALIDADES)[number], valores: { detal?: number; mayorista?: number }, ctx: z.RefinementCtx, ruta: (string | number)[], etiqueta: string) {
  const pideDetal = modalidad === "detal" || modalidad === "ambas";
  const pideMayor = modalidad === "mayorista" || modalidad === "ambas";
  if (pideDetal && valores.detal === undefined) ctx.addIssue({ code: "custom", path: [...ruta, "detal"], message: `Falta ${etiqueta} para clientes detal.` });
  if (pideMayor && valores.mayorista === undefined) ctx.addIssue({ code: "custom", path: [...ruta, "mayorista"], message: `Falta ${etiqueta} para clientes mayoristas.` });
  if (!pideDetal && valores.detal !== undefined) ctx.addIssue({ code: "custom", path: [...ruta, "detal"], message: `Esta modalidad no es para clientes detal: quita ${etiqueta} detal.` });
  if (!pideMayor && valores.mayorista !== undefined) ctx.addIssue({ code: "custom", path: [...ruta, "mayorista"], message: `Esta modalidad no es para clientes mayoristas: quita ${etiqueta} mayorista.` });
}

export const ofertaSchema = z
  .strictObject({
    nombre: texto("El nombre", 80, 3),
    descripcion: texto("La descripción", 600).optional(),
    imagen: imagenSchema.optional(),
    modalidad: z.enum(MODALIDADES, { message: "La modalidad debe ser detal, mayorista o ambas." }),
    beneficio: beneficioSchema,
    alcance: alcanceSchema,
    vigencia: vigenciaObligatoriaSchema,
    condiciones: texto("Las condiciones", 800).optional(),
    prioridad: z.number().int().min(0, { message: "La prioridad no puede ser negativa." }).max(MAX_PRIORIDAD, { message: `La prioridad no puede superar ${MAX_PRIORIDAD}.` }),
    /** Código de la campaña a la que pertenece (opcional). Si la campaña no está activa, la oferta tampoco. */
    campana: claveSchema.optional(),
  })
  .superRefine((o, ctx) => {
    if (o.beneficio.tipo !== "porcentaje") valoresPorModalidad(o.modalidad, o.beneficio, ctx, ["beneficio"], o.beneficio.tipo === "monto_fijo" ? "el descuento" : "el precio especial");
  });
export type Oferta = z.infer<typeof ofertaSchema>;

// ---------------------------------------------------------------------------
// Combo
// ---------------------------------------------------------------------------

export const comboSchema = z
  .strictObject({
    nombre: texto("El nombre", 80, 3),
    descripcion: texto("La descripción", 600).optional(),
    imagen: imagenSchema.optional(),
    modalidad: z.enum(MODALIDADES, { message: "La modalidad debe ser detal, mayorista o ambas." }),
    componentes: z
      .array(z.strictObject({ referencia, cantidad: z.number({ message: "La cantidad debe ser un número." }).int({ message: "La cantidad debe ser un número entero." }).min(1, { message: "La cantidad mínima es 1." }).max(50, { message: "La cantidad máxima por producto es 50." }) }))
      .min(1, { message: "Un combo necesita al menos un producto." })
      .max(12, { message: "Un combo admite máximo 12 productos distintos." })
      .refine((c) => sinRepetidos(c.map((x) => x.referencia)), { message: "Un producto no puede repetirse en el combo: sube su cantidad." }),
    /** Precio del combo por canal. El precio «normal» (suma de los productos) lo calcula SIEMPRE el backend. */
    precio: z.strictObject({ detal: pesos("El precio del combo detal").optional(), mayorista: pesos("El precio del combo mayorista").optional() }),
    vigencia: vigenciaObligatoriaSchema,
    condiciones: texto("Las condiciones", 800).optional(),
    prioridad: z.number().int().min(0).max(MAX_PRIORIDAD),
    campana: claveSchema.optional(),
  })
  .superRefine((c, ctx) => {
    valoresPorModalidad(c.modalidad, c.precio, ctx, ["precio"], "el precio del combo");
    if (c.componentes.reduce((s, x) => s + x.cantidad, 0) < 2) ctx.addIssue({ code: "custom", path: ["componentes"], message: "Un combo debe sumar al menos 2 unidades." });
  });
export type Combo = z.infer<typeof comboSchema>;

// ---------------------------------------------------------------------------
// Campaña
// ---------------------------------------------------------------------------

export const campanaSchema = z.strictObject({
  nombre: texto("El nombre", 80, 3),
  descripcion: texto("La descripción", 600).optional(),
  imagen: imagenSchema.optional(),
  modalidad: z.enum(MODALIDADES, { message: "La modalidad debe ser detal, mayorista o ambas." }),
  vigencia: vigenciaObligatoriaSchema,
  prioridad: z.number().int().min(0).max(MAX_PRIORIDAD),
  /** Contenido de portada de la campaña (se muestra en la sección «campaña» de la página principal mientras esté activa). */
  portada: z
    .strictObject({
      etiqueta: texto("La etiqueta", 40).optional(),
      titulo: texto("El título de la campaña", 90, 3),
      subtitulo: texto("El subtítulo", 200).optional(),
      imagen: imagenSchema.optional(),
      boton: botonSchema.optional(),
    })
    .optional(),
  productos_destacados: z.array(referencia).max(12, { message: "Máximo 12 productos destacados por campaña." }).refine(sinRepetidos, { message: "Un producto destacado no puede repetirse." }),
});
export type Campana = z.infer<typeof campanaSchema>;

// ---------------------------------------------------------------------------
// Contenido comercial (preguntas frecuentes, políticas, información)
// ---------------------------------------------------------------------------

export const contenidoSchema = z.strictObject({
  tema: z.enum(TEMAS_CONTENIDO, { message: "El tema no es válido." }),
  audiencia: z.enum(AUDIENCIAS, { message: "La audiencia debe ser todos, detal o mayorista." }),
  /** La pregunta (preguntas frecuentes) o el título del tema. */
  titulo: texto("El título", 160, 3),
  /** La respuesta o el texto. Admite variables cerradas como {{minimo_mayorista}} (ver variables.ts). */
  texto: texto("El texto", 1500),
  palabras_clave: z.array(texto("Una palabra clave", 30, 2)).max(10, { message: "Máximo 10 palabras clave." }).refine(sinRepetidos, { message: "Una palabra clave no puede repetirse." }),
  orden: z.number().int().min(0).max(1000),
  vigencia: vigenciaOpcionalSchema.optional(),
});
export type Contenido = z.infer<typeof contenidoSchema>;

// ---------------------------------------------------------------------------
// Por tipo
// ---------------------------------------------------------------------------

export interface ContenidoPorTipo {
  home: Home;
  oferta: Oferta;
  combo: Combo;
  campana: Campana;
  contenido: Contenido;
}

export const ESQUEMA_POR_TIPO = {
  home: homeSchema,
  oferta: ofertaSchema,
  combo: comboSchema,
  campana: campanaSchema,
  contenido: contenidoSchema,
} as const satisfies Record<TipoEntidad, z.ZodType>;

/** Claves de primer nivel permitidas en el borrador de cada tipo. */
const CLAVES_PERMITIDAS: Readonly<Record<TipoEntidad, readonly string[]>> = {
  home: Object.keys(homeSchema.shape),
  oferta: Object.keys(ofertaSchema.shape),
  combo: Object.keys(comboSchema.shape),
  campana: Object.keys(campanaSchema.shape),
  contenido: Object.keys(contenidoSchema.shape),
};

// ---------------------------------------------------------------------------
// Borrador: JSON seguro (puede estar incompleto)
// ---------------------------------------------------------------------------

const CLAVES_PROHIBIDAS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_PROFUNDIDAD = 8;
const MAX_ELEMENTOS_ARRAY = 500;
const MAX_CLAVES_OBJETO = 60;
const MAX_LARGO_TEXTO = 2000;

export type ResultadoBorrador = { ok: true; borrador: Record<string, unknown> } | { ok: false; mensaje: string };

class BorradorInvalido extends Error {}

function limpiar(valor: unknown, profundidad: number): unknown {
  if (profundidad > MAX_PROFUNDIDAD) throw new BorradorInvalido("El contenido está demasiado anidado.");
  if (valor === null || valor === undefined) return undefined;
  if (typeof valor === "string") {
    const limpio = normalizarTexto(valor);
    if (limpio.length > MAX_LARGO_TEXTO) throw new BorradorInvalido("Un texto es demasiado largo.");
    return limpio === "" ? undefined : limpio;
  }
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) throw new BorradorInvalido("Hay un número no válido.");
    return valor;
  }
  if (typeof valor === "boolean") return valor;
  if (Array.isArray(valor)) {
    if (valor.length > MAX_ELEMENTOS_ARRAY) throw new BorradorInvalido("Hay una lista demasiado larga.");
    return valor.map((v) => limpiar(v, profundidad + 1)).filter((v) => v !== undefined);
  }
  if (typeof valor === "object") {
    const proto = Object.getPrototypeOf(valor);
    if (proto !== Object.prototype && proto !== null) throw new BorradorInvalido("El contenido tiene un formato no permitido.");
    const entradas = Object.entries(valor as Record<string, unknown>);
    if (entradas.length > MAX_CLAVES_OBJETO) throw new BorradorInvalido("Hay un bloque con demasiados campos.");
    const salida: Record<string, unknown> = {};
    for (const [clave, v] of entradas) {
      if (CLAVES_PROHIBIDAS.has(clave)) throw new BorradorInvalido(`Campo no permitido: ${clave}.`);
      const limpio = limpiar(v, profundidad + 1);
      if (limpio !== undefined) salida[clave] = limpio;
    }
    return salida;
  }
  throw new BorradorInvalido("El contenido tiene un formato no permitido.");
}

/**
 * Convierte lo que mandó el cliente en un borrador SEGURO para guardar: objeto plano, solo las claves del tipo, textos normalizados (sin espacios ni caracteres
 * de control sobrantes), sin cadenas vacías ni nulos (ausente = sin valor) y con tope de tamaño. NO exige que esté completo: eso lo hace validar() al publicar.
 */
export function normalizarBorrador(tipo: TipoEntidad, valor: unknown): ResultadoBorrador {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return { ok: false, mensaje: "El contenido debe ser un objeto." };
  let limpio: Record<string, unknown>;
  try {
    limpio = (limpiar(valor, 0) ?? {}) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BorradorInvalido) return { ok: false, mensaje: err.message };
    throw err;
  }
  const permitidas = CLAVES_PERMITIDAS[tipo];
  for (const clave of Object.keys(limpio)) {
    if (!permitidas.includes(clave)) return { ok: false, mensaje: `Campo no permitido: ${clave}.` };
  }
  if (JSON.stringify(limpio).length > LIMITE_JSON_CONTENIDO) return { ok: false, mensaje: "El contenido es demasiado grande." };
  return { ok: true, borrador: limpio };
}

/** Código público desde un nombre: minúsculas, sin tildes, guiones. */
export function claveDesdeTexto(valor: string, prefijo: string): string {
  const base = valor
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || prefijo;
}
