import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { generarGithubAppJwt } from "@/lib/developer/github/github-app-jwt";

// Genera un par RSA real de prueba (no toca ningún secreto de producción).
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
}

describe("generarGithubAppJwt", () => {
  it("produce un JWT de 3 segmentos con header RS256 y issuer = appId", () => {
    const { token } = generarGithubAppJwt({ appId: "123456", privateKey: PRIVATE_PEM });
    const partes = token.split(".");
    assert.equal(partes.length, 3);
    const header = decodeSegment(partes[0]);
    const payload = decodeSegment(partes[1]);
    assert.equal(header.alg, "RS256");
    assert.equal(header.typ, "JWT");
    assert.equal(payload.iss, "123456");
  });

  it("la firma verifica contra la clave pública", () => {
    const { token } = generarGithubAppJwt({ appId: "123456", privateKey: PRIVATE_PEM });
    const [h, p, s] = token.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    verifier.end();
    const firma = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    assert.equal(verifier.verify(PUBLIC_PEM, firma), true);
  });

  it("iat se atrasa 60s y exp queda <= 10 min (regla de GitHub)", () => {
    const ahoraMs = 1_700_000_000_000;
    const { token, expiresAt } = generarGithubAppJwt({ appId: "1", privateKey: PRIVATE_PEM, ahoraMs });
    const payload = decodeSegment(token.split(".")[1]) as { iat: number; exp: number };
    const ahora = Math.floor(ahoraMs / 1000);
    assert.equal(payload.iat, ahora - 60);
    assert.ok(payload.exp - ahora <= 600, "exp no debe exceder 10 min");
    assert.ok(payload.exp > ahora, "exp debe ser futuro");
    assert.equal(expiresAt, payload.exp * 1000);
  });
});
