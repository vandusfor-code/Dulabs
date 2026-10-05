/**
 * FASE 3B.9A — APROVISIONAMIENTO DE AQUÍ SÍ LO COMPRAS SIN ACTIVARLO. TODO en memoria (runtime y frontera REALES; nada toca Supabase, Gemini ni Meta).
 *
 *   1. Datos aprobados y pendientes: solo lo que el negocio entregó; lo demás queda PENDIENTE (nunca se inventa); el aviso, intacto.
 *   2. La fila base: DESHABILITADA, con candado de activación, sin checkout ni audio, credencial propia, solo contra entrega.
 *   3. SQL de aprovisionamiento: es exactamente lo generado; solo escribe lo previsto; la verificación es solo lectura.
 *   4. Aislamiento: ASLC no hereda nada de Delacour (prompt, saludo, textos, métodos de pago, productos, pedidos, credenciales).
 *   5. FAIL-CLOSED: ningún fallo de ASLC lo manda a un camino legacy; el webhook entrega TODO mensaje al agente antes que a Flow / Business Agent / legacy.
 *   6. Pruebas ANTES del catálogo real (12 casos): ante lo que no se sabe, el sistema falla de forma segura.
 *   7. El catálogo reutilizable soporta lo que ASLC necesita (y el cliente lo actualiza sin desarrollo nuevo).
 *
 * Los valores marcados "DE PRUEBA" (responsable, textos, cobertura) son ficticios y NUNCA se usan fuera de estas pruebas.
 */
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 14).toString("base64");

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { createCatalogService, type CatalogActor } from "@/lib/catalogo/service";
import { createInMemoryCatalogRepository } from "@/lib/catalogo/testing/in-memory-repository";
import { createOrderEngine } from "@/lib/catalogo/pedidos/motor";
import { createMemoryOrdersRepository } from "@/lib/catalogo/pedidos/repositorio";
import { memoryOrderEventSink } from "@/lib/catalogo/pedidos/eventos";
import { createSimulatedProvider, type SimulatedStep } from "@/lib/ia-proveedores/simulado";
import { createMemoryAgentConfigStore, parseAgentConfig, type AgentConfigRow, type AgentConfigStore, type AgentRuntimeConfig } from "@/lib/agente/config";
import { createMemoryConversationStateStore, type ConversationStateStore } from "@/lib/agente/estado";
import { AGENT_TOOL_NAMES } from "@/lib/agente/nombres-herramientas";
import type { AgentToolsDeps } from "@/lib/agente/herramientas";
import { FALLBACK_MESSAGES, runAgentTurn } from "@/lib/agente/runtime";
import { createMemoryCustomerChannelStore } from "@/lib/agente/clasificacion";
import { createMemoryProductMediaLedger } from "@/lib/agente/medios";
import type { HistoryRow } from "@/lib/agente/contexto";
import { PLATFORM_RULES, platformRulesFor } from "@/lib/agente/contexto";
import { DEFAULT_WELCOME, CHANNEL_QUESTION } from "@/lib/agente/clasificacion";
import { CHECKOUT_OPCIONES_LEGADO, FUNCIONES_3B_IMPLEMENTADAS, FUNCIONES_FASE_3B, VOCABULARIO_LEGADO, VOCABULARIO_NEUTRAL, esVocabularioNeutral, type FuncionFase3B } from "@/lib/agente/perfil-negocio";
import { atenderConAgenteSiAplica, type AgentBoundaryDeps, type AgentBoundaryInput } from "@/lib/agente/webhook";
import { NON_TEXT_MESSAGES } from "@/lib/agente/entrada";
import { validateAIProviderConfig } from "@/lib/ia-proveedores/registro";
import {
  CREDENCIAL_GEMINI_ASLC,
  DATOS_APROBADOS_ASLC,
  HERRAMIENTAS_ASLC,
  IDENTIDAD_ASLC_PRODUCCION,
  evaluarConfigCompleta,
  filaBaseAslc,
  generarSqlAprovisionamiento,
  opcionesBaseAslc,
  pendientesActualesAslc,
} from "@/lib/agente/aprovisionamiento";

const AVISO_SHA256 = "c0bf58e071859d51d86f2de4f703faa8f95ea866e644386d40eb9d6d1a75179a";
const sha256 = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
const TODAS: Record<FuncionFase3B, boolean> = Object.fromEntries(FUNCIONES_FASE_3B.map((f) => [f, true])) as Record<FuncionFase3B, boolean>;

/** Palabras de OTRO negocio (Delacour Joyería) y medios de pago que ASLC no ofrece: nunca deben aparecer en lo que ASLC ve o dice. */
const AJENO = /joya|joyer[ií]a|\baretes?\b|\bcollar(es)?\b|\banillos?\b|\bdijes?\b|\bpulseras?\b|delacour|💍|pago en tienda|recoger en tienda|transferencia|nequi|daviplata/i;

// ===========================================================================
// 1. Datos aprobados y pendientes
// ===========================================================================

