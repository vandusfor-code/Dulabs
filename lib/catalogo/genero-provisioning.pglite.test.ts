/**
 * Los SQL de aprovisionamiento de Delacour para la colección Vértice (supabase/provisioning/delacour/08_marcar_vertice_como_hombre.sql y su reversa), contra un Postgres embebido (PGlite: Postgres
 * compilado a WASM en memoria; sin red, sin Docker y sin tocar ninguna base real). Es lo que corre el dueño en el SQL Editor de Supabase, así que se prueba a fondo ANTES: marca EXACTAMENTE las 76 piezas
 * de la carga (DL-000769 a DL-000844, material «Acero») y nada más, no toca precios, stock ni nombres, deja la auditoría, se puede repetir, se NIEGA (y no deja nada a medias) si algo no cuadra, y la
 * reversa las devuelve a «mujer». Negocios y productos ficticios.
 */
import "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const TD = "00000000-0000-4000-8000-0000000000d1"; // Delacour (ficticio)
const TX = "00000000-0000-4000-8000-0000000000d2"; // otro negocio
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

const leer = (...partes: string[]) => readFileSync(path.join(process.cwd(), "supabase", ...partes), "utf8");
const MIGRACION = () => leer("migrations", "20261215000000_dulabs_catalogo_genero.sql");
const MARCAR = () => leer("provisioning", "delacour", "08_marcar_vertice_como_hombre.sql");
const REVERSA = () => leer("provisioning", "delacour", "08_marcar_vertice_como_hombre.reversa.sql");
const mensaje = (e: unknown) => String((e as { message?: string }).message ?? e);

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(PREPARACION);
  await db.exec(leer("migrations", "20260923000000_amore_inventario_productos.sql").replace(/insert into storage\.buckets[\s\S]*?on conflict \(id\) do nothing;/i, ""));
  await db.exec(leer("migrations", "20261105000000_dulabs_catalogo_fase1.sql"));
  await db.exec(leer("migrations", "20261106000000_dulabs_catalogo_publicacion.sql"));
});

after(async () => {
  await db.close();
});

/** Un producto como lo crea el repositorio (la referencia la pone la base con el contador del negocio). */
async function producto(tenant: string, nombre: string, material: string | null, activo = true): Promise<string> {
  const r = await db.query<{ referencia: string }>(
    "insert into public.dulabs_inventario_productos (id_tenant, nombre, precio, stock, material, activo, created_by, updated_by, escritura_id) values ($1, $2, 8000, 15, $3, $4, $5, $5, gen_random_uuid()) returning referencia",
    [tenant, nombre, material, activo, CREADOR],
  );
  return r.rows[0].referencia;
}
const fijarContador = (tenant: string, ultimo: number) =>
  db.query("insert into public.dulabs_catalogo_secuencias (id_tenant, ultimo_numero) values ($1, $2) on conflict (id_tenant) do update set ultimo_numero = excluded.ultimo_numero", [tenant, ultimo]);

/**
 * Delacour como estará el día que se corra el SQL: dos piezas de mujer de antes (DL-000001 y DL-000002), las 76 de la carga de Vértice (DL-000769 a DL-000844: acero, nombre «Santo · ref»), y dos de
 * después (DL-000845 y DL-000846) que NO son de la colección aunque una sea de acero y lleve el mismo formato de nombre.
 */
