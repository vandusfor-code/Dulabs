import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verificarFirmaMeta } from "@/lib/developer/meta-webhook-signature";

describe("DuLabs Developer V1 — verificación de firma de webhooks de Meta (Fase 3)", () => {
  const appSecret = "test-app-secret-12345";
  const cuerpo = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  function firmarComoMeta(cuerpoCrudo: string, secreto: string): string {
    return "sha256=" + createHmac("sha256", secreto).update(cuerpoCrudo).digest("hex");
  }

  it("firma válida generada con el App Secret correcto se verifica como válida", () => {
    const firma = firmarComoMeta(cuerpo, appSecret);
    assert.equal(verificarFirmaMeta(cuerpo, firma, appSecret), true);
  });

  it("firma generada con OTRO App Secret se rechaza", () => {
    const firma = firmarComoMeta(cuerpo, "otro-secreto-distinto");
    assert.equal(verificarFirmaMeta(cuerpo, firma, appSecret), false);
  });

  it("si el cuerpo cambia después de firmar, la firma deja de ser válida", () => {
    const firma = firmarComoMeta(cuerpo, appSecret);
    assert.equal(verificarFirmaMeta(cuerpo + "x", firma, appSecret), false);
  });

  it("cabecera ausente se rechaza sin lanzar", () => {
    assert.equal(verificarFirmaMeta(cuerpo, undefined, appSecret), false);
    assert.equal(verificarFirmaMeta(cuerpo, null, appSecret), false);
  });

  it("cabecera sin el prefijo sha256= se rechaza", () => {
    assert.equal(verificarFirmaMeta(cuerpo, "abcdef", appSecret), false);
  });

  it("cabecera con hex corrupto/longitud distinta se rechaza sin lanzar", () => {
    assert.equal(verificarFirmaMeta(cuerpo, "sha256=zzzz", appSecret), false);
    assert.equal(verificarFirmaMeta(cuerpo, "sha256=", appSecret), false);
  });

  it("appSecret vacío nunca valida (fail-closed)", () => {
    const firma = firmarComoMeta(cuerpo, "");
    assert.equal(verificarFirmaMeta(cuerpo, firma, ""), false);
  });
});
