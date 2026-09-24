/**
 * Bloque 24 — MATRIZ DEL PILOTO DE DELACOUR, de punta a punta, con el código REAL:
 *
 *   WhatsApp (payload real de Meta) -> registrarMensajesEntrantesSincrono + procesarCambio (el
 *   webhook de producción) -> guardas del piloto -> agente -> cliente HTTP REAL de Gemini
 *   (generateContent + function calling) -> herramientas -> motor de pedidos -> PostgreSQL REAL
 *   (PostgREST, migraciones reales, triggers de reserva, buzón, trazas, diagnóstico) -> envío a Meta
 *
 * Lo único simulado: las respuestas de Gemini (un guion por mensaje, con el MISMO formato de la API)
 * y la Graph API de Meta. Nunca toca Supabase, Gemini ni Meta reales: se niega a correr si
 * SUPABASE_URL no es local. Negocios, clientes y productos FICTICIOS, nuevos en cada corrida.
 *
 * Preparación (ver scripts/piloto/README.md):
 *   PILOTO_SUPABASE_URL=http://127.0.0.1:54453 npx tsx --test scripts/piloto/matriz-piloto.e2e.ts
 */
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const URL_LOCAL = process.env.PILOTO_SUPABASE_URL ?? "http://127.0.0.1:54453";
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_LOCAL)) throw new Error("La matriz del piloto solo corre contra un PostgREST LOCAL.");
process.env.SUPABASE_URL = URL_LOCAL;
process.env.SUPABASE_SERVICE_ROLE_KEY = "local";
process.env.META_ACCESS_TOKEN = "token-meta-ficticio-b24";
process.env.GEMINI_KEY_DELACOUR = "clave-gemini-ficticia-b24";
process.env.DULABS_GEMINI_BASE_URL = "http://gemini.local/v1beta";
process.env.NEXT_PUBLIC_SITE_URL = "https://dulabs.test";
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString("base64");

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { formatCop } from "@/lib/business-agent-quote";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import { NON_TEXT_MESSAGES } from "@/lib/agente/entrada";
import { FALLBACK_MESSAGES } from "@/lib/agente/runtime";
import { liberarPausaChat } from "@/lib/pausas-chat";
import { CHANNEL_QUESTION, CLASSIFICATION_MESSAGES, createSupabaseCustomerChannelStore } from "@/lib/agente/clasificacion";
import { procesarCambio, registrarMensajesEntrantesSincrono, type MetaChangeValue } from "@/app/webhook-dulabs/route";

const db = createClient(URL_LOCAL, "local", { auth: { persistSession: false } });
const RUN = randomBytes(3).toString("hex");
const T = randomUUID();
const TB = randomUUID();
const num = (base: number) => String(base + Math.floor(Math.random() * 1e5)).padStart(15, "9");
const PN = num(910000000000000);
const PN_B = num(920000000000000);
const SLUG = `joyeria-piloto-${RUN}`;
const DISPLAY = "573000000000";
/** Clientes autorizados del piloto (ia_restringida_a) y uno que NO lo está. */
const C = Array.from({ length: 28 }, (_, i) => `57310${RUN.replace(/\D/g, "7").padEnd(4, "7").slice(0, 4)}${String(i).padStart(3, "0")}`);
const NO_AUTORIZADO = "573219990000";
const CB = "573229990001";

// ---------------------------------------------------------------------------
// Gemini simulado (formato REAL de generateContent) y Meta simulado
// ---------------------------------------------------------------------------
type Body = { systemInstruction: { parts: Array<{ text: string }> }; contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>; tools?: Array<{ functionDeclarations: unknown[] }> };
type Paso = (body: Body) => Response | Record<string, unknown>;
const guion: Paso[] = [];
let politica: ((body: Body) => Record<string, unknown> | Response) | null = null;
const gemini: Array<{ bytes: number; body: Body; key: string | null }> = [];
/** fallos: el próximo envío de ESE tipo (texto o imagen) que Meta rechaza. */
const meta: { calls: Array<{ url: string; body: Record<string, unknown>; auth: boolean }>; fallos: Array<{ tipo: "text" | "image"; status: number; code: number }> } = { calls: [], fallos: [] };
const otrosHosts = new Set<string>();
const fallarRest: { patron: RegExp | null } = { patron: null };
let seqMeta = 0;
const realFetch = globalThis.fetch;

const usage = (body: Body) => ({ promptTokenCount: Math.ceil(JSON.stringify(body).length / 4), candidatesTokenCount: 24, totalTokenCount: 0 });
const fn =
  (name: string, args: Record<string, unknown> | ((b: Body) => Record<string, unknown>) = {}): Paso =>
  (body) => ({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args: typeof args === "function" ? args(body) : args }, thoughtSignature: "c2ln" }] }, finishReason: "STOP" }], usageMetadata: usage(body), modelVersion: "gemini-3.6-flash" });
const txt =
  (t: string | ((b: Body) => string)): Paso =>
  (body) => ({ candidates: [{ content: { role: "model", parts: [{ text: typeof t === "function" ? t(body) : t }] }, finishReason: "STOP" }], usageMetadata: usage(body), modelVersion: "gemini-3.6-flash" });
/** Resultados de herramientas del último paso (lo que el backend le devolvió al modelo). */
const resultados = (body: Body) =>
  ([...body.contents].reverse().find((c) => c.role === "user" && c.parts.some((p) => "functionResponse" in p))?.parts ?? []).map((p) => (p.functionResponse as { response: Record<string, unknown> }).response);
const ultimoTexto = (body: Body) => String([...body.contents].reverse().find((c) => c.role === "user" && c.parts.some((p) => typeof p.text === "string"))?.parts[0].text ?? "");
const estadoDe = (body: Body) => JSON.parse(body.systemInstruction.parts[0].text.split("=== ESTADO DE LA CONVERSACIÓN (confiable, lo mantiene el sistema) ===\n")[1]) as Record<string, unknown>;
type Cand = { reference: string; name: string; unit_price: number; color?: string };
const candidatos = (body: Body) => (resultados(body)[0]?.candidates as Cand[] | undefined) ?? [];
const lista = (body: Body) => `Tengo estas opciones:\n${candidatos(body).map((c, i) => `${i + 1}. ${c.name} (${c.reference}) — ${formatCop(c.unit_price)}`).join("\n")}\n¿Cuál te gusta?`;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith("http://gemini.local/")) {
    const raw = String(init?.body ?? "");
    const body = JSON.parse(raw) as Body;
    const h = init?.headers as Record<string, string> | undefined;
    gemini.push({ bytes: Buffer.byteLength(raw), body, key: h?.["x-goog-api-key"] ?? null });
    const paso = politica ? null : guion.shift();
    const out = politica ? politica(body) : paso ? paso(body) : txt("SIN_GUION")(body);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("graph.facebook.com")) {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const h = init?.headers as Record<string, string> | undefined;
    meta.calls.push({ url, body, auth: !!h?.Authorization || !!h?.authorization });
    const i = meta.fallos.findIndex((f) => f.tipo === body.type);
    if (i >= 0) {
      const [f] = meta.fallos.splice(i, 1);
      return new Response(JSON.stringify({ error: { message: "(simulado)", type: "OAuthException", code: f.code } }), { status: f.status });
    }
    return new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: `wamid.meta.${RUN}.${++seqMeta}` }], success: true }), { status: 200 });
  }
  if (url.startsWith(URL_LOCAL)) {
    if (fallarRest.patron?.test(url)) return new Response(JSON.stringify({ code: "PGRST000", message: "(simulado) base no disponible" }), { status: 503 });
    return realFetch(input, init);
  }
  otrosHosts.add(new URL(url).host);
  throw new Error(`red externa bloqueada en la matriz: ${new URL(url).host}`);
}) as typeof fetch;

// Registros de la consola (para probar que ningún secreto ni teléfono llega a los logs).
const logs: string[] = [];
for (const k of ["log", "info", "warn", "error"] as const) {
  const orig = console[k].bind(console);
  console[k] = (...a: unknown[]) => {
    logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    if (process.env.PILOTO_VERBOSE) orig(...a);
  };
}

