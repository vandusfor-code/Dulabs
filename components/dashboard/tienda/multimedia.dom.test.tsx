// Postgres embebido ANTES que jsdom (ver tienda.dom.test.tsx): este import debe ir primero.
import "@electric-sql/pglite";
import "@/lib/test-helpers/jsdom-setup";
/**
 * Administración de tienda — las FOTOS Y VIDEOS del inicio, de punta a punta: pantalla (jsdom + Testing Library) → revisión del video en el navegador → cliente → rutas reales
 * (/api/dashboard/tienda/*) → servicio de videos → SQL real (Postgres embebido) y Storage emulado. Se usan los videos REALES de la tienda de Delacour y MP4 sintéticos; el navegador
 * (abrir un <video>, tomar la imagen fija) se reemplaza por herramientas falsas porque jsdom no reproduce video.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import sharp from "sharp";
import { createCmsClient } from "@/lib/cms-comercial-client";
import { crearLector } from "@/lib/cms-comercial/lector";
import { aplicarCategorias, multimediaDesdeCms } from "@/lib/cms-comercial/multimedia-tienda";
import { crearRepositorioSupabaseCms } from "@/lib/cms-comercial/repositorio-supabase";
import { crearAlmacenMemoria, type AlmacenMemoria } from "@/lib/cms-comercial/testing/almacen-memoria";
import { crearFetchRutas } from "@/lib/cms-comercial/testing/fetch-rutas";
import { crearMp4 } from "@/lib/cms-comercial/testing/mp4";
import { crearBaseCms, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { instalarPuenteRpcCms, type PuenteRpc } from "@/lib/cms-comercial/testing/puente-rpc";
import type { HerramientasVideo, SondeoVideo } from "@/lib/cms-comercial/video-navegador";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { CatalogToastProvider } from "@/components/dashboard/catalogo/ui";
import { HerramientasVideoProvider } from "@/components/dashboard/tienda/herramientas-video";
import { TiendaApp } from "@/components/dashboard/tienda/TiendaApp";

configure({ asyncUtilTimeout: 8000 });

const TA = "aaaaaaaa-0000-4000-8000-00000000000a";
const CAT_A = "c0000000-0000-4000-8000-0000000000a1";
const CAT_A2 = "c0000000-0000-4000-8000-0000000000a2";
const ADMIN = "d0000000-0000-4000-8000-000000000001";
const CARPETA = path.join(process.cwd(), "public", "catalogo", "delacour", "video");
const real = (nombre: string) => new Uint8Array(readFileSync(path.join(CARPETA, nombre)));

let pg: BaseCms;
let db: SupabaseMemoria;
let puente: PuenteRpc;
let almacen: AlmacenMemoria;
let jpeg: Uint8Array;
let png: Uint8Array;

before(async () => {
  pg = await crearBaseCms();
  jpeg = new Uint8Array(await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 30, g: 120, b: 200 } } }).jpeg().toBuffer());
  png = new Uint8Array(await sharp({ create: { width: 900, height: 1100, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer());
});
after(async () => {
  await pg.cerrar();
});

beforeEach(async () => {
  await pg.aplicarSql("truncate public.dulabs_cms_auditoria, public.dulabs_cms_versiones, public.dulabs_cms_assets, public.dulabs_cms_entidades cascade");
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  almacen = crearAlmacenMemoria(process.env.SUPABASE_URL);
  puente = instalarPuenteRpcCms(pg, process.env.SUPABASE_URL as string, { almacen });
  db.table("dulabs_miembros_equipo").push(
    { id: 1, tenant_id: TA, user_id: ADMIN, rol: "admin", estado: "activo", email: "admin@a.test", nombre: "Ana Admin" },
    { id: 2, tenant_id: TA, user_id: "d0000000-0000-4000-8000-000000000002", rol: "agente", estado: "activo", email: "agente@a.test", nombre: "Bea Agente" },
  );
  db.user("t-admin-a", ADMIN);
  db.user("t-agente-a", "d0000000-0000-4000-8000-000000000002");
  await pg.habilitarModulo(TA);
  db.table("dulabs_tenant_modulos").push({ id_tenant: TA, modulo: "cms_comercial", habilitado: true });
  db.table("dulabs_catalogo_categorias").push({ id: CAT_A, id_tenant: TA, nombre: "Aretes" }, { id: CAT_A2, id_tenant: TA, nombre: "Dijes" });
  db.table("dulabs_agente_runtime_config").push({ id_tenant: TA, habilitado: true, created_at: "2026-09-01T00:00:00Z", negocio: { nombre_negocio: "Tienda A", pedido: { minimo_mayorista: 750000 } } });
});

afterEach(() => {
  cleanup();
  puente.restaurar();
  db.uninstall();
});

const publicar = (slug: string, nombre = "Delacour & Orus") => db.table("dulabs_catalogo_publicacion").push({ id_tenant: TA, slug, nombre_publico: nombre, publicado: true, token_mayor: "f".repeat(64) });

const IMAGEN_FIJA = () => new Blob([jpeg as BlobPart], { type: "image/jpeg" });
const BIEN = { reproducible: true, ancho: 1280, alto: 720, duracionSeg: 8 };

/** Un navegador de mentira: lee los bytes de verdad, y «abre» el video como se le diga (jsdom no reproduce video). */
function navegador(sondeo: (archivo: File) => Omit<SondeoVideo, "imagenFija"> & { imagenFija?: boolean } = () => ({ ...BIEN })): HerramientasVideo {
  return {
    leerBytes: async (b) => new Uint8Array(await b.arrayBuffer()),
    sondear: async (archivo) => {
      const s = sondeo(archivo);
      return { ...s, imagenFija: s.reproducible && s.imagenFija !== false ? IMAGEN_FIJA() : null };
    },
    urlTemporal: () => "blob:prueba",
    liberar: () => {},
  };
}

