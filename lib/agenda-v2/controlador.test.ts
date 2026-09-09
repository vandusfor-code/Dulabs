import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { manejarMensajeAgendaV2 } from "@/lib/agenda-v2/controlador";
import type { SesionAgendaV2 } from "@/lib/agenda-v2/sesiones";
import type { OpcionServicioAgendaV2 } from "@/lib/agenda-v2/servicios";
import type { OpcionCategoriaAgendaV2 } from "@/lib/agenda-v2/categorias";
import type { OpcionProfesionalAgendaV2 } from "@/lib/agenda-v2/profesionales";
import type { OpcionFechaAgendaV2 } from "@/lib/agenda-v2/fechas";
import type { OpcionHoraAgendaV2 } from "@/lib/agenda-v2/horas";
import { OPCIONES_CONFIRMACION } from "@/lib/agenda-v2/confirmacion";
import { construirOpcionesCita, OPCIONES_SI_NO, type CitaParaMenu } from "@/lib/agenda-v2/gestion-citas";

const OPCIONES: OpcionServicioAgendaV2[] = [
  { numero: 1, servicioId: "s-dipping-real", nombre: "Dipping", precio: 60000, duracionMin: 120 },
  { numero: 2, servicioId: "s-presson-real", nombre: "Press On", precio: 80000, duracionMin: 120 },
  { numero: 3, servicioId: "s-retoques-real", nombre: "Retoques", precio: 60000, duracionMin: 120 },
];

const CATEGORIAS: OpcionCategoriaAgendaV2[] = [
  { numero: 1, categoria: "Cabello" },
  { numero: 2, categoria: "Uñas" },
];

const OPCIONES_PROFESIONAL: OpcionProfesionalAgendaV2[] = [
  { numero: 1, profesionalId: 1262, nombre: "Mary" },
  { numero: 2, profesionalId: 1265, nombre: "Jessica" },
];

const OPCIONES_FECHA: OpcionFechaAgendaV2[] = [
  { numero: 1, fechaIso: "2026-09-08", etiqueta: "Martes 8 de septiembre" },
  { numero: 2, fechaIso: "2026-09-09", etiqueta: "Miércoles 9 de septiembre" },
];

const OPCIONES_HORA: OpcionHoraAgendaV2[] = [
  { numero: 1, fechaIso: "2026-09-08", hora: "09:00" },
  { numero: 2, fechaIso: "2026-09-08", hora: "10:30" },
  { numero: 3, fechaIso: "2026-09-08", hora: "14:00" },
];

