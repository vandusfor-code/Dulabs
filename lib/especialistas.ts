import type { SupabaseClient } from "@supabase/supabase-js";

export type Especialista = {
  id: number;
  id_tenant: string;
  phone_number_id: string;
  nombre: string;
  numero_whatsapp: string;
  servicio: string;
  duracion_min: number;
  token: string;
  activo: boolean;
};

export type CitaEspecialista = {
  id: number;
  especialista_id: number;
  telefono_cliente: string | null;
  nombre_cliente: string;
  servicio: string;
  inicio: string;
  fin: string;
  estado: "pendiente" | "confirmada" | "rechazada" | "cancelada";
  motivo_rechazo: string | null;
  origen: string;
};

const COLUMNAS_ESPECIALISTA = "id, id_tenant, phone_number_id, nombre, numero_whatsapp, servicio, duracion_min, token, activo";
const COLUMNAS_CITA = "id, especialista_id, telefono_cliente, nombre_cliente, servicio, inicio, fin, estado, motivo_rechazo, origen";

// Código de error de Postgres para una violación de constraint EXCLUDE
// (choque de rango de tiempo) -- distinto del 23505 de un UNIQUE normal.
const CODIGO_SOLAPE = "23P01";

export async function especialistaPorToken(supabase: SupabaseClient, token: string): Promise<Especialista | null> {
  const { data } = await supabase.from("dulabs_especialistas").select(COLUMNAS_ESPECIALISTA).eq("token", token).eq("activo", true).maybeSingle();
  return (data as Especialista) ?? null;
}

export async function especialistaPorNumero(
  supabase: SupabaseClient,
  phoneNumberId: string,
  numeroRemitente: string
): Promise<Especialista | null> {
  const { data } = await supabase
    .from("dulabs_especialistas")
    .select(COLUMNAS_ESPECIALISTA)
    .eq("phone_number_id", phoneNumberId)
    .eq("numero_whatsapp", numeroRemitente)
    .eq("activo", true)
    .maybeSingle();
  return (data as Especialista) ?? null;
}

export async function especialistaPorServicio(
  supabase: SupabaseClient,
  phoneNumberId: string,
  servicio: string
): Promise<Especialista | null> {
  const { data } = await supabase
    .from("dulabs_especialistas")
    .select(COLUMNAS_ESPECIALISTA)
    .eq("phone_number_id", phoneNumberId)
    .ilike("servicio", servicio)
    .eq("activo", true)
    .maybeSingle();
  return (data as Especialista) ?? null;
}

export async function citasDeEspecialista(
  supabase: SupabaseClient,
  especialistaId: number,
  opts?: { desde?: string; estados?: string[] }
): Promise<CitaEspecialista[]> {
  let query = supabase
    .from("dulabs_citas_especialista")
    .select(COLUMNAS_CITA)
    .eq("especialista_id", especialistaId)
    .order("inicio", { ascending: true });
  if (opts?.desde) query = query.gte("inicio", opts.desde);
  if (opts?.estados) query = query.in("estado", opts.estados);
  const { data } = await query;
  return (data as CitaEspecialista[]) ?? [];
}

// Crea una solicitud de cita. Nunca hace un "check antes, insert después":
// intenta insertar directo y deja que el constraint EXCLUDE de Postgres sea
// el único árbitro real de si hay choque -- así es imposible que dos
// solicitudes casi simultáneas para el mismo horario pasen ambas.
export async function crearCitaEspecialista(
  supabase: SupabaseClient,
  params: {
    especialistaId: number;
    idTenant: string;
    phoneNumberId: string;
    telefonoCliente: string | null;
    nombreCliente: string;
    servicio: string;
    inicio: Date;
    duracionMin: number;
    origen?: "manual" | "whatsapp_ia";
  }
): Promise<{ ok: true; cita: CitaEspecialista } | { ok: false; motivo: "ocupado" | "error"; detalle?: string }> {
  const fin = new Date(params.inicio.getTime() + params.duracionMin * 60_000);
  const { data, error } = await supabase
    .from("dulabs_citas_especialista")
    .insert({
      especialista_id: params.especialistaId,
      id_tenant: params.idTenant,
      phone_number_id: params.phoneNumberId,
      telefono_cliente: params.telefonoCliente,
      nombre_cliente: params.nombreCliente,
      servicio: params.servicio,
      inicio: params.inicio.toISOString(),
      fin: fin.toISOString(),
      origen: params.origen ?? "manual",
    })
    .select(COLUMNAS_CITA)
    .single();

  if (error) {
    if (error.code === CODIGO_SOLAPE) return { ok: false, motivo: "ocupado" };
    return { ok: false, motivo: "error", detalle: error.message };
  }
  return { ok: true, cita: data as CitaEspecialista };
}

export async function confirmarCita(supabase: SupabaseClient, citaId: number): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .update({ estado: "confirmada", updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .eq("estado", "pendiente") // solo desde pendiente -- evita reprocesar una ya resuelta
    .select(COLUMNAS_CITA)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

export async function rechazarCita(supabase: SupabaseClient, citaId: number, motivo?: string): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .update({ estado: "rechazada", motivo_rechazo: motivo ?? null, updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .eq("estado", "pendiente")
    .select(COLUMNAS_CITA)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}
