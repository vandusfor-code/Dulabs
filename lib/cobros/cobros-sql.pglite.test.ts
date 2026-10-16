/**
 * Cobros manuales — el SQL REAL de la migración 20261213000000 contra un Postgres embebido (PGlite: Postgres compilado a WASM, en memoria; sin red, sin Docker y sin tocar ninguna base real).
 *
 * Se prueba lo que solo la base puede garantizar: restricciones, idempotencia de la migración, el pago manual atómico (un pago por ciclo, la fecha avanza el mismo día del mes
 * siguiente, la suspensión se levanta) y que el cliente web (anon / authenticated) no pueda ni leer el libro de ciclos ni registrar pagos. Negocios y teléfonos ficticios.
 */
import "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const MIGRACION = path.join(process.cwd(), "supabase", "migrations", "20261213000000_dulabs_cobros_manuales.sql");
const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";

/** Cómo está la base ANTES de la migración (en Supabase ya existe) + los privilegios por defecto que Supabase da a toda tabla/función nueva de `public`. */
const PREPARACION = `
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create table public.dulabs_suscripciones (
    id bigint generated always as identity primary key,
    id_tenant uuid not null,
    plan text not null,
    precio_cop integer not null,
    wompi_payment_source_id text,
    wompi_customer_email text not null default 'cliente@prueba.test',
    estado text not null default 'activa',
    fecha_proximo_cobro date not null,
    cortesia boolean not null default false,
    precio_negociado_cop integer,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint dulabs_suscripciones_tenant_unico unique (id_tenant)
  );
  create table public.dulabs_pagos (
    id bigint generated always as identity primary key,
    id_tenant uuid not null,
    wompi_transaction_id text not null unique,
    monto_cop integer not null,
    estado text not null,
    tipo text not null default 'suscripcion' check (tipo in ('suscripcion', 'marketplace')),
    marketplace_activacion_id bigint,
    plan text,
    created_at timestamptz not null default now()
  );
`;

let db: PGlite;

async function consulta<T = Record<string, unknown>>(texto: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(texto, params)).rows;
}

async function crearSuscripcion(
  tenant: string,
  datos: { fecha: string; precio?: number; diaCobro?: number | null; wompi?: string | null; cortesia?: boolean; estado?: string; suspendida?: boolean; telefono?: string | null },
): Promise<void> {
  await db.query(
    `insert into public.dulabs_suscripciones (id_tenant, plan, precio_cop, wompi_payment_source_id, estado, cortesia, fecha_proximo_cobro, dia_cobro, telefono_cobro, suspendida_por_pago_at)
     values ($1, 'start', $2, $3, $4, $5, $6::date, $7, $8, $9)`,
    [tenant, datos.precio ?? 39990, datos.wompi ?? null, datos.estado ?? "activa", datos.cortesia ?? false, datos.fecha, datos.diaCobro ?? null, datos.telefono ?? null, datos.suspendida ? new Date().toISOString() : null],
  );
}

const registrar = (tenant: string, fecha: string, monto: number | null = null, operador: string | null = "operador@prueba.test", nota: string | null = null) =>
  consulta<{ fecha_pagada: string; proximo_cobro: string; monto_registrado: number; pago_id_registrado: string; estaba_suspendida: boolean }>(
    `select to_char(fecha_pagada, 'YYYY-MM-DD') as fecha_pagada, to_char(proximo_cobro, 'YYYY-MM-DD') as proximo_cobro, monto_registrado, pago_id_registrado, estaba_suspendida
       from public.dulabs_cobro_registrar_pago($1::uuid, $2::date, $3::integer, $4::text, $5::text)`,
    [tenant, fecha, monto, operador, nota],
  );

const fechaDe = async (tenant: string) => (await consulta<{ f: string }>("select to_char(fecha_proximo_cobro, 'YYYY-MM-DD') as f from public.dulabs_suscripciones where id_tenant = $1", [tenant]))[0]!.f;

