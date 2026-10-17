// Postgres embebido ANTES que jsdom (ver tienda.dom.test.tsx): este import debe ir primero.
import "@electric-sql/pglite";
import "@/lib/test-helpers/jsdom-setup";
/**
 * Administración de tienda — el MÍNIMO de la compra inicial mayorista en «Preguntas frecuentes», de punta a punta: pantalla (jsdom + Testing Library) → cliente del navegador → rutas reales
 * (/api/dashboard/tienda/*) → adaptador → SQL real (Postgres embebido) con las tablas reales del asistente. La administradora ve el monto, lo cambia confirmando lo que cambia, y el backend vuelve a validar
 * todo (rol, rango, que nadie lo haya cambiado mientras tanto, que el asistente siga cargando su configuración); la pantalla nunca es la autoridad.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createCmsClient } from "@/lib/cms-comercial-client";
import { crearFetchRutas } from "@/lib/cms-comercial/testing/fetch-rutas";
import { crearBaseCms, rutaMigracion, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { instalarPuenteRpcCms, type PuenteRpc } from "@/lib/cms-comercial/testing/puente-rpc";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { CatalogToastProvider } from "@/components/dashboard/catalogo/ui";
import { TiendaApp } from "@/components/dashboard/tienda/TiendaApp";

configure({ asyncUtilTimeout: 6000 });

const TA = "aaaaaaaa-0000-4000-8000-00000000000a";
const ADMIN = "d0000000-0000-4000-8000-000000000001";
const CAT_A = "c0000000-0000-4000-8000-0000000000a1";

let pg: BaseCms;
let db: SupabaseMemoria;
let puente: PuenteRpc;

before(async () => {
  pg = await crearBaseCms();
  for (const archivo of ["20261109000000_dulabs_agente_runtime.sql", "20261201000000_dulabs_agente_negocio_64kb.sql", "20261214000000_dulabs_agente_minimo_mayorista.sql"]) {
    await pg.db.exec(readFileSync(rutaMigracion(archivo), "utf8"));
  }
});
after(async () => {
  await pg.cerrar();
});

/** Una configuración del asistente como la de Delacour, con el monto escrito a mano en dos textos. */
const negocio = (minimo = 750000, texto = "$750.000") => ({
  nombre_negocio: "Tienda",
  inicio: { mayor: `La compra inicial mayorista parte de ${texto}.` },
  conocimiento: [{ tema: "mayoristas", info: `Primera compra desde ${texto}. No confundir con 1.750.000.` }],
  pedido: { minimo_mayorista: minimo },
});
let serie = 0;
async function linea(neg: unknown) {
  serie += 1;
  const telefono = `5730000${String(serie).padStart(5, "0")}`;
  await pg.db.query(
    `insert into public.dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, herramientas, negocio)
     values ($1, $2, 'catalog_sales', true, 'gemini', 'gemini-2.5-flash', 'env:GEMINI_KEY_PRUEBA', array['buscar_catalogo'], $3::jsonb)`,
    [TA, telefono, JSON.stringify(neg)],
  );
  return telefono;
}
const negocioDe = async (telefono: string) => (await pg.sql<{ negocio: ReturnType<typeof negocio> }>("select negocio from public.dulabs_agente_runtime_config where phone_number_id = $1", [telefono]))[0].negocio;
const auditoria = () => pg.sql<{ actor_user_id: string; antes: { minimo: number }; despues: { minimo: number } }>("select actor_user_id, antes, despues from public.dulabs_agente_config_cambios order by id");

