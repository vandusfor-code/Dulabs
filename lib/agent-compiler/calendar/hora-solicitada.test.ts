/**
 * La hora de una cita la fija el backend desde lo que escribió el cliente; la propuesta de la IA solo se acepta si la
 * respaldan la lista ofrecida o los números del cliente. Puro.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolverHoraSolicitada } from "@/lib/agent-compiler/calendar/hora-solicitada";

const OFRECIDOS = ["08:00", "09:00", "10:00", "15:00"];

describe("resolverHoraSolicitada", () => {
  it("1. hora explícita del cliente manda sobre la propuesta de la IA", () => {
    const r = resolverHoraSolicitada({ solicitudTexto: "a las 10 de la mañana", horaPropuesta: "15:00", horariosOfrecidos: OFRECIDOS });
    assert.deepEqual(r, { ok: true, hora: "10:00", origen: "cliente" });
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "3 pm", horaPropuesta: "08:00" }), { ok: true, hora: "15:00", origen: "cliente" });
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "15:30", horaPropuesta: "09:00" }), { ok: true, hora: "15:30", origen: "cliente" });
  });

  it("2. elección INEQUÍVOCA por posición ('la segunda', 'la última', 'opción 3'): la hora sale de la LISTA, gane lo que gane la IA", () => {
    // Aunque la IA proponga otra hora (incluso una inventada), manda la posición que eligió el cliente.
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "la segunda", horaPropuesta: "09:00", horariosOfrecidos: OFRECIDOS }), { ok: true, hora: "09:00", origen: "lista" });
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "la segunda", horaPropuesta: "23:00", horariosOfrecidos: OFRECIDOS }), { ok: true, hora: "09:00", origen: "lista" });
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "La última.", horaPropuesta: "08:00", horariosOfrecidos: OFRECIDOS }), { ok: true, hora: "15:00", origen: "lista" });
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "opción 3", horaPropuesta: "08:00", horariosOfrecidos: OFRECIDOS }), { ok: true, hora: "10:00", origen: "lista" });
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "la 1", horaPropuesta: "23:00", horariosOfrecidos: OFRECIDOS }), { ok: true, hora: "08:00", origen: "lista" });
    // Posición fuera de la lista: no se inventa una hora.
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "la quinta", horaPropuesta: "15:00", horariosOfrecidos: OFRECIDOS }).ok, false);
  });

  it("2c. un número SUELTO ('2') es posición u hora: la propuesta de la IA debe ser coherente con alguna de las dos lecturas", () => {
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "2", horaPropuesta: "09:00", horariosOfrecidos: OFRECIDOS }), { ok: true, hora: "09:00", origen: "propuesta_validada" }, "posición 2");
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "10", horaPropuesta: "10:00", horariosOfrecidos: OFRECIDOS }), { ok: true, hora: "10:00", origen: "propuesta_validada" }, "hora 10");
    // La IA convierte el "2" en una hora que ni es la posición 2 ni las 2: rechazada (aunque esté en la lista).
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "2", horaPropuesta: "10:00", horariosOfrecidos: OFRECIDOS }), { ok: false, motivo: "hora_invalida" });
    // ...y no puede inventar una hora que no estaba ofrecida.
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "2", horaPropuesta: "14:00", horariosOfrecidos: OFRECIDOS }), { ok: false, motivo: "hora_invalida" });
  });

  it("2b. la lista ofrecida es una MUESTRA: una hora que el cliente expresó ('a las 3pm') se acepta aunque no esté listada", () => {
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "A las 3pm", horaPropuesta: "15:00", horariosOfrecidos: ["08:00", "08:30"] }), { ok: true, hora: "15:00", origen: "cliente" });
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "a las 3", horaPropuesta: "15:00", horariosOfrecidos: ["08:00", "08:30"] }), { ok: true, hora: "15:00", origen: "propuesta_validada" });
    // ...pero la IA no puede cambiar la hora que el cliente dijo.
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "a las 3", horaPropuesta: "08:00", horariosOfrecidos: ["09:00"] }), { ok: false, motivo: "hora_invalida" });
  });

  it("3. sin lista ofrecida: la propuesta necesita respaldo en los números del cliente (12h o 24h)", () => {
    assert.equal(resolverHoraSolicitada({ solicitudTexto: "el sábado a las 10 de la mañana", horaPropuesta: "10:00" }).ok, true);
    assert.equal(resolverHoraSolicitada({ solicitudTexto: "el sábado a las 3", horaPropuesta: "15:00" }).ok, true, "15:00 se respalda con el '3' del cliente");
    assert.equal(resolverHoraSolicitada({ solicitudTexto: "el sábado a las diez", horaPropuesta: "10:00" }).ok, true, "números en letras");
    // La IA inventa una hora que el cliente no dijo: rechazada.
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "el sábado a las 10 de la mañana", horaPropuesta: "16:00" }), { ok: false, motivo: "hora_invalida" });
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "el sábado por la tarde", horaPropuesta: "15:00" }), { ok: false, motivo: "hora_invalida" }, "el cliente no dio ninguna hora");
  });

  it("3b. el cliente NO eligió nada ('cuéntame un chiste', su nombre): la IA no puede reservar una hora aunque esté en la lista", () => {
    for (const t of ["cuéntame un chiste", "Ana Pérez", "no sé", "lo que tengas"]) {
      assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: t, horaPropuesta: "10:00", horariosOfrecidos: OFRECIDOS }), { ok: false, motivo: "hora_invalida" }, t);
    }
  });

  it("4. propuesta ausente o con formato inválido => hora_invalida", () => {
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "cuando abran" }), { ok: false, motivo: "hora_invalida" });
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "la primera", horaPropuesta: "mañana" }), { ok: false, motivo: "hora_invalida" });
    // Una elección por posición no depende de la propuesta de la IA: aunque venga mal formada, la hora sale de la lista.
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "la primera", horaPropuesta: "25:00", horariosOfrecidos: OFRECIDOS }), { ok: true, hora: "08:00", origen: "lista" });
  });

  it("5. hora propuesta sin cero inicial se normaliza ('9:00' -> '09:00')", () => {
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "la segunda", horaPropuesta: "9:00", horariosOfrecidos: OFRECIDOS }), { ok: true, hora: "09:00", origen: "lista" });
    // Con un texto ambiguo, la propuesta sin cero inicial se normaliza antes de validarla.
    assert.deepEqual(resolverHoraSolicitada({ solicitudTexto: "a las 3", horaPropuesta: "9:00", horariosOfrecidos: ["09:00"] }), { ok: false, motivo: "hora_invalida" });
  });
});
