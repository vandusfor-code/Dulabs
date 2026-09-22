/**
 * Home -- SEO + FAQ. Comprueba que (1) el JSON-LD FAQPage coincide EXACTAMENTE con lo que se ve (las 8 preguntas de la home), (2) el JSON-LD es
 * válido y solo usa tipos que corresponden, (3) la metadata/imagen social cumplen las reglas de búsqueda y no canibalizan /whatsapp-ia, y
 * (4) cada afirmación de las respuestas tiene respaldo en el producto real (Wizard, Runtime, planes, checkout). La home es conversión +
 * producto; la profundidad SEO vive en las páginas internas (la FAQ completa, en /preguntas-frecuentes).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { CapabilitiesSection } from "@/components/home/CapabilitiesSection";
import { FaqSection } from "@/components/home/FaqSection";
import { FinalCta } from "@/components/home/FinalCta";
import { JsonLd } from "@/components/site/JsonLd";
import { CAPABILITY_BACKING, CAPABILITY_KEYS } from "@/lib/agent-compiler/spec/capabilities";
import { CAPACIDADES_HOME, ETIQUETA_CAPACIDAD } from "@/lib/home/capabilities";
import { FAQ_HOME, textoRespuesta, todasLasFaq } from "@/lib/home/faq";
import { HOME_PATH } from "@/lib/home/links";
import { HOME_SEO, homeFaqJsonLd, homeMetadata, homeSoftwareApplicationJsonLd, SITE_URL, TOTAL_FAQ } from "@/lib/home/seo";
import { PLANES } from "@/lib/planes";
import { ARTICULOS } from "@/lib/recursos";

const RAIZ = join(__dirname, "..", "..");
const leer = (...partes: string[]) => readFileSync(join(RAIZ, ...partes), "utf8").replace(/\r\n/g, "\n");

const decodificar = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ");
const normalizar = (s: string) => decodificar(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const HTML_FAQ = renderToStaticMarkup(<FaqSection />);
const HTML_CIERRE = renderToStaticMarkup(<FinalCta />);

/** Lo que el visitante ve en el acordeón, por pregunta: { id, pregunta, respuesta } */
function faqVisibles() {
  const salida: { id: string; pregunta: string; respuesta: string }[] = [];
  for (const m of HTML_FAQ.matchAll(/<details[^>]*id="faq-([^"]+)"[^>]*>([\s\S]*?)<\/details>/g)) {
    // React serializa data-* booleanos como data-x="true".
    const pregunta = /<span data-faq-pregunta(?:="[^"]*")?>([\s\S]*?)<\/span>/.exec(m[2])?.[1] ?? "";
    const bloque = /<div data-faq-respuesta(?:="[^"]*")?[^>]*>([\s\S]*?)<\/div>/.exec(m[2])?.[1] ?? "";
    const parrafos = [...bloque.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((p) => p[1]);
    salida.push({ id: m[1], pregunta: normalizar(pregunta), respuesta: normalizar(parrafos.join(" ")) });
  }
  return salida;
}

function jsonLdDe(data: object): unknown {
  const html = renderToStaticMarkup(<JsonLd data={data} />);
  const cuerpo = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  return JSON.parse(cuerpo);
}

describe("FAQ -- datos", () => {
  it("son 8 preguntas reales y útiles (no 22): únicas, con signos de interrogación y respuestas concretas", () => {
    const todas = todasLasFaq();
    assert.equal(todas, FAQ_HOME);
    assert.equal(todas.length, TOTAL_FAQ);
    assert.equal(todas.length, 8, `número de preguntas: ${todas.length}`);
    assert.equal(new Set(todas.map((f) => f.id)).size, todas.length, "ids duplicados");
    assert.equal(new Set(todas.map((f) => f.pregunta)).size, todas.length, "preguntas duplicadas");
    for (const f of todas) {
      assert.match(f.pregunta, /^¿.+\?$/, f.pregunta);
      assert.ok(f.respuesta.length >= 1 && f.respuesta.length <= 3, `${f.id}: entre 1 y 3 párrafos`);
      for (const p of f.respuesta) {
        assert.ok(p.length >= 60, `${f.id}: párrafo demasiado corto para ser útil`);
        assert.ok(p.length <= 620, `${f.id}: párrafo demasiado largo (${p.length})`);
      }
    }
  });

  it("cubre lo que decide una compra: qué es, cómo se crea, si hay que programar, WhatsApp Business, citas, Google Calendar, crea tu agente vs a la medida y precio", () => {
    const preguntas = todasLasFaq().map((f) => f.pregunta).join("\n");
    const temas: [string, RegExp][] = [
      ["qué es un agente de IA", /¿Qué es un agente de IA para WhatsApp\?/],
      ["cómo se crea", /¿Cómo creo mi agente de IA\?/],
      ["programar", /saber programar/i],
      ["conectar WhatsApp Business", /conectar mi WhatsApp Business/i],
      ["agendar citas", /agendar citas por WhatsApp/i],
      ["Google Calendar", /conectar el agente con Google Calendar/i],
      ["crear tu agente vs a la medida", /diferencia hay entre crear mi propio agente y pedir una solución a la medida/i],
      ["precio", /¿Cuánto cuesta/i],
    ];
    for (const [nombre, re] of temas) assert.match(preguntas, re, `falta una pregunta sobre: ${nombre}`);
    assert.equal(temas.length, 8);
  });

  it("las preguntas que ya no están en la home siguen disponibles en /preguntas-frecuentes (la FAQ completa)", () => {
    assert.ok(existsSync(join(RAIZ, "app", "preguntas-frecuentes", "page.tsx")));
    assert.match(HTML_FAQ, /href="\/preguntas-frecuentes"/);
  });
});

