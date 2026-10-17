// Postgres embebido ANTES que jsdom (ver tienda.dom.test.tsx): este import debe ir primero.
import "@electric-sql/pglite";
import "@/lib/test-helpers/jsdom-setup";
/**
 * Administración de tienda — una PÁGINA PROPIA en el MENÚ DE ARRIBA de la tienda, de punta a punta: pantalla (jsdom + Testing Library) → cliente del navegador → rutas reales (/api/dashboard/tienda/*) →
 * servicio → SQL real (Postgres embebido) → lector del CMS → el menú que recibe la tienda. La administradora enciende «Mostrar esta página en el menú de arriba», puede ponerle un texto corto, y al
 * publicar la tienda recibe exactamente eso; el backend vuelve a validar (título que no cabe, menú lleno).
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createCmsClient } from "@/lib/cms-comercial-client";
import { MENSAJE_TEXTO_MENU_LARGO } from "@/lib/cms-comercial/esquemas";
import { crearLector } from "@/lib/cms-comercial/lector";
import { bloquesDeTexto, paginasDelMenu } from "@/lib/cms-comercial/pagina";
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
  // La tienda de tema joyería (el slug «delacour» es el que dibuja páginas propias).
  db.table("dulabs_catalogo_publicacion").push({ id_tenant: TA, slug: "delacour", nombre_publico: "Delacour & Orus", publicado: true, token_mayor: "f".repeat(64) });
});

afterEach(() => {
  cleanup();
  puente.restaurar();
  db.uninstall();
});

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
const clienteAdmin = () => createCmsClient("t-admin-a", { fetch: crearFetchRutas().fetch });

const boton = (nombre: string | RegExp) => screen.getByRole("button", { name: nombre });
const areaTexto = () => screen.getByLabelText(/Texto de la página/) as HTMLTextAreaElement;
const interruptor = () => screen.getByRole("switch", { name: /Mostrar esta página en el menú de arriba/ }) as HTMLButtonElement;
const campoMenu = () => screen.getByRole("textbox", { name: /Texto en el menú/ }) as HTMLInputElement;
const snapshot = async () => crearLector(crearRepositorioSupabaseCms(pg.supabase)).cargar(TA);
const entidades = () => pg.sql<{ clave: string; estado: string; borrador: Record<string, unknown> | null }>("select clave, estado, borrador from public.dulabs_cms_entidades where id_tenant = $1 and tipo = 'pagina' order by clave", [TA]);

/** Crea y deja abierta (en el editor) una página con ese título, desde la pestaña «Páginas». */
async function nuevaPagina(usuario: ReturnType<typeof userEvent.setup>, titulo: string) {
  await usuario.click(await screen.findByRole("tab", { name: "Páginas" }));
  await screen.findByText("Todavía no hay páginas");
  await usuario.click(screen.getAllByRole("button", { name: "Nueva página" })[0]);
  await usuario.type(await screen.findByRole("textbox", { name: /Título de la página/ }), titulo);
  await usuario.click(boton("Crear y editar"));
  await screen.findByRole("textbox", { name: /Texto de la página/ });
}

/** Una página ya publicada, creada sin pasar por la pantalla (con o sin menú). */
async function paginaPublicada(titulo: string, extra: Record<string, unknown> = {}) {
  const admin = clienteAdmin();
  const e = await admin.crear("pagina", { titulo, bloques: bloquesDeTexto("Texto de la página."), ...extra });
  assert.ok(e.ok, `crear «${titulo}»`);
  if (!e.ok) throw new Error("no se creó");
  const p = await admin.publicar(e.data.entidad.id, e.data.entidad.rev, null);
  assert.ok(p.ok, `publicar «${titulo}»: ${p.ok ? "" : p.error.message}`);
  return e.data.entidad;
}

