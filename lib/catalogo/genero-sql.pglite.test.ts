/**
 * Hombre / Mujer contra el SQL REAL: las migraciones del catálogo (20261105000000) y de «Para quién» (20261215000000) en un Postgres embebido (PGlite: Postgres compilado a WASM en memoria; sin red, sin
 * Docker y sin tocar ninguna base real). Se prueba lo que solo la base puede garantizar: la migración es aditiva y se puede repetir, lo que ya existía queda como «mujer», el CHECK solo admite los dos
 * valores, la escritura que hace el repositorio (los MISMOS valores que envía `setGender`) queda en la auditoría con quién la hizo, la lectura de referencias de hombre (la de `listHombreReferences`) usa
 * el índice parcial, y la reversa se niega a borrar una clasificación ya hecha. Negocios y productos ficticios.
 */
import "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const CREADOR = "22222222-2222-4222-8222-222222222222";

const PREPARACION = `
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const leer = (carpeta: string, archivo: string) => readFileSync(path.join(process.cwd(), "supabase", carpeta, archivo), "utf8");
const MIGRACION = () => leer("migrations", "20261215000000_dulabs_catalogo_genero.sql");
const REVERSA = () => leer("rollbacks", "20261215000000_dulabs_catalogo_genero.down.sql");
const codigo = (e: unknown) => (e as { code?: string }).code;

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(PREPARACION);
  await db.exec(leer("migrations", "20260923000000_amore_inventario_productos.sql").replace(/insert into storage\.buckets[\s\S]*?on conflict \(id\) do nothing;/i, ""));
  await db.exec(leer("migrations", "20261105000000_dulabs_catalogo_fase1.sql"));
});

after(async () => {
  await db.close();
});

beforeEach(async () => {
  // Cada prueba arranca con la migración aplicada y sin datos.
  await db.exec(MIGRACION());
  await db.exec("truncate public.dulabs_catalogo_eventos, public.dulabs_inventario_productos, public.dulabs_catalogo_secuencias cascade");
});

/** Lo que inserta el repositorio al crear un producto: NO menciona `genero` (nace como mujer por el valor por defecto). */
async function producto(tenant: string, nombre: string, activo = true): Promise<{ id: string; referencia: string }> {
  const r = await db.query<{ id: string; referencia: string }>(
    "insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, activo, created_by, updated_by, escritura_id) values ($1, $2, 1000, 1, $3, $4, $4, gen_random_uuid()) returning id, referencia",
    [tenant, nombre, activo, CREADOR],
  );
  return r.rows[0];
}

/** Exactamente lo que envía `setGender` del repositorio de Supabase (genero + updated_at + updated_by + un escritura_id nuevo, acotado al negocio y al producto). */
const marcar = (tenant: string, id: string, genero: string) =>
  db.query("update public.dulabs_inventario_productos set genero = $3, updated_at = now(), updated_by = $4, escritura_id = gen_random_uuid() where id_tenant = $1 and id = $2 returning id", [tenant, id, genero, ACTOR]);
/** Exactamente lo que lee `listHombreReferences`: solo la referencia, solo activas, orden estable. */
const hombres = async (tenant: string) =>
  (await db.query<{ referencia: string }>("select referencia from public.dulabs_inventario_productos where id_tenant = $1 and genero = 'hombre' and activo = true order by referencia asc", [tenant])).rows.map((r) => r.referencia);

describe("la migración", () => {
  it("es idempotente: aplicarla otra vez no falla ni cambia nada", async () => {
    const p = await producto(T1, "Anillo");
    await marcar(T1, p.id, "hombre");
    await db.exec(MIGRACION());
    await db.exec(MIGRACION());
    assert.deepEqual(await hombres(T1), [p.referencia]);
  });

  it("lo que ya existía queda como «mujer» (valor por defecto) y un producto nuevo también", async () => {
    // Un producto creado ANTES de la migración: se quita y se vuelve a poner la columna para simularlo.
    await db.exec("alter table public.dulabs_inventario_productos drop column genero");
    const antes = await producto(T1, "Anillo de antes");
    await db.exec(MIGRACION());
    const nuevo = await producto(T1, "Anillo de ahora");
    const r = await db.query<{ id: string; genero: string }>("select id, genero from public.dulabs_inventario_productos order by nombre");
    assert.deepEqual(r.rows.map((x) => x.genero), ["mujer", "mujer"]);
    assert.ok(r.rows.some((x) => x.id === antes.id) && r.rows.some((x) => x.id === nuevo.id));
  });

  it("el CHECK solo admite «mujer» y «hombre»", async () => {
    const p = await producto(T1, "Anillo");
    await assert.rejects(marcar(T1, p.id, "otro"), (e) => codigo(e) === "23514");
    await assert.rejects(marcar(T1, p.id, ""), (e) => codigo(e) === "23514");
    await assert.rejects(db.query("update public.dulabs_inventario_productos set genero = null where id = $1", [p.id]), (e) => codigo(e) === "23502", "no admite nulos");
  });
});

describe("marcar una pieza", () => {
  it("queda en la auditoría con el cambio y con quién lo hizo", async () => {
    const p = await producto(T1, "Dije");
    await marcar(T1, p.id, "hombre");
    const eventos = await db.query<{ accion: string; actor_user_id: string | null; cambios: Record<string, { antes: string; despues: string }> }>(
      "select accion, actor_user_id, cambios from public.dulabs_catalogo_eventos where producto_id = $1 and accion = 'actualizado' order by id desc limit 1",
      [p.id],
    );
    assert.equal(eventos.rows.length, 1);
    assert.deepEqual(eventos.rows[0].cambios, { genero: { antes: "mujer", despues: "hombre" } }, "solo cambió el «Para», nada más");
    assert.equal(eventos.rows[0].actor_user_id, ACTOR);
  });

  it("el filtro por negocio no es decoración: marcar con el negocio equivocado no toca nada (0 filas)", async () => {
    const p = await producto(T1, "Dije");
    const r = await marcar(T2, p.id, "hombre");
    assert.equal(r.rows.length, 0);
    assert.deepEqual(await hombres(T1), []);
  });

  it("la referencia, el precio y el stock quedan intactos", async () => {
    const p = await producto(T1, "Dije");
    await marcar(T1, p.id, "hombre");
    const r = await db.query<{ referencia: string; precio: number; stock: number }>("select referencia, precio, stock from public.dulabs_inventario_productos where id = $1", [p.id]);
    assert.deepEqual(r.rows[0], { referencia: p.referencia, precio: 1000, stock: 1 });
  });
});

describe("la lectura de las piezas de hombre", () => {
  it("solo las activas del negocio, ordenadas por referencia; el otro negocio ni se entera", async () => {
    const a = await producto(T1, "Cruz");
    const b = await producto(T1, "Santo");
    const inactiva = await producto(T1, "Espada", false);
    const ajena = await producto(T2, "Cruz de otro");
    const mujer = await producto(T1, "Anillo de mujer");
    for (const p of [a, b, inactiva]) await marcar(T1, p.id, "hombre");
    await marcar(T2, ajena.id, "hombre");
    assert.ok(mujer.id);
    assert.deepEqual(await hombres(T1), [a.referencia, b.referencia].sort());
    assert.deepEqual(await hombres(T2), [ajena.referencia]);
  });

  it("existe el índice parcial (solo las piezas de hombre) y la consulta es válida contra él", async () => {
    const r = await db.query<{ indexdef: string }>("select indexdef from pg_indexes where indexname = 'dulabs_inventario_productos_hombre_idx'");
    assert.equal(r.rows.length, 1);
    assert.match(r.rows[0].indexdef, /\(id_tenant, referencia\)/);
    assert.match(r.rows[0].indexdef, /WHERE \(genero = 'hombre'/);
  });

  it("cambiar una pieza de vuelta a mujer la saca de la lista", async () => {
    const p = await producto(T1, "Dije");
    await marcar(T1, p.id, "hombre");
    assert.equal((await hombres(T1)).length, 1);
    await marcar(T1, p.id, "mujer");
    assert.equal((await hombres(T1)).length, 0);
  });
});

describe("la reversa", () => {
  it("sin piezas de hombre quita la columna, el CHECK y el índice (y la migración se puede volver a aplicar)", async () => {
    await producto(T1, "Anillo");
    await db.exec(REVERSA());
    const col = await db.query("select 1 from information_schema.columns where table_name = 'dulabs_inventario_productos' and column_name = 'genero'");
    assert.equal(col.rows.length, 0);
    const idx = await db.query("select 1 from pg_indexes where indexname = 'dulabs_inventario_productos_hombre_idx'");
    assert.equal(idx.rows.length, 0);
    await db.exec(REVERSA()); // repetirla tampoco falla
    await db.exec(MIGRACION());
    assert.equal((await db.query("select 1 from information_schema.columns where table_name = 'dulabs_inventario_productos' and column_name = 'genero'")).rows.length, 1);
  });

  it("se NIEGA a correr si ya hay piezas de hombre: no pierde la clasificación", async () => {
    const p = await producto(T1, "Dije");
    await marcar(T1, p.id, "hombre");
    await assert.rejects(db.exec(REVERSA()), /hay 1 piezas marcadas como de hombre/);
    // El SQL Editor termina la transacción abortada al acabar la petición; aquí hay que cerrarla a mano.
    await db.exec("rollback");
    assert.deepEqual(await hombres(T1), [p.referencia], "la columna y los datos siguen ahí");
  });
});
