// Panel web AMORE (autorizado) — rutas fijas bajo /amoreweb (SIN token
// en la URL, a diferencia de /agenda/[token] del panel móvil -- el token
// real se resuelve server-side desde la sesión, ver AdminWebContext.tsx).
//
// Namespace migrado de /admin/amore -> /amoreweb (autorizado) -- AMORE
// queda con una entrada de URL completamente separada del namespace
// /admin/* de DuLabs. /admin/amore/:path* redirige (307, compatibilidad
// transicional) a /amoreweb/:path* -- ver next.config.js.
export const RUTA_INICIO = "/amoreweb";
export const RUTA_CITAS = "/amoreweb/citas";
export const RUTA_CLIENTES = "/amoreweb/clientes";
export const RUTA_CHATS = "/amoreweb/chats";
export const RUTA_SERVICIOS = "/amoreweb/servicios";
export const RUTA_INVENTARIO = "/amoreweb/inventario";
export const RUTA_EQUIPO = "/amoreweb/equipo";
export const RUTA_EQUIPO_USUARIOS = "/amoreweb/equipo/usuarios";
export const RUTA_CONTABILIDAD = "/amoreweb/contabilidad";
export const RUTA_CUMPLEANOS = "/amoreweb/cumpleanos";
export const RUTA_FIDELIZACION = "/amoreweb/fidelizacion";
export const RUTA_COMUNICACIONES = "/amoreweb/recordatorios";
export const RUTA_WHATSAPP = "/amoreweb/whatsapp";
export const RUTA_CONFIGURACION = "/amoreweb/configuracion";
export const RUTA_PERFIL = "/amoreweb/perfil";

export function esRutaActiva(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}