describe("FAQ -- el JSON-LD coincide EXACTAMENTE con el contenido visible", () => {
  const visibles = faqVisibles();
  const ld = homeFaqJsonLd();

  it("misma cantidad, mismo orden, misma pregunta y misma respuesta (sin contenido oculto solo para SEO)", () => {
    assert.equal(visibles.length, ld.mainEntity.length, "el número de preguntas visibles y del JSON-LD debe ser igual");
    assert.equal(visibles.length, TOTAL_FAQ);
    ld.mainEntity.forEach((q, i) => {
      assert.equal(q.name, visibles[i].pregunta, `pregunta #${i + 1}`);
      assert.equal(normalizar(q.acceptedAnswer.text), visibles[i].respuesta, `respuesta #${i + 1}: ${q.name}`);
    });
  });

  it("todas las respuestas del JSON-LD salen de la misma fuente que el texto visible", () => {
    todasLasFaq().forEach((f, i) => assert.equal(ld.mainEntity[i].acceptedAnswer.text, textoRespuesta(f)));
  });

  it("las respuestas no están ocultas: el acordeón usa <details> nativo (sin display:none ni aria-hidden en el texto)", () => {
    assert.equal((HTML_FAQ.match(/<details /g) ?? []).length, TOTAL_FAQ);
    assert.equal((HTML_FAQ.match(/<summary /g) ?? []).length, TOTAL_FAQ);
    assert.doesNotMatch(HTML_FAQ, /data-faq-respuesta[^>]*(hidden|aria-hidden|display:\s*none)/);
    assert.doesNotMatch(HTML_FAQ, /<details[^>]* open/, "todas empiezan cerradas: el visitante decide qué abrir");
  });

  it("el JSON-LD renderizado es JSON válido de tipo FAQPage y escapa '<' (no puede cerrar el <script>)", () => {
    const parseado = jsonLdDe(ld) as { "@context": string; "@type": string; mainEntity: { "@type": string; acceptedAnswer: { "@type": string } }[] };
    assert.equal(parseado["@context"], "https://schema.org");
    assert.equal(parseado["@type"], "FAQPage");
    for (const q of parseado.mainEntity) {
      assert.equal(q["@type"], "Question");
      assert.equal(q.acceptedAnswer["@type"], "Answer");
    }
    const html = renderToStaticMarkup(<JsonLd data={{ texto: "</script><script>alert(1)</script>" }} />);
    assert.doesNotMatch(html, /<\/script><script>/);
    assert.match(html, /\\u003c/);
    assert.deepEqual(jsonLdDe({ texto: "</script>" }), { texto: "</script>" });
  });
});

