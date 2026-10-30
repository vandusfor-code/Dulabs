import "@/lib/test-helpers/jsdom-setup";
/**
 * Clasificar las piezas de la joyería en sus líneas (Plata, Rodio, Acero, Cover Gold) DESDE EL PANEL, en pantalla (jsdom + Testing Library):
 *   - el formulario del producto: el selector «Línea de la tienda» escribe la línea en el campo Material y dice dónde aparecerá la pieza;
 *   - la lista del catálogo: cada fila dice su línea y la cambia ahí mismo (sin abrir el producto), con el filtro «Sin línea» para ir vaciando lo pendiente;
 *   - de punta a punta: la página REAL del catálogo → el cliente del navegador → las rutas REALES (sesión, rol, validación, servicio) → una base en memoria. Lo que se ve es lo que se guarda.
 * Un negocio sin líneas ve el panel exactamente como siempre.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Session } from "@supabase/supabase-js";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextRequest } from "next/server";
import { createCatalogClient } from "@/lib/catalogo-client";
import type { CatalogProduct } from "@/lib/catalogo/domain";
import { diffProductForm, emptyProductForm, type ProductFormState } from "@/lib/catalogo/form";
import { lineasDeLaTienda } from "@/lib/catalogo/joyeria";
import { DashboardContext, type DashboardContextValue } from "@/lib/dashboard-session";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { CatalogToastProvider } from "@/components/dashboard/catalogo/ui";
import { ProductFields } from "@/components/dashboard/catalogo/ProductFields";
import { ProductList, type ClasificacionDeLista } from "@/components/dashboard/catalogo/ProductList";
import { useLineasDelNegocio } from "@/components/dashboard/catalogo/use-lineas";
import CatalogoPage from "@/app/dashboard/catalogo/page";
import { GET as productosGET } from "@/app/api/dashboard/catalogo/productos/route";
import { GET as productoGET, PATCH as productoPATCH } from "@/app/api/dashboard/catalogo/productos/[id]/route";
import { GET as publicacionGET } from "@/app/api/dashboard/catalogo/publicacion/route";
import { GET as categoriasGET } from "@/app/api/dashboard/catalogo/categorias/route";

configure({ asyncUtilTimeout: 6000 });

/** Las líneas tal como las tiene Delacour en su configuración. */
const LINEAS = lineasDeLaTienda("delacour");

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// El formulario del producto
// ---------------------------------------------------------------------------

/** `lineas` omitido = las de Delacour; `null` = el formulario de un negocio sin lista de líneas. */
function Formulario({ inicial = "", lineas = LINEAS, disabled = false, alCambiar }: { inicial?: string; lineas?: typeof LINEAS | null; disabled?: boolean; alCambiar?: (f: ProductFormState) => void }) {
  const [form, setForm] = useState<ProductFormState>({ ...emptyProductForm(), name: "Anillo sol", material: inicial });
  return (
    <ProductFields
      value={form}
      onChange={(v) => {
        setForm(v);
        alCambiar?.(v);
      }}
      errors={{}}
      categories={[]}
      onCategoryCreated={() => {}}
      client={null}
      disabled={disabled}
      lineas={lineas ?? undefined}
    />
  );
}

const grupo = () => screen.getByRole("radiogroup", { name: "Línea de la tienda" });
const radio = (nombre: string) => within(grupo()).getByRole("radio", { name: nombre }) as HTMLButtonElement;
const material = () => screen.getByLabelText("Material") as HTMLInputElement;
const estado = () => grupo().querySelector("[data-estado-linea]")!.textContent;

