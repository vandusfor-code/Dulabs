/**
 * CMS comercial — la migración del PIE DE PÁGINA y las PÁGINAS PROPIAS (20261211000000) en Postgres embebido (PGlite): sobre la migración base, repetida, sin ella (cómo estaba la base antes), con las
 * verificaciones SQL del repositorio (supabase/tests) y con su REVERSA. Nada toca Supabase ni ninguna base real.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { TENANT_A } from "@/lib/cms-comercial/testing/fixtures";
import { crearBaseCms, PRUEBA_SQL_PIE, ROLLBACK_PIE, rutaMigracion, rutaPruebaSql, rutaRollback, sqlSinMetacomandos, MIGRACION_PIE, type BaseCms } from "@/lib/cms-comercial/testing/pglite";

const abiertas: BaseCms[] = [];
async function base(opciones?: Parameters<typeof crearBaseCms>[0]) {
  const b = await crearBaseCms(opciones);
  abiertas.push(b);
  return b;
}
afterEach(async () => {
  while (abiertas.length) await abiertas.pop()?.cerrar();
});

const ACTOR = "dddddddd-0000-4000-8000-00000000000d";
const crear = (b: BaseCms, tipo: string, clave: string) =>
  b.sql<{ r: { resultado: string } }>("select public.dulabs_cms_crear($1::uuid, $2, $3, '{}'::jsonb, $4::uuid, 'Ana') as r", [TENANT_A, tipo, clave, ACTOR]).then((f) => f[0].r.resultado);

/** Huella del esquema del CMS: tablas, funciones, índices y triggers (las restricciones se comparan aparte). */
async function huella(b: BaseCms) {
  const [t, f, i, g, c] = await Promise.all([
    b.sql<{ n: string }>("select tablename as n from pg_tables where schemaname = 'public' and tablename like 'dulabs_cms_%' order by 1"),
    b.sql<{ n: string }>("select p.oid::regprocedure::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dulabs\\_cms\\_%' order by 1"),
    b.sql<{ n: string }>("select indexname as n from pg_indexes where schemaname = 'public' and tablename like 'dulabs_cms_%' order by 1"),
    b.sql<{ n: string }>("select tgname as n from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'dulabs_cms_%' order by 1"),
    b.sql<{ n: string }>("select conname as n from pg_constraint where conrelid::regclass::text like 'dulabs_cms_%' order by 1"),
  ]);
  return { tablas: t.map((x) => x.n), funciones: f.map((x) => x.n), indices: i.map((x) => x.n), triggers: g.map((x) => x.n), restricciones: c.map((x) => x.n) };
}

describe("migración del pie de página y las páginas", () => {
  it("sobre la migración base: no crea ni cambia tablas, funciones, índices ni triggers; solo suma la regla de un único pie", async () => {
    const antes = await huella(await base({ conPie: false }));
    const despues = await huella(await base());
    assert.deepEqual(despues.tablas, antes.tablas);
    assert.deepEqual(despues.funciones, antes.funciones);
    assert.deepEqual(despues.indices, antes.indices);
    assert.deepEqual(despues.triggers, antes.triggers);
    assert.deepEqual(despues.restricciones.filter((n) => !antes.restricciones.includes(n)), ["dulabs_cms_entidades_pie_ck"]);
    assert.deepEqual(antes.restricciones.filter((n) => !despues.restricciones.includes(n)), [], "no se quitó ninguna restricción (las dos que se ampliaron conservan su nombre)");
  });

  it("es idempotente: aplicarla dos y tres veces no cambia nada ni falla", async () => {
    const una = await huella(await base());
    const tres = await huella(await base({ veces: 3 }));
    assert.deepEqual(tres, una);
  });

  it("falla con un mensaje claro si no se aplicó antes la migración base", async () => {
    const b = await base({ aplicarMigracion: false });
    await assert.rejects(b.aplicarSql(readFileSync(rutaMigracion(MIGRACION_PIE), "utf8")), /falta aplicar antes 20261210000000_dulabs_cms_comercial\.sql/);
  });

  it("ANTES de la migración ni el pie ni las páginas se pueden crear (la aplicación lo avisa) y los demás tipos funcionan; DESPUÉS, sí, y lo anterior sigue igual", async () => {
    const antes = await base({ conPie: false });
    assert.equal(await crear(antes, "pie", "pie"), "invalido");
    assert.equal(await crear(antes, "pagina", "politica-de-privacidad"), "invalido");
    assert.equal(await crear(antes, "home", "home"), "ok");
    assert.equal(await crear(antes, "contenido", "horario"), "ok");
    await antes.aplicarSql(readFileSync(rutaMigracion(MIGRACION_PIE), "utf8"));
    assert.equal(await crear(antes, "pie", "pie"), "ok", "la base que ya tenía datos acepta el pie tras la migración");
    assert.equal(await crear(antes, "pagina", "politica-de-privacidad"), "ok", "y las páginas");
    assert.equal((await antes.sql("select 1 from public.dulabs_cms_entidades where tipo in ('home', 'contenido')")).length, 2, "lo que ya había sigue ahí");
  });

  it("una base que ya aplicó una versión anterior de esta migración (solo el pie) queda igual al volver a aplicarla", async () => {
    // La versión anterior solo dejaba entrar 'pie' en las dos restricciones: se simula y se vuelve a correr.
    const b = await base();
    await b.aplicarSql(`
      alter table public.dulabs_cms_entidades drop constraint dulabs_cms_entidades_tipo_ck;
      alter table public.dulabs_cms_entidades add constraint dulabs_cms_entidades_tipo_ck check (tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie'));
      alter table public.dulabs_cms_auditoria drop constraint dulabs_cms_auditoria_tipo_ck;
      alter table public.dulabs_cms_auditoria add constraint dulabs_cms_auditoria_tipo_ck check (entidad_tipo in ('home', 'oferta', 'combo', 'campana', 'contenido', 'pie', 'imagen'));`);
    assert.equal(await crear(b, "pagina", "politica"), "invalido");
    await b.aplicarSql(readFileSync(rutaMigracion(MIGRACION_PIE), "utf8"));
    assert.equal(await crear(b, "pagina", "politica"), "ok");
  });

  it("las verificaciones SQL del repositorio (supabase/tests) pasan sobre la migración aplicada dos veces", async () => {
    const b = await base({ veces: 2 });
    await b.aplicarSql(sqlSinMetacomandos(readFileSync(rutaPruebaSql(PRUEBA_SQL_PIE), "utf8")));
    const tipos = await b.sql<{ entidad_tipo: string }>("select distinct entidad_tipo from public.dulabs_cms_auditoria order by 1");
    assert.deepEqual(tipos.map((t) => t.entidad_tipo), ["home", "pagina", "pie"]);
  });
});

