import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validarUrlWebhookSegura } from "@/lib/developer/ssrf-guard";

describe("DuLabs Developer V1 — SSRF guard (Fase 1, sección 16)", () => {
  it("bloquea localhost/loopback (IP literal directa)", async () => {
    const r = await validarUrlWebhookSegura("https://127.0.0.1/webhook", { permitirHttp: true });
    assert.equal(r.permitido, false);
  });

  it("bloquea RFC1918 (10.x, 172.16-31.x, 192.168.x) por IP literal", async () => {
    for (const ip of ["10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.1.1"]) {
      const r = await validarUrlWebhookSegura(`https://${ip}/webhook`);
      assert.equal(r.permitido, false, `${ip} debería estar bloqueada`);
    }
  });

  it("bloquea el endpoint de metadata de nube (169.254.169.254, link-local)", async () => {
    const r = await validarUrlWebhookSegura("https://169.254.169.254/latest/meta-data/");
    assert.equal(r.permitido, false);
  });

  it("bloquea multicast y reservado", async () => {
    assert.equal((await validarUrlWebhookSegura("https://224.0.0.1/x")).permitido, false);
    assert.equal((await validarUrlWebhookSegura("https://240.0.0.1/x")).permitido, false);
  });

  it("bloquea equivalentes IPv6: loopback (::1), link-local (fe80::), unique-local (fd00::)", async () => {
    assert.equal((await validarUrlWebhookSegura("https://[::1]/webhook")).permitido, false);
    assert.equal((await validarUrlWebhookSegura("https://[fe80::1]/webhook")).permitido, false);
    assert.equal((await validarUrlWebhookSegura("https://[fd00::1]/webhook")).permitido, false);
  });

  it("bloquea IPv4-mapped en IPv6 (::ffff:127.0.0.1) -- no debe ser un bypass del chequeo IPv4", async () => {
    const r = await validarUrlWebhookSegura("https://[::ffff:127.0.0.1]/webhook");
    assert.equal(r.permitido, false);
  });

  it("permite una IP pública legítima", async () => {
    const r = await validarUrlWebhookSegura("https://8.8.8.8/webhook");
    assert.equal(r.permitido, true);
  });

  it("rechaza protocolo http en producción (solo https, salvo permitirHttp explícito para fixtures)", async () => {
    const r = await validarUrlWebhookSegura("http://8.8.8.8/webhook");
    assert.equal(r.permitido, false);
  });

  it("rechaza una URL con formato inválido sin lanzar", async () => {
    const r = await validarUrlWebhookSegura("no-es-una-url");
    assert.equal(r.permitido, false);
  });

  it(
    "DNS rebinding real: un hostname público legítimo que resuelve a una IP interna se bloquea igual " +
      "(la validación usa SIEMPRE la IP resuelta, nunca confía en que el hostname 'se ve' público)",
    async () => {
      // Resolver de prueba controlado -- simula exactamente el ataque real:
      // "webhook.developer-legitimo.com" es un hostname con apariencia
      // totalmente normal, pero su DNS (controlado por un atacante, o
      // envenenado) resuelve a una IP de la red interna.
      const lookupControlado = async (hostname: string) => {
        assert.equal(hostname, "webhook.developer-legitimo.com");
        return [{ address: "10.0.0.99", family: 4 }];
      };
      const r = await validarUrlWebhookSegura("https://webhook.developer-legitimo.com/hook", { lookupFn: lookupControlado });
      assert.equal(r.permitido, false);
      if (!r.permitido) assert.match(r.motivo, /10\.0\.0\.99/);
    }
  );

  it("DNS rebinding: si CUALQUIERA de varias IPs resueltas es interna, se bloquea (no solo la primera)", async () => {
    const lookupControlado = async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "192.168.1.1", family: 4 },
    ];
    const r = await validarUrlWebhookSegura("https://multi-ip.example.com/hook", { lookupFn: lookupControlado });
    assert.equal(r.permitido, false);
  });

  it("permite un hostname público cuyo DNS controlado resuelve a una IP pública real", async () => {
    const lookupControlado = async () => [{ address: "8.8.4.4", family: 4 }];
    const r = await validarUrlWebhookSegura("https://webhook.developer-legitimo.com/hook", { lookupFn: lookupControlado });
    assert.equal(r.permitido, true);
  });

  it("propaga un error de resolución DNS como 'no permitido', nunca lo trata como éxito", async () => {
    const lookupQueFalla = async () => {
      throw new Error("ENOTFOUND");
    };
    const r = await validarUrlWebhookSegura("https://no-existe.example.com/hook", { lookupFn: lookupQueFalla });
    assert.equal(r.permitido, false);
  });
});
