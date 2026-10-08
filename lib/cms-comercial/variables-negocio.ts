/**
 * CMS comercial — los VALORES de las variables de los textos a partir de la configuración del negocio de ARIA (`negocio`). PURO.
 *
 * Lo usan el Dashboard (vista previa y validación) y el runtime de ARIA (al entregar un texto): un mismo cálculo, así el número del mínimo mayorista existe
 * una sola vez. Lo que no esté configurado simplemente no existe (y los textos que usen esa variable no se publican ni se entregan).
 */
import type { VariablesNegocio } from "@/lib/cms-comercial/puertos";
import { formatearPesos, type ValoresVariables } from "@/lib/cms-comercial/variables";

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function variablesDeNegocio(negocio: unknown): VariablesNegocio {
  const n = esObjeto(negocio) ? negocio : {};
  const pedido = esObjeto(n.pedido) ? n.pedido : {};
  const variables: ValoresVariables = {};
  const minimo = typeof pedido.minimo_mayorista === "number" && Number.isInteger(pedido.minimo_mayorista) && pedido.minimo_mayorista > 0 ? pedido.minimo_mayorista : null;
  if (minimo !== null) variables.minimo_mayorista = formatearPesos(minimo);
  if (typeof pedido.direccion_tienda === "string" && pedido.direccion_tienda.trim() !== "") variables.direccion_tienda = pedido.direccion_tienda.trim();
  if (typeof n.nombre_negocio === "string" && n.nombre_negocio.trim() !== "") variables.nombre_negocio = n.nombre_negocio.trim();
  return { variables, minimoMayorista: minimo };
}
