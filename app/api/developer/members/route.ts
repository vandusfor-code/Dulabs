import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { listarMiembros, crearMiembroConLimite, type RolDev } from "@/lib/developer/memberships-store";
import { resolverEntitlementsDeWorkspace } from "@/lib/developer/plans";

// DuLabs Developer V1 -- Fase 9 + Fase 11 (autorizado). GET (listar, cualquier
// rol) / POST (alta/actualización idempotente, SOLO OWNER). Fase 11: el alta
// aplica el límite de miembros A NIVEL DE CUENTA (miembros distintos across
// los workspaces de la cuenta) de forma atómica. No implementa invitaciones
// por email: se recibe el userId de Auth ya existente.

export const runtime = "nodejs";

const ROLES_VALIDOS: RolDev[] = ["OWNER", "ADMIN", "MEMBER"];

export async function GET(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN", "MEMBER"], async (ctx) => {
    const filas = await listarMiembros(ctx.supabase, ctx.workspaceId);
    const members = filas.map((m) => ({ id: m.id, userId: m.user_id, rol: m.rol, estado: m.estado, createdAt: m.created_at }));
    return jsonOk({ members }, ctx.requestId);
  });
}

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER"], async (ctx) => {
    const cuerpo = (await request.json().catch(() => null)) as { userId?: string; rol?: string } | null;
    if (!cuerpo?.userId) return jsonError(400, "invalid_request", ctx.requestId, "Falta 'userId'");
    const rol = (cuerpo.rol ?? "MEMBER") as RolDev;
    if (!ROLES_VALIDOS.includes(rol)) return jsonError(400, "invalid_request", ctx.requestId, "rol inválido");
    const e = await resolverEntitlementsDeWorkspace(ctx.supabase, ctx.workspaceId);
    const r = await crearMiembroConLimite(ctx.supabase, { workspaceId: ctx.workspaceId, userId: cuerpo.userId, rol, limiteMiembros: e.maxMembers });
    if (!r.ok) {
      if (r.motivo === "limite_miembros_excedido") return jsonError(403, "member_limit_exceeded", ctx.requestId, `Tu plan ${e.planCodigo} permite ${e.maxMembers} miembros`);
      return jsonError(400, "invalid_request", ctx.requestId, "rol inválido");
    }
    const filas = await listarMiembros(ctx.supabase, ctx.workspaceId);
    const fila = filas.find((m) => m.id === r.membershipId);
    return jsonOk(
      { member: fila ? { id: fila.id, userId: fila.user_id, rol: fila.rol, estado: fila.estado, createdAt: fila.created_at } : { id: r.membershipId, userId: cuerpo.userId, rol, estado: "activo" } },
      ctx.requestId,
      201
    );
  });
}
