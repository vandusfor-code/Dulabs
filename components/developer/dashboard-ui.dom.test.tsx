import "@/lib/test-helpers/jsdom-setup";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";
import { StatCard } from "@/components/developer/StatCard";
import { UsageProgress } from "@/components/developer/UsageProgress";
import { EmptyState } from "@/components/developer/EmptyState";
import { ErrorState } from "@/components/developer/ErrorState";
import { DataTable } from "@/components/developer/DataTable";
import { SecretRevealDialog } from "@/components/developer/SecretRevealDialog";
import { DevApiError } from "@/lib/dev-dashboard/dev-client";

// DuLabs Developer V1 -- Fase 9 (autorizado, D6). Tests DOM reales con
// jsdom + Testing Library. Cubren estados de UI (usage, empty, error),
// mapeo 403 -> mensaje de permisos, y la garantía de que NUNCA se renderiza
// un secreto que no está en las columnas declaradas.

describe("DuLabs Developer V1 — UI del Dashboard (DOM, Fase 9)", () => {
  afterEach(() => cleanup());

  it("Test 13 -- UsageProgress muestra porcentaje cuando hay límite", () => {
    render(<UsageProgress used={50} included={100} unidad="messages" />);
    assert.ok(screen.getByText("50%"));
    const bar = screen.getByRole("progressbar");
    assert.equal(bar.getAttribute("aria-valuenow"), "50");
  });

  it("Test 13b -- UsageProgress muestra 'Unlimited' cuando el plan no tiene límite", () => {
    render(<UsageProgress used={9999} included={null} />);
    assert.ok(screen.getByText("Unlimited"));
  });

  it("StatCard muestra label y valor", () => {
    render(<StatCard label="Plan" value="DEVELOPER" />);
    assert.ok(screen.getByText("Plan"));
    assert.ok(screen.getByText("DEVELOPER"));
  });

  it("Test 18 -- EmptyState muestra mensaje y CTA", () => {
    render(<EmptyState title="No API keys yet" description="Create your first key" action={<button>Create</button>} />);
    assert.ok(screen.getByText("No API keys yet"));
    assert.ok(screen.getByText("Create"));
  });

  it("Test 19/24 -- ErrorState mapea 403 a mensaje de permisos y muestra el request_id", () => {
    const err = new DevApiError({ kind: "forbidden", status: 403, code: "forbidden", requestId: "dev_abc123" });
    render(<ErrorState error={err} />);
    assert.match(screen.getByText(/permisos/i).textContent ?? "", /permisos/i);
    assert.ok(screen.getByText(/dev_abc123/));
  });

  it("Test 25 -- ErrorState distingue cuota mensual (429 quota)", () => {
    const err = new DevApiError({ kind: "quota", status: 429, code: "monthly_message_limit_exceeded", requestId: "r" });
    render(<ErrorState error={err} />);
    assert.ok(screen.getByText(/cuota mensual/i));
  });

  it("Tests 15/16/17 -- DataTable renderiza filas según las columnas declaradas", () => {
    render(
      <DataTable
        rows={[{ id: "1", name: "prod-key" }]}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", header: "Name", render: (r) => <span>{r.name}</span> },
        ]}
      />
    );
    assert.ok(screen.getByText("prod-key"));
    assert.ok(screen.getByText("Name"));
  });

  it("Test 21 -- DataTable NUNCA renderiza un campo que no está en las columnas (no-secrets-rendered)", () => {
    render(
      <DataTable
        rows={[{ id: "1", name: "k", secreto: "dl_live_LEAKED_SECRET" }]}
        rowKey={(r) => r.id}
        columns={[{ key: "name", header: "Name", render: (r) => <span>{r.name}</span> }]}
      />
    );
    assert.equal(screen.queryByText("dl_live_LEAKED_SECRET"), null, "un valor fuera de las columnas nunca llega al DOM");
  });

  it("Test 10 -- SecretRevealDialog muestra el secreto (una sola vez) con la advertencia", () => {
    render(<SecretRevealDialog open title="Your new API key" secret="dl_live_ONCE_ONLY_abc" onClose={() => {}} />);
    assert.ok(screen.getByTestId("secret-value").textContent?.includes("dl_live_ONCE_ONLY_abc"));
    assert.match(document.body.textContent ?? "", /can.t be shown again/i);
  });
});