function sesionEnServicio(overrides: Partial<SesionAgendaV2> = {}): SesionAgendaV2 {
  return {
    id: 1,
    tenantId: "amore-test",
    telefonoCliente: "573148127388",
    activo: true,
    step: "S1_SERVICIO",
    servicioId: null,
    serviciosIds: null,
    profesionalId: null,
    fechaIso: null,
    slotSeleccionado: null,
    opcionesMostradas: OPCIONES,
    ultimoWamidProcesado: "wamid-anterior",
    citaObjetivoId: null,
    accionGestion: null,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("manejarMensajeAgendaV2 -- 'cancelar' cierra la sesión sea cual sea el step", () => {
  it("cierra en S1_SERVICIO", () => {
    const r = manejarMensajeAgendaV2(sesionEnServicio(), "cancelar");
    assert.equal(r.accion, "cerrar_sesion");
    assert.match(r.respuesta, /cancel/i);
  });

  it("'Cancelar' (mayúscula) también cierra -- insensible a mayúsculas", () => {
    const r = manejarMensajeAgendaV2(sesionEnServicio(), "Cancelar");
    assert.equal(r.accion, "cerrar_sesion");
  });

  it("nunca aproxima 'cancelar' -- una frase que solo lo contiene no cuenta (coincidencia exacta)", () => {
    const r = manejarMensajeAgendaV2(sesionEnServicio(), "no quiero cancelar todavía");
    assert.equal(r.accion, "continuar");
  });
});

describe("FASE 2 -- manejarMensajeAgendaV2 en S1_SERVICIO", () => {
  it("Test 1: '1' resuelve contra las opciones reales guardadas -- devuelve accion:'servicio_seleccionado' con el servicio_id REAL (router.ts arma el menú de profesionales, ver FASE 3)", () => {
    const r = manejarMensajeAgendaV2(sesionEnServicio(), "1");
    // FASE 3 (autorizado, multi-servicio) -- servicioIds SIEMPRE un arreglo,
    // incluso para una selección de un solo servicio (comportamiento 100%
    // equivalente al servicioId anterior, ver resolverSeleccionMultiServicio).
    assert.deepEqual(r, { accion: "servicio_seleccionado", servicioIds: ["s-dipping-real"] });
  });

  it("selecciona correctamente la opción 2 y 3 (nunca asume que sigue siendo la posición 1)", () => {
    const r2 = manejarMensajeAgendaV2(sesionEnServicio(), "2");
    assert.deepEqual(r2, { accion: "servicio_seleccionado", servicioIds: ["s-presson-real"] });
    const r3 = manejarMensajeAgendaV2(sesionEnServicio(), "3");
    assert.deepEqual(r3, { accion: "servicio_seleccionado", servicioIds: ["s-retoques-real"] });
  });

  it("Test 2: número inválido (fuera de rango) -- permanece en S1_SERVICIO, sin cambios de servicio", () => {
    const r = manejarMensajeAgendaV2(sesionEnServicio(), "999");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios, undefined, "nunca debe avanzar de step ni tocar servicioId");
    assert.match(r.respuesta, /No reconocí esa opción/);
    assert.match(r.respuesta, /1\. Dipping/, "vuelve a mostrar las mismas opciones reales");
  });

  it("Test 3: texto ambiguo/no numérico -- permanece en S1_SERVICIO", () => {
    for (const mensaje of ["hola", "quiero el dipping", "no sé", "no se", "asdkjaslkd"]) {
      const r = manejarMensajeAgendaV2(sesionEnServicio(), mensaje);
      assert.equal(r.accion, "continuar", `"${mensaje}" nunca debe cerrar la sesión`);
      if (r.accion !== "continuar") continue;
      assert.equal(r.cambios, undefined, `"${mensaje}" nunca debe avanzar el step`);
      assert.match(r.respuesta, /No reconocí esa opción/, `"${mensaje}" debe repetir el menú, nunca aproximar`);
    }
  });

  it("'quiero el dipping' (nombre real exacto en texto libre) es INVÁLIDO para esta fase -- solo número, nunca texto", () => {
    const r = manejarMensajeAgendaV2(sesionEnServicio(), "quiero el dipping");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios, undefined);
    assert.match(r.respuesta, /No reconocí esa opción/);
  });

  it("Test 8: la opción reenviada tras un error corresponde EXACTAMENTE a las opciones guardadas en la sesión", () => {
    const r = manejarMensajeAgendaV2(sesionEnServicio(), "no sé");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    for (const o of OPCIONES) {
      assert.match(r.respuesta, new RegExp(`${o.numero}\\. ${o.nombre}`));
    }
  });

  it("defensivo: sesión en S1_SERVICIO sin opciones guardadas -- nunca inventa, pide reiniciar", () => {
    const r = manejarMensajeAgendaV2(sesionEnServicio({ opcionesMostradas: null }), "1");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios, undefined);
    assert.match(r.respuesta, /Se perdió el menú/);
  });
});