interface Opciones {
  token?: string;
  herramientas?: HerramientasVideo;
  /** Cómo llega el archivo a Storage (por defecto, tal cual; una prueba puede cambiarlo para simular un archivo distinto del revisado). */
  alSubir?: (bytes: Uint8Array, mime: string) => Uint8Array;
}
const preparadas: Array<number | undefined> = [];

function montar({ token = "t-admin-a", herramientas = navegador(), alSubir }: Opciones = {}) {
  preparadas.length = 0;
  const rutas = crearFetchRutas();
  const client = createCmsClient(token, {
    fetch: rutas.fetch,
    preparar: async (archivo, o) => (preparadas.push(o?.ladoMaximo), { blob: archivo, mimeType: archivo.type }),
    subir: async (ticket, blob, mime) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      almacen.subirComoNavegador(ticket.path, alSubir ? alSubir(bytes, mime) : bytes, mime);
      return { ok: true, data: null };
    },
  });
  const usuario = userEvent.setup();
  render(
    <CatalogToastProvider>
      <HerramientasVideoProvider herramientas={herramientas}>
        <TiendaApp client={client} canWrite={token === "t-admin-a"} />
      </HerramientasVideoProvider>
    </CatalogToastProvider>,
  );
  return { usuario, client, rutas };
}

const boton = (nombre: string | RegExp) => screen.getByRole("button", { name: nombre });
const entidades = (tipo: string) => pg.sql<{ clave: string; estado: string; borrador: Record<string, unknown> | null; rev: number }>("select clave, estado, borrador, rev from public.dulabs_cms_entidades where id_tenant = $1 and tipo = $2 order by clave", [TA, tipo]);
const archivosDe = (mime: string) => pg.sql<{ id: string; estado: string; ancho: number; alto: number; bytes: number }>("select id, estado, ancho, alto, bytes from public.dulabs_cms_assets where id_tenant = $1 and mime_type like $2 order by created_at", [TA, `${mime}%`]);
const publicado = async () => (await crearLector(crearRepositorioSupabaseCms(pg.supabase)).cargar(TA)) ?? null;
const slot = (id: string) => screen.getByTestId(`slot-${id}`);

async function abrirPestana(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(await screen.findByRole("tab", { name: "Fotos y videos" }));
  await usuario.click(await screen.findByRole("button", { name: "Personalizar las fotos y los videos" }));
  await screen.findByTestId("slot-portada.horizontal");
}

async function elegir(usuario: ReturnType<typeof userEvent.setup>, archivo: string, bytes: Uint8Array, nombre = "video.mp4", tipo = "video/mp4") {
  await usuario.upload(screen.getByTestId(`archivo-${archivo}`) as HTMLInputElement, new File([bytes as BlobPart], nombre, { type: tipo }));
}

