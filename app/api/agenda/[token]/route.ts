import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  especialistaPorRuta,
  especialistaPorServicio,
  especialistasDelMismaPersona,
  categoriaDeServicio,
  especialistasPorCategoria,
  crearCitaEnCategoria,
  citasDeEspecialista,
  confirmarCita,
  type Especialista,
} from "@/lib/especialistas";
import { clienteDeEspecialista, notificarCitaConfirmada } from "@/lib/especialistas-notificar";
import { recordarNombreCliente } from "@/lib/clientes-conocidos";
import { planDelTenant } from "@/lib/plan-limits";

export const runtime = "nodejs";

// Sin sesión de usuario a propósito: el token de la URL ES la autenticación
// -- quien tiene el link ve y gestiona SOLO la agenda de esa persona. Mismo
// criterio de "simple, sin login" que pidió el negocio para que Nicol lo use
// desde el celular sin fricción.
//
// Una misma persona puede tener más de una especialidad registrada (ej.
// Daniela: "pestañas" + el catálogo "general" del resto de servicios) --
// se muestran juntas bajo el link de cualquiera de las dos, para que no
// tenga que abrir un link distinto por cada una.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const especialista = await especialistaPorRuta(supabase, token);
  if (!especialista) return Response.json({ error: "Link inválido" }, { status: 404 });

  // Plan pausado (cortesía vencida, pago pendiente, etc.): el panel abre
  // normal -- nunca un error -- pero sin ninguna cita ni dato del negocio,
  // solo lo justo para que el front muestre el aviso. Misma fuente de
  // verdad que ya usa el resto de la plataforma (planDelTenant, ver
  // lib/plan-limits.ts): SIN_PLAN cuando no hay una fila con estado='activa'.
  const plan = await planDelTenant(supabase, especialista.id_tenant);
  if (plan.id === "sin_plan") {
    const clientePausado = await clienteDeEspecialista(supabase, especialista.phone_number_id);
    return Response.json({ planPausado: true, negocio: clientePausado?.nombre_negocio ?? "Du Labs" });
  }

  const hermanas = await especialistasDelMismaPersona(supabase, especialista.phone_number_id, especialista.numero_whatsapp);
  const equipo = hermanas.length > 0 ? hermanas : [especialista];
  const ids = equipo.map((e) => e.id);
  // Varias especialidades pueden ser LA MISMA PERSONA (ej. Daniela: pestañas
  // + manos-daniela) -- el desplegable de "reasignar profesional" del panel
  // debe mostrar cada PERSONA una sola vez, no una fila por especialidad.
  const nombrePorId = new Map(equipo.map((e) => [e.id, e.nombre] as const));
  const equipoUnico = [...new Map(equipo.map((e) => [e.nombre, { id: e.id, nombre: e.nombre }])).values()];

  // Desde hoy (00:00 local) en adelante -- no interesa el historial viejo en esta vista.
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const [citasPorId, cliente] = await Promise.all([
    Promise.all(ids.map((id) => citasDeEspecialista(supabase, id, { desde: inicioHoy.toISOString() }))),
    clienteDeEspecialista(supabase, especialista.phone_number_id),
  ]);
  // Cada cita queda marcada con quién la atiende de verdad -- varias
  // especialidades comparten número de WhatsApp (ver especialistasDelMismaPersona),
  // así que sin esto el panel mostraría citas de Carla o Kelly como si
  // fueran de Daniela solo porque se ven desde su link.
  const citas = citasPorId
    .flat()
    .map((c) => ({ ...c, profesional: nombrePorId.get(c.especialista_id) ?? especialista.nombre }))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));

  return Response.json({
    negocio: cliente?.nombre_negocio ?? "Du Labs",
    especialista: {
      nombre: especialista.nombre,
      servicio: ids.length > 1 ? "Todos los servicios" : especialista.servicio,
      duracion_min: especialista.duracion_min,
    },
    equipo: equipoUnico,
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
  const especialista = await especialistaPorRuta(supabase, token);
  if (!especialista) return Response.json({ error: "Link inválido" }, { status: 404 });

  const plan = await planDelTenant(supabase, especialista.id_tenant);
  if (plan.id === "sin_plan") {
    return Response.json({ error: "Plan pausado, pendiente de pago" }, { status: 403 });
  }

  let body: {
    nombre_cliente?: string;
    telefono_cliente?: string;
    servicio?: string;
    inicio?: string;
    duracion_min?: number;
    con_quien?: string;
  };
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

  const servicio = body.servicio?.trim() || especialista.servicio;
  const conQuien = body.con_quien?.trim().toLowerCase();

  // El servicio que escribió puede pertenecer a OTRA de sus especialidades
  // (ej. abrió el link de "pestañas" pero está anotando una de "uñas") --
  // se resuelve igual que cuando lo pide el bot: primero especialidad propia
  // y exclusiva (pestañas), si no calza cae a la categoría compartida
  // (manos/pies), filtrada a una persona si se pidió "con_quien".
  const especialistaExclusiva = await especialistaPorServicio(supabase, especialista.phone_number_id, servicio);
  let candidatas: Especialista[];
  if (especialistaExclusiva) {
    candidatas = [especialistaExclusiva];
  } else {
    const porCategoria = await especialistasPorCategoria(supabase, especialista.phone_number_id, categoriaDeServicio(servicio));
    candidatas = conQuien ? porCategoria.filter((e) => e.nombre.toLowerCase().includes(conQuien)) : porCategoria;
    if (candidatas.length === 0) candidatas = [especialista]; // respaldo: la del link, si nada más calzó
  }

  const resultado = await crearCitaEnCategoria(supabase, candidatas, {
    telefonoCliente: body.telefono_cliente?.trim() || null,
    nombreCliente,
    servicio,
    inicio,
    duracionMin: body.duracion_min ?? candidatas[0].duracion_min,
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
  const confirmada = (await confirmarCita(supabase, resultado.cita.id)) ?? resultado.cita;
  if (confirmada.telefono_cliente) {
    const cliente = await clienteDeEspecialista(supabase, especialista.phone_number_id);
    if (cliente) await notificarCitaConfirmada(cliente, confirmada);
    await recordarNombreCliente(supabase, {
      idTenant: resultado.especialista.id_tenant,
      phoneNumberId: resultado.especialista.phone_number_id,
      telefonoCliente: confirmada.telefono_cliente,
      nombre: confirmada.nombre_cliente,
    });
  }

  return Response.json({ success: true, cita: confirmada, con: resultado.especialista.nombre });
}
