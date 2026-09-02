import type { SupabaseClient } from "@supabase/supabase-js";
import {
  especialistaPorServicio,
  especialistaPorId,
  especialistasPorCategoria,
  crearCitaEnCategoria,
  crearCitaEspecialista,
  confirmarCita,
  citasDelDiaEnCategoria,
  hayHuecoLibreEseDia,
  citaActivaPara,
  cancelarCita,
  editarCitaConfirmada,
  ventanaAtencion,
  type Especialista,
  type CitaEspecialista,
  type CategoriaServicio,
} from "@/lib/especialistas";
import { horaColombiaDesdeIso } from "@/lib/timezone-colombia";

/**
 * Adaptador Fase 0 (migración Daniela → Flow) sobre el sistema REAL de
 * especialistas: dulabs_especialistas / dulabs_citas_especialista, las
 * MISMAS tablas y las MISMAS funciones (especialistaPorServicio,
 * categoriaDeServicio, crearCitaEspecialista, hayHuecoLibreEseDia,
 * citasDelDiaEnCategoria...) que ya usa lib/especialista-solicitud-ia.ts
 * (motor LEGACY que hoy atiende a Daniela). CERO tablas nuevas, CERO
 * duplicado de datos -- una cita creada por Flow aparece en el mismo
 * dashboard (app/agenda/[token]) que una creada por LEGACY, porque es
 * literalmente la misma fila.
 *
 * LO QUE SÍ SE DUPLICA A PROPÓSITO, Y POR QUÉ:
 * Las reglas de horario/desborde específicas del negocio de Daniela
 * (pestanasDisponible, danielaDisponible, y el árbol de decisión completo de
 * ejecutarHerramienta) viven HOY inline dentro de
 * lib/especialista-solicitud-ia.ts, el motor que atiende a Daniela EN
 * PRODUCCIÓN en este mismo momento. Refactorizar ese archivo para que
 * ambos motores (LEGACY y FLOW) compartan una sola implementación tocaría
 * código que sirve tráfico real de un negocio activo -- exactamente el
 * riesgo que esta fase tiene instrucción explícita de evitar ("NO cambies
 * todavía el routing de Daniela", "NO hagas pruebas reales con clientes").
 * Por eso este archivo es una copia deliberada y documentada del
 * comportamiento, no una extracción compartida. Unificarlas en una sola
 * fuente es limpieza futura legítima, fuera del alcance de esta fase.
 */

/**
 * Rediseño (autorizado) — categoría de MENÚ para la clienta, distinta de
 * CategoriaServicio (lib/especialistas.ts, que es de RUTEO DE RECURSO:
 * manos/pies, a quién asignarle la cita, binaria a propósito). Esta es la
 * categoría que ve la clienta en el botón: las 3 categorías reales y
 * ACTIVAS verificadas en dulabs_especialistas para el tenant de Daniela
 * (Manos: Daniela+Carla, Pies: Kelly, Pestañas: Nicol -- confirmado contra
 * producción, no inventado). "pestanas" nunca sale de categoriaDeServicio
 * (esa función no la conoce) -- se deriva de que la resolución haya sido
 * "exclusiva" contra una especialista cuyo `servicio` es "pestañas".
 */
export type CategoriaMenuServicio = "manos" | "pies" | "pestanas";

/**
 * Convierte el id ESTABLE del botón de categoría (ver DANIELA_BUTTON_IDS en
 * lib/flows/daniela-button-ids.ts, ej. "categoria_manos") en la categoría de
 * menú real -- el backend nunca confía en el texto visible del botón, solo
 * en este id. Devuelve null para cualquier otra cosa (variable ausente,
 * botón desconocido, o el propio texto de un servicio que no es un id de
 * categoría) -- el llamador debe tratar null como "no hay categoría elegida
 * todavía", nunca como una categoría válida por defecto.
 */
export function categoriaMenuDesdeBotonId(valor: string | undefined): CategoriaMenuServicio | null {
  if (!valor) return null;
  const sinPrefijo = valor.replace(/^categoria_/, "");
  return sinPrefijo === "manos" || sinPrefijo === "pies" || sinPrefijo === "pestanas" ? sinPrefijo : null;
}

export type ResultadoValidarServicioEspecialista =
  | { ok: true; servicioReconocido: true }
  | { ok: false; motivo: "servicio_no_manejado"; detalle: string }
  // Rediseño (autorizado) — el servicio SÍ es real y reconocido, pero no
  // pertenece a la categoría de menú que la clienta ya eligió por botón
  // (ej. tocó "Manos" y luego escribió "pestañas volumen ruso").
  | { ok: false; motivo: "categoria_no_coincide"; detalle: string };

export type ResultadoDisponibilidadEspecialista =
  | {
      ok: true;
      especialistaResuelto: string;
      duracionMin: number;
      hayHueco: boolean;
      horariosTomados: { especialista: string; inicio: string; fin: string }[];
    }
  | { ok: false; motivo: "servicio_no_manejado" | "fuera_de_horario" | "fecha_invalida"; detalle: string };

export type ResultadoCrearCitaEspecialista =
  | { ok: true; cita: CitaEspecialista; especialista: Especialista; estado: "confirmada" | "pendiente" }
  | { ok: false; motivo: "ocupado"; horariosTomados: { especialista: string; inicio: string; fin: string }[] }
  | { ok: false; motivo: "servicio_no_manejado" | "fuera_de_horario" | "fecha_invalida" | "no_confirmado" | "error"; detalle: string };

export type ResultadoCancelarCitaEspecialista =
  | { ok: true; cita: CitaEspecialista }
  | { ok: false; motivo: "sin_cita_activa" | "no_confirmado" | "error"; detalle: string };

/**
 * Fase 1 (Blocker #5) — resultado de mover (reagendar) una cita existente.
 * "no_reagendable" es un motivo NUEVO y deliberado: una cita "pendiente"
 * (ej. pestañas con Nicol, esperando aprobación) no pasa por
 * editarCitaConfirmada (que exige estado='confirmada', sin tocar esa
 * función) -- reagendar una cita pendiente queda fuera de esta fase,
 * documentado como límite conocido, no como error silencioso.
 */
