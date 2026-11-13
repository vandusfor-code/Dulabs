import "@/lib/test-helpers/jsdom-setup";
/**
 * Marcar las piezas de Delacour como de HOMBRE (colección Vértice) o de MUJER DESDE EL PANEL, en pantalla (jsdom + Testing Library):
 *   - el formulario del producto: «Para» (Mujer | Hombre) con el aviso de en qué lado de la tienda aparecerá la pieza;
 *   - la lista del catálogo: cada fila dice para quién es y lo cambia ahí mismo, con el filtro «Para» para revisar un lado;
 *   - de punta a punta: la página REAL del catálogo → el cliente del navegador → las rutas REALES (sesión, rol, validación, servicio) → una base en memoria. Lo que se ve es lo que se guarda.
 * Un negocio que no separa Mujer y Hombre ve el panel exactamente como siempre.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Session } from "@supabase/supabase-js";
import { cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextRequest } from "next/server";
import { createCatalogClient } from "@/lib/catalogo-client";
import type { CatalogProduct, Genero } from "@/lib/catalogo/domain";
import { diffProductForm, emptyProductForm, productFormFrom, toProductDraft, type ProductFormState } from "@/lib/catalogo/form";
import { DashboardContext, type DashboardContextValue } from "@/lib/dashboard-session";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { CatalogToastProvider } from "@/components/dashboard/catalogo/ui";
import { ProductFields } from "@/components/dashboard/catalogo/ProductFields";
import { ProductList, type ClasificacionDeLista } from "@/components/dashboard/catalogo/ProductList";
import { useSeparaGenero } from "@/components/dashboard/catalogo/use-genero";
import CatalogoPage from "@/app/dashboard/catalogo/page";
import { GET as productosGET } from "@/app/api/dashboard/catalogo/productos/route";
import { GET as productoGET, PATCH as productoPATCH } from "@/app/api/dashboard/catalogo/productos/[id]/route";
import { GET as publicacionGET } from "@/app/api/dashboard/catalogo/publicacion/route";
import { GET as categoriasGET } from "@/app/api/dashboard/catalogo/categorias/route";

configure({ asyncUtilTimeout: 6000 });

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// El formulario del producto
// ---------------------------------------------------------------------------

/** `gender` omitido = el formulario de un negocio que NO separa Mujer y Hombre (el estado no trae «gender»). */
function Formulario({ gender, disabled = false, alCambiar }: { gender?: Genero; disabled?: boolean; alCambiar?: (f: ProductFormState) => void }) {
  const [form, setForm] = useState<ProductFormState>({ ...emptyProductForm(), name: "Dije ancla", ...(gender ? { gender } : {}) });
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
    />
  );
}

const grupoPara = () => screen.getByRole("radiogroup", { name: "Para" });
const lado = (nombre: string) => within(grupoPara()).getByRole("radio", { name: nombre }) as HTMLButtonElement;
const estadoPara = () => grupoPara().querySelector("[data-estado-genero]")!.textContent;

