/**
 * FASE 1 -- Agendamiento conversacional (autorizado). Tests del ACUMULADOR
 * (resolverAgendamiento, dentro de resolver.ts) contra el banco REAL de
 * AMORE (AMORE_ESCENARIOS_SEED, incluye 070_agendamiento) -- sin Supabase
 * real (deps inyectados), sin Gemini real. Cubre las secciones A-F, H-J,
 * Q, U, X, Y, Z del pedido (25); los escenarios G/K-N/O/P/R/S/T/V/W (que
 * requieren Nylas real) se prueban en lib/reserva-servicio-nylas.test.ts /
 * el archivo dedicado de las acciones nuevas del Flow.
 *
 * El agendamiento SIEMPRE se activa explícitamente ("quiero una cita" y
 * frases equivalentes, ver 070_agendamiento en seed-amore.ts) -- un mensaje
 * que solo menciona un servicio puntual ("Quiero Dipping"), SIN ningún
 * agendamiento ya activo, sigue respondiendo con 028_servicio_info
 * (precio/duración, comportamiento YA existente, protegido) en vez de
 * arrancar un agendamiento nuevo -- así ambos caminos conviven sin
 * pisarse. Por eso cada test de esta suite arranca con "quiero una cita"
 * antes de dar el servicio/fecha/hora, tal como describe la sección 3 del
 * pedido ("F. 'El viernes' -- debe interpretar dentro del CONTEXTO DE
 * AGENDAMIENTO EXISTENTE").
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverEscenario } from "@/lib/bot-escenarios/resolver";
import { AMORE_ESCENARIOS_SEED } from "@/lib/bot-escenarios/seed-amore";
import type { ContextoConversacional, EscenarioRow } from "@/lib/bot-escenarios/tipos";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";
import { fechaColombiaDesdeIso } from "@/lib/timezone-colombia";

const FAKE_SUPABASE = {} as SupabaseClient;
const TENANT = "amore-test";

const ESCENARIOS: EscenarioRow[] = AMORE_ESCENARIOS_SEED.map((s, i) => ({ ...s, id: `e${i}`, tenantId: TENANT }));

const CATALOGO: ServicioCatalogoReal[] = [
  { id: "s-dipping", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-pressón", nombre: "Press On", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
];

const ESPECIALISTAS = [
  { id: 1, nombre: "Mary" },
  { id: 2, nombre: "Cristal" },
];

// Ancla en el mismo "hoy" que usa resolver.ts en producción
// (fechaColombiaDesdeIso(new Date().toISOString())) -- nunca una fecha
// hardcodeada, para que VIERNES/SABADO coincidan siempre con lo que el
// código real calcula, sin importar cuándo se corran los tests. Se usan
// componentes UTC puros (Date.UTC) para que getDay() no dependa de la zona
// horaria de la máquina que corre los tests.
const HOY_ISO = fechaColombiaDesdeIso(new Date().toISOString());
function proximoDiaSemana(diaObjetivo: number): string {
  const [y, m, d] = HOY_ISO.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  while (fecha.getUTCDay() !== diaObjetivo) fecha.setUTCDate(fecha.getUTCDate() + 1);
  return fecha.toISOString().slice(0, 10);
}
const VIERNES = proximoDiaSemana(5);
const SABADO = proximoDiaSemana(6);

async function resolver(mensaje: string, ctx: ContextoConversacional = {}, opts: { nombreConocido?: string | null } = {}) {
  return resolverEscenario({
    supabase: FAKE_SUPABASE,
    tenantId: TENANT,
    mensaje,
    contexto: ctx,
    turno: 0,
    telefonoCliente: "573148127388",
    deps: {
      cargarEscenarios: async () => ESCENARIOS,
      cargarCatalogo: async () => CATALOGO,
      cargarProfesionales: async () => ({ profesionales: [] }),
      cargarConocimiento: async () => [],
      cargarEspecialistas: async () => ESPECIALISTAS,
      buscarNombreConocido: async () => opts.nombreConocido ?? null,
    },
  });
}

/** Encadena una serie de mensajes desde cero, devolviendo el resultado del ÚLTIMO. */
async function conversar(mensajes: string[], opts: { nombreConocido?: string | null } = {}) {
  let ctx: ContextoConversacional = {};
  let r;
  for (const m of mensajes) {
    r = await resolver(m, ctx, opts);
    ctx = r.contexto;
  }
  return r!;
}

