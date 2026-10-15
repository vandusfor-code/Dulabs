// Postgres embebido ANTES que jsdom (ver tienda.dom.test.tsx): este import debe ir primero.
import "@electric-sql/pglite";
import "@/lib/test-helpers/jsdom-setup";
/**
 * Administración de tienda — el PIE DE PÁGINA y las PREGUNTAS FRECUENTES, de punta a punta: pantalla (jsdom + Testing Library) → cliente del navegador → rutas reales (/api/dashboard/tienda/*) → servicio →
 * SQL real (Postgres embebido). Lo que la administradora toca es lo que el backend decide y vuelve a validar; la pantalla nunca es la autoridad.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createCmsClient } from "@/lib/cms-comercial-client";
import { crearLector } from "@/lib/cms-comercial/lector";
import { pieDesdeCms } from "@/lib/cms-comercial/pie";
import { crearRepositorioSupabaseCms } from "@/lib/cms-comercial/repositorio-supabase";
import { crearFetchRutas } from "@/lib/cms-comercial/testing/fetch-rutas";
import { crearBaseCms, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { instalarPuenteRpcCms, type PuenteRpc } from "@/lib/cms-comercial/testing/puente-rpc";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { CatalogToastProvider } from "@/components/dashboard/catalogo/ui";
import { TiendaApp } from "@/components/dashboard/tienda/TiendaApp";

configure({ asyncUtilTimeout: 6000 });

const TA = "aaaaaaaa-0000-4000-8000-00000000000a";
const CAT_A = "c0000000-0000-4000-8000-0000000000a1";
const CAT_A2 = "c0000000-0000-4000-8000-0000000000a2";
const ADMIN = "d0000000-0000-4000-8000-000000000001";

let pg: BaseCms;
let db: SupabaseMemoria;
let puente: PuenteRpc;

before(async () => {
  pg = await crearBaseCms();
});
after(async () => {
  await pg.cerrar();
});

beforeEach(async () => {
  await pg.aplicarSql("truncate public.dulabs_cms_auditoria, public.dulabs_cms_versiones, public.dulabs_cms_assets, public.dulabs_cms_entidades cascade");
  db = installSupabaseMemoria(process.env.SUPABASE_URL);
  puente = instalarPuenteRpcCms(pg, process.env.SUPABASE_URL as string, {});
  db.table("dulabs_miembros_equipo").push(
    { id: 1, tenant_id: TA, user_id: ADMIN, rol: "admin", estado: "activo", email: "admin@a.test", nombre: "Ana Admin" },
    { id: 2, tenant_id: TA, user_id: "d0000000-0000-4000-8000-000000000002", rol: "agente", estado: "activo", email: "agente@a.test", nombre: "Bea Agente" },
  );
  db.user("t-admin-a", ADMIN);
  db.user("t-agente-a", "d0000000-0000-4000-8000-000000000002");
  await pg.habilitarModulo(TA); // el lector de lo publicado lo consulta en la base (la API, en la memoria de arriba)
  db.table("dulabs_tenant_modulos").push({ id_tenant: TA, modulo: "cms_comercial", habilitado: true });
  db.table("dulabs_catalogo_categorias").push({ id: CAT_A, id_tenant: TA, nombre: "Aretes" }, { id: CAT_A2, id_tenant: TA, nombre: "Dijes" });
  db.table("dulabs_agente_runtime_config").push({ id_tenant: TA, habilitado: true, created_at: "2026-09-01T00:00:00Z", negocio: { nombre_negocio: "Tienda A", pedido: { minimo_mayorista: 750000 } } });
});

afterEach(() => {
  cleanup();
  puente.restaurar();
  db.uninstall();
});

/** La tienda publicada del negocio con ese slug (de él depende el tema: «delacour» es joyería con página de mayoristas; cualquier otro, la tienda de siempre). */
const publicar = (slug: string, nombre = "Delacour & Orus") => db.table("dulabs_catalogo_publicacion").push({ id_tenant: TA, slug, nombre_publico: nombre, publicado: true, token_mayor: "f".repeat(64) });

function montar(token = "t-admin-a") {
  const rutas = crearFetchRutas();
  const client = createCmsClient(token, { fetch: rutas.fetch });
  const usuario = userEvent.setup();
  render(
    <CatalogToastProvider>
      <TiendaApp client={client} canWrite={token === "t-admin-a"} />
    </CatalogToastProvider>,
  );
  return { usuario, client };
}

