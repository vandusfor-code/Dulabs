/**
 * La evidencia de la oferta en las líneas del pedido — de ida y de vuelta con la base de datos (RPC simulado; la función SQL solo lee referencia y cantidad, así que la evidencia
 * viaja en el mismo JSON de las líneas sin migración). Solo existe en las líneas cuyo precio es el de una oferta vigente; un pedido de siempre se guarda y se lee idéntico.
 * El evento público del pedido (v2) conserva su contrato: lleva el precio efectivo y nada más.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orderEvent, orderSnapshot } from "@/lib/catalogo/pedidos/eventos";
import type { Order, OrderLine } from "@/lib/catalogo/pedidos/contrato";
import { createSupabaseOrdersRepository, orderFromRow } from "@/lib/catalogo/pedidos/repositorio";

const CON_OFERTA: OrderLine = { reference: "DL-000184", productName: "Dije corazón", quantity: 2, unitPrice: 28_000, subtotal: 56_000, listPrice: 35_000, offer: { key: "amor", name: "Amor y Amistad", version: 3 } };
const SIN_OFERTA: OrderLine = { reference: "DL-000185", productName: "Aretes brillo", quantity: 1, unitPrice: 42_000, subtotal: 42_000 };

const pedido = (lines: OrderLine[]): Order => ({
  id: "",
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

/** Un cliente de base de datos que solo conoce la función de creación: guarda lo recibido y responde como lo haría la base (la fila con las mismas líneas). */
function baseSimulada() {
  const recibido: Array<{ nombre: string; args: { p_pedido: Record<string, unknown> } }> = [];
  const supabase = {
    async rpc(nombre: string, args: { p_pedido: Record<string, unknown> }) {
      recibido.push({ nombre, args });
      const p = args.p_pedido;
      return { data: { creado: true, pedido: { ...p, id: "00000000-0000-4000-8000-000000000001", moneda: "COP", created_at: p.created_at, updated_at: p.created_at } }, error: null };
    },
  } as unknown as SupabaseClient;
  return { recibido, repo: createSupabaseOrdersRepository(supabase) };
}

describe("pedido con oferta ↔ base de datos", () => {
  it("al crear, las líneas con oferta guardan el precio de lista y la oferta (clave, nombre y versión); las demás se guardan exactamente como siempre", async () => {
    const { recibido, repo } = baseSimulada();
    const order = pedido([CON_OFERTA, SIN_OFERTA]);
    const r = await repo.create(order, orderEvent("catalog.order_request.created", order, { eventId: "evt-1", occurredAt: order.createdAt }));
    const lineas = recibido[0].args.p_pedido.lineas as Array<Record<string, unknown>>;
    assert.deepEqual(lineas[0], { reference: "DL-000184", product_name: "Dije corazón", quantity: 2, unit_price: 28_000, subtotal: 56_000, list_price: 35_000, offer: { key: "amor", name: "Amor y Amistad", version: 3 } });
    assert.deepEqual(lineas[1], { reference: "DL-000185", product_name: "Aretes brillo", quantity: 1, unit_price: 42_000, subtotal: 42_000 });
    assert.ok(!("list_price" in lineas[1]) && !("offer" in lineas[1]));
    assert.deepEqual(r.order.lines, [CON_OFERTA, SIN_OFERTA], "ida y vuelta: lo guardado es lo que se lee");
  });

  it("una línea con la evidencia a medias (solo lista, o solo oferta) no se guarda con ella", async () => {
    const { recibido, repo } = baseSimulada();
    const order = pedido([{ ...CON_OFERTA, offer: undefined }, { ...CON_OFERTA, reference: "DL-000186", listPrice: undefined }]);
    await repo.create(order, orderEvent("catalog.order_request.created", order, { eventId: "evt-2", occurredAt: order.createdAt }));
    for (const l of recibido[0].args.p_pedido.lineas as Array<Record<string, unknown>>) assert.ok(!("list_price" in l) && !("offer" in l));
  });

  it("leer un pedido de siempre (sin evidencia en la base) lo deja idéntico; la evidencia incompleta de una fila no se inventa", () => {
    const fila = {
      id: "00000000-0000-4000-8000-000000000001",
      id_tenant: "aaaaaaaa-0000-4000-8000-00000000000a",
      pedido_publico: "DL-ORD-ABC123",
      canal: "retail" as const,
      origen: "catalog" as const,
      estado: "validated" as const,
      clave_idempotencia: "k",
      huella_solicitud: null,
      contacto_phone_number_id: null,
      contacto_wa_id: null,
      total_unidades: 1,
      total: 42_000,
      unidades_sin_precio: 0,
      problemas: [],
      confirmacion: null,
      handoff: null,
      created_at: "2026-10-28T12:00:00.000Z",
      updated_at: "2026-10-28T12:00:00.000Z",
    };
    const leido = orderFromRow({ ...fila, lineas: [{ reference: "DL-000185", product_name: "Aretes brillo", quantity: 1, unit_price: 42_000, subtotal: 42_000 }] });
    assert.deepEqual(leido.lines, [SIN_OFERTA]);
    const incompletas = orderFromRow({
      ...fila,
      lineas: [
        { reference: "A", product_name: "A", quantity: 1, unit_price: 1, subtotal: 1, list_price: 5 },
        { reference: "B", product_name: "B", quantity: 1, unit_price: 1, subtotal: 1, offer: { key: "x", name: "X", version: 1 } },
      ],
    });
    for (const l of incompletas.lines) assert.ok(!("listPrice" in l) && !("offer" in l), l.reference);
  });

  it("el evento público del pedido (v2) conserva su contrato: precio efectivo y nada de lista ni de oferta", () => {
    const order = pedido([CON_OFERTA, SIN_OFERTA]);
    assert.deepEqual(orderSnapshot(order).lines[0], { reference: "DL-000184", product_name: "Dije corazón", quantity: 2, unit_price: 28_000, subtotal: 56_000 });
    const texto = JSON.stringify(orderEvent("catalog.order_request.created", order, { eventId: "evt-3", occurredAt: order.createdAt }));
    assert.ok(!texto.includes("list_price") && !texto.includes("Amor y Amistad"));
  });
});
