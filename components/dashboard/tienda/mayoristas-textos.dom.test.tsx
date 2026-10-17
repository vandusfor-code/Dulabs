// Postgres embebido ANTES que jsdom (ver tienda.dom.test.tsx): este import debe ir primero.
import "@electric-sql/pglite";
import "@/lib/test-helpers/jsdom-setup";
/**
 * Administración de tienda — los TEXTOS del bloque «Compras por mayor», de punta a punta: pantalla («Fotos y videos», jsdom + Testing Library) → cliente → rutas reales (/api/dashboard/tienda/*) → SQL real
 * (Postgres embebido) → lo que lee la tienda. La pantalla ofrece lo de siempre como guía, el servidor vuelve a validar al publicar, y nada cambia para los clientes hasta publicar.
 */
process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mayoristasVisible } from "@/lib/catalogo/joyeria";
import { joyeriaOf, storefrontConfigFor } from "@/lib/catalogo/vitrina";
import { createCmsClient } from "@/lib/cms-comercial-client";
import { crearLector } from "@/lib/cms-comercial/lector";
import { aplicarMultimedia, multimediaDesdeCms } from "@/lib/cms-comercial/multimedia-tienda";
import { crearRepositorioSupabaseCms } from "@/lib/cms-comercial/repositorio-supabase";
import { crearFetchRutas } from "@/lib/cms-comercial/testing/fetch-rutas";
import { crearBaseCms, type BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { instalarPuenteRpcCms, type PuenteRpc } from "@/lib/cms-comercial/testing/puente-rpc";
import type { HerramientasVideo } from "@/lib/cms-comercial/video-navegador";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";
import { CatalogToastProvider } from "@/components/dashboard/catalogo/ui";
import { HerramientasVideoProvider } from "@/components/dashboard/tienda/herramientas-video";
import { TiendaApp } from "@/components/dashboard/tienda/TiendaApp";

configure({ asyncUtilTimeout: 8000 });

const TA = "aaaaaaaa-0000-4000-8000-00000000000a";
const ADMIN = "d0000000-0000-4000-8000-000000000001";
const AGENTE = "d0000000-0000-4000-8000-000000000002";
const WHATSAPP = "573000000000";

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
    { id: 2, tenant_id: TA, user_id: AGENTE, rol: "agente", estado: "activo", email: "agente@a.test", nombre: "Bea Agente" },
  );
  db.user("t-admin-a", ADMIN);
  db.user("t-agente-a", AGENTE);
  await pg.habilitarModulo(TA);
  db.table("dulabs_tenant_modulos").push({ id_tenant: TA, modulo: "cms_comercial", habilitado: true });
  db.table("dulabs_catalogo_categorias").push({ id: "c0000000-0000-4000-8000-0000000000a1", id_tenant: TA, nombre: "Aretes" });
  db.table("dulabs_agente_runtime_config").push({ id_tenant: TA, habilitado: true, created_at: "2026-09-01T00:00:00Z", negocio: { nombre_negocio: "Tienda A", pedido: { minimo_mayorista: 750000 } } });
});

afterEach(() => {
  cleanup();
  puente.restaurar();
  db.uninstall();
});

const publicar = (slug: string, nombre = "Delacour & Orus") => db.table("dulabs_catalogo_publicacion").push({ id_tenant: TA, slug, nombre_publico: nombre, publicado: true, token_mayor: "f".repeat(64) });

/** Sin videos en esta prueba: un navegador de mentira que nunca se usa (jsdom no reproduce video). */
const SIN_VIDEOS: HerramientasVideo = { leerBytes: async () => new Uint8Array(), sondear: async () => ({ reproducible: false, ancho: 0, alto: 0, duracionSeg: 0, imagenFija: null }), urlTemporal: () => "blob:prueba", liberar: () => {} };

function montar(token = "t-admin-a") {
  const rutas = crearFetchRutas();
  const client = createCmsClient(token, { fetch: rutas.fetch });
  const usuario = userEvent.setup();
  render(
    <CatalogToastProvider>
      <HerramientasVideoProvider herramientas={SIN_VIDEOS}>
        <TiendaApp client={client} canWrite={token === "t-admin-a"} />
      </HerramientasVideoProvider>
    </CatalogToastProvider>,
  );
  return { usuario, client };
}

