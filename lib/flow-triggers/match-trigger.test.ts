import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchTrigger } from "@/lib/flow-triggers/match-trigger";
import type { IncomingEvent, RoutableTrigger, TriggerConfig } from "@/lib/flow-triggers/types";

const TENANT = "tenant-a";

function trigger(config: TriggerConfig, overrides: Partial<RoutableTrigger> = {}): RoutableTrigger {
  return {
    id: "trig-1",
    tenantId: TENANT,
    flowId: "flow-1",
    type: config.type,
    config,
    priority: 0,
    enabled: true,
    flowStatus: "published",
    ...overrides,
  };
}

function event(overrides: Partial<IncomingEvent> = {}): IncomingEvent {
  return {
    tenantId: TENANT,
    channel: "whatsapp",
    channelAccountId: "pn-1",
    contactId: "+573000000000",
    eventType: "message",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("matchTrigger — manual", () => {
  it("nunca coincide con ningún evento, ni siquiera uno diseñado para parecerse", () => {
    const t = trigger({ type: "manual" });
    assert.equal(matchTrigger(t, event({ eventType: "conversation_started" })), false);
    assert.equal(matchTrigger(t, event({ eventType: "message", message: { text: "hola" } })), false);
    assert.equal(matchTrigger(t, event({ eventType: "custom_event" })), false);
  });
});

describe("matchTrigger — conversation_started", () => {
  it("coincide solo con eventType conversation_started", () => {
    const t = trigger({ type: "conversation_started" });
    assert.equal(matchTrigger(t, event({ eventType: "conversation_started" })), true);
    assert.equal(matchTrigger(t, event({ eventType: "message", message: { text: "hola" } })), false);
  });
});

describe("matchTrigger — user_message (catch-all)", () => {
  it("coincide con CUALQUIER mensaje, sin importar el texto", () => {
    const t = trigger({ type: "user_message" });
    assert.equal(matchTrigger(t, event({ message: { text: "cualquier cosa" } })), true);
    assert.equal(matchTrigger(t, event({ message: undefined })), true, "incluso sin texto (ej. imagen)");
  });

  it("NO coincide con conversation_started ni custom_event", () => {
    const t = trigger({ type: "user_message" });
    assert.equal(matchTrigger(t, event({ eventType: "conversation_started" })), false);
    assert.equal(matchTrigger(t, event({ eventType: "custom_event" })), false);
  });
});

describe("matchTrigger — keyword (EXACT)", () => {
  const t = trigger({ type: "keyword", keywords: ["hola", "buenas"] });

  it("coincide con el mensaje completo exacto", () => {
    assert.equal(matchTrigger(t, event({ message: { text: "hola" } })), true);
  });

  it("NO coincide si el mensaje trae texto adicional", () => {
    assert.equal(matchTrigger(t, event({ message: { text: "hola necesito información" } })), false);
  });

  it("case insensitive", () => {
    assert.equal(matchTrigger(t, event({ message: { text: "HOLA" } })), true);
  });

  it("normaliza acentos", () => {
    const conAcento = trigger({ type: "keyword", keywords: ["días"] });
    assert.equal(matchTrigger(conAcento, event({ message: { text: "dias" } })), true);
    assert.equal(matchTrigger(conAcento, event({ message: { text: "DÍAS" } })), true);
  });

  it("múltiples keywords -- coincide con cualquiera de la lista", () => {
    assert.equal(matchTrigger(t, event({ message: { text: "buenas" } })), true);
    assert.equal(matchTrigger(t, event({ message: { text: "adios" } })), false);
  });

  it("sin mensaje de texto -> nunca coincide", () => {
    assert.equal(matchTrigger(t, event({ message: undefined })), false);
    assert.equal(matchTrigger(t, event({ eventType: "conversation_started" })), false);
  });
});

describe("matchTrigger — message_contains (CONTAINS)", () => {
  const t = trigger({ type: "message_contains", keywords: ["hola"] });

  it("coincide si el mensaje contiene la keyword en cualquier parte", () => {
    assert.equal(matchTrigger(t, event({ message: { text: "hola necesito información" } })), true);
    assert.equal(matchTrigger(t, event({ message: { text: "buenas, hola!" } })), true);
  });

  it("NO coincide si no contiene la keyword", () => {
    assert.equal(matchTrigger(t, event({ message: { text: "buenas tardes" } })), false);
  });
});

describe("matchTrigger — message_starts_with (STARTS WITH)", () => {
  const t = trigger({ type: "message_starts_with", keywords: ["hola"] });

  it("coincide si el mensaje empieza con la keyword", () => {
    assert.equal(matchTrigger(t, event({ message: { text: "hola necesito información" } })), true);
  });

  it("NO coincide si la keyword aparece pero no al inicio", () => {
    assert.equal(matchTrigger(t, event({ message: { text: "buenas hola" } })), false);
  });
});

describe("matchTrigger — event", () => {
  it("coincide con custom_event + eventName exacto en metadata", () => {
    const t = trigger({ type: "event", eventName: "campaign_reply" });
    assert.equal(
      matchTrigger(t, event({ eventType: "custom_event", metadata: { eventName: "campaign_reply" } })),
      true,
    );
  });

  it("NO coincide con otro eventName ni con otros eventType", () => {
    const t = trigger({ type: "event", eventName: "campaign_reply" });
    assert.equal(matchTrigger(t, event({ eventType: "custom_event", metadata: { eventName: "otro" } })), false);
    assert.equal(matchTrigger(t, event({ eventType: "message", message: { text: "campaign_reply" } })), false);
  });
});