describe("SEO -- datos estructurados", () => {
  const app = homeSoftwareApplicationJsonLd();

  it("SoftwareApplication: solo lo que corresponde (sin precios, reseñas ni valoraciones) y con las capacidades reales", () => {
    assert.equal(app["@type"], "SoftwareApplication");
    assert.equal(app.applicationCategory, "BusinessApplication");
    assert.deepEqual(Object.keys(app).filter((k) => /^(offers|aggregateRating|review|reviews|price|priceRange|priceCurrency)$/i.test(k)), []);
    const esperadas = CAPABILITY_KEYS.filter((k) => CAPABILITY_BACKING[k].available).map((k) => ETIQUETA_CAPACIDAD[k]);
    assert.deepEqual(app.featureList, esperadas);
    assert.ok(!app.featureList.includes("Tomar pedidos") && !app.featureList.includes("Cobrar"), "no anuncia capacidades que no existen");
    assert.equal(app.url, `${SITE_URL}/`);
  });

  it("todo lo que anuncia el JSON-LD se ve en la página: cada capacidad disponible está cubierta por una tarjeta de 'Qué puede hacer tu agente'", () => {
    const visibles = new Set(CAPACIDADES_HOME.flatMap((c) => c.capacidades));
    for (const k of CAPABILITY_KEYS.filter((x) => CAPABILITY_BACKING[x].available)) assert.ok(visibles.has(k), `la capacidad "${ETIQUETA_CAPACIDAD[k]}" no se ve en la home`);
    const html = normalizar(renderToStaticMarkup(<CapabilitiesSection />));
    for (const c of CAPACIDADES_HOME) assert.ok(html.includes(c.titulo), c.titulo);
  });

  it("Organization y WebSite siguen publicándose una sola vez desde el layout: la home no los duplica", () => {
    const layout = leer("app", "layout.tsx");
    assert.match(layout, /organizationSchema\(\)/);
    assert.match(layout, /websiteSchema\(\)/);
    const pagina = leer("app", "page.tsx");
    assert.doesNotMatch(pagina, /organizationSchema|websiteSchema/);
    assert.match(pagina, /homeSoftwareApplicationJsonLd\(\)/);
    assert.match(pagina, /homeFaqJsonLd\(\)/);
  });
});

