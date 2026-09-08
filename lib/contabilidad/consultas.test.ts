/**
 * Contabilidad (Fase 10, genérico) -- buscarCitasCompletadas. FASE 3
 * (autorizado, multi-servicio AMORE) agregó la regla de `precio_total`: este
 * archivo prueba EXCLUSIVAMENTE esa regla (el resto de buscarCitasCompletadas
 * -- filtros por especialista/servicio/rango -- no cambió con esta fase).
 * NUNCA Supabase real: un fake mínimo de un solo `.from()` encadenado, mismo
 * patrón de esta suite.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarCitasCompletadas } from "@/lib/contabilidad/consultas";

const TENANT = "amore-test";

function crearSupabaseFalso(filas: Record<string, unknown>[]): SupabaseClient {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    gte() {
      return builder;
    },
    lt() {
      return builder;
    },
    order() {
      return builder;
    },
    then(resolve: (r: { data: Record<string, unknown>[]; error: null }) => unknown) {
      return resolve({ data: filas, error: null });
    },
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

const RANGO = { desde: new Date("2026-09-01T00:00:00-05:00"), hasta: new Date("2026-10-01T00:00:00-05:00") };

const FILA_BASE = {
  id: 4312,
  inicio: "2026-09-09T16:00:00.000Z",
  nombre_cliente: "Ana Pérez",
  servicio: "Sombreado de Cejas",
  servicio_id: "s-sombreado",
  precio_total: null as number | null,
  especialista_id: 1262,
  estado: "completada",
  dulabs_servicios: { nombre: "Sombreado de Cejas", precio: 30000 },
  dulabs_especialistas: { nombre: "Mary" },
};

describe("FASE 3 (autorizado, multi-servicio) -- regla de precio_total en buscarCitasCompletadas", () => {
  it("cita histórica de UN solo servicio (precio_total NULL) -- usa el precio del servicio vía la FK, comportamiento 100% idéntico al de antes de esta fase", async () => {
    const supabase = crearSupabaseFalso([{ ...FILA_BASE, precio_total: null }]);
    const filas = await buscarCitasCompletadas(supabase, { idTenant: TENANT, rango: RANGO });
    assert.equal(filas[0]!.precio, 30000);
  });

  it("cita multi-servicio real (precio_total = suma ya calculada) -- usa precio_total TAL CUAL, nunca lo vuelve a sumar con el precio del primer servicio", async () => {
    const supabase = crearSupabaseFalso([{ ...FILA_BASE, precio_total: 140000, dulabs_servicios: { nombre: "Dipping", precio: 60000 } }]);
    const filas = await buscarCitasCompletadas(supabase, { idTenant: TENANT, rango: RANGO });
    assert.equal(filas[0]!.precio, 140000, "nunca 140000 + 60000 -- precio_total YA es el total real de la combinación");
  });

  it("cita sin precio_total y sin precio de servicio configurado (ambos null) -- nunca inventa un valor, precio queda null", async () => {
    const supabase = crearSupabaseFalso([{ ...FILA_BASE, precio_total: null, dulabs_servicios: { nombre: "Sombreado de Cejas", precio: null } }]);
    const filas = await buscarCitasCompletadas(supabase, { idTenant: TENANT, rango: RANGO });
    assert.equal(filas[0]!.precio, null);
  });

  it("precio_total = 0 (edge case explícito, nunca confundido con 'sin valor') se respeta tal cual, nunca cae al fallback del servicio", async () => {
    const supabase = crearSupabaseFalso([{ ...FILA_BASE, precio_total: 0 }]);
    const filas = await buscarCitasCompletadas(supabase, { idTenant: TENANT, rango: RANGO });
    assert.equal(filas[0]!.precio, 0, "0 !== null -- el operador ?? no debe caer al fallback para un total real de 0");
  });
});
