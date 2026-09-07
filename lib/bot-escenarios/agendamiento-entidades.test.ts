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

  // Corrección (autorizada, rediseño arquitectónico agendamiento) -- bug
  // real: "manana" está declarada antes que los días de la semana en
  // PALABRAS_FECHA_DIRECTAS, así que un mensaje con AMBAS ("el sábado en la
  // mañana") resolvía a MAÑANA (día siguiente) en vez de a SÁBADO, sin
  // importar cuál aparecía primero en el mensaje real de la clienta.
  it("'el sábado en la mañana' -- resuelve SÁBADO, nunca 'mañana' (bug real corregido)", () => {
    const r = extraerFechaMencionada("el sábado en la mañana", HOY); // HOY=lunes 2026-09-07
    assert.ok(r?.ok);
    if (r?.ok) assert.equal(r.fecha, "2026-09-12"); // próximo sábado real
  });

  it("'mañana' seguida de una hora en el MISMO mensaje sigue resolviendo 'mañana' (día siguiente)", () => {
    const r = extraerFechaMencionada("quiero dipping mañana a las 8 am", HOY);
    assert.ok(r?.ok);
    if (r?.ok) assert.equal(r.fecha, "2026-09-08"); // día siguiente a HOY=2026-09-07
  });

  it("'en la mañana' SOLA (sin ningún otro dato de fecha) -- nunca se confunde con 'mañana' (bloque horario, no fecha)", () => {
    assert.equal(extraerFechaMencionada("en la mañana", HOY), undefined);
  });

  it("'el viernes' aparece ANTES que 'mañana' en el mensaje -- gana el viernes (orden real del mensaje, no el orden fijo de la lista)", () => {
    const r = extraerFechaMencionada("el viernes por la mañana estaría perfecto", HOY);
    assert.ok(r?.ok);
    if (r?.ok) assert.equal(r.fecha, "2026-09-11"); // próximo viernes real desde lunes 2026-09-07
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
  // Revisión (autorizada) -- formas naturales adicionales dirigidas a una
  // opción ya ofrecida ("esa"), pedidas explícitamente: deben reconocerse
  // sin volver el vocabulario difuso (siguen siendo coincidencia EXACTA).
  it("confirmaciones naturales dirigidas a una opción ya ofrecida ('esa')", () => {
    for (const msg of ["Perfecto, esa", "Sí, esa me sirve", "Quiero esa"]) {
      assert.equal(esConfirmacionExplicitaDeReserva(msg), true, `"${msg}" debía contar como confirmación`);
    }
  });
  it("NUNCA confirma con frases ambiguas (regla explícita del pedido)", () => {
    for (const msg of [
      "creo que sí",
      "esa está bien",
      "me gusta",
      "cuánto cuesta",
      "Está bonita",
      "¿Y esa cuánto cuesta?",
      "Déjame pensarlo",
    ]) {
      assert.equal(esConfirmacionExplicitaDeReserva(msg), false, `"${msg}" NO debía contar como confirmación`);
    }
  });
  it("cancelaciones reales", () => {
    for (const msg of ["no", "cancela", "olvídalo", "ya no quiero"]) {
      assert.equal(esCancelacionExplicitaDeReserva(msg), true);
    }
  });
});
