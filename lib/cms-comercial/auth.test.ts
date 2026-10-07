/**
 * CMS comercial — autorización (sin red ni base de datos): matriz rol × modo × módulo, fail-closed ante errores y el negocio SIEMPRE derivado de la
 * membresía autenticada.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decideCmsAccess, requireCms, type CmsAuthDeps } from "@/lib/cms-comercial/auth";
import type { Miembro, Rol } from "@/lib/team";

const TENANT_REAL = "aaaaaaaa-0000-4000-8000-00000000000a";
const TENANT_AJENO = "bbbbbbbb-0000-4000-8000-00000000000b";

const miembro = (rol: Rol): Miembro => ({ miembroId: 7, tenantId: TENANT_REAL, userId: "d0000000-0000-4000-8000-000000000007", rol, estado: "activo" });

function deps(opts: { rol?: Rol; auth?: "ok" | "401" | "403"; modulo?: boolean | "error" } = {}): CmsAuthDeps & { consultados: string[]; etiquetas: number } {
  const estado = { consultados: [] as string[], etiquetas: 0 };
  return {
    ...estado,
    get consultados() {
      return estado.consultados;
    },
    get etiquetas() {
      return estado.etiquetas;
    },
    async authenticate() {
      if (opts.auth === "401") return { ok: false, status: 401, message: "Sesión inválida" };
      if (opts.auth === "403") return { ok: false, status: 403, message: "No tienes permiso para esta acción" };
      return { ok: true, supabase: {} as SupabaseClient, member: miembro(opts.rol ?? "admin") };
    },
    async isModuleEnabled(_s, tenantId) {
      estado.consultados.push(tenantId);
      if (opts.modulo === "error") throw new Error("db caída");
      return opts.modulo ?? true;
    },
    async etiqueta() {
      estado.etiquetas += 1;
      return "Ana Admin";
    },
  };
}

const request = (extra: { headers?: Record<string, string>; url?: string } = {}) => new NextRequest(extra.url ?? "https://www.dulabs.co/api/dashboard/tienda/entidades", { headers: { authorization: "Bearer t", ...extra.headers } });
const cuerpo = async (res: Response) => (await res.json()) as { success: boolean; error?: { code: string; message: string } };

describe("decideCmsAccess — política pura", () => {
  it("lectura: admin, agente y lectura; escritura: solo admin", () => {
    for (const role of ["admin", "agente", "lectura"] as Rol[]) assert.equal(decideCmsAccess({ role, mode: "read", moduleEnabled: true }).allowed, true, role);
    assert.equal(decideCmsAccess({ role: "admin", mode: "write", moduleEnabled: true }).allowed, true);
    for (const role of ["agente", "lectura"] as Rol[]) {
      const d = decideCmsAccess({ role, mode: "write", moduleEnabled: true });
      assert.equal(d.allowed, false, role);
      if (!d.allowed) {
        assert.equal(d.code, "FORBIDDEN");
        assert.equal(d.status, 403);
        assert.equal(d.message, "Solo un administrador puede modificar la tienda.");
      }
    }
  });

  it("módulo apagado => MODULE_DISABLED, incluso para el administrador y en lectura", () => {
    for (const mode of ["read", "write"] as const) {
      const d = decideCmsAccess({ role: "admin", mode, moduleEnabled: false });
      assert.equal(d.allowed, false);
      if (!d.allowed) assert.equal(d.code, "MODULE_DISABLED");
    }
  });

  it("el rol se evalúa antes que el módulo: un rol sin permiso no se entera de si el módulo existe", () => {
    const d = decideCmsAccess({ role: "lectura", mode: "write", moduleEnabled: false });
    assert.equal(d.allowed, false);
    if (!d.allowed) assert.equal(d.code, "FORBIDDEN");
  });
});

describe("requireCms", () => {
  it("sin sesión: 401 UNAUTHENTICATED, y no se consulta el módulo", async () => {
    const d = deps({ auth: "401" });
    const r = await requireCms(request(), "read", d);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.response.status, 401);
      assert.equal((await cuerpo(r.response)).error?.code, "UNAUTHENTICATED");
    }
    assert.deepEqual(d.consultados, []);
  });

  it("sin membresía o sin permiso de la capa de sesión: 403", async () => {
    const r = await requireCms(request(), "read", deps({ auth: "403" }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.response.status, 403);
  });

  it("el negocio sale de la MEMBRESÍA: lo que manden la URL, la consulta o los encabezados se ignora", async () => {
    const d = deps();
    const r = await requireCms(request({ url: `https://www.dulabs.co/api/dashboard/tienda/entidades?tenant=${TENANT_AJENO}&id_tenant=${TENANT_AJENO}`, headers: { "x-tenant-id": TENANT_AJENO, "x-admin-tenant-id": TENANT_AJENO } }), "read", d);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.ctx.actor.tenantId, TENANT_REAL);
      assert.equal(r.ctx.member.tenantId, TENANT_REAL);
    }
    assert.deepEqual(d.consultados, [TENANT_REAL]);
  });

  it("un error de la base al verificar el módulo es 500, jamás «permitido» (fail-closed)", async () => {
    const r = await requireCms(request(), "read", deps({ modulo: "error" }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.response.status, 500);
      assert.equal((await cuerpo(r.response)).error?.code, "INTERNAL_ERROR");
    }
  });

  it("administrador con módulo: el actor trae usuario, miembro, rol y la etiqueta para el historial (solo al escribir)", async () => {
    const d = deps();
    const lectura = await requireCms(request(), "read", d);
    assert.ok(lectura.ok);
    if (lectura.ok) assert.equal(lectura.ctx.actor.etiqueta, "");
    assert.equal(d.etiquetas, 0, "leer no necesita saber el nombre");
    const escritura = await requireCms(request(), "write", d);
    assert.ok(escritura.ok);
    if (escritura.ok) assert.deepEqual(escritura.ctx.actor, { tenantId: TENANT_REAL, userId: "d0000000-0000-4000-8000-000000000007", miembroId: 7, rol: "admin", etiqueta: "Ana Admin" });
    assert.equal(d.etiquetas, 1);
  });

  it("agente y lectura no escriben (403) y no llegan ni a pedir su etiqueta", async () => {
    for (const rol of ["agente", "lectura"] as Rol[]) {
      const d = deps({ rol });
      const r = await requireCms(request(), "write", d);
      assert.equal(r.ok, false, rol);
      if (!r.ok) {
        assert.equal(r.response.status, 403);
        assert.equal((await cuerpo(r.response)).error?.code, "FORBIDDEN");
      }
      assert.equal(d.etiquetas, 0);
    }
  });

  it("módulo apagado: 403 MODULE_DISABLED", async () => {
    const r = await requireCms(request(), "read", deps({ modulo: false }));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.response.status, 403);
      assert.equal((await cuerpo(r.response)).error?.code, "MODULE_DISABLED");
    }
  });
});
