/**
 * INTÉRPRETE DETERMINISTA del lenguaje del cliente (Bloque 28).
 *
 *   mensaje -> normalizar() -> [¿pregunta? ¿salida? ¿duda? ¿espera? ¿corrección? ¿cantidad? ¿dato del paso?]
 *
 * Funciones PURAS sobre el léxico declarativo (lexico.ts). Solo reconocen las respuestas a las preguntas
 * del BACKEND (entrega, pago, nombre, dirección, ciudad, cantidades, salidas) y separan lo que NO es una
 * respuesta (una pregunta, una intención, una risa). El lenguaje libre (buscar, describir, opinar) lo
 * interpreta el modelo; las reglas comerciales (precio, stock, modalidad, estado) las decide el backend.
 *
 * Regla de oro: ante la duda, null (el backend pregunta). Nunca se adivina un dato.
 */
import {
  AFIRMACIONES,
  ANTES_DE_CANTIDAD,
  ANUNCIA_DIRECCION,
  CAMBIO_PRODUCTO,
  COMPRA_PEDIDO,
  CONECTORES_OPCION,
  CORTESIA,
  DESPUES_DE_CANTIDAD,
  DETAL_INICIAL,
  DUDA,
  ENTREGA,
  ESPERA,
  INICIO_DE_PREGUNTA,
  MARCADORES_CORRECCION,
  MARCAS_DIRECCION,
  MAYOR_INICIAL,
  NOMBRE_COMERCIAL,
  NEGACIONES,
  NO_ES_NOMBRE,
  NUMEROS_EN_LETRAS,
  PAGO,
  PALABRAS_PRODUCTO,
  PIDE_CATALOGO,
  PREFIJOS_DIRECCION,
  PREFIJOS_NOMBRE,
  QUITAR,
  RESTAR_UNO,
  SALIDA_CANCELAR,
  SALIDA_MODIFICAR,
  SALUDOS,
  SUMAR_UNO,
  UBICACION_VAGA,
  UNIDADES,
  VERBOS_PRODUCTO,
} from "@/lib/agente/lenguaje/lexico";
import { contieneFrase, normalizar, plano } from "@/lib/agente/lenguaje/normalizar";

type Entrega = "tienda" | "domicilio";
type Pago = "pago_en_tienda" | "transferencia";

const alguna = (t: string, frases: readonly string[]) => frases.some((f) => contieneFrase(t, f));
const una = (t: string, frases: readonly string[]) => (frases as readonly string[]).includes(t);
/** Texto normalizado sin "por favor" ni cortesía al final. */
const sinCortesia = (t: string) => t.replace(/\b(por favor|gracias)\b/g, " ").replace(/\s+/g, " ").trim();
/** Quita saludos o muletillas iniciales ("hola, …", "ok …", "bueno …"). */
const sinMuletilla = (t: string) => t.replace(/^(hola|buenas|buenos dias|buenas tardes|buenas noches|ok|listo|perfecto|dale|bueno|oye|ey|hey)( |$)/, "").trim();

// ---------------------------------------------------------------------------
// Tipo de mensaje
// ---------------------------------------------------------------------------

/** ¿Es una PREGUNTA? ("?", "¿", o empieza por "cuánto", "dónde", "puedo", "hay"…). Una pregunta nunca es un dato. */
export function esPregunta(text: string): boolean {
  if (/[?¿]/.test(text)) return true;
  const t = sinMuletilla(normalizar(text));
  return INICIO_DE_PREGUNTA.some((p) => t === p || t.startsWith(`${p} `));
}

