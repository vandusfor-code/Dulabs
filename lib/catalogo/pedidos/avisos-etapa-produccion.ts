/**
 * FASE 3B.9F — cableado de PRODUCCIÓN de los avisos de etapa del pedido ("en preparación", "enviado", "entregado") con el texto del propio negocio.
 *
 * Es el notificador de las ACCIONES del panel de Pedidos (rutas /api/dashboard/pedidos/[pedido] y .../notificaciones). Se separa de notificaciones-produccion.ts a propósito:
 * ese archivo (el envío, la ventana de 24 h, el candado idempotente) no importa nada de la IA ni de la configuración del agente; este SÍ lee la configuración de aceptación del
 * negocio (por negocio de la sesión + número del pedido) para saber qué texto lleva cada etapa. La lógica de decisión (pura) está en avisos-etapa.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearLectorConfigAceptacion } from "@/lib/agente/aceptacion-humana";
import { createSupabaseAgentConfigStore } from "@/lib/agente/config";
import { crearTextoDeEtapa } from "@/lib/catalogo/pedidos/avisos-etapa";
import type { NotificadorDeps } from "@/lib/catalogo/pedidos/notificaciones";
import { MODULOS_AVISOS_DE_ESTADO, MODULOS_PANEL_DE_PEDIDOS, MODULO_AVISOS_DE_ETAPA, algunModuloHabilitado, productionNotificador } from "@/lib/catalogo/pedidos/notificaciones-produccion";

/**
 * Qué texto lleva el aviso de cada etapa, con la base de verdad: los módulos del negocio y SU configuración de aceptación. Un error al consultar los módulos = apagado (nunca se
 * envía por no poder verificar); un error al leer la configuración se propaga (nunca se envía algo que no se pudo decidir).
 */
export function productionTextoDeEtapa(supabase: SupabaseClient): NonNullable<NotificadorDeps["textoDeEtapa"]> {
  return crearTextoDeEtapa({
    modulos: async (tenantId) => ({
      plataforma: await algunModuloHabilitado(supabase, tenantId, MODULOS_AVISOS_DE_ESTADO),
      negocio: await algunModuloHabilitado(supabase, tenantId, [MODULO_AVISOS_DE_ETAPA]),
    }),
    config: crearLectorConfigAceptacion(createSupabaseAgentConfigStore(supabase)),
  });
}

/**
 * El notificador de las acciones del panel de Pedidos: lo enciende "notificaciones_pedidos" (plantillas de la plataforma, como siempre) o "avisos_etapa_pedidos" (solo preparación,
 * envío y entrega, con el texto del negocio). Un negocio sin "avisos_etapa_pedidos" no lee ninguna configuración: su camino es exactamente el de antes.
 */
export function productionNotificadorDelPanel(supabase: SupabaseClient): NotificadorDeps {
  return { ...productionNotificador(supabase, { modulos: MODULOS_PANEL_DE_PEDIDOS }), textoDeEtapa: productionTextoDeEtapa(supabase) };
}
