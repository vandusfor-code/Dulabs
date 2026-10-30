/**
 * Líneas de la tienda (lib/catalogo/lineas.ts): Plata, Rodio, Acero y Cover Gold, las de Delacour. Lo puro: a qué líneas pertenece un material escrito a mano y cuántas piezas tiene cada línea (y
 * cada categoría dentro de ella). Se prueba con la configuración REAL del negocio y con los materiales como de verdad se escriben en su catálogo («Rodio · 3cm», «RODIO», «Rodio platinado»…).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calcularLineas, clavesConocidas, coincideLinea, esClaveDeLinea, lineasDeMaterial, type LineaConfig } from "@/lib/catalogo/lineas";
import { hrefLineas, lineasVisibles } from "@/lib/catalogo/joyeria";
import { storefrontConfigFor } from "@/lib/catalogo/vitrina";

/** Las líneas tal como las tiene Delacour en su configuración (no una copia: si cambian allí, estas pruebas lo ven). */
const LINEAS = storefrontConfigFor("delacour").joyeria!.lineas!.lineas;
const por = (clave: string): LineaConfig => LINEAS.find((l) => l.clave === clave)!;

describe("la configuración de Delacour", () => {
  it("son las cuatro líneas que pidió la clienta, en su orden, con claves válidas para la dirección", () => {
    assert.deepEqual(LINEAS.map((l) => l.etiqueta), ["Plata", "Rodio", "Acero", "Cover Gold"]);
    assert.deepEqual(LINEAS.map((l) => l.clave), ["plata", "rodio", "acero", "cover-gold"]);
    for (const l of LINEAS) assert.ok(esClaveDeLinea(l.clave), l.clave);
    assert.equal(storefrontConfigFor("delacour").joyeria!.lineas!.titulo, "Nuestras líneas");
  });

  it("otros negocios no tienen líneas: su tienda no cambia", () => {
    assert.equal(storefrontConfigFor("aqui-si-lo-compras").joyeria, undefined);
    assert.deepEqual(storefrontConfigFor("cualquier-otro"), {});
  });
});

describe("esClaveDeLinea", () => {
  it("minúsculas, números y guiones entre palabras; nada más", () => {
    for (const ok of ["plata", "cover-gold", "linea-2", "a", "oro-18k"]) assert.equal(esClaveDeLinea(ok), true, ok);
    for (const mal of ["", "Plata", "cover gold", "cover--gold", "-plata", "plata-", "pla/ta", "pla_ta", "ñandú", "x".repeat(31), "../etc"]) assert.equal(esClaveDeLinea(mal), false, mal);
  });
});