async function sembrarDelacour() {
  await db.exec(MIGRACION());
  await db.exec("truncate public.dulabs_catalogo_eventos, public.dulabs_inventario_productos, public.dulabs_catalogo_secuencias, public.dulabs_catalogo_publicacion cascade");
  await db.query("insert into public.dulabs_catalogo_publicacion (id_tenant, slug, nombre_publico) values ($1, 'delacour', 'Delacour')", [TD]);
  await producto(TD, "Anillo corazón", "Plata 925");
  await producto(TD, "Aretes luna", "Rodio");
  await fijarContador(TD, 768);
  for (let i = 1; i <= 76; i++) await producto(TD, `Santo ${i} · 25110${String(i).padStart(2, "0")}`, "Acero");
  await producto(TD, "Anillo de acero", "Acero"); // DL-000845: sin el formato de nombre de la carga
  await producto(TD, "Cadena · 123", "Acero"); // DL-000846: fuera del rango de la carga
}
const cuantos = async (tenant: string, genero: string) => Number((await db.query<{ n: string }>("select count(*) as n from public.dulabs_inventario_productos where id_tenant = $1 and genero = $2", [tenant, genero])).rows[0].n);
const referenciasDe = async (tenant: string, genero: string) => (await db.query<{ referencia: string }>("select referencia from public.dulabs_inventario_productos where id_tenant = $1 and genero = $2 order by referencia", [tenant, genero])).rows.map((r) => r.referencia);
/**
 * Todo lo de las piezas MENOS el lado, la marca de hora y «updated_by»: lo que el SQL no debe tocar. («updated_by» lo limpia la auditoría del Catálogo cuando una escritura no viene del panel —no trae
 * token de escritura nuevo— para no atribuirle a un usuario un cambio que no hizo; el SQL no lo escribe. Se comprueba aparte.)
 */
const restoDeLasPiezas = async () => (await db.query<{ j: unknown }>("select to_jsonb(p) - 'genero' - 'updated_at' - 'updated_by' as j from public.dulabs_inventario_productos p order by id_tenant, referencia")).rows.map((r) => r.j);
/** Qué columnas difieren entre dos fotos de las piezas (para que un fallo diga QUÉ se tocó, no solo «distinto»). */
function columnasQueCambiaron(antes: unknown[], despues: unknown[]): string[] {
  const out = new Set<string>();
  antes.forEach((a, i) => {
    const x = a as Record<string, unknown>;
    const y = (despues[i] ?? {}) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.add(k);
  });
  return [...out];
}
const eventosDeGenero = async () =>
  (
    await db.query<{ accion: string; actor_user_id: string | null; cambios: Record<string, { antes: string; despues: string }> }>(
      "select accion, actor_user_id, cambios from public.dulabs_catalogo_eventos where accion = 'actualizado' and cambios ? 'genero' order by id",
    )
  ).rows;