describe("la pestaña «Fotos y videos»", () => {
  it("con la tienda de tema joyería se ofrece, justo después de «Página principal»", async () => {
    publicar("delacour");
    montar();
    await screen.findByRole("tab", { name: "Fotos y videos" });
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    assert.ok(tabs.includes("Fotos y videos"));
    assert.equal(tabs[tabs.indexOf("Página principal") + 1], "Fotos y videos");
  });

  it("con una tienda de otro tema, o sin tienda publicada, no se ofrece: un editor que no cambia nada confunde", async () => {
    publicar("tienda-a", "Tienda A");
    montar();
    await screen.findByRole("link", { name: /Ver mi tienda/ });
    assert.equal(screen.queryByRole("tab", { name: "Fotos y videos" }), null);
  });

  it("la primera vez explica qué se puede cambiar y crea el borrador (vacío: la tienda sigue igual) al personalizar", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await usuario.click(await screen.findByRole("tab", { name: "Fotos y videos" }));
    assert.ok(await screen.findByText("Todavía no cambiaste las fotos ni los videos"));
    assert.ok(screen.getByText(/antes de subir un video te decimos si sirve, con sus medidas y su peso/));
    await usuario.click(boton("Personalizar las fotos y los videos"));
    await screen.findByTestId("slot-portada.horizontal");
    const creado = await entidades("multimedia");
    assert.equal(creado.length, 1);
    assert.deepEqual([creado[0].clave, creado[0].estado, creado[0].borrador], ["multimedia", "borrador", {}]);
    // no se ofrece archivar: es uno solo por tienda
    assert.equal(screen.queryByRole("button", { name: "Archivar" }), null);
  });

  it("quien solo puede consultar no puede crearlo ni cambiar nada", async () => {
    publicar("delacour");
    const { usuario } = montar({ token: "t-agente-a" });
    await usuario.click(await screen.findByRole("tab", { name: "Fotos y videos" }));
    assert.ok(await screen.findByText("Cuando un administrador lo personalice, lo verás aquí."));
    assert.equal(screen.queryByRole("button", { name: "Personalizar las fotos y los videos" }), null);
  });
});

describe("el formulario muestra qué video sirve en cada espacio", () => {
  it("los cuatro espacios, con el video de siempre y las medidas, el peso y la duración de cada archivo", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    for (const [id, medidas, proporcion] of [
      ["portada.horizontal", "1280 × 720", "16:9"],
      ["portada.vertical", "720 × 1280", "9:16"],
      ["coleccion.horizontal", "1280 × 720", "16:9"],
      ["coleccion.vertical", "720 × 1280", "9:16"],
      ["marca.horizontal", "720 × 900", "4:5"],
      ["mayoristas.horizontal", "1280 × 576", "20:9"],
    ] as const) {
      const texto = screen.getByTestId(`medidas-${id}`).textContent ?? "";
      assert.ok(texto.includes(medidas) && texto.includes(proporcion) && texto.includes("3 MB") && texto.includes("4–15 s") && texto.includes("sin sonido"), `${id}: ${texto}`);
    }
    assert.ok(within(slot("portada.horizontal")).getByText("El video de siempre"));
    assert.ok(within(slot("marca.horizontal")).getByLabelText("El video de siempre").getAttribute("src")?.endsWith("/catalogo/delacour/video/marca.mp4"));
    assert.ok(within(slot("portada.vertical")).getByText(/Primero elige el video horizontal de este espacio/));
    assert.equal(screen.queryByTestId("archivo-portada.vertical"), null, "el vertical no se puede subir sin el horizontal");
  });

  it("la guía lista las seis medidas, los requisitos generales y el comando de ffmpeg de cada espacio", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    const guia = screen.getByTestId("guia-videos");
    for (const id of ["portada.horizontal", "portada.vertical", "coleccion.horizontal", "coleccion.vertical", "marca.horizontal", "mayoristas.horizontal"]) assert.ok(within(guia).getByTestId(`fila-${id}`), id);
    assert.ok(within(screen.getByTestId("fila-marca.horizontal")).getByText("720 × 900"));
    assert.ok(within(screen.getByTestId("fila-marca.horizontal")).getByText("576 × 720 — 1080 × 1350"));
    assert.ok(within(guia).getByText(/MP4 con video H\.264/));
    assert.ok(within(guia).getByText(/3 MB por archivo/));
    assert.ok(within(guia).getByText(/Sin sonido/));
    assert.ok(within(guia).getByText(/HandBrake/));
    assert.match(screen.getByTestId("comando-ffmpeg").textContent ?? "", /scale=1280:720.*libx264.*-an|-an.*scale=1280:720/);
    await usuario.selectOptions(within(guia).getByLabelText("Comando para preparar el video de:"), "marca.horizontal");
    assert.match(screen.getByTestId("comando-ffmpeg").textContent ?? "", /scale=720:900/);
  });
});

