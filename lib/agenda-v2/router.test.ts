/**
 * AGENDA V2 (autorizado) — pruebas del router de aislamiento. Todas las
 * dependencias reales (candado, sesiones, escenarios, catálogo,
 * elegibilidad de profesionales, envío real de WhatsApp) están inyectadas
 * con fakes en memoria -- ningún test toca Supabase real, Nylas, ni envía
 * un mensaje real.
 *
 * Ajuste de UX (autorizado) -- el catálogo de prueba tiene DOS categorías
 * reales (Cabello, Uñas) para poder probar que el menú jerárquico
 * (categoría -> servicios de esa categoría) nunca mezcla servicios de una
 * categoría con otra.
 *
 * FASE 3 (autorizado) -- el fixture de profesionales elegibles
 * (ESPECIALISTAS_POR_SERVICIO) refleja la MISMA estructura real verificada
 * en AMORE antes de implementar: Mary/Jessica atienden TODO, Cristal/Nata
 * SOLO Uñas -- y "s-retoques-real" se deja deliberadamente SIN ningún
 * profesional elegible para poder probar el caso "sin profesionales" sin
 * inventar un servicio nuevo.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { procesarMensajeConAgendaV2, iniciarNuevaSesionAgendaV2, type AgendaV2RouterDeps } from "@/lib/agenda-v2/router";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import type { EntradaAmore, ModoEntradaAmore } from "@/lib/amore-entrada-sesiones";
import type { SesionAgendaV2, CambiosSesionAgendaV2 } from "@/lib/agenda-v2/sesiones";
import { AMORE_ESCENARIOS_SEED } from "@/lib/bot-escenarios/seed-amore";
import type { EscenarioRow } from "@/lib/bot-escenarios/tipos";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";
import type { EspecialistaElegible } from "@/lib/asignacion-categoria";
import { construirOpcionesServicio } from "@/lib/agenda-v2/servicios";
import { construirOpcionesCategoria } from "@/lib/agenda-v2/categorias";
import { construirOpcionesProfesional } from "@/lib/agenda-v2/profesionales";
import { construirOpcionesFecha } from "@/lib/agenda-v2/fechas";
import { construirOpcionesHora } from "@/lib/agenda-v2/horas";
import { OPCIONES_CONFIRMACION } from "@/lib/agenda-v2/confirmacion";
import type { ResultadoCrearCitaNylas, DepsCrearCitaNylas, ResultadoActualizarCitaNylas } from "@/lib/reserva-servicio-nylas";
import type { CitaEspecialista, Especialista } from "@/lib/especialistas";
import type { ResultadoCancelarCitaEspecialista, ResultadoCitasActivasEspecialista } from "@/lib/especialistas-flow-adaptador";
import { construirOpcionesCita } from "@/lib/agenda-v2/gestion-citas";

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

const MARY: EspecialistaElegible = { especialistaId: 1262, nombre: "Mary" };
const CRISTAL: EspecialistaElegible = { especialistaId: 1263, nombre: "Cristal" };
const NATA: EspecialistaElegible = { especialistaId: 1264, nombre: "Nata" };
const JESSICA: EspecialistaElegible = { especialistaId: 1265, nombre: "Jessica" };

/** Fixture de elegibilidad -- espeja la estructura real de dulabs_servicio_especialista verificada en AMORE (todos los servicios de Uñas: las 4; el resto: solo Mary/Jessica), salvo "s-retoques-real" que se deja SIN elegibles a propósito para el caso "sin profesionales". */
const ESPECIALISTAS_POR_SERVICIO: Record<string, EspecialistaElegible[]> = {
  "s-peinado-real": [MARY, JESSICA],
  "s-dipping-real": [MARY, CRISTAL, NATA, JESSICA],
  "s-presson-real": [MARY, CRISTAL, NATA, JESSICA],
  "s-retoques-real": [],
};

async function resolverEspecialistasFixture(_s: unknown, _idTenant: string, servicioId: string) {
  return { modo: "explicita" as const, especialistas: ESPECIALISTAS_POR_SERVICIO[servicioId] ?? [] };
}

/**
 * FASE 4/5 (autorizado) -- fixtures de disponibilidad real. Mary/Cristal/Nata
 * tienen días reales disponibles; Jessica se deja deliberadamente SIN
 * ninguno para poder probar el caso "sin días disponibles" sin inventar un
 * profesional nuevo (mismo criterio que "s-retoques-real" sin elegibles en
 * la Fase 3). "2026-09-08"/"2026-09-09" son martes/miércoles reales.
 */
const DIAS_POR_PROFESIONAL_FIXTURE: Record<number, string[]> = {
  1262: ["2026-09-08", "2026-09-09"], // Mary
  1263: ["2026-09-08"], // Cristal
  1264: ["2026-09-08", "2026-09-09"], // Nata
  1265: [], // Jessica -- SIN días disponibles
};

async function calcularDiasCandidatosFixture(_s: unknown, params: { profesionalId: number }) {
  // hayMasFechas: false -- este fixture fijo nunca tiene más fechas reales
  // más allá de las que ya lista DIAS_POR_PROFESIONAL_FIXTURE (los tests de
  // "Ver más fechas" usan su propio fixture dedicado, ver más abajo).
  return { ok: true as const, opciones: construirOpcionesFecha(DIAS_POR_PROFESIONAL_FIXTURE[params.profesionalId] ?? []), hayMasFechas: false };
}

const HORAS_POR_FECHA_FIXTURE: Record<string, string[]> = {
  "2026-09-08": ["09:00", "10:30", "14:00"],
  "2026-09-09": ["11:00"],
};

async function calcularHorariosFechaFixture(_s: unknown, params: { fechaIso: string }) {
  const horarios = HORAS_POR_FECHA_FIXTURE[params.fechaIso] ?? [];
  if (horarios.length === 0) return { ok: false as const, motivo: "sin_horarios_ese_dia" as const };
  return { ok: true as const, horarios };
}

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
    crearSesion: async (
      _s: unknown,
      params: {
        tenantId: string;
        telefonoCliente: string;
        wamid: string;
        opcionesMostradas?: unknown;
        step?: SesionAgendaV2["step"];
        citaObjetivoId?: number | null;
        accionGestion?: SesionAgendaV2["accionGestion"];
        servicioId?: string | null;
        serviciosIds?: string[] | null;
        profesionalId?: number | null;
        fechaIso?: string | null;
      },
    ) => {
      const nueva: SesionAgendaV2 = {
        id: siguienteId++,
        tenantId: params.tenantId,
        telefonoCliente: params.telefonoCliente,
        activo: true,
        step: params.step ?? "S1_SERVICIO",
        servicioId: params.servicioId ?? null,
        serviciosIds: params.serviciosIds ?? null,
        profesionalId: params.profesionalId ?? null,
        fechaIso: params.fechaIso ?? null,
        slotSeleccionado: null,
        opcionesMostradas: params.opcionesMostradas ?? null,
        ultimoWamidProcesado: params.wamid,
        citaObjetivoId: params.citaObjetivoId ?? null,
        accionGestion: params.accionGestion ?? null,
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

/** Lleva la sesión hasta el menú real de profesionales para Dipping (Uñas) -- Mary, Cristal, Nata, Jessica. Nivel de módulo -- reutilizada por las FASES 3, 4 y 5. */
async function llegarAMenuProfesionalDipping(deps: AgendaV2RouterDeps, telefono = "573148127388") {
  await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "quiero una cita", wamid: "w1" }, deps);
  await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: NUMERO_CATEGORIA_UNAS, wamid: "w2" }, deps);
  await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "w3" }, deps); // Dipping
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
    resolverEspecialistas: resolverEspecialistasFixture,
    calcularDiasCandidatos: calcularDiasCandidatosFixture,
    calcularHorariosFecha: calcularHorariosFechaFixture,
    // FASE 3 (autorizado, multi-servicio) -- default real: `[]` (mismo
    // comportamiento que una cita SIN filas en dulabs_cita_servicios, la
    // inmensa mayoría de las citas -- un solo servicio). Reprogramar
    // (FASE 8) SIEMPRE consulta esto, multi-servicio o no -- sin este
    // default, cualquier test de reprogramación que no lo inyecte
    // explícitamente tocaría el FAKE_SUPABASE real (`{}`) y rompería.
    obtenerServiciosDeCita: async () => [],
    enviarMensajeWhatsApp: envios.enviarMensajeWhatsApp,
    ...overrides,
  };
  return { deps, sesiones, candado, envios };
}

// --- FASE 2 (autorizado, registro de clientes nuevos) -- fakes exclusivos de AMORE ---

function crearFakeClientesConocidos(clientePreexistente?: { nombre: string; cumpleDia: number | null; cumpleMes: number | null }) {
  const clientes = new Map<string, { nombre: string; cumpleDia: number | null; cumpleMes: number | null }>();
  if (clientePreexistente) clientes.set(`whatsapp-qr:${AMORE_TENANT_ID}|573148127388`, clientePreexistente);
  return {
    clientes,
    buscarClienteConocido: async (_s: unknown, phoneNumberId: string, telefono: string) => clientes.get(`${phoneNumberId}|${telefono}`) ?? null,
  };
}

function crearFakeEntradasAmore() {
  const filas: EntradaAmore[] = [];
  let siguienteId = 1;
  return {
    filas,
    buscarEntradaAmoreDeps: async (_s: unknown, tenantId: string, telefono: string) => filas.find((f) => f.tenantId === tenantId && f.telefonoCliente === telefono) ?? null,
    crearEntradaAmoreDeps: async (_s: unknown, params: { tenantId: string; telefonoCliente: string; wamid: string; modo: ModoEntradaAmore }) => {
      const nueva: EntradaAmore = { id: siguienteId++, tenantId: params.tenantId, telefonoCliente: params.telefonoCliente, modo: params.modo, ultimoWamidProcesado: params.wamid, notificadoAJessica: false, productoInteresNombre: null };
      filas.push(nueva);
      return nueva;
    },
    actualizarEntradaAmoreDeps: async (_s: unknown, id: number, cambios: { modo?: ModoEntradaAmore; ultimoWamidProcesado?: string }) => {
      const f = filas.find((x) => x.id === id);
      if (f) Object.assign(f, cambios);
    },
  };
}

