/**
 * Home -- modelo de producto DEFINITIVO. Protege el mensaje comercial de toda la página:
 *   01 · CREA TU AGENTE  -> agente estándar: el cliente lo crea, configura, prueba, publica y administra SOLO desde el Wizard.
 *   02 · A LA MEDIDA     -> soluciones empresariales: DuLabs lo desarrolla contigo (automatizaciones, integraciones, desarrollos propios).
 * No se vuelve al modelo antiguo ("DuLabs configura el agente por ti") ni se usa el nombre "Autoservicio", y las dos líneas no se mezclan.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CapabilitiesSection } from "@/components/home/CapabilitiesSection";
import { CustomSolutionsSection } from "@/components/home/CustomSolutionsSection";
import { FaqSection } from "@/components/home/FaqSection";
import { FinalCta } from "@/components/home/FinalCta";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeNav } from "@/components/home/HomeNav";
import { HowItWorksSection } from "@/components/home/HowItWorksSection";
import { SchedulingSection } from "@/components/home/SchedulingSection";
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
const FUENTES = [...archivos(join(RAIZ, "components", "home")), ...archivos(join(RAIZ, "lib", "home")), join(RAIZ, "app", "page.tsx")];
const PAGINA = leer("app", "page.tsx");

const HTML = {
  hero: renderToStaticMarkup(<HomeHero />),
  nav: renderToStaticMarkup(<HomeNav />),
  capacidades: renderToStaticMarkup(<CapabilitiesSection />),
  crea: renderToStaticMarkup(<HowItWorksSection />),
  agendamiento: renderToStaticMarkup(<SchedulingSection />),
  empresas: renderToStaticMarkup(<CustomSolutionsSection />),
  faq: renderToStaticMarkup(<FaqSection />),
  cierre: renderToStaticMarkup(<FinalCta />),
};
const TODO = Object.values(HTML).join("\n");
const T = texto(TODO);

describe("Modelo de producto -- 01 · Crea tu agente / 02 · A la medida", () => {
  it("las dos líneas comerciales se comunican en la página (Crea tu agente + A la medida), aunque ya no en el hero", () => {
    // El hero se rediseñó a un mensaje de marca ("Automatización sin límites") -- las dos vías se comunican ahora en las secciones del
    // cuerpo: "Crea tu agente" (cómo funciona) y "A la medida" (soluciones empresariales). El hero no debe llevar el teaser antiguo.
    assert.doesNotMatch(texto(HTML.hero), /01 · Crea tu agente|02 · A la medida/);
    assert.match(texto(HTML.crea), /Crea tu agente/);
    assert.match(texto(HTML.crea), /Agente estándar|agente estándar/);
    assert.match(texto(HTML.empresas), /A la medida/);
    assert.match(texto(HTML.empresas), /DuLabs también diseña e implementa automatización empresarial/);
  });

  it("Crea tu agente dice que el agente estándar lo configura el cliente y muestra el ciclo completo, en orden", () => {
    const t = texto(HTML.crea);
    assert.match(t, /Crea tu agente/);
    assert.match(t, /Tu agente estándar lo configuras tú\./);
    const orden = ["01 Crea", "02 Configura", "03 Prueba", "04 Publica", "05 Administra"].map((e) => t.indexOf(e));
    assert.ok(orden.every((i) => i >= 0), `faltan etapas: ${orden.join(",")}`);
    assert.deepEqual([...orden].sort((a, b) => a - b), orden, "las etapas deben ir en orden");
    assert.match(t, /Lo creas, lo configuras y lo administras tú mismo, sin necesidad de programar/);
  });

  it("'Autoservicio' y el modelo antiguo no aparecen en NINGÚN texto de la página ni en el código de la home", () => {
    assert.doesNotMatch(TODO, /autoservicio/i);
    const antiguos =
      /nosotros (lo )?configuramos|te lo configuramos|te configuramos|configurado por nuestro equipo|que me configuren|tú no configuras nada|lo hacemos nosotros|no es algo que el due|especialistas? de DuLabs (te|configura|revisar|continuar)|configuraci[oó]n inicial|puesta en marcha acompañada|implementaci[oó]n acompañada|(en|menos de|dentro de) 24 horas/i;
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

  it("las dos líneas no se mezclan: los bloques de 'Crea tu agente' no prometen desarrollo a medida y 'A la medida' no dice que el cliente lo configura", () => {
    for (const s of ["capacidades", "crea", "agendamiento"] as const) {
      assert.doesNotMatch(texto(HTML[s]), /a la medida|desarrolla contigo|desarrollamos|proyecto a la medida/i, `${s} mezcla la línea 02`);
    }
    const empresas = texto(HTML.empresas);
    assert.doesNotMatch(empresas, /lo configuras tú|sin programar|tú mismo|agente estándar/i, "la sección A la medida mezcla la línea 01");
    assert.match(empresas, /automatización empresarial/i);
    for (const c of ["Automatizaciones", "Integraciones", "Sistemas personalizados", "Soluciones empresariales"]) assert.ok(empresas.includes(c), `A la medida debe mencionar: ${c}`);
  });

  it("la línea Developer y el detalle Enterprise ya no son bloques de la home: solo se enlazan (nav y A la medida)", () => {
    assert.doesNotMatch(PAGINA, /DeveloperStrip|TrustSection|BusinessTypesSection/);
    assert.match(HTML.nav, /href="\/developer-platform"/);
    assert.match(HTML.empresas, /href="\/soluciones-empresariales"/);
  });
});

describe("Modelo de producto -- FAQ, SEO y planes coherentes con 'Crea tu agente'", () => {
  it("la FAQ explica el ciclo: crear, configurar (sin programar), probar antes de publicar y administrar después", () => {
    const t = todasLasFaq().map((f) => `${f.pregunta} ${f.respuesta.join(" ")}`).join("\n");
    for (const re of [/¿Cómo creo mi agente de IA\?/, /¿Necesito saber programar/, /no hay que escribir código/, /Lo pruebas en una vista previa simulada/, /lo administras desde el mismo panel/, /Google Calendar/, /crear mi propio agente y pedir una solución a la medida/]) {
      assert.match(t, re, String(re));
    }
    assert.match(t, /lo configuras tú mismo desde el panel, sin programar/);
    assert.match(t, /Lo pruebas, lo publicas y lo administras tú/);
    assert.match(t, /DuLabs lo desarrolla contigo cuando necesitas algo que el agente estándar no cubre/);
  });

  it("la home se posiciona en: agentes de IA, agentes de IA para empresas, automatización empresarial, crear agente de IA y agente de IA para WhatsApp", () => {
    const t = (T + " " + HOME_SEO.title + " " + HOME_SEO.description).toLowerCase();
    for (const termino of ["agentes de ia", "automatización empresarial", "crea tu agente", "agente de ia para whatsapp"]) assert.ok(t.includes(termino), `falta: ${termino}`);
    assert.match(HOME_SEO.description, /^Crea tu agente de IA para WhatsApp/);
    assert.match(HOME_SEO.description, /automatización empresarial a la medida/);
    assert.match(HOME_SEO.title, /^Agentes de IA y automatización para empresas/);
  });

  it("PricingSection compartido: solo la home le pasa sus tres frases; el resto de páginas no y sus textos por defecto no cambiaron", () => {
    assert.match(PAGINA, /descripcion="Elige tu plan y crea tu agente desde el panel de DuLabs\. Precios en pesos colombianos \(COP\)\."/);
    assert.match(PAGINA, /notaImplementacion="Pago único que se suma al primer cobro; el desglose aparece antes de pagar\."/);
    assert.match(PAGINA, /notaSuscripcion="Tu suscripción a DuLabs cubre la plataforma y el uso de la IA según el plan elegido\."/);
    // La home no dice que la suscripción "cubre la configuración" ni que el pago único es por "configurar y poner en marcha tu asistente".
    assert.doesNotMatch(PAGINA, /cubre la plataforma, la configuraci[oó]n|configuraci[oó]n y puesta en marcha de tu asistente/i);
    const paginas = archivos(join(RAIZ, "app")).filter((r) => /page\.tsx$/.test(r) && r !== join(RAIZ, "app", "page.tsx"));
    const usan = paginas.filter((r) => readFileSync(r, "utf8").includes("<PricingSection"));
    assert.ok(usan.length >= 1, "debe haber otras páginas que usan PricingSection (p. ej. /precios)");
    for (const r of usan) assert.doesNotMatch(readFileSync(r, "utf8"), /descripcion=|notaImplementacion=|notaSuscripcion=/, `${relative(RAIZ, r)} no debe pasar propiedades de la home`);
    const sections = leer("components", "site", "Sections.tsx");
    assert.match(sections, /descripcion \?\?\s*t\(\s*"Nosotros configuramos tu asistente de IA según la información y procesos de tu negocio\. Precios en pesos colombianos \(COP\)\."/);
    assert.match(sections, /notaImplementacion \?\?\s*t\(\s*"Pago único por la configuración y puesta en marcha de tu asistente\."/);
    assert.match(sections, /notaSuscripcion \?\?\s*t\(\s*"Tu suscripción a DuLabs cubre la plataforma, la configuración y el uso de la IA según el plan elegido\."/);
  });

  it("la home vive en '/': app/page.tsx la publica y la ruta temporal /home-v3 ya no existe", () => {
    assert.ok(!existsSync(join(RAIZ, "app", "home-v3")));
    assert.match(PAGINA, /export default function HomePage\(\)/);
    assert.match(PAGINA, /homeMetadata\(\{ path: HOME_PATH, indexable: true \}\)/);
    assert.doesNotMatch(PAGINA, /noindex|HOME_V3/i);
  });
});
