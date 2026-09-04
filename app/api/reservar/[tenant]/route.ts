import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { planDelTenant } from "@/lib/plan-limits";
import { reservarCitaPorServicio } from "@/lib/disponibilidad-servicio";
import { ejecutarConIdempotencia, huellaSolicitud } from "@/lib/idempotencia-reserva";
import { enviarConfirmacionReservaWhatsApp } from "@/lib/reserva-notificaciones-whatsapp";

export const runtime = "nodejs";

// Portal público de reservas (Fase 4) — identifica al NEGOCIO, no a un
// especialista puntual (a diferencia de /agenda/[token]): el token de la
// URL es directamente id_tenant. Es un UUID aleatorio de 128 bits (nunca
// secuencial, nunca adivinable) -- el mismo identificador que ya usa TODO
// el aislamiento multi-tenant del sistema; no se crea un token nuevo para
// esto. Documentado como límite conocido: un slug más corto/bonito (ej.
// "danielamanco") es una mejora de UX legítima para cuando exista un
// segundo salón, no un requisito de seguridad de esta fase.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tenantInvalido(tenant: string) {
  return !UUID_RE.test(tenant);
}

// Datos de arranque del portal: si el negocio existe/tiene plan activo, su
// nombre para el header, y el catálogo real de servicios activos. Nunca se
// inventan servicios ni se leen desde código -- todo sale de dulabs_servicios.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (tenantInvalido(tenant)) return Response.json({ error: "Enlace inválido" }, { status: 404 });

  const supabase = supabaseAdmin();
  const plan = await planDelTenant(supabase, tenant);
  if (plan.id === "sin_plan") {
    return Response.json({ disponible: false });
  }

  const [{ data: clienteConfig }, { data: servicios }] = await Promise.all([
    supabase.from("dulabs_clientes_config").select("nombre_negocio, telefono_negocio").eq("id_tenant", tenant).limit(1).maybeSingle(),
    supabase
      .from("dulabs_servicios")
      .select("id, nombre, categoria, descripcion, duracion_min, precio, imagen_url")
      .eq("id_tenant", tenant)
      .eq("activo", true)
      .order("categoria", { ascending: true, nullsFirst: true })
      .order("nombre", { ascending: true }),
  ]);

  return Response.json({
    disponible: true,
    negocio: clienteConfig?.nombre_negocio ?? "Du Labs",
    // Fase 8A.7 (autorizado) — número real de WhatsApp del negocio, para el
    // CTA "¿Dudas? Escríbenos por WhatsApp" del portal. Nunca inventado.
    telefonoNegocio: clienteConfig?.telefono_negocio ?? null,
    servicios: servicios ?? [],
  });
}

type BodyReserva = {
  servicioId?: string;
  especialistaId?: number;
  fecha?: string;
  hora?: string;
  nombreCliente?: string;
  telefonoCliente?: string;
  correoCliente?: string;
  idempotencyKey?: string;
};

// Traduce cada motivo de rechazo del dominio a un mensaje que la clienta
// puede entender -- nunca un código de error de Postgres ni un "Error 500"
// crudo. Los detalles técnicos van a los logs del servidor, no a la UI.
const MENSAJES_AMIGABLES: Record<string, string> = {
  servicio_no_encontrado: "El servicio seleccionado ya no está disponible.",
  especialista_no_encontrado: "Ese profesional ya no está disponible.",
  especialista_no_habilitado: "Este profesional ya no está disponible para este servicio.",
  fuera_de_horario: "Este horario ya no está disponible.",
  bloqueado: "Este horario ya no está disponible.",
  ocupado: "Este horario acaba de ser reservado. Por favor selecciona otro.",
  error: "Hubo un problema al reservar. Por favor intenta nuevamente.",
};

// Referencia corta y legible para la clienta -- nunca se expone el id
// numérico interno crudo (revelaría, entre otras cosas, cuántas citas
// existen en total en toda la plataforma).
function codigoConfirmacion(citaId: number): string {
  return `R-${citaId.toString(36).toUpperCase()}`;
}

