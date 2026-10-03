/**
 * FASE 3B — DOCUMENTO DE IDENTIDAD de un pedido (solo con entrega en oficina de transportadora).
 *
 *   - Se valida solo el FORMATO (genérico). Qué tipos se aceptan y cuánto tiempo se guarda lo decide el
 *     negocio (AcceptancePolicy.document): aquí no hay ningún tipo ni plazo por defecto.
 *   - Se CIFRA antes de salir del proceso (DocumentCipher; en producción lib/crypto.ts, AES-256-GCM) y
 *     se verifica que lo cifrado tenga el formato v1: un número en claro nunca llega a la BD.
 *   - Solo se muestra ENMASCARADO (últimos 4).
 *   - Nunca va a trazas, prompts ni registros: este módulo no registra nada y sus errores nunca incluyen
 *     el número.
 *
 * Riesgo conocido (fuera de esta fase): el mensaje de WhatsApp con el documento queda en el historial del
 * Inbox como cualquier otro mensaje del cliente.
 */
import type { AcceptancePolicy, DeliveryType } from "@/lib/catalogo/pedidos/contrato";

export interface DocumentCipher {
  /** Devuelve "v1:<iv>:<tag>:<texto cifrado>" (lib/crypto.ts). Nunca registra el valor. */
  encrypt(plain: string): string;
}

/** Código de tipo (lo define la configuración del negocio): minúsculas y guion bajo. */
export const DOCUMENT_TYPE_CODE = /^[a-z][a-z_]{1,29}$/;
/** Mismo formato que exige la BD (dulabs_catalogo_pedido_documentos.numero_cifrado). */
const CIPHER_TEXT = /^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;
export const DOCUMENT_RETENTION_DAYS_MAX = 3_650;

/** Número tal como lo escribió el cliente -> letras y dígitos en mayúscula (sin puntos, espacios ni guiones), 4–20. */
export function normalizeDocumentNumber(raw: string): string | null {
  const t = raw.normalize("NFKC").toUpperCase().replace(/[\s.\-–—]/g, "");
  return /^[0-9A-Z]{4,20}$/.test(t) ? t : null;
}

/** Lo único que se muestra del documento. */
export function maskDocument(last4: string): string {
  return `•••• ${last4}`;
}

export interface StoredDocument {
  type: string;
  cipherText: string;
  last4: string;
  /** Retención: null = sin borrado automático (política del negocio). */
  deleteAfter: string | null;
}

/**
 * Fase 3B.4 — código de tipo cuando el negocio aún no definió tipos de documento (D4): el documento se
 * recibe como texto, sin tipo. NO es un tipo inventado: dice explícitamente "sin especificar".
 */
export const DOCUMENTO_SIN_TIPO = "no_especificado";

/** Documento ya SELLADO (cifrado) al recibirlo: el número en claro no vuelve a viajar. */
export interface SealedDocument {
  cipherText: string;
  last4: string;
}

export type DocumentInput = { type: string; number: string } | { type: string; sealed: SealedDocument };

/**
 * Fase 3B.4 — sella el número al recibirlo (checkout): valida el formato, lo cifra y verifica que lo
 * cifrado tenga el formato v1 y nunca contenga el número. null = no se pudo (nunca se guarda en claro).
 */
export function sealDocument(raw: string, cipher: DocumentCipher | undefined): { ok: true; sealed: SealedDocument } | { ok: false; error: "document_invalid" | "document_cipher_unavailable" } {
  const number = normalizeDocumentNumber(raw);
  if (!number) return { ok: false, error: "document_invalid" };
  if (!cipher) return { ok: false, error: "document_cipher_unavailable" };
  let cipherText: string;
  try {
    cipherText = cipher.encrypt(number);
  } catch {
    return { ok: false, error: "document_cipher_unavailable" };
  }
  if (!CIPHER_TEXT.test(cipherText) || cipherText.includes(number)) return { ok: false, error: "document_cipher_unavailable" };
  return { ok: true, sealed: { cipherText, last4: number.slice(-4) } };
}

export type DocumentError = "document_not_allowed" | "document_required" | "document_type_not_allowed" | "document_invalid" | "document_cipher_unavailable";

/** ¿La política es utilizable? (tipos con formato válido y plazo dentro de los límites técnicos) */
export function validDocumentPolicy(policy: AcceptancePolicy["document"]): boolean {
  if (policy.kind === "not_collected") return true;
  if (policy.allowedTypes.length === 0 || !policy.allowedTypes.every((t) => DOCUMENT_TYPE_CODE.test(t))) return false;
  if (new Set(policy.allowedTypes).size !== policy.allowedTypes.length) return false;
  return policy.retention.kind === "no_automatic_deletion" || (Number.isInteger(policy.retention.days) && policy.retention.days >= 1 && policy.retention.days <= DOCUMENT_RETENTION_DAYS_MAX);
}

/**
 * Prepara el documento para guardarlo (cifrado) según la política del negocio y la entrega:
 *   - sin oficina de transportadora: NUNCA hay documento;
 *   - con oficina y política "required_for_office": obligatorio, de un tipo permitido.
 * Devuelve null cuando no corresponde guardar ninguno.
 */
export function prepareDocument(
  input: DocumentInput | null | undefined,
  ctx: { delivery: DeliveryType; policy: AcceptancePolicy["document"]; cipher: DocumentCipher | undefined; now: Date },
): { ok: true; document: StoredDocument | null } | { ok: false; error: DocumentError } {
  const office = ctx.delivery === "oficina_transportadora";
  if (!office || ctx.policy.kind === "not_collected") return input ? { ok: false, error: "document_not_allowed" } : { ok: true, document: null };
  if (!input) return { ok: false, error: "document_required" };
  if (!ctx.policy.allowedTypes.includes(input.type)) return { ok: false, error: "document_type_not_allowed" };
  const retention = ctx.policy.retention;
  const deleteAfter = retention.kind === "days" ? new Date(ctx.now.getTime() + retention.days * 86_400_000).toISOString() : null;
  // Fase 3B.4: ya sellado al recibirlo (el checkout validó el formato con normalizeDocumentNumber).
  if ("sealed" in input) {
    if (!CIPHER_TEXT.test(input.sealed.cipherText) || !/^[0-9A-Z]{1,4}$/.test(input.sealed.last4)) return { ok: false, error: "document_invalid" };
    return { ok: true, document: { type: input.type, cipherText: input.sealed.cipherText, last4: input.sealed.last4, deleteAfter } };
  }
  const s = sealDocument(input.number, ctx.cipher);
  if (!s.ok) return { ok: false, error: s.error };
  return { ok: true, document: { type: input.type, cipherText: s.sealed.cipherText, last4: s.sealed.last4, deleteAfter } };
}
