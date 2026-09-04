import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ventanasLaboralesEspecialista,
  bloqueosDelDia,
  restarBloqueos,
  generarHorariosLibres,
  crearCitaEspecialista,
  editarCitaConfirmada,
  cancelarCita,
  type VentanaHoraria,
  type CitaEspecialista,
} from "@/lib/especialistas";
import { recordarNombreCliente } from "@/lib/clientes-conocidos";
import { horaColombiaDesdeIso, fechaColombiaDesdeIso } from "@/lib/timezone-colombia";
import { resolverEspecialistasElegiblesParaServicio } from "@/lib/asignacion-categoria";

/**
 * Fase 2 (sistema de reservas de Daniela) — motor de disponibilidad orientado
 * a SERVICIO, sobre el modelo de datos nuevo de la Fase 1
 * (dulabs_servicios / dulabs_servicio_especialista / dulabs_horario_especialista
 * / dulabs_bloqueos). Es una entrada NUEVA, no una V2 de nada existente: hoy
 * no existe ningún camino que resuelva especialistas elegibles a partir de
 * dulabs_servicio_especialista (LEGACY y el Flow no activado resuelven por
 * texto libre de servicio, ver especialistaPorServicio/categoriaDeServicio en
 * lib/especialistas.ts -- eso NO se toca en esta fase).
 *
 * Reutiliza el MISMO cálculo de ventanas/bloqueos/huecos que ya usa
 * hayHuecoLibreEseDia y listarHorariosDisponiblesEspecialista (ver
 * lib/especialistas.ts) -- no hay un segundo motor de disponibilidad, solo
 * una segunda forma de RESOLVER qué especialistas son candidatos (por
 * relación explícita en dulabs_servicio_especialista, en vez de texto libre).
 *
 * Todavía no tiene ningún llamador: ni el portal público (Fase 4), ni el
 * WhatsApp de Daniela (Fase 6), ni los flows deterministas
 * (daniela-agendar-cita.flow.ts y hermanos, que siguen sin activarse) usan
 * esto todavía. Existe para que esas fases futuras tengan un motor real
 * sobre el que construir, sin haber tocado nada de lo que hoy sirve tráfico.
 */

export type EspecialistaConHorarios = {
  especialistaId: number;
  nombre: string;
  horarios: string[]; // "HH:MM", hora Colombia -- mismo formato que listarHorariosDisponiblesEspecialista
};

export type ResultadoHorariosPorServicio =
  | {
      ok: true;
      servicio: { id: string; nombre: string; duracionMin: number };
      especialistas: EspecialistaConHorarios[];
    }
  | { ok: false; motivo: "servicio_no_encontrado" | "sin_especialistas_habilitados"; detalle: string };

// Mismos 3 estados que bloquean horario en todo el sistema (ver constraint
// dulabs_citas_especialista_sin_solape) -- cancelada/rechazada/completada/no_show
// nunca ocupan disponibilidad. A diferencia de hayHuecoLibreEseDia/
// listarHorariosDisponiblesEspecialista (que no filtran por bloquea_horario,
// comportamiento LEGACY heredado que no se toca), este motor nuevo sí exige
// bloquea_horario=true -- la regla exacta que ya usa el EXCLUDE, no una regla
// distinta inventada para esta fase.
const ESTADOS_BLOQUEANTES = ["pendiente", "confirmada", "propuesta"] as const;

async function citasOcupadasDelDia(
  supabase: SupabaseClient,
  especialistaId: number,
  desdeISO: string,
  hastaISO: string
): Promise<VentanaHoraria[]> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .select("inicio, fin")
    .eq("especialista_id", especialistaId)
    .eq("bloquea_horario", true)
    .in("estado", ESTADOS_BLOQUEANTES)
    .gte("inicio", desdeISO)
    .lt("inicio", hastaISO)
    .order("inicio", { ascending: true });
  return ((data ?? []) as { inicio: string; fin: string }[]).map((c) => ({
    apertura: new Date(c.inicio),
    cierre: new Date(c.fin),
  }));
}

