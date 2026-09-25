/**
 * Publi Bordados · módulo Clientes — casos de uso de Clientes y Solicitudes.
 * Reciben el tenant YA autenticado (auth.ts); el repositorio aplica el aislamiento en SQL.
 */
import {
  aCliente,
  aClienteDetalle,
  aSolicitud,
  filtroClientesSql,
  filtroSolicitudesSql,
  TAMANO_PAGINA,
  type Asesor,
  type CambioSolicitud,
  type Cliente,
  type ClienteDetalle,
  type FiltroClientes,
  type FiltroSolicitudes,
  type Solicitud,
} from "@/lib/publibordados/clientes/modelo";
import type { ClientesRepositorio, MiembroEquipo } from "@/lib/publibordados/clientes/repositorio";

export type ResultadoServicio<T> = { ok: true; data: T } | { ok: false; status: 400 | 404 | 409; error: string };

export interface Listado<T> {
  filas: T[];
  total: number;
  pagina: number;
  paginas: number;
  asesores: Asesor[];
}

const nombreMiembro = (m: MiembroEquipo) => m.nombre?.trim() || m.email?.trim() || `Miembro ${m.id}`;

async function equipo(repo: ClientesRepositorio, tenantId: string) {
  const miembros = await repo.miembrosDelTenant(tenantId);
  return {
    // Todos (incluidos suspendidos) para mostrar el nombre de un asesor ya asignado.
    nombres: new Map(miembros.map((m) => [m.id, nombreMiembro(m)])),
    // Solo activos para asignar.
    activos: miembros.filter((m) => m.estado === "activo").map((m): Asesor => ({ id: m.id, nombre: nombreMiembro(m) })),
  };
}

const paginas = (total: number) => Math.max(1, Math.ceil(total / TAMANO_PAGINA));

export async function listarClientes(repo: ClientesRepositorio, tenantId: string, filtro: FiltroClientes, pagina = 1): Promise<Listado<Cliente>> {
  const [resultado, e] = await Promise.all([repo.listarClientes(tenantId, filtroClientesSql(filtro, pagina)), equipo(repo, tenantId)]);
  return { filas: resultado.filas.map((f) => aCliente(f, e.nombres)), total: resultado.total, pagina, paginas: paginas(resultado.total), asesores: e.activos };
}

export async function obtenerCliente(
  repo: ClientesRepositorio,
  tenantId: string,
  clienteId: number,
): Promise<ResultadoServicio<ClienteDetalle & { asesores: Asesor[] }>> {
  const [detalle, e] = await Promise.all([repo.obtenerCliente(tenantId, clienteId), equipo(repo, tenantId)]);
  // Otro tenant, otro número o un contacto que nunca fue cliente: igual que "no existe".
  if (!detalle) return { ok: false, status: 404, error: "Cliente no encontrado" };
  return { ok: true, data: { ...aClienteDetalle(detalle, e.nombres), asesores: e.activos } };
}

export async function listarSolicitudes(
  repo: ClientesRepositorio,
  tenantId: string,
  filtro: FiltroSolicitudes,
  pagina = 1,
): Promise<Listado<Solicitud>> {
  const [resultado, e] = await Promise.all([repo.listarSolicitudes(tenantId, filtroSolicitudesSql(filtro, pagina)), equipo(repo, tenantId)]);
  return { filas: resultado.filas.map((f) => aSolicitud(f, e.nombres)), total: resultado.total, pagina, paginas: paginas(resultado.total), asesores: e.activos };
}

export async function obtenerSolicitud(
  repo: ClientesRepositorio,
  tenantId: string,
  solicitudId: number,
): Promise<ResultadoServicio<{ solicitud: Solicitud; asesores: Asesor[] }>> {
  const [fila, e] = await Promise.all([repo.obtenerSolicitud(tenantId, solicitudId), equipo(repo, tenantId)]);
  if (!fila) return { ok: false, status: 404, error: "Solicitud no encontrada" };
  return { ok: true, data: { solicitud: aSolicitud(fila, e.nombres), asesores: e.activos } };
}

/**
 * Cambia estado y/o asesor de UNA solicitud con escritura optimista (versión leída). La BD
 * vuelve a validar tenant, número y que el asesor sea un miembro activo del mismo equipo.
 */
export async function actualizarSolicitud(
  repo: ClientesRepositorio,
  tenantId: string,
  solicitudId: number,
  cambio: CambioSolicitud,
): Promise<ResultadoServicio<{ solicitud: Solicitud }>> {
  const e = await equipo(repo, tenantId);
  if (typeof cambio.asesorId === "number" && !e.activos.some((a) => a.id === cambio.asesorId)) {
    return { ok: false, status: 400, error: "El asesor no pertenece a tu equipo activo" };
  }
  const { version, ...campos } = cambio;
  const r = await repo.actualizarSolicitud(tenantId, solicitudId, version, campos);
  switch (r.resultado) {
    case "ok":
      return { ok: true, data: { solicitud: aSolicitud(r.solicitud, e.nombres) } };
    case "no_encontrada":
      return { ok: false, status: 404, error: "Solicitud no encontrada" };
    case "conflicto":
      return { ok: false, status: 409, error: "La solicitud cambió mientras la editabas. Se recargó la versión actual." };
    case "asesor_invalido":
      return { ok: false, status: 400, error: "El asesor no pertenece a tu equipo activo" };
  }
}
