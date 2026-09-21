/**
 * Home principal v3 (ruta temporal /home-v3). Pruebas de contenido renderizado + guardas de calidad que se mantienen en TODAS las
 * fases: sin claims falsos, sin JS cliente innecesario, sin prueba social no verificada, noindex mientras sea borrador.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import sitemap from "@/app/sitemap";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeNav } from "@/components/home/HomeNav";
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

const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("Home v3 -- hero renderizado", () => {
  const html = renderToStaticMarkup(<HomeHero />);

  it("tiene exactamente un H1 con la propuesta de valor, visible en el HTML del servidor", () => {
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";
    assert.equal(texto(h1), "Agentes de IA que hacen más que responder.");
  });

  it("los dos CTAs principales son 'Crear mi agente de IA' y 'Hablar con DuLabs' con los destinos centralizados", () => {
    assert.match(html, new RegExp(`href="${CREAR_AGENTE_HREF.replace("?", "\\?")}"[^>]*>[\\s\\S]*?Crear mi agente de IA`));
    assert.ok(html.includes(`href="${HABLAR_CON_DULABS_HREF.replace(/&/g, "&amp;")}"`), "falta el enlace de WhatsApp de ventas");
    assert.match(html, /Hablar con DuLabs/);
    assert.ok(HABLAR_CON_DULABS_HREF.startsWith("https://wa.me/"));
  });

  it("comunica las dos formas de trabajar (autoservicio y a la medida) y enlaza a soluciones empresariales", () => {
    const t = texto(html);
    assert.match(t, /Autoservicio/);
    assert.match(t, /A la medida/);
    assert.match(t, /Sin programar/);
    assert.ok(html.includes(`href="${ENTERPRISE_HREF}"`));
  });

  it("el producto simulado se rotula como ejemplo y muestra solo acciones reales del agente", () => {
    const t = texto(html);
    assert.match(t, /Ejemplo ilustrativo/);
    for (const accion of ["Servicio identificado", "Disponibilidad consultada", "Google Calendar", "Cita creada"]) assert.ok(t.includes(accion), `falta: ${accion}`);
  });

  it("no promete una IA que calcula la disponibilidad ni usa marcadores de posición", () => {
    const t = texto(html).toLowerCase();
    assert.doesNotMatch(t, /la ia calcula|lorem|próximamente|coming soon/);
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

describe("Home v3 -- guardas de calidad (aplican a todas las fases)", () => {
  it("no contiene claims falsos ni no verificables", () => {
    const prohibidos: [RegExp, string][] = [
      [/24\s*horas/i, "promesa de '24 horas' (decisión: no prometerla)"],
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
    ];
    for (const ruta of FUENTES_HOME) {
      const fuente = readFileSync(ruta, "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
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

  it("solo hay JS cliente donde hace falta: el enlace con tracking y el menú móvil", () => {
    const clientes = FUENTES_HOME.filter((r) => /^\s*["']use client["']/.test(readFileSync(r, "utf8"))).map((r) => relative(RAIZ, r).replace(/\\/g, "/"));
    assert.deepEqual(clientes.sort(), ["components/home/HomeMobileMenu.tsx", "components/home/TrackedLink.tsx"]);
  });

  it("no hay precios escritos a mano: los planes solo se leen de lib/planes.ts", () => {
    for (const ruta of FUENTES_HOME) {
      const fuente = readFileSync(ruta, "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
      assert.doesNotMatch(fuente, /(79\.?990|159\.?990|299\.?990|49\.?990|149\.?990|199\.?990)/, relative(RAIZ, ruta));
    }
  });

  it("la ruta temporal es noindex/nofollow y no está en el sitemap", () => {
    const pagina = readFileSync(join(RAIZ, "app", "home-v3", "page.tsx"), "utf8");
    assert.match(pagina, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
    const urls = sitemap().map((e) => e.url);
    assert.ok(!urls.some((u) => u.includes(HOME_V3_PATH)), "/home-v3 no debe estar en el sitemap");
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
