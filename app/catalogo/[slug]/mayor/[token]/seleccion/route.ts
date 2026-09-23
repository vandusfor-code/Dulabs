/**
 * GET /catalogo/{slug}/mayor/{token}/seleccion?ref=… — verdad del carrito
 * MAYORISTA (solo precio mayor) + cotización firmada. Sin caché compartida.
 */
import type { NextRequest } from "next/server";
import { responderSeleccion } from "@/lib/catalogo/pedido-http";

export const runtime = "nodejs";

type Params = { params: Promise<{ slug: string; token: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { slug, token } = await params;
  return responderSeleccion(request, { slug, context: "wholesale", token });
}
