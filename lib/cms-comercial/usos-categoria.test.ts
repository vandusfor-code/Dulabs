/**
 * CMS comercial — EN QUÉ PARTES de la tienda está elegida una categoría (lo que el administrador de categorías le muestra a la persona antes de eliminarla). Cada tipo de elemento que puede elegir una
 * categoría, lo publicado frente al borrador, lo que no cuenta (archivado, otra categoría) y que solo se devuelvan nombres, nunca contenido.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EntidadCms, EstadoEntidad, TipoEntidad } from "@/lib/cms-comercial/contrato";
import { LUGARES_CATEGORIA, lugarDeCampo, usosDeCategoria } from "@/lib/cms-comercial/usos-categoria";
import { CAT_ARETES, CAT_DIJES, TENANT_A, campana, home, multimedia, oferta, pie } from "@/lib/cms-comercial/testing/fixtures";

const OTRA = "c0000000-0000-4000-8000-0000000000ff";
const IMAGEN = "e0000000-0000-4000-8000-000000000021";

let serie = 0;
/** Un elemento del CMS como lo lista el editor. `activo` = lo publicado (null = nunca publicado o despublicado); `borrador` = cambios sin publicar (null = ninguno). */
function entidad(tipo: TipoEntidad, clave: string, partes: { activo?: Record<string, unknown> | null; borrador?: Record<string, unknown> | null; estado?: EstadoEntidad; archivada?: boolean } = {}): EntidadCms {
  serie += 1;
  const activo = partes.activo ?? null;
  return {
    id: `00000000-0000-4000-8000-${String(serie).padStart(12, "0")}`,
    tenantId: TENANT_A,
    tipo,
    clave,
    estado: partes.estado ?? (activo ? "publicada" : "borrador"),
    rev: 1,
    versionActiva: activo ? 1 : null,
    borrador: partes.borrador ?? null,
    contenidoActivo: activo,
    archivadaAt: partes.archivada ? "2026-10-20T12:00:00.000Z" : null,
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-02T12:00:00.000Z",
    publishedAt: activo ? "2026-10-02T12:00:00.000Z" : null,
  };
}

const destinoCategoria = (id: string) => ({ tipo: "categoria", categoria_id: id });
const imagenCategoria = { origen: "cms", asset: IMAGEN, alt: "Imagen de la categoría" };

describe("lugarDeCampo — de la ruta del campo a la parte de la tienda", () => {
  it("cada lugar donde el CMS puede guardar una categoría tiene su código; lo desconocido es «otro»", () => {
    assert.equal(lugarDeCampo("categorias_destacadas.0"), "destacadas");
    assert.equal(lugarDeCampo("categorias_destacadas.12"), "destacadas");
    assert.equal(lugarDeCampo("alcance.categorias.3"), "oferta");
    assert.equal(lugarDeCampo("portada.boton.destino.categoria_id"), "boton");
    assert.equal(lugarDeCampo("banner.destino.categoria_id"), "boton");
    assert.equal(lugarDeCampo("columnas.2.enlaces.0.destino.categoria_id"), "enlace_pie");
    assert.equal(lugarDeCampo("categorias.1.categoria_id"), "imagen_categoria");
    assert.equal(lugarDeCampo("algo.nuevo.que.no.existia"), "otro");
    for (const l of LUGARES_CATEGORIA) assert.equal(typeof l, "string");
  });
});

