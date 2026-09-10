// Comisión por servicio (autorizado, genérico) -- validación compartida
// entre POST (crear) y PATCH (editar), para nunca tener dos reglas
// distintas de lo mismo. "tipo"/"valor" deben venir juntos o ninguno --
// nunca un tipo sin valor ni viceversa. La BD es la última barrera real
// (ver 20260924000000_amore_comision_servicio.sql), esto es solo el error
// amigable temprano.
export type ComisionValidada = { tipo: "porcentaje" | "valor_fijo" | null; valor: number | null };

export function validarComision(comisionTipo: unknown, comisionValor: unknown): { ok: true; comision: ComisionValidada } | { ok: false; error: string } {
  if (comisionTipo === undefined && comisionValor === undefined) return { ok: true, comision: { tipo: null, valor: null } };
  if (comisionTipo === null && (comisionValor === null || comisionValor === undefined)) return { ok: true, comision: { tipo: null, valor: null } };
  if (comisionTipo !== "porcentaje" && comisionTipo !== "valor_fijo") {
    return { ok: false, error: "El tipo de comisión debe ser 'porcentaje' o 'valor_fijo'" };
  }
  const valor = Number(comisionValor);
  if (!Number.isFinite(valor) || valor < 0) return { ok: false, error: "El valor de la comisión no es válido" };
  if (comisionTipo === "porcentaje" && valor > 100) return { ok: false, error: "El porcentaje de comisión debe estar entre 0 y 100" };
  return { ok: true, comision: { tipo: comisionTipo, valor } };
}
