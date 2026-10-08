/**
 * Inicio de la tienda — pruebas DORADAS: el HTML que produce hoy `TiendaInicio` (el inicio clásico de Delacour y de cualquier negocio sin contenido del CMS) queda
 * guardado en `__dorados__/` y NO PUEDE CAMBIAR cuando el negocio no tiene nada publicado en el CMS (módulo apagado, sin portada publicada o con un error al leerlo).
 * Así se demuestra que el PR de la tienda no altera lo que ven hoy los clientes.
 *
 * Para regenerar a propósito (solo si el diseño del inicio cambia por una decisión del negocio): ACTUALIZAR_DORADOS=1 npx tsx --test <este archivo>.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { CARPETA_DORADOS, ESCENARIOS } from "@/components/catalogo-publico/tienda/inicio-escenarios";

describe("inicio de la tienda — salida actual guardada (no puede cambiar sin contenido del CMS)", () => {
  for (const e of ESCENARIOS) {
    it(`escenario «${e.nombre}»: el HTML es idéntico al guardado`, () => {
      const archivo = path.join(CARPETA_DORADOS, `inicio-${e.nombre}.html`);
      const actual = e.html();
      if (process.env.ACTUALIZAR_DORADOS === "1") {
        mkdirSync(CARPETA_DORADOS, { recursive: true });
        writeFileSync(archivo, actual, "utf8");
      }
      assert.ok(existsSync(archivo), `falta el dorado ${archivo} (ACTUALIZAR_DORADOS=1 lo genera)`);
      assert.equal(actual, readFileSync(archivo, "utf8"));
    });
  }

  it("es determinista: dos renders seguidos dan exactamente el mismo HTML", () => {
    for (const e of ESCENARIOS) assert.equal(e.html(), e.html(), e.nombre);
  });

  it("los escenarios cubren lo importante: portada, banner, categorías, destacados (con precio a consultar, agotado y últimas unidades) y el estado vacío", () => {
    const todo = ESCENARIOS.map((e) => e.html()).join("\n");
    for (const marca of ["Historias que brillan contigo", "Más que joyas", "Ver catálogo", "Categorías", "Productos destacados", "Precio a consultar", "Últimas unidades", "Muy pronto, nuevas piezas", "El regalo perfecto siempre es una joya"]) assert.ok(todo.includes(marca), marca);
  });
});