export type ResultadoMoverCitaEspecialista =
  | { ok: true; cita: CitaEspecialista }
  | { ok: false; motivo: "ocupado"; horariosTomados: { especialista: string; inicio: string; fin: string }[] }
  | { ok: false; motivo: "sin_cita_activa" | "no_confirmado" | "no_reagendable" | "fecha_invalida" | "error"; detalle: string };

/**
 * Fase 1 (Blocker #4) — todas las citas activas (pendiente/confirmada,
 * futuras) de esta clienta, no solo la más próxima. Necesaria para poder
 * preguntar "¿cuál quieres cancelar?" cuando hay más de una -- citaActivaPara
 * (lib/especialistas.ts, compartida con LEGACY) usa .limit(1) a propósito
 * (LEGACY nunca necesitó desambiguar entre varias) y NO se modificó: esta es
 * una función nueva y exclusiva de este adaptador, misma tabla, mismo
 * criterio de filtrado, sin el límite.
 */
export type ResultadoCitasActivasEspecialista = {
  cantidad: number;
  citas: CitaEspecialista[];
};

// --- Reglas de horario específicas del negocio (copiadas de
// especialista-solicitud-ia.ts -- ver nota de cabecera sobre por qué) -------

/** Nicol (pestañas) trabaja por fuera del spa: disponibilidad real limitada. */
function pestanasDisponible(inicio: Date): boolean {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(inicio);
  const dia = partes.find((p) => p.type === "weekday")?.value;
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0");
  if (dia === "Sun") return false;
  if (dia === "Sat") return true;
  return hora >= 15;
}

/** Daniela (dueña) solo atiende MANOS en las tardes entre semana. */
function danielaDisponible(inicio: Date): boolean {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(inicio);
  const dia = partes.find((p) => p.type === "weekday")?.value;
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0");
  if (dia === "Sun") return false;
  if (dia === "Sat") return hora >= 9;
  return hora >= 14;
}

// --- Reconocimiento de servicio (Fase 1, Blocker #3 -- EXCLUSIVO de este
// adaptador, ver reporte de diseño del blocker) -----------------------------
//
// categoriaDeServicio() (lib/especialistas.ts, compartida con LEGACY) es un
// catch-all: cualquier texto que no mencione "pies/pedicure" cae a "manos".
// Eso es seguro en LEGACY porque el propio prompt de Claude ya le exige al
// modelo negarse a llamar la herramienta para un servicio que no está en el
// menú real ("si preguntan por un servicio que no está en la lista, di que
// no lo manejas") -- categoriaDeServicio() en la práctica NUNCA recibe un
// texto como "masaje" en LEGACY, porque el modelo nunca llega a llamarla
// con eso. El grafo de Flow (todavía sin esa capa de juicio -- ver Blocker
// #7, pendiente) pasa el texto crudo de la clienta directo a la acción, así
// que el mismo catch-all que es inofensivo en LEGACY sería, acá, agendar
// "masaje" con Carla solo porque no es "pies". Por eso este archivo define
// su PROPIO reconocimiento, más estricto: si el texto no menciona nada del
// menú real del negocio, no hay categoría (null), no "manos" por defecto.
// NO se modifica categoriaDeServicio() ni su comportamiento en LEGACY.
//
// Vocabulario curado del negocio real de Daniela -- mismo criterio ya usado
// para pestanasDisponible/danielaDisponible en este archivo: duplicación
// deliberada y documentada, no una extracción compartida con LEGACY.
const PALABRAS_PIES_RECONOCIDAS = /pies|pedicure/i;
const PALABRAS_MANOS_RECONOCIDAS = /manos|u[ñn]as|press\s*on|semipermanente|dipping|rubber|forrado|acr[ií]lic|cejas|henna/i;

export function categoriaDeServicioReconocida(servicio: string): CategoriaServicio | null {
  if (PALABRAS_PIES_RECONOCIDAS.test(servicio)) return "pies";
  if (PALABRAS_MANOS_RECONOCIDAS.test(servicio)) return "manos";
  return null;
}

function parseFechaHora(fecha: string, hora: string): Date | null {
  const inicio = new Date(`${fecha}T${hora}:00-05:00`);
  return Number.isNaN(inicio.getTime()) ? null : inicio;
}

/**
 * Confirma sola (si no requiere aprobación) o deja pendiente (Nicol/pestañas)
 * -- mismo criterio que finalizarCitaCreada en especialista-solicitud-ia.ts.
 * A propósito NO envía notificaciones WhatsApp a la especialista en esta
 * fase (ver blocker documentado en el reporte de Fase 0: la notificación
 * requiere el ClienteConfig completo, que el executor puede resolver, pero
 * se deja fuera de este primer corte para mantener el adaptador enfocado en
 * la escritura atómica de la cita, que es lo que la seguridad/evidencia
 * necesita).
 */
async function finalizarCitaCreada(
  supabase: SupabaseClient,
  especialista: Especialista,
  cita: CitaEspecialista,
): Promise<{ cita: CitaEspecialista; estado: "confirmada" | "pendiente" }> {
  if (especialista.requiere_aprobacion) {
    return { cita, estado: "pendiente" };
  }
  const confirmada = (await confirmarCita(supabase, cita.id)) ?? cita;
  return { cita: confirmada, estado: "confirmada" };
}

/**
 * Resuelve la especialista/categoría objetivo para un servicio, SIN escribir
 * nada -- usado tanto por la consulta de disponibilidad (solo lectura) como
 * como primer paso de la creación real de la cita.
 */
async function resolverCandidatas(
  supabase: SupabaseClient,
  phoneNumberId: string,
  servicio: string,
): Promise<
  | { tipo: "exclusiva"; especialista: Especialista }
  | { tipo: "categoria"; candidatas: Especialista[]; categoria: "manos" | "pies" }
  | { tipo: "sin_especialistas" }