describe("el formulario del producto: «Línea de la tienda»", () => {
  it("ofrece las cuatro líneas en el orden de la clienta y, sin material, avisa que la pieza no está en ninguna", () => {
    render(<Formulario />);
    assert.deepEqual(within(grupo()).getAllByRole("radio").map((r) => r.textContent), ["Plata", "Rodio", "Acero", "Cover Gold"]);
    for (const r of within(grupo()).getAllByRole("radio")) assert.equal(r.getAttribute("aria-checked"), "false");
    assert.match(estado()!, /^Sin línea: en la tienda esta pieza no aparece dentro de ninguna línea\.$/);
    assert.equal(material().value, "");
  });

  it("al elegir una línea escribe su nombre en el campo Material, la marca y dice dónde aparecerá la pieza", async () => {
    const usuario = userEvent.setup();
    render(<Formulario />);
    await usuario.click(radio("Plata"));
    assert.equal(material().value, "Plata");
    assert.equal(radio("Plata").getAttribute("aria-checked"), "true");
    assert.equal(radio("Rodio").getAttribute("aria-checked"), "false");
    assert.equal(estado(), "En la tienda aparece en la línea Plata.");
  });

  it("con el material de otra línea cambia solo esa palabra: «Rodio · 3cm» pasa a «Plata · 3cm» y conserva la medida", async () => {
    const usuario = userEvent.setup();
    render(<Formulario inicial="Rodio · 3cm" />);
    assert.equal(radio("Rodio").getAttribute("aria-checked"), "true", "ya está en Rodio");
    assert.equal(estado(), "En la tienda aparece en la línea Rodio.");
    await usuario.click(radio("Plata"));
    assert.equal(material().value, "Plata · 3cm");
    assert.equal(radio("Plata").getAttribute("aria-checked"), "true");
    assert.equal(radio("Rodio").getAttribute("aria-checked"), "false");
  });

  it("con un material que no es de ninguna línea lo conserva: «Oro laminado 18k» pasa a «Cover Gold · Oro laminado 18k»", async () => {
    const usuario = userEvent.setup();
    render(<Formulario inicial="Oro laminado 18k" />);
    assert.match(estado()!, /^Sin línea/);
    await usuario.click(radio("Cover Gold"));
    assert.equal(material().value, "Cover Gold · Oro laminado 18k");
    assert.equal(estado(), "En la tienda aparece en la línea Cover Gold.");
  });

  it("elegir la línea en la que ya está no cambia nada (ni el texto ni el aviso de cambios)", async () => {
    const usuario = userEvent.setup();
    const cambios: ProductFormState[] = [];
    render(<Formulario inicial="Plata 925" alCambiar={(f) => cambios.push(f)} />);
    await usuario.click(radio("Plata"));
    assert.equal(material().value, "Plata 925");
    assert.ok(cambios.every((f) => f.material === "Plata 925"), "el texto sigue igual");
  });

  it("si el Material se escribe a mano, el selector lo refleja al instante", async () => {
    const usuario = userEvent.setup();
    render(<Formulario />);
    await usuario.type(material(), "acero quirúrgico");
    assert.equal(radio("Acero").getAttribute("aria-checked"), "true");
    assert.equal(estado(), "En la tienda aparece en la línea Acero.");
    await usuario.clear(material());
    assert.equal(radio("Acero").getAttribute("aria-checked"), "false");
    assert.match(estado()!, /^Sin línea/);
  });

  it("una pieza en dos líneas marca las dos y lo dice", () => {
    render(<Formulario inicial="Acero y Rodio" />);
    assert.equal(radio("Rodio").getAttribute("aria-checked"), "true");
    assert.equal(radio("Acero").getAttribute("aria-checked"), "true");
    assert.equal(estado(), "En la tienda aparece en las líneas Rodio y Acero.");
  });

  it("lo que se guarda es el Material: el cambio del formulario trae `material` y nada más", async () => {
    const usuario = userEvent.setup();
    const original = { ...emptyProductForm(), name: "Anillo sol", material: "" };
    let ultimo = original;
    render(<Formulario alCambiar={(f) => void (ultimo = f)} />);
    await usuario.click(radio("Rodio"));
    assert.deepEqual(diffProductForm(original, ultimo), { material: "Rodio" });
  });

  it("sin permiso de edición (formulario deshabilitado) las líneas se ven pero no se pueden cambiar", () => {
    render(<Formulario inicial="Rodio" disabled />);
    for (const r of within(grupo()).getAllByRole("radio")) assert.equal((r as HTMLButtonElement).disabled, true);
    assert.equal(radio("Rodio").getAttribute("aria-checked"), "true");
  });

  it("un negocio sin líneas (sin la lista o con la lista vacía) ve el formulario de siempre: sin selector", () => {
    for (const lineas of [null, []]) {
      const { unmount } = render(<Formulario lineas={lineas} />);
      assert.ok(screen.queryByRole("radiogroup") === null, "no debe haber selector de línea");
      assert.ok(material(), "el campo Material sigue ahí");
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// La lista del catálogo
// ---------------------------------------------------------------------------

const unProducto = (n: number, name: string, material: string | null, over: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  reference: `DL-00000${n}`,
  name,
  description: null,
  categoryId: null,
  categoryName: "Anillos",
  material,
  color: null,
  pricing: { retail: 15_000, wholesale: null },
  status: "ACTIVE",
  tracksStock: true,
  stock: 5,
  primaryImage: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});
const PRODUCTOS = [unProducto(1, "Anillo rodio", "Rodio · 3cm"), unProducto(2, "Anillo sin material", null), unProducto(3, "Dije dos líneas", "Acero y Rodio"), unProducto(4, "Arete plateado", "Plateado")];

function conClasificacion(over: Partial<ClasificacionDeLista> = {}): { clasificacion: ClasificacionDeLista; asignadas: Array<[string, string]> } {
  const asignadas: Array<[string, string]> = [];
  return { asignadas, clasificacion: { lineas: LINEAS, puedeAsignar: true, asignando: new Map(), onAsignar: (p, clave) => void asignadas.push([p.name, clave]), ...over } };
}
const selector = (nombre: string) => screen.getByRole("combobox", { name: `Línea de ${nombre}` }) as HTMLSelectElement;

describe("la lista del catálogo: la línea de cada pieza", () => {
  it("sin clasificación la lista es la de siempre: cada fila es UN enlace al producto y no hay selectores", () => {
    const { container } = render(<ProductList products={PRODUCTOS} />);
    assert.equal(screen.queryAllByRole("combobox").length, 0);
    const filas = within(screen.getByRole("list")).getAllByRole("listitem");
    assert.equal(filas.length, 4);
    for (const [i, fila] of filas.entries()) {
      const enlaces = within(fila).getAllByRole("link");
      assert.equal(enlaces.length, 1);
      assert.equal(enlaces[0].getAttribute("href"), `/dashboard/catalogo/${PRODUCTOS[i].id}`);
      assert.ok(enlaces[0].textContent!.includes(PRODUCTOS[i].name), "el nombre va DENTRO del enlace");
    }
    assert.ok(!container.textContent!.includes("Sin línea"));
  });

  it("con una lista de líneas VACÍA tampoco cambia nada (negocios sin líneas)", () => {
    render(<ProductList products={PRODUCTOS} clasificacion={conClasificacion({ lineas: [] }).clasificacion} />);
    assert.equal(screen.queryAllByRole("combobox").length, 0);
    assert.equal(within(screen.getByRole("list")).getAllByRole("link").length, 4);
  });

  it("quien puede editar ve un selector por fila con la línea de la pieza; las que no tienen línea piden elegir", () => {
    render(<ProductList products={PRODUCTOS} {...conClasificacion()} />);
    assert.equal(selector("Anillo rodio").value, "rodio");
    assert.equal(selector("Anillo sin material").value, "");
    assert.equal(selector("Arete plateado").value, "", "«Plateado» es un color: sigue sin línea");
    const pendiente = selector("Anillo sin material");
    assert.deepEqual([...pendiente.options].map((o) => o.textContent), ["Sin línea · elegir…", "Plata", "Rodio", "Acero", "Cover Gold"]);
    assert.deepEqual([...selector("Anillo rodio").options].map((o) => o.textContent), ["Plata", "Rodio", "Acero", "Cover Gold"], "una pieza ya clasificada no ofrece «sin línea»");
  });

  it("elegir una línea en el selector avisa con la pieza y la línea (la página la guarda)", async () => {
    const usuario = userEvent.setup();
    const { clasificacion, asignadas } = conClasificacion();
    render(<ProductList products={PRODUCTOS} clasificacion={clasificacion} />);
    await usuario.selectOptions(selector("Anillo sin material"), "plata");
    await usuario.selectOptions(selector("Anillo rodio"), "cover-gold");
    assert.deepEqual(asignadas, [["Anillo sin material", "plata"], ["Anillo rodio", "cover-gold"]]);
  });

  it("el enlace al producto sigue cubriendo la fila (por detrás) y el selector NO queda dentro de un enlace", () => {
    render(<ProductList products={PRODUCTOS} {...conClasificacion()} />);
    const fila = selector("Anillo rodio").closest("li")!;
    const enlace = within(fila).getByRole("link", { name: "Abrir Anillo rodio" });
    assert.equal(enlace.getAttribute("href"), `/dashboard/catalogo/${PRODUCTOS[0].id}`);
    assert.ok(selector("Anillo rodio").closest("a") === null, "un control dentro de un enlace no es HTML válido ni accesible");
    assert.ok(enlace.className.includes("absolute") && enlace.className.includes("inset-0"), "el enlace cubre toda la fila");
    assert.ok(selector("Anillo rodio").className.includes("z-10"), "el selector queda POR ENCIMA del enlace que cubre la fila");
  });

  it("sin permiso de edición solo se ve el nombre de la línea (o «Sin línea»), sin selectores", () => {
    render(<ProductList products={PRODUCTOS} {...conClasificacion({ puedeAsignar: false })} />);
    assert.equal(screen.queryAllByRole("combobox").length, 0);
    const lineas = [...document.querySelectorAll("[data-linea-pieza]")].map((e) => e.textContent);
    assert.deepEqual(lineas, ["Rodio", "Sin línea", "Rodio · Acero", "Sin línea"]);
  });

  it("una pieza en dos líneas solo muestra sus nombres (se ajusta en el producto)", () => {
    render(<ProductList products={PRODUCTOS} {...conClasificacion()} />);
    assert.ok(screen.queryByRole("combobox", { name: "Línea de Dije dos líneas" }) === null);
    assert.ok(within(screen.getByRole("link", { name: "Abrir Dije dos líneas" }).closest("li")!).getByText("Rodio · Acero"));
  });

  it("mientras se guarda, el selector queda en pausa y muestra la línea elegida", () => {
    render(<ProductList products={PRODUCTOS} {...conClasificacion({ asignando: new Map([[PRODUCTOS[1].id, "acero"]]) })} />);
    const guardando = selector("Anillo sin material");
    assert.equal(guardando.value, "acero");
    assert.equal(guardando.disabled, true);
    assert.equal(guardando.getAttribute("aria-busy"), "true");
    assert.equal(selector("Anillo rodio").disabled, false, "las demás filas siguen disponibles");
  });
});

// ---------------------------------------------------------------------------
// De punta a punta: la página REAL del catálogo con las rutas REALES
// ---------------------------------------------------------------------------

const T1 = "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4";
const U_ADMIN = "11111111-1111-4111-8111-111111111111";
const U_LECTURA = "22222222-2222-4222-8222-222222222222";
const ANILLOS = "c0000000-0000-4000-8000-0000000000a1";
const ARETES = "c0000000-0000-4000-8000-0000000000a2";
const PREFIJO = "/api/dashboard/catalogo";

let db: SupabaseMemoria;
let puente: { llamadas: Array<{ metodo: string; ruta: string; cuerpo?: string }>; restaurar: () => void };

/** Lleva las llamadas del cliente del navegador (rutas relativas) a los handlers REALES del catálogo: sesión, rol, validación, servicio y la base en memoria. */
function instalarPuente() {
  const base = globalThis.fetch;
  const llamadas: Array<{ metodo: string; ruta: string; cuerpo?: string }> = [];
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url, "http://localhost");
    if (!url.pathname.startsWith(PREFIJO)) return base(entrada, init);
    const metodo = (init?.method ?? "GET").toUpperCase();
    const ruta = url.pathname.slice(PREFIJO.length);
    const cuerpo = typeof init?.body === "string" ? init.body : undefined;
    llamadas.push({ metodo, ruta: `${ruta}${url.search}`, cuerpo });
    const request = new NextRequest(url, { method: metodo, headers: init?.headers as HeadersInit | undefined, body: cuerpo });
    if (ruta === "/productos" && metodo === "GET") return productosGET(request);
    const uno = /^\/productos\/([^/]+)$/.exec(ruta);
    if (uno) {
      const contexto = { params: Promise.resolve({ id: uno[1] }) };
      return metodo === "PATCH" ? productoPATCH(request, contexto) : productoGET(request, contexto);
    }
    if (ruta === "/publicacion") return publicacionGET(request);
    if (ruta === "/categorias") return categoriasGET(request);
    return Response.json({ success: false, error: { code: "NOT_FOUND", message: "Ruta desconocida." } }, { status: 404 });
  }) as typeof fetch;
  return { llamadas, restaurar: () => void (globalThis.fetch = base) };
}

function fila(n: number, nombre: string, material: string | null, categoriaId: string, categoria: string, extra: Record<string, unknown> = {}) {
  return {
    id: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    id_tenant: T1,
    referencia: `DL-00000${n}`,
    nombre,
    descripcion: null,
    precio: 15_000 + n,
    precio_mayor: null,
    material,
    color: null,
    categoria,
    categoria_id: categoriaId,
    activo: true,
    controla_stock: true,
    stock: 5,
    foto_url: null,
    created_at: `2026-10-0${n}T10:00:00.000Z`,
    updated_at: `2026-10-0${n}T10:00:00.000Z`,
    updated_by: null,
    escritura_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    ...extra,
  };
}
const idDe = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const enBase = (n: number) => db.rows("dulabs_inventario_productos").find((p) => p.id === idDe(n))!;

function sembrar(slug: string) {
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  db.user("t-admin", U_ADMIN);
  db.user("t-lectura", U_LECTURA);
  db.table("dulabs_miembros_equipo").push(
    { id: 1, tenant_id: T1, user_id: U_ADMIN, rol: "admin", estado: "activo" },
    { id: 2, tenant_id: T1, user_id: U_LECTURA, rol: "lectura", estado: "activo" },
  );
  db.table("dulabs_tenant_modulos").push({ id_tenant: T1, modulo: "catalogo", habilitado: true });
  db.rpc("dulabs_rate_limit_incrementar", () => ({ data: [{ permitido: true, conteo: 1, reinicia_en: new Date(Date.now() + 60_000).toISOString() }] }));
  db.table("dulabs_catalogo_categorias").push({ id: ANILLOS, id_tenant: T1, nombre: "Anillos" }, { id: ARETES, id_tenant: T1, nombre: "Aretes" });
  db.table("dulabs_catalogo_media");
  db.table("dulabs_catalogo_publicacion").push({ id_tenant: T1, slug, nombre_publico: "Joyería de prueba", publicado: true, token_mayor: "a".repeat(64) });
  db.table("dulabs_inventario_productos").push(
    fila(1, "Anillo rodio", "Rodio · 3cm", ANILLOS, "Anillos"),
    fila(2, "Arete plata", "Plata 925", ARETES, "Aretes"),
    fila(3, "Anillo sin material", null, ANILLOS, "Anillos"),
    fila(4, "Arete plateado", "Plateado", ARETES, "Aretes"),
    fila(5, "Cadena sin material", null, ARETES, "Aretes"),
  );
  puente = instalarPuente();
}

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
const pedidosDeProductos = () => puente.llamadas.filter((l) => l.metodo === "GET" && l.ruta.startsWith("/productos?"));
const nombresEnLista = () => within(screen.getByRole("list")).queryAllByRole("listitem").map((li) => li.querySelector("a")?.getAttribute("aria-label")?.replace(/^Abrir /, "") ?? li.querySelector("a")?.textContent);
const esperarLista = async (esperados: string[]) => waitFor(() => assert.deepEqual(nombresEnLista().sort(), [...esperados].sort()));

describe("la página del catálogo de un negocio CON líneas (Delacour)", () => {
  beforeEach(() => sembrar("delacour"));
  afterEach(() => {
    puente.restaurar();
    db.uninstall();
  });

  it("muestra el filtro «Línea», la línea de cada pieza y un selector por fila", async () => {
    montar();
    const filtro = (await screen.findByRole("combobox", { name: "Filtrar por línea" })) as HTMLSelectElement;
    assert.deepEqual([...filtro.options].map((o) => o.textContent), ["Todas las líneas", "Sin línea", "Plata", "Rodio", "Acero", "Cover Gold"]);
    await waitFor(() => assert.equal(selector("Anillo rodio").value, "rodio"));
    assert.equal(selector("Arete plata").value, "plata");
    assert.equal(selector("Anillo sin material").value, "");
    assert.equal(selector("Arete plateado").value, "");
  });

  it("«Sin línea» muestra solo lo pendiente y el servidor recibe `linea=sin`", async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.selectOptions(await screen.findByRole("combobox", { name: "Filtrar por línea" }), "sin");
    await esperarLista(["Anillo sin material", "Arete plateado", "Cadena sin material"]);
    assert.ok(pedidosDeProductos().some((l) => new URLSearchParams(l.ruta.split("?")[1]).get("linea") === "sin"));
    assert.ok(await screen.findByText("3 productos"));
    await usuario.selectOptions(screen.getByRole("combobox", { name: "Filtrar por línea" }), "plata");
    await esperarLista(["Arete plata"]);
    await usuario.selectOptions(screen.getByRole("combobox", { name: "Filtrar por línea" }), "");
    await esperarLista(["Anillo rodio", "Arete plata", "Anillo sin material", "Arete plateado", "Cadena sin material"]);
    assert.ok(!pedidosDeProductos().at(-1)!.ruta.includes("linea="), "«Todas las líneas» no manda el filtro");
  });

  it("clasificar desde la fila GUARDA el material, avisa y, sin filtro, solo cambia esa fila (sin volver a pedir la lista)", async () => {
    const usuario = userEvent.setup();
    montar();
    await waitFor(() => assert.equal(selector("Anillo rodio").value, "rodio"));
    const antes = pedidosDeProductos().length;
    await usuario.selectOptions(selector("Anillo sin material"), "plata");
    await screen.findByText("«Anillo sin material» quedó en la línea Plata.");
    assert.equal(enBase(3).material, "Plata", "queda guardado en la base");
    await waitFor(() => assert.equal(selector("Anillo sin material").value, "plata"));
    assert.equal(pedidosDeProductos().length, antes, "sin filtro no se pide la lista otra vez");
    const patch = puente.llamadas.filter((l) => l.metodo === "PATCH");
    assert.deepEqual(patch.map((l) => [l.ruta, JSON.parse(l.cuerpo!)]), [[`/productos/${idDe(3)}`, { material: "Plata" }]], "solo se manda el material");

    // Una pieza de otra línea cambia solo esa palabra: «Rodio · 3cm» -> «Plata · 3cm».
    await usuario.selectOptions(selector("Anillo rodio"), "plata");
    await screen.findByText("«Anillo rodio» quedó en la línea Plata.");
    assert.equal(enBase(1).material, "Plata · 3cm");
  });

  it("con «Sin línea» puesto, clasificar vacía la lista de pendientes: la pieza sale, la página se pide de nuevo y al final avisa que no queda nada", async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.selectOptions(await screen.findByRole("combobox", { name: "Filtrar por línea" }), "sin");
    await esperarLista(["Anillo sin material", "Arete plateado", "Cadena sin material"]);

    await usuario.selectOptions(selector("Anillo sin material"), "rodio");
    await esperarLista(["Arete plateado", "Cadena sin material"]);
    assert.equal(enBase(3).material, "Rodio");
    assert.ok(await screen.findByText("2 productos"));

    await usuario.selectOptions(selector("Arete plateado"), "plata");
    await esperarLista(["Cadena sin material"]);
    assert.equal(enBase(4).material, "Plata · Plateado", "lo que la persona había escrito no se pierde");

    await usuario.selectOptions(selector("Cadena sin material"), "cover-gold");
    assert.ok(await screen.findByText("Todas tus piezas ya están en una línea"));
    assert.equal(enBase(5).material, "Cover Gold");
  });

  it("si no se puede guardar avisa el motivo y la fila queda como estaba", async () => {
    const usuario = userEvent.setup();
    montar();
    await waitFor(() => assert.equal(selector("Anillo sin material").value, ""));
    db.rows("dulabs_inventario_productos").splice(db.rows("dulabs_inventario_productos").findIndex((p) => p.id === idDe(3)), 1); // otra persona la borró
    await usuario.selectOptions(selector("Anillo sin material"), "plata");
    assert.ok(await screen.findByText("El producto no existe."));
    await waitFor(() => assert.equal(selector("Anillo sin material").value, ""));
    assert.equal(selector("Anillo sin material").disabled, false, "se puede volver a intentar");
  });

  it("quien solo puede leer ve la línea de cada pieza y puede filtrar, pero no cambiarla", async () => {
    montar("t-lectura", "lectura");
    await screen.findByRole("combobox", { name: "Filtrar por línea" });
    await waitFor(() => assert.ok(document.querySelector("[data-linea-pieza]")));
    assert.equal(screen.queryAllByRole("combobox", { name: /^Línea de / }).length, 0);
    assert.deepEqual([...document.querySelectorAll("[data-linea-pieza]")].map((e) => e.textContent).sort(), ["Plata", "Rodio", "Sin línea", "Sin línea", "Sin línea"]);
    assert.equal(puente.llamadas.filter((l) => l.metodo === "PATCH").length, 0);
  });

  it("«Limpiar filtros» también quita la línea", async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.selectOptions(await screen.findByRole("combobox", { name: "Filtrar por línea" }), "plata");
    await esperarLista(["Arete plata"]);
    await usuario.click(await screen.findByRole("button", { name: "Limpiar filtros" }));
    await waitFor(() => assert.equal((screen.getByRole("combobox", { name: "Filtrar por línea" }) as HTMLSelectElement).value, ""));
    await esperarLista(["Anillo rodio", "Arete plata", "Anillo sin material", "Arete plateado", "Cadena sin material"]);
  });
});

