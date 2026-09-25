/**
 * Publi Bordados · módulo Clientes — modelo PURO (sin I/O).
 *
 *   CLIENTE   = el contacto real (dulabs_clientes_conocidos), único por número + teléfono.
 *   SOLICITUD = cada flow completado (dulabs_pb_solicitudes), con su propio estado y asesor.
 *
 * Un cliente tiene N solicitudes; ninguna sobrescribe a otra. El perfil que se muestra del
 * cliente (tipo, nombre, empresa) es el de su última solicitud; si todavía no tiene (clientes
 * del flujo anterior), el que quedó guardado en el contacto.
 */

export const ESTADOS = ["nuevo", "en_atencion", "atendido"] as const;
export type EstadoSolicitud = (typeof ESTADOS)[number];

export const TIPOS = ["persona_natural", "empresa"] as const;
export type TipoCliente = (typeof TIPOS)[number];

export const PRODUCTOS = ["gorras", "prendas_de_vestir", "uniformes", "otros"] as const;
export type Producto = (typeof PRODUCTOS)[number];

export const ETIQUETA_ESTADO: Record<EstadoSolicitud, string> = {
  nuevo: "Nuevo",
  en_atencion: "En atención",
  atendido: "Atendido",
};
export const ETIQUETA_TIPO: Record<TipoCliente, string> = {
  persona_natural: "Persona natural",
  empresa: "Empresa",
};
export const ETIQUETA_PRODUCTO: Record<Producto, string> = {
  gorras: "Gorras",
  prendas_de_vestir: "Prendas de vestir",
  uniformes: "Uniformes",
  otros: "Otros",
};

export const esEstado = (v: unknown): v is EstadoSolicitud => typeof v === "string" && (ESTADOS as readonly string[]).includes(v);
export const esTipo = (v: unknown): v is TipoCliente => typeof v === "string" && (TIPOS as readonly string[]).includes(v);
export const esProducto = (v: unknown): v is Producto => typeof v === "string" && (PRODUCTOS as readonly string[]).includes(v);

export const etiquetaProducto = (p: string | null | undefined): string | null =>
  p ? (esProducto(p) ? ETIQUETA_PRODUCTO[p] : p) : null;

export const TAMANO_PAGINA = 25;

export interface Asesor {
  id: number;
  nombre: string;
}

// ---------------------------------------------------------------------------
// Solicitud
// ---------------------------------------------------------------------------

