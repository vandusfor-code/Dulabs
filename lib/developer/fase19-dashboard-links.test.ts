/**
 * DuLabs Developer V1 -- Fase 19 (19.11, product quality). Guard contra enlaces
 * muertos en el dashboard: cada ruta /developer/* del nav debe tener page.tsx, y
 * los enlaces salientes a docs/onboarding deben apuntar a superficies reales.
 * Estático (fs). Complementa portal.test.ts (docs) y landing-fase15.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const raiz = process.cwd();

describe("Fase 19 -- dashboard sin enlaces muertos", () => {
  it("cada ruta /developer/* del nav tiene page.tsx", () => {
    const nav = readFileSync(path.join(raiz, "components/developer/nav.ts"), "utf8");
    const rutas = [...nav.matchAll(/"(\/developer(?:\/[a-z0-9/_-]+)?)"/g)].map((m) => m[1]);
    assert.ok(rutas.length >= 10, "el nav debe tener las secciones del dashboard");
    for (const r of new Set(rutas)) {
      const rel = r === "/developer" ? "app/developer/page.tsx" : `app${r}/page.tsx`;
      assert.ok(existsSync(path.join(raiz, rel)), `enlace muerto en nav: ${r} -> falta ${rel}`);
    }
  });

  it("las tres superficies Developer están separadas y existen", () => {
    assert.ok(existsSync(path.join(raiz, "app/developer/page.tsx")), "dashboard privado");
    assert.ok(existsSync(path.join(raiz, "app/developers/page.tsx")), "docs público");
    assert.ok(existsSync(path.join(raiz, "app/developer-platform/page.tsx")), "landing comercial");
  });
});
