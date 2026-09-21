/**
 * R3 — datos del cliente: reglas puras (lib/customer-data.ts). 100% offline.
 * Cubre: configuración válida/inválida, tipos, requerido/opcional, validación
 * de valores (autoridad del backend), validación que recibe el Flow Engine y la
 * lectura defensiva de la definición embebida en la acción de reserva.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerField } from "@/lib/agent-compiler/spec/types";
import { CUSTOMER_FIELD_TYPES } from "@/lib/agent-compiler/spec/types";
import { PROHIBITED_EVIDENCE_FIELDS } from "@/lib/flow/claude/claude-types";
import { validateQuestionValue } from "@/lib/flow/flow-engine";
import {
  MAX_CUSTOMER_FIELDS,
  RESERVED_FIELD_KEYS,
  askableFields,
  buildQuestionText,
  buildQuestionValidation,
  customerDataFingerprint,
  formatCustomerDataForEvent,
  parseCustomerFieldsJson,
  resolveCustomerData,
  toCompiledFields,
  validateCustomerFieldsConfig,
  validateFieldValue,
} from "@/lib/customer-data";

function campo(over: Partial<CustomerField> & Pick<CustomerField, "key" | "type">): CustomerField {
  return { label: over.key, required: false, enabled: true, scope: "customer", ...over };
}
const NOMBRE = campo({ key: "nombreCliente", type: "text", label: "Nombre", required: true });
const TELEFONO = campo({ key: "telefonoCliente", type: "phone", label: "Teléfono", required: true });
const CORREO = campo({ key: "correoCliente", type: "email", label: "Correo" });

describe("R3 customer-data — configuración (schema/reglas)", () => {
  it("1. una configuración válida (claves conocidas + personalizadas) no genera issues", () => {
    const fields = [NOMBRE, TELEFONO, CORREO, campo({ key: "edad", type: "number", label: "Edad" }), campo({ key: "mascota", type: "select", label: "Mascota", options: ["Perro", "Gato"] })];
    assert.deepEqual(validateCustomerFieldsConfig(fields), []);
  });

  it("2. rechaza clave inválida, reservada, repetida y tipo incompatible con clave conocida", () => {
    const msgs = (fields: CustomerField[]) => validateCustomerFieldsConfig(fields).map((i) => i.message).join(" | ");
    assert.match(msgs([campo({ key: "Edad Cliente", type: "text" })]), /no es válida/);
    assert.match(msgs([campo({ key: "1edad", type: "text" })]), /no es válida/);
    assert.match(msgs([campo({ key: "fecha", type: "text" })]), /reservada/);
    assert.match(msgs([campo({ key: "citaId", type: "text" })]), /reservada/);
    assert.match(msgs([campo({ key: "edad", type: "number" }), campo({ key: "edad", type: "number" })]), /repetida/);
    assert.match(msgs([campo({ key: "nombreCliente", type: "number" })]), /significado fijo/);
    assert.match(msgs([campo({ key: "telefonoCliente", type: "text" })]), /significado fijo/);
  });

  it("3. select exige >=2 opciones únicas (ignorando acentos/mayúsculas)", () => {
    const msgs = (opts?: string[]) => validateCustomerFieldsConfig([campo({ key: "tipo", type: "select", options: opts })]).map((i) => i.message).join(" | ");
    assert.match(msgs(undefined), /al menos 2 opciones/);
    assert.match(msgs(["Solo una"]), /al menos 2 opciones/);
    assert.match(msgs(["Sí", "si"]), /repetidas/);
    assert.equal(msgs(["Perro", "Gato"]), "");
  });

  it("4. tope de campos (hardening)", () => {
    const muchos = Array.from({ length: MAX_CUSTOMER_FIELDS + 1 }, (_, i) => campo({ key: `campo_${i}`, type: "text" }));
    assert.match(validateCustomerFieldsConfig(muchos).map((i) => i.message).join(" "), /Máximo/);
  });

  it("5. todo PROHIBITED_EVIDENCE_FIELDS está reservado (la IA no puede fabricar evidencia vía un campo)", () => {
    for (const k of PROHIBITED_EVIDENCE_FIELDS) assert.ok(RESERVED_FIELD_KEYS.has(k), `${k} debe estar reservado`);
  });

  it("6. los 8 tipos soportados coinciden con los que el Flow Engine sabe validar", () => {
    assert.deepEqual([...CUSTOMER_FIELD_TYPES], ["text", "phone", "email", "number", "date", "time", "select", "boolean"]);
    for (const type of CUSTOMER_FIELD_TYPES) {
      const v = buildQuestionValidation(campo({ key: "x", type, options: ["A", "B"] }));
      assert.ok(["text", "number", "email", "phone", "regex", "hora_colombia"].includes(v.kind), `${type} -> ${v.kind}`);
    }
  });

  it("7. askableFields excluye desactivados y los tomados del canal (teléfono)", () => {
    const fields = [NOMBRE, TELEFONO, campo({ key: "extra", type: "text", enabled: false })];
    assert.deepEqual(askableFields(fields).map((f) => f.key), ["nombreCliente"]);
  });

  it("8. toCompiledFields: solo activos, sin nota interna, sin plantillas {{}} en textos", () => {
    const out = toCompiledFields([
      { ...NOMBRE, description: "nota interna", question: "¿Cómo te llamas {{hoy}}?" },
      campo({ key: "off", type: "text", enabled: false }),
    ]);
    assert.equal(out.length, 1);
    assert.equal("description" in out[0]!, false);
    assert.equal(out[0]!.question, "¿Cómo te llamas hoy?");
  });
});

describe("R3 customer-data — validación de valores (autoridad del backend)", () => {
  it("9. text: sanea control chars, <>, espacios y aplica tope", () => {
    const MOTIVO = campo({ key: "motivo", type: "text", label: "Motivo" }); // texto libre (el nombre tiene su propia regla, ver 9b)
    const r = validateFieldValue(MOTIVO, "  Ana\n  <b>María</b>  ");
    assert.deepEqual(r, { ok: true, value: "Ana bMaría/b" });
    const largo = validateFieldValue(MOTIVO, "x".repeat(5000));
    assert.ok(largo.ok && largo.value.length === 200);
    assert.deepEqual(validateFieldValue(MOTIVO, "   "), { ok: false, reason: "vacio" });
    assert.deepEqual(validateFieldValue(MOTIVO, undefined), { ok: false, reason: "vacio" });
  });

  it("9b. nombreCliente: solo se acepta algo que PAREZCA un nombre (no una pregunta, ni dígitos, ni símbolos)", () => {
    for (const ok of ["Ana", "María José Pérez", "O'Brien", "Jean-Luc", "Ana P.", "Ñandú", "Ana!", "Pérez, Ana", "Ana 😊"]) assert.equal(validateFieldValue(NOMBRE, ok).ok, true, ok);
    for (const mal of ["¿Quién ganó el mundial?", "cuéntame un chiste?", "Ana 123", "a@b.com", "x".repeat(90)]) {
      assert.deepEqual(validateFieldValue(NOMBRE, mal), { ok: false, reason: "formato" }, mal);
    }
    // El motor aplica la MISMA regla al preguntar (re-pregunta en vez de aceptar cualquier cosa).
    const v = buildQuestionValidation(NOMBRE);
    assert.equal(v.kind, "regex");
    const re = new RegExp((v as { pattern: string }).pattern, (v as { flags?: string }).flags);
    assert.equal(re.test("Ana Pérez"), true);
    assert.equal(re.test("¿Quién ganó el mundial?"), false);
  });

  it("10. phone/email/number: normalizan o rechazan", () => {
    assert.deepEqual(validateFieldValue(TELEFONO, "+57 (300) 111-2233"), { ok: true, value: "+573001112233" });
    assert.deepEqual(validateFieldValue(TELEFONO, "abc"), { ok: false, reason: "formato" });
    assert.deepEqual(validateFieldValue(CORREO, "Ana@Correo.COM"), { ok: true, value: "ana@correo.com" });
    assert.deepEqual(validateFieldValue(CORREO, "no-es-correo"), { ok: false, reason: "formato" });
    const n = campo({ key: "edad", type: "number" });
    assert.deepEqual(validateFieldValue(n, "25,5"), { ok: true, value: "25.5" });
    assert.deepEqual(validateFieldValue(n, 30), { ok: true, value: "30" });
    assert.deepEqual(validateFieldValue(n, "veinte"), { ok: false, reason: "formato" });
  });

  it("11. date: acepta ISO y DD/MM/AAAA, rechaza fechas imposibles (31/02, bisiesto)", () => {
    const d = campo({ key: "nac", type: "date" });
    assert.deepEqual(validateFieldValue(d, "1990-05-07"), { ok: true, value: "1990-05-07" });
    assert.deepEqual(validateFieldValue(d, "7/5/1990"), { ok: true, value: "1990-05-07" });
    assert.deepEqual(validateFieldValue(d, "29-02-2024"), { ok: true, value: "2024-02-29" });
    assert.deepEqual(validateFieldValue(d, "31/02/2026"), { ok: false, reason: "formato" });
    assert.deepEqual(validateFieldValue(d, "29/02/2025"), { ok: false, reason: "formato" });
    assert.deepEqual(validateFieldValue(d, "mañana"), { ok: false, reason: "formato" });
  });

  it("12. time: HH:MM válido se normaliza; inválido se rechaza", () => {
    const h = campo({ key: "llegada", type: "time" });
    assert.deepEqual(validateFieldValue(h, "9:05"), { ok: true, value: "09:05" });
    assert.deepEqual(validateFieldValue(h, "25:00"), { ok: false, reason: "formato" });
  });

  it("13. select: tolerante a acentos/mayúsculas, devuelve la opción canónica; fuera de lista => opcion", () => {
    const s = campo({ key: "tipo", type: "select", options: ["Uñas acrílicas", "Pestañas"] });
    assert.deepEqual(validateFieldValue(s, "unas acrilicas"), { ok: true, value: "Uñas acrílicas" });
    assert.deepEqual(validateFieldValue(s, "PESTAÑAS"), { ok: true, value: "Pestañas" });
    assert.deepEqual(validateFieldValue(s, "cejas"), { ok: false, reason: "opcion" });
  });

  it("14. boolean: sí/no/yes/true/false; otro => formato", () => {
    const b = campo({ key: "primera_vez", type: "boolean" });
    for (const v of ["si", "Sí", "SI", "yes", "true"]) assert.deepEqual(validateFieldValue(b, v), { ok: true, value: "Sí" });
    for (const v of ["no", "No", "false"]) assert.deepEqual(validateFieldValue(b, v), { ok: true, value: "No" });
    assert.deepEqual(validateFieldValue(b, "quizás"), { ok: false, reason: "formato" });
  });
});

describe("R3 customer-data — validación que recibe el Flow Engine", () => {
  const acepta = (f: CustomerField, texto: string) => validateQuestionValue(buildQuestionValidation(f), texto, true).ok;

  it("15. select: el regex acepta con/sin acento y mayúsculas, y rechaza lo demás", () => {
    const s = campo({ key: "tipo", type: "select", options: ["Uñas acrílicas", "Pestañas"] });
    assert.equal(acepta(s, "Uñas acrílicas"), true);
    assert.equal(acepta(s, "unas acrilicas"), true);
    assert.equal(acepta(s, "PESTAÑAS"), true);
    assert.equal(acepta(s, "pestanas"), true);
    assert.equal(acepta(s, "cejas"), false);
    assert.equal(acepta(s, "Uñas acrílicas y más"), false, "el patrón está anclado");
  });

  it("16. opciones con caracteres de regex se escapan (nunca inyectan un patrón)", () => {
    const s = campo({ key: "tipo", type: "select", options: ["A+B", ".*"] });
    assert.equal(acepta(s, "A+B"), true);
    assert.equal(acepta(s, ".*"), true);
    assert.equal(acepta(s, "cualquier cosa"), false);
    assert.equal(acepta(s, "AAB"), false);
  });

  it("17. boolean/date/email/phone/number/time se validan con reglas reales del motor", () => {
    assert.equal(acepta(campo({ key: "b", type: "boolean" }), "sí"), true);
    assert.equal(acepta(campo({ key: "b", type: "boolean" }), "tal vez"), false);
    assert.equal(acepta(campo({ key: "d", type: "date" }), "07/05/1990"), true);
    assert.equal(acepta(campo({ key: "d", type: "date" }), "7 de mayo"), false);
    assert.equal(acepta(campo({ key: "e", type: "email" }), "a@b.co"), true);
    assert.equal(acepta(campo({ key: "e", type: "email" }), "a@b"), false);
    assert.equal(acepta(campo({ key: "p", type: "phone" }), "3001112233"), true);
    assert.equal(acepta(campo({ key: "p", type: "phone" }), "12"), false);
    assert.equal(acepta(campo({ key: "n", type: "number" }), "12"), true);
    assert.equal(acepta(campo({ key: "n", type: "number" }), "doce"), false);
    assert.equal(acepta(campo({ key: "h", type: "time" }), "3:30 pm"), true);
  });

  it("18. la pregunta usa la personalizada, la estándar de la clave conocida o una genérica; añade pista de formato", () => {
    assert.equal(buildQuestionText(NOMBRE), "¿Cuál es tu nombre?");
    assert.equal(buildQuestionText({ ...NOMBRE, question: "¿Con quién hablo?" }), "¿Con quién hablo?");
    assert.equal(buildQuestionText(campo({ key: "edad", type: "number", label: "Edad" })), "Por favor, indícame: Edad.");
    assert.match(buildQuestionText(campo({ key: "nac", type: "date", label: "Fecha" })), /DD\/MM\/AAAA/);
    assert.match(buildQuestionText(campo({ key: "t", type: "select", label: "Tipo", options: ["A", "B"] })), /\(A \/ B\)/);
    assert.match(buildQuestionText(campo({ key: "b", type: "boolean", label: "X" })), /\(Sí \/ No\)/);
  });
});

describe("R3 customer-data — resolveCustomerData (requeridos / opcionales / canal)", () => {
  it("19. campo requerido ausente => problems (no procede); presente => ok", () => {
    const falta = resolveCustomerData({ fields: [NOMBRE], values: {} });
    assert.equal(falta.ok, false);
    if (!falta.ok) assert.deepEqual(falta.problems, [{ key: "nombreCliente", label: "Nombre", reason: "vacio" }]);
    const ok = resolveCustomerData({ fields: [NOMBRE], values: { nombreCliente: " Ana " } });
    assert.ok(ok.ok && ok.nombre === "Ana");
  });

  it("20. campo opcional ausente o inválido NO bloquea y no se guarda", () => {
    const r = resolveCustomerData({ fields: [NOMBRE, CORREO], values: { nombreCliente: "Ana", correoCliente: "basura" } });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.correo, undefined);
      assert.deepEqual(r.entries.map((e) => e.key), ["nombreCliente"]);
    }
  });

  it("21. requerido inválido => problems con reason distinta de 'vacio'", () => {
    const r = resolveCustomerData({ fields: [{ ...CORREO, required: true }], values: { correoCliente: "x" } });
    assert.ok(!r.ok && r.problems[0]!.reason === "formato");
  });

  it("22. el teléfono de la clave conocida sale SIEMPRE del canal; el del payload (IA) se ignora", () => {
    const r = resolveCustomerData({ fields: [NOMBRE, TELEFONO], values: { nombreCliente: "Ana", telefonoCliente: "999999999" }, channelPhone: "573001112233" });
    assert.ok(r.ok && r.telefono === "573001112233");
    const sinCanal = resolveCustomerData({ fields: [TELEFONO], values: { telefonoCliente: "3001112233" }, channelPhone: undefined });
    assert.equal(sinCanal.ok, false, "requerido y sin canal: no se acepta el valor del payload");
  });

  it("22b. el valor del CANAL es de confianza: se sanea pero no se re-valida por formato (no bloquea reservas legítimas); vacío sí falla", () => {
    const raro = resolveCustomerData({ fields: [TELEFONO], values: {}, channelPhone: "  1234567890123456789@lid <x> " });
    assert.ok(raro.ok);
    if (raro.ok) assert.equal(raro.telefono, "1234567890123456789@lid x");
    const vacio = resolveCustomerData({ fields: [TELEFONO], values: {}, channelPhone: "   " });
    assert.ok(!vacio.ok && vacio.problems[0]!.reason === "vacio");
    const largo = resolveCustomerData({ fields: [TELEFONO], values: {}, channelPhone: "9".repeat(200) });
    assert.ok(largo.ok && largo.telefono!.length === 40, "tope de longitud");
  });

  it("23. campos desactivados se ignoran aunque sean requeridos", () => {
    const r = resolveCustomerData({ fields: [{ ...NOMBRE, enabled: false }], values: {} });
    assert.ok(r.ok && r.entries.length === 0);
  });

  it("24. formato del evento: una línea por dato, notas extra solo si no hay campo 'notas'; sin < >", () => {
    const entries = [
      { key: "nombreCliente", label: "Nombre", scope: "customer" as const, value: "Ana" },
      { key: "edad", label: "Edad", scope: "customer" as const, value: "30" },
    ];
    assert.equal(formatCustomerDataForEvent(entries), "Nombre: Ana\nEdad: 30");
    assert.equal(formatCustomerDataForEvent(entries, "Trae <script>"), "Nombre: Ana\nEdad: 30\nNotas: Trae script");
    const conNotas = [...entries, { key: "notas", label: "Notas", scope: "booking" as const, value: "Alergia" }];
    assert.equal(formatCustomerDataForEvent(conNotas, "otra nota"), "Nombre: Ana\nEdad: 30\nNotas: Alergia");
  });

  it("25. la huella cambia con los datos (mismo effectId + datos distintos => conflicto de idempotencia)", () => {
    const a = customerDataFingerprint([{ key: "nombreCliente", label: "N", scope: "customer", value: "Ana" }]);
    const b = customerDataFingerprint([{ key: "nombreCliente", label: "N", scope: "customer", value: "Eva" }]);
    assert.notEqual(a, b);
  });
});

describe("R3 customer-data — parseCustomerFieldsJson (definición embebida, fail-closed)", () => {
  it("26. ausente/vacía => sin campos (agente que no configura datos)", () => {
    assert.deepEqual(parseCustomerFieldsJson(undefined), { ok: true, fields: [] });
    assert.deepEqual(parseCustomerFieldsJson("  "), { ok: true, fields: [] });
  });

  it("27. JSON válido round-trip; corrupto / forma inválida / config inválida => ok:false", () => {
    const fields = toCompiledFields([NOMBRE, CORREO]);
    const p = parseCustomerFieldsJson(JSON.stringify(fields));
    assert.ok(p.ok && p.fields.length === 2);
    assert.equal(parseCustomerFieldsJson("{no es json").ok, false);
    assert.equal(parseCustomerFieldsJson(JSON.stringify({ a: 1 })).ok, false);
    assert.equal(parseCustomerFieldsJson(JSON.stringify([{ key: "fecha", label: "x", type: "text", required: true, enabled: true, scope: "customer" }])).ok, false, "clave reservada");
    assert.equal(parseCustomerFieldsJson(JSON.stringify([{ key: "x", label: "x", type: "hologram", required: true, enabled: true, scope: "customer" }])).ok, false, "tipo inválido");
  });
});
