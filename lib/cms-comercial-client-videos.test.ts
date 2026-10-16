/**
 * Cliente del navegador de la administración de tienda — la subida de VIDEOS en etapas (imagen fija → video directo a Storage → verificación del servidor) y la reducción de las imágenes de
 * categoría. Sin red: con un `fetch` de prueba.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCmsClient, MAX_BYTES_SIN_COMPRIMIR } from "@/lib/cms-comercial-client";

interface Llamada {
  url: string;
  metodo: string;
  cuerpo: unknown;
}

/** Un `fetch` que registra cada llamada y responde con lo que diga `responder`. */
function falso(responder: (l: Llamada) => Response | Promise<Response>) {
  const llamadas: Llamada[] = [];
  const f = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const l: Llamada = { url: String(entrada), metodo: (init?.method ?? "GET").toUpperCase(), cuerpo: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
    llamadas.push(l);
    return responder(l);
  }) as typeof fetch;
  return { f, llamadas };
}

const ok = (data: unknown, status = 200) => Response.json({ success: true, data }, { status });
const fallo = (status: number, error: unknown) => Response.json({ success: false, error }, { status });

const video = (bytes = 900_000, nombre = "portada.mp4") => new File([new Uint8Array(bytes)], nombre, { type: "video/mp4" });
const fija = () => new Blob([new Uint8Array(500)], { type: "image/jpeg" });
const archivoPng = (bytes = 1000) => new File([new Uint8Array(bytes)], "categoria.png", { type: "image/png" });
const ticketImagen = { id: "img-1", bucket: "inventario-productos", path: "t/cms/img-1/subida", token: "tk-i" };
const ticketVideo = { id: "vid-1", bucket: "inventario-productos", path: "t/cms/vid-1/subida", token: "tk-v", maxBytes: 3 * 1024 * 1024 };
const imagen = { id: "img-1", url: "https://cdn.test/fija.webp", ancho: 1280, alto: 720 };
const confirmado = { video: { id: "vid-1", url: "https://cdn.test/video.mp4", ancho: 1280, alto: 720, bytes: 900_000, nombreOriginal: "portada.mp4", createdAt: "2026-10-15T00:00:00Z" }, duracionSeg: 8, seCorrigio: [], recomendaciones: [] };

/** Responde según la ruta, como lo haría el servidor. */
const servidor = (over: Partial<Record<string, () => Response>> = {}) =>
  falso((l) => {
    const ruta = l.url.replace("/api/dashboard/tienda", "");
    const propio = over[ruta];
    if (propio) return propio();
    if (ruta === "/imagenes/upload-url") return ok({ subida: ticketImagen }, 201);
    if (ruta === "/imagenes/img-1/confirmar") return ok({ imagen });
    if (ruta === "/videos/upload-url") return ok({ subida: ticketVideo }, 201);
    if (ruta === "/videos/vid-1/confirmar") return ok(confirmado);
    if (ruta === "/videos") return ok({ items: [confirmado.video] });
    return fallo(404, { code: "NOT_FOUND", message: "no existe" });
  });

