/**
 * AGENDA V2 (autorizado) — pruebas del router de aislamiento. Todas las
 * dependencias reales (candado, sesiones, escenarios, catálogo, envío real
 * de WhatsApp) están inyectadas con fakes en memoria -- ningún test toca
 * Supabase real, Nylas, ni envía un mensaje real.
 *
 * Ajuste de UX (autorizado) -- el catálogo de prueba ahora tiene DOS
 * categorías reales (Cabello, Uñas) para poder probar que el menú
 * jerárquico (categoría -> servicios de esa categoría) nunca mezcla
 * servicios de una categoría con otra.
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
import { construirOpcionesCategoria } from "@/lib/agenda-v2/categorias";

const FAKE_SUPABASE = {} as SupabaseClient;

const CATALOGO_FIXTURE: ServicioCatalogoReal[] = [
  { id: "s-peinado-real", nombre: "Peinado", precio: 40000, duracionMin: 60, categoria: "Cabello", descripcion: null },
  { id: "s-dipping-real", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-presson-real", nombre: "Press On", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-retoques-real", nombre: "Retoques", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
];

const SERVICIOS_UNAS = CATALOGO_FIXTURE.filter((s) => s.categoria === "Uñas");

/** numero 1 = Cabello, numero 2 = Uñas (mismo orden del catálogo, ver construirOpcionesCategoria). */
const NUMERO_CATEGORIA_UNAS = "2";

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

describe("B. 'Quiero una cita' sin sesión previa -> ajuste UX: crea la sesión y muestra el menú REAL de CATEGORÍAS (nunca los servicios directos)", () => {
  it("crea la sesión en S1_SERVICIO con las categorías reales guardadas, y envía el menú de categorías (nunca los 28 servicios de un jalón)", async () => {
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

    // Las opciones guardadas son categorías reales -- nunca servicios, nunca inventadas.
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesCategoria(CATALOGO_FIXTURE));

    assert.equal(envios.enviados.length, 1);
    assert.match(envios.enviados[0]!.mensaje, /¿Qué tipo de servicio te gustaría agendar\?/);
    assert.match(envios.enviados[0]!.mensaje, /1\. Cabello/);
    assert.match(envios.enviados[0]!.mensaje, /2\. Uñas/);
    assert.doesNotMatch(envios.enviados[0]!.mensaje, /Dipping|Press On|Retoques|Peinado/, "el primer menú es de categorías, nunca de servicios individuales");
  });

  it("al elegir una categoría real, muestra SOLO los servicios reales de ESA categoría", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "Quiero una cita", wamid: "w1" },
      deps,
    );
    const r2 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: NUMERO_CATEGORIA_UNAS, wamid: "w2" },
      deps,
    );
    assert.equal(r2.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO", "sigue siendo S1_SERVICIO -- nunca un step nuevo");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesServicio(SERVICIOS_UNAS));

    assert.equal(envios.enviados.length, 2);
    assert.match(envios.enviados[1]!.mensaje, /¿Qué servicio deseas realizarte\?/);
    assert.match(envios.enviados[1]!.mensaje, /1\. Dipping — \$60\.000/);
    assert.match(envios.enviados[1]!.mensaje, /2\. Press On — \$80\.000/);
    assert.match(envios.enviados[1]!.mensaje, /3\. Retoques — \$60\.000/);
    assert.doesNotMatch(envios.enviados[1]!.mensaje, /Peinado|Cabello/, "nunca mezcla servicios de otra categoría");
    assert.doesNotMatch(envios.enviados[1]!.mensaje, /Acrílicas|Secado Rápido|Base Ruber/, "nunca servicios inventados o no-reservables");
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

describe("Test 1 -- seleccionar categoría y luego servicio guarda un servicio_id REAL y avanza a S2_PROFESIONAL", () => {
  it("de punta a punta vía el router real (creación -> categoría -> servicio)", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      deps,
    );
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: NUMERO_CATEGORIA_UNAS, wamid: "w2" },
      deps,
    );
    const r3 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w3" },
      deps,
    );
    assert.equal(r3.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL");
    assert.equal(sesiones.filas[0]!.servicioId, "s-dipping-real");
    assert.equal(sesiones.filas[0]!.opcionesMostradas, null, "las opciones de servicio ya no corresponden al paso siguiente");
    assert.equal(envios.enviados[2]!.mensaje, "Servicio seleccionado correctamente.");
  });
});