export const esRisa = (text: string) => /^(?:(?:ja|je|ji|jo|ha|he|xd|lol|jaj|jej)+\s*)+$/.test(plano(text).replace(/\s+/g, ""));
export const esSaludo = (text: string) => una(sinCortesia(normalizar(text)), SALUDOS);
export const esCortesia = (text: string) => una(normalizar(text), CORTESIA);
export const esAfirmacion = (text: string) => una(sinCortesia(normalizar(text)), AFIRMACIONES);
export const esNegacion = (text: string) => una(sinCortesia(normalizar(text)), NEGACIONES);
export const esEspera = (text: string) => una(sinCortesia(normalizar(text)), ESPERA);
export const anunciaDireccion = (text: string) => {
  const t = sinCortesia(normalizar(text));
  return !/\d/.test(t) && (una(t, ANUNCIA_DIRECCION) || alguna(t, ANUNCIA_DIRECCION));
};
/** Mensaje sin contenido útil para un dato (risa, saludo, "ok", "gracias", "espera"). */
export const esRelleno = (text: string) => esRisa(text) || esSaludo(text) || esCortesia(text) || esAfirmacion(text) || esNegacion(text) || esEspera(text);

/** Salida del checkout con el mensaje COMPLETO: cancelar, volver a la selección, o dudar (sin decir qué). */
export function leerSalida(text: string): "cancel" | "modify" | "doubt" | null {
  const t = sinCortesia(normalizar(text));
  if (!t) return null;
  if (una(t, SALIDA_CANCELAR)) return "cancel";
  if (una(t, SALIDA_MODIFICAR)) return "modify";
  if (una(t, DUDA)) return "doubt";
  return null;
}

// ---------------------------------------------------------------------------
// Entrega y pago
// ---------------------------------------------------------------------------

/** ¿El texto (normalizado) nombra el PAGO? ("pago", "pagar", "efectivo", "transferencia", "nequi"…). */
const nombraPago = (t: string) => /\b(pago|pagar|pagaria|pagarlo|efectivo|presencial|transferencia|transferir|transfiero|nequi|daviplata|bancolombia|pse|consignacion|consignar|consigno)\b/.test(t);

/** Entrega nombrada en el texto (botón o palabras). Las dos o ninguna => null. No mira si es pregunta: eso lo decide quien llama. */
export function leerEntrega(text: string): Entrega | null {
  const t = normalizar(text);
  if (!t || t.length > 120) return null;
  const tienda = alguna(t, ENTREGA.tienda);
  const casa = alguna(t, ENTREGA.domicilio);
  return tienda === casa ? null : tienda ? "tienda" : "domicilio";
}

/**
 * Pago nombrado en el texto. "Cuando llegue" / "contra entrega" dependen de la entrega: con recoger en
 * tienda es pago en tienda; con domicilio sería contra entrega, que no se ofrece => "no_disponible".
 */
export function leerPago(text: string, entrega: Entrega | null = null): Pago | "no_disponible" | null {
  const t = normalizar(text);
  if (!t || t.length > 120) return null;
  const transfer = alguna(t, PAGO.transferencia);
  const segun = alguna(t, PAGO.segun_entrega);
  const tienda = alguna(t, PAGO.pago_en_tienda) || (segun && entrega === "tienda");
  if (segun && !transfer && !tienda && entrega === "domicilio") return "no_disponible";
  if (tienda === transfer) return null;
  return tienda ? "pago_en_tienda" : "transferencia";
}

/**
 * CORRECCIÓN de entrega y/o pago en cualquier paso ("no, mejor recojo en tienda", "mejor transferencia",
 * "perdón, era domicilio"). Estricta para no confundir una dirección con una corrección: sin números,
 * sin pregunta, corta (≤ 8 palabras) y con marcador de corrección o formada SOLO por la opción.
 */
/** Palabras que forman las opciones de entrega y pago, más sus conectores. */
const PALABRAS_DE_OPCION = new Set([...CONECTORES_OPCION, ...[...ENTREGA.tienda, ...ENTREGA.domicilio, ...PAGO.pago_en_tienda, ...PAGO.transferencia].flatMap((f) => f.split(" "))]);

