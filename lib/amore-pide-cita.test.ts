/**
 * ¿La clienta está pidiendo una cita nueva? (lib/amore-pide-cita.ts) -- la lectura SIN IA del modo «saludo único». Cada fila de las dos tablas es un mensaje que una clienta
 * real podría escribir; un falso negativo deja a la clienta sin enlace, un falso positivo le manda el enlace sin que lo pidiera.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pideCitaNueva } from "@/lib/amore-pide-cita";
import { detectarIntencionGestionCitas } from "@/lib/agenda-v2/entrada";

const PIDEN_CITA = [
  // Las frases de siempre (lista fija) siguen valiendo.
  "Hola quiero una cita",
  "QUIERO UNA CITA!!!",
  "Hola 💗 quiero una cita",
  "Hola, quiero agendar una cita para manos y pies",
  "kiero una cita",
  "quiero reservar",
  "quiero apartar cita",
  "Necesito una cita urgente",
  // Formas comunes que la lista fija no cubre.
  "Quiero cita",
  "necesito cita",
  "quisiera una cita para el sábado",
  "Buenas tardes, queria una cita",
  "me gustaría una cita",
  "Me gustaría tener una cita mañana",
  "quiero hacer una cita",
  "quiero otra cita",
  "necesito sacar cita",
  "Quisiera agendarme una cita",
  "Buenas, quisiera agendar",
  "quisiera reservar",
  "¿Puedo agendar para mañana?",
  "¿me pueden agendar?",
  "me puedes agendar para el viernes",
  "agendar cita",
  "Agendar una cita",
  "sacar cita",
  "¿Cómo reservo?",
  "¿cómo puedo agendar?",
  "como hago para sacar la cita",
  "¿Tienen citas para hoy?",
  "hay cita para mañana?",
  "¿tienen disponibilidad?",
  "hay cupo?",
  "¿qué horarios tienen?",
  "quiero saber si tienen cita para mañana",
  "me agendas?",
  "me das una cita",
  "me regalas un turno",
  // Una negación de OTRA cosa no anula la petición.
  "No, quiero una cita",
  "no quiero cancelar, quiero una cita",
];

const NO_PIDEN_CITA = [
  // Saludos, cortesías y mensajes sueltos.
  "Hola",
  "Hola buenas",
  "gracias",
  "ok listo",
  "💗",
  "voy en camino",
  "ya llegué",
  // De una cita que YA existe.
  "tengo una cita mañana",
  "tengo cita a las 3",
  "ya tengo cita",
  "confirmo mi cita para hoy",
  "mi cita es hoy a las 4",
  "gracias por la cita",
  "la cita de mi mamá es a las 3",
  "cita para mañana",
  "tiene cita con Cristal mañana",
  "quiero la cita de las 3",
  "necesito mi cita",
  "quiero que me confirmen la cita",
  "hay una cita a mi nombre?",
  "hay alguna cita a nombre de Ana?",
  // Gestionar su cita (lo atiende la detección de gestión, no ésta).
  "quiero cancelar mi cita",
  "quiero cambiar mi cita",
  "no voy a poder ir a mi cita",
  "¿a qué hora es mi cita?",
  "que dia tengo mi cita",
  // Negaciones.
  "no quiero cita",
  "no necesito cita",
  "ya no necesito una cita",
  "ya no quiero la cita",
  "ya no quiero agendar",
  "no me gustaría agendar",
  // Otras preguntas.
  "¿cuánto cuesta una cita?",
  "cuanto vale el dipping",
  "cuánto cuesta el dipping?",
  "cuanto cuesta reservar",
  "tienen parqueadero?",
  "como llego",
  "como pago",
  "puedo ir sin cita?",
  "atienden sin cita?",
  "quiero saber el precio",
  "quisiera saber cuánto cuesta",
  "necesito información",
  "necesito ayuda",
  "me puedes ayudar",
  "me ayudas con una duda",
  "quiero hablar con alguien",
];

describe("pideCitaNueva -- lectura sin IA de «quiero una cita»", () => {
  for (const mensaje of PIDEN_CITA) {
    it(`SÍ pide cita: «${mensaje}»`, () => {
      assert.equal(pideCitaNueva(mensaje), true);
    });
  }

  for (const mensaje of NO_PIDEN_CITA) {
    it(`NO pide cita: «${mensaje}»`, () => {
      assert.equal(pideCitaNueva(mensaje), false);
    });
  }

  it("ninguna frase que pide una cita nueva se lee, a la vez, como gestionar una existente (no hay solapes entre las dos detecciones)", () => {
    for (const mensaje of PIDEN_CITA) {
      assert.equal(detectarIntencionGestionCitas(mensaje), null, mensaje);
    }
  });

  it("no depende de mayúsculas, tildes ni espacios de más", () => {
    assert.equal(pideCitaNueva("  QUISIERA   UNA   CITA  "), true);
    assert.equal(pideCitaNueva("Me GUSTARÍA tener una cita"), true);
    assert.equal(pideCitaNueva(""), false);
    assert.equal(pideCitaNueva("   "), false);
  });
});
