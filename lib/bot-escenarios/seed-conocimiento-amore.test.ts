/**
 * Integridad del seed de conocimiento de AMORE (autorizado) -- sección 21.A
 * del pedido de integración de base de conocimiento. Nunca contra Supabase
 * real: valida la estructura de datos en memoria contra el catálogo real de
 * 28 servicios (embebido acá tal como lo confirmaron las consultas
 * read-only de auditoría), así el seed nunca puede referenciar un servicio
 * que no existe ni los 2 servicios propuestos por el documento que AMORE aún
 * no tiene ("Secado Rápido", "Base Rubber").
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AMORE_CONOCIMIENTO_SEED } from "@/lib/bot-escenarios/seed-conocimiento-amore";

// Los 28 servicios reales activos de AMORE (tenant
// ed6ae77f-8a0c-483e-a5d9-8ede68eca50f), confirmados por consulta read-only
// contra dulabs_servicios durante la auditoría de esta fase.
const SERVICIOS_REALES = [
  "Celulas Madres",
  "Ondas",
  "Peinado",
  "Repolarizacion",
  "Trenzas",
  "Cejas con Cera",
  "Cejas con Cuchilla",
  "Sombreado de Cejas",
  "Axilas",
  "Barbilla",
  "Bozo",
  "Media Pierna",
  "Nariz",
  "Maquillaje pro",
  "Maquillaje Suave",
  "Pestañas Punto a Punto",
  "Caballero Manos Semi",
  "Caballero Manos Semi y Pies Tradi",
  "Caballero Manos y Pies",
  "Cambio De Esmalte",
  "Dipping",
  "Manos semi y Pies Tradi",
  "Manos y Pies Semi",
  "Press On",
  "Retiro Semi",
  "Retiro Sistemas",
  "Retoques",
  "Uña",
];

const NOMBRES_PROHIBIDOS = ["Secado Rapido", "Secado Rápido", "Base Ruber", "Base Rubber", "Acrilicas", "Acrílicas"];

describe("AMORE_CONOCIMIENTO_SEED — integridad (nunca inventa servicios, nunca los 2 propuestos por el documento que no existen)", () => {
  it("tiene exactamente 27 fichas (28 servicios reales - 1 sin ficha en el documento: Celulas Madres)", () => {
    assert.equal(AMORE_CONOCIMIENTO_SEED.length, 27);
  });

  it("cada ficha referencia un servicio REAL del catálogo -- nunca uno inventado", () => {
    for (const ficha of AMORE_CONOCIMIENTO_SEED) {
      assert.ok(
        SERVICIOS_REALES.includes(ficha.nombreServicioReal),
        `"${ficha.nombreServicioReal}" no está en el catálogo real de AMORE`,
      );
    }
  });

  it("NUNCA incluye Secado Rápido / Base Rubber / Acrílicas (Decisión 1, no aprobados para el catálogo)", () => {
    for (const prohibido of NOMBRES_PROHIBIDOS) {
      assert.ok(
        !AMORE_CONOCIMIENTO_SEED.some((f) => f.nombreServicioReal === prohibido),
        `el seed NO debe contener una ficha para "${prohibido}"`,
      );
    }
  });

  it("'Celulas Madres' (real, sin ficha en el documento) queda honestamente sin ficha -- nunca se inventa una", () => {
    assert.ok(!AMORE_CONOCIMIENTO_SEED.some((f) => f.nombreServicioReal === "Celulas Madres"));
  });

  it("no hay nombres duplicados (UNIQUE(tenant_id, servicio_id) en la tabla real -- el seed nunca debe intentar 2 filas para el mismo servicio)", () => {
    const nombres = AMORE_CONOCIMIENTO_SEED.map((f) => f.nombreServicioReal);
    assert.equal(new Set(nombres).size, nombres.length);
  });

  it("toda ficha es fuente='conocimiento_general' -- nunca 'confirmado_amore' (esos datos ya viven en dulabs_servicios/datosIA) ni 'no_confirmado' (eso es el fallback honesto cuando NO hay ficha, no un valor de seed)", () => {
    for (const ficha of AMORE_CONOCIMIENTO_SEED) {
      assert.equal(ficha.fuente, "conocimiento_general", `"${ficha.nombreServicioReal}" trae fuente="${ficha.fuente}"`);
    }
  });

  it("ninguna ficha deja queEs/paraQueSirve/limites vacíos (si no hay conocimiento real, la ficha simplemente no debe existir)", () => {
    for (const ficha of AMORE_CONOCIMIENTO_SEED) {
      assert.ok(ficha.queEs.trim().length > 0, `"${ficha.nombreServicioReal}" sin queEs`);
      assert.ok(ficha.paraQueSirve.trim().length > 0, `"${ficha.nombreServicioReal}" sin paraQueSirve`);
      assert.ok(ficha.limites.trim().length > 0, `"${ficha.nombreServicioReal}" sin limites`);
    }
  });

  it("'limites' de cada ficha prohíbe explícitamente inventar protocolo/producto/marca específico de AMORE (nunca una ficha sin ninguna restricción)", () => {
    for (const ficha of AMORE_CONOCIMIENTO_SEED) {
      assert.match(
        ficha.limites,
        /no afirmar|no asumir|no confirma|no representa|no es protocolo/i,
        `"${ficha.nombreServicioReal}": limites no marca ninguna restricción explícita`,
      );
    }
  });
});
