/**
 * CMS comercial — los scripts de aprovisionamiento de Delacour (supabase/provisioning/delacour) ejecutados de verdad en Postgres embebido: habilitan el módulo solo
 * cuando todo está en orden, se niegan en cualquier otro caso, se pueden repetir y su reversa funciona. El de verificación solo lee.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { crearBaseCms, sqlSinMetacomandos, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { TENANT_A, TENANT_B } from "@/lib/cms-comercial/testing/fixtures";

const verificar = () => sqlSinMetacomandos(readFileSync("supabase/provisioning/delacour/01_verificar_cms_comercial_solo_lectura.sql", "utf8"));
const habilitar = () => sqlSinMetacomandos(readFileSync("supabase/provisioning/delacour/02_habilitar_cms_comercial.sql", "utf8"));

const abiertas: BaseCms[] = [];
afterEach(async () => {
  while (abiertas.length) await abiertas.pop()?.cerrar();
});

/** Un Delacour sintético: su tienda publicada y su catálogo habilitado. */
async function delacour(opciones: { migracion?: boolean; catalogo?: boolean; tiendas?: number } = {}) {
  const b = await crearBaseCms({ aplicarMigracion: opciones.migracion !== false });
  abiertas.push(b);
  await b.aplicarSql("create table public.dulabs_catalogo_publicacion (id_tenant uuid not null, slug text not null, nombre_publico text not null default 'x', publicado boolean not null default true)");
  for (let i = 0; i < (opciones.tiendas ?? 1); i++) await b.aplicarSql(`insert into public.dulabs_catalogo_publicacion (id_tenant, slug) values ('${i === 0 ? TENANT_A : TENANT_B}', 'delacour')`);
  if (opciones.catalogo !== false) await b.aplicarSql(`insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values ('${TENANT_A}', 'catalogo', true)`);
  return b;
}

const moduloDe = async (b: BaseCms, tenant = TENANT_A) => (await b.sql<{ habilitado: boolean }>("select habilitado from public.dulabs_tenant_modulos where id_tenant = $1 and modulo = 'cms_comercial'", [tenant])).map((x) => x.habilitado);
const comprobaciones = async (b: BaseCms) => Object.fromEntries((await b.sql<{ comprobacion: string; ok: boolean; detalle: string }>(verificar())).map((r) => [r.comprobacion, r]));

