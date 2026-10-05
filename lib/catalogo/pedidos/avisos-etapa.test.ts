/**
 * FASE 3B.9F — AVISO AL CLIENTE CUANDO SU PEDIDO YA ACEPTADO AVANZA DE ETAPA ("en preparación", "enviado", "entregado"), con el texto del propio negocio.
 *
 * Hallazgo real (2026-10-05): una persona del equipo de Aquí Sí Lo Compras marcó un pedido "en preparación" y luego "enviado", con la ventana de 24 h abierta, y el cliente no
 * recibió nada: esos avisos dependían de notificaciones_pedidos (plantillas de la plataforma, con el tono de otro negocio), apagado a propósito para ese negocio.
 *
 *   - un negocio con avisos_etapa_pedidos recibe, en cada etapa, SU texto (checkout_opciones.cierre.textos) con el número de pedido, una sola vez por pedido y etapa;
 *   - sin texto configurado para esa etapa, o para etapas sin texto (pago, completado, cancelado, rechazado), no se envía nada: nunca se inventa uno ni se usa el de otro negocio;
 *   - un negocio con notificaciones_pedidos (como siempre) sigue recibiendo las plantillas de la plataforma, y NO lee ninguna configuración (su camino no cambió);
 *   - ventana de 24 h, reintento, fallos de Meta y de la base: todo igual que en los avisos de siempre, pero el reintento reenvía el texto del negocio (no la plantilla).
 *
 * Motor, pedidos, notificaciones y configuración en memoria (el parser y el esquema REALES del runtime); Meta simulada. Negocios, personas y clientes ficticios.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMemoryAgentConfigStore, parseAgentConfig, type AgentConfigRow } from "@/lib/agente/config";
import { crearLectorConfigAceptacion, leerConfigAceptacion, type ConfigAceptacion } from "@/lib/agente/aceptacion-humana";
import { CREDENCIAL_GEMINI_ASLC, HERRAMIENTAS_ASLC } from "@/lib/agente/aprovisionamiento";
import { TEXTOS_ASLC, configuracionCompletaAslc, negocioCompletoAslc, type TextosAprobadosAslc } from "@/lib/agente/activacion-aslc";
import { checkoutOpcionesSchema } from "@/lib/agente/perfil-negocio";
import { ETAPAS_CON_TEXTO, MARCADORES_ETAPA, esEtapaConTexto, renderizarTextoEtapa } from "@/lib/agente/textos-etapa";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine, type CheckoutData, type OrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { accionGestion, reintentarNotificacionGestion } from "@/lib/catalogo/pedidos/gestion";
import type { Order } from "@/lib/catalogo/pedidos/contrato";
import { ErrorEnvioWhatsapp, createMemoryNotificacionesStore, mensajeNotificacion, type EnviadorWhatsapp, type NotificadorDeps, type ResultadoNotificacion, type TipoNotificacion } from "@/lib/catalogo/pedidos/notificaciones";
import { crearTextoDeEtapa } from "@/lib/catalogo/pedidos/avisos-etapa";
import { productionNotificadorDelPanel, productionTextoDeEtapa } from "@/lib/catalogo/pedidos/avisos-etapa-produccion";
import { MODULOS_AVISOS_DE_DECISION, MODULOS_AVISOS_DE_ESTADO, MODULOS_PANEL_DE_PEDIDOS, MODULO_AVISOS_DE_ETAPA, productionNotificador } from "@/lib/catalogo/pedidos/notificaciones-produccion";
import { MODULOS, esModuloId } from "@/lib/tenant-modulos";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const JSON_TEXTOS = JSON.parse(leer("supabase/provisioning/aslc/textos-aprobados.json")) as Record<string, unknown>;
const TEXTOS: TextosAprobadosAslc = {
  aviso: JSON_TEXTOS.aviso as string,
  tras_aviso_confirma: JSON_TEXTOS.tras_aviso_confirma as string,
  ubicacion: JSON_TEXTOS.ubicacion as string,
  desconfianza: JSON_TEXTOS.desconfianza as string,
};

const A: CatalogActor = { tenantId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: "admin-a" }; // negocio con avisos_etapa_pedidos (como Aquí Sí Lo Compras)
const B: CatalogActor = { tenantId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: "admin-b" }; // negocio con notificaciones_pedidos (como siempre)
const PN_A = "100000000000001";
const PN_B = "200000000000002";
const ANA = { phoneNumberId: PN_A, waId: "573001110001" };
const LUIS = { phoneNumberId: PN_B, waId: "573001110002" };
const ASESORA = 41;
const RESPONSABLE = 41;

const DOMICILIO: CheckoutData = { customerName: "Ana Pérez", paymentMethod: "contra_entrega", delivery: "domicilio", address: "Calle 1 # 2-3", city: "Montería", deliveryReference: null };

/** La fila del agente de un negocio con la configuración COMPLETA de Aquí Sí Lo Compras (la que carga el 03), leída después con el parser REAL del runtime. */
function filaAgente(tenantId: string, phoneNumberId: string, checkoutOpciones: unknown = configuracionCompletaAslc({ aviso: TEXTOS.aviso, trasAvisoConfirma: TEXTOS.tras_aviso_confirma, miembroId: RESPONSABLE })): AgentConfigRow {
  return {
    id_tenant: tenantId,
    phone_number_id: phoneNumberId,
    tipo: "catalog_sales",
    habilitado: true,
    proveedor: "gemini",
    modelo: "gemini-3.6-flash",
    credencial_ref: CREDENCIAL_GEMINI_ASLC,
    nivel_razonamiento: null,
    herramientas: [...HERRAMIENTAS_ASLC],
    canal: "retail",
    negocio: negocioCompletoAslc(TEXTOS),
    vocabulario: null,
    checkout_opciones: checkoutOpciones as AgentConfigRow["checkout_opciones"],
    checkout_conversacional: true,
    meta_token_plataforma: false,
    transcripcion_audio: true,
  };
}