describe("usosDeCategoria — en qué elementos está elegida", () => {
  it("la página principal: categorías destacadas, y el botón de la portada o del banner", () => {
    const e = entidad("home", "home", { activo: home({ categorias_destacadas: [CAT_DIJES, CAT_ARETES] }) as never });
    const [uso, ...resto] = usosDeCategoria([e], CAT_ARETES);
    assert.equal(resto.length, 0);
    assert.deepEqual(uso, { tipo: "home", clave: "home", nombre: "Página principal", estado: "publicada", lugares: ["destacadas"], enPublicado: true, enBorrador: false, visibleHoy: true });

    const conBotones = entidad("home", "home", {
      activo: home({ portada: { visible: true, titulo: "Hola", imagen: { origen: "estatico", src: "/catalogo/prueba/p.png", ancho: 1600, alto: 900, alt: "Portada" }, boton: { texto: "Ver", destino: destinoCategoria(CAT_ARETES) } }, banner: { visible: true, destino: destinoCategoria(CAT_ARETES) } } as never) as never,
    });
    assert.deepEqual(usosDeCategoria([conBotones], CAT_ARETES)[0].lugares, ["boton"], "dos botones, un solo lugar «botón»");
  });

  it("una oferta: sus categorías; una campaña: el botón de su portada; las dos con el nombre que les puso la persona", () => {
    const o = entidad("oferta", "amor-y-amistad", { activo: oferta({ nombre: "Amor y Amistad", alcance: { todos: false, referencias: [], categorias: [CAT_ARETES] } }) as never });
    const c = entidad("campana", "dia-de-la-madre", { activo: campana({ nombre: "Día de la Madre", portada: { visible: true, boton: { texto: "Ver aretes", destino: destinoCategoria(CAT_ARETES) } } } as never) as never });
    const usos = usosDeCategoria([o, c], CAT_ARETES);
    assert.deepEqual(
      usos.map((u) => [u.tipo, u.nombre, u.lugares]),
      [["oferta", "Amor y Amistad", ["oferta"]], ["campana", "Día de la Madre", ["boton"]]],
    );
  });

  it("el pie de página (un enlace a la categoría) y las fotos y videos (la imagen de la categoría)", () => {
    const p = entidad("pie", "pie", { activo: pie({ columnas: [{ titulo: "Tienda", enlaces: [{ texto: "Aretes", destino: destinoCategoria(CAT_ARETES) }] }] } as never) as never });
    const m = entidad("multimedia", "multimedia", { activo: multimedia({ categorias: [{ categoria_id: CAT_ARETES, imagen: imagenCategoria }] } as never) as never });
    const usos = usosDeCategoria([p, m], CAT_ARETES);
    assert.deepEqual(
      usos.map((u) => [u.tipo, u.nombre, u.lugares]),
      [["pie", "Pie de página", ["enlace_pie"]], ["multimedia", "Fotos y videos", ["imagen_categoria"]]],
    );
  });

  it("la misma categoría en varios lugares del mismo elemento: un solo uso, con los lugares sin repetir y en orden fijo", () => {
    const e = entidad("home", "home", {
      activo: home({ categorias_destacadas: [CAT_ARETES], banner: { visible: true, destino: destinoCategoria(CAT_ARETES) } } as never) as never,
    });
    const usos = usosDeCategoria([e], CAT_ARETES);
    assert.equal(usos.length, 1);
    assert.deepEqual(usos[0].lugares, ["destacadas", "boton"]);
  });

  it("una categoría que nadie eligió no tiene usos; otra categoría tampoco cuenta", () => {
    const e = entidad("home", "home", { activo: home({ categorias_destacadas: [CAT_ARETES] }) as never });
    assert.deepEqual(usosDeCategoria([e], OTRA), []);
    assert.deepEqual(usosDeCategoria([e], CAT_DIJES), []);
    assert.deepEqual(usosDeCategoria([], CAT_ARETES), []);
  });
});

describe("usosDeCategoria — publicado, borrador y pausa", () => {
  it("solo en el borrador (un elemento que todavía no se publicó): no se ve hoy, pero ahí está", () => {
    const e = entidad("oferta", "nueva", { borrador: oferta({ nombre: "Nueva", alcance: { todos: false, referencias: [], categorias: [CAT_ARETES] } }) as never });
    const [u] = usosDeCategoria([e], CAT_ARETES);
    assert.deepEqual([u.enPublicado, u.enBorrador, u.visibleHoy, u.estado, u.nombre], [false, true, false, "borrador", "Nueva"]);
    assert.deepEqual(u.lugares, ["oferta"], "los lugares también salen del borrador: de lo contrario un elemento sin publicar diría «en ninguna parte»");
  });

  it("los lugares juntan lo publicado y lo del borrador: dónde está hoy y dónde estaría al publicar", () => {
    const e = entidad("home", "home", {
      activo: home({ categorias_destacadas: [CAT_ARETES] }) as never,
      borrador: home({ categorias_destacadas: [CAT_DIJES], banner: { visible: true, destino: destinoCategoria(CAT_ARETES) } } as never) as never,
    });
    const [u] = usosDeCategoria([e], CAT_ARETES);
    assert.deepEqual(u.lugares, ["destacadas", "boton"], "destacadas (lo publicado) y el botón del banner (el borrador)");
    assert.deepEqual([u.enPublicado, u.enBorrador, u.visibleHoy], [true, true, true]);
  });

  it("publicada y también en el borrador (cambios sin publicar que la mantienen): las dos cosas", () => {
    const contenido = home({ categorias_destacadas: [CAT_ARETES] }) as never;
    const e = entidad("home", "home", { activo: contenido, borrador: home({ categorias_destacadas: [CAT_ARETES, CAT_DIJES] }) as never });
    const [u] = usosDeCategoria([e], CAT_ARETES);
    assert.deepEqual([u.enPublicado, u.enBorrador, u.visibleHoy], [true, true, true]);
  });

  it("publicada, pero el borrador ya la quitó: la tienda la muestra hoy y el próximo publicado ya no la traerá", () => {
    const e = entidad("home", "home", { activo: home({ categorias_destacadas: [CAT_ARETES] }) as never, borrador: home({ categorias_destacadas: [CAT_DIJES] }) as never });
    const [u] = usosDeCategoria([e], CAT_ARETES);
    assert.deepEqual([u.enPublicado, u.enBorrador, u.visibleHoy], [true, false, true]);
  });

  it("el borrador la agrega y lo publicado no la tiene: solo en borrador", () => {
    const e = entidad("home", "home", { activo: home({ categorias_destacadas: [CAT_DIJES] }) as never, borrador: home({ categorias_destacadas: [CAT_DIJES, CAT_ARETES] }) as never });
    const [u] = usosDeCategoria([e], CAT_ARETES);
    assert.deepEqual([u.enPublicado, u.enBorrador, u.visibleHoy], [false, true, false]);
    assert.deepEqual(u.lugares, ["destacadas"], "lo que solo está en el borrador también dice dónde");
  });

  it("un elemento en pausa tiene la versión publicada pero la tienda NO lo muestra hoy", () => {
    const e = entidad("oferta", "pausada", { activo: oferta({ alcance: { todos: false, referencias: [], categorias: [CAT_ARETES] } }) as never, estado: "pausada" });
    const [u] = usosDeCategoria([e], CAT_ARETES);
    assert.deepEqual([u.estado, u.enPublicado, u.visibleHoy], ["pausada", true, false]);
  });

  it("los elementos archivados no cuentan: no se ven ni se publican", () => {
    const e = entidad("oferta", "vieja", { activo: oferta({ alcance: { todos: false, referencias: [], categorias: [CAT_ARETES] } }) as never, archivada: true });
    assert.deepEqual(usosDeCategoria([e], CAT_ARETES), []);
  });
});