/** Mismo armarDeps de arriba, pero con el tenant real de AMORE y los fakes de cliente-conocido/entrada -- necesarios porque el chequeo nuevo de iniciarNuevaSesionAgendaV2 (Fase 2) está gateado exclusivamente por AMORE_TENANT_ID (nunca por "amore-test", el tenant de fixture que usa el resto de este archivo). */
function armarDepsAmore(overrides: Partial<AgendaV2RouterDeps> = {}, clientePreexistente?: { nombre: string; cumpleDia: number | null; cumpleMes: number | null }) {
  const base = armarDeps();
  const clientes = crearFakeClientesConocidos(clientePreexistente);
  const entradasAmore = crearFakeEntradasAmore();
  const deps: AgendaV2RouterDeps = {
    ...base.deps,
    buscarClienteConocido: clientes.buscarClienteConocido,
    buscarEntradaAmoreDeps: entradasAmore.buscarEntradaAmoreDeps,
    crearEntradaAmoreDeps: entradasAmore.crearEntradaAmoreDeps,
    actualizarEntradaAmoreDeps: entradasAmore.actualizarEntradaAmoreDeps,
    ...overrides,
  };
  return { deps, sesiones: base.sesiones, candado: base.candado, envios: base.envios, clientes, entradasAmore };
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

describe("Test 1 -- seleccionar categoría y luego servicio guarda un servicio_id REAL y avanza a S2_PROFESIONAL con el menú de profesionales elegibles", () => {
  it("de punta a punta vía el router real (creación -> categoría -> servicio -> menú de profesionales)", async () => {
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
    // FASE 3 -- las opciones ya NO son null: son el menú real de profesionales elegibles para Dipping.
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesProfesional(ESPECIALISTAS_POR_SERVICIO["s-dipping-real"]!));
    assert.match(envios.enviados[2]!.mensaje, /¿Con quién deseas realizarte el servicio\?/);
    assert.match(envios.enviados[2]!.mensaje, /1\. Mary/);
    assert.match(envios.enviados[2]!.mensaje, /2\. Cristal/);
    assert.match(envios.enviados[2]!.mensaje, /3\. Nata/);
    assert.match(envios.enviados[2]!.mensaje, /4\. Jessica/);
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
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "2", wamid: "w3" }, // Press On (nunca Retoques -- ese se reserva para el caso "sin profesionales" de la Fase 3)
      depsUnas,
    );
    assert.equal(sesionesUnas.filas[0]!.servicioId, "s-presson-real");
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

describe("FASE 3 (autorizado) -- selección de profesional vía router real", () => {
  it("Test 1: una sesión en S2_PROFESIONAL con servicio_id real obtiene los profesionales elegibles reales", async () => {
    const { deps, sesiones } = armarDeps();
    await llegarAMenuProfesionalDipping(deps);
    assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesProfesional(ESPECIALISTAS_POR_SERVICIO["s-dipping-real"]!));
  });

  it("Test 2: los profesionales mostrados son EXACTAMENTE los permitidos para ese servicio -- Peinado (Cabello) nunca muestra a Cristal/Nata (solo atienden Uñas)", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w2" }, deps); // Cabello
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w3" }, deps); // Peinado (único servicio de Cabello)
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesProfesional(ESPECIALISTAS_POR_SERVICIO["s-peinado-real"]!));
    assert.match(envios.enviados[2]!.mensaje, /1\. Mary/);
    assert.match(envios.enviados[2]!.mensaje, /2\. Jessica/);
    assert.doesNotMatch(envios.enviados[2]!.mensaje, /Cristal|Nata/, "Cristal y Nata solo atienden Uñas -- nunca deben aparecer para un servicio de Cabello");
  });

  it("Test 3/6/7: la opción '1' guarda el profesional_id correcto y avanza a S3_DIA con el menú REAL de días candidatos de ESE profesional (FASE 4)", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAMenuProfesionalDipping(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w4" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S3_DIA");
    assert.equal(sesiones.filas[0]!.profesionalId, 1262, "1 = Mary en el menú real de Dipping");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, { opciones: construirOpcionesFecha(DIAS_POR_PROFESIONAL_FIXTURE[1262]!), numeroVerMasFechas: null });
    assert.match(envios.enviados[3]!.mensaje, /¿Qué día deseas agendar\?/);
  });

  it("Test 8: opciones_mostradas pasa de profesionales a los DÍAS reales de ese profesional (FASE 4) -- nunca conserva las opciones del paso anterior", async () => {
    const { deps, sesiones } = armarDeps();
    await llegarAMenuProfesionalDipping(deps);
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w4" },
      deps,
    );
    const datos = sesiones.filas[0]!.opcionesMostradas as { opciones: { nombre?: string }[] };
    assert.ok(!datos.opciones.some((o) => o.nombre === "Mary"), "ya no deben quedar opciones de profesional, solo de fecha");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, { opciones: construirOpcionesFecha(["2026-09-08", "2026-09-09"]), numeroVerMasFechas: null });
  });

  it("otra opción también resuelve correctamente (nunca asume que sigue siendo la posición 1) -- '3' guarda a Nata", async () => {
    const { deps, sesiones } = armarDeps();
    await llegarAMenuProfesionalDipping(deps);
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "3", wamid: "w4" },
      deps,
    );
    assert.equal(sesiones.filas[0]!.profesionalId, 1264, "3 = Nata en el menú real de Dipping");
  });

  it("Test 4: una selección inválida (fuera de rango) no cambia el estado", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAMenuProfesionalDipping(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "999", wamid: "w4" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL");
    assert.equal(sesiones.filas[0]!.profesionalId, null);
    assert.match(envios.enviados[3]!.mensaje, /No reconocí esa opción/);
  });

  it("Test 5: texto ambiguo ('hola'/'quiero a mary'/'no sé') no cambia el estado", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAMenuProfesionalDipping(deps);
    for (const [i, mensaje] of ["hola", "quiero a mary", "no sé"].entries()) {
      const r = await procesarMensajeConAgendaV2(
        { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: mensaje, wamid: `w-inv-${i}` },
        deps,
      );
      assert.equal(r.manejado, true);
      assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL", `"${mensaje}" no debía avanzar el step`);
      assert.equal(sesiones.filas[0]!.profesionalId, null, `"${mensaje}" no debía fijar ningún profesional`);
    }
    assert.match(envios.enviados.at(-1)!.mensaje, /No reconocí esa opción/);
  });

  it("Test 9: un servicio SIN profesionales elegibles no avanza a S2_PROFESIONAL -- la sesión vuelve a categorías, nunca queda inconsistente", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: NUMERO_CATEGORIA_UNAS, wamid: "w2" }, deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "3", wamid: "w3" }, // Retoques -- SIN elegibles en el fixture
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO", "nunca queda en S2_PROFESIONAL con un menú vacío");
    assert.equal(sesiones.filas[0]!.servicioId, null, "nunca guarda un servicio sin profesionales elegibles");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesCategoria(CATALOGO_FIXTURE), "vuelve a mostrar categorías reales, nunca deja la sesión inconsistente");
    assert.match(envios.enviados[2]!.mensaje, /ninguna profesional está habilitada/i);
  });

  it("Test 10: aislamiento por tenant -- dos tenants avanzan de forma completamente independiente hasta S2_PROFESIONAL", async () => {
    const { deps, sesiones } = armarDeps();
    const TELEFONO = "573148127388";
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-a", telefono: TELEFONO, texto: "quiero una cita", wamid: "wA1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-b", telefono: TELEFONO, texto: "quiero una cita", wamid: "wB1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-a", telefono: TELEFONO, texto: NUMERO_CATEGORIA_UNAS, wamid: "wA2" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-b", telefono: TELEFONO, texto: NUMERO_CATEGORIA_UNAS, wamid: "wB2" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-a", telefono: TELEFONO, texto: "1", wamid: "wA3" }, deps); // A: Dipping
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-b", telefono: TELEFONO, texto: "2", wamid: "wB3" }, deps); // B: Press On

    const filaA = sesiones.filas.find((f) => f.tenantId === "tenant-a")!;
    const filaB = sesiones.filas.find((f) => f.tenantId === "tenant-b")!;
    assert.equal(filaA.step, "S2_PROFESIONAL");
    assert.equal(filaA.servicioId, "s-dipping-real");
    assert.equal(filaB.step, "S2_PROFESIONAL");
    assert.equal(filaB.servicioId, "s-presson-real");

    // Elegir profesional en tenant-a nunca debe afectar la sesión de tenant-b (mismo teléfono real).
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-a", telefono: TELEFONO, texto: "1", wamid: "wA4" }, deps); // Mary
    assert.equal(filaA.step, "S3_DIA");
    assert.equal(filaA.profesionalId, 1262);
    assert.equal(filaB.step, "S2_PROFESIONAL", "tenant-b nunca avanza por una acción de tenant-a");
    assert.equal(filaB.profesionalId, null);
  });

  it("Test 11: aislamiento por teléfono/sesión -- dos teléfonos del mismo tenant avanzan de forma independiente hasta profesional", async () => {
    const { deps, sesiones } = armarDeps();
    await llegarAMenuProfesionalDipping(deps, "573148127388");
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573000000000", texto: "quiero una cita", wamid: "wB1" }, deps);

    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w4" },
      deps,
    );
    const filaA = sesiones.filas.find((f) => f.telefonoCliente === "573148127388")!;
    const filaB = sesiones.filas.find((f) => f.telefonoCliente === "573000000000")!;
    assert.equal(filaA.step, "S3_DIA");
    assert.equal(filaA.profesionalId, 1262);
    assert.equal(filaB.step, "S1_SERVICIO", "B nunca avanza por una acción de A");
    assert.equal(filaB.profesionalId, null);
  });

  it("Test 12: un mensaje que coincide con un escenario del Flow Engine ('cumpleaños') durante S2_PROFESIONAL NUNCA invoca Flow Engine", async () => {
    const { deps, sesiones, envios } = armarDeps({ cargarEscenariosReal: cargarEscenariosNuncaDebeLlamarse });
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "w0",
      opcionesMostradas: construirOpcionesProfesional(ESPECIALISTAS_POR_SERVICIO["s-dipping-real"]!),
    });
    await sesiones.actualizarSesion(FAKE_SUPABASE, sesiones.filas[0]!.id, { step: "S2_PROFESIONAL", servicioId: "s-dipping-real" });

    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cumpleaños", wamid: "w1" },
      deps,
    );
    assert.equal(r.manejado, true, "no lanzó -- nunca llegó a cargarEscenariosReal/Flow Engine");
    assert.match(envios.enviados[0]!.mensaje, /No reconocí esa opción/);
    assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL", "cumpleaños nunca debe avanzar el step");
  });

  it("Test 13: las opciones guardadas en la sesión son EXACTAMENTE las mismas que las enviadas al usuario", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAMenuProfesionalDipping(deps);
    const opcionesGuardadas = sesiones.filas[0]!.opcionesMostradas as ReturnType<typeof construirOpcionesProfesional>;
    for (const o of opcionesGuardadas) {
      assert.match(envios.enviados[2]!.mensaje, new RegExp(`${o.numero}\\. ${o.nombre}`));
    }
    assert.equal(opcionesGuardadas.length, 4);
  });

  it("Test 14: una sesión existente de S1_SERVICIO (sub-fase servicio) sigue funcionando exactamente como antes de la Fase 3", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: NUMERO_CATEGORIA_UNAS, wamid: "w2" }, deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "999", wamid: "w3" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO");
    assert.equal(sesiones.filas[0]!.servicioId, null);
    assert.match(envios.enviados[2]!.mensaje, /No reconocí esa opción/);
  });

  it("Test 15: la selección categoría -> servicio de la Fase 2A sigue funcionando y ahora fluye correctamente hacia el menú de profesionales", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" }, deps);
    assert.match(envios.enviados[0]!.mensaje, /¿Qué tipo de servicio te gustaría agendar\?/);

    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: NUMERO_CATEGORIA_UNAS, wamid: "w2" }, deps);
    assert.match(envios.enviados[1]!.mensaje, /¿Qué servicio deseas realizarte\?/);

    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w3" }, deps);
    assert.match(envios.enviados[2]!.mensaje, /¿Con quién deseas realizarte el servicio\?/);
    assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL");
    assert.equal(sesiones.filas[0]!.servicioId, "s-dipping-real");
  });
});

describe("FASE 4 (autorizado) -- selección de fecha vía router real", () => {
  /** Lleva la sesión hasta S3_DIA con el menú real de días de Mary para Dipping. */
  async function llegarAMenuFechaMary(deps: AgendaV2RouterDeps, telefono = "573148127388") {
    await llegarAMenuProfesionalDipping(deps, telefono);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "w4" }, deps); // Mary
  }

  it("Test 1/6: sesión en S3_DIA con servicio+profesional reales obtiene los días candidatos REALES de ESE profesional", async () => {
    const { deps, sesiones } = armarDeps();
    await llegarAMenuFechaMary(deps);
    assert.equal(sesiones.filas[0]!.step, "S3_DIA");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, { opciones: construirOpcionesFecha(DIAS_POR_PROFESIONAL_FIXTURE[1262]!), numeroVerMasFechas: null });
  });

  it("Test 9: '1' guarda la fecha_iso correcta y avanza a S4_HORA con el menú REAL de horas de esa fecha (FASE 5)", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAMenuFechaMary(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w5" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S4_HORA");
    assert.equal(sesiones.filas[0]!.fechaIso, "2026-09-08");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesHora("2026-09-08", HORAS_POR_FECHA_FIXTURE["2026-09-08"]!));
    assert.match(envios.enviados[4]!.mensaje, /Estos son los horarios disponibles/);
  });

  it("Test 10: número inválido (fuera de rango) en S3_DIA no cambia el estado", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAMenuFechaMary(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "999", wamid: "w5" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S3_DIA");
    assert.equal(sesiones.filas[0]!.fechaIso, null);
    assert.match(envios.enviados[4]!.mensaje, /No reconocí esa opción/);
  });

  it("Test 10: texto ambiguo ('el sábado'/'mañana') en S3_DIA no cambia el estado -- nunca se interpreta como fecha", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAMenuFechaMary(deps);
    for (const [i, mensaje] of ["hola", "el sábado", "mañana"].entries()) {
      const r = await procesarMensajeConAgendaV2(
        { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: mensaje, wamid: `w-inv-${i}` },
        deps,
      );
      assert.equal(r.manejado, true);
      assert.equal(sesiones.filas[0]!.step, "S3_DIA", `"${mensaje}" no debía avanzar el step`);
      assert.equal(sesiones.filas[0]!.fechaIso, null, `"${mensaje}" no debía fijar ninguna fecha`);
    }
    assert.match(envios.enviados.at(-1)!.mensaje, /No reconocí esa opción/);
  });

  it("Test 7: sin días disponibles (Jessica) -- NUNCA avanza a S3_DIA, revierte a S2_PROFESIONAL mostrando profesionales reales de nuevo", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAMenuProfesionalDipping(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "4", wamid: "w4" }, // Jessica -- sin días en el fixture
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL", "nunca avanza a S3_DIA sin días candidatos reales");
    assert.equal(sesiones.filas[0]!.profesionalId, null, "nunca guarda un profesional sin días disponibles");
    assert.deepEqual(
      sesiones.filas[0]!.opcionesMostradas,
      construirOpcionesProfesional(ESPECIALISTAS_POR_SERVICIO["s-dipping-real"]!),
      "vuelve a mostrar los profesionales reales, nunca deja la sesión inconsistente",
    );
    assert.match(envios.enviados[3]!.mensaje, /No encontramos días disponibles/);
  });

  it("Test 19: 'cumpleaños' (coincide con un escenario del Flow Engine) en S3_DIA -- se trata como selección inválida, NUNCA invoca Flow Engine", async () => {
    const { deps, sesiones, envios } = armarDeps({ cargarEscenariosReal: cargarEscenariosNuncaDebeLlamarse });
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "w0",
      opcionesMostradas: { opciones: construirOpcionesFecha(["2026-09-08", "2026-09-09"]), numeroVerMasFechas: null },
    });
    await sesiones.actualizarSesion(FAKE_SUPABASE, sesiones.filas[0]!.id, { step: "S3_DIA", servicioId: "s-dipping-real", profesionalId: 1262 });

    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cumpleaños", wamid: "w1" },
      deps,
    );
    assert.equal(r.manejado, true, "no lanzó -- nunca llegó a cargarEscenariosReal/Flow Engine");
    assert.match(envios.enviados[0]!.mensaje, /No reconocí esa opción/);
    assert.equal(sesiones.filas[0]!.step, "S3_DIA", "cumpleaños nunca debe avanzar el step");
  });

  it("'cancelar' cierra la sesión también estando en S3_DIA", async () => {
    const { deps, sesiones } = armarDeps();
    await llegarAMenuFechaMary(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cancelar", wamid: "w5" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.activo, false);
  });
});

