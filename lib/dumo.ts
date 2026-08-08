import { descifrarSecreto } from "@/lib/crypto";
import type { ClienteConfig } from "@/lib/supabase";

const DUMO_REGISTER_URL = "https://du-mo.vercel.app/api/whatsapp/register-number";
const DUMO_WEBHOOK_URL = "https://du-mo.vercel.app/api/whatsapp/webhook";

export type RegistroDumoInput = {
  phoneNumberId: string;
  displayPhone: string;
  wabaId: string;
  label: string;
  accessToken: string;
};

/** Token de envío del tenant (mismo criterio que el webhook de dulabs). */
export function resolverTokenMeta(cliente: Pick<ClienteConfig, "meta_permanent_token">): string | null {
  return cliente.meta_permanent_token
    ? descifrarSecreto(cliente.meta_permanent_token)
    : (process.env.META_ACCESS_TOKEN ?? null);
}

/** Registra o actualiza un número conectado en DuMo (token + metadatos). */
export async function registrarNumeroEnDumo(input: RegistroDumoInput): Promise<void> {
  const secret = process.env.DUMO_FORWARD_SECRET;
  if (!secret) {
    throw new Error("DUMO_FORWARD_SECRET no configurado en el servidor");
  }

  const res = await fetch(DUMO_REGISTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DuMo-Forward-Secret": secret,
    },
    body: JSON.stringify({
      phoneNumberId: input.phoneNumberId,
      displayPhone: input.displayPhone,
      wabaId: input.wabaId,
      label: input.label,
      accessToken: input.accessToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DuMo respondió ${res.status}${text ? `: ${text}` : ""}`);
  }
}

/** Reenvía un change de Meta tal cual a DuMo (messages, history, statuses, etc.). */
export async function reenviarWebhookADumo(change: {
  field: string;
  value: Record<string, unknown>;
}): Promise<boolean> {
  const secret = process.env.DUMO_FORWARD_SECRET;
  if (!secret) {
    console.error("[dumo] DUMO_FORWARD_SECRET no configurado");
    return false;
  }

  const phoneId = (change.value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id ?? "?";
  try {
    const res = await fetch(DUMO_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DuMo-Forward-Secret": secret,
      },
      body: JSON.stringify({ entry: [{ changes: [change] }] }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[dumo] DuMo respondió ${res.status} (phoneId=${phoneId}, field=${change.field})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("[dumo] error reenviando a DuMo:", err instanceof Error ? err.message : err);
    return false;
  }
}
