// DuLabs Developer V1 -- Fase 17 (17.2, X-Forwarded-For hardening). El gateway
// (Cloud Run) usaba el PRIMER token de X-Forwarded-For, que es el extremo
// IZQUIERDO y lo controla el cliente: enviar `X-Forwarded-For: 1.2.3.4` bastaba
// para falsear la IP y evadir el rate-limit anti-abuso por IP.
//
// Regla robusta: la infraestructura confiable (Google Front End / balanceador)
// APPENDEA la IP real del peer al FINAL del XFF; el cliente solo puede anteponer
// valores a la izquierda. Por eso se cuenta desde la DERECHA: se descartan los
// últimos `trustedProxies` hops (agregados por infra) y se toma el token
// inmediatamente anterior como IP del cliente. Con el default (0) se toma el
// ÚLTIMO token -- el que agrega la infra, no falsificable por el cliente.
//
// IMPORTANTE (config de infra, NO verificable desde el repo): el valor correcto
// de `trustedProxies` depende de cuántos hops confiables anexa el despliegue.
// - Cloud Run directo (GFE anexa 1): normalmente 0 (tomar el último).
// - Detrás de un HTTPS LB externo adicional: puede requerir 1.
// Verificar en el entorno real e indicar via GATEWAY_TRUSTED_PROXIES.

/** Lee GATEWAY_TRUSTED_PROXIES (entero >= 0). Default 0: toma el último token. */
export function trustedProxiesPorDefecto(): number {
  const raw = process.env.GATEWAY_TRUSTED_PROXIES;
  const n = raw !== undefined && raw !== "" ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * Extrae la IP del cliente de forma resistente a spoofing de X-Forwarded-For.
 * Toma el token en la posición (len - 1 - trustedProxies) contando desde la
 * derecha, con fallback al socket. Nunca confía en el extremo izquierdo.
 */
export function extraerIpConfiable(params: {
  xff: string | string[] | undefined | null;
  socketAddr?: string;
  trustedProxies?: number;
}): string | undefined {
  const trusted =
    Number.isInteger(params.trustedProxies) && (params.trustedProxies as number) >= 0
      ? (params.trustedProxies as number)
      : trustedProxiesPorDefecto();

  const raw = Array.isArray(params.xff) ? params.xff.join(",") : params.xff ?? "";
  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (entries.length === 0) return params.socketAddr ?? undefined;

  const idx = entries.length - 1 - trusted;
  // Si hay menos entradas que hops confiables esperados (cadena más corta de lo
  // esperado, p. ej. entorno local/test), se cae al socket real, nunca a un
  // valor de la izquierda que podría ser del cliente.
  if (idx < 0) return params.socketAddr ?? entries[entries.length - 1];
  return entries[idx] || params.socketAddr;
}
