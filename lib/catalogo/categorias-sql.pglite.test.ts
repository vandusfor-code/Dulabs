/**
 * Catálogo — ELIMINAR CATEGORÍAS contra el SQL REAL (la migración 20261105000000 del catálogo en un Postgres embebido: PGlite, Postgres compilado a WASM en memoria; sin red,
 * sin Docker y sin tocar ninguna base real). Se prueba lo que solo la base puede garantizar: la clave foránea compuesta impide borrar una categoría con productos y impide
 * mandarlos a la categoría de otro negocio; y la escritura masiva que hace el repositorio (los MISMOS valores que envía `reassignCategory`) queda en la auditoría atribuida
 * a quien la hizo. Negocios, usuarios y productos ficticios.
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
const ARETES = "c0000000-0000-4000-8000-0000000000a1";
const DIJES = "c0000000-0000-4000-8000-0000000000a2";
const AJENA = "c0000000-0000-4000-8000-0000000000b1";

const PREPARACION = `
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const migraciones = (archivo: string) => readFileSync(path.join(process.cwd(), "supabase", "migrations", archivo), "utf8");

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(PREPARACION);
  // La tabla de productos nació con la de AMORE; su migración también crea un bucket de Storage, que en un Postgres a secas no existe.
  await db.exec(migraciones("20260923000000_amore_inventario_productos.sql").replace(/insert into storage\.buckets[\s\S]*?on conflict \(id\) do nothing;/i, ""));
  await db.exec(migraciones("20261105000000_dulabs_catalogo_fase1.sql"));
});

after(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("truncate public.dulabs_catalogo_eventos, public.dulabs_inventario_productos, public.dulabs_catalogo_categorias, public.dulabs_catalogo_secuencias cascade");
  await db.query("insert into public.dulabs_catalogo_categorias (id, id_tenant, nombre) values ($1, $2, 'Aretes'), ($3, $2, 'Dijes'), ($4, $5, 'Aretes')", [ARETES, T1, DIJES, AJENA, T2]);
});

async function producto(tenant: string, nombre: string, categoriaId: string | null, categoria: string | null): Promise<string> {
  const r = await db.query<{ id: string }>(
    "insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, categoria_id, categoria, created_by, updated_by, escritura_id) values ($1, $2, 1000, 1, $3, $4, $5, $5, gen_random_uuid()) returning id",
    [tenant, nombre, categoriaId, categoria, CREADOR],
  );
  return r.rows[0].id;
}

/** Exactamente lo que envía `reassignCategory` del repositorio de Supabase (categoria_id + categoria + updated_at + updated_by + un escritura_id nuevo, acotado al negocio y a la categoría). */
const mover = (tenant: string, desde: string, haciaId: string | null, haciaNombre: string | null) =>
  db.query(
    "update public.dulabs_inventario_productos set categoria_id = $3, categoria = $4, updated_at = now(), updated_by = $5, escritura_id = gen_random_uuid() where id_tenant = $1 and categoria_id = $2",
    [tenant, desde, haciaId, haciaNombre, ACTOR],
  );
/** Exactamente lo que envía `deleteCategory`. */
const borrar = (tenant: string, id: string) => db.query<{ id: string }>("delete from public.dulabs_catalogo_categorias where id_tenant = $1 and id = $2 returning id", [tenant, id]);
const categorias = async (tenant: string) => (await db.query<{ id: string }>("select id from public.dulabs_catalogo_categorias where id_tenant = $1 order by nombre", [tenant])).rows.map((r) => r.id);
const codigo = (e: unknown) => (e as { code?: string }).code;

describe("la clave foránea compuesta protege las categorías", () => {
  it("borrar una categoría que todavía tiene productos falla con 23503 y no cambia nada", async () => {
    await producto(T1, "Aretes brillo", ARETES, "Aretes");
    await assert.rejects(borrar(T1, ARETES), (e) => codigo(e) === "23503");
    assert.deepEqual(await categorias(T1), [ARETES, DIJES]);
  });

  it("una categoría sin productos se borra (y la de otro negocio, con el mismo nombre, ni se entera)", async () => {
    const r = await borrar(T1, DIJES);
    assert.equal(r.rows.length, 1);
    assert.deepEqual(await categorias(T1), [ARETES]);
    assert.deepEqual(await categorias(T2), [AJENA]);
  });

  it("borrar con el negocio equivocado no borra nada (0 filas): el filtro por negocio no es decoración", async () => {
    const r = await borrar(T2, ARETES);
    assert.equal(r.rows.length, 0);
    assert.deepEqual(await categorias(T1), [ARETES, DIJES]);
  });

  it("los productos NO pueden pasarse a la categoría de OTRO negocio (la base lo impide aunque el código fallara)", async () => {
    await producto(T1, "Aretes brillo", ARETES, "Aretes");
    await assert.rejects(mover(T1, ARETES, AJENA, "Aretes"), (e) => codigo(e) === "23503");
    const r = await db.query<{ categoria_id: string }>("select categoria_id from public.dulabs_inventario_productos where id_tenant = $1", [T1]);
    assert.deepEqual(r.rows.map((x) => x.categoria_id), [ARETES], "el producto sigue donde estaba");
  });
});

