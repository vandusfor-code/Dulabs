import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { subirMediaMeta } from "@/lib/meta-templates";
import { resolverMiembroEquipo, requireRol } from "@/lib/team";
import { descifrarSecreto } from "@/lib/crypto";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import type { WhatsAppMediaType } from "@/lib/whatsapp";

export const runtime = "nodejs";

// Fase 11 (Completion & Debt Zero, autorizado) — sube UN archivo del
// composer del Inbox a Meta y devuelve su media_id, para que el POST
// principal de app/api/dashboard/mensajes/route.ts lo envíe como mensaje
// real (mismo patrón EXACTO que app/api/campanas/media/route.ts, que ya
// hace esto para el encabezado de una campaña -- reutilizado tal cual,
// nunca un segundo pipeline de subida a Meta). Reutiliza subirMediaMeta
// (lib/meta-templates.ts) sin cambios.
const TIPOS_VALIDOS: WhatsAppMediaType[] = ["image", "video", "audio", "document", "sticker"];

// Límite defensivo -- Meta acepta documentos hasta 100MB, pero WhatsApp en
// sí trata cualquier cosa más allá de unos pocos MB como poco práctico para
// un chat 1:1 real, y un archivo enorme puede agotar el tiempo de la
// función serverless durante la subida. Generoso para uso real del Inbox
// (fotos/documentos normales), no para archivos masivos.
const TAMANO_MAXIMO_BYTES = 16 * 1024 * 1024; // 16MB

const MIME_POR_TIPO: Record<WhatsAppMediaType, RegExp> = {
  image: /^image\//,
  video: /^video\//,
  audio: /^audio\//,
  document: /.*/, // Meta acepta una lista amplia de documentos (pdf, doc, xls, etc.) -- no se restringe más allá del tamaño.
  sticker: /^image\/webp$/,
};

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Falta el token de sesión" }, { status: 401 });

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: "Sesión inválida" }, { status: 401 });
  }
  const miembro = await resolverMiembroEquipo(supabase, userData.user.id);
  if (!requireRol(miembro, ["admin", "agente"])) {
    return Response.json({ error: "No tienes permiso para enviar mensajes" }, { status: 403 });
  }

  const limiteExcedido = await respuestaSiLimiteTasaExcedido(supabase, {
    recurso: "mensajes-media-subir",
    tenantId: miembro.tenantId,
    categoria: "costosa",
  });
  if (limiteExcedido) return limiteExcedido;

  try {
    const form = await request.formData();
    const phoneNumberId = form.get("phone_number_id");
    const tipo = form.get("tipo");
    const archivo = form.get("archivo");
    if (typeof phoneNumberId !== "string" || typeof tipo !== "string" || !(archivo instanceof File)) {
      return Response.json({ error: "Faltan 'phone_number_id', 'tipo' o 'archivo'" }, { status: 400 });
    }
    if (!TIPOS_VALIDOS.includes(tipo as WhatsAppMediaType)) {
      return Response.json({ error: `'tipo' debe ser uno de: ${TIPOS_VALIDOS.join(", ")}` }, { status: 400 });
    }
    if (archivo.size === 0) {
      return Response.json({ error: "El archivo está vacío" }, { status: 400 });
    }
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return Response.json({ error: `El archivo no puede superar ${TAMANO_MAXIMO_BYTES / (1024 * 1024)}MB` }, { status: 400 });
    }
    const mimeType = archivo.type || "application/octet-stream";
    if (!MIME_POR_TIPO[tipo as WhatsAppMediaType].test(mimeType)) {
      return Response.json({ error: `El archivo (${mimeType}) no corresponde al tipo '${tipo}'` }, { status: 400 });
    }

    const { data: cliente, error: clienteError } = await supabase
      .from("dulabs_clientes_config")
      .select("meta_permanent_token")
      .eq("phone_number_id", phoneNumberId)
      .eq("id_tenant", miembro.tenantId)
      .maybeSingle();
    if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
    if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

    const metaToken = cliente.meta_permanent_token ? descifrarSecreto(cliente.meta_permanent_token) : process.env.META_ACCESS_TOKEN;
    if (!metaToken) return Response.json({ error: "Sin token de Meta para este número" }, { status: 500 });

    try {
      const mediaId = await subirMediaMeta({
        phoneNumberId,
        token: metaToken,
        archivo,
        mimeType,
        nombreArchivo: archivo.name || "archivo",
      });
      return Response.json({ media_id: mediaId, mime_type: mimeType, filename: archivo.name || null, tamano_bytes: archivo.size });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : "Error subiendo el archivo a Meta" }, { status: 502 });
    }
  } catch (err) {
    console.error("[mensajes/media] error inesperado", err);
    return Response.json({ error: "Error interno al procesar el archivo." }, { status: 500 });
  }
}
