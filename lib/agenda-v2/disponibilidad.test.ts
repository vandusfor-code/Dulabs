/**
 * lib/agenda-v2/disponibilidad.ts -- pruebas con fakes en memoria para las
 * piezas de I/O real (horario, bloqueos, Nylas), reutilizando TAL CUAL las
 * funciones puras reales (restarBloqueos, sumarDias) -- nunca se fake-ean
 * cálculos puros que no tocan red ni base de datos.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularDiasCandidatosReales, calcularHorariosParaFecha, MAX_DIAS_CANDIDATOS, HORIZONTE_DIAS_A_EVALUAR } from "@/lib/agenda-v2/disponibilidad";
import type { VentanaHoraria } from "@/lib/especialistas";
import type { ResultadoHorariosConNylas } from "@/lib/disponibilidad-servicio-nylas";
import { fechaColombiaDesdeIso } from "@/lib/timezone-colombia";

const FAKE_SUPABASE = {} as SupabaseClient;
const TENANT = "amore-test";
const SERVICIO_ID = "s-test-real";
const PROFESIONAL_ID = 1262;
const HOY = "2026-09-07"; // lunes real (ver system prompt de la sesión)
const NYLAS_DEPS_FAKE = { nylasClient: { listEvents: async () => [] }, grantId: "grant-test" };

function ventana(apertura: string, cierre: string, fechaIso: string): VentanaHoraria {
  return { apertura: new Date(`${fechaIso}T${apertura}-05:00`), cierre: new Date(`${fechaIso}T${cierre}-05:00`) };
}

function diaSemana(fechaIso: string): number {
  return new Date(`${fechaIso}T12:00:00-05:00`).getDay();
}

/** Horario real de Mary (ver pedido): lun-vie 09:00-18:00, sáb 09:00-20:00, domingo sin filas (no laborable). */
async function ventanasMary(_s: unknown, _profesionalId: number, _idTenant: string, fechaIso: string): Promise<VentanaHoraria[]> {
  const dow = diaSemana(fechaIso);
  if (dow === 0) return [];
  if (dow === 6) return [ventana("09:00", "20:00", fechaIso)];
  return [ventana("09:00", "18:00", fechaIso)];
}

async function sinBloqueos(): Promise<VentanaHoraria[]> {
  return [];
}

/** Falla a propósito si se llama -- prueba dura de que un día ya descartado por horario/bloqueos NUNCA llega a gastar una consulta real a Nylas. */
async function nylasNuncaDebeLlamarse(): Promise<ResultadoHorariosConNylas> {
  throw new Error("listarHorariosDisponiblesPorServicioConNylas NO debía llamarse -- el día ya estaba descartado por horario/bloqueos");
}

/** Fábrica de un fake de Nylas por fecha -- `porFecha` mapea fechaIso -> horarios reales ("HH:MM"[]) de PROFESIONAL_ID; una fecha ausente del mapa se resuelve como "sin ningún hueco real ese día" (agenda llena en Nylas). */
function nylasPorFecha(porFecha: Record<string, string[]>) {
  const llamadas: string[] = [];
  const fn = async (
    _s: unknown,
    params: { idTenant: string; servicioId: string; fecha: string; especialistaId?: number },
  ): Promise<ResultadoHorariosConNylas> => {
    llamadas.push(params.fecha);
    const horarios = porFecha[params.fecha] ?? [];
    return {
      ok: true,
      servicio: { id: params.servicioId, nombre: "Servicio de prueba", duracionMin: 60 },
      especialistas: [{ especialistaId: params.especialistaId ?? PROFESIONAL_ID, nombre: "Mary", estado: "ok", horarios }],
    };
  };
  return { fn, llamadas };
}

