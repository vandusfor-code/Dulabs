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
  // Si esta especialidad bloquea horario (una persona, un turno, como
  // pestañas) o es el catálogo general donde varias citas a la misma hora
  // son normales (varias personas atendiendo en paralelo).
  bloquea_horario: boolean;
  // Catálogo de respaldo: cuando un servicio pedido no calza con ninguna
  // especialidad específica de este negocio, cae aquí.
  es_general: boolean;
};

export type CitaEspecialista = {
  id: number;
  especialista_id: number;
  telefono_cliente: string | null;
  nombre_cliente: string;
  servicio: string;
  inicio: string;
  fin: string;
  estado: "pendiente" | "confirmada" | "rechazada" | "cancelada" | "propuesta";
  motivo_rechazo: string | null;
  origen: string;
};

const COLUMNAS_ESPECIALISTA =
  "id, id_tenant, phone_number_id, nombre, numero_whatsapp, servicio, duracion_min, token, activo, bloquea_horario, es_general";
const COLUMNAS_CITA = "id, especialista_id, telefono_cliente, nombre_cliente, servicio, inicio, fin, estado, motivo_rechazo, origen";

// Código de error de Postgres para una violación de constraint EXCLUDE
// (choque de rango de tiempo) -- distinto del 23505 de un UNIQUE normal.
const CODIGO_SOLAPE = "23P01";

export async function especialistaPorToken(supabase: SupabaseClient, token: string): Promise<Especialista | null> {
  const { data } = await supabase.from("dulabs_especialistas").select(COLUMNAS_ESPECIALISTA).eq("token", token).eq("activo", true).maybeSingle();
  return (data as Especialista) ?? null;
}

// El link real es "nombre-del-spa-{token}": el nombre es puramente
// cosmético (para que el link se vea bien), lo único que de verdad protege
// el acceso es el token corto al final. Se busca por el ÚLTIMO segmento
// después del guion -- así un link sin nombre (solo el token pelado)
// también sigue funcionando, por compatibilidad.
function normalizarSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // quita tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function construirRutaAgenda(nombreNegocio: string, token: string): string {
  const slug = normalizarSlug(nombreNegocio);
  return slug ? `${slug}-${token}` : token;
}

export async function especialistaPorRuta(supabase: SupabaseClient, ruta: string): Promise<Especialista | null> {
  const token = ruta.split("-").pop() ?? ruta;
  return especialistaPorToken(supabase, token);
}

export async function especialistaPorId(supabase: SupabaseClient, id: number): Promise<Especialista | null> {
  const { data } = await supabase.from("dulabs_especialistas").select(COLUMNAS_ESPECIALISTA).eq("id", id).maybeSingle();
  return (data as Especialista) ?? null;
}

// Si quien escribe es una de las especialistas del negocio (por su número de
// WhatsApp), para tratarla como administradora y no como clienta. Una misma
// persona puede tener más de una fila (ej. Daniela: "pestañas" + "general"),
// así que toma la primera -- solo importa que exista alguna, cualquiera de
// sus filas comparte nombre/id_tenant/phone_number_id.
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
    .limit(1);
  return (data?.[0] as Especialista) ?? null;
}

// True si el número tiene al menos una especialista activa configurada.
// El webhook lo usa para decidir si un número entra por el camino con
// herramienta real de agenda o sigue por el camino de siempre (texto libre)
// -- así ningún tenant sin especialistas ve cambiar su comportamiento.
export async function tieneEspecialistasActivas(supabase: SupabaseClient, phoneNumberId: string): Promise<boolean> {
  const { count } = await supabase
    .from("dulabs_especialistas")
    .select("id", { count: "exact", head: true })
    .eq("phone_number_id", phoneNumberId)
    .eq("activo", true);
  return (count ?? 0) > 0;
}

// Busca primero una especialidad específica (ej. "pestañas" -> Nicol). Si no
// hay ninguna que calce, cae al catálogo general del negocio (si tiene uno
// configurado) -- así el resto de servicios también quedan con agenda real,
// sin que cada uno necesite su propia fila.
export async function especialistaPorServicio(
  supabase: SupabaseClient,
  phoneNumberId: string,
  servicio: string
): Promise<Especialista | null> {
  const { data } = await supabase
    .from("dulabs_especialistas")
    .select(COLUMNAS_ESPECIALISTA)
    .eq("phone_number_id", phoneNumberId)
    .eq("es_general", false)
    .ilike("servicio", servicio)
    .eq("activo", true)
    .maybeSingle();
  if (data) return data as Especialista;

  const { data: general } = await supabase
    .from("dulabs_especialistas")
    .select(COLUMNAS_ESPECIALISTA)
    .eq("phone_number_id", phoneNumberId)
    .eq("es_general", true)
    .eq("activo", true)
    .maybeSingle();
  return (general as Especialista) ?? null;
}