describe("SEO -- metadata, imagen social y reparto de palabras clave", () => {
  // Modo noindex del generador (no lo usa ninguna página hoy): se conserva probado para que nunca emita una canónica hacia otra URL.
  const noindex = homeMetadata({ path: "/vista-previa", indexable: false });
  const definitiva = homeMetadata({ path: "/", indexable: true });

  it("título y descripción con longitud de búsqueda y los términos objetivo de la home", () => {
    assert.ok(HOME_SEO.title.length >= 30 && HOME_SEO.title.length <= 60, `título: ${HOME_SEO.title.length}`);
    assert.ok(HOME_SEO.description.length >= 110 && HOME_SEO.description.length <= 160, `descripción: ${HOME_SEO.description.length}`);
    const cuerpo = (HOME_SEO.title + " " + HOME_SEO.description).toLowerCase();
    for (const t of ["agentes de ia", "automatización", "agente de ia para whatsapp"]) assert.ok(cuerpo.includes(t), t);
    assert.ok(HOME_SEO.title.endsWith("| DuLabs"));
  });

  it("no canibaliza /whatsapp-ia: la home no usa 'WhatsApp con IA' en título/descripción, conserva su enfoque y la enlaza", () => {
    assert.doesNotMatch(HOME_SEO.title + HOME_SEO.description + HOME_SEO.ogTitle + HOME_SEO.ogDescription, /whatsapp con ia/i);
    const ws = leer("app", "whatsapp-ia", "page.tsx");
    assert.match(ws, /title: "WhatsApp con IA para empresas \| DuLabs"/);
    assert.match(ws, /canonical: "https:\/\/www\.dulabs\.co\/whatsapp-ia"/);
    assert.notEqual(HOME_SEO.title, "WhatsApp con IA para empresas | DuLabs");
    assert.match(renderToStaticMarkup(<CapabilitiesSection />), /href="\/whatsapp-ia"/, "la home enlaza a /whatsapp-ia (enlazado interno)");
  });

  it("modo noindex: noindex/nofollow y canónica a sí misma (sin mezclar noindex con canónica hacia '/')", () => {
    assert.deepEqual(noindex.robots, { index: false, follow: false });
    assert.equal(noindex.alternates?.canonical, "/vista-previa");
    assert.equal((noindex.title as { absolute: string }).absolute, HOME_SEO.title);
  });

  it("la página '/' publica exactamente la metadata definitiva (indexable, ruta '/')", () => {
    assert.equal(HOME_PATH, "/");
    assert.match(leer("app", "page.tsx"), /export const metadata: Metadata = homeMetadata\(\{ path: HOME_PATH, indexable: true \}\);/);
  });

  it("definitiva ('/'): indexable, canónica '/', Open Graph y Twitter completos con imagen 1200x630 y texto alternativo", () => {
    const r = definitiva.robots as { index: boolean; follow: boolean };
    assert.equal(r.index, true);
    assert.equal(r.follow, true);
    assert.equal(definitiva.alternates?.canonical, "/");
    const og = definitiva.openGraph as { locale: string; type: string; siteName: string; url: string; images: { url: string; width: number; height: number; alt: string }[] };
    assert.equal(og.locale, "es_CO");
    assert.equal(og.type, "website");
    assert.equal(og.url, "/");
    assert.deepEqual([og.images[0].width, og.images[0].height], [1200, 630]);
    assert.ok(og.images[0].alt.length > 10);
    const tw = definitiva.twitter as { card: string; images: { url: string; alt: string }[] };
    assert.equal(tw.card, "summary_large_image");
    assert.equal(tw.images[0].url, og.images[0].url);
  });

  it("la imagen social existe, es PNG de 1200x630 y pesa poco", () => {
    const ruta = join(RAIZ, "public", HOME_SEO.ogImage.url.replace(/^\//, ""));
    const bytes = readFileSync(ruta);
    assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(bytes.readUInt32BE(16), 1200);
    assert.equal(bytes.readUInt32BE(20), 630);
    assert.ok(statSync(ruta).size < 300 * 1024, "la imagen debe pesar menos de 300 KB");
  });

  it("la home '/' está en el sitemap y la ruta temporal /home-v3 ya no existe ni figura en sitemap/robots", () => {
    const urls = sitemap().map((e) => e.url);
    assert.ok(urls.includes(`${SITE_URL}/`));
    assert.ok(!urls.some((u) => u.includes("home-v3")));
    const reglas = robots().rules as { disallow: string[] };
    assert.ok(!reglas.disallow.some((d) => d.includes("home-v3")));
  });
});

describe("FAQ -- cada afirmación tiene respaldo en el producto real", () => {
  const texto = todasLasFaq().map((f) => f.respuesta.join(" ")).join("\n");
  const wizard = leer("components", "dashboard", "business-agent", "Wizard.tsx");

  it("capacidades y opciones citadas existen con ese nombre exacto en el Wizard", () => {
    assert.match(texto, /«Agendar citas»/);
    assert.ok(wizard.includes(`es: "Agendar citas"`), "el Wizard no tiene la capacidad Agendar citas");
    // "puede cancelar y reprogramar si activas esa opción": la opción existe en el Wizard.
    assert.match(texto, /cancelar y reprogramar citas si activas esa opción/);
    assert.ok(wizard.includes("Permitir cancelar y cambiar citas por WhatsApp"));
    for (const paso of ["tipo de negocio", "personalidad", "capacidades", "agendamiento", "servicios y productos", "horarios", "datos del cliente", "conocimiento", "reglas", "transferencia"]) {
      assert.ok(texto.includes(paso), `la respuesta de cómo crear un agente debe nombrar el paso "${paso}"`);
    }
    assert.equal(CAPABILITY_BACKING.orders.available, false);
    assert.equal(CAPABILITY_BACKING.payments.available, false);
    assert.match(texto, /No cobra ni toma pedidos/);
  });

  it("calendario: Google Calendar (Nylas) existe como dice la respuesta y la disponibilidad la calcula el sistema", () => {
    const readiness = leer("lib", "business-agent-readiness.ts");
    assert.match(readiness, /solo actúa con Google Calendar/);
    assert.match(readiness, /Conecta tu Google Calendar/);
    assert.match(leer("components", "dashboard", "business-agent", "CalendarConnection.tsx"), /Elige qué calendario usar/);
    assert.match(texto, /La disponibilidad no la inventa la IA: la calcula el sistema/);
  });

  it("WhatsApp: la coexistencia (app WhatsApp Business) está soportada por el registro con Meta", () => {
    assert.match(leer("lib", "hooks", "use-meta-embedded-signup.ts"), /whatsapp_business_app_onboarding/);
    assert.match(leer("lib", "coexistence-sync.ts"), /coexist/i);
    assert.match(texto, /modo coexistencia/);
  });

  it("vista previa simulada y versiones: existen en el panel como dice la respuesta", () => {
    assert.match(leer("components", "dashboard", "business-agent", "BusinessAgentPreview.tsx"), /100% simulado -- no envía WhatsApp real/);
    assert.match(leer("components", "dashboard", "business-agent", "VersionsPanel.tsx"), /Historial de versiones/);
    assert.match(texto, /vista previa simulada, que no envía mensajes reales/);
    assert.match(texto, /cada cambio se guarda como una versión nueva/);
  });

  it("precios: los importes de la respuesta son EXACTAMENTE los de lib/planes.ts (y no hay otros importes)", () => {
    const cop = (n: number | null) => `$${(n ?? 0).toLocaleString("es-CO")}`;
    const precio = todasLasFaq().find((f) => f.id === "cuanto-cuesta")!.respuesta.join(" ");
    for (const id of ["essential", "business", "pro"] as const) assert.ok(precio.includes(`${PLANES[id].nombre} (${cop(PLANES[id].precioCop)} COP al mes)`), id);
    const importes = [...texto.matchAll(/\$\d[\d.]*/g)].map((m) => m[0]);
    assert.deepEqual(importes.sort(), [cop(PLANES.essential.precioCop), cop(PLANES.business.precioCop), cop(PLANES.pro.precioCop)].sort());
    assert.match(texto, /Enterprise se cotiza/);
  });

  it("implementación y costos de Meta: lo que dice la FAQ está en el checkout y en la sección de planes", () => {
    // El comentario del checkout se parte en dos líneas: se une antes de comparar.
    assert.match(leer("app", "checkout", "page.tsx").replace(/\n\s*\/\/\s*/g, " "), /el primer cobro incluye la cuota de implementación/);
    assert.match(leer("components", "site", "Sections.tsx"), /Meta cobra directamente al negocio/);
    // La FAQ nombra el cobro de forma neutral (sin presentar la implementación manual como requisito) y remite al desglose del checkout.
    assert.match(texto, /cada plan muestra un pago único de implementación que va en el primer cobro; el desglose aparece antes de pagar/);
    assert.match(leer("app", "checkout", "page.tsx"), /de mensualidad \+ \$\{implementacionCop/);
    assert.match(texto, /Meta los cobra directamente al negocio/);
  });

  it("a la medida: el caso DuMo y las categorías que menciona el sitio existen; el agente estándar solo se conecta a WhatsApp y Google Calendar", () => {
    assert.match(leer("components", "site", "CasosSections.tsx"), /nombre: "DuMo"/);
    const enterprise = leer("lib", "home", "enterprise.ts");
    for (const c of ["CRM empresarial", "Sistemas internos", "Automatización de procesos", "Agentes de IA personalizados"]) assert.ok(enterprise.includes(c), c);
    assert.match(texto, /automatizaciones, integraciones con tus sistemas, agentes personalizados o software propio/);
  });
});

describe("FAQ -- enlaces internos y accesibilidad", () => {
  it("cada enlace de una respuesta apunta a una ruta, un artículo o un ancla que existen", () => {
    const anclas = new Set(["como-funciona", "capacidades", "empresas"]);
    const fuentePagina = ["CapabilitiesSection", "HowItWorksSection", "CustomSolutionsSection"].map((s) => leer("components", "home", `${s}.tsx`)).join("\n");
    for (const { f, e } of todasLasFaq().flatMap((f) => (f.enlaces ?? []).map((e) => ({ f, e })))) {
      const { href, texto } = e;
      assert.ok(texto.length >= 8, `${f.id}: el texto del enlace debe ser descriptivo`);
      if (href.startsWith("#")) {
        assert.ok(anclas.has(href.slice(1)), `${f.id}: ancla desconocida ${href}`);
        assert.match(fuentePagina, new RegExp(`id="${href.slice(1)}"`), `no existe la sección ${href}`);
      } else if (href.startsWith("/recursos/")) {
        assert.ok(ARTICULOS.some((a) => a.slug === href.replace("/recursos/", "")), `${f.id}: artículo inexistente ${href}`);
      } else {
        assert.ok(statSync(join(RAIZ, "app", href.replace(/^\//, ""))).isDirectory(), `${f.id}: ruta inexistente ${href}`);
      }
    }
  });

  it("el cierre (CTA final) es corto y fuerte: la frase, 'Crea tu agente' y 'Hablar con DuLabs'", () => {
    assert.match(HTML_CIERRE, /<section id="empezar"/);
    const t = normalizar(HTML_CIERRE);
    assert.match(t, /Tu negocio ya tiene procesos\. Ahora pueden trabajar automáticamente\./);
    assert.match(t, /Crea tu agente/);
    assert.match(t, /Hablar con DuLabs/);
    assert.match(HTML_CIERRE, /bg-dev-accent /);
    assert.ok(t.length < 220, `el cierre debe ser breve (${t.length} caracteres)`);
  });

  it("el acordeón es accesible: foco visible, marcador nativo oculto solo visualmente y objetivos táctiles amplios", () => {
    assert.match(leer("app", "globals.css"), /\.home-scope summary:focus-visible/);
    assert.match(HTML_FAQ, /list-none/);
    assert.match(HTML_FAQ, /min-h-14/);
    assert.match(HTML_FAQ, /aria-hidden="true"/);
  });
});
