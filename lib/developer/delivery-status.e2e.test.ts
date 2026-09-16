/**
 * DuLabs Developer V1 -- Fase 6. E2E real contra Postgres de la correlación
 * de delivery_status por wamid (jobs-store::aplicarDeliveryStatus):
 * monotonicidad, semántica de `failed`, guarda por número y no-avance.
 * REQUIERE la migración 20261012000000 aplicada.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";
import { crearJobConIdempotencia, aplicarDeliveryStatus, obtenerJobDelWorkspace } from "@/lib/developer/jobs-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — delivery_status por wamid (Fase 6)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspaces: string[] = [];
    const claveOriginal = process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    before(() => { process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64"); });
    after(() => { if (claveOriginal === undefined) delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY; else process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveOriginal; });
    after(async () => {
      for (const ws of workspaces) {
        for (const t of ["dulabs_dev_usage_ledger", "dulabs_dev_jobs", "dulabs_dev_idempotency_keys", "dulabs_dev_whatsapp_numbers"]) {
          await admin.from(t).delete().eq("workspace_id", ws).then(() => {}, () => {});
        }
      }
    });

    async function jobConWamid(ws: string, wamid: string) {
      const numero = await registrarNumero(admin, { workspaceId: ws, phoneNumberId: `1055500${Math.floor(Math.random() * 1e6)}`, metaToken: "EAAtoken" });
      if (!numero.ok) throw new Error("num");
      const job = await crearJobConIdempotencia(admin, { workspaceId: ws, whatsappNumberId: numero.fila.id, idempotencyKey: `idem-${randomUUID()}`, payload: { whatsappNumberId: numero.fila.id, to: "573000000000", type: "text", text: { body: "x" } } });
      if (!("jobId" in job)) throw new Error("conflicto o límite excedido inesperado");
      await admin.from("dulabs_dev_jobs").update({ wamid }).eq("id", job.jobId);
      return { jobId: job.jobId, numeroId: numero.fila.id };
    }

    it("monotónico: sent -> delivered -> read avanza; un delivered posterior es no-op", async () => {
      const ws = randomUUID(); workspaces.push(ws);
      const wamid = "wamid." + randomUUID().replace(/-/g, "");
      const { jobId, numeroId } = await jobConWamid(ws, wamid);

      assert.equal((await aplicarDeliveryStatus(admin, { workspaceId: ws, whatsappNumberId: numeroId, wamid, status: "sent" })).aplicado, true);
      assert.equal((await aplicarDeliveryStatus(admin, { workspaceId: ws, whatsappNumberId: numeroId, wamid, status: "delivered" })).aplicado, true);
      assert.equal((await aplicarDeliveryStatus(admin, { workspaceId: ws, whatsappNumberId: numeroId, wamid, status: "read" })).aplicado, true);
      const atrasado = await aplicarDeliveryStatus(admin, { workspaceId: ws, whatsappNumberId: numeroId, wamid, status: "delivered" });
      assert.equal(atrasado.aplicado, false);
      if (!atrasado.aplicado) assert.equal(atrasado.motivo, "status_no_avanza");
      assert.equal((await obtenerJobDelWorkspace(admin, { workspaceId: ws, jobId }))!.delivery_status, "read");
    });

    it("failed aplica desde sin-status o 'sent', pero NUNCA pisa delivered/read", async () => {
      const ws = randomUUID(); workspaces.push(ws);
      // caso A: failed desde sin-status -> aplica
      const wamidA = "wamid." + randomUUID().replace(/-/g, "");
      const a = await jobConWamid(ws, wamidA);
      assert.equal((await aplicarDeliveryStatus(admin, { workspaceId: ws, whatsappNumberId: a.numeroId, wamid: wamidA, status: "failed" })).aplicado, true);
      assert.equal((await obtenerJobDelWorkspace(admin, { workspaceId: ws, jobId: a.jobId }))!.delivery_status, "failed");

      // caso B: delivered ya alcanzado -> failed NO pisa
      const wamidB = "wamid." + randomUUID().replace(/-/g, "");
      const b = await jobConWamid(ws, wamidB);
      await aplicarDeliveryStatus(admin, { workspaceId: ws, whatsappNumberId: b.numeroId, wamid: wamidB, status: "delivered" });
      const noPisa = await aplicarDeliveryStatus(admin, { workspaceId: ws, whatsappNumberId: b.numeroId, wamid: wamidB, status: "failed" });
      assert.equal(noPisa.aplicado, false);
      assert.equal((await obtenerJobDelWorkspace(admin, { workspaceId: ws, jobId: b.jobId }))!.delivery_status, "delivered", "un mensaje ya entregado no puede 'fallar' tardíamente");
    });

    it("guarda por número: un wamid del workspace correcto pero de OTRO número se rechaza (numero_no_coincide)", async () => {
      const ws = randomUUID(); workspaces.push(ws);
      const wamid = "wamid." + randomUUID().replace(/-/g, "");
      const { jobId } = await jobConWamid(ws, wamid);
      // otro número del mismo workspace
      const otro = await registrarNumero(admin, { workspaceId: ws, phoneNumberId: `1055500${Math.floor(Math.random() * 1e6)}`, metaToken: "EAAtoken" });
      if (!otro.ok) throw new Error("num");
      const r = await aplicarDeliveryStatus(admin, { workspaceId: ws, whatsappNumberId: otro.fila.id, wamid, status: "delivered" });
      assert.equal(r.aplicado, false);
      if (!r.aplicado) assert.equal(r.motivo, "numero_no_coincide");
      assert.equal((await obtenerJobDelWorkspace(admin, { workspaceId: ws, jobId }))!.delivery_status, null);
    });

    it("wamid inexistente -> job_no_encontrado_por_wamid (nunca lanza)", async () => {
      const ws = randomUUID(); workspaces.push(ws);
      const r = await aplicarDeliveryStatus(admin, { workspaceId: ws, whatsappNumberId: randomUUID(), wamid: "wamid.no-existe", status: "sent" });
      assert.equal(r.aplicado, false);
      if (!r.aplicado) assert.equal(r.motivo, "job_no_encontrado_por_wamid");
    });
  }
);
