/**
 * Fase 2 (sistema de reservas de Daniela) — motor de disponibilidad basado
 * en datos. Pruebas PURAS (sin red) de las primitivas compartidas de
 * lib/especialistas.ts: restarBloqueos y generarHorariosLibres. Cubren los
 * casos 1, 2, 3, 4, 7 y 8 del pedido de Fase 2 -- los que no dependen de
 * leer especialistas/servicios reales de la base de datos (esos quedan en
 * lib/disponibilidad-servicio.test.ts).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { restarBloqueos, generarHorariosLibres, fusionarVentanasContiguas, type VentanaHoraria } from "@/lib/especialistas";

function hora(hhmm: string): Date {
  return new Date(`2026-09-10T${hhmm}:00-05:00`);
}
function ventana(inicio: string, fin: string): VentanaHoraria {
  return { apertura: hora(inicio), cierre: hora(fin) };
}
function horariosHHMM(fechas: Date[]): string[] {
  return fechas.map((d) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d)
  );
}

describe("generarHorariosLibres — Caso 1: sin bloqueos ni citas", () => {
  it("09:00-18:00, servicio de 60 min -> slots cada 30 min hasta el último que cabe completo", () => {
    const slots = horariosHHMM(generarHorariosLibres([ventana("09:00", "18:00")], [], 60));
    assert.equal(slots[0], "09:00");
    assert.equal(slots[slots.length - 1], "17:00"); // 17:00 + 60min = 18:00, cabe justo
    assert.equal(slots.includes("17:30"), false, "17:30 + 60min = 18:30, no cabe");
  });
});

describe("restarBloqueos + generarHorariosLibres — Caso 2: bloqueo de almuerzo parte la ventana", () => {
  it("09:00-18:00 con bloqueo 12:00-13:00 -> los slots dentro del bloqueo desaparecen", () => {
    const ventanas = restarBloqueos([ventana("09:00", "18:00")], [ventana("12:00", "13:00")]);
    assert.equal(ventanas.length, 2);
    const slots = horariosHHMM(generarHorariosLibres(ventanas, [], 30));
    assert.equal(slots.includes("11:30"), true);
    assert.equal(slots.includes("12:00"), false);
    assert.equal(slots.includes("12:30"), false);
    assert.equal(slots.includes("13:00"), true);
  });
});

describe("generarHorariosLibres — Caso 3: cita de 10:00-11:00 con servicio de 60 min", () => {
  const ocupadas = [ventana("10:00", "11:00")];
  it("10:00 no disponible (coincide exacto)", () => {
    const slots = horariosHHMM(generarHorariosLibres([ventana("09:00", "18:00")], ocupadas, 60));
    assert.equal(slots.includes("10:00"), false);
  });
  it("10:30 no disponible (10:30-11:30 se solapa con 10:00-11:00)", () => {
    const slots = horariosHHMM(generarHorariosLibres([ventana("09:00", "18:00")], ocupadas, 60));
    assert.equal(slots.includes("10:30"), false);
  });
  it("09:00 y 11:00 sí disponibles (no se solapan)", () => {
    const slots = horariosHHMM(generarHorariosLibres([ventana("09:00", "18:00")], ocupadas, 60));
    assert.equal(slots.includes("09:00"), true);
    assert.equal(slots.includes("11:00"), true);
  });
});

describe("generarHorariosLibres — Caso 4: cita larga (10:00-12:00) elimina todos los candidatos que se solapen", () => {
  it("servicio de 60 min: 09:00 sigue libre, 09:30..11:30 desaparecen, 12:00 libre", () => {
    const ocupadas = [ventana("10:00", "12:00")];
    const slots = horariosHHMM(generarHorariosLibres([ventana("09:00", "18:00")], ocupadas, 60));
    assert.equal(slots.includes("09:00"), true);
    for (const s of ["09:30", "10:00", "10:30", "11:00", "11:30"]) {
      assert.equal(slots.includes(s), false, `${s} debe desaparecer (se solapa con 10:00-12:00)`);
    }
    assert.equal(slots.includes("12:00"), true);
  });
});

describe("generarHorariosLibres — Caso 7: horario partido (dos ventanas el mismo día)", () => {
  it("09:00-13:00 y 14:00-18:00 -> respeta ambos intervalos, nunca ofrece 13:00-14:00", () => {
    const ventanas = [ventana("09:00", "13:00"), ventana("14:00", "18:00")];
    const slots = horariosHHMM(generarHorariosLibres(ventanas, [], 60));
    assert.equal(slots.includes("12:00"), true); // 12:00+60=13:00, cabe justo en la primera ventana
    assert.equal(slots.includes("12:30"), false); // 12:30+60=13:30, se saldría de la primera ventana
    assert.equal(slots.includes("13:00"), false); // hueco de almuerzo, ninguna ventana lo cubre
    assert.equal(slots.includes("13:30"), false);
    assert.equal(slots.includes("14:00"), true); // arranca la segunda ventana
    assert.equal(slots.includes("17:00"), true);
  });
});

describe("generarHorariosLibres — Caso 8: servicio de 120 minutos", () => {
  it("no ofrece un slot que no tenga 120 minutos libres completos", () => {
    // Ventana 09:00-11:30 (150 min) con una cita 10:00-10:30 en medio.
    const ventanas = [ventana("09:00", "11:30")];
    const ocupadas = [ventana("10:00", "10:30")];
    const slots = horariosHHMM(generarHorariosLibres(ventanas, ocupadas, 120));
    // 09:00-11:00 se solapa con 10:00-10:30 -> no cabe. 09:30-11:30 también se solapa.
    assert.equal(slots.length, 0, "ningún candidato tiene 120 min completamente libres");
  });

  it("con la ventana completamente libre, sí ofrece los candidatos de 120 min que caben", () => {
    const slots = horariosHHMM(generarHorariosLibres([ventana("09:00", "12:00")], [], 120));
    assert.deepEqual(slots, ["09:00", "09:30", "10:00"]); // 10:00+120=12:00, último que cabe
  });
});

describe("restarBloqueos — casos de borde", () => {
  it("bloqueo que cubre TODA la ventana la elimina por completo", () => {
    const r = restarBloqueos([ventana("09:00", "18:00")], [ventana("08:00", "19:00")]);
    assert.deepEqual(r, []);
  });

  it("bloqueo sin solape no afecta la ventana", () => {
    const r = restarBloqueos([ventana("09:00", "13:00")], [ventana("14:00", "15:00")]);
    assert.equal(r.length, 1);
    assert.equal(r[0]!.apertura.getTime(), hora("09:00").getTime());
    assert.equal(r[0]!.cierre.getTime(), hora("13:00").getTime());
  });

  it("varios bloqueos se aplican en secuencia sobre varias ventanas", () => {
    const r = restarBloqueos(
      [ventana("09:00", "13:00"), ventana("14:00", "18:00")],
      [ventana("10:00", "10:30"), ventana("16:00", "17:00")]
    );
    assert.equal(r.length, 4);
  });
});

// ---------------------------------------------------------------------------
// Fase 8A.6 (autorizado) — auditoría puntual de disponibilidad por DURACIÓN
// COMPLETA, con los mismos valores exactos del pedido. generarHorariosLibres
// ya funcionaba correctamente para esto (confirmado acá con el ejemplo real
// del pedido, sin reescribir nada) -- lo único que sí tenía un problema real
// era ventanasLaboralesEspecialista con ventanas CONTIGUAS del mismo día
// (ver fusionarVentanasContiguas más abajo).
// ---------------------------------------------------------------------------

describe("Fase 8A.6 — Parte 2: ejemplo exacto del pedido (servicio de 120 min, cita 10:00-12:00)", () => {
  it("08:00 válido, 08:30/09:00/09:30/10:00/10:30/11:00 inválidos, 12:00 válido", () => {
    const slots = horariosHHMM(generarHorariosLibres([ventana("08:00", "17:00")], [ventana("10:00", "12:00")], 120));
    assert.ok(slots.includes("08:00"));
    for (const invalido of ["08:30", "09:00", "09:30", "10:00", "10:30", "11:00"]) {
      assert.equal(slots.includes(invalido), false, `${invalido} debía ser inválido`);
    }
    assert.ok(slots.includes("12:00"));
  });

  it("cierre de jornada: con servicio de 120 min y cierre a las 18:00, 16:00 es el último válido, 16:30 ya no cabe", () => {
    const slots = horariosHHMM(generarHorariosLibres([ventana("08:00", "18:00")], [], 120));
    assert.ok(slots.includes("16:00"));
    assert.equal(slots.includes("16:30"), false, "16:30 + 120min = 18:30, excede el cierre");
  });

  it("Acrílicas (210 min = 3h30) exige un bloque continuo real de esa duración", () => {
    const slots = horariosHHMM(generarHorariosLibres([ventana("08:00", "17:00")], [], 210));
    assert.ok(slots.includes("08:00"));
    assert.ok(slots.includes("13:30"), "13:30 + 210min = 17:00, cabe justo");
    assert.equal(slots.includes("13:45"), false, "13:45 + 210min = 17:15, excede el cierre");
  });
});

describe("Fase 8A.6 — fusionarVentanasContiguas (corrección genérica encontrada en la auditoría)", () => {
  it("dos ventanas que se TOCAN (sin hueco real) se fusionan en una sola continua", () => {
    const r = fusionarVentanasContiguas([ventana("08:00", "10:00"), ventana("10:00", "12:00")]);
    assert.equal(r.length, 1);
    assert.equal(r[0]!.apertura.getTime(), hora("08:00").getTime());
    assert.equal(r[0]!.cierre.getTime(), hora("12:00").getTime());
  });

  it("ventanas con un hueco REAL (ej. almuerzo) se conservan separadas", () => {
    const r = fusionarVentanasContiguas([ventana("09:00", "13:00"), ventana("14:00", "18:00")]);
    assert.equal(r.length, 2);
  });

  it("consecuencia real: un servicio de 120 min encuentra 09:00 solo si las ventanas contiguas 08-10/10-12 ya vienen fusionadas", () => {
    const sinFusionar = horariosHHMM(generarHorariosLibres([ventana("08:00", "10:00"), ventana("10:00", "12:00")], [], 120));
    assert.equal(sinFusionar.includes("09:00"), false, "sin fusionar, 09:00 cruzaría el límite entre ventanas y no aparece");

    const fusionadas = fusionarVentanasContiguas([ventana("08:00", "10:00"), ventana("10:00", "12:00")]);
    const conFusion = horariosHHMM(generarHorariosLibres(fusionadas, [], 120));
    assert.ok(conFusion.includes("09:00"), "fusionadas en una ventana continua 08-12, 09:00 sí cabe");
  });
});