describe("elegir un video: se revisa antes de subir", () => {
  it("un video bueno: la lista sale toda en verde, se sube (imagen fija, video y verificación), queda elegido y se guarda en el borrador", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    const original = real("marca.mp4");
    await elegir(usuario, "marca.horizontal", original, "mi-marca.mp4");

    const revision = await within(slot("marca.horizontal")).findByTestId("revision-video");
    assert.ok(within(revision).getByText("«mi-marca.mp4» cumple todos los requisitos."));
    const filas = [...revision.querySelectorAll("li[data-id]")];
    assert.ok(filas.length >= 11, "una fila por regla");
    assert.ok(filas.every((f) => f.getAttribute("data-ok") === "true"), `todas cumplen: ${filas.filter((f) => f.getAttribute("data-ok") !== "true").map((f) => f.getAttribute("data-id"))}`);
    for (const regla of ["Pesa 3 MB o menos", "Proporción 4:5", "No tiene sonido", "Es un MP4 normal (no fragmentado)", "Se reproduce en tu navegador"]) assert.ok(within(revision).getByText(regla), regla);
    assert.equal(archivosDe("video/").constructor, Promise);
    assert.equal((await archivosDe("video/")).length, 0, "todavía no se subió nada");

    await usuario.click(within(slot("marca.horizontal")).getByRole("button", { name: "Usar este video" }));
    assert.ok(await within(slot("marca.horizontal")).findByText("Listo: este es tu video"));

    const videos = await archivosDe("video/");
    assert.equal(videos.length, 1);
    assert.deepEqual([videos[0].estado, videos[0].ancho, videos[0].alto, videos[0].bytes], ["listo", 720, 900, original.byteLength]);
    const imagenes = await archivosDe("image/");
    assert.equal(imagenes.length, 1, "la imagen fija del video");
    assert.equal(imagenes[0].estado, "listo");
    assert.deepEqual(preparadas, [1280], "la imagen fija se reduce a 1280 px");
    assert.deepEqual(almacen.objetos.get(`${TA}/cms/${videos[0].id}/video.mp4`)?.bytes, original, "el video quedó idéntico en su ruta final");

    // El espacio muestra «Tu video» y se puede guardar y publicar.
    assert.ok(within(slot("marca.horizontal")).getByText("Tu video"));
    await usuario.click(boton(/^Guardar/));
    await waitFor(async () => {
      const [fila] = await entidades("multimedia");
      assert.deepEqual(fila.borrador, { videos: { marca: { horizontal: { video: videos[0].id, poster: imagenes[0].id } } } });
    });
  });

  it("un video que no cumple: cada regla fallida sale en rojo con qué hacer, NO se puede usar y no se sube nada", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    const antes = puente.llamadas.length;
    await elegir(usuario, "portada.horizontal", crearMp4({ audio: true, duracionSeg: 30, ancho: 640, alto: 360, fps: 60 }), "pesado.mp4");
    const revision = await within(slot("portada.horizontal")).findByTestId("revision-video");
    assert.ok(within(revision).getByText("«pesado.mp4» no se puede usar: no cumple 4 requisitos."));
    const rojas = [...revision.querySelectorAll("li[data-id]")].filter((f) => f.getAttribute("data-ok") === "false").map((f) => f.getAttribute("data-id"));
    assert.deepEqual(rojas.sort(), ["duracion", "fotogramas", "medidas", "sonido"]);
    assert.ok(within(revision).getByText("Dura 30 s."));
    assert.ok(within(revision).getByText("Trae una pista de audio."));
    assert.ok(within(revision).getByText(/Quítale el sonido al exportar/));
    assert.ok(within(revision).getByText(/Recórtalo a unos 8 segundos/));
    assert.ok(within(revision).getByText(/Es demasiado pequeño y se vería borroso: usa al menos 960×540/));
    assert.ok(within(revision).getByText(/Exporta a 30 fotogramas por segundo/));
    assert.equal((within(slot("portada.horizontal")).getByRole("button", { name: "Usar este video" }) as HTMLButtonElement).disabled, true);
    assert.ok(within(slot("portada.horizontal")).getByText(/Arregla lo marcado en rojo y vuelve a elegir el video/));
    assert.equal((await archivosDe("video/")).length + (await archivosDe("image/")).length, 0);
    assert.equal(almacen.objetos.size, 0);
    assert.deepEqual(puente.llamadas.slice(antes).filter((l) => /asset_crear/.test(String(l))), []);
  });

  it("un video vertical en un espacio horizontal dice a qué espacio pertenece", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    await elegir(usuario, "portada.horizontal", real("portada-v.mp4"), "vertical.mp4");
    const revision = await within(slot("portada.horizontal")).findByTestId("revision-video");
    assert.ok(within(revision).getByText(/Este espacio es horizontal \(16:9\) y tu video es vertical\. Súbelo en «Portada · pantalla vertical \(celular\)»/));
  });

  it("un archivo que no es un video MP4 (un texto, un MOV de otra marca…) dice qué pasó", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    await elegir(usuario, "marca.horizontal", new TextEncoder().encode("esto no es un video ".repeat(40)), "notas.mp4");
    const revision = await within(slot("marca.horizontal")).findByTestId("revision-video");
    assert.ok(within(revision).getByText(/El archivo no es un video MP4/));
    assert.equal(revision.querySelectorAll("li[data-id]").length, 2, "solo el formato y el peso: lo demás no tiene sentido");
  });

  it("un video HEVC (el de un iPhone) dice cómo cambiarlo a H.264", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    await elegir(usuario, "portada.horizontal", crearMp4({ formato: "hvc1" }), "iphone.mp4");
    const revision = await within(slot("portada.horizontal")).findByTestId("revision-video");
    assert.ok(within(revision).getByText(/El video es H\.265 \(HEVC\)/));
    assert.ok(within(revision).getByText(/Ajustes › Cámara › Formatos › «Más compatible»/));
  });

  it("un archivo enorme ni se lee: solo se dice cuánto pesa y a cuánto hay que bajarlo", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    const grande = new File([new Uint8Array(10)], "4k.mp4", { type: "video/mp4" });
    Object.defineProperty(grande, "size", { value: 122 * 1024 * 1024 });
    await usuario.upload(screen.getByTestId("archivo-portada.horizontal") as HTMLInputElement, grande);
    const revision = await within(slot("portada.horizontal")).findByTestId("revision-video");
    assert.ok(within(revision).getByText("Pesa 122 MB."));
    assert.ok(within(revision).getByText(/Redúcelo a 3 MB o menos \(lo ideal: 2 MB\)/));
    assert.equal(revision.querySelectorAll("li[data-id]").length, 1);
  });

  it("si el navegador no abre el video, no se puede usar aunque el archivo esté bien", async () => {
    publicar("delacour");
    const { usuario } = montar({ herramientas: navegador(() => ({ reproducible: false, ancho: null, alto: null, duracionSeg: null })) });
    await abrirPestana(usuario);
    await elegir(usuario, "marca.horizontal", real("marca.mp4"));
    const revision = await within(slot("marca.horizontal")).findByTestId("revision-video");
    assert.ok(within(revision).getByText("Tu navegador no pudo abrirlo."));
    assert.equal((within(slot("marca.horizontal")).getByRole("button", { name: "Usar este video" }) as HTMLButtonElement).disabled, true);
  });

  it("si el servidor no acepta lo que subió (un archivo distinto del revisado), lo dice con las reglas, y el video no queda elegido", async () => {
    publicar("delacour");
    const { usuario } = montar({ alSubir: (_bytes, mime) => (mime === "video/mp4" ? crearMp4({ audio: true }) : _bytes) });
    await abrirPestana(usuario);
    await elegir(usuario, "portada.horizontal", real("portada-h.mp4"));
    await within(slot("portada.horizontal")).findByTestId("revision-video");
    await usuario.click(within(slot("portada.horizontal")).getByRole("button", { name: "Usar este video" }));
    const aviso = await within(slot("portada.horizontal")).findByText("El servidor no aceptó el video");
    assert.ok(aviso);
    assert.ok(within(slot("portada.horizontal")).getAllByText(/Quítale el sonido al exportar/).length >= 1);
    assert.equal((await archivosDe("video/")).filter((v) => v.estado === "listo").length, 0);
    assert.equal(within(slot("portada.horizontal")).queryByText("Tu video"), null);
    assert.ok(within(slot("portada.horizontal")).getByText("El video que elegiste"), "sigue viendo el archivo que eligió, para poder cambiarlo");
    const [fila] = await entidades("multimedia");
    assert.deepEqual(fila.borrador, {}, "el borrador no cambió");
  });

  it("elegir otro mientras se revisa o después de revisar descarta lo anterior", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    await elegir(usuario, "marca.horizontal", crearMp4({ audio: true, ancho: 720, alto: 900 }), "con-sonido.mp4");
    await within(slot("marca.horizontal")).findByText(/«con-sonido\.mp4» no se puede usar/);
    await usuario.click(within(slot("marca.horizontal")).getByRole("button", { name: "Elegir otro" }));
    assert.equal(within(slot("marca.horizontal")).queryByTestId("revision-video"), null);
    await elegir(usuario, "marca.horizontal", real("marca.mp4"), "bueno.mp4");
    assert.ok(await within(slot("marca.horizontal")).findByText("«bueno.mp4» cumple todos los requisitos."));
  });
});