describe("la página del catálogo de un negocio SIN líneas", () => {
  beforeEach(() => sembrar("otra-joyeria"));
  afterEach(() => {
    puente.restaurar();
    db.uninstall();
  });

  it("es la de siempre: ni filtro de línea, ni selectores, ni «Sin línea», y nunca se manda `linea`", async () => {
    montar();
    await waitFor(() => assert.equal(nombresEnLista().length, 5));
    await waitFor(() => assert.ok(puente.llamadas.some((l) => l.ruta === "/publicacion")));
    await new Promise((resolver) => setTimeout(resolver, 50));
    assert.ok(screen.queryByRole("combobox", { name: "Filtrar por línea" }) === null, "sin líneas no hay filtro de línea");
    assert.equal(screen.queryAllByRole("combobox", { name: /^Línea de / }).length, 0);
    assert.ok(!document.body.textContent!.includes("Sin línea"));
    assert.ok(pedidosDeProductos().every((l) => !l.ruta.includes("linea=")));
    // Cada fila sigue siendo UN enlace al producto.
    for (const li of within(screen.getByRole("list")).getAllByRole("listitem")) assert.equal(within(li).getAllByRole("link").length, 1);
  });

  it("aunque alguien pida `?linea=` al servidor, el listado es el de siempre", async () => {
    const respuesta = await productosGET(new NextRequest("http://localhost/api/dashboard/catalogo/productos?linea=sin", { headers: { authorization: "Bearer t-admin" } }));
    const cuerpo = await respuesta.json();
    assert.equal(cuerpo.data.total, 5);
  });
});

