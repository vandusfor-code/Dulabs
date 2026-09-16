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
      // Fase 5 -- payload REAL y completo (type:"text", text:{body}) --
      // requerido por la validación defensiva nueva del Worker outbound
      // (parecePayloadValido) antes de mapear al shape real de Meta.
      const job = await crearJobConIdempotencia(admin, {
        workspaceId,
        whatsappNumberId: numero.fila.id,
        idempotencyKey: `idem-${randomUUID()}`,
        payload: { whatsappNumberId: numero.fila.id, to: "573000000000", type: "text", text: { body: "hola" } },
      });
      if (!("jobId" in job)) throw new Error("no debería haber conflicto ni límite excedido");
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

      const jobTrasPrimerIntento = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(jobTrasPrimerIntento!.status, "retry_pending", "con intentos disponibles, un rechazo cierto debe dejarlo en retry_pending");
      assert.ok(jobTrasPrimerIntento!.next_attempt_at, "Fase 5 (D6) -- debe quedar un backoff real fijado");

      // Fase 5 (D6) -- el backoff real (BACKOFF_REINTENTO_MS) todavía no
      // venció -- se simula que sí venció (mismo patrón ya usado para
      // locked_at/lease) en vez de esperar el tiempo real en el test.
      await admin.from("dulabs_dev_jobs").update({ next_attempt_at: new Date(Date.now() - 1_000).toISOString() }).eq("id", jobId);

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
      // Fase 5 -- el fixture usa un wamid corto de prueba ("wamid.OK"),
      // que no cumple el formato real mínimo -- el motivo queda como
      // meta_confirmo_exito_sin_wamid (no es lo que se prueba acá; esta
      // prueba es sobre el ciclo de reintento, no sobre captura de wamid,
      // ver worker-outbound/handler.e2e.test.ts para eso).
      assert.match(segundoIntento.motivo, /^meta_confirmo_exito/);

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

    // NOTA (Fase 6, decisión I): los antiguos tests "riesgo #4" (reconciliación
    // confirma enviado/no_enviado consultando a Meta con consultarEstadoEnMeta)
    // se ELIMINARON aquí. Esa función usaba un endpoint ficticio de Meta y el
    // UUID interno; fue removida. La resolución de reconciliation_pending ya
    // NO se hace por polling activo: llega de forma pasiva por los status
    // webhooks reales de Meta -> ver la cobertura en
    // services/worker-inbound/handler.e2e.test.ts ("reconciliation_pending ->
    // resolución por status webhook").

    it("Fase 6 (D2) -- una entrega inbound que quedó en 'fallido' con next_attempt_at vencido es republicada por el barrido reintentarEntregasInbound", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      // Se persiste un evento directamente en estado de entrega 'fallido'
      // vencido (no se simula todo el flujo inbound aquí -- eso lo cubre el
      // suite del worker inbound). Solo se prueba que el BARRIDO lo selecciona.
      const eventId = randomUUID();
      const { data: ev } = await admin
        .from("dulabs_dev_events")
        .insert({ event_id: eventId, workspace_id: workspaceId, tipo: "received", payload: { entry: [] }, entrega_estado: "fallido", entrega_intentos: 1, entrega_next_attempt_at: new Date(Date.now() - 1_000).toISOString() })
        .select("id")
        .single();

      const republicados: number[] = [];
      const publicarFixture: typeof import("../shared/pubsub").publicarMensaje = async (_t, payload) => {
        republicados.push((payload as { eventoId: number }).eventoId);
        return "fake-message-id";
      };

      const resumen = await ejecutarReconciliacion({ supabase: admin, topicInbound: "dulabs-inbound", topicOutbound: "dulabs-outbound", publicar: publicarFixture });
      assert.ok(resumen.reintentoEntrega.some((r) => r.eventoId === ev!.id && r.resultado === "republicado"), "el evento fallido y vencido debe aparecer republicado");
      assert.ok(republicados.includes(ev!.id), "debe republicarse {eventoId} a dulabs-inbound para que el worker reintente la entrega");

      await admin.from("dulabs_dev_events").delete().eq("workspace_id", workspaceId).then(() => {}, () => {});
    });
  }
);
