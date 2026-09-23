/**
 * Pedido estructurado — dominio puro (sin red ni BD).
 * Garantías: el navegador solo aporta referencia + cantidad; la preparación
 * nunca concede más que el stock ni incluye lo agotado o desconocido; el
 * mensaje de WhatsApp tiene un formato único y el webhook lo lee de forma
 * determinista.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORDER_MAX_QUANTITY,
  normalizeOrderItems,
  orderRequestSchema,
  orderWhatsappMessage,
  parseOrderMessage,
  prepareOrder,
  whatsappUrl,
  type ResolvedOrderProduct,
} from "@/lib/catalogo/pedido";

const DIJE: ResolvedOrderProduct = { reference: "DL-000184", name: "Dije corazón", price: 35_000, availability: "available", maxQuantity: 10 };
const ARETES: ResolvedOrderProduct = { reference: "DL-000185", name: "Aretes brillo", price: 42_000, availability: "low", maxQuantity: 2 };
const ANILLO: ResolvedOrderProduct = { reference: "DL-000186", name: "Anillo esencia", price: null, availability: "available", maxQuantity: null };
const PULSO: ResolvedOrderProduct = { reference: "DL-000187", name: "Pulsera luz", price: 50_000, availability: "sold_out", maxQuantity: 0 };

const catalogo = new Map([DIJE, ARETES, ANILLO, PULSO].map((p) => [p.reference, p]));

describe("contrato del pedido (lo único que acepta el backend)", () => {
  it("acepta { items: [{ reference, quantity }] }", () => {
    const r = orderRequestSchema.safeParse({ items: [{ reference: "DL-000184", quantity: 2 }] });
    assert.ok(r.success);
  });

  it("rechaza precios, nombres u otros campos del cliente", () => {
    assert.equal(orderRequestSchema.safeParse({ items: [{ reference: "DL-000184", quantity: 2, price: 1 }] }).success, false);
    assert.equal(orderRequestSchema.safeParse({ items: [{ reference: "DL-000184", quantity: 2 }], total: 1 }).success, false);
    assert.equal(orderRequestSchema.safeParse({ items: [{ reference: "DL-000184", quantity: 2, name: "x" }] }).success, false);
  });

  it("rechaza cantidades imposibles y pedidos vacíos", () => {
    for (const quantity of [0, -1, 1.5, ORDER_MAX_QUANTITY + 1, "2"]) {
      assert.equal(orderRequestSchema.safeParse({ items: [{ reference: "DL-000184", quantity }] }).success, false, String(quantity));
    }
    assert.equal(orderRequestSchema.safeParse({ items: [] }).success, false);
    assert.equal(orderRequestSchema.safeParse({}).success, false);
  });

  it("normaliza referencias y suma duplicados (con tope)", () => {
    assert.deepEqual(
      normalizeOrderItems([
        { reference: " dl-000184 ", quantity: 2 },
        { reference: "DL-000184", quantity: 3 },
        { reference: "DL-000185", quantity: 98 },
        { reference: "DL-000185", quantity: 98 },
      ]),
      [
        { reference: "DL-000184", quantity: 5 },
        { reference: "DL-000185", quantity: ORDER_MAX_QUANTITY },
      ],
    );
  });
});

describe("preparación contra la verdad del backend", () => {
  it("pedido válido: líneas con precio vigente, subtotales y sin ajustes", () => {
    const r = prepareOrder(
      [
        { reference: "DL-000184", quantity: 2 },
        { reference: "DL-000186", quantity: 1 },
      ],
      catalogo,
    );
    assert.deepEqual(r.adjustments, []);
    assert.deepEqual(r.lines, [
      { reference: "DL-000184", name: "Dije corazón", quantity: 2, unitPrice: 35_000, subtotal: 70_000 },
      { reference: "DL-000186", name: "Anillo esencia", quantity: 1, unitPrice: null, subtotal: null },
    ]);
    assert.equal(r.totalUnits, 3);
    assert.equal(r.total, 70_000);
    assert.equal(r.unpricedUnits, 1);
  });

  it("superar el stock => se concede solo lo disponible y se informa", () => {
    const r = prepareOrder([{ reference: "DL-000185", quantity: 5 }], catalogo);
    assert.deepEqual(r.lines.map((l) => l.quantity), [2]);
    assert.deepEqual(r.adjustments, [{ kind: "quantity_reduced", reference: "DL-000185", name: "Aretes brillo", requested: 5, granted: 2 }]);
  });

  it("agotado => fuera del pedido, con aviso", () => {
    const r = prepareOrder([{ reference: "DL-000187", quantity: 1 }], catalogo);
    assert.deepEqual(r.lines, []);
    assert.deepEqual(r.adjustments, [{ kind: "sold_out", reference: "DL-000187", name: "Pulsera luz", requested: 1 }]);
  });

  it("referencia inexistente (o de otro negocio: no resuelta) => fuera del pedido, con aviso", () => {
    const r = prepareOrder([{ reference: "XX-000001", quantity: 1 }], catalogo);
    assert.deepEqual(r.lines, []);
    assert.deepEqual(r.adjustments, [{ kind: "not_found", reference: "XX-000001", requested: 1 }]);
  });

  it("es determinista", () => {
    const items = [
      { reference: "DL-000185", quantity: 5 },
      { reference: "DL-000184", quantity: 1 },
    ];
    assert.deepEqual(prepareOrder(items, catalogo), prepareOrder(items, catalogo));
  });
});

describe("mensaje de WhatsApp (formato centralizado)", () => {
  const lineas = [
    { reference: "DL-000184", name: "Dije corazón", quantity: 2 },
    { reference: "DL-000186", name: "Anillo esencia", quantity: 1 },
  ];

  it("referencia primero, nombre y cantidad; cierre fijo", () => {
    assert.equal(
      orderWhatsappMessage(lineas, "retail"),
      [
        "Hola, me interesan estos productos:",
        "",
        "• DL-000184 · Dije corazón — 2 unidades",
        "• DL-000186 · Anillo esencia — 1 unidad",
        "",
        "Quiero información para realizar la compra.",
      ].join("\n"),
    );
  });

  it("el pedido mayorista lo declara", () => {
    assert.match(orderWhatsappMessage(lineas, "wholesale"), /^Hola, me interesan estos productos \(precio mayorista\):/);
  });

  it("link wa.me con el número del negocio; null sin número válido", () => {
    const texto = orderWhatsappMessage(lineas, "retail");
    const link = whatsappUrl("+57 318 371 5860", texto);
    assert.ok(link?.startsWith("https://wa.me/573183715860?text="));
    assert.equal(decodeURIComponent(link!.split("text=")[1]), texto);
    assert.equal(whatsappUrl(null, texto), null);
    assert.equal(whatsappUrl("123", texto), null);
  });

  it("el webhook lo lee de forma determinista (ida y vuelta)", () => {
    assert.deepEqual(parseOrderMessage(orderWhatsappMessage(lineas, "retail")), {
      context: "retail",
      items: [
        { reference: "DL-000184", quantity: 2 },
        { reference: "DL-000186", quantity: 1 },
      ],
    });
    assert.deepEqual(parseOrderMessage(orderWhatsappMessage([{ reference: "DL-000184", name: "Dije — oro", quantity: 3 }], "wholesale")), {
      context: "wholesale",
      items: [{ reference: "DL-000184", quantity: 3 }],
    });
  });

  it("también lee el formato de la fase anterior", () => {
    const legado = "Hola, estoy interesado(a) en estos productos:\n\n• Dije — Ref. DL-000184 — Cantidad: 2\n\nTotal de productos: 2";
    assert.deepEqual(parseOrderMessage(legado), { context: "retail", items: [{ reference: "DL-000184", quantity: 2 }] });
  });

  it("nunca interpreta nombres ni texto libre", () => {
    assert.deepEqual(parseOrderMessage("Hola, quiero el dije corazón y el anillo DL-000186"), { context: null, items: [] });
  });
});
