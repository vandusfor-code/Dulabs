/**
 * Home principal v3 (ruta temporal /home-v3). Pruebas de contenido renderizado + guardas de calidad que se mantienen en TODAS las
 * fases: sin claims falsos, sin JS cliente innecesario, sin prueba social no verificada, noindex mientras sea borrador, y fidelidad de lo
 * que se afirma contra el Runtime y el Wizard reales (si el producto cambia, la home no puede seguir diciendo algo viejo).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import sitemap from "@/app/sitemap";
import { CAPABILITY_BACKING } from "@/lib/agent-compiler/spec/capabilities";
import { AgentActionsSection } from "@/components/home/AgentActionsSection";
import { CatalogSection } from "@/components/home/CatalogSection";
import { ConfigSection } from "@/components/home/ConfigSection";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeNav } from "@/components/home/HomeNav";
import { KnowledgeSection } from "@/components/home/KnowledgeSection";
import { PathsBridge } from "@/components/home/PathsBridge";
import { ProblemSection } from "@/components/home/ProblemSection";
import { SchedulingSection } from "@/components/home/SchedulingSection";
import { ACCIONES_DEL_AGENTE, ETIQUETA_CAPACIDAD, PASOS_CON_PANEL, PASOS_DEL_WIZARD } from "@/lib/home/capabilities";
import { CREAR_AGENTE_HREF, ENTERPRISE_HREF, HABLAR_CON_DULABS_HREF, HOME_NAV_LINKS, HOME_V3_PATH } from "@/lib/home/links";

const RAIZ = join(__dirname, "..", "..");

function archivos(dir: string, acumulado: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, acumulado);
    else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) acumulado.push(ruta);
  }
  return acumulado;
}

const FUENTES_HOME = [...archivos(join(RAIZ, "components", "home")), ...archivos(join(RAIZ, "lib", "home")), join(RAIZ, "app", "home-v3", "page.tsx")];

const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;| /g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const sinComentarios = (fuente: string) => fuente.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");

/** La página completa, en el orden real de app/home-v3/page.tsx. */
const SECCIONES = [
  { id: "problema", html: renderToStaticMarkup(<ProblemSection />) },
  { id: "agentes", html: renderToStaticMarkup(<AgentActionsSection />) },
  { id: "agendamiento", html: renderToStaticMarkup(<SchedulingSection />) },
  { id: "configuracion", html: renderToStaticMarkup(<ConfigSection />) },
  { id: "catalogo", html: renderToStaticMarkup(<CatalogSection />) },
  { id: "conocimiento", html: renderToStaticMarkup(<KnowledgeSection />) },
  { id: "caminos", html: renderToStaticMarkup(<PathsBridge />) },
];
const HERO = renderToStaticMarkup(<HomeHero />);
const PAGINA = HERO + SECCIONES.map((s) => s.html).join("");
const TEXTO_PAGINA = texto(PAGINA);

describe("Home v3 -- hero renderizado", () => {
  it("tiene exactamente un H1 con la propuesta de valor, visible en el HTML del servidor", () => {
    assert.equal((HERO.match(/<h1[\s>]/g) ?? []).length, 1);
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(HERO)?.[1] ?? "";
    assert.equal(texto(h1), "Agentes de IA que hacen más que responder.");
  });

  it("los dos CTAs principales son 'Crear mi agente de IA' y 'Hablar con DuLabs' con los destinos centralizados", () => {
    assert.match(HERO, new RegExp(`href="${CREAR_AGENTE_HREF.replace("?", "\\?")}"[^>]*>[\\s\\S]*?Crear mi agente de IA`));
    assert.ok(HERO.includes(`href="${HABLAR_CON_DULABS_HREF.replace(/&/g, "&amp;")}"`), "falta el enlace de WhatsApp de ventas");
    assert.match(HERO, /Hablar con DuLabs/);
    assert.ok(HABLAR_CON_DULABS_HREF.startsWith("https://wa.me/"));
  });

  it("comunica las dos formas de trabajar (autoservicio y a la medida) y enlaza a soluciones empresariales", () => {
    const t = texto(HERO);
    assert.match(t, /Autoservicio/);
    assert.match(t, /A la medida/);
    assert.match(t, /Sin programar/);
    assert.ok(HERO.includes(`href="${ENTERPRISE_HREF}"`));
  });

  it("el producto simulado se rotula como ejemplo y muestra solo acciones reales del agente", () => {
    const t = texto(HERO);
    assert.match(t, /Ejemplo ilustrativo/);
    for (const accion of ["Servicio identificado", "Disponibilidad consultada", "Google Calendar", "Cita creada"]) assert.ok(t.includes(accion), `falta: ${accion}`);
  });

  it("no promete una IA que calcula la disponibilidad ni usa marcadores de posición", () => {
    assert.doesNotMatch(texto(HERO).toLowerCase(), /la ia calcula|lorem|próximamente|coming soon/);
  });
});

