import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extraerEntidades } from "@/lib/bot-escenarios/entidades";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";

const CATALOGO: ServicioCatalogoReal[] = [
  { id: "s1", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s2", nombre: "Uña", precio: 8000, duracionMin: 15, categoria: "Uñas", descripcion: null },
  { id: "s3", nombre: "Maquillaje Suave", precio: 60000, duracionMin: 60, categoria: "Maquillaje", descripcion: null },
];

const SIN_SINONIMOS = new Map<string, string[]>();
const SINONIMOS = new Map([["Uñas", ["uñas", "manicure"]]]);

describe("extraerEntidades — 100% determinista, sin IA", () => {
  it("detecta el servicio real más específico cuando varios nombres se solapan", () => {
    const r = extraerEntidades({ mensaje: "cuánto cuesta el Dipping", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS });
    assert.equal(r.servicioId, "s1");
    assert.equal(r.servicioNombre, "Dipping");
  });

  it("nunca inventa un servicio que no está en el catálogo", () => {
    const r = extraerEntidades({ mensaje: "quiero acrílicas", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS });
    assert.equal(r.servicioId, undefined);
  });

  it("detecta categoría real vía sinónimos configurados", () => {
    const r = extraerEntidades({ mensaje: "quiero hacerme las uñas", catalogo: CATALOGO, sinonimosPorCategoria: SINONIMOS });
    assert.equal(r.categoria, "Uñas");
  });

  it("hereda la categoría del servicio detectado si no hubo match directo de sinónimo", () => {
    const r = extraerEntidades({ mensaje: "cuanto cuesta la Uña", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS });
    assert.equal(r.categoria, "Uñas");
  });

  it("extrae presupuesto máximo (\"$X\", \"X mil\", \"máximo $X\")", () => {
    assert.equal(extraerEntidades({ mensaje: "quiero algo de máximo $50.000", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).presupuestoMax, 50000);
    assert.equal(extraerEntidades({ mensaje: "tengo 80 mil", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).presupuestoMax, 80000);
    assert.equal(extraerEntidades({ mensaje: "no menciona plata", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).presupuestoMax, undefined);
  });

  it("extrae duración máxima (\"una hora\", \"menos de X minutos\")", () => {
    assert.equal(extraerEntidades({ mensaje: "tengo solo una hora", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).duracionMaxMin, 60);
    assert.equal(extraerEntidades({ mensaje: "quiero algo de menos de 30 minutos", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).duracionMaxMin, 30);
  });

  it("reconoce afirmaciones/negaciones cortas exactas, nunca dentro de una frase más larga", () => {
    assert.equal(extraerEntidades({ mensaje: "sí", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).esAfirmacionCorta, true);
    assert.equal(extraerEntidades({ mensaje: "no", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).esNegacionCorta, true);
    assert.equal(extraerEntidades({ mensaje: "no sé qué hacerme", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).esNegacionCorta, false);
  });
});
