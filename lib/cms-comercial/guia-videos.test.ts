/**
 * La guía de fotos y videos (docs/TIENDA_FOTOS_Y_VIDEOS.md) no se puede quedar atrás del sistema: cada medida, cada límite y cada comando que dice la guía se compara con el código
 * (video-requisitos.ts y los topes del servicio). Si alguien cambia un límite y no actualiza la guía —que es lo que lee la clienta—, esta prueba falla.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { MAX_CATEGORIAS_CON_IMAGEN } from "@/lib/cms-comercial/esquemas";
import { ARCHIVOS_VIDEO, ESPECIFICACIONES, IDEAL_BYTES_VIDEO, MAX_BYTES_A_LEER, MAX_BYTES_VIDEO, MAX_DURACION_SEG, MAX_FPS, MAX_NIVEL_AVC, MIN_DURACION_SEG, PERFILES_AVC, REQUISITOS_GENERALES, comandoFfmpeg, pesoLegible } from "@/lib/cms-comercial/video-requisitos";
import { LIMITE_VIDEOS } from "@/lib/cms-comercial/videos";

const guia = readFileSync(path.join(process.cwd(), "docs", "TIENDA_FOTOS_Y_VIDEOS.md"), "utf8").replace(/\r\n/g, "\n");
const lineas = new Set(guia.split("\n").map((l) => l.trim()));
const NOMBRES_PERFIL: Readonly<Record<number, string>> = { 66: "Baseline", 77: "Main", 100: "High" };

describe("la guía de fotos y videos coincide con el sistema", () => {
  it("la tabla de medidas tiene una fila por archivo, con las medidas ideales, el rango que se acepta y la proporción del código", () => {
    for (const id of ARCHIVOS_VIDEO) {
      const e = ESPECIFICACIONES[id];
      const fila = `| ${e.titulo} | ${e.ideal.ancho} × ${e.ideal.alto} | ${e.minimo.ancho} × ${e.minimo.alto} — ${e.maximo.ancho} × ${e.maximo.alto} | ${e.proporcion} |`;
      assert.ok(lineas.has(fila), `falta o está desactualizada la fila de «${e.titulo}»: ${fila}`);
    }
  });

  it("los límites generales dicen lo mismo que el código: peso, duración, fotogramas, perfil, formato y sonido", () => {
    const perfiles = PERFILES_AVC.map((p) => NOMBRES_PERFIL[p]);
    assert.ok(perfiles.every(Boolean), "cada perfil permitido tiene nombre en la guía");
    const nivel = (MAX_NIVEL_AVC / 10).toFixed(1);
    const esperadas = [
      `| Peso | hasta ${pesoLegible(MAX_BYTES_VIDEO)} por archivo (lo ideal: ${pesoLegible(IDEAL_BYTES_VIDEO)} o menos) |`,
      `| Duración | de ${MIN_DURACION_SEG} a ${MAX_DURACION_SEG} segundos (lo ideal: 6 a 10); el video se repite sin fin |`,
      `| Fotogramas | hasta ${MAX_FPS} por segundo (24 o 30) |`,
      `| Perfil de H.264 | ${perfiles.slice(0, -1).join(", ")} o ${perfiles[perfiles.length - 1]}, de 8 bits, nivel ${nivel} o menor |`,
      "| Sonido | ninguno (sin pista de audio) |",
    ];
    for (const fila of esperadas) assert.ok(lineas.has(fila), `falta o está desactualizada: ${fila}`);
    assert.ok(guia.includes("MP4 con video H.264"), "el formato");
    assert.match(REQUISITOS_GENERALES.formato, /MP4 con video H\.264/);
  });

  it("cada comando de ffmpeg de la guía es exactamente el que genera el sistema para ese tamaño (y los seis archivos quedan cubiertos)", () => {
    for (const id of ARCHIVOS_VIDEO) assert.ok(guia.includes(comandoFfmpeg(id)), `falta el comando de ${id}`);
  });

  it("los topes de la guía son los del servicio: videos por tienda, archivos que ni se abren, categorías con imagen y la reducción de las imágenes de categoría", () => {
    assert.ok(guia.includes(`Hasta ${LIMITE_VIDEOS} videos subidos por tienda`), `${LIMITE_VIDEOS} videos`);
    assert.ok(guia.includes(`más de ${MAX_BYTES_A_LEER / (1024 * 1024)} MB ni siquiera se abre`), "el archivo enorme");
    assert.ok(guia.includes(`Hasta ${MAX_CATEGORIAS_CON_IMAGEN} categorías con imagen`), "las categorías");
    assert.ok(guia.includes("960 × 1200 px") && guia.includes("600 × 750 px") && guia.includes("1200 px"), "las medidas de la imagen de categoría");
    assert.ok(guia.includes("sin texto ni collage de varias fotos"), "el consejo de la foto limpia para las categorías");
  });

  it("la guía menciona cada espacio por el nombre que le ve la administradora en el panel", () => {
    for (const id of ARCHIVOS_VIDEO) assert.ok(guia.includes(ESPECIFICACIONES[id].titulo), ESPECIFICACIONES[id].titulo);
    for (const pestana of ["Tienda → Fotos y videos", "Tienda → Página principal", "Volver al video de siempre", "Usar este video", "Elegir un video"]) assert.ok(guia.includes(pestana), pestana);
  });
});
