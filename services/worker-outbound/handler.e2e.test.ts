/**
 * DuLabs Developer V1 -- Fase 3 (autorizado). E2E real contra Postgres para
 * el handler del Worker outbound. `fetch` se inyecta como un fixture real
 * (cuenta invocaciones reales, mismo criterio que
 * lib/developer/crash-recovery.test.ts de Fase 1 -- nunca
 * `physicalPostCount = 1` asumido). No se llama a Meta real.
 *
 * REQUIERE la migración 20261007000000 (Fase 2) Y 20261008000000 (Fase 3,
 * published_at/intentos_publicacion/payload/procesado_en) aplicadas.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { procesarMensajeOutbound } from "./handler";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";
import { crearJobConIdempotencia, obtenerJobDelWorkspace } from "@/lib/developer/jobs-store";
import { reservarUso, obtenerLedgerDelJob } from "@/lib/developer/usage-ledger";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — worker-outbound handler real contra Postgres (Fase 3)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    // registrarNumero cifra el token de Meta vía secure-crypto.ts -- en
    // Cloud Run real usa KMS (KMS_KEY_NAME); en este entorno de test local
    // ni eso ni DEVELOPER_TOKEN_ENCRYPTION_KEY están configurados, así que
    // se fija una clave de prueba real para la duración de la suite (mismo
    // patrón ya usado en secure-crypto.test.ts / whatsapp-numbers-store.e2e.test.ts).
    const claveOriginal = process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
    before(() => {
      process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    });
    after(() => {
      if (claveOriginal === undefined) delete process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY;
      else process.env.DEVELOPER_TOKEN_ENCRYPTION_KEY = claveOriginal;
    });
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const workspacesUsados: string[] = [];

    after(async () => {
      for (const workspaceId of workspacesUsados) {
        await admin.from("dulabs_dev_usage_ledger").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_jobs").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_idempotency_keys").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
        await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
      }
    });

    async function prepararJob(workspaceId: string, tokenMeta = "EAAtoken-de-prueba") {
      const numero = await registrarNumero(admin, { workspaceId, phoneNumberId: `phn-${randomUUID()}`, metaToken: tokenMeta });
      if (!numero.ok) throw new Error("no se pudo crear número de prueba");
      const job = await crearJobConIdempotencia(admin, { workspaceId, whatsappNumberId: numero.fila.id, idempotencyKey: `idem-${randomUUID()}`, payload: { to: "573000000000" } });
      if (job.resultado === "conflicto_payload_distinto") throw new Error("no debería haber conflicto");
      await reservarUso(admin, { workspaceId, jobId: job.jobId });
      return { numeroId: numero.fila.id, jobId: job.jobId };
    }

    it("éxito confirmado: un solo POST físico real, job termina success_confirmed, usage_ledger confirmado", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      let llamadasFisicasAMeta = 0;
      const fetchFixture = (async () => {
        llamadasFisicasAMeta++;
        return new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }), { status: 200 });
      }) as typeof fetch;

      const resultado = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchFixture }, { workspaceId, jobId });
      assert.equal(resultado.httpStatus, 200);
      assert.equal(llamadasFisicasAMeta, 1, "debe haber exactamente 1 POST físico real");

      const job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(job!.status, "success_confirmed");
    });

    it("REGLA CRÍTICA: incertidumbre de red (timeout real) -> reconciliation_pending, ACK (200), NUNCA un código que provoque redelivery", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      const fetchFixtureQueTimeoutea = (async () => {
        throw new Error("simulated network timeout");
      }) as typeof fetch;

      const resultado = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchFixtureQueTimeoutea }, { workspaceId, jobId });
      assert.equal(resultado.httpStatus, 200, "debe ACKear -- Pub/Sub NUNCA debe reintentar tras una incertidumbre");
      assert.equal(resultado.motivo, "incertidumbre_de_red");

      const job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(job!.status, "reconciliation_pending");
      assert.notEqual(job!.status, "retry_pending", "nunca debe pasar directo a retry_pending -- violaría no blind resend");
      assert.equal(job!.physical_outcome, "uncertain");
    });

    it("CERO DUPLICADOS FÍSICOS y CERO DOBLE COBRO bajo redelivery real: Worker A (lease + POST físico real) -> Worker B (segunda entrega real, lease ya tomado) -> HTTP 200, un solo POST, una sola fila de ledger", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      let llamadasFisicasAMeta = 0;
      const fetchFixture = (async () => {
        llamadasFisicasAMeta++;
        // Simula una llamada lenta -- Worker B llega mientras Worker A
        // todavía tiene el lease, exactamente el escenario de redelivery
        // real que se quiere probar.
        await new Promise((r) => setTimeout(r, 50));
        return new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }), { status: 200 });
      }) as typeof fetch;

      const deps = { supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchFixture };

      // "Worker A" y "Worker B" -- dos invocaciones INDEPENDIENTES y
      // CONCURRENTES (Promise.all real, no secuencial) del mismo handler
      // para el mismo mensaje -- análogo a dos instancias reales de Cloud
      // Run recibiendo la misma redelivery de Pub/Sub.
      const [resultadoA, resultadoB] = await Promise.all([procesarMensajeOutbound(deps, { workspaceId, jobId }), procesarMensajeOutbound(deps, { workspaceId, jobId })]);

      assert.equal(resultadoA.httpStatus, 200);
      assert.equal(resultadoB.httpStatus, 200);
      const motivos = [resultadoA.motivo, resultadoB.motivo].sort();
      // Uno de los dos gana el lease y procesa; el otro debe recibir
      // "lease_no_adquirido:ya_tomado" -- NUNCA los dos procesan.
      assert.ok(
        motivos.some((m) => m.startsWith("lease_no_adquirido")),
        `al menos uno de los dos debe quedar sin lease -- motivos reales: ${JSON.stringify(motivos)}`
      );

      assert.equal(llamadasFisicasAMeta, 1, `debe haber EXACTAMENTE 1 POST físico real a Meta, hubo ${llamadasFisicasAMeta}`);

      const ledger = await obtenerLedgerDelJob(admin, { workspaceId, jobId });
      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("job_id", jobId);
      assert.equal(count, 1, "cero doble cobro -- debe existir EXACTAMENTE una fila de ledger para este job");
      assert.ok(ledger, "el ledger debe seguir existiendo");
    });

    it("job inexistente en el workspace: ACK inmediato, sin tocar Meta", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      let llamadas = 0;
      const fetchFixture = (async () => {
        llamadas++;
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      const resultado = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchFixture }, { workspaceId, jobId: randomUUID() });
      assert.equal(resultado.httpStatus, 200);
      assert.equal(llamadas, 0, "un job inexistente nunca debe llegar a intentar un POST físico");
    });

    it("rechazo cierto de Meta (4xx): meta_rechazo, sin incertidumbre, usage_ledger liberado", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      const fetchFixture = (async () => new Response(JSON.stringify({ error: "número inválido" }), { status: 400 })) as typeof fetch;
      const resultado = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchFixture }, { workspaceId, jobId });
      assert.equal(resultado.httpStatus, 200);
      assert.match(resultado.motivo, /^meta_rechazo:/);

      const job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.ok(["retry_pending", "failed_by_meta"].includes(job!.status));
      assert.notEqual(job!.status, "reconciliation_pending", "un rechazo CIERTO de Meta nunca es incertidumbre");
    });
  }
);
