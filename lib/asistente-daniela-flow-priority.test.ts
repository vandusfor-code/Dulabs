/**
 * Fase 8A.1 (autorizado) — regresión de la corrección de prioridad en
 * app/webhook-dulabs/route.ts: el piloto de la nueva IA de Daniela debe
 * evaluarse ANTES que el bloque Flow, sin duplicar la lógica de ninguno de
 * los dos gates.
 *
 * Contexto real (diagnóstico previo, no repetido acá): Daniela ya tenía
 * flow_activo=true + flow_id real en producción, y FLOW_TEST_SENDERS no
 * tiene entrada para su phone_number_id -- por lo que debeAtenderConFlow
 * devolvía true para CUALQUIER remitente, incluido el número autorizado del
 * piloto (573148127388), y el bloque Flow atendía el mensaje y hacía
 * `return` antes de que el código llegara al gate de la nueva IA.
 *
 * La corrección en route.ts fue quirúrgica:
 *   if (debeAtenderConFlow(cliente, telefonoRemitente) && !debeUsarAsistenteDanielaIA(cliente, telefonoRemitente))
 *
 * Este archivo NO reimplementa esa condición con sus propios `===` --
 * importa las DOS funciones reales (debeAtenderConFlow y
 * debeUsarAsistenteDanielaIA, sin tocarlas) y compone la MISMA expresión que
 * route.ts, para probar exactamente la decisión real de enrutamiento.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { debeAtenderConFlow } from "@/lib/flow-runtime-bridge";
import { debeUsarAsistenteDanielaIA, NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP } from "@/lib/asistente-daniela-gate";

const ID_TENANT_DANIELA = "c64fac97-eff8-45f2-b691-30b3449da524";
const PHONE_DANIELA = "1282448611609227";
const OTRO_TENANT = { id_tenant: "otro-tenant-uuid", phone_number_id: "otro-phone-id" };

// Refleja el dato real confirmado en producción (Daniela): flow_activo=true
// + flow_id real, sin entrada en FLOW_TEST_SENDERS para su phone_number_id.
const DANIELA_CON_FLOW_ACTIVO = {
  id_tenant: ID_TENANT_DANIELA,
  phone_number_id: PHONE_DANIELA,
  flow_activo: true as const,
  flow_id: "e9384392-815d-437a-ac3e-af43f182d974",
};

/** Misma expresión exacta que app/webhook-dulabs/route.ts, línea del `if` del bloque Flow. */
function entraAlBloqueFlow(
  cliente: { id_tenant: string; phone_number_id: string; flow_activo: boolean; flow_id: string | null },
  telefonoRemitente: string,
  opts?: { pilotoActivo?: boolean }
): boolean {
  return debeAtenderConFlow(cliente, telefonoRemitente) && !debeUsarAsistenteDanielaIA(cliente, telefonoRemitente, opts);
}

describe("Fase 8A.1 — el piloto de la nueva IA de Daniela tiene prioridad sobre Flow", () => {
  it("A. Daniela + 573148127388 + gate activo → Flow NO se ejecuta", () => {
    assert.equal(
      entraAlBloqueFlow(DANIELA_CON_FLOW_ACTIVO, NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP, { pilotoActivo: true }),
      false
    );
    // Y la nueva IA sí debe entrar -- exactamente la mitad complementaria.
    assert.equal(
      debeUsarAsistenteDanielaIA(DANIELA_CON_FLOW_ACTIVO, NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP, { pilotoActivo: true }),
      true
    );
  });

  it("B. Daniela + otro remitente real (clienta real) → Flow conserva su comportamiento actual", () => {
    assert.equal(entraAlBloqueFlow(DANIELA_CON_FLOW_ACTIVO, "573001112233", { pilotoActivo: true }), true);
  });

  it("C. otro tenant con flow_activo/flow_id propios → Flow conserva su comportamiento actual, sin importar el remitente", () => {
    const otroTenantConFlow = { ...OTRO_TENANT, flow_activo: true as const, flow_id: "otro-flow-id" };
    assert.equal(entraAlBloqueFlow(otroTenantConFlow, NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP, { pilotoActivo: true }), true);
    assert.equal(entraAlBloqueFlow(otroTenantConFlow, "573001112233", { pilotoActivo: true }), true);
  });

  it("D. gate OFF (piloto desactivado) → Flow conserva su comportamiento actual incluso para el número autorizado", () => {
    assert.equal(
      entraAlBloqueFlow(DANIELA_CON_FLOW_ACTIVO, NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP, { pilotoActivo: false }),
      true
    );
  });

  it("E. la nueva IA recibe correctamente el piloto (gate true de forma independiente al bloque Flow)", () => {
    assert.equal(
      debeUsarAsistenteDanielaIA(DANIELA_CON_FLOW_ACTIVO, NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP, { pilotoActivo: true }),
      true
    );
  });

  it("F. nunca hay doble procesamiento: entrar a Flow y entrar a la nueva IA son mutuamente excluyentes en TODA combinación", () => {
    const clientes = [
      DANIELA_CON_FLOW_ACTIVO,
      { ...DANIELA_CON_FLOW_ACTIVO, flow_activo: false as const, flow_id: null },
      { ...OTRO_TENANT, flow_activo: true as const, flow_id: "otro-flow-id" },
      { ...OTRO_TENANT, flow_activo: false as const, flow_id: null },
    ];
    const remitentes = [NUMERO_AUTORIZADO_PRUEBAS_WHATSAPP, "573001112233", ""];
    const pilotos = [true, false];

    for (const cliente of clientes) {
      for (const remitente of remitentes) {
        for (const pilotoActivo of pilotos) {
          const entraFlow = entraAlBloqueFlow(cliente, remitente, { pilotoActivo });
          const entraNuevaIA = debeUsarAsistenteDanielaIA(cliente, remitente, { pilotoActivo });
          assert.ok(
            !(entraFlow && entraNuevaIA),
            `Doble procesamiento detectado para ${JSON.stringify({ cliente, remitente, pilotoActivo })}`
          );
        }
      }
    }
  });
});
