/**
 * CMS comercial — la MIGRACIÓN REAL en Postgres embebido (PGlite): desde cero, sobre un estado previo con datos, ejecutada varias veces, con las
 * verificaciones SQL del repositorio (supabase/tests) y con su REVERSA. Nada toca Supabase ni ninguna base real.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { crearBaseCms, rutaPruebaSql, rutaRollback, sqlSinMetacomandos, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { TENANT_A } from "@/lib/cms-comercial/testing/fixtures";

const abiertas: BaseCms[] = [];
async function base(opciones?: Parameters<typeof crearBaseCms>[0]) {
  const b = await crearBaseCms(opciones);
  abiertas.push(b);
  return b;
}
afterEach(async () => {
  while (abiertas.length) await abiertas.pop()?.cerrar();
});

/** Huella del esquema del CMS: si una segunda ejecución cambiara algo, la huella cambia. */
async function huella(b: BaseCms) {
  const [t, f, c, i, g] = await Promise.all([
    b.sql<{ n: string }>("select tablename as n from pg_tables where schemaname = 'public' and tablename like 'dulabs_cms_%' order by 1"),
    b.sql<{ n: string }>("select p.oid::regprocedure::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dulabs\\_cms\\_%' order by 1"),
    b.sql<{ n: string }>("select conname as n from pg_constraint where conrelid::regclass::text like 'dulabs_cms_%' order by 1"),
    b.sql<{ n: string }>("select indexname as n from pg_indexes where schemaname = 'public' and tablename like 'dulabs_cms_%' order by 1"),
    b.sql<{ n: string }>("select tgname as n from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'dulabs_cms_%' order by 1"),
  ]);
  return { tablas: t.map((x) => x.n), funciones: f.map((x) => x.n), restricciones: c.map((x) => x.n), indices: i.map((x) => x.n), triggers: g.map((x) => x.n) };
}

describe("migración del CMS comercial", () => {
  it("se aplica desde cero: 4 tablas, sus funciones, RLS sin políticas y triggers de inmutabilidad", async () => {
    const b = await base();
    const h = await huella(b);
    assert.deepEqual(h.tablas, ["dulabs_cms_assets", "dulabs_cms_auditoria", "dulabs_cms_entidades", "dulabs_cms_versiones"]);
    assert.ok(h.funciones.length >= 24, `funciones: ${h.funciones.length}`);
    assert.deepEqual(h.triggers, ["dulabs_cms_auditoria_inmutable", "dulabs_cms_versiones_inmutable"]);
    const rls = await b.sql<{ n: string; r: boolean }>("select relname as n, relrowsecurity as r from pg_class where relkind = 'r' and relname like 'dulabs_cms_%' order by 1");
    assert.equal(rls.length, 4);
    assert.ok(rls.every((x) => x.r), "las 4 tablas con RLS");
    const politicas = await b.sql("select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'dulabs_cms_%'");
    assert.equal(politicas.length, 0);
  });

  it("es idempotente: ejecutarla dos y tres veces no cambia nada ni falla", async () => {
    const una = await base();
    const tres = await base({ veces: 3 });
    assert.deepEqual(await huella(tres), await huella(una));
  });

  it("sobre un estado previo con datos: no toca las tablas existentes ni sus filas", async () => {
    const b = await base({ aplicarMigracion: false });
    await b.aplicarSql(`
      create table public.dulabs_catalogo_pedidos (id uuid primary key default gen_random_uuid(), id_tenant uuid not null, total integer);
      insert into public.dulabs_catalogo_pedidos (id_tenant, total) values ('${TENANT_A}', 150000), ('${TENANT_A}', 90000);
      insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values ('${TENANT_A}', 'catalogo', true), ('${TENANT_A}', 'pedidos', true);
    `);
    const antesCols = await b.sql("select table_name, column_name, data_type from information_schema.columns where table_name in ('dulabs_catalogo_pedidos', 'dulabs_tenant_modulos') order by 1, 2");
    await b.aplicarSql(readFileSync("supabase/migrations/20261210000000_dulabs_cms_comercial.sql", "utf8"));
    await b.aplicarSql(readFileSync("supabase/migrations/20261210000000_dulabs_cms_comercial.sql", "utf8"));
    const despuesCols = await b.sql("select table_name, column_name, data_type from information_schema.columns where table_name in ('dulabs_catalogo_pedidos', 'dulabs_tenant_modulos') order by 1, 2");
    assert.deepEqual(despuesCols, antesCols);
    assert.deepEqual((await b.sql<{ total: number }>("select total from public.dulabs_catalogo_pedidos order by total")).map((x) => x.total), [90000, 150000]);
    assert.deepEqual((await b.sql<{ modulo: string }>("select modulo from public.dulabs_tenant_modulos order by 1")).map((x) => x.modulo), ["catalogo", "pedidos"]);
  });

  it("las verificaciones SQL del repositorio (supabase/tests) pasan sobre la migración aplicada dos veces", async () => {
    const b = await base({ veces: 2 });
    await b.aplicarSql(sqlSinMetacomandos(readFileSync(rutaPruebaSql(), "utf8")));
    // y dejaron datos reales: el historial completo de acciones
    const acciones = await b.sql<{ accion: string }>("select distinct accion from public.dulabs_cms_auditoria order by 1");
    assert.deepEqual(acciones.map((a) => a.accion), ["archivar", "crear", "desarchivar", "despublicar", "editar_borrador", "pausar", "publicar", "reanudar", "restaurar", "subir_imagen"]);
  });
});

