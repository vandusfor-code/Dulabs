/**
 * segmentarRespuestaWhatsApp (FASE — refinamiento conversacional, autorizado)
 * -- sección 24.H/24.I del pedido: respuestas cortas NUNCA se dividen,
 * respuestas largas pueden dividirse en 2-3/4 mensajes, nunca a mitad de una
 * oración/precio/nombre de servicio.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { segmentarRespuestaWhatsApp } from "@/lib/whatsapp-mensaje-segmentador";

describe("segmentarRespuestaWhatsApp — respuestas cortas nunca se dividen", () => {
  it("saludo corto -> 1 solo mensaje", () => {
    assert.deepEqual(segmentarRespuestaWhatsApp("¡Hola! 💗 Qué gusto tenerte por aquí. Cuéntame, ¿qué te gustaría hacerte hoy?"), [
      "¡Hola! 💗 Qué gusto tenerte por aquí. Cuéntame, ¿qué te gustaría hacerte hoy?",
    ]);
  });

  it("precio simple -> 1 solo mensaje, nunca corta el número", () => {
    const texto = "El Dipping tiene un valor de $60.000 💗";
    assert.deepEqual(segmentarRespuestaWhatsApp(texto), [texto]);
  });

  it("cadena vacía -> array vacío (nada que enviar)", () => {
    assert.deepEqual(segmentarRespuestaWhatsApp(""), []);
    assert.deepEqual(segmentarRespuestaWhatsApp("   "), []);
  });

  it("respuesta media con líneas en blanco pero corta en total -> igual 1 mensaje (no divide de más)", () => {
    const texto = "Claro 💗\n\n¿Buscas algo natural?";
    assert.deepEqual(segmentarRespuestaWhatsApp(texto), [texto]);
  });
});

describe("segmentarRespuestaWhatsApp — bloques semánticos reales (líneas en blanco)", () => {
  it("3 bloques separados por línea en blanco -> 3 mensajes, cada uno íntegro", () => {
    const texto =
      "Claro que sí 💗 Hay varias opciones bonitas para uñas.\n\n" +
      "Tenemos Dipping, Press On, semipermanente y otras alternativas.\n\n" +
      "Si me cuentas qué estilo buscas, te ayudo a elegir la que más te convenga. ✨";
    const resultado = segmentarRespuestaWhatsApp(texto);
    assert.equal(resultado.length, 3);
    assert.equal(resultado[0], "Claro que sí 💗 Hay varias opciones bonitas para uñas.");
    assert.equal(resultado[1], "Tenemos Dipping, Press On, semipermanente y otras alternativas.");
    assert.equal(resultado[2], "Si me cuentas qué estilo buscas, te ayudo a elegir la que más te convenga. ✨");
  });

  it("una lista con saltos de línea simples dentro de UN bloque nunca se corta línea por línea", () => {
    const texto =
      "Tenemos varias opciones para uñas 💗\n\n" +
      "Dipping — $60.000\nPress On — $80.000\nUña — $8.000\n\n" +
      "Si quieres, cuéntame qué resultado buscas y te ayudo a reducir las opciones.";
    const resultado = segmentarRespuestaWhatsApp(texto);
    assert.equal(resultado.length, 3);
    assert.ok(resultado[1]!.includes("Dipping — $60.000") && resultado[1]!.includes("Press On — $80.000") && resultado[1]!.includes("Uña — $8.000"));
  });

  it("nunca genera más de 4 mensajes -- funde los bloques más pequeños entre sí, nunca corta uno a la mitad", () => {
    const bloques = ["Bloque uno.", "Bloque dos.", "Bloque tres.", "Bloque cuatro.", "Bloque cinco.", "Bloque seis."];
    const texto = bloques.join("\n\n");
    const resultado = segmentarRespuestaWhatsApp(texto);
    assert.ok(resultado.length <= 4, `esperaba <=4 mensajes, obtuvo ${resultado.length}`);
    // Ningún bloque original se partió: cada uno debe aparecer completo en
    // ALGÚN mensaje del resultado.
    for (const bloque of bloques) {
      assert.ok(resultado.some((m) => m.includes(bloque)), `"${bloque}" no aparece completo en ningún mensaje final`);
    }
  });
});

describe("segmentarRespuestaWhatsApp — párrafo largo sin líneas en blanco (fallback por oraciones)", () => {
  it("un párrafo muy largo sin bloques naturales se agrupa en 2-3 oraciones completas, nunca a mitad de oración/precio", () => {
    const texto =
      "El Dipping es una técnica que utiliza un sistema de polvo para darle cobertura y estructura a la uña. " +
      "En AMORE tiene un valor de $60.000 y toma aproximadamente 2 horas en total. " +
      "Es una buena opción si buscas algo resistente y con buen acabado para varias semanas. " +
      "Si quieres, también puedo contarte en qué se diferencia de otras técnicas que tenemos disponibles.";
    const resultado = segmentarRespuestaWhatsApp(texto);
    assert.ok(resultado.length >= 2 && resultado.length <= 3, `esperaba 2-3 mensajes, obtuvo ${resultado.length}`);
    // Nunca debe cortar "$60.000" a la mitad -- el precio completo debe
    // aparecer intacto en uno solo de los mensajes.
    assert.ok(resultado.some((m) => m.includes("$60.000")));
    assert.ok(!resultado.some((m) => /\$60\.$/.test(m.trim()) || /^000/.test(m.trim())));
    // Reconstruir (uniendo con espacio) debe recuperar todo el contenido real.
    const reconstruido = resultado.join(" ");
    for (const fragmento of ["Dipping", "$60.000", "2 horas", "diferencia de otras técnicas"]) {
      assert.ok(reconstruido.includes(fragmento), `falta "${fragmento}" tras segmentar`);
    }
  });

  it("una respuesta media (justo por debajo del umbral de agrupar oraciones) sin bloques naturales sigue siendo 1 mensaje", () => {
    const texto = "Sí, claro 💗 Si quieres algo bonito y todavía no tienes claro qué hacerte, te puedo ayudar a elegir con calma.";
    assert.equal(texto.length < 260, true, "este caso de prueba debe quedar por debajo del umbral de agrupar oraciones");
    assert.deepEqual(segmentarRespuestaWhatsApp(texto), [texto]);
  });
});
