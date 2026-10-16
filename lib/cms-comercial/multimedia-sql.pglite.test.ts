/**
 * CMS comercial — la migración de las FOTOS Y VIDEOS del inicio (20261212000000) en Postgres embebido (PGlite): sobre las migraciones anteriores, repetida, sin ellas (cómo estaba la base antes),
 * sobre datos que ya existían, con las verificaciones SQL del repositorio (supabase/tests) y con su REVERSA. Nada toca Supabase ni ninguna base real.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { TENANT_A } from "@/lib/cms-comercial/testing/fixtures";
import { crearBaseCms, MIGRACION_MULTIMEDIA, MIGRACION_PIE, PRUEBA_SQL_MULTIMEDIA, ROLLBACK_MULTIMEDIA, rutaMigracion, rutaPruebaSql, rutaRollback, sqlSinMetacomandos, type BaseCms } from "@/lib/cms-comercial/testing/pglite";

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
const crearArchivo = (b: BaseCms, id: string, mime: string, nombre: string, bytes = 1_000_000) =>
  b
    .sql<{ r: { resultado: string } }>("select public.dulabs_cms_asset_crear($1::uuid, $2::uuid, $3, $4, $5, 1280, 720, $6, $7::uuid) as r", [TENANT_A, id, `${TENANT_A}/cms/${id}/${nombre}`, mime, bytes, nombre, ACTOR])
    .then((f) => f[0].r.resultado);

const VIDEO = "e0000000-0000-4000-8000-0000000000e1";
const IMAGEN = "e0000000-0000-4000-8000-0000000000e2";
const MP4 = "video.mp4";
const WEBP = "imagen.webp";

/** Huella del esquema del CMS: tablas, funciones, índices y triggers (las restricciones se comparan aparte, con su definición). */
async function huella(b: BaseCms) {
  const [t, f, i, g, c] = await Promise.all([
    b.sql<{ n: string }>("select tablename as n from pg_tables where schemaname = 'public' and tablename like 'dulabs_cms_%' order by 1"),
    b.sql<{ n: string }>("select p.oid::regprocedure::text as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dulabs\\_cms\\_%' order by 1"),
    b.sql<{ n: string }>("select indexname as n from pg_indexes where schemaname = 'public' and tablename like 'dulabs_cms_%' order by 1"),
    b.sql<{ n: string }>("select tgname as n from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'dulabs_cms_%' order by 1"),
    b.sql<{ n: string; d: string }>("select conname as n, pg_get_constraintdef(oid) as d from pg_constraint where conrelid::regclass::text like 'dulabs_cms_%' order by 1"),
  ]);
  return {
    tablas: t.map((x) => x.n),
    funciones: f.map((x) => x.n),
    indices: i.map((x) => x.n),
    triggers: g.map((x) => x.n),
    restricciones: c.map((x) => x.n),
    definiciones: Object.fromEntries(c.map((x) => [x.n, x.d])),
  };
}

/** Lo que ya estaba guardado, tal cual (para comprobar que la migración no toca ningún dato). */
async function datos(b: BaseCms) {
  const [e, a, v] = await Promise.all([
    b.sql<{ h: string; n: number }>("select coalesce(md5(string_agg(x::text, '|' order by x.id)), '') as h, count(*)::int as n from public.dulabs_cms_entidades x"),
    b.sql<{ h: string; n: number }>("select coalesce(md5(string_agg(x::text, '|' order by x.id)), '') as h, count(*)::int as n from public.dulabs_cms_assets x"),
    b.sql<{ h: string; n: number }>("select coalesce(md5(string_agg(x::text, '|' order by x.id)), '') as h, count(*)::int as n from public.dulabs_cms_auditoria x"),
  ]);
  return { entidades: e[0], assets: a[0], auditoria: v[0] };
}

