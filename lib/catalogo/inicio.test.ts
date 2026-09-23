/**
 * Vista del catálogo público y configuración editorial de la vitrina — puro.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { esListado } from "@/lib/catalogo/inicio";
import { heroOf, storefrontConfigFor } from "@/lib/catalogo/vitrina";

describe("vista", () => {
  it("inicio sin parámetros; listado con búsqueda, categoría, página o 'ver todo'", () => {
    assert.equal(esListado({}), false);
    for (const p of [{ q: "anillo" }, { categoria: "c1" }, { pagina: "2" }, { todo: "1" }]) assert.equal(esListado(p), true);
  });
});

describe("vitrina por negocio", () => {
  it("configuración editorial por publicación; un negocio sin configurar no obtiene hero ni banner (nada inventado)", () => {
    const d = storefrontConfigFor("delacour");
    assert.equal(heroOf(d)?.cta, "Ver catálogo");
    assert.ok(d.heroImage?.src.startsWith("/catalogo/delacour/"));
    assert.ok(d.bannerImage?.src.startsWith("/catalogo/delacour/"));
    assert.deepEqual(storefrontConfigFor("otro-negocio"), {});
    assert.equal(heroOf({}), null);
  });

  it("nunca un hero a medias: sin foto o sin título no hay hero; CTA por defecto", () => {
    assert.equal(heroOf({ heroTitle: "Solo título" }), null);
    const img = { src: "/x.png", width: 10, height: 10, alt: "x" };
    assert.equal(heroOf({ heroImage: img }), null);
    assert.equal(heroOf({ heroImage: img, heroTitle: "T" })?.cta, "Ver catálogo");
  });
});