describe("Ajuste de UX (autorizado) -- manejarMensajeAgendaV2 en la sub-fase de CATEGORÍA", () => {
  function sesionEnCategoria(overrides: Partial<SesionAgendaV2> = {}): SesionAgendaV2 {
    return sesionEnServicio({ opcionesMostradas: CATEGORIAS, ...overrides });
  }

  it("número válido -> devuelve accion:'categoria_seleccionada' con la categoría real, sin tocar la sesión todavía (eso lo hace router.ts con el catálogo real)", () => {
    const r = manejarMensajeAgendaV2(sesionEnCategoria(), "2");
    assert.deepEqual(r, { accion: "categoria_seleccionada", categoria: "Uñas" });
  });

  it("otra categoría también resuelve correctamente (nunca asume que sigue siendo la posición 1)", () => {
    const r = manejarMensajeAgendaV2(sesionEnCategoria(), "1");
    assert.deepEqual(r, { accion: "categoria_seleccionada", categoria: "Cabello" });
  });

  it("número fuera de rango -- permanece mostrando categorías, nunca avanza", () => {
    const r = manejarMensajeAgendaV2(sesionEnCategoria(), "99");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios, undefined);
    assert.match(r.respuesta, /No reconocí esa opción/);
    assert.match(r.respuesta, /1\. Cabello/);
    assert.match(r.respuesta, /2\. Uñas/);
  });

  it("texto no numérico (incluido el nombre real de la categoría) -- nunca resuelve por texto libre, solo número exacto", () => {
    for (const mensaje of ["hola", "uñas", "quiero uñas", "no sé"]) {
      const r = manejarMensajeAgendaV2(sesionEnCategoria(), mensaje);
      assert.equal(r.accion, "continuar", `"${mensaje}" nunca debe resolver una categoría por texto libre`);
      if (r.accion !== "continuar") continue;
      assert.equal(r.cambios, undefined);
      assert.match(r.respuesta, /No reconocí esa opción/);
    }
  });

  it("'cancelar' cierra la sesión también estando en la sub-fase de categoría", () => {
    const r = manejarMensajeAgendaV2(sesionEnCategoria(), "cancelar");
    assert.equal(r.accion, "cerrar_sesion");
  });

  it("sesión en S1_SERVICIO sin opciones guardadas -- nunca inventa, pide reiniciar (igual que en la sub-fase de servicio)", () => {
    const r = manejarMensajeAgendaV2(sesionEnCategoria({ opcionesMostradas: null }), "1");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios, undefined);
    assert.match(r.respuesta, /Se perdió el menú/);
  });
});

describe("FASE 3 (autorizado) -- manejarMensajeAgendaV2 en S2_PROFESIONAL", () => {
  function sesionEnProfesional(overrides: Partial<SesionAgendaV2> = {}): SesionAgendaV2 {
    return sesionEnServicio({
      step: "S2_PROFESIONAL",
      servicioId: "s-cejas-cuchilla-real",
      opcionesMostradas: OPCIONES_PROFESIONAL,
      ...overrides,
    });
  }

  it("Test 3/7: '1' resuelve contra las opciones reales guardadas -- devuelve accion:'profesional_seleccionado' con el profesional_id REAL (router.ts arma el menú de días, ver FASE 4)", () => {
    const r = manejarMensajeAgendaV2(sesionEnProfesional(), "1");
    assert.deepEqual(r, { accion: "profesional_seleccionado", profesionalId: 1262 });
  });

  it("otra opción también resuelve correctamente (nunca asume que sigue siendo la posición 1)", () => {
    const r = manejarMensajeAgendaV2(sesionEnProfesional(), "2");
    assert.deepEqual(r, { accion: "profesional_seleccionado", profesionalId: 1265 });
  });

  it("Test 4: número inválido (fuera de rango) -- permanece en S2_PROFESIONAL, sin cambios de profesional", () => {
    const r = manejarMensajeAgendaV2(sesionEnProfesional(), "999");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios, undefined, "nunca debe avanzar de step ni tocar profesionalId");
    assert.match(r.respuesta, /No reconocí esa opción/);
    assert.match(r.respuesta, /1\. Mary/, "vuelve a mostrar las mismas opciones reales");
  });

  it("Test 5: texto ambiguo/no numérico -- permanece en S2_PROFESIONAL", () => {
    for (const mensaje of ["hola", "quiero cualquiera", "mary", "no sé"]) {
      const r = manejarMensajeAgendaV2(sesionEnProfesional(), mensaje);
      assert.equal(r.accion, "continuar", `"${mensaje}" nunca debe cerrar la sesión`);
      if (r.accion !== "continuar") continue;
      assert.equal(r.cambios, undefined, `"${mensaje}" nunca debe avanzar el step`);
      assert.match(r.respuesta, /No reconocí esa opción/, `"${mensaje}" debe repetir el menú, nunca aproximar`);
    }
  });

  it("Test 13: la opción reenviada tras un error corresponde EXACTAMENTE a las opciones guardadas en la sesión", () => {
    const r = manejarMensajeAgendaV2(sesionEnProfesional(), "no sé");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    for (const o of OPCIONES_PROFESIONAL) {
      assert.match(r.respuesta, new RegExp(`${o.numero}\\. ${o.nombre}`));
    }
  });

  it("'cancelar' cierra la sesión también estando en S2_PROFESIONAL", () => {
    const r = manejarMensajeAgendaV2(sesionEnProfesional(), "cancelar");
    assert.equal(r.accion, "cerrar_sesion");
  });

  it("'cumpleaños' (coincide con un escenario del Flow Engine) -- se trata como selección inválida, nunca invoca Flow Engine", () => {
    const r = manejarMensajeAgendaV2(sesionEnProfesional(), "cumpleaños");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.match(r.respuesta, /No reconocí esa opción/);
    assert.equal(r.cambios, undefined);
  });

  it("defensivo: sesión en S2_PROFESIONAL sin opciones guardadas -- nunca inventa, pide reiniciar", () => {
    const r = manejarMensajeAgendaV2(sesionEnProfesional({ opcionesMostradas: null }), "1");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios, undefined);
    assert.match(r.respuesta, /Se perdió el menú/);
  });
});

