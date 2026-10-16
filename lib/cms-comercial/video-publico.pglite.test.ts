/**
 * CMS comercial — el video PÚBLICO de la vitrina con el LECTOR REAL sobre el SQL real (Postgres embebido): la lectura entrega los videos listos del negocio y el elemento «fotos y videos»
 * publicado; la ruta solo sirve los que usa contenido PUBLICADO de ese negocio. Aislamiento por negocio, módulo apagado, borradores, pausados, reemplazos y restauraciones, contra la base de verdad.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { PublicImageObject } from "@/lib/catalogo/repository";
import { checksumDe } from "@/lib/cms-comercial/checksum";
import { responderImagenCms } from "@/lib/cms-comercial/imagen-publica";
import { crearLectorSupabase } from "@/lib/cms-comercial/lector";
import { crearDelacourSintetico } from "@/lib/cms-comercial/testing/delacour";
import { TENANT_A, TENANT_B } from "@/lib/cms-comercial/testing/fixtures";
import type { BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { responderVideoCms, type DepsVideoPublico } from "@/lib/cms-comercial/video-publico";

const V1 = "a1000000-0000-4000-8000-000000000001";
const P1 = "a1000000-0000-4000-8000-000000000002";
const V2 = "a1000000-0000-4000-8000-000000000003";
const P2 = "a1000000-0000-4000-8000-000000000004";
const V_SUELTO = "a1000000-0000-4000-8000-000000000005";
const V_PENDIENTE = "a1000000-0000-4000-8000-000000000006";
const V_B = "b1000000-0000-4000-8000-000000000001";
const P_B = "b1000000-0000-4000-8000-000000000002";

const abiertas: BaseCms[] = [];
afterEach(async () => {
  while (abiertas.length) await abiertas.pop()?.cerrar();
});

const archivo = (v: string, p: string) => ({ video: v, poster: p });
const multimedia = (v: string, p: string) => ({ videos: { portada: { horizontal: archivo(v, p) } } });

async function video(b: BaseCms, tenant: string, id: string, listo = true, mime = "video/mp4", ruta = "video.mp4") {
  await b.sql("select public.dulabs_cms_asset_crear($1, $2, $3, $4, 1500000, 1280, 720, 'v.mp4', null)", [tenant, id, `${tenant}/cms/${id}/${ruta}`, mime]);
  if (listo) await b.sql("select public.dulabs_cms_asset_confirmar($1, $2, 1500000, 1280, 720, null, 'Prueba')", [tenant, id]);
}
async function imagen(b: BaseCms, tenant: string, id: string) {
  await b.sql("select public.dulabs_cms_asset_crear($1, $2, $3, 'image/webp', 1000, 1280, 720, 'p.webp', null)", [tenant, id, `${tenant}/cms/${id}/imagen.webp`]);
  await b.sql("select public.dulabs_cms_asset_confirmar($1, $2, 1000, 1280, 720, null, 'Prueba')", [tenant, id]);
}

/** Crea y PUBLICA un elemento directamente en SQL (sin la validación de la aplicación: así se prueba la ruta incluso con contenido que la aplicación no dejaría publicar). */
async function publicar(b: BaseCms, tenant: string, tipo: string, clave: string, contenido: unknown) {
  const [{ r }] = await b.sql<{ r: { entidad: { id: string; rev: number } } }>("select public.dulabs_cms_crear($1, $2, $3, $4::jsonb, null, 'Prueba') as r", [tenant, tipo, clave, JSON.stringify(contenido)]);
  await b.sql("select public.dulabs_cms_publicar($1, $2, $3, 0, $4, null, null, 'Prueba')", [tenant, r.entidad.id, r.entidad.rev, checksumDe(contenido)]);
  return r.entidad.id;
}

