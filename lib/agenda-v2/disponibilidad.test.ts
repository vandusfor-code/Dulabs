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
    assert.deepEqual(resultado, { ok: true, opciones: [] });
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
    assert.deepEqual(resultado, { ok: true, opciones: [] });
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
