/** Subconjunto de MetaMessage usado solo para identificar al remitente. */
export type MetaMessageRemitente = {
  from?: string;
  id?: string;
  type?: string;
};

export type MetaContactRemitente = {
  wa_id?: string;
};

/** Normaliza a solo dígitos; tolera null/undefined (devuelve ""). */
export function soloDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

/**
 * Resuelve el teléfono del remitente de un webhook `messages` de Meta.
 *
 * - Estándar Meta: `messages[].from` identifica al usuario (documentado incluso
 *   en type "unsupported" con errors 131051/131060).
 * - Fallback documentado: cuando falta `from`, Meta suele incluir un único
 *   `contacts[]` con el `wa_id` del remitente en el mismo evento.
 * - Sin `from` y sin un contacto único con wa_id: no hay remitente fiable → null.
 *   (No se usa `to` ni otras heurísticas — evita tratar ecos como entrantes.)
 */
export function resolverTelefonoRemitenteMeta(
  mensaje: MetaMessageRemitente,
  contacts?: MetaContactRemitente[] | null,
): string | null {
  if (mensaje.from != null && String(mensaje.from).trim() !== "") {
    return soloDigitos(mensaje.from);
  }

  const lista = contacts ?? [];
  if (lista.length === 1) {
    const waId = lista[0]?.wa_id;
    if (waId != null && String(waId).trim() !== "") {
      const digitos = soloDigitos(waId);
      return digitos || null;
    }
  }

  return null;
}

export function advertirMensajeSinRemitente(mensaje: MetaMessageRemitente): void {
  console.warn(
    `[webhook-dulabs] mensaje entrante sin remitente identificable (from/contacts): id=${mensaje.id ?? "?"} type=${mensaje.type ?? "?"}`,
  );
}

/** Número para Graph API (wa.me): prefiere from crudo de Meta, si no el resuelto. */
export function numeroWhatsappParaEnvio(mensaje: MetaMessageRemitente, telefonoRemitente: string): string {
  return mensaje.from ?? telefonoRemitente;
}
