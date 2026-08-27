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

type ComponenteMeta = {
  type: string;
  format?: string;
  text?: string;
  buttons?: { type: string; text: string }[];
};

export type PlantillaImportada = {
  metaTemplateId: string;
  estado: string;
  categoria: string;
  idioma: string;
  cuerpo: string;
  footer: string | null;
  botones: string[];
  /** 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null -- null si el header no es de media (o no hay header). */
  headerFormato: string | null;
};

// Trae una plantilla YA EXISTENTE en Meta (creada ahí directamente, por
// fuera del editor de DuLabs) para poder registrarla en dulabs_plantillas y
// usarla en campañas -- sin esto, una plantilla con encabezado de imagen
// creada en el Administrador de Meta nunca aparecía en el panel.
export async function importarPlantillaMeta(params: {
  wabaId: string;
  token: string;
  nombre: string;
  idioma?: string;
}): Promise<PlantillaImportada | null> {
  const res = await fetch(
    `${GRAPH}/${params.wabaId}/message_templates?name=${encodeURIComponent(params.nombre)}&fields=id,status,category,language,components`,
    { headers: { Authorization: `Bearer ${params.token}` } }
  );
  const json = (await res.json()) as {
    data?: { id: string; status: string; category: string; language: string; components: ComponenteMeta[] }[];
  } & GraphError;
  if (!res.ok) throw new Error(`Meta respondió ${res.status}: ${json.error?.message ?? "sin detalle"}`);

  const candidatas = json.data ?? [];
  const plantilla = params.idioma ? candidatas.find((p) => p.language === params.idioma) ?? candidatas[0] : candidatas[0];
  if (!plantilla) return null;

  const body = plantilla.components.find((c) => c.type === "BODY");
  const footer = plantilla.components.find((c) => c.type === "FOOTER");
  const header = plantilla.components.find((c) => c.type === "HEADER");
  const botones = plantilla.components.find((c) => c.type === "BUTTONS");

  return {
    metaTemplateId: plantilla.id,
    estado: plantilla.status,
    categoria: plantilla.category,
    idioma: plantilla.language,
    cuerpo: body?.text ?? "",
    footer: footer?.text ?? null,
    botones: (botones?.buttons ?? []).map((b) => b.text),
    headerFormato: header && ["IMAGE", "VIDEO", "DOCUMENT"].includes(header.format ?? "") ? header.format! : null,
  };
}

// Sube un archivo al servidor de Meta para usarlo como header de una
// plantilla (imagen/video/documento) -- devuelve el media_id que luego se
// pasa a enviarPlantilla. Un solo upload sirve para TODOS los destinatarios
// de una misma campaña (no hay que subir la imagen 400 veces).
export async function subirMediaMeta(params: {
  phoneNumberId: string;
  token: string;
  archivo: Blob;
  mimeType: string;
  nombreArchivo: string;
}): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", params.archivo, params.nombreArchivo);
  form.append("type", params.mimeType);

  const res = await fetch(`${GRAPH}/${params.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.token}` },
    body: form,
  });
  const json = (await res.json()) as { id?: string } & GraphError;
  if (!res.ok || !json.id) {
    throw new Error(`Meta respondió ${res.status}: ${json.error?.message ?? "sin detalle"}`);
  }
  return json.id;
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
  /**
   * Media del encabezado (imagen/video/documento), ya subida a Meta con
   * subirMediaMeta -- el MISMO media_id se reusa para todos los
   * destinatarios de una campaña, no hace falta subir el archivo por cada uno.
   */
  headerMedia?: { formato: "IMAGE" | "VIDEO" | "DOCUMENT"; mediaId: string };
}): Promise<{ wamid: string | null }> {
  const components: Record<string, unknown>[] = [];

  if (params.headerMedia) {
    const clave = params.headerMedia.formato.toLowerCase();
    components.push({ type: "header", parameters: [{ type: clave, [clave]: { id: params.headerMedia.mediaId } }] });
  }

  if (params.variables?.length) {
    components.push({
      type: "body",
      parameters: params.variables.map((v) => ({ type: "text", parameter_name: v.nombre, text: v.valor })),
    });
  } else if (params.parametrosPosicionales?.length) {
    components.push({
      type: "body",
      parameters: params.parametrosPosicionales.map((valor) => ({ type: "text", text: valor })),
    });
  }

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
      template: {
        name: params.nombrePlantilla,
        language: { code: params.idioma },
        components: components.length > 0 ? components : undefined,
      },
    }),
  });
  const json = (await res.json()) as { messages?: { id?: string }[] } & GraphError;
  if (!res.ok) {
    throw new Error(`Meta respondió ${res.status}: ${json.error?.message ?? "sin detalle"}`);
  }
  return { wamid: json.messages?.[0]?.id ?? null };
}
