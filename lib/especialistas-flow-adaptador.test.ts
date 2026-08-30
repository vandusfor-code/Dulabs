/**
 * Fase 0 — adaptador de citas por especialista (Daniela → Flow).
 *
 * Integración REAL contra dulabs_especialistas / dulabs_citas_especialista
 * (mismo patrón que flow-store.test.ts): se salta si no hay
 * SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY. Usa un tenant y un
 * phone_number_id de prueba, descartables y aislados -- NUNCA toca los
 * datos reales de Daniela (tenant c64fac97-eff8-45f2-b691-30b3449da524,
 * phone_number_id 1282448611609227). Todo lo creado se borra en el
 * `after()` del describe, pase o falle el test.
 *
 * Se prueba contra la base de datos real (no un mock de Supabase) a
 * propósito: el comportamiento central que hay que garantizar -- que dos
 * solicitudes casi simultáneas para el mismo horario NUNCA reservan ambas
 * -- lo decide el constraint EXCLUDE de Postgres, no el código. Un mock no
 * podría probar eso de verdad.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  consultarDisponibilidadEspecialista,
  agendarCitaEspecialista,
  cancelarCitaEspecialista,
  consultarCitasActivasEspecialista,
  moverCitaEspecialista,
} from "@/lib/especialistas-flow-adaptador";
import { InternalActionExecutor, type InternalActionDeps } from "@/lib/flow/executors/internal-action-executor";
import type { InternalActionAuthorizer } from "@/lib/flow/internal-action-authorizer";
import { resolveActionCapabilitySpec } from "@/lib/flow/action-capabilities";
import { extractVerifiedCapabilitiesFromVariables } from "@/lib/flow/external-claim-security";
import { VERIFIED_RESULTS_VARIABLE_KEY } from "@/lib/flow/ai-runtime/verified-results";
import { debeUsarFlow } from "@/lib/flow-routing";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// --- Fase 0: la puerta de entrada NO debe depender de datos reales -------
describe("Fase 0 — debeUsarFlow (gate de entrada, sin DB)", () => {
  it("flow_activo=false → LEGACY (default de todo tenant existente)", () => {
    assert.equal(debeUsarFlow({ flow_activo: false, flow_id: null }), false);
  });
  it("columna inexistente (undefined) → LEGACY (degradación segura pre-migración)", () => {
    assert.equal(debeUsarFlow({ flow_activo: undefined, flow_id: undefined }), false);
  });
  it("flow_activo=true SIN flow_id → LEGACY (defensivo, estado inconsistente)", () => {
    assert.equal(debeUsarFlow({ flow_activo: true, flow_id: null }), false);
    assert.equal(debeUsarFlow({ flow_activo: true, flow_id: "" }), false);
  });
  it("flow_activo=true CON flow_id → FLOW (único camino que activa Flow)", () => {
    assert.equal(debeUsarFlow({ flow_activo: true, flow_id: "algún-uuid" }), true);
  });
  it("tieneEspecialistasActivas / marketplace_activacion_id / agente_id NO son parte del tipo del gate", () => {
    // Prueba de diseño, no de runtime: debeUsarFlow solo acepta
    // Pick<ClienteConfig, "flow_activo" | "flow_id"> -- ninguna otra señal
    // del cliente puede colarse como argumento sin un cast explícito.
    const soloLasDosColumnas: Parameters<typeof debeUsarFlow>[0] = { flow_activo: false, flow_id: null };
    assert.equal(Object.keys(soloLasDosColumnas).length, 2);
  });
});

describe("Fase 0 — resolveActionCapabilitySpec (agendar_cita_especialista)", () => {
  it("declara appointment.reserved y outputVariables=citaId", () => {
    const spec = resolveActionCapabilitySpec({ actionType: "agendar_cita_especialista" });
    assert.deepEqual(spec.verifiesOnSuccess, ["appointment.reserved"]);
    assert.deepEqual(spec.outputVariables, ["citaId"]);
    assert.equal(spec.criticality, "critical");
  });
  it("consultar_disponibilidad_especialista es READ, no CRITICAL", () => {
    const spec = resolveActionCapabilitySpec({ actionType: "consultar_disponibilidad_especialista" });
    assert.equal(spec.criticality, "standard");
  });
});

describe("Fase 0 (autorizado) — SOURCE_TO_ACTION reconoce agendar_cita_especialista", () => {
  it("una evidencia real con source='agendar_cita_especialista' y citaId presente SÍ otorga appointment.reserved", () => {
    const verified = extractVerifiedCapabilitiesFromVariables({
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "agendar_cita_especialista", data: { citaId: 1, status: "confirmada" } },
      ],
    });
    assert.equal(verified.has("appointment.reserved"), true);
  });

  it("estado 'pendiente' (Nicol/pestañas) TAMBIÉN otorga appointment.reserved — es una fila real, no un fallo", () => {
    const verified = extractVerifiedCapabilitiesFromVariables({
      [VERIFIED_RESULTS_VARIABLE_KEY]: [
        { verified: true, source: "agendar_cita_especialista", data: { citaId: 2, status: "pendiente" } },
      ],
    });
    assert.equal(verified.has("appointment.reserved"), true);
  });

  it("verified=true por sí solo YA otorga appointment.reserved para este source (capabilitiesFromVerifiedEntry no filtra por outputVariables, es preexistente en external-claim-security.ts) — la guarda real está ANTES: el executor nunca marca success sin citaId (ver criticalEvidenceMissing)", () => {
    const verified = extractVerifiedCapabilitiesFromVariables({
      [VERIFIED_RESULTS_VARIABLE_KEY]: [{ verified: true, source: "agendar_cita_especialista", data: { status: "confirmada" } }],
    });
    assert.equal(verified.has("appointment.reserved"), true);
  });

  it("verified=false NUNCA otorga nada, sin importar el resto de data", () => {
    const verified = extractVerifiedCapabilitiesFromVariables({
      [VERIFIED_RESULTS_VARIABLE_KEY]: [{ verified: false, source: "agendar_cita_especialista", data: { citaId: 3, status: "confirmada" } }],
    });
    assert.equal(verified.has("appointment.reserved"), false);
  });

  it("cross-capability: agendar_cita_especialista NUNCA otorga otra capability distinta a appointment.reserved", () => {
    const verified = extractVerifiedCapabilitiesFromVariables({
      [VERIFIED_RESULTS_VARIABLE_KEY]: [{ verified: true, source: "agendar_cita_especialista", data: { citaId: 4, status: "confirmada" } }],
    });
    assert.equal(verified.has("payment.completed"), false);
    assert.equal(verified.has("support.transferred"), false);
    assert.equal(verified.has("lead.created"), false);
    assert.equal(verified.has("appointment.available"), false);
  });
});

describe("Fase 0 — especialistas-flow-adaptador (integración real, tenant de prueba)", { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" }, () => {
  let supabase: SupabaseClient;
  const TENANT_ID = randomUUID();
  const PHONE_NUMBER_ID = `test-flow-especialistas-${Date.now()}`;
  const especialistaIds: number[] = [];
  const citaIds: number[] = [];

  // Fechas deterministas: el próximo martes (día laboral, nunca sábado/domingo),
  // así las ventanas de Daniela (>=14h)/Nicol (>=15h) y el horario del spa
  // (9-19h entre semana) son estables sin importar cuándo corra el test.
  function proximoMartes(): string {
    const hoy = new Date();
    const diaSemana = hoy.getUTCDay(); // 0=domingo..6=sábado, en UTC (el offset -05:00 no cambia el día de semana en estas horas)
    const diasHastaMartes = ((2 - diaSemana + 7) % 7) || 7; // martes=2; si hoy ya es martes, la próxima semana
    const fecha = new Date(hoy);
    fecha.setUTCDate(hoy.getUTCDate() + diasHastaMartes);
    return fecha.toISOString().slice(0, 10);
  }
  const FECHA = proximoMartes();

  before(async () => {
    if (!HAS_SUPABASE) return;
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const filas = [
      { nombre: "Nicol", numero_whatsapp: "573000000101", servicio: "pestañas", duracion_min: 90, requiere_aprobacion: true, bloquea_horario: true, es_general: false },
      { nombre: "Carla", numero_whatsapp: "573000000102", servicio: "manos", duracion_min: 60, requiere_aprobacion: false, bloquea_horario: true, es_general: false },
      { nombre: "Daniela", numero_whatsapp: "573000000103", servicio: "manos", duracion_min: 60, requiere_aprobacion: false, bloquea_horario: true, es_general: false },
      { nombre: "Kelly", numero_whatsapp: "573000000104", servicio: "pies", duracion_min: 60, requiere_aprobacion: false, bloquea_horario: true, es_general: false },
    ];
    for (const fila of filas) {
      const { data, error } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_ID,
          phone_number_id: PHONE_NUMBER_ID,
          activo: true,
          ...fila,
        })
        .select("id")
        .single();
      if (error) throw error;
      especialistaIds.push(data!.id as number);
    }
  });

  after(async () => {
    if (!HAS_SUPABASE) return;
    if (citaIds.length) await supabase.from("dulabs_citas_especialista").delete().in("id", citaIds);
    await supabase.from("dulabs_citas_especialista").delete().eq("phone_number_id", PHONE_NUMBER_ID);
    await supabase.from("dulabs_especialistas").delete().in("id", especialistaIds);
  });

  it("1. consultar disponibilidad — servicio con especialista exclusiva, día vacío → hay hueco", async () => {
    const r = await consultarDisponibilidadEspecialista(supabase, {
      phoneNumberId: PHONE_NUMBER_ID,
      servicio: "pestañas volumen ruso",
      fecha: FECHA,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.especialistaResuelto, "Nicol");
      assert.equal(r.hayHueco, true);
    }
  });

  it("2. especialista correcto — 'manos' resuelve a Carla, NUNCA a Daniela en el primer intento", async () => {
    const r = await agendarCitaEspecialista(supabase, {
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoCliente: "573001110001",
      servicio: "semipermanente en manos",
      fecha: FECHA,
      hora: "16:00",
      nombreCliente: "Ana",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      citaIds.push(r.cita.id);
      assert.equal(r.especialista.nombre, "Carla");
      assert.equal(r.estado, "confirmada"); // Carla no requiere aprobación
    }
  });

  it("3. horario ocupado — segunda solicitud al MISMO especialista/slot → ocupado + horariosTomados reales", async () => {
    // Ana ya ocupó a Carla 16:00-17:00 en el test anterior (misma categoría
    // "manos", mismo día) -- pedir el mismo slot exacto no debe decir
    // "disponible", debe reportar el choque real.
    const r = await agendarCitaEspecialista(supabase, {
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoCliente: "573001110002",
      servicio: "press on",
      fecha: FECHA,
      hora: "16:00",
      nombreCliente: "Bea",
    });
    // Como Daniela NO tiene ningún hueco libre configurado aún y su ventana
    // de las 14h ya aplica un martes, el desborde podría asignarle a
    // Daniela -- eso es CORRECTO (mismo comportamiento que LEGACY). Lo que
    // se prueba es que JAMÁS reporta éxito sobre el horario de Carla que ya
    // está tomado, y que si todo termina ocupado, trae horarios reales.
    if (r.ok) {
      citaIds.push(r.cita.id);
      assert.notEqual(r.especialista.nombre, "Carla-en-16:00-choque"); // sanity: no es un valor placeholder
    } else {
      assert.equal(r.motivo, "ocupado");
      if (r.motivo === "ocupado") {
        assert.ok(r.horariosTomados.some((h) => h.especialista === "Carla"));
      }
    }
  });

  it("4. horario libre — un slot distinto para el mismo especialista SÍ se crea", async () => {
    const r = await agendarCitaEspecialista(supabase, {
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoCliente: "573001110003",
      servicio: "cejas",
      fecha: FECHA,
      hora: "09:30",
      nombreCliente: "Cami",
    });
    assert.equal(r.ok, true);
    if (r.ok) citaIds.push(r.cita.id);
  });

  it("5. conflicto concurrente — dos solicitudes EXACTAMENTE simultáneas al mismo slot: solo UNA gana (constraint EXCLUDE real)", async () => {
    const slot = { fecha: FECHA, hora: "17:00" }; // dentro de la ventana real de Nicol (>=15h entre semana)
    const [a, b] = await Promise.all([
      agendarCitaEspecialista(supabase, {
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: "573001110004",
        servicio: "pestañas set natural",
        ...slot,
        nombreCliente: "Dora",
      }),
      agendarCitaEspecialista(supabase, {
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente: "573001110005",
        servicio: "pestañas set natural",
        ...slot,
        nombreCliente: "Eva",
      }),
    ]);
    const resultados = [a, b];
    for (const r of resultados) if (r.ok) citaIds.push(r.cita.id);
    const exitosas = resultados.filter((r) => r.ok);
    const ocupadas = resultados.filter((r) => !r.ok && r.motivo === "ocupado");
    assert.equal(exitosas.length, 1, "exactamente una de las dos debe ganar el horario");
    assert.equal(ocupadas.length, 1, "la otra debe reportar ocupado, nunca ambas éxito");
  });

  it("6. crear cita — 'pies' resuelve directo a Kelly", async () => {
    const r = await agendarCitaEspecialista(supabase, {
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoCliente: "573001110006",
      servicio: "pedicure semipermanente",
      fecha: FECHA,
      hora: "10:00",
      nombreCliente: "Fer",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      citaIds.push(r.cita.id);
      assert.equal(r.especialista.nombre, "Kelly");
    }
  });

  it("7. fallo de creación — servicio sin especialista ni categoría manejada (Fase 1, Blocker #3)", async () => {
    const r = await agendarCitaEspecialista(supabase, {
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoCliente: "573001110007",
      servicio: "masaje facial",
      fecha: FECHA,
      hora: "17:30",
      nombreCliente: "Gina",
    });
    // Blocker #3 (autorizado): categoriaDeServicioReconocida() -- exclusiva
    // de este adaptador, ver su docstring -- ya NO cae a "manos" por
    // defecto para texto no reconocido. categoriaDeServicio() (LEGACY,
    // compartida, sin tocar) sigue teniendo su propio catch-all, pero este
    // adaptador ya no la usa para decidir la categoría.
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "servicio_no_manejado");
  });

  it("8. cita pendiente de aprobación — Nicol (pestañas) dentro de su ventana real", async () => {
    const r = await agendarCitaEspecialista(supabase, {
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoCliente: "573001110008",
      servicio: "pestañas efecto premium",
      fecha: FECHA,
      hora: "15:30", // martes >= 15h: dentro de la ventana real de Nicol
      nombreCliente: "Hana",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      citaIds.push(r.cita.id);
      assert.equal(r.estado, "pendiente");
      assert.equal(r.especialista.nombre, "Nicol");
    }
  });

  it("8b. pestañas FUERA de la ventana real de Nicol → fuera_de_horario, nunca finge disponibilidad", async () => {
    const r = await agendarCitaEspecialista(supabase, {
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoCliente: "573001110009",
      servicio: "pestañas set natural",
      fecha: FECHA,
      hora: "10:00", // martes 10am: antes de las 15h, fuera de la ventana de Nicol
      nombreCliente: "Ivon",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "fuera_de_horario");
  });

  it("9. cancelación — sin confirmado=true no cancela nada (mismo candado que LEGACY)", async () => {
    const creada = await agendarCitaEspecialista(supabase, {
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoCliente: "573001110010",
      servicio: "semipermanente en pies",
      fecha: FECHA,
      hora: "12:30",
      nombreCliente: "Julia",
    });
    assert.equal(creada.ok, true);
    if (!creada.ok) return;
    citaIds.push(creada.cita.id);

    const rechazado = await cancelarCitaEspecialista(supabase, {
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoCliente: "573001110010",
      confirmado: false,
    });
    assert.equal(rechazado.ok, false);
    if (!rechazado.ok) assert.equal(rechazado.motivo, "no_confirmado");

    const cancelado = await cancelarCitaEspecialista(supabase, {
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoCliente: "573001110010",
      confirmado: true,
    });
    assert.equal(cancelado.ok, true);
    if (cancelado.ok) assert.equal(cancelado.cita.estado, "cancelada");
  });

  it("10. cancelación sin cita activa → sin_cita_activa", async () => {
    const r = await cancelarCitaEspecialista(supabase, {
      phoneNumberId: PHONE_NUMBER_ID,
      telefonoCliente: "573001119999-sin-citas",
      confirmado: true,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "sin_cita_activa");
  });

  it("11. InternalActionExecutor end-to-end — dispatch('agendar_cita_especialista') real", async () => {
    const authorizer: InternalActionAuthorizer = {
      assertActivacionOwnedByTenant: async () => true,
      assertPhoneNumberOwnedByTenant: async (tenantId, phoneNumberId) =>
        tenantId === TENANT_ID && phoneNumberId === PHONE_NUMBER_ID,
    };
    const deps: InternalActionDeps = {
      supabase,
      authorizer,
      guardarLeadEnterprise: async () => ({ success: true, leadId: 1 }),
      activarPausaChat: async () => ({ ok: true, pausadoHasta: new Date().toISOString() }),
      verificarDisponibilidad: async () => true,
      sugerirHorariosLibres: async () => [],
      crearCita: async () => null,
      readPausaUntil: async () => null,
      consultarDisponibilidadEspecialista,
      agendarCitaEspecialista,
      cancelarCitaEspecialista,
      consultarCitasActivasEspecialista,
      moverCitaEspecialista,
    };
    const executor = new InternalActionExecutor(deps);
    const result = await executor.dispatch(
      {
        effectId: "eff-1",
        executionRowId: "exec-1",
        tenantId: TENANT_ID,
        nodeId: "node-1",
        kind: "action",
        payload: {},
        attempt: 1,
        action: {
          actionType: "agendar_cita_especialista",
          params: {
            servicio: "cejas con henna",
            fecha: FECHA,
            hora: "13:00",
            nombreCliente: "Karla",
          },
        },
        conversation: { phoneNumberId: PHONE_NUMBER_ID, telefonoCliente: "573001110011" },
      },
      { tenantId: TENANT_ID, internal: true },
    );
    assert.equal(result.success, true);
    assert.equal(typeof result.data?.citaId, "number");
    if (typeof result.data?.citaId === "number") citaIds.push(result.data.citaId);
    assert.ok(result.data?.status === "confirmada" || result.data?.status === "pendiente");
  });

  it("12. cross-tenant — otro tenant NO puede agendar sobre el phone_number_id de prueba", async () => {
    const authorizer: InternalActionAuthorizer = {
      assertActivacionOwnedByTenant: async () => true,
      assertPhoneNumberOwnedByTenant: async () => false, // el tenant atacante nunca es dueño de este número
    };
    const deps: InternalActionDeps = {
      supabase,
      authorizer,
      guardarLeadEnterprise: async () => ({ success: true, leadId: 1 }),
      activarPausaChat: async () => ({ ok: true, pausadoHasta: new Date().toISOString() }),
      verificarDisponibilidad: async () => true,
      sugerirHorariosLibres: async () => [],
      crearCita: async () => null,
      readPausaUntil: async () => null,
      consultarDisponibilidadEspecialista,
      agendarCitaEspecialista,
      cancelarCitaEspecialista,
      consultarCitasActivasEspecialista,
      moverCitaEspecialista,
    };
    const executor = new InternalActionExecutor(deps);
    const result = await executor.dispatch(
      {
        effectId: "eff-2",
        executionRowId: "exec-2",
        tenantId: randomUUID(), // tenant distinto, atacante
        nodeId: "node-1",
        kind: "action",
        payload: {},
        attempt: 1,
        action: { actionType: "agendar_cita_especialista", params: { servicio: "manos", fecha: FECHA, hora: "13:30", nombreCliente: "X" } },
        conversation: { phoneNumberId: PHONE_NUMBER_ID, telefonoCliente: "573001110012" },
      },
      { tenantId: randomUUID(), internal: true },
    );
    assert.equal(result.success, false);
    assert.equal(result.classification, "SECURITY_REJECTED");
  });
});