describe("A. 'Quiero una cita' -- activa el agendamiento, sin datos todavía", () => {
  it("pide servicio, UNA sola pregunta", async () => {
    const r = await resolver("quiero una cita");
    assert.equal(r.escenarioCodigo, "070_agendamiento");
    assert.equal(r.modo, "ai");
    assert.ok(r.contexto.agendamiento, "debe quedar un acumulador activo");
    assert.equal(r.contexto.agendamiento?.servicioId, undefined);
    assert.match(r.instruccionIA ?? "", /servicio/i);
  });
});

describe("B-E. Acumulador -- cualquier orden, nunca un formulario rígido", () => {
  it("B. 'Quiero Dipping' (mención AISLADA, sin fecha/hora/profesional) -> 028_servicio_info responde el precio (comportamiento YA existente, protegido -- sección 11), pero el servicio SÍ queda guardado en el agendamiento", async () => {
    const r = await conversar(["quiero una cita", "quiero dipping"]);
    assert.equal(r.escenarioCodigo, "028_servicio_info", "una mención aislada del servicio sigue respondiendo su precio, como antes de esta fase");
    assert.match(r.respuestaTexto ?? "", /60\.000|\$60/);
    assert.equal(r.contexto.agendamiento?.servicioId, "s-dipping", "el servicio SÍ se fusionó en el acumulador aunque este turno lo respondió 028");
    assert.equal(r.contexto.agendamiento?.fechaISO, undefined);

    // El siguiente turno ya retoma el agendamiento y pide la fecha -- el
    // dato del servicio no se perdió por haber sido 028 quien contestó.
    const r2 = await resolver("el viernes", r.contexto);
    assert.equal(r2.contexto.agendamiento?.servicioId, "s-dipping");
    assert.equal(r2.contexto.agendamiento?.fechaISO, VIERNES);
  });

  it("C. '...el viernes' -> guarda servicio + fecha, ya listo para consultar disponibilidad", async () => {
    const r = await conversar(["quiero una cita", "quiero dipping", "el viernes"]);
    assert.equal(r.contexto.agendamiento?.servicioId, "s-dipping");
    assert.equal(r.contexto.agendamiento?.fechaISO, VIERNES);
    assert.equal(r.modo, "agendar_buscar_disponibilidad");
  });

  it("D. '...a las 4 de la tarde' -> guarda además la hora preferida (sin periodo sería ambiguo -- ver parseHoraColombia, nunca inventa am/pm)", async () => {
    const r = await conversar(["quiero una cita", "quiero dipping el viernes a las 4 de la tarde"]);
    assert.equal(r.contexto.agendamiento?.servicioId, "s-dipping");
    assert.equal(r.contexto.agendamiento?.fechaISO, VIERNES);
    assert.equal(r.contexto.agendamiento?.horaPreferidaHHMM, "16:00");
  });

  it("E. '...con Mary' en el mismo mensaje -> servicio + fecha + hora + profesional de una vez", async () => {
    const r = await conversar(["quiero una cita", "quiero dipping el viernes a las 4 de la tarde con Mary"]);
    const a = r.contexto.agendamiento;
    assert.equal(a?.servicioId, "s-dipping");
    assert.equal(a?.fechaISO, VIERNES);
    assert.equal(a?.horaPreferidaHHMM, "16:00");
    assert.equal(a?.especialistaId, 1);
    assert.equal(a?.especialistaNombre, "Mary");
  });
});