describe("3B.9A · solo lo aprobado: lo demás queda PENDIENTE y nunca se inventa", () => {
  it("los datos aprobados son EXACTAMENTE los que entregó el negocio (pago, envío, transportadora, tiempos, Bogotá, sin certeza = persona)", () => {
    assert.deepEqual(
      { ...DATOS_APROBADOS_ASLC, diasHabiles: { ...DATOS_APROBADOS_ASLC.diasHabiles }, corteBogota: { ...DATOS_APROBADOS_ASLC.corteBogota }, pagos: [...DATOS_APROBADOS_ASLC.pagos] },
      {
        nombreNegocio: "Aquí Sí Lo Compras",
        whatsappTerminaEn: "5088",
        pagos: ["contra_entrega"],
        envioGratis: true,
        transportadoraHabitual: "Interrapidísimo",
        diasHabiles: { min: 2, max: 3 },
        corteBogota: { hora_limite: "11:30", zona_horaria: "America/Bogota" },
        sinCerteza: "handoff",
      },
    );
    assert.ok(Object.isFrozen(DATOS_APROBADOS_ASLC));
  });

  it("lo que FALTA queda marcado: responsable real (Patricia), textos, cobertura y las decisiones del negocio; nada se rellena", () => {
    const p = pendientesActualesAslc();
    const campos = p.map((x) => x.campo);
    assert.ok(p.some((x) => x.categoria === "PATRICIA_REAL_PENDIENTE" && x.campo === "cierre.responsable"), "responsable real pendiente");
    assert.ok(p.some((x) => x.categoria === "TEXTO_PENDIENTE" && x.campo === "cierre.textos"), "textos del cierre pendientes");
    assert.ok(p.some((x) => x.categoria === "COBERTURA_PENDIENTE" && x.campo === "envios.cobertura"), "no hay fuente real de cobertura");
    assert.ok(p.some((x) => x.categoria === "TEXTO_PENDIENTE" && x.campo === "envios.tiempos"), "los textos de tiempos de entrega no están aprobados");
    for (const bloque of ["campos", "oficina", "cierre"]) assert.ok(p.some((x) => x.categoria === "BLOQUE_PENDIENTE" && x.campo === bloque), bloque);
    for (const campo of ["cierre.aceptan", "cierre.reserva", "cierre.vencimiento", "cierre.reserva_tras_aceptar", "oficina.documento"]) assert.ok(campos.includes(campo), campo);
    // Lo aprobado NO aparece como pendiente.
    for (const aprobado of ["pagos", "entregas", "envios.envio_gratis", "envios.transportadora_habitual", "envios.sin_certeza"]) assert.ok(!campos.includes(aprobado), aprobado);
  });

  it("una configuración con TODO (valores de prueba) sí queda lista; sin responsable, sin textos o con el candado de activación, no", () => {
    const completa = {
      entregas: ["domicilio"],
      pagos: [{ metodo: "contra_entrega" }],
      campos: { nombre_completo: true, telefono: { modo: "requerido", acepta_mismo_whatsapp: true }, departamento: true, barrio: true },
      cierre: {
        modo: "aceptacion_humana",
        validacion_resumen: "boton_datos_correctos",
        mostrar_numero_pedido: false,
        textos: { aviso: "AVISO DE PRUEBA", tras_aviso_confirma: "RESPUESTA DE PRUEBA" },
        responsable: { miembro_id: 41, respaldo_miembro_id: null, canales: ["panel"] },
        aceptan: "solo_responsable",
        reserva: { tipo: "sin_reserva" },
        vencimiento: { tipo: "sin_vencimiento" },
        reserva_tras_aceptar: { tipo: "plataforma" },
        respuesta_tras_aviso: { si_ya_respondio_persona: "no_responder" },
        pregunta_sin_respuesta: "handoff_inmediato",
      },
      oficina: undefined,
      envios: {
        cobertura: { tipo: "lista_blanca", ciudades: ["bogota"] },
        tiempos: [{ ciudades: ["bogota"], texto: "TEXTO DE PRUEBA" }],
        sin_certeza: "handoff",
        ciudad_desconocida_en_checkout: "handoff",
        envio_gratis: true,
        transportadora_habitual: "Interrapidísimo",
      },
    };
    const { oficina: _sin, ...sinOficina } = completa;
    void _sin;
    // Sin oficina: el negocio todavía no decidió ese bloque, así que NO está lista (la oficina es obligatoria en la configuración completa de ASLC).
    assert.equal(evaluarConfigCompleta(sinOficina).lista, false);
    assert.ok(evaluarConfigCompleta(sinOficina).pendientes.some((x) => x.campo === "oficina"));
    const conOficina = {
      ...sinOficina,
      entregas: ["domicilio", "oficina_transportadora"],
      oficina: { transportadora: "Interrapidísimo", oferta: "solo_si_cliente_pide", pide_direccion: false, pide_barrio: false, seleccion: { tipo: "texto_libre" }, documento: { modo: "requerido", tipos: "sin_especificar", retencion: { tipo: "sin_borrado_automatico" }, si_se_niega: "handoff" } },
    };
    const lista = evaluarConfigCompleta(conOficina);
    assert.equal(lista.lista, true, JSON.stringify(lista.pendientes));
    assert.ok(lista.opciones);
    // Sin responsable real => pendiente PATRICIA_REAL_PENDIENTE (no se acepta un id inventado: el id lo da la persona real).
    const sinResponsable = { ...conOficina, cierre: { ...conOficina.cierre, responsable: undefined } };
    const r = evaluarConfigCompleta(sinResponsable);
    assert.equal(r.lista, false);
    assert.ok(r.pendientes.some((x) => x.categoria === "PATRICIA_REAL_PENDIENTE"));
    // Sin textos => TEXTO_PENDIENTE.
    const sinTextos = { ...conOficina, cierre: { ...conOficina.cierre, textos: { aviso: "AVISO DE PRUEBA" } } };
    assert.ok(evaluarConfigCompleta(sinTextos).pendientes.some((x) => x.categoria === "TEXTO_PENDIENTE" && x.campo === "cierre.textos.tras_aviso_confirma"));
    // El candado de activación hace que NO esté lista.
    assert.equal(evaluarConfigCompleta({ ...conOficina, activacion_pendiente: true }).lista, false);
  });

  it("el aviso obligatorio aprobado está guardado EXACTO (747 bytes, SHA-256 fijado en la 3B.4); lo que el negocio definió (respuesta tras el 'sí', ubicación, desconfianza) tiene texto; lo demás sigue pendiente (null), sin frases inventadas", () => {
    const t = JSON.parse(leer("supabase/provisioning/aslc/textos-aprobados.json")) as Record<string, unknown> & { aviso: string; envios: Record<string, unknown> };
    assert.equal(Buffer.byteLength(t.aviso, "utf8"), 747);
    assert.equal(sha256(t.aviso), AVISO_SHA256);
    for (const k of ["tras_aviso_confirma", "ubicacion", "desconfianza"]) assert.ok(typeof t[k] === "string" && (t[k] as string).length > 0, k + " lo definió el negocio");
    for (const k of ["aceptado", "rechazado", "cancelado", "saludo"]) assert.equal(t[k], null, k + " es TEXTO_PENDIENTE");
    for (const [k, v] of Object.entries(t.envios)) assert.equal(v, null, "envios." + k + " es TEXTO_PENDIENTE");
    // El nombre de una persona solo puede estar en la respuesta tras el "sí" (lo pidió el negocio): ni en el aviso ni en ningún otro texto.
    const sinTras = { ...t, tras_aviso_confirma: "", _nota: "" };
    assert.ok(!/Patricia/.test(JSON.stringify(sinTras)), "Patricia solo aparece en la respuesta tras el 'sí'");
    assert.match(t.tras_aviso_confirma as string, /Patricia Castro/);
  });
});

// ===========================================================================
// 2. La fila base
// ===========================================================================

const T_ASLC = "11111111-1111-4111-8111-111111111111";
const PN_ASLC = "900000000000001";
const filaDeBase = (over: Partial<AgentConfigRow> = {}): AgentConfigRow => ({ id_tenant: T_ASLC, phone_number_id: PN_ASLC, ...(filaBaseAslc() as unknown as Omit<AgentConfigRow, "id_tenant" | "phone_number_id">), herramientas: [...HERRAMIENTAS_ASLC], ...over });

describe("3B.9A · fila base de ASLC: deshabilitada, con candado y sin nada de otro negocio", () => {
  it("invariantes: deshabilitada, checkout y audio apagados, sin token de plataforma, vocabulario neutral, sin confirm_order, con consultar_envio", () => {
    const f = filaBaseAslc();
    assert.equal(f.habilitado, false);
    assert.equal(f.checkout_conversacional, false);
    assert.equal(f.transcripcion_audio, false);
    assert.equal(f.clasificacion_cliente, false);
    assert.equal(f.meta_token_plataforma, false);
    assert.equal(f.vocabulario, null);
    assert.equal(f.canal, "retail");
    assert.ok(!f.herramientas.includes("confirm_order"), "el modelo no confirma pedidos: la aceptación es de una persona");
    assert.ok(f.herramientas.includes("consultar_envio") && f.herramientas.includes("handoff_to_human"));
    assert.deepEqual(f.negocio, { nombre_negocio: "Aquí Sí Lo Compras" });
    assert.ok(Object.isFrozen(f));
  });

  it("credencial PROPIA: variable válida para el registro, distinta de la de Delacour y de la general; modelo soportado", () => {
    const f = filaBaseAslc();
    assert.equal(f.credencial_ref, CREDENCIAL_GEMINI_ASLC);
    assert.ok(validateAIProviderConfig({ provider: f.proveedor, model: f.modelo, credentialRef: f.credencial_ref }).ok);
    for (const ajena of ["env:GEMINI_KEY_DELACOUR", "env:GEMINI_KEY"]) assert.notEqual(f.credencial_ref, ajena);
    assert.ok(!/DELACOUR/i.test(f.credencial_ref));
  });

  it("solo contra entrega: ni pago en tienda, ni transferencia, ni link de pago, ni recoger en tienda", () => {
    const o = opcionesBaseAslc();
    assert.deepEqual(o.pagos, [{ metodo: "contra_entrega" }]);
    assert.deepEqual(o.entregas, ["domicilio"]);
    assert.equal(o.activacion_pendiente, true);
    for (const legado of CHECKOUT_OPCIONES_LEGADO.pagos) assert.ok(!o.pagos.some((p) => p.metodo === legado.metodo), `no hereda el pago ${legado.metodo} de Delacour`);
    assert.ok(!o.entregas.includes("tienda"));
    assert.equal(o.mensajes, undefined, "ningún texto de Delacour (duda, pago no disponible…)");
  });

  it("DESHABILITADA => el agente no corre; HABILITADA por error => INVÁLIDA por el candado (calla); sin el candado y con el cierre, la compuerta (abierta desde la 3B.9D) ya no bloquea", () => {
    const esperado = { tenantId: T_ASLC, phoneNumberId: PN_ASLC };
    assert.deepEqual(parseAgentConfig(filaDeBase(), esperado), { kind: "disabled" });
    assert.deepEqual(parseAgentConfig(filaDeBase({ habilitado: true }), esperado), { kind: "invalid", reason: "activation_pending" });
    // Quitar el candado habilita un agente básico (sin checkout, sin cierre): por eso el candado y habilitado=false van juntos hasta la activación.
    const { activacion_pendiente: _c, ...sinCandado } = opcionesBaseAslc();
    void _c;
    assert.equal(parseAgentConfig(filaDeBase({ habilitado: true, checkout_opciones: sinCandado }), esperado).kind, "ok");
    // Con el cierre por aceptación humana: con la compuerta de ANTES (cerrada; fixture) era inválida (no se enciende a medias); con la REAL (ABIERTA
    // desde la 3B.9D) es válida: ahora lo que protege la fila hasta la activación es el candado, habilitado = false y la pausa de la IA.
    assert.equal(FUNCIONES_3B_IMPLEMENTADAS.cierre_aceptacion_humana, true);
    const CERRADA = { ...FUNCIONES_3B_IMPLEMENTADAS, cierre_aceptacion_humana: false };
    const filaConCierre = filaDeBase({ habilitado: true, checkout_conversacional: true, checkout_opciones: { ...sinCandado, cierre: CIERRE_DE_PRUEBA, campos: { nombre_completo: true } } });
    assert.deepEqual(parseAgentConfig(filaConCierre, esperado, { funciones3b: CERRADA }), { kind: "invalid", reason: "checkout_feature_unavailable" });
    assert.equal(parseAgentConfig(filaConCierre, esperado).kind, "ok");
  });

  it("una fila de OTRO negocio para el número de ASLC (o al revés) es inválida (tenant_mismatch): nunca se mezclan", () => {
    assert.deepEqual(parseAgentConfig(filaDeBase({ id_tenant: "22222222-2222-4222-8222-222222222222", habilitado: true }), { tenantId: T_ASLC, phoneNumberId: PN_ASLC }), { kind: "invalid", reason: "tenant_mismatch" });
  });
});

