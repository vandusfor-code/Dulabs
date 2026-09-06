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
import type { ContextoConversacional, EscenarioRow } from "@/lib/bot-escenarios/tipos";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";

const FAKE_SUPABASE = {} as SupabaseClient;
const TENANT = "amore-test";

const ESCENARIOS: EscenarioRow[] = AMORE_ESCENARIOS_SEED.map((s, i) => ({ ...s, id: `e${i}`, tenantId: TENANT }));

const CATALOGO: ServicioCatalogoReal[] = [
  { id: "s-dipping", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-una", nombre: "Uña", precio: 8000, duracionMin: 15, categoria: "Uñas", descripcion: null },
  { id: "s-pressón", nombre: "Press On", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s-retiro", nombre: "Retiro Semi", precio: 5000, duracionMin: 15, categoria: "Uñas", descripcion: null },
  { id: "s-maquillajesuave", nombre: "Maquillaje Suave", precio: 60000, duracionMin: 60, categoria: "Maquillaje", descripcion: null },
  { id: "s-cejascera", nombre: "Cejas con Cera", precio: 15000, duracionMin: 10, categoria: "Cejas", descripcion: null },
];

function contexto(overrides: Partial<ContextoConversacional> = {}): ContextoConversacional {
  return { ...overrides };
}

async function resolver(mensaje: string, ctx: ContextoConversacional = {}, turno = 0) {
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

  it("servicio inexistente (Acrílicas): NUNCA inventa -- cae a las opciones reales de uñas (sinónimo configurado)", async () => {
    const r = await resolver("quiero acrílicas");
    assert.equal(r.modo, "catalog");
    assert.doesNotMatch(r.respuestaTexto ?? "", /[Aa]crílicas/);
    assert.match(r.respuestaTexto!, /Dipping|Uña|Press On|Retiro Semi/);
  });

  it("intención de agendar: modo=portal, enlace real, nunca pide fecha", async () => {
    const r = await resolver("quiero agendar una cita");
    assert.equal(r.modo, "portal");
    assert.equal(r.requiereIA, false);
    assert.match(r.respuestaTexto!, /dulabs\.co\/reservar\/amore/);
    assert.doesNotMatch(r.respuestaTexto ?? "", /fecha|qué día/i);
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

  it("pregunta sobre algo NO configurado (ubicación): fallback honesto, nunca inventa una dirección", async () => {
    const r = await resolver("cuál es la dirección del salón");
    assert.equal(r.escenarioCodigo, "000_fallback");
    assert.doesNotMatch(r.respuestaTexto ?? "", /calle|carrera|avenida/i);
  });

  it("intención de agendar SIEMPRE gana sobre 'servicio específico', aunque el mensaje nombre un servicio real", async () => {
    const r = await resolver("quiero agendar el dipping");
    assert.equal(r.modo, "portal");
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
});
