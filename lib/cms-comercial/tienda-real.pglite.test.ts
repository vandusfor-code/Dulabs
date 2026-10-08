process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

/**
 * La tienda con ofertas y combos de PUNTA A PUNTA con el CABLEADO REAL de producción (los mismos adaptadores que usan las páginas y rutas públicas), sin red ni Supabase real:
 * PostgREST en memoria para el catálogo, Postgres embebido para el SQL real del CMS, y el reloj de verdad. Ofertas y negocios ficticios.
 *
 *   inicio de la tienda  →  crearDepsPublicasCms() (negocio por slug, lector del CMS, productos de los combos con precio efectivo)
 *   selección y pedido   →  responderSeleccion / responderPedido con su servicio real (repositorioConPrecios) y el limitador real
 *
 * Lo que se prueba aquí y no en otra parte: que la composición real entrega el MISMO precio en la tienda, la cotización, el pedido y el mensaje.
 */
import "@electric-sql/pglite";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { responderPedido, responderSeleccion } from "@/lib/catalogo/pedido-http";
import { runAgentTool } from "@/lib/catalogo/pedidos/herramientas";
import { productionAgentToolDeps } from "@/lib/catalogo/pedidos/produccion";
import { cargarCatalogoPublico, cargarInicioElegido, cargarProducto, cargarProductoMayor } from "@/lib/catalogo/public-loader";
import { supabaseAdmin } from "@/lib/supabase";
import { storefrontConfigFor } from "@/lib/catalogo/vitrina";
import { checksumDe } from "@/lib/cms-comercial/checksum";
import { crearDepsPublicasCms } from "@/lib/cms-comercial/publico-supabase";
import { crearDelacourSintetico } from "@/lib/cms-comercial/testing/delacour";
import { TENANT_A, TENANT_B } from "@/lib/cms-comercial/testing/fixtures";
import type { BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { instalarPuenteRpcCms, type PuenteRpc } from "@/lib/cms-comercial/testing/puente-rpc";
import { cargarVitrinaInicio } from "@/lib/cms-comercial/vitrina-publica";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";

const URL_BASE = "http://supabase.memoria";
const SLUG = "tienda-real";
const REF_A = "DL-000001";
const REF_B = "DL-000002";
const TOKEN_MAYOR = "a".repeat(64);
const DIA_MS = 24 * 60 * 60 * 1000;
const dia = (desplazamiento: number) => new Date(Date.now() + desplazamiento * DIA_MS).toISOString().slice(0, 10);
/** Vigencia amplia alrededor de HOY (el cableado real usa el reloj real, así que las fechas se calculan, no se escriben). */
const VIGENTE = () => ({ desde: dia(-2), hasta: dia(30) });

let pg: BaseCms;
let db: SupabaseMemoria;
let puente: PuenteRpc;
let captura: { recibidos: Array<{ p_pedido: Record<string, unknown> }>; restaurar(): void };

/** La función SQL de creación del pedido no es parte de esta prueba (tiene sus propias pruebas de migración): se captura lo que el motor le manda y se responde como lo haría la base. */
function conCreacionDePedido() {
  const recibidos: Array<{ p_pedido: Record<string, unknown> }> = [];
  const previo = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/rest/v1/rpc/dulabs_catalogo_pedido_crear") {
      const cuerpo = JSON.parse(String(init?.body ?? "{}")) as { p_pedido: Record<string, unknown> };
      recibidos.push(cuerpo);
      const creado = new Date().toISOString();
      return Response.json({ creado: true, pedido: { ...cuerpo.p_pedido, id: "00000000-0000-4000-8000-0000000000aa", moneda: "COP", created_at: cuerpo.p_pedido.created_at ?? creado, updated_at: creado } });
    }
    return previo(input as never, init);
  }) as typeof fetch;
  return { recibidos, restaurar: () => void (globalThis.fetch = previo) };
}

