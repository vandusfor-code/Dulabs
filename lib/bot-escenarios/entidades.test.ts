import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extraerEntidades } from "@/lib/bot-escenarios/entidades";
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";

const CATALOGO: ServicioCatalogoReal[] = [
  { id: "s1", nombre: "Dipping", precio: 60000, duracionMin: 120, categoria: "Uñas", descripcion: null },
  { id: "s2", nombre: "Uña", precio: 8000, duracionMin: 15, categoria: "Uñas", descripcion: null },
  { id: "s3", nombre: "Maquillaje Suave", precio: 60000, duracionMin: 60, categoria: "Maquillaje", descripcion: null },
  { id: "s4", nombre: "Press On", precio: 80000, duracionMin: 120, categoria: "Uñas", descripcion: null },
];

const SIN_SINONIMOS = new Map<string, string[]>();
const SINONIMOS = new Map([["Uñas", ["uñas", "manicure"]]]);

describe("extraerEntidades — 100% determinista, sin IA", () => {
  it("detecta el servicio real más específico cuando varios nombres se solapan", () => {
    const r = extraerEntidades({ mensaje: "cuánto cuesta el Dipping", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS });
    assert.equal(r.servicioId, "s1");
    assert.equal(r.servicioNombre, "Dipping");
    assert.deepEqual(r.serviciosDetectados.map((s) => s.id), ["s1"]);
  });

  it("nunca inventa un servicio que no está en el catálogo", () => {
    const r = extraerEntidades({ mensaje: "quiero acrílicas", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS });
    assert.equal(r.servicioId, undefined);
    assert.deepEqual(r.serviciosDetectados, []);
  });

  it("detecta categoría real vía sinónimos configurados", () => {
    const r = extraerEntidades({ mensaje: "quiero hacerme las uñas", catalogo: CATALOGO, sinonimosPorCategoria: SINONIMOS });
    assert.equal(r.categoria, "Uñas");
  });

  it("hereda la categoría del servicio detectado si no hubo match directo de sinónimo", () => {
    const r = extraerEntidades({ mensaje: "cuanto cuesta la Uña", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS });
    assert.equal(r.categoria, "Uñas");
  });

  // Prueba real de WhatsApp (autorizado) — bug real encontrado: "uñas"
  // (categoría, plural) normalizaba igual que "Uña" (servicio, singular) y
  // colaba como substring, resolviendo por error al servicio puntual.
  describe("BUG REAL: categoría 'uñas' (plural) NUNCA debe resolver al servicio 'Uña' (singular)", () => {
    it("'quiero arreglarme las uñas' -- NO detecta el servicio Uña", () => {
      const r = extraerEntidades({ mensaje: "quiero arreglarme las uñas", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS });
      assert.equal(r.servicioId, undefined, "no debe resolver ningún servicio puntual");
    });

    it("'qué tienen para uñas' -- NO detecta el servicio Uña", () => {
      const r = extraerEntidades({ mensaje: "qué tienen para uñas", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS });
      assert.equal(r.servicioId, undefined);
    });

    it("'quiero Uña' (mención inequívoca, singular, servicio real) SÍ resuelve al servicio puntual", () => {
      const r = extraerEntidades({ mensaje: "quiero Uña", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS });
      assert.equal(r.servicioId, "s2");
      assert.equal(r.servicioNombre, "Uña");
    });

    it("el artículo indefinido 'una' (ej. 'quiero una cita') nunca se confunde con el servicio 'Uña'", () => {
      const r = extraerEntidades({ mensaje: "quiero una cita", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS });
      assert.equal(r.servicioId, undefined);
    });
  });

  describe("BUG REAL: comparación entre 2 servicios reales", () => {
    it("detecta AMBOS servicios cuando se mencionan los dos, en orden de aparición", () => {
      const r = extraerEntidades({ mensaje: "qué diferencia hay entre el dipping y press on", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS });
      assert.deepEqual(r.serviciosDetectados.map((s) => s.nombre), ["Dipping", "Press On"]);
      // Con 2+ servicios detectados, servicioId queda vacío a propósito --
      // nunca se resuelve unilateralmente al de nombre más largo (bug real).
      assert.equal(r.servicioId, undefined);
    });

    it("'Press On vs Dipping' respeta el orden real del mensaje", () => {
      const r = extraerEntidades({ mensaje: "Press On vs Dipping", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS });
      assert.deepEqual(r.serviciosDetectados.map((s) => s.nombre), ["Press On", "Dipping"]);
    });
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

  describe("BUG REAL: género de servicio nunca se asume sin evidencia explícita", () => {
    it("mensaje sin marcador de género -> indicaGeneroMasculino=false", () => {
      assert.equal(extraerEntidades({ mensaje: "quiero arreglarme las uñas", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS }).indicaGeneroMasculino, false);
    });
    it("'caballero'/'hombre'/'masculino' -> indicaGeneroMasculino=true", () => {
      assert.equal(extraerEntidades({ mensaje: "algo de caballero", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).indicaGeneroMasculino, true);
      assert.equal(extraerEntidades({ mensaje: "uñas para hombre", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).indicaGeneroMasculino, true);
      assert.equal(extraerEntidades({ mensaje: "algo masculino", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).indicaGeneroMasculino, true);
    });
  });

  describe("BUG REAL: referencia a opción de una lista ya mostrada (solo se calcula sin servicio/categoría propios)", () => {
    it("'la de 30 mil' -> referencia de tipo precio", () => {
      const r = extraerEntidades({ mensaje: "la de 30 mil", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS });
      assert.deepEqual(r.referenciaOpcion, { tipo: "precio", monto: 30000 });
    });
    it("'la segunda' -> referencia ordinal, posición 2", () => {
      const r = extraerEntidades({ mensaje: "la segunda", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS });
      assert.deepEqual(r.referenciaOpcion, { tipo: "ordinal", posicion: 2 });
    });
    it("'la última' -> referencia ordinal, posición -1", () => {
      const r = extraerEntidades({ mensaje: "la última", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS });
      assert.deepEqual(r.referenciaOpcion, { tipo: "ordinal", posicion: -1 });
    });
    it("'la más barata'/'la más cara' -> referencia de tipo extremo", () => {
      assert.deepEqual(extraerEntidades({ mensaje: "la más barata", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).referenciaOpcion, { tipo: "extremo", cual: "barata" });
      assert.deepEqual(extraerEntidades({ mensaje: "la más cara", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).referenciaOpcion, { tipo: "extremo", cual: "cara" });
    });
    it("'la de 2 horas' -> referencia de duración, NUNCA se confunde con precio (bug real encontrado)", () => {
      const r = extraerEntidades({ mensaje: "la de 2 horas", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS });
      assert.deepEqual(r.referenciaOpcion, { tipo: "duracion", minutos: 120 });
    });
    it("'la de una hora' -> 60 minutos", () => {
      assert.deepEqual(extraerEntidades({ mensaje: "la de una hora", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).referenciaOpcion, { tipo: "duracion", minutos: 60 });
    });
    it("'esa' sola -> referencia demostrativa", () => {
      assert.deepEqual(extraerEntidades({ mensaje: "esa", catalogo: [], sinonimosPorCategoria: SIN_SINONIMOS }).referenciaOpcion, { tipo: "demostrativo" });
    });
    it("si el mensaje YA nombra un servicio/categoría real, nunca calcula referenciaOpcion (ese servicio gana siempre)", () => {
      const r = extraerEntidades({ mensaje: "quiero el Dipping", catalogo: CATALOGO, sinonimosPorCategoria: SIN_SINONIMOS });
      assert.equal(r.referenciaOpcion, undefined);
    });
  });
});