> {
  const especialistaExclusiva = await especialistaPorServicio(supabase, phoneNumberId, servicio);
  if (especialistaExclusiva) return { tipo: "exclusiva", especialista: especialistaExclusiva };

  // Fase 1 (Blocker #3) — a diferencia de categoriaDeServicio() (LEGACY),
  // acá un servicio no reconocido corta de una vez a "sin_especialistas",
  // SIN caer nunca a "manos" por defecto. Ver el comentario de cabecera de
  // categoriaDeServicioReconocida() para el porqué.
  const categoria = categoriaDeServicioReconocida(servicio);
  if (!categoria) return { tipo: "sin_especialistas" };

  let candidatas = await especialistasPorCategoria(supabase, phoneNumberId, categoria);
  // Regla del negocio (idéntica a especialista-solicitud-ia.ts): para MANOS,
  // Carla es la fija -- Daniela nunca es candidata en el primer intento.
  if (categoria === "manos") {
    candidatas = candidatas.filter((e) => e.nombre.toLowerCase() !== "daniela");
  }
  if (candidatas.length === 0) return { tipo: "sin_especialistas" };
  return { tipo: "categoria", candidatas, categoria };
}

/**
 * Solo lectura — valida que el texto de servicio sea reconocible para este
 * tenant (resolverCandidatas), SIN consultar disponibilidad ni escribir
 * variables de hueco. Usado en el slot-filling de agendar ANTES de pedir
 * fecha/hora/nombre.
 */
export async function validarServicioEspecialista(
  supabase: SupabaseClient,
  params: { phoneNumberId: string; servicio: string; categoriaEsperada?: CategoriaMenuServicio },
): Promise<ResultadoValidarServicioEspecialista> {
  const resuelto = await resolverCandidatas(supabase, params.phoneNumberId, params.servicio);
  if (resuelto.tipo === "sin_especialistas") {
    return {
      ok: false,
      motivo: "servicio_no_manejado",
      detalle: `No manejamos "${params.servicio}" con agenda propia todavía.`,
    };
  }
  // Rediseño (autorizado, Objetivo 1) — si la clienta ya eligió una
  // categoría real por botón (categoriaSeleccionada), el servicio debe
  // pertenecer a ESA categoría. No se rechaza por texto/label, se compara
  // contra la categoría REAL que resolverCandidatas ya calculó -- mismo
  // dato que decide a qué especialista se asigna la cita, no una copia.
  if (params.categoriaEsperada) {
    const categoriaReal = categoriaMenuDeResolucion(resuelto);
    if (categoriaReal !== params.categoriaEsperada) {
      return {
        ok: false,
        motivo: "categoria_no_coincide",
        detalle: `"${params.servicio}" no pertenece a la categoría "${params.categoriaEsperada}" que ya elegiste.`,
      };
    }
  }
  return { ok: true, servicioReconocido: true };
}

/**
 * Deriva la categoría de MENÚ (manos/pies/pestañas) del resultado YA
 * calculado por resolverCandidatas -- nunca vuelve a interpretar el texto
 * del servicio por su cuenta. "pestanas" se reconoce por sustantivo real
 * en el campo `servicio` de la especialista exclusiva resuelta (hoy, en
 * datos reales, la única especialista exclusiva no-categoría es Nicol,
 * servicio="pestañas") -- si en el futuro existiera otra especialista
 * exclusiva que no sea de pestañas, esto devuelve null (categoría
 * desconocida) en vez de adivinar, y validarServicioEspecialista la
 * rechazaría por "categoria_no_coincide" antes que aceptar algo incierto.
 */
function categoriaMenuDeResolucion(
  resuelto:
    | { tipo: "exclusiva"; especialista: Especialista }
    | { tipo: "categoria"; candidatas: Especialista[]; categoria: "manos" | "pies" },
): CategoriaMenuServicio | null {
  if (resuelto.tipo === "categoria") return resuelto.categoria;
  return /pesta[ñn]as?/i.test(resuelto.especialista.servicio) ? "pestanas" : null;
}

/**
 * Disponibilidad REAL, de solo lectura -- para el paso "consultar
 * disponibilidad" del flow, antes de intentar crear la cita. Refleja el
 * mismo criterio de "hueco libre ese día" que usa el desborde de LEGACY
 * (hayHuecoLibreEseDia), no una simulación aparte.
 */
export async function consultarDisponibilidadEspecialista(
  supabase: SupabaseClient,
  params: { phoneNumberId: string; servicio: string; fecha: string; duracionMinInput?: number },
): Promise<ResultadoDisponibilidadEspecialista> {
  const resuelto = await resolverCandidatas(supabase, params.phoneNumberId, params.servicio);
  if (resuelto.tipo === "sin_especialistas") {
    return { ok: false, motivo: "servicio_no_manejado", detalle: `No manejamos "${params.servicio}" con agenda propia todavía.` };
  }

  const candidatas = resuelto.tipo === "exclusiva" ? [resuelto.especialista] : resuelto.candidatas;
  const duracionMin =
    params.duracionMinInput && params.duracionMinInput > 0 ? params.duracionMinInput : candidatas[0]!.duracion_min;

  const huecos = await Promise.all(candidatas.map((e) => hayHuecoLibreEseDia(supabase, e, params.fecha, duracionMin)));
  const hayHueco = huecos.some(Boolean);
  const horariosTomados = await citasDelDiaEnCategoria(supabase, candidatas, params.fecha);

  return {
    ok: true,
    especialistaResuelto: candidatas[0]!.nombre,
    duracionMin,
    hayHueco,
    horariosTomados,
  };
}

// --- Rediseño de agendamiento (autorizado) — lista real de horarios -------
//
// Reemplaza el modelo "pedir una hora puntual y comprobar sí/no" por
// "mostrar los horarios REALES disponibles y que la clienta elija uno".
// Reutiliza EXACTAMENTE las mismas reglas de negocio que ya usa
// agendarCitaEspecialista (Carla fija en manos / Kelly fija en pies, con el
// mismo criterio de desborde), calculadas como una LISTA en vez de un
// booleano -- nunca una segunda fuente de verdad de las reglas.

/** Cada cuánto se ofrece un horario dentro de la ventana de atención. Ajustable sin tocar ninguna regla de negocio. */
const GRANULARIDAD_HORARIOS_MIN = 30;

/**
 * Enumera los horarios de inicio REALES (HH:MM, hora Colombia) libres de
 * ESTA especialista puntual ese día, dentro de su ventana de atención real
 * -- comprobando solape contra sus citas reales existentes, nunca "check
 * antes, insert después" (la creación real sigue protegida aparte por el
 * constraint EXCLUDE; esto es solo lectura para PROPONER opciones).
 */
