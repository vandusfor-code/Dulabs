/**
 * BLOQUE 29 — PILOTO de las herramientas comerciales (CMS) por número de cliente.
 *
 * Las herramientas de un agente se habilitan por LÍNEA del negocio (la fila `dulabs_agente_runtime_config` de su número de WhatsApp), no por cliente. Para poder probar el
 * CMS con ARIA sin abrirlo al público, `negocio.comercial_piloto` (lista de wa_id: solo dígitos con el indicativo del país, p. ej. 57XXXXXXXXXX) limita las herramientas
 * comerciales, su guarda anti-invención y la sección «información comercial» del prompt a esos contactos:
 *
 *   - sin `comercial_piloto`: todos los clientes del número (como con el script 05b «abrir a todos»);
 *   - con `comercial_piloto`: solo los contactos de la lista; todos los demás conversan EXACTAMENTE como si el número no tuviera esas herramientas (sin herramientas, sin
 *     guarda y con el prompt de siempre).
 *
 * Se aplica una sola vez, al entrar un turno: el resto del runtime ve una configuración sin las herramientas comerciales y no sabe que existe el piloto.
 */
import type { AgentRuntimeConfig } from "@/lib/agente/config";
import { esHerramientaComercial } from "@/lib/agente/nombres-herramientas";

export function aplicarPilotoComercial<T extends { config: AgentRuntimeConfig }>(deps: T, waId: string): T {
  const piloto = deps.config.business.comercial_piloto;
  if (!piloto || piloto.includes(waId)) return deps;
  if (!deps.config.tools.some(esHerramientaComercial)) return deps;
  return { ...deps, config: { ...deps.config, tools: deps.config.tools.filter((t) => !esHerramientaComercial(t)) } };
}
