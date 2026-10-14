/**
 * Vista del catálogo público y configuración editorial de la vitrina — puro.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { esListado, esListadoDeUrl } from "@/lib/catalogo/inicio";
import { heroOf, storefrontConfigFor } from "@/lib/catalogo/vitrina";

describe("vista", () => {
  it("inicio sin parámetros; listado con búsqueda, categoría, página o 'ver todo'", () => {
    assert.equal(esListado({}), false);
    for (const p of [{ q: "anillo" }, { categoria: "c1" }, { pagina: "2" }, { todo: "1" }]) assert.equal(esListado(p), true);
  });

  it("los filtros de la joyería (color, material, precio) también llevan al listado, no al inicio", () => {
    for (const p of [{ color: "dorad" }, { material: "rodi" }, { precio_min: "6000" }, { precio_max: "30000" }]) assert.equal(esListado(p), true);
    assert.equal(esListado({ color: "", material: null, precio_min: undefined }), false, "vacío no cuenta");
  });

  it("el marco de la tienda decide con la dirección del navegador igual que el servidor", () => {
    for (const [qs, listado] of [["", false], ["?todo=1", true], ["?color=dorad", true], ["?material=rodi&pagina=2", true], ["?precio_max=30000", true], ["?utm_source=x", false]] as const) {
      assert.equal(esListadoDeUrl(new URLSearchParams(qs)), listado, qs);
    }
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