async function horariosLibresParaEspecialista(
  supabase: SupabaseClient,
  especialista: Especialista,
  fechaISO: string,
  duracionMin: number,
  filtroVentanaPropia?: (inicio: Date) => boolean,
): Promise<string[]> {
  const ventana = ventanaAtencion(fechaISO);
  if (!ventana) return [];

  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .select("inicio, fin")
    .eq("especialista_id", especialista.id)
    .in("estado", ["pendiente", "confirmada", "propuesta"])
    .gte("inicio", ventana.apertura.toISOString())
    .lt("inicio", ventana.cierre.toISOString())
    .order("inicio", { ascending: true });
  const ocupadas = (data ?? []) as { inicio: string; fin: string }[];

  const necesarioMs = duracionMin * 60_000;
  const pasoMs = GRANULARIDAD_HORARIOS_MIN * 60_000;
  const horarios: string[] = [];

  for (
    let cursorMs = ventana.apertura.getTime();
    cursorMs + necesarioMs <= ventana.cierre.getTime();
    cursorMs += pasoMs
  ) {
    const inicioSlot = new Date(cursorMs);
    const finSlot = new Date(cursorMs + necesarioMs);
    const solapa = ocupadas.some((o) => inicioSlot < new Date(o.fin) && finSlot > new Date(o.inicio));
    if (solapa) continue;
    if (filtroVentanaPropia && !filtroVentanaPropia(inicioSlot)) continue;
    horarios.push(horaColombiaDesdeIso(inicioSlot.toISOString()));
  }
  return horarios;
}

export type ResultadoHorariosDisponiblesEspecialista =
  | { ok: true; especialistaResuelto: string; duracionMin: number; horarios: string[] }
  | { ok: false; motivo: "servicio_no_manejado"; detalle: string };

/**
 * Lista real de horarios disponibles para un servicio/fecha -- reemplaza al
 * booleano de consultarDisponibilidadEspecialista para el nuevo modelo de
 * agendamiento (esa función se conserva sin cambios, sigue usándose donde
 * ya se usaba). `horarios` puede venir vacío (sin disponibilidad ese día);
 * eso NO es un error, es una respuesta real y válida.
 */
export async function listarHorariosDisponiblesEspecialista(
  supabase: SupabaseClient,
  params: { phoneNumberId: string; servicio: string; fecha: string; duracionMinInput?: number },
): Promise<ResultadoHorariosDisponiblesEspecialista> {
  const resuelto = await resolverCandidatas(supabase, params.phoneNumberId, params.servicio);
  if (resuelto.tipo === "sin_especialistas") {
    return { ok: false, motivo: "servicio_no_manejado", detalle: `No manejamos "${params.servicio}" con agenda propia todavía.` };
  }

  if (resuelto.tipo === "exclusiva") {
    const especialista = resuelto.especialista;
    const duracionMin =
      params.duracionMinInput && params.duracionMinInput > 0 ? params.duracionMinInput : especialista.duracion_min;
    const filtro = especialista.servicio.toLowerCase() === "pestañas" ? pestanasDisponible : undefined;
    const horarios = await horariosLibresParaEspecialista(supabase, especialista, params.fecha, duracionMin, filtro);
    return { ok: true, especialistaResuelto: especialista.nombre, duracionMin, horarios };
  }

  const { candidatas, categoria } = resuelto;
  const duracionMin =
    params.duracionMinInput && params.duracionMinInput > 0 ? params.duracionMinInput : candidatas[0]!.duracion_min;

  if (categoria === "pies") {
    // Kelly fija; Carla es respaldo SOLO si Kelly no tiene ningún hueco ese
    // día -- mismo criterio exacto que agendarCitaEspecialista, aquí el
    // propio largo de la lista real ya es esa comprobación (sin repetirla
    // aparte con hayHuecoLibreEseDia).
    const kelly = candidatas.find((e) => e.nombre.toLowerCase() === "kelly") ?? candidatas[0]!;
    const horariosKelly = await horariosLibresParaEspecialista(supabase, kelly, params.fecha, duracionMin);
    if (horariosKelly.length > 0) return { ok: true, especialistaResuelto: kelly.nombre, duracionMin, horarios: horariosKelly };

    const candidatasManos = await especialistasPorCategoria(supabase, params.phoneNumberId, "manos");
    const carla = candidatasManos.find((e) => e.nombre.toLowerCase() === "carla");
    if (carla) {
      const horariosCarla = await horariosLibresParaEspecialista(supabase, carla, params.fecha, duracionMin);
      if (horariosCarla.length > 0) return { ok: true, especialistaResuelto: carla.nombre, duracionMin, horarios: horariosCarla };
    }
    return { ok: true, especialistaResuelto: kelly.nombre, duracionMin, horarios: [] };
  }

  // categoria === "manos": Carla fija; Daniela es respaldo SOLO si Carla no
  // tiene ningún hueco ese día Y el horario cae en su ventana real -- mismo
  // criterio exacto que agendarCitaEspecialista.
  const carla = candidatas.find((e) => e.nombre.toLowerCase() === "carla") ?? candidatas[0]!;
  const horariosCarla = await horariosLibresParaEspecialista(supabase, carla, params.fecha, duracionMin);
  if (horariosCarla.length > 0) return { ok: true, especialistaResuelto: carla.nombre, duracionMin, horarios: horariosCarla };

  const candidatasTodasManos = await especialistasPorCategoria(supabase, params.phoneNumberId, "manos");
  const daniela = candidatasTodasManos.find((e) => e.nombre.toLowerCase() === "daniela");
  if (daniela) {
    const horariosDaniela = await horariosLibresParaEspecialista(supabase, daniela, params.fecha, duracionMin, danielaDisponible);
    if (horariosDaniela.length > 0) return { ok: true, especialistaResuelto: daniela.nombre, duracionMin, horarios: horariosDaniela };
  }
  return { ok: true, especialistaResuelto: carla.nombre, duracionMin, horarios: [] };
}

export type ResultadoResolverSeleccionHorario =
  | { ok: true; hora: string }
  | { ok: false; motivo: "fuera_de_lista" | "ambiguo"; detalle: string };

