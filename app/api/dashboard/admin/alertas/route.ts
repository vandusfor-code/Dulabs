import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { calcularAlertas } from "@/lib/alertas-admin";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;

  const alertas = await calcularAlertas(acceso.supabase);
  const estado = request.nextUrl.searchParams.get("estado");
  const filtradas = estado ? alertas.filter((a) => a.estado === estado) : alertas;
  return Response.json({ alertas: filtradas });
}

export async function PATCH(request: NextRequest) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const supabase = acceso.supabase;

  let body: { clave?: string; estado?: "vista" | "resuelta" | "nueva" };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.clave || !["nueva", "vista", "resuelta"].includes(body.estado ?? "")) {
    return Response.json({ error: "Faltan 'clave' o 'estado' válido" }, { status: 400 });
  }

  const { error } = await supabase
    .from("dulabs_alertas_estado")
    .upsert({ clave: body.clave, estado: body.estado, actualizado_por: acceso.miembro.userId, updated_at: new Date().toISOString() }, { onConflict: "clave" });
  // Fail-safe: si la migración 20260914110000 (tabla dulabs_alertas_estado)
  // todavía no corrió, el estado simplemente no se puede persistir todavía
  // -- se informa con un mensaje claro en vez de un 500 opaco.
  if (error?.code === "PGRST205" || error?.message?.includes("dulabs_alertas_estado")) {
    return Response.json({ error: "El seguimiento de alertas requiere una migración pendiente de aplicar." }, { status: 503 });
  }
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await registrarAuditoriaAdmin(supabase, { operador: acceso.miembro, accion: "UPDATE_ALERT_STATE", recurso: body.clave, metadata: { estado: body.estado } });
  return Response.json({ success: true });
}