describe("reversa (supabase/rollbacks)", () => {
  const rollback = () => readFileSync(rutaRollback(), "utf8").replace(/^\\set .*$/gm, "");
  const contarCms = async (b: BaseCms) => (await huella(b)).tablas.length + (await huella(b)).funciones.length;

  it("sin contenido corre sin confirmación y deja la base como antes de la migración (y se puede volver a aplicar)", async () => {
    const b = await base();
    await b.habilitarModulo(TENANT_A);
    await b.aplicarSql(rollback());
    assert.equal(await contarCms(b), 0);
    assert.deepEqual(await b.sql("select modulo from public.dulabs_tenant_modulos where modulo = 'cms_comercial'"), []);
    // reversible de ida y vuelta
    await b.aplicarSql(readFileSync("supabase/migrations/20261210000000_dulabs_cms_comercial.sql", "utf8"));
    assert.equal((await huella(b)).tablas.length, 4);
  });

  it("se NIEGA a correr si hay contenido (borradores, publicado o imágenes) y no borra nada", async () => {
    const b = await base();
    await b.aplicarSql(`select public.dulabs_cms_crear('${TENANT_A}', 'oferta', 'amor', '{"nombre":"Amor"}'::jsonb, null, 'Ana')`);
    await assert.rejects(b.aplicarSql(rollback()), /el rollback los borraría/);
    await b.aplicarSql("rollback");
    assert.equal((await huella(b)).tablas.length, 4);
    assert.equal((await b.sql("select 1 from public.dulabs_cms_entidades")).length, 1);
  });

  it("con la confirmación explícita borra todo, incluido el historial, y deja intactos los demás módulos", async () => {
    const b = await base();
    await b.habilitarModulo(TENANT_A);
    await b.aplicarSql(`insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values ('${TENANT_A}', 'catalogo', true)`);
    await b.aplicarSql(`select public.dulabs_cms_crear('${TENANT_A}', 'oferta', 'amor', '{"nombre":"Amor"}'::jsonb, null, 'Ana')`);
    await b.aplicarSql(`set dulabs.confirmar_borrado_cms = 'si'`);
    await b.aplicarSql(rollback());
    assert.equal(await contarCms(b), 0);
    assert.deepEqual((await b.sql<{ modulo: string }>("select modulo from public.dulabs_tenant_modulos")).map((x) => x.modulo), ["catalogo"]);
  });

  it("sobre una base que nunca tuvo la migración no falla (nada que revertir)", async () => {
    const b = await base({ aplicarMigracion: false });
    await b.aplicarSql(rollback());
    assert.equal(await contarCms(b), 0);
  });
});
