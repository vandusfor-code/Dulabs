/**
 * Etapa 5 (Flow Builder, autorizado) — tests de version-history.ts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasNewerDraftThanPublished, isPublishedVersion } from "@/lib/flow-builder/version-history";
import type { FlowVersionRow } from "@/lib/flow/flow-store-types";

function version(overrides: Partial<FlowVersionRow>): FlowVersionRow {
  return {
    tenant_id: "t1",
    id: "v-default",
    flow_id: "f1",
    version_number: 1,
    definition_json: {},
    published_at: null,
    retired_at: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("isPublishedVersion", () => {
  it("true cuando el id coincide con publishedVersionId", () => {
    const v = version({ id: "v3" });
    assert.equal(isPublishedVersion(v, "v3"), true);
  });

  it("false cuando el id NO coincide, aunque published_at esté seteado", () => {
    // caso real detectado en la auditoría: v3 tuvo published_at seteado en su
    // momento, pero ya se publicó v5 después -- v3 ya NO es la publicada.
    const v3 = version({ id: "v3", published_at: "2026-01-01T00:00:00Z" });
    assert.equal(isPublishedVersion(v3, "v5"), false);
  });

  it("false cuando publishedVersionId es null (flow nunca publicado)", () => {
    const v = version({ id: "v1" });
    assert.equal(isPublishedVersion(v, null), false);
  });

  it("NO usa published_at para decidir -- una version con published_at null puede ser la publicada actual", () => {
    // esto no debería pasar en datos reales (la RPC siempre setea published_at
    // al publicar), pero la función no debe depender de ese campo en absoluto.
    const v = version({ id: "v2", published_at: null });
    assert.equal(isPublishedVersion(v, "v2"), true);
  });
});

describe("hasNewerDraftThanPublished", () => {
  it("true cuando existe una versión con version_number mayor a la publicada", () => {
    const versions = [
      version({ id: "v2", version_number: 2, published_at: null }),
      version({ id: "v1", version_number: 1, published_at: "2026-01-01T00:00:00Z" }),
    ];
    assert.equal(hasNewerDraftThanPublished(versions, "v1"), true);
  });

  it("false cuando no existe ninguna versión más nueva que la publicada", () => {
    const versions = [version({ id: "v1", version_number: 1, published_at: "2026-01-01T00:00:00Z" })];
    assert.equal(hasNewerDraftThanPublished(versions, "v1"), false);
  });

  it("false cuando publishedVersionId es null (flow nunca publicado)", () => {
    const versions = [version({ id: "v1", version_number: 1 })];
    assert.equal(hasNewerDraftThanPublished(versions, null), false);
  });

  it("false cuando la publicada actual ya no aparece en la lista (sin base de comparación)", () => {
    const versions = [version({ id: "v2", version_number: 2 })];
    assert.equal(hasNewerDraftThanPublished(versions, "v-no-existe"), false);
  });

  it("false cuando la lista solo tiene versiones MÁS VIEJAS que la publicada", () => {
    const versions = [
      version({ id: "v1", version_number: 1 }),
      version({ id: "v3", version_number: 3, published_at: "2026-01-01T00:00:00Z" }),
    ];
    assert.equal(hasNewerDraftThanPublished(versions, "v3"), false);
  });
});
