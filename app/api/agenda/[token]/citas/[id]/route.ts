import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { especialistaPorToken, confirmarCita, rechazarCita } from "@/lib/especialistas";
import { clienteDeEspecialista, notificarCitaConfirmada, notificarCitaRechazada } from "@/lib/especialistas-notificar";

export const runtime = "nodejs";

// Confirma o rechaza UNA solicitud pendiente. El token en la URL debe ser el
// de la especialista dueña de esa cita -- así el link de una persona nunca
// puede tocar la agenda de otra, aunque adivine un ID de cita ajeno.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const citaId = Number(id);
  if (!Number.isInteger(citaId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const especialista = await especialistaPorToken(supabase, token);
  if (!especialista) return Response.json({ error: "Link inválido" }, { status: 404 });

  const { data: citaExistente } = await supabase
    .from("dulabs_citas_especialista")
    .select("especialista_id")
    .eq("id", citaId)
    .maybeSingle();
  if (!citaExistente || citaExistente.especialista_id !== especialista.id) {
    return Response.json({ error: "Cita no encontrada" }, { status: 404 });
  }

  let body: { accion?: "confirmar" | "rechazar"; motivo?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (body.accion !== "confirmar" && body.accion !== "rechazar") {
    return Response.json({ error: "'accion' debe ser 'confirmar' o 'rechazar'" }, { status: 400 });
  }

  const cliente = await clienteDeEspecialista(supabase, especialista.phone_number_id);

  if (body.accion === "confirmar") {
    const cita = await confirmarCita(supabase, citaId);
    if (!cita) return Response.json({ error: "Esa solicitud ya fue procesada" }, { status: 409 });
    if (cliente) await notificarCitaConfirmada(cliente, cita);
    return Response.json({ success: true, cita });
  }

  const cita = await rechazarCita(supabase, citaId, body.motivo?.trim() || undefined);
  if (!cita) return Response.json({ error: "Esa solicitud ya fue procesada" }, { status: 409 });
  if (cliente) await notificarCitaRechazada(cliente, cita);
  return Response.json({ success: true, cita });
}