export function leerCorreccion(text: string, entregaActual: Entrega | null): { entrega?: Entrega; pago?: Pago } | null {
  if (esPregunta(text) || /\d/.test(text)) return null;
  const t = sinCortesia(normalizar(text));
  const ws = t.split(" ").filter(Boolean);
  if (ws.length === 0 || ws.length > 8) return null;
  const marcador = MARCADORES_CORRECCION.some((m) => t === m || t.startsWith(`${m} `) || contieneFrase(t, m));
  // Sin marcador, solo si el mensaje ES la opción ("domicilio", "transferencia", "recoger en tienda").
  // y sin palabras propias: "Tienda Mayorista Luna" es un nombre, no "recoger en tienda".
  const soloOpcion = ws.length <= 4 && ws.every((w) => PALABRAS_DE_OPCION.has(w));
  if (!marcador && !soloOpcion) return null;
  // "pago en tienda" nombra el PAGO, no la entrega: se lee primero el pago y la entrega sin esas frases.
  // El pago solo se corrige si se NOMBRA ("mejor transferencia", "pago allá"); "recojo en tienda" es la entrega.
  const pago = nombraPago(t) ? leerPago(text, entregaActual) : null;
  const sinFrasesDePago = ` ${t} `.replace(/ pago en tienda | pago en el local | efectivo en tienda | pago al recoger | al recoger /g, " ").trim();
  const entrega = /\bpago\b|\bpagar\b|\befectivo\b/.test(t) && !alguna(t, ["recoger", "recojo", "domicilio", "envio", "lo recojo", "voy a recoger"]) ? null : leerEntrega(sinFrasesDePago);
  const out: { entrega?: Entrega; pago?: Pago } = {};
  if (entrega) out.entrega = entrega;
  if (pago === "pago_en_tienda" || pago === "transferencia") out.pago = pago;
  return out.entrega || out.pago ? out : null;
}

// ---------------------------------------------------------------------------
// Cantidades
// ---------------------------------------------------------------------------

export type Cantidad = { tipo: "fijar"; n: number } | { tipo: "sumar"; n: 1 } | { tipo: "restar"; n: 1 };

const NUM = (w: string): number | null => (/^\d{1,2}$/.test(w) ? Number(w) : (NUMEROS_EN_LETRAS[w] ?? null));

/**
 * Mensaje que SOLO dice una cantidad (sin nombrar un producto nuevo): "2", "x2", "2x", "dos unidades",
 * "2 und", "2uds", "me llevo dos", "quiero dos de esos", "eran 3", "no, mejor 3", "eran 3 no 2",
 * "cambia a 4", "uno más", "quita uno". null si trae algo más (un producto, una pregunta).
 */
export function leerCantidad(text: string): Cantidad | null {
  if (esPregunta(text)) return null;
  let t = sinCortesia(normalizar(text));
  if (!t || t.length > 60) return null;
  if (una(t, SUMAR_UNO)) return { tipo: "sumar", n: 1 };
  if (una(t, RESTAR_UNO)) return { tipo: "restar", n: 1 };
  // Prefijos ("quiero", "no mejor", "eran", "cambia a"…), del más largo al más corto, las veces que haga falta.
  const antes = [...ANTES_DE_CANTIDAD].sort((a, b) => b.length - a.length);
  for (let guard = 0; guard < 6; guard++) {
    const p = antes.find((x) => t.startsWith(`${x} `));
    if (!p) break;
    t = t.slice(p.length + 1).trim();
  }
  // Número: "2", "x2", "2x", "2u", "2und", "2uds", "x 2", "dos".
  const ws = t.split(" ").filter(Boolean);
  let n: number | null = null;
  let i = 0;
  if (ws[0] === "x" && ws[1] && NUM(ws[1]) !== null) {
    n = NUM(ws[1]);
    i = 2;
  } else if (ws[0]) {
    const m = /^(?:x)?(\d{1,2})(?:x|u|und|unds|ud|uds|pz|pzs)?$/.exec(ws[0]);
    n = m ? Number(m[1]) : NUM(ws[0]);
    i = 1;
  }
  if (n === null || n < 1 || n > 99) return null;
  if (ws[i] && (UNIDADES as readonly string[]).includes(ws[i])) i++;
  if (ws[i] === "x") i++;
  const resto = ws.slice(i).join(" ");
  // Lo que queda solo puede ser "de esos", "no 2" (corrección: "eran 3 no 2") o nada.
  if (resto && !una(resto, DESPUES_DE_CANTIDAD) && !/^no (\d{1,2}|[a-z]+)$/.test(resto)) return null;
  return { tipo: "fijar", n };
}