// ---------------------------------------------------------------------------
// WhatsApp: un mensaje del cliente por el webhook REAL
// ---------------------------------------------------------------------------
let seqIn = 0;
const wamidNuevo = () => `wamid.in.${RUN}.${++seqIn}`;
function valor(pn: string, from: string, msg: Record<string, unknown>): MetaChangeValue {
  return { messaging_product: "whatsapp", metadata: { phone_number_id: pn, display_phone_number: DISPLAY }, contacts: [{ wa_id: from, profile: { name: "Cliente piloto" } }], messages: [{ from, timestamp: "1790000000", ...msg } as never] };
}
async function entregar(pn: string, from: string, msg: Record<string, unknown>) {
  const v = valor(pn, from, msg);
  await registrarMensajesEntrantesSincrono(pn, v);
  await procesarCambio(pn, v, null);
}
type Envio = { tipo: "text" | "image"; texto: string; link?: string; caption?: string; to: string };
const envios = (desde: number): Envio[] =>
  meta.calls
    .slice(desde)
    .filter((c) => c.body.type === "text" || c.body.type === "image")
    .map((c) =>
      c.body.type === "text"
        ? { tipo: "text" as const, texto: (c.body.text as { body: string }).body, to: String(c.body.to) }
        : { tipo: "image" as const, texto: "", link: (c.body.image as { link: string }).link, caption: (c.body.image as { caption: string }).caption, to: String(c.body.to) },
    );
async function traza(wamid: string) {
  const { data } = await db.from("dulabs_agente_trazas").select("resultado, traza").eq("id_tenant", T).eq("wamid", wamid).eq("tipo", "turn").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data as { resultado: string; traza: Record<string, any> } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
}
/** Un mensaje del cliente con el guion de Gemini para ESE mensaje. */
async function turno(from: string, texto: string | Record<string, unknown>, pasos: Paso[] = [], opts: { pn?: string; context?: Record<string, unknown>; wamid?: string } = {}) {
  const g0 = gemini.length;
  const m0 = meta.calls.length;
  guion.length = 0;
  guion.push(...pasos);
  const wamid = opts.wamid ?? wamidNuevo();
  const msg = typeof texto === "string" ? { id: wamid, type: "text", text: { body: texto } } : { id: wamid, ...texto };
  await entregar(opts.pn ?? PN, from, { ...msg, ...(opts.context ? { context: opts.context } : {}) });
  const t = await traza(wamid);
  const tools = (t?.traza.tool_calls ?? []) as Array<{ name: string; result: string }>;
  return { wamid, gemini: gemini.slice(g0), envios: envios(m0), traza: t, tools: tools.map((x) => `${x.name}:${x.result}`), sobrante: guion.length };
}
const conv = async (wa: string) => {
  const { data } = await db.from("dulabs_agente_conversaciones").select("estado").eq("id_tenant", T).eq("wa_id", wa).maybeSingle();
  return (data as { estado: { cart: Array<{ reference: string; quantity: number }> } } | null)?.estado;
};
const pedidosDe = async (wa: string) => {
  const { data } = await db.from("dulabs_catalogo_pedidos").select("id, pedido_publico, estado, total, lineas, problemas").eq("id_tenant", T).eq("contacto_wa_id", wa).order("created_at", { ascending: true });
  return (data ?? []) as Array<{ id: string; pedido_publico: string; estado: string; total: number; lineas: Array<{ reference: string; quantity: number }>; problemas: Array<{ code: string }> }>;
};
const stock = async (ref: string) => (await db.from("dulabs_inventario_productos").select("stock").eq("id_tenant", T).eq("referencia", ref).single()).data!.stock as number;
const reservas = async (pedidoId: string) => ((await db.from("dulabs_catalogo_reservas").select("cantidad, estado").eq("pedido_id", pedidoId)).data ?? []) as Array<{ cantidad: number; estado: string }>;
const pausa = async (wa: string, pn = PN) => {
  const { data } = await db.from("dulabs_pausas_chat").select("pausado_hasta").eq("phone_number_id", pn).eq("telefono_cliente", wa).maybeSingle();
  return data ? Date.parse(String((data as { pausado_hasta: string }).pausado_hasta)) : null;
};
const setConfig = (patch: Record<string, unknown>) => db.from("dulabs_clientes_config").update(patch).eq("phone_number_id", PN);
const setAgente = (patch: Record<string, unknown>) => db.from("dulabs_agente_runtime_config").update(patch).eq("phone_number_id", PN);

