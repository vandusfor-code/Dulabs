/**
 * POST /catalogo/{slug}/mayor/{token}/pedido — solicitud de pedido MAYORISTA.
 * El canal lo autoriza el token de la ruta (verificado por el servicio contra
 * la publicación); sin el token exacto responde 404. Mismo adaptador que el detal.
 */
import type { NextRequest } from "next/server";
import { responderPedido } from "@/lib/catalogo/pedido-http";

export const runtime = "nodejs";

type Params = { params: Promise<{ slug: string; token: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { slug, token } = await params;
  return responderPedido(request, { slug, context: "wholesale", token });
}
