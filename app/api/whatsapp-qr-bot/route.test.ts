/**
 * Bot real para WhatsApp-QR (autorizado) — integración REAL contra
 * Supabase (tenants descartables, randomUUID, nunca AMORE/Daniela/Solo
 * Talento reales) de POST /api/whatsapp-qr-bot: el gate de autenticación
 * (mismo secreto compartido que ya usa el worker) y el caso real sin flow
 * publicado. NO se prueba acá la ejecución completa del flow (llamaría de
 * verdad a Claude) -- ese camino se verifica manualmente contra un flow
 * real publicado, ver el reporte final.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as botPOST } from "./route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const SECRETO = "prueba-secreto-whatsapp-qr-bot";

function req(body: unknown, bearer?: string): NextRequest {
  return new NextRequest("http://x/api/whatsapp-qr-bot", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(bearer !== undefined ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/whatsapp-qr-bot — integración real", { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" }, () => {
  let secretoOriginal: string | undefined;

  beforeEach(() => {
    secretoOriginal = process.env.WHATSAPP_WORKER_SECRET;
    process.env.WHATSAPP_WORKER_SECRET = SECRETO;
  });

  afterEach(() => {
    process.env.WHATSAPP_WORKER_SECRET = secretoOriginal;
  });

  it("sin Authorization: 401", async () => {
    const res = await botPOST(req({ idTenant: randomUUID(), telefono: "573000000000", texto: "hola", wamid: "1" }));
    assert.equal(res.status, 401);
  });

  it("Authorization con un secreto incorrecto: 401", async () => {
    const res = await botPOST(req({ idTenant: randomUUID(), telefono: "573000000000", texto: "hola", wamid: "1" }, "otra-cosa"));
    assert.equal(res.status, 401);
  });

  it("secreto correcto pero faltan campos: 400", async () => {
    const res = await botPOST(req({ idTenant: randomUUID() }, SECRETO));
    assert.equal(res.status, 400);
  });

  it("secreto correcto, tenant sin ningún flow publicado: 422 sin_flow_publicado", async () => {
    const idTenant = randomUUID(); // tenant descartable, nunca tuvo ningún flow
    const res = await botPOST(req({ idTenant, telefono: "573000000000", texto: "hola", wamid: randomUUID() }, SECRETO));
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.error, "sin_flow_publicado");
  });
});
