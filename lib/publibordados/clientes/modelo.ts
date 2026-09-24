/**
 * Publi Bordados · módulo Clientes (dashboard Business) — modelo PURO, sin I/O.
 *
 * Fuente de verdad: el contacto real existente (dulabs_clientes_conocidos),
 * una fila por (número de WhatsApp del negocio, teléfono del cliente). Los
 * datos viven en custom_fields con prefijo "pb_", con dueños separados:
 *   - el Flow (save_data, lib/flows/publibordados.flow.ts) escribe tipo,
 *     nombre, empresa, producto y cantidad;
 *   - la ficha del cliente escribe SOLO estado y asesor.
 * Ninguno toca las claves del otro. Sin estado guardado = "Nuevo".
 * Sin tabla nueva ni migración.
 */

export const CAMPOS = {
  tipo: "pb_tipo_cliente",
  nombre: "pb_nombre",
  empresa: "pb_nombre_empresa",
  producto: "pb_producto",
  cantidad: "pb_cantidad",
  estado: "pb_estado",
  asesor: "pb_asesor",
} as const;

export const ESTADOS = ["nuevo", "en_atencion", "atendido"] as const;
export type EstadoCliente = (typeof ESTADOS)[number];

export const TIPOS = ["persona_natural", "empresa"] as const;
export type TipoCliente = (typeof TIPOS)[number];

export const PRODUCTOS: Record<string, string> = {
  gorras: "Gorras",
  prendas_de_vestir: "Prendas de vestir",
  uniformes: "Uniformes",
  otros: "Otros",
};

export const ETIQUETA_ESTADO: Record<EstadoCliente, string> = {
  nuevo: "Nuevo",
  en_atencion: "En atención",
  atendido: "Atendido",
};

export const ETIQUETA_TIPO: Record<TipoCliente, string> = {
  persona_natural: "Persona natural",
  empresa: "Empresa",
};

export const esEstado = (v: unknown): v is EstadoCliente => typeof v === "string" && (ESTADOS as readonly string[]).includes(v);
export const esTipo = (v: unknown): v is TipoCliente => typeof v === "string" && (TIPOS as readonly string[]).includes(v);