describe("un espacio con dos videos (portada y colección)", () => {
  it("el vertical se habilita cuando ya hay horizontal; quitar el vertical deja el horizontal; volver al video de siempre quita todo el espacio", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    await elegir(usuario, "coleccion.horizontal", real("coleccion-h.mp4"));
    await usuario.click(await within(slot("coleccion.horizontal")).findByRole("button", { name: "Usar este video" }));
    await within(slot("coleccion.horizontal")).findByText("Listo: este es tu video");
    // ahora sí se puede subir el vertical
    await elegir(usuario, "coleccion.vertical", real("coleccion-v.mp4"));
    await usuario.click(await within(slot("coleccion.vertical")).findByRole("button", { name: "Usar este video" }));
    await within(slot("coleccion.vertical")).findByText("Listo: este es tu video");

    await usuario.click(boton(/^Guardar/));
    await waitFor(async () => {
      const b = (await entidades("multimedia"))[0].borrador as { videos?: { coleccion?: Record<string, unknown> } };
      assert.deepEqual(Object.keys(b.videos?.coleccion ?? {}).sort(), ["horizontal", "vertical"]);
    });

    await usuario.click(within(slot("coleccion.vertical")).getByRole("button", { name: "Quitar mi video" }));
    await usuario.click(boton(/^Guardar/));
    await waitFor(async () => {
      const b = (await entidades("multimedia"))[0].borrador as { videos?: { coleccion?: Record<string, unknown> } };
      assert.deepEqual(Object.keys(b.videos?.coleccion ?? {}), ["horizontal"]);
    });

    await usuario.click(boton("Volver al video de siempre"));
    await usuario.click(boton(/^Guardar/));
    await waitFor(async () => assert.deepEqual((await entidades("multimedia"))[0].borrador, {}));
    assert.ok(within(slot("coleccion.horizontal")).getByText("El video de siempre"));
  });
});

