/**
 * El pedido en el panel de la asesora, con la EVIDENCIA de la oferta: qué precio se cobró, cuál era el de lista y bajo qué oferta. Solo aparece en las líneas cuyo precio es el de
 * una oferta vigente al hacer el pedido; un pedido sin ofertas se ve y se serializa exactamente igual que siempre.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LineasPedido } from "@/components/dashboard/catalogo/PedidoDetalle";
import { formatPrice } from "@/components/dashboard/catalogo/ui";
import type { Order, OrderLine } from "@/lib/catalogo/pedidos/contrato";
import { pedidoPanel } from "@/lib/catalogo/pedidos/panel";

const es = (a: string): string => a;
const en = (_a: string, b: string): string => b;

const LINEA_OFERTA: OrderLine = { reference: "DL-000184", productName: "Dije corazón", quantity: 2, unitPrice: 28_000, subtotal: 56_000, listPrice: 35_000, offer: { key: "amor", name: "Amor y Amistad", version: 3 } };
const LINEA_LISTA: OrderLine = { reference: "DL-000185", productName: "Aretes brillo", quantity: 1, unitPrice: 42_000, subtotal: 42_000 };

const pedido = (lines: OrderLine[]): Order => ({
  id: "00000000-0000-4000-8000-000000000001",
  orderId: "DL-ORD-ABC123",
  businessId: "aaaaaaaa-0000-4000-8000-00000000000a",
  channel: "retail",
  source: "catalog",
  status: "validated",
  contact: null,
  lines,
  totalUnits: lines.reduce((s, l) => s + l.quantity, 0),
  total: lines.reduce((s, l) => s + (l.subtotal ?? 0), 0),
  unpricedUnits: 0,
  currency: "COP",
  issues: [],
  confirmation: null,
  handoff: null,
  checkout: null,
  confirmedAt: null,
  idempotencyKey: "clave-de-prueba",
  requestFingerprint: null,
  createdAt: "2026-10-28T12:00:00.000Z",
  updatedAt: "2026-10-28T12:00:00.000Z",
});

describe("panel de pedidos — evidencia de la oferta", () => {
  it("la línea cobrada con una oferta lleva el precio de lista y el NOMBRE de la oferta; la otra no lleva nada de eso", () => {
    const p = pedidoPanel(pedido([LINEA_OFERTA, LINEA_LISTA]), []);
    assert.deepEqual(p.lineas[0], { referencia: "DL-000184", nombre: "Dije corazón", cantidad: 2, precio_unitario: 28_000, subtotal: 56_000, precio_lista: 35_000, oferta: "Amor y Amistad" });
    assert.deepEqual(p.lineas[1], { referencia: "DL-000185", nombre: "Aretes brillo", cantidad: 1, precio_unitario: 42_000, subtotal: 42_000 });
    assert.ok(!("precio_lista" in p.lineas[1]) && !("oferta" in p.lineas[1]), "sin oferta ni siquiera existen las propiedades");
    assert.equal(p.total, 98_000, "el total es el efectivo");
  });

  it("el código interno y la versión de la oferta NO salen al panel (solo el nombre público)", () => {
    const texto = JSON.stringify(pedidoPanel(pedido([LINEA_OFERTA]), []));
    assert.ok(!texto.includes('"amor"') && !texto.includes("version"));
  });

  it("evidencia incompleta (precio de lista sin oferta o al revés) no se muestra: nunca una mitad de la historia", () => {
    const soloLista = pedidoPanel(pedido([{ ...LINEA_OFERTA, offer: undefined }]), []);
    const soloOferta = pedidoPanel(pedido([{ ...LINEA_OFERTA, listPrice: undefined }]), []);
    for (const p of [soloLista, soloOferta]) assert.ok(!("precio_lista" in p.lineas[0]) && !("oferta" in p.lineas[0]));
  });
});

describe("el detalle del pedido en el Dashboard", () => {
  const html = (lines: OrderLine[], t: (es: string, en: string) => string = es) => renderToStaticMarkup(<LineasPedido p={pedidoPanel(pedido(lines), [])} t={t} />);

  it("muestra «Oferta «X» · antes $Y» solo bajo la línea que se cobró con oferta", () => {
    const h = html([LINEA_OFERTA, LINEA_LISTA]);
    assert.ok(h.includes(`Oferta «Amor y Amistad» · antes ${formatPrice(35_000)}`));
    assert.equal((h.match(/Oferta «/g) ?? []).length, 1);
    assert.ok(h.includes(formatPrice(56_000)) && h.includes(formatPrice(42_000)));
  });

  it("un pedido sin ofertas se ve exactamente igual que siempre", () => {
    const h = html([LINEA_LISTA]);
    assert.ok(!h.includes("Oferta") && !h.includes("antes"));
  });

  it("en inglés el rótulo también se traduce", () => {
    const h = html([LINEA_OFERTA], en);
    assert.ok(h.includes(`Offer «Amor y Amistad» · was ${formatPrice(35_000)}`));
  });

  it("el nombre de la oferta (texto de la administradora) se escapa", () => {
    const h = html([{ ...LINEA_OFERTA, offer: { key: "x", name: "<b onmouseover=alert(1)>", version: 1 } }]);
    assert.ok(!h.includes("<b onmouseover") && h.includes("&lt;b onmouseover=alert(1)&gt;"));
  });
});