describe("usosDeCategoria — orden y lo que se devuelve", () => {
  it("primero lo que la tienda muestra hoy; luego por tipo (en el orden del CMS) y por nombre", () => {
    const enBorrador = entidad("home", "home", { borrador: home({ categorias_destacadas: [CAT_ARETES] }) as never });
    const ofertaB = entidad("oferta", "b", { activo: oferta({ nombre: "Beta", alcance: { todos: false, referencias: [], categorias: [CAT_ARETES] } }) as never });
    const ofertaA = entidad("oferta", "a", { activo: oferta({ nombre: "Alfa", alcance: { todos: false, referencias: [], categorias: [CAT_ARETES] } }) as never });
    const piePub = entidad("pie", "pie", { activo: pie({ columnas: [{ titulo: "T", enlaces: [{ texto: "Aretes", destino: destinoCategoria(CAT_ARETES) }] }] } as never) as never });
    const usos = usosDeCategoria([enBorrador, ofertaB, piePub, ofertaA], CAT_ARETES);
    assert.deepEqual(
      usos.map((u) => `${u.tipo}:${u.nombre}`),
      ["oferta:Alfa", "oferta:Beta", "pie:Pie de página", "home:Página principal"],
      "hoy: ofertas (por nombre) y pie; después, lo que solo está en borrador",
    );
  });

  it("solo se devuelven nombres y lugares: ni el contenido, ni los ids internos, ni el negocio", () => {
    const e = entidad("oferta", "amor", { activo: oferta({ nombre: "Amor y Amistad", alcance: { todos: false, referencias: ["DL-000001"], categorias: [CAT_ARETES] } }) as never });
    const [u] = usosDeCategoria([e], CAT_ARETES);
    assert.deepEqual(Object.keys(u).sort(), ["clave", "enBorrador", "enPublicado", "estado", "lugares", "nombre", "tipo", "visibleHoy"]);
    const texto = JSON.stringify(u);
    assert.ok(!texto.includes("DL-000001") && !texto.includes(TENANT_A) && !texto.includes(e.id), "ni referencias de productos, ni el negocio, ni el id interno");
  });

  it("el nombre sale del borrador si lo hay (lo que la persona está editando) y, si no, de lo publicado", () => {
    const e = entidad("oferta", "x", { activo: oferta({ nombre: "Nombre publicado", alcance: { todos: false, referencias: [], categorias: [CAT_ARETES] } }) as never, borrador: oferta({ nombre: "Nombre nuevo", alcance: { todos: false, referencias: [], categorias: [CAT_ARETES] } }) as never });
    assert.equal(usosDeCategoria([e], CAT_ARETES)[0].nombre, "Nombre nuevo");
    const sinBorrador = entidad("oferta", "y", { activo: oferta({ nombre: "Solo publicado", alcance: { todos: false, referencias: [], categorias: [CAT_ARETES] } }) as never });
    assert.equal(usosDeCategoria([sinBorrador], CAT_ARETES)[0].nombre, "Solo publicado");
  });

  it("un contenido mal formado (borrador a medias) no rompe el cálculo: simplemente no aporta usos", () => {
    const roto = entidad("home", "home", { borrador: { categorias_destacadas: "no-es-una-lista", banner: 7, portada: null } });
    assert.deepEqual(usosDeCategoria([roto], CAT_ARETES), []);
  });
});
