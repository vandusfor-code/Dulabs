/**
 * CMS comercial — SERVICIO DE IMÁGENES sobre la base SQL real (Postgres embebido) y sharp real, con un almacén en memoria: permisos, el flujo completo de subida
 * (pedir → subir → confirmar), verificación y re-codificación, rutas siempre bajo el negocio, aislamiento, idempotencia, reintentos y límites.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
import type { Rol } from "@/lib/team";
import type { ActorCms } from "@/lib/cms-comercial/contrato";
import { isCmsError } from "@/lib/cms-comercial/errores";
import { MAX_BYTES_SUBIDA, formatoPorFirma } from "@/lib/cms-comercial/imagen-servidor";
import { LIMITE_IMAGENES, crearServicioImagenes, rutasDeImagen } from "@/lib/cms-comercial/imagenes";
import { crearLector } from "@/lib/cms-comercial/lector";
import { crearRepositorioSupabaseCms } from "@/lib/cms-comercial/repositorio-supabase";
import { crearServicioCms } from "@/lib/cms-comercial/servicio";
import { crearAlmacenMemoria, type AlmacenMemoria } from "@/lib/cms-comercial/testing/almacen-memoria";
import { crearBaseCms, type BaseCms } from "@/lib/cms-comercial/testing/pglite";

let base: BaseCms;
let almacen: AlmacenMemoria;
let repo: ReturnType<typeof crearRepositorioSupabaseCms>;
let servicio: ReturnType<typeof crearServicioImagenes>;
let serie = 0;

before(async () => {
  base = await crearBaseCms();
  repo = crearRepositorioSupabaseCms(base.supabase);
  almacen = crearAlmacenMemoria();
  servicio = crearServicioImagenes({ repo, almacen });
});
after(async () => {
  await base.cerrar();
});

async function negocio() {
  serie += 1;
  const t = `a0000000-0000-4000-8000-${String(serie).padStart(12, "0")}`;
  await base.habilitarModulo(t);
  return t;
}
const actor = (tenantId: string, rol: Rol = "admin", n = 1): ActorCms => ({ tenantId, userId: `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, miembroId: n, rol, etiqueta: `Persona ${n}` });
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 40, b: 200 } } }).jpeg().toBuffer();

async function falla(promesa: Promise<unknown>, codigo: string, mensaje?: RegExp) {
  try {
    await promesa;
  } catch (err) {
    assert.ok(isCmsError(err), `se esperaba CmsError y llegó ${String(err)}`);
    assert.equal(err.code, codigo, err.message);
    if (mensaje) assert.match(err.message, mensaje);
    return err;
  }
  assert.fail(`se esperaba el error ${codigo}`);
}

/** Pide la subida, «sube» como lo haría el navegador y devuelve el ticket. */
async function subir(a: ActorCms, bytes: Uint8Array, mimeType = "image/png", nombre = "foto.png") {
  const ticket = await servicio.solicitarSubida(a, { mimeType, bytes: bytes.byteLength, nombreOriginal: nombre });
  almacen.subirComoNavegador(ticket.path, bytes, mimeType);
  return ticket;
}

describe("PERMISOS: solo el administrador sube; todos consultan", () => {
  it("agente y lectura no pueden pedir una subida ni confirmar, y no se toca ni la base ni el almacén", async () => {
    const t = await negocio();
    const admin = actor(t);
    const ticket = await subir(admin, await png(100, 100));
    const llamadas = almacen.llamadas.length;
    const filas = (await base.sql("select 1 from public.dulabs_cms_assets where id_tenant = $1", [t])).length;
    for (const rol of ["agente", "lectura"] as Rol[]) {
      const a = actor(t, rol, 2);
      await falla(servicio.solicitarSubida(a, { mimeType: "image/png", bytes: 1000 }), "FORBIDDEN");
      await falla(servicio.confirmar(a, ticket.id), "FORBIDDEN");
    }
    assert.equal(almacen.llamadas.length, llamadas);
    assert.equal((await base.sql("select 1 from public.dulabs_cms_assets where id_tenant = $1", [t])).length, filas);
  });

  it("los tres roles pueden ver la galería", async () => {
    const t = await negocio();
    const admin = actor(t);
    const ticket = await subir(admin, await png(100, 100));
    await servicio.confirmar(admin, ticket.id);
    for (const rol of ["admin", "agente", "lectura"] as Rol[]) assert.equal((await servicio.listar(actor(t, rol, 3))).length, 1, rol);
  });
});

