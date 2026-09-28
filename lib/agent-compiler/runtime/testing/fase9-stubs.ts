// Business Agent 2.0, FASE 9 — dobles de prueba mínimos (nunca se usan en producción).

import type { UnderstandingProvider } from "@/lib/agent-compiler/understanding/provider";

/** Proveedor de entendimiento que responde OK y cuenta llamadas (para límites por tenant). */
export function createUnderstandingProviderStub(): UnderstandingProvider & { calls: number } {
  const stub = {
    name: "stub",
    calls: 0,
    async understand() {
      stub.calls++;
      return { ok: true as const, output: {}, provider: "stub" };
    },
  };
  return stub;
}
