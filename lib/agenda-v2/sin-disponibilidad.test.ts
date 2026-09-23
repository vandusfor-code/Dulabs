import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decidirSinDiasParaProfesional, lineaLogSinDias, FRASE_PEDIR_PERSONA } from "@/lib/agenda-v2/sin-disponibilidad";
import { detectarSolicitudAtencionHumana } from "@/lib/amore-entrada-gemini";

const ELEGIBLES = [
  { especialistaId: 1262, nombre: "Mary" },
  { especialistaId: 1263, nombre: "Cristal" },
  { especialistaId: 1264, nombre: "Nata" },
  { especialistaId: 1265, nombre: "Jessica" },
];
const CRISTAL = { id: 1263, nombre: "Cristal" };

describe("decidirSinDiasParaProfesional -- única decisión de 'sin días', según la causa REAL", () => {
  it("sin_cupo: dice la verdad (agenda llena) y ofrece SOLO a las otras, renumeradas", () => {
    const d = decidirSinDiasParaProfesional({ causa: "sin_cupo", profesional: CRISTAL, elegibles: ELEGIBLES, ofrecerAtencionHumana: true });
    assert.equal(d.accion, "ofrecer_otras");
    if (d.accion !== "ofrecer_otras") return;
    assert.deepEqual(
      d.opciones.map((o) => [o.numero, o.nombre]),
      [
        [1, "Mary"],
        [2, "Nata"],
        [3, "Jessica"],
      ],
    );
    assert.match(d.mensaje, /^Cristal no tiene espacios libres en los próximos \d+ días/);
    assert.doesNotMatch(d.mensaje, /\d\. Cristal/);
  });

  it("no_confirmado: NUNCA afirma que no tiene agenda -- dice que no se pudo consultar", () => {
    const d = decidirSinDiasParaProfesional({ causa: "no_confirmado", profesional: CRISTAL, elegibles: ELEGIBLES, ofrecerAtencionHumana: true });
    assert.equal(d.accion, "ofrecer_otras");
    assert.match(d.mensaje, /no pude consultar la agenda de Cristal/);
    assert.doesNotMatch(d.mensaje, /no tiene espacios|No encontramos días/);
    assert.match(d.mensaje, new RegExp(FRASE_PEDIR_PERSONA));
  });

  it("calendario_no_configurado: no ofrece otras profesionales (fallarían igual), ofrece una persona", () => {
    const d = decidirSinDiasParaProfesional({ causa: "calendario_no_configurado", profesional: CRISTAL, elegibles: ELEGIBLES, ofrecerAtencionHumana: true });
    assert.equal(d.accion, "sin_alternativas");
    assert.match(d.mensaje, /no pude consultar la agenda/);
  });

  it("sin otras profesionales elegibles -> sin_alternativas (nunca un menú vacío)", () => {
    const d = decidirSinDiasParaProfesional({ causa: "sin_cupo", profesional: CRISTAL, elegibles: [{ especialistaId: 1263, nombre: "Cristal" }], ofrecerAtencionHumana: true });
    assert.equal(d.accion, "sin_alternativas");
    assert.match(d.mensaje, new RegExp(FRASE_PEDIR_PERSONA));
  });

  it("tenant sin atención humana: nunca promete 'hablar con una persona'", () => {
    const d = decidirSinDiasParaProfesional({ causa: "no_confirmado", profesional: CRISTAL, elegibles: [{ especialistaId: 1263, nombre: "Cristal" }], ofrecerAtencionHumana: false });
    assert.doesNotMatch(d.mensaje, new RegExp(FRASE_PEDIR_PERSONA));
    assert.match(d.mensaje, /cancelar/);
  });

  it("la frase ofrecida activa de verdad la atención humana de AMORE (nunca una instrucción que el bot no entiende)", () => {
    assert.equal(detectarSolicitudAtencionHumana(FRASE_PEDIR_PERSONA), true);
  });

  it("log accionable: causa + profesional + motivo técnico", () => {
    const l = lineaLogSinDias({ causa: "no_confirmado", idTenant: "t", profesionalId: 1263, diasNoConfirmados: 12, detalleNoConfirmado: "nylas_http_404" });
    assert.match(l, /causa=no_confirmado/);
    assert.match(l, /profesional=1263/);
    assert.match(l, /dias_no_confirmados=12/);
    assert.match(l, /detalle=nylas_http_404/);
  });
});