describe("cobros manuales — migración", () => {
  before(async () => {
    db = new PGlite();
    await db.exec(PREPARACION);
    await db.exec(readFileSync(MIGRACION, "utf8"));
  });
  after(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec("reset role; delete from public.dulabs_cobros_ciclos; delete from public.dulabs_pagos; delete from public.dulabs_suscripciones;");
  });

  it("es idempotente: aplicarla otra vez no falla ni cambia nada", async () => {
    await crearSuscripcion(T1, { fecha: "2026-10-30", diaCobro: 30, telefono: "573001234567" });
    await db.exec(readFileSync(MIGRACION, "utf8"));
    const filas = await consulta<{ dia_cobro: number; telefono_cobro: string }>("select dia_cobro, telefono_cobro from public.dulabs_suscripciones");
    assert.deepEqual(filas, [{ dia_cobro: 30, telefono_cobro: "573001234567" }]);
  });

  it("las columnas nuevas aceptan nulo: una suscripción existente sigue igual (nadie recibe nada por sorpresa)", async () => {
    await crearSuscripcion(T1, { fecha: "2026-10-30" });
    const [fila] = await consulta<Record<string, unknown>>("select telefono_cobro, nombre_cobro, dia_cobro, suspendida_por_pago_at from public.dulabs_suscripciones");
    assert.deepEqual(fila, { telefono_cobro: null, nombre_cobro: null, dia_cobro: null, suspendida_por_pago_at: null });
  });

  it("el teléfono de cobro solo admite dígitos con indicativo, y el día de cobro va de 1 a 31", async () => {
    for (const telefono of ["+573001234567", "3001234567 ", "57-300-1234567", "12345", "abc"]) {
      await assert.rejects(crearSuscripcion(T1, { fecha: "2026-10-30", telefono }), /telefono_cobro_ck/, `debía rechazar «${telefono}»`);
    }
    for (const dia of [0, 32, -1]) {
      await assert.rejects(crearSuscripcion(T1, { fecha: "2026-10-30", diaCobro: dia }), /dia_cobro_ck/, `debía rechazar el día ${dia}`);
    }
    await crearSuscripcion(T1, { fecha: "2026-10-30", telefono: "573001234567", diaCobro: 31 });
  });

  it("el libro de ciclos solo admite estados conocidos y un ciclo por tenant y fecha", async () => {
    await db.query("insert into public.dulabs_cobros_ciclos (id_tenant, fecha_cobro, monto_cop) values ($1, '2026-10-30', 39990)", [T1]);
    await assert.rejects(db.query("insert into public.dulabs_cobros_ciclos (id_tenant, fecha_cobro, monto_cop) values ($1, '2026-10-30', 39990)", [T1]), /dulabs_cobros_ciclos_unico/);
    await assert.rejects(db.query("insert into public.dulabs_cobros_ciclos (id_tenant, fecha_cobro, monto_cop, estado) values ($1, '2026-11-30', 39990, 'raro')", [T1]), /dulabs_cobros_ciclos_estado_ck/);
    await db.query("insert into public.dulabs_cobros_ciclos (id_tenant, fecha_cobro, monto_cop) values ($1, '2026-10-30', 39990) on conflict do nothing", [T2]);
  });
});

