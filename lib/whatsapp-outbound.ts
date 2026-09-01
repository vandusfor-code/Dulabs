import type { SupabaseClient } from "@supabase/supabase-js";
import { descifrarSecreto } from "@/lib/crypto";
import { enviarTexto, enviarImagen, subirMedia } from "@/lib/whatsapp";
import type { ClienteConfig } from "@/lib/supabase";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;

// Movido de app/webhook-dulabs/route.ts a un lib compartido: antes solo el
// webhook mandaba mensajes salientes de la IA, ahora también lo necesitan
// las herramientas de especialista (ej. saludo con botones, traspaso a
// Daniela por producto -- ver lib/especialista-solicitud-ia.ts).

function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

// Cada tenant usa su propio token permanente (Embedded Signup); el token
// global de plataforma queda como respaldo para números registrados a mano.
export function resolverTokenMeta(cliente: ClienteConfig): string | null {
  return cliente.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : (process.env.META_ACCESS_TOKEN ?? null);
}

// Registra un mensaje en el historial. Devuelve true si este wamid ya
// estaba registrado (constraint único dulabs_mensajes_log_wamid_unico) —
// esa colisión ES la deduplicación real. Devuelve false tanto si el mensaje
// es nuevo (se registró bien) como si el insert falló por otro motivo (no
// bloqueamos el procesamiento por un fallo de logging).
export async function registrarMensaje(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string,
  direccion: "entrante" | "saliente",
  contenido: string,
  origen: "entrante" | "ia" | "manual" | "campaña" | "agente",
  wamid?: string
): Promise<boolean> {
  const { error } = await supabase.from("dulabs_mensajes_log").insert({
    phone_number_id: phoneNumberId,
    telefono_cliente: telefonoCliente,
    direccion,
    contenido,
    origen,
    wamid: wamid ?? null,
  });
  if (!error) return false;
  if (error.code === "23505") return true;
  console.error("[whatsapp-outbound] error registrando mensaje en el historial:", error.message);
  return false;
}

export async function incrementarUsoMensajes(supabase: SupabaseClient, cliente: ClienteConfig) {
  const mesHoy = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const nuevoUsados = cliente.mes_actual === mesHoy ? cliente.mensajes_usados_mes + 1 : 1;
  const { error } = await supabase
    .from("dulabs_clientes_config")
    .update({ mensajes_usados_mes: nuevoUsados, mes_actual: mesHoy })
    .eq("id", cliente.id);
  if (error) {
    console.error("[whatsapp-outbound] error incrementando uso de mensajes:", error.message);
  }
}

export async function enviarWhatsApp(supabase: SupabaseClient, cliente: ClienteConfig, para: string, texto: string) {
  const token = resolverTokenMeta(cliente);
  if (!token) {
    console.error("[whatsapp-outbound] sin token de Meta para", cliente.nombre_negocio);
    return;
  }
  let wamid: string | null = null;
  try {
    ({ wamid } = await enviarTexto({ phoneNumberId: cliente.phone_number_id, token, para, texto }));
  } catch (err) {
    console.error("[whatsapp-outbound] error enviando a Meta:", err);
    return;
  }
  await incrementarUsoMensajes(supabase, cliente);
  await registrarMensaje(supabase, cliente.phone_number_id, soloDigitos(para), "saliente", texto, "ia", wamid ?? undefined);
}