// ---------------------------------------------------------------------------
// CORRECCIÓN (autorizada, "Ver más fechas") -- EXCLUSIVA de S3_DIA, nunca de
// S4_HORA. `calcularDiasConMas` simula bloques SUCESIVOS reales devueltos por
// el motor de disponibilidad (cada llamada = un bloque, mismo criterio que
// "continuarDesdeFechaIso" ya probado a fondo en disponibilidad.test.ts) --
// acá se prueba la ORQUESTACIÓN real vía router.ts/controlador.ts, no el
// cálculo de fechas en sí.
// ---------------------------------------------------------------------------
describe("CORRECCIÓN (autorizada, 'Ver más fechas') -- flujo real vía router", () => {
  function calcularDiasConMas(bloques: string[][]) {
    const llamadas: Array<{ continuarDesdeFechaIso?: string }> = [];
    let indice = 0;
    return {
      llamadas,
      fn: async (_s: unknown, params: { continuarDesdeFechaIso?: string }) => {
        llamadas.push({ continuarDesdeFechaIso: params.continuarDesdeFechaIso });
        const fechas = bloques[indice] ?? [];
        indice++;
        return { ok: true as const, opciones: construirOpcionesFecha(fechas), hayMasFechas: indice < bloques.length };
      },
    };
  }

  it("Test 7 (obligatorio) -- con más de 4 fechas reales, el menú agrega '5. Ver más fechas'", async () => {
    const diasFake = calcularDiasConMas([["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"], ["2026-09-14"]]);
    const { deps, sesiones, envios } = armarDeps({ calcularDiasCandidatos: diasFake.fn });
    await llegarAMenuProfesionalDipping(deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w4" }, deps); // Mary
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, {
      opciones: construirOpcionesFecha(["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]),
      numeroVerMasFechas: 5,
    });
    assert.match(envios.enviados.at(-1)!.mensaje, /4\. Sábado 12 de septiembre|4\. Viernes 11 de septiembre/); // 4ª fecha real, cualquiera que sea
    assert.match(envios.enviados.at(-1)!.mensaje, /5\. Ver más fechas/);
  });

  it("Test 14 (regresión, obligatorio) -- con 4 o menos fechas y ninguna más, el menú NUNCA agrega 'Ver más fechas' -- comportamiento 100% idéntico al de antes de esta corrección", async () => {
    const { deps, sesiones, envios } = armarDeps(); // fixture normal, 2 fechas reales para Mary, sin más
    await llegarAMenuProfesionalDipping(deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w4" }, deps); // Mary
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, { opciones: construirOpcionesFecha(DIAS_POR_PROFESIONAL_FIXTURE[1262]!), numeroVerMasFechas: null });
    assert.doesNotMatch(envios.enviados.at(-1)!.mensaje, /Ver más fechas/);
  });

  it("Test 8 (obligatorio) -- seleccionar 'Ver más fechas' permanece en S3_DIA, conserva servicio/profesional, y muestra el bloque REAL siguiente (continuando desde la última fecha, nunca desde hoy)", async () => {
    const diasFake = calcularDiasConMas([["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"], ["2026-09-14", "2026-09-15"]]);
    const { deps, sesiones, envios } = armarDeps({ calcularDiasCandidatos: diasFake.fn });
    await llegarAMenuProfesionalDipping(deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w4" }, deps); // Mary -> bloque 1
    const r = await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "5", wamid: "w5" }, deps); // Ver más fechas

    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S3_DIA", "permanece en S3_DIA, nunca reinicia la sesión");
    assert.equal(sesiones.filas[0]!.servicioId, "s-dipping-real", "conserva el MISMO servicio");
    assert.equal(sesiones.filas[0]!.profesionalId, 1262, "conserva el MISMO profesional");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, { opciones: construirOpcionesFecha(["2026-09-14", "2026-09-15"]), numeroVerMasFechas: null });
    assert.match(envios.enviados.at(-1)!.mensaje, /Lunes 14 de septiembre/);
    assert.doesNotMatch(envios.enviados.at(-1)!.mensaje, /Ver más fechas/, "el segundo bloque no tiene más -- nunca la ofrece de nuevo");

    // Test 8/9/10 -- continuó DESPUÉS de la última fecha real ya mostrada, nunca desde hoy ni repitiendo.
    assert.equal(diasFake.llamadas[0]!.continuarDesdeFechaIso, undefined, "el primer bloque nunca lleva cursor");
    assert.equal(diasFake.llamadas[1]!.continuarDesdeFechaIso, "2026-09-11", "el segundo bloque continúa justo después de la última fecha del primero");
  });

  it("Test 15 (obligatorio, vía router) -- '5' cuando NO hay 'Ver más fechas' (4 fechas exactas, sin más) sigue siendo una selección inválida, NUNCA activa la búsqueda de más fechas", async () => {
    const diasFake = calcularDiasConMas([["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]]); // exactamente 4, sin más bloques configurados
    const { deps, sesiones, envios } = armarDeps({ calcularDiasCandidatos: diasFake.fn });
    await llegarAMenuProfesionalDipping(deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w4" }, deps);
    const r = await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "5", wamid: "w5" }, deps);

    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S3_DIA", "nunca avanza con una selección inválida");
    assert.match(envios.enviados.at(-1)!.mensaje, /No reconocí esa opción/);
    assert.equal(diasFake.llamadas.length, 1, "'5' inválido NUNCA dispara una segunda consulta de disponibilidad");
  });

  it("Test 17 (obligatorio, regresión) -- S4_HORA NUNCA recibe 'Otro horario': sigue mostrando máximo 6 horarios reales, sin ninguna opción adicional", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAMenuProfesionalDipping(deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w4" }, deps); // Mary
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w5" }, deps); // 2026-09-08
    assert.equal(sesiones.filas[0]!.step, "S4_HORA");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesHora("2026-09-08", HORAS_POR_FECHA_FIXTURE["2026-09-08"]!), "sigue siendo el arreglo plano de siempre, NUNCA {horariosCompletos, pagina}");
    assert.doesNotMatch(envios.enviados.at(-1)!.mensaje, /Otro horario/);
  });
});

describe("FASE 5 (autorizado) -- selección de hora vía router real", () => {
  async function llegarAMenuFechaMary(deps: AgendaV2RouterDeps, telefono = "573148127388") {
    await llegarAMenuProfesionalDipping(deps, telefono);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "w4" }, deps); // Mary
  }
  /** Lleva la sesión hasta S4_HORA con el menú real de horas del 2026-09-08. */
  async function llegarAMenuHora(deps: AgendaV2RouterDeps, telefono = "573148127388") {
    await llegarAMenuFechaMary(deps, telefono);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "w5" }, deps); // 2026-09-08
  }

  it("Test 11: sesión en S4_HORA con fecha real obtiene los horarios REALES de esa fecha", async () => {
    const { deps, sesiones } = armarDeps();
    await llegarAMenuHora(deps);
    assert.equal(sesiones.filas[0]!.step, "S4_HORA");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesHora("2026-09-08", HORAS_POR_FECHA_FIXTURE["2026-09-08"]!));
  });

  it("Test 16/17: '1' guarda el slot elegido (fecha+hora reales) y avanza a S5_CONFIRMAR con el resumen REAL de la cita (FASE 6)", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAMenuHora(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w6" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S5_CONFIRMAR");
    assert.deepEqual(sesiones.filas[0]!.slotSeleccionado, { fechaIso: "2026-09-08", hora: "09:00" });
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, OPCIONES_CONFIRMACION);
    assert.match(envios.enviados[5]!.mensaje, /Estos son los datos de tu cita/);
    assert.match(envios.enviados[5]!.mensaje, /Servicio: Dipping/);
    assert.match(envios.enviados[5]!.mensaje, /Profesional: Mary/);
    assert.match(envios.enviados[5]!.mensaje, /Fecha: Martes 8 de septiembre/);
    assert.match(envios.enviados[5]!.mensaje, /Hora: 9:00 a\. m\./);
  });

  it("otra opción también resuelve correctamente (nunca asume que sigue siendo la posición 1)", async () => {
    const { deps, sesiones } = armarDeps();
    await llegarAMenuHora(deps);
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "3", wamid: "w6" },
      deps,
    );
    assert.deepEqual(sesiones.filas[0]!.slotSeleccionado, { fechaIso: "2026-09-08", hora: "14:00" });
  });

  it("Test 17: número inválido (fuera de rango) en S4_HORA no cambia el estado", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAMenuHora(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "999", wamid: "w6" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S4_HORA");
    assert.equal(sesiones.filas[0]!.slotSeleccionado, null);
    assert.match(envios.enviados[5]!.mensaje, /No reconocí esa opción/);
  });

  it("Test 18: la fecha dejó de tener horarios reales justo antes de confirmarla -- protección: NUNCA crea nada, vuelve a S3_DIA con días recalculados", async () => {
    const horasVacias = async () => ({ ok: false as const, motivo: "sin_horarios_ese_dia" as const });
    const { deps, sesiones, envios } = armarDeps({ calcularHorariosFecha: horasVacias });
    await llegarAMenuFechaMary(deps); // llega a S3_DIA con días reales (usa el calcularDiasCandidatos normal del fixture)
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w5" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S3_DIA", "nunca avanza a S4_HORA sin horarios reales");
    assert.equal(sesiones.filas[0]!.fechaIso, null);
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, { opciones: construirOpcionesFecha(DIAS_POR_PROFESIONAL_FIXTURE[1262]!), numeroVerMasFechas: null }, "recalcula y vuelve a mostrar días reales actualizados");
    assert.match(envios.enviados[4]!.mensaje, /ya no tiene horarios disponibles/);
  });

  it("Test 20: 'cumpleaños' (coincide con un escenario del Flow Engine) en S4_HORA -- se trata como selección inválida, NUNCA invoca Flow Engine", async () => {
    const { deps, sesiones, envios } = armarDeps({ cargarEscenariosReal: cargarEscenariosNuncaDebeLlamarse });
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "w0",
      opcionesMostradas: construirOpcionesHora("2026-09-08", ["09:00", "10:30"]),
    });
    await sesiones.actualizarSesion(FAKE_SUPABASE, sesiones.filas[0]!.id, {
      step: "S4_HORA",
      servicioId: "s-dipping-real",
      profesionalId: 1262,
      fechaIso: "2026-09-08",
    });

    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cumpleaños", wamid: "w1" },
      deps,
    );
    assert.equal(r.manejado, true, "no lanzó -- nunca llegó a cargarEscenariosReal/Flow Engine");
    assert.match(envios.enviados[0]!.mensaje, /No reconocí esa opción/);
    assert.equal(sesiones.filas[0]!.step, "S4_HORA", "cumpleaños nunca debe avanzar el step");
  });

  it("Test 21: aislamiento por tenant -- dos tenants avanzan de forma completamente independiente hasta S5_CONFIRMAR", async () => {
    const { deps, sesiones } = armarDeps();
    const TELEFONO = "573148127388";
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-a", telefono: TELEFONO, texto: "quiero una cita", wamid: "wA1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-b", telefono: TELEFONO, texto: "quiero una cita", wamid: "wB1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-a", telefono: TELEFONO, texto: NUMERO_CATEGORIA_UNAS, wamid: "wA2" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-b", telefono: TELEFONO, texto: NUMERO_CATEGORIA_UNAS, wamid: "wB2" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-a", telefono: TELEFONO, texto: "1", wamid: "wA3" }, deps); // Dipping
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-b", telefono: TELEFONO, texto: "1", wamid: "wB3" }, deps); // Dipping
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-a", telefono: TELEFONO, texto: "1", wamid: "wA4" }, deps); // Mary
    // tenant-b se queda en S2_PROFESIONAL a propósito -- nunca debe avanzar por las acciones de tenant-a.

    const filaA = sesiones.filas.find((f) => f.tenantId === "tenant-a")!;
    const filaB = sesiones.filas.find((f) => f.tenantId === "tenant-b")!;
    assert.equal(filaA.step, "S3_DIA");
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-a", telefono: TELEFONO, texto: "1", wamid: "wA5" }, deps); // 2026-09-08
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "tenant-a", telefono: TELEFONO, texto: "1", wamid: "wA6" }, deps); // 09:00
    assert.equal(filaA.step, "S5_CONFIRMAR");
    assert.equal(filaB.step, "S2_PROFESIONAL", "tenant-b nunca avanza por ninguna acción de tenant-a");
  });

  it("Test 22: aislamiento por teléfono/sesión -- dos teléfonos del mismo tenant avanzan de forma independiente hasta S5_CONFIRMAR", async () => {
    const { deps, sesiones } = armarDeps();
    await llegarAMenuHora(deps, "573148127388");
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573000000000", texto: "quiero una cita", wamid: "wB1" }, deps);

    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w6" },
      deps,
    );
    const filaA = sesiones.filas.find((f) => f.telefonoCliente === "573148127388")!;
    const filaB = sesiones.filas.find((f) => f.telefonoCliente === "573000000000")!;
    assert.equal(filaA.step, "S5_CONFIRMAR");
    assert.equal(filaB.step, "S1_SERVICIO", "B nunca avanza por una acción de A");
  });

  it("Test 23: opciones_mostradas coincide EXACTAMENTE con lo enviado en el menú de horas", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAMenuHora(deps);
    const opcionesGuardadas = sesiones.filas[0]!.opcionesMostradas as ReturnType<typeof construirOpcionesHora>;
    for (const o of opcionesGuardadas) {
      assert.match(envios.enviados[4]!.mensaje, new RegExp(`${o.numero}\\.`));
    }
    assert.equal(opcionesGuardadas.length, 3);
  });

  it("Test 24: regresión -- Fases 1-3 siguen funcionando y ahora fluyen correctamente hasta el menú de horas, punta a punta", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" }, deps);
    assert.match(envios.enviados[0]!.mensaje, /¿Qué tipo de servicio te gustaría agendar\?/);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: NUMERO_CATEGORIA_UNAS, wamid: "w2" }, deps);
    assert.match(envios.enviados[1]!.mensaje, /¿Qué servicio deseas realizarte\?/);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w3" }, deps);
    assert.match(envios.enviados[2]!.mensaje, /¿Con quién deseas realizarte el servicio\?/);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w4" }, deps);
    assert.match(envios.enviados[3]!.mensaje, /¿Qué día deseas agendar\?/);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w5" }, deps);
    assert.match(envios.enviados[4]!.mensaje, /Estos son los horarios disponibles/);
    assert.equal(sesiones.filas[0]!.step, "S4_HORA");
    assert.equal(sesiones.filas[0]!.servicioId, "s-dipping-real");
    assert.equal(sesiones.filas[0]!.profesionalId, 1262);
    assert.equal(sesiones.filas[0]!.fechaIso, "2026-09-08");
  });
});

/**
 * FASE 7 (autorizado) -- fixtures de creación REAL de la reserva. Nunca
 * tocan Supabase/Nylas reales: `crearFakeCrearCitaConNylas` reemplaza por
 * completo la función real (mismo criterio que el resto de fixtures de este
 * archivo), y los resolvers de grant/apiKey/clientes de Nylas también se
 * inyectan falsos -- así ningún test de esta sección depende de variables de
 * entorno reales ni golpea la red.
 */
const CITA_FAKE_BASE: CitaEspecialista = {
  id: 9001,
  especialista_id: 1262,
  telefono_cliente: "573148127388",
  nombre_cliente: "Ana Pérez",
  servicio: "Dipping",
  servicio_id: "s-dipping-real",
  inicio: "2026-09-08T14:00:00.000Z", // 09:00 Colombia (-05:00)
  fin: "2026-09-08T16:00:00.000Z",
  estado: "confirmada",
  motivo_rechazo: null,
  origen: "manual",
};

const RESULTADO_EXITO_DIPPING_MARY: ResultadoCrearCitaNylas = {
  ok: true,
  cita: CITA_FAKE_BASE,
  nylasEventId: "evt-fake-1",
  especialista: { id: 1262, nombre: "Mary" },
  servicio: { id: "s-dipping-real", nombre: "Dipping", duracionMin: 120 },
};

const RESULTADO_OCUPADO: ResultadoCrearCitaNylas = {
  ok: false,
  motivo: "ocupado",
  detalle: "Ese horario ya fue tomado en Google Calendar.",
};

/** Mismo motivo ("ocupado") que arriba, pero con el detalle EXACTO que crearCitaConNylas real usa cuando el EXCLUDE de Postgres detecta una carrera real -- ver reserva-servicio-nylas.ts. */
const RESULTADO_OCUPADO_POR_CARRERA: ResultadoCrearCitaNylas = {
  ok: false,
  motivo: "ocupado",
  detalle: "Ese horario ya fue tomado (protección final de PostgreSQL).",
};

const RESULTADO_ERROR_DB: ResultadoCrearCitaNylas = {
  ok: false,
  motivo: "error_de_base_de_datos",
  detalle: "Error simulado de base de datos.",
};

type ParamsCrearCitaFixture = {
  idTenant: string;
  servicioId: string;
  especialistaId: number;
  inicio: Date;
  nombreCliente: string;
  telefonoCliente: string | null;
  idempotencyKey: string;
};

/** Reemplaza POR COMPLETO crearCitaConNylas -- nunca toca Supabase/Nylas reales. Registra cada llamada para poder probar cuántas veces (y con qué datos) se intentó crear. */
function crearFakeCrearCitaConNylas(resultado: ResultadoCrearCitaNylas | ((p: ParamsCrearCitaFixture) => ResultadoCrearCitaNylas)) {
  const llamadas: Array<{ params: ParamsCrearCitaFixture; deps: DepsCrearCitaNylas }> = [];
  const crearCitaConNylas = async (_s: unknown, params: ParamsCrearCitaFixture, deps: DepsCrearCitaNylas): Promise<ResultadoCrearCitaNylas> => {
    llamadas.push({ params, deps });
    return typeof resultado === "function" ? resultado(params) : resultado;
  };
  return { llamadas, crearCitaConNylas };
}

/** Fake lanzador -- prueba que, en los casos defensivos, crearCitaConNylas JAMÁS se invoca. */
async function crearCitaConNylasNuncaDebeLlamarse(): Promise<ResultadoCrearCitaNylas> {
  throw new Error("crearCitaConNylas NO debía llamarse -- la sesión estaba incompleta/inconsistente");
}

function crearFakeBuscarNombreConocido(nombre: string | null) {
  return async (): Promise<string | null> => nombre;
}

/** Deps de Nylas FALSOS de conexión -- grant/apiKey/clientes siempre "disponibles" (nunca red real; crearCitaConNylas también está siempre fakeado en estos tests). */
const NYLAS_DEPS_FAKE_OVERRIDES: Partial<AgendaV2RouterDeps> = {
  resolverNylasGrantIdParaTenant: () => "grant-fake",
  resolveNylasApiKeyFromEnv: () => "api-key-fake",
  createNylasEventsClient: () => ({ listEvents: async () => [] }),
  createNylasEventsWriteClient: () => ({ createEvent: async () => ({ id: "evt-fake" }), deleteEvent: async () => {} }),
  buscarNombreConocido: crearFakeBuscarNombreConocido("Ana Pérez"),
};

/**
 * FASE 6 (autorizado) -- S5_CONFIRMAR: resumen + menú de control
 * (confirmar/cambiar fecha/cambiar hora/cancelar). Desde la FASE 7, "1"
 * (confirmar) sí intenta crear la reserva real -- por eso, a partir de acá,
 * CUALQUIER test de este archivo que envíe "1" estando en S5_CONFIRMAR debe
 * inyectar un `crearCitaConNylas` FALSO (ver crearFakeCrearCitaConNylas más
 * abajo, sección FASE 7): armarDeps() por sí solo NUNCA inyecta la función
 * real, así que un test que la omita simplemente usaría la real -- por eso
 * los Tests 3 y 8 de este describe ya la inyectan explícitamente. Ninguna
 * prueba de este archivo puede, ni por accidente, disparar una reserva real
 * ni un evento real de Nylas (Test obligatorio del pedido de la FASE 7:
 * "usar mocks/stubs para la creación de la reserva en las pruebas").
 */
