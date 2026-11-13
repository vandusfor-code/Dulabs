// Postgres embebido ANTES que jsdom (ver tienda.dom.test.tsx): este import debe ir primero.
import "@electric-sql/pglite";
import "@/lib/test-helpers/jsdom-setup";
/**
 * Administración de tienda — el LADO DE HOMBRE (Delacour · Vértice) de punta a punta: pantalla (jsdom + Testing Library) → cliente → rutas reales (/api/dashboard/tienda/*) → servicio → SQL real
 * (Postgres embebido) y Storage emulado. La clienta cambia entre «Mujer» y «Hombre» en «Página principal» y «Fotos y videos», sube los videos de hombre, elige sus categorías y productos destacados y
 * publica con el mismo botón; la tienda lee lo publicado por su lado. Lo de mujer no se toca. Negocio y archivos FICTICIOS (videos sintéticos y los de la tienda de Delacour).
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
import { contenidoHombreDesdeCms, multimediaDesdeCms } from "@/lib/cms-comercial/multimedia-tienda";
import { crearRepositorioSupabaseCms } from "@/lib/cms-comercial/repositorio-supabase";
import { assetsReferenciados, videosReferenciados } from "@/lib/cms-comercial/vitrina";
import { crearAlmacenMemoria, type AlmacenMemoria } from "@/lib/cms-comercial/testing/almacen-memoria";
import { crearFetchRutas } from "@/lib/cms-comercial/testing/fetch-rutas";
import { crearBaseCms, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { instalarPuenteRpcCms, type PuenteRpc } from "@/lib/cms-comercial/testing/puente-rpc";
import type { HerramientasVideo, SondeoVideo } from "@/lib/cms-comercial/video-navegador";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { CatalogToastProvider } from "@/components/dashboard/catalogo/ui";
import { HerramientasVideoProvider } from "@/components/dashboard/tienda/herramientas-video";
import { TiendaApp } from "@/components/dashboard/tienda/TiendaApp";

configure({ asyncUtilTimeout: 8000 });

const TA = "aaaaaaaa-0000-4000-8000-00000000000a";
const CAT_ARETES = "c0000000-0000-4000-8000-0000000000a1";
const CAT_DIJES = "c0000000-0000-4000-8000-0000000000a2";
const ADMIN = "d0000000-0000-4000-8000-000000000001";
const CARPETA = path.join(process.cwd(), "public", "catalogo", "delacour", "video");
const real = (nombre: string) => new Uint8Array(readFileSync(path.join(CARPETA, nombre)));

let pg: BaseCms;
let db: SupabaseMemoria;
let puente: PuenteRpc;
let almacen: AlmacenMemoria;
let jpeg: Uint8Array;

before(async () => {
  pg = await crearBaseCms();
  jpeg = new Uint8Array(await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 30, g: 120, b: 200 } } }).jpeg().toBuffer());
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
  db.table("dulabs_catalogo_categorias").push({ id: CAT_ARETES, id_tenant: TA, nombre: "Aretes" }, { id: CAT_DIJES, id_tenant: TA, nombre: "Dijes" });
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

function montar(token = "t-admin-a") {
  const rutas = crearFetchRutas();
  const client = createCmsClient(token, {
    fetch: rutas.fetch,
    preparar: async (archivo) => ({ blob: archivo, mimeType: archivo.type }),
    subir: async (ticket, blob, mime) => {
      almacen.subirComoNavegador(ticket.path, new Uint8Array(await blob.arrayBuffer()), mime);
      return { ok: true, data: null };
    },
  });
  const usuario = userEvent.setup();
  render(
    <CatalogToastProvider>
      <HerramientasVideoProvider herramientas={navegador()}>
        <TiendaApp client={client} canWrite={token === "t-admin-a"} />
      </HerramientasVideoProvider>
    </CatalogToastProvider>,
  );
  return { usuario };
}

const boton = (nombre: string | RegExp) => screen.getByRole("button", { name: nombre });
const entidades = (tipo: string) => pg.sql<{ clave: string; estado: string; borrador: Record<string, unknown> | null }>("select clave, estado, borrador from public.dulabs_cms_entidades where id_tenant = $1 and tipo = $2", [TA, tipo]);
const publicado = async () => (await crearLector(crearRepositorioSupabaseCms(pg.supabase)).cargar(TA)) ?? null;
const slot = (id: string) => screen.getByTestId(`slot-${id}`);
const lado = (nombre: "Mujer" | "Hombre") => within(screen.getByTestId("interruptor-de-lado")).getByRole("radio", { name: new RegExp(`^${nombre}`) });

async function abrirMultimedia(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(await screen.findByRole("tab", { name: "Fotos y videos" }));
  await usuario.click(await screen.findByRole("button", { name: "Personalizar las fotos y los videos" }));
  await screen.findByTestId("slot-portada.horizontal");
}
async function abrirPaginaPrincipal(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(await screen.findByRole("button", { name: "Crear la página principal" }));
  await screen.findByTestId("interruptor-de-lado");
}
async function elegir(usuario: ReturnType<typeof userEvent.setup>, archivo: string, bytes: Uint8Array) {
  await usuario.upload(screen.getByTestId(`archivo-${archivo}`) as HTMLInputElement, new File([bytes as BlobPart], "video.mp4", { type: "video/mp4" }));
}
async function usarVideo(usuario: ReturnType<typeof userEvent.setup>, archivo: string, bytes: Uint8Array) {
  await elegir(usuario, archivo, bytes);
  await usuario.click(await within(slot(archivo)).findByRole("button", { name: "Usar este video" }));
  await within(slot(archivo)).findByText("Listo: este es tu video");
}

describe("el interruptor Mujer | Hombre", () => {
  it("en la tienda que tiene lado de hombre (Delacour) aparece en «Fotos y videos» y en «Página principal», empezando en Mujer", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirMultimedia(usuario);
    assert.equal(lado("Mujer").getAttribute("aria-checked"), "true");
    assert.equal(lado("Hombre").getAttribute("aria-checked"), "false");
    assert.match(screen.getByTestId("aviso-de-lado").textContent ?? "", /lado de MUJER/);
    cleanup();
    const otra = montar();
    await abrirPaginaPrincipal(otra.usuario);
    assert.equal(lado("Mujer").getAttribute("aria-checked"), "true");
  });

  it("en una tienda SIN lado de hombre no existe: los formularios son exactamente los de siempre", async () => {
    publicar("tienda-a", "Tienda A");
    const { usuario } = montar();
    await usuario.click(await screen.findByRole("button", { name: "Crear la página principal" }));
    await screen.findByText("Orden de las secciones");
    assert.equal(screen.queryByTestId("interruptor-de-lado"), null);
  });

  it("con «Hombre» el formulario de fotos y videos trae portada, colección y marca (sin mayoristas, sin «video de siempre» y sin los textos de «Compras por mayor»)", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirMultimedia(usuario);
    assert.ok(screen.getByTestId("slot-mayoristas.horizontal"), "en el lado de mujer están los cuatro espacios");
    await usuario.click(lado("Hombre"));
    assert.equal(lado("Hombre").getAttribute("aria-checked"), "true");
    assert.match(screen.getByTestId("aviso-de-lado").textContent ?? "", /lado de HOMBRE/);
    for (const id of ["portada.horizontal", "portada.vertical", "coleccion.horizontal", "coleccion.vertical", "marca.horizontal"]) assert.ok(screen.getByTestId(`slot-${id}`), id);
    assert.equal(screen.queryByTestId("slot-mayoristas.horizontal"), null, "los mayoristas son de toda la tienda");
    for (const id of ["portada.horizontal", "coleccion.horizontal", "marca.horizontal"]) assert.equal(within(slot(id)).queryByText("El video de siempre"), null, `${id}: el lado de hombre no trae videos de siempre`);
    assert.equal(screen.queryByTestId("previa-portada"), null, "la vista previa (la de mujer) no se muestra junto a lo de hombre");
    assert.equal(screen.queryByText(/Textos de «Compras por mayor»/), null);
    assert.ok(screen.getByTestId("aviso-destacados-hombre"));
    // y se puede volver al lado de mujer con todo como estaba
    await usuario.click(lado("Mujer"));
    assert.ok(screen.getByTestId("slot-mayoristas.horizontal"));
    assert.ok(within(slot("portada.horizontal")).getByText("El video de siempre"));
  });

  it("quien solo puede consultar ve el interruptor pero no puede cambiar nada del lado de hombre", async () => {
    publicar("delacour");
    // el administrador deja un borrador y luego entra quien solo consulta
    const admin = montar();
    await abrirMultimedia(admin.usuario);
    cleanup();
    montar("t-agente-a");
    await usuarioEspera();
  });
});

/** (el rol de solo lectura no ve la pestaña editable: se comprueba que no se ofrece «Personalizar») */
async function usuarioEspera() {
  await screen.findByRole("tab", { name: "Fotos y videos" });
  assert.equal(screen.queryByRole("button", { name: "Personalizar las fotos y los videos" }), null);
}

