import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { manejarMensajeAgendaV2, RESPUESTA_PLACEHOLDER_AGENDA_V2 } from "@/lib/agenda-v2/controlador";
import type { SesionAgendaV2 } from "@/lib/agenda-v2/sesiones";
import type { OpcionServicioAgendaV2 } from "@/lib/agenda-v2/servicios";
import type { OpcionCategoriaAgendaV2 } from "@/lib/agenda-v2/categorias";
import type { OpcionProfesionalAgendaV2 } from "@/lib/agenda-v2/profesionales";

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

function sesionEnServicio(overrides: Partial<SesionAgendaV2> = {}): SesionAgendaV2 {
  return {
    id: 1,
    tenantId: "amore-test",
    telefonoCliente: "573148127388",
    activo: true,
    step: "S1_SERVICIO",
    servicioId: null,
    profesionalId: null,
    fechaIso: null,
    slotSeleccionado: null,
    opcionesMostradas: OPCIONES,
    ultimoWamidProcesado: "wamid-anterior",
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
    assert.deepEqual(r, { accion: "servicio_seleccionado", servicioId: "s-dipping-real" });
  });

  it("selecciona correctamente la opción 2 y 3 (nunca asume que sigue siendo la posición 1)", () => {
    const r2 = manejarMensajeAgendaV2(sesionEnServicio(), "2");
    assert.deepEqual(r2, { accion: "servicio_seleccionado", servicioId: "s-presson-real" });
    const r3 = manejarMensajeAgendaV2(sesionEnServicio(), "3");
    assert.deepEqual(r3, { accion: "servicio_seleccionado", servicioId: "s-retoques-real" });
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

  it("Test 3/7: '1' resuelve contra las opciones reales guardadas -- guarda un profesional_id REAL y avanza a S3_DIA", () => {
    const r = manejarMensajeAgendaV2(sesionEnProfesional(), "1");
    assert.equal(r.accion, "continuar");
    assert.equal(r.respuesta, "Profesional seleccionado correctamente.");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios?.step, "S3_DIA");
    assert.equal(r.cambios?.profesionalId, 1262);
    assert.equal(r.cambios?.opcionesMostradas, null, "Test 8: las opciones de profesional ya no corresponden al paso siguiente");
  });

  it("otra opción también resuelve correctamente (nunca asume que sigue siendo la posición 1)", () => {
    const r = manejarMensajeAgendaV2(sesionEnProfesional(), "2");
    assert.equal(r.accion, "continuar");
    if (r.accion !== "continuar") return;
    assert.equal(r.cambios?.profesionalId, 1265);
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

describe("Pasos posteriores a S2_PROFESIONAL -- todavía sin implementar (fases futuras)", () => {
  it("cualquier mensaje en S3_DIA recibe el placeholder, sin tocar profesionalId ni step", () => {
    const sesion = sesionEnServicio({
      step: "S3_DIA",
      servicioId: "s-cejas-cuchilla-real",
      profesionalId: 1262,
      opcionesMostradas: null,
    });
    for (const mensaje of ["1", "cualquier cosa", "cumpleaños"]) {
      const r = manejarMensajeAgendaV2(sesion, mensaje);
      assert.equal(r.accion, "continuar");
      if (r.accion !== "continuar") continue;
      assert.equal(r.respuesta, RESPUESTA_PLACEHOLDER_AGENDA_V2);
      assert.equal(r.cambios, undefined);
    }
  });
});
