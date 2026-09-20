/**
 * Anti-invención — barrera de fundamentación: lo que redacta la IA solo pasa si lo respaldan los datos del backend.
 * Puro (sin red/BD).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EFFECT_RESULT_CLASSIFICATIONS, type EffectDispatchResult } from "@/lib/flow/executor-types";
import type { AiNodeConfig } from "@/lib/flow/types";
import { applyAiGrounding, checkGrounding, planAiVerbatim } from "@/lib/flow/ai-runtime/ai-grounding";

const HORARIO = "[1] Pregunta frecuente: ¿Cuál es el horario?\nRespuesta: Lunes a viernes de 8 a 6.";
const DIRECCION = "[1] Pregunta frecuente: ¿Dónde están ubicados?\nRespuesta: Estamos en la Calle 10 #20-30, Bogotá.";
const POLITICA = 'Documento "politicas.pdf" (fragmento):\nLas citas pueden cancelarse sin costo hasta 24 horas antes. Si la cancelación es con menos de 24 horas se cobra el 50% del servicio.';

const ok = (r: string, f: string) => assert.deepEqual(checkGrounding(r, [f]), { ok: true }, `debía aceptar: ${r}`);
const no = (r: string, f: string, razon?: RegExp) => {
  const c = checkGrounding(r, [f]);
  assert.equal(c.ok, false, `debía rechazar: ${r}`);
  if (razon && !c.ok) assert.match(c.reason, razon);
};

describe("checkGrounding — acepta redacción fiel (aunque cambie las palabras)", () => {
  it("1. horario: paráfrasis, formato de hora distinto y prefijo de cortesía", () => {
    ok("Según la información del negocio: Lunes a viernes de 8 a 6.", HORARIO);
    ok("Nuestro horario de atención es de lunes a viernes de 8 a 6.", HORARIO);
    ok("Atendemos de lunes a viernes de 8:00 a 6:00.", HORARIO);
    ok("El horario es de lunes a viernes, de 8:00 a. m. a 6:00 p. m.", HORARIO);
  });
  it("2. dirección y política con cifras: respeta las cifras de la fuente", () => {
    ok("Estamos ubicados en la Calle 10 #20-30, Bogotá.", DIRECCION);
    ok("Puedes cancelar sin costo hasta 24 horas antes de tu cita. Con menos de 24 horas se cobra el 50% del servicio.", POLITICA);
  });
});

describe("checkGrounding — rechaza lo inventado", () => {
  it("3. precios/porcentajes/horas que la fuente no trae", () => {
    no("El corte cuesta $5.000.", HORARIO, /cifra_sin_respaldo/);
    no("Hoy tenemos 50% de descuento.", HORARIO, /cifra_sin_respaldo/);
    no("Atendemos de lunes a viernes de 8 a 7.", HORARIO, /cifra_sin_respaldo:7/);
    no("Se cobra el 30% del servicio.", POLITICA, /cifra_sin_respaldo:30/);
    no("Cuesta cinco mil pesos.", HORARIO, /cifra_sin_respaldo:cinco/);
  });
  it("4. promesas comerciales (descuento, domicilio, garantía, formas de pago) sin respaldo", () => {
    no("Hacemos domicilio sin costo.", HORARIO, /promesa_sin_respaldo:domic/);
    no("Damos garantía de por vida.", HORARIO, /promesa_sin_respaldo:garan/);
    no("Aceptamos todas las tarjetas.", HORARIO, /promesa_sin_respaldo/);
    no("Tenemos promociones esta semana.", HORARIO, /promesa_sin_respaldo:promo/);
    no("Aceptamos Bitcoin.", HORARIO, /promesa_sin_respaldo/);
  });
  it("5. un día o mes que la fuente no trae", () => {
    no("Abrimos de lunes a sábado de 8 a 6.", HORARIO, /promesa_sin_respaldo:sabad/);
    no("Estamos abiertos los domingos.", HORARIO, /promesa_sin_respaldo:domin/);
  });
  it("6. servicios o comodidades inventados (sin cifras ni palabras 'comerciales')", () => {
    no("También ofrecemos masajes relajantes y limpieza facial.", HORARIO, /terminos_sin_respaldo/);
    no("Tenemos parqueadero propio.", HORARIO, /terminos_sin_respaldo/);
  });
  it("7. enlaces y correos que la fuente no trae", () => {
    no("Escríbenos a ventas@ejemplo.com.", HORARIO, /enlace_sin_respaldo/);
    no("Visita www.ejemplo.com para más información.", HORARIO, /enlace_sin_respaldo/);
    ok("Escríbenos a ventas@ejemplo.com.", "Correo: ventas@ejemplo.com");
  });
  it("8. sin fuente => rechaza (nunca 'fundamenta' en el vacío)", () => {
    assert.deepEqual(checkGrounding("Cualquier cosa.", []), { ok: false, reason: "sin_fuente" });
    assert.deepEqual(checkGrounding("Cualquier cosa.", ["   "]), { ok: false, reason: "sin_fuente" });
  });
  it("9. numeración de lista (1. 2)) no cuenta como cifra", () => {
    ok("1. Lunes a viernes\n2) de 8 a 6", HORARIO);
  });
});

// ---------------------------------------------------------------------------
// Corpus realista: cómo redacta un modelo (tono amable, emojis, reformulación) vs. cómo inventa de forma sutil.
// Un rechazo de una respuesta legítima NO es grave (el cliente recibe el texto del negocio); una invención aceptada SÍ.
// ---------------------------------------------------------------------------

const FAQS_NEGOCIO = [
  "[1] Pregunta frecuente: ¿Cuánto cuesta el corte de cabello?\nRespuesta: El corte de cabello cuesta $35.000 y dura 45 minutos.",
  "[2] Pregunta frecuente: ¿Aceptan tarjeta?\nRespuesta: Aceptamos efectivo y transferencias por Nequi. No recibimos tarjetas.",
  HORARIO.replace("[1]", "[3]"),
].join("\n\n");

describe("checkGrounding — corpus realista de un modelo", () => {
  it("19. redacciones amables y fieles PASAN", () => {
    const legitimas = [
      "¡Claro! El corte de cabello cuesta $35.000 y dura 45 minutos. 😊 ¿Te ayudo con algo más?",
      "Nuestro horario de atención es de lunes a viernes de 8 a. m. a 6 p. m.",
      "Con gusto: aceptamos efectivo y transferencias por Nequi. Por ahora no recibimos tarjetas.",
      "El corte de cabello cuesta $35.000 y la duración es de 45 minutos.",
      "Atendemos de lunes a viernes, de 8:00 a 6:00.",
    ];
    for (const r of legitimas) ok(r, FAQS_NEGOCIO);
  });

  it("20. invenciones SUTILES (sin palabras de dominio evidentes) se RECHAZAN", () => {
    const invenciones = [
      "El corte de cabello cuesta $30.000 y dura 45 minutos.", // precio cambiado
      "El corte de cabello cuesta $35.000 y dura 30 minutos.", // duración cambiada
      "Aceptamos efectivo, Nequi y también Daviplata.", // método de pago inventado
      "Atendemos de lunes a viernes de 8 a 6 y los sábados hasta el mediodía.", // día inventado
      "El corte incluye lavado y masaje capilar.", // servicio inventado
      "Sí, aceptamos tarjetas de crédito y débito.", // contradice la fuente (tarjeta) -> 'aceptam'/'tarje' SÍ están en la fuente, cae por sábados/otros
    ];
    const rechazadas = invenciones.filter((r) => !checkGrounding(r, [FAQS_NEGOCIO]).ok);
    // Las cinco primeras DEBEN caer; la última contradice la fuente con sus mismas palabras (límite conocido: lo cubre
    // el respaldo verbatim de FAQ y el aviso al autor; una negación no se puede verificar solo con léxico).
    for (const r of invenciones.slice(0, 5)) assert.ok(rechazadas.includes(r), `debía rechazar: ${r}`);
  });
});

// ---------------------------------------------------------------------------
// Integración: planAiVerbatim + applyAiGrounding
// ---------------------------------------------------------------------------

const okResult = (responseText: string): EffectDispatchResult => ({
  success: true,
  classification: EFFECT_RESULT_CLASSIFICATIONS.SUCCESS,
  data: { responseText },
  appliedResult: { responseText },
});
const textoDe = (r: EffectDispatchResult) => (r.appliedResult as { responseText?: string } | undefined)?.responseText;

describe("planAiVerbatim — el texto del backend ES la respuesta y la IA no se invoca", () => {
  const ai: AiNodeConfig = { instruction: "x", mode: "respond", allowedTools: [], grounding: { verbatimFrom: "catalogoTexto" } };

  it("10. hay texto => resultado verbatim (éxito)", () => {
    const r = planAiVerbatim(ai, { catalogoTexto: "1️⃣ Corte — $35.000" });
    assert.ok(r && r.success);
    assert.equal(textoDe(r!), "1️⃣ Corte — $35.000");
  });
  it("11. la variable está vacía o ausente => falla cerrada (nunca habla la IA)", () => {
    for (const vars of [{}, { catalogoTexto: "" }, { catalogoTexto: "   " }]) {
      const r = planAiVerbatim(ai, vars);
      assert.ok(r && !r.success);
      assert.equal(r!.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
      assert.match(String(r!.error), /ungrounded_response:verbatim_source_missing/);
    }
  });
  it("12. con groundedIn y sin texto exacto => null (que redacte la IA, pero fundamentada)", () => {
    const faq: AiNodeConfig = { instruction: "x", mode: "respond", grounding: { verbatimFrom: "respuestaExacta", groundedIn: ["conocimientoTexto"] } };
    assert.equal(planAiVerbatim(faq, { respuestaExacta: "" }), null);
    assert.equal(textoDe(planAiVerbatim(faq, { respuestaExacta: "Lunes a viernes." })!), "Lunes a viernes.");
  });
  it("13. nodos sin `grounding` (todo Flow previo) o que no son 'respond': nunca se tocan", () => {
    assert.equal(planAiVerbatim({ instruction: "x", mode: "respond" }, { catalogoTexto: "a" }), null);
    assert.equal(planAiVerbatim({ ...ai, mode: "propose_action" }, { catalogoTexto: "a" }), null);
    assert.equal(planAiVerbatim(undefined, {}), null);
  });
});

describe("applyAiGrounding — lo que redactó la IA se valida contra las fuentes", () => {
  const ai: AiNodeConfig = {
    instruction: "x",
    mode: "respond",
    grounding: { verbatimFrom: "respuestaExacta", groundedIn: ["conocimientoTexto"], fallbackFrom: "respuestaDirecta" },
  };
  const vars = { conocimientoTexto: HORARIO, respuestaDirecta: "Lunes a viernes de 8 a 6.", respuestaExacta: "" };

  it("14. respuesta fiel => pasa tal cual", () => {
    const r = applyAiGrounding({ dispatchResult: okResult("Atendemos de lunes a viernes de 8 a 6."), ai, variables: vars });
    assert.ok(r.success);
    assert.equal(textoDe(r), "Atendemos de lunes a viernes de 8 a 6.");
  });
  it("15. respuesta inventada + respaldo del backend => se envía el texto del backend (no lo inventado)", () => {
    const r = applyAiGrounding({ dispatchResult: okResult("Hoy hay 50% de descuento y domicilio gratis."), ai, variables: vars });
    assert.ok(r.success);
    assert.equal(textoDe(r), "Lunes a viernes de 8 a 6.");
    assert.equal(r.metadata?.groundingFallback, true);
    assert.match(String(r.metadata?.groundingReason), /cifra_sin_respaldo|promesa_sin_respaldo/);
  });
  it("16. respuesta inventada SIN respaldo => rechazo (rama aiFailure) y el texto se descarta", () => {
    const sinRespaldo: AiNodeConfig = { instruction: "x", mode: "respond", grounding: { groundedIn: ["conocimientoTexto"] } };
    const r = applyAiGrounding({ dispatchResult: okResult("Hoy hay 50% de descuento."), ai: sinRespaldo, variables: vars });
    assert.equal(r.success, false);
    assert.equal(r.classification, EFFECT_RESULT_CLASSIFICATIONS.SECURITY_REJECTED);
    assert.match(String(r.error), /^ungrounded_response:/);
    assert.equal(textoDe(r), undefined, "el texto inventado no sobrevive en el resultado");
  });
  it("17. resultado verbatim ya es del backend => no se revalida; nodos sin grounding => intactos", () => {
    const verbatim = planAiVerbatim({ instruction: "x", mode: "respond", grounding: { verbatimFrom: "t" } }, { t: "Total: $102.000" })!;
    assert.equal(applyAiGrounding({ dispatchResult: verbatim, ai: { instruction: "x", mode: "respond", grounding: { verbatimFrom: "t" } }, variables: { t: "Total: $102.000" } }), verbatim);
    const libre = okResult("Cualquier cosa $1");
    assert.equal(applyAiGrounding({ dispatchResult: libre, ai: { instruction: "x", mode: "respond" }, variables: {} }), libre);
  });
  it("21. saludar por el NOMBRE DEL CLIENTE no es inventar; un nombre propio ajeno sí lo es", () => {
    const saludo = "Hola, Carolina. Atendemos de lunes a viernes de 8 a 6.";
    const conNombre = applyAiGrounding({ dispatchResult: okResult(saludo), ai, variables: { ...vars, customer_name: "Carolina" } });
    assert.equal(textoDe(conNombre), saludo, "el nombre que el cliente dio se permite");
    // El mismo texto SIN que ese nombre sea del cliente: se trata como dato inventado (cae al texto del backend).
    const sinNombre = applyAiGrounding({ dispatchResult: okResult(saludo), ai, variables: vars });
    assert.equal(textoDe(sinNombre), "Lunes a viernes de 8 a 6.");
    assert.match(String(sinNombre.metadata?.groundingReason), /nombre_propio_sin_respaldo:Carolina/);
  });
  it("18. un fallo previo del dispatch no se toca", () => {
    const fallo: EffectDispatchResult = { success: false, classification: EFFECT_RESULT_CLASSIFICATIONS.RETRYABLE, error: "x" };
    assert.equal(applyAiGrounding({ dispatchResult: fallo, ai, variables: vars }), fallo);
  });
});