/**
 * Horarios reales disponibles para un SERVICIO puntual en una fecha.
 * Resuelve especialistas elegibles en dos pasos, en este orden:
 *
 * 1. Asociación EXPLÍCITA en dulabs_servicio_especialista -- sigue siendo
 *    la fuente de verdad principal, sin ningún cambio: si existe, se usa
 *    tal cual (modo "todos", cada especialista con su disponibilidad real
 *    e independiente, como siempre).
 * 2. Si NO hay ninguna asociación explícita (Fase 8A.5, autorizado): se
 *    intenta resolver por CATEGORÍA del servicio (servicio.categoria) según
 *    las reglas operativas reales que Daniela confirmó en
 *    dulabs_config_bot (ver lib/asignacion-categoria.ts) -- nunca una
 *    asociación inventada. En modo "prioridad" (ej. Manos: Carla primero,
 *    Daniela solo si Carla no tiene NINGÚN cupo ese día) se prueban los
 *    candidatos EN ORDEN y se corta en el primero con horarios reales ese
 *    día; en modo "todos" se muestran todos con su disponibilidad real.
 *
 * Si ninguno de los dos pasos resuelve a nadie, sigue siendo
 * "sin_especialistas_habilitados" -- comportamiento sin cambio para
 * cualquier tenant sin config-bot o sin regla para esa categoría.
 *
 * La duración SIEMPRE viene de dulabs_servicios.duracion_min -- nunca de
 * dulabs_especialistas.duracion_min (esa columna se conserva intacta para
 * LEGACY, ver lib/especialistas.ts, pero este motor nuevo no la usa).
 *
 * `especialistaId` es opcional -- si la clienta ya eligió un profesional
 * puntual (portal, Fase 4), restringe el cálculo a ese único especialista en
 * vez de a todos los habilitados para el servicio.
 */
export async function listarHorariosDisponiblesPorServicio(
  supabase: SupabaseClient,
  params: { idTenant: string; servicioId: string; fecha: string; especialistaId?: number }
): Promise<ResultadoHorariosPorServicio> {
  const { data: servicio } = await supabase
    .from("dulabs_servicios")
    .select("id, nombre, duracion_min, categoria")
    .eq("id_tenant", params.idTenant)
    .eq("id", params.servicioId)
    .eq("activo", true)
    .maybeSingle();
  if (!servicio) {
    return { ok: false, motivo: "servicio_no_encontrado", detalle: "Ese servicio no existe o no está activo." };
  }

  // Fase 8A.8.1 (autorizado) — ÚNICO resolver compartido con el endpoint de
  // listado (app/api/reservar/[tenant]/especialistas/route.ts) y con
  // reservarCitaPorServicio, más abajo -- ver lib/asignacion-categoria.ts.
  const resolucion = await resolverEspecialistasElegiblesParaServicio(supabase, params.idTenant, servicio.id as string);
  let especialistasActivos: { id: number; nombre: string }[] = resolucion.especialistas.map((e) => ({ id: e.especialistaId, nombre: e.nombre }));
  let modoAsignacion: "todos" | "prioridad" = resolucion.modo === "prioridad" ? "prioridad" : "todos";

  if (params.especialistaId !== undefined) {
    especialistasActivos = especialistasActivos.filter((e) => e.id === params.especialistaId);
    modoAsignacion = "todos"; // un solo id explícito -- el orden de prioridad ya no aplica
  }
  if (especialistasActivos.length === 0) {
    return {
      ok: false,
      motivo: "sin_especialistas_habilitados",
      detalle: "Ningún especialista está habilitado para este servicio todavía.",
    };
  }

  const duracionMin = servicio.duracion_min as number;

  async function horariosDe(especialista: { id: number; nombre: string }): Promise<EspecialistaConHorarios> {
    const [ventanasBase, bloqueos] = await Promise.all([
      ventanasLaboralesEspecialista(supabase, especialista.id, params.idTenant, params.fecha),
      bloqueosDelDia(supabase, especialista.id, params.idTenant, params.fecha),
    ]);
    const ventanas = restarBloqueos(ventanasBase, bloqueos);
    let horarios: string[] = [];
    if (ventanas.length > 0) {
      const desde = ventanas[0]!.apertura.toISOString();
      const hasta = ventanas[ventanas.length - 1]!.cierre.toISOString();
      const ocupadas = await citasOcupadasDelDia(supabase, especialista.id, desde, hasta);
      horarios = generarHorariosLibres(ventanas, ocupadas, duracionMin).map((d) => horaColombiaDesdeIso(d.toISOString()));
    }
    return { especialistaId: especialista.id, nombre: especialista.nombre, horarios };
  }

  let especialistas: EspecialistaConHorarios[];
  if (modoAsignacion === "prioridad") {
    // Se prueba en orden y se corta en el primero con al menos un horario
    // real ese día -- ej. Manos: Carla primero; Daniela SOLO si Carla no
    // tiene NINGÚN cupo ese día. Si nadie de la lista tiene cupo, se
    // devuelve igual el último probado (con horarios: []) -- "sin cupo hoy"
    // es un resultado válido, no el mismo error que "nadie habilitado".
    especialistas = [];
    for (const especialista of especialistasActivos) {
      const resultado = await horariosDe(especialista);
      especialistas = [resultado];
      if (resultado.horarios.length > 0) break;
    }
  } else {
    especialistas = await Promise.all(especialistasActivos.map(horariosDe));
  }

  return {
    ok: true,
    servicio: { id: servicio.id as string, nombre: servicio.nombre as string, duracionMin },
    especialistas,
  };
}

