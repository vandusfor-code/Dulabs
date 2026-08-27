import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";

export const runtime = "nodejs";

const ESTADOS_VALIDOS = ["PENDIENTE", "EN_CONFIGURACION", "EN_PRUEBAS", "ACTIVO", "REQUIERE_ATENCION"];

// Detalle de un cliente para el Panel de Operaciones: info de cuenta +
// onboarding + implementación, en una sola pantalla. La conversación de
// WhatsApp NO se duplica aquí -- el front usa phoneNumberId/telefonoCliente
// para linkear al Inbox existente (/dashboard/mensajes).
export async function GET(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  const { data: suscripcion, error: susError } = await supabase
    .from("dulabs_suscripciones")
    .select("id_tenant, plan, estado, created_at, telefono_onboarding, wompi_customer_email")
    .eq("id_tenant", idTenant)
    .maybeSingle();
  if (susError) return Response.json({ error: susError.message }, { status: 500 });
  if (!suscripcion) return Response.json({ error: "Cliente no encontrado" }, { status: 404 });

  const { data: authUser } = await supabase.auth.admin.getUserById(idTenant);
  const nombre = (authUser?.user?.user_metadata?.nombre as string | undefined) ?? null;
  const correo = authUser?.user?.email ?? suscripcion.wompi_customer_email ?? null;

  const { data: sesion, error: sesError } = await supabase
    .from("dulabs_onboarding_sesiones")
    .select("*")
    .eq("id_tenant", idTenant)
    .maybeSingle();
  if (sesError) return Response.json({ error: sesError.message }, { status: 500 });

  return Response.json({
    cliente: {
      idTenant: suscripcion.id_tenant,
      nombre,
      correo,
      telefono: suscripcion.telefono_onboarding,
      plan: suscripcion.plan,
      fechaCompra: suscripcion.created_at,
      estadoPago: suscripcion.estado,
    },
    onboarding: sesion
      ? {
          estado: sesion.estado,
          businessDescription: sesion.business_description,
          implementationIdea: sesion.implementation_idea,
          additionalInformation: sesion.additional_information,
          phoneNumberId: sesion.phone_number_id,
          telefonoCliente: sesion.telefono_cliente,
        }
      : null,
    implementacion: sesion
      ? {
          estado: sesion.estado_implementacion,
          iniciadaAt: sesion.implementacion_iniciada_at,
          activadaAt: sesion.activado_at,
          actualizadoAt: sesion.updated_at,
        }
      : null,
  });
}

// Cambia estado_implementacion. Sin validación de secuencia a propósito
// (brief: "no crear un sistema complejo de gestión de proyectos todavía")
// -- cualquiera de los 5 estados es válido desde cualquier otro, incluido
// REQUIERE_ATENCION desde cualquier punto.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  let body: { estado_implementacion?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const nuevoEstado = body.estado_implementacion;
  if (!nuevoEstado || !ESTADOS_VALIDOS.includes(nuevoEstado)) {
    return Response.json({ error: `estado_implementacion debe ser uno de: ${ESTADOS_VALIDOS.join(", ")}` }, { status: 400 });
  }

  const { data: sesionActual, error: leerError } = await supabase
    .from("dulabs_onboarding_sesiones")
    .select("id, estado_implementacion, implementacion_iniciada_at, activado_at")
    .eq("id_tenant", idTenant)
    .maybeSingle();
  if (leerError) return Response.json({ error: leerError.message }, { status: 500 });
  if (!sesionActual) {
    return Response.json(
      { error: "Este cliente todavía no tiene sesión de onboarding (no se le pudo enviar la bienvenida -- ver telefono_onboarding)" },
      { status: 404 }
    );
  }

  const cambios: Record<string, unknown> = { estado_implementacion: nuevoEstado, updated_at: new Date().toISOString() };
  // activado_at: solo se llena la PRIMERA vez que llega a ACTIVO (hito
  // histórico para la métrica de tiempo pago->activación, ver Fase 9) --
  // nunca se pisa en cambios posteriores, ni siquiera si sale y vuelve a ACTIVO.
  if (nuevoEstado === "ACTIVO" && !sesionActual.activado_at) {
    cambios.activado_at = new Date().toISOString();
  }
  if (sesionActual.estado_implementacion === "PENDIENTE" && nuevoEstado !== "PENDIENTE" && !sesionActual.implementacion_iniciada_at) {
    cambios.implementacion_iniciada_at = new Date().toISOString();
  }

  const { error: updateError } = await supabase.from("dulabs_onboarding_sesiones").update(cambios).eq("id", sesionActual.id);
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  return Response.json({ success: true });
}