const fila = (tenant: string, referencia: string, nombre: string, precio: number, precioMayor: number | null, stock: number) => ({
  id: `${tenant.slice(0, 8)}-${referencia}`,
  id_tenant: tenant,
  referencia,
  nombre,
  descripcion: null,
  precio,
  precio_mayor: precioMayor,
  material: null,
  color: null,
  categoria: null,
  categoria_id: null,
  activo: true,
  controla_stock: true,
  stock,
  foto_url: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
});

beforeEach(async () => {
  pg = await crearDelacourSintetico();
  await pg.habilitarModulo(TENANT_A);
  db = installSupabaseMemoria(URL_BASE);
  puente = instalarPuenteRpcCms(pg, URL_BASE);
  captura = conCreacionDePedido();
  db.table("dulabs_catalogo_pedidos");
  db.table("dulabs_catalogo_publicacion").push({ id_tenant: TENANT_A, slug: SLUG, nombre_publico: "Tienda real", publicado: true, token_mayor: TOKEN_MAYOR });
  db.table("dulabs_tenant_modulos").push({ id_tenant: TENANT_A, modulo: "catalogo", habilitado: true });
  db.table("dulabs_clientes_config").push({ id: 1, id_tenant: TENANT_A, phone_number_id: "100000000000001", nombre_negocio: "Tienda real", telefono_negocio: "573001112233", updated_at: "2026-09-01T00:00:00Z" });
  db.table("dulabs_catalogo_media");
  db.table("dulabs_catalogo_categorias");
  db.table("dulabs_inventario_productos").push(
    fila(TENANT_A, REF_A, "Aretes dorados", 100_000, 70_000, 5),
    fila(TENANT_A, REF_B, "Cadena fina", 50_000, null, 5),
    fila(TENANT_B, REF_A, "Aretes de otra tienda", 100_000, null, 5),
  );
});

afterEach(async () => {
  captura.restaurar();
  puente.restaurar();
  db.uninstall();
  await pg.cerrar();
});

/** Crea y PUBLICA un elemento directamente en el SQL real (como lo dejaría la administradora al publicar). */
async function publicar(tenant: string, tipo: string, clave: string, contenido: unknown) {
  const [{ r }] = await pg.sql<{ r: { entidad: { id: string; rev: number } } }>("select public.dulabs_cms_crear($1, $2, $3, $4::jsonb, null, 'Prueba') as r", [tenant, tipo, clave, JSON.stringify(contenido)]);
  await pg.sql("select public.dulabs_cms_publicar($1, $2, $3, 0, $4, null, null, 'Prueba')", [tenant, r.entidad.id, r.entidad.rev, checksumDe(contenido)]);
  return r.entidad.id;
}

const OFERTA = (refs: string[], over: Record<string, unknown> = {}) => ({
  nombre: "Amor y Amistad",
  modalidad: "ambas",
  beneficio: { tipo: "porcentaje", valor: 20 },
  alcance: { todos: false, referencias: refs, categorias: [] },
  vigencia: VIGENTE(),
  prioridad: 5,
  condiciones: "Hasta agotar existencias.",
  ...over,
});
const COMBO = () => ({
  nombre: "Regalo completo",
  modalidad: "ambas",
  componentes: [{ referencia: REF_A, cantidad: 1 }, { referencia: REF_B, cantidad: 2 }],
  precio: { detal: 150_000, mayorista: 110_000 },
  vigencia: VIGENTE(),
  prioridad: 1,
});
const HOME = () => ({
  portada: { visible: true, titulo: "Portada de prueba", imagen: { origen: "estatico", src: "/catalogo/prueba/portada.png", ancho: 1600, alto: 900, alt: "Portada de prueba" } },
  secciones: [{ tipo: "portada", visible: true }, { tipo: "ofertas", visible: true }, { tipo: "combos", visible: true }],
  categorias_destacadas: [],
  productos_destacados: [],
});

const CTX = { slug: SLUG, basePath: `/catalogo/${SLUG}`, listPath: `/catalogo/${SLUG}?todo=1`, whatsapp: "573001112233", categorias: new Set<string>() };
const inicio = () => cargarVitrinaInicio(crearDepsPublicasCms(), storefrontConfigFor("tienda-sin-registro"), CTX);
const seleccion = (refs: string[], canal: { slug: string; context: "retail" | "wholesale"; token?: string } = { slug: SLUG, context: "retail" }) =>
  responderSeleccion(new Request(`http://localhost/catalogo/${SLUG}/seleccion?${refs.map((r) => `ref=${r}`).join("&")}`), canal);

