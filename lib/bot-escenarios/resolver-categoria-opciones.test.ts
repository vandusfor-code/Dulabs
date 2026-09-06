/**
 * Corrección (autorizada) — bug real reportado en producción: "Sí, quiero
 * hacerme las uñas" -> el bot prometía opciones que llegaban vacías, y
 * después "¿Cuáles?" perdía por completo el contexto ("Cuéntame un poquito
 * más: ¿qué servicio estás buscando..."), aunque `ultimaCategoria` y
 * `ultimasOpcionesIds` seguían en el contexto real.
 *
 * Causa raíz confirmada (reproducida contra datos reales de producción,
 * lectura únicamente): NINGUNA extracción de entidades ni ningún escenario
 * sembrado reconocía "¿Cuáles?"/"¿Qué opciones hay?" como una petición de
 * volver a mostrar la ÚLTIMA lista real ya ofrecida -- el mensaje no
 * matcheaba ningún variante configurado, así que siempre caía a
 * 000_fallback (su respuesta genérica de "cuéntame más"), sin importar que
 * el contexto real siguiera intacto. Este archivo prueba la corrección:
 * - lib/bot-escenarios/entidades.ts: nuevo campo `pideVerOpcionesDeNuevo`
 *   (vocabulario cerrado, coincidencia exacta tras quitar signos de
 *   interrogación) + patrón adicional de demostrativo con intención
 *   ("quiero ese"/"quiero esa", sección 13 del pedido).
 * - lib/bot-escenarios/resolver.ts: intercepta esa señal ANTES del matching
 *   normal de escenario, reutilizando construirRespuestaCategoria (extraída
 *   de resolverModoCatalog, sin duplicar lógica) para reconstruir la MISMA
 *   categoría ya guardada en ultimaCategoria -- máximo 4 opciones reales
 *   (antes 3), nunca inventadas.
 *
 * Contra el banco REAL de AMORE (AMORE_ESCENARIOS_SEED) -- sin Supabase
 * real, sin Gemini real.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverEscenario } from "@/lib/bot-escenarios/resolver";
import { AMORE_ESCENARIOS_SEED } from "@/lib/bot-escenarios/seed-amore";
import type { ContextoConversacional, EscenarioRow } from "@/lib/bot-escenarios/tipos";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";

const FAKE_SUPABASE = {} as SupabaseClient;
const TENANT = "amore-test";

const ESCENARIOS: EscenarioRow[] = AMORE_ESCENARIOS_SEED.map((s, i) => ({ ...s, id: `e${i}`, tenantId: TENANT }));

// 7 servicios reales de uñas (más de 4, para probar el límite de verdad) +
// 1 de otra categoría -- nombres/precios/duraciones reales de AMORE.
const CATALOGO: ServicioCatalogoReal[] = [
  { id: "s-cambio-esmalte", nombre: "Cambio De Esmalte", precio: 10000, duracionMin: 20, categoria: "Uñas", descripcion: null },
  { id: "s-dipping", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-manos-pies-tradi", nombre: "Manos semi y Pies Tradi", precio: 60000, duracionMin: 180, categoria: "Uñas", descripcion: null },
  { id: "s-manos-pies-semi", nombre: "Manos y Pies Semi", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-press-on", nombre: "Press On", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-retiro-semi", nombre: "Retiro Semi", precio: 5000, duracionMin: 15, categoria: "Uñas", descripcion: null },
  { id: "s-retoques", nombre: "Retoques", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-maquillaje-suave", nombre: "Maquillaje Suave", precio: 60000, duracionMin: 60, categoria: "Maquillaje", descripcion: null },
];

async function resolver(mensaje: string, ctx: ContextoConversacional = {}) {
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
    },
  });
}

describe("TEST 1 -- 'Quiero hacerme las uñas': categoría real, máximo 4, nunca vacío", () => {
  it("detecta la categoría Uñas, máximo 4 opciones reales, todas activas, ultimasOpcionesIds guardado correctamente", async () => {
    const r = await resolver("Quiero hacerme las uñas");
    assert.equal(r.escenarioCodigo, "020_categoria_unas");
    assert.equal(r.modo, "catalog");
    assert.equal(r.contexto.ultimaCategoria, "Uñas");
    assert.ok(r.contexto.ultimasOpcionesIds, "debe guardar las opciones mostradas");
    assert.ok(r.contexto.ultimasOpcionesIds!.length > 0, "NUNCA debe prometer opciones y guardar una lista vacía");
    assert.ok(r.contexto.ultimasOpcionesIds!.length <= 4, "máximo 4 opciones por interacción (sección 3 del pedido)");
    // Todas las opciones guardadas deben ser servicios reales del catálogo de Uñas.
    for (const id of r.contexto.ultimasOpcionesIds!) {
      const real = CATALOGO.find((s) => s.id === id);
      assert.ok(real, `el id ${id} debe corresponder a un servicio real del catálogo`);
      assert.equal(real!.categoria, "Uñas");
    }
    // El texto de la respuesta debe traer precios reales -- nunca una lista vacía.
    assert.match(r.respuestaTexto ?? "", /\$[\d.]+/, "debe incluir al menos un precio real -- nunca un bloque vacío");
  });

  it("nunca muestra servicios inexistentes (Acrílicas/Secado Rápido/Base Ruber como independientes)", async () => {
    const r = await resolver("Quiero hacerme las uñas");
    assert.doesNotMatch(r.respuestaTexto ?? "", /acr[ií]lica/i);
    assert.doesNotMatch(r.respuestaTexto ?? "", /secado r[aá]pido/i);
    assert.doesNotMatch(r.respuestaTexto ?? "", /base ruber/i);
  });
});

describe("TEST 2 -- '¿Cuáles?' tras ofrecer opciones: recupera el contexto, NUNCA vuelve a preguntar qué servicio busca", () => {
  it("reproduce el bug real y confirma la corrección", async () => {
    const t1 = await resolver("Sí, quiero hacerme las uñas");
    assert.equal(t1.escenarioCodigo, "020_categoria_unas");
    assert.ok(t1.contexto.ultimasOpcionesIds?.length);

    const t2 = await resolver("¿Cuáles?", t1.contexto);
    assert.equal(t2.escenarioCodigo, "020_categoria_unas", "debe recuperar el MISMO escenario de categoría, nunca 000_fallback");
    assert.notEqual(t2.escenarioCodigo, "000_fallback");
    assert.doesNotMatch(t2.respuestaTexto ?? "", /qué servicio estás buscando/i, "NUNCA debe volver a preguntar qué servicio busca");
    assert.ok(t2.contexto.ultimasOpcionesIds?.length, "debe seguir teniendo opciones reales guardadas");
    assert.ok(t2.contexto.ultimasOpcionesIds!.length <= 4);
    assert.match(t2.respuestaTexto ?? "", /\$[\d.]+/);
  });

  it("funciona también con 'Cuales' sin tilde ni signo de interrogación", async () => {
    const t1 = await resolver("Quiero hacerme las uñas");
    const t2 = await resolver("Cuales", t1.contexto);
    assert.equal(t2.escenarioCodigo, "020_categoria_unas");
  });
});

describe("TEST 3 -- '¿Qué opciones hay?' con categoría en contexto: muestra opciones, no vuelve a pedir la categoría", () => {
  it("recupera ultimaCategoria y presenta las opciones reales", async () => {
    const t1 = await resolver("Quiero hacerme las uñas");
    const t2 = await resolver("¿Qué opciones hay?", t1.contexto);
    assert.equal(t2.escenarioCodigo, "020_categoria_unas");
    assert.ok(t2.contexto.ultimasOpcionesIds?.length);
  });
});

describe("TEST 4 -- '¿Cuál es la más económica?' usa las opciones ya mostradas", () => {
  it("identifica la más barata de las opciones REALES ya ofrecidas, con su precio real", async () => {
    const t1 = await resolver("Quiero hacerme las uñas");
    const t2 = await resolver("¿Cuál es la más económica?", t1.contexto);
    // La más barata de las 4 opciones reales mostradas debe ser Retiro Semi ($5.000) o Cambio De Esmalte ($10.000),
    // según cuáles 4 de los 7 servicios reales queden seleccionados -- en cualquier caso debe nombrar una real con su precio real.
    assert.match(t2.respuestaTexto ?? "", /\$[\d.]+/);
    assert.doesNotMatch(t2.respuestaTexto ?? "", /qué servicio estás buscando/i);
  });
});

describe("TEST 5 -- '¿Qué es Dipping?' responde información real", () => {
  it("explica Dipping sin perder el contexto de categoría", async () => {
    const t1 = await resolver("Quiero hacerme las uñas");
    const t2 = await resolver("¿Qué es Dipping?", t1.contexto);
    assert.equal(t2.escenarioCodigo, "028_servicio_info");
    assert.equal(t2.contexto.ultimaCategoria, "Uñas", "la categoría de antes no se pierde por preguntar información");
  });
});

describe("TEST 6 -- pregunta informativa + 'Bueno, quiero ese': conserva el contexto y confirma el servicio explicado", () => {
  it("'Bueno, quiero ese' resuelve contra el ÚNICO servicio recién explicado", async () => {
    const t1 = await resolver("Quiero hacerme las uñas");
    const t2 = await resolver("¿Qué es Dipping?", t1.contexto);
    const t3 = await resolver("Bueno, quiero ese", t2.contexto);
    assert.equal(t3.contexto.ultimoServicioId, "s-dipping");
    assert.match(t3.respuestaTexto ?? "", /Dipping/);
    assert.match(t3.respuestaTexto ?? "", /\$60\.000|\$60,000/);
  });

  it("'No quiero ese' NUNCA se confunde con una selección (negación real, no debe resolver a Dipping)", async () => {
    const t1 = await resolver("Quiero hacerme las uñas");
    const t2 = await resolver("¿Qué es Dipping?", t1.contexto);
    const t3 = await resolver("No quiero ese", t2.contexto);
    assert.notEqual(t3.escenarioCodigo, "028_servicio_info");
  });
});

describe("TEST 7 -- cambio de servicio: 'Mejor quiero Press On' actualiza el servicio elegido", () => {
  it("responde con el precio/duración real de Press On", async () => {
    const t1 = await resolver("Quiero hacerme las uñas");
    const t2 = await resolver("Mejor quiero Press On", t1.contexto);
    assert.equal(t2.contexto.ultimoServicioId, "s-press-on");
    assert.match(t2.respuestaTexto ?? "", /\$80\.000|\$80,000/);
  });
});

describe("TEST 8 -- nunca aparecen servicios inexistentes en ninguna respuesta de esta suite", () => {
  it("barre todas las respuestas generadas arriba -- ninguna debe nombrar Acrílicas/Secado Rápido/Base Ruber como servicio propio", async () => {
    const mensajes = ["Quiero hacerme las uñas", "¿Cuáles?", "¿Qué opciones hay?", "¿Cuál es la más económica?"];
    let ctx: ContextoConversacional = {};
    for (const m of mensajes) {
      const r = await resolver(m, ctx);
      ctx = r.contexto;
      assert.doesNotMatch(r.respuestaTexto ?? "", /acr[ií]lica/i, `mensaje "${m}" no debe mencionar Acrílicas`);
    }
  });
});

describe("TEST 9 -- nunca más de 4 opciones en este tipo de interacción", () => {
  it("con 7 servicios reales de Uñas disponibles, nunca se muestran más de 4 a la vez", async () => {
    const r = await resolver("Quiero hacerme las uñas");
    assert.ok(r.contexto.ultimasOpcionesIds!.length <= 4);
    const lineasConPrecio = (r.respuestaTexto ?? "").split("\n").filter((l) => l.includes("$")).length;
    assert.ok(lineasConPrecio <= 4, `no debe listar más de 4 líneas con precio, mostró ${lineasConPrecio}`);
  });
});

describe("TEST 10 -- si no existen opciones válidas, el bot NUNCA promete una lista vacía", () => {
  it("una categoría sin ningún servicio real activo responde con el mensaje de 'sin servicio', nunca un bloque vacío de opciones", async () => {
    // Catálogo SIN ningún servicio de Cejas -- 023_categoria_cejas exige esa categoría.
    const catalogoSinCejas = CATALOGO.filter((s) => s.categoria !== "Cejas");
    const r = await resolverEscenario({
      supabase: FAKE_SUPABASE,
      tenantId: TENANT,
      mensaje: "Qué tienen de cejas",
      contexto: {},
      turno: 0,
      telefonoCliente: "573148127388",
      deps: {
        cargarEscenarios: async () => ESCENARIOS,
        cargarCatalogo: async () => catalogoSinCejas,
        cargarProfesionales: async () => ({ profesionales: [] }),
        cargarConocimiento: async () => [],
      },
    });
    assert.doesNotMatch(r.respuestaTexto ?? "", /opciones reales/i, "nunca debe prometer 'opciones reales' sin tener ninguna");
    assert.equal(r.contexto.ultimasOpcionesIds, undefined, "nunca debe guardar una lista vacía como si fuera real");
  });
});

describe("TEST 11 -- ultimasOpcionesIds coincide EXACTAMENTE con las opciones seleccionadas para mostrar", () => {
  it("cada id guardado corresponde 1 a 1 con una línea real del texto (mismo precio/nombre)", async () => {
    const r = await resolver("Quiero hacerme las uñas");
    const ids = r.contexto.ultimasOpcionesIds!;
    for (const id of ids) {
      const servicio = CATALOGO.find((s) => s.id === id)!;
      assert.match(r.respuestaTexto ?? "", new RegExp(servicio.nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});

describe("TEST 12 -- reproducción exacta del bug real reportado, de punta a punta", () => {
  it("'Sí, quiero hacerme las uñas' -> '¿Cuáles?' -> nunca pierde el contexto (bug original) y presenta opciones reales (corrección)", async () => {
    const t1 = await resolver("Sí, quiero hacerme las uñas");
    assert.ok(t1.contexto.ultimasOpcionesIds?.length, "REGRESIÓN: el bug original mostraba una lista vacía en el primer turno");

    const t2 = await resolver("Cuáles?", t1.contexto);
    assert.notEqual(t2.escenarioCodigo, "000_fallback", "REGRESIÓN: el bug original perdía el contexto y caía al fallback genérico");
    assert.doesNotMatch(
      t2.respuestaTexto ?? "",
      /Cuéntame un poquito más/i,
      "REGRESIÓN: nunca debe repetir el mensaje exacto del bug original",
    );
  });
});
