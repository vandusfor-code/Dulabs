import { createSign } from "node:crypto";

// DuLabs Developer V1 -- GitHub Integration (Fase 1, autorizado).
// Acuña el JWT de la GitHub App (RS256) para autenticarse como la App ante la
// API de GitHub y, con él, pedir tokens de instalación efímeros. Implementado
// con node:crypto (sin dependencia nueva). El JWT es de vida corta (<=10 min,
// máximo que exige GitHub) y NUNCA se persiste ni se loguea.

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type GithubAppJwt = { token: string; expiresAt: number };

/**
 * Genera un JWT firmado con la private key de la App.
 * `iat` se retrasa 60s para tolerar drift de reloj (recomendación de GitHub);
 * `exp` = iat + 9min (bajo el tope de 10min).
 */
export function generarGithubAppJwt(params: { appId: string; privateKey: string; ahoraMs?: number }): GithubAppJwt {
  const ahora = Math.floor((params.ahoraMs ?? Date.now()) / 1000);
  const iat = ahora - 60;
  const exp = ahora + 9 * 60;
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat, exp, iss: params.appId };
  const firmarSobre = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(firmarSobre);
  signer.end();
  const firma = base64url(signer.sign(params.privateKey));
  return { token: `${firmarSobre}.${firma}`, expiresAt: exp * 1000 };
}
