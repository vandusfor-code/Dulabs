/**
 * DuLabs Developer V1 -- Fase 3, cierre (hallazgo del usage_ledger) +
 * Fase 4 (autorizado, Developer API). E2E real contra Postgres para el
 * flujo COMPLETO real:
 *   POST /api/v1/messages (manejarMensajeSaliente) -> ownership -> rate
 *   limit -> crearJobConIdempotencia -> dulabs_dev_usage_ledger.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { manejarMensajeSaliente, manejarObtenerMensaje } from "./outbound-handler";
import { crearApiKey } from "@/lib/developer/api-keys-store";
import { registrarNumero } from "@/lib/developer/whatsapp-numbers-store";
import { obtenerLedgerDelJob } from "@/lib/developer/usage-ledger";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — Gateway outbound-handler real contra Postgres (Fase 3/4)",
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

    const publicarNoop = async () => "fake-message-id";
    const cuerpoValido = (whatsappNumberId: string, to = "573000000000") => ({ whatsappNumberId, to, type: "text" as const, text: { body: "hola desde el test" } });

    it("un Job real (POST /api/v1/messages) produce su fila real de usage_ledger, en estado 'reservado', asociada al job_id real", async () => {
      const { workspaceId, claveEnClaro, whatsappNumberId } = await prepararWorkspace();

      const respuesta = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey: `idem-${randomUUID()}`, cuerpo: cuerpoValido(whatsappNumberId), requestId: `req-${randomUUID()}` }
      );
      assert.equal(respuesta.status, 201);
      assert.ok(respuesta.headers?.["X-Request-Id"], "debe incluir X-Request-Id en la respuesta");
      const jobId = respuesta.cuerpo.jobId as string;
      assert.ok(jobId);

      const ledger = await obtenerLedgerDelJob(admin, { workspaceId, jobId });
      assert.ok(ledger, "debe existir una fila real de usage_ledger para este job");
      assert.equal(ledger!.estado, "reservado");
      assert.equal(ledger!.job_id, jobId);
      assert.equal(ledger!.workspace_id, workspaceId);
      assert.equal(ledger!.cantidad, 1);
    });

    it("repetir la MISMA Idempotency-Key (réplica real del desarrollador) NO genera una segunda reserva -- UNA sola fila de ledger para ese job", async () => {
      const { workspaceId, claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      const idempotencyKey = `idem-${randomUUID()}`;
      const cuerpo = cuerpoValido(whatsappNumberId);

      const r1 = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey, cuerpo, requestId: `req-${randomUUID()}` }
      );
      assert.equal(r1.status, 201);
      const jobId = r1.cuerpo.jobId as string;

      // Réplica real -- MISMA Idempotency-Key, mismo payload.
      const r2 = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey, cuerpo, requestId: `req-${randomUUID()}` }
      );
      assert.equal(r2.status, 200);
      assert.equal(r2.cuerpo.status, "duplicado_identico");
      assert.equal(r2.cuerpo.jobId, jobId, "debe ser el MISMO job -- nunca uno nuevo");

      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("job_id", jobId);
      assert.equal(count, 1, "EXACTAMENTE 1 fila de ledger pese a 2 requests reales con la misma Idempotency-Key");
    });

    it("CONCURRENCIA real de idempotencia: 5 requests SIMULTÁNEOS con la MISMA Idempotency-Key -- entre las que pasan el rate limit, un solo Job y una sola reserva", async () => {
      const { workspaceId, claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      const idempotencyKey = `idem-concurrente-${randomUUID()}`;
      const cuerpo = cuerpoValido(whatsappNumberId);
      const deps = { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop };

      const respuestas = await Promise.all(
        Array.from({ length: 5 }, () => manejarMensajeSaliente(deps, { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey, cuerpo, requestId: `req-${randomUUID()}` }))
      );

      // El límite real de 2 msg/s por número (Fase 0/decisión D8) puede
      // rechazar algunas de las 5 con 429 -- eso es correcto y esperado.
      // Lo que este test prueba es que, entre las que SÍ pasan el rate
      // limit, la idempotencia sigue garantizando un solo Job real.
      const noLimitadas = respuestas.filter((r) => r.status !== 429);
      assert.ok(noLimitadas.length >= 1, "al menos una de las 5 debe pasar el rate limit (2/s permite al menos 2 en la primera ventana)");

      const jobIds = new Set(noLimitadas.map((r) => r.cuerpo.jobId as string));
      assert.equal(jobIds.size, 1, "entre las respuestas no limitadas, todas deben resolver al MISMO job_id -- nunca jobs distintos");
      assert.ok(noLimitadas.some((r) => r.status === 201), "al menos una de las no limitadas debe ser la creación real (201)");

      const jobId = [...jobIds][0];
      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("job_id", jobId);
      assert.equal(count, 1, `EXACTAMENTE 1 fila de ledger bajo concurrencia real de 5, hubo ${count}`);
    });

    it("una solicitud rechazada ANTES de crear el Job (API key inválida) nunca reserva -- cero filas de ledger para ese workspace", async () => {
      const { workspaceId, whatsappNumberId } = await prepararWorkspace();

      const respuesta = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: "Bearer dl_live_clave_invalida_no_existe", idempotencyKey: `idem-${randomUUID()}`, cuerpo: cuerpoValido(whatsappNumberId), requestId: `req-${randomUUID()}` }
      );
      assert.equal(respuesta.status, 401);
      assert.equal((respuesta.cuerpo.error as { code: string }).code, "invalid_api_key");

      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      assert.equal(count, 0, "una request rechazada por auth nunca debe crear una reserva");
    });

    it("un conflicto de Idempotency-Key con payload DISTINTO (409) nunca reserva -- no crea un job ni una fila de ledger nueva", async () => {
      const { workspaceId, claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      const idempotencyKey = `idem-${randomUUID()}`;

      const original = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey, cuerpo: cuerpoValido(whatsappNumberId), requestId: `req-${randomUUID()}` }
      );
      assert.equal(original.status, 201);

      const conflicto = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey, cuerpo: cuerpoValido(whatsappNumberId, "573099999999"), requestId: `req-${randomUUID()}` }
      );
      assert.equal(conflicto.status, 409);
      assert.equal((conflicto.cuerpo.error as { code: string }).code, "idempotency_conflict");

      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
      assert.equal(count, 1, "el conflicto (409) no debe haber agregado una segunda fila de ledger -- sigue siendo solo la del job original");
    });

    it("Fase 4 -- whatsappNumberId de OTRO workspace se rechaza (400 invalid_whatsapp_number) ANTES de crear job o reservar usage", async () => {
      const { claveEnClaro } = await prepararWorkspace();
      const otro = await prepararWorkspace(); // número real, pero de un workspace DISTINTO al de la API key usada.

      const respuesta = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey: `idem-${randomUUID()}`, cuerpo: cuerpoValido(otro.whatsappNumberId), requestId: `req-${randomUUID()}` }
      );
      assert.equal(respuesta.status, 400);
      assert.equal((respuesta.cuerpo.error as { code: string }).code, "invalid_whatsapp_number");

      const { count } = await admin.from("dulabs_dev_usage_ledger").select("id", { count: "exact", head: true }).eq("workspace_id", otro.workspaceId);
      assert.equal(count, 0, "nunca debe reservarse usage para un número de otro workspace");
    });

    it("Fase 4 -- Idempotency-Key con caracteres de control se rechaza (400 invalid_request) sin tocar la DB", async () => {
      const { claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      const respuesta = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey: "clave concontrol", cuerpo: cuerpoValido(whatsappNumberId), requestId: `req-${randomUUID()}` }
      );
      assert.equal(respuesta.status, 400);
      assert.equal((respuesta.cuerpo.error as { code: string }).code, "invalid_request");
    });

    it("Fase 4 -- Idempotency-Key de más de 255 caracteres se rechaza (400 invalid_request)", async () => {
      const { claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      const respuesta = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey: "x".repeat(256), cuerpo: cuerpoValido(whatsappNumberId), requestId: `req-${randomUUID()}` }
      );
      assert.equal(respuesta.status, 400);
    });

    it("Fase 4 -- payload sin text.body se rechaza (400 invalid_request) sin tocar la DB", async () => {
      const { claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      const respuesta = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey: `idem-${randomUUID()}`, cuerpo: { whatsappNumberId, to: "573000000000" }, requestId: `req-${randomUUID()}` }
      );
      assert.equal(respuesta.status, 400);
      assert.equal((respuesta.cuerpo.error as { code: string }).code, "invalid_request");
    });

    it("Fase 4 -- text.body extremadamente largo se rechaza (400 invalid_request)", async () => {
      const { claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      const respuesta = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        {
          autorizacion: `Bearer ${claveEnClaro}`,
          idempotencyKey: `idem-${randomUUID()}`,
          cuerpo: { whatsappNumberId, to: "573000000000", type: "text", text: { body: "x".repeat(5000) } },
          requestId: `req-${randomUUID()}`,
        }
      );
      assert.equal(respuesta.status, 400);
    });

    it("Fase 4 -- tipo de mensaje no soportado se rechaza (400 invalid_request) -- V1 solo soporta 'text'", async () => {
      const { claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      const respuesta = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        {
          autorizacion: `Bearer ${claveEnClaro}`,
          idempotencyKey: `idem-${randomUUID()}`,
          cuerpo: { whatsappNumberId, to: "573000000000", type: "template", template: { name: "x" } },
          requestId: `req-${randomUUID()}`,
        }
      );
      assert.equal(respuesta.status, 400);
    });

    it("Fase 4 -- RATE LIMIT real por número: de varias requests REALMENTE concurrentes (misma ventana de 1s), las que exceden 2/s se rechazan con 429 + Retry-After, sin crear job", async () => {
      const { claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      const deps = { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop };

      // Concurrencia real (Promise.all, no secuencial) -- necesario para
      // que varias requests caigan de verdad en la MISMA ventana fija de
      // 1s del rate limiter; secuencial con latencia real de Postgres
      // fácilmente cruza a la siguiente ventana entre una y otra.
      const resultados = await Promise.all(
        Array.from({ length: 6 }, () =>
          manejarMensajeSaliente(deps, { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey: `idem-${randomUUID()}`, cuerpo: cuerpoValido(whatsappNumberId), requestId: `req-${randomUUID()}` })
        )
      );
      const limitados = resultados.filter((r) => r.status === 429);
      assert.ok(limitados.length >= 1, `con el límite real de 2/s por número, al menos 1 de 6 requests REALMENTE concurrentes debe ser 429 -- statuses: ${resultados.map((r) => r.status)}`);
      assert.equal((limitados[0].cuerpo.error as { code: string }).code, "rate_limit_exceeded");
      assert.ok(limitados[0].headers?.["Retry-After"], "debe incluir Retry-After real");
      for (const r of limitados) assert.equal(r.cuerpo.jobId, undefined, "una request limitada nunca debe traer un jobId -- nunca se llegó a crear el job");

      // Ventana FIJA (no sliding, ver lib/rate-limit.ts) -- 6 requests
      // concurrentes reales pueden repartirse entre dos ventanas
      // adyacentes según la latencia real de Postgres; el límite real es
      // que NUNCA pasen las 6 (probaría que el rate limit no hizo nada).
      const permitidos = resultados.filter((r) => r.status !== 429);
      assert.ok(permitidos.length < 6, `el rate limit debe haber rechazado al menos una -- pasaron las 6 de 6`);
    });

    it("Fase 4 -- GET /api/v1/messages/:id devuelve el status público correcto, nunca campos internos", async () => {
      const { claveEnClaro, whatsappNumberId } = await prepararWorkspace();
      const creado = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveEnClaro}`, idempotencyKey: `idem-${randomUUID()}`, cuerpo: cuerpoValido(whatsappNumberId), requestId: `req-${randomUUID()}` }
      );
      assert.equal(creado.status, 201);
      const jobId = creado.cuerpo.jobId as string;

      const leido = await manejarObtenerMensaje({ supabase: admin }, { autorizacion: `Bearer ${claveEnClaro}`, jobId, requestId: `req-${randomUUID()}` });
      assert.equal(leido.status, 200);
      assert.equal(leido.cuerpo.id, jobId);
      assert.equal(leido.cuerpo.status, "queued", "job recién creado -> status público 'queued'");
      assert.equal(leido.cuerpo.to, "573000000000");
      assert.equal(leido.cuerpo.whatsappNumberId, whatsappNumberId);
      assert.ok(leido.cuerpo.createdAt);
      assert.equal(leido.cuerpo.lease_id, undefined, "nunca debe exponer lease_id");
      assert.equal(leido.cuerpo.version_token, undefined, "nunca debe exponer version_token");
      assert.equal(leido.cuerpo.physical_outcome, undefined, "nunca debe exponer physical_outcome crudo");
      assert.equal(leido.cuerpo.network_attempts, undefined, "nunca debe exponer network_attempts");
    });

    it("Fase 4 -- GET /api/v1/messages/:id de un job de OTRO workspace -> 404 (nunca 403, nunca revela que existe)", async () => {
      const { claveEnClaro: claveB } = await prepararWorkspace();
      const { claveEnClaro: claveA, whatsappNumberId: numeroA } = await prepararWorkspace();

      const creado = await manejarMensajeSaliente(
        { supabase: admin, topicOutbound: "dulabs-outbound", publicar: publicarNoop },
        { autorizacion: `Bearer ${claveA}`, idempotencyKey: `idem-${randomUUID()}`, cuerpo: cuerpoValido(numeroA), requestId: `req-${randomUUID()}` }
      );
      const jobId = creado.cuerpo.jobId as string;

      const comoB = await manejarObtenerMensaje({ supabase: admin }, { autorizacion: `Bearer ${claveB}`, jobId, requestId: `req-${randomUUID()}` });
      assert.equal(comoB.status, 404);
      assert.equal((comoB.cuerpo.error as { code: string }).code, "not_found");
    });

    it("Fase 4 -- GET /api/v1/messages/:id inexistente -> 404, mismo shape que cross-tenant", async () => {
      const { claveEnClaro } = await prepararWorkspace();
      const resultado = await manejarObtenerMensaje({ supabase: admin }, { autorizacion: `Bearer ${claveEnClaro}`, jobId: randomUUID(), requestId: `req-${randomUUID()}` });
      assert.equal(resultado.status, 404);
      assert.equal((resultado.cuerpo.error as { code: string }).code, "not_found");
    });
  }
);
