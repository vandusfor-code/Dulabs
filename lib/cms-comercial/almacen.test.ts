/**
 * CMS comercial — adaptador de Storage: traduce al cliente de Supabase y NUNCA filtra el detalle de un error. Con un cliente falso (sin red) y un `fetch` falso
 * para la lectura por la URL pública.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearAlmacenSupabase } from "@/lib/cms-comercial/almacen";
import { isCmsError } from "@/lib/cms-comercial/errores";

const URL_BASE = "https://proyecto.supabase.co";
let fetchOriginal: typeof fetch;
let entorno: string | undefined;

beforeEach(() => {
  entorno = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = URL_BASE;
  fetchOriginal = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  if (entorno === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = entorno;
});

type Respuesta = { data?: unknown; error?: { message: string } | null };
function clienteFalso(respuestas: Partial<Record<"createSignedUploadUrl" | "info" | "upload" | "remove", Respuesta>> = {}) {
  const llamadas: Array<{ metodo: string; args: unknown[] }> = [];
  const metodo = (nombre: keyof typeof respuestas, porDefecto: Respuesta) => async (...args: unknown[]) => {
    llamadas.push({ metodo: nombre, args });
    return respuestas[nombre] ?? porDefecto;
  };
  const supabase = {
    storage: {
      from: (bucket: string) => {
        llamadas.push({ metodo: "from", args: [bucket] });
        return {
          createSignedUploadUrl: metodo("createSignedUploadUrl", { data: { path: "ruta", token: "tk", signedUrl: "x" }, error: null }),
          info: metodo("info", { data: { size: 1234, contentType: "image/webp" }, error: null }),
          upload: metodo("upload", { data: { path: "ruta" }, error: null }),
          remove: metodo("remove", { data: [], error: null }),
        };
      },
    },
  } as unknown as SupabaseClient;
  return { supabase, llamadas };
}

const trozos = (...partes: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of partes) c.enqueue(p);
      c.close();
    },
  });

async function codigoDe(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (err) {
    assert.ok(isCmsError(err));
    return err;
  }
  assert.fail("se esperaba un error");
}

describe("crearAlmacenSupabase", () => {
  it("usa el bucket del catálogo y expone URLs públicas estables, con cada segmento codificado", () => {
    const { supabase } = clienteFalso();
    const a = crearAlmacenSupabase(supabase);
    assert.equal(a.bucket, "inventario-productos");
    assert.equal(a.urlPublica("neg/cms/abc/imagen.webp"), `${URL_BASE}/storage/v1/object/public/inventario-productos/neg/cms/abc/imagen.webp`);
    assert.equal(a.urlPublica("neg/cms/a b/ñ?.webp"), `${URL_BASE}/storage/v1/object/public/inventario-productos/neg/cms/a%20b/%C3%B1%3F.webp`);
  });

  it("firmarSubida devuelve ruta y token; si falla, error genérico sin el detalle", async () => {
    const ok = clienteFalso();
    assert.deepEqual(await crearAlmacenSupabase(ok.supabase).firmarSubida("neg/cms/x/subida"), { path: "ruta", token: "tk" });
    assert.deepEqual(ok.llamadas.find((l) => l.metodo === "createSignedUploadUrl")?.args, ["neg/cms/x/subida"]);
    const mal = clienteFalso({ createSignedUploadUrl: { data: null, error: { message: 'bucket "secreto-interno" no existe' } } });
    const err = await codigoDe(crearAlmacenSupabase(mal.supabase).firmarSubida("p"));
    assert.equal(err.code, "INTERNAL_ERROR");
    assert.equal(err.message.includes("secreto"), false);
  });

  it("info devuelve tamaño y tipo, o null si no existe o falla", async () => {
    assert.deepEqual(await crearAlmacenSupabase(clienteFalso().supabase).info("p"), { size: 1234, contentType: "image/webp" });
    assert.equal(await crearAlmacenSupabase(clienteFalso({ info: { data: null, error: { message: "Object not found" } } }).supabase).info("p"), null);
    assert.deepEqual(await crearAlmacenSupabase(clienteFalso({ info: { data: { size: "x" }, error: null } }).supabase).info("p"), { size: null, contentType: null });
  });

  it("escribir sube con upsert y caché larga (la ruta lleva el id: nunca cambia); un fallo es un error genérico", async () => {
    const { supabase, llamadas } = clienteFalso();
    await crearAlmacenSupabase(supabase).escribir("neg/cms/x/imagen.webp", new Uint8Array([1, 2, 3]), "image/webp");
    const subida = llamadas.find((l) => l.metodo === "upload");
    assert.equal(subida?.args[0], "neg/cms/x/imagen.webp");
    assert.deepEqual(subida?.args[2], { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
    const mal = clienteFalso({ upload: { data: null, error: { message: "row-level security: política secreta" } } });
    const err = await codigoDe(crearAlmacenSupabase(mal.supabase).escribir("p", new Uint8Array(1), "image/webp"));
    assert.equal(err.code, "INTERNAL_ERROR");
    assert.equal(err.message.includes("secreta"), false);
  });

  it("borrar con una lista vacía no llama; un fallo NO es fatal", async () => {
    const { supabase, llamadas } = clienteFalso();
    await crearAlmacenSupabase(supabase).borrar([]);
    assert.equal(llamadas.some((l) => l.metodo === "remove"), false);
    await crearAlmacenSupabase(supabase).borrar(["a", "b"]);
    assert.deepEqual(llamadas.find((l) => l.metodo === "remove")?.args, [["a", "b"]]);
    const original = console.error;
    console.error = () => {};
    try {
      await crearAlmacenSupabase(clienteFalso({ remove: { data: null, error: { message: "boom" } } }).supabase).borrar(["a"]);
    } finally {
      console.error = original;
    }
  });

  describe("leer (por la URL pública, con tope de tamaño)", () => {
    const almacen = () => crearAlmacenSupabase(clienteFalso().supabase);

    it("devuelve los bytes completos de un objeto dentro del tope", async () => {
      const visitadas: string[] = [];
      globalThis.fetch = (async (url: string | URL | Request) => {
        visitadas.push(String(url));
        return new Response(trozos(new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])), { status: 200 });
      }) as typeof fetch;
      const r = await almacen().leer("neg/cms/x/subida", 100);
      assert.deepEqual(Array.from(r ?? []), [1, 2, 3, 4, 5]);
      assert.deepEqual(visitadas, [`${URL_BASE}/storage/v1/object/public/inventario-productos/neg/cms/x/subida`]);
    });

    it("null si no existe, si la red falla, o si el cuerpo no está", async () => {
      globalThis.fetch = (async () => new Response("no", { status: 404 })) as typeof fetch;
      assert.equal(await almacen().leer("p", 100), null);
      const original = console.error;
      console.error = () => {};
      try {
        globalThis.fetch = (async () => {
          throw new Error("sin red");
        }) as typeof fetch;
        assert.equal(await almacen().leer("p", 100), null);
      } finally {
        console.error = original;
      }
      globalThis.fetch = (async () => new Response(null, { status: 200 })) as typeof fetch;
      assert.equal(await almacen().leer("p", 100), null);
    });

    it("null si lo anunciado o lo recibido supera el tope (no se descarga todo)", async () => {
      globalThis.fetch = (async () => new Response(trozos(new Uint8Array(10)), { status: 200, headers: { "content-length": "999999" } })) as typeof fetch;
      assert.equal(await almacen().leer("p", 1000), null, "lo declarado ya supera el tope");
      globalThis.fetch = (async () => new Response(trozos(new Uint8Array(600), new Uint8Array(600), new Uint8Array(600)), { status: 200 })) as typeof fetch;
      assert.equal(await almacen().leer("p", 1000), null, "mintió el encabezado (o no lo trae): se corta al pasar el tope");
      const justo = await almacen().leer("p", 1800);
      assert.equal(justo?.byteLength, 1800);
    });
  });
});
