/**
 * La tienda leída del CMS sembrado se ve IDÉNTICA a la tienda de hoy (byte a byte): el script de siembra (supabase/provisioning/delacour/03_*) corre en Postgres
 * real embebido, la aplicación lo lee con su lector verdadero (esquema y checksum), lo traduce a la vitrina y el HTML que resulta es el MISMO que el guardado de hoy.
 * Y con el módulo apagado, o con el módulo encendido pero nada publicado, la tienda es la de siempre. Así el cambio de «portada en el código» a «portada en el CMS»
 * no se nota para quien compra.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { BASE, CARPETA_DORADOS, CATEGORIAS_PRUEBA, HOME_COMPLETO, HOME_SIN_CATEGORIAS, LISTA, renderizarInicio } from "@/components/catalogo-publico/tienda/inicio-escenarios";
import { crearLectorSupabase } from "@/lib/cms-comercial/lector";
import { crearDelacourSintetico, scriptSembrar } from "@/lib/cms-comercial/testing/delacour";
import { TENANT_A } from "@/lib/cms-comercial/testing/fixtures";
import type { BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { cargarVitrinaInicio, type DepsVitrinaPublica } from "@/lib/cms-comercial/vitrina-publica";
import { storefrontConfigFor } from "@/lib/catalogo/vitrina";

const abiertas: BaseCms[] = [];
afterEach(async () => {
  while (abiertas.length) await abiertas.pop()?.cerrar();
});

async function delacour(opciones: Parameters<typeof crearDelacourSintetico>[0] = {}) {
  const b = await crearDelacourSintetico(opciones);
  abiertas.push(b);
  return b;
}

const dorado = (nombre: string) => readFileSync(path.join(CARPETA_DORADOS, `inicio-${nombre}.html`), "utf8");

/** El mismo cableado de producción (negocio por slug, lector del CMS, reloj), apuntando a la base embebida. */
const depsDe = (b: BaseCms): DepsVitrinaPublica => ({ tenantDe: async (slug) => (slug === "delacour" ? TENANT_A : null), cargar: (id) => crearLectorSupabase(b.supabase).cargar(id), ahora: () => Date.now() });
const CTX = { slug: "delacour", basePath: BASE, listPath: LISTA, whatsapp: "573000000000", categorias: new Set(CATEGORIAS_PRUEBA.map((c) => c.id)) };

describe("tienda leída del CMS sembrado == tienda de hoy", () => {
  it("con la siembra publicada, la vitrina sale del CMS y el HTML es idéntico al de hoy (con categorías y sin ellas)", async () => {
    const b = await delacour();
    await b.aplicarSql(scriptSembrar());
    const registro = storefrontConfigFor("delacour");
    const vitrina = await cargarVitrinaInicio(depsDe(b), registro, CTX);
    assert.equal(vitrina.origen, "cms", "la vitrina SÍ salió del CMS (no es el respaldo)");
    assert.notEqual(vitrina.config, registro);
    assert.deepEqual(vitrina.opciones, {}, "sin destacados ni categorías elegidos: el catálogo decide, como hoy");
    assert.equal(renderizarInicio(HOME_COMPLETO, vitrina.config), dorado("delacour-completo"));
    assert.equal(renderizarInicio(HOME_SIN_CATEGORIAS, vitrina.config), dorado("delacour-sin-categorias"));
  });

  it("antes de sembrar (módulo encendido, nada publicado) la tienda es la de siempre", async () => {
    const b = await delacour();
    const registro = storefrontConfigFor("delacour");
    const vitrina = await cargarVitrinaInicio(depsDe(b), registro, CTX);
    assert.equal(vitrina.origen, "registro");
    assert.equal(vitrina.config, registro);
    assert.equal(renderizarInicio(HOME_COMPLETO, vitrina.config), dorado("delacour-completo"));
  });

  it("con el módulo APAGADO (aunque el contenido exista) la tienda es la de siempre: regresión con el módulo apagado", async () => {
    const b = await delacour();
    await b.aplicarSql(scriptSembrar());
    await b.habilitarModulo(TENANT_A, false);
    const registro = storefrontConfigFor("delacour");
    const vitrina = await cargarVitrinaInicio(depsDe(b), registro, CTX);
    assert.equal(vitrina.origen, "registro");
    assert.equal(vitrina.config, registro);
    assert.equal(renderizarInicio(HOME_COMPLETO, vitrina.config), dorado("delacour-completo"));
  });

  it("sin la migración (el CMS no existe en esa base) la tienda es la de siempre, sin error", async () => {
    const b = await delacour({ migracion: false });
    const registro = storefrontConfigFor("delacour");
    const errores: unknown[] = [];
    const vitrina = await cargarVitrinaInicio({ ...depsDe(b), alFallar: (e) => void errores.push(e) }, registro, CTX);
    assert.equal(vitrina.config, registro);
    assert.equal(vitrina.origen, "registro");
    assert.equal(renderizarInicio(HOME_COMPLETO, vitrina.config), dorado("delacour-completo"));
  });

  it("después de despublicar con la reversa, la tienda vuelve a ser la de siempre", async () => {
    const b = await delacour();
    await b.aplicarSql(scriptSembrar());
    const [e] = await b.sql<{ id: string }>("select id from public.dulabs_cms_entidades where tipo = 'home'");
    await b.aplicarSql(`select public.dulabs_cms_despublicar('${TENANT_A}', '${e.id}', null, 'prueba')`);
    const vitrina = await cargarVitrinaInicio(depsDe(b), storefrontConfigFor("delacour"), CTX);
    assert.equal(vitrina.origen, "registro");
    assert.equal(renderizarInicio(HOME_COMPLETO, vitrina.config), dorado("delacour-completo"));
  });
});