describe("FASE 4 (autorizado) -- manejarMensajeAgendaV2 en S3_DIA", () => {
  function sesionEnFecha(overrides: Partial<SesionAgendaV2> = {}): SesionAgendaV2 {
    return sesionEnServicio({
      step: "S3_DIA",
      servicioId: "s-cejas-cuchilla-real",
      profesionalId: 1262,
      // Corrección post-deploy (autorizada, "Ver más fechas") --
      // opcionesMostradas para S3_DIA ya no es un arreglo plano, ver
      // lib/agenda-v2/controlador.ts::manejarSeleccionFecha.
      opcionesMostradas: { opciones: OPCIONES_FECHA, numeroVerMasFechas: null },
      ...overrides,
    });
  }

  it("Test 9: '1' resuelve contra las opciones reales guardadas -- devuelve accion:'fecha_seleccionada' con la fecha real (router.ts arma el menú de horas, ver FASE 5)", () => {
    const r = manejarMensajeAgendaV2(sesionEnFecha(), "1");
    assert.deepEqual(r, { accion: "fecha_seleccionada", fechaIso: "2026-09-08" });
  });

  it("otra opción también resuelve correctamente (nunca asume que sigue siendo la posición 1)", () => {
    const r = manejarMensajeAgendaV2(sesionEnFecha(), "2");
    assert.deepEqual(r, { accion: "fecha_seleccionada", fechaIso: "2026-09-09" });
  });

  it("Test 10: número inválido (fuera de rango) -- permanece en S3_DIA, sin cambiar fechaIso ni step", () => {
    const r = manejarMensajeAgendaV2(sesionEnFecha(), "999");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios, undefined);
    assert.match(r.respuesta, /No reconocí esa opción/);
    assert.match(r.respuesta, /1\. Martes 8 de septiembre/, "vuelve a mostrar las mismas opciones reales");
  });

  it("Test 10: texto ambiguo/no numérico ('el sábado', 'mañana') -- permanece en S3_DIA, nunca lo interpreta como fecha", () => {
    for (const mensaje of ["hola", "el sábado", "mañana", "no sé"]) {
      const r = manejarMensajeAgendaV2(sesionEnFecha(), mensaje);
      assert.equal(r.accion, "continuar", `"${mensaje}" nunca debe cerrar la sesión`);
      if (r.accion !== "continuar") continue;
      assert.equal(r.cambios, undefined, `"${mensaje}" nunca debe avanzar el step`);
      assert.match(r.respuesta, /No reconocí esa opción/, `"${mensaje}" debe repetir el menú, nunca aproximar`);
    }
  });

  it("Test 23: la opción reenviada tras un error corresponde EXACTAMENTE a las opciones guardadas en la sesión", () => {
    const r = manejarMensajeAgendaV2(sesionEnFecha(), "no sé");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    for (const o of OPCIONES_FECHA) {
      assert.match(r.respuesta, new RegExp(`${o.numero}\\. ${o.etiqueta}`));
    }
  });

  it("'cancelar' cierra la sesión también estando en S3_DIA", () => {
    const r = manejarMensajeAgendaV2(sesionEnFecha(), "cancelar");
    assert.equal(r.accion, "cerrar_sesion");
  });

  it("Test 19: 'cumpleaños' (coincide con un escenario del Flow Engine) -- se trata como selección inválida, nunca invoca Flow Engine", () => {
    const r = manejarMensajeAgendaV2(sesionEnFecha(), "cumpleaños");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.match(r.respuesta, /No reconocí esa opción/);
    assert.equal(r.cambios, undefined);
  });

  it("defensivo: sesión en S3_DIA sin opciones guardadas -- nunca inventa, pide reiniciar", () => {
    const r = manejarMensajeAgendaV2(sesionEnFecha({ opcionesMostradas: null }), "1");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios, undefined);
    assert.match(r.respuesta, /Se perdió el menú/);
  });

  describe("CORRECCIÓN (autorizada, 'Ver más fechas')", () => {
    it("Test 6/8 (obligatorios) -- '3' con numeroVerMasFechas=3 -> accion:'ver_mas_fechas_solicitado', NUNCA se interpreta como una fecha real", () => {
      const r = manejarMensajeAgendaV2(sesionEnFecha({ opcionesMostradas: { opciones: OPCIONES_FECHA, numeroVerMasFechas: 3 } }), "3");
      assert.deepEqual(r, { accion: "ver_mas_fechas_solicitado" });
    });

    it("Test 15 (obligatorio) -- '3' cuando NO hay 'Ver más fechas' (numeroVerMasFechas=null) sigue siendo una selección inválida, NUNCA activa la acción especial", () => {
      const r = manejarMensajeAgendaV2(sesionEnFecha({ opcionesMostradas: { opciones: OPCIONES_FECHA, numeroVerMasFechas: null } }), "3");
      assert.equal(r.accion, "continuar");
      if (r.accion !== "continuar") return;
      assert.match(r.respuesta, /No reconocí esa opción/);
      assert.doesNotMatch(r.respuesta, /Ver más fechas/);
    });

    it("con 'Ver más fechas' presente, un número real (ej. '1') sigue resolviendo la fecha normalmente -- ambos caminos conviven sin pisarse", () => {
      const r = manejarMensajeAgendaV2(sesionEnFecha({ opcionesMostradas: { opciones: OPCIONES_FECHA, numeroVerMasFechas: 3 } }), "1");
      assert.deepEqual(r, { accion: "fecha_seleccionada", fechaIso: "2026-09-08" });
    });

    it("defensivo: opcionesMostradas en el formato ANTERIOR (arreglo plano, sesión creada antes de esta corrección) -- nunca rompe, pide reiniciar de forma segura", () => {
      const r = manejarMensajeAgendaV2(sesionEnFecha({ opcionesMostradas: OPCIONES_FECHA as unknown as SesionAgendaV2["opcionesMostradas"] }), "1");
      assert.equal(r.accion, "continuar");
      if (r.accion !== "continuar") return;
      assert.match(r.respuesta, /Se perdió el menú/);
    });
  });
});

