/**
 * DuLabs Developer V1 -- Fase 15. Tests unitarios PUROS de la proyección
 * pública de planes: anual = mensual x10, Enterprise manual, checkout, y que la
 * forma pública NO expone campos sensibles. Sin red/DB.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aPlanPublico, type PlanPublico } from "./planes-publicos";

const DEVELOPER = {
  codigo: "DEVELOPER", nombre: "Developer", precio_mensual_usd: 19,
  mensajes_mensuales_incluidos: 20000, numeros_incluidos: 2, mensajes_por_segundo_por_numero: 2,
  max_workspaces: 1, max_members: 1, permite_numeros_adicionales: false, precio_numero_adicional_usd: null,
};
const AGENCY = {
  codigo: "AGENCY", nombre: "Agency", precio_mensual_usd: 45,
  mensajes_mensuales_incluidos: 100000, numeros_incluidos: 5, mensajes_por_segundo_por_numero: 2,
  max_workspaces: 5, max_members: 5, permite_numeros_adicionales: true, precio_numero_adicional_usd: 5,
};
const ENTERPRISE = {
  codigo: "ENTERPRISE", nombre: "Enterprise", precio_mensual_usd: 199,
  mensajes_mensuales_incluidos: null, numeros_incluidos: null, mensajes_por_segundo_por_numero: null,
  max_workspaces: null, max_members: null, permite_numeros_adicionales: true, precio_numero_adicional_usd: 5,
};

// Campos comerciales permitidos (contrato público). Cualquier otro campo en la
// salida sería una fuga potencial.
const CAMPOS_PERMITIDOS = new Set<keyof PlanPublico>([
  "slug", "nombre", "precioMensualUsd", "precioAnualUsd", "equivalenteMensualAnualUsd",
  "mensajesMensualesIncluidos", "numerosIncluidos", "mensajesPorSegundoPorNumero",
  "maxWorkspaces", "maxMembers", "permiteNumerosAdicionales", "precioNumeroAdicionalUsd",
  "checkoutHabilitado", "esManual",
]);

describe("Fase 15 -- planes-publicos (proyección pura)", () => {
  it("el precio anual es el mensual x10 (2 meses gratis)", () => {
    assert.equal(aPlanPublico(DEVELOPER).precioAnualUsd, 190);
    assert.equal(aPlanPublico(AGENCY).precioAnualUsd, 450);
    assert.equal(aPlanPublico(ENTERPRISE).precioAnualUsd, 1990);
  });

  it("el equivalente mensual del anual es anual/12", () => {
    assert.equal(aPlanPublico(DEVELOPER).equivalenteMensualAnualUsd, 15.83);
    assert.equal(aPlanPublico(AGENCY).equivalenteMensualAnualUsd, 37.5);
  });

  it("Enterprise es manual y sin checkout self-service", () => {
    const e = aPlanPublico(ENTERPRISE);
    assert.equal(e.esManual, true);
    assert.equal(e.checkoutHabilitado, false);
  });

  it("Developer y Agency permiten checkout self-service", () => {
    assert.equal(aPlanPublico(DEVELOPER).checkoutHabilitado, true);
    assert.equal(aPlanPublico(AGENCY).checkoutHabilitado, true);
    assert.equal(aPlanPublico(DEVELOPER).esManual, false);
  });

  it("el slug es el código en minúsculas", () => {
    assert.equal(aPlanPublico(DEVELOPER).slug, "developer");
    assert.equal(aPlanPublico(ENTERPRISE).slug, "enterprise");
  });

  it("un plan sin precio de lista queda con precios null (no inventa cifras)", () => {
    const sinPrecio = aPlanPublico({ ...ENTERPRISE, precio_mensual_usd: null });
    assert.equal(sinPrecio.precioMensualUsd, null);
    assert.equal(sinPrecio.precioAnualUsd, null);
    assert.equal(sinPrecio.equivalenteMensualAnualUsd, null);
    assert.equal(sinPrecio.checkoutHabilitado, false);
  });

  it("los límites ilimitados (null) se preservan tal cual", () => {
    const e = aPlanPublico(ENTERPRISE);
    assert.equal(e.mensajesMensualesIncluidos, null);
    assert.equal(e.numerosIncluidos, null);
    assert.equal(e.maxWorkspaces, null);
    assert.equal(e.maxMembers, null);
  });

  it("la forma pública SOLO tiene campos comerciales seguros (sin fugas)", () => {
    for (const plan of [DEVELOPER, AGENCY, ENTERPRISE]) {
      const pub = aPlanPublico(plan);
      for (const k of Object.keys(pub)) {
        assert.ok(CAMPOS_PERMITIDOS.has(k as keyof PlanPublico), `campo inesperado en salida pública: ${k}`);
      }
      // Ningún indicio de cuenta/token/secreto/billing interno en el JSON.
      const json = JSON.stringify(pub).toLowerCase();
      for (const prohibido of ["account", "token", "secret", "wompi", "customer", "payment_source", "fx_rate"]) {
        assert.ok(!json.includes(prohibido), `la salida pública contiene '${prohibido}'`);
      }
    }
  });
});