/** checkout_opciones tal como quedó en producción ANTES de este cambio (03 + 12 + 13): con los mensajes de decisión y sin los avisos de etapa. */
function opcionesAntesDeLaEtapa(): Record<string, unknown> {
  const c = JSON.parse(JSON.stringify(configuracionCompletaAslc({ aviso: TEXTOS.aviso, trasAvisoConfirma: TEXTOS.tras_aviso_confirma, miembroId: RESPONSABLE }))) as { cierre: { textos: Record<string, string> } };
  for (const k of ETAPAS_CON_TEXTO) delete c.cierre.textos[k];
  return c as unknown as Record<string, unknown>;
}

const pedidoPublico = "DL-ORD-ABC234";
const pedidoSimple = (tenantId: string, over: Partial<Order> = {}): Order =>
  ({ id: "pedido-interno-1", orderId: pedidoPublico, businessId: tenantId, status: "confirmed", contact: { waId: "573001110001", phoneNumberId: PN_A }, checkout: { customerName: "Ana Pérez", delivery: "domicilio", stage: "en_preparacion", paymentStatus: "pendiente" }, ...over }) as unknown as Order;

// ===========================================================================
// 1. El módulo y el esquema
// ===========================================================================

describe("3B.9F · el módulo avisos_etapa_pedidos y los textos de etapa del esquema", () => {
  it("es un módulo conocido (formato de la tabla); no cambia los avisos de siempre ni los de decisión", () => {
    assert.ok(esModuloId("avisos_etapa_pedidos"));
    assert.ok((MODULOS as readonly string[]).includes("avisos_etapa_pedidos"));
    assert.match("avisos_etapa_pedidos", /^[a-z][a-z0-9_]{1,39}$/, "formato que exige dulabs_tenant_modulos");
    assert.equal(MODULO_AVISOS_DE_ETAPA, "avisos_etapa_pedidos");
    assert.deepEqual([...MODULOS_AVISOS_DE_ESTADO], ["notificaciones_pedidos"], "las plantillas de la plataforma siguen dependiendo SOLO del módulo de siempre");
    assert.deepEqual([...MODULOS_AVISOS_DE_DECISION].sort(), ["avisos_decision_pedidos", "notificaciones_pedidos"], "los mensajes de decisión no cambian");
    assert.deepEqual([...MODULOS_PANEL_DE_PEDIDOS].sort(), ["avisos_etapa_pedidos", "notificaciones_pedidos"], "las acciones del panel las enciende cualquiera de los dos");
  });

  it("solo hay tres etapas con texto, y las tres son tipos de aviso reales", () => {
    assert.deepEqual([...ETAPAS_CON_TEXTO], ["en_preparacion", "enviado", "entregado"]);
    for (const e of ETAPAS_CON_TEXTO) assert.ok(esEtapaConTexto(e));
    for (const otro of ["pago_recibido", "completado", "cancelado", "rechazado", "aceptado", "", null, undefined, 3]) assert.equal(esEtapaConTexto(otro), false, String(otro));
  });

  it("renderizarTextoEtapa: completa SOLO {pedido}; rechaza cualquier otro marcador, llaves sueltas y un número de pedido que no es público", () => {
    const ok = renderizarTextoEtapa("Hola, tu pedido {pedido} sigue su curso. Pedido {pedido}.", { pedido: pedidoPublico });
    assert.deepEqual(ok, { ok: true, texto: `Hola, tu pedido ${pedidoPublico} sigue su curso. Pedido ${pedidoPublico}.` });
    for (const malo of ["Tu pedido {pedido}: {motivo}", "Hola {nombre}", "{{pedido}}", "llave suelta {pedido", "cierra }", "   "]) {
      const r = renderizarTextoEtapa(malo, { pedido: pedidoPublico });
      assert.equal(r.ok, false, malo);
      if (!r.ok) assert.equal(r.motivo, "plantilla_invalida", malo);
    }
    assert.deepEqual(renderizarTextoEtapa("Pedido {pedido}", { pedido: "mi pedido 1234567" }), { ok: false, motivo: "pedido_invalido" });
    assert.deepEqual([...MARCADORES_ETAPA], ["pedido"]);
    // Lo que se inserta nunca se vuelve a interpretar ni cambia el resto del texto: se envía tal cual.
    assert.equal(renderizarTextoEtapa("A $& B {pedido} $1", { pedido: pedidoPublico }).ok && (renderizarTextoEtapa("A $& B {pedido} $1", { pedido: pedidoPublico }) as { texto: string }).texto, `A $& B ${pedidoPublico} $1`);
  });

  it("el esquema acepta los tres textos (opcionales) y sigue rechazando marcadores de más, bordes con espacio, más de 500 caracteres y claves desconocidas", () => {
    const base = JSON.parse(JSON.stringify(configuracionCompletaAslc({ aviso: TEXTOS.aviso, trasAvisoConfirma: TEXTOS.tras_aviso_confirma, miembroId: RESPONSABLE }))) as { cierre: { textos: Record<string, unknown> } };
    const con = (cambios: Record<string, unknown>) => checkoutOpcionesSchema.safeParse({ ...base, cierre: { ...base.cierre, textos: { ...base.cierre.textos, ...cambios } } });
    assert.ok(con({}).success, "la configuración completa de hoy es válida");
    assert.ok(checkoutOpcionesSchema.safeParse(opcionesAntesDeLaEtapa()).success, "la configuración de producción de ANTES (sin avisos de etapa) sigue siendo válida: el código se puede desplegar antes que el 14");
    for (const clave of ETAPAS_CON_TEXTO) {
      assert.ok(con({ [clave]: "Tu pedido {pedido} avanzó." }).success, clave);
      for (const malo of ["Con {motivo}", "Con {nombre}", " espacio inicial", "espacio final ", "x".repeat(501), "", "llave {pedido"]) assert.equal(con({ [clave]: malo }).success, false, `${clave}: ${JSON.stringify(malo.slice(0, 18))}`);
    }
    assert.equal(con({ otra_etapa: "x" }).success, false, "una clave desconocida sigue siendo una configuración inválida (strict)");
  });
});

// ===========================================================================
// 2. Cómo se lee la configuración (parser REAL del runtime)
// ===========================================================================

