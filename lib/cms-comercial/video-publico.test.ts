/**
 * CMS comercial — el video PÚBLICO de la vitrina: solo se sirve lo listo, publicado y del propio negocio (todo lo demás es el MISMO 404), y se entiende `Range` (Safari lo exige para reproducir).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssetPublicoCms, InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { TENANT_A, TENANT_B, home, instantanea, multimedia, publicada } from "@/lib/cms-comercial/testing/fixtures";
import { abrirVideoDeStorage, rangoSimple, responderVideoCms, type DepsVideoPublico, type ObjetoVideoPublico } from "@/lib/cms-comercial/video-publico";

const ID_VIDEO = "a0000000-0000-4000-8000-000000000001";
const ID_POSTER = "a0000000-0000-4000-8000-000000000002";
const ID_SUELTO = "a0000000-0000-4000-8000-000000000003";
const ID_IMAGEN = "a0000000-0000-4000-8000-000000000004";
const BYTES = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));

const video = (id: string, storagePath = `${TENANT_A}/cms/${id}/video.mp4`, mimeType = "video/mp4"): AssetPublicoCms => ({ id, storagePath, mimeType, ancho: 1280, alto: 720 });
const poster = (id: string): AssetPublicoCms => ({ id, storagePath: `${TENANT_A}/cms/${id}/imagen.webp`, mimeType: "image/webp", ancho: 1280, alto: 720 });
const usado = () => publicada("multimedia", multimedia({ videos: { portada: { horizontal: { video: ID_VIDEO, poster: ID_POSTER } } } }));

function snapshot(over: Partial<Omit<InstantaneaCms, "assets">> = {}, assets: AssetPublicoCms[] = [video(ID_VIDEO), poster(ID_POSTER), video(ID_SUELTO)]): InstantaneaCms {
  return instantanea({ multimedia: usado(), assets, ...over });
}

function completo(): ObjetoVideoPublico {
  return { status: 200, body: new ReadableStream({ start: (c) => (c.enqueue(BYTES), c.close()) }), contentType: "video/mp4", contentLength: BYTES.byteLength, contentRange: null };
}
function pedazo(desde: number, hasta: number): ObjetoVideoPublico {
  const trozo = BYTES.slice(desde, hasta + 1);
  return { status: 206, body: new ReadableStream({ start: (c) => (c.enqueue(trozo), c.close()) }), contentType: "video/mp4", contentLength: trozo.byteLength, contentRange: `bytes ${desde}-${hasta}/${BYTES.byteLength}` };
}

interface Espias {
  tenantDe: string[];
  cargar: string[];
  abrir: Array<[string, string | null]>;
}

function deps(snap: InstantaneaCms | null, over: Partial<DepsVideoPublico> = {}): { d: DepsVideoPublico; espias: Espias } {
  const espias: Espias = { tenantDe: [], cargar: [], abrir: [] };
  const d: DepsVideoPublico = {
    tenantDe: async (slug) => (espias.tenantDe.push(slug), slug === "prueba" ? TENANT_A : null),
    cargar: async (tenantId) => (espias.cargar.push(tenantId), snap),
    abrirVideo: async (path, rango) => (espias.abrir.push([path, rango]), rango ? pedazo(0, 9) : completo()),
    ...over,
  };
  return { d, espias };
}

const hex = async (r: Response) => Buffer.from(await r.arrayBuffer()).toString("hex");
const huella = async (r: Response) => JSON.stringify([r.status, await r.text(), [...r.headers.entries()].sort()]);

describe("rangoSimple — qué rangos se reenvían", () => {
  it("acepta un solo rango simple, en sus tres formas", () => {
    for (const bueno of ["bytes=0-99", "bytes=0-", "bytes=100-", "bytes=-500", "bytes=0-0", "bytes=5-5", "bytes=0-1", " bytes=0-99 "]) assert.equal(rangoSimple(bueno), bueno.trim(), bueno);
  });
  it("ignora lo que no entiende (entonces se entrega el video completo): varios rangos, otras unidades, rangos al revés, vacío y basura", () => {
    for (const malo of ["", "bytes=", "bytes=-", "bytes=5-2", "bytes=0-1,5-9", "items=0-9", "Bytes=0-9", "bytes=a-b", "bytes=0-99-100", "0-99", "bytes= 0-9", "bytes=0 -9", `bytes=${"9".repeat(13)}-`, "bytes=-1-2", "x".repeat(10_000)]) {
      assert.equal(rangoSimple(malo), null, JSON.stringify(malo.slice(0, 40)));
    }
    assert.equal(rangoSimple(null), null);
    assert.equal(rangoSimple(undefined), null);
  });
});

describe("responderVideoCms — lo que sí se sirve", () => {
  it("un video listo y usado por las fotos y videos publicados, sin rango: 200 completo, en streaming, con su caché pública y sin indexar", async () => {
    const { d, espias } = deps(snapshot());
    const r = await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, null, d);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "video/mp4");
    assert.equal(r.headers.get("accept-ranges"), "bytes");
    assert.equal(r.headers.get("content-length"), String(BYTES.byteLength));
    assert.equal(r.headers.get("cache-control"), "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
    assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(r.headers.get("content-disposition"), "inline");
    assert.equal(r.headers.get("content-range"), null);
    assert.equal(await hex(r), Buffer.from(BYTES).toString("hex"));
    assert.deepEqual(espias.tenantDe, ["prueba"]);
    assert.deepEqual(espias.cargar, [TENANT_A]);
    assert.deepEqual(espias.abrir, [[`${TENANT_A}/cms/${ID_VIDEO}/video.mp4`, null]]);
  });

  it("con rango: lo reenvía tal cual y devuelve 206 con su Content-Range y SIN caché compartida", async () => {
    const { d, espias } = deps(snapshot());
    const r = await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, "bytes=0-9", d);
    assert.equal(r.status, 206);
    assert.equal(r.headers.get("content-range"), "bytes 0-9/100");
    assert.equal(r.headers.get("content-length"), "10");
    assert.equal(r.headers.get("accept-ranges"), "bytes");
    assert.equal(r.headers.get("content-type"), "video/mp4");
    assert.equal(r.headers.get("cache-control"), "private, max-age=86400");
    assert.equal(await hex(r), Buffer.from(BYTES.slice(0, 10)).toString("hex"));
    assert.deepEqual(espias.abrir, [[`${TENANT_A}/cms/${ID_VIDEO}/video.mp4`, "bytes=0-9"]]);
  });

  it("un rango que no se entiende se ignora: se pide el video completo", async () => {
    for (const raro of ["bytes=0-1,5-9", "items=1-2", "bytes=9-1", "basura"]) {
      const { d, espias } = deps(snapshot());
      const r = await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, raro, d);
      assert.equal(r.status, 200, raro);
      assert.deepEqual(espias.abrir.map((a) => a[1]), [null], raro);
    }
  });

  it("un rango que no existe en el video: 416 con el tamaño y sin caché", async () => {
    const { d } = deps(snapshot(), { abrirVideo: async () => ({ status: 416, body: null, contentType: "video/mp4", contentLength: null, contentRange: "bytes */100" }) });
    const r = await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, "bytes=500-", d);
    assert.equal(r.status, 416);
    assert.equal(r.headers.get("content-range"), "bytes */100");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("content-length"), null);
    assert.equal(await r.text(), "");
  });

  it("si Storage ignora el rango y manda el video entero, se entrega completo (la norma lo permite)", async () => {
    const { d } = deps(snapshot(), { abrirVideo: async () => completo() });
    const r = await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, "bytes=0-9", d);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-range"), null);
    assert.equal(r.headers.get("cache-control"), "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
  });

  it("un 206 sin Content-Range no se acepta como pedazo: se entrega como una respuesta completa", async () => {
    const { d } = deps(snapshot(), { abrirVideo: async () => ({ ...pedazo(0, 9), contentRange: null }) });
    const r = await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, "bytes=0-9", d);
    assert.notEqual(r.status, 206);
  });

  it("sin tamaño conocido no inventa Content-Length", async () => {
    const { d } = deps(snapshot(), { abrirVideo: async () => ({ ...completo(), contentLength: null }) });
    const r = await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, null, d);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-length"), null);
  });

  it("el video de un espacio vertical o de cualquiera de los cuatro espacios también se sirve", async () => {
    const snap = snapshot({
      multimedia: publicada(
        "multimedia",
        multimedia({
          videos: {
            portada: { horizontal: { video: ID_SUELTO, poster: ID_POSTER }, vertical: { video: ID_VIDEO, poster: ID_POSTER } },
            marca: { horizontal: { video: ID_IMAGEN, poster: ID_POSTER } },
          },
        }),
      ),
    }, [video(ID_VIDEO), video(ID_SUELTO), video(ID_IMAGEN), poster(ID_POSTER)]);
    for (const id of [ID_VIDEO, ID_SUELTO, ID_IMAGEN]) assert.equal((await responderVideoCms("prueba", `${id}.mp4`, null, deps(snap).d)).status, 200, id);
  });
});

