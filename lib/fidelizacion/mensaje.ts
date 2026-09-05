// Fidelización (Fase 7, genérico, autorizado) — 6) renderizado PURO de la
// plantilla configurada por regla. Tres variables soportadas; cualquier
// otra llave "{{...}}" mal escrita queda tal cual -- nunca se inventa un
// valor para ella.
export function renderizarMensajeFidelizacion(plantilla: string, variables: { nombre: string; servicio: string; dias: number }): string {
  return plantilla
    .replaceAll("{{nombre}}", variables.nombre)
    .replaceAll("{{servicio}}", variables.servicio)
    .replaceAll("{{dias}}", String(variables.dias));
}
