/**
 * FASE 3B.9F — AVISO AL CLIENTE CUANDO SU PEDIDO YA ACEPTADO AVANZA DE ETAPA ("en preparación", "enviado", "entregado"), con el texto del propio negocio.
 *
 *   una persona del equipo marca la etapa en Pedidos (el estado YA cambió, por las operaciones de siempre)
 *     -> módulos del negocio: "avisos_etapa_pedidos" (solo estas tres etapas, con SU texto) y/o "notificaciones_pedidos" (plantillas de la plataforma)
 *     -> ESTA función decide con qué texto sale el aviso:
 *          avisos_etapa_pedidos + texto del negocio para esa etapa (checkout_opciones.cierre.textos) -> ese texto, TAL CUAL (solo se completa {pedido})
 *          notificaciones_pedidos (sin texto del negocio, o sin el módulo anterior)                  -> la plantilla de siempre de la plataforma
 *          ninguno de los dos                                                                         -> nada: ni se reserva ni se envía
 *     -> el resto es lo de siempre (lib/catalogo/pedidos/notificaciones.ts): candado idempotente por (pedido, etapa), ventana de 24 h de WhatsApp, número
 *        y token del propio negocio, resultado registrado y reintento desde el panel.
 *
 * Por qué existe: "notificaciones_pedidos" manda plantillas de la PLATAFORMA (el tono y los emojis de otro negocio) y por eso está apagado para Aquí Sí Lo Compras. Sin este
 * camino, ese negocio marcaba "en preparación" o "enviado" y el cliente no recibía nada.
 *
 * Qué NO hace, por diseño:
 *   - no cambia el estado del pedido: solo informa lo ya decidido;
 *   - no inventa texto: sin texto del negocio y sin la plataforma, no se envía nada; tampoco promete fechas, guías ni transportadoras;
 *   - no usa texto de otro negocio: la configuración se lee por (negocio de la sesión, número del pedido) y el pedido debe ser de ese negocio;
 *   - no usa el modelo ni algo que el modelo pueda influir, y no incluye datos del cliente (solo el número público del pedido);
 *   - solo trata las tres etapas: pago recibido y completado no pasan por aquí, y cancelado / rechazado tienen su propio mensaje de decisión (mensajes-decision.ts);
 *   - un negocio sin "avisos_etapa_pedidos" (p. ej. con "notificaciones_pedidos", como siempre) NO lee ninguna configuración: su camino es exactamente el de antes.
 */
import type { ConfigAceptacion } from "@/lib/agente/aceptacion-humana";
import { esEtapaConTexto, renderizarTextoEtapa } from "@/lib/agente/textos-etapa";
import type { NotificadorDeps } from "@/lib/catalogo/pedidos/notificaciones";

export interface AvisosEtapaDeps {
  /** Qué módulos están encendidos para el negocio: la base lo decide (un error al consultar = apagado). */
  modulos: (tenantId: string) => Promise<{ plataforma: boolean; negocio: boolean }>;
  /** Configuración de aceptación del negocio para ese número; null = no usa la aceptación humana, no es válida o el agente está apagado. Un error se propaga. */
  config: (tenantId: string, phoneNumberId: string) => Promise<ConfigAceptacion | null>;
  /** Registro SIN datos personales (ni teléfono, ni nombre, ni texto del cliente). */
  log?: (entry: Record<string, unknown>) => void;
}

const logPorDefecto = (entry: Record<string, unknown>) => console.info(JSON.stringify({ log: "aviso_etapa", ...entry }));

/**
 * El resolutor que usa el notificador (NotificadorDeps.textoDeEtapa). Para un negocio con "avisos_etapa_pedidos" y una etapa con texto, lee SU configuración y devuelve su texto; si
 * esa etapa no tiene texto utilizable, cae a la plantilla de la plataforma solo cuando el negocio tiene "notificaciones_pedidos"; si no, "ninguno".
 */
export function crearTextoDeEtapa(deps: AvisosEtapaDeps): NonNullable<NotificadorDeps["textoDeEtapa"]> {
  const log = deps.log ?? logPorDefecto;
  return async ({ tenantId, tipo, pedido }) => {
    const modulos = await deps.modulos(tenantId);
    if (modulos.negocio && esEtapaConTexto(tipo)) {
      const contacto = pedido.contact;
      // El pedido debe ser de este negocio y traer el número por el que se le escribe al cliente: de ese número sale la configuración.
      if (contacto && pedido.businessId === tenantId) {
        const config = await deps.config(tenantId, contacto.phoneNumberId);
        const plantilla = config?.textosEtapa?.[tipo] ?? null;
        if (plantilla) {
          const texto = renderizarTextoEtapa(plantilla, { pedido: pedido.orderId });
          if (texto.ok) return { origen: "negocio", texto: texto.texto };
          log({ business_id: tenantId, order_id: pedido.orderId, etapa: tipo, resultado: "sin_aviso", motivo: texto.motivo });
        } else {
          log({ business_id: tenantId, order_id: pedido.orderId, etapa: tipo, resultado: "sin_aviso", motivo: config ? "sin_texto" : "sin_configuracion" });
        }
      } else {
        log({ business_id: tenantId, order_id: pedido.orderId, etapa: tipo, resultado: "sin_aviso", motivo: contacto ? "pedido_de_otro_negocio" : "sin_contacto" });
      }
    }
    return modulos.plataforma ? { origen: "plataforma" } : { origen: "ninguno" };
  };
}
