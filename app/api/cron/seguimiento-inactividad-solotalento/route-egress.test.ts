/**
 * Egress de Supabase -- el cron de inactividad de SOLOTALENTO se dispara cada pocos segundos (QStash) y antes traía hasta 200
 * filas COMPLETAS de dulabs_flow_executions en cada pasada (las ya avisadas se descartaban en JavaScript). Estas pruebas
 * (offline, con un Supabase falso que registra cada consulta) fijan el contrato: columnas mínimas, filtro en SQL de las ya
 * avisadas, filas completas SOLO para lo pendiente, y respaldo si el servidor rechaza el filtro.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ejecutarSeguimientoInactividadSolotalento } from "@/app/api/cron/seguimiento-inactividad-solotalento/route";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PHONE = "pn-test";
const OPTS = { tenantId: TENANT, phoneNumberId: PHONE, mensaje: "aviso", duracionMs: 5 * 60_000 };

type Fila = Record<string, unknown>;
interface Consulta { tabla: string; select?: string; or?: string; inn?: [string, unknown[]]; limit?: number; eq: Array<[string, unknown]> }

function fila(id: string, avisada: boolean): Fila {
  return {
    tenant_id: TENANT, id, flow_id: "f", flow_version_id: "v", execution_id: `x-${id}`, phone_number_id: PHONE, telefono_cliente: "573001112233",
    status: "waiting_input", current_node_id: "q", variables: { grande: "x".repeat(2000) }, expected_input: "text", pending_effect: null,
    exports: { lead: {}, custom_fields: {}, webhook_body: {} }, metadata: avisada ? { pausaInactividadEnviada: true } : {}, state_version: 1,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", last_activity_at: "2026-01-01T00:00:00Z",
  };
}

/** Supabase falso: registra cada consulta y responde según su FORMA (columnas / filtro or / in). */
function falso(opts: { filas: Fila[]; rechazaOr?: boolean; errorTotal?: boolean }) {
  const consultas: Consulta[] = [];
  const from = (tabla: string) => {
    const c: Consulta = { tabla, eq: [] };
    consultas.push(c);
    const b: Record<string, unknown> = {
      select: (cols: string) => ((c.select = cols), b),
      eq: (col: string, v: unknown) => (c.eq.push([col, v]), b),
      lte: () => b,
      or: (expr: string) => ((c.or = expr), b),
      in: (col: string, arr: unknown[]) => ((c.inn = [col, arr]), b),
      limit: (n: number) => ((c.limit = n), b),
      update: () => b,
      maybeSingle: async () => ({ data: tabla === "dulabs_clientes_config" ? { id_tenant: TENANT, phone_number_id: PHONE, nombre_negocio: "Solo Talento", meta_permanent_token: null } : null, error: null }),
      then: (resolve: (r: { data: Fila[] | null; error: { message: string } | null }) => unknown) => {
        if (opts.errorTotal) return resolve({ data: null, error: { message: "boom" } });
        if (tabla !== "dulabs_flow_executions") return resolve({ data: [], error: null });
        if (c.or && opts.rechazaOr) return resolve({ data: null, error: { message: "filtro no soportado" } });
        let data = opts.filas;
        if (c.or) data = data.filter((f) => (f.metadata as Record<string, unknown>).pausaInactividadEnviada !== true); // lo que haría el SQL
        if (c.inn) data = data.filter((f) => c.inn![1].includes(f.id));
        // Devuelve solo las columnas pedidas (como PostgREST).
        if (c.select && c.select !== "*") {
          const cols = c.select.split(",").map((x) => x.trim());
          data = data.map((f) => Object.fromEntries(cols.map((k) => [k, f[k]])));
        }
        return resolve({ data, error: null });
      },
    };
    return b;
  };
  return { supabase: { from } as unknown as SupabaseClient, consultas };
}

let tokenOriginal: string | undefined;
beforeEach(() => {
  // Sin token de Meta, enviarWhatsApp no llama a la red (sale antes): la prueba nunca envía nada real.
  tokenOriginal = process.env.META_ACCESS_TOKEN;
  delete process.env.META_ACCESS_TOKEN;
});
afterEach(() => {
  if (tokenOriginal !== undefined) process.env.META_ACCESS_TOKEN = tokenOriginal;
});

describe("cron de inactividad SOLOTALENTO — egress", () => {
  it("1. régimen normal (200 ejecuciones ya avisadas): UNA consulta con columnas mínimas y filtro en SQL; cero filas completas", async () => {
    const filas = Array.from({ length: 200 }, (_, i) => fila(`e${i}`, true));
    const { supabase, consultas } = falso({ filas });
    const r = await ejecutarSeguimientoInactividadSolotalento(supabase, OPTS);
    assert.deepEqual(r, { enviados: 0, errores: [] });
    assert.equal(consultas.length, 1, "no hay segunda consulta ni lectura de la config del cliente");
    assert.equal(consultas[0]!.select, "id, metadata", "NUNCA select('*') en el barrido");
    assert.match(consultas[0]!.or ?? "", /pausaInactividadEnviada\.is\.null,.*pausaInactividadEnviada\.neq\.true/, "las ya avisadas se filtran en SQL");
    assert.equal(consultas[0]!.limit, 200);
  });

  it("2. con una ejecución PENDIENTE: filas completas SOLO de esa (por id, y acotadas al tenant)", async () => {
    const filas = [...Array.from({ length: 150 }, (_, i) => fila(`viejo${i}`, true)), fila("nueva", false)];
    const { supabase, consultas } = falso({ filas });
    const r = await ejecutarSeguimientoInactividadSolotalento(supabase, OPTS);
    assert.equal(r.enviados, 1);
    const completas = consultas.filter((c) => c.tabla === "dulabs_flow_executions" && c.select === "*");
    assert.equal(completas.length, 1);
    assert.deepEqual(completas[0]!.inn, ["id", ["nueva"]], "solo la pendiente; las 150 avisadas no se descargan");
    assert.ok(completas[0]!.eq.some(([c, v]) => c === "tenant_id" && v === TENANT), "aislamiento por tenant");
  });

  it("3. si el servidor rechaza el filtro en SQL, se sigue SIN él (columnas mínimas + filtro local): nunca se cae el cron", async () => {
    const filas = [fila("a", true), fila("b", false)];
    const { supabase, consultas } = falso({ filas, rechazaOr: true });
    const r = await ejecutarSeguimientoInactividadSolotalento(supabase, OPTS);
    assert.equal(r.enviados, 1, "b está pendiente");
    const barridos = consultas.filter((c) => c.select === "id, metadata");
    assert.equal(barridos.length, 2, "primero con el filtro, luego el respaldo sin él");
    assert.equal(barridos[1]!.or, undefined);
    assert.ok(consultas.filter((c) => c.tabla === "dulabs_flow_executions").every((c) => c.select !== "*" || c.inn), "las filas completas de ejecuciones siempre por id");
  });

  it("4. error real de la base: se reporta (no lanza) y no se hacen más consultas", async () => {
    const { supabase, consultas } = falso({ filas: [], errorTotal: true });
    const r = await ejecutarSeguimientoInactividadSolotalento(supabase, OPTS);
    assert.equal(r.enviados, 0);
    assert.match(r.errores[0] ?? "", /consulta dulabs_flow_executions: boom/);
    assert.ok(consultas.length <= 2, "a lo sumo el barrido y su respaldo");
  });
});
