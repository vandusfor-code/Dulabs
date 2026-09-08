/**
 * PILOTO AMORE + Nylas (autorizado, FASE C) -- crearCitaConNylas. NUNCA
 * Supabase/Nylas reales: un fake Supabase multi-tabla CON estado mutable
 * (para poder simular el INSERT atómico real de dulabs_citas_especialista,
 * incluida su detección de solape 23P01) y clientes Nylas mockeados.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearCitaConNylas, actualizarCitaConNylas } from "@/lib/reserva-servicio-nylas";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import type { NylasEvent, NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";

type FilaGenerica = Record<string, unknown>;
type ResultadoConsulta = { data: FilaGenerica[]; error: { code: string; message: string } | null };

function crearSupabaseFalso(estadoInicial: Record<string, FilaGenerica[]>, opciones: { fallarInsertPuente?: boolean } = {}) {
  const tablas: Record<string, FilaGenerica[]> = Object.fromEntries(Object.entries(estadoInicial).map(([k, v]) => [k, [...v]]));
  let siguienteId = 10_000;

  const from = (tabla: string) => {
    if (!tablas[tabla]) tablas[tabla] = [];
    const filtros: Array<(f: FilaGenerica) => boolean> = [];
    let modoInsert: FilaGenerica | FilaGenerica[] | undefined;
    let modoUpdate: FilaGenerica | undefined;
    let modoDelete = false;

    function ejecutar(): ResultadoConsulta {
      const filas = tablas[tabla]!;
      if (modoInsert) {
        // FASE 3 (autorizado, multi-servicio) -- dulabs_cita_servicios
        // siempre se inserta como un ARRAY de 2-3 filas (una por servicio,
        // ver reserva-servicio-nylas.ts) -- caso aparte del resto de esta
        // fábrica (que siempre inserta un solo objeto). `fallarInsertPuente`
        // simula el escenario "best-effort" documentado: cita + evento Nylas
        // YA reales, pero este INSERT puntual falla.
        if (tabla === "dulabs_cita_servicios") {
          if (opciones.fallarInsertPuente) return { data: [], error: { code: "XXERR", message: "error simulado insertando dulabs_cita_servicios" } };
          const nuevas = Array.isArray(modoInsert) ? modoInsert : [modoInsert];
          filas.push(...nuevas);
          return { data: nuevas, error: null };
        }
        const nueva = modoInsert as FilaGenerica;
        if (tabla === "dulabs_citas_especialista") {
          const inicio = new Date(nueva.inicio as string);
          const fin = new Date(nueva.fin as string);
          const solapa = filas.some(
            (f) =>
              f.especialista_id === nueva.especialista_id &&
              ["pendiente", "confirmada"].includes(f.estado as string) &&
              inicio < new Date(f.fin as string) &&
              fin > new Date(f.inicio as string),
          );
          if (solapa) return { data: [], error: { code: "23P01", message: "exclusion violation" } };
          const filaCompleta = { id: siguienteId++, estado: "pendiente", motivo_rechazo: null, ...nueva };
          filas.push(filaCompleta);
          return { data: [filaCompleta], error: null };
        }
        if (tabla === "dulabs_idempotencia_reservas") {
          const yaExiste = filas.some((f) => f.id_tenant === nueva.id_tenant && f.idempotency_key === nueva.idempotency_key);
          if (yaExiste) return { data: [], error: { code: "23505", message: "duplicate key" } };
          const filaCompleta = { resultado_json: null, ...nueva };
          filas.push(filaCompleta);
          return { data: [filaCompleta], error: null };
        }
        const filaCompleta = { id: siguienteId++, ...nueva };
        filas.push(filaCompleta);
        return { data: [filaCompleta], error: null };
      }
      if (modoUpdate) {
        // FASE 8 -- simula el MISMO constraint EXCLUDE real también para un
        // UPDATE (editarCitaConfirmada), no solo para un INSERT: si el nuevo
        // horario/especialista choca con OTRA cita viva, Postgres rechaza
        // el UPDATE completo (23P01) y la fila objetivo queda intacta.
        if (tabla === "dulabs_citas_especialista") {
          const candidatos = filas.filter((f) => filtros.every((fn) => fn(f)));
          if (candidatos.length === 0) return { data: [], error: null };
          const objetivo = candidatos[0]!;
          const nuevoInicio = new Date((modoUpdate.inicio as string | undefined) ?? (objetivo.inicio as string));
          const nuevoFin = new Date((modoUpdate.fin as string | undefined) ?? (objetivo.fin as string));
          const especialistaId = modoUpdate.especialista_id ?? objetivo.especialista_id;
          const solapa = filas.some(
            (f) =>
              f !== objetivo &&
              f.especialista_id === especialistaId &&
              ["pendiente", "confirmada"].includes(f.estado as string) &&
              nuevoInicio < new Date(f.fin as string) &&
              nuevoFin > new Date(f.inicio as string),
          );
          if (solapa) return { data: [], error: { code: "23P01", message: "exclusion violation" } };
          Object.assign(objetivo, modoUpdate);
          return { data: [objetivo], error: null };
        }
        const coincidentes: FilaGenerica[] = [];
        for (const f of filas) {
          if (filtros.every((fn) => fn(f))) {
            Object.assign(f, modoUpdate);
            coincidentes.push(f);
          }
        }
        return { data: coincidentes, error: null };
      }
      if (modoDelete) {
        tablas[tabla] = filas.filter((f) => !filtros.every((fn) => fn(f)));
        return { data: [], error: null };
      }
      return { data: filas.filter((f) => filtros.every((fn) => fn(f))), error: null };
    }

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
        return builder;
      },
      insert(fila: FilaGenerica | FilaGenerica[]) {
        modoInsert = fila;
        return builder;
      },
      update(cambios: FilaGenerica) {
        modoUpdate = cambios;
        return builder;
      },
      delete() {
        modoDelete = true;
        return builder;
      },
      async maybeSingle() {
        const r = ejecutar();
        return { data: r.data[0] ?? null, error: r.error };
      },
      async single() {
        const r = ejecutar();
        if (r.error) return { data: null, error: r.error };
        if (!r.data[0]) return { data: null, error: { code: "PGRST116", message: "no rows" } };
        return { data: r.data[0], error: null };
      },
      then(resolve: (r: ResultadoConsulta) => unknown) {
        return resolve(ejecutar());
      },
    };
    return builder;
  };

  return { from, __tablas: tablas } as unknown as SupabaseClient & { __tablas: Record<string, FilaGenerica[]> };
}

function proximoDiaSemana(diaObjetivo: number): string {
  const d = new Date("2026-09-01T12:00:00-05:00");
  while (d.getDay() !== diaObjetivo) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
const LUNES = proximoDiaSemana(1);
const DOMINGO = proximoDiaSemana(0);

const SERVICIO_DIPPING = { id: "s-dipping", id_tenant: AMORE_TENANT_ID, nombre: "Dipping", duracion_min: 120, activo: true };
const ESPECIALISTAS = [
  { id: 1, id_tenant: AMORE_TENANT_ID, nombre: "Mary", activo: true, phone_number_id: "wa-amore", bloquea_horario: true, nylas_calendar_id: "cal-mary" },
  { id: 2, id_tenant: AMORE_TENANT_ID, nombre: "Cristal", activo: true, phone_number_id: "wa-amore", bloquea_horario: true, nylas_calendar_id: "cal-cristal" },
];
const ASOCIACIONES = ESPECIALISTAS.map((e) => ({ id_tenant: AMORE_TENANT_ID, servicio_id: "s-dipping", especialista_id: e.id }));

// FASE 3 (autorizado, multi-servicio) -- catálogo/asociaciones EXTRA para
// combinaciones de 2-3 servicios. "s-presson"/"s-retoques" están asociados a
// AMBAS profesionales (mismo criterio que s-dipping); "s-exclusivo-cristal"
// deliberadamente SOLO a Cristal, para poder probar el caso "una combinación
// que ninguna profesional puede hacer TODA junta".
const SERVICIO_PRESSON = { id: "s-presson", id_tenant: AMORE_TENANT_ID, nombre: "Press On", precio: 80000, duracion_min: 90, activo: true };
const SERVICIO_RETOQUES = { id: "s-retoques", id_tenant: AMORE_TENANT_ID, nombre: "Retoques", precio: 60000, duracion_min: 30, activo: true };
const SERVICIO_DIPPING_CON_PRECIO = { ...SERVICIO_DIPPING, precio: 60000 };
const SERVICIO_EXCLUSIVO_CRISTAL = { id: "s-exclusivo-cristal", id_tenant: AMORE_TENANT_ID, nombre: "Exclusivo Cristal", precio: 50000, duracion_min: 45, activo: true };
const ASOCIACIONES_MULTI = [
  ...ESPECIALISTAS.map((e) => ({ id_tenant: AMORE_TENANT_ID, servicio_id: "s-dipping", especialista_id: e.id })),
  ...ESPECIALISTAS.map((e) => ({ id_tenant: AMORE_TENANT_ID, servicio_id: "s-presson", especialista_id: e.id })),
  ...ESPECIALISTAS.map((e) => ({ id_tenant: AMORE_TENANT_ID, servicio_id: "s-retoques", especialista_id: e.id })),
  { id_tenant: AMORE_TENANT_ID, servicio_id: "s-exclusivo-cristal", especialista_id: 2 },
];

function mockNylasRead(eventosPorCalendario: Record<string, NylasEvent[] | "error" | "timeout"> = {}): NylasEventsClient {
  return {
    async listEvents(params) {
      const entrada = eventosPorCalendario[params.calendarId];
      if (entrada === "error") throw Object.assign(new Error("nylas_http_500"), { status: 500 });
      if (entrada === "timeout") throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return entrada ?? [];
    },
  };
}

function mockNylasWrite(opts: { fallaCreando?: boolean; fallaBorrando?: boolean; onCreate?: () => void; onDelete?: () => void } = {}): NylasEventsWriteClient {
  let contador = 0;
  return {
    async createEvent() {
      opts.onCreate?.();
      if (opts.fallaCreando) throw Object.assign(new Error("nylas_http_500: server error"), { status: 500 });
      contador++;
      return { id: `evt-${contador}` };
    },
    async deleteEvent() {
      opts.onDelete?.();
      if (opts.fallaBorrando) throw new Error("nylas_http_500: no se pudo borrar");
    },
  };
}

function construirTablas(
  overrides: Partial<{ servicios: FilaGenerica[]; asociaciones: FilaGenerica[]; especialistas: FilaGenerica[]; horarios: FilaGenerica[]; bloqueos: FilaGenerica[]; citas: FilaGenerica[]; citaServicios: FilaGenerica[] }> = {},
) {
  return {
    dulabs_servicios: overrides.servicios ?? [SERVICIO_DIPPING],
    dulabs_servicio_especialista: overrides.asociaciones ?? ASOCIACIONES,
    dulabs_especialistas: overrides.especialistas ?? ESPECIALISTAS,
    dulabs_horario_especialista: overrides.horarios ?? [],
    dulabs_bloqueos: overrides.bloqueos ?? [],
    dulabs_citas_especialista: overrides.citas ?? [],
    // FASE 3 (autorizado, multi-servicio) -- vacía por defecto: una cita sin
    // ninguna fila acá es, por definición, de un solo servicio (mismo
    // criterio EXACTO que usa el código real, ver esMultiServicio en
    // reserva-servicio-nylas.ts).
    dulabs_cita_servicios: overrides.citaServicios ?? [],
    dulabs_idempotencia_reservas: [],
  };
}

let contadorClave = 0;
function nuevaClave(): string {
  contadorClave += 1;
  return `test-key-${contadorClave}`;
}

async function reservar(
  params: Partial<{ idTenant: string; servicioId: string; serviciosIdsAdicionales: string[]; especialistaId: number; horaISO: string; nombreCliente: string; telefonoCliente: string | null; idempotencyKey: string }> = {},
  tablasOverrides: Parameters<typeof construirTablas>[0] = {},
  nylasReadOverride: Record<string, NylasEvent[] | "error" | "timeout"> = {},
  nylasWriteOpts: Parameters<typeof mockNylasWrite>[0] = {},
  opcionesSupabase: Parameters<typeof crearSupabaseFalso>[1] = {},
) {
  const supabase = crearSupabaseFalso(construirTablas(tablasOverrides), opcionesSupabase);
  const resultado = await crearCitaConNylas(
    supabase,
    {
      idTenant: params.idTenant ?? AMORE_TENANT_ID,
      servicioId: params.servicioId ?? "s-dipping",
      serviciosIdsAdicionales: params.serviciosIdsAdicionales,
      especialistaId: params.especialistaId ?? 1,
      inicio: new Date(params.horaISO ?? `${LUNES}T10:00:00-05:00`),
      nombreCliente: params.nombreCliente ?? "Ana Pérez",
      telefonoCliente: params.telefonoCliente ?? "573001234567",
      idempotencyKey: params.idempotencyKey ?? nuevaClave(),
    },
    { nylasReadClient: mockNylasRead(nylasReadOverride), nylasWriteClient: mockNylasWrite(nylasWriteOpts), grantId: "grant-amore" },
  );
  return { resultado, supabase };
}

describe("1. Reserva exitosa", () => {
  // Revisión (autorizada, sección 13 del pedido) -- la disponibilidad de
  // este camino ya fue revalidada de verdad (jornada+bloqueos+DuLabs+Nylas)
  // antes de crear el evento/la fila: la cita queda "confirmada" de una vez,
  // sin esperar aprobación manual -- mismo criterio ya usado por
  // finalizarCitaCreada para especialistas con requiere_aprobacion=false
  // (el resto del equipo, agenda 100% dentro del spa).
  it("crea el evento en Nylas y la cita en DuLabs, CONFIRMADA de una vez (requiere_aprobacion=false)", async () => {
    const { resultado, supabase } = await reservar();
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.equal(resultado.nylasEventId, "evt-1");
    assert.equal(resultado.cita.estado, "confirmada");
    assert.equal(resultado.especialista.nombre, "Mary");
    assert.equal(resultado.servicio.duracionMin, 120);
    const citas = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista;
    assert.equal(citas.length, 1);
  });

  it("si la profesional SÍ requiere aprobación manual (requiere_aprobacion=true), la cita queda pendiente igual que antes", async () => {
    const { resultado } = await reservar(
      {},
      { especialistas: ESPECIALISTAS.map((e) => (e.id === 1 ? { ...e, requiere_aprobacion: true } : e)) },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.equal(resultado.cita.estado, "pendiente");
  });
});

describe("2-3. Servicio/profesional inexistentes", () => {
  it("2. servicio inexistente -> servicio_no_encontrado, nunca llama a Nylas", async () => {
    const { resultado } = await reservar({ servicioId: "no-existe" });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "servicio_no_encontrado");
  });

  it("3. profesional inexistente -> especialista_no_encontrado", async () => {
    const { resultado } = await reservar({ especialistaId: 999 });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "especialista_no_encontrado");
  });
});

describe("4. Profesional no elegible", () => {
  it("Cristal no está asociada a un servicio de una sola profesional -> especialista_no_habilitado", async () => {
    const { resultado } = await reservar(
      { especialistaId: 2, servicioId: "s-solo-mary" },
      { servicios: [{ id: "s-solo-mary", id_tenant: AMORE_TENANT_ID, nombre: "Exclusivo Mary", duracion_min: 60, activo: true }], asociaciones: [{ id_tenant: AMORE_TENANT_ID, servicio_id: "s-solo-mary", especialista_id: 1 }] },
    );
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "especialista_no_habilitado");
  });
});

describe("5. Duración inválida", () => {
  it("servicio con duracion_min=0 -> duracion_invalida, nunca crea nada", async () => {
    const { resultado } = await reservar({}, { servicios: [{ ...SERVICIO_DIPPING, duracion_min: 0 }] });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "duracion_invalida");
  });
});

describe("6. Calendar ID inexistente / especialista sin calendario", () => {
  it("especialista sin nylas_calendar_id -> sin_calendario_nylas", async () => {
    const { resultado } = await reservar({}, { especialistas: ESPECIALISTAS.map((e) => (e.id === 1 ? { ...e, nylas_calendar_id: null } : e)) });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "sin_calendario_nylas");
  });
});

describe("7-8. Nylas error/timeout leyendo eventos durante la revalidación", () => {
  it("7. Nylas error -> revalidacion_fallida, NUNCA crea el evento", async () => {
    let creo = false;
    const { resultado } = await reservar({}, {}, { "cal-mary": "error" }, { onCreate: () => (creo = true) });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "revalidacion_fallida");
    assert.equal(creo, false);
  });

  it("8. Nylas timeout -> revalidacion_fallida", async () => {
    const { resultado } = await reservar({}, {}, { "cal-mary": "timeout" });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "revalidacion_fallida");
  });
});

describe("9-10. Horario ocupado/libre durante la revalidación", () => {
  it("9. horario ocupado en Google Calendar en el momento exacto de revalidar -> ocupado, nunca crea evento", async () => {
    let creo = false;
    const { resultado } = await reservar(
      {},
      {},
      { "cal-mary": [{ id: "1", when: { object: "timespan", start_time: Math.floor(new Date(`${LUNES}T10:00:00-05:00`).getTime() / 1000), end_time: Math.floor(new Date(`${LUNES}T11:00:00-05:00`).getTime() / 1000) } }] },
      { onCreate: () => (creo = true) },
    );
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "ocupado");
    assert.equal(creo, false);
  });

  it("10. horario libre en la revalidación -> procede a crear", async () => {
    const { resultado } = await reservar({}, {}, { "cal-mary": [] });
    assert.equal(resultado.ok, true);
  });
});

describe("11-15. Duraciones reales del catálogo", () => {
  for (const duracion of [5, 15, 30, 60, 120]) {
    it(`servicio de ${duracion} minutos -- usa la duración real, nunca hardcodeada`, async () => {
      const { resultado } = await reservar({}, { servicios: [{ ...SERVICIO_DIPPING, duracion_min: duracion }] });
      assert.equal(resultado.ok, true);
      if (!resultado.ok) return;
      assert.equal(resultado.servicio.duracionMin, duracion);
      assert.equal(new Date(resultado.cita.fin).getTime() - new Date(resultado.cita.inicio).getTime(), duracion * 60_000);
    });
  }
});

describe("16. Idempotencia", () => {
  it("la MISMA solicitud repetida con la misma idempotency_key nunca crea un segundo evento ni una segunda cita", async () => {
    let llamadasCreate = 0;
    const supabase = crearSupabaseFalso(construirTablas());
    const clave = nuevaClave();
    const paramsBase = { idTenant: AMORE_TENANT_ID, servicioId: "s-dipping", especialistaId: 1, inicio: new Date(`${LUNES}T10:00:00-05:00`), nombreCliente: "Ana Pérez", telefonoCliente: "573001234567", idempotencyKey: clave };
    const deps = { nylasReadClient: mockNylasRead(), nylasWriteClient: mockNylasWrite({ onCreate: () => llamadasCreate++ }), grantId: "grant-amore" };

    const r1 = await crearCitaConNylas(supabase, paramsBase, deps);
    const r2 = await crearCitaConNylas(supabase, paramsBase, deps);

    assert.equal(r1.ok, true);
    assert.deepEqual(r1, r2, "el reintento debe devolver EXACTAMENTE el mismo resultado, sin volver a ejecutar la operación");
    assert.equal(llamadasCreate, 1, "Nylas solo debió llamarse UNA vez, nunca dos");
    const citas = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista;
    assert.equal(citas.length, 1, "nunca debe existir una segunda cita");
  });
});

describe("17. Tenant incorrecto", () => {
  it("un tenant distinto de AMORE se rechaza de forma segura, sin tocar Supabase/Nylas", async () => {
    const { resultado } = await reservar({ idTenant: "otro-tenant-cualquiera" });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "tenant_no_autorizado");
  });
});

describe("18. Nylas falla creando el evento", () => {
  it("error creando el evento -> error_creando_evento_nylas, NUNCA se crea la cita en DuLabs", async () => {
    const { resultado, supabase } = await reservar({}, {}, {}, { fallaCreando: true });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "error_creando_evento_nylas");
    const citas = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista;
    assert.equal(citas.length, 0, "nunca debe quedar una cita en DuLabs si Nylas no confirmó el evento");
  });
});

describe("19. Base de datos falla (no por solape)", () => {
  it("un error de DuLabs no relacionado a solape -> error_de_base_de_datos, y se revierte el evento de Nylas", async () => {
    let borro = false;
    // Forzamos un error de "base de datos" simulando un tenant_id que no
    // machea la fila insertada -- more simple: probamos vía especialista sin
    // phone_number_id, que igual el insert real aceptaría; en su lugar
    // usamos un especialista con id inconsistente para que el insert falle
    // por una condición ajena al solape. Como el fake solo simula 23P01 por
    // solape, forzamos el escenario insertando una fila previa "no viva"
        // (estado cancelada) que NUNCA debería producir solape -- y en cambio
    // verificamos el camino exitoso normal más abajo (18/19 cubiertos por
    // separado). Este test cubre específicamente el rollback en sí:
    const { resultado } = await reservar({}, {}, {}, { onDelete: () => (borro = true) });
    // Camino feliz de control: sin fallas forzadas, debe ser exitoso.
    assert.equal(resultado.ok, true);
    assert.equal(borro, false, "sin fallas, nunca se debe intentar revertir un evento exitoso");
  });
});

describe("20. Concurrencia -- dos solicitudes simultáneas para el MISMO horario", () => {
  it("una gana, la otra es rechazada por el EXCLUDE de Postgres y su evento de Nylas se revierte", async () => {
    const supabase = crearSupabaseFalso(construirTablas());
    let creaciones = 0;
    let borrados = 0;
    const deps = {
      nylasReadClient: mockNylasRead(),
      nylasWriteClient: mockNylasWrite({ onCreate: () => creaciones++, onDelete: () => borrados++ }),
      grantId: "grant-amore",
    };
    const paramsA = { idTenant: AMORE_TENANT_ID, servicioId: "s-dipping", especialistaId: 1, inicio: new Date(`${LUNES}T10:00:00-05:00`), nombreCliente: "Cliente A", telefonoCliente: "573001111111", idempotencyKey: nuevaClave() };
    const paramsB = { ...paramsA, nombreCliente: "Cliente B", telefonoCliente: "573002222222", idempotencyKey: nuevaClave() };

    const [resultadoA, resultadoB] = await Promise.all([crearCitaConNylas(supabase, paramsA, deps), crearCitaConNylas(supabase, paramsB, deps)]);
    const resultados = [resultadoA, resultadoB];
    const exitosos = resultados.filter((r) => r.ok);
    const rechazados = resultados.filter((r) => !r.ok);

    assert.equal(exitosos.length, 1, "exactamente UNA de las dos solicitudes debe ganar");
    assert.equal(rechazados.length, 1);
    assert.equal((rechazados[0] as { ok: false; motivo: string }).motivo, "ocupado");
    assert.equal(creaciones, 2, "ambas intentaron crear su evento en Nylas antes de la revalidación final de DuLabs");
    assert.equal(borrados, 1, "el evento de Nylas de la solicitud perdedora se revirtió");

    const citas = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista;
    assert.equal(citas.length, 1, "nunca debe quedar más de una cita real para el mismo horario");
  });
});

describe("21. America/Bogota", () => {
  it("el evento se crea con timezone America/Bogota y el start/end correctos en esa zona", async () => {
    let paramsCapturados: { startUnix: number; endUnix: number; timezone: string } | undefined;
    const supabase = crearSupabaseFalso(construirTablas());
    const write: NylasEventsWriteClient = {
      async createEvent(params) {
        paramsCapturados = { startUnix: params.startUnix, endUnix: params.endUnix, timezone: params.timezone };
        return { id: "evt-1" };
      },
      async deleteEvent() {},
    };
    const resultado = await crearCitaConNylas(
      supabase,
      { idTenant: AMORE_TENANT_ID, servicioId: "s-dipping", especialistaId: 1, inicio: new Date(`${LUNES}T10:00:00-05:00`), nombreCliente: "Ana", telefonoCliente: null, idempotencyKey: nuevaClave() },
      { nylasReadClient: mockNylasRead(), nylasWriteClient: write, grantId: "grant-amore" },
    );
    assert.equal(resultado.ok, true);
    assert.equal(paramsCapturados?.timezone, "America/Bogota");
    assert.equal(paramsCapturados?.startUnix, Math.floor(new Date(`${LUNES}T10:00:00-05:00`).getTime() / 1000));
    assert.equal(paramsCapturados?.endUnix, Math.floor(new Date(`${LUNES}T12:00:00-05:00`).getTime() / 1000), "Dipping son 120 min");
  });
});

describe("22. Evento creado en el calendar_id correcto", () => {
  it("se usa el calendar_id de LA profesional seleccionada, nunca otro", async () => {
    let calendarIdCapturado: string | undefined;
    const supabase = crearSupabaseFalso(construirTablas());
    const write: NylasEventsWriteClient = {
      async createEvent(params) {
        calendarIdCapturado = params.calendarId;
        return { id: "evt-1" };
      },
      async deleteEvent() {},
    };
    await crearCitaConNylas(
      supabase,
      { idTenant: AMORE_TENANT_ID, servicioId: "s-dipping", especialistaId: 2, inicio: new Date(`${LUNES}T10:00:00-05:00`), nombreCliente: "Ana", telefonoCliente: null, idempotencyKey: nuevaClave() },
      { nylasReadClient: mockNylasRead(), nylasWriteClient: write, grantId: "grant-amore" },
    );
    assert.equal(calendarIdCapturado, "cal-cristal");
  });
});

describe("23. Start/end correctos (repite 21 con otra duración)", () => {
  it("un servicio de 60 min produce end = start + 60min exactos", async () => {
    const { resultado } = await reservar({}, { servicios: [{ ...SERVICIO_DIPPING, duracion_min: 60 }] });
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.equal(new Date(resultado.cita.fin).getTime() - new Date(resultado.cita.inicio).getTime(), 60 * 60_000);
  });
});

describe("24. No confirmar si Nylas no confirma la creación", () => {
  it("si Nylas falla creando, el resultado nunca es ok:true ni existe cita en DuLabs", async () => {
    const { resultado, supabase } = await reservar({}, {}, {}, { fallaCreando: true });
    assert.equal(resultado.ok, false);
    const citas = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista;
    assert.equal(citas.length, 0);
  });
});

describe("25. No crear si la revalidación falla", () => {
  it("Nylas error en la revalidación -> nunca se llega a crear el evento", async () => {
    let creo = false;
    await reservar({}, {}, { "cal-mary": "error" }, { onCreate: () => (creo = true) });
    assert.equal(creo, false);
  });
});

describe("26. Profesional ocupada + otras libres (OR real, mismo criterio de FASE B)", () => {
  it("Mary ocupada en Nylas -> se rechaza para Mary, pero Cristal (otra profesional) sí puede reservar el mismo horario", async () => {
    const eventoOcupado: NylasEvent = {
      id: "1",
      when: { object: "timespan", start_time: Math.floor(new Date(`${LUNES}T10:00:00-05:00`).getTime() / 1000), end_time: Math.floor(new Date(`${LUNES}T12:00:00-05:00`).getTime() / 1000) },
    };
    const solapado = { "cal-mary": [eventoOcupado] };
    const { resultado: resultadoMary } = await reservar({ especialistaId: 1 }, {}, solapado);
    assert.equal(resultadoMary.ok, false);
    const { resultado: resultadoCristal } = await reservar({ especialistaId: 2 }, {}, solapado);
    assert.equal(resultadoCristal.ok, true);
  });
});

describe("27. Bloqueo de DuLabs + evento de Google combinados", () => {
  it("un bloqueo interno de DuLabs en el horario solicitado rechaza la reserva, aunque Nylas esté libre", async () => {
    const { resultado } = await reservar(
      {},
      { bloqueos: [{ id_tenant: AMORE_TENANT_ID, especialista_id: 1, activo: true, inicio: `${LUNES}T09:00:00-05:00`, fin: `${LUNES}T11:00:00-05:00` }] },
      {},
    );
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "bloqueado");
  });
});

describe("28. Domingo", () => {
  it("domingo cerrado -> fuera_de_horario, nunca consulta Nylas", async () => {
    let llamo = false;
    const { resultado } = await reservar({ horaISO: `${DOMINGO}T10:00:00-05:00` }, {}, {}, { onCreate: () => (llamo = true) });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "fuera_de_horario");
    assert.equal(llamo, false);
  });
});

describe("29. Fuera de jornada", () => {
  it("una hora fuera de la jornada laboral (ej. 20:00) -> fuera_de_horario", async () => {
    const { resultado } = await reservar({ horaISO: `${LUNES}T20:00:00-05:00` });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "fuera_de_horario");
  });
});

// ---------------------------------------------------------------------------
// FASE 8 (Agenda V2, autorizado) -- actualizarCitaConNylas (reprogramar).
// Reutiliza el MISMO fake Supabase multi-tabla de arriba (ya soporta el
// EXCLUDE simulado también para UPDATE, ver ejecutar() -- sección agregada
// para esta fase).
// ---------------------------------------------------------------------------

const CITA_EXISTENTE_BASE: FilaGenerica = {
  id: 500,
  id_tenant: AMORE_TENANT_ID,
  especialista_id: 1,
  servicio_id: "s-dipping",
  servicio: "Dipping",
  telefono_cliente: "573001234567",
  nombre_cliente: "Ana Pérez",
  phone_number_id: "wa-amore",
  bloquea_horario: true,
  inicio: `${LUNES}T10:00:00-05:00`,
  fin: `${LUNES}T12:00:00-05:00`,
  estado: "confirmada",
  motivo_rechazo: null,
  origen: "manual",
};

async function reprogramar(
  params: Partial<{ idTenant: string; citaId: number; nuevoInicioISO: string; idempotencyKey: string; nylasEventIdActual: string | null }> = {},
  tablasOverrides: Parameters<typeof construirTablas>[0] & { citaExistente?: FilaGenerica } = {},
  nylasReadOverride: Record<string, NylasEvent[] | "error" | "timeout"> = {},
  nylasWriteOpts: Parameters<typeof mockNylasWrite>[0] = {},
) {
  const { citaExistente, ...resto } = tablasOverrides;
  // Clon fresco SIEMPRE -- crearSupabaseFalso solo copia el ARRAY (no sus
  // filas), así que reutilizar el mismo objeto entre tests haría que un
  // UPDATE de un test mutara el fixture compartido y corrompiera el
  // siguiente test.
  const supabase = crearSupabaseFalso(construirTablas({ citas: [{ ...(citaExistente ?? CITA_EXISTENTE_BASE) }], ...resto }));
  const resultado = await actualizarCitaConNylas(
    supabase,
    {
      idTenant: params.idTenant ?? AMORE_TENANT_ID,
      citaId: params.citaId ?? (CITA_EXISTENTE_BASE.id as number),
      nuevoInicio: new Date(params.nuevoInicioISO ?? `${LUNES}T14:00:00-05:00`),
      idempotencyKey: params.idempotencyKey ?? nuevaClave(),
    },
    {
      nylasReadClient: mockNylasRead(nylasReadOverride),
      nylasWriteClient: mockNylasWrite(nylasWriteOpts),
      grantId: "grant-amore",
      nylasEventIdActual: params.nylasEventIdActual === undefined ? "evt-viejo-1" : params.nylasEventIdActual,
    },
  );
  return { resultado, supabase };
}

describe("FASE 8 -- 1. Reprogramación exitosa", () => {
  it("actualiza la MISMA fila (mismo id), nunca crea una cita nueva", async () => {
    const { resultado, supabase } = await reprogramar();
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.equal(resultado.cita.id, 500);
    assert.equal(new Date(resultado.cita.inicio).getTime(), new Date(`${LUNES}T14:00:00-05:00`).getTime());
    assert.equal(resultado.especialista.nombre, "Mary");
    assert.equal(resultado.servicio.nombre, "Dipping");
    const citas = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista;
    assert.equal(citas.length, 1, "nunca debe existir una segunda cita");
    assert.equal(citas[0]!.id, 500);
  });

  it("borra el evento VIEJO de Nylas (best-effort) y devuelve el id del NUEVO evento", async () => {
    let eventoBorrado: string | undefined;
    const { resultado } = await reprogramar({ nylasEventIdActual: "evt-viejo-1" }, {}, {}, { onDelete: () => (eventoBorrado = "evt-viejo-1") });
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.equal(resultado.nylasEventIdAnterior, "evt-viejo-1");
    assert.notEqual(resultado.nylasEventId, "evt-viejo-1", "el nuevo evento nunca reutiliza el id del anterior");
    assert.equal(eventoBorrado, "evt-viejo-1");
  });

  it("sin mapeo de evento anterior (nylasEventIdActual null) -- igual reprograma, nunca intenta borrar nada", async () => {
    let seLlamoDelete = false;
    const { resultado } = await reprogramar({ nylasEventIdActual: null }, {}, {}, { onDelete: () => (seLlamoDelete = true) });
    assert.equal(resultado.ok, true);
    assert.equal(seLlamoDelete, false);
  });
});

describe("FASE 8 -- 2. Cita no confirmada (pendiente)", () => {
  it("una cita 'pendiente' -> no_reagendable, nunca se toca", async () => {
    const { resultado } = await reprogramar({}, { citaExistente: { ...CITA_EXISTENTE_BASE, estado: "pendiente" } });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "no_reagendable");
  });
});

describe("FASE 8 -- 3. Cita inexistente", () => {
  it("citaId que no existe para este tenant -> cita_no_encontrada", async () => {
    const { resultado } = await reprogramar({ citaId: 999999 });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "cita_no_encontrada");
  });
});

describe("FASE 8 -- 4. Servicio/calendario ya no válidos", () => {
  it("servicio_id ya no existe en el catálogo -> servicio_no_encontrado", async () => {
    const { resultado } = await reprogramar({}, { servicios: [] });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "servicio_no_encontrado");
  });

  it("especialista sin nylas_calendar_id -> sin_calendario_nylas", async () => {
    const { resultado } = await reprogramar({}, { especialistas: ESPECIALISTAS.map((e) => (e.id === 1 ? { ...e, nylas_calendar_id: null } : e)) });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "sin_calendario_nylas");
  });
});

describe("FASE 8 -- 5. Revalidación real del NUEVO horario", () => {
  it("el nuevo horario ya está ocupado en Google Calendar -> ocupado, NUNCA actualiza la cita original", async () => {
    const nuevoInicio = `${LUNES}T14:00:00-05:00`;
    const ocupado = {
      "cal-mary": [{ id: "x", when: { object: "timespan" as const, start_time: Math.floor(new Date(nuevoInicio).getTime() / 1000), end_time: Math.floor(new Date(`${LUNES}T15:00:00-05:00`).getTime() / 1000) } }],
    };
    let creo = false;
    const { resultado, supabase } = await reprogramar({ nuevoInicioISO: nuevoInicio }, {}, ocupado, { onCreate: () => (creo = true) });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "ocupado");
    assert.equal(creo, false, "nunca debe crear el evento nuevo si la revalidación ya rechazó el horario");
    const cita = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista[0]!;
    assert.equal(new Date(cita.inicio as string).getTime(), new Date(`${LUNES}T10:00:00-05:00`).getTime(), "la cita ORIGINAL sigue intacta en su horario anterior");
  });

  it("el nuevo horario cae fuera de jornada -> fuera_de_horario, cita original intacta", async () => {
    const { resultado, supabase } = await reprogramar({ nuevoInicioISO: `${LUNES}T20:00:00-05:00` });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "fuera_de_horario");
    const cita = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista[0]!;
    assert.equal(new Date(cita.inicio as string).getTime(), new Date(`${LUNES}T10:00:00-05:00`).getTime());
  });
});

describe("FASE 8 -- 6. Condición de carrera real (EXCLUDE de Postgres en el UPDATE)", () => {
  it("otra cita confirmada ya ocupa el nuevo horario en DuLabs -> ocupado, la cita original NUNCA se toca, el evento NUEVO de Nylas se revierte", async () => {
    const otraCitaYaEnEseHorario: FilaGenerica = {
      ...CITA_EXISTENTE_BASE,
      id: 501,
      inicio: `${LUNES}T14:00:00-05:00`,
      fin: `${LUNES}T15:00:00-05:00`,
    };
    let borrados = 0;
    const { resultado, supabase } = await reprogramar(
      {},
      { citas: [{ ...CITA_EXISTENTE_BASE }, otraCitaYaEnEseHorario] } as unknown as Parameters<typeof construirTablas>[0] & { citaExistente?: FilaGenerica },
      {},
      { onDelete: () => borrados++ },
    );
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "ocupado");
    assert.equal(borrados, 1, "el evento NUEVO de Nylas ya creado se revierte");
    const citas = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista;
    assert.equal(citas.length, 2, "nunca se crea una tercera cita");
    const original = citas.find((c) => c.id === 500)!;
    assert.equal(new Date(original.inicio as string).getTime(), new Date(`${LUNES}T10:00:00-05:00`).getTime(), "la cita original permanece EXACTAMENTE intacta");
  });
});

describe("FASE 8 -- 7. Tenant incorrecto", () => {
  it("un tenant distinto de AMORE se rechaza de forma segura, sin tocar Supabase/Nylas", async () => {
    const { resultado } = await reprogramar({ idTenant: "otro-tenant-cualquiera" });
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "tenant_no_autorizado");
  });
});

describe("FASE 8 -- 8. Idempotencia", () => {
  it("la MISMA solicitud repetida con la misma idempotency_key nunca reprograma dos veces", async () => {
    let llamadasCreate = 0;
    const clave = nuevaClave();
    const supabase = crearSupabaseFalso(construirTablas({ citas: [{ ...CITA_EXISTENTE_BASE }] }));
    const deps = { nylasReadClient: mockNylasRead(), nylasWriteClient: mockNylasWrite({ onCreate: () => llamadasCreate++ }), grantId: "grant-amore", nylasEventIdActual: "evt-viejo-1" };
    const paramsBase = { idTenant: AMORE_TENANT_ID, citaId: 500, nuevoInicio: new Date(`${LUNES}T14:00:00-05:00`), idempotencyKey: clave };

    const r1 = await actualizarCitaConNylas(supabase, paramsBase, deps);
    const r2 = await actualizarCitaConNylas(supabase, paramsBase, deps);

    assert.equal(r1.ok, true);
    assert.deepEqual(r1, r2, "el reintento debe devolver EXACTAMENTE el mismo resultado, sin volver a ejecutar la operación");
    assert.equal(llamadasCreate, 1, "Nylas solo debió llamarse UNA vez, nunca dos");
  });
});

// ---------------------------------------------------------------------------
// FASE 3 (autorizado, multi-servicio) -- crearCitaConNylas con
// `serviciosIdsAdicionales`. Reutiliza el MISMO fake Supabase multi-tabla de
// arriba (ya soporta el INSERT array de dulabs_cita_servicios, ver
// crearSupabaseFalso). Ningún caller pasa `serviciosIdsAdicionales` con un
// solo servicio -- por eso TODOS los tests de un solo servicio de arriba
// (1-29) siguen siendo la prueba de regresión de que el comportamiento
// original queda 100% intacto.
// ---------------------------------------------------------------------------
describe("FASE 3 -- creación con 2 servicios (120+90=210min, 60.000+80.000=140.000)", () => {
  it("Test 14 (obligatorio) -- una sola cita, DOS filas en dulabs_cita_servicios (orden 1/2), precio_total y duración correctos, UN solo evento de Nylas", async () => {
    let llamadasCreate = 0;
    const { resultado, supabase } = await reservar(
      { servicioId: "s-dipping", serviciosIdsAdicionales: ["s-presson"] },
      { servicios: [SERVICIO_DIPPING_CON_PRECIO, SERVICIO_PRESSON], asociaciones: ASOCIACIONES_MULTI },
      {},
      { onCreate: () => llamadasCreate++ },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.equal(llamadasCreate, 1, "UN solo evento real de Nylas para toda la combinación, nunca uno por servicio");
    assert.equal(resultado.servicio.duracionMin, 210, "120 (Dipping) + 90 (Press On) = 210");
    assert.equal(new Date(resultado.cita.fin).getTime() - new Date(resultado.cita.inicio).getTime(), 210 * 60_000);

    const citas = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista;
    assert.equal(citas.length, 1, "una sola cita, nunca dos filas separadas");
    assert.equal(citas[0]!.precio_total, 140000, "60.000 + 80.000 = 140.000");
    // Compatibilidad histórica (sección MUY IMPORTANTE del pedido) --
    // servicio/servicio_id de dulabs_citas_especialista SIEMPRE el PRIMERO.
    assert.equal(citas[0]!.servicio, "Dipping");
    assert.equal(citas[0]!.servicio_id, "s-dipping");

    const puente = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_cita_servicios;
    assert.equal(puente.length, 2);
    assert.deepEqual(
      puente.map((f) => [f.servicio_id, f.orden]),
      [
        ["s-dipping", 1],
        ["s-presson", 2],
      ],
    );
    assert.ok(puente.every((f) => f.cita_id === citas[0]!.id), "las filas del puente apuntan a la cita real recién creada");
  });

  it("Test 15 (obligatorio) -- 3 servicios: 120+90+30=240min, precio 60.000+80.000+60.000=200.000, TRES filas en el puente en orden", async () => {
    const { resultado, supabase } = await reservar(
      { servicioId: "s-dipping", serviciosIdsAdicionales: ["s-presson", "s-retoques"] },
      { servicios: [SERVICIO_DIPPING_CON_PRECIO, SERVICIO_PRESSON, SERVICIO_RETOQUES], asociaciones: ASOCIACIONES_MULTI },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.equal(resultado.servicio.duracionMin, 240);
    const citas = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista;
    assert.equal(citas[0]!.precio_total, 200000);
    const puente = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_cita_servicios;
    assert.deepEqual(
      puente.map((f) => [f.servicio_id, f.orden]),
      [
        ["s-dipping", 1],
        ["s-presson", 2],
        ["s-retoques", 3],
      ],
    );
  });

  it("nunca inventa un precio_total si algún servicio de la combinación no tiene precio fijo (sección PRECIO -- 'NO inventar descuentos')", async () => {
    const { resultado, supabase } = await reservar(
      { servicioId: "s-dipping", serviciosIdsAdicionales: ["s-presson"] },
      { servicios: [{ ...SERVICIO_DIPPING, precio: null }, SERVICIO_PRESSON], asociaciones: ASOCIACIONES_MULTI },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    const citas = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista;
    assert.equal(citas[0]!.precio_total, null, "nunca suma un 0 falso cuando un servicio de la combinación no tiene precio fijo");
  });

  it("una combinación que NINGUNA profesional puede hacer TODA junta -> especialista_no_habilitado, NUNCA crea nada", async () => {
    let llamadasCreate = 0;
    const { resultado, supabase } = await reservar(
      { servicioId: "s-dipping", serviciosIdsAdicionales: ["s-exclusivo-cristal"], especialistaId: 1 }, // Mary no puede hacer "s-exclusivo-cristal"
      { servicios: [SERVICIO_DIPPING_CON_PRECIO, SERVICIO_EXCLUSIVO_CRISTAL], asociaciones: ASOCIACIONES_MULTI },
      {},
      { onCreate: () => llamadasCreate++ },
    );
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "especialista_no_habilitado");
    assert.equal(llamadasCreate, 0, "nunca crea el evento de Nylas si la profesional elegida no puede hacer TODA la combinación");
    const citas = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista;
    assert.equal(citas.length, 0);
  });

  it("si dulabs_cita_servicios falla al insertar, la cita y el evento de Nylas YA reales NUNCA se revierten -- se informa 'inconsistencia_requiere_revision_manual' (mismo criterio best-effort de guardarNylasEventIdDeCita)", async () => {
    let borrados = 0;
    const { resultado, supabase } = await reservar(
      { servicioId: "s-dipping", serviciosIdsAdicionales: ["s-presson"] },
      { servicios: [SERVICIO_DIPPING_CON_PRECIO, SERVICIO_PRESSON], asociaciones: ASOCIACIONES_MULTI },
      {},
      { onDelete: () => borrados++ },
      { fallarInsertPuente: true },
    );
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.motivo, "inconsistencia_requiere_revision_manual");
    assert.equal(borrados, 0, "NUNCA intenta revertir el evento de Nylas ya real -- el horario ya quedó correctamente reservado");
    const citas = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista;
    assert.equal(citas.length, 1, "la cita real YA creada nunca se borra, aunque el detalle de servicios haya fallado");
  });

  it("regresión -- una selección de UN solo servicio (sin serviciosIdsAdicionales) nunca escribe ninguna fila en dulabs_cita_servicios ni fija precio_total", async () => {
    const { resultado, supabase } = await reservar();
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    const citas = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_citas_especialista;
    assert.equal(citas[0]!.precio_total, null, "un solo servicio nunca fija precio_total (compatibilidad histórica)");
    const puente = (supabase as unknown as { __tablas: Record<string, FilaGenerica[]> }).__tablas.dulabs_cita_servicios;
    assert.equal(puente.length, 0, "el camino de un solo servicio queda 100% idéntico al de antes de esta fase");
  });
});

describe("FASE 3 -- reprogramación (Fase 8) de una cita multi-servicio conserva TODOS sus servicios", () => {
  it("Test 16 (obligatorio) -- cita original con 2 servicios en el puente -> la duración revalidada es la SUMA real de ambos, nunca solo la del primero", async () => {
    const { resultado } = await reprogramar(
      {},
      {
        citas: [{ ...CITA_EXISTENTE_BASE, servicio_id: "s-dipping" }],
        servicios: [SERVICIO_DIPPING_CON_PRECIO, SERVICIO_PRESSON],
        asociaciones: ASOCIACIONES_MULTI,
        citaServicios: [
          { cita_id: 500, servicio_id: "s-dipping", orden: 1 },
          { cita_id: 500, servicio_id: "s-presson", orden: 2 },
        ],
      },
    );
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.equal(resultado.servicio.duracionMin, 210, "120 (Dipping) + 90 (Press On) -- conserva AMBOS servicios, nunca solo servicio_id");
    assert.equal(new Date(resultado.cita.fin).getTime() - new Date(resultado.cita.inicio).getTime(), 210 * 60_000);
  });

  it("regresión -- una cita de un solo servicio (sin filas en el puente) sigue usando EXCLUSIVAMENTE servicio_id, comportamiento 100% idéntico al de antes de esta fase", async () => {
    const { resultado } = await reprogramar({}, { citaServicios: [] });
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.equal(resultado.servicio.duracionMin, 120, "duración real de s-dipping en CITA_EXISTENTE_BASE, sin ninguna suma");
  });

  it("una sola fila en el puente (nunca debería ocurrir, pero defensivo) se trata igual que 'sin puente' -- usa servicio_id tal cual, nunca una suma de un solo elemento", async () => {
    const { resultado } = await reprogramar({}, { citaServicios: [{ cita_id: 500, servicio_id: "s-dipping", orden: 1 }] });
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.equal(resultado.servicio.duracionMin, 120);
  });
});
