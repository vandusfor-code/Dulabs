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
  cartSavings,
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

  it("precio cambiado después de agregar => el carrito toma el precio vigente del backend y lo AVISA", () => {
    const s = con([DIJE, 2]);
    const { state, changes } = reconcileWithChanges(s, [{ ...DIJE, price: 40_000 }], []);
    assert.equal(state.lines[0].unitPrice, 40_000);
    assert.deepEqual(cartTotal(state), { total: 80_000, unpricedItems: 0 });
    assert.deepEqual(changes, [{ kind: "price_changed", reference: "DL-000184", name: "Dije corazón", from: 35_000, to: 40_000 }]);
    assert.deepEqual(reconcileWithChanges(state, [{ ...DIJE, price: 40_000 }], []).changes, [], "mismo precio: sin aviso");
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

describe("ofertas en el carrito (el precio efectivo manda; el de lista solo se muestra tachado)", () => {
  const CON_OFERTA: CartProduct = { ...DIJE, price: 28_000, listPrice: 35_000, offerLabel: "-20%" };

  it("una línea con oferta guarda el precio efectivo, el de lista y la etiqueta; sin oferta la línea queda IDÉNTICA a la de siempre", () => {
    const s = con([CON_OFERTA, 2], [ARETES]);
    assert.deepEqual(
      s.lines.map((l) => [l.reference, l.unitPrice, l.listPrice, l.offerLabel]),
      [
        ["DL-000184", 28_000, 35_000, "-20%"],
        ["DL-000185", 42_000, undefined, undefined],
      ],
    );
    assert.ok(!("listPrice" in s.lines[1]) && !("offerLabel" in s.lines[1]), "sin oferta no existen ni las propiedades");
    assert.deepEqual(cartTotal(s), { total: 2 * 28_000 + 42_000, unpricedItems: 0 }, "el total se calcula con el precio efectivo");
  });

  it("cartSavings = (lista − efectivo) por cantidad, solo de lo que entra al pedido; 0 sin ofertas", () => {
    assert.equal(cartSavings(con([DIJE, 2], [ARETES])), 0);
    assert.equal(cartSavings(con([CON_OFERTA, 3])), 3 * 7_000);
    const agotada = reconcileCart(con([CON_OFERTA, 3], [ARETES]), [{ ...CON_OFERTA, available: false, maxQuantity: 0 }], []);
    assert.equal(cartSavings(agotada), 0, "lo agotado no entra al pedido, así que tampoco cuenta como ahorro");
    assert.equal(cartSavings(emptyCart("delacour", "retail")), 0);
  });

  it("cartSavings nunca inventa un ahorro: lista igual o menor que el efectivo, o sin precio, no suma", () => {
    const base = con([DIJE]);
    const raros: CartState = {
      ...base,
      lines: [
        { ...base.lines[0], reference: "A", unitPrice: 10_000, listPrice: 10_000 },
        { ...base.lines[0], reference: "B", unitPrice: 10_000, listPrice: 9_000 },
        { ...base.lines[0], reference: "C", unitPrice: null, listPrice: 9_000 },
        { ...base.lines[0], reference: "D", unitPrice: 8_000, listPrice: 10_000, quantity: 2 },
      ],
    };
    assert.equal(cartSavings(raros), 4_000);
  });

  it("agregar de nuevo el producto refresca la oferta; si la oferta terminó, la línea pierde el precio tachado y la etiqueta", () => {
    let s = con([CON_OFERTA]);
    s = cartReducer(s, { type: "add", product: { ...DIJE, price: 30_000, listPrice: 35_000, offerLabel: "-14%" } });
    assert.deepEqual([s.lines[0].unitPrice, s.lines[0].listPrice, s.lines[0].offerLabel, s.lines[0].quantity], [30_000, 35_000, "-14%", 2]);
    s = cartReducer(s, { type: "add", product: DIJE });
    assert.deepEqual([s.lines[0].unitPrice, s.lines[0].quantity], [35_000, 3]);
    assert.ok(!("listPrice" in s.lines[0]) && !("offerLabel" in s.lines[0]), "la oferta ya no aplica: nada queda de ella");
  });

  it("un precio de lista que no es un número válido no se guarda", () => {
    const s = con([{ ...DIJE, price: 28_000, listPrice: Number.NaN, offerLabel: "-20%" }]);
    assert.ok(!("listPrice" in s.lines[0]) && !("offerLabel" in s.lines[0]));
    const sinEtiqueta = con([{ ...DIJE, price: 28_000, listPrice: 35_000 }]);
    assert.equal(sinEtiqueta.lines[0].listPrice, 35_000);
    assert.ok(!("offerLabel" in sinEtiqueta.lines[0]));
  });

  it("al reconciliar con el catálogo la oferta se actualiza; si la administradora la pausó, el precio vuelve al de lista y el cliente lo VE", () => {
    const s = con([CON_OFERTA, 2]);
    const { state, changes } = reconcileWithChanges(s, [DIJE], []);
    assert.deepEqual([state.lines[0].unitPrice, "listPrice" in state.lines[0], "offerLabel" in state.lines[0]], [35_000, false, false]);
    assert.deepEqual(changes, [{ kind: "price_changed", reference: "DL-000184", name: "Dije corazón", from: 28_000, to: 35_000 }]);
    assert.equal(cartSavings(state), 0);
    // Y al revés: aparece una oferta que antes no había.
    const r = reconcileWithChanges(state, [CON_OFERTA], []);
    assert.deepEqual([r.state.lines[0].unitPrice, r.state.lines[0].listPrice, r.state.lines[0].offerLabel], [28_000, 35_000, "-20%"]);
    assert.deepEqual(r.changes, [{ kind: "price_changed", reference: "DL-000184", name: "Dije corazón", from: 35_000, to: 28_000 }]);
  });

  it("si solo cambia la etiqueta o el precio de lista (el efectivo es el mismo) no se avisa de un cambio de precio", () => {
    const s = con([CON_OFERTA]);
    const r = reconcileWithChanges(s, [{ ...CON_OFERTA, listPrice: 36_000, offerLabel: "-22%" }], []);
    assert.deepEqual(r.changes, []);
    assert.deepEqual([r.state.lines[0].listPrice, r.state.lines[0].offerLabel], [36_000, "-22%"]);
  });

  it("la selección que viaja al backend NUNCA lleva precios ni ofertas: el backend los calcula de nuevo", () => {
    const snap = selectionSnapshot(con([CON_OFERTA, 2]));
    assert.deepEqual(snap, { version: 1, slug: "delacour", context: "retail", items: [{ reference: "DL-000184", quantity: 2 }] });
    const texto = JSON.stringify(snap);
    assert.ok(!texto.includes("28000") && !texto.includes("35000") && !texto.includes("-20%") && !texto.includes("listPrice"));
  });

  describe("persistencia (solo pistas para mostrar; el catálogo las corrige al volver a consultar)", () => {
    const guardado = (lines: unknown[]) => JSON.stringify({ ...con([DIJE]), lines });
    const linea = (extra: Record<string, unknown>) => ({ reference: "DL-000184", name: "Dije corazón", unitPrice: 28_000, imageUrl: null, quantity: 1, available: true, maxQuantity: null, ...extra });

    it("se guardan y se leen de vuelta cuando son coherentes", () => {
      const leido = parseStoredCart(JSON.stringify(con([CON_OFERTA, 2])), "delacour", "retail");
      assert.deepEqual([leido.lines[0].unitPrice, leido.lines[0].listPrice, leido.lines[0].offerLabel], [28_000, 35_000, "-20%"]);
    });

    it("un carrito guardado antes de las ofertas (sin esas propiedades) sigue funcionando igual", () => {
      const leido = parseStoredCart(guardado([linea({})]), "delacour", "retail");
      assert.equal(leido.lines.length, 1);
      assert.ok(!("listPrice" in leido.lines[0]) && !("offerLabel" in leido.lines[0]));
    });

    it("lo incoherente se descarta (no se muestra un tachado que no cuadra): lista menor o igual al efectivo, texto, sin precio efectivo", () => {
      for (const listPrice of [28_000, 20_000, "35000", null, -5, Number.POSITIVE_INFINITY]) {
        const leido = parseStoredCart(guardado([linea({ listPrice, offerLabel: "-20%" })]), "delacour", "retail");
        assert.ok(!("listPrice" in leido.lines[0]) && !("offerLabel" in leido.lines[0]), `listPrice=${String(listPrice)}`);
      }
      const sinPrecio = parseStoredCart(guardado([linea({ unitPrice: null, listPrice: 35_000, offerLabel: "-20%" })]), "delacour", "retail");
      assert.ok(!("listPrice" in sinPrecio.lines[0]));
    });

    it("la etiqueta solo se acepta si es texto corto y va con un precio de lista válido", () => {
      const larga = parseStoredCart(guardado([linea({ listPrice: 35_000, offerLabel: "x".repeat(41) })]), "delacour", "retail");
      assert.equal(larga.lines[0].listPrice, 35_000);
      assert.ok(!("offerLabel" in larga.lines[0]), "una etiqueta de más de 40 caracteres se descarta");
      const numerica = parseStoredCart(guardado([linea({ listPrice: 35_000, offerLabel: 20 })]), "delacour", "retail");
      assert.ok(!("offerLabel" in numerica.lines[0]));
      const huerfana = parseStoredCart(guardado([linea({ offerLabel: "-20%" })]), "delacour", "retail");
      assert.ok(!("offerLabel" in huerfana.lines[0]), "una etiqueta sin precio de lista no se guarda");
    });
  });
});