describe("a qué línea pertenece un material (palabras completas)", () => {
  const cae = (material: string | null) => lineasDeMaterial(material, LINEAS);

  it("Rodio: tal como se escribe de verdad en el catálogo (mayúsculas, medidas, acabados)", () => {
    for (const m of ["Rodio", "RODIO", "rodio", "Rodio · 3cm", "Rodio · 2.5cm", "Rodio · 3.4cm", "Rodio · 4mm", "Rodio · cm", "Rodio platinado", "  Rodio  "]) {
      assert.deepEqual(cae(m), ["rodio"], m);
    }
  });

  it("Plata: con ley, con tildes de más o dentro de una frase", () => {
    for (const m of ["Plata", "PLATA", "Plata 925", "plata ley 925", "Plata fina", "chapa de plata"]) assert.deepEqual(cae(m), ["plata"], m);
  });

  it("Acero: inoxidable, quirúrgico, con medidas", () => {
    for (const m of ["Acero", "ACERO", "Acero inoxidable", "Acero quirúrgico", "Acero · 4mm"]) assert.deepEqual(cae(m), ["acero"], m);
  });

  it("Cover Gold: junto, separado, con guion, en mayúsculas o con el quilataje", () => {
    for (const m of ["Cover Gold", "cover gold", "COVER GOLD", "Covergold", "COVERGOLD", "Cover-Gold", "Cover  Gold", "Cover gold 18k"]) assert.deepEqual(cae(m), ["cover-gold"], m);
  });

  it("«Plateado» (un color), «Platería», «Platino» o «Rodiado» NO son Plata ni Rodio: nunca se reconoce por un pedazo de palabra", () => {
    for (const m of ["Plateado", "Platería", "Plateria", "Platino", "Platinado", "Platiando", "Rodiado", "Aceros", "Acerado", "Gold", "Cover", "Dorado"]) assert.deepEqual(cae(m), [], m);
  });

  it("sin material (null, vacío, solo signos) no está en ninguna línea", () => {
    for (const m of [null, undefined, "", "   ", "·", "---"]) assert.deepEqual(lineasDeMaterial(m as string | null, LINEAS), [], String(m));
  });

  it("una pieza puede estar en más de una línea, en el orden de la configuración", () => {
    assert.deepEqual(cae("Acero y Rodio"), ["rodio", "acero"]);
    assert.deepEqual(cae("Plata con baño de Cover Gold"), ["plata", "cover-gold"]);
  });

  it("coincideLinea responde por una sola línea", () => {
    assert.equal(coincideLinea("Rodio · 3cm", por("rodio")), true);
    assert.equal(coincideLinea("Rodio · 3cm", por("plata")), false);
    assert.equal(coincideLinea(null, por("rodio")), false);
  });

  it("los alias se reconocen completos y la etiqueta vale si no hay alias", () => {
    const sin: LineaConfig = { clave: "oro", etiqueta: "Oro" };
    assert.equal(coincideLinea("Oro 18k", sin), true);
    assert.equal(coincideLinea("Oro laminado", sin), true);
    assert.equal(coincideLinea("Dorado", sin), false);
    const con: LineaConfig = { clave: "oro", etiqueta: "Oro", alias: ["oro", "gold filled"] };
    assert.equal(coincideLinea("Gold Filled 14k", con), true);
    assert.equal(coincideLinea("Gold", con), false, "una frase se reconoce completa, no por una de sus palabras");
    const vacio: LineaConfig = { clave: "x", etiqueta: "X", alias: ["", "  "] };
    assert.equal(coincideLinea("X", vacio), false, "unos alias vacíos no reconocen nada (ni todo)");
  });
});

describe("calcularLineas: cuántas piezas tiene cada línea y cada categoría dentro de ella", () => {
  const filas = [
    { categoryId: "anillos", material: "Rodio" },
    { categoryId: "anillos", material: "RODIO" },
    { categoryId: "anillos", material: "Rodio · 3cm" },
    { categoryId: "cadenas", material: "Rodio platinado" },
    { categoryId: "cadenas", material: "Plata 925" },
    { categoryId: null, material: "Rodio" },
    { categoryId: "anillos", material: null },
    { categoryId: "anillos", material: "Plateado" },
    { categoryId: "aretes", material: "Acero y Rodio" },
  ];

  it("una entrada por línea, en su orden, y las líneas sin piezas están con cero (la estructura no depende de cuántas haya)", () => {
    const r = calcularLineas(filas, LINEAS);
    assert.deepEqual(r.map((l) => [l.clave, l.etiqueta, l.n]), [["plata", "Plata", 1], ["rodio", "Rodio", 6], ["acero", "Acero", 1], ["cover-gold", "Cover Gold", 0]]);
    assert.deepEqual(r.find((l) => l.clave === "cover-gold")!.categorias, []);
  });

  it("cuenta las categorías DENTRO de cada línea: una pieza sin categoría suma a la línea pero no a una categoría", () => {
    const r = calcularLineas(filas, LINEAS);
    const rodio = r.find((l) => l.clave === "rodio")!;
    assert.deepEqual([...rodio.categorias].sort((a, b) => a.id.localeCompare(b.id)), [{ id: "anillos", n: 3 }, { id: "aretes", n: 1 }, { id: "cadenas", n: 1 }]);
    assert.equal(rodio.n, 6, "las 6 piezas de Rodio, incluida la que no tiene categoría");
    assert.deepEqual(r.find((l) => l.clave === "plata")!.categorias, [{ id: "cadenas", n: 1 }]);
  });

  it("una pieza en dos líneas suma en las dos", () => {
    const r = calcularLineas([{ categoryId: "aretes", material: "Acero y Rodio" }], LINEAS);
    assert.deepEqual(r.map((l) => l.n), [0, 1, 1, 0]);
  });

  it("sin piezas o sin líneas", () => {
    assert.deepEqual(calcularLineas([], LINEAS).map((l) => l.n), [0, 0, 0, 0]);
    assert.deepEqual(calcularLineas(filas, []), []);
  });

  it("un catálogo grande se resuelve rápido: cada material distinto se lee una sola vez", () => {
    const grande = Array.from({ length: 5000 }, (_, i) => ({ categoryId: `c${i % 12}`, material: i % 7 === 0 ? "Plata 925" : "Rodio" }));
    const t0 = performance.now();
    const r = calcularLineas(grande, LINEAS);
    const ms = performance.now() - t0;
    assert.equal(r.find((l) => l.clave === "rodio")!.n + r.find((l) => l.clave === "plata")!.n, 5000);
    assert.ok(ms < 500, `tardó ${ms.toFixed(0)} ms`);
  });
});

