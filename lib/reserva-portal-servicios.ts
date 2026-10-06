/**
 * Portal público de reservas — la lista de servicios que la clienta pide para UNA sola cita (ej. uñas de manos + uñas de pies). Un solo lugar que normaliza lo
 * que llega por la URL (GET: `servicioIds=a,b` o `servicioId=a`) y por el cuerpo (POST: `servicioIds: [...]` o `servicioId`), para que las tres rutas del portal
 * (especialistas, disponibilidad y reserva) apliquen EXACTAMENTE las mismas reglas: sin vacíos ni repetidos, en el orden pedido, de 1 a MAX_SERVICIOS_POR_CITA.
 *
 * Esto solo limpia la entrada. Que el servicio exista, esté activo y lo haga UNA misma profesional lo sigue decidiendo el motor real
 * (lib/agenda-v2/multi-servicio.ts + crearCitaConNylas), nunca esta función.
 */
import { MAX_SERVICIOS_POR_CITA } from "@/lib/agenda-v2/servicios";

/** Un id de servicio real es corto (uuid o slug); cualquier cosa más larga es basura o un intento de abuso. */
const LONGITUD_MAXIMA_ID = 64;

export type ServicioIdsPedidos =
  | { ok: true; ids: string[] }
  | { ok: false; motivo: "faltan" | "invalidos" | "demasiados"; error: string };

export function normalizarServicioIds(crudos: readonly unknown[]): ServicioIdsPedidos {
  const ids: string[] = [];
  for (const crudo of crudos) {
    if (crudo === undefined || crudo === null) continue;
    if (typeof crudo !== "string") return { ok: false, motivo: "invalidos", error: "Servicio inválido" };
    const id = crudo.trim();
    if (!id) continue;
    if (id.length > LONGITUD_MAXIMA_ID) return { ok: false, motivo: "invalidos", error: "Servicio inválido" };
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return { ok: false, motivo: "faltan", error: "Falta servicioId" };
  if (ids.length > MAX_SERVICIOS_POR_CITA) return { ok: false, motivo: "demasiados", error: `Máximo ${MAX_SERVICIOS_POR_CITA} servicios por cita` };
  return { ok: true, ids };
}

/** GET: `servicioIds=a,b,c` (separados por comas) o, si no viene, `servicioId=a` (también se puede repetir). */
export function servicioIdsDeBusqueda(params: URLSearchParams): ServicioIdsPedidos {
  const lista = params.get("servicioIds");
  return normalizarServicioIds(lista ? lista.split(",") : params.getAll("servicioId"));
}

/** POST: `servicioIds: string[]` o, si no viene (o viene vacío), el `servicioId` de siempre. */
export function servicioIdsDeCuerpo(cuerpo: { servicioId?: unknown; servicioIds?: unknown }): ServicioIdsPedidos {
  if (cuerpo.servicioIds !== undefined && cuerpo.servicioIds !== null) {
    if (!Array.isArray(cuerpo.servicioIds)) return { ok: false, motivo: "invalidos", error: "Servicio inválido" };
    if (cuerpo.servicioIds.length > 0) return normalizarServicioIds(cuerpo.servicioIds);
  }
  return normalizarServicioIds([cuerpo.servicioId]);
}