describe("F. Continuidad -- 'el viernes entonces' dentro del agendamiento en curso", () => {
  it("interpreta 'el viernes' como parte del agendamiento activo, no una conversación nueva", async () => {
    const r = await conversar(["quiero una cita", "quiero dipping", "el viernes entonces"]);
    assert.equal(r.contexto.agendamiento?.servicioId, "s-dipping", "el servicio ya acumulado se conserva");
    assert.equal(r.contexto.agendamiento?.fechaISO, VIERNES);
  });
});

describe("G/U. Interrupciones -- preguntas informativas NUNCA destruyen el agendamiento en curso", () => {
  it("'¿Cuánto vale el Dipping?' durante un agendamiento activo se responde SIN perder servicio+fecha ya acumulados", async () => {
    const t1 = await conversar(["quiero una cita", "quiero dipping el viernes"]);
    assert.equal(t1.modo, "agendar_buscar_disponibilidad");
    const t2 = await resolver("¿cuánto vale el dipping?", t1.contexto);
    assert.equal(t2.escenarioCodigo, "028_servicio_info", "la pregunta informativa SÍ se responde con su propio escenario");
    assert.match(t2.respuestaTexto ?? "", /60\.000|\$60/);
    assert.equal(t2.contexto.agendamiento?.servicioId, "s-dipping", "el agendamiento sigue intacto");
    assert.equal(t2.contexto.agendamiento?.fechaISO, VIERNES, "la fecha ya dada tampoco se pierde");
  });

  it("después de la pregunta informativa, retomar 'bueno entonces a las 4 de la tarde' sigue funcionando sobre el MISMO agendamiento", async () => {
    const t1 = await conversar(["quiero una cita", "quiero dipping el viernes"]);
    // Dentro del flujo de agendamiento (decidirSiguientePasoAgendamiento)
    // nunca se actualiza contexto.ultimoServicioId -- por diseño, ese campo
    // es propio de las respuestas informativas normales (028/029/051), no
    // del acumulador de agendamiento. Por eso "¿y qué es el press on?" se
    // resuelve como la explicación de UN servicio aislado (029), no como una
    // comparación contextual con el Dipping ya elegido.
    const t2 = await resolver("¿y qué es el press on?", t1.contexto);
    assert.equal(t2.escenarioCodigo, "029_explicacion_servicio");
    const t3 = await resolver("bueno, entonces a las 4 de la tarde", t2.contexto);
    assert.equal(t3.contexto.agendamiento?.servicioId, "s-dipping", "NUNCA cambió a Press On solo por haber preguntado por él");
    assert.equal(t3.contexto.agendamiento?.horaPreferidaHHMM, "16:00");
  });
});

describe("H. Cambio de servicio -- limpia SOLO lo dependiente, conserva la fecha", () => {
  it("'No, mejor Press On' cambia el servicio y conserva la fecha ya válida", async () => {
    const t1 = await conversar(["quiero una cita", "quiero dipping el viernes a las 4 con mary"]);
    const t2 = await resolver("no, mejor press on", t1.contexto);
    assert.equal(t2.contexto.agendamiento?.servicioId, "s-pressón");
    assert.equal(t2.contexto.agendamiento?.fechaISO, VIERNES, "la fecha se conserva -- sigue siendo válida");
    assert.equal(t2.contexto.agendamiento?.especialistaId, undefined, "la profesional se limpia -- dependía del servicio anterior");
  });
});

describe("I. Cambio de fecha -- conserva servicio y profesional si siguen siendo válidos", () => {
  it("'Mejor el sábado' actualiza solo la fecha", async () => {
    const t1 = await conversar(["quiero una cita", "quiero dipping el viernes con mary"]);
    const t2 = await resolver("mejor el sabado", t1.contexto);
    assert.equal(t2.contexto.agendamiento?.servicioId, "s-dipping");
    assert.equal(t2.contexto.agendamiento?.especialistaId, 1, "Mary se conserva -- un cambio de fecha no la invalida");
    assert.equal(t2.contexto.agendamiento?.fechaISO, SABADO);
  });
});