describe("FASE 6 (autorizado) -- confirmación de la cita vía router real (S5_CONFIRMAR)", () => {
  async function llegarAMenuFechaMary(deps: AgendaV2RouterDeps, telefono = "573148127388") {
    await llegarAMenuProfesionalDipping(deps, telefono);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "w4" }, deps); // Mary
  }
  async function llegarAMenuHora(deps: AgendaV2RouterDeps, telefono = "573148127388") {
    await llegarAMenuFechaMary(deps, telefono);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "w5" }, deps); // 2026-09-08
  }
  /** Lleva la sesión hasta S5_CONFIRMAR (Dipping + Mary + 2026-09-08 + 09:00). */
  async function llegarAConfirmacion(deps: AgendaV2RouterDeps, telefono = "573148127388") {
    await llegarAMenuHora(deps, telefono);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "w6" }, deps); // 09:00
  }

  it("Test 1: sesión avanza a S5_CONFIRMAR con el menú de control real guardado (opciones_mostradas)", async () => {
    const { deps, sesiones } = armarDeps();
    await llegarAConfirmacion(deps);
    assert.equal(sesiones.filas[0]!.step, "S5_CONFIRMAR");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, OPCIONES_CONFIRMACION);
    assert.deepEqual(sesiones.filas[0]!.slotSeleccionado, { fechaIso: "2026-09-08", hora: "09:00" });
  });

  it("Test 2: el resumen enviado incluye TODOS los datos reales -- servicio, profesional, fecha, hora, duración y valor, EXCLUSIVAMENTE desde la sesión/catálogo real", async () => {
    const { deps, envios } = armarDeps();
    await llegarAConfirmacion(deps);
    const resumen = envios.enviados.at(-1)!.mensaje;
    assert.match(resumen, /Estos son los datos de tu cita/);
    assert.match(resumen, /Servicio: Dipping/);
    assert.match(resumen, /Profesional: Mary/);
    assert.match(resumen, /Fecha: Martes 8 de septiembre/);
    assert.match(resumen, /Hora: 9:00 a\. m\./);
    assert.match(resumen, /Duración: 2 h/); // Dipping = 120 min en CATALOGO_FIXTURE
    assert.match(resumen, /Valor: \$60\.000/); // Dipping = 60000 en CATALOGO_FIXTURE
    assert.match(resumen, /1\. Confirmar cita/);
    assert.match(resumen, /2\. Cambiar fecha/);
    assert.match(resumen, /3\. Cambiar horario/);
    assert.match(resumen, /4\. Cancelar/);
  });

  it("Test 3 -- Opción 1 (confirmar): FASE 7 -- crea la reserva real (fakeada) y cierra la sesión", async () => {
    const fake = crearFakeCrearCitaConNylas(RESULTADO_EXITO_DIPPING_MARY);
    const { deps, sesiones, envios } = armarDeps({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: fake.crearCitaConNylas });
    await llegarAConfirmacion(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w7" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(fake.llamadas.length, 1, "crearCitaConNylas se invoca exactamente una vez");
    assert.match(envios.enviados.at(-1)!.mensaje, /¡Listo! 💗 Tu cita quedó agendada/);
    assert.equal(sesiones.filas[0]!.activo, false, "la sesión se cierra tras el éxito real (Fase 7)");
  });

  it("Test 4 -- Opción 2 (cambiar fecha): vuelve a S3_DIA con los días REALES recalculados, manteniendo servicio y profesional", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAConfirmacion(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "2", wamid: "w7" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S3_DIA");
    assert.equal(sesiones.filas[0]!.servicioId, "s-dipping-real", "nunca vuelve a pedir servicio");
    assert.equal(sesiones.filas[0]!.profesionalId, 1262, "nunca vuelve a pedir profesional");
    assert.equal(sesiones.filas[0]!.fechaIso, null);
    assert.equal(sesiones.filas[0]!.slotSeleccionado, null);
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, { opciones: construirOpcionesFecha(DIAS_POR_PROFESIONAL_FIXTURE[1262]!), numeroVerMasFechas: null });
    assert.match(envios.enviados.at(-1)!.mensaje, /¿Qué día deseas agendar\?/);
  });

  it("Test 5 -- Opción 3 (cambiar horario): vuelve a S4_HORA con los horarios REALES recalculados de la MISMA fecha, sin pedir fecha/profesional/servicio de nuevo", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAConfirmacion(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "3", wamid: "w7" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S4_HORA");
    assert.equal(sesiones.filas[0]!.servicioId, "s-dipping-real");
    assert.equal(sesiones.filas[0]!.profesionalId, 1262);
    assert.equal(sesiones.filas[0]!.fechaIso, "2026-09-08", "mantiene la MISMA fecha ya elegida");
    assert.equal(sesiones.filas[0]!.slotSeleccionado, null);
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesHora("2026-09-08", HORAS_POR_FECHA_FIXTURE["2026-09-08"]!));
    assert.match(envios.enviados.at(-1)!.mensaje, /Estos son los horarios disponibles/);
  });

  it("Test 6 -- Opción 4 (cancelar): cierra la sesión, nunca modifica ninguna cita existente", async () => {
    const { deps, sesiones } = armarDeps();
    await llegarAConfirmacion(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "4", wamid: "w7" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.activo, false);
  });

  it("Test 7: número inválido -- permanece en S5_CONFIRMAR, reenvía el mismo menú de control", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await llegarAConfirmacion(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "9", wamid: "w7" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.step, "S5_CONFIRMAR");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, OPCIONES_CONFIRMACION);
    assert.match(envios.enviados.at(-1)!.mensaje, /No reconocí esa opción/);
  });

  it("Test 8: mensaje duplicado (mismo wamid) -- nunca reprocesa, nunca reenvía dos veces, nunca crea la reserva dos veces", async () => {
    const fake = crearFakeCrearCitaConNylas(RESULTADO_EXITO_DIPPING_MARY);
    const { deps, envios } = armarDeps({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: fake.crearCitaConNylas });
    await llegarAConfirmacion(deps);
    const totalAntes = envios.enviados.length;
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w7" },
      deps,
    );
    assert.equal(envios.enviados.length, totalAntes + 1);
    assert.equal(fake.llamadas.length, 1);

    // La sesión ya se cerró tras el éxito real (Fase 7) -- un reintento del
    // MISMO wamid ya no encuentra ninguna sesión activa contra la cual
    // reprocesar (buscarSesionActiva solo busca activo:true), así que cae a
    // "sin sesión" (manejado:false) en vez de reprocesar. Lo que realmente
    // importa -- y lo que este test prueba -- es que crearCitaConNylas
    // JAMÁS se invoca una segunda vez ni se reenvía un segundo mensaje.
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w7" }, // mismo wamid exacto
      deps,
    );
    assert.equal(r.manejado, false, "la sesión ya se cerró tras confirmar -- ya no hay nada que reprocesar");
    assert.equal(envios.enviados.length, totalAntes + 1, "el wamid w7 ya se procesó -- nunca se reenvía una vez más");
    assert.equal(fake.llamadas.length, 1, "el wamid w7 ya se procesó -- crearCitaConNylas NUNCA se vuelve a invocar");
  });

  it("Test 9: sesión inconsistente (S5_CONFIRMAR sin servicioId/profesionalId) -- nunca rompe, se reinicia a categorías reales", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "w0",
      opcionesMostradas: OPCIONES_CONFIRMACION,
    });
    // Estado inconsistente a propósito: S5_CONFIRMAR sin servicioId/profesionalId (nunca debería ocurrir en el flujo normal).
    await sesiones.actualizarSesion(FAKE_SUPABASE, sesiones.filas[0]!.id, { step: "S5_CONFIRMAR" });

    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "2", wamid: "w1" }, // "cambiar fecha" -- exige servicioId/profesionalId
      deps,
    );
    assert.equal(r.manejado, true, "nunca rompe ni lanza una excepción sin capturar");
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO", "se reinicia a categorías, nunca queda en un estado roto");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesCategoria(CATALOGO_FIXTURE));
    assert.match(envios.enviados[0]!.mensaje, /Ocurrió un problema con tu selección/);
  });

  it("Test 19/20 (aislamiento): 'cumpleaños' en S5_CONFIRMAR se trata como selección inválida, NUNCA invoca Flow Engine", async () => {
    const { deps, sesiones, envios } = armarDeps({ cargarEscenariosReal: cargarEscenariosNuncaDebeLlamarse });
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "w0",
      opcionesMostradas: OPCIONES_CONFIRMACION,
    });
    await sesiones.actualizarSesion(FAKE_SUPABASE, sesiones.filas[0]!.id, {
      step: "S5_CONFIRMAR",
      servicioId: "s-dipping-real",
      profesionalId: 1262,
      fechaIso: "2026-09-08",
      slotSeleccionado: { fechaIso: "2026-09-08", hora: "09:00" },
    });

    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cumpleaños", wamid: "w1" },
      deps,
    );
    assert.equal(r.manejado, true, "no lanzó -- nunca llegó a cargarEscenariosReal/Flow Engine");
    assert.match(envios.enviados[0]!.mensaje, /No reconocí esa opción/);
    assert.equal(sesiones.filas[0]!.step, "S5_CONFIRMAR", "cumpleaños nunca debe avanzar/cerrar el step");
  });

  it("Test 21/22 (aislamiento multi-tenant y por teléfono): confirmar/cancelar en una sesión nunca afecta a otra", async () => {
    const { deps, sesiones } = armarDeps();
    await llegarAConfirmacion(deps, "573148127388");
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573000000000", texto: "quiero una cita", wamid: "wB1" }, deps);

    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "4", wamid: "w7" }, // A cancela
      deps,
    );
    const filaA = sesiones.filas.find((f) => f.telefonoCliente === "573148127388")!;
    const filaB = sesiones.filas.find((f) => f.telefonoCliente === "573000000000")!;
    assert.equal(filaA.activo, false);
    assert.equal(filaB.activo, true, "B nunca debe cerrarse por una acción de A");
    assert.equal(filaB.step, "S1_SERVICIO");
  });

  it("regresión -- Fases 1-5 siguen funcionando y ahora fluyen correctamente hasta el resumen de confirmación, punta a punta", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "w1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: NUMERO_CATEGORIA_UNAS, wamid: "w2" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w3" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w4" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w5" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w6" }, deps);
    assert.match(envios.enviados.at(-1)!.mensaje, /Estos son los datos de tu cita/);
    assert.equal(sesiones.filas[0]!.step, "S5_CONFIRMAR");
  });
});

/**
 * FASE 7 (autorizado) -- creación REAL de la reserva al elegir "1" en
 * S5_CONFIRMAR. Reutiliza crearCitaConNylas TAL CUAL (sin ningún cambio,
 * ver lib/reserva-servicio-nylas.ts) -- por eso este archivo SIEMPRE la
 * reemplaza con crearFakeCrearCitaConNylas: ninguna prueba de esta sección
 * puede, ni por accidente, crear una cita real ni un evento real de Nylas.
 */
