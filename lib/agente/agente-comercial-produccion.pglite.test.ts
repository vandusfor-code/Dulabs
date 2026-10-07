process.env.SUPABASE_URL = "http://supabase.memoria";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-prueba";

/**
 * BLOQUE 29 · PR 5 — ARIA lee lo PUBLICADO del CMS con el CABLEADO REAL de producción (lib/agente/webhook.ts → lector del CMS → SQL real), sin red ni Supabase real:
 * PostgREST en memoria para el catálogo, Postgres embebido para el SQL del CMS y el reloj de verdad. Negocios, ofertas y textos ficticios.
 *
 * Lo que se prueba aquí y no en otra parte: que la composición de producción le entrega a las herramientas comerciales lo que la administradora publicó (y solo eso), leído
 * en el momento (nada memoizado entre turnos), por negocio, y «no disponible» —nunca un vacío falso— sin el módulo o sin la migración.
 */
import "@electric-sql/pglite";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createMemoryConversationStateStore, emptyConversationState } from "@/lib/agente/estado";
import { createMemoryCustomerChannelStore } from "@/lib/agente/clasificacion";
import { parseAgentConfig, type AgentConfigRow, type AgentRuntimeConfig } from "@/lib/agente/config";
import { executeAgentTool, type AgentToolsDeps, type AgentTurnToolContext } from "@/lib/agente/herramientas";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { runAgentTurn } from "@/lib/agente/runtime";
import { productionAgentBoundaryDeps } from "@/lib/agente/webhook";
import { createSimulatedProvider } from "@/lib/ia-proveedores/simulado";
import { checksumDe } from "@/lib/cms-comercial/checksum";
import { crearDelacourSintetico } from "@/lib/cms-comercial/testing/delacour";
import { TENANT_A, TENANT_B } from "@/lib/cms-comercial/testing/fixtures";
import type { BaseCms } from "@/lib/cms-comercial/testing/pglite";
import { instalarPuenteRpcCms, type PuenteRpc } from "@/lib/cms-comercial/testing/puente-rpc";
import { variablesDeNegocio } from "@/lib/cms-comercial/variables-negocio";
import type { ClienteConfig } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabase";
import { installSupabaseMemoria, type SupabaseMemoria } from "@/lib/testing/supabase-rest-memoria";

const URL_BASE = "http://supabase.memoria";
const PN = "100000000000001";
const WA = "573001110001";
const DIA_MS = 24 * 60 * 60 * 1000;
const dia = (desplazamiento: number) => new Date(Date.now() + desplazamiento * DIA_MS).toISOString().slice(0, 10);
const VIGENTE = () => ({ desde: dia(-2), hasta: dia(30) });

let pg: BaseCms;
let db: SupabaseMemoria;
let puente: PuenteRpc;

async function montar(opciones: { migracion?: boolean } = {}) {
  pg = await crearDelacourSintetico({ migracion: opciones.migracion });
  if (opciones.migracion !== false) await pg.habilitarModulo(TENANT_A);
  db = installSupabaseMemoria(URL_BASE);
  puente = instalarPuenteRpcCms(pg, URL_BASE);
  db.table("dulabs_catalogo_pedidos");
  db.table("dulabs_catalogo_publicacion").push({ id_tenant: TENANT_A, slug: "tienda-real", nombre_publico: "Tienda real", publicado: true });
  db.table("dulabs_tenant_modulos").push({ id_tenant: TENANT_A, modulo: "catalogo", habilitado: true });
  db.table("dulabs_clientes_config").push({ id: 1, id_tenant: TENANT_A, phone_number_id: PN, nombre_negocio: "Tienda real", telefono_negocio: "573001112233", updated_at: "2026-09-01T00:00:00Z" });
  db.table("dulabs_catalogo_media");
  db.table("dulabs_catalogo_categorias");
  db.table("dulabs_inventario_productos");
}

afterEach(async () => {
  puente?.restaurar();
  db?.uninstall();
  await pg?.cerrar();
});

/** Crea y PUBLICA un elemento directamente en el SQL real (como lo dejaría la administradora al publicar). */
async function publicar(tenant: string, tipo: string, clave: string, contenido: unknown) {
  const [{ r }] = await pg.sql<{ r: { entidad: { id: string; rev: number } } }>("select public.dulabs_cms_crear($1, $2, $3, $4::jsonb, null, 'Prueba') as r", [tenant, tipo, clave, JSON.stringify(contenido)]);
  await pg.sql("select public.dulabs_cms_publicar($1, $2, $3, 0, $4, null, null, 'Prueba')", [tenant, r.entidad.id, r.entidad.rev, checksumDe(contenido)]);
  return r.entidad.id;
}
const OFERTA = (nombre: string, valor = 20) => ({ nombre, modalidad: "ambas", beneficio: { tipo: "porcentaje", valor }, alcance: { todos: true, referencias: [], categorias: [] }, vigencia: VIGENTE(), prioridad: 5, condiciones: "Hasta agotar existencias." });
const CONTENIDO = (tema: string, titulo: string, texto: string, audiencia = "todos") => ({ tema, audiencia, titulo, texto, palabras_clave: [], orden: 0 });