describe("3B.9F · la configuración de ASLC y su lectura con el parser real del runtime", () => {
  it("la configuración completa de hoy trae los tres avisos de etapa (propuesta) y el runtime los lee como textos del negocio", () => {
    const parseada = parseAgentConfig(filaAgente(A.tenantId, PN_A), { tenantId: A.tenantId, phoneNumberId: PN_A });
    assert.equal(parseada.kind, "ok", JSON.stringify(parseada));
    const leida = parseada.kind === "ok" ? leerConfigAceptacion(parseada.config) : null;
    assert.deepEqual(leida?.textosEtapa, { en_preparacion: TEXTOS_ASLC.avisoEnPreparacion, enviado: TEXTOS_ASLC.avisoEnviado, entregado: TEXTOS_ASLC.avisoEntregado });
    assert.deepEqual(leida?.textosDecision, { aceptado: TEXTOS_ASLC.avisoAceptado, rechazado: TEXTOS_ASLC.avisoRechazado, cancelado: TEXTOS_ASLC.avisoCancelado }, "los mensajes de decisión no cambiaron");
  });

  it("la fila de producción de ANTES (sin avisos de etapa) sigue 'ok' y sus textos de etapa son null: no se envía nada hasta correr el 14", () => {
    const parseada = parseAgentConfig(filaAgente(A.tenantId, PN_A, opcionesAntesDeLaEtapa()), { tenantId: A.tenantId, phoneNumberId: PN_A });
    assert.equal(parseada.kind, "ok", JSON.stringify(parseada));
    const leida = parseada.kind === "ok" ? leerConfigAceptacion(parseada.config) : null;
    assert.deepEqual(leida?.textosEtapa, { en_preparacion: null, enviado: null, entregado: null });
    assert.ok(leida?.textosDecision?.aceptado, "los mensajes de decisión ya cargados siguen");
  });

  it("cada texto propuesto se completa con el número de pedido, solo admite {pedido} y no promete nada ni trae nombres, cifras ni palabras de otro negocio", () => {
    const AJENO = /joya|joyer[ií]a|\baretes?\b|\bcollar(es)?\b|\banillos?\b|\bdijes?\b|\bpulseras?\b|delacour|💍|💖|pago en tienda|recoger en tienda|nequi|daviplata|transferencia/i;
    for (const [clave, texto] of [["en_preparacion", TEXTOS_ASLC.avisoEnPreparacion], ["enviado", TEXTOS_ASLC.avisoEnviado], ["entregado", TEXTOS_ASLC.avisoEntregado]] as const) {
      const r = renderizarTextoEtapa(texto, { pedido: pedidoPublico });
      assert.ok(r.ok, clave);
      if (r.ok) assert.ok(r.texto.includes(pedidoPublico) && !/[{}]/.test(r.texto), clave);
      assert.ok(texto.length <= 500 && texto === texto.trim(), clave);
      assert.doesNotMatch(texto, AJENO, clave + ": nada de otro negocio");
      assert.doesNotMatch(texto, /Patricia|asesora/i, clave + ": ningún nombre de persona");
      assert.doesNotMatch(texto, /\d{4,}/, clave + ": sin cifras");
      assert.doesNotMatch(texto, /\b(hoy|ma[ñn]ana|pronto|despach|garantiz|reposici|alternativa|te avisaremos|te escribiremos|gu[ií]a|rastre)/i, clave + ": sin promesas de fechas, guías, despacho ni de volver a avisar");
    }
    assert.match(TEXTOS_ASLC.avisoEnviado, /contraentrega/);
  });
});

// ===========================================================================
// 3. Qué texto lleva cada aviso (el resolutor puro)
// ===========================================================================

