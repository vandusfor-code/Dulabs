import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { especialistaPorRuta, confirmarCita, rechazarCita, proponerReagendamiento, editarCitaConfirmada } from "@/lib/especialistas";
import {
  clienteDeEspecialista,
  notificarCitaConfirmada,
  notificarCitaRechazada,
  notificarPropuestaReagendamiento,
  notificarCitaModificada,
} from "@/lib/especialistas-notificar";

export const runtime = "nodejs";

// Confirma, rechaza, o propone un nuevo horario para UNA solicitud. El token
// en la URL debe ser el de la especialista dueña de esa cita -- así el link
// de una persona nunca puede tocar la agenda de otra, aunque adivine un ID
// de cita ajeno.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const citaId = Number(id);
  if (!Number.isInteger(citaId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const especialista = await especialistaPorRuta(supabase, token);
  if (!especialista) return Response.json({ error: "Link inválido" }, { status: 404 });

  const { data: citaExistente } = await supabase
    .from("dulabs_citas_especialista")
    .select("especialista_id")
    .eq("id", citaId)
    .maybeSingle();
  if (!citaExistente || citaExistente.especialista_id !== especialista.id) {
    return Response.json({ error: "Cita no encontrada" }, { status: 404 });
  }

  let body: {
    accion?: "confirmar" | "rechazar" | "reagendar" | "editar";
    motivo?: string;
    nuevo_inicio?: string;
    duracion_min?: number;
    servicio?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (body.accion !== "confirmar" && body.accion !== "rechazar" && body.accion !== "reagendar" && body.accion !== "editar") {
    return Response.json({ error: "'accion' debe ser 'confirmar', 'rechazar', 'reagendar' o 'editar'" }, { status: 400 });
  }

  const cliente = await clienteDeEspecialista(supabase, especialista.phone_number_id);

  if (body.accion === "confirmar") {
    const cita = await confirmarCita(supabase, citaId);
    if (!cita) return Response.json({ error: "Esa solicitud ya fue procesada" }, { status: 409 });
    if (cliente) await notificarCitaConfirmada(cliente, cita);
    return Response.json({ success: true, cita });
  }

  if (body.accion === "rechazar") {
    const cita = await rechazarCita(supabase, citaId, body.motivo?.trim() || undefined);
    if (!cita) return Response.json({ error: "Esa solicitud ya fue procesada" }, { status: 409 });
    if (cliente) await notificarCitaRechazada(cliente, cita);
    return Response.json({ success: true, cita });
  }

  if (body.accion === "reagendar") {
    const inicioTexto = body.nuevo_inicio?.trim();
    if (!inicioTexto) return Response.json({ error: "Falta 'nuevo_inicio'" }, { status: 400 });
    const nuevoInicio = new Date(inicioTexto);
    if (Number.isNaN(nuevoInicio.getTime())) return Response.json({ error: "Fecha/hora inválida" }, { status: 400 });

    const resultado = await proponerReagendamiento(supabase, citaId, nuevoInicio, body.duracion_min ?? especialista.duracion_min);
    if (!resultado.ok) {
      if (resultado.motivo === "ocupado") return Response.json({ error: "Ese horario ya está ocupado" }, { status: 409 });
      if (resultado.motivo === "no_encontrada") return Response.json({ error: "Esa solicitud ya fue procesada" }, { status: 409 });
      return Response.json({ error: resultado.detalle ?? "No se pudo proponer el horario" }, { status: 500 });
    }
    if (cliente) await notificarPropuestaReagendamiento(cliente, resultado.cita);
    return Response.json({ success: true, cita: resultado.cita });
  }

  // editar: cambia una cita YA confirmada directamente (sin pasar por
  // 'propuesta' ni esperar que la clienta acepte) -- se le avisa del cambio,
  // no se le pide confirmar.
  const nuevoInicio = body.nuevo_inicio?.trim() ? new Date(body.nuevo_inicio.trim()) : undefined;
  if (nuevoInicio && Number.isNaN(nuevoInicio.getTime())) return Response.json({ error: "Fecha/hora inválida" }, { status: 400 });

  const resultado = await editarCitaConfirmada(supabase, citaId, {
    nuevoInicio,
    duracionMin: body.duracion_min,
    servicio: body.servicio,
  });
  if (!resultado.ok) {
    if (resultado.motivo === "ocupado") return Response.json({ error: "Ese horario ya está ocupado" }, { status: 409 });
    if (resultado.motivo === "no_encontrada") return Response.json({ error: "Esa cita no está confirmada" }, { status: 409 });
    return Response.json({ error: resultado.detalle ?? "No se pudo editar la cita" }, { status: 500 });
  }
  if (cliente) await notificarCitaModificada(cliente, resultado.cita);
  return Response.json({ success: true, cita: resultado.cita });
}