// Sube y envía una imagen con caption opcional -- mismo criterio que
// enviarWhatsApp (token del tenant, incrementa uso, registra en el
// historial), pero origen "manual" porque hoy solo se usa para envíos
// directos (pruebas/campañas), nunca generado por la IA.
export async function enviarImagenWhatsApp(
  supabase: SupabaseClient,
  cliente: ClienteConfig,
  para: string,
  archivo: Buffer,
  tipoMime: string,
  caption?: string
) {
  const token = resolverTokenMeta(cliente);
  if (!token) {
    console.error("[whatsapp-outbound] sin token de Meta para", cliente.nombre_negocio);
    return;
  }
  let wamid: string | null = null;
  try {
    const { mediaId } = await subirMedia({ phoneNumberId: cliente.phone_number_id, token, archivo, tipoMime });
    ({ wamid } = await enviarImagen({ phoneNumberId: cliente.phone_number_id, token, para, mediaId, caption }));
  } catch (err) {
    console.error("[whatsapp-outbound] error enviando imagen a Meta:", err);
    return;
  }
  await incrementarUsoMensajes(supabase, cliente);
  await registrarMensaje(
    supabase,
    cliente.phone_number_id,
    soloDigitos(para),
    "saliente",
    caption ?? "[imagen]",
    "manual",
    wamid ?? undefined
  );
}

// Si la IA separó su respuesta en párrafos con línea en blanco, se envían
// como mensajes de WhatsApp aparte (como escribiría una persona real) en
// vez de un solo bloque de texto largo. Máximo dos: la primera idea sola, el
// resto junto -- así no se convierte en una ráfaga de mensajes.
export async function enviarWhatsAppPartes(supabase: SupabaseClient, cliente: ClienteConfig, para: string, texto: string) {
  const partes = texto
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length <= 1) {
    await enviarWhatsApp(supabase, cliente, para, texto.trim());
    return;
  }
  await enviarWhatsApp(supabase, cliente, para, partes[0]);
  await enviarWhatsApp(supabase, cliente, para, partes.slice(1).join("\n\n"));
}

// Mensaje interactivo de botones de respuesta rápida (hasta 3, máx 20
// caracteres cada uno) -- para preguntas de una sola elección donde un botón
// real es más claro que pedirle a la clienta que escriba una opción. A
// diferencia de una plantilla, esto es un mensaje de sesión normal: solo
// funciona dentro de la ventana de 24h, igual que enviarTexto.
export async function enviarBotones(params: {
  phoneNumberId: string;
  token: string;
  para: string;
  cuerpo: string;
  botones: { id: string; titulo: string }[];
  /** Imagen opcional en el encabezado (id ya subido, ver subirMedia) -- mismo mensaje interactivo, no un segundo envío. */
  headerMediaId?: string;
}): Promise<{ wamid: string | null }> {
  const res = await fetch(`${GRAPH}/${params.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: params.para,
      type: "interactive",
      interactive: {
        type: "button",
        ...(params.headerMediaId ? { header: { type: "image", image: { id: params.headerMediaId } } } : {}),
        body: { text: params.cuerpo },
        action: {
          buttons: params.botones.map((b) => ({ type: "reply", reply: { id: b.id, title: b.titulo.slice(0, 20) } })),
        },
      },
    }),
  });
  const json = (await res.json()) as { messages?: { id?: string }[]; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`Meta respondió ${res.status}: ${json.error?.message ?? "sin detalle"}`);
  }
  return { wamid: json.messages?.[0]?.id ?? null };
}

export async function enviarBotonesWhatsApp(
  supabase: SupabaseClient,
  cliente: ClienteConfig,
  para: string,
  cuerpo: string,
  botones: { id: string; titulo: string }[],
  headerMediaId?: string
) {
  const token = resolverTokenMeta(cliente);
  if (!token) {
    console.error("[whatsapp-outbound] sin token de Meta para", cliente.nombre_negocio);
    return;
  }
  let wamid: string | null = null;
  try {
    ({ wamid } = await enviarBotones({ phoneNumberId: cliente.phone_number_id, token, para, cuerpo, botones, headerMediaId }));
  } catch (err) {
    console.error("[whatsapp-outbound] error enviando botones a Meta:", err);
    return;
  }
  await incrementarUsoMensajes(supabase, cliente);
  await registrarMensaje(supabase, cliente.phone_number_id, soloDigitos(para), "saliente", cuerpo, "ia", wamid ?? undefined);
}
