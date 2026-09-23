import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolverPorNombre,
  esPedidoCualquierProfesional,
  extraerFechaNatural,
  resolverHoraNatural,
  resolverConfirmacionNatural,
  resolverSiNoNatural,
} from "@/lib/agenda-v2/seleccion-natural";

const PROFESIONALES = [
  { id: 1, nombre: "Mary" },
  { id: 2, nombre: "Cristal" },
  { id: 3, nombre: "Nata" },
  { id: 4, nombre: "Jessica" },
];
const nombre = (p: { nombre: string }) => p.nombre;
const HOY = "2026-09-23"; // miércoles

describe("resolverPorNombre -- palabra completa, única entre las opciones mostradas", () => {
  it("reconoce el nombre en frases naturales, sin importar tildes/mayúsculas/puntuación", () => {
    for (const [msg, id] of [
      ["Cristal", 2],
      ["quiero con cristal", 2],
      ["Con Cristal porfa 💗", 2],
      ["¿y Mary?", 1],
      ["bueno, si ella no puede entonces Mary", 1],
      ["NATA", 3],
    ] as const) {
      const r = resolverPorNombre(msg, PROFESIONALES, nombre);
      assert.equal(r.tipo, "unica", msg);
      if (r.tipo === "unica") assert.equal(r.opcion.id, id, msg);
    }
  });

  it("nunca por fragmento o parecido: 'Natalia' no es Nata, 'mar' no es Mary", () => {
    for (const msg of ["Natalia", "quiero con mar", "cristalería", "jess"]) {
      assert.equal(resolverPorNombre(msg, PROFESIONALES, nombre).tipo, "ninguna", msg);
    }
  });

  it("dos nombres = ambiguo, nunca se adivina", () => {
    const r = resolverPorNombre("no con Cristal, mejor Mary", PROFESIONALES, nombre);
    assert.equal(r.tipo, "ambigua");
  });

  it("nombre compuesto: gana el nombre completo que dijo la clienta", () => {
    const servicios = [{ nombre: "Manicure" }, { nombre: "Manicure semipermanente" }];
    const r = resolverPorNombre("quiero manicure semipermanente", servicios, nombre);
    assert.equal(r.tipo, "unica");
    if (r.tipo === "unica") assert.equal(r.opcion.nombre, "Manicure semipermanente");
    assert.equal(resolverPorNombre("quiero manicure", servicios, nombre).tipo, "unica", "solo 'Manicure' coincide completo");
  });
});

describe("esPedidoCualquierProfesional", () => {
  it("reconoce la falta de preferencia", () => {
    for (const msg of ["me da igual", "Me da igual quién", "la que tenga disponibilidad", "cualquiera", "mmm no sé", "la que esté libre", "no tengo preferencia"]) {
      assert.equal(esPedidoCualquierProfesional(msg), true, msg);
    }
  });
  it("no confunde otras frases", () => {
    for (const msg of ["Cristal", "hola", "quiero con Mary", "cuánto cuesta"]) {
      assert.equal(esPedidoCualquierProfesional(msg), false, msg);
    }
  });
});

describe("extraerFechaNatural -- mismo parser determinístico, con muletillas iniciales de una lista cerrada", () => {
  it("fechas naturales", () => {
    for (const [msg, fecha] of [
      ["mañana", "2026-09-24"],
      ["mejor el viernes", "2026-09-25"],
      ["¿y el sábado?", "2026-09-26"],
      ["puede ser el 30 de septiembre", "2026-09-30"],
      ["para el lunes", "2026-09-28"],
      ["hoy", "2026-09-23"],
    ] as const) {
      assert.equal(extraerFechaNatural(msg, HOY), fecha, msg);
    }
  });
  it("sin fecha inequívoca o ya pasada -> null (nunca adivina)", () => {
    for (const msg of ["hola", "el otro sábado", "cualquier día", "el 30", "1 de enero", "no puedo el viernes"]) {
      assert.equal(extraerFechaNatural(msg, HOY), null, msg);
    }
  });
  it("en el paso de hora, 'mañana' sola es la franja, no el día", () => {
    assert.equal(extraerFechaNatural("mañana", HOY, { sinManana: true }), null);
    assert.equal(extraerFechaNatural("el viernes", HOY, { sinManana: true }), "2026-09-25");
  });
});

