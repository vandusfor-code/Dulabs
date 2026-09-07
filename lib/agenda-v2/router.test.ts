/**
 * AGENDA V2 (autorizado) — pruebas del router de aislamiento. Todas las
 * dependencias reales (candado, sesiones, escenarios, catálogo, envío real
 * de WhatsApp) están inyectadas con fakes en memoria -- ningún test toca
 * Supabase real, Nylas, ni envía un mensaje real.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { procesarMensajeConAgendaV2, type AgendaV2RouterDeps } from "@/lib/agenda-v2/router";
import type { SesionAgendaV2, CambiosSesionAgendaV2 } from "@/lib/agenda-v2/sesiones";
import { AMORE_ESCENARIOS_SEED } from "@/lib/bot-escenarios/seed-amore";
import type { EscenarioRow } from "@/lib/bot-escenarios/tipos";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";
import { construirOpcionesServicio } from "@/lib/agenda-v2/servicios";

const FAKE_SUPABASE = {} as SupabaseClient;

const CATALOGO_FIXTURE: ServicioCatalogoReal[] = [
  { id: "s-dipping-real", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-presson-real", nombre: "Press On", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-retoques-real", nombre: "Retoques", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
];

function escenariosDe(tenantId: string): EscenarioRow[] {
  return AMORE_ESCENARIOS_SEED.map((s, i) => ({ ...s, id: `${tenantId}-e${i}`, tenantId }));
}

/** Store en memoria -- reproduce el comportamiento real de "una sola sesión activa por (tenant, telefono)" sin tocar Postgres. */
function crearFakeSesiones() {
  const filas: SesionAgendaV2[] = [];
  let siguienteId = 1;
  return {
    filas,
    buscarSesionActiva: async (_s: unknown, tenantId: string, telefono: string) =>
      filas.find((f) => f.tenantId === tenantId && f.telefonoCliente === telefono && f.activo) ?? null,
    crearSesion: async (_s: unknown, params: { tenantId: string; telefonoCliente: string; wamid: string; opcionesMostradas?: unknown }) => {
      const nueva: SesionAgendaV2 = {
        id: siguienteId++,
        tenantId: params.tenantId,
        telefonoCliente: params.telefonoCliente,
        activo: true,
        step: "S1_SERVICIO",
        servicioId: null,
        profesionalId: null,
        fechaIso: null,
        slotSeleccionado: null,
        opcionesMostradas: params.opcionesMostradas ?? null,
        ultimoWamidProcesado: params.wamid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      filas.push(nueva);
      return nueva;
    },
    cerrarSesion: async (_s: unknown, id: number) => {
      const f = filas.find((x) => x.id === id);
      if (f) f.activo = false;
    },
    actualizarSesion: async (_s: unknown, id: number, cambios: CambiosSesionAgendaV2) => {
      const f = filas.find((x) => x.id === id);
      if (f) Object.assign(f, { ...cambios, updatedAt: new Date().toISOString() });
    },
  };
}

function crearFakeCandado() {
  const llamadas: string[] = [];
  return {
    llamadas,
    adquirir: async (phoneNumberId: string, telefono: string, wamid: string) => {
      llamadas.push(`adquirir:${phoneNumberId}:${telefono}:${wamid}`);
      return true;
    },
    liberar: async (phoneNumberId: string, telefono: string, wamid: string) => {
      llamadas.push(`liberar:${phoneNumberId}:${telefono}:${wamid}`);
    },
  };
}

function crearFakeEnvios() {
  const enviados: Array<{ tenantId: string; telefono: string; mensaje: string }> = [];
  return {
    enviados,
    enviarMensajeWhatsApp: async (params: { tenantId: string; telefono: string; mensaje: string }) => {
      enviados.push(params);
      return { ok: true, data: { ok: true } } as const;
    },
  };
}

/** Falla a propósito si se llama -- usado para PROBAR que, con sesión activa, el router jamás carga escenarios (o sea, jamás se acerca a resolverEscenario/Flow Engine). */
async function cargarEscenariosNuncaDebeLlamarse(): Promise<EscenarioRow[]> {
  throw new Error("cargarEscenariosReal NO debía llamarse -- había una sesión activa de Agenda V2");
}

function armarDeps(overrides: Partial<AgendaV2RouterDeps> = {}): {
  deps: AgendaV2RouterDeps;
  sesiones: ReturnType<typeof crearFakeSesiones>;
  candado: ReturnType<typeof crearFakeCandado>;
  envios: ReturnType<typeof crearFakeEnvios>;
} {
  const sesiones = crearFakeSesiones();
  const candado = crearFakeCandado();
  const envios = crearFakeEnvios();
  const deps: AgendaV2RouterDeps = {
    adquirirCandadoChat: candado.adquirir,
    liberarCandadoChat: candado.liberar,
    buscarSesionActiva: sesiones.buscarSesionActiva,
    crearSesion: sesiones.crearSesion,
    cerrarSesion: sesiones.cerrarSesion,
    actualizarSesion: sesiones.actualizarSesion,
    cargarEscenariosReal: async (_s, tenantId) => escenariosDe(tenantId),
    cargarCatalogoReal: async () => CATALOGO_FIXTURE,
    enviarMensajeWhatsApp: envios.enviarMensajeWhatsApp,
    ...overrides,
  };
  return { deps, sesiones, candado, envios };
}

describe("A. Sin sesión Agenda V2, mensaje que NO dispara inicio -> comportamiento normal (Flow Engine)", () => {
  it("devuelve manejado:false, sin crear sesión ni enviar nada", async () => {
    const { deps, sesiones, envios } = armarDeps();
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "¿Qué es el Dipping?", wamid: "wamid-1" },
      deps,
    );
    assert.deepEqual(r, { manejado: false });
    assert.equal(sesiones.filas.length, 0, "nunca debe crear una sesión para un mensaje normal");
    assert.equal(envios.enviados.length, 0, "Agenda V2 nunca debe responder si no la maneja");
  });
});

