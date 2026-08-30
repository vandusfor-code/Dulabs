/**
 * Fase 0 — gate de prueba por remitente (autorizado explícitamente).
 *
 * Lista de remitentes autorizados para probar Flow, por phone_number_id.
 * A propósito en código, NO en Supabase: es una configuración de prueba
 * TEMPORAL — revertir es vaciar este mapa o borrar este archivo, sin tocar
 * ninguna fila ni columna de dulabs_clientes_config. No requiere migración.
 *
 * NO confundir con ia_restringida_a (columna real en dulabs_clientes_config):
 * esa decide quién recibe respuesta EN ABSOLUTO (Legacy o Flow, lo que sea
 * que corresponda). Esta decide, de los que sí reciben respuesta, cuáles
 * usan Flow en vez de Legacy. Son preguntas independientes que hoy
 * coinciden en el mismo número por la prueba, no por diseño — ver
 * lib/flow-routing.ts::debeUsarFlowParaRemitente.
 *
 * Vacío o ausente para un phone_number_id = sin restricción: si
 * flow_activo=true para ese número, CUALQUIER remitente usa Flow (el
 * comportamiento real post-prueba, cuando ya no haga falta restringir).
 */
const FLOW_TEST_SENDERS: Record<string, string[]> = {
  // Daniela (spa de uñas) — fase de prueba: SOLO el 314 de prueba puede
  // entrar a Flow aunque flow_activo llegara a activarse para este número.
  // Cualquier otro remitente sigue por LEGACY. Ver autorización "gate de
  // prueba por remitente".
  "1282448611609227": ["573148127388"],
};

/**
 * Remitentes autorizados para Flow en este phone_number_id, o null si no
 * hay restricción configurada (cualquier remitente puede usar Flow una vez
 * flow_activo=true para ese número).
 */
export function remitentesDePruebaFlow(phoneNumberId: string): string[] | null {
  const lista = FLOW_TEST_SENDERS[phoneNumberId];
  return lista && lista.length > 0 ? lista : null;
}
