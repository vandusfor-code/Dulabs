/**
 * Cron de cobros manuales — la RUTA real (autorización, modo por variable de entorno, migración pendiente) contra un Supabase EN MEMORIA.
 * Nada toca Supabase real ni Meta: en modo activo el número de Dulabs NO está configurado en la base de prueba, así que el envío falla de forma controlada y nunca sale a la red.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";
process.env.CRON_SECRET = "secreto-de-cron-de-prueba";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { olvidarSuspensiones } from "@/lib/cobros/suspension";
import { GET, POST } from "./route";

const AMORE = "aaaaaaaa-0000-4000-8000-0000000000a1";
const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

let db: SupabaseMemoria;
const peticion = (metodo: "GET" | "POST", token: string | null) =>
  new NextRequest("http://localhost/api/cron/cobros-manuales", { method: metodo, headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => {
  olvidarSuspensiones();
  delete process.env.COBROS_MANUALES_MODO;
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  db.table("dulabs_cobros_ciclos", { identity: "id", unique: [["id_tenant", "fecha_cobro"]] });
  db.table("dulabs_clientes_config");
  db.table("dulabs_suscripciones").push({
    id_tenant: AMORE, plan: "start", precio_cop: 39990, estado: "activa", cortesia: false, wompi_payment_source_id: null,
    fecha_proximo_cobro: ayer, telefono_cobro: "573001234567", nombre_cobro: "AMORE", suspendida_por_pago_at: null,
  });
});
afterEach(() => {
  db.uninstall();
  delete process.env.COBROS_MANUALES_MODO;
});

describe("GET/POST /api/cron/cobros-manuales", () => {
  it("rechaza sin credencial o con una incorrecta (401) y no toca nada", async () => {
    for (const token of [null, "otro-secreto", ""]) {
      const r = await GET(peticion("GET", token));
      assert.equal(r.status, 401, String(token));
    }
    assert.equal(db.rows("dulabs_cobros_ciclos").length, 0);
    assert.equal(db.rows("dulabs_suscripciones")[0]!.suspendida_por_pago_at, null);
  });

  it("sin COBROS_MANUALES_MODO (o con cualquier valor que no sea «activo») es SIMULACIÓN: dice qué haría y no cambia nada", async () => {
    for (const modo of [undefined, "", "simulacion", "si", "true"]) {
      if (modo === undefined) delete process.env.COBROS_MANUALES_MODO;
      else process.env.COBROS_MANUALES_MODO = modo;
      const r = await GET(peticion("GET", process.env.CRON_SECRET!));
      assert.equal(r.status, 200);
      const cuerpo = (await r.json()) as { modo: string; hoy: string; revisadas: number; acciones: { cliente: string; telefono: string; accion: string; simulado: boolean }[] };
      assert.equal(cuerpo.modo, "simulacion", String(modo));
      assert.deepEqual(cuerpo.acciones.map((a) => [a.cliente, a.telefono, a.accion, a.simulado]), [["AMORE", "…4567", "avisar", true]]);
      assert.equal(r.headers.get("cache-control"), "no-store");
    }
    assert.equal(db.rows("dulabs_cobros_ciclos").length, 0, "la simulación no deja ni un ciclo");
    assert.equal(db.rows("dulabs_suscripciones")[0]!.suspendida_por_pago_at, null);
  });

  it("una suscripción que todavía no vence no sale ni en la simulación", async () => {
    db.rows("dulabs_suscripciones")[0]!.fecha_proximo_cobro = "2999-01-01";
    const cuerpo = (await (await GET(peticion("GET", process.env.CRON_SECRET!))).json()) as { revisadas: number; acciones: unknown[] };
    assert.deepEqual([cuerpo.revisadas, cuerpo.acciones], [0, []]);
  });

  it("en modo ACTIVO suspende al que venció sin pagar y deja el ciclo; si el envío no puede salir, el fallo queda guardado (y el bot sigue suspendido)", async () => {
    process.env.COBROS_MANUALES_MODO = "activo";
    const r = await POST(peticion("POST", process.env.CRON_SECRET!));
    assert.equal(r.status, 200);
    const cuerpo = (await r.json()) as { modo: string; acciones: { accion: string; suspendido: boolean; resultado: string; motivo: string }[] };
    assert.equal(cuerpo.modo, "activo");
    assert.deepEqual([cuerpo.acciones[0]!.accion, cuerpo.acciones[0]!.suspendido, cuerpo.acciones[0]!.resultado], ["avisar", true, "fallido"]);
    assert.match(cuerpo.acciones[0]!.motivo, /sin_credenciales: numero_dulabs_no_encontrado/);
    assert.ok(db.rows("dulabs_suscripciones")[0]!.suspendida_por_pago_at, "quedó suspendida");
    const ciclo = db.rows("dulabs_cobros_ciclos")[0]!;
    assert.deepEqual([ciclo.id_tenant, ciclo.fecha_cobro, ciclo.estado, ciclo.intentos], [AMORE, ayer, "fallido", 1]);
  });

  it("no revela ni el teléfono completo ni credenciales en la respuesta", async () => {
    process.env.COBROS_MANUALES_MODO = "activo";
    const texto = await (await GET(peticion("GET", process.env.CRON_SECRET!))).text();
    assert.doesNotMatch(texto, /573001234567/);
    assert.doesNotMatch(texto, /service-role|secreto-de-cron/);
  });

  it("sin la migración responde 200 con «migracion_pendiente» (no es un fallo del cron: no hay nada que reintentar)", async () => {
    db.missing("dulabs_suscripciones");
    const r = await GET(peticion("GET", process.env.CRON_SECRET!));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { modo: "simulacion", estado: "migracion_pendiente" });
  });

  it("hoy en Colombia: un cobro de HOY ya cuenta como vencido", async () => {
    db.rows("dulabs_suscripciones")[0]!.fecha_proximo_cobro = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
    const cuerpo = (await (await GET(peticion("GET", process.env.CRON_SECRET!))).json()) as { revisadas: number };
    assert.equal(cuerpo.revisadas, 1);
  });
});