describe("B. 'Quiero una cita' sin sesión previa -> FASE 2: crea la sesión y muestra el menú REAL de servicios", () => {
  it("crea la sesión en S1_SERVICIO con las opciones reales guardadas, y envía el menú real (nunca inventado)", async () => {
    const { deps, sesiones, envios } = armarDeps();
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "Quiero una cita", wamid: "wamid-1" },
      deps,
    );
    assert.deepEqual(r, { manejado: true });
    assert.equal(sesiones.filas.length, 1);
    assert.equal(sesiones.filas[0]!.activo, true);
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO");
    assert.equal(sesiones.filas[0]!.tenantId, "amore-test");
    assert.equal(sesiones.filas[0]!.telefonoCliente, "573148127388");

    // Test 8 -- las opciones guardadas en la sesión corresponden EXACTAMENTE
    // a las opciones reales del catálogo mockeado (nunca inventadas).
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesServicio(CATALOGO_FIXTURE));

    assert.equal(envios.enviados.length, 1);
    assert.match(envios.enviados[0]!.mensaje, /¿Qué servicio deseas realizarte\?/);
    assert.match(envios.enviados[0]!.mensaje, /1\. Dipping — \$60\.000/);
    assert.match(envios.enviados[0]!.mensaje, /2\. Press On — \$80\.000/);
    assert.match(envios.enviados[0]!.mensaje, /3\. Retoques — \$60\.000/);
    assert.doesNotMatch(envios.enviados[0]!.mensaje, /Acrílicas|Secado Rápido|Base Ruber/, "nunca servicios inventados o no-reservables");
  });

  it("funciona con la frase completa del ejemplo real ('...necesito hacerme las uñas')", async () => {
    const { deps, sesiones } = armarDeps();
    await procesarMensajeConAgendaV2(
      {
        supabase: FAKE_SUPABASE,
        idTenant: "amore-test",
        telefono: "573148127388",
        texto: "Hola, quiero una cita, necesito hacerme las uñas",
        wamid: "wamid-1",
      },
      deps,
    );
    assert.equal(sesiones.filas.length, 1);
  });
});

