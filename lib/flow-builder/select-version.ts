/**
 * Etapa 1 (Flow Builder, autorizado) — lógica pura de selección de versión a
 * mostrar en el canvas de solo lectura. Preferencia: la versión publicada
 * del Flow; si no hay ninguna publicada (o el flow.published_version_id ya
 * no aparece en la lista), la versión más reciente por version_number.
 */

import type { FlowRow, FlowVersionRow } from "@/lib/flow/flow-store-types";

export function selectVersionToDisplay(
  flow: Pick<FlowRow, "published_version_id">,
  versions: FlowVersionRow[],
): FlowVersionRow | null {
  if (versions.length === 0) return null;

  if (flow.published_version_id) {
    const published = versions.find((v) => v.id === flow.published_version_id);
    if (published) return published;
  }

  return versions.reduce((mas_reciente, v) => (v.version_number > mas_reciente.version_number ? v : mas_reciente));
}