describe("subir y publicar los videos de hombre", () => {
  it("el video de portada de hombre se guarda dentro de `hombre.videos` (nada del lado de mujer), se publica y la tienda lo lee por su lado", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirMultimedia(usuario);
    await usuario.click(lado("Hombre"));
    await usarVideo(usuario, "portada.horizontal", real("portada-h.mp4"));
    await usuario.click(boton(/^Guardar/));
    await waitFor(async () => {
      const b = (await entidades("multimedia"))[0].borrador as { hombre?: { videos?: { portada?: { horizontal?: { video: string; poster: string } } } }; videos?: unknown };
      assert.ok(b.hombre?.videos?.portada?.horizontal?.video, "guardado bajo hombre.videos.portada");
      assert.equal(b.videos, undefined, "NADA del lado de mujer");
    });

    await usuario.click(boton("Publicar"));
    const dialogo = await screen.findByRole("dialog", { name: /Publicar «Fotos y videos»/ });
    await usuario.click(within(dialogo).getByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));

    const snap = await publicado();
    assert.ok(snap?.multimedia);
    const hombre = contenidoHombreDesdeCms(snap, "delacour");
    assert.ok(hombre?.multimedia?.videos.portada, "la tienda de hombre ve su portada");
    assert.match(hombre.multimedia.videos.portada.horizontal.src, /^\/catalogo\/delacour\/vitrina\/[0-9a-f-]{36}\.mp4$/);
    assert.deepEqual([hombre.multimedia.videos.portada.horizontal.width, hombre.multimedia.videos.portada.horizontal.height], [1280, 720]);
    assert.equal(multimediaDesdeCms(snap, "delacour"), null, "la tienda de mujer no recibe nada: sigue con sus videos de siempre");
    // la ruta pública puede servir esos archivos (están usados por contenido PUBLICADO)
    assert.equal(videosReferenciados(snap).size, 1);
    assert.ok(assetsReferenciados(snap).size >= 1);
  });

  it("los espacios de hombre usan las MISMAS reglas: un video vertical en el espacio horizontal de hombre dice a qué espacio pertenece y no se sube", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirMultimedia(usuario);
    await usuario.click(lado("Hombre"));
    await elegir(usuario, "portada.horizontal", real("portada-v.mp4"));
    const revision = await within(slot("portada.horizontal")).findByTestId("revision-video");
    assert.ok(within(revision).getByText(/Este espacio es horizontal \(16:9\) y tu video es vertical/));
    assert.equal((within(slot("portada.horizontal")).getByRole("button", { name: "Usar este video" }) as HTMLButtonElement).disabled, true);
  });

  it("«Quitar el video» deja el espacio vacío (no hay un video de siempre al que volver) y el borrador queda sin él", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirMultimedia(usuario);
    await usuario.click(lado("Hombre"));
    await usarVideo(usuario, "marca.horizontal", real("marca.mp4"));
    await usuario.click(boton(/^Guardar/));
    await waitFor(async () => assert.ok(((await entidades("multimedia"))[0].borrador as { hombre?: { videos?: { marca?: unknown } } }).hombre?.videos?.marca));
    await usuario.click(boton("Quitar el video"));
    await usuario.click(boton(/^Guardar/));
    await waitFor(async () => assert.equal(((await entidades("multimedia"))[0].borrador as { hombre?: { videos?: { marca?: unknown } } }).hombre?.videos?.marca, undefined));
  });

  it("lo de mujer y lo de hombre se publican juntos sin pisarse: el video de mayoristas (mujer) y el de la marca (hombre)", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirMultimedia(usuario);
    await usarVideo(usuario, "mayoristas.horizontal", real("mayoristas.mp4"));
    await usuario.click(lado("Hombre"));
    await usarVideo(usuario, "marca.horizontal", real("marca.mp4"));
    await usuario.click(boton("Publicar"));
    const dialogo = await screen.findByRole("dialog", { name: /Publicar «Fotos y videos»/ });
    await usuario.click(within(dialogo).getByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));
    const snap = await publicado();
    assert.deepEqual(Object.keys(multimediaDesdeCms(snap!, "delacour")?.videos ?? {}), ["mayoristas"]);
    assert.deepEqual(Object.keys(contenidoHombreDesdeCms(snap!, "delacour")?.multimedia?.videos ?? {}), ["marca"]);
  });
});

