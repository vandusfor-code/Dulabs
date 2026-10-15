// Postgres embebido ANTES que jsdom (ver tienda.dom.test.tsx): este import debe ir primero.
import "@electric-sql/pglite";
import "@/lib/test-helpers/jsdom-setup";
/**
 * Administración de tienda — las PÁGINAS PROPIAS (política de privacidad, términos…), de punta a punta: pantalla (jsdom + Testing Library) → cliente del navegador → rutas reales (/api/dashboard/tienda/*) →
 * servicio → SQL real (Postgres embebido). La administradora escribe como en un mensaje; lo que se guarda son bloques; el backend vuelve a validar todo y la tienda solo recibe lo publicado.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createCmsClient } from "@/lib/cms-comercial-client";
import { crearLector } from "@/lib/cms-comercial/lector";
import { bloquesDeTexto, textoDeBloques } from "@/lib/cms-comercial/pagina";
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
  await pg.habilitarModulo(TA);
  db.table("dulabs_tenant_modulos").push({ id_tenant: TA, modulo: "cms_comercial", habilitado: true });
  db.table("dulabs_catalogo_categorias").push({ id: CAT_A, id_tenant: TA, nombre: "Aretes" });
  db.table("dulabs_agente_runtime_config").push({ id_tenant: TA, habilitado: true, created_at: "2026-09-01T00:00:00Z", negocio: { nombre_negocio: "Tienda A", pedido: { minimo_mayorista: 750000 } } });
});

afterEach(() => {
  cleanup();
  puente.restaurar();
  db.uninstall();
});

/** La tienda publicada del negocio con ese slug (de él depende el tema: «delacour» es joyería; cualquier otro, la tienda de siempre). */
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
/** Un cliente del administrador, para dejar listo lo que la prueba necesita sin pasar por la pantalla. */
const clienteAdmin = () => createCmsClient("t-admin-a", { fetch: crearFetchRutas().fetch });

const boton = (nombre: string | RegExp) => screen.getByRole("button", { name: nombre });
const areaTexto = () => screen.getByLabelText(/Texto de la página/) as HTMLTextAreaElement;
const entidades = (tipo: string) => pg.sql<{ clave: string; estado: string; borrador: Record<string, unknown> | null; rev: number }>("select clave, estado, borrador, rev from public.dulabs_cms_entidades where id_tenant = $1 and tipo = $2 order by clave", [TA, tipo]);
const snapshot = async () => crearLector(crearRepositorioSupabaseCms(pg.supabase)).cargar(TA);

const TEXTO = "## Qué datos recogemos\nSolo tu nombre y tu teléfono cuando nos escribes por WhatsApp.\nNunca los compartimos.\n\n- Tu nombre\n- Tu teléfono\n\nPuedes pedirnos que los borremos cuando quieras.";

/** Crea y deja abierta (en el editor) una página con ese título, desde la pestaña «Páginas». */
async function nuevaPagina(usuario: ReturnType<typeof userEvent.setup>, titulo = "Política de privacidad") {
  await usuario.click(await screen.findByRole("tab", { name: "Páginas" }));
  await screen.findByText("Todavía no hay páginas");
  await usuario.click(screen.getAllByRole("button", { name: "Nueva página" })[0]);
  await usuario.type(await screen.findByRole("textbox", { name: /Título de la página/ }), titulo);
  await usuario.click(boton("Crear y editar"));
  await screen.findByRole("textbox", { name: /Texto de la página/ });
}

describe("la pestaña «Páginas»", () => {
  it("con la tienda de tema joyería se ofrece, junto al pie de página", async () => {
    publicar("delacour");
    montar();
    assert.ok(await screen.findByRole("tab", { name: "Páginas" }));
    assert.ok(screen.getByRole("tab", { name: "Pie de página" }));
  });

  it("con una tienda de otro tema, o sin tienda publicada, no se ofrece: un editor que no cambia nada confunde", async () => {
    publicar("tienda-a", "Tienda A");
    montar();
    await screen.findByRole("link", { name: /Ver mi tienda/ });
    assert.equal(screen.queryByRole("tab", { name: "Páginas" }), null);
  });
});

