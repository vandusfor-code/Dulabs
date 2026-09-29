/**
 * Bloque 33 — módulo CLIENTES (catálogo / joyería): un cliente por contacto de WhatsApp.
 *
 * Tipos, lectura de filtros y exportación CSV (puro, sin red). El listado lo arma la BD
 * (dulabs_catalogo_clientes_listar) con los pedidos, la modalidad del contacto y sus mensajes; lo
 * único propio del módulo es la NOTA interna del equipo (con versión: compare-and-set).
 */
import type { OrderChannel } from "@/lib/catalogo/pedidos/contrato";
import type { CustomerChannelEvent, CustomerChannelOrigin } from "@/lib/agente/clasificacion";

export const FILTROS_CLIENTES = ["todos", "detal", "mayorista", "compraron", "sin_compras", "registrados"] as const;
export type FiltroClientes = (typeof FILTROS_CLIENTES)[number];

export const CLIENTES_POR_PAGINA = 25;
/** Tope de la exportación (una descarga, sin paginar). */
export const CLIENTES_EXPORTAR_MAX = 5000;
export const NOTA_MAX = 1000;

/** Una fila del listado (lo que devuelve la BD, ya en camelCase). */
export interface ClienteFila {
  phoneNumberId: string;
  waId: string;
  canal: OrderChannel | null;
  origen: CustomerChannelOrigin | null;
  nombre: string | null;
  /** Pedidos que llegaron a confirmarse alguna vez. */
  pedidos: number;
  /** Pedidos confirmados o completados (compras reales). */
  compras: number;
  /** Suma de las compras (COP). */
  totalComprado: number;
  ultimoPedido: string | null;
  ultimoEstado: string | null;
  ultimaEtapa: string | null;
  ultimoPedidoAt: string | null;
  ciudad: string | null;
  primerContacto: string | null;
  ultimoContacto: string | null;
  tieneNota: boolean;
  /** Bloque 34: ya es cliente del negocio (compró antes, fuera del bot): sin compra inicial mayorista. */
  yaCompro: boolean;
  /** Bloque 34: lo registró el equipo (formulario o Excel). */
  registrado: boolean;
}

export interface PedidoDeCliente {
  pedido: string;
  estado: string;
  etapa: string | null;
  estadoPago: string | null;
  canal: OrderChannel;
  total: number;
  entrega: string | null;
  ciudad: string | null;
  creado: string;
  confirmado: string | null;
}

export interface NotaCliente {
  texto: string;
  version: number;
  actualizadoPor: number | null;
  actualizadoAt: string;
}

export interface ClienteDetalle {
  cliente: ClienteFila;
  pedidos: PedidoDeCliente[];
  modalidad: { canal: OrderChannel; origen: CustomerChannelOrigin; historial: CustomerChannelEvent[] } | null;
  nota: NotaCliente | null;
}

export interface ConsultaClientes {
  q: string | null;
  filtro: FiltroClientes;
  pagina: number;
}

/** Filtros del listado desde la URL (todo validado; lo inválido cae al valor por defecto). */
export function leerConsulta(params: URLSearchParams): ConsultaClientes {
  const q = (params.get("q") ?? "").trim().slice(0, 60) || null;
  const f = params.get("filtro");
  const filtro = (FILTROS_CLIENTES as readonly string[]).includes(f ?? "") ? (f as FiltroClientes) : "todos";
  const n = Number.parseInt(params.get("pagina") ?? "1", 10);
  return { q, filtro, pagina: Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1 };
}

/** Clave de un cliente en la URL: `<phone_number_id>_<wa_id>` (ambos numéricos en producción). */
export function claveCliente(phoneNumberId: string, waId: string): string {
  return `${phoneNumberId}_${waId}`;
}

export function leerClave(clave: string): { phoneNumberId: string; waId: string } | null {
  const m = /^([A-Za-z0-9-]{1,64})_([0-9]{6,20})$/.exec(clave);
  return m ? { phoneNumberId: m[1], waId: m[2] } : null;
}

