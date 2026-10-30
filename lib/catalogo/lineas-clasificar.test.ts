/**
 * Clasificar una pieza en una línea (Plata, Rodio, Acero, Cover Gold) desde el panel: la línea de una pieza ES el texto de su campo «Material», así que elegirla ESCRIBE ahí. Lo puro, sin red ni React:
 * qué texto queda (cambiando lo mínimo y sin perder lo que la persona escribió), que SIEMPRE quede en la línea elegida y en ninguna otra que no tuviera, que quepa en el campo, y que ubicar una palabra en el
 * texto original coincida con cómo la tienda reconoce las líneas.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CATALOG_LIMITS } from "@/lib/catalogo/domain";
import { lineasDeLaTienda } from "@/lib/catalogo/joyeria";
import {
  LARGO_MAX_MATERIAL,
  LINEA_SIN,
  coincideLinea,
  esClaveDeLinea,
  etiquetasDeLineas,
  lineasDeMaterial,
  materialConLinea,
  palabrasConPosicion,
  palabrasDe,
  type LineaConfig,
} from "@/lib/catalogo/lineas";

/** Las líneas tal como las tiene Delacour en su configuración. */
const LINEAS = lineasDeLaTienda("delacour");
const con = (material: string | null | undefined, clave: string) => materialConLinea(material, clave, LINEAS);

describe("la configuración de las líneas sirve para clasificar", () => {
  it("el tope del campo es el mismo del dominio (si uno cambia, el otro también)", () => {
    assert.equal(LARGO_MAX_MATERIAL, CATALOG_LIMITS.material);
  });

  it("cada línea se reconoce a sí misma por su nombre, ninguna usa la clave del filtro «sin línea» y todas son claves válidas", () => {
    assert.deepEqual(LINEAS.map((l) => l.etiqueta), ["Plata", "Rodio", "Acero", "Cover Gold"]);
    for (const l of LINEAS) {
      assert.ok(coincideLinea(l.etiqueta, l), `«${l.etiqueta}» no se reconoce como ${l.clave}`);
      assert.notEqual(l.clave, LINEA_SIN);
      assert.ok(esClaveDeLinea(l.clave));
    }
  });
});

describe("materialConLinea: qué texto queda", () => {
  it("sin material (vacío, solo espacios o nulo) queda el nombre de la línea", () => {
    for (const vacio of [null, undefined, "", "   "]) {
      assert.equal(con(vacio, "plata"), "Plata");
      assert.equal(con(vacio, "cover-gold"), "Cover Gold");
    }
  });

  it("si la pieza YA está en esa línea no se toca ni una letra (ni los espacios)", () => {
    for (const material of ["Rodio", "Rodio · 3cm", "RODIO", " rodio ", "Rodío", "Cover-Gold", "COVERGOLD", "Plata 925"]) {
      const clave = lineasDeMaterial(material, LINEAS)[0];
      assert.equal(con(material, clave), material, `«${material}»`);
    }
    assert.equal(con("Acero y Rodio", "rodio"), "Acero y Rodio", "estando en dos líneas, elegir una de ellas no cambia nada");
  });

  it("con un material que no es de ninguna línea se le pone la línea delante y NO se pierde lo escrito", () => {
    assert.equal(con("Oro laminado 18k", "cover-gold"), "Cover Gold · Oro laminado 18k");
    assert.equal(con("Plateado", "plata"), "Plata · Plateado", "«Plateado» es un color: no era Plata, y lo escrito se conserva");
    assert.equal(con("  Bañado en oro  ", "acero"), "Acero · Bañado en oro");
  });

  it("con el material de OTRA línea cambia solo esa palabra y deja el resto", () => {
    assert.equal(con("Rodio · 3cm", "plata"), "Plata · 3cm", "la medida se conserva");
    assert.equal(con("Rodio platinado", "plata"), "Plata platinado");
    assert.equal(con("COVERGOLD", "acero"), "Acero", "un alias se reconoce y se reemplaza");
    assert.equal(con("COVERGOLD 18k", "acero"), "Acero 18k", "también con el alias de una sola palabra, conservando el resto");
    assert.equal(con("Cover-Gold 18k", "plata"), "Plata 18k", "una línea de dos palabras se cambia completa");
    assert.equal(con("Rodio y más Rodio", "acero"), "Acero y más Acero", "cada aparición, para que la pieza no siga en la línea anterior");
  });

  it("con el material de varias líneas queda solo el nombre de la elegida", () => {
    assert.equal(con("Acero y Rodio", "plata"), "Plata");
    assert.equal(con("Rodio · Acero · Plata", "cover-gold"), "Cover Gold");
  });

  it("una clave que no es de la configuración no cambia nada (ni se inventa una línea)", () => {
    for (const material of [null, "", "Plata 925", "Oro"]) {
      assert.equal(con(material, "oro"), material ?? "");
      assert.equal(con(material, LINEA_SIN), material ?? "");
    }
    assert.equal(materialConLinea("Oro", "plata", []), "Oro", "un negocio sin líneas nunca cambia el material");
  });

  it("un material «pegado» con puntuación sin espacios (Rodio·3cm) no es de Rodio para la tienda: se trata como cualquier otro texto", () => {
    assert.deepEqual(lineasDeMaterial("Rodio·3cm", LINEAS), []);
    assert.equal(con("Rodio·3cm", "plata"), "Plata · Rodio·3cm");
  });
});