describe("responderVideoCms — lo que NO se sirve (todo el mismo 404, sin tocar la base cuando el nombre ya es inválido)", () => {
  it("un nombre de archivo que no es exactamente «<id en minúsculas>.mp4» ni siquiera consulta nada", async () => {
    const malos = [
      "video.mp4",
      `${ID_VIDEO}.webm`,
      `${ID_VIDEO}.MP4`,
      `${ID_VIDEO.toUpperCase()}.mp4`,
      `${ID_VIDEO}.mp4.exe`,
      `${ID_VIDEO}`,
      `../${ID_VIDEO}.mp4`,
      `..%2F${ID_VIDEO}.mp4`,
      `${ID_VIDEO}.mp4?x=1`,
      ` ${ID_VIDEO}.mp4`,
      `${ID_VIDEO}.mp4\n`,
      `${ID_VIDEO}.webp`,
      "",
      "a".repeat(5000),
    ];
    for (const archivo of malos) {
      const { d, espias } = deps(snapshot());
      const r = await responderVideoCms("prueba", archivo, null, d);
      assert.equal(r.status, 404, JSON.stringify(archivo));
      assert.deepEqual([espias.tenantDe, espias.cargar, espias.abrir], [[], [], []], JSON.stringify(archivo));
    }
  });

  it("tienda inexistente o no publicada: 404 y no se lee el CMS", async () => {
    const { d, espias } = deps(snapshot());
    assert.equal((await responderVideoCms("otra-tienda", `${ID_VIDEO}.mp4`, null, d)).status, 404);
    assert.deepEqual(espias.cargar, []);
  });

  it("CMS apagado para el negocio (el lector devuelve null): 404", async () => {
    const { d, espias } = deps(null);
    assert.equal((await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, null, d)).status, 404);
    assert.deepEqual(espias.abrir, []);
  });

  it("un video subido pero que NINGÚN contenido publicado usa no se expone (ni el que solo está en otro tipo de contenido)", async () => {
    const { d, espias } = deps(snapshot());
    assert.equal((await responderVideoCms("prueba", `${ID_SUELTO}.mp4`, null, d)).status, 404);
    assert.deepEqual(espias.abrir, []);
    const sinPublicar = snapshot({ multimedia: null, home: publicada("home", home()) });
    assert.equal((await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, null, deps(sinPublicar).d)).status, 404);
  });

  it("un id que no está listo (no existe en lo publicado) o que es una imagen: 404", async () => {
    assert.equal((await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, null, deps(snapshot({}, [poster(ID_POSTER)])).d)).status, 404, "no existe");
    const comoImagen = snapshot({}, [video(ID_VIDEO, `${TENANT_A}/cms/${ID_VIDEO}/video.mp4`, "image/webp"), poster(ID_POSTER)]);
    assert.equal((await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, null, deps(comoImagen).d)).status, 404, "es una imagen");
    // el póster es una imagen: no se pide como .mp4
    assert.equal((await responderVideoCms("prueba", `${ID_POSTER}.mp4`, null, deps(snapshot()).d)).status, 404);
  });

  it("DEFENSA EN PROFUNDIDAD: una ruta fuera de la carpeta del negocio, con «..», de otro negocio o que no es video.mp4 jamás se abre", async () => {
    for (const ruta of [`${TENANT_B}/cms/${ID_VIDEO}/video.mp4`, `${TENANT_A}/cms/../${TENANT_B}/cms/${ID_VIDEO}/video.mp4`, `${TENANT_A}/otro/${ID_VIDEO}/video.mp4`, `${TENANT_A}/cms/${ID_VIDEO}/imagen.webp`, `${TENANT_A}/cms/${ID_SUELTO}/video.mp4`, "/etc/passwd"]) {
      const snap = snapshot({}, [video(ID_VIDEO, ruta), poster(ID_POSTER)]);
      const { d, espias } = deps(snap);
      assert.equal((await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, null, d)).status, 404, ruta);
      assert.deepEqual(espias.abrir, [], ruta);
    }
  });

  it("una instantánea de otro negocio (no debería pasar) jamás se sirve", async () => {
    const ajena = { ...snapshot(), tenantId: TENANT_B };
    const { d, espias } = deps(ajena);
    assert.equal((await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, null, d)).status, 404);
    assert.deepEqual(espias.abrir, []);
  });

  it("Storage no lo tiene (o no es un MP4): 404", async () => {
    const { d } = deps(snapshot(), { abrirVideo: async () => null });
    assert.equal((await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, null, d)).status, 404);
  });

  it("todos los 404 son idénticos: no revelan si el video existe, si es de otro negocio o si es un borrador", async () => {
    const referencia = await huella(await responderVideoCms("prueba", `${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}.mp4`, null, deps(snapshot()).d));
    const casos: Array<Promise<Response>> = [
      responderVideoCms("prueba", `${ID_SUELTO}.mp4`, null, deps(snapshot()).d),
      responderVideoCms("otra-tienda", `${ID_VIDEO}.mp4`, null, deps(snapshot()).d),
      responderVideoCms("prueba", `${ID_VIDEO}.mp4`, null, deps(null).d),
      responderVideoCms("prueba", "malo.mp4", null, deps(snapshot()).d),
      responderVideoCms("prueba", `${ID_VIDEO}.mp4`, null, deps(snapshot(), { abrirVideo: async () => null }).d),
    ];
    for (const caso of casos) assert.equal(await huella(await caso), referencia);
    const r = await responderVideoCms("prueba", `${ID_SUELTO}.mp4`, null, deps(snapshot()).d);
    assert.equal(r.headers.get("cache-control"), "public, max-age=60, s-maxage=60");
    assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
  });

  it("si algo falla por dentro: 502 sin caché y sin detalles", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      for (const roto of [{ tenantDe: async () => Promise.reject(new Error("boom secreto")) }, { cargar: async () => Promise.reject(new Error("db caída")) }, { abrirVideo: async () => Promise.reject(new Error("storage caído")) }]) {
        const r = await responderVideoCms("prueba", `${ID_VIDEO}.mp4`, null, deps(snapshot(), roto).d);
        assert.equal(r.status, 502);
        assert.equal(r.headers.get("cache-control"), "no-store");
        assert.equal(await r.text(), "Error");
      }
    } finally {
      console.error = original;
    }
  });
});

