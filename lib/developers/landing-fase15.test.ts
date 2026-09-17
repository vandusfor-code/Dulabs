/**
 * DuLabs Developer V1 -- Fase 15. Tests de la landing comercial y su SEO/nav:
 * rutas correctas y diferenciadas (/developer-platform landing, /developers
 * docs, /developer dashboard privado), CTAs, sin enlaces accidentales al
 * dashboard, sin claves reales, y que Business no se rompe. Estáticos (fs +
 * import de módulos puros); sin red/DB.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { START_HREF, DOCS_HREF, LANDING_PATH } from "@/components/developer-platform/constants";

const raiz = process.cwd();
const SITE_URL = "https://www.dulabs.co";

function archivosLanding(): string[] {
  const dirs = [path.join(raiz, "app/developer-platform"), path.join(raiz, "components/developer-platform")];
  const salida: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) salida.push(p);
    }
  };
  dirs.forEach(walk);
  return salida;
}

describe("Fase 15 -- landing, rutas y CTAs", () => {
  it("las constantes de CTA apuntan a los destinos correctos", () => {
    // El CTA de "comenzar" pasó de /login?next=/developer al flujo de registro
    // dedicado /developer-platform/registro (PR #50, registro + auto-provisión).
    assert.equal(START_HREF, "/developer-platform/registro");
    assert.equal(DOCS_HREF, "/developers");
    assert.equal(LANDING_PATH, "/developer-platform");
  });

  it("existen las tres superficies diferenciadas", () => {
    assert.ok(existsSync(path.join(raiz, "app/developer-platform/page.tsx")), "landing /developer-platform");
    assert.ok(existsSync(path.join(raiz, "app/developers/page.tsx")), "docs /developers (Fase 14) sigue existiendo");
    assert.ok(existsSync(path.join(raiz, "app/developer/page.tsx")), "dashboard /developer privado sigue existiendo");
    assert.ok(existsSync(path.join(raiz, "app/developer/layout.tsx")), "el dashboard mantiene su layout (shell con sesión)");
  });

  it("la landing NO enlaza directo al dashboard privado (/developer a secas)", () => {
    for (const f of archivosLanding()) {
      const src = readFileSync(f, "utf8");
      // href="/developer" EXACTO (no /developer-platform, /developers ni el
      // CTA /login?next=/developer, que es el flujo correcto de onboarding).
      assert.ok(!/href="\/developer"/.test(src), `${path.basename(f)} enlaza directo a /developer (privado)`);
    }
  });

  it("la landing usa SOLO placeholders de API key (nunca claves reales)", () => {
    const placeholders = new Set(["dl_live_your_api_key", "dl_live_tu_api_key"]);
    for (const f of archivosLanding()) {
      for (const m of readFileSync(f, "utf8").matchAll(/dl_live_[A-Za-z0-9_]+/g)) {
        assert.ok(placeholders.has(m[0]), `posible clave real en ${path.basename(f)}: ${m[0]}`);
      }
    }
  });

  it("la landing es bilingüe ES/EN (useI18n con pares t())", () => {
    const hero = readFileSync(path.join(raiz, "components/developer-platform/DevHero.tsx"), "utf8");
    const pricing = readFileSync(path.join(raiz, "components/developer-platform/DevPricing.tsx"), "utf8");
    assert.ok(hero.includes("useI18n"), "DevHero usa useI18n");
    assert.ok(pricing.includes("useI18n"), "DevPricing usa useI18n");
    assert.ok(pricing.includes('"Mensual"') && pricing.includes('"Monthly"'), "toggle bilingüe mensual/monthly");
  });

  it("la landing enlaza a docs y al onboarding (CTAs correctos en el árbol)", () => {
    const todo = archivosLanding().map((f) => readFileSync(f, "utf8")).join("\n");
    assert.ok(todo.includes("START_HREF") || todo.includes("/login?next=/developer"), "CTA de comenzar");
    assert.ok(todo.includes("DOCS_HREF") || todo.includes("/developers"), "CTA de documentación");
  });
});

describe("Fase 15 -- sitemap y robots", () => {
  it("el sitemap incluye /developer-platform", () => {
    const urls = sitemap().map((e) => e.url);
    assert.ok(urls.includes(`${SITE_URL}/developer-platform`), "sitemap incluye la landing");
  });

  it("el sitemap NO incluye el dashboard privado /developer", () => {
    const urls = sitemap().map((e) => e.url);
    assert.ok(!urls.includes(`${SITE_URL}/developer`), "sitemap no expone el dashboard");
  });

  it("robots protege el dashboard privado sin bloquear landing ni docs", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    const disallow = ([] as string[]).concat((rule?.disallow as string[] | string) ?? []);
    assert.ok(disallow.includes("/developer$"), "protege /developer exacto");
    assert.ok(disallow.includes("/developer/"), "protege subrutas del dashboard");
    // NO debe existir el prefijo a secas '/developer' (atraparía landing/docs).
    assert.ok(!disallow.includes("/developer"), "no usa el prefijo /developer (atraparía /developer-platform y /developers)");
    assert.ok(!disallow.some((d) => d === "/developer-platform" || d.startsWith("/developers")), "no bloquea landing ni docs");
  });
});

describe("Fase 15 -- Business no se rompe (nav/footer aditivos)", () => {
  it("el Nav conserva enlaces core de Business y suma Developers", () => {
    const nav = readFileSync(path.join(raiz, "components/site/Nav.tsx"), "utf8");
    assert.ok(nav.includes("/whatsapp-ia"), "conserva WhatsApp con IA");
    assert.ok(nav.includes("/soluciones-empresariales"), "conserva Enterprise");
    assert.ok(nav.includes("/developer-platform"), "suma el enlace Developers");
  });

  it("el Footer conserva legal/core y suma la columna Developers", () => {
    const sec = readFileSync(path.join(raiz, "components/site/Sections.tsx"), "utf8");
    assert.ok(sec.includes("/privacidad") && sec.includes("/terminos"), "conserva legales");
    assert.ok(sec.includes("/developer-platform") && sec.includes('h: "/developers"'), "suma Developers al footer");
  });
});