/**
 * ÚNICA función que decide qué hora quedó realmente seleccionada -- la IA
 * (nodo ai-interpretar-seleccion) solo INTERPRETA lenguaje natural
 * ("la segunda", "la de las 4", "esa") en un candidato estructurado
 * (índice 1-based o una hora HH:MM); esta función lo valida SIEMPRE contra
 * `horariosDisponibles`, la lista REAL que se le mostró a la clienta. Un
 * candidato que no exista en esa lista se RECHAZA, sin excepción -- nunca
 * se acepta un horario que Claude haya podido inventar. Pura, sin I/O:
 * fácil de probar exhaustivamente.
 */
export function resolverSeleccionHorario(params: {
  horariosDisponibles: string[];
  seleccionTipo?: string;
  seleccionIndice?: number;
  seleccionHora?: string;
}): ResultadoResolverSeleccionHorario {
  const { horariosDisponibles } = params;

  if (params.seleccionTipo === "index" && typeof params.seleccionIndice === "number") {
    const idx = params.seleccionIndice; // 1-based ("la segunda" -> 2)
    if (Number.isInteger(idx) && idx >= 1 && idx <= horariosDisponibles.length) {
      return { ok: true, hora: horariosDisponibles[idx - 1]! };
    }
    return {
      ok: false,
      motivo: "fuera_de_lista",
      detalle: `Índice ${idx} fuera de la lista real de ${horariosDisponibles.length} horario(s).`,
    };
  }

  if (params.seleccionTipo === "time" && typeof params.seleccionHora === "string" && params.seleccionHora) {
    if (horariosDisponibles.includes(params.seleccionHora)) {
      return { ok: true, hora: params.seleccionHora };
    }
    return {
      ok: false,
      motivo: "fuera_de_lista",
      detalle: `"${params.seleccionHora}" no está en la lista real de horarios disponibles.`,
    };
  }

  return { ok: false, motivo: "ambiguo", detalle: "No se pudo identificar con certeza a cuál horario se refiere." };
}

/** Texto legible determinista (nunca redactado por IA) para mostrar la lista real de horarios, ej. "1️⃣ 3:00 p. m.\n2️⃣ 4:00 p. m.". */
export function formatearListaHorarios(horarios: string[]): string {
  const NUMEROS_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  return horarios
    .map((hhmm, i) => `${NUMEROS_EMOJI[i] ?? `${i + 1}.`} ${formatearHoraAmPm(hhmm)}`)
    .join("\n");
}

/** "16:00" -> "4:00 p. m." (español, sin depender de Intl para evitar diferencias de locale entre entornos). */
function formatearHoraAmPm(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const periodo = h >= 12 ? "p. m." : "a. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${periodo}`;
}

// --- Cierre final Daniela (autorizado) — catálogo real de servicios -------
//
// Reemplaza la selección por categoría (Manos/Pies/Pestañas) por el
// catálogo REAL y completo de servicios que Daniela ya tiene configurado en
// base_conocimiento (texto libre subido por el negocio) -- NUNCA una lista
// hardcodeada en el Flow: si el negocio actualiza su base_conocimiento, la
// lista mostrada cambia sola, sin tocar código. Mismo patrón exacto que la
// lista real de horarios (parseo determinista + resolución exacta contra la
// lista mostrada, nunca contra algo que la IA pueda inventar).

export interface ServicioCatalogo {
  nombre: string;
  precio: number;
}

const INICIO_SERVICIOS_UNAS = /SERVICIOS DE U[ÑN]AS Y PRECIOS/i;

/** true si la línea es un encabezado de sección nueva (todo mayúsculas, sin ":") -- marca el fin de la lista de servicios. */
function esEncabezadoSeccion(linea: string): boolean {
  const t = linea.trim();
  if (!t || t.includes(":")) return false;
  return t === t.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(t);
}

/**
 * Parsea el catálogo REAL (nombre + precio) desde la sección "SERVICIOS DE
 * UÑAS Y PRECIOS" de base_conocimiento -- el texto que Daniela subió para
 * su propio negocio. Nunca inventa, nunca agrega, nunca hardcodea un
 * servicio: si esa sección no existe o no tiene líneas "Nombre: $precio",
 * devuelve una lista vacía en vez de adivinar algo. Se detiene en el
 * siguiente encabezado en mayúsculas (ej. "RETOQUE DE FORRADO"), así que
 * pestañas (sección aparte, "PESTAÑAS (...)") queda fuera a propósito --
 * pestañas nunca se ofrece como autoservicio, se transfiere siempre (ver
 * lib/flow-pestanas-hatch.ts).
 */
export function parseServiciosDesdeBaseConocimiento(baseConocimiento: string): ServicioCatalogo[] {
  const lineas = baseConocimiento.split("\n");
  const inicioIdx = lineas.findIndex((l) => INICIO_SERVICIOS_UNAS.test(l));
  if (inicioIdx === -1) return [];

  const servicios: ServicioCatalogo[] = [];
  for (let i = inicioIdx + 1; i < lineas.length; i++) {
    const linea = lineas[i]!.trim();
    if (!linea) continue;
    if (esEncabezadoSeccion(linea)) break;
    const m = linea.match(/^([^:]+):\s*\$\s*([\d.,]+)/);
    if (!m) continue;
    const nombre = m[1]!.trim();
    const precio = Number(m[2]!.replace(/[.,]/g, ""));
    if (!nombre || !Number.isFinite(precio) || precio <= 0) continue;
    servicios.push({ nombre, precio });
  }
  return servicios;
}

/** 70000 -> "$70.000" (formato colombiano, sin depender de Intl para evitar diferencias de locale entre entornos). */
export function formatearPrecioCop(precio: number): string {
  const entero = Math.round(precio).toString();
  const conSeparadores = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `$${conSeparadores}`;
}

/** Texto legible determinista (nunca redactado por IA) para mostrar el catálogo real, ej. "1️⃣ Press on\n2️⃣ Semipermanente en manos". */
export function formatearListaServicios(servicios: ServicioCatalogo[]): string {
  const NUMEROS_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  return servicios.map((s, i) => `${NUMEROS_EMOJI[i] ?? `${i + 1}.`} ${s.nombre}`).join("\n");
}