describe("FASE 5 (autorizado) -- manejarMensajeAgendaV2 en S4_HORA", () => {
  function sesionEnHora(overrides: Partial<SesionAgendaV2> = {}): SesionAgendaV2 {
    return sesionEnServicio({
      step: "S4_HORA",
      servicioId: "s-cejas-cuchilla-real",
      profesionalId: 1262,
      fechaIso: "2026-09-08",
      opcionesMostradas: OPCIONES_HORA,
      ...overrides,
    });
  }

  it("Test 16/17: '1' resuelve contra las opciones reales guardadas -- devuelve accion:'hora_seleccionada' con fecha+hora reales (router.ts arma el resumen, ver FASE 6)", () => {
    const r = manejarMensajeAgendaV2(sesionEnHora(), "1");
    assert.deepEqual(r, { accion: "hora_seleccionada", fechaIso: "2026-09-08", hora: "09:00" });
  });

  it("otra opción también resuelve correctamente (nunca asume que sigue siendo la posición 1)", () => {
    const r = manejarMensajeAgendaV2(sesionEnHora(), "3");
    assert.deepEqual(r, { accion: "hora_seleccionada", fechaIso: "2026-09-08", hora: "14:00" });
  });

  it("Test 17: número inválido (fuera de rango) -- permanece en S4_HORA, sin guardar ningún slot", () => {
    const r = manejarMensajeAgendaV2(sesionEnHora(), "999");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios, undefined);
    assert.match(r.respuesta, /No reconocí esa opción/);
    assert.match(r.respuesta, /1\. 9:00 a\. m\./, "vuelve a mostrar las mismas opciones reales");
  });

  it("Test 17: texto ambiguo/no numérico -- permanece en S4_HORA", () => {
    for (const mensaje of ["hola", "9 am", "la de las 2", "no sé"]) {
      const r = manejarMensajeAgendaV2(sesionEnHora(), mensaje);
      assert.equal(r.accion, "continuar", `"${mensaje}" nunca debe cerrar la sesión`);
      if (r.accion !== "continuar") continue;
      assert.equal(r.cambios, undefined, `"${mensaje}" nunca debe avanzar el step`);
      assert.match(r.respuesta, /No reconocí esa opción/, `"${mensaje}" debe repetir el menú, nunca aproximar`);
    }
  });

  it("'cancelar' cierra la sesión también estando en S4_HORA", () => {
    const r = manejarMensajeAgendaV2(sesionEnHora(), "cancelar");
    assert.equal(r.accion, "cerrar_sesion");
  });

  it("Test 20: 'cumpleaños' (coincide con un escenario del Flow Engine) -- se trata como selección inválida, nunca invoca Flow Engine", () => {
    const r = manejarMensajeAgendaV2(sesionEnHora(), "cumpleaños");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.match(r.respuesta, /No reconocí esa opción/);
    assert.equal(r.cambios, undefined);
  });

  it("defensivo: sesión en S4_HORA sin opciones guardadas -- nunca inventa, pide reiniciar", () => {
    const r = manejarMensajeAgendaV2(sesionEnHora({ opcionesMostradas: null }), "1");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios, undefined);
    assert.match(r.respuesta, /Se perdió el menú/);
  });
});