describe("PEDIR la subida: el servidor decide todo", () => {
  it("solo imágenes JPG, PNG o WebP de hasta 6 MB, con tamaño entero y positivo", async () => {
    const a = actor(await negocio());
    for (const mimeType of ["image/gif", "image/svg+xml", "application/pdf", "text/html", "", "image/png; charset=x"]) await falla(servicio.solicitarSubida(a, { mimeType, bytes: 1000 }), "VALIDATION_ERROR", /JPG, PNG o WebP/);
    for (const bytes of [0, -5, 1.5, Number.NaN]) await falla(servicio.solicitarSubida(a, { mimeType: "image/png", bytes }), "VALIDATION_ERROR");
    await falla(servicio.solicitarSubida(a, { mimeType: "image/png", bytes: MAX_BYTES_SUBIDA + 1 }), "VALIDATION_ERROR", /6 MB/);
    assert.ok((await servicio.solicitarSubida(a, { mimeType: "image/webp", bytes: MAX_BYTES_SUBIDA })).id);
  });

  it("la ruta es SIEMPRE {negocio}/cms/{id}/… y la decide el servidor; la imagen queda pendiente", async () => {
    const t = await negocio();
    const a = actor(t);
    const ticket = await servicio.solicitarSubida(a, { mimeType: "image/jpeg", bytes: 5000, nombreOriginal: "../../etc/passwd" });
    const { final, temporal } = rutasDeImagen(t, ticket.id);
    assert.equal(ticket.path, temporal);
    assert.ok(ticket.path.startsWith(`${t}/cms/${ticket.id}/`));
    assert.equal(ticket.bucket, "inventario-productos");
    assert.equal(ticket.maxBytes, MAX_BYTES_SUBIDA);
    assert.ok(ticket.token.length > 0);
    const [fila] = await base.sql<{ storage_path: string; estado: string; mime_type: string; nombre_original: string | null }>("select storage_path, estado, mime_type, nombre_original from public.dulabs_cms_assets where id = $1", [ticket.id]);
    assert.deepEqual([fila.storage_path, fila.estado, fila.mime_type], [final, "pendiente", "image/webp"]);
    assert.equal(fila.nombre_original, "passwd", "del nombre solo queda el archivo, sin rutas");
    assert.deepEqual(await servicio.listar(a), [], "una imagen pendiente no está en la galería");
  });

  it("limpia el nombre del archivo (rutas, símbolos, largo, vacío)", async () => {
    const a = actor(await negocio());
    const nombreDe = async (nombre: string | null | undefined) => {
      const ticket = await servicio.solicitarSubida(a, { mimeType: "image/png", bytes: 100, nombreOriginal: nombre });
      return (await base.sql<{ nombre_original: string | null }>("select nombre_original from public.dulabs_cms_assets where id = $1", [ticket.id]))[0].nombre_original;
    };
    assert.equal(await nombreDe("C:\\Users\\Ana\\Fotos\\portada final.png"), "portada final.png");
    assert.equal(await nombreDe("evil<>|?*.png"), "evil.png");
    assert.equal(await nombreDe("x".repeat(300)), "x".repeat(120));
    assert.equal(await nombreDe("   "), null);
    assert.equal(await nombreDe(null), null);
    assert.equal(await nombreDe(undefined), null);
  });
});