describe("el interruptor del menú en el editor de la página", () => {
  it("una página nueva nace SIN menú: el interruptor apagado y el campo del texto no se ve", async () => {
    const { usuario } = montar();
    await nuevaPagina(usuario, "Quiénes somos");
    assert.equal(interruptor().getAttribute("aria-checked"), "false");
    assert.equal(screen.queryByRole("textbox", { name: /Texto en el menú/ }), null);
    assert.equal(screen.queryByTestId("previa-menu-pagina"), null, "sin menú, la vista previa no habla del menú");
    assert.ok(screen.getByText("Menú de arriba de la tienda"));
    assert.ok(screen.getByText("En el menú caben hasta 4 páginas."));
  });

  it("al encenderlo aparece el texto del menú (con el título como pista) y la vista previa muestra cómo se verá en el menú", async () => {
    const { usuario } = montar();
    await nuevaPagina(usuario, "Quiénes somos");
    await usuario.click(interruptor());
    assert.equal(interruptor().getAttribute("aria-checked"), "true");
    assert.equal(campoMenu().placeholder, "Quiénes somos", "la pista es el título: es lo que dirá si lo deja vacío");
    assert.ok(screen.getByText(/Si lo dejas vacío, el menú dice «Quiénes somos»\. Máximo 24 caracteres\./));
    assert.equal(campoMenu().maxLength, 24);
    const previa = screen.getByTestId("previa-menu-pagina");
    assert.ok(previa.textContent?.includes("Quiénes somos"), previa.textContent ?? "");

    await usuario.type(campoMenu(), "Nosotros");
    await waitFor(() => assert.ok(screen.getByTestId("previa-menu-pagina").textContent?.includes("Nosotros")));
    assert.ok(!screen.getByTestId("previa-menu-pagina").textContent?.includes("Quiénes somos"), "con texto propio, la vista previa dice ese texto");
  });

  it("apagarlo quita también el texto que había escrito para el menú: «sin menú» tiene una sola forma", async () => {
    const { usuario } = montar();
    await nuevaPagina(usuario, "Quiénes somos");
    await usuario.click(interruptor());
    await usuario.type(campoMenu(), "Nosotros");
    await usuario.click(interruptor());
    assert.equal(interruptor().getAttribute("aria-checked"), "false");
    assert.equal(screen.queryByRole("textbox", { name: /Texto en el menú/ }), null);
    await usuario.click(interruptor());
    assert.equal(campoMenu().value, "", "al volver a encenderlo, el campo empieza vacío");
    // Y lo que se guardó no lleva restos del menú.
    await usuario.click(interruptor());
    fireEvent.change(areaTexto(), { target: { value: "Somos una joyería." } });
    await usuario.click(boton("Guardar borrador"));
    await waitFor(async () => assert.deepEqual((await entidades())[0].borrador, { titulo: "Quiénes somos", bloques: [{ tipo: "parrafo", texto: "Somos una joyería." }] }));
  });

  it("quien solo puede consultar ve el interruptor bloqueado", async () => {
    await paginaPublicada("Quiénes somos", { en_menu: true, texto_menu: "Nosotros" });
    const { usuario } = montar("t-agente-a");
    await usuario.click(await screen.findByRole("tab", { name: "Páginas" }));
    await usuario.click(await screen.findByRole("button", { name: "Abrir Quiénes somos" }));
    await waitFor(() => assert.equal(areaTexto().value, "Texto de la página."));
    assert.equal(interruptor().disabled, true);
    assert.equal(interruptor().getAttribute("aria-checked"), "true", "ve cómo está, aunque no pueda cambiarlo");
    assert.equal(campoMenu().disabled, true);
    assert.equal(campoMenu().value, "Nosotros");
  });
});