describe("Test 2/3 -- entradas inválidas durante S1_SERVICIO (sub-fase servicio) permanecen en S1_SERVICIO, sin tocar Flow Engine", () => {
  it("Test 2: número fuera de rango ('999') no avanza ni cambia el servicio", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      deps,
    );
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: NUMERO_CATEGORIA_UNAS, wamid: "w2" },
      deps,
    );
    const r3 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "999", wamid: "w3" },
      deps,
    );
    assert.equal(r3.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO");
    assert.equal(sesiones.filas[0]!.servicioId, null);
    assert.match(envios.enviados[2]!.mensaje, /No reconocí esa opción/);
  });

  it("Test 3: texto ambiguo ('hola'/'quiero el dipping'/'no sé') no avanza -- NUNCA usa Gemini ni Flow Engine para decidir", async () => {
    const { deps, sesiones, envios } = armarDeps({ cargarEscenariosReal: cargarEscenariosNuncaDebeLlamarse });
    // La sesión ya existe (creada directamente, sin pasar por el router), ya
    // en la sub-fase de SERVICIO (opciones reales de la categoría Uñas) --
    // así se puede probar, con la MISMA garantía dura de "esto NUNCA se
    // llama", que ninguno de los 3 mensajes ambiguos siguientes se acerca a
    // cargarEscenariosReal/resolverEscenario.
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "w1",
      opcionesMostradas: construirOpcionesServicio(SERVICIOS_UNAS),
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
  it("'cumpleaños' con sesión activa en sub-fase de SERVICIO -> Agenda V2 la trata como selección inválida, cargarEscenariosReal JAMÁS se invoca", async () => {
    const { deps, sesiones, envios } = armarDeps({ cargarEscenariosReal: cargarEscenariosNuncaDebeLlamarse });
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "wamid-0",
      opcionesMostradas: construirOpcionesServicio(SERVICIOS_UNAS),
    });

    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cumpleaños", wamid: "wamid-1" },
      deps,
    );
    assert.deepEqual(r, { manejado: true });
    assert.match(envios.enviados[0]!.mensaje, /No reconocí esa opción/, "Agenda V2 responde por su cuenta, nunca el flujo de cumpleaños");
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO");
  });

  it("'cumpleaños' con sesión activa en sub-fase de CATEGORÍA -> mismo criterio: Agenda V2 la trata como selección inválida de categoría", async () => {
    const { deps, sesiones, envios } = armarDeps({ cargarEscenariosReal: cargarEscenariosNuncaDebeLlamarse });
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "wamid-0",
      opcionesMostradas: construirOpcionesCategoria(CATALOGO_FIXTURE),
    });

    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cumpleaños", wamid: "wamid-1" },
      deps,
    );
    assert.deepEqual(r, { manejado: true });
    assert.match(envios.enviados[0]!.mensaje, /No reconocí esa opción/);
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO");
  });

  it("'cualquier cosa' con sesión activa -> mismo resultado, Agenda V2 sigue teniendo el control", async () => {
    const { deps, sesiones, envios } = armarDeps({ cargarEscenariosReal: cargarEscenariosNuncaDebeLlamarse });
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "wamid-0",
      opcionesMostradas: construirOpcionesServicio(SERVICIOS_UNAS),
    });

    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cualquier cosa", wamid: "wamid-1" },
      deps,
    );
    assert.deepEqual(r, { manejado: true });
    assert.match(envios.enviados[0]!.mensaje, /No reconocí esa opción/);
  });

  it("secuencia completa: quiero una cita -> Uñas -> cumpleaños (inválido) -> '1' (Dipping, válido) -> cancelar -> vuelve a la normalidad", async () => {
    const { deps, sesiones, envios } = armarDeps();

    const r1 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "Quiero una cita", wamid: "w1" },
      deps,
    );
    assert.equal(r1.manejado, true);
    assert.equal(sesiones.filas[0]!.activo, true);
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO");

    const rCategoria = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: NUMERO_CATEGORIA_UNAS, wamid: "w2" },
      deps,
    );
    assert.equal(rCategoria.manejado, true);
    assert.match(envios.enviados[1]!.mensaje, /¿Qué servicio deseas realizarte\?/);

    const r2 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cumpleaños", wamid: "w3" },
      deps,
    );
    assert.equal(r2.manejado, true);
    assert.match(envios.enviados[2]!.mensaje, /No reconocí esa opción/);
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO", "cumpleaños nunca debe avanzar el step");

    const r3 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w4" },
      deps,
    );
    assert.equal(r3.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL");
    assert.equal(sesiones.filas[0]!.servicioId, "s-dipping-real");

    const r4 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cancelar", wamid: "w5" },
      deps,
    );
    assert.equal(r4.manejado, true);
    assert.equal(sesiones.filas[0]!.activo, false, "la sesión debe quedar cerrada");

    // "y solamente DESPUÉS de eso" un nuevo mensaje vuelve al comportamiento normal.
    const r5 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "¿Qué es el Dipping?", wamid: "w6" },
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

    // A avanza hasta elegir categoría Uñas y luego "2" (Press On) -- nunca debe afectar el mapping de B.
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: NUMERO_CATEGORIA_UNAS, wamid: "wA2" },
      deps,
    );
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "2", wamid: "wA3" },
      deps,
    );
    assert.equal(sesiones.filas[0]!.servicioId, "s-presson-real");
    assert.equal(sesiones.filas[1]!.step, "S1_SERVICIO", "B nunca avanza por una acción de A");
    assert.equal(sesiones.filas[1]!.servicioId, null);
    assert.deepEqual(sesiones.filas[1]!.opcionesMostradas, construirOpcionesCategoria(CATALOGO_FIXTURE), "B sigue viendo categorías, nunca los servicios que eligió A");

    // Cancelar la de A nunca debe afectar a B.
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cancelar", wamid: "wA4" },
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

  it("mismo wamid, ahora con una selección de SERVICIO ya procesada -- tampoco reprocesa ni vuelve a cambiar el servicio", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      deps,
    );
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: NUMERO_CATEGORIA_UNAS, wamid: "w2" },
      deps,
    );
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w3" },
      deps,
    );
    assert.equal(envios.enviados.length, 3);
    assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL");

    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w3" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(envios.enviados.length, 3, "el wamid w3 ya se procesó -- nunca se reenvía una cuarta vez");
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

