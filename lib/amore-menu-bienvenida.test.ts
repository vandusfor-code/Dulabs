/**
 * ¿Qué opción del menú de bienvenida elige la clienta? (lib/amore-menu-bienvenida.ts) -- solo se consulta con el menú pendiente (su siguiente mensaje tras el saludo).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { opcionDelMenuBienvenida } from "@/lib/amore-menu-bienvenida";

const OPCION_1 = ["1", " 1 ", "1.", "1)", "1️⃣", "la 1", "el 1", "opción 1", "Opcion 1", "opción 1 por favor", "número 1", "uno", "Uno", "la uno", "opción uno", "1 gracias", "primera", "#1", "cita", "Cita", "citas", "una cita", "Una cita!", "agenda", "agendar", "Reservar", "separar", "apartar", "agendar porfa"];
const OPCION_2 = ["2", "2.", "2️⃣", "la 2", "opción 2", "opción dos", "dos", "segunda", "consulta", "una consulta", "hacer una consulta", "quiero hacer una consulta", "Quiero hacer una consulta.", "tengo una consulta", "una pregunta", "tengo una pregunta", "quisiera hacer una consulta", "consulta por favor"];
const OPCION_3 = ["3", "3.", "3️⃣", "la 3", "opción 3", "opción tres", "tres", "tercera", "persona", "una persona", "una persona por favor"];
const NINGUNA = [
  "",
  "   ",
  "Hola",
  "gracias",
  "sí",
  "ok",
  "💗",
  "4",
  "0",
  "12",
  "1 y 2",
  "2 personas",
  "3 de la tarde",
  "a las 3",
  "una cita para mañana",
  "cita para mañana",
  "quiero saber el precio",
  "cuánto cuesta",
  "consulta de precios",
  "quiero hablar con una persona",
  "persona de contacto",
  "uno de estos días",
  "dos citas",
];

describe("opcionDelMenuBienvenida -- el menú de bienvenida respondido con palabras o con números", () => {
  for (const mensaje of OPCION_1) {
    it(`opción 1 (cita): «${mensaje}»`, () => {
      assert.equal(opcionDelMenuBienvenida(mensaje), "1");
    });
  }
  for (const mensaje of OPCION_2) {
    it(`opción 2 (consulta): «${mensaje}»`, () => {
      assert.equal(opcionDelMenuBienvenida(mensaje), "2");
    });
  }
  for (const mensaje of OPCION_3) {
    it(`opción 3 (una persona): «${mensaje}»`, () => {
      assert.equal(opcionDelMenuBienvenida(mensaje), "3");
    });
  }
  for (const mensaje of NINGUNA) {
    it(`ninguna opción: «${mensaje}»`, () => {
      assert.equal(opcionDelMenuBienvenida(mensaje), null);
    });
  }
});
