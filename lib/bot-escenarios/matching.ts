/**
 * Matching de variantes de activación contra UN mensaje ya normalizado +
 * las entidades ya extraídas (ver entidades.ts). Pura, sin I/O -- mismo
 * criterio de separación que lib/flow-triggers/match-trigger.ts (esa función
 * no sabe de prioridad/otros triggers; esta tampoco).
 */
import { normalizeText } from "@/lib/flow-triggers/normalize-text";
import type { EntidadesDetectadas, EscenarioRow, VarianteActivacion } from "@/lib/bot-escenarios/tipos";

function coincideVariante(
  variante: VarianteActivacion,
  textoNormalizado: string,
  entidades: EntidadesDetectadas,
): boolean {
  switch (variante.tipo) {
    case "contains":
      return Boolean(variante.valor) && textoNormalizado.includes(normalizeText(variante.valor!));
    case "starts_with":
      return Boolean(variante.valor) && textoNormalizado.startsWith(normalizeText(variante.valor!));
    case "exact":
      return Boolean(variante.valor) && textoNormalizado === normalizeText(variante.valor!);
    case "servicio_detectado":
      return Boolean(entidades.servicioId);
    case "categoria_detectada":
      // Requiere `valor` = la categoría real exacta (ej. "Uñas") -- sin esto,
      // CUALQUIER categoría detectada haría coincidir TODOS los escenarios
      // de categoría a la vez, sin importar cuál.
      return Boolean(variante.valor) && entidades.categoria === variante.valor;
    case "afirmacion_corta":
      return entidades.esAfirmacionCorta;
    case "negacion_corta":
      return entidades.esNegacionCorta;
  }
}

function escenarioCoincide(
  escenario: EscenarioRow,
  textoNormalizado: string,
  entidades: EntidadesDetectadas,
): boolean {
  return escenario.variantes.some((v) => coincideVariante(v, textoNormalizado, entidades));
}

/**
 * Escenario ganador entre los activos de un tenant: mayor `prioridad` gana;
 * empate se rompe por orden de inserción (primero en la lista, mismo
 * criterio determinista y auditable que ya usa trigger-router.ts al
 * desempatar por `id`). Escenarios cuyo `variantes` está vacío nunca
 * coinciden por texto -- solo pueden activarse como fallback explícito
 * (ver resolver.ts).
 */
export function resolverEscenarioGanador(
  escenarios: EscenarioRow[],
  mensaje: string,
  entidades: EntidadesDetectadas,
): EscenarioRow | undefined {
  const textoNormalizado = normalizeText(mensaje);
  const candidatos = escenarios
    .filter((e) => e.activo && escenarioCoincide(e, textoNormalizado, entidades))
    .sort((a, b) => b.prioridad - a.prioridad);
  return candidatos[0];
}
