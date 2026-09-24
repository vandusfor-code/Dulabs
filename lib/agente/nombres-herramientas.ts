/**
 * Nombres PÚBLICOS de las herramientas que un agente puede tener habilitadas.
 * Es el universo cerrado contra el que se valida la allowlist de cada agente
 * (dulabs_agente_runtime_config.herramientas). El registro que las implementa
 * (lib/agente/herramientas.ts) debe cubrir exactamente estos nombres.
 */
export const AGENT_TOOL_NAMES = [
  // Catálogo (solo lectura; el backend resuelve producto, precio del canal y disponibilidad)
  "search_products",
  "resolve_product_by_reference",
  "resolve_product_by_attributes",
  "get_product_details",
  // Selección de la conversación (solo referencias y cantidades; nunca precios)
  "get_cart",
  "update_cart",
  "resolve_order",
  // Pedidos (motor de la Fase 7)
  "create_order_request",
  "validate_order",
  "confirm_order",
  // Cliente, fotos y asesora
  "get_customer_context",
  "request_product_images",
  "handoff_to_human",
  // Enlace oficial del catálogo del canal (lo arma el backend con la publicación del negocio)
  "get_catalog_link",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export function isAgentToolName(value: unknown): value is AgentToolName {
  return typeof value === "string" && (AGENT_TOOL_NAMES as readonly string[]).includes(value);
}
