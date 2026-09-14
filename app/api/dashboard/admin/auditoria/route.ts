import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { listarAuditoriaAdmin } from "@/lib/auditoria-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;

  try {
    const { eventos, siguienteCursor } = await listarAuditoriaAdmin(acceso.supabase, {
      idTenant: request.nextUrl.searchParams.get("tenant") ?? undefined,
      accion: request.nextUrl.searchParams.get("accion") ?? undefined,
      cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
      limite: Number(request.nextUrl.searchParams.get("limite") ?? "50") || 50,
    });
    return Response.json({ eventos, siguienteCursor });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
