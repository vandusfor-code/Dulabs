/**
 * Las páginas propias en el MENÚ DE ARRIBA de la tienda (tema "joyeria"): qué páginas entran (solo las publicadas que ella marcó), cómo se llama cada enlace, en qué orden salen, hasta cuántas caben, cómo
 * arma el marco de la tienda el menú y las rutas (`enlacesDePaginas`) y que la lectura del pie las entrega junto con el pie (una sola lectura de la base). Cada regla es una forma real de que el menú
 * muestre un enlace que no debe, que cambie de lugar sin que ella haga nada o que desborde la cabecera.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checksumDe } from "@/lib/cms-comercial/checksum";
import { MAX_PAGINAS_EN_MENU, MAX_TEXTO_MENU_PAGINA, textoDeMenuDePagina } from "@/lib/cms-comercial/esquemas";
import { construirInstantanea } from "@/lib/cms-comercial/lector";
import { enlacesDePaginas, paginasDelMenu } from "@/lib/cms-comercial/pagina";
import { cargarPiePublico, type DepsPiePublico } from "@/lib/cms-comercial/pie-publico";
import type { PublicadoCrudo } from "@/lib/cms-comercial/repositorio";
import { instantanea, pagina, publicada, TENANT_A } from "@/lib/cms-comercial/testing/fixtures";

/** Una página publicada, ya en el menú (o no), creada en el instante dado. */
const enMenu = (clave: string, creadaAt: string, over: Parameters<typeof pagina>[0] = {}) => publicada(clave, pagina({ en_menu: true, ...over }), { creadaAt });

describe("cómo se llama una página en el menú", () => {
  it("el texto que ella escribió para el menú y, si no escribió ninguno, el título de la página", () => {
    assert.equal(textoDeMenuDePagina({ titulo: "Quiénes somos" }), "Quiénes somos");
    assert.equal(textoDeMenuDePagina({ titulo: "Política de tratamiento de datos personales", texto_menu: "Tus datos" }), "Tus datos");
  });

  it("el tope del texto del menú es 24 caracteres y es el que muestra el panel", () => {
    assert.equal(MAX_TEXTO_MENU_PAGINA, 24);
    assert.equal(MAX_PAGINAS_EN_MENU, 4);
  });
});

