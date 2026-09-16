/**
 * DuLabs Developer V1 -- Fase 4 (autorizado). E2E real contra Postgres
 * para GET /api/v1/usage -- lectura agregada sobre dulabs_dev_usage_ledger
 * (ya activo desde el cierre de Fase 3).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { manejarObtenerUso } from "./usage-handler";
import { manejarMensajeSaliente } from "./outbound-handler";
import { crearApiKey } from "@/lib/developer/api-keys-store";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — GET /api/v1/usage real contra Postgres (Fase 4)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_usage_ledger").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_jobs").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_idempotency_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_api_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    async function prepararWorkspace() {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const apiKey = await crearApiKey(admin, { workspaceId, name: "test" });
      const numero = await registrarNumero(admin, { workspaceId, phoneNumberId: `phn-${randomUUID()}` });
      if (!numero.ok) throw new Error("no se pudo crear número de prueba");
      return { workspaceId, claveEnClaro: apiKey.claveEnClaro, whatsappNumberId: numero.fila.id };
    }

    it("refleja una reserva real hecha vía POST /api/v1/messages", async () => {
      const { claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: async () => "x" },
        {
          autorizacion: `Bearer ${claveEnClaro}`,
          idempotencyKey: `idem-${randomUUID()}`,
          cuerpo: { whatsappNumberId, to: "573000000000", type: "text", text: { body: "hola" } },
          requestId: `req-${randomUUID()}`,
        }
      );

      const resultado = await manejarObtenerUso({ supabase: admin }, { autorizacion: `Bearer ${claveEnClaro}`, requestId: `req-${randomUUID()}` });
      assert.equal(resultado.status, 200);
      assert.equal(resultado.cuerpo.reserved, 1);
      assert.equal(resultado.cuerpo.confirmed, 0);
      assert.equal(resultado.cuerpo.released, 0);
      assert.equal((resultado.cuerpo as { price?: unknown }).price, undefined, "V1 nunca expone dinero/precio");
    });

    it("un workspace nunca ve el uso de otro", async () => {
      const { claveEnClaro: claveA, whatsappNumberId: numeroA } = await prepararWorkspace();
      const { claveEnClaro: claveB } = await prepararWorkspace();

      await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: async () => "x" },
        { autorizacion: `Bearer ${claveA}`, idempotencyKey: `idem-${randomUUID()}`, cuerpo: { whatsappNumberId: numeroA, to: "573000000000", type: "text", text: { body: "hola" } }, requestId: `req-${randomUUID()}` }
      );

      const comoB = await manejarObtenerUso({ supabase: admin }, { autorizacion: `Bearer ${claveB}`, requestId: `req-${randomUUID()}` });
      assert.equal(comoB.status, 200);
      assert.equal(comoB.cuerpo.reserved, 0, "workspace B no debe ver la reserva real de A");
    });

    it("fecha inválida en 'from'/'to' -> 400 invalid_request", async () => {
      const { claveEnClaro } = await prepararWorkspace();
      const resultado = await manejarObtenerUso({ supabase: admin }, { autorizacion: `Bearer ${claveEnClaro}`, desde: "no-es-una-fecha", requestId: `req-${randomUUID()}` });
      assert.equal(resultado.status, 400);
      assert.equal((resultado.cuerpo.error as { code: string }).code, "invalid_request");
    });
  }
);
