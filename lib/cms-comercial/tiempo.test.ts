/**
 * CMS comercial — tiempo y vigencia: hora de Bogotá, «hasta» inclusivo de todo el día, bordes exactos y fechas imposibles (fail-closed).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { esFechaLocalValida, estadoDeVigencia, fechaHoraLocalDeMs, fechaLocalDeMs, finExclusivoMs, inicioLocalMs, intervaloDe, vigenteAhora } from "@/lib/cms-comercial/tiempo";

const utc = (iso: string) => Date.parse(iso);

describe("fechas locales de Bogotá", () => {
  it("una fecha sola EMPIEZA a las 00:00 de Bogotá (05:00 UTC)", () => {
    assert.equal(inicioLocalMs("2026-10-25"), utc("2026-10-25T05:00:00.000Z"));
  });

  it("con hora se convierte con el desfase fijo de -5", () => {
    assert.equal(inicioLocalMs("2026-10-25T14:30"), utc("2026-10-25T19:30:00.000Z"));
    assert.equal(inicioLocalMs("2026-10-25T23:59"), utc("2026-10-26T04:59:00.000Z"));
  });

  it("«hasta» con fecha sola incluye TODO ese día: el límite exclusivo es la medianoche siguiente de Bogotá", () => {
    assert.equal(finExclusivoMs("2026-10-31"), utc("2026-11-01T05:00:00.000Z"));
    assert.equal(finExclusivoMs("2026-12-31"), utc("2027-01-01T05:00:00.000Z"));
    assert.equal(finExclusivoMs("2028-02-29"), utc("2028-03-01T05:00:00.000Z"));
  });

  it("«hasta» con hora es ese instante exacto, sin sumar un día", () => {
    assert.equal(finExclusivoMs("2026-10-31T18:00"), utc("2026-10-31T23:00:00.000Z"));
  });

  it("rechaza formatos raros y fechas que no existen (nunca las interpreta con generosidad)", () => {
    for (const malo of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "2026-10-00", "2026-1-1", "26-10-10", "2026-10-31T24:00", "2026-10-31T10:60", "2026-10-31 18:00", "2026-10-31T18:00:00Z", "", "hoy", "1999-12-31", "2101-01-01"]) {
      assert.equal(esFechaLocalValida(malo), false, malo);
      assert.equal(inicioLocalMs(malo), null, malo);
      assert.equal(finExclusivoMs(malo), null, malo);
    }
    for (const noTexto of [null, undefined, 20261031, {}, []]) assert.equal(esFechaLocalValida(noTexto), false);
  });

  it("acepta el 29 de febrero solo en año bisiesto", () => {
    assert.equal(esFechaLocalValida("2028-02-29"), true);
    assert.equal(esFechaLocalValida("2027-02-29"), false);
  });

  it("devuelve la fecha de Bogotá de un instante, incluso cerca de la medianoche", () => {
    assert.equal(fechaLocalDeMs(utc("2026-10-31T04:59:59.999Z")), "2026-10-30");
    assert.equal(fechaLocalDeMs(utc("2026-10-31T05:00:00.000Z")), "2026-10-31");
    assert.equal(fechaHoraLocalDeMs(utc("2026-10-31T23:00:00.000Z")), "2026-10-31T18:00");
  });
});

describe("estadoDeVigencia — intervalo [desde, hasta)", () => {
  const v = { desde: "2026-10-25", hasta: "2026-10-31" };
  const desde = utc("2026-10-25T05:00:00.000Z");
  const fin = utc("2026-11-01T05:00:00.000Z");

  it("un milisegundo antes de empezar: programada; justo al empezar: vigente", () => {
    assert.equal(estadoDeVigencia(v, desde - 1), "programada");
    assert.equal(estadoDeVigencia(v, desde), "vigente");
  });

  it("el último milisegundo del día final sigue vigente; el instante siguiente ya venció", () => {
    assert.equal(estadoDeVigencia(v, fin - 1), "vigente");
    assert.equal(estadoDeVigencia(v, fin), "vencida");
    assert.equal(estadoDeVigencia(v, fin + 86_400_000), "vencida");
  });

  it("«hasta el 31» vale a las 23:59 del 31 en Bogotá y ya no a las 00:00 del 1", () => {
    assert.equal(vigenteAhora(v, utc("2026-11-01T04:59:00.000Z")), true);
    assert.equal(vigenteAhora(v, utc("2026-11-01T05:00:00.000Z")), false);
  });

  it("con hora exacta, termina en ese instante", () => {
    const conHora = { desde: "2026-10-25T08:00", hasta: "2026-10-25T18:00" };
    assert.equal(estadoDeVigencia(conHora, utc("2026-10-25T22:59:59.999Z")), "vigente");
    assert.equal(estadoDeVigencia(conHora, utc("2026-10-25T23:00:00.000Z")), "vencida");
    assert.equal(estadoDeVigencia(conHora, utc("2026-10-25T12:59:59.999Z")), "programada");
  });

  it("sin límites: sin_limite y usable; solo desde: vigente para siempre tras empezar; solo hasta: vigente hasta terminar", () => {
    assert.equal(estadoDeVigencia({}, 0), "sin_limite");
    assert.equal(estadoDeVigencia(undefined, 0), "sin_limite");
    assert.equal(estadoDeVigencia({ desde: null, hasta: "" }, 0), "sin_limite");
    assert.equal(vigenteAhora({}, 123), true);
    assert.equal(estadoDeVigencia({ desde: "2026-10-25" }, desde - 1), "programada");
    assert.equal(estadoDeVigencia({ desde: "2026-10-25" }, desde + 10 * 365 * 86_400_000), "vigente");
    assert.equal(estadoDeVigencia({ hasta: "2026-10-31" }, 0), "vigente");
    assert.equal(estadoDeVigencia({ hasta: "2026-10-31" }, fin), "vencida");
  });

  it("fail-closed: fechas ilegibles o fin anterior al inicio NUNCA están vigentes", () => {
    assert.equal(vigenteAhora({ desde: "2026-02-30", hasta: "2026-10-31" }, desde + 1), false);
    assert.equal(vigenteAhora({ desde: "2026-10-25", hasta: "mañana" }, desde + 1), false);
    assert.equal(vigenteAhora({ desde: "2026-10-31", hasta: "2026-10-25" }, utc("2026-10-28T12:00:00.000Z")), false);
    assert.equal(estadoDeVigencia({ desde: "2026-10-25T10:00", hasta: "2026-10-25T10:00" }, utc("2026-10-25T15:00:00.000Z")), "vencida");
  });

  it("una vigencia invertida se informa como «vencida» también ANTES de llegar a cualquiera de sus fechas (nunca «programada»)", () => {
    const invertida = { desde: "2026-10-31", hasta: "2026-10-25" };
    assert.equal(estadoDeVigencia(invertida, utc("2026-10-01T12:00:00.000Z")), "vencida");
    assert.equal(estadoDeVigencia(invertida, utc("2026-10-28T12:00:00.000Z")), "vencida");
    assert.equal(estadoDeVigencia(invertida, utc("2026-12-01T12:00:00.000Z")), "vencida");
    assert.equal(estadoDeVigencia({ desde: "2026-10-31", hasta: "2026-10-31" }, utc("2026-10-01T12:00:00.000Z")), "programada", "una vigencia de un solo día sí está programada hasta que llegue");
  });

  it("intervaloDe devuelve null si algún extremo escrito no es válido", () => {
    assert.equal(intervaloDe({ desde: "2026-13-01" }), null);
    assert.deepEqual(intervaloDe({ desde: "2026-10-25", hasta: "2026-10-31" }), { desde, hasta: fin });
    assert.deepEqual(intervaloDe(undefined), { desde: null, hasta: null });
  });
});
