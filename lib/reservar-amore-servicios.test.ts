/**
 * Portal público de AMORE — selección de varios servicios en UNA cita (manos + pies): la lógica pura que usa la pantalla.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  alternarServicio,
  categoriaDelServicio,
  mismosServicios,
  ordenarCategorias,
  parametroServicioIds,
  resumirServicios,
  serviciosDeIds,
  type ServicioDelPortal,
} from "@/lib/reservar-amore-servicios";

const servicio = (id: string, nombre: string, categoria: string | null, duracion_min: number, precio: number | null): ServicioDelPortal => ({
  id,
  nombre,
  categoria,
  descripcion: null,
  duracion_min,
  precio,
  imagen_url: null,
});

describe("categorías", () => {
  it("sin categoría (o en blanco) cae en «Otros»", () => {
    assert.equal(categoriaDelServicio({ categoria: null }), "Otros");
    assert.equal(categoriaDelServicio({ categoria: "   " }), "Otros");
    assert.equal(categoriaDelServicio({ categoria: " Uñas " }), "Uñas");
  });

  it("la que más servicios tiene va primero, «Otros» siempre al final, empates por orden alfabético", () => {
    const catalogo = [
      servicio("1", "A", null, 60, null), // Otros
      servicio("2", "B", null, 60, null), // Otros (2, pero va al final igual)
      servicio("3", "C", "Depilación", 30, null),
      servicio("4", "D", "Maquillaje", 60, null),
      servicio("5", "E", "Uñas", 60, null),
      servicio("6", "F", "Uñas", 60, null),
      servicio("7", "G", "Uñas", 60, null),
      servicio("8", "H", "Pestañas", 60, null),
    ];
    assert.deepEqual(ordenarCategorias(catalogo), ["Uñas", "Depilación", "Maquillaje", "Pestañas", "Otros"]);
  });

  it("sin servicios no hay categorías", () => {
    assert.deepEqual(ordenarCategorias([]), []);
  });
});

describe("resumirServicios", () => {
  it("suma duraciones y precios y une los nombres en el orden elegido", () => {
    const r = resumirServicios([servicio("m", "Manos Semi", "Uñas", 60, 40000), servicio("p", "Pies Semi", null, 60, 35000)]);
    assert.deepEqual(r, { cantidad: 2, nombre: "Manos Semi + Pies Semi", duracionMin: 120, precioTotal: 75000 });
  });

  it("si algún servicio no tiene precio, NO inventa un total", () => {
    const r = resumirServicios([servicio("m", "Manos Semi", "Uñas", 60, 40000), servicio("k", "Keratina", null, 90, null)]);
    assert.equal(r.precioTotal, null);
    assert.equal(r.duracionMin, 150);
  });

  it("un solo servicio queda tal cual; ninguno -> todo en cero y sin total", () => {
    assert.deepEqual(resumirServicios([servicio("m", "Manos Semi", "Uñas", 60, 40000)]), { cantidad: 1, nombre: "Manos Semi", duracionMin: 60, precioTotal: 40000 });
    assert.deepEqual(resumirServicios([]), { cantidad: 0, nombre: "", duracionMin: 0, precioTotal: null });
  });
});

describe("alternarServicio", () => {
  it("marca conservando el orden de elección y desmarca al volver a tocar", () => {
    let ids: string[] = [];
    ids = alternarServicio(ids, "manos", 3);
    ids = alternarServicio(ids, "pies", 3);
    assert.deepEqual(ids, ["manos", "pies"]);
    ids = alternarServicio(ids, "manos", 3);
    assert.deepEqual(ids, ["pies"]);
  });

  it("con el tope alcanzado no deja agregar otro, pero sí quitar", () => {
    const lleno = ["a", "b", "c"];
    assert.deepEqual(alternarServicio(lleno, "d", 3), ["a", "b", "c"]);
    assert.deepEqual(alternarServicio(lleno, "b", 3), ["a", "c"]);
  });

  it("nunca modifica la lista original", () => {
    const original = ["a"];
    alternarServicio(original, "b", 3);
    assert.deepEqual(original, ["a"]);
  });

  it("con tope 1 (un negocio que no combina) elegir otro NO reemplaza: hay que desmarcar primero", () => {
    assert.deepEqual(alternarServicio(["a"], "b", 1), ["a"]);
  });
});

describe("serviciosDeIds / mismosServicios / parametroServicioIds", () => {
  const catalogo = [servicio("a", "A", null, 30, 1), servicio("b", "B", null, 30, 2), servicio("c", "C", null, 30, 3)];

  it("devuelve los servicios en el orden de los ids, sin repetidos ni inexistentes", () => {
    assert.deepEqual(serviciosDeIds(["c", "a", "a", "zzz"], catalogo).map((s) => s.id), ["c", "a"]);
    assert.deepEqual(serviciosDeIds([], catalogo), []);
  });

  it("mismos servicios = misma lista en el mismo orden", () => {
    assert.equal(mismosServicios(["a", "b"], ["a", "b"]), true);
    assert.equal(mismosServicios(["a", "b"], ["b", "a"]), false);
    assert.equal(mismosServicios(["a"], ["a", "b"]), false);
    assert.equal(mismosServicios([], []), true);
  });

  it("el parámetro de la URL es la lista separada por comas", () => {
    assert.equal(parametroServicioIds(["a", "b"]), "a,b");
    assert.equal(parametroServicioIds(["a"]), "a");
  });
});