describe("publicar: la tienda recibe lo publicado, y la red de seguridad del servidor", () => {
  it("se publica; el historial dice «Subió un video»; y la tienda ve el video por su propia ruta con la medida real", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    await elegir(usuario, "mayoristas.horizontal", real("mayoristas.mp4"));
    await usuario.click(await within(slot("mayoristas.horizontal")).findByRole("button", { name: "Usar este video" }));
    await within(slot("mayoristas.horizontal")).findByText("Listo: este es tu video");

    await usuario.click(boton("Publicar"));
    const dialogo = await screen.findByRole("dialog", { name: /Publicar «Fotos y videos»/ });
    assert.ok(within(dialogo).getByText(/Video · Mayoristas · banda de fondo/), "dice qué cambia, sin códigos");
    assert.ok(within(dialogo).getByText("video nuevo"));
    await usuario.click(within(dialogo).getByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));

    const snap = await publicado();
    assert.ok(snap?.multimedia);
    const m = multimediaDesdeCms(snap, "delacour");
    assert.ok(m?.videos.mayoristas);
    assert.match(m.videos.mayoristas.horizontal.src, /^\/catalogo\/delacour\/vitrina\/[0-9a-f-]{36}\.mp4$/);
    assert.deepEqual([m.videos.mayoristas.horizontal.width, m.videos.mayoristas.horizontal.height], [1280, 576]);

    // el historial de toda la tienda (la pestaña de arriba, no la del propio editor)
    await usuario.click(screen.getAllByRole("tab", { name: "Historial" })[0]);
    const lista = await screen.findByTestId("lista-historial");
    assert.ok(within(lista).getByText(/Subió un video/));
    assert.ok(within(lista).getByText(/Publicó · v1/));
  });

  it("publicar con un video en el espacio equivocado (guardado a mano) se rechaza y el mensaje sale junto a ese video", async () => {
    publicar("delacour");
    const { usuario, client } = montar();
    await abrirPestana(usuario);
    // Se sube un video de la marca (720×900) y, por fuera de la pantalla, se lo asigna a la portada horizontal (16:9).
    await elegir(usuario, "marca.horizontal", real("marca.mp4"));
    await usuario.click(await within(slot("marca.horizontal")).findByRole("button", { name: "Usar este video" }));
    await within(slot("marca.horizontal")).findByText("Listo: este es tu video");
    const [video] = await archivosDe("video/");
    const [imagen] = await archivosDe("image/");
    const [fila] = await entidades("multimedia");
    const guardado = await client.guardarBorrador((await pg.sql<{ id: string }>("select id from public.dulabs_cms_entidades where id_tenant = $1 and tipo = 'multimedia'", [TA]))[0].id, { videos: { portada: { horizontal: { video: video.id, poster: imagen.id } } } }, fila.rev);
    assert.equal(guardado.ok, true);
    // La pantalla toma el borrador del servidor al recargar el elemento.
    cleanup();
    const otra = montar();
    await abrirPestana2(otra.usuario);
    await otra.usuario.click(boton("Revisar"));
    const aviso = await within(slot("portada.horizontal")).findByRole("alert");
    assert.match(aviso.textContent ?? "", /El video de «Portada · pantalla horizontal» no cumple/);
    assert.match(aviso.textContent ?? "", /Es de 720×900/);
    assert.equal((await publicado())?.multimedia ?? null, null, "no salió nada a la tienda");
  });
});

