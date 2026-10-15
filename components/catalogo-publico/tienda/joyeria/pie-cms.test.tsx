/**
 * Pie de la tienda (tema "joyeria") con lo que la administradora publicó en el CMS: qué se dibuja, cómo se arma la rejilla según cuántos bloques hay y, sobre todo, lo que NUNCA llega al navegador
 * (HTML o enlaces peligrosos). Es HTML del servidor: todo está en la respuesta, sin esperar a ningún script. El pie de siempre (sin nada publicado) lo guardan las pruebas doradas (pie-dorado.test.tsx).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BASE, LISTA } from "@/components/catalogo-publico/tienda/inicio-escenarios";
import { PieJoyeria } from "@/components/catalogo-publico/tienda/joyeria/PieJoyeria";
import { REDES_SOCIALES } from "@/lib/cms-comercial/contrato";
import type { Pie } from "@/lib/cms-comercial/esquemas";
import { pieDesdeCms, type ContextoPie } from "@/lib/cms-comercial/pie";
import { pie as pieFixture } from "@/lib/cms-comercial/testing/fixtures";

const WA = "https://wa.me/573000000000";
const CATS = Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, name: `Categoría ${i + 1}` }));
const CTX: ContextoPie = { basePath: BASE, listPath: LISTA, categorias: CATS, whatsappHref: WA, mayoristaHref: `${BASE}/mayoristas`, descripcion: "Frase de siempre." };

const COMPLETO: Pie = {
  descripcion: "Joyas hechas para acompañar tus momentos.",
  columnas: [
    { titulo: "Navegar", enlaces: [{ texto: "Inicio", destino: { tipo: "inicio" } }, { texto: "Mayoristas", destino: { tipo: "mayoristas" } }] },
    { titulo: "Legal", enlaces: [{ texto: "Política de privacidad", destino: { tipo: "externo", url: "https://delacour.co/privacidad" } }] },
  ],
  mostrar_categorias: true,
  contacto: { whatsapp: true, email: "ventas@delacour.co", telefono: "+57 300 123 4567", direccion: "Centro Comercial Galerías\nCarrera 26 # 18-71\nPasto, Nariño", horario: "Lunes a sábado" },
  redes: [
    { red: "instagram", url: "https://www.instagram.com/delacour.joyeria" },
    { red: "tiktok", url: "https://www.tiktok.com/@delacour" },
  ],
  derechos: "Delacour & Orus S.A.S. Todos los derechos reservados.",
};

const MARCA = { name: "Delacour & Orus", descriptor: "Joyería" };
const html = (pie: Pie | null, ctx: ContextoPie = CTX, anio = 2031) =>
  renderToStaticMarkup(<PieJoyeria marca={MARCA} basePath={ctx.basePath} listPath={ctx.listPath} categorias={[...ctx.categorias]} whatsapp="573000000000" mayorista descripcion={ctx.descripcion} vista={pieDesdeCms(pie, ctx)} anio={anio} />);
const cuenta = (h: string, patron: RegExp) => (h.match(patron) ?? []).length;
const visible = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("pie con lo publicado en el CMS — qué se dibuja", () => {
  const h = html(COMPLETO);

  it("la descripción publicada (no la de siempre), las columnas con su título, las categorías, el contacto y las redes, cada bloque con su título h2", () => {
    assert.ok(h.includes("Joyas hechas para acompañar tus momentos.") && !h.includes("Frase de siempre."));
    for (const titulo of ["Navegar", "Legal", "Categorías", "Contacto", "Síguenos"]) assert.ok(h.includes(`>${titulo}</h2>`), titulo);
    assert.equal(cuenta(h, /<h2 /g), 5, "un h2 por bloque");
    assert.equal(cuenta(h, /<h3/g), 0, "sin saltos de nivel");
    assert.ok(h.includes("Política de privacidad") && h.includes("Categoría 1"));
  });

  it("el contacto: WhatsApp (del número de la tienda), correo y teléfono como enlaces, la dirección una línea por renglón y el horario", () => {
    assert.ok(h.includes(`href="${WA}"`) && h.includes("Escríbenos por WhatsApp"));
    assert.ok(h.includes('href="mailto:ventas@delacour.co"') && h.includes(">ventas@delacour.co</a>"));
    assert.ok(h.includes('href="tel:+573001234567"') && h.includes(">+57 300 123 4567</a>"));
    for (const linea of ["Centro Comercial Galerías", "Carrera 26 # 18-71", "Pasto, Nariño"]) assert.ok(h.includes(`<span class="block">${linea}</span>`), linea);
    assert.ok(h.includes("Lunes a sábado"));
  });

  it("las redes: un enlace por red con su nombre para lectores de pantalla, en pestaña nueva y sin enviar el origen; el icono es decorativo; bajo ellos, los usuarios", () => {
    const enlaces = h.match(/<a [^>]*aria-label="(?:Instagram|TikTok)"[^>]*>/g) ?? [];
    assert.equal(enlaces.length, 2);
    for (const e of enlaces) assert.ok(e.includes('target="_blank"') && e.includes('rel="noopener noreferrer"'), e);
    assert.ok(h.includes('href="https://www.instagram.com/delacour.joyeria"') && h.includes('href="https://www.tiktok.com/@delacour"'));
    assert.equal(cuenta(h, /<svg [^>]*aria-hidden="true"/g), 2, "los iconos no se anuncian");
    assert.ok(visible(h).includes("@delacour.joyeria · @delacour"));
  });

  it("los enlaces de la tienda no abren pestaña nueva; los externos y WhatsApp sí", () => {
    const interno = h.match(new RegExp(`<a [^>]*href="${BASE}"[^>]*>`))?.[0] ?? "";
    assert.ok(interno && !interno.includes("target="), interno);
    const externo = h.match(/<a [^>]*href="https:\/\/delacour\.co\/privacidad"[^>]*>/)?.[0] ?? "";
    assert.ok(externo.includes('target="_blank"') && externo.includes('rel="noopener noreferrer"'), externo);
  });

  it("un enlace a una página propia publicada lleva a su dirección dentro de la tienda y se abre en la misma pestaña; si no está publicada, no se dibuja", () => {
    const conPagina: Pie = { ...COMPLETO, columnas: [{ titulo: "Legal", enlaces: [{ texto: "Política de privacidad", destino: { tipo: "pagina", clave: "politica-de-privacidad" } }] }] };
    const publicada = html(conPagina, { ...CTX, paginas: ["politica-de-privacidad"] });
    const enlace = publicada.match(/<a [^>]*href="[^"]*\/p\/politica-de-privacidad"[^>]*>/)?.[0] ?? "";
    assert.ok(enlace.includes(`href="${BASE}/p/politica-de-privacidad"`) && !enlace.includes("target="), enlace);
    assert.ok(publicada.includes(">Política de privacidad</a>") && publicada.includes(">Legal</h2>"));
    const sinPublicar = html(conPagina, CTX);
    assert.ok(!sinPublicar.includes("/p/politica-de-privacidad") && !sinPublicar.includes(">Legal</h2>"), "ni el enlace ni su columna vacía");
  });

  it("la línea de derechos: «© año» (el año en curso, o el que fijan las pruebas) y lo que escribió la administradora", () => {
    assert.ok(visible(h).includes("© 2031 Delacour &amp; Orus S.A.S. Todos los derechos reservados."));
    assert.ok(visible(html({ ...COMPLETO, derechos: undefined })).includes("© 2031 Delacour &amp; Orus. Todos los derechos reservados."));
    assert.ok(html(COMPLETO, CTX, 2040).includes("© 2040 "), "el año cambia solo");
  });

  it("el crédito de DuLabs sigue (es de la plataforma, no se edita)", () => {
    assert.ok(h.includes("Catálogo creado con") && h.includes('href="https://www.dulabs.co"'));
  });
});

describe("pie con lo publicado en el CMS — la rejilla según cuántos bloques hay", () => {
  const bloques = (h: string) => cuenta(h, /<h2 /g);
  const rejilla = (h: string) => h.match(/<div class="mt-10 grid ([^"]*)"/)?.[1] ?? null;

  it("hasta tres bloques, una fila de tres (como siempre)", () => {
    const h = html(pieFixture({ mostrar_categorias: true, columnas: [{ titulo: "Navegar", enlaces: [{ texto: "Inicio", destino: { tipo: "inicio" } }] }] }));
    assert.equal(bloques(h), 2);
    assert.equal(rejilla(h), "grid-cols-2 gap-x-6 gap-y-8 border-t border-edge pt-8 sm:grid-cols-3");
  });

  it("con cuatro, dos columnas y en pantallas grandes cuatro", () => {
    const h = html({ ...COMPLETO, columnas: [COMPLETO.columnas[0]], redes: COMPLETO.redes });
    assert.equal(bloques(h), 4);
    assert.ok(rejilla(h)?.endsWith("sm:grid-cols-2 lg:grid-cols-4"), rejilla(h) ?? "");
  });

  it("con cinco o seis, tres por fila (dos filas)", () => {
    assert.equal(bloques(html(COMPLETO)), 5);
    assert.ok(rejilla(html(COMPLETO))?.endsWith("sm:grid-cols-3"));
    const seis = html({ ...COMPLETO, columnas: [...COMPLETO.columnas, { titulo: "Ayuda", enlaces: [{ texto: "Catálogo", destino: { tipo: "catalogo" } }] }] });
    assert.equal(bloques(seis), 6);
    assert.ok(rejilla(seis)?.endsWith("sm:grid-cols-3"));
  });

  it("el contacto y las redes ocupan todo el ancho en el celular (su texto es más largo que el de una columna)", () => {
    const h = html(COMPLETO);
    assert.equal(cuenta(h, /col-span-2 space-y-3 sm:col-span-1/g), 2);
  });

  it("sin ningún bloque no hay rejilla vacía: queda la marca, la frase y los derechos", () => {
    const h = html(pieFixture({ mostrar_categorias: false, descripcion: "Solo la frase." }));
    assert.equal(rejilla(h), null);
    assert.ok(h.includes("Solo la frase.") && h.includes("Todos los derechos reservados"));
    assert.equal(bloques(h), 0);
  });
});

describe("pie con lo publicado en el CMS — lo que nunca llega al navegador", () => {
  it("el texto de la administradora se muestra como TEXTO: ningún HTML ni script llega al navegador", () => {
    const malicioso = {
      ...COMPLETO,
      descripcion: "<script>alert(1)</script> & <img src=x onerror=alert(2)>",
      columnas: [{ titulo: "<b>Legal</b>", enlaces: [{ texto: "<i>Privacidad</i>", destino: { tipo: "inicio" } }] }],
      contacto: { whatsapp: false, direccion: "<script>x</script>\nCalle 1", horario: "<b>9 a 6</b>" },
      derechos: "<script>derechos()</script>",
    } as unknown as Pie;
    const h = html(malicioso);
    assert.ok(!h.includes("<script") && !h.includes("<img") && !h.includes("<b>") && !h.includes("<i>"));
    assert.ok(h.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;img src=x onerror=alert(2)&gt;"));
    assert.ok(h.includes("&lt;b&gt;Legal&lt;/b&gt;") && h.includes("&lt;i&gt;Privacidad&lt;/i&gt;"));
  });

  it("un enlace o una red con una dirección peligrosa (javascript:, http, otro dominio) NO se dibuja, aunque llegue hasta aquí", () => {
    const manipulado = {
      ...COMPLETO,
      columnas: [
        {
          titulo: "Legal",
          enlaces: [
            { texto: "Peligro", destino: { tipo: "externo", url: "javascript:alert(1)" } },
            { texto: "Sin cifrar", destino: { tipo: "externo", url: "http://delacour.co" } },
            { texto: "Bueno", destino: { tipo: "externo", url: "https://delacour.co" } },
          ],
        },
      ],
      redes: [
        { red: "instagram", url: "https://sitio-malo.com/delacour" },
        { red: "tiktok", url: "javascript:alert(1)" },
        { red: "x", url: "https://x.com/delacour" },
      ],
    } as unknown as Pie;
    const h = html(manipulado);
    assert.ok(!h.includes("javascript:") && !h.includes("http://") && !h.includes("sitio-malo.com"));
    assert.ok(h.includes('href="https://delacour.co"') && h.includes('aria-label="X (Twitter)"'));
    assert.equal(cuenta(h, /Peligro|Sin cifrar/g), 0);
  });

  it("nada que no esté publicado: sin redes no hay «Síguenos», sin contacto no hay «Contacto», sin correo ni teléfono no se inventan", () => {
    const h = html(pieFixture({ mostrar_categorias: false, columnas: [{ titulo: "Navegar", enlaces: [{ texto: "Inicio", destino: { tipo: "inicio" } }] }] }));
    assert.ok(!h.includes("Síguenos") && !h.includes("Contacto") && !h.includes("mailto:") && !h.includes("tel:") && !h.includes("wa.me"));
    assert.ok(!/instagram|tiktok|facebook|youtube/i.test(visible(h)));
  });
});

describe("iconos de las redes", () => {
  it("cada red de la lista cerrada tiene su icono (si faltara uno, el enlace saldría vacío)", () => {
    for (const red of REDES_SOCIALES) {
      const url = { instagram: "https://instagram.com/x", tiktok: "https://tiktok.com/@x", facebook: "https://facebook.com/x", youtube: "https://youtube.com/@x", x: "https://x.com/x", pinterest: "https://pinterest.com/x", linkedin: "https://linkedin.com/company/x", telegram: "https://t.me/x", whatsapp: "https://chat.whatsapp.com/ABC123" }[red];
      const h = html(pieFixture({ mostrar_categorias: false, redes: [{ red, url }] }));
      const enlace = h.match(/<a [^>]*aria-label="[^"]+"[^>]*>(.*?)<\/a>/)?.[1] ?? "";
      assert.ok(/<svg[^>]*>.+<\/svg>/.test(enlace), `${red}: sin icono`);
      assert.ok(/<(?:path|rect|polygon|line|circle)/.test(enlace), `${red}: el icono no dibuja nada`);
    }
  });
});