describe("02_habilitar_cms_comercial.sql", () => {
  it("con todo en orden enciende el módulo SOLO para Delacour", async () => {
    const b = await delacour();
    await b.aplicarSql(`insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado) values ('${TENANT_B}', 'catalogo', true)`);
    assert.deepEqual(await moduloDe(b), []);
    await b.aplicarSql(habilitar());
    assert.deepEqual(await moduloDe(b), [true]);
    assert.deepEqual(await moduloDe(b, TENANT_B), [], "otro negocio no se toca");
    assert.deepEqual((await b.sql<{ modulo: string }>("select modulo from public.dulabs_tenant_modulos where id_tenant = $1 order by 1", [TENANT_A])).map((x) => x.modulo), ["catalogo", "cms_comercial"]);
  });

  it("se puede repetir y reactiva un módulo apagado", async () => {
    const b = await delacour();
    await b.aplicarSql(habilitar());
    await b.aplicarSql(habilitar());
    assert.deepEqual(await moduloDe(b), [true]);
    await b.habilitarModulo(TENANT_A, false);
    await b.aplicarSql(habilitar());
    assert.deepEqual(await moduloDe(b), [true]);
  });

  it("se NIEGA si falta la migración", async () => {
    const b = await delacour({ migracion: false });
    await assert.rejects(b.aplicarSql(habilitar()), /falta aplicar la migración/);
    assert.deepEqual(await moduloDe(b), []);
  });

  it("se NIEGA si la tienda no existe o está duplicada", async () => {
    const sin = await delacour({ tiendas: 0 });
    await assert.rejects(sin.aplicarSql(habilitar()), /exactamente UNA publicación.*hay 0/);
    const dos = await delacour({ tiendas: 2 });
    await assert.rejects(dos.aplicarSql(habilitar()), /exactamente UNA publicación.*hay 2/);
    assert.deepEqual(await moduloDe(sin), []);
    assert.deepEqual(await moduloDe(dos), []);
  });

  it("se NIEGA si el catálogo del negocio no está habilitado", async () => {
    const b = await delacour({ catalogo: false });
    await assert.rejects(b.aplicarSql(habilitar()), /necesita el catálogo/);
    assert.deepEqual(await moduloDe(b), []);
  });

  it("la reversa documentada en su encabezado apaga el módulo sin borrar contenido", async () => {
    const b = await delacour();
    await b.aplicarSql(habilitar());
    await b.aplicarSql(`select public.dulabs_cms_crear('${TENANT_A}', 'oferta', 'amor', '{"nombre":"Amor"}'::jsonb, null, 'Ana')`);
    await b.aplicarSql(
      `update public.dulabs_tenant_modulos set habilitado = false, updated_at = now() where modulo = 'cms_comercial' and id_tenant = (select id_tenant from public.dulabs_catalogo_publicacion where slug = 'delacour')`,
    );
    assert.deepEqual(await moduloDe(b), [false]);
    assert.equal((await b.sql("select 1 from public.dulabs_cms_entidades")).length, 1);
    assert.equal((await b.sql<{ r: { habilitado: boolean } }>(`select public.dulabs_cms_lectura_activa('${TENANT_A}') as r`))[0].r.habilitado, false);
  });
});

describe("01_verificar_cms_comercial_solo_lectura.sql", () => {
  it("antes de habilitar: todo en orden salvo el módulo, que sigue apagado", async () => {
    const b = await delacour();
    const c = await comprobaciones(b);
    for (const clave of ["migracion_aplicada", "rls_activa", "funciones_solo_service", "tienda_unica"]) assert.equal(c[clave].ok, true, clave);
    assert.equal(c.modulo_habilitado.ok, false);
    assert.deepEqual([c.publicados.detalle, c.borradores.detalle, c.pausados.detalle, c.otros_negocios.detalle], ["0", "0", "0", "0"]);
  });

  it("después de habilitar: el módulo figura habilitado y cuenta cada estado y los otros negocios", async () => {
    const b = await delacour();
    await b.aplicarSql(habilitar());
    await b.aplicarSql(`select public.dulabs_cms_crear('${TENANT_A}', 'oferta', 'amor', '{"nombre":"Amor"}'::jsonb, null, 'Ana')`);
    await b.aplicarSql(`select public.dulabs_cms_crear('${TENANT_B}', 'oferta', 'ajena', '{"nombre":"Ajena"}'::jsonb, null, 'Eva')`);
    const c = await comprobaciones(b);
    assert.equal(c.modulo_habilitado.ok, true);
    assert.equal(c.borradores.detalle, "1");
    assert.equal(c.otros_negocios.detalle, "1");
  });

  it("no cambia nada (solo lee)", async () => {
    const b = await delacour();
    await b.aplicarSql(habilitar());
    const antes = JSON.stringify(await b.sql("select * from public.dulabs_tenant_modulos order by 1, 2"));
    await comprobaciones(b);
    await comprobaciones(b);
    assert.equal(JSON.stringify(await b.sql("select * from public.dulabs_tenant_modulos order by 1, 2")), antes);
    assert.equal((await b.sql("select 1 from public.dulabs_cms_auditoria")).length, 0);
  });

  it("detecta una función abierta a anon (la comprobación de permisos funciona de verdad)", async () => {
    const b = await delacour();
    await b.aplicarSql("grant execute on function public.dulabs_cms_lectura_activa(uuid) to anon");
    assert.equal((await comprobaciones(b)).funciones_solo_service.ok, false);
  });
});