describe("08_marcar_vertice_como_hombre.sql", () => {
  beforeEach(sembrarDelacour);

  it("la carga de prueba es la de verdad: las 76 piezas de Vértice tienen DL-000769 a DL-000844 y las dos de después DL-000845 y DL-000846", async () => {
    const r = await db.query<{ referencia: string }>("select referencia from public.dulabs_inventario_productos where id_tenant = $1 order by referencia", [TD]);
    const refs = r.rows.map((x) => x.referencia);
    assert.equal(refs.length, 80);
    assert.deepEqual(refs.slice(0, 2), ["DL-000001", "DL-000002"]);
    assert.equal(refs[2], "DL-000769");
    assert.equal(refs[77], "DL-000844");
    assert.deepEqual(refs.slice(78), ["DL-000845", "DL-000846"]);
    assert.equal(await cuantos(TD, "mujer"), 80, "antes de correr el SQL todo es de mujer");
  });

  it("marca EXACTAMENTE las 76 piezas de la colección como de hombre, y ninguna otra", async () => {
    await db.exec(MARCAR());
    assert.equal(await cuantos(TD, "hombre"), 76);
    const hombres = await referenciasDe(TD, "hombre");
    assert.equal(hombres[0], "DL-000769");
    assert.equal(hombres[75], "DL-000844");
    assert.deepEqual(await referenciasDe(TD, "mujer"), ["DL-000001", "DL-000002", "DL-000845", "DL-000846"], "las de antes y las de después siguen siendo de mujer");
  });

  it("solo cambia el lado: precios, stock, nombres, materiales, estado y referencias quedan exactamente igual", async () => {
    const antes = await restoDeLasPiezas();
    await db.exec(MARCAR());
    const despues = await restoDeLasPiezas();
    assert.deepEqual(columnasQueCambiaron(antes, despues), [], "columnas distintas");
    assert.deepEqual(despues, antes);
  });

  it("la auditoría del Catálogo no le atribuye el cambio a nadie (viene del SQL Editor): «updated_by» de las 76 queda vacío y el de las demás no se toca", async () => {
    await db.exec(MARCAR());
    const r = await db.query<{ referencia: string; updated_by: string | null }>("select referencia, updated_by from public.dulabs_inventario_productos where id_tenant = $1 order by referencia", [TD]);
    for (const p of r.rows) {
      const deLaColeccion = p.referencia >= "DL-000769" && p.referencia <= "DL-000844";
      assert.equal(p.updated_by, deLaColeccion ? null : CREADOR, p.referencia);
    }
  });

  it("deja la auditoría: un evento por pieza con el cambio «genero: mujer → hombre» y nada más cambiado (sin actor: viene del SQL Editor)", async () => {
    await db.exec(MARCAR());
    const eventos = await eventosDeGenero();
    assert.equal(eventos.length, 76);
    for (const e of eventos) {
      assert.equal(e.accion, "actualizado");
      assert.deepEqual(e.cambios, { genero: { antes: "mujer", despues: "hombre" } });
      assert.equal(e.actor_user_id, null);
    }
  });

  it("se puede repetir sin efectos nuevos: segunda corrida = mismas 76 y ningún evento más", async () => {
    await db.exec(MARCAR());
    const antes = (await eventosDeGenero()).length;
    await db.exec(MARCAR());
    await db.exec(MARCAR());
    assert.equal(await cuantos(TD, "hombre"), 76);
    assert.equal((await eventosDeGenero()).length, antes);
  });

  it("si la clienta ya marcó alguna a mano desde el panel, no falla: marca las que faltan y las demás quedan como estaban", async () => {
    await db.query("update public.dulabs_inventario_productos set genero = 'hombre' where id_tenant = $1 and referencia in ('DL-000769', 'DL-000800')", [TD]);
    await db.exec(MARCAR());
    assert.equal(await cuantos(TD, "hombre"), 76);
    assert.equal((await eventosDeGenero()).length, 76, "2 por el panel + 74 por el SQL: ninguna se cuenta dos veces");
  });

  it("incluye las piezas inactivas de la colección (la separación no depende de si hoy están a la venta)", async () => {
    await db.query("update public.dulabs_inventario_productos set activo = false where id_tenant = $1 and referencia = 'DL-000810'", [TD]);
    await db.exec(MARCAR());
    assert.equal(await cuantos(TD, "hombre"), 76);
  });

  it("se NIEGA si no son 76 (una pieza de la carga cambió de material o se borró) y NO deja nada a medias", async () => {
    await db.query("update public.dulabs_inventario_productos set material = 'Plata' where id_tenant = $1 and referencia = 'DL-000800'", [TD]);
    await assert.rejects(db.exec(MARCAR()), (e) => /se esperaban 76 piezas.*hay 75; no se marca nada/.test(mensaje(e)));
    assert.equal(await cuantos(TD, "hombre"), 0, "ninguna quedó marcada");
    await db.query("update public.dulabs_inventario_productos set material = 'Acero' where id_tenant = $1 and referencia = 'DL-000800'", [TD]);
    await db.query("delete from public.dulabs_inventario_productos where id_tenant = $1 and referencia = 'DL-000801'", [TD]);
    await assert.rejects(db.exec(MARCAR()), (e) => /hay 75/.test(mensaje(e)));
    assert.equal(await cuantos(TD, "hombre"), 0);
  });

  it("se NIEGA si falta la migración de «Para quién» (con el mensaje que dice cuál aplicar primero)", async () => {
    await db.exec("alter table public.dulabs_inventario_productos drop column genero");
    await assert.rejects(db.exec(MARCAR()), (e) => /falta aplicar la migración 20261215000000_dulabs_catalogo_genero\.sql/.test(mensaje(e)));
    await db.exec(MIGRACION());
    await db.exec(MARCAR());
    assert.equal(await cuantos(TD, "hombre"), 76, "con la migración aplicada, sí corre");
  });

  it("se NIEGA si no hay exactamente UNA tienda «delacour» (no la corre contra otro negocio por error)", async () => {
    await db.exec("delete from public.dulabs_catalogo_publicacion where slug = 'delacour'");
    await assert.rejects(db.exec(MARCAR()), (e) => /exactamente UNA publicación con slug «delacour», hay 0/.test(mensaje(e)));
    assert.equal(await cuantos(TD, "hombre"), 0);
  });

  it("no toca a otros negocios, aunque tengan una pieza con la misma referencia, el mismo material y el mismo formato de nombre", async () => {
    await fijarContador(TX, 768);
    const ref = await producto(TX, "Dije · 999", "Acero");
    assert.equal(ref, "DL-000769", "la del otro negocio cae en el mismo rango");
    await db.exec(MARCAR());
    assert.equal(await cuantos(TX, "hombre"), 0);
    assert.equal(await cuantos(TD, "hombre"), 76);
  });
});

