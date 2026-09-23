/**
 * POST /catalogo/{slug}/pedido — solicitud de pedido del canal DETAL.
 * Toda la lógica vive en lib/catalogo/pedido-http.ts (mismo adaptador que el
 * mayorista); el canal lo fija ESTA ruta, nunca el navegador.
 */
import type { NextRequest } from "next/server";
import { responderPedido } from "@/lib/catalogo/pedido-http";

export const runtime = "nodejs";

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  return responderPedido(request, { slug, context: "retail" });
}
