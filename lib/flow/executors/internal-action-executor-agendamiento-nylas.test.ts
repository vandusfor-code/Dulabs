/**
 * FASE 1 -- Agendamiento conversacional (autorizado). Cableado real entre
 * InternalActionExecutor y las dos acciones nuevas del Flow
 * (buscar_disponibilidad_nylas/crear_cita_nylas) -- wrappers FINOS sobre
 * lib/disponibilidad-servicio-nylas.ts / lib/reserva-servicio-nylas.ts (sin
 * cambios, probados a fondo en sus propios archivos). Este archivo prueba
 * SOLO esta capa: que el executor lea `agendamiento` de request.payload
 * (objeto anidado, nunca aplanado), arme instruccionIA/datosIA correctos
 * para cada resultado real, y SIEMPRE devuelva success:true (nunca corta la
 * conversación) -- por eso las funciones de dominio se inyectan mockeadas
 * directamente (nunca un fake Supabase/Nylas de bajo nivel acá).
 *
 * También cubre el threading de `telefonoCliente`/`agendamiento` en
 * resolverEscenarioAction (resolver_escenario), necesario para que el
 * acumulador sobreviva entre turnos y para que el nombre ya conocido se
 * resuelva sin preguntarlo de nuevo.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalActionExecutor } from "@/lib/flow/executors/internal-action-executor";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import type { EffectDispatchRequest } from "@/lib/flow/executor-types";
import type { EscenarioRow, AgendamientoEnCurso } from "@/lib/bot-escenarios/tipos";
import type { ResultadoHorariosConNylas } from "@/lib/disponibilidad-servicio-nylas";
import type { ResultadoCrearCitaNylas } from "@/lib/reserva-servicio-nylas";
import type { NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";

const AUTHORIZER: InternalActionAuthorizer = {
  assertActivacionOwnedByTenant: async () => true,
  assertPhoneNumberOwnedByTenant: async () => true,
};

const NYLAS_CLIENT_FALSO = {} as NylasEventsClient;
const NYLAS_WRITE_CLIENT_FALSO = {} as NylasEventsWriteClient;

function baseRequest(
  actionType: "buscar_disponibilidad_nylas" | "crear_cita_nylas" | "resolver_escenario",
  payload: Record<string, unknown>,
  conversation?: { phoneNumberId: string; telefonoCliente: string },
): EffectDispatchRequest {
  return {
    effectId: "eff-1",
    executionRowId: "exec-1",
    tenantId: "tenant-amore",
    nodeId: `act-${actionType}`,
    attempt: 1,
    kind: "action",
    action: { actionType },
    payload,
    conversation,
  } as EffectDispatchRequest;
}

function crearExecutor(overrides: Partial<ConstructorParameters<typeof InternalActionExecutor>[0]> = {}) {
  return new InternalActionExecutor({
    supabase: {} as SupabaseClient,
    authorizer: AUTHORIZER,
    guardarLeadEnterprise: async () => ({ ok: false, motivo: "no_usado" }) as never,
    activarPausaChat: async () => ({ ok: false }) as never,
    verificarDisponibilidad: async () => ({ disponible: false }) as never,
    sugerirHorariosLibres: async () => [] as never,
    crearCita: async () => ({ ok: false }) as never,
    readPausaUntil: async () => null,
    consultarDisponibilidadEspecialista: async () => ({ disponible: false }) as never,
    validarServicioEspecialista: async () => ({ ok: false }) as never,
    agendarCitaEspecialista: async () => ({ ok: false }) as never,
    cancelarCitaEspecialista: async () => ({ ok: false }) as never,
    consultarCitasActivasEspecialista: async () => ({ ok: false }) as never,
    moverCitaEspecialista: async () => ({ ok: false }) as never,
    listarHorariosDisponiblesEspecialista: async () => ({ ok: false }) as never,
    cargarEscenariosReal: async () => [] as EscenarioRow[],
    listarCatalogoServiciosReal: async () => [],
    listarProfesionalesServicioReal: async () => ({ profesionales: [] }),
    cargarConocimientoReal: async () => [],
    // Nylas -- siempre "configurado" salvo que un test lo sobreescriba para
    // probar la rama de "sin conexión al calendario".
    resolverNylasGrantIdParaTenant: () => "grant-real",
    resolveNylasApiKeyFromEnv: () => "api-key-real",
    createNylasEventsClient: () => NYLAS_CLIENT_FALSO,
    createNylasEventsWriteClient: () => NYLAS_WRITE_CLIENT_FALSO,
    ...overrides,
  });
}

const AGENDA_LISTA_PARA_BUSCAR: AgendamientoEnCurso = {
  servicioId: "s-dipping",
  servicioNombre: "Dipping",
  duracionMin: 120,
  fechaISO: "2026-09-11",
};

describe("InternalActionExecutor — buscar_disponibilidad_nylas", () => {
  it("con opciones reales -> arma opcionesOfrecidas y datosIA a partir de datos reales, nunca inventados", async () => {
    const resultadoMock: ResultadoHorariosConNylas = {
      ok: true,
      servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 },
      especialistas: [
        { especialistaId: 1, nombre: "Mary", estado: "ok", horarios: ["14:00", "16:00"] },
        { especialistaId: 2, nombre: "Cristal", estado: "ok", horarios: ["10:00"] },
      ],
    };
    const executor = crearExecutor({
      listarHorariosDisponiblesPorServicioConNylas: async () => resultadoMock,
    });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", { agendamiento: AGENDA_LISTA_PARA_BUSCAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.modo, "ai");
    const agendamiento = data.agendamiento as AgendamientoEnCurso;
    assert.equal(agendamiento.opcionesOfrecidas?.length, 3);
    assert.deepEqual(agendamiento.opcionesOfrecidas?.[0], {
      especialistaId: 1,
      especialistaNombre: "Mary",
      horaTexto: "14:00",
      horaISO: "2026-09-11T14:00:00-05:00",
    });
    assert.match(data.instruccionIA as string, /opciones/i);
  });

  it("sin cupo real (estado ok pero sin horarios) -> nunca inventa una hora, agendamiento sin opciones", async () => {
    const resultadoMock: ResultadoHorariosConNylas = {
      ok: true,
      servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 },
      especialistas: [{ especialistaId: 1, nombre: "Mary", estado: "ok", horarios: [] }],
    };
    const executor = crearExecutor({ listarHorariosDisponiblesPorServicioConNylas: async () => resultadoMock });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", { agendamiento: AGENDA_LISTA_PARA_BUSCAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    const data = result.data as Record<string, unknown>;
    assert.equal((data.agendamiento as AgendamientoEnCurso).opcionesOfrecidas, undefined);
    assert.match(data.instruccionIA as string, /no hay cupo/i);
  });

  it("N. Nylas timeout/no_confirmado para TODAS -- nunca dice que no hay disponibilidad, dice que no pudo confirmar", async () => {
    const resultadoMock: ResultadoHorariosConNylas = {
      ok: true,
      servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 },
      especialistas: [{ especialistaId: 1, nombre: "Mary", estado: "no_confirmado", horarios: [] }],
    };
    const executor = crearExecutor({ listarHorariosDisponiblesPorServicioConNylas: async () => resultadoMock });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", { agendamiento: AGENDA_LISTA_PARA_BUSCAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    const data = result.data as Record<string, unknown>;
    assert.match(data.instruccionIA as string, /no pudiste confirmar/i);
  });

  it("O. error real de Nylas (ok:false sin_especialistas_habilitados) -- limpia SOLO la profesional, conserva el servicio", async () => {
    const executor = crearExecutor({
      listarHorariosDisponiblesPorServicioConNylas: async () => ({ ok: false, motivo: "sin_especialistas_habilitados", detalle: "x" }),
    });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", {
        agendamiento: { ...AGENDA_LISTA_PARA_BUSCAR, especialistaId: 1, especialistaNombre: "Mary" },
      }),
      { tenantId: "tenant-amore", internal: true },
    );
    const data = result.data as Record<string, unknown>;
    const agendamiento = data.agendamiento as AgendamientoEnCurso;
    assert.equal(agendamiento.especialistaId, undefined);
    assert.equal(agendamiento.servicioId, "s-dipping", "el servicio SÍ se conserva -- solo la profesional era el problema");
  });

  it("servicio_no_encontrado -- limpia el servicio para que se pueda elegir otro", async () => {
    const executor = crearExecutor({
      listarHorariosDisponiblesPorServicioConNylas: async () => ({ ok: false, motivo: "servicio_no_encontrado", detalle: "x" }),
    });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", { agendamiento: AGENDA_LISTA_PARA_BUSCAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    const data = result.data as Record<string, unknown>;
    assert.equal((data.agendamiento as AgendamientoEnCurso).servicioId, undefined);
  });

  it("sin servicio/fecha en el acumulador (defensivo) -- nunca llama a Nylas, pregunta de nuevo", async () => {
    let llamado = false;
    const executor = crearExecutor({
      listarHorariosDisponiblesPorServicioConNylas: async () => {
        llamado = true;
        return { ok: false, motivo: "servicio_no_encontrado", detalle: "x" };
      },
    });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", { agendamiento: { servicioId: "s-dipping" } }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(llamado, false, "nunca debe llamar a Nylas sin fecha real");
  });

  it("sin conexión configurada al calendario (grantId/apiKey ausentes) -- responde con naturalidad, nunca inventa", async () => {
    const executor = crearExecutor({ resolveNylasApiKeyFromEnv: () => null });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", { agendamiento: AGENDA_LISTA_PARA_BUSCAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, true);
    assert.match((result.data as Record<string, unknown>).instruccionIA as string, /no puedes verificar/i);
  });

  it("error técnico real (excepción) -- nunca hace fallar la ejecución completa, responde con naturalidad", async () => {
    const executor = crearExecutor({
      listarHorariosDisponiblesPorServicioConNylas: async () => {
        throw new Error("timeout de red");
      },
    });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", { agendamiento: AGENDA_LISTA_PARA_BUSCAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, true);
    assert.match((result.data as Record<string, unknown>).instruccionIA as string, /error técnico/i);
  });
});

const AGENDA_LISTA_PARA_CONFIRMAR: AgendamientoEnCurso = {
  servicioId: "s-dipping",
  servicioNombre: "Dipping",
  duracionMin: 120,
  fechaISO: "2026-09-11",
  horarioSeleccionadoISO: "2026-09-11T16:00:00-05:00",
  especialistaSeleccionadaId: 1,
  especialistaSeleccionadaNombre: "Mary",
  nombreCliente: "Ana Pérez",
  esperandoConfirmacion: true,
};

describe("InternalActionExecutor — crear_cita_nylas", () => {
  it("P. reserva real exitosa -- marca completado y redacta con los datos reales devueltos, nunca los del acumulador", async () => {
    const resultadoMock: ResultadoCrearCitaNylas = {
      ok: true,
      cita: { id: 999, inicio: "2026-09-11T21:00:00.000Z", fin: "2026-09-11T23:00:00.000Z" } as never,
      nylasEventId: "evt-real-1",
      especialista: { id: 1, nombre: "Mary" },
      servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 },
    };
    let idempotencyKeyRecibida = "";
    let telefonoRecibido: string | null = "";
    const executor = crearExecutor({
      crearCitaConNylas: async (_supabase, params) => {
        idempotencyKeyRecibida = params.idempotencyKey;
        telefonoRecibido = params.telefonoCliente;
        return resultadoMock;
      },
    });
    const result = await executor.dispatch(
      baseRequest("crear_cita_nylas", { agendamiento: AGENDA_LISTA_PARA_CONFIRMAR }, { phoneNumberId: "pn-1", telefonoCliente: "573148127388" }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, true);
    const data = result.data as Record<string, unknown>;
    assert.equal((data.agendamiento as AgendamientoEnCurso).completado, true);
    assert.match(data.instruccionIA as string, /confirma con naturalidad/i);
    assert.deepEqual(data.datosIA, [{ servicio: "Dipping", profesional: "Mary", fecha: "2026-09-11", hora: "16:00" }]);
    assert.equal(telefonoRecibido, "573148127388", "telefonoCliente debe venir de request.conversation, no inventado");
    assert.match(idempotencyKeyRecibida, /^agendamiento:exec-1:eff-1$/);
  });

  it("R/S. la revalidación descubre que el horario se ocupó -- NUNCA dice 'confirmada', limpia la selección para re-consultar", async () => {
    const executor = crearExecutor({
      crearCitaConNylas: async () => ({ ok: false, motivo: "ocupado", detalle: "otra clienta tomó ese horario" }),
    });
    const result = await executor.dispatch(
      baseRequest("crear_cita_nylas", { agendamiento: AGENDA_LISTA_PARA_CONFIRMAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    const data = result.data as Record<string, unknown>;
    assert.match(data.instruccionIA as string, /NUNCA digas que la cita qued(ó|o) confirmada/i);
    const agendamiento = data.agendamiento as AgendamientoEnCurso;
    assert.equal(agendamiento.horarioSeleccionadoISO, undefined);
    assert.equal(agendamiento.especialistaSeleccionadaId, undefined);
    assert.equal(agendamiento.esperandoConfirmacion, undefined);
    assert.equal(agendamiento.servicioId, "s-dipping", "el servicio no se pierde, solo la selección puntual");
  });

  it("faltan datos reales para reservar (defensivo) -- nunca llama a crearCitaConNylas", async () => {
    let llamado = false;
    const executor = crearExecutor({
      crearCitaConNylas: async () => {
        llamado = true;
        return { ok: false, motivo: "servicio_no_encontrado", detalle: "x" };
      },
    });
    const result = await executor.dispatch(
      baseRequest("crear_cita_nylas", { agendamiento: { servicioId: "s-dipping" } }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(llamado, false);
  });

  it("sin conexión configurada al calendario -- nunca confirma, responde con naturalidad", async () => {
    const executor = crearExecutor({ resolverNylasGrantIdParaTenant: () => null });
    const result = await executor.dispatch(
      baseRequest("crear_cita_nylas", { agendamiento: AGENDA_LISTA_PARA_CONFIRMAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    const data = result.data as Record<string, unknown>;
    assert.match(data.instruccionIA as string, /NUNCA digas que la cita qued(ó|o) confirmada/i);
    assert.equal((data.agendamiento as AgendamientoEnCurso).completado, undefined);
  });

  it("error técnico real (excepción) -- nunca hace fallar la ejecución, nunca confirma", async () => {
    const executor = crearExecutor({
      crearCitaConNylas: async () => {
        throw new Error("fallo de red");
      },
    });
    const result = await executor.dispatch(
      baseRequest("crear_cita_nylas", { agendamiento: AGENDA_LISTA_PARA_CONFIRMAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, true);
    assert.match((result.data as Record<string, unknown>).instruccionIA as string, /NUNCA digas que la cita qued(ó|o) confirmada/i);
  });
});

describe("InternalActionExecutor — resolver_escenario (FASE 1: threading real de telefonoCliente/agendamiento)", () => {
  const ESCENARIO_AGENDAMIENTO: EscenarioRow = {
    id: "e1",
    tenantId: "tenant-amore",
    codigo: "070_agendamiento",
    nombre: "Agendamiento",
    modo: "ai",
    prioridad: 910,
    activo: true,
    variantes: [{ tipo: "contains", valor: "quiero una cita" }],
    respuestas: [],
    config: { instruccionIA: "no usado" },
  };
  const ESCENARIO_FALLBACK: EscenarioRow = {
    id: "e0",
    tenantId: "tenant-amore",
    codigo: "000_fallback",
    nombre: "Fallback",
    modo: "deterministic",
    prioridad: 0,
    activo: true,
    variantes: [],
    respuestas: ["No entendí, ¿puedes repetirlo?"],
    config: {},
  };

  it("pasa telefonoCliente real (nunca inventado) hacia resolverEscenario -- se usa para resolver el nombre ya conocido sin preguntarlo de nuevo", async () => {
    let telefonoRecibidoPorNombreConocido: string | undefined;
    const executor = crearExecutor({
      cargarEscenariosReal: async () => [ESCENARIO_AGENDAMIENTO, ESCENARIO_FALLBACK],
      listarCatalogoServiciosReal: async () => [
        { id: "s-dipping", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
      ],
      cargarEspecialistas: async () => [{ id: 1, nombre: "Mary" }],
      buscarNombreConocido: async (_supabase, _phoneNumberId, telefonoCliente) => {
        telefonoRecibidoPorNombreConocido = telefonoCliente;
        return "Ana Pérez";
      },
    });
    const agendamientoListoParaNombre: AgendamientoEnCurso = {
      servicioId: "s-dipping",
      servicioNombre: "Dipping",
      duracionMin: 120,
      fechaISO: "2026-09-11",
      horarioSeleccionadoISO: "2026-09-11T16:00:00-05:00",
      especialistaSeleccionadaId: 1,
      especialistaSeleccionadaNombre: "Mary",
    };
    const result = await executor.dispatch(
      baseRequest(
        "resolver_escenario",
        { mensajeActual: "esa hora está perfecta", agendamiento: agendamientoListoParaNombre, __turnoEscenario: "3" },
        { phoneNumberId: "pn-1", telefonoCliente: "573148127388" },
      ),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(telefonoRecibidoPorNombreConocido, "573148127388", "nunca debe inventar o dejar vacío el teléfono real de la conversación");
    const agendamiento = (result.data as Record<string, unknown>).agendamiento as AgendamientoEnCurso;
    assert.equal(agendamiento.nombreCliente, "Ana Pérez", "el nombre ya conocido se usó sin tener que preguntarlo de nuevo");
    assert.equal(agendamiento.esperandoConfirmacion, true);
  });

  it("conserva el acumulador de agendamiento entre turnos (round-trip completo, objeto anidado)", async () => {
    const executor = crearExecutor({
      cargarEscenariosReal: async () => [ESCENARIO_AGENDAMIENTO, ESCENARIO_FALLBACK],
      listarCatalogoServiciosReal: async () => [
        { id: "s-dipping", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
      ],
      cargarEspecialistas: async () => [],
    });
    const agendamientoPrevio: AgendamientoEnCurso = { servicioId: "s-dipping", servicioNombre: "Dipping", duracionMin: 120 };
    const result = await executor.dispatch(
      baseRequest("resolver_escenario", { mensajeActual: "el viernes", agendamiento: agendamientoPrevio, __turnoEscenario: "1" }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, true);
    const agendamiento = (result.data as Record<string, unknown>).agendamiento as AgendamientoEnCurso;
    assert.equal(agendamiento.servicioId, "s-dipping", "el servicio de un turno anterior sobrevive intacto");
    assert.ok(agendamiento.fechaISO, "la fecha de ESTE turno se fusionó correctamente");
  });
});