describe("CONFIRMAR: se verifica y se re-codifica lo subido", () => {
  it("flujo completo: queda un WebP verificado en su ruta final, el temporal se borra y la imagen queda lista", async () => {
    const t = await negocio();
    const a = actor(t);
    const ticket = await subir(a, await png(1000, 500));
    const imagen = await servicio.confirmar(a, ticket.id);
    const { final, temporal } = rutasDeImagen(t, ticket.id);
    assert.equal(imagen.id, ticket.id);
    assert.deepEqual([imagen.ancho, imagen.alto], [1000, 500]);
    assert.equal(imagen.url, almacen.urlPublica(final));
    assert.ok(imagen.bytes > 0);
    const guardada = almacen.objetos.get(final);
    assert.ok(guardada);
    assert.equal(guardada.contentType, "image/webp");
    assert.equal(formatoPorFirma(guardada.bytes), "webp", "lo publicado SIEMPRE es un WebP, aunque se haya subido un PNG");
    assert.equal(guardada.bytes.byteLength, imagen.bytes);
    assert.equal(almacen.objetos.has(temporal), false, "el archivo crudo se borra");
    const [fila] = await base.sql<{ estado: string; ancho: number; alto: number; bytes: number }>("select estado, ancho, alto, bytes from public.dulabs_cms_assets where id = $1", [ticket.id]);
    assert.deepEqual([fila.estado, fila.ancho, fila.alto, fila.bytes], ["listo", 1000, 500, imagen.bytes]);
    assert.deepEqual((await servicio.listar(a)).map((i) => i.id), [ticket.id]);
  });

  it("lo grande se reduce a 2400 px por el lado largo; lo guardado son los datos REALES, no los declarados", async () => {
    const a = actor(await negocio());
    const bytes = await jpeg(3600, 2400);
    const ticket = await servicio.solicitarSubida(a, { mimeType: "image/jpeg", bytes: 10, nombreOriginal: "mentira.jpg" }); // declara 10 bytes
    almacen.subirComoNavegador(ticket.path, bytes, "image/jpeg");
    const imagen = await servicio.confirmar(a, ticket.id);
    assert.deepEqual([imagen.ancho, imagen.alto], [2400, 1600]);
    assert.ok(imagen.bytes > 10);
  });

  it("el tipo que declaró quien sube no importa: manda la firma real del archivo", async () => {
    const a = actor(await negocio());
    const ticket = await subir(a, await png(200, 100), "image/jpeg", "dice-ser-jpg.jpg"); // es un PNG que dice ser JPEG
    const imagen = await servicio.confirmar(a, ticket.id);
    assert.deepEqual([imagen.ancho, imagen.alto], [200, 100]);
  });

  it("un archivo que NO es una imagen se rechaza, se borra lo subido y la imagen sigue pendiente (no se puede usar)", async () => {
    const t = await negocio();
    const a = actor(t);
    const ticket = await subir(a, new TextEncoder().encode("<svg onload=alert(1)>no soy una imagen</svg>"));
    await falla(servicio.confirmar(a, ticket.id), "VALIDATION_ERROR", /no es una imagen válida/);
    const { final, temporal } = rutasDeImagen(t, ticket.id);
    assert.equal(almacen.objetos.has(temporal), false, "lo subido se borra");
    assert.equal(almacen.objetos.has(final), false, "no se publica nada");
    assert.equal((await base.sql<{ estado: string }>("select estado from public.dulabs_cms_assets where id = $1", [ticket.id]))[0].estado, "pendiente");
    assert.deepEqual(await servicio.listar(a), []);
    assert.equal((await base.sql("select 1 from public.dulabs_cms_auditoria where entidad_id = $1", [ticket.id])).length, 0, "una imagen rechazada no deja registro de «subida»");
  });

  it("imágenes rotas, vacías, enormes o demasiado pequeñas: mensaje claro y nada publicado", async () => {
    const a = actor(await negocio());
    const entera = await png(300, 300);
    const casos: Array<[string, Uint8Array, RegExp]> = [
      ["truncada", entera.subarray(0, 200), /no es una imagen válida|No pudimos procesar/],
      ["diminuta", await png(8, 8), /demasiado pequeña/],
      ["lisa de 49 megapíxeles", await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png({ compressionLevel: 9 }).toBuffer(), /demasiado grande/],
    ];
    for (const [nombre, bytes, mensaje] of casos) {
      const ticket = await subir(a, bytes);
      await falla(servicio.confirmar(a, ticket.id), "VALIDATION_ERROR", mensaje);
      assert.equal(almacen.objetos.has(rutasDeImagen(a.tenantId, ticket.id).final), false, nombre);
    }
  });

  it("si lo subido supera los 6 MB, se rechaza y se borra", async () => {
    const t = await negocio();
    const a = actor(t);
    const ticket = await servicio.solicitarSubida(a, { mimeType: "image/png", bytes: 1000 });
    almacen.subirComoNavegador(ticket.path, new Uint8Array(MAX_BYTES_SUBIDA + 10), "image/png");
    await falla(servicio.confirmar(a, ticket.id), "VALIDATION_ERROR", /6 MB/);
    assert.equal(almacen.objetos.has(ticket.path), false);
  });

  it("confirmar sin haber subido nada: «no encontramos la imagen subida»", async () => {
    const a = actor(await negocio());
    const ticket = await servicio.solicitarSubida(a, { mimeType: "image/png", bytes: 1000 });
    await falla(servicio.confirmar(a, ticket.id), "VALIDATION_ERROR", /No encontramos la imagen subida/);
  });

  it("confirmar dos veces es IDEMPOTENTE: misma imagen y una sola auditoría", async () => {
    const t = await negocio();
    const a = actor(t);
    const ticket = await subir(a, await png(300, 200));
    const una = await servicio.confirmar(a, ticket.id);
    const dos = await servicio.confirmar(a, ticket.id);
    assert.deepEqual(dos, una);
    assert.equal((await base.sql("select 1 from public.dulabs_cms_auditoria where entidad_id = $1 and accion = 'subir_imagen'", [ticket.id])).length, 1);
  });

  it("confirmar dos veces NO vuelve a leer ni a escribir en el almacén: la segunda vez es solo una consulta", async () => {
    const a = actor(await negocio());
    const ticket = await subir(a, await png(300, 200));
    await servicio.confirmar(a, ticket.id);
    almacen.llamadas.length = 0;
    await servicio.confirmar(a, ticket.id);
    assert.deepEqual(almacen.llamadas, []);
  });

  it("una imagen cuya ruta registrada NO es la que el servidor calcula para ese negocio y esa imagen no se confirma: no se lee, no se escribe y no se borra nada", async () => {
    const t = await negocio();
    const a = actor(t);
    const id = "e0000000-0000-4000-8000-0000000000f1";
    // La base lo permite (está bajo la carpeta del negocio), pero no es {negocio}/cms/{id}/imagen.webp.
    const creada = await repo.crearAsset(t, { id, storagePath: `${t}/cms/${id}/otra-cosa.webp`, mimeType: "image/webp", bytes: 1000, ancho: 16, alto: 16, nombreOriginal: null, actor: a });
    assert.equal(creada.resultado, "ok");
    almacen.llamadas.length = 0;
    await falla(servicio.confirmar(a, id), "INTERNAL_ERROR", /No se pudo verificar la imagen/);
    assert.deepEqual(almacen.llamadas, []);
    assert.equal((await base.sql<{ estado: string }>("select estado from public.dulabs_cms_assets where id = $1", [id]))[0].estado, "pendiente");
  });

  it("un reintento tras una caída a mitad de camino (final escrita, base sin confirmar) se completa", async () => {
    const t = await negocio();
    const a = actor(t);
    const ticket = await subir(a, await png(640, 480));
    const { final, temporal } = rutasDeImagen(t, ticket.id);
    // Simula la caída: la imagen final ya se escribió y el temporal se borró, pero la base sigue en «pendiente».
    const webp = await sharp(await png(640, 480)).webp().toBuffer();
    await almacen.escribir(final, new Uint8Array(webp), "image/webp");
    await almacen.borrar([temporal]);
    const imagen = await servicio.confirmar(a, ticket.id);
    assert.deepEqual([imagen.ancho, imagen.alto], [640, 480]);
    assert.equal((await base.sql<{ estado: string }>("select estado from public.dulabs_cms_assets where id = $1", [ticket.id]))[0].estado, "listo");
  });

  it("si el almacén falla al escribir, error genérico y la imagen sigue pendiente (se puede reintentar)", async () => {
    const t = await negocio();
    const a = actor(t);
    const ticket = await subir(a, await png(300, 200));
    const escribirOriginal = almacen.escribir;
    almacen.escribir = async () => {
      throw new Error("storage caído: secreto interno");
    };
    try {
      await assert.rejects(servicio.confirmar(a, ticket.id), /storage caído/);
    } finally {
      almacen.escribir = escribirOriginal;
    }
    assert.equal((await base.sql<{ estado: string }>("select estado from public.dulabs_cms_assets where id = $1", [ticket.id]))[0].estado, "pendiente");
    assert.equal((await servicio.confirmar(a, ticket.id)).ancho, 300);
  });

  it("la auditoría registra quién subió y qué (tipo y dimensiones), sin guardar el contenido", async () => {
    const t = await negocio();
    const a = actor(t, "admin", 9);
    const ticket = await subir(a, await png(320, 240), "image/png", "portada.png");
    await servicio.confirmar(a, ticket.id);
    const [reg] = await base.sql<{ actor_etiqueta: string; actor_user_id: string; entidad_tipo: string; despues: { mime_type: string; ancho: number; alto: number; nombre_original: string } }>(
      "select actor_etiqueta, actor_user_id, entidad_tipo, despues from public.dulabs_cms_auditoria where entidad_id = $1",
      [ticket.id],
    );
    assert.equal(reg.actor_etiqueta, "Persona 9");
    assert.equal(reg.actor_user_id, a.userId);
    assert.equal(reg.entidad_tipo, "imagen");
    assert.deepEqual([reg.despues.mime_type, reg.despues.ancho, reg.despues.alto, reg.despues.nombre_original], ["image/webp", 320, 240, "portada.png"]);
  });
});

