/**
 * Presentación Colombia de fecha/hora (bug 314: confirmación mostró 15:00 UTC
 * en vez de 10:00 COT). No toca persistencia ni lógica de citas.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TIMEZONE_COLOMBIA,
  esIsoDateTime,
  fechaColombiaDesdeIso,
  horaColombiaDesdeIso,
  presentarFechaHoraColombia,
} from "@/lib/timezone-colombia";
import { interpolateTemplate } from "@/lib/flow/message-interpolation";
import { buildAIRequest, buildAIExecutionContext } from "@/lib/flow/claude/claude-context-builder";
import { buildClaudeSystemPrompt } from "@/lib/flow/claude/claude-prompt-builder";
import type { AiNodeConfig } from "@/lib/flow/types";
import type { EffectDispatchRequest } from "@/lib/flow/executor-types";

const ISO_BUG_314 = "2026-10-09T15:00:00Z";
const PROPUESTA = "Encontré disponibilidad para {{servicio}}:\n\n📅 {{fecha}}\n🕒 {{hora}}\n👩 {{especialista}}\n\n¿Deseas este horario?";

const aiConfirmar: AiNodeConfig = {
  instruction:
    "La acción de agendar YA CORRIÓ y tienes su resultado real en citaId, status, especialista, servicio, fecha y hora.",
  mode: "respond",
};

function requestConInicio(inicio: string, extra: Record<string, unknown> = {}): EffectDispatchRequest {
  return {
    effectId: "fx-confirmar",
    executionRowId: "row-1",
    executionLogicalId: "exec-1",
    tenantId: "tenant-daniela",
    nodeId: "agendar__ai-confirmar",
    attempt: 1,
    kind: "ai",
    payload: {
      servicio: "semipermanente en manos",
      fecha: "2026-10-09",
      hora: "10:00",
      especialista: "Carla",
      citaId: 1470,
      status: "confirmada",
      inicio,
      fin: "2026-10-09T17:00:00Z",
      ...extra,
    },
  };
}

describe("hora visible Colombia — 15:00Z → 10:00 (bug 314)", () => {
  it("1. 2026-10-09T15:00:00Z → hora visible 10:00, nunca 15:00", () => {
    assert.equal(horaColombiaDesdeIso(ISO_BUG_314), "10:00");
    assert.notEqual(horaColombiaDesdeIso(ISO_BUG_314), "15:00");
    assert.equal(fechaColombiaDesdeIso(ISO_BUG_314), "2026-10-09");
  });

  it("acepta +00:00 igual que Z", () => {
    assert.equal(horaColombiaDesdeIso("2026-10-09T15:00:00+00:00"), "10:00");
  });

  it("15:00 Colombia almacenada como 20:00Z sigue mostrándose 15:00 (no rompe tardes)", () => {
    assert.equal(horaColombiaDesdeIso("2026-10-02T20:00:00Z"), "15:00");
  });

  it("en fecha de DST de EE.UU. Colombia sigue en -05 (10:00, no 09:00/11:00)", () => {
    assert.equal(horaColombiaDesdeIso("2026-03-08T15:00:00Z"), "10:00");
    assert.equal(horaColombiaDesdeIso("2026-11-01T15:00:00Z"), "10:00");
  });

  it("TIMEZONE es America/Bogota (misma zona que el adaptador)", () => {
    assert.equal(TIMEZONE_COLOMBIA, "America/Bogota");
  });

  it("no muta el string ISO de entrada", () => {
    const original = "2026-10-09T15:00:00Z";
    horaColombiaDesdeIso(original);
    assert.equal(original, "2026-10-09T15:00:00Z");
  });
});

describe("propuesta y confirmación usan la misma hora Colombia", () => {
  it("2. interpolación de propuesta con hora de slot-fill sigue en 10:00", () => {
    const texto = interpolateTemplate(PROPUESTA, {
      servicio: "semipermanente en manos",
      fecha: "2026-10-09",
      hora: "10:00",
      especialista: "Carla",
    });
    assert.match(texto, /🕒 10:00/);
    assert.doesNotMatch(texto, /15:00/);
  });

  it("si {{hora}} llegara como ISO-UTC, también se muestra 10:00", () => {
    const texto = interpolateTemplate("a las {{hora}}", { hora: ISO_BUG_314 });
    assert.equal(texto, "a las 10:00");
  });

  it("{{inicio}} ISO no muestra UTC al cliente", () => {
    const texto = interpolateTemplate("inicio {{inicio}}", { inicio: ISO_BUG_314 });
    assert.match(texto, /10:00/);
    assert.doesNotMatch(texto, /15:00/);
  });

  it("3. Claude (ai-confirmar) ve hora 10:00 y no el UTC 15:00", () => {
    const aiRequest = buildAIRequest({
      request: requestConInicio(ISO_BUG_314),
      ai: aiConfirmar,
      model: "test",
    });
    assert.equal(aiRequest.variables.hora, "10:00");
    assert.equal(aiRequest.variables.fecha, "2026-10-09");
    const dumped = JSON.stringify(aiRequest.variables);
    assert.equal(dumped.includes("15:00"), false, "no filtrar UTC 15:00 a Claude");
    assert.equal(dumped.includes("10:00"), true);

    const ctx = buildAIExecutionContext(aiRequest);
    const system = buildClaudeSystemPrompt(ctx);
    assert.match(system, /10:00/);
    assert.equal(system.includes("2026-10-09T15:00:00Z"), false);
    assert.equal(system.includes("T15:00"), false);
  });

  it("verifiedResults.inicio tampoco se muestra en UTC", () => {
    const aiRequest = buildAIRequest({
      request: requestConInicio(ISO_BUG_314, {
        __verifiedResults: [
          {
            verified: true,
            source: "agendar_cita_especialista",
            data: { citaId: 1470, inicio: ISO_BUG_314, status: "confirmada" },
          },
        ],
      }),
      ai: aiConfirmar,
      model: "test",
    });
    const dumped = JSON.stringify(aiRequest.verifiedResults);
    assert.equal(dumped.includes("T15:00"), false);
    assert.equal(dumped.includes("10:00"), true);
  });
});

describe("no altera el timestamp almacenado ni confirmaciones existentes", () => {
  it("4. el payload original conserva el ISO UTC", () => {
    const request = requestConInicio("2026-10-09T15:00:00+00:00");
    const isoOriginal = request.payload!.inicio;
    buildAIRequest({ request, ai: aiConfirmar, model: "test" });
    assert.equal(request.payload!.inicio, isoOriginal);
    assert.equal(esIsoDateTime(request.payload!.inicio), true);
  });

  it("presentarFechaHoraColombia no muta el objeto de entrada", () => {
    const raw = { inicio: ISO_BUG_314, hora: "10:00", fecha: "2026-10-09" };
    const presented = presentarFechaHoraColombia(raw) as Record<string, unknown>;
    assert.equal(raw.inicio, ISO_BUG_314);
    assert.equal(presented.hora, "10:00");
    assert.notEqual(presented.inicio, ISO_BUG_314);
  });

  it("5. interpolación de confirmaciones sin instante no cambia", () => {
    assert.equal(
      interpolateTemplate("🎉 Tu cita quedó confirmada. ¡Te esperamos!", { citaId: 1470 }),
      "🎉 Tu cita quedó confirmada. ¡Te esperamos!",
    );
    assert.equal(
      interpolateTemplate("Hola {{nombre}}, {{faltante}}.", { nombre: "Ana" }),
      "Hola Ana, .",
    );
  });
});
