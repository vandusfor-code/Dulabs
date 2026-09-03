/**
 * Etapa 1 (Flow Builder, autorizado) — tests de selección de versión.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectVersionToDisplay } from "@/lib/flow-builder/select-version";
import type { FlowVersionRow } from "@/lib/flow/flow-store-types";

function version(overrides: Partial<FlowVersionRow>): FlowVersionRow {
  return {
    tenant_id: "t1",
    id: "v1",
    flow_id: "f1",
    version_number: 1,
    definition_json: {},
    published_at: null,
    retired_at: null,
    created_by: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("selectVersionToDisplay", () => {
  it("1. sin versiones -> null", () => {
    assert.equal(selectVersionToDisplay({ published_version_id: null }, []), null);
  });

  it("2. hay published_version_id y aparece en la lista -> se prefiere sobre versiones más nuevas", () => {
    const v1 = version({ id: "v1", version_number: 1 });
    const v2Published = version({ id: "v2", version_number: 2 });
    const v3 = version({ id: "v3", version_number: 3 });
    const result = selectVersionToDisplay({ published_version_id: "v2" }, [v3, v2Published, v1]);
    assert.equal(result?.id, "v2");
  });

  it("3. sin published_version_id -> la de version_number más alto", () => {
    const v1 = version({ id: "v1", version_number: 1 });
    const v3 = version({ id: "v3", version_number: 3 });
    const v2 = version({ id: "v2", version_number: 2 });
    const result = selectVersionToDisplay({ published_version_id: null }, [v1, v3, v2]);
    assert.equal(result?.id, "v3");
  });

  it("4. published_version_id no aparece en la lista (versión retirada/borrada) -> cae a la más reciente", () => {
    const v1 = version({ id: "v1", version_number: 1 });
    const v2 = version({ id: "v2", version_number: 2 });
    const result = selectVersionToDisplay({ published_version_id: "no-existe" }, [v1, v2]);
    assert.equal(result?.id, "v2");
  });
});
