/**
 * El envío de cada mensaje del flujo releía la fila COMPLETA de dulabs_clientes_config (96 KB en el tenant Dulabs: prompt, base de
 * conocimiento y una lista negra de miles de números que el envío no usa). Ahora pide solo las columnas que necesita, con respaldo a
 * select("*") si el esquema de ese entorno no las tuviera todas. Offline: Supabase falso que registra cada consulta.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COLUMNAS_CLIENTE_PARA_ENVIO, __reiniciarListaLivianaParaTests, resolverClienteDefault } from "@/lib/flow/executors/send-message-executor";

type Fila = Record<string, unknown>;
const COMPLETA: Fila = { id: "c1", id_tenant: "t1", phone_number_id: "pn1", nombre_negocio: "N", meta_permanent_token: "tok", prompt_sistema: "P".repeat(50), base_conocimiento: "B".repeat(50), ia_numeros_bloqueados: "1,2,3", ia_restringida_a: "573000000001" };

function falso(opts: { errorEnLiviana?: boolean; fila?: Fila | null }) {
  const selects: string[] = [];
  const from = () => {
    let cols = "";
    const b: Record<string, unknown> = {
      select: (c: string) => ((cols = c), selects.push(c), b),
      eq: () => b,
      maybeSingle: async () => {
        if (cols !== "*" && opts.errorEnLiviana) return { data: null, error: { message: "column does not exist" } };
        const fila = opts.fila === undefined ? COMPLETA : opts.fila;
        if (!fila) return { data: null, error: null };
        if (cols === "*") return { data: fila, error: null };
        const pedidas = cols.split(",").map((x) => x.trim());
        return { data: Object.fromEntries(pedidas.filter((k) => k in fila).map((k) => [k, fila[k]])), error: null };
      },
    };
    return b;
  };
  return { supabase: { from } as unknown as SupabaseClient, selects };
}

beforeEach(() => __reiniciarListaLivianaParaTests());

describe("resolverClienteDefault — fila liviana para el envío", () => {
  it("1. pide SOLO las columnas del envío (sin prompt, base de conocimiento ni lista negra) y deja esos campos en null", async () => {
    const { supabase, selects } = falso({});
    const c = await resolverClienteDefault(supabase, "pn1");
    assert.deepEqual(selects, [COLUMNAS_CLIENTE_PARA_ENVIO]);
    for (const pesada of ["prompt_sistema", "base_conocimiento", "base_conocimiento_nombre_archivo", "base_conocimiento_actualizado_at", "ia_numeros_bloqueados"]) {
      assert.ok(!COLUMNAS_CLIENTE_PARA_ENVIO.split(",").map((x) => x.trim()).includes(pesada), `${pesada} no debe pedirse`);
      assert.equal((c as unknown as Fila)[pesada], null);
    }
    // Lo que el envío SÍ usa llega intacto.
    assert.equal(c!.id_tenant, "t1");
    assert.equal(c!.phone_number_id, "pn1");
    assert.equal(c!.meta_permanent_token, "tok");
  });

  it("2. número sin fila => null", async () => {
    const { supabase } = falso({ fila: null });
    assert.equal(await resolverClienteDefault(supabase, "nope"), null);
  });

  it("3. si el esquema no tiene alguna columna: cae a select('*') y NO reintenta la lista liviana en cada mensaje", async () => {
    const { supabase, selects } = falso({ errorEnLiviana: true });
    const a = await resolverClienteDefault(supabase, "pn1");
    assert.equal(a!.prompt_sistema, COMPLETA.prompt_sistema, "con '*' llega la fila completa (comportamiento de siempre)");
    await resolverClienteDefault(supabase, "pn1");
    assert.deepEqual(selects, [COLUMNAS_CLIENTE_PARA_ENVIO, "*", "*"], "primero la liviana (falla), luego solo '*'");
  });

  it("4. la lista liviana incluye todo lo que el envío lee de la config (token, tenant, número, contadores, pausa)", () => {
    const cols = COLUMNAS_CLIENTE_PARA_ENVIO.split(",").map((x) => x.trim());
    for (const necesaria of ["id_tenant", "phone_number_id", "nombre_negocio", "meta_permanent_token", "whatsapp_business_account_id", "mensajes_usados_mes", "mes_actual", "plan", "estado_pausa", "ia_pausada", "flow_activo", "flow_id"]) {
      assert.ok(cols.includes(necesaria), necesaria);
    }
  });
});