describe("abrirVideoDeStorage — hablar con Storage", () => {
  const respuesta = (cuerpo: BodyInit | null, init: ResponseInit & { headers?: Record<string, string> }) => new Response(cuerpo, init);
  const falso = (res: Response, vistas: Array<{ url: string; init?: RequestInit }> = []): typeof fetch => (async (url: string | URL | Request, init?: RequestInit) => (vistas.push({ url: String(url), init }), res)) as typeof fetch;

  it("sin rango pide el video completo, sin caché de datos, y entrega 200 con su largo", async () => {
    const vistas: Array<{ url: string; init?: RequestInit }> = [];
    const r = await abrirVideoDeStorage("http://s/video.mp4", null, falso(respuesta(BYTES, { status: 200, headers: { "content-type": "video/mp4", "content-length": "100" } }), vistas));
    assert.ok(r);
    assert.deepEqual([r.status, r.contentLength, r.contentRange, r.contentType], [200, 100, null, "video/mp4"]);
    assert.equal(vistas[0].url, "http://s/video.mp4");
    assert.equal(vistas[0].init?.cache, "no-store");
    assert.equal(new Headers(vistas[0].init?.headers).get("range"), null);
  });

  it("con rango lo reenvía y entrega el pedazo con su Content-Range", async () => {
    const vistas: Array<{ url: string; init?: RequestInit }> = [];
    const r = await abrirVideoDeStorage("http://s/video.mp4", "bytes=0-9", falso(respuesta(BYTES.slice(0, 10), { status: 206, headers: { "content-type": "video/mp4", "content-length": "10", "content-range": "bytes 0-9/100" } }), vistas));
    assert.ok(r);
    assert.deepEqual([r.status, r.contentLength, r.contentRange], [206, 10, "bytes 0-9/100"]);
    assert.equal(new Headers(vistas[0].init?.headers).get("range"), "bytes=0-9");
  });

  it("416 del Storage se entrega como 416 con el tamaño", async () => {
    const r = await abrirVideoDeStorage("http://s/v.mp4", "bytes=999-", falso(respuesta("", { status: 416, headers: { "content-range": "bytes */100" } })));
    assert.deepEqual([r?.status, r?.contentRange, r?.body], [416, "bytes */100", null]);
  });

  it("404, otros errores, otro tipo de archivo, sin cuerpo o un 206 sin Content-Range: null", async () => {
    for (const [nombre, res] of [
      ["404", respuesta("nada", { status: 404, headers: { "content-type": "application/json" } })],
      ["500", respuesta("x", { status: 500, headers: { "content-type": "video/mp4" } })],
      ["otro tipo", respuesta("<html>", { status: 200, headers: { "content-type": "text/html" } })],
      ["una imagen", respuesta(BYTES, { status: 200, headers: { "content-type": "image/webp" } })],
      ["sin tipo", respuesta(BYTES, { status: 200 })],
      ["sin cuerpo", respuesta(null, { status: 200, headers: { "content-type": "video/mp4" } })],
      ["206 sin rango", respuesta(BYTES, { status: 206, headers: { "content-type": "video/mp4" } })],
    ] as Array<[string, Response]>) {
      assert.equal(await abrirVideoDeStorage("http://s/v.mp4", null, falso(res)), null, nombre);
    }
  });

  it("acepta el tipo con parámetros y en mayúsculas, y un largo ausente o raro es «desconocido»", async () => {
    const r = await abrirVideoDeStorage("http://s/v.mp4", null, falso(respuesta(BYTES, { status: 200, headers: { "content-type": "Video/MP4; charset=binary" } })));
    assert.deepEqual([r?.status, r?.contentLength], [200, null]);
    const raro = await abrirVideoDeStorage("http://s/v.mp4", null, falso(respuesta(BYTES, { status: 200, headers: { "content-type": "video/mp4", "content-length": "abc" } })));
    assert.equal(raro?.contentLength, null);
  });

  it("un fallo de red es null (nunca lanza)", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal(await abrirVideoDeStorage("http://s/v.mp4", null, (async () => Promise.reject(new Error("sin red"))) as typeof fetch), null);
    } finally {
      console.error = original;
    }
  });
});