/** Fila de dulabs_clientes_conocidos tal como la lee el repositorio. */
export interface FilaContacto {
  id: number;
  id_tenant: string;
  phone_number_id: string;
  telefono_cliente: string;
  nombre: string;
  custom_fields: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Asesor {
  id: number;
  nombre: string;
}

export interface Cliente {
  id: number;
  telefono: string;
  nombre: string;
  tipo: TipoCliente | null;
  nombreEmpresa: string | null;
  producto: string | null;
  productoEtiqueta: string | null;
  cantidad: number | null;
  estado: EstadoCliente;
  asesor: Asesor | null;
  registradoEn: string;
  /** Fecha del último traspaso completado por el Flow (última solicitud). */
  ultimaSolicitudEn: string | null;
  /** Último mensaje (entrante o saliente) de la conversación. */
  ultimoContactoEn: string | null;
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Cantidad guardada por el Flow como texto de dígitos ("06", "20"); cualquier otra cosa → null. */
export function parsearCantidad(v: unknown): number | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n : null;
}

/** true si el contacto completó al menos una vez el Flow (tiene el tipo de cliente que solo guarda el Flow). */
export function esClienteDelModulo(fila: Pick<FilaContacto, "custom_fields">): boolean {
  return esTipo(fila.custom_fields?.[CAMPOS.tipo]);
}

export function aCliente(
  fila: FilaContacto,
  extra: { asesores: ReadonlyMap<number, string>; ultimaSolicitudEn?: string | null; ultimoContactoEn?: string | null },
): Cliente {
  const cf = fila.custom_fields ?? {};
  const tipo = esTipo(cf[CAMPOS.tipo]) ? (cf[CAMPOS.tipo] as TipoCliente) : null;
  const producto = texto(cf[CAMPOS.producto]);
  const asesorId = Number(cf[CAMPOS.asesor]);
  const asesorNombre = Number.isInteger(asesorId) ? extra.asesores.get(asesorId) : undefined;
  // El Flow guarda el nombre en custom_fields; la columna `nombre` es el
  // registro genérico (puede ser el teléfono como marcador).
  const nombre = texto(cf[CAMPOS.nombre]) ?? (fila.nombre && fila.nombre !== fila.telefono_cliente ? fila.nombre : null) ?? fila.telefono_cliente;
  return {
    id: fila.id,
    telefono: fila.telefono_cliente,
    nombre,
    tipo,
    nombreEmpresa: tipo === "empresa" ? texto(cf[CAMPOS.empresa]) : null,
    producto,
    productoEtiqueta: producto ? (PRODUCTOS[producto] ?? producto) : null,
    cantidad: parsearCantidad(cf[CAMPOS.cantidad]),
    estado: esEstado(cf[CAMPOS.estado]) ? (cf[CAMPOS.estado] as EstadoCliente) : "nuevo",
    asesor: asesorNombre !== undefined ? { id: asesorId, nombre: asesorNombre } : null,
    registradoEn: fila.created_at,
    ultimaSolicitudEn: extra.ultimaSolicitudEn ?? null,
    ultimoContactoEn: extra.ultimoContactoEn ?? null,
  };
}

export type FiltroTipo = "todos" | TipoCliente;

export interface FiltroClientes {
  q?: string;
  tipo?: FiltroTipo;
  estado?: EstadoCliente | "todos";
}

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();

/** Búsqueda por nombre, empresa o teléfono (sin tildes ni mayúsculas) + filtros por tipo y estado. */
export function filtrarClientes<T extends Pick<Cliente, "nombre" | "nombreEmpresa" | "telefono" | "tipo" | "estado">>(
  clientes: readonly T[],
  filtro: FiltroClientes,
): T[] {
  const q = normalizar(filtro.q ?? "");
  const qDigitos = q.replace(/\D/g, "");
  return clientes.filter((c) => {
    if (filtro.tipo && filtro.tipo !== "todos" && c.tipo !== filtro.tipo) return false;
    if (filtro.estado && filtro.estado !== "todos" && c.estado !== filtro.estado) return false;
    if (!q) return true;
    if (normalizar(c.nombre).includes(q)) return true;
    if (c.nombreEmpresa && normalizar(c.nombreEmpresa).includes(q)) return true;
    return qDigitos.length >= 3 && c.telefono.includes(qDigitos);
  });
}

export function leerFiltro(params: URLSearchParams): FiltroClientes {
  const tipo = params.get("tipo");
  const estado = params.get("estado");
  return {
    q: (params.get("q") ?? "").slice(0, 100),
    tipo: tipo === "persona_natural" || tipo === "empresa" ? tipo : "todos",
    estado: esEstado(estado) ? estado : "todos",
  };
}

export type CambioCliente = { estado?: EstadoCliente; asesorId?: number | null };

/** Valida el cuerpo del PATCH de la ficha: solo estado y asesor; nada más se puede cambiar. */
export function validarCambio(body: unknown): { ok: true; cambio: CambioCliente } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Cuerpo inválido" };
  const b = body as Record<string, unknown>;
  const desconocidos = Object.keys(b).filter((k) => k !== "estado" && k !== "asesorId");
  if (desconocidos.length > 0) return { ok: false, error: `Campo no permitido: ${desconocidos[0]}` };
  const cambio: CambioCliente = {};
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

/** custom_fields resultantes del cambio (merge: nunca borra lo que guardó el Flow). */
export function aplicarCambio(customFields: Record<string, unknown> | null, cambio: CambioCliente): Record<string, unknown> {
  const siguiente = { ...(customFields ?? {}) };
  if (cambio.estado) siguiente[CAMPOS.estado] = cambio.estado;
  if ("asesorId" in cambio) {
    if (cambio.asesorId === null) delete siguiente[CAMPOS.asesor];
    else siguiente[CAMPOS.asesor] = String(cambio.asesorId);
  }
  return siguiente;
}

export const TAMANO_PAGINA = 25;
