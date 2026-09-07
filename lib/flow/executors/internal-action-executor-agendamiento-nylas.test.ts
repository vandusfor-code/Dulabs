/**
 * FASE 1 -- Agendamiento conversacional (autorizado, revisado). Cableado
 * real entre InternalActionExecutor y las dos acciones nuevas del Flow
 * (buscar_disponibilidad_nylas/crear_cita_nylas) -- wrappers FINOS sobre
 * lib/disponibilidad-servicio-nylas.ts / lib/reserva-servicio-nylas.ts (sin
 * cambios, probados a fondo en sus propios archivos). Este archivo prueba
 * SOLO esta capa: que el executor lea `agendamiento` de request.payload
 * (objeto anidado, nunca aplanado), y que arme instruccionIA/datosIA/success
 * correctos para cada resultado real -- por eso las funciones de dominio se
 * inyectan mockeadas directamente (nunca un fake Supabase/Nylas de bajo
 * nivel acá).
 *
 * Contrato de cada acción (revisado -- distinto entre ambas, a propósito):
 * - buscar_disponibilidad_nylas SIEMPRE devuelve success:true (una consulta
 *   real que no encuentra cupo, o que no puede confirmar Nylas, sigue siendo
 *   una consulta que SÍ se hizo -- se narra con naturalidad vía IA).
 * - crear_cita_nylas devuelve success:false en CUALQUIER rechazo real
 *   (horario ocupado, error técnico, datos incompletos, sin conexión) --
 *   mismo contrato EXACTO que agendar_cita_especialista. Motivo: Claim
 *   Security (capabilitiesFromVerifiedEntry) NO filtra en la práctica por
 *   outputVariables -- el filtro real es que el propio orchestrator
 *   (flow-orchestrator.ts) solo envuelve el resultado en __verifiedResults
 *   cuando `success:true`. success:true solo ocurre en el único branch de
 *   éxito real, con `citaId` presente. Un rechazo se narra vía la rama
 *   aiFailure del grafo (ver amore-router.flow.ts).
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
import { buildVerifiedActionEffectData } from "@/lib/flow/ai-runtime/verified-results";
import { extractVerifiedCapabilitiesFromVariables, validateTextClaimsAgainstVerified } from "@/lib/flow/external-claim-security";
import { isCriticalAction } from "@/lib/flow/action-capabilities";

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
  it("con opciones reales -> arma opcionesOfrecidas y datosIA a partir de datos reales, nunca inventados, en orden cronológico real", async () => {
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
    // Orden cronológico real (10:00 de Cristal antes que 14:00/16:00 de
    // Mary) -- el backend decide el orden, nunca el orden de iteración por
    // especialista (corrección, rediseño arquitectónico agendamiento).
    assert.deepEqual(agendamiento.opcionesOfrecidas?.[0], {
      especialistaId: 2,
      especialistaNombre: "Cristal",
      horaTexto: "10:00",
      horaISO: "2026-09-11T10:00:00-05:00",
    });
    assert.match(data.instruccionIA as string, /opciones/i);
  });

  it("sección 9 (autorizado) -- nunca ofrece más de 4 horarios reales, el backend decide, no Gemini", async () => {
    const resultadoMock: ResultadoHorariosConNylas = {
      ok: true,
      servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 },
      especialistas: [
        { especialistaId: 1, nombre: "Mary", estado: "ok", horarios: ["08:00", "09:00", "10:00"] },
        { especialistaId: 2, nombre: "Cristal", estado: "ok", horarios: ["08:30", "11:00", "13:00"] },
      ],
    };
    const executor = crearExecutor({ listarHorariosDisponiblesPorServicioConNylas: async () => resultadoMock });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", { agendamiento: AGENDA_LISTA_PARA_BUSCAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    const data = result.data as Record<string, unknown>;
    const agendamiento = data.agendamiento as AgendamientoEnCurso;
    assert.equal(agendamiento.opcionesOfrecidas?.length, 4, "máximo 4 opciones, sin importar cuántos horarios reales existan");
    // Las 4 más cercanas cronológicamente: 08:00, 08:30, 09:00, 10:00.
    assert.deepEqual(
      agendamiento.opcionesOfrecidas?.map((o) => o.horaTexto),
      ["08:00", "08:30", "09:00", "10:00"],
    );
  });

  it("sección 8/9 (autorizado) -- con hora preferida, el corte de 4 NUNCA descarta la hora exacta que la clienta pidió", async () => {
    const resultadoMock: ResultadoHorariosConNylas = {
      ok: true,
      servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 },
      especialistas: [{ especialistaId: 2, nombre: "Cristal", estado: "ok", horarios: ["08:00", "08:30", "09:00", "10:00", "16:00"] }],
    };
    const executor = crearExecutor({ listarHorariosDisponiblesPorServicioConNylas: async () => resultadoMock });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", {
        agendamiento: { ...AGENDA_LISTA_PARA_BUSCAR, especialistaId: 2, especialistaNombre: "Cristal", horaPreferidaHHMM: "16:00" },
      }),
      { tenantId: "tenant-amore", internal: true },
    );
    const data = result.data as Record<string, unknown>;
    const agendamiento = data.agendamiento as AgendamientoEnCurso;
    // 16:00 es la 5ta y última cronológicamente -- un corte ciego de "las
    // primeras 4" la habría descartado en silencio (justo el bug real ya
    // corregido en resolver.ts para especialista+hora exacta).
    assert.deepEqual(
      agendamiento.opcionesOfrecidas?.map((o) => o.horaTexto),
      ["16:00"],
      "la hora exacta pedida se prioriza -- nunca se descarta por el corte de 4",
    );
  });

  it("sección 8 (autorizado) -- hora preferida sin cupo real -- ofrece alternativas reales, nunca la oculta ni la inventa", async () => {
    const resultadoMock: ResultadoHorariosConNylas = {
      ok: true,
      servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 },
      especialistas: [{ especialistaId: 2, nombre: "Cristal", estado: "ok", horarios: ["08:00", "10:00"] }],
    };
    const executor = crearExecutor({ listarHorariosDisponiblesPorServicioConNylas: async () => resultadoMock });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", {
        agendamiento: { ...AGENDA_LISTA_PARA_BUSCAR, especialistaId: 2, especialistaNombre: "Cristal", horaPreferidaHHMM: "09:00" },
      }),
      { tenantId: "tenant-amore", internal: true },
    );
    const data = result.data as Record<string, unknown>;
    const agendamiento = data.agendamiento as AgendamientoEnCurso;
    assert.deepEqual(
      agendamiento.opcionesOfrecidas?.map((o) => o.horaTexto),
      ["08:00", "10:00"],
      "09:00 no existe -- se ofrecen las alternativas reales, nunca se inventa ni se oculta que esa hora no hay",
    );
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

describe("InternalActionExecutor — buscar_disponibilidad_nylas — MODO AGENDA GUIADA (autorizado)", () => {
  const AGENDA_GUIADA_LISTA_PARA_BUSCAR: AgendamientoEnCurso = {
    ...AGENDA_LISTA_PARA_BUSCAR,
    modo: "guiado",
    paso: "SELECCION_HORARIO",
  };

  it("con opciones reales -> devuelve modo=deterministic con un menú de horarios ya redactado, nunca instruccionIA para Gemini", async () => {
    const resultadoMock: ResultadoHorariosConNylas = {
      ok: true,
      servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 },
      especialistas: [
        { especialistaId: 1, nombre: "Mary", estado: "ok", horarios: ["14:00"] },
        { especialistaId: 2, nombre: "Cristal", estado: "ok", horarios: ["10:00"] },
      ],
    };
    const executor = crearExecutor({ listarHorariosDisponiblesPorServicioConNylas: async () => resultadoMock });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", { agendamiento: AGENDA_GUIADA_LISTA_PARA_BUSCAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.modo, "deterministic");
    assert.equal(data.instruccionIA, undefined, "nunca debe generar una instrucción para Gemini en modo guiado");
    assert.match(data.respuestaTexto as string, /1\. Cristal — 10:00 AM/);
    assert.match(data.respuestaTexto as string, /2\. Mary — 2:00 PM/);
    const agendamiento = data.agendamiento as AgendamientoEnCurso;
    assert.equal(agendamiento.paso, "SELECCION_HORARIO");
    assert.equal(agendamiento.menuActual?.tipo, "horario");
    assert.equal(agendamiento.menuActual?.opciones.length, 2);
  });

  it("sin cupo real -> vuelve determinísticamente al menú de fechas (nunca al fallback genérico de Gemini)", async () => {
    const resultadoMock: ResultadoHorariosConNylas = {
      ok: true,
      servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 },
      especialistas: [{ especialistaId: 1, nombre: "Mary", estado: "ok", horarios: [] }],
    };
    const executor = crearExecutor({ listarHorariosDisponiblesPorServicioConNylas: async () => resultadoMock });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", { agendamiento: AGENDA_GUIADA_LISTA_PARA_BUSCAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    const data = result.data as Record<string, unknown>;
    assert.equal(data.modo, "deterministic");
    assert.match(data.respuestaTexto as string, /No hay cupo real disponible/);
    const agendamiento = data.agendamiento as AgendamientoEnCurso;
    assert.equal(agendamiento.paso, "SELECCION_FECHA");
    assert.equal(agendamiento.fechaISO, undefined, "se limpia para que la clienta elija otra fecha real del menú");
    assert.equal(agendamiento.menuActual?.tipo, "fecha");
  });

  it("más de 4 horarios reales -> el menú guiado pagina con 'Ver más horarios' (nunca corta silenciosamente lo que hay más allá de 4)", async () => {
    const resultadoMock: ResultadoHorariosConNylas = {
      ok: true,
      servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 },
      especialistas: [{ especialistaId: 1, nombre: "Mary", estado: "ok", horarios: ["08:00", "09:00", "10:00", "11:00", "12:00"] }],
    };
    const executor = crearExecutor({ listarHorariosDisponiblesPorServicioConNylas: async () => resultadoMock });
    const result = await executor.dispatch(
      baseRequest("buscar_disponibilidad_nylas", { agendamiento: AGENDA_GUIADA_LISTA_PARA_BUSCAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    const data = result.data as Record<string, unknown>;
    const agendamiento = data.agendamiento as AgendamientoEnCurso;
    assert.equal(agendamiento.menuActual?.opciones.length, 5); // 4 reales + "Ver más horarios"
    assert.ok(agendamiento.menuActual?.pendientes?.length === 1);
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

  it("R/S. la revalidación descubre que el horario se ocupó -- success:false (nunca puede pasar como confirmada), mismo contrato que agendar_cita_especialista", async () => {
    const executor = crearExecutor({
      crearCitaConNylas: async () => ({ ok: false, motivo: "ocupado", detalle: "otra clienta tomó ese horario" }),
    });
    const result = await executor.dispatch(
      baseRequest("crear_cita_nylas", { agendamiento: AGENDA_LISTA_PARA_CONFIRMAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, false, "un rechazo real NUNCA es success:true -- si lo fuera, Claim Security otorgaría appointment.reserved en cualquier dispatch");
    assert.equal(result.error, "ocupado");
    assert.equal((result.data as Record<string, unknown>).detalle, "otra clienta tomó ese horario");
  });

  it("inconsistencia real (evento Nylas huérfano) -- también success:false, mismo motivo expuesto tal cual", async () => {
    const executor = crearExecutor({
      crearCitaConNylas: async () => ({
        ok: false,
        motivo: "inconsistencia_requiere_revision_manual",
        detalle: "el evento de Nylas se creó pero el rollback también falló",
      }),
    });
    const result = await executor.dispatch(
      baseRequest("crear_cita_nylas", { agendamiento: AGENDA_LISTA_PARA_CONFIRMAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.error, "inconsistencia_requiere_revision_manual");
  });

  it("faltan datos reales para reservar (defensivo) -- success:false, nunca llama a crearCitaConNylas", async () => {
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
    assert.equal(result.success, false);
    assert.equal(llamado, false);
  });

  it("sin conexión configurada al calendario -- success:false, nunca confirma", async () => {
    const executor = crearExecutor({ resolverNylasGrantIdParaTenant: () => null });
    const result = await executor.dispatch(
      baseRequest("crear_cita_nylas", { agendamiento: AGENDA_LISTA_PARA_CONFIRMAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.error, "sin_conexion_nylas");
  });

  it("error técnico real (excepción) -- success:false, nunca hace fallar la ejecución del executor en sí (la excepción se captura)", async () => {
    const executor = crearExecutor({
      crearCitaConNylas: async () => {
        throw new Error("fallo de red");
      },
    });
    const result = await executor.dispatch(
      baseRequest("crear_cita_nylas", { agendamiento: AGENDA_LISTA_PARA_CONFIRMAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.error, "error_tecnico");
  });
});

describe("InternalActionExecutor — crear_cita_nylas — MODO AGENDA GUIADA (autorizado)", () => {
  const AGENDA_GUIADA_PARA_CONFIRMAR: AgendamientoEnCurso = { ...AGENDA_LISTA_PARA_CONFIRMAR, modo: "guiado", paso: "CONFIRMACION" };

  it("reserva real exitosa en modo guiado -- confirma con texto determinístico, nunca instruccionIA para Gemini", async () => {
    const resultadoMock: ResultadoCrearCitaNylas = {
      ok: true,
      cita: { id: 999, inicio: "2026-09-11T21:00:00.000Z", fin: "2026-09-11T23:00:00.000Z" } as never,
      nylasEventId: "evt-real-1",
      especialista: { id: 1, nombre: "Mary" },
      servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 },
    };
    const executor = crearExecutor({ crearCitaConNylas: async () => resultadoMock });
    const result = await executor.dispatch(
      baseRequest("crear_cita_nylas", { agendamiento: AGENDA_GUIADA_PARA_CONFIRMAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.modo, "deterministic");
    assert.equal(data.instruccionIA, undefined, "nunca debe generar una instrucción para Gemini en modo guiado");
    assert.match(data.respuestaTexto as string, /¡Listo! Tu cita quedó confirmada/);
    assert.match(data.respuestaTexto as string, /Servicio: Dipping/);
    assert.match(data.respuestaTexto as string, /Profesional: Mary/);
    assert.equal(data.citaId, 999);
    const agendamiento = data.agendamiento as AgendamientoEnCurso;
    assert.equal(agendamiento.completado, true);
    assert.equal(agendamiento.paso, "COMPLETADO");
  });

  it("un rechazo real en modo guiado sigue siendo success:false -- nunca confirma sin evidencia, sea cual sea el modo", async () => {
    const executor = crearExecutor({
      crearCitaConNylas: async () => ({ ok: false, motivo: "ocupado", detalle: "otra clienta tomó ese horario" }),
    });
    const result = await executor.dispatch(
      baseRequest("crear_cita_nylas", { agendamiento: AGENDA_GUIADA_PARA_CONFIRMAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.error, "ocupado");
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

/**
 * Revisión (autorizada) -- verifica de punta a punta, con el mecanismo REAL
 * de Claim Security (no una simulación), que un rechazo de crear_cita_nylas
 * NUNCA puede habilitar a la IA a afirmar que la cita quedó reservada.
 *
 * Hallazgo real de esta revisión: capabilitiesFromVerifiedEntry
 * (external-claim-security.ts) NO filtra en la práctica por
 * outputVariables -- otorga verifiesOnSuccess con solo `verified:true`,
 * sin mirar si `citaId` (o cualquier outputVariable declarado) está
 * realmente presente en `data` (confirmado por el propio test suite
 * existente: flow-external-claim-security.test.ts, "verified=true por sí
 * solo YA otorga..."). El filtro real, documentado ahí mismo, es que el
 * EXECUTOR nunca marque success sin evidencia real -- exactamente lo que
 * agendar_cita_especialista ya hacía y que este wrapper ahora replica: un
 * rechazo real devuelve success:false, así que
 * flow-orchestrator.ts (`if (dispatchResult.success)
 * buildVerifiedActionEffectData(...)`) JAMÁS envuelve ese resultado en
 * __verifiedResults -- la capability ni siquiera entra en juego.
 */
