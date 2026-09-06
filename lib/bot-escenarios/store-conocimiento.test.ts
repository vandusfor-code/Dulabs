/**
 * cargarConocimientoReal (lib/bot-escenarios/store.ts) -- sección 21.G del
 * pedido de integración de base de conocimiento (seguridad/aislamiento
 * multi-tenant). Nunca contra Supabase real: un cliente Supabase FALSO
 * registra exactamente qué filtros se piden (tenant_id, activo) y devuelve
 * solo las filas que "pertenecen" a ese tenant en la fixture -- así se
 * verifica que el store SIEMPRE filtra por tenant_id y por activo=true, y
 * que jamás podría devolver conocimiento de otro tenant.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cargarConocimientoReal } from "@/lib/bot-escenarios/store";

interface FilaFixture {
  tenant_id: string;
  servicio_id: string;
  fuente: string;
  que_es: string | null;
  para_que_sirve: string | null;
  limites: string | null;
  activo: boolean;
}

function crearSupabaseFalso(filas: FilaFixture[]): { supabase: SupabaseClient; filtrosAplicados: Record<string, unknown>[] } {
  const filtrosAplicados: Record<string, unknown>[] = [];
  const filtros: Record<string, unknown> = {};

  const builder = {
    select() {
      return builder;
    },
    eq(campo: string, valor: unknown) {
      filtros[campo] = valor;
      filtrosAplicados.push({ ...filtros });
      return builder;
    },
    then(resolve: (r: { data: FilaFixture[]; error: null }) => unknown) {
      const data = filas.filter((f) => Object.entries(filtros).every(([k, v]) => (f as unknown as Record<string, unknown>)[k] === v));
      return resolve({ data, error: null });
    },
  };

  const supabase = {
    from() {
      return builder;
    },
  } as unknown as SupabaseClient;

  return { supabase, filtrosAplicados };
}

describe("cargarConocimientoReal — aislamiento multi-tenant real", () => {
  const FILAS: FilaFixture[] = [
    { tenant_id: "amore", servicio_id: "s-dipping", fuente: "conocimiento_general", que_es: "X", para_que_sirve: "Y", limites: "Z", activo: true },
    { tenant_id: "amore", servicio_id: "s-inactivo", fuente: "conocimiento_general", que_es: "A", para_que_sirve: "B", limites: "C", activo: false },
    { tenant_id: "otro-tenant", servicio_id: "s-dipping", fuente: "conocimiento_general", que_es: "NUNCA", para_que_sirve: "NUNCA", limites: "NUNCA", activo: true },
  ];

  it("nunca devuelve conocimiento de otro tenant, aunque comparta el mismo servicio_id", async () => {
    const { supabase } = crearSupabaseFalso(FILAS);
    const resultado = await cargarConocimientoReal(supabase, "amore");
    assert.equal(resultado.length, 1);
    assert.equal(resultado[0]!.queEs, "X");
    assert.ok(!resultado.some((r) => r.queEs === "NUNCA"), "conocimiento de otro tenant se filtró por completo");
  });

  it("filtra siempre por tenant_id Y por activo=true (nunca trae fichas desactivadas)", async () => {
    const { supabase, filtrosAplicados } = crearSupabaseFalso(FILAS);
    await cargarConocimientoReal(supabase, "amore");
    const ultimoFiltro = filtrosAplicados.at(-1)!;
    assert.equal(ultimoFiltro.tenant_id, "amore");
    assert.equal(ultimoFiltro.activo, true);
  });

  it("un tenant sin ninguna ficha recibe un array vacío -- nunca un error, nunca datos de otro tenant", async () => {
    const { supabase } = crearSupabaseFalso(FILAS);
    const resultado = await cargarConocimientoReal(supabase, "tenant-sin-conocimiento");
    assert.deepEqual(resultado, []);
  });

  it("mapea fuente/queEs/paraQueSirve/limites tal cual, sin transformar ni inventar contenido", async () => {
    const { supabase } = crearSupabaseFalso(FILAS);
    const [ficha] = await cargarConocimientoReal(supabase, "amore");
    assert.deepEqual(ficha, {
      servicioId: "s-dipping",
      fuente: "conocimiento_general",
      queEs: "X",
      paraQueSirve: "Y",
      limites: "Z",
    });
  });
});
