/**
 * Home v3 -- modelo de producto DEFINITIVO. Protege el mensaje comercial de toda la página:
 *   01 · CREA TU AGENTE  -> agente estándar: el cliente lo crea, configura, prueba, publica y administra SOLO desde el Wizard.
 *   02 · A LA MEDIDA     -> soluciones empresariales: DuLabs lo desarrolla contigo (automatizaciones, integraciones, desarrollos propios).
 * No se vuelve al modelo antiguo ("DuLabs configura el agente por ti") ni se usa el nombre "Autoservicio", y las dos líneas no se mezclan.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentActionsSection } from "@/components/home/AgentActionsSection";
import { BusinessTypesSection } from "@/components/home/BusinessTypesSection";
import { CatalogSection } from "@/components/home/CatalogSection";
import { ConfigSection } from "@/components/home/ConfigSection";
import { CustomSolutionsSection } from "@/components/home/CustomSolutionsSection";
import { DeveloperStrip } from "@/components/home/DeveloperStrip";
import { FaqSection } from "@/components/home/FaqSection";
import { FinalCta } from "@/components/home/FinalCta";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeNav } from "@/components/home/HomeNav";
import { KnowledgeSection } from "@/components/home/KnowledgeSection";
import { ProblemSection } from "@/components/home/ProblemSection";
import { SchedulingSection } from "@/components/home/SchedulingSection";
import { StepsSection } from "@/components/home/StepsSection";
import { TrackBand } from "@/components/home/TrackBand";
import { TrustSection } from "@/components/home/TrustSection";
import { todasLasFaq } from "@/lib/home/faq";
import { HOME_SEO } from "@/lib/home/seo";

const RAIZ = join(__dirname, "..", "..");
const leer = (...p: string[]) => readFileSync(join(RAIZ, ...p), "utf8").replace(/\r\n/g, "\n");
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

function archivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) archivos(r, acc);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) acc.push(r);
  }
  return acc;
}
const FUENTES = [...archivos(join(RAIZ, "components", "home")), ...archivos(join(RAIZ, "lib", "home")), join(RAIZ, "app", "home-v3", "page.tsx")];

// Bandas tal como las compone app/home-v3/page.tsx (los textos se leen del propio archivo para que la prueba no pueda divergir).
const PAGINA = leer("app", "home-v3", "page.tsx");
const banda = (n: string) => {
  const m = new RegExp(`<TrackBand n="${n}" etiqueta="([^"]+)" texto="([^"]+)" />`).exec(PAGINA);
  assert.ok(m, `no se encontró la banda ${n} en page.tsx`);
  return { etiqueta: m![1], texto: m![2] };
};
const BANDA_01 = banda("01");
const BANDA_02 = banda("02");

const HTML = {
  hero: renderToStaticMarkup(<HomeHero />),
  bandas: renderToStaticMarkup(
    <>
      <TrackBand n="01" etiqueta={BANDA_01.etiqueta} texto={BANDA_01.texto} />
      <TrackBand n="02" etiqueta={BANDA_02.etiqueta} texto={BANDA_02.texto} />
    </>,
  ),
  nav: renderToStaticMarkup(<HomeNav />),
  problema: renderToStaticMarkup(<ProblemSection />),
  agentes: renderToStaticMarkup(<AgentActionsSection />),
  agendamiento: renderToStaticMarkup(<SchedulingSection />),
  configuracion: renderToStaticMarkup(<ConfigSection />),
  catalogo: renderToStaticMarkup(<CatalogSection />),
  conocimiento: renderToStaticMarkup(<KnowledgeSection />),
  negocios: renderToStaticMarkup(<BusinessTypesSection />),
  pasos: renderToStaticMarkup(<StepsSection />),
  empresas: renderToStaticMarkup(<CustomSolutionsSection />),
  confianza: renderToStaticMarkup(<TrustSection />),
  developers: renderToStaticMarkup(<DeveloperStrip />),
  faq: renderToStaticMarkup(<FaqSection />),
  cierre: renderToStaticMarkup(<FinalCta />),
};
const TODO = Object.values(HTML).join("\n");
const T = texto(TODO);

describe("Modelo de producto -- 01 · Crea tu agente / 02 · A la medida", () => {
  it("las dos bandas se llaman 'Crea tu agente' (agente estándar) y 'A la medida' (soluciones empresariales)", () => {
    assert.equal(BANDA_01.etiqueta, "Crea tu agente");
    assert.match(BANDA_01.texto, /Agente estándar/);
    assert.match(BANDA_01.texto, /lo configuras tú mismo/);
    assert.match(BANDA_01.texto, /Creas, configuras, pruebas, publicas y administras/);
    assert.equal(BANDA_02.etiqueta, "A la medida");
    assert.match(BANDA_02.texto, /Soluciones empresariales/);
    assert.match(BANDA_02.texto, /DuLabs lo desarrolla contigo/);
    const t = texto(HTML.bandas);
    assert.match(t, /01 Crea tu agente/);
    assert.match(t, /02 A la medida/);
  });

  it("el hero presenta las dos líneas con el mismo lenguaje", () => {
    const t = texto(HTML.hero);
    assert.match(t, /Crea tu agente/);
    assert.match(t, /Agente estándar que configuras tú mismo desde el panel, sin programar: creas, pruebas, publicas y administras/);
    assert.match(t, /A la medida/);
    assert.match(t, /Soluciones empresariales que DuLabs desarrolla contigo: automatizaciones, integraciones y desarrollos personalizados/);
  });

  it("el ciclo completo crear -> configurar -> probar -> publicar -> administrar se ve en la página, en ese orden", () => {
    const t = texto(HTML.configuracion);
    const orden = ["01 · Crea", "02 · Configura", "03 · Prueba", "04 · Publica", "05 · Administra"].map((e) => t.indexOf(e));
    assert.ok(orden.every((i) => i >= 0), `faltan etapas: ${orden.join(",")}`);
    assert.deepEqual([...orden].sort((a, b) => a - b), orden, "las etapas deben ir en orden");
    assert.match(t, /Lo creas, lo configuras y lo administras tú mismo, sin necesidad de programar/);
  });

  it("'Autoservicio' y el modelo antiguo no aparecen en NINGÚN texto de la página ni en el código de la home", () => {
    assert.doesNotMatch(TODO, /autoservicio/i);
    const antiguos = /nosotros (lo )?configuramos|te configuramos|que me configuren|tú no configuras nada|lo hacemos nosotros|no es algo que el due|especialistas? de DuLabs (te|configura|revisar|continuar)|configuraci[oó]n inicial|puesta en marcha acompañada|implementaci[oó]n acompañada|(en|menos de|dentro de) 24 horas/i;
    assert.doesNotMatch(T, antiguos);
    for (const ruta of FUENTES) {
      const fuente = readFileSync(ruta, "utf8");
      assert.doesNotMatch(fuente, /autoservicio/i, relative(RAIZ, ruta));
      assert.doesNotMatch(fuente.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1"), antiguos, relative(RAIZ, ruta));
    }
  });

  it("la 'implementación' solo aparece como el cobro único que muestra el checkout, nunca como paso obligatorio de DuLabs", () => {
    const menciones = [...T.matchAll(/implementaci[oó]n/gi)].length;
    assert.equal(menciones, 1, "solo debe nombrarse en la respuesta de precios");
    assert.match(T, /cada plan muestra un pago único de implementación que va en el primer cobro; el desglose aparece antes de pagar/);
    for (const f of todasLasFaq()) assert.doesNotMatch(f.respuesta.join(" "), /debes|tienes que|es necesario|es obligatorio/i, `${f.id}: no impone pasos manuales`);
  });

  it("las dos líneas no se mezclan: las secciones de 'Crea tu agente' no prometen desarrollo a medida y 'A la medida' no dice que el cliente lo configura", () => {
    for (const s of ["problema", "agentes", "agendamiento", "configuracion", "catalogo", "conocimiento", "pasos"] as const) {
      assert.doesNotMatch(texto(HTML[s]), /a la medida|desarrolla contigo|desarrollamos|proyecto a la medida/i, `${s} mezcla la línea 02`);
    }
    const empresas = texto(HTML.empresas);
    assert.doesNotMatch(empresas, /lo configuras tú|sin programar|tú mismo|agente estándar/i, "la sección A la medida mezcla la línea 01");
    assert.match(empresas, /Automatización empresarial|automatización empresarial/);
    for (const c of ["automatización", "integraciones", "agentes de IA personalizados", "Sistemas internos", "CRM empresarial"]) assert.ok(empresas.toLowerCase().includes(c.toLowerCase()), `A la medida debe mencionar: ${c}`);
    // Único puente permitido entre líneas: el enlace al final de la lista de rubros.
    assert.equal((texto(HTML.negocios).match(/a la medida/gi) ?? []).length, 1);
  });

  it("la línea Developer queda fuera de las dos líneas comerciales (después de confianza, antes de las FAQ)", () => {
    const i = (m: string) => PAGINA.indexOf(m);
    assert.ok(i("<CustomSolutionsSection />") < i("<TrustSection />") && i("<TrustSection />") < i("<DeveloperStrip />") && i("<DeveloperStrip />") < i("<FaqSection />"));
  });
});

describe("Modelo de producto -- FAQ y SEO coherentes con 'Crea tu agente'", () => {
  it("la FAQ explica el ciclo completo: crear, configurar (Wizard), probar, publicar y administrar, sin programar", () => {
    const t = todasLasFaq().map((f) => `${f.pregunta} ${f.respuesta.join(" ")}`).join("\n");
    for (const re of [
      /¿Cómo creo un agente de IA para mi negocio\?/,
      /¿Necesito saber programar/,
      /¿Puedo configurar el agente yo mismo\?/,
      /personalidad, las reglas y el conocimiento/,
      /¿Puedo probar mi agente antes de publicarlo\?/,
      /¿Cómo publico y administro mi agente después\?/,
      /Google Calendar/,
      /servicios y productos/,
      /desarrolla soluciones personalizadas y automatización empresarial/,
      /crear mi propio agente y pedir una solución a la medida/,
    ]) assert.match(t, re, String(re));
    assert.match(t, /creas, configuras, pruebas, publicas y administras tu agente desde el panel de DuLabs/);
    assert.match(t, /sin enviar WhatsApp real ni ejecutar acciones de negocio/);
    assert.match(t, /guardas un borrador y publicas una versión nueva/);
  });

  it("la home se posiciona en: agentes de IA, agentes de IA para empresas, automatización empresarial, crear agente de IA y agente de IA para WhatsApp", () => {
    const t = (T + " " + HOME_SEO.title + " " + HOME_SEO.description).toLowerCase();
    for (const termino of ["agentes de ia", "agentes de ia para empresas", "automatización empresarial", "crea tu agente de ia", "agente de ia para whatsapp"]) assert.ok(t.includes(termino), `falta: ${termino}`);
    assert.match(HOME_SEO.description, /^Crea tu agente de IA para WhatsApp/);
    assert.match(HOME_SEO.description, /automatización empresarial a la medida/);
    assert.match(HOME_SEO.title, /^Agentes de IA y automatización para empresas/);
  });

  it("PricingSection compartido: solo recibe una frase propia de la home; '/' y '/precios' no la pasan y su texto por defecto no cambió", () => {
    assert.match(PAGINA, /<PricingSection showComparisonLink descripcion="Elige tu plan y crea tu agente desde el panel de DuLabs\. Precios en pesos colombianos \(COP\)\." \/>/);
    for (const otra of ["app/page.tsx", "app/precios/page.tsx"]) {
      const f = leer(...otra.split("/"));
      assert.match(f, /<PricingSection/);
      assert.doesNotMatch(f, /descripcion=/, `${otra} no debe pasar la nueva propiedad`);
    }
    const sections = leer("components", "site", "Sections.tsx");
    assert.match(sections, /descripcion \?\?\s*t\(\s*"Nosotros configuramos tu asistente de IA según la información y procesos de tu negocio\. Precios en pesos colombianos \(COP\)\."/);
  });
});