function normalizarNombreServicio(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export type ResultadoResolverSeleccionServicio =
  | { ok: true; nombre: string; precio: number }
  | { ok: false; motivo: "fuera_de_lista" | "ambiguo"; detalle: string };

/**
 * ÚNICA función que decide qué servicio quedó realmente seleccionado --
 * mismo patrón exacto que resolverSeleccionHorario: la IA (o el texto ya
 * extraído del primer mensaje) solo INTERPRETA en un candidato estructurado
 * (índice 1-based o un nombre); esto lo valida SIEMPRE contra `servicios`,
 * la lista REAL que se mostró. Un candidato que no exista en esa lista se
 * rechaza siempre, sin excepción -- nunca se acepta un servicio inventado.
 * Comparación de nombre insensible a mayúsculas/acentos, pero exacta (nunca
 * "parecido a"): "semipermanente" solo (sin "en manos"/"en pies") no
 * resuelve -- es ambiguo entre las dos entradas reales, y NO se adivina
 * cuál quiso decir.
 */
export function resolverSeleccionServicio(params: {
  servicios: ServicioCatalogo[];
  seleccionTipo?: string;
  seleccionIndice?: number;
  seleccionNombre?: string;
}): ResultadoResolverSeleccionServicio {
  const { servicios } = params;

  if (params.seleccionTipo === "index" && typeof params.seleccionIndice === "number") {
    const idx = params.seleccionIndice; // 1-based ("la segunda" -> 2)
    if (Number.isInteger(idx) && idx >= 1 && idx <= servicios.length) {
      const s = servicios[idx - 1]!;
      return { ok: true, nombre: s.nombre, precio: s.precio };
    }
    return {
      ok: false,
      motivo: "fuera_de_lista",
      detalle: `Índice ${idx} fuera de la lista real de ${servicios.length} servicio(s).`,
    };
  }

  if (params.seleccionTipo === "nombre" && typeof params.seleccionNombre === "string" && params.seleccionNombre.trim()) {
    const buscado = normalizarNombreServicio(params.seleccionNombre);
    const encontrado = servicios.find((s) => normalizarNombreServicio(s.nombre) === buscado);
    if (encontrado) return { ok: true, nombre: encontrado.nombre, precio: encontrado.precio };
    return {
      ok: false,
      motivo: "fuera_de_lista",
      detalle: `"${params.seleccionNombre}" no está en la lista real de servicios mostrados.`,
    };
  }

  return { ok: false, motivo: "ambiguo", detalle: "No se pudo identificar con certeza a cuál servicio se refiere." };
}

/**
 * Crea la cita REAL -- réplica exacta del árbol de decisión de
 * ejecutarHerramienta() en especialista-solicitud-ia.ts: especialidad
 * exclusiva primero (con ventana horaria propia si aplica, ej. Nicol),
 * si no categoría compartida con las reglas de desborde fijas del negocio
 * (Kelly fija en pies con desborde a Carla; Carla fija en manos con
 * desborde a Daniela solo si Carla no tiene NINGÚN hueco ese día Y el
 * horario cae en la ventana real de Daniela). Intento de inserción atómico
 * (constraint EXCLUDE de Postgres vía crearCitaEspecialista) -- nunca
 * "check antes, insert después".
 */
/**
 * Fase 2b (bug crítico real, defense-in-depth) — mismo candado real que
 * cancelarCitaEspecialista/moverCitaEspecialista más abajo: sin
 * confirmado=true no crea nada, ANTES de cualquier lectura/escritura. El
 * grafo de Flow (daniela-agendar-cita.flow.ts) ya garantiza estructuralmente
 * que este action solo se alcanza tras una clasificación 'confirma' -- este
 * candado es una segunda barrera independiente, no la única: si el grafo
 * alguna vez cambiara y dejara de proteger este camino, esta función seguiría
 * rechazando la creación sin confirmado=true.
 */
export async function agendarCitaEspecialista(
  supabase: SupabaseClient,
  params: {
    phoneNumberId: string;
    telefonoCliente: string;
    servicio: string;
    fecha: string;
    hora: string;
    nombreCliente: string;
    confirmado: boolean;
    duracionMinInput?: number;
  },
): Promise<ResultadoCrearCitaEspecialista> {
  if (!params.confirmado) {
    return {
      ok: false,
      motivo: "no_confirmado",
      detalle:
        "Todavía no agendes. Primero cuéntale a la clienta el servicio, la fecha, la hora y con quién sería, y pregúntale si confirma. Solo si dice que sí, vuelve a llamar esta acción con confirmado=true.",
    };
  }
  const inicio = parseFechaHora(params.fecha, params.hora);
  if (!inicio) return { ok: false, motivo: "fecha_invalida", detalle: "Fecha u hora inválida." };

  const resuelto = await resolverCandidatas(supabase, params.phoneNumberId, params.servicio);
  if (resuelto.tipo === "sin_especialistas") {
    return { ok: false, motivo: "servicio_no_manejado", detalle: `No manejamos "${params.servicio}" con agenda propia todavía.` };
  }

  if (resuelto.tipo === "exclusiva") {
    const especialista = resuelto.especialista;
    if (especialista.servicio.toLowerCase() === "pestañas" && !pestanasDisponible(inicio)) {
      return {
        ok: false,
        motivo: "fuera_de_horario",
        detalle:
          "Nicol solo tiene disponibilidad para pestañas después de las 3:00 pm entre semana, o desde la mañana los sábados (domingo el spa no abre).",
      };
    }
    const duracionMin =
      params.duracionMinInput && params.duracionMinInput > 0 ? params.duracionMinInput : especialista.duracion_min;
    const resultado = await crearCitaEspecialista(supabase, {
      especialistaId: especialista.id,
      idTenant: especialista.id_tenant,
      phoneNumberId: especialista.phone_number_id,
      telefonoCliente: params.telefonoCliente,
      nombreCliente: params.nombreCliente,
      servicio: params.servicio,
      inicio,
      duracionMin,
      bloqueaHorario: especialista.bloquea_horario,
      origen: "whatsapp_ia",
    });
    if (!resultado.ok) {
      if (resultado.motivo === "ocupado") {
        const horariosTomados = await citasDelDiaEnCategoria(supabase, [especialista], params.fecha);
        return { ok: false, motivo: "ocupado", horariosTomados };
      }
      return { ok: false, motivo: "error", detalle: resultado.detalle ?? "No se pudo agendar, intenta de nuevo." };
    }
    const final = await finalizarCitaCreada(supabase, especialista, resultado.cita);
    return { ok: true, cita: final.cita, especialista, estado: final.estado };
  }

  // Categoría compartida (manos/pies) con desborde fijo del negocio.
  const { candidatas, categoria } = resuelto;
  const duracionMin =
    params.duracionMinInput && params.duracionMinInput > 0 ? params.duracionMinInput : candidatas[0]!.duracion_min;

  const resultado = await crearCitaEnCategoria(supabase, candidatas, {
    telefonoCliente: params.telefonoCliente,
    nombreCliente: params.nombreCliente,
    servicio: params.servicio,
    inicio,
    duracionMin,
    origen: "whatsapp_ia",
  });

  if (resultado.ok) {
    const final = await finalizarCitaCreada(supabase, resultado.especialista, resultado.cita);
    return { ok: true, cita: final.cita, especialista: resultado.especialista, estado: final.estado };
  }
  if (resultado.motivo !== "ocupado") {
    return { ok: false, motivo: "error", detalle: resultado.detalle ?? "No se pudo agendar, intenta de nuevo." };
  }

  // Desborde: PIES -> Kelly es la fija, Carla es respaldo solo si Kelly no
  // tiene NINGÚN hueco ese día completo (no solo a la hora pedida).
  if (categoria === "pies") {
    const kelly = candidatas.find((e) => e.nombre.toLowerCase() === "kelly") ?? candidatas[0]!;
    const kellyTieneHueco = await hayHuecoLibreEseDia(supabase, kelly, params.fecha, duracionMin);
    if (!kellyTieneHueco) {
      const candidatasManos = await especialistasPorCategoria(supabase, params.phoneNumberId, "manos");
      const carla = candidatasManos.find((e) => e.nombre.toLowerCase() === "carla");
      if (carla) {
        const resultadoCarla = await crearCitaEnCategoria(supabase, [carla], {
          telefonoCliente: params.telefonoCliente,
          nombreCliente: params.nombreCliente,
          servicio: params.servicio,
          inicio,
          duracionMin,
          origen: "whatsapp_ia",
        });
        if (resultadoCarla.ok) {
          const final = await finalizarCitaCreada(supabase, resultadoCarla.especialista, resultadoCarla.cita);
          return { ok: true, cita: final.cita, especialista: resultadoCarla.especialista, estado: final.estado };
        }
      }
    }
  }

  // Desborde: MANOS -> Carla es la fija, Daniela es respaldo solo si Carla
  // no tiene NINGÚN hueco ese día Y el horario cae en la ventana real de
  // Daniela (tardes entre semana, desde la mañana los sábados).
  if (categoria === "manos") {
    const carla = candidatas.find((e) => e.nombre.toLowerCase() === "carla") ?? candidatas[0]!;
    const carlaTieneHueco = await hayHuecoLibreEseDia(supabase, carla, params.fecha, duracionMin);
    if (!carlaTieneHueco && danielaDisponible(inicio)) {
      const candidatasTodasManos = await especialistasPorCategoria(supabase, params.phoneNumberId, "manos");
      const daniela = candidatasTodasManos.find((e) => e.nombre.toLowerCase() === "daniela");
      if (daniela) {
        const resultadoDaniela = await crearCitaEnCategoria(supabase, [daniela], {
          telefonoCliente: params.telefonoCliente,
          nombreCliente: params.nombreCliente,
          servicio: params.servicio,
          inicio,
          duracionMin,
          origen: "whatsapp_ia",
        });
        if (resultadoDaniela.ok) {
          const final = await finalizarCitaCreada(supabase, resultadoDaniela.especialista, resultadoDaniela.cita);
          return { ok: true, cita: final.cita, especialista: resultadoDaniela.especialista, estado: final.estado };
        }
      }
    }
  }

  const horariosTomados = await citasDelDiaEnCategoria(supabase, candidatas, params.fecha);
  return { ok: false, motivo: "ocupado", horariosTomados };
}

// Mismas columnas que COLUMNAS_CITA en lib/especialistas.ts (privada,
// sin exportar) -- duplicada literal a propósito para no tocar ese archivo
// compartido con LEGACY. Ver nota de cabecera de este archivo.
const COLUMNAS_CITA_ADAPTADOR = "id, especialista_id, telefono_cliente, nombre_cliente, servicio, inicio, fin, estado, motivo_rechazo, origen";

/**
 * Fase 1 (Blocker #4) — TODAS las citas activas de esta clienta (no solo la
 * más próxima, a diferencia de citaActivaPara). Solo lectura.
 */
export async function consultarCitasActivasEspecialista(
  supabase: SupabaseClient,
  params: { phoneNumberId: string; telefonoCliente: string },
): Promise<ResultadoCitasActivasEspecialista> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .select(COLUMNAS_CITA_ADAPTADOR)
    .eq("phone_number_id", params.phoneNumberId)
    .eq("telefono_cliente", params.telefonoCliente)
    .in("estado", ["pendiente", "confirmada"])
    .gte("inicio", new Date().toISOString())
    .order("inicio", { ascending: true });
  const citas = (data as CitaEspecialista[]) ?? [];
  return { cantidad: citas.length, citas };
}