// ---------------------------------------------------------------------------
// Fase 3 (sistema de reservas de Daniela) — núcleo transaccional: crear,
// reagendar y cancelar reservas sobre el modelo nuevo. Esta es la ÚNICA
// lógica de negocio de escritura que debe usar cualquier consumidor futuro
// (portal Fase 4, WhatsApp nuevo Fase 6, panel Fase 5) -- ninguno debe
// reimplementar su propia versión de "crear/mover/cancelar cita". Todas
// reutilizan las funciones atómicas YA existentes en lib/especialistas.ts
// (crearCitaEspecialista, editarCitaConfirmada, cancelarCita) -- la
// autoridad final de disponibilidad sigue siendo el constraint EXCLUDE de
// Postgres (dulabs_citas_especialista_sin_solape), nunca un lock aplicativo
// nuevo.
// ---------------------------------------------------------------------------

export type ResultadoReservarPorServicio =
  | {
      ok: true;
      cita: CitaEspecialista;
      especialista: { id: number; nombre: string };
      servicio: { id: string; nombre: string; duracionMin: number };
    }
  | {
      ok: false;
      motivo:
        | "servicio_no_encontrado"
        | "especialista_no_encontrado"
        | "especialista_no_habilitado"
        | "fuera_de_horario"
        | "bloqueado"
        | "ocupado"
        | "error";
      detalle: string;
    };

/**
 * Crea una reserva sobre el modelo nuevo (servicio_id + especialista_id).
 * La duración SIEMPRE se deriva de dulabs_servicios.duracion_min -- a
 * propósito no existe ningún parámetro para que el caller pase una duración
 * distinta.
 *
 * Valida en orden: servicio existe/activo/del tenant -> especialista
 * existe/activo/del tenant -> relación real en dulabs_servicio_especialista
 * -> el horario cae dentro de la jornada laboral -> no cae dentro de un
 * bloqueo -> no se solapa con una cita ya ocupante. Esta validación previa
 * es solo para dar un mensaje de error preciso en el caso normal -- NO
 * reemplaza al INSERT atómico de crearCitaEspecialista: si dos solicitudes
 * simultáneas pasan ambas esta validación para el mismo slot (condición de
 * carrera real), solo una gana el INSERT; la otra recibe "ocupado" porque
 * Postgres rechaza el choque con 23P01 (ver CODIGO_SOLAPE en
 * lib/especialistas.ts) -- el mismo mecanismo que ya usa todo el sistema,
 * no uno nuevo.
 */
