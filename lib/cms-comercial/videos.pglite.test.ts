/**
 * CMS comercial — SERVICIO DE VIDEOS sobre la base SQL real (Postgres embebido), con un almacén en memoria y los videos REALES de la tienda de Delacour: permisos, el flujo completo de
 * subida (pedir → subir → confirmar), la verificación del servidor regla por regla, el índice de reproducción que se mueve al principio, rutas siempre bajo el negocio, aislamiento,
 * idempotencia, reintentos y límites. Las imágenes y los videos conviven en la misma tabla: cada servicio solo ve y confirma lo suyo.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
import type { Rol } from "@/lib/team";
import type { ActorCms } from "@/lib/cms-comercial/contrato";
import { isCmsError } from "@/lib/cms-comercial/errores";
import { LIMITE_IMAGENES, crearServicioImagenes } from "@/lib/cms-comercial/imagenes";
import { crearRepositorioSupabaseCms } from "@/lib/cms-comercial/repositorio-supabase";
import { crearAlmacenMemoria, type AlmacenMemoria } from "@/lib/cms-comercial/testing/almacen-memoria";
import { crearMp4, moverIndiceAlFinal } from "@/lib/cms-comercial/testing/mp4";
import { crearBaseCms, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { analizarMp4, optimizarParaWeb as optimizarParaWebReal } from "@/lib/cms-comercial/video-mp4";
import { MAX_BYTES_VIDEO } from "@/lib/cms-comercial/video-requisitos";
import { LIMITE_VIDEOS, crearServicioVideos, rutasDeVideo } from "@/lib/cms-comercial/videos";

const CARPETA = path.join(process.cwd(), "public", "catalogo", "delacour", "video");
const real = (nombre: string) => new Uint8Array(readFileSync(path.join(CARPETA, nombre)));

let base: BaseCms;
let almacen: AlmacenMemoria;
let repo: ReturnType<typeof crearRepositorioSupabaseCms>;
let servicio: ReturnType<typeof crearServicioVideos>;
let imagenes: ReturnType<typeof crearServicioImagenes>;
let serie = 0;

before(async () => {
  base = await crearBaseCms();
  repo = crearRepositorioSupabaseCms(base.supabase);
  almacen = crearAlmacenMemoria();
  servicio = crearServicioVideos({ repo, almacen });
  imagenes = crearServicioImagenes({ repo, almacen });
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
async function subir(a: ActorCms, bytes: Uint8Array, nombre = "video.mp4") {
  const ticket = await servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes: bytes.byteLength, nombreOriginal: nombre });
  almacen.subirComoNavegador(ticket.path, bytes, "video/mp4");
  return ticket;
}
const estadoDe = async (id: string) => (await base.sql<{ estado: string; bytes: number; ancho: number; alto: number }>("select estado, bytes, ancho, alto from public.dulabs_cms_assets where id = $1", [id]))[0];

describe("PERMISOS: solo el administrador sube; todos consultan", () => {
  it("agente y lectura no pueden pedir una subida ni confirmar, y no se toca ni la base ni el almacén", async () => {
    const t = await negocio();
    const admin = actor(t);
    const ticket = await subir(admin, real("portada-h.mp4"));
    const llamadas = almacen.llamadas.length;
    const filas = (await base.sql("select 1 from public.dulabs_cms_assets where id_tenant = $1", [t])).length;
    for (const rol of ["agente", "lectura"] as Rol[]) {
      const a = actor(t, rol, 2);
      await falla(servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes: 1000 }), "FORBIDDEN");
      await falla(servicio.confirmar(a, ticket.id, { archivo: "portada.horizontal" }), "FORBIDDEN");
    }
    assert.equal(almacen.llamadas.length, llamadas);
    assert.equal((await base.sql("select 1 from public.dulabs_cms_assets where id_tenant = $1", [t])).length, filas);
  });

  it("los tres roles pueden ver la lista de videos", async () => {
    const t = await negocio();
    const admin = actor(t);
    const ticket = await subir(admin, real("marca.mp4"));
    await servicio.confirmar(admin, ticket.id, { archivo: "marca.horizontal" });
    for (const rol of ["admin", "agente", "lectura"] as Rol[]) assert.equal((await servicio.listar(actor(t, rol, 3))).length, 1, rol);
  });
});

describe("PEDIR la subida: el servidor decide todo", () => {
  it("solo video MP4 de hasta 3 MB, con tamaño entero y positivo", async () => {
    const a = actor(await negocio());
    for (const mimeType of ["video/quicktime", "video/webm", "image/png", "application/pdf", "", "video/mp4; codecs=avc1", "VIDEO/MP4"]) await falla(servicio.solicitarSubida(a, { mimeType, bytes: 1000 }), "VALIDATION_ERROR", /video MP4/);
    for (const bytes of [0, -5, 1.5, Number.NaN]) await falla(servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes }), "VALIDATION_ERROR");
    const e = await falla(servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes: MAX_BYTES_VIDEO + 1 }), "VALIDATION_ERROR", /pesa un poco más de 3 MB y el máximo es 3 MB/);
    assert.match(e.message, /HandBrake/);
    await falla(servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes: 5 * 1024 * 1024 }), "VALIDATION_ERROR", /pesa 5 MB y el máximo es 3 MB/);
    assert.ok((await servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes: MAX_BYTES_VIDEO })).id, "justo 3 MB sí");
  });

  it("la ruta es SIEMPRE {negocio}/cms/{id}/… y la decide el servidor; el video queda pendiente y no sale en la lista", async () => {
    const t = await negocio();
    const a = actor(t);
    const ticket = await servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes: 5000, nombreOriginal: "../../etc/passwd" });
    const { final, temporal } = rutasDeVideo(t, ticket.id);
    assert.equal(final, `${t}/cms/${ticket.id}/video.mp4`);
    assert.equal(ticket.path, temporal);
    assert.ok(ticket.path.startsWith(`${t}/cms/${ticket.id}/`));
    assert.equal(ticket.bucket, "inventario-productos");
    assert.equal(ticket.maxBytes, MAX_BYTES_VIDEO);
    assert.ok(ticket.token.length > 0);
    const [fila] = await base.sql<{ storage_path: string; estado: string; mime_type: string; nombre_original: string | null }>("select storage_path, estado, mime_type, nombre_original from public.dulabs_cms_assets where id = $1", [ticket.id]);
    assert.deepEqual([fila.storage_path, fila.estado, fila.mime_type], [final, "pendiente", "video/mp4"]);
    assert.equal(fila.nombre_original, "passwd", "del nombre solo queda el archivo, sin rutas");
    assert.deepEqual(await servicio.listar(a), []);
  });

  it("el tope de videos por negocio cuenta solo videos (las imágenes no lo gastan) y no afecta a otros negocios", async () => {
    const t = await negocio();
    const otro = await negocio();
    const a = actor(t);
    await base.sql(
      `insert into public.dulabs_cms_assets (id, id_tenant, storage_path, mime_type, bytes, ancho, alto, estado)
       select ('f' || lpad(g::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid, $1::uuid, $1 || '/cms/f' || lpad(g::text, 7, '0') || '-0000-4000-8000-000000000000/video.mp4', 'video/mp4', 1000, 1280, 720, 'listo' from generate_series(1, $2::int) g`,
      [t, LIMITE_VIDEOS - 1],
    );
    await base.sql(
      `insert into public.dulabs_cms_assets (id, id_tenant, storage_path, mime_type, bytes, ancho, alto, estado)
       select ('e' || lpad(g::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid, $1::uuid, $1 || '/cms/e' || lpad(g::text, 7, '0') || '-0000-4000-8000-000000000000/imagen.webp', 'image/webp', 1000, 800, 800, 'listo' from generate_series(1, 20) g`,
      [t],
    );
    assert.ok((await servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes: 1000 })).id, "con 119 videos y 20 imágenes aún cabe uno");
    await base.sql(
      `insert into public.dulabs_cms_assets (id, id_tenant, storage_path, mime_type, bytes, ancho, alto, estado) values ('abcdef01-0000-4000-8000-000000000000', $1::uuid, $1 || '/cms/abcdef01-0000-4000-8000-000000000000/video.mp4', 'video/mp4', 1000, 1280, 720, 'listo')`,
      [t],
    );
    await falla(servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes: 1000 }), "VALIDATION_ERROR", new RegExp(`máximo de ${LIMITE_VIDEOS} videos`));
    assert.ok((await servicio.solicitarSubida(actor(otro), { mimeType: "video/mp4", bytes: 1000 })).id, "otro negocio no se ve afectado");
    // y las imágenes tampoco cuentan los videos
    assert.ok((await imagenes.solicitarSubida(a, { mimeType: "image/png", bytes: 1000 })).id);
  });
});

describe("CONFIRMAR: el servidor analiza lo subido y solo deja pasar lo que sirve", () => {
  it("flujo completo con un video REAL de la tienda: queda en su ruta final, el temporal se borra, las medidas son las reales y el video queda listo", async () => {
    const t = await negocio();
    const a = actor(t);
    const bytes = real("portada-h.mp4");
    const ticket = await subir(a, bytes);
    const r = await servicio.confirmar(a, ticket.id, { archivo: "portada.horizontal" });
    const { final, temporal } = rutasDeVideo(t, ticket.id);
    assert.equal(r.video.id, ticket.id);
    assert.deepEqual([r.video.ancho, r.video.alto, r.video.bytes], [1280, 720, bytes.byteLength]);
    assert.equal(r.video.url, almacen.urlPublica(final));
    assert.ok(r.duracionSeg !== null && r.duracionSeg >= 4 && r.duracionSeg <= 15);
    assert.deepEqual(r.seCorrigio, []);
    assert.ok(Array.isArray(r.recomendaciones));
    const guardado = almacen.objetos.get(final);
    assert.ok(guardado);
    assert.equal(guardado.contentType, "video/mp4");
    assert.deepEqual(guardado.bytes, bytes, "un video con el índice al principio se guarda byte por byte igual");
    assert.equal(almacen.objetos.has(temporal), false, "el temporal se borró");
    assert.deepEqual(await estadoDe(ticket.id), { estado: "listo", bytes: bytes.byteLength, ancho: 1280, alto: 720 });
    assert.deepEqual((await servicio.listar(a)).map((v) => v.id), [ticket.id]);
  });

  it("cada video real sirve en su espacio (las seis combinaciones de la tienda)", async () => {
    const a = actor(await negocio());
    for (const [nombre, archivo, medidas] of [
      ["portada-h.mp4", "portada.horizontal", [1280, 720]],
      ["portada-v.mp4", "portada.vertical", [720, 1280]],
      ["coleccion-h.mp4", "coleccion.horizontal", [1280, 720]],
      ["coleccion-v.mp4", "coleccion.vertical", [720, 1280]],
      ["marca.mp4", "marca.horizontal", [720, 900]],
      ["mayoristas.mp4", "mayoristas.horizontal", [1280, 576]],
    ] as const) {
      const ticket = await subir(a, real(nombre), nombre);
      const r = await servicio.confirmar(a, ticket.id, { archivo });
      assert.deepEqual([r.video.ancho, r.video.alto], medidas, nombre);
    }
  });

  it("con el índice de reproducción al final lo mueve al principio: mismo peso, mismas medidas, mismos datos, y lo avisa", async () => {
    const a = actor(await negocio());
    const alFinal = moverIndiceAlFinal(real("coleccion-h.mp4"));
    assert.equal(analizarMp4(alFinal).indiceAlPrincipio, false);
    const ticket = await subir(a, alFinal);
    const r = await servicio.confirmar(a, ticket.id, { archivo: "coleccion.horizontal" });
    assert.equal(r.seCorrigio.length, 1);
    assert.match(r.seCorrigio[0], /al principio/);
    const guardado = almacen.objetos.get(rutasDeVideo(a.tenantId, ticket.id).final)?.bytes;
    assert.ok(guardado);
    assert.equal(guardado.byteLength, alFinal.byteLength);
    const nuevo = analizarMp4(guardado);
    assert.equal(nuevo.indiceAlPrincipio, true);
    assert.deepEqual(guardado, real("coleccion-h.mp4"), "queda EXACTAMENTE el video original");
    assert.deepEqual([r.video.ancho, r.video.alto, r.video.bytes], [1280, 720, alFinal.byteLength]);
  });

  it("cada forma de que un video no sirva se rechaza con la regla que falla, se borra lo subido y el video sigue pendiente", async () => {
    const a = actor(await negocio());
    const casos: Array<[string, Uint8Array, RegExp, string]> = [
      ["con sonido", crearMp4({ audio: true }), /Quítale el sonido/, "sonido"],
      ["H.265 (HEVC)", crearMp4({ formato: "hvc1" }), /H\.265/, "codec"],
      ["High 10 bits", crearMp4({ perfilAvc: 110 }), /Perfil High 10/, "perfil"],
      ["de 60 fotogramas", crearMp4({ fps: 60 }), /60 fotogramas/, "fotogramas"],
      ["de 30 segundos", crearMp4({ duracionSeg: 30 }), /Dura 30 s/, "duracion"],
      ["de 2 segundos", crearMp4({ duracionSeg: 2 }), /Dura 2 s/, "duracion"],
      ["vertical en un espacio horizontal", crearMp4({ ancho: 720, alto: 1280 }), /vertical/, "proporcion"],
      ["demasiado grande (4K)", crearMp4({ ancho: 3840, alto: 2160 }), /demasiado grande/, "medidas"],
      ["demasiado pequeño", crearMp4({ ancho: 640, alto: 360 }), /demasiado pequeño/, "medidas"],
      ["fragmentado", crearMp4({ fragmentado: true }), /fragmentos/, "estructura"],
      ["que no es un video", new TextEncoder().encode("esto no es un video, es un texto muy largo ".repeat(40)), /no es un video MP4/, "formato"],
      ["cortado a la mitad", crearMp4({ cortarEn: 300 }), /incompleto|dañado|información del video/, "formato"],
    ];
    for (const [nombre, bytes, mensaje, codigo] of casos) {
      const ticket = await subir(a, bytes, `${nombre}.mp4`);
      const err = await falla(servicio.confirmar(a, ticket.id, { archivo: "portada.horizontal" }), "VALIDATION_ERROR", /Este video no se puede usar/);
      assert.match(err.message, mensaje, nombre);
      assert.ok(isCmsError(err) && err.problemas && err.problemas.length >= 1, `${nombre}: trae los problemas`);
      assert.ok(err.problemas.some((p) => p.codigo === codigo), `${nombre}: ${JSON.stringify(err.problemas.map((p) => p.codigo))}`);
      assert.ok(err.problemas.every((p) => p.severidad === "error" && p.campo === "portada.horizontal" && p.mensaje.length > 10));
      const { final, temporal } = rutasDeVideo(a.tenantId, ticket.id);
      assert.equal(almacen.objetos.has(temporal), false, `${nombre}: se borró lo subido`);
      assert.equal(almacen.objetos.has(final), false, `${nombre}: no se guardó nada`);
      assert.equal((await estadoDe(ticket.id)).estado, "pendiente", nombre);
    }
    assert.deepEqual(await servicio.listar(a), [], "nada de eso llegó a la lista");
  });

  it("las medidas se exigen según el espacio: el video de la portada no sirve para la tarjeta de la marca y el mensaje dice dónde va", async () => {
    const a = actor(await negocio());
    const ticket = await subir(a, real("portada-v.mp4"));
    const err = await falla(servicio.confirmar(a, ticket.id, { archivo: "portada.horizontal" }), "VALIDATION_ERROR");
    assert.match(err.message, /vertical/);
    assert.ok(isCmsError(err) && err.problemas?.some((p) => /Súbelo en «Portada · pantalla vertical \(celular\)»/.test(p.mensaje)));
    // El mismo archivo ya rechazado no se puede confirmar: hay que subirlo de nuevo, para el espacio correcto.
    const otro = await subir(a, real("portada-v.mp4"));
    assert.equal((await servicio.confirmar(a, otro.id, { archivo: "portada.vertical" })).video.alto, 1280);
  });

  it("una fila cuya ruta no es la que le toca (las rutas las decide el servidor) no se confirma ni toca el almacén", async () => {
    const t = await negocio();
    const id = randomUUID();
    await base.sql("select public.dulabs_cms_asset_crear($1, $2, $3, 'video/mp4', 1000, 16, 16, 'x.mp4', null)", [t, id, `${t}/cms/${id}/otro-nombre.mp4`]);
    almacen.subirComoNavegador(rutasDeVideo(t, id).temporal, real("marca.mp4"), "video/mp4");
    const antes = almacen.llamadas.length;
    await falla(servicio.confirmar(actor(t), id, { archivo: "marca.horizontal" }), "INTERNAL_ERROR", /No se pudo verificar el video/);
    assert.equal(almacen.llamadas.length, antes, "ni se leyó ni se escribió ni se borró nada");
    assert.equal((await estadoDe(id)).estado, "pendiente");
  });

  it("un espacio que no existe se rechaza antes de tocar nada", async () => {
    const a = actor(await negocio());
    const ticket = await subir(a, real("marca.mp4"));
    const llamadas = almacen.llamadas.length;
    await falla(servicio.confirmar(a, ticket.id, { archivo: "pie.horizontal" as never }), "VALIDATION_ERROR", /espacio del video/);
    await falla(servicio.confirmar(a, ticket.id, { archivo: "marca.vertical" as never }), "VALIDATION_ERROR", /espacio del video/);
    assert.equal(almacen.llamadas.length, llamadas);
  });

  it("si lo subido pesa más de 3 MB (el navegador no cumplió), se borra sin leerlo y se dice cuánto pesa", async () => {
    const a = actor(await negocio());
    const ticket = await servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes: 1000 });
    almacen.subirComoNavegador(ticket.path, new Uint8Array(MAX_BYTES_VIDEO + 500_000), "video/mp4");
    const antes = almacen.llamadas.length;
    await falla(servicio.confirmar(a, ticket.id, { archivo: "portada.horizontal" }), "VALIDATION_ERROR", /pesa 3,5 MB y el máximo es 3 MB/);
    assert.equal(almacen.objetos.has(ticket.path), false);
    assert.equal(almacen.llamadas.slice(antes).some((l) => l.startsWith("leer:")), false, "no se descargó");
    assert.equal((await estadoDe(ticket.id)).estado, "pendiente");
  });

  it("si no se subió nada, lo dice", async () => {
    const a = actor(await negocio());
    const ticket = await servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes: 1000 });
    await falla(servicio.confirmar(a, ticket.id, { archivo: "portada.horizontal" }), "VALIDATION_ERROR", /No encontramos el video subido/);
  });

  it("confirmar dos veces es idempotente: devuelve lo mismo sin volver a leer ni escribir", async () => {
    const a = actor(await negocio());
    const ticket = await subir(a, real("mayoristas.mp4"));
    const primero = await servicio.confirmar(a, ticket.id, { archivo: "mayoristas.horizontal" });
    const llamadas = almacen.llamadas.length;
    const segundo = await servicio.confirmar(a, ticket.id, { archivo: "mayoristas.horizontal" });
    assert.deepEqual(segundo.video, primero.video);
    assert.equal(segundo.duracionSeg, null);
    assert.equal(almacen.llamadas.length, llamadas);
  });

  it("un reintento después de que ya se escribió el video final (y se cayó antes de confirmar) lo vuelve a verificar y lo deja listo", async () => {
    const t = await negocio();
    const a = actor(t);
    const ticket = await servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes: 1000 });
    almacen.subirComoNavegador(rutasDeVideo(t, ticket.id).final, real("coleccion-h.mp4"), "video/mp4");
    const r = await servicio.confirmar(a, ticket.id, { archivo: "coleccion.horizontal" });
    assert.deepEqual([r.video.ancho, r.video.alto], [1280, 720]);
    assert.equal((await estadoDe(ticket.id)).estado, "listo");
    // y si lo que quedó escrito NO sirve, no se confirma
    const malo = await servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes: 1000 });
    almacen.subirComoNavegador(rutasDeVideo(t, malo.id).final, crearMp4({ audio: true }), "video/mp4");
    await falla(servicio.confirmar(a, malo.id, { archivo: "portada.horizontal" }), "VALIDATION_ERROR", /sonido/i);
    assert.equal((await estadoDe(malo.id)).estado, "pendiente");
  });

  it("AISLAMIENTO: otro negocio no puede confirmar ni ver un video ajeno, y la ruta nunca sale del propio negocio", async () => {
    const t1 = await negocio();
    const t2 = await negocio();
    const ticket = await subir(actor(t1), real("marca.mp4"));
    await falla(servicio.confirmar(actor(t2), ticket.id, { archivo: "marca.horizontal" }), "NOT_FOUND");
    assert.deepEqual(await servicio.listar(actor(t2)), []);
    assert.equal((await estadoDe(ticket.id)).estado, "pendiente", "no se tocó");
    await falla(servicio.confirmar(actor(t1), "00000000-0000-4000-8000-0000000000ff", { archivo: "marca.horizontal" }), "NOT_FOUND");
  });
});

describe("EL ÍNDICE AL PRINCIPIO: lo que devuelve el reordenamiento se comprueba antes de usarse", () => {
  /** Un video real con el índice al final (como lo dejan muchos celulares) y su versión ya reordenada de verdad. */
  const alFinal = moverIndiceAlFinal(real("coleccion-h.mp4"));
  const bien = real("coleccion-h.mp4");
  const buscar = (b: Uint8Array, caja: string) => {
    const texto = Buffer.from(b).toString("latin1");
    const i = texto.indexOf(caja);
    assert.ok(i >= 0, `el archivo no tiene «${caja}»`);
    return i + 4; // el contenido de la caja empieza justo después de su tipo
  };
  /** El mismo video reordenado, con un número de 32 bits cambiado en `donde` (de la misma longitud: solo cambia lo que dice de sí mismo). */
  const conNumero = (caja: string, desde: number, valor: number) => {
    const copia = bien.slice();
    new DataView(copia.buffer, copia.byteOffset, copia.byteLength).setUint32(buscar(copia, caja) + desde, valor);
    return copia;
  };

  async function confirmarCon(optimizar: (b: Uint8Array) => Uint8Array | null) {
    const t = await negocio();
    const a = actor(t);
    const conOptimizador = crearServicioVideos({ repo, almacen, optimizar });
    const ticket = await conOptimizador.solicitarSubida(a, { mimeType: "video/mp4", bytes: alFinal.byteLength });
    almacen.subirComoNavegador(ticket.path, alFinal, "video/mp4");
    const r = await conOptimizador.confirmar(a, ticket.id, { archivo: "coleccion.horizontal" });
    return { r, guardado: almacen.objetos.get(rutasDeVideo(t, ticket.id).final)?.bytes, id: ticket.id };
  }
  const original = () => alFinal;

  it("sanidad: con el reordenamiento de verdad se guarda el video reordenado y se avisa", async () => {
    const { r, guardado } = await confirmarCon((b) => optimizarParaWebReal(b));
    assert.equal(r.seCorrigio.length, 1);
    assert.deepEqual(guardado, bien);
  });

  it("si no se puede reordenar (null) o devuelve lo mismo, se guarda el original y el video queda listo igual", async () => {
    for (const optimizar of [() => null, (b: Uint8Array) => b]) {
      const { r, guardado, id } = await confirmarCon(optimizar);
      assert.deepEqual(r.seCorrigio, []);
      assert.deepEqual(guardado, original());
      assert.equal((await estadoDe(id)).estado, "listo");
    }
  });

  it("un resultado que no deja el índice al principio (una copia del original) se descarta", async () => {
    const { r, guardado } = await confirmarCon((b) => b.slice());
    assert.deepEqual(r.seCorrigio, []);
    assert.deepEqual(guardado, original());
  });

  it("un resultado de otro tamaño se descarta (aunque se vea bien)", async () => {
    const { r, guardado } = await confirmarCon((b) => {
      const movido = optimizarParaWebReal(b);
      return movido && Uint8Array.from([...movido, 0]);
    });
    assert.deepEqual(r.seCorrigio, []);
    assert.deepEqual(guardado, original());
  });

  it("un resultado que no se puede leer como MP4 se descarta", async () => {
    const { r, guardado } = await confirmarCon((b) => new Uint8Array(b.byteLength));
    assert.deepEqual(r.seCorrigio, []);
    assert.deepEqual(guardado, original());
  });

  it("un resultado sin la parte de datos (mdat) se descarta aunque conserve el largo, las medidas, la duración y el índice al principio", async () => {
    // Igual de largo y con las mismas medidas, pero la caja de datos ya no es de datos: el archivo no se puede reproducir.
    const sinDatos = bien.slice();
    sinDatos.set(Buffer.from("free", "latin1"), buscar(sinDatos, "mdat") - 4);
    const a = analizarMp4(sinDatos);
    assert.equal(a.legible, false, "el archivo falso no se puede leer");
    assert.equal(a.indiceAlPrincipio, true, "pero dice tener el índice al principio");
    assert.equal(a.video?.ancho, 1280);
    assert.equal(a.video?.alto, 720);
    assert.equal(sinDatos.byteLength, original().byteLength, "y pesa lo mismo que el original");
    const { r, guardado } = await confirmarCon(() => sinDatos);
    assert.deepEqual(r.seCorrigio, []);
    assert.deepEqual(guardado, original());
  });

  it("un resultado con otras medidas o con otra duración que el video original se descarta", async () => {
    // El ancho y el alto de la pista (16.16) y la duración del índice, cambiados sin tocar el largo del archivo.
    const otroAncho = conNumero("tkhd", 76, 640 * 0x10000);
    const otroAlto = conNumero("tkhd", 80, 360 * 0x10000);
    const otraDuracion = conNumero("mvhd", 16, 9_999_999);
    for (const [nombre, falso] of [
      ["ancho", otroAncho],
      ["alto", otroAlto],
      ["duración", otraDuracion],
    ] as const) {
      const a = analizarMp4(falso);
      assert.equal(a.legible, true, `${nombre}: el archivo falso se lee bien`);
      assert.equal(a.indiceAlPrincipio, true, `${nombre}: y tiene el índice al principio`);
      const { r, guardado } = await confirmarCon(() => falso);
      assert.deepEqual(r.seCorrigio, [], nombre);
      assert.deepEqual(guardado, original(), nombre);
    }
  });
});