// ---------------------------------------------------------------------------
// Las líneas del negocio y el cableado de los formularios
// ---------------------------------------------------------------------------

function Sonda({ token }: { token: string }) {
  const client = useMemo(() => createCatalogClient(token), [token]);
  const lineas = useLineasDelNegocio(client);
  return <p data-testid="lineas">{lineas.map((l) => l.etiqueta).join(",")}</p>;
}
const leerSonda = (token: string) => render(<Sonda token={token} />);

describe("useLineasDelNegocio", () => {
  afterEach(() => {
    puente?.restaurar();
    db?.uninstall();
  });

  it("devuelve las líneas de la tienda del negocio (Delacour: las cuatro, en orden)", async () => {
    sembrar("delacour");
    leerSonda("t-admin");
    await waitFor(() => assert.equal(screen.getByTestId("lineas").textContent, "Plata,Rodio,Acero,Cover Gold"));
  });

  it("un negocio sin líneas recibe una lista vacía", async () => {
    sembrar("otra-joyeria");
    leerSonda("t-admin");
    await waitFor(() => assert.ok(puente.llamadas.some((l) => l.ruta === "/publicacion")));
    await new Promise((resolver) => setTimeout(resolver, 50));
    assert.equal(screen.getByTestId("lineas").textContent, "");
  });

  it("si el negocio aún no tiene tienda publicada (quien solo lee) la lista queda vacía y nada se rompe", async () => {
    sembrar("delacour");
    db.rows("dulabs_catalogo_publicacion").length = 0;
    leerSonda("t-lectura");
    await waitFor(() => assert.ok(puente.llamadas.some((l) => l.ruta === "/publicacion")));
    await new Promise((resolver) => setTimeout(resolver, 50));
    assert.equal(screen.getByTestId("lineas").textContent, "");
  });

  it("si la consulta falla (error del servidor o sin red) la lista queda vacía y NO se rompe la pantalla", async (t) => {
    t.mock.method(console, "error", () => {});
    sembrar("delacour");
    db.missing("dulabs_catalogo_publicacion");
    leerSonda("t-admin");
    await waitFor(() => assert.ok(puente.llamadas.some((l) => l.ruta === "/publicacion")));
    await new Promise((resolver) => setTimeout(resolver, 50));
    assert.equal(screen.getByTestId("lineas").textContent, "");
    cleanup();
    const base = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    try {
      leerSonda("t-admin");
      await new Promise((resolver) => setTimeout(resolver, 50));
      assert.equal(screen.getByTestId("lineas").textContent, "");
    } finally {
      globalThis.fetch = base;
    }
  });
});