const boton = (nombre: string | RegExp) => screen.getByRole("button", { name: nombre });
const entidades = (tipo: string) => pg.sql<{ clave: string; estado: string; borrador: Record<string, unknown> | null; rev: number }>("select clave, estado, borrador, rev from public.dulabs_cms_entidades where id_tenant = $1 and tipo = $2 order by clave", [TA, tipo]);
const campo = (alcance: HTMLElement, etiqueta: RegExp | string) => within(alcance).getByLabelText(etiqueta) as HTMLInputElement;
const publicado = async () => (await crearLector(crearRepositorioSupabaseCms(pg.supabase)).cargar(TA))?.pie?.contenido ?? null;

describe("las pestañas «Preguntas frecuentes» y «Pie de página»", () => {
  it("con la tienda de tema joyería y su página de mayoristas se ofrecen las dos", async () => {
    publicar("delacour");
    montar();
    assert.ok(await screen.findByRole("tab", { name: "Pie de página" }));
    assert.ok(screen.getByRole("tab", { name: "Preguntas frecuentes" }));
  });

  it("con una tienda de otro tema, o sin tienda publicada, no se ofrecen: un editor que no cambia nada confunde", async () => {
    publicar("tienda-a", "Tienda A");
    montar();
    await screen.findByRole("link", { name: /Ver mi tienda/ });
    assert.equal(screen.queryByRole("tab", { name: "Pie de página" }), null);
    assert.equal(screen.queryByRole("tab", { name: "Preguntas frecuentes" }), null);
    assert.ok(screen.getByRole("tab", { name: "Contenido" }));
  });

  it("sin ninguna tienda publicada tampoco", async () => {
    montar();
    await screen.findByRole("tab", { name: "Contenido" });
    await waitFor(() => assert.equal(screen.queryByRole("tab", { name: "Pie de página" }), null));
  });
});