describe("TOPES: las imágenes y los videos no se gastan el uno al otro", () => {
  it("los videos no gastan el tope de imágenes: con 299 imágenes y 5 videos todavía cabe una imagen más, y con 300 ya no", async () => {
    const t = await negocio();
    const a = actor(t);
    await base.sql(
      `insert into public.dulabs_cms_assets (id, id_tenant, storage_path, mime_type, bytes, ancho, alto, estado)
       select ('d' || lpad(g::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid, $1::uuid, $1 || '/cms/d' || lpad(g::text, 7, '0') || '-0000-4000-8000-000000000000/imagen.webp', 'image/webp', 1000, 800, 800, 'listo' from generate_series(1, $2::int) g`,
      [t, LIMITE_IMAGENES - 1],
    );
    await base.sql(
      `insert into public.dulabs_cms_assets (id, id_tenant, storage_path, mime_type, bytes, ancho, alto, estado)
       select ('c' || lpad(g::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid, $1::uuid, $1 || '/cms/c' || lpad(g::text, 7, '0') || '-0000-4000-8000-000000000000/video.mp4', 'video/mp4', 1000, 1280, 720, 'listo' from generate_series(1, 5) g`,
      [t],
    );
    assert.ok((await imagenes.solicitarSubida(a, { mimeType: "image/png", bytes: 1000 })).id, "299 imágenes y 5 videos: cabe una imagen más");
    await base.sql(
      `insert into public.dulabs_cms_assets (id, id_tenant, storage_path, mime_type, bytes, ancho, alto, estado) values ('d9999999-0000-4000-8000-000000000000', $1::uuid, $1 || '/cms/d9999999-0000-4000-8000-000000000000/imagen.webp', 'image/webp', 1000, 800, 800, 'listo')`,
      [t],
    );
    await falla(imagenes.solicitarSubida(a, { mimeType: "image/png", bytes: 1000 }), "VALIDATION_ERROR", new RegExp(`máximo de ${LIMITE_IMAGENES} imágenes`));
    assert.ok((await servicio.solicitarSubida(a, { mimeType: "video/mp4", bytes: 1000 })).id, "con el tope de imágenes lleno todavía se pueden subir videos");
  });
});