describe("08_marcar_vertice_como_hombre.reversa.sql", () => {
  beforeEach(async () => {
    await sembrarDelacour();
    await db.exec(MARCAR());
  });

  it("devuelve las 76 a «mujer» y no toca nada más", async () => {
    const antes = await restoDeLasPiezas();
    await db.exec(REVERSA());
    assert.equal(await cuantos(TD, "hombre"), 0);
    assert.equal(await cuantos(TD, "mujer"), 80);
    assert.deepEqual(await restoDeLasPiezas(), antes);
  });

  it("deja la auditoría de la vuelta («hombre → mujer») y se puede repetir sin efectos nuevos", async () => {
    await db.exec(REVERSA());
    const vuelta = (await eventosDeGenero()).filter((e) => e.cambios.genero.despues === "mujer");
    assert.equal(vuelta.length, 76);
    await db.exec(REVERSA());
    assert.equal((await eventosDeGenero()).filter((e) => e.cambios.genero.despues === "mujer").length, 76);
  });

  it("solo devuelve las de la colección: una pieza de OTRO rango que alguien marcó como de hombre después sigue siéndolo", async () => {
    await db.query("update public.dulabs_inventario_productos set genero = 'hombre' where id_tenant = $1 and referencia = 'DL-000845'", [TD]);
    await db.exec(REVERSA());
    assert.deepEqual(await referenciasDe(TD, "hombre"), ["DL-000845"]);
  });

  it("se NIEGA sin la columna o sin la tienda, con un mensaje claro", async () => {
    await db.exec("delete from public.dulabs_catalogo_publicacion where slug = 'delacour'");
    await assert.rejects(db.exec(REVERSA()), (e) => /no se encontró la publicación con slug «delacour»/.test(mensaje(e)));
    await db.exec("alter table public.dulabs_inventario_productos drop column genero");
    await assert.rejects(db.exec(REVERSA()), (e) => /la columna genero no existe/.test(mensaje(e)));
  });
});

describe("los dos scripts son UNA sola sentencia (se pegan y corren de una vez en el SQL Editor)", () => {
  const sinComentarios = (sql: string) => sql.replace(/^\s*--.*$/gm, "").trim();

  for (const [nombre, leerScript] of [
    ["08_marcar_vertice_como_hombre.sql", MARCAR],
    ["08_marcar_vertice_como_hombre.reversa.sql", REVERSA],
  ] as const) {
    it(`${nombre}: un solo bloque DO ... $$ ... $$; sin otras sentencias ni transacciones sueltas`, () => {
      const sql = sinComentarios(leerScript());
      assert.match(sql, /^do \$\$\s/);
      assert.match(sql, /\$\$;$/);
      assert.equal((sql.match(/\$\$/g) ?? []).length, 2, "abre y cierra una sola vez");
      assert.ok(!/\b(begin|commit|rollback)\s*;/i.test(sql), "sin BEGIN/COMMIT sueltos (el bloque DO ya es atómico)");
    });

    it(`${nombre}: no escribe nada fuera del campo «genero» (ni precios, ni stock, ni nombres, ni estado)`, () => {
      const sql = sinComentarios(leerScript());
      const sets = [...sql.matchAll(/\bset\s+([\s\S]*?)\bwhere\b/gi)].map((m) => m[1].trim());
      assert.ok(sets.length >= 1);
      for (const s of sets) assert.match(s, /^genero = '(hombre|mujer)'$/, `SET inesperado: ${s}`);
      assert.ok(!/\b(delete|truncate|drop|alter|insert)\b/i.test(sql), "solo UPDATE de genero");
    });
  }
});