describe("pasar los productos y borrar", () => {
  it("a otra categoría: solo se mueven los de esa categoría y el negocio, y luego la categoría se borra", async () => {
    const a1 = await producto(T1, "Aretes brillo", ARETES, "Aretes");
    const a2 = await producto(T1, "Aretes luna", ARETES, "Aretes");
    const d1 = await producto(T1, "Dije corazón", DIJES, "Dijes");
    const sin = await producto(T1, "Anillo sin categoría", null, null);
    const ajeno = await producto(T2, "Aretes de otro negocio", AJENA, "Aretes");

    const movidos = await mover(T1, ARETES, DIJES, "Dijes");
    assert.equal(movidos.affectedRows, 2);
    assert.equal((await borrar(T1, ARETES)).rows.length, 1);

    const filas = await db.query<{ id: string; categoria_id: string | null; categoria: string | null }>("select id, categoria_id, categoria from public.dulabs_inventario_productos");
    const de = (id: string) => filas.rows.find((f) => f.id === id)!;
    for (const id of [a1, a2, d1]) assert.deepEqual([de(id).categoria_id, de(id).categoria], [DIJES, "Dijes"]);
    assert.deepEqual([de(sin).categoria_id, de(sin).categoria], [null, null]);
    assert.deepEqual([de(ajeno).categoria_id, de(ajeno).categoria], [AJENA, "Aretes"], "el otro negocio no se toca");
  });

  it("a «sin categoría»: la clave foránea (MATCH SIMPLE) acepta el null y la categoría se borra", async () => {
    const a1 = await producto(T1, "Aretes brillo", ARETES, "Aretes");
    await mover(T1, ARETES, null, null);
    assert.equal((await borrar(T1, ARETES)).rows.length, 1);
    const r = await db.query<{ categoria_id: string | null; categoria: string | null }>("select categoria_id, categoria from public.dulabs_inventario_productos where id = $1", [a1]);
    assert.deepEqual(r.rows[0], { categoria_id: null, categoria: null });
  });

  it("si entra un producto entre mover y borrar, la base detiene el borrado; reintentar (mover otra vez) funciona", async () => {
    await producto(T1, "Aretes brillo", ARETES, "Aretes");
    await mover(T1, ARETES, DIJES, "Dijes");
    await producto(T1, "Aretes que llegó tarde", ARETES, "Aretes"); // otra persona lo creó justo ahora
    await assert.rejects(borrar(T1, ARETES), (e) => codigo(e) === "23503");
    assert.deepEqual(await categorias(T1), [ARETES, DIJES], "la categoría sigue");

    await mover(T1, ARETES, DIJES, "Dijes");
    assert.equal((await borrar(T1, ARETES)).rows.length, 1);
    assert.deepEqual(await categorias(T1), [DIJES]);
  });
});

describe("la auditoría de cada producto movido", () => {
  it("queda como «actualizado», con el antes/después de la categoría, y atribuida a QUIEN la eliminó (no a quien creó el producto)", async () => {
    const a1 = await producto(T1, "Aretes brillo", ARETES, "Aretes");
    await mover(T1, ARETES, DIJES, "Dijes");
    const r = await db.query<{ accion: string; actor_user_id: string | null; cambios: Record<string, { antes: unknown; despues: unknown }> }>(
      "select accion, actor_user_id, cambios from public.dulabs_catalogo_eventos where producto_id = $1 and accion = 'actualizado'",
      [a1],
    );
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].actor_user_id, ACTOR);
    assert.deepEqual(r.rows[0].cambios.categoria_id, { antes: ARETES, despues: DIJES });
    assert.deepEqual(r.rows[0].cambios.categoria, { antes: "Aretes", despues: "Dijes" });
  });

  it("sin el token de escritura nuevo, la auditoría quedaría SIN actor: por eso el repositorio lo renueva siempre", async () => {
    const a1 = await producto(T1, "Aretes brillo", ARETES, "Aretes");
    await db.query("update public.dulabs_inventario_productos set categoria_id = $1, categoria = 'Dijes', updated_by = $2 where id = $3", [DIJES, ACTOR, a1]);
    const r = await db.query<{ actor_user_id: string | null }>("select actor_user_id from public.dulabs_catalogo_eventos where producto_id = $1 and accion = 'actualizado'", [a1]);
    assert.equal(r.rows[0].actor_user_id, null);
  });
});
