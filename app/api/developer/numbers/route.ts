import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { listarNumeros, registrarNumeroConLimite } from "@/lib/developer/whatsapp-numbers-store";
import { resolverLimitesDelWorkspace } from "@/lib/developer/plans";

// DuLabs Developer V1 -- Fase 9 (autorizado). GET (listar, cualquier rol) /
// POST (registrar, OWNER o ADMIN). La proyección pública NUNCA incluye el
// token de Meta cifrado. El límite de números del plan (Fase 7) se aplica de
// forma atómica.

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN", "MEMBER"], async (ctx) => {
    const filas = await listarNumeros(ctx.supabase, ctx.workspaceId);
    // Proyección segura: nunca meta_token_cifrado (listarNumeros ya excluye el token, pero se re-mapea explícito por claridad de contrato del Dashboard).
    const numbers = filas.map((n) => ({
      id: n.id,
      phoneNumberId: n.phone_number_id,
      displayName: n.display_name,
      status: n.estado,
      wabaId: n.whatsapp_business_account_id,
      createdAt: n.created_at,
    }));
    return jsonOk({ numbers }, ctx.requestId);
  });
}

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const cuerpo = (await request.json().catch(() => null)) as { phoneNumberId?: string; wabaId?: string; displayName?: string; metaToken?: string } | null;
    if (!cuerpo?.phoneNumberId) return jsonError(400, "invalid_request", ctx.requestId, "Falta 'phoneNumberId'");
    const limites = await resolverLimitesDelWorkspace(ctx.supabase, ctx.workspaceId);
    const resultado = await registrarNumeroConLimite(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      phoneNumberId: cuerpo.phoneNumberId,
      wabaId: cuerpo.wabaId,
      displayName: cuerpo.displayName,
      metaToken: cuerpo.metaToken,
      limiteNumeros: limites.numerosIncluidos,
    });
    if (!resultado.ok) {
      if (resultado.motivo === "limite_numeros_excedido") {
        return jsonError(403, "number_limit_exceeded", ctx.requestId, `El plan ${limites.planCodigo} incluye ${limites.numerosIncluidos} números`);
      }
      return jsonError(409, resultado.motivo, ctx.requestId);
    }
    return jsonOk(
      { id: resultado.fila.id, phoneNumberId: resultado.fila.phone_number_id, displayName: resultado.fila.display_name, status: resultado.fila.estado, createdAt: resultado.fila.created_at },
      ctx.requestId,
      201
    );
  });
}
