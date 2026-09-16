import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { listarNumeros } from "@/lib/developer/whatsapp-numbers-store";

// DuLabs Developer V1 -- Fase 9/10 (autorizado). GET (listar, cualquier rol).
// La proyección pública NUNCA incluye el token de Meta cifrado. La conexión
// (POST) se movió a /api/developer/whatsapp/connect (Embedded Signup real,
// Fase 10) -- ver nota en el POST de abajo.

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

// Fase 10 (autorizado): la conexión REAL de un número pasa exclusivamente por
// POST /api/developer/whatsapp/connect (Embedded Signup -> code exchange
// server-side -> token obtenido y cifrado por el backend). Esta ruta ya NO
// acepta un `metaToken` desde el navegador -- meter el token del cliente por
// el frontend violaba "el token nunca viaja al/desde el navegador". Se
// responde 410 apuntando al flujo correcto en vez de dejar una vía insegura
// abierta.
export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    return jsonError(410, "use_embedded_signup", ctx.requestId, "Conecta un número vía POST /api/developer/whatsapp/connect (Meta Embedded Signup). El token de Meta nunca se envía manualmente.");
  });
}
