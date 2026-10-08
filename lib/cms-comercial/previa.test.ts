/**
 * CMS comercial — vista previa: usa las mismas funciones de evaluación que la tienda y ARIA, y no inventa nada cuando el borrador está incompleto.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canalesDe, previaCombo, previaContenido, previaOferta, textoAlcance, type PreviaCombo, type PreviaOferta, type ProductoPrevia } from "@/lib/cms-comercial/previa";
import { AHORA, CAT_ARETES, CAT_DIJES, combo, contenido, oferta } from "@/lib/cms-comercial/testing/fixtures";

const prod = (referencia: string, over: Partial<ProductoPrevia> = {}): ProductoPrevia => ({ referencia, nombre: `Producto ${referencia}`, categoriaId: CAT_ARETES, activo: true, agotado: false, precioDetal: 100000, precioMayor: 70000, ...over });
const MUESTRA = [prod("DL-000001"), prod("DL-000002", { precioDetal: 50000, precioMayor: null }), prod("DL-000003", { categoriaId: CAT_DIJES }), prod("DL-000004", { agotado: true })];

function ofertaLista(borrador: unknown, muestra = MUESTRA): PreviaOferta {
  const r = previaOferta(borrador, muestra, AHORA);
  assert.equal(r.lista, true, JSON.stringify(r));
  return r as PreviaOferta;
}
function comboListo(borrador: unknown, muestra = MUESTRA): PreviaCombo {
  const r = previaCombo(borrador, muestra, AHORA);
  assert.equal(r.lista, true, JSON.stringify(r));
  return r as PreviaCombo;
}

describe("previaOferta", () => {
  it("un borrador incompleto no inventa una vista previa", () => {
    for (const malo of [{}, { nombre: "Solo nombre" }, { ...oferta(), vigencia: undefined }, null, "texto"]) {
      const r = previaOferta(malo, MUESTRA, AHORA);
      assert.equal(r.lista, false);
      if (!r.lista) assert.match(r.motivo, /Completa los datos/);
    }
  });

  it("calcula el precio final con la MISMA regla del pedido: 20% sobre 100.000 = 80.000 (ahorro 20.000)", () => {
    const r = ofertaLista(oferta({ alcance: { todos: false, referencias: ["DL-000001"], categorias: [] } }));
    assert.deepEqual(r.ejemplos.map((e) => [e.producto.referencia, e.canal, e.precioLista, e.precioFinal, e.ahorro]), [
      ["DL-000001", "retail", 100000, 80000, 20000],
      ["DL-000001", "wholesale", 70000, 56000, 14000],
    ]);
    assert.deepEqual(r.textosBeneficio, [{ canal: "retail", texto: "20% de descuento" }, { canal: "wholesale", texto: "20% de descuento" }]);
    assert.equal(r.textoVigencia, "del 25 de octubre de 2026 al 31 de octubre de 2026");
    assert.equal(r.estadoVigencia, "vigente");
  });

  it("solo los canales de su modalidad: una oferta detal no muestra precios mayoristas", () => {
    const detal = ofertaLista(oferta({ modalidad: "detal" }));
    assert.deepEqual([...new Set(detal.ejemplos.map((e) => e.canal))], ["retail"]);
    const mayor = ofertaLista(oferta({ modalidad: "mayorista", beneficio: { tipo: "porcentaje", valor: 10 } }));
    assert.deepEqual([...new Set(mayor.ejemplos.map((e) => e.canal))], ["wholesale"]);
    assert.deepEqual(canalesDe("ambas"), ["retail", "wholesale"]);
  });

  it("solo toma de la muestra los productos a los que alcanza (por referencia, categoría o toda la tienda)", () => {
    const porCategoria = ofertaLista(oferta({ modalidad: "detal", alcance: { todos: false, referencias: [], categorias: [CAT_DIJES] } }));
    assert.deepEqual(porCategoria.ejemplos.map((e) => e.producto.referencia), ["DL-000003"]);
    const todos = ofertaLista(oferta({ modalidad: "detal", alcance: { todos: true, referencias: [], categorias: [] } }));
    assert.deepEqual(todos.ejemplos.map((e) => e.producto.referencia), ["DL-000001", "DL-000002", "DL-000003"]);
    const ninguno = ofertaLista(oferta({ alcance: { todos: false, referencias: ["DL-000999"], categorias: [] } }));
    assert.deepEqual(ninguno.ejemplos, []);
  });

  it("un producto sin precio mayorista no aparece como ejemplo mayorista; uno al que no le cambia el precio va a «sin efecto»", () => {
    const r = ofertaLista(oferta({ modalidad: "mayorista", alcance: { todos: false, referencias: ["DL-000002", "DL-000001"], categorias: [] } }));
    assert.deepEqual(r.ejemplos.map((e) => e.producto.referencia), ["DL-000001"]);
    assert.deepEqual(r.sinEfecto.map((p) => p.referencia), ["DL-000002"]);
    const sinMejora = ofertaLista(oferta({ modalidad: "detal", beneficio: { tipo: "precio_especial", detal: 90000 }, alcance: { todos: false, referencias: ["DL-000001", "DL-000002"], categorias: [] } }));
    assert.deepEqual(sinMejora.ejemplos.map((e) => e.producto.referencia), ["DL-000001"]);
    assert.deepEqual(sinMejora.sinEfecto.map((p) => p.referencia), ["DL-000002"]); // 90.000 no es menor que 50.000
  });

  it("muestra a lo sumo tres ejemplos por canal", () => {
    const muchos = Array.from({ length: 8 }, (_, i) => prod(`DL-0001${i}0`));
    const r = ofertaLista(oferta({ alcance: { todos: true, referencias: [], categorias: [] } }), muchos);
    assert.equal(r.ejemplos.filter((e) => e.canal === "retail").length, 3);
    assert.equal(r.ejemplos.filter((e) => e.canal === "wholesale").length, 3);
  });

  it("la vigencia se informa aunque todavía no empiece o ya haya vencido", () => {
    assert.equal(ofertaLista(oferta({ vigencia: { desde: "2026-11-15", hasta: "2026-11-30" } })).estadoVigencia, "programada");
    assert.equal(ofertaLista(oferta({ vigencia: { desde: "2026-09-01", hasta: "2026-09-30" } })).estadoVigencia, "vencida");
    // la vista previa muestra el precio igualmente: la administradora ve qué pasará cuando empiece
    assert.equal(ofertaLista(oferta({ vigencia: { desde: "2026-11-15", hasta: "2026-11-30" } })).ejemplos.length > 0, true);
  });
});

describe("previaCombo", () => {
  const COMBO = combo({ componentes: [{ referencia: "DL-000001", cantidad: 1 }, { referencia: "DL-000003", cantidad: 2 }], precio: { detal: 250000, mayorista: 150000 } });

  it("precio normal, ahorro y disponibilidad por canal, con la misma lógica del backend", () => {
    const r = comboListo(COMBO); // detal: 100.000 + 2×100.000 = 300.000; mayorista: 70.000 + 2×70.000 = 210.000
    const retail = r.porCanal.find((c) => c.canal === "retail")?.vista;
    const mayor = r.porCanal.find((c) => c.canal === "wholesale")?.vista;
    assert.deepEqual([retail?.precioNormal, retail?.precioCombo, retail?.ahorro, retail?.disponible], [300000, 250000, 50000, true]);
    assert.deepEqual([mayor?.precioNormal, mayor?.precioCombo, mayor?.ahorro], [210000, 150000, 60000]);
    assert.deepEqual(retail?.componentes.map((c) => [c.referencia, c.cantidad, c.nombre]), [["DL-000001", 1, "Producto DL-000001"], ["DL-000003", 2, "Producto DL-000003"]]);
  });

  it("un componente agotado, inactivo o que no existe deja el combo «no disponible»", () => {
    const agotado = comboListo(combo({ modalidad: "detal", componentes: [{ referencia: "DL-000001", cantidad: 1 }, { referencia: "DL-000004", cantidad: 1 }], precio: { detal: 150000 } }));
    assert.equal(agotado.porCanal[0].vista?.disponible, false);
    assert.equal(agotado.porCanal[0].vista?.motivoNoDisponible, "componente_agotado");
    const inexistente = comboListo(combo({ modalidad: "detal", componentes: [{ referencia: "DL-000001", cantidad: 1 }, { referencia: "DL-000999", cantidad: 1 }], precio: { detal: 150000 } }));
    assert.equal(inexistente.porCanal[0].vista?.motivoNoDisponible, "componente_inexistente");
    assert.equal(inexistente.porCanal[0].vista?.precioNormal, null, "sin el precio de un componente no se inventa el ahorro");
    const inactivo = comboListo(combo({ modalidad: "detal", precio: { detal: 150000 } }), [prod("DL-000001", { activo: false }), prod("DL-000002")]);
    assert.equal(inactivo.porCanal[0].vista?.motivoNoDisponible, "componente_inactivo");
  });

  it("solo los canales de su modalidad y un borrador incompleto no inventa nada", () => {
    assert.deepEqual(comboListo(combo({ modalidad: "detal", precio: { detal: 150000 } })).porCanal.map((c) => c.canal), ["retail"]);
    const r = previaCombo({ nombre: "Sin componentes" }, MUESTRA, AHORA);
    assert.equal(r.lista, false);
  });
});

describe("previaContenido", () => {
  it("reemplaza las variables con los valores del negocio", () => {
    const r = previaContenido(contenido({ texto: "La compra inicial parte desde {{minimo_mayorista}}." }), { minimo_mayorista: "$750.000" });
    assert.equal(r.lista, true);
    if (r.lista) {
      assert.equal(r.texto, "La compra inicial parte desde $750.000.");
      assert.deepEqual([r.sinValor, r.desconocidas], [[], []]);
    }
  });

  it("dice qué variables faltan o no existen (el texto queda tal cual: así se ve el problema)", () => {
    const r = previaContenido(contenido({ titulo: "Hola {{nombre_negocio}}", texto: "En {{direccion_tienda}} y {{oro_hoy}}" }), { nombre_negocio: "Delacour" });
    assert.equal(r.lista, true);
    if (r.lista) {
      assert.equal(r.titulo, "Hola Delacour");
      assert.equal(r.texto, "En {{direccion_tienda}} y {{oro_hoy}}");
      assert.deepEqual(r.sinValor, ["direccion_tienda"]);
      assert.deepEqual(r.desconocidas, ["oro_hoy"]);
    }
  });

  it("un borrador incompleto no inventa una vista previa", () => {
    assert.equal(previaContenido({ titulo: "Solo título" }, {}).lista, false);
  });
});

describe("textoAlcance", () => {
  it("lo resume en palabras", () => {
    assert.equal(textoAlcance(undefined), "Sin productos");
    assert.equal(textoAlcance({ todos: true }), "Toda la tienda");
    assert.equal(textoAlcance({ referencias: ["a"], categorias: [] }), "1 producto");
    assert.equal(textoAlcance({ referencias: ["a", "b", "c"], categorias: ["x"] }), "3 productos y 1 categoría");
    assert.equal(textoAlcance({ referencias: [], categorias: ["x", "y"] }), "2 categorías");
    assert.equal(textoAlcance({ referencias: [], categorias: [] }), "Sin productos");
  });
});
