import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { desconectarNumero } from "@/lib/developer/whatsapp-numbers-store";

// DuLabs Developer V1 -- Fase 10 (autorizado). Desconexión LOCAL segura de un
// número (DELETE = desconectar, nunca borrado físico -- el histórico de
// jobs/usage/eventos se conserva). Solo OWNER/ADMIN. La desconexión borra el
// token de Meta cifrado (el número ya no puede enviar) y marca 'desconectado'
// -- es una acción del lado de DuLabs, NO revoca nada en Meta (ver
// desconectarNumero). Scoped por workspace server-side: un número de otro
// workspace simplemente no se encuentra (404), nunca se toca.

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const { id } = await params;
    if (!id) return jsonError(400, "invalid_request", ctx.requestId, "Falta el id del número");
    const resultado = await desconectarNumero(ctx.supabase, { workspaceId: ctx.workspaceId, numeroId: id });
    if (!resultado.ok) return jsonError(404, "number_not_found", ctx.requestId);
    return jsonOk({ id: resultado.fila.id, phoneNumberId: resultado.fila.phone_number_id, status: resultado.fila.estado }, ctx.requestId);
  });
}