describe("escribir, guardar y publicar una página", () => {
  it("se crea con su título, se escribe como un mensaje, se ve en la vista previa, se guarda en bloques y se publica; la tienda recibe lo publicado", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await nuevaPagina(usuario);

    // Nace como borrador, con la dirección que sale de su título.
    const creada = (await entidades("pagina"))[0];
    assert.deepEqual([creada.clave, creada.estado], ["politica-de-privacidad", "borrador"]);
    assert.ok(screen.getByText("/p/politica-de-privacidad"), "la dirección de la página, a la vista");
    assert.equal((screen.getByRole("textbox", { name: /Título de la página/ }) as HTMLInputElement).value, "Política de privacidad");

    // Escribe: la vista previa y el contador se mueven al instante.
    fireEvent.change(areaTexto(), { target: { value: TEXTO } });
    const previa = screen.getByTestId("previa");
    await waitFor(() => assert.ok(previa.textContent?.includes("Qué datos recogemos") && previa.textContent.includes("Tu teléfono") && previa.textContent.includes("Puedes pedirnos"), previa.textContent ?? ""));
    assert.ok(screen.getByText(/de 50\.000 caracteres · 4 de 200 bloques/));
    assert.ok(screen.getByText("Cambios sin guardar"));

    // Guardar: el servidor guarda BLOQUES (no el texto con marcas).
    await usuario.click(boton("Guardar borrador"));
    await waitFor(async () => assert.deepEqual((await entidades("pagina"))[0].borrador, { titulo: "Política de privacidad", bloques: bloquesDeTexto(TEXTO) }));
    assert.deepEqual(((await entidades("pagina"))[0].borrador as { bloques: unknown[] }).bloques[1], { tipo: "parrafo", texto: "Solo tu nombre y tu teléfono cuando nos escribes por WhatsApp.\nNunca los compartimos." });
    assert.equal((await snapshot())?.paginas.length, 0, "un borrador no sale a la tienda");
    assert.equal(screen.queryByRole("link", { name: "Ver la página en mi tienda" }), null, "un borrador no se puede abrir en la tienda");

    // Publicar: se revisa, se confirma y la tienda recibe exactamente lo publicado.
    await usuario.click(boton("Publicar"));
    await usuario.click(await screen.findByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));
    const snap = await snapshot();
    assert.equal(snap?.paginas.length, 1);
    assert.deepEqual(snap?.paginas[0].contenido, { titulo: "Política de privacidad", bloques: bloquesDeTexto(TEXTO) });

    // Y desde el panel se puede abrir en la tienda.
    const enlace = (await screen.findByRole("link", { name: "Ver la página en mi tienda" })) as HTMLAnchorElement;
    assert.equal(enlace.getAttribute("href"), "/catalogo/delacour/p/politica-de-privacidad");
    assert.equal(enlace.getAttribute("target"), "_blank");

    // En la lista de páginas, cada una dice su dirección.
    await usuario.click(boton("Volver a la lista"));
    const fila = await screen.findByRole("button", { name: "Abrir Política de privacidad" });
    assert.ok(fila.textContent?.includes("/p/politica-de-privacidad"), fila.textContent ?? "");
  });

  it("al volver a abrirla, el campo muestra el texto en su forma ordenada (una línea en blanco entre bloques) y editar uno de los párrafos dice qué cambió al publicar", async () => {
    publicar("delacour");
    const admin = clienteAdmin();
    const e = await admin.crear("pagina", { titulo: "Cambios y garantías", bloques: bloquesDeTexto(TEXTO) });
    assert.ok(e.ok);
    if (!e.ok) return;
    assert.equal((await admin.publicar(e.data.entidad.id, e.data.entidad.rev, null)).ok, true);

    const { usuario } = montar();
    await usuario.click(await screen.findByRole("tab", { name: "Páginas" }));
    await usuario.click(await screen.findByRole("button", { name: "Abrir Cambios y garantías" }));
    await waitFor(() => assert.equal(areaTexto().value, textoDeBloques(bloquesDeTexto(TEXTO))));
    assert.equal(areaTexto().value, "## Qué datos recogemos\n\nSolo tu nombre y tu teléfono cuando nos escribes por WhatsApp.\nNunca los compartimos.\n\n- Tu nombre\n- Tu teléfono\n\nPuedes pedirnos que los borremos cuando quieras.");

    fireEvent.change(areaTexto(), { target: { value: TEXTO.replace("Puedes pedirnos", "Puedes escribirnos para pedir") } });
    await usuario.click(boton("Publicar"));
    const dialogo = await screen.findByRole("dialog");
    assert.ok(within(dialogo).getByText("Texto de la página:"));
    assert.ok(within(dialogo).getByText("4 bloques"));
    assert.ok(within(dialogo).getByText("4 bloques, 1 con cambios"));
    await usuario.click(within(dialogo).getByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 2/));
    assert.match(JSON.stringify((await snapshot())?.paginas[0].contenido), /Puedes escribirnos para pedir/);
  });
});