describe("migración de las fotos y videos del inicio", () => {
  it("sobre las migraciones anteriores: no crea ni cambia tablas, funciones, índices ni triggers; solo suma la regla de un único código", async () => {
    const antes = await huella(await base({ conMultimedia: false }));
    const despues = await huella(await base());
    assert.deepEqual(despues.tablas, antes.tablas);
    assert.deepEqual(despues.funciones, antes.funciones);
    assert.deepEqual(despues.indices, antes.indices);
    assert.deepEqual(despues.triggers, antes.triggers);
    assert.deepEqual(despues.restricciones.filter((n) => !antes.restricciones.includes(n)), ["dulabs_cms_entidades_multimedia_ck"]);
    assert.deepEqual(antes.restricciones.filter((n) => !despues.restricciones.includes(n)), [], "no se quitó ninguna restricción (las tres que se ampliaron conservan su nombre)");
    const cambiadas = Object.keys(antes.definiciones).filter((n) => antes.definiciones[n] !== despues.definiciones[n]).sort();
    assert.deepEqual(cambiadas, ["dulabs_cms_assets_mime_ck", "dulabs_cms_auditoria_tipo_ck", "dulabs_cms_entidades_tipo_ck"], "solo esas tres restricciones cambian, y solo para admitir valores nuevos");
  });

  it("es idempotente: aplicarla dos y tres veces no cambia nada ni falla", async () => {
    const una = await huella(await base());
    const tres = await huella(await base({ veces: 3 }));
    assert.deepEqual(tres, una);
  });

  it("falla con un mensaje claro si no se aplicó antes la migración base o la del pie y las páginas", async () => {
    const sinNada = await base({ aplicarMigracion: false });
    await assert.rejects(sinNada.aplicarSql(readFileSync(rutaMigracion(MIGRACION_MULTIMEDIA), "utf8")), /falta aplicar antes 20261210000000_dulabs_cms_comercial\.sql/);
    const soloBase = await base({ conPie: false });
    await assert.rejects(soloBase.aplicarSql(readFileSync(rutaMigracion(MIGRACION_MULTIMEDIA), "utf8")), /falta aplicar antes 20261211000000_dulabs_cms_pie_y_paginas\.sql/);
    await soloBase.aplicarSql("rollback");
    assert.equal(await crear(soloBase, "multimedia", "multimedia"), "invalido", "y no quedó a medias");
  });

  it("ANTES de la migración ni las fotos y videos ni un video MP4 se pueden guardar (la aplicación lo avisa) y lo demás funciona; DESPUÉS, sí, y lo anterior sigue igual", async () => {
    const b = await base({ conMultimedia: false });
    assert.equal(await crear(b, "multimedia", "multimedia"), "invalido");
    assert.equal(await crearArchivo(b, VIDEO, "video/mp4", MP4), "invalido");
    assert.equal(await crear(b, "home", "home"), "ok");
    assert.equal(await crear(b, "pie", "pie"), "ok");
    assert.equal(await crear(b, "pagina", "politica-de-privacidad"), "ok");
    assert.equal(await crearArchivo(b, IMAGEN, "image/webp", WEBP), "ok");
    const previo = await datos(b);

    await b.aplicarSql(readFileSync(rutaMigracion(MIGRACION_MULTIMEDIA), "utf8"));
    assert.deepEqual(await datos(b), previo, "la migración no toca ni una fila de lo que ya había");
    assert.equal(await crear(b, "multimedia", "multimedia"), "ok", "la base que ya tenía datos acepta las fotos y videos tras la migración");
    assert.equal(await crearArchivo(b, VIDEO, "video/mp4", MP4), "ok", "y un video MP4");
    assert.equal(await crear(b, "multimedia", "multimedia"), "clave_existente", "pero solo uno por negocio");
  });

  it("solo admite video MP4: otros formatos de video, imágenes raras y pesos fuera de rango se siguen rechazando", async () => {
    const b = await base();
    for (const [mime, nombre] of [
      ["video/webm", "v.webm"],
      ["video/quicktime", "v.mov"],
      ["video/x-matroska", "v.mkv"],
      ["image/gif", "i.gif"],
      ["image/svg+xml", "i.svg"],
      ["application/pdf", "d.pdf"],
      ["text/html", "p.html"],
    ] as const) {
      assert.equal(await crearArchivo(b, VIDEO, mime, nombre), "invalido", mime);
    }
    assert.equal(await crearArchivo(b, VIDEO, "video/mp4", MP4, 10_485_761), "invalido", "el tope de 10 MB por archivo sigue");
    assert.equal(await crearArchivo(b, VIDEO, "video/mp4", MP4, 0), "invalido", "y no puede pesar 0");
    assert.equal(await crearArchivo(b, VIDEO, "video/mp4", MP4, 3_000_000), "ok");
    assert.equal(await crearArchivo(b, IMAGEN, "image/webp", WEBP), "ok", "las imágenes de siempre siguen");
    assert.equal(await crearArchivo(b, "e0000000-0000-4000-8000-0000000000e3", "image/jpeg", "a.jpg"), "ok");
    assert.equal(await crearArchivo(b, "e0000000-0000-4000-8000-0000000000e4", "image/png", "a.png"), "ok");
  });

  it("un video queda pendiente hasta que el servidor lo confirme, y solo entonces lo ve la tienda", async () => {
    const b = await base();
    await b.habilitarModulo(TENANT_A);
    assert.equal(await crearArchivo(b, VIDEO, "video/mp4", MP4), "ok");
    const ids = async () => ((await b.sql<{ r: { assets: { id: string; mime_type: string }[] } }>("select public.dulabs_cms_lectura_activa($1::uuid) as r", [TENANT_A]))[0].r.assets).map((a) => `${a.id}:${a.mime_type}`);
    assert.deepEqual(await ids(), [], "pendiente: la tienda no lo ve");
    const [conf] = await b.sql<{ r: { resultado: string; asset: { estado: string; bytes: number } } }>("select public.dulabs_cms_asset_confirmar($1::uuid, $2::uuid, 1400000, 1280, 720, $3::uuid, 'Ana') as r", [TENANT_A, VIDEO, ACTOR]);
    assert.deepEqual([conf.r.resultado, conf.r.asset.estado, conf.r.asset.bytes], ["ok", "listo", 1_400_000]);
    assert.deepEqual(await ids(), [`${VIDEO}:video/mp4`], "confirmado: ya sale, con su tipo");
  });

  it("las verificaciones SQL del repositorio (supabase/tests) pasan sobre la migración aplicada dos veces", async () => {
    const b = await base({ veces: 2 });
    await b.aplicarSql(sqlSinMetacomandos(readFileSync(rutaPruebaSql(PRUEBA_SQL_MULTIMEDIA), "utf8")));
    const tipos = await b.sql<{ entidad_tipo: string }>("select distinct entidad_tipo from public.dulabs_cms_auditoria order by 1");
    assert.deepEqual(tipos.map((t) => t.entidad_tipo), ["imagen", "multimedia", "pagina", "pie"]);
  });

  it("si por error se vuelve a ejecutar la del pie DESPUÉS de esta, el valor se quita y volver a ejecutar esta lo devuelve; con datos guardados esa repetición se niega sin cambiar nada", async () => {
    const limpia = await base();
    const completa = await huella(limpia);
    await limpia.aplicarSql(readFileSync(rutaMigracion(MIGRACION_PIE), "utf8"));
    assert.equal(await crear(limpia, "multimedia", "multimedia"), "invalido", "mientras tanto las fotos y videos no se pueden crear (la aplicación avisa que no están disponibles)");
    await limpia.aplicarSql(readFileSync(rutaMigracion(MIGRACION_MULTIMEDIA), "utf8"));
    assert.deepEqual(await huella(limpia), completa);
    assert.equal(await crear(limpia, "multimedia", "multimedia"), "ok");

    const conDatos = await base();
    assert.equal(await crear(conDatos, "multimedia", "multimedia"), "ok");
    const antes = { huella: await huella(conDatos), datos: await datos(conDatos) };
    await assert.rejects(conDatos.aplicarSql(readFileSync(rutaMigracion(MIGRACION_PIE), "utf8")), /violat|viola/i);
    await conDatos.aplicarSql("rollback");
    assert.deepEqual({ huella: await huella(conDatos), datos: await datos(conDatos) }, antes, "el rechazo no dejó nada a medias");
  });
});

