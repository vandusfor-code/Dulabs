/**
 * FASE 3B.9F — TEXTOS QUE EL SISTEMA LE ENVÍA AL CLIENTE CUANDO SU PEDIDO YA ACEPTADO AVANZA DE ETAPA ("en preparación", "enviado", "entregado").
 *
 * Igual que los de decisión (textos-cliente.ts): cada texto es CONFIGURACIÓN DEL NEGOCIO (checkout_opciones.cierre.textos del número); el código no trae ninguno. Sin texto
 * configurado el sistema NO inventa uno: no envía. Se envía TAL CUAL: la única sustitución permitida es el marcador cerrado {pedido} (el número público del pedido), nunca datos
 * personales, nunca un motivo escrito por el equipo, nunca algo que escriba el modelo.
 *
 * Aquí viven solo funciones puras. El envío, la idempotencia por (pedido, etapa) y la ventana de 24 h están en lib/catalogo/pedidos/notificaciones.ts, y la decisión de qué texto sale
 * en lib/catalogo/pedidos/avisos-etapa.ts.
 */
import { MARCADOR, PEDIDO_PUBLICO, plantillaValida, type ResultadoTexto } from "@/lib/agente/textos-cliente";

/**
 * Etapas del pedido que el NEGOCIO puede avisarle al cliente con su propio texto. Coinciden con el tipo del aviso y con la etapa del pedido en el panel
 * (lib/catalogo/pedidos/notificaciones.ts). Pago recibido, completado, cancelado y rechazado no son etapas con texto del negocio por este camino.
 */
export const ETAPAS_CON_TEXTO = ["en_preparacion", "enviado", "entregado"] as const;
export type EtapaConTexto = (typeof ETAPAS_CON_TEXTO)[number];

export const esEtapaConTexto = (valor: unknown): valor is EtapaConTexto => typeof valor === "string" && (ETAPAS_CON_TEXTO as readonly string[]).includes(valor);

/** El único marcador que admite el texto de una etapa: el número público del pedido. */
export const MARCADORES_ETAPA: readonly string[] = Object.freeze(["pedido"]);

/** Completa el texto de una etapa con el número público del pedido. Nada más se sustituye: el resto sale tal cual lo escribió el negocio. */
export function renderizarTextoEtapa(plantilla: string, datos: { pedido: string }): ResultadoTexto {
  if (!plantillaValida(plantilla, MARCADORES_ETAPA)) return { ok: false, motivo: "plantilla_invalida" };
  if (!PEDIDO_PUBLICO.test(datos.pedido)) return { ok: false, motivo: "pedido_invalido" };
  const texto = plantilla.replace(MARCADOR, () => datos.pedido);
  return texto.trim().length > 0 ? { ok: true, texto } : { ok: false, motivo: "plantilla_invalida" };
}
