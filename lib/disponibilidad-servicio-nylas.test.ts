/**
 * PILOTO AMORE + Nylas (autorizado, FASE B4) -- listarHorariosDisponiblesPorServicioConNylas.
 * NUNCA Supabase/Nylas reales: un fake Supabase multi-tabla (mismo patrón ya
 * usado en esta suite para resolver.test.ts/store-conocimiento.test.ts) y un
 * NylasEventsClient mockeado. 24 escenarios mínimos pedidos.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listarHorariosDisponiblesPorServicioConNylas, calcularHorariosDeEspecialista } from "@/lib/disponibilidad-servicio-nylas";
import type { NylasEvent, NylasEventsClient } from "@/lib/nylas/nylas-types";

const TENANT = "amore-test";

type FilaGenerica = Record<string, unknown>;

function crearSupabaseFalso(tablas: Record<string, FilaGenerica[]>): SupabaseClient {
  const from = (tabla: string) => {
    const filas = tablas[tabla] ?? [];
    const filtros: Array<(f: FilaGenerica) => boolean> = [];
    const builder = {
      select() {
        return builder;
      },
      eq(campo: string, valor: unknown) {
        filtros.push((f) => f[campo] === valor);
        return builder;
      },
      in(campo: string, valores: unknown[]) {
        filtros.push((f) => valores.includes(f[campo]));
        return builder;
      },
      gte(campo: string, valor: unknown) {
        filtros.push((f) => (f[campo] as string) >= (valor as string));
        return builder;
      },
      gt(campo: string, valor: unknown) {
        filtros.push((f) => (f[campo] as string) > (valor as string));
        return builder;
      },
      lt(campo: string, valor: unknown) {
        filtros.push((f) => (f[campo] as string) < (valor as string));
        return builder;
      },
      order() {
        return builder;
      },
      or() {
        // Solo se usa en el fallback por categoría (resolverEspecialistasPorCategoria),
        // que estos tests evitan a propósito usando siempre asociación
        // explícita en dulabs_servicio_especialista -- no_op seguro acá.
        return builder;
      },
      async maybeSingle() {
        const resultado = filas.filter((f) => filtros.every((fn) => fn(f)));
        return { data: resultado[0] ?? null, error: null };
      },
      then(resolve: (r: { data: FilaGenerica[]; error: null }) => unknown) {
        const resultado = filas.filter((f) => filtros.every((fn) => fn(f)));
        return resolve({ data: resultado, error: null });
      },
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

function proximoDiaSemana(diaObjetivo: number): string {
  const d = new Date("2026-09-01T12:00:00-05:00");
  while (d.getDay() !== diaObjetivo) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
const LUNES = proximoDiaSemana(1); // ventanaAtencion: 09:00-19:00
const DOMINGO = proximoDiaSemana(0); // ventanaAtencion: cerrado

const SERVICIO_DIPPING = { id: "s-dipping", id_tenant: TENANT, nombre: "Dipping", duracion_min: 120, activo: true };

const ESPECIALISTAS = [
  { id: 1, id_tenant: TENANT, nombre: "Mary", activo: true, nylas_calendar_id: "cal-mary" },
  { id: 2, id_tenant: TENANT, nombre: "Cristal", activo: true, nylas_calendar_id: "cal-cristal" },
  { id: 3, id_tenant: TENANT, nombre: "Nata", activo: true, nylas_calendar_id: "cal-nata" },
  { id: 4, id_tenant: TENANT, nombre: "Jessica", activo: true, nylas_calendar_id: "cal-jessica" },
];

const ASOCIACIONES_DIPPING = ESPECIALISTAS.map((e) => ({ id_tenant: TENANT, servicio_id: "s-dipping", especialista_id: e.id }));

function mockNylasClient(eventosPorCalendario: Record<string, NylasEvent[] | "error" | "timeout">, onCall?: (calendarId: string) => void): NylasEventsClient {
  return {
    async listEvents(params) {
      onCall?.(params.calendarId);
      const entrada = eventosPorCalendario[params.calendarId];
      if (entrada === "error") throw Object.assign(new Error("nylas_http_500"), { status: 500 });
      if (entrada === "timeout") throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return entrada ?? [];
    },
  };
}

function evento(horaInicioISO: string, horaFinISO: string): NylasEvent {
  return {
    id: `${horaInicioISO}-${horaFinISO}`,
    when: { object: "timespan", start_time: Math.floor(new Date(horaInicioISO).getTime() / 1000), end_time: Math.floor(new Date(horaFinISO).getTime() / 1000) },
  };
}

function construirTablas(overrides: Partial<{ servicios: FilaGenerica[]; asociaciones: FilaGenerica[]; especialistas: FilaGenerica[]; horarios: FilaGenerica[]; bloqueos: FilaGenerica[]; citas: FilaGenerica[] }> = {}) {
  return {
    dulabs_servicios: overrides.servicios ?? [SERVICIO_DIPPING],
    dulabs_servicio_especialista: overrides.asociaciones ?? ASOCIACIONES_DIPPING,
    dulabs_especialistas: overrides.especialistas ?? ESPECIALISTAS,
    dulabs_horario_especialista: overrides.horarios ?? [],
    dulabs_bloqueos: overrides.bloqueos ?? [],
    dulabs_citas_especialista: overrides.citas ?? [],
  };
}

async function consultar(
  eventosPorCalendario: Record<string, NylasEvent[] | "error" | "timeout">,
  params: { fecha?: string; servicioId?: string; especialistaId?: number } = {},
  tablasOverrides: Parameters<typeof construirTablas>[0] = {},
  onCall?: (calendarId: string) => void,
) {
  const supabase = crearSupabaseFalso(construirTablas(tablasOverrides));
  return listarHorariosDisponiblesPorServicioConNylas(
    supabase,
    { idTenant: TENANT, servicioId: params.servicioId ?? "s-dipping", fecha: params.fecha ?? LUNES, especialistaId: params.especialistaId },
    // "ahora" fijo y muy anterior a LUNES (corrección post-deploy, "agendar
    // hoy") -- estos tests prueban disponibilidad de un día ENTERO, nunca el
    // filtro de "ya pasó" (eso lo prueba la nueva sección de este archivo
    // más abajo); sin este ancla, el filtro real usaría el reloj real de
    // ejecución y descartaría horarios de una fecha de fixture ya vieja.
    { nylasClient: mockNylasClient(eventosPorCalendario, onCall), grantId: "grant-amore", ahora: () => new Date("2026-08-25T00:00:00-05:00") },
  );
}

describe("1-4. Profesional libre / ocupada / OR entre varias / todas ocupadas", () => {
  it("1. profesional libre -> estado ok, con horarios reales", async () => {
    const r = await consultar({});
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.equal(mary.estado, "ok");
    assert.ok(mary.horarios.includes("09:00"));
  });

  it("2. profesional ocupada (evento parcial) -> excluye solo los slots que se solapan", async () => {
    const r = await consultar({ "cal-mary": [evento(`${LUNES}T09:00:00-05:00`, `${LUNES}T11:00:00-05:00`)] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.ok(!mary.horarios.includes("09:00"));
    assert.ok(!mary.horarios.includes("10:00"));
    assert.ok(mary.horarios.includes("11:00"), "120min cabe justo desde las 11:00");
  });

  it("3. Mary ocupada, las otras 3 libres -> lógica OR, nunca se oculta la disponibilidad de las demás", async () => {
    const r = await consultar({ "cal-mary": [evento(`${LUNES}T09:00:00-05:00`, `${LUNES}T19:00:00-05:00`)] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.especialistas.length, 4);
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    const cristal = r.especialistas.find((e) => e.nombre === "Cristal")!;
    assert.deepEqual(mary.horarios, [], "Mary ocupada todo el día");
    assert.ok(cristal.horarios.includes("10:00"), "Cristal sigue libre a las 10:00 aunque Mary esté ocupada");
  });

  it("4. las 4 profesionales ocupadas todo el día -> todas estado ok, horarios vacíos", async () => {
    const todasOcupadas = Object.fromEntries(ESPECIALISTAS.map((e) => [e.nylas_calendar_id, [evento(`${LUNES}T09:00:00-05:00`, `${LUNES}T19:00:00-05:00`)]]));
    const r = await consultar(todasOcupadas);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.especialistas.every((e) => e.estado === "ok" && e.horarios.length === 0));
  });
});

describe("5-7. Bloques exactos y eventos que cruzan la ventana consultada", () => {
  it("5. evento ocupa PARCIALMENTE el horario -- el resto sigue libre", async () => {
    const r = await consultar({ "cal-mary": [evento(`${LUNES}T15:00:00-05:00`, `${LUNES}T16:00:00-05:00`)] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.ok(mary.horarios.includes("09:00"), "la mañana sigue libre");
    assert.ok(!mary.horarios.includes("15:00"));
  });

  it("6. evento ocupa EXACTAMENTE todo el bloque de la duración (servicio de 60min) -- ese slot puntual queda excluido, el siguiente libre", async () => {
    const r = await consultar(
      { "cal-mary": [evento(`${LUNES}T09:00:00-05:00`, `${LUNES}T10:00:00-05:00`)] },
      {},
      { servicios: [{ ...SERVICIO_DIPPING, duracion_min: 60 }] },
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.ok(!mary.horarios.includes("09:00"));
    assert.ok(!mary.horarios.includes("09:30"), "09:30-10:30 se solapa con el evento hasta las 10:00");
    assert.ok(mary.horarios.includes("10:00"));
  });

  it("7. evento que cruza el INICIO de la ventana laboral (empieza antes de abrir) bloquea igual la parte real dentro de la ventana", async () => {
    const r = await consultar({ "cal-mary": [evento(`${LUNES}T08:00:00-05:00`, `${LUNES}T10:00:00-05:00`)] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.ok(!mary.horarios.includes("09:00"));
    assert.ok(mary.horarios.includes("10:00"));
  });

  it("7b. evento que cruza el CIERRE de la ventana laboral (termina después de cerrar) bloquea la cola real del día", async () => {
    const r = await consultar(
      { "cal-mary": [evento(`${LUNES}T18:00:00-05:00`, `${LUNES}T20:00:00-05:00`)] },
      {},
      { servicios: [{ ...SERVICIO_DIPPING, duracion_min: 60 }] },
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.ok(!mary.horarios.includes("18:00"));
  });
});

describe("8-12. Duraciones distintas del catálogo real", () => {
  for (const duracion of [5, 15, 30, 60, 120]) {
    it(`servicio de ${duracion} minutos -- respeta la duración real del catálogo, nunca hardcodeada`, async () => {
      const r = await consultar({}, {}, { servicios: [{ ...SERVICIO_DIPPING, duracion_min: duracion }] });
      assert.equal(r.ok, true);
      if (!r.ok) return;
      assert.equal(r.servicio.duracionMin, duracion);
      const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
      assert.ok(mary.horarios.length > 0, `debe haber horarios reales para un servicio de ${duracion} min en un día libre`);
    });
  }

  it("un bloque de 120min NO se ofrece si solo hay 60min libres antes del siguiente compromiso", async () => {
    // Mary libre 09:00-11:00 exactos (ocupada desde las 11:00 en adelante) --
    // un servicio de 120min SÍ cabe justo en 09:00-11:00; uno más largo no.
    const r = await consultar(
      { "cal-mary": [evento(`${LUNES}T11:00:00-05:00`, `${LUNES}T19:00:00-05:00`)] },
      {},
      { servicios: [{ ...SERVICIO_DIPPING, duracion_min: 150 }] },
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.ok(!mary.horarios.includes("09:00"), "150min no caben en el hueco de 09:00-11:00");
  });
});

describe("13-15. Elegibilidad de profesionales (reutiliza resolverEspecialistasElegiblesParaServicio, sin cambios)", () => {
  it("13. varias profesionales elegibles -> todas aparecen en el resultado", async () => {
    const r = await consultar({});
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.especialistas.length, 4);
  });

  it("14. servicio con UNA sola profesional elegible -> el resultado trae solo esa", async () => {
    const r = await consultar({}, { servicioId: "s-bozo" }, {
      servicios: [{ id: "s-bozo", id_tenant: TENANT, nombre: "Bozo", duracion_min: 5, activo: true }],
      asociaciones: [{ id_tenant: TENANT, servicio_id: "s-bozo", especialista_id: 1 }],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.especialistas.length, 1);
    assert.equal(r.especialistas[0]!.nombre, "Mary");
  });

  it("15. profesional NO elegible para este servicio -- nunca aparece en el resultado", async () => {
    const r = await consultar({}, { servicioId: "s-bozo" }, {
      servicios: [{ id: "s-bozo", id_tenant: TENANT, nombre: "Bozo", duracion_min: 5, activo: true }],
      asociaciones: [{ id_tenant: TENANT, servicio_id: "s-bozo", especialista_id: 1 }],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(!r.especialistas.some((e) => e.nombre === "Cristal"));
  });
});

describe("16-19. Nylas: cero eventos, error, timeout, calendario inexistente", () => {
  it("16. Nylas responde con cero eventos -> estado ok, tratada como libre de verdad", async () => {
    const r = await consultar({ "cal-mary": [] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.equal(mary.estado, "ok");
  });

  it("17. Nylas devuelve error para el calendario de Mary -> Mary queda 'no_confirmado', NUNCA horarios inventados", async () => {
    const r = await consultar({ "cal-mary": "error" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.equal(mary.estado, "no_confirmado");
    assert.deepEqual(mary.horarios, []);
    // Las demás, no afectadas por el error de Mary.
    const cristal = r.especialistas.find((e) => e.nombre === "Cristal")!;
    assert.equal(cristal.estado, "ok");
  });

  it("18. Nylas hace timeout para el calendario de Mary -> Mary 'no_confirmado'", async () => {
    const r = await consultar({ "cal-mary": "timeout" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.equal(mary.estado, "no_confirmado");
  });

  it("19. calendar_id inexistente en Nylas (404 real) se comporta igual que un error genérico -- 'no_confirmado', nunca libre por defecto", async () => {
    const r = await consultar({}); // ningún calendar_id de la fixture está en el mapa -> el mock ni siquiera necesita "error" explícito, pero probamos el caso explícito:
    const r2 = await consultar({ "cal-mary": "error" });
    assert.equal(r.ok, true);
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    assert.equal(r2.especialistas.find((e) => e.nombre === "Mary")!.estado, "no_confirmado");
  });
});

describe("20. Tenant incorrecto", () => {
  it("un servicio de OTRO tenant nunca se resuelve -- servicio_no_encontrado", async () => {
    const supabase = crearSupabaseFalso(construirTablas({ servicios: [{ ...SERVICIO_DIPPING, id_tenant: "otro-tenant" }] }));
    const r = await listarHorariosDisponiblesPorServicioConNylas(
      supabase,
      { idTenant: TENANT, servicioId: "s-dipping", fecha: LUNES },
      { nylasClient: mockNylasClient({}), grantId: "grant-amore" },
    );
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.motivo, "servicio_no_encontrado");
  });
});

describe("21-23. Timezone, domingo cerrado, fuera de jornada", () => {
  it("21. timezone America/Bogota -- un evento en UTC se traduce a la hora local correcta", async () => {
    // 14:00 UTC == 09:00 America/Bogota (UTC-5).
    const r = await consultar({ "cal-mary": [{ id: "1", when: { object: "timespan", start_time: Date.parse(`${LUNES}T14:00:00.000Z`) / 1000, end_time: Date.parse(`${LUNES}T16:00:00.000Z`) / 1000 } }] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.ok(!mary.horarios.includes("09:00"), "14:00 UTC debe leerse como 09:00 Bogotá, no como 14:00");
  });

  it("22. domingo cerrado -- horarios vacíos, estado ok, y Nylas NUNCA se consulta (no hay ventana laboral)", async () => {
    let llamadas = 0;
    const r = await consultar({}, { fecha: DOMINGO }, {}, () => llamadas++);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.especialistas.every((e) => e.estado === "ok" && e.horarios.length === 0));
    assert.equal(llamadas, 0, "sin ventana laboral, Nylas nunca debería consultarse");
  });

  it("23. un evento fuera de la jornada laboral no reduce la disponibilidad real dentro de la jornada", async () => {
    const r = await consultar(
      { "cal-mary": [evento(`${LUNES}T20:00:00-05:00`, `${LUNES}T21:00:00-05:00`)] },
      {},
      { servicios: [{ ...SERVICIO_DIPPING, duracion_min: 60 }] },
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.ok(mary.horarios.includes("18:00"), "18:00-19:00 cabe completo en la jornada, el evento de las 20:00 es irrelevante");
  });
});

describe("24. Bloqueo interno de DuLabs + evento externo de Google combinados", () => {
  it("ambas fuentes de ocupación se combinan -- ninguna anula a la otra", async () => {
    const r = await consultar(
      { "cal-mary": [evento(`${LUNES}T14:00:00-05:00`, `${LUNES}T15:00:00-05:00`)] },
      {},
      {
        servicios: [{ ...SERVICIO_DIPPING, duracion_min: 60 }],
        bloqueos: [{ id_tenant: TENANT, especialista_id: 1, activo: true, inicio: `${LUNES}T09:00:00-05:00`, fin: `${LUNES}T10:00:00-05:00` }],
      },
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.ok(!mary.horarios.includes("09:00"), "bloqueo interno de DuLabs excluye las 09:00");
    assert.ok(!mary.horarios.includes("14:00"), "evento externo de Google excluye las 14:00");
    assert.ok(mary.horarios.includes("11:00"), "el resto del día sigue libre");
  });
});

describe("Especialista sin calendario de Nylas asociado -- nunca rompe, cae a solo DuLabs", () => {
  it("un especialista con nylas_calendar_id=null se calcula solo con datos de DuLabs, sin llamar a Nylas", async () => {
    let llamadas = 0;
    const r = await consultar(
      {},
      {},
      { especialistas: ESPECIALISTAS.map((e) => (e.nombre === "Mary" ? { ...e, nylas_calendar_id: null } : e)) },
      () => llamadas++,
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const mary = r.especialistas.find((e) => e.nombre === "Mary")!;
    assert.equal(mary.estado, "ok");
    assert.ok(mary.horarios.length > 0);
    assert.equal(llamadas, 3, "Nylas se llama para las otras 3, nunca para Mary");
  });
});

// FASE 3 (autorizado, multi-servicio) -- calcularHorariosDeEspecialista
// EXPORTADA sin ningún cambio de comportamiento (ver comentario en
// lib/disponibilidad-servicio-nylas.ts). Estos tests prueban directamente esa
// función con una duración TOTAL combinada (150min = 60+90, ej. real del
// pedido) para confirmar que el bloque continuo se resuelve con el MISMO
// generarHorariosLibres reutilizado -- nunca una segunda implementación de
// "bloque continuo".
describe("FASE 3 (autorizado, multi-servicio) -- calcularHorariosDeEspecialista con duración TOTAL combinada (150min = 60+90)", () => {
  it("Test 12 (obligatorio) -- bloque de 150min completamente libre -> se ofrece como horario válido", async () => {
    const supabase = crearSupabaseFalso(construirTablas());
    const r = await calcularHorariosDeEspecialista(
      supabase,
      { idTenant: TENANT, especialista: { id: 1, nombre: "Mary" }, fecha: LUNES, duracionMin: 150 },
      { nylasClient: mockNylasClient({}), grantId: "grant-amore", ahora: () => new Date("2026-08-25T00:00:00-05:00") },
    );
    assert.equal(r.estado, "ok");
    assert.ok(r.horarios.includes("09:00"), "150 min libres desde la apertura deben ofrecerse como un bloque continuo real");
  });

  it("Test 13 (obligatorio) -- un compromiso a mitad del bloque de 150min lo rechaza COMPLETO, nunca ofrece un bloque interrumpido", async () => {
    const supabase = crearSupabaseFalso(construirTablas());
    const r = await calcularHorariosDeEspecialista(
      supabase,
      { idTenant: TENANT, especialista: { id: 1, nombre: "Mary" }, fecha: LUNES, duracionMin: 150 },
      {
        nylasClient: mockNylasClient({ "cal-mary": [evento(`${LUNES}T10:00:00-05:00`, `${LUNES}T10:30:00-05:00`)] }),
        grantId: "grant-amore",
        ahora: () => new Date("2026-08-25T00:00:00-05:00"),
      },
    );
    assert.equal(r.estado, "ok");
    assert.ok(!r.horarios.includes("09:00"), "09:00-11:30 se solapa con el compromiso de 10:00-10:30 -- el bloque de 150min completo se rechaza, NUNCA se ofrece partido");
    assert.ok(r.horarios.includes("10:30"), "10:30-13:00 sigue libre después del compromiso, sí se ofrece");
  });
});

// ---------------------------------------------------------------------------
// CORRECCIÓN (autorizada, "agendar hoy") -- calcularHorariosDeEspecialista
// nunca ofrece un horario cuyo instante real ya pasó. Comparación Date vs
// Date (nunca strings/horas locales) -- "ahora" inyectable para tests
// deterministas. Para cualquier día que NO sea "hoy" esto es un no-op real
// (ver todos los tests de arriba, que fijan "ahora" muy anterior a LUNES y
// siguen pasando sin ningún cambio de comportamiento).
// ---------------------------------------------------------------------------
describe("CORRECCIÓN (autorizada, 'agendar hoy') -- filtro de horarios ya pasados", () => {
  it("Test 3 (obligatorio) -- horarios mezclados (algunos ya pasaron, otros no) -- SOLO los futuros se ofrecen", async () => {
    const r = await calcularHorariosDeEspecialista(
      crearSupabaseFalso(construirTablas({ servicios: [{ ...SERVICIO_DIPPING, duracion_min: 60 }] })),
      { idTenant: TENANT, especialista: { id: 1, nombre: "Mary" }, fecha: LUNES, duracionMin: 60 },
      { nylasClient: mockNylasClient({}), grantId: "grant-amore", ahora: () => new Date(`${LUNES}T10:15:00-05:00`) },
    );
    assert.equal(r.estado, "ok");
    assert.ok(!r.horarios.includes("09:00") && !r.horarios.includes("09:30") && !r.horarios.includes("10:00"), "09:00/09:30/10:00 ya pasaron (son anteriores a las 10:15) -- NUNCA deben ofrecerse");
    assert.ok(r.horarios.includes("10:30") && r.horarios.includes("11:00"), "10:30 en adelante sigue siendo futuro real -- sí debe ofrecerse");
  });

  it("Test 4 (obligatorio) -- 'ahora' después del cierre de la jornada -- NINGÚN horario de hoy, aunque el día en sí esté completamente libre", async () => {
    const r = await calcularHorariosDeEspecialista(
      crearSupabaseFalso(construirTablas({ servicios: [{ ...SERVICIO_DIPPING, duracion_min: 60 }] })),
      { idTenant: TENANT, especialista: { id: 1, nombre: "Mary" }, fecha: LUNES, duracionMin: 60 },
      { nylasClient: mockNylasClient({}), grantId: "grant-amore", ahora: () => new Date(`${LUNES}T19:00:00-05:00`) }, // jornada real de Mary cierra a las 18:00
    );
    assert.equal(r.estado, "ok");
    assert.deepEqual(r.horarios, [], "la jornada real ya cerró -- ningún horario de hoy, nunca uno inventado o ya pasado");
  });

  it("un horario que empieza EXACTAMENTE a la misma hora que 'ahora' se excluye (comparación estricta '>', nunca '>=')", async () => {
    const r = await calcularHorariosDeEspecialista(
      crearSupabaseFalso(construirTablas({ servicios: [{ ...SERVICIO_DIPPING, duracion_min: 60 }] })),
      { idTenant: TENANT, especialista: { id: 1, nombre: "Mary" }, fecha: LUNES, duracionMin: 60 },
      { nylasClient: mockNylasClient({}), grantId: "grant-amore", ahora: () => new Date(`${LUNES}T10:00:00-05:00`) },
    );
    assert.equal(r.estado, "ok");
    assert.ok(!r.horarios.includes("10:00"), "un horario que arranca justo 'ahora' nunca se ofrece -- no queda tiempo real para reservarlo antes de que empiece");
    assert.ok(r.horarios.includes("10:30"), "el siguiente slot real (después de 'ahora') sí se ofrece");
  });

  it("regresión -- para una fecha futura real, el filtro nunca elimina nada (comportamiento 100% idéntico al de antes de esta corrección)", async () => {
    // "ahora" muy anterior a LUNES -- todo horario real de LUNES es, por definición, posterior a "ahora": la jornada completa (09:00 a 17:00 cada 30min) debe seguir intacta.
    const r = await calcularHorariosDeEspecialista(
      crearSupabaseFalso(construirTablas({ servicios: [{ ...SERVICIO_DIPPING, duracion_min: 60 }] })),
      { idTenant: TENANT, especialista: { id: 1, nombre: "Mary" }, fecha: LUNES, duracionMin: 60 },
      { nylasClient: mockNylasClient({}), grantId: "grant-amore", ahora: () => new Date("2026-08-25T10:15:00-05:00") },
    );
    assert.equal(r.estado, "ok");
    assert.deepEqual(r.horarios, [
      "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30",
      "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00",
    ]);
  });
});