describe("resolverHoraNatural -- solo contra horarios REALES libres", () => {
  const LIBRES = ["09:00", "10:30", "14:00", "16:30", "17:00", "18:00"];

  it("hora exacta libre", () => {
    for (const [msg, hora] of [
      ["9 am", "09:00"],
      ["a las 2", "14:00"],
      ["la de las 2", "14:00"],
      ["a las 4 y media", "16:30"],
      ["4:30", "16:30"],
      ["mejor a las 5", "17:00"],
      ["tipo 6", "18:00"],
      ["10:30", "10:30"],
    ] as const) {
      assert.deepEqual(resolverHoraNatural(msg, LIBRES), { tipo: "unica", hora }, msg);
    }
  });

  it("hora bien formada pero NO libre -> no_disponible (nunca se da por libre)", () => {
    assert.deepEqual(resolverHoraNatural("a las 3", LIBRES), { tipo: "no_disponible", hora: "15:00" });
    assert.deepEqual(resolverHoraNatural("3pm", LIBRES), { tipo: "no_disponible", hora: "15:00" });
  });

  it("franjas y rangos filtran la lista real", () => {
    assert.deepEqual(resolverHoraNatural("en la mañana", LIBRES), { tipo: "filtro", horas: ["09:00", "10:30"], descripcion: "en la mañana" });
    assert.deepEqual(resolverHoraNatural("¿puede ser después de las 5?", LIBRES), { tipo: "filtro", horas: ["17:00", "18:00"], descripcion: "desde las 5:00 p. m." });
    assert.deepEqual(resolverHoraNatural("antes de las 12", LIBRES), { tipo: "filtro", horas: ["09:00", "10:30"], descripcion: "antes de las 12:00 p. m." });
    assert.equal(resolverHoraNatural("después de las 7", LIBRES).tipo, "filtro");
    assert.deepEqual((resolverHoraNatural("después de las 7", LIBRES) as { horas: string[] }).horas, [], "7 sin marca en un salón = 7 p. m.");
  });

  it("sin hora -> ninguna", () => {
    for (const msg of ["hola", "no sé", "sí", "cualquiera"]) assert.equal(resolverHoraNatural(msg, LIBRES).tipo, "ninguna", msg);
  });
});

describe("confirmación / sí-no -- vocabulario cerrado, mensaje COMPLETO", () => {
  it("afirmaciones explícitas confirman", () => {
    for (const msg of ["sí", "Sí!", "si porfa", "Sí, perfecto 💗", "confirmo", "dale", "listo", "de una", "ok"]) {
      assert.equal(resolverConfirmacionNatural(msg), "confirmar", msg);
    }
  });
  it("afirmaciones condicionadas, 'no' suelto y ambigüedades NUNCA confirman ni cancelan", () => {
    for (const msg of ["sí pero", "sí, pero mejor a las 4", "no", "no sé", "obvio que sí pero luego", "tal vez"]) {
      assert.equal(resolverConfirmacionNatural(msg), null, msg);
    }
  });
  it("cambios y desistimiento explícitos", () => {
    assert.equal(resolverConfirmacionNatural("otro día"), "cambiar_fecha");
    assert.equal(resolverConfirmacionNatural("mejor otra hora"), "cambiar_hora");
    assert.equal(resolverConfirmacionNatural("mejor no"), "cancelar");
  });
  it("sí/no binario", () => {
    assert.equal(resolverSiNoNatural("sí"), "si");
    assert.equal(resolverSiNoNatural("no gracias"), "no");
    assert.equal(resolverSiNoNatural("obvio que sí"), null);
  });
});
