/**
 * DuLabs Developer V1 -- Fase 12 (Billing). Tests unitarios de la lógica PURA:
 * pricing (mensual/anual x10, Enterprise sin checkout), FX USD->COP,
 * verificación de firma de webhook (roundtrip) y mapeo de estados. Sin red/DB.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverPricing, obtenerTasaFxUsdCop, usdCentsACopCents, esPlanManual, MESES_COBRADOS } from "@/lib/developer/billing/pricing";
import { verificarChecksumEventoDev, estadoDesdeWompi } from "@/lib/developer/billing/wompi-client";

// Fake supabase mínimo: obtenerPlan() hace from().select().eq().maybeSingle().
function fakeSupabaseConPlan(plan: Record<string, unknown> | null): SupabaseClient {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: plan, error: null }) };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("Fase 12 billing -- pricing (fuente única, anual x10)", () => {
  it("DEVELOPER mensual = $19 (1900 cents); anual = x10 = $190 (19000)", async () => {
    const sb = fakeSupabaseConPlan({ codigo: "DEVELOPER", nombre: "Developer", precio_mensual_usd: 19 });
    const mes = await resolverPricing(sb, { plan: "DEVELOPER", intervalo: "month" });
    assert.equal(mes.precioUsdCents, 1900);
    assert.equal(mes.checkoutHabilitado, true);
    const anio = await resolverPricing(sb, { plan: "DEVELOPER", intervalo: "year" });
    assert.equal(anio.precioUsdCents, 19000); // 2 meses gratis
    assert.equal(anio.equivalenteMensualUsdCents, Math.round(19000 / 12));
  });

  it("AGENCY anual = $450 (45000)", async () => {
    const sb = fakeSupabaseConPlan({ codigo: "AGENCY", nombre: "Agency", precio_mensual_usd: 45 });
    const anio = await resolverPricing(sb, { plan: "AGENCY", intervalo: "year" });
    assert.equal(anio.precioUsdCents, 45000);
  });

  it("ENTERPRISE -> checkout deshabilitado (manual)", async () => {
    const sb = fakeSupabaseConPlan({ codigo: "ENTERPRISE", nombre: "Enterprise", precio_mensual_usd: 199 });
    const p = await resolverPricing(sb, { plan: "ENTERPRISE", intervalo: "month" });
    assert.equal(p.checkoutHabilitado, false);
    assert.equal(esPlanManual("ENTERPRISE"), true);
    assert.equal(esPlanManual("AGENCY"), false);
  });

  it("MESES_COBRADOS: month=1, year=10", () => {
    assert.equal(MESES_COBRADOS.month, 1);
    assert.equal(MESES_COBRADOS.year, 10);
  });
});

describe("Fase 12 billing -- FX USD->COP (server-side)", () => {
  const original = process.env.DEVELOPER_BILLING_USD_COP_RATE;
  afterEach(() => {
    if (original === undefined) delete process.env.DEVELOPER_BILLING_USD_COP_RATE;
    else process.env.DEVELOPER_BILLING_USD_COP_RATE = original;
  });

  it("convierte USD cents a COP cents con la tasa", () => {
    // $19.00 * 4000 COP/USD = 76,000 COP = 7,600,000 COP cents
    assert.equal(usdCentsACopCents(1900, 4000), 7_600_000);
  });

  it("obtenerTasaFxUsdCop lee el env; falla si falta (fail-closed)", () => {
    process.env.DEVELOPER_BILLING_USD_COP_RATE = "4000";
    assert.equal(obtenerTasaFxUsdCop(), 4000);
    delete process.env.DEVELOPER_BILLING_USD_COP_RATE;
    assert.throws(() => obtenerTasaFxUsdCop(), /FAIL CLOSED/);
    process.env.DEVELOPER_BILLING_USD_COP_RATE = "0";
    assert.throws(() => obtenerTasaFxUsdCop(), /FAIL CLOSED/);
  });
});

describe("Fase 12 billing -- webhook firma + estados", () => {
  const original = process.env.DEVELOPER_WOMPI_EVENTS_KEY;
  beforeEach(() => { process.env.DEVELOPER_WOMPI_EVENTS_KEY = "test_events_key_dev"; });
  afterEach(() => {
    if (original === undefined) delete process.env.DEVELOPER_WOMPI_EVENTS_KEY;
    else process.env.DEVELOPER_WOMPI_EVENTS_KEY = original;
  });

  function eventoFirmado(txId: string, status: string, ts: number) {
    const data = { transaction: { id: txId, status } };
    const properties = ["transaction.id", "transaction.status"];
    const cadena = txId + status + ts + process.env.DEVELOPER_WOMPI_EVENTS_KEY;
    const checksum = crypto.createHash("sha256").update(cadena).digest("hex").toUpperCase();
    return { data, signature: { properties, checksum }, timestamp: ts };
  }

  it("firma válida -> true; alterar el status -> false", () => {
    const ev = eventoFirmado("tx_1", "APPROVED", 1730000000);
    assert.equal(verificarChecksumEventoDev(ev), true);
    const alterado = { ...ev, data: { transaction: { id: "tx_1", status: "DECLINED" } } };
    assert.equal(verificarChecksumEventoDev(alterado), false);
  });

  it("sin events key -> false (no valida a ciegas)", () => {
    const ev = eventoFirmado("tx_2", "APPROVED", 1730000001);
    delete process.env.DEVELOPER_WOMPI_EVENTS_KEY;
    assert.equal(verificarChecksumEventoDev(ev), false);
  });

  it("estadoDesdeWompi: APPROVED->active, PENDING->pendiente, resto->fallido", () => {
    assert.equal(estadoDesdeWompi("APPROVED"), "active");
    assert.equal(estadoDesdeWompi("PENDING"), "pendiente");
    assert.equal(estadoDesdeWompi("DECLINED"), "fallido");
    assert.equal(estadoDesdeWompi("VOIDED"), "fallido");
    assert.equal(estadoDesdeWompi("LO_QUE_SEA"), "fallido");
  });
});
