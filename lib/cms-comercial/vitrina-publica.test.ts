/**
 * CMS comercial — carga de la vitrina pública con respaldo: la tienda NUNCA se cae ni se ve peor por el CMS.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Home } from "@/lib/cms-comercial/esquemas";
import type { ProductoParaCombo } from "@/lib/cms-comercial/evaluacion";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { AHORA, CAT_ARETES, TENANT_A, TENANT_B, campana, combo, home, instantanea, publicada } from "@/lib/cms-comercial/testing/fixtures";
import { cargarVitrinaInicio, opcionesDeInicio, type DepsVitrinaPublica } from "@/lib/cms-comercial/vitrina-publica";
import type { CatalogStorefrontConfig } from "@/lib/catalogo/vitrina";

const REGISTRO: CatalogStorefrontConfig = {
  brand: { name: "Tienda de prueba" },
  heroImage: { src: "/catalogo/prueba/hero.png", width: 1600, height: 900, alt: "Hero" },
  heroTitle: "Del registro",
};
const CTX = { slug: "prueba", basePath: "/catalogo/prueba", listPath: "/catalogo/prueba?todo=1", whatsapp: "573001112233", categorias: new Set([CAT_ARETES]) };

const homeCms = (over: Partial<Home> = {}): Home =>
  home({
    secciones: [
      { tipo: "portada", visible: true },
      { tipo: "categorias", visible: true },
      { tipo: "destacados", visible: true },
      { tipo: "campana", visible: true },
    ],
    categorias_destacadas: [CAT_ARETES],
    productos_destacados: ["DL-000001", "DL-000002"],
    ...over,
  });

interface Espias {
  tenantDe: string[];
  cargar: string[];
  fallas: unknown[];
}

function deps(snap: InstantaneaCms | null | Error | "colgada", over: Partial<DepsVitrinaPublica> = {}): { d: DepsVitrinaPublica; espias: Espias } {
  const espias: Espias = { tenantDe: [], cargar: [], fallas: [] };
  const d: DepsVitrinaPublica = {
    tenantDe: async (slug) => {
      espias.tenantDe.push(slug);
      return TENANT_A;
    },
    cargar: (tenantId) => {
      espias.cargar.push(tenantId);
      if (snap instanceof Error) return Promise.reject(snap);
      if (snap === "colgada") return new Promise(() => undefined);
      return Promise.resolve(snap);
    },
    ahora: () => AHORA,
    alFallar: (error) => void espias.fallas.push(error),
    ...over,
  };
  return { d, espias };
}

describe("cargarVitrinaInicio — con contenido publicado", () => {
  it("la vitrina sale del CMS y lleva lo que el catálogo debe resolver (destacados, categorías y productos de la campaña)", async () => {
    const snap = instantanea({
      home: publicada("home", homeCms()),
      campanas: [publicada("k", campana({ portada: { titulo: "Campaña" }, productos_destacados: ["DL-000005"] }))],
    });
    const { d } = deps(snap);
    const r = await cargarVitrinaInicio(d, REGISTRO, CTX);
    assert.equal(r.origen, "cms");
    assert.equal(r.config.heroTitle, "Historias que brillan contigo");
    assert.deepEqual(r.opciones, { destacadas: ["DL-000001", "DL-000002"], categorias: [CAT_ARETES], campana: ["DL-000005"] });
    assert.deepEqual(r.config.brand, REGISTRO.brand);
  });

  it("el negocio sale de la publicación (por el slug) y se lee SOLO ese negocio", async () => {
    const { d, espias } = deps(instantanea({ home: publicada("home", homeCms()) }));
    await cargarVitrinaInicio(d, REGISTRO, CTX);
    assert.deepEqual(espias.tenantDe, ["prueba"]);
    assert.deepEqual(espias.cargar, [TENANT_A]);
  });

  it("el id del negocio no aparece en lo que recibe la tienda", async () => {
    const { d } = deps(instantanea({ home: publicada("home", homeCms()) }));
    const r = await cargarVitrinaInicio(d, REGISTRO, CTX);
    assert.ok(!JSON.stringify(r).includes(TENANT_A));
    assert.ok(!JSON.stringify(r).includes(TENANT_B));
  });

  it("usa el reloj inyectado: la misma campaña se ve vigente un día y no al siguiente", async () => {
    const snap = instantanea({ home: publicada("home", homeCms()), campanas: [publicada("k", campana({ productos_destacados: ["DL-000005"] }))] });
    const hoy = await cargarVitrinaInicio(deps(snap).d, REGISTRO, CTX);
    assert.ok(hoy.config.campana);
    const despues = await cargarVitrinaInicio(deps(snap, { ahora: () => Date.parse("2026-11-05T12:00:00-05:00") }).d, REGISTRO, CTX);
    assert.equal(despues.config.campana, undefined);
    assert.deepEqual(despues.opciones.campana, undefined);
  });
});

describe("cargarVitrinaInicio — respaldo: se ve la vitrina de siempre", () => {
  const siempre = (r: Awaited<ReturnType<typeof cargarVitrinaInicio>>) => {
    assert.equal(r.config, REGISTRO, "la misma referencia: nada cambia");
    assert.deepEqual(r.opciones, {});
    assert.equal(r.origen, "registro");
  };

  it("módulo apagado o sin migración (el lector devuelve null): es lo normal, no una falla", async () => {
    const { d, espias } = deps(null);
    siempre(await cargarVitrinaInicio(d, REGISTRO, CTX));
    assert.deepEqual(espias.fallas, [], "no se avisa de nada: el CMS simplemente no existe para ese negocio");
  });

  it("tienda no publicada (sin negocio): ni siquiera se consulta el CMS", async () => {
    const { d, espias } = deps(instantanea({ home: publicada("home", homeCms()) }), { tenantDe: async () => null });
    siempre(await cargarVitrinaInicio(d, REGISTRO, CTX));
    assert.equal(espias.cargar.length, 0);
    assert.deepEqual(espias.fallas, []);
  });

  it("nada publicado (sin página principal): tampoco es una falla", async () => {
    const { d, espias } = deps(instantanea());
    siempre(await cargarVitrinaInicio(d, REGISTRO, CTX));
    assert.deepEqual(espias.fallas, []);
  });

  it("la tienda de tecnología tiene su propio contenido: no se consulta el CMS", async () => {
    const tecno: CatalogStorefrontConfig = { ...REGISTRO, tema: "tecnologia" };
    const { d, espias } = deps(instantanea({ home: publicada("home", homeCms()) }));
    const r = await cargarVitrinaInicio(d, tecno, CTX);
    assert.equal(r.config, tecno);
    assert.deepEqual(espias.tenantDe, []);
    assert.deepEqual(espias.cargar, []);
  });

  it("un error de la base de datos NO llega al cliente: se usa la vitrina de siempre y se avisa (una vez)", async () => {
    const { d, espias } = deps(new Error("connection reset"));
    siempre(await cargarVitrinaInicio(d, REGISTRO, CTX));
    assert.equal(espias.fallas.length, 1);
    assert.match(String((espias.fallas[0] as Error).message), /connection reset/);
  });

  it("un error al buscar el negocio tampoco rompe la tienda", async () => {
    const { d, espias } = deps(null, {
      tenantDe: async () => {
        throw new Error("boom");
      },
    });
    siempre(await cargarVitrinaInicio(d, REGISTRO, CTX));
    assert.equal(espias.fallas.length, 1);
  });

  it("una lectura que no termina: pasado el plazo se usa la vitrina de siempre", async () => {
    const { d, espias } = deps("colgada", { plazoMs: 25 });
    const t0 = Date.now();
    siempre(await cargarVitrinaInicio(d, REGISTRO, CTX));
    assert.ok(Date.now() - t0 < 1500, "no se queda esperando");
    assert.equal(espias.fallas.length, 1);
    assert.match(String((espias.fallas[0] as Error).message), /tardó demasiado/);
  });

  it("un aviso que falla no rompe la tienda", async () => {
    const { d } = deps(new Error("x"), {
      alFallar: () => {
        throw new Error("el aviso falló");
      },
    });
    siempre(await cargarVitrinaInicio(d, REGISTRO, CTX));
  });

  it("sin aviso configurado, se registra el motivo en consola (sin contenido del negocio) y la tienda sigue", async () => {
    const original = console.error;
    const lineas: unknown[][] = [];
    console.error = (...a: unknown[]) => void lineas.push(a);
    try {
      const { d } = deps(new Error("falla de prueba"), { alFallar: undefined });
      siempre(await cargarVitrinaInicio(d, REGISTRO, CTX));
    } finally {
      console.error = original;
    }
    assert.equal(lineas.length, 1);
    assert.match(String(lineas[0].join(" ")), /falla de prueba/);
  });
});

describe("opcionesDeInicio", () => {
  it("solo lleva lo elegido; sin elegidos, vacío (la tienda usa su criterio automático)", () => {
    assert.deepEqual(opcionesDeInicio({}), {});
    assert.deepEqual(opcionesDeInicio({ destacados: [], categoriasDestacadas: [], campana: { nombre: "K", productos: [] } }), {});
    assert.deepEqual(opcionesDeInicio({ destacados: ["DL-000001"], categoriasDestacadas: [CAT_ARETES], campana: { nombre: "K", productos: ["DL-000002"] } }), {
      destacadas: ["DL-000001"],
      categorias: [CAT_ARETES],
      campana: ["DL-000002"],
    });
  });
});

describe("cargarVitrinaInicio — combos (consulta de los datos reales de los componentes)", () => {
  const HECHOS: ReadonlyMap<string, ProductoParaCombo> = new Map(
    (
      [
        { referencia: "DL-000001", nombre: "Aretes dorados", activo: true, disponibilidad: "available", maxCantidad: 5, precioLista: 90_000 },
        { referencia: "DL-000002", nombre: "Cadena fina", activo: true, disponibilidad: "available", maxCantidad: null, precioLista: 50_000 },
      ] satisfies ProductoParaCombo[]
    ).map((p) => [p.referencia, p]),
  );
  const conCombo = () =>
    instantanea({
      home: publicada("home", home({ secciones: [{ tipo: "portada", visible: true }, { tipo: "combos", visible: true }], categorias_destacadas: [], productos_destacados: [] })),
      combos: [publicada("regalo", combo({ nombre: "Regalo completo", precio: { detal: 150_000, mayorista: 110_000 } })), publicada("mayor", combo({ modalidad: "mayorista", precio: { mayorista: 1_000 }, componentes: [{ referencia: "DL-000099", cantidad: 2 }] }))],
    });
  const llamadas: Array<{ tenantId: string; referencias: readonly string[] }> = [];
  const depsCombos = (snap: InstantaneaCms, productosDeCombos?: DepsVitrinaPublica["productosDeCombos"]): { d: DepsVitrinaPublica; fallas: unknown[] } => {
    const fallas: unknown[] = [];
    llamadas.length = 0;
    return {
      fallas,
      d: {
        tenantDe: async () => TENANT_A,
        cargar: async () => snap,
        ahora: () => AHORA,
        alFallar: (e) => void fallas.push(e),
        ...(productosDeCombos ? { productosDeCombos } : {}),
      },
    };
  };
  const consultar: DepsVitrinaPublica["productosDeCombos"] = async (tenantId, referencias) => (llamadas.push({ tenantId, referencias }), HECHOS);

  it("consulta SOLO los componentes de los combos vigentes para el detal, en el negocio de la tienda, y los combos salen armados", async () => {
    const { d } = depsCombos(conCombo(), consultar);
    const r = await cargarVitrinaInicio(d, REGISTRO, CTX);
    assert.deepEqual(llamadas, [{ tenantId: TENANT_A, referencias: ["DL-000001", "DL-000002"] }], "el combo mayorista no se consulta");
    assert.equal(r.origen, "cms");
    assert.deepEqual(r.config.combos?.map((c) => [c.clave, c.disponible, c.precioNormal, c.ahorro]), [["regalo", true, 190_000, 40_000]]);
  });

  it("sin combos vigentes no se consulta nada", async () => {
    const { d } = depsCombos(instantanea({ home: publicada("home", home({ secciones: [{ tipo: "portada", visible: true }, { tipo: "combos", visible: true }], categorias_destacadas: [], productos_destacados: [] })) }), consultar);
    await cargarVitrinaInicio(d, REGISTRO, CTX);
    assert.deepEqual(llamadas, []);
  });

  it("si la tienda no sabe consultar productos, los combos no se muestran y todo lo demás sale igual", async () => {
    const { d } = depsCombos(conCombo());
    const r = await cargarVitrinaInicio(d, REGISTRO, CTX);
    assert.equal(r.config.combos, undefined);
    assert.equal(r.origen, "cms");
    assert.equal(r.config.heroTitle, "Historias que brillan contigo");
  });

  it("si la consulta de productos FALLA solo se omiten los combos (se avisa una vez); la portada y lo demás salen", async () => {
    const { d, fallas } = depsCombos(conCombo(), async () => {
      throw new Error("base de datos caída");
    });
    const r = await cargarVitrinaInicio(d, REGISTRO, CTX);
    assert.equal(r.origen, "cms");
    assert.equal(r.config.combos, undefined);
    assert.equal(r.config.heroTitle, "Historias que brillan contigo");
    assert.equal(fallas.length, 1);
    assert.match(String((fallas[0] as Error).message), /base de datos caída/);
  });

  it("la consulta de productos también cuenta para el plazo: si no termina, se usa la vitrina de siempre", async () => {
    const { d, fallas } = depsCombos(conCombo(), () => new Promise(() => undefined));
    const r = await cargarVitrinaInicio({ ...d, plazoMs: 25 }, REGISTRO, CTX);
    assert.equal(r.config, REGISTRO);
    assert.equal(r.origen, "registro");
    assert.equal(fallas.length, 1);
  });
});