describe("IMÁGENES y VIDEOS conviven sin mezclarse", () => {
  it("la galería de imágenes no muestra videos y la lista de videos no muestra imágenes", async () => {
    const t = await negocio();
    const a = actor(t);
    const foto = await imagenes.solicitarSubida(a, { mimeType: "image/png", bytes: 1000, nombreOriginal: "foto.png" });
    almacen.subirComoNavegador(foto.path, await png(200, 100), "image/png");
    await imagenes.confirmar(a, foto.id);
    const v = await subir(a, real("marca.mp4"));
    await servicio.confirmar(a, v.id, { archivo: "marca.horizontal" });
    assert.deepEqual((await imagenes.listar(a)).map((i) => i.id), [foto.id]);
    assert.deepEqual((await servicio.listar(a)).map((i) => i.id), [v.id]);
  });

  it("un video no se puede confirmar por la ruta de las imágenes, ni una imagen por la de los videos", async () => {
    const t = await negocio();
    const a = actor(t);
    const v = await subir(a, real("marca.mp4"));
    const foto = await imagenes.solicitarSubida(a, { mimeType: "image/png", bytes: 1000 });
    almacen.subirComoNavegador(foto.path, await png(200, 100), "image/png");
    await falla(imagenes.confirmar(a, v.id), "NOT_FOUND", /esa imagen/);
    await falla(servicio.confirmar(a, foto.id, { archivo: "marca.horizontal" }), "NOT_FOUND", /ese video/);
    assert.equal((await estadoDe(v.id)).estado, "pendiente");
    assert.equal((await estadoDe(foto.id)).estado, "pendiente");
    // y cada uno se confirma por la suya
    assert.equal((await servicio.confirmar(a, v.id, { archivo: "marca.horizontal" })).video.id, v.id);
    assert.equal((await imagenes.confirmar(a, foto.id)).id, foto.id);
  });

  it("subir un video también queda en el historial del negocio como archivo subido", async () => {
    const t = await negocio();
    const a = actor(t);
    const v = await subir(a, real("mayoristas.mp4"));
    await servicio.confirmar(a, v.id, { archivo: "mayoristas.horizontal" });
    const [reg] = await base.sql<{ actor_etiqueta: string; entidad_tipo: string; accion: string; despues: { mime_type: string; ancho: number; alto: number } }>(
      "select actor_etiqueta, entidad_tipo, accion, despues from public.dulabs_cms_auditoria where id_tenant = $1 and entidad_id = $2",
      [t, v.id],
    );
    assert.deepEqual([reg.entidad_tipo, reg.accion, reg.actor_etiqueta], ["imagen", "subir_imagen", "Persona 1"]);
    assert.deepEqual([reg.despues.mime_type, reg.despues.ancho, reg.despues.alto], ["video/mp4", 1280, 576], "el registro dice que es un video");
  });
});
