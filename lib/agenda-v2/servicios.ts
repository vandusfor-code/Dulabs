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
