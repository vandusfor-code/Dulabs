/**
 * CMS comercial — CHECKSUM del contenido publicado. PURO.
 *
 * Cada versión publicada guarda el SHA-256 de su contenido en JSON CANÓNICO (claves ordenadas, sin espacios). Al publicar lo calcula el servicio sobre lo que
 * validó; al leer, el lector lo recalcula: si no coincide (alguien tocó la base a mano, o se corrompió), ese elemento NO se entrega. La base guarda el
 * contenido como jsonb (que reordena claves), por eso la forma canónica no depende del orden ni del espaciado.
 */
import { createHash } from "node:crypto";
import { jsonCanonico } from "@/lib/cms-comercial/json-canonico";

export { jsonCanonico };

export function checksumDe(contenido: unknown): string {
  return createHash("sha256").update(jsonCanonico(contenido), "utf8").digest("hex");
}
