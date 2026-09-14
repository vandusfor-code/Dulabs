import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";

export const runtime = "nodejs";

// FASE F15 (Operations Center, autorizado) -- Fase 14 del pedido: acceso
// del cliente, SIN jamás ver/almacenar/loguear una contraseña. La única
// operación soportada es enviar un correo real de restablecimiento vía
// Supabase Auth (resetPasswordForEmail) -- el mismo mecanismo que
// cualquier "olvidé mi contraseña" usaría, generado y despachado por
// Supabase, nunca por este servidor. No existe "forzar cambio de
// contraseña" ni "revocar sesión" en la infraestructura actual (Supabase
// Admin API no expone un endpoint estable de "matar sesión" en este
// proyecto) -- no se inventa ninguno; queda documentado como no
// disponible en vez de simularlo.
export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  // F15.2 (Operations Center, cierre) -- ver criterio en .../clientes/nuevo/route.ts.
  // Doblemente relevante acá: cada llamada manda un correo real, y Supabase
  // ya tiene su PROPIO límite de envío (ver f15-admin-operations-center.e2e.test.ts)
  // -- esta capa evita agotarlo aún más rápido por un loop del operador.
  const limite = await respuestaSiLimiteTasaExcedido(supabase, { recurso: "admin_reset_password", tenantId: acceso.miembro.userId, categoria: "costosa" });
  if (limite) return limite;

  let body: { accion?: "reset_password" };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (body.accion !== "reset_password") {
    return Response.json({ error: "Solo se soporta 'accion: reset_password'" }, { status: 400 });
  }

  const { data: authUser } = await supabase.auth.admin.getUserById(idTenant);
  const correo = authUser?.user?.email;
  if (!correo) return Response.json({ error: "No se encontró el correo del propietario de esta cuenta" }, { status: 404 });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const { error } = await supabase.auth.resetPasswordForEmail(correo, {
    redirectTo: siteUrl ? `${siteUrl}/login` : undefined,
  });

  await registrarAuditoriaAdmin(supabase, {
    operador: acceso.miembro,
    accion: "RESET_PASSWORD",
    idTenant,
    resultado: error ? "error" : "ok",
    motivo: error ? error.message : null,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true, correo });
}
