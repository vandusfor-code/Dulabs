/**
 * FASE F14 (SaaS Commercial Readiness, autorizado) — mock de Wompi reutilizable
 * para tests de billing/idempotencia, mismo patrón que lib/testing/meta-graph-mock.ts:
 * intercepta `fetch` SOLO hacia sandbox.wompi.co/production.wompi.co (cualquier otro
 * host se delega al fetch real, así nunca bloquea las llamadas internas de Supabase
 * que corren en paralelo dentro del mismo proceso de test). Nunca se importa desde
 * código de producción -- solo desde archivos *.test.ts / *.e2e.test.ts.
 */

export type WompiMockTransaccion = {
  status: "APPROVED" | "DECLINED" | "PENDING" | "ERROR" | "VOIDED";
  id?: string;
};

export interface WompiMockLlamada {
  path: string;
  method: string;
  body: unknown;
}

export function instalarWompiMock(opts?: {
  /** Cola de respuestas para POST /transactions, consumida en orden (shift). Repite la última cuando se vacía. */
  colaTransacciones?: WompiMockTransaccion[];
  /** status por defecto de la fuente de pago creada en POST /payment_sources. */
  estadoFuentePago?: string;
}) {
  const original = global.fetch;
  const llamadas: WompiMockLlamada[] = [];
  const cola = [...(opts?.colaTransacciones ?? [{ status: "APPROVED" as const }])];
  let contadorTransacciones = 0;

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("sandbox.wompi.co") && !url.includes("production.wompi.co")) {
      return original(input, init);
    }

    const method = init?.method ?? "GET";
    let bodyParsed: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        bodyParsed = JSON.parse(init.body);
      } catch {
        bodyParsed = init.body;
      }
    }
    llamadas.push({ path: url, method, body: bodyParsed });

    if (url.includes("/payment_sources")) {
      return new Response(
        JSON.stringify({ data: { id: 900000 + contadorTransacciones, type: "CARD", status: opts?.estadoFuentePago ?? "AVAILABLE" } }),
        { status: 201 },
      );
    }
    if (url.includes("/transactions")) {
      contadorTransacciones += 1;
      const siguiente = cola.length > 1 ? cola.shift()! : cola[0];
      const id = siguiente.id ?? `mock-tx-${Date.now()}-${contadorTransacciones}`;
      return new Response(
        JSON.stringify({ data: { id, status: siguiente.status, amount_in_cents: 0 } }),
        { status: 201 },
      );
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }) as typeof fetch;

  return {
    llamadas,
    numeroDeCargosIntentados: () => llamadas.filter((l) => l.path.includes("/transactions")).length,
    restaurar: () => {
      global.fetch = original;
    },
  };
}

/** Construye un payload de webhook de Wompi con checksum válido, usando WOMPI_EVENTS_KEY del entorno de test. */
export async function construirEventoWompiFirmado(params: {
  transactionId: string;
  status: string;
  amountInCents?: number;
  timestamp?: number;
}): Promise<{ event: string; data: { transaction: { id: string; status: string; amount_in_cents: number } }; signature: { properties: string[]; checksum: string }; timestamp: number }> {
  const crypto = await import("node:crypto");
  const eventsKey = process.env.WOMPI_EVENTS_KEY;
  if (!eventsKey) throw new Error("Falta WOMPI_EVENTS_KEY en el entorno de test");
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
  const amount = params.amountInCents ?? 0;
  const properties = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];
  const cadena = `${params.transactionId}${params.status}${amount}${timestamp}${eventsKey}`;
  const checksum = crypto.createHash("sha256").update(cadena).digest("hex").toUpperCase();
  return {
    event: "transaction.updated",
    data: { transaction: { id: params.transactionId, status: params.status, amount_in_cents: amount } },
    signature: { properties, checksum },
    timestamp,
  };
}
