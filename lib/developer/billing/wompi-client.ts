import crypto from "node:crypto";

// DuLabs Developer V1 -- Fase 12 (Billing). Cliente Wompi PROPIO de Developer.
// Reutiliza el PATRÓN probado de Business (lib/wompi.ts) pero es código aislado
// con sus PROPIAS llaves (DEVELOPER_WOMPI_*) y su propio comercio Wompi, para no
// acoplar dominios ni compartir el webhook de Business. La tarjeta NUNCA pasa
// por el servidor: el navegador la tokeniza con la public key y aquí solo se
// usa el token. Cobro en COP (Wompi no procesa USD).

function baseUrl(): string {
  const key = process.env.DEVELOPER_WOMPI_PRIVATE_KEY ?? "";
  return key.includes("_test_") ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1";
}

type WompiResponse<T> = { data: T } | { error: { type?: string; reason?: string; messages?: unknown } };

async function wompiRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const privateKey = process.env.DEVELOPER_WOMPI_PRIVATE_KEY;
  if (!privateKey) throw new Error("Falta DEVELOPER_WOMPI_PRIVATE_KEY en el servidor");
  const res = await fetch(`${baseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers: { Authorization: `Bearer ${privateKey}`, "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = (await res.json()) as WompiResponse<T>;
  if (!res.ok || "error" in json) {
    const reason = "error" in json ? json.error?.reason ?? JSON.stringify(json.error) : res.statusText;
    throw new Error(`Wompi(dev) respondió ${res.status}: ${reason}`);
  }
  return json.data;
}

export type FuentePagoDev = { id: number; type: string; status: string };

export async function crearFuentePagoDev(params: {
  token: string;
  customer_email: string;
  acceptance_token: string;
  accept_personal_auth: string;
}): Promise<FuentePagoDev> {
  return wompiRequest<FuentePagoDev>("/payment_sources", { method: "POST", body: { type: "CARD", ...params } });
}

export type EstadoWompi = "APPROVED" | "DECLINED" | "PENDING" | "ERROR" | "VOIDED";
export type TransaccionDev = { id: string; status: EstadoWompi; amount_in_cents: number };

function firmaIntegridad(reference: string, amountInCents: number, currency: string): string {
  const integrityKey = process.env.DEVELOPER_WOMPI_INTEGRITY_KEY;
  if (!integrityKey) throw new Error("Falta DEVELOPER_WOMPI_INTEGRITY_KEY en el servidor");
  return crypto.createHash("sha256").update(`${reference}${amountInCents}${currency}${integrityKey}`).digest("hex");
}

/** Crea una transacción en COP (Wompi no procesa USD). El monto COP se resolvió server-side vía FX. */
export async function crearTransaccionDev(params: {
  amount_in_cents: number; // COP cents
  customer_email: string;
  reference: string;
  payment_source_id: number;
  recurrent?: boolean;
}): Promise<TransaccionDev> {
  return wompiRequest<TransaccionDev>("/transactions", {
    method: "POST",
    body: {
      currency: "COP",
      payment_method: { installments: 1 },
      signature: firmaIntegridad(params.reference, params.amount_in_cents, "COP"),
      ...params,
    },
  });
}

// Verifica la firma de un evento de webhook de Wompi (docs.wompi.co eventos).
// Mismo algoritmo que Business, con la EVENTS_KEY de Developer. Comparación en
// tiempo constante. Navega desde payload.data por la ruta completa
// ("transaction.id" -> payload.data.transaction.id).
export function verificarChecksumEventoDev(payload: {
  data: Record<string, unknown>;
  signature: { properties: string[]; checksum: string };
  timestamp: number;
}): boolean {
  const eventsKey = process.env.DEVELOPER_WOMPI_EVENTS_KEY;
  if (!eventsKey) return false;
  const valores = payload.signature.properties.map((ruta) => {
    let valor: unknown = payload.data;
    for (const parte of ruta.split(".")) valor = (valor as Record<string, unknown> | undefined)?.[parte];
    return String(valor ?? "");
  });
  const cadena = valores.join("") + payload.timestamp + eventsKey;
  const calculado = crypto.createHash("sha256").update(cadena).digest("hex").toUpperCase();
  const recibido = (payload.signature.checksum ?? "").toUpperCase();
  const a = Buffer.from(calculado, "utf8");
  const b = Buffer.from(recibido, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Mapea el status crudo de Wompi al efecto sobre la suscripción de Developer. */
export function estadoDesdeWompi(status: string): "active" | "pendiente" | "fallido" {
  if (status === "APPROVED") return "active";
  if (status === "PENDING") return "pendiente";
  return "fallido"; // DECLINED | ERROR | VOIDED | desconocido
}