describe("mientras se escribe", () => {
  it("el texto no se «arregla» mientras teclea: un guion y un espacio al final se quedan donde están", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await nuevaPagina(usuario);
    await usuario.click(areaTexto());
    await usuario.type(areaTexto(), "Hola{Enter}{Enter}- ");
    assert.equal(areaTexto().value, "Hola\n\n- ");
    await usuario.type(areaTexto(), "Uno{Enter}- Dos");
    assert.equal(areaTexto().value, "Hola\n\n- Uno\n- Dos");
  });

  it("«Agregar un subtítulo» y «Agregar una lista» dejan la marca al final, separada por una línea en blanco, con el cursor listo", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await nuevaPagina(usuario);
    fireEvent.change(areaTexto(), { target: { value: "Un párrafo.\n\n" } });
    await usuario.click(boton("Agregar un subtítulo"));
    assert.equal(areaTexto().value, "Un párrafo.\n\n## ");
    await waitFor(() => assert.equal(document.activeElement, areaTexto()));
    fireEvent.change(areaTexto(), { target: { value: "Un párrafo.\n\n## Título" } });
    await usuario.click(boton("Agregar una lista"));
    assert.equal(areaTexto().value, "Un párrafo.\n\n## Título\n\n- ");
  });

  it("los problemas del texto salen al instante, con el comienzo del bloque (HTML, un párrafo demasiado largo)", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await nuevaPagina(usuario);
    fireEvent.change(areaTexto(), { target: { value: "Bien escrito.\n\nMira <b>esto</b> ahora" } });
    const alerta = await screen.findByText("«Mira <b>esto</b> ahora»: El párrafo no puede contener etiquetas HTML: escribe texto plano.");
    assert.equal(alerta.closest("[role=alert]")?.id, areaTexto().getAttribute("aria-describedby"));
    assert.equal(areaTexto().getAttribute("aria-invalid"), "true");

    fireEvent.change(areaTexto(), { target: { value: `${"palabra ".repeat(300)}final` } });
    assert.ok(await screen.findByText(/«palabra palabra palabra palabra palabra…»: El párrafo no puede superar 2000 caracteres\./));
    assert.equal(areaTexto().getAttribute("aria-invalid"), "true");

    fireEvent.change(areaTexto(), { target: { value: "Ya está bien." } });
    await waitFor(() => assert.equal(screen.queryByRole("alert"), null));
  });

  it("lo que el servidor rechaza al revisar se muestra junto al texto (y en el panel de problemas): sin texto, o con el enlace del catálogo mayorista", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await nuevaPagina(usuario);
    /** La lista de problemas pegada al campo de texto (no solo el panel lateral): es la que el campo señala con aria-describedby. */
    const juntoAlTexto = async () => {
      await waitFor(() => assert.ok(areaTexto().getAttribute("aria-describedby"), "el campo señala su lista de problemas"));
      return document.getElementById(areaTexto().getAttribute("aria-describedby") ?? "") as HTMLElement;
    };

    await usuario.click(boton("Revisar"));
    assert.ok(within(await juntoAlTexto()).getByText("Escribe el texto de la página."));
    assert.ok((await screen.findAllByText("Escribe el texto de la página.")).length >= 2, "y también en el panel de problemas");

    fireEvent.change(areaTexto(), { target: { value: "Entra a /catalogo/delacour/mayor/0123456789abcdef0123456789abcdef" } });
    await waitFor(() => assert.equal(areaTexto().getAttribute("aria-describedby"), null), { timeout: 3000 });
    await usuario.click(boton("Revisar"));
    assert.ok(within(await juntoAlTexto()).getByText(/^«Entra a \/catalogo\/delacour\/mayor\/0123456…»: No pongas el enlace del catálogo mayorista en una página de la tienda: la verían todos los clientes\.$/));
    assert.equal((await snapshot())?.paginas.length, 0, "no salió nada a la tienda");
  });

  it("«Descartar» devuelve el campo al último texto guardado", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await nuevaPagina(usuario);
    fireEvent.change(areaTexto(), { target: { value: "Texto guardado." } });
    await usuario.click(boton("Guardar borrador"));
    await waitFor(async () => assert.deepEqual(((await entidades("pagina"))[0].borrador as { bloques: unknown[] }).bloques, [{ tipo: "parrafo", texto: "Texto guardado." }]));

    fireEvent.change(areaTexto(), { target: { value: "Texto que no quiero." } });
    await usuario.click(boton("Descartar los cambios"));
    await usuario.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Descartar" }));
    await waitFor(() => assert.equal(areaTexto().value, "Texto guardado."));
  });
});