async function escenario() {
  const b = await crearDelacourSintetico();
  abiertas.push(b);
  await b.habilitarModulo(TENANT_B);
  for (const [t, v, p] of [[TENANT_A, V1, P1], [TENANT_A, V2, P2], [TENANT_B, V_B, P_B]] as const) {
    await video(b, t, v);
    await imagen(b, t, p);
  }
  await video(b, TENANT_A, V_SUELTO);
  await video(b, TENANT_A, V_PENDIENTE, false);
  await publicar(b, TENANT_B, "multimedia", "multimedia", multimedia(V_B, P_B));
  const abiertasStorage: Array<[string, string | null]> = [];
  const deps: DepsVideoPublico = {
    tenantDe: async (slug) => (slug === "delacour" ? TENANT_A : null),
    cargar: (tenantId) => crearLectorSupabase(b.supabase).cargar(tenantId),
    abrirVideo: async (path, rango) => {
      abiertasStorage.push([path, rango]);
      return { status: 200, body: new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array([1, 2, 3])), c.close()) }), contentType: "video/mp4", contentLength: 3, contentRange: null };
    },
  };
  return { b, deps, abiertasStorage };
}

const pedir = (deps: DepsVideoPublico, id: string, slug = "delacour", rango: string | null = null) => responderVideoCms(slug, `${id}.mp4`, rango, deps);

