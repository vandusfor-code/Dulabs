/**
 * BUG A y BUG A.2 — FIX APLICADO (auditoría E2E destructiva, autorizados
 * explícitamente por separado).
 *
 * ============================================================
 * BUG A — mapeo de capabilities (DOMAIN_CAPABILITY_RULES)
 * ============================================================
 * MECANISMO EXACTO que causaba el rechazo falso (rastreado línea por línea):
 *
 * 1. DOMAIN_CAPABILITY_RULES (external-claim-security.ts) conflacionaba dos
 *    cosas distintas en UNA sola regla: el SUSTANTIVO de dominio
 *    "cita|citas|horario|turno|espacio" (de qué se habla -- no dice nada
 *    sobre su estado) y los VERBOS de reserva "reserv|agend|asegur" (qué se
 *    afirma sobre eso). Ambos quedaban unidos por "|" y mapeados a la MISMA
 *    capability, appointment.reserved -- como si mencionar el sustantivo
 *    fuera equivalente a afirmar que se reservó.
 * 2. detectDomainCapabilities es una UNIÓN de todas las reglas que matchean,
 *    no una selección exclusiva. "Encontré disponibilidad para tu CITA..."
 *    matcheaba DOS reglas a la vez: la de "cita" (-> appointment.reserved) Y
 *    la de "disponib" (-> appointment.available). Exigía AMBAS, aunque el
 *    texto solo afirma la segunda.
 * 3. requiredCapabilitiesForIntent, rama "external_claim": exige el conjunto
 *    COMPLETO de domainCaps sin filtrar cuál corresponde a lo que el texto
 *    afirma realmente.
 *
 * FIX: el sustantivo de dominio, MENCIONADO SOLO, ya no exige ninguna
 * capability por sí mismo. Se agregó "confirm" al grupo de verbos de reserva
 * (junto a reserv/agend/asegur) -- necesario porque "Tu cita quedó
 * CONFIRMADA" dependía únicamente del sustantivo. Excepción angosta: "tienes/
 * tengo + cita" (adyacencia real, vía TENER_CITA_INSTANCE, patrón ya
 * existente en el archivo) sigue exigiendo appointment.reserved -- es una
 * afirmación de que la reserva YA EXISTE, no una descripción de
 * disponibilidad.
 *
 * ============================================================
 * BUG A.2 — SOURCE_TO_ACTION no reconocía el actionType real de Daniela
 * ============================================================
 * CONEXIÓN REAL investigada de punta a punta antes del fix:
 *
 * 1. act-consultar (daniela-agendar-cita.flow.ts, línea ~158) tiene
 *    config: { actionType: "consultar_disponibilidad_especialista" } --
 *    confirmado leyendo el nodo real, no supuesto.
 * 2. InternalActionExecutor despacha esa acción contra
 *    dulabs_especialistas/dulabs_citas_especialista (consultarDisponibilidadEspecialista,
 *    lib/especialistas.ts) y devuelve dispatchResult.success=true con la
 *    disponibilidad real en dispatchResult.appliedResult/data.
 * 3. flow-orchestrator.ts (registerAndDispatchEffects), SOLO cuando
 *    dispatchResult.success===true, llama a
 *    buildVerifiedActionEffectData({ action: effect.action, ... }) --
 *    effect.action ES el ActionNodeConfig real del nodo, con
 *    actionType:"consultar_disponibilidad_especialista".
 * 4. buildVerifiedActionEffectData (verified-results.ts) llama a
 *    resolveActionSourceKey(action), que para cualquier actionType que NO
 *    sea "webhook_http" devuelve config.actionType TAL CUAL -- por lo tanto
 *    el `source` real que llega a __verifiedResults es literalmente
 *    "consultar_disponibilidad_especialista".
 * 5. applyAiResponseClaimSecurity llama a
 *    extractVerifiedCapabilitiesFromVariables, que por cada entrada de
 *    __verifiedResults llama a capabilitiesFromVerifiedEntry(entry) --
 *    esta función hace `SOURCE_TO_ACTION[entry.source]` y, si no existe la
 *    clave, hace early-return ([]) SIN mirar nada más.
 * 6. SOURCE_TO_ACTION (antes de este fix) NO tenía la clave
 *    "consultar_disponibilidad_especialista" -- solo tenía
 *    "consultar_disponibilidad" (SIN el sufijo, una entrada legacy
 *    webhook_http/marketplace, actionType distinto). Por eso CUALQUIER
 *    evidencia real y genuina que act-consultar produjera se descartaba
 *    sin ser evaluada.
 *
 * La capability que corresponde ya estaba correctamente declarada en
 * action-capabilities.ts (línea ~69-73):
 *   consultar_disponibilidad_especialista: { verifiesOnSuccess: ["appointment.available"], outputVariables: ["disponible"] }
 * -- es decir, la ÚNICA capability que esta acción puede respaldar es
 * appointment.available, nunca appointment.reserved.
 *
 * FIX (autorizado, aplicado en external-claim-security.ts, SOURCE_TO_ACTION):
 *   consultar_disponibilidad_especialista: { actionType: "consultar_disponibilidad_especialista", params: {} }
 * -- misma forma exacta que las entradas hermanas ya existentes
 * (agendar_cita_especialista, consultar_citas_activas_especialista). Esto
 * NO inventa ninguna capability nueva ni relaja ningún criterio: solo deja
 * que resolveActionCapabilitySpec encuentre el spec YA declarado en
 * action-capabilities.ts para este actionType. El único gate para que
 * exista evidencia sigue siendo dispatchResult.success de una acción REAL.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyAiResponseClaimSecurity } from "@/lib/flow/ai-runtime/ai-response-security";
import { analyzeTextForExternalClaims, extractVerifiedCapabilitiesFromVariables } from "@/lib/flow/external-claim-security";
import { EFFECT_RESULT_CLASSIFICATIONS } from "@/lib/flow/executor-types";

// Evidencia que act-consultar produce en el mundo real -- únicamente
// appointment.available, nunca appointment.reserved (consultar disponibilidad
// no reserva nada). source = el actionType REAL de Daniela.
const VARIABLES_CON_EVIDENCIA_DE_DISPONIBILIDAD_REAL = {
  servicio: "semipermanente en manos",
  fecha: "2026-09-04",
  hora: "17:00",
  especialista: "Carla",
  disponible: true,
  __verifiedResults: [
    {
      source: "consultar_disponibilidad_especialista",
      verified: true,
      data: { source: "consultar_disponibilidad_especialista", verified: true, disponible: true, especialista: "Carla" },
    },
  ],
};

// Misma forma, pero SIN verified:true -- simula una entrada fabricada/no
// verificada. Debe seguir sin otorgar NINGUNA capability (fail-closed).
const VARIABLES_CON_EVIDENCIA_NO_VERIFICADA = {
  ...VARIABLES_CON_EVIDENCIA_DE_DISPONIBILIDAD_REAL,
  __verifiedResults: [
    {
      source: "consultar_disponibilidad_especialista",
      verified: false,
      data: { source: "consultar_disponibilidad_especialista", verified: false, disponible: true, especialista: "Carla" },
    },
  ],
};

// Evidencia REAL de una reserva confirmada (agendar_cita_especialista) --
// para probar que consultar disponibilidad y agendar siguen siendo
// capabilities completamente separadas.
const VARIABLES_CON_EVIDENCIA_DE_RESERVA_REAL = {
  __verifiedResults: [
    {
      source: "agendar_cita_especialista",
      verified: true,
      data: { source: "agendar_cita_especialista", verified: true, citaId: 123 },
    },
  ],
};

function dispatchResultConTexto(texto: string) {
  return {
    success: true as const,
    classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
    data: { responseText: texto, __textProvenance: "AI_GENERATED_TEXT" },
    appliedResult: { responseText: texto, __textProvenance: "AI_GENERATED_TEXT" },
  };
}

const TEXTO_DISPONIBILIDAD_REAL =
  "¡Hola Ana! Encontré disponibilidad para tu cita de semipermanente en manos el viernes 4 de septiembre a las 5:00 pm, con Carla.";

describe("Bug A — fix aplicado a external-claim-security.ts (DOMAIN_CAPABILITY_RULES)", () => {
  describe("Casos A-F pedidos explícitamente (requiredCapabilities puro, vía analyzeTextForExternalClaims)", () => {
    it("A. 'Encontré disponibilidad para tu cita...' -> exige appointment.available, NO appointment.reserved", () => {
      const caps = analyzeTextForExternalClaims(TEXTO_DISPONIBILIDAD_REAL).requiredCapabilities;
      assert.ok(caps.includes("appointment.available"), "debe exigir available -- es lo único que el texto afirma");
      assert.ok(!caps.includes("appointment.reserved"), "FIX: ya NO debe exigir reserved solo por la palabra 'cita'");
    });

    it("B. 'Tu cita quedó reservada...' -> exige appointment.reserved", () => {
      const caps = analyzeTextForExternalClaims("Tu cita quedó reservada para el viernes 4 de septiembre a las 5:00 pm con Carla.").requiredCapabilities;
      assert.ok(caps.includes("appointment.reserved"), "afirmar una reserva SÍ debe exigir evidencia de reserva");
    });

    it("C. 'Tu cita quedó agendada...' -> exige appointment.reserved", () => {
      const caps = analyzeTextForExternalClaims("Tu cita quedó agendada para el viernes 4 de septiembre a las 5:00 pm con Carla.").requiredCapabilities;
      assert.ok(caps.includes("appointment.reserved"));
    });

    it("D. 'Tu cita quedó confirmada...' -> exige appointment.reserved", () => {
      const caps = analyzeTextForExternalClaims("Tu cita quedó confirmada para el viernes 4 de septiembre a las 5:00 pm con Carla.").requiredCapabilities;
      assert.ok(caps.includes("appointment.reserved"));
    });

    it("D-control-2. 'Quedó confirmada...' SIN la palabra 'cita' -> SIGUE exigiendo appointment.reserved -- prueba que la protección viene del verbo 'confirm' agregado, no solo del sustantivo", () => {
      const caps = analyzeTextForExternalClaims("Quedó confirmada para el viernes 4 de septiembre a las 5:00 pm con Carla.").requiredCapabilities;
      assert.ok(
        caps.includes("appointment.reserved"),
        "sin esto, quitar 'cita' de la regla vieja habría sido una regresión fail-open real",
      );
    });

    it("E. 'Hay un horario disponible para tu cita...' -> exige appointment.available, NO appointment.reserved", () => {
      const caps = analyzeTextForExternalClaims("Hay un horario disponible para tu cita el viernes 4 de septiembre a las 5:00 pm con Carla.").requiredCapabilities;
      assert.ok(caps.includes("appointment.available"));
      assert.ok(!caps.includes("appointment.reserved"), "FIX: 'horario' tampoco debe exigir reserved por sí solo");
    });

    it("F. Sin ninguna afirmación de disponibilidad/reserva -> no inventa capabilities", () => {
      const caps = analyzeTextForExternalClaims("¡Hola! ¿En qué puedo ayudarte hoy?").requiredCapabilities;
      assert.deepEqual(caps, []);
    });
  });

  describe("Extremo a extremo (applyAiResponseClaimSecurity), CON la evidencia REAL de Daniela (source real, tras Bug A + Bug A.2)", () => {
    it("FAIL-BEFORE / PASS-AFTER (Bug A.2): el texto real, con evidencia REAL (source='consultar_disponibilidad_especialista'), ahora SÍ pasa de punta a punta", () => {
      // Con el código ANTERIOR a Bug A.2 (SOURCE_TO_ACTION sin esta clave),
      // este mismo llamado devolvía success:false con
      // error="unverified_external_claim:appointment.available" -- pese a
      // que la evidencia era 100% real. Es la prueba fail-before/pass-after:
      // documentado en el mensaje en vez de revertir el código (revertir
      // requeriría deshacer un fix ya autorizado y aplicado).
      const resultado = applyAiResponseClaimSecurity({
        dispatchResult: dispatchResultConTexto(TEXTO_DISPONIBILIDAD_REAL),
        variables: VARIABLES_CON_EVIDENCIA_DE_DISPONIBILIDAD_REAL,
      });
      assert.equal(
        resultado.success,
        true,
        "PASS-AFTER: con Bug A + Bug A.2 corregidos, evidencia real de disponibilidad respalda un texto real que solo afirma disponibilidad",
      );
    });

    it("control: la MISMA información, sin la palabra 'cita', también pasa (ya pasaba antes de Bug A.2 -- cae en un camino de clasificación que no exige ninguna capability)", () => {
      const textoSinPalabraCita =
        "¡Hola Ana! Encontré disponibilidad para semipermanente en manos el viernes 4 de septiembre a las 5:00 pm, con Carla.";
      const resultado = applyAiResponseClaimSecurity({
        dispatchResult: dispatchResultConTexto(textoSinPalabraCita),
        variables: VARIABLES_CON_EVIDENCIA_DE_DISPONIBILIDAD_REAL,
      });
      assert.equal(resultado.success, true);
    });

    it("control: 'Tu cita quedó confirmada' SIGUE RECHAZADO con evidencia de disponibilidad (real, reconocida) -- Bug A.2 no debilita el requisito de appointment.reserved", () => {
      const r = applyAiResponseClaimSecurity({
        dispatchResult: dispatchResultConTexto("Tu cita quedó confirmada para el viernes."),
        variables: VARIABLES_CON_EVIDENCIA_DE_DISPONIBILIDAD_REAL, // solo appointment.available, ahora SÍ reconocida -- pero sigue siendo insuficiente para ESTE claim
      });
      assert.equal(r.success, false, "correcto: afirmar una reserva con SOLO evidencia de disponibilidad (aunque ya se reconozca) sigue debiendo bloquearse");
    });

    it("control: con evidencia de RESERVA real (agendar_cita_especialista), 'Tu cita quedó confirmada' SÍ pasa -- la capability correcta sigue siendo la que realmente respalda la reserva", () => {
      const r = applyAiResponseClaimSecurity({
        dispatchResult: dispatchResultConTexto("Tu cita quedó confirmada para el viernes."),
        variables: VARIABLES_CON_EVIDENCIA_DE_RESERVA_REAL,
      });
      assert.equal(r.success, true);
    });
  });

  describe("Bug A.2 — FIX APLICADO: SOURCE_TO_ACTION reconoce el actionType real de Daniela", () => {
    it("FAIL-BEFORE / PASS-AFTER: consultar_disponibilidad_especialista (source REAL de act-consultar) ahora SÍ se reconoce como evidencia de appointment.available", () => {
      // Antes de este fix: extractVerifiedCapabilitiesFromVariables(...).size === 0
      // (SOURCE_TO_ACTION carecía de la clave). Documentado en el mensaje de
      // abajo en vez de revertir el código.
      const verified = extractVerifiedCapabilitiesFromVariables(VARIABLES_CON_EVIDENCIA_DE_DISPONIBILIDAD_REAL);
      assert.ok(
        verified.has("appointment.available"),
        "PASS-AFTER: SOURCE_TO_ACTION ahora reconoce 'consultar_disponibilidad_especialista' -- antes esto era un Set vacío",
      );
    });

    it("requisito #1 (7): una disponibilidad real SÍ respalda appointment.available", () => {
      const verified = extractVerifiedCapabilitiesFromVariables(VARIABLES_CON_EVIDENCIA_DE_DISPONIBILIDAD_REAL);
      assert.ok(verified.has("appointment.available"));
    });

    it("requisito #2 (7): una disponibilidad real NO respalda appointment.reserved -- son capabilities separadas, este fix no las mezcla", () => {
      const verified = extractVerifiedCapabilitiesFromVariables(VARIABLES_CON_EVIDENCIA_DE_DISPONIBILIDAD_REAL);
      assert.ok(!verified.has("appointment.reserved"), "consultar disponibilidad NUNCA debe poder respaldar una afirmación de reserva");
    });

    it("requisito #3 (7): una cita creada/confirmada (agendar_cita_especialista) sigue exigiendo SU evidencia -- no se ve afectada por este fix, y tampoco respalda appointment.available", () => {
      const verified = extractVerifiedCapabilitiesFromVariables(VARIABLES_CON_EVIDENCIA_DE_RESERVA_REAL);
      assert.ok(verified.has("appointment.reserved"), "agendar_cita_especialista sigue respaldando reserved -- sin cambios");
      assert.ok(!verified.has("appointment.available"), "agendar_cita_especialista NUNCA debe respaldar available -- no se mezclan las capabilities");
    });

    it("requisito #4 (7): NO se abre ninguna ruta fail-open -- una entrada CON el source correcto pero verified:false sigue sin otorgar ninguna capability", () => {
      const verified = extractVerifiedCapabilitiesFromVariables(VARIABLES_CON_EVIDENCIA_NO_VERIFICADA);
      assert.equal(verified.size, 0, "verified:false debe seguir bloqueando el reconocimiento, sin importar que el source ahora sea reconocido");
    });

    it("control: 'consultar_disponibilidad' (source legacy, SIN el sufijo '_especialista') seguía y sigue reconociéndose -- confirma que el fix no tocó esa entrada preexistente", () => {
      const variablesLegacy = {
        __verifiedResults: [{ source: "consultar_disponibilidad", verified: true, data: { disponible: true } }],
      };
      const verified = extractVerifiedCapabilitiesFromVariables(variablesLegacy);
      assert.ok(verified.has("appointment.available"));
    });
  });
});
