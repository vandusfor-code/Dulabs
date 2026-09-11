/**
 * AMORE (autorizado, Fase 9) -- pruebas del puente bienvenida/Gemini ->
 * Agenda V2. Todas las dependencias reales (candado, estado de entrada,
 * envío de WhatsApp, Gemini, arranque de Agenda V2) están inyectadas con
 * fakes en memoria -- ningún test toca Supabase/Gemini/WhatsApp reales, y
 * ninguno crea una reserva real (iniciarAgendaV2 es un fake que solo
 * registra la llamada, nunca ejecuta lib/agenda-v2/router.ts de verdad).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  procesarEntradaAmore,
  interceptarAtencionHumanaAmore,
  interceptarRegistroClienteAmore,
  interceptarCompraProductoAmore,
  type AmoreEntradaDeps,
  type InterceptarAtencionHumanaDeps,
  type InterceptarRegistroClienteDeps,
  type InterceptarCompraProductoDeps,
} from "@/lib/amore-entrada-router";
import type { ProductoInventario } from "@/lib/amore-inventario";
import type { EntradaAmore, ModoEntradaAmore } from "@/lib/amore-entrada-sesiones";
import type { ResultadoClasificacionGemini } from "@/lib/amore-entrada-gemini";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";

const FAKE_SUPABASE = {} as SupabaseClient;
const OTRO_TENANT = "otro-tenant-cualquiera";
const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function crearFakeEntradas() {
  const filas: EntradaAmore[] = [];
  // Expiración de atención humana (autorizado) -- se guarda APARTE de
  // EntradaAmore a propósito, mismo criterio que la producción real
  // (lib/amore-entrada-sesiones.ts): una lectura aislada
  // (obtenerAtencionHumanaDesde), nunca parte del objeto/select genérico.
  const atencionHumanaDesdePorId = new Map<number, string | null>();
  let siguienteId = 1;
  return {
    filas,
    atencionHumanaDesdePorId,
    buscarEntrada: async (_s: unknown, tenantId: string, telefono: string) => filas.find((f) => f.tenantId === tenantId && f.telefonoCliente === telefono) ?? null,
    obtenerAtencionHumanaDesde: async (_s: unknown, id: number) => atencionHumanaDesdePorId.get(id) ?? null,
    crearEntrada: async (
      _s: unknown,
      params: {
        tenantId: string;
        telefonoCliente: string;
        wamid: string;
        modo: ModoEntradaAmore;
        notificadoAJessica?: boolean;
        productoInteresNombre?: string | null;
        atencionHumanaDesde?: string | null;
      },
    ) => {
      const nueva: EntradaAmore = {
        id: siguienteId++,
        tenantId: params.tenantId,
        telefonoCliente: params.telefonoCliente,
        modo: params.modo,
        ultimoWamidProcesado: params.wamid,
        notificadoAJessica: params.notificadoAJessica ?? false,
        productoInteresNombre: params.productoInteresNombre ?? null,
      };
      filas.push(nueva);
      if (params.atencionHumanaDesde !== undefined) atencionHumanaDesdePorId.set(nueva.id, params.atencionHumanaDesde);
      return nueva;
    },
    actualizarEntrada: async (
      _s: unknown,
      id: number,
      cambios: {
        modo?: ModoEntradaAmore;
        ultimoWamidProcesado?: string;
        notificadoAJessica?: boolean;
        productoInteresNombre?: string | null;
        atencionHumanaDesde?: string | null;
      },
    ) => {
      const f = filas.find((x) => x.id === id);
      if (f) Object.assign(f, cambios);
      if (cambios.atencionHumanaDesde !== undefined) atencionHumanaDesdePorId.set(id, cambios.atencionHumanaDesde);
    },
  };
}

function crearFakeNombreConocido(nombre: string | null = null) {
  const llamadas: string[] = [];
  return {
    llamadas,
    buscarNombreConocido: async (_s: unknown, _phoneNumberId: string, telefono: string) => {
      llamadas.push(telefono);
      return nombre;
    },
  };
}

function crearFakeEnvios() {
  const enviados: Array<{ telefono: string; mensaje: string }> = [];
  return {
    enviados,
    enviarMensajeWhatsApp: async (params: { tenantId: string; telefono: string; mensaje: string }) => {
      enviados.push({ telefono: params.telefono, mensaje: params.mensaje });
      return { ok: true, data: { ok: true } } as const;
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

function crearFakeIniciarAgendaV2() {
  const llamadas: Array<{ idTenant: string; telefono: string; wamid: string }> = [];
  return {
    llamadas,
    iniciarAgendaV2: async (params: { supabase: SupabaseClient; idTenant: string; telefono: string; wamid: string }) => {
      llamadas.push({ idTenant: params.idTenant, telefono: params.telefono, wamid: params.wamid });
    },
  };
}

// NUEVA FASE (autorizado, reconocimiento semántico/contextual de
// CANCELAR_CITA/REPROGRAMAR_CITA) -- mismo criterio EXACTO que
// crearFakeIniciarAgendaV2: un fake que SOLO registra la llamada, nunca
// ejecuta lib/agenda-v2/router.ts de verdad (esa lógica ya tiene su propia
// suite de tests real, ver lib/agenda-v2/router.test.ts).
function crearFakeIniciarGestionCitasAgendaV2() {
  const llamadas: Array<{ idTenant: string; telefono: string; wamid: string; accion: "consultar" | "cancelar" | "reprogramar" }> = [];
  return {
    llamadas,
    iniciarGestionCitasAgendaV2: async (params: { supabase: SupabaseClient; idTenant: string; telefono: string; wamid: string; accion: "consultar" | "cancelar" | "reprogramar" }) => {
      llamadas.push({ idTenant: params.idTenant, telefono: params.telefono, wamid: params.wamid, accion: params.accion });
    },
  };
}

// NUEVA FASE (autorizado, extracción de datos para RESERVAR_CITA) -- los
// tests existentes de este archivo nunca ejercitan los 3 campos nuevos
// (detectedProfessionalMention/detectedDateMention/detectedTimeMention), así
// que el helper los completa con null por defecto -- ningún caso de prueba
// existente necesita tocarse.
type ResultadoClasificacionGeminiParcial = Omit<ResultadoClasificacionGemini, "detectedProfessionalMention" | "detectedDateMention" | "detectedTimeMention"> &
  Partial<Pick<ResultadoClasificacionGemini, "detectedProfessionalMention" | "detectedDateMention" | "detectedTimeMention">>;

function crearFakeClasificador(resultado: ResultadoClasificacionGeminiParcial | ((mensaje: string) => ResultadoClasificacionGeminiParcial)) {
  const llamadas: string[] = [];
  function completar(r: ResultadoClasificacionGeminiParcial): ResultadoClasificacionGemini {
    return { detectedProfessionalMention: null, detectedDateMention: null, detectedTimeMention: null, ...r };
  }
  return {
    llamadas,
    clasificarConGemini: async (params: { mensaje: string }) => {
      llamadas.push(params.mensaje);
      return completar(typeof resultado === "function" ? resultado(params.mensaje) : resultado);
    },
  };
}

function armarDeps(overrides: Partial<AmoreEntradaDeps> = {}) {
  const entradas = crearFakeEntradas();
  const envios = crearFakeEnvios();
  const candado = crearFakeCandado();
  const iniciarAgenda = crearFakeIniciarAgendaV2();
  const iniciarGestionCitas = crearFakeIniciarGestionCitasAgendaV2();
  const nombreConocido = crearFakeNombreConocido();
  const deps: AmoreEntradaDeps = {
    adquirirCandadoChat: candado.adquirir,
    liberarCandadoChat: candado.liberar,
    buscarEntrada: entradas.buscarEntrada,
    crearEntrada: entradas.crearEntrada,
    actualizarEntrada: entradas.actualizarEntrada,
    enviarMensajeWhatsApp: envios.enviarMensajeWhatsApp,
    buscarNombreConocido: nombreConocido.buscarNombreConocido,
    iniciarAgendaV2: iniciarAgenda.iniciarAgendaV2,
    iniciarGestionCitasAgendaV2: iniciarGestionCitas.iniciarGestionCitasAgendaV2,
    ...overrides,
  };
  return { deps, entradas, envios, candado, iniciarAgenda, iniciarGestionCitas, nombreConocido };
}

function crearFakeClientesConocidos() {
  const clientes = new Map<string, { nombre: string; cumpleDia: number | null; cumpleMes: number | null }>();
  const clave = (phoneNumberId: string, telefono: string) => `${phoneNumberId}|${telefono}`;
  return {
    clientes,
    buscarClienteConocido: async (_s: unknown, phoneNumberId: string, telefono: string) => clientes.get(clave(phoneNumberId, telefono)) ?? null,
    recordarNombreCliente: async (
      _s: unknown,
      params: { phoneNumberId: string; telefonoCliente: string; nombre: string; cumpleDia?: number | null; cumpleMes?: number | null },
    ) => {
      const k = clave(params.phoneNumberId, params.telefonoCliente);
      const actual = clientes.get(k) ?? { nombre: params.nombre, cumpleDia: null, cumpleMes: null };
      clientes.set(k, {
        nombre: params.nombre,
        cumpleDia: params.cumpleDia !== undefined && params.cumpleDia !== null ? params.cumpleDia : actual.cumpleDia,
        cumpleMes: params.cumpleMes !== undefined && params.cumpleMes !== null ? params.cumpleMes : actual.cumpleMes,
      });
    },
  };
}

function armarDepsRegistro(
  overrides: Partial<InterceptarRegistroClienteDeps> = {},
  entradasCompartidas?: ReturnType<typeof crearFakeEntradas>,
  clientesCompartidos?: ReturnType<typeof crearFakeClientesConocidos>,
) {
  const entradas = entradasCompartidas ?? crearFakeEntradas();
  const clientes = clientesCompartidos ?? crearFakeClientesConocidos();
  const envios = crearFakeEnvios();
  const candado = crearFakeCandado();
  const iniciarAgenda = crearFakeIniciarAgendaV2();
  const deps: InterceptarRegistroClienteDeps = {
    adquirirCandadoChat: candado.adquirir,
    liberarCandadoChat: candado.liberar,
    buscarEntrada: entradas.buscarEntrada,
    actualizarEntrada: entradas.actualizarEntrada,
    enviarMensajeWhatsApp: envios.enviarMensajeWhatsApp,
    recordarNombreCliente: clientes.recordarNombreCliente,
    buscarClienteConocido: clientes.buscarClienteConocido,
    iniciarAgendaV2: iniciarAgenda.iniciarAgendaV2,
    ...overrides,
  };
  return { deps, entradas, clientes, envios, candado, iniciarAgenda };
}

function armarDepsGate(overrides: Partial<InterceptarAtencionHumanaDeps> = {}, entradasCompartidas?: ReturnType<typeof crearFakeEntradas>) {
  const entradas = entradasCompartidas ?? crearFakeEntradas();
  const envios = crearFakeEnvios();
  const candado = crearFakeCandado();
  const nombreConocido = crearFakeNombreConocido();
  const deps: InterceptarAtencionHumanaDeps = {
    adquirirCandadoChat: candado.adquirir,
    liberarCandadoChat: candado.liberar,
    buscarEntrada: entradas.buscarEntrada,
    crearEntrada: entradas.crearEntrada,
    actualizarEntrada: entradas.actualizarEntrada,
    enviarMensajeWhatsApp: envios.enviarMensajeWhatsApp,
    buscarNombreConocido: nombreConocido.buscarNombreConocido,
    obtenerAtencionHumanaDesde: entradas.obtenerAtencionHumanaDesde,
    ...overrides,
  };
  return { deps, entradas, envios, candado, nombreConocido };
}

const TELEFONO = "573148127388";

describe("Test 1 -- primer contacto: DOS mensajes WhatsApp separados, crea el estado en modo 'inicio'", () => {
  it("envía bienvenida + menú como dos mensajes distintos, en ese orden", async () => {
    const { deps, entradas, envios } = armarDeps();
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "Hola", wamid: "w1" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(envios.enviados.length, 2, "deben ser DOS mensajes separados, nunca uno solo concatenado");
    assert.match(envios.enviados[0]!.mensaje, /Bienvenido\/a a AMORE/);
    assert.match(envios.enviados[1]!.mensaje, /1\. Quiero una cita/);
    assert.match(envios.enviados[1]!.mensaje, /2\. Quiero hacer una consulta/);
    assert.equal(entradas.filas.length, 1);
    assert.equal(entradas.filas[0]!.modo, "inicio");
  });
});

describe("Test 2 -- Opción 1: entrega inmediata a Agenda V2, NUNCA pasa por Gemini", () => {
  it("'1' inicia Agenda V2 directamente, sin clasificar ni conversar", async () => {
    const fakeClasificador = crearFakeClasificador({ intent: "CONSULTA", replyText: "no debía llamarse", detectedServiceMention: null });
    const { deps, entradas, iniciarAgenda } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "1", wamid: "w2" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(iniciarAgenda.llamadas.length, 1);
    assert.equal(iniciarAgenda.llamadas[0]!.telefono, TELEFONO);
    assert.equal(fakeClasificador.llamadas.length, 0, "Gemini NUNCA debe llamarse en la Opción 1");
    assert.equal(entradas.filas[0]!.modo, "gemini", "queda en modo 'gemini' para que el siguiente mensaje ya no repita la bienvenida");
  });
});

describe("Fase 3b (autorizado) -- interés general en productos: responde con el link de la tienda", () => {
  it("desde modo 'inicio' (antes de elegir 1/2/3), responde con el link y NO avanza de modo", async () => {
    const { deps, entradas, envios } = armarDeps();
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "¿tienen productos de belleza?", wamid: "w2" }, deps);
    assert.equal(r.manejado, true);
    assert.match(envios.enviados.at(-1)!.mensaje, /https:\/\/www\.dulabs\.co\/amore\/tienda/);
    assert.equal(entradas.filas[0]!.modo, "inicio", "no fuerza ningún flujo, se queda disponible para elegir 1/2/3 después");
  });

  it("desde modo 'gemini', responde con el link SIN llamar a Gemini ni a Agenda V2 (fast-track determinista)", async () => {
    const fakeClasificador = crearFakeClasificador({ intent: "CONSULTA", replyText: "no debía llamarse", detectedServiceMention: null });
    const { deps, entradas, envios, iniciarAgenda } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "quiero ver los productos que venden", wamid: "w3" }, deps);
    assert.equal(r.manejado, true);
    assert.match(envios.enviados.at(-1)!.mensaje, /https:\/\/www\.dulabs\.co\/amore\/tienda/);
    assert.equal(fakeClasificador.llamadas.length, 0, "nunca debe llamar a Gemini para esto");
    assert.equal(iniciarAgenda.llamadas.length, 0);
    assert.equal(entradas.filas[0]!.modo, "gemini");
  });

  it("variantes reales reconocidas: 'venden productos', 'catalogo de productos', 'productos amore'", async () => {
    for (const frase of ["venden productos", "catalogo de productos", "productos amore"]) {
      const { deps, envios } = armarDeps();
      await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
      const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: frase, wamid: "w2" }, deps);
      assert.equal(r.manejado, true, `frase: "${frase}"`);
      assert.match(envios.enviados.at(-1)!.mensaje, /amore\/tienda/, `frase: "${frase}"`);
    }
  });

  it("NUNCA inicia el flujo de compra (modo sigue en gemini, nunca compra_producto_opcion)", async () => {
    const { deps, entradas } = armarDeps();
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "tienen productos?", wamid: "w3" }, deps);
    assert.equal(entradas.filas[0]!.modo, "gemini");
  });
});

describe("Test 3/4 -- Opción 2: entra a Gemini y sigue conversando en consultas posteriores", () => {
  it("'2' envía el saludo de Gemini y pasa a modo 'gemini'", async () => {
    const { deps, entradas, envios } = armarDeps();
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(envios.enviados.at(-1)!.mensaje, "Claro 💗 Cuéntame, ¿qué te gustaría saber?");
    assert.equal(entradas.filas[0]!.modo, "gemini");
  });

  it("Test 4 -- una consulta real (CONSULTA) responde con el reply_text de Gemini y sigue en modo 'gemini'", async () => {
    const fakeClasificador = crearFakeClasificador({ intent: "CONSULTA", replyText: "El sombreado dura aproximadamente 2 horas.", detectedServiceMention: "sombreado" });
    const { deps, entradas, envios, iniciarAgenda } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "¿Cuánto dura el sombreado?", wamid: "w3" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(envios.enviados.at(-1)!.mensaje, "El sombreado dura aproximadamente 2 horas.");
    assert.equal(entradas.filas[0]!.modo, "gemini");
    assert.equal(iniciarAgenda.llamadas.length, 0, "una CONSULTA nunca debe entregar el control a Agenda V2");
  });
});

describe("Tests 5-8 -- fast track determinista: frases inequívocas van DIRECTO a Agenda V2, sin llamar a Gemini", () => {
  for (const [n, frase] of [
    [5, "quiero una cita"],
    [6, "quiero agendar"],
    [7, "quiero reservar"],
    [8, "me interesa, quiero agendarlo"],
  ] as const) {
    it(`Test ${n} -- "${frase}" -> Agenda V2 directo`, async () => {
      const fakeClasificador = crearFakeClasificador({ intent: "CONSULTA", replyText: "no debía llamarse", detectedServiceMention: null });
      const { deps, envios, iniciarAgenda } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
      await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
      await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
      const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: frase, wamid: "w3" }, deps);
      assert.equal(r.manejado, true);
      assert.equal(iniciarAgenda.llamadas.length, 1);
      assert.equal(fakeClasificador.llamadas.length, 0, "el fast track determinista debe evitar la latencia de llamar a Gemini");
      assert.equal(envios.enviados.at(-1)!.mensaje, "Perfecto 💗 Vamos a agendar tu cita.");
    });
  }
});

describe("Tests 9-11 -- estas preguntas sobre citas siguen siendo CONSULTA (nunca activan el fast track por la palabra 'cita')", () => {
  for (const [n, frase] of [
    [9, "¿Cuánto cuesta una cita?"],
    [10, "¿Qué horarios tienen para citas?"],
    [11, "¿Atienden citas los sábados?"],
  ] as const) {
    it(`Test ${n} -- "${frase}" -> CONSULTA (vía Gemini)`, async () => {
      const fakeClasificador = crearFakeClasificador({ intent: "CONSULTA", replyText: "Respuesta real de Gemini para: " + frase, detectedServiceMention: null });
      const { deps, envios, iniciarAgenda } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
      await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
      await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
      const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: frase, wamid: "w3" }, deps);
      assert.equal(r.manejado, true);
      assert.equal(fakeClasificador.llamadas.length, 1, "caso no obvio -- SÍ debe llamar a Gemini para decidir");
      assert.equal(iniciarAgenda.llamadas.length, 0);
      assert.match(envios.enviados.at(-1)!.mensaje, /Respuesta real de Gemini/);
    });
  }
});

describe("Test 12 -- Gemini pregunta '¿Quieres agendar?' y el cliente responde 'Sí' -> Agenda V2", () => {
  it("'Sí' no calza con el fast track determinista, pero Gemini lo clasifica como TRIGGER_AGENDA con el historial", async () => {
    const fakeClasificador = crearFakeClasificador((mensaje) => (mensaje.toLowerCase() === "sí" ? { intent: "TRIGGER_AGENDA", replyText: "ignorado", detectedServiceMention: null } : { intent: "CONSULTA", replyText: "¿Quieres agendar?", detectedServiceMention: null }));
    const { deps, envios, iniciarAgenda } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "Me encantó el sombreado", wamid: "w3" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "Sí", wamid: "w4" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(iniciarAgenda.llamadas.length, 1);
    assert.equal(envios.enviados.at(-1)!.mensaje, "Perfecto 💗 Vamos a agendar tu cita.", "el reply_text de Gemini se IGNORA cuando intent=TRIGGER_AGENDA");
  });
});

describe("Test 13 -- caso ambiguo: Gemini continúa/aclara, nunca fuerza Agenda V2 por error", () => {
  it("mensaje ambiguo clasificado como CONSULTA con una pregunta aclaratoria -- sigue conversando", async () => {
    const fakeClasificador = crearFakeClasificador({ intent: "CONSULTA", replyText: "¿Podrías contarme un poco más sobre lo que buscas?", detectedServiceMention: null });
    const { deps, envios, iniciarAgenda } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "no sé, algo lindo", wamid: "w3" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(iniciarAgenda.llamadas.length, 0);
    assert.match(envios.enviados.at(-1)!.mensaje, /Podrías contarme un poco más/);
  });
});

describe("Tests 14/15 -- Gemini NUNCA crea/modifica una reserva ni llama crearCitaConNylas (estructural)", () => {
  it("Test 14 -- el puente solo INICIA Agenda V2 (menú de categorías), nunca ejecuta una creación real de cita él mismo", async () => {
    const { deps, iniciarAgenda } = armarDeps();
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "quiero una cita", wamid: "w3" }, deps);
    assert.equal(iniciarAgenda.llamadas.length, 1);
    // La única acción real posible del puente es "iniciar Agenda V2" (el
    // menú de categorías, vía el fake iniciarAgendaV2) -- nunca una función
    // de creación/reserva real.
  });

  it("Test 15 -- lib/amore-entrada-gemini.ts y lib/amore-entrada-router.ts JAMÁS importan crearCitaConNylas/actualizarCitaConNylas ni el cliente de ESCRITURA de Nylas", () => {
    const fuenteGemini = readFileSync(new URL("./amore-entrada-gemini.ts", import.meta.url), "utf8");
    const fuenteRouter = readFileSync(new URL("./amore-entrada-router.ts", import.meta.url), "utf8");
    // Se revisan las declaraciones `import` en sí (nunca se puede LLAMAR algo
    // que no está importado en un módulo ES) -- nunca menciones sueltas en
    // comentarios explicando la restricción (este mismo router.ts documenta
    // en prosa por qué nunca debe hacerlo, lo que produciría falsos
    // positivos con una búsqueda de texto libre).
    for (const fuente of [fuenteGemini, fuenteRouter]) {
      assert.doesNotMatch(fuente, /import[^;]*\bcrearCitaConNylas\b/, "nunca debe importar crearCitaConNylas");
      assert.doesNotMatch(fuente, /import[^;]*\bactualizarCitaConNylas\b/, "nunca debe importar actualizarCitaConNylas");
      assert.doesNotMatch(fuente, /import[^;]*\bNylasEventsWriteClient\b/, "nunca debe importar el tipo del cliente de ESCRITURA de Nylas");
      assert.doesNotMatch(fuente, /import[^;]*\bcreateNylasEventsWriteClient\b/, "nunca debe importar el creador del cliente de ESCRITURA de Nylas");
    }
  });
});

describe("Test 16 -- wamid duplicado: NUNCA duplica la transición (ni reenvía, ni reinicia Agenda V2 dos veces)", () => {
  it("mismo wamid repetido en modo 'inicio' (opción 1)", async () => {
    const { deps, iniciarAgenda, envios } = armarDeps();
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "1", wamid: "w2" }, deps);
    const totalEnvios = envios.enviados.length;
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "1", wamid: "w2" }, deps); // mismo wamid exacto
    assert.equal(r.manejado, true);
    assert.equal(iniciarAgenda.llamadas.length, 1, "Agenda V2 NUNCA se inicia una segunda vez para el mismo wamid");
    assert.equal(envios.enviados.length, totalEnvios, "nunca se reenvía nada");
  });

  it("mismo wamid repetido del PRIMER contacto -- nunca envía la bienvenida dos veces ni crea dos filas", async () => {
    const { deps, entradas, envios } = armarDeps();
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps); // mismo wamid exacto
    assert.equal(entradas.filas.length, 1);
    assert.equal(envios.enviados.length, 2, "solo los 2 mensajes de la primera vez, nunca 4");
  });

  it("mismo wamid repetido en modo 'gemini' tras un TRIGGER_AGENDA -- nunca reinicia Agenda V2 dos veces", async () => {
    const { deps, iniciarAgenda } = armarDeps();
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "quiero agendar", wamid: "w3" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "quiero agendar", wamid: "w3" }, deps); // mismo wamid exacto
    assert.equal(iniciarAgenda.llamadas.length, 1);
  });
});

describe("Test 17 -- otro tenant: comportamiento anterior intacto, CERO cambios", () => {
  it("devuelve manejado:false de inmediato, sin candado, sin leer/crear estado, sin enviar nada", async () => {
    const { deps, candado, entradas, envios } = armarDeps();
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: OTRO_TENANT, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    assert.deepEqual(r, { manejado: false });
    assert.equal(candado.llamadas.length, 0, "nunca debe tocar el candado para otro tenant");
    assert.equal(entradas.filas.length, 0, "nunca debe crear estado para otro tenant");
    assert.equal(envios.enviados.length, 0, "nunca debe enviar nada para otro tenant");
  });

  it("incluso mensajes que activarían el fast track de agenda -- otro tenant sigue devolviendo manejado:false", async () => {
    const { deps, iniciarAgenda } = armarDeps();
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: OTRO_TENANT, telefono: TELEFONO, texto: "quiero agendar", wamid: "w1" }, deps);
    assert.deepEqual(r, { manejado: false });
    assert.equal(iniciarAgenda.llamadas.length, 0);
  });
});

describe("Defensivo -- si leer el estado falla (migración no aplicada todavía), cae al comportamiento normal", () => {
  it("nunca rompe el canal: manejado:false, y libera el candado igual", async () => {
    const { deps, candado } = armarDeps({
      buscarEntrada: async () => {
        throw new Error("relation \"dulabs_amore_entrada\" does not exist");
      },
    });
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    assert.deepEqual(r, { manejado: false });
    assert.ok(candado.llamadas.some((l) => l.startsWith("liberar:")), "el candado siempre se libera, incluso si falla la lectura");
  });
});

describe("Opción inválida en modo 'inicio' -- nunca fuzzy, reenvía el mismo menú", () => {
  it("un texto que no es exactamente '1', '2' o '3' no avanza", async () => {
    const { deps, entradas, envios } = armarDeps();
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "quiero una cita", wamid: "w2" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(entradas.filas[0]!.modo, "inicio", "nunca infiere la intención en el menú 1/2/3 -- solo número exacto");
    assert.match(envios.enviados.at(-1)!.mensaje, /No reconocí esa opción/);
  });
});

// --- Fase 1 (atención humana, autorizado) ----------------------------------

describe("Test D -- Opción '3' del menú inicial activa atención humana", () => {
  it("notifica a Jessica, responde al cliente con el mensaje exacto, y queda en modo 'atencion_humana'", async () => {
    const { deps, entradas, envios, nombreConocido } = armarDeps();
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "3", wamid: "w2" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(entradas.filas[0]!.modo, "atencion_humana");
    assert.equal(entradas.filas[0]!.notificadoAJessica, true);
    assert.equal(nombreConocido.llamadas.length, 1, "se consulta el nombre real conocido de la clienta para la notificación");

    const notificacionJessica = envios.enviados.find((e) => e.telefono === "573227298600");
    assert.ok(notificacionJessica, "debe existir una notificación real al número normalizado de Jessica");
    assert.match(notificacionJessica!.mensaje, /AMORE – Cliente requiere atención/);

    const mensajeCliente = envios.enviados.at(-1)!;
    assert.equal(mensajeCliente.telefono, TELEFONO);
    assert.equal(
      mensajeCliente.mensaje,
      "Entiendo que quieres hablar directamente con Jessica. 💗\nYa le notifiqué que deseas comunicarte con ella. En un momento te responderá directamente.",
    );
  });
});

describe("Test E -- idempotencia de notificación: solo la primera vez notifica a Jessica", () => {
  it("mensajes posteriores en modo atencion_humana nunca vuelven a notificar", async () => {
    const entradasCompartidas = crearFakeEntradas();
    const { deps, envios } = armarDeps({ crearEntrada: entradasCompartidas.crearEntrada, buscarEntrada: entradasCompartidas.buscarEntrada, actualizarEntrada: entradasCompartidas.actualizarEntrada });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "3", wamid: "w2" }, deps);
    const notificacionesTrasActivar = envios.enviados.filter((e) => e.telefono === "573227298600").length;
    assert.equal(notificacionesTrasActivar, 1);

    // Mensajes siguientes (vía el gate global, que es quien de verdad
    // intercepta una conversación ya en atencion_humana) -- "Hola"/"Jessica"/
    // "¿Me responde?" nunca deben generar una segunda notificación.
    const gate = armarDepsGate({}, entradasCompartidas);
    for (const [i, texto] of ["Hola", "Jessica", "¿Me responde?"].entries()) {
      const r = await interceptarAtencionHumanaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto, wamid: `w${3 + i}` }, gate.deps);
      assert.equal(r.manejado, true);
    }
    const totalNotificaciones = [...envios.enviados, ...gate.envios.enviados].filter((e) => e.telefono === "573227298600").length;
    assert.equal(totalNotificaciones, 1, "NUNCA debe generarse una segunda notificación mientras siga en atencion_humana");
  });
});

describe("Test F -- corte total en modo atencion_humana: ni Gemini ni Agenda V2 se invocan", () => {
  it("interceptarAtencionHumanaAmore silencia el mensaje sin llamar a ningún otro sistema", async () => {
    const entradasCompartidas = crearFakeEntradas();
    await entradasCompartidas.crearEntrada(FAKE_SUPABASE, { tenantId: AMORE_TENANT_ID, telefonoCliente: TELEFONO, wamid: "w0", modo: "atencion_humana", notificadoAJessica: true });
    const { deps, envios } = armarDepsGate({}, entradasCompartidas);

    const r = await interceptarAtencionHumanaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "quiero agendar", wamid: "w1" }, deps);
    assert.equal(r.manejado, true, "el gate se queda con el mensaje -- Agenda V2/Gemini/Flow Engine nunca deben ni siquiera evaluarlo");
    assert.equal(envios.enviados.length, 0, "ninguna respuesta automática mientras está en atención humana");
  });
});

describe("Expiración de atención humana (autorizado) -- 24h sin intervención humana, el bot recupera el turno solo", () => {
  it("activarAtencionHumana guarda un atencionHumanaDesde real (nunca null) al activarse", async () => {
    const { deps, entradas } = armarDeps();
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "3", wamid: "w2" }, deps);
    assert.equal(entradas.filas[0]!.modo, "atencion_humana");
    assert.ok(entradas.atencionHumanaDesdePorId.get(entradas.filas[0]!.id), "debe guardar el momento real de activación");
  });

  it("antes de las 24h, sigue en silencio total (comportamiento de siempre)", async () => {
    const entradasCompartidas = crearFakeEntradas();
    const hace23h = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    await entradasCompartidas.crearEntrada(FAKE_SUPABASE, {
      tenantId: AMORE_TENANT_ID,
      telefonoCliente: TELEFONO,
      wamid: "w0",
      modo: "atencion_humana",
      notificadoAJessica: true,
      atencionHumanaDesde: hace23h,
    });
    const { deps, envios } = armarDepsGate({}, entradasCompartidas);
    const r = await interceptarAtencionHumanaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "Hola", wamid: "w1" }, deps);
    assert.equal(r.manejado, true, "todavía dentro de la ventana de 24h -- sigue silenciado");
    assert.equal(envios.enviados.length, 0);
    assert.equal(entradasCompartidas.filas[0]!.modo, "atencion_humana", "no debe revertirse antes de tiempo");
  });

  it("pasadas las 24h sin que un humano la resuelva, el bot recupera el turno (deja pasar el mensaje y vuelve a modo 'gemini')", async () => {
    const entradasCompartidas = crearFakeEntradas();
    const hace25h = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await entradasCompartidas.crearEntrada(FAKE_SUPABASE, {
      tenantId: AMORE_TENANT_ID,
      telefonoCliente: TELEFONO,
      wamid: "w0",
      modo: "atencion_humana",
      notificadoAJessica: true,
      atencionHumanaDesde: hace25h,
    });
    const { deps } = armarDepsGate({}, entradasCompartidas);
    const r = await interceptarAtencionHumanaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "Hola", wamid: "w1" }, deps);
    assert.equal(r.manejado, false, "ya expiró -- debe dejar pasar ESTE mismo mensaje al resto del puente (Agenda V2/Gemini)");
    assert.equal(entradasCompartidas.filas[0]!.modo, "gemini", "vuelve a modo normal, ya no atencion_humana");
    assert.equal(
      entradasCompartidas.atencionHumanaDesdePorId.get(entradasCompartidas.filas[0]!.id),
      null,
      "se limpia -- una futura reactivación real vuelve a empezar su propia ventana de 24h",
    );
  });

  it("un mensaje del cliente MIENTRAS espera nunca reinicia la ventana de 24h (atencionHumanaDesde no se toca en updates normales)", async () => {
    const entradasCompartidas = crearFakeEntradas();
    const hace23h = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    await entradasCompartidas.crearEntrada(FAKE_SUPABASE, {
      tenantId: AMORE_TENANT_ID,
      telefonoCliente: TELEFONO,
      wamid: "w0",
      modo: "atencion_humana",
      notificadoAJessica: true,
      atencionHumanaDesde: hace23h,
    });
    const { deps } = armarDepsGate({}, entradasCompartidas);
    await interceptarAtencionHumanaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "¿Alguien me responde?", wamid: "w1" }, deps);
    assert.equal(
      entradasCompartidas.atencionHumanaDesdePorId.get(entradasCompartidas.filas[0]!.id),
      hace23h,
      "el timestamp de activación real nunca cambia solo porque el cliente siga escribiendo",
    );
  });

  it("una fila legacy (activada antes de esta mejora, atencionHumanaDesde=null) recibe un punto de partida real, sin expirarla de golpe", async () => {
    const entradasCompartidas = crearFakeEntradas();
    await entradasCompartidas.crearEntrada(FAKE_SUPABASE, {
      tenantId: AMORE_TENANT_ID,
      telefonoCliente: TELEFONO,
      wamid: "w0",
      modo: "atencion_humana",
      notificadoAJessica: true,
    });
    assert.equal(entradasCompartidas.atencionHumanaDesdePorId.get(entradasCompartidas.filas[0]!.id) ?? null, null);
    const { deps, envios } = armarDepsGate({}, entradasCompartidas);
    const r = await interceptarAtencionHumanaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "Hola", wamid: "w1" }, deps);
    assert.equal(r.manejado, true, "una fila legacy nunca se expira de inmediato solo por no tener el campo -- empieza a contar desde ahora");
    assert.equal(envios.enviados.length, 0);
    assert.ok(
      entradasCompartidas.atencionHumanaDesdePorId.get(entradasCompartidas.filas[0]!.id),
      "debe quedar con un punto de partida real para poder expirar en el futuro",
    );
  });

  it("si obtenerAtencionHumanaDesde falla (migración 20260924010000 aún no aplicada), NUNCA rompe el gate -- se comporta como fila legacy", async () => {
    const entradasCompartidas = crearFakeEntradas();
    await entradasCompartidas.crearEntrada(FAKE_SUPABASE, {
      tenantId: AMORE_TENANT_ID,
      telefonoCliente: TELEFONO,
      wamid: "w0",
      modo: "atencion_humana",
      notificadoAJessica: true,
    });
    const { deps, envios } = armarDepsGate(
      { obtenerAtencionHumanaDesde: async () => { throw new Error("column dulabs_amore_entrada.atencion_humana_desde does not exist"); } },
      entradasCompartidas,
    );
    // La función real (lib/amore-entrada-sesiones.ts::obtenerAtencionHumanaDesde)
    // ya atrapa este error y devuelve null -- este fake simula justamente
    // ESO (nunca debería lanzar hacia el gate), para probar que el propio
    // gate tampoco depende de que la función real haga ese try/catch: si
    // por cualquier motivo SÍ llegara a lanzar, no debe tumbar el canal.
    await assert.doesNotReject(() =>
      interceptarAtencionHumanaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "Hola", wamid: "w1" }, deps),
    );
    assert.equal(envios.enviados.length, 0, "mientras tanto, sigue silenciada -- nunca responde de más solo porque la lectura falló");
  });
});

describe("Test G/C -- gate global: solicitud explícita de humano, y frases que NO deben activarlo", () => {
  it("'quiero hablar con Jessica' activa atención humana desde el gate, incluso sin fila previa (primer contacto)", async () => {
    const { deps, entradas, envios } = armarDepsGate();
    const r = await interceptarAtencionHumanaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "quiero hablar con Jessica", wamid: "w1" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(entradas.filas.length, 1);
    assert.equal(entradas.filas[0]!.modo, "atencion_humana");
    assert.ok(envios.enviados.some((e) => e.telefono === "573227298600"));
  });

  it("'quiero hablar con una persona' / 'pásame con alguien' activan atención humana", async () => {
    for (const texto of ["quiero hablar con una persona", "pásame con Jessica"]) {
      const { deps, entradas } = armarDepsGate();
      const r = await interceptarAtencionHumanaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto, wamid: "w1" }, deps);
      assert.equal(r.manejado, true, `"${texto}" debía activar atención humana`);
      assert.equal(entradas.filas[0]!.modo, "atencion_humana");
    }
  });

  it("'¿Jessica hace maquillaje?' / '¿Qué servicios hace Jessica?' -- NUNCA activan atención humana, dejan pasar el mensaje", async () => {
    for (const texto of ["¿Jessica hace maquillaje?", "¿Qué servicios hace Jessica?", "¿Qué profesionales tienen?"]) {
      const { deps, entradas, envios } = armarDepsGate();
      const r = await interceptarAtencionHumanaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto, wamid: "w1" }, deps);
      assert.equal(r.manejado, false, `"${texto}" NUNCA debía interceptarse acá`);
      assert.equal(entradas.filas.length, 0, "no debe crear ni tocar ningún estado");
      assert.equal(envios.enviados.length, 0);
    }
  });

  it("otro tenant -- el gate nunca actúa, ni siquiera con la frase explícita", async () => {
    const { deps, candado, entradas } = armarDepsGate();
    const r = await interceptarAtencionHumanaAmore({ supabase: FAKE_SUPABASE, idTenant: OTRO_TENANT, telefono: TELEFONO, texto: "quiero hablar con Jessica", wamid: "w1" }, deps);
    assert.deepEqual(r, { manejado: false });
    assert.equal(candado.llamadas.length, 0);
    assert.equal(entradas.filas.length, 0);
  });

  it("mensaje normal sin fila previa y sin solicitud humana -- deja pasar SIN escribir ultimo_wamid_procesado (no interfiere con procesarEntradaAmore)", async () => {
    const { deps, entradas } = armarDepsGate();
    const r = await interceptarAtencionHumanaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    assert.deepEqual(r, { manejado: false });
    assert.equal(entradas.filas.length, 0, "el gate nunca crea la fila de primer contacto -- eso sigue siendo responsabilidad de procesarEntradaAmore");
  });
});

// --- Test 21-G (sección del pedido): Agenda V2 activa + solicitud humana --
// integración REAL contra Supabase (requiere que la migración
// 20260920000000_amore_atencion_humana.sql ya esté aplicada). Usa el
// AMORE_TENANT_ID real (necesario -- el gate es exclusivo de AMORE) pero un
// teléfono de prueba DESCARTABLE (nunca un cliente real, nunca el 3057/R-2CX)
// y `enviarMensajeWhatsApp` SIEMPRE inyectado como fake -- esta prueba NUNCA
// puede enviar un WhatsApp real, sea cual sea la configuración del entorno
// donde se ejecute.
describe("Test 21-G -- integración real: la sesión Agenda V2 activa NUNCA se pierde al activar atención humana", { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" }, () => {
  const supabase = HAS_SUPABASE ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) : (null as never);
  const telefonoPrueba = `57300${Math.floor(Math.random() * 10_000_000)}`; // descartable, nunca un cliente real
  let sesionAgendaId: number | undefined;
  let entradaId: number | undefined;

  after(async () => {
    if (!HAS_SUPABASE) return;
    if (sesionAgendaId) await supabase.from("dulabs_agenda_v2_sesiones").delete().eq("id", sesionAgendaId);
    if (entradaId) await supabase.from("dulabs_amore_entrada").delete().eq("id", entradaId);
  });

  it("activa atencion_humana sin tocar la sesión Agenda V2 real (step/opciones/activo intactos)", async () => {
    const opcionesOriginales = [{ numero: 1, fechaIso: "2027-01-15", etiqueta: "Viernes 15 de enero" }];
    const { data: sesion, error: errorSesion } = await supabase
      .from("dulabs_agenda_v2_sesiones")
      .insert({
        tenant_id: AMORE_TENANT_ID,
        telefono_cliente: telefonoPrueba,
        activo: true,
        step: "S4_HORA",
        servicio_id: null,
        profesional_id: null,
        opciones_mostradas: opcionesOriginales,
      })
      .select("id")
      .single();
    assert.equal(errorSesion, null, errorSesion?.message);
    sesionAgendaId = sesion!.id as number;

    const envios: Array<{ telefono: string; mensaje: string }> = [];
    const r = await interceptarAtencionHumanaAmore(
      { supabase, idTenant: AMORE_TENANT_ID, telefono: telefonoPrueba, texto: "Quiero hablar con Jessica", wamid: randomUUID() },
      {
        enviarMensajeWhatsApp: async (params) => {
          envios.push({ telefono: params.telefono, mensaje: params.mensaje });
          return { ok: true, data: { ok: true } } as const;
        },
      },
    );
    assert.equal(r.manejado, true);
    assert.ok(envios.some((e) => e.telefono === "573227298600"), "debe existir la notificación real a Jessica (mockeada, nunca enviada de verdad en este test)");

    const { data: entradaFila } = await supabase.from("dulabs_amore_entrada").select("id, modo, notificado_a_jessica").eq("tenant_id", AMORE_TENANT_ID).eq("telefono_cliente", telefonoPrueba).single();
    entradaId = entradaFila!.id as number;
    assert.equal(entradaFila!.modo, "atencion_humana");
    assert.equal(entradaFila!.notificado_a_jessica, true);

    // La prueba real de la sección 16 del pedido: la sesión Agenda V2 sigue
    // EXACTAMENTE como estaba -- activa, mismo step, mismas opciones -- porque
    // el gate corre ANTES de procesarMensajeConAgendaV2 en app/api/whatsapp-qr-bot/route.ts
    // y nunca lo llama cuando ya interceptó el mensaje.
    const { data: sesionTrasHumano } = await supabase.from("dulabs_agenda_v2_sesiones").select("activo, step, opciones_mostradas").eq("id", sesionAgendaId).single();
    assert.equal(sesionTrasHumano!.activo, true, "la sesión Agenda V2 NUNCA se elimina/desactiva por pedir atención humana");
    assert.equal(sesionTrasHumano!.step, "S4_HORA", "el progreso de Agenda V2 se preserva intacto");
    assert.deepEqual(sesionTrasHumano!.opciones_mostradas, opcionesOriginales);
  });
});

// --- FASE 2 (autorizado, registro de clientes nuevos) ----------------------

const TEL_REGISTRO = "573148127388";

async function crearFilaEnRegistro(entradas: ReturnType<typeof crearFakeEntradas>, modo: ModoEntradaAmore, wamid = "w0") {
  return entradas.crearEntrada(FAKE_SUPABASE, { tenantId: AMORE_TENANT_ID, telefonoCliente: TEL_REGISTRO, wamid, modo });
}

describe("Test A -- flujo completo nombre -> día -> mes -> Agenda V2", () => {
  it("guarda progresivamente en dulabs_clientes_conocidos y al terminar llama a iniciarAgendaV2 (nunca una segunda lógica de creación)", async () => {
    const entradas = crearFakeEntradas();
    const clientes = crearFakeClientesConocidos();
    const { deps, iniciarAgenda } = armarDepsRegistro({}, entradas, clientes);
    const fila = await crearFilaEnRegistro(entradas, "registro_nombre");

    const r1 = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "María José", wamid: "w1" }, deps);
    assert.equal(r1.manejado, true);
    assert.equal(fila.modo, "registro_dia");
    assert.equal(clientes.clientes.get(`whatsapp-qr:${AMORE_TENANT_ID}|${TEL_REGISTRO}`)?.nombre, "María José", "el nombre se guarda de inmediato, antes de pedir el cumpleaños");

    const r2 = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "15", wamid: "w2" }, deps);
    assert.equal(r2.manejado, true);
    assert.equal(fila.modo, "registro_mes");
    assert.equal(clientes.clientes.get(`whatsapp-qr:${AMORE_TENANT_ID}|${TEL_REGISTRO}`)?.cumpleDia, 15);

    const r3 = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "marzo", wamid: "w3" }, deps);
    assert.equal(r3.manejado, true);
    assert.equal(fila.modo, "gemini", "al terminar vuelve al estado de conversación normal, nunca se queda en registro_mes");
    const clienteFinal = clientes.clientes.get(`whatsapp-qr:${AMORE_TENANT_ID}|${TEL_REGISTRO}`);
    assert.deepEqual(clienteFinal, { nombre: "María José", cumpleDia: 15, cumpleMes: 3 });
    assert.equal(iniciarAgenda.llamadas.length, 1, "el registro completo entrega el control a Agenda V2 vía el mecanismo existente");
    assert.equal(iniciarAgenda.llamadas[0]!.telefono, TEL_REGISTRO);
  });
});

describe("CORRECCIÓN (autorizada) -- registro_dia acepta una fecha combinada real ('3 de enero'), sin pedir el mes de nuevo", () => {
  it("'3 de enero' guarda día Y mes de una sola vez, completa el registro y entrega el control a Agenda V2 -- NUNCA pide el mes", async () => {
    const entradas = crearFakeEntradas();
    const clientes = crearFakeClientesConocidos();
    clientes.clientes.set(`whatsapp-qr:${AMORE_TENANT_ID}|${TEL_REGISTRO}`, { nombre: "Camila", cumpleDia: null, cumpleMes: null });
    const fila = await crearFilaEnRegistro(entradas, "registro_dia");
    const { deps, envios, iniciarAgenda } = armarDepsRegistro({}, entradas, clientes);

    const r = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "3 de enero", wamid: "w1" }, deps);

    assert.equal(r.manejado, true);
    assert.equal(fila.modo, "gemini", "completa el registro de una vez, nunca queda en registro_mes");
    assert.deepEqual(clientes.clientes.get(`whatsapp-qr:${AMORE_TENANT_ID}|${TEL_REGISTRO}`), { nombre: "Camila", cumpleDia: 3, cumpleMes: 1 });
    assert.equal(iniciarAgenda.llamadas.length, 1, "entrega el control a Agenda V2 vía el mecanismo existente, igual que al completar registro_mes normalmente");
    assert.equal(envios.enviados.length, 0, "NUNCA envía 'Necesito un día válido' ni pide el mes -- este camino no manda ningún mensaje propio (igual que el cierre normal de registro_mes)");
  });

  it("defensivo -- si el nombre no quedó persistido, reinicia a registro_nombre en vez de inventar uno (mismo criterio que el resto del flujo)", async () => {
    const entradas = crearFakeEntradas();
    const clientes = crearFakeClientesConocidos(); // sin cliente registrado
    const fila = await crearFilaEnRegistro(entradas, "registro_dia");
    const { deps, envios, iniciarAgenda } = armarDepsRegistro({}, entradas, clientes);

    const r = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "3 de enero", wamid: "w1" }, deps);

    assert.equal(r.manejado, true);
    assert.equal(fila.modo, "registro_nombre");
    assert.equal(envios.enviados.at(-1)!.mensaje, "Antes de continuar, necesito registrarte en AMORE. 💗\n\n¿Me regalas tu nombre?");
    assert.equal(iniciarAgenda.llamadas.length, 0);
  });

  it("regresión -- una entrada de SOLO día ('3') sigue pidiendo el mes exactamente como antes de esta corrección", async () => {
    const entradas = crearFakeEntradas();
    const clientes = crearFakeClientesConocidos();
    clientes.clientes.set(`whatsapp-qr:${AMORE_TENANT_ID}|${TEL_REGISTRO}`, { nombre: "Camila", cumpleDia: null, cumpleMes: null });
    const fila = await crearFilaEnRegistro(entradas, "registro_dia");
    const { deps, envios, iniciarAgenda } = armarDepsRegistro({}, entradas, clientes);

    const r = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "3", wamid: "w1" }, deps);

    assert.equal(r.manejado, true);
    assert.equal(fila.modo, "registro_mes", "sigue pidiendo el mes -- comportamiento 100% idéntico al de antes de esta corrección");
    assert.equal(clientes.clientes.get(`whatsapp-qr:${AMORE_TENANT_ID}|${TEL_REGISTRO}`)?.cumpleDia, 3);
    assert.equal(envios.enviados.at(-1)!.mensaje, "¿Y en qué mes cumples años?\n\nTranquila 💗 Esta información la usamos para conocer tus fechas especiales y brindarte una atención más personalizada.");
    assert.equal(iniciarAgenda.llamadas.length, 0, "todavía no debe entregar el control a Agenda V2 -- falta el mes");
  });

  it("regresión -- una entrada inválida ('hola') mantiene EXACTAMENTE el mensaje de día inválido de siempre", async () => {
    const entradas = crearFakeEntradas();
    const fila = await crearFilaEnRegistro(entradas, "registro_dia");
    const { deps, envios, iniciarAgenda } = armarDepsRegistro({}, entradas);

    const r = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "hola", wamid: "w1" }, deps);

    assert.equal(r.manejado, true);
    assert.equal(fila.modo, "registro_dia", "nunca avanza con una entrada inválida");
    assert.equal(envios.enviados.at(-1)!.mensaje, "Necesito un día válido entre 1 y 31. 💗 ¿Cuál es el día de tu cumpleaños?");
    assert.equal(iniciarAgenda.llamadas.length, 0);
  });
});

describe("Test B/N -- sin registro en curso: deja pasar sin tocar nada", () => {
  it("modo 'gemini' (cliente ya en conversación normal) -> manejado:false, recordarNombreCliente nunca se ejecuta", async () => {
    const entradas = crearFakeEntradas();
    const clientes = crearFakeClientesConocidos();
    await crearFilaEnRegistro(entradas, "gemini");
    const { deps } = armarDepsRegistro({}, entradas, clientes);
    const r = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "hola", wamid: "w1" }, deps);
    assert.deepEqual(r, { manejado: false });
    assert.equal(clientes.clientes.size, 0, "N -- recordarNombreCliente NO se ejecuta durante el ingreso normal");
  });

  it("sin fila de entrada -- manejado:false, nunca crea nada", async () => {
    const { deps, entradas } = armarDepsRegistro();
    const r = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "hola", wamid: "w1" }, deps);
    assert.deepEqual(r, { manejado: false });
    assert.equal(entradas.filas.length, 0);
  });
});

describe("Test F -- día inválido (0, 32, 'hola')", () => {
  for (const texto of ["0", "32", "hola"]) {
    it(`"${texto}" -> mensaje de error exacto, se mantiene en registro_dia`, async () => {
      const entradas = crearFakeEntradas();
      const fila = await crearFilaEnRegistro(entradas, "registro_dia");
      const { deps, envios, iniciarAgenda } = armarDepsRegistro({}, entradas);
      const r = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto, wamid: "w1" }, deps);
      assert.equal(r.manejado, true);
      assert.equal(fila.modo, "registro_dia", "nunca avanza con un día inválido");
      assert.equal(envios.enviados.at(-1)!.mensaje, "Necesito un día válido entre 1 y 31. 💗 ¿Cuál es el día de tu cumpleaños?");
      assert.equal(iniciarAgenda.llamadas.length, 0);
    });
  }
});

describe("Test G -- mes inválido (0, 13, 'invierno')", () => {
  for (const texto of ["0", "13", "invierno"]) {
    it(`"${texto}" -> mensaje de error exacto, se mantiene en registro_mes`, async () => {
      const entradas = crearFakeEntradas();
      const clientes = crearFakeClientesConocidos();
      clientes.clientes.set(`whatsapp-qr:${AMORE_TENANT_ID}|${TEL_REGISTRO}`, { nombre: "Laura", cumpleDia: 10, cumpleMes: null });
      const fila = await crearFilaEnRegistro(entradas, "registro_mes");
      const { deps, envios, iniciarAgenda } = armarDepsRegistro({}, entradas, clientes);
      const r = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto, wamid: "w1" }, deps);
      assert.equal(r.manejado, true);
      assert.equal(fila.modo, "registro_mes", "nunca avanza con un mes inválido");
      assert.equal(envios.enviados.at(-1)!.mensaje, "Necesito un mes válido entre 1 y 12. 💗 ¿En qué mes cumples años?");
      assert.equal(iniciarAgenda.llamadas.length, 0);
    });
  }
});

describe("Test H/I -- mes por número y por nombre completan el registro", () => {
  for (const texto of ["3", "marzo", "mar"]) {
    it(`"${texto}" -> registro completo, iniciarAgendaV2 llamado una vez`, async () => {
      const entradas = crearFakeEntradas();
      const clientes = crearFakeClientesConocidos();
      clientes.clientes.set(`whatsapp-qr:${AMORE_TENANT_ID}|${TEL_REGISTRO}`, { nombre: "Laura", cumpleDia: 10, cumpleMes: null });
      const fila = await crearFilaEnRegistro(entradas, "registro_mes");
      const { deps, iniciarAgenda } = armarDepsRegistro({}, entradas, clientes);
      const r = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto, wamid: "w1" }, deps);
      assert.equal(r.manejado, true);
      assert.equal(fila.modo, "gemini");
      assert.equal(clientes.clientes.get(`whatsapp-qr:${AMORE_TENANT_ID}|${TEL_REGISTRO}`)?.cumpleMes, 3);
      assert.equal(iniciarAgenda.llamadas.length, 1);
    });
  }
});

describe("Test J -- 'cancelar' durante cada paso aborta el registro sin crear sesión Agenda V2", () => {
  for (const modo of ["registro_nombre", "registro_dia", "registro_mes"] as const) {
    it(`modo ${modo}: "cancelar" -> vuelve a modo 'gemini', mensaje de cancelación, iniciarAgendaV2 nunca se llama`, async () => {
      const entradas = crearFakeEntradas();
      const fila = await crearFilaEnRegistro(entradas, modo);
      const { deps, envios, iniciarAgenda } = armarDepsRegistro({}, entradas);
      const r = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "cancelar", wamid: "w1" }, deps);
      assert.equal(r.manejado, true);
      assert.equal(fila.modo, "gemini");
      assert.equal(envios.enviados.at(-1)!.mensaje, "Listo, cancelé el registro 💗 Escríbeme cuando quieras retomarlo.");
      assert.equal(iniciarAgenda.llamadas.length, 0);
    });
  }

  it("es insensible a mayúsculas/acentos pero exige coincidencia EXACTA (mismo criterio que COMANDO_CANCELAR de Agenda V2) -- 'CANCELAR' sí, 'cancelar cita'/'no quiero' NO", async () => {
    const entradas = crearFakeEntradas();
    const fila = await crearFilaEnRegistro(entradas, "registro_nombre");
    const { deps } = armarDepsRegistro({}, entradas);
    const r1 = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "CANCELAR", wamid: "w1" }, deps);
    assert.equal(r1.manejado, true);
    assert.equal(fila.modo, "gemini");

    // "cancelar cita"/"no quiero" nunca se tratan como el nombre de la clienta EN ESTE test porque ya se canceló arriba;
    // se re-arma el escenario para probar que esas frases se aceptan como NOMBRE literal (mismo criterio "no rígido" del pedido).
    const entradas2 = crearFakeEntradas();
    const clientes2 = crearFakeClientesConocidos();
    const fila2 = await crearFilaEnRegistro(entradas2, "registro_nombre");
    const { deps: deps2 } = armarDepsRegistro({}, entradas2, clientes2);
    const r2 = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "no quiero", wamid: "w2" }, deps2);
    assert.equal(r2.manejado, true);
    assert.equal(fila2.modo, "registro_dia", "'no quiero' no es el comando exacto 'cancelar' -- el mecanismo real de Agenda V2 tampoco lo reconoce, así que acá se toma como el nombre dado");
  });
});

describe("Test K -- atención humana durante el registro conserva prioridad (Fase 1 intacta)", () => {
  for (const texto of ["Quiero hablar con Jessica", "Hablar con una persona"]) {
    it(`"${texto}" durante registro_nombre -- interceptarAtencionHumanaAmore (Fase 1) lo captura ANTES, el gate de registro nunca lo ve`, async () => {
      // Reproduce el orden real de app/api/whatsapp-qr-bot/route.ts: primero
      // el gate de atención humana, luego el de registro -- si el primero ya
      // manejó el mensaje, el segundo nunca se llama.
      const entradas = crearFakeEntradas();
      await crearFilaEnRegistro(entradas, "registro_nombre");
      const gateHumano = armarDepsGate({}, entradas);
      const resultadoHumano = await interceptarAtencionHumanaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto, wamid: "w1" }, gateHumano.deps);
      assert.equal(resultadoHumano.manejado, true, "Fase 1 debe capturar la solicitud de atención humana ANTES del gate de registro");
      assert.equal(gateHumano.entradas.filas[0]!.modo, "atencion_humana");
    });
  }
});

describe("Test L -- idempotencia de wamid", () => {
  it("mismo wamid repetido durante registro_nombre -- nunca guarda dos veces ni reenvía", async () => {
    const entradas = crearFakeEntradas();
    const clientes = crearFakeClientesConocidos();
    const fila = await crearFilaEnRegistro(entradas, "registro_nombre");
    const { deps, envios } = armarDepsRegistro({}, entradas, clientes);
    await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "María", wamid: "w1" }, deps);
    const totalEnvios = envios.enviados.length;
    const totalClientes = clientes.clientes.size;
    const r = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_REGISTRO, texto: "María", wamid: "w1" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(fila.modo, "registro_dia", "no retrocede ni reprocesa");
    assert.equal(envios.enviados.length, totalEnvios, "nunca reenvía nada");
    assert.equal(clientes.clientes.size, totalClientes);
  });
});

describe("Test M -- otro tenant: comportamiento intacto", () => {
  it("devuelve manejado:false de inmediato, sin candado, sin leer/escribir nada", async () => {
    const { deps, candado, entradas, clientes } = armarDepsRegistro();
    const r = await interceptarRegistroClienteAmore({ supabase: FAKE_SUPABASE, idTenant: OTRO_TENANT, telefono: TEL_REGISTRO, texto: "cualquier cosa", wamid: "w1" }, deps);
    assert.deepEqual(r, { manejado: false });
    assert.equal(candado.llamadas.length, 0);
    assert.equal(entradas.filas.length, 0);
    assert.equal(clientes.clientes.size, 0);
  });
});

// --- Fase 3 (compra de producto, autorizado) -----------------------------

const NUMERO_JESSICA_TEST = "573227298600";

function crearFakeProductosActivos(productos: { nombre: string }[]) {
  const llamadas: string[] = [];
  return {
    llamadas,
    listarProductosActivos: async (_s: unknown, idTenant: string): Promise<ProductoInventario[]> => {
      llamadas.push(idTenant);
      return productos.map((p, i) => ({
        id: `prod-${i}`,
        idTenant,
        nombre: p.nombre,
        descripcion: null,
        precio: 10000,
        stock: 5,
        categoria: null,
        fotoUrl: null,
        activo: true,
        createdAt: "",
        updatedAt: "",
      }));
    },
  };
}

function armarDepsCompra(
  overrides: Partial<InterceptarCompraProductoDeps> = {},
  entradasCompartidas?: ReturnType<typeof crearFakeEntradas>,
  productosActivos: { nombre: string }[] = [],
) {
  const entradas = entradasCompartidas ?? crearFakeEntradas();
  const envios = crearFakeEnvios();
  const candado = crearFakeCandado();
  const nombreConocido = crearFakeNombreConocido();
  const productos = crearFakeProductosActivos(productosActivos);
  const deps: InterceptarCompraProductoDeps = {
    adquirirCandadoChat: candado.adquirir,
    liberarCandadoChat: candado.liberar,
    buscarEntrada: entradas.buscarEntrada,
    crearEntrada: entradas.crearEntrada,
    actualizarEntrada: entradas.actualizarEntrada,
    enviarMensajeWhatsApp: envios.enviarMensajeWhatsApp,
    buscarNombreConocido: nombreConocido.buscarNombreConocido,
    listarProductosActivos: productos.listarProductosActivos,
    ...overrides,
  };
  return { deps, entradas, envios, candado, nombreConocido, productos };
}

const TEL_COMPRA = "573001112233";

describe("Compra de producto -- link de la tienda (prioridad absoluta, aprobado)", () => {
  it("detecta el mensaje del botón Comprar, saluda con el nombre EXACTO del producto y muestra el menú 1/2", async () => {
    const { deps, entradas, envios } = armarDepsCompra();
    const r = await interceptarCompraProductoAmore(
      { supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto: "Hola, estoy interesada en este producto: Kit de Cuidado Capilar", wamid: "w1" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(entradas.filas[0]!.modo, "compra_producto_opcion");
    assert.equal(entradas.filas[0]!.productoInteresNombre, "Kit de Cuidado Capilar");
    assert.equal(envios.enviados.length, 2);
    assert.match(envios.enviados[0]!.mensaje, /Claro que sí 💗 Veo que estás interesada en Kit de Cuidado Capilar\./);
    assert.match(envios.enviados[1]!.mensaje, /1\. Pagar producto/);
    assert.match(envios.enviados[1]!.mensaje, /2\. Hablar con un asesor/);
  });

  it("funciona como primer contacto real (sin fila previa)", async () => {
    const { deps, entradas } = armarDepsCompra();
    const r = await interceptarCompraProductoAmore(
      { supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto: "Hola, estoy interesada en este producto: Aretes de plata", wamid: "w1" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(entradas.filas.length, 1);
    assert.equal(entradas.filas[0]!.modo, "compra_producto_opcion");
  });

  it("NUNCA consulta el catálogo real cuando el mensaje viene del link (el nombre ya viene en el propio texto)", async () => {
    const { deps, productos } = armarDepsCompra();
    await interceptarCompraProductoAmore(
      { supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto: "Hola, estoy interesada en este producto: Cualquier cosa", wamid: "w1" },
      deps,
    );
    assert.equal(productos.llamadas.length, 0);
  });
});

describe("Compra de producto -- palabras genéricas sueltas NUNCA activan el flujo (aprobado explícitamente)", () => {
  for (const texto of ["producto", "quiero un producto", "comprar", "pago", "el pago ya está listo"]) {
    it(`"${texto}" no dispara el flujo de compra`, async () => {
      const { deps } = armarDepsCompra({}, undefined, [{ nombre: "Kit de Cuidado Capilar" }]);
      const r = await interceptarCompraProductoAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto, wamid: "w1" }, deps);
      assert.deepEqual(r, { manejado: false });
    });
  }

  it('"quiero comprar" SIN mencionar un producto real tampoco activa nada', async () => {
    const { deps } = armarDepsCompra({}, undefined, [{ nombre: "Kit de Cuidado Capilar" }]);
    const r = await interceptarCompraProductoAmore(
      { supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto: "quiero comprar algo bonito", wamid: "w1" },
      deps,
    );
    assert.deepEqual(r, { manejado: false });
  });

  it('"quiero comprar" + el nombre de un producto ACTIVO real SÍ activa el flujo', async () => {
    const { deps, entradas } = armarDepsCompra({}, undefined, [{ nombre: "Kit de Cuidado Capilar" }]);
    const r = await interceptarCompraProductoAmore(
      { supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto: "quiero comprar el Kit de Cuidado Capilar", wamid: "w1" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(entradas.filas[0]!.productoInteresNombre, "Kit de Cuidado Capilar");
  });
});

describe("Compra de producto -- opción 1: Pagar producto", () => {
  it("responde con la llave de pago real (@urrego3948) y pide 'Ya pagué', pasa a compra_esperando_pago", async () => {
    const entradas = crearFakeEntradas();
    const fila = await entradas.crearEntrada(FAKE_SUPABASE, { tenantId: AMORE_TENANT_ID, telefonoCliente: TEL_COMPRA, wamid: "w1", modo: "compra_producto_opcion", productoInteresNombre: "Aretes de plata" });
    const { deps, envios } = armarDepsCompra({}, entradas);
    const r = await interceptarCompraProductoAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto: "1", wamid: "w2" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(fila.modo, "compra_esperando_pago");
    assert.match(envios.enviados[0]!.mensaje, /Ya pagué/);
    assert.match(envios.enviados[0]!.mensaje, /@urrego3948/, "debe mostrar exactamente la llave de pago real definida por el negocio");
    assert.doesNotMatch(envios.enviados[0]!.mensaje, /Nequi|Bancolombia|Daviplata/i, "no debe inventar ningún otro método de pago");
  });
});

describe("Compra de producto -- opción 2: Hablar con un asesor", () => {
  it("envía el mensaje de transferencia al cliente y notifica a Jessica con el producto correcto", async () => {
    const entradas = crearFakeEntradas();
    const fila = await entradas.crearEntrada(FAKE_SUPABASE, { tenantId: AMORE_TENANT_ID, telefonoCliente: TEL_COMPRA, wamid: "w1", modo: "compra_producto_opcion", productoInteresNombre: "Aretes de plata" });
    const { deps, envios } = armarDepsCompra({}, entradas);
    const r = await interceptarCompraProductoAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto: "2", wamid: "w2" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(fila.modo, "atencion_humana");
    assert.equal(fila.notificadoAJessica, true);

    const mensajeCliente = envios.enviados.find((e) => e.telefono === TEL_COMPRA);
    assert.match(mensajeCliente!.mensaje, /Con gusto 💗 Ya te transfiero el chat/);

    const mensajeJessica = envios.enviados.find((e) => e.telefono === NUMERO_JESSICA_TEST);
    assert.ok(mensajeJessica, "debe notificar a Jessica");
    assert.match(mensajeJessica!.mensaje, /Una cliente requiere tu atención\. Está interesada en un producto\./);
    assert.match(mensajeJessica!.mensaje, /Producto: Aretes de plata/);
  });

  it("opción inválida (ni 1 ni 2) reenvía el mismo menú sin avanzar", async () => {
    const entradas = crearFakeEntradas();
    await entradas.crearEntrada(FAKE_SUPABASE, { tenantId: AMORE_TENANT_ID, telefonoCliente: TEL_COMPRA, wamid: "w1", modo: "compra_producto_opcion", productoInteresNombre: "X" });
    const { deps, envios, entradas: entradasResultado } = armarDepsCompra({}, entradas);
    const r = await interceptarCompraProductoAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto: "hola", wamid: "w2" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(entradasResultado.filas[0]!.modo, "compra_producto_opcion", "no avanza de estado");
    assert.match(envios.enviados[0]!.mensaje, /No reconocí esa opción/);
  });
});

describe('Compra de producto -- "Ya pagué" (SOLO dentro de compra_esperando_pago, nunca global -- aprobado)', () => {
  for (const variante of ["Ya pagué", "ya pague", "ya hice el pago", "pago realizado"]) {
    it(`reconoce la variante "${variante}" cuando ya está esperando el pago`, async () => {
      const entradas = crearFakeEntradas();
      const fila = await entradas.crearEntrada(FAKE_SUPABASE, { tenantId: AMORE_TENANT_ID, telefonoCliente: TEL_COMPRA, wamid: "w1", modo: "compra_esperando_pago", productoInteresNombre: "Aretes de plata" });
      const { deps, envios } = armarDepsCompra({}, entradas);
      const r = await interceptarCompraProductoAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto: variante, wamid: "w2" }, deps);
      assert.equal(r.manejado, true);
      assert.equal(fila.modo, "atencion_humana", "transfiere a atención humana");
      assert.equal(fila.notificadoAJessica, true);

      const mensajeCliente = envios.enviados.find((e) => e.telefono === TEL_COMPRA);
      assert.match(mensajeCliente!.mensaje, /Perfecto 💗 Ya pasé la información a nuestro equipo/);

      const mensajeJessica = envios.enviados.find((e) => e.telefono === NUMERO_JESSICA_TEST);
      assert.match(mensajeJessica!.mensaje, /Una cliente reporta pago de producto\./);
      assert.match(mensajeJessica!.mensaje, /Producto: Aretes de plata/);
    });
  }

  it('"Ya pagué" JAMÁS es un trigger global -- fuera de compra_esperando_pago no hace nada', async () => {
    const { deps } = armarDepsCompra({}, undefined, [{ nombre: "Kit de Cuidado Capilar" }]);
    const r = await interceptarCompraProductoAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto: "Ya pagué", wamid: "w1" }, deps);
    assert.deepEqual(r, { manejado: false }, "sin fila/flujo de compra en curso, 'Ya pagué' no dispara nada por sí solo");
  });

  it("mensaje que NO es confirmación de pago, mientras se espera el pago -- recordatorio, nunca deja pasar a Gemini/Agenda V2", async () => {
    const entradas = crearFakeEntradas();
    const fila = await entradas.crearEntrada(FAKE_SUPABASE, { tenantId: AMORE_TENANT_ID, telefonoCliente: TEL_COMPRA, wamid: "w1", modo: "compra_esperando_pago", productoInteresNombre: "X" });
    const { deps, envios } = armarDepsCompra({}, entradas);
    const r = await interceptarCompraProductoAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto: "hola de nuevo", wamid: "w2" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(fila.modo, "compra_esperando_pago", "se queda en el mismo estado, nunca se filtra a otro flujo");
    assert.match(envios.enviados[0]!.mensaje, /Ya pagué/);
  });
});

describe("Compra de producto -- idempotencia y tenant", () => {
  it("mismo wamid repetido -- nunca reenvía nada", async () => {
    const { deps, envios } = armarDepsCompra();
    await interceptarCompraProductoAmore(
      { supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto: "Hola, estoy interesada en este producto: X", wamid: "w1" },
      deps,
    );
    const total = envios.enviados.length;
    const r = await interceptarCompraProductoAmore(
      { supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TEL_COMPRA, texto: "Hola, estoy interesada en este producto: X", wamid: "w1" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(envios.enviados.length, total, "nunca reenvía nada por el mismo wamid");
  });

  it("otro tenant: manejado:false de inmediato, sin candado, sin leer/escribir nada", async () => {
    const { deps, candado, entradas } = armarDepsCompra();
    const r = await interceptarCompraProductoAmore(
      { supabase: FAKE_SUPABASE, idTenant: OTRO_TENANT, telefono: TEL_COMPRA, texto: "Hola, estoy interesada en este producto: X", wamid: "w1" },
      deps,
    );
    assert.deepEqual(r, { manejado: false });
    assert.equal(candado.llamadas.length, 0);
    assert.equal(entradas.filas.length, 0);
  });
});

describe("NUEVA FASE (autorizado) -- DESPEDIDA (glosario AMORE): aislado, de bajo riesgo, nunca toca Agenda V2 ni el modo de la conversación", () => {
  it("'gracias' responde el mensaje de despedida, sin llamar a Gemini ni a Agenda V2, y se queda en modo 'gemini'", async () => {
    const fakeClasificador = crearFakeClasificador({ intent: "CONSULTA", replyText: "no debía llamarse", detectedServiceMention: null });
    const { deps, entradas, envios, iniciarAgenda } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "gracias", wamid: "w3" }, deps);
    assert.equal(r.manejado, true);
    assert.match(envios.enviados.at(-1)!.mensaje, /Con mucho gusto/);
    assert.equal(fakeClasificador.llamadas.length, 0, "nunca debe llamar a Gemini para esto");
    assert.equal(iniciarAgenda.llamadas.length, 0, "una despedida nunca inicia ni toca Agenda V2");
    assert.equal(entradas.filas[0]!.modo, "gemini", "nunca cambia el modo de la conversación");
  });

  it("variantes reales reconocidas: 'muchas gracias', 'hasta luego', 'chao', 'eso era todo'", async () => {
    for (const frase of ["muchas gracias", "hasta luego", "chao", "eso era todo"]) {
      const { deps, envios } = armarDeps();
      await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
      await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
      const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: frase, wamid: "w3" }, deps);
      assert.equal(r.manejado, true, `frase: "${frase}"`);
      assert.match(envios.enviados.at(-1)!.mensaje, /Con mucho gusto/, `frase: "${frase}"`);
    }
  });

  it("exige coincidencia del mensaje COMPLETO -- 'gracias, ¿cuánto cuesta el manicure?' NUNCA se confunde con una despedida, sigue siendo CONSULTA", async () => {
    const fakeClasificador = crearFakeClasificador({ intent: "CONSULTA", replyText: "El manicure cuesta $30.000.", detectedServiceMention: "manicure" });
    const { deps, envios } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    const r = await procesarEntradaAmore(
      { supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "gracias, ¿cuánto cuesta el manicure?", wamid: "w3" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(fakeClasificador.llamadas.length, 1, "un mensaje con contenido real además de 'gracias' SÍ debe llegar a Gemini");
    assert.equal(envios.enviados.at(-1)!.mensaje, "El manicure cuesta $30.000.");
  });

  it("mismo wamid repetido -- nunca reenvía nada", async () => {
    const { deps, envios } = armarDeps();
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "gracias", wamid: "w3" }, deps);
    const total = envios.enviados.length;
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "gracias", wamid: "w3" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(envios.enviados.length, total, "nunca reenvía nada por el mismo wamid");
  });
});

describe("NUEVA FASE (autorizado) -- NO_ENTENDI_REPETIR (glosario AMORE): explica de nuevo, más sencillo, sin reiniciar el flujo", () => {
  it("'no entendí' responde el mensaje de re-explicación, sin llamar a Gemini ni a Agenda V2, y se queda en modo 'gemini'", async () => {
    const fakeClasificador = crearFakeClasificador({ intent: "CONSULTA", replyText: "no debía llamarse", detectedServiceMention: null });
    const { deps, entradas, envios, iniciarAgenda } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "no entendí", wamid: "w3" }, deps);
    assert.equal(r.manejado, true);
    assert.match(envios.enviados.at(-1)!.mensaje, /Te explico de nuevo/);
    assert.equal(fakeClasificador.llamadas.length, 0, "nunca debe llamar a Gemini para esto");
    assert.equal(iniciarAgenda.llamadas.length, 0, "nunca inicia ni toca Agenda V2 -- 'no reiniciar el flujo'");
    assert.equal(entradas.filas[0]!.modo, "gemini", "nunca reinicia ni cambia el modo de la conversación");
  });

  it("variantes reales reconocidas: 'no entiendo', 'como asi', 'explicame', 'que', 'como'", async () => {
    for (const frase of ["no entiendo", "como asi", "explicame", "que", "como"]) {
      const { deps, envios } = armarDeps();
      await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
      await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
      const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: frase, wamid: "w3" }, deps);
      assert.equal(r.manejado, true, `frase: "${frase}"`);
      assert.match(envios.enviados.at(-1)!.mensaje, /Te explico de nuevo/, `frase: "${frase}"`);
    }
  });

  it("exige coincidencia del mensaje COMPLETO -- '¿qué precio tiene el manicure?' NUNCA se confunde, sigue siendo CONSULTA", async () => {
    const fakeClasificador = crearFakeClasificador({ intent: "CONSULTA", replyText: "El manicure cuesta $30.000.", detectedServiceMention: "manicure" });
    const { deps, envios } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    const r = await procesarEntradaAmore(
      { supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "¿qué precio tiene el manicure?", wamid: "w3" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(fakeClasificador.llamadas.length, 1, "una pregunta real que solo contiene 'qué' SÍ debe llegar a Gemini");
    assert.equal(envios.enviados.at(-1)!.mensaje, "El manicure cuesta $30.000.");
  });

  it("mismo wamid repetido -- nunca reenvía nada", async () => {
    const { deps, envios } = armarDeps();
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "no entendí", wamid: "w3" }, deps);
    const total = envios.enviados.length;
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "no entendí", wamid: "w3" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(envios.enviados.length, total, "nunca reenvía nada por el mismo wamid");
  });
});

describe("NUEVA FASE (autorizado) -- CANCELAR_CITA/REPROGRAMAR_CITA detectados por Gemini (variantes ambiguas/indirectas del glosario)", () => {
  it("Caso 2 -- 'me salió una vuelta y no voy a poder ir' (Gemini clasifica CANCELAR_CITA) -> entrega el control a iniciarGestionCitasAgendaV2 con accion='cancelar', NUNCA cancela acá, NUNCA llama a Agenda V2 de reserva", async () => {
    const fakeClasificador = crearFakeClasificador({ intent: "CANCELAR_CITA", replyText: "no debía usarse", detectedServiceMention: null });
    const { deps, entradas, envios, iniciarAgenda, iniciarGestionCitas } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    const r = await procesarEntradaAmore(
      { supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "me salió una vuelta y no voy a poder ir", wamid: "w3" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(iniciarGestionCitas.llamadas.length, 1);
    assert.equal(iniciarGestionCitas.llamadas[0]!.accion, "cancelar");
    assert.equal(iniciarGestionCitas.llamadas[0]!.telefono, TELEFONO);
    assert.equal(iniciarAgenda.llamadas.length, 0, "NUNCA debe iniciar una reserva nueva");
    assert.equal(entradas.filas[0]!.modo, "gemini", "nunca cambia el modo de la conversación");
    // Ningún mensaje de transición extra -- iniciarGestionCitasAgendaV2 (fake) es quien envía la respuesta real.
    // 2 mensajes de bienvenida ("hola") + 1 de MENSAJE_GEMINI_BIENVENIDA ("2"), ninguno adicional por la gestión de citas acá.
    assert.equal(envios.enviados.length, 3, "sin mensaje de transición extra para CANCELAR_CITA/REPROGRAMAR_CITA");
  });

  it("Caso 5 -- 'no puedo ir mañana, ¿la pasamos para el viernes?' (Gemini clasifica REPROGRAMAR_CITA) -> accion='reprogramar'", async () => {
    const fakeClasificador = crearFakeClasificador({ intent: "REPROGRAMAR_CITA", replyText: "no debía usarse", detectedServiceMention: null });
    const { deps, iniciarGestionCitas } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    const r = await procesarEntradaAmore(
      { supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "no puedo ir mañana, ¿la pasamos para el viernes?", wamid: "w3" },
      deps,
    );
    assert.equal(r.manejado, true);
    assert.equal(iniciarGestionCitas.llamadas.length, 1);
    assert.equal(iniciarGestionCitas.llamadas[0]!.accion, "reprogramar");
  });

  it("caso ambiguo -- Gemini responde CONSULTA con una pregunta aclaratoria en vez de adivinar -- nunca toca gestión de citas ni Agenda V2", async () => {
    const fakeClasificador = crearFakeClasificador({
      intent: "CONSULTA",
      replyText: "Claro 💗 ¿Quieres cancelar tu cita o prefieres cambiarla para otro día?",
      detectedServiceMention: null,
    });
    const { deps, envios, iniciarGestionCitas, iniciarAgenda } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "no puedo ir", wamid: "w3" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(envios.enviados.at(-1)!.mensaje, "Claro 💗 ¿Quieres cancelar tu cita o prefieres cambiarla para otro día?");
    assert.equal(iniciarGestionCitas.llamadas.length, 0);
    assert.equal(iniciarAgenda.llamadas.length, 0);
  });

  it("el fast-track determinista de RESERVAR_CITA sigue teniendo prioridad -- nunca llama a Gemini para frases que ya calzan ahí", async () => {
    const fakeClasificador = crearFakeClasificador({ intent: "CANCELAR_CITA", replyText: "no debía llamarse", detectedServiceMention: null });
    const { deps, iniciarAgenda, iniciarGestionCitas } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "quiero una cita", wamid: "w3" }, deps);
    assert.equal(fakeClasificador.llamadas.length, 0);
    assert.equal(iniciarAgenda.llamadas.length, 1);
    assert.equal(iniciarGestionCitas.llamadas.length, 0);
  });

  it("mismo wamid repetido -- nunca vuelve a llamar a iniciarGestionCitasAgendaV2", async () => {
    const fakeClasificador = crearFakeClasificador({ intent: "CANCELAR_CITA", replyText: "no debía usarse", detectedServiceMention: null });
    const { deps, iniciarGestionCitas } = armarDeps({ clasificarConGemini: fakeClasificador.clasificarConGemini });
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "2", wamid: "w2" }, deps);
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "no puedo ir, ya no quiero la cita", wamid: "w3" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "no puedo ir, ya no quiero la cita", wamid: "w3" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(iniciarGestionCitas.llamadas.length, 1, "nunca reprocesa el mismo wamid");
  });
});