describe("paginasDelMenu — qué páginas entran al menú de arriba", () => {
  it("sin nada publicado (o sin CMS para el negocio) el menú no tiene páginas", () => {
    assert.deepEqual(paginasDelMenu(null), []);
    assert.deepEqual(paginasDelMenu(instantanea({})), []);
  });

  it("solo entran las que ella marcó: una página publicada sin marcar, o con el menú apagado, no aparece", () => {
    const snap = instantanea({
      paginas: [publicada("terminos", pagina({ titulo: "Términos y condiciones" })), publicada("cambios", pagina({ titulo: "Cambios", en_menu: false })), enMenu("quienes-somos", "2026-10-01T12:00:00Z", { titulo: "Quiénes somos" })],
    });
    assert.deepEqual(paginasDelMenu(snap), [{ clave: "quienes-somos", texto: "Quiénes somos" }]);
  });

  it("el enlace dice el texto del menú si lo hay y, si no, el título de la página", () => {
    const snap = instantanea({
      paginas: [enMenu("a", "2026-10-01T10:00:00Z", { titulo: "Quiénes somos" }), enMenu("b", "2026-10-01T11:00:00Z", { titulo: "Política de tratamiento de datos personales", texto_menu: "Tus datos" })],
    });
    assert.deepEqual(paginasDelMenu(snap), [
      { clave: "a", texto: "Quiénes somos" },
      { clave: "b", texto: "Tus datos" },
    ]);
  });

  it("salen en el orden en que se crearon (la más antigua primero), no en el de la lista ni por el código", () => {
    const snap = instantanea({ paginas: [enMenu("zeta", "2026-10-01T10:00:00Z"), enMenu("alfa", "2026-10-03T10:00:00Z"), enMenu("medio", "2026-10-02T10:00:00Z")] });
    assert.deepEqual(paginasDelMenu(snap).map((p) => p.clave), ["zeta", "medio", "alfa"]);
  });

  it("el orden es por el instante real, aunque las fechas vengan escritas con otra zona horaria", () => {
    // «2026-10-01T23:00-05:00» es el 2 de octubre a las 04:00 UTC: es MÁS TARDE que «2026-10-02T01:00Z», aunque como texto parezca anterior.
    const snap = instantanea({ paginas: [enMenu("tarde", "2026-10-01T23:00:00-05:00"), enMenu("temprano", "2026-10-02T01:00:00Z")] });
    assert.deepEqual(paginasDelMenu(snap).map((p) => p.clave), ["temprano", "tarde"]);
  });

  it("dos páginas creadas en el mismo instante se ordenan por su código: el menú no baila entre cargas", () => {
    const snap = instantanea({ paginas: [enMenu("b", "2026-10-01T10:00:00Z"), enMenu("a", "2026-10-01T10:00:00Z")] });
    assert.deepEqual(paginasDelMenu(snap).map((p) => p.clave), ["a", "b"]);
  });

  it("volver a publicar o editar una página no la cambia de lugar (el orden sale de cuándo se creó, no de cuándo se publicó)", () => {
    const antes = instantanea({ paginas: [enMenu("primera", "2026-10-01T10:00:00Z", {}), enMenu("segunda", "2026-10-02T10:00:00Z", {})] });
    const despues = instantanea({
      paginas: [
        publicada("primera", pagina({ en_menu: true, titulo: "Primera editada" }), { creadaAt: "2026-10-01T10:00:00Z", publicadaAt: "2026-10-30T09:00:00Z", version: 5 }),
        enMenu("segunda", "2026-10-02T10:00:00Z"),
      ],
    });
    assert.deepEqual(paginasDelMenu(antes).map((p) => p.clave), ["primera", "segunda"]);
    assert.deepEqual(paginasDelMenu(despues).map((p) => p.clave), ["primera", "segunda"]);
  });

  it("caben hasta 4: si hubiera más (algo que el panel no deja publicar, pero sí reanudar), se quedan las 4 más antiguas y la cabecera no se desborda", () => {
    const paginas = Array.from({ length: 6 }, (_, i) => enMenu(`pagina-${i + 1}`, `2026-10-0${i + 1}T10:00:00Z`));
    const menu = paginasDelMenu(instantanea({ paginas }));
    assert.equal(menu.length, MAX_PAGINAS_EN_MENU);
    assert.deepEqual(menu.map((p) => p.clave), ["pagina-1", "pagina-2", "pagina-3", "pagina-4"]);
  });

  it("no altera la instantánea que recibe (la misma lista sirve después para el pie)", () => {
    const paginas = [enMenu("b", "2026-10-02T10:00:00Z"), enMenu("a", "2026-10-01T10:00:00Z")];
    const snap = instantanea({ paginas });
    paginasDelMenu(snap);
    assert.deepEqual(snap.paginas.map((p) => p.clave), ["b", "a"]);
  });
});

describe("enlacesDePaginas — lo que el marco de la tienda hace con las páginas publicadas", () => {
  const BASE = "/catalogo/delacour";

  it("el menú lleva a /catalogo/{tienda}/p/{código} y las rutas aparte incluyen TODAS las páginas, también las que no están en el menú", () => {
    const enlaces = enlacesDePaginas(BASE, { menu: [{ clave: "quienes-somos", texto: "Quiénes somos" }], paginas: ["quienes-somos", "terminos"] });
    assert.deepEqual(enlaces.menu, [{ texto: "Quiénes somos", href: "/catalogo/delacour/p/quienes-somos" }]);
    assert.deepEqual(enlaces.rutasAparte, ["/catalogo/delacour/p/quienes-somos", "/catalogo/delacour/p/terminos"]);
  });

  it("la página de mayoristas va primero entre las rutas aparte (la barra inferior tampoco marca ninguna pestaña allí)", () => {
    const enlaces = enlacesDePaginas(BASE, { menu: [], paginas: ["terminos"] }, `${BASE}/mayoristas`);
    assert.deepEqual(enlaces.rutasAparte, [`${BASE}/mayoristas`, `${BASE}/p/terminos`]);
    assert.deepEqual(enlacesDePaginas(BASE, { menu: [], paginas: [] }, `${BASE}/mayoristas`).rutasAparte, [`${BASE}/mayoristas`], "solo mayoristas: como antes de las páginas");
  });

  it("sin páginas ni mayoristas: nada en el menú y rutasAparte sin definir (la barra se comporta como siempre)", () => {
    assert.deepEqual(enlacesDePaginas(BASE, { menu: [], paginas: [] }), { menu: [], rutasAparte: undefined });
  });
});

