/**
 * Home principal (ruta "/"): contenido renderizado + guardas de calidad. La home es la PUERTA DE ENTRADA al producto (8 bloques), no el sitio
 * completo: estas pruebas fijan su estructura compacta, que el ancho sea fluido, que no haya claims falsos ni JS cliente innecesario y que
 * todo lo que afirma coincida con el Runtime y el Wizard reales (si el producto cambia, la home no puede seguir diciendo algo viejo).
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import sitemap from "@/app/sitemap";
import { CAPABILITY_BACKING, CAPABILITY_KEYS } from "@/lib/agent-compiler/spec/capabilities";
import { CapabilitiesSection } from "@/components/home/CapabilitiesSection";
import { ContactSection } from "@/components/home/ContactSection";
import { CustomSolutionsSection } from "@/components/home/CustomSolutionsSection";
import { DevelopersSection } from "@/components/home/DevelopersSection";
import { FaqSection } from "@/components/home/FaqSection";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeNav } from "@/components/home/HomeNav";
import { HowItWorksSection } from "@/components/home/HowItWorksSection";
import { MoreThanWhatsappSection } from "@/components/home/MoreThanWhatsappSection";
import { SchedulingSection } from "@/components/home/SchedulingSection";
import { WorkProcessSection } from "@/components/home/WorkProcessSection";
import { CAPACIDADES_A_MEDIDA } from "@/lib/home/enterprise";
import { CAPACIDADES_HOME, ETAPAS_CREA_TU_AGENTE, ETIQUETA_CAPACIDAD, PASOS_DEL_WIZARD } from "@/lib/home/capabilities";
import { homeMetadata } from "@/lib/home/seo";
import { CASOS_HREF, CREAR_AGENTE_HREF, DEVELOPER_DOCS_HREF, DEVELOPER_PLATFORM_HREF, ENTERPRISE_HREF, HABLAR_CON_DULABS_HREF, HABLAR_ESPECIALISTA_HREF, HOME_NAV_LINKS, HOME_PATH } from "@/lib/home/links";

const RAIZ = join(__dirname, "..", "..");

function archivos(dir: string, acumulado: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, acumulado);
    else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) acumulado.push(ruta);
  }
  return acumulado;
}

const FUENTES_HOME = [...archivos(join(RAIZ, "components", "home")), ...archivos(join(RAIZ, "lib", "home")), join(RAIZ, "app", "page.tsx")];

const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;| /g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const sinComentarios = (fuente: string) => fuente.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");

/** Las secciones propias de la home, en su orden (PricingSection es un componente compartido: se comprueba en el código de la página). */
const SECCIONES = [
  { id: "capacidades", html: renderToStaticMarkup(<CapabilitiesSection />) },
  { id: "como-funciona", html: renderToStaticMarkup(<HowItWorksSection />) },
  { id: "agendamiento", html: renderToStaticMarkup(<SchedulingSection />) },
  { id: "soluciones", html: renderToStaticMarkup(<MoreThanWhatsappSection />) },
  { id: "como-trabajamos", html: renderToStaticMarkup(<WorkProcessSection />) },
  { id: "preguntas-frecuentes", html: renderToStaticMarkup(<FaqSection />) },
  { id: "empresas", html: renderToStaticMarkup(<CustomSolutionsSection />) },
  { id: "developers", html: renderToStaticMarkup(<DevelopersSection />) },
  { id: "contacto", html: renderToStaticMarkup(<ContactSection />) },
];
const seccion = (id: string) => SECCIONES.find((s) => s.id === id)!.html;
const PAGINA_FUENTE = readFileSync(join(RAIZ, "app", "page.tsx"), "utf8").replace(/\r\n/g, "\n");
const HERO = renderToStaticMarkup(<HomeHero />);
const NAV = renderToStaticMarkup(<HomeNav />);
const PAGINA = HERO + SECCIONES.map((s) => s.html).join("");
const TEXTO_PAGINA = texto(PAGINA);

