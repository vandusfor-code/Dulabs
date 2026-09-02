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

// Meta permite máximo 3 botones QUICK_REPLY + 2 de llamada a la acción
// (URL/llamar) por plantilla. Textos hasta 25 caracteres cada uno.
export const MAX_BOTONES_PLANTILLA = 3;
export const MAX_BOTONES_CTA = 2;
export const MAX_CARACTERES_BOTON = 25;

export type FormatoHeaderPlantilla = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

export interface HeaderPlantillaInput {
  formato: FormatoHeaderPlantilla;
  /** Solo si formato === "TEXT": el contenido del encabezado (puede tener una variable {{1}}). */
  texto?: string;
  /** Solo si formato === "TEXT" y texto tiene {{1}}: el valor de ejemplo que exige Meta. */
  ejemploTexto?: string;
  /** Solo si formato !== "TEXT": handle devuelto por subirEjemploHeaderMeta. */
  ejemploHandle?: string;
}

export interface BotonCTA {
  tipo: "URL" | "PHONE_NUMBER";
  texto: string;
  /** URL completa (tipo URL) o teléfono en formato internacional (tipo PHONE_NUMBER). */
  valor: string;
}

export interface ComponentesPlantillaInput {
  cuerpo: string;
  footer?: string | null;
  header?: HeaderPlantillaInput | null;
  /** Valor de ejemplo de cada variable {{1}},{{2}}… del BODY, en orden. Meta las exige si el body tiene variables. */
  ejemplosVariables?: string[];
  botones?: string[];
  botonesCta?: BotonCTA[];
}

/**
 * Construye el array `components` exacto que espera la API de Meta para
 * crear una plantilla -- función PURA (sin red), separada a propósito para
 * poder probarla sin mockear fetch. Orden que exige Meta cuando hay varios
 * componentes: HEADER, BODY, FOOTER, BUTTONS.
 */
export function construirComponentesPlantilla(input: ComponentesPlantillaInput): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = [];

  if (input.header) {
    if (input.header.formato === "TEXT") {
      const headerComp: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: input.header.texto ?? "" };
      if (/\{\{1\}\}/.test(input.header.texto ?? "") && input.header.ejemploTexto) {
        headerComp.example = { header_text: [input.header.ejemploTexto] };
      }
      components.push(headerComp);
    } else if (input.header.ejemploHandle) {
      components.push({
        type: "HEADER",
        format: input.header.formato,
        example: { header_handle: [input.header.ejemploHandle] },
      });
    }
  }

  const bodyComponent: Record<string, unknown> = { type: "BODY", text: input.cuerpo };
  if (input.ejemplosVariables?.length) {
    bodyComponent.example = { body_text: [input.ejemplosVariables] };
  }
  components.push(bodyComponent);

  if (input.footer?.trim()) {
    components.push({ type: "FOOTER", text: input.footer.trim() });
  }

  const quickReply = (input.botones ?? []).filter((b) => b.trim() !== "").slice(0, MAX_BOTONES_PLANTILLA);
  const cta = (input.botonesCta ?? []).slice(0, MAX_BOTONES_CTA);
  if (quickReply.length > 0 || cta.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: [
        ...quickReply.map((texto) => ({ type: "QUICK_REPLY", text: texto.slice(0, MAX_CARACTERES_BOTON) })),
        ...cta.map((b) =>
          b.tipo === "URL"
            ? { type: "URL", text: b.texto.slice(0, MAX_CARACTERES_BOTON), url: b.valor }
            : { type: "PHONE_NUMBER", text: b.texto.slice(0, MAX_CARACTERES_BOTON), phone_number: b.valor }
        ),
      ],
    });
  }

  return components;
}

export async function crearPlantillaMeta(
  params: {
    wabaId: string;
    token: string;
    nombre: string;
    categoria: string;
    idioma: string;
  } & ComponentesPlantillaInput
): Promise<{ id: string; status: string }> {
  const components = construirComponentesPlantilla(params);

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

// Sube el archivo de EJEMPLO de un encabezado de imagen/video/documento
// para poder crear la plantilla (distinto de subirMediaMeta, que sube el
// archivo real para ENVIAR una plantilla ya aprobada). Meta exige este flujo
// de "resumable upload" de 2 pasos específicamente para el `example` de una
// plantilla nueva -- ver https://developers.facebook.com/docs/graph-api/guides/upload
// El paso 2 usa el esquema "OAuth" (no "Bearer") y un file_offset, tal como
// lo documenta Meta para este endpoint puntual.
export async function subirEjemploHeaderMeta(params: {
  appId: string;
  token: string;
  archivo: Buffer;
  mimeType: string;
  nombreArchivo: string;
}): Promise<string> {
  const sessionRes = await fetch(
    `${GRAPH}/${params.appId}/uploads?file_name=${encodeURIComponent(params.nombreArchivo)}&file_length=${params.archivo.length}&file_type=${encodeURIComponent(params.mimeType)}`,
    { method: "POST", headers: { Authorization: `Bearer ${params.token}` } }
  );
  const sessionJson = (await sessionRes.json()) as { id?: string } & GraphError;
  if (!sessionRes.ok || !sessionJson.id) {
    throw new Error(`Meta respondió ${sessionRes.status} creando la sesión de subida: ${sessionJson.error?.message ?? "sin detalle"}`);
  }

  const uploadRes = await fetch(`${GRAPH}/${sessionJson.id}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${params.token}`,
      file_offset: "0",
    },
    body: new Uint8Array(params.archivo),
  });
  const uploadJson = (await uploadRes.json()) as { h?: string } & GraphError;
  if (!uploadRes.ok || !uploadJson.h) {
    throw new Error(`Meta respondió ${uploadRes.status} subiendo el ejemplo del encabezado: ${uploadJson.error?.message ?? "sin detalle"}`);
  }
  return uploadJson.h;
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
  buttons?: { type: string; text: string; url?: string; phone_number?: string }[];
  example?: { body_text?: string[][]; header_text?: string[]; header_handle?: string[] };
};

export type PlantillaImportada = {
  metaTemplateId: string;
  estado: string;
  categoria: string;
  idioma: string;
  cuerpo: string;
  footer: string | null;
  botones: string[];
  botonesCta: BotonCTA[];
  /** 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null -- null si no hay header. */
  headerFormato: string | null;
  headerTexto: string | null;
  variablesEjemplo: string[];
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
  const botonesComp = plantilla.components.find((c) => c.type === "BUTTONS");

  const todosLosBotones = botonesComp?.buttons ?? [];

  return {
    metaTemplateId: plantilla.id,
    estado: plantilla.status,
    categoria: plantilla.category,
    idioma: plantilla.language,
    cuerpo: body?.text ?? "",
    footer: footer?.text ?? null,
    botones: todosLosBotones.filter((b) => b.type === "QUICK_REPLY").map((b) => b.text),
    botonesCta: todosLosBotones
      .filter((b): b is typeof b & { type: "URL" | "PHONE_NUMBER" } => b.type === "URL" || b.type === "PHONE_NUMBER")
      .map((b) => ({ tipo: b.type, texto: b.text, valor: (b.type === "URL" ? b.url : b.phone_number) ?? "" })),
    headerFormato: header && ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"].includes(header.format ?? "") ? header.format! : null,
    headerTexto: header?.format === "TEXT" ? (header.text ?? null) : null,
    variablesEjemplo: body?.example?.body_text?.[0] ?? [],
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
