/**
 * DuLabs Developer V1 -- Fase 16 (Security / Hardening). Tests adversariales de
 * los invariantes de seguridad y de las correcciones de esta fase:
 *   - SSRF: el guard bloquea metadata/RFC1918/loopback/IPv6/IPv4-mapped y
 *     rebinding multi-IP; permite destinos públicos.
 *   - SSRF por redirect (P1): el worker de entrega y el ping usan
 *     redirect:"manual" (nunca siguen 3xx hacia un destino no validado).
 *   - Firma de webhook saliente: replay (timestamp viejo), tampering (body
 *     alterado) y secreto equivocado se rechazan; una firma válida se acepta.
 *   - Endpoints de cron: rechazan sin secreto / con secreto equivocado (403)
 *     antes de tocar la DB.
 * Puros (sin red/DB): corren siempre en el manifiesto.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validarUrlWebhookSegura, type FuncionLookupDns } from "./ssrf-guard";
import { firmarEvento, verificarFirma } from "./webhook-signature";

const raiz = process.cwd();
const lookup = (ips: { address: string; family: number }[]): FuncionLookupDns => async () => ips;

describe("Fase 16 -- SSRF guard (adversarial)", () => {
  it("bloquea el endpoint de metadata de nube (169.254.169.254)", async () => {
    const r = await validarUrlWebhookSegura("https://metadata.attacker.tld/", { lookupFn: lookup([{ address: "169.254.169.254", family: 4 }]) });
    assert.equal(r.permitido, false);
  });

  it("bloquea RFC1918 y loopback resueltos por DNS", async () => {
    for (const ip of ["10.0.0.5", "172.16.9.9", "192.168.1.1", "127.0.0.1"]) {
      const r = await validarUrlWebhookSegura("https://host.attacker.tld/", { lookupFn: lookup([{ address: ip, family: 4 }]) });
      assert.equal(r.permitido, false, `debió bloquear ${ip}`);
    }
  });

  it("bloquea IPv6 loopback y IPv4-mapped a interno", async () => {
    const l1 = await validarUrlWebhookSegura("https://h.attacker.tld/", { lookupFn: lookup([{ address: "::1", family: 6 }]) });
    assert.equal(l1.permitido, false);
    const l2 = await validarUrlWebhookSegura("https://h.attacker.tld/", { lookupFn: lookup([{ address: "::ffff:169.254.169.254", family: 6 }]) });
    assert.equal(l2.permitido, false);
  });

  it("bloquea una IP literal interna escrita directo en la URL", async () => {
    const r = await validarUrlWebhookSegura("https://169.254.169.254/latest/meta-data/");
    assert.equal(r.permitido, false);
  });

  it("rebinding: si CUALQUIER IP resuelta es interna, rechaza (aunque otra sea pública)", async () => {
    const r = await validarUrlWebhookSegura("https://rebind.attacker.tld/", {
      lookupFn: lookup([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]),
    });
    assert.equal(r.permitido, false);
  });

  it("permite un destino público legítimo", async () => {
    const r = await validarUrlWebhookSegura("https://hooks.example.com/dl", { lookupFn: lookup([{ address: "93.184.216.34", family: 4 }]) });
    assert.equal(r.permitido, true);
  });

  it("rechaza esquemas no https (salvo http de test explícito)", async () => {
    const r = await validarUrlWebhookSegura("http://hooks.example.com/", { lookupFn: lookup([{ address: "93.184.216.34", family: 4 }]) });
    assert.equal(r.permitido, false);
  });
});

describe("Fase 16 -- SSRF por redirect (P1): fetch nunca sigue 3xx", () => {
  it("el worker de entrega usa redirect:\"manual\"", () => {
    const src = readFileSync(path.join(raiz, "services/worker-inbound/handler.ts"), "utf8");
    // El bloque de fetch de entrega debe fijar redirect:"manual".
    assert.ok(/redirect:\s*["']manual["']/.test(src), "worker-inbound/handler.ts debe fijar redirect:\"manual\" en la entrega");
  });

  it("el ping de webhook usa redirect:\"manual\"", () => {
    const src = readFileSync(path.join(raiz, "app/api/developer/webhooks/ping/route.ts"), "utf8");
    assert.ok(/redirect:\s*["']manual["']/.test(src), "webhooks/ping debe fijar redirect:\"manual\"");
  });
});

describe("Fase 16 -- firma de webhook saliente (replay / tampering)", () => {
  const secreto = "whsec_" + "a".repeat(40);
  const cuerpo = JSON.stringify({ type: "message.received", event_id: "evt_1" });

  it("acepta una firma válida y reciente", () => {
    const { firma, timestamp } = firmarEvento(secreto, cuerpo);
    const r = verificarFirma({ secreto, cuerpoJsonCrudo: cuerpo, firmaRecibida: firma, timestampRecibido: timestamp });
    assert.equal(r.valido, true);
  });

  it("rechaza un evento reenviado fuera de la ventana (replay)", () => {
    const viejo = Math.floor(Date.now() / 1000) - 3600; // 1h atrás
    const { firma } = firmarEvento(secreto, cuerpo, viejo);
    const r = verificarFirma({ secreto, cuerpoJsonCrudo: cuerpo, firmaRecibida: firma, timestampRecibido: viejo });
    assert.equal(r.valido, false);
    assert.equal(r.valido === false && r.motivo, "timestamp_expirado");
  });

  it("rechaza un body alterado (tampering) con la misma firma", () => {
    const { firma, timestamp } = firmarEvento(secreto, cuerpo);
    const cuerpoAlterado = JSON.stringify({ type: "message.received", event_id: "evt_MALICIOSO" });
    const r = verificarFirma({ secreto, cuerpoJsonCrudo: cuerpoAlterado, firmaRecibida: firma, timestampRecibido: timestamp });
    assert.equal(r.valido, false);
    assert.equal(r.valido === false && r.motivo, "firma_invalida");
  });

  it("rechaza una firma hecha con otro secreto", () => {
    const { firma, timestamp } = firmarEvento("otro_secreto_distinto", cuerpo);
    const r = verificarFirma({ secreto, cuerpoJsonCrudo: cuerpo, firmaRecibida: firma, timestampRecibido: timestamp });
    assert.equal(r.valido, false);
  });

  it("no crashea con una firma de longitud inválida (la trata como inválida)", () => {
    const { timestamp } = firmarEvento(secreto, cuerpo);
    const r = verificarFirma({ secreto, cuerpoJsonCrudo: cuerpo, firmaRecibida: "deadbeef", timestampRecibido: timestamp });
    assert.equal(r.valido, false);
  });
});

describe("Fase 16 -- endpoints de cron rechazan acceso no autorizado", () => {
  it("cobro-recurrente y retención responden 403 sin/ con secreto equivocado", async () => {
    const { NextRequest } = await import("next/server");
    const previo = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "secreto_correcto_de_prueba";
    try {
      const { POST: cobro } = await import("@/app/api/developer/billing/cobro-recurrente/route");
      const { POST: retencion } = await import("@/app/api/developer/maintenance/retencion/route");

      const reqSin = new NextRequest("http://local/api/developer/billing/cobro-recurrente", { method: "POST" });
      assert.equal((await cobro(reqSin)).status, 403, "cobro sin Authorization debe ser 403");

      const reqMal = new NextRequest("http://local/api/developer/maintenance/retencion", {
        method: "POST",
        headers: { authorization: "Bearer secreto_equivocado" },
      });
      assert.equal((await retencion(reqMal)).status, 403, "retención con secreto equivocado debe ser 403");
    } finally {
      if (previo === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previo;
    }
  });
});