describe("enlazar una página desde el pie", () => {
  async function abrirPie(usuario: ReturnType<typeof userEvent.setup>) {
    await usuario.click(await screen.findByRole("tab", { name: "Pie de página" }));
    await usuario.click(await screen.findByRole("button", { name: "Personalizar el pie de página" }));
    return screen.findByRole("group", { name: "Columna 1" });
  }

  it("sin páginas todavía, «Una de mis páginas» no se ofrece", async () => {
    publicar("delacour");
    const { usuario } = montar();
    const columna1 = await abrirPie(usuario);
    const destinos = within(within(columna1).getAllByRole("group", { name: /^Enlace/ })[0]).getByLabelText("¿A dónde lleva?") as HTMLSelectElement;
    assert.ok(![...destinos.options].some((o) => o.value === "pagina"));
  });

  it("con páginas se ofrece; al elegirla se propone su título como texto del enlace; publicado el pie, apunta a la página por su código", async () => {
    publicar("delacour");
    const admin = clienteAdmin();
    // Un borrador antes y otro después de la publicada: la lista no puede «acertar» por quedar primera o última.
    assert.ok((await admin.crear("pagina", { titulo: "Aviso legal", bloques: bloquesDeTexto("Texto.") })).ok);
    const e = await admin.crear("pagina", { titulo: "Política de privacidad", bloques: bloquesDeTexto(TEXTO) });
    assert.ok(e.ok);
    if (!e.ok) return;
    await admin.publicar(e.data.entidad.id, e.data.entidad.rev, null);
    assert.ok((await admin.crear("pagina", { titulo: "Términos (borrador)", bloques: bloquesDeTexto("Texto.") })).ok);

    const { usuario } = montar();
    const columna1 = await abrirPie(usuario);
    await usuario.click(within(columna1).getByRole("button", { name: "Agregar un enlace" }));
    const enlaces = within(columna1).getAllByRole("group", { name: /^Enlace/ });
    const nuevo = enlaces[enlaces.length - 1];
    const destinos = within(nuevo).getByLabelText("¿A dónde lleva?") as HTMLSelectElement;
    await waitFor(() => assert.ok([...destinos.options].some((o) => o.value === "pagina"), "se ofrece cuando ya hay páginas"));
    await usuario.selectOptions(destinos, "pagina");

    assert.equal((within(nuevo).getByLabelText("Página") as HTMLSelectElement).value, "politica-de-privacidad", "elige la publicada");
    assert.equal((within(nuevo).getByLabelText(/Texto del enlace/) as HTMLInputElement).value, "Política de privacidad", "propone el título de la página");

    await usuario.click(boton("Publicar"));
    await usuario.click(await screen.findByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));
    const pie = (await snapshot())?.pie?.contenido;
    assert.deepEqual(pie?.columnas[0].enlaces.at(-1), { texto: "Política de privacidad", destino: { tipo: "pagina", clave: "politica-de-privacidad" } });
  });

  it("un enlace a una página sin publicar se avisa al revisar (no se verá hasta publicarla) pero no impide publicar el pie", async () => {
    publicar("delacour");
    const admin = clienteAdmin();
    const borrador = await admin.crear("pagina", { titulo: "Términos y condiciones", bloques: bloquesDeTexto("Texto.") });
    assert.ok(borrador.ok);

    const { usuario } = montar();
    const columna1 = await abrirPie(usuario);
    await usuario.click(within(columna1).getByRole("button", { name: "Agregar un enlace" }));
    const enlaces = within(columna1).getAllByRole("group", { name: /^Enlace/ });
    const nuevo = enlaces[enlaces.length - 1];
    const destinos = within(nuevo).getByLabelText("¿A dónde lleva?") as HTMLSelectElement;
    await waitFor(() => assert.ok([...destinos.options].some((o) => o.value === "pagina")));
    await usuario.selectOptions(destinos, "pagina");
    assert.ok(within(nuevo).getByText(/Esta página todavía no está publicada/));
    assert.ok(within(nuevo).getByRole("option", { name: "Términos y condiciones (sin publicar)" }));

    await usuario.click(boton("Revisar"));
    assert.ok(await screen.findByText(/hoy no está publicada: el enlace no aparecerá en el pie hasta que la publiques/));
    assert.ok(screen.getByText("Todo en orden"), "es una advertencia, no un error");
  });
});

describe("quien solo puede consultar", () => {
  it("ve las páginas pero no puede crear, editar ni publicar", async () => {
    publicar("delacour");
    const admin = clienteAdmin();
    assert.ok((await admin.crear("pagina", { titulo: "Política de privacidad", bloques: bloquesDeTexto("Texto.") })).ok);

    const { usuario } = montar("t-agente-a");
    await usuario.click(await screen.findByRole("tab", { name: "Páginas" }));
    assert.equal(screen.queryByRole("button", { name: "Nueva página" }), null);
    await usuario.click(await screen.findByRole("button", { name: "Abrir Política de privacidad" }));
    await waitFor(() => assert.equal(areaTexto().value, "Texto."));
    assert.equal(areaTexto().disabled, true);
    assert.equal(screen.queryByRole("button", { name: "Agregar un subtítulo" }), null);
    assert.equal(screen.queryByRole("button", { name: "Publicar" }), null);
  });
});
