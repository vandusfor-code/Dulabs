import "@/lib/test-helpers/jsdom-setup";
/**
 * Catálogo — ELIMINAR CATEGORÍAS, de punta a punta en pantalla: el administrador de categorías (jsdom + Testing Library) → el cliente del navegador → las rutas REALES de categorías
 * (sesión, rol, validación, servicio) → un Supabase en memoria que, como la base de verdad, no deja borrar una categoría con productos. Lo que la persona decide en pantalla es lo
 * que el servidor vuelve a validar. El listado de productos y los links públicos se sirven de mentira (no son el tema): lo que importa es QUÉ pide la página después de eliminar.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Session } from "@supabase/supabase-js";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextRequest } from "next/server";
import { createCatalogClient } from "@/lib/catalogo-client";
import { createCmsClient, type UsoCategoria } from "@/lib/cms-comercial-client";
import type { CategoryDeleteResult } from "@/lib/catalogo/domain";
import { DashboardContext, type DashboardContextValue } from "@/lib/dashboard-session";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { CatalogToastProvider } from "@/components/dashboard/catalogo/ui";
import { CategoriasDialog } from "@/components/dashboard/catalogo/CategoriasDialog";
import CatalogoPage from "@/app/dashboard/catalogo/page";
import { GET as categoriasGET, POST as categoriasPOST } from "@/app/api/dashboard/catalogo/categorias/route";
import { DELETE as categoriaDELETE } from "@/app/api/dashboard/catalogo/categorias/[id]/route";

configure({ asyncUtilTimeout: 6000 });

const T1 = "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4";
const U_ADMIN = "11111111-1111-4111-8111-111111111111";
const U_LECTURA = "22222222-2222-4222-8222-222222222222";
const ARETES = "c0000000-0000-4000-8000-0000000000a1";
const DIJES = "c0000000-0000-4000-8000-0000000000a2";
const VACIA = "c0000000-0000-4000-8000-0000000000a3";
const PREFIJO = "/api/dashboard/catalogo";

let db: SupabaseMemoria;
let puente: { llamadas: Array<{ metodo: string; ruta: string }>; restaurar: () => void };
/** Lo que responde la consulta «¿dónde está elegida esta categoría?» de la tienda (cada prueba lo cambia). Por defecto: en ninguna parte. */
let usosDeLaTienda: (id: string, request: NextRequest) => Response | Promise<Response>;
const usosOk = (usos: UsoCategoria[]) => Response.json({ success: true, data: { usos } });

/** Lleva las llamadas del cliente del navegador (rutas relativas) a los handlers REALES de categorías; productos y links públicos son respuestas fijas. */
function instalarPuente() {
  const base = globalThis.fetch;
  const llamadas: Array<{ metodo: string; ruta: string }> = [];
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url, "http://localhost");
    const metodo = (init?.method ?? "GET").toUpperCase();
    const deLaTienda = /^\/api\/dashboard\/tienda\/categorias\/([^/]+)\/usos$/.exec(url.pathname);
    if (deLaTienda) {
      llamadas.push({ metodo, ruta: url.pathname });
      return usosDeLaTienda(deLaTienda[1], new NextRequest(url, { method: metodo, headers: init?.headers as HeadersInit | undefined }));
    }
    if (!url.pathname.startsWith(PREFIJO)) return base(entrada, init);
    const ruta = url.pathname.slice(PREFIJO.length);
    llamadas.push({ metodo, ruta: `${ruta}${url.search}` });
    const request = new NextRequest(url, { method: metodo, headers: init?.headers as HeadersInit | undefined, body: typeof init?.body === "string" ? init.body : undefined });
    if (ruta === "/categorias") return metodo === "GET" ? categoriasGET(request) : categoriasPOST(request);
    const una = /^\/categorias\/([^/]+)$/.exec(ruta);
    if (una && metodo === "DELETE") return categoriaDELETE(request, { params: Promise.resolve({ id: una[1] }) });
    if (ruta === "/productos") return Response.json({ success: true, data: { items: [], total: 0, page: 1, pageSize: 30 } });
    if (ruta === "/publicacion") return Response.json({ success: true, data: { publication: null } });
    return Response.json({ success: false, error: { code: "NOT_FOUND", message: "Ruta desconocida." } }, { status: 404 });
  }) as typeof fetch;
  return { llamadas, restaurar: () => void (globalThis.fetch = base) };
}

