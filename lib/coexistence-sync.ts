const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;

export type SyncCoexistenciaTipo = "history" | "smb_app_state_sync";

/** Pide a Meta sincronizar datos del WhatsApp Business App (coexistencia). Solo 1 vez / 24 h post-onboarding. */
export async function iniciarSyncCoexistencia(params: {
  phoneNumberId: string;
  token: string;
  syncType: SyncCoexistenciaTipo;
}): Promise<{ ok: boolean; requestId?: string; error?: string }> {
  const res = await fetch(`${GRAPH}/${params.phoneNumberId}/smb_app_data`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      sync_type: params.syncType,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    request_id?: string;
    error?: { message?: string; code?: number };
  };

  if (!res.ok) {
    return {
      ok: false,
      error: json.error?.message ?? `HTTP ${res.status}`,
    };
  }

  return { ok: true, requestId: json.request_id };
}
