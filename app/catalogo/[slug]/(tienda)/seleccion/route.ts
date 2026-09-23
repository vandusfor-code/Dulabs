/**
 * GET /catalogo/{slug}/seleccion?ref=DL-000184&ref=DL-000185
 *
 * Resolución PÚBLICA de la selección del carrito (detal): el navegador solo
 * envía referencias; el backend responde la verdad de cada una (nombre,
 * precio vigente, miniatura pública, disponibilidad y máximo pedible) y
 * cuáles ya no existen o no están activas. Solo lectura, sin datos internos
 * (sin ids, sin precio mayorista). Máximo 60 referencias.
 */
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { CartProduct } from "@/lib/catalogo/carrito";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import { SELECTION_MAX, createPublicCatalogService } from "@/lib/catalogo/service";

export const runtime = "nodejs";

type Params = { params: Promise<{ slug: string }> };

const HEADERS = { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  const references = request.nextUrl.searchParams.getAll("ref").slice(0, SELECTION_MAX * 2);
  try {
    const service = createPublicCatalogService({ repo: createSupabaseCatalogRepository(supabaseAdmin()) });
    const resolved = await service.resolveSelection({ slug, references });
    if (!resolved) return Response.json({ error: "not_found" }, { status: 404, headers: HEADERS });
    const items: CartProduct[] = resolved.items.map((p) => ({
      reference: p.reference,
      name: p.name,
      price: p.price,
      imageUrl: p.thumbUrl ?? p.imageUrl,
      available: p.available,
      maxQuantity: p.maxQuantity,
    }));
    return Response.json({ items, unknown: resolved.unknown }, { headers: HEADERS });
  } catch (error) {
    console.error("[catalogo/seleccion] error resolviendo la selección:", error instanceof Error ? error.message : error);
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
