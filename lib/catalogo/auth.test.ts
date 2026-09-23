/**
 * Catálogo — autorización (sin red ni BD): matriz rol x modo x módulo, fail-closed
 * ante errores, y el tenant SIEMPRE derivado de la membresía autenticada.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decideCatalogAccess, requireCatalogo, type CatalogAuthDeps } from "@/lib/catalogo/auth";
import type { Miembro, Rol } from "@/lib/team";

const TENANT_REAL = "0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4";
const TENANT_AJENO = "bbbbbbbb-0000-4000-8000-000000000002";

function miembro(rol: Rol): Miembro {
  return { miembroId: 1, tenantId: TENANT_REAL, userId: "user-1", rol, estado: "activo" };
}

function deps(opts: { rol?: Rol; auth?: "ok" | "401" | "403"; modulo?: boolean | "error" } = {}): CatalogAuthDeps & { consultados: string[] } {
  const consultados: string[] = [];
  return {
    consultados,
    async authenticate() {
      if (opts.auth === "401") return { ok: false, status: 401, message: "Sesión inválida" };
      if (opts.auth === "403") return { ok: false, status: 403, message: "No tienes permiso para esta acción" };
      return { ok: true, supabase: {} as SupabaseClient, member: miembro(opts.rol ?? "admin") };
    },
    async isModuleEnabled(_supabase, tenantId) {
      consultados.push(tenantId);
      if (opts.modulo === "error") throw new Error("db caída");
      return opts.modulo ?? true;
    },
  };
}

function request(extra: { headers?: Record<string, string>; url?: string } = {}) {
  return new NextRequest(extra.url ?? "https://www.dulabs.co/api/dashboard/catalogo/productos", { headers: { authorization: "Bearer t", ...extra.headers } });
}

async function cuerpo(res: Response) {
  return (await res.json()) as { success: boolean; error?: { code: string; message: string } };
}

describe("decideCatalogAccess — política pura", () => {
  it("lectura: admin, agente y lectura; escritura: solo admin", () => {
    for (const role of ["admin", "agente", "lectura"] as Rol[]) {
      assert.equal(decideCatalogAccess({ role, mode: "read", moduleEnabled: true }).allowed, true, role);
    }
    assert.equal(decideCatalogAccess({ role: "admin", mode: "write", moduleEnabled: true }).allowed, true);
    for (const role of ["agente", "lectura"] as Rol[]) {
      const d = decideCatalogAccess({ role, mode: "write", moduleEnabled: true });
      assert.equal(d.allowed, false, role);
      if (!d.allowed) assert.equal(d.code, "FORBIDDEN");
    }
  });

  it("módulo apagado => MODULE_DISABLED, incluso para admin", () => {
    const d = decideCatalogAccess({ role: "admin", mode: "read", moduleEnabled: false });
    assert.equal(d.allowed, false);
    if (!d.allowed) assert.equal(d.code, "MODULE_DISABLED");
  });
});

describe("requireCatalogo — composición", () => {
  it("sin sesión => 401 con envelope uniforme", async () => {
    const r = await requireCatalogo(request(), "read", deps({ auth: "401" }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.response.status, 401);
    assert.equal((await cuerpo(r.response)).error?.code, "UNAUTHENTICATED");
  });

  it("rol sin permiso de escritura => 403 FORBIDDEN", async () => {
    const r = await requireCatalogo(request(), "write", deps({ rol: "agente" }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.response.status, 403);
    assert.equal((await cuerpo(r.response)).error?.code, "FORBIDDEN");
  });

  it("módulo no habilitado => 403 MODULE_DISABLED", async () => {
    const r = await requireCatalogo(request(), "read", deps({ modulo: false }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal((await cuerpo(r.response)).error?.code, "MODULE_DISABLED");
  });

  it("error verificando el módulo => 500 (fail-closed, nunca 'permitido')", async () => {
    const r = await requireCatalogo(request(), "write", deps({ modulo: "error" }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.response.status, 500);
    assert.equal((await cuerpo(r.response)).error?.code, "INTERNAL_ERROR");
  });

  it("el tenant SIEMPRE sale de la membresía: headers/query de otro tenant se ignoran", async () => {
    const d = deps({ rol: "admin" });
    const r = await requireCatalogo(
      request({
        headers: { "x-admin-tenant-id": TENANT_AJENO, "x-tenant-id": TENANT_AJENO },
        url: `https://www.dulabs.co/api/dashboard/catalogo/productos?tenantId=${TENANT_AJENO}&id_tenant=${TENANT_AJENO}`,
      }),
      "write",
      d,
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.ctx.actor.tenantId, TENANT_REAL);
    assert.deepEqual(d.consultados, [TENANT_REAL]);
  });
});