describe("3B.9F · el resolutor decide el texto: del negocio, de la plataforma o ninguno", () => {
  const lector = crearLectorConfigAceptacion(createMemoryAgentConfigStore([filaAgente(A.tenantId, PN_A)]));
  const montar = (modulos: { plataforma: boolean; negocio: boolean }, config: (t: string, pn: string) => Promise<ConfigAceptacion | null> = lector) => {
    const consultas: string[] = [];
    const resolutor = crearTextoDeEtapa({
      modulos: async () => modulos,
      config: async (t, pn) => {
        consultas.push(`${t}|${pn}`);
        return config(t, pn);
      },
      log: () => {},
    });
    return { resolutor, consultas };
  };
  const pedir = (resolutor: ReturnType<typeof montar>["resolutor"], tipo: TipoNotificacion, pedido: Order = pedidoSimple(A.tenantId)) => resolutor({ tenantId: A.tenantId, tipo, pedido });

  it("avisos_etapa_pedidos: en cada etapa sale SU texto con el número de pedido; leyó la configuración del negocio y del número del pedido", async () => {
    const { resolutor, consultas } = montar({ plataforma: false, negocio: true });
    for (const [tipo, texto] of [["en_preparacion", TEXTOS_ASLC.avisoEnPreparacion], ["enviado", TEXTOS_ASLC.avisoEnviado], ["entregado", TEXTOS_ASLC.avisoEntregado]] as const) {
      assert.deepEqual(await pedir(resolutor, tipo), { origen: "negocio", texto: texto.replace("{pedido}", pedidoPublico) }, tipo);
    }
    assert.deepEqual([...new Set(consultas)], [`${A.tenantId}|${PN_A}`]);
  });

  it("las etapas sin texto del negocio (pago recibido, completado, cancelado, rechazado, aceptado) NO pasan por aquí: ninguno, y ni siquiera se lee la configuración", async () => {
    const { resolutor, consultas } = montar({ plataforma: false, negocio: true });
    for (const tipo of ["pago_recibido", "completado", "cancelado", "rechazado", "aceptado"] as const) assert.deepEqual(await pedir(resolutor, tipo), { origen: "ninguno" }, tipo);
    assert.deepEqual(consultas, []);
  });

  it("negocio con el módulo pero SIN texto para esa etapa (o sin configuración utilizable): ninguno; con notificaciones_pedidos también encendido, la plantilla de la plataforma", async () => {
    const sinPreparacion = async () => ({ ...((await lector(A.tenantId, PN_A)) as ConfigAceptacion), textosEtapa: { en_preparacion: null, enviado: "Enviado {pedido}", entregado: null } });
    const solo = montar({ plataforma: false, negocio: true }, sinPreparacion);
    assert.deepEqual(await pedir(solo.resolutor, "en_preparacion"), { origen: "ninguno" });
    assert.deepEqual(await pedir(solo.resolutor, "enviado"), { origen: "negocio", texto: `Enviado ${pedidoPublico}` });
    const sinConfig = montar({ plataforma: false, negocio: true }, async () => null);
    assert.deepEqual(await pedir(sinConfig.resolutor, "enviado"), { origen: "ninguno" }, "agente apagado o configuración inválida: no se envía nada");
    const sinCampo = montar({ plataforma: false, negocio: true }, async () => ({ ...((await lector(A.tenantId, PN_A)) as ConfigAceptacion), textosEtapa: undefined }));
    assert.deepEqual(await pedir(sinCampo.resolutor, "enviado"), { origen: "ninguno" }, "configuración antigua sin la sección: tampoco");
    const ambos = montar({ plataforma: true, negocio: true }, sinPreparacion);
    assert.deepEqual(await pedir(ambos.resolutor, "en_preparacion"), { origen: "plataforma" });
    assert.deepEqual(await pedir(ambos.resolutor, "enviado"), { origen: "negocio", texto: `Enviado ${pedidoPublico}` });
    assert.deepEqual(await pedir(ambos.resolutor, "pago_recibido"), { origen: "plataforma" }, "con la plataforma encendida, las demás etapas siguen como siempre");
  });

  it("Delacour (solo notificaciones_pedidos): plantilla de la plataforma y NINGUNA lectura de configuración (su camino no cambió); sin ningún módulo: ninguno", async () => {
    const delacour = montar({ plataforma: true, negocio: false });
    for (const tipo of ["pago_recibido", "en_preparacion", "enviado", "entregado", "completado", "cancelado", "rechazado"] as const) assert.deepEqual(await pedir(delacour.resolutor, tipo), { origen: "plataforma" }, tipo);
    assert.deepEqual(delacour.consultas, [], "no lee la configuración del agente");
    const ninguno = montar({ plataforma: false, negocio: false });
    assert.deepEqual(await pedir(ninguno.resolutor, "enviado"), { origen: "ninguno" });
    assert.deepEqual(ninguno.consultas, []);
  });

  it("un pedido de OTRO negocio o sin contacto no usa ninguna configuración (ninguno); una plantilla inválida (que el esquema ya impide) nunca se envía", async () => {
    const m = montar({ plataforma: false, negocio: true });
    assert.deepEqual(await pedir(m.resolutor, "enviado", pedidoSimple(B.tenantId)), { origen: "ninguno" });
    assert.deepEqual(await pedir(m.resolutor, "enviado", pedidoSimple(A.tenantId, { contact: null } as Partial<Order>)), { origen: "ninguno" });
    assert.deepEqual(m.consultas, []);
    const mala = montar({ plataforma: false, negocio: true }, async () => ({ ...((await lector(A.tenantId, PN_A)) as ConfigAceptacion), textosEtapa: { en_preparacion: "Con {motivo} {pedido}", enviado: null, entregado: null } }));
    assert.deepEqual(await pedir(mala.resolutor, "en_preparacion"), { origen: "ninguno" });
    const malaConPlataforma = montar({ plataforma: true, negocio: true }, async () => ({ ...((await lector(A.tenantId, PN_A)) as ConfigAceptacion), textosEtapa: { en_preparacion: "Con {motivo} {pedido}", enviado: null, entregado: null } }));
    assert.deepEqual(await pedir(malaConPlataforma.resolutor, "en_preparacion"), { origen: "plataforma" });
  });

  it("si la lectura de la configuración falla, el error se propaga (nunca se envía algo que no se pudo decidir)", async () => {
    const m = montar({ plataforma: false, negocio: true }, async () => {
      throw new Error("la base no responde");
    });
    await assert.rejects(() => pedir(m.resolutor, "enviado"), /la base no responde/);
  });

  it("el registro del resolutor no lleva datos del cliente (ni teléfono ni nombre)", async () => {
    const lineas: string[] = [];
    const r = crearTextoDeEtapa({ modulos: async () => ({ plataforma: false, negocio: true }), config: async () => null, log: (e) => lineas.push(JSON.stringify(e)) });
    await r({ tenantId: A.tenantId, tipo: "enviado", pedido: pedidoSimple(A.tenantId) });
    assert.equal(lineas.length, 1);
    assert.doesNotMatch(lineas[0], /5730011|Ana|Pérez|waId|phone/i);
    assert.match(lineas[0], /sin_configuracion/);
  });
});

// ===========================================================================
// 4. De punta a punta: el panel marca la etapa y el cliente recibe SU texto
// ===========================================================================

type Resp = { status: number; body: { success: boolean; data: { repetido?: boolean; notificacion?: ResultadoNotificacion | null }; error?: { code: string; message: string } } };

