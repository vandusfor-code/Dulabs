import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";
import { activarSuscripcionManual } from "@/lib/suscripcion-domain";
import { PLANES, type PlanId } from "@/lib/planes";
import { normalizarTelefono } from "@/lib/marketplace-store";

export const runtime = "nodejs";

// FASE F15 (Operations Center, autorizado) -- Fase 6 del pedido: alta
// manual de cliente. Reutiliza EXACTAMENTE el mismo criterio de
// provisioning que ya usa el self-service (app/api/pagos/suscribir/route.ts):
// tenant_id = user_id del dueño, miembro admin activo. Nunca establece una
// contraseña manual -- usa inviteUserByEmail (Supabase Auth genera y manda
// el correo real de invitación, el cliente elige su propia contraseña),
// mismo mecanismo que ya usa /api/dashboard/equipo para invitar miembros.
type Body = {
  nombre?: string;
  email?: string;
  telefono?: string;
  plan?: string;
  estado_inicial?: "activa" | "sin_plan";
  observacion?: string;
};

export async function POST(request: NextRequest) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const supabase = acceso.supabase;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const nombre = body.nombre?.trim();
  if (!email || !nombre) return Response.json({ error: "Faltan 'nombre' o 'email'" }, { status: 400 });
  if (body.plan && !(body.plan in PLANES)) return Response.json({ error: "Plan inválido" }, { status: 400 });

  // Validación de email duplicado -- tanto en Auth como en el equipo (un
  // email podría existir en Auth sin fila de equipo, caso raro pero real:
  // registro auto-servicio que nunca completó pago, ver caso Daniel F7).
  const { data: yaMiembro } = await supabase.from("dulabs_miembros_equipo").select("id").eq("email", email).maybeSingle();
  if (yaMiembro) return Response.json({ error: "Ese correo ya pertenece a una cuenta existente" }, { status: 409 });

  const telefono = body.telefono ? normalizarTelefono(body.telefono) : null;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const { data: invitado, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { nombre },
    redirectTo: siteUrl ? `${siteUrl}/login` : undefined,
  });
  // Concurrencia: si dos operadores crean el mismo cliente casi
  // simultáneamente, Supabase Auth rechaza el segundo intento (email ya
  // registrado) -- se traduce a un 409 claro en vez de un 500 genérico.
  if (inviteError || !invitado.user) {
    const yaExisteEnAuth = inviteError?.message?.toLowerCase().includes("already") ?? false;
    await registrarAuditoriaAdmin(supabase, { operador: acceso.miembro, accion: "CREATE_CLIENT", resultado: "error", motivo: inviteError?.message, metadata: { email } });
    return Response.json({ error: inviteError?.message ?? "No se pudo invitar al cliente" }, { status: yaExisteEnAuth ? 409 : 500 });
  }

  const tenantId = invitado.user.id;
  const { error: miembroError } = await supabase.from("dulabs_miembros_equipo").insert({
    tenant_id: tenantId,
    user_id: tenantId,
    email,
    nombre,
    rol: "admin",
    estado: "invitado",
    invitado_por: acceso.miembro.userId,
  });
  if (miembroError) {
    await registrarAuditoriaAdmin(supabase, { operador: acceso.miembro, accion: "CREATE_CLIENT", idTenant: tenantId, resultado: "error", motivo: miembroError.message });
    return Response.json({ error: miembroError.message }, { status: 500 });
  }

  let suscripcionCreada = null;
  if (body.plan && body.estado_inicial === "activa") {
    const precioCop = PLANES[body.plan as PlanId].precioCop ?? 0;
    const r = await activarSuscripcionManual(supabase, {
      idTenant: tenantId,
      plan: body.plan,
      precioCop,
      correo: email,
      operador: null,
      motivo: body.observacion ?? "Alta manual desde el Panel de Operaciones",
    });
    if (r.ok) suscripcionCreada = r.data.suscripcion;
  }

  await registrarAuditoriaAdmin(supabase, {
    operador: acceso.miembro,
    accion: "CREATE_CLIENT",
    idTenant: tenantId,
    resultado: "ok",
    motivo: body.observacion ?? null,
    metadata: { email, nombre, telefono, plan: body.plan ?? null },
  });

  return Response.json({ success: true, idTenant: tenantId, suscripcion: suscripcionCreada });
}
