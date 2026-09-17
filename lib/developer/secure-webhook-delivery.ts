import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { lookup as dnsLookupCb } from "node:dns";
import { isIP } from "node:net";
import { motivoIpBloqueada } from "./ssrf-guard";

// DuLabs Developer V1 -- Fase 17 (17.1, SSRF IP pinning). Resuelve el residual
// P2 de Fase 16 (DNS rebinding / TOCTOU): antes, se validaba el DNS y luego
// `fetch` volvía a resolver por su cuenta, así que la IP podía cambiar entre la
// validación y la conexión. Aquí la conexión usa EXACTAMENTE la IP que se
// validó, porque la validación ocurre DENTRO del `lookup` que `node:https`
// usará para conectar el socket -- una sola resolución para validar y conectar.
//
// Propiedades de seguridad:
//   - Una IP literal en la URL (p. ej. https://169.254.169.254/) NUNCA llega al
//     `lookup` (node conecta directo a literales), así que se valida ANTES.
//   - Un hostname se resuelve una vez; se validan TODAS las IPs; se conecta a
//     una validada. Si CUALQUIERA está bloqueada -> ErrorDestinoNoSeguro.
//   - NO se siguen redirects (node:https no los sigue): un 3xx es una respuesta
//     normal (no "ok") -> el caller lo trata como terminal. Nunca se conecta al
//     destino de un Location.
//   - TLS/SNI intacto: el servername sigue siendo el hostname de la URL, así que
//     el certificado se valida contra el hostname (NUNCA se desactiva la
//     verificación de certificado).

export class ErrorDestinoNoSeguro extends Error {
  constructor(public readonly motivo: string) {
    super(`destino_no_seguro:${motivo}`);
    this.name = "ErrorDestinoNoSeguro";
  }
}

export type RespuestaEntrega = { status: number; ok: boolean };

/** Resolutor DNS inyectable (tests de rebinding). Devuelve todas las IPs candidatas. */
export type ResolverDns = (hostname: string) => Promise<{ address: string; family: number }[]>;
/** Política de bloqueo de IP inyectable (tests). Por defecto: motivoIpBloqueada (real). */
export type ValidarIp = (address: string, family: number) => string | null;

type OpcionesEntrega = {
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  /** Solo tests/fixtures: permite http:// además de https://. */
  permitirHttp?: boolean;
  /** Solo tests: sustituye la resolución DNS real (simula rebinding/multi-IP). */
  resolver?: ResolverDns;
  /** Solo tests: sustituye la política de IP (para probar la mecánica HTTP contra un server local). */
  validarIp?: ValidarIp;
};

function resolverPorDefecto(hostname: string): Promise<{ address: string; family: number }[]> {
  return new Promise((resolve, reject) => {
    dnsLookupCb(hostname, { all: true, family: 0 }, (err, direcciones) => {
      if (err) reject(err);
      else resolve(direcciones.map((d) => ({ address: d.address, family: d.family })));
    });
  });
}

/**
 * Entrega un webhook firmado a una URL controlada por el Developer, con IP
 * pinning contra SSRF, sin seguir redirects, con timeout y validación TLS.
 * Lanza ErrorDestinoNoSeguro si el destino resuelve a una IP prohibida
 * (terminal: el caller debe mandarlo a DLQ, nunca reintentar). Cualquier otro
 * error (timeout/conexión/DNS) se lanza como Error genérico (reintentable).
 */
export async function entregarWebhookSeguro(url: string, opts: OpcionesEntrega): Promise<RespuestaEntrega> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ErrorDestinoNoSeguro("url_invalida");
  }

  const esHttps = parsed.protocol === "https:";
  const esHttp = parsed.protocol === "http:";
  if (!esHttps && !(esHttp && opts.permitirHttp)) {
    throw new ErrorDestinoNoSeguro(`protocolo_no_permitido:${parsed.protocol}`);
  }

  const validarIp = opts.validarIp ?? motivoIpBloqueada;
  const resolver = opts.resolver ?? resolverPorDefecto;

  // IP literal en la URL: node conecta directo (NO llama al lookup), así que se
  // valida acá o el pin no aplicaría.
  const tipoLiteral = isIP(parsed.hostname);
  if (tipoLiteral) {
    const motivo = validarIp(parsed.hostname, tipoLiteral);
    if (motivo) throw new ErrorDestinoNoSeguro(`ip_literal:${motivo}`);
  }

  // lookup que VALIDA y devuelve la IP a la que se conectará el socket. Es el
  // punto donde se garantiza "conectar solo a IP validada" (sin TOCTOU): la
  // misma resolución que se valida es la que usa net para conectar.
  const lookupSeguro = (
    hostname: string,
    opciones: { all?: boolean } | number | undefined,
    // net puede pedir una sola dirección (err,address,family) o, con {all:true},
    // un arreglo (err,[{address,family}]). Se soportan ambas firmas.
    callback: (err: NodeJS.ErrnoException | null, address?: string | { address: string; family: number }[], family?: number) => void,
  ): void => {
    const quiereTodas = typeof opciones === "object" && opciones !== null && opciones.all === true;
    resolver(hostname)
      .then((candidatos) => {
        if (candidatos.length === 0) {
          callback(new ErrorDestinoNoSeguro("sin_resolucion") as NodeJS.ErrnoException);
          return;
        }
        for (const c of candidatos) {
          const motivo = validarIp(c.address, c.family);
          if (motivo) {
            // CUALQUIER IP resuelta insegura -> se aborta la conexión (nunca se conecta).
            callback(new ErrorDestinoNoSeguro(`ip_resuelta:${c.address}:${motivo}`) as NodeJS.ErrnoException);
            return;
          }
        }
        // Todas validadas: se conecta solo a una de ellas (pin).
        if (quiereTodas) {
          callback(null, candidatos.map((c) => ({ address: c.address, family: c.family })));
        } else {
          callback(null, candidatos[0].address, candidatos[0].family);
        }
      })
      .catch((err) => callback(err instanceof Error ? (err as NodeJS.ErrnoException) : new Error(String(err)) as NodeJS.ErrnoException));
  };

  const requestFn = esHttps ? httpsRequest : httpRequest;

  return new Promise<RespuestaEntrega>((resolve, reject) => {
    const req = requestFn(
      url,
      {
        method: "POST",
        headers: { ...opts.headers, "Content-Length": Buffer.byteLength(opts.body).toString() },
        lookup: lookupSeguro as never,
        timeout: opts.timeoutMs,
        // NUNCA seguir redirects: node:https no los sigue; un 3xx llega como
        // respuesta normal. Se deja explícito el criterio.
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Se drena y descarta el cuerpo (no se confía en la respuesta), para
        // liberar el socket. Límite defensivo para no leer una respuesta enorme.
        let leidos = 0;
        res.on("data", (chunk: Buffer) => {
          leidos += chunk.length;
          if (leidos > 64 * 1024) res.destroy(); // 64 KiB tope: no somos un proxy
        });
        res.on("end", () => resolve({ status, ok: status >= 200 && status < 300 }));
        res.on("error", () => resolve({ status, ok: status >= 200 && status < 300 }));
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => reject(err));
    req.write(opts.body);
    req.end();
  });
}
