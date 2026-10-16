/**
 * Inicio «como la referencia» (Bloque 30), lo puro y lo que protege los archivos de video: qué acabados se muestran (los colores REALES del catálogo, nunca una lista escrita a mano), que el bloque
 * de mayoristas conserve su video y que cada video de Delacour exista, sea liviano, no tenga sonido y empiece a verse sin esperar a que termine de bajar. Solo presentación.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import sharp from "sharp";
import type { OpcionFaceta } from "@/lib/catalogo/filtros";
import { ACABADOS_MAX, ACABADOS_MIN_PIEZAS, acabadosVisibles, mayoristasVisible } from "@/lib/catalogo/joyeria";
import { joyeriaOf, storefrontConfigFor, type ArchivoVideo, type ConfigJoyeria, type VideoAmbiente } from "@/lib/catalogo/vitrina";

const BASE = "/catalogo/delacour";
const opcion = (etiqueta: string, n: number, clave = etiqueta.toLowerCase()): OpcionFaceta => ({ clave, etiqueta, n });

describe("acabados del inicio", () => {
  it("salen de los colores reales: los de más piezas primero, con su enlace al listado filtrado, y como mucho cuatro", () => {
    const colores = [opcion("Dorado", 85), opcion("Oro rosa", 3, "oro ros"), opcion("Plateado", 10), opcion("Platinado", 17), opcion("Cobre", 4), opcion("Bronce", 5)];
    const antes = JSON.stringify(colores);
    const acabados = acabadosVisibles(colores, BASE);
    assert.deepEqual(acabados.map((a) => a.etiqueta), ["Dorado", "Platinado", "Plateado", "Bronce"]);
    assert.equal(acabados.length, ACABADOS_MAX);
    assert.deepEqual(acabados.map((a) => a.href), [`${BASE}?color=dorado`, `${BASE}?color=platinado`, `${BASE}?color=plateado`, `${BASE}?color=bronce`]);
    assert.equal(JSON.stringify(colores), antes, "no altera lo recibido");
  });

  it("un color con muy pocas piezas no es un acabado de la tienda: hace falta un mínimo", () => {
    const acabados = acabadosVisibles([opcion("Dorado", 40), opcion("Plateado", ACABADOS_MIN_PIEZAS), opcion("Oro rosa", ACABADOS_MIN_PIEZAS - 1)], BASE);
    assert.deepEqual(acabados.map((a) => a.etiqueta), ["Dorado", "Plateado"]);
  });

  it("sin al menos dos opciones reales no hay franja (una sola no es una franja y sin datos no se dibuja nada)", () => {
    assert.deepEqual(acabadosVisibles([opcion("Dorado", 40)], BASE), []);
    assert.deepEqual(acabadosVisibles([opcion("Dorado", 40), opcion("Plateado", 1)], BASE), []);
    assert.deepEqual(acabadosVisibles([], BASE), []);
    assert.deepEqual(acabadosVisibles(null, BASE), []);
    assert.deepEqual(acabadosVisibles(undefined, BASE), []);
  });

  it("con el mismo número de piezas, el orden es alfabético (estable entre visitas)", () => {
    const acabados = acabadosVisibles([opcion("Plateado", 9), opcion("Dorado", 9), opcion("Cobre", 9)], BASE);
    assert.deepEqual(acabados.map((a) => a.etiqueta), ["Cobre", "Dorado", "Plateado"]);
  });

  it("el enlace usa la clave del filtro (agrupa «Dorada», «dorado» y «Dorados»), escapada en la dirección", () => {
    const [a] = acabadosVisibles([opcion("Oro rosa", 9, "oro ros"), opcion("Dorado", 3, "dorad")], BASE);
    assert.equal(a.href, `${BASE}?color=oro+ros`);
  });
});

describe("mayoristas con video", () => {
  const video: VideoAmbiente = { horizontal: { src: "/v.mp4", poster: "/v.webp", width: 1280, height: 576 }, etiqueta: "Video" };
  const config = (over: Partial<NonNullable<ConfigJoyeria["mayoristas"]>> = {}): ConfigJoyeria => ({
    anuncios: [],
    mayoristas: { etiqueta: "E", titulo: "T", texto: "X", boton: "B", mensaje: "Hola", ...over },
  });

  it("el video pasa tal cual al bloque; sin video no hay clave de video", () => {
    assert.deepEqual(mayoristasVisible(config({ video }), "573001112233")?.video, video);
    assert.equal("video" in (mayoristasVisible(config(), "573001112233") ?? {}), false);
  });

  it("sin WhatsApp válido no hay bloque, tenga o no tenga video", () => {
    assert.equal(mayoristasVisible(config({ video }), null), null);
    assert.equal(mayoristasVisible(config({ video }), "123"), null);
  });
});

/** Todos los videos que declara el contenido de Delacour (portada, colección, marca y mayoristas). */
function videosDeDelacour(): Array<[string, VideoAmbiente]> {
  const j = joyeriaOf(storefrontConfigFor("delacour"))!;
  const lista: Array<[string, VideoAmbiente | undefined]> = [
    ["portada", j.portada?.video],
    ["coleccion", j.coleccion?.video],
    ["marca", j.marca?.video],
    ["mayoristas", j.mayoristas?.video],
  ];
  return lista.filter((x): x is [string, VideoAmbiente] => Boolean(x[1]));
}
const archivosDe = (v: VideoAmbiente): ArchivoVideo[] => [v.horizontal, ...(v.vertical ? [v.vertical] : [])];
const enPublic = (ruta: string) => path.join(process.cwd(), "public", ruta);
const MB = 1024 * 1024;