describe("Home -- hero", () => {
  it("tiene exactamente un H1 (Automatización sin límites.), visible en el HTML del servidor y no animado (LCP)", () => {
    assert.equal((HERO.match(/<h1[\s>]/g) ?? []).length, 1);
    const h1raw = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(HERO)?.[1] ?? "";
    assert.equal(texto(h1raw), "Automatización sin límites.");
    // El H1 renderiza de inmediato: nunca lleva .home-seq (que retrasa la aparición) -- protege el LCP.
    assert.doesNotMatch(/<h1[^>]*>/.exec(HERO)?.[0] ?? "", /home-seq/);
  });

  it("el eyebrow es 'Tecnología que impulsa operaciones'", () => {
    assert.match(texto(HERO), /Tecnología que impulsa operaciones/);
  });

  it("máximo 1 CTA principal + 1 secundario: 'Crear mi agente' y 'Hablar con DuLabs' con los destinos centralizados", () => {
    assert.match(HERO, new RegExp(`href="${CREAR_AGENTE_HREF.replace("?", "\\?")}"[^>]*>[\\s\\S]*?Crear mi agente`));
    assert.ok(HERO.includes(`href="${HABLAR_CON_DULABS_HREF.replace(/&/g, "&amp;")}"`), "falta el enlace de WhatsApp de ventas");
    assert.match(HERO, /Hablar con DuLabs/);
    assert.ok(HABLAR_CON_DULABS_HREF.startsWith("https://wa.me/"));
    // Exactamente 2 CTAs en el hero -- nada de teasers/CTAs extra (minimalismo de la referencia). El único otro enlace es el ancla interna
    // "Descubre más" (#capacidades), que no es un CTA.
    const enlaces = [...HERO.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(enlaces.filter((h) => !h.startsWith("#")).length, 2, `el hero debe tener solo 2 CTAs: ${enlaces.join(", ")}`);
    assert.deepEqual(enlaces.filter((h) => h.startsWith("#")), ["#capacidades"]);
    assert.match(texto(HERO), /Descubre más/);
    // El teaser antiguo "01 · Crea tu agente / 02 · A la medida" ya no vive en el hero (se mudó a las secciones del cuerpo).
    assert.doesNotMatch(texto(HERO), /01 · Crea tu agente|02 · A la medida/);
  });

  it("es un hero amplio: mensaje a la izquierda y la aurora a la derecha en desktop; en mobile texto -> aurora -> CTAs -> beneficios", () => {
    assert.match(HERO, /class="hx hx-hero /);
    // Un solo DOM: el orden del HTML es el de mobile (la aurora va entre el subtítulo y los CTAs); en desktop la aurora se posiciona absoluta.
    const [h1, sub, aurora, cta, beneficios] = ["<h1", "Conecta tus sistemas", "home-aurora", "Crear mi agente", "Implementación"].map((m) => HERO.indexOf(m));
    assert.ok(h1 < sub && sub < aurora && aurora < cta && cta < beneficios, "orden: H1 -> subtítulo -> aurora -> CTAs -> beneficios");
    assert.match(HERO, /class="home-aurora [^"]*lg:absolute[^"]*lg:left-\[33%\][^"]*lg:right-0/, "en desktop la aurora ocupa la zona derecha");
    // El H1 son dos líneas fijas que nunca se parten ("Automatización" / "sin límites.") con tamaño fluido en CSS (.home-hero-h1).
    assert.match(HERO, /<span class="block whitespace-nowrap">Automatización<\/span><span class="block whitespace-nowrap">sin límites\.<\/span>/);
    assert.match(HERO, /class="home-hero-h1 /);
  });

  it("la visualización es UNA aurora WebGL (un canvas, sin imágenes ni librerías) con fallback CSS, sin iconos de IA genéricos", () => {
    assert.equal((HERO.match(/<canvas /g) ?? []).length, 1, "un solo canvas");
    assert.match(HERO, /home-aurora-fallback/, "si WebGL no está disponible queda un fallback estático, nunca un hueco");
    assert.doesNotMatch(HERO, /<img |<video |\.gif|\.png|\.webp/, "la aurora no es una imagen ni un video");
    const fuente = readFileSync(join(RAIZ, "components", "home", "AuroraField.tsx"), "utf8");
    assert.match(fuente, /getContext\("webgl"/);
    assert.match(fuente, /requestAnimationFrame/);
    assert.match(fuente, /uniform float uTime;/);
    assert.match(fuente, /prefers-reduced-motion: reduce/);
    assert.match(fuente, /Math\.min\(window\.devicePixelRatio \|\| 1, compacto \? 1\.25 : 1\.5\)/, "DPR limitado (1.25 en mobile, 1.5 en desktop)");
    assert.doesNotMatch(fuente, /setInterval|setTimeout|useState/, "sin temporizadores ni estado de React por cuadro");
    // Nada de ilustraciones típicas de IA (robots, cerebros, circuitos, estrellas, hologramas).
    assert.doesNotMatch(HERO.toLowerCase(), /robot|cerebro|circuit|hologram|neural|\bbrain\b/);
  });

  it("beneficios: Implementación rápida, Seguridad empresarial y Resultados medibles, con iconos blancos (sin tarjetas)", () => {
    const t = texto(HERO);
    for (const b of ["Implementación rápida", "Seguridad empresarial", "Resultados medibles"]) assert.ok(t.includes(b), `falta: ${b}`);
    assert.equal((HERO.match(/class="lucide [^"]*text-site-fg/g) ?? []).length, 3, "los tres iconos usan el blanco del texto principal");
  });

  it("los detalles editoriales de desktop (rótulo lateral e indicadores) no existen en mobile", () => {
    assert.match(HERO, /<div aria-hidden="true" class="pointer-events-none absolute inset-0 hidden lg:block">/);
    for (const e of ["posibilidades", "Sistemas", "Personas", "Oportunidades"]) assert.ok(texto(HERO).includes(e), `falta: ${e}`);
  });

  it("no usa marcadores de posición ni claims de placeholder", () => {
    assert.doesNotMatch(texto(HERO).toLowerCase(), /lorem|próximamente|coming soon|placeholder/);
  });
});

describe("Home -- navbar", () => {
  it("enlaza a páginas reales del sitio (enlazado interno hacia el clúster SEO) y todas existen como rutas del app", () => {
    for (const l of HOME_NAV_LINKS) {
      assert.ok(NAV.includes(`href="${l.href}"`), `falta el enlace ${l.href}`);
      assert.ok(statSync(join(RAIZ, "app", l.href.replace(/^\//, ""))).isDirectory(), `no existe la ruta ${l.href}`);
    }
    assert.deepEqual(
      HOME_NAV_LINKS.map((l) => l.label),
      ["WhatsApp con IA", "Automatización", "Empresas", "Precios", "Developers"],
    );
  });

  it("incluye 'Iniciar sesión', 'Crear mi agente' y un logo con el archivo actual sin recolorear", () => {
    assert.ok(NAV.includes(`href="${CREAR_AGENTE_HREF}"`));
    assert.match(NAV, /Iniciar sesión/);
    assert.match(NAV, /Crear mi agente/);
    assert.match(NAV, /logo\.png/);
  });

  it("usa el contenedor amplio del hero: logo, enlaces y acciones se reparten por todo el ancho (justify-between)", () => {
    assert.match(NAV, /class="hx hx-hero relative flex h-16 items-center justify-between/);
  });
});

describe("Home -- estructura compacta: la puerta de entrada, no el sitio completo", () => {
  it("cada sección tiene su id, su H2 enlazado con aria-labelledby y no hay más H1", () => {
    for (const s of SECCIONES) {
      assert.match(s.html, new RegExp(`<section id="${s.id}" aria-labelledby="${s.id}-titulo"`), `sección ${s.id}`);
      assert.match(s.html, new RegExp(`<h2 id="${s.id}-titulo"`), `H2 de ${s.id}`);
      assert.doesNotMatch(s.html, /<h1[\s>]/, `${s.id} no debe tener H1`);
    }
    assert.equal((PAGINA.match(/<h1[\s>]/g) ?? []).length, 1);
  });

  it("los H2 comunican el mensaje de cada bloque", () => {
    const h2 = (id: string) => texto(new RegExp(`<h2 id="${id}-titulo"[^>]*>([\\s\\S]*?)</h2>`).exec(seccion(id))![1]);
    assert.match(h2("capacidades"), /Lo que tu agente hace por tu negocio/);
    assert.match(h2("como-funciona"), /Tu agente estándar lo configuras tú\./);
    assert.match(h2("agendamiento"), /De la conversación a la cita confirmada/);
    assert.match(h2("soluciones"), /Construimos tecnología para tu negocio\./);
    assert.match(h2("como-trabajamos"), /De la idea a una solución funcionando\./);
    assert.match(h2("preguntas-frecuentes"), /Respuestas claras antes de empezar/);
    assert.match(h2("empresas"), /No todas las empresas necesitan la misma tecnología\./);
    assert.match(h2("developers"), /Construye sobre DuLabs\./);
    assert.match(h2("contacto"), /Cuéntanos qué necesitas\./);
  });

  it("la página es UNA narrativa de 11 bloques, en este orden: hero, capacidades, crea tu agente, agendamiento, más que WhatsApp, planes, cómo trabajamos, FAQ, a la medida, developers y contacto", () => {
    const cuerpo = PAGINA_FUENTE.slice(PAGINA_FUENTE.indexOf("<main"), PAGINA_FUENTE.indexOf("</main>"));
    const bloques = [...cuerpo.matchAll(/<([A-Z][A-Za-z]+)[\s/>]/g)].map((m) => m[1]);
    assert.deepEqual(bloques, [
      "HomeHero",
      "CapabilitiesSection",
      "HowItWorksSection",
      "SchedulingSection",
      "MoreThanWhatsappSection",
      "PricingSection",
      "WorkProcessSection",
      "FaqSection",
      "CustomSolutionsSection",
      "DevelopersSection",
      "ContactSection",
    ]);
    // Footer (variante home) y el motor de microinteracciones van fuera de <main>; FinalCta se retiró: el cierre es Contacto.
    assert.match(PAGINA_FUENTE, /<\/main>\s*<Footer variante="home" \/>\s*<ScrollFx \/>/);
    assert.ok(!existsSync(join(RAIZ, "components", "home", "FinalCta.tsx")));
  });

  it("no vuelven las secciones enciclopédicas: cada una tiene su propia página y la home solo la enlaza", () => {
    for (const eliminado of ["ProblemSection", "AgentActionsSection", "ConfigSection", "ConfigWizard", "CatalogSection", "KnowledgeSection", "BusinessTypesSection", "StepsSection", "TrustSection", "DeveloperStrip", "TrackBand", "InView"]) {
      assert.ok(!existsSync(join(RAIZ, "components", "home", `${eliminado}.tsx`)), `${eliminado} debe seguir eliminado de la home`);
      assert.doesNotMatch(PAGINA_FUENTE, new RegExp(eliminado));
    }
    assert.ok(!existsSync(join(RAIZ, "lib", "home", "negocios.ts")));
  });

  it("sigue siendo contenida: el texto visible no se infla, una sola FAQ de 8 preguntas y sin secciones repetidas", () => {
    // La home anterior al rediseño enciclopédico (13 secciones) tenía ~25.000 caracteres visibles en sus secciones propias. La narrativa actual
    // (10 secciones propias + planes) debe quedarse muy por debajo: cada bloque dice lo suyo y enlaza la profundidad. Incluye las respuestas
    // de la FAQ, que están en el HTML aunque el acordeón las muestre cerradas.
    assert.ok(TEXTO_PAGINA.length < 15500, `texto visible de la home: ${TEXTO_PAGINA.length} caracteres`);
    assert.equal((seccion("preguntas-frecuentes").match(/<details /g) ?? []).length, 8);
    assert.equal((PAGINA.match(/<section /g) ?? []).length, 10, "hero + 9 secciones propias (más PricingSection = 11 bloques)");
    assert.equal(new Set(SECCIONES.map((x) => x.id)).size, SECCIONES.length, "sin ids de sección repetidos");
  });

  it("las páginas internas siguen existiendo y la home las enlaza (la profundidad vive allí)", () => {
    const enlaces = new Set([...(NAV + PAGINA).matchAll(/href="(\/[a-z0-9-]*)"/g)].map((m) => m[1]));
    for (const ruta of ["/whatsapp-ia", "/automatizacion-empresas", "/soluciones-empresariales", "/precios", "/developer-platform", "/integraciones", "/preguntas-frecuentes", CASOS_HREF]) {
      assert.ok(existsSync(join(RAIZ, "app", ruta.replace(/^\//, ""), "page.tsx")), `la página ${ruta} debe existir`);
      assert.ok(enlaces.has(ruta), `la home debe enlazar a ${ruta}`);
    }
  });

  it("A la medida: CTAs correctos, 4 tarjetas con las categorías publicadas, sin clientes/logos/cifras y con la cotización según alcance", () => {
    const html = seccion("empresas");
    assert.ok(html.includes(`href="${HABLAR_ESPECIALISTA_HREF.replace(/&/g, "&amp;")}"`), "falta 'Hablar con un especialista'");
    assert.ok(html.includes(`href="${ENTERPRISE_HREF}"`));
    assert.ok(html.includes(`href="${CASOS_HREF}"`));
    assert.match(HABLAR_ESPECIALISTA_HREF, /^https:\/\/wa\.me\//);
    const t = texto(html);
    assert.match(t, /Hablar con un especialista/);
    assert.match(t, /automatización empresarial/);
    assert.match(t, /Cotización personalizada según el alcance; el tiempo depende del proyecto/);
    assert.match(t, /no todos los proyectos incluyen todo esto/);
    assert.deepEqual(
      CAPACIDADES_A_MEDIDA.map((c) => c.titulo),
      ["Automatizaciones", "Integraciones", "Sistemas personalizados", "Soluciones empresariales"],
    );
    for (const c of CAPACIDADES_A_MEDIDA) for (const it of c.items) assert.ok(t.includes(it), `falta: ${it}`);
    assert.doesNotMatch(t, /\b\d+\s?(clientes|empresas|proyectos)\b/i, "sin cifras de clientes/proyectos");
    // La red de capacidades nombra solo líneas de trabajo reales de DuLabs.
    for (const nodo of ["CRM", "IA", "Automatización", "Integraciones", "Software", "Datos"]) assert.ok(t.includes(nodo), `falta el nodo ${nodo}`);
    // El enlace 'Contacto' del footer (/#contacto) lleva a la sección de contacto propia.
    assert.match(seccion("contacto"), /<section id="contacto"/);
    assert.match(readFileSync(join(RAIZ, "components", "site", "Sections.tsx"), "utf8"), /h: "\/#contacto"/);
  });

  it("Más que WhatsApp: las 4 líneas de trabajo que el sitio publica, sin tarjetas y con una visualización SVG por línea", () => {
    const html = seccion("soluciones");
    const t = texto(html);
    for (const linea of ["IA & Automatización", "Software a medida", "Integraciones", "Datos & Operaciones"]) {
      assert.ok(t.includes(linea.replace("&", "&amp;")) || t.includes(linea), `falta: ${linea}`);
      assert.ok(readFileSync(join(RAIZ, "components", "site", "EnterpriseSections.tsx"), "utf8").includes(`"${linea}"`), `${linea} debe ser una línea ya publicada`);
    }
    assert.equal((html.match(/data-fx-opcion=/g) ?? []).length, 4);
    assert.equal((html.match(/<svg /g) ?? []).length, 4, "una visualización por línea");
    assert.doesNotMatch(html, /<img |rounded-2xl/, "sin imágenes ni tarjetas");
  });

  it("Cómo trabajamos: línea de tiempo de 4 pasos (entendemos -> diseñamos -> desarrollamos -> implementamos) activada por scroll", () => {
    const html = seccion("como-trabajamos");
    const t = texto(html);
    let ultima = -1;
    for (const paso of ["01 Entendemos", "02 Diseñamos", "03 Desarrollamos", "04 Implementamos"]) {
      const pos = t.indexOf(paso);
      assert.ok(pos > ultima, `el paso "${paso}" falta o está fuera de orden`);
      ultima = pos;
    }
    assert.match(html, /data-fx-grupo/);
    assert.equal((html.match(/data-fx-disparador/g) ?? []).length, 4);
    assert.match(t, /El tiempo depende del alcance/);
  });

  it("Developers: el contrato público real de la API (POST /api/v1/messages, Bearer dl_live_, Idempotency-Key, 201, webhooks) y sus rutas", () => {
    const html = seccion("developers");
    const t = texto(html);
    for (const pieza of ["/api/v1/messages", "Bearer dl_live_", "Idempotency-Key", "201", "message.received", "message.status", "HMAC-SHA256"]) assert.ok(t.includes(pieza), `falta: ${pieza}`);
    for (const paso of ["request", "accepted", "sent", "webhook"]) assert.ok(t.includes(paso), `falta el paso ${paso}`);
    assert.ok(html.includes(`href="${DEVELOPER_PLATFORM_HREF}"`) && html.includes(`href="${DEVELOPER_DOCS_HREF}"`));
    // Mismo contrato que publica la plataforma para developers (no se inventa uno para la home).
    const hero = readFileSync(join(RAIZ, "components", "developer-platform", "DevHero.tsx"), "utf8");
    for (const pieza of ["Bearer dl_live_", "Idempotency-Key", '"whatsappNumberId"', '"jobId"']) assert.ok(hero.includes(pieza), pieza);
    const openapi = readFileSync(join(RAIZ, "lib", "developers", "openapi.ts"), "utf8");
    for (const evento of ["message.received", "message.status"]) assert.ok(openapi.includes(`"${evento}"`), evento);
  });

  it("el único caso que se nombra (DuMo) existe publicado en /casos y las categorías de A la medida son las que publica el sitio", () => {
    const casos = readFileSync(join(RAIZ, "components", "site", "CasosSections.tsx"), "utf8");
    assert.match(casos, /nombre: "DuMo"/);
    assert.match(casos, /desarrollado por DuLabs/);
    assert.match(texto(seccion("empresas")), /DuMo/);
    const publicado = readFileSync(join(RAIZ, "components", "site", "EnterpriseSections.tsx"), "utf8") + readFileSync(join(RAIZ, "app", "soluciones-empresariales", "page.tsx"), "utf8");
    for (const c of ["Automatización de procesos", "CRM", "Plataformas web", "Dashboards"]) assert.ok(publicado.includes(c) || readFileSync(join(RAIZ, "lib", "home", "enterprise.ts"), "utf8").includes(c), c);
  });
});

describe("Home -- fidelidad contra el producto real", () => {
  const wizard = readFileSync(join(RAIZ, "components", "dashboard", "business-agent", "Wizard.tsx"), "utf8");

  it("capacidades: 7 tarjetas, todas respaldadas por el Runtime (available: true), sin pedidos ni pagos, y cubren las 6 capacidades reales", () => {
    assert.equal(CAPACIDADES_HOME.length, 7);
    assert.deepEqual(
      CAPACIDADES_HOME.map((c) => c.titulo),
      ["Responder clientes", "Consultar información del negocio", "Mostrar catálogo", "Agendar citas", "Consultar Google Calendar", "Capturar leads", "Transferir a una persona"],
    );
    for (const c of CAPACIDADES_HOME) for (const k of c.capacidades) assert.equal(CAPABILITY_BACKING[k].available, true, `${k} no está disponible en el Runtime`);
    const usadas = new Set(CAPACIDADES_HOME.flatMap((c) => c.capacidades));
    assert.ok(!usadas.has("orders") && !usadas.has("payments"), "pedidos y pagos no existen: no pueden mostrarse");
    assert.deepEqual(
      [...usadas].sort(),
      CAPABILITY_KEYS.filter((k) => CAPABILITY_BACKING[k].available).sort(),
      "la home debe cubrir exactamente las capacidades disponibles (lo mismo que anuncia el JSON-LD)",
    );
    const t = texto(seccion("capacidades"));
    for (const c of CAPACIDADES_HOME) assert.ok(t.includes(c.titulo) && t.includes(c.texto), `falta la tarjeta ${c.titulo}`);
    assert.match(t, /no cobra ni toma pedidos/i, "la home debe aclarar que no cobra ni toma pedidos");
    assert.equal(CAPABILITY_BACKING.orders.available, false);
    assert.equal(CAPABILITY_BACKING.payments.available, false);
  });

  it("las etiquetas de capacidades (JSON-LD) son EXACTAMENTE las del Wizard real", () => {
    for (const etiqueta of Object.values(ETIQUETA_CAPACIDAD)) assert.ok(wizard.includes(`es: "${etiqueta}"`), `el Wizard no tiene la capacidad "${etiqueta}"`);
    assert.equal(Object.keys(ETIQUETA_CAPACIDAD).length, 8);
  });

  it("los pasos del asistente son los reales y aparecen en el mismo orden que en el Wizard", () => {
    const zona = wizard.slice(wizard.indexOf("function STEP_LABEL"));
    let ultima = -1;
    for (const paso of PASOS_DEL_WIZARD) {
      // "Servicios y productos" es la variante combinada del paso 'servicios' (ver STEP_LABEL).
      const pos = zona.indexOf(`t("${paso}"`);
      assert.notEqual(pos, -1, `el Wizard no tiene el paso "${paso}"`);
      if (paso !== "Servicios y productos") {
        assert.ok(pos > ultima, `el paso "${paso}" está fuera de orden respecto al Wizard`);
        ultima = pos;
      }
    }
  });

  it("Crea tu agente: 5 etapas en orden (crea -> configura -> prueba -> publica -> administra), con pasos reales del Wizard y textos respaldados", () => {
    assert.deepEqual(
      ETAPAS_CREA_TU_AGENTE.map((e) => e.titulo),
      ["Crea", "Configura", "Prueba", "Publica", "Administra"],
    );
    for (const e of ETAPAS_CREA_TU_AGENTE) for (const p of e.pasos) assert.ok((PASOS_DEL_WIZARD as readonly string[]).includes(p), `${p} no es un paso del Wizard`);
    const html = seccion("como-funciona");
    const t = texto(html);
    const posiciones = ETAPAS_CREA_TU_AGENTE.map((e) => t.indexOf(`0${ETAPAS_CREA_TU_AGENTE.indexOf(e) + 1} ${e.titulo}`));
    assert.ok(posiciones.every((p) => p >= 0), `faltan etapas: ${posiciones.join(",")}`);
    assert.deepEqual([...posiciones].sort((a, b) => a - b), posiciones, "las etapas deben ir en orden");
    assert.equal((html.match(/<ol /g) ?? []).length, 1);
    assert.match(t, /Con el asistente paso a paso del panel cargas la información de tu negocio, pruebas y publicas\./);
    assert.match(t, /Lo creas, lo configuras y lo administras tú mismo, sin necesidad de programar\./);
    // Lo que se afirma existe en el panel: vista previa 100 % simulada, validación previa a publicar e historial de versiones.
    assert.match(readFileSync(join(RAIZ, "components", "dashboard", "business-agent", "BusinessAgentPreview.tsx"), "utf8"), /100% simulado -- no envía WhatsApp real ni ejecuta acciones de negocio/);
    const versiones = readFileSync(join(RAIZ, "components", "dashboard", "business-agent", "VersionsPanel.tsx"), "utf8");
    for (const estado of ["Publicar esta versión", "Historial de versiones"]) assert.ok(versiones.includes(estado), `VersionsPanel no tiene "${estado}"`);
    assert.match(t, /no envía WhatsApp real ni ejecuta acciones de negocio/);
    assert.match(t, /queda el historial de versiones/);
  });

  it("agendamiento: flujo Cliente -> Agente -> Google Calendar -> Cita creada; la IA interpreta y el SISTEMA calcula la disponibilidad", () => {
    const t = texto(seccion("agendamiento"));
    let ultima = -1;
    for (const nodo of ["Cliente", "Agente", "Google Calendar", "Cita creada"]) {
      const pos = t.indexOf(nodo, ultima + 1);
      assert.ok(pos > ultima, `el nodo "${nodo}" falta o está fuera de orden`);
      ultima = pos;
    }
    assert.match(t, /La disponibilidad y las reglas las calcula el sistema: la IA nunca inventa un horario/);
    assert.match(t, /Cancelar y reprogramar desde WhatsApp funciona con Google Calendar conectado/);
    assert.match(t, /Ejemplo ilustrativo/);
    assert.doesNotMatch(t.toLowerCase(), /la ia calcula|la ia decide|la ia consulta el calendario/);
    const readiness = readFileSync(join(RAIZ, "lib", "business-agent-readiness.ts"), "utf8");
    assert.match(readiness, /solo actúa con Google Calendar/);
  });

  it("precios: se reutiliza PricingSection (componente existente) sin escribir precios en la home", () => {
    assert.match(PAGINA_FUENTE, /import \{ Footer, PricingSection \} from "@\/components\/site\/Sections";/);
    assert.match(PAGINA_FUENTE, /<PricingSection\s+variante="home"\s+showComparisonLink\s+descripcion="[^"]+"\s+notaImplementacion="[^"]+"\s+notaSuscripcion="[^"]+"\s+\/>/);
    const componente = readFileSync(join(RAIZ, "components", "site", "Sections.tsx"), "utf8");
    assert.match(componente, /def\.precioCop/, "PricingSection debe leer los precios de PLANES (lib/planes.ts)");
  });

  it("SEO natural: usa los términos objetivo sin relleno de palabras clave", () => {
    const t = TEXTO_PAGINA.toLowerCase();
    for (const termino of ["agente de ia", "agentes de ia", "whatsapp", "google calendar", "automatización empresarial", "crea tu agente", "a la medida"]) {
      assert.ok(t.includes(termino), `falta el término natural: ${termino}`);
    }
    const veces = (frase: string) => t.split(frase).length - 1;
    const palabras = t.split(/\s+/).length;
    assert.ok((veces("agente de ia") + veces("agentes de ia")) / palabras <= 0.02, "demasiada densidad de 'agente(s) de IA'");
    assert.ok(veces("automatización empresarial") <= 4, "demasiada repetición de 'automatización empresarial'");
    // "WhatsApp con IA" es la frase que posee /whatsapp-ia: la home solo la usa como texto de enlace hacia esa página (<= 2 veces).
    assert.ok(veces("whatsapp con ia") <= 2, "la home no debe competir con /whatsapp-ia por 'WhatsApp con IA'");
    assert.ok(veces("agente de ia para whatsapp") + veces("agentes de ia para whatsapp") <= 5, "demasiada repetición de 'agente de IA para WhatsApp'");
  });
});

describe("Home -- guardas de calidad", () => {
  it("no contiene claims falsos ni no verificables", () => {
    const prohibidos: [RegExp, string][] = [
      [/(en|menos de|dentro de|listo en|configurad[oa]s? en)\s*24\s*horas/i, "promesa de '24 horas' (decisión: no prometerla)"],
      [/<\s*2\s*s\b|menos de 2 segundos/i, "'<2s' (la IA tarda varios segundos por turno)"],
      [/instant[aá]ne/i, "'instantáneo'"],
      [/100\s?%/, "porcentajes absolutos"],
      [/sin herramientas no oficiales/i, "'sin herramientas no oficiales' (existe un canal QR interno)"],
      [/garantiz|garantía/i, "garantías"],
      [/ilimitad/i, "'ilimitado'"],
      [/clientes que conf[ií]an|nuestros clientes/i, "prueba social de clientes"],
      [/testimonio|reseña/i, "testimonios"],
      [/\b(hubspot|salesforce|zapier|shopify|woocommerce|outlook)\b/i, "integraciones nativas que no existen"],
      [/\b(cobra|cobrar|pagos? (automáticos?|por whatsapp)|toma pedidos)\b/i, "pedidos/pagos del agente (no existen)"],
      [/embedding|vectorial|búsqueda semántica|sinónimos/i, "búsqueda semántica (la búsqueda es por palabras)"],
      [/nunca se comparte|100% seguro|sin riesgo/i, "promesas absolutas de seguridad"],
      [/autoservicio/i, "la primera línea comercial se llama 'Crea tu agente' (decisión de producto)"],
      [/nosotros (lo )?configuramos|te lo configuramos|te configuramos|configurado por nuestro equipo|que me configuren|tú no configuras nada|lo hacemos nosotros|no es algo que el due/i, "modelo antiguo: 'DuLabs configura el agente por ti'"],
      [/especialistas? de DuLabs (te|configura|revisar|continuar)/i, "la implementación manual de DuLabs no es un requisito para crear el agente"],
      [/\bISO ?\d{3,5}\b|SOC ?2|certificad[oa]s?\b|certificaci[oó]n/i, "certificaciones que DuLabs no tiene"],
    ];
    // Frases NEGATIVAS/HONESTAS permitidas (dicen lo que el producto NO hace) y las etiquetas de capacidades no disponibles.
    const permitidas = [/no cobra ni toma pedidos/gi, /Meta[^.]{0,40}cobra[^.]{0,40}directamente/gi, /Meta los cobra directamente/gi, /"Cobrar"/g, /"Tomar pedidos"/g, /Tomar pedidos/g];
    for (const ruta of FUENTES_HOME) {
      let fuente = sinComentarios(readFileSync(ruta, "utf8"));
      for (const p of permitidas) fuente = fuente.replace(p, "");
      for (const [patron, motivo] of prohibidos) assert.doesNotMatch(fuente, patron, `${relative(RAIZ, ruta)}: ${motivo}`);
    }
  });

  it("no usa los logos de clientes no verificados (TrustedBySection sigue fuera de la home)", () => {
    for (const ruta of FUENTES_HOME) assert.doesNotMatch(readFileSync(ruta, "utf8"), /logos-clientes|TrustedBySection/, relative(RAIZ, ruta));
  });

  it("solo hay JS cliente donde hace falta: enlace con tracking, menú móvil, aurora WebGL, formulario de contacto y el motor único de microinteracciones (ScrollFx)", () => {
    const clientes = FUENTES_HOME.filter((r) => /^\s*["']use client["']/.test(readFileSync(r, "utf8"))).map((r) => relative(RAIZ, r).replace(/\\/g, "/"));
    assert.deepEqual(clientes.sort(), [
      "components/home/AuroraField.tsx",
      "components/home/ContactSection.tsx",
      "components/home/HomeMobileMenu.tsx",
      "components/home/ScrollFx.tsx",
      "components/home/TrackedLink.tsx",
    ]);
  });

  it("no agrega librerías: la home solo importa de react, next, lucide-react (ya instalada) y rutas propias", () => {
    for (const ruta of FUENTES_HOME) {
      for (const m of readFileSync(ruta, "utf8").matchAll(/^import[^"']*from\s+["']([^"']+)["']/gm)) {
        const origen = m[1];
        assert.ok(origen.startsWith("@/") || origen.startsWith("./") || origen === "react" || origen.startsWith("next") || origen === "lucide-react", `${relative(RAIZ, ruta)}: import inesperado ${origen}`);
      }
    }
  });

  it("no hay precios de PLANES escritos a mano: los planes solo se leen de lib/planes.ts", () => {
    for (const ruta of FUENTES_HOME) assert.doesNotMatch(sinComentarios(readFileSync(ruta, "utf8")), /(79\.?990|159\.?990|299\.?990|49\.?990|149\.?990|199\.?990)/, relative(RAIZ, ruta));
  });

  it("los datos de ejemplo (jueves 3:30 p. m., $30.000...) están rotulados como ejemplo en cada bloque que los muestra", () => {
    assert.match(texto(seccion("agendamiento")).toLowerCase(), /ejemplo ilustrativo/);
    // El hero ya no muestra datos de negocio concretos (era un chat de ejemplo); ahora es una visualización abstracta del sistema.
  });

  it("la home es indexable con canónica a '/', está en el sitemap y la ruta temporal /home-v3 ya no existe", () => {
    assert.match(PAGINA_FUENTE, /homeMetadata\(\{ path: HOME_PATH, indexable: true \}\)/);
    assert.equal(HOME_PATH, "/");
    const robotsHome = homeMetadata({ path: HOME_PATH, indexable: true }).robots as { index: boolean; follow: boolean };
    assert.deepEqual([robotsHome.index, robotsHome.follow], [true, true]);
    const urls = sitemap().map((e) => e.url);
    assert.ok(urls.some((u) => u.endsWith("/") && !u.replace(/^https?:\/\/[^/]+/, "").slice(1)), "la home '/' debe estar en el sitemap");
    assert.ok(!urls.some((u) => u.includes("home-v3")), "/home-v3 no debe estar en el sitemap");
    assert.ok(!readdirSync(join(RAIZ, "app")).includes("home-v3"), "la ruta temporal app/home-v3 debe haberse retirado");
  });

  it("no toca lo que está fuera de alcance de la home (planes, Developer, dashboard, login, APIs)", () => {
    for (const ruta of FUENTES_HOME) {
      assert.doesNotMatch(readFileSync(ruta, "utf8"), /from "@\/components\/(developer|developer-platform|dashboard)\//, `${relative(RAIZ, ruta)} no debe importar componentes de Developer/dashboard`);
    }
  });
});

describe("Home -- diseño fluido y responsive real (aprovecha pantallas grandes)", () => {
  const css = readFileSync(join(RAIZ, "app", "globals.css"), "utf8").replace(/\r\n/g, "\n");
  const cssHome = css.slice(css.indexOf("Home principal v3"));
  const anchoMax = (clase: string) => Number(new RegExp(`\\.home-scope \\.${clase} \\{ --hx-max: (\\d+)px; \\}`).exec(cssHome)?.[1]);

  it("el contenedor es FLUIDO (~92 % del viewport, margen mínimo en móvil) con un tope alto por tipo de contenido", () => {
    assert.match(cssHome, /\.home-scope \.hx \{\s*width: min\(92%, calc\(100% - 2\.5rem\), var\(--hx-max, 1500px\)\);\s*margin-inline: auto;\s*\}/);
    const [hero, grid, lectura] = [anchoMax("hx-hero"), anchoMax("hx-grid"), anchoMax("hx-read")];
    assert.ok(hero >= 1400 && hero <= 1700, `hero: ${hero}`);
    assert.ok(grid >= 1300 && grid <= 1600, `rejillas: ${grid}`);
    assert.ok(lectura >= 900 && lectura <= 1200, `lectura: ${lectura}`);
    assert.ok(hero >= grid && grid > lectura, "el hero es lo más amplio y la lectura lo más estrecho");
  });

  it("ya no hay contenedores angostos fijos (max-w-[1240px] y similares) en la home", () => {
    for (const ruta of FUENTES_HOME) assert.doesNotMatch(readFileSync(ruta, "utf8"), /max-w-\[(1[0-3]\d{2}|9\d{2})px\]/, `${relative(RAIZ, ruta)}: contenedor angosto fijo`);
    assert.doesNotMatch(cssHome, /max-width:\s*1[0-3]\d{2}px/);
  });

  it("cada bloque usa el contenedor fluido con el ancho que le corresponde: rejillas amplias y FAQ de lectura más estrecha", () => {
    for (const id of ["capacidades", "como-funciona", "agendamiento", "soluciones", "como-trabajamos", "empresas", "developers", "contacto"]) assert.match(seccion(id), /class="hx hx-grid /, id);
    assert.match(seccion("preguntas-frecuentes"), /class="hx hx-read /);
    assert.match(HERO, /class="hx hx-hero /);
  });

  it("PricingSection y Footer (componentes compartidos) usan su variante home, con el contenedor fluido; el resto del sitio no cambia", () => {
    const sections = readFileSync(join(RAIZ, "components", "site", "Sections.tsx"), "utf8");
    assert.match(sections, /if \(variante === "home"\) \{\s*return \(\s*<section id="precios" aria-labelledby="precios-titulo"[^>]*>\s*<div className="hx hx-grid /);
    assert.match(sections, /if \(variante === "home"\) \{\s*return \(\s*<footer[^>]*>\s*<div className="hx hx-grid /);
    assert.match(sections, /variante = "sitio"/, "por defecto (el resto del sitio) la presentación no cambia");
    assert.match(cssHome, /\.home-scope #precios a,\s*\.home-scope #precios button \{ min-height: 44px; \}/);
    assert.match(cssHome, /\.home-scope footer a \{ display: inline-flex; align-items: center; min-height: 44px; \}/);
    assert.ok(!/#precios/.test(css.slice(0, css.indexOf("Home principal v3"))), "las reglas de #precios solo existen bajo .home-scope");
  });

  it("móvil primero: ninguna rejilla arranca en varias columnas (las columnas solo aparecen desde un breakpoint)", () => {
    for (const ruta of FUENTES_HOME.filter((r) => r.endsWith(".tsx"))) {
      const fuente = readFileSync(ruta, "utf8");
      for (const m of fuente.matchAll(/(?:^|[\s"'`])(grid-cols-(?:[2-9]|\[[^\]]+\]))/g)) assert.fail(`${relative(RAIZ, ruta)}: '${m[1]}' sin breakpoint (en móvil debe ser una columna)`);
    }
  });

  it("las composiciones editoriales pasan a una columna en mobile y se abren por breakpoints (índice + encabezado, flujo 1 -> 5)", () => {
    for (const id of ["capacidades", "agendamiento", "como-trabajamos"]) assert.match(seccion(id), /lg:grid-cols-\[minmax\(0,0\.8fr\)_minmax\(0,1\.2fr\)\]/, id);
    assert.match(seccion("como-funciona"), /xl:grid-cols-5/);
    assert.match(seccion("soluciones"), /lg:grid-cols-\[minmax\(0,1\.15fr\)_minmax\(0,0\.85fr\)\]/);
    assert.match(seccion("empresas"), /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
    assert.match(seccion("contacto"), /lg:grid-cols-\[minmax\(0,0\.9fr\)_minmax\(0,1\.1fr\)\]/);
  });

  it("sin grids de tarjetas: las secciones propias no usan tarjetas con fondo (el único bloque con borde es el código de Developers)", () => {
    for (const s of SECCIONES) assert.doesNotMatch(s.html, /rounded-(xl|2xl)[^"]*bg-site-card|bg-site-card[^"]*rounded-(xl|2xl)/, `${s.id} no debe tener tarjetas`);
  });

  it("las microinteracciones son un solo IntersectionObserver sin estado de React por cuadro ni listeners de scroll", () => {
    const fx = readFileSync(join(RAIZ, "components", "home", "ScrollFx.tsx"), "utf8");
    assert.match(fx, /new IntersectionObserver/);
    assert.doesNotMatch(fx, /useState|addEventListener\("scroll"|requestAnimationFrame|setInterval/);
    // Sin JS el contenido queda visible: los estados pendientes solo existen bajo html.fx-listo, que agrega ScrollFx.
    assert.match(fx, /classList\.add\("fx-listo"\)/);
    for (const m of cssHome.matchAll(/opacity: 0; transform: translateY/g)) {
      const regla = cssHome.slice(cssHome.lastIndexOf("\n", m.index!), m.index!);
      if (/home-fx-subir|home-log-fila/.test(regla)) assert.match(regla, /\.fx-listo/, "el estado oculto debe depender de .fx-listo");
    }
    // Sin scroll hijacking: el flujo usa CSS sticky, nunca bloquea el scroll.
    assert.match(seccion("como-funciona"), /xl:sticky/);
    assert.doesNotMatch(readFileSync(join(RAIZ, "app", "globals.css"), "utf8"), /overflow:\s*hidden[^}]*\.fx-listo|scroll-snap-type/);
  });

  it("los objetivos táctiles y el foco visible se conservan (enlaces de al menos 44 px)", () => {
    for (const html of [seccion("preguntas-frecuentes"), seccion("como-funciona"), seccion("empresas"), seccion("developers"), seccion("contacto")]) assert.match(html, /min-h-11/);
    assert.match(seccion("preguntas-frecuentes"), /min-h-14/);
  });
});

describe("Home -- identidad monocroma: el color es una señal (azul/violeta de la aurora, verde DuLabs solo para confirmar)", () => {
  // La home es monocroma (negro/blanco/gris). El color solo aparece como SEÑAL y solo en CSS: la paleta de la aurora (#315CFF #1D4FFF
  // #6547FF #5E8CFF #EAF2FF y el rgba(90,130,255) de los puntos) para lo activo/tecnológico, y el verde DuLabs (#A8FF3E) como microacento de
  // "resultado confirmado". Ningún componente escribe colores a mano; cualquier otro color cromático sigue prohibido.
  const PALETA_AURORA = ["#315cff", "#1d4fff", "#6547ff", "#5e8cff", "#eaf2ff", "#a8ff3e"];
  const RGB_AURORA = ["49,92,255", "29,79,255", "101,71,255", "94,140,255", "234,242,255", "90,130,255", "168,255,62"];
  function luminancia(hex: string): number {
    const canales = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * canales[0] + 0.7152 * canales[1] + 0.0722 * canales[2];
  }
  const contraste = (a: string, b: string) => {
    const [la, lb] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
    return (la + 0.05) / (lb + 0.05);
  };
  const css = readFileSync(join(RAIZ, "app", "globals.css"), "utf8").replace(/\r\n/g, "\n");
  // Solo los bloques de la home (desde su cabecera hasta el final): el resto del archivo es de otros productos (p. ej. la V2 de /newversion).
  const cssHome = css.slice(css.indexOf("Home principal v3"));
  const cssAurora = cssHome.slice(cssHome.indexOf("Home · hero con aurora"));
  // Los tokens --color-dev-accent* están en un @theme anterior a .dev-scope; los site-* (los que /developer-platform re-mapea a monocromo) dentro de .dev-scope.
  const token = (nombre: string): string => {
    const zona = nombre.startsWith("--color-dev-accent") ? css : css.slice(css.indexOf(".dev-scope {"));
    return new RegExp(`${nombre}:\\s*(#[0-9a-fA-F]{6})`).exec(zona)?.[1] ?? "";
  };
  const neutro = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return r === g && g === b;
  };
  const hexes = (t: string) => [...t.matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => "#" + m[1].toLowerCase());
  const rgbs = (t: string) => [...t.matchAll(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);

  it("no queda ningún naranja ni token de acento en los componentes, datos, página ni CSS de la home", () => {
    const naranja = /#ff5c1a|255[ ,]+92[ ,]+26|home-accent|\borange\b|naranja/i;
    for (const ruta of FUENTES_HOME) assert.doesNotMatch(readFileSync(ruta, "utf8"), naranja, relative(RAIZ, ruta));
    assert.doesNotMatch(cssHome, naranja, "globals.css (bloques de la home)");
  });

  it("todos los colores de la home son neutros (R = G = B), salvo la paleta de la aurora, que solo vive en su bloque de CSS", () => {
    const cssFueraDeAurora = cssHome.slice(0, cssHome.indexOf("Home · hero con aurora"));
    const fuentes = [...FUENTES_HOME.map((r) => [relative(RAIZ, r), sinComentarios(readFileSync(r, "utf8"))]), ["globals.css (home, sin aurora)", cssFueraDeAurora]] as [string, string][];
    for (const [nombre, t] of fuentes) {
      for (const h of hexes(t)) assert.ok(neutro(h), `${nombre}: color no neutro ${h}`);
      for (const [r, g, b] of rgbs(t)) assert.ok(r === g && g === b, `${nombre}: color no neutro rgb(${r} ${g} ${b})`);
      // Se sigue prohibiendo TODA utilidad de color de Tailwind (incl. lime/green/blue): el color de la aurora vive en el shader y en CSS.
      assert.doesNotMatch(t, /\b(bg|text|border|ring|from|to|via|fill|stroke)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-?\d{0,3}\b/, `${nombre}: utilidad de color de Tailwind`);
    }
    for (const h of hexes(cssAurora)) assert.ok(neutro(h) || PALETA_AURORA.includes(h), `aurora: color fuera de la paleta ${h}`);
    for (const [r, g, b] of rgbs(cssAurora)) assert.ok((r === g && g === b) || RGB_AURORA.includes(`${r},${g},${b}`), `aurora: color fuera de la paleta rgb(${r} ${g} ${b})`);
  });

  it("el verde DuLabs es solo un microacento: un token (--home-verde) usado únicamente para confirmar un resultado", () => {
    assert.doesNotMatch(cssHome, /#c6ff3d|--home-signal/i, "el verde anterior y su token se retiraron");
    assert.equal([...cssHome.matchAll(/#a8ff3e/gi)].length, 1, "el hex del verde aparece una sola vez: la definición del token");
    assert.match(cssHome, /--home-verde:\s*#a8ff3e;/);
    for (const m of cssHome.matchAll(/var\(--home-verde\)|168, 255, 62/g)) {
      const regla = cssHome.slice(cssHome.lastIndexOf("}", m.index!) + 1, m.index!);
      assert.match(regla, /home-log-fila--ok|home-form-ok|home-estado/, `el verde solo confirma resultados: ${regla.trim().slice(0, 80)}`);
    }
    for (const ruta of FUENTES_HOME) assert.doesNotMatch(sinComentarios(readFileSync(ruta, "utf8")), /#c6ff3d|#a8ff3e|home-signal/i, relative(RAIZ, ruta));
    assert.ok(!existsSync(join(RAIZ, "components", "home", "HeroSystem.tsx")), "el hero de placas se retiró");
  });

  it("el CTA principal es blanco con texto oscuro (mismos tokens que el botón primario de /developer-platform)", () => {
    for (const [nombre, html] of [["hero", HERO], ["navbar", NAV], ["a la medida", seccion("empresas")], ["developers", seccion("developers")], ["contacto", seccion("contacto")]] as [string, string][]) {
      assert.match(html, /bg-dev-accent /, `${nombre}: el CTA principal debe usar bg-dev-accent`);
      assert.match(html, /text-dev-accent-fg/, `${nombre}: el texto del CTA debe ser oscuro`);
    }
    assert.match(readFileSync(join(RAIZ, "components", "home", "HomeMobileMenu.tsx"), "utf8"), /bg-dev-accent /);
    assert.match(readFileSync(join(RAIZ, "components", "developer-platform", "DevHero.tsx"), "utf8"), /bg-dev-accent /, "referencia: el botón primario de /developer-platform usa el mismo token");
  });

  it("los tokens de la identidad de referencia (.dev-scope) no se tocaron y el primario es blanco sobre negro", () => {
    assert.equal(token("--color-dev-accent"), "#fafafa");
    assert.equal(token("--color-dev-accent-fg"), "#0a0a0a");
    assert.equal(token("--color-site-bg"), "#070707");
    assert.equal(token("--color-site-primary"), "#fafafa");
    assert.doesNotMatch(cssHome, /--color-site-primary\s*:/, "la home no remapea site-primary: PricingSection y Footer usan el blanco de .dev-scope");
  });

  it("contraste WCAG: botón primario, texto principal y texto atenuado sobre fondo y tarjetas", () => {
    const fondo = token("--color-site-bg");
    const tarjeta = token("--color-site-card");
    const atenuado = token("--color-site-muted-fg");
    assert.ok(contraste(token("--color-dev-accent"), token("--color-dev-accent-fg")) >= 7, "botón primario (AAA)");
    assert.ok(contraste(token("--color-site-fg"), fondo) >= 15, "texto principal sobre fondo");
    assert.ok(contraste(atenuado, fondo) >= 4.5, "texto atenuado sobre fondo (AA)");
    assert.ok(contraste(atenuado, tarjeta) >= 4.5, "texto atenuado sobre tarjeta (AA)");
    assert.ok(contraste(token("--color-site-fg"), fondo) >= 3, "el anillo de foco blanco es visible sobre el fondo (WCAG 1.4.11)");
  });

  it("el foco visible usa blanco y las animaciones se anulan con prefers-reduced-motion", () => {
    assert.match(cssHome, /summary:focus-visible \{\s*outline: 2px solid var\(--color-site-fg\)/);
    assert.match(css, /prefers-reduced-motion:\s*reduce\)\s*\{\s*\.home-scope \.home-seq\s*\{\s*animation:\s*none/);
  });
});
