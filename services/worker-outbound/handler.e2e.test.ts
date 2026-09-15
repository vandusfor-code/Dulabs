/**
 * DuLabs Developer V1 -- Fase 3 (autorizado), extendido en Fase 5
 * (autorizado, decisiones D2-D5, D7). E2E real contra Postgres para el
 * handler del Worker outbound. `fetch` se inyecta como un fixture real
 * (cuenta invocaciones reales, mismo criterio que
 * lib/developer/crash-recovery.test.ts de Fase 1 -- nunca
 * `physicalPostCount = 1` asumido). No se llama a Meta real (ver prueba
 * Meta real separada, fuera de la suite automatizada).
 *
 * REQUIERE la migración 20261011000000 (Fase 5, columna wamid) aplicada.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { procesarMensajeOutbound } from "./handler";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";
import { crearJobConIdempotencia, obtenerJobDelWorkspace, adquirirLease, aplicarEventoJob } from "@/lib/developer/jobs-store";
import { obtenerLedgerDelJob } from "@/lib/developer/usage-ledger";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — worker-outbound handler real contra Postgres (Fase 3/5)",
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

    // Fase 5 -- payload REAL y completo (type:"text", text:{body}) --
    // antes de Fase 5, este fixture usaba {to} solamente, un payload que
    // nunca hubiera sido válido contra el contrato real de Fase 4 ni
    // contra Meta. La validación defensiva nueva del Worker
    // (parecePayloadValido) lo rechazaría correctamente como corrupto.
    async function prepararJob(workspaceId: string, tokenMeta = "EAAtoken-de-prueba") {
      // phone_number_id REAL de Meta (numérico en la vida real) -- a propósito
      // DISTINTO del UUID interno (numero.fila.id) para poder demostrar que la
      // URL de Meta usa el phone_number_id y nunca el UUID.
      const phoneNumberId = `1055500${Math.floor(Math.random() * 1_000_000)}`;
      const numero = await registrarNumero(admin, { workspaceId, phoneNumberId, metaToken: tokenMeta });
      if (!numero.ok) throw new Error("no se pudo crear número de prueba");
      const job = await crearJobConIdempotencia(admin, {
        workspaceId,
        whatsappNumberId: numero.fila.id,
        idempotencyKey: `idem-${randomUUID()}`,
        payload: { whatsappNumberId: numero.fila.id, to: "573000000000", type: "text", text: { body: "hola" } },
      });
      if (job.resultado === "conflicto_payload_distinto") throw new Error("no debería haber conflicto");
      return { numeroId: numero.fila.id, jobId: job.jobId, phoneNumberId };
    }

    it("éxito confirmado: un solo POST físico real, payload REAL de Meta (messaging_product, sin whatsappNumberId), wamid capturado, usage_ledger confirmado", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId, numeroId, phoneNumberId } = await prepararJob(workspaceId);

      let llamadasFisicasAMeta = 0;
      let cuerpoEnviadoAMeta: unknown = null;
      let urlEnviadaAMeta = "";
      const fetchFixture = (async (url: string, init?: RequestInit) => {
        llamadasFisicasAMeta++;
        urlEnviadaAMeta = String(url);
        cuerpoEnviadoAMeta = JSON.parse(init!.body as string);
        return new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "wamid.HBgLNTczMDAwMDAwMDAVAgARGBI1QUQ5RTQ4RjQ0RjQ0RjQ0RjQA" }] }), { status: 200 });
      }) as typeof fetch;

      const resultado = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchFixture }, { workspaceId, jobId });
      assert.equal(resultado.httpStatus, 200);
      assert.equal(llamadasFisicasAMeta, 1, "debe haber exactamente 1 POST físico real");
      assert.equal(resultado.motivo, "meta_confirmo_exito");

      // Corrección crítica Fase 5 -- la URL de Meta usa el phone_number_id real, NUNCA el UUID interno.
      assert.ok(urlEnviadaAMeta.endsWith(`/${phoneNumberId}/messages`), `la URL de Meta debe terminar en /<phone_number_id>/messages -- fue: ${urlEnviadaAMeta}`);
      assert.ok(!urlEnviadaAMeta.includes(numeroId), `la URL de Meta NUNCA debe contener el UUID interno (${numeroId})`);

      // Fase 5, D2 -- el body REAL enviado a Meta debe tener el shape correcto.
      assert.deepEqual(cuerpoEnviadoAMeta, { messaging_product: "whatsapp", to: "573000000000", type: "text", text: { body: "hola" } });
      assert.equal((cuerpoEnviadoAMeta as Record<string, unknown>).whatsappNumberId, undefined, "whatsappNumberId NUNCA debe viajar en el body real a Meta");

      const job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(job!.status, "success_confirmed");
      // Fase 5, D4 -- wamid real capturado y persistido.
      assert.equal(job!.wamid, "wamid.HBgLNTczMDAwMDAwMDAVAgARGBI1QUQ5RTQ4RjQ0RjQ0RjQ0RjQA");

      const ledger = await obtenerLedgerDelJob(admin, { workspaceId, jobId });
      assert.equal(ledger!.estado, "confirmado");
    });

    it("CORRECCIÓN CRÍTICA (Fase 5) -- job.whatsapp_number_id = UUID interno -> lookup del número -> la URL de Meta usa el phone_number_id REAL, jamás el UUID interno", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId, numeroId, phoneNumberId } = await prepararJob(workspaceId);

      // Confirma la PREMISA del bug: el job efectivamente persiste el UUID
      // interno, y ese UUID es distinto del phone_number_id de Meta.
      const jobPre = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(jobPre!.whatsapp_number_id, numeroId, "premisa: el job guarda el UUID interno como whatsapp_number_id");
      assert.notEqual(numeroId, phoneNumberId, "premisa: UUID interno y phone_number_id son valores distintos");

      let urlEnviadaAMeta = "";
      const fetchFixture = (async (url: string) => {
        urlEnviadaAMeta = String(url);
        return new Response(JSON.stringify({ messages: [{ id: "wamid.URLCHECKOKOKOKOKOKOKOKOK" }] }), { status: 200 });
      }) as typeof fetch;

      const resultado = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://graph.facebook.test", fetchImpl: fetchFixture }, { workspaceId, jobId });
      assert.equal(resultado.httpStatus, 200);

      // LA aserción central de la corrección -- FALLA si la URL contiene el UUID interno.
      assert.equal(
        urlEnviadaAMeta,
        `https://graph.facebook.test/v21.0/${phoneNumberId}/messages`,
        `la URL de Meta debe construirse EXCLUSIVAMENTE con el phone_number_id real -- fue: ${urlEnviadaAMeta}`
      );
      assert.ok(!urlEnviadaAMeta.includes(numeroId), `la URL de Meta NUNCA debe contener el UUID interno (${numeroId}) -- fue: ${urlEnviadaAMeta}`);

      // El envío completó con éxito real usando el phone_number_id correcto.
      const job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(job!.status, "success_confirmed");
    });

    it("Fase 5, D4 -- Meta responde 2xx pero SIN wamid válido: se confirma igual (2xx real sigue siendo certeza), wamid queda null, motivo distinguible -- nunca se inventa un id", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      const fetchFixture = (async () => new Response(JSON.stringify({ messaging_product: "whatsapp" }), { status: 200 })) as typeof fetch; // sin "messages"

      const resultado = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchFixture }, { workspaceId, jobId });
      assert.equal(resultado.httpStatus, 200);
      assert.match(resultado.motivo, /^meta_confirmo_exito_sin_wamid:/, "debe quedar distinguible, nunca silencioso");

      const job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(job!.status, "success_confirmed", "un 2xx real de Meta sigue siendo certeza total, con o sin wamid");
      assert.equal(job!.wamid, null, "nunca se inventa un wamid");
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

    it("Fase 5, D5 -- 5xx de Meta sigue tratándose como incertidumbre (sin cambios de Fase 5, regresión)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);
      const fetchFixture = (async () => new Response(JSON.stringify({ error: { message: "internal", code: 1 } }), { status: 500 })) as typeof fetch;
      const resultado = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchFixture }, { workspaceId, jobId });
      assert.match(resultado.motivo, /^incertidumbre_por_5xx_meta:/);
      const job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(job!.status, "reconciliation_pending");
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
        return new Response(JSON.stringify({ messages: [{ id: "wamid.OKOKOKOKOKOKOKOKOKOKOKOK" }] }), { status: 200 });
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

    it("Fase 5, D5+D3 -- rechazo 4xx PERMANENTE de Meta (código 131026, número inválido): failed_by_meta directo aunque queden intentos, usage_ledger liberado", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      const fetchFixture = (async () => new Response(JSON.stringify({ error: { message: "recipient not a WhatsApp user", code: 131026 } }), { status: 400 })) as typeof fetch;
      const resultado = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchFixture }, { workspaceId, jobId });
      assert.equal(resultado.httpStatus, 200);
      assert.equal(resultado.motivo, "meta_rechazo:400:permanente");

      const job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(job!.status, "failed_by_meta", "permanente SIEMPRE va directo a failed_by_meta, aunque sea el primer intento (network_attempts=1 < MAX=2)");
      assert.equal(job!.network_attempts, 1);

      const ledger = await obtenerLedgerDelJob(admin, { workspaceId, jobId });
      assert.equal(ledger!.estado, "liberado", "un fallo terminal SÍ debe liberar la reserva");
    });

    it("Fase 5, D5+D3 -- rechazo 4xx RETRYABLE (código 130429, rate limit real de Meta) con intentos disponibles: retry_pending, usage_ledger SIGUE RESERVADO (no liberado)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      const fetchFixture = (async () => new Response(JSON.stringify({ error: { message: "rate limit hit", code: 130429 } }), { status: 429 })) as typeof fetch;
      const resultado = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchFixture }, { workspaceId, jobId });
      assert.equal(resultado.motivo, "meta_rechazo:429:retryable");

      const job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(job!.status, "retry_pending");
      assert.ok(job!.next_attempt_at, "Fase 5 D6 -- debe fijarse next_attempt_at al entrar en retry_pending");
      assert.ok(new Date(job!.next_attempt_at!).getTime() > Date.now(), "next_attempt_at debe ser en el futuro (backoff real)");

      // ESTE es el bug real que D3 corrige -- ANTES de Fase 5, liberarUso()
      // se llamaba incondicionalmente acá, dejando el ledger en "liberado"
      // para siempre aunque el job todavía pudiera reintentarse con éxito.
      const ledger = await obtenerLedgerDelJob(admin, { workspaceId, jobId });
      assert.equal(ledger!.estado, "reservado", "CORRECCIÓN D3: mientras el job siga siendo reintentable, la reserva debe mantenerse");
    });

    it("Fase 5, D3 -- ciclo completo: rechazo retryable -> retry_pending (reservado) -> reintento -> éxito -> usage CONFIRMADO (nunca liberado)", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      const fetchRechazo = (async () => new Response(JSON.stringify({ error: { message: "rate limit hit", code: 130429 } }), { status: 429 })) as typeof fetch;
      const primerIntento = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchRechazo }, { workspaceId, jobId });
      assert.equal(primerIntento.motivo, "meta_rechazo:429:retryable");
      assert.equal((await obtenerLedgerDelJob(admin, { workspaceId, jobId }))!.estado, "reservado");

      // Reintento real (simula lo que reintentarOutbound() -- Fase 3 cierre -- dispara).
      const fetchExito = (async () => new Response(JSON.stringify({ messages: [{ id: "wamid.SEGUNDOINTENTOOKOKOKOKOKOK" }] }), { status: 200 })) as typeof fetch;
      const segundoIntento = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchExito }, { workspaceId, jobId });
      assert.equal(segundoIntento.motivo, "meta_confirmo_exito");

      const job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(job!.status, "success_confirmed");
      assert.equal(job!.network_attempts, 2);
      assert.equal(job!.wamid, "wamid.SEGUNDOINTENTOOKOKOKOKOKOK");
      assert.equal(job!.next_attempt_at, null, "next_attempt_at debe limpiarse al salir de retry_pending");

      const ledger = await obtenerLedgerDelJob(admin, { workspaceId, jobId });
      assert.equal(ledger!.estado, "confirmado", "DEMUESTRA LA CORRECCIÓN DE F3/D3: nunca queda 'liberado' pese al rechazo inicial");
    });

    it("Fase 5, D5 -- error de Meta AMBIGUO (código genérico, ej. 1) se trata como incertidumbre real, NUNCA como rechazo cierto", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      const fetchFixture = (async () => new Response(JSON.stringify({ error: { message: "invalid request or possible server error", code: 1 } }), { status: 400 })) as typeof fetch;
      const resultado = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchFixture }, { workspaceId, jobId });
      assert.match(resultado.motivo, /^incertidumbre_por_error_meta_ambiguo:400$/);

      const job = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(job!.status, "reconciliation_pending", "un código ambiguo de Meta nunca debe tratarse como 'no enviado'");
      const ledger = await obtenerLedgerDelJob(admin, { workspaceId, jobId });
      assert.equal(ledger!.estado, "reservado", "incertidumbre nunca libera usage");
    });

    it("Fase 5, D2 -- payload almacenado corrupto/inválido (defensivo, no debería ocurrir dado que Fase 4 ya valida) se trata como rechazo permanente, sin tocar a Meta", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const numero = await registrarNumero(admin, { workspaceId, phoneNumberId: `phn-${randomUUID()}`, metaToken: "EAAtoken" });
      if (!numero.ok) throw new Error("no se pudo crear número");
      // Payload deliberadamente incompleto -- simula un dato corrupto/legado.
      const job = await crearJobConIdempotencia(admin, { workspaceId, whatsappNumberId: numero.fila.id, idempotencyKey: `idem-${randomUUID()}`, payload: { to: "573000000000" } });
      if (job.resultado === "conflicto_payload_distinto") throw new Error("no debería haber conflicto");

      let llamadas = 0;
      const fetchFixture = (async () => {
        llamadas++;
        return new Response("{}", { status: 200 });
      }) as typeof fetch;
      const resultado = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchFixture }, { workspaceId, jobId: job.jobId });
      assert.equal(resultado.motivo, "payload_almacenado_invalido");
      assert.equal(llamadas, 0, "nunca debe intentar un POST físico con un payload que no se puede mapear");

      const jobFinal = await obtenerJobDelWorkspace(admin, { workspaceId, jobId: job.jobId });
      assert.equal(jobFinal!.status, "failed_by_meta");
      const ledger = await obtenerLedgerDelJob(admin, { workspaceId, jobId: job.jobId });
      assert.equal(ledger!.estado, "liberado");
    });

    it("Fase 5, D7 -- caso borde de concurrencia: Worker A adquiere el lease y queda 'en vuelo' (sending); si su lease expira y Worker B lo retoma, B NO puede hacer un segundo POST, y A NO puede mutar el resultado tras perder ownership", async () => {
      const workspaceId = randomUUID();
      workspacesUsados.push(workspaceId);
      const { jobId } = await prepararJob(workspaceId);

      // Worker A: adquiere el lease y avanza manualmente hasta "sending"
      // (simulando que su POST a Meta está en curso, sin resolver
      // todavía) -- se hace con las funciones reales, no una simulación.
      const leaseA = await adquirirLease(admin, { workspaceId, jobId });
      assert.equal(leaseA.adquirido, true);
      if (!leaseA.adquirido) return;
      await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: leaseA.leaseId, evento: { tipo: "encolar" } });
      const sendingA = await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: leaseA.leaseId, evento: { tipo: "iniciar_envio" } });
      assert.equal(sendingA.aplicada, true);

      // Simula que el lease de A venció (proceso lento, GC pause, etc.)
      // mientras A "sigue con su POST en vuelo" -- manipulación directa
      // de locked_at, mismo patrón ya usado en jobs-store.e2e.test.ts
      // para probar takeover real.
      await admin.from("dulabs_dev_jobs").update({ locked_at: new Date(Date.now() - 120_000).toISOString() }).eq("id", jobId);

      // Worker B: procesa el MISMO mensaje de nuevo (redelivery real de
      // Pub/Sub, o una segunda instancia) -- debe poder tomar el lease
      // (expirado), pero el job está en "sending", no en queued/retry_pending.
      let llamadasFisicasDeB = 0;
      const fetchFixtureB = (async () => {
        llamadasFisicasDeB++;
        return new Response(JSON.stringify({ messages: [{ id: "wamid.DEB" }] }), { status: 200 });
      }) as typeof fetch;
      const resultadoB = await procesarMensajeOutbound({ supabase: admin, metaGraphApiBaseUrl: "https://fixture.invalido", fetchImpl: fetchFixtureB }, { workspaceId, jobId });

      assert.equal(llamadasFisicasDeB, 0, "B NUNCA debe hacer un segundo POST físico -- iniciar_envio no permite arrancar desde 'sending'");
      assert.equal(resultadoB.httpStatus, 200);
      assert.match(resultadoB.motivo, /^no_se_pudo_iniciar_envio:/, "B debe fallar al intentar iniciar_envio desde 'sending' -- transición inválida por diseño");

      // Ahora A "termina" su POST (que en la realidad ya se había hecho)
      // e intenta persistir el resultado -- pero YA PERDIÓ el lease (B lo
      // tomó al intentar procesar, aunque no pudo avanzar el estado).
      const resultadoFinalA = await aplicarEventoJob(admin, { workspaceId, jobId, leaseId: leaseA.leaseId, evento: { tipo: "meta_confirmo_exito" } });
      assert.equal(resultadoFinalA.aplicada, false, "A ya no es el dueño real del lease -- su resultado NUNCA debe poder persistirse");
      if (!resultadoFinalA.aplicada) assert.equal(resultadoFinalA.motivo, "sin_ownership");

      // Documentar el estado final real -- el job queda huérfano en
      // "sending" (nada lo barre automáticamente hoy: ni
      // obtenerJobsPendientesDeReconciliacion ni obtenerJobsListosParaReintento
      // consultan 'sending'). CONFIRMADO, no corregido -- ver reporte.
      const jobFinal = await obtenerJobDelWorkspace(admin, { workspaceId, jobId });
      assert.equal(jobFinal!.status, "sending", "CONFIRMADO: el job queda huérfano en 'sending' -- ningún duplicado físico ocurrió, pero tampoco se resuelve automáticamente hoy");
    });
  }
);
