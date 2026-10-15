/**
 * Carga del pie publicado (pie-publico.ts) con dependencias falsas: sin red ni base de datos. El pie sale en TODAS las pantallas de la tienda, así que nunca puede romperlas ni demorarlas: ante
 * cualquier problema devuelve null y la tienda dibuja el pie de siempre. También, que el lector del CMS entrega el pie publicado (y solo UNO, y solo si cumple el esquema).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checksumDe } from "@/lib/cms-comercial/checksum";
import { construirInstantanea } from "@/lib/cms-comercial/lector";
import { cargarPiePublico, PLAZO_PIE_MS, type DepsPiePublico } from "@/lib/cms-comercial/pie-publico";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import type { LecturaActivaCruda, PublicadoCrudo } from "@/lib/cms-comercial/repositorio";
import { instantanea, pie, publicada, TENANT_A } from "@/lib/cms-comercial/testing/fixtures";

const PIE = pie({ descripcion: "Joyas para ti.", redes: [{ red: "instagram", url: "https://instagram.com/delacour" }] });
const SIN_PIE = { pie: null, paginas: [] };
const SNAP = instantanea({ pie: publicada("pie", PIE) });

type Llamadas = { tenantDe: string[]; cargar: string[]; avisos: unknown[] };
function deps(over: Partial<DepsPiePublico> = {}): { deps: DepsPiePublico; llamadas: Llamadas } {
  const llamadas: Llamadas = { tenantDe: [], cargar: [], avisos: [] };
  return {
    llamadas,
    deps: {
      async tenantDe(slug) {
        llamadas.tenantDe.push(slug);
        return slug === "delacour" ? TENANT_A : null;
      },
      async cargar(tenantId) {
        llamadas.cargar.push(tenantId);
        return SNAP;
      },
      alFallar: (error) => llamadas.avisos.push(error),
      ...over,
    },
  };
}

describe("cargar el pie publicado", () => {
  it("con un pie publicado: devuelve su contenido", async () => {
    const { deps: d, llamadas } = deps();
    assert.deepEqual(await cargarPiePublico(d, "delacour"), { pie: PIE, paginas: [] });
    assert.deepEqual([llamadas.tenantDe, llamadas.cargar, llamadas.avisos], [["delacour"], [TENANT_A], []]);
  });

  it("el negocio sale de la tienda publicada (el slug): una tienda que no existe no lee nada más", async () => {
    const { deps: d, llamadas } = deps();
    assert.deepEqual(await cargarPiePublico(d, "otra-tienda"), SIN_PIE);
    assert.deepEqual([llamadas.cargar, llamadas.avisos], [[], []]);
  });

  it("sin CMS para ese negocio (módulo apagado o sin migración) o sin pie publicado → null, sin avisar (no es un error)", async () => {
    const sinCms = deps({ cargar: async () => null });
    assert.deepEqual(await cargarPiePublico(sinCms.deps, "delacour"), SIN_PIE);
    const sinPie = deps({ cargar: async () => instantanea({}) });
    assert.deepEqual(await cargarPiePublico(sinPie.deps, "delacour"), SIN_PIE);
    assert.equal(sinCms.llamadas.avisos.length + sinPie.llamadas.avisos.length, 0);
  });

  it("un error de la base de datos → null y un aviso con el motivo (nunca con el contenido), sin romper la tienda", async () => {
    const { deps: d, llamadas } = deps({
      cargar: async () => {
        throw new Error("conexión rechazada");
      },
    });
    assert.deepEqual(await cargarPiePublico(d, "delacour"), SIN_PIE);
    assert.equal(llamadas.avisos.length, 1);
    assert.match(String((llamadas.avisos[0] as Error).message), /conexión rechazada/);
  });

  it("una lectura demasiado lenta se corta: pasado el plazo → null y un aviso, y la tienda sigue con su pie de siempre", async () => {
    const { deps: d, llamadas } = deps({ cargar: () => new Promise<InstantaneaCms | null>(() => {}), plazoMs: 20 });
    const t0 = Date.now();
    assert.deepEqual(await cargarPiePublico(d, "delacour"), SIN_PIE);
    assert.ok(Date.now() - t0 < 1000, "no espera de más");
    assert.equal(llamadas.avisos.length, 1);
    assert.match(String((llamadas.avisos[0] as Error).message), /tardó demasiado/);
  });

  it("el plazo por defecto es corto (2 s): el pie va en todas las pantallas y no debe hacer esperar al cliente", () => {
    assert.equal(PLAZO_PIE_MS, 2000);
  });

  it("un aviso que lanza no rompe nada: igual devuelve null", async () => {
    const { deps: d } = deps({
      tenantDe: async () => {
        throw new Error("x");
      },
      alFallar: () => {
        throw new Error("el aviso también falla");
      },
    });
    assert.deepEqual(await cargarPiePublico(d, "delacour"), SIN_PIE);
  });
});

describe("el lector entrega el pie publicado", () => {
  let n = 0;
  function crudo(tipo: string, clave: string, cont: unknown, over: Partial<PublicadoCrudo> = {}): PublicadoCrudo {
    n += 1;
    return { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, tipo, clave, estado: "publicada", version: 1, checksum: checksumDe(cont), contenido: cont, publicadaAt: "2026-10-20T12:00:00Z", creadaAt: "2026-10-01T08:30:00Z", ...over };
  }
  const lectura = (entidades: PublicadoCrudo[]): LecturaActivaCruda => ({ entidades, assets: [] });

  it("clasifica el pie junto con los demás tipos y lo entrega ya validado por el esquema", () => {
    const { snap, descartados } = construirInstantanea(TENANT_A, lectura([crudo("pie", "pie", PIE)]));
    assert.deepEqual(descartados, []);
    assert.equal(snap.pie?.clave, "pie");
    assert.deepEqual(snap.pie?.contenido, PIE);
    assert.equal(construirInstantanea(TENANT_A, lectura([])).snap.pie, null);
  });

  it("un pie que no cumple el esquema o cuyo checksum no coincide se descarta: la tienda usa el de siempre, nunca uno a medias", () => {
    const peligroso = { ...PIE, redes: [{ red: "instagram", url: "https://sitio-malo.com/delacour" }] };
    const a = construirInstantanea(TENANT_A, lectura([crudo("pie", "pie", peligroso)]));
    assert.equal(a.snap.pie, null);
    assert.deepEqual(a.descartados, [{ clave: "pie", tipo: "pie", motivo: "esquema" }]);
    const b = construirInstantanea(TENANT_A, lectura([crudo("pie", "pie", { ...PIE, descripcion: "tocado a mano" }, { checksum: checksumDe(PIE) })]));
    assert.equal(b.snap.pie, null);
    assert.deepEqual(b.descartados, [{ clave: "pie", tipo: "pie", motivo: "checksum" }]);
  });

  it("solo UN pie: si la base trajera dos, se queda el primero y el repetido se descarta", () => {
    const { snap, descartados } = construirInstantanea(TENANT_A, lectura([crudo("pie", "pie", PIE), crudo("pie", "pie", { ...PIE, descripcion: "otro" })]));
    assert.equal(snap.pie?.contenido.descripcion, "Joyas para ti.");
    assert.deepEqual(descartados.map((d) => d.motivo), ["repetida"]);
  });
});
