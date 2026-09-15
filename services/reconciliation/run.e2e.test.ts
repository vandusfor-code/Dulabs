/**
 * DuLabs Developer V1 -- Fase 3, cierre (riesgos #3 y #4 del reporte de
 * Fase 3). E2E real contra Postgres para dulabs-reconciliation:
 *
 *  - riesgo #3: un job en retry_pending (sin nada que lo republicara antes
 *    de esta corrección) es republicado por el barrido de reconciliación, y
 *    el Worker outbound real completa el segundo intento físico sin
 *    duplicar el primero.
 *  - riesgo #4: cuando reconciliación confirma contra Meta que un job
 *    incierto SÍ se envió, transiciona a success_confirmed (antes se
 *    dejaba sin mutar) y confirma el usage_ledger, sin ningún POST físico
 *    nuevo.
 *
 * `fetch`/`publicar` se inyectan como fixtures reales (cuentan
 * invocaciones reales) -- no se llama a Meta ni a Pub/Sub reales.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { procesarMensajeOutbound } from "../worker-outbound/handler";
import { ejecutarReconciliacion } from "./run";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";
import { crearJobConIdempotencia, obtenerJobDelWorkspace } from "@/lib/developer/jobs-store";
import { obtenerLedgerDelJob } from "@/lib/developer/usage-ledger";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — reconciliation real contra Postgres (Fase 3, cierre — riesgos #3 y #4)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
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

    async function prepararJob(workspaceId: string) {
      const numero = await registrarNumero(admin, { workspaceId, phoneNumberId: `phn-${randomUUID()}`, metaToken: "EAAtoken-de-prueba" });
      if (!numero.ok) throw new Error("no se pudo crear número de prueba");
      const job = await crearJobConIdempotencia(admin, { workspaceId, whatsappNumberId: numero.fila.id, idempotencyKey: `idem-${randomUUID()}`, payload: { to: "573000000000" } });
      if (job.resultado === "conflicto_payload_distinto") throw new Error("no debería haber conflicto");
      // Fase 3, cierre (hallazgo del usage_ledger) -- crearJobConIdempotencia
      // ya reserva internamente, no hace falta reservar acá aparte.
      return { numeroId: numero.fila.id, jobId: job.jobId, whatsappNumberId: numero.fila.id };
    }

    it("riesgo #3 -- un job en retry_pending (rechazo 4xx cierto de Meta con intentos disponibles) es republicado por el barrido y el Worker outbound real completa el segundo intento, sin duplicar el primero", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      let llamadasFisicasAMeta = 0;
      // Primer intento físico real -- Meta rechaza con un 4xx recuperable.
      const fetchRechazo = (async () => {
        llamadasFisicasAMeta++;
        return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
      }) as typeof fetch;
      const primerIntento = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchRechazo }, { workspaceId, jobId });
      assert.equal(primerIntento.httpStatus, 200);

      let jobTrasPrimerIntento = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(jobTrasPrimerIntento!.status, "retry_pending", "con intentos disponibles, un rechazo cierto debe dejarlo en retry_pending");

      // Barrido real de reconciliación -- ANTES de esta corrección, nada
      // republicaba este job; ahora reintentarOutbound() debe encontrarlo y
      // republicarlo (se inyecta `publicar` como fixture -- no se toca
      // Pub/Sub real).
      const republicaciones: Array<{ workspaceId: string; jobId: string }> = [];
      const publicarFixture: typeof import("../shared/pubsub").publicarMensaje = async (_topic, payload) => {
        republicaciones.push(payload as { workspaceId: string; jobId: string });
        return "fake-message-id";
      };

      const resumen = await ejecutarReconciliacion({
        supabase: admin,
        metaGraphApiBaseUrl: "https://fixture.invalido",
        topicInbound: "dulabs-inbound",
        topicOutbound: "dulabs-outbound",
        publicar: publicarFixture,
      });

      const miReintento = resumen.reintentoOutbound.find((r) => r.jobId === jobId);
      assert.ok(miReintento, "el job debe aparecer en el resultado del barrido de reintento");
      assert.equal(miReintento!.resultado, "republicado");
      assert.ok(
        republicaciones.some((r) => r.jobId === jobId && r.workspaceId === workspaceId),
        "debe haberse publicado {workspaceId, jobId} -- EXACTAMENTE el mismo mensaje que publica el Gateway al crear un job"
      );

      // El "Worker outbound real" recibe ahora ese mensaje republicado
      // (simulado invocando el mismo handler real que procesaría el push) y
      // completa el SEGUNDO intento físico -- nunca un tercero, nunca
      // duplica el primero.
      const fetchExito = (async () => {
        llamadasFisicasAMeta++;
        return new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }), { status: 200 });
      }) as typeof fetch;
      const segundoIntento = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchExito }, { workspaceId, jobId });
      assert.equal(segundoIntento.httpStatus, 200);
      assert.equal(segundoIntento.motivo, "meta_confirmo_exito");

      const jobFinal = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(jobFinal!.status, "success_confirmed");
      assert.equal(jobFinal!.network_attempts, 2, "EXACTAMENTE 2 intentos físicos reales -- el primero rechazado, el segundo (tras el reintento republicado) exitoso");
      assert.equal(llamadasFisicasAMeta, 2, "nunca más de 2 llamadas físicas reales a Meta en todo el flujo");
    });

    it("riesgo #3 -- republicar dos veces seguidas el MISMO job en retry_pending (dos pasadas del barrido antes de que el Worker procese) sigue produciendo EXACTAMENTE 1 intento físico real cuando ambos mensajes llegan", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      const fetchRechazo = (async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 })) as typeof fetch;
      await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchRechazo }, { workspaceId, jobId });

      const publicarFixture: typeof import("../shared/pubsub").publicarMensaje = async () => "fake-message-id";
      // Dos pasadas reales del barrido, como si el Job de reconciliación
      // corriera dos veces (cada 5 min) mientras el Worker sigue sin
      // procesar el reintento -- ambas republican, y eso es correcto y
      // aceptado (ver comentario en reintentarOutbound).
      await ejecutarReconciliacion({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", topicInbound: "dulabs-inbound", topicOutbound: "dulabs-outbound", publicar: publicarFixture });
      await ejecutarReconciliacion({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", topicInbound: "dulabs-inbound", topicOutbound: "dulabs-outbound", publicar: publicarFixture });

      let llamadasFisicasAMeta = 0;
      const fetchExito = (async () => {
        llamadasFisicasAMeta++;
        await new Promise((r) => setTimeout(r, 30));
        return new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }), { status: 200 });
      }) as typeof fetch;
      const deps = { supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchExito };

      // Dos entregas "reales" del mismo mensaje republicado (lease/CAS del
      // propio Worker es lo único que debe protegerlo -- mismo criterio ya
      // probado en worker-outbound/handler.e2e.test.ts).
      const [r1, r2] = await Promise.all([procesarMensajeOutbound(deps, { workspaceId, jobId }), procesarMensajeOutbound(deps, { workspaceId, jobId })]);
      assert.equal(r1.httpStatus, 200);
      assert.equal(r2.httpStatus, 200);
      assert.equal(llamadasFisicasAMeta, 1, `EXACTAMENTE 1 llamada física real pese a 2 republicaciones + 2 entregas, hubo ${llamadasFisicasAMeta}`);
    });

    it("riesgo #4 -- reconciliación confirma contra Meta que un job incierto SÍ se envió: transiciona a success_confirmed, confirma usage_ledger, CERO POST físico nuevo", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      let llamadasFisicasAMeta = 0;
      const fetchQueTimeoutea = (async () => {
        llamadasFisicasAMeta++;
        throw new Error("simulated network timeout");
      }) as typeof fetch;
      const incierto = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchQueTimeoutea }, { workspaceId, jobId });
      assert.equal(incierto.motivo, "incertidumbre_de_red");

      const jobIncierto = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(jobIncierto!.status, "reconciliation_pending");

      // consultarEstadoEnMeta hace un GET real (fixture) -- responde que SÍ
      // se envió. Ningún POST físico debe volver a ocurrir.
      const fetchConsultaMeta = (async () => new Response(JSON.stringify({ enviado: true }), { status: 200 })) as typeof fetch;
      const resumen = await ejecutarReconciliacion({
        supabase: admin,
        metaGraphApiBaseUrl: "https://fixture.invalido",
        topicInbound: "dulabs-inbound",
        topicOutbound: "dulabs-outbound",
        fetchImpl: fetchConsultaMeta,
        publicar: (async () => "fake-message-id") as typeof import("../shared/pubsub").publicarMensaje,
      });

      const miResultado = resumen.reconciliacionOutbound.find((r) => r.jobId === jobId);
      assert.ok(miResultado, "el job debe aparecer en el resultado de la reconciliación outbound");
      assert.equal(miResultado!.resultado, "confirmado_enviado");
      assert.equal(llamadasFisicasAMeta, 1, "sigue siendo 1 -- SOLO el intento original que dio incertidumbre, la reconciliación nunca hace un POST físico");

      const jobFinal = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(jobFinal!.status, "success_confirmed", "antes de esta corrección quedaba sin mutar para siempre");
      assert.equal(jobFinal!.physical_outcome, "success_confirmed");
      assert.equal(jobFinal!.network_attempts, 1, "networkAttempts no cambia -- no hubo un intento físico nuevo, solo una confirmación tardía");

      const ledger = await obtenerLedgerDelJob(admin, { workspaceId, jobId });
      assert.equal(ledger!.estado, "confirmado", "el usage_ledger debe confirmarse igual que en el camino de éxito síncrono (meta_confirmo_exito)");
    });

    it("regresión -- reconciliación confirma que Meta NO envió sigue funcionando igual que antes de esta corrección (solo se tocó la rama 'enviado')", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      const fetchQueTimeoutea = (async () => {
        throw new Error("simulated network timeout");
      }) as typeof fetch;
      await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchQueTimeoutea }, { workspaceId, jobId });

      const fetchConsultaMeta = (async () => new Response(JSON.stringify({ enviado: false }), { status: 200 })) as typeof fetch;
      const resumen = await ejecutarReconciliacion({
        supabase: admin,
        metaGraphApiBaseUrl: "https://fixture.invalido",
        topicInbound: "dulabs-inbound",
        topicOutbound: "dulabs-outbound",
        fetchImpl: fetchConsultaMeta,
        publicar: (async () => "fake-message-id") as typeof import("../shared/pubsub").publicarMensaje,
      });

      const miResultado = resumen.reconciliacionOutbound.find((r) => r.jobId === jobId);
      assert.equal(miResultado!.resultado, "confirmado_no_enviado");

      const jobFinal = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(jobFinal!.status, "retry_pending");
    });
  }
);
