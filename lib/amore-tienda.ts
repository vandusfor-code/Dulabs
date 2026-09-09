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
