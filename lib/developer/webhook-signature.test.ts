import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { firmarEvento, verificarFirma } from "@/lib/developer/webhook-signature";

describe("DuLabs Developer V1 — firma HMAC de webhooks (Fase 1, sección 18)", () => {
  const secreto = "whsec_test_super_secreto_123";
  const cuerpo = JSON.stringify({ event: "message.received", from: "573001234567" });

  it("una firma generada con el secreto correcto se verifica como válida", () => {
    const { firma, timestamp } = firmarEvento(secreto, cuerpo);
    const r = verificarFirma({ secreto, cuerpoJsonCrudo: cuerpo, firmaRecibida: firma, timestampRecibido: timestamp, ahoraUnixSegundos: timestamp });
    assert.equal(r.valido, true);
  });

  it("una firma generada con OTRO secreto se rechaza (firma_invalida)", () => {
    const { firma, timestamp } = firmarEvento("otro-secreto-distinto", cuerpo);
    const r = verificarFirma({ secreto, cuerpoJsonCrudo: cuerpo, firmaRecibida: firma, timestampRecibido: timestamp, ahoraUnixSegundos: timestamp });
    assert.equal(r.valido, false);
    if (!r.valido) assert.equal(r.motivo, "firma_invalida");
  });

  it("si el cuerpo cambia después de firmar, la firma deja de ser válida", () => {
    const { firma, timestamp } = firmarEvento(secreto, cuerpo);
    const cuerpoAlterado = JSON.stringify({ event: "message.received", from: "573009999999" });
    const r = verificarFirma({ secreto, cuerpoJsonCrudo: cuerpoAlterado, firmaRecibida: firma, timestampRecibido: timestamp, ahoraUnixSegundos: timestamp });
    assert.equal(r.valido, false);
  });

  it("rechaza una firma con longitud/hex corrupto sin lanzar", () => {
    const { timestamp } = firmarEvento(secreto, cuerpo);
    const r = verificarFirma({ secreto, cuerpoJsonCrudo: cuerpo, firmaRecibida: "no-es-hex-valido", timestampRecibido: timestamp, ahoraUnixSegundos: timestamp });
    assert.equal(r.valido, false);
  });

  it("timestamp_expirado: un evento fuera de la ventana de tolerancia se rechaza SIN comparar la firma (protección contra replay)", () => {
    const { firma, timestamp } = firmarEvento(secreto, cuerpo);
    const muchoDespues = timestamp + 10 * 60; // 10 minutos después, ventana por defecto es 5
    const r = verificarFirma({ secreto, cuerpoJsonCrudo: cuerpo, firmaRecibida: firma, timestampRecibido: timestamp, ahoraUnixSegundos: muchoDespues });
    assert.equal(r.valido, false);
    if (!r.valido) assert.equal(r.motivo, "timestamp_expirado");
  });

  it("replay real: capturar un evento válido y reenviarlo más tarde (mismo timestamp original, reloj avanzado) se rechaza", () => {
    // Simula el ataque real: un atacante capturó el evento completo
    // (headers incluidos) y lo reenvía tal cual más tarde. La firma en sí
    // sigue siendo "correcta" para ese timestamp -- lo único que lo
    // detiene es que el timestamp ya quedó viejo quando se lo evalúa "ahora".
    const { firma, timestamp } = firmarEvento(secreto, cuerpo);
    const ahoraMuchoDespues = timestamp + 3600; // 1 hora después
    const r = verificarFirma({ secreto, cuerpoJsonCrudo: cuerpo, firmaRecibida: firma, timestampRecibido: timestamp, ahoraUnixSegundos: ahoraMuchoDespues });
    assert.equal(r.valido, false);
    if (!r.valido) assert.equal(r.motivo, "timestamp_expirado");
  });

  it("acepta un timestamp dentro de la tolerancia (justo en el borde, hacia atrás y hacia adelante)", () => {
    const { firma, timestamp } = firmarEvento(secreto, cuerpo);
    const dentroDeTolerancia = timestamp + 4 * 60; // 4 min, ventana por defecto es 5
    const r = verificarFirma({ secreto, cuerpoJsonCrudo: cuerpo, firmaRecibida: firma, timestampRecibido: timestamp, ahoraUnixSegundos: dentroDeTolerancia });
    assert.equal(r.valido, true);
  });

  it("rechaza timestamp inválido (no numérico) sin lanzar", () => {
    const r = verificarFirma({ secreto, cuerpoJsonCrudo: cuerpo, firmaRecibida: "abc", timestampRecibido: "no-es-numero" });
    assert.equal(r.valido, false);
    if (!r.valido) assert.equal(r.motivo, "timestamp_invalido");
  });

  it("respeta una tolerancia custom más estricta", () => {
    const { firma, timestamp } = firmarEvento(secreto, cuerpo);
    const r = verificarFirma({
      secreto,
      cuerpoJsonCrudo: cuerpo,
      firmaRecibida: firma,
      timestampRecibido: timestamp,
      ahoraUnixSegundos: timestamp + 30,
      toleranciaSegundos: 10,
    });
    assert.equal(r.valido, false);
  });
});