describe("el formulario del producto: «Para»", () => {
  it("ofrece Mujer y Hombre; una pieza de mujer lo dice y avisa que aparece en el lado de siempre", () => {
    render(<Formulario gender="mujer" />);
    assert.deepEqual(within(grupoPara()).getAllByRole("radio").map((r) => r.textContent), ["Mujer", "Hombre"]);
    assert.equal(lado("Mujer").getAttribute("aria-checked"), "true");
    assert.equal(lado("Hombre").getAttribute("aria-checked"), "false");
    assert.equal(estadoPara(), "En la tienda aparece en el lado de Mujer, como siempre.");
  });

  it("al elegir Hombre lo marca y dice que aparecerá en el lado de Hombre (Vértice); volver a Mujer lo desmarca", async () => {
    const usuario = userEvent.setup();
    render(<Formulario gender="mujer" />);
    await usuario.click(lado("Hombre"));
    assert.equal(lado("Hombre").getAttribute("aria-checked"), "true");
    assert.equal(lado("Mujer").getAttribute("aria-checked"), "false");
    assert.equal(estadoPara(), "En la tienda aparece en el lado de Hombre (Vértice).");
    await usuario.click(lado("Mujer"));
    assert.equal(lado("Mujer").getAttribute("aria-checked"), "true");
    assert.equal(estadoPara(), "En la tienda aparece en el lado de Mujer, como siempre.");
  });

  it("lo que se guarda es «gender» y nada más: el cambio del formulario trae `gender` y ninguno de los demás campos", async () => {
    const usuario = userEvent.setup();
    const original: ProductFormState = { ...emptyProductForm(), name: "Dije ancla", gender: "mujer" };
    let ultimo = original;
    render(<Formulario gender="mujer" alCambiar={(f) => void (ultimo = f)} />);
    await usuario.click(lado("Hombre"));
    assert.deepEqual(diffProductForm(original, ultimo), { gender: "hombre" });
  });

  it("sin permiso de edición (formulario deshabilitado) se ve el lado pero no se puede cambiar", () => {
    render(<Formulario gender="hombre" disabled />);
    for (const r of within(grupoPara()).getAllByRole("radio")) assert.equal((r as HTMLButtonElement).disabled, true);
    assert.equal(lado("Hombre").getAttribute("aria-checked"), "true");
  });

  it("un negocio que no separa Mujer y Hombre ve el formulario de siempre: sin «Para»", () => {
    render(<Formulario />);
    assert.ok(screen.queryByRole("radiogroup", { name: "Para" }) === null, "no debe haber selector «Para»");
    assert.ok(screen.getByLabelText("Material"), "el resto del formulario sigue ahí");
  });
});

describe("el formulario: lo que viaja al servidor", () => {
  const base = { ...emptyProductForm(), name: "Dije ancla", retailPrice: 48_000, stock: 15 };
  const pieza = (over: Partial<CatalogProduct> = {}): CatalogProduct => ({
    id: "a0000000-0000-4000-8000-000000000001",
    reference: "DL-000769",
    name: "Dije ancla",
    description: null,
    categoryId: null,
    categoryName: null,
    material: "Acero",
    color: null,
    pricing: { retail: 48_000, wholesale: null },
    status: "ACTIVE",
    tracksStock: true,
    stock: 15,
    primaryImage: null,
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
    ...over,
  });

  it("al crear: una pieza de HOMBRE manda `gender: hombre`; una de mujer (lo predeterminado) o un negocio sin separación NO mandan nada (se crea igual que siempre)", () => {
    assert.equal(toProductDraft({ ...base, gender: "hombre" }).gender, "hombre");
    assert.ok(!("gender" in toProductDraft({ ...base, gender: "mujer" })));
    assert.ok(!("gender" in toProductDraft(base)));
  });

  it("al editar: parte del lado que trae la pieza y solo manda el cambio; sin el dato (negocio sin separación) nunca manda «gender»", () => {
    const hombre = productFormFrom(pieza({ gender: "hombre" }));
    assert.equal(hombre.gender, "hombre");
    assert.deepEqual(diffProductForm(hombre, { ...hombre, gender: "mujer" }), { gender: "mujer" });
    assert.deepEqual(diffProductForm(hombre, { ...hombre }), {}, "sin cambios no manda nada");
    const sinDato = productFormFrom(pieza());
    assert.ok(!("gender" in sinDato));
    assert.deepEqual(diffProductForm(sinDato, { ...sinDato, name: "Otro nombre" }), { name: "Otro nombre" });
  });
});

// ---------------------------------------------------------------------------
// La lista del catálogo
// ---------------------------------------------------------------------------