const CIERRE_DE_PRUEBA = {
  modo: "aceptacion_humana",
  validacion_resumen: "boton_datos_correctos",
  mostrar_numero_pedido: false,
  textos: { aviso: "AVISO DE PRUEBA", tras_aviso_confirma: "RESPUESTA DE PRUEBA" },
  responsable: { miembro_id: 41, respaldo_miembro_id: null, canales: ["panel"] },
  aceptan: "solo_responsable",
  reserva: { tipo: "sin_reserva" },
  vencimiento: { tipo: "sin_vencimiento" },
  reserva_tras_aceptar: { tipo: "plataforma" },
  respuesta_tras_aviso: { si_ya_respondio_persona: "no_responder" },
  pregunta_sin_respuesta: "handoff_inmediato",
} as const;

// ===========================================================================
// 3. SQL de aprovisionamiento
// ===========================================================================

describe("3B.9A · SQL de aprovisionamiento: lo generado, solo lo previsto, y la verificación es solo lectura", () => {
  const sin = (sql: string) => sql.replace(/--.*$/gm, "");
  it("el archivo 02 es EXACTAMENTE lo que genera el código (nada escrito a mano que se desvíe)", () => {
    assert.equal(leer("supabase/provisioning/aslc/02_aprovisionar_sin_activar.sql").replace(/\r\n/g, "\n"), generarSqlAprovisionamiento());
  });

  it("02 escribe SOLO la fila del agente (deshabilitada) y los tres módulos (catálogo, pedidos, por aceptar); no toca clientes_config, notificaciones, productos ni a nadie más", () => {
    const sql = sin(generarSqlAprovisionamiento());
    assert.deepEqual([...sql.matchAll(/insert into\s+(public\.\w+)/g)].map((m) => m[1]), ["public.dulabs_agente_runtime_config", "public.dulabs_tenant_modulos"]);
    assert.ok(!/update\s+public\.dulabs_clientes_config|delete\s+from|truncate|drop\s|alter\s/i.test(sql), "no modifica el negocio ni borra nada");
    assert.ok(/values\s*\(v_tenant, v_phone, 'catalog_sales', false, /.test(sql), "habilitado = false");
    assert.deepEqual([...sql.matchAll(/\(v_tenant, '([a-z_]+)', true\)/g)].map((m) => m[1]), ["catalogo", "pedidos", "pedidos_por_aceptar"]);
    assert.ok(!/notificaciones_pedidos/.test(sql), "no habilita notificaciones_pedidos (textos sin aprobar; activaría plantillas de otro negocio)");
    assert.ok(!/marca_referencia|clientes_joyeria|publibordados/.test(sql), "no habilita módulos de otros negocios");
    for (const guarda of ["UNA fila", "no está pausado", "ya la usa OTRO", "ya tiene una fila"]) assert.ok(sql.includes(guarda), guarda);
    assert.ok(/begin;/.test(sql) && /commit;/.test(sql));
    assert.ok(!AJENO.test(sql.replace(/Aquí Sí Lo Compras/g, "")), "ningún dato de otro negocio");
    assert.ok(!/GEMINI_KEY_DELACOUR/.test(sql));
  });

  it("01 es SOLO LECTURA (una sola consulta SELECT) y no muestra secretos; 04 (reversa) se niega a borrar una fila modificada", () => {
    const uno = sin(leer("supabase/provisioning/aslc/01_verificar_estado_solo_lectura.sql"));
    assert.ok(!/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy)\b/i.test(uno), "01 no modifica nada");
    assert.equal((uno.match(/;/g) ?? []).length, 1, "una sola sentencia");
    assert.ok(/select jsonb_pretty/.test(uno));
    for (const secreto of ["- 'meta_permanent_token'", "- 'api_key_ia'", "- 'prompt_sistema'", "- 'whatsapp_business_account_id'", "- 'ia_restringida_a'"]) assert.ok(uno.includes(secreto), `01 oculta ${secreto}`);
    const cuatro = sin(leer("supabase/provisioning/aslc/04_revertir_aprovisionamiento.sql"));
    assert.ok(/ya no es la del aprovisionamiento/.test(cuatro));
    assert.ok(!/update\s+public\.dulabs_clientes_config/i.test(cuatro), "la reversa no toca ia_pausada");
  });

  it("la identidad es tenant + phone_number_id + nombre y NO depende de telefono_negocio (en producción el teléfono registrado difiere del que informó el negocio)", () => {
    assert.ok(Object.isFrozen(IDENTIDAD_ASLC_PRODUCCION));
    assert.deepEqual({ ...IDENTIDAD_ASLC_PRODUCCION }, { idTenant: "320121d7-2bc5-472d-944b-5191cc228e1f", phoneNumberId: "1317599831437793", patronNombre: "lo compras" });
    const identidad = `id_tenant::text = '${IDENTIDAD_ASLC_PRODUCCION.idTenant}' and phone_number_id::text = '${IDENTIDAD_ASLC_PRODUCCION.phoneNumberId}' and nombre_negocio ~* '${IDENTIDAD_ASLC_PRODUCCION.patronNombre}'`;
    const dos = sin(generarSqlAprovisionamiento());
    assert.equal(dos.split(identidad).length - 1, 2, "02 usa la identidad completa para contar y para leer la fila");
    assert.ok(!/telefono_negocio/.test(dos), "02 no busca el negocio por telefono_negocio");
    const cuatro = sin(leer("supabase/provisioning/aslc/04_revertir_aprovisionamiento.sql"));
    assert.equal(cuatro.split(identidad).length - 1, 2, "04 usa la MISMA identidad");
    assert.ok(!/telefono_negocio/.test(cuatro), "04 no busca el negocio por telefono_negocio");
    const uno = sin(leer("supabase/provisioning/aslc/01_verificar_estado_solo_lectura.sql"));
    for (const clave of [`c.id_tenant::text = '${IDENTIDAD_ASLC_PRODUCCION.idTenant}'`, `c.phone_number_id::text = '${IDENTIDAD_ASLC_PRODUCCION.phoneNumberId}'`]) assert.ok(uno.includes(clave), `01 incluye ${clave}`);
  });

  it("la herramienta de verificación en producción es de SOLO LECTURA (nunca escribe) y no trae el valor de ningún secreto", () => {
    // `createHash(...).update(...)` es el método de node:crypto (hash de una huella), no una escritura a la base: se excluye de forma explícita.
    const src = leer("scripts/verificar-aslc-solo-lectura.mts").replace(/createHash\("md5"\)\.update\(/g, "createHash(MD5)(");
    assert.ok(!/\.(insert|update|upsert|delete|rpc)\s*\(/.test(src), "solo select: ninguna escritura ni rpc");
    assert.ok(/\.select\(/.test(src));
    for (const secreto of ["meta_permanent_token", "api_key_ia", "prompt_sistema", "base_conocimiento"]) {
      assert.ok(!new RegExp(`select\\([^)]*${secreto}`).test(src), `no se selecciona el valor de ${secreto} (solo su presencia, con un filtro not-null)`);
    }
    assert.ok(src.includes("IDENTIDAD_ASLC_PRODUCCION"), "reutiliza la identidad verificada (sin ids duplicados a mano)");
    assert.ok(/--etapa=/.test(src) && /process\.exit\(1\)/.test(src), "con --etapa evalúa un checklist y falla con código 1");
  });

});

// ===========================================================================
// Harness de runtime (turnos reales con Gemini simulado)
// ===========================================================================

const A: CatalogActor = { tenantId: T_ASLC, userId: "admin-aslc" };
const D: CatalogActor = { tenantId: "dddddddd-0000-4000-8000-00000000000d", userId: "admin-d" };
const PN_D = "900000000000004";
const CLIENTE = "573001112233";
const OTRO = "573009998877";
const PN_A = PN_ASLC;

let mem: ReturnType<typeof createInMemoryCatalogRepository>;
let admin: ReturnType<typeof createCatalogService>;
let pedidos: ReturnType<typeof createMemoryOrdersRepository>;
let engine: ReturnType<typeof createOrderEngine>;
let stateStore: ConversationStateStore;
let pausas: Array<{ waId: string; motivo: string }>;
let sent: string[];
let imagenes: unknown[];
let history: Map<string, HistoryRow[]>;
let reloj: number;
let seq: number;

beforeEach(async () => {
  mem = createInMemoryCatalogRepository();
  admin = createCatalogService({ repo: mem.repo });
  reloj = Date.parse("2026-10-02T09:15:00-05:00");
  pedidos = createMemoryOrdersRepository({ inventory: mem.inventory, now: () => reloj });
  stateStore = createMemoryConversationStateStore();
  pausas = [];
  sent = [];
  imagenes = [];
  history = new Map();
  seq = 0;
  engine = createOrderEngine({
    orders: pedidos,
    catalog: mem.repo,
    key: Buffer.alloc(32, 9),
    sink: memoryOrderEventSink(),
    log: () => {},
    now: () => new Date(reloj),
    handoff: {
      async pauseConversation({ contact, reason }) {
        pausas.push({ waId: contact.waId, motivo: reason });
        return { ok: true };
      },
    },
  });
  for (const actor of [A, D]) {
    mem.setProfile(actor.tenantId, { name: actor === A ? "Aquí Sí Lo Compras" : "Delacour Joyería", whatsapp: "573001110000" });
    mem.enableModule(actor.tenantId);
  }
  // Las fotos y el enlace del catálogo salen de la PUBLICACIÓN del negocio (Dashboard → Catálogo → publicar): requisito de la etapa de catálogo.
  await admin.ensurePublication(A);
  await admin.ensurePublication(D);
});

/** Configuración COMPLETA CONTROLADA de ASLC para las pruebas (valores de prueba; la compuerta de la 3B.5 se abre solo aquí). */
const OPCIONES_DE_PRUEBA = { entregas: ["domicilio"], pagos: [{ metodo: "contra_entrega" }], campos: { nombre_completo: true, telefono: { modo: "requerido", acepta_mismo_whatsapp: true }, departamento: true, barrio: true }, cierre: CIERRE_DE_PRUEBA };
const filaPrueba = (over: Partial<AgentConfigRow> = {}): AgentConfigRow => filaDeBase({ habilitado: true, checkout_conversacional: true, checkout_opciones: OPCIONES_DE_PRUEBA, ...over });
function cfg(row: AgentConfigRow): AgentRuntimeConfig {
  const r = parseAgentConfig(row, { tenantId: row.id_tenant, phoneNumberId: row.phone_number_id }, { funciones3b: TODAS });
  assert.equal(r.kind, "ok", JSON.stringify(r));
  return (r as { config: AgentRuntimeConfig }).config;
}
const cfgAslc = () => cfg(filaPrueba());
/** Delacour tal cual lo conocemos: perfil legado (vocabulario de joyería, pagos en tienda / transferencia). */
const filaDelacour = (): AgentConfigRow => ({
  id_tenant: D.tenantId,
  phone_number_id: PN_D,
  tipo: "catalog_sales",
  habilitado: true,
  proveedor: "gemini",
  modelo: "gemini-3.6-flash",
  credencial_ref: "env:GEMINI_KEY_DELACOUR",
  nivel_razonamiento: null,
  herramientas: AGENT_TOOL_NAMES.filter((t) => t !== "consultar_envio"),
  canal: "retail",
  negocio: {},
  vocabulario: VOCABULARIO_LEGADO,
  checkout_opciones: CHECKOUT_OPCIONES_LEGADO,
  checkout_conversacional: true,
});
const cfgDelacour = () => cfg(filaDelacour());

function toolDeps(over: Partial<AgentToolsDeps> = {}): AgentToolsDeps {
  return {
    engine,
    catalog: mem.repo,
    ownsPhoneNumber: async (t, pn) => (t === A.tenantId && pn === PN_A) || (t === D.tenantId && pn === PN_D),
    customerName: async () => null,
    rememberCustomerName: async () => {},
    siteUrl: () => "https://dulabs.test",
    ...over,
  };
}
const ledger = createMemoryProductMediaLedger();

async function turno(config: AgentRuntimeConfig, script: SimulatedStep[], text: string, opts: { waId?: string; buttonId?: string; provider?: ReturnType<typeof createSimulatedProvider>; clasificacion?: boolean } = {}) {
  const provider = opts.provider ?? createSimulatedProvider(script);
  const waId = opts.waId ?? CLIENTE;
  const wamid = `wamid.in.${++seq}`;
  const h = history.get(waId + config.phoneNumberId) ?? [];
  history.set(waId + config.phoneNumberId, h);
  h.push({ direccion: "entrante", contenido: text, origen: "entrante", wamid });
  const r = await runAgentTurn(
    {
      config,
      provider,
      model: "gemini-3.6-flash",
      tools: toolDeps(),
      state: stateStore,
      history: { recent: async () => h.map((x) => ({ ...x })) },
      media: ledger,
      classification: createMemoryCustomerChannelStore({ [PN_A]: A.tenantId, [PN_D]: D.tenantId }),
      sender: {
        async sendText(t) {
          sent.push(t);
          h.push({ direccion: "saliente", contenido: t, origen: "ia", wamid: `wamid.out.${++seq}` });
          return { sent: true, wamid: `wamid.out.${seq}` };
        },
        async sendImage(img) {
          imagenes.push(img);
          return { sent: true, wamid: `wamid.img.${++seq}` };
        },
        async sendButtons(body) {
          sent.push(body);
          return { sent: true, wamid: `wamid.btn.${++seq}` };
        },
        async sendList(body) {
          sent.push(body);
          return { sent: true, wamid: `wamid.list.${++seq}` };
        },
        humanTookOver: async () => false,
      },
      log: () => {},
      now: () => reloj,
      retry: { sleep: async () => {}, random: () => 0 },
    },
    { tenantId: config.tenantId, phoneNumberId: config.phoneNumberId, waId, wamid, text, buttonId: opts.buttonId ?? null },
  );
  return { ...r, provider };
}
const call = (name: string, args: Record<string, unknown> = {}): SimulatedStep => ({ toolCalls: [{ name, args }] });

// ===========================================================================
// 4. Aislamiento: ASLC no hereda nada de Delacour
// ===========================================================================

describe("3B.9A · aislamiento: ASLC no ve ni hereda nada de Delacour (y Delacour no recibe nada de ASLC)", () => {
  it("el prompt del modelo de ASLC no trae palabras de joyería ni de otro negocio ni métodos de pago ajenos; el de Delacour es EXACTAMENTE el de siempre", async () => {
    const r = await turno(cfgAslc(), [{ text: "¡Hola! ¿Qué producto buscas?" }], "hola");
    const sistema = r.provider.requests[0].system;
    assert.ok(!AJENO.test(sistema.replace("Aquí Sí Lo Compras", "")), `el prompt de ASLC trae algo ajeno: ${AJENO.exec(sistema)?.[0]}`);
    assert.ok(sistema.includes("ASLC") === false);
    assert.ok(esVocabularioNeutral(cfgAslc().vocabulary));
    // Delacour y cualquier negocio con vocabulario propio: las reglas de siempre, byte a byte.
    assert.equal(platformRulesFor(VOCABULARIO_LEGADO), PLATFORM_RULES);
    const d = await turno(cfgDelacour(), [{ text: "Hola" }], "hola", { waId: OTRO });
    assert.ok(d.provider.requests[0].system.startsWith(PLATFORM_RULES));
    // El único cambio para un negocio neutral: la regla 14 sin el ejemplo de otro rubro.
    assert.notEqual(platformRulesFor(VOCABULARIO_NEUTRAL), PLATFORM_RULES);
    assert.equal(platformRulesFor(VOCABULARIO_NEUTRAL), PLATFORM_RULES.replace(' ("aretes, collares, anillos…")', ""));
  });

  it("saludo por defecto: un negocio NEUTRAL sin saludo propio NO recibe el de Delacour (💍); Delacour lo conserva", async () => {
    const aslc = { ...cfgAslc(), classifyCustomers: true };
    await turno(aslc, [], "hola", { waId: "573001110011" });
    assert.ok(sent.length >= 1);
    assert.ok(!sent[0].includes(DEFAULT_WELCOME) && !sent[0].includes("💍"), sent[0]);
    assert.ok(sent[0].startsWith(CHANNEL_QUESTION.body.slice(0, 20)) || sent[0].includes(CHANNEL_QUESTION.body.slice(0, 20)));
    sent.length = 0;
    const delacour = { ...cfgDelacour(), classifyCustomers: true };
    await turno(delacour, [], "hola", { waId: "573001110012" });
    assert.ok(sent[0].includes(DEFAULT_WELCOME), "Delacour conserva su saludo de siempre");
  });

  it("los textos fijos del checkout de ASLC (pagos, entregas) salen de SU configuración: ni 'transferencia', ni 'pago en tienda', ni 'recoger en tienda'", async () => {
    const p = await admin.createProduct(A, { name: "Producto de prueba QA", retailPrice: 10_000, stock: 5 });
    const config = cfgAslc();
    const r = await turno(config, [call("update_cart", { items: [{ reference: p.reference, quantity: 1 }] }), { text: "Listo, lo agregué." }], `quiero 1 ${p.reference}`);
    void r;
    await turno(config, [call("create_order_request"), { text: "TEXTO DEL MODELO QUE NO DEBE SALIR" }], "me lo llevo");
    const salidas = sent.join("\n");
    assert.ok(!/transferencia|pago en tienda|recoger en tienda|nequi|daviplata/i.test(salidas), salidas);
  });

  it("catálogo, precios, fotos y pedidos son POR NEGOCIO: ASLC no encuentra ningún producto de Delacour (ni por nombre, ni por referencia) y sus pedidos no se cruzan", async () => {
    const delacour = await admin.createProduct(D, { name: "Aretes Luna Delacour", retailPrice: 45_000, stock: 5, color: "Dorado" });
    await mem.repo.attachMedia(D.tenantId, D.userId, { productId: delacour.id, storagePath: `${D.tenantId}/${delacour.id}/foto.webp`, thumbPath: null, mimeType: "image/webp", bytes: 10, width: 800, height: 800, makePrimary: true });
    // Búsqueda desde ASLC por el nombre exacto del producto de Delacour: nada.
    const busca = await turno(cfgAslc(), [call("search_products", { query: "Aretes Luna Delacour" }), { text: "No encontré ese producto en el catálogo." }], "busco Aretes Luna Delacour");
    const salidaBusqueda = JSON.stringify(busca.provider.requests.at(-1)?.turns);
    assert.ok(!salidaBusqueda.includes("Aretes Luna Delacour") || !/unit_price/.test(salidaBusqueda), "no devuelve productos de Delacour");
    assert.ok(!salidaBusqueda.includes("45000") && !salidaBusqueda.includes("45.000"), "ni sus precios");
    // La misma referencia (cada negocio numera las suyas) en ASLC no existe: no se confunde con la de Delacour.
    const porRef = await turno(cfgAslc(), [call("get_product_details", { reference: delacour.reference }), { text: "No encontré esa referencia." }], `¿la ${delacour.reference}?`, { waId: OTRO });
    assert.ok(!JSON.stringify(porRef.provider.requests.at(-1)?.turns).includes("Aretes Luna Delacour"));
    assert.equal(imagenes.length, 0, "no se envió ninguna foto de Delacour");
    // Pedidos: ninguno de Delacour aparece en ASLC.
    assert.equal((await engine.listOpenOrders(A.tenantId, 50)).length, 0);
  });

  it("textos, reglas y herramientas: la configuración de ASLC no trae ningún valor de Delacour y la de Delacour no cambió por existir la de ASLC", () => {
    const aslc = JSON.stringify(filaBaseAslc());
    assert.ok(!AJENO.test(aslc.replace("Aquí Sí Lo Compras", "")));
    const delacour = cfgDelacour();
    assert.equal(delacour.checkoutOptions?.pagos.some((p) => p.metodo === "transferencia"), true, "Delacour conserva sus pagos");
    assert.ok(!delacour.tools.includes("consultar_envio"), "Delacour no recibe la herramienta de envíos de ASLC");
    assert.equal(delacour.checkoutOptions?.envios, undefined);
    assert.equal(delacour.checkoutOptions?.cierre, undefined);
    assert.equal(delacour.audioTranscription, false);
    // La tienda de configuraciones resuelve cada número con SU fila.
    const store = createMemoryAgentConfigStore([filaDeBase(), filaDelacour()]);
    return Promise.all([store.getByPhoneNumber(PN_A), store.getByPhoneNumber(PN_D)]).then(([a, d]) => {
      assert.equal(a?.id_tenant, T_ASLC);
      assert.equal(d?.id_tenant, D.tenantId);
      assert.notEqual(a?.credencial_ref, d?.credencial_ref);
    });
  });
});

// ===========================================================================
// 5. FAIL-CLOSED: nada cae a un camino legacy
// ===========================================================================

const entrada: AgentBoundaryInput = { cliente: { id_tenant: T_ASLC, phone_number_id: PN_ASLC }, waId: CLIENTE, destino: CLIENTE, wamid: "wamid.x", text: "hola" };

function fronteraDeps(store: AgentConfigStore, opts: { env?: Record<string, string>; script?: Parameters<typeof createSimulatedProvider>[0]; funciones3b?: Record<FuncionFase3B, boolean>; meta?: boolean; buildNull?: boolean; pendingAcceptance?: AgentBoundaryDeps["pendingAcceptance"] | "ninguno" } = {}) {
  const calls = { build: 0, factories: [] as string[], sent: [] as string[], errors: [] as Array<Record<string, unknown>> };
  const memLocal = createInMemoryCatalogRepository();
  memLocal.enableModule(T_ASLC);
  const provider = createSimulatedProvider(opts.script ?? [{ text: "¡Hola! ¿En qué te ayudo?" }]);
  const d: AgentBoundaryDeps = {
    configStore: store,
    env: opts.env ?? { GEMINI_KEY_ASLC: "k-no-real-aslc" },
    factories: { gemini: (k) => (calls.factories.push(k), provider) },
    logError: (e) => calls.errors.push(e),
    ...(opts.funciones3b ? { funciones3b: opts.funciones3b } : {}),
    ...(opts.meta === undefined ? {} : { hasMetaCredential: () => opts.meta as boolean }),
    ...(opts.pendingAcceptance === "ninguno" ? {} : { pendingAcceptance: opts.pendingAcceptance ?? (async () => ({ pending: false, noticeSent: false })) }),
    build() {
      calls.build++;
      if (opts.buildNull) return null;
      const eng = createOrderEngine({ orders: createMemoryOrdersRepository(), catalog: memLocal.repo, key: Buffer.alloc(32, 1), log: () => {} });
      return {
        tools: { engine: eng, catalog: memLocal.repo, log: () => {}, ownsPhoneNumber: async () => true },
        state: createMemoryConversationStateStore(),
        history: { recent: async () => [] },
        sender: { sendText: async (t) => (calls.sent.push(t), true), sendImage: async () => true, humanTookOver: async () => false },
        log: () => {},
      };
    },
  };
  return { d, calls, provider };
}

describe("3B.9A · FAIL-CLOSED: ASLC nunca cae a un agente legacy (Flow, Business Agent, bot general, otro negocio)", () => {
  it("SIN fila de agente el número SÍ cae a los otros caminos (handled:false): por eso el aprovisionamiento crea la fila base; con ella, jamás", async () => {
    const sin = fronteraDeps(createMemoryAgentConfigStore([]));
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, sin.d), { handled: false, reason: "no_agent" });
    const con = fronteraDeps(createMemoryAgentConfigStore([filaDeBase()]));
    const r = await atenderConAgenteSiAplica(entrada, con.d);
    assert.equal(r.handled, true, "con la fila base el mensaje es del agente (deshabilitado: silencio)");
  });

  it("fila base DESHABILITADA: silencio total (nada enviado, ningún modelo, nada construido)", async () => {
    const f = fronteraDeps(createMemoryAgentConfigStore([filaDeBase()]));
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, f.d), { handled: true, outcome: "disabled" });
    assert.equal(f.calls.build, 0);
    assert.deepEqual(f.calls.sent, []);
    assert.deepEqual(f.calls.factories, []);
    // Un mensaje sin texto (audio, foto) tampoco cae a otro camino.
    const audio = await atenderConAgenteSiAplica({ ...entrada, wamid: "wamid.a", text: "", nonText: { kind: "audio", mediaId: "m1" } }, f.d);
    assert.equal(audio.handled, true);
    assert.deepEqual(f.calls.sent, []);
  });

  it("fila base HABILITADA por error: el candado de activación la hace inválida (calla y NO cae a otro bot)", async () => {
    const f = fronteraDeps(createMemoryAgentConfigStore([filaDeBase({ habilitado: true })]));
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, f.d), { handled: true, outcome: "invalid_config", reason: "activation_pending" });
    assert.deepEqual(f.calls.sent, []);
    assert.deepEqual(f.calls.factories, []);
    assert.equal(f.calls.errors[0].reason, "activation_pending");
  });

  it("configuración completa con la compuerta de ANTES (cerrada): inválida y callada (nunca otro bot)", async () => {
    const CERRADA = { ...FUNCIONES_3B_IMPLEMENTADAS, cierre_aceptacion_humana: false };
    const f = fronteraDeps(createMemoryAgentConfigStore([filaPrueba()]), { funciones3b: CERRADA });
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, f.d), { handled: true, outcome: "invalid_config", reason: "checkout_feature_unavailable" });
    assert.deepEqual(f.calls.sent, []);
  });

  it("falta la credencial de Gemini de ASLC: no usa la de Delacour ni la general ni otro proveedor", async () => {
    const f = fronteraDeps(createMemoryAgentConfigStore([filaPrueba({ checkout_opciones: { entregas: ["domicilio"], pagos: [{ metodo: "contra_entrega" }] }, checkout_conversacional: false })]), { env: { GEMINI_KEY_DELACOUR: "ajena", GEMINI_KEY: "general", ANTHROPIC_API_KEY: "sk" } });
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, f.d), { handled: true, outcome: "invalid_config", reason: "credential_missing" });
    assert.deepEqual(f.calls.factories, []);
    assert.deepEqual(f.calls.sent, []);
  });

  it("sin credencial de Meta PROPIA (ni autorización para la de la plataforma): no corre, sin enviar con la de otro", async () => {
    const f = fronteraDeps(createMemoryAgentConfigStore([filaPrueba({ checkout_opciones: { entregas: ["domicilio"], pagos: [{ metodo: "contra_entrega" }] }, checkout_conversacional: false })]), { meta: false });
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, f.d), { handled: true, outcome: "invalid_config", reason: "meta_credential_missing" });
    assert.deepEqual(f.calls.sent, []);
  });

  it("no se puede leer la configuración: fail-closed (no se arriesga a que responda otro bot)", async () => {
    const roto: AgentConfigStore = { async getByPhoneNumber() { throw new Error("db"); } };
    const f = fronteraDeps(roto);
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, f.d), { handled: true, outcome: "unavailable", reason: "config_unreadable" });
  });

  it("falla la aceptación humana (guardia ausente o ilegible): silencio, no se atiende por otro camino", async () => {
    const abierta = { funciones3b: TODAS };
    const sinGuardia = fronteraDeps(createMemoryAgentConfigStore([filaPrueba()]), { ...abierta, pendingAcceptance: "ninguno" });
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, sinGuardia.d), { handled: true, outcome: "unavailable", reason: "acceptance_guard_unavailable" });
    const ilegible = fronteraDeps(createMemoryAgentConfigStore([filaPrueba()]), { ...abierta, pendingAcceptance: async () => { throw new Error("db"); } });
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, ilegible.d), { handled: true, outcome: "unavailable", reason: "pending_acceptance_unreadable" });
    for (const f of [sinGuardia, ilegible]) assert.deepEqual(f.calls.sent, []);
    // Con un pedido pendiente CON aviso, el agente no atiende (es de la persona responsable).
    const pendiente = fronteraDeps(createMemoryAgentConfigStore([filaPrueba()]), { ...abierta, pendingAcceptance: async () => ({ pending: true, noticeSent: true }) });
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, pendiente.d), { handled: true, outcome: "pending_acceptance" });
    assert.equal(pendiente.provider.requests.length, 0);
  });

  it("no se pueden armar las dependencias del runtime: silencio (no hay agente de respaldo)", async () => {
    const f = fronteraDeps(createMemoryAgentConfigStore([filaPrueba()]), { funciones3b: TODAS, buildNull: true });
    assert.deepEqual(await atenderConAgenteSiAplica(entrada, f.d), { handled: true, outcome: "unavailable", reason: "runtime_deps_unavailable" });
    assert.deepEqual(f.calls.sent, []);
  });

  it("Gemini FALLA durante el turno: mensaje técnico fijo (nunca otro bot, nunca un texto inventado); dos fallos seguidos pasan a una persona", async () => {
    const provider = { id: "gemini", generate: async () => { throw new Error("503 Gemini caído"); } } as unknown as ReturnType<typeof createSimulatedProvider>;
    const r1 = await turno(cfgAslc(), [], "hola", { provider });
    assert.equal(r1.outcome, "fallback");
    assert.deepEqual(sent, [FALLBACK_MESSAGES.technical]);
    const r2 = await turno(cfgAslc(), [], "¿hola?", { provider });
    assert.equal(r2.outcome, "handoff");
    assert.equal(sent.at(-1), FALLBACK_MESSAGES.handoff);
    assert.equal(pausas.length, 1);
  });

  it("una herramienta falla (el catálogo no responde): el modelo no puede inventar con lo que no vio; sale el mensaje fijo", async () => {
    const roto = { ...mem.repo, searchProducts: async () => { throw new Error("db caída"); }, listProducts: async () => { throw new Error("db caída"); } } as unknown as AgentToolsDeps["catalog"];
    const provider = createSimulatedProvider([call("search_products", { query: "algo" }), { text: "Tenemos lámparas a $35.000 (ref DL-000001)" }, { text: "Tenemos lámparas a $35.000 (ref DL-000001)" }]);
    const r = await runAgentTurn(
      {
        config: cfgAslc(),
        provider,
        model: "gemini-3.6-flash",
        tools: toolDeps({ catalog: roto }),
        state: stateStore,
        history: { recent: async () => [] },
        sender: { sendText: async (t) => (sent.push(t), { sent: true, wamid: "w1" }), sendImage: async () => ({ sent: true, wamid: "w2" }), humanTookOver: async () => false },
        log: () => {},
        now: () => reloj,
        retry: { sleep: async () => {}, random: () => 0 },
      },
      { tenantId: A.tenantId, phoneNumberId: PN_A, waId: CLIENTE, wamid: "wamid.f1", text: "¿qué lámparas tienen?" },
    );
    assert.ok(!sent.some((t) => /35\.000|lámparas/.test(t)), "nada de lo inventado sale");
    assert.ok(["fallback", "handoff"].includes(r.outcome));
  });

  it("el webhook entrega TODO mensaje al agente conversacional ANTES de Flow, Business Agent y legacy; y la pausa y la restricción van primero que todo", () => {
    const src = leer("app/webhook-dulabs/route.ts");
    const iPausa = src.indexOf("if (cliente.ia_pausada)");
    const iRestringida = src.indexOf("if (cliente.ia_restringida_a)");
    const iAgente = src.indexOf("await intentarAgenteConversacionalSiAplica(cliente, mensaje, telefonoRemitente, destinoWhatsApp)");
    const iBusiness = src.indexOf("await intentarBusinessAgentSiAplica(cliente, mensaje, telefonoRemitente)");
    const iFlow = src.indexOf("await atenderMensajeConFlowConFallback({");
    for (const [nombre, i] of Object.entries({ iPausa, iRestringida, iAgente, iBusiness, iFlow })) assert.ok(i > 0, nombre);
    assert.ok(iPausa < iRestringida && iRestringida < iAgente && iAgente < iBusiness && iBusiness < iFlow, "orden: pausa, restricción, agente conversacional, Business Agent, Flow, legacy");
    assert.match(src, /Error inesperado: no se sabe si el número tiene agente => no se arriesga a que responda otro bot/);
  });
});