const configRow = (): AgentConfigRow => ({
  id_tenant: TENANT_A,
  phone_number_id: PN,
  tipo: "catalog_sales",
  habilitado: true,
  proveedor: "gemini",
  modelo: "gemini-3.6-flash",
  credencial_ref: "env:GEMINI_KEY_PRUEBA",
  nivel_razonamiento: "low",
  herramientas: [...AGENT_TOOL_NAMES],
  canal: "retail",
  negocio: { nombre_agente: "Aria", nombre_negocio: "Joyería Ficticia", pedido: { minimo_mayorista: 750_000 } },
  clasificacion_cliente: true,
});
const config = () => (parseAgentConfig(configRow(), { tenantId: TENANT_A, phoneNumberId: PN }) as { config: AgentRuntimeConfig }).config;

/** Las dependencias de producción de las herramientas, construidas EXACTAMENTE como las arma la frontera del webhook. */
function herramientasDeProduccion(cfg = config()): AgentToolsDeps {
  const cliente = { id_tenant: TENANT_A, phone_number_id: PN } as ClienteConfig;
  const construido = productionAgentBoundaryDeps(supabaseAdmin(), cliente).build({ cliente, waId: WA, destino: WA, wamid: "wamid.prod.1", text: "hola" }, cfg);
  assert.ok(construido, "con la clave de firma el motor de producción existe");
  return construido.tools;
}

const ctx = (cfg: AgentRuntimeConfig, over: Partial<AgentTurnToolContext> = {}): AgentTurnToolContext => ({
  tenantId: TENANT_A,
  phoneNumberId: PN,
  waId: WA,
  channel: "retail",
  requestId: "req-prod-0001",
  wamid: "wamid.prod.1",
  turn: 1,
  state: emptyConversationState(),
  pendingChoice: new Set(),
  designated: new Set(),
  customerText: "hola",
  images: [],
  handedOff: false,
  handoffMotive: null,
  newProposal: null,
  comercial: { valores: variablesDeNegocio(cfg.business).variables, nowMs: Date.now() },
  ...over,
});
const consultar = async (tools: AgentToolsDeps, cfg: AgentRuntimeConfig, nombre: string, args: Record<string, unknown> = {}, over: Partial<AgentTurnToolContext> = {}) =>
  executeAgentTool(nombre, args, AGENT_TOOL_NAMES, ctx(cfg, over), tools);

