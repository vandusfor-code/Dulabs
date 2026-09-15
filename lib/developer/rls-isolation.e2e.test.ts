/**
 * DuLabs Developer V1 -- Fase 2 (autorizado, sección "Seguridad / RLS" del
 * brief). Aislamiento multi-tenant REAL contra Postgres -- nunca
 * `expect(policyExists).toBe(true)`.
 *
 * Para cada una de las 6 tablas nuevas de Fase 2 se prueba, con una sesión
 * de usuario REAL (no service_role):
 *   1. El workspace dueño de una fila SÍ puede leerla (la política permite,
 *      no solo bloquea).
 *   2. Un workspace ajeno NO ve esa fila en un SELECT sin filtro.
 *   3. Ni siquiera el propio dueño puede UPDATE/DELETE vía rol `authenticated`
 *      (no existen políticas de escritura a propósito -- todas las
 *      mutaciones pasan por el backend con service_role). Se confirma con
 *      una lectura de control vía service_role que la fila quedó intacta,
 *      no solo que la llamada "no dio error".
 *
 * Técnica de sesión real sin depender de NEXT_PUBLIC_SUPABASE_ANON_KEY
 * (vacío en este entorno local): lib/test-helpers/sesion-prueba.ts, ya
 * usado por el resto de la suite E2E del repo -- signInWithPassword con
 * SERVICE_ROLE_KEY como apikey del cliente produce un access_token de
 * usuario normal, idéntico al que emitiría el anon key real; lo que decide
 * el rol Postgres (`authenticated` vs `service_role`) es el claim `role`
 * del JWT que viaja en `Authorization`, no la apikey usada para firmar el
 * login. Acá se arma un cliente aparte que envía ESE token como
 * `Authorization: Bearer <token>` en cada request PostgREST -- así sí queda
 * sujeto a RLS de verdad.
 *
 * REQUIERE la migración 20261007000000_dulabs_developer_v1_fase2_data_model.sql
 * aplicada (las 6 tablas nuevas) -- ver PENDING_MIGRATIONS.md.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearUsuarioDePrueba, borrarUsuarioDePrueba, type UsuarioDePrueba } from "@/lib/test-helpers/sesion-prueba";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function clienteComoSesion(token: string): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

describe(
  "DuLabs Developer V1 — aislamiento RLS real entre workspaces (Fase 2)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

    const workspaceIdA = randomUUID();
    const workspaceIdB = randomUUID();
    let usuarioA: UsuarioDePrueba;
    let usuarioB: UsuarioDePrueba;
    let sesionA: SupabaseClient;
    let sesionB: SupabaseClient;

    // Filas sembradas vía service_role (ignora RLS por diseño) para el
    // workspace de A.
    let apiKeyIdA = "";
    let numeroIdA = "";
    let webhookIdA = "";
    let jobIdA = "";
    let ledgerIdA = 0;
    let eventoIdA = 0;

    before(async () => {
      usuarioA = await crearUsuarioDePrueba(admin, { tenantId: workspaceIdA, rol: "admin", prefijo: "dev-rls-a" });
      usuarioB = await crearUsuarioDePrueba(admin, { tenantId: workspaceIdB, rol: "admin", prefijo: "dev-rls-b" });
      sesionA = clienteComoSesion(usuarioA.token);
      sesionB = clienteComoSesion(usuarioB.token);

      const apiKey = await admin
        .from("dulabs_dev_api_keys")
        .insert({ workspace_id: workspaceIdA, name: "rls-test", key_hash: "x".repeat(64), prefix: "dl_live_rlstest" })
        .select("id")
        .single();
      if (apiKey.error) throw new Error(`seed api_keys: ${apiKey.error.message}`);
      apiKeyIdA = apiKey.data.id;

      const numero = await admin
        .from("dulabs_dev_whatsapp_numbers")
        .insert({ workspace_id: workspaceIdA, phone_number_id: `rls-test-${randomUUID()}`, display_name: "RLS Test" })
        .select("id")
        .single();
      if (numero.error) throw new Error(`seed whatsapp_numbers: ${numero.error.message}`);
      numeroIdA = numero.data.id;

      const webhook = await admin
        .from("dulabs_dev_webhook_configs")
        .insert({ workspace_id: workspaceIdA, whatsapp_number_id: numeroIdA, url: "https://example.com/webhook", secret_cifrado: "x" })
        .select("id")
        .single();
      if (webhook.error) throw new Error(`seed webhook_configs: ${webhook.error.message}`);
      webhookIdA = webhook.data.id;

      const job = await admin
        .from("dulabs_dev_jobs")
        .insert({ workspace_id: workspaceIdA, whatsapp_number_id: numeroIdA, payload: { to: "573000000000" } })
        .select("id")
        .single();
      if (job.error) throw new Error(`seed jobs: ${job.error.message}`);
      jobIdA = job.data.id;

      const ledger = await admin.from("dulabs_dev_usage_ledger").insert({ workspace_id: workspaceIdA, job_id: jobIdA }).select("id").single();
      if (ledger.error) throw new Error(`seed usage_ledger: ${ledger.error.message}`);
      ledgerIdA = ledger.data.id;

      const evento = await admin
        .from("dulabs_dev_events")
        .insert({ event_id: randomUUID(), workspace_id: workspaceIdA, job_id: jobIdA, tipo: "received" })
        .select("id")
        .single();
      if (evento.error) throw new Error(`seed events: ${evento.error.message}`);
      eventoIdA = evento.data.id;
    });

    after(async () => {
      await admin.from("dulabs_dev_events").delete().eq("workspace_id", workspaceIdA).then(() => {}, () => {});
      await admin.from("dulabs_dev_usage_ledger").delete().eq("workspace_id", workspaceIdA).then(() => {}, () => {});
      await admin.from("dulabs_dev_jobs").delete().eq("workspace_id", workspaceIdA).then(() => {}, () => {});
      await admin.from("dulabs_dev_webhook_configs").delete().eq("workspace_id", workspaceIdA).then(() => {}, () => {});
      await admin.from("dulabs_dev_whatsapp_numbers").delete().eq("workspace_id", workspaceIdA).then(() => {}, () => {});
      await admin.from("dulabs_dev_api_keys").delete().eq("workspace_id", workspaceIdA).then(() => {}, () => {});
      await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", workspaceIdA).then(() => {}, () => {});
      await admin.from("dulabs_miembros_equipo").delete().eq("tenant_id", workspaceIdB).then(() => {}, () => {});
      if (usuarioA) await borrarUsuarioDePrueba(admin, usuarioA.id);
      if (usuarioB) await borrarUsuarioDePrueba(admin, usuarioB.id);
    });

    /**
     * Verificación genérica y real (sin atajos) para una tabla:
     *  1. A (dueño) lee su propia fila -- la política permite, no solo bloquea.
     *  2. B (ajeno) hace SELECT sin filtro sobre la tabla -- cero filas.
     *  3. A intenta UPDATE de su propia fila vía rol `authenticated` -- la
     *     tabla no tiene política de escritura, así que se confirma con una
     *     lectura de control por service_role que el valor NO cambió.
     *  4. A intenta DELETE de su propia fila -- se confirma con lectura de
     *     control que la fila SIGUE existiendo.
     */
    async function verificarAislamiento(params: {
      tabla: string;
      columnaId: string;
      idFila: string | number;
      campoActualizable: string;
      valorOriginal: unknown;
      valorIntento: unknown;
    }) {
      const { tabla, columnaId, idFila, campoActualizable, valorOriginal, valorIntento } = params;

      const propiaA = await sesionA.from(tabla).select("*").eq(columnaId, idFila);
      assert.equal(propiaA.error, null, `[${tabla}] A no debería tener error leyendo su propia fila: ${propiaA.error?.message}`);
      assert.equal(propiaA.data?.length, 1, `[${tabla}] A debe ver exactamente su propia fila (política de SELECT debe permitir, no solo bloquear)`);

      const todasB = await sesionB.from(tabla).select("*");
      assert.equal(todasB.error, null, `[${tabla}] B no debería tener error, solo cero filas: ${todasB.error?.message}`);
      assert.equal(todasB.data?.length, 0, `[${tabla}] B NO debe ver ninguna fila del workspace de A`);

      await sesionA.from(tabla).update({ [campoActualizable]: valorIntento }).eq(columnaId, idFila);
      const controlUpdate = await admin.from(tabla).select(campoActualizable).eq(columnaId, idFila).single();
      const filaControlUpdate = controlUpdate.data as Record<string, unknown> | null;
      assert.equal(filaControlUpdate?.[campoActualizable], valorOriginal, `[${tabla}] el UPDATE vía rol authenticated NO debió aplicarse (no hay política de escritura) -- Postgres debe rechazarlo`);

      await sesionA.from(tabla).delete().eq(columnaId, idFila);
      const controlDelete = await admin.from(tabla).select(columnaId).eq(columnaId, idFila).maybeSingle();
      assert.ok(controlDelete.data, `[${tabla}] el DELETE vía rol authenticated NO debió aplicarse -- la fila debe seguir existiendo`);
    }

    it("dulabs_dev_api_keys: A ve la suya, B no ve nada, ni A puede mutar vía rol authenticated", async () => {
      await verificarAislamiento({ tabla: "dulabs_dev_api_keys", columnaId: "id", idFila: apiKeyIdA, campoActualizable: "name", valorOriginal: "rls-test", valorIntento: "hackeado" });
    });

    it("dulabs_dev_whatsapp_numbers: A ve el suyo, B no ve nada, ni A puede mutar vía rol authenticated", async () => {
      await verificarAislamiento({ tabla: "dulabs_dev_whatsapp_numbers", columnaId: "id", idFila: numeroIdA, campoActualizable: "display_name", valorOriginal: "RLS Test", valorIntento: "hackeado" });
    });

    it("dulabs_dev_webhook_configs: A ve el suyo, B no ve nada, ni A puede mutar vía rol authenticated", async () => {
      await verificarAislamiento({ tabla: "dulabs_dev_webhook_configs", columnaId: "id", idFila: webhookIdA, campoActualizable: "estado", valorOriginal: "activo", valorIntento: "pausado" });
    });

    it("dulabs_dev_jobs: A ve el suyo, B no ve nada, ni A puede mutar vía rol authenticated", async () => {
      await verificarAislamiento({ tabla: "dulabs_dev_jobs", columnaId: "id", idFila: jobIdA, campoActualizable: "network_attempts", valorOriginal: 0, valorIntento: 99 });
    });

    it("dulabs_dev_usage_ledger: A ve el suyo, B no ve nada, ni A puede mutar vía rol authenticated", async () => {
      await verificarAislamiento({ tabla: "dulabs_dev_usage_ledger", columnaId: "id", idFila: ledgerIdA, campoActualizable: "cantidad", valorOriginal: 1, valorIntento: 999 });
    });

    it("dulabs_dev_events: A ve el suyo, B no ve nada, ni A puede mutar vía rol authenticated", async () => {
      await verificarAislamiento({ tabla: "dulabs_dev_events", columnaId: "id", idFila: eventoIdA, campoActualizable: "correlation_id", valorOriginal: null, valorIntento: "hackeado" });
    });

    it("B no ve ninguna fila de A ni siquiera al consultar por workspace_id de A explícitamente (bypass por parámetro, no por RLS)", async () => {
      const intentoDirecto = await sesionB.from("dulabs_dev_jobs").select("*").eq("workspace_id", workspaceIdA);
      assert.equal(intentoDirecto.error, null);
      assert.equal(intentoDirecto.data?.length, 0, "filtrar explícitamente por el workspace_id de A no debe devolver nada -- RLS ignora lo que el cliente pida, no solo lo que omita");
    });
  }
);