describe("cliente de la API de tienda — subir un video en etapas", () => {
  it("la lista de videos pide GET /videos", async () => {
    const { f, llamadas } = servidor();
    const r = await createCmsClient("t", { fetch: f }).videos();
    assert.equal(r.ok, true);
    assert.deepEqual(llamadas.map((l) => `${l.metodo} ${l.url}`), ["GET /api/dashboard/tienda/videos"]);
  });

  it("primero la imagen fija, luego el video directo a Storage y por último la verificación del servidor con el espacio; avisa cada etapa", async () => {
    const { f, llamadas } = servidor();
    const subidas: string[] = [];
    const preparadas: Array<number | undefined> = [];
    const c = createCmsClient("t", {
      fetch: f,
      preparar: async (a, o) => {
        preparadas.push(o?.ladoMaximo);
        return { blob: a, mimeType: a.type };
      },
      subir: async (tk, blob, mime) => {
        subidas.push(`${tk.path}|${mime}|${blob.size}`);
        return { ok: true, data: null };
      },
    });
    const etapas: string[] = [];
    const r = await c.subirVideo(video(), "portada.horizontal", fija(), { onEtapa: (e) => etapas.push(e) });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.data.video, confirmado.video);
      assert.deepEqual(r.data.imagen, imagen);
      assert.equal(r.data.duracionSeg, 8);
    }
    assert.deepEqual(etapas, ["imagen-fija", "subiendo", "verificando"]);
    assert.deepEqual(
      llamadas.map((l) => `${l.metodo} ${l.url.replace("/api/dashboard/tienda", "")}`),
      ["POST /imagenes/upload-url", "POST /imagenes/img-1/confirmar", "POST /videos/upload-url", "POST /videos/vid-1/confirmar"],
    );
    assert.deepEqual(subidas, ["t/cms/img-1/subida|image/jpeg|500", "t/cms/vid-1/subida|video/mp4|900000"]);
    assert.deepEqual(llamadas[2].cuerpo, { mimeType: "video/mp4", bytes: 900_000, nombreOriginal: "portada.mp4" });
    assert.deepEqual(llamadas[3].cuerpo, { archivo: "portada.horizontal" });
    assert.deepEqual(preparadas, [1280], "la imagen fija se reduce a 1280 px por el lado más largo");
    assert.equal((llamadas[0].cuerpo as { nombreOriginal: string }).nombreOriginal, "imagen-fija-portada-horizontal.jpg");
  });

  it("el video se declara SIEMPRE como video/mp4 (lo que dice el navegador del archivo no cuenta: un MP4 puede llegar sin tipo o como QuickTime); lo que manda es su contenido", async () => {
    for (const tipo of ["", "video/quicktime", "application/octet-stream", "video/x-m4v"]) {
      const { f, llamadas } = servidor();
      const subidas: string[] = [];
      const c = createCmsClient("t", { fetch: f, preparar: async (a) => ({ blob: a, mimeType: a.type }), subir: async (tk, _blob, mime) => (subidas.push(`${tk.path}|${mime}`), { ok: true, data: null }) });
      const r = await c.subirVideo(new File([new Uint8Array(900_000)], "mi-video.mov", { type: tipo }), "marca.horizontal", fija());
      assert.equal(r.ok, true, `tipo «${tipo}»`);
      assert.equal((llamadas[2].cuerpo as { mimeType: string }).mimeType, "video/mp4", `la API recibe video/mp4 aunque el archivo diga «${tipo}»`);
      assert.deepEqual(subidas[1], "t/cms/vid-1/subida|video/mp4", `y a Storage sube como video/mp4`);
    }
  });

  it("el video NO pasa por el servidor de la aplicación: a la API solo van sus datos, nunca el archivo", async () => {
    const { f, llamadas } = servidor();
    const c = createCmsClient("t", { fetch: f, preparar: async (a) => ({ blob: a, mimeType: a.type }), subir: async () => ({ ok: true, data: null }) });
    await c.subirVideo(video(2_500_000), "marca.horizontal", fija());
    for (const l of llamadas) assert.ok(JSON.stringify(l.cuerpo ?? {}).length < 400, "los cuerpos son pequeños: ninguno lleva el video");
  });

  it("si la imagen fija no se puede subir, no se toca el video", async () => {
    const { f, llamadas } = servidor({ "/imagenes/upload-url": () => fallo(403, { code: "FORBIDDEN", message: "Solo un administrador puede modificar la tienda." }) });
    let subidas = 0;
    const c = createCmsClient("t", { fetch: f, preparar: async (a) => ({ blob: a, mimeType: a.type }), subir: async () => (subidas++, { ok: true, data: null }) });
    const r = await c.subirVideo(video(), "portada.horizontal", fija());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "FORBIDDEN");
    assert.equal(subidas, 0);
    assert.equal(llamadas.some((l) => l.url.includes("/videos")), false);
  });

  it("si el servidor no acepta el video de entrada (pesa de más), el mensaje llega y no se sube a Storage ni se confirma", async () => {
    const { f, llamadas } = servidor({ "/videos/upload-url": () => fallo(400, { code: "VALIDATION_ERROR", message: "El video supera el tamaño máximo permitido (3 MB)." }) });
    const subidas: string[] = [];
    const c = createCmsClient("t", { fetch: f, preparar: async (a) => ({ blob: a, mimeType: a.type }), subir: async (tk) => (subidas.push(tk.path), { ok: true, data: null }) });
    const r = await c.subirVideo(video(4_000_000), "portada.horizontal", fija());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.message, "El video supera el tamaño máximo permitido (3 MB).");
    assert.deepEqual(subidas, ["t/cms/img-1/subida"], "solo la imagen fija llegó a Storage");
    assert.equal(llamadas.some((l) => l.url.endsWith("/confirmar") && l.url.includes("/videos/")), false);
  });

  it("si Storage falla al subir el video, no se confirma", async () => {
    const { f, llamadas } = servidor();
    const c = createCmsClient("t", {
      fetch: f,
      preparar: async (a) => ({ blob: a, mimeType: a.type }),
      subir: async (_tk, _blob, mime) => (mime === "video/mp4" ? { ok: false, error: { code: "UPLOAD_FAILED", message: "No se pudo subir el video. Revisa tu conexión e intenta de nuevo.", status: 0 } } : { ok: true, data: null }),
    });
    const etapas: string[] = [];
    const r = await c.subirVideo(video(), "portada.horizontal", fija(), { onEtapa: (e) => etapas.push(e) });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "UPLOAD_FAILED");
    assert.deepEqual(etapas, ["imagen-fija", "subiendo"], "nunca llegó a «verificando»");
    assert.equal(llamadas.some((l) => l.url.endsWith("/videos/vid-1/confirmar")), false);
  });

  it("si el servidor rechaza el video al verificarlo, llegan las reglas que falla para mostrarlas", async () => {
    const problemas = [{ severidad: "error", codigo: "sonido", campo: "portada.horizontal", mensaje: "No tiene sonido. Trae una pista de audio. Quítale el sonido al exportar." }];
    const { f } = servidor({ "/videos/vid-1/confirmar": () => fallo(400, { code: "VALIDATION_ERROR", message: "Este video no se puede usar: Trae una pista de audio.", diagnostics: { problemas } }) });
    const c = createCmsClient("t", { fetch: f, preparar: async (a) => ({ blob: a, mimeType: a.type }), subir: async () => ({ ok: true, data: null }) });
    const r = await c.subirVideo(video(), "portada.horizontal", fija());
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error.message, /Este video no se puede usar/);
      assert.deepEqual(r.error.problemas, problemas);
    }
  });
});