/** Fila tal como la devuelven las funciones SQL (dulabs_pb_solicitud_json). */
export interface SolicitudDb {
  id: number;
  clienteId: number;
  telefono: string;
  tipoCliente: TipoCliente;
  nombre: string;
  nombreEmpresa: string | null;
  producto: Producto;
  cantidad: number;
  estado: EstadoSolicitud;
  asesorId: number | null;
  asignadoAt: string | null;
  atendidoAt: string | null;
  version: number;
  flowExecutionId: string;
  eventoId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Solicitud extends Omit<SolicitudDb, "asesorId"> {
  productoEtiqueta: string;
  asesor: Asesor | null;
}

/** Nombres de TODO el equipo (incluidos suspendidos: un asesor asignado se sigue viendo). */
export type NombresEquipo = ReadonlyMap<number, string>;

function asesorDe(id: number | null | undefined, nombres: NombresEquipo): Asesor | null {
  if (id === null || id === undefined) return null;
  const nombre = nombres.get(id);
  return nombre === undefined ? null : { id, nombre };
}

export function aSolicitud(fila: SolicitudDb, nombres: NombresEquipo): Solicitud {
  const { asesorId, ...resto } = fila;
  return { ...resto, productoEtiqueta: etiquetaProducto(fila.producto) ?? fila.producto, asesor: asesorDe(asesorId, nombres) };
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

export interface ClienteDb {
  id: number;
  telefono: string;
  tipoCliente: TipoCliente | null;
  nombre: string;
  nombreEmpresa: string | null;
  registradoAt: string;
  totalSolicitudes: number;
  ultimaSolicitudAt: string | null;
  ultimaSolicitud: { id: number; producto: Producto; cantidad: number; estado: EstadoSolicitud; asesorId: number | null } | null;
  ultimoContactoAt: string | null;
}

export interface Cliente extends Omit<ClienteDb, "ultimaSolicitud"> {
  ultimaSolicitud: {
    id: number;
    producto: Producto;
    productoEtiqueta: string;
    cantidad: number;
    estado: EstadoSolicitud;
    asesor: Asesor | null;
  } | null;
}

export function aCliente(fila: ClienteDb, nombres: NombresEquipo): Cliente {
  const u = fila.ultimaSolicitud;
  return {
    ...fila,
    tipoCliente: esTipo(fila.tipoCliente) ? fila.tipoCliente : null,
    ultimaSolicitud: u
      ? { id: u.id, producto: u.producto, productoEtiqueta: etiquetaProducto(u.producto) ?? u.producto, cantidad: u.cantidad, estado: u.estado, asesor: asesorDe(u.asesorId, nombres) }
      : null,
  };
}

export interface ClienteDetalleDb {
  cliente: {
    id: number;
    telefono: string;
    registradoAt: string;
    tipoCliente: TipoCliente | null;
    nombre: string;
    nombreEmpresa: string | null;
    totalSolicitudes: number;
    ultimoContactoAt: string | null;
    /** Datos del flujo anterior (antes de existir solicitudes); solo informativos. */
    datosAnteriores: { producto: string | null; cantidad: string | null } | null;
  };
  solicitudes: SolicitudDb[];
}

export interface ClienteDetalle {
  cliente: ClienteDetalleDb["cliente"] & { datosAnteriores: { producto: string | null; cantidad: string | null } | null };
  solicitudes: Solicitud[];
}

export function aClienteDetalle(detalle: ClienteDetalleDb, nombres: NombresEquipo): ClienteDetalle {
  const anteriores = detalle.cliente.datosAnteriores;
  return {
    cliente: {
      ...detalle.cliente,
      tipoCliente: esTipo(detalle.cliente.tipoCliente) ? detalle.cliente.tipoCliente : null,
      datosAnteriores: anteriores ? { producto: etiquetaProducto(anteriores.producto), cantidad: anteriores.cantidad } : null,
    },
    solicitudes: detalle.solicitudes.map((s) => aSolicitud(s, nombres)),
  };
}

// ---------------------------------------------------------------------------
// Filtros (query string) — nunca se confía en lo que manda el navegador
// ---------------------------------------------------------------------------

export interface FiltroClientes {
  q?: string;
  tipo?: TipoCliente;
}

export interface FiltroSolicitudes {
  q?: string;
  estado?: EstadoSolicitud;
  tipo?: TipoCliente;
  producto?: Producto;
  asesorId?: number;
  sinAsesor?: boolean;
  /** Fechas de Colombia (YYYY-MM-DD), ambos extremos incluidos. */
  desde?: string;
  hasta?: string;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(v: string | null): string | undefined {
  if (!v || !FECHA.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00-05:00`);
  return Number.isNaN(d.getTime()) ? undefined : v;
}

function textoBusqueda(v: string | null): string | undefined {
  const q = (v ?? "").trim().slice(0, 100);
  return q || undefined;
}

export function leerPagina(params: URLSearchParams): number {
  const n = Number(params.get("pagina") ?? "1");
  return Number.isSafeInteger(n) && n >= 1 ? Math.min(n, 100_000) : 1;
}

export function leerFiltroClientes(params: URLSearchParams): FiltroClientes {
  const tipo = params.get("tipo");
  return { q: textoBusqueda(params.get("q")), tipo: esTipo(tipo) ? tipo : undefined };
}

export function leerFiltroSolicitudes(params: URLSearchParams): FiltroSolicitudes {
  const estado = params.get("estado");
  const tipo = params.get("tipo");
  const producto = params.get("producto");
  const asesor = params.get("asesor");
  const asesorId = asesor && /^\d{1,15}$/.test(asesor) ? Number(asesor) : undefined;
  return {
    q: textoBusqueda(params.get("q")),
    estado: esEstado(estado) ? estado : undefined,
    tipo: esTipo(tipo) ? tipo : undefined,
    producto: esProducto(producto) ? producto : undefined,
    asesorId: asesorId && asesorId > 0 ? asesorId : undefined,
    sinAsesor: asesor === "ninguno" ? true : undefined,
    desde: fechaValida(params.get("desde")),
    hasta: fechaValida(params.get("hasta")),
  };
}

/** Filtro → parámetros de dulabs_pb_listar_solicitudes (fechas de Colombia → instantes). */
export function filtroSolicitudesSql(filtro: FiltroSolicitudes, pagina: number): Record<string, unknown> {
  const sql: Record<string, unknown> = { limite: TAMANO_PAGINA, offset: (pagina - 1) * TAMANO_PAGINA };
  if (filtro.q) sql.q = filtro.q;
  if (filtro.estado) sql.estado = filtro.estado;
  if (filtro.tipo) sql.tipo = filtro.tipo;
  if (filtro.producto) sql.producto = filtro.producto;
  if (filtro.asesorId) sql.asesorId = filtro.asesorId;
  if (filtro.sinAsesor) sql.sinAsesor = true;
  if (filtro.desde) sql.desde = `${filtro.desde}T00:00:00-05:00`;
  if (filtro.hasta) {
    const fin = new Date(`${filtro.hasta}T00:00:00-05:00`);
    fin.setUTCDate(fin.getUTCDate() + 1);
    sql.hasta = fin.toISOString();
  }
  return sql;
}

export function filtroClientesSql(filtro: FiltroClientes, pagina: number): Record<string, unknown> {
  const sql: Record<string, unknown> = { limite: TAMANO_PAGINA, offset: (pagina - 1) * TAMANO_PAGINA };
  if (filtro.q) sql.q = filtro.q;
  if (filtro.tipo) sql.tipo = filtro.tipo;
  return sql;
}

// ---------------------------------------------------------------------------
// Cambio de una solicitud (lo ÚNICO editable: estado y asesor)
// ---------------------------------------------------------------------------

export type CambioSolicitud = { version: number; estado?: EstadoSolicitud; asesorId?: number | null };

export function validarCambioSolicitud(body: unknown): { ok: true; cambio: CambioSolicitud } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Cuerpo inválido" };
  const b = body as Record<string, unknown>;
  const desconocidos = Object.keys(b).filter((k) => k !== "estado" && k !== "asesorId" && k !== "version");
  if (desconocidos.length > 0) return { ok: false, error: `Campo no permitido: ${desconocidos[0]}` };
  if (typeof b.version !== "number" || !Number.isSafeInteger(b.version) || b.version < 1) return { ok: false, error: "Falta la versión de la solicitud" };
  const cambio: CambioSolicitud = { version: b.version };
  if ("estado" in b) {
    if (!esEstado(b.estado)) return { ok: false, error: "Estado inválido" };
    cambio.estado = b.estado;
  }
  if ("asesorId" in b) {
    if (b.asesorId === null) cambio.asesorId = null;
    else if (typeof b.asesorId === "number" && Number.isSafeInteger(b.asesorId) && b.asesorId > 0) cambio.asesorId = b.asesorId;
    else return { ok: false, error: "Asesor inválido" };
  }
  if (!("estado" in cambio) && !("asesorId" in cambio)) return { ok: false, error: "Nada que cambiar" };
  return { ok: true, cambio };
}

/** Id numérico de la URL; cualquier otra cosa → null (la API responde 404). */
export function leerId(valor: string): number | null {
  if (!/^\d{1,15}$/.test(valor)) return null;
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
