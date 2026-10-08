/**
 * Cliente del navegador de la administración de tienda — contrato con la API (sin red, con un `fetch` de prueba): cómo arma cada petición, cómo traduce las
 * respuestas y los errores a resultados tipados que NUNCA lanzan, y la subida de imágenes en etapas.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCmsClient, MAX_BYTES_SIN_COMPRIMIR } from "@/lib/cms-comercial-client";

interface Llamada {
  url: string;
  metodo: string;
  headers: Record<string, string>;
  cuerpo: unknown;
}

/** Un `fetch` que registra cada llamada y responde con lo que diga `responder`. */
function falso(responder: (l: Llamada, n: number) => Response | Promise<Response>) {
  const llamadas: Llamada[] = [];
  const f = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const l: Llamada = { url: String(entrada), metodo: (init?.method ?? "GET").toUpperCase(), headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), cuerpo: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
    llamadas.push(l);
    return responder(l, llamadas.length);
  }) as typeof fetch;
  return { f, llamadas };
}

const ok = (data: unknown, status = 200) => Response.json({ success: true, data }, { status });
const fallo = (status: number, error: unknown) => Response.json({ success: false, error }, { status });

describe("cliente de la API de tienda — peticiones", () => {
  it("toda llamada lleva la sesión; solo las que mandan datos declaran JSON", async () => {
    const { f, llamadas } = falso(() => ok({ items: [] }));
    const c = createCmsClient("token-123", { fetch: f });
    await c.listar();
    await c.crear("oferta", { nombre: "Amor" });
    assert.equal(llamadas[0].headers.Authorization, "Bearer token-123");
    assert.equal(llamadas[0].headers["Content-Type"], undefined, "un GET no declara contenido");
    assert.equal(llamadas[1].headers.Authorization, "Bearer token-123");
    assert.equal(llamadas[1].headers["Content-Type"], "application/json");
    assert.deepEqual(llamadas[1].cuerpo, { tipo: "oferta", borrador: { nombre: "Amor" } });
  });

  it("arma las rutas y los filtros como los espera el servidor (y codifica los identificadores)", async () => {
    const { f, llamadas } = falso(() => ok({}));
    const c = createCmsClient("t", { fetch: f });
    await c.listar();
    await c.listar({ tipo: "oferta", estado: "publicada", archivadas: true });
    await c.obtener("a b/c");
    await c.guardarBorrador("id1", { nombre: "x" }, 4);
    await c.validar("id1");
    await c.publicar("id1", 5, "primera");
    await c.publicar("id1", 6);
    await c.restaurar("id1", 2, "se me fue la mano");
    await c.pausar("id1");
    await c.reanudar("id1");
    await c.despublicar("id1");
    await c.archivar("id1");
    await c.desarchivar("id1");
    await c.versiones("id1");
    await c.auditoria();
    await c.auditoria({ entidad: "id1", limite: 20, antes: 77 });
    await c.contexto();
    await c.productos();
    await c.productos({ q: "aretes" });
    await c.productos({ referencias: ["DL-000001", "DL-000002"] });
    await c.productos({ referencias: [], q: "dije" });
    await c.imagenes();
    const resumen = llamadas.map((l) => `${l.metodo} ${l.url}`);
    assert.deepEqual(resumen, [
      "GET /api/dashboard/tienda/entidades",
      "GET /api/dashboard/tienda/entidades?tipo=oferta&estado=publicada&archivadas=true",
      "GET /api/dashboard/tienda/entidades/a%20b%2Fc",
      "PUT /api/dashboard/tienda/entidades/id1/borrador",
      "POST /api/dashboard/tienda/entidades/id1/validar",
      "POST /api/dashboard/tienda/entidades/id1/publicar",
      "POST /api/dashboard/tienda/entidades/id1/publicar",
      "POST /api/dashboard/tienda/entidades/id1/restaurar",
      "POST /api/dashboard/tienda/entidades/id1/pausar",
      "POST /api/dashboard/tienda/entidades/id1/reanudar",
      "POST /api/dashboard/tienda/entidades/id1/despublicar",
      "POST /api/dashboard/tienda/entidades/id1/archivar",
      "POST /api/dashboard/tienda/entidades/id1/desarchivar",
      "GET /api/dashboard/tienda/entidades/id1/versiones",
      "GET /api/dashboard/tienda/auditoria",
      "GET /api/dashboard/tienda/auditoria?entidad=id1&limite=20&antes=77",
      "GET /api/dashboard/tienda/contexto",
      "GET /api/dashboard/tienda/productos",
      "GET /api/dashboard/tienda/productos?q=aretes",
      "GET /api/dashboard/tienda/productos?referencias=DL-000001%2CDL-000002",
      "GET /api/dashboard/tienda/productos?q=dije",
      "GET /api/dashboard/tienda/imagenes",
    ]);
    assert.deepEqual(llamadas[3].cuerpo, { borrador: { nombre: "x" }, rev: 4 });
    assert.deepEqual(llamadas[5].cuerpo, { rev: 5, nota: "primera" });
    assert.deepEqual(llamadas[6].cuerpo, { rev: 6 }, "sin nota no se manda la clave");
    assert.deepEqual(llamadas[7].cuerpo, { version: 2, nota: "se me fue la mano" });
    assert.equal(llamadas[4].cuerpo, undefined, "validar y las transiciones no mandan cuerpo");
  });

  it("el negocio NUNCA viaja en la petición: ni en la ruta, ni en los filtros, ni en el cuerpo", async () => {
    const { f, llamadas } = falso(() => ok({}));
    const c = createCmsClient("t", { fetch: f });
    await c.listar({ tipo: "combo" });
    await c.crear("home", { portada: { visible: true } });
    await c.guardarBorrador("id", { a: 1 }, 1);
    for (const l of llamadas) assert.doesNotMatch(`${l.url} ${JSON.stringify(l.cuerpo ?? {})}`, /tenant|id_tenant|negocio/i);
  });
});

