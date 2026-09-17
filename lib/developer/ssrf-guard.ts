import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

// DuLabs Developer V1 -- Fase 1 (autorizado, sección 16 del brief). Un
// desarrollador configura su propia URL de webhook -- esa URL es una
// superficie SSRF real: si no se valida, un atacante (o un desarrollador
// malicioso) podría apuntarla a la red interna de DuLabs, a un endpoint de
// metadata de nube, etc.
//
// Regla clave contra DNS rebinding: no basta con mirar el hostname que
// escribió el desarrollador -- hay que resolver el DNS de verdad y validar
// la IP REAL a la que se va a conectar. Un hostname público perfectamente
// legítimo puede resolver (ahora, o en la próxima llamada) a 127.0.0.1 o a
// una IP interna. Por eso esta función resuelve y valida en el mismo paso
// que se usaría justo antes de hacer el fetch real -- nunca cachea la
// resolución para reusarla más tarde sin volver a validar.
//
// `lookupFn` es inyectable a propósito: los tests de DNS rebinding necesitan
// controlar exactamente qué IP "resuelve" un hostname fijo, sin depender de
// un DNS real ni de un dominio de prueba que pueda cambiar.
export type FuncionLookupDns = (hostname: string) => Promise<{ address: string; family: number }[]>;

async function lookupReal(hostname: string): Promise<{ address: string; family: number }[]> {
  const resultado = await dnsLookup(hostname, { all: true, family: 0 });
  return resultado.map((r) => ({ address: r.address, family: r.family }));
}

export type ResultadoValidacionSsrf = { permitido: true; ipResuelta: string } | { permitido: false; motivo: string };

function ipv4Bloqueada(ip: string): string | null {
  const octetos = ip.split(".").map(Number);
  if (octetos.length !== 4 || octetos.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return "IPv4 con formato inválido";
  const [a, b] = octetos;
  if (a === 127) return "loopback (127.0.0.0/8)";
  if (a === 10) return "RFC1918 (10.0.0.0/8)";
  if (a === 172 && b >= 16 && b <= 31) return "RFC1918 (172.16.0.0/12)";
  if (a === 192 && b === 168) return "RFC1918 (192.168.0.0/16)";
  if (a === 169 && b === 254) return "link-local / metadata endpoint (169.254.0.0/16)";
  if (a === 0) return "reservado (0.0.0.0/8)";
  if (a >= 224 && a <= 239) return "multicast (224.0.0.0/4)";
  if (a >= 240) return "reservado (240.0.0.0/4)";
  if (a === 100 && b >= 64 && b <= 127) return "CGNAT compartido (100.64.0.0/10)";
  return null;
}

function ipv6Bloqueada(ip: string): string | null {
  const normalizada = ip.toLowerCase();
  if (normalizada === "::1") return "loopback IPv6 (::1)";
  if (normalizada === "::") return "dirección no especificada (::)";
  if (normalizada.startsWith("fe80:") || normalizada.startsWith("fe8") || normalizada.startsWith("fe9") || normalizada.startsWith("fea") || normalizada.startsWith("feb")) {
    return "link-local IPv6 (fe80::/10)";
  }
  if (normalizada.startsWith("fc") || normalizada.startsWith("fd")) return "unique-local IPv6 (fc00::/7, equivalente a RFC1918)";
  if (normalizada.startsWith("ff")) return "multicast IPv6 (ff00::/8)";
  // IPv4-mapped (::ffff:a.b.c.d) -- se desenmascara y se valida como IPv4,
  // porque un atacante podría intentar exactamente esto para esquivar los
  // chequeos de arriba.
  const mapeada = normalizada.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeada) return ipv4Bloqueada(mapeada[1]);
  return null;
}

/**
 * Fase 17 -- expone la política de "IP bloqueada" (exactamente la misma que usa
 * validarUrlWebhookSegura) para que la ENTREGA pinneada (secure-webhook-delivery)
 * valide la IP a la que realmente se va a conectar con las MISMAS reglas -- sin
 * duplicar la lista de rangos ni arriesgar divergencia. Devuelve el motivo del
 * bloqueo o null si la IP es aceptable.
 */
export function motivoIpBloqueada(address: string, family: number): string | null {
  return family === 6 ? ipv6Bloqueada(address) : ipv4Bloqueada(address);
}

/**
 * Valida que una URL de webhook de desarrollador sea segura de invocar.
 * Chequea: protocolo (solo https en producción -- http se permite si
 * `permitirHttp` es true, únicamente para fixtures de test), resolución DNS
 * real de la IP, y que esa IP no caiga en ningún rango prohibido (loopback,
 * RFC1918, link-local/metadata, multicast, reservado, y sus equivalentes
 * IPv6). Nunca confía solo en el hostname.
 */
export async function validarUrlWebhookSegura(
  url: string,
  opciones?: { lookupFn?: FuncionLookupDns; permitirHttp?: boolean }
): Promise<ResultadoValidacionSsrf> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { permitido: false, motivo: "URL con formato inválido" };
  }

  if (parsed.protocol !== "https:" && !(opciones?.permitirHttp && parsed.protocol === "http:")) {
    return { permitido: false, motivo: `protocolo no permitido: ${parsed.protocol}` };
  }

  // Si el hostname YA es una IP literal (ej. "https://169.254.169.254/"),
  // no hace falta DNS -- se valida directo. Esto también cierra el bypass
  // obvio de escribir la IP prohibida directamente en vez de un hostname.
  const hostname = parsed.hostname;
  const tipoIpLiteral = isIP(hostname);
  const lookupFn = opciones?.lookupFn ?? lookupReal;

  let candidatos: { address: string; family: number }[];
  if (tipoIpLiteral) {
    candidatos = [{ address: hostname, family: tipoIpLiteral }];
  } else {
    try {
      candidatos = await lookupFn(hostname);
    } catch (err) {
      return { permitido: false, motivo: `no se pudo resolver el hostname: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (candidatos.length === 0) {
    return { permitido: false, motivo: "el hostname no resolvió a ninguna dirección" };
  }

  // TODAS las IPs candidatas deben ser seguras, no solo la primera --
  // Meta/cualquier CDN puede devolver varias, y basta con que UNA sea
  // interna para que el request real (que el runtime HTTP puede elegir
  // libremente) termine ahí.
  for (const candidato of candidatos) {
    const motivo = candidato.family === 6 ? ipv6Bloqueada(candidato.address) : ipv4Bloqueada(candidato.address);
    if (motivo) {
      return { permitido: false, motivo: `IP resuelta ${candidato.address} bloqueada: ${motivo}` };
    }
  }

  return { permitido: true, ipResuelta: candidatos[0].address };
}