describe("FASE 6 (autorizado) -- manejarMensajeAgendaV2 en S5_CONFIRMAR", () => {
  function sesionEnConfirmacion(overrides: Partial<SesionAgendaV2> = {}): SesionAgendaV2 {
    return sesionEnServicio({
      step: "S5_CONFIRMAR",
      servicioId: "s-cejas-cuchilla-real",
      profesionalId: 1262,
      fechaIso: "2026-09-08",
      slotSeleccionado: { fechaIso: "2026-09-08", hora: "09:00" },
      opcionesMostradas: OPCIONES_CONFIRMACION,
      ...overrides,
    });
  }

  it("Opción 1 (confirmar): devuelve accion:'confirmacion_confirmar' (router.ts crea la reserva real, FASE 7) -- el controlador nunca decide él mismo si se crea", () => {
    const r = manejarMensajeAgendaV2(sesionEnConfirmacion(), "1");
    assert.deepEqual(r, { accion: "confirmacion_confirmar" });
  });

  it("Opción 2 (cambiar fecha): devuelve accion:'confirmacion_cambiar_fecha' (router.ts reutiliza la Fase 4 tal cual)", () => {
    const r = manejarMensajeAgendaV2(sesionEnConfirmacion(), "2");
    assert.deepEqual(r, { accion: "confirmacion_cambiar_fecha" });
  });

  it("Opción 3 (cambiar horario): devuelve accion:'confirmacion_cambiar_hora' (router.ts reutiliza la Fase 5 tal cual)", () => {
    const r = manejarMensajeAgendaV2(sesionEnConfirmacion(), "3");
    assert.deepEqual(r, { accion: "confirmacion_cambiar_hora" });
  });

  it("Opción 4 (cancelar): cierra la sesión -- mismo resultado EXACTO que el comando global 'cancelar', nunca modifica ninguna cita existente", () => {
    const r = manejarMensajeAgendaV2(sesionEnConfirmacion(), "4");
    assert.equal(r.accion, "cerrar_sesion");
    assert.match(r.respuesta, /cancel/i);
  });

  it("número inválido (fuera de rango) -- permanece en S5_CONFIRMAR, reenvía el mismo menú de control", () => {
    const r = manejarMensajeAgendaV2(sesionEnConfirmacion(), "5");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios, undefined);
    assert.match(r.respuesta, /No reconocí esa opción/);
    assert.match(r.respuesta, /1\. Confirmar cita/);
  });

  it("texto no numérico o interpretación semántica ('sí'/'dale'/'confirmo') -- permanece en S5_CONFIRMAR, nunca se infiere", () => {
    for (const mensaje of ["hola", "sí", "dale", "confirmo", "no sé"]) {
      const r = manejarMensajeAgendaV2(sesionEnConfirmacion(), mensaje);
      assert.equal(r.accion, "continuar", `"${mensaje}" nunca debe cerrar la sesión ni confirmar nada`);
      if (r.accion !== "continuar") continue;
      assert.equal(r.cambios, undefined, `"${mensaje}" nunca debe avanzar/retroceder el step`);
      assert.match(r.respuesta, /No reconocí esa opción/, `"${mensaje}" debe repetir el menú, nunca inferir la intención`);
    }
  });

  it("'cumpleaños' (coincide con un escenario del Flow Engine) -- se trata como selección inválida, nunca invoca Flow Engine", () => {
    const r = manejarMensajeAgendaV2(sesionEnConfirmacion(), "cumpleaños");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.match(r.respuesta, /No reconocí esa opción/);
    assert.equal(r.cambios, undefined);
  });

  it("'cancelar' (comando global de texto) también cierra la sesión estando en S5_CONFIRMAR", () => {
    const r = manejarMensajeAgendaV2(sesionEnConfirmacion(), "cancelar");
    assert.equal(r.accion, "cerrar_sesion");
  });

  it("defensivo: sesión en S5_CONFIRMAR sin opciones guardadas -- nunca inventa, pide reiniciar", () => {
    const r = manejarMensajeAgendaV2(sesionEnConfirmacion({ opcionesMostradas: null }), "1");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios, undefined);
    assert.match(r.respuesta, /Se perdió el menú/);
  });
});