/** Abre la pestaña cuando el borrador ya existe (no hay que crearlo). */
async function abrirPestana2(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(await screen.findByRole("tab", { name: "Fotos y videos" }));
  await screen.findByTestId("slot-portada.horizontal");
}

describe("imágenes de las categorías", () => {
  it("cada categoría del catálogo se puede mostrar con su imagen; sin elegir, se explica que se usa la foto de un producto", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    assert.ok(screen.getByTestId(`categoria-${CAT_A}`));
    assert.ok(screen.getByTestId(`categoria-${CAT_A2}`));
    assert.equal(within(screen.getByTestId(`categoria-${CAT_A}`)).getByText("Aretes").tagName, "P");
    assert.equal(within(screen.getByTestId(`categoria-${CAT_A}`)).getAllByText(/Sin imagen elegida: se usa la foto de uno de sus productos/).length, 1);
    assert.match(screen.getByTestId("medidas-categoria").textContent ?? "", /960 × 1200 px.*4:5.*600 × 750 px/);
    assert.match(screen.getByTestId("consejo-categoria").textContent ?? "", /foto limpia, sin texto ni collage de varias fotos.*recorta a 4:5/);
    // La vista previa de cada categoría tiene la forma real de la tarjeta (4:5), no la apaisada de las demás imágenes.
    for (const id of [CAT_A, CAT_A2]) assert.ok(screen.getByTestId(`categoria-${id}`).querySelector('[class*="aspect-[4/5]"]'), `la vista previa de ${id} es 4:5`);
  });

  it("las demás imágenes del panel (portada, banner) siguen con su vista previa apaisada de siempre", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await usuario.click(await screen.findByRole("tab", { name: "Página principal" }));
    await usuario.click(await screen.findByRole("button", { name: "Crear la página principal" }));
    const portada = await screen.findByText("Imagen de la portada");
    const marco = portada.closest("div")?.querySelector("div.flex.shrink-0");
    assert.ok(marco, "el marco de la vista previa de la portada");
    assert.match(marco.className, /h-32 w-full sm:w-52/);
    assert.doesNotMatch(marco.className, /aspect-\[4\/5\]/);
  });

  it("subir la imagen de una categoría: se reduce a 1200 px, queda con su descripción lista, se guarda por categoría y la tienda la usa", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    const fila = screen.getByTestId(`categoria-${CAT_A}`);
    await usuario.upload(within(fila).getByTestId("archivo-imagen") as HTMLInputElement, new File([png as BlobPart], "aretes.png", { type: "image/png" }));
    const descripcion = (await within(fila).findByLabelText(/Descripción de la imagen/)) as HTMLInputElement;
    assert.equal(descripcion.value, "Imagen de la categoría Aretes");
    assert.deepEqual(preparadas, [1200], "las imágenes de categoría se reducen a 1200 px");

    await usuario.click(boton(/^Guardar/));
    let imagenId = "";
    await waitFor(async () => {
      const b = (await entidades("multimedia"))[0].borrador as { categorias?: Array<{ categoria_id: string; imagen: { origen: string; asset: string; alt: string } }> };
      assert.equal(b.categorias?.length, 1);
      assert.deepEqual([b.categorias?.[0].categoria_id, b.categorias?.[0].imagen.origen, b.categorias?.[0].imagen.alt], [CAT_A, "cms", "Imagen de la categoría Aretes"]);
      imagenId = b.categorias?.[0].imagen.asset ?? "";
    });

    await usuario.click(boton("Publicar"));
    await usuario.click(await screen.findByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));
    const snap = await publicado();
    assert.ok(snap);
    const m = multimediaDesdeCms(snap, "delacour");
    assert.equal(m?.categorias.get(CAT_A)?.src, `/catalogo/delacour/vitrina/${imagenId}.webp`);
    const portadas = aplicarCategorias([{ id: CAT_A, name: "Aretes", coverUrl: "/foto-producto.webp" } as never, { id: CAT_A2, name: "Dijes", coverUrl: null } as never], m);
    assert.deepEqual(portadas.map((c) => c.coverUrl), [`/catalogo/delacour/vitrina/${imagenId}.webp`, null]);
  });

  it("quitar la imagen de una categoría la devuelve a la foto de siempre; una categoría borrada del catálogo se puede quitar", async () => {
    publicar("delacour");
    const { usuario, client } = montar();
    await abrirPestana(usuario);
    const fila = screen.getByTestId(`categoria-${CAT_A}`);
    await usuario.upload(within(fila).getByTestId("archivo-imagen") as HTMLInputElement, new File([png as BlobPart], "aretes.png", { type: "image/png" }));
    await within(fila).findByLabelText(/Descripción de la imagen/);
    await usuario.click(within(fila).getByRole("button", { name: "Quitar" }));
    await usuario.click(boton(/^Guardar/).hasAttribute("disabled") ? boton(/^Guardar/) : boton(/^Guardar/));
    await waitFor(async () => assert.deepEqual((await entidades("multimedia"))[0].borrador, {}));

    // Una categoría que ya no existe en el catálogo, con imagen, aparece para poder quitarla.
    const [e] = await entidades("multimedia");
    const id = (await pg.sql<{ id: string }>("select id from public.dulabs_cms_entidades where tipo = 'multimedia'"))[0].id;
    const huérfana = "c0000000-0000-4000-8000-0000000000ff";
    const [imagen] = await archivosDe("image/");
    const r = await client.guardarBorrador(id, { categorias: [{ categoria_id: huérfana, imagen: { origen: "cms", asset: imagen.id, alt: "Imagen vieja" } }] }, e.rev);
    assert.equal(r.ok, true);
    cleanup();
    const otra = montar();
    await abrirPestana2(otra.usuario);
    assert.ok(await screen.findByTestId("categoria-eliminada"));
    await otra.usuario.click(within(screen.getByTestId("categoria-eliminada")).getByRole("button", { name: "Quitar" }));
    await otra.usuario.click(boton(/^Guardar/));
    await waitFor(async () => assert.deepEqual((await entidades("multimedia"))[0].borrador, {}));
  });
});

describe("destacados y vista previa", () => {
  it("avisa dónde se eligen los productos y categorías destacados, y la vista previa resume lo elegido", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPestana(usuario);
    assert.match(screen.getByTestId("aviso-destacados").textContent ?? "", /productos destacados.*pestaña «Página principal»/);
    const previa = screen.getByTestId("previa");
    for (const e of ["portada", "coleccion", "marca", "mayoristas"]) assert.ok(within(previa).getByTestId(`previa-${e}`), e);
    assert.equal(within(previa).getAllByText("El video de siempre").length, 4);
    assert.match(screen.getByTestId("previa-categorias").textContent ?? "", /Categorías con imagen propia: 0 de 2/);

    await elegir(usuario, "marca.horizontal", real("marca.mp4"));
    await usuario.click(await within(slot("marca.horizontal")).findByRole("button", { name: "Usar este video" }));
    await within(slot("marca.horizontal")).findByText("Listo: este es tu video");
    assert.ok(within(screen.getByTestId("previa-marca")).getByText("Tu video"));
    assert.equal(within(screen.getByTestId("previa")).getAllByText("El video de siempre").length, 3);
  });
});