describe("publicar una página con menú: la tienda recibe exactamente lo que se eligió", () => {
  it("encendido y con su texto: lo publicado lleva «en menú» y el texto, y el menú de la tienda sale de ahí", async () => {
    const { usuario } = montar();
    await nuevaPagina(usuario, "Quiénes somos");
    fireEvent.change(areaTexto(), { target: { value: "Somos una joyería de Medellín." } });
    await usuario.click(interruptor());
    await usuario.type(campoMenu(), "Nosotros");
    await usuario.click(boton("Publicar"));
    await usuario.click(await screen.findByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));

    const snap = await snapshot();
    assert.deepEqual(snap?.paginas[0].contenido, { titulo: "Quiénes somos", bloques: [{ tipo: "parrafo", texto: "Somos una joyería de Medellín." }], en_menu: true, texto_menu: "Nosotros" });
    assert.deepEqual(paginasDelMenu(snap), [{ clave: "quienes-somos", texto: "Nosotros" }]);
  });

  it("encendido y sin texto propio: el menú dice el título de la página", async () => {
    const { usuario } = montar();
    await nuevaPagina(usuario, "Quiénes somos");
    fireEvent.change(areaTexto(), { target: { value: "Somos una joyería." } });
    await usuario.click(interruptor());
    await usuario.click(boton("Publicar"));
    await usuario.click(await screen.findByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));
    assert.deepEqual(paginasDelMenu(await snapshot()), [{ clave: "quienes-somos", texto: "Quiénes somos" }]);
  });

  it("apagado (o sin tocar): lo publicado es exactamente lo de siempre, sin ningún campo de menú, y la tienda no cambia", async () => {
    const { usuario } = montar();
    await nuevaPagina(usuario, "Política de privacidad");
    fireEvent.change(areaTexto(), { target: { value: "Texto." } });
    await usuario.click(boton("Publicar"));
    await usuario.click(await screen.findByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));
    const snap = await snapshot();
    assert.deepEqual(snap?.paginas[0].contenido, { titulo: "Política de privacidad", bloques: [{ tipo: "parrafo", texto: "Texto." }] });
    assert.deepEqual(paginasDelMenu(snap), []);
  });

  it("apagar el menú de una página publicada: el diálogo de publicar lo dice «Sí → No» y la tienda la saca del menú", async () => {
    await paginaPublicada("Quiénes somos", { en_menu: true, texto_menu: "Nosotros" });
    assert.equal(paginasDelMenu(await snapshot()).length, 1);

    const { usuario } = montar();
    await usuario.click(await screen.findByRole("tab", { name: "Páginas" }));
    await usuario.click(await screen.findByRole("button", { name: "Abrir Quiénes somos" }));
    await waitFor(() => assert.equal(areaTexto().value, "Texto de la página."));
    assert.equal(interruptor().getAttribute("aria-checked"), "true");
    assert.equal(campoMenu().value, "Nosotros");

    await usuario.click(interruptor());
    await usuario.click(boton("Publicar"));
    const dialogo = await screen.findByRole("dialog");
    assert.ok(within(dialogo).getByText("Mostrar en el menú de arriba:"));
    assert.ok(within(dialogo).getByText("Sí"));
    assert.ok(within(dialogo).getByText("No"));
    assert.ok(within(dialogo).getByText("Texto en el menú:"));
    assert.ok(within(dialogo).getByText("Nosotros"));
    await usuario.click(within(dialogo).getByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 2/));

    const snap = await snapshot();
    assert.deepEqual(snap?.paginas[0].contenido, { titulo: "Quiénes somos", bloques: [{ tipo: "parrafo", texto: "Texto de la página." }] });
    assert.deepEqual(paginasDelMenu(snap), []);
  });

  it("encender el menú de una página ya publicada es un cambio que se puede publicar (el borrador se distingue de lo publicado)", async () => {
    await paginaPublicada("Quiénes somos");
    const { usuario } = montar();
    await usuario.click(await screen.findByRole("tab", { name: "Páginas" }));
    await usuario.click(await screen.findByRole("button", { name: "Abrir Quiénes somos" }));
    await waitFor(() => assert.equal(areaTexto().value, "Texto de la página."));
    assert.equal((boton("Publicar") as HTMLButtonElement).disabled, true, "sin cambios no hay nada por publicar");

    await usuario.click(interruptor());
    await waitFor(() => assert.equal((boton("Publicar") as HTMLButtonElement).disabled, false));
    await usuario.click(boton("Publicar"));
    const dialogo = await screen.findByRole("dialog");
    assert.ok(within(dialogo).getByText("Mostrar en el menú de arriba:"));
    await usuario.click(within(dialogo).getByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 2/));
    assert.deepEqual(paginasDelMenu(await snapshot()), [{ clave: "quienes-somos", texto: "Quiénes somos" }]);
  });
});

