/**
 * Catálogo — el precio EFECTIVO: la decisión única de qué precio rige. Sin evaluador o con una oferta incoherente rige SIEMPRE el precio de lista; la oferta solo
 * cuenta si deja un precio entero, positivo y MENOR que el de lista del mismo producto y canal.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { priceFor, type CatalogProduct } from "@/lib/catalogo/domain";
import { precioDeLista, precioQueRige, PreciosNoDisponibles, type OfertaDePrecio, type PrecioEfectivo } from "@/lib/catalogo/precios";

const producto = (retail = 100_000, wholesale: number | null = 70_000): Pick<CatalogProduct, "pricing"> => ({ pricing: { retail, wholesale } });
const OFERTA: OfertaDePrecio = { clave: "amor", nombre: "Amor y Amistad", version: 3, beneficio: "20% de descuento", etiqueta: "-20%", ahorro: 20_000, vigencia: "hasta el 31 de octubre de 2026", condiciones: null };
const evaluado = (precio: number | null, lista: number | null, oferta: OfertaDePrecio | null = OFERTA): PrecioEfectivo => ({ precio, precioLista: lista, oferta });

describe("precioQueRige — la oferta solo cuenta si es coherente", () => {
  it("sin evaluador (módulo apagado, sin ofertas) rige el precio de lista del canal, idéntico a priceFor", () => {
    for (const canal of ["retail", "wholesale"] as const) {
      for (const p of [producto(), producto(50_000, null), producto(0, 0)]) {
        const r = precioQueRige(p, canal, null);
        assert.deepEqual(r, { precio: priceFor(p, canal), precioLista: priceFor(p, canal), oferta: null });
        assert.deepEqual(precioQueRige(p, canal, undefined), r);
        assert.deepEqual(precioDeLista(p, canal), r);
      }
    }
  });

  it("una oferta coherente fija el precio y conserva el de lista y la oferta como evidencia", () => {
    const r = precioQueRige(producto(), "retail", evaluado(80_000, 100_000));
    assert.deepEqual(r, { precio: 80_000, precioLista: 100_000, oferta: OFERTA });
    assert.deepEqual(precioQueRige(producto(), "wholesale", evaluado(56_000, 70_000)), { precio: 56_000, precioLista: 70_000, oferta: OFERTA });
  });

  it("una oferta que NO baja el precio (igual o mayor) se ignora: nunca un descuento que sube o no cambia nada", () => {
    for (const precio of [100_000, 100_001, 150_000]) assert.equal(precioQueRige(producto(), "retail", evaluado(precio, 100_000)).oferta, null, String(precio));
    assert.equal(precioQueRige(producto(), "retail", evaluado(100_000, 100_000)).precio, 100_000);
  });

  it("un precio de oferta que no sea un entero positivo se ignora (cero, negativo, decimal, no finito, nulo)", () => {
    for (const precio of [0, -1, 80_000.5, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      const r = precioQueRige(producto(), "retail", evaluado(precio, 100_000));
      assert.deepEqual(r, { precio: 100_000, precioLista: 100_000, oferta: null }, String(precio));
    }
  });

  it("una evaluación hecha sobre OTRO precio de lista (producto cambiado, canal equivocado) se ignora", () => {
    assert.equal(precioQueRige(producto(), "retail", evaluado(80_000, 90_000)).oferta, null);
    assert.equal(precioQueRige(producto(), "wholesale", evaluado(80_000, 100_000)).oferta, null, "el precio de lista del detal no sirve para el mayor");
    assert.equal(precioQueRige(producto(), "retail", evaluado(80_000, null)).oferta, null);
  });

  it("sin precio para el canal («a consultar») no hay oferta que valga: sigue siendo null", () => {
    assert.deepEqual(precioQueRige(producto(100_000, null), "wholesale", evaluado(50_000, null)), { precio: null, precioLista: null, oferta: null });
    assert.deepEqual(precioQueRige(producto(100_000, null), "wholesale", null), { precio: null, precioLista: null, oferta: null });
  });

  it("un producto con precio de lista 0 (válido en el catálogo) no recibe oferta", () => {
    assert.deepEqual(precioQueRige(producto(0, 0), "retail", evaluado(0, 0)), { precio: 0, precioLista: 0, oferta: null });
  });

  it("un precio rebajado SIN oferta que lo explique no rige: el precio solo baja con una oferta publicada", () => {
    const r = precioQueRige(producto(), "retail", evaluado(80_000, 100_000, null));
    assert.deepEqual(r, { precio: 100_000, precioLista: 100_000, oferta: null });
  });

  it("no modifica lo que recibe", () => {
    const e = Object.freeze({ ...evaluado(80_000, 100_000), oferta: Object.freeze({ ...OFERTA }) });
    const p = Object.freeze(producto());
    assert.doesNotThrow(() => precioQueRige(p, "retail", e));
  });
});

describe("PreciosNoDisponibles", () => {
  it("lleva un mensaje claro y la causa, y se reconoce por su tipo", () => {
    const e = new PreciosNoDisponibles(new Error("conexión caída"));
    assert.ok(e instanceof Error && e instanceof PreciosNoDisponibles);
    assert.equal(e.name, "PreciosNoDisponibles");
    assert.match(e.message, /No se pudo verificar el precio vigente: conexión caída/);
    assert.equal(new PreciosNoDisponibles().message, "No se pudo verificar el precio vigente");
  });
});