describe("Test 1 -- seleccionar '1' guarda un service_id REAL y avanza a S2_PROFESIONAL", () => {
  it("de punta a punta vía el router real (creación + selección)", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      deps,
    );
    const r2 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w2" },
      deps,
    );
    assert.equal(r2.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL");
    assert.equal(sesiones.filas[0]!.servicioId, "s-dipping-real");
    assert.equal(sesiones.filas[0]!.opcionesMostradas, null, "las opciones de servicio ya no corresponden al paso siguiente");
    assert.equal(envios.enviados[1]!.mensaje, "Servicio seleccionado correctamente.");
  });
});

describe("Test 2/3 -- entradas inválidas durante S1_SERVICIO permanecen en S1_SERVICIO, sin tocar Flow Engine", () => {
  it("Test 2: número fuera de rango ('999') no avanza ni cambia el servicio", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      deps,
    );
    const r2 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "999", wamid: "w2" },
      deps,
    );
    assert.equal(r2.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO");
    assert.equal(sesiones.filas[0]!.servicioId, null);
    assert.match(envios.enviados[1]!.mensaje, /No reconocí esa opción/);
  });

  it("Test 3: texto ambiguo ('hola'/'quiero el dipping'/'no sé') no avanza -- NUNCA usa Gemini ni Flow Engine para decidir", async () => {
    const { deps, sesiones, envios } = armarDeps({ cargarEscenariosReal: cargarEscenariosNuncaDebeLlamarse });
    // La sesión ya existe (creada directamente, sin pasar por el router) --
    // así se puede probar, con la MISMA garantía dura de "esto NUNCA se
    // llama", que ninguno de los 3 mensajes ambiguos siguientes se acerca a
    // cargarEscenariosReal/resolverEscenario.
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "w1",
      opcionesMostradas: construirOpcionesServicio(CATALOGO_FIXTURE),
    });
    for (const [i, mensaje] of ["hola", "quiero el dipping", "no sé"].entries()) {
      const r = await procesarMensajeConAgendaV2(
        { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: mensaje, wamid: `w-inv-${i}` },
        deps,
      );
      assert.equal(r.manejado, true);
      assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO", `"${mensaje}" no debía avanzar el step`);
      assert.equal(sesiones.filas[0]!.servicioId, null, `"${mensaje}" no debía fijar ningún servicio`);
    }
    assert.equal(envios.enviados.length, 3); // 3 reintentos (la sesión se creó directamente, sin pasar por el router)
  });
});

