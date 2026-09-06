import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectarEspecialistaMencionada,
  extraerFechaMencionada,
  extraerHoraOBloqueMencionado,
  esConfirmacionExplicitaDeReserva,
  esCancelacionExplicitaDeReserva,
} from "@/lib/bot-escenarios/agendamiento-entidades";

const ESPECIALISTAS = [
  { id: 1, nombre: "Mary" },
  { id: 2, nombre: "Cristal" },
  { id: 3, nombre: "Nata" },
  { id: 4, nombre: "Jessica" },
];

const HOY = "2026-09-07"; // lunes real (ver proximoDiaSemana en otros tests de esta suite)

describe("detectarEspecialistaMencionada", () => {
  it("detecta el nombre en cualquier parte del mensaje", () => {
    assert.deepEqual(detectarEspecialistaMencionada("quiero dipping el viernes a las 4 con Mary", ESPECIALISTAS), { id: 1, nombre: "Mary" });
  });
  it("no detecta nada si ninguna profesional real se menciona", () => {
    assert.equal(detectarEspecialistaMencionada("quiero dipping el viernes", ESPECIALISTAS), undefined);
  });
  it("es insensible a mayúsculas", () => {
    assert.deepEqual(detectarEspecialistaMencionada("con cristal", ESPECIALISTAS), { id: 2, nombre: "Cristal" });
  });
});

describe("extraerFechaMencionada", () => {
  it("'el viernes' en medio de una frase se resuelve igual que solo", () => {
    const r = extraerFechaMencionada("quiero dipping el viernes a las 4 con Mary", HOY);
    assert.ok(r?.ok);
  });
  it("'mañana' se detecta y resuelve", () => {
    const r = extraerFechaMencionada("quiero una cita mañana", HOY);
    assert.ok(r?.ok);
  });
  it("sin ninguna palabra de fecha -> undefined (nunca inventa)", () => {
    assert.equal(extraerFechaMencionada("quiero dipping", HOY), undefined);
  });
  it("'4 de septiembre' se detecta", () => {
    const r = extraerFechaMencionada("quiero una cita el 4 de septiembre", "2026-09-01");
    assert.ok(r?.ok);
    if (r?.ok) assert.equal(r.fecha, "2026-09-04");
  });
});

describe("extraerHoraOBloqueMencionado", () => {
  it("'a las 4' con periodo -> hora exacta 16:00 (viene con 'de la tarde')", () => {
    const r = extraerHoraOBloqueMencionado("el viernes a las 4 de la tarde");
    assert.equal(r?.tipo, "hora");
    if (r?.tipo === "hora") assert.equal(r.resultado.ok && r.resultado.hhmm, "16:00");
  });
  it("'tipo 4' se trata como 'a las 4' (sin periodo -> ambiguo, nunca inventa)", () => {
    const r = extraerHoraOBloqueMencionado("el viernes tipo 4");
    assert.equal(r?.tipo, "hora");
    if (r?.tipo === "hora") assert.equal(r.resultado.ok, false);
  });
  it("'en la tarde' sin hora numérica -> bloque", () => {
    const r = extraerHoraOBloqueMencionado("el viernes en la tarde");
    assert.deepEqual(r, { tipo: "bloque", bloque: "tarde" });
  });
  it("'en la mañana' -> bloque mañana", () => {
    const r = extraerHoraOBloqueMencionado("el viernes en la mañana");
    assert.deepEqual(r, { tipo: "bloque", bloque: "manana" });
  });
  it("sin ninguna mención de hora -> undefined", () => {
    assert.equal(extraerHoraOBloqueMencionado("quiero dipping el viernes"), undefined);
  });
  it("BUG REAL (autorizado): 'una' en 'quiero UNA cita' es un artículo, NUNCA una hora -- nunca debe confundirse con 'una'=1 de parseHoraColombia", () => {
    assert.equal(extraerHoraOBloqueMencionado("quiero agendar una cita"), undefined);
    assert.equal(extraerHoraOBloqueMencionado("quiero una cita el viernes"), undefined);
  });
  it("'16:00' formato 24h directo", () => {
    const r = extraerHoraOBloqueMencionado("el viernes a las 16:00");
    assert.equal(r?.tipo, "hora");
    if (r?.tipo === "hora") assert.equal(r.resultado.ok && r.resultado.hhmm, "16:00");
  });
});

describe("confirmación/cancelación -- vocabulario cerrado, EXACTO", () => {
  it("confirmaciones reales", () => {
    for (const msg of ["Sí", "sí, resérvala", "Confirmo", "Agéndamela", "Sí quiero", "dale"]) {
      assert.equal(esConfirmacionExplicitaDeReserva(msg), true, `"${msg}" debía contar como confirmación`);
    }
  });
  it("NUNCA confirma con frases ambiguas (regla explícita del pedido)", () => {
    for (const msg of ["creo que sí", "esa está bien", "me gusta", "cuánto cuesta"]) {
      assert.equal(esConfirmacionExplicitaDeReserva(msg), false, `"${msg}" NO debía contar como confirmación`);
    }
  });
  it("cancelaciones reales", () => {
    for (const msg of ["no", "cancela", "olvídalo", "ya no quiero"]) {
      assert.equal(esCancelacionExplicitaDeReserva(msg), true);
    }
  });
});