const unProducto = (n: number, name: string, gender: Genero | undefined): CatalogProduct => ({
  id: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  reference: `DL-0007${60 + n}`,
  name,
  description: null,
  categoryId: null,
  categoryName: "Dijes",
  material: "Acero",
  color: null,
  pricing: { retail: 15_000, wholesale: null },
  status: "ACTIVE",
  tracksStock: true,
  stock: 15,
  primaryImage: null,
  createdAt: "2026-11-12T00:00:00.000Z",
  updatedAt: "2026-11-12T00:00:00.000Z",
  ...(gender ? { gender } : {}),
});
const PRODUCTOS = [unProducto(1, "Dije ancla", "hombre"), unProducto(2, "Dije luna", "mujer"), unProducto(3, "Dije sin dato", undefined)];

function conGenero(over: Partial<NonNullable<ClasificacionDeLista["genero"]>> = {}) {
  const asignadas: Array<[string, Genero]> = [];
  const clasificacion: ClasificacionDeLista = {
    lineas: [],
    puedeAsignar: false,
    asignando: new Map(),
    onAsignar: () => {},
    genero: { puedeAsignar: true, asignando: new Map(), onAsignar: (p, g) => void asignadas.push([p.name, g]), ...over },
  };
  return { clasificacion, asignadas };
}
const selectorPara = (nombre: string) => screen.getByRole("combobox", { name: `Para quién es ${nombre}` }) as HTMLSelectElement;

describe("la lista del catálogo: para quién es cada pieza", () => {
  it("sin la separación la lista es la de siempre: sin selectores y cada fila es UN enlace al producto", () => {
    render(<ProductList products={PRODUCTOS} />);
    assert.equal(screen.queryAllByRole("combobox").length, 0);
    assert.ok(!document.body.textContent!.includes("Para Hombre"));
    for (const li of within(screen.getByRole("list")).getAllByRole("listitem")) assert.equal(within(li).getAllByRole("link").length, 1);
  });

  it("quien puede editar ve un selector por fila con el lado de la pieza; una pieza sin dato cuenta como de mujer", () => {
    render(<ProductList products={PRODUCTOS} clasificacion={conGenero().clasificacion} />);
    assert.equal(selectorPara("Dije ancla").value, "hombre");
    assert.equal(selectorPara("Dije luna").value, "mujer");
    assert.equal(selectorPara("Dije sin dato").value, "mujer");
    assert.deepEqual([...selectorPara("Dije ancla").options].map((o) => o.textContent), ["Para Mujer", "Para Hombre"]);
    assert.equal(screen.queryAllByRole("combobox", { name: /^Línea de / }).length, 0, "sin líneas no hay selector de línea");
  });

  it("elegir el otro lado avisa con la pieza y el lado (la página lo guarda); elegir el mismo no hace nada", async () => {
    const usuario = userEvent.setup();
    const { clasificacion, asignadas } = conGenero();
    render(<ProductList products={PRODUCTOS} clasificacion={clasificacion} />);
    await usuario.selectOptions(selectorPara("Dije luna"), "hombre");
    await usuario.selectOptions(selectorPara("Dije ancla"), "mujer");
    assert.deepEqual(asignadas, [["Dije luna", "hombre"], ["Dije ancla", "mujer"]]);
  });

  it("el enlace al producto sigue cubriendo la fila (por detrás) y el selector NO queda dentro de un enlace", () => {
    render(<ProductList products={PRODUCTOS} clasificacion={conGenero().clasificacion} />);
    const fila = selectorPara("Dije ancla").closest("li")!;
    const enlace = within(fila).getByRole("link", { name: "Abrir Dije ancla" });
    assert.equal(enlace.getAttribute("href"), `/dashboard/catalogo/${PRODUCTOS[0].id}`);
    assert.ok(selectorPara("Dije ancla").closest("a") === null, "un control dentro de un enlace no es HTML válido ni accesible");
    assert.ok(selectorPara("Dije ancla").className.includes("z-10"), "el selector queda POR ENCIMA del enlace que cubre la fila");
  });

  it("sin permiso de edición solo se ve para quién es (sin selectores)", () => {
    render(<ProductList products={PRODUCTOS} clasificacion={conGenero({ puedeAsignar: false }).clasificacion} />);
    assert.equal(screen.queryAllByRole("combobox").length, 0);
    const etiquetas = [...document.querySelectorAll("[data-genero-pieza]")].map((e) => [e.getAttribute("data-genero-pieza"), e.textContent]);
    assert.deepEqual(etiquetas, [["hombre", "Para Hombre"], ["mujer", "Para Mujer"], ["mujer", "Para Mujer"]]);
  });

  it("mientras se guarda, el selector queda en pausa y muestra el lado elegido; las demás filas siguen disponibles", () => {
    render(<ProductList products={PRODUCTOS} clasificacion={conGenero({ asignando: new Map<string, Genero>([[PRODUCTOS[1].id, "hombre"]]) }).clasificacion} />);
    const guardando = selectorPara("Dije luna");
    assert.equal(guardando.value, "hombre");
    assert.equal(guardando.disabled, true);
    assert.equal(guardando.getAttribute("aria-busy"), "true");
    assert.equal(selectorPara("Dije ancla").disabled, false);
  });
});