describe("Home v3 -- navbar renderizado", () => {
  const html = renderToStaticMarkup(<HomeNav />);

  it("enlaza a páginas reales del sitio (enlazado interno hacia el clúster SEO)", () => {
    for (const l of HOME_NAV_LINKS) assert.ok(html.includes(`href="${l.href}"`), `falta el enlace ${l.href}`);
    assert.ok(HOME_NAV_LINKS.some((l) => l.href === "/developer-platform"));
    assert.ok(HOME_NAV_LINKS.some((l) => l.href === "/precios"));
  });

  it("incluye el CTA de crear agente, el inicio de sesión y un logo con el archivo actual sin recolorear", () => {
    assert.ok(html.includes(`href="${CREAR_AGENTE_HREF}"`));
    assert.match(html, /Iniciar sesión/);
    assert.match(html, /logo\.png/);
  });

  it("todos los destinos internos del menú existen como rutas del app", () => {
    for (const l of HOME_NAV_LINKS) {
      const carpeta = join(RAIZ, "app", l.href.replace(/^\//, ""));
      assert.ok(statSync(carpeta).isDirectory(), `no existe la ruta ${l.href}`);
    }
  });
});

describe("Home v3 -- Fase 3: estructura de las secciones", () => {
  it("cada sección tiene su id, su H2 enlazado con aria-labelledby y no hay más H1", () => {
    for (const s of SECCIONES) {
      assert.match(s.html, new RegExp(`<section id="${s.id}" aria-labelledby="${s.id}-titulo"`), `sección ${s.id}`);
      assert.match(s.html, new RegExp(`<h2 id="${s.id}-titulo"`), `H2 de ${s.id}`);
      assert.doesNotMatch(s.html, /<h1[\s>]/, `${s.id} no debe tener H1`);
    }
    assert.equal((PAGINA.match(/<h1[\s>]/g) ?? []).length, 1);
    assert.deepEqual(
      SECCIONES.map((s) => s.id),
      ["problema", "agentes", "agendamiento", "configuracion", "catalogo", "conocimiento", "caminos"],
    );
  });

  it("los H2 comunican el mensaje de cada sección", () => {
    const h2 = (id: string) => texto(new RegExp(`<h2 id="${id}-titulo"[^>]*>([\\s\\S]*?)</h2>`).exec(SECCIONES.find((s) => s.id === id)!.html)![1]);
    assert.match(h2("agentes"), /Un agente que entiende cómo funciona tu negocio/);
    assert.match(h2("agendamiento"), /De la conversación a la cita confirmada/);
    assert.match(h2("configuracion"), /Configura tu negocio\. DuLabs lo convierte en un agente/);
    assert.match(h2("caminos"), /Hazlo tú mismo o construyámoslo contigo/);
  });

  it("los dos caminos comerciales (autoservicio / a la medida) siguen visibles tras el producto, con los CTAs correctos", () => {
    const puente = SECCIONES.find((s) => s.id === "caminos")!.html;
    assert.ok(puente.includes(`href="${CREAR_AGENTE_HREF}"`));
    assert.ok(puente.includes(`href="${ENTERPRISE_HREF}"`));
    assert.ok(puente.includes(`href="${HABLAR_CON_DULABS_HREF.replace(/&/g, "&amp;")}"`));
    const t = texto(puente);
    assert.match(t, /Autoservicio/);
    assert.match(t, /A la medida/);
    assert.match(t, /automatización empresarial/);
  });

  it("las secuencias de las secciones esperan a la vista (InView) y todas las animaciones se anulan con reduced-motion", () => {
    for (const s of SECCIONES) assert.match(s.html, /data-inview="false"/, s.id);
    const css = readFileSync(join(RAIZ, "app", "globals.css"), "utf8");
    assert.match(css, /\.home-view\[data-inview="false"\] \.home-seq \{ animation-play-state: paused; \}/);
    assert.match(css, /@media \(scripting: none\)/);
  });
});

describe("Home v3 -- Fase 3: fidelidad contra el producto real", () => {
  const wizard = readFileSync(join(RAIZ, "components", "dashboard", "business-agent", "Wizard.tsx"), "utf8");

  it("cada capacidad que la home muestra en acción tiene respaldo real (available: true) en el Runtime", () => {
    for (const a of ACCIONES_DEL_AGENTE) {
      assert.equal(CAPABILITY_BACKING[a.capacidad].available, true, `${a.capacidad} no está disponible en el Runtime`);
    }
    const usadas = new Set(ACCIONES_DEL_AGENTE.map((a) => a.capacidad));
    assert.ok(!usadas.has("orders") && !usadas.has("payments"), "pedidos y pagos no existen: no pueden mostrarse como acciones");
    assert.deepEqual([...usadas].sort(), ["catalog", "faq", "humanHandoff", "leadCapture", "sales", "scheduling"]);
  });

  it("las etiquetas de capacidades son EXACTAMENTE las del Wizard real", () => {
    for (const etiqueta of Object.values(ETIQUETA_CAPACIDAD)) {
      assert.ok(wizard.includes(`es: "${etiqueta}"`), `el Wizard no tiene la capacidad "${etiqueta}"`);
    }
    assert.ok(Object.keys(ETIQUETA_CAPACIDAD).length === 8);
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
    for (const paso of PASOS_CON_PANEL) assert.ok((PASOS_DEL_WIZARD as readonly string[]).includes(paso), `${paso} no es un paso del Wizard`);
  });

  it("'Tomar pedidos' y 'Cobrar' solo aparecen deshabilitadas y marcadas 'Todavía no disponible', como en el producto", () => {
    assert.equal(CAPABILITY_BACKING.orders.available, false);
    assert.equal(CAPABILITY_BACKING.payments.available, false);
    const config = SECCIONES.find((s) => s.id === "configuracion")!.html;
    for (const etiqueta of ["Tomar pedidos", "Cobrar"]) {
      const i = config.indexOf(etiqueta);
      assert.notEqual(i, -1, etiqueta);
      const fragmento = texto(config.slice(i, i + 400));
      assert.match(fragmento, /Todavía no disponible/, `${etiqueta} debe decir que no está disponible`);
      assert.match(config.slice(Math.max(0, i - 500), i), /opacity-50/, `${etiqueta} debe verse deshabilitada`);
    }
    assert.match(TEXTO_PAGINA, /no cobra ni toma pedidos/i, "la home debe aclarar que no cobra ni toma pedidos");
  });

  it("agendamiento: la IA interpreta y el SISTEMA calcula disponibilidad y reglas (con Google Calendar)", () => {
    const t = texto(SECCIONES.find((s) => s.id === "agendamiento")!.html);
    assert.match(t, /La disponibilidad y las reglas las calcula el sistema/);
    assert.match(t, /La IA nunca inventa un horario/);
    assert.match(t, /Google Calendar/);
    assert.match(t, /Cancelar y reprogramar desde WhatsApp funciona con Google Calendar conectado/);
    assert.match(t, /Duración por servicio/);
    assert.match(t, /Horarios configurables/);
    assert.doesNotMatch(t.toLowerCase(), /la ia calcula|la ia decide|la ia consulta el calendario/);
  });

  it("configuración: 8 pestañas sin JS, la primera activa, cada una con su radio, etiqueta y panel", () => {
    const html = SECCIONES.find((s) => s.id === "configuracion")!.html;
    const radios = html.match(/<input type="radio"[^>]*>/g) ?? [];
    assert.equal(radios.length, PASOS_CON_PANEL.length);
    assert.match(radios[0], /checked/);
    for (const r of radios.slice(1)) assert.doesNotMatch(r, /checked/);
    const ids = radios.map((r) => /id="([^"]+)"/.exec(r)![1]);
    assert.equal(new Set(ids).size, ids.length, "ids de radios duplicados");
    for (const id of ids) assert.match(html, new RegExp(`<label for="${id}"`), `falta la etiqueta de ${id}`);
    assert.equal((html.match(/class="cfg-panels/g) ?? []).length, 1);
    assert.match(html, /role="radiogroup"/);
    for (const paso of PASOS_DEL_WIZARD) assert.ok(texto(html).includes(paso), `falta el paso ${paso}`);
  });

  it("catálogo: cotización con el formato real del sistema y sin prometer cobro", () => {
    const t = texto(SECCIONES.find((s) => s.id === "catalogo")!.html);
    assert.match(t, /Total: \$85\.000/);
    assert.match(t, /Calculado por el sistema/);
    assert.match(t, /no cobra ni toma pedidos/i);
    assert.match(t, /transfiere la conversación a tu equipo/);
  });

  it("conocimiento: formatos reales, búsqueda de fragmentos y aviso de que no inventa (sin afirmar búsqueda semántica)", () => {
    const t = texto(SECCIONES.find((s) => s.id === "conocimiento")!.html);
    assert.match(t, /PDF, Excel, CSV o TXT/);
    assert.match(t, /busca los fragmentos relevantes/);
    assert.match(t, /en lugar de recibir el documento completo/);
    assert.match(t, /no la inventa/);
    assert.doesNotMatch(t, /word|docx|semántic|embedding|vectorial|sinónimo/i);
  });

  it("SEO natural: usa los términos objetivo sin relleno de palabras clave", () => {
    const t = TEXTO_PAGINA.toLowerCase();
    for (const termino of ["agente de ia", "agentes de ia", "whatsapp", "google calendar", "automatización empresarial", "atención al cliente", "agendamiento automático", "configurables"]) {
      assert.ok(t.includes(termino), `falta el término natural: ${termino}`);
    }
    const veces = (frase: string) => t.split(frase).length - 1;
    assert.ok(veces("agente de ia") + veces("agentes de ia") <= 14, "demasiada repetición de 'agente(s) de IA'");
    assert.ok(veces("automatización empresarial") <= 3, "demasiada repetición de 'automatización empresarial'");
    assert.ok(veces("ia para whatsapp") + veces("whatsapp con ia") <= 2, "demasiada repetición de 'IA para WhatsApp'");
  });
});

describe("Home v3 -- guardas de calidad (aplican a todas las fases)", () => {
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
    ];
    // Frases NEGATIVAS/HONESTAS permitidas (dicen lo que el producto NO hace) y las etiquetas de capacidades no disponibles.
    const permitidas = [/no cobra ni toma pedidos/gi, /"Cobrar"/g, /"Tomar pedidos"/g, /Tomar pedidos/g];
    for (const ruta of FUENTES_HOME) {
      let fuente = sinComentarios(readFileSync(ruta, "utf8"));
      for (const p of permitidas) fuente = fuente.replace(p, "");
      for (const [patron, motivo] of prohibidos) {
        assert.doesNotMatch(fuente, patron, `${relative(RAIZ, ruta)}: ${motivo}`);
      }
    }
  });

  it("no usa los logos de clientes no verificados (components/site/TrustedBySection sigue fuera de la home nueva)", () => {
    for (const ruta of FUENTES_HOME) {
      const fuente = readFileSync(ruta, "utf8");
      assert.doesNotMatch(fuente, /logos-clientes|TrustedBySection/, relative(RAIZ, ruta));
    }
  });

  it("solo hay JS cliente donde hace falta: enlace con tracking, menú móvil y aviso de entrada en pantalla", () => {
    const clientes = FUENTES_HOME.filter((r) => /^\s*["']use client["']/.test(readFileSync(r, "utf8"))).map((r) => relative(RAIZ, r).replace(/\\/g, "/"));
    assert.deepEqual(clientes.sort(), ["components/home/HomeMobileMenu.tsx", "components/home/InView.tsx", "components/home/TrackedLink.tsx"]);
  });

  it("no hay precios de PLANES escritos a mano: los planes solo se leen de lib/planes.ts", () => {
    for (const ruta of FUENTES_HOME) {
      const fuente = sinComentarios(readFileSync(ruta, "utf8"));
      assert.doesNotMatch(fuente, /(79\.?990|159\.?990|299\.?990|49\.?990|149\.?990|199\.?990)/, relative(RAIZ, ruta));
    }
  });

  it("los importes de los ejemplos ($30.000, $55.000...) están rotulados como ejemplo en cada bloque que los muestra", () => {
    for (const id of ["catalogo", "configuracion", "agendamiento"]) {
      const t = texto(SECCIONES.find((s) => s.id === id)!.html).toLowerCase();
      assert.match(t, /ejemplo/, `${id} debe rotular sus datos como ejemplo`);
    }
    assert.match(texto(HERO).toLowerCase(), /ejemplo ilustrativo/);
  });

  it("la ruta temporal es noindex/nofollow y no está en el sitemap", () => {
    const pagina = readFileSync(join(RAIZ, "app", "home-v3", "page.tsx"), "utf8");
    assert.match(pagina, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
    const urls = sitemap().map((e) => e.url);
    assert.ok(!urls.some((u) => u.includes(HOME_V3_PATH)), "/home-v3 no debe estar en el sitemap");
  });

  it("no toca lo que está fuera de alcance de la home (planes, Developer, dashboard, login, APIs)", () => {
    for (const ruta of FUENTES_HOME) {
      const fuente = readFileSync(ruta, "utf8");
      assert.doesNotMatch(fuente, /from "@\/components\/(developer|developer-platform|dashboard)\//, `${relative(RAIZ, ruta)} no debe importar componentes de Developer/dashboard`);
    }
  });
});

describe("Home v3 -- acento naranja", () => {
  function luminancia(hex: string): number {
    const canales = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * canales[0] + 0.7152 * canales[1] + 0.0722 * canales[2];
  }
  const contraste = (a: string, b: string) => {
    const [la, lb] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
    return (la + 0.05) / (lb + 0.05);
  };
  const css = readFileSync(join(RAIZ, "app", "globals.css"), "utf8");

  it("el acento definido es #ff5c1a y el texto sobre él (#0a0a0a) cumple WCAG AA (>= 4.5:1)", () => {
    assert.match(css, /--color-home-accent:\s*#ff5c1a;/i);
    assert.match(css, /--color-home-accent-fg:\s*#0a0a0a;/i);
    assert.ok(contraste("#ff5c1a", "#0a0a0a") >= 4.5, "texto oscuro sobre naranja");
  });

  it("el naranja sobre el fondo oscuro también cumple AA para texto pequeño (etiquetas)", () => {
    assert.ok(contraste("#ff5c1a", "#070707") >= 4.5);
  });

  it("las animaciones de la home se anulan con prefers-reduced-motion", () => {
    assert.match(css, /prefers-reduced-motion:\s*reduce\)\s*\{\s*\.home-scope \.home-seq\s*\{\s*animation:\s*none/);
  });
});
