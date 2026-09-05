// AMORE (Fase 5, diseño visual completo, autorizado) — únicas rutas del
// panel móvil de AMORE, centralizadas para que el bottom nav y el drawer
// nunca se desincronicen entre sí. Citas/Clientes/Servicios REUTILIZAN las
// rutas ya existentes del panel genérico (con una rama por tenant dentro de
// cada página) -- Cumpleaños/Fidelización/Contabilidad/Equipo/WhatsApp/
// Configuración son rutas nuevas, exclusivas de AMORE, que no chocan con
// ninguna ruta ya usada por Daniela.
export const rutaInicio = (token: string) => `/agenda/${token}`;
export const rutaCitas = (token: string) => `/agenda/${token}/completa`;
export const rutaClientes = (token: string) => `/agenda/${token}/clientes`;
export const rutaServicios = (token: string) => `/agenda/${token}/servicios`;
export const rutaCumpleanos = (token: string) => `/agenda/${token}/cumpleanos`;
export const rutaFidelizacion = (token: string) => `/agenda/${token}/fidelizacion`;
export const rutaContabilidad = (token: string) => `/agenda/${token}/contabilidad`;
export const rutaEquipo = (token: string) => `/agenda/${token}/equipo`;
export const rutaWhatsapp = (token: string) => `/agenda/${token}/whatsapp`;
export const rutaConfiguracion = (token: string) => `/agenda/${token}/configuracion`;
export const rutaPerfil = (token: string) => `/agenda/${token}/perfil`;

// true si `pathname` es exactamente esta ruta o una subruta suya (ej. el
// detalle de un cliente/servicio/miembro del equipo cuelga de la misma
// pestaña del nav/drawer que su listado).
export function esRutaActiva(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}
