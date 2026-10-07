/**
 * Menú del Dashboard — la entrada «Tienda» (administración de tienda, Bloque 29): solo existe para los negocios que tienen el módulo `cms_comercial`, la ven todos los
 * roles del equipo (solo un administrador modifica, y eso lo exige la API) y se ilumina únicamente en su propia ruta. Es solo presentación: la API autoriza por su cuenta.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { navItemActivo, navItemVisible, navSections, type NavItem } from "@/components/dashboard/shell/nav";
import type { Rol } from "@/lib/team";
import { MODULOS, type ModuloId } from "@/lib/tenant-modulos";

const todos = navSections.flatMap((s) => s.items);
const tienda = todos.find((i) => i.href === "/dashboard/tienda") as NavItem;
const ROLES: Rol[] = ["admin", "agente", "lectura"];

describe("menú · Tienda", () => {
  it("existe una sola entrada, con su nombre en español e inglés y atada al módulo cms_comercial", () => {
    assert.ok(tienda);
    assert.equal(todos.filter((i) => i.href === "/dashboard/tienda").length, 1);
    assert.equal(tienda.label, "Tienda");
    assert.equal(tienda.labelEn, "Store");
    assert.equal(tienda.modulo, "cms_comercial");
    assert.ok((MODULOS as readonly string[]).includes("cms_comercial"));
  });

  it("solo se ve en los negocios con el módulo habilitado; con cualquier otro módulo (o ninguno) no existe", () => {
    for (const rol of ROLES) {
      assert.equal(navItemVisible(tienda, rol, ["cms_comercial"]), true, rol);
      assert.equal(navItemVisible(tienda, rol, []), false, rol);
      const otros = MODULOS.filter((m) => m !== "cms_comercial") as ModuloId[];
      assert.equal(navItemVisible(tienda, rol, otros), false, `${rol} con todos los módulos menos el de la tienda`);
    }
  });

  it("la ven los tres roles del equipo (consultar es de todos; modificar lo decide la API)", () => {
    assert.equal(tienda.rolesPermitidos, undefined);
    for (const rol of ROLES) assert.equal(navItemVisible(tienda, rol, ["cms_comercial"]), true, rol);
  });

  it("se ilumina en su ruta (y en sus subrutas) y no en el catálogo ni en el resumen", () => {
    const visibles = todos.filter((i) => navItemVisible(i, "admin", ["cms_comercial", "catalogo", "pedidos"]));
    assert.equal(navItemActivo(tienda, "/dashboard/tienda", visibles), true);
    assert.equal(navItemActivo(tienda, "/dashboard/tienda/otra", visibles), true);
    assert.equal(navItemActivo(tienda, "/dashboard/catalogo", visibles), false);
    assert.equal(navItemActivo(tienda, "/dashboard", visibles), false);
    const catalogo = todos.find((i) => i.href === "/dashboard/catalogo") as NavItem;
    assert.equal(navItemActivo(catalogo, "/dashboard/tienda", visibles), false);
  });
});