describe("calcularDiasCandidatosReales", () => {
  it("Test 1: profesional con disponibilidad real -> devuelve días candidatos reales", async () => {
    const nylas = nylasPorFecha({ "2026-09-08": ["09:00", "10:00"] }); // martes
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ventanasLaboralesEspecialista: ventanasMary, bloqueosDelDia: sinBloqueos, listarHorariosDisponiblesPorServicioConNylas: nylas.fn, hoyIso: () => HOY },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.deepEqual(
      resultado.opciones.map((o) => o.fechaIso),
      ["2026-09-08"],
    );
  });

  it("CORRECCIÓN (autorizada, 'agendar hoy') -- Test 1 obligatorio: HOY con disponibilidad real -> aparece como PRIMERA opción (numero 1)", async () => {
    const nylas = nylasPorFecha({ [HOY]: ["11:00", "11:30"], "2026-09-08": ["09:00"] });
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ventanasLaboralesEspecialista: ventanasMary, bloqueosDelDia: sinBloqueos, listarHorariosDisponiblesPorServicioConNylas: nylas.fn, hoyIso: () => HOY },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.deepEqual(
      resultado.opciones.map((o) => [o.numero, o.fechaIso]),
      [
        [1, HOY],
        [2, "2026-09-08"],
      ],
    );
  });

  it("CORRECCIÓN (autorizada, 'agendar hoy') -- Test 2 obligatorio: HOY sin disponibilidad real -> HOY NO aparece, empieza mañana", async () => {
    // HOY ausente del mapa -- misma convención ya usada en este archivo: "sin ningún hueco real ese día" (agenda llena / ya cerrado).
    const nylas = nylasPorFecha({ "2026-09-08": ["09:00"] });
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ventanasLaboralesEspecialista: ventanasMary, bloqueosDelDia: sinBloqueos, listarHorariosDisponiblesPorServicioConNylas: nylas.fn, hoyIso: () => HOY },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.deepEqual(
      resultado.opciones.map((o) => o.fechaIso),
      ["2026-09-08"],
      "HOY nunca aparece cuando no tiene disponibilidad real -- el primer candidato pasa a ser mañana, comportamiento idéntico al de antes de esta corrección para ese caso",
    );
  });

  it("CORRECCIÓN (autorizada, 'agendar hoy') -- Test 4 obligatorio: HOY con la jornada ya cerrada (Nylas/motor real no confirma ningún hueco) -> HOY no aparece", async () => {
    // Mismo criterio que el test anterior: a este nivel (día candidato), "jornada cerrada" y "sin disponibilidad" se ven idénticos -- el filtro real de horas YA pasadas vive en lib/disponibilidad-servicio-nylas.ts (calcularHorariosDeEspecialista), probado por separado.
    const nylas = nylasPorFecha({ [HOY]: [], "2026-09-08": ["09:00"] });
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ventanasLaboralesEspecialista: ventanasMary, bloqueosDelDia: sinBloqueos, listarHorariosDisponiblesPorServicioConNylas: nylas.fn, hoyIso: () => HOY },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.deepEqual(
      resultado.opciones.map((o) => o.fechaIso),
      ["2026-09-08"],
    );
  });

  it("Test 2: domingo nunca aparece -- ni siquiera se consulta Nylas para ese día (profesional no trabaja)", async () => {
    // 2026-09-13 es domingo real dentro del horizonte de evaluación.
    const nylas = nylasPorFecha({ "2026-09-08": ["09:00"], "2026-09-13": ["09:00"] });
    // Reemplaza el fake genérico por uno que EXPLOTA si alguna vez se le pregunta por el domingo -- prueba dura de aislamiento del filtro rápido.
    const nylasConGuardia = async (s: unknown, params: { fecha: string; idTenant: string; servicioId: string; especialistaId?: number }) => {
      if (params.fecha === "2026-09-13") throw new Error("NUNCA debía consultarse Nylas para un domingo no laborable");
      return nylas.fn(s, params);
    };
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ventanasLaboralesEspecialista: ventanasMary, bloqueosDelDia: sinBloqueos, listarHorariosDisponiblesPorServicioConNylas: nylasConGuardia, hoyIso: () => HOY },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.ok(!resultado.opciones.some((o) => o.fechaIso === "2026-09-13"), "el domingo nunca debe aparecer como candidato");
  });

  it("Test 3: día sin ninguna ventana laboral para ESTE profesional no aparece (nunca toca Nylas)", async () => {
    async function ventanasSinTrabajarNunca() {
      return [];
    }
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ventanasLaboralesEspecialista: ventanasSinTrabajarNunca, bloqueosDelDia: sinBloqueos, listarHorariosDisponiblesPorServicioConNylas: nylasNuncaDebeLlamarse, hoyIso: () => HOY },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.deepEqual(resultado.opciones, []);
  });

  it("Test 4: bloqueo que cubre todo el horario laboral de un día -- ese día no aparece, y nunca se consulta Nylas para él", async () => {
    async function bloqueoTotalMartes(_s: unknown, _profesionalId: number, _idTenant: string, fechaIso: string): Promise<VentanaHoraria[]> {
      if (fechaIso === "2026-09-08") return [ventana("00:00", "23:59", fechaIso)]; // bloqueo general del salón, todo el día
      return [];
    }
    const nylas = nylasPorFecha({ "2026-09-09": ["09:00"] });
    const nylasConGuardia = async (s: unknown, params: { fecha: string; idTenant: string; servicioId: string; especialistaId?: number }) => {
      if (params.fecha === "2026-09-08") throw new Error("NUNCA debía consultarse Nylas para un día completamente bloqueado");
      return nylas.fn(s, params);
    };
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ventanasLaboralesEspecialista: ventanasMary, bloqueosDelDia: bloqueoTotalMartes, listarHorariosDisponiblesPorServicioConNylas: nylasConGuardia, hoyIso: () => HOY },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.ok(!resultado.opciones.some((o) => o.fechaIso === "2026-09-08"), "un día completamente bloqueado nunca debe aparecer");
    assert.ok(resultado.opciones.some((o) => o.fechaIso === "2026-09-09"), "el día siguiente, sin bloqueo, sí debe aparecer");
  });

  it("Test 5/6: día con horario real pero SIN ningún hueco libre en Nylas (agenda llena) no aparece -- solo se muestran días con al menos un slot real", async () => {
    const nylas = nylasPorFecha({
      "2026-09-08": [], // martes -- horario real, pero Nylas no encontró ningún hueco (agenda llena)
      "2026-09-09": ["14:00"], // miércoles -- sí tiene un hueco real
    });
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ventanasLaboralesEspecialista: ventanasMary, bloqueosDelDia: sinBloqueos, listarHorariosDisponiblesPorServicioConNylas: nylas.fn, hoyIso: () => HOY },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.deepEqual(
      resultado.opciones.map((o) => o.fechaIso),
      ["2026-09-09"],
    );
  });

  it("Test 7: nunca más de MAX_DIAS_CANDIDATOS (4), aunque haya disponibilidad real todos los días del horizonte", async () => {
    const porFecha: Record<string, string[]> = {};
    for (let i = 1; i <= HORIZONTE_DIAS_A_EVALUAR; i++) {
      const fecha = new Date(`${HOY}T12:00:00-05:00`);
      fecha.setDate(fecha.getDate() + i);
      const iso = fecha.toISOString().slice(0, 10);
      porFecha[iso] = ["09:00"];
    }
    const nylas = nylasPorFecha(porFecha);
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ventanasLaboralesEspecialista: ventanasMary, bloqueosDelDia: sinBloqueos, listarHorariosDisponiblesPorServicioConNylas: nylas.fn, hoyIso: () => HOY },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.equal(resultado.opciones.length, MAX_DIAS_CANDIDATOS);
    // Nunca sigue evaluando de más una vez alcanzados los 4 -- eficiencia real, no solo el resultado final.
    assert.ok(nylas.llamadas.length <= HORIZONTE_DIAS_A_EVALUAR, "nunca debe exceder el horizonte máximo de evaluación");
  });

  it("Test 8: mapping número -> fechaIso es secuencial y exacto", async () => {
    const nylas = nylasPorFecha({ "2026-09-08": ["09:00"], "2026-09-09": ["10:00"], "2026-09-10": ["11:00"] });
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ventanasLaboralesEspecialista: ventanasMary, bloqueosDelDia: sinBloqueos, listarHorariosDisponiblesPorServicioConNylas: nylas.fn, hoyIso: () => HOY },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.deepEqual(
      resultado.opciones.map((o) => [o.numero, o.fechaIso]),
      [
        [1, "2026-09-08"],
        [2, "2026-09-09"],
        [3, "2026-09-10"],
      ],
    );
  });

  it("sin días con disponibilidad real dentro del horizonte -> lista vacía, nunca inventa ni rompe", async () => {
    const nylas = nylasPorFecha({}); // ningún día tiene huecos reales
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ventanasLaboralesEspecialista: ventanasMary, bloqueosDelDia: sinBloqueos, listarHorariosDisponiblesPorServicioConNylas: nylas.fn, hoyIso: () => HOY },
    );
    assert.deepEqual(resultado, { ok: true, opciones: [], hayMasFechas: false });
  });

  it("servicio_no_encontrado (ej. servicio desactivado mientras tanto) se propaga tal cual, nunca sigue evaluando otros días", async () => {
    let llamadas = 0;
    const nylasError = async (): Promise<ResultadoHorariosConNylas> => {
      llamadas++;
      return { ok: false, motivo: "servicio_no_encontrado", detalle: "x" };
    };
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ventanasLaboralesEspecialista: ventanasMary, bloqueosDelDia: sinBloqueos, listarHorariosDisponiblesPorServicioConNylas: nylasError, hoyIso: () => HOY },
    );
    assert.deepEqual(resultado, { ok: false, motivo: "servicio_no_encontrado" });
    assert.equal(llamadas, 1, "nunca debe seguir probando otros días si el servicio ya no existe");
  });

  it("sin grant/API key de Nylas (tenant sin conexión con el calendario) -> lista vacía, nunca ofrece un día a ciegas", async () => {
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      null,
      { ventanasLaboralesEspecialista: ventanasMary, bloqueosDelDia: sinBloqueos, listarHorariosDisponiblesPorServicioConNylas: nylasNuncaDebeLlamarse, hoyIso: () => HOY },
    );
    assert.deepEqual(resultado, { ok: true, opciones: [], hayMasFechas: false });
  });
});

