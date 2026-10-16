/**
 * Administración de tienda — cómo se cuentan las FOTOS Y VIDEOS en el historial y en «lo que cambia» al publicar (sin pantalla): nombres, «Subió un video», y un resumen que habla de videos e
 * imágenes (no de códigos) y compara las imágenes de las categorías por categoría, no por su lugar en la lista.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { borradorInicial, mismoContenido, poner } from "@/components/dashboard/tienda/borrador";
import { NOMBRES_TIPO, accionDeAuditoria, objetoDeAuditoria, resumirCambios } from "@/components/dashboard/tienda/formato";
import type { RegistroAuditoria } from "@/lib/cms-comercial/contrato";

const V1 = "e0000000-0000-4000-8000-000000000001";
const V2 = "e0000000-0000-4000-8000-000000000002";
const P1 = "e0000000-0000-4000-8000-000000000011";
const P2 = "e0000000-0000-4000-8000-000000000012";
const I1 = "e0000000-0000-4000-8000-000000000021";
const I2 = "e0000000-0000-4000-8000-000000000022";
const ARETES = "c0000000-0000-4000-8000-0000000000a1";
const DIJES = "c0000000-0000-4000-8000-0000000000a2";
const CATEGORIAS = [
  { id: ARETES, nombre: "Aretes" },
  { id: DIJES, nombre: "Dijes" },
];

const marca = (video: string, poster: string) => ({ videos: { marca: { horizontal: { video, poster } } } });
const imagen = (asset: string, alt = "Imagen") => ({ origen: "cms", asset, alt });

describe("el tipo «Fotos y videos» en el panel", () => {
  it("tiene nombre en español y en inglés, y el borrador con el que arranca está vacío (la tienda no cambia)", () => {
    assert.deepEqual([NOMBRES_TIPO.multimedia.singular, NOMBRES_TIPO.multimedia.plural], ["Fotos y videos", "Fotos y videos"]);
    assert.equal(NOMBRES_TIPO.multimedia.singularEn, "Photos and videos");
    assert.ok(NOMBRES_TIPO.multimedia.nuevo && NOMBRES_TIPO.multimedia.nuevoEn);
    assert.deepEqual(borradorInicial("multimedia"), {});
  });

  it("el historial general lo nombra sin pedir un título", () => {
    assert.equal(objetoDeAuditoria({ entidadTipo: "multimedia", antes: null, despues: { videos: {} } }), "Fotos y videos");
    assert.equal(objetoDeAuditoria({ entidadTipo: "multimedia", antes: null, despues: null }), "Fotos y videos");
  });

  it("un cambio es un cambio aunque el borrador esté casi vacío: poner y quitar un video se nota, y volver al original lo deja igual que el inicial", () => {
    const base = borradorInicial("multimedia");
    const con = poner(base, "videos.marca.horizontal", { video: V1, poster: P1 });
    assert.equal(mismoContenido("multimedia", base, con), false);
    assert.deepEqual(con, marca(V1, P1));
    const sin = poner(con, "videos.marca", undefined);
    assert.deepEqual(sin, {}, "al quitar el único espacio no queda un «videos: {}» vacío");
    assert.equal(mismoContenido("multimedia", base, sin), true);
  });
});

describe("el historial distingue un video de una imagen", () => {
  const registro = (despues: unknown, accion: RegistroAuditoria["accion"] = "subir_imagen") => ({ accion, despues }) as Pick<RegistroAuditoria, "accion" | "despues">;

  it("subir un archivo de tipo video dice «Subió un video»; una imagen, «Subió una imagen»", () => {
    assert.equal(accionDeAuditoria(registro({ mime_type: "video/mp4", ancho: 1280, alto: 720 })), "Subió un video");
    assert.equal(accionDeAuditoria(registro({ mime_type: "video/mp4" }), true), "Uploaded a video");
    assert.equal(accionDeAuditoria(registro({ mime_type: "image/webp" })), "Subió una imagen");
    assert.equal(accionDeAuditoria(registro({ mime_type: "image/webp" }), true), "Uploaded an image");
  });

  it("sin datos del archivo, o con datos raros, se queda con lo de siempre (nunca lanza)", () => {
    for (const raro of [null, undefined, "x", 3, [], { mime_type: 5 }, { mime_type: "VIDEO/MP4" }]) assert.equal(accionDeAuditoria(registro(raro)), "Subió una imagen", JSON.stringify(raro));
  });

  it("las demás acciones no cambian aunque lleven un tipo de video", () => {
    assert.equal(accionDeAuditoria(registro({ mime_type: "video/mp4" }, "publicar")), "Publicó");
    assert.equal(accionDeAuditoria(registro({ mime_type: "video/mp4" }, "crear"), true), "Created");
  });
});

describe("«lo que cambia» al publicar fotos y videos", () => {
  it("un video nuevo se cuenta como «video nuevo» en el espacio donde va (sin códigos ni la imagen fija)", () => {
    const c = resumirCambios({}, marca(V1, P1), 12, { categorias: CATEGORIAS });
    assert.deepEqual(c, [{ campo: "Video · Marca · tarjeta", antes: "—", despues: "video nuevo" }]);
  });

  it("cambiar el video por otro dice «video anterior → video nuevo»; quitarlo, «video anterior → —»", () => {
    assert.deepEqual(resumirCambios(marca(V1, P1), marca(V2, P2)), [{ campo: "Video · Marca · tarjeta", antes: "video anterior", despues: "video nuevo" }]);
    assert.deepEqual(resumirCambios(marca(V1, P1), {}), [{ campo: "Video · Marca · tarjeta", antes: "video anterior", despues: "—" }]);
  });

  it("cada espacio y orientación se nombra como en la pantalla", () => {
    const antes = {};
    const despues = {
      videos: {
        portada: { horizontal: { video: V1, poster: P1 }, vertical: { video: V2, poster: P2 } },
        mayoristas: { horizontal: { video: V1, poster: P1 } },
      },
    };
    assert.deepEqual(
      resumirCambios(antes, despues, 12).map((x) => x.campo),
      ["Video · Portada · pantalla horizontal", "Video · Portada · pantalla vertical (celular)", "Video · Mayoristas · banda de fondo"],
    );
  });

  it("la imagen de una categoría se nombra por la categoría («Imagen de la categoría «Aretes»») aunque cambie su lugar en la lista", () => {
    const antes = { categorias: [{ categoria_id: ARETES, imagen: imagen(I1) }] };
    const despues = {
      categorias: [
        { categoria_id: DIJES, imagen: imagen(I2) },
        { categoria_id: ARETES, imagen: imagen(I1) },
      ],
    };
    assert.deepEqual(resumirCambios(antes, despues, 12, { categorias: CATEGORIAS }), [{ campo: "Imagen de la categoría «Dijes»", antes: "—", despues: "imagen nueva" }]);
  });

  it("cambiar o quitar la imagen de una categoría", () => {
    const antes = { categorias: [{ categoria_id: ARETES, imagen: imagen(I1) }] };
    assert.deepEqual(resumirCambios(antes, { categorias: [{ categoria_id: ARETES, imagen: imagen(I2) }] }, 12, { categorias: CATEGORIAS }), [{ campo: "Imagen de la categoría «Aretes»", antes: "imagen anterior", despues: "imagen nueva" }]);
    assert.deepEqual(resumirCambios(antes, {}, 12, { categorias: CATEGORIAS }), [{ campo: "Imagen de la categoría «Aretes»", antes: "imagen anterior", despues: "—" }]);
  });

  it("una categoría que ya no existe en el catálogo no muestra su código", () => {
    const c = resumirCambios({}, { categorias: [{ categoria_id: ARETES, imagen: imagen(I1) }] }, 12, { categorias: [] });
    assert.equal(c[0].campo, "Imagen de la categoría «categoría eliminada»");
  });

  it("solo el texto alternativo de una imagen de categoría que no cambió de imagen no es un cambio visible", () => {
    const a = { categorias: [{ categoria_id: ARETES, imagen: imagen(I1, "Aretes dorados") }] };
    const b = { categorias: [{ categoria_id: ARETES, imagen: imagen(I1, "Aretes dorados sobre fondo claro") }] };
    assert.deepEqual(resumirCambios(a, b, 12, { categorias: CATEGORIAS }), []);
  });

  it("el contenido de otros tipos que usa la palabra «categorias» (la página principal) se sigue resumiendo como siempre", () => {
    const c = resumirCambios({ categorias_destacadas: [ARETES] }, { categorias_destacadas: [ARETES, DIJES] }, 12, { categorias: CATEGORIAS });
    assert.deepEqual(c, [{ campo: "Categorías destacadas", antes: "Aretes", despues: "Aretes, Dijes" }]);
  });
});
