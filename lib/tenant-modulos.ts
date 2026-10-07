import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Módulos del dashboard habilitables por tenant (tabla dulabs_tenant_modulos,
 * migración 20261105000000). Mecanismo GENÉRICO: ningún negocio se identifica
 * por nombre en el código -- un módulo se enciende insertando una fila para el
 * tenant. Agregar un módulo nuevo = agregar su id a MODULOS.
 */
// "marca_referencia" (Bloque 29): la referencia estampada en las fotos del catálogo; no tiene menú propio.
// "notificaciones_pedidos" (Bloque 31): avisos por WhatsApp de cada cambio de estado de un pedido; no tiene menú.
// "clientes_joyeria" (Bloque 33): Dashboard → Clientes del catálogo (un cliente por contacto, con sus pedidos y nota).
// "pedidos_por_aceptar" (Fase 3B.7): Dashboard → Pedidos → Por aceptar (pedidos que una PERSONA del negocio debe aceptar o rechazar).
//   Se habilita aparte de "pedidos" (negocios con aceptación humana): sin esta fila el menú, la página y la API no existen para el negocio.
// "avisos_decision_pedidos" (Fase 3B.9E): SOLO el mensaje al cliente tras aceptar / rechazar / cancelar un pedido pendiente de aceptación, con el texto que
//   configuró el propio negocio (checkout_opciones.cierre.textos). No enciende los avisos genéricos de cada etapa del pedido ("notificaciones_pedidos"),
//   que usan plantillas de la plataforma y no son de ningún negocio en particular. No tiene menú.
// "avisos_etapa_pedidos" (Fase 3B.9F): SOLO el aviso al cliente cuando su pedido ya aceptado pasa a "en preparación", "enviado" o "entregado", con el texto que configuró el
//   propio negocio (checkout_opciones.cierre.textos). Igual que el anterior, no enciende las plantillas de la plataforma ("notificaciones_pedidos") y no tiene menú.
// "cms_comercial" (Bloque 29): Dashboard → Administración de tienda (página principal, ofertas, combos, campañas y contenido comercial con borrador, publicación y versiones).
//   Sin esta fila el menú, la API y la lectura de lo publicado no existen para el negocio: la tienda, los pedidos y ARIA se comportan exactamente como antes.
export const MODULOS = ["catalogo", "publibordados_clientes", "pedidos", "marca_referencia", "notificaciones_pedidos", "clientes_joyeria", "pedidos_por_aceptar", "avisos_decision_pedidos", "avisos_etapa_pedidos", "cms_comercial"] as const;
export type ModuloId = (typeof MODULOS)[number];

export function esModuloId(valor: unknown): valor is ModuloId {
  return typeof valor === "string" && (MODULOS as readonly string[]).includes(valor);
}

const TABLA = "dulabs_tenant_modulos";

/**
 * Módulos habilitados del tenant, para PRESENTACIÓN (menú del dashboard).
 * Best-effort a propósito, igual que estado_conexion en /api/dashboard/me: si
 * la migración aún no se aplicó (tabla inexistente) o la consulta falla, se
 * devuelve [] y el dashboard de TODOS los tenants sigue funcionando. Nunca se
 * usa para autorizar -- para eso está moduloHabilitado().
 */
export async function modulosHabilitados(supabase: SupabaseClient, tenantId: string): Promise<ModuloId[]> {
  const { data, error } = await supabase.from(TABLA).select("modulo").eq("id_tenant", tenantId).eq("habilitado", true);
  if (error) {
    console.warn("[tenant-modulos] no se pudieron leer los módulos (se asume ninguno):", error.message);
    return [];
  }
  return ((data ?? []) as Array<{ modulo: string }>).map((f) => f.modulo).filter(esModuloId);
}

/**
 * Verificación ESTRICTA para AUTORIZAR una operación del módulo. Un error de
 * infraestructura se PROPAGA (throw): "no pude verificar" nunca se confunde
 * con "habilitado" (fail-closed) ni con "no habilitado" (el caller responde
 * 500, no un 403 engañoso).
 */
export async function moduloHabilitado(supabase: SupabaseClient, tenantId: string, modulo: ModuloId): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABLA)
    .select("habilitado")
    .eq("id_tenant", tenantId)
    .eq("modulo", modulo)
    .maybeSingle();
  if (error) throw new Error(`[tenant-modulos] error verificando el módulo ${modulo}: ${error.message}`);
  return Boolean((data as { habilitado?: boolean } | null)?.habilitado);
}