/**
 * Números que ESCRIBIÓ el cliente ("x2", "2 und", "dos", "una"): respaldan una cantidad del carrito.
 * Solo respaldan: nunca eligen producto ni cantidad por sí mismos.
 */
export function numerosDelCliente(text: string): Set<number> {
  const out = new Set<number>();
  const t = normalizar(text);
  for (const m of t.matchAll(/(?:^|\s)x?(\d{1,2})(?:x|u|und|unds|ud|uds)?(?=\s|$)/g)) out.add(Number(m[1]));
  for (const w of t.split(" ")) if (w in NUMEROS_EN_LETRAS) out.add(NUMEROS_EN_LETRAS[w]);
  return out;
}

/** "quita ese", "borra el primero", "no quiero ese", "elimina el dorado": quitar un producto (cuál: lo resuelve la selección). */
export function pideQuitar(text: string): boolean {
  if (esPregunta(text)) return false;
  const t = sinCortesia(normalizar(text));
  if (!t || t.split(" ").length > 8 || leerCantidad(text)) return false;
  // Siempre con un objetivo ("quita ese", "borra el primero"): "no quiero" solo no dice qué.
  return QUITAR.some((q) => t.startsWith(`${q} `));
}

/**
 * Pide ELEGIR o AGREGAR un producto ("quiero dos aretes", "también quiero ese", "agrégame el collar"):
 * verbo de elegir + joya o deíctico, sin números de dirección. Dentro del checkout no es un dato del paso.
 */
export function pideProducto(text: string): boolean {
  if (/\d/.test(text)) return false;
  const t = sinCortesia(normalizar(text));
  if (!t || t.split(" ").length > 12) return false;
  if (una(t, CAMBIO_PRODUCTO)) return true;
  return VERBOS_PRODUCTO.some((v) => t === v || t.startsWith(`${v} `) || contieneFrase(t, v)) && alguna(t, PALABRAS_PRODUCTO);
}

/** Pide el catálogo o un enlace ("pásame el catálogo", "mándame el link", "catologo"). */
export function pideCatalogo(text: string): boolean {
  const t = normalizar(text);
  return t.length > 0 && t.split(" ").length <= 10 && alguna(t, PIDE_CATALOGO);
}

// ---------------------------------------------------------------------------
// Nombre, dirección y ciudad (se guardan TAL COMO los escribió el cliente)
// ---------------------------------------------------------------------------

/** Quita un prefijo (comparando en forma plana) y devuelve el resto del texto ORIGINAL. */
function quitarPrefijo(raw: string, prefijos: readonly string[]): string {
  const p = plano(raw);
  const pref = [...prefijos].sort((a, b) => b.length - a.length).find((x) => p === x || p.startsWith(`${x} `));
  if (!pref) return raw;
  const n = pref.split(" ").length;
  return raw.trim().split(/\s+/).slice(n).join(" ").replace(/^[\s:,.-]+/, "");
}

/**
 * Nombre de la persona: "María", "María Fernanda", "Juan Pérez", "Soy Carlos", "Me llamo Andrés",
 * "es Duvan", "a nombre de Ana". NUNCA una intención ("quiero dos aretes"), una pregunta, una risa,
 * un número o una respuesta corta ("ok", "sí").
 */