describe("J. Cambio de profesional -- restringe la búsqueda a la nueva", () => {
  it("'Mejor con Cristal' cambia la profesional elegida", async () => {
    const t1 = await conversar(["quiero una cita", "quiero dipping el viernes con mary"]);
    const t2 = await resolver("mejor con Cristal", t1.contexto);
    assert.equal(t2.contexto.agendamiento?.especialistaId, 2);
    assert.equal(t2.contexto.agendamiento?.especialistaNombre, "Cristal");
  });
});

describe("Q. Respuesta ambigua NUNCA reserva", () => {
  it("'creo que sí' sin haber ofrecido nada, no reserva ni hace nada especial", async () => {
    const t1 = await conversar(["quiero una cita", "quiero dipping el viernes a las 4 con mary"]);
    const conOpcion: ContextoConversacional = {
      ...t1.contexto,
      agendamiento: {
        ...t1.contexto.agendamiento,
        opcionesOfrecidas: [{ especialistaId: 1, especialistaNombre: "Mary", horaTexto: "16:00", horaISO: `${VIERNES}T16:00:00-05:00` }],
        horarioSeleccionadoISO: `${VIERNES}T16:00:00-05:00`,
        especialistaSeleccionadaId: 1,
        especialistaSeleccionadaNombre: "Mary",
        nombreCliente: "Ana",
        esperandoConfirmacion: true,
      },
    };
    const t2 = await resolver("creo que sí", conOpcion, { nombreConocido: "Ana" });
    assert.notEqual(t2.modo, "agendar_crear_cita", "una respuesta ambigua NUNCA debe disparar la reserva real");
    assert.equal(t2.contexto.agendamiento?.esperandoConfirmacion, true, "sigue esperando una confirmación clara");
  });

  it("una confirmación EXPLÍCITA sí dispara la reserva real", async () => {
    const conOpcion: ContextoConversacional = {
      agendamiento: {
        servicioId: "s-dipping",
        servicioNombre: "Dipping",
        duracionMin: 120,
        fechaISO: VIERNES,
        opcionesOfrecidas: [{ especialistaId: 1, especialistaNombre: "Mary", horaTexto: "16:00", horaISO: `${VIERNES}T16:00:00-05:00` }],
        horarioSeleccionadoISO: `${VIERNES}T16:00:00-05:00`,
        especialistaSeleccionadaId: 1,
        especialistaSeleccionadaNombre: "Mary",
        nombreCliente: "Ana",
        esperandoConfirmacion: true,
      },
    };
    const t2 = await resolver("sí, resérvala", conOpcion);
    assert.equal(t2.modo, "agendar_crear_cita");
  });

  // Revisión (autorizada) -- confirmaciones naturales adicionales pedidas
  // explícitamente, verificadas de punta a punta (no solo a nivel de
  // extracción aislada) contra el resolver completo.
  for (const confirmacionNatural of ["Perfecto, esa", "Sí, esa me sirve", "Quiero esa"]) {
    it(`confirmación natural '${confirmacionNatural}' SÍ dispara la reserva real`, async () => {
      const conOpcion: ContextoConversacional = {
        agendamiento: {
          servicioId: "s-dipping",
          servicioNombre: "Dipping",
          duracionMin: 120,
          fechaISO: VIERNES,
          opcionesOfrecidas: [{ especialistaId: 1, especialistaNombre: "Mary", horaTexto: "16:00", horaISO: `${VIERNES}T16:00:00-05:00` }],
          horarioSeleccionadoISO: `${VIERNES}T16:00:00-05:00`,
          especialistaSeleccionadaId: 1,
          especialistaSeleccionadaNombre: "Mary",
          nombreCliente: "Ana",
          esperandoConfirmacion: true,
        },
      };
      const t2 = await resolver(confirmacionNatural, conOpcion);
      assert.equal(t2.modo, "agendar_crear_cita");
    });
  }

  // Revisión (autorizada) -- frases ambiguas adicionales pedidas
  // explícitamente: ninguna debe disparar la reserva real, aunque haya una
  // opción concreta ya ofrecida y la clienta esté respondiendo justo a eso.
  for (const fraseAmbigua of ["Me gusta", "Está bonita", "¿Y esa cuánto cuesta?", "Déjame pensarlo"]) {
    it(`frase ambigua '${fraseAmbigua}' NUNCA dispara la reserva real`, async () => {
      const conOpcion: ContextoConversacional = {
        agendamiento: {
          servicioId: "s-dipping",
          servicioNombre: "Dipping",
          duracionMin: 120,
          fechaISO: VIERNES,
          opcionesOfrecidas: [{ especialistaId: 1, especialistaNombre: "Mary", horaTexto: "16:00", horaISO: `${VIERNES}T16:00:00-05:00` }],
          horarioSeleccionadoISO: `${VIERNES}T16:00:00-05:00`,
          especialistaSeleccionadaId: 1,
          especialistaSeleccionadaNombre: "Mary",
          nombreCliente: "Ana",
          esperandoConfirmacion: true,
        },
      };
      const t2 = await resolver(fraseAmbigua, conOpcion, { nombreConocido: "Ana" });
      assert.notEqual(t2.modo, "agendar_crear_cita", `"${fraseAmbigua}" NUNCA debe disparar la reserva real`);
      assert.equal(t2.contexto.agendamiento?.esperandoConfirmacion, true, "sigue esperando una confirmación clara");
    });
  }
});