describe("pie de página: de cero a publicado", () => {
  it("se personaliza partiendo de lo que la tienda muestra hoy; se edita, se revisa y se publica; la tienda recibe lo publicado", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await usuario.click(await screen.findByRole("tab", { name: "Pie de página" }));
    assert.ok(await screen.findByText("Todavía no personalizaste el pie de página"));
    await usuario.click(boton("Personalizar el pie de página"));

    // El borrador de arranque es el pie de siempre: «Navegar» con inicio, catálogo y mayoristas, las categorías y el contacto por WhatsApp.
    const columna1 = await screen.findByRole("group", { name: "Columna 1" });
    assert.equal(campo(columna1, /Título de la columna/).value, "Navegar");
    assert.deepEqual(within(columna1).getAllByLabelText(/Texto del enlace/).map((i) => (i as HTMLInputElement).value), ["Inicio", "Todo el catálogo", "Mayoristas"]);
    assert.equal((screen.getByLabelText("Frase") as HTMLTextAreaElement).value, "Diseños únicos para cada momento de tu vida.");
    assert.equal((screen.getByRole("switch", { name: "Mostrar las categorías" }) as HTMLButtonElement).getAttribute("aria-checked"), "true");
    const creado = (await entidades("pie"))[0];
    assert.equal(creado.estado, "borrador");
    assert.equal((creado.borrador?.columnas as Array<{ enlaces: unknown[] }>)[0].enlaces.length, 3);

    // Una red social: basta con el @usuario; al salir del campo se completa con la dirección del perfil.
    await usuario.click(boton("Agregar una red social"));
    const red1 = await screen.findByRole("group", { name: "Red social 1" });
    assert.equal((within(red1).getByLabelText("Red") as HTMLSelectElement).value, "instagram");
    await usuario.type(campo(red1, /Dirección del perfil o @usuario/), "@delacour.joyeria");
    await usuario.tab();
    assert.equal(campo(red1, /Dirección del perfil o @usuario/).value, "https://instagram.com/delacour.joyeria");

    // El contacto: el bloque ya viene con WhatsApp; se suman el correo y la dirección.
    await usuario.type(screen.getByLabelText("Correo electrónico"), "ventas@delacour.co");
    await usuario.type(screen.getByLabelText("Dirección"), "Carrera 26 # 18-71");

    // Una columna nueva con un enlace a otra página.
    await usuario.click(boton("Agregar una columna"));
    const columna2 = await screen.findByRole("group", { name: "Columna 2" });
    await usuario.type(campo(columna2, /Título de la columna/), "Legal");
    await usuario.type(campo(columna2, /Texto del enlace/), "Política de privacidad");
    await usuario.selectOptions(within(columna2).getByLabelText("¿A dónde lleva?"), "externo");
    await usuario.type(campo(columna2, /Dirección de la página/), "https://delacour.co/privacidad");

    // La vista previa refleja lo escrito.
    const previa = screen.getByTestId("previa");
    assert.ok(previa.textContent?.includes("Legal") && previa.textContent.includes("Política de privacidad") && previa.textContent.includes("delacour.co") && previa.textContent.includes("@delacour.joyeria"), previa.textContent ?? "");

    // Publicar: se revisa, se confirma y la tienda recibe exactamente lo publicado.
    await usuario.click(boton("Publicar"));
    await usuario.click(await screen.findByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));
    const pie = await publicado();
    assert.ok(pie);
    assert.deepEqual(pie.columnas.map((c) => c.titulo), ["Navegar", "Legal"]);
    assert.deepEqual(pie.columnas[1].enlaces, [{ texto: "Política de privacidad", destino: { tipo: "externo", url: "https://delacour.co/privacidad" } }]);
    assert.deepEqual(pie.redes, [{ red: "instagram", url: "https://instagram.com/delacour.joyeria" }]);
    assert.equal(pie.contacto?.email, "ventas@delacour.co");
    assert.equal(pie.contacto?.direccion, "Carrera 26 # 18-71");

    const vista = pieDesdeCms(pie, { basePath: "/catalogo/delacour", listPath: "/catalogo/delacour?todo=1", categorias: [{ id: CAT_A, name: "Aretes" }], whatsappHref: "https://wa.me/573001112233", mayoristaHref: "/catalogo/delacour/mayoristas", descripcion: "x" });
    assert.deepEqual(vista.columnas[1].enlaces, [{ texto: "Política de privacidad", href: "https://delacour.co/privacidad", externo: true }]);
    assert.equal(vista.redes[0].usuario, "@delacour.joyeria");
  });

  it("lo que el servidor rechaza se muestra junto al campo: una dirección http, y el enlace del catálogo mayorista", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await usuario.click(await screen.findByRole("tab", { name: "Pie de página" }));
    await usuario.click(await screen.findByRole("button", { name: "Personalizar el pie de página" }));
    const columna1 = await screen.findByRole("group", { name: "Columna 1" });
    const enlaces = within(columna1).getAllByRole("group", { name: /^Enlace/ });
    await usuario.selectOptions(within(enlaces[0]).getByLabelText("¿A dónde lleva?"), "externo");
    await usuario.type(campo(enlaces[0], /Dirección de la página/), "http://sitio-inseguro.com");
    await usuario.click(boton("Revisar"));
    assert.ok((await screen.findAllByText(/debe ser una dirección web completa que empiece por https:\/\//)).length >= 1, "el error sale junto al campo");

    fireEvent.change(campo(enlaces[0], /Dirección de la página/), { target: { value: "https://delacour.co/catalogo/delacour/mayor/0123456789abcdef0123456789abcdef" } });
    await usuario.click(boton("Revisar"));
    assert.ok((await screen.findAllByText(/No pongas el enlace del catálogo mayorista en el pie de página/)).length >= 1);
    assert.equal((await publicado()), null, "no salió nada a la tienda");
  });

  it("una red con el dominio equivocado se rechaza al revisar y dice cuál debía ser", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await usuario.click(await screen.findByRole("tab", { name: "Pie de página" }));
    await usuario.click(await screen.findByRole("button", { name: "Personalizar el pie de página" }));
    await usuario.click(await screen.findByRole("button", { name: "Agregar una red social" }));
    const red1 = await screen.findByRole("group", { name: "Red social 1" });
    fireEvent.change(campo(red1, /Dirección del perfil o @usuario/), { target: { value: "https://sitio-malo.com/delacour" } });
    await usuario.click(boton("Revisar"));
    assert.ok((await screen.findAllByText("El enlace no es de Instagram: copia la dirección de tu perfil en esa red.")).length >= 1);
  });

  it("quien solo puede consultar ve el pie sin controles de edición, y sin pie todavía no puede crearlo", async () => {
    publicar("delacour");
    const { usuario } = montar("t-agente-a");
    await usuario.click(await screen.findByRole("tab", { name: "Pie de página" }));
    assert.ok(await screen.findByText("Cuando un administrador lo personalice, lo verás aquí."));
    assert.equal(screen.queryByRole("button", { name: "Personalizar el pie de página" }), null);
  });
});

