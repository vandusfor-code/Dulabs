import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  obtenerInstalacionDeWorkspace,
  obtenerRepoDeWorkspace,
  guardarInstalacion,
  marcarInstalacionesPorInstallationId,
} from "@/lib/developer/github/github-installations-store";
import type { GithubInstallation } from "@/lib/developer/github/github-app-client";

type Op = { table: string; method: string; filtros: Record<string, string | number>; payload?: Record<string, unknown>; onConflict?: string };

// Fake thenable (como el PostgrestBuilder real): resuelve tanto en
// single()/maybeSingle() como al await directo, consumiendo de una cola de
// resultados. Registra tabla, método, filtros y payload de cada query.
function fakeSupabase(cola: Array<{ data: unknown; error: { message: string } | null }>) {
  const ops: Op[] = [];
  function nuevaCadena(): Record<string, unknown> {
    const op: Op = { table: "", method: "select", filtros: {} };
    ops.push(op);
    const next = async () => cola.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: (r: Record<string, unknown>) => ((op.method = "insert"), (op.payload = r), chain),
      upsert: (r: Record<string, unknown>, o?: { onConflict?: string }) => ((op.method = "upsert"), (op.payload = r), (op.onConflict = o?.onConflict), chain),
      update: (r: Record<string, unknown>) => ((op.method = "update"), (op.payload = r), chain),
      delete: () => ((op.method = "delete"), chain),
      eq: (c: string, v: string | number) => ((op.filtros[c] = v), chain),
      in: () => chain,
      lt: () => chain,
      single: next,
      maybeSingle: next,
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => next().then(onF, onR),
    };
    return chain;
  }
  const supabase = {
    from: (t: string) => {
      const c = nuevaCadena();
      ops[ops.length - 1].table = t;
      return c;
    },
    _ops: () => ops,
  };
  return supabase as unknown as SupabaseClient & { _ops: () => Op[] };
}

describe("lecturas SCOPED por workspace (aislamiento tenant)", () => {
  it("obtenerInstalacionDeWorkspace filtra por workspace_id y tabla correcta", async () => {
    const supabase = fakeSupabase([{ data: { id: "i1", workspace_id: "ws-A" }, error: null }]);
    await obtenerInstalacionDeWorkspace(supabase, "ws-A");
    const op = supabase._ops()[0];
    assert.equal(op.table, "dulabs_dev_github_installations");
    assert.equal(op.filtros.workspace_id, "ws-A");
  });

  it("obtenerRepoDeWorkspace filtra por workspace_id", async () => {
    const supabase = fakeSupabase([{ data: { id: "r1", workspace_id: "ws-B" }, error: null }]);
    await obtenerRepoDeWorkspace(supabase, "ws-B");
    const op = supabase._ops()[0];
    assert.equal(op.table, "dulabs_dev_github_repos");
    assert.equal(op.filtros.workspace_id, "ws-B");
  });
});

describe("guardarInstalacion", () => {
  const inst = (suspended: boolean): GithubInstallation => ({
    id: 4242,
    accountLogin: "acme",
    accountId: 7,
    accountType: "Organization",
    suspended,
  });

  it("upsert por workspace_id; estado 'activo' si no está suspendida", async () => {
    const supabase = fakeSupabase([{ data: { id: "i1", workspace_id: "ws-1", installation_id: 4242, estado: "activo" }, error: null }]);
    await guardarInstalacion(supabase, { workspaceId: "ws-1", installation: inst(false) });
    const op = supabase._ops()[0];
    assert.equal(op.method, "upsert");
    assert.equal(op.onConflict, "workspace_id");
    assert.equal(op.payload?.workspace_id, "ws-1");
    assert.equal(op.payload?.installation_id, 4242);
    assert.equal(op.payload?.estado, "activo");
  });

  it("estado 'sin_acceso' cuando GitHub reporta la instalación suspendida", async () => {
    const supabase = fakeSupabase([{ data: { id: "i1", estado: "sin_acceso" }, error: null }]);
    await guardarInstalacion(supabase, { workspaceId: "ws-1", installation: inst(true) });
    assert.equal(supabase._ops()[0].payload?.estado, "sin_acceso");
  });
});

describe("operaciones de webhook por installation_id (no workspace)", () => {
  it("marcarInstalacionesPorInstallationId filtra por installation_id y devuelve el conteo", async () => {
    const supabase = fakeSupabase([{ data: [{ id: "a" }, { id: "b" }], error: null }]);
    const n = await marcarInstalacionesPorInstallationId(supabase, { installationId: 4242, estado: "desconectado" });
    assert.equal(n, 2);
    const op = supabase._ops()[0];
    assert.equal(op.method, "update");
    assert.equal(op.filtros.installation_id, 4242);
    assert.equal("workspace_id" in op.filtros, false, "el webhook NO scoping por workspace");
    assert.equal(op.payload?.estado, "desconectado");
  });
});