describe("el inicio de la tienda (cableado real)", () => {
  it("las ofertas y los combos publicados llegan a la portada con datos reales: precio efectivo, disponibilidad e inventario del catálogo", async () => {
    await publicar(TENANT_A, "home", "home", HOME());
    await publicar(TENANT_A, "oferta", "amor", OFERTA([REF_A]));
    await publicar(TENANT_A, "combo", "regalo", COMBO());
    const v = await inicio();
    assert.equal(v.origen, "cms");
    assert.deepEqual(v.config.ofertas?.map((o) => [o.clave, o.beneficio, o.alcance]), [["amor", "20% de descuento", "1 producto seleccionado"]]);
    // Precio normal = lo que se paga HOY por separado: A con la oferta (80.000) + 2 × B (100.000) = 180.000; el combo a 150.000 ahorra 30.000.
    assert.deepEqual(v.config.combos?.map((c) => [c.clave, c.disponible, c.precioNormal, c.precioCombo, c.ahorro]), [["regalo", true, 180_000, 150_000, 30_000]]);
    assert.ok(v.config.combos?.[0].consultaHref?.startsWith("https://wa.me/573001112233?text="));
  });

  it("si el inventario real no alcanza para el combo, deja de estar disponible (lo decide el backend con los datos del catálogo)", async () => {
    await publicar(TENANT_A, "home", "home", HOME());
    await publicar(TENANT_A, "combo", "regalo", COMBO());
    db.rows("dulabs_inventario_productos").find((r) => r.id_tenant === TENANT_A && r.referencia === REF_B)!.stock = 1; // el combo pide 2
    const combo = (await inicio()).config.combos?.[0];
    assert.equal(combo?.disponible, false);
    assert.equal(combo?.consultaHref, null);
  });

  it("MÓDULO APAGADO: aunque haya ofertas y combos publicados, la tienda es la de siempre", async () => {
    await publicar(TENANT_A, "home", "home", HOME());
    await publicar(TENANT_A, "oferta", "amor", OFERTA([REF_A]));
    await publicar(TENANT_A, "combo", "regalo", COMBO());
    await pg.habilitarModulo(TENANT_A, false);
    const registro = storefrontConfigFor("tienda-sin-registro");
    const v = await cargarVitrinaInicio(crearDepsPublicasCms(), registro, CTX);
    assert.equal(v.origen, "registro");
    assert.equal(v.config, registro);
  });
});