describe("Test 4/5 -- un mensaje que coincide con un escenario del Flow Engine sigue siendo Agenda V2", () => {
  it("'cumpleaños' con sesión activa en S1_SERVICIO -> Agenda V2 la trata como selección inválida, cargarEscenariosReal JAMÁS se invoca", async () => {
    const { deps, sesiones, envios } = armarDeps({ cargarEscenariosReal: cargarEscenariosNuncaDebeLlamarse });
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "wamid-0",
      opcionesMostradas: construirOpcionesServicio(CATALOGO_FIXTURE),
    });

    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cumpleaños", wamid: "wamid-1" },
      deps,
    );
    assert.deepEqual(r, { manejado: true });
    assert.match(envios.enviados[0]!.mensaje, /No reconocí esa opción/, "Agenda V2 responde por su cuenta, nunca el flujo de cumpleaños");
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO");
  });

  it("'cualquier cosa' con sesión activa -> mismo resultado, Agenda V2 sigue teniendo el control", async () => {
    const { deps, sesiones, envios } = armarDeps({ cargarEscenariosReal: cargarEscenariosNuncaDebeLlamarse });
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "wamid-0",
      opcionesMostradas: construirOpcionesServicio(CATALOGO_FIXTURE),
    });

    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cualquier cosa", wamid: "wamid-1" },
      deps,
    );
    assert.deepEqual(r, { manejado: true });
    assert.match(envios.enviados[0]!.mensaje, /No reconocí esa opción/);
  });

  it("secuencia completa: quiero una cita -> cumpleaños (inválido) -> '1' (válido) -> cancelar -> vuelve a la normalidad", async () => {
    const { deps, sesiones, envios } = armarDeps();

    const r1 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "Quiero una cita", wamid: "w1" },
      deps,
    );
    assert.equal(r1.manejado, true);
    assert.equal(sesiones.filas[0]!.activo, true);
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO");

    const r2 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cumpleaños", wamid: "w2" },
      deps,
    );
    assert.equal(r2.manejado, true);
    assert.match(envios.enviados[1]!.mensaje, /No reconocí esa opción/);
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO", "cumpleaños nunca debe avanzar el step");

    const r3 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w3" },
      deps,
    );
    assert.equal(r3.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL");
    assert.equal(sesiones.filas[0]!.servicioId, "s-dipping-real");

    const r4 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cancelar", wamid: "w4" },
      deps,
    );
    assert.equal(r4.manejado, true);
    assert.equal(sesiones.filas[0]!.activo, false, "la sesión debe quedar cerrada");

    // "y solamente DESPUÉS de eso" un nuevo mensaje vuelve al comportamiento normal.
    const r5 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "¿Qué es el Dipping?", wamid: "w5" },
      deps,
    );
    assert.equal(r5.manejado, false, "tras cancelar, un mensaje normal ya no debe interceptarlo Agenda V2");
  });
});

describe("Test 6 -- Dos teléfonos distintos -> mappings de opciones completamente independientes", () => {
  it("nunca mezcla el estado ni las opciones entre dos clientas del mismo tenant", async () => {
    const { deps, sesiones } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "wA1" },
      deps,
    );
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573000000000", texto: "quiero una cita", wamid: "wB1" },
      deps,
    );
    assert.equal(sesiones.filas.length, 2);
    assert.equal(sesiones.filas[0]!.telefonoCliente, "573148127388");
    assert.equal(sesiones.filas[1]!.telefonoCliente, "573000000000");

    // A selecciona "2" (Press On) -- nunca debe afectar el mapping de B.
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "2", wamid: "wA2" },
      deps,
    );
    assert.equal(sesiones.filas[0]!.servicioId, "s-presson-real");
    assert.equal(sesiones.filas[1]!.step, "S1_SERVICIO", "B nunca avanza por una acción de A");
    assert.equal(sesiones.filas[1]!.servicioId, null);

    // Cancelar la de A nunca debe afectar a B.
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cancelar", wamid: "wA3" },
      deps,
    );
    assert.equal(sesiones.filas[0]!.activo, false);
    assert.equal(sesiones.filas[1]!.activo, true, "la sesión de B nunca debe cerrarse por una acción de A");
  });
});

describe("Test 7 -- Dos tenants distintos con el MISMO teléfono -> aislamiento total", () => {
  it("nunca mezcla sesiones de tenants distintos aunque el teléfono real coincida", async () => {
    const { deps, sesiones } = armarDeps();
    const TELEFONO = "573148127388";
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-a", telefono: TELEFONO, texto: "quiero una cita", wamid: "w1" }, deps);

    // Tenant B, mismo teléfono, sin sesión propia -> "cumpleaños" NUNCA debe
    // encontrar la sesión de A (buscarSesionActiva siempre filtra por tenant_id).
    const rB = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "tenant-b", telefono: TELEFONO, texto: "cumpleaños", wamid: "w2" },
      deps,
    );
    assert.equal(rB.manejado, false, "tenant B no tiene sesión propia -- debe seguir su comportamiento normal");

    assert.equal(sesiones.filas.length, 1, "solo existe la sesión real de tenant-a");
    assert.equal(sesiones.filas[0]!.tenantId, "tenant-a");
  });
});

