/**
 * Adaptador HTTP ÚNICO del carrito y la solicitud de pedido, para los dos
 * canales:
 *
 *   detal:  /catalogo/{slug}/seleccion           /catalogo/{slug}/pedido
 *   mayor:  /catalogo/{slug}/mayor/{token}/…      (el token decide el canal)
 *
 * El canal lo decide la RUTA autorizada (y el servicio verifica el token);
 * nunca un parámetro del navegador. Las respuestas no incluyen ids internos
 * (producto, negocio) ni el precio del otro canal.
 */
import { supabaseAdmin } from "@/lib/supabase";
import type { CartProduct } from "@/lib/catalogo/carrito";
import type { PriceContext } from "@/lib/catalogo/domain";
import { orderRequestSchema, type OrderDraft } from "@/lib/catalogo/pedido";
import { orderSigningKey } from "@/lib/catalogo/pedido-firma";
import { logOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { productionOrderEngine } from "@/lib/catalogo/pedidos/produccion";
import type { PublicCatalogProduct } from "@/lib/catalogo/publicacion";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import { OrderSigningUnavailable, SELECTION_MAX, createPublicCatalogService, type OrderDeps } from "@/lib/catalogo/service";

export interface Canal {
  slug: string;
  context: PriceContext;
  token?: string;
}

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const MAX_BODY_BYTES = 24 * 1024;

type Service = ReturnType<typeof createPublicCatalogService>;

function servicioReal(): Service {
  const supabase = supabaseAdmin();
  const orders: OrderDeps = { key: orderSigningKey(), engine: productionOrderEngine(supabase) ?? undefined, events: logOrderEventSink };
  return createPublicCatalogService({ repo: createSupabaseCatalogRepository(supabase), orders });
}

/** Proyección que el carrito sabe reconciliar (nada interno). */
export function cartProductOf(p: PublicCatalogProduct): CartProduct {
  return { reference: p.reference, name: p.name, price: p.price, imageUrl: p.thumbUrl ?? p.imageUrl, available: p.available, maxQuantity: p.maxQuantity };
}

/** Vista PÚBLICA del borrador: sin negocio ni ids internos de producto. */
export function publicDraft(d: OrderDraft) {
  return {
    requestId: d.requestId,
    channel: d.channel,
    currency: d.currency,
    items: d.items.map((i) => ({ reference: i.reference, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, subtotal: i.subtotal })),
    totalProducts: d.totalProducts,
    totalUnits: d.totalUnits,
    total: d.total,
    unpricedUnits: d.unpricedUnits,
    createdAt: d.createdAt,
  };
}

/** GET …/seleccion?ref=DL-000184&ref=… : la verdad de cada referencia + la cotización firmada de esos precios. */
export async function responderSeleccion(request: Request, canal: Canal, servicio: () => Service = servicioReal): Promise<Response> {
  // El mayorista va detrás de un token en la URL: nunca se guarda en cachés compartidas.
  const headers =
    canal.context === "wholesale"
      ? { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" }
      : { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60", "X-Robots-Tag": "noindex, nofollow" };
  const references = new URL(request.url).searchParams.getAll("ref").slice(0, SELECTION_MAX * 2);
  try {
    const resolved = await servicio().resolveSelection({ slug: canal.slug, references, context: canal.context, token: canal.token });
    if (!resolved) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    return Response.json({ items: resolved.items.map(cartProductOf), unknown: resolved.unknown, quote: resolved.quote }, { headers });
  } catch (error) {
    console.error("[catalogo/seleccion] error resolviendo la selección:", error instanceof Error ? error.message : error);
    return Response.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}

/**
 * POST …/pedido  body: { items: [{ reference, quantity }], quote?, requestKey? }
 * Respuestas: ready (link de WhatsApp + solicitud) | adjusted | review | no_whatsapp.
 */
export async function responderPedido(request: Request, canal: Canal, servicio: () => Service = servicioReal): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "payload_too_large" }, { status: 413, headers: NO_STORE });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE });
  }
  const parsed = orderRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_order" }, { status: 400, headers: NO_STORE });

  try {
    const result = await servicio().prepareOrder({ slug: canal.slug, context: canal.context, token: canal.token, ...parsed.data });
    if (!result) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    const ready = result.status === "ready";
    return Response.json(
      {
        status: result.status,
        whatsappUrl: ready ? result.whatsappUrl : null,
        request: ready ? publicDraft(result.draft) : null,
        adjustments: result.order.adjustments,
        quote: result.selection.quote,
        selection: { items: result.selection.items.map(cartProductOf), unknown: result.selection.unknown },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof OrderSigningUnavailable) console.error("[catalogo/pedido]", error.message);
    else console.error("[catalogo/pedido] error preparando el pedido:", error instanceof Error ? error.message : error);
    return Response.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
