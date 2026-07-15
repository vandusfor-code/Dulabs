const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;

export type EstadoNumeroMeta = {
  calidad: string | null;
  limite_mensajeria: string | null;
  estado_verificacion: string | null;
  estado_nombre_visible: string | null;
};

// Estado operativo real del número (calidad, límite de mensajería,
// verificación) tal como lo reporta Meta — nada de esto se inventa.
export async function consultarEstadoNumero(params: {
  phoneNumberId: string;
  token: string;
}): Promise<EstadoNumeroMeta | null> {
  const res = await fetch(
    `${GRAPH}/${params.phoneNumberId}?fields=quality_rating,messaging_limit_tier,name_status,code_verification_status`,
    { headers: { Authorization: `Bearer ${params.token}` } }
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
}
