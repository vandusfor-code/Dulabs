/**
 * Bloque 33 — módulo CLIENTES (catálogo / joyería): un cliente por contacto de WhatsApp.
 *
 * Tipos, lectura de filtros y exportación CSV (puro, sin red). El listado lo arma la BD
 * (dulabs_catalogo_clientes_listar) con los pedidos, la modalidad del contacto y sus mensajes; lo
 * único propio del módulo es la NOTA interna del equipo (con versión: compare-and-set).
 */
import type { OrderChannel } from "@/lib/catalogo/pedidos/contrato";
import type { CustomerChannelEvent, CustomerChannelOrigin } from "@/lib/agente/clasificacion";

export const FILTROS_CLIENTES = ["todos", "detal", "mayorista", "compraron", "sin_compras"] as const;
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

/** Mayorista que aún no compró: su primera compra debe llegar a la compra inicial (Bloque 32b). */
export const esMayoristaNuevo = (c: Pick<ClienteFila, "canal" | "compras">) => c.canal === "wholesale" && c.compras === 0;

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
