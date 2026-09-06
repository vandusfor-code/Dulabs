/**
 * Selección determinista de UNA plantilla de respuesta entre varias
 * (variación real sin repetir siempre la misma frase, sección 78 del
 * pedido) + interpolación. NUNCA usa IA ni Math.random para elegir --
 * un hash estable de (tenantId, escenarioCodigo, turno) decide, así el
 * mismo turno de la misma conversación siempre resuelve igual (reproducible
 * en tests) pero turnos distintos rotan entre las variantes configuradas.
 * La interpolación reutiliza TAL CUAL lib/flow/message-interpolation.ts --
 * nunca se reimplementa el motor de {{variable}}.
 */
import { interpolateTemplate } from "@/lib/flow/message-interpolation";

function hashEstable(texto: string): number {
  let h = 0;
  for (let i = 0; i < texto.length; i++) {
    h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function elegirYRenderizarPlantilla(params: {
  respuestas: string[];
  tenantId: string;
  escenarioCodigo: string;
  turno: number;
  variables: Record<string, unknown>;
}): string | undefined {
  if (params.respuestas.length === 0) return undefined;
  const indice = hashEstable(`${params.tenantId}:${params.escenarioCodigo}:${params.turno}`) % params.respuestas.length;
  const plantilla = params.respuestas[indice]!;
  return interpolateTemplate(plantilla, params.variables);
}