describe("Nombre del cliente -- reutiliza dulabs_clientes_conocidos antes de preguntar", () => {
  it("si el nombre ya se conoce, nunca se pregunta -- pasa directo a pedir confirmación", async () => {
    const conOpcionSinNombre: ContextoConversacional = {
      agendamiento: {
        servicioId: "s-dipping",
        servicioNombre: "Dipping",
        duracionMin: 120,
        fechaISO: VIERNES,
        opcionesOfrecidas: [{ especialistaId: 1, especialistaNombre: "Mary", horaTexto: "16:00", horaISO: `${VIERNES}T16:00:00-05:00` }],
        horarioSeleccionadoISO: `${VIERNES}T16:00:00-05:00`,
        especialistaSeleccionadaId: 1,
        especialistaSeleccionadaNombre: "Mary",
      },
    };
    const r = await resolver("perfecto, esa", conOpcionSinNombre, { nombreConocido: "Ana Pérez" });
    assert.equal(r.contexto.agendamiento?.nombreCliente, "Ana Pérez");
    assert.equal(r.contexto.agendamiento?.esperandoConfirmacion, true);
    assert.doesNotMatch(r.instruccionIA ?? "", /nombre de quién/i);
  });

  it("si NO se conoce, se pregunta de forma natural (una sola pregunta) antes de confirmar", async () => {
    const conOpcionSinNombre: ContextoConversacional = {
      agendamiento: {
        servicioId: "s-dipping",
        servicioNombre: "Dipping",
        duracionMin: 120,
        fechaISO: VIERNES,
        opcionesOfrecidas: [{ especialistaId: 1, especialistaNombre: "Mary", horaTexto: "16:00", horaISO: `${VIERNES}T16:00:00-05:00` }],
        horarioSeleccionadoISO: `${VIERNES}T16:00:00-05:00`,
        especialistaSeleccionadaId: 1,
        especialistaSeleccionadaNombre: "Mary",
      },
    };
    const r = await resolver("perfecto, esa", conOpcionSinNombre, { nombreConocido: null });
    assert.equal(r.contexto.agendamiento?.nombreCliente, undefined);
    assert.equal(r.contexto.agendamiento?.nombrePendiente, true);
    assert.equal(r.contexto.agendamiento?.esperandoConfirmacion, undefined, "no debe pedir confirmación todavía sin nombre");
    assert.match(r.instruccionIA ?? "", /nombre/i);

    const r2 = await resolver("Ana Pérez", r.contexto, { nombreConocido: null });
    assert.equal(r2.contexto.agendamiento?.nombreCliente, "Ana Pérez");
    assert.equal(r2.contexto.agendamiento?.esperandoConfirmacion, true);
  });
});

