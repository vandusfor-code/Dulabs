import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { cambiarRolMiembro, eliminarMiembro, type RolDev } from "@/lib/developer/memberships-store";

// DuLabs Developer V1 -- Fase 9 (autorizado). PATCH (cambiar rol) / DELETE
// (eliminar) -- SOLO OWNER. La guarda de último OWNER es atómica en la DB
// (Fase 8). Scoped por workspace: un membershipId de otro workspace da 404.

export const runtime = "nodejs";

const ROLES_VALIDOS: RolDev[] = ["OWNER", "ADMIN", "MEMBER"];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return conSesionDeveloper(request, ["OWNER"], async (ctx) => {
    const cuerpo = (await request.json().catch(() => null)) as { rol?: string } | null;
    const rol = cuerpo?.rol as RolDev | undefined;
    if (!rol || !ROLES_VALIDOS.includes(rol)) return jsonError(400, "invalid_request", ctx.requestId, "rol inválido");
    const resultado = await cambiarRolMiembro(ctx.supabase, { workspaceId: ctx.workspaceId, membershipId: id, nuevoRol: rol });
    if (resultado.ok) return jsonOk({ member: { id, rol: resultado.rol } }, ctx.requestId);
    if (resultado.motivo === "no_encontrado") return jsonError(404, "member_not_found", ctx.requestId);
    if (resultado.motivo === "ultimo_owner") return jsonError(409, "last_owner", ctx.requestId, "No se puede degradar al último OWNER del workspace");
    return jsonError(400, "invalid_request", ctx.requestId);
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return conSesionDeveloper(request, ["OWNER"], async (ctx) => {
    const resultado = await eliminarMiembro(ctx.supabase, { workspaceId: ctx.workspaceId, membershipId: id });
    if (resultado.ok) return jsonOk({ eliminado: true }, ctx.requestId);
    if (resultado.motivo === "no_encontrado") return jsonError(404, "member_not_found", ctx.requestId);
    return jsonError(409, "last_owner", ctx.requestId, "No se puede eliminar al último OWNER del workspace");
  });
}