/** Mayorista que aún no compró (ni es cliente antiguo): su primera compra debe llegar a la compra inicial (Bloque 32b). */
export const esMayoristaNuevo = (c: Pick<ClienteFila, "canal" | "compras"> & { yaCompro?: boolean }) => c.canal === "wholesale" && c.compras === 0 && !c.yaCompro;

// ---------------------------------------------------------------------------
// Bloque 34 — registrar clientes (formulario y Excel)
// ---------------------------------------------------------------------------

export type Modalidad = "detal" | "mayorista";
export const CANAL_DE_MODALIDAD: Record<Modalidad, OrderChannel> = { detal: "retail", mayorista: "wholesale" };

/**
 * Celular a formato de WhatsApp (solo dígitos, con indicativo). Colombia por defecto: "300 111 2233",
 * "3001112233", "+57 300 111 2233" y "573001112233" => "573001112233". Otro país: con su indicativo
 * ("+1 305…"). null si no parece un celular.
 */
export function normalizarCelular(texto: string): string | null {
  const d = texto.replace(/\D/g, "");
  if (/^3\d{9}$/.test(d)) return `57${d}`;
  if (/^573\d{9}$/.test(d)) return d;
  if (/^0057(3\d{9})$/.test(d)) return d.slice(2);
  if (d.startsWith("57")) return null; // indicativo de Colombia con un número que no es celular
  return texto.trim().startsWith("+") && /^\d{8,15}$/.test(d) ? d : null;
}

/** Nombre de persona o negocio: 2 a 60 caracteres, con letras. */
export function normalizarNombre(texto: string): string | null {
  const n = texto.replace(/\s+/g, " ").trim();
  return n.length >= 2 && n.length <= 60 && /\p{L}/u.test(n) && !/[<>{}]/.test(n) ? n : null;
}

const planoTexto = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function leerModalidad(texto: string): Modalidad | null {
  const t = planoTexto(texto);
  if (["detal", "al detal", "minorista", "por menor", "al por menor", "retail"].includes(t)) return "detal";
  if (["mayor", "mayorista", "por mayor", "al por mayor", "al mayor", "wholesale"].includes(t)) return "mayorista";
  return null;
}

/** "Ya es cliente": sí / si / x / 1 / true => true; vacío o no => false. */
export function leerSiNo(texto: string): boolean | null {
  const t = planoTexto(texto);
  if (["si", "s", "x", "1", "true", "verdadero", "yes"].includes(t)) return true;
  if (["", "no", "n", "0", "false", "falso"].includes(t)) return false;
  return null;
}

export const IMPORTAR_MAX_FILAS = 500;

export interface FilaImportacion {
  fila: number;
  nombre: string | null;
  telefono: string | null;
  modalidad: Modalidad | null;
  yaCompro: boolean;
  /** nuevo: se crea; actualizar: ya era cliente (se actualizan nombre, modalidad y "ya es cliente"). */
  accion: "nuevo" | "actualizar" | "error";
  motivo: string | null;
}

const COLUMNAS_IMPORTACION: Record<"nombre" | "telefono" | "modalidad" | "ya", readonly string[]> = {
  nombre: ["nombre", "nombres", "cliente", "nombre cliente", "nombre completo"],
  telefono: ["telefono", "celular", "whatsapp", "movil", "numero", "telefono celular"],
  modalidad: ["modalidad", "tipo", "tipo de cliente", "tipo cliente", "canal"],
  ya: ["ya es cliente", "cliente antiguo", "ya compro", "cliente actual", "antiguo"],
};

/**
 * Filas del archivo (la primera = encabezados) => filas a importar con su validación. `existentes`:
 * teléfonos que ya son clientes del negocio. Un teléfono repetido en el archivo cuenta una sola vez.
 */
