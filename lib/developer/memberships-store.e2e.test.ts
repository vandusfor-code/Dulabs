/**
 * DuLabs Developer V1 -- Fase 8 (Workspaces + Users + API Keys, autorizado).
 * E2E real contra Postgres del store de identidad/roles Developer:
 * resolución con prioridad Developer + fallback Business (D2), multi-workspace,
 * alta idempotente/concurrente, y guarda atómica de último OWNER (D4).
 *
 * user_id referencia auth.users (FK real) -> se crean usuarios de Auth
 * reales; borrarlos al final elimina en cascada sus membresías Developer.
 *
 * REQUIERE la migración 20261014000000 aplicada.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  resolverMembresiaEfectiva,
  listarWorkspacesDelUsuario,
  listarMiembros,
  crearMiembro,
  cambiarRolMiembro,
  eliminarMiembro,
} from "@/lib/developer/memberships-store";

const HAS_SUPABASE = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe(
  "DuLabs Developer V1 — memberships-store real contra Postgres (Fase 8)",
  { skip: !HAS_SUPABASE && "requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY" },
  () => {
    const admin: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const userIds: string[] = [];

    after(async () => {
      // Borrar el usuario de Auth elimina en cascada sus filas dev/business.
      for (const id of userIds) await admin.auth.admin.deleteUser(id).then(() => {}, () => {});
    });

    async function nuevoUser(pref: string): Promise<{ userId: string; email: string }> {
      const email = `${pref}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({ email, password: `F8Test-${randomUUID()}`, email_confirm: true });
      if (error || !data.user) throw error ?? new Error("no se pudo crear usuario de prueba");
      userIds.push(data.user.id);
      return { userId: data.user.id, email };
    }

    async function membresiaBusiness(userId: string, email: string, tenantId: string, estado: "activo" | "suspendido" = "activo") {
      const { error } = await admin.from("dulabs_miembros_equipo").insert({ tenant_id: tenantId, user_id: userId, email, rol: "admin", estado });
      if (error) throw new Error(`seed business membership: ${error.message}`);
    }

    it("Test 2/D2 -- fila Developer ACTIVA da acceso con su rol", async () => {
      const ws = randomUUID();
      const { userId } = await nuevoUser("dev-active");
      await crearMiembro(admin, { workspaceId: ws, userId, rol: "ADMIN" });
      const efectiva = await resolverMembresiaEfectiva(admin, { userId, workspaceId: ws });
      assert.deepEqual(efectiva, { workspaceId: ws, rol: "ADMIN", fuente: "dev" });
    });

    it("Test 3/D2 -- fila Developer SUSPENDIDA bloquea acceso, incluso con membresía Business activa (prioridad Developer)", async () => {
      const ws = randomUUID();
      const { userId, email } = await nuevoUser("dev-susp");
      await membresiaBusiness(userId, email, ws, "activo"); // Business activa...
      await crearMiembro(admin, { workspaceId: ws, userId, rol: "MEMBER" });
      await cambiarRolMiembro(admin, { workspaceId: ws, membershipId: (await listarMiembros(admin, ws))[0].id, nuevoRol: "MEMBER" });
      // Suspender la fila dev directamente (no hay endpoint de suspensión en Fase 8).
      await admin.from("dulabs_dev_memberships").update({ estado: "suspendido" }).eq("workspace_id", ws).eq("user_id", userId);
      const efectiva = await resolverMembresiaEfectiva(admin, { userId, workspaceId: ws });
      assert.equal(efectiva, null, "una fila dev suspendida corta el acceso aunque Business esté activa");
    });

    it("D2 -- sin fila Developer + Business activa = OWNER implícito", async () => {
      const ws = randomUUID();
      const { userId, email } = await nuevoUser("biz-fallback");
      await membresiaBusiness(userId, email, ws, "activo");
      const efectiva = await resolverMembresiaEfectiva(admin, { userId, workspaceId: ws });
      assert.deepEqual(efectiva, { workspaceId: ws, rol: "OWNER", fuente: "business" });
    });

    it("D2 -- sin fila Developer + sin Business = sin acceso (null)", async () => {
      const ws = randomUUID();
      const { userId } = await nuevoUser("sin-nada");
      assert.equal(await resolverMembresiaEfectiva(admin, { userId, workspaceId: ws }), null);
    });

    it("Test 4/multi-workspace -- un usuario en 2 workspaces Developer los ve ambos; + fallback Business de un tercero", async () => {
      const wsA = randomUUID();
      const wsB = randomUUID();
      const wsBiz = randomUUID();
      const { userId, email } = await nuevoUser("multi");
      await crearMiembro(admin, { workspaceId: wsA, userId, rol: "OWNER" });
      await crearMiembro(admin, { workspaceId: wsB, userId, rol: "MEMBER" });
      await membresiaBusiness(userId, email, wsBiz, "activo"); // sin fila dev -> fallback OWNER

      const workspaces = await listarWorkspacesDelUsuario(admin, userId);
      const porId = new Map(workspaces.map((w) => [w.workspaceId, w.rol]));
      assert.equal(porId.get(wsA), "OWNER");
      assert.equal(porId.get(wsB), "MEMBER");
      assert.equal(porId.get(wsBiz), "OWNER", "el tenant Business sin fila dev entra como OWNER implícito");
      assert.equal(workspaces.length, 3);
    });

    it("Test 17 -- alta concurrente del mismo (workspace,user) nunca duplica: 5 upserts simultáneos = 1 sola fila", async () => {
      const ws = randomUUID();
      const { userId } = await nuevoUser("concurrente");
      await Promise.all(Array.from({ length: 5 }, () => crearMiembro(admin, { workspaceId: ws, userId, rol: "MEMBER" })));
      const { count } = await admin.from("dulabs_dev_memberships").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("user_id", userId);
      assert.equal(count, 1, "UNIQUE(workspace_id,user_id) + upsert -> nunca más de una membresía por (workspace,user)");
    });

    it("Test 18 -- dos usuarios distintos SÍ pueden estar en el mismo workspace (no es 'workspace duplicado')", async () => {
      const ws = randomUUID();
      const u1 = await nuevoUser("ws-u1");
      const u2 = await nuevoUser("ws-u2");
      await crearMiembro(admin, { workspaceId: ws, userId: u1.userId, rol: "OWNER" });
      await crearMiembro(admin, { workspaceId: ws, userId: u2.userId, rol: "MEMBER" });
      assert.equal((await listarMiembros(admin, ws)).length, 2);
    });

    it("Test 16 -- guarda de último OWNER: no se puede degradar ni eliminar al único OWNER activo", async () => {
      const ws = randomUUID();
      const { userId } = await nuevoUser("solo-owner");
      const owner = await crearMiembro(admin, { workspaceId: ws, userId, rol: "OWNER" });

      const degradar = await cambiarRolMiembro(admin, { workspaceId: ws, membershipId: owner.id, nuevoRol: "ADMIN" });
      assert.deepEqual(degradar, { ok: false, motivo: "ultimo_owner" });
      const eliminar = await eliminarMiembro(admin, { workspaceId: ws, membershipId: owner.id });
      assert.deepEqual(eliminar, { ok: false, motivo: "ultimo_owner" });

      // Sigue siendo OWNER intacto.
      const filas = await listarMiembros(admin, ws);
      assert.equal(filas[0].rol, "OWNER");
    });

    it("transferencia de ownership -- con 2 OWNERs sí se puede degradar/eliminar uno (nunca queda el workspace sin dueño)", async () => {
      const ws = randomUUID();
      const u1 = await nuevoUser("own-1");
      const u2 = await nuevoUser("own-2");
      const o1 = await crearMiembro(admin, { workspaceId: ws, userId: u1.userId, rol: "OWNER" });
      await crearMiembro(admin, { workspaceId: ws, userId: u2.userId, rol: "OWNER" });
      const degradar = await cambiarRolMiembro(admin, { workspaceId: ws, membershipId: o1.id, nuevoRol: "MEMBER" });
      assert.deepEqual(degradar, { ok: true, rol: "MEMBER" });
    });

    it("Test 16b -- guarda de último OWNER bajo CONCURRENCIA: 2 degradaciones simultáneas de 2 owners nunca dejan 0 owners", async () => {
      const ws = randomUUID();
      const u1 = await nuevoUser("cc-own-1");
      const u2 = await nuevoUser("cc-own-2");
      const o1 = await crearMiembro(admin, { workspaceId: ws, userId: u1.userId, rol: "OWNER" });
      const o2 = await crearMiembro(admin, { workspaceId: ws, userId: u2.userId, rol: "OWNER" });

      const [r1, r2] = await Promise.all([
        cambiarRolMiembro(admin, { workspaceId: ws, membershipId: o1.id, nuevoRol: "MEMBER" }),
        cambiarRolMiembro(admin, { workspaceId: ws, membershipId: o2.id, nuevoRol: "MEMBER" }),
      ]);
      const exitosas = [r1, r2].filter((r) => r.ok).length;
      assert.equal(exitosas, 1, "exactamente una degradación puede aplicarse; la otra debe fallar por 'ultimo_owner'");
      const { count } = await admin.from("dulabs_dev_memberships").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("rol", "OWNER").eq("estado", "activo");
      assert.equal(count, 1, "siempre debe quedar al menos un OWNER activo");
    });

    it("Test 19 -- cross-tenant: cambiar/eliminar un miembro con el workspace equivocado da 'no_encontrado' (nunca cruza tenant)", async () => {
      const wsA = randomUUID();
      const wsB = randomUUID();
      const u = await nuevoUser("cross");
      const enB = await crearMiembro(admin, { workspaceId: wsB, userId: u.userId, rol: "MEMBER" });

      const cambio = await cambiarRolMiembro(admin, { workspaceId: wsA, membershipId: enB.id, nuevoRol: "ADMIN" });
      assert.deepEqual(cambio, { ok: false, motivo: "no_encontrado" });
      const borrado = await eliminarMiembro(admin, { workspaceId: wsA, membershipId: enB.id });
      assert.deepEqual(borrado, { ok: false, motivo: "no_encontrado" });

      // La fila en B quedó intacta.
      assert.equal((await listarMiembros(admin, wsB))[0].rol, "MEMBER");
    });
  }
);
