/**
 * R4 — E2E de CADENA COMPLETA con conocimiento (offline, sin red/Supabase):
 *
 *   FAQ + PDF real (pdf-parse) -> extracción -> chunks -> store
 *   Spec(faq) -> compile -> draft validado -> publish -> resolver real
 *     -> atenderMensajeConBusinessAgent (boundary real: blacklist + gate + orquestador)
 *       -> Flow Engine real (cond/question/action/ai reales)
 *       -> InternalActionExecutor REAL -> buscar_conocimiento REAL -> retrieval REAL
 *
 * Fakes: el LLM (stub que redacta SOLO a partir de lo que recibe), el store de
 * conocimiento en memoria (la relevancia de Postgres se verifica en el E2E de la
 * BD), Nylas/calendario/idempotencia. Lo demás es el código real de producción.
 * El harness vive en ./testing/knowledge-harness.ts (compartido con el E2E real).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchRequest } from "@/lib/flow/executor-types";
import { InternalActionExecutor } from "@/lib/flow/executors/internal-action-executor";
import type { BusinessAgentSpec } from "@/lib/agent-compiler/spec/types";
import { salonSpec } from "@/lib/agent-compiler/runtime/fixtures";
import { createInMemoryKnowledgeStore } from "@/lib/business-agent-knowledge/testing/in-memory-knowledge-store";
import { createFaq, removeDocument, updateFaq, uploadDocument } from "@/lib/business-agent-knowledge/service";
import { KNOWLEDGE_LIMITS } from "@/lib/business-agent-knowledge/limits";
import { AUTHORIZER, CONV, NO_INFO, TENANT_A, TENANT_B, agenteFaq, caps, iaHonesta, mundo, tiendaConConocimiento } from "@/lib/agent-compiler/e2e/testing/knowledge-harness";

describe("R4 — E2E: FAQ + PDF por el runtime REAL del Business Agent", () => {
  it("1. criterio de éxito: '¿Cuál es el horario?' -> FAQ; '¿Qué dice la política sobre cancelaciones?' -> fragmento del PDF; sin info => NO inventa", async () => {
    const { store } = await tiendaConConocimiento(TENANT_A);
    const m = await mundo(store);
    m.setIA(iaHonesta);
    const a = await m.activar(agenteFaq(), TENANT_A);

    await a.turno("Hola", "w1"); // saludo (sin "?"): el flujo de siempre
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-need");
    assert.equal(m.acciones.length, 0, "sin búsqueda antes de una pregunta");

    await a.turno("¿Cuál es el horario?", "w2");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-faq-more", "respondió y quedó esperando la siguiente pregunta (bucle)");
    // Coincidencia exacta con una FAQ => se responde su texto TAL CUAL lo escribió el negocio y la IA ni se invoca.
    assert.ok(m.mensajes.includes("Lunes a viernes de 8 a 6."), JSON.stringify(m.mensajes));
    assert.equal(m.aiDe("ai-faq-present").length, 0, "FAQ exacta: sin IA (no puede adornar ni inventar)");

    await a.turno("¿Qué dice la política sobre cancelaciones?", "w3");
    assert.match(m.mensajes.join("\n"), /Según la información del negocio: [\s\S]*24 horas/, "fragmento del PDF");

    // Sin información: mensaje fijo y la IA NO se invoca (no puede inventar)
    const aiAntes = m.aiDe("ai-faq-present").length;
    await a.turno("¿Venden pizza con piña?", "w4");
    assert.ok(m.mensajes.includes(NO_INFO), "responde con el mensaje configurado");
    assert.equal(m.aiDe("ai-faq-present").length, aiAntes, "sin fragmentos relevantes la IA no se invoca");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-faq-more", "y la conversación sigue disponible");
  });

  it("2. la IA recibe SOLO los fragmentos relevantes (presupuesto), nunca el documento completo ni el base_conocimiento legacy", async () => {
    const { store } = await tiendaConConocimiento(TENANT_A);
    // Un documento GRANDE sobre otro tema: no debe aparecer en la respuesta de cancelaciones.
    const enorme = Array.from({ length: 400 }, (_, i) => `Sección ${i}: manual de la caja registradora, modelo ${i}. ` + "Instrucciones del equipo de sistemas. ".repeat(8)).join("\n\n");
    const grande = await uploadDocument(store, TENANT_A, { filename: "manual-caja.txt", mimeType: "text/plain", buffer: Buffer.from(enorme), userId: null });
    assert.ok(grande.ok);
    const m = await mundo(store);
    m.setIA(iaHonesta);
    const a = await m.activar(agenteFaq(), TENANT_A);
    await a.turno("¿Qué dice la política sobre cancelaciones?", "g1"); // pregunta directa: salta q-need
    const llamada = m.aiDe("ai-faq-present")[0]!;
    const texto = String(llamada.payload.conocimientoTexto);
    assert.match(texto, /24 horas/);
    assert.doesNotMatch(texto, /caja registradora/, "fragmentos de otro tema no llegan a la IA");
    assert.ok(texto.length <= KNOWLEDGE_LIMITS.resultsMaxChars + 200, `contexto ${texto.length} chars`);
    // el texto legacy gigante NO está en NINGUNA llamada de IA
    for (const call of m.aiCalls) {
      assert.equal(JSON.stringify(call.payload).includes("SECRETO-LEGACY"), false, `${call.nodeId} recibió el base_conocimiento legacy`);
      assert.equal("baseConocimiento" in call.payload, false);
    }
  });

  it("3. primer mensaje directo con '?': se responde YA (sin '¿qué necesitas hoy?'); una pregunta sin '?' entra por el flujo de siempre", async () => {
    const { store } = await tiendaConConocimiento(TENANT_A);
    const m = await mundo(store);
    m.setIA(iaHonesta);
    const a = await m.activar(agenteFaq(), TENANT_A);
    await a.turno("Hola, ¿dónde están ubicados?", "d1");
    assert.ok(m.mensajes.some((t) => t.startsWith("¡Hola! Soy")), "saluda");
    assert.ok(m.mensajes.some((t) => /Calle 10/.test(t)), "y responde la pregunta en el mismo turno");
    assert.equal(m.mensajes.includes("Cuéntame, ¿qué necesitas hoy?"), false, "no vuelve a preguntar qué necesita");
  });

  it("4. TENANT ISOLATION: B nunca obtiene el conocimiento de A, aunque haga la misma pregunta; cada uno recibe lo suyo", async () => {
    const store = createInMemoryKnowledgeStore();
    await tiendaConConocimiento(TENANT_A, store);
    await createFaq(store, TENANT_B, { question: "¿Cuál es el horario?", answer: "Solo abrimos los domingos." });
    const m = await mundo(store);
    m.setIA(iaHonesta);
    const a = await m.activar(agenteFaq(), TENANT_A);
    const b = await m.activar(agenteFaq(), TENANT_B);

    await b.turno("¿Cuál es el horario?", "b1");
    assert.ok(m.mensajes.some((t) => /Solo abrimos los domingos/.test(t)));
    assert.equal(m.mensajes.some((t) => /Lunes a viernes/.test(t)), false, "B no ve el horario de A");

    const antes = m.mensajes.length;
    await b.turno("¿Qué dice la política sobre cancelaciones?", "b2");
    assert.equal(m.mensajes.slice(antes).some((t) => /24 horas/.test(t)), false, "B no ve el PDF de A");
    assert.ok(m.mensajes.slice(antes).includes(NO_INFO));

    await a.turno("¿Qué dice la política sobre cancelaciones?", "a1");
    assert.ok(m.mensajes.some((t) => /24 horas/.test(t)), "A sí ve su PDF");
    // las acciones de recuperación se ejecutaron con el tenant de CADA agente
    assert.deepEqual([...new Set(m.accionesDe("act-faq").map((r) => r.tenantId))].sort(), [TENANT_A, TENANT_B].sort());
  });

  it("5. documento ELIMINADO y FAQ desactivada dejan de aparecer en la conversación", async () => {
    const { store, docId, faqId } = await tiendaConConocimiento(TENANT_A);
    const m = await mundo(store);
    m.setIA(iaHonesta);
    const a = await m.activar(agenteFaq(), TENANT_A);
    await a.turno("Hola", "e0");
    await a.turno("¿Qué dice la política sobre cancelaciones?", "e1");
    assert.ok(m.mensajes.some((t) => /24 horas/.test(t)));

    await removeDocument(store, TENANT_A, docId);
    const antes = m.mensajes.length;
    await a.turno("¿Qué dice la política sobre cancelaciones?", "e2");
    assert.equal(m.mensajes.slice(antes).some((t) => /24 horas/.test(t)), false, "documento eliminado: no aparece");
    assert.ok(m.mensajes.slice(antes).includes(NO_INFO));

    await updateFaq(store, TENANT_A, faqId, { question: "¿Cuál es el horario?", answer: "Lunes a viernes de 8 a 6.", active: false });
    const antes2 = m.mensajes.length;
    await a.turno("¿Cuál es el horario?", "e3");
    assert.equal(m.mensajes.slice(antes2).some((t) => /Lunes a viernes/.test(t)), false, "FAQ desactivada: no aparece");
  });

  it("6. SIN conocimiento configurado: no inventa (mensaje fijo, IA no invocada); con política 'handoff' transfiere a una persona", async () => {
    const m = await mundo(createInMemoryKnowledgeStore());
    m.setIA(iaHonesta);
    const a = await m.activar(agenteFaq(), TENANT_A);
    await a.turno("¿Cuál es el horario?", "n1");
    assert.ok(m.mensajes.includes(NO_INFO));
    assert.equal(m.aiDe("ai-faq-present").length, 0, "la IA nunca se invocó: nada que inventar");

    const m2 = await mundo(createInMemoryKnowledgeStore());
    m2.setIA(iaHonesta);
    const b = await m2.activar(
      agenteFaq({
        capabilities: caps({ faq: true, humanHandoff: true }),
        handoff: { rules: [{ id: "h", description: "x", trigger: { kind: "agent_request" }, action: "TRANSFER_HUMAN" }], defaultPauseHours: 24 },
        knowledge: { authority: "secondary", documents: [], onNoAnswer: "handoff" },
      }),
      TENANT_A,
    );
    await b.turno("¿Cuál es el horario?", "n2");
    assert.ok(m2.mensajes.some((t) => /persona del equipo/.test(t)), "avisa que lo pasa a una persona");
    assert.equal(m2.aiDe("ai-faq-present").length, 0);
    assert.notEqual(m2.ejecucion(TENANT_A).status, "waiting_input", "ya no espera preguntas del bot: quedó en manos de una persona");
    // R5: la transferencia es REAL -- se pausó el chat de ESTA conversación (el webhook hace que la IA calle).
    assert.equal(m2.pausas.length, 1);
    assert.deepEqual(m2.pausas[0], { phoneNumberId: CONV.phoneNumberId, telefonoCliente: CONV.telefonoCliente, duracionMs: 24 * 3600 * 1000 });
    assert.equal(m2.accionesDe("act-handoff-faq").length, 1);
    assert.equal(m2.ejecucion(TENANT_A).status, "completed");
    // El agente SIN política 'handoff' no pausa nada.
    assert.equal(m.pausas.length, 0);
  });

  it("6b. si el filtro de afirmaciones externas BLOQUEA la respuesta de la IA, el cliente NO queda en silencio: mensaje seguro y la conversación sigue", async () => {
    const store = createInMemoryKnowledgeStore();
    // Respuesta legítima del negocio que el filtro heurístico bloquea (agendar + cita, sin capability verificada).
    await createFaq(store, TENANT_A, { question: "¿Cómo pido una cita?", answer: "Puedes agendar tu cita escribiéndonos por este chat." });
    await createFaq(store, TENANT_A, { question: "¿Cuál es el horario?", answer: "Lunes a viernes de 8 a 6." });
    const m = await mundo(store);
    m.setIA(iaHonesta);
    const a = await m.activar(agenteFaq(), TENANT_A);
    await a.turno("¿Cómo pido una cita?", "f1");
    // FAQ exacta => texto del negocio sin IA; el filtro de afirmaciones AÚN se aplica a ese texto (misma barrera).
    assert.equal(m.aiDe("ai-faq-present").length, 0, "FAQ exacta: la IA no se invoca");
    assert.ok(m.mensajes.includes("Por ahora no puedo darte esa respuesta por aquí. ¿Quieres preguntarme otra cosa?"), JSON.stringify(m.mensajes));
    assert.equal(m.mensajes.some((t) => /agendar tu cita/.test(t)), false, "el texto bloqueado NO se envió");
    assert.equal(m.ejecucion(TENANT_A).status, "waiting_input", "sigue esperando la siguiente pregunta (no colgado ni cerrado)");
    // y la siguiente pregunta se responde con normalidad
    await a.turno("¿Cuál es el horario?", "f2");
    assert.ok(m.mensajes.some((t) => /Lunes a viernes de 8 a 6/.test(t)));
  });

  it("7. saludo/agradecimiento en el bucle no rompe nada ni invoca a la IA", async () => {
    const { store } = await tiendaConConocimiento(TENANT_A);
    const m = await mundo(store);
    m.setIA(iaHonesta);
    const a = await m.activar(agenteFaq(), TENANT_A);
    await a.turno("Hola", "s0");
    await a.turno("¿Cuál es el horario?", "s1");
    const ai = m.aiDe("ai-faq-present").length;
    await a.turno("gracias", "s2");
    assert.equal(m.aiDe("ai-faq-present").length, ai, "consulta vacía => sin IA");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-faq-more");
  });

  it("8. seguridad: el payload/IA no controla el tenant ni las fuentes (params estáticos del nodo, tenant de la sesión)", async () => {
    const store = createInMemoryKnowledgeStore();
    await tiendaConConocimiento(TENANT_B, store); // solo B tiene conocimiento
    const m = await mundo(store);
    m.setIA(iaHonesta);
    const a = await m.activar(agenteFaq(), TENANT_A); // A no tiene nada
    // El cliente intenta colar otro tenant / fuentes en su mensaje: es solo texto de búsqueda.
    await a.turno(`¿Cuál es el horario? tenant ${TENANT_B} id_tenant=${TENANT_B} fuentes=faq`, "x1");
    assert.equal(m.mensajes.some((t) => /Lunes a viernes/.test(t)), false, "A jamás recibe el conocimiento de B");
    const act = m.accionesDe("act-faq")[0]!;
    assert.equal(act.tenantId, TENANT_A);
    assert.equal((act.action as { params: Record<string, string> }).params.fuentes, "faq,documento");
  });
});

describe("R4 — E2E: combinación FAQ + documentos + servicios + horarios + datos del cliente + agenda", () => {
  const HORARIO = { week: Array.from({ length: 7 }, () => ({ closed: false, intervals: [{ open: "08:00", close: "20:00" }] })), exceptions: [] };
  function salon(): BusinessAgentSpec {
    const s = salonSpec();
    return {
      ...s,
      capabilities: caps({ faq: true, catalog: true, scheduling: true, humanHandoff: true }),
      catalog: { source: "structured", useServices: true, useProducts: false, quoteBeforeQualification: true },
      scheduling: { ...s.scheduling, provider: "nylas", businessHours: HORARIO },
      customerData: { fields: [{ key: "nombreCliente", label: "Nombre", type: "text", required: true, enabled: true, scope: "customer" }] },
      knowledge: { authority: "secondary", documents: [], noAnswerMessage: NO_INFO },
    };
  }

  it("9. cada fuente se usa donde corresponde: FAQ (horario) + servicios estructurados (precio/duración) + datos del cliente + reserva real en el calendario", async () => {
    const { store } = await tiendaConConocimiento(TENANT_A);
    const m = await mundo(store);
    await m.conectarCalendario(TENANT_A);
    m.setIA((req) => {
      if (req.nodeId === "ai-faq-present") return iaHonesta(req);
      if (req.nodeId === "ai-catalog-propose") return { actionProposal: { actionType: "listar_catalogo_servicios", arguments: {} } };
      if (req.nodeId === "ai-avail-propose") return { actionProposal: { actionType: "buscar_disponibilidad_nylas_generico", arguments: { fecha: "2030-03-16", servicio: "Corte" } } };
      if (req.nodeId === "ai-book-propose") return { actionProposal: { actionType: "crear_cita_nylas_generico", arguments: { fecha: "2030-03-16", hora: "15:00", servicio: "Corte" } } };
      return { responseText: "ok" };
    });
    const a = await m.activar(salon(), TENANT_A);

    await a.turno("¿Cuál es el horario de atención?", "c1"); // pregunta directa: salta q-need
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-data:nombreCliente", "primero los datos del cliente (R3)");
    await a.turno("Ana Pérez", "c2");
    // FAQ respondida (R4) con lo del negocio, y luego el catálogo REAL (R1)
    assert.ok(m.mensajes.some((t) => /Lunes a viernes de 8 a 6/.test(t)), "FAQ");
    assert.equal(m.accionesDe("act-catalog").length, 1, "catálogo estructurado consultado por el runtime");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-catalog-choose");

    await a.turno("Corte", "c3");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-booking-when");
    await a.turno("El sábado", "c4");
    // R7: horarios reales (solo lectura) con la duración REAL del servicio; el cliente elige.
    assert.equal(m.accionesDe("act-avail").length, 1);
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-booking-pick");
    await a.turno("A las 3pm", "c5");

    // Reserva REAL (R2/R3): duración del servicio (45), horario y datos del cliente en el evento.
    assert.equal(m.eventos.length, 1);
    const ev = m.eventos[0]!;
    assert.equal(ev.title, "Corte -- Ana Pérez");
    assert.equal(ev.endUnix - ev.startUnix, 45 * 60, "duración REAL del servicio estructurado");
    assert.match(ev.description ?? "", /Nombre: Ana Pérez/);
    // el conocimiento (FAQ) no interfirió con el catálogo: la IA de catálogo no recibió fragmentos de FAQ como precios
    for (const c of m.aiDe("ai-catalog-present")) assert.equal("conocimientoTexto" in c.payload && /99 pesos/.test(String(c.payload.conocimientoTexto)), false);
    for (const c of m.aiCalls) assert.equal(JSON.stringify(c.payload).includes("SECRETO-LEGACY"), false);
  });

  it("10. un mensaje que NO es pregunta (agente con más estados) no recibe 'no tengo información': sigue al flujo comercial", async () => {
    const m = await mundo(createInMemoryKnowledgeStore());
    m.setIA((req) => (req.nodeId === "ai-catalog-propose" ? { actionProposal: { actionType: "listar_catalogo_servicios", arguments: {} } } : { responseText: "ok" }));
    const a = await m.activar(salon(), TENANT_A);
    await a.turno("Hola", "k1");
    await a.turno("Quiero agendar un corte", "k2"); // respuesta a q-need
    await a.turno("Ana Pérez", "k3"); // datos del cliente
    assert.equal(m.mensajes.includes(NO_INFO), false, "no era una pregunta: sin mensaje de 'no tengo información'");
    assert.equal(m.ejecucion(TENANT_A).current_node_id, "q-catalog-choose", "siguió al catálogo");
  });
});

describe("R4 — buscar_conocimiento: contrato de la acción", () => {
  async function ejecutar(over: { params?: Record<string, string>; payload?: Record<string, unknown>; tenantId?: string; fallar?: boolean }) {
    const store = createInMemoryKnowledgeStore();
    await tiendaConConocimiento(TENANT_A, store);
    await createFaq(store, TENANT_B, { question: "¿Cuál es el horario?", answer: "Solo domingos." });
    const ex = new InternalActionExecutor({
      supabase: {} as SupabaseClient,
      authorizer: AUTHORIZER,
      guardarLeadEnterprise: async () => ({ ok: false }) as never,
      activarPausaChat: async () => ({ ok: false }) as never,
      verificarDisponibilidad: async () => ({ disponible: false }) as never,
      sugerirHorariosLibres: async () => [] as never,
      crearCita: async () => ({ ok: false }) as never,
      readPausaUntil: async () => null,
      consultarDisponibilidadEspecialista: async () => ({ disponible: false }) as never,
      validarServicioEspecialista: async () => ({ ok: false }) as never,
      agendarCitaEspecialista: async () => ({ ok: false }) as never,
      cancelarCitaEspecialista: async () => ({ ok: false }) as never,
      consultarCitasActivasEspecialista: async () => ({ ok: false }) as never,
      moverCitaEspecialista: async () => ({ ok: false }) as never,
      listarHorariosDisponiblesEspecialista: async () => ({ ok: false }) as never,
      createKnowledgeStore: () => (over.fallar ? { search: async () => { throw new Error("db caída"); } } : store),
    });
    return ex.dispatch(
      {
        effectId: "e1", executionRowId: "x1", tenantId: over.tenantId ?? TENANT_A, nodeId: "act-faq", attempt: 1, kind: "action",
        action: { actionType: "buscar_conocimiento", ...(over.params ? { params: over.params } : {}) },
        payload: over.payload ?? {}, conversation: CONV,
      } as EffectDispatchRequest,
      { tenantId: over.tenantId ?? TENANT_A, internal: true },
    );
  }

  it("11. la consulta sale de user_request (más reciente) y, si no existe, de __firstMessageText", async () => {
    const r1 = await ejecutar({ payload: { user_request: "¿Cuál es el horario?", __firstMessageText: "Hola" } });
    assert.equal((r1.data as { conocimientoEncontrado: boolean }).conocimientoEncontrado, true);
    const r2 = await ejecutar({ payload: { __firstMessageText: "¿Dónde están ubicados?" } });
    assert.match(String((r2.data as { conocimientoTexto: string }).conocimientoTexto), /Calle 10/);
    const r3 = await ejecutar({ payload: {} });
    assert.equal((r3.data as { consultaVacia: boolean }).consultaVacia, true);
  });

  it("12. el tenant es SIEMPRE el de la solicitud: 'tenantId' en el payload se ignora", async () => {
    const r = await ejecutar({ tenantId: TENANT_B, payload: { user_request: "¿Cuál es el horario?", tenantId: TENANT_A, id_tenant: TENANT_A } });
    const txt = String((r.data as { conocimientoTexto: string }).conocimientoTexto);
    assert.match(txt, /Solo domingos/);
    assert.doesNotMatch(txt, /Lunes a viernes/);
  });

  it("13. fuentes: el param ESTÁTICO gana sobre el payload; faq-only nunca toca documentos", async () => {
    const soloFaq = await ejecutar({ params: { fuentes: "faq" }, payload: { user_request: "política cancelaciones", fuentes: "documento" } });
    assert.equal((soloFaq.data as { conocimientoEncontrado: boolean }).conocimientoEncontrado, false);
    const soloDocs = await ejecutar({ params: { fuentes: "documento" }, payload: { user_request: "política cancelaciones", fuentes: "faq" } });
    assert.equal((soloDocs.data as { conocimientoEncontrado: boolean }).conocimientoEncontrado, true);
    const basura = await ejecutar({ params: { fuentes: "secretos,admin" }, payload: { user_request: "¿Cuál es el horario?" } });
    assert.equal((basura.data as { conocimientoEncontrado: boolean }).conocimientoEncontrado, true, "fuentes inválidas se descartan y se usan las por defecto");
  });

  it("14. falla del store => rechazo RETRYABLE (el flujo sigue por su rama de fallo, nunca inventa); solo lectura y sin secretos", async () => {
    const r = await ejecutar({ fallar: true, payload: { user_request: "¿Cuál es el horario?" } });
    assert.equal(r.success, false);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE);
    assert.equal(r.error, "conocimiento_no_disponible");
    assert.doesNotMatch(JSON.stringify(r), /db caída/, "el error interno no se filtra");
  });
});
