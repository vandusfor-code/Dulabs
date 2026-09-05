// Panel web AMORE (autorizado) — rutas fijas bajo /admin/amore (SIN token
// en la URL, a diferencia de /agenda/[token] del panel móvil -- el token
// real se resuelve server-side desde la sesión, ver AdminWebContext.tsx).
export const RUTA_INICIO = "/admin/amore";
export const RUTA_CITAS = "/admin/amore/citas";
export const RUTA_CLIENTES = "/admin/amore/clientes";
export const RUTA_SERVICIOS = "/admin/amore/servicios";
export const RUTA_EQUIPO = "/admin/amore/equipo";
export const RUTA_EQUIPO_USUARIOS = "/admin/amore/equipo/usuarios";
export const RUTA_CONTABILIDAD = "/admin/amore/contabilidad";
export const RUTA_CUMPLEANOS = "/admin/amore/cumpleanos";
export const RUTA_FIDELIZACION = "/admin/amore/fidelizacion";
export const RUTA_COMUNICACIONES = "/admin/amore/recordatorios";
export const RUTA_WHATSAPP = "/admin/amore/whatsapp";
export const RUTA_CONFIGURACION = "/admin/amore/configuracion";
export const RUTA_PERFIL = "/admin/amore/perfil";

export function esRutaActiva(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}