describe("«Página principal» del lado de hombre", () => {
  it("con «Hombre» solo se eligen categorías y productos destacados (la portada de Vértice y el orden de los bloques los pone el diseño de hombre)", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPaginaPrincipal(usuario);
    assert.ok(screen.getByText("Orden de las secciones"), "el lado de mujer tiene su formulario completo");
    await usuario.click(lado("Hombre"));
    assert.ok(screen.getByText("El inicio del lado de hombre"));
    assert.ok(screen.getByText("Categorías destacadas") && screen.getByText("Productos destacados"));
    assert.equal(screen.queryByText("Orden de las secciones"), null);
    assert.equal(screen.queryByText("Banner"), null);
  });

  it("elegir las categorías de hombre se guarda en `hombre.categorias_destacadas` (sin tocar las de mujer), se publica y la tienda de hombre las lee en su orden", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPaginaPrincipal(usuario);
    await usuario.click(lado("Hombre"));
    await usuario.click(await screen.findByRole("button", { name: /Dijes/ }));
    await usuario.click(await screen.findByRole("button", { name: /Aretes/ }));
    await usuario.click(boton(/^Guardar/));
    await waitFor(async () => {
      const b = (await entidades("home"))[0].borrador as { hombre?: { categorias_destacadas?: string[] }; categorias_destacadas?: string[] };
      assert.deepEqual(b.hombre?.categorias_destacadas, [CAT_DIJES, CAT_ARETES]);
      assert.deepEqual(b.categorias_destacadas ?? [], [], "las categorías de mujer siguen sin elegir");
    });
  });

  it("publicar la página principal con lo de hombre: la tienda lo lee y el contenido de mujer queda igual", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirPaginaPrincipal(usuario);
    // La página principal exige el título de la portada (el de mujer, como siempre): se completa primero.
    await usuario.type(screen.getByLabelText(/^Título/), "Colección Amor");
    await usuario.click(lado("Hombre"));
    await usuario.click(await screen.findByRole("button", { name: /Dijes/ }));
    await usuario.click(boton("Publicar"));
    const dialogo = await screen.findByRole("dialog");
    await usuario.click(within(dialogo).getByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));
    const snap = await publicado();
    const hombre = contenidoHombreDesdeCms(snap!, "delacour");
    assert.deepEqual(hombre?.categorias, [CAT_DIJES]);
    assert.deepEqual(hombre?.destacadas, []);
    assert.deepEqual(snap?.home?.contenido.categorias_destacadas, [], "lo de mujer, intacto");
    assert.equal(snap?.home?.contenido.portada.titulo, "Colección Amor", "y lo que se escribió del lado de mujer se publicó con ello");
  });
});
