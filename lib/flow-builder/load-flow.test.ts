/**
 * Etapa 1 (Flow Builder, autorizado) — tests de buildFlowLoadResult() y
 * findNodeById(), sin red ni React: se le pasan respuestas ya "parseadas"
 * con la misma forma que produce fetch() contra GET /api/flows/[id] y
 * GET /api/flows/[id]/versions.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFlowLoadResult, findNodeById } from "@/lib/flow-builder/load-flow";
import type { FlowRow, FlowVersionRow } from "@/lib/flow/flow-store-types";
import type { FlowDefinition } from "@/lib/flow/types";

const FLOW: FlowRow = {
  tenant_id: "t1",
  id: "flow-1",
  slug: "soporte",
  name: "Soporte",
  description: null,
  status: "published",
  published_version_id: "v2",
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function versions(): FlowVersionRow[] {
  return [
    {
      tenant_id: "t1",
      id: "v1",
      flow_id: "flow-1",
      version_number: 1,
      definition_json: {},
      published_at: null,
      retired_at: null,
      created_by: null,
      created_at: new Date().toISOString(),
    },
    {
      tenant_id: "t1",
      id: "v2",
      flow_id: "flow-1",
      version_number: 2,
      definition_json: {},
      published_at: new Date().toISOString(),
      retired_at: null,
      created_by: null,
      created_at: new Date().toISOString(),
    },
  ];
}

describe("buildFlowLoadResult", () => {
  it("1. 404 en GET /api/flows/[id] -> not_found (sin intentar Supabase)", () => {
    const result = buildFlowLoadResult(
      { ok: false, status: 404, json: { error: "Flow no encontrado" } },
      { ok: true, status: 200, json: { versions: [] } },
    );
    assert.deepEqual(result, { kind: "not_found" });
  });

  it("2. error de API (500) en GET /api/flows/[id] -> error con el mensaje del backend", () => {
    const result = buildFlowLoadResult(
      { ok: false, status: 500, json: { error: "Error inesperado" } },
      { ok: true, status: 200, json: { versions: [] } },
    );
    assert.deepEqual(result, { kind: "error", message: "Error inesperado" });
  });

  it("3. flow ok + versiones ok, con versión publicada -> loaded con esa versión", () => {
    const result = buildFlowLoadResult(
      { ok: true, status: 200, json: { flow: FLOW } },
      { ok: true, status: 200, json: { versions: versions() } },
    );
    assert.equal(result.kind, "loaded");
    assert.equal(result.kind === "loaded" ? result.version.id : null, "v2");
  });

  it("4. flow ok sin published_version_id -> loaded con la versión más reciente (fallback)", () => {
    const flowSinPublicar: FlowRow = { ...FLOW, published_version_id: null, status: "draft" };
    const result = buildFlowLoadResult(
      { ok: true, status: 200, json: { flow: flowSinPublicar } },
      { ok: true, status: 200, json: { versions: versions() } },
    );
    assert.equal(result.kind, "loaded");
    assert.equal(result.kind === "loaded" ? result.version.id : null, "v2");
  });

  it("5. flow ok pero sin versiones -> no_versions", () => {
    const result = buildFlowLoadResult(
      { ok: true, status: 200, json: { flow: FLOW } },
      { ok: true, status: 200, json: { versions: [] } },
    );
    assert.deepEqual(result, { kind: "no_versions", flow: FLOW });
  });

  it("6. error en GET /api/flows/[id]/versions -> error", () => {
    const result = buildFlowLoadResult(
      { ok: true, status: 200, json: { flow: FLOW } },
      { ok: false, status: 500, json: { error: "Error cargando versiones" } },
    );
    assert.deepEqual(result, { kind: "error", message: "Error cargando versiones" });
  });
});

describe("findNodeById", () => {
  const flow: FlowDefinition = {
    name: "x",
    nodes: [
      { id: "start", type: "start", config: { triggerType: "first_message" } },
      { id: "msg-1", type: "message", config: { text: "hola" } },
    ],
    edges: [],
    variables: [],
  };

  it("7. selección de nodo -> encuentra el nodo por id", () => {
    const node = findNodeById(flow, "msg-1");
    assert.equal(node?.id, "msg-1");
    assert.equal(node?.type, "message");
  });

  it("8. sin selección (null) -> null", () => {
    assert.equal(findNodeById(flow, null), null);
  });

  it("9. id que no existe en el Flow -> null", () => {
    assert.equal(findNodeById(flow, "no-existe"), null);
  });
});
