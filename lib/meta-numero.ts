const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;

export type EstadoNumeroMeta = {
  calidad: string | null;
  limite_mensajeria: string | null;
  estado_verificacion: string | null;
  estado_nombre_visible: string | null;
};

const TIMEOUT_MS = 5000;

// Estado operativo real del número (calidad, límite de mensajería,
// verificación) tal como lo reporta Meta — nada de esto se inventa.
// Nunca debe tumbar ni colgar al que la llama: cualquier falla (timeout,
// red, respuesta rara) devuelve null en vez de propagar el error.
export async function consultarEstadoNumero(params: {
  phoneNumberId: string;
  token: string;
}): Promise<EstadoNumeroMeta | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `${GRAPH}/${params.phoneNumberId}?fields=quality_rating,messaging_limit_tier,name_status,code_verification_status`,
      { headers: { Authorization: `Bearer ${params.token}` }, signal: controller.signal }
    );
    if (!res.ok) return null;

    const json = (await res.json()) as {
      quality_rating?: string;
      messaging_limit_tier?: string;
      name_status?: string;
      code_verification_status?: string;
    };

    return {
      calidad: json.quality_rating ?? null,
      limite_mensajeria: json.messaging_limit_tier ?? null,
      estado_verificacion: json.code_verification_status ?? null,
      estado_nombre_visible: json.name_status ?? null,
    };
  } catch (err) {
    console.error("[meta-numero] error consultando estado del número:", err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