describe("cliente de la API de tienda — respuestas y errores (nunca lanza)", () => {
  it("una respuesta buena devuelve sus datos tipados", async () => {
    const { f } = falso(() => ok({ items: [{ id: "1" }] }));
    const r = await createCmsClient("t", { fetch: f }).listar();
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.data, { items: [{ id: "1" }] });
  });

  it("un error del servidor conserva su código, su mensaje claro y su estado", async () => {
    const { f } = falso(() => fallo(403, { code: "FORBIDDEN", message: "Solo un administrador puede modificar la tienda." }));
    const r = await createCmsClient("t", { fetch: f }).publicar("id", 1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.error, { code: "FORBIDDEN", message: "Solo un administrador puede modificar la tienda.", status: 403 });
  });

  it("los problemas de validación (422) llegan para mostrarlos junto a cada campo", async () => {
    const problemas = [{ severidad: "error", codigo: "esquema", campo: "nombre", mensaje: "El nombre es obligatorio." }];
    const { f } = falso(() => fallo(422, { code: "NOT_PUBLISHABLE", message: "Corrige los problemas marcados antes de publicar.", diagnostics: { problemas } }));
    const r = await createCmsClient("t", { fetch: f }).publicar("id", 1);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.code, "NOT_PUBLISHABLE");
      assert.deepEqual(r.error.problemas, problemas);
    }
  });

  it("un error sin problemas no inventa la lista; un `diagnostics` raro se ignora", async () => {
    for (const diagnostics of [undefined, {}, { problemas: "no es una lista" }, { problemas: null }]) {
      const { f } = falso(() => fallo(409, { code: "CONFLICT", message: "Otra persona cambió este elemento.", diagnostics }));
      const r = await createCmsClient("t", { fetch: f }).guardarBorrador("id", {}, 1);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal("problemas" in r.error, false, JSON.stringify(diagnostics));
    }
  });

  it("sin conexión: un mensaje claro, no una excepción", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const r = await createCmsClient("t", { fetch: f }).listar();
    assert.deepEqual(r, { ok: false, error: { code: "NETWORK_ERROR", message: "Sin conexión. Revisa tu internet e intenta de nuevo.", status: 0 } });
  });

  it("una respuesta que no es JSON (por ejemplo una página de error del proxy) se vuelve un error genérico", async () => {
    const { f } = falso(() => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
    const r = await createCmsClient("t", { fetch: f }).listar();
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual({ code: r.error.code, status: r.error.status, message: r.error.message }, { code: "UNKNOWN", status: 502, message: "Ocurrió un error inesperado." });
  });

  it("el límite de solicitudes (429) se reconoce aunque el cuerpo sea solo un texto", async () => {
    const { f } = falso(() => fallo(429, "Demasiadas solicitudes. Intenta de nuevo en unos segundos."));
    const r = await createCmsClient("t", { fetch: f }).listar();
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.error, { code: "RATE_LIMITED", message: "Demasiadas solicitudes. Intenta de nuevo en unos segundos.", status: 429 });
  });

  it("un 200 sin los datos esperados no se da por bueno", async () => {
    const { f } = falso(() => Response.json({ success: true }));
    const r = await createCmsClient("t", { fetch: f }).listar();
    assert.equal(r.ok, false, "falta `data`: es un error, no un éxito vacío");
  });
});