describe("video público con el lector real sobre SQL real", () => {
  it("sirve el video usado por las fotos y videos PUBLICADAS, desde la carpeta del propio negocio", async () => {
    const { b, deps, abiertasStorage } = await escenario();
    await publicar(b, TENANT_A, "multimedia", "multimedia", multimedia(V1, P1));
    const r = await pedir(deps, V1);
    assert.equal(r.status, 200);
    assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [1, 2, 3]);
    assert.deepEqual(abiertasStorage, [[`${TENANT_A}/cms/${V1}/video.mp4`, null]]);
  });

  it("la imagen fija del video se sirve por la ruta de las imágenes (la tienda la necesita mientras el video carga)", async () => {
    const { b } = await escenario();
    await publicar(b, TENANT_A, "multimedia", "multimedia", multimedia(V1, P1));
    const abiertas: string[] = [];
    const r = await responderImagenCms("delacour", `${P1}.webp`, {
      tenantDe: async () => TENANT_A,
      cargar: (t) => crearLectorSupabase(b.supabase).cargar(t),
      abrir: async (path): Promise<PublicImageObject | null> => (abiertas.push(path), { body: new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array([9])), c.close()) }), contentType: "image/webp", size: 1 }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(abiertas, [`${TENANT_A}/cms/${P1}/imagen.webp`]);
  });

  it("un rango se reenvía a Storage", async () => {
    const { b, deps, abiertasStorage } = await escenario();
    await publicar(b, TENANT_A, "multimedia", "multimedia", multimedia(V1, P1));
    await pedir(deps, V1, "delacour", "bytes=0-1");
    assert.deepEqual(abiertasStorage, [[`${TENANT_A}/cms/${V1}/video.mp4`, "bytes=0-1"]]);
  });

  it("un video LISTO que ningún contenido publicado usa NO se sirve (la lectura lo entrega, la ruta lo filtra)", async () => {
    const { b, deps, abiertasStorage } = await escenario();
    await publicar(b, TENANT_A, "multimedia", "multimedia", multimedia(V1, P1));
    const snap = await crearLectorSupabase(b.supabase).cargar(TENANT_A);
    assert.ok(snap?.assets.has(V_SUELTO), "la lectura SÍ trae todos los archivos listos del negocio");
    assert.equal(snap?.assets.get(V_SUELTO)?.mimeType, "video/mp4");
    assert.equal((await pedir(deps, V_SUELTO)).status, 404);
    assert.ok(!abiertasStorage.some(([p]) => p.includes(V_SUELTO)));
  });

  it("el video de otro negocio no se sirve por la tienda de este (aunque exista y esté publicado allá)", async () => {
    const { b, deps, abiertasStorage } = await escenario();
    await publicar(b, TENANT_A, "multimedia", "multimedia", multimedia(V1, P1));
    assert.equal((await pedir(deps, V_B)).status, 404);
    assert.deepEqual(abiertasStorage, []);
  });

  it("un video sin confirmar (la subida no terminó) no se sirve, aunque el contenido lo mencione", async () => {
    const { b, deps } = await escenario();
    await publicar(b, TENANT_A, "multimedia", "multimedia", multimedia(V_PENDIENTE, P1));
    assert.equal((await pedir(deps, V_PENDIENTE)).status, 404);
  });

  it("un archivo que no es un MP4 (aunque esté listo y publicado) no se sirve como video", async () => {
    const { b, deps } = await escenario();
    await imagen(b, TENANT_A, V_SUELTO.replace("5", "7"));
    await publicar(b, TENANT_A, "multimedia", "multimedia", multimedia(V_SUELTO.replace("5", "7"), P1));
    assert.equal((await pedir(deps, V_SUELTO.replace("5", "7"))).status, 404);
  });

  it("un borrador, un elemento pausado o despublicado no exponen su video; reanudado, sí", async () => {
    const { b, deps } = await escenario();
    const contenido = multimedia(V1, P1);
    const [{ r }] = await b.sql<{ r: { entidad: { id: string } } }>("select public.dulabs_cms_crear($1, 'multimedia', 'multimedia', $2::jsonb, null, 'Prueba') as r", [TENANT_A, JSON.stringify(contenido)]);
    assert.equal((await pedir(deps, V1)).status, 404, "borrador");
    await b.sql("select public.dulabs_cms_publicar($1, $2, 1, 0, $3, null, null, 'Prueba')", [TENANT_A, r.entidad.id, checksumDe(contenido)]);
    assert.equal((await pedir(deps, V1)).status, 200, "publicado");
    await b.sql("select public.dulabs_cms_pausar($1, $2, null, 'Prueba')", [TENANT_A, r.entidad.id]);
    assert.equal((await pedir(deps, V1)).status, 404, "pausado");
    await b.sql("select public.dulabs_cms_reanudar($1, $2, null, 'Prueba')", [TENANT_A, r.entidad.id]);
    assert.equal((await pedir(deps, V1)).status, 200, "reanudado");
    await b.sql("select public.dulabs_cms_despublicar($1, $2, null, 'Prueba')", [TENANT_A, r.entidad.id]);
    assert.equal((await pedir(deps, V1)).status, 404, "despublicado");
  });

  it("al reemplazar el video por otro, el anterior deja de servirse; al restaurar la versión anterior, vuelve", async () => {
    const { b, deps } = await escenario();
    const c1 = multimedia(V1, P1);
    const c2 = multimedia(V2, P2);
    const id = await publicar(b, TENANT_A, "multimedia", "multimedia", c1);
    assert.deepEqual([(await pedir(deps, V1)).status, (await pedir(deps, V2)).status], [200, 404]);
    const [{ r }] = await b.sql<{ r: { entidad: { rev: number } } }>("select public.dulabs_cms_guardar_borrador($1, $2, $3::jsonb, (select rev from public.dulabs_cms_entidades where id = $2), null, 'Prueba') as r", [TENANT_A, id, JSON.stringify(c2)]);
    await b.sql("select public.dulabs_cms_publicar($1, $2, $3, 1, $4, null, null, 'Prueba')", [TENANT_A, id, r.entidad.rev, checksumDe(c2)]);
    assert.deepEqual([(await pedir(deps, V1)).status, (await pedir(deps, V2)).status], [404, 200], "el nuevo sirve, el viejo ya no");
    await b.sql("select public.dulabs_cms_restaurar($1, $2, 1, 2, null, null, 'Prueba')", [TENANT_A, id]);
    assert.deepEqual([(await pedir(deps, V1)).status, (await pedir(deps, V2)).status], [200, 404], "restaurada la versión 1");
  });

  it("con el módulo APAGADO (aunque haya contenido publicado) no se sirve nada", async () => {
    const { b, deps } = await escenario();
    await publicar(b, TENANT_A, "multimedia", "multimedia", multimedia(V1, P1));
    await b.habilitarModulo(TENANT_A, false);
    assert.equal((await pedir(deps, V1)).status, 404);
  });

  it("contenido publicado que no cumple el esquema (alguien tocó la base a mano) lo descarta el lector: no se sirve nada", async () => {
    const { b, deps } = await escenario();
    const original = console.warn;
    console.warn = () => {};
    try {
      await publicar(b, TENANT_A, "multimedia", "multimedia", { videos: { portada: { horizontal: { video: V1, poster: P1, url: "https://otro-sitio.co/v.mp4" } } } });
      assert.equal((await pedir(deps, V1)).status, 404);
    } finally {
      console.warn = original;
    }
  });

  it("una tienda que no existe o no está publicada responde lo mismo, sin leer el CMS", async () => {
    const { b, deps } = await escenario();
    await publicar(b, TENANT_A, "multimedia", "multimedia", multimedia(V1, P1));
    assert.equal((await pedir(deps, V1, "otra-tienda")).status, 404);
  });
});
