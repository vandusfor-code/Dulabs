/**
 * CMS comercial — la SIEMBRA de la vitrina de Delacour (supabase/provisioning/delacour/03_*) ejecutada de verdad en Postgres embebido: publica lo que la tienda ya
 * muestra, el lector de la aplicación lo acepta tal cual (esquema y checksum), no pisa nada, se niega fuera de orden, no toca otros negocios y su reversa
 * despublica sin borrar. Solo lo ejecuta esta prueba: nada se corre en producción.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { checksumDe } from "@/lib/cms-comercial/checksum";
import { crearLectorSupabase } from "@/lib/cms-comercial/lector";
import { homeDesdeVitrina } from "@/lib/cms-comercial/siembra-vitrina";
import { crearDelacourSintetico, scriptReversaSembrar, scriptSembrar, scriptVerificar, type OpcionesDelacour } from "@/lib/cms-comercial/testing/delacour";
import { TENANT_A, TENANT_B } from "@/lib/cms-comercial/testing/fixtures";
import type { BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { storefrontConfigFor } from "@/lib/catalogo/vitrina";

const sembrar = scriptSembrar;
const reversa = scriptReversaSembrar;
const verificar = scriptVerificar;
const homeEsperado = () => homeDesdeVitrina(storefrontConfigFor("delacour"))!;

const abiertas: BaseCms[] = [];
afterEach(async () => {
  while (abiertas.length) await abiertas.pop()?.cerrar();
});

async function delacour(opciones: OpcionesDelacour = {}) {
  const b = await crearDelacourSintetico(opciones);
  abiertas.push(b);
  return b;
}

interface FilaEntidad {
  id: string;
  tipo: string;
  clave: string;
  estado: string;
  rev: number;
  version_activa: number | null;
  borrador: unknown;
  created_by: string | null;
}
const entidades = (b: BaseCms, tenant = TENANT_A) => b.sql<FilaEntidad>("select id, tipo, clave, estado, rev, version_activa, borrador, created_by from public.dulabs_cms_entidades where id_tenant = $1 order by tipo, clave", [tenant]);
const conteos = async (b: BaseCms) => ({
  entidades: (await b.sql("select 1 from public.dulabs_cms_entidades")).length,
  versiones: (await b.sql("select 1 from public.dulabs_cms_versiones")).length,
  auditoria: (await b.sql("select 1 from public.dulabs_cms_auditoria")).length,
});

describe("03_sembrar_vitrina_actual.sql — la siembra", () => {
  it("publica la página principal de hoy como versión 1, firmada como «Siembra inicial» y sin usuario", async () => {
    const b = await delacour();
    await b.aplicarSql(sembrar());
    const filas = await entidades(b);
    assert.equal(filas.length, 1);
    assert.deepEqual([filas[0].tipo, filas[0].clave, filas[0].estado, filas[0].version_activa, filas[0].borrador, filas[0].created_by], ["home", "home", "publicada", 1, null, null]);
    const [v] = await b.sql<{ contenido: unknown; checksum: string; accion: string; nota: string; creado_por: string | null; creado_por_etiqueta: string }>(
      "select contenido, checksum, accion, nota, creado_por, creado_por_etiqueta from public.dulabs_cms_versiones where entidad_id = $1",
      [filas[0].id],
    );
    assert.deepEqual(v.contenido, JSON.parse(JSON.stringify(homeEsperado())));
    assert.equal(v.checksum, checksumDe(homeEsperado()));
    assert.equal(v.checksum, checksumDe(v.contenido), "el checksum guardado es el del contenido que quedó en la base");
    assert.deepEqual([v.accion, v.creado_por, v.creado_por_etiqueta], ["publicar", null, "Siembra inicial (DuLabs)"]);
    assert.match(v.nota, /Siembra inicial/);
  });

  it("queda en el historial: crear y publicar, con la firma de la siembra", async () => {
    const b = await delacour();
    await b.aplicarSql(sembrar());
    const a = await b.sql<{ accion: string; actor_etiqueta: string; actor_user_id: string | null }>("select accion, actor_etiqueta, actor_user_id from public.dulabs_cms_auditoria order by id");
    assert.deepEqual(a.map((x) => x.accion), ["crear", "publicar"]);
    for (const x of a) assert.deepEqual([x.actor_etiqueta, x.actor_user_id], ["Siembra inicial (DuLabs)", null]);
  });

  it("el LECTOR de la aplicación lo acepta sin descartar nada (esquema estricto y checksum) y lo entrega igual a lo esperado", async () => {
    const b = await delacour();
    await b.aplicarSql(sembrar());
    const original = console.warn;
    const avisos: unknown[][] = [];
    console.warn = (...a: unknown[]) => void avisos.push(a);
    try {
      const snap = await crearLectorSupabase(b.supabase).cargar(TENANT_A);
      assert.ok(snap?.home, "la página principal está publicada y vigente");
      assert.deepEqual(snap.home.contenido, homeEsperado());
      assert.equal(snap.home.version, 1);
      assert.equal(snap.ofertas.length + snap.combos.length + snap.campanas.length + snap.contenidos.length, 0);
    } finally {
      console.warn = original;
    }
    assert.deepEqual(avisos, [], "el lector no descartó nada");
  });

  it("se puede correr dos veces: la segunda no cambia nada (no pisa)", async () => {
    const b = await delacour();
    await b.aplicarSql(sembrar());
    const antes = JSON.stringify([await entidades(b), await conteos(b)]);
    await b.aplicarSql(sembrar());
    assert.equal(JSON.stringify([await entidades(b), await conteos(b)]), antes);
  });

  it("NO pisa el trabajo de la administradora: con una página principal ya creada por ella (aunque sea un borrador) no hace nada", async () => {
    const b = await delacour();
    await b.aplicarSql(`select public.dulabs_cms_crear('${TENANT_A}', 'home', 'home', '{"titulo":"Mi portada"}'::jsonb, null, 'Ana')`);
    const antes = JSON.stringify([await entidades(b), await conteos(b)]);
    await b.aplicarSql(sembrar());
    assert.equal(JSON.stringify([await entidades(b), await conteos(b)]), antes);
    const [e] = await entidades(b);
    assert.deepEqual([e.estado, e.borrador], ["borrador", { titulo: "Mi portada" }]);
  });

  it("solo siembra el negocio de la tienda «delacour»: el contenido de otro negocio ni se toca ni se cuenta", async () => {
    const b = await delacour();
    await b.aplicarSql(`select public.dulabs_cms_crear('${TENANT_B}', 'home', 'home', '{"titulo":"Otra tienda"}'::jsonb, null, 'Eva')`);
    await b.aplicarSql(sembrar());
    assert.equal((await entidades(b)).length, 1);
    const ajenas = await entidades(b, TENANT_B);
    assert.deepEqual([ajenas.length, ajenas[0].estado, ajenas[0].borrador], [1, "borrador", { titulo: "Otra tienda" }]);
    assert.equal((await b.sql("select 1 from public.dulabs_cms_versiones where id_tenant = $1", [TENANT_B])).length, 0);
  });

  it("se NIEGA fuera de orden y no deja nada: sin migración, sin módulo habilitado, sin tienda o con la tienda duplicada", async () => {
    await assert.rejects((await delacour({ migracion: false })).aplicarSql(sembrar()), /falta aplicar la migración/);

    const sinModulo = await delacour({ modulo: false });
    await assert.rejects(sinModulo.aplicarSql(sembrar()), /el módulo cms_comercial no está habilitado/);
    assert.deepEqual(await conteos(sinModulo), { entidades: 0, versiones: 0, auditoria: 0 });

    const apagado = await delacour();
    await apagado.habilitarModulo(TENANT_A, false);
    await assert.rejects(apagado.aplicarSql(sembrar()), /el módulo cms_comercial no está habilitado/);

    await assert.rejects((await delacour({ tiendas: 0 })).aplicarSql(sembrar()), /exactamente UNA publicación.*hay 0/);
    await assert.rejects((await delacour({ tiendas: 2 })).aplicarSql(sembrar()), /exactamente UNA publicación.*hay 2/);
  });

  it("antes del módulo la tienda no cambia: sin habilitar, el lector devuelve null aunque el contenido existiera", async () => {
    const b = await delacour();
    await b.aplicarSql(sembrar());
    await b.habilitarModulo(TENANT_A, false);
    assert.equal(await crearLectorSupabase(b.supabase).cargar(TENANT_A), null);
  });

  it("el script de verificación cuenta la página sembrada como publicada", async () => {
    const b = await delacour();
    await b.aplicarSql(sembrar());
    const c = Object.fromEntries((await b.sql<{ comprobacion: string; detalle: string }>(verificar())).map((r) => [r.comprobacion, r.detalle]));
    assert.deepEqual([c.publicados, c.borradores, c.pausados], ["1", "0", "0"]);
  });
});

describe("03_sembrar_vitrina_actual.reversa.sql — deshacer la siembra", () => {
  it("despublica la página: vuelve a borrador con el mismo contenido, el lector ya no la ve y NADA se borra", async () => {
    const b = await delacour();
    await b.aplicarSql(sembrar());
    const antes = await conteos(b);
    await b.aplicarSql(reversa());
    const [e] = await entidades(b);
    assert.deepEqual([e.estado, e.version_activa], ["borrador", null]);
    assert.deepEqual(e.borrador, JSON.parse(JSON.stringify(homeEsperado())), "el contenido se conserva como borrador");
    const despues = await conteos(b);
    assert.equal(despues.versiones, antes.versiones, "la versión 1 sigue en el historial");
    assert.equal(despues.auditoria, antes.auditoria + 1, "y la reversa quedó auditada");
    assert.equal((await crearLectorSupabase(b.supabase).cargar(TENANT_A))?.home, null, "la tienda vuelve a su portada de siempre");
    const [ultima] = await b.sql<{ accion: string; actor_etiqueta: string }>("select accion, actor_etiqueta from public.dulabs_cms_auditoria order by id desc limit 1");
    assert.deepEqual([ultima.accion, ultima.actor_etiqueta], ["despublicar", "Reversa de la siembra inicial (DuLabs)"]);
  });

  it("se puede repetir y, sin página principal o ya despublicada, no hace nada", async () => {
    const vacio = await delacour();
    await vacio.aplicarSql(reversa());
    assert.deepEqual(await conteos(vacio), { entidades: 0, versiones: 0, auditoria: 0 });
    const b = await delacour();
    await b.aplicarSql(sembrar());
    await b.aplicarSql(reversa());
    const antes = JSON.stringify(await conteos(b));
    await b.aplicarSql(reversa());
    assert.equal(JSON.stringify(await conteos(b)), antes);
  });

  it("se NIEGA si la administradora ya publicó cambios (versión 2): perdería su trabajo en vivo; con la confirmación explícita sí", async () => {
    const b = await delacour();
    await b.aplicarSql(sembrar());
    const [e] = await entidades(b);
    const nuevo = { ...JSON.parse(JSON.stringify(homeEsperado())), portada: { ...homeEsperado().portada, titulo: "Nueva portada" } };
    await b.aplicarSql(`select public.dulabs_cms_guardar_borrador('${TENANT_A}', '${e.id}', '${JSON.stringify(nuevo).replace(/'/g, "''")}'::jsonb, ${e.rev}, null, 'Ana')`);
    const [editado] = await entidades(b);
    await b.aplicarSql(`select public.dulabs_cms_publicar('${TENANT_A}', '${e.id}', ${editado.rev}, 1, '${checksumDe(nuevo)}', 'Cambio de portada', null, 'Ana')`);
    await assert.rejects(b.aplicarSql(reversa()), /ya publicó la versión 2/);
    assert.equal((await entidades(b))[0].estado, "publicada", "sigue en vivo");
    await b.aplicarSql(`set dulabs.confirmar_reversa_siembra = 'si'; ${reversa()}`);
    assert.equal((await entidades(b))[0].estado, "borrador");
  });

  it("se NIEGA si no existe la tienda", async () => {
    await assert.rejects((await delacour({ tiendas: 0 })).aplicarSql(reversa()), /no existe una publicación/);
  });
});
