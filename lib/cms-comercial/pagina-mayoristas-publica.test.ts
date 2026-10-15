/**
 * Carga de la página «Mayoristas» con respaldo (pagina-mayoristas-publica.ts), con dependencias falsas: sin red ni base de datos. La página NUNCA se cae por el CMS: ante cualquier problema
 * (sin tienda, sin CMS, error, lectura lenta) devuelve null y la tienda dibuja la página solo con su texto y su botón de WhatsApp.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cargarPaginaMayoristas, PLAZO_PAGINA_MAYORISTAS_MS, type DepsPaginaMayoristas } from "@/lib/cms-comercial/pagina-mayoristas-publica";
import type { VariablesNegocio } from "@/lib/cms-comercial/puertos";
import type { InstantaneaCms } from "@/lib/cms-comercial/publicado";
import { AHORA, contenido, instantanea, publicada, TENANT_A } from "@/lib/cms-comercial/testing/fixtures";

const NEGOCIO: VariablesNegocio = { variables: { minimo_mayorista: "$750.000" }, minimoMayorista: 750_000 };
const OPCIONES = { intro: "venta-al-por-mayor", omitir: ["emprendimiento"], tambien: ["envios"] };
const SNAP = instantanea({
  contenidos: [
    publicada("venta-al-por-mayor", contenido({ tema: "mayoristas", titulo: "Venta al por mayor", texto: "Compra inicial desde {{minimo_mayorista}}." })),
    publicada("como-compro", contenido({ tema: "mayoristas", titulo: "¿Cómo compro?", texto: "Escríbenos.", orden: 10 })),
    publicada("envios", contenido({ tema: "envios", titulo: "Envíos", texto: "Sí hacemos envíos." })),
  ],
});

type Llamadas = { tenantDe: string[]; cargar: string[]; negocio: string[]; avisos: unknown[] };
function deps(over: Partial<DepsPaginaMayoristas> = {}): { deps: DepsPaginaMayoristas; llamadas: Llamadas } {
  const llamadas: Llamadas = { tenantDe: [], cargar: [], negocio: [], avisos: [] };
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
      async negocio(tenantId) {
        llamadas.negocio.push(tenantId);
        return NEGOCIO;
      },
      ahora: () => AHORA,
      alFallar: (error) => llamadas.avisos.push(error),
      ...over,
    },
  };
}

describe("cargar la página de mayoristas", () => {
  it("con todo en orden: arma la página con lo publicado, las variables del negocio y el reloj inyectado", async () => {
    const { deps: d, llamadas } = deps();
    const p = await cargarPaginaMayoristas(d, "delacour", OPCIONES);
    assert.deepEqual(p, {
      intro: { titulo: "Venta al por mayor", texto: "Compra inicial desde $750.000." },
      preguntas: [
        { clave: "como-compro", titulo: "¿Cómo compro?", texto: "Escríbenos." },
        { clave: "envios", titulo: "Envíos", texto: "Sí hacemos envíos." },
      ],
    });
    assert.deepEqual([llamadas.tenantDe, llamadas.cargar, llamadas.negocio, llamadas.avisos], [["delacour"], [TENANT_A], [TENANT_A], []]);
  });

  it("el negocio sale de la tienda publicada (el slug), jamás de la petición: una tienda que no existe no lee nada más", async () => {
    const { deps: d, llamadas } = deps();
    assert.equal(await cargarPaginaMayoristas(d, "otra-tienda", OPCIONES), null);
    assert.deepEqual([llamadas.cargar, llamadas.negocio, llamadas.avisos], [[], [], []], "ni el CMS ni la configuración se tocan, y no es una falla que avisar");
  });

  it("sin CMS para ese negocio (módulo apagado o sin migración) → null, sin avisar (no es un error)", async () => {
    const { deps: d, llamadas } = deps({ cargar: async () => null });
    assert.equal(await cargarPaginaMayoristas(d, "delacour", OPCIONES), null);
    assert.equal(llamadas.avisos.length, 0);
  });

  it("el CMS y la configuración se piden A LA VEZ (la página espera al más lento, no a la suma)", async () => {
    const empezadas: string[] = [];
    let liberarCms!: (s: InstantaneaCms | null) => void;
    let liberarNegocio!: (n: VariablesNegocio) => void;
    const { deps: d } = deps({
      cargar: () => {
        empezadas.push("cms");
        return new Promise<InstantaneaCms | null>((r) => (liberarCms = r));
      },
      negocio: () => {
        empezadas.push("negocio");
        return new Promise<VariablesNegocio>((r) => (liberarNegocio = r));
      },
    });
    const pendiente = cargarPaginaMayoristas(d, "delacour", OPCIONES);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(empezadas.sort(), ["cms", "negocio"], "las dos lecturas ya empezaron antes de que termine cualquiera");
    liberarNegocio(NEGOCIO);
    liberarCms(SNAP);
    assert.equal((await pendiente)?.intro?.texto, "Compra inicial desde $750.000.", "con las dos lecturas resueltas, la variable del negocio llega al texto");
  });

  it("un error de la base de datos → null y un aviso con el motivo (nunca con el contenido), sin romper la tienda", async () => {
    const { deps: d, llamadas } = deps({
      cargar: async () => {
        throw new Error("conexión rechazada");
      },
    });
    assert.equal(await cargarPaginaMayoristas(d, "delacour", OPCIONES), null);
    assert.equal(llamadas.avisos.length, 1);
    assert.match(String((llamadas.avisos[0] as Error).message), /conexión rechazada/);
  });

  it("si falla la configuración del negocio también → null (no se muestra una página a medias con variables sin valor)", async () => {
    const { deps: d, llamadas } = deps({
      negocio: async () => {
        throw new Error("sin configuración");
      },
    });
    assert.equal(await cargarPaginaMayoristas(d, "delacour", OPCIONES), null);
    assert.equal(llamadas.avisos.length, 1);
  });

  it("una lectura demasiado lenta se corta: pasado el plazo → null y un aviso, y la tienda sigue", async () => {
    const { deps: d, llamadas } = deps({ cargar: () => new Promise<InstantaneaCms | null>(() => {}), plazoMs: 20 });
    const t0 = Date.now();
    assert.equal(await cargarPaginaMayoristas(d, "delacour", OPCIONES), null);
    assert.ok(Date.now() - t0 < 1000, "no espera de más");
    assert.equal(llamadas.avisos.length, 1);
    assert.match(String((llamadas.avisos[0] as Error).message), /tardó demasiado/);
  });

  it("el plazo por defecto es el de la vitrina del inicio (2,5 s)", () => {
    assert.equal(PLAZO_PAGINA_MAYORISTAS_MS, 2500);
  });

  it("un aviso que lanza no rompe nada: igual devuelve null", async () => {
    const { deps: d } = deps({
      cargar: async () => {
        throw new Error("x");
      },
      alFallar: () => {
        throw new Error("el aviso también falla");
      },
    });
    assert.equal(await cargarPaginaMayoristas(d, "delacour", OPCIONES), null);
  });
});