describe("la lectura del pie entrega también el menú (una sola lectura de la base)", () => {
  type Llamadas = { cargar: string[] };
  function deps(snap: ReturnType<typeof instantanea> | null): { deps: DepsPiePublico; llamadas: Llamadas } {
    const llamadas: Llamadas = { cargar: [] };
    return {
      llamadas,
      deps: {
        tenantDe: async (slug) => (slug === "delacour" ? TENANT_A : null),
        cargar: async (tenantId) => {
          llamadas.cargar.push(tenantId);
          return snap;
        },
        alFallar: () => {},
      },
    };
  }

  it("junto con las páginas publicadas, las que van en el menú, en un solo pedido al lector", async () => {
    const snap = instantanea({ paginas: [publicada("terminos", pagina({ titulo: "Términos" })), enMenu("quienes-somos", "2026-10-01T12:00:00Z", { titulo: "Quiénes somos" })] });
    const { deps: d, llamadas } = deps(snap);
    const datos = await cargarPiePublico(d, "delacour");
    assert.deepEqual(datos.paginas, ["terminos", "quienes-somos"]);
    assert.deepEqual(datos.menu, [{ clave: "quienes-somos", texto: "Quiénes somos" }]);
    assert.equal(llamadas.cargar.length, 1, "el menú sale de la misma lectura que el pie: no suma consultas");
  });

  it("sin CMS, con una tienda que no existe o ante un error, no hay menú (y la tienda se ve como siempre)", async () => {
    assert.deepEqual((await cargarPiePublico(deps(null).deps, "delacour")).menu, []);
    assert.deepEqual((await cargarPiePublico(deps(instantanea({})).deps, "otra-tienda")).menu, []);
    const roto = deps(null);
    roto.deps.cargar = async () => {
      throw new Error("conexión rechazada");
    };
    assert.deepEqual(await cargarPiePublico(roto.deps, "delacour"), { pie: null, paginas: [], menu: [] });
  });
});

describe("el lector del CMS y el menú: lo que se publica es lo que se lee", () => {
  let n = 0;
  function crudo(clave: string, contenido: unknown, over: Partial<PublicadoCrudo> = {}): PublicadoCrudo {
    n += 1;
    return { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, tipo: "pagina", clave, estado: "publicada", version: 1, checksum: checksumDe(contenido), contenido, publicadaAt: "2026-10-20T12:00:00Z", creadaAt: "2026-10-01T08:30:00Z", ...over };
  }
  const leer = (...entidades: PublicadoCrudo[]) => construirInstantanea(TENANT_A, { entidades, assets: [] });

  it("una página publicada con el menú encendido llega al menú con su texto", () => {
    const { snap, descartados } = leer(crudo("quienes-somos", pagina({ titulo: "Quiénes somos", en_menu: true })));
    assert.deepEqual(descartados, []);
    assert.deepEqual(paginasDelMenu(snap), [{ clave: "quienes-somos", texto: "Quiénes somos" }]);
  });

  it("una página con un título demasiado largo para el menú y sin texto propio se descarta: nunca llega a la cabecera con el texto desbordado", () => {
    const larga = pagina({ titulo: "Política de tratamiento de datos personales", en_menu: true });
    const { snap, descartados } = leer(crudo("datos", larga));
    assert.deepEqual(paginasDelMenu(snap), []);
    assert.deepEqual(descartados, [{ clave: "datos", tipo: "pagina", motivo: "esquema" }]);
  });

  it("la misma página con su texto corto para el menú sí se lee", () => {
    const { snap, descartados } = leer(crudo("datos", pagina({ titulo: "Política de tratamiento de datos personales", en_menu: true, texto_menu: "Tus datos" })));
    assert.deepEqual(descartados, []);
    assert.deepEqual(paginasDelMenu(snap), [{ clave: "datos", texto: "Tus datos" }]);
  });

  it("un campo de más en la página (otra manera de colar algo al menú) se descarta, como cualquier contenido que no cumple el esquema", () => {
    const { snap, descartados } = leer(crudo("quienes-somos", { ...pagina({ en_menu: true }), enlace_menu: "https://sitio-malo.com" }));
    assert.deepEqual(paginasDelMenu(snap), []);
    assert.deepEqual(descartados.map((d) => d.motivo), ["esquema"]);
  });
});