// Todas las especialidades activas que pertenecen a la MISMA persona (mismo
// número de WhatsApp) -- ej. Daniela puede tener "pestañas" y "general" a la
// vez. Sirve para que un solo link de agenda muestre y gestione TODAS sus
// citas, sin que tenga que abrir un link distinto por cada especialidad.
export async function especialistasDelMismaPersona(
  supabase: SupabaseClient,
  phoneNumberId: string,
  numeroWhatsapp: string
): Promise<Especialista[]> {
  const { data } = await supabase
    .from("dulabs_especialistas")
    .select(COLUMNAS_ESPECIALISTA)
    .eq("phone_number_id", phoneNumberId)
    .eq("numero_whatsapp", numeroWhatsapp)
    .eq("activo", true);
  return (data as Especialista[]) ?? [];
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
    // Si esta cita en particular participa en el candado de choque de
    // horario -- normalmente se copia directo de especialista.bloquea_horario
    // (ver lib/especialistas.ts Especialista.bloquea_horario).
    bloqueaHorario: boolean;
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
      bloquea_horario: params.bloqueaHorario,
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

// La especialista propone un horario distinto al pedido. Actualiza la MISMA
// fila (no crea una nueva) para que el constraint EXCLUDE retenga el nuevo
// horario mientras la clienta decide -- otra persona no puede tomarlo
// mientras tanto. Si el horario propuesto choca con otra cita, Postgres lo
// rechaza igual que en crearCitaEspecialista.
export async function proponerReagendamiento(
  supabase: SupabaseClient,
  citaId: number,
  nuevoInicio: Date,
  duracionMin: number
): Promise<{ ok: true; cita: CitaEspecialista } | { ok: false; motivo: "ocupado" | "no_encontrada" | "error"; detalle?: string }> {
  const nuevoFin = new Date(nuevoInicio.getTime() + duracionMin * 60_000);
  const { data, error } = await supabase
    .from("dulabs_citas_especialista")
    .update({ inicio: nuevoInicio.toISOString(), fin: nuevoFin.toISOString(), estado: "propuesta", updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .eq("estado", "pendiente") // solo se propone sobre una solicitud aún sin resolver
    .select(COLUMNAS_CITA)
    .maybeSingle();

  if (error) {
    if (error.code === CODIGO_SOLAPE) return { ok: false, motivo: "ocupado" };
    return { ok: false, motivo: "error", detalle: error.message };
  }
  if (!data) return { ok: false, motivo: "no_encontrada" };
  return { ok: true, cita: data as CitaEspecialista };
}

// La clienta acepta el horario propuesto -- ya estaba retenido, solo se
// confirma. No hace falta re-chequear disponibilidad: nadie más pudo
// haberlo tomado mientras estaba en 'propuesta'.
export async function aceptarPropuesta(supabase: SupabaseClient, citaId: number): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .update({ estado: "confirmada", updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .eq("estado", "propuesta")
    .select(COLUMNAS_CITA)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

// La clienta no acepta el horario propuesto: se libera de inmediato (deja de
// bloquear el constraint) para que alguien más pueda tomarlo.
export async function rechazarPropuesta(supabase: SupabaseClient, citaId: number): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .update({ estado: "rechazada", motivo_rechazo: "La clienta no aceptó el horario propuesto", updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .eq("estado", "propuesta")
    .select(COLUMNAS_CITA)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

// Edita una cita que YA está confirmada (cambio de horario, duración o
// servicio decidido por la especialista, no una propuesta que la clienta
// deba aceptar). Sigue el mismo camino atómico: el constraint EXCLUDE
// decide si el nuevo horario choca con otra cita.
export async function editarCitaConfirmada(
  supabase: SupabaseClient,
  citaId: number,
  cambios: { nuevoInicio?: Date; duracionMin?: number; servicio?: string }
): Promise<{ ok: true; cita: CitaEspecialista } | { ok: false; motivo: "ocupado" | "no_encontrada" | "error"; detalle?: string }> {
  const { data: actual } = await supabase
    .from("dulabs_citas_especialista")
    .select(COLUMNAS_CITA)
    .eq("id", citaId)
    .eq("estado", "confirmada")
    .maybeSingle();
  if (!actual) return { ok: false, motivo: "no_encontrada" };
  const cita = actual as CitaEspecialista;

  const inicio = cambios.nuevoInicio ?? new Date(cita.inicio);
  const duracionMin = cambios.duracionMin ?? (new Date(cita.fin).getTime() - new Date(cita.inicio).getTime()) / 60_000;
  const fin = new Date(inicio.getTime() + duracionMin * 60_000);

  const { data, error } = await supabase
    .from("dulabs_citas_especialista")
    .update({
      inicio: inicio.toISOString(),
      fin: fin.toISOString(),
      servicio: cambios.servicio?.trim() || cita.servicio,
      updated_at: new Date().toISOString(),
    })
    .eq("id", citaId)
    .eq("estado", "confirmada")
    .select(COLUMNAS_CITA)
    .maybeSingle();

  if (error) {
    if (error.code === CODIGO_SOLAPE) return { ok: false, motivo: "ocupado" };
    return { ok: false, motivo: "error", detalle: error.message };
  }
  if (!data) return { ok: false, motivo: "no_encontrada" };
  return { ok: true, cita: data as CitaEspecialista };
}

// Cancela una cita, sea que aún esté pendiente de confirmación o ya
// confirmada. 'cancelada' no está en el WHERE del constraint EXCLUDE, así
// que el horario queda libre de inmediato para que alguien más lo tome.
export async function cancelarCita(supabase: SupabaseClient, citaId: number, motivo?: string): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .update({ estado: "cancelada", motivo_rechazo: motivo ?? null, updated_at: new Date().toISOString() })
    .eq("id", citaId)
    .in("estado", ["pendiente", "confirmada"])
    .select(COLUMNAS_CITA)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

// Busca la cita activa (pendiente o confirmada) más próxima de esta clienta
// con esta especialidad/negocio, para que el bot sepa a cuál se refiere
// cuando pide cambiar la hora o cancelar, sin que ella tenga que repetir
// fecha y servicio.
export async function citaActivaPara(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string
): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .select(COLUMNAS_CITA)
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .in("estado", ["pendiente", "confirmada"])
    .gte("inicio", new Date().toISOString())
    .order("inicio", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

// Busca si esta clienta tiene una propuesta de horario esperando respuesta,
// para que el bot sepa que su próximo mensaje probablemente es un sí/no a
// eso, y no una solicitud nueva.
export async function propuestaPendientePara(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string
): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .select(COLUMNAS_CITA)
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .eq("estado", "propuesta")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}
