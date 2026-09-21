/**
 * Política del polling de la bandeja de chats (AMORE web). PURA: decide cada cuánto consultar según si la pestaña está visible y si
 * hay alguien usándola.
 *
 * Por qué existe: la bandeja consultaba la lista de conversaciones cada 4 s y el hilo cada 3 s SIEMPRE, incluso con la pestaña
 * oculta o abandonada toda la noche (~21.600 consultas/día por pestaña abierta, cada una trayendo la lista completa). Eso consume el
 * egress de Supabase (cuota compartida con producción: al excederse, el proyecto se restringe y TODOS los bots dejan de funcionar).
 *
 *  - Pestaña oculta -> no se consulta (al volver a verla se refresca de inmediato).
 *  - Visible pero sin actividad del usuario durante INACTIVIDAD_MS -> se consulta mucho más despacio (INTERVALO_INACTIVO_MS).
 *  - Visible y en uso -> el intervalo base de siempre (el "tiempo real" que ya tenían).
 */
export const INACTIVIDAD_MS = 120_000;
export const INTERVALO_INACTIVO_MS = 30_000;

export interface ContextoPolling {
  /** document.visibilityState === "visible". */
  visible: boolean;
  /** Reloj actual (ms). */
  ahora: number;
  /** Última interacción del usuario con la página (ms). */
  ultimaInteraccion: number;
}

/** Milisegundos hasta la próxima consulta, o null si NO se debe consultar (pestaña oculta). */
export function intervaloEfectivo(baseMs: number, ctx: ContextoPolling): number | null {
  if (!ctx.visible) return null;
  const inactivo = ctx.ahora - ctx.ultimaInteraccion > INACTIVIDAD_MS;
  return inactivo ? Math.max(baseMs, INTERVALO_INACTIVO_MS) : baseMs;
}
