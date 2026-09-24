/**
 * Publi Bordados · módulo Clientes — casos de uso (listar, ver ficha, cambiar estado/asesor).
 * Reciben el tenant YA autenticado (auth.ts) y un repositorio que aplica el
 * aislamiento por tenant + números del tenant en cada consulta.
 */
import {
  aCliente,
  aplicarCambio,
  esClienteDelModulo,
  filtrarClientes,
  TAMANO_PAGINA,
  type Asesor,
  type CambioCliente,
  type Cliente,
  type FiltroClientes,
  type FilaContacto,
} from "@/lib/publibordados/clientes/modelo";
import type { ClientesRepositorio, MiembroEquipo } from "@/lib/publibordados/clientes/repositorio";

export type ResultadoServicio<T> = { ok: true; data: T } | { ok: false; status: 400 | 404 | 409; error: string };

const nombreMiembro = (m: MiembroEquipo) => m.nombre?.trim() || m.email?.trim() || `Miembro ${m.id}`;

async function asesoresDe(repo: ClientesRepositorio, tenantId: string) {
  const miembros = await repo.miembrosDelTenant(tenantId);
  return {
    // Todos (incluidos suspendidos) para mostrar el nombre de un asesor ya asignado.
    nombres: new Map(miembros.map((m) => [m.id, nombreMiembro(m)])),
    // Solo activos para asignar.
    activos: miembros.filter((m) => m.estado === "activo").map((m): Asesor => ({ id: m.id, nombre: nombreMiembro(m) })),
  };
}

async function enriquecer(repo: ClientesRepositorio, tenantId: string, fila: FilaContacto, nombres: ReadonlyMap<number, string>) {
  const [ultimoContactoEn, ultimaSolicitudEn] = await Promise.all([
    repo.ultimoContacto(fila.phone_number_id, fila.telefono_cliente),
    repo.ultimaSolicitud(tenantId, fila.phone_number_id, fila.telefono_cliente),
  ]);
  return aCliente(fila, { asesores: nombres, ultimoContactoEn, ultimaSolicitudEn });
}

export async function listarClientes(
  repo: ClientesRepositorio,
  tenantId: string,
  filtro: FiltroClientes,
  pagina = 1,
): Promise<{ clientes: Cliente[]; total: number; pagina: number; paginas: number; asesores: Asesor[] }> {
  const [numeros, asesores] = await Promise.all([repo.numerosDelTenant(tenantId), asesoresDe(repo, tenantId)]);
  // Doble barrera: el repositorio ya filtra por tenant y números; aquí se
  // descarta cualquier fila que no cumpla (nunca se confía en una sola capa).
  const filas = (await repo.listarContactos(tenantId, numeros)).filter(
    (f) => f.id_tenant === tenantId && numeros.includes(f.phone_number_id) && esClienteDelModulo(f),
  );
  const porId = new Map(filas.map((f) => [f.id, f]));
  const base = filas.map((f) => aCliente(f, { asesores: asesores.nombres }));
  const filtrados = filtrarClientes(base, filtro);
  const paginas = Math.max(1, Math.ceil(filtrados.length / TAMANO_PAGINA));
  const actual = Math.min(Math.max(1, Math.trunc(pagina) || 1), paginas);
  const pagina_ = filtrados.slice((actual - 1) * TAMANO_PAGINA, actual * TAMANO_PAGINA);
  const clientes = await Promise.all(pagina_.map((c) => enriquecer(repo, tenantId, porId.get(c.id)!, asesores.nombres)));
  return { clientes, total: filtrados.length, pagina: actual, paginas, asesores: asesores.activos };
}

async function leerFila(repo: ClientesRepositorio, tenantId: string, id: number) {
  const numeros = await repo.numerosDelTenant(tenantId);
  const fila = await repo.obtenerContacto(tenantId, numeros, id);
  // Mismo criterio que el listado: otro tenant, otro número o un contacto
  // que nunca pasó por el Flow responden igual que "no existe" (404).
  if (!fila || fila.id_tenant !== tenantId || !numeros.includes(fila.phone_number_id) || !esClienteDelModulo(fila)) return null;
  return { fila, numeros };
}

export async function obtenerCliente(
  repo: ClientesRepositorio,
  tenantId: string,
  id: number,
): Promise<ResultadoServicio<{ cliente: Cliente; asesores: Asesor[] }>> {
  const [leido, asesores] = await Promise.all([leerFila(repo, tenantId, id), asesoresDe(repo, tenantId)]);
  if (!leido) return { ok: false, status: 404, error: "Cliente no encontrado" };
  return { ok: true, data: { cliente: await enriquecer(repo, tenantId, leido.fila, asesores.nombres), asesores: asesores.activos } };
}

const MAX_INTENTOS = 3;

export async function actualizarCliente(
  repo: ClientesRepositorio,
  tenantId: string,
  id: number,
  cambio: CambioCliente,
): Promise<ResultadoServicio<{ cliente: Cliente }>> {
  const asesores = await asesoresDe(repo, tenantId);
  if (typeof cambio.asesorId === "number" && !asesores.activos.some((a) => a.id === cambio.asesorId)) {
    return { ok: false, status: 400, error: "El asesor no pertenece a tu equipo activo" };
  }
  // Escritura optimista: si el Flow (u otra persona) cambió la fila entre la
  // lectura y la escritura, se relee y se vuelve a aplicar el cambio sobre lo
  // nuevo -- nunca se pisa un dato que otro acaba de guardar.
  for (let intento = 0; intento < MAX_INTENTOS; intento++) {
    const leido = await leerFila(repo, tenantId, id);
    if (!leido) return { ok: false, status: 404, error: "Cliente no encontrado" };
    const escrito = await repo.actualizarCustomFields(
      tenantId,
      leido.numeros,
      id,
      leido.fila.updated_at,
      aplicarCambio(leido.fila.custom_fields, cambio),
    );
    if (escrito) return { ok: true, data: { cliente: await enriquecer(repo, tenantId, escrito, asesores.nombres) } };
  }
  return { ok: false, status: 409, error: "El cliente cambió mientras se guardaba. Intenta de nuevo." };
}
