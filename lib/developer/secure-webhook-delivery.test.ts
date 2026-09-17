/**
 * DuLabs Developer V1 -- Fase 17 (17.1, SSRF IP pinning). Tests de
 * entregarWebhookSeguro: bloqueo de IPs internas con la política REAL
 * (metadata/RFC1918/loopback/IPv6/IPv4-mapped/rebinding multi-IP/IP literal),
 * y mecánica HTTP real contra un server local (200/302-no-seguido/500/timeout/
 * connection refused/headers+body enviados). Sin red externa.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { entregarWebhookSeguro, ErrorDestinoNoSeguro, type ResolverDns } from "./secure-webhook-delivery";

const resuelveA = (ips: { address: string; family: number }[]): ResolverDns => async () => ips;
const HDRS = { "Content-Type": "application/json" };

// ---- Bloqueo por IP (política REAL, sin conexión) ----
describe("Fase 17 -- entregarWebhookSeguro: bloqueo SSRF (política real)", () => {
  const casos: [string, { address: string; family: number }[]][] = [
    ["metadata 169.254.169.254", [{ address: "169.254.169.254", family: 4 }]],
    ["loopback 127.0.0.1", [{ address: "127.0.0.1", family: 4 }]],
    ["RFC1918 10.x", [{ address: "10.1.2.3", family: 4 }]],
    ["RFC1918 172.16.x", [{ address: "172.16.0.9", family: 4 }]],
    ["RFC1918 192.168.x", [{ address: "192.168.1.1", family: 4 }]],
    ["IPv6 loopback ::1", [{ address: "::1", family: 6 }]],
    ["IPv4-mapped a metadata", [{ address: "::ffff:169.254.169.254", family: 6 }]],
    ["rebinding multi-IP (pública + interna)", [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]],
  ];
  for (const [nombre, ips] of casos) {
    it(`bloquea ${nombre} -> ErrorDestinoNoSeguro (nunca conecta)`, async () => {
      await assert.rejects(
        entregarWebhookSeguro("https://rebind.attacker.tld/hook", { headers: HDRS, body: "{}", timeoutMs: 2000, resolver: resuelveA(ips) }),
        (e: unknown) => e instanceof ErrorDestinoNoSeguro,
      );
    });
  }

  it("bloquea una IP literal interna en la URL (no llega al lookup)", async () => {
    await assert.rejects(
      entregarWebhookSeguro("https://169.254.169.254/latest/meta-data/", { headers: HDRS, body: "{}", timeoutMs: 2000 }),
      (e: unknown) => e instanceof ErrorDestinoNoSeguro,
    );
  });

  it("bloquea protocolo no https (sin permitirHttp)", async () => {
    await assert.rejects(
      entregarWebhookSeguro("http://ok.example.com/", { headers: HDRS, body: "{}", timeoutMs: 2000, resolver: resuelveA([{ address: "93.184.216.34", family: 4 }]) }),
      (e: unknown) => e instanceof ErrorDestinoNoSeguro,
    );
  });

  it("propaga fallo de resolución DNS como error reintentable (no ErrorDestinoNoSeguro)", async () => {
    await assert.rejects(
      entregarWebhookSeguro("https://falla-dns.tld/", { headers: HDRS, body: "{}", timeoutMs: 2000, resolver: async () => { throw new Error("ENOTFOUND"); } }),
      (e: unknown) => e instanceof Error && !(e instanceof ErrorDestinoNoSeguro),
    );
  });
});

// ---- Mecánica HTTP real (server local; validarIp override para permitir loopback) ----
describe("Fase 17 -- entregarWebhookSeguro: mecánica HTTP (server local)", () => {
  let servidor: Server;
  let puerto = 0;
  let ultimoBody = "";
  let ultimoSig = "";
  let modo: "200" | "302" | "500" | "lento" = "200";
  let redirectHit = false;
  let redirServer: Server;
  let redirPuerto = 0;

  const permitirLoopback = () => null; // override: permite 127.0.0.1 SOLO en estos tests de mecánica

  before(async () => {
    redirServer = createServer((_r: IncomingMessage, res: ServerResponse) => { redirectHit = true; res.writeHead(200); res.end("pwned"); });
    await new Promise<void>((r) => redirServer.listen(0, "127.0.0.1", r));
    redirPuerto = (redirServer.address() as { port: number }).port;

    servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
      let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
        ultimoBody = b; ultimoSig = (req.headers["x-dulabs-signature"] as string) ?? "";
        if (modo === "302") { res.writeHead(302, { Location: `http://127.0.0.1:${redirPuerto}/pwned` }); res.end(); return; }
        if (modo === "500") { res.writeHead(500); res.end("boom"); return; }
        if (modo === "lento") { setTimeout(() => { res.writeHead(200); res.end("ok"); }, 2000); return; }
        res.writeHead(200); res.end("ok");
      });
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    puerto = (servidor.address() as { port: number }).port;
  });
  after(async () => { await new Promise<void>((r) => servidor.close(() => r())); await new Promise<void>((r) => redirServer.close(() => r())); });

  const entregarLocal = (opts: { timeoutMs?: number; puertoOverride?: number }) =>
    entregarWebhookSeguro(`http://webhook.test:${opts.puertoOverride ?? puerto}/hook`, {
      headers: { "Content-Type": "application/json", "X-DuLabs-Signature": "abc123" },
      body: JSON.stringify({ type: "webhook.ping" }),
      timeoutMs: opts.timeoutMs ?? 3000,
      permitirHttp: true,
      resolver: resuelveA([{ address: "127.0.0.1", family: 4 }]),
      validarIp: permitirLoopback,
    });

  it("200 -> ok:true y el server recibió body + firma", async () => {
    modo = "200";
    const r = await entregarLocal({});
    assert.equal(r.ok, true); assert.equal(r.status, 200);
    assert.equal(JSON.parse(ultimoBody).type, "webhook.ping");
    assert.equal(ultimoSig, "abc123");
  });

  it("302 -> NO se sigue el redirect (status 302, ok:false, el destino del Location nunca se golpea)", async () => {
    modo = "302"; redirectHit = false;
    const r = await entregarLocal({});
    assert.equal(r.status, 302); assert.equal(r.ok, false);
    assert.equal(redirectHit, false, "no debe seguir el redirect a otro host");
  });

  it("500 -> ok:false (reintentable lo decide el caller)", async () => {
    modo = "500";
    const r = await entregarLocal({});
    assert.equal(r.status, 500); assert.equal(r.ok, false);
  });

  it("timeout -> lanza Error('timeout') (reintentable, no ErrorDestinoNoSeguro)", async () => {
    modo = "lento";
    await assert.rejects(entregarLocal({ timeoutMs: 300 }), (e: unknown) => e instanceof Error && !(e instanceof ErrorDestinoNoSeguro));
  });

  it("connection refused -> lanza error reintentable (no ErrorDestinoNoSeguro)", async () => {
    modo = "200";
    // Puerto muy probablemente cerrado en loopback.
    await assert.rejects(entregarLocal({ puertoOverride: 1 }), (e: unknown) => e instanceof Error && !(e instanceof ErrorDestinoNoSeguro));
  });
});
