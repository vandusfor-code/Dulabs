/**
 * La PÁGINA de mayoristas armada (lo que la ruta /catalogo/{tienda}/mayoristas conecta): existe solo para una tienda de joyería con la página configurada y un WhatsApp válido; lleva el video y los textos que la
 * administradora publicó (y el botón, su mensaje); y nada de lo que se lee en paralelo puede romperla.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { storefrontConfigFor } from "@/lib/catalogo/vitrina";
import type { MultimediaTienda } from "@/lib/cms-comercial/multimedia-tienda";
import type { OpcionesPaginaMayoristas, PaginaMayoristas } from "@/lib/cms-comercial/pagina-mayoristas";
import { armarPaginaMayoristas, type DepsTiendaMayoristas, type TiendaDeMayoristas } from "@/lib/cms-comercial/tienda-mayoristas";

const WHATSAPP = "573000000000";
const DELACOUR: TiendaDeMayoristas & { publicName: string } = { slug: "delacour", whatsapp: WHATSAPP, publicName: "Delacour & Orus" };
const PAGINA: PaginaMayoristas = { intro: { titulo: "Venta al por mayor", texto: "Escoges las referencias." }, preguntas: [] };
const OPCIONES_DELACOUR: OpcionesPaginaMayoristas = { intro: "venta-al-por-mayor", omitir: ["emprendimiento"], tambien: ["envios", "medios-de-pago", "garantias", "cambios-y-devoluciones"] };
const NUEVOS = { titulo: "Surte tu negocio con nosotros", boton: "Escríbenos ahora", mensaje: "Hola, quiero surtir mi negocio." };
const PUBLICADAS: MultimediaTienda = { videos: {}, categorias: new Map(), mayoristas: NUEVOS };

interface Llamadas {
  tienda: string[];
  multimedia: string[];
  pagina: Array<{ slug: string; opciones: OpcionesPaginaMayoristas }>;
}
function deps(over: Partial<DepsTiendaMayoristas<typeof DELACOUR>> = {}): { d: DepsTiendaMayoristas<typeof DELACOUR>; llamadas: Llamadas } {
  const llamadas: Llamadas = { tienda: [], multimedia: [], pagina: [] };
  const d: DepsTiendaMayoristas<typeof DELACOUR> = {
    tienda: async (slug) => (llamadas.tienda.push(slug), slug === "delacour" ? DELACOUR : null),
    multimedia: async (slug) => (llamadas.multimedia.push(slug), null),
    pagina: async (slug, opciones) => (llamadas.pagina.push({ slug, opciones }), PAGINA),
    ...over,
  };
  return { d, llamadas };
}

describe("armarPaginaMayoristas — cuándo existe la página", () => {
  it("la tienda de joyería con página de mayoristas y WhatsApp: tienda, bloque y contenido del CMS", async () => {
    const { d, llamadas } = deps();
    const r = await armarPaginaMayoristas("delacour", d);
    assert.ok(r);
    assert.equal(r.tienda, DELACOUR);
    assert.equal(r.pagina, PAGINA);
    assert.equal(r.mayoristas.titulo, "Compra al por mayor");
    assert.deepEqual(llamadas.pagina, [{ slug: "delacour", opciones: OPCIONES_DELACOUR }], "al CMS se le pide lo que la configuración de la tienda dice (introducción, lo que se omite y lo que se suma)");
  });

  it("tienda inexistente, de otro tema o sin esa página: no hay página (la ruta responde 404) y no se lee el CMS", async () => {
    const { d, llamadas } = deps({ tienda: async (slug) => ({ slug, whatsapp: WHATSAPP, publicName: "Otra" }) });
    assert.equal(await armarPaginaMayoristas("no-existe", deps().d), null);
    assert.equal(await armarPaginaMayoristas("tienda-a", d), null, "una tienda sin tema de joyería ni bloque de mayoristas");
    assert.equal(storefrontConfigFor("tienda-a").tema ?? "clasico", "clasico");
    assert.deepEqual(llamadas.pagina, [], "sin página no se pide nada al CMS");
  });

  it("sin un WhatsApp válido tampoco hay página: nunca un botón que no lleva a ningún lado", async () => {
    for (const whatsapp of [null, "", "no-es-un-numero"]) {
      const { d, llamadas } = deps({ tienda: async () => ({ ...DELACOUR, whatsapp }) });
      assert.equal(await armarPaginaMayoristas("delacour", d), null, String(whatsapp));
      assert.deepEqual(llamadas.pagina, []);
    }
  });
});

describe("armarPaginaMayoristas — lo que la administradora publicó", () => {
  it("el bloque lleva los textos publicados y el botón abre WhatsApp con SU mensaje", async () => {
    const r = await armarPaginaMayoristas("delacour", deps({ multimedia: async () => PUBLICADAS }).d);
    assert.ok(r);
    assert.equal(r.mayoristas.titulo, NUEVOS.titulo);
    assert.equal(r.mayoristas.boton, NUEVOS.boton);
    assert.equal(r.mayoristas.etiqueta, "Compras por mayor", "lo que no cambió sigue igual");
    const url = new URL(r.mayoristas.href);
    assert.equal(url.pathname, `/${WHATSAPP}`);
    assert.equal(url.searchParams.get("text"), NUEVOS.mensaje);
    assert.ok(r.mayoristas.pagina, "la página propia se conserva");
  });

  it("sin nada publicado, la página sale con lo de siempre (incluido el mensaje de WhatsApp)", async () => {
    const r = await armarPaginaMayoristas("delacour", deps().d);
    assert.ok(r);
    assert.deepEqual([r.mayoristas.etiqueta, r.mayoristas.titulo, r.mayoristas.boton], ["Compras por mayor", "Compra al por mayor", "Hablar con una asesora"]);
    assert.equal(new URL(r.mayoristas.href).searchParams.get("text"), "Hola, quiero información para comprar al por mayor.");
  });

  it("si leer lo publicado falla, la página sale igual con lo de siempre (nada rompe la tienda)", async () => {
    const r = await armarPaginaMayoristas("delacour", deps({ multimedia: async () => Promise.reject(new Error("la base no responde")) }).d);
    assert.ok(r);
    assert.equal(r.mayoristas.titulo, "Compra al por mayor");
  });

  it("y si la tienda no existe, un fallo de lo publicado no se convierte en un error sin atender", async () => {
    const sinTienda = deps({ tienda: async () => null, multimedia: async () => Promise.reject(new Error("la base no responde")) });
    assert.equal(await armarPaginaMayoristas("delacour", sinTienda.d), null);
    await new Promise((r) => setImmediate(r)); // si hubiera un rechazo sin atender, el proceso de pruebas lo reportaría aquí
  });

  it("se pide a la vez que la tienda (la página no espera la suma de las dos lecturas)", async () => {
    const orden: string[] = [];
    const { d } = deps({
      tienda: async () => {
        orden.push("tienda: empieza");
        await new Promise((r) => setTimeout(r, 15));
        orden.push("tienda: termina");
        return DELACOUR;
      },
      multimedia: async () => {
        orden.push("multimedia: empieza");
        return null;
      },
    });
    await armarPaginaMayoristas("delacour", d);
    assert.deepEqual(orden.slice(0, 2), ["multimedia: empieza", "tienda: empieza"], "las dos arrancan antes de que termine cualquiera");
    assert.equal(orden.at(-1), "tienda: termina");
  });

  it("usa el slug de la tienda encontrada para leer el CMS (jamás algo de la petición)", async () => {
    const { d, llamadas } = deps({ tienda: async () => ({ slug: "delacour", whatsapp: WHATSAPP, publicName: "Delacour" }) });
    await armarPaginaMayoristas("DELACOUR-ALIAS", d);
    assert.deepEqual(llamadas.pagina.map((p) => p.slug), ["delacour"]);
  });
});