// ---------------------------------------------------------------------------
// De punta a punta: la página REAL del catálogo con las rutas REALES
// ---------------------------------------------------------------------------

const T1 = "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4";
const U_ADMIN = "11111111-1111-4111-8111-111111111111";
const U_LECTURA = "22222222-2222-4222-8222-222222222222";
const ESCRITURA_ORIGINAL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DIJES = "c0000000-0000-4000-8000-0000000000a1";
const ANILLOS = "c0000000-0000-4000-8000-0000000000a2";
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

/** Una pieza como la deja la base: la columna `genero` ya existe y vale «mujer» salvo que se haya marcado (es el valor por defecto de la migración). */
function fila(n: number, nombre: string, material: string | null, categoriaId: string, categoria: string, genero: Genero) {
  return {
    id: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    id_tenant: T1,
    referencia: `DL-0007${60 + n}`,
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
    stock: 15,
    foto_url: null,
    genero,
    created_at: `2026-11-0${n}T10:00:00.000Z`,
    updated_at: `2026-11-0${n}T10:00:00.000Z`,
    updated_by: null,
    escritura_id: ESCRITURA_ORIGINAL,
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
  db.table("dulabs_catalogo_categorias").push({ id: DIJES, id_tenant: T1, nombre: "Dijes" }, { id: ANILLOS, id_tenant: T1, nombre: "Anillos" });
  db.table("dulabs_catalogo_media");
  db.table("dulabs_catalogo_publicacion").push({ id_tenant: T1, slug, nombre_publico: "Joyería de prueba", publicado: true, token_mayor: "a".repeat(64) });
  db.table("dulabs_inventario_productos").push(
    fila(1, "Dije ancla de acero", "Acero", DIJES, "Dijes", "hombre"),
    fila(2, "Dije brújula de acero", "Acero", DIJES, "Dijes", "hombre"),
    fila(3, "Anillo rodio", "Rodio · 3cm", ANILLOS, "Anillos", "mujer"),
    fila(4, "Arete plata", "Plata 925", ANILLOS, "Anillos", "mujer"),
    fila(5, "Cadena sin material", null, ANILLOS, "Anillos", "mujer"),
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
const parametro = (ruta: string, nombre: string) => new URLSearchParams(ruta.split("?")[1]).get(nombre);
const nombresEnLista = () => within(screen.getByRole("list")).queryAllByRole("listitem").map((li) => li.querySelector("a")?.getAttribute("aria-label")?.replace(/^Abrir /, "") ?? li.querySelector("a")?.textContent);
const esperarLista = async (esperados: string[]) => waitFor(() => assert.deepEqual(nombresEnLista().sort(), [...esperados].sort()));
const filtroPara = () => screen.findByRole("combobox", { name: "Filtrar por para quién es" }) as Promise<HTMLSelectElement>;
const TODAS = ["Dije ancla de acero", "Dije brújula de acero", "Anillo rodio", "Arete plata", "Cadena sin material"];

describe("la página del catálogo de un negocio que SEPARA Mujer y Hombre (Delacour)", () => {
  beforeEach(() => sembrar("delacour"));
  afterEach(() => {
    puente.restaurar();
    db.uninstall();
  });

  it("muestra el filtro «Para» y, en cada fila, para quién es la pieza (las de Vértice en Hombre, las demás en Mujer)", async () => {
    montar();
    const filtro = await filtroPara();
    assert.deepEqual([...filtro.options].map((o) => o.textContent), ["Para: todos", "Para Mujer", "Para Hombre"]);
    await waitFor(() => assert.equal(selectorPara("Dije ancla de acero").value, "hombre"));
    assert.equal(selectorPara("Dije brújula de acero").value, "hombre");
    assert.equal(selectorPara("Anillo rodio").value, "mujer");
    assert.equal(selectorPara("Arete plata").value, "mujer");
    assert.equal(selectorPara("Cadena sin material").value, "mujer");
    await esperarLista(TODAS);
  });

  it("el filtro «Para Hombre» muestra solo la colección de hombre y el servidor recibe `genero=hombre`; «Para Mujer» el resto; «Para: todos» no manda el filtro", async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.selectOptions(await filtroPara(), "hombre");
    await esperarLista(["Dije ancla de acero", "Dije brújula de acero"]);
    assert.ok(pedidosDeProductos().some((l) => parametro(l.ruta, "genero") === "hombre"));
    assert.ok(await screen.findByText("2 productos"));
    await usuario.selectOptions(screen.getByRole("combobox", { name: "Filtrar por para quién es" }), "mujer");
    await esperarLista(["Anillo rodio", "Arete plata", "Cadena sin material"]);
    assert.ok(pedidosDeProductos().some((l) => parametro(l.ruta, "genero") === "mujer"));
    await usuario.selectOptions(screen.getByRole("combobox", { name: "Filtrar por para quién es" }), "");
    await esperarLista(TODAS);
    assert.ok(!pedidosDeProductos().at(-1)!.ruta.includes("genero="), "«Para: todos» no manda el filtro");
  });

  it("pasar una pieza a Hombre desde la fila GUARDA el lado (y solo eso), avisa y, sin filtro, solo cambia esa fila (sin volver a pedir la lista)", async () => {
    const usuario = userEvent.setup();
    montar();
    await waitFor(() => assert.equal(selectorPara("Anillo rodio").value, "mujer"));
    const antes = pedidosDeProductos().length;
    const copia = { ...enBase(3) };
    await usuario.selectOptions(selectorPara("Anillo rodio"), "hombre");
    await screen.findByText("«Anillo rodio» quedó para Hombre.");
    assert.equal(enBase(3).genero, "hombre", "queda guardado en la base");
    await waitFor(() => assert.equal(selectorPara("Anillo rodio").value, "hombre"));
    assert.equal(pedidosDeProductos().length, antes, "sin filtro no se pide la lista otra vez");
    const patch = puente.llamadas.filter((l) => l.metodo === "PATCH");
    assert.deepEqual(patch.map((l) => [l.ruta, JSON.parse(l.cuerpo!)]), [[`/productos/${idDe(3)}`, { gender: "hombre" }]], "solo se manda el lado");
    // lo demás de la pieza queda EXACTAMENTE igual (nombre, precio, material, stock…) y la auditoría atribuye el cambio a quien lo hizo
    for (const campo of ["nombre", "precio", "precio_mayor", "material", "color", "categoria_id", "stock", "activo", "referencia"] as const) assert.deepEqual(enBase(3)[campo], copia[campo], campo);
    assert.equal(enBase(3).updated_by, U_ADMIN);
    assert.notEqual(enBase(3).escritura_id, ESCRITURA_ORIGINAL, "la escritura se renueva para la auditoría");
    // y de vuelta a Mujer
    await usuario.selectOptions(selectorPara("Anillo rodio"), "mujer");
    await screen.findByText("«Anillo rodio» quedó para Mujer.");
    assert.equal(enBase(3).genero, "mujer");
  });

  it("con «Para Mujer» puesto, pasar una pieza a Hombre la saca de esa lista: la página se pide de nuevo y el conteo baja", async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.selectOptions(await filtroPara(), "mujer");
    await esperarLista(["Anillo rodio", "Arete plata", "Cadena sin material"]);
    await usuario.selectOptions(selectorPara("Arete plata"), "hombre");
    await esperarLista(["Anillo rodio", "Cadena sin material"]);
    assert.equal(enBase(4).genero, "hombre");
    assert.ok(await screen.findByText("2 productos"));
    // y aparece en la lista de Hombre
    await usuario.selectOptions(screen.getByRole("combobox", { name: "Filtrar por para quién es" }), "hombre");
    await esperarLista(["Dije ancla de acero", "Dije brújula de acero", "Arete plata"]);
  });

  it("si no se puede guardar avisa el motivo y la fila queda como estaba (se puede volver a intentar)", async () => {
    const usuario = userEvent.setup();
    montar();
    await waitFor(() => assert.equal(selectorPara("Cadena sin material").value, "mujer"));
    db.rows("dulabs_inventario_productos").splice(db.rows("dulabs_inventario_productos").findIndex((p) => p.id === idDe(5)), 1); // otra persona la borró
    await usuario.selectOptions(selectorPara("Cadena sin material"), "hombre");
    assert.ok(await screen.findByText("El producto no existe."));
    await waitFor(() => assert.equal(selectorPara("Cadena sin material").value, "mujer"));
    assert.equal(selectorPara("Cadena sin material").disabled, false);
  });

  it("quien solo puede leer ve para quién es cada pieza y puede filtrar, pero no cambiarlo", async () => {
    montar("t-lectura", "lectura");
    await filtroPara();
    await waitFor(() => assert.ok(document.querySelector("[data-genero-pieza]")));
    assert.equal(screen.queryAllByRole("combobox", { name: /^Para quién es / }).length, 0);
    assert.deepEqual([...document.querySelectorAll("[data-genero-pieza]")].map((e) => e.getAttribute("data-genero-pieza")).sort(), ["hombre", "hombre", "mujer", "mujer", "mujer"]);
    assert.equal(puente.llamadas.filter((l) => l.metodo === "PATCH").length, 0);
  });

  it("«Limpiar filtros» también quita el filtro «Para»", async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.selectOptions(await filtroPara(), "hombre");
    await esperarLista(["Dije ancla de acero", "Dije brújula de acero"]);
    await usuario.click(await screen.findByRole("button", { name: "Limpiar filtros" }));
    await waitFor(() => assert.equal((screen.getByRole("combobox", { name: "Filtrar por para quién es" }) as HTMLSelectElement).value, ""));
    await esperarLista(TODAS);
  });

  it("también se puede marcar desde el producto: el PATCH con `gender` solo cambia el lado y devuelve la pieza con su lado", async () => {
    const respuesta = await productoPATCH(
      new NextRequest(`http://localhost/api/dashboard/catalogo/productos/${idDe(3)}`, { method: "PATCH", headers: { authorization: "Bearer t-admin", "content-type": "application/json" }, body: JSON.stringify({ gender: "hombre" }) }),
      { params: Promise.resolve({ id: idDe(3) }) },
    );
    const cuerpo = await respuesta.json();
    assert.equal(cuerpo.success, true);
    assert.equal(cuerpo.data.product.gender, "hombre");
    assert.equal(enBase(3).genero, "hombre");
    assert.equal(enBase(3).nombre, "Anillo rodio");
  });

  it("quien solo puede leer NO puede marcar el lado por la API (el servidor lo exige, no solo la pantalla)", async () => {
    const respuesta = await productoPATCH(
      new NextRequest(`http://localhost/api/dashboard/catalogo/productos/${idDe(3)}`, { method: "PATCH", headers: { authorization: "Bearer t-lectura", "content-type": "application/json" }, body: JSON.stringify({ gender: "hombre" }) }),
      { params: Promise.resolve({ id: idDe(3) }) },
    );
    assert.ok(respuesta.status >= 400 && respuesta.status < 500, `estado ${respuesta.status}`);
    assert.equal((await respuesta.json()).success, false);
    assert.equal(enBase(3).genero, "mujer");
  });

  it("un valor que no es Mujer ni Hombre se rechaza con un mensaje claro y no toca la pieza", async () => {
    const respuesta = await productoPATCH(
      new NextRequest(`http://localhost/api/dashboard/catalogo/productos/${idDe(3)}`, { method: "PATCH", headers: { authorization: "Bearer t-admin", "content-type": "application/json" }, body: JSON.stringify({ gender: "otro" }) }),
      { params: Promise.resolve({ id: idDe(3) }) },
    );
    assert.equal(respuesta.status, 400);
    const cuerpo = await respuesta.json();
    assert.equal(cuerpo.success, false);
    assert.match(JSON.stringify(cuerpo.error), /Mujer u Hombre/);
    assert.equal(enBase(3).genero, "mujer");
  });
});

