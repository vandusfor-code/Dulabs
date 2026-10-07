/**
 * CMS comercial — la imagen PÚBLICA de la vitrina con el LECTOR REAL sobre el SQL real (Postgres embebido): la función de lectura entrega TODAS las imágenes listas
 * del negocio y los elementos publicados; la ruta solo sirve las que usa contenido PUBLICADO de ese negocio. Aislamiento por negocio, módulo apagado, borradores,
 * pausados e imágenes sin confirmar, todo contra la base de verdad.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { PublicImageObject } from "@/lib/catalogo/repository";
import { checksumDe } from "@/lib/cms-comercial/checksum";
import { responderImagenCms, type DepsImagenPublica } from "@/lib/cms-comercial/imagen-publica";
import { crearLectorSupabase } from "@/lib/cms-comercial/lector";
import { crearDelacourSintetico } from "@/lib/cms-comercial/testing/delacour";
import { TENANT_A, TENANT_B } from "@/lib/cms-comercial/testing/fixtures";
import type { BaseCms } from "@/lib/cms-comercial/testing/pglite";

const A_PUBLICADA = "a1000000-0000-4000-8000-000000000001";
const A_SIN_USO = "a1000000-0000-4000-8000-000000000002";
const A_PENDIENTE = "a1000000-0000-4000-8000-000000000003";
const A_DE_OFERTA = "a1000000-0000-4000-8000-000000000004";
const B_PUBLICADA = "b1000000-0000-4000-8000-000000000001";

const abiertas: BaseCms[] = [];
afterEach(async () => {
  while (abiertas.length) await abiertas.pop()?.cerrar();
});

const cms = (asset: string) => ({ origen: "cms", asset, alt: "Imagen de prueba" });
const home = (asset: string) => ({ portada: { visible: true, titulo: "Portada de prueba", imagen: cms(asset) }, secciones: [{ tipo: "portada", visible: true }], categorias_destacadas: [], productos_destacados: [] });
const oferta = (asset: string) => ({
  nombre: "Oferta de prueba",
  imagen: cms(asset),
  modalidad: "ambas",
  beneficio: { tipo: "porcentaje", valor: 20 },
  alcance: { todos: true, referencias: [], categorias: [] },
  vigencia: { desde: "2026-01-01", hasta: "2026-12-31" },
  prioridad: 1,
});

async function asset(b: BaseCms, tenant: string, id: string, listo = true) {
  await b.sql("select public.dulabs_cms_asset_crear($1, $2, $3, 'image/webp', 1000, 1600, 900, 'x.webp', null)", [tenant, id, `${tenant}/cms/${id}/imagen.webp`]);
  if (listo) await b.sql("select public.dulabs_cms_asset_confirmar($1, $2, 1000, 1600, 900, null, 'Prueba')", [tenant, id]);
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
  for (const [t, id] of [[TENANT_A, A_PUBLICADA], [TENANT_A, A_SIN_USO], [TENANT_A, A_DE_OFERTA], [TENANT_B, B_PUBLICADA]] as const) await asset(b, t, id);
  await asset(b, TENANT_A, A_PENDIENTE, false);
  await publicar(b, TENANT_B, "home", "home", home(B_PUBLICADA));
  const abiertasStorage: string[] = [];
  const deps: DepsImagenPublica = {
    tenantDe: async (slug) => (slug === "delacour" ? TENANT_A : null),
    cargar: (tenantId) => crearLectorSupabase(b.supabase).cargar(tenantId),
    abrir: async (path): Promise<PublicImageObject | null> => {
      abiertasStorage.push(path);
      return { body: new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array([1, 2, 3])), c.close()) }), contentType: "image/webp", size: 3 };
    },
  };
  return { b, deps, abiertasStorage };
}

const pedir = (deps: DepsImagenPublica, id: string, slug = "delacour") => responderImagenCms(slug, `${id}.webp`, deps);

describe("imagen pública con el lector real sobre SQL real", () => {
  it("sirve la imagen usada por la página principal PUBLICADA, desde la carpeta del propio negocio", async () => {
    const { b, deps, abiertasStorage } = await escenario();
    await publicar(b, TENANT_A, "home", "home", home(A_PUBLICADA));
    const r = await pedir(deps, A_PUBLICADA);
    assert.equal(r.status, 200);
    assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [1, 2, 3]);
    assert.deepEqual(abiertasStorage, [`${TENANT_A}/cms/${A_PUBLICADA}/imagen.webp`]);
  });

  it("una imagen LISTA pero que ningún contenido publicado usa NO se sirve (la función de lectura la entrega, la ruta la filtra)", async () => {
    const { b, deps, abiertasStorage } = await escenario();
    await publicar(b, TENANT_A, "home", "home", home(A_PUBLICADA));
    const snap = await crearLectorSupabase(b.supabase).cargar(TENANT_A);
    assert.ok(snap?.assets.has(A_SIN_USO), "la lectura SÍ trae todas las imágenes listas del negocio");
    assert.equal((await pedir(deps, A_SIN_USO)).status, 404);
    assert.ok(!abiertasStorage.includes(`${TENANT_A}/cms/${A_SIN_USO}/imagen.webp`));
  });

  it("la imagen de otro negocio no se sirve por la tienda de este (aunque exista y esté publicada allá)", async () => {
    const { b, deps, abiertasStorage } = await escenario();
    await publicar(b, TENANT_A, "home", "home", home(A_PUBLICADA));
    assert.equal((await pedir(deps, B_PUBLICADA)).status, 404);
    assert.deepEqual(abiertasStorage, []);
  });

  it("una imagen sin confirmar (la subida no terminó) no se sirve, aunque un contenido la mencione", async () => {
    const { b, deps } = await escenario();
    await publicar(b, TENANT_A, "home", "home", home(A_PENDIENTE));
    assert.equal((await pedir(deps, A_PENDIENTE)).status, 404);
  });

  it("un borrador (sin publicar) o una página despublicada no exponen su imagen", async () => {
    const { b, deps } = await escenario();
    const [{ r }] = await b.sql<{ r: { entidad: { id: string } } }>("select public.dulabs_cms_crear($1, 'home', 'home', $2::jsonb, null, 'Prueba') as r", [TENANT_A, JSON.stringify(home(A_PUBLICADA))]);
    assert.equal((await pedir(deps, A_PUBLICADA)).status, 404, "borrador");
    await b.sql("select public.dulabs_cms_publicar($1, $2, 1, 0, $3, null, null, 'Prueba')", [TENANT_A, r.entidad.id, checksumDe(home(A_PUBLICADA))]);
    assert.equal((await pedir(deps, A_PUBLICADA)).status, 200, "publicada");
    await b.sql("select public.dulabs_cms_despublicar($1, $2, null, 'Prueba')", [TENANT_A, r.entidad.id]);
    assert.equal((await pedir(deps, A_PUBLICADA)).status, 404, "despublicada");
  });

  it("una oferta pausada no expone su imagen; reanudada, sí", async () => {
    const { b, deps } = await escenario();
    const id = await publicar(b, TENANT_A, "oferta", "descuento", oferta(A_DE_OFERTA));
    assert.equal((await pedir(deps, A_DE_OFERTA)).status, 200);
    await b.sql("select public.dulabs_cms_pausar($1, $2, null, 'Prueba')", [TENANT_A, id]);
    assert.equal((await pedir(deps, A_DE_OFERTA)).status, 404);
    await b.sql("select public.dulabs_cms_reanudar($1, $2, null, 'Prueba')", [TENANT_A, id]);
    assert.equal((await pedir(deps, A_DE_OFERTA)).status, 200);
  });

  it("con el módulo APAGADO (aunque haya contenido publicado) no se sirve nada", async () => {
    const { b, deps } = await escenario();
    await publicar(b, TENANT_A, "home", "home", home(A_PUBLICADA));
    await b.habilitarModulo(TENANT_A, false);
    assert.equal((await pedir(deps, A_PUBLICADA)).status, 404);
  });

  it("una tienda que no existe o no está publicada responde lo mismo, sin leer el CMS", async () => {
    const { b, deps } = await escenario();
    await publicar(b, TENANT_A, "home", "home", home(A_PUBLICADA));
    assert.equal((await pedir(deps, A_PUBLICADA, "otra-tienda")).status, 404);
  });
});