// ===========================================================================
// 6. Pruebas ANTES del catálogo real (12 casos)
// ===========================================================================

describe("3B.9A · pruebas con configuración controlada y catálogo VACÍO: ante lo que no se sabe, falla de forma segura", () => {
  const config = () => cfgAslc();

  it("1) saludo: responde el modelo sin nada de otro negocio (y sin que nada de Delacour llegue al prompt)", async () => {
    const r = await turno(config(), [{ text: "¡Hola! Soy el asistente de Aquí Sí Lo Compras. ¿Qué producto buscas?" }], "hola");
    assert.equal(r.outcome, "replied");
    assert.deepEqual(sent, ["¡Hola! Soy el asistente de Aquí Sí Lo Compras. ¿Qué producto buscas?"]);
    assert.ok(!AJENO.test(r.provider.requests[0].system.replace("Aquí Sí Lo Compras", "")));
  });

  it("2) pregunta general ('¿qué venden?') con catálogo vacío: 'no encontré' (modelo cooperativo); si inventa productos y precios, NO sale", async () => {
    const ok = await turno(config(), [call("search_products", { query: "productos" }), { text: "Todavía no tengo productos para mostrarte. ¿Quieres que te comunique con una persona del equipo?" }], "¿qué venden?");
    assert.equal(ok.outcome, "replied");
    assert.match(sent.at(-1) ?? "", /no tengo productos/i);
    sent.length = 0;
    const inventa = await turno(config(), [{ text: "Tenemos lámparas desde $35.000 y ventiladores a $90.000" }, { text: "Tenemos lámparas desde $35.000" }], "¿qué venden?", { waId: OTRO });
    assert.ok(!sent.some((t) => /35\.000|90\.000|lámparas|ventiladores/.test(t)));
    assert.ok(inventa.trace.grounding.violations.length > 0);
    assert.equal(sent.at(-1), FALLBACK_MESSAGES.unverified);
  });

  it("3) pregunta por un producto SIN catálogo: 'no encontré'; un producto, precio o referencia inventados no salen", async () => {
    const ok = await turno(config(), [call("search_products", { query: "zapatos" }), { text: "No encontré zapatos en el catálogo." }], "quiero unos zapatos");
    assert.equal(ok.outcome, "replied");
    sent.length = 0;
    await turno(config(), [{ text: "Claro, tenemos zapatos Nike por $120.000 (ref ZP-001)" }, { text: "Zapatos Nike $120.000 ref ZP-001" }], "quiero unos zapatos", { waId: OTRO });
    assert.ok(!sent.some((t) => /Nike|120\.000|ZP-001/.test(t)));
    assert.equal(sent.at(-1), FALLBACK_MESSAGES.unverified);
  });

  it("4) pregunta de PRECIO sin producto: se pregunta de cuál; un precio inventado no sale", async () => {
    await turno(config(), [{ text: "¿De cuál producto quieres saber el precio?" }], "¿cuánto cuesta?");
    assert.deepEqual(sent, ["¿De cuál producto quieres saber el precio?"]);
    sent.length = 0;
    await turno(config(), [{ text: "Cuesta $45.000" }, { text: "Cuesta $45.000, es el precio normal" }], "¿cuánto cuesta?", { waId: OTRO });
    assert.ok(!sent.some((t) => /45\.000/.test(t)));
  });

  it("5) pregunta de ENVÍO (sin reglas de envío configuradas todavía): el backend pasa a una persona; el modelo no afirma gratis, tiempos, cobertura ni transportadora", async () => {
    const r = await turno(config(), [call("consultar_envio", { city: "Cali" }), { text: "Sí, envío gratis en 2 a 3 días con Interrapidísimo" }], "¿hacen envíos a Cali? ¿cuánto demora?");
    assert.equal(r.outcome, "handoff");
    assert.deepEqual(sent, [FALLBACK_MESSAGES.handoff]);
    assert.equal(r.provider.remaining(), 1, "el modelo no llegó a redactar");
    assert.equal(r.trace.shipping?.status, "rules_unavailable");
    assert.equal(pausas.length, 1);
    // Sin consultar la herramienta: el guardián de envíos está activo AUNQUE no haya reglas (la herramienta está en la lista del número).
    sent.length = 0;
    const sin = await turno(config(), [{ text: "¡Claro! Enviamos gratis a todo el país en 2 a 3 días con Interrapidísimo" }, { text: "Te llega en 2 días, gratis" }], "¿hacen envíos a Medellín?", { waId: OTRO });
    assert.ok(sin.trace.grounding.violations.includes("shipping"));
    assert.deepEqual(sent, [FALLBACK_MESSAGES.handoff]);
    assert.ok(!sent.some((t) => /gratis|2 d[ií]as|Inter/i.test(t)));
  });

  it("6) ciudad DESCONOCIDA: una persona; nunca una estimación ni 'no llegamos'", async () => {
    const r = await turno(config(), [call("consultar_envio", { city: "Villa Imaginaria" }), { text: "A esa ciudad no llegamos" }], "¿envían a Villa Imaginaria?");
    assert.equal(r.outcome, "handoff");
    assert.deepEqual(sent, [FALLBACK_MESSAGES.handoff]);
    assert.ok(!sent.some((t) => /no llegamos|no enviamos/i.test(t)));
  });

  it("7) solicitud de una persona: el BACKEND la pasa a una asesora sin modelo", async () => {
    const r = await turno(config(), [{ text: "NO DEBE LLEGAR AL MODELO" }], "quiero hablar con una persona");
    assert.equal(r.outcome, "handoff");
    assert.equal(r.provider.requests.length, 0);
    assert.deepEqual(sent, [FALLBACK_MESSAGES.handoff]);
    assert.equal(pausas.length, 1);
  });

  it("8, 9, 10) pago ANTICIPADO, Nequi y transferencia: respuesta FIJA con SU configuración (solo contra entrega), sin modelo, sin datos de cuentas", async () => {
    const casos: Array<[string, RegExp]> = [
      ["¿puedo dejar un anticipo para separarlo?", /no manejamos pagos anticipados.*contra entrega/],
      ["¿te puedo pagar un abono primero?", /no manejamos pagos anticipados/],
      ["¿me recibes por Nequi?", /no manejamos pago por transferencia.*contra entrega/],
      ["te pago por daviplata", /no manejamos pago por transferencia/],
      ["prefiero hacer una transferencia", /no manejamos pago por transferencia/],
      ["¿te consigno por bancolombia?", /no manejamos pago por transferencia/],
    ];
    let i = 0;
    for (const [mensaje, esperado] of casos) {
      sent.length = 0;
      const r = await turno(config(), [{ text: "NO DEBE LLEGAR AL MODELO: sí, por Nequi al 3001234567" }], mensaje, { waId: `57300777${String(i++).padStart(4, "0")}` });
      assert.equal(r.outcome, "replied", mensaje);
      assert.equal(r.provider.requests.length, 0, `${mensaje}: el modelo no participa`);
      assert.equal(sent.length, 1);
      assert.match(sent[0], esperado, mensaje);
      assert.match(sent[0], /\*contra entrega\*/, "ofrece solo lo que el negocio ofrece");
      assert.ok(!/\d{7,}/.test(sent[0]), "ningún dato de cuentas");
    }
  });

  it("8–10) pagar contra entrega NO se confunde con un medio no ofrecido: el mensaje sigue al modelo", async () => {
    const r = await turno(config(), [{ text: "Sí, el pago es contra entrega." }], "¿puedo pagar cuando me llegue, contra entrega?");
    assert.equal(r.provider.requests.length, 1);
    assert.deepEqual(sent, ["Sí, el pago es contra entrega."]);
  });

  it("8–10) un negocio que SÍ ofrece transferencia no recibe esa respuesta (es por configuración, no por palabra)", async () => {
    const conTransferencia = cfg(filaPrueba({ checkout_opciones: { ...OPCIONES_DE_PRUEBA, pagos: [{ metodo: "contra_entrega" }, { metodo: "transferencia" }] } }));
    const r = await turno(conTransferencia, [{ text: "Sí, puedes pagar por transferencia." }], "¿puedo pagar por transferencia?");
    assert.equal(r.provider.requests.length, 1);
  });

  it("12) pregunta FUERA de lo que sabe: el modelo cooperativo lo dice y ofrece una persona; los números inventados no salen", async () => {
    await turno(config(), [{ text: "Esa información no la tengo confirmada. Una persona del equipo te la confirma." }], "¿tienen garantía y cuál es la dirección de la tienda?");
    assert.match(sent.at(-1) ?? "", /no la tengo confirmada/);
    sent.length = 0;
    await turno(config(), [{ text: "La garantía es de 12 meses y la tienda queda en la Calle 10 # 20-30, sale por $35.000" }, { text: "Garantía de 12 meses, $35.000" }], "¿tienen garantía y cuál es la dirección de la tienda?", { waId: OTRO });
    assert.ok(!sent.some((t) => /35\.000/.test(t)), "una cifra de dinero inventada no sale");
  });
});

