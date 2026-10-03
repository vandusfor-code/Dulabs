/**
 * Cableado de PRODUCCIÓN del panel "Por aceptar" (Fase 3B.5): el negocio es SIEMPRE el de la sesión ya
 * autorizada; la configuración de aceptación se lee por (negocio, número) y, si no es válida, no se decide nada.
 *
 * Fase 3B.7: `conPorAceptar` es el ÚNICO camino de las tres rutas (lista, detalle y decisión): sesión + rol que
 * atiende (admin / agente) + módulo propio "pedidos_por_aceptar" + módulo "pedidos" (Por aceptar vive dentro de
 * Pedidos). El negocio sale de la sesión; la ruta nunca lo recibe del cliente.
 *
 * Fase 3B.8: el gancho alDecidir conecta cada decisión aplicada con lib/catalogo/pedidos/mensajes-decision.ts, que SOLO le escribe
 * al cliente si el negocio configuró el texto de esa decisión, tiene activo el módulo "notificaciones_pedidos", el número es suyo
 * y la ventana de 24 h está abierta; y lo hace una sola vez por (pedido, decisión). Hoy nada de eso se cumple para ningún negocio
 * (el cierre con aceptación humana sigue apagado), así que en producción no sale ningún mensaje.
 */
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/agent-compiler/api/http";
import { createSupabaseAgentConfigStore } from "@/lib/agente/config";
import { crearLectorConfigAceptacion } from "@/lib/agente/aceptacion-humana";
import { ORDERS_MODULE, POR_ACEPTAR_MODULE } from "@/lib/catalogo/auth";
import { withCatalog } from "@/lib/catalogo/http";
import { productionMensajesDecision } from "@/lib/catalogo/pedidos/mensajes-decision";
import { productionPanelFuentes } from "@/lib/catalogo/pedidos/panel-fuentes";
import { productionOrderEngine } from "@/lib/catalogo/pedidos/produccion";
import type { PorAceptarCtx } from "@/lib/catalogo/pedidos/por-aceptar";
import { moduloHabilitado } from "@/lib/tenant-modulos";

export function productionPorAceptarCtx(input: { supabase: SupabaseClient; tenantId: string; memberId: number; esAdmin: boolean; canManageOrders: boolean }): PorAceptarCtx {
  const lector = crearLectorConfigAceptacion(createSupabaseAgentConfigStore(input.supabase));
  const engine = productionOrderEngine(input.supabase);
  const alDecidir = productionMensajesDecision({ supabase: input.supabase, engine, config: lector });
  return {
    engine,
    tenantId: input.tenantId,
    persona: { miembroId: input.memberId, esAdmin: input.esAdmin },
    extras: { fuentes: productionPanelFuentes(input.supabase), verTelefono: input.canManageOrders },
    config: (phoneNumberId) => lector(input.tenantId, phoneNumberId),
    ...(alDecidir ? { alDecidir } : {}),
  };
}

/** Por aceptar vive dentro de Pedidos: sin el módulo "pedidos" tampoco hay "Por aceptar" (fail-closed ante un error de lectura). */
export async function exigirModuloPedidos(supabase: SupabaseClient, tenantId: string): Promise<Response | null> {
  try {
    if (await moduloHabilitado(supabase, tenantId, ORDERS_MODULE)) return null;
  } catch (err) {
    console.error("[catalogo/por-aceptar] no se pudo verificar el módulo pedidos:", err instanceof Error ? err.message : "?");
    return apiError("INTERNAL_ERROR", "No se pudo verificar el acceso a los pedidos.", 500);
  }
  return apiError("MODULE_DISABLED", "El módulo Pedidos no está habilitado para tu cuenta.", 403);
}

export function conPorAceptar(request: NextRequest, recurso: "pedidos_lectura" | "pedidos_escritura", handler: (ctx: PorAceptarCtx) => Promise<Response>): Promise<Response> {
  return withCatalog(
    request,
    "orders",
    async ({ supabase, actor, memberId, canWrite, canManageOrders }) => {
      const sinPedidos = await exigirModuloPedidos(supabase, actor.tenantId);
      if (sinPedidos) return sinPedidos;
      return handler(productionPorAceptarCtx({ supabase, tenantId: actor.tenantId, memberId, esAdmin: canWrite, canManageOrders }));
    },
    { module: POR_ACEPTAR_MODULE, recurso },
  );
}
