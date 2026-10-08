/**
 * CMS comercial — la imagen PÚBLICA de la vitrina: solo se sirve lo listo, publicado y del propio negocio; todo lo demás es el MISMO 404.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PublicImageObject } from "@/lib/catalogo/repository";
import { responderImagenCms, type DepsImagenPublica } from "@/lib/cms-comercial/imagen-publica";
import type { AssetPublicoCms, InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { TENANT_A, TENANT_B, campana, home, instantanea, oferta, publicada } from "@/lib/cms-comercial/testing/fixtures";

const ID_PUBLICADA = "a0000000-0000-4000-8000-000000000001";
const ID_BORRADOR = "a0000000-0000-4000-8000-000000000002";
const ID_AJENA = "a0000000-0000-4000-8000-000000000003";
const BYTES = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 5]);

const asset = (id: string, storagePath: string): AssetPublicoCms => ({ id, storagePath, mimeType: "image/webp", ancho: 1600, alto: 900 });
const cms = (id: string) => ({ origen: "cms" as const, asset: id, alt: "Imagen de prueba" });

function snapshot(over: Partial<Omit<InstantaneaCms, "assets">> = {}, assets: AssetPublicoCms[] = [asset(ID_PUBLICADA, `${TENANT_A}/cms/${ID_PUBLICADA}/imagen.webp`)]): InstantaneaCms {
  return instantanea({ home: publicada("home", home({ portada: { visible: true, titulo: "Portada", imagen: cms(ID_PUBLICADA) } })), assets, ...over });
}

function objeto(): PublicImageObject {
  return { body: new ReadableStream({ start: (c) => (c.enqueue(BYTES), c.close()) }), contentType: "image/webp", size: BYTES.byteLength };
}

interface Espias {
  tenantDe: string[];
  cargar: string[];
  abrir: string[];
}

function deps(snap: InstantaneaCms | null, over: Partial<DepsImagenPublica> = {}): { d: DepsImagenPublica; espias: Espias } {
  const espias: Espias = { tenantDe: [], cargar: [], abrir: [] };
  const d: DepsImagenPublica = {
    tenantDe: async (slug) => (espias.tenantDe.push(slug), slug === "prueba" ? TENANT_A : null),
    cargar: async (tenantId) => (espias.cargar.push(tenantId), snap),
    abrir: async (path) => (espias.abrir.push(path), objeto()),
    ...over,
  };
  return { d, espias };
}

const cuerpo = async (r: Response) => Buffer.from(await r.arrayBuffer()).toString("hex");
const huella = async (r: Response) => JSON.stringify([r.status, await r.text(), [...r.headers.entries()].sort()]);

describe("responderImagenCms — lo que sí se sirve", () => {
  it("una imagen lista y usada por la página principal publicada: 200, en streaming, con su caché y sin indexar", async () => {
    const { d, espias } = deps(snapshot());
    const r = await responderImagenCms("prueba", `${ID_PUBLICADA}.webp`, d);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/webp");
    assert.equal(r.headers.get("content-length"), String(BYTES.byteLength));
    assert.equal(r.headers.get("cache-control"), "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
    assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(r.headers.get("content-disposition"), "inline");
    assert.equal(await cuerpo(r), Buffer.from(BYTES).toString("hex"));
    assert.deepEqual(espias.tenantDe, ["prueba"]);
    assert.deepEqual(espias.cargar, [TENANT_A]);
    assert.deepEqual(espias.abrir, [`${TENANT_A}/cms/${ID_PUBLICADA}/imagen.webp`]);
  });

  it("también la que usa una oferta, un combo o una campaña publicadas (no solo la portada)", async () => {
    const snap = snapshot({ home: null, ofertas: [publicada("o", oferta({ imagen: cms(ID_PUBLICADA) }))] });
    assert.equal((await responderImagenCms("prueba", `${ID_PUBLICADA}.webp`, deps(snap).d)).status, 200);
    const snap2 = snapshot({ home: null, campanas: [publicada("k", campana({ portada: { titulo: "Campaña", imagen: cms(ID_PUBLICADA) } }))] });
    assert.equal((await responderImagenCms("prueba", `${ID_PUBLICADA}.webp`, deps(snap2).d)).status, 200);
  });

  it("sin tamaño conocido no inventa Content-Length", async () => {
    const { d } = deps(snapshot(), { abrir: async () => ({ ...objeto(), size: null }) });
    const r = await responderImagenCms("prueba", `${ID_PUBLICADA}.webp`, d);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-length"), null);
  });
});

describe("responderImagenCms — lo que NO se sirve (todo el mismo 404, sin tocar la base cuando el nombre ya es inválido)", () => {
  it("un nombre de archivo que no es exactamente «<id en minúsculas>.webp» ni siquiera consulta nada", async () => {
    const malos = [
      "imagen.webp",
      `${ID_PUBLICADA}.png`,
      `${ID_PUBLICADA}.WEBP`,
      `${ID_PUBLICADA.toUpperCase()}.webp`,
      `${ID_PUBLICADA}.webp.png`,
      `${ID_PUBLICADA}`,
      `../${ID_PUBLICADA}.webp`,
      `..%2F${ID_PUBLICADA}.webp`,
      `${ID_PUBLICADA}.webp?x=1`,
      ` ${ID_PUBLICADA}.webp`,
      `${ID_PUBLICADA}.webp\n`,
      "",
      "a".repeat(5000),
    ];
    for (const archivo of malos) {
      const { d, espias } = deps(snapshot());
      const r = await responderImagenCms("prueba", archivo, d);
      assert.equal(r.status, 404, JSON.stringify(archivo));
      assert.deepEqual([espias.tenantDe, espias.cargar, espias.abrir], [[], [], []], JSON.stringify(archivo));
    }
  });

  it("tienda inexistente, no publicada o con el módulo apagado: 404 y no se lee el CMS", async () => {
    const { d, espias } = deps(snapshot());
    assert.equal((await responderImagenCms("otra-tienda", `${ID_PUBLICADA}.webp`, d)).status, 404);
    assert.deepEqual(espias.cargar, []);
  });

  it("CMS apagado para el negocio (el lector devuelve null): 404", async () => {
    const { d, espias } = deps(null);
    assert.equal((await responderImagenCms("prueba", `${ID_PUBLICADA}.webp`, d)).status, 404);
    assert.deepEqual(espias.abrir, []);
  });

  it("una imagen que no figura entre las LISTAS del negocio: 404 y no se abre Storage", async () => {
    const { d, espias } = deps(snapshot());
    assert.equal((await responderImagenCms("prueba", `${ID_BORRADOR}.webp`, d)).status, 404);
    assert.deepEqual(espias.abrir, []);
  });

  it("una imagen lista pero NO usada por nada publicado (un borrador) no se expone", async () => {
    const snap = snapshot({}, [asset(ID_PUBLICADA, `${TENANT_A}/cms/${ID_PUBLICADA}/imagen.webp`), asset(ID_BORRADOR, `${TENANT_A}/cms/${ID_BORRADOR}/imagen.webp`)]);
    const { d, espias } = deps(snap);
    assert.equal((await responderImagenCms("prueba", `${ID_BORRADOR}.webp`, d)).status, 404);
    assert.deepEqual(espias.abrir, []);
    assert.equal((await responderImagenCms("prueba", `${ID_PUBLICADA}.webp`, d)).status, 200);
  });

  it("una imagen cuya ruta de Storage es de OTRO negocio nunca se sirve, aunque esté referenciada (defensa en profundidad)", async () => {
    const snap = snapshot({ home: publicada("home", home({ portada: { visible: true, titulo: "Portada", imagen: cms(ID_AJENA) } })) }, [asset(ID_AJENA, `${TENANT_B}/cms/${ID_AJENA}/imagen.webp`)]);
    const { d, espias } = deps(snap);
    assert.equal((await responderImagenCms("prueba", `${ID_AJENA}.webp`, d)).status, 404);
    assert.deepEqual(espias.abrir, []);
  });

  it("una ruta que sale de la carpeta del CMS (productos del negocio, «..») nunca se sirve", async () => {
    for (const ruta of [`${TENANT_A}/productos/x.webp`, `${TENANT_A}/cms/../productos/x.webp`, `${TENANT_A}/cms2/${ID_AJENA}.webp`, `/${TENANT_A}/cms/x.webp`]) {
      const snap = snapshot({ home: publicada("home", home({ portada: { visible: true, titulo: "Portada", imagen: cms(ID_AJENA) } })) }, [asset(ID_AJENA, ruta)]);
      const { d, espias } = deps(snap);
      assert.equal((await responderImagenCms("prueba", `${ID_AJENA}.webp`, d)).status, 404, ruta);
      assert.deepEqual(espias.abrir, [], ruta);
    }
  });

  it("una instantánea que dice ser de otro negocio se descarta", async () => {
    const { d, espias } = deps(snapshot({ tenantId: TENANT_B }));
    assert.equal((await responderImagenCms("prueba", `${ID_PUBLICADA}.webp`, d)).status, 404);
    assert.deepEqual(espias.abrir, []);
  });

  it("el objeto no está en Storage (o no es una imagen válida): 404", async () => {
    const { d } = deps(snapshot(), { abrir: async () => null });
    assert.equal((await responderImagenCms("prueba", `${ID_PUBLICADA}.webp`, d)).status, 404);
  });

  it("todos los 404 son IDÉNTICOS (cuerpo y encabezados): no revelan si la imagen existe, si es de otro negocio o si es un borrador", async () => {
    const huellas = new Set<string>();
    const casos: Array<[string, string, InstantaneaCms | null, Partial<DepsImagenPublica>?]> = [
      ["prueba", "no-valido.webp", snapshot()],
      ["otra-tienda", `${ID_PUBLICADA}.webp`, snapshot()],
      ["prueba", `${ID_PUBLICADA}.webp`, null],
      ["prueba", `${ID_BORRADOR}.webp`, snapshot()],
      ["prueba", `${ID_PUBLICADA}.webp`, snapshot(), { abrir: async () => null }],
      ["prueba", `${ID_AJENA}.webp`, snapshot({ home: publicada("home", home({ portada: { visible: true, titulo: "Portada", imagen: cms(ID_AJENA) } })) }, [asset(ID_AJENA, `${TENANT_B}/cms/${ID_AJENA}/imagen.webp`)])],
    ];
    for (const [slug, archivo, snap, over] of casos) huellas.add(await huella(await responderImagenCms(slug, archivo, deps(snap, over).d)));
    assert.equal(huellas.size, 1);
    const [unica] = [...huellas];
    assert.ok(unica.includes("Not found") && unica.includes("noindex, nofollow") && unica.includes("max-age=60"));
  });
});

describe("responderImagenCms — fallas internas", () => {
  async function conConsolaSilenciada<T>(f: () => Promise<T>): Promise<{ resultado: T; lineas: unknown[][] }> {
    const original = console.error;
    const lineas: unknown[][] = [];
    console.error = (...a: unknown[]) => void lineas.push(a);
    try {
      return { resultado: await f(), lineas };
    } finally {
      console.error = original;
    }
  }

  it("un error al leer el CMS o Storage responde 502 sin caché (no se cachea una falla) y se registra solo el mensaje", async () => {
    for (const over of [
      { cargar: async () => Promise.reject(new Error("db caída")) },
      { abrir: async () => Promise.reject(new Error("storage caído")) },
      { tenantDe: async () => Promise.reject(new Error("publicación caída")) },
    ] satisfies Partial<DepsImagenPublica>[]) {
      const { resultado, lineas } = await conConsolaSilenciada(() => responderImagenCms("prueba", `${ID_PUBLICADA}.webp`, deps(snapshot(), over).d));
      assert.equal(resultado.status, 502);
      assert.equal(resultado.headers.get("cache-control"), "no-store");
      assert.equal(lineas.length, 1);
      assert.match(String(lineas[0].join(" ")), /caíd/);
    }
  });

  it("construir las dependencias falla de forma perezosa: la ruta responde 502 en vez de romper", async () => {
    const roto: DepsImagenPublica = {
      tenantDe: () => {
        throw new Error("falta una variable de entorno");
      },
      cargar: async () => null,
      abrir: async () => null,
    };
    const { resultado } = await conConsolaSilenciada(() => responderImagenCms("prueba", `${ID_PUBLICADA}.webp`, roto));
    assert.equal(resultado.status, 502);
  });
});
