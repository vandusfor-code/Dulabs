/**
 * Fase 1 (Blocker #6, autorizado) — cita existente y consistencia del
 * estado real.
 *
 * Este blocker es principalmente de AUDITORÍA: consolida y cierra con
 * pruebas explícitas garantías que los Blockers #3/#4/#5 ya establecieron
 * por separado (aislamiento, concurrencia, dashboard), y agrega las
 * pruebas específicamente nuevas que pide este blocker: "estado fantasma",
 * "éxito fantasma", consistencia lectura-después-de-escritura, la matriz
 * completa de aislamiento cliente/tenant en un solo lugar, y la auditoría
 * sistemática de provenance sobre las 5 frases pedidas.
 *
 * NO se modificó ninguna función compartida con LEGACY (citaActivaPara,
 * crearCitaEspecialista, editarCitaConfirmada, cancelarCita) -- se las usa
 * tal cual, exactamente como ya hacían los adaptadores de los Blockers
 * #0/#4/#5.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  agendarCitaEspecialista,
  cancelarCitaEspecialista,
  moverCitaEspecialista,
  consultarCitasActivasEspecialista,
} from "@/lib/especialistas-flow-adaptador";
import { citasDeEspecialista } from "@/lib/especialistas";
import { applyAiResponseClaimSecurity } from "@/lib/flow/ai-runtime/ai-response-security";
import { detectExternalClaimsInText } from "@/lib/flow/external-claim-security";
import { VERIFIED_RESULTS_VARIABLE_KEY } from "@/lib/flow/ai-runtime/verified-results";
import { EFFECT_RESULT_CLASSIFICATIONS } from "@/lib/flow/executor-types";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// PROVENANCE — auditoría sistemática de las 5 frases pedidas (+ las 2 ya
// conocidas). Sin DB: applyAiResponseClaimSecurity es una función pura.
// ============================================================================

describe("Fase 1 — Blocker #6: auditoría de provenance (5 preguntas por frase)", () => {
  function bloqueadaSinEvidencia(texto: string): boolean {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data: { mode: "respond", responseText: texto } },
      variables: {},
    });
    return r.success === false && r.classification === EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED;
  }

  function bloqueadaConEvidencia(texto: string, source: string, data: Record<string, unknown>): boolean {
    const r = applyAiResponseClaimSecurity({
      dispatchResult: { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data: { mode: "respond", responseText: texto } },
      variables: { [VERIFIED_RESULTS_VARIABLE_KEY]: [{ verified: true, source, data: { ...data, verified: true } }] },
    });
    return r.success === false;
  }

  it('"Ya tienes una cita mañana" -- detectada, exige appointment.reserved, SÍ hay evidencia real que la satisface (agendar_cita_especialista), bloqueada sin evidencia', () => {
    const texto = "Ya tienes una cita mañana";
    assert.deepEqual(detectExternalClaimsInText(texto), ["appointment.reserved"]);
    assert.equal(bloqueadaSinEvidencia(texto), true);
    assert.equal(bloqueadaConEvidencia(texto, "agendar_cita_especialista", { citaId: 1, status: "confirmada" }), false, "con evidencia real de una reserva, esta frase SÍ debe permitirse");
  });

  it('"Tu cita está reservada" -- detectada, exige appointment.reserved, SÍ hay evidencia real que la satisface, bloqueada sin evidencia', () => {
    const texto = "Tu cita está reservada";
    assert.deepEqual(detectExternalClaimsInText(texto), ["appointment.reserved"]);
    assert.equal(bloqueadaSinEvidencia(texto), true);
    assert.equal(bloqueadaConEvidencia(texto, "agendar_cita_especialista", { citaId: 1, status: "confirmada" }), false);
  });

  it('"Tu cita fue cancelada" -- detectada (coincidencia con el patrón de appointment.reserved, NO una capability dedicada a cancelación), bloqueada sin evidencia, y NINGUNA evidencia real de cancelación la satisface jamás', () => {
    const texto = "Tu cita fue cancelada";
    assert.deepEqual(detectExternalClaimsInText(texto), ["appointment.reserved"]);
    assert.equal(bloqueadaSinEvidencia(texto), true);
    // Evidencia REAL y genuina de que la cancelación sí ocurrió -- igual
    // queda bloqueada, porque cancelar_cita_especialista no tiene ninguna
    // capability declarada en action-capabilities.ts (ver Blocker #4/#5).
    // Por diseño, ESTA frase estructuralmente nunca puede "ganarse" con
    // evidencia -- por eso el flow de cancelación usa un mensaje estático
    // de respaldo en vez de depender de que la IA la redacte así.
    assert.equal(bloqueadaConEvidencia(texto, "cancelar_cita_especialista", { citaId: 1, cancelada: true }), true, "ninguna evidencia de cancelación puede desbloquear esta frase hoy");
  });

  it('"Tu cita quedó cambiada" -- mismo patrón que cancelación: detectada por coincidencia, ninguna evidencia real de reagendamiento la satisface jamás', () => {
    const texto = "Tu cita quedó cambiada";
    assert.deepEqual(detectExternalClaimsInText(texto), ["appointment.reserved"]);
    assert.equal(bloqueadaSinEvidencia(texto), true);
    assert.equal(bloqueadaConEvidencia(texto, "mover_cita_especialista", { citaId: 1, movida: true }), true, "ninguna evidencia de reagendamiento puede desbloquear esta frase hoy");
  });

  it('"Te agendé para mañana" -- GAP CERRADO (Blocker #7): detectada, exige appointment.reserved, bloqueada sin evidencia', () => {
    // Causa raíz original: \w de JS es ASCII y no matchea tras vocal
    // acentuada ("agendé"/"agendó"). Corregido en DOMAIN_CAPABILITY_RULES
    // con lookbehind/lookahead sobre el alfabeto español (Blocker #7).
    const texto = "Te agendé para mañana";
    assert.deepEqual(detectExternalClaimsInText(texto), ["appointment.reserved"]);
    assert.equal(bloqueadaSinEvidencia(texto), true, "ya no pasa libre: exige evidencia real");
  });

  it('"Te esperamos mañana" -- GAP CERRADO (Blocker #7): detectada, exige appointment.reserved, bloqueada sin evidencia', () => {
    // Corregido con un patrón acotado a "te esperamos" + referencia
    // temporal/horaria explícita (Blocker #7, gap 2) -- no se agregó
    // "esperamos" como regla global de vocabulario.
    const texto = "Te esperamos mañana";
    assert.deepEqual(detectExternalClaimsInText(texto), ["appointment.reserved"]);
    assert.equal(bloqueadaSinEvidencia(texto), true, "ya no pasa libre: exige evidencia real");
  });

  it("HALLAZGO ADICIONAL CERRADO (Blocker #7): 'existe una cita' ahora se detecta también en esta redacción ('tienes una cita')", () => {
    // Mismo hecho que "Ya tienes una cita mañana" (que ya se detectaba),
    // redactado distinto -- antes el detector era sensible a la redacción
    // exacta; ahora TENER_CITA_INSTANCE reconoce "tener conjugado + cita"
    // en proximidad (máx. 2 palabras intermedias), sin depender de un
    // pronombre tu/te/su literal (Blocker #7, gap 3).
    const texto = "Sí, tienes una cita de manos mañana a las 3.";
    assert.deepEqual(detectExternalClaimsInText(texto), ["appointment.reserved"], "misma afirmación de fondo que 'Ya tienes una cita mañana' -- ahora se detecta igual");
    assert.equal(bloqueadaSinEvidencia(texto), true, "ya no pasa libre: exige evidencia real, igual que la redacción equivalente");
  });

  it("HALLAZGO ARQUITECTÓNICO CERRADO (Blocker #7): consultar_citas_activas_especialista ahora otorga appointment.reserved por lectura real verificada", () => {
    // consultar_citas_activas_especialista se agregó a SOURCE_TO_ACTION y
    // declara verifiesOnSuccess: ["appointment.reserved"] en
    // action-capabilities.ts (Blocker #7, gap 3 -- mitad "evidencia para
    // CONSULTAR"). La corrección de datos (¿de verdad hay una cita?) la
    // garantiza el grafo del flow (cond-tiene-citas-router exige
    // cantidadCitas > 0 antes del nodo AI), no esta capability.
    const texto = "Ya tienes una cita mañana"; // frase que SÍ detecta el guard
    const bloqueadaConLectura = bloqueadaConEvidencia(texto, "consultar_citas_activas_especialista", { cantidadCitas: 1 });
    assert.equal(bloqueadaConLectura, false, "una lectura real y verdadera de consultar_citas_activas_especialista ahora SÍ desbloquea esta frase");
  });
});

// ============================================================================
// CONSISTENCIA DE ESTADO — real, Supabase, tenant descartable
// ============================================================================

describe(
  "Fase 1 — Blocker #6: consistencia del estado real (integración real)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const PHONE_A = `test-blocker6-a-${Date.now()}`;
    const PHONE_B = `test-blocker6-b-${Date.now()}`;
    let especialistaA: number;
    let especialistaB: number;
    let especialistaNicol: number; // requiere_aprobacion:true -> citas "pendiente"

    async function crearCitaDePrueba(phoneNumberId: string, telefonoCliente: string, fecha: string, hora: string) {
      // confirmado:true -- Fase 2b agregó el candado real; este helper crea
      // fixtures de prueba, no prueba el candado en sí.
      const r = await agendarCitaEspecialista(supabase, { phoneNumberId, telefonoCliente, servicio: "manos", fecha, hora, nombreCliente: "Cliente Blocker6", confirmado: true });
      if (!r.ok) throw new Error(`no se pudo crear cita de prueba: ${JSON.stringify(r)}`);
      return r.cita;
    }

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const insertEsp = async (tenantId: string, phoneNumberId: string, numero: string, servicio: string, requiereAprobacion: boolean) => {
        const { data, error } = await supabase
          .from("dulabs_especialistas")
          .insert({ id_tenant: tenantId, phone_number_id: phoneNumberId, nombre: servicio === "pestañas" ? "Nicol" : "Carla", numero_whatsapp: numero, servicio, duracion_min: 60, requiere_aprobacion: requiereAprobacion, bloquea_horario: true, es_general: false, activo: true })
          .select("id").single();
        if (error) throw error;
        return data!.id as number;
      };
      especialistaA = await insertEsp(TENANT_A, PHONE_A, "573000000801", "manos", false);
      especialistaB = await insertEsp(TENANT_B, PHONE_B, "573000000802", "manos", false);
      especialistaNicol = await insertEsp(TENANT_A, PHONE_A, "573000000803", "pestañas", true);
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      await supabase.from("dulabs_citas_especialista").delete().in("phone_number_id", [PHONE_A, PHONE_B]);
      if (especialistaA) await supabase.from("dulabs_especialistas").delete().eq("id", especialistaA);
      if (especialistaB) await supabase.from("dulabs_especialistas").delete().eq("id", especialistaB);
      if (especialistaNicol) await supabase.from("dulabs_especialistas").delete().eq("id", especialistaNicol);
    });

    it("A. cliente sin cita → consultarCitasActivasEspecialista reconoce cantidad 0, nunca inventa una", async () => {
      const r = await consultarCitasActivasEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001120601" });
      assert.equal(r.cantidad, 0);
      assert.deepEqual(r.citas, []);
    });

    it("B/C. cliente con una y con varias citas → recupera exactamente las reales, sin asumir ninguna arbitrariamente", async () => {
      const telefonoCliente = "573001120602";
      const cita1 = await crearCitaDePrueba(PHONE_A, telefonoCliente, "2027-08-01", "10:00");
      let r = await consultarCitasActivasEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente });
      assert.equal(r.cantidad, 1);
      assert.equal(r.citas[0]?.id, cita1.id);

      const cita2 = await crearCitaDePrueba(PHONE_A, telefonoCliente, "2027-08-02", "10:00");
      r = await consultarCitasActivasEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente });
      assert.equal(r.cantidad, 2);
      const ids = r.citas.map((c) => c.id).sort();
      assert.deepEqual(ids, [cita1.id, cita2.id].sort(), "debe devolver AMBAS reales, nunca elegir una sola");
    });

    it("E. consulta sobre cita inexistente (telefonoCliente al azar) → no inventa ninguna", async () => {
      const r = await consultarCitasActivasEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: `no-existe-${randomUUID()}` });
      assert.equal(r.cantidad, 0);
    });

    it("H. cita cancelada nunca aparece como activa (ni en consulta simple ni en la lista completa)", async () => {
      const telefonoCliente = "573001120603";
      const cita = await crearCitaDePrueba(PHONE_A, telefonoCliente, "2027-08-03", "10:00");
      const cancelacion = await cancelarCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente, confirmado: true, citaId: cita.id });
      assert.equal(cancelacion.ok, true);
      const r = await consultarCitasActivasEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente });
      assert.equal(r.cantidad, 0, "una cita cancelada NUNCA debe seguir contando como activa");
    });

    it("I. cita reagendada aparece con la nueva fecha/hora y sigue siendo UNA sola (nunca se duplica)", async () => {
      const telefonoCliente = "573001120604";
      const cita = await crearCitaDePrueba(PHONE_A, telefonoCliente, "2027-08-04", "10:00");
      const movida = await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente, citaId: cita.id, nuevaFecha: "2027-08-05", nuevaHora: "11:00", confirmado: true });
      assert.equal(movida.ok, true);
      const r = await consultarCitasActivasEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente });
      assert.equal(r.cantidad, 1, "sigue siendo UNA sola cita, no dos");
      assert.equal(r.citas[0]?.id, cita.id, "es la MISMA fila reagendada, no una nueva");
      assert.ok(new Date(r.citas[0]!.inicio).getTime() === new Date("2027-08-05T11:00:00-05:00").getTime());
    });

    it("cita PENDIENTE (requiere aprobación): SÍ cuenta como activa, SÍ puede cancelarse, NO puede reagendarse todavía (asimetría documentada, no un bug)", async () => {
      const telefonoCliente = "573001120605";
      const rAgendar = await agendarCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente, servicio: "pestañas", fecha: "2027-08-06", hora: "16:00", nombreCliente: "Cliente Pendiente", confirmado: true });
      assert.equal(rAgendar.ok, true);
      if (!rAgendar.ok) return;
      assert.equal(rAgendar.estado, "pendiente");

      const consulta = await consultarCitasActivasEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente });
      assert.equal(consulta.cantidad, 1, "una cita pendiente SÍ cuenta como activa");

      const intentoReagendar = await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente, citaId: rAgendar.cita.id, nuevaFecha: "2027-08-07", nuevaHora: "16:00", confirmado: true });
      assert.equal(intentoReagendar.ok, false);
      if (!intentoReagendar.ok) assert.equal(intentoReagendar.motivo, "no_reagendable");

      const intentoCancelar = await cancelarCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente, confirmado: true, citaId: rAgendar.cita.id });
      assert.equal(intentoCancelar.ok, true, "una cita pendiente SÍ puede cancelarse");
    });

    it("F/G. matriz de aislamiento -- otro cliente y otro tenant no pueden leer NI operar sobre citas ajenas", async () => {
      const telefonoDueña = "573001120606";
      const citaDueña = await crearCitaDePrueba(PHONE_A, telefonoDueña, "2027-08-08", "10:00");

      // Otro cliente del MISMO negocio: su propia consulta no ve la cita ajena.
      const otroCliente = await consultarCitasActivasEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001120699-ajeno" });
      assert.equal(otroCliente.cantidad, 0);
      const intentoOtroClienteCancelar = await cancelarCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001120699-ajeno", confirmado: true, citaId: citaDueña.id });
      assert.equal(intentoOtroClienteCancelar.ok, false);
      const intentoOtroClienteMover = await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001120699-ajeno", citaId: citaDueña.id, nuevaFecha: "2027-08-09", nuevaHora: "10:00", confirmado: true });
      assert.equal(intentoOtroClienteMover.ok, false);

      // Mismo número de teléfono, pero desde OTRO tenant/phone_number_id.
      const otroTenant = await consultarCitasActivasEspecialista(supabase, { phoneNumberId: PHONE_B, telefonoCliente: telefonoDueña });
      assert.equal(otroTenant.cantidad, 0, "el mismo teléfono en otro negocio no debe ver nada");
      const intentoOtroTenantCancelar = await cancelarCitaEspecialista(supabase, { phoneNumberId: PHONE_B, telefonoCliente: telefonoDueña, confirmado: true, citaId: citaDueña.id });
      assert.equal(intentoOtroTenantCancelar.ok, false);

      // La cita de la dueña real sigue exactamente intacta después de los 4 intentos ajenos.
      const { data: sigueIntacta } = await supabase.from("dulabs_citas_especialista").select("estado, inicio").eq("id", citaDueña.id).single();
      assert.equal(sigueIntacta!.estado, "confirmada");
      assert.ok(sigueIntacta!.inicio.startsWith("2027-08-08"));
    });

    it("N. consistencia lectura-después-de-escritura: cada operación se refleja INMEDIATAMENTE en la siguiente consulta", async () => {
      const telefonoCliente = "573001120607";
      assert.equal((await consultarCitasActivasEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente })).cantidad, 0);

      const cita = await crearCitaDePrueba(PHONE_A, telefonoCliente, "2027-08-10", "10:00");
      assert.equal((await consultarCitasActivasEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente })).cantidad, 1, "debe verse inmediatamente después de crear");

      await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente, citaId: cita.id, nuevaFecha: "2027-08-11", nuevaHora: "10:00", confirmado: true });
      const trasReagendar = await consultarCitasActivasEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente });
      assert.equal(trasReagendar.cantidad, 1);
      assert.ok(trasReagendar.citas[0]!.inicio.startsWith("2027-08-11"), "debe reflejar el nuevo horario inmediatamente después de reagendar");

      await cancelarCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente, confirmado: true, citaId: cita.id });
      assert.equal((await consultarCitasActivasEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente })).cantidad, 0, "debe reflejar la cancelación inmediatamente después de cancelar");
    });

    it("O. el dashboard (citasDeEspecialista, misma tabla) siempre ve exactamente el mismo estado que el adaptador", async () => {
      const telefonoCliente = "573001120608";
      const cita = await crearCitaDePrueba(PHONE_A, telefonoCliente, "2027-08-12", "10:00");
      let dashboard = await citasDeEspecialista(supabase, especialistaA);
      assert.ok(dashboard.some((c) => c.id === cita.id && c.estado === "confirmada"));

      await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente, citaId: cita.id, nuevaFecha: "2027-08-13", nuevaHora: "10:00", confirmado: true });
      dashboard = await citasDeEspecialista(supabase, especialistaA);
      const vistaTrasMover = dashboard.find((c) => c.id === cita.id);
      assert.ok(vistaTrasMover?.inicio.startsWith("2027-08-13"));

      await cancelarCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente, confirmado: true, citaId: cita.id });
      dashboard = await citasDeEspecialista(supabase, especialistaA);
      const vistaTrasCancelar = dashboard.find((c) => c.id === cita.id);
      assert.equal(vistaTrasCancelar?.estado, "cancelada", "el dashboard ve la cancelación real, no un estado desactualizado");
    });

    it("P. sin estado fantasma: si la cita no existe en la BD real, el adaptador jamás reporta que existe", async () => {
      const idInexistente = 999999998;
      const r1 = await cancelarCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001120609", confirmado: true, citaId: idInexistente });
      assert.equal(r1.ok, false);
      const r2 = await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001120609", citaId: idInexistente, nuevaFecha: "2027-08-14", nuevaHora: "10:00", confirmado: true });
      assert.equal(r2.ok, false);
    });

    it("Q. sin éxito fantasma: cuando la operación real falla (horario ocupado), la respuesta NUNCA tiene forma de éxito", async () => {
      const telefonoCliente1 = "573001120610";
      const telefonoCliente2 = "573001120611";
      await crearCitaDePrueba(PHONE_A, telefonoCliente2, "2027-08-15", "15:00");
      const citaAMover = await crearCitaDePrueba(PHONE_A, telefonoCliente1, "2027-08-15", "10:00");
      const r = await moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: telefonoCliente1, citaId: citaAMover.id, nuevaFecha: "2027-08-15", nuevaHora: "15:00", confirmado: true });
      assert.equal(r.ok, false, "un fallo real de la operación NUNCA debe reportarse como ok:true");
      assert.equal("cita" in r, false, "un resultado ok:false no debe traer ningún objeto 'cita' que parezca evidencia de éxito");
    });

    it("K/L/M consolidado: tres tipos de concurrencia sobre el MISMO horario nuevo -- crear, reagendar y cancelar -- todas terminan en un estado final consistente", async () => {
      // K: crear la misma cita dos veces a la vez.
      const [crear1, crear2] = await Promise.all([
        agendarCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001120612", servicio: "manos", fecha: "2027-08-16", hora: "09:00", nombreCliente: "Concurrencia K-1", confirmado: true }),
        agendarCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001120613", servicio: "manos", fecha: "2027-08-16", hora: "09:00", nombreCliente: "Concurrencia K-2", confirmado: true }),
      ]);
      assert.equal([crear1, crear2].filter((r) => r.ok).length, 1, "K: solo una debe ganar el horario nuevo");

      // L: dos citas EXISTENTES intentando reagendarse al mismo horario nuevo.
      const citaL1 = await crearCitaDePrueba(PHONE_A, "573001120614", "2027-08-17", "09:00");
      const citaL2 = await crearCitaDePrueba(PHONE_A, "573001120615", "2027-08-17", "11:00");
      const [mover1, mover2] = await Promise.all([
        moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001120614", citaId: citaL1.id, nuevaFecha: "2027-08-17", nuevaHora: "17:00", confirmado: true }),
        moverCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001120615", citaId: citaL2.id, nuevaFecha: "2027-08-17", nuevaHora: "17:00", confirmado: true }),
      ]);
      assert.equal([mover1, mover2].filter((r) => r.ok).length, 1, "L: solo una debe ganar el nuevo horario");

      // M: cancelación concurrente de la MISMA cita.
      const citaM = await crearCitaDePrueba(PHONE_A, "573001120616", "2027-08-18", "09:00");
      const [cancelar1, cancelar2] = await Promise.all([
        cancelarCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001120616", confirmado: true, citaId: citaM.id }),
        cancelarCitaEspecialista(supabase, { phoneNumberId: PHONE_A, telefonoCliente: "573001120616", confirmado: true, citaId: citaM.id }),
      ]);
      assert.equal([cancelar1, cancelar2].filter((r) => r.ok).length, 1, "M: solo un intento de cancelación debe reportar éxito real");
      const { data: estadoFinal } = await supabase.from("dulabs_citas_especialista").select("estado").eq("id", citaM.id).single();
      assert.equal(estadoFinal!.estado, "cancelada", "M: el estado final es consistente sin importar cuál de las dos 'ganó'");
    });
  },
);
