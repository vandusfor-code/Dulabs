import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  especialistaPorRuta,
  especialistasDelMismaPersona,
  especialistasDelTenant,
  citasDeEspecialista,
  confirmarCita,
  type Especialista,
} from "@/lib/especialistas";
import { clienteDeEspecialista, notificarCitaConfirmada } from "@/lib/especialistas-notificar";
import { planDelTenant } from "@/lib/plan-limits";
import { reservarCitaPorServicio } from "@/lib/disponibilidad-servicio";
import { ejecutarConIdempotencia, huellaSolicitud } from "@/lib/idempotencia-reserva";
import { mensajeAmigableReserva } from "@/lib/reservar-mensajes";
import { requireAuth, requireRole } from "@/lib/auth/authz";

export const runtime = "nodejs";

// En un tenant SIN login (Daniela, Solo Talento) el token de la URL sigue
// siendo TODA la autenticación -- ningún cambio de comportamiento. En un
// tenant CON login habilitado (Login AMORE, autorizado), esta ruta además
// exige una sesión real que pertenezca a este tenant, y el "equipo"/"citas"
// que devuelve depende del ROL de esa sesión, no de con qué token se entró:
//   - administrador: ve y gestiona el equipo COMPLETO del tenant.
//   - colaboradora: ve SOLO su propia agenda (jamás la de otra persona,
//     aunque conociera su token).
//
// Una misma persona puede tener más de una especialidad registrada (ej.
// Daniela: "pestañas" + el catálogo "general" del resto de servicios) --
// se muestran juntas bajo el link de cualquiera de las dos, para que no
// tenga que abrir un link distinto por cada una. Esto sigue igual para
// cualquier tenant sin login.
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

  const auth = await requireAuth(supabase, request, especialista.id_tenant);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const sesion = auth.sesion;

  let equipo: Especialista[];
  if (sesion && sesion.rol === "administrador") {
    equipo = await especialistasDelTenant(supabase, especialista.id_tenant);
  } else if (sesion && sesion.rol === "colaboradora") {
    equipo = sesion.especialistaId ? [especialista].filter((e) => e.id === sesion.especialistaId) : [];
    if (equipo.length === 0) equipo = [especialista];
  } else {
    const hermanas = await especialistasDelMismaPersona(supabase, especialista.phone_number_id, especialista.numero_whatsapp);
    equipo = hermanas.length > 0 ? hermanas : [especialista];
  }
  const ids = equipo.map((e) => e.id);
  // Varias especialidades pueden ser LA MISMA PERSONA (ej. Daniela: pestañas
  // + manos-daniela) -- el desplegable de "reasignar profesional" del panel
  // debe mostrar cada PERSONA una sola vez, no una fila por especialidad.
  const nombrePorId = new Map(equipo.map((e) => [e.id, e.nombre] as const));
  const equipoUnico = [...new Map(equipo.map((e) => [e.nombre, { id: e.id, nombre: e.nombre }])).values()];

  // Desde hoy (00:00 local) en adelante -- no interesa el historial viejo en esta vista.
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  const [citasPorId, cliente, clientesRegistrados, serviciosActivos, profesionalesActivos] = await Promise.all([
    Promise.all(ids.map((id) => citasDeEspecialista(supabase, id, { desde: inicioHoy.toISOString() }))),
    clienteDeEspecialista(supabase, especialista.phone_number_id),
    // Fase 5 -- conteos reales del negocio para el resumen de inicio, todos
    // filtrados por id_tenant (nunca por phone_number_id: un tenant puede
    // tener más de un número, y estos conteos son del NEGOCIO completo).
    supabase
      .from("dulabs_clientes_conocidos")
      .select("id", { count: "exact", head: true })
      .eq("id_tenant", especialista.id_tenant),
    supabase
      .from("dulabs_servicios")
      .select("id", { count: "exact", head: true })
      .eq("id_tenant", especialista.id_tenant)
      .eq("activo", true),
    supabase
      .from("dulabs_especialistas")
      .select("id", { count: "exact", head: true })
      .eq("id_tenant", especialista.id_tenant)
      .eq("activo", true),
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
    resumen: {
      clientesRegistrados: clientesRegistrados.count ?? 0,
      serviciosActivos: serviciosActivos.count ?? 0,
      profesionalesActivos: profesionalesActivos.count ?? 0,
    },
    sesion: sesion
      ? { rol: sesion.rol, nombre: sesion.nombre, username: sesion.username, especialistaId: sesion.especialistaId }
      : null,
  });
}

type BodyNuevaCita = {
  servicioId?: string;
  especialistaId?: number;
  fecha?: string;
  hora?: string;
  nombreCliente?: string;
  telefonoCliente?: string;
  correoCliente?: string;
  idempotencyKey?: string;
};