/**
 * Fase 1 (Blocker #4) — resuelve una cita puntual por id, verificando que
 * pertenezca REALMENTE a este phoneNumberId + telefonoCliente y que siga
 * activa. Esto es lo que impide cancelar la cita de otro cliente (Caso H) o
 * de otro tenant (Caso I, ya cubierto además por assertPhoneNumberOwnedByTenant
 * en el executor): un citaId que no calce con AMBOS filtros simplemente no
 * aparece, sin importar qué tan "real" parezca el id.
 */
async function citaPorIdYCliente(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string,
  citaId: number,
): Promise<CitaEspecialista | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .select(COLUMNAS_CITA_ADAPTADOR)
    .eq("id", citaId)
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .in("estado", ["pendiente", "confirmada"])
    .maybeSingle();
  return (data as CitaEspecialista) ?? null;
}

/**
 * Cancela una cita de esta clienta -- mismo candado real que
 * cancelar_mi_cita en LEGACY: sin confirmado=true no cancela nada, sin
 * importar qué tan segura suene la clienta.
 *
 * Fase 1 (Blocker #4) — citaId es OPCIONAL y NUEVO: sin él, se comporta
 * IDÉNTICO a como siempre (cancela la cita activa más próxima, vía
 * citaActivaPara, sin tocar esa función ni su firma). Con él, cancela
 * ESA cita puntual -- necesario para cuando la clienta tiene varias citas
 * activas y ya identificó cuál quiere cancelar. citaPorIdYCliente valida
 * que esa cita sea realmente de esta clienta antes de tocar nada.
 */
