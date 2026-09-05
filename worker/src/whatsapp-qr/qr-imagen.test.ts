import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generarImagenQr } from "./qr-imagen.js";

describe("generarImagenQr (Fase 9A/9B, pura)", () => {
  it("convierte el contenido del QR en una data URL de imagen", async () => {
    const resultado = await generarImagenQr("2@abc123,def456,ghi789==");
    assert.ok(resultado.startsWith("data:image/png;base64,"));
  });
});