// Fase 6A (sistema de reservas de Daniela) — crea una cita manualmente desde
// el panel usando el MISMO núcleo transaccional que el portal público
// (reservarCitaPorServicio, Fase 3) en vez del camino LEGACY de texto libre
// que usaba esta ruta antes. El backend determina servicio/duración/fin;
// el frontend solo manda servicioId + especialistaId + fecha/hora + datos
// del cliente. Protegido contra doble clic por la MISMA idempotencia del
// portal (dulabs_idempotencia_reservas) -- ver lib/idempotencia-reserva.ts,
// reutilizada tal cual, sin ningún cambio.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const especialista = await especialistaPorRuta(supabase, token);
  if (!especialista) return Response.json({ error: "Link inválido" }, { status: 404 });

  const plan = await planDelTenant(supabase, especialista.id_tenant);
  if (plan.id === "sin_plan") {
    return Response.json({ error: "Plan pausado, pendiente de pago" }, { status: 403 });
  }

  const auth = await requireAuth(supabase, request, especialista.id_tenant);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  // Crear una cita manualmente desde el panel es una acción administrativa
  // -- el flujo real de una colaboradora es "el cliente reserva por el
  // portal/WhatsApp", nunca ella creando citas a mano (spec Fase 13, que no
  // lista "crear cita" entre sus acciones permitidas).
  const permiso = requireRole(auth.sesion, "administrador");
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  let body: BodyNuevaCita;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const servicioId = body.servicioId?.trim();
  const especialistaId = Number(body.especialistaId);
  const fecha = body.fecha?.trim();
  const hora = body.hora?.trim();
  const nombreCliente = body.nombreCliente?.trim();
  const telefonoCliente = body.telefonoCliente?.trim() || null;
  const correoCliente = body.correoCliente?.trim() || undefined;
  const idempotencyKey = body.idempotencyKey?.trim();

  if (!servicioId || !Number.isInteger(especialistaId) || !fecha || !hora || !nombreCliente) {
    return Response.json({ error: "Faltan datos obligatorios" }, { status: 400 });
  }
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return Response.json({ error: "Falta identificador de solicitud" }, { status: 400 });
  }

  const inicio = new Date(`${fecha}T${hora}:00-05:00`);
  if (Number.isNaN(inicio.getTime())) {
    return Response.json({ error: "Fecha u hora inválida" }, { status: 400 });
  }

  const idTenant = especialista.id_tenant;
  const huella = huellaSolicitud([idTenant, servicioId, especialistaId, inicio.toISOString(), telefonoCliente, nombreCliente]);

  const idempotente = await ejecutarConIdempotencia(supabase, {
    idTenant,
    idempotencyKey,
    huella,
    // El auto-confirmar y la notificación de WhatsApp viven DENTRO de la
    // operación cacheada -- así corren exactamente UNA vez. Si el confirmar
    // quedara fuera (después de leer el resultado idempotente), un retry
    // reintentaría confirmar una cita que ya quedó confirmada por el primer
    // intento (la actualización fallaría por el guard de estado) y
    // devolvería la foto vieja ("pendiente") guardada en la caché de
    // idempotencia en vez del estado real -- exactamente el motivo por el
    // que esto vive aquí adentro y no afuera.
    operacion: async () => {
      const resultado = await reservarCitaPorServicio(supabase, {
        idTenant,
        especialistaId,
        servicioId,
        telefonoCliente,
        nombreCliente,
        correoCliente,
        inicio,
        origen: "manual",
      });
      if (!resultado.ok) return resultado;

      const confirmada = (await confirmarCita(supabase, resultado.cita.id)) ?? resultado.cita;
      if (confirmada.telefono_cliente) {
        const cliente = await clienteDeEspecialista(supabase, especialista.phone_number_id);
        if (cliente) await notificarCitaConfirmada(cliente, confirmada);
      }
      return { ...resultado, cita: confirmada };
    },
  });

  if (idempotente.estado === "conflicto") {
    return Response.json({ error: "Esta solicitud ya se procesó con datos diferentes. Actualiza la página e intenta de nuevo." }, { status: 409 });
  }
  if (idempotente.estado === "en_progreso") {
    return Response.json({ error: "Tu solicitud se está procesando, espera un momento." }, { status: 409 });
  }

  const resultado = idempotente.resultado;
  if (!resultado.ok) {
    if (resultado.motivo === "error") {
      console.error("[agenda-nueva-cita] error creando cita:", resultado.detalle, { idTenant, servicioId, especialistaId });
    }
    return Response.json({ error: mensajeAmigableReserva(resultado.motivo) }, { status: 409 });
  }

  return Response.json({ success: true, cita: resultado.cita, con: resultado.especialista.nombre });
}