describe("FASE 7 (autorizado) -- confirmar la cita crea la reserva REAL (S5_CONFIRMAR, opción 1)", () => {
  async function llegarAConfirmacion(deps: AgendaV2RouterDeps, telefono = "573148127388") {
    await llegarAMenuProfesionalDipping(deps, telefono);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "w4" }, deps); // Mary
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "w5" }, deps); // 2026-09-08
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "w6" }, deps); // 09:00
  }

  it("Test 1/7 -- confirmación válida: crea la reserva (fakeada) con los datos REALES de la sesión y cierra la sesión", async () => {
    const fake = crearFakeCrearCitaConNylas(RESULTADO_EXITO_DIPPING_MARY);
    const { deps, sesiones, envios } = armarDeps({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: fake.crearCitaConNylas });
    await llegarAConfirmacion(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w7" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(fake.llamadas.length, 1);
    const llamada = fake.llamadas[0]!;
    assert.equal(llamada.params.idTenant, "amore-test");
    assert.equal(llamada.params.servicioId, "s-dipping-real");
    assert.equal(llamada.params.especialistaId, 1262);
    assert.equal(llamada.params.telefonoCliente, "573148127388");
    assert.equal(llamada.params.nombreCliente, "Ana Pérez", "usa el nombre ya conocido de esta clienta (nunca pide uno nuevo)");
    assert.equal(llamada.params.inicio.toISOString(), new Date("2026-09-08T09:00:00-05:00").toISOString());
    assert.equal(typeof llamada.params.idempotencyKey, "string");
    assert.ok(llamada.params.idempotencyKey.length > 0);

    assert.equal(sesiones.filas[0]!.activo, false, "la sesión se cierra SOLO tras confirmar el éxito real");
    const mensaje = envios.enviados.at(-1)!.mensaje;
    assert.match(mensaje, /¡Listo! 💗 Tu cita quedó agendada/);
    assert.match(mensaje, /Servicio: Dipping/);
    assert.match(mensaje, /Profesional: Mary/);
    assert.match(mensaje, /Fecha: Martes 8 de septiembre/);
    assert.match(mensaje, /Hora: 9:00 a\. m\./);
    assert.match(mensaje, /Valor: \$60\.000/);
  });

  it("Test 2 -- sesión incompleta (sin profesionalId) al confirmar: NUNCA invoca crearCitaConNylas, se reinicia de forma segura", async () => {
    const { deps, sesiones, envios } = armarDeps({ crearCitaConNylas: crearCitaConNylasNuncaDebeLlamarse });
    await sesiones.crearSesion(FAKE_SUPABASE, {
      tenantId: "amore-test",
      telefonoCliente: "573148127388",
      wamid: "w0",
      opcionesMostradas: OPCIONES_CONFIRMACION,
    });
    // Estado inconsistente a propósito: S5_CONFIRMAR con servicioId pero SIN profesionalId/fechaIso/slotSeleccionado.
    await sesiones.actualizarSesion(FAKE_SUPABASE, sesiones.filas[0]!.id, { step: "S5_CONFIRMAR", servicioId: "s-dipping-real" });

    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w1" },
      deps,
    );
    assert.equal(r.manejado, true, "nunca rompe ni lanza una excepción sin capturar (crearCitaConNylasNuncaDebeLlamarse habría lanzado si se hubiera llamado)");
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO", "se reinicia a categorías reales, nunca queda en un estado roto");
    assert.match(envios.enviados[0]!.mensaje, /Ocurrió un problema con tu selección/);
  });

  it("Test 3 -- revalidación: el horario ya no está disponible ('ocupado') -- NUNCA crea nada, informa y vuelve a S4_HORA manteniendo servicio/profesional/fecha", async () => {
    const fake = crearFakeCrearCitaConNylas(RESULTADO_OCUPADO);
    const { deps, sesiones, envios } = armarDeps({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: fake.crearCitaConNylas });
    await llegarAConfirmacion(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w7" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(fake.llamadas.length, 1);
    assert.equal(sesiones.filas[0]!.activo, true, "la sesión NUNCA se cierra si no se creó la cita");
    assert.equal(sesiones.filas[0]!.step, "S4_HORA", "vuelve a horas -- reutiliza la Fase 5 tal cual");
    assert.equal(sesiones.filas[0]!.servicioId, "s-dipping-real", "nunca pierde el servicio");
    assert.equal(sesiones.filas[0]!.profesionalId, 1262, "nunca pierde el profesional");
    assert.equal(sesiones.filas[0]!.fechaIso, "2026-09-08", "nunca pierde la fecha");
    const mensaje = envios.enviados.at(-1)!.mensaje;
    assert.match(mensaje, /Lo siento 💗 Ese horario acaba de ser ocupado\./);
    assert.match(mensaje, /Estos son los horarios disponibles/, "muestra de nuevo los horarios reales de esa misma fecha");
  });

  it("Test 4/8 -- error de negocio al crear (config/DB): NUNCA marca éxito, conserva la sesión en S5_CONFIRMAR para poder reintentar", async () => {
    const fake = crearFakeCrearCitaConNylas(RESULTADO_ERROR_DB);
    const { deps, sesiones, envios } = armarDeps({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: fake.crearCitaConNylas });
    await llegarAConfirmacion(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w7" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.activo, true, "nunca se cierra en un fallo");
    assert.equal(sesiones.filas[0]!.step, "S5_CONFIRMAR", "se mantiene para poder reintentar sin perder nada");
    const mensaje = envios.enviados.at(-1)!.mensaje;
    assert.doesNotMatch(mensaje, /¡Listo!/, "nunca dice que la cita quedó agendada si no fue así");
    assert.match(mensaje, /problema técnico/i);
  });

  it("Test 4b -- crearCitaConNylas lanza una excepción real (ej. red/Nylas caído): se captura, NUNCA se marca éxito, se conserva la sesión", async () => {
    const crearCitaConNylasQueLanza = async (): Promise<ResultadoCrearCitaNylas> => {
      throw new Error("network error simulado");
    };
    const { deps, sesiones, envios } = armarDeps({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: crearCitaConNylasQueLanza });
    await llegarAConfirmacion(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w7" },
      deps,
    );
    assert.equal(r.manejado, true, "la excepción se captura -- nunca tumba el canal completo");
    assert.equal(sesiones.filas[0]!.activo, true);
    assert.equal(sesiones.filas[0]!.step, "S5_CONFIRMAR");
    assert.match(envios.enviados.at(-1)!.mensaje, /problema técnico/i);
  });

  it("Test 5/12 -- mismo wamid duplicado al confirmar: crearCitaConNylas se invoca EXACTAMENTE una vez, nunca una segunda reserva", async () => {
    const fake = crearFakeCrearCitaConNylas(RESULTADO_EXITO_DIPPING_MARY);
    const { deps, envios } = armarDeps({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: fake.crearCitaConNylas });
    await llegarAConfirmacion(deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w7" }, deps);
    const totalEnviosTrasPrimeraVez = envios.enviados.length;
    assert.equal(fake.llamadas.length, 1);

    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w7" }, deps); // mismo wamid exacto
    assert.equal(fake.llamadas.length, 1, "el wamid ya se procesó -- crearCitaConNylas NUNCA se invoca una segunda vez");
    assert.equal(envios.enviados.length, totalEnviosTrasPrimeraVez, "tampoco se reenvía un segundo mensaje de éxito");
  });

  it("Test 6 -- condición de carrera real (EXCLUDE de Postgres detecta doble reserva): NUNCA se crea un duplicado, se informa y vuelve a horarios", async () => {
    const fake = crearFakeCrearCitaConNylas(RESULTADO_OCUPADO_POR_CARRERA);
    const { deps, sesiones, envios } = armarDeps({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: fake.crearCitaConNylas });
    await llegarAConfirmacion(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w7" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(fake.llamadas.length, 1, "un solo intento real -- la protección final la da la base de datos, nunca un reintento automático de este router");
    assert.equal(sesiones.filas[0]!.activo, true);
    assert.equal(sesiones.filas[0]!.step, "S4_HORA");
    assert.doesNotMatch(envios.enviados.at(-1)!.mensaje, /¡Listo!/, "la base de datos rechazó la creación -- nunca se informa éxito");
  });

  it("Test 9 -- el mensaje de éxito usa datos DINÁMICOS: con otro servicio/profesional/fecha/hora reales, el mensaje cambia en consecuencia (nunca queda fijo)", async () => {
    const resultadoPressOnNata: ResultadoCrearCitaNylas = {
      ok: true,
      cita: { ...CITA_FAKE_BASE, id: 9002, especialista_id: 1264, servicio: "Press On", servicio_id: "s-presson-real", inicio: "2026-09-09T16:00:00.000Z", fin: "2026-09-09T18:00:00.000Z" },
      nylasEventId: "evt-fake-2",
      especialista: { id: 1264, nombre: "Nata" },
      servicio: { id: "s-presson-real", nombre: "Press On", duracionMin: 120 },
    };
    const fake = crearFakeCrearCitaConNylas(resultadoPressOnNata);
    const { deps, envios } = armarDeps({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: fake.crearCitaConNylas });
    const telefono = "573148127388";
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "quiero una cita", wamid: "w1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: NUMERO_CATEGORIA_UNAS, wamid: "w2" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "2", wamid: "w3" }, deps); // Press On
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "3", wamid: "w4" }, deps); // Nata
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "2", wamid: "w5" }, deps); // 2026-09-09
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "w6" }, deps); // 11:00
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "w7" }, deps); // confirmar

    const mensaje = envios.enviados.at(-1)!.mensaje;
    assert.match(mensaje, /Servicio: Press On/);
    assert.match(mensaje, /Profesional: Nata/);
    assert.match(mensaje, /Fecha: Miércoles 9 de septiembre/);
    assert.match(mensaje, /Hora: 11:00 a\. m\./);
    assert.match(mensaje, /Valor: \$80\.000/);
    assert.doesNotMatch(mensaje, /Dipping|Mary/, "nunca mezcla datos de otra reserva/servicio");
  });

  it("Test 10 -- no afecta otros tenants: confirmar en un tenant nunca crea ni toca la reserva/sesión de otro tenant", async () => {
    const fake = crearFakeCrearCitaConNylas(RESULTADO_EXITO_DIPPING_MARY);
    const { deps, sesiones, envios } = armarDeps({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: fake.crearCitaConNylas });
    const telefono = "573148127388";

    // Tenant A hasta S5_CONFIRMAR.
    await llegarAConfirmacion(deps, telefono);
    // Tenant B (MISMO teléfono real, tenant distinto) también hasta S5_CONFIRMAR -- aislamiento real por (tenant, teléfono).
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "otro-tenant-test", telefono, texto: "quiero una cita", wamid: "b1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "otro-tenant-test", telefono, texto: NUMERO_CATEGORIA_UNAS, wamid: "b2" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "otro-tenant-test", telefono, texto: "1", wamid: "b3" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "otro-tenant-test", telefono, texto: "1", wamid: "b4" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "otro-tenant-test", telefono, texto: "1", wamid: "b5" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "otro-tenant-test", telefono, texto: "1", wamid: "b6" }, deps);

    const filaB = sesiones.filas.find((f) => f.tenantId === "otro-tenant-test")!;
    assert.equal(filaB.step, "S5_CONFIRMAR");
    const enviosATrasLlegar = envios.enviados.length;

    // Solo el tenant A confirma.
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "w7" }, deps);

    assert.equal(fake.llamadas.length, 1, "crearCitaConNylas se invoca UNA sola vez, nunca para el otro tenant");
    assert.equal(fake.llamadas[0]!.params.idTenant, "amore-test");
    const filaA = sesiones.filas.find((f) => f.tenantId === "amore-test")!;
    assert.equal(filaA.activo, false, "A se cierra tras confirmar");
    const filaBDespues = sesiones.filas.find((f) => f.tenantId === "otro-tenant-test")!;
    assert.equal(filaBDespues.activo, true, "B NUNCA se toca por una confirmación de A");
    assert.equal(filaBDespues.step, "S5_CONFIRMAR", "B sigue exactamente donde estaba");
    assert.ok(envios.enviados.length > enviosATrasLlegar, "solo se envió el mensaje de éxito de A, nada nuevo para B");
  });

  it("TEST DE SEGURIDAD -- la cita R-2CX / ID 3057 NUNCA es referenciada, modificada, actualizada ni usada como objetivo de ninguna operación de esta fase", async () => {
    // Estructural, no solo por este test puntual: crearCitaConNylas (lib/reserva-servicio-nylas.ts,
    // SIN NINGÚN CAMBIO en esta fase) únicamente INSERTA una fila nueva vía
    // crearCitaEspecialista -- nunca recibe ni acepta el id de una cita
    // existente, y jamás actualiza/borra una cita por id (salvo, en el único
    // camino de rollback, el evento de NYLAS que ÉL MISMO acaba de crear en
    // esa misma llamada -- nunca uno preexistente). router.ts (Fase 7) no
    // importa ninguna función de "actualizar/eliminar cita por id" -- el
    // único import de creación es crearCitaConNylas. Por lo tanto ninguna
    // cita existente (incluida R-2CX/3057) puede ser alcanzada por este
    // código, con o sin fake. Este test verifica, además, que los datos REALES
    // enviados en la llamada son exclusivamente los de la sesión actual.
    const fake = crearFakeCrearCitaConNylas(RESULTADO_EXITO_DIPPING_MARY);
    const { deps } = armarDeps({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: fake.crearCitaConNylas });
    await llegarAConfirmacion(deps);
    await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w7" },
      deps,
    );
    assert.equal(fake.llamadas.length, 1);
    const paramsSerializados = JSON.stringify(fake.llamadas[0]!.params);
    assert.doesNotMatch(paramsSerializados, /3057/, "jamás referencia el id de la cita real R-2CX");
    assert.doesNotMatch(paramsSerializados, /R-2CX/i, "jamás referencia el código de la cita real R-2CX");
    // Los únicos datos usados son los REALES de ESTA sesión (Dipping/Mary/2026-09-08 09:00), nunca un id ajeno.
    assert.equal(fake.llamadas[0]!.params.servicioId, "s-dipping-real");
    assert.equal(fake.llamadas[0]!.params.especialistaId, 1262);
  });

  it("defensivo -- sin conexión con Nylas (sin grant_id/API key): NUNCA intenta crear, informa el problema y conserva la sesión", async () => {
    const fake = crearFakeCrearCitaConNylas(RESULTADO_EXITO_DIPPING_MARY);
    const { deps, sesiones, envios } = armarDeps({
      crearCitaConNylas: fake.crearCitaConNylas,
      resolverNylasGrantIdParaTenant: () => null,
      resolveNylasApiKeyFromEnv: () => null,
    });
    await llegarAConfirmacion(deps);
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "w7" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(fake.llamadas.length, 0, "sin grant/API key nunca se intenta crear nada");
    assert.equal(sesiones.filas[0]!.activo, true);
    assert.equal(sesiones.filas[0]!.step, "S5_CONFIRMAR");
    assert.match(envios.enviados.at(-1)!.mensaje, /problema técnico/i);
  });
});

/**
 * FASE 8 (autorizado) -- gestión de citas existentes (consultar/cancelar/
 * reprogramar). Reutiliza el mismo criterio de fixtures de todo este
 * archivo -- nunca toca Supabase/Nylas reales. Fechas elegidas para que
 * fechaColombiaDesdeIso/horaColombiaDesdeIso (reales, sin mockear) den
 * EXACTAMENTE los mismos textos del ejemplo del pedido: "2026-09-08" es
 * martes (confirmado arriba, FASE 4), "2026-09-10" es jueves.
 */
const PN_AMORE = "whatsapp-qr:amore-test";
const PN_OTRO_TENANT = "whatsapp-qr:otro-tenant-test";

const ESPECIALISTA_COMPLETO: Record<number, Especialista> = Object.fromEntries(
  [
    [1262, "Mary"],
    [1263, "Cristal"],
    [1264, "Nata"],
    [1265, "Jessica"],
  ].map(([id, nombre]) => [
    id,
    { id: id as number, id_tenant: "amore-test", phone_number_id: PN_AMORE, nombre: nombre as string, numero_whatsapp: "", servicio: "", duracion_min: 0, token: "", activo: true, bloquea_horario: true, es_general: false, requiere_aprobacion: false },
  ]),
);
async function especialistaPorIdFixture(_s: unknown, id: number): Promise<Especialista | null> {
  return ESPECIALISTA_COMPLETO[id] ?? null;
}

const CITA_CELULAS_MADRES: CitaEspecialista = {
  id: 501,
  especialista_id: 1265, // Jessica
  telefono_cliente: "573148127388",
  nombre_cliente: "Ana Pérez",
  servicio: "Células Madres",
  servicio_id: "s-dipping-real", // 60.000 / 120 min en CATALOGO_FIXTURE
  inicio: "2026-09-08T21:00:00.000Z", // 4:00 p.m. Colombia, martes 8
  fin: "2026-09-08T23:00:00.000Z",
  estado: "confirmada",
  motivo_rechazo: null,
  origen: "manual",
};
const CITA_CEJAS_CERA: CitaEspecialista = {
  id: 502,
  especialista_id: 1262, // Mary
  telefono_cliente: "573148127388",
  nombre_cliente: "Ana Pérez",
  servicio: "Cejas con Cera",
  servicio_id: "s-presson-real", // 80.000 / 120 min en CATALOGO_FIXTURE
  inicio: "2026-09-10T19:00:00.000Z", // 2:00 p.m. Colombia, jueves 10
  fin: "2026-09-10T21:00:00.000Z",
  estado: "confirmada",
  motivo_rechazo: null,
  origen: "manual",
};

/** `porPhoneNumberId` -- simula el filtro real (phone_number_id + telefono_cliente) de consultarCitasActivasEspecialista. */
function crearFakeConsultarCitasActivas(porPhoneNumberId: Record<string, CitaEspecialista[]>) {
  const llamadas: Array<{ phoneNumberId: string; telefonoCliente: string }> = [];
  const consultarCitasActivas = async (_s: unknown, params: { phoneNumberId: string; telefonoCliente: string }): Promise<ResultadoCitasActivasEspecialista> => {
    llamadas.push(params);
    const citas = (porPhoneNumberId[params.phoneNumberId] ?? []).filter((c) => c.telefono_cliente === params.telefonoCliente);
    return { cantidad: citas.length, citas };
  };
  return { llamadas, consultarCitasActivas };
}

function crearFakeCancelarCitaEspecialista(resultado: ResultadoCancelarCitaEspecialista | ((p: { citaId?: number }) => ResultadoCancelarCitaEspecialista)) {
  const llamadas: Array<{ phoneNumberId: string; telefonoCliente: string; confirmado: boolean; citaId?: number }> = [];
  const cancelarCitaEspecialista = async (_s: unknown, params: { phoneNumberId: string; telefonoCliente: string; confirmado: boolean; citaId?: number }): Promise<ResultadoCancelarCitaEspecialista> => {
    llamadas.push(params);
    return typeof resultado === "function" ? resultado(params) : resultado;
  };
  return { llamadas, cancelarCitaEspecialista };
}

type ParamsActualizarCitaFixture = { idTenant: string; citaId: number; nuevoInicio: Date; idempotencyKey: string };
function crearFakeActualizarCitaConNylas(resultado: ResultadoActualizarCitaNylas | ((p: ParamsActualizarCitaFixture) => ResultadoActualizarCitaNylas)) {
  const llamadas: Array<{ params: ParamsActualizarCitaFixture }> = [];
  const actualizarCitaConNylas = async (_s: unknown, params: ParamsActualizarCitaFixture): Promise<ResultadoActualizarCitaNylas> => {
    llamadas.push({ params });
    return typeof resultado === "function" ? resultado(params) : resultado;
  };
  return { llamadas, actualizarCitaConNylas };
}

/** Mapeo cita->evento de Nylas en memoria -- reemplaza dulabs_agenda_v2_citas_nylas. */
function crearFakeMapeoNylas(inicial: Record<number, string> = {}) {
  const mapa: Record<number, string> = { ...inicial };
  return {
    mapa,
    guardarNylasEventIdDeCita: async (_s: unknown, citaId: number, nylasEventId: string) => {
      mapa[citaId] = nylasEventId;
    },
    obtenerNylasEventIdDeCita: async (_s: unknown, citaId: number) => mapa[citaId] ?? null,
    borrarNylasEventIdDeCita: async (_s: unknown, citaId: number) => {
      delete mapa[citaId];
    },
  };
}

const RESULTADO_REPROGRAMAR_EXITO: ResultadoActualizarCitaNylas = {
  ok: true,
  cita: { ...CITA_CEJAS_CERA, inicio: "2026-09-08T14:00:00.000Z", fin: "2026-09-08T15:00:00.000Z" }, // 09:00 Colombia, martes 8
  nylasEventId: "evt-nuevo-1",
  nylasEventIdAnterior: "evt-viejo-1",
  especialista: { id: 1262, nombre: "Mary" },
  servicio: { id: "s-presson-real", nombre: "Press On", duracionMin: 120 },
};

