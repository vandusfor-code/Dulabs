/**
 * Agent Compiler (Fase 1) — Pilar 1: extractor de catálogo determinista.
 * Tests obligatorios: precio válido, precio ambiguo, producto duplicado,
 * moneda inválida, precio ausente. Sin Supabase, sin LLM: función pura.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extraerCatalogo } from "@/lib/agent-compiler/catalog-extractor";
import type { CompilerInput } from "@/lib/agent-compiler/types";

function input(prompt: string, knowledge = ""): CompilerInput {
  return { prompt, knowledge };
}

describe("Agent Compiler — extractor de catálogo", () => {
  it("precio válido: extrae nombre + precio COP con trazabilidad", () => {
    const r = extraerCatalogo(input("Sesión Premium: $800.000"));
    assert.equal(r.items.length, 1);
    const it = r.items[0]!;
    assert.equal(it.name, "Sesión Premium");
    assert.equal(it.priceCop, 800000);
    assert.equal(it.currency, "COP");
    assert.equal(it.type, "service");
    assert.ok(it.sourceEvidence.includes("$800.000"), "debe conservar la evidencia original");
    assert.ok(it.confidence >= 0.9);
    assert.equal(r.issues.length, 0);
  });

  it("varios precios y formatos COP (con/sin símbolo, millones)", () => {
    const r = extraerCatalogo(
      input(["Paquete Básico - $350.000", "Paquete Full = 1.200.000 COP", "Retoque adicional: 50000"].join("\n")),
    );
    const precios = r.items.map((i) => i.priceCop).sort((a, b) => (a ?? 0) - (b ?? 0));
    assert.deepEqual(precios, [50000, 350000, 1200000]);
    assert.ok(r.items.every((i) => i.currency === "COP"));
  });

  it("precio ambiguo: general con precio + variantes específicas => AMBIGUOUS_CATALOG_ITEM (bloquea)", () => {
    const r = extraerCatalogo(
      input(
        ["Paquete 1: $350.000", "Paquete 1 Estudio: $550.000", "Paquete 1 Exteriores: $650.000"].join("\n"),
      ),
    );
    const amb = r.issues.filter((i) => i.code === "AMBIGUOUS_CATALOG_ITEM");
    assert.equal(amb.length, 1, "solo el general 'Paquete 1' es ambiguo");
    assert.ok(amb[0]!.evidence?.includes("Paquete 1: $350.000"));
    assert.equal(amb[0]!.severity, "block");
  });

  it("producto duplicado: mismo nombre dos veces => CATALOG_DUPLICATE_ITEM y no duplica", () => {
    const r = extraerCatalogo(input(["Corte: $30.000", "Corte: $30.000"].join("\n")));
    assert.equal(r.items.length, 1, "no se duplica el ítem");
    assert.equal(r.issues.filter((i) => i.code === "CATALOG_DUPLICATE_ITEM").length, 1);
  });

  it("moneda inválida: USD/EUR => CATALOG_INVALID_CURRENCY y no se persiste el precio", () => {
    const usd = extraerCatalogo(input("Consultoría: $500 USD"));
    assert.equal(usd.items.length, 0, "no se crea ítem en moneda no canónica");
    assert.equal(usd.issues.filter((i) => i.code === "CATALOG_INVALID_CURRENCY").length, 1);

    const eur = extraerCatalogo(input("Consultoría: €500"));
    assert.equal(eur.issues.filter((i) => i.code === "CATALOG_INVALID_CURRENCY").length, 1);
  });

  it("precio ausente: nombre + delimitador vacío => CATALOG_ITEM_MISSING_PRICE (bloquea)", () => {
    const r = extraerCatalogo(input("Servicio Nuevo:"));
    assert.equal(r.items.length, 0);
    assert.equal(r.issues.filter((i) => i.code === "CATALOG_ITEM_MISSING_PRICE").length, 1);
  });

  it("no genera falsos positivos con líneas de config/prosa", () => {
    const r = extraerCatalogo(
      input(
        [
          "Somos un estudio fotográfico en Bogotá.",
          "Horario: 9am a 6pm de lunes a viernes",
          "Atendemos con cita previa.",
        ].join("\n"),
      ),
    );
    assert.equal(r.items.length, 0);
    // Ninguna de estas líneas debe marcarse como precio ausente ni como ítem.
    assert.equal(r.issues.filter((i) => i.code === "CATALOG_ITEM_MISSING_PRICE").length, 0);
    assert.equal(r.issues.filter((i) => i.code === "CATALOG_INVALID_CURRENCY").length, 0);
    // Sí puede avisar que el catálogo quedó vacío (warn, no bloquea).
    assert.ok(r.issues.every((i) => i.code === "CATALOG_EMPTY"));
  });

  it("los ítems service reciben duracion_min por defecto (schema NOT NULL > 0)", () => {
    const r = extraerCatalogo(input("Manicure: $40.000"), { tipoPorDefecto: "service" });
    assert.equal(r.items[0]!.durationMin, 60);
  });

  it("productos: no fuerzan duracion_min", () => {
    const r = extraerCatalogo(input("Camiseta: $60.000"), { tipoPorDefecto: "product" });
    assert.equal(r.items[0]!.type, "product");
    assert.equal(r.items[0]!.durationMin, undefined);
  });
});
