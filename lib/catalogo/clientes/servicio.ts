/**
 * Bloque 33 — servicio del módulo Clientes (lo usan las rutas /api/dashboard/clientes/*). Todo por
 * el negocio de la sesión: el tenant nunca viene del cliente HTTP.
 */
import { z } from "zod";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import type { CustomerChannelStore } from "@/lib/agente/clasificacion";
import type { ClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import type { OrderChannel } from "@/lib/catalogo/pedidos/contrato";
import {
  CANAL_DE_MODALIDAD,
  CLIENTES_EXPORTAR_MAX,
  CLIENTES_POR_PAGINA,
  IMPORTAR_MAX_FILAS,
  NOTA_MAX,
  analizarImportacion,
  claveCliente,
  clientesCsv,
  leerClave,
  leerConsulta,
  normalizarCelular,
  normalizarNombre,
  type ClienteDetalle,
  type ClienteFila,
  type FilaImportacion,
  type Modalidad,
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

// ---------------------------------------------------------------------------
// Bloque 34 — registrar, editar e importar clientes
// ---------------------------------------------------------------------------

/** Número de WhatsApp del negocio para el cliente: el pedido (si es del negocio) o el único que tiene. */
async function numeroDelNegocio(repo: ClientesRepo, tenantId: string, pedido: string | undefined): Promise<{ ok: true; pn: string } | { ok: false; response: Response }> {
  const nums = await repo.numerosDelNegocio(tenantId);
  if (pedido) return nums.includes(pedido) ? { ok: true, pn: pedido } : { ok: false, response: apiError("VALIDATION_ERROR", "Ese número de WhatsApp no es de tu negocio.", 400) };
  if (nums.length === 1) return { ok: true, pn: nums[0] };
  if (nums.length === 0) return { ok: false, response: apiError("NO_NUMBER", "Tu negocio no tiene un número de WhatsApp conectado.", 409) };
  return { ok: false, response: apiError("VALIDATION_ERROR", "Elige el número de WhatsApp del cliente.", 400, { numeros: nums }) };
}

/**
 * Deja al contacto como lo dijo el equipo: modalidad (por la RPC, origen "asesora", compare-and-set
 * contra la que había), nombre conocido (el mismo que usa el asistente) y ficha. "conflicto" = la
 * modalidad cambió mientras tanto (nada se pisó).
 */
async function aplicarCliente(
  repo: ClientesRepo,
  canales: CustomerChannelStore,
  tenantId: string,
  pn: string,
  wa: string,
  datos: { nombre: string | null; modalidad: Modalidad | null; yaCompro?: boolean; esperado?: OrderChannel | null },
  miembroId: number,
  motivo: string,
  registrado: boolean,
): Promise<"ok" | "conflicto"> {
  const key = { tenantId, phoneNumberId: pn, waId: wa };
  if (datos.modalidad) {
    const actual = await canales.get(key);
    const canal = CANAL_DE_MODALIDAD[datos.modalidad];
    if (actual?.channel !== canal) {
      const esperado = datos.esperado !== undefined ? datos.esperado : (actual?.channel ?? null);
      const w = await canales.change(key, { channel: canal, expected: esperado, memberId: miembroId, reason: motivo });
      if (w.result === "conflicto") return "conflicto";
    }
  }
  if (datos.nombre) await repo.guardarNombre(tenantId, pn, wa, datos.nombre);
  if (datos.yaCompro !== undefined || registrado) await repo.guardarFicha(tenantId, pn, wa, { ...(datos.yaCompro !== undefined ? { yaCompro: datos.yaCompro } : {}), ...(registrado ? { registrado: true } : {}) }, miembroId);
  return "ok";
}

const registroSchema = z
  .object({
    nombre: z.string().max(200),
    telefono: z.string().max(40),
    modalidad: z.enum(["detal", "mayorista"]),
    yaCompro: z.boolean().optional(),
    numero: z.string().max(64).optional(),
  })
  .strict();

export async function registrarCliente(repo: ClientesRepo, canales: CustomerChannelStore, tenantId: string, body: unknown, miembroId: number): Promise<Response> {
  const b = registroSchema.safeParse(body);
  if (!b.success) return apiError("VALIDATION_ERROR", "Datos del cliente inválidos.", 400);
  const nombre = normalizarNombre(b.data.nombre);
  if (!nombre) return apiError("VALIDATION_ERROR", "Escribe el nombre del cliente (2 a 60 caracteres).", 400);
  const wa = normalizarCelular(b.data.telefono);
  if (!wa) return apiError("VALIDATION_ERROR", "El celular no es válido. Ejemplo: 300 111 2233 o +57 300 111 2233.", 400);
  const n = await numeroDelNegocio(repo, tenantId, b.data.numero);
  if (!n.ok) return n.response;
  const existente = await buscar(repo, tenantId, n.pn, wa);
  if (existente) return apiError("ALREADY_EXISTS", "Ese celular ya es cliente. Ábrelo para editarlo.", 409, { clave: claveCliente(n.pn, wa) });
  const r = await aplicarCliente(repo, canales, tenantId, n.pn, wa, { nombre, modalidad: b.data.modalidad, yaCompro: b.data.yaCompro ?? false, esperado: null }, miembroId, "Registrado por el equipo", true);
  if (r === "conflicto") return apiError("CONFLICT", "Ese cliente acaba de escribir y eligió su modalidad. Ábrelo para revisarlo.", 409, { clave: claveCliente(n.pn, wa) });
  return apiOk({ clave: claveCliente(n.pn, wa) }, 201);
}

const edicionSchema = z
  .object({
    nombre: z.string().max(200).optional(),
    modalidad: z.enum(["detal", "mayorista"]).optional(),
    /** La modalidad que la persona VIO (compare-and-set). */
    esperado: z.enum(["retail", "wholesale"]).nullable().optional(),
    motivo: z.string().max(400).optional(),
    yaCompro: z.boolean().optional(),
  })
  .strict();

export async function editarCliente(repo: ClientesRepo, canales: CustomerChannelStore, tenantId: string, clave: string, body: unknown, miembroId: number): Promise<Response> {
  const k = leerClave(clave);
  if (!k) return apiError("NOT_FOUND", "No encontramos ese cliente.", 404);
  const b = edicionSchema.safeParse(body);
  if (!b.success) return apiError("VALIDATION_ERROR", "Datos del cliente inválidos.", 400);
  const cliente = await buscar(repo, tenantId, k.phoneNumberId, k.waId);
  if (!cliente) return apiError("NOT_FOUND", "No encontramos ese cliente.", 404);
  const nombre = b.data.nombre === undefined ? null : normalizarNombre(b.data.nombre);
  if (b.data.nombre !== undefined && !nombre) return apiError("VALIDATION_ERROR", "Escribe el nombre del cliente (2 a 60 caracteres).", 400);
  // La modalidad GUARDADA (la que usa el asistente), no la que el listado deduce de un pedido.
  const guardada = await canales.get({ tenantId, phoneNumberId: k.phoneNumberId, waId: k.waId });
  const cambiaModalidad = b.data.modalidad !== undefined && CANAL_DE_MODALIDAD[b.data.modalidad] !== guardada?.channel;
  let motivo = (b.data.motivo ?? "").trim();
  // Cambiar una modalidad que ya tenía pide el porqué; fijarla por primera vez no.
  if (cambiaModalidad && guardada && (motivo.length < 3 || motivo.length > 300)) return apiError("VALIDATION_ERROR", "Escribe por qué cambias la modalidad (entre 3 y 300 caracteres).", 400);
  if (cambiaModalidad && !guardada && !motivo) motivo = "Fijada por el equipo";
  if (motivo.length > 300) return apiError("VALIDATION_ERROR", "El motivo admite máximo 300 caracteres.", 400);
  const r = await aplicarCliente(
    repo,
    canales,
    tenantId,
    k.phoneNumberId,
    k.waId,
    { nombre, modalidad: cambiaModalidad ? b.data.modalidad! : null, yaCompro: b.data.yaCompro, esperado: b.data.esperado === undefined ? undefined : b.data.esperado },
    miembroId,
    motivo,
    false,
  );
  if (r === "conflicto") return apiError("CONFLICT", "La modalidad del cliente cambió mientras lo editabas. Actualiza y vuelve a intentarlo.", 409);
  return apiOk({ clave });
}

/** Vista previa de un archivo: qué se crea, qué se actualiza y qué filas tienen errores (nada se escribe). */
export async function previsualizarImportacion(repo: ClientesRepo, tenantId: string, tabla: ReadonlyArray<ReadonlyArray<string>>): Promise<Response> {
  const n = await numeroDelNegocio(repo, tenantId, undefined);
  if (!n.ok) return n.response;
  const { filas: actuales } = await repo.listar(tenantId, { q: null, filtro: "todos", limite: CLIENTES_EXPORTAR_MAX, offset: 0 });
  const existentes = new Set(actuales.filter((f) => f.phoneNumberId === n.pn).map((f) => f.waId));
  const r = analizarImportacion(tabla, existentes);
  if (r.error) return apiError("VALIDATION_ERROR", r.error, 400);
  const cuenta = (a: FilaImportacion["accion"]) => r.filas.filter((f) => f.accion === a).length;
  return apiOk({ filas: r.filas, resumen: { nuevos: cuenta("nuevo"), actualizar: cuenta("actualizar"), errores: cuenta("error") } });
}

const importacionSchema = z
  .object({
    filas: z
      .array(z.object({ nombre: z.string().max(200), telefono: z.string().max(40), modalidad: z.enum(["detal", "mayorista"]), yaCompro: z.boolean() }).strict())
      .min(1)
      .max(IMPORTAR_MAX_FILAS),
  })
  .strict();

/** Aplica la importación (el servidor vuelve a validar cada fila). Una fila con error no frena las demás. */
export async function aplicarImportacion(repo: ClientesRepo, canales: CustomerChannelStore, tenantId: string, body: unknown, miembroId: number): Promise<Response> {
  const b = importacionSchema.safeParse(body);
  if (!b.success) return apiError("VALIDATION_ERROR", `Envía entre 1 y ${IMPORTAR_MAX_FILAS} clientes válidos.`, 400);
  const n = await numeroDelNegocio(repo, tenantId, undefined);
  if (!n.ok) return n.response;
  const { filas: actuales } = await repo.listar(tenantId, { q: null, filtro: "todos", limite: CLIENTES_EXPORTAR_MAX, offset: 0 });
  const existentes = new Set(actuales.filter((f) => f.phoneNumberId === n.pn).map((f) => f.waId));
  const vistos = new Set<string>();
  let creados = 0;
  let actualizados = 0;
  const errores: Array<{ telefono: string; motivo: string }> = [];
  for (const f of b.data.filas) {
    const wa = normalizarCelular(f.telefono);
    const nombre = normalizarNombre(f.nombre);
    if (!wa || !nombre) {
      errores.push({ telefono: f.telefono, motivo: !wa ? "Celular inválido" : "Nombre inválido" });
      continue;
    }
    if (vistos.has(wa)) {
      errores.push({ telefono: f.telefono, motivo: "Celular repetido" });
      continue;
    }
    vistos.add(wa);
    const existe = existentes.has(wa);
    try {
      const r = await aplicarCliente(repo, canales, tenantId, n.pn, wa, { nombre, modalidad: f.modalidad, yaCompro: f.yaCompro }, miembroId, existe ? "Importación de clientes (actualización)" : "Importación de clientes", !existe);
      if (r === "conflicto") errores.push({ telefono: f.telefono, motivo: "La modalidad cambió mientras se importaba" });
      else if (existe) actualizados++;
      else creados++;
    } catch {
      errores.push({ telefono: f.telefono, motivo: "No se pudo guardar" });
    }
  }
  return apiOk({ creados, actualizados, errores });
}
