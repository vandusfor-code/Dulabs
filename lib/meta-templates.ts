const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;

type GraphError = { error?: { message?: string; code?: number } };

// Meta exige nombres de plantilla en minúsculas, solo [a-z0-9_]. Cualquier
// otro carácter (espacios, tildes, ñ) se colapsa a guion bajo.
export function normalizarNombrePlantilla(nombre: string): string {
  return nombre
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}

export async function crearPlantillaMeta(params: {
  wabaId: string;
  token: string;
  nombre: string;
  categoria: string;
  idioma: string;
  cuerpo: string;
}): Promise<{ id: string; status: string }> {
  const res = await fetch(`${GRAPH}/${params.wabaId}/message_templates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: params.nombre,
      category: params.categoria,
      language: params.idioma,
      components: [{ type: "BODY", text: params.cuerpo }],
    }),
  });
  const json = (await res.json()) as { id?: string; status?: string } & GraphError;
  if (!res.ok || !json.id) {
    throw new Error(`Meta respondió ${res.status}: ${json.error?.message ?? "sin detalle"}`);
  }
  return { id: json.id, status: json.status ?? "PENDING" };
}

export async function consultarEstadoPlantilla(params: {
  wabaId: string;
  token: string;
  nombre: string;
}): Promise<string | null> {
  const res = await fetch(
    `${GRAPH}/${params.wabaId}/message_templates?name=${encodeURIComponent(params.nombre)}`,
    { headers: { Authorization: `Bearer ${params.token}` } }
  );
  const json = (await res.json()) as { data?: { status?: string }[] } & GraphError;
  if (!res.ok) return null;
  return json.data?.[0]?.status ?? null;
}

export async function enviarPlantilla(params: {
  phoneNumberId: string;
  token: string;
  para: string;
  nombrePlantilla: string;
  idioma: string;
}): Promise<{ wamid: string | null }> {
  const res = await fetch(`${GRAPH}/${params.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: params.para,
      type: "template",
      template: { name: params.nombrePlantilla, language: { code: params.idioma } },
    }),
  });
  const json = (await res.json()) as { messages?: { id?: string }[] } & GraphError;
  if (!res.ok) {
    throw new Error(`Meta respondió ${res.status}: ${json.error?.message ?? "sin detalle"}`);
  }
  return { wamid: json.messages?.[0]?.id ?? null };
}
