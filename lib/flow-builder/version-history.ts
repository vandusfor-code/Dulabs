/**
 * Etapa 5 (Flow Builder, autorizado) — lógica pura sobre el historial de
 * versiones. La auditoría confirmó que `published_at` puede quedar no-null
 * en versiones que YA NO son la publicada actual (la RPC nunca lo limpia al
 * publicar una versión más nueva) -- la única fuente correcta de "es esta
 * la versión publicada AHORA" es comparar contra `flow.published_version_id`,
 * nunca `version.published_at !== null`. Todo lo de este archivo es puro:
 * sin fetch, sin React.
 */

import type { FlowVersionRow } from "@/lib/flow/flow-store-types";

/** ¿Es esta versión la que está publicada ACTUALMENTE (no "alguna vez publicada")? */
export function isPublishedVersion(version: FlowVersionRow, publishedVersionId: string | null): boolean {
  return publishedVersionId !== null && version.id === publishedVersionId;
}

/**
 * ¿Existe una versión guardada con version_number mayor al de la publicada
 * actual? Alimenta el banner "hay un borrador más reciente sin publicar".
 * Si el flow nunca se publicó (publishedVersionId null) o la publicada ya
 * no aparece en `versions`, no hay base de comparación -- false.
 */
export function hasNewerDraftThanPublished(versions: FlowVersionRow[], publishedVersionId: string | null): boolean {
  if (!publishedVersionId) return false;
  const published = versions.find((v) => v.id === publishedVersionId);
  if (!published) return false;
  return versions.some((v) => v.version_number > published.version_number);
}
