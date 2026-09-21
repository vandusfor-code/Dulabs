/**
 * Detalle de destinatarios que NO recibieron un mensaje de campaña, tal cual lo reportó Meta (código + detalle), agrupado por campaña.
 * Lo consume la página de Campañas (embudo → "No entregados"). Es puro para poder probarlo sin base de datos.
 */
export type FilaMensajeFallido = {
  campana_id: number | null;
  telefono_cliente: string | null;
  wamid: string | null;
  error_codigo: number | string | null;
  error_detalle: string | null;
};

export type ErrorDestinatario = {
  telefono: string;
  wamid: string | null;
  errorCodigo: number | null;
  errorDetalle: string | null;
};

/** Tope por campaña: acota el tamaño de la respuesta aunque una campaña grande falle casi completa. */
export const TOPE_ERRORES_POR_CAMPANA = 500;

function codigoNumerico(valor: number | string | null): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

export function agruparErroresPorCampana(filas: FilaMensajeFallido[], tope: number = TOPE_ERRORES_POR_CAMPANA): Map<number, ErrorDestinatario[]> {
  const porCampana = new Map<number, ErrorDestinatario[]>();
  for (const f of filas) {
    if (f.campana_id === null || f.campana_id === undefined) continue;
    const lista = porCampana.get(f.campana_id) ?? [];
    if (lista.length >= tope) continue;
    lista.push({
      telefono: f.telefono_cliente ?? "",
      wamid: f.wamid ?? null,
      errorCodigo: codigoNumerico(f.error_codigo),
      errorDetalle: f.error_detalle ?? null,
    });
    porCampana.set(f.campana_id, lista);
  }
  return porCampana;
}
