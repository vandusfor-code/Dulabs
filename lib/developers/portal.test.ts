/**
 * DuLabs Developer V1 -- Fase 14.8. Tests del portal público: la navegación no
 * tiene enlaces muertos, los ejemplos usan SOLO placeholders (nunca claves
 * reales) y el portal no documenta superficie interna.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const raiz = process.cwd();
const dirPortal = path.join(raiz, "app/developers");

function archivosPortal(): string[] {
  const salida: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) salida.push(p);
    }
  };
  walk(dirPortal);
  return salida;
}

describe("Fase 14 -- portal público", () => {
  it("la navegación no tiene enlaces muertos (cada href tiene page.tsx)", () => {
    const nav = readFileSync(path.join(raiz, "components/developers/DocsSidebar.tsx"), "utf8");
    const hrefs = [...nav.matchAll(/href:\s*"(\/developers[^"]*)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 6, "debe haber varias entradas de nav");
    for (const href of hrefs) {
      const rel = href === "/developers" ? "app/developers/page.tsx" : `app/developers/${href.replace("/developers/", "")}/page.tsx`;
      assert.ok(existsSync(path.join(raiz, rel)), `enlace muerto: ${href} -> falta ${rel}`);
    }
  });

  it("los ejemplos usan SOLO placeholders de API key (nunca claves reales)", () => {
    const placeholders = new Set(["dl_live_tu_api_key", "dl_live_your_api_key"]);
    for (const f of archivosPortal()) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/dl_live_[A-Za-z0-9_]+/g)) {
        assert.ok(placeholders.has(m[0]), `posible clave real en ${path.basename(f)}: ${m[0]}`);
      }
    }
  });

  it("el portal NO documenta superficie interna (/api/v1/dev, callback de Meta)", () => {
    for (const f of archivosPortal()) {
      const src = readFileSync(f, "utf8");
      assert.ok(!src.includes("/api/v1/dev"), `${path.basename(f)} referencia /api/v1/dev`);
      assert.ok(!src.includes("webhooks/meta"), `${path.basename(f)} referencia la callback de Meta`);
    }
  });
});
