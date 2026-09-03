import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeTriggerConfig } from "@/lib/flow-triggers/describe-trigger";

describe("describeTriggerConfig", () => {
  it("conversation_started", () => {
    assert.equal(describeTriggerConfig({ type: "conversation_started" }), "Usuario inicia chat");
  });

  it("user_message", () => {
    assert.equal(describeTriggerConfig({ type: "user_message" }), "Cualquier mensaje");
  });

  it("keyword -- lista las keywords", () => {
    assert.equal(describeTriggerConfig({ type: "keyword", keywords: ["hola", "buenas"] }), "Keyword: hola, buenas");
  });

  it("message_contains", () => {
    assert.equal(describeTriggerConfig({ type: "message_contains", keywords: ["venta"] }), "Contiene: venta");
  });

  it("message_starts_with", () => {
    assert.equal(describeTriggerConfig({ type: "message_starts_with", keywords: ["hola"] }), "Empieza con: hola");
  });

  it("event", () => {
    assert.equal(describeTriggerConfig({ type: "event", eventName: "campaign_reply" }), "Evento: campaign_reply");
  });

  it("manual", () => {
    assert.equal(describeTriggerConfig({ type: "manual" }), "Manual");
  });
});
