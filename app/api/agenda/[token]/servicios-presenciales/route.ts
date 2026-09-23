import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { ejecutarConIdempotencia, huellaSolicitud } from "@/lib/idempotencia-reserva";
import { validarServicioPresencial, registrarServicioPresencial, type BodyServicioPresencial } from "@/lib/servicio-presencial";
import { resolverPhoneNumberIdCliente } from "../clientes/identidad";

export const runtime = "nodejs";

// Registrar un servicio PRESENCIAL (clienta que llegó sin reserva) -- ver lib/servicio-presencial.ts. Acción
// administrativa: mismo criterio que crear una cita a mano (solo administrador). Protegido contra doble toque con la
// MISMA idempotencia de las reservas (dulabs_idempotencia_reservas): el modal genera una clave al abrirse.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  let body: BodyServicioPresencial;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const validacion = validarServicioPresencial(body, new Date());
  if (!validacion.ok) return Response.json({ error: validacion.error }, { status: 400 });
  const datos = validacion.datos;

  const idempotente = await ejecutarConIdempotencia(supabase, {
    idTenant: tenant.idTenant,
    idempotencyKey: `presencial:${datos.idempotencyKey}`,
    huella: huellaSolicitud([
      tenant.idTenant,
      "presencial",
      datos.servicioId,
      datos.servicioNombre,
      datos.precio,
      datos.especialistaId,
      datos.nombreCliente,
      datos.telefonoCliente,
      // Lo que MANDÓ el formulario (no "ahora" del servidor): un reintento idéntico debe dar la misma huella.
      typeof body.realizadoEn === "string" ? body.realizadoEn : "",
    ]),
    operacion: () =>
      registrarServicioPresencial(supabase, { idTenant: tenant.idTenant, phoneNumberIdCliente: resolverPhoneNumberIdCliente(tenant) }, datos),
  }).catch((err: unknown) => {
    console.error("[servicio-presencial] error técnico:", err instanceof Error ? err.message : "error desconocido", { idTenant: tenant.idTenant });
    return null;
  });
  if (!idempotente) return Response.json({ error: "No se pudo registrar el servicio. Intenta de nuevo." }, { status: 500 });

  if (idempotente.estado === "conflicto") {
    return Response.json({ error: "Esta solicitud ya se procesó con datos diferentes. Cierra y vuelve a abrir el formulario." }, { status: 409 });
  }
  if (idempotente.estado === "en_progreso") {
    return Response.json({ error: "Se está registrando, espera un momento." }, { status: 409 });
  }
  const resultado = idempotente.resultado;
  if (!resultado.ok) return Response.json({ error: resultado.error }, { status: resultado.status });
  return Response.json({ success: true, registro: resultado.registro });
}
