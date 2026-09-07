import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { manejarMensajeAgendaV2, RESPUESTA_PLACEHOLDER_AGENDA_V2 } from "@/lib/agenda-v2/controlador";
import type { SesionAgendaV2 } from "@/lib/agenda-v2/sesiones";

const SESION_BASE: SesionAgendaV2 = {
  id: 1,
  tenantId: "amore-test",
  telefonoCliente: "573148127388",
  activo: true,
  step: "S1_SERVICIO",
  servicioId: null,
  profesionalId: null,
  fechaIso: null,
  slotSeleccionado: null,
  opcionesMostradas: null,
  ultimoWamidProcesado: "wamid-anterior",
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
};

describe("manejarMensajeAgendaV2 -- controlador mínimo de esta fase", () => {
  it("'cancelar' cierra la sesión", () => {
    const r = manejarMensajeAgendaV2(SESION_BASE, "cancelar");
    assert.equal(r.accion, "cerrar_sesion");
    assert.match(r.respuesta, /cancel/i);
  });

  it("'Cancelar' (mayúscula) también cierra -- insensible a mayúsculas", () => {
    const r = manejarMensajeAgendaV2(SESION_BASE, "Cancelar");
    assert.equal(r.accion, "cerrar_sesion");
  });

  it("cualquier otro mensaje (válido o no) devuelve la respuesta temporal, sin cerrar sesión", () => {
    for (const mensaje of ["1", "cualquier cosa", "cumpleaños", "¿qué es el dipping?", "asdkjaslkd"]) {
      const r = manejarMensajeAgendaV2(SESION_BASE, mensaje);
      assert.equal(r.accion, "continuar", `"${mensaje}" no debía cerrar la sesión`);
      assert.equal(r.respuesta, RESPUESTA_PLACEHOLDER_AGENDA_V2);
    }
  });

  it("nunca aproxima 'cancelar' -- una palabra que solo la contiene no cuenta (coincidencia exacta)", () => {
    const r = manejarMensajeAgendaV2(SESION_BASE, "no quiero cancelar todavía");
    assert.equal(r.accion, "continuar", "coincidencia EXACTA, nunca 'contains', para comandos de control");
  });
});
