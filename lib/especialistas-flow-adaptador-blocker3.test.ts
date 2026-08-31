/**
 * Fase 1 (Blocker #3, autorizado) — servicio no existente / no manejado.
 *
 * categoriaDeServicioReconocida() es EXCLUSIVA del adaptador de Flow
 * (lib/especialistas-flow-adaptador.ts) -- NO se tocó categoriaDeServicio()
 * (lib/especialistas.ts, compartida con LEGACY). Ver el docstring de
 * categoriaDeServicioReconocida() para el porqué de la duplicación
 * deliberada.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  categoriaDeServicioReconocida,
  consultarDisponibilidadEspecialista,
  agendarCitaEspecialista,
} from "@/lib/especialistas-flow-adaptador";
import { createFlowEngineState, runFlowEngine } from "@/lib/flow/flow-engine";
import { danielaAgendarCitaFlow } from "@/lib/flows/daniela-agendar-cita.flow";
import { applyAiResponseClaimSecurity } from "@/lib/flow/ai-runtime/ai-response-security";
import { EFFECT_RESULT_CLASSIFICATIONS } from "@/lib/flow/executor-types";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("Fase 1 — categoriaDeServicioReconocida (sin DB)", () => {
  it("1. servicios válidos de manos → 'manos'", () => {
    for (const s of ["manos", "uñas", "unas", "press on", "pressON", "semipermanente en manos", "dipping", "base rubber", "forrado en gel", "forrado en acrílico", "acrílicas", "acrilicas", "cejas", "cejas con henna"]) {
      assert.equal(categoriaDeServicioReconocida(s), "manos", `"${s}" debería reconocerse como manos`);
    }
  });

  it("2. servicios válidos de pies → 'pies'", () => {
    for (const s of ["pies", "semipermanente en pies", "pedicure", "pedicure semipermanente"]) {
      assert.equal(categoriaDeServicioReconocida(s), "pies", `"${s}" debería reconocerse como pies`);
    }
  });

  it("3. 'pestañas' no pasa por categoría (se resuelve como especialidad exclusiva vía especialistaPorServicio, no aquí) -- pero si alguien la consultara igual no debe caer a manos por accidente", () => {
    // categoriaDeServicioReconocida no reconoce "pestañas" a propósito: esa
    // palabra nunca debería llegar hasta acá (especialistaPorServicio la
    // resuelve antes, ver resolverCandidatas). Verificamos que, si de
    // cualquier forma llegara, NO se cuela como "manos" por error.
    assert.equal(categoriaDeServicioReconocida("pestañas"), null);
    assert.equal(categoriaDeServicioReconocida("pestañas volumen ruso"), null);
  });

  it("4. 'masaje' → sin categoría", () => {
    assert.equal(categoriaDeServicioReconocida("masaje"), null);
    assert.equal(categoriaDeServicioReconocida("quiero un masaje relajante"), null);
  });

  it("5. 'depilación' (sola, sin 'cejas') → sin categoría -- ambigua, no se asume", () => {
    assert.equal(categoriaDeServicioReconocida("depilación"), null);
    assert.equal(categoriaDeServicioReconocida("quiero depilación"), null);
  });

  it("6. texto completamente desconocido → sin categoría", () => {
    for (const s of ["limpieza facial", "un servicio que ustedes no ofrecen", "xyz123", "corte de cabello", ""]) {
      assert.equal(categoriaDeServicioReconocida(s), null, `"${s}" no debería reconocerse`);
    }
  });

  it("10a. no se rompe ningún servicio existente (regresión de nombres reales del menú de Daniela)", () => {
    const reconocidosManos = ["press on", "semipermanente", "dipping", "base rubber", "forrado en gel", "forrado en acrílico", "acrílicas", "cejas, depilación sola", "cejas, depilación con henna", "retoque de forrado"];
    for (const s of reconocidosManos) assert.equal(categoriaDeServicioReconocida(s), "manos", `"${s}" es un servicio real del menú, no debe romperse`);
    assert.equal(categoriaDeServicioReconocida("semipermanente en pies"), "pies");
  });
});

describe(
  "Fase 1 — Blocker #3 (integración real, tenant descartable)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    let supabase: SupabaseClient;
    const TENANT_ID = randomUUID();
    const PHONE_NUMBER_ID = `test-blocker3-${Date.now()}`;
    let especialistaId: number;
    const FECHA = "2027-05-10";

    before(async () => {
      if (!HAS_SUPABASE) return;
      supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data: esp, error } = await supabase
        .from("dulabs_especialistas")
        .insert({
          id_tenant: TENANT_ID,
          phone_number_id: PHONE_NUMBER_ID,
          nombre: "Carla",
          numero_whatsapp: "573000000501",
          servicio: "manos",
          duracion_min: 60,
          requiere_aprobacion: false,
          bloquea_horario: true,
          es_general: false,
          activo: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      especialistaId = esp!.id as number;
    });

    after(async () => {
      if (!HAS_SUPABASE) return;
      await supabase.from("dulabs_citas_especialista").delete().eq("phone_number_id", PHONE_NUMBER_ID);
      if (especialistaId) await supabase.from("dulabs_especialistas").delete().eq("id", especialistaId);
    });

    it("1b. servicio válido de manos → resuelve disponibilidad con Carla", async () => {
      const r = await consultarDisponibilidadEspecialista(supabase, { phoneNumberId: PHONE_NUMBER_ID, servicio: "semipermanente en manos", fecha: FECHA });
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.especialistaResuelto, "Carla");
    });

    it("7. servicio desconocido + intento de agendar → NO crea cita", async () => {
      const telefonoCliente = "573003330007";
      // confirmado:true -- Fase 2b agregó el candado real ANTES de este
      // chequeo; este test prueba la validación de servicio, no el candado.
      const r = await agendarCitaEspecialista(supabase, {
        phoneNumberId: PHONE_NUMBER_ID,
        telefonoCliente,
        servicio: "limpieza facial",
        fecha: FECHA,
        hora: "11:00",
        nombreCliente: "Cliente Blocker3",
        confirmado: true,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "servicio_no_manejado");

      const { data: citas } = await supabase
        .from("dulabs_citas_especialista")
        .select("id")
        .eq("phone_number_id", PHONE_NUMBER_ID)
        .eq("telefono_cliente", telefonoCliente);
      assert.equal(citas?.length, 0, "no debe existir ninguna cita real para un servicio no manejado");
    });

    it("9. servicio desconocido → no ejecuta ni asigna ninguna especialista", async () => {
      const r = await consultarDisponibilidadEspecialista(supabase, { phoneNumberId: PHONE_NUMBER_ID, servicio: "un servicio que ustedes no ofrecen", fecha: FECHA });
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.motivo, "servicio_no_manejado");
        // El tipo de ResultadoDisponibilidadEspecialista en rama ok:false
        // NUNCA incluye especialistaResuelto -- estructuralmente no puede
        // asignar a nadie.
        assert.equal("especialistaResuelto" in r, false);
      }
    });

    it("8. servicio desconocido → el FLOW real permite continuar (no muere, informa y vuelve a preguntar)", () => {
      const flow = danielaAgendarCitaFlow();
      let state = createFlowEngineState(flow, { executionId: randomUUID() });
      state.variables = { ...state.variables, hoy: "2027-05-01" };
      // Fase 3 (slot-filling) — el flow ahora arranca con ai-extraer. Se
      // resuelve con {} (nada extraído del primer mensaje), así se preguntan
      // los 4 datos en secuencia, exactamente como antes.
      state = runFlowEngine(flow, state, { type: "start", text: "quiero una cita" }).state;
      assert.equal(state.pendingEffect?.nodeId, "ai-extraer");
      state = runFlowEngine(flow, state, {
        type: "effect_result",
        success: true,
        effectId: state.pendingEffect!.effectId,
        data: {},
      }).state;
      for (const texto of ["masaje", "2027-05-10", "11:00", "Cliente Blocker3"]) {
        state = runFlowEngine(flow, state, { type: "text", text: texto }).state;
      }
      // act-consultar es una acción DIRECTA (q-nombre/cond-nombre conectan a
      // ella sin nodo AI intermedio); el motor queda esperando su efecto.
      assert.equal(state.status, "waiting_effect");
      assert.equal(state.pendingEffect?.nodeId, "act-consultar");
      const fallo = runFlowEngine(flow, state, {
        type: "effect_result",
        success: false,
        effectId: state.pendingEffect!.effectId,
        error: "servicio_no_manejado",
      });

      // ANTES del Blocker #3: esto era engineError (INVALID_INPUT), la
      // conversación moría sin enviar nada. AHORA: sin error, informa, y
      // vuelve a esperar el servicio -- la conversación sigue.
      assert.equal(fallo.error, undefined, "el Flow NO debe morir para un servicio no reconocido");
      assert.ok(
        fallo.effects.some((e) => e.type === "send_message" && e.nodeId === "msg-servicio-no-reconocido"),
        "debe informar a la clienta que ese servicio no se maneja",
      );
      assert.equal(fallo.state.currentNodeId, "q-servicio");
      assert.equal(fallo.state.status, "waiting_input", "vuelve a preguntar el servicio -- la conversación continúa");
    });

    it("SEGURIDAD: sin cita real ni provenance, ninguna afirmación de reserva puede pasar el guard EXISTENTE (sin tocar external-claim-security.ts)", () => {
      // Estado real tras un servicio no reconocido: variables SIN
      // __verifiedResults de agendar_cita_especialista (nunca corrió).
      // "Te esperamos mañana" -- GAP CERRADO (Blocker #7): el patrón acotado
      // "te esperamos" + referencia temporal ahora sí la detecta y bloquea,
      // igual que las otras dos frases. Antes era un hallazgo documentado
      // como abierto; ya no lo es.
      const variablesSinEvidencia = {};
      const frases = ["Tu cita está reservada", "Ya tienes tu espacio", "Te esperamos mañana"];
      const resultados = frases.map((texto) => {
        const r = applyAiResponseClaimSecurity({
          dispatchResult: { success: true, classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS, data: { mode: "respond", responseText: texto } },
          variables: variablesSinEvidencia,
        });
        return { texto, bloqueado: r.success === false && r.classification === EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED };
      });
      for (const r of resultados) {
        assert.equal(r.bloqueado, true, `"${r.texto}" debe seguir bloqueada sin evidencia`);
      }
    });
  },
);