describe("reversa de la migración de las fotos y videos (supabase/rollbacks)", () => {
  const rollback = () => readFileSync(rutaRollback(ROLLBACK_MULTIMEDIA), "utf8").replace(/^\\set .*$/gm, "");

  it("sin fotos y videos ni videos guardados deja el esquema EXACTAMENTE como estaba antes de la migración; y se puede repetir y volver a aplicar", async () => {
    const referencia = await huella(await base({ conMultimedia: false }));
    const b = await base();
    await b.aplicarSql(rollback());
    await b.aplicarSql(rollback());
    assert.deepEqual(await huella(b), referencia, "mismas tablas, funciones, índices, triggers y restricciones con la misma definición");
    assert.equal(await crear(b, "multimedia", "multimedia"), "invalido");
    assert.equal(await crearArchivo(b, VIDEO, "video/mp4", MP4), "invalido");
    assert.equal(await crear(b, "pie", "pie"), "ok", "el pie sigue");
    assert.equal(await crear(b, "pagina", "politica"), "ok", "y las páginas");
    assert.equal(await crear(b, "home", "home"), "ok", "y la página principal");
    // y se puede volver a aplicar la migración
    await b.aplicarSql(readFileSync(rutaMigracion(MIGRACION_MULTIMEDIA), "utf8"));
    assert.equal(await crear(b, "multimedia", "multimedia"), "ok");
  });

  it("las imágenes ya guardadas no impiden volver atrás (solo los videos, las fotos y videos y su historial)", async () => {
    const b = await base();
    assert.equal(await crearArchivo(b, IMAGEN, "image/webp", WEBP), "ok");
    await b.aplicarSql(rollback());
    assert.equal((await b.sql("select 1 from public.dulabs_cms_assets where id = $1", [IMAGEN])).length, 1, "la imagen sigue ahí");
  });

  it("se NIEGA a correr si ya existen fotos y videos (su historial es de solo añadir) y no cambia nada", async () => {
    const b = await base();
    assert.equal(await crear(b, "multimedia", "multimedia"), "ok");
    const antes = { huella: await huella(b), datos: await datos(b) };
    await assert.rejects(b.aplicarSql(rollback()), /ya existen fotos y videos o videos guardados \(1 elementos, 1 registros de historial, 0 videos\)/);
    await b.aplicarSql("rollback");
    assert.deepEqual({ huella: await huella(b), datos: await datos(b) }, antes);
    assert.equal((await b.sql("select 1 from public.dulabs_cms_entidades where tipo = 'multimedia'")).length, 1, "las fotos y videos siguen ahí");
  });

  it("se NIEGA a correr si ya hay un video guardado, aunque no existan fotos y videos, y no cambia nada", async () => {
    const b = await base();
    assert.equal(await crearArchivo(b, VIDEO, "video/mp4", MP4), "ok");
    const antes = { huella: await huella(b), datos: await datos(b) };
    await assert.rejects(b.aplicarSql(rollback()), /\(0 elementos, 0 registros de historial, 1 videos\)/);
    await b.aplicarSql("rollback");
    assert.deepEqual({ huella: await huella(b), datos: await datos(b) }, antes);
    assert.equal(await crearArchivo(b, "e0000000-0000-4000-8000-0000000000e9", "video/mp4", MP4), "ok", "y sigue aceptando videos");
  });

  it("sobre una base que nunca tuvo el CMS no falla (nada que revertir)", async () => {
    const b = await base({ aplicarMigracion: false });
    await b.aplicarSql(rollback());
    assert.deepEqual((await huella(b)).tablas, []);
  });
});