describe("3B.9F · de punta a punta con el motor en memoria: el equipo marca la etapa y el cliente recibe el texto del negocio", () => {
  let mem: ReturnType<typeof createInMemoryCatalogRepository>;
  let admin: ReturnType<typeof createCatalogService>;
  let orders: ReturnType<typeof createMemoryOrdersRepository>;
  let engine: OrderEngine;
  let clock: number;
  let seq: number;
  let notif: ReturnType<typeof createMemoryNotificacionesStore>;
  let envios: Array<{ phoneNumberId: string; telefono: string; texto: string }>;
  let registrados: string[];
  let fallo: ErrorEnvioWhatsapp | null;
  let modulos: Map<string, { plataforma: boolean; negocio: boolean }>;
  let consultasConfig: string[];
  let falloConfig: boolean;
  let opciones: Record<string, unknown>;
  let deps: NotificadorDeps;

  const enviador = (): EnviadorWhatsapp => ({
    async enviar(canal, telefono, texto) {
      if (fallo) {
        const e = fallo;
        fallo = null;
        throw e;
      }
      envios.push({ phoneNumberId: canal.phoneNumberId, telefono, texto });
      return { messageId: `wamid.etapa.${envios.length}` };
    },
    async registrar(_c, _t, texto) {
      registrados.push(texto);
    },
  });

  /** El notificador del panel con la MISMA lógica de producción: cualquiera de los dos módulos lo enciende y el resolutor decide el texto. */
  function montarDeps(): NotificadorDeps {
    const lector = crearLectorConfigAceptacion(createMemoryAgentConfigStore([filaAgente(A.tenantId, PN_A, opciones)]));
    return {
      store: {
        ...notif.store,
        habilitado: async (t) => {
          const m = modulos.get(t);
          return !!m && (m.plataforma || m.negocio);
        },
      },
      enviador: enviador(),
      now: () => clock,
      log: () => {},
      textoDeEtapa: crearTextoDeEtapa({
        modulos: async (t) => modulos.get(t) ?? { plataforma: false, negocio: false },
        config: async (t, pn) => {
          consultasConfig.push(`${t}|${pn}`);
          if (falloConfig) throw new Error("la base no responde");
          return lector(t, pn);
        },
        log: () => {},
      }),
    };
  }

  beforeEach(() => {
    mem = createInMemoryCatalogRepository();
    admin = createCatalogService({ repo: mem.repo });
    clock = Date.parse("2026-10-05T15:00:00Z");
    orders = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => clock });
    engine = createOrderEngine({ orders, catalog: mem.repo, key: Buffer.alloc(32, 5), log: () => {}, now: () => new Date(clock), handoff: { pauseConversation: async () => ({ ok: true }) } });
    for (const actor of [A, B]) mem.enableModule(actor.tenantId);
    seq = 0;
    envios = [];
    registrados = [];
    fallo = null;
    falloConfig = false;
    consultasConfig = [];
    modulos = new Map([
      [A.tenantId, { plataforma: false, negocio: true }],
      [B.tenantId, { plataforma: true, negocio: false }],
    ]);
    opciones = JSON.parse(JSON.stringify(configuracionCompletaAslc({ aviso: TEXTOS.aviso, trasAvisoConfirma: TEXTOS.tras_aviso_confirma, miembroId: RESPONSABLE })));
    notif = createMemoryNotificacionesStore({
      habilitados: [A.tenantId, B.tenantId],
      now: () => clock,
      canales: {
        [PN_A]: { tenantId: A.tenantId, phoneNumberId: PN_A, token: "tok-a", nombreNegocio: "Tienda A" },
        [PN_B]: { tenantId: B.tenantId, phoneNumberId: PN_B, token: "tok-b", nombreNegocio: "Tienda B" },
      },
    });
    for (const c of [ANA, LUIS]) notif.entrante(c.phoneNumberId, c.waId, new Date(clock - 3_600_000).toISOString()); // el cliente escribió hace 1 h: ventana abierta
    deps = montarDeps();
  });

  async function confirmado(opts: { contact?: typeof ANA; tenant?: CatalogActor } = {}) {
    const actor = opts.tenant ?? A;
    const p = await admin.createProduct(actor, { name: `Tablet ${++seq}`, retailPrice: 250_000, wholesalePrice: 200_000, stock: 5 });
    const contact = opts.contact ?? (actor === A ? ANA : LUIS);
    const { order } = await engine.createOrder({ tenantId: actor.tenantId, channel: "retail", source: "agent", contact, items: [{ reference: p.reference, quantity: 1 }], idempotencyKey: `agent:b39f-${seq}` });
    return engine.confirmOrder({ tenantId: actor.tenantId, contact, orderId: order.orderId, confirmationId: order.confirmation!.id, actor: "agent", checkout: DOMICILIO });
  }
  async function visto(pedido: string, tenant = A.tenantId) {
    const o = (await orders.getByOrderId(tenant, pedido))!;
    return { estado: o.status, etapa: o.checkout?.stage ?? null, pago: o.checkout?.paymentStatus ?? null };
  }
  async function actuar(pedido: string, accion: string, opts: { motivo?: string; tenant?: string; d?: NotificadorDeps } = {}): Promise<Resp> {
    const tenant = opts.tenant ?? A.tenantId;
    const res = await accionGestion(engine, tenant, pedido, { accion, esperado: await visto(pedido, tenant), ...(opts.motivo ? { motivo: opts.motivo } : {}) }, ASESORA, opts.d ?? deps);
    return { status: res.status, body: await res.json() };
  }
  async function reintentar(pedido: string, tipo: string, tenant = A.tenantId, d: NotificadorDeps = deps): Promise<Resp> {
    const res = await reintentarNotificacionGestion(engine, tenant, pedido, { tipo }, d);
    return { status: res.status, body: await res.json() };
  }
  const etapaDe = async (pedido: string) => ((await orders.getByOrderId(A.tenantId, pedido))!.checkout?.stage ?? null) as string | null;
  const texto = (plantilla: string, pedido: string) => plantilla.replace("{pedido}", pedido);

  it("REPRODUCE EL REPORTE: «en preparación» y luego «enviado» con la ventana abierta => el cliente recibe, por el número del negocio, SU texto con el número de pedido", async () => {
    const o = await confirmado();
    const prep = await actuar(o.orderId, "en_preparacion");
    assert.equal(prep.status, 200);
    assert.deepEqual(prep.body.data.notificacion, { estado: "enviada", tipo: "en_preparacion", motivo: null, repetida: false });
    const env = await actuar(o.orderId, "enviado");
    assert.deepEqual(env.body.data.notificacion, { estado: "enviada", tipo: "enviado", motivo: null, repetida: false });
    assert.equal(await etapaDe(o.orderId), "enviado", "el cambio de estado quedó aplicado");
    assert.deepEqual(
      envios.map((e) => ({ numero: e.phoneNumberId, para: e.telefono, texto: e.texto })),
      [
        { numero: PN_A, para: ANA.waId, texto: texto(TEXTOS_ASLC.avisoEnPreparacion, o.orderId) },
        { numero: PN_A, para: ANA.waId, texto: texto(TEXTOS_ASLC.avisoEnviado, o.orderId) },
      ],
    );
    for (const e of envios) assert.doesNotMatch(e.texto, /💖|Hola, Ana/, "ni el tono ni los emojis de las plantillas de la plataforma");
    assert.deepEqual(registrados, envios.map((e) => e.texto), "quedan en el Inbox como mensajes del negocio");
    assert.deepEqual(notif.filas.map((f) => [f.tipo, f.estado, f.intentos]), [["en_preparacion", "enviada", 1], ["enviado", "enviada", 1]]);
  });

  it("entregado también avisa; cada etapa sale UNA sola vez (repetir la acción o dos clics a la vez no mandan otro)", async () => {
    const o = await confirmado();
    await actuar(o.orderId, "en_preparacion");
    await actuar(o.orderId, "enviado");
    const esperado = await visto(o.orderId);
    const [r1, r2] = await Promise.all([1, 2].map(async () => (await accionGestion(engine, A.tenantId, o.orderId, { accion: "entregado", esperado }, ASESORA, deps)).json() as Promise<Resp["body"]>));
    assert.ok(r1.success || r2.success);
    const repetida = await actuar(o.orderId, "entregado");
    assert.equal(repetida.body.data.repetido, true);
    assert.equal((repetida.body.data.notificacion as { repetida: boolean }).repetida, true);
    assert.deepEqual(envios.map((e) => e.texto), [texto(TEXTOS_ASLC.avisoEnPreparacion, o.orderId), texto(TEXTOS_ASLC.avisoEnviado, o.orderId), texto(TEXTOS_ASLC.avisoEntregado, o.orderId)]);
    assert.equal(notif.filas.length, 3, "una fila por (pedido, etapa)");
  });

  it("pago recibido y cancelar (etapas sin texto del negocio): el estado cambia y NO se crea ni se envía nada; tampoco se lee la configuración", async () => {
    const o = await confirmado();
    const pago = await actuar(o.orderId, "pago_recibido");
    assert.equal(pago.status, 200);
    assert.deepEqual(pago.body.data.notificacion, { estado: "desactivada" });
    const o2 = await confirmado();
    const cancelar = await actuar(o2.orderId, "cancelar", { motivo: "El cliente ya no lo necesita" });
    assert.equal(cancelar.status, 200);
    assert.deepEqual(cancelar.body.data.notificacion, { estado: "desactivada" });
    assert.equal((await orders.getByOrderId(A.tenantId, o2.orderId))!.status, "cancelled");
    assert.equal(envios.length, 0);
    assert.equal(notif.filas.length, 0);
    assert.deepEqual(consultasConfig, []);
  });

  it("una etapa sin texto configurado no envía nada (el negocio decide cuáles avisa); las demás sí", async () => {
    delete ((opciones.cierre as { textos: Record<string, unknown> }).textos as Record<string, unknown>).en_preparacion;
    deps = montarDeps();
    const o = await confirmado();
    const prep = await actuar(o.orderId, "en_preparacion");
    assert.deepEqual(prep.body.data.notificacion, { estado: "desactivada" });
    const env = await actuar(o.orderId, "enviado");
    assert.equal((env.body.data.notificacion as { estado: string }).estado, "enviada");
    assert.deepEqual(envios.map((e) => e.texto), [texto(TEXTOS_ASLC.avisoEnviado, o.orderId)]);
    assert.deepEqual(notif.filas.map((f) => f.tipo), ["enviado"], "sin fila de la etapa que no se avisa");
  });

  it("con la configuración de producción de ANTES (sin avisos de etapa) no se envía nada: el código se puede desplegar antes de correr el 14", async () => {
    opciones = opcionesAntesDeLaEtapa();
    deps = montarDeps();
    const o = await confirmado();
    for (const accion of ["en_preparacion", "enviado", "entregado"]) assert.deepEqual((await actuar(o.orderId, accion)).body.data.notificacion, { estado: "desactivada" }, accion);
    assert.equal(envios.length, 0);
    assert.equal(notif.filas.length, 0);
  });

  it("ventana de 24 h vencida: no se llama a Meta y queda 'ventana_vencida'; cuando el cliente vuelve a escribir, Reintentar manda el texto del NEGOCIO (no la plantilla de la plataforma)", async () => {
    notif.entrante(ANA.phoneNumberId, ANA.waId, new Date(clock - 26 * 3_600_000).toISOString());
    const o = await confirmado();
    const prep = await actuar(o.orderId, "en_preparacion");
    assert.deepEqual(prep.body.data.notificacion, { estado: "ventana_vencida", tipo: "en_preparacion", motivo: "ventana_vencida", repetida: false });
    assert.equal(envios.length, 0);
    assert.equal(await etapaDe(o.orderId), "en_preparacion", "el cambio de estado sí quedó aplicado");
    notif.entrante(ANA.phoneNumberId, ANA.waId, new Date(clock - 60_000).toISOString());
    const r = await reintentar(o.orderId, "en_preparacion");
    assert.equal(r.status, 200);
    assert.equal((r.body.data.notificacion as { estado: string }).estado, "enviada");
    assert.deepEqual(envios.map((e) => e.texto), [texto(TEXTOS_ASLC.avisoEnPreparacion, o.orderId)]);
    assert.doesNotMatch(envios[0].texto, /💖/);
    assert.equal((await reintentar(o.orderId, "en_preparacion")).status, 409, "ya enviada: no se reenvía");
    assert.equal(envios.length, 1);
  });

  it("Meta falla => el pedido NO se revierte, la notificación queda 'fallida' y el reintento manda el texto del negocio una sola vez", async () => {
    const o = await confirmado();
    await actuar(o.orderId, "en_preparacion");
    fallo = new ErrorEnvioWhatsapp("131026", "Message undeliverable", false);
    const r = await actuar(o.orderId, "enviado");
    assert.equal(r.status, 200);
    assert.equal((r.body.data.notificacion as { estado: string }).estado, "fallida");
    assert.equal(await etapaDe(o.orderId), "enviado");
    assert.equal(envios.length, 1, "solo salió el de «en preparación»");
    const otra = await reintentar(o.orderId, "enviado");
    assert.equal((otra.body.data.notificacion as { estado: string }).estado, "enviada");
    assert.deepEqual(envios.map((e) => e.texto), [texto(TEXTOS_ASLC.avisoEnPreparacion, o.orderId), texto(TEXTOS_ASLC.avisoEnviado, o.orderId)]);
    assert.equal(notif.filas.find((f) => f.tipo === "enviado")?.intentos, 2);
  });

  it("si no se puede leer la configuración: el estado cambia igual (200), no se crea fila ni se envía nada, y el panel dice 'no disponible'; el reintento tampoco deja la fila atascada", async () => {
    const o = await confirmado();
    falloConfig = true;
    const prep = await actuar(o.orderId, "en_preparacion");
    assert.equal(prep.status, 200);
    assert.deepEqual(prep.body.data.notificacion, { estado: "no_disponible" });
    assert.equal(await etapaDe(o.orderId), "en_preparacion");
    assert.equal(envios.length, 0);
    assert.equal(notif.filas.length, 0);
    // Una fila ya existente en 'ventana_vencida' se queda así si el reintento no puede decidir el texto (no queda en 'enviando').
    falloConfig = false;
    notif.entrante(ANA.phoneNumberId, ANA.waId, new Date(clock - 26 * 3_600_000).toISOString());
    const env = await actuar(o.orderId, "enviado");
    assert.equal((env.body.data.notificacion as { estado: string }).estado, "ventana_vencida");
    notif.entrante(ANA.phoneNumberId, ANA.waId, new Date(clock - 60_000).toISOString());
    falloConfig = true;
    const reint = await reintentar(o.orderId, "enviado");
    assert.equal(reint.status, 409);
    assert.match(reint.body.error?.message ?? "", /configuración del negocio/);
    assert.equal(notif.filas.find((f) => f.tipo === "enviado")?.estado, "ventana_vencida", "la fila quedó como estaba");
    falloConfig = false;
    assert.equal(((await reintentar(o.orderId, "enviado")).body.data.notificacion as { estado: string }).estado, "enviada", "y se puede volver a intentar");
  });

  it("si el negocio quita el texto de esa etapa (o apaga el módulo) antes del reintento, no se reenvía nada", async () => {
    notif.entrante(ANA.phoneNumberId, ANA.waId, new Date(clock - 26 * 3_600_000).toISOString());
    const o = await confirmado();
    await actuar(o.orderId, "en_preparacion");
    notif.entrante(ANA.phoneNumberId, ANA.waId, new Date(clock - 60_000).toISOString());
    delete ((opciones.cierre as { textos: Record<string, unknown> }).textos as Record<string, unknown>).en_preparacion;
    const sinTexto = await reintentar(o.orderId, "en_preparacion", A.tenantId, montarDeps());
    assert.equal(sinTexto.status, 409);
    assert.match(sinTexto.body.error?.message ?? "", /ya no está activo/);
    modulos.set(A.tenantId, { plataforma: false, negocio: false });
    const apagado = await reintentar(o.orderId, "en_preparacion", A.tenantId, montarDeps());
    assert.deepEqual(apagado.body.data.notificacion, { estado: "desactivada" });
    assert.equal(envios.length, 0);
  });

  it("DELACOUR (notificaciones_pedidos): sigue EXACTAMENTE igual — plantilla de la plataforma, y no se lee ninguna configuración", async () => {
    const o = await confirmado({ tenant: B });
    const r = await actuar(o.orderId, "en_preparacion", { tenant: B.tenantId });
    assert.equal((r.body.data.notificacion as { estado: string }).estado, "enviada");
    assert.equal(envios[0].phoneNumberId, PN_B);
    assert.equal(envios[0].texto, mensajeNotificacion("en_preparacion", { nombre: "Ana Pérez", pedido: o.orderId, entrega: "domicilio", negocio: "Tienda B" }));
    assert.match(envios[0].texto, /💖/, "la plantilla de siempre");
    const pago = await actuar(o.orderId, "pago_recibido", { tenant: B.tenantId });
    assert.equal((pago.body.data.notificacion as { estado: string }).estado, "enviada");
    assert.deepEqual(consultasConfig, [], "ninguna lectura de la configuración del agente");
  });

  it("con AMBOS módulos: la etapa con texto del negocio sale con SU texto; las demás, con la plantilla de siempre", async () => {
    modulos.set(A.tenantId, { plataforma: true, negocio: true });
    const o = await confirmado();
    await actuar(o.orderId, "en_preparacion");
    await actuar(o.orderId, "pago_recibido");
    assert.equal(envios[0].texto, texto(TEXTOS_ASLC.avisoEnPreparacion, o.orderId));
    assert.match(envios[1].texto, /recibimos el pago/, "pago recibido: la plantilla de la plataforma");
  });

  it("sin ningún módulo: el estado cambia y no se crea ni envía nada", async () => {
    modulos.set(A.tenantId, { plataforma: false, negocio: false });
    const o = await confirmado();
    assert.deepEqual((await actuar(o.orderId, "en_preparacion")).body.data.notificacion, { estado: "desactivada" });
    assert.equal(envios.length + notif.filas.length, 0);
  });
});

