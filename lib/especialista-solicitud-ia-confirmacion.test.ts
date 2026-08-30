/**
 * Fase 2 (bug crítico real, prueba 314 sin confirmación) — candado real de
 * código en la herramienta LEGACY crear_solicitud_cita, aislado por tenant
 * vía ClienteConfig.requiere_confirmacion_cita.
 *
 * Se prueba en aislamiento la lógica del candado y del schema condicional
 * (debeExigirConfirmacionAntesDeCrearCita / buildCrearSolicitudCitaTool),
 * sin montar toda la conversación con Claude real -- generarRespuestaConEspecialistaIA
 * instancia el SDK de Anthropic directamente y no es inyectable, así que
 * probar el flujo conversacional completo requeriría interceptar HTTP real;
 * lo relevante para la seguridad (que NO se pueda crear la cita sin
 * confirmado=true cuando el flag está activo, y que el comportamiento no
 * cambie en absoluto cuando no lo está) vive enteramente en estas dos
 * funciones puras, que SÍ se prueban de extremo a extremo aquí.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  debeExigirConfirmacionAntesDeCrearCita,
  buildCrearSolicitudCitaTool,
  buildCambiarHoraMiCitaTool,
  buildAceptarPropuestaHorarioTool,
} from "@/lib/especialista-solicitud-ia";
import type { ClienteConfig } from "@/lib/supabase";

type AnyTool = ReturnType<typeof buildCrearSolicitudCitaTool>;
function schemaProps(tool: AnyTool): Record<string, unknown> {
  return (tool.input_schema as { properties: Record<string, unknown> }).properties;
}
function schemaRequired(tool: AnyTool): string[] {
  return (tool.input_schema as { required?: string[] }).required ?? [];
}

describe("Fase 2 — debeExigirConfirmacionAntesDeCrearCita (candado real)", () => {
  it("G. flag=false (u ausente) -- NUNCA exige confirmación, sin importar el input (comportamiento LEGACY actual intacto)", () => {
    const sinFlag = {} as Pick<ClienteConfig, "requiere_confirmacion_cita">;
    const flagFalse = { requiere_confirmacion_cita: false } as Pick<ClienteConfig, "requiere_confirmacion_cita">;
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(sinFlag, {}), false);
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(sinFlag, { confirmado: false }), false);
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(flagFalse, {}), false);
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(flagFalse, { confirmado: false }), false);
  });

  it("F. flag=true y sin confirmado=true -- SIEMPRE bloquea, sin importar qué otro dato venga en el input", () => {
    const conFlag = { requiere_confirmacion_cita: true } as Pick<ClienteConfig, "requiere_confirmacion_cita">;
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(conFlag, {}), true);
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(conFlag, { confirmado: false }), true);
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(conFlag, { confirmado: "true" }), true, "un string 'true' no es el booleano true -- no debe colarse");
    assert.equal(
      debeExigirConfirmacionAntesDeCrearCita(conFlag, { servicio: "manos", fecha: "2026-09-04", hora: "16:00", nombre_cliente: "Duvan" }),
      true,
      "tener los 4 datos completos NO es lo mismo que confirmado=true -- exactamente el caso real de la cita #553",
    );
  });

  it("F. flag=true y confirmado=true -- deja pasar (la creación real ya no está bloqueada por este candado)", () => {
    const conFlag = { requiere_confirmacion_cita: true } as Pick<ClienteConfig, "requiere_confirmacion_cita">;
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(conFlag, { confirmado: true }), false);
  });
});

describe("Fase 2 — buildCrearSolicitudCitaTool (schema condicional por tenant)", () => {
  it("G. requiereConfirmacion=false -- schema IDÉNTICO al original (mismo nombre, sin campo confirmado, required de 4 campos)", () => {
    const tool = buildCrearSolicitudCitaTool(false);
    assert.equal(tool.name, "crear_solicitud_cita");
    assert.equal("confirmado" in schemaProps(tool), false);
    assert.deepEqual(schemaRequired(tool), ["servicio", "fecha", "hora", "nombre_cliente"]);
  });

  it("F. requiereConfirmacion=true -- agrega confirmado como propiedad Y como required", () => {
    const tool = buildCrearSolicitudCitaTool(true);
    assert.equal(tool.name, "crear_solicitud_cita");
    assert.equal("confirmado" in schemaProps(tool), true);
    assert.deepEqual(schemaRequired(tool), ["servicio", "fecha", "hora", "nombre_cliente", "confirmado"]);
  });

  it("las propiedades base (servicio/fecha/hora/nombre_cliente/duracion_min) son idénticas en ambas variantes", () => {
    const sinFlag = schemaProps(buildCrearSolicitudCitaTool(false));
    const conFlag = schemaProps(buildCrearSolicitudCitaTool(true));
    for (const key of ["servicio", "fecha", "hora", "nombre_cliente", "duracion_min"]) {
      assert.deepEqual(conFlag[key], sinFlag[key], `la propiedad "${key}" no debe cambiar entre variantes`);
    }
  });
});

// ============================================================
// Fase 2b (bug crítico real, cierre de huecos adicionales) --
// cambiar_hora_mi_cita: mismo candado, misma función genérica.
// ============================================================

describe("Fase 2b — cambiar_hora_mi_cita: candado real (reutiliza debeExigirConfirmacionAntesDeCrearCita)", () => {
  it("1. Daniela (flag=true) + confirmado=true → permite continuar (no bloquea)", () => {
    const daniela = { requiere_confirmacion_cita: true } as Pick<ClienteConfig, "requiere_confirmacion_cita">;
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(daniela, { fecha: "2026-09-04", hora: "16:00", confirmado: true }), false);
  });

  it("2. Daniela (flag=true) + confirmado=false → bloquea", () => {
    const daniela = { requiere_confirmacion_cita: true } as Pick<ClienteConfig, "requiere_confirmacion_cita">;
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(daniela, { fecha: "2026-09-04", hora: "16:00", confirmado: false }), true);
  });

  it("3. Daniela (flag=true) sin confirmado en el input → bloquea", () => {
    const daniela = { requiere_confirmacion_cita: true } as Pick<ClienteConfig, "requiere_confirmacion_cita">;
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(daniela, { fecha: "2026-09-04", hora: "16:00" }), true);
  });

  it("4. tenant con flag=false → comportamiento LEGACY intacto, nunca bloquea sin importar el input", () => {
    const otroTenant = { requiere_confirmacion_cita: false } as Pick<ClienteConfig, "requiere_confirmacion_cita">;
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(otroTenant, { fecha: "2026-09-04", hora: "16:00" }), false);
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(otroTenant, { fecha: "2026-09-04", hora: "16:00", confirmado: false }), false);
  });
});

describe("Fase 2b — buildCambiarHoraMiCitaTool (schema condicional)", () => {
  it("requiereConfirmacion=false -- schema IDÉNTICO al original (sin campo confirmado, required=[fecha,hora])", () => {
    const tool = buildCambiarHoraMiCitaTool(false);
    assert.equal(tool.name, "cambiar_hora_mi_cita");
    assert.equal("confirmado" in schemaProps(tool), false);
    assert.deepEqual(schemaRequired(tool), ["fecha", "hora"]);
  });

  it("requiereConfirmacion=true -- agrega confirmado como propiedad Y como required", () => {
    const tool = buildCambiarHoraMiCitaTool(true);
    assert.equal("confirmado" in schemaProps(tool), true);
    assert.deepEqual(schemaRequired(tool), ["fecha", "hora", "confirmado"]);
  });

  it("fecha/hora son idénticas en ambas variantes", () => {
    const sinFlag = schemaProps(buildCambiarHoraMiCitaTool(false));
    const conFlag = schemaProps(buildCambiarHoraMiCitaTool(true));
    for (const key of ["fecha", "hora"]) {
      assert.deepEqual(conFlag[key], sinFlag[key], `la propiedad "${key}" no debe cambiar entre variantes`);
    }
  });
});

// ============================================================
// Fase 2b -- aceptar_propuesta_horario: antes sin ningún dato
// (properties: {}), ahora exige confirmado=true cuando el flag
// está activo. "La especialista propuso" NUNCA es lo mismo que
// "la clienta ya aceptó".
// ============================================================

describe("Fase 2b — aceptar_propuesta_horario: candado real", () => {
  it("5. Daniela (flag=true) + confirmado=true → permite aceptar", () => {
    const daniela = { requiere_confirmacion_cita: true } as Pick<ClienteConfig, "requiere_confirmacion_cita">;
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(daniela, { confirmado: true }), false);
  });

  it("6. Daniela (flag=true) + confirmado=false → bloquea", () => {
    const daniela = { requiere_confirmacion_cita: true } as Pick<ClienteConfig, "requiere_confirmacion_cita">;
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(daniela, { confirmado: false }), true);
  });

  it("7. Daniela (flag=true) sin confirmado (llamada 'sin argumentos', como era el schema original) → bloquea", () => {
    const daniela = { requiere_confirmacion_cita: true } as Pick<ClienteConfig, "requiere_confirmacion_cita">;
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(daniela, {}), true);
  });

  it("8. tenant con flag=false → comportamiento anterior intacto (llamar sin argumentos sigue funcionando)", () => {
    const otroTenant = { requiere_confirmacion_cita: false } as Pick<ClienteConfig, "requiere_confirmacion_cita">;
    assert.equal(debeExigirConfirmacionAntesDeCrearCita(otroTenant, {}), false);
  });
});

describe("Fase 2b — buildAceptarPropuestaHorarioTool (schema condicional)", () => {
  it("requiereConfirmacion=false -- schema IDÉNTICO al original: sin propiedades, se puede llamar 'sin argumentos'", () => {
    const tool = buildAceptarPropuestaHorarioTool(false);
    assert.equal(tool.name, "aceptar_propuesta_horario");
    assert.deepEqual(schemaProps(tool), {});
    assert.deepEqual(schemaRequired(tool), []);
  });

  it("requiereConfirmacion=true -- ya NO se puede llamar sin argumentos: exige confirmado", () => {
    const tool = buildAceptarPropuestaHorarioTool(true);
    assert.equal("confirmado" in schemaProps(tool), true);
    assert.deepEqual(schemaRequired(tool), ["confirmado"]);
  });
});