describe("la página del catálogo de un negocio que NO separa Mujer y Hombre", () => {
  beforeEach(() => sembrar("otra-joyeria"));
  afterEach(() => {
    puente.restaurar();
    db.uninstall();
  });

  it("es la de siempre: ni filtro «Para», ni selectores por fila, y nunca se manda `genero`", async () => {
    montar();
    await waitFor(() => assert.equal(nombresEnLista().length, 5));
    await waitFor(() => assert.ok(puente.llamadas.some((l) => l.ruta === "/publicacion")));
    await new Promise((resolver) => setTimeout(resolver, 50));
    assert.ok(screen.queryByRole("combobox", { name: "Filtrar por para quién es" }) === null, "sin separación no hay filtro «Para»");
    assert.equal(screen.queryAllByRole("combobox", { name: /^Para quién es / }).length, 0);
    assert.ok(!document.body.textContent!.includes("Para Hombre"));
    assert.ok(pedidosDeProductos().every((l) => !l.ruta.includes("genero=")));
    for (const li of within(screen.getByRole("list")).getAllByRole("listitem")) assert.equal(within(li).getAllByRole("link").length, 1, "cada fila sigue siendo UN enlace al producto");
  });

  it("aunque alguien pida `?genero=` al servidor, el listado es el de siempre (las cinco piezas) y no trae el dato de lado", async () => {
    const respuesta = await productosGET(new NextRequest("http://localhost/api/dashboard/catalogo/productos?genero=hombre", { headers: { authorization: "Bearer t-admin" } }));
    const cuerpo = await respuesta.json();
    assert.equal(cuerpo.data.total, 5);
    assert.ok(!("genero" in cuerpo.data), "sin separación la respuesta no trae `genero`");
    for (const p of cuerpo.data.items) assert.ok(!("gender" in p), `${p.name} no debe traer «gender»`);
  });

  it("marcar el lado por la API en un negocio sin separación se rechaza con un aviso claro ANTES de tocar nada", async () => {
    const respuesta = await productoPATCH(
      new NextRequest(`http://localhost/api/dashboard/catalogo/productos/${idDe(3)}`, { method: "PATCH", headers: { authorization: "Bearer t-admin", "content-type": "application/json" }, body: JSON.stringify({ gender: "hombre" }) }),
      { params: Promise.resolve({ id: idDe(3) }) },
    );
    const cuerpo = await respuesta.json();
    assert.equal(cuerpo.success, false);
    assert.equal(cuerpo.error.code, "FEATURE_UNAVAILABLE");
    assert.match(cuerpo.error.message, /separación Mujer\/Hombre todavía no está activada/);
    assert.equal(enBase(3).genero, "mujer", "la pieza no cambió");
    assert.equal(enBase(3).escritura_id, ESCRITURA_ORIGINAL, "ni se renovó la escritura");
  });
});