describe("videos de Delacour (guarda de los archivos)", () => {
  it("Delacour trae los cuatro videos del inicio y cada uno tiene su archivo y su imagen fija en public/", () => {
    assert.deepEqual(videosDeDelacour().map(([nombre]) => nombre), ["portada", "coleccion", "marca", "mayoristas"]);
    for (const [nombre, v] of videosDeDelacour()) {
      for (const a of archivosDe(v)) {
        assert.ok(a.src.startsWith(`${BASE}/video/`) && a.src.endsWith(".mp4"), `${nombre}: ${a.src}`);
        assert.ok(a.poster.startsWith(`${BASE}/video/`) && a.poster.endsWith(".webp"), `${nombre}: ${a.poster}`);
        assert.ok(existsSync(enPublic(a.src)), `falta el archivo ${a.src}`);
        assert.ok(existsSync(enPublic(a.poster)), `falta la imagen fija ${a.poster}`);
      }
    }
  });

  it("pesan poco: cada video ≤ 2 MB, cada imagen fija ≤ 80 KB y todo junto ≤ 8 MB (se descargan en el celular)", () => {
    let total = 0;
    for (const [, v] of videosDeDelacour()) {
      for (const a of archivosDe(v)) {
        const video = statSync(enPublic(a.src)).size;
        const poster = statSync(enPublic(a.poster)).size;
        assert.ok(video <= 2 * MB, `${a.src}: ${(video / MB).toFixed(2)} MB`);
        assert.ok(poster <= 80 * 1024, `${a.poster}: ${Math.round(poster / 1024)} KB`);
        total += video + poster;
      }
    }
    assert.ok(total <= 8 * MB, `en total ${(total / MB).toFixed(2)} MB`);
  });

  it("la imagen fija tiene exactamente las medidas declaradas (el navegador reserva el espacio: sin saltos al cargar)", async () => {
    for (const [, v] of videosDeDelacour()) {
      for (const a of archivosDe(v)) {
        const m = await sharp(enPublic(a.poster)).metadata();
        assert.equal(m.format, "webp", a.poster);
        assert.deepEqual([m.width, m.height], [a.width, a.height], a.poster);
      }
    }
  });

  it("el horizontal es más ancho que alto y el vertical, más alto que ancho; el vertical solo existe donde hace falta", () => {
    for (const [nombre, v] of videosDeDelacour()) {
      assert.ok(v.horizontal.width >= v.horizontal.height || nombre === "marca", `${nombre}: horizontal`);
      if (v.vertical) assert.ok(v.vertical.height > v.vertical.width, `${nombre}: vertical`);
    }
    const j = joyeriaOf(storefrontConfigFor("delacour"))!;
    assert.ok(j.portada?.video.vertical && j.coleccion?.video.vertical, "la portada y la colección ocupan toda la pantalla: tienen versión para el celular");
  });

  it("son MP4 sin sonido (ninguna pista de audio) y con el índice al principio (empiezan a verse sin esperar a que termine de bajar)", () => {
    for (const [, v] of videosDeDelacour()) {
      for (const a of archivosDe(v)) {
        const bytes = readFileSync(enPublic(a.src));
        assert.equal(bytes.subarray(4, 8).toString("latin1"), "ftyp", `${a.src}: no es un MP4`);
        const cabecera = bytes.subarray(0, Math.min(bytes.length, 200_000)).toString("latin1");
        const moov = cabecera.indexOf("moov");
        const mdat = cabecera.indexOf("mdat");
        assert.ok(moov > 0 && (mdat < 0 || moov < mdat), `${a.src}: el índice (moov) debe ir antes de los datos (mdat)`);
        assert.ok(!bytes.toString("latin1").includes("soun"), `${a.src}: no debe tener pista de audio`);
        assert.ok(bytes.toString("latin1").includes("avc1"), `${a.src}: H.264 (se ve en todos los navegadores)`);
      }
    }
  });

  it("los videos no llevan texto dentro y el contenido que los acompaña no inventa datos comerciales", () => {
    const j = joyeriaOf(storefrontConfigFor("delacour"))!;
    const textos = [j.coleccion?.etiqueta, j.coleccion?.titulo, j.coleccion?.boton, j.marca?.titulo, j.marca?.texto, j.marca?.boton, j.acabados?.titulo].filter(Boolean).join(" | ");
    assert.doesNotMatch(textos, /\$\s?\d|\d+\s?%|\b\d+\s?(d[ií]as|horas)\b/i, "ni precios, ni descuentos, ni plazos");
    assert.doesNotMatch(textos, /env[ií]o|garant[ií]a|devoluci|gratis|m[aá]s vendid|descuento|oferta|nuevo|exclusiv/i, "ni envíos, ni garantías, ni promociones, ni «nuevo» o «exclusivo» que nadie respalda");
    for (const [, v] of videosDeDelacour()) assert.ok(v.etiqueta.trim().length > 0, "cada video tiene su nombre (lo usa el botón de pausa)");
  });
});

