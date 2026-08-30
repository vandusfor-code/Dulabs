/**
 * Fase 0 (autorizado) — gate de prueba por remitente, sin DB.
 *
 * debeUsarFlow() (el gate original de 2 columnas) NO se toca ni se
 * re-testea acá -- sus tests siguen en especialistas-flow-adaptador.test.ts,
 * intactos. Este archivo cubre exclusivamente debeUsarFlowParaRemitente(),
 * la función nueva que compone sobre él.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { debeUsarFlowParaRemitente } from "@/lib/flow-routing";

const PHONE_DANIELA = "1282448611609227";
const REMITENTE_314_AUTORIZADO = "573148127388";
const OTRO_REMITENTE_REAL = "573001112233";

describe("Fase 0 — debeUsarFlowParaRemitente (gate de prueba por remitente)", () => {
  it("2. flow_activo=true + remitente 314 autorizado → Flow", () => {
    assert.equal(
      debeUsarFlowParaRemitente(
        { flow_activo: true, flow_id: "flow-x", phone_number_id: PHONE_DANIELA },
        REMITENTE_314_AUTORIZADO,
      ),
      true,
    );
  });

  it("3. flow_activo=true + remitente distinto → LEGACY (no autorizado)", () => {
    assert.equal(
      debeUsarFlowParaRemitente(
        { flow_activo: true, flow_id: "flow-x", phone_number_id: PHONE_DANIELA },
        OTRO_REMITENTE_REAL,
      ),
      false,
    );
  });

  it("4. flow_activo=false → nunca Flow, ni siquiera para el remitente autorizado", () => {
    assert.equal(
      debeUsarFlowParaRemitente(
        { flow_activo: false, flow_id: null, phone_number_id: PHONE_DANIELA },
        REMITENTE_314_AUTORIZADO,
      ),
      false,
    );
    assert.equal(
      debeUsarFlowParaRemitente(
        { flow_activo: false, flow_id: null, phone_number_id: PHONE_DANIELA },
        OTRO_REMITENTE_REAL,
      ),
      false,
    );
  });

  it("6a. estado inconsistente (flow_activo=true sin flow_id) → LEGACY aunque el remitente esté en la lista de prueba", () => {
    // Prueba de que la restricción por remitente NUNCA puede otorgar Flow
    // por sí sola: si debeUsarFlow ya dice que no (estado inconsistente),
    // el remitente autorizado no puede "colarse".
    assert.equal(
      debeUsarFlowParaRemitente(
        { flow_activo: true, flow_id: "", phone_number_id: PHONE_DANIELA },
        REMITENTE_314_AUTORIZADO,
      ),
      false,
    );
    assert.equal(
      debeUsarFlowParaRemitente(
        { flow_activo: true, flow_id: null, phone_number_id: PHONE_DANIELA },
        REMITENTE_314_AUTORIZADO,
      ),
      false,
    );
  });

  it("6b. fail-closed estricto: ninguna variante de formato del remitente cuela por accidente", () => {
    // resolverTelefonoRemitenteMeta siempre entrega "solo dígitos" (ver
    // lib/webhook-meta-remitente.ts) -- estas variantes NUNCA llegarían así
    // desde el webhook real, pero si llegaran, deben quedar fuera.
    const variantesQueNoDebenColar = [
      "+573148127388",
      " 573148127388",
      "573148127388 ",
      "0573148127388",
      "3148127388",
      "",
    ];
    for (const variante of variantesQueNoDebenColar) {
      assert.equal(
        debeUsarFlowParaRemitente(
          { flow_activo: true, flow_id: "flow-x", phone_number_id: PHONE_DANIELA },
          variante,
        ),
        false,
        `la variante "${variante}" no debería autorizar Flow`,
      );
    }
  });

  it("phone_number_id SIN lista de prueba configurada → sin restricción (comportamiento real post-prueba)", () => {
    // Ningún otro tenant/número tiene entrada en flow-test-senders.ts hoy,
    // así que para cualquiera de ellos esta función es idéntica a
    // debeUsarFlow -- la restricción por remitente es exclusiva de Daniela
    // mientras dure la prueba.
    assert.equal(
      debeUsarFlowParaRemitente(
        { flow_activo: true, flow_id: "flow-x", phone_number_id: "otro-phone-number-id-cualquiera" },
        "cualquier-remitente-cualquiera",
      ),
      true,
    );
  });

  it("5. ia_restringida_a no es parte del tipo de esta función (independencia estructural)", () => {
    // Prueba de diseño, no de runtime: debeUsarFlowParaRemitente solo acepta
    // Pick<ClienteConfig, "flow_activo" | "flow_id" | "phone_number_id"> --
    // ia_restringida_a no puede colarse como argumento sin un cast
    // explícito, y la función nunca la lee. La independencia real de
    // ia_restringida_a viene de que route.ts la evalúa ANTES (línea ~718) y
    // corta en seco si el remitente no está autorizado, antes de siquiera
    // llegar a debeAtenderConFlow -- ver reporte de la fase de diseño.
    const soloLasTresColumnas: Parameters<typeof debeUsarFlowParaRemitente>[0] = {
      flow_activo: true,
      flow_id: "flow-x",
      phone_number_id: PHONE_DANIELA,
    };
    assert.equal(Object.keys(soloLasTresColumnas).length, 3);
  });
});