const productos = () => db.rows("dulabs_inventario_productos");
const categoriasEnBase = () => db.rows("dulabs_catalogo_categorias").map((c) => c.id as string).sort();
const producto = (id: string) => productos().find((p) => p.id === id)!;
function fila(id: string, categoriaId: string | null, categoria: string | null, extra: Record<string, unknown> = {}) {
  return { id, id_tenant: T1, nombre: `Producto ${id.slice(-2)}`, categoria_id: categoriaId, categoria, activo: true, updated_by: null, escritura_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", updated_at: "2026-09-01T00:00:00.000Z", ...extra };
}
const P1 = "a0000000-0000-4000-8000-000000000001";
const P2 = "a0000000-0000-4000-8000-000000000002";
const P3 = "a0000000-0000-4000-8000-000000000003";

beforeEach(() => {
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  db.user("t-admin", U_ADMIN);
  db.user("t-lectura", U_LECTURA);
  db.table("dulabs_miembros_equipo").push(
    { id: 1, tenant_id: T1, user_id: U_ADMIN, rol: "admin", estado: "activo" },
    { id: 2, tenant_id: T1, user_id: U_LECTURA, rol: "lectura", estado: "activo" },
  );
  db.table("dulabs_tenant_modulos").push({ id_tenant: T1, modulo: "catalogo", habilitado: true });
  db.rpc("dulabs_rate_limit_incrementar", () => ({ data: [{ permitido: true, conteo: 1, reinicia_en: new Date(Date.now() + 60_000).toISOString() }] }));
  db.table("dulabs_catalogo_categorias", { referencedBy: [{ table: "dulabs_inventario_productos", columns: ["id_tenant", "categoria_id"], parentColumns: ["id_tenant", "id"] }] }).push(
    { id: ARETES, id_tenant: T1, nombre: "Aretes" },
    { id: DIJES, id_tenant: T1, nombre: "Dijes" },
    { id: VACIA, id_tenant: T1, nombre: "Vacía" },
  );
  db.table("dulabs_inventario_productos").push(fila(P1, ARETES, "Aretes"), fila(P2, ARETES, "Aretes", { activo: false }), fila(P3, DIJES, "Dijes"));
  usosDeLaTienda = () => usosOk([]);
  puente = instalarPuente();
});

afterEach(() => {
  cleanup();
  puente.restaurar();
  db.uninstall();
});

function abrirDialogo(token = "t-admin", opciones: { sinTienda?: boolean } = {}) {
  const eliminadas: Array<{ id: string; resultado: CategoryDeleteResult }> = [];
  let cierres = 0;
  const usuario = userEvent.setup();
  render(
    <CatalogToastProvider>
      <CategoriasDialog abierto client={createCatalogClient(token)} cms={opciones.sinTienda ? null : createCmsClient(token)} onCerrar={() => void cierres++} onEliminada={(id, resultado) => void eliminadas.push({ id, resultado })} />
    </CatalogToastProvider>,
  );
  return { usuario, eliminadas, cierres: () => cierres };
}

const eliminarFila = (nombre: string) => screen.findByRole("button", { name: `Eliminar la categoría ${nombre}` });
const filasDeLaLista = async () => {
  const lista = await screen.findByRole("list", { name: "Categorías del catálogo" });
  return within(lista).getAllByRole("listitem").map((li) => li.textContent);
};
const confirmar = () => screen.getByRole("button", { name: "Eliminar categoría" }) as HTMLButtonElement;

describe("el administrador de categorías", () => {
  it("lista cada categoría con cuántos productos usa (cuenta también a los inactivos) y cierra con «Cerrar» o Escape", async () => {
    const { usuario, cierres } = abrirDialogo();
    const dialogo = await screen.findByRole("dialog", { name: "Categorías" });
    assert.deepEqual(await filasDeLaLista(), ["Aretes2 productos", "Dijes1 producto", "VacíaSin productos"]);
    await usuario.click(within(dialogo.querySelector<HTMLElement>("[data-acciones]")!).getByRole("button", { name: "Cerrar" }));
    assert.equal(cierres(), 1);
    await usuario.keyboard("{Escape}");
    assert.equal(cierres(), 2);
  });

  it("sin categorías lo dice (se crean al agregar un producto)", async () => {
    db.rows("dulabs_catalogo_categorias").length = 0;
    db.rows("dulabs_inventario_productos").length = 0;
    abrirDialogo();
    assert.ok(await screen.findByText(/Todavía no tienes categorías/));
  });

  it("si no puede cargar muestra el motivo y «Reintentar» lo vuelve a pedir", async (t) => {
    t.mock.method(console, "error", () => {});
    db.missing("dulabs_catalogo_categorias");
    const { usuario } = abrirDialogo();
    assert.ok(await screen.findByText("No se pudo completar la operación del catálogo."));
    db.table("dulabs_catalogo_categorias"); // la tabla vuelve (las filas se conservan)
    await usuario.click(screen.getByRole("button", { name: "Reintentar" }));
    assert.deepEqual(await filasDeLaLista(), ["Aretes2 productos", "Dijes1 producto", "VacíaSin productos"]);
  });
});

describe("eliminar una categoría SIN productos", () => {
  it("pide confirmación; «Cancelar» vuelve a la lista sin borrar nada; «Eliminar categoría» la borra y avisa", async () => {
    const { usuario, eliminadas } = abrirDialogo();
    // fireEvent y no user-event: este deja el foco en <body> cuando el botón pulsado desaparece del DOM; el navegador real (y fireEvent) dejan que `autoFocus` del botón nuevo mande.
    fireEvent.click(await eliminarFila("Vacía"));

    const dialogo = await screen.findByRole("dialog", { name: "Eliminar «Vacía»" });
    assert.ok(within(dialogo).getByText(/No tiene productos/));
    assert.equal(within(dialogo).queryByRole("combobox"), null, "sin productos no hay nada que decidir");
    assert.ok(document.activeElement === within(dialogo).getByRole("button", { name: "Cancelar" }), `el foco cae en «Cancelar»: Enter nunca elimina sin querer (está en <${document.activeElement?.tagName}> «${document.activeElement?.textContent}»)`);

    await usuario.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    assert.deepEqual(await filasDeLaLista(), ["Aretes2 productos", "Dijes1 producto", "VacíaSin productos"]);
    assert.ok(!puente.llamadas.some((l) => l.metodo === "DELETE"), "cancelar no llama a nadie");

    await usuario.click(await eliminarFila("Vacía"));
    await usuario.click(await screen.findByRole("button", { name: "Eliminar categoría" }));

    assert.ok(await screen.findByText("Categoría «Vacía» eliminada."));
    assert.deepEqual(await filasDeLaLista(), ["Aretes2 productos", "Dijes1 producto"]);
    assert.deepEqual(categoriasEnBase(), [ARETES, DIJES].sort());
    assert.deepEqual(eliminadas, [{ id: VACIA, resultado: { deleted: true, moved: 0, movedTo: null } }]);
    assert.ok(puente.llamadas.some((l) => l.metodo === "DELETE" && l.ruta === `/categorias/${VACIA}`), "sin ?moveTo: no había productos");
  });
});

describe("eliminar una categoría CON productos", () => {
  it("obliga a elegir qué pasa con ellos: «Eliminar categoría» no se habilita hasta elegir, y el destino no ofrece la misma categoría", async () => {
    const { usuario } = abrirDialogo();
    fireEvent.click(await eliminarFila("Aretes")); // fireEvent: ver la nota del test anterior sobre el foco
    const dialogo = await screen.findByRole("dialog", { name: "Eliminar «Aretes»" });

    const destino = within(dialogo).getByLabelText(/«Aretes» tiene 2 productos\. ¿Qué hacemos con ellos\?/) as HTMLSelectElement;
    assert.ok(document.activeElement === destino, `el foco entra a la decisión (está en <${document.activeElement?.tagName}> «${document.activeElement?.textContent}»)`);
    assert.deepEqual([...destino.options].map((o) => o.textContent), ["Elige una opción…", "Pasarlos a «Dijes»", "Pasarlos a «Vacía»", "Dejarlos sin categoría"]);
    assert.equal(confirmar().disabled, true, "sin decisión no se puede eliminar");

    await usuario.selectOptions(destino, DIJES);
    assert.equal(confirmar().disabled, false);
  });

  it("pasarlos a otra categoría: los productos se mueven, se avisa cuántos y a dónde, y la lista queda con los números nuevos", async () => {
    const { usuario, eliminadas } = abrirDialogo();
    await usuario.click(await eliminarFila("Aretes"));
    await usuario.selectOptions(await screen.findByLabelText(/¿Qué hacemos con ellos\?/), DIJES);
    await usuario.click(confirmar());

    assert.ok(await screen.findByText("Categoría «Aretes» eliminada. 2 productos pasaron a «Dijes»."));
    assert.deepEqual(await filasDeLaLista(), ["Dijes3 productos", "VacíaSin productos"]);
    assert.deepEqual(categoriasEnBase(), [DIJES, VACIA].sort());
    for (const id of [P1, P2]) {
      assert.equal(producto(id).categoria_id, DIJES);
      assert.equal(producto(id).categoria, "Dijes");
      assert.equal(producto(id).updated_by, U_ADMIN);
    }
    assert.deepEqual(eliminadas, [{ id: ARETES, resultado: { deleted: true, moved: 2, movedTo: { id: DIJES, name: "Dijes" } } }]);
    assert.ok(puente.llamadas.some((l) => l.metodo === "DELETE" && l.ruta === `/categorias/${ARETES}?moveTo=${DIJES}`));
  });

  it("dejarlos sin categoría (y el singular cuando es uno solo)", async () => {
    const { usuario } = abrirDialogo();
    await usuario.click(await eliminarFila("Dijes"));
    await usuario.selectOptions(await screen.findByLabelText(/«Dijes» tiene 1 producto\./), "none");
    await usuario.click(confirmar());

    assert.ok(await screen.findByText("Categoría «Dijes» eliminada. 1 producto quedó sin categoría."));
    assert.equal(producto(P3).categoria_id, null);
    assert.equal(producto(P3).categoria, null);
    assert.ok(puente.llamadas.some((l) => l.metodo === "DELETE" && l.ruta === `/categorias/${DIJES}?moveTo=none`));
  });
});

describe("cuando las cosas cambian mientras la persona decide", () => {
  it("entra un producto a una categoría que se veía vacía: el servidor la protege (409), la lista se actualiza y el motivo queda a la vista", async () => {
    const { usuario, eliminadas } = abrirDialogo();
    await usuario.click(await eliminarFila("Vacía"));
    await screen.findByText(/No tiene productos/);

    productos().push(fila("a0000000-0000-4000-8000-0000000000ee", VACIA, "Vacía")); // otra persona acaba de crear un producto ahí
    await usuario.click(screen.getByRole("button", { name: "Eliminar categoría" }));

    const alerta = await screen.findByRole("alert");
    assert.match(alerta.textContent ?? "", /Esta categoría tiene 1 producto/);
    assert.deepEqual(await waitFor(async () => {
      const filas = await filasDeLaLista();
      assert.ok(filas.includes("Vacía1 producto"), "el número se actualizó");
      return filas;
    }), ["Aretes2 productos", "Dijes1 producto", "Vacía1 producto"]);
    assert.ok(categoriasEnBase().includes(VACIA), "la categoría NO se borró");
    assert.deepEqual(eliminadas, []);
  });

  it("otra persona ya la había eliminado: avisa que no existe y la quita de la lista", async () => {
    const { usuario } = abrirDialogo();
    await usuario.click(await eliminarFila("Vacía"));
    await screen.findByText(/No tiene productos/);

    db.rows("dulabs_catalogo_categorias").splice(db.rows("dulabs_catalogo_categorias").findIndex((c) => c.id === VACIA), 1);
    await usuario.click(screen.getByRole("button", { name: "Eliminar categoría" }));

    assert.match((await screen.findByRole("alert")).textContent ?? "", /La categoría no existe/);
    await waitFor(async () => assert.deepEqual(await filasDeLaLista(), ["Aretes2 productos", "Dijes1 producto"]));
  });
});

const USO_INICIO: UsoCategoria = { tipo: "home", clave: "home", nombre: "Página principal", estado: "publicada", lugares: ["destacadas"], enPublicado: true, enBorrador: false, visibleHoy: true };
const USO_OFERTA: UsoCategoria = { tipo: "oferta", clave: "amor", nombre: "Amor y Amistad", estado: "borrador", lugares: ["oferta"], enPublicado: false, enBorrador: true, visibleHoy: false };
const usosEnTienda = () => screen.findByTestId("usos-categoria");
/** Una respuesta que la prueba suelta cuando quiere (para ver el estado «cargando» y las respuestas que llegan tarde). */
function compuerta() {
  let abrir!: (r: Response) => void;
  const promesa = new Promise<Response>((r) => (abrir = r));
  return { promesa, abrir };
}

describe("dónde está elegida la categoría (antes de eliminarla)", () => {
  it("mientras se revisa lo dice, y eso no impide decidir: la consulta es una ayuda, no un candado", async () => {
    const c = compuerta();
    usosDeLaTienda = () => c.promesa;
    const { usuario } = abrirDialogo();
    await usuario.click(await eliminarFila("Vacía"));
    assert.ok(await screen.findByTestId("usos-categoria-cargando"));
    assert.equal(confirmar().disabled, false, "una categoría vacía se puede eliminar sin esperar la consulta");
    c.abrir(usosOk([USO_INICIO]));
    await usosEnTienda();
    assert.equal(screen.queryByTestId("usos-categoria-cargando"), null);
  });

  it("pide los usos de ESA categoría a la tienda, con la sesión de quien administra", async () => {
    const { usuario } = abrirDialogo();
    await usuario.click(await eliminarFila("Aretes"));
    await screen.findByTestId("usos-categoria-ninguno");
    assert.ok(puente.llamadas.some((l) => l.metodo === "GET" && l.ruta === "/api/dashboard/tienda/categorias/" + ARETES + "/usos"));
  });

  it("dice en qué partes está elegida (nombre, lugar y si se ve hoy o está en borrador) y qué pasará", async () => {
    usosDeLaTienda = () => usosOk([USO_INICIO, USO_OFERTA]);
    const { usuario } = abrirDialogo();
    await usuario.click(await eliminarFila("Aretes"));
    const caja = await usosEnTienda();
    const filas = within(caja).getAllByRole("listitem").map((li) => li.textContent);
    assert.deepEqual(filas, ["Página principal — categorías destacadas (se ve hoy en la tienda)", "Oferta «Amor y Amistad» — categorías de la oferta (en borrador)"]);
    assert.match(caja.textContent ?? "", /Si la eliminas, deja de mostrarse en esos lugares\. Antes de volver a publicar esos elementos, quítala de cada uno\./);
  });

  it("nombra cada tipo de elemento y cada lugar como lo conoce la persona", async () => {
    usosDeLaTienda = () =>
      usosOk([
        { ...USO_INICIO, lugares: ["destacadas", "boton"] },
        { tipo: "pie", clave: "pie", nombre: "Pie de página", estado: "publicada", lugares: ["enlace_pie"], enPublicado: true, enBorrador: true, visibleHoy: true },
        { tipo: "multimedia", clave: "multimedia", nombre: "Fotos y videos", estado: "borrador", lugares: ["imagen_categoria"], enPublicado: false, enBorrador: true, visibleHoy: false },
        { tipo: "campana", clave: "madre", nombre: "Día de la Madre", estado: "pausada", lugares: ["boton"], enPublicado: true, enBorrador: false, visibleHoy: false },
      ]);
    const { usuario } = abrirDialogo();
    await usuario.click(await eliminarFila("Dijes"));
    const filas = within(await usosEnTienda()).getAllByRole("listitem").map((li) => li.textContent);
    assert.deepEqual(filas, [
      "Página principal — categorías destacadas, un botón (se ve hoy en la tienda)",
      "Pie de página — enlace del pie de página (se ve hoy en la tienda · en borrador)",
      "Fotos y videos — imagen de la categoría (en borrador)",
      "Campaña «Día de la Madre» — un botón (publicada, pero en pausa)",
    ]);
  });

  it("si no está elegida en ninguna parte lo dice: eliminarla no cambia nada en la tienda", async () => {
    const { usuario } = abrirDialogo();
    await usuario.click(await eliminarFila("Vacía"));
    assert.match((await screen.findByTestId("usos-categoria-ninguno")).textContent ?? "", /No está elegida en ninguna parte de la sección Tienda: eliminarla no cambia nada allí\./);
    assert.equal(screen.queryByTestId("usos-categoria"), null);
  });

  it("si no se puede consultar (tienda sin el módulo, error, sin conexión) se avisa en general y se puede seguir", async () => {
    usosDeLaTienda = () => Response.json({ success: false, error: { code: "MODULE_DISABLED", message: "La administración de la tienda no está habilitada para tu cuenta." } }, { status: 403 });
    const { usuario } = abrirDialogo();
    await usuario.click(await eliminarFila("Vacía"));
    assert.match((await screen.findByTestId("usos-categoria-general")).textContent ?? "", /No pudimos revisar en qué partes de tu tienda está elegida\..*Antes de volver a publicar, quítala de esos lugares\./);
    assert.equal(confirmar().disabled, false);
  });

  it("sin el cliente de la tienda (no hay sesión para consultarla) se muestra el mismo aviso general", async () => {
    const { usuario } = abrirDialogo("t-admin", { sinTienda: true });
    await usuario.click(await eliminarFila("Vacía"));
    await screen.findByTestId("usos-categoria-general");
    assert.ok(!puente.llamadas.some((l) => l.ruta.includes("/tienda/")), "no se consultó nada");
  });

  it("una respuesta que llega tarde de OTRA categoría no se mezcla: solo cuenta la de la categoría que se está viendo", async () => {
    const lenta = compuerta();
    usosDeLaTienda = (id) => (id === ARETES ? lenta.promesa : usosOk([USO_OFERTA]));
    const { usuario } = abrirDialogo();
    await usuario.click(await eliminarFila("Aretes"));
    await screen.findByTestId("usos-categoria-cargando");
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    await usuario.click(await eliminarFila("Dijes"));
    const caja = await usosEnTienda();
    assert.ok(within(caja).getByText(/Amor y Amistad/));

    lenta.abrir(usosOk([USO_INICIO])); // llega la de Aretes, ya tarde
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(within(screen.getByTestId("usos-categoria")).getByText(/Amor y Amistad/), "sigue viéndose lo de Dijes");
    assert.equal(within(screen.getByTestId("usos-categoria")).queryByText(/Página principal/), null, "lo de Aretes no se mezcló");
  });

  it("al volver a elegir la misma categoría se consulta de nuevo (la tienda pudo cambiar) y no se muestra lo viejo mientras tanto", async () => {
    usosDeLaTienda = () => usosOk([USO_INICIO]);
    const { usuario } = abrirDialogo();
    await usuario.click(await eliminarFila("Aretes"));
    await usosEnTienda();
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));

    const c = compuerta();
    usosDeLaTienda = () => c.promesa;
    await usuario.click(await eliminarFila("Aretes"));
    assert.ok(await screen.findByTestId("usos-categoria-cargando"), "no queda a la vista lo de la vez anterior");
    assert.equal(screen.queryByTestId("usos-categoria"), null);
    c.abrir(usosOk([]));
    await screen.findByTestId("usos-categoria-ninguno");
    assert.equal(puente.llamadas.filter((l) => l.ruta === "/api/dashboard/tienda/categorias/" + ARETES + "/usos").length, 2);
  });
});