describe("X/Y. Todos los datos en un mensaje vs. repartidos en varios", () => {
  it("X. todos los datos en un solo mensaje llegan al mismo estado final que repartidos (Y)", async () => {
    const todoJunto = await conversar(["quiero una cita", "quiero dipping el viernes a las 4 de la tarde con mary"]);
    const repartido = await conversar(["quiero una cita", "quiero dipping", "el viernes", "a las 4 de la tarde", "con mary"]);

    const a1 = todoJunto.contexto.agendamiento!;
    const a2 = repartido.contexto.agendamiento!;
    assert.equal(a1.servicioId, a2.servicioId);
    assert.equal(a1.fechaISO, a2.fechaISO);
    assert.equal(a1.horaPreferidaHHMM, a2.horaPreferidaHHMM);
    assert.equal(a1.especialistaId, a2.especialistaId);
  });
});

describe("Z. 'la que sea' cuando hay varias profesionales -- nunca adivina, pide aclaración solo si es real la ambigüedad", () => {
  it("con una ÚNICA opción ofrecida, cualquier respuesta de selección la toma sin necesidad de nombrar la hora/profesional", async () => {
    const conUnaOpcion: ContextoConversacional = {
      agendamiento: {
        servicioId: "s-dipping",
        servicioNombre: "Dipping",
        duracionMin: 120,
        fechaISO: VIERNES,
        opcionesOfrecidas: [{ especialistaId: 1, especialistaNombre: "Mary", horaTexto: "16:00", horaISO: `${VIERNES}T16:00:00-05:00` }],
      },
    };
    const r = await resolver("la que sea", conUnaOpcion, { nombreConocido: "Ana" });
    assert.equal(r.contexto.agendamiento?.horarioSeleccionadoISO, `${VIERNES}T16:00:00-05:00`);
  });

  it("con VARIAS opciones a la misma hora, nunca adivina -- pregunta con cuál profesional", async () => {
    const conVariasOpciones: ContextoConversacional = {
      agendamiento: {
        servicioId: "s-dipping",
        servicioNombre: "Dipping",
        duracionMin: 120,
        fechaISO: VIERNES,
        horaPreferidaHHMM: "16:00",
        opcionesOfrecidas: [
          { especialistaId: 1, especialistaNombre: "Mary", horaTexto: "16:00", horaISO: `${VIERNES}T16:00:00-05:00` },
          { especialistaId: 2, especialistaNombre: "Cristal", horaTexto: "16:00", horaISO: `${VIERNES}T16:00:00-05:00` },
        ],
      },
    };
    const r = await resolver("esa hora está bien", conVariasOpciones);
    assert.equal(r.contexto.agendamiento?.horarioSeleccionadoISO, undefined, "no debe elegir ninguna al azar");
    assert.match(r.respuestaTexto ?? "", /Mary|Cristal/);
  });
});

describe("Cancelación explícita", () => {
  it("'cancela' limpia el agendamiento en curso por completo", async () => {
    const t1 = await conversar(["quiero una cita", "quiero dipping el viernes con mary"]);
    const t2 = await resolver("cancela", t1.contexto);
    assert.equal(t2.contexto.agendamiento, undefined);
    assert.equal(t2.modo, "deterministic");
  });
});

describe("Fecha ambigua -- nunca inventa", () => {
  it("una fecha ambigua ('el otro sábado') responde honesto, sin perder el servicio ya acumulado", async () => {
    const t1 = await conversar(["quiero una cita", "quiero dipping"]);
    const t2 = await resolver("el otro sábado", t1.contexto);
    assert.equal(t2.modo, "deterministic");
    assert.match(t2.respuestaTexto ?? "", /no me quedó claro/i);
    assert.equal(t2.contexto.agendamiento?.servicioId, "s-dipping", "el servicio ya dado no se pierde por una fecha ambigua");
  });
});
