/**
 * Rendimiento del panel (Pedidos, Clientes, Catálogo): menos idas y vueltas seguidas a la base de
 * datos sin cambiar lo que se autoriza ni lo que se muestra. Sin red: dobles de Supabase y del motor.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { SESION_TTL_MS, usuarioDeToken } from "@/lib/auth-cache";
import { requireCatalogo, type CatalogAuthDeps } from "@/lib/catalogo/auth";
import { LLAMADA_LENTA_MS, conTiempos } from "@/lib/catalogo/http";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository, type OrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { listarGestion } from "@/lib/catalogo/pedidos/gestion";
import type { PanelFuentes } from "@/lib/catalogo/pedidos/panel";
import type { Miembro } from "@/lib/team";

// ---------------------------------------------------------------------------
// Sesión: el token válido se recuerda (poco tiempo); el inválido nunca
// ---------------------------------------------------------------------------

function falsoSupabase(validos: Record<string, string>) {
  const llamadas: string[] = [];
  const cliente = {
    auth: {
      async getUser(token: string) {
        llamadas.push(token);
        const id = validos[token];
        return id ? { data: { user: { id, email: `${id}@ficticio.test` } }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } };
      },
    },
  } as unknown as SupabaseClient;
  return { cliente, llamadas };
}

const jwt = (expSeg: number) => `h.${Buffer.from(JSON.stringify({ exp: expSeg })).toString("base64url")}.f`;

describe("sesión recordada (auth-cache)", () => {
  it("el mismo token válido se valida con Supabase UNA vez dentro de 60 s; después, de nuevo", async () => {
    const t0 = Date.parse("2026-09-30T15:00:00Z");
    const tok = jwt(t0 / 1000 + 3600);
    const { cliente, llamadas } = falsoSupabase({ [tok]: "u1" });
    let ahora = t0;
    const reloj = () => ahora;
    assert.deepEqual(await usuarioDeToken(cliente, tok, reloj), { id: "u1", email: "u1@ficticio.test" });
    ahora += SESION_TTL_MS - 1;
    assert.equal((await usuarioDeToken(cliente, tok, reloj))?.id, "u1");
    assert.equal(llamadas.length, 1, "la segunda no fue a Supabase");
    ahora += 2;
    await usuarioDeToken(cliente, tok, reloj);
    assert.equal(llamadas.length, 2, "pasados 60 s se vuelve a validar");
  });

  it("un token inválido NUNCA se recuerda (siempre se vuelve a consultar)", async () => {
    const { cliente, llamadas } = falsoSupabase({});
    assert.equal(await usuarioDeToken(cliente, "malo"), null);
    assert.equal(await usuarioDeToken(cliente, "malo"), null);
    assert.equal(llamadas.length, 2);
  });

  it("nunca más allá de la expiración del propio token; tokens distintos y clientes distintos no se mezclan", async () => {
    const t0 = Date.parse("2026-09-30T15:00:00Z");
    const casiVencido = jwt(t0 / 1000 + 5);
    const otro = jwt(t0 / 1000 + 3600) + "x";
    const { cliente, llamadas } = falsoSupabase({ [casiVencido]: "u1", [otro]: "u2" });
    let ahora = t0;
    await usuarioDeToken(cliente, casiVencido, () => ahora);
    ahora += 6_000;
    await usuarioDeToken(cliente, casiVencido, () => ahora);
    assert.equal(llamadas.length, 2, "vencido el token, se consulta otra vez");
    assert.equal((await usuarioDeToken(cliente, otro, () => ahora))?.id, "u2");
    const b = falsoSupabase({ [otro]: "u3" });
    assert.equal((await usuarioDeToken(b.cliente, otro, () => ahora))?.id, "u3", "memoria por cliente");
  });
});

// ---------------------------------------------------------------------------
// Autorización: módulo y límite de tasa AL MISMO TIEMPO (misma decisión que antes)
// ---------------------------------------------------------------------------

const MIEMBRO: Miembro = { miembroId: 1, tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "u1", rol: "admin", estado: "activo" } as Miembro;

function deps(moduloActivo: boolean, marcas: string[], esperar?: Promise<void>): CatalogAuthDeps {
  return {
    authenticate: async () => ({ ok: true, supabase: {} as SupabaseClient, member: MIEMBRO }),
    async isModuleEnabled() {
      marcas.push("modulo:inicio");
      if (esperar) await esperar;
      marcas.push("modulo:fin");
      return moduloActivo;
    },
  };
}

describe("autorización en paralelo", () => {
  const req = {} as NextRequest;

  it("el límite de tasa arranca ANTES de que termine la verificación del módulo", async () => {
    const marcas: string[] = [];
    let soltar!: () => void;
    const puerta = new Promise<void>((r) => (soltar = r));
    const p = requireCatalogo(req, "orders", deps(true, marcas, puerta), "pedidos", async () => {
      marcas.push("limite");
      return null;
    });
    await new Promise((r) => setTimeout(r, 5));
    assert.ok(marcas.includes("limite") && marcas.includes("modulo:inicio") && !marcas.includes("modulo:fin"));
    soltar();
    assert.equal((await p).ok, true);
  });

  it("si el límite se excede: 429; si el módulo no está habilitado, manda el 403 del módulo", async () => {
    const r429 = await requireCatalogo(req, "orders", deps(true, []), "pedidos", async () => new Response("lento", { status: 429 }));
    assert.equal(r429.ok, false);
    assert.equal(!r429.ok && r429.response.status, 429);
    const r403 = await requireCatalogo(req, "orders", deps(false, []), "pedidos", async () => new Response("lento", { status: 429 }));
    assert.equal(!r403.ok && r403.response.status, 403);
  });

  it("tiempos de cada llamada en Server-Timing (se ven en el navegador); las lentas quedan en el log", () => {
    const logs: string[] = [];
    const warn = console.warn;
    console.warn = (m: string) => logs.push(m);
    try {
      const r = conTiempos(Response.json({ ok: true }), "pedidos_lectura", 120.4, 80.2);
      assert.equal(r.headers.get("Server-Timing"), "auth;dur=120, datos;dur=80");
      assert.equal(logs.length, 0);
      conTiempos(Response.json({ ok: true }), "pedidos_lectura", 100, LLAMADA_LENTA_MS);
      assert.equal(logs.length, 1);
      assert.deepEqual(JSON.parse(logs[0]), { log: "catalogo_llamada_lenta", recurso: "pedidos_lectura", auth_ms: 100, datos_ms: LLAMADA_LENTA_MS });
    } finally {
      console.warn = warn;
    }
  });
});

// ---------------------------------------------------------------------------
// Lista de Pedidos: contadores a la vez que la lista; vencer reservas como mucho una vez por minuto
// ---------------------------------------------------------------------------

const fuentes: PanelFuentes = {
  nombres: async () => new Map(),
  canales: async () => new Map(),
  confirmados: async () => new Map(),
  asignadas: async () => new Map(),
  fotos: async () => new Map(),
  miembros: async () => new Map(),
  atencion: async () => new Map(),
};

describe("lista de Pedidos", () => {
  let reloj: number;
  let base: ReturnType<typeof createMemoryOrdersRepository>;
  beforeEach(() => {
    reloj = Date.parse("2026-09-30T15:00:00Z");
    base = createMemoryOrdersRepository({ now: () => reloj });
  });
  const motor = (orders: OrdersRepository) =>
    createOrderEngine({ orders, catalog: createInMemoryCatalogRepository().repo, key: Buffer.alloc(32, 1), log: () => {}, now: () => new Date(reloj), handoff: { pauseConversation: async () => ({ ok: true }) } });

  it("los contadores de las pestañas se piden AL MISMO TIEMPO que la lista (no después)", async () => {
    let contoAntes = false;
    let soltarLista!: () => void;
    const listaEsperando = new Promise<void>((r) => (soltarLista = r));
    const orders: OrdersRepository = {
      ...base,
      async listPanel(t, q) {
        await listaEsperando;
        return base.listPanel(t, q);
      },
      async countPanel(t, q) {
        contoAntes = true;
        soltarLista();
        return base.countPanel!(t, q);
      },
    };
    const res = await Promise.race([
      listarGestion(motor(orders), "aaaaaaaa-0000-4000-8000-00000000000a", new URLSearchParams(), { fuentes, verTelefono: true }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("la lista esperó a los contadores: van en serie")), 2000)),
    ]);
    assert.equal(res.status, 200);
    assert.ok(contoAntes);
    const body = (await res.json()) as { data: { conteos: Record<string, number> } };
    assert.equal(body.data.conteos.todos, 0);
  });

  it("vencer reservas vencidas: como mucho una vez por minuto por instancia", async () => {
    let vencimientos = 0;
    const orders: OrdersRepository = {
      ...base,
      async expireReservations(n) {
        vencimientos++;
        return base.expireReservations(n);
      },
    };
    const m = motor(orders);
    const listar = () => listarGestion(m, "aaaaaaaa-0000-4000-8000-00000000000a", new URLSearchParams(), { fuentes, verTelefono: true });
    await listar();
    await listar();
    assert.equal(vencimientos, 1, "la segunda carga no espera por vencer");
    reloj += 60_000;
    await listar();
    assert.equal(vencimientos, 2);
  });
});
