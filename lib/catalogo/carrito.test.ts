/**
 * Carrito del catálogo público — dominio puro (sin DOM ni red).
 * Garantías: identidad por referencia real, cantidades acotadas, totales sin
 * inventar precios, mensaje de WhatsApp con datos reales, persistencia
 * tolerante a datos corruptos y separación por catálogo/contexto.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_LINES,
  MAX_QUANTITY,
  cartReducer,
  cartStorageKey,
  cartTotal,
  cartWhatsappLink,
  cartWhatsappMessage,
  emptyCart,
  lineSubtotal,
  parseStoredCart,
  reconcileCart,
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

describe("pedido por WhatsApp", () => {
  it("mensaje con nombre, referencia real y cantidad de cada línea", () => {
    const s = con([DIJE, 2], [ARETES], [ANILLO, 2]);
    assert.equal(
      cartWhatsappMessage(s),
      [
        "Hola, estoy interesado(a) en estos productos:",
        "",
        "• Dije corazón — Ref. DL-000184 — Cantidad: 2",
        "• Aretes brillo — Ref. DL-000185 — Cantidad: 1",
        "• Anillo esencia — Ref. DL-000186 — Cantidad: 2",
        "",
        "Total de productos: 5",
      ].join("\n"),
    );
  });

  it("el carrito mayorista lo declara en el mensaje", () => {
    const s = cartReducer(emptyCart("delacour", "wholesale"), { type: "add", product: DIJE });
    assert.match(cartWhatsappMessage(s), /^Hola, estoy interesado\(a\) en estos productos \(precio mayorista\):/);
  });

  it("link wa.me con el número del negocio; null sin número o sin productos", () => {
    const s = con([DIJE]);
    const link = cartWhatsappLink("+57 318 371 5860", s);
    assert.ok(link?.startsWith("https://wa.me/573183715860?text="));
    assert.equal(decodeURIComponent(link!.split("text=")[1]), cartWhatsappMessage(s));
    assert.equal(cartWhatsappLink(null, s), null);
    assert.equal(cartWhatsappLink("123", s), null);
    assert.equal(cartWhatsappLink("573183715860", emptyCart("delacour", "retail")), null);
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
      { reference: "DL-000184", name: "Dije", unitPrice: 35_000, imageUrl: "/x.webp", quantity: 2 },
      { reference: "DL-000186", name: "Anillo", unitPrice: null, imageUrl: null, quantity: MAX_QUANTITY },
    ]);
  });
});

describe("reconciliación futura con el catálogo vigente", () => {
  it("actualiza lo confirmado, retira lo que ya no está disponible y conserva lo no consultado", () => {
    const s = con([DIJE], [ARETES], [ANILLO]);
    const r = reconcileCart(
      s,
      new Map<string, CartProduct | undefined>([
        ["DL-000184", { ...DIJE, price: 38_000 }],
        ["DL-000185", undefined],
      ]),
    );
    assert.deepEqual(
      r.lines.map((l) => [l.reference, l.unitPrice, l.quantity]),
      [
        ["DL-000184", 38_000, 1],
        ["DL-000186", null, 1],
      ],
    );
  });
});