export function leerNombre(text: string): string | null {
  let raw = text.trim().replace(/\s+/g, " ").replace(/[.!,;]+$/g, "").trim();
  if (!raw || raw.length > 80 || /[?¿\d@#/]/.test(raw)) return null;
  if (esRelleno(raw)) return null;
  raw = quitarPrefijo(raw, PREFIJOS_NOMBRE).trim();
  if (raw.length < 2 || raw.length > 60) return null;
  if (!/^\p{L}[\p{L} .'’-]*$/u.test(raw)) return null;
  const ws = raw.split(" ").filter(Boolean);
  if (ws.length > 5 || !ws.some((w) => w.replace(/[.'’-]/g, "").length >= 2)) return null;
  if (!sinIntencionDeNombre(raw)) return null;
  if (esRelleno(raw)) return null;
  return raw;
}

/**
 * ¿Las palabras pueden ser un nombre? Ninguna intención/pregunta/producto (NO_ES_NOMBRE). Las palabras de
 * negocio ("tienda", "mayorista", "joyas") valen solo junto a una palabra propia ("Tienda Mayorista Luna").
 */
export function sinIntencionDeNombre(nombre: string): boolean {
  const ws = normalizar(nombre).split(" ").filter(Boolean);
  if (ws.some((w) => NO_ES_NOMBRE.has(w) && !NOMBRE_COMERCIAL.has(w))) return false;
  if (!ws.some((w) => NOMBRE_COMERCIAL.has(w))) return true;
  return ws.some((w) => !NOMBRE_COMERCIAL.has(w) && !CONECTORES_OPCION.has(w) && w.length >= 2);
}

export type LecturaDireccion = { tipo: "ok"; valor: string } | { tipo: "vaga" } | { tipo: "anuncio" } | null;

/**
 * Dirección: "calle 30 # 12-40", "Cra 7 # 20-15", "mi dirección es …", "en Montería, barrio La Castellana".
 * Sin calle/número/barrio ("vivo por el centro") => "vaga" (se pide la exacta). Una pregunta, una intención
 * ("quiero ese", "mejor tienda") o un relleno ("jajaja", "ok", "espera") => null. "Te mando la dirección" => "anuncio".
 */
export function leerDireccion(text: string): LecturaDireccion {
  const raw = text.trim().replace(/\s+/g, " ");
  if (raw.length < 3 || raw.length > 300) return null;
  if (anunciaDireccion(raw)) return { tipo: "anuncio" };
  if (esPregunta(raw) || esRelleno(raw)) return null;
  const valor = quitarPrefijo(raw, PREFIJOS_DIRECCION).trim();
  if (valor.length < 3) return null;
  const ws = plano(valor).split(" ").filter(Boolean);
  const numero = /\d/.test(valor);
  const marca = /#/.test(valor) || ws.some((w) => MARCAS_DIRECCION.has(w));
  const intencion = ws.some((w) => ["quiero", "comprar", "pedido", "precio", "cuanto", "catalogo", "ese", "esa", "este", "esta", "aretes", "collar", "dije", "dijes", "pulsera", "anillo", "tienda", "recoger", "recojo", "transferencia", "efectivo"].includes(w));
  if (numero || marca) {
    if (!numero && (intencion || leerEntrega(valor) || leerPago(valor))) return null;
    // Suficiente: calle y número de casa ("Calle 20 # 10-15", "Mz 3 casa 5"), un lugar con número
    // ("barrio X casa 12") o una dirección rural (finca, vereda, km). "calle 20" o "por la 30" no bastan.
    const grupos = (valor.match(/\d+/g) ?? []).length;
    const rural = ws.some((w) => ["finca", "vereda", "km", "kilometro", "corregimiento", "hacienda", "parcela"].includes(w));
    const lugar = ws.some((w) => ["barrio", "br", "conjunto", "urbanizacion", "urb", "edificio", "edif", "condominio", "torre", "bloque", "manzana", "mz", "mza", "casa", "apto", "apartamento", "apt", "ap", "lote", "local", "interior", "int", "piso", "oficina"].includes(w));
    if (grupos >= 2 || rural || (grupos >= 1 && lugar)) return { tipo: "ok", valor };
    return { tipo: "vaga" };
  }
  if (intencion || leerEntrega(valor) || leerPago(valor)) return null;
  if (alguna(normalizar(valor), UBICACION_VAGA) || ws.length >= 2) return { tipo: "vaga" };
  return null;
}

/** Ciudad: "Montería", "Santa Marta", "Bogotá D.C.". Nunca una pregunta, un número, una intención ni un relleno. */
export function leerCiudad(text: string): string | null {
  let raw = text.trim().replace(/\s+/g, " ").replace(/[!,;]+$/g, "").trim();
  if (!raw || raw.length > 80 || esPregunta(raw) || /\d/.test(raw) || esRelleno(raw) || anunciaDireccion(raw)) return null;
  raw = quitarPrefijo(raw, ["vivo en", "estoy en", "soy de", "somos de", "queda en", "la ciudad es", "mi ciudad es", "ciudad", "en la ciudad de", "en", "es en", "es", "de"]).trim();
  if (raw.length < 2 || !/^\p{L}[\p{L} .'’-]*$/u.test(raw) || raw.split(" ").length > 5) return null;
  const ws = normalizar(raw).split(" ");
  if (ws.some((w) => NO_ES_NOMBRE.has(w) && !["de", "la", "el", "los", "las"].includes(w))) return null;
  if (leerEntrega(raw) || leerPago(raw)) return null;
  return raw;
}

// ---------------------------------------------------------------------------
// Varias intenciones en un mensaje ("soy Laura, quiero el segundo, domicilio y transferencia")
// ---------------------------------------------------------------------------

/**
 * Datos del checkout que el cliente YA dijo en el mismo mensaje con el que pidió comprar. Se separa
 * por comas / "y" / "pero"; los fragmentos con pregunta se ignoran (nunca mutan nada). Solo se usan
 * para llenar campos VACÍOS; el resumen y el botón siguen siendo obligatorios.
 */
export function pistasCheckout(text: string): { nombre?: string; entrega?: Entrega; pago?: Pago } {
  const out: { nombre?: string; entrega?: Entrega; pago?: Pago } = {};
  const partes = text.split(/[,.;\n]+|\s+y\s+|\s+pero\s+|\s+ademas\s+/i).map((s) => s.trim()).filter(Boolean);
  for (const parte of partes) {
    if (esPregunta(parte) || /\d/.test(parte) || parte.split(/\s+/).length > 7) continue;
    const p = plano(parte);
    if (!out.nombre && /^(soy|me llamo|mi nombre es|a nombre de)\s/.test(p)) {
      const n = leerNombre(parte);
      if (n) out.nombre = n;
      continue;
    }
    const e = leerEntrega(parte);
    const pg = leerPago(parte, out.entrega ?? null);
    if (!out.pago && (pg === "pago_en_tienda" || pg === "transferencia") && nombraPago(normalizar(parte))) out.pago = pg;
    else if (!out.entrega && e) out.entrega = e;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Compra (a nivel de pedido) y modalidad inicial
// ---------------------------------------------------------------------------

/** Frases que piden pasar al pedido con lo que ya eligió ("quiero el pedido", "hagamos el pedido", "kiero el pedido"). */
export function pideElPedido(text: string): boolean {
  const t = sinCortesia(normalizar(text));
  return t.length > 0 && t.length <= 60 && (una(t, COMPRA_PEDIDO) || una(sinMuletilla(t), COMPRA_PEDIDO));
}

/**
 * Modalidad en la PRIMERA respuesta (antes de estar clasificado). Inferir detal es seguro (es el canal
 * restrictivo): "soy particular", "es para mí". Mayorista SOLO con la palabra ("mayor", "mayorista",
 * "por mallor"). "Tengo una tienda", "soy empresa", "vendo joyas" => null: se vuelve a preguntar.
 */
export function modalidadInicial(text: string): "retail" | "wholesale" | null {
  const t = sinMuletilla(sinCortesia(normalizar(text)));
  if (una(t, MAYOR_INICIAL)) return "wholesale";
  if (una(t, DETAL_INICIAL)) return "retail";
  return null;
}