describe("materialConLinea: siempre cabe y siempre queda bien", () => {
  it("un material largo se recorta sin dejar un pedazo de palabra que se lea como otra línea", () => {
    const resto = LARGO_MAX_MATERIAL - "Acero".length - " · ".length;
    // 66 letras + « Rodio» + «sa»: el recorte caería justo después de «Rodio», que sin las dos letras finales sería OTRA línea.
    const material = "x".repeat(resto - 6) + " Rodiosa";
    assert.ok(material.length > resto);
    assert.deepEqual(lineasDeMaterial(material, LINEAS), [], "«Rodiosa» no es Rodio");
    const nuevo = con(material, "acero");
    assert.ok(nuevo.length <= LARGO_MAX_MATERIAL);
    assert.deepEqual(lineasDeMaterial(nuevo, LINEAS), ["acero"], "el pedazo «Rodio» no puede convertir la pieza en Rodio también");
    assert.ok(nuevo.startsWith("Acero · xxx"));
  });

  it("si lo escrito no cabe en nada (una sola palabra enorme) queda solo el nombre de la línea", () => {
    assert.equal(con("y".repeat(100), "plata"), "Plata");
  });

  it("nunca corta un emoji por la mitad al recortar", () => {
    const nuevo = con("🙂".repeat(60), "plata");
    assert.ok(nuevo.startsWith("Plata · 🙂"));
    assert.ok(nuevo.length <= LARGO_MAX_MATERIAL);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(nuevo), "sin mitades de carácter (surrogates sueltos)");
    assert.deepEqual(lineasDeMaterial(nuevo, LINEAS), ["plata"]);
  });

  it("un material ya de 80 letras con otra línea sigue cabiendo", () => {
    const material = "Rodio " + "z".repeat(74);
    assert.equal(material.length, LARGO_MAX_MATERIAL);
    const nuevo = con(material, "cover-gold");
    assert.ok(nuevo.length <= LARGO_MAX_MATERIAL, `${nuevo.length} letras`);
    assert.deepEqual(lineasDeMaterial(nuevo, LINEAS), ["cover-gold"]);
  });

  it("para CUALQUIER material y CUALQUIER línea: queda en la elegida, cabe, no gana otras líneas, quita la anterior y repetir no cambia nada", () => {
    const materiales: Array<string | null> = [
      null, "", "  ", "Rodio", "Rodio · 3cm", "Rodio platinado", "RODIO", "Plata 925", "Plateado", "Acero quirúrgico", "Acero y Rodio", "Cover-Gold", "COVERGOLD", "cover gold",
      "Oro laminado 18k", "Bañado en oro", "Rodio · Acero · Plata", "Plata Plata", "plata, rodio", "ÁCERO", "Rodío", "Rodio·3cm", "Platería fina", "Covergolden", "x".repeat(80), "Rodio " + "z".repeat(74),
      "Cover Gold " + "q".repeat(60), "añejo", "plata\ty\nrodio", "🙂 Plata 🙂", "Acero-inoxidable", "R0dio",
    ];
    for (const material of materiales) {
      for (const linea of LINEAS) {
        const nuevo = materialConLinea(material, linea.clave, LINEAS);
        const antes = lineasDeMaterial(material, LINEAS);
        const despues = lineasDeMaterial(nuevo, LINEAS);
        const caso = `«${material}» + ${linea.clave} -> «${nuevo}»`;
        assert.ok(coincideLinea(nuevo, linea), `no quedó en la línea elegida: ${caso}`);
        assert.ok(nuevo.length <= LARGO_MAX_MATERIAL || nuevo === (material ?? ""), `no cabe: ${caso}`);
        assert.ok(despues.every((c) => c === linea.clave || antes.includes(c)), `ganó otra línea: ${caso}`);
        if (antes.length === 1 && antes[0] !== linea.clave) assert.ok(!despues.includes(antes[0]), `siguió en la línea anterior: ${caso}`);
        assert.equal(materialConLinea(nuevo, linea.clave, LINEAS), nuevo, `no es estable: ${caso}`);
      }
    }
  });

  it("si los alias de una línea no reconocen su propio nombre, se escribe con su primer alias (para que SIEMPRE quede en la línea)", () => {
    const rara: LineaConfig[] = [{ clave: "oro-rosa", etiqueta: "Oro Rosado", alias: ["rosegold", "oro rosa"] }];
    assert.equal(materialConLinea("", "oro-rosa", rara), "rosegold");
    assert.deepEqual(lineasDeMaterial(materialConLinea("Dije", "oro-rosa", rara), rara), ["oro-rosa"]);
  });
});

