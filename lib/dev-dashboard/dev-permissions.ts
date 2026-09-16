// DuLabs Developer V1 -- Fase 9 (autorizado, D4). Predicados de permiso por
// rol para la UI. PUROS y testeables. El backend sigue siendo la autoridad
// real -- esto SOLO decide qué mostrar/habilitar, nunca sustituye el gate del
// servidor.

export type RolDev = "OWNER" | "ADMIN" | "MEMBER";

/** OWNER y ADMIN gestionan recursos técnicos: API keys, números, webhooks. */
export function puedeGestionarRecursos(rol: RolDev | null): boolean {
  return rol === "OWNER" || rol === "ADMIN";
}

/** Solo OWNER gestiona miembros (alta, cambio de rol, eliminación) y transfiere ownership. */
export function puedeGestionarMiembros(rol: RolDev | null): boolean {
  return rol === "OWNER";
}

/** MEMBER es estrictamente de lectura. */
export function esSoloLectura(rol: RolDev | null): boolean {
  return rol === "MEMBER";
}

export function etiquetaRol(rol: RolDev): string {
  return rol; // OWNER/ADMIN/MEMBER ya son etiquetas claras
}
