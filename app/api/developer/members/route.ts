import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { listarMiembros, crearMiembro, type RolDev } from "@/lib/developer/memberships-store";

// DuLabs Developer V1 -- Fase 9 (autorizado). GET (listar, cualquier rol) /
// POST (alta/actualización idempotente, SOLO OWNER). Fase 9 NO implementa
// invitaciones por email: se recibe el userId de Auth ya existente.

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
    const fila = await crearMiembro(ctx.supabase, { workspaceId: ctx.workspaceId, userId: cuerpo.userId, rol });
    return jsonOk({ member: { id: fila.id, userId: fila.user_id, rol: fila.rol, estado: fila.estado, createdAt: fila.created_at } }, ctx.requestId, 201);
  });
}