describe("etiquetasDeLineas", () => {
  it("los nombres de las líneas del material, en el orden de la configuración", () => {
    assert.deepEqual(etiquetasDeLineas("Acero y Rodio", LINEAS), ["Rodio", "Acero"], "el orden es el de la configuración, no el del texto");
    assert.deepEqual(etiquetasDeLineas("Cover-Gold", LINEAS), ["Cover Gold"]);
    assert.deepEqual(etiquetasDeLineas("Plateado", LINEAS), []);
    assert.deepEqual(etiquetasDeLineas(null, LINEAS), []);
    assert.deepEqual(etiquetasDeLineas("", LINEAS), []);
  });
});

describe("palabrasConPosicion: las mismas palabras que reconoce la tienda, con su lugar en el texto", () => {
  const TEXTOS = [
    "", " ", "Rodio · 3cm", "Cover-Gold", "COVERGOLD", "Rodío", "ÁCERO", "Plata 925", "Rodio·3cm", "ñandú", "Ñu", "áb", "é", "🙂 Plata 🙂", "Plata 925", "a^b", "a`b", "x´y", "ª", "m²",
    "plata–rodio", "tab\tplata\nrodio", "Ǆ", "ß", "İstanbul", "ﬁ", "αβγ", "日本語", "Plata, Rodio; Acero/Cover Gold", "  doble   espacio  ", "Rodio\u0000plata",
  ];

  it("dan EXACTAMENTE las mismas palabras que `palabrasDe` (si una regla de normalizar cambia sin la otra, esto falla)", () => {
    for (const texto of TEXTOS) assert.deepEqual(palabrasConPosicion(texto).map((p) => p.palabra), palabrasDe(texto), JSON.stringify(texto));
  });

  it("cada palabra apunta a un trozo del texto original que, solo, da esa misma palabra", () => {
    for (const texto of TEXTOS) {
      for (const p of palabrasConPosicion(texto)) {
        assert.ok(p.ini >= 0 && p.fin > p.ini && p.fin <= texto.length, `${JSON.stringify(texto)} ${p.palabra}`);
        assert.deepEqual(palabrasDe(texto.slice(p.ini, p.fin)), [p.palabra], `${JSON.stringify(texto)} -> ${JSON.stringify(texto.slice(p.ini, p.fin))}`);
      }
    }
  });

  it("en «Rodio · 3cm» ubica «Rodio» en 0-5 y «3cm» en 8-11", () => {
    assert.deepEqual(palabrasConPosicion("Rodio · 3cm"), [
      { palabra: "rodio", ini: 0, fin: 5 },
      { palabra: "3cm", ini: 8, fin: 11 },
    ]);
  });
});