describe("preguntas frecuentes de la página «Mayoristas»", () => {
  async function sembrar(client: ReturnType<typeof createCmsClient>) {
    const contenido = (titulo: string, tema: string, orden: number, texto = "Respuesta.") => client.crear("contenido", { tema, audiencia: "todos", titulo, texto, palabras_clave: [], orden });
    for (const r of await Promise.all([
      contenido("Venta al por mayor", "mayoristas", 0, "Manejamos venta al por mayor."),
      contenido("¿Cómo compro?", "mayoristas", 20),
      contenido("¿Cuál es el mínimo?", "mayoristas", 10),
      contenido("Emprendimiento", "mayoristas", 5, "Guía para ARIA."),
      contenido("Envíos", "envios", 0, "Sí hacemos envíos."),
      contenido("Horario", "horarios", 0, "De lunes a sábado."),
    ])) assert.ok(r.ok, r.ok ? "" : r.error.message);
  }

  it("se ven como las ve el cliente: la introducción, las preguntas por su orden, lo que se suma al final y lo que no se muestra (ni lo que no es de la página)", async () => {
    publicar("delacour");
    const { usuario, client } = montar();
    await sembrar(client);
    await usuario.click(await screen.findByRole("tab", { name: "Preguntas frecuentes" }));
    await screen.findByRole("heading", { name: "Preguntas" });
    const grupo = (titulo: string) => screen.getByRole("heading", { name: titulo }).closest("section") as HTMLElement;
    const nombres = (seccion: HTMLElement) => within(seccion).getAllByRole("button").map((b) => b.getAttribute("aria-label")?.replace(/^Abrir /, ""));
    assert.deepEqual(nombres(grupo("Introducción")), ["Venta al por mayor"]);
    assert.deepEqual(nombres(grupo("Preguntas")), ["¿Cuál es el mínimo?", "¿Cómo compro?"], "primero el orden 10, luego el 20");
    assert.deepEqual(nombres(grupo("Se suman al final de la página")), ["Envíos"]);
    assert.deepEqual(nombres(grupo("No se muestran en la página")), ["Emprendimiento"]);
    assert.equal(screen.queryByText("Horario"), null, "un texto de otro tema que la página no usa no aparece aquí");
  });

  it("«Nueva pregunta» pide solo la pregunta y la respuesta, la deja como borrador al final del orden y abre el editor", async () => {
    publicar("delacour");
    const { usuario, client } = montar();
    await sembrar(client);
    await usuario.click(await screen.findByRole("tab", { name: "Preguntas frecuentes" }));
    await usuario.click(await screen.findByRole("button", { name: "Nueva pregunta" }));
    await usuario.click(screen.getByRole("button", { name: "Crear y revisar" }));
    assert.ok(await screen.findByText("Escribe la pregunta."));
    assert.ok(screen.getByText("Escribe la respuesta."));
    await usuario.type(screen.getByRole("textbox", { name: /^Pregunta/ }), "¿Tienen grupo de WhatsApp?");
    await usuario.type(screen.getByRole("textbox", { name: /^Respuesta/ }), "Sí, tenemos un grupo para clientes mayoristas.");
    await usuario.click(screen.getByRole("button", { name: "Crear y revisar" }));

    // Se abrió el editor del contenido recién creado, ya como pregunta del tema Mayoristas.
    assert.equal(((await screen.findByRole("textbox", { name: /Pregunta o título/ })) as HTMLInputElement).value, "¿Tienen grupo de WhatsApp?");
    const nueva = (await entidades("contenido")).find((e) => e.clave === "tienen-grupo-de-whatsapp");
    assert.ok(nueva);
    assert.equal(nueva.estado, "borrador");
    assert.deepEqual(nueva.borrador, { tema: "mayoristas", audiencia: "todos", titulo: "¿Tienen grupo de WhatsApp?", texto: "Sí, tenemos un grupo para clientes mayoristas.", palabras_clave: [], orden: 30 });
    assert.ok(screen.getByText(/también aparece como pregunta en la página «Mayoristas»/), "la vista previa avisa dónde aparecerá");
  });

  it("las preguntas van por su número «Orden» (y a igual número, por su nombre), no por cuándo se crearon ni por el alfabeto", async () => {
    publicar("delacour");
    const { usuario, client } = montar();
    // Se crean una por una en un orden que no es el del número, ni el alfabético, ni el inverso de la creación: solo ordenando por «Orden» sale esta lista.
    for (const [titulo, orden] of [["¿Ofrecen garantía?", 20], ["¿Aceptan pagos contra entrega?", 20], ["¿Venden por unidad?", 30], ["¿Cuál es la compra mínima?", 10]] as const) {
      const r = await client.crear("contenido", { tema: "mayoristas", audiencia: "todos", titulo, texto: "Respuesta.", palabras_clave: [], orden });
      assert.ok(r.ok, r.ok ? "" : r.error.message);
    }
    await usuario.click(await screen.findByRole("tab", { name: "Preguntas frecuentes" }));
    const seccion = (await screen.findByRole("heading", { name: "Preguntas" })).closest("section") as HTMLElement;
    assert.deepEqual(
      within(seccion)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")?.replace(/^Abrir /, "")),
      ["¿Cuál es la compra mínima?", "¿Aceptan pagos contra entrega?", "¿Ofrecen garantía?", "¿Venden por unidad?"],
    );
  });
});
