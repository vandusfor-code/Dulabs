export function nombreDelAgente(negocio: { nombre_agente: string | null; nombre_negocio: string }): string {
  return negocio.nombre_agente || `Asistente de ${negocio.nombre_negocio}`;
}

export const CALIDAD_INFO: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  GREEN: { label: "Alta", tone: "success" },
  YELLOW: { label: "Media", tone: "warning" },
  RED: { label: "Baja", tone: "danger" },
  UNKNOWN: { label: "Sin datos aún", tone: "neutral" },
};

export function formatearTelefono(digitos: string): string {
  if (digitos.length === 11 && digitos[0] === "1") {
    return `+1 ${digitos.slice(1, 4)}-${digitos.slice(4, 7)}-${digitos.slice(7)}`;
  }
  if (digitos.length === 12 && digitos.startsWith("57")) {
    return `+57 ${digitos.slice(2, 5)} ${digitos.slice(5, 8)} ${digitos.slice(8)}`;
  }
  return `+${digitos}`;
}
