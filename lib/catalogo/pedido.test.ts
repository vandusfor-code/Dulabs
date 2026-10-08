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

  it("REFERENCIA + PRODUCTO + CANTIDAD por línea, resumen y cierre fijo", () => {
    assert.equal(
      orderWhatsappMessage(lineas, "retail"),
      [
        "Hola, me interesan estos productos:",
        "",
        "• DL-000184 · Dije corazón — 2 unidades",
        "• DL-000186 · Anillo esencia — 1 unidad",
        "",
        "Total de productos: 2",
        "Unidades: 3",
        "",
        "Quisiera información para realizar el pedido.",
      ].join("\n"),
    );
  });

  it("con la solicitud: id corto y total estimado calculado por el backend", () => {
    const texto = orderWhatsappMessage(lineas, "retail", { requestId: "DL-ORD-7F42KQ", total: 1_250_000, unpricedUnits: 0 });
    assert.match(texto, /\nTotal estimado: \$1\.250\.000\n/);
    assert.match(texto, /\nSolicitud: DL-ORD-7F42KQ\nQuisiera información para realizar el pedido\.$/);
    assert.match(orderWhatsappMessage(lineas, "retail", { total: 90_000, unpricedUnits: 1 }), /Total estimado: \$90\.000 \+ 1 producto con precio a consultar/);
    assert.doesNotMatch(orderWhatsappMessage(lineas, "retail", { total: 0, unpricedUnits: 3 }), /Total estimado/, "sin precios no se inventa un total");
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
    assert.deepEqual(parseOrderMessage(orderWhatsappMessage(lineas, "retail", { requestId: "DL-ORD-7F42KQ", total: 100_000 })), {
      context: "retail",
      items: [
        { reference: "DL-000184", quantity: 2 },
        { reference: "DL-000186", quantity: 1 },
      ],
      requestId: "DL-ORD-7F42KQ",
    });
    assert.deepEqual(parseOrderMessage(orderWhatsappMessage([{ reference: "DL-000184", name: "Dije — oro", quantity: 3 }], "wholesale")), {
      context: "wholesale",
      items: [{ reference: "DL-000184", quantity: 3 }],
      requestId: null,
    });
  });

  it("también lee el formato de la fase anterior", () => {
    const legado = "Hola, estoy interesado(a) en estos productos:\n\n• Dije — Ref. DL-000184 — Cantidad: 2\n\nTotal de productos: 2";
    assert.deepEqual(parseOrderMessage(legado), { context: "retail", items: [{ reference: "DL-000184", quantity: 2 }], requestId: null });
    const fase3 = "Hola, me interesan estos productos:\n\n• DL-000184 · Dije — 2 unidades\n\nQuiero información para realizar la compra.";
    assert.deepEqual(parseOrderMessage(fase3).items, [{ reference: "DL-000184", quantity: 2 }]);
  });

  it("nunca interpreta nombres ni texto libre", () => {
    assert.deepEqual(parseOrderMessage("Hola, quiero el dije corazón y el anillo DL-000186"), { context: null, items: [], requestId: null });
  });
});