export async function reservarCitaPorServicio(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    especialistaId: number;
    servicioId: string;
    telefonoCliente: string | null;
    nombreCliente: string;
    correoCliente?: string | null;
    inicio: Date;
    origen?: "manual" | "whatsapp_ia";
  }
): Promise<ResultadoReservarPorServicio> {
  const { data: servicio } = await supabase
    .from("dulabs_servicios")
    .select("id, nombre, duracion_min, categoria")
    .eq("id_tenant", params.idTenant)
    .eq("id", params.servicioId)
    .eq("activo", true)
    .maybeSingle();
  if (!servicio) {
    return { ok: false, motivo: "servicio_no_encontrado", detalle: "Ese servicio no existe o no está activo." };
  }

  const { data: especialista } = await supabase
    .from("dulabs_especialistas")
    .select("id, phone_number_id, nombre, bloquea_horario")
    .eq("id_tenant", params.idTenant)
    .eq("id", params.especialistaId)
    .eq("activo", true)
    .maybeSingle();
  if (!especialista) {
    return { ok: false, motivo: "especialista_no_encontrado", detalle: "Ese especialista no existe o no está activo." };
  }

  // Fase 8A.8.1 (autorizado) — MISMO resolver único usado por
  // listarHorariosDisponiblesPorServicio y por el endpoint de listado
  // (asociación explícita si existe, si no fallback por categoría real de
  // Daniela) -- así el portal nunca muestra un horario que después falla al
  // reservar, y nunca hay tres criterios distintos de "quién puede".
  const resolucion = await resolverEspecialistasElegiblesParaServicio(supabase, params.idTenant, servicio.id as string);
  const habilitado = resolucion.especialistas.some((e) => e.especialistaId === especialista.id);
  if (!habilitado) {
    return {
      ok: false,
      motivo: "especialista_no_habilitado",
      detalle: "Ese especialista no está habilitado para este servicio.",
    };
  }

  const duracionMin = servicio.duracion_min as number;
  const fin = new Date(params.inicio.getTime() + duracionMin * 60_000);
  const fechaISO = fechaColombiaDesdeIso(params.inicio.toISOString());

  const ventanasBase = await ventanasLaboralesEspecialista(supabase, especialista.id, params.idTenant, fechaISO);
  const cabeEnJornada = ventanasBase.some((v) => params.inicio >= v.apertura && fin <= v.cierre);
  if (!cabeEnJornada) {
    return {
      ok: false,
      motivo: "fuera_de_horario",
      detalle: "Ese horario está fuera de la jornada laboral del especialista.",
    };
  }

  const bloqueos = await bloqueosDelDia(supabase, especialista.id, params.idTenant, fechaISO);
  const ventanasLibres = restarBloqueos(ventanasBase, bloqueos);
  const cabeSinBloqueo = ventanasLibres.some((v) => params.inicio >= v.apertura && fin <= v.cierre);
  if (!cabeSinBloqueo) {
    return { ok: false, motivo: "bloqueado", detalle: "Ese horario cae dentro de un bloqueo (almuerzo, vacaciones, etc.)." };
  }

  const ocupadas = await citasOcupadasDelDia(
    supabase,
    especialista.id,
    ventanasLibres[0]!.apertura.toISOString(),
    ventanasLibres[ventanasLibres.length - 1]!.cierre.toISOString()
  );
  const seSolapa = ocupadas.some((o) => params.inicio < o.cierre && fin > o.apertura);
  if (seSolapa) {
    return { ok: false, motivo: "ocupado", detalle: "Ese horario ya fue tomado por otra cita." };
  }

  const resultado = await crearCitaEspecialista(supabase, {
    especialistaId: especialista.id,
    idTenant: params.idTenant,
    phoneNumberId: especialista.phone_number_id,
    telefonoCliente: params.telefonoCliente,
    nombreCliente: params.nombreCliente,
    servicio: servicio.nombre as string,
    servicioId: servicio.id as string,
    inicio: params.inicio,
    duracionMin,
    bloqueaHorario: especialista.bloquea_horario,
    origen: params.origen ?? "manual",
  });

  if (!resultado.ok) {
    if (resultado.motivo === "ocupado") {
      // Carrera real: pasó la validación previa pero perdió el INSERT
      // atómico -- Postgres decide de verdad acá, no la validación de arriba.
      return { ok: false, motivo: "ocupado", detalle: "Ese horario ya fue tomado por otra cita." };
    }
    return { ok: false, motivo: "error", detalle: resultado.detalle ?? "No se pudo crear la cita." };
  }

  if (params.telefonoCliente) {
    await recordarNombreCliente(supabase, {
      idTenant: params.idTenant,
      phoneNumberId: especialista.phone_number_id,
      telefonoCliente: params.telefonoCliente,
      nombre: params.nombreCliente,
      correo: params.correoCliente,
    });
  }

  return {
    ok: true,
    cita: resultado.cita,
    especialista: { id: especialista.id, nombre: especialista.nombre as string },
    servicio: { id: servicio.id as string, nombre: servicio.nombre as string, duracionMin },
  };
}

