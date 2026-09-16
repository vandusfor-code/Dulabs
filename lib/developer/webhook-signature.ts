import { createHmac, timingSafeEqual } from "node:crypto";

// DuLabs Developer V1 -- Fase 1 (autorizado, sección 18 del brief). Firma
// HMAC-SHA256 de los eventos que DuLabs manda al webhook del desarrollador,
// para que él pueda verificar que el evento realmente vino de DuLabs y no
// fue falsificado por un tercero que le pegó directo a su endpoint público.
//
// Payload firmado: `${timestamp}.${cuerpoJsonCrudo}` (mismo patrón que
// Stripe/GitHub) -- NUNCA se firma solo el body, porque eso permitiría
// reproducir (replay) el mismo evento indefinidamente con un timestamp
// nuevo sin que la firma cambie. Firmar el timestamp junto con el cuerpo
// hace que cada envío tenga una firma distinta y permite rechazar eventos
// viejos reenviados.

const TOLERANCIA_TIMESTAMP_SEGUNDOS_POR_DEFECTO = 5 * 60; // 5 minutos, igual que Stripe

export const HEADER_FIRMA = "X-DuLabs-Signature";
export const HEADER_TIMESTAMP = "X-DuLabs-Timestamp";
export const HEADER_EVENT_ID = "X-DuLabs-Event-ID";

/** Construye el string exacto que se firma -- expuesto para que firmarEvento y verificarFirma usen SIEMPRE la misma construcción. */
export function payloadFirmado(timestampUnixSegundos: number, cuerpoJsonCrudo: string): string {
  return `${timestampUnixSegundos}.${cuerpoJsonCrudo}`;
}

export type EventoFirmado = {
  firma: string; // hex
  timestamp: number;
};

/** Firma un evento saliente con el secreto vigente del webhook de ese número/desarrollador. */
export function firmarEvento(secreto: string, cuerpoJsonCrudo: string, timestampUnixSegundos: number = Math.floor(Date.now() / 1000)): EventoFirmado {
  const firma = createHmac("sha256", secreto).update(payloadFirmado(timestampUnixSegundos, cuerpoJsonCrudo), "utf8").digest("hex");
  return { firma, timestamp: timestampUnixSegundos };
}

export type ResultadoVerificacionFirma = { valido: true } | { valido: false; motivo: "firma_invalida" | "timestamp_expirado" | "timestamp_invalido" };

/**
 * Verifica la firma de un evento recibido. El desarrollador (o, en los
 * tests, el propio DuLabs simulando ser el receptor) llama esto con el
 * secreto vigente Y, si aplica, el secreto anterior (ventana de gracia de
 * rotación) -- este módulo valida contra UN secreto a la vez, quien llama
 * decide contra cuáles reintentar.
 */
export function verificarFirma(params: {
  secreto: string;
  cuerpoJsonCrudo: string;
  firmaRecibida: string;
  timestampRecibido: string | number;
  ahoraUnixSegundos?: number;
  toleranciaSegundos?: number;
}): ResultadoVerificacionFirma {
  const timestamp = typeof params.timestampRecibido === "string" ? Number(params.timestampRecibido) : params.timestampRecibido;
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { valido: false, motivo: "timestamp_invalido" };
  }

  const ahora = params.ahoraUnixSegundos ?? Math.floor(Date.now() / 1000);
  const tolerancia = params.toleranciaSegundos ?? TOLERANCIA_TIMESTAMP_SEGUNDOS_POR_DEFECTO;
  // Protección contra replay (sección 18 del brief): un evento con
  // timestamp fuera de la ventana se rechaza SIN comparar la firma --
  // aunque la firma fuera válida, un atacante que capturó un evento viejo
  // no puede reproducirlo pasada la ventana.
  if (Math.abs(ahora - timestamp) > tolerancia) {
    return { valido: false, motivo: "timestamp_expirado" };
  }

  const firmaEsperada = createHmac("sha256", params.secreto).update(payloadFirmado(timestamp, params.cuerpoJsonCrudo), "utf8").digest("hex");

  const bufRecibida = Buffer.from(params.firmaRecibida, "hex");
  const bufEsperada = Buffer.from(firmaEsperada, "hex");
  // Longitudes distintas (ej. firma truncada/corrupta) -- nunca se le pasa
  // eso a timingSafeEqual (lanzaría), se trata directo como inválida.
  if (bufRecibida.length !== bufEsperada.length || !timingSafeEqual(bufRecibida, bufEsperada)) {
    return { valido: false, motivo: "firma_invalida" };
  }

  return { valido: true };
}