describe("ofertas en el pedido (se cobra el precio efectivo; la oferta queda como evidencia)", () => {
  const DIJE_OFERTA: ResolvedOrderProduct = { ...DIJE, price: 28_000, listPrice: 35_000, offer: { key: "amor", name: "Amor y Amistad", version: 3 } };
  const conOferta = new Map([DIJE_OFERTA, ARETES, ANILLO].map((p) => [p.reference, p]));

  it("la línea cobra el precio efectivo, conserva el de lista y la oferta con su versión, y el ahorro es (lista − efectivo) × cantidad", () => {
    const r = prepareOrder([{ reference: "DL-000184", quantity: 3 }], conOferta);
    assert.deepEqual(r.lines, [
      { reference: "DL-000184", name: "Dije corazón", quantity: 3, unitPrice: 28_000, subtotal: 84_000, listPrice: 35_000, offer: { key: "amor", name: "Amor y Amistad", version: 3 } },
    ]);
    assert.equal(r.total, 84_000);
    assert.equal(r.savings, 21_000);
  });

  it("sin ofertas las líneas quedan IDÉNTICAS a las de siempre (sin evidencia) y el ahorro es 0", () => {
    const r = prepareOrder([{ reference: "DL-000185", quantity: 1 }], conOferta);
    assert.deepEqual(r.lines, [{ reference: "DL-000185", name: "Aretes brillo", quantity: 1, unitPrice: 42_000, subtotal: 42_000 }]);
    assert.ok(!("listPrice" in r.lines[0]) && !("offer" in r.lines[0]));
    assert.equal(r.savings, 0);
  });

  it("en un pedido mixto solo la línea con oferta lleva evidencia y solo ella suma al ahorro; el total mezcla ambos precios", () => {
    const r = prepareOrder(
      [
        { reference: "DL-000184", quantity: 1 },
        { reference: "DL-000185", quantity: 2 },
        { reference: "DL-000186", quantity: 1 },
      ],
      conOferta,
    );
    assert.deepEqual(r.lines.map((l) => [l.reference, l.unitPrice, l.listPrice]), [["DL-000184", 28_000, 35_000], ["DL-000185", 42_000, undefined], ["DL-000186", null, undefined]]);
    assert.equal(r.total, 28_000 + 84_000);
    assert.equal(r.savings, 7_000);
    assert.equal(r.unpricedUnits, 1);
  });

  it("si el stock reduce la cantidad, el ahorro se calcula sobre lo concedido (no sobre lo pedido)", () => {
    const limitado = new Map([{ ...DIJE_OFERTA, maxQuantity: 2 }].map((p) => [p.reference, p]));
    const r = prepareOrder([{ reference: "DL-000184", quantity: 5 }], limitado);
    assert.equal(r.lines[0].quantity, 2);
    assert.equal(r.savings, 14_000);
    assert.equal(r.total, 56_000);
  });

  it("nunca se inventa un ahorro: lista igual o menor que el efectivo, o precio a consultar, no suman", () => {
    const raros = new Map(
      [
        { ...DIJE, reference: "DL-000001", price: 35_000, listPrice: 35_000, offer: { key: "a", name: "A", version: 1 } },
        { ...DIJE, reference: "DL-000002", price: 36_000, listPrice: 35_000, offer: { key: "b", name: "B", version: 1 } },
        { ...DIJE, reference: "DL-000003", price: null, listPrice: 35_000, offer: { key: "c", name: "C", version: 1 } },
      ].map((p) => [p.reference, p]),
    );
    const r = prepareOrder(
      [
        { reference: "DL-000001", quantity: 1 },
        { reference: "DL-000002", quantity: 1 },
        { reference: "DL-000003", quantity: 1 },
      ],
      raros,
    );
    assert.equal(r.savings, 0);
  });

  it("una línea con lista pero sin oferta (o al revés) no lleva evidencia a medias", () => {
    const solo = new Map([{ ...DIJE, listPrice: 35_000 }, { ...ARETES, offer: { key: "x", name: "X", version: 1 } }].map((p) => [p.reference, p]));
    const r = prepareOrder(
      [
        { reference: "DL-000184", quantity: 1 },
        { reference: "DL-000185", quantity: 1 },
      ],
      solo,
    );
    for (const l of r.lines) assert.ok(!("listPrice" in l) && !("offer" in l), l.reference);
  });

  describe("mensaje de WhatsApp", () => {
    const lineas = [
      { reference: "DL-000184", name: "Dije corazón", quantity: 2 },
      { reference: "DL-000185", name: "Aretes brillo", quantity: 1 },
    ];

    it("con ahorro agrega UNA línea con el monto, justo después del total; sin ahorro el mensaje es el de siempre, byte a byte", () => {
      const base = orderWhatsappMessage(lineas, "retail", { requestId: "DL-ORD-7F42KQ", total: 98_000, unpricedUnits: 0 });
      const conAhorro = orderWhatsappMessage(lineas, "retail", { requestId: "DL-ORD-7F42KQ", total: 98_000, unpricedUnits: 0, savings: 14_000 });
      assert.match(conAhorro, /Total estimado: \$98\.000\nIncluye ofertas vigentes \(ahorro: \$14\.000\)\n/);
      assert.equal(conAhorro.replace("Incluye ofertas vigentes (ahorro: $14.000)\n", ""), base);
      for (const savings of [0, undefined, -5]) assert.equal(orderWhatsappMessage(lineas, "retail", { requestId: "DL-ORD-7F42KQ", total: 98_000, unpricedUnits: 0, savings }), base);
    });

    it("sin total (nada con precio) no se menciona ningún ahorro", () => {
      assert.doesNotMatch(orderWhatsappMessage(lineas, "retail", { total: 0, unpricedUnits: 2, savings: 9_000 }), /ahorro|ofertas/);
    });

    it("el webhook lee el mensaje con ahorro igual que el de siempre: mismas referencias, cantidades, canal y solicitud", () => {
      const texto = orderWhatsappMessage(lineas, "wholesale", { requestId: "DL-ORD-7F42KQ", total: 98_000, savings: 14_000 });
      assert.deepEqual(parseOrderMessage(texto), {
        context: "wholesale",
        items: [
          { reference: "DL-000184", quantity: 2 },
          { reference: "DL-000185", quantity: 1 },
        ],
        requestId: "DL-ORD-7F42KQ",
      });
    });
  });
});