const boton = (nombre: string | RegExp) => screen.getByRole("button", { name: nombre });
const borrador = async () => (await pg.sql<{ borrador: Record<string, unknown> | null }>("select borrador from public.dulabs_cms_entidades where id_tenant = $1 and tipo = 'multimedia'", [TA]))[0]?.borrador ?? null;
const publicado = async () => (await crearLector(crearRepositorioSupabaseCms(pg.supabase)).cargar(TA)) ?? null;
const campo = (etiqueta: string) => screen.getByLabelText(etiqueta) as HTMLInputElement;

async function abrirTextos(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(await screen.findByRole("tab", { name: "Fotos y videos" }));
  await usuario.click(await screen.findByRole("button", { name: "Personalizar las fotos y los videos" }));
  await screen.findByRole("heading", { name: "Textos de «Compras por mayor»" });
}

async function escribir(usuario: ReturnType<typeof userEvent.setup>, etiqueta: string, texto: string) {
  const c = campo(etiqueta);
  await usuario.click(c);
  await usuario.paste(texto);
}

describe("el formulario de los textos de «Compras por mayor»", () => {
  it("muestra los cinco textos con lo de siempre como guía (en gris), su tope de caracteres y una vista de cómo se leerá", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirTextos(usuario);
    const esperado: Array<[string, string, number]> = [
      ["Etiqueta", "Compras por mayor", 40],
      ["Título", "Compra al por mayor", 80],
      ["Texto corto", "Escríbenos por WhatsApp y una asesora te atiende.", 200],
      ["Botón", "Hablar con una asesora", 40],
      ["Mensaje de WhatsApp", "Hola, quiero información para comprar al por mayor.", 200],
    ];
    for (const [etiqueta, guia, tope] of esperado) {
      const c = campo(etiqueta);
      assert.equal(c.value, "", `${etiqueta} arranca vacío (= lo de siempre)`);
      assert.equal(c.placeholder, guia);
      assert.equal(c.maxLength, tope);
    }
    const vista = screen.getByTestId("vista-previa-mayoristas");
    for (const [, guia] of esperado) assert.ok(within(vista).getByText(new RegExp(guia.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))), guia);
    assert.ok(screen.getByText(/La introducción de la página se edita en la pestaña «Preguntas frecuentes»/));
    assert.equal(screen.queryByRole("button", { name: "Volver a los textos de siempre" }), null, "nada que revertir todavía");
    assert.match(screen.getByTestId("previa-textos-mayoristas").textContent ?? "", /siguen como siempre/);
  });

  it("escribir un texto actualiza la vista y el resumen al instante, y se puede volver a los de siempre", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirTextos(usuario);
    await escribir(usuario, "Título", "Surte tu negocio con nosotros");
    assert.ok(within(screen.getByTestId("vista-previa-mayoristas")).getByText("Surte tu negocio con nosotros"));
    assert.ok(within(screen.getByTestId("vista-previa-mayoristas")).getByText("Hablar con una asesora"), "lo que no cambió sigue como siempre");
    assert.match(screen.getByTestId("previa-textos-mayoristas").textContent ?? "", /que cambiaste: 1 de 5/);

    await usuario.click(boton("Volver a los textos de siempre"));
    assert.equal(campo("Título").value, "");
    assert.ok(within(screen.getByTestId("vista-previa-mayoristas")).getByText("Compra al por mayor"));
    assert.equal(screen.queryByRole("button", { name: "Volver a los textos de siempre" }), null);
  });

  it("el tope de caracteres se respeta al escribir", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirTextos(usuario);
    await usuario.click(campo("Botón"));
    await usuario.keyboard("x".repeat(60));
    assert.equal(campo("Botón").value.length, 40);
  });

  it("quien solo puede consultar no puede cambiarlos (el formulario ni se ofrece)", async () => {
    publicar("delacour");
    const { usuario } = montar("t-agente-a");
    await usuario.click(await screen.findByRole("tab", { name: "Fotos y videos" }));
    assert.ok(await screen.findByText("Cuando un administrador lo personalice, lo verás aquí."));
    assert.equal(screen.queryByLabelText("Título"), null);
  });
});

