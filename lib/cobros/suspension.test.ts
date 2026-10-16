import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { olvidarSuspensiones, tenantSuspendidoPorPago, TTL_ERROR_MS, TTL_SUSPENSION_MS } from "./suspension";

/** Cliente mínimo: cuenta las consultas y devuelve lo que se le diga. */
function clienteFalso(respuesta: () => { data: unknown; error: { message: string } | null } | Promise<never>) {
  const consultas = { n: 0, tabla: "", columna: "", tenant: "" };
  const cliente = {
    from(tabla: string) {
      consultas.tabla = tabla;
      return {
        select(columna: string) {
          consultas.columna = columna;
          return {
            eq(_c: string, valor: string) {
              consultas.tenant = valor;
              return {
                async maybeSingle() {
                  consultas.n++;
                  return respuesta();
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { cliente, consultas };
}

describe("tenantSuspendidoPorPago", () => {
  afterEach(() => olvidarSuspensiones());

  it("true solo si la suscripción tiene la marca de suspensión", async () => {
    const suspendido = clienteFalso(() => ({ data: { suspendida_por_pago_at: "2026-10-30T14:00:00Z" }, error: null }));
    assert.equal(await tenantSuspendidoPorPago(suspendido.cliente, "T1"), true);
    assert.deepEqual([suspendido.consultas.tabla, suspendido.consultas.columna, suspendido.consultas.tenant], ["dulabs_suscripciones", "suspendida_por_pago_at", "T1"]);
    olvidarSuspensiones();
    assert.equal(await tenantSuspendidoPorPago(clienteFalso(() => ({ data: { suspendida_por_pago_at: null }, error: null })).cliente, "T2"), false);
  });

  it("un negocio sin suscripción (la mayoría de los números de prueba, o AMORE antes de configurarlo) NO está suspendido", async () => {
    assert.equal(await tenantSuspendidoPorPago(clienteFalso(() => ({ data: null, error: null })).cliente, "T1"), false);
  });

  it("recuerda la respuesta unos segundos (una sola consulta para una ráfaga de mensajes) y luego vuelve a preguntar", async () => {
    const { cliente, consultas } = clienteFalso(() => ({ data: { suspendida_por_pago_at: null }, error: null }));
    const t0 = 1_000_000;
    await tenantSuspendidoPorPago(cliente, "T1", t0);
    await tenantSuspendidoPorPago(cliente, "T1", t0 + TTL_SUSPENSION_MS - 1);
    assert.equal(consultas.n, 1);
    await tenantSuspendidoPorPago(cliente, "T1", t0 + TTL_SUSPENSION_MS + 1);
    assert.equal(consultas.n, 2);
  });

  it("cada negocio tiene su propia respuesta recordada", async () => {
    const filas: Record<string, boolean> = { T1: true, T2: false };
    let ultimo = "";
    const cliente = {
      from: () => ({ select: () => ({ eq: (_c: string, v: string) => ({ maybeSingle: async () => ((ultimo = v), { data: { suspendida_por_pago_at: filas[v] ? "x" : null }, error: null }) }) }) }),
    } as unknown as SupabaseClient;
    assert.equal(await tenantSuspendidoPorPago(cliente, "T1"), true);
    assert.equal(await tenantSuspendidoPorPago(cliente, "T2"), false);
    assert.equal(await tenantSuspendidoPorPago(cliente, "T1"), true);
    assert.equal(ultimo, "T2", "T1 salió de la memoria, no de otra consulta");
  });

  it("FALLA ABIERTO: con error de la base (p. ej. falta la migración) el bot sigue respondiendo y no se insiste en cada mensaje", async () => {
    const { cliente, consultas } = clienteFalso(() => ({ data: null, error: { message: 'column "suspendida_por_pago_at" does not exist' } }));
    const t0 = 5_000_000;
    assert.equal(await tenantSuspendidoPorPago(cliente, "T1", t0), false);
    assert.equal(await tenantSuspendidoPorPago(cliente, "T1", t0 + 10_000), false);
    assert.equal(consultas.n, 1, "no repite la consulta fallida en cada mensaje");
    await tenantSuspendidoPorPago(cliente, "T1", t0 + TTL_ERROR_MS + 1);
    assert.equal(consultas.n, 2, "pero reintenta pasado un rato (por si la migración ya corrió)");
  });

  it("FALLA ABIERTO: si la consulta lanza una excepción, tampoco corta el servicio", async () => {
    const { cliente } = clienteFalso(() => Promise.reject(new Error("red caída")) as Promise<never>);
    assert.equal(await tenantSuspendidoPorPago(cliente, "T1"), false);
  });

  it("olvidarSuspensiones(idTenant) hace que la próxima pregunta vaya a la base (cuando se sabe que la marca cambió)", async () => {
    let suspendida: string | null = "x";
    const { cliente, consultas } = clienteFalso(() => ({ data: { suspendida_por_pago_at: suspendida }, error: null }));
    assert.equal(await tenantSuspendidoPorPago(cliente, "T1"), true);
    suspendida = null;
    assert.equal(await tenantSuspendidoPorPago(cliente, "T1"), true, "todavía recordado");
    olvidarSuspensiones("T1");
    assert.equal(await tenantSuspendidoPorPago(cliente, "T1"), false);
    assert.equal(consultas.n, 2);
  });
});
