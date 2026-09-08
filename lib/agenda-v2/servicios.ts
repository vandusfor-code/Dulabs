/**
 * AGENDA V2 (autorizado) — FASE 2: selección de servicio. Lógica propia,
 * DELIBERADAMENTE independiente de lib/bot-escenarios/agendamiento-guiado.ts
 * (esa pertenece al modo guiado existente, acoplado al Flow Engine -- no se
 * modifica ni se importa de ahí, para mantener a Agenda V2 genuinamente
 * aislada). Sí reutiliza `listarCatalogoServiciosReal` y `formatearPrecioCop`
 * -- funciones puras de datos/formato, sin ninguna dependencia de Flow
 * Engine ni del modo guiado, que YA garantizan servicios reales/activos
 * (dulabs_servicios, activo=true) y nunca inventan precios.
 */
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";

export interface OpcionServicioAgendaV2 {
  numero: number;
  servicioId: string;
  nombre: string;
  precio: number;
  duracionMin: number;
}

/** Enumera el catálogo real tal cual llega (ya filtrado por activo=true, ya ordenado) -- nunca inventa, nunca reordena por su cuenta. */
export function construirOpcionesServicio(catalogo: ServicioCatalogoReal[]): OpcionServicioAgendaV2[] {
  return catalogo.map((s, i) => ({
    numero: i + 1,
    servicioId: s.id,
    nombre: s.nombre,
    precio: s.precio,
    duracionMin: s.duracionMin,
  }));
}

function listaOpciones(opciones: OpcionServicioAgendaV2[]): string {
  return opciones.map((o) => `${o.numero}. ${o.nombre} — ${formatearPrecioCop(o.precio)}`).join("\n");
}

export function renderizarMenuServicio(opciones: OpcionServicioAgendaV2[]): string {
  return `Perfecto 💗 ¿Qué servicio deseas realizarte?\n\n${listaOpciones(opciones)}`;
}

export function textoSeleccionInvalidaServicio(opciones: OpcionServicioAgendaV2[]): string {
  return `No reconocí esa opción 💗 Por favor responde con el número de una de estas:\n\n${listaOpciones(opciones)}`;
}

/**
 * Resuelve la respuesta del cliente CONTRA las opciones realmente
 * mostradas (guardadas en la sesión) -- nunca parseInt(text.replace(...)),
 * nunca fuzzy matching, nunca vuelve a consultar el catálogo asumiendo que
 * la posición sigue siendo la misma. Para esta fase, SOLO número exacto es
 * válido (ej. "quiero el dipping" es intencionalmente inválido -- sección
 * "ENTRADAS INVÁLIDAS" del pedido).
 */
export function resolverSeleccionServicio(mensaje: string, opciones: OpcionServicioAgendaV2[]): OpcionServicioAgendaV2 | undefined {
  const texto = mensaje.trim();
  if (!/^\d+$/.test(texto)) return undefined;
  const numero = Number(texto);
  return opciones.find((o) => o.numero === numero);
}

/** Fase 3 (autorizado, multi-servicio) — máximo real de servicios en una sola cita. */
export const MAX_SERVICIOS_POR_CITA = 3;

/**
 * Fase 3 (autorizado, multi-servicio) — acepta "1", "1 y 2", "1,2", "1 + 2",
 * "1 y 2 y 3" (nunca nombres de servicio en esta fase -- eso queda para una
 * fase posterior de lenguaje natural). Deliberadamente NO reemplaza
 * resolverSeleccionServicio (que sigue intacta, sin modificar) -- esta es
 * una función NUEVA y más general que el controlador usa en su lugar para
 * S1_SERVICIO; con un solo número, el resultado es idéntico en contenido al
 * de resolverSeleccionServicio (un array de un solo elemento), así que la
 * selección de un solo servicio queda exactamente igual en la práctica.
 *
 * Nunca acepta más de MAX_SERVICIOS_POR_CITA, nunca un número repetido,
 * nunca un número que no exista en las opciones YA mostradas -- mismo
 * criterio EXACTO de "nunca fuzzy, nunca inventar" que el resto de Agenda V2.
 */
export function resolverSeleccionMultiServicio(mensaje: string, opciones: OpcionServicioAgendaV2[]): OpcionServicioAgendaV2[] | undefined {
  const texto = mensaje.trim().toLowerCase();
  if (!texto) return undefined;

  // Separadores reales aceptados: coma, "+", o la palabra "y" como palabra
  // completa (nunca como parte de otra palabra) -- "1 y 2" / "1,2" / "1 + 2" / "1 y 2 y 3".
  const tokens = texto
    .split(/\s*(?:,|\+|\by\b)\s*/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tokens.length === 0 || tokens.length > MAX_SERVICIOS_POR_CITA) return undefined;
  if (!tokens.every((t) => /^\d+$/.test(t))) return undefined;

  const numeros = tokens.map(Number);
  if (new Set(numeros).size !== numeros.length) return undefined; // "1 y 1" -- duplicado, nunca válido

  const seleccionadas: OpcionServicioAgendaV2[] = [];
  for (const numero of numeros) {
    const opcion = opciones.find((o) => o.numero === numero);
    if (!opcion) return undefined; // número que no existe en las opciones mostradas -- nunca inventado
    seleccionadas.push(opcion);
  }
  return seleccionadas;
}