const CITAS_MENU: CitaParaMenu[] = [
  { citaId: 101, servicioNombre: "Células Madres", profesionalNombre: "Jessica", fechaEtiqueta: "Martes 8 de septiembre", horaTexto: "4:00 p. m." },
  { citaId: 102, servicioNombre: "Cejas con Cera", profesionalNombre: "Mary", fechaEtiqueta: "Jueves 10 de septiembre", horaTexto: "2:00 p. m." },
];

describe("FASE 8 (autorizado) -- manejarMensajeAgendaV2 en SG_SELECCIONAR_CITA", () => {
  function sesionSeleccionandoCita(overrides: Partial<SesionAgendaV2> = {}): SesionAgendaV2 {
    return sesionEnServicio({
      step: "SG_SELECCIONAR_CITA",
      servicioId: null,
      profesionalId: null,
      accionGestion: "cancelar",
      opcionesMostradas: construirOpcionesCita(CITAS_MENU),
      ...overrides,
    });
  }

  it("número exacto devuelve accion:'cita_seleccionada_para_gestion' con el citaId real correspondiente", () => {
    const r = manejarMensajeAgendaV2(sesionSeleccionandoCita(), "2");
    assert.deepEqual(r, { accion: "cita_seleccionada_para_gestion", citaId: 102 });
  });

  it("otra posición también resuelve correctamente (nunca asume la posición 1)", () => {
    const r = manejarMensajeAgendaV2(sesionSeleccionandoCita(), "1");
    assert.deepEqual(r, { accion: "cita_seleccionada_para_gestion", citaId: 101 });
  });

  it("número fuera de rango o texto no numérico -- permanece en SG_SELECCIONAR_CITA, nunca fuzzy por servicio/profesional", () => {
    for (const mensaje of ["3", "0", "Jessica", "la de células madres", "sí"]) {
      const r = manejarMensajeAgendaV2(sesionSeleccionandoCita(), mensaje);
      assert.equal(r.accion, "continuar", `"${mensaje}" nunca debía resolver una cita`);
      if (r.accion !== "continuar") continue;
      assert.equal(r.cambios, undefined);
      assert.match(r.respuesta, /No reconocí esa opción/);
    }
  });

  it("'cancelar' (comando global) cierra la sesión sin gestionar ninguna cita", () => {
    const r = manejarMensajeAgendaV2(sesionSeleccionandoCita(), "cancelar");
    assert.equal(r.accion, "cerrar_sesion");
  });

  it("defensivo: sin opciones guardadas -- nunca inventa, pide reiniciar", () => {
    const r = manejarMensajeAgendaV2(sesionSeleccionandoCita({ opcionesMostradas: null }), "1");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.match(r.respuesta, /Se perdió el menú/);
  });
});

