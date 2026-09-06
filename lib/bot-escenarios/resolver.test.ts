/**
 * Pruebas del resolver genérico contra el banco REAL de AMORE
 * (lib/bot-escenarios/seed-amore.ts) + un catálogo real recortado -- sin
 * Supabase real (deps inyectados), sin Claude real (solo se verifica que
 * requiereIA quede marcado correctamente; el texto de la IA en sí lo prueba
 * el flow, ver lib/flows/amore-router.flow.test.ts).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverEscenario } from "@/lib/bot-escenarios/resolver";
import { AMORE_ESCENARIOS_SEED } from "@/lib/bot-escenarios/seed-amore";
import type { ConocimientoServicio, ContextoConversacional, EscenarioRow } from "@/lib/bot-escenarios/tipos";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";

const FAKE_SUPABASE = {} as SupabaseClient;
const TENANT = "amore-test";

const ESCENARIOS: EscenarioRow[] = AMORE_ESCENARIOS_SEED.map((s, i) => ({ ...s, id: `e${i}`, tenantId: TENANT }));

// Prueba real de WhatsApp (autorizado) — orden alfabético REAL de la
// columna `nombre`, tal como devuelve listarCatalogoServiciosReal (order by
// categoria, nombre). Los "Caballero..." quedan primeros a propósito -- es
// exactamente el orden que causó el bug real (.slice(0,3) sin filtro de
// género devolvía solo esos 3).
const CATALOGO: ServicioCatalogoReal[] = [
  { id: "s-caballero-manos", nombre: "Caballero Manos Semi", precio: 30000, duracionMin: 60, categoria: "Uñas", descripcion: null },
  { id: "s-caballero-manospies", nombre: "Caballero Manos y Pies", precio: 30000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-esmalte", nombre: "Cambio De Esmalte", precio: 10000, duracionMin: 20, categoria: "Uñas", descripcion: null },
  { id: "s-dipping", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-manospies", nombre: "Manos y Pies Semi", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-pressón", nombre: "Press On", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-retiro", nombre: "Retiro Semi", precio: 5000, duracionMin: 15, categoria: "Uñas", descripcion: null },
  { id: "s-una", nombre: "Uña", precio: 8000, duracionMin: 15, categoria: "Uñas", descripcion: null },
  { id: "s-maquillajesuave", nombre: "Maquillaje Suave", precio: 60000, duracionMin: 60, categoria: "Maquillaje", descripcion: null },
  { id: "s-cejascera", nombre: "Cejas con Cera", precio: 15000, duracionMin: 10, categoria: "Cejas", descripcion: null },
];

function contexto(overrides: Partial<ContextoConversacional> = {}): ContextoConversacional {
  return { ...overrides };
}

async function resolver(
  mensaje: string,
  ctx: ContextoConversacional = {},
  turno = 0,
  conocimiento: ConocimientoServicio[] = [],
) {
  return resolverEscenario({
    supabase: FAKE_SUPABASE,
    tenantId: TENANT,
    mensaje,
    contexto: ctx,
    turno,
    deps: {
      cargarEscenarios: async () => ESCENARIOS,
      cargarCatalogo: async () => CATALOGO,
      cargarProfesionales: async (_s, _t, servicioId) =>
        servicioId === "s-dipping" ? { profesionales: ["Mary", "Jessica"] } : { profesionales: [] },
      cargarConocimiento: async () => conocimiento,
      // FASE 1 -- Agendamiento conversacional (autorizado): ningún test de
      // ESTE archivo prueba agendamiento (ver resolver-agendamiento.test.ts
      // para esos) -- deps mínimos para que "quiero una cita" (que ahora
      // también matchea 070_agendamiento, prioridad mayor que 061) no
      // intente tocar Supabase real por accidente.
      cargarEspecialistas: async () => [],
      buscarNombreConocido: async () => null,
    },
  });
}

describe("resolverEscenario — banco real de AMORE, sin IA en el camino determinístico", () => {
  it("saludo: deterministic, nunca usa IA, respuesta cálida", async () => {
    const r = await resolver("Hola");
    assert.equal(r.modo, "deterministic");
    assert.equal(r.requiereIA, false);
    assert.match(r.respuestaTexto!, /Hola/);
  });

  it("categoría uñas: solo muestra opciones reales de Uñas, nunca cabello/maquillaje", async () => {
    const r = await resolver("quiero arreglarme las unas");
    assert.equal(r.modo, "catalog");
    assert.equal(r.requiereIA, false);
    assert.doesNotMatch(r.respuestaTexto ?? "", /Maquillaje Suave|Cejas con Cera/);
  });

  describe("BUG REAL (prueba de WhatsApp): categoría uñas NUNCA asume género de caballero", () => {
    it("'Quiero arreglarme las uñas' -> excluye servicios de caballero aunque sean alfabéticamente los primeros 3", async () => {
      const r = await resolver("Quiero arreglarme las uñas");
      assert.doesNotMatch(r.respuestaTexto ?? "", /Caballero/i);
      assert.match(r.respuestaTexto!, /Cambio De Esmalte|Dipping|Manos y Pies Semi/);
    });

    it("'quiero algo de caballero para las uñas' -> SÍ muestra opciones de caballero (evidencia explícita)", async () => {
      const r = await resolver("quiero algo de caballero para las uñas");
      assert.match(r.respuestaTexto!, /Caballero/i);
    });

    it("'hombre' también cuenta como evidencia explícita de género", async () => {
      const r = await resolver("uñas para hombre");
      assert.match(r.respuestaTexto!, /Caballero/i);
    });
  });

  describe("BUG REAL (prueba de WhatsApp): 'Manos y pies' es intención COMBINADA, nunca solo 'manos' ni asume caballero", () => {
    it("'Manos y pies' -> busca items con AMBAS palabras, excluye caballero, nunca cae a la categoría genérica de uñas", async () => {
      const r = await resolver("Manos y pies");
      assert.equal(r.escenarioCodigo, "029_categoria_manos_y_pies");
      assert.match(r.respuestaTexto!, /Manos y Pies Semi/);
      assert.doesNotMatch(r.respuestaTexto ?? "", /Caballero/i);
    });

    it("'Manos' sola (sin 'pies') sigue resolviendo como antes -- solo intención de manos", async () => {
      const r = await resolver("quiero arreglarme las manos");
      assert.notEqual(r.escenarioCodigo, "029_categoria_manos_y_pies");
    });

    it("'Manos y pies de caballero' -> combinado + caballero explícito", async () => {
      const r = await resolver("manos y pies de caballero");
      assert.equal(r.escenarioCodigo, "029_categoria_manos_y_pies");
      assert.match(r.respuestaTexto!, /Caballero Manos y Pies/);
    });
  });

  describe("BUG REAL (prueba de WhatsApp): referencias a la última lista de opciones mostrada", () => {
    it("'la de 30 mil' tras una lista ambigua (2 empatadas) -> pide aclaración, nunca adivina", async () => {
      const t1 = await resolver("quiero algo de caballero para las uñas"); // Caballero Manos Semi Y Caballero Manos y Pies, ambos $30.000
      const t2 = await resolver("la de 30 mil", t1.contexto, 1);
      assert.match(t2.respuestaTexto!, /dos opciones/i);
      assert.match(t2.respuestaTexto!, /Caballero Manos Semi/);
      assert.match(t2.respuestaTexto!, /Caballero Manos y Pies/);
    });

    it("'la segunda' resuelve por posición contra la lista real mostrada", async () => {
      const t1 = await resolver("quiero arreglarme las uñas"); // Cambio De Esmalte, Dipping, Manos y Pies Semi (en ese orden)
      const t2 = await resolver("la segunda", t1.contexto, 1);
      assert.match(t2.respuestaTexto!, /Dipping/);
      assert.match(t2.respuestaTexto!, /\$60\.000/);
    });

    it("'la más barata' resuelve por precio real, nunca arbitrario", async () => {
      const t1 = await resolver("quiero arreglarme las uñas");
      const t2 = await resolver("la más barata", t1.contexto, 1);
      assert.match(t2.respuestaTexto!, /Cambio De Esmalte/);
    });

    it("'la de 2 horas' resuelve por duración cuando es inequívoco", async () => {
      const t1 = await resolver("manos y pies"); // solo Manos y Pies Semi (2h) tras excluir caballero
      const t2 = await resolver("la de 2 horas", t1.contexto, 1);
      assert.match(t2.respuestaTexto!, /Manos y Pies Semi/);
    });
  });

  it("Dipping: precio + duración reales, sin IA, contexto queda listo para agendar", async () => {
    const r = await resolver("cuánto cuesta el dipping");
    assert.equal(r.modo, "catalog");
    assert.equal(r.requiereIA, false);
    assert.match(r.respuestaTexto!, /Dipping.*\$60\.000.*2 h/);
    assert.equal(r.contexto.ultimoServicioId, "s-dipping");
    assert.equal(r.contexto.ultimaAccionSugerida, "ofrecer_portal");
  });

  it("quién hace Dipping: consulta profesionales reales elegibles, sin IA", async () => {
    const r = await resolver("quien hace el dipping");
    assert.equal(r.requiereIA, false);
    assert.match(r.respuestaTexto!, /Mary/);
    assert.match(r.respuestaTexto!, /Jessica/);
  });

  it("servicio inexistente (Acrílicas): declara PRIMERO que no existe, y solo entonces ofrece opciones reales de uñas -- nunca 'claro que sí'", async () => {
    const r = await resolver("hacen acrílicas?");
    assert.equal(r.modo, "catalog");
    assert.match(r.respuestaTexto!, /no tenemos el servicio de acrílicas/i);
    assert.doesNotMatch(r.respuestaTexto ?? "", /^claro que sí/i);
    assert.match(r.respuestaTexto!, /Dipping|Uña|Press On|Retiro Semi/);
  });

  it("'Acrílicas' nunca aparece listado como si fuera un servicio real disponible", async () => {
    const r = await resolver("hacen acrílicas?");
    const nombresReales = CATALOGO.map((s) => s.nombre);
    assert.ok(!nombresReales.includes("Acrílicas"));
    // El propio texto de respuesta declara la ausencia, nunca la disponibilidad.
    assert.match(r.respuestaTexto!, /no tenemos el servicio de acrílicas/i);
  });

  it("FASE 1 (autorizado) -- intención de agendar ahora INICIA el agendamiento conversacional (070), ya no salta directo al portal (061 sigue sembrado, pero 070 gana por prioridad)", async () => {
    const r = await resolver("quiero agendar una cita");
    assert.equal(r.escenarioCodigo, "070_agendamiento");
    assert.equal(r.modo, "ai");
    assert.equal(r.requiereIA, true);
    assert.ok(r.contexto.agendamiento, "debe quedar un acumulador de agendamiento activo en el contexto");
    assert.equal(r.contexto.agendamiento?.servicioId, undefined, "todavía no mencionó ningún servicio");
  });

  it("continuidad contextual: 'sí' tras precio de Dipping salta directo al portal para ESE servicio, sin volver a preguntar", async () => {
    const previo = await resolver("cuánto cuesta el dipping");
    const r = await resolver("sí", previo.contexto, 1);
    assert.equal(r.modo, "portal");
    assert.match(r.respuestaTexto!, /dulabs\.co\/reservar\/amore/);
  });

  it("'sí' sin ningún contexto previo de reserva: respuesta genérica, nunca salta al portal por accidente", async () => {
    const r = await resolver("sí", contexto());
    assert.notEqual(r.modo, "portal");
  });

  it("categoría + presupuesto explícito: sigue siendo determinístico (sin IA), solo filtra las opciones reales por precio", async () => {
    const r = await resolver("quiero algo de uñas de máximo $10.000");
    assert.equal(r.modo, "catalog");
    assert.equal(r.requiereIA, false);
    assert.match(r.respuestaTexto!, /Uña|Retiro Semi/);
    assert.doesNotMatch(r.respuestaTexto ?? "", /Dipping|Press On/);
  });

  it("recomendación: SÍ requiere IA, y datosIA queda filtrado por presupuesto real (nunca el catálogo completo si el filtro reduce algo)", async () => {
    const r = await resolver("no sé qué hacerme, quiero algo bonito, tengo máximo $10.000");
    assert.equal(r.modo, "ai");
    assert.equal(r.requiereIA, true);
    const datos = r.datosIA as Array<{ nombre: string; precio: number }>;
    assert.ok(datos.every((d) => d.precio <= 10000));
    assert.ok(datos.some((d) => d.nombre === "Uña" || d.nombre === "Retiro Semi"));
  });

  it("transferencia a humano: modo=transfer, respuesta lista para enviar antes de transferir", async () => {
    const r = await resolver("quiero hablar con una persona");
    assert.equal(r.modo, "transfer");
    assert.equal(r.requiereIA, false);
    assert.ok(r.respuestaTexto);
  });

  it("horario del salón: dato real configurado, sin IA", async () => {
    const r = await resolver("qué horario tienen");
    assert.equal(r.requiereIA, false);
    assert.match(r.respuestaTexto!, /8:00 a\. m\. a 8:00 p\. m\./);
  });

  describe("BUG REAL (FASE B, prueba aislada Gemini): formulaciones naturales de horario que caían al fallback", () => {
    const formulaciones = [
      "¿Cuál es el horario?",
      "Cuál es el horario",
      "en qué horario atienden",
      "a qué hora cierran",
      "¿Atienden los domingos?",
      "atienden festivos",
    ];
    for (const mensaje of formulaciones) {
      it(`'${mensaje}' -> escenario 080_horario, nunca el fallback genérico`, async () => {
        const r = await resolver(mensaje);
        assert.equal(r.escenarioCodigo, "080_horario", `"${mensaje}" debería reconocerse como intención de horario`);
        assert.equal(r.requiereIA, false);
        assert.match(r.respuestaTexto!, /8:00 a\. m\. a 8:00 p\. m\./);
      });
    }
  });

  it("pregunta de dirección (dato NO configurado): intención propia, honesta, nunca cae al fallback de catálogo ni inventa una dirección", async () => {
    const r = await resolver("cuál es la dirección del salón");
    assert.equal(r.escenarioCodigo, "084_direccion", "debe reconocer la intención de dirección como propia, nunca el fallback genérico");
    assert.doesNotMatch(r.respuestaTexto ?? "", /calle|carrera|avenida/i);
    assert.doesNotMatch(r.respuestaTexto ?? "", /qué servicio/i, "nunca debe cambiar de tema hacia el catálogo");
  });

  it("otra información general no confirmada (redes/pagos/promociones): intención propia, honesta, nunca fallback de catálogo", async () => {
    const r = await resolver("tienen instagram?");
    assert.equal(r.escenarioCodigo, "090_info_general_no_disponible");
    assert.doesNotMatch(r.respuestaTexto ?? "", /qué servicio/i);
  });

  it("FASE 1 (autorizado) -- intención de agendar SIEMPRE gana sobre 'servicio específico', y además el servicio mencionado en el MISMO mensaje ya queda capturado en el acumulador", async () => {
    const r = await resolver("quiero agendar el dipping");
    assert.equal(r.escenarioCodigo, "070_agendamiento");
    assert.equal(r.modo, "ai");
    assert.equal(r.contexto.agendamiento?.servicioId, "s-dipping");
    assert.equal(r.contexto.agendamiento?.fechaISO, undefined, "todavía falta la fecha -- debe preguntarla, no inventarla");
  });

  it("dos preguntas en un mensaje (precio + quién lo hace): el escenario de mayor prioridad configurada responde ambas si su plantilla las cubre", async () => {
    const r = await resolver("cuanto cuesta el dipping y quien lo hace");
    // "quien hace" tiene mayor prioridad configurada (520 vs 500) -> gana ese escenario.
    assert.match(r.respuestaTexto!, /Mary/);
  });

  it("cambio de tema: de uñas a maquillaje se resuelve con datos de la categoría nueva, no se queda pegado", async () => {
    await resolver("quiero uñas");
    const r = await resolver("y cuánto cuesta el maquillaje suave");
    assert.match(r.respuestaTexto!, /Maquillaje Suave/);
  });

  describe("BUG REAL (prueba de WhatsApp): categoría 'uñas' NUNCA resuelve al servicio 'Uña'", () => {
    it("'Quiero arreglarme las uñas' -> conversación/categoría, NUNCA el servicio puntual 'Uña'", async () => {
      const r = await resolver("Quiero arreglarme las uñas");
      assert.equal(r.escenarioCodigo, "020_categoria_unas", "debe resolver como categoría, nunca como 028_servicio_info (servicio puntual)");
      // El bug real respondía "El Uña cuesta $8.000 y dura 15 min" (plantilla
      // de servicio ÚNICO); la categoría, en cambio, LISTA varias opciones
      // reales (Uña puede aparecer ahí, como una más entre varias -- eso es
      // correcto). Lo que nunca debe pasar es la plantilla de servicio único.
      assert.doesNotMatch(r.respuestaTexto ?? "", /^(Te cuento|¡Claro!).*El Uña /);
      assert.match(r.respuestaTexto!, /opciones reales/i);
    });

    it("'Qué tienen para uñas' -> opciones de la categoría", async () => {
      const r = await resolver("Qué tienen para uñas");
      assert.equal(r.escenarioCodigo, "020_categoria_unas");
      assert.equal(r.requiereIA, false);
    });

    it("'Quiero Uña' (mención inequívoca) SÍ resuelve como servicio puntual", async () => {
      const r = await resolver("Quiero el servicio Uña");
      assert.equal(r.modo, "catalog");
      assert.match(r.respuestaTexto!, /\$8\.000/);
    });
  });

  describe("BUG REAL (prueba de WhatsApp): comparación entre 2 servicios reales", () => {
    it("'Qué diferencia hay entre el dipping y press On?' -> compara ambos vía IA, NUNCA responde solo de uno", async () => {
      const r = await resolver("Qué diferencia hay entre el dipping y press On?");
      assert.equal(r.escenarioCodigo, "051_comparacion");
      assert.equal(r.modo, "ai");
      assert.equal(r.requiereIA, true);
      const datos = r.datosIA as Array<{ nombre: string; precio: number }>;
      assert.deepEqual(
        datos.map((d) => d.nombre).sort(),
        ["Dipping", "Press On"],
        "debe pasar AMBOS servicios reales a la IA, nunca solo el de nombre más largo",
      );
      assert.equal(datos.find((d) => d.nombre === "Dipping")?.precio, 60000);
      assert.equal(datos.find((d) => d.nombre === "Press On")?.precio, 80000);
    });

    it("nunca inventa diferencias técnicas: la IA solo recibe datos reales del catálogo + conocimiento general marcado con su fuente, nunca prosa inventada por el resolver", async () => {
      const r = await resolver("Dipping vs Press On");
      assert.equal(r.modo, "ai");
      const conocimiento = r.conocimientoGeneral as Array<{ servicio: string; fuente: string }>;
      assert.equal(conocimiento.length, 2, "debe llevar una entrada de conocimiento por cada servicio comparado");
      for (const c of conocimiento) {
        assert.ok(
          ["confirmado_amore", "conocimiento_general", "no_confirmado"].includes(c.fuente),
          `fuente de conocimiento inválida: ${c.fuente}`,
        );
      }
      // El resolver mismo nunca debe redactar la comparación -- eso es
      // exactamente lo que se delega a la IA (instruccionIA) para que nunca
      // se invente texto técnico fuera del dato real.
      assert.equal(r.respuestaTexto, undefined);
    });

    it("contexto: 'Me interesa el Dipping' + '¿Y el Press On?' -> reconoce comparación usando el contexto", async () => {
      const t1 = await resolver("Me interesa el Dipping");
      assert.equal(t1.contexto.ultimoServicioId, "s-dipping");

      const t2 = await resolver("¿Y el Press On?", t1.contexto, 1);
      assert.equal(t2.escenarioCodigo, "051_comparacion");
      assert.equal(t2.modo, "ai");
      const datosT2 = t2.datosIA as Array<{ nombre: string }>;
      assert.deepEqual(datosT2.map((d) => d.nombre).sort(), ["Dipping", "Press On"]);

      const t3 = await resolver("¿Cuál me recomiendas?", t2.contexto, 2);
      assert.equal(t3.modo, "ai");
      assert.equal(t3.requiereIA, true);
      const datos = t3.datosIA as Array<{ nombre: string }>;
      assert.deepEqual(
        datos.map((d) => d.nombre).sort(),
        ["Dipping", "Press On"],
        "la recomendación debe restringirse a los 2 servicios en comparación, nunca reabrir a todo el catálogo",
      );
    });

    it("cambio de tema real (categoría distinta) NUNCA se trata como comparación, aunque empiece con 'y'", async () => {
      const t1 = await resolver("Me interesa el Dipping");
      const t2 = await resolver("y también cuánto cuesta el maquillaje suave", t1.contexto, 1);
      assert.notEqual(t2.escenarioCodigo, "051_comparacion");
      assert.match(t2.respuestaTexto!, /Maquillaje Suave/);
      assert.doesNotMatch(t2.respuestaTexto ?? "", /Dipping/);
    });
  });

  it("todo escenario determinístico (deterministic/catalog/faq/portal/transfer) nunca requiere IA", async () => {
    const mensajes = [
      "Hola",
      "quiero arreglarme las unas",
      "cuánto cuesta el dipping",
      "quiero hablar con una persona",
      "qué horario tienen",
      "hacen acrílicas?",
    ];
    for (const mensaje of mensajes) {
      const r = await resolver(mensaje);
      assert.equal(r.requiereIA, false, `"${mensaje}" no debería requerir IA (escenario: ${r.escenarioCodigo})`);
    }
  });

  it("comparación (051) y explicación de servicio (029) SÍ requieren IA -- son las únicas 2 excepciones nuevas al camino determinístico", async () => {
    const comparacion = await resolver("Qué diferencia hay entre el dipping y press On?");
    assert.equal(comparacion.escenarioCodigo, "051_comparacion");
    assert.equal(comparacion.requiereIA, true);

    const explicacion = await resolver("¿Qué es el dipping?");
    assert.equal(explicacion.escenarioCodigo, "029_explicacion_servicio");
    assert.equal(explicacion.requiereIA, true);
  });

  describe("029_explicacion_servicio + conocimientoGeneral -- base de conocimiento (FASE B, integración)", () => {
    const FICHA_DIPPING: ConocimientoServicio = {
      servicioId: "s-dipping",
      fuente: "conocimiento_general",
      queEs: "El dipping es una técnica de esmaltado semipermanente con polvo.",
      paraQueSirve: "Busca un acabado duradero y resistente.",
      limites: "No afirmar marca, producto ni duración exacta del resultado.",
    };

    it("'¿Qué es el dipping?' con ficha sembrada: datosIA trae el hecho confirmado, conocimientoGeneral trae la ficha con su fuente real", async () => {
      const r = await resolver("¿Qué es el dipping?", {}, 0, [FICHA_DIPPING]);
      assert.equal(r.escenarioCodigo, "029_explicacion_servicio");
      assert.equal(r.modo, "ai");
      const datos = r.datosIA as Array<{ nombre: string; precio: number }>;
      assert.equal(datos.length, 1);
      assert.equal(datos[0]!.nombre, "Dipping");
      assert.equal(datos[0]!.precio, 60000, "el precio SIEMPRE viene de datosIA (catálogo real), nunca de la ficha de conocimiento");
      const conocimiento = r.conocimientoGeneral as Array<{ servicio: string; queEs: string | null; fuente: string }>;
      assert.equal(conocimiento.length, 1);
      assert.equal(conocimiento[0]!.servicio, "Dipping");
      assert.equal(conocimiento[0]!.queEs, FICHA_DIPPING.queEs);
      assert.equal(conocimiento[0]!.fuente, "conocimiento_general");
    });

    it("'¿Qué es el Press On?' SIN ficha sembrada: nunca inventa -- conocimientoGeneral queda honesto con fuente='no_confirmado' y todo null", async () => {
      const r = await resolver("¿Qué es el Press On?", {}, 0, [FICHA_DIPPING]);
      assert.equal(r.escenarioCodigo, "029_explicacion_servicio");
      const conocimiento = r.conocimientoGeneral as Array<{ servicio: string; queEs: string | null; paraQueSirve: string | null; limites: string | null; fuente: string }>;
      assert.equal(conocimiento.length, 1);
      assert.equal(conocimiento[0]!.servicio, "Press On");
      assert.equal(conocimiento[0]!.fuente, "no_confirmado");
      assert.equal(conocimiento[0]!.queEs, null);
      assert.equal(conocimiento[0]!.paraQueSirve, null);
      assert.equal(conocimiento[0]!.limites, null);
    });

    it("recomendación general (040) también adjunta conocimientoGeneral por candidato, alineado 1 a 1 con datosIA", async () => {
      const r = await resolver("no sé qué hacerme, ayúdame a escoger", {}, 0, [FICHA_DIPPING]);
      assert.equal(r.escenarioCodigo, "040_recomendacion");
      assert.equal(r.modo, "ai");
      const datos = r.datosIA as Array<{ nombre: string }>;
      const conocimiento = r.conocimientoGeneral as Array<{ servicio: string; fuente: string }>;
      assert.equal(datos.length, conocimiento.length, "conocimientoGeneral debe tener una entrada por cada servicio en datosIA, nunca menos");
      assert.deepEqual(datos.map((d) => d.nombre).sort(), conocimiento.map((c) => c.servicio).sort());
      const dipping = conocimiento.find((c) => c.servicio === "Dipping");
      assert.equal(dipping?.fuente, "conocimiento_general");
      const sinFicha = conocimiento.find((c) => c.servicio === "Uña");
      assert.equal(sinFicha?.fuente, "no_confirmado", "un servicio real sin ficha nunca inventa conocimiento, queda honesto");
    });

    it("conocimiento sembrado para un servicio_id que NO está en el catálogo cargado simplemente no se usa (nunca aparece, nunca rompe)", async () => {
      const fichaHuerfana: ConocimientoServicio = {
        servicioId: "s-no-existe-en-este-catalogo",
        fuente: "conocimiento_general",
        queEs: "nunca debería aparecer",
        paraQueSirve: "nunca debería aparecer",
        limites: "nunca debería aparecer",
      };
      const r = await resolver("¿Qué es el dipping?", {}, 0, [fichaHuerfana]);
      const conocimiento = r.conocimientoGeneral as Array<{ servicio: string; queEs: string | null }>;
      assert.equal(conocimiento[0]!.servicio, "Dipping");
      assert.equal(conocimiento[0]!.queEs, null, "la ficha huérfana (de un servicio que no está en el catálogo) nunca contamina otro servicio");
      assert.ok(!conocimiento.some((c) => c.queEs === "nunca debería aparecer"));
    });
  });
});