// ===========================================================================
// 6b. Audio (11): preparado, apagado para clientes reales
// ===========================================================================

describe("3B.9A · audio de ASLC: apagado en el aprovisionamiento; encendido, la nota de voz entra como texto con SUS credenciales", () => {
  const audio = (over: Partial<AgentBoundaryInput> = {}): AgentBoundaryInput => ({ ...entrada, wamid: "wamid.audio.1", text: "", nonText: { kind: "audio", mediaId: "media-audio-1" }, ...over });
  function frontera(fila: AgentConfigRow, transcribir: (mediaId: string) => Promise<{ ok: true; texto: string; bytes: number; usage: { input: number; output: number } } | { ok: false; motivo: "error" | "sin_voz" | "formato" | "tamano" | "descarga" | "sin_token" }>) {
    const calls = { sent: [] as string[], transcribir: [] as Array<{ apiKey: string; model: string; mediaId: string }>, errores: [] as Array<Record<string, unknown>> };
    const memLocal = createInMemoryCatalogRepository();
    memLocal.enableModule(T_ASLC);
    const provider = createSimulatedProvider([{ text: "¡Claro! ¿Cuál producto te interesa?" }]);
    const d: AgentBoundaryDeps = {
      configStore: createMemoryAgentConfigStore([fila]),
      env: { GEMINI_KEY_ASLC: "clave-aslc-no-real", GEMINI_KEY_DELACOUR: "clave-delacour-no-real" },
      factories: { gemini: () => provider },
      logError: (e) => calls.errores.push(e),
      funciones3b: TODAS,
      pendingAcceptance: async () => ({ pending: false, noticeSent: false }),
      build() {
        const eng = createOrderEngine({ orders: createMemoryOrdersRepository(), catalog: memLocal.repo, key: Buffer.alloc(32, 1), log: () => {} });
        return {
          tools: { engine: eng, catalog: memLocal.repo, log: () => {}, ownsPhoneNumber: async () => true },
          state: createMemoryConversationStateStore(),
          history: { recent: async () => [] },
          sender: { sendText: async (t) => (calls.sent.push(t), true), sendImage: async () => true, humanTookOver: async () => false },
          log: () => {},
          audioTranscriber: ({ apiKey, model }) => async (mediaId) => {
            calls.transcribir.push({ apiKey, model, mediaId });
            return transcribir(mediaId);
          },
          noteTranscription: async () => {},
          logTranscription: () => {},
        };
      },
    };
    return { d, calls, provider };
  }
  const ok = async () => ({ ok: true as const, texto: "Hola, quiero ver los productos", bytes: 4_000, usage: { input: 420, output: 15 } });

  it("en el estado aprovisionado (transcripcion_audio = false): se pide escrita, sin transcribir ni gastar el modelo", async () => {
    const f = frontera(filaPrueba({ transcripcion_audio: false }), ok);
    assert.deepEqual(await atenderConAgenteSiAplica(audio(), f.d), { handled: true, outcome: "replied" });
    assert.deepEqual(f.calls.sent, [NON_TEXT_MESSAGES.audio]);
    assert.equal(f.calls.transcribir.length, 0);
    assert.equal(f.provider.requests.length, 0);
  });

  it("ENCENDIDO (para la activación): descarga y transcribe con la clave PROPIA de ASLC (nunca la de Delacour), y el texto sigue el flujo normal", async () => {
    const f = frontera(filaPrueba({ transcripcion_audio: true }), ok);
    assert.deepEqual(await atenderConAgenteSiAplica(audio(), f.d), { handled: true, outcome: "replied" });
    assert.deepEqual(f.calls.transcribir, [{ apiKey: "clave-aslc-no-real", model: "gemini-3.6-flash", mediaId: "media-audio-1" }]);
    assert.ok(!f.calls.transcribir.some((c) => c.apiKey === "clave-delacour-no-real"));
    assert.equal(f.provider.requests.length, 1);
    assert.ok(JSON.stringify(f.provider.requests[0].turns).includes("Hola, quiero ver los productos"));
    assert.deepEqual(f.calls.sent, ["¡Claro! ¿Cuál producto te interesa?"]);
  });

  it("si no se puede transcribir (error, sin voz, formato, tamaño): se pide escrita; nunca se adivina lo que dijo", async () => {
    for (const motivo of ["error", "sin_voz", "formato", "tamano", "descarga", "sin_token"] as const) {
      const f = frontera(filaPrueba({ transcripcion_audio: true }), async () => ({ ok: false, motivo }));
      assert.deepEqual(await atenderConAgenteSiAplica(audio(), f.d), { handled: true, outcome: "replied" }, motivo);
      assert.deepEqual(f.calls.sent, [NON_TEXT_MESSAGES.audioNoEntendido], motivo);
      assert.equal(f.provider.requests.length, 0, motivo);
    }
  });
});