export type ResultadoReagendarPorServicio =
  | { ok: true; cita: CitaEspecialista }
  | { ok: false; motivo: "no_encontrada" | "no_reagendable" | "ocupado" | "error"; detalle: string };

/**
 * Mueve una cita EXISTENTE a un nuevo inicio, reutilizando
 * editarCitaConfirmada() (lib/especialistas.ts, YA compartida con LEGACY y
 * el Flow no activado) -- un UPDATE atómico sobre la MISMA fila, nunca
 * cancelar+crear; sigue protegido por el mismo EXCLUDE.
 *
 * La duración se deriva SIEMPRE del servicio_id guardado en la cita (nunca
 * de lo que mande el caller). Si la cita no tiene servicio_id (creada por
 * LEGACY antes de esta fase, o manualmente desde el panel), se conserva su
 * duración actual -- editarCitaConfirmada ya hace exactamente eso cuando no
 * se le pasa duracionMin. Esta fase NO agrega la capacidad de cambiar de
 * servicio al reagendar (fuera de alcance explícito).
 */
export async function reagendarCitaPorServicio(
  supabase: SupabaseClient,
  params: { idTenant: string; citaId: number; nuevoInicio: Date }
): Promise<ResultadoReagendarPorServicio> {
  const { data: citaActual } = await supabase
    .from("dulabs_citas_especialista")
    .select("id, estado, servicio_id")
    .eq("id", params.citaId)
    .eq("id_tenant", params.idTenant)
    .maybeSingle();
  if (!citaActual) {
    return { ok: false, motivo: "no_encontrada", detalle: "Esa cita no existe." };
  }
  if (citaActual.estado !== "confirmada") {
    return { ok: false, motivo: "no_reagendable", detalle: "Solo una cita confirmada se puede reagendar por acá." };
  }

  let duracionMin: number | undefined;
  if (citaActual.servicio_id) {
    const { data: servicio } = await supabase
      .from("dulabs_servicios")
      .select("duracion_min")
      .eq("id_tenant", params.idTenant)
      .eq("id", citaActual.servicio_id)
      .maybeSingle();
    if (servicio) duracionMin = servicio.duracion_min as number;
  }

  const resultado = await editarCitaConfirmada(supabase, params.citaId, { nuevoInicio: params.nuevoInicio, duracionMin });
  if (!resultado.ok) {
    if (resultado.motivo === "ocupado") return { ok: false, motivo: "ocupado", detalle: "Ese horario ya está ocupado." };
    if (resultado.motivo === "no_encontrada") {
      return { ok: false, motivo: "no_encontrada", detalle: "Esa cita ya no está confirmada." };
    }
    return { ok: false, motivo: "error", detalle: resultado.detalle ?? "No se pudo reagendar la cita." };
  }
  return { ok: true, cita: resultado.cita };
}

export type ResultadoCancelarPorServicio =
  | { ok: true; cita: CitaEspecialista }
  | { ok: false; motivo: "no_encontrada"; detalle: string };

/**
 * Guarda de tenant delgada sobre cancelarCita() (lib/especialistas.ts, YA
 * compartida) -- NO es una segunda operación de cancelación, es el MISMO
 * cambio de estado (-> 'cancelada'). cancelarCita() por sí sola no filtra
 * por tenant (igual que hoy: cada uno de sus callers -- la API de
 * /api/agenda/[token], el adaptador de Flow -- valida pertenencia ANTES de
 * llamarla); esta función hace esa misma validación para el modelo nuevo,
 * sin reimplementar el cambio de estado en sí.
 */
export async function cancelarCitaPorServicio(
  supabase: SupabaseClient,
  params: { idTenant: string; citaId: number; motivo?: string }
): Promise<ResultadoCancelarPorServicio> {
  const { data: citaExistente } = await supabase
    .from("dulabs_citas_especialista")
    .select("id")
    .eq("id", params.citaId)
    .eq("id_tenant", params.idTenant)
    .maybeSingle();
  if (!citaExistente) {
    return { ok: false, motivo: "no_encontrada", detalle: "Esa cita no existe." };
  }
  const cita = await cancelarCita(supabase, params.citaId, params.motivo);
  if (!cita) return { ok: false, motivo: "no_encontrada", detalle: "Esa cita ya no se puede cancelar." };
  return { ok: true, cita };
}
