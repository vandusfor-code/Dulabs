import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHmac } from "node:crypto";
import { firmaEsperadaGithub, verificarFirmaGithub } from "@/lib/developer/github/github-webhook-signature";

const SECRET = "un-webhook-secret-de-prueba";
const BODY = JSON.stringify({ action: "deleted", installation: { id: 123 } });

function firmar(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("verificarFirmaGithub", () => {
  it("acepta una firma válida sobre el cuerpo crudo", () => {
    assert.equal(verificarFirmaGithub(BODY, firmar(BODY, SECRET), SECRET), true);
  });

  it("rechaza una firma con secreto equivocado", () => {
    assert.equal(verificarFirmaGithub(BODY, firmar(BODY, "otro-secreto"), SECRET), false);
  });

  it("rechaza si el cuerpo fue alterado (un byte)", () => {
    const firma = firmar(BODY, SECRET);
    assert.equal(verificarFirmaGithub(BODY + " ", firma, SECRET), false);
  });

  it("rechaza cabecera ausente o malformada (fail-closed)", () => {
    assert.equal(verificarFirmaGithub(BODY, null, SECRET), false);
    assert.equal(verificarFirmaGithub(BODY, "", SECRET), false);
    assert.equal(verificarFirmaGithub(BODY, "sha1=abc", SECRET), false);
    assert.equal(verificarFirmaGithub(BODY, "deadbeef", SECRET), false);
  });

  it("firmaEsperadaGithub coincide con el HMAC de referencia", () => {
    assert.equal(firmaEsperadaGithub(BODY, SECRET), firmar(BODY, SECRET));
  });
});
