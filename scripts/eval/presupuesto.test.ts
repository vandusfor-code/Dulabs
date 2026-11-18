/**
 * Tope de gasto y revisión previa de las evaluaciones con Gemini real (scripts/eval/presupuesto.ts). Puro: sin red, sin archivos, sin llamar a ningún modelo.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROMEDIOS_POR_TURNO, crearPresupuesto, estimarCorrida, leerOpcionesPresupuesto, mensajeDeCanarioFallido, textoDeEstimacion, type UsoDeTurno } from "./presupuesto";

const turno = (input: number, output: number, thinking = 0, rounds = 2, retries = 0): UsoDeTurno => ({ usage: { input, output, thinking }, rounds, retries });

describe("opciones de la línea de comandos", () => {
  it("sin opciones: sin tope, sin estimar", () => {
    assert.deepEqual(leerOpcionesPresupuesto(["node", "script", "--real", "2"]), { maxTokens: null, maxLlamadas: null, estimar: false, precioEntrada: null, precioSalida: null });
  });

  it("lee los topes, --estimar y los precios", () => {
    const o = leerOpcionesPresupuesto(["--real", "3", "--presupuesto-tokens", "250000", "--max-llamadas", "120", "--estimar", "--precio-entrada", "0.3", "--precio-salida", "2.5"]);
    assert.deepEqual(o, { maxTokens: 250_000, maxLlamadas: 120, estimar: true, precioEntrada: 0.3, precioSalida: 2.5 });
  });

  it("un valor que no es un número positivo se ignora (nunca deja un tope en 0, negativo o NaN)", () => {
    for (const malo of ["0", "-5", "abc", "", "NaN", "Infinity"]) {
      const o = leerOpcionesPresupuesto(["--presupuesto-tokens", malo, "--max-llamadas", malo]);
      assert.equal(o.maxTokens, null, malo);
      assert.equal(o.maxLlamadas, null, malo);
    }
    assert.equal(leerOpcionesPresupuesto(["--presupuesto-tokens"]).maxTokens, null, "sin valor");
  });
});

describe("presupuesto de una corrida", () => {
  it("sin topes nunca se excede, por mucho que se gaste", () => {
    const p = crearPresupuesto({ maxTokens: null, maxLlamadas: null });
    for (let i = 0; i < 100; i++) p.registrar(turno(10_000, 500, 200));
    assert.equal(p.excedido(), null);
    assert.deepEqual(p.gastado(), { tokens: 100 * 10_700, llamadas: 200 });
  });

  it("suma entrada + salida + pensamiento, y las llamadas con sus reintentos", () => {
    const p = crearPresupuesto({ maxTokens: null, maxLlamadas: null });
    p.registrar(turno(7_000, 300, 100, 2, 1));
    p.registrar(turno(6_000, 200, 0, 1, 0));
    assert.deepEqual(p.gastado(), { tokens: 7_000 + 300 + 100 + 6_000 + 200, llamadas: 4 });
  });

  it("el tope de tokens: por debajo sigue; al llegar o pasarse se detiene y dice cuánto", () => {
    const p = crearPresupuesto({ maxTokens: 20_000, maxLlamadas: null });
    p.registrar(turno(9_000, 500));
    assert.equal(p.excedido(), null);
    p.registrar(turno(9_000, 1_500));
    assert.match(p.excedido() ?? "", /^tokens 20\.000 de 20\.000$/, "justo en el tope ya cuenta como agotado");
    p.registrar(turno(5_000, 0));
    assert.match(p.excedido() ?? "", /^tokens 25\.000 de 20\.000$/);
  });

  it("el tope de llamadas, aparte del de tokens", () => {
    const p = crearPresupuesto({ maxTokens: null, maxLlamadas: 5 });
    p.registrar(turno(100, 10, 0, 2, 0));
    p.registrar(turno(100, 10, 0, 2, 0));
    assert.equal(p.excedido(), null);
    p.registrar(turno(100, 10, 0, 1, 0));
    assert.equal(p.excedido(), "llamadas 5 de 5");
  });

  it("con los dos topes se avisa del primero que se pase", () => {
    const p = crearPresupuesto({ maxTokens: 1_000, maxLlamadas: 1 });
    p.registrar(turno(5_000, 0, 0, 3, 0));
    assert.match(p.excedido() ?? "", /^tokens /);
  });

  it("valores negativos o raros de la traza no restan ni rompen la cuenta", () => {
    const p = crearPresupuesto({ maxTokens: 100, maxLlamadas: null });
    p.registrar({ usage: { input: -50, output: 10, thinking: 0 }, rounds: -1, retries: 0 });
    assert.deepEqual(p.gastado(), { tokens: 10, llamadas: 0 });
  });
});

describe("estimación previa (sin llamar a nadie)", () => {
  it("escala con los turnos y las repeticiones, con los promedios medidos del agente", () => {
    const e = estimarCorrida({ turnos: 100, repeticiones: 2 });
    assert.equal(e.turnos, 200);
    assert.equal(e.llamadas, Math.round(200 * PROMEDIOS_POR_TURNO.llamadas));
    assert.equal(e.tokensEntrada, e.llamadas * PROMEDIOS_POR_TURNO.entrada);
    assert.equal(e.tokensSalida, e.llamadas * PROMEDIOS_POR_TURNO.salida);
    assert.equal(e.tokens, e.tokensEntrada + e.tokensSalida);
    assert.equal(e.usd, null, "sin precios no se inventa un costo");
  });

  it("con los dos precios calcula el costo en USD", () => {
    const e = estimarCorrida({ turnos: 1_000, repeticiones: 1, precioEntrada: 1, precioSalida: 4 });
    const esperado = (e.tokensEntrada / 1e6) * 1 + (e.tokensSalida / 1e6) * 4;
    assert.ok(e.usd !== null && Math.abs(e.usd - esperado) < 1e-9);
  });

  it("con un solo precio tampoco se inventa un costo; repeticiones < 1 cuentan como 1; sin turnos = 0", () => {
    assert.equal(estimarCorrida({ turnos: 10, repeticiones: 1, precioEntrada: 1 }).usd, null);
    assert.equal(estimarCorrida({ turnos: 10, repeticiones: 0 }).turnos, 10);
    assert.deepEqual(estimarCorrida({ turnos: 0, repeticiones: 3 }).tokens, 0);
  });

  it("el texto dice cuántos casos, turnos, llamadas y tokens, y cómo acotar el gasto", () => {
    const e = estimarCorrida({ turnos: 80, repeticiones: 2 });
    const t = textoDeEstimacion(e, { casos: 60, repeticiones: 2 });
    assert.match(t, /NO se llamó a nadie/);
    assert.match(t, /60 caso\(s\) × 2 corrida\(s\)/);
    assert.match(t, /--presupuesto-tokens/);
    assert.match(t, /--max-llamadas/);
    assert.match(t, /--precio-entrada/, "sin precios, cómo ver el costo");
    const conCosto = textoDeEstimacion(estimarCorrida({ turnos: 80, repeticiones: 2, precioEntrada: 1, precioSalida: 4 }), { casos: 60, repeticiones: 2 });
    assert.match(conCosto, /US\$ \d+\.\d{2}/);
    assert.doesNotMatch(conCosto, /Para ver el costo/);
  });
});

describe("la llamada de prueba (canario) fallida", () => {
  it("sin saldo: lo dice claro, que no se gastó nada y qué hacer", () => {
    const m = mensajeDeCanarioFallido("quota");
    assert.match(m, /NO hay saldo/);
    assert.match(m, /Nada se gastó/);
    assert.match(m, /recarga/i);
  });

  it("clave rechazada, pico de peticiones, caída de red o servicio y cualquier otra causa", () => {
    assert.match(mensajeDeCanarioFallido("auth"), /rechazó la clave/);
    assert.match(mensajeDeCanarioFallido("rate_limit"), /--pausa/);
    for (const k of ["timeout", "server", "network"]) assert.match(mensajeDeCanarioFallido(k), new RegExp(k));
    assert.match(mensajeDeCanarioFallido("model_invalid_output"), /model_invalid_output/);
    assert.match(mensajeDeCanarioFallido(null), /sin rondas/);
    assert.match(mensajeDeCanarioFallido(undefined), /sin rondas/);
  });
});
