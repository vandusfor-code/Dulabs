/**
 * Carga de una página propia publicada (pagina-publica.ts) con dependencias falsas: sin red ni base de datos. A diferencia del pie, una página no tiene un «de siempre»: el resultado distingue la
 * página, que NO existe (404) y que no se pudo leer (se dice, sin fingir que no existe). También, que el lector del CMS solo entrega páginas publicadas y válidas, y el pie las lista.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checksumDe } from "@/lib/cms-comercial/checksum";
import { construirInstantanea } from "@/lib/cms-comercial/lector";
import { cargarPaginaPublica, PLAZO_PAGINA_MS, type DepsPaginaPublica } from "@/lib/cms-comercial/pagina-publica";
import { cargarPiePublico } from "@/lib/cms-comercial/pie-publico";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import type { LecturaActivaCruda, PublicadoCrudo } from "@/lib/cms-comercial/repositorio";
import { instantanea, pagina, pie, publicada, TENANT_A, TENANT_B } from "@/lib/cms-comercial/testing/fixtures";

const SNAP_A = instantanea({ paginas: [publicada("politica-de-privacidad", pagina(), { publicadaAt: "2026-10-15T15:00:00.000Z" })], pie: publicada("pie", pie()) });
const SNAP_B = instantanea({ tenantId: TENANT_B, paginas: [publicada("terminos", pagina({ titulo: "Términos de la otra tienda" }))] });

type Llamadas = { tenantDe: string[]; cargar: string[]; avisos: unknown[] };
function deps(over: Partial<DepsPaginaPublica> = {}): { deps: DepsPaginaPublica; llamadas: Llamadas } {
  const llamadas: Llamadas = { tenantDe: [], cargar: [], avisos: [] };
  return {
    llamadas,
    deps: {
      async tenantDe(slug) {
        llamadas.tenantDe.push(slug);
        return slug === "tienda-a" ? TENANT_A : slug === "tienda-b" ? TENANT_B : null;
      },
      async cargar(tenantId) {
        llamadas.cargar.push(tenantId);
        return tenantId === TENANT_A ? SNAP_A : tenantId === TENANT_B ? SNAP_B : null;
      },
      alFallar: (error) => llamadas.avisos.push(error),
      ...over,
    },
  };
}

describe("cargar una página publicada", () => {
  it("con la página publicada: la devuelve con su título, sus bloques y cuándo se publicó", async () => {
    const { deps: d, llamadas } = deps();
    const r = await cargarPaginaPublica(d, "tienda-a", "politica-de-privacidad");
    assert.deepEqual(r, { estado: "ok", pagina: { clave: "politica-de-privacidad", titulo: "Política de privacidad", bloques: pagina().bloques, actualizadaAt: "2026-10-15T15:00:00.000Z" } });
    assert.deepEqual([llamadas.tenantDe, llamadas.cargar, llamadas.avisos], [["tienda-a"], [TENANT_A], []]);
  });

  it("el negocio sale de la tienda (el slug): la página de otra tienda no se entrega aunque tenga el mismo código", async () => {
    const { deps: d } = deps();
    assert.equal((await cargarPaginaPublica(d, "tienda-a", "terminos")).estado, "no_existe", "«terminos» es de la tienda B");
    const b = await cargarPaginaPublica(d, "tienda-b", "terminos");
    assert.equal(b.estado === "ok" && b.pagina.titulo, "Términos de la otra tienda");
  });

  it("una tienda que no existe no lee nada más", async () => {
    const { deps: d, llamadas } = deps();
    assert.deepEqual(await cargarPaginaPublica(d, "otra-tienda", "politica-de-privacidad"), { estado: "no_existe" });
    assert.deepEqual([llamadas.cargar, llamadas.avisos], [[], []]);
  });

  it("un código que no tiene el formato de un código no consulta nada (ni la tienda ni la base)", async () => {
    const { deps: d, llamadas } = deps();
    for (const mal of ["", "../x", "A", "a b", "a".repeat(81), "%2e%2e", "politica/privacidad"]) assert.deepEqual(await cargarPaginaPublica(d, "tienda-a", mal), { estado: "no_existe" }, JSON.stringify(mal));
    assert.deepEqual([llamadas.tenantDe, llamadas.cargar], [[], []]);
  });

  it("sin CMS para ese negocio, o sin esa página publicada → no existe, sin avisar (no es un error)", async () => {
    const sinCms = deps({ cargar: async () => null });
    assert.deepEqual(await cargarPaginaPublica(sinCms.deps, "tienda-a", "politica-de-privacidad"), { estado: "no_existe" });
    const sinPagina = deps({ cargar: async () => instantanea({}) });
    assert.deepEqual(await cargarPaginaPublica(sinPagina.deps, "tienda-a", "politica-de-privacidad"), { estado: "no_existe" });
    assert.equal(sinCms.llamadas.avisos.length + sinPagina.llamadas.avisos.length, 0);
  });

  it("un error de la base de datos → «error» y un aviso con el motivo (nunca con el contenido); no se finge que la página no existe", async () => {
    const { deps: d, llamadas } = deps({
      cargar: async () => {
        throw new Error("conexión rechazada");
      },
    });
    assert.deepEqual(await cargarPaginaPublica(d, "tienda-a", "politica-de-privacidad"), { estado: "error" });
    assert.equal(llamadas.avisos.length, 1);
    assert.match(String((llamadas.avisos[0] as Error).message), /conexión rechazada/);
  });

  it("si falla al buscar la tienda también es «error»", async () => {
    const { deps: d, llamadas } = deps({
      tenantDe: async () => {
        throw new Error("sin conexión");
      },
    });
    assert.deepEqual(await cargarPaginaPublica(d, "tienda-a", "politica-de-privacidad"), { estado: "error" });
    assert.equal(llamadas.avisos.length, 1);
  });

  it("una lectura demasiado lenta se corta: pasado el plazo → «error» y un aviso", async () => {
    const { deps: d, llamadas } = deps({ cargar: () => new Promise<InstantaneaCms | null>(() => {}), plazoMs: 20 });
    const t0 = Date.now();
    assert.deepEqual(await cargarPaginaPublica(d, "tienda-a", "politica-de-privacidad"), { estado: "error" });
    assert.ok(Date.now() - t0 < 1000, "no espera de más");
    assert.match(String((llamadas.avisos[0] as Error).message), /tardó demasiado/);
  });

  it("el plazo por defecto es de 2,5 s: una página es el contenido de la pantalla y se le da un poco más que al pie", () => {
    assert.equal(PLAZO_PAGINA_MS, 2500);
  });

  it("un aviso que lanza no rompe nada: igual devuelve «error»", async () => {
    const { deps: d } = deps({
      tenantDe: async () => {
        throw new Error("x");
      },
      alFallar: () => {
        throw new Error("el aviso también falla");
      },
    });
    assert.deepEqual(await cargarPaginaPublica(d, "tienda-a", "politica-de-privacidad"), { estado: "error" });
  });
});

describe("el pie conoce las páginas publicadas", () => {
  it("entrega los códigos de las páginas publicadas junto con el pie, en una sola lectura", async () => {
    const { deps: d, llamadas } = deps();
    assert.deepEqual(await cargarPiePublico(d, "tienda-a"), { pie: pie(), paginas: ["politica-de-privacidad"] });
    assert.deepEqual(llamadas.cargar, [TENANT_A]);
  });

  it("sin pie publicado igual entrega las páginas (se puede enlazar a ellas desde el pie de siempre solo si hay un pie: aquí solo se informan)", async () => {
    const { deps: d } = deps({ cargar: async () => instantanea({ paginas: [publicada("terminos", pagina())] }) });
    assert.deepEqual(await cargarPiePublico(d, "tienda-a"), { pie: null, paginas: ["terminos"] });
  });
});

describe("el lector entrega solo páginas publicadas y válidas", () => {
  let n = 0;
  function crudo(clave: string, cont: unknown, over: Partial<PublicadoCrudo> = {}): PublicadoCrudo {
    n += 1;
    return { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, tipo: "pagina", clave, estado: "publicada", version: 1, checksum: checksumDe(cont), contenido: cont, publicadaAt: "2026-10-20T12:00:00Z", creadaAt: "2026-10-01T08:30:00Z", ...over };
  }
  const lectura = (entidades: PublicadoCrudo[]): LecturaActivaCruda => ({ entidades, assets: [] });

  it("clasifica las páginas junto con los demás tipos, ya validadas por el esquema, en el orden en que llegan", () => {
    const { snap, descartados } = construirInstantanea(TENANT_A, lectura([crudo("terminos", pagina({ titulo: "Términos" })), crudo("privacidad", pagina())]));
    assert.deepEqual(descartados, []);
    assert.deepEqual(snap.paginas.map((x) => x.clave), ["terminos", "privacidad"]);
    assert.deepEqual(snap.paginas[1].contenido, pagina());
    assert.deepEqual(construirInstantanea(TENANT_A, lectura([])).snap.paginas, []);
  });

  it("una página pausada no existe para la tienda", () => {
    const { snap, descartados } = construirInstantanea(TENANT_A, lectura([crudo("terminos", pagina(), { estado: "pausada" })]));
    assert.deepEqual(snap.paginas, []);
    assert.deepEqual(descartados, [{ clave: "terminos", tipo: "pagina", motivo: "no_publicada" }]);
  });

  it("una página que no cumple el esquema (HTML, un bloque desconocido) o cuyo checksum no coincide se descarta: nunca se muestra a medias", () => {
    const conHtml = { ...pagina(), bloques: [{ tipo: "parrafo", texto: "<script>alert(1)</script>" }] };
    const conImagen = { ...pagina(), bloques: [{ tipo: "imagen", src: "https://x.test/a.png" }] };
    const a = construirInstantanea(TENANT_A, lectura([crudo("html", conHtml), crudo("imagen", conImagen), crudo("tocada", { ...pagina(), titulo: "Tocada a mano" }, { checksum: checksumDe(pagina()) })]));
    assert.deepEqual(a.snap.paginas, []);
    assert.deepEqual(a.descartados.map((d) => d.motivo), ["esquema", "esquema", "checksum"]);
  });
});
