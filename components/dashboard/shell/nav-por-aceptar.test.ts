/**
 * FASE 3B.7 — "Por aceptar" en la navegación existente: aparece solo donde corresponde, sin tocar el menú de
 * Delacour, y no ilumina dos ítems a la vez. El menú es PRESENTACIÓN (cada endpoint vuelve a autorizar); esto
 * prueba que las reglas de visibilidad sean las mismas para el Sidebar y la paleta de comandos (navItemVisible).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { navItemActivo, navItemVisible, navSections, type NavItem } from "@/components/dashboard/shell/nav";
import type { ModuloId } from "@/lib/tenant-modulos";
import type { Rol } from "@/lib/team";

const HREF = "/dashboard/pedidos/por-aceptar";
const todos = navSections.flatMap((s) => s.items);
const porAceptar = todos.find((i) => i.href === HREF) as NavItem;
const pedidos = todos.find((i) => i.href === "/dashboard/pedidos") as NavItem;

// Lo que tiene Delacour hoy (sin el módulo nuevo) y lo que tendrá ASLC (con él).
const DELACOUR: ModuloId[] = ["catalogo", "pedidos", "notificaciones_pedidos", "marca_referencia"];
const ASLC: ModuloId[] = ["catalogo", "pedidos", "pedidos_por_aceptar"];
const visibles = (rol: Rol | null, modulos: readonly ModuloId[]) => todos.filter((i) => navItemVisible(i, rol, modulos));

describe("3B.7 · navegación: el ítem 'Por aceptar'", () => {
  it("existe, vive justo después de 'Pedidos' en su misma sección y apunta a la página real", () => {
    assert.ok(porAceptar, "el ítem existe");
    assert.ok(pedidos);
    const seccion = navSections.find((s) => s.items.includes(porAceptar))!;
    assert.ok(seccion.items.includes(pedidos), "misma sección que Pedidos");
    assert.equal(seccion.items.indexOf(porAceptar), seccion.items.indexOf(pedidos) + 1, "justo después de Pedidos");
    assert.equal(porAceptar.label, "Por aceptar");
    assert.deepEqual(porAceptar.rolesPermitidos, ["admin", "agente"]);
  });

  it("exige AMBOS módulos: 'pedidos' y 'pedidos_por_aceptar'", () => {
    assert.deepEqual([...(porAceptar.modulo as readonly ModuloId[])].sort(), ["pedidos", "pedidos_por_aceptar"]);
  });

  it("Delacour (sin 'pedidos_por_aceptar') NO lo ve, con ningún rol; su menú sigue igual", () => {
    for (const rol of ["admin", "agente", "lectura", null] as const) {
      assert.equal(navItemVisible(porAceptar, rol, DELACOUR), false, String(rol));
      assert.ok(!visibles(rol, DELACOUR).some((i) => i.href === HREF));
    }
    // Pedidos sigue visible para quien ya lo veía.
    assert.equal(navItemVisible(pedidos, "admin", DELACOUR), true);
    assert.equal(navItemVisible(pedidos, "agente", DELACOUR), true);
  });

  it("ASLC (con los dos módulos): lo ven admin y agente; lectura y sin rol, no", () => {
    assert.equal(navItemVisible(porAceptar, "admin", ASLC), true);
    assert.equal(navItemVisible(porAceptar, "agente", ASLC), true);
    assert.equal(navItemVisible(porAceptar, "lectura", ASLC), false);
    assert.equal(navItemVisible(porAceptar, null, ASLC), false);
  });

  it("solo con 'pedidos_por_aceptar' (sin 'pedidos') tampoco: vive dentro de Pedidos", () => {
    assert.equal(navItemVisible(porAceptar, "admin", ["pedidos_por_aceptar"]), false);
    assert.equal(navItemVisible(porAceptar, "admin", []), false);
  });

  it("habilitar el módulo nuevo no cambia NINGÚN otro ítem del menú (solo suma 'Por aceptar')", () => {
    for (const rol of ["admin", "agente", "lectura"] as const) {
      const sin = visibles(rol, ASLC.filter((m) => m !== "pedidos_por_aceptar")).map((i) => i.href);
      const con = visibles(rol, ASLC).map((i) => i.href);
      assert.deepEqual(con.filter((h) => h !== HREF), sin, rol);
      assert.equal(con.includes(HREF), rol !== "lectura", rol);
    }
  });

  it("los ítems de siempre conservan su módulo de un solo id (el cambio a lista solo aplica al ítem nuevo)", () => {
    for (const item of todos) if (item !== porAceptar) assert.ok(item.modulo === undefined || typeof item.modulo === "string", item.href);
  });
});

describe("3B.7 · navegación: un solo ítem activo", () => {
  const activos = (pathname: string, items: readonly NavItem[]) => items.filter((i) => navItemActivo(i, pathname, items)).map((i) => i.href);
  const conAceptar = visibles("admin", ASLC);
  const sinAceptar = visibles("admin", DELACOUR);

  it("en /dashboard/pedidos/por-aceptar (y su detalle) solo se ilumina 'Por aceptar', no también 'Pedidos'", () => {
    assert.deepEqual(activos(HREF, conAceptar), [HREF]);
    assert.deepEqual(activos(`${HREF}/DL-ORD-ABC234`, conAceptar), [HREF]);
  });

  it("en /dashboard/pedidos y en un pedido normal se ilumina 'Pedidos' (con o sin el ítem nuevo)", () => {
    assert.deepEqual(activos("/dashboard/pedidos", conAceptar), ["/dashboard/pedidos"]);
    assert.deepEqual(activos("/dashboard/pedidos/DL-ORD-ABC234", conAceptar), ["/dashboard/pedidos"]);
    assert.deepEqual(activos("/dashboard/pedidos/DL-ORD-ABC234", sinAceptar), ["/dashboard/pedidos"]);
  });

  it("si 'Por aceptar' NO es visible, nada cambia para quien visita esa ruta: 'Pedidos' sigue activo como siempre", () => {
    assert.deepEqual(activos(HREF, sinAceptar), ["/dashboard/pedidos"]);
  });

  it("'/dashboard' solo se ilumina en la ruta exacta; el resto del criterio de prefijo se conserva", () => {
    assert.deepEqual(activos("/dashboard", conAceptar), ["/dashboard"]);
    assert.ok(!activos("/dashboard/catalogo", conAceptar).includes("/dashboard"));
    assert.ok(activos("/dashboard/catalogo/productos", conAceptar).includes("/dashboard/catalogo"));
  });

  it("cada ruta del menú ilumina su propio ítem (el desempate no apaga a ningún ítem en su propia ruta)", () => {
    for (const item of conAceptar) {
      const marcados = activos(item.href, conAceptar);
      assert.ok(marcados.includes(item.href), `${item.href} se ilumina en su propia ruta`);
    }
  });
});
