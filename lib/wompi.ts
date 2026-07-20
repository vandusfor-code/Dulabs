import crypto from "node:crypto";

// Base de Wompi según el ambiente de la llave privada configurada
// (test_ = sandbox, prod_ = producción). Nunca mezclar llaves de ambientes.
function baseUrl(): string {
  const key = process.env.WOMPI_PRIVATE_KEY ?? "";
  return key.includes("_test_")
    ? "https://sandbox.wompi.co/v1"
    : "https://production.wompi.co/v1";
}

type WompiResponse<T> = { data: T } | { error: { type?: string; reason?: string; messages?: unknown } };

async function wompiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const privateKey = process.env.WOMPI_PRIVATE_KEY;
  if (!privateKey) throw new Error("Falta WOMPI_PRIVATE_KEY en el servidor");

  const res = await fetch(`${baseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${privateKey}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const json = (await res.json()) as WompiResponse<T>;
  if (!res.ok || "error" in json) {
    const reason = "error" in json ? json.error?.reason ?? JSON.stringify(json.error) : res.statusText;
    throw new Error(`Wompi respondió ${res.status}: ${reason}`);
  }
  return json.data;
}

export type FuentePago = { id: number; type: string; status: string };

export async function crearFuentePago(params: {
  token: string;
  customer_email: string;
  acceptance_token: string;
  accept_personal_auth: string;
}): Promise<FuentePago> {
  return wompiRequest<FuentePago>("/payment_sources", {
    method: "POST",
    body: { type: "CARD", ...params },
  });
}

export type Transaccion = {
  id: string;
  status: "APPROVED" | "DECLINED" | "PENDING" | "ERROR" | "VOIDED";
  amount_in_cents: number;
};

function firmaIntegridad(reference: string, amountInCents: number, currency: string): string {
  const integrityKey = process.env.WOMPI_INTEGRITY_KEY;
  if (!integrityKey) throw new Error("Falta WOMPI_INTEGRITY_KEY en el servidor");
  const cadena = `${reference}${amountInCents}${currency}${integrityKey}`;
  return crypto.createHash("sha256").update(cadena).digest("hex");
}

export async function crearTransaccion(params: {
  amount_in_cents: number;
  customer_email: string;
  reference: string;
  payment_source_id: number;
  recurrent?: boolean;
}): Promise<Transaccion> {
  return wompiRequest<Transaccion>("/transactions", {
    method: "POST",
    // installments: 1 = pago de contado (nuestras suscripciones no manejan
    // cuotas), pero Wompi lo exige como campo obligatorio igual.
    // signature: firma de integridad exigida también en creación server-side.
    body: {
      currency: "COP",
      payment_method: { installments: 1 },
      signature: firmaIntegridad(params.reference, params.amount_in_cents, "COP"),
      ...params,
    },
  });
}

// Verifica la firma de un evento de webhook (docs.wompi.co/en/docs/colombia/eventos).
export function verificarChecksumEvento(payload: {
  data: Record<string, unknown>;
  signature: { properties: string[]; checksum: string };
  timestamp: number;
}): boolean {
  const eventsKey = process.env.WOMPI_EVENTS_KEY;
  if (!eventsKey) return false;

  const valores = payload.signature.properties.map((ruta) => {
    const partes = ruta.split(".").slice(1); // "transaction.id" -> ["id"]
    let valor: unknown = payload.data;
    for (const parte of partes) {
      valor = (valor as Record<string, unknown> | undefined)?.[parte];
    }
    return String(valor ?? "");
  });

  const cadena = valores.join("") + payload.timestamp + eventsKey;
  const checksumCalculado = crypto.createHash("sha256").update(cadena).digest("hex").toUpperCase();
  const checksumRecibido = (payload.signature.checksum ?? "").toUpperCase();

  // Comparación en tiempo constante (igual que verificarFirmaMeta en
  // lib/meta-firma.ts) — timingSafeEqual exige buffers del mismo largo, así
  // que un checksum recibido con longitud distinta se rechaza directo.
  const a = Buffer.from(checksumCalculado, "utf8");
  const b = Buffer.from(checksumRecibido, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
