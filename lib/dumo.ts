import { descifrarSecreto } from "@/lib/crypto";
import type { ClienteConfig } from "@/lib/supabase";

const DUMO_REGISTER_URL = "https://du-mo.vercel.app/api/whatsapp/register-number";

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