describe("FASE 8 (autorizado) -- gestión de citas existentes (consultar/cancelar/reprogramar)", () => {
  describe("CONSULTAR", () => {
    it("Test 1 -- cliente con una cita futura: responde directo, NUNCA crea sesión", async () => {
      const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CELULAS_MADRES] });
      const { deps, sesiones, envios } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas, especialistaPorId: especialistaPorIdFixture });
      const r = await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero ver mi cita", wamid: "g1" }, deps);
      assert.equal(r.manejado, true);
      assert.equal(sesiones.filas.length, 0, "consultar con una sola cita NUNCA crea sesión innecesaria");
      const mensaje = envios.enviados[0]!.mensaje;
      assert.match(mensaje, /Esta es tu próxima cita/);
      assert.match(mensaje, /Servicio: Células Madres/);
      assert.match(mensaje, /Profesional: Jessica/);
      assert.match(mensaje, /Fecha: Martes 8 de septiembre/);
      assert.match(mensaje, /Hora: 4:00 p\. m\./);
      assert.match(mensaje, /Duración: 2 h/);
      assert.match(mensaje, /Valor: \$60\.000/);
      assert.match(mensaje, /Estado: Confirmada/);
    });

    it("Test 2 -- cliente sin citas futuras: mensaje exacto, NUNCA crea sesión", async () => {
      const fakeCitas = crearFakeConsultarCitasActivas({});
      const { deps, sesiones, envios } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas });
      const r = await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "consultar mi cita", wamid: "g1" }, deps);
      assert.equal(r.manejado, true);
      assert.equal(sesiones.filas.length, 0);
      assert.equal(envios.enviados[0]!.mensaje, "No encontramos citas futuras a tu nombre. 💗");
    });

    it("Test 3 -- cliente con varias citas: muestra menú numerado, luego resuelve y consulta la elegida (y cierra la sesión temporal)", async () => {
      const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CELULAS_MADRES, CITA_CEJAS_CERA] });
      const { deps, sesiones, envios } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas, especialistaPorId: especialistaPorIdFixture });
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero ver mi cita", wamid: "g1" }, deps);
      assert.equal(sesiones.filas.length, 1);
      assert.equal(sesiones.filas[0]!.step, "SG_SELECCIONAR_CITA");
      assert.equal(sesiones.filas[0]!.accionGestion, "consultar");
      assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesCita([
        { citaId: 501, servicioNombre: "Células Madres", profesionalNombre: "Jessica", fechaEtiqueta: "Martes 8 de septiembre", horaTexto: "4:00 p. m." },
        { citaId: 502, servicioNombre: "Cejas con Cera", profesionalNombre: "Mary", fechaEtiqueta: "Jueves 10 de septiembre", horaTexto: "2:00 p. m." },
      ]));
      assert.match(envios.enviados[0]!.mensaje, /1\. Células Madres — Jessica/);
      assert.match(envios.enviados[0]!.mensaje, /2\. Cejas con Cera — Mary/);

      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "2", wamid: "g2" }, deps);
      assert.equal(sesiones.filas[0]!.activo, false, "la sesión temporal se cierra tras resolver la consulta");
      assert.match(envios.enviados[1]!.mensaje, /Servicio: Cejas con Cera/);
      assert.match(envios.enviados[1]!.mensaje, /Profesional: Mary/);
    });

    it("Test 4 -- aislamiento por tenant: nunca ve las citas de otro tenant, aunque el teléfono real coincida", async () => {
      const fakeCitas = crearFakeConsultarCitasActivas({
        [PN_AMORE]: [CITA_CELULAS_MADRES],
        [PN_OTRO_TENANT]: [{ ...CITA_CEJAS_CERA, id: 999 }],
      });
      const { deps, envios } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas, especialistaPorId: especialistaPorIdFixture });
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero ver mi cita", wamid: "g1" }, deps);
      assert.match(envios.enviados[0]!.mensaje, /Células Madres/);
      assert.doesNotMatch(envios.enviados[0]!.mensaje, /Cejas con Cera/, "nunca debe mostrar una cita de otro tenant");
    });

    it("Test 5 -- aislamiento por teléfono: dos clientas del mismo tenant nunca ven la cita de la otra", async () => {
      const fakeCitas = crearFakeConsultarCitasActivas({
        [PN_AMORE]: [CITA_CELULAS_MADRES, { ...CITA_CEJAS_CERA, telefono_cliente: "573000000000" }],
      });
      const { deps, envios } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas, especialistaPorId: especialistaPorIdFixture });
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero ver mi cita", wamid: "g1" }, deps);
      assert.match(envios.enviados[0]!.mensaje, /Células Madres/);
      assert.doesNotMatch(envios.enviados[0]!.mensaje, /Cejas con Cera/, "nunca debe mostrar la cita de otra clienta");
    });
  });

  describe("CANCELAR", () => {
    it("Test 6 -- muestra la confirmación ANTES de cancelar nada", async () => {
      const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CELULAS_MADRES] });
      const fakeCancelar = crearFakeCancelarCitaEspecialista({ ok: true, cita: CITA_CELULAS_MADRES });
      const { deps, sesiones, envios } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas, especialistaPorId: especialistaPorIdFixture, cancelarCitaEspecialista: fakeCancelar.cancelarCitaEspecialista });
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cancelar mi cita", wamid: "g1" }, deps);
      assert.equal(fakeCancelar.llamadas.length, 0, "NUNCA cancela antes de la confirmación");
      assert.equal(sesiones.filas.length, 1);
      assert.equal(sesiones.filas[0]!.step, "SG_CANCELAR_CONFIRMAR");
      assert.equal(sesiones.filas[0]!.citaObjetivoId, 501);
      const mensaje = envios.enviados[0]!.mensaje;
      assert.match(mensaje, /Vas a cancelar esta cita/);
      assert.match(mensaje, /Servicio: Células Madres/);
      assert.match(mensaje, /1\. Sí, cancelar/);
      assert.match(mensaje, /2\. No, conservar cita/);
    });

    it("Test 7 -- confirmación positiva ('1') ejecuta la cancelación real", async () => {
      const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CELULAS_MADRES] });
      const fakeCancelar = crearFakeCancelarCitaEspecialista({ ok: true, cita: { ...CITA_CELULAS_MADRES, estado: "cancelada" } });
      const { deps, sesiones, envios } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas, especialistaPorId: especialistaPorIdFixture, cancelarCitaEspecialista: fakeCancelar.cancelarCitaEspecialista });
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cancelar mi cita", wamid: "g1" }, deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "g2" }, deps);
      assert.equal(fakeCancelar.llamadas.length, 1);
      assert.equal(fakeCancelar.llamadas[0]!.citaId, 501);
      assert.equal(fakeCancelar.llamadas[0]!.confirmado, true);
      assert.equal(sesiones.filas[0]!.activo, false);
      assert.equal(envios.enviados.at(-1)!.mensaje, "Tu cita fue cancelada correctamente. 💗");
    });

    it("Test 8 -- cancelación real mockeada además borra (best-effort) el evento real de Nylas si existe mapeo", async () => {
      const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CELULAS_MADRES] });
      const fakeCancelar = crearFakeCancelarCitaEspecialista({ ok: true, cita: { ...CITA_CELULAS_MADRES, estado: "cancelada" } });
      const fakeMapeo = crearFakeMapeoNylas({ 501: "evt-a-borrar" });
      let eventoBorrado: string | undefined;
      const { deps } = armarDeps({
        consultarCitasActivas: fakeCitas.consultarCitasActivas,
        especialistaPorId: especialistaPorIdFixture,
        cancelarCitaEspecialista: fakeCancelar.cancelarCitaEspecialista,
        obtenerNylasEventIdDeCita: fakeMapeo.obtenerNylasEventIdDeCita,
        borrarNylasEventIdDeCita: fakeMapeo.borrarNylasEventIdDeCita,
        resolverNylasGrantIdParaTenant: () => "grant-fake",
        resolveNylasApiKeyFromEnv: () => "api-key-fake",
        createNylasEventsWriteClient: () => ({ createEvent: async () => ({ id: "no-usado" }), deleteEvent: async (p) => void (eventoBorrado = p.eventId) }),
        resolverCalendarIdNylasDeEspecialista: async () => "cal-mary",
      });
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cancelar mi cita", wamid: "g1" }, deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "g2" }, deps);
      assert.equal(eventoBorrado, "evt-a-borrar");
      assert.equal(fakeMapeo.mapa[501], undefined, "el mapeo se borra tras cancelar");
    });

    it("Test 9 -- rechazo de cancelación: NUNCA envía éxito si la operación falló", async () => {
      const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CELULAS_MADRES] });
      const fakeCancelar = crearFakeCancelarCitaEspecialista({ ok: false, motivo: "error", detalle: "fallo simulado" });
      const { deps, sesiones, envios } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas, especialistaPorId: especialistaPorIdFixture, cancelarCitaEspecialista: fakeCancelar.cancelarCitaEspecialista });
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cancelar mi cita", wamid: "g1" }, deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "g2" }, deps);
      assert.doesNotMatch(envios.enviados.at(-1)!.mensaje, /cancelada correctamente/);
      assert.equal(envios.enviados.at(-1)!.mensaje, "No pudimos cancelar tu cita en este momento. Por favor intenta nuevamente.");
      assert.equal(sesiones.filas[0]!.activo, false);
    });

    it("Test 10 -- mensaje duplicado (mismo wamid) al confirmar cancelación: NUNCA cancela dos veces", async () => {
      const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CELULAS_MADRES] });
      const fakeCancelar = crearFakeCancelarCitaEspecialista({ ok: true, cita: { ...CITA_CELULAS_MADRES, estado: "cancelada" } });
      const { deps } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas, especialistaPorId: especialistaPorIdFixture, cancelarCitaEspecialista: fakeCancelar.cancelarCitaEspecialista });
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cancelar mi cita", wamid: "g1" }, deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "g2" }, deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "g2" }, deps); // mismo wamid exacto
      assert.equal(fakeCancelar.llamadas.length, 1);
    });

    it("Test 11 -- NUNCA modifica otra cita: cancelarCitaEspecialista se invoca EXCLUSIVAMENTE con el citaId real de esta clienta", async () => {
      const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CELULAS_MADRES, CITA_CEJAS_CERA] });
      const fakeCancelar = crearFakeCancelarCitaEspecialista({ ok: true, cita: CITA_CELULAS_MADRES });
      const { deps } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas, especialistaPorId: especialistaPorIdFixture, cancelarCitaEspecialista: fakeCancelar.cancelarCitaEspecialista });
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cancelar mi cita", wamid: "g1" }, deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "g2" }, deps); // elige la cita 501 (menú de varias -- ver Test 3)
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "g3" }, deps); // confirma la cancelación de ESA cita
      assert.equal(fakeCancelar.llamadas.length, 1);
      assert.equal(fakeCancelar.llamadas[0]!.citaId, 501, "solo toca la cita elegida, nunca la 502");
    });
  });

  describe("REPROGRAMAR", () => {
    /** Lleva la sesión hasta S5_CONFIRMAR reprogramando CITA_CEJAS_CERA (Mary, Press On) a 2026-09-08 09:00. */
    async function llegarAConfirmarCambio(deps: AgendaV2RouterDeps, telefono = "573148127388") {
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "quiero cambiar mi cita", wamid: "r1" }, deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "r2" }, deps); // sí, reprogramar
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "r3" }, deps); // 2026-09-08
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "r4" }, deps); // 09:00
    }
    function armarDepsReprogramar(overrides: Partial<AgendaV2RouterDeps> = {}) {
      const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CEJAS_CERA] });
      return armarDeps({
        consultarCitasActivas: fakeCitas.consultarCitasActivas,
        especialistaPorId: especialistaPorIdFixture,
        ...NYLAS_DEPS_FAKE_OVERRIDES,
        ...overrides,
      });
    }

    it("Test 12 -- selección de la cita (una sola): muestra la cita ACTUAL y pide confirmar reprogramar", async () => {
      const { deps, sesiones, envios } = armarDepsReprogramar();
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero cambiar mi cita", wamid: "r1" }, deps);
      assert.equal(sesiones.filas[0]!.step, "SG_REPROGRAMAR_CONFIRMAR_INICIO");
      assert.equal(sesiones.filas[0]!.citaObjetivoId, 502);
      const mensaje = envios.enviados[0]!.mensaje;
      assert.match(mensaje, /Esta es tu cita actual/);
      assert.match(mensaje, /Servicio: Cejas con Cera/);
      assert.match(mensaje, /Profesional: Mary/);
      assert.match(mensaje, /1\. Sí, reprogramar/);
    });

    it("Test 13/14 -- 'sí' avanza a S3_DIA con los días REALES del MISMO servicio/profesional (disponibilidad real, Fases 4/5 reutilizadas)", async () => {
      const { deps, sesiones, envios } = armarDepsReprogramar();
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero cambiar mi cita", wamid: "r1" }, deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "r2" }, deps);
      assert.equal(sesiones.filas[0]!.step, "S3_DIA");
      assert.equal(sesiones.filas[0]!.servicioId, "s-presson-real", "conserva el MISMO servicio, nunca pide uno nuevo");
      assert.equal(sesiones.filas[0]!.profesionalId, 1262, "conserva la MISMA profesional, nunca cambia (sección CAMBIO DE PROFESIONAL)");
      assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, { opciones: construirOpcionesFecha(DIAS_POR_PROFESIONAL_FIXTURE[1262]!), numeroVerMasFechas: null });
      assert.match(envios.enviados.at(-1)!.mensaje, /¿Qué día deseas agendar\?/);
    });

    it("Test 15 -- selección de nueva hora: horarios REALES de la fecha elegida", async () => {
      const { deps, sesiones, envios } = armarDepsReprogramar();
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero cambiar mi cita", wamid: "r1" }, deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "r2" }, deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "r3" }, deps); // 2026-09-08
      assert.equal(sesiones.filas[0]!.step, "S4_HORA");
      assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesHora("2026-09-08", HORAS_POR_FECHA_FIXTURE["2026-09-08"]!));
      assert.match(envios.enviados.at(-1)!.mensaje, /Estos son los horarios disponibles/);
    });

    it("Test 16 -- confirmación: resumen de CAMBIO (nunca el de una cita nueva), con el MISMO menú de control", async () => {
      const { deps, sesiones, envios } = armarDepsReprogramar();
      await llegarAConfirmarCambio(deps);
      assert.equal(sesiones.filas[0]!.step, "S5_CONFIRMAR");
      const mensaje = envios.enviados.at(-1)!.mensaje;
      assert.match(mensaje, /Vas a cambiar tu cita a/);
      assert.match(mensaje, /Profesional: Mary/);
      assert.match(mensaje, /¿Confirmas el cambio\?/);
      assert.match(mensaje, /1\. Confirmar cita/);
      assert.doesNotMatch(mensaje, /Estos son los datos de tu cita/, "nunca usa el encabezado de una reserva nueva");
    });

    it("Test 17 -- revalidación antes de aplicar el cambio: actualizarCitaConNylas se llama con el NUEVO horario exacto", async () => {
      const fake = crearFakeActualizarCitaConNylas(RESULTADO_REPROGRAMAR_EXITO);
      const { deps } = armarDepsReprogramar({ actualizarCitaConNylas: fake.actualizarCitaConNylas });
      await llegarAConfirmarCambio(deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "r5" }, deps);
      assert.equal(fake.llamadas.length, 1);
      assert.equal(fake.llamadas[0]!.params.citaId, 502);
      assert.equal(fake.llamadas[0]!.params.nuevoInicio.toISOString(), new Date("2026-09-08T09:00:00-05:00").toISOString());
    });

    it("Test 18 -- horario recién ocupado en la revalidación: NUNCA aplica el cambio, vuelve a S4_HORA manteniendo servicio/profesional/fecha", async () => {
      const fake = crearFakeActualizarCitaConNylas({ ok: false, motivo: "ocupado", detalle: "Ese horario ya fue tomado en Google Calendar." });
      const { deps, sesiones, envios } = armarDepsReprogramar({ actualizarCitaConNylas: fake.actualizarCitaConNylas });
      await llegarAConfirmarCambio(deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "r5" }, deps);
      assert.equal(sesiones.filas[0]!.activo, true, "la cita ORIGINAL nunca se pierde -- la sesión sigue viva");
      assert.equal(sesiones.filas[0]!.step, "S4_HORA");
      assert.equal(sesiones.filas[0]!.servicioId, "s-presson-real");
      assert.equal(sesiones.filas[0]!.profesionalId, 1262);
      assert.equal(sesiones.filas[0]!.fechaIso, "2026-09-08");
      const mensaje = envios.enviados.at(-1)!.mensaje;
      assert.match(mensaje, /Lo siento 💗 Ese horario acaba de ser ocupado\./);
      assert.match(mensaje, /Estos son los horarios disponibles/);
    });

    it("Test 19 -- error al actualizar (config/DB/excepción): NUNCA marca éxito, conserva la sesión para reintentar", async () => {
      const fake = crearFakeActualizarCitaConNylas({ ok: false, motivo: "error_de_base_de_datos", detalle: "error simulado" });
      const { deps, sesiones, envios } = armarDepsReprogramar({ actualizarCitaConNylas: fake.actualizarCitaConNylas });
      await llegarAConfirmarCambio(deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "r5" }, deps);
      assert.equal(sesiones.filas[0]!.activo, true);
      assert.equal(sesiones.filas[0]!.step, "S5_CONFIRMAR");
      assert.doesNotMatch(envios.enviados.at(-1)!.mensaje, /¡Listo!/);
      assert.equal(envios.enviados.at(-1)!.mensaje, "No pudimos reprogramar tu cita en este momento. Por favor intenta nuevamente.");
    });

    it("Test 20 -- idempotencia: mismo wamid duplicado NUNCA reprograma dos veces", async () => {
      const fake = crearFakeActualizarCitaConNylas(RESULTADO_REPROGRAMAR_EXITO);
      const { deps } = armarDepsReprogramar({ actualizarCitaConNylas: fake.actualizarCitaConNylas });
      await llegarAConfirmarCambio(deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "r5" }, deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "r5" }, deps); // mismo wamid
      assert.equal(fake.llamadas.length, 1);
    });

    it("Test 21/22 -- condición de carrera (EXCLUDE detecta doble reserva): NUNCA crea una segunda cita, informa y vuelve a horarios", async () => {
      const fake = crearFakeActualizarCitaConNylas({ ok: false, motivo: "ocupado", detalle: "Ese horario ya fue tomado (protección final de PostgreSQL). Tu cita original sigue intacta." });
      const { deps, sesiones } = armarDepsReprogramar({ actualizarCitaConNylas: fake.actualizarCitaConNylas });
      await llegarAConfirmarCambio(deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "r5" }, deps);
      assert.equal(fake.llamadas.length, 1, "un solo intento -- la protección real la da la base de datos, nunca un reintento automático");
      assert.equal(sesiones.filas[0]!.step, "S4_HORA");
    });

    it("Test 23 -- la cita reprogramada conserva su identidad: éxito real usa el MISMO citaId, nunca crea uno nuevo", async () => {
      const fake = crearFakeActualizarCitaConNylas(RESULTADO_REPROGRAMAR_EXITO);
      const { deps } = armarDepsReprogramar({ actualizarCitaConNylas: fake.actualizarCitaConNylas });
      await llegarAConfirmarCambio(deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "r5" }, deps);
      assert.equal(fake.llamadas[0]!.params.citaId, 502, "actualiza la MISMA cita, identificada por su id real");
    });

    it("éxito real: cierra la sesión y el mensaje final usa datos DINÁMICOS de la nueva fecha/hora", async () => {
      const fake = crearFakeActualizarCitaConNylas(RESULTADO_REPROGRAMAR_EXITO);
      const { deps, sesiones, envios } = armarDepsReprogramar({ actualizarCitaConNylas: fake.actualizarCitaConNylas });
      await llegarAConfirmarCambio(deps);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "r5" }, deps);
      assert.equal(sesiones.filas[0]!.activo, false);
      const mensaje = envios.enviados.at(-1)!.mensaje;
      assert.match(mensaje, /¡Listo! 💗 Tu cita fue reprogramada/);
      assert.match(mensaje, /Profesional: Mary/);
      assert.match(mensaje, /Nueva fecha: Martes 8 de septiembre/);
      assert.match(mensaje, /Nueva hora: 9:00 a\. m\./);
    });

    it("Test 24 -- aislamiento multi-tenant: reprogramar en un tenant nunca toca la sesión/cita de otro", async () => {
      const fakeCitasA = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CEJAS_CERA], [PN_OTRO_TENANT]: [{ ...CITA_CEJAS_CERA, id: 777 }] });
      const fake = crearFakeActualizarCitaConNylas(RESULTADO_REPROGRAMAR_EXITO);
      const { deps, sesiones } = armarDeps({
        consultarCitasActivas: fakeCitasA.consultarCitasActivas,
        especialistaPorId: especialistaPorIdFixture,
        ...NYLAS_DEPS_FAKE_OVERRIDES,
        actualizarCitaConNylas: fake.actualizarCitaConNylas,
      });
      const telefono = "573148127388";
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "otro-tenant-test", telefono, texto: "quiero cambiar mi cita", wamid: "b1" }, deps);
      await llegarAConfirmarCambio(deps, telefono);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "r5" }, deps);

      assert.equal(fake.llamadas.length, 1);
      assert.equal(fake.llamadas[0]!.params.citaId, 502, "nunca toca la cita 777 del otro tenant");
      assert.equal(fake.llamadas[0]!.params.idTenant, "amore-test");
      const filaOtroTenant = sesiones.filas.find((f) => f.tenantId === "otro-tenant-test")!;
      assert.equal(filaOtroTenant.activo, true, "el otro tenant NUNCA se toca por una reprogramación en amore-test");
    });
  });

  describe("SEGURIDAD", () => {
    it("TEST DE SEGURIDAD -- la cita R-2CX / ID 3057 NUNCA es referenciada, modificada, cancelada, reprogramada ni eliminada por ningún flujo de Fase 8", async () => {
      // Estructural: cancelarCitaEspecialista/actualizarCitaConNylas (sin
      // cambios) solo actúan sobre el citaId que router.ts resuelve --
      // SIEMPRE proveniente de consultarCitasActivasEspecialista filtrado
      // por (phone_number_id, telefono_cliente) reales de ESTA conversación,
      // nunca de un dato enviado directamente por el cliente. Este test
      // verifica, con datos reales de esta clienta, que ningún citaId/código
      // ajeno (como "3057"/"R-2CX") aparece en ninguna llamada real.
      // Cancelar una cita real de esta clienta (camino de una sola cita).
      const fakeCancelar = crearFakeCancelarCitaEspecialista({ ok: true, cita: CITA_CELULAS_MADRES });
      const depsCancelar = armarDeps({
        consultarCitasActivas: crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CELULAS_MADRES] }).consultarCitasActivas,
        especialistaPorId: especialistaPorIdFixture,
        cancelarCitaEspecialista: fakeCancelar.cancelarCitaEspecialista,
      }).deps;
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "cancelar mi cita", wamid: "s1" }, depsCancelar);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "s2" }, depsCancelar); // confirma cancelar

      assert.equal(fakeCancelar.llamadas.length, 1);
      const paramsCancelar = JSON.stringify(fakeCancelar.llamadas[0]);
      assert.doesNotMatch(paramsCancelar, /3057/, "jamás referencia el id de la cita real R-2CX al cancelar");
      assert.doesNotMatch(paramsCancelar, /R-2CX/i, "jamás referencia el código de la cita real R-2CX al cancelar");
      assert.equal(fakeCancelar.llamadas[0]!.citaId, 501);

      // Reprogramar la otra cita real de esta clienta, en una sesión nueva e independiente.
      const fakeActualizar = crearFakeActualizarCitaConNylas(RESULTADO_REPROGRAMAR_EXITO);
      const depsReprogramar = armarDeps({
        consultarCitasActivas: crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CEJAS_CERA] }).consultarCitasActivas,
        especialistaPorId: especialistaPorIdFixture,
        ...NYLAS_DEPS_FAKE_OVERRIDES,
        actualizarCitaConNylas: fakeActualizar.actualizarCitaConNylas,
      }).deps;
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero cambiar mi cita", wamid: "s3" }, depsReprogramar);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "s4" }, depsReprogramar);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "s5" }, depsReprogramar);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "s6" }, depsReprogramar);
      await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "s7" }, depsReprogramar);

      assert.equal(fakeActualizar.llamadas.length, 1);
      const paramsActualizar = JSON.stringify(fakeActualizar.llamadas[0]!.params);
      assert.doesNotMatch(paramsActualizar, /3057/, "jamás referencia el id de la cita real R-2CX al reprogramar");
      assert.doesNotMatch(paramsActualizar, /R-2CX/i, "jamás referencia el código de la cita real R-2CX al reprogramar");
      assert.equal(fakeActualizar.llamadas[0]!.params.citaId, 502);
    });
  });
});