describe("F. Mismo wamid recibido dos veces -> nunca se duplica ni se reprocesa", () => {
  it("el wamid que CREA la sesión, si llega de nuevo, no crea una segunda sesión ni reenvía nada", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "wamid-duplicado" },
      deps,
    );
    assert.equal(sesiones.filas.length, 1);
    assert.equal(envios.enviados.length, 1);

    // Mismo wamid exacto, entregado de nuevo (duplicado real de Baileys).
    const r2 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "wamid-duplicado" },
      deps,
    );
    assert.equal(r2.manejado, true);
    assert.equal(sesiones.filas.length, 1, "nunca debe crear una segunda sesión");
    assert.equal(envios.enviados.length, 1, "nunca debe reenviar el mensaje");
  });

  it("mismo wamid, ahora con una selección real ya procesada -- tampoco reprocesa ni vuelve a cambiar el servicio", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      deps,
    );
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w2" },
      deps,
    );
    assert.equal(envios.enviados.length, 2);
    assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL");

    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w2" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(envios.enviados.length, 2, "el wamid w2 ya se procesó -- nunca se reenvía una tercera vez");
    assert.equal(sesiones.filas.length, 1);
    assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL", "nunca se vuelve a procesar la selección");
  });
});

describe("Concurrencia (sección 7) -- reutiliza el candado real, nunca otro mecanismo", () => {
  it("adquiere y libera el candado con el mismo phone_number_id sintético que ya usa WhatsApp-QR", async () => {
    const { deps, candado } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      deps,
    );
    assert.deepEqual(candado.llamadas, [
      "adquirir:whatsapp-qr:amore-test:573148127388:w1",
      "liberar:whatsapp-qr:amore-test:573148127388:w1",
    ]);
  });

  it("libera el candado incluso si el envío del mensaje lanza una excepción", async () => {
    const { deps, candado } = armarDeps({
      enviarMensajeWhatsApp: async () => {
        throw new Error("fallo de red simulado");
      },
    });
    await assert.rejects(() =>
      procesarMensajeConAgendaV2(
        { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
        deps,
      ),
    );
    assert.deepEqual(candado.llamadas, [
      "adquirir:whatsapp-qr:amore-test:573148127388:w1",
      "liberar:whatsapp-qr:amore-test:573148127388:w1",
    ]);
  });

  it("si buscar la sesión lanza una excepción, libera el candado igual (nunca deja el candado tomado)", async () => {
    const { deps, candado } = armarDeps({
      buscarSesionActiva: async () => {
        throw new Error("fallo de Supabase simulado");
      },
    });
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      deps,
    );
    assert.deepEqual(candado.llamadas, [
      "adquirir:whatsapp-qr:amore-test:573148127388:w1",
      "liberar:whatsapp-qr:amore-test:573148127388:w1",
    ]);
  });
});

describe("Resiliencia -- Agenda V2 nunca puede romper el canal completo de WhatsApp-QR", () => {
  it("si buscarSesionActiva falla (ej. la migración todavía no se aplicó en producción), cae al comportamiento normal EN VEZ de tumbar el mensaje", async () => {
    const { deps, envios } = armarDeps({
      buscarSesionActiva: async () => {
        throw new Error('relation "dulabs_agenda_v2_sesiones" does not exist');
      },
    });
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      deps,
    );
    assert.deepEqual(r, { manejado: false }, "nunca debe propagar el error -- route.ts debe poder seguir con ejecutarBotWhatsAppQR");
    assert.equal(envios.enviados.length, 0);
  });
});