describe("ARIA y el CMS con el cableado real de producción (webhook.ts)", () => {
  beforeEach(async () => {
    await montar();
  });

  it("las herramientas comerciales leen lo PUBLICADO por la administradora: ofertas, textos con las variables del negocio resueltas y nada de borradores", async () => {
    await publicar(TENANT_A, "oferta", "amor", OFERTA("Amor y Amistad"));
    await publicar(TENANT_A, "contenido", "mayor", CONTENIDO("mayoristas", "Compra mayorista", "La compra inicial mayorista parte desde {{minimo_mayorista}}.", "todos"));
    await pg.sql("select public.dulabs_cms_crear($1, 'oferta', 'borrador', $2::jsonb, null, 'Prueba')", [TENANT_A, JSON.stringify(OFERTA("Solo un borrador", 40))]);
    const cfg = config();
    const tools = herramientasDeProduccion(cfg);
    const ofertas = await consultar(tools, cfg, "consultar_ofertas");
    assert.ok(ofertas.ok);
    if (ofertas.ok) {
      assert.deepEqual((ofertas.data.offers as Array<{ name: string }>).map((o) => o.name), ["Amor y Amistad"]);
      assert.equal(ofertas.data.empty, false);
    }
    const texto = await consultar(tools, cfg, "consultar_contenido_comercial", { tema: "mayoristas" });
    assert.ok(texto.ok);
    if (texto.ok) assert.deepEqual(texto.data.items, [{ title: "Compra mayorista", text: "La compra inicial mayorista parte desde $750.000." }]);
  });

  it("se lee EN EL MOMENTO en cada turno (nada memoizado): lo que se pausa deja de existir para ARIA en el turno siguiente, y lo que se publica aparece", async () => {
    const id = await publicar(TENANT_A, "oferta", "amor", OFERTA("Amor y Amistad"));
    const cfg = config();
    const tools = herramientasDeProduccion(cfg);
    const antes = await consultar(tools, cfg, "consultar_ofertas");
    assert.ok(antes.ok && antes.data.empty === false);
    await pg.sql("select public.dulabs_cms_pausar($1, $2, null, 'Prueba')", [TENANT_A, id]);
    const pausada = await consultar(tools, cfg, "consultar_ofertas");
    assert.ok(pausada.ok && pausada.data.empty === true, "la oferta pausada ya no existe para ARIA");
    await publicar(TENANT_A, "oferta", "navidad", OFERTA("Navidad 15%", 15));
    const nueva = await consultar(tools, cfg, "consultar_ofertas");
    assert.ok(nueva.ok);
    if (nueva.ok) assert.deepEqual((nueva.data.offers as Array<{ name: string }>).map((o) => o.name), ["Navidad 15%"]);
  });

  it("MÓDULO APAGADO: «no disponible» (UNAVAILABLE), nunca un vacío falso, aunque haya ofertas publicadas", async () => {
    await publicar(TENANT_A, "oferta", "amor", OFERTA("Amor y Amistad"));
    await pg.habilitarModulo(TENANT_A, false);
    const cfg = config();
    const r = await consultar(herramientasDeProduccion(cfg), cfg, "consultar_ofertas");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "UNAVAILABLE");
  });

  it("el CMS de OTRO negocio nunca le llega a este: cada turno lee el de su negocio", async () => {
    await pg.habilitarModulo(TENANT_B);
    await publicar(TENANT_B, "oferta", "de-b", OFERTA("Solo de B", 30));
    await publicar(TENANT_A, "oferta", "de-a", OFERTA("Solo de A", 10));
    const cfg = config();
    const r = await consultar(herramientasDeProduccion(cfg), cfg, "consultar_ofertas");
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual((r.data.offers as Array<{ name: string }>).map((o) => o.name), ["Solo de A"]);
  });

  it("un TURNO COMPLETO con el cableado real: el modelo consulta, responde con lo publicado y la guarda lo deja salir; lo inventado no sale", async () => {
    await publicar(TENANT_A, "oferta", "amor", OFERTA("Amor y Amistad"));
    const cfg = config();
    const tools = herramientasDeProduccion(cfg);
    const canales = createMemoryCustomerChannelStore({ [PN]: TENANT_A });
    await canales.setInitial({ tenantId: TENANT_A, phoneNumberId: PN, waId: WA }, "retail", "cliente");
    const enviados: string[] = [];
    const turno = async (script: Parameters<typeof createSimulatedProvider>[0], texto: string, waId = WA) => {
      await canales.setInitial({ tenantId: TENANT_A, phoneNumberId: PN, waId }, "retail", "cliente");
      return runAgentTurn(
        {
          config: cfg,
          provider: createSimulatedProvider(script),
          model: "gemini-3.6-flash",
          tools,
          state: createMemoryConversationStateStore(),
          history: { recent: async () => [{ direccion: "entrante" as const, contenido: texto, origen: "entrante" as const, wamid: "wamid.e" }] },
          classification: canales,
          sender: {
            sendText: async (t) => (enviados.push(t), { sent: true, wamid: "wamid.s" }),
            sendImage: async () => ({ sent: true, wamid: "wamid.i" }),
            sendButtons: async (b) => (enviados.push(b), { sent: true, wamid: "wamid.b" }),
            humanTookOver: async () => false,
          },
          log: () => {},
          retry: { sleep: async () => {}, random: () => 0 },
        },
        { tenantId: TENANT_A, phoneNumberId: PN, waId, wamid: "wamid.e", text: texto, buttonId: null },
      );
    };
    const honesto = await turno([{ toolCalls: [{ name: "consultar_ofertas", args: {} }] }, { text: "Tenemos la oferta Amor y Amistad: 20% de descuento 😊" }], "¿qué promociones tienen?");
    assert.equal(honesto.outcome, "replied");
    assert.equal(enviados.at(-1), "Tenemos la oferta Amor y Amistad: 20% de descuento 😊");
    assert.deepEqual(honesto.trace.grounding.violations, []);
    enviados.length = 0;
    // Con el mismo mundo, un modelo que INVENTA un 50% (sin consultar y aun tras la corrección) no logra enviarlo.
    const inventa = await turno([{ text: "Tenemos 50% de descuento en todo." }, { text: "Sí, 50% de descuento en todo." }], "¿hay descuentos?", "573001119999");
    assert.notEqual(inventa.outcome, "replied");
    assert.ok(!enviados.some((t) => t.includes("50%")));
  });
});

describe("ARIA y el CMS sin la migración", () => {
  it("SIN LA MIGRACIÓN del CMS (producción antes de activarla): «no disponible», sin romper nada", async () => {
    await montar({ migracion: false });
    const cfg = config();
    const r = await consultar(herramientasDeProduccion(cfg), cfg, "consultar_ofertas");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "UNAVAILABLE");
  });
});
