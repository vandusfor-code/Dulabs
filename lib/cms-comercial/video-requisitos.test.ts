/**
 * Requisitos de los videos de la tienda (video-requisitos.ts): la tabla de medidas por espacio, cada regla que puede fallar con el mensaje que le sale a la administradora, y que los videos
 * REALES de la tienda (los que preparó DuLabs) cumplen cada uno los requisitos de su propio espacio: la regla y la práctica no se pueden separar.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { crearMp4 } from "@/lib/cms-comercial/testing/mp4";
import {
  ARCHIVOS_VIDEO,
  agregarComprobacionNavegador,
  ESPACIOS_VIDEO,
  ESPECIFICACIONES,
  IDEAL_BYTES_VIDEO,
  MAX_BYTES_VIDEO,
  REQUISITOS_GENERALES,
  archivoDe,
  comandoFfmpeg,
  evaluarVideo,
  pesoDicho,
  pesoLegible,
  type ArchivoVideoId,
  type IdComprobacion,
} from "@/lib/cms-comercial/video-requisitos";
import { analizarMp4 } from "@/lib/cms-comercial/video-mp4";

const MB = 1024 * 1024;
const CARPETA = path.join(process.cwd(), "public", "catalogo", "delacour", "video");
const real = (nombre: string) => new Uint8Array(readFileSync(path.join(CARPETA, nombre)));
const evaluar = (opciones: Parameters<typeof crearMp4>[0], archivo: ArchivoVideoId = "portada.horizontal") => evaluarVideo(analizarMp4(crearMp4(opciones)), archivo);
const ids = (r: ReturnType<typeof evaluarVideo>) => r.fallos.map((f) => f.id).sort();

describe("la tabla de espacios y archivos", () => {
  it("hay seis archivos, cada uno con su especificación completa y coherente (el ideal cabe dentro de lo que se acepta)", () => {
    assert.deepEqual([...ARCHIVOS_VIDEO].sort(), Object.keys(ESPECIFICACIONES).sort());
    for (const id of ARCHIVOS_VIDEO) {
      const e = ESPECIFICACIONES[id];
      assert.equal(e.id, id);
      assert.ok(ESPACIOS_VIDEO.includes(e.espacio) && id.startsWith(`${e.espacio}.`) && id.endsWith(`.${e.orientacion}`), id);
      assert.ok(e.ideal.ancho >= e.minimo.ancho && e.ideal.alto >= e.minimo.alto && e.ideal.ancho <= e.maximo.ancho && e.ideal.alto <= e.maximo.alto, `${id}: el ideal está fuera del rango`);
      const relacionIdeal = e.ideal.ancho / e.ideal.alto;
      assert.ok(relacionIdeal >= e.relacion.min && relacionIdeal <= e.relacion.max, `${id}: la proporción ideal no está en su rango`);
      // los extremos del rango de medidas también respetan la proporción aceptada (si no, un video «válido» por medidas se rechazaría por proporción)
      assert.ok(e.minimo.ancho / e.minimo.alto >= e.relacion.min - 0.04 && e.minimo.ancho / e.minimo.alto <= e.relacion.max + 0.04, `${id}: el mínimo no respeta la proporción`);
      assert.ok(e.maximo.ancho / e.maximo.alto >= e.relacion.min - 0.04 && e.maximo.ancho / e.maximo.alto <= e.relacion.max + 0.04, `${id}: el máximo no respeta la proporción`);
      assert.ok(e.titulo && e.descripcion && e.proporcion);
    }
  });

  it("las medidas ideales son las de los videos que trae la tienda", () => {
    assert.deepEqual(ESPECIFICACIONES["portada.horizontal"].ideal, { ancho: 1280, alto: 720 });
    assert.deepEqual(ESPECIFICACIONES["portada.vertical"].ideal, { ancho: 720, alto: 1280 });
    assert.deepEqual(ESPECIFICACIONES["coleccion.horizontal"].ideal, { ancho: 1280, alto: 720 });
    assert.deepEqual(ESPECIFICACIONES["coleccion.vertical"].ideal, { ancho: 720, alto: 1280 });
    assert.deepEqual(ESPECIFICACIONES["marca.horizontal"].ideal, { ancho: 720, alto: 900 });
    assert.deepEqual(ESPECIFICACIONES["mayoristas.horizontal"].ideal, { ancho: 1280, alto: 576 });
  });

  it("la marca y los mayoristas solo tienen un archivo; la portada y la colección, uno horizontal y uno vertical", () => {
    assert.equal(archivoDe("portada", "vertical"), "portada.vertical");
    assert.equal(archivoDe("coleccion", "horizontal"), "coleccion.horizontal");
    assert.equal(archivoDe("marca", "horizontal"), "marca.horizontal");
    assert.equal(archivoDe("marca", "vertical"), null);
    assert.equal(archivoDe("mayoristas", "vertical"), null);
  });

  it("los límites generales son los que se le dicen a la clienta", () => {
    assert.equal(MAX_BYTES_VIDEO, 3 * MB);
    assert.equal(IDEAL_BYTES_VIDEO, 2 * MB);
    assert.match(REQUISITOS_GENERALES.pesoMaximo, /3 MB/);
    assert.match(REQUISITOS_GENERALES.duracion, /4 a 15 segundos/);
    assert.match(REQUISITOS_GENERALES.fotogramas, /30/);
    assert.match(REQUISITOS_GENERALES.sonido, /Sin sonido/);
  });
});

describe("los videos reales de la tienda cumplen los requisitos de su espacio (y solo del suyo)", () => {
  const PARES: Array<[string, ArchivoVideoId]> = [
    ["portada-h.mp4", "portada.horizontal"],
    ["portada-v.mp4", "portada.vertical"],
    ["coleccion-h.mp4", "coleccion.horizontal"],
    ["coleccion-v.mp4", "coleccion.vertical"],
    ["marca.mp4", "marca.horizontal"],
    ["mayoristas.mp4", "mayoristas.horizontal"],
  ];
  for (const [nombre, archivo] of PARES) {
    it(`${nombre} cumple «${archivo}» sin avisos de arreglo`, () => {
      const r = evaluarVideo(analizarMp4(real(nombre)), archivo);
      assert.deepEqual(r.fallos, [], JSON.stringify(r.fallos));
      assert.equal(r.cumple, true);
      assert.deepEqual(r.seCorrigeSolo, []);
      assert.deepEqual(r.comprobaciones.map((c) => c.id), ["formato", "estructura", "peso", "duracion", "codec", "perfil", "sonido", "fotogramas", "proporcion", "medidas"]);
    });
  }

  it("un video vertical en un espacio horizontal falla por proporción y le dice dónde subirlo", () => {
    const r = evaluarVideo(analizarMp4(real("portada-v.mp4")), "portada.horizontal");
    assert.deepEqual(ids(r), ["medidas", "proporcion"]);
    const p = r.fallos.find((f) => f.id === "proporcion");
    assert.match(p?.arreglo ?? "", /Este espacio es horizontal \(16:9\) y tu video es vertical\. Súbelo en «Portada · pantalla vertical \(celular\)»/);
  });

  it("uno horizontal en un espacio vertical, también", () => {
    const r = evaluarVideo(analizarMp4(real("coleccion-h.mp4")), "coleccion.vertical");
    assert.ok(ids(r).includes("proporcion"));
    assert.match(r.fallos.find((f) => f.id === "proporcion")?.arreglo ?? "", /Este espacio es vertical \(9:16\) y tu video es horizontal\. Súbelo en «Colección · pantalla horizontal»/);
  });

  it("la franja de mayoristas (20:9) no sirve de portada, pero un 16:9 sí sirve de franja de mayoristas", () => {
    assert.ok(ids(evaluarVideo(analizarMp4(real("mayoristas.mp4")), "portada.horizontal")).includes("proporcion"));
    assert.equal(evaluarVideo(analizarMp4(real("portada-h.mp4")), "mayoristas.horizontal").cumple, true);
  });

  it("la tarjeta de la marca (4:5) no sirve de portada vertical", () => {
    assert.ok(ids(evaluarVideo(analizarMp4(real("marca.mp4")), "portada.vertical")).includes("proporcion"));
  });
});

describe("cada regla, con el mensaje que le sale a la administradora", () => {
  it("un video correcto cumple todo", () => {
    const r = evaluar({});
    assert.equal(r.cumple, true);
    assert.deepEqual(r.fallos, []);
  });

  it("peso: pasarse de 3 MB falla y dice cuánto pesa y cómo bajarlo; entre 2 y 3 MB se acepta con una recomendación", () => {
    const pesado = evaluar({ bytesDeDatos: 3 * MB + 1000 });
    assert.deepEqual(ids(pesado), ["peso"]);
    const f = pesado.fallos[0];
    assert.match(f.detalle, /^Pesa un poco más de 3 MB\.$/, "justo por encima del tope no dice «3 MB» (se vería que cumple)");
    assert.match(evaluar({ bytesDeDatos: 5 * MB }).fallos[0].detalle, /^Pesa 5 MB\.$/);
    assert.match(f.arreglo ?? "", /Redúcelo a 3 MB o menos/);
    assert.match(f.arreglo ?? "", /1280×720/);
    const justo = evaluar({ bytesDeDatos: 2.5 * MB });
    assert.equal(justo.cumple, true);
    assert.match(justo.recomendaciones.join(" "), /Pesa 2,5 MB: se acepta, pero con 2 MB o menos carga más rápido/);
    assert.deepEqual(evaluar({ bytesDeDatos: 1.5 * MB }).recomendaciones, []);
  });

  it("un .mov de QuickTime con video H.264 se acepta, con una recomendación; un MP4 normal, sin ella", () => {
    const mov = evaluar({ marca: "qt  " });
    assert.equal(mov.cumple, true);
    assert.equal(mov.recomendaciones.length, 1);
    assert.match(mov.recomendaciones[0], /viene de QuickTime \(un \.mov/);
    assert.deepEqual(evaluar({ marca: "isom" }).recomendaciones, []);
    assert.deepEqual(evaluar({ marca: "mp42" }).recomendaciones, []);
  });

  it("duración: menos de 4 s o más de 15 s falla; 4 y 15 se aceptan; más de 10 s trae una recomendación", () => {
    assert.deepEqual(ids(evaluar({ duracionSeg: 2 })), ["duracion"]);
    assert.deepEqual(ids(evaluar({ duracionSeg: 20 })), ["duracion"]);
    assert.match(evaluar({ duracionSeg: 20 }).fallos[0].arreglo ?? "", /Recórtalo a unos 8 segundos/);
    assert.match(evaluar({ duracionSeg: 2 }).fallos[0].arreglo ?? "", /al menos 4 segundos/);
    assert.equal(evaluar({ duracionSeg: 4 }).cumple, true);
    assert.equal(evaluar({ duracionSeg: 15 }).cumple, true);
    assert.equal(evaluar({ duracionSeg: 3.96 }).cumple, true, "el redondeo de la duración no es un motivo para rechazar");
    assert.equal(evaluar({ duracionSeg: 3.8 }).cumple, false);
    assert.match(evaluar({ duracionSeg: 13 }).recomendaciones.join(" "), /entre 6 y 10 segundos se repite mejor/);
    assert.deepEqual(evaluar({ duracionSeg: 9 }).recomendaciones, []);
  });

  it("códec: HEVC (iPhone) falla con la pista de cómo arreglarlo; VP9, AV1 y los demás, también", () => {
    const hevc = evaluar({ formato: "hvc1" });
    assert.deepEqual(ids(hevc), ["codec"]);
    assert.match(hevc.fallos[0].detalle, /H\.265 \(HEVC\), el formato de los iPhone/);
    assert.match(hevc.fallos[0].arreglo ?? "", /Más compatible/);
    for (const formato of ["vp09", "av01", "mp4v", "apch", "zzzz"]) assert.deepEqual(ids(evaluar({ formato })), ["codec"], formato);
  });

  it("perfil: H.264 de 10 bits o 4:2:2 falla; nivel mayor a 4.2 falla; Baseline, Main y High pasan", () => {
    for (const perfilAvc of [66, 77, 100]) assert.equal(evaluar({ perfilAvc }).cumple, true, `perfil ${perfilAvc}`);
    for (const perfilAvc of [110, 122, 244]) assert.deepEqual(ids(evaluar({ perfilAvc })), ["perfil"], `perfil ${perfilAvc}`);
    assert.deepEqual(ids(evaluar({ nivelAvc: 51 })), ["perfil"]);
    assert.equal(evaluar({ nivelAvc: 42 }).cumple, true);
    assert.match(evaluar({ perfilAvc: 110 }).fallos[0].detalle, /Perfil High 10/);
  });

  it("sonido: una pista de audio falla y explica el motivo de privacidad", () => {
    const r = evaluar({ audio: true });
    assert.deepEqual(ids(r), ["sonido"]);
    assert.match(r.fallos[0].arreglo ?? "", /cualquiera podría descargarlo/);
  });

  it("fotogramas: 60 fps falla; 24, 29,97 y 30 pasan", () => {
    assert.deepEqual(ids(evaluar({ fps: 60 })), ["fotogramas"]);
    for (const fps of [24, 25, 29.97, 30]) assert.equal(evaluar({ fps }).cumple, true, `${fps} fps`);
  });

  it("medidas: demasiado grande (4K) o demasiado pequeño (360p) falla con el motivo; con la proporción correcta no hay aviso de proporción", () => {
    const grande = evaluar({ ancho: 3840, alto: 2160 });
    assert.deepEqual(ids(grande), ["medidas"]);
    assert.match(grande.fallos[0].arreglo ?? "", /Es demasiado grande: redúcelo a 1280×720/);
    const chico = evaluar({ ancho: 640, alto: 360 });
    assert.deepEqual(ids(chico), ["medidas"]);
    assert.match(chico.fallos[0].arreglo ?? "", /demasiado pequeño y se vería borroso: usa al menos 960×540/);
    assert.equal(evaluar({ ancho: 1920, alto: 1080 }).cumple, true);
    assert.equal(evaluar({ ancho: 960, alto: 540 }).cumple, true);
  });

  it("proporción: un 4:3 o un cuadrado no sirven para un espacio 16:9 y se dice la proporción buscada", () => {
    const r = evaluar({ ancho: 1280, alto: 960 });
    assert.ok(ids(r).includes("proporcion"));
    assert.match(r.fallos.find((f) => f.id === "proporcion")?.arreglo ?? "", /Recorta el video a 16:9 \(lo ideal: 1280×720\)/);
    assert.match(r.fallos.find((f) => f.id === "proporcion")?.detalle ?? "", /1280×960/);
  });

  it("un video de celular (horizontal guardado con giro) se evalúa por cómo se ve: vertical", () => {
    const celular = evaluar({ ancho: 1280, alto: 720, giro: 90 }, "portada.vertical");
    assert.equal(celular.cumple, true, JSON.stringify(celular.fallos));
    const enHorizontal = evaluar({ ancho: 1280, alto: 720, giro: 90 }, "portada.horizontal");
    assert.ok(ids(enHorizontal).includes("proporcion"));
  });

  it("un MP4 fragmentado falla (estructura), y su duración en cero se dice «no se pudo leer», no «dura 0 s»", () => {
    assert.ok(ids(evaluar({ fragmentado: true })).includes("estructura"));
    const r = evaluar({ fragmentado: true, duracionSeg: 0 });
    assert.ok(ids(r).includes("estructura"));
    assert.equal(r.fallos.find((f) => f.id === "duracion")?.detalle, "No se pudo leer la duración.");
  });

  it("el índice al final NO es un fallo: el sistema lo corrige solo y se lo dice", () => {
    const r = evaluar({ moovAlFinal: true });
    assert.equal(r.cumple, true);
    assert.equal(r.seCorrigeSolo.length, 1);
    assert.match(r.seCorrigeSolo[0], /se mueve al principio automáticamente/);
  });

  it("varios fallos a la vez salen todos juntos (no uno por uno)", () => {
    const r = evaluar({ formato: "hvc1", audio: true, fps: 60, duracionSeg: 30, ancho: 3840, alto: 2160 });
    assert.deepEqual(ids(r), ["codec", "duracion", "fotogramas", "medidas", "sonido"]);
    assert.equal(r.cumple, false);
  });
});

describe("lo que no se puede leer", () => {
  it("un archivo que no es un video falla solo por formato (y se dice cuánto pesa): no se llena de avisos que no sirven", () => {
    const r = evaluarVideo(analizarMp4(new TextEncoder().encode("hola".repeat(100))), "portada.horizontal");
    assert.deepEqual(r.comprobaciones.map((c) => c.id), ["formato", "peso"]);
    assert.equal(r.cumple, false);
    assert.match(r.fallos[0].detalle, /no es un video MP4/);
    assert.match(r.fallos[0].arreglo ?? "", /HandBrake, CapCut, Canva/);
  });

  it("un archivo pesado que además no es un video dice las dos cosas", () => {
    const grande = new Uint8Array(4 * MB);
    const r = evaluarVideo(analizarMp4(grande), "portada.horizontal");
    assert.deepEqual(ids(r), ["formato", "peso"]);
  });

  it("un archivo cortado dice que está incompleto", () => {
    const b = crearMp4({ moovAlFinal: true });
    const r = evaluarVideo(analizarMp4(b.slice(0, b.byteLength - 30)), "portada.horizontal");
    assert.match(r.fallos[0].detalle, /incompleto o dañado/);
  });
});

describe("la comprobación del navegador", () => {
  const bueno = () => evaluar({});

  it("si el navegador abre el video y toma la imagen fija, se suma una comprobación que pasa y todo sigue cumpliendo", () => {
    const r = agregarComprobacionNavegador(bueno(), { reproducible: true, imagenFija: true });
    const nav = r.comprobaciones.find((c) => c.id === "navegador");
    assert.ok(nav && nav.ok);
    assert.equal(nav.titulo, "Se reproduce en tu navegador");
    assert.equal(r.cumple, true);
    assert.deepEqual(r.fallos, []);
    assert.equal(r.comprobaciones.length, bueno().comprobaciones.length + 1);
  });

  it("si el navegador no lo abre, el video NO cumple y se explica qué hacer", () => {
    const r = agregarComprobacionNavegador(bueno(), { reproducible: false, imagenFija: false });
    assert.equal(r.cumple, false);
    assert.deepEqual(ids(r), ["navegador"]);
    assert.equal(r.fallos[0].detalle, "Tu navegador no pudo abrirlo.");
    assert.match(r.fallos[0].arreglo ?? "", /Expórtalo de nuevo como MP4/);
  });

  it("si lo abre pero no se puede tomar la imagen fija, tampoco cumple (la tienda la necesita)", () => {
    const r = agregarComprobacionNavegador(bueno(), { reproducible: true, imagenFija: false });
    assert.equal(r.cumple, false);
    assert.equal(r.fallos[0].detalle, "Se abrió, pero no se pudo tomar la imagen fija.");
  });

  it("lo que ya fallaba sigue fallando, y el navegador se suma a la lista sin ocultarlo", () => {
    const r = agregarComprobacionNavegador(evaluar({ audio: true }), { reproducible: true, imagenFija: true });
    assert.deepEqual(ids(r), ["sonido"]);
    assert.equal(r.cumple, false);
    assert.ok(r.comprobaciones.some((c) => c.id === "navegador" && c.ok));
  });

  it("si el archivo ni siquiera se pudo leer como un MP4, no se le pregunta nada al navegador y el resultado queda igual", () => {
    const ilegible = evaluarVideo(analizarMp4(new TextEncoder().encode("esto no es un video ".repeat(30))), "portada.horizontal");
    assert.equal(agregarComprobacionNavegador(ilegible, { reproducible: false, imagenFija: false }), ilegible);
  });

  it("no cambia el resultado original", () => {
    const original = bueno();
    const copia = structuredClone(original);
    agregarComprobacionNavegador(original, { reproducible: false, imagenFija: false });
    assert.deepEqual(original, copia);
  });
});

describe("textos auxiliares", () => {
  it("el peso se dice en MB con coma decimal o en KB", () => {
    assert.equal(pesoLegible(1_468_006), "1,4 MB");
    assert.equal(pesoLegible(3 * MB), "3 MB");
    assert.equal(pesoLegible(900_000), "0,9 MB");
    assert.equal(pesoLegible(400_000), "391 KB");
    assert.equal(pesoLegible(10), "1 KB");
    assert.equal(pesoLegible(2.5 * MB), "2,5 MB");
  });

  it("en una frase, justo por encima del tope se dice «un poco más de 3 MB» y en el resto igual que el peso", () => {
    assert.equal(pesoDicho(3 * MB), "3 MB", "justo el tope sí cumple");
    assert.equal(pesoDicho(3 * MB + 1), "un poco más de 3 MB");
    assert.equal(pesoDicho(3.04 * MB), "un poco más de 3 MB");
    assert.equal(pesoDicho(3.2 * MB), "3,2 MB");
    assert.equal(pesoDicho(1_468_006), "1,4 MB");
    assert.equal(pesoDicho(2.99 * MB), "3 MB", "por debajo del tope nunca se dice «más de»");
  });

  it("el comando de ffmpeg de cada archivo usa SUS medidas, sin sonido, 30 fps, H.264 principal e índice al principio", () => {
    for (const id of ARCHIVOS_VIDEO) {
      const { ideal } = ESPECIFICACIONES[id];
      const c = comandoFfmpeg(id);
      assert.ok(c.includes(`scale=${ideal.ancho}:${ideal.alto}`) && c.includes(`crop=${ideal.ancho}:${ideal.alto}`), id);
      for (const parte of ["-an", "-t 10", "fps=30", "libx264", "-profile:v main", "yuv420p", "-movflags +faststart", "-maxrate 1500k"]) assert.ok(c.includes(parte), `${id}: ${parte}`);
    }
  });
});

describe("no hay comprobaciones sin identificar", () => {
  it("todas las comprobaciones que devuelve son de la lista conocida", () => {
    const conocidas: IdComprobacion[] = ["formato", "peso", "duracion", "codec", "perfil", "sonido", "fotogramas", "proporcion", "medidas", "estructura", "navegador"];
    const r = evaluar({ formato: "hvc1", audio: true });
    for (const c of r.comprobaciones) assert.ok(conocidas.includes(c.id), c.id);
  });
});
