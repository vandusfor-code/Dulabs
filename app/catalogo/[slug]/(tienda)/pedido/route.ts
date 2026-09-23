/**
 * POST /catalogo/{slug}/pedido   body: { items: [{ reference, quantity }] }
 *
 * Prepara el pedido de la tienda (detal) en el BACKEND antes de abrir
 * WhatsApp: vuelve a resolver cada referencia en este negocio y esta
 * publicación (producto real -> precio vigente -> stock vigente ->
 * disponibilidad). Si algo cambió responde "adjusted" con la verdad para que
 * el cliente revise; solo "ready" trae el link de WhatsApp, con el mensaje
 * armado aquí. El cuerpo solo admite referencias y cantidades (zod estricto):
 * nunca precios, nombres ni ids del navegador.
 */
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { CartProduct } from "@/lib/catalogo/carrito";
import { orderRequestSchema } from "@/lib/catalogo/pedido";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import { createPublicCatalogService } from "@/lib/catalogo/service";

export const runtime = "nodejs";

type Params = { params: Promise<{ slug: string }> };

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params;
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
    const service = createPublicCatalogService({ repo: createSupabaseCatalogRepository(supabaseAdmin()) });
    const result = await service.prepareOrder({ slug, items: parsed.data.items });
    if (!result) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

    // La verdad por referencia, en la forma que el carrito sabe reconciliar.
    const items: CartProduct[] = result.selection.items.map((p) => ({
      reference: p.reference,
      name: p.name,
      price: p.price,
      imageUrl: p.thumbUrl ?? p.imageUrl,
      available: p.available,
      maxQuantity: p.maxQuantity,
    }));
    return Response.json(
      {
        status: result.status,
        whatsappUrl: result.status === "ready" ? result.whatsappUrl : null,
        adjustments: result.order.adjustments,
        selection: { items, unknown: result.selection.unknown },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[catalogo/pedido] error preparando el pedido:", error instanceof Error ? error.message : error);
    return Response.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
