import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OPCIONES_CONFIRMACION,
  renderizarResumenConfirmacion,
  textoSeleccionInvalidaConfirmacion,
  resolverSeleccionConfirmacion,
  type ResumenCitaAgendaV2,
} from "@/lib/agenda-v2/confirmacion";

const RESUMEN: ResumenCitaAgendaV2 = {
  servicioNombre: "Sombreado de Cejas",
  servicioPrecio: 30000,
  servicioDuracionMin: 30,
  profesionalNombre: "Jessica",
  fechaEtiqueta: "Miércoles 9 de septiembre",
  horaTexto: "3:00 p. m.",
};

describe("OPCIONES_CONFIRMACION -- menú de control fijo, siempre las mismas 4 opciones", () => {
  it("1=confirmar, 2=cambiar_fecha, 3=cambiar_hora, 4=cancelar, en ese orden exacto", () => {
    assert.deepEqual(OPCIONES_CONFIRMACION, [
      { numero: 1, accion: "confirmar" },
      { numero: 2, accion: "cambiar_fecha" },
      { numero: 3, accion: "cambiar_hora" },
      { numero: 4, accion: "cancelar" },
    ]);
  });
});

describe("renderizarResumenConfirmacion -- EXCLUSIVAMENTE los datos reales recibidos, nunca hardcodeados", () => {
  it("incluye servicio, profesional, fecha, hora, duración y valor reales, más el menú de control", () => {
    const texto = renderizarResumenConfirmacion(RESUMEN);
    assert.match(texto, /Estos son los datos de tu cita/);
    assert.match(texto, /Servicio: Sombreado de Cejas/);
    assert.match(texto, /Profesional: Jessica/);
    assert.match(texto, /Fecha: Miércoles 9 de septiembre/);
    assert.match(texto, /Hora: 3:00 p\. m\./);
    assert.match(texto, /Duración: 30 min/);
    assert.match(texto, /Valor: \$30\.000/);
    assert.match(texto, /¿Deseas confirmar tu cita\?/);
    assert.match(texto, /1\. Confirmar cita/);
    assert.match(texto, /2\. Cambiar fecha/);
    assert.match(texto, /3\. Cambiar horario/);
    assert.match(texto, /4\. Cancelar/);
  });

  it("con otro servicio/profesional/fecha/hora reales, el resumen cambia en consecuencia (nunca queda fijo)", () => {
    const otro: ResumenCitaAgendaV2 = {
      servicioNombre: "Dipping",
      servicioPrecio: 60000,
      servicioDuracionMin: 120,
      profesionalNombre: "Mary",
      fechaEtiqueta: "Martes 8 de septiembre",
      horaTexto: "9:00 a. m.",
    };
    const texto = renderizarResumenConfirmacion(otro);
    assert.match(texto, /Servicio: Dipping/);
    assert.match(texto, /Profesional: Mary/);
    assert.match(texto, /Fecha: Martes 8 de septiembre/);
    assert.match(texto, /Hora: 9:00 a\. m\./);
    assert.match(texto, /Duración: 2 h/);
    assert.match(texto, /Valor: \$60\.000/);
    assert.doesNotMatch(texto, /Sombreado de Cejas|Jessica/, "nunca debe mezclar datos de un resumen anterior");
  });
});

describe("textoSeleccionInvalidaConfirmacion -- reenvía EXACTAMENTE el mismo menú de control fijo", () => {
  it("incluye las 4 opciones", () => {
    const texto = textoSeleccionInvalidaConfirmacion();
    assert.match(texto, /No reconocí esa opción/);
    assert.match(texto, /1\. Confirmar cita/);
    assert.match(texto, /2\. Cambiar fecha/);
    assert.match(texto, /3\. Cambiar horario/);
    assert.match(texto, /4\. Cancelar/);
  });
});

describe("resolverSeleccionConfirmacion -- SOLO número exacto (1-4), nunca fuzzy ni interpretación semántica", () => {
  it("cada número exacto resuelve la acción correspondiente", () => {
    assert.equal(resolverSeleccionConfirmacion("1", OPCIONES_CONFIRMACION)?.accion, "confirmar");
    assert.equal(resolverSeleccionConfirmacion("2", OPCIONES_CONFIRMACION)?.accion, "cambiar_fecha");
    assert.equal(resolverSeleccionConfirmacion("3", OPCIONES_CONFIRMACION)?.accion, "cambiar_hora");
    assert.equal(resolverSeleccionConfirmacion("4", OPCIONES_CONFIRMACION)?.accion, "cancelar");
  });

  it("número con espacios alrededor también resuelve", () => {
    assert.equal(resolverSeleccionConfirmacion("  1  ", OPCIONES_CONFIRMACION)?.accion, "confirmar");
  });

  it("número fuera de rango -> undefined", () => {
    assert.equal(resolverSeleccionConfirmacion("5", OPCIONES_CONFIRMACION), undefined);
    assert.equal(resolverSeleccionConfirmacion("0", OPCIONES_CONFIRMACION), undefined);
    assert.equal(resolverSeleccionConfirmacion("999", OPCIONES_CONFIRMACION), undefined);
  });

  it("texto no numérico o interpretación semántica ('sí', 'dale', 'confirmo', 'cancelar') -> siempre undefined, nunca se infiere", () => {
    for (const texto of ["sí", "si", "dale", "confirmo", "ok", "cancelar", "no", "uno", "1 por favor"]) {
      assert.equal(resolverSeleccionConfirmacion(texto, OPCIONES_CONFIRMACION), undefined, `"${texto}" nunca debe resolver -- solo número exacto`);
    }
  });

  it("nunca extrae dígitos de en medio de un texto ('999abc', 'opción 1')", () => {
    assert.equal(resolverSeleccionConfirmacion("999abc", OPCIONES_CONFIRMACION), undefined);
    assert.equal(resolverSeleccionConfirmacion("opción 1", OPCIONES_CONFIRMACION), undefined);
  });
});