// Crea la reserva. El frontend NUNCA manda duración, fin, ni precio -- el
// backend los determina completos a partir de servicioId (ver
// reservarCitaPorServicio, lib/disponibilidad-servicio.ts). Protegido contra
// doble ejecución (doble clic, retry de red) por idempotencyKey -- ver
// lib/idempotencia-reserva.ts. La carrera real entre dos clientas distintas
// para el mismo horario la sigue resolviendo el constraint EXCLUDE de
// Postgres, no esta función.
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (tenantInvalido(tenant)) return Response.json({ error: "Enlace inválido" }, { status: 404 });

  const supabase = supabaseAdmin();
  const plan = await planDelTenant(supabase, tenant);
  if (plan.id === "sin_plan") {
    return Response.json({ error: "Este negocio no tiene reservas disponibles en este momento" }, { status: 403 });
  }

  let body: BodyReserva;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  const servicioId = body.servicioId?.trim();
  const especialistaId = Number(body.especialistaId);
  const fecha = body.fecha?.trim();
  const hora = body.hora?.trim();
  const nombreCliente = body.nombreCliente?.trim();
  const telefonoCliente = body.telefonoCliente?.trim();
  const correoCliente = body.correoCliente?.trim() || undefined;
  const idempotencyKey = body.idempotencyKey?.trim();

  if (!servicioId || !Number.isInteger(especialistaId) || !fecha || !hora || !nombreCliente || !telefonoCliente) {
    return Response.json({ error: "Faltan datos obligatorios" }, { status: 400 });
  }
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return Response.json({ error: "Falta identificador de solicitud" }, { status: 400 });
  }

  const inicio = new Date(`${fecha}T${hora}:00-05:00`);
  if (Number.isNaN(inicio.getTime())) {
    return Response.json({ error: "Fecha u hora inválida" }, { status: 400 });
  }

  const huella = huellaSolicitud([tenant, servicioId, especialistaId, inicio.toISOString(), telefonoCliente, nombreCliente]);

  const idempotente = await ejecutarConIdempotencia(supabase, {
    idTenant: tenant,
    idempotencyKey,
    huella,
    // Fase 8A.11 (autorizado) — el mensaje de WhatsApp va DENTRO de este
    // mismo callback, después de que la cita quedó creada exitosamente --
    // igual que la lección ya aplicada con confirmarCita+notificar (Fase
    // 4): así, si esta misma solicitud se reintenta con la MISMA
    // idempotencyKey, ejecutarConIdempotencia devuelve el resultado
    // cacheado sin volver a llamar `operacion`, y el mensaje nunca se
    // reenvía. No se creó ninguna columna/estado nuevo para esto -- la
    // idempotencia real ya la da dulabs_idempotencia_reservas.
    operacion: async () => {
      const resultado = await reservarCitaPorServicio(supabase, {
        idTenant: tenant,
        especialistaId,
        servicioId,
        telefonoCliente,
        nombreCliente,
        correoCliente,
        inicio,
        origen: "manual",
      });
      if (resultado.ok) {
        await enviarConfirmacionReservaWhatsApp(supabase, tenant, telefonoCliente, {
          servicio: resultado.servicio.nombre,
          profesional: resultado.especialista.nombre,
          inicioISO: resultado.cita.inicio,
        });
      }
      return resultado;
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
      console.error("[reservar-portal] error al crear cita:", resultado.detalle, { tenant, servicioId, especialistaId });
    }
    return Response.json({ error: MENSAJES_AMIGABLES[resultado.motivo] ?? MENSAJES_AMIGABLES.error }, { status: 409 });
  }

  return Response.json({
    success: true,
    codigo: codigoConfirmacion(resultado.cita.id),
    servicio: resultado.servicio.nombre,
    profesional: resultado.especialista.nombre,
    inicio: resultado.cita.inicio,
    fin: resultado.cita.fin,
    duracionMin: resultado.servicio.duracionMin,
  });
}
