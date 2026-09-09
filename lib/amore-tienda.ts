import type { SupabaseClient } from "@supabase/supabase-js";
import { PREFIJO_MENSAJE_TIENDA } from "@/lib/amore-entrada-gemini";

/**
 * AMORE (autorizado, módulo Inventario) — único punto real que arma el link
 * "Comprar" de la tienda pública. El texto generado debe coincidir EXACTO
 * (salvo mayúsculas/acentos) con el prefijo que reconoce
 * extraerProductoDeLinkTienda (lib/amore-entrada-gemini.ts) -- de ahí que
 * ambos lados importen la MISMA constante `PREFIJO_MENSAJE_TIENDA` en vez de
 * tener cada uno su propia copia del texto, que podría desincronizarse.
 */
export function construirLinkComprarWhatsApp(telefonoNegocio: string, nombreProducto: string): string {
  const mensaje = `${PREFIJO_MENSAJE_TIENDA} ${nombreProducto}`;
  return `https://wa.me/${telefonoNegocio}?text=${encodeURIComponent(mensaje)}`;
}

/**
 * Número real de WhatsApp de AMORE para la tienda pública -- hallazgo real
 * en verificación post-deploy (autorizado): `dulabs_clientes_config.
 * telefono_negocio` es un placeholder nunca poblado ("0000000000") para
 * tenants WhatsApp-QR como AMORE, esa columna solo la llena el flujo de
 * conexión de Meta Cloud API (app/api/auth/meta-callback/route.ts), que
 * AMORE nunca usa. El número real conectado vive en
 * dulabs_whatsapp_qr_sesiones.numero_conectado (mismo dato que ya usa
 * app/admin/amore/whatsapp/page.tsx), con un sufijo ":N" de dispositivo de
 * Baileys que hay que recortar antes de armar un link wa.me. Devuelve null
 * si el número no está conectado -- la tienda ya maneja ese caso mostrando
 * el botón Comprar deshabilitado, nunca inventa un número.
 */
export async function obtenerNumeroWhatsappAmore(supabase: SupabaseClient, idTenant: string): Promise<string | null> {
  const { data } = await supabase.from("dulabs_whatsapp_qr_sesiones").select("estado, numero_conectado").eq("id_tenant", idTenant).maybeSingle();
  if (!data || data.estado !== "conectado" || !data.numero_conectado) return null;
  const numero = String(data.numero_conectado).split(":")[0]!.replace(/\D/g, "");
  return numero.length > 0 ? numero : null;
}
