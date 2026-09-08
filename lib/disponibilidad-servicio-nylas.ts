/**
 * PILOTO AMORE + Nylas (autorizado, FASE B) — disponibilidad REAL combinando
 * el motor ya existente de DuLabs (lib/disponibilidad-servicio.ts,
 * lib/especialistas.ts) con eventos reales de Google Calendar leídos vía
 * Nylas. NUNCA reemplaza ni modifica listarHorariosDisponiblesPorServicio
 * (el portal /reservar/amore sigue usando exactamente esa función, sin
 * cambios) -- esta es una función NUEVA y aditiva.
 *
 * Reutiliza TAL CUAL (nunca duplicado):
 * - resolverEspecialistasElegiblesParaServicio (lib/asignacion-categoria.ts)
 *   -- misma regla de "quién puede atender este servicio" que el portal.
 * - ventanasLaboralesEspecialista / bloqueosDelDia / restarBloqueos /
 *   generarHorariosLibres (lib/especialistas.ts) -- mismo cálculo puro de
 *   huecos, sin ningún algoritmo nuevo.
 * - citasOcupadasDelDia (lib/disponibilidad-servicio.ts, ahora exportada)
 *   -- mismas citas ya reservadas en DuLabs cuentan como ocupadas.
 *
 * Lo único que agrega esta fase: una fuente de ocupación MÁS (eventos reales
 * de Google Calendar vía Nylas), combinada con las anteriores ANTES de
 * calcular los huecos -- generarHorariosLibres recibe un array de
 * "ocupadas" más largo, nada más. Cada profesional elegible se calcula de
 * forma INDEPENDIENTE (lógica OR: Mary ocupada nunca oculta la disponibilidad
 * real de Cristal/Nata/Jessica).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ventanasLaboralesEspecialista,
  bloqueosDelDia,
  restarBloqueos,
  generarHorariosLibres,
  type VentanaHoraria,
} from "@/lib/especialistas";
import { citasOcupadasDelDia } from "@/lib/disponibilidad-servicio";
import { horaColombiaDesdeIso } from "@/lib/timezone-colombia";
import { resolverEspecialistasElegiblesParaServicio } from "@/lib/asignacion-categoria";
import { consultarEventosOcupadosNylas } from "@/lib/nylas/nylas-eventos-ocupados";
import { resolverCalendarIdNylasDeEspecialista } from "@/lib/nylas/nylas-calendario-especialista";
import type { NylasEventsClient } from "@/lib/nylas/nylas-types";

/**
 * "ok": se pudo calcular con datos confirmados (DuLabs + Nylas, o solo
 *   DuLabs si esta profesional no tiene calendario de Nylas asociado
 *   todavía -- nunca rompe para especialistas/tenants sin Nylas).
 * "no_confirmado": Nylas falló/hizo timeout para el calendario de ESTA
 *   profesional puntual -- nunca se ofrecen sus horarios como si fueran
 *   libres, `horarios` queda vacío a propósito.
 */
export type EstadoDisponibilidadEspecialista = "ok" | "no_confirmado";

export type EspecialistaConHorariosNylas = {
  especialistaId: number;
  nombre: string;
  estado: EstadoDisponibilidadEspecialista;
  horarios: string[]; // "HH:MM" hora Colombia -- mismo formato que el motor existente
};

export type ResultadoHorariosConNylas =
  | { ok: true; servicio: { id: string; nombre: string; duracionMin: number }; especialistas: EspecialistaConHorariosNylas[] }
  | { ok: false; motivo: "servicio_no_encontrado" | "sin_especialistas_habilitados"; detalle: string };

export interface DepsDisponibilidadNylas {
  /** Inyectable para tests -- default real: resolverCalendarIdNylasDeEspecialista. */
  resolverCalendarId?: typeof resolverCalendarIdNylasDeEspecialista;
  /** Cliente Nylas real o mockeado -- requerido: sin esto no se puede consultar ninguna profesional con calendario asociado. */
  nylasClient: NylasEventsClient;
  /** grant_id de Nylas ya resuelto por el caller (ver lib/nylas/nylas-grant.ts) -- nunca hardcodeado acá. */
  grantId: string;
}

/**
 * Fase 3 (autorizado, multi-servicio) — EXPORTADA sin ningún cambio de
 * comportamiento (auditado: ya recibía `duracionMin` como número plano, sin
 * ninguna dependencia de "servicio" -- nunca reimplementada, reutilizada TAL
 * CUAL por lib/agenda-v2/disponibilidad.ts para calcular disponibilidad
 * continua de una duración total combinada). El único cambio es la
 * visibilidad del símbolo.
 */
