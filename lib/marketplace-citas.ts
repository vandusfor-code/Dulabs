import type { SupabaseClient } from "@supabase/supabase-js";

// Motor de agenda real para los agentes del Marketplace con caso de uso de
// reservas (ver lib/marketplace.ts, `usaAgenda`). Antes de este módulo NO
// existía ningún sistema de citas en el código — el backend (llamado desde
// las herramientas de lib/marketplace-agenda-ia.ts), nunca la IA por sí sola
// en texto libre, decide y persiste cada cambio de estado.

export type EstadoCita = "agendada" | "cancelada" | "reagendada" | "completada" | "no_asistio";

export interface Cita {
  id: number;
  activacion_id: number;
  phone_number_id: string;
  numero_cliente: string;
  nombre_cliente: string | null;
  fecha: string; // YYYY-MM-DD
  hora_inicio: string; // HH:MM:SS (Postgres `time`)
  duracion_min: number;
  servicio: string | null;
  estado: EstadoCita;
  created_at: string;
  updated_at: string;
}

export function horaCorta(hora: string): string {
  return hora.slice(0, 5);
}

function minutosDesdeMedianoche(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + (m || 0);
}

function seSuperponen(aInicio: number, aDuracion: number, bInicio: number, bDuracion: number): boolean {
  return aInicio < bInicio + bDuracion && bInicio < aInicio + aDuracion;
}

async function citasAgendadasDelDia(supabase: SupabaseClient, activacionId: number, fecha: string): Promise<Cita[]> {
  const { data } = await supabase
    .from("dulabs_marketplace_citas")
    .select("*")
    .eq("activacion_id", activacionId)
    .eq("fecha", fecha)
    .eq("estado", "agendada");
  return (data ?? []) as Cita[];
}

export async function verificarDisponibilidad(
  supabase: SupabaseClient,
  params: { activacionId: number; fecha: string; hora: string; duracionMin: number; recursosDisponibles: number; excluirCitaId?: number }
): Promise<boolean> {
  const citas = await citasAgendadasDelDia(supabase, params.activacionId, params.fecha);
  const inicio = minutosDesdeMedianoche(params.hora);
  const ocupados = citas.filter(
    (c) =>
      c.id !== params.excluirCitaId &&
      seSuperponen(inicio, params.duracionMin, minutosDesdeMedianoche(c.hora_inicio), c.duracion_min)
  ).length;
  return ocupados < params.recursosDisponibles;
}

// Escanea en incrementos de `duracionMin`, desde la hora deseada, dentro de
// una ventana acotada del mismo día (por defecto 3h) — no conoce el horario
// real de atención del negocio (vive en texto libre, no estructurado), así
// que solo evita choques de recursos; el agente decide con su propio criterio
// (system prompt) si la hora sugerida cae dentro del horario del negocio.
export async function sugerirHorariosLibres(
  supabase: SupabaseClient,
  params: {
    activacionId: number;
    fecha: string;
    horaDeseada: string;
    duracionMin: number;
    recursosDisponibles: number;
    ventanaMin?: number;
    maxOpciones?: number;
  }
): Promise<string[]> {
  const ventana = params.ventanaMin ?? 180;
  const maxOpciones = params.maxOpciones ?? 3;
  const citas = await citasAgendadasDelDia(supabase, params.activacionId, params.fecha);
  const inicioDeseado = minutosDesdeMedianoche(params.horaDeseada);
  const libres: string[] = [];
  for (let offset = params.duracionMin; offset <= ventana; offset += params.duracionMin) {
    const inicio = inicioDeseado + offset;
    if (inicio >= 24 * 60) break;
    const ocupados = citas.filter((c) =>
      seSuperponen(inicio, params.duracionMin, minutosDesdeMedianoche(c.hora_inicio), c.duracion_min)
    ).length;
    if (ocupados < params.recursosDisponibles) {
      const h = Math.floor(inicio / 60);
      const m = inicio % 60;
      libres.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      if (libres.length >= maxOpciones) break;
    }
  }
  return libres;
}

export async function crearCita(
  supabase: SupabaseClient,
  params: {
    activacionId: number;
    phoneNumberId: string;
    numeroCliente: string;
    nombreCliente: string | null;
    fecha: string;
    hora: string;
    duracionMin: number;
    servicio: string | null;
  }
): Promise<Cita> {
  const { data, error } = await supabase
    .from("dulabs_marketplace_citas")
    .insert({
      activacion_id: params.activacionId,
      phone_number_id: params.phoneNumberId,
      numero_cliente: params.numeroCliente,
      nombre_cliente: params.nombreCliente,
      fecha: params.fecha,
      hora_inicio: params.hora,
      duracion_min: params.duracionMin,
      servicio: params.servicio,
      estado: "agendada",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Cita;
}

/** Próximas citas (hoy en adelante) de un cliente en un negocio, para que no tenga que dar un ID. */
export async function citasProximasDelCliente(
  supabase: SupabaseClient,
  activacionId: number,
  numeroCliente: string
): Promise<Cita[]> {
  const hoy = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("dulabs_marketplace_citas")
    .select("*")
    .eq("activacion_id", activacionId)
    .eq("numero_cliente", numeroCliente)
    .eq("estado", "agendada")
    .gte("fecha", hoy)
    .order("fecha", { ascending: true })
    .order("hora_inicio", { ascending: true });
  return (data ?? []) as Cita[];
}

/** Todas las citas agendadas de una fecha — para la consulta del administrador. */
export async function citasDeFecha(supabase: SupabaseClient, activacionId: number, fecha: string): Promise<Cita[]> {
  const { data } = await supabase
    .from("dulabs_marketplace_citas")
    .select("*")
    .eq("activacion_id", activacionId)
    .eq("fecha", fecha)
    .eq("estado", "agendada")
    .order("hora_inicio", { ascending: true });
  return (data ?? []) as Cita[];
}

export async function obtenerCitaPorId(supabase: SupabaseClient, id: number, activacionId: number): Promise<Cita | null> {
  const { data } = await supabase
    .from("dulabs_marketplace_citas")
    .select("*")
    .eq("id", id)
    .eq("activacion_id", activacionId)
    .maybeSingle();
  return (data as Cita | null) ?? null;
}

export async function cancelarCita(supabase: SupabaseClient, id: number, activacionId: number): Promise<void> {
  const { error } = await supabase
    .from("dulabs_marketplace_citas")
    .update({ estado: "cancelada", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("activacion_id", activacionId);
  if (error) throw new Error(error.message);
}

// Reagenda EN LA MISMA fila (no crea una cita nueva) — su estado sigue
// 'agendada', solo cambian fecha/hora. 'reagendada' queda en el check
// constraint para uso futuro (ej. un historial de auditoría), no se asigna
// en este flujo.
export async function reagendarCita(
  supabase: SupabaseClient,
  id: number,
  activacionId: number,
  fecha: string,
  hora: string
): Promise<Cita> {
  const { data, error } = await supabase
    .from("dulabs_marketplace_citas")
    .update({ fecha, hora_inicio: hora, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("activacion_id", activacionId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Cita;
}
