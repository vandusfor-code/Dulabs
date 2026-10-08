/**
 * CMS comercial — los precios EFECTIVOS del catálogo: la implementación del puerto sobre lo publicado. No repite reglas (las decide evaluacion.ts): aquí se prueba
 * que el catálogo recibe exactamente eso, por canal, con el reloj inyectado, sin mezclar modalidades y fallando cerrado ante un error.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CatalogProduct } from "@/lib/catalogo/domain";
import { precioQueRige } from "@/lib/catalogo/precios";
import type { ProductoResuelto } from "@/lib/catalogo/resolucion";
import { productoParaCombo } from "@/lib/cms-comercial/publico-supabase";
import type { InstantaneaCms, PublicadaCms } from "@/lib/cms-comercial/publicado";
import { crearEvaluadorPrecios, crearPuertoPreciosCms, etiquetaDeOferta } from "@/lib/cms-comercial/precios";
import { AHORA, CAT_ARETES, CAT_DIJES, TENANT_A, TENANT_B, campana, instantanea, oferta, publicada } from "@/lib/cms-comercial/testing/fixtures";

const producto = (over: Partial<CatalogProduct> & { retail?: number; wholesale?: number | null } = {}): CatalogProduct => {
  const { retail = 100_000, wholesale = 70_000, ...resto } = over;
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    reference: "DL-000001",
    name: "Aretes dorados",
    description: null,
    categoryId: CAT_ARETES,
    categoryName: "Aretes",
    material: null,
    color: null,
    pricing: { retail, wholesale },
    status: "ACTIVE",
    tracksStock: true,
    stock: 10,
    primaryImage: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...resto,
  };
};

const con = (...ofertas: PublicadaCms<"oferta">[]): InstantaneaCms => instantanea({ ofertas });

describe("crearEvaluadorPrecios — el precio por canal sale de lo publicado", () => {
  it("una oferta «ambas» del 20% baja el precio detal y el mayorista, con la etiqueta, el texto y la vigencia en palabras", () => {
    const ev = crearEvaluadorPrecios(con(publicada("amor", oferta({ nombre: "Amor y Amistad", beneficio: { tipo: "porcentaje", valor: 20 }, condiciones: "Hasta agotar existencias." }))), AHORA);
    const retail = ev.de(producto(), "retail");
    assert.equal(retail.precio, 80_000);
    assert.equal(retail.precioLista, 100_000);
    assert.deepEqual(retail.oferta, {
      clave: "amor",
      nombre: "Amor y Amistad",
      version: 1,
      beneficio: "20% de descuento",
      etiqueta: "-20%",
      ahorro: 20_000,
      vigencia: "hasta el 31 de octubre de 2026",
      condiciones: "Hasta agotar existencias.",
    });
    const mayor = ev.de(producto(), "wholesale");
    assert.equal(mayor.precio, 56_000);
    assert.equal(mayor.precioLista, 70_000);
  });

  it("CONTRATO DE MODALIDAD: una oferta detal nunca toca el precio mayorista y una mayorista nunca el detal", () => {
    const detal = crearEvaluadorPrecios(con(publicada("d", oferta({ modalidad: "detal" }))), AHORA);
    assert.equal(detal.de(producto(), "retail").precio, 80_000);
    assert.deepEqual(detal.de(producto(), "wholesale"), { precio: 70_000, precioLista: 70_000, oferta: null });
    const mayor = crearEvaluadorPrecios(con(publicada("m", oferta({ modalidad: "mayorista", beneficio: { tipo: "porcentaje", valor: 10 } }))), AHORA);
    assert.deepEqual(mayor.de(producto(), "retail"), { precio: 100_000, precioLista: 100_000, oferta: null });
    assert.equal(mayor.de(producto(), "wholesale").precio, 63_000);
  });

  it("monto fijo y precio especial usan el valor del canal; la etiqueta corta es del backend", () => {
    const monto = crearEvaluadorPrecios(con(publicada("m", oferta({ beneficio: { tipo: "monto_fijo", detal: 5_000, mayorista: 3_000 } }))), AHORA);
    assert.equal(monto.de(producto(), "retail").precio, 95_000);
    assert.equal(monto.de(producto(), "retail").oferta?.etiqueta, "-$5.000");
    assert.equal(monto.de(producto(), "wholesale").precio, 67_000);
    const especial = crearEvaluadorPrecios(con(publicada("e", oferta({ beneficio: { tipo: "precio_especial", detal: 79_000, mayorista: 55_000 } }))), AHORA);
    assert.equal(especial.de(producto(), "retail").precio, 79_000);
    assert.equal(especial.de(producto(), "retail").oferta?.etiqueta, "Precio especial");
    assert.equal(especial.de(producto(), "retail").oferta?.beneficio, "precio especial de $79.000");
    assert.equal(etiquetaDeOferta({ tipo: "porcentaje", valor: 15 }, 0), "-15%");
  });

  it("una oferta solo alcanza lo que cubre: referencias, categorías o toda la tienda", () => {
    const porRef = crearEvaluadorPrecios(con(publicada("r", oferta({ alcance: { todos: false, referencias: ["DL-000009"], categorias: [] } }))), AHORA);
    assert.equal(porRef.de(producto(), "retail").oferta, null);
    assert.equal(porRef.de(producto({ reference: "DL-000009" }), "retail").precio, 80_000);
    const porCat = crearEvaluadorPrecios(con(publicada("c", oferta({ alcance: { todos: false, referencias: [], categorias: [CAT_DIJES] } }))), AHORA);
    assert.equal(porCat.de(producto(), "retail").oferta, null);
    assert.equal(porCat.de(producto({ categoryId: CAT_DIJES }), "retail").precio, 80_000);
    assert.equal(porCat.de(producto({ categoryId: null }), "retail").oferta, null, "sin categoría no puede alcanzarla");
    const todos = crearEvaluadorPrecios(con(publicada("t", oferta({ alcance: { todos: true, referencias: [], categorias: [] } }))), AHORA);
    assert.equal(todos.de(producto({ reference: "DL-000777", categoryId: null }), "retail").precio, 80_000);
  });

  it("NO se acumulan: con varias ofertas rige UNA (mayor prioridad; empate: mejor precio para el cliente) y el resultado no depende del orden", () => {
    const a = publicada("a", oferta({ nombre: "A", prioridad: 5, beneficio: { tipo: "porcentaje", valor: 10 } }));
    const b = publicada("b", oferta({ nombre: "B", prioridad: 9, beneficio: { tipo: "porcentaje", valor: 15 } }));
    const c = publicada("c", oferta({ nombre: "C", prioridad: 9, beneficio: { tipo: "porcentaje", valor: 30 } }));
    for (const orden of [[a, b, c], [c, b, a], [b, a, c]]) {
      const r = crearEvaluadorPrecios(con(...orden), AHORA).de(producto(), "retail");
      assert.equal(r.oferta?.clave, "c", "mayor prioridad (9) y, en empate, el mejor precio para el cliente");
      assert.equal(r.precio, 70_000, "30% sobre 100.000, nunca 10%+15%+30% acumulados");
    }
  });

  it("vencida, programada o de una campaña apagada: no existe; el precio es el de lista", () => {
    const vencida = crearEvaluadorPrecios(con(publicada("v", oferta({ vigencia: { desde: "2026-09-01", hasta: "2026-09-30" } }))), AHORA);
    const programada = crearEvaluadorPrecios(con(publicada("p", oferta({ vigencia: { desde: "2026-11-01", hasta: "2026-11-30" } }))), AHORA);
    const deCampanaApagada = crearEvaluadorPrecios(con(publicada("x", oferta({ campana: "navidad" }))), AHORA);
    for (const ev of [vencida, programada, deCampanaApagada]) assert.deepEqual(ev.de(producto(), "retail"), { precio: 100_000, precioLista: 100_000, oferta: null });
  });

  it("una oferta de una campaña ACTIVA aplica; la misma, con la campaña vencida, no", () => {
    const of = publicada("x", oferta({ campana: "navidad" }));
    const activa = instantanea({ ofertas: [of], campanas: [publicada("navidad", campana())] });
    assert.equal(crearEvaluadorPrecios(activa, AHORA).de(producto(), "retail").precio, 80_000);
    const vencida = instantanea({ ofertas: [of], campanas: [publicada("navidad", campana({ vigencia: { desde: "2026-09-01", hasta: "2026-09-30" } }))] });
    assert.equal(crearEvaluadorPrecios(vencida, AHORA).de(producto(), "retail").oferta, null);
  });

  it("el reloj es el inyectado: la misma oferta vale un día y al siguiente (hora de Bogotá) ya no", () => {
    const snap = con(publicada("k", oferta({ vigencia: { desde: "2026-10-25", hasta: "2026-10-31" } })));
    assert.equal(crearEvaluadorPrecios(snap, Date.parse("2026-10-31T23:59:00-05:00")).de(producto(), "retail").precio, 80_000);
    assert.equal(crearEvaluadorPrecios(snap, Date.parse("2026-11-01T00:00:00-05:00")).de(producto(), "retail").precio, 100_000);
    assert.equal(crearEvaluadorPrecios(snap, Date.parse("2026-10-24T23:59:00-05:00")).de(producto(), "retail").precio, 100_000);
  });

  it("sin precio para el canal («a consultar») o con precio 0 no hay oferta: nunca se inventa un precio", () => {
    const ev = crearEvaluadorPrecios(con(publicada("t", oferta({ alcance: { todos: true, referencias: [], categorias: [] } }))), AHORA);
    assert.deepEqual(ev.de(producto({ wholesale: null }), "wholesale"), { precio: null, precioLista: null, oferta: null });
    assert.equal(ev.de(producto({ retail: 0 }), "retail").oferta, null);
  });

  it("una oferta que dejaría un precio no válido se ignora (monto mayor que el precio, precio especial más caro)", () => {
    const monto = crearEvaluadorPrecios(con(publicada("m", oferta({ beneficio: { tipo: "monto_fijo", detal: 100_000, mayorista: 70_000 } }))), AHORA);
    assert.equal(monto.de(producto(), "retail").oferta, null);
    const caro = crearEvaluadorPrecios(con(publicada("e", oferta({ beneficio: { tipo: "precio_especial", detal: 120_000, mayorista: 90_000 } }))), AHORA);
    assert.equal(caro.de(producto(), "retail").oferta, null);
  });

  it("combinado con precioQueRige (la decisión del catálogo) deja el mismo precio y la misma evidencia", () => {
    const ev = crearEvaluadorPrecios(con(publicada("amor", oferta())), AHORA);
    const rige = precioQueRige(producto(), "retail", ev.de(producto(), "retail"));
    assert.equal(rige.precio, 80_000);
    assert.equal(rige.precioLista, 100_000);
    assert.equal(rige.oferta?.clave, "amor");
  });

  it("no modifica la instantánea (congelada) y da siempre lo mismo", () => {
    const snap = instantanea({ ofertas: [publicada("amor", oferta())] });
    Object.freeze(snap.ofertas);
    const uno = crearEvaluadorPrecios(snap, AHORA).de(producto(), "retail");
    const dos = crearEvaluadorPrecios(snap, AHORA).de(producto(), "retail");
    assert.deepEqual(uno, dos);
  });
});

describe("crearPuertoPreciosCms — del módulo al evaluador, con respaldo y sin inventar", () => {
  it("lee SOLO el negocio pedido y usa el reloj inyectado", async () => {
    const leidos: string[] = [];
    let relojes = 0;
    const puerto = crearPuertoPreciosCms({
      cargar: async (tenantId) => (leidos.push(tenantId), con(publicada("amor", oferta()))),
      ahora: () => (relojes++, AHORA),
    });
    const ev = await puerto.paraNegocio(TENANT_A);
    assert.deepEqual(leidos, [TENANT_A]);
    assert.equal(relojes, 1);
    assert.equal(ev?.de(producto(), "retail").precio, 80_000);
  });

  it("módulo apagado o sin migración (el lector devuelve null): null => rige el precio de lista, como antes del CMS", async () => {
    const puerto = crearPuertoPreciosCms({ cargar: async () => null, ahora: () => AHORA });
    assert.equal(await puerto.paraNegocio(TENANT_A), null);
  });

  it("con el módulo encendido y NADA publicado igual hay evaluador (la tienda sabe que sus precios pueden cambiar al publicar) y todo es precio de lista", async () => {
    const puerto = crearPuertoPreciosCms({ cargar: async (t) => instantanea({ tenantId: t }), ahora: () => AHORA });
    const ev = await puerto.paraNegocio(TENANT_A);
    assert.ok(ev);
    assert.deepEqual(ev.de(producto(), "retail"), { precio: 100_000, precioLista: 100_000, oferta: null });
  });

  it("un error al leer lo publicado SE PROPAGA: quien cobra no sigue con un precio sin verificar", async () => {
    const puerto = crearPuertoPreciosCms({
      cargar: async () => {
        throw new Error("base de datos caída");
      },
      ahora: () => AHORA,
    });
    await assert.rejects(puerto.paraNegocio(TENANT_A), /base de datos caída/);
  });

  it("AISLAMIENTO: las ofertas de un negocio no afectan los precios de otro", async () => {
    const porNegocio: Record<string, InstantaneaCms> = { [TENANT_A]: con(publicada("amor", oferta())), [TENANT_B]: instantanea({ tenantId: TENANT_B }) };
    const puerto = crearPuertoPreciosCms({ cargar: async (t) => porNegocio[t] ?? null, ahora: () => AHORA });
    assert.equal((await puerto.paraNegocio(TENANT_A))?.de(producto(), "retail").precio, 80_000);
    assert.equal((await puerto.paraNegocio(TENANT_B))?.de(producto(), "retail").precio, 100_000);
    assert.equal(await puerto.paraNegocio("cccccccc-0000-4000-8000-00000000000c"), null);
  });

  it("cada consulta carga lo vigente de nuevo (nada de precios viejos después de publicar o pausar)", async () => {
    let snap = con(publicada("amor", oferta()));
    const puerto = crearPuertoPreciosCms({ cargar: async () => snap, ahora: () => AHORA });
    assert.equal((await puerto.paraNegocio(TENANT_A))?.de(producto(), "retail").precio, 80_000);
    snap = instantanea(); // la oferta se pausó
    assert.equal((await puerto.paraNegocio(TENANT_A))?.de(producto(), "retail").precio, 100_000);
  });
});

describe("productoParaCombo — lo que un combo necesita saber de un producto del catálogo", () => {
  const resuelto = (over: Partial<ProductoResuelto> = {}): ProductoResuelto => ({
    reference: "DL-000184",
    name: "Dije corazón",
    description: "Un dije delicado.",
    categoryId: null,
    categoryName: "Dijes",
    material: null,
    color: null,
    prices: { retail: 80_000, wholesale: 70_000 },
    stock: { tracked: true, units: 7 },
    status: "ACTIVE",
    available: true,
    availability: "available",
    maxQuantity: 7,
    image: null,
    ...over,
  });

  it("toma el precio EFECTIVO detal (el que se paga hoy por separado), la disponibilidad y el máximo pedible", () => {
    assert.deepEqual(productoParaCombo(resuelto()), { referencia: "DL-000184", nombre: "Dije corazón", activo: true, disponibilidad: "available", maxCantidad: 7, precioLista: 80_000 });
  });

  it("un producto inactivo (retirado de la venta) llega como inactivo; sin precio detal llega sin precio (nunca un 0 inventado)", () => {
    const r = productoParaCombo(resuelto({ status: "INACTIVE", available: false, prices: { retail: null, wholesale: 70_000 } }));
    assert.equal(r.activo, false);
    assert.equal(r.precioLista, null);
  });

  it("no lleva nada más: ni el precio mayorista, ni la descripción, ni las unidades exactas de inventario", () => {
    assert.deepEqual(Object.keys(productoParaCombo(resuelto())).sort(), ["activo", "disponibilidad", "maxCantidad", "nombre", "precioLista", "referencia"]);
  });
});
