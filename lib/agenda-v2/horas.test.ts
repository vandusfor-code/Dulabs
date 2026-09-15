import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { construirBloqueHora, renderizarMenuHora, textoSeleccionInvalidaHora, resolverSeleccionHora, esSeleccionVerMasHoras, MAX_OPCIONES_HORA } from "@/lib/agenda-v2/horas";

const FECHA = "2026-09-08";

describe("construirBloqueHora -- exclusivamente los horarios reales ya calculados, nunca inventados", () => {
  it("numera en orden cronológico y conserva fechaIso + hora reales", () => {
    const bloque = construirBloqueHora(FECHA, ["09:00", "10:30", "14:00"]);
    assert.deepEqual(
      bloque.opciones.map((o) => [o.numero, o.fechaIso, o.hora]),
      [
        [1, FECHA, "09:00"],
        [2, FECHA, "10:30"],
        [3, FECHA, "14:00"],
      ],
    );
    assert.equal(bloque.numeroVerMasHoras, null, "3 horarios reales, ninguno queda restante -- nunca ofrece 'Ver más horarios'");
    assert.deepEqual(bloque.horariosRestantes, []);
  });

  it("Test obligatorio -- máximo 6 opciones por bloque: con más de 6 horarios reales, toma las primeras 6 en orden cronológico y guarda el resto en horariosRestantes", () => {
    const horarios = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"];
    const bloque = construirBloqueHora(FECHA, horarios);
    assert.equal(bloque.opciones.length, MAX_OPCIONES_HORA);
    assert.deepEqual(
      bloque.opciones.map((o) => o.hora),
      ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00"],
    );
    assert.deepEqual(bloque.horariosRestantes, ["14:00", "15:00"], "nunca descarta los horarios reales que no caben en este bloque");
  });

  it("CASO 2 (obligatorio) -- 'Ver más horarios' es dinámico según la cantidad de horarios mostrados, nunca asume que siempre es 7", () => {
    // 5 horarios reales, todos caben en un solo bloque (< MAX_OPCIONES_HORA) -- nunca hay más que ofrecer.
    const cincoHorarios = construirBloqueHora(FECHA, ["08:00", "09:00", "10:00", "11:00", "12:00"]);
    assert.equal(cincoHorarios.numeroVerMasHoras, null);

    // 8 horarios reales -- bloque de 6 + "7. Ver más horarios" (dinámico: opciones.length + 1).
    const ochoHorarios = construirBloqueHora(FECHA, ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"]);
    assert.equal(ochoHorarios.numeroVerMasHoras, 7);

    // 9 horarios reales -- sigue siendo un bloque de 6 (MAX_OPCIONES_HORA no cambia), "7. Ver más horarios" también.
    const nueveHorarios = construirBloqueHora(FECHA, ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
    assert.equal(nueveHorarios.numeroVerMasHoras, 7);
    assert.equal(nueveHorarios.horariosRestantes.length, 3);
  });

  it("lista vacía -> opciones vacías, nunca inventa un horario", () => {
    const bloque = construirBloqueHora(FECHA, []);
    assert.deepEqual(bloque.opciones, []);
    assert.equal(bloque.numeroVerMasHoras, null);
  });

  it("segundo bloque ('Ver más horarios') vuelve a numerar desde 1 -- mismo criterio EXACTO que 'Ver más fechas'", () => {
    const primerBloque = construirBloqueHora(FECHA, ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"]);
    const segundoBloque = construirBloqueHora(FECHA, primerBloque.horariosRestantes);
    assert.deepEqual(
      segundoBloque.opciones.map((o) => [o.numero, o.hora]),
      [
        [1, "14:00"],
        [2, "15:00"],
      ],
    );
    assert.equal(segundoBloque.numeroVerMasHoras, null, "ya no quedan más horarios reales -- nunca ofrece una tercera página vacía");
  });
});

describe("renderizarMenuHora / textoSeleccionInvalidaHora -- texto siempre reconstruido desde datos reales, formato AM/PM", () => {
  it("incluye el encabezado, cada horario numerado en formato AM/PM, y la instrucción final", () => {
    const texto = renderizarMenuHora(construirBloqueHora(FECHA, ["09:00", "10:30", "14:00", "16:30"]).opciones);
    assert.match(texto, /Estos son los horarios disponibles:/);
    assert.match(texto, /1\. 9:00 a\. m\./);
    assert.match(texto, /2\. 10:30 a\. m\./);
    assert.match(texto, /3\. 2:00 p\. m\./);
    assert.match(texto, /4\. 4:30 p\. m\./);
    assert.match(texto, /Selecciona el horario que prefieras\./);
  });

  it("Test obligatorio -- con numeroVerMasHoras dado, el menú agrega 'N. Ver más horarios' DESPUÉS de los horarios reales, con el número dinámico real", () => {
    const bloque = construirBloqueHora(FECHA, ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00"]);
    const texto = renderizarMenuHora(bloque.opciones, bloque.numeroVerMasHoras);
    assert.match(texto, /6\. 1:00 p\. m\./);
    assert.match(texto, /7\. Ver más horarios/);
  });

  it("sin numeroVerMasHoras (null), el menú NUNCA agrega 'Ver más horarios' -- comportamiento 100% idéntico al de antes de esta corrección", () => {
    const opciones = construirBloqueHora(FECHA, ["09:00", "14:00"]).opciones;
    const texto = renderizarMenuHora(opciones);
    assert.doesNotMatch(texto, /Ver más horarios/);
  });

  it("el texto de selección inválida reenvía EXACTAMENTE las mismas opciones, sin reordenar", () => {
    const opciones = construirBloqueHora(FECHA, ["09:00", "14:00"]).opciones;
    const texto = textoSeleccionInvalidaHora(opciones);
    assert.match(texto, /No reconocí esa opción/);
    assert.match(texto, /1\. 9:00 a\. m\./);
    assert.match(texto, /2\. 2:00 p\. m\./);
  });
});

describe("esSeleccionVerMasHoras -- exige coincidencia EXACTA (normalizada) con el número realmente asignado, nunca asume que un número fijo siempre significa 'Ver más horarios'", () => {
  it("coincide con el número real, con variantes reales de puntuación/prefijo", () => {
    for (const texto of ["7", "7.", "7)", " 7 ", "opción 7", "opcion 7", "la 7"]) {
      assert.equal(esSeleccionVerMasHoras(texto, 7), true, `"${texto}" debe activar 'Ver más horarios'`);
    }
  });

  it("'7' pero el número real de 'Ver más horarios' era 6 -- nunca calza", () => {
    assert.equal(esSeleccionVerMasHoras("7", 6), false);
  });

  it("si no hay 'Ver más horarios' en este bloque (null), NINGÚN número la activa", () => {
    assert.equal(esSeleccionVerMasHoras("7", null), false);
  });

  it("nunca texto libre ('siete', frase con el número dentro)", () => {
    assert.equal(esSeleccionVerMasHoras("siete", 7), false);
    assert.equal(esSeleccionVerMasHoras("tengo 7 minutos", 7), false);
  });
});

describe("resolverSeleccionHora -- SOLO número exacto (normalizado) contra las opciones ya mostradas, nunca fuzzy ni texto libre", () => {
  const OPCIONES = construirBloqueHora(FECHA, ["09:00", "10:30", "14:00"]).opciones;

  it("número exacto resuelve el horario real correspondiente", () => {
    assert.equal(resolverSeleccionHora("1", OPCIONES)?.hora, "09:00");
    assert.equal(resolverSeleccionHora("3", OPCIONES)?.hora, "14:00");
  });

  it("número con espacios alrededor también resuelve", () => {
    assert.equal(resolverSeleccionHora("  2  ", OPCIONES)?.hora, "10:30");
  });

  it("CASO 1 (obligatorio) -- '2.', '2)', 'opción 2', 'opcion 2', 'la 2' resuelven TODOS la misma opción que '2'", () => {
    for (const texto of ["2.", "2)", "opción 2", "opcion 2", "la 2"]) {
      assert.equal(resolverSeleccionHora(texto, OPCIONES)?.hora, "10:30", `"${texto}" debe resolver la misma hora que "2"`);
    }
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

  it("CASO 1 (obligatorio) -- un número dentro de una frase libre ('Tengo disponibilidad a las 4.') NUNCA se interpreta como opción", () => {
    assert.equal(resolverSeleccionHora("Tengo disponibilidad a las 4.", OPCIONES), undefined);
  });

  it("nunca extrae dígitos de en medio de un texto que no es un prefijo/sufijo reconocido ('999abc')", () => {
    assert.equal(resolverSeleccionHora("999abc", OPCIONES), undefined);
  });
});
