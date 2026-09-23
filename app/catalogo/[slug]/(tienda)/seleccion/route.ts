/**
 * GET /catalogo/{slug}/seleccion?ref=DL-000184&ref=… — verdad del carrito
 * DETAL (precio vigente, disponibilidad, máximo pedible discreto) + cotización
 * firmada. Lógica en lib/catalogo/pedido-http.ts.
 */
import type { NextRequest } from "next/server";
import { responderSeleccion } from "@/lib/catalogo/pedido-http";

export const runtime = "nodejs";

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params;
  return responderSeleccion(request, { slug, context: "retail" });
}