// ---------------------------------------------------------------------------
// CORRECCIÓN (autorizada) -- caso real reportado: clienta con una reserva ya
// confirmada y CERRADA (sesión Agenda V2 inactiva) escribe "Quiero cancelar
// la cita" -- antes de la corrección de lib/agenda-v2/entrada.ts, esa frase
// (con artículo "la", no "mi") nunca coincidía con FRASES_CANCELAR y el
// mensaje terminaba cayendo hasta Gemini (que no tiene ninguna categoría de
// "cancelar"). Este bloque prueba el camino REAL de principio a fin vía
// procesarMensajeConAgendaV2 -- sin sesión activa, sin tocar Nylas/WhatsApp
// reales -- y prueba estructuralmente que, con el mensaje ya manejado acá,
// Gemini NUNCA se alcanza (mismo orden exacto de app/api/whatsapp-qr-bot/route.ts).
// ---------------------------------------------------------------------------
describe("CORRECCIÓN (autorizada) -- 'Quiero cancelar la cita' con una única cita real y sin sesión activa", () => {
  it("detecta CANCELAR, selecciona automáticamente la única cita, pasa a SG_CANCELAR_CONFIRMAR y pide confirmación -- NUNCA cancela todavía", async () => {
    const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CELULAS_MADRES] });
    const fakeCancelar = crearFakeCancelarCitaEspecialista({ ok: true, cita: { ...CITA_CELULAS_MADRES, estado: "cancelada" } });
    const { deps, sesiones, envios } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas, especialistaPorId: especialistaPorIdFixture, cancelarCitaEspecialista: fakeCancelar.cancelarCitaEspecialista });

    const resultado = await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "Quiero cancelar la cita", wamid: "c1" }, deps);

    assert.equal(resultado.manejado, true, "Agenda V2 maneja el mensaje por completo -- nunca cae a manejado:false");
    assert.equal(sesiones.filas.length, 1);
    assert.equal(sesiones.filas[0]!.step, "SG_CANCELAR_CONFIRMAR");
    assert.equal(sesiones.filas[0]!.citaObjetivoId, 501, "selecciona automáticamente la única cita real de esta clienta, sin pedirle que elija");
    assert.equal(fakeCancelar.llamadas.length, 0, "NUNCA cancela solo porque el cliente escribió 'cancelar' -- primero pide confirmación real");
    const mensaje = envios.enviados.at(-1)!.mensaje;
    assert.match(mensaje, /Vas a cancelar esta cita/);
    assert.match(mensaje, /1\. Sí, cancelar/);
    assert.match(mensaje, /2\. No, conservar cita/);
  });

  it("tras pedir confirmación, '1' SÍ ejecuta la cancelación real (flujo completo, mismo mecanismo ya probado en FASE 8)", async () => {
    const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CELULAS_MADRES] });
    const fakeCancelar = crearFakeCancelarCitaEspecialista({ ok: true, cita: { ...CITA_CELULAS_MADRES, estado: "cancelada" } });
    const { deps, sesiones } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas, especialistaPorId: especialistaPorIdFixture, cancelarCitaEspecialista: fakeCancelar.cancelarCitaEspecialista });

    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "Quiero cancelar la cita", wamid: "c1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "c2" }, deps);

    assert.equal(fakeCancelar.llamadas.length, 1);
    assert.equal(fakeCancelar.llamadas[0]!.citaId, 501);
    assert.equal(sesiones.filas[0]!.activo, false);
  });

  it("el '4' de la conversación real original NUNCA funciona acá -- el menú de SG_CANCELAR_CONFIRMAR es 1/2, no el 1-4 de una confirmación de reserva nueva ya cerrada", async () => {
    const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CELULAS_MADRES] });
    const fakeCancelar = crearFakeCancelarCitaEspecialista({ ok: true, cita: CITA_CELULAS_MADRES });
    const { deps, sesiones, envios } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas, especialistaPorId: especialistaPorIdFixture, cancelarCitaEspecialista: fakeCancelar.cancelarCitaEspecialista });

    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "Quiero cancelar la cita", wamid: "c1" }, deps);
    const r = await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "4", wamid: "c2" }, deps);

    assert.equal(r.manejado, true, "Agenda V2 sigue manejando el mensaje (nunca cae a Gemini) aunque '4' no sea una opción válida acá");
    assert.equal(fakeCancelar.llamadas.length, 0, "'4' nunca cancela nada -- no es una opción reconocida del menú Sí/No");
    assert.equal(sesiones.filas[0]!.step, "SG_CANCELAR_CONFIRMAR", "permanece pidiendo confirmación real, nunca avanza con una opción inválida");
    assert.match(envios.enviados.at(-1)!.mensaje, /No reconocí esa opción/);
  });

  it("PRUEBA ESTRUCTURAL -- con manejado:true, Gemini NUNCA se alcanza (mismo orden exacto de app/api/whatsapp-qr-bot/route.ts: procesarMensajeConAgendaV2 corta ANTES de procesarEntradaAmore)", async () => {
    const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CELULAS_MADRES] });
    const { deps } = armarDeps({ consultarCitasActivas: fakeCitas.consultarCitasActivas, especialistaPorId: especialistaPorIdFixture });

    let geminiAlcanzado = false;
    async function procesarEntradaAmoreFalso() {
      geminiAlcanzado = true;
      return { manejado: true };
    }

    // Mismo orden EXACTO que app/api/whatsapp-qr-bot/route.ts:
    // procesarMensajeConAgendaV2 primero; procesarEntradaAmore (único lugar
    // real que llama a Gemini, ver lib/amore-entrada-router.ts) SOLO se
    // invoca si Agenda V2 devolvió manejado:false.
    const resultadoAgendaV2 = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "Quiero cancelar la cita", wamid: "c1" },
      deps,
    );
    if (!resultadoAgendaV2.manejado) {
      await procesarEntradaAmoreFalso();
    }

    assert.equal(resultadoAgendaV2.manejado, true);
    assert.equal(geminiAlcanzado, false, "Gemini NUNCA debe alcanzarse -- Agenda V2 ya manejó el mensaje por completo");
  });
});

// --- FASE 2 (autorizado, registro de clientes nuevos) ----------------------
//
// Estos tests usan el AMORE_TENANT_ID real (nunca "amore-test", el tenant de
// fixture que usa el resto de este archivo) porque el chequeo nuevo de
// iniciarNuevaSesionAgendaV2 está gateado EXCLUSIVAMENTE por ese tenant --
// con "amore-test" el chequeo nunca se activa, que es exactamente lo que ya
// prueban TODOS los tests de arriba (comportamiento intacto, cero cambios).
//
// Tests C/D/E del pedido (primer mensaje directo, TRIGGER_AGENDA de Gemini,
// opción "1") comparten las 3 el MISMO choke point real:
// iniciarNuevaSesionAgendaV2. amore-entrada-router.test.ts ya prueba que "1"
// y TRIGGER_AGENDA llaman a esa función con los mismos parámetros -- acá se
// prueba directamente esa función (una vez vía el trigger real de
// esInicioDeAgendaV2 para C, y de forma directa para el resto), sin volver a
// tejer todo el puente de entrada.

describe("FASE 2 -- Test C: primer mensaje directo ('quiero agendar') respeta el registro de cliente nuevo", () => {
  it("cliente NO conocido -- inicia registro_nombre, NUNCA crea sesión de Agenda V2", async () => {
    const { deps, sesiones, envios, entradasAmore } = armarDepsAmore();
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: "573148127388", texto: "quiero agendar", wamid: "w1" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas.length, 0, "NUNCA crea una sesión de dulabs_agenda_v2_sesiones mientras el registro está pendiente");
    assert.equal(entradasAmore.filas.length, 1);
    assert.equal(entradasAmore.filas[0]!.modo, "registro_nombre");
    assert.equal(envios.enviados.at(-1)!.mensaje, "Antes de continuar, necesito registrarte en AMORE. 💗\n\n¿Me regalas tu nombre?");
  });
});