// ===========================================================================
// 5. El cableado de producción (Supabase falso)
// ===========================================================================

interface FilaModulo {
  id_tenant: string;
  modulo: string;
  habilitado: boolean;
}

/** Un "Supabase" que responde SOLO dulabs_tenant_modulos y dulabs_agente_runtime_config (lo que usa el cableado de los avisos de etapa). */
function supabaseFalso(modulos: FilaModulo[], filasAgente: AgentConfigRow[], opts: { caido?: boolean } = {}) {
  const tablas: string[] = [];
  const client = {
    from(tabla: string) {
      tablas.push(tabla);
      const filtro: Record<string, string> = {};
      const q = {
        select: () => q,
        eq: (columna: string, valor: string) => {
          filtro[columna] = valor;
          return q;
        },
        maybeSingle: async () => {
          if (opts.caido) return { data: null, error: { message: "la base no responde" } };
          if (tabla === "dulabs_tenant_modulos") {
            const fila = modulos.find((f) => f.id_tenant === filtro.id_tenant && f.modulo === filtro.modulo);
            return { data: fila ? { habilitado: fila.habilitado } : null, error: null };
          }
          if (tabla === "dulabs_agente_runtime_config") return { data: filasAgente.find((f) => f.phone_number_id === filtro.phone_number_id) ?? null, error: null };
          throw new Error(`tabla inesperada: ${tabla}`);
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, tablas };
}

describe("3B.9F · el cableado de producción: módulos, configuración y rutas del panel", () => {
  const activo = (tenant: string, modulo: string, habilitado = true): FilaModulo => ({ id_tenant: tenant, modulo, habilitado });
  const fila = filaAgente(A.tenantId, PN_A);
  const texto = (plantilla: string) => plantilla.replace("{pedido}", pedidoPublico);

  it("productionTextoDeEtapa: con avisos_etapa_pedidos y la fila del negocio, devuelve su texto; con notificaciones_pedidos solo, la plantilla y NO lee la configuración; sin módulos, ninguno", async () => {
    const solo = supabaseFalso([activo(A.tenantId, "avisos_etapa_pedidos")], [fila]);
    assert.deepEqual(await productionTextoDeEtapa(solo.client)({ tenantId: A.tenantId, tipo: "enviado", pedido: pedidoSimple(A.tenantId) }), { origen: "negocio", texto: texto(TEXTOS_ASLC.avisoEnviado) });
    const delacour = supabaseFalso([activo(B.tenantId, "notificaciones_pedidos")], [fila]);
    assert.deepEqual(await productionTextoDeEtapa(delacour.client)({ tenantId: B.tenantId, tipo: "enviado", pedido: pedidoSimple(B.tenantId) }), { origen: "plataforma" });
    assert.ok(!delacour.tablas.includes("dulabs_agente_runtime_config"), "Delacour: ninguna lectura de la fila del agente");
    const nada = supabaseFalso([activo(A.tenantId, "avisos_etapa_pedidos", false)], [fila]);
    assert.deepEqual(await productionTextoDeEtapa(nada.client)({ tenantId: A.tenantId, tipo: "enviado", pedido: pedidoSimple(A.tenantId) }), { origen: "ninguno" });
  });

  it("si la base no responde: los módulos cuentan como apagados (ninguno) y nunca se envía por no poder verificar", async () => {
    const caido = supabaseFalso([activo(A.tenantId, "avisos_etapa_pedidos")], [fila], { caido: true });
    assert.deepEqual(await productionTextoDeEtapa(caido.client)({ tenantId: A.tenantId, tipo: "enviado", pedido: pedidoSimple(A.tenantId) }), { origen: "ninguno" });
    assert.equal(await productionNotificadorDelPanel(caido.client).store.habilitado(A.tenantId), false);
  });

  it("el notificador del panel se enciende con cualquiera de los dos módulos (y con ninguno, no) y trae el resolutor; el de siempre y el de las decisiones NO cambian", async () => {
    const { client } = supabaseFalso([activo(A.tenantId, "avisos_etapa_pedidos"), activo(B.tenantId, "notificaciones_pedidos"), activo("cccccccc-0000-4000-8000-00000000000c", "avisos_decision_pedidos")], [fila]);
    const panel = productionNotificadorDelPanel(client);
    assert.equal(await panel.store.habilitado(A.tenantId), true);
    assert.equal(await panel.store.habilitado(B.tenantId), true);
    assert.equal(await panel.store.habilitado("cccccccc-0000-4000-8000-00000000000c"), false, "el módulo de decisiones no enciende los avisos de etapa");
    assert.equal(typeof panel.textoDeEtapa, "function");
    // Lo de siempre: solo notificaciones_pedidos y sin resolutor.
    const clasico = productionNotificador(client);
    assert.equal(await clasico.store.habilitado(A.tenantId), false, "avisos_etapa_pedidos NO enciende el notificador de siempre");
    assert.equal(await clasico.store.habilitado(B.tenantId), true);
    assert.equal(clasico.textoDeEtapa, undefined);
    // Mensajes de decisión: sin resolutor (traen su propio texto).
    const decision = productionNotificador(client, { modulos: MODULOS_AVISOS_DE_DECISION });
    assert.equal(decision.textoDeEtapa, undefined);
    assert.equal(await decision.store.habilitado(A.tenantId), false, "avisos_etapa_pedidos no enciende los mensajes de decisión");
  });

  it("las rutas del panel usan el notificador de etapas; el gancho de decisiones sigue con el suyo; el notificador y el resolutor puro no importan nada de la IA ni del agente", () => {
    for (const ruta of ["app/api/dashboard/pedidos/[pedido]/route.ts", "app/api/dashboard/pedidos/[pedido]/notificaciones/route.ts"]) {
      const fuente = leer(ruta);
      assert.match(fuente, /productionNotificadorDelPanel\(supabase\)/, ruta);
      assert.doesNotMatch(fuente, /productionNotificador\(supabase\)/, ruta + ": ya no el de siempre");
      assert.doesNotMatch(fuente, /MODULOS_AVISOS_DE_DECISION|avisos_decision_pedidos/, ruta + ": las etapas no usan el módulo de decisiones");
    }
    assert.match(leer("lib/catalogo/pedidos/mensajes-decision.ts"), /productionNotificador\(input\.supabase, \{ modulos: MODULOS_AVISOS_DE_DECISION \}\)/);
    for (const ruta of ["lib/catalogo/pedidos/notificaciones.ts", "lib/catalogo/pedidos/notificaciones-produccion.ts"]) {
      const imports = leer(ruta).split("\n").filter((l) => /^import |^\s+from "/.test(l)).join("\n");
      assert.doesNotMatch(imports, /@\/lib\/agente|ia-proveedores|gemini/i, ruta);
    }
  });

  it("el código de los avisos de etapa no trae ningún texto al cliente ni ningún nombre de persona (todo sale de la configuración del negocio)", () => {
    for (const ruta of ["lib/agente/textos-etapa.ts", "lib/catalogo/pedidos/avisos-etapa.ts", "lib/catalogo/pedidos/avisos-etapa-produccion.ts"]) {
      const sinComentarios = leer(ruta)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      // «enviado» es el nombre de una etapa (identificador), no un texto comercial.
      assert.doesNotMatch(sinComentarios, /Perfecto|fue aceptado|aceptamos|despach|gracias|llega|Hola|Patricia/i, `${ruta} trae un texto comercial`);
    }
  });
});
