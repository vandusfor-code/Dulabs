import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { especialistaPorToken, citasDeEspecialista, crearCitaEspecialista, confirmarCita } from "@/lib/especialistas";
import { clienteDeEspecialista, notificarCitaConfirmada } from "@/lib/especialistas-notificar";

export const runtime = "nodejs";

// Sin sesión de usuario a propósito: el token de la URL ES la autenticación
// -- quien tiene el link ve y gestiona SOLO la agenda de esa persona. Mismo
// criterio de "simple, sin login" que pidió el negocio para que Nicol lo use
// desde el celular sin fricción.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const especialista = await especialistaPorToken(supabase, token);
  if (!especialista) return Response.json({ error: "Link inválido" }, { status: 404 });

  // Desde hoy (00:00 local) en adelante -- no interesa el historial viejo en esta vista.
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const [citas, cliente] = await Promise.all([
    citasDeEspecialista(supabase, especialista.id, { desde: inicioHoy.toISOString() }),
    clienteDeEspecialista(supabase, especialista.phone_number_id),
  ]);

  return Response.json({
    negocio: cliente?.nombre_negocio ?? "Du Labs",
    especialista: { nombre: especialista.nombre, servicio: especialista.servicio, duracion_min: especialista.duracion_min },
    citas,
  });
}

// Crear una cita manualmente desde la propia pantalla de la especialista
// (ej. una cita personal, o una que le llegó por fuera del bot). Pasa por el
// MISMO camino atómico que usaría el bot -- ninguna cita se salta el
// constraint que impide el solape.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const especialista = await especialistaPorToken(supabase, token);
  if (!especialista) return Response.json({ error: "Link inválido" }, { status: 404 });

  let body: { nombre_cliente?: string; telefono_cliente?: string; servicio?: string; inicio?: string; duracion_min?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const nombreCliente = body.nombre_cliente?.trim();
  const inicioTexto = body.inicio?.trim();
  if (!nombreCliente || !inicioTexto) {
    return Response.json({ error: "Faltan 'nombre_cliente' o 'inicio'" }, { status: 400 });
  }
  const inicio = new Date(inicioTexto);
  if (Number.isNaN(inicio.getTime())) {
    return Response.json({ error: "Fecha/hora inválida" }, { status: 400 });
  }

  const resultado = await crearCitaEspecialista(supabase, {
    especialistaId: especialista.id,
    idTenant: especialista.id_tenant,
    phoneNumberId: especialista.phone_number_id,
    telefonoCliente: body.telefono_cliente?.trim() || null,
    nombreCliente,
    servicio: body.servicio?.trim() || especialista.servicio,
    inicio,
    duracionMin: body.duracion_min ?? especialista.duracion_min,
    origen: "manual",
  });

  if (!resultado.ok) {
    if (resultado.motivo === "ocupado") {
      return Response.json({ error: "Ese horario ya está ocupado" }, { status: 409 });
    }
    return Response.json({ error: resultado.detalle ?? "No se pudo crear la cita" }, { status: 500 });
  }

  // Una cita creada por la propia especialista queda directamente confirmada
  // -- no tiene sentido que se apruebe a sí misma. Solo se avisa a la
  // clienta si dejó un teléfono real (una cita "personal" bloqueada no lo trae).
  const confirmada = await confirmarCita(supabase, resultado.cita.id);
  if (confirmada?.telefono_cliente) {
    const cliente = await clienteDeEspecialista(supabase, especialista.phone_number_id);
    if (cliente) await notificarCitaConfirmada(cliente, confirmada);
  }

  return Response.json({ success: true, cita: confirmada ?? resultado.cita });
}