describe("la selección y el pedido (cableado real): lo mostrado, lo firmado y lo cobrado son lo mismo", () => {
  it("con una oferta publicada: la selección muestra el precio efectivo (y no se guarda en cachés compartidas), el pedido lo cobra y el mensaje cuenta el ahorro", async () => {
    await publicar(TENANT_A, "oferta", "amor", OFERTA([REF_A]));
    const sel = await seleccion([REF_A, REF_B]);
    assert.equal(sel.headers.get("cache-control"), "private, no-store");
    const vista = (await sel.json()) as { items: Array<{ reference: string; price: number; listPrice?: number; offerLabel?: string }>; quote: string };
    assert.deepEqual(vista.items.map((i) => [i.reference, i.price, i.listPrice, i.offerLabel]), [[REF_A, 80_000, 100_000, "-20%"], [REF_B, 50_000, undefined, undefined]]);

    const res = await responderPedido(
      new Request(`http://localhost/catalogo/${SLUG}/pedido`, { method: "POST", body: JSON.stringify({ items: [{ reference: REF_A, quantity: 2 }, { reference: REF_B, quantity: 1 }], quote: vista.quote, requestKey: "clave-real-0000000001" }) }),
      { slug: SLUG, context: "retail" },
    );
    const pedido = (await res.json()) as { status: string; request: { total: number } | null; whatsappUrl: string | null };
    assert.equal(pedido.status, "ready");
    assert.equal(pedido.request?.total, 210_000, "2 × 80.000 + 50.000: el mismo precio que se mostró");
    const mensaje = decodeURIComponent((pedido.whatsappUrl ?? "").split("?text=")[1] ?? "");
    assert.equal(captura.recibidos.length, 1, "la solicitud de la tienda se guardó por el motor real");
    const guardadas = captura.recibidos[0].p_pedido.lineas as Array<Record<string, unknown>>;
    assert.deepEqual([guardadas[0].unit_price, guardadas[0].list_price, guardadas[0].offer], [80_000, 100_000, { key: "amor", name: "Amor y Amistad", version: 1 }]);
    assert.ok(!("list_price" in guardadas[1]) && !("offer" in guardadas[1]));
    assert.match(mensaje, /Total estimado: \$210\.000/);
    assert.match(mensaje, /Incluye ofertas vigentes \(ahorro: \$40\.000\)/);
    assert.ok(!mensaje.includes("Amor y Amistad") && !mensaje.includes("Hasta agotar"), "ningún texto de la administradora entra al mensaje");
  });

  it("si la administradora pausa la oferta entre la cotización y el pedido, el pedido NO sale con el precio viejo: se ajusta", async () => {
    const id = await publicar(TENANT_A, "oferta", "amor", OFERTA([REF_A]));
    const vista = (await (await seleccion([REF_A])).json()) as { quote: string };
    await pg.sql("select public.dulabs_cms_pausar($1, $2, null, 'Prueba')", [TENANT_A, id]);
    const res = await responderPedido(
      new Request(`http://localhost/catalogo/${SLUG}/pedido`, { method: "POST", body: JSON.stringify({ items: [{ reference: REF_A, quantity: 1 }], quote: vista.quote, requestKey: "clave-real-0000000002" }) }),
      { slug: SLUG, context: "retail" },
    );
    const pedido = (await res.json()) as { status: string; adjustments: Array<{ kind: string; before: number; after: number }> };
    assert.equal(pedido.status, "adjusted");
    assert.deepEqual(pedido.adjustments.map((a) => [a.kind, a.before, a.after]), [["price_changed", 80_000, 100_000]]);
  });

  it("sin ofertas publicadas la selección es la de siempre: precio de lista, sin propiedades de oferta (con el módulo encendido igual no se guarda en cachés compartidas)", async () => {
    const sel = await seleccion([REF_A]);
    const vista = (await sel.json()) as { items: Array<Record<string, unknown>> };
    assert.equal(vista.items[0].price, 100_000);
    assert.ok(!("listPrice" in vista.items[0]) && !("offerLabel" in vista.items[0]));
    assert.equal(sel.headers.get("cache-control"), "private, no-store");
  });

  it("MÓDULO APAGADO: precio de lista y la caché corta de siempre", async () => {
    await publicar(TENANT_A, "oferta", "amor", OFERTA([REF_A]));
    await pg.habilitarModulo(TENANT_A, false);
    const sel = await seleccion([REF_A]);
    const vista = (await sel.json()) as { items: Array<Record<string, unknown>> };
    assert.equal(vista.items[0].price, 100_000);
    assert.equal(sel.headers.get("cache-control"), "public, max-age=0, s-maxage=30, stale-while-revalidate=60");
  });

  it("la oferta de OTRO negocio no baja este precio aunque compartan la referencia", async () => {
    await pg.habilitarModulo(TENANT_B);
    await publicar(TENANT_B, "oferta", "de-b", OFERTA([REF_A], { nombre: "Solo de B" }));
    const vista = (await (await seleccion([REF_A])).json()) as { items: Array<{ price: number }> };
    assert.equal(vista.items[0].price, 100_000);
  });

  it("el canal mayorista recibe su propio precio y SOLO las ofertas mayoristas (la oferta detal no lo toca)", async () => {
    await publicar(TENANT_A, "oferta", "detal", OFERTA([REF_A], { modalidad: "detal", beneficio: { tipo: "porcentaje", valor: 50 } }));
    await publicar(TENANT_A, "oferta", "mayor", OFERTA([REF_A], { nombre: "Surtido mayor", modalidad: "mayorista", beneficio: { tipo: "porcentaje", valor: 10 } }));
    const mayor = await seleccion([REF_A], { slug: SLUG, context: "wholesale", token: TOKEN_MAYOR });
    assert.equal(mayor.headers.get("cache-control"), "private, no-store");
    const vistaMayor = (await mayor.json()) as { items: Array<{ price: number; listPrice?: number }> };
    assert.deepEqual([vistaMayor.items[0].price, vistaMayor.items[0].listPrice], [63_000, 70_000]);
    const detal = (await (await seleccion([REF_A])).json()) as { items: Array<{ price: number }> };
    assert.equal(detal.items[0].price, 50_000, "el detal recibe SOLO su oferta (50%), nunca la mayorista");
  });
});