describe("calcularHorariosParaFecha", () => {
  it("Test 11: fecha con disponibilidad real -> devuelve los horarios reales de ESE profesional", async () => {
    const nylas = nylasPorFecha({ "2026-09-08": ["09:00", "10:30", "14:00"] });
    const resultado = await calcularHorariosParaFecha(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID, fechaIso: "2026-09-08" },
      NYLAS_DEPS_FAKE,
      { listarHorariosDisponiblesPorServicioConNylas: nylas.fn },
    );
    assert.deepEqual(resultado, { ok: true, horarios: ["09:00", "10:30", "14:00"] });
    assert.deepEqual(nylas.llamadas, ["2026-09-08"], "UNA sola consulta para la fecha seleccionada");
  });

  it("Test 18: sin ningún horario real ese día -> ok:false, comportamiento consistente (nunca inventa horarios)", async () => {
    const nylas = nylasPorFecha({ "2026-09-08": [] });
    const resultado = await calcularHorariosParaFecha(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID, fechaIso: "2026-09-08" },
      NYLAS_DEPS_FAKE,
      { listarHorariosDisponiblesPorServicioConNylas: nylas.fn },
    );
    assert.deepEqual(resultado, { ok: false, motivo: "sin_horarios_ese_dia" });
  });

  it("sin grant/API key de Nylas -> ok:false, nunca ofrece un horario a ciegas", async () => {
    const resultado = await calcularHorariosParaFecha(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID, fechaIso: "2026-09-08" },
      null,
    );
    assert.deepEqual(resultado, { ok: false, motivo: "sin_horarios_ese_dia" });
  });

  it("servicio_no_encontrado / sin_especialistas_habilitados se propaga tal cual", async () => {
    const nylasError = async (): Promise<ResultadoHorariosConNylas> => ({ ok: false, motivo: "sin_especialistas_habilitados", detalle: "x" });
    const resultado = await calcularHorariosParaFecha(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID, fechaIso: "2026-09-08" },
      NYLAS_DEPS_FAKE,
      { listarHorariosDisponiblesPorServicioConNylas: nylasError },
    );
    assert.deepEqual(resultado, { ok: false, motivo: "sin_especialistas_habilitados" });
  });
});