describe("guardar y publicar los textos", () => {
  it("se guarda como borrador (nada cambia en la tienda) y, al publicar, la tienda dice lo que ella escribió", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirTextos(usuario);
    await escribir(usuario, "Título", "Surte tu negocio con nosotros");
    await escribir(usuario, "Botón", "Escríbenos ahora");
    await escribir(usuario, "Mensaje de WhatsApp", "Hola, quiero surtir mi negocio.");

    await usuario.click(boton(/^Guardar/));
    await waitFor(async () => assert.deepEqual(await borrador(), { mayoristas: { titulo: "Surte tu negocio con nosotros", boton: "Escríbenos ahora", mensaje: "Hola, quiero surtir mi negocio." } }));
    assert.equal((await publicado())?.multimedia ?? null, null, "un borrador no llega a la tienda");

    await usuario.click(boton("Publicar"));
    const dialogo = await screen.findByRole("dialog", { name: /Publicar «Fotos y videos»/ });
    assert.ok(within(dialogo).getByText(/Título de «Compras por mayor»/) && within(dialogo).getByText(/Surte tu negocio con nosotros/), "dice qué cambia, con el nombre que ella conoce");
    assert.equal(within(dialogo).queryByText(/publicar esto no cambia nada/), null, "cambiar solo textos sí cambia la tienda");
    await usuario.click(within(dialogo).getByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));

    const snap = await publicado();
    assert.ok(snap?.multimedia);
    const m = multimediaDesdeCms(snap, "delacour");
    assert.deepEqual(m?.mayoristas, { titulo: "Surte tu negocio con nosotros", boton: "Escríbenos ahora", mensaje: "Hola, quiero surtir mi negocio." });
    const visible = mayoristasVisible(aplicarMultimedia(joyeriaOf(storefrontConfigFor("delacour"))!, m), WHATSAPP)!;
    assert.deepEqual([visible.titulo, visible.boton, visible.etiqueta], ["Surte tu negocio con nosotros", "Escríbenos ahora", "Compras por mayor"]);
    assert.equal(new URL(visible.href).searchParams.get("text"), "Hola, quiero surtir mi negocio.");
  });

  it("al volver a los textos de siempre y publicar, la tienda vuelve a los suyos", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirTextos(usuario);
    await escribir(usuario, "Título", "Surte tu negocio");
    await usuario.click(boton("Publicar"));
    await usuario.click(await screen.findByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 1/));
    assert.equal(multimediaDesdeCms((await publicado())!, "delacour")?.mayoristas?.titulo, "Surte tu negocio");

    await usuario.click(boton("Volver a los textos de siempre"));
    await usuario.click(boton(/^Guardar/));
    await waitFor(async () => assert.deepEqual(await borrador(), {}));
    await usuario.click(boton("Publicar"));
    const dialogo = await screen.findByRole("dialog", { name: /Publicar «Fotos y videos»/ });
    await usuario.click(within(dialogo).getByRole("button", { name: "Publicar ahora" }));
    assert.ok(await screen.findByText(/Publicado: versión 2/));
    assert.equal(multimediaDesdeCms((await publicado())!, "delacour"), null, "nada publicado que reemplace: la tienda se ve como siempre");
  });
});

describe("lo que el servidor no deja publicar", () => {
  it("una variable como {{minimo_mayorista}} en un texto: no se publica y el motivo sale junto al campo", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirTextos(usuario);
    await escribir(usuario, "Título", "Desde {{minimo_mayorista}}");
    await usuario.click(boton("Publicar"));
    const aviso = await screen.findAllByText(/Las variables entre llaves solo se pueden usar en el contenido comercial/);
    assert.ok(aviso.length > 0);
    assert.equal(screen.queryByRole("dialog", { name: /Publicar «Fotos y videos»/ }), null, "no se abre la confirmación de publicar");
    assert.equal((await publicado())?.multimedia ?? null, null);
  });

  it("el enlace del catálogo mayorista (un secreto) en un texto: no se publica", async () => {
    publicar("delacour");
    const { usuario } = montar();
    await abrirTextos(usuario);
    await escribir(usuario, "Texto corto", "Mira https://www.dulabs.co/catalogo/delacour/mayor/AbCdEfGhIjKlMnOp");
    await usuario.click(boton("Publicar"));
    assert.ok((await screen.findAllByText(/No pongas el enlace del catálogo mayorista en los textos de la tienda: los verían todos los clientes/)).length > 0);
    assert.equal(screen.queryByRole("dialog", { name: /Publicar «Fotos y videos»/ }), null);
  });
});
