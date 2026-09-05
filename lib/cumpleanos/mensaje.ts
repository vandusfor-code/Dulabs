// Cumpleaños automáticos (Fase 6A, genérico, autorizado) — renderizado PURO
// de la plantilla configurada por el tenant. Solo dos variables soportadas;
// cualquier otra llave "{{...}}" que aparezca en un mensaje mal escrito
// queda tal cual en el texto -- nunca se inventa un valor para ella.
export function renderizarMensajeCumpleanos(plantilla: string, variables: { nombre: string; negocio?: string | null }): string {
  return plantilla.replaceAll("{{nombre}}", variables.nombre).replaceAll("{{negocio}}", variables.negocio ?? "");
}