describe("CORRECCIÓN (autorizada, 'agendar hoy') -- Test 5 obligatorio: resolución de 'hoy' en la frontera de medianoche UTC (Bogotá va 5h detrás)", () => {
  it("justo DESPUÉS de medianoche UTC, el día real de Bogotá sigue siendo el día ANTERIOR", () => {
    // 2026-09-10T00:30:00Z == 2026-09-09 19:30 America/Bogota (UTC-5) -- el día real de Bogotá es el 9, NUNCA el 10.
    assert.equal(fechaColombiaDesdeIso("2026-09-10T00:30:00.000Z"), "2026-09-09");
  });

  it("justo ANTES de medianoche UTC, sigue siendo el MISMO día de Bogotá", () => {
    // 2026-09-09T23:30:00Z == 2026-09-09 18:30 America/Bogota.
    assert.equal(fechaColombiaDesdeIso("2026-09-09T23:30:00.000Z"), "2026-09-09");
  });

  it("a medianoche EXACTA UTC, el día de Bogotá todavía es el anterior (recién son las 19:00 en Bogotá)", () => {
    assert.equal(fechaColombiaDesdeIso("2026-09-10T00:00:00.000Z"), "2026-09-09");
  });
});

describe("CORRECCIÓN (autorizada, 'Ver más fechas') -- paginación real de fechas candidatas, EXCLUSIVA de S3_DIA", () => {
  const DEPS_BASE = { ventanasLaboralesEspecialista: ventanasMary, bloqueosDelDia: sinBloqueos, hoyIso: () => HOY };

  it("Test 7 (obligatorio) -- con más de 4 fechas reales, opciones se limita a las primeras 4 y hayMasFechas=true", async () => {
    const nylas = nylasPorFecha({
      "2026-09-07": ["09:00"],
      "2026-09-08": ["09:00"],
      "2026-09-09": ["09:00"],
      "2026-09-10": ["09:00"],
      "2026-09-11": ["09:00"], // 5º candidato real -- nunca aparece en `opciones`, solo activa hayMasFechas
    });
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ...DEPS_BASE, listarHorariosDisponiblesPorServicioConNylas: nylas.fn },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.deepEqual(resultado.opciones.map((o) => o.fechaIso), ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"]);
    assert.equal(resultado.hayMasFechas, true);
  });

  it("Test 14 (obligatorio) -- EXACTAMENTE 4 fechas reales y ninguna más -> hayMasFechas=false", async () => {
    const nylas = nylasPorFecha({ "2026-09-07": ["09:00"], "2026-09-08": ["09:00"], "2026-09-09": ["09:00"], "2026-09-10": ["09:00"] });
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ...DEPS_BASE, listarHorariosDisponiblesPorServicioConNylas: nylas.fn },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.deepEqual(resultado.opciones.map((o) => o.fechaIso), ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"]);
    assert.equal(resultado.hayMasFechas, false, "nunca ofrece 'Ver más fechas' si no hay ninguna más dentro del horizonte");
  });

  it("Test 13 (obligatorio, invariante) -- si se encuentran MENOS de 4 fechas reales, es porque el horizonte se agotó -- hayMasFechas SIEMPRE es false en ese caso (nunca 'menos de 4 pero hay más', mecánicamente imposible: la búsqueda nunca se detiene antes de encontrar 4+1 o agotar el horizonte)", async () => {
    const nylas = nylasPorFecha({ "2026-09-07": ["09:00"], "2026-09-08": ["09:00"] }); // solo 2 candidatos reales en TODO el horizonte
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ...DEPS_BASE, listarHorariosDisponiblesPorServicioConNylas: nylas.fn },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.deepEqual(resultado.opciones.map((o) => o.fechaIso), ["2026-09-07", "2026-09-08"], "nunca inventa una 3ª/4ª fecha solo para completar el cupo");
    assert.equal(resultado.hayMasFechas, false, "solo hay 2 candidatos reales en todo el horizonte -- 'Ver más fechas' nunca debe ofrecerse");
  });

  it("Tests 8/9/10/11 (obligatorios) -- 'continuarDesdeFechaIso' arranca DESPUÉS de la última fecha ya mostrada, omite días cerrados/sin disponibilidad, nunca repite, y permite un tercer bloque real", async () => {
    // Bloque 1: 7,8,9,10. Entre bloques: 11 disponible, 12 (sábado) SIN disponibilidad, 13 (domingo) cerrado -- ambos deben omitirse automáticamente. Bloque 2: 11,14,15,16. Bloque 3: 17 (fin real de los datos de este fixture).
    const nylas = nylasPorFecha({
      "2026-09-07": ["09:00"],
      "2026-09-08": ["09:00"],
      "2026-09-09": ["09:00"],
      "2026-09-10": ["09:00"],
      "2026-09-11": ["09:00"],
      "2026-09-14": ["09:00"],
      "2026-09-15": ["09:00"],
      "2026-09-16": ["09:00"],
      "2026-09-17": ["09:00"],
    });
    const deps = { ...DEPS_BASE, listarHorariosDisponiblesPorServicioConNylas: nylas.fn };

    const bloque1 = await calcularDiasCandidatosReales(FAKE_SUPABASE, { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID }, NYLAS_DEPS_FAKE, deps);
    assert.equal(bloque1.ok, true);
    if (!bloque1.ok) return;
    assert.deepEqual(bloque1.opciones.map((o) => o.fechaIso), ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"]);
    assert.equal(bloque1.hayMasFechas, true);

    const bloque2 = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID, continuarDesdeFechaIso: bloque1.opciones.at(-1)!.fechaIso },
      NYLAS_DEPS_FAKE,
      deps,
    );
    assert.equal(bloque2.ok, true);
    if (!bloque2.ok) return;
    // Test 11 -- 12 (sábado, sin disponibilidad real) y 13 (domingo, cerrado) se omiten automáticamente, nunca aparecen ni rompen la búsqueda.
    assert.deepEqual(bloque2.opciones.map((o) => o.fechaIso), ["2026-09-11", "2026-09-14", "2026-09-15", "2026-09-16"]);
    assert.equal(bloque2.hayMasFechas, true);
    // Test 9 -- sin duplicados entre bloques.
    const todas = [...bloque1.opciones, ...bloque2.opciones].map((o) => o.fechaIso);
    assert.equal(new Set(todas).size, todas.length, "ninguna fecha se repite entre el primer y el segundo bloque");

    // Test 10 -- un tercer bloque continúa DESPUÉS del segundo, nunca reinicia desde hoy.
    const bloque3 = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID, continuarDesdeFechaIso: bloque2.opciones.at(-1)!.fechaIso },
      NYLAS_DEPS_FAKE,
      deps,
    );
    assert.equal(bloque3.ok, true);
    if (!bloque3.ok) return;
    assert.deepEqual(bloque3.opciones.map((o) => o.fechaIso), ["2026-09-17"]);
  });

  it("Test 12 (obligatorio) -- fin del horizonte real (14 días desde hoy) -> hayMasFechas=false, nunca sigue buscando más allá", async () => {
    // offset 14 desde HOY (2026-09-07) = 2026-09-21 -- el último día real que este cálculo evalúa.
    const nylas = nylasPorFecha({ "2026-09-21": ["09:00"] });
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID },
      NYLAS_DEPS_FAKE,
      { ...DEPS_BASE, listarHorariosDisponiblesPorServicioConNylas: nylas.fn },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.deepEqual(resultado.opciones.map((o) => o.fechaIso), ["2026-09-21"]);
    assert.equal(resultado.hayMasFechas, false, "nunca amplía el horizonte de 14 días para seguir buscando");
  });

  it("regresión -- el horizonte total NUNCA se amplía por 'continuarDesdeFechaIso' (se mide siempre desde HOY, no desde el cursor)", async () => {
    // Continuar desde una fecha ya muy cerca del final del horizonte (offset 12) -- 2026-09-21 (offset 14) sigue siendo el último día real evaluado, nunca más allá.
    const nylas = nylasPorFecha({ "2026-09-21": ["09:00"], "2026-09-23": ["09:00"] }); // 23 = offset 16, MÁS ALLÁ del horizonte -- nunca debe evaluarse
    const resultado = await calcularDiasCandidatosReales(
      FAKE_SUPABASE,
      { idTenant: TENANT, servicioId: SERVICIO_ID, profesionalId: PROFESIONAL_ID, continuarDesdeFechaIso: "2026-09-19" },
      NYLAS_DEPS_FAKE,
      { ...DEPS_BASE, listarHorariosDisponiblesPorServicioConNylas: nylas.fn },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.deepEqual(resultado.opciones.map((o) => o.fechaIso), ["2026-09-21"]);
    assert.equal(resultado.hayMasFechas, false, "2026-09-23 está fuera del horizonte total de 14 días desde HOY -- nunca se evalúa ni se ofrece");
  });
});