// ---------------------------------------------------------------------------
// «¿Separa Mujer y Hombre este negocio?» y el cableado de los formularios
// ---------------------------------------------------------------------------

function Sonda({ token }: { token: string }) {
  const client = useMemo(() => createCatalogClient(token), [token]);
  const separa = useSeparaGenero(client);
  return <p data-testid="separa">{String(separa)}</p>;
}
const leerSonda = (token: string) => render(<Sonda token={token} />);

describe("useSeparaGenero", () => {
  afterEach(() => {
    puente?.restaurar();
    db?.uninstall();
  });

  it("es verdadero en la tienda que separa (Delacour) y falso en las demás", async () => {
    sembrar("delacour");
    leerSonda("t-admin");
    await waitFor(() => assert.equal(screen.getByTestId("separa").textContent, "true"));
    cleanup();
    puente.restaurar();
    db.uninstall();
    sembrar("otra-joyeria");
    leerSonda("t-admin");
    await waitFor(() => assert.ok(puente.llamadas.some((l) => l.ruta.startsWith("/productos?"))));
    await new Promise((resolver) => setTimeout(resolver, 50));
    assert.equal(screen.getByTestId("separa").textContent, "false");
  });

  it("si la consulta falla (error del servidor o sin red) es falso y NO se rompe la pantalla", async (t) => {
    t.mock.method(console, "error", () => {});
    sembrar("delacour");
    db.missing("dulabs_inventario_productos");
    leerSonda("t-admin");
    await waitFor(() => assert.ok(puente.llamadas.some((l) => l.ruta.startsWith("/productos?"))));
    await new Promise((resolver) => setTimeout(resolver, 50));
    assert.equal(screen.getByTestId("separa").textContent, "false");
    cleanup();
    const base = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    try {
      leerSonda("t-admin");
      await new Promise((resolver) => setTimeout(resolver, 50));
      assert.equal(screen.getByTestId("separa").textContent, "false");
    } finally {
      globalThis.fetch = base;
    }
  });
});