describe("AISLAMIENTO entre negocios", () => {
  it("otro negocio no puede confirmar, ver ni usar la imagen; y cada galería es la suya", async () => {
    const t1 = await negocio();
    const t2 = await negocio();
    const a1 = actor(t1, "admin", 1);
    const a2 = actor(t2, "admin", 2);
    const ticket = await subir(a1, await png(300, 200));
    await falla(servicio.confirmar(a2, ticket.id), "NOT_FOUND");
    assert.equal(almacen.objetos.has(ticket.path), true, "lo subido por A no se toca");
    await servicio.confirmar(a1, ticket.id);
    assert.deepEqual(await servicio.listar(a2), []);
    assert.equal((await servicio.listar(a1)).length, 1);
    await falla(servicio.confirmar(a2, "99999999-9999-4999-8999-999999999999"), "NOT_FOUND");
    assert.equal(await repo.obtenerAsset(t2, ticket.id), null);
  });

  it("todas las rutas que se emiten quedan bajo el negocio de la sesión", async () => {
    const t = await negocio();
    const a = actor(t);
    for (let i = 0; i < 5; i++) {
      const ticket = await servicio.solicitarSubida(a, { mimeType: "image/png", bytes: 1000 });
      assert.ok(ticket.path.startsWith(`${t}/cms/`));
      assert.equal(ticket.path.includes(".."), false);
    }
    const rutas = await base.sql<{ storage_path: string }>("select storage_path from public.dulabs_cms_assets where id_tenant = $1", [t]);
    assert.equal(rutas.length, 5);
    assert.ok(rutas.every((r) => r.storage_path.startsWith(`${t}/cms/`)));
  });

  it("una imagen confirmada llega a la lectura pública del negocio (y solo al suyo)", async () => {
    const t1 = await negocio();
    const t2 = await negocio();
    const a = actor(t1);
    const ticket = await subir(a, await png(300, 200));
    const lector = crearLector(repo);
    assert.equal((await lector.cargar(t1))?.assets.size, 0, "pendiente: no sale");
    await servicio.confirmar(a, ticket.id);
    assert.equal((await lector.cargar(t1))?.assets.get(ticket.id)?.ancho, 300);
    assert.equal((await lector.cargar(t2))?.assets.size, 0);
  });
});

