/**
 * DuLabs Developer V1 -- Fase 8 (Workspaces + Users + API Keys, autorizado).
 * E2E real contra Postgres a nivel GATEWAY: autenticación de sesión +
 * selección de workspace (D3) + autorización por rol (D4) + endpoints nuevos
 * (workspace, members, rotate) + aislamiento cross-tenant.
 *
 * Se usan sesiones REALES (JWT de usuario) -- conWorkspaceAutenticado valida
 * con auth.getUser, nunca confía en un id del request.
 *
 * REQUIERE las migraciones de Fase 2 y 20261014000000 aplicadas.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  conWorkspaceAutenticado,
  manejarObtenerWorkspace,
  manejarCrearMiembro,
  manejarActualizarRolMiembro,
  manejarEliminarMiembro,
  manejarCrearApiKey,
  manejarListarApiKeys,
  manejarRotarApiKey,
  type RespuestaManagement,
  type ContextoSesion,
} from "./management-handler";
import { crearMiembro, listarMiembros, type RolDev } from "@/lib/developer/memberships-store";
import { crearApiKey, autenticarApiKey } from "@/lib/developer/api-keys-store";
import { crearUsuarioDePrueba, crearClienteDePruebaComoSesion } from "@/lib/test-helpers/sesion-prueba";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const TODOS: RolDev[] = ["OWNER", "ADMIN", "MEMBER"];
const GESTION: RolDev[] = ["OWNER", "ADMIN"];
const SOLO_OWNER: RolDev[] = ["OWNER"];

describe(
  "DuLabs Developer V1 — Gateway identidad/acceso real contra Postgres (Fase 8)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const deps = { supabase: admin };
    const userIds: string[] = [];
    const workspaceIds: string[] = [];

    after(async () => {
      for (const ws of workspaceIds) {
        await admin.from("dulabs_dev_api_keys").delete().eq("workspace_id", ws).then(() => {}, () => {});
        await admin.from("dulabs_dev_memberships").delete().eq("workspace_id", ws).then(() => {}, () => {});
      }
      for (const id of userIds) await admin.auth.admin.deleteUser(id).then(() => {}, () => {});
    });

    /** Usuario Developer "puro": auth user + sesión real + membresía Developer con el rol dado (sin membresía Business). */
    async function usuarioDevConRol(ws: string, rol: RolDev): Promise<{ userId: string; token: string }> {
      const email = `f8-${rol.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const password = `F8Test-${randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error("no user");
      userIds.push(data.user.id);
      await crearMiembro(admin, { workspaceId: ws, userId: data.user.id, rol });
      const sesion = crearClienteDePruebaComoSesion();
      const { data: signIn, error: eSign } = await sesion.auth.signInWithPassword({ email, password });
      if (eSign || !signIn.session) throw eSign ?? new Error("no session");
      return { userId: data.user.id, token: signIn.session.access_token };
    }

    const comoSesion = (token: string, wsHeader: string | undefined, roles: RolDev[], fn: (ctx: ContextoSesion) => Promise<RespuestaManagement>) =>
      conWorkspaceAutenticado(deps, `Bearer ${token}`, wsHeader, roles, fn);

    it("Test 1 -- usuario autenticado obtiene su workspace (OWNER implícito por fallback Business, sin header, un solo workspace)", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await crearUsuarioDePrueba(admin, { tenantId: ws, rol: "admin", prefijo: "f8-owner" });
      userIds.push(owner.id);

      const r = await comoSesion(owner.token, undefined, TODOS, (ctx) => manejarObtenerWorkspace(deps, ctx));
      assert.equal(r.status, 200);
      assert.equal(r.cuerpo.workspaceId, ws);
      assert.equal(r.cuerpo.rol, "OWNER");
      assert.equal((r.cuerpo.workspaces as unknown[]).length, 1);
    });

    it("Test 12 -- OWNER puede administrar: crear API key y agregar miembro", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const { token } = await usuarioDevConRol(ws, "OWNER");
      const nuevoMiembro = await usuarioDevConRol(randomUUID(), "MEMBER"); // usuario existente que agregaremos a ws

      const key = await comoSesion(token, ws, GESTION, (ctx) => manejarCrearApiKey(deps, ctx.workspaceId, { name: "k-owner" }));
      assert.equal(key.status, 201);
      assert.ok(key.cuerpo.apiKey, "la clave se devuelve una sola vez al crear");

      const add = await comoSesion(token, ws, SOLO_OWNER, (ctx) => manejarCrearMiembro(deps, ctx.workspaceId, { userId: nuevoMiembro.userId, rol: "ADMIN" }));
      assert.equal(add.status, 201);
      assert.equal((add.cuerpo.member as { rol: string }).rol, "ADMIN");
    });

    it("Test 13 -- ADMIN administra recursos pero NO miembros: crea API key (201) y recibe 403 al gestionar miembros", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      await usuarioDevConRol(ws, "OWNER"); // el workspace tiene un owner
      const adminUser = await usuarioDevConRol(ws, "ADMIN");

      const key = await comoSesion(adminUser.token, ws, GESTION, (ctx) => manejarCrearApiKey(deps, ctx.workspaceId, { name: "k-admin" }));
      assert.equal(key.status, 201, "ADMIN sí puede crear API keys");

      const add = await comoSesion(adminUser.token, ws, SOLO_OWNER, (ctx) => manejarCrearMiembro(deps, ctx.workspaceId, { userId: randomUUID(), rol: "MEMBER" }));
      assert.equal(add.status, 403, "ADMIN nunca puede gestionar miembros");
      assert.equal(add.cuerpo.error, "forbidden");
    });

    it("Tests 14/15 -- MEMBER es solo lectura: lista (200) pero NO crea keys (403) ni escala roles (403)", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuarioDevConRol(ws, "OWNER");
      const memberUser = await usuarioDevConRol(ws, "MEMBER");

      const lista = await comoSesion(memberUser.token, ws, TODOS, (ctx) => manejarListarApiKeys(deps, ctx.workspaceId));
      assert.equal(lista.status, 200, "MEMBER sí puede listar (solo lectura)");

      const crear = await comoSesion(memberUser.token, ws, GESTION, (ctx) => manejarCrearApiKey(deps, ctx.workspaceId, { name: "no" }));
      assert.equal(crear.status, 403, "MEMBER nunca crea API keys");

      // Intento de escalar: MEMBER intenta cambiar el rol de un miembro (ruta SOLO_OWNER).
      const ownerMembership = (await listarMiembros(admin, ws)).find((m) => m.user_id === owner.userId)!;
      const escalar = await comoSesion(memberUser.token, ws, SOLO_OWNER, (ctx) => manejarActualizarRolMiembro(deps, ctx.workspaceId, ownerMembership.id, { rol: "MEMBER" }));
      assert.equal(escalar.status, 403, "MEMBER nunca puede modificar roles");
    });

    it("Test 16 -- gateway: no se puede eliminar al último OWNER (409 last_owner)", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuarioDevConRol(ws, "OWNER");
      const ownerMembership = (await listarMiembros(admin, ws)).find((m) => m.user_id === owner.userId)!;

      const del = await comoSesion(owner.token, ws, SOLO_OWNER, (ctx) => manejarEliminarMiembro(deps, ctx.workspaceId, ownerMembership.id));
      assert.equal(del.status, 409);
      assert.equal(del.cuerpo.error, "last_owner");
    });

    it("Test 19 -- cross-tenant: OWNER de A no puede modificar un miembro de B (404 member_not_found, nunca cruza)", async () => {
      const wsA = randomUUID();
      const wsB = randomUUID();
      workspaceIds.push(wsA, wsB);
      const ownerA = await usuarioDevConRol(wsA, "OWNER");
      const victimaB = await usuarioDevConRol(wsB, "MEMBER");
      const membershipB = (await listarMiembros(admin, wsB)).find((m) => m.user_id === victimaB.userId)!;

      // ownerA opera en SU workspace (wsA); el membershipId es de wsB -> no aparece.
      const patch = await comoSesion(ownerA.token, wsA, SOLO_OWNER, (ctx) => manejarActualizarRolMiembro(deps, ctx.workspaceId, membershipB.id, { rol: "OWNER" }));
      assert.equal(patch.status, 404);
      assert.equal(patch.cuerpo.error, "member_not_found");
    });

    it("Test 21 -- manipular X-Dulabs-Workspace hacia un workspace ajeno falla (403 workspace_no_autorizado, nunca escala)", async () => {
      const ws = randomUUID();
      const wsAjeno = randomUUID();
      workspaceIds.push(ws);
      const user = await usuarioDevConRol(ws, "OWNER");

      const r = await comoSesion(user.token, wsAjeno, TODOS, (ctx) => manejarObtenerWorkspace(deps, ctx));
      assert.equal(r.status, 403);
      assert.equal(r.cuerpo.error, "workspace_no_autorizado");
    });

    it("D3 -- multi-workspace: sin header es ambiguo (400); con header válido resuelve el correcto", async () => {
      const wsA = randomUUID();
      const wsB = randomUUID();
      workspaceIds.push(wsA, wsB);
      // Un usuario en DOS workspaces.
      const email = `f8-multi-${Date.now()}@example.com`;
      const password = `F8Test-${randomUUID()}`;
      const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      userIds.push(data!.user!.id);
      await crearMiembro(admin, { workspaceId: wsA, userId: data!.user!.id, rol: "OWNER" });
      await crearMiembro(admin, { workspaceId: wsB, userId: data!.user!.id, rol: "MEMBER" });
      const sesion = crearClienteDePruebaComoSesion();
      const token = (await sesion.auth.signInWithPassword({ email, password })).data.session!.access_token;

      const ambiguo = await comoSesion(token, undefined, TODOS, (ctx) => manejarObtenerWorkspace(deps, ctx));
      assert.equal(ambiguo.status, 400);
      assert.equal(ambiguo.cuerpo.error, "workspace_ambiguo");

      const conHeader = await comoSesion(token, wsB, TODOS, (ctx) => manejarObtenerWorkspace(deps, ctx));
      assert.equal(conHeader.status, 200);
      assert.equal(conHeader.cuerpo.workspaceId, wsB);
      assert.equal(conHeader.cuerpo.rol, "MEMBER");
    });

    it("Test 3 -- membresía suspendida bloquea acceso (401 sin_membresia_activa)", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const user = await usuarioDevConRol(ws, "OWNER");
      await admin.from("dulabs_dev_memberships").update({ estado: "suspendido" }).eq("workspace_id", ws).eq("user_id", user.userId);

      const r = await comoSesion(user.token, undefined, TODOS, (ctx) => manejarObtenerWorkspace(deps, ctx));
      assert.equal(r.status, 401);
      assert.equal(r.cuerpo.error, "sin_membresia_activa");
    });

    it("Tests 8/D6 -- rotación de API key: OWNER/ADMIN rotan (revoca vieja + crea nueva atómicamente); MEMBER recibe 403", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuarioDevConRol(ws, "OWNER");
      const memberUser = await usuarioDevConRol(ws, "MEMBER");

      const original = await crearApiKey(admin, { workspaceId: ws, name: "rotable" });

      // MEMBER no puede rotar.
      const rotMember = await comoSesion(memberUser.token, ws, GESTION, (ctx) => manejarRotarApiKey(deps, ctx.workspaceId, original.fila.id));
      assert.equal(rotMember.status, 403);

      // OWNER rota.
      const rot = await comoSesion(owner.token, ws, GESTION, (ctx) => manejarRotarApiKey(deps, ctx.workspaceId, original.fila.id));
      assert.equal(rot.status, 201);
      const nuevaClave = rot.cuerpo.apiKey as string;
      assert.ok(nuevaClave && nuevaClave !== original.claveEnClaro, "devuelve una clave NUEVA, una sola vez");

      // La vieja ya no autentica; la nueva sí.
      const authVieja = await autenticarApiKey(admin, original.claveEnClaro);
      assert.equal(authVieja.autenticado, false, "la key vieja queda revocada tras rotar");
      const authNueva = await autenticarApiKey(admin, nuevaClave);
      assert.equal(authNueva.autenticado, true, "la key nueva autentica");
      if (authNueva.autenticado) assert.equal(authNueva.workspaceId, ws);
    });

    it("Test 11 -- el listado de keys nunca expone el secreto ni el hash", async () => {
      const ws = randomUUID();
      workspaceIds.push(ws);
      const owner = await usuarioDevConRol(ws, "OWNER");
      await crearApiKey(admin, { workspaceId: ws, name: "meta-only" });
      const lista = await comoSesion(owner.token, ws, TODOS, (ctx) => manejarListarApiKeys(deps, ctx.workspaceId));
      assert.equal(lista.status, 200);
      const keys = lista.cuerpo.apiKeys as Array<Record<string, unknown>>;
      assert.ok(keys.length >= 1);
      for (const k of keys) {
        assert.equal(k.apiKey, undefined, "nunca la clave en claro");
        assert.equal(k.key_hash, undefined, "nunca el hash");
      }
    });
  }
);