describe("el cableado de las pantallas del producto (la página del producto no se puede montar aquí: depende de la ruta)", () => {
  const leer = (ruta: string) => readFileSync(ruta, "utf8");

  it("editar y crear producto le pasan las líneas del negocio al formulario", () => {
    for (const ruta of ["app/dashboard/catalogo/[id]/page.tsx", "app/dashboard/catalogo/nuevo/page.tsx"]) {
      const fuente = leer(ruta);
      assert.ok(fuente.includes("useLineasDelNegocio(client)"), `${ruta}: debe leer las líneas del negocio`);
      assert.ok(/<ProductFields[\s\S]*?lineas=\{lineas\}[\s\S]*?\/>/.test(fuente), `${ruta}: debe pasarle lineas={lineas} al formulario`);
    }
  });

  it("la lista del catálogo manda la línea al servidor y le pasa la clasificación a la lista solo si el negocio tiene líneas", () => {
    const fuente = leer("app/dashboard/catalogo/page.tsx");
    assert.ok(fuente.includes("linea: linea || undefined"), "el filtro viaja al listado");
    assert.ok(fuente.includes("clasificacion={lineas.length > 0 ?"), "sin líneas no hay clasificación");
    assert.ok(fuente.includes("puedeAsignar: canWrite"), "solo quien puede editar cambia la línea");
  });
});

void fireEvent;