describe("Ajuste de UX (autorizado) -- menú jerárquico categoría -> servicio", () => {
  it("Test 9: servicio final pertenece REALMENTE a la categoría elegida -- Cabello nunca devuelve un servicio de Uñas ni viceversa", async () => {
    const { deps: depsCabello, sesiones: sesionesCabello } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      depsCabello,
    );
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w2" }, // 1 = Cabello
      depsCabello,
    );
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w3" }, // único servicio de Cabello
      depsCabello,
    );
    assert.equal(sesionesCabello.filas[0]!.servicioId, "s-peinado-real");

    const { deps: depsUnas, sesiones: sesionesUnas } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      depsUnas,
    );
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: NUMERO_CATEGORIA_UNAS, wamid: "w2" },
      depsUnas,
    );
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "3", wamid: "w3" }, // Retoques
      depsUnas,
    );
    assert.equal(sesionesUnas.filas[0]!.servicioId, "s-retoques-real");
  });

  it("Test 10: número de categoría fuera de rango o texto no numérico -- permanece mostrando categorías, nunca inventa ni avanza", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      deps,
    );
    for (const [i, mensaje] of ["99", "uñas", "hola"].entries()) {
      const r = await procesarMensajeConAgendaV2(
        { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: mensaje, wamid: `w-inv-${i}` },
        deps,
      );
      assert.equal(r.manejado, true);
      assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesCategoria(CATALOGO_FIXTURE), `"${mensaje}" nunca debe cambiar las opciones mostradas`);
      assert.match(envios.enviados.at(-1)!.mensaje, /No reconocí esa opción/);
      assert.match(envios.enviados.at(-1)!.mensaje, /1\. Cabello/, "reenvía EXACTAMENTE las mismas categorías reales");
    }
  });

  it("aislamiento -- durante la sub-fase de categoría, cargarEscenariosReal jamás se invoca (ni con mensajes que calzarían un escenario del Flow Engine)", async () => {
    const { deps, sesiones } = armarDeps({ cargarEscenariosReal: cargarEscenariosNuncaDebeLlamarse });
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "w0",
      opcionesMostradas: construirOpcionesCategoria(CATALOGO_FIXTURE),
    });
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero agendar", wamid: "w1" },
      deps,
    );
    assert.equal(r.manejado, true, "no lanzó -- nunca llegó a cargarEscenariosReal");
  });

  it("'cancelar' cierra la sesión estando todavía en la sub-fase de categoría (antes de elegir cualquier servicio)", async () => {
    const { deps, sesiones } = armarDeps();
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      deps,
    );
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cancelar", wamid: "w2" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.activo, false);
  });

  it("defensivo -- si la categoría elegida se queda sin servicios activos justo antes de confirmarla, nunca rompe: vuelve a mostrar categorías actualizadas", async () => {
    let catalogoActual = CATALOGO_FIXTURE;
    const { deps, sesiones, envios } = armarDeps({ cargarCatalogoReal: async () => catalogoActual });
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" },
      deps,
    );
    // Entre mostrar categorías y la selección, "Cabello" se queda sin servicios activos.
    catalogoActual = CATALOGO_FIXTURE.filter((s) => s.categoria !== "Cabello");
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w2" }, // 1 = Cabello (ya vacía)
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO", "nunca rompe ni avanza sobre datos inconsistentes");
    assert.match(envios.enviados[1]!.mensaje, /Esa categoría ya no tiene servicios disponibles/);
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesCategoria(catalogoActual), "las categorías reenviadas ya no incluyen Cabello");
  });
});
