/**
 * FASE 3 (autorizado, multi-servicio) — pruebas de la intersección real de
 * elegibilidad. resolverEspecialistasElegiblesParaServicio está inyectado
 * con un fake en memoria -- ningún test toca Supabase real.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolverEspecialistasParaMultiServicio } from "@/lib/agenda-v2/multi-servicio";
import type { EspecialistaElegible, ResolucionEspecialistasServicio } from "@/lib/asignacion-categoria";

const MARY: EspecialistaElegible = { especialistaId: 1262, nombre: "Mary" };
const JESSICA: EspecialistaElegible = { especialistaId: 1265, nombre: "Jessica" };
const CRISTAL: EspecialistaElegible = { especialistaId: 1263, nombre: "Cristal" };

function crearFakeResolver(porServicio: Record<string, EspecialistaElegible[]>) {
  const llamadas: string[] = [];
  return {
    llamadas,
    resolverEspecialistas: async (_s: unknown, _idTenant: string, servicioId: string): Promise<ResolucionEspecialistasServicio> => {
      llamadas.push(servicioId);
      return { modo: "explicita", especialistas: porServicio[servicioId] ?? [] };
    },
  };
}

describe("Test 9 (obligatorio) -- resolverEspecialistasParaMultiServicio: intersección completa, parcial y vacía", () => {
  it("intersección COMPLETA -- ambos servicios los pueden hacer las mismas 2 profesionales", async () => {
    const fake = crearFakeResolver({ maquillaje: [MARY, JESSICA], pestanas: [MARY, JESSICA] });
    const r = await resolverEspecialistasParaMultiServicio({} as never, "amore-test", ["maquillaje", "pestanas"], { resolverEspecialistas: fake.resolverEspecialistas });
    assert.deepEqual(
      r.especialistas.map((e) => e.especialistaId),
      [1262, 1265],
    );
  });

  it("intersección PARCIAL -- solo Mary puede hacer ambos", async () => {
    const fake = crearFakeResolver({ maquillaje: [MARY, JESSICA], pestanas: [MARY, CRISTAL] });
    const r = await resolverEspecialistasParaMultiServicio({} as never, "amore-test", ["maquillaje", "pestanas"], { resolverEspecialistas: fake.resolverEspecialistas });
    assert.deepEqual(
      r.especialistas.map((e) => e.especialistaId),
      [1262],
    );
  });

  it("intersección VACÍA -- nadie puede hacer los 3 juntos -- NUNCA ofrece una combinación imposible", async () => {
    const fake = crearFakeResolver({ maquillaje: [MARY], pestanas: [JESSICA], peinado: [CRISTAL] });
    const r = await resolverEspecialistasParaMultiServicio({} as never, "amore-test", ["maquillaje", "pestanas", "peinado"], { resolverEspecialistas: fake.resolverEspecialistas });
    assert.deepEqual(r.especialistas, []);
  });

  it("3 servicios -- intersección real de los 3 conjuntos", async () => {
    const fake = crearFakeResolver({ a: [MARY, JESSICA, CRISTAL], b: [MARY, JESSICA], c: [MARY, JESSICA, CRISTAL] });
    const r = await resolverEspecialistasParaMultiServicio({} as never, "amore-test", ["a", "b", "c"], { resolverEspecialistas: fake.resolverEspecialistas });
    assert.deepEqual(
      r.especialistas.map((e) => e.especialistaId),
      [1262, 1265],
    );
  });

  it("con un solo servicioId -- devuelve EXACTAMENTE lo mismo que ese único resolver (comportamiento de un solo servicio 100% preservado)", async () => {
    const fake = crearFakeResolver({ maquillaje: [MARY, JESSICA] });
    const r = await resolverEspecialistasParaMultiServicio({} as never, "amore-test", ["maquillaje"], { resolverEspecialistas: fake.resolverEspecialistas });
    assert.deepEqual(
      r.especialistas.map((e) => e.especialistaId),
      [1262, 1265],
    );
    assert.equal(fake.llamadas.length, 1);
  });

  it("consulta cada servicio EXACTAMENTE una vez (nunca N llamadas redundantes)", async () => {
    const fake = crearFakeResolver({ a: [MARY], b: [MARY], c: [MARY] });
    await resolverEspecialistasParaMultiServicio({} as never, "amore-test", ["a", "b", "c"], { resolverEspecialistas: fake.resolverEspecialistas });
    assert.deepEqual(fake.llamadas.sort(), ["a", "b", "c"]);
  });
});
