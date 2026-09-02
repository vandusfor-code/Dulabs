import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { esInterrupcionEscapeHatch } from "@/lib/flow-escape-hatch";

describe("esInterrupcionEscapeHatch — vocabulario reconocido", () => {
  const CASOS = [
    "cancela",
    "cancelar",
    "Cancela, quiero hablar con Dani.",
    "olvídalo",
    "no importa",
    "mejor no",
    "espera",
    "me equivoqué",
    "quiero hablar con Dani",
    "hablar con Daniela",
    "necesito hablar con alguien",
    "con dani por favor",
    "quiero hablar con una persona",
    "quiero hablar con un humano",
  ];
  for (const texto of CASOS) {
    it(`"${texto}" -> true`, () => {
      assert.equal(esInterrupcionEscapeHatch(texto), true);
    });
  }
});

describe("esInterrupcionEscapeHatch — nunca falsos positivos sobre respuestas normales", () => {
  const CASOS = [
    "semipermanente en manos",
    "el sábado",
    "4 de la tarde",
    "la segunda",
    "esa",
    "Ana",
    "16:00",
    "sí, confirmo",
    "",
    "   ",
    "danielle", // no debe matchear por contener "dani" dentro de otra palabra
    "espectacular", // no debe matchear por contener "esp" al inicio parecido a "espera"
  ];
  for (const texto of CASOS) {
    it(`"${texto}" -> false`, () => {
      assert.equal(esInterrupcionEscapeHatch(texto), false);
    });
  }
});
