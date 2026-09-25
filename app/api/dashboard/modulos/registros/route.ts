/**
 * Registros de módulo sin completar (genérico para cualquier módulo con `registrar_en_modulo`):
 * cuántos quedaron pendientes o fallidos y cuáles, para que ningún fallo pase en silencio.
 *
 * Autorización en el backend: sesión + membresía activa (el tenant sale SIEMPRE de la sesión,
 * sin override de administrador), rol, módulo conocido y HABILITADO para el tenant (estricto).
 *   GET  ?modulo=…                         (admin/agente/lectura) — antes de responder concilia
 *        los pendientes vencidos de ESE tenant (como el panel de pedidos vence al abrirse).
 *   POST { modulo, accion: "reprocesar" }  (admin/agente) — concilia ahora los vencidos.
 *   POST { modulo, accion: "reencolar", id } (admin/agente) — vuelve a poner en cola un fallido.
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { conciliarRegistrosDeModulo } from "@/lib/flow/registro-modulo-conciliacion";
import { conciliacionDeProduccion } from "@/lib/modulos/registros-flow";
import { esModuloId, moduloHabilitado, type ModuloId } from "@/lib/tenant-modulos";
import type { Rol } from "@/lib/team";

export const runtime = "nodejs";
export const maxDuration = 60;

const LECTURA: Rol[] = ["admin", "agente", "lectura"];
const ESCRITURA: Rol[] = ["admin", "agente"];

async function autorizar(request: NextRequest, roles: Rol[], modulo: unknown) {
  const acceso = await requireFlowAccess(request, roles);
  if (!acceso.ok) return acceso;
  if (!esModuloId(modulo)) return { ok: false as const, response: Response.json({ error: "Módulo inválido" }, { status: 400 }) };
  const { supabase, miembro } = acceso.ctx;
  try {
    if (!(await moduloHabilitado(supabase, miembro.tenantId, modulo))) {
      return { ok: false as const, response: Response.json({ error: "El módulo no está habilitado para tu cuenta." }, { status: 403 }) };
    }
  } catch (err) {
    console.error("[api/modulos/registros] no se pudo verificar el módulo:", err instanceof Error ? err.message : err);
    return { ok: false as const, response: Response.json({ error: "No se pudo verificar el acceso." }, { status: 500 }) };
  }
  return { ok: true as const, supabase, tenantId: miembro.tenantId, modulo: modulo as ModuloId };
}

export async function GET(request: NextRequest) {
  const acceso = await autorizar(request, LECTURA, request.nextUrl.searchParams.get("modulo"));
  if (!acceso.ok) return acceso.response;
  const deps = conciliacionDeProduccion(acceso.supabase);
  try {
    await conciliarRegistrosDeModulo(deps, { tenantId: acceso.tenantId, limite: 10, presupuestoMs: 5_000 });
  } catch (err) {
    // Conciliar es un extra: el resumen se muestra igual (y deja ver lo pendiente).
    console.error("[api/modulos/registros] no se pudo conciliar al abrir:", err instanceof Error ? err.message : err);
  }
  try {
    return Response.json(await deps.store.resumen(acceso.tenantId, acceso.modulo), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/modulos/registros] error leyendo el resumen:", err instanceof Error ? err.message : err);
    return Response.json({ error: "No se pudo cargar el estado de los registros." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: { modulo?: unknown; accion?: unknown; id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const acceso = await autorizar(request, ESCRITURA, body?.modulo);
  if (!acceso.ok) return acceso.response;
  const deps = conciliacionDeProduccion(acceso.supabase);
  try {
    if (body.accion === "reprocesar") {
      return Response.json(await conciliarRegistrosDeModulo(deps, { tenantId: acceso.tenantId, limite: 25, presupuestoMs: 20_000 }));
    }
    if (body.accion === "reencolar") {
      const id = typeof body.id === "number" && Number.isSafeInteger(body.id) && body.id > 0 ? body.id : null;
      if (id === null) return Response.json({ error: "id inválido" }, { status: 400 });
      // Solo filas del tenant de la sesión (la función filtra por tenant): un id ajeno → 404.
      if (!(await deps.store.reencolar(acceso.tenantId, id))) return Response.json({ error: "Registro no encontrado" }, { status: 404 });
      return Response.json(await conciliarRegistrosDeModulo(deps, { tenantId: acceso.tenantId, limite: 25, presupuestoMs: 20_000 }));
    }
    return Response.json({ error: "'accion' debe ser 'reprocesar' o 'reencolar'" }, { status: 400 });
  } catch (err) {
    console.error("[api/modulos/registros] error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "No se pudo reprocesar." }, { status: 500 });
  }
}