describe("USO en el contenido y LÍMITES", () => {
  it("una oferta puede usar la imagen solo cuando está lista", async () => {
    const t = await negocio();
    const a = actor(t);
    const cms = crearServicioCms({
      repo,
      catalogo: {
        async productosPorReferencia() {
          return [{ referencia: "DL-000001", nombre: "Aretes", categoriaId: null, categoriaNombre: null, activo: true, agotado: false, precioDetal: 100000, precioMayor: 70000, miniatura: null }];
        },
        async buscarProductos() {
          return [];
        },
        async categoriasPorId() {
          return [];
        },
        async listarCategorias() {
          return [];
        },
      },
      variables: { async valores() { return { variables: {}, minimoMayorista: null }; } },
      reloj: () => Date.parse("2026-10-28T17:00:00Z"),
    });
    const ticket = await subir(a, await png(800, 400));
    const oferta = { nombre: "Con imagen", modalidad: "ambas", beneficio: { tipo: "porcentaje", valor: 10 }, alcance: { todos: false, referencias: ["DL-000001"], categorias: [] }, vigencia: { desde: "2026-10-25", hasta: "2026-10-31" }, prioridad: 1, imagen: { origen: "cms", asset: ticket.id, alt: "Oferta con imagen" } };
    const e = await cms.crear(a, { tipo: "oferta", borrador: oferta });
    const err = await falla(cms.publicar(a, e.id, { rev: e.rev }), "NOT_PUBLISHABLE");
    assert.ok(err.problemas?.some((p) => p.codigo === "imagen_pendiente"));
    await servicio.confirmar(a, ticket.id);
    assert.equal((await cms.publicar(a, e.id, { rev: e.rev })).version, 1);
  });

  it(`el tope es de ${LIMITE_IMAGENES} imágenes listas por negocio`, async () => {
    const t = await negocio();
    const a = actor(t);
    // Se insertan con rutas válidas (la restricción exige el prefijo {negocio}/cms/{id}/).
    await base.sql(
      `with nuevos as (select gen_random_uuid() as id from generate_series(1, $2::int))
       insert into public.dulabs_cms_assets (id, id_tenant, storage_path, mime_type, bytes, ancho, alto, estado)
       select id, $1::uuid, $1::text || '/cms/' || id::text || '/imagen.webp', 'image/webp', 1000, 100, 100, 'listo' from nuevos`,
      [t, LIMITE_IMAGENES],
    );
    await falla(servicio.solicitarSubida(a, { mimeType: "image/png", bytes: 1000 }), "VALIDATION_ERROR", new RegExp(`${LIMITE_IMAGENES} imágenes`));
    const otro = await negocio();
    assert.ok((await servicio.solicitarSubida(actor(otro), { mimeType: "image/png", bytes: 1000 })).id, "el tope es por negocio");
  });
});
