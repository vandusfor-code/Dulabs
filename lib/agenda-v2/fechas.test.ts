import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { construirOpcionesFecha, renderizarMenuFecha, textoSeleccionInvalidaFecha, resolverSeleccionFecha, formatearFechaLarga, esSeleccionVerMasFechas } from "@/lib/agenda-v2/fechas";

describe("formatearFechaLarga -- texto legible en español, hora Colombia", () => {
  it("día de la semana + día + mes, capitalizado, sin coma", () => {
    // 2026-09-08 es un martes real.
    assert.equal(formatearFechaLarga("2026-09-08"), "Martes 8 de septiembre");
  });

  it("sábado real", () => {
    // 2026-09-12 es un sábado real.
    assert.equal(formatearFechaLarga("2026-09-12"), "Sábado 12 de septiembre");
  });
});

describe("construirOpcionesFecha -- exclusivamente las fechas ya decididas como candidatas reales, nunca inventadas", () => {
  it("numera en orden y conserva cada fechaIso real", () => {
    const opciones = construirOpcionesFecha(["2026-09-08", "2026-09-09", "2026-09-12"]);
    assert.deepEqual(
      opciones.map((o) => [o.numero, o.fechaIso]),
      [
        [1, "2026-09-08"],
        [2, "2026-09-09"],
        [3, "2026-09-12"],
      ],
    );
    assert.equal(opciones[0]!.etiqueta, "Martes 8 de septiembre");
  });

  it("lista vacía -> opciones vacías, nunca inventa un día", () => {
    assert.deepEqual(construirOpcionesFecha([]), []);
  });
});

describe("renderizarMenuFecha / textoSeleccionInvalidaFecha -- texto siempre reconstruido desde datos reales", () => {
  it("incluye el encabezado y cada opción numerada", () => {
    const texto = renderizarMenuFecha(construirOpcionesFecha(["2026-09-08", "2026-09-09"]));
    assert.match(texto, /¿Qué día deseas agendar\?/);
    assert.match(texto, /1\. Martes 8 de septiembre/);
    assert.match(texto, /2\. Miércoles 9 de septiembre/);
  });

  it("el texto de selección inválida reenvía EXACTAMENTE las mismas fechas, sin reordenar", () => {
    const opciones = construirOpcionesFecha(["2026-09-08", "2026-09-12"]);
    const texto = textoSeleccionInvalidaFecha(opciones);
    assert.match(texto, /No reconocí esa opción/);
    assert.match(texto, /1\. Martes 8 de septiembre/);
    assert.match(texto, /2\. Sábado 12 de septiembre/);
  });
});

describe("resolverSeleccionFecha -- SOLO número exacto contra las opciones ya mostradas, nunca fuzzy ni texto libre", () => {
  const OPCIONES = construirOpcionesFecha(["2026-09-08", "2026-09-09", "2026-09-12"]);

  it("número exacto resuelve la fecha real correspondiente", () => {
    assert.equal(resolverSeleccionFecha("1", OPCIONES)?.fechaIso, "2026-09-08");
    assert.equal(resolverSeleccionFecha("3", OPCIONES)?.fechaIso, "2026-09-12");
  });

  it("número con espacios alrededor también resuelve", () => {
    assert.equal(resolverSeleccionFecha("  2  ", OPCIONES)?.fechaIso, "2026-09-09");
  });

  it("número fuera de rango -> undefined, nunca aproxima a la más cercana", () => {
    assert.equal(resolverSeleccionFecha("999", OPCIONES), undefined);
    assert.equal(resolverSeleccionFecha("0", OPCIONES), undefined);
  });

  it("texto no numérico, incluido el nombre real de un día ('el sábado', 'mañana') -> siempre undefined, nunca se interpreta como fecha", () => {
    for (const texto of ["hola", "el sábado", "mañana", "martes", "no sé", "1 por favor", "uno"]) {
      assert.equal(resolverSeleccionFecha(texto, OPCIONES), undefined, `"${texto}" nunca debe resolver -- solo número exacto`);
    }
  });

  it("nunca extrae dígitos de en medio de un texto ('999abc', 'opción 1')", () => {
    assert.equal(resolverSeleccionFecha("999abc", OPCIONES), undefined);
    assert.equal(resolverSeleccionFecha("opción 1", OPCIONES), undefined);
  });
});

describe("CORRECCIÓN (autorizada, 'Ver más fechas') -- render + selección del número especial", () => {
  it("Test 6 (obligatorio) -- con numeroVerMasFechas dado, el menú agrega 'N. Ver más fechas' DESPUÉS de las fechas reales", () => {
    const opciones = construirOpcionesFecha(["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-12"]);
    const texto = renderizarMenuFecha(opciones, 5);
    assert.match(texto, /4\. Sábado 12 de septiembre\n5\. Ver más fechas/);
  });

  it("Test 14 (obligatorio) -- sin numeroVerMasFechas (null), el menú NUNCA agrega 'Ver más fechas' -- comportamiento 100% idéntico al de antes de esta corrección", () => {
    const opciones = construirOpcionesFecha(["2026-09-08", "2026-09-09"]);
    const texto = renderizarMenuFecha(opciones);
    assert.doesNotMatch(texto, /Ver más fechas/);
    assert.equal(texto, renderizarMenuFecha(opciones, null), "el default (sin segundo argumento) es idéntico a pasar null explícito");
  });

  it("'Ver más fechas' se numera correctamente sea cual sea la cantidad real de fechas (1, 2, 3 o 4)", () => {
    for (let n = 1; n <= 4; n++) {
      const opciones = construirOpcionesFecha(["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-12"].slice(0, n));
      const texto = renderizarMenuFecha(opciones, n + 1);
      assert.match(texto, new RegExp(`${n + 1}\\. Ver más fechas$`), `con ${n} fecha(s) real(es), 'Ver más fechas' debe ser la opción ${n + 1}`);
    }
  });

  it("el texto de selección inválida también incluye 'Ver más fechas' cuando corresponde", () => {
    const opciones = construirOpcionesFecha(["2026-09-08"]);
    const texto = textoSeleccionInvalidaFecha(opciones, 2);
    assert.match(texto, /2\. Ver más fechas/);
  });

  it("Test 15 (obligatorio) -- esSeleccionVerMasFechas exige coincidencia EXACTA con el número realmente asignado, nunca asume que '5' siempre significa 'Ver más fechas'", () => {
    assert.equal(esSeleccionVerMasFechas("5", 5), true);
    assert.equal(esSeleccionVerMasFechas(" 5 ", 5), true, "tolera espacios alrededor, mismo criterio que el resto de Agenda V2");
    assert.equal(esSeleccionVerMasFechas("5", 4), false, "'5' pero el número real de 'Ver más fechas' era 4 -- nunca calza");
    assert.equal(esSeleccionVerMasFechas("5", null), false, "si no hay 'Ver más fechas' en este menú (null), NINGÚN número la activa");
    assert.equal(esSeleccionVerMasFechas("cinco", 5), false, "nunca texto libre, solo número exacto");
  });
});
