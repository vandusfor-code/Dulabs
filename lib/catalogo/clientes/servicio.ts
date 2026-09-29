/**
 * Bloque 33 — servicio del módulo Clientes (lo usan las rutas /api/dashboard/clientes/*). Todo por
 * el negocio de la sesión: el tenant nunca viene del cliente HTTP.
 */
import { z } from "zod";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import type { CustomerChannelStore } from "@/lib/agente/clasificacion";
import type { ClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import {
  CLIENTES_EXPORTAR_MAX,
  CLIENTES_POR_PAGINA,
  NOTA_MAX,
  clientesCsv,
  leerClave,
  leerConsulta,
  type ClienteDetalle,
  type ClienteFila,
} from "@/lib/catalogo/clientes/modelo";

export async function listarClientes(repo: ClientesRepo, tenantId: string, params: URLSearchParams): Promise<Response> {
  const c = leerConsulta(params);
  const { total, filas } = await repo.listar(tenantId, { q: c.q, filtro: c.filtro, limite: CLIENTES_POR_PAGINA, offset: (c.pagina - 1) * CLIENTES_POR_PAGINA });
  return apiOk({ filas, total, pagina: c.pagina, paginas: Math.max(1, Math.ceil(total / CLIENTES_POR_PAGINA)), porPagina: CLIENTES_POR_PAGINA });
}

/** El cliente exacto (número + contacto) del negocio, o null si no es cliente de este negocio. */
async function buscar(repo: ClientesRepo, tenantId: string, phoneNumberId: string, waId: string): Promise<ClienteFila | null> {
  const { filas } = await repo.listar(tenantId, { q: waId, filtro: "todos", limite: 50, offset: 0 });
  return filas.find((f) => f.phoneNumberId === phoneNumberId && f.waId === waId) ?? null;
}

export async function detalleCliente(repo: ClientesRepo, canales: CustomerChannelStore | null, tenantId: string, clave: string): Promise<Response> {
  const k = leerClave(clave);
  if (!k) return apiError("NOT_FOUND", "No encontramos ese cliente.", 404);
  const cliente = await buscar(repo, tenantId, k.phoneNumberId, k.waId);
  if (!cliente) return apiError("NOT_FOUND", "No encontramos ese cliente.", 404);
  const key = { tenantId, phoneNumberId: k.phoneNumberId, waId: k.waId };
  const [pedidos, nota, canal, historial] = await Promise.all([
    repo.pedidos(tenantId, k.phoneNumberId, k.waId),
    repo.nota(tenantId, k.phoneNumberId, k.waId),
    canales ? canales.get(key).catch(() => null) : Promise.resolve(null),
    canales ? canales.history(key, 20).catch(() => []) : Promise.resolve([]),
  ]);
  const detalle: ClienteDetalle = { cliente, pedidos, nota, modalidad: canal ? { canal: canal.channel, origen: canal.origin, historial } : null };
  return apiOk(detalle);
}

const notaSchema = z.object({ nota: z.string().max(NOTA_MAX * 2), version: z.number().int().min(0).max(1_000_000) }).strict();

export async function guardarNotaCliente(repo: ClientesRepo, tenantId: string, clave: string, body: unknown, miembroId: number | null): Promise<Response> {
  const k = leerClave(clave);
  if (!k) return apiError("NOT_FOUND", "No encontramos ese cliente.", 404);
  const b = notaSchema.safeParse(body);
  if (!b.success) return apiError("VALIDATION_ERROR", "Datos de la nota inválidos.", 400);
  const texto = b.data.nota.replace(/\r\n/g, "\n").trim();
  if (texto.length > NOTA_MAX) return apiError("VALIDATION_ERROR", `La nota admite máximo ${NOTA_MAX} caracteres.`, 400);
  // Solo clientes de ESTE negocio (nunca una nota suelta para un número cualquiera).
  if (!(await buscar(repo, tenantId, k.phoneNumberId, k.waId))) return apiError("NOT_FOUND", "No encontramos ese cliente.", 404);
  const guardada = await repo.guardarNota(tenantId, k.phoneNumberId, k.waId, texto, b.data.version, miembroId);
  if (!guardada) {
    const actual = await repo.nota(tenantId, k.phoneNumberId, k.waId);
    return apiError("CONFLICT", "Otra persona cambió la nota mientras la editabas. Revisa la versión actual y vuelve a guardar.", 409, { nota: actual });
  }
  return apiOk({ nota: guardada });
}

/** CSV de la lista filtrada (máx. CLIENTES_EXPORTAR_MAX filas), con la nota de cada cliente. */
export async function exportarClientes(repo: ClientesRepo, tenantId: string, params: URLSearchParams, hoy: Date = new Date()): Promise<Response> {
  const c = leerConsulta(params);
  const { filas } = await repo.listar(tenantId, { q: c.q, filtro: c.filtro, limite: CLIENTES_EXPORTAR_MAX, offset: 0 });
  const notas = await repo.notas(
    tenantId,
    filas.filter((f) => f.tieneNota).map((f) => ({ phoneNumberId: f.phoneNumberId, waId: f.waId })),
  );
  return new Response(clientesCsv(filas, notas), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clientes-${hoy.toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