describe("FASE 2 -- Test N (a nivel Agenda V2): cliente existente entra directo, sin registro", () => {
  it("cliente YA conocido -- muestra categorías reales de inmediato, cero mensajes de registro", async () => {
    const { deps, sesiones, envios, entradasAmore } = armarDepsAmore({}, { nombre: "Ana Pérez", cumpleDia: 10, cumpleMes: 5 });
    const r = await procesarMensajeConAgendaV2(
      { supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: "573148127388", texto: "quiero agendar", wamid: "w1" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas.length, 1, "crea la sesión de Agenda V2 exactamente como siempre");
    assert.equal(sesiones.filas[0]!.step, "S1_SERVICIO");
    assert.match(envios.enviados.at(-1)!.mensaje, /¿Qué tipo de servicio te gustaría agendar\?/);
    assert.doesNotMatch(envios.enviados.at(-1)!.mensaje, /registrarte en AMORE/);
    assert.equal(entradasAmore.filas.length, 0, "nunca toca dulabs_amore_entrada para un cliente ya conocido");
  });
});

describe("FASE 2 -- Test D/E: iniciarNuevaSesionAgendaV2 llamada directa (mismo choke point real que usan la opción '1' y TRIGGER_AGENDA de Gemini)", () => {
  it("cliente NO conocido -- inicia registro_nombre en vez de armar el menú de categorías", async () => {
    const { deps, sesiones, envios, entradasAmore } = armarDepsAmore();
    await iniciarNuevaSesionAgendaV2({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: "573148127388", wamid: "w1" }, deps);
    assert.equal(sesiones.filas.length, 0);
    assert.equal(entradasAmore.filas[0]!.modo, "registro_nombre");
    assert.equal(envios.enviados.at(-1)!.mensaje, "Antes de continuar, necesito registrarte en AMORE. 💗\n\n¿Me regalas tu nombre?");
  });

  it("cliente NO conocido, pero ya tenía una fila de entrada (ej. venía de modo 'gemini') -- reutiliza la fila, no crea una segunda", async () => {
    const { deps, entradasAmore } = armarDepsAmore();
    await entradasAmore.crearEntradaAmoreDeps(FAKE_SUPABASE, { tenantId: AMORE_TENANT_ID, telefonoCliente: "573148127388", wamid: "w0", modo: "gemini" });
    await iniciarNuevaSesionAgendaV2({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: "573148127388", wamid: "w1" }, deps);
    assert.equal(entradasAmore.filas.length, 1, "actualiza la fila existente, nunca crea una segunda");
    assert.equal(entradasAmore.filas[0]!.modo, "registro_nombre");
  });

  it("cliente YA conocido -- crea la sesión de Agenda V2 exactamente igual que antes de Fase 2", async () => {
    const { deps, sesiones, envios } = armarDepsAmore({}, { nombre: "Laura", cumpleDia: null, cumpleMes: null });
    await iniciarNuevaSesionAgendaV2({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: "573148127388", wamid: "w1" }, deps);
    assert.equal(sesiones.filas.length, 1);
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, construirOpcionesCategoria(CATALOGO_FIXTURE));
    assert.match(envios.enviados.at(-1)!.mensaje, /¿Qué tipo de servicio te gustaría agendar\?/);
  });

  it("otro tenant (nunca AMORE_TENANT_ID) -- el chequeo de cliente conocido NUNCA se evalúa, comportamiento 100% intacto", async () => {
    const { deps, sesiones, envios } = armarDeps();
    await iniciarNuevaSesionAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", wamid: "w1" }, deps);
    assert.equal(sesiones.filas.length, 1, "cualquier tenant que no sea AMORE sigue creando la sesión directo, como siempre");
    assert.match(envios.enviados.at(-1)!.mensaje, /¿Qué tipo de servicio te gustaría agendar\?/);
  });
});

// ---------------------------------------------------------------------------
// FASE 3 (autorizado, multi-servicio) -- 2 servicios reales del mismo
// catálogo de fixture (Dipping + Press On, ambos Uñas, ambos elegibles para
// Mary/Cristal/Nata/Jessica): "1 y 2" dentro del submenú de Uñas. Duración
// real combinada 120+120=240min, precio real combinado 60.000+80.000=140.000
// -- prueba la SUMA real, sin importar que en este catálogo de fixture
// coincidan las duraciones individuales.
// ---------------------------------------------------------------------------
describe("FASE 3 (autorizado, multi-servicio) -- selección y disponibilidad combinada vía router real", () => {
  /** Intersección real usando el MISMO fixture de elegibilidad de arriba (ESPECIALISTAS_POR_SERVICIO) -- nunca una segunda fuente de verdad. */
  async function resolverEspecialistasMultiFixture(_s: unknown, _idTenant: string, servicioIds: string[]) {
    const conjuntos = servicioIds.map((id) => new Set((ESPECIALISTAS_POR_SERVICIO[id] ?? []).map((e) => e.especialistaId)));
    const primero = ESPECIALISTAS_POR_SERVICIO[servicioIds[0]!] ?? [];
    return { especialistas: primero.filter((e) => conjuntos.every((set) => set.has(e.especialistaId))) };
  }

  function crearFakeMultiDisponibilidad() {
    const llamadasDias: Array<{ duracionTotalMin: number; especialistaId: number }> = [];
    const llamadasHoras: Array<{ duracionTotalMin: number; fechaIso: string }> = [];
    return {
      llamadasDias,
      llamadasHoras,
      calcularDiasMultiServicio: async (_s: unknown, params: { especialista: { id: number }; duracionTotalMin: number }) => {
        llamadasDias.push({ duracionTotalMin: params.duracionTotalMin, especialistaId: params.especialista.id });
        return { opciones: construirOpcionesFecha(DIAS_POR_PROFESIONAL_FIXTURE[params.especialista.id] ?? []), hayMasFechas: false };
      },
      calcularHorariosFechaMultiServicio: async (_s: unknown, params: { fechaIso: string; duracionTotalMin: number }) => {
        llamadasHoras.push({ duracionTotalMin: params.duracionTotalMin, fechaIso: params.fechaIso });
        const horarios = HORAS_POR_FECHA_FIXTURE[params.fechaIso] ?? [];
        if (horarios.length === 0) return { ok: false as const, motivo: "sin_horarios_ese_dia" as const };
        return { ok: true as const, horarios };
      },
    };
  }

  function armarDepsMulti(overrides: Partial<AgendaV2RouterDeps> = {}) {
    const multi = crearFakeMultiDisponibilidad();
    const base = armarDeps({
      resolverEspecialistasMultiServicio: resolverEspecialistasMultiFixture,
      calcularDiasMultiServicio: multi.calcularDiasMultiServicio,
      calcularHorariosFechaMultiServicio: multi.calcularHorariosFechaMultiServicio,
      especialistaPorId: especialistaPorIdFixture,
      ...overrides,
    });
    return { ...base, multi };
  }

  async function llegarAMenuProfesionalMulti(deps: AgendaV2RouterDeps, telefono = "573148127388") {
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "quiero una cita", wamid: "m1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: NUMERO_CATEGORIA_UNAS, wamid: "m2" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1 y 2", wamid: "m3" }, deps); // Dipping + Press On
  }
  async function llegarAMenuFechaMulti(deps: AgendaV2RouterDeps, telefono = "573148127388") {
    await llegarAMenuProfesionalMulti(deps, telefono);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "m4" }, deps); // Mary
  }
  async function llegarAMenuHoraMulti(deps: AgendaV2RouterDeps, telefono = "573148127388") {
    await llegarAMenuFechaMulti(deps, telefono);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "m5" }, deps); // 2026-09-08
  }
  async function llegarAConfirmacionMulti(deps: AgendaV2RouterDeps, telefono = "573148127388") {
    await llegarAMenuHoraMulti(deps, telefono);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono, texto: "1", wamid: "m6" }, deps); // 09:00
  }

  it("'1 y 2' avanza a S2_PROFESIONAL con la intersección real -- servicioId SIEMPRE el primero, serviciosIds con los 2", async () => {
    const { deps, sesiones } = armarDepsMulti();
    await llegarAMenuProfesionalMulti(deps);
    assert.equal(sesiones.filas[0]!.step, "S2_PROFESIONAL");
    assert.equal(sesiones.filas[0]!.servicioId, "s-dipping-real", "compatibilidad histórica -- SIEMPRE el primero elegido");
    assert.deepEqual(sesiones.filas[0]!.serviciosIds, ["s-dipping-real", "s-presson-real"]);
  });

  it("Test 10 (obligatorio) -- al elegir profesional, la disponibilidad se calcula con la duración TOTAL real (120+120=240min), nunca la de un solo servicio", async () => {
    const { deps, sesiones, multi } = armarDepsMulti();
    await llegarAMenuFechaMulti(deps);
    assert.equal(sesiones.filas[0]!.step, "S3_DIA");
    assert.equal(multi.llamadasDias.length, 1);
    assert.equal(multi.llamadasDias[0]!.duracionTotalMin, 240, "120 (Dipping) + 120 (Press On) = 240 -- nunca solo la del primero");
    assert.equal(multi.llamadasDias[0]!.especialistaId, 1262);
  });

  it("al elegir fecha, los horarios también se calculan con la duración TOTAL real", async () => {
    const { deps, multi } = armarDepsMulti();
    await llegarAMenuHoraMulti(deps);
    assert.equal(multi.llamadasHoras.length, 1);
    assert.equal(multi.llamadasHoras[0]!.duracionTotalMin, 240);
    assert.equal(multi.llamadasHoras[0]!.fechaIso, "2026-09-08");
  });

  it("el resumen de confirmación lista AMBOS servicios, con duración y valor TOTAL reales (60.000+80.000=140.000)", async () => {
    const { deps, envios } = armarDepsMulti();
    await llegarAConfirmacionMulti(deps);
    const resumen = envios.enviados.at(-1)!.mensaje;
    assert.match(resumen, /Servicios:/);
    assert.match(resumen, /Dipping — \$60\.000/);
    assert.match(resumen, /Press On — \$80\.000/);
    assert.match(resumen, /Profesional: Mary/);
    assert.match(resumen, /Duración: 4 h/); // 240min
    assert.match(resumen, /Valor total: \$140\.000/);
  });

  it("Test 14 (obligatorio, vía router) -- confirmar crea la reserva real pasando serviciosIdsAdicionales, y el mensaje de éxito lista ambos servicios con el valor total", async () => {
    const RESULTADO_EXITO_MULTI: ResultadoCrearCitaNylas = {
      ok: true,
      cita: { ...CITA_FAKE_BASE, servicio: "Dipping", servicio_id: "s-dipping-real" },
      nylasEventId: "evt-multi-1",
      especialista: { id: 1262, nombre: "Mary" },
      servicio: { id: "s-dipping-real", nombre: "Dipping + Press On", duracionMin: 240 },
    };
    const fake = crearFakeCrearCitaConNylas(RESULTADO_EXITO_MULTI);
    const { deps, sesiones, envios } = armarDepsMulti({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: fake.crearCitaConNylas });
    await llegarAConfirmacionMulti(deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "m7" }, deps);
    assert.equal(fake.llamadas.length, 1);
    assert.equal(fake.llamadas[0]!.params.servicioId, "s-dipping-real");
    assert.deepEqual((fake.llamadas[0]!.params as unknown as { serviciosIdsAdicionales?: string[] }).serviciosIdsAdicionales, ["s-presson-real"]);
    assert.equal(sesiones.filas[0]!.activo, false);
    const mensaje = envios.enviados.at(-1)!.mensaje;
    assert.match(mensaje, /¡Listo! 💗 Tu cita quedó agendada/);
    assert.match(mensaje, /Dipping/);
    assert.match(mensaje, /Press On/);
    assert.match(mensaje, /Valor total: \$140\.000/);
  });

  it("regresión -- una selección de UN solo servicio ('1') NUNCA pasa serviciosIdsAdicionales, comportamiento 100% idéntico al de antes de esta fase", async () => {
    const fake = crearFakeCrearCitaConNylas(RESULTADO_EXITO_DIPPING_MARY);
    const { deps, sesiones } = armarDeps({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: fake.crearCitaConNylas });
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero una cita", wamid: "u1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: NUMERO_CATEGORIA_UNAS, wamid: "u2" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "u3" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "u4" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "u5" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "u6" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "u7" }, deps); // confirmar
    assert.equal(sesiones.filas[0]!.serviciosIds, null);
    assert.equal(fake.llamadas[0]!.params.servicioId, "s-dipping-real");
    assert.equal((fake.llamadas[0]!.params as unknown as { serviciosIdsAdicionales?: string[] }).serviciosIdsAdicionales, undefined);
  });

  it("idempotencia -- mismo wamid duplicado al confirmar NUNCA crea la reserva multi-servicio dos veces", async () => {
    const fake = crearFakeCrearCitaConNylas(RESULTADO_EXITO_DIPPING_MARY);
    const { deps, envios } = armarDepsMulti({ ...NYLAS_DEPS_FAKE_OVERRIDES, crearCitaConNylas: fake.crearCitaConNylas });
    await llegarAConfirmacionMulti(deps);
    const totalAntes = envios.enviados.length;
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "m7" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "m7" }, deps); // mismo wamid
    assert.equal(fake.llamadas.length, 1);
    assert.equal(envios.enviados.length, totalAntes + 1);
  });

  it("cancelación (opción 4) en S5_CONFIRMAR multi-servicio: cierra la sesión, nunca llega al camino de crear la reserva", async () => {
    const { deps, sesiones } = armarDepsMulti();
    await llegarAConfirmacionMulti(deps);
    const r = await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "4", wamid: "m7" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(sesiones.filas[0]!.activo, false);
  });

  it("Test 16 (obligatorio, vía router) -- reprogramar una cita CON 2 servicios en el puente conserva AMBOS, calcula la disponibilidad con la duración TOTAL", async () => {
    const citaMultiExistente: CitaEspecialista = { ...CITA_CEJAS_CERA, servicio_id: "s-dipping-real" };
    const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [citaMultiExistente] });
    const { deps, sesiones, multi } = armarDepsMulti({
      consultarCitasActivas: fakeCitas.consultarCitasActivas,
      obtenerServiciosDeCita: async (_s: unknown, citaId: number) => (citaId === citaMultiExistente.id ? ["s-dipping-real", "s-presson-real"] : []),
      ...NYLAS_DEPS_FAKE_OVERRIDES,
    });
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero cambiar mi cita", wamid: "rp1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "rp2" }, deps); // sí, reprogramar
    assert.deepEqual(sesiones.filas[0]!.serviciosIds, ["s-dipping-real", "s-presson-real"], "conserva AMBOS servicios de la cita original, nunca solo el primero");
    assert.equal(sesiones.filas[0]!.step, "S3_DIA");
    assert.equal(multi.llamadasDias[0]!.duracionTotalMin, 240, "revalida con la duración TOTAL real de los 2 servicios originales");
  });

  it("regresión -- reprogramar una cita de UN solo servicio (sin filas en el puente) nunca fija serviciosIds, comportamiento 100% idéntico al de antes de esta fase", async () => {
    const fakeCitas = crearFakeConsultarCitasActivas({ [PN_AMORE]: [CITA_CEJAS_CERA] });
    const { deps, sesiones } = armarDepsMulti({
      consultarCitasActivas: fakeCitas.consultarCitasActivas,
      obtenerServiciosDeCita: async () => [],
      ...NYLAS_DEPS_FAKE_OVERRIDES,
    });
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "quiero cambiar mi cita", wamid: "rp1" }, deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "rp2" }, deps);
    assert.equal(sesiones.filas[0]!.serviciosIds, null);
  });

  it("CORRECCIÓN (autorizada, 'Ver más fechas') -- Test 16 obligatorio: conserva AMBOS servicios y el profesional, calcula con la duración TOTAL real", async () => {
    const llamadasMulti: Array<{ continuarDesdeFechaIso?: string; duracionTotalMin: number }> = [];
    const bloques = [["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"], ["2026-09-14"]];
    let indice = 0;
    const calcularDiasMultiConMas = async (_s: unknown, params: { continuarDesdeFechaIso?: string; duracionTotalMin: number }) => {
      llamadasMulti.push({ continuarDesdeFechaIso: params.continuarDesdeFechaIso, duracionTotalMin: params.duracionTotalMin });
      const fechas = bloques[indice] ?? [];
      indice++;
      return { opciones: construirOpcionesFecha(fechas), hayMasFechas: indice < bloques.length };
    };
    const { deps, sesiones } = armarDepsMulti({ calcularDiasMultiServicio: calcularDiasMultiConMas });
    await llegarAMenuProfesionalMulti(deps);
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "1", wamid: "mm4" }, deps); // Mary -> bloque 1
    await procesarMensajeConAgendaV2({ supabase: FAKE_SUPABASE, idTenant: "amore-test", telefono: "573148127388", texto: "5", wamid: "mm5" }, deps); // Ver más fechas

    assert.deepEqual(sesiones.filas[0]!.serviciosIds, ["s-dipping-real", "s-presson-real"], "conserva AMBOS servicios al pedir más fechas");
    assert.equal(sesiones.filas[0]!.profesionalId, 1262, "conserva el MISMO profesional, nunca lo cambia");
    assert.equal(sesiones.filas[0]!.step, "S3_DIA");
    assert.deepEqual(sesiones.filas[0]!.opcionesMostradas, { opciones: construirOpcionesFecha(["2026-09-14"]), numeroVerMasFechas: null });
    assert.equal(llamadasMulti[1]!.duracionTotalMin, 240, "la segunda consulta también usa la duración TOTAL real, nunca la de un solo servicio");
    assert.equal(llamadasMulti[1]!.continuarDesdeFechaIso, "2026-09-11");
  });
});