describe("clavesConocidas: solo las líneas que el negocio tiene", () => {
  it("deja las conocidas, sin repetir y en el orden en que llegaron; ignora el resto", () => {
    assert.deepEqual(clavesConocidas(["rodio", "oro", "plata", "rodio"], LINEAS), ["rodio", "plata"]);
  });

  it("sin claves, sin líneas o sin nada conocido -> vacío (la dirección se ignora, nunca un error)", () => {
    assert.deepEqual(clavesConocidas(undefined, LINEAS), []);
    assert.deepEqual(clavesConocidas([], LINEAS), []);
    assert.deepEqual(clavesConocidas(["plata"], undefined), []);
    assert.deepEqual(clavesConocidas(["plata"], []), []);
    assert.deepEqual(clavesConocidas(["oro"], LINEAS), []);
  });
});

describe("lineasVisibles: lo que se ve en el menú y en el inicio", () => {
  const BASE = "/catalogo/delacour";
  const NOMBRES = ["Anillos", "Aretes", "Cadena con Dije", "Cadenas", "Candonga Grande", "Candongas pequeñas", "Dije", "Esclava", "Juegos", "Pulseras", "Pulseras Balines", "Topos"];
  /** Las 12 categorías de Delacour: con pocas categorías un menú que recortara la lista pasaría desapercibido. */
  const CATEGORIAS = NOMBRES.map((name, i) => ({ id: `c${i + 1}`, name }));
  const config = storefrontConfigFor("delacour").joyeria!.lineas!;
  const visibles = lineasVisibles(config, CATEGORIAS, BASE);

  it("las cuatro líneas, en el orden de la clienta, cada una con la dirección de su listado", () => {
    assert.deepEqual(visibles.map((l) => [l.etiqueta, l.href]), [
      ["Plata", `${BASE}?linea=plata`],
      ["Rodio", `${BASE}?linea=rodio`],
      ["Acero", `${BASE}?linea=acero`],
      ["Cover Gold", `${BASE}?linea=cover-gold`],
    ]);
  });

  it("cada línea trae TODAS las categorías de la tienda (las 12), en su orden y con la dirección de esa línea y esa categoría", () => {
    for (const l of visibles) {
      assert.deepEqual(l.categorias.map((c) => c.nombre), NOMBRES, l.clave);
      assert.deepEqual(l.categorias.map((c) => c.href), CATEGORIAS.map((c) => `${BASE}?linea=${l.clave}&categoria=${c.id}`), l.clave);
    }
  });

  it("son las mismas categorías en todas las líneas, tenga piezas o no", () => {
    const [primera, ...otras] = visibles.map((l) => l.categorias.map((c) => c.id));
    for (const ids of otras) assert.deepEqual(ids, primera);
  });

  it("sin categorías las líneas existen igual; sin líneas configuradas no hay nada que mostrar", () => {
    assert.deepEqual(lineasVisibles(config, [], BASE).map((l) => [l.clave, l.categorias.length]), [["plata", 0], ["rodio", 0], ["acero", 0], ["cover-gold", 0]]);
    assert.deepEqual(lineasVisibles(undefined, CATEGORIAS, BASE), []);
    assert.deepEqual(lineasVisibles({ titulo: "x", lineas: [] }, CATEGORIAS, BASE), []);
  });

  it("el acceso «Líneas» de la cabecera baja a la franja del inicio", () => {
    assert.equal(hrefLineas(BASE), `${BASE}#lineas`);
  });
});