describe("Claim Security -- un rechazo de crear_cita_nylas nunca puede autorizar 'tu cita está confirmada'", () => {
  const ACTION_CONFIG = { actionType: "crear_cita_nylas" as const, params: {} };

  it("un rechazo real (horario ocupado) -- success:false -- el orchestrator NUNCA envuelve esto en __verifiedResults", async () => {
    const executor = crearExecutor({
      crearCitaConNylas: async () => ({ ok: false, motivo: "ocupado", detalle: "otra clienta tomó ese horario" }),
    });
    const result = await executor.dispatch(
      baseRequest("crear_cita_nylas", { agendamiento: AGENDA_LISTA_PARA_CONFIRMAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    // Este es el ÚNICO gate real (ver flow-orchestrator.ts): con
    // success:false, buildVerifiedActionEffectData NUNCA se llama para este
    // dispatch, así que ninguna capability puede otorgarse. NO hay una
    // segunda capa de defensa vía outputVariables -- capabilitiesFromVerifiedEntry
    // (external-claim-security.ts) otorga verifiesOnSuccess con solo
    // verified:true, sin mirar si citaId está presente (confirmado abajo:
    // si algo, al margen de este gate, igual llamara
    // buildVerifiedActionEffectData sobre un rechazo, SÍ otorgaría la
    // capability por error) -- por eso success:false en el dispatch mismo
    // es la única protección real, no un detalle de implementación.
    assert.equal(result.success, false, "un rechazo real NUNCA es success:true -- ese es el único gate real");

    const variablesSiAlguienIgualLoEnvolviera = buildVerifiedActionEffectData({
      action: ACTION_CONFIG,
      effectId: "eff-1",
      executionId: "exec-1",
      rawData: (result.data ?? {}) as Record<string, unknown>,
    });
    const verificadasIndebidas = extractVerifiedCapabilitiesFromVariables(variablesSiAlguienIgualLoEnvolviera);
    assert.equal(
      verificadasIndebidas.has("appointment.reserved"),
      true,
      "confirma el hallazgo: SI algo llamara buildVerifiedActionEffectData sobre un rechazo (sin pasar por el gate real de arriba), SÍ otorgaría la capability por error -- por eso success:false en el dispatch es la única protección real",
    );
  });

  it("una reserva real y exitosa -- success:true CON citaId -- SÍ otorga appointment.reserved (Gemini SÍ puede confirmar)", async () => {
    const resultadoMock: ResultadoCrearCitaNylas = {
      ok: true,
      cita: { id: 999, inicio: "2026-09-11T21:00:00.000Z", fin: "2026-09-11T23:00:00.000Z" } as never,
      nylasEventId: "evt-real-1",
      especialista: { id: 1, nombre: "Mary" },
      servicio: { id: "s-dipping", nombre: "Dipping", duracionMin: 120 },
    };
    const executor = crearExecutor({ crearCitaConNylas: async () => resultadoMock });
    const result = await executor.dispatch(
      baseRequest("crear_cita_nylas", { agendamiento: AGENDA_LISTA_PARA_CONFIRMAR }),
      { tenantId: "tenant-amore", internal: true },
    );
    assert.equal(result.success, true);
    assert.equal((result.data as Record<string, unknown>).citaId, 999);

    const variables = buildVerifiedActionEffectData({
      action: ACTION_CONFIG,
      effectId: "eff-1",
      executionId: "exec-1",
      rawData: (result.appliedResult ?? result.data ?? {}) as Record<string, unknown>,
    });
    const verificadas = extractVerifiedCapabilitiesFromVariables(variables);
    assert.equal(verificadas.has("appointment.reserved"), true, "una reserva real SÍ debe otorgar la capability");

    const chequeo = validateTextClaimsAgainstVerified("¡Listo! Tu cita ya quedó confirmada 💗", verificadas);
    assert.equal(chequeo.ok, true, "acá SÍ hay evidencia real -- Claim Security debe permitirlo");
  });

  // Revisión (autorizada) -- ahora que success:true implica una reserva
  // real de verdad (igual que agendar_cita_especialista), marcar esta
  // acción como "critical" es correcto y seguro: criticalActionExecuted
  // (isCriticalAction) solo se dispara cuando de verdad se creó una fila.
  it("crear_cita_nylas SÍ está marcada como acción crítica (correcto ahora que success:true implica una reserva real)", () => {
    assert.equal(isCriticalAction(ACTION_CONFIG), true);
  });
});