describe("la página del catálogo", () => {
  function sesion(token: string, rol: "admin" | "lectura"): DashboardContextValue {
    return {
      session: { access_token: token } as unknown as Session,
      negocios: [],
      errorNegocios: null,
      suscripcion: null,
      rol,
      miembroId: 1,
      puedeUsarDumo: false,
      esAdminDulabs: false,
      modulos: ["catalogo"],
      cargarNegocios: async () => {},
      numeroActivoId: null,
      seleccionarNumero: () => {},
    };
  }
  const montar = (token = "t-admin", rol: "admin" | "lectura" = "admin") =>
    render(
      <DashboardContext.Provider value={sesion(token, rol)}>
        <CatalogToastProvider>
          <CatalogoPage />
        </CatalogToastProvider>
      </DashboardContext.Provider>,
    );
  const productosPedidos = () => puente.llamadas.filter((l) => l.metodo === "GET" && l.ruta.startsWith("/productos"));

  it("el botón «Categorías» solo existe para quien puede modificar el catálogo", async () => {
    montar();
    assert.ok(await screen.findByRole("button", { name: "Categorías" }));
    cleanup();
    montar("t-lectura", "lectura");
    await screen.findByRole("heading", { name: "Carga de productos" });
    assert.equal(screen.queryByRole("button", { name: "Categorías" }), null);
  });

  it("al confirmar la eliminación consulta dónde está elegida la categoría, con la sesión de quien administra (no la de otra persona)", async () => {
    const sesiones: Array<string | null> = [];
    usosDeLaTienda = (_id, request) => {
      sesiones.push(request.headers.get("authorization"));
      return usosOk([USO_INICIO]);
    };
    const usuario = userEvent.setup();
    montar();
    await usuario.click(await screen.findByRole("button", { name: "Categorías" }));
    await usuario.click(await eliminarFila("Aretes"));
    const caja = await usosEnTienda();
    assert.ok(within(caja).getByText(/Página principal/));
    assert.deepEqual(sesiones, ["Bearer t-admin"]);
  });

  it("al eliminar la categoría por la que se estaba filtrando, el filtro se quita, la lista de filtros se actualiza y los productos se vuelven a pedir", async () => {
    const usuario = userEvent.setup();
    montar();
    const filtro = (await screen.findByLabelText("Filtrar por categoría")) as HTMLSelectElement;
    await screen.findByRole("option", { name: "Aretes" });
    await usuario.selectOptions(filtro, ARETES);
    await waitFor(() => assert.ok(productosPedidos().some((l) => l.ruta.includes(`categoryId=${ARETES}`)), "filtró por Aretes"));

    await usuario.click(screen.getByRole("button", { name: "Categorías" }));
    await usuario.click(await eliminarFila("Aretes"));
    await usuario.selectOptions(await screen.findByLabelText(/¿Qué hacemos con ellos\?/), DIJES);
    const antes = puente.llamadas.length;
    await usuario.click(confirmar());
    await screen.findByText("Categoría «Aretes» eliminada. 2 productos pasaron a «Dijes».");

    await waitFor(() => assert.equal((screen.getByLabelText("Filtrar por categoría") as HTMLSelectElement).value, "", "el filtro volvió a «Todas las categorías»"));
    assert.equal(screen.queryByRole("option", { name: "Aretes" }), null, "Aretes ya no se ofrece como filtro");
    assert.ok(screen.getByRole("option", { name: "Dijes" }));
    await waitFor(() => assert.ok(puente.llamadas.slice(antes).some((l) => l.metodo === "GET" && l.ruta.startsWith("/productos") && !l.ruta.includes("categoryId")), "pidió los productos de nuevo, ya sin el filtro"));
  });

  it("al eliminar OTRA categoría el filtro se queda como estaba, pero el listado se vuelve a pedir", async () => {
    const usuario = userEvent.setup();
    montar();
    const filtro = (await screen.findByLabelText("Filtrar por categoría")) as HTMLSelectElement;
    await screen.findByRole("option", { name: "Dijes" });
    await usuario.selectOptions(filtro, DIJES);
    await waitFor(() => assert.ok(productosPedidos().some((l) => l.ruta.includes(`categoryId=${DIJES}`))));

    await usuario.click(screen.getByRole("button", { name: "Categorías" }));
    await usuario.click(await eliminarFila("Vacía"));
    const antes = puente.llamadas.length;
    await usuario.click(await screen.findByRole("button", { name: "Eliminar categoría" }));
    await screen.findByText("Categoría «Vacía» eliminada.");

    assert.equal((screen.getByLabelText("Filtrar por categoría") as HTMLSelectElement).value, DIJES, "el filtro de Dijes sigue puesto");
    assert.equal(screen.queryByRole("option", { name: "Vacía" }), null);
    await waitFor(() => assert.ok(puente.llamadas.slice(antes).some((l) => l.metodo === "GET" && l.ruta.startsWith("/productos") && l.ruta.includes(`categoryId=${DIJES}`)), "volvió a pedir los productos de Dijes"));
  });
});