export async function calcularHorariosDeEspecialista(
  supabase: SupabaseClient,
  params: { idTenant: string; especialista: { id: number; nombre: string }; fecha: string; duracionMin: number },
  deps: DepsDisponibilidadNylas,
): Promise<EspecialistaConHorariosNylas> {
  const { especialista } = params;
  const resolverCalendarId = deps.resolverCalendarId ?? resolverCalendarIdNylasDeEspecialista;

  const [ventanasBase, bloqueos] = await Promise.all([
    ventanasLaboralesEspecialista(supabase, especialista.id, params.idTenant, params.fecha),
    bloqueosDelDia(supabase, especialista.id, params.idTenant, params.fecha),
  ]);
  const ventanas = restarBloqueos(ventanasBase, bloqueos);
  if (ventanas.length === 0) {
    return { especialistaId: especialista.id, nombre: especialista.nombre, estado: "ok", horarios: [] };
  }

  const desde = ventanas[0]!.apertura;
  const hasta = ventanas[ventanas.length - 1]!.cierre;
  const ocupadasDulabs = await citasOcupadasDelDia(supabase, especialista.id, desde.toISOString(), hasta.toISOString());

  const calendarId = await resolverCalendarId(supabase, params.idTenant, especialista.id);

  let ocupadas: VentanaHoraria[] = ocupadasDulabs;
  let estado: EstadoDisponibilidadEspecialista = "ok";

  if (calendarId) {
    const resultadoNylas = await consultarEventosOcupadosNylas(deps.nylasClient, {
      grantId: deps.grantId,
      calendarId,
      fechaISO: params.fecha,
      desde,
      hasta,
    });
    if (resultadoNylas.ok) {
      ocupadas = [...ocupadasDulabs, ...resultadoNylas.ocupadas];
    } else {
      // Nylas falló/hizo timeout para ESTA profesional -- nunca se ofrecen
      // horarios que no se pudieron confirmar contra su calendario real.
      estado = "no_confirmado";
    }
  }

  const horarios =
    estado === "ok" ? generarHorariosLibres(ventanas, ocupadas, params.duracionMin).map((d) => horaColombiaDesdeIso(d.toISOString())) : [];

  return { especialistaId: especialista.id, nombre: especialista.nombre, estado, horarios };
}

export async function listarHorariosDisponiblesPorServicioConNylas(
  supabase: SupabaseClient,
  params: { idTenant: string; servicioId: string; fecha: string; especialistaId?: number },
  deps: DepsDisponibilidadNylas,
): Promise<ResultadoHorariosConNylas> {
  const { data: servicio } = await supabase
    .from("dulabs_servicios")
    .select("id, nombre, duracion_min")
    .eq("id_tenant", params.idTenant)
    .eq("id", params.servicioId)
    .eq("activo", true)
    .maybeSingle();
  if (!servicio) {
    return { ok: false, motivo: "servicio_no_encontrado", detalle: "Ese servicio no existe o no está activo." };
  }

  // Mismo resolver único que usa el portal (lib/asignacion-categoria.ts) --
  // nunca una segunda regla de elegibilidad para el piloto de Nylas.
  const resolucion = await resolverEspecialistasElegiblesParaServicio(supabase, params.idTenant, servicio.id as string);
  let especialistasActivos = resolucion.especialistas.map((e) => ({ id: e.especialistaId, nombre: e.nombre }));
  let modoAsignacion: "todos" | "prioridad" = resolucion.modo === "prioridad" ? "prioridad" : "todos";

  if (params.especialistaId !== undefined) {
    especialistasActivos = especialistasActivos.filter((e) => e.id === params.especialistaId);
    modoAsignacion = "todos";
  }
  if (especialistasActivos.length === 0) {
    return { ok: false, motivo: "sin_especialistas_habilitados", detalle: "Ningún especialista está habilitado para este servicio todavía." };
  }

  const duracionMin = servicio.duracion_min as number;
  const horariosDe = (especialista: { id: number; nombre: string }) =>
    calcularHorariosDeEspecialista(supabase, { idTenant: params.idTenant, especialista, fecha: params.fecha, duracionMin }, deps);

  let especialistas: EspecialistaConHorariosNylas[];
  if (modoAsignacion === "prioridad") {
    // Mismo criterio que listarHorariosDisponiblesPorServicio: se prueba en
    // orden y se corta en el primero con horarios REALES ese día. Un
    // "no_confirmado" NUNCA cuenta como corte (no sabemos si tiene cupo o
    // no) -- se sigue probando al siguiente de la lista, pero se conserva en
    // el resultado final si nadie más tuvo cupo confirmado, para que el
    // caller sepa que hay una profesional cuya disponibilidad no se pudo
    // verificar en vez de asumir silenciosamente "sin cupo".
    const intentados: EspecialistaConHorariosNylas[] = [];
    let encontrado: EspecialistaConHorariosNylas | undefined;
    for (const especialista of especialistasActivos) {
      const resultado = await horariosDe(especialista);
      intentados.push(resultado);
      if (resultado.estado === "ok" && resultado.horarios.length > 0) {
        encontrado = resultado;
        break;
      }
    }
    especialistas = encontrado ? [encontrado] : intentados;
  } else {
    especialistas = await Promise.all(especialistasActivos.map(horariosDe));
  }

  return { ok: true, servicio: { id: servicio.id as string, nombre: servicio.nombre as string, duracionMin }, especialistas };
}
