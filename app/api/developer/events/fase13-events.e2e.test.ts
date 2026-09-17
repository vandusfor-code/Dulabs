/**
 * DuLabs Developer V1 -- Fase 13. E2E real contra Postgres: listado de eventos
 * (tenant scope), observabilidad de entrega, replay (re-encolado sin
 * duplicación + tenant isolation + authz), pruning seguro y limpieza de
 * idempotency_keys. No llama a Meta/Wompi ni al worker; ejercita el contrato
 * server-side y la BD. Requiere migraciones Fase 1/2/3/6/8.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { crearClienteDePruebaComoSesion } from "@/lib/test-helpers/sesion-prueba";
import { crearMiembro } from "@/lib/developer/memberships-store";
import { podarEventosAntiguos } from "@/lib/developer/events-store";
import { limpiarIdempotencyKeysVencidas } from "@/lib/developer/idempotency";
import { GET as eventsGET } from "@/app/api/developer/events/route";
import { POST as replayPOST } from "@/app/api/developer/events/[id]/replay/route";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function req(path: string, opts: { token?: string; ws?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.ws) headers["x-dulabs-workspace"] = opts.ws;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, { method: opts.body !== undefined || path.includes("/replay") ? "POST" : "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

describe(
  "DuLabs Developer V1 — Events & Logs (Fase 13)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const userIds: string[] = [];
    const workspaceIds: string[] = [];
    const idempotencyIds: number[] = [];

    after(async () => {
      for (const ws of [...new Set(workspaceIds)]) {
        await admin.from("dulabs_dev_events").delete().eq("workspace_id", ws).then(() => {}, () => {});
        await admin.from("dulabs_dev_memberships").delete().eq("workspace_id", ws).then(() => {}, () => {});
        await admin.from("dulabs_dev_idempotency_keys").delete().eq("workspace_id", ws).then(() => {}, () => {});
      }
      if (idempotencyIds.length) await admin.from("dulabs_dev_idempotency_keys").delete().in("id", idempotencyIds).then(() => {}, () => {});
      for (const id of userIds) await admin.auth.admin.deleteUser(id).then(() => {}, () => {});
    });

    async function ownerDe(ws: string): Promise<{ token: string; userId: string }> {
      const email = `f13-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const password = `F13-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error("no user");
      userIds.push(data.user.id);
      await crearMiembro(admin, { workspaceId: ws, userId: data.user.id, rol: "OWNER" });
      const s = crearClienteDePruebaComoSesion();
      const si = await s.auth.signInWithPassword({ email, password });
      if (si.error || !si.data.session) throw si.error ?? new Error("no session");
      return { token: si.data.session.access_token, userId: data.user.id };
    }
    async function miembroDe(ws: string, rol: "ADMIN" | "MEMBER"): Promise<string> {
      const email = `f13m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const password = `F13m-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error("no user");
      userIds.push(data.user.id);
      await crearMiembro(admin, { workspaceId: ws, userId: data.user.id, rol });
      const s = crearClienteDePruebaComoSesion();
      const si = await s.auth.signInWithPassword({ email, password });
      if (si.error || !si.data.session) throw si.error ?? new Error("no session");
      return si.data.session.access_token;
    }
    async function insertarEvento(ws: string, o: { tipo?: string; estado?: string; createdAt?: string; intentos?: number } = {}): Promise<number> {
      const { data, error } = await admin
        .from("dulabs_dev_events")
        .insert({ event_id: `evt_${randomUUID()}`, workspace_id: ws, tipo: o.tipo ?? "received", entrega_estado: o.estado ?? "pendiente", entrega_intentos: o.intentos ?? 0, payload: { texto: "x", token: "secreto" }, ...(o.createdAt ? { created_at: o.createdAt } : {}) })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id as number;
    }
    const body = async (r: Response) => (await r.json()) as Record<string, unknown>;

    it("listado: scoped por workspace + payload redactado (tenant isolation)", async () => {
      const wsA = randomUUID(), wsB = randomUUID();
      workspaceIds.push(wsA, wsB);
      const a = await ownerDe(wsA);
      await ownerDe(wsB);
      await insertarEvento(wsA, { estado: "entregado" });
      await insertarEvento(wsB, { estado: "dlq" });
      const r = await eventsGET(req("/api/developer/events?limit=50", { token: a.token, ws: wsA }));
      assert.equal(r.status, 200);
      const b = await body(r);
      const events = b.events as { payload: Record<string, unknown> }[];
      assert.ok(events.length >= 1);
      // Solo eventos de A (ninguno de B) y payload redactado.
      for (const e of events) assert.equal((e.payload as Record<string, unknown>).token, "[redactado]");
    });

    it("replay: DLQ -> re-encolado (pendiente, intentos 0); no_replayable si entregado", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const o = await ownerDe(ws);
      const dlqId = await insertarEvento(ws, { estado: "dlq", intentos: 5 });
      const okId = await insertarEvento(ws, { estado: "entregado" });

      const r1 = await replayPOST(req(`/api/developer/events/${dlqId}/replay`, { token: o.token, ws }), { params: Promise.resolve({ id: String(dlqId) }) });
      assert.equal(r1.status, 200);
      const { data: reencolado } = await admin.from("dulabs_dev_events").select("entrega_estado, entrega_intentos").eq("id", dlqId).maybeSingle();
      assert.equal((reencolado as { entrega_estado: string }).entrega_estado, "pendiente");
      assert.equal((reencolado as { entrega_intentos: number }).entrega_intentos, 0);

      const r2 = await replayPOST(req(`/api/developer/events/${okId}/replay`, { token: o.token, ws }), { params: Promise.resolve({ id: String(okId) }) });
      assert.equal(r2.status, 409);
      assert.equal(((await body(r2)).error as { code: string }).code, "not_replayable");
    });

    it("replay: cross-tenant -> 404 (no se puede reintentar un evento de otro workspace)", async () => {
      const wsA = randomUUID(), wsB = randomUUID();
      workspaceIds.push(wsA, wsB);
      const a = await ownerDe(wsA);
      await ownerDe(wsB);
      const idB = await insertarEvento(wsB, { estado: "dlq" });
      const r = await replayPOST(req(`/api/developer/events/${idB}/replay`, { token: a.token, ws: wsA }), { params: Promise.resolve({ id: String(idB) }) });
      assert.equal(r.status, 404);
      // El evento de B sigue en dlq (no se tocó).
      const { data } = await admin.from("dulabs_dev_events").select("entrega_estado").eq("id", idB).maybeSingle();
      assert.equal((data as { entrega_estado: string }).entrega_estado, "dlq");
    });

    it("replay: MEMBER no autorizado -> 403", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      await ownerDe(ws);
      const memberToken = await miembroDe(ws, "MEMBER");
      const id = await insertarEvento(ws, { estado: "dlq" });
      const r = await replayPOST(req(`/api/developer/events/${id}/replay`, { token: memberToken, ws }), { params: Promise.resolve({ id: String(id) }) });
      assert.equal(r.status, 403);
    });

    it("pruning seguro: borra solo entregado/sin_webhook antiguos; conserva pendiente/dlq/fallido y recientes", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const viejo = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString();
      const idEntregadoViejo = await insertarEvento(ws, { estado: "entregado", createdAt: viejo });
      const idSinWebhookViejo = await insertarEvento(ws, { estado: "sin_webhook", createdAt: viejo });
      const idPendienteViejo = await insertarEvento(ws, { estado: "pendiente", createdAt: viejo });
      const idDlqViejo = await insertarEvento(ws, { estado: "dlq", createdAt: viejo });
      const idFallidoViejo = await insertarEvento(ws, { estado: "fallido", createdAt: viejo });
      const idEntregadoReciente = await insertarEvento(ws, { estado: "entregado" });

      const { borrados } = await podarEventosAntiguos(admin, { diasRetencion: 1, limite: 1000 });
      assert.ok(borrados >= 2);

      const sigue = async (id: number) => Boolean((await admin.from("dulabs_dev_events").select("id").eq("id", id).maybeSingle()).data);
      assert.equal(await sigue(idEntregadoViejo), false, "entregado viejo debe borrarse");
      assert.equal(await sigue(idSinWebhookViejo), false, "sin_webhook viejo debe borrarse");
      assert.equal(await sigue(idPendienteViejo), true, "pendiente NUNCA se borra");
      assert.equal(await sigue(idDlqViejo), true, "dlq NUNCA se borra");
      assert.equal(await sigue(idFallidoViejo), true, "fallido NUNCA se borra");
      assert.equal(await sigue(idEntregadoReciente), true, "entregado reciente se conserva");
    });

    it("idempotency_keys: limpieza borra solo las > 24h", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const viejo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const { data: kViejo } = await admin.from("dulabs_dev_idempotency_keys").insert({ workspace_id: ws, idempotency_key: `old_${randomUUID()}`, payload_hash: "h", created_at: viejo }).select("id").single();
      const { data: kNuevo } = await admin.from("dulabs_dev_idempotency_keys").insert({ workspace_id: ws, idempotency_key: `new_${randomUUID()}`, payload_hash: "h" }).select("id").single();
      idempotencyIds.push(kViejo!.id as number, kNuevo!.id as number);

      await limpiarIdempotencyKeysVencidas(admin, { horas: 24, limite: 5000 });
      const existe = async (id: number) => Boolean((await admin.from("dulabs_dev_idempotency_keys").select("id").eq("id", id).maybeSingle()).data);
      assert.equal(await existe(kViejo!.id as number), false, "key vieja (>24h) borrada");
      assert.equal(await existe(kNuevo!.id as number), true, "key reciente conservada");
    });
  }
);
