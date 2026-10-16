/**
 * Lo que se hace con un video en el navegador ANTES de subirlo (video-navegador.ts): revisar el archivo con las reglas del espacio y las del navegador, con herramientas falsas (aquí no hay
 * navegador) y con los videos REALES de la tienda y MP4 sintéticos.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { crearMp4 } from "@/lib/cms-comercial/testing/mp4";
import { LADO_MAXIMO_IMAGEN_FIJA, escalaPara, momentoDeImagenFija, revisarArchivo, type HerramientasVideo, type SondeoVideo } from "@/lib/cms-comercial/video-navegador";

const CARPETA = path.join(process.cwd(), "public", "catalogo", "delacour", "video");
const real = (nombre: string) => new Uint8Array(readFileSync(path.join(CARPETA, nombre)));
const archivo = (bytes: Uint8Array, nombre = "video.mp4") => new File([bytes as BlobPart], nombre, { type: "video/mp4" });

const IMAGEN = new Blob([new Uint8Array(100)], { type: "image/jpeg" });
const BIEN: SondeoVideo = { reproducible: true, ancho: 1280, alto: 720, duracionSeg: 8, imagenFija: IMAGEN };
const MAL: SondeoVideo = { reproducible: false, ancho: null, alto: null, duracionSeg: null, imagenFija: null };

function herramientas(sondeo: SondeoVideo | (() => Promise<SondeoVideo>) = BIEN): HerramientasVideo & { llamadas: string[] } {
  const llamadas: string[] = [];
  return {
    llamadas,
    leerBytes: async (b) => (llamadas.push("leer"), new Uint8Array(await b.arrayBuffer())),
    sondear: async () => (llamadas.push("sondear"), typeof sondeo === "function" ? sondeo() : sondeo),
    urlTemporal: () => "blob:falso",
    liberar: () => {},
  };
}

describe("la imagen fija: cuándo se toma y de qué tamaño", () => {
  it("un quinto del video, nunca antes de 0,1 s ni después de 2 s; sin duración conocida, el primer fotograma", () => {
    assert.equal(momentoDeImagenFija(8), 1.6);
    assert.equal(momentoDeImagenFija(4), 0.8);
    assert.equal(momentoDeImagenFija(15), 2);
    assert.equal(momentoDeImagenFija(60), 2);
    assert.equal(momentoDeImagenFija(0.2), 0.1);
    for (const raro of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(momentoDeImagenFija(raro), 0, String(raro));
  });

  it("el lado más largo no pasa de 1280 px y nunca se agranda", () => {
    assert.equal(LADO_MAXIMO_IMAGEN_FIJA, 1280);
    assert.equal(escalaPara(1280, 720), 1);
    assert.equal(escalaPara(720, 1280), 1);
    assert.equal(escalaPara(640, 360), 1);
    assert.equal(escalaPara(1920, 1080), 1280 / 1920);
    assert.equal(escalaPara(1080, 1920), 1280 / 1920);
    assert.equal(escalaPara(4000, 3000), 0.32);
    assert.equal(escalaPara(4000, 3000, 1200), 0.3);
  });
});

describe("revisarArchivo — antes de subir", () => {
  it("un video bueno, que el navegador abre: cumple todo, trae la imagen fija y lee el archivo completo", async () => {
    const h = herramientas();
    const r = await revisarArchivo(archivo(real("portada-h.mp4"), "mi-portada.mp4"), "portada.horizontal", h);
    assert.equal(r.resultado.cumple, true, JSON.stringify(r.resultado.fallos));
    assert.equal(r.imagenFija, IMAGEN);
    assert.equal(r.leido, true);
    assert.deepEqual([r.nombre, r.bytes, r.archivo], ["mi-portada.mp4", real("portada-h.mp4").byteLength, "portada.horizontal"]);
    const ids = r.resultado.comprobaciones.map((c) => c.id);
    for (const id of ["formato", "estructura", "peso", "duracion", "codec", "perfil", "sonido", "fotogramas", "proporcion", "medidas", "navegador"]) assert.ok(ids.includes(id as never), id);
    assert.deepEqual(h.llamadas, ["leer", "sondear"]);
  });

  it("los seis videos reales cumplen en su espacio, también con la comprobación del navegador", async () => {
    for (const [nombre, destino] of [
      ["portada-h.mp4", "portada.horizontal"],
      ["portada-v.mp4", "portada.vertical"],
      ["coleccion-h.mp4", "coleccion.horizontal"],
      ["coleccion-v.mp4", "coleccion.vertical"],
      ["marca.mp4", "marca.horizontal"],
      ["mayoristas.mp4", "mayoristas.horizontal"],
    ] as const) {
      const r = await revisarArchivo(archivo(real(nombre), nombre), destino, herramientas());
      assert.equal(r.resultado.cumple, true, `${nombre}: ${JSON.stringify(r.resultado.fallos.map((f) => f.id))}`);
    }
  });

  it("si el navegador no lo abre, NO cumple aunque el archivo esté bien, y no hay imagen fija", async () => {
    const r = await revisarArchivo(archivo(real("marca.mp4")), "marca.horizontal", herramientas(MAL));
    assert.equal(r.resultado.cumple, false);
    assert.deepEqual(r.resultado.fallos.map((f) => f.id), ["navegador"]);
    assert.equal(r.imagenFija, null);
  });

  it("si el navegador lo abre pero no entrega la imagen fija, tampoco cumple", async () => {
    const r = await revisarArchivo(archivo(real("marca.mp4")), "marca.horizontal", herramientas({ ...BIEN, imagenFija: null }));
    assert.equal(r.resultado.cumple, false);
    assert.deepEqual(r.resultado.fallos.map((f) => f.id), ["navegador"]);
  });

  it("si la comprobación del navegador revienta, se toma como que no abre (nunca lanza)", async () => {
    const r = await revisarArchivo(archivo(real("marca.mp4")), "marca.horizontal", herramientas(() => Promise.reject(new Error("canvas roto"))));
    assert.equal(r.resultado.cumple, false);
    assert.deepEqual(r.resultado.fallos.map((f) => f.id), ["navegador"]);
  });

  it("cada regla del archivo que falla se informa, y aun así se le pregunta al navegador (la lista queda completa)", async () => {
    const h = herramientas();
    const r = await revisarArchivo(archivo(crearMp4({ audio: true, duracionSeg: 30 })), "portada.horizontal", h);
    assert.equal(r.resultado.cumple, false);
    assert.deepEqual(r.resultado.fallos.map((f) => f.id).sort(), ["duracion", "sonido"]);
    assert.ok(r.resultado.comprobaciones.some((c) => c.id === "navegador" && c.ok));
    assert.deepEqual(h.llamadas, ["leer", "sondear"]);
  });

  it("un video para otro espacio dice dónde va: el vertical de la portada no sirve en el horizontal", async () => {
    const r = await revisarArchivo(archivo(real("portada-v.mp4")), "portada.horizontal", herramientas());
    assert.equal(r.resultado.cumple, false);
    assert.ok(r.resultado.fallos.some((f) => f.id === "proporcion" && /Súbelo en «Portada · pantalla vertical \(celular\)»/.test(f.arreglo ?? "")));
  });

  it("un archivo que no es un MP4: solo se dice eso (y el peso), y el navegador ni se consulta", async () => {
    const h = herramientas();
    const r = await revisarArchivo(archivo(new TextEncoder().encode("esto no es un video, es un texto largo ".repeat(30)), "notas.mp4"), "portada.horizontal", h);
    assert.equal(r.resultado.cumple, false);
    assert.deepEqual(r.resultado.comprobaciones.map((c) => c.id), ["formato", "peso"]);
    assert.equal(r.leido, true);
    assert.deepEqual(h.llamadas, ["leer"], "no se sondea algo que no es un video");
  });

  it("un archivo enorme no se lee ni se abre: solo se dice cuánto pesa y a cuánto hay que bajarlo", async () => {
    const h = herramientas();
    const enorme = { size: 122 * 1024 * 1024, name: "4k-60fps.mp4", type: "video/mp4" } as unknown as File;
    const r = await revisarArchivo(enorme, "portada.horizontal", h);
    assert.equal(r.resultado.cumple, false);
    assert.equal(r.leido, false);
    assert.deepEqual(r.resultado.fallos.map((f) => f.id), ["peso"]);
    assert.match(r.resultado.fallos[0].detalle, /^Pesa 122 MB\.$/);
    assert.match(r.resultado.fallos[0].arreglo ?? "", /Redúcelo a 3 MB o menos/);
    assert.deepEqual(h.llamadas, [], "ni se leyó ni se abrió");
  });

  it("si no se puede leer el archivo, es un resultado (no una excepción) y no se abre en el navegador", async () => {
    const h = herramientas();
    h.leerBytes = async () => {
      throw new Error("permiso denegado");
    };
    const r = await revisarArchivo(archivo(real("marca.mp4")), "marca.horizontal", h);
    assert.equal(r.resultado.cumple, false);
    assert.equal(r.leido, false);
    assert.equal(r.resultado.comprobaciones[0].id, "formato");
    assert.deepEqual(h.llamadas, []);
  });

  it("un video con el índice al final se acepta y se avisa de lo que se arregla solo", async () => {
    const r = await revisarArchivo(archivo(crearMp4({ moovAlFinal: true })), "portada.horizontal", herramientas());
    assert.equal(r.resultado.cumple, true, JSON.stringify(r.resultado.fallos));
    assert.equal(r.resultado.seCorrigeSolo.length, 1);
  });
});