describe("reversa de la migración del pie y las páginas (supabase/rollbacks)", () => {
  const rollback = () => readFileSync(rutaRollback(ROLLBACK_PIE), "utf8").replace(/^\\set .*$/gm, "");

  it("sin ningún pie ni páginas vuelve las restricciones a como estaban: dejan de poder crearse y lo demás sigue igual; y se puede repetir", async () => {
    const b = await base();
    const completa = await huella(b);
    await b.aplicarSql(rollback());
    await b.aplicarSql(rollback());
    const revertida = await huella(b);
    assert.deepEqual(revertida.restricciones.filter((n) => !completa.restricciones.includes(n)), []);
    assert.deepEqual(completa.restricciones.filter((n) => !revertida.restricciones.includes(n)), ["dulabs_cms_entidades_pie_ck"], "solo se quitó la regla del pie");
    assert.equal(await crear(b, "pie", "pie"), "invalido");
    assert.equal(await crear(b, "pagina", "politica"), "invalido");
    assert.equal(await crear(b, "home", "home"), "ok");
    // y se puede volver a aplicar la migración
    await b.aplicarSql(readFileSync(rutaMigracion(MIGRACION_PIE), "utf8"));
    assert.equal(await crear(b, "pie", "pie"), "ok");
    assert.equal(await crear(b, "pagina", "politica"), "ok");
  });

  it("se NIEGA a correr si ya existe un pie (su historial es de solo añadir) y no cambia nada", async () => {
    const b = await base();
    assert.equal(await crear(b, "pie", "pie"), "ok");
    const antes = await huella(b);
    await assert.rejects(b.aplicarSql(rollback()), /ya existe un pie de página o una página/);
    await b.aplicarSql("rollback");
    assert.deepEqual(await huella(b), antes);
    assert.equal((await b.sql("select 1 from public.dulabs_cms_entidades where tipo = 'pie'")).length, 1, "el pie sigue ahí");
  });

  it("se NIEGA a correr si ya existe una página, aunque no haya pie, y no cambia nada", async () => {
    const b = await base();
    assert.equal(await crear(b, "pagina", "politica-de-privacidad"), "ok");
    const antes = await huella(b);
    await assert.rejects(b.aplicarSql(rollback()), /ya existe un pie de página o una página \(1 elementos, 1 registros de historial\)/);
    await b.aplicarSql("rollback");
    assert.deepEqual(await huella(b), antes);
    assert.equal((await b.sql("select 1 from public.dulabs_cms_entidades where tipo = 'pagina'")).length, 1, "la página sigue ahí");
  });

  it("sobre una base que nunca tuvo el CMS no falla (nada que revertir)", async () => {
    const b = await base({ aplicarMigracion: false });
    await b.aplicarSql(rollback());
    assert.deepEqual((await huella(b)).tablas, []);
  });
});