describe("cobros manuales — registrar un pago", () => {
  before(async () => {
    db = new PGlite();
    await db.exec(PREPARACION);
    await db.exec(readFileSync(MIGRACION, "utf8"));
  });
  after(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec("reset role; delete from public.dulabs_cobros_ciclos; delete from public.dulabs_pagos; delete from public.dulabs_suscripciones;");
  });

  it("registra el pago como cualquier otro (APPROVED, tipo suscripción, con el plan), mueve la fecha un mes, levanta la suspensión y deja el ciclo como pagado", async () => {
    await crearSuscripcion(T1, { fecha: "2026-10-30", precio: 39990, diaCobro: 30, suspendida: true });
    const [r] = await registrar(T1, "2026-10-30", null, "operador@prueba.test", "transferencia Bancolombia");
    assert.equal(r!.fecha_pagada, "2026-10-30");
    assert.equal(r!.proximo_cobro, "2026-11-30");
    assert.equal(r!.monto_registrado, 39990);
    assert.equal(r!.estaba_suspendida, true);

    const [sus] = await consulta<{ fecha: string; suspendida: string | null }>("select to_char(fecha_proximo_cobro, 'YYYY-MM-DD') as fecha, suspendida_por_pago_at as suspendida from public.dulabs_suscripciones where id_tenant = $1", [T1]);
    assert.deepEqual(sus, { fecha: "2026-11-30", suspendida: null });

    const pagos = await consulta<{ wompi_transaction_id: string; monto_cop: number; estado: string; tipo: string; plan: string }>("select wompi_transaction_id, monto_cop, estado, tipo, plan from public.dulabs_pagos where id_tenant = $1", [T1]);
    assert.deepEqual(pagos, [{ wompi_transaction_id: `manual-${T1}-2026-10-30`, monto_cop: 39990, estado: "APPROVED", tipo: "suscripcion", plan: "start" }]);

    const [ciclo] = await consulta<{ estado: string; registrado_por: string; nota: string; monto_cop: number; pago: boolean }>(
      "select estado, registrado_por, nota, monto_cop, (pago_id is not null and pagado_at is not null) as pago from public.dulabs_cobros_ciclos where id_tenant = $1 and fecha_cobro = '2026-10-30'",
      [T1],
    );
    assert.deepEqual(ciclo, { estado: "pagado", registrado_por: "operador@prueba.test", nota: "transferencia Bancolombia", monto_cop: 39990, pago: true });
  });

  it("un monto distinto al del plan se respeta (queda registrado el que de verdad se recibió)", async () => {
    await crearSuscripcion(T1, { fecha: "2026-10-30", precio: 39990 });
    const [r] = await registrar(T1, "2026-10-30", 30000);
    assert.equal(r!.monto_registrado, 30000);
    assert.equal((await consulta<{ monto_cop: number }>("select monto_cop from public.dulabs_pagos"))[0]!.monto_cop, 30000);
  });

  it("si el recordatorio ya se había mandado, el ciclo pasa a pagado y conserva la huella del aviso", async () => {
    await crearSuscripcion(T1, { fecha: "2026-10-30", suspendida: true });
    await db.query("insert into public.dulabs_cobros_ciclos (id_tenant, fecha_cobro, monto_cop, estado, intentos, recordatorio_wamid, suspendido_at) values ($1, '2026-10-30', 39990, 'enviado', 1, 'wamid.PRUEBA', now())", [T1]);
    await registrar(T1, "2026-10-30");
    const [ciclo] = await consulta<{ estado: string; wamid: string; intentos: number }>("select estado, recordatorio_wamid as wamid, intentos from public.dulabs_cobros_ciclos where id_tenant = $1", [T1]);
    assert.deepEqual(ciclo, { estado: "pagado", wamid: "wamid.PRUEBA", intentos: 1 });
    assert.equal((await consulta("select 1 from public.dulabs_cobros_ciclos where id_tenant = $1", [T1])).length, 1, "sigue habiendo un solo ciclo");
  });

  it("pagar ANTES del vencimiento también funciona (no había ciclo previo): se crea ya como pagado y la fecha avanza", async () => {
    await crearSuscripcion(T1, { fecha: "2026-10-30", diaCobro: 30 });
    const [r] = await registrar(T1, "2026-10-30");
    assert.equal(r!.estaba_suspendida, false);
    assert.equal(await fechaDe(T1), "2026-11-30");
    assert.equal((await consulta<{ estado: string }>("select estado from public.dulabs_cobros_ciclos where id_tenant = $1", [T1]))[0]!.estado, "pagado");
  });

  it("el día de cobro se respeta mes a mes: el 30 de febrero es el 28 (o el 29 en bisiesto) y en marzo vuelve al 30", async () => {
    await crearSuscripcion(T1, { fecha: "2026-01-30", diaCobro: 30 });
    assert.equal((await registrar(T1, "2026-01-30"))[0]!.proximo_cobro, "2026-02-28");
    assert.equal((await registrar(T1, "2026-02-28"))[0]!.proximo_cobro, "2026-03-30");
    assert.equal((await registrar(T1, "2026-03-30"))[0]!.proximo_cobro, "2026-04-30");
    assert.equal((await registrar(T1, "2026-04-30"))[0]!.proximo_cobro, "2026-05-30");
    await db.exec("update public.dulabs_suscripciones set fecha_proximo_cobro = '2028-01-30'");
    assert.equal((await registrar(T1, "2028-01-30"))[0]!.proximo_cobro, "2028-02-29");
    await db.exec("update public.dulabs_suscripciones set fecha_proximo_cobro = '2026-12-30'");
    assert.equal((await registrar(T1, "2026-12-30"))[0]!.proximo_cobro, "2027-01-30", "cruza de año");
  });

  it("sin día de cobro se usa el de la fecha actual (un día 31 cae en el último día del mes corto)", async () => {
    await crearSuscripcion(T1, { fecha: "2026-01-31", diaCobro: null });
    assert.equal((await registrar(T1, "2026-01-31"))[0]!.proximo_cobro, "2026-02-28");
  });

  it("la nueva fecha se cuenta desde la FECHA DE COBRO, no desde el día en que se paga (pagar tarde no corre el ciclo)", async () => {
    await crearSuscripcion(T1, { fecha: "2026-10-30", diaCobro: 30, suspendida: true });
    // aunque hoy sea otro día, la RPC no mira el reloj: 30-oct → 30-nov
    assert.equal((await registrar(T1, "2026-10-30"))[0]!.proximo_cobro, "2026-11-30");
  });

  it("un doble clic NO paga dos ciclos: la segunda llamada con la misma fecha se rechaza y la suscripción queda donde estaba", async () => {
    await crearSuscripcion(T1, { fecha: "2026-10-30", diaCobro: 30 });
    await registrar(T1, "2026-10-30");
    await assert.rejects(registrar(T1, "2026-10-30"), /cobro_ciclo_desactualizado/);
    assert.equal(await fechaDe(T1), "2026-11-30");
    assert.equal((await consulta("select 1 from public.dulabs_pagos")).length, 1);
  });

  it("si ya existía un pago manual de ese ciclo, se rechaza y NO se mueve nada (la transacción se deshace entera)", async () => {
    await crearSuscripcion(T1, { fecha: "2026-10-30", suspendida: true });
    await db.query("insert into public.dulabs_pagos (id_tenant, wompi_transaction_id, monto_cop, estado) values ($1, $2, 39990, 'APPROVED')", [T1, `manual-${T1}-2026-10-30`]);
    await assert.rejects(registrar(T1, "2026-10-30"), /cobro_ciclo_ya_pagado/);
    const [sus] = await consulta<{ fecha: string; suspendida: boolean }>("select to_char(fecha_proximo_cobro, 'YYYY-MM-DD') as fecha, suspendida_por_pago_at is not null as suspendida from public.dulabs_suscripciones where id_tenant = $1", [T1]);
    assert.deepEqual(sus, { fecha: "2026-10-30", suspendida: true });
    assert.equal((await consulta("select 1 from public.dulabs_cobros_ciclos")).length, 0);
  });

  it("solo aplica a suscripciones MANUALES, activas y que no sean cortesía", async () => {
    await assert.rejects(registrar(T1, "2026-10-30"), /cobro_sin_suscripcion/);
    await crearSuscripcion(T1, { fecha: "2026-10-30", wompi: "ps_123" });
    await assert.rejects(registrar(T1, "2026-10-30"), /cobro_no_es_manual/);
    await crearSuscripcion(T2, { fecha: "2026-10-30", cortesia: true });
    await assert.rejects(registrar(T2, "2026-10-30"), /cobro_es_cortesia/);
    await db.exec("update public.dulabs_suscripciones set wompi_payment_source_id = null, estado = 'vencida' where id_tenant = '" + T1 + "'");
    await assert.rejects(registrar(T1, "2026-10-30"), /cobro_suscripcion_no_activa/);
    assert.equal((await consulta("select 1 from public.dulabs_pagos")).length, 0, "ninguna de las llamadas rechazadas dejó un pago");
  });

  it("rechaza un monto cero o negativo", async () => {
    await crearSuscripcion(T1, { fecha: "2026-10-30", precio: 39990 });
    await assert.rejects(registrar(T1, "2026-10-30", 0), /cobro_monto_invalido/);
    await assert.rejects(registrar(T1, "2026-10-30", -5), /cobro_monto_invalido/);
    await crearSuscripcion(T2, { fecha: "2026-10-30", precio: 0 });
    await assert.rejects(registrar(T2, "2026-10-30"), /cobro_monto_invalido/, "una suscripción sin precio tampoco se puede registrar sin monto");
  });

  it("el cliente web (anon / authenticated) no puede registrar pagos ni leer el libro de ciclos; el backend (service_role) sí", async () => {
    await crearSuscripcion(T1, { fecha: "2026-10-30" });
    await db.query("insert into public.dulabs_cobros_ciclos (id_tenant, fecha_cobro, monto_cop) values ($1, '2026-10-30', 39990)", [T1]);
    for (const rol of ["anon", "authenticated"]) {
      await db.exec(`set role ${rol}`);
      await assert.rejects(registrar(T1, "2026-10-30"), /permission denied/, `${rol} no debe poder registrar pagos`);
      await assert.rejects(consulta("select * from public.dulabs_cobros_ciclos"), /permission denied/, `${rol} no debe leer el libro de ciclos`);
      await assert.rejects(db.exec("update public.dulabs_cobros_ciclos set estado = 'pagado'"), /permission denied/, `${rol} no debe escribir en el libro de ciclos`);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    assert.equal((await registrar(T1, "2026-10-30"))[0]!.proximo_cobro, "2026-11-30");
    await db.exec("reset role");
  });
});