describe("las páginas de la tienda (cargadores reales): listado, ficha, inicio y mayorista muestran el precio efectivo", () => {
  it("listado, ficha e inicio traen el precio de la oferta, el de lista y la oferta; lo que no tiene oferta queda como siempre", async () => {
    await publicar(TENANT_A, "oferta", "amor", OFERTA([REF_A]));
    const lista = await cargarCatalogoPublico(SLUG, "retail", undefined, undefined, undefined, 1);
    const [a, b] = [lista!.products.find((p) => p.reference === REF_A)!, lista!.products.find((p) => p.reference === REF_B)!];
    assert.deepEqual([a.price, a.listPrice, a.offer?.label], [80_000, 100_000, "-20%"]);
    assert.deepEqual([b.price, "listPrice" in b, "offer" in b], [50_000, false, false]);
    const ficha = await cargarProducto(SLUG, REF_A);
    assert.deepEqual([ficha?.price, ficha?.listPrice, ficha?.offer?.name, ficha?.offer?.until?.startsWith("hasta el ")], [80_000, 100_000, "Amor y Amistad", true]);
    const home = await cargarInicioElegido(SLUG, { destacadas: [REF_A, REF_B] });
    assert.deepEqual(home?.featured.map((p) => [p.reference, p.price]), [[REF_A, 80_000], [REF_B, 50_000]]);
  });

  it("la ficha mayorista usa el precio mayorista y solo las ofertas mayoristas", async () => {
    await publicar(TENANT_A, "oferta", "detal", OFERTA([REF_A], { modalidad: "detal", beneficio: { tipo: "porcentaje", valor: 50 } }));
    assert.equal((await cargarProductoMayor(SLUG, TOKEN_MAYOR, REF_A))?.price, 70_000, "la oferta detal no toca el precio mayorista");
    await publicar(TENANT_A, "oferta", "mayor", OFERTA([REF_A], { nombre: "Surtido mayor", modalidad: "mayorista", beneficio: { tipo: "porcentaje", valor: 10 } }));
    const mayor = await cargarProductoMayor(SLUG, TOKEN_MAYOR, REF_A);
    assert.deepEqual([mayor?.price, mayor?.listPrice, mayor?.offer?.name], [63_000, 70_000, "Surtido mayor"]);
  });

  it("MÓDULO APAGADO: las páginas muestran el precio de lista, sin ninguna propiedad de oferta", async () => {
    await publicar(TENANT_A, "oferta", "amor", OFERTA([REF_A]));
    await pg.habilitarModulo(TENANT_A, false);
    const ficha = await cargarProducto(SLUG, REF_A);
    assert.equal(ficha?.price, 100_000);
    assert.ok(!("listPrice" in (ficha as object)) && !("offer" in (ficha as object)));
    const lista = await cargarCatalogoPublico(SLUG, "retail", undefined, undefined, undefined, 1);
    assert.equal(lista!.products.find((p) => p.reference === REF_A)?.price, 100_000);
  });
});

