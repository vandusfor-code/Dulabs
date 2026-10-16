/**
 * Análisis de un MP4 (video-mp4.ts). Dos fuentes: los videos REALES de la tienda de Delacour (public/catalogo/delacour/video: H.264, sin sonido, índice al principio) y MP4 sintéticos
 * (testing/mp4.ts) para cada forma de que un video no sirva o venga distinto. Y lo más importante de un lector de archivos ajenos: que NUNCA lance ni se cuelgue con basura.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ajustarDesplazamientos, analizarMp4, optimizarParaWeb } from "@/lib/cms-comercial/video-mp4";
import { cajasDeArchivo, conCajaAlFinal, crearMp4, moovConCo64, moverIndiceAlFinal } from "@/lib/cms-comercial/testing/mp4";

const CARPETA = path.join(process.cwd(), "public", "catalogo", "delacour", "video");
const reales = readdirSync(CARPETA).filter((f) => f.endsWith(".mp4")).sort();
const MEDIDAS: Record<string, [number, number]> = {
  "coleccion-h.mp4": [1280, 720],
  "coleccion-v.mp4": [720, 1280],
  "marca.mp4": [720, 900],
  "mayoristas.mp4": [1280, 576],
  "portada-h.mp4": [1280, 720],
  "portada-v.mp4": [720, 1280],
};
const leer = (nombre: string) => new Uint8Array(readFileSync(path.join(CARPETA, nombre)));

describe("los videos reales de la tienda (la referencia de lo que sí sirve)", () => {
  it("hay seis y cada uno se lee completo: H.264, sin sonido, índice al principio, no fragmentado", () => {
    assert.deepEqual(reales, Object.keys(MEDIDAS).sort());
    for (const nombre of reales) {
      const a = analizarMp4(leer(nombre));
      assert.equal(a.legible, true, `${nombre}: ${a.problemas.join(",")}`);
      assert.equal(a.video?.codec, "h264", nombre);
      assert.equal(a.tieneAudio, false, nombre);
      assert.equal(a.indiceAlPrincipio, true, nombre);
      assert.equal(a.fragmentado, false, nombre);
      assert.equal(a.otrasPistas, 0, nombre);
    }
  });

  it("las medidas de pantalla, la duración y los fotogramas por segundo coinciden con lo declarado", () => {
    for (const nombre of reales) {
      const a = analizarMp4(leer(nombre));
      assert.deepEqual([a.video?.ancho, a.video?.alto], MEDIDAS[nombre], nombre);
      assert.ok((a.duracionSeg ?? 0) >= 4 && (a.duracionSeg ?? 99) <= 15, `${nombre}: ${a.duracionSeg} s`);
      assert.ok(Math.abs((a.video?.fps ?? 0) - 30) < 1, `${nombre}: ${a.video?.fps} fps`);
      assert.ok(a.video?.perfilAvc !== null && [66, 77, 100].includes(a.video?.perfilAvc ?? 0), `${nombre}: perfil ${a.video?.perfilAvc}`);
      assert.ok((a.video?.nivelAvc ?? 99) <= 42, `${nombre}: nivel ${a.video?.nivelAvc}`);
    }
  });
});

describe("un MP4 típico", () => {
  it("por defecto: H.264 de 1280×720, 8 s, 30 fps, sin sonido, índice al principio", () => {
    const a = analizarMp4(crearMp4());
    assert.equal(a.legible, true);
    assert.deepEqual([a.video?.codec, a.video?.ancho, a.video?.alto, a.video?.giro], ["h264", 1280, 720, 0]);
    assert.equal(a.duracionSeg, 8);
    assert.equal(Math.round(a.video?.fps ?? 0), 30);
    assert.equal(a.video?.muestras, 240);
    assert.deepEqual([a.tieneAudio, a.indiceAlPrincipio, a.fragmentado, a.marca], [false, true, false, "isom"]);
  });

  it("lee el perfil y el nivel de H.264", () => {
    const a = analizarMp4(crearMp4({ perfilAvc: 110, nivelAvc: 51 }));
    assert.deepEqual([a.video?.perfilAvc, a.video?.nivelAvc], [110, 51]);
  });

  it("lee también las cajas de versión 1 (tiempos de 64 bits) y los desplazamientos co64", () => {
    const a = analizarMp4(crearMp4({ version1: true, co64: true, duracionSeg: 10 }));
    assert.equal(a.legible, true);
    assert.deepEqual([a.duracionSeg, a.video?.ancho, a.video?.alto], [10, 1280, 720]);
  });
});

describe("los códecs", () => {
  it("distingue H.264, HEVC (el de los iPhone), VP9, AV1 y los que no conoce", () => {
    for (const [formato, codec] of [["avc1", "h264"], ["avc3", "h264"], ["hvc1", "hevc"], ["hev1", "hevc"], ["vp09", "vp9"], ["av01", "av1"], ["mp4v", "mpeg4"], ["apch", "prores"], ["xyzw", "otro"]] as const) {
      const a = analizarMp4(crearMp4({ formato }));
      assert.equal(a.video?.codec, codec, formato);
      assert.equal(a.video?.formato, formato);
    }
  });
});

describe("el giro de los videos grabados con el celular", () => {
  it("un video horizontal guardado con giro de 90° se muestra vertical: las medidas de pantalla se intercambian", () => {
    const a = analizarMp4(crearMp4({ ancho: 1920, alto: 1080, giro: 90 }));
    assert.deepEqual([a.video?.ancho, a.video?.alto, a.video?.giro], [1080, 1920, 90]);
  });

  it("270° también se intercambia; 180° y 0° no", () => {
    assert.deepEqual([analizarMp4(crearMp4({ ancho: 1920, alto: 1080, giro: 270 })).video?.ancho, analizarMp4(crearMp4({ ancho: 1920, alto: 1080, giro: 270 })).video?.alto], [1080, 1920]);
    const g180 = analizarMp4(crearMp4({ ancho: 1920, alto: 1080, giro: 180 }));
    assert.deepEqual([g180.video?.ancho, g180.video?.alto, g180.video?.giro], [1920, 1080, 180]);
    const g0 = analizarMp4(crearMp4({ ancho: 1920, alto: 1080, giro: 0 }));
    assert.deepEqual([g0.video?.ancho, g0.video?.alto, g0.video?.giro], [1920, 1080, 0]);
  });
});

describe("sonido y otras pistas", () => {
  it("detecta una pista de audio (por privacidad y peso no se admite: la decisión es de requisitos, aquí solo se informa)", () => {
    const a = analizarMp4(crearMp4({ audio: true }));
    assert.equal(a.tieneAudio, true);
    assert.deepEqual(a.pistas.map((p) => p.tipo), ["video", "audio"]);
    assert.equal(a.video?.codec, "h264", "la pista de video sigue siendo la primera de video");
  });

  it("cuenta las pistas que no son de video ni de audio (subtítulos, metadatos)", () => {
    const a = analizarMp4(crearMp4({ otrasPistas: 2 }));
    assert.equal(a.otrasPistas, 2);
    assert.equal(a.tieneAudio, false);
  });
});

describe("el índice y la estructura", () => {
  it("índice al final: se avisa (el video no empieza a verse hasta bajar entero)", () => {
    const a = analizarMp4(crearMp4({ moovAlFinal: true }));
    assert.equal(a.legible, true);
    assert.equal(a.indiceAlPrincipio, false);
  });

  it("un MP4 fragmentado (por trozos, para transmisión) se reconoce", () => {
    assert.equal(analizarMp4(crearMp4({ fragmentado: true })).fragmentado, true);
  });

  it("un archivo cortado a la mitad se reconoce como truncado y no es legible", () => {
    const completo = crearMp4({ moovAlFinal: true });
    const a = analizarMp4(completo.slice(0, completo.byteLength - 40));
    assert.equal(a.legible, false);
    assert.ok(a.problemas.includes("truncado"), a.problemas.join(","));
  });

  it("sin índice (moov) o sin datos (mdat) no es legible, y lo dice", () => {
    const ftyp = crearMp4({ bytesDeDatos: 10 }).slice(0, 8 + 4 + 4 + 4 * 4 + 4); // solo hasta donde cierra ftyp
    const soloFtyp = analizarMp4(Uint8Array.from([0, 0, 0, 24, ...Array.from("ftypisom", (c) => c.charCodeAt(0)), 0, 0, 2, 0, ...Array.from("isomiso2", (c) => c.charCodeAt(0))]));
    assert.equal(soloFtyp.legible, false);
    assert.ok(soloFtyp.problemas.includes("sin_moov") && soloFtyp.problemas.includes("sin_mdat"), soloFtyp.problemas.join(","));
    void ftyp;
  });
});

describe("lo que no es un MP4", () => {
  const casos: Array<[string, Uint8Array]> = [
    ["vacío", new Uint8Array(0)],
    ["muy corto", Uint8Array.from([0, 0, 0, 8])],
    ["texto", new TextEncoder().encode("Esto no es un video, es una carta de amor.".repeat(5))],
    ["un JPG", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(1)])],
    ["un PNG", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(60).fill(2)])],
    ["un WebM", Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, ...new Array(60).fill(3)])],
    ["un AVI", new TextEncoder().encode("RIFF\0\0\0\0AVI LIST".padEnd(64, "x"))],
  ];
  for (const [nombre, bytes] of casos) {
    it(`${nombre}: no es legible y se dice que no es un MP4, sin lanzar`, () => {
      const a = analizarMp4(bytes);
      assert.equal(a.legible, false);
      assert.deepEqual(a.problemas, ["no_es_mp4"]);
      assert.equal(a.video, null);
    });
  }
});

describe("archivos hostiles o dañados: nunca lanza, nunca se cuelga", () => {
  it("una caja que dice ser enorme (más que el archivo) se marca truncada", () => {
    const a = crearMp4();
    const copia = a.slice();
    new DataView(copia.buffer).setUint32(0, 0xffff_fff0); // el tamaño de ftyp
    const r = analizarMp4(copia);
    assert.equal(r.legible, false);
  });

  it("tamaño 64 bits imposible, tamaño menor que su cabecera y cajas de tamaño cero no hacen nada raro", () => {
    for (const cabecera of [Uint8Array.from([0, 0, 0, 1, ...Array.from("ftyp", (c) => c.charCodeAt(0)), 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), Uint8Array.from([0, 0, 0, 4, ...Array.from("ftyp", (c) => c.charCodeAt(0))]), Uint8Array.from([0, 0, 0, 0, ...Array.from("ftyp", (c) => c.charCodeAt(0)), ...new Array(40).fill(0)])]) {
      const r = analizarMp4(cabecera);
      assert.equal(r.legible, false);
    }
  });

  it("mil archivos válidos con un byte cambiado al azar: siempre devuelve un resultado completo, sin lanzar", () => {
    const base = crearMp4({ audio: true, otrasPistas: 1, moovAlFinal: true });
    let semilla = 12345;
    const azar = () => {
      semilla = (semilla * 1103515245 + 12345) & 0x7fff_ffff;
      return semilla;
    };
    for (let i = 0; i < 1000; i++) {
      const copia = base.slice();
      const cambios = 1 + (azar() % 4);
      for (let k = 0; k < cambios; k++) copia[azar() % copia.length] = azar() & 0xff;
      const r = analizarMp4(copia);
      assert.equal(typeof r.legible, "boolean");
      assert.ok(Array.isArray(r.pistas) && Array.isArray(r.problemas));
      for (const p of r.pistas) {
        assert.ok(p.ancho === null || Number.isFinite(p.ancho));
        assert.ok(p.fps === null || Number.isFinite(p.fps));
      }
    }
  });

  it("cortes en cada posición de un archivo válido: nunca lanza", () => {
    const base = crearMp4({ audio: true });
    for (let n = 0; n <= base.byteLength; n += 7) assert.doesNotThrow(() => analizarMp4(base.slice(0, n)));
  });

  it("una cantidad absurda de cajas se corta con un aviso (no se queda procesando)", () => {
    const cajita = Uint8Array.from([0, 0, 0, 8, ...Array.from("free", (c) => c.charCodeAt(0))]);
    const cabeza = crearMp4({ bytesDeDatos: 8 }).slice(0, 36);
    const mucho = new Uint8Array(cabeza.byteLength + cajita.byteLength * 30_000);
    mucho.set(cabeza, 0);
    for (let i = 0; i < 30_000; i++) mucho.set(cajita, cabeza.byteLength + i * 8);
    const inicio = Date.now();
    const r = analizarMp4(mucho);
    assert.ok(Date.now() - inicio < 2000, "termina rápido");
    assert.equal(r.legible, false);
  });
});

describe("optimizar para la web (mover el índice al principio)", () => {
  it("si el índice ya va al principio, devuelve exactamente los mismos bytes", () => {
    const b = crearMp4();
    assert.equal(optimizarParaWeb(b), b);
  });

  it("con el índice al final lo mueve al principio y todo lo demás queda igual: mismas pistas, medidas, duración y datos", () => {
    const alFinal = crearMp4({ moovAlFinal: true, audio: true, otrasPistas: 1, bytesDeDatos: 5000 });
    assert.equal(analizarMp4(alFinal).indiceAlPrincipio, false);
    const optimizado = optimizarParaWeb(alFinal);
    assert.ok(optimizado && optimizado !== alFinal);
    const antes = analizarMp4(alFinal);
    const despues = analizarMp4(optimizado);
    assert.equal(despues.indiceAlPrincipio, true);
    assert.equal(optimizado.byteLength, alFinal.byteLength, "no cambia el peso: solo reordena");
    assert.deepEqual({ ...despues, indiceAlPrincipio: false }, { ...antes });
    // los datos (mdat) siguen intactos
    const mdatAntes = cajasDeArchivo(alFinal).find((x) => x.tipo === "mdat");
    const mdatDespues = cajasDeArchivo(optimizado).find((x) => x.tipo === "mdat");
    assert.ok(mdatAntes && mdatDespues);
    assert.deepEqual(optimizado.subarray(mdatDespues.inicio, mdatDespues.fin), alFinal.subarray(mdatAntes.inicio, mdatAntes.fin));
  });

  it("corrige los desplazamientos: cada pista sigue apuntando a SU parte de los datos (con 32 y con 64 bits)", () => {
    for (const co64 of [false, true]) {
      const alFinal = crearMp4({ moovAlFinal: true, audio: true, bytesDeDatos: 2000, co64 });
      const optimizado = optimizarParaWeb(alFinal);
      assert.ok(optimizado);
      const mdat = cajasDeArchivo(optimizado).find((x) => x.tipo === "mdat");
      assert.ok(mdat);
      // en el archivo sintético, el video apunta al inicio de los datos y el audio 500 bytes después
      const texto = new TextDecoder("latin1").decode(optimizado);
      const donde = (tipo: string) => [...texto.matchAll(new RegExp(tipo, "g"))].map((m) => m.index as number);
      const v = new DataView(optimizado.buffer, optimizado.byteOffset, optimizado.byteLength);
      const posiciones = donde(co64 ? "co64" : "stco");
      assert.equal(posiciones.length, 2);
      const leerOffset = (i: number) => (co64 ? v.getUint32(i + 4 + 4 + 4 + 4) : v.getUint32(i + 4 + 4 + 4));
      assert.deepEqual(posiciones.map(leerOffset), [mdat.inicio + 8, mdat.inicio + 8 + 500]);
    }
  });

  it("con un video REAL: sacarle el índice del principio y optimizarlo devuelve el archivo original byte por byte", () => {
    for (const nombre of reales) {
      const original = leer(nombre);
      const alFinal = moverIndiceAlFinal(original);
      assert.equal(analizarMp4(alFinal).indiceAlPrincipio, false, nombre);
      assert.equal(analizarMp4(alFinal).legible, true, nombre);
      const arreglado = optimizarParaWeb(alFinal);
      assert.ok(arreglado, nombre);
      assert.deepEqual(arreglado, original, `${nombre}: debe quedar idéntico al original`);
    }
  });

  it("devuelve null cuando no se puede hacer con seguridad: varios mdat, fragmentado, cortado, sin ftyp al principio, basura", () => {
    const doble = crearMp4({ moovAlFinal: true });
    const dos = new Uint8Array(doble.byteLength + 18);
    dos.set(doble, 0);
    dos.set(Uint8Array.from([0, 0, 0, 18, ...Array.from("mdat", (c) => c.charCodeAt(0)), ...new Array(10).fill(7)]), doble.byteLength);
    assert.equal(optimizarParaWeb(dos), null, "dos mdat");
    assert.equal(optimizarParaWeb(crearMp4({ fragmentado: true, moovAlFinal: true })), null, "fragmentado");
    const cortado = crearMp4({ moovAlFinal: true });
    assert.equal(optimizarParaWeb(cortado.slice(0, cortado.byteLength - 10)), null, "cortado");
    assert.equal(optimizarParaWeb(new Uint8Array(0)), null);
    assert.equal(optimizarParaWeb(new TextEncoder().encode("hola".repeat(50))), null);
  });

  it("un desplazamiento que no cabe en 32 bits tras moverlo no se escribe (null), y uno negativo tampoco", () => {
    const ocupado = crearMp4({ moovAlFinal: true });
    const c = cajasDeArchivo(ocupado).find((x) => x.tipo === "moov");
    assert.ok(c);
    const copia = ocupado.slice(c.inicio, c.fin);
    assert.equal(ajustarDesplazamientos(copia, 0xffff_ffff), false);
    assert.equal(ajustarDesplazamientos(ocupado.slice(c.inicio, c.fin), -0x7fff_ffff), false);
    assert.equal(ajustarDesplazamientos(Uint8Array.from([1, 2, 3]), 1), false, "no es un índice");
  });

  it("no altera el archivo que recibe", () => {
    const alFinal = crearMp4({ moovAlFinal: true });
    const copia = alFinal.slice();
    optimizarParaWeb(alFinal);
    assert.deepEqual(alFinal, copia);
  });

  it("un fragmento (moof) o una caja cortada al final impiden reordenar aunque todo lo demás esté bien (un solo mdat, índice al principio)", () => {
    const sano = crearMp4();
    assert.equal(optimizarParaWeb(sano), sano, "sin nada raro devuelve los mismos bytes");
    assert.equal(optimizarParaWeb(conCajaAlFinal(sano, "moof")), null, "con un fragmento");
    const cortada = conCajaAlFinal(sano, "free", 40);
    assert.equal(optimizarParaWeb(cortada.slice(0, cortada.byteLength - 10)), null, "con una caja cortada al final");
    const conRelleno = conCajaAlFinal(sano, "free", 40);
    assert.equal(optimizarParaWeb(conRelleno), conRelleno, "un relleno completo al final no es un problema");
  });
});

describe("lo que el análisis dice de archivos que sirven de poco", () => {
  it("un fragmento (moof) marca el MP4 como fragmentado aunque el índice no tenga la caja mvex", () => {
    const solo = conCajaAlFinal(crearMp4(), "moof");
    const a = analizarMp4(solo);
    assert.equal(a.fragmentado, true);
    assert.equal(analizarMp4(crearMp4()).fragmentado, false, "sin fragmentos, no");
  });

  it("un índice sin ninguna pista no es un MP4 legible (no hay nada que mostrar) y lo dice", () => {
    const a = analizarMp4(crearMp4({ sinPistas: true }));
    assert.equal(a.legible, false);
    assert.ok(a.problemas.includes("sin_pistas"));
    assert.equal(a.video, null);
    assert.deepEqual(a.pistas, []);
  });
});

describe("desplazamientos de 64 bits (co64) al mover el índice", () => {
  const leer64 = (b: Uint8Array, desde: number) => {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return v.getUint32(desde) * 0x1_0000_0000 + v.getUint32(desde + 4);
  };
  // moov(8) › trak(8) › mdia(8) › minf(8) › stbl(8) › co64: cabecera (8) + versión (4) + cantidad (4) = las posiciones empiezan en el byte 56.
  const PRIMERA = 56;

  it("suman el desplazamiento completo, también la parte alta (más de 4 GB)", () => {
    const moov = moovConCo64([0x1_0000_0010, 0xffff_ffff, 100]);
    assert.equal(ajustarDesplazamientos(moov, 100), true);
    assert.equal(leer64(moov, PRIMERA), 0x1_0000_0074);
    assert.equal(leer64(moov, PRIMERA + 8), 0x1_0000_0063, "cruza los 4 GB: la parte baja da la vuelta y la alta sube");
    assert.equal(leer64(moov, PRIMERA + 16), 200);
  });

  it("restan igual de bien al bajar de los 4 GB, y uno que quedaría negativo se rechaza", () => {
    const moov = moovConCo64([0x1_0000_0010, 0x1_0000_0020]);
    assert.equal(ajustarDesplazamientos(moov, -0x10), true);
    assert.equal(leer64(moov, PRIMERA), 0x1_0000_0000);
    assert.equal(leer64(moov, PRIMERA + 8), 0x1_0000_0010);
    assert.equal(ajustarDesplazamientos(moovConCo64([5]), -10), false);
  });
});