export function analizarImportacion(tabla: ReadonlyArray<ReadonlyArray<string>>, existentes: ReadonlySet<string>): { filas: FilaImportacion[]; error: string | null } {
  if (tabla.length === 0) return { filas: [], error: "El archivo está vacío." };
  const cab = tabla[0].map((c) => planoTexto(c));
  const col = (k: keyof typeof COLUMNAS_IMPORTACION) => cab.findIndex((c) => COLUMNAS_IMPORTACION[k].includes(c));
  const [cN, cT, cM, cY] = [col("nombre"), col("telefono"), col("modalidad"), col("ya")];
  if (cT < 0 || cN < 0 || cM < 0) return { filas: [], error: "El archivo debe tener las columnas Nombre, Celular y Modalidad (usa la plantilla)." };
  // Número de fila del Excel (1 = encabezados) aunque haya filas vacías en medio.
  const datos = tabla
    .slice(1)
    .map((f, i) => ({ f, n: i + 2 }))
    .filter(({ f }) => f.some((c) => c.trim() !== ""));
  if (datos.length > IMPORTAR_MAX_FILAS) return { filas: [], error: `El archivo tiene ${datos.length} clientes; el máximo por archivo es ${IMPORTAR_MAX_FILAS}.` };
  const vistos = new Set<string>();
  const filas = datos.map(({ f, n }): FilaImportacion => {
    const celda = (c: number) => (c >= 0 ? (f[c] ?? "").trim() : "");
    const nombre = normalizarNombre(celda(cN));
    const telefono = normalizarCelular(celda(cT));
    const modalidad = leerModalidad(celda(cM));
    const ya = leerSiNo(celda(cY));
    const base = { fila: n, nombre, telefono, modalidad, yaCompro: ya === true };
    const error = (motivo: string): FilaImportacion => ({ ...base, accion: "error", motivo });
    if (!telefono) return error(`Celular inválido: "${celda(cT)}"`);
    if (!nombre) return error("Falta el nombre (2 a 60 caracteres).");
    if (!modalidad) return error(`Modalidad inválida: "${celda(cM)}" (escribe detal o mayorista).`);
    if (ya === null) return error(`"Ya es cliente" inválido: "${celda(cY)}" (escribe sí o no).`);
    if (vistos.has(telefono)) return error("Celular repetido en el archivo.");
    vistos.add(telefono);
    return { ...base, accion: existentes.has(telefono) ? "actualizar" : "nuevo", motivo: null };
  });
  return { filas, error: null };
}

/** Plantilla CSV para importar clientes (Excel en español). */
export const PLANTILLA_CLIENTES_CSV = `\uFEFFNombre;Celular;Modalidad;Ya es cliente\r\nCamila Pérez;300 111 2233;mayorista;sí\r\nLuis Gómez;310 444 5566;detal;no\r\n`;

// ---------------------------------------------------------------------------
// Exportación CSV (Excel en español: separador ";" y BOM para las tildes)
// ---------------------------------------------------------------------------

const MODALIDAD: Record<OrderChannel, string> = { retail: "Detal", wholesale: "Mayorista" };

/** Una celda: comillas escapadas; nunca una fórmula (=, +, -, @ al inicio se neutralizan). */
export function celdaCsv(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return "";
  let s = String(valor);
  if (typeof valor === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const fechaCsv = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
/** "57 314 812 7388": con espacios, Excel lo deja como texto (sin notación científica ni fórmula). */
export function telefonoCsv(waId: string): string {
  const m = /^(57)(\d{3})(\d{3})(\d{4})$/.exec(waId);
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : waId.replace(/^(\d{2})(\d+)$/, "$1 $2");
}

export function clientesCsv(filas: readonly ClienteFila[], notas: ReadonlyMap<string, string> = new Map()): string {
  const cabecera = ["Nombre", "Teléfono", "Modalidad", "Pedidos", "Compras", "Total comprado", "Último pedido", "Estado último pedido", "Ciudad", "Primer contacto", "Último contacto", "Nota"];
  const lineas = filas.map((c) =>
    [
      c.nombre,
      telefonoCsv(c.waId),
      c.canal ? MODALIDAD[c.canal] : "",
      c.pedidos,
      c.compras,
      c.totalComprado,
      c.ultimoPedido,
      c.ultimoEstado,
      c.ciudad,
      fechaCsv(c.primerContacto),
      fechaCsv(c.ultimoContacto),
      notas.get(claveCliente(c.phoneNumberId, c.waId)) ?? "",
    ]
      .map(celdaCsv)
      .join(";"),
  );
  return `\uFEFF${[cabecera.join(";"), ...lineas].join("\r\n")}\r\n`;
}
