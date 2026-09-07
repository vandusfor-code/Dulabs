/**
 * AMORE (autorizado, Fase 9) -- pruebas del puente bienvenida/Gemini ->
 * Agenda V2. Todas las dependencias reales (candado, estado de entrada,
 * envío de WhatsApp, Gemini, arranque de Agenda V2) están inyectadas con
 * fakes en memoria -- ningún test toca Supabase/Gemini/WhatsApp reales, y
 * ninguno crea una reserva real (iniciarAgendaV2 es un fake que solo
 * registra la llamada, nunca ejecuta lib/agenda-v2/router.ts de verdad).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { procesarEntradaAmore, type AmoreEntradaDeps } from "@/lib/amore-entrada-router";
import type { EntradaAmore, ModoEntradaAmore } from "@/lib/amore-entrada-sesiones";
import type { ResultadoClasificacionGemini } from "@/lib/amore-entrada-gemini";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";

const FAKE_SUPABASE = {} as SupabaseClient;
const OTRO_TENANT = "otro-tenant-cualquiera";

function crearFakeEntradas() {
  const filas: EntradaAmore[] = [];
  let siguienteId = 1;
  return {
    filas,
    buscarEntrada: async (_s: unknown, tenantId: string, telefono: string) => filas.find((f) => f.tenantId === tenantId && f.telefonoCliente === telefono) ?? null,
    crearEntrada: async (_s: unknown, params: { tenantId: string; telefonoCliente: string; wamid: string; modo: ModoEntradaAmore }) => {
      const nueva: EntradaAmore = { id: siguienteId++, tenantId: params.tenantId, telefonoCliente: params.telefonoCliente, modo: params.modo, ultimoWamidProcesado: params.wamid };
      filas.push(nueva);
      return nueva;
    },
    actualizarEntrada: async (_s: unknown, id: number, cambios: { modo?: ModoEntradaAmore; ultimoWamidProcesado?: string }) => {
      const f = filas.find((x) => x.id === id);
      if (f) Object.assign(f, cambios);
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

function crearFakeClasificador(resultado: ResultadoClasificacionGemini | ((mensaje: string) => ResultadoClasificacionGemini)) {
  const llamadas: string[] = [];
  return {
    llamadas,
    clasificarConGemini: async (params: { mensaje: string }) => {
      llamadas.push(params.mensaje);
      return typeof resultado === "function" ? resultado(params.mensaje) : resultado;
    },
  };
}

function armarDeps(overrides: Partial<AmoreEntradaDeps> = {}) {
  const entradas = crearFakeEntradas();
  const envios = crearFakeEnvios();
  const candado = crearFakeCandado();
  const iniciarAgenda = crearFakeIniciarAgendaV2();
  const deps: AmoreEntradaDeps = {
    adquirirCandadoChat: candado.adquirir,
    liberarCandadoChat: candado.liberar,
    buscarEntrada: entradas.buscarEntrada,
    crearEntrada: entradas.crearEntrada,
    actualizarEntrada: entradas.actualizarEntrada,
    enviarMensajeWhatsApp: envios.enviarMensajeWhatsApp,
    iniciarAgendaV2: iniciarAgenda.iniciarAgendaV2,
    ...overrides,
  };
  return { deps, entradas, envios, candado, iniciarAgenda };
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
  it("un texto que no es exactamente '1' o '2' no avanza", async () => {
    const { deps, entradas, envios } = armarDeps();
    await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "hola", wamid: "w1" }, deps);
    const r = await procesarEntradaAmore({ supabase: FAKE_SUPABASE, idTenant: AMORE_TENANT_ID, telefono: TELEFONO, texto: "quiero una cita", wamid: "w2" }, deps);
    assert.equal(r.manejado, true);
    assert.equal(entradas.filas[0]!.modo, "inicio", "nunca infiere la intención en el menú 1/2 -- solo número exacto");
    assert.match(envios.enviados.at(-1)!.mensaje, /No reconocí esa opción/);
  });
});