// ---------------------------------------------------------------------------
// Semilla: negocio ficticio "Joyería Piloto" (forma del catálogo de Delacour) y un segundo negocio
// ---------------------------------------------------------------------------
type Prod = { id: string; referencia: string; nombre: string; precio: number; color: string; stock: number; foto?: boolean };
const P: Record<string, Prod> = {};
const PB: Record<string, Prod> = {};
async function ok<Tv>(q: PromiseLike<{ data: Tv; error: { message: string } | null }>): Promise<Tv> {
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
async function sembrarNegocio(tenant: string, pn: string, slug: string, autorizados: string[], productos: Array<[string, string, number, string, number, boolean]>, destino: Record<string, Prod>) {
  await ok(db.from("dulabs_clientes_config").insert({ id_tenant: tenant, nombre_negocio: `Joyería ficticia ${RUN}`, phone_number_id: pn, telefono_negocio: DISPLAY, ia_pausada: false, ia_restringida_a: autorizados.join(","), flow_activo: false }));
  await ok(db.from("dulabs_suscripciones").insert({ id_tenant: tenant, plan: "enterprise", estado: "activa" }));
  await ok(db.from("dulabs_tenant_modulos").insert({ id_tenant: tenant, modulo: "catalogo", habilitado: true }));
  await ok(db.from("dulabs_catalogo_publicacion").insert({ id_tenant: tenant, slug, nombre_publico: "Joyería Piloto", token_mayor: randomBytes(32).toString("hex"), publicado: true }));
  for (const [clave, nombre, precio, color, stockIni, foto] of productos) {
    const filas = (await ok(db.from("dulabs_inventario_productos").insert({ id_tenant: tenant, nombre, precio, stock: stockIni, color, material: "Acero", categoria: nombre.split(" ")[0], controla_stock: true, activo: true }).select("id, referencia, nombre, precio, color, stock"))) as Prod[];
    const p = filas[0];
    destino[clave] = { ...(p as Prod), foto };
    if (foto) await ok(db.from("dulabs_catalogo_media").insert({ id_tenant: tenant, producto_id: (p as Prod).id, storage_path: `${tenant}/${(p as Prod).id}/foto.webp`, es_principal: true, orden: 0, mime_type: "image/webp", bytes: 120_000, ancho: 1200, alto: 1200 }));
  }
  await ok(
    db.from("dulabs_agente_runtime_config").insert({
      id_tenant: tenant,
      phone_number_id: pn,
      tipo: "catalog_sales",
      habilitado: true,
      proveedor: "gemini",
      modelo: "gemini-3.6-flash",
      credencial_ref: "env:GEMINI_KEY_DELACOUR",
      nivel_razonamiento: "low",
      herramientas: [...AGENT_TOOL_NAMES],
      canal: "retail",
      negocio: { nombre_agente: "Sofía", presentacion: "Asesora virtual de la joyería" },
      // Tope por minuto más alto SOLO para poder recorrer la matriz rápido; el tope real (8/min) tiene su prueba.
      limites: { turnos_por_minuto_cliente: 60 },
    }),
  );
}

// ---------------------------------------------------------------------------

describe("PILOTO DELACOUR — matriz de punta a punta (webhook real + PostgreSQL real)", { timeout: 900_000 }, () => {
  before(async () => {
    await sembrarNegocio(
      T,
      PN,
      SLUG,
      C,
      [
        ["luna", "Aretes Luna", 45_000, "Dorado", 5, true],
        ["sol", "Aretes Sol", 52_000, "Plateado", 5, true],
        ["estrella", "Aretes Estrella", 60_000, "Rosado", 5, true],
        ["gota", "Aretes Gota", 38_000, "Dorado", 5, true],
        ["aro", "Aretes Aro", 41_000, "Dorado", 5, true],
        ["perla", "Aretes Perla", 47_000, "Blanco", 5, true],
        ["cristal", "Aretes Cristal", 50_000, "Plateado", 5, false],
        ["flor", "Aretes Flor", 43_000, "Rosado", 5, true],
        ["unico", "Anillo Único", 99_000, "Dorado", 1, true],
        ["collar", "Collar Luna", 80_000, "Dorado", 3, true],
        ["pulsera", "Pulsera Nube", 30_000, "Plateado", 5, true],
        ["borrable", "Anillo Brisa", 20_000, "Plateado", 5, true],
        ["tobillera", "Tobillera Mar", 25_000, "Plateado", 5, true],
      ],
      P,
    );
    await sembrarNegocio(TB, PN_B, `otra-joyeria-${RUN}`, [CB], [["b1", "Aretes Otra Tienda", 11_000, "Dorado", 5, true]], PB);
  });

  after(() => {
    globalThis.fetch = realFetch;
    const bytes = gemini.map((g) => g.bytes);
    const resumen = {
      llamadas_gemini: gemini.length,
      bytes_max_llamada: Math.max(...bytes),
      bytes_promedio_llamada: Math.round(bytes.reduce((a, b) => a + b, 0) / Math.max(1, bytes.length)),
      herramientas_declaradas: gemini[0]?.body.tools?.[0].functionDeclarations.length ?? 0,
      bytes_instruccion_max: Math.max(...gemini.map((g) => Buffer.byteLength(g.body.systemInstruction.parts[0].text))),
      bytes_herramientas: Buffer.byteLength(JSON.stringify(gemini[0]?.body.tools ?? [])),
      llamadas_meta: meta.calls.length,
      otros_hosts: [...otrosHosts],
    };
    if (process.env.PILOTO_RESUMEN) writeFileSync(process.env.PILOTO_RESUMEN, JSON.stringify(resumen, null, 2));
    console.info(JSON.stringify(resumen));
  });

  // ------------------------------------------------------------------ piloto
  describe("0. barreras del piloto (backend, antes de Gemini)", () => {
    it("número NO autorizado: ni Gemini ni respuesta; el mensaje queda en el Inbox", async () => {
      const r = await turno(NO_AUTORIZADO, "Hola, ¿tienen aretes?", [txt("NO DEBE SALIR")]);
      assert.equal(r.gemini.length, 0);
      assert.deepEqual(r.envios, []);
      const { data } = await db.from("dulabs_mensajes_log").select("contenido").eq("phone_number_id", PN).eq("telefono_cliente", NO_AUTORIZADO);
      assert.equal(data?.length, 1);
    });

    it("ia_pausada = true: apagado inmediato (ni Gemini ni respuesta); al volver a false, responde", async () => {
      await setConfig({ ia_pausada: true });
      const r = await turno(C[19], "Hola", [txt("NO DEBE SALIR")]);
      assert.deepEqual([r.gemini.length, r.envios.length], [0, 0]);
      await setConfig({ ia_pausada: false });
      const r2 = await turno(C[19], "Hola otra vez", [txt("¡Hola! ¿Qué joya buscas?")]);
      assert.deepEqual([r2.gemini.length, r2.envios.map((e) => e.texto)], [1, ["¡Hola! ¿Qué joya buscas?"]]);
    });

    it("tope REAL de 8 mensajes por minuto por cliente: pasado el tope, ni Gemini ni respuesta (queda en la traza)", async () => {
      await setAgente({ limites: { turnos_por_minuto_cliente: 2 } });
      try {
        const wa = C[23];
        await turno(wa, "uno", [txt("Hola 1")]);
        await turno(wa, "dos", [txt("Hola 2")]);
        const r = await turno(wa, "tres", [txt("NO DEBE SALIR")]);
        assert.deepEqual([r.gemini.length, r.envios.length, r.traza?.resultado], [0, 0, "rate_limited"]);
      } finally {
        await setAgente({ limites: { turnos_por_minuto_cliente: 60 } });
      }
    });

    it("agente apagado (habilitado = false): silencio, y NO cae a la IA legacy ni a otro proveedor", async () => {
      await setAgente({ habilitado: false });
      const r = await turno(C[19], "¿Siguen ahí?", [txt("NO DEBE SALIR")]);
      await setAgente({ habilitado: true });
      assert.deepEqual([r.gemini.length, r.envios.length, [...otrosHosts].length], [0, 0, 0]);
    });

    it("configuración inválida: la BD ni siquiera acepta otro proveedor; un modelo no soportado, herramientas desconocidas o sin la clave de Delacour => fail-closed, sin Claude y sin respuesta", async () => {
      const intento = await setAgente({ proveedor: "anthropic" });
      assert.equal(intento.error?.code, "23514", "CHECK (proveedor in ('gemini')) en la BD");
      await setAgente({ modelo: "claude-sonnet-5" });
      const r = await turno(C[19], "hola 1", [txt("NO DEBE SALIR")]);
      await setAgente({ modelo: "gemini-3.6-flash", herramientas: ["search_products", "borrar_todo"] });
      const r0 = await turno(C[19], "hola 0", [txt("NO DEBE SALIR")]);
      await setAgente({ herramientas: [...AGENT_TOOL_NAMES] });
      assert.deepEqual([r0.gemini.length, r0.envios.length], [0, 0]);
      const clave = process.env.GEMINI_KEY_DELACOUR;
      delete process.env.GEMINI_KEY_DELACOUR;
      const r2 = await turno(C[19], "hola 2", [txt("NO DEBE SALIR")]);
      process.env.GEMINI_KEY_DELACOUR = clave;
      assert.deepEqual([r.gemini.length, r.envios.length, r2.gemini.length, r2.envios.length], [0, 0, 0, 0]);
      const { data } = await db.from("dulabs_agente_trazas").select("resultado, traza").eq("id_tenant", T).eq("tipo", "boundary").order("created_at", { ascending: true });
      const motivos = (data ?? []).map((d) => `${d.resultado}:${(d.traza as { reason?: string }).reason}`);
      assert.ok(motivos.includes("invalid_config:model_unsupported"), motivos.join(","));
      assert.ok(motivos.includes("invalid_config:tools_invalid"), motivos.join(","));
      assert.ok(motivos.includes("invalid_config:credential_missing"), motivos.join(","));
      assert.deepEqual([...otrosHosts], [], "ningún otro proveedor fue contactado");
    });
  });

  // ------------------------------------------------------------------ A
  describe("A. descubrimiento", () => {
    const wa = C[0];
    let pagina1: Cand[] = [];
    it("'Hola': Gemini recibe herramientas y reglas, NUNCA el catálogo; la clave solo en el header", async () => {
      const r = await turno(wa, "Hola", [txt("¡Hola! Soy Sofía. ¿Qué joya buscas hoy?")]);
      assert.deepEqual(r.envios.map((e) => e.texto), ["¡Hola! Soy Sofía. ¿Qué joya buscas hoy?"]);
      const req = r.gemini[0];
      assert.equal(req.key, "clave-gemini-ficticia-b24");
      assert.equal(req.body.tools?.[0].functionDeclarations.length, AGENT_TOOL_NAMES.length);
      const cuerpo = JSON.stringify(req.body);
      for (const p of Object.values(P)) assert.ok(!cuerpo.includes(p.referencia) && !cuerpo.includes(p.nombre), `el catálogo no viaja al modelo (${p.nombre})`);
      assert.ok(!cuerpo.includes(wa), "el teléfono del cliente no viaja al modelo");
      assert.equal(r.traza?.traza.intent, "conversation");
    });

    it("'Busco aretes': search_products; candidatos y precios del backend; la respuesta los repite exactos", async () => {
      const r = await turno(wa, "Busco aretes", [fn("search_products", { query: "aretes" }), txt(lista)]);
      assert.deepEqual(r.tools, ["search_products:ok"]);
      pagina1 = candidatos(r.gemini[1].body);
      const out = resultados(r.gemini[1].body)[0] as { total: number; has_more: boolean };
      assert.deepEqual([pagina1.length, out.total, out.has_more], [5, 8, true]);
      for (const c of pagina1) {
        const p = Object.values(P).find((x) => x.referencia === c.reference)!;
        assert.equal(c.unit_price, p.precio, "precio del catálogo real (canal detal)");
        assert.match(r.envios[0].texto, new RegExp(formatCop(p.precio).replace("$", "\\$")));
      }
    });

    it("'Muéstrame más': more_products continúa LA MISMA búsqueda (sin repetir)", async () => {
      const r = await turno(wa, "Muéstrame más", [fn("more_products"), txt(lista)]);
      const pagina2 = candidatos(r.gemini[1].body);
      assert.equal(pagina2.length, 3);
      assert.equal(new Set([...pagina1, ...pagina2].map((c) => c.reference)).size, 8);
    });

    it("'Quiero unos aretes dorados': solo dorados", async () => {
      const r = await turno(wa, "Quiero unos aretes dorados", [fn("search_products", { query: "aretes", color: "dorado" }), txt(lista)]);
      const refs = candidatos(r.gemini[1].body).map((c) => c.reference).sort();
      assert.deepEqual(refs, [P.luna, P.gota, P.aro].map((p) => p.referencia).sort());
    });

    it("'Algo parecido': similar_products excluye el producto base y no inventa", async () => {
      const r = await turno(wa, "Algo parecido a los primeros", [fn("similar_products", { reference: P.luna.referencia }), txt(lista)]);
      const refs = candidatos(r.gemini[1].body).map((c) => c.reference);
      assert.ok(refs.length > 0 && !refs.includes(P.luna.referencia));
      for (const ref of refs) assert.ok(Object.values(P).some((p) => p.referencia === ref));
    });

    it("el modelo INVENTA un producto y un precio (dos veces): no sale; mensaje fijo", async () => {
      const r = await turno(wa, "¿Tienen aretes de diamante?", [txt("Sí: Aretes Diamante DL-777777 por $990.000"), txt("Claro, los Aretes Diamante DL-777777 cuestan $990.000")]);
      assert.deepEqual(r.envios.map((e) => e.texto), [FALLBACK_MESSAGES.unverified]);
      assert.ok((r.traza?.traza.grounding.violations as string[]).includes("reference"));
    });
  });

  // ------------------------------------------------------------------ B
  describe("B. referencia", () => {
    const wa = C[20];
    it("'¿Cuánto cuesta DL-…?': precio EXACTO del canal", async () => {
      const r = await turno(wa, `¿Cuánto cuesta ${P.sol.referencia}?`, [
        fn("resolve_product_by_reference", { reference: P.sol.referencia }),
        txt((b) => {
          const p = resultados(b)[0].product as Cand;
          return `Los ${p.name} cuestan ${formatCop(p.unit_price)}.`;
        }),
      ]);
      assert.deepEqual(r.tools, ["resolve_product_by_reference:ok"]);
      assert.deepEqual(r.envios.map((e) => e.texto), [`Los Aretes Sol cuestan ${formatCop(52_000)}.`]);
    });

    it("'DL-999999': no existe; y si el modelo le inventa un precio, no sale", async () => {
      const r = await turno(wa, "¿Y el DL-999999?", [fn("resolve_product_by_reference", { reference: "DL-999999" }), txt("No encontré la referencia DL-999999 en el catálogo.")]);
      assert.deepEqual(r.tools, ["resolve_product_by_reference:REFERENCE_NOT_FOUND"]);
      assert.deepEqual(r.envios.map((e) => e.texto), ["No encontré la referencia DL-999999 en el catálogo."]);
      const r2 = await turno(wa, "¿Seguro? ¿el DL-999999?", [fn("resolve_product_by_reference", { reference: "DL-999999" }), txt("El DL-999999 cuesta $61.000"), txt("El DL-999999 vale $61.000")]);
      assert.deepEqual(r2.envios.map((e) => e.texto), [FALLBACK_MESSAGES.unverified]);
    });
  });

  // ------------------------------------------------------------------ C
  describe("C. fotos", () => {
    const wa = C[1];
    const fotos: Array<{ ref: string; wamid: string }> = [];
    let mostrados: Cand[] = [];
    it("pide fotos: Meta recibe cada imagen por la URL canónica pública; queda registrada conversación → foto → producto", async () => {
      const r = await turno(wa, "Muéstrame fotos de aretes", [
        fn("search_products", { query: "aretes" }),
        fn("request_product_images", (b) => ({ references: candidatos(b).filter((c) => Object.values(P).some((p) => p.referencia === c.reference && p.foto)).slice(0, 3).map((c) => c.reference) })),
        txt("Te envío las fotos de las tres primeras opciones 📸"),
      ]);
      const pedidas = (r.gemini[2].body.contents.at(-2)?.parts[0].functionCall as { args: { references: string[] } }).args.references;
      mostrados = pedidas.map((ref) => candidatos(r.gemini[1].body).find((c) => c.reference === ref)!);
      const imgs = r.envios.filter((e) => e.tipo === "image");
      assert.equal(r.envios[0].tipo, "text", "primero el texto, después las fotos");
      assert.equal(imgs.length, 3);
      const { data: medios } = await db.from("dulabs_agente_medios_enviados").select("wamid, referencia, wa_id, phone_number_id, id_tenant").eq("id_tenant", T).eq("wa_id", wa);
      for (const [i, img] of imgs.entries()) {
        const ref = mostrados[i].reference;
        assert.equal(img.link, `https://dulabs.test/catalogo/${SLUG}/productos/${ref.toLowerCase()}/whatsapp.jpg?v=${img.link!.split("?v=")[1]}`);
        assert.ok(!/supabase|storage|[0-9a-f]{8}-[0-9a-f]{4}-/.test(img.link!), "sin rutas internas ni ids");
        assert.match(img.caption!, new RegExp(ref));
        assert.match(img.caption!, new RegExp(formatCop(mostrados[i].unit_price).replace("$", "\\$")));
        const w = (meta.calls.length, (r.traza?.traza.delivery.images as Array<{ reference: string; wamid: string; recorded: boolean }>)[i]);
        assert.deepEqual([w.reference, w.recorded], [ref, true]);
        assert.ok((medios ?? []).some((m) => m.wamid === w.wamid && m.referencia === ref && m.phone_number_id === PN));
        fotos.push({ ref, wamid: w.wamid });
      }
    });

    it("responde 'quiero este' A LA 2ª FOTO: el backend identifica exactamente ese producto (sin que el cliente escriba la referencia)", async () => {
      const f = fotos[1];
      const r = await turno(wa, "quiero este", [fn("update_cart", { items: [{ reference: f.ref, quantity: 1 }] }), txt((b) => `Listo, agregué ${(resultados(b)[0].lines as Array<{ product_name: string }>)[0].product_name}.`)], { context: { from: DISPLAY, id: f.wamid } });
      assert.deepEqual(r.tools, ["update_cart:ok"]);
      assert.deepEqual((estadoDe(r.gemini[0].body).respondio_a as { foto_de: string }).foto_de, f.ref);
      assert.deepEqual(r.traza?.traza.selection, [{ reference: f.ref, via: "image_reply" }]);
      assert.deepEqual((await conv(wa))?.cart, [{ reference: f.ref, quantity: 1 }]);
    });

    it("'quiero el segundo' (sin citar): la posición en la lista que vio el cliente (tras las fotos, la de las fotos)", async () => {
      const r = await turno(wa, "quiero el segundo", [fn("update_cart", { items: [{ reference: mostrados[1].reference, quantity: 1 }] }), txt("Listo.")]);
      assert.deepEqual(r.traza?.traza.selection, [{ reference: mostrados[1].reference, via: "position" }]);
      assert.deepEqual(r.tools, ["update_cart:ok"]);
    });

    it("responde 'quiero 2 de este' a la 1ª foto: producto de la foto + cantidad 2", async () => {
      const f = fotos[0];
      const r = await turno(wa, "quiero 2 de este", [fn("update_cart", { items: [{ reference: f.ref, quantity: 2 }] }), txt("Listo, 2 unidades.")], { context: { from: DISPLAY, id: f.wamid } });
      assert.deepEqual(r.tools, ["update_cart:ok"]);
      assert.deepEqual((await conv(wa))?.cart.find((c) => c.reference === f.ref), { reference: f.ref, quantity: 2 });
    });

    it("'quiero este' SIN citar ninguna foto: el backend NO deja adivinar (CHOICE_REQUIRED) y se pide aclaración", async () => {
      const antes = (await conv(wa))?.cart;
      const r = await turno(wa, "quiero este", [fn("update_cart", { items: [{ reference: fotos[2].ref, quantity: 1 }] }), txt("¿Cuál de las fotos? Respóndele a esa foto o dime el número.")]);
      assert.deepEqual(r.tools, ["update_cart:CHOICE_REQUIRED"]);
      assert.deepEqual((await conv(wa))?.cart, antes);
      assert.equal(estadoDe(r.gemini[0].body).aclaracion_necesaria, true);
    });

    it("aislamiento: el cliente de OTRO negocio responde a una foto de este negocio → no se encuentra (no se adivina)", async () => {
      const g0 = gemini.length;
      guion.push(txt("¿Qué producto te gustó?"));
      await entregar(PN_B, CB, { id: wamidNuevo(), type: "text", text: { body: "quiero este" }, context: { from: DISPLAY, id: fotos[0].wamid } });
      assert.equal(estadoDe(gemini[g0].body).respondio_a, "un mensaje que no es una foto de producto");
      assert.ok(!JSON.stringify(gemini[g0].body).includes(fotos[0].ref), "ni la referencia del otro negocio llega al modelo");
    });
  });

  // ------------------------------------------------------------------ D + E + F
  describe("D-E-F. carrito, pedido, confirmación y stock", () => {
    const wa = C[2];
    let lista5: Cand[] = [];
    it("D. agregar uno, agregar dos, cambiar cantidad, eliminar y consultar: el servidor calcula precio, subtotal y total", async () => {
      const r0 = await turno(wa, "busco aretes", [fn("search_products", { query: "aretes" }), txt(lista)]);
      lista5 = candidatos(r0.gemini[1].body);
      const [a, b] = lista5;
      assert.deepEqual((await turno(wa, "quiero el primero", [fn("update_cart", { items: [{ reference: a.reference, quantity: 1 }] }), txt("Listo.")])).tools, ["update_cart:ok"]);
      assert.deepEqual((await turno(wa, "y 2 del segundo", [fn("update_cart", { items: [{ reference: b.reference, quantity: 2 }] }), txt("Listo.")])).tools, ["update_cart:ok"]);
      assert.deepEqual((await turno(wa, "cambia el primero a 3", [fn("update_cart", { items: [{ reference: a.reference, quantity: 3 }] }), txt("Listo.")])).tools, ["update_cart:ok"]);
      assert.deepEqual((await turno(wa, "quita el segundo", [fn("update_cart", { items: [{ reference: b.reference, quantity: 0 }] }), txt("Listo.")])).tools, ["update_cart:ok"]);
      const r = await turno(wa, "¿qué tengo en el carrito?", [fn("get_cart"), txt((x) => `Tienes ${formatCop((resultados(x)[0] as { total: number }).total)} en tu selección.`)]);
      const cart = resultados(r.gemini[1].body)[0] as { lines: Array<{ reference: string; quantity: number; unit_price: number; subtotal: number }>; total: number };
      const precio = Object.values(P).find((p) => p.referencia === a.reference)!.precio;
      assert.deepEqual(cart.lines.map((l) => [l.reference, l.quantity, l.unit_price, l.subtotal]), [[a.reference, 3, precio, precio * 3]]);
      assert.equal(cart.total, precio * 3);
    });

    it("E. crear pedido: propuesta con total del backend; proponer NO aparta stock", async () => {
      const a = lista5[0];
      const r = await turno(wa, "hagamos el pedido", [fn("create_order_request"), txt((b) => `Tu pedido: total ${formatCop((resultados(b)[0] as { total: number }).total)}. ¿Confirmas?`)]);
      assert.deepEqual(r.tools, ["create_order_request:ok"]);
      const [p] = await pedidosDe(wa);
      assert.equal(p.estado, "pending_confirmation");
      assert.equal(await stock(a.reference), 5);
    });

    it("E. MODIFICAR la cantidad de un pedido ya propuesto ('mejor que sean 2'): nueva propuesta con el total del backend", async () => {
      const wa = C[21];
      const r0 = await turno(wa, "busco aretes", [fn("search_products", { query: "aretes" }), txt(lista)]);
      const a = candidatos(r0.gemini[1].body)[0];
      await turno(wa, "quiero el primero", [fn("update_cart", { items: [{ reference: a.reference, quantity: 1 }] }), txt("Listo.")]);
      await turno(wa, "hagamos el pedido", [fn("create_order_request"), txt((b) => `Total ${formatCop((resultados(b)[0] as { total: number }).total)}. ¿Confirmas?`)]);
      const r = await turno(wa, "mejor que sean 2", [
        fn("update_cart", { items: [{ reference: a.reference, quantity: 2 }] }),
        fn("create_order_request"),
        txt((b) => `Listo: ahora el total es ${formatCop((resultados(b)[0] as { total: number }).total)}. ¿Confirmas?`),
      ]);
      assert.deepEqual(r.tools, ["update_cart:ok", "create_order_request:ok"]);
      const precio = Object.values(P).find((x) => x.referencia === a.reference)!.precio;
      assert.ok(r.envios[0].texto.includes(formatCop(precio * 2)), r.envios[0]?.texto);
      const pedidos = await pedidosDe(wa);
      assert.equal(pedidos.at(-1)!.total, precio * 2);
      const siguiente = await turno(wa, "¿qué pedido tengo?", [txt("Revisando…")]);
      const vigente = (estadoDe(siguiente.gemini[0].body).propuesta_vigente as { order_id: string }).order_id;
      assert.equal(vigente, pedidos.at(-1)!.pedido_publico, "la propuesta vigente es la NUEVA");
    });

    it("E. el precio cambia antes del 'sí': NO se confirma con el precio viejo; vuelve a borrador; nada apartado; 'confirmado' no sale", async () => {
      const a = lista5[0];
      const p = Object.values(P).find((x) => x.referencia === a.reference)!;
      await ok(db.from("dulabs_inventario_productos").update({ precio: p.precio + 2_000 }).eq("id", p.id));
      p.precio += 2_000;
      const r = await turno(wa, "Sí, confirmo", [
        fn("confirm_order", (b) => ({ order_id: (estadoDe(b).propuesta_vigente as { order_id: string }).order_id, confirmation_id: (estadoDe(b).propuesta_vigente as { confirmation_id: string }).confirmation_id })),
        txt("¡Listo! Tu pedido quedó confirmado."),
        txt("Tu pedido está confirmado 🎉"),
      ]);
      assert.deepEqual(r.tools, ["confirm_order:PRICE_CHANGED"]);
      assert.deepEqual(r.envios.map((e) => e.texto), [FALLBACK_MESSAGES.unverified]);
      const [pedido] = await pedidosDe(wa);
      assert.equal(pedido.estado, "draft");
      assert.deepEqual(await reservas(pedido.id), []);
      assert.equal(await stock(a.reference), 5);
    });

    it("F. revalidar con el precio nuevo y 'Sí, confirmo': reserva ATÓMICA de exactamente 3; un reintento de Meta del mismo 'sí' no reserva otra vez", async () => {
      const a = lista5[0];
      const precio = Object.values(P).find((x) => x.referencia === a.reference)!.precio;
      const r1 = await turno(wa, "¿y ahora cuánto queda?", [
        fn("validate_order", (b) => ({ order_id: (estadoDe(b).pedido_activo as { order_id: string }).order_id })),
        txt((b) => `Con el precio actual: total ${formatCop((resultados(b)[0] as { total: number }).total)}. ¿Confirmas?`),
      ]);
      assert.deepEqual(r1.tools, ["validate_order:ok"]);
      assert.match(r1.envios[0].texto, new RegExp(formatCop(precio * 3).replace("$", "\\$")));
      const confirmar = fn("confirm_order", (b) => ({ order_id: (estadoDe(b).propuesta_vigente as { order_id: string }).order_id, confirmation_id: (estadoDe(b).propuesta_vigente as { confirmation_id: string }).confirmation_id }));
      const r2 = await turno(wa, "Sí, confirmo", [confirmar, txt("¡Listo! Tu pedido quedó confirmado.")]);
      assert.deepEqual(r2.tools, ["confirm_order:ok"]);
      assert.deepEqual(r2.envios.map((e) => e.texto), ["¡Listo! Tu pedido quedó confirmado."]);
      const [pedido] = await pedidosDe(wa);
      assert.equal(pedido.estado, "confirmed");
      assert.deepEqual(await reservas(pedido.id), [{ cantidad: 3, estado: "activa" }]);
      assert.equal(await stock(a.reference), 2);
      // Meta reentrega EXACTAMENTE el mismo mensaje (mismo wamid).
      const r3 = await turno(wa, "Sí, confirmo", [confirmar, txt("NO DEBE SALIR")], { wamid: r2.wamid });
      assert.deepEqual([r3.gemini.length, r3.envios.length], [0, 0]);
      assert.equal(await stock(a.reference), 2);
    });

    it("E. producto BORRADO: no se crea un pedido vacío; producto DESACTIVADO o stock insuficiente: borrador con el problema, nunca propuesta confirmable", async () => {
      const wa2 = C[3];
      await turno(wa2, `quiero el ${P.borrable.referencia}`, [fn("update_cart", { items: [{ reference: P.borrable.referencia, quantity: 1 }] }), txt("Listo.")]);
      await ok(db.from("dulabs_inventario_productos").delete().eq("id", P.borrable.id));
      const r1 = await turno(wa2, "hagamos el pedido", [fn("create_order_request"), txt("Ese producto ya no está disponible.")]);
      assert.deepEqual(r1.tools, ["create_order_request:REFERENCE_NOT_FOUND"]);
      assert.equal((await pedidosDe(wa2)).length, 0);

      await turno(wa2, `quiero la ${P.pulsera.referencia}`, [fn("update_cart", { items: [{ reference: P.pulsera.referencia, quantity: 1 }] }), txt("Listo.")]);
      await ok(db.from("dulabs_inventario_productos").update({ activo: false }).eq("id", P.pulsera.id));
      const r2 = await turno(wa2, "hagamos el pedido", [fn("create_order_request"), txt("Ese producto ya no está disponible; ¿quieres ver otras opciones?")]);
      const [d1] = await pedidosDe(wa2);
      assert.deepEqual([r2.tools, d1.estado, d1.problemas.map((x) => x.code)], [["create_order_request:ok"], "draft", ["product_unavailable"]]);

      const wa3 = C[4];
      await turno(wa3, `quiero 5 del ${P.collar.referencia}`, [fn("update_cart", { items: [{ reference: P.collar.referencia, quantity: 5 }] }), txt("Listo.")]);
      await turno(wa3, "hagamos el pedido", [fn("create_order_request"), txt("Solo hay 3 disponibles de ese collar. ¿Te sirven 3?")]);
      const [d2] = await pedidosDe(wa3);
      assert.deepEqual([d2.estado, d2.problemas.map((x) => x.code)], ["draft", ["insufficient_stock"]]);
      assert.equal(await stock(P.collar.referencia), 3);
    });

    /** Modelo que confirma cuando el cliente dice "sí" (sirve para varios mensajes a la vez). */
    const confirmador = (b: Body) => {
      const res = resultados(b);
      if (res.length > 0 && b.contents.at(-1)?.role === "user" && res[0]) {
        const r0 = res[0] as { status?: string; error?: { code: string } };
        return txt(r0.error ? (r0.error.code === "OUT_OF_STOCK" ? "Lo siento: esa pieza se acaba de agotar." : "Tu pedido ya está en proceso.") : "¡Listo! Tu pedido quedó confirmado.")(b);
      }
      const e = estadoDe(b);
      const prop = e.propuesta_vigente as { order_id: string; confirmation_id: string } | null;
      if (/^s[ií]/i.test(ultimoTexto(b).trim()) && prop) return fn("confirm_order", { order_id: prop.order_id, confirmation_id: prop.confirmation_id })(b);
      return txt("¿Me confirmas tu pedido?")(b);
    };
    async function propuestaPara(wa: string, prod: Prod) {
      await turno(wa, `quiero el ${prod.referencia}`, [fn("update_cart", { items: [{ reference: prod.referencia, quantity: 1 }] }), txt("Listo.")]);
      await turno(wa, "hagamos el pedido", [fn("create_order_request"), txt((b) => `Total ${formatCop((resultados(b)[0] as { total: number }).total)}. ¿Confirmas?`)]);
      assert.equal((await pedidosDe(wa)).at(-1)?.estado, "pending_confirmation");
    }

    it("F. dos confirmaciones SIMULTÁNEAS del mismo cliente ('sí' y 'sí, confirmo' a la vez): UNA sola reserva", async () => {
      const wa4 = C[5];
      await propuestaPara(wa4, P.gota);
      politica = confirmador;
      try {
        await Promise.all([entregar(PN, wa4, { id: wamidNuevo(), type: "text", text: { body: "sí" } }), entregar(PN, wa4, { id: wamidNuevo(), type: "text", text: { body: "sí, confirmo" } })]);
      } finally {
        politica = null;
      }
      const pedidos = await pedidosDe(wa4);
      assert.deepEqual(pedidos.map((p) => p.estado), ["confirmed"]);
      assert.deepEqual(await reservas(pedidos[0].id), [{ cantidad: 1, estado: "activa" }]);
      assert.equal(await stock(P.gota.referencia), 4);
    });

    it("F. ÚLTIMA UNIDAD entre dos conversaciones que confirman a la vez: exactamente una venta; la otra, 'agotado' y borrador", async () => {
      const [x, y] = [C[6], C[7]];
      await propuestaPara(x, P.unico);
      await propuestaPara(y, P.unico);
      politica = confirmador;
      const m0 = meta.calls.length;
      try {
        await Promise.all([entregar(PN, x, { id: wamidNuevo(), type: "text", text: { body: "Sí, confirmo" } }), entregar(PN, y, { id: wamidNuevo(), type: "text", text: { body: "Sí, confirmo" } })]);
      } finally {
        politica = null;
      }
      const estados = [(await pedidosDe(x))[0].estado, (await pedidosDe(y))[0].estado].sort();
      assert.deepEqual(estados, ["confirmed", "draft"]);
      assert.equal(await stock(P.unico.referencia), 0);
      const textos = envios(m0).map((e) => e.texto).sort();
      assert.deepEqual(textos, ["Lo siento: esa pieza se acaba de agotar.", "¡Listo! Tu pedido quedó confirmado."].sort());
    });
  });

  // ------------------------------------------------------------------ G
  describe("G. asesora", () => {
    const wa = C[8];
    it("'Quiero hablar con una asesora': traspaso directo, SIN Gemini; chat en pausa 24 h", async () => {
      const r = await turno(wa, "Quiero hablar con una asesora", [txt("NO DEBE SALIR")]);
      assert.equal(r.gemini.length, 0);
      assert.deepEqual(r.envios.map((e) => e.texto), [FALLBACK_MESSAGES.handoff]);
      assert.deepEqual(r.traza?.traza.handoff, { source: "customer", motive: "customer_request" });
      assert.ok((await pausa(wa))! - Date.now() > 23 * 3600_000);
    });

    it("con la asesora a cargo el agente NO responde; ni aunque ella conteste desde el celular (eco)", async () => {
      const antes = await pausa(wa);
      await procesarCambio(PN, { messaging_product: "whatsapp", metadata: { phone_number_id: PN, display_phone_number: DISPLAY }, smb_message_echoes: [{ from: DISPLAY, to: wa, id: `wamid.eco.${RUN}`, type: "text", text: { body: "Hola, soy Laura" } } as never] });
      assert.ok((await pausa(wa))! >= antes!, "la respuesta manual no acorta la pausa");
      const r = await turno(wa, "¿hola?", [txt("NO DEBE SALIR")]);
      assert.deepEqual([r.gemini.length, r.envios.length], [0, 0]);
    });

    it("la asesora devuelve la conversación a la IA (Inbox): el agente vuelve a responder", async () => {
      await liberarPausaChat(db, PN, wa);
      const r = await turno(wa, "gracias, una pregunta más", [txt("¡Claro! Cuéntame.")]);
      assert.deepEqual(r.envios.map((e) => e.texto), ["¡Claro! Cuéntame."]);
    });
  });

  // ------------------------------------------------------------------ H
  describe("H. mensajes sin texto (política del Bloque 23)", () => {
    it("nota de voz: aviso fijo, sin Gemini; sticker y reacción: nada", async () => {
      const wa = C[9];
      const a = await turno(wa, { type: "audio", audio: { id: "m-1", mime_type: "audio/ogg" } });
      assert.deepEqual([a.gemini.length, a.envios.map((e) => e.texto)], [0, [NON_TEXT_MESSAGES.audio]]);
      const s = await turno(wa, { type: "sticker", sticker: { id: "m-2" } });
      const re = await turno(wa, { type: "reaction", reaction: { message_id: a.wamid, emoji: "👍" } });
      assert.deepEqual([s.envios.length, re.envios.length, s.gemini.length, re.gemini.length], [0, 0, 0, 0]);
    });

    for (const [i, tipo, msg] of [
      [10, "image", { type: "image", image: { id: "m-3", caption: "¿tienen este?" } }],
      [11, "document", { type: "document", document: { id: "m-4", filename: "comprobante.pdf" } }],
      [12, "location", { type: "location", location: { latitude: 4.61, longitude: -74.08 } }],
      [13, "contacts", { type: "contacts", contacts: [{ name: { formatted_name: "Ana" }, phones: [{ phone: "+57 300 000 0000" }] }] }],
    ] as const) {
      it(`${tipo}: pasa a una asesora (sin Gemini), Inbox con el tipo y sin datos del contenido`, async () => {
        const wa = C[i];
        const r = await turno(wa, msg as Record<string, unknown>);
        assert.equal(r.gemini.length, 0);
        assert.equal(r.traza?.resultado, "handoff");
        assert.ok((await pausa(wa)) !== null);
        const { data } = await db.from("dulabs_mensajes_log").select("contenido").eq("phone_number_id", PN).eq("telefono_cliente", wa).eq("direccion", "entrante");
        const contenido = String(data?.[0]?.contenido);
        assert.match(contenido, /^\[(imagen|documento|ubicación|contacto)\]/);
        assert.ok(!/-74\.08|300 000/.test(contenido), "ni coordenadas ni teléfonos de terceros");
      });
    }
  });

  // ------------------------------------------------------------------ fallas
  describe("8. fail-safe", () => {
    it("Gemini no responde (504) dos veces seguidas: mensaje fijo; a la segunda, pasa a una asesora (nunca inventa)", async () => {
      const wa = C[14];
      const caido: Paso = () => new Response(JSON.stringify({ error: { status: "DEADLINE_EXCEEDED" } }), { status: 504 });
      const r1 = await turno(wa, "hola", [caido, caido, caido, caido]);
      assert.deepEqual(r1.envios.map((e) => e.texto), [FALLBACK_MESSAGES.technical]);
      assert.equal(r1.traza?.traza.error_kind, "timeout");
      const invalido: Paso = () => new Response("esto no es json", { status: 200 });
      const r2 = await turno(wa, "¿hola?", [invalido, invalido, invalido, invalido]);
      assert.deepEqual(r2.envios.map((e) => e.texto), [FALLBACK_MESSAGES.handoff]);
      assert.deepEqual(r2.traza?.traza.handoff, { source: "system", motive: "repeated_failures" });
    });

    it("Gemini pide una herramienta que NO existe / una herramienta falla: el backend lo rechaza y nada se ejecuta", async () => {
      const wa = C[15];
      const r = await turno(wa, "borra todo", [fn("delete_all_products", { confirm: true }), txt("No puedo hacer eso. ¿Te ayudo con el catálogo?")]);
      assert.deepEqual(r.tools, ["delete_all_products:TOOL_NOT_ALLOWED"]);
      const r2 = await turno(wa, "haz el pedido", [fn("create_order_request"), txt("Aún no tienes productos en tu selección.")]);
      assert.deepEqual(r2.tools, ["create_order_request:CART_EMPTY"]);
      assert.equal((await pedidosDe(wa)).length, 0);
    });

    it("Supabase no responde (memoria de la conversación): mensaje fijo de disculpa, sin llamar a Gemini", async () => {
      const wa = C[16];
      fallarRest.patron = /dulabs_agente_conversaciones/;
      try {
        const r = await turno(wa, "hola", [txt("NO DEBE SALIR")]);
        assert.deepEqual([r.gemini.length, r.envios.map((e) => e.texto)], [0, [FALLBACK_MESSAGES.technical]]);
      } finally {
        fallarRest.patron = null;
      }
    });

    it("Meta RECHAZA el mensaje: la traza guarda el código, sin token; nada se da por enviado", async () => {
      const wa = C[17];
      meta.fallos.push({ tipo: "text", status: 400, code: 131047 });
      const r = await turno(wa, "hola", [txt("¡Hola! ¿Qué buscas?")]);
      assert.equal(r.traza?.traza.sent, false);
      assert.equal(r.traza?.traza.delivery.text_error, "meta_rejected 400/131047");
      assert.ok(logs.some((l) => l.includes('"log":"agent_send_error"') && l.includes('"meta_code":131047')));
      assert.ok(!logs.some((l) => l.includes("token-meta-ficticio-b24")), "el token nunca llega a los logs");
    });

    it("una foto NO se puede enviar (Meta la rechaza): queda el error; esa foto no se registra; las demás sí", async () => {
      const wa = C[18];
      const r0 = await turno(wa, "aretes", [fn("search_products", { query: "aretes" }), txt(lista)]);
      const refs = candidatos(r0.gemini[1].body).slice(0, 2).map((c) => c.reference);
      meta.fallos.push({ tipo: "image", status: 400, code: 131053 });
      const conFoto = candidatos(r0.gemini[1].body).filter((c) => Object.values(P).some((p) => p.referencia === c.reference && p.foto));
      refs.splice(0, 2, ...conFoto.slice(0, 2).map((c) => c.reference));
      const r = await turno(wa, "fotos de las dos primeras", [fn("request_product_images", { references: refs }), txt("Te envío las fotos.")]);
      const imgs = r.traza?.traza.delivery.images as Array<{ reference: string; recorded: boolean; error?: string | null }>;
      assert.equal(imgs[0].error, "meta_rejected 400/131053");
      assert.equal(imgs[0].recorded, false);
      assert.equal(imgs[1].recorded, true);
      const sinFoto = await turno(wa, `foto del ${P.cristal.referencia}`, [fn("request_product_images", { references: [P.cristal.referencia] }), txt("Ese producto todavía no tiene foto.")]);
      assert.equal(((resultados(sinFoto.gemini[1].body)[0] as { skipped: Array<{ reason: string }> }).skipped[0] ?? {}).reason, "no_photo");
    });
  });

  // ------------------------------------------------------------------ diagnóstico
  describe("I. Bloque 25 — clasificación detal / mayorista por contacto (RPC y bitácora reales)", () => {
    const canalDe = async (wa: string) => (await db.from("dulabs_catalogo_clientes_canal").select("canal, origen").eq("id_tenant", T).eq("phone_number_id", PN).eq("wa_id", wa).maybeSingle()).data as { canal: string; origen: string } | null;
    const eventosDe = async (wa: string) => ((await db.from("dulabs_catalogo_clientes_canal_eventos").select("canal_anterior, canal_nuevo, origen, miembro_id, motivo").eq("phone_number_id", PN).eq("wa_id", wa).order("id")).data ?? []) as Array<Record<string, unknown>>;
    const buscarLuna = [fn("search_products", { query: "aretes luna" }), txt(lista)];
    before(async () => {
      await ok(db.from("dulabs_inventario_productos").update({ precio_mayor: 25_000 }).eq("id", P.luna.id));
      await ok(setAgente({ clasificacion_cliente: true }));
    });
    after(async () => {
      await ok(setAgente({ clasificacion_cliente: false }));
    });

    it("A/B. contacto nuevo: pregunta con BOTONES (sin Gemini); elige por botón 'al por mayor' → queda mayorista y ve precios mayoristas", async () => {
      const r0 = await turno(C[24], "hola, quiero ver aretes");
      assert.equal(r0.gemini.length, 0, "no se llama a Gemini antes de clasificar");
      const botones = meta.calls.slice(-1)[0].body as { type: string; interactive: { body: { text: string }; action: { buttons: Array<{ reply: { id: string; title: string } }> } } };
      assert.equal(botones.type, "interactive");
      assert.equal(botones.interactive.body.text, CHANNEL_QUESTION.body);
      assert.deepEqual(botones.interactive.action.buttons.map((b) => [b.reply.id, b.reply.title]), [["canal_detal", "Comprar al detal"], ["canal_mayor", "Comprar al por mayor"]]);
      assert.equal(r0.traza?.traza.classification.action, "asked");
      assert.equal(await canalDe(C[24]), null);
      const r1 = await turno(C[24], { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "canal_mayor", title: "Comprar al por mayor" } } }, buscarLuna);
      assert.deepEqual(await canalDe(C[24]), { canal: "wholesale", origen: "cliente" });
      assert.equal(candidatos(r1.gemini[1].body).find((c) => c.reference === P.luna.referencia)?.unit_price, 25_000, "precio mayorista del backend");
      assert.match(r1.envios[0].texto, new RegExp(formatCop(25_000).replace("$", "\\$")));
      assert.deepEqual(await eventosDe(C[24]), [{ canal_anterior: null, canal_nuevo: "wholesale", origen: "cliente", miembro_id: null, motivo: null }]);
    });

    it("A/C. detal: precios al detal; pedir el precio al por mayor => asesora con mensaje fijo, sin Gemini, sin precio mayorista", async () => {
      await turno(C[25], "buenas");
      const r1 = await turno(C[25], "Comprar al detal", buscarLuna);
      assert.equal(candidatos(r1.gemini[1].body).find((c) => c.reference === P.luna.referencia)?.unit_price, 45_000);
      const r2 = await turno(C[25], `¿Y cuál es el precio al por mayor de ${P.luna.referencia}?`);
      assert.equal(r2.gemini.length, 0);
      assert.deepEqual(r2.envios.map((e) => e.texto), [CLASSIFICATION_MESSAGES.changeRequested("retail")]);
      assert.ok(!r2.envios[0].texto.includes(formatCop(25_000)));
      assert.ok((await pausa(C[25]))! > Date.now(), "la IA queda en pausa: la asesora decide");
      assert.equal((await canalDe(C[25]))?.canal, "retail", "pedirlo no lo cambia");
    });

    it("H. solo una asesora cambia la modalidad (RPC real): compare-and-set, bitácora inmutable, y el cliente ya ve el otro precio", async () => {
      const store = createSupabaseCustomerChannelStore(db);
      const key = { tenantId: T, phoneNumberId: PN, waId: C[25] };
      assert.equal((await store.setInitial(key, "wholesale", "cliente")).result, "conflicto", "el cliente no se reclasifica");
      assert.equal((await store.change(key, { channel: "wholesale", expected: "wholesale", memberId: 7, reason: "x" })).result, "conflicto");
      assert.equal((await store.change({ ...key, tenantId: TB }, { channel: "wholesale", expected: "retail", memberId: 7, reason: "x" }).catch((e: Error) => e.message)), "[agente/clasificacion] 42501", "otro negocio: rechazado");
      assert.deepEqual(await store.change(key, { channel: "wholesale", expected: "retail", memberId: 7, reason: "Distribuidora con NIT" }), { result: "cambiado", channel: "wholesale", origin: "asesora" });
      assert.deepEqual((await eventosDe(C[25])).at(-1), { canal_anterior: "retail", canal_nuevo: "wholesale", origen: "asesora", miembro_id: 7, motivo: "Distribuidora con NIT" });
      const { error } = await db.from("dulabs_catalogo_clientes_canal_eventos").delete().eq("phone_number_id", PN).eq("wa_id", C[25]);
      assert.ok(error, "la bitácora no se puede borrar");
      assert.equal((await eventosDe(C[25])).length, 2);
      await liberarPausaChat(db, PN, C[25]);
      const r = await turno(C[25], "muéstrame los aretes luna", buscarLuna);
      assert.equal(candidatos(r.gemini[1].body).find((c) => c.reference === P.luna.referencia)?.unit_price, 25_000);
      assert.deepEqual(r.traza?.traza.classification, { action: "known", channel: "wholesale", origin: "asesora" });
    });

    it("G. el pedido de un cliente mayorista queda marcado mayorista con su precio", async () => {
      await turno(C[24], "quiero 2 del primero", [fn("update_cart", { items: [{ reference: P.luna.referencia, quantity: 2 }] }), txt("Listo, agregué 2.")]);
      await turno(C[24], "hagamos el pedido", [fn("create_order_request"), txt((b) => `Total: ${formatCop((resultados(b)[0] as { total: number }).total)}. ¿Confirmas?`)]);
      const { data } = await db.from("dulabs_catalogo_pedidos").select("canal, total").eq("id_tenant", T).eq("contacto_wa_id", C[24]).single();
      assert.deepEqual(data, { canal: "wholesale", total: 50_000 });
    });
  });

  describe("2. diagnóstico de producción (sin datos personales)", () => {
    it("reconstruye cada turno: intención, herramientas, validación, respuesta enviada, entrega de Meta, asesora y pedido", async () => {
      // Meta informa la entrega del último mensaje de C[2] (confirmación) y un fallo de otro.
      const { data: salientes } = await db.from("dulabs_mensajes_log").select("wamid, contenido").eq("phone_number_id", PN).eq("telefono_cliente", C[2]).eq("direccion", "saliente").order("created_at", { ascending: false }).limit(1);
      const confirmado = (salientes ?? [])[0] as { wamid: string };
      await procesarCambio(PN, { messaging_product: "whatsapp", metadata: { phone_number_id: PN, display_phone_number: DISPLAY }, statuses: [{ id: confirmado.wamid, status: "delivered", recipient_id: C[2] } as never] });
      const { data, error } = await db.rpc("dulabs_agente_diagnosticar", { p_tenant: T, p_telefono: C[2], p_limite: 50 });
      assert.equal(error, null);
      const filas = data as Array<{ intencion: string | null; herramientas: string | null; respuesta_enviada: boolean; entrega_texto: string | null; pedido: string | null; resultado: string }>;
      const conf = filas.find((f) => (f.herramientas ?? "").includes("confirm_order:ok"))!;
      assert.deepEqual([conf.intencion, conf.respuesta_enviada, conf.entrega_texto], ["confirmar", true, "entregado"]);
      assert.match(conf.pedido ?? "", /^DL-ORD-/);
      assert.ok(filas.some((f) => (f.herramientas ?? "").includes("confirm_order:PRICE_CHANGED")), "el intento rechazado también queda");
      const { data: g } = await db.rpc("dulabs_agente_diagnosticar", { p_tenant: T, p_telefono: C[8], p_limite: 50 });
      assert.ok((g as Array<{ asesora_motivo: string | null }>).some((f) => f.asesora_motivo === "cliente_pidio_asesora"));
      const { data: ev } = await db.from("dulabs_catalogo_pedido_eventos").select("tipo, estado_desde, estado_hacia, actor").eq("id_tenant", T);
      assert.ok((ev ?? []).some((e) => e.estado_hacia === "confirmed"), "pedido confirmado con evento");
    });

    it("las trazas y los logs del agente NO guardan teléfonos, claves, tokens ni ids internos de productos", async () => {
      const { data } = await db.from("dulabs_agente_trazas").select("traza, contact_ref").eq("id_tenant", T);
      const todo = JSON.stringify(data);
      for (const wa of [...C, NO_AUTORIZADO]) assert.ok(!todo.includes(wa), "sin teléfonos");
      for (const s of ["clave-gemini-ficticia-b24", "token-meta-ficticio-b24"]) assert.ok(!todo.includes(s) && !logs.some((l) => l.includes(s)), `sin secretos (${s})`);
      for (const p of Object.values(P)) assert.ok(!todo.includes(p.id), "sin ids internos de productos");
      const agente = logs.filter((l) => /"log":"agent_/.test(l));
      assert.ok(agente.length > 10);
      for (const wa of C) assert.ok(!agente.some((l) => l.includes(wa)), "los logs del agente no llevan teléfonos");
    });
  });
});