// ===========================================================================
// 7. El catálogo reutilizable soporta lo que ASLC necesita
// ===========================================================================

describe("3B.9A · catálogo: nombre, referencia, descripción, precio, stock, disponibilidad, color, fotos, similares, búsqueda y actualización SIN desarrollo nuevo", () => {
  async function conFoto(actor: CatalogActor, input: Parameters<typeof admin.createProduct>[1]) {
    const p = await admin.createProduct(actor, input);
    await mem.repo.attachMedia(actor.tenantId, actor.userId, { productId: p.id, storagePath: `${actor.tenantId}/${p.id}/foto.webp`, thumbPath: null, mimeType: "image/webp", bytes: 10, width: 800, height: 800, makePrimary: true });
    return p;
  }
  const salidas = (req: { turns: Array<{ role: string; results?: Array<{ output: unknown }> }> }) => req.turns.filter((t) => t.role === "tool").flatMap((t) => t.results ?? []).map((x) => x.output) as Array<Record<string, unknown>>;

  it("el negocio carga un producto con TODOS sus datos (con el mismo servicio del Dashboard) y el agente lo ve completo: referencia, nombre, descripción, color, precio, disponibilidad y foto", async () => {
    const p = await conFoto(A, { name: "Producto de prueba QA 1", description: "Descripción de prueba", color: "Negro", material: "Metal", retailPrice: 80_000, stock: 5 });
    assert.match(p.reference, /^[A-Z]{2}-\d{6}$/, "referencia comercial generada por la base");
    const r = await turno(cfgAslc(), [call("search_products", { query: "Producto de prueba QA 1" }), call("get_product_details", { reference: p.reference }), call("request_product_images", { references: [p.reference] }), { text: "Aquí lo tienes." }], "busco Producto de prueba QA 1");
    const out = JSON.stringify(salidas(r.provider.requests.at(-1)!));
    for (const dato of ["Producto de prueba QA 1", "Descripción de prueba", "Negro", p.reference, "80000"]) assert.ok(out.includes(dato), dato);
    assert.equal(imagenes.length, 1, "se envía la foto del producto");
  });

  it("el cliente del negocio ACTUALIZA precio, stock, descripción y estado desde el módulo y el agente lo ve en el siguiente turno (sin desplegar nada)", async () => {
    const p = await conFoto(A, { name: "Producto de prueba QA 2", retailPrice: 50_000, stock: 3 });
    const busca = (waId: string) => turno(cfgAslc(), [call("search_products", { query: "Producto de prueba QA 2" }), { text: "Listo." }], "busco Producto de prueba QA 2", { waId });
    const antes = JSON.stringify(salidas((await busca(CLIENTE)).provider.requests.at(-1)!));
    assert.ok(antes.includes("50000") && /"availability":"(available|low)"/.test(antes));
    await admin.updateProduct(A, p.id, { retailPrice: 65_000, stock: 0, description: "Descripción nueva" });
    const despues = JSON.stringify(salidas((await busca(OTRO)).provider.requests.at(-1)!));
    assert.ok(despues.includes("65000") && !despues.includes("50000"), "precio nuevo");
    assert.ok(/"availability":"sold_out"/.test(despues), "stock 0 => agotado");
    await admin.updateProduct(A, p.id, { status: "INACTIVE" });
    const inactivo = JSON.stringify(salidas((await busca("573001110099")).provider.requests.at(-1)!));
    assert.ok(!inactivo.includes("Producto de prueba QA 2") || /sold_out|unavailable|"candidates":\[\]/.test(inactivo));
  });

  it("producto similar y 'ver más': se ofrecen de la misma categoría/nombre, nunca el mismo producto", async () => {
    const a = await conFoto(A, { name: "Lámpara QA Mesa", color: "Blanco", retailPrice: 30_000, stock: 4 });
    const b = await conFoto(A, { name: "Lámpara QA Techo", color: "Blanco", retailPrice: 45_000, stock: 4 });
    await turno(cfgAslc(), [call("search_products", { query: "Lámpara QA Mesa" }), { text: "Esta es la lámpara de mesa." }], "busco Lámpara QA Mesa");
    const r = await turno(cfgAslc(), [call("similar_products", { reference: a.reference }), { text: "Mira esta otra." }], "¿tienes algo parecido?");
    const out = JSON.stringify(salidas(r.provider.requests.at(-1)!));
    assert.ok(out.includes(b.reference) && out.includes("Lámpara QA Techo"), "ofrece el parecido");
    assert.ok(!out.includes(`"reference":"${a.reference}"`), "no se ofrece a sí mismo");
  });

  it("variantes (color / referencia): cada una es un producto con su color y su referencia; se buscan por color", async () => {
    const rojo = await conFoto(A, { name: "Bolso QA", color: "Rojo", retailPrice: 70_000, stock: 2 });
    const azul = await conFoto(A, { name: "Bolso QA", color: "Azul", retailPrice: 70_000, stock: 2 });
    const r = await turno(cfgAslc(), [call("search_products", { query: "Bolso QA", color: "Azul" }), { text: "Lo tengo en azul." }], "busco el Bolso QA en azul");
    const out = JSON.stringify(salidas(r.provider.requests.at(-1)!));
    assert.ok(out.includes(azul.reference) && !out.includes(rojo.reference));
  });

  it("el catálogo y las fotos de un negocio NO aparecen en otro, y el alta masiva existe (módulo reutilizable, no una carga especial)", async () => {
    await conFoto(D, { name: "Producto exclusivo de Delacour", retailPrice: 99_000, stock: 5 });
    const lista = await admin.listProducts(A, { q: "exclusivo", status: "ALL", page: 1, pageSize: 20 } as never);
    assert.equal(lista.items.length, 0);
    // Alta masiva (planilla XLSX/CSV + fotos): Dashboard → Catálogo → Carga masiva. El módulo existe y se usa tal cual para los productos reales.
    for (const archivo of ["lib/catalogo/import/servicio.ts", "lib/catalogo/import/planilla.ts", "lib/catalogo/import/README.md"]) assert.ok(readFileSync(join(process.cwd(), archivo), "utf8").length > 100, archivo);
  });
});
