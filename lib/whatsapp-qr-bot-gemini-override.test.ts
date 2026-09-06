/**
 * resolverAiExecutorOverride (FASE B, autorizado, prueba controlada) --
 * verifica el gate de activación de Gemini para AMORE ANTES de que nada
 * real se despache: el override debe ser exclusivo del tenant AMORE
 * (ed6ae77f-8a0c-483e-a5d9-8ede68eca50f), reversible instantáneamente vía
 * `AMORE_IA_MOTOR=claude`, y nunca debe activarse si GEMINI_KEY no está
 * disponible (cae a Claude en vez de romper la conversación real de una
 * clienta). Nunca toca Supabase/red -- función pura sobre tenantId + env.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GeminiExecutor } from "@/lib/flow/executors/gemini-executor";
import { resolverAiExecutorOverride } from "@/lib/whatsapp-qr-bot";

const AMORE_TENANT_ID = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";
const DANIELA_TENANT_ID = "c64fac97-eff8-45f2-b691-30b3449da524";
const SOLOTALENTO_TENANT_ID = "11ccf0a3-726b-4d4b-9f7d-2deb8441d6a9";

describe("resolverAiExecutorOverride — Gemini SOLO para AMORE, nunca rollout global", () => {
  let prevKey: string | undefined;
  let prevMotor: string | undefined;

  beforeEach(() => {
    prevKey = process.env.GEMINI_KEY;
    prevMotor = process.env.AMORE_IA_MOTOR;
    process.env.GEMINI_KEY = "fake-key-para-test-nunca-real";
    delete process.env.AMORE_IA_MOTOR;
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.GEMINI_KEY;
    else process.env.GEMINI_KEY = prevKey;
    if (prevMotor === undefined) delete process.env.AMORE_IA_MOTOR;
    else process.env.AMORE_IA_MOTOR = prevMotor;
  });

  it("AMORE con GEMINI_KEY presente -> devuelve un GeminiExecutor", () => {
    const override = resolverAiExecutorOverride(AMORE_TENANT_ID);
    assert.ok(override instanceof GeminiExecutor);
  });

  it("Daniela nunca recibe el override, aunque GEMINI_KEY esté presente -- undefined (Claude, sin cambios)", () => {
    assert.equal(resolverAiExecutorOverride(DANIELA_TENANT_ID), undefined);
  });

  it("Solo Talento nunca recibe el override -- undefined (Claude, sin cambios)", () => {
    assert.equal(resolverAiExecutorOverride(SOLOTALENTO_TENANT_ID), undefined);
  });

  it("cualquier otro tenant futuro tampoco recibe el override -- solo el tenant_id exacto de AMORE lo activa", () => {
    assert.equal(resolverAiExecutorOverride("cualquier-otro-tenant-uuid"), undefined);
  });

  it("kill-switch AMORE_IA_MOTOR=claude desactiva Gemini instantáneamente para AMORE, sin tocar código", () => {
    process.env.AMORE_IA_MOTOR = "claude";
    assert.equal(resolverAiExecutorOverride(AMORE_TENANT_ID), undefined);
  });

  it("sin GEMINI_KEY -> cae a Claude (undefined) en vez de romper la conversación real de una clienta", () => {
    delete process.env.GEMINI_KEY;
    assert.equal(resolverAiExecutorOverride(AMORE_TENANT_ID), undefined);
  });

  it("GEMINI_KEY vacío ('') también cae a Claude -- nunca se trata un string vacío como clave válida", () => {
    process.env.GEMINI_KEY = "";
    assert.equal(resolverAiExecutorOverride(AMORE_TENANT_ID), undefined);
  });
});