describe("el cableado de las pantallas del producto (la página del producto no se puede montar aquí: depende de la ruta)", () => {
  const leer = (ruta: string) => readFileSync(ruta, "utf8");

  it("crear un producto sabe si el negocio separa, arranca en «mujer» y conserva el lado al cargar varias piezas seguidas", () => {
    const fuente = leer("app/dashboard/catalogo/nuevo/page.tsx");
    assert.ok(fuente.includes("useSeparaGenero(client)"), "debe saber si el negocio separa Mujer y Hombre");
    assert.ok(fuente.includes('gender: "mujer"'), "arranca en mujer (lo predeterminado)");
    assert.ok(/\.\.\.\(form\.gender \? \{ gender: form\.gender \} : \{\}\)/.test(fuente), "conserva el lado entre piezas");
    assert.ok(fuente.includes("toProductDraft(form)"), "lo que se manda sale del formulario");
  });

  it("la lista del catálogo manda `genero` al servidor y le pasa la clasificación solo si el negocio separa (o tiene líneas)", () => {
    const fuente = leer("app/dashboard/catalogo/page.tsx");
    assert.ok(fuente.includes("genero: genero || undefined"), "el filtro viaja al listado solo si está puesto");
    assert.ok(fuente.includes("const separaGenero = Boolean(data?.genero)"), "el servidor dice si el negocio separa");
    assert.ok(/lineas\.length > 0 \|\| separaGenero/.test(fuente), "sin líneas ni separación no hay clasificación");
    assert.ok(fuente.includes("puedeAsignar: canWrite"), "solo quien puede editar cambia el lado");
  });
});
