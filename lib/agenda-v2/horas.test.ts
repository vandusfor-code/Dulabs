import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { construirOpcionesHora, renderizarMenuHora, textoSeleccionInvalidaHora, resolverSeleccionHora, MAX_OPCIONES_HORA } from "@/lib/agenda-v2/horas";

const FECHA = "2026-09-08";

describe("construirOpcionesHora -- exclusivamente los horarios reales ya calculados, nunca inventados", () => {
  it("numera en orden cronológico y conserva fechaIso + hora reales", () => {
    const opciones = construirOpcionesHora(FECHA, ["09:00", "10:30", "14:00"]);
    assert.deepEqual(
      opciones.map((o) => [o.numero, o.fechaIso, o.hora]),
      [
        [1, FECHA, "09:00"],
        [2, FECHA, "10:30"],
        [3, FECHA, "14:00"],
      ],
    );
  });

  it("Test obligatorio -- máximo 6 opciones: con más de 6 horarios reales, toma las primeras 6 en orden cronológico", () => {
    const horarios = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"];
    const opciones = construirOpcionesHora(FECHA, horarios);
    assert.equal(opciones.length, MAX_OPCIONES_HORA);
    assert.deepEqual(
      opciones.map((o) => o.hora),
      ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00"],
    );
  });

  it("lista vacía -> opciones vacías, nunca inventa un horario", () => {
    assert.deepEqual(construirOpcionesHora(FECHA, []), []);
  });
});

describe("renderizarMenuHora / textoSeleccionInvalidaHora -- texto siempre reconstruido desde datos reales, formato AM/PM", () => {
  it("incluye el encabezado, cada horario numerado en formato AM/PM, y la instrucción final", () => {
    const texto = renderizarMenuHora(construirOpcionesHora(FECHA, ["09:00", "10:30", "14:00", "16:30"]));
    assert.match(texto, /Estos son los horarios disponibles:/);
    assert.match(texto, /1\. 9:00 a\. m\./);
    assert.match(texto, /2\. 10:30 a\. m\./);
    assert.match(texto, /3\. 2:00 p\. m\./);
    assert.match(texto, /4\. 4:30 p\. m\./);
    assert.match(texto, /Selecciona el horario que prefieras\./);
  });

  it("el texto de selección inválida reenvía EXACTAMENTE las mismas opciones, sin reordenar", () => {
    const opciones = construirOpcionesHora(FECHA, ["09:00", "14:00"]);
    const texto = textoSeleccionInvalidaHora(opciones);
    assert.match(texto, /No reconocí esa opción/);
    assert.match(texto, /1\. 9:00 a\. m\./);
    assert.match(texto, /2\. 2:00 p\. m\./);
  });
});

describe("resolverSeleccionHora -- SOLO número exacto contra las opciones ya mostradas, nunca fuzzy ni texto libre", () => {
  const OPCIONES = construirOpcionesHora(FECHA, ["09:00", "10:30", "14:00"]);

  it("número exacto resuelve el horario real correspondiente", () => {
    assert.equal(resolverSeleccionHora("1", OPCIONES)?.hora, "09:00");
    assert.equal(resolverSeleccionHora("3", OPCIONES)?.hora, "14:00");
  });

  it("número con espacios alrededor también resuelve", () => {
    assert.equal(resolverSeleccionHora("  2  ", OPCIONES)?.hora, "10:30");
  });

  it("número fuera de rango -> undefined, nunca aproxima a la más cercana", () => {
    assert.equal(resolverSeleccionHora("999", OPCIONES), undefined);
    assert.equal(resolverSeleccionHora("0", OPCIONES), undefined);
  });

  it("texto no numérico, incluido un horario real en texto libre ('9 am', 'las 2 pm') -> siempre undefined", () => {
    for (const texto of ["hola", "9 am", "las 2 pm", "no sé", "1 por favor", "uno"]) {
      assert.equal(resolverSeleccionHora(texto, OPCIONES), undefined, `"${texto}" nunca debe resolver -- solo número exacto`);
    }
  });

  it("nunca extrae dígitos de en medio de un texto ('999abc', 'opción 1')", () => {
    assert.equal(resolverSeleccionHora("999abc", OPCIONES), undefined);
    assert.equal(resolverSeleccionHora("opción 1", OPCIONES), undefined);
  });
});
