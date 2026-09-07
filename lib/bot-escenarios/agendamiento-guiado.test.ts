import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  construirMenuServicios,
  continuarMenuServicios,
  construirMenuProfesionales,
  continuarMenuProfesionales,
  construirMenuFechas,
  construirMenuHorarios,
  continuarMenuHorarios,
  construirMenuConfirmacion,
  resolverSeleccionMenu,
  renderizarMenu,
  textoSeleccionInvalida,
  formatearFechaLarga,
  parseSlotHorarioId,
  ID_CONFIRMAR_CITA,
  ID_CAMBIAR_HORARIO,
  ID_CANCELAR,
} from "@/lib/bot-escenarios/agendamiento-guiado";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";
import type { EspecialistaBasico } from "@/lib/bot-escenarios/resolver";

const CATALOGO: ServicioCatalogoReal[] = [
  { id: "s-dipping", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-presson", nombre: "Press On", precio: 45000, duracionMin: 90, categoria: "Uñas", descripcion: null },
  { id: "s-manospies", nombre: "Manos y Pies Semi", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-retoques", nombre: "Retoques", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-extra", nombre: "Diseño Extra", precio: 20000, duracionMin: 30, categoria: "Uñas", descripcion: null },
];

const ESPECIALISTAS: EspecialistaBasico[] = [
  { id: 1, nombre: "Cristal" },
  { id: 2, nombre: "Mary" },
  { id: 3, nombre: "Nata" },
  { id: 4, nombre: "Jessica" },
];

describe("construirMenuServicios -- exclusivamente catálogo real, nunca inventado", () => {
  it("con 4 o menos, no agrega 'Ver más servicios'", () => {
    const menu = construirMenuServicios(CATALOGO.slice(0, 4));
    assert.equal(menu.tipo, "servicio");
    assert.equal(menu.opciones.length, 4);
    assert.equal(menu.pendientes, undefined);
    assert.deepEqual(
      menu.opciones.map((o) => o.id),
      ["s-dipping", "s-presson", "s-manospies", "s-retoques"],
    );
  });

  it("con más de 4, corta a 4 reales y agrega 'Ver más servicios' -- nunca manda el catálogo completo", () => {
    const menu = construirMenuServicios(CATALOGO);
    assert.equal(menu.opciones.length, 5);
    assert.equal(menu.opciones[4]!.label, "Ver más servicios");
    assert.equal(menu.opciones[4]!.numero, 5);
    assert.ok(menu.pendientes);
    assert.equal(menu.pendientes!.length, 1);
    assert.equal(menu.pendientes![0]!.id, "s-extra");
  });

  it("continuarMenuServicios pagina lo pendiente sin repetir la consulta real", () => {
    const primero = construirMenuServicios(CATALOGO);
    const segundo = continuarMenuServicios(primero.pendientes!);
    assert.equal(segundo.opciones.length, 1);
    assert.equal(segundo.opciones[0]!.id, "s-extra");
    assert.equal(segundo.pendientes, undefined);
  });

  it("cada opción guarda el UUID real como id -- el label visible nunca es la fuente de verdad", () => {
    const menu = construirMenuServicios(CATALOGO.slice(0, 1));
    assert.equal(menu.opciones[0]!.id, "s-dipping");
    assert.match(menu.opciones[0]!.label, /Dipping — \$60\.000 · 2 h/);
  });
});

describe("construirMenuProfesionales -- exclusivamente elegibles reales, 'Cualquier profesional' siempre presente", () => {
  it("con especialistas reales, agrega 'Cualquier profesional' (id=ANY) al final, nunca un UUID inventado", () => {
    const menu = construirMenuProfesionales(ESPECIALISTAS);
    assert.equal(menu.opciones.length, 5);
    assert.deepEqual(
      menu.opciones.map((o) => o.id),
      ["1", "2", "3", "4", "ANY"],
    );
    assert.equal(menu.opciones[4]!.label, "Cualquier profesional");
  });

  it("con más de 4 elegibles reales, pagina y conserva 'Cualquier profesional' visible en la página actual", () => {
    const cinco = [...ESPECIALISTAS, { id: 5, nombre: "Valentina" }];
    const menu = construirMenuProfesionales(cinco);
    assert.equal(menu.opciones.length, 6); // 4 reales + Ver más + Cualquier profesional
    assert.equal(menu.opciones[4]!.id, "VER_MAS_PROFESIONALES");
    assert.equal(menu.opciones[5]!.id, "ANY");
    assert.ok(menu.pendientes);
    assert.equal(menu.pendientes!.length, 1);
    assert.equal(menu.pendientes![0]!.id, "5");
  });

  it("continuarMenuProfesionales conserva 'Cualquier profesional' en la página siguiente también", () => {
    const cinco = [...ESPECIALISTAS, { id: 5, nombre: "Valentina" }];
    const primero = construirMenuProfesionales(cinco);
    const segundo = continuarMenuProfesionales(primero.pendientes!);
    assert.equal(segundo.opciones.length, 2);
    assert.equal(segundo.opciones[0]!.id, "5");
    assert.equal(segundo.opciones[1]!.id, "ANY");
  });
});

describe("construirMenuFechas -- determinista, America/Bogota, nunca calculado por Gemini", () => {
  it("genera 4 fechas reales consecutivas desde hoyISO + 'Ver más fechas'", () => {
    const menu = construirMenuFechas("2026-09-07"); // lunes real
    assert.equal(menu.opciones.length, 5);
    assert.deepEqual(
      menu.opciones.slice(0, 4).map((o) => o.id),
      ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"],
    );
    assert.equal(menu.opciones[4]!.id, "VER_MAS_FECHAS");
    assert.equal(menu.offsetFechas, 4);
  });

  it("con offset, continúa desde el día correcto (nunca repite fechas ya mostradas)", () => {
    const menu = construirMenuFechas("2026-09-07", 4);
    assert.deepEqual(
      menu.opciones.slice(0, 4).map((o) => o.id),
      ["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"],
    );
  });

  it("formatearFechaLarga produce 'Viernes 11 de septiembre' (capitalizado, sin coma)", () => {
    assert.equal(formatearFechaLarga("2026-09-11"), "Viernes 11 de septiembre");
  });
});

const SLOTS = [
  { especialistaId: 1, especialistaNombre: "Cristal", horaTexto: "08:00", horaISO: "2026-09-11T08:00:00-05:00" },
  { especialistaId: 2, especialistaNombre: "Mary", horaTexto: "09:30", horaISO: "2026-09-11T09:30:00-05:00" },
  { especialistaId: 1, especialistaNombre: "Cristal", horaTexto: "10:00", horaISO: "2026-09-11T10:00:00-05:00" },
  { especialistaId: 4, especialistaNombre: "Jessica", horaTexto: "11:00", horaISO: "2026-09-11T11:00:00-05:00" },
  { especialistaId: 3, especialistaNombre: "Nata", horaTexto: "16:00", horaISO: "2026-09-11T16:00:00-05:00" },
];

describe("construirMenuHorarios -- slots reales ya resueltos por Nylas, backend decide el corte, nunca Gemini", () => {
  it("máximo 4 opciones reales, agrega 'Ver más horarios' cuando sobran", () => {
    const menu = construirMenuHorarios(SLOTS);
    assert.equal(menu.opciones.length, 5);
    assert.equal(menu.opciones[4]!.id, "VER_MAS_HORARIOS");
    assert.ok(menu.pendientes);
    assert.equal(menu.pendientes!.length, 1);
  });

  it("formatea hora en 12h con AM/PM real (nunca inventa el horario)", () => {
    const menu = construirMenuHorarios(SLOTS.slice(0, 1));
    assert.equal(menu.opciones[0]!.label, "Cristal — 8:00 AM");
    assert.deepEqual(parseSlotHorarioId(menu.opciones[0]!.id), { especialistaId: 1, horaISO: "2026-09-11T08:00:00-05:00" });
  });

  it("dos especialistas con la MISMA hora real nunca colisionan en id (bug real evitado)", () => {
    const mismaHora = [
      { especialistaId: 1, especialistaNombre: "Cristal", horaTexto: "08:00", horaISO: "2026-09-11T08:00:00-05:00" },
      { especialistaId: 2, especialistaNombre: "Mary", horaTexto: "08:00", horaISO: "2026-09-11T08:00:00-05:00" },
    ];
    const menu = construirMenuHorarios(mismaHora);
    assert.notEqual(menu.opciones[0]!.id, menu.opciones[1]!.id);
    assert.deepEqual(parseSlotHorarioId(menu.opciones[0]!.id), { especialistaId: 1, horaISO: "2026-09-11T08:00:00-05:00" });
    assert.deepEqual(parseSlotHorarioId(menu.opciones[1]!.id), { especialistaId: 2, horaISO: "2026-09-11T08:00:00-05:00" });
  });

  it("PM correcto (16:00 -> 4:00 PM)", () => {
    const menu = construirMenuHorarios([SLOTS[4]!]);
    assert.equal(menu.opciones[0]!.label, "Nata — 4:00 PM");
  });

  it("continuarMenuHorarios muestra el resto sin volver a consultar Nylas", () => {
    const primero = construirMenuHorarios(SLOTS);
    const segundo = continuarMenuHorarios(primero.pendientes!);
    assert.equal(segundo.opciones.length, 1);
    assert.equal(segundo.opciones[0]!.label, "Nata — 4:00 PM");
  });
});

describe("construirMenuConfirmacion -- 3 opciones fijas, siempre las mismas", () => {
  it("Confirmar cita / Cambiar horario / Cancelar, en ese orden, con ids de control reales", () => {
    const menu = construirMenuConfirmacion();
    assert.deepEqual(
      menu.opciones.map((o) => o.id),
      [ID_CONFIRMAR_CITA, ID_CAMBIAR_HORARIO, ID_CANCELAR],
    );
  });
});

describe("resolverSeleccionMenu -- determinista, nunca Gemini, nunca aproxima", () => {
  const menuServicios = construirMenuServicios(CATALOGO.slice(0, 2));

  it("número exacto resuelve la opción real", () => {
    assert.equal(resolverSeleccionMenu("1", menuServicios)!.id, "s-dipping");
    assert.equal(resolverSeleccionMenu("2", menuServicios)!.id, "s-presson");
  });

  it("número con espacios alrededor también resuelve (trim, nunca falla por formato)", () => {
    assert.equal(resolverSeleccionMenu("  1  ", menuServicios)!.id, "s-dipping");
  });

  it("número fuera de rango -> undefined (nunca aproxima a la más cercana)", () => {
    assert.equal(resolverSeleccionMenu("99", menuServicios), undefined);
  });

  it("texto exacto (case/acentos insensible) resuelve por nombre real", () => {
    assert.equal(resolverSeleccionMenu("Dipping", menuServicios)!.id, "s-dipping");
    assert.equal(resolverSeleccionMenu("dipping", menuServicios)!.id, "s-dipping");
    assert.equal(resolverSeleccionMenu("PRESS ON", menuServicios)!.id, "s-presson");
  });

  it("texto ambiguo/no relacionado -> undefined, nunca infiere ni aproxima", () => {
    assert.equal(resolverSeleccionMenu("algo que no existe", menuServicios), undefined);
    assert.equal(resolverSeleccionMenu("no sé cuál", menuServicios), undefined);
  });

  it("id directo (defensivo) también resuelve", () => {
    assert.equal(resolverSeleccionMenu("s-dipping", menuServicios)!.id, "s-dipping");
  });

  it("en menú de confirmación, 'sí' EXPLÍCITO resuelve a CONFIRM_APPOINTMENT vía el vocabulario cerrado ya existente", () => {
    const menu = construirMenuConfirmacion();
    assert.equal(resolverSeleccionMenu("Sí", menu)!.id, ID_CONFIRMAR_CITA);
    assert.equal(resolverSeleccionMenu("confirmo", menu)!.id, ID_CONFIRMAR_CITA);
  });

  it("en menú de confirmación, cancelación explícita resuelve a CANCELAR", () => {
    const menu = construirMenuConfirmacion();
    assert.equal(resolverSeleccionMenu("no", menu)!.id, ID_CANCELAR);
    assert.equal(resolverSeleccionMenu("cancela", menu)!.id, ID_CANCELAR);
  });

  it("en menú de confirmación, frase ambigua ('creo que sí') NUNCA confirma -- mismo vocabulario cerrado de siempre", () => {
    const menu = construirMenuConfirmacion();
    assert.equal(resolverSeleccionMenu("creo que sí", menu), undefined);
    assert.equal(resolverSeleccionMenu("esa está bien", menu), undefined);
  });

  it("fuera de un menú de confirmación, 'sí' NUNCA resuelve nada (el vocabulario cerrado de confirmación no aplica a otros menús)", () => {
    assert.equal(resolverSeleccionMenu("sí", menuServicios), undefined);
  });
});

describe("renderizarMenu / textoSeleccionInvalida -- texto siempre reconstruido, nunca redactado por Gemini", () => {
  it("menú de servicio incluye el encabezado real y las opciones numeradas", () => {
    const menu = construirMenuServicios(CATALOGO.slice(0, 2));
    const texto = renderizarMenu(menu, {});
    assert.match(texto, /¿Qué servicio deseas realizarte\?/);
    assert.match(texto, /1\. Dipping/);
    assert.match(texto, /2\. Press On/);
  });

  it("menú de horario incluye la fecha real elegida en el encabezado", () => {
    const menu = construirMenuHorarios(SLOTS.slice(0, 1));
    const texto = renderizarMenu(menu, { fechaISO: "2026-09-11" });
    assert.match(texto, /para el Viernes 11 de septiembre/);
  });

  it("menú de confirmación arma el resumen real a partir del acumulador, nunca vuelve a consultar nada", () => {
    const texto = renderizarMenu(construirMenuConfirmacion(), {
      servicioNombre: "Dipping",
      especialistaSeleccionadaNombre: "Cristal",
      horarioSeleccionadoISO: "2026-09-11T08:00:00-05:00",
      duracionMin: 120,
      precio: 60000,
    });
    assert.match(texto, /Servicio: Dipping/);
    assert.match(texto, /Profesional: Cristal/);
    assert.match(texto, /Fecha: Viernes 11 de septiembre/);
    assert.match(texto, /Hora: 8:00 AM/);
    assert.match(texto, /Duración: 2 h/);
    assert.match(texto, /Valor: \$60\.000/);
    assert.match(texto, /¿Deseas confirmar tu cita\?/);
  });

  it("textoSeleccionInvalida antepone el mensaje de error y reenvía EXACTAMENTE el mismo menú", () => {
    const menu = construirMenuServicios(CATALOGO.slice(0, 2));
    const texto = textoSeleccionInvalida(menu, {});
    assert.match(texto, /^Por favor selecciona una de las opciones disponibles/);
    assert.match(texto, /1\. Dipping/);
  });
});