describe("cliente de la API de tienda — imágenes con tope de lado (categorías)", () => {
  it("le pasan el tope a la preparación; sin tope, nada cambia", async () => {
    const { f } = servidor();
    const topes: Array<number | undefined> = [];
    const c = createCmsClient("t", {
      fetch: f,
      preparar: async (a, o) => (topes.push(o?.ladoMaximo), { blob: a, mimeType: a.type }),
      subir: async () => ({ ok: true, data: null }),
    });
    await c.subirImagen(archivoPng(), { ladoMaximo: 1200 });
    await c.subirImagen(archivoPng());
    assert.deepEqual(topes, [1200, undefined]);
  });

  it("sin poder reducir la imagen en este entorno (no hay canvas), una liviana sube igual; una pesada se rechaza sin tocar la red", async () => {
    const { f, llamadas } = servidor();
    let subido = 0;
    const c = createCmsClient("t", { fetch: f, subir: async (_tk, blob) => ((subido = blob.size), { ok: true, data: null }) });
    assert.equal((await c.subirImagen(archivoPng(2000), { ladoMaximo: 1200 })).ok, true);
    assert.equal(subido, 2000);
    llamadas.length = 0;
    const pesada = await c.subirImagen(archivoPng(MAX_BYTES_SIN_COMPRIMIR + 1), { ladoMaximo: 1200 });
    assert.equal(pesada.ok, false);
    assert.deepEqual(llamadas, []);
  });
});
