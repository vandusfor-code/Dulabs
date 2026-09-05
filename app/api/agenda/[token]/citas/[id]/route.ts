import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  especialistaPorRuta,
  especialistasDelMismaPersona,
  especialistasDelTenant,
  confirmarCita,
  rechazarCita,
  proponerReagendamiento,
  editarCitaConfirmada,
  cancelarCita,
  marcarCitaCompletada,
  marcarCitaNoShow,
} from "@/lib/especialistas";
import {
  clienteDeEspecialista,
  notificarCitaConfirmada,
  notificarCitaRechazada,
  notificarPropuestaReagendamiento,
  notificarCitaModificada,
  notificarCitaCancelada,
} from "@/lib/especialistas-notificar";
import { planDelTenant } from "@/lib/plan-limits";
import { requireAuth } from "@/lib/auth/authz";
import { resolverEspecialistasElegiblesParaServicio } from "@/lib/asignacion-categoria";

export const runtime = "nodejs";

// Confirma, rechaza, propone/edita horario, cancela o cierra UNA cita.
//
// Login AMORE (autorizado) — en un tenant SIN login (Daniela, Solo
// Talento) el comportamiento es EXACTO al de siempre: el token de la URL
// identifica a la persona, y solo puede tocar la agenda de "sus hermanas"
// (misma persona, varias especialidades). En un tenant CON login
// habilitado, quién puede tocar qué depende del ROL de la sesión real, no
// del token en la URL:
//   - administrador: puede tocar cualquier cita del tenant (todo el
//     equipo), y puede reasignarla a cualquier especialista ELEGIBLE para
//     el servicio de esa cita (ver resolverEspecialistasElegiblesParaServicio).
//   - colaboradora: solo puede tocar SUS PROPIAS citas (especialista_id =
//     su propio especialista_id, nunca el de otra) y nunca puede reasignar,
//     cambiar servicio ni horario (accion 'editar'/'reagendar' bloqueadas).
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const citaId = Number(id);
  if (!Number.isInteger(citaId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const especialista = await especialistaPorRuta(supabase, token);
  if (!especialista) return Response.json({ error: "Link inválido" }, { status: 404 });

  const plan = await planDelTenant(supabase, especialista.id_tenant);
  if (plan.id === "sin_plan") {
    return Response.json({ error: "Plan pausado, pendiente de pago" }, { status: 403 });
  }

  const auth = await requireAuth(supabase, request, especialista.id_tenant);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const sesion = auth.sesion;

  let idsPermitidos: Set<number>;
  if (sesion && sesion.rol === "administrador") {
    idsPermitidos = new Set((await especialistasDelTenant(supabase, especialista.id_tenant)).map((e) => e.id));
  } else if (sesion && sesion.rol === "colaboradora") {
    idsPermitidos = new Set(sesion.especialistaId ? [sesion.especialistaId] : []);
  } else {
    const hermanas = await especialistasDelMismaPersona(supabase, especialista.phone_number_id, especialista.numero_whatsapp);
    idsPermitidos = new Set(hermanas.length > 0 ? hermanas.map((e) => e.id) : [especialista.id]);
  }

  const { data: citaExistente } = await supabase
    .from("dulabs_citas_especialista")
    .select("especialista_id, servicio_id")
    .eq("id", citaId)
    .maybeSingle();
  if (!citaExistente || !idsPermitidos.has(citaExistente.especialista_id)) {
    return Response.json({ error: "Cita no encontrada" }, { status: 404 });
  }

  // Fase 6A — si la cita ya nació del modelo estructurado (servicio_id no
  // nulo), su duración SIEMPRE se deriva del servicio real, nunca de lo que
  // mande el frontend -- mismo principio que reservarCitaPorServicio (Fase
  // 3). Una cita LEGACY (servicio_id null) sigue exactamente igual que antes.
  let duracionForzadaMin: number | undefined;
  if (citaExistente.servicio_id) {
    const { data: servicio } = await supabase
      .from("dulabs_servicios")
      .select("duracion_min")
      .eq("id_tenant", especialista.id_tenant)
      .eq("id", citaExistente.servicio_id)
      .maybeSingle();
    if (servicio) duracionForzadaMin = servicio.duracion_min as number;
  }

  let body: {
    accion?: "confirmar" | "rechazar" | "reagendar" | "editar" | "cancelar" | "completar" | "no_show";
    motivo?: string;
    nuevo_inicio?: string;
    duracion_min?: number;
    servicio?: string;
    nuevo_especialista_id?: number;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const ACCIONES = ["confirmar", "rechazar", "reagendar", "editar", "cancelar", "completar", "no_show"];
  if (!body.accion || !ACCIONES.includes(body.accion)) {
    return Response.json({ error: `'accion' debe ser una de: ${ACCIONES.join(", ")}` }, { status: 400 });
  }

  // Una colaboradora nunca reasigna, cambia servicio ni mueve el horario de
  // una cita -- eso es exclusivo de administrador (spec Fase 13).
  if (sesion && sesion.rol === "colaboradora" && (body.accion === "editar" || body.accion === "reagendar")) {
    return Response.json({ error: "No tienes permiso para editar o reagendar citas" }, { status: 403 });
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

  if (body.accion === "cancelar") {
    const cita = await cancelarCita(supabase, citaId, body.motivo?.trim() || undefined);
    if (!cita) return Response.json({ error: "Esa cita ya no se puede cancelar" }, { status: 409 });
    if (cliente) await notificarCitaCancelada(cliente, cita);
    return Response.json({ success: true, cita });
  }

  if (body.accion === "completar") {
    const cita = await marcarCitaCompletada(supabase, citaId);
    if (!cita) return Response.json({ error: "Solo una cita confirmada se puede marcar como completada" }, { status: 409 });
    return Response.json({ success: true, cita });
  }

  if (body.accion === "no_show") {
    const cita = await marcarCitaNoShow(supabase, citaId);
    if (!cita) return Response.json({ error: "Solo una cita confirmada se puede marcar como no asistida" }, { status: 409 });
    return Response.json({ success: true, cita });
  }

  if (body.accion === "reagendar") {
    const inicioTexto = body.nuevo_inicio?.trim();
    if (!inicioTexto) return Response.json({ error: "Falta 'nuevo_inicio'" }, { status: 400 });
    const nuevoInicio = new Date(inicioTexto);
    if (Number.isNaN(nuevoInicio.getTime())) return Response.json({ error: "Fecha/hora inválida" }, { status: 400 });

    const duracionMin = duracionForzadaMin ?? body.duracion_min ?? especialista.duracion_min;
    const resultado = await proponerReagendamiento(supabase, citaId, nuevoInicio, duracionMin);
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

  if (body.nuevo_especialista_id !== undefined && !idsPermitidos.has(body.nuevo_especialista_id)) {
    return Response.json({ error: "Esa persona no pertenece a este equipo" }, { status: 400 });
  }

  // Reasignación (Fase "cierre integral", autorizado) — la nueva profesional
  // debe estar ELEGIBLE para el servicio real de la cita (mismo resolver que
  // ya usa el portal público, nunca una matriz de elegibilidad duplicada).
  // Una cita LEGACY sin servicio_id no tiene forma de validar esto -- se
  // permite tal cual (comportamiento de siempre).
  if (body.nuevo_especialista_id !== undefined && citaExistente.servicio_id) {
    const elegibles = await resolverEspecialistasElegiblesParaServicio(supabase, especialista.id_tenant, citaExistente.servicio_id);
    if (elegibles.especialistas.length > 0 && !elegibles.especialistas.some((e) => e.especialistaId === body.nuevo_especialista_id)) {
      return Response.json({ error: "Esa profesional no está autorizada para este servicio" }, { status: 400 });
    }
  }

  const resultado = await editarCitaConfirmada(supabase, citaId, {
    nuevoInicio,
    duracionMin: duracionForzadaMin ?? body.duracion_min,
    // Una cita estructurada conserva su snapshot de servicio tal cual quedó
    // al crearse (Fase 6A, Paso 3) -- solo una cita LEGACY (sin servicio_id)
    // puede tener su texto libre editado desde acá.
    servicio: citaExistente.servicio_id ? undefined : body.servicio,
    especialistaId: body.nuevo_especialista_id,
  });
  if (!resultado.ok) {
    if (resultado.motivo === "ocupado") return Response.json({ error: "Ese horario ya está ocupado" }, { status: 409 });
    if (resultado.motivo === "no_encontrada") return Response.json({ error: "Esa cita no está confirmada" }, { status: 409 });
    return Response.json({ error: resultado.detalle ?? "No se pudo editar la cita" }, { status: 500 });
  }
  if (cliente) await notificarCitaModificada(cliente, resultado.cita);
  return Response.json({ success: true, cita: resultado.cita });
}
