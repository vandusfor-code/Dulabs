/**
 * R6 — cotización determinista (backend): parsing de ítems, resolución contra el
 * catálogo REAL, matemática entera COP, precio nulo, stock, ambigüedad. Puro.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildQuote, formatCop, formatQuoteText, normalizeQuoteName, parseQuoteItems, QUOTE_LIMITS, type QuoteCatalogItem } from "@/lib/business-agent-quote";
import { PRODUCT_LIMITS, rowToProduct, validateProductInput } from "@/lib/business-agent-products";

const CATALOGO: QuoteCatalogItem[] = [
  { tipo: "servicio", id: "s1", nombre: "Manicure semipermanente", precio: 45000 },
  { tipo: "servicio", id: "s2", nombre: "Pedicure spa", precio: 60000 },
  { tipo: "servicio", id: "s3", nombre: "Diseño de uñas", precio: null },
  { tipo: "producto", id: "p1", nombre: "Esmalte rojo", precio: 12000, stock: 5 },
  { tipo: "producto", id: "p2", nombre: "Esmalte azul", precio: 12500, stock: 0 },
];

describe("parseQuoteItems — la IA solo entrega texto estructurado", () => {
  it("formatos comunes: 'x2', '2 nombre', 'nombre:2', sin cantidad", () => {
    assert.deepEqual(parseQuoteItems("Manicure x2; Pedicure").items, [{ nombre: "Manicure", cantidad: 2 }, { nombre: "Pedicure", cantidad: 1 }]);
    assert.deepEqual(parseQuoteItems("2 manicure, 1 pedicure").items, [{ nombre: "manicure", cantidad: 2 }, { nombre: "pedicure", cantidad: 1 }]);
    assert.deepEqual(parseQuoteItems("corte:3").items, [{ nombre: "corte", cantidad: 3 }]);
    assert.deepEqual(parseQuoteItems("Esmalte rojo × 4").items, [{ nombre: "Esmalte rojo", cantidad: 4 }]);
  });

  it("cantidades inválidas NO se corrigen: se reportan (0, negativa, decimal, excesiva)", () => {
    const r = parseQuoteItems("a x0; b x-2; c x1.5; d x1000; e x2");
    assert.deepEqual(r.items, [{ nombre: "e", cantidad: 2 }]);
    assert.deepEqual(r.cantidadInvalida, ["a", "b", "c", "d"]);
  });

  it("vacío / basura => sin ítems; tope de ítems y de largo", () => {
    assert.deepEqual(parseQuoteItems("").items, []);
    assert.deepEqual(parseQuoteItems(undefined).items, []);
    assert.deepEqual(parseQuoteItems(" ; ; ").items, []);
    const muchos = Array.from({ length: 30 }, (_, i) => `item${i}`).join(";");
    const r = parseQuoteItems(muchos);
    assert.ok(r.items.length <= QUOTE_LIMITS.maxItems);
  });
});

describe("buildQuote — el backend calcula; el catálogo real manda", () => {
  it("líneas, subtotal y total exactos en COP enteros", () => {
    const q = buildQuote(CATALOGO, parseQuoteItems("Manicure semipermanente x2; Pedicure spa x1").items);
    assert.deepEqual(q.lineas.map((l) => [l.nombre, l.cantidad, l.precioUnitario, l.subtotal]), [
      ["Manicure semipermanente", 2, 45000, 90000],
      ["Pedicure spa", 1, 60000, 60000],
    ]);
    assert.equal(q.subtotal, 150000);
    assert.equal(q.total, 150000);
    assert.equal(q.completa, true);
  });

  it("resolución tolerante a tildes/mayúsculas y por contención única ('pedicure' -> 'Pedicure spa')", () => {
    const q = buildQuote(CATALOGO, [{ nombre: "PEDICURE", cantidad: 1 }, { nombre: "diseno de unas", cantidad: 1 }]);
    assert.equal(q.lineas.length, 2);
    assert.equal(q.lineas[0]!.nombre, "Pedicure spa");
    assert.equal(q.lineas[1]!.nombre, "Diseño de uñas");
  });

  it("precio NULO (sin precio fijo): la línea queda 'a confirmar', el total es PARCIAL y no se inventa un 0", () => {
    const q = buildQuote(CATALOGO, [{ nombre: "Diseño de uñas", cantidad: 1 }, { nombre: "Pedicure spa", cantidad: 1 }]);
    assert.equal(q.completa, false);
    assert.equal(q.total, 60000, "solo suma lo que tiene precio");
    const t = formatQuoteText(q);
    assert.match(t, /precio a confirmar/);
    assert.match(t, /Total parcial: \$60\.000/);
  });

  it("ítem inexistente => noEncontrados (nunca se inventa una línea)", () => {
    const q = buildQuote(CATALOGO, [{ nombre: "Botox capilar", cantidad: 1 }]);
    assert.deepEqual(q.lineas, []);
    assert.deepEqual(q.noEncontrados, ["Botox capilar"]);
    assert.equal(q.total, 0);
  });

  it("ambiguo => el cliente debe precisar (no se elige por él)", () => {
    const q = buildQuote(CATALOGO, [{ nombre: "esmalte", cantidad: 1 }]);
    assert.deepEqual(q.lineas, []);
    assert.deepEqual(q.ambiguos, [{ pedido: "esmalte", opciones: ["Esmalte rojo", "Esmalte azul"] }]);
    assert.match(formatQuoteText(q), /puede ser: Esmalte rojo \/ Esmalte azul/);
  });

  it("consulta demasiado corta no coincide por contención ('de', 'la')", () => {
    const q = buildQuote(CATALOGO, [{ nombre: "de", cantidad: 1 }]);
    assert.deepEqual(q.noEncontrados, ["de"]);
  });

  it("stock: se avisa cuando la cantidad supera lo disponible (producto)", () => {
    const q = buildQuote(CATALOGO, [{ nombre: "Esmalte rojo", cantidad: 8 }, { nombre: "Esmalte azul", cantidad: 1 }]);
    assert.equal(q.hayStockInsuficiente, true);
    assert.equal(q.lineas[0]!.stockDisponible, 5);
    assert.equal(q.lineas[1]!.stockSuficiente, false);
    assert.match(formatQuoteText(q), /Solo hay 5 disponible\(s\) de Esmalte rojo/);
  });

  it("el mismo ítem pedido dos veces se ACUMULA en una línea", () => {
    const q = buildQuote(CATALOGO, [{ nombre: "Pedicure spa", cantidad: 1 }, { nombre: "pedicure spa", cantidad: 2 }]);
    assert.equal(q.lineas.length, 1);
    assert.equal(q.lineas[0]!.cantidad, 3);
    assert.equal(q.total, 180000);
  });

  it("determinista: mismas entradas => misma salida", () => {
    const a = formatQuoteText(buildQuote(CATALOGO, [{ nombre: "Pedicure spa", cantidad: 2 }]));
    const b = formatQuoteText(buildQuote(CATALOGO, [{ nombre: "Pedicure spa", cantidad: 2 }]));
    assert.equal(a, b);
    assert.match(a, /Pedicure spa x2 — \$60\.000 c\/u = \$120\.000/);
    assert.match(a, /Total: \$120\.000/);
  });

  it("formatCop / normalización", () => {
    assert.equal(formatCop(1234567), "$1.234.567");
    assert.equal(formatCop(0), "$0");
    // Sin tildes ni ñ (el cliente escribe "unas" por "uñas"): tolerante a propósito.
    assert.equal(normalizeQuoteName("  Diseño  de UÑAS!! "), "diseno de unas");
  });
});

describe("validateProductInput — límites y precio obligatorio", () => {
  it("producto válido: normaliza, redondea precio, stock por defecto 0", () => {
    const r = validateProductInput({ nombre: "  Esmalte  ", precio: "12000.4", categoria: " Uñas ", descripcion: " ", activo: true });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { nombre: "Esmalte", categoria: "Uñas", descripcion: null, precio: 12000, stock: 0, activo: true });
  });

  it("rechaza: sin nombre, sin precio, precio negativo/excesivo, stock decimal/negativo", () => {
    for (const body of [
      {},
      { nombre: "x" },
      { nombre: "x", precio: -1 },
      { nombre: "x", precio: PRODUCT_LIMITS.precioMax + 1 },
      { nombre: "x", precio: 10, stock: 1.5 },
      { nombre: "x", precio: 10, stock: -1 },
      { nombre: "a".repeat(PRODUCT_LIMITS.nombre + 1), precio: 10 },
      null,
      [],
    ]) {
      assert.equal(validateProductInput(body).ok, false, JSON.stringify(body));
    }
  });

  it("rowToProduct proyecta solo los campos genéricos (sin id_tenant)", () => {
    const p = rowToProduct({ id: "1", nombre: "N", categoria: null, descripcion: null, precio: 5, stock: 2, activo: true });
    assert.deepEqual(Object.keys(p).sort(), ["activo", "categoria", "descripcion", "id", "nombre", "precio", "stock"]);
  });
});