describe("guardas de la fuente del inicio con video (CSS y código)", () => {
  const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8").replace(/\r\n/g, "\n");
  const fuente = (ruta: string) => readFileSync(path.join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
  /** La regla cuyo selector empieza al principio de una línea (así no se confunde con el mismo selector dentro de otra regla o de un @media). */
  const regla = (selector: string) => {
    const i = css.indexOf("\n" + selector + " {");
    assert.ok(i >= 0, selector);
    return css.slice(i + 1, css.indexOf("}", i) + 1);
  };
  /** El texto de un bloque @media (hasta su llave de cierre en la columna 0). */
  const bloque = (cabecera: string, desde = 0) => {
    const i = css.indexOf(cabecera, desde);
    assert.ok(i >= 0, cabecera);
    return css.slice(i, css.indexOf("\n}\n", i) + 3);
  };

  it("el video entra con un fundido (empieza invisible y la imagen fija queda debajo) y sin fundido con «movimiento reducido»", () => {
    assert.match(css, /\n\.tienda-joyeria \.joy-video-medio \{\n  opacity: 0;\n  transition: opacity 0\.9s ease;\n\}/);
    assert.match(regla('.tienda-joyeria .joy-video[data-listo="true"] .joy-video-medio'), /opacity: 1/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.tienda-joyeria \.joy-video-medio \{\n    transition: none;/);
    assert.match(regla(".tienda-joyeria .joy-video-poster,\n.tienda-joyeria .joy-video-medio"), /object-fit: cover/);
  });

  it("las diapositivas se funden con la entrante por encima y la saliente debajo hasta que termina (sin hueco oscuro a mitad del cambio)", () => {
    const base = regla(".tienda-joyeria .joy-slide");
    assert.match(base, /z-index: 1;[\s\S]*visibility: hidden;[\s\S]*opacity: 0;[\s\S]*transition:\n    opacity 0s linear 0\.7s,\n    visibility 0s linear 0\.7s;/);
    const activa = regla('.tienda-joyeria .joy-slide[data-activa="true"]');
    assert.match(activa, /z-index: 2;[\s\S]*visibility: visible;[\s\S]*opacity: 1;[\s\S]*transition:\n    opacity 0\.7s ease,\n    visibility 0s linear 0s;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.tienda-joyeria \.joy-slide,\n  \.tienda-joyeria \.joy-slide\[data-activa="true"\] \{\n    transition: none;/);
  });

  it("el acercamiento de la foto y la repetición de la entrada del texto existen SOLO con movimiento permitido", () => {
    const permitido = bloque("@media (prefers-reduced-motion: no-preference) {\n  .tienda-joyeria .joy-slide[data-activa=\"true\"] .joy-zoom");
    assert.match(permitido, /transform: scale\(1\.07\);\n    transition: transform 9s ease-out;/);
    for (const parte of [".joy-ent {\n    animation: none;", ".joy-linea {\n    animation: none;\n    width: 4rem;", ".joy-titulo-brillo {\n    animation: none;\n    background-position: -50% 0;"]) assert.ok(permitido.includes(parte), parte);
    assert.doesNotMatch(regla(".tienda-joyeria .joy-zoom"), /scale\(/, "fuera del bloque de movimiento permitido la foto no se acerca");
  });

  it("el menú y los anuncios se leen sobre el video y la foto: sombra de arriba (30 % de alto, 0,55 → 0) y velo propio de la foto (0,86/0,7 en escritorio; 0,82/0,6 en celular)", () => {
    const sombra = regla(".tienda-joyeria .joy-slide::after");
    assert.match(sombra, /height: 30%;/);
    assert.match(sombra, /rgb\(20 12 6 \/ 0\.55\) 0%, rgb\(20 12 6 \/ 0\.3\) 45%, transparent 100%/);
    assert.match(regla(".tienda-joyeria .joy-hero-velo-foto"), /rgb\(42 28 18 \/ 0\.82\) 0%, rgb\(42 28 18 \/ 0\.6\) 40%/);
    const medianas = bloque("@media (min-width: 768px) {\n  .tienda-joyeria .joy-hero-velo-foto");
    assert.match(medianas, /to right, rgb\(42 28 18 \/ 0\.86\) 0%, rgb\(42 28 18 \/ 0\.7\) 46%, rgb\(42 28 18 \/ 0\.32\) 62%/);
    assert.match(fuente("components/catalogo-publico/tienda/joyeria/PortadaJoyeria.tsx"), /joy-hero-velo joy-hero-velo-foto/);
    assert.match(regla(".tienda-joyeria .joy-coleccion-velo"), /rgb\(24 16 10 \/ 0\.7\) 0%/);
    assert.match(regla(".tienda-joyeria .joy-mayoristas-velo"), /rgb\(34 22 14 \/ 0\.6\)/);
  });

  it("la firma de la marca (segunda diapositiva) es más chica que el título de la portada y va en una línea: nunca es el candidato de LCP cuando la diapositiva entra", () => {
    const hero = fuente("components/catalogo-publico/tienda/joyeria/HeroJoyeria.tsx");
    assert.match(hero, /marca \? "max-w-\[48rem\]" : "max-w-\[34rem\]"/);
    assert.match(hero, /marca \? "text-\[clamp\(1\.6rem,5\.2vw,3\.5rem\)\]/);
    assert.match(hero, /: "text-\[clamp\(2\.5rem,7\.2vw,5\.25rem\)\] leading-\[1\.02\]/, "el título de la portada conserva su tamaño");
  });

  it("los controles son cómodos de tocar (botones de 44 px, objetivos de 24 px en los puntos) y funcionan con transparencia reducida y colores forzados", () => {
    assert.match(regla(".tienda-joyeria .joy-video-boton"), /width: 2\.75rem;\n  height: 2\.75rem;/);
    assert.match(regla(".tienda-joyeria .joy-portada-flecha"), /width: 2\.75rem;\n  height: 2\.75rem;/);
    assert.match(regla(".tienda-joyeria .joy-portada-punto"), /height: 1\.5rem;\n  min-width: 1\.5rem;/);
    const transparencia = bloque("@media (prefers-reduced-transparency: reduce) {\n  .tienda-joyeria .joy-video-boton");
    for (const clase of [".joy-video-boton", ".joy-portada-flecha", ".joy-contorno-claro"]) assert.ok(transparencia.includes(clase), clase);
    assert.match(transparencia, /backdrop-filter: none;/);
    const forzados = bloque("@media (forced-colors: active) {\n  .tienda-joyeria .joy-whatsapp");
    for (const clase of [".joy-whatsapp", ".joy-arriba", ".joy-video-boton", ".joy-portada-flecha"]) assert.ok(forzados.includes(clase), clase);
  });

  it("los botones flotantes quedan encima de la navegación inferior del celular y a la derecha, con «volver arriba» justo encima de WhatsApp", () => {
    assert.match(regla(".tienda-joyeria .joy-whatsapp"), /right: 1\.5rem;\n  bottom: calc\(env\(safe-area-inset-bottom\) \+ 4\.5rem\);/);
    assert.match(regla(".tienda-joyeria .joy-arriba"), /bottom: calc\(env\(safe-area-inset-bottom\) \+ 9rem\);/);
    const anchos = bloque("@media (min-width: 768px) {\n  .tienda-joyeria .joy-whatsapp");
    assert.match(anchos, /\.joy-whatsapp \{\n    bottom: 1\.5rem;/);
    assert.match(anchos, /\.joy-arriba \{\n    bottom: 5\.5rem;/);
  });

  it("el control del video de pantalla completa va sobre la navegación inferior en el celular y en la esquina en pantallas medianas", () => {
    assert.match(regla('.tienda-joyeria .joy-video-control[data-control="pildora"]'), /bottom: calc\(env\(safe-area-inset-bottom\) \+ 4\.5rem\);/);
    assert.match(bloque("@media (min-width: 768px) {\n  .tienda-joyeria .joy-video-control[data-control=\"pildora\"]"), /bottom: 1\.5rem;/);
  });

  it("los videos y sus imágenes fijas se guardan un día en el navegador (y siguen sirviéndose mientras se revalidan); los de la tienda son del mismo origen y el CSP solo suma lo que necesita la vista previa del panel", () => {
    const config = fuente("next.config.ts");
    assert.match(config, /source: "\/catalogo\/delacour\/video\/:path\*",\n\s+headers: \[\{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" \}\]/);
    // media-src: el propio origen, blob: (vista previa local del panel) y el Storage de Supabase (el mismo dominio ya confiado para imágenes): nada más.
    const media = [...config.matchAll(/"(media-src [^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(media, ["media-src 'self' blob: https://*.supabase.co"], "una sola línea, sin comodines");
    assert.ok(!/media-src[^"]*(\*\s|\*"| \*$|http:|data:|'unsafe-)/.test(media[0]), "sin comodín total, sin http ni data:");
    for (const [, v] of videosDeDelacour()) for (const a of archivosDe(v)) assert.ok(a.src.startsWith("/") && !a.src.startsWith("//"), `${a.src} es del mismo origen`);
  });
});
