import { createHash } from "node:crypto";

// DuLabs Developer V1 -- Fase 3 (autorizado, corrección de la ronda 3 del
// documento de infraestructura, sección A "Diseño del event_id"). NO se usa
// el wamid/id del mensaje de WhatsApp como event_id -- un mismo mensaje
// produce varios webhooks distintos a lo largo de su ciclo de vida (sent,
// delivered, read), todos referenciando el mismo wamid, así que usar solo
// eso deduplicaría incorrectamente eventos que son semánticamente
// distintos. En su lugar: SHA-256 de una canonicalización determinista del
// payload crudo completo -- misma reentrega de Meta produce el mismo hash
// (mismo contenido), pero sent/delivered/read producen hashes distintos
// (cada uno es un webhook HTTP separado, con `status`/`timestamp` propios).

/**
 * Reordena las claves de todo objeto de forma recursiva (alfabético),
 * preservando el orden de los arrays tal cual los envía Meta (ese orden sí
 * es parte del contenido semántico). Neutraliza diferencias superficiales
 * de serialización (orden de claves, espacios) entre dos entregas del
 * mismo evento sin que el contenido real haya cambiado.
 */
function canonicalizar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonicalizar);
  if (valor !== null && typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;
    const clavesOrdenadas = Object.keys(objeto).sort();
    const resultado: Record<string, unknown> = {};
    for (const clave of clavesOrdenadas) resultado[clave] = canonicalizar(objeto[clave]);
    return resultado;
  }
  return valor;
}

/** Calcula el event_id determinista de un webhook de Meta ya parseado. */
export function calcularEventIdWebhookMeta(payload: unknown): string {
  const canonico = JSON.stringify(canonicalizar(payload));
  return createHash("sha256").update(canonico, "utf8").digest("hex");
}