describe("cliente de la API de tienda — subir una imagen en etapas", () => {
  const archivo = (tipo = "image/png", bytes = 1000, nombre = "portada.png") => new File([new Uint8Array(bytes)], nombre, { type: tipo });
  const ticket = { id: "img-1", bucket: "inventario-productos", path: "t/cms/img-1/subida", token: "tk" };
  const imagen = { id: "img-1", url: "https://cdn.test/img.webp", ancho: 800, alto: 400 };

  it("prepara → pide la URL firmada → sube directo a Storage → confirma, y avisa de cada etapa", async () => {
    const { f, llamadas } = falso((l) => (l.url.endsWith("/imagenes/upload-url") ? ok({ subida: ticket }, 201) : ok({ imagen })));
    const orden: string[] = [];
    const c = createCmsClient("t", {
      fetch: f,
      preparar: async (a) => {
        orden.push("preparar");
        return { blob: a, mimeType: a.type };
      },
      subir: async (tk, blob, mime) => {
        orden.push(`subir:${tk.path}:${mime}:${blob.size}`);
        return { ok: true, data: null };
      },
    });
    const etapas: string[] = [];
    const r = await c.subirImagen(archivo(), { onEtapa: (e) => etapas.push(e) });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.data.imagen, imagen);
    assert.deepEqual(etapas, ["preparando", "subiendo", "confirmando"]);
    assert.deepEqual(orden, ["preparar", "subir:t/cms/img-1/subida:image/png:1000"]);
    assert.deepEqual(
      llamadas.map((l) => `${l.metodo} ${l.url}`),
      ["POST /api/dashboard/tienda/imagenes/upload-url", "POST /api/dashboard/tienda/imagenes/img-1/confirmar"],
    );
    assert.deepEqual(llamadas[0].cuerpo, { mimeType: "image/png", bytes: 1000, nombreOriginal: "portada.png" });
  });

  it("la foto NO pasa por el servidor de la aplicación: a la API solo van sus datos, nunca el archivo", async () => {
    const { f, llamadas } = falso((l) => (l.url.endsWith("/imagenes/upload-url") ? ok({ subida: ticket }, 201) : ok({ imagen })));
    const c = createCmsClient("t", { fetch: f, preparar: async (a) => ({ blob: a, mimeType: a.type }), subir: async () => ({ ok: true, data: null }) });
    await c.subirImagen(archivo("image/jpeg", 2_000_000, "grande.jpg"));
    for (const l of llamadas) assert.ok(JSON.stringify(l.cuerpo ?? {}).length < 400, "los cuerpos son pequeños: ninguno lleva la imagen");
  });

  it("si la preparación falla, se dice por qué y no se pide ninguna URL", async () => {
    const { f, llamadas } = falso(() => ok({}));
    const c = createCmsClient("t", {
      fetch: f,
      preparar: async () => {
        throw new Error("La imagen pesa demasiado. Redúcela e intenta de nuevo.");
      },
    });
    const r = await c.subirImagen(archivo());
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.error, { code: "IMAGE_INVALID", message: "La imagen pesa demasiado. Redúcela e intenta de nuevo.", status: 0 });
    assert.deepEqual(llamadas, []);
  });

  it("sin preparación propia: un tipo que no es JPG, PNG o WebP se rechaza antes de tocar la red", async () => {
    const { f, llamadas } = falso(() => ok({}));
    const r = await createCmsClient("t", { fetch: f }).subirImagen(archivo("image/gif", 500, "animada.gif"));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.message, "Usa una imagen JPG, PNG o WebP.");
    assert.deepEqual(llamadas, []);
    const pdf = await createCmsClient("t", { fetch: f }).subirImagen(archivo("application/pdf", 500, "x.pdf"));
    assert.equal(pdf.ok, false);
  });

  it("sin preparación propia: una foto liviana sube tal cual y una muy pesada (sin poder comprimirla aquí) se rechaza con un mensaje claro", async () => {
    const { f, llamadas } = falso((l) => (l.url.endsWith("/imagenes/upload-url") ? ok({ subida: ticket }, 201) : ok({ imagen })));
    let subido = 0;
    const liviana = createCmsClient("t", {
      fetch: f,
      subir: async (_tk, blob) => {
        subido = blob.size;
        return { ok: true, data: null };
      },
    });
    assert.equal((await liviana.subirImagen(archivo("image/webp", MAX_BYTES_SIN_COMPRIMIR))).ok, true);
    assert.equal(subido, MAX_BYTES_SIN_COMPRIMIR, "justo en el límite se sube sin tocar");
    llamadas.length = 0;
    const pesada = await createCmsClient("t", { fetch: f }).subirImagen(archivo("image/png", MAX_BYTES_SIN_COMPRIMIR + 1));
    assert.equal(pesada.ok, false);
    if (!pesada.ok) assert.equal(pesada.error.message, "La imagen pesa demasiado. Redúcela e intenta de nuevo.");
    assert.deepEqual(llamadas, []);
  });

  it("si el servidor rechaza la subida (sin permiso, tipo o tamaño), el error llega tal cual y no se sube nada", async () => {
    const { f, llamadas } = falso(() => fallo(403, { code: "FORBIDDEN", message: "Solo un administrador puede modificar la tienda." }));
    let intentos = 0;
    const c = createCmsClient("t", {
      fetch: f,
      preparar: async (a) => ({ blob: a, mimeType: a.type }),
      subir: async () => {
        intentos++;
        return { ok: true, data: null };
      },
    });
    const r = await c.subirImagen(archivo());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "FORBIDDEN");
    assert.equal(intentos, 0);
    assert.equal(llamadas.length, 1);
  });

  it("si Storage falla, no se confirma (no queda una imagen a medias)", async () => {
    const { f, llamadas } = falso((l) => (l.url.endsWith("/imagenes/upload-url") ? ok({ subida: ticket }, 201) : ok({ imagen })));
    const c = createCmsClient("t", {
      fetch: f,
      preparar: async (a) => ({ blob: a, mimeType: a.type }),
      subir: async () => ({ ok: false, error: { code: "UPLOAD_FAILED", message: "No se pudo subir la imagen. Revisa tu conexión e intenta de nuevo.", status: 0 } }),
    });
    const etapas: string[] = [];
    const r = await c.subirImagen(archivo(), { onEtapa: (e) => etapas.push(e) });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "UPLOAD_FAILED");
    assert.deepEqual(etapas, ["preparando", "subiendo"], "nunca llegó a «confirmando»");
    assert.equal(llamadas.some((l) => l.url.endsWith("/confirmar")), false);
  });

  it("si el servidor no reconoce la imagen al confirmar (no era una imagen), el mensaje llega a la pantalla", async () => {
    const { f } = falso((l) => (l.url.endsWith("/imagenes/upload-url") ? ok({ subida: ticket }, 201) : fallo(400, { code: "VALIDATION_ERROR", message: "El archivo no es una imagen válida. Usa una foto JPG, PNG o WebP." })));
    const c = createCmsClient("t", { fetch: f, preparar: async (a) => ({ blob: a, mimeType: a.type }), subir: async () => ({ ok: true, data: null }) });
    const r = await c.subirImagen(archivo());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.message, "El archivo no es una imagen válida. Usa una foto JPG, PNG o WebP.");
  });
});
