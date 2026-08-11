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

// Meta permite máximo 3 botones QUICK_REPLY por plantilla, hasta 25
// caracteres cada uno.
export const MAX_BOTONES_PLANTILLA = 3;
export const MAX_CARACTERES_BOTON = 25;

export async function crearPlantillaMeta(params: {
  wabaId: string;
  token: string;
  nombre: string;
  categoria: string;
  idioma: string;
  cuerpo: string;
  /** Pie de página opcional (componente FOOTER). Vacío/ausente = sin footer. */
  footer?: string | null;
  /** Textos de hasta 3 botones de respuesta rápida (opcional). */
  botones?: string[];
}): Promise<{ id: string; status: string }> {
  // Orden que exige Meta cuando hay varios componentes: BODY, luego FOOTER,
  // luego BUTTONS.
  const components: Record<string, unknown>[] = [{ type: "BODY", text: params.cuerpo }];
  if (params.footer?.trim()) {
    components.push({ type: "FOOTER", text: params.footer.trim() });
  }
  const botones = (params.botones ?? []).filter((b) => b.trim() !== "").slice(0, MAX_BOTONES_PLANTILLA);
  if (botones.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: botones.map((texto) => ({ type: "QUICK_REPLY", text: texto.slice(0, MAX_CARACTERES_BOTON) })),
    });
  }

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
      components,
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

// Cuenta las variables posicionales {{1}}, {{2}}… del cuerpo de una
// plantilla creada desde /dashboard/plantillas (ver contarVariables ahí).
export function contarVariablesPlantilla(cuerpo: string): number {
  const coincidencias = cuerpo.match(/\{\{\d+\}\}/g);
  return coincidencias ? new Set(coincidencias).size : 0;
}

export async function enviarPlantilla(params: {
  phoneNumberId: string;
  token: string;
  para: string;
  nombrePlantilla: string;
  idioma: string;
  /**
   * Variables NOMBRADAS del body ({{nombre_variable}}, no {{1}}/{{2}}) — el
   * formato que usa el editor nativo de plantillas de Meta hoy en día.
   */
  variables?: { nombre: string; valor: string }[];
  /**
   * Variables POSICIONALES del body ({{1}}, {{2}}…) — el formato que usan
   * las plantillas creadas desde /dashboard/plantillas. Mutuamente
   * excluyente con `variables`.
   */
  parametrosPosicionales?: string[];
}): Promise<{ wamid: string | null }> {
  const components = params.variables?.length
    ? [
        {
          type: "body",
          parameters: params.variables.map((v) => ({ type: "text", parameter_name: v.nombre, text: v.valor })),
        },
      ]
    : params.parametrosPosicionales?.length
      ? [
          {
            type: "body",
            parameters: params.parametrosPosicionales.map((valor) => ({ type: "text", text: valor })),
          },
        ]
      : undefined;

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
      template: { name: params.nombrePlantilla, language: { code: params.idioma }, components },
    }),
  });
  const json = (await res.json()) as { messages?: { id?: string }[] } & GraphError;
  if (!res.ok) {
    throw new Error(`Meta respondió ${res.status}: ${json.error?.message ?? "sin detalle"}`);
  }
  return { wamid: json.messages?.[0]?.id ?? null };
}