beforeEach(async () => {
  await pg.aplicarSql("truncate public.dulabs_cms_auditoria, public.dulabs_cms_versiones, public.dulabs_cms_assets, public.dulabs_cms_entidades cascade");
  await pg.db.exec("delete from public.dulabs_agente_runtime_config");
  await pg.db.exec("alter table public.dulabs_agente_config_cambios disable trigger dulabs_agente_config_cambios_inmutables; delete from public.dulabs_agente_config_cambios; alter table public.dulabs_agente_config_cambios enable trigger dulabs_agente_config_cambios_inmutables");
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
  // «delacour» es la tienda de tema joyería con página de mayoristas: la que ofrece «Preguntas frecuentes».
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
async function abrir(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(await screen.findByRole("tab", { name: "Preguntas frecuentes" }));
  await screen.findByText("Monto mínimo de la compra mayorista");
}
const monto = () => screen.getByTestId("minimo-actual").textContent;
const campo = () => screen.getByLabelText("Nuevo monto mínimo") as HTMLInputElement;
const boton = (nombre: string | RegExp) => screen.getByRole("button", { name: nombre });

describe("el monto en «Preguntas frecuentes»", () => {
  it("muestra el monto de hoy y, a quien administra, un campo para cambiarlo", async () => {
    await linea(negocio());
    const { usuario } = montar();
    await abrir(usuario);
    await waitFor(() => assert.equal(monto(), "$750.000"));
    assert.ok(campo());
    assert.equal((boton("Cambiar monto") as HTMLButtonElement).disabled, true, "sin escribir nada no hay nada que cambiar");
  });

  it("quien solo consulta ve el monto pero no puede cambiarlo, y lo sabe", async () => {
    await linea(negocio());
    const { usuario } = montar("t-agente-a");
    await abrir(usuario);
    await waitFor(() => assert.equal(monto(), "$750.000"));
    assert.equal(screen.queryByLabelText("Nuevo monto mínimo"), null);
    assert.ok(screen.getByText("Solo un administrador puede cambiarlo."));
  });

  it("sin ningún mínimo configurado dice que todavía no está configurado y no ofrece cambiarlo", async () => {
    const { usuario } = montar();
    await abrir(usuario);
    await screen.findByText("Todavía no está configurado");
    assert.ok(screen.getByText(/Tu asistente todavía no tiene un mínimo configurado/));
    assert.equal(screen.queryByLabelText("Nuevo monto mínimo"), null);
  });

  it("con líneas de montos distintos no elige por la persona: lo explica y no ofrece cambiarlo", async () => {
    await linea(negocio(750000));
    await linea(negocio(900000, "$900.000"));
    const { usuario } = montar();
    await abrir(usuario);
    await screen.findByText(/Tus líneas de WhatsApp tienen montos mínimos distintos/);
    assert.equal(screen.queryByLabelText("Nuevo monto mínimo"), null);
  });

  it("antes de aplicar la migración muestra el monto de siempre y avisa que cambiarlo todavía no está activo (nada se rompe)", async () => {
    puente.restaurar();
    const vieja = await crearBaseCms();
    await vieja.habilitarModulo(TA);
    const puenteViejo = instalarPuenteRpcCms(vieja, process.env.SUPABASE_URL as string, {});
    try {
      const { usuario } = montar();
      await abrir(usuario);
      await waitFor(() => assert.equal(monto(), "$750.000"));
      assert.ok(await screen.findByText(/todavía no está activo para tu negocio/));
      assert.equal(screen.queryByLabelText("Nuevo monto mínimo"), null);
    } finally {
      puenteViejo.restaurar();
      await vieja.cerrar();
    }
  });
});

describe("cambiar el monto", () => {
  it("se escribe solo con dígitos (con puntos de miles a la vista), se confirma diciendo qué cambia y, al aceptar, se aplica al instante en el asistente, con auditoría", async () => {
    const a = await linea(negocio());
    const { usuario } = montar();
    await abrir(usuario);
    await waitFor(() => assert.equal(monto(), "$750.000"));

    fireEvent.change(campo(), { target: { value: "9x00y000" } });
    assert.equal(campo().value, "900.000", "solo dígitos, con puntos de miles");
    await usuario.click(boton("Cambiar monto"));

    const dialogo = await screen.findByRole("dialog");
    assert.ok(within(dialogo).getByText("Cambiar el mínimo de $750.000 a $900.000"));
    const efectos = within(dialogo).getByTestId("efectos-minimo");
    assert.ok(within(efectos).getByText(/El asistente pedirá \$900\.000 como mínimo en la primera compra de un mayorista/));
    assert.ok(within(efectos).getByText(/Los textos que usan \{\{minimo_mayorista\}\} mostrarán \$900\.000/));
    const lugares = within(dialogo).getByTestId("textos-del-asistente");
    assert.ok(within(lugares).getByText("El mensaje que el asistente manda cuando el cliente elige comprar por mayor"));
    assert.ok(within(lugares).getByText("La información oficial que el asistente conoce de tu negocio"));
    assert.equal((await negocioDe(a)).pedido.minimo_mayorista, 750000, "mientras no se confirma, no cambia nada");

    await usuario.click(within(dialogo).getByRole("button", { name: "Sí, cambiar a $900.000" }));
    assert.ok(await screen.findByText("Mínimo actualizado a $900.000. También se actualizó el monto escrito en 2 textos del asistente."));
    await waitFor(() => assert.equal(monto(), "$900.000"));
    assert.equal(screen.queryByRole("dialog"), null);
    assert.equal(campo().value, "", "el campo queda vacío");

    const nuevo = await negocioDe(a);
    assert.equal(nuevo.pedido.minimo_mayorista, 900000);
    assert.equal(nuevo.inicio.mayor, "La compra inicial mayorista parte de $900.000.");
    assert.equal(nuevo.conocimiento[0].info, "Primera compra desde $900.000. No confundir con 1.750.000.");
    const filas = await auditoria();
    assert.equal(filas.length, 1);
    assert.deepEqual([filas[0].actor_user_id, filas[0].antes.minimo, filas[0].despues.minimo], [ADMIN, 750000, 900000]);
  });

  it("«Cancelar» no cambia nada", async () => {
    const a = await linea(negocio());
    const { usuario } = montar();
    await abrir(usuario);
    await waitFor(() => assert.equal(monto(), "$750.000"));
    fireEvent.change(campo(), { target: { value: "900000" } });
    await usuario.click(boton("Cambiar monto"));
    const dialogo = await screen.findByRole("dialog");
    await usuario.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
    assert.equal((await negocioDe(a)).pedido.minimo_mayorista, 750000);
    assert.equal((await auditoria()).length, 0);
    assert.equal(monto(), "$750.000");
  });

  it("un monto fuera de rango o igual al actual se señala en el campo, sin abrir la confirmación ni llamar a la base", async () => {
    await linea(negocio());
    const { usuario } = montar();
    await abrir(usuario);
    await waitFor(() => assert.equal(monto(), "$750.000"));
    fireEvent.change(campo(), { target: { value: "75" } });
    await usuario.click(boton("Cambiar monto"));
    assert.ok(await screen.findByText("El mínimo debe estar entre $10.000 y $100.000.000."));
    assert.equal(campo().getAttribute("aria-invalid"), "true");
    fireEvent.change(campo(), { target: { value: "750000" } });
    await usuario.click(boton("Cambiar monto"));
    assert.ok(await screen.findByText("Ese ya es el monto actual."));
    assert.equal(screen.queryByRole("dialog"), null);
    assert.equal(puente.llamadas.filter((n) => n === "dulabs_agente_minimo_mayorista_aplicar").length, 0);
  });

  it("si alguien lo cambió mientras decidía: se avisa, se vuelve a leer el monto y no se pisa el cambio de la otra persona", async () => {
    const a = await linea(negocio());
    const { usuario } = montar();
    await abrir(usuario);
    await waitFor(() => assert.equal(monto(), "$750.000"));
    fireEvent.change(campo(), { target: { value: "900000" } });
    await usuario.click(boton("Cambiar monto"));
    const dialogo = await screen.findByRole("dialog");
    // Mientras tanto, otra persona lo deja en $850.000.
    await pg.db.query("update public.dulabs_agente_runtime_config set negocio = jsonb_set(negocio, '{pedido,minimo_mayorista}', '850000') where phone_number_id = $1", [a]);
    await usuario.click(within(dialogo).getByRole("button", { name: "Sí, cambiar a $900.000" }));
    assert.ok(await screen.findByText("El monto cambió"));
    assert.ok(screen.getByText(/cambió mientras lo editabas/));
    await waitFor(() => assert.equal(monto(), "$850.000"));
    assert.equal(screen.queryByRole("dialog"), null);
    assert.equal((await negocioDe(a)).pedido.minimo_mayorista, 850000, "el cambio de la otra persona sigue ahí");
    assert.equal((await auditoria()).length, 0);
  });

  it("si un texto del asistente no admite el monto nuevo (quedaría demasiado largo) la confirmación lo dice y no cambia nada", async () => {
    const justo = `${"a".repeat(891)}$750.000`;
    const a = await linea({ ...negocio(), inicio: { mayor: justo } });
    const { usuario } = montar();
    await abrir(usuario);
    await waitFor(() => assert.equal(monto(), "$750.000"));
    fireEvent.change(campo(), { target: { value: "1750000" } });
    await usuario.click(boton("Cambiar monto"));
    const dialogo = await screen.findByRole("dialog");
    await usuario.click(within(dialogo).getByRole("button", { name: "Sí, cambiar a $1.750.000" }));
    assert.ok(await within(dialogo).findByText(/superaría el largo permitido y el asistente dejaría de responder\. No se cambió nada/));
    assert.equal((await negocioDe(a)).pedido.minimo_mayorista, 750000);
    assert.equal((await auditoria()).length, 0);
    assert.equal(screen.queryByRole("dialog") !== null, true, "la confirmación sigue abierta con el motivo");
  });
});