export async function cancelarCitaEspecialista(
  supabase: SupabaseClient,
  params: { phoneNumberId: string; telefonoCliente: string; confirmado: boolean; citaId?: number },
): Promise<ResultadoCancelarCitaEspecialista> {
  const citaObjetivo =
    params.citaId !== undefined
      ? await citaPorIdYCliente(supabase, params.phoneNumberId, params.telefonoCliente, params.citaId)
      : await citaActivaPara(supabase, params.phoneNumberId, params.telefonoCliente);
  if (!citaObjetivo) {
    return { ok: false, motivo: "sin_cita_activa", detalle: "No tiene ninguna cita activa con ese identificador." };
  }
  if (!params.confirmado) {
    return {
      ok: false,
      motivo: "no_confirmado",
      detalle:
        "Todavía no canceles. Primero pregúntale con cariño el motivo y ofrécele reagendar en vez de cancelar. Solo si insiste, vuelve a llamar esta acción con confirmado=true.",
    };
  }
  const cita = await cancelarCita(supabase, citaObjetivo.id, "La clienta canceló por WhatsApp (Flow)");
  if (!cita) return { ok: false, motivo: "error", detalle: "Esa cita ya no se puede cancelar." };
  return { ok: true, cita };
}

/**
 * Fase 1 (Blocker #5) — mueve (reagenda) una cita existente a una nueva
 * fecha/hora, sin crear ninguna fila nueva y sin cancelar-luego-crear.
 *
 * ESTRATEGIA ELEGIDA (ver informe de diseño del Blocker #5): reutiliza
 * editarCitaConfirmada() (lib/especialistas.ts, YA EXISTENTE, YA compartida
 * -- usada hoy por el dashboard en app/api/agenda/[token]/citas/[id]/route.ts,
 * NO modificada acá) -- un UPDATE atómico sobre la MISMA fila, donde el
 * constraint EXCLUDE real (dulabs_citas_especialista_sin_solape) decide si
 * el nuevo horario choca con otra cita, exactamente igual que decide un
 * INSERT nuevo. Nunca existe una segunda fila, ni siquiera momentáneamente:
 * o el UPDATE completo tiene éxito (misma fila, mismo id, nueva hora), o
 * falla completo y Postgres deja la fila original intacta. Se descartó a
 * propósito el patrón "cancelar la vieja, crear la nueva" (el que sí usa
 * hoy el bot de WhatsApp de LEGACY vía cambiar_hora_mi_cita): si el segundo
 * paso fallara, la clienta se quedaría sin ninguna cita -- con
 * editarCitaConfirmada ese escenario es estructuralmente imposible.
 *
 * citaPorIdYCliente sigue siendo quien valida que la cita sea REALMENTE de
 * esta clienta (Casos I/J) antes de tocar nada -- editarCitaConfirmada por
 * sí sola no valida phoneNumberId/telefonoCliente, así que esa validación
 * previa es obligatoria y no se puede saltar.
 */
export async function moverCitaEspecialista(
  supabase: SupabaseClient,
  params: {
    phoneNumberId: string;
    telefonoCliente: string;
    citaId: number;
    nuevaFecha: string;
    nuevaHora: string;
    confirmado: boolean;
  },
): Promise<ResultadoMoverCitaEspecialista> {
  const citaObjetivo = await citaPorIdYCliente(supabase, params.phoneNumberId, params.telefonoCliente, params.citaId);
  if (!citaObjetivo) {
    return { ok: false, motivo: "sin_cita_activa", detalle: "No tiene ninguna cita activa con ese identificador." };
  }
  if (citaObjetivo.estado !== "confirmada") {
    // "pendiente" -- ver docstring de ResultadoMoverCitaEspecialista.
    return {
      ok: false,
      motivo: "no_reagendable",
      detalle: "Esta cita todavía está pendiente de aprobación y no se puede reagendar sola por acá todavía.",
    };
  }
  if (!params.confirmado) {
    return {
      ok: false,
      motivo: "no_confirmado",
      detalle: "Todavía no la muevas. Primero confirma con la clienta la nueva fecha y hora exactas antes de ejecutar el cambio.",
    };
  }
  const nuevoInicio = parseFechaHora(params.nuevaFecha, params.nuevaHora);
  if (!nuevoInicio) {
    return { ok: false, motivo: "fecha_invalida", detalle: "Fecha u hora inválida." };
  }

  const resultado = await editarCitaConfirmada(supabase, citaObjetivo.id, { nuevoInicio });

  if (!resultado.ok) {
    if (resultado.motivo === "ocupado") {
      const especialista = await especialistaPorId(supabase, citaObjetivo.especialista_id);
      const horariosTomados = especialista
        ? await citasDelDiaEnCategoria(supabase, [especialista], params.nuevaFecha)
        : [];
      return { ok: false, motivo: "ocupado", horariosTomados };
    }
    // "no_encontrada" acá sería una carrera genuina (alguien más la canceló
    // entre la validación de arriba y este UPDATE) -- se reporta como error,
    // nunca como éxito.
    return { ok: false, motivo: "error", detalle: resultado.detalle ?? "No se pudo mover la cita, intenta de nuevo." };
  }

  return { ok: true, cita: resultado.cita };
}

export type { Especialista, CitaEspecialista };
export { especialistaPorId };