describe("FASE 8 (autorizado) -- manejarMensajeAgendaV2 en SG_CANCELAR_CONFIRMAR", () => {
  function sesionCancelarConfirmar(overrides: Partial<SesionAgendaV2> = {}): SesionAgendaV2 {
    return sesionEnServicio({
      step: "SG_CANCELAR_CONFIRMAR",
      servicioId: null,
      profesionalId: null,
      citaObjetivoId: 101,
      opcionesMostradas: OPCIONES_SI_NO,
      ...overrides,
    });
  }

  it("Opción 1 (sí): devuelve accion:'cancelacion_confirmada' -- el controlador nunca cancela él mismo", () => {
    const r = manejarMensajeAgendaV2(sesionCancelarConfirmar(), "1");
    assert.deepEqual(r, { accion: "cancelacion_confirmada" });
  });

  it("Opción 2 (no): cierra la sesión, NUNCA modifica ninguna cita existente", () => {
    const r = manejarMensajeAgendaV2(sesionCancelarConfirmar(), "2");
    assert.equal(r.accion, "cerrar_sesion");
  });

  it("número inválido o texto libre ('sí'/'dale') -- permanece en SG_CANCELAR_CONFIRMAR, nunca se infiere", () => {
    for (const mensaje of ["3", "0", "sí", "dale", "obvio que sí"]) {
      const r = manejarMensajeAgendaV2(sesionCancelarConfirmar(), mensaje);
      assert.equal(r.accion, "continuar", `"${mensaje}" nunca debía cancelar ni cerrar`);
      if (r.accion !== "continuar") continue;
      assert.match(r.respuesta, /No reconocí esa opción/);
    }
  });

  it("defensivo: sin opciones guardadas -- nunca inventa, pide reiniciar", () => {
    const r = manejarMensajeAgendaV2(sesionCancelarConfirmar({ opcionesMostradas: null }), "1");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.match(r.respuesta, /Se perdió el menú/);
  });
});

describe("FASE 8 (autorizado) -- manejarMensajeAgendaV2 en SG_REPROGRAMAR_CONFIRMAR_INICIO", () => {
  function sesionReprogramarInicio(overrides: Partial<SesionAgendaV2> = {}): SesionAgendaV2 {
    return sesionEnServicio({
      step: "SG_REPROGRAMAR_CONFIRMAR_INICIO",
      servicioId: null,
      profesionalId: null,
      citaObjetivoId: 102,
      opcionesMostradas: OPCIONES_SI_NO,
      ...overrides,
    });
  }

  it("Opción 1 (sí): devuelve accion:'reprogramar_confirmado_inicio' -- el controlador nunca calcula disponibilidad él mismo", () => {
    const r = manejarMensajeAgendaV2(sesionReprogramarInicio(), "1");
    assert.deepEqual(r, { accion: "reprogramar_confirmado_inicio" });
  });

  it("Opción 2 (no): cierra la sesión, NUNCA modifica ninguna cita existente", () => {
    const r = manejarMensajeAgendaV2(sesionReprogramarInicio(), "2");
    assert.equal(r.accion, "cerrar_sesion");
  });

  it("número inválido o texto libre -- permanece en SG_REPROGRAMAR_CONFIRMAR_INICIO, nunca se infiere", () => {
    for (const mensaje of ["3", "sí", "dale"]) {
      const r = manejarMensajeAgendaV2(sesionReprogramarInicio(), mensaje);
      assert.equal(r.accion, "continuar", `"${mensaje}" nunca debía avanzar`);
      if (r.accion !== "continuar") continue;
      assert.match(r.respuesta, /No reconocí esa opción/);
    }
  });
});
