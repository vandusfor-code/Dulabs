/**
 * Cobros manuales — la activación manual de una suscripción (activarSuscripcionManual) guarda los datos de cobro SOLO cuando se piden y nunca borra los que ya había.
 * Supabase EN MEMORIA: nada toca la base real.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { activarSuscripcionManual } from "@/lib/suscripcion-domain";
import { supabaseAdmin } from "@/lib/supabase";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";

const T = "aaaaaaaa-0000-4000-8000-0000000000a1";
let db: SupabaseMemoria;
const fila = () => db.rows("dulabs_suscripciones").find((f) => f.id_tenant === T)!;
const base = { idTenant: T, plan: "start", precioCop: 39900, correo: "cliente@prueba.test" };

beforeEach(() => {
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  db.table("dulabs_suscripciones", { identity: "id", unique: [["id_tenant"]] });
});
afterEach(() => db.uninstall());

describe("activarSuscripcionManual — datos de cobro", () => {
  it("guarda el teléfono, el nombre del saludo y el día de cobro cuando se piden", async () => {
    const r = await activarSuscripcionManual(supabaseAdmin(), { ...base, telefonoCobro: "573001234567", nombreCobro: "AMORE", diaCobro: 30 });
    assert.equal(r.ok, true);
    assert.deepEqual([fila().telefono_cobro, fila().nombre_cobro, fila().dia_cobro], ["573001234567", "AMORE", 30]);
    assert.deepEqual([fila().estado, fila().cortesia, fila().wompi_payment_source_id, fila().precio_cop], ["activa", false, null, 39900]);
  });

  it("sin datos de cobro NO escribe esas columnas (la activación de siempre queda exactamente igual)", async () => {
    await activarSuscripcionManual(supabaseAdmin(), base);
    for (const columna of ["telefono_cobro", "nombre_cobro", "dia_cobro", "suspendida_por_pago_at"]) {
      assert.equal(columna in fila(), false, `${columna} no debía escribirse`);
    }
  });

  it("reactivar a mano NO borra el teléfono, el nombre ni el día que la suscripción ya tenía", async () => {
    await activarSuscripcionManual(supabaseAdmin(), { ...base, telefonoCobro: "573001234567", nombreCobro: "AMORE", diaCobro: 30 });
    await activarSuscripcionManual(supabaseAdmin(), { ...base, precioCop: 39990 });
    assert.deepEqual([fila().telefono_cobro, fila().nombre_cobro, fila().dia_cobro, fila().precio_cop], ["573001234567", "AMORE", 30, 39990]);
  });

  it("un valor vacío o nulo tampoco borra nada", async () => {
    await activarSuscripcionManual(supabaseAdmin(), { ...base, telefonoCobro: "573001234567", diaCobro: 30 });
    await activarSuscripcionManual(supabaseAdmin(), { ...base, telefonoCobro: null, nombreCobro: "", diaCobro: null });
    assert.deepEqual([fila().telefono_cobro, fila().dia_cobro], ["573001234567", 30]);
  });
});
