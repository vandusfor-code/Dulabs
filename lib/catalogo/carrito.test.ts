/**
 * Carrito del catálogo público — dominio puro (sin DOM ni red).
 * Garantías: identidad por referencia real, cantidades acotadas por el stock
 * que informa el backend, totales sin inventar precios, reconciliación con
 * cambios explícitos, persistencia tolerante a datos corruptos y separación
 * por catálogo/contexto. (El mensaje de WhatsApp vive en pedido.test.ts.)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_LINES,
  MAX_QUANTITY,
  cartReducer,
  cartStorageKey,
  cartTotal,
  canAddMore,
  emptyCart,
  lineSubtotal,
  orderableLines,
  parseStoredCart,
  quantityLimit,
  reconcileCart,
  reconcileWithChanges,
  selectionSnapshot,
  totalItems,
  type CartProduct,
  type CartState,
} from "@/lib/catalogo/carrito";

const DIJE: CartProduct = { reference: "DL-000184", name: "Dije corazón", price: 35_000, imageUrl: "/catalogo/d/productos/dl-000184/thumb.webp?v=1" };
const ARETES: CartProduct = { reference: "DL-000185", name: "Aretes brillo", price: 42_000, imageUrl: null };
const ANILLO: CartProduct = { reference: "DL-000186", name: "Anillo esencia", price: null, imageUrl: null };

function con(...pasos: Array<[CartProduct, number?]>): CartState {
  return pasos.reduce((s, [product, quantity]) => cartReducer(s, { type: "add", product, quantity }), emptyCart("delacour", "retail"));
}

describe("reducer", () => {
  it("agregar la misma referencia suma cantidades (una sola línea)", () => {
    const s = con([DIJE], [DIJE], [ARETES]);
    assert.equal(s.lines.length, 2);
    assert.equal(s.lines.find((l) => l.reference === "DL-000184")?.quantity, 2);
    assert.equal(totalItems(s), 3);
  });

  it("refresca nombre/precio con el dato más reciente del catálogo", () => {
    const s = con([DIJE], [{ ...DIJE, name: "Dije corazón oro", price: 36_000 }]);
    assert.equal(s.lines[0].name, "Dije corazón oro");
    assert.equal(s.lines[0].unitPrice, 36_000);
  });

  it("cantidades acotadas entre 1 y el máximo; 0 elimina la línea", () => {
    let s = con([DIJE, 500]);
    assert.equal(s.lines[0].quantity, MAX_QUANTITY);
    s = cartReducer(s, { type: "add", product: DIJE });
    assert.equal(s.lines[0].quantity, MAX_QUANTITY);
    s = cartReducer(s, { type: "setQuantity", reference: "DL-000184", quantity: 3.7 });
    assert.equal(s.lines[0].quantity, 3);
    s = cartReducer(s, { type: "setQuantity", reference: "DL-000184", quantity: 0 });
    assert.equal(s.lines.length, 0);
    assert.equal(con([DIJE, Number.NaN]).lines[0].quantity, 1);
  });

  it("quitar y vaciar", () => {
    const s = con([DIJE], [ARETES]);
    assert.deepEqual(cartReducer(s, { type: "remove", reference: "DL-000184" }).lines.map((l) => l.reference), ["DL-000185"]);
    assert.equal(cartReducer(s, { type: "clear" }).lines.length, 0);
  });

  it("límite de líneas distintas", () => {
    let s = emptyCart("delacour", "retail");
    for (let i = 0; i < MAX_LINES + 5; i++) s = cartReducer(s, { type: "add", product: { ...DIJE, reference: `DL-${String(i).padStart(6, "0")}` } });
    assert.equal(s.lines.length, MAX_LINES);
  });
});

describe("totales", () => {
  it("subtotal por línea y total; lo 'a consultar' nunca suma un 0 inventado", () => {
    const s = con([DIJE, 2], [ARETES], [ANILLO, 2]);
    assert.equal(lineSubtotal(s.lines[0]), 70_000);
    assert.equal(lineSubtotal(s.lines[2]), null);
    assert.deepEqual(cartTotal(s), { total: 112_000, unpricedItems: 2 });
  });
});

describe("persistencia", () => {
  it("una clave por catálogo y contexto de precio (detal y mayor nunca se mezclan)", () => {
    assert.notEqual(cartStorageKey("delacour", "retail"), cartStorageKey("delacour", "wholesale"));
    assert.notEqual(cartStorageKey("delacour", "retail"), cartStorageKey("otro", "retail"));
  });

  it("ida y vuelta", () => {
    const s = con([DIJE, 2], [ANILLO]);
    assert.deepEqual(parseStoredCart(JSON.stringify(s), "delacour", "retail"), s);
  });

  it("tolerante: corrupto, otra versión, otro catálogo u otro contexto => vacío", () => {
    const s = con([DIJE]);
    for (const raw of [null, "", "{", "null", "[]", JSON.stringify({ ...s, version: 2 }), JSON.stringify({ ...s, lines: "x" })]) {
      assert.deepEqual(parseStoredCart(raw, "delacour", "retail").lines, [], String(raw));
    }
    assert.deepEqual(parseStoredCart(JSON.stringify(s), "otro", "retail").lines, []);
    assert.deepEqual(parseStoredCart(JSON.stringify(s), "delacour", "wholesale").lines, []);
  });

  it("descarta líneas inválidas o duplicadas y sanea valores", () => {
    const raw = JSON.stringify({
      ...emptyCart("delacour", "retail"),
      lines: [
        { reference: "DL-000184", name: "Dije", unitPrice: 35_000, imageUrl: "/x.webp", quantity: 2 },
        { reference: "DL-000184", name: "Duplicado", unitPrice: 1, imageUrl: null, quantity: 1 },
        { reference: "no-es-ref", name: "x", unitPrice: 1, imageUrl: null, quantity: 1 },
        { reference: "DL-000185", name: "", unitPrice: 1, imageUrl: null, quantity: 1 },
        { reference: "DL-000186", name: "Anillo", unitPrice: -5, imageUrl: "https://evil.test/x.png", quantity: 500 },
        { reference: "DL-000187", name: "Sin cantidad", unitPrice: 1, imageUrl: null, quantity: 0 },
        "basura",
      ],
    });
    const s = parseStoredCart(raw, "delacour", "retail");
    assert.deepEqual(s.lines, [
      { reference: "DL-000184", name: "Dije", unitPrice: 35_000, imageUrl: "/x.webp", quantity: 2, available: true, maxQuantity: null },
      { reference: "DL-000186", name: "Anillo", unitPrice: null, imageUrl: null, quantity: MAX_QUANTITY, available: true, maxQuantity: null },
    ]);
  });
});

describe("reconciliación con la verdad del backend", () => {
  it("actualiza precio/nombre/disponibilidad, retira lo desconocido y conserva lo no consultado", () => {
    const s = con([DIJE], [ARETES], [ANILLO]);
    const r = reconcileCart(s, [{ ...DIJE, price: 38_000, name: "Dije corazón oro" }, { ...ANILLO, available: false }], ["DL-000185"]);
    assert.deepEqual(
      r.lines.map((l) => [l.reference, l.name, l.unitPrice, l.available]),
      [
        ["DL-000184", "Dije corazón oro", 38_000, true],
        ["DL-000186", "Anillo esencia", null, false],
      ],
    );
    assert.deepEqual(cartReducer(s, { type: "reconcile", resolved: [], unknown: ["DL-000185"] }).lines.map((l) => l.reference), ["DL-000184", "DL-000186"]);
  });

  it("lo agotado se ve en el carrito pero no entra al pedido ni al total", () => {
    const s = reconcileCart(con([DIJE, 2], [ARETES]), [{ ...ARETES, available: false, maxQuantity: 0 }], []);
    assert.equal(totalItems(s), 3);
    assert.deepEqual(orderableLines(s).map((l) => l.reference), ["DL-000184"]);
    assert.deepEqual(cartTotal(s), { total: 70_000, unpricedItems: 0 });
    assert.deepEqual(selectionSnapshot(s).items, [{ reference: "DL-000184", quantity: 2 }]);
  });

  it("stock que baja después de agregar => la cantidad se reduce al stock real y se informa", () => {
    const s = con([{ ...DIJE, maxQuantity: 5 }, 5], [ARETES]);
    const { state, changes } = reconcileWithChanges(s, [{ ...DIJE, maxQuantity: 2 }], []);
    assert.equal(state.lines[0].quantity, 2);
    assert.equal(state.lines[0].maxQuantity, 2);
    assert.deepEqual(changes, [{ kind: "reduced", reference: "DL-000184", name: "Dije corazón", from: 5, to: 2 }]);
  });

  it("producto agotado o desactivado después de agregar => se informa (sin duplicar el aviso)", () => {
    const s = con([DIJE], [ARETES]);
    const r1 = reconcileWithChanges(s, [{ ...DIJE, available: false, maxQuantity: 0 }], ["DL-000185"]);
    assert.deepEqual(r1.changes, [
      { kind: "sold_out", reference: "DL-000184", name: "Dije corazón" },
      { kind: "removed", reference: "DL-000185", name: "Aretes brillo" },
    ]);
    assert.deepEqual(r1.state.lines.map((l) => [l.reference, l.available]), [["DL-000184", false]]);
    // Una segunda reconciliación con la misma verdad no vuelve a avisar.
    assert.deepEqual(reconcileWithChanges(r1.state, [{ ...DIJE, available: false, maxQuantity: 0 }], []).changes, []);
  });

  it("precio cambiado después de agregar => el carrito toma el precio vigente del backend", () => {
    const s = con([DIJE, 2]);
    const { state, changes } = reconcileWithChanges(s, [{ ...DIJE, price: 40_000 }], []);
    assert.equal(state.lines[0].unitPrice, 40_000);
    assert.deepEqual(cartTotal(state), { total: 80_000, unpricedItems: 0 });
    assert.deepEqual(changes, []);
  });

  it("vuelve a haber stock => la línea agotada vuelve a ser pedible", () => {
    const s = reconcileCart(con([DIJE]), [{ ...DIJE, available: false, maxQuantity: 0 }], []);
    const r = reconcileCart(s, [{ ...DIJE, available: true, maxQuantity: 4 }], []);
    assert.deepEqual(orderableLines(r).map((l) => l.reference), ["DL-000184"]);
  });
});

describe("stock en el carrito", () => {
  it("límite efectivo: el stock del backend, o el tope técnico si no controla inventario", () => {
    assert.equal(quantityLimit({ maxQuantity: 2 }), 2);
    assert.equal(quantityLimit({ maxQuantity: 0 }), 0);
    assert.equal(quantityLimit({ maxQuantity: null }), MAX_QUANTITY);
    assert.equal(quantityLimit({}), MAX_QUANTITY);
    assert.equal(quantityLimit({ maxQuantity: 5000 }), MAX_QUANTITY);
    assert.equal(quantityLimit({ maxQuantity: -3 }), 0);
  });

  it("agregar válido dentro del stock", () => {
    const s = con([{ ...DIJE, maxQuantity: 3 }, 2]);
    assert.equal(s.lines[0].quantity, 2);
    assert.equal(canAddMore(s, { ...DIJE, maxQuantity: 3 }), true);
  });

  it("nunca supera el stock: ni al agregar de más, ni sumando, ni con setQuantity", () => {
    const PIEZA = { ...DIJE, maxQuantity: 2 };
    let s = con([PIEZA, 5]);
    assert.equal(s.lines[0].quantity, 2);
    s = cartReducer(s, { type: "add", product: PIEZA });
    assert.equal(s.lines[0].quantity, 2);
    assert.equal(canAddMore(s, PIEZA), false);
    s = cartReducer(s, { type: "setQuantity", reference: PIEZA.reference, quantity: 9 });
    assert.equal(s.lines[0].quantity, 2);
    s = cartReducer(s, { type: "setQuantity", reference: PIEZA.reference, quantity: 1 });
    assert.equal(s.lines[0].quantity, 1);
  });

  it("agotado (o stock 0) nunca se agrega", () => {
    assert.equal(con([{ ...DIJE, available: false }]).lines.length, 0);
    assert.equal(con([{ ...DIJE, maxQuantity: 0 }]).lines.length, 0);
    assert.equal(canAddMore(emptyCart("delacour", "retail"), { ...DIJE, available: false }), false);
  });

  it("el límite persiste con el carrito (y los carritos viejos sin límite siguen funcionando)", () => {
    const s = con([{ ...DIJE, maxQuantity: 3 }, 2]);
    const leido = parseStoredCart(JSON.stringify(s), "delacour", "retail");
    assert.equal(leido.lines[0].maxQuantity, 3);
    const viejo = JSON.stringify({ ...s, lines: s.lines.map((l) => ({ reference: l.reference, name: l.name, unitPrice: l.unitPrice, imageUrl: l.imageUrl, quantity: l.quantity, available: l.available })) });
    assert.equal(parseStoredCart(viejo, "delacour", "retail").lines[0].maxQuantity, null);
  });
});

describe("selección confiable para el backend", () => {
  it("snapshot = solo referencias y cantidades de lo pedible (sin nombres ni precios)", () => {
    const s = reconcileCart(con([DIJE, 2], [ARETES]), [{ ...ARETES, available: false }], []);
    const snap = selectionSnapshot(s);
    assert.deepEqual(snap, { version: 1, slug: "delacour", context: "retail", items: [{ reference: "DL-000184", quantity: 2 }] });
    assert.equal(JSON.stringify(snap).includes("35000"), false);
    assert.equal(JSON.stringify(snap).includes("Dije"), false);
  });
});
