/**
 * GET /api/dashboard/pedidos/por-aceptar — Fase 3B.5/3B.7: los pedidos PENDIENTES DE ACEPTACIÓN del negocio de la
 * sesión (el cliente ya dejó sus datos y recibió el aviso; una persona debe aceptarlos o rechazarlos).
 * Exige la sesión, un rol que atiende (admin / agente) y los módulos "pedidos" y "pedidos_por_aceptar".
 * Paginada: ?limite=1..50 (25), ?cursor=<opaco>. Nunca incluye el documento completo.
 */
import type { NextRequest } from "next/server";
import { listarPorAceptar } from "@/lib/catalogo/pedidos/por-aceptar";
import { conPorAceptar } from "@/lib/catalogo/pedidos/por-aceptar-produccion";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return conPorAceptar(request, "pedidos_lectura", (ctx) => listarPorAceptar(ctx, request.nextUrl.searchParams));
}