describe("un título que no cabe en el menú", () => {
  const LARGO = "Política de tratamiento de datos personales";

  it("se le dice mientras escribe, bajo «Texto en el menú», y el aviso desaparece cuando escribe un texto corto", async () => {
    const { usuario } = montar();
    await nuevaPagina(usuario, LARGO);
    assert.equal(screen.queryByText(MENSAJE_TEXTO_MENU_LARGO), null, "con el menú apagado un título largo no estorba");
    await usuario.click(interruptor());
    assert.ok(await screen.findByText(MENSAJE_TEXTO_MENU_LARGO));
    assert.equal(campoMenu().getAttribute("aria-invalid"), "true");

    await usuario.type(campoMenu(), "Tus datos");
    await waitFor(() => assert.equal(screen.queryByText(MENSAJE_TEXTO_MENU_LARGO), null));
    assert.notEqual(campoMenu().getAttribute("aria-invalid"), "true");
  });

  it("el servidor no lo deja publicar: el mensaje sale al revisar y no se publica nada", async () => {
    const { usuario } = montar();
    await nuevaPagina(usuario, LARGO);
    fireEvent.change(areaTexto(), { target: { value: "Tratamos tus datos con cuidado." } });
    await usuario.click(interruptor());
    await usuario.click(boton("Publicar"));
    assert.ok((await screen.findAllByText(MENSAJE_TEXTO_MENU_LARGO)).length >= 1);
    assert.equal(screen.queryByRole("button", { name: "Publicar ahora" }), null, "no se llegó al diálogo de publicar");
    assert.equal((await snapshot())?.paginas.length, 0);

    await usuario.type(campoMenu(), "Tus datos");
    await usuario.click(boton("Publicar"));
    await usuario.click(await screen.findByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));
    assert.deepEqual(paginasDelMenu(await snapshot()), [{ clave: "politica-de-tratamiento-de-datos-personales", texto: "Tus datos" }]);
  });
});

describe("el menú lleno", () => {
  async function cuatroEnElMenu() {
    const creadas = [];
    for (const titulo of ["Contacto", "Envíos", "Cambios", "Garantía"]) creadas.push(await paginaPublicada(titulo, { en_menu: true }));
    assert.equal(paginasDelMenu(await snapshot()).length, 4);
    return creadas;
  }

  it("una quinta página no se publica en el menú: el mensaje dice cuáles ya están y qué hacer, y nada sale a la tienda", async () => {
    await cuatroEnElMenu();
    const { usuario } = montar();
    await usuario.click(await screen.findByRole("tab", { name: "Páginas" }));
    await usuario.click(screen.getAllByRole("button", { name: "Nueva página" })[0]);
    await usuario.type(await screen.findByRole("textbox", { name: /Título de la página/ }), "Quiénes somos");
    await usuario.click(boton("Crear y editar"));
    await screen.findByRole("textbox", { name: /Texto de la página/ });
    fireEvent.change(areaTexto(), { target: { value: "Somos una joyería." } });
    await usuario.click(interruptor());
    await usuario.click(boton("Publicar"));

    const avisos = await screen.findAllByText(/El menú de arriba admite 4 páginas y ya tiene «Contacto», «Envíos», «Cambios», «Garantía»\. Quita una del menú/);
    assert.ok(avisos.length >= 1);
    // Y el aviso está pegado al interruptor del menú (no solo en el panel de problemas), como una alerta.
    const tarjetaMenu = screen.getByText("Menú de arriba de la tienda").closest("section") as HTMLElement;
    assert.match(within(tarjetaMenu).getByRole("alert").textContent ?? "", /^El menú de arriba admite 4 páginas y ya tiene «Contacto»/);
    assert.equal(screen.queryByRole("button", { name: "Publicar ahora" }), null);
    const snap = await snapshot();
    assert.equal(snap?.paginas.length, 4, "la quinta no salió");
    assert.equal(paginasDelMenu(snap).length, 4);
  });

  it("la misma página sin el menú sí se publica (el tope es solo del menú), y editar una de las cuatro del menú no se bloquea a sí misma", async () => {
    await cuatroEnElMenu();
    const { usuario } = montar();
    await usuario.click(await screen.findByRole("tab", { name: "Páginas" }));
    await usuario.click(await screen.findByRole("button", { name: "Abrir Contacto" }));
    await waitFor(() => assert.equal(areaTexto().value, "Texto de la página."));
    fireEvent.change(areaTexto(), { target: { value: "Texto nuevo de contacto." } });
    await usuario.click(boton("Publicar"));
    await usuario.click(await screen.findByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 2/));
    assert.equal(paginasDelMenu(await snapshot()).length, 4, "sigue en el menú, con su lugar");
  });
});