describe("ARIA (herramientas de catálogo con el cableado real de producción)", () => {
  const ctx = (channel: "retail" | "wholesale") => ({ tenantId: TENANT_A, channel, conversation: { phoneNumberId: "100000000000001", waId: "573001110001" }, requestId: "req-real-0001" });
  const producto = async (channel: "retail" | "wholesale") => {
    const deps = productionAgentToolDeps(supabaseAdmin());
    assert.ok(deps, "con la clave de firma el motor de producción existe");
    const r = await runAgentTool("get_product_by_reference", { reference: REF_A }, ctx(channel), deps);
    assert.equal(r.ok, true, r.ok ? "" : `${r.error.code}: ${r.error.message}`);
    return (r as { ok: true; data: { product: Record<string, unknown> } }).data.product;
  };

  it("ARIA cuenta el MISMO precio que ve y paga el cliente: el efectivo, con el precio de lista y la oferta redactados por el backend", async () => {
    await publicar(TENANT_A, "oferta", "amor", OFERTA([REF_A]));
    const p = await producto("retail");
    assert.deepEqual([p.unit_price, p.list_price], [80_000, 100_000]);
    const oferta = p.offer as { name: string; benefit: string; valid_until: string; conditions: string };
    assert.deepEqual([oferta.name, oferta.benefit, oferta.conditions], ["Amor y Amistad", "20% de descuento", "Hasta agotar existencias."]);
    assert.match(oferta.valid_until, /^hasta el \d{1,2} de [a-záéíóú]+ de \d{4}$/, "la vigencia sale en palabras, redactada por el backend");
  });

  it("en el canal mayorista ARIA recibe el precio mayorista y solo las ofertas mayoristas; la oferta detal no sale", async () => {
    await publicar(TENANT_A, "oferta", "detal", OFERTA([REF_A], { modalidad: "detal", beneficio: { tipo: "porcentaje", valor: 50 } }));
    const mayor = await producto("wholesale");
    assert.equal(mayor.unit_price, 70_000);
    assert.ok(!("offer" in mayor) && !("list_price" in mayor));
  });

  it("MÓDULO APAGADO: ARIA ve el precio de lista, sin ninguna propiedad de oferta", async () => {
    await publicar(TENANT_A, "oferta", "amor", OFERTA([REF_A]));
    await pg.habilitarModulo(TENANT_A, false);
    const p = await producto("retail");
    assert.equal(p.unit_price, 100_000);
    assert.ok(!("offer" in p) && !("list_price" in p));
  });
});

describe("el motor de pedidos de producción (WhatsApp) cobra el precio efectivo y guarda la evidencia", () => {
  it("create_order en WhatsApp: el pedido sale con el precio de la oferta, y las líneas se guardan con el precio de lista y la oferta (nombre y versión)", async () => {
    await publicar(TENANT_A, "oferta", "amor", OFERTA([REF_A], { nombre: "Amor y Amistad" }));
    {
      const deps = productionAgentToolDeps(supabaseAdmin());
      assert.ok(deps);
      const ctx = { tenantId: TENANT_A, channel: "retail" as const, conversation: { phoneNumberId: "100000000000001", waId: "573001110001" }, requestId: "req-real-0002" };
      const r = await runAgentTool("create_order", { items: [{ reference: REF_A, quantity: 2 }, { reference: REF_B, quantity: 1 }], idempotency_key: "pedido-real-oferta-01" }, ctx, deps);
      assert.equal(r.ok, true, r.ok ? "" : `${r.error.code}: ${r.error.message}`);
      const vista = (r as { ok: true; data: { total: number; lines: Array<Record<string, unknown>> } }).data;
      assert.equal(vista.total, 210_000);
      assert.deepEqual(vista.lines.map((l) => [l.reference, l.unit_price, l.list_price, l.offer]), [[REF_A, 80_000, 100_000, "Amor y Amistad"], [REF_B, 50_000, undefined, undefined]]);
      assert.equal(captura.recibidos.length, 1);
      const [lineaA, lineaB] = captura.recibidos[0].p_pedido.lineas as Array<Record<string, unknown>>;
      assert.deepEqual([lineaA.unit_price, lineaA.subtotal, lineaA.list_price, lineaA.offer], [80_000, 160_000, 100_000, { key: "amor", name: "Amor y Amistad", version: 1 }]);
      assert.ok(!("list_price" in lineaB) && !("offer" in lineaB));
      assert.equal(captura.recibidos[0].p_pedido.total, 210_000);
    }
  });
});
