import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { generarRespuestaIA } from "@/lib/ia";
import { resolverConfigAgente } from "@/lib/agentes";
import { historialPlaygroundAHistorialIA } from "@/lib/historial-conversacion";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MENSAJE = 2000;

// Espejo cross-tenant de /api/dashboard/playground -- mismo motor
// (generarRespuestaIA), mismo resolverConfigAgente, mismo criterio de "no
// cuenta contra el consumo ni se envía por WhatsApp". La única diferencia es
// que el número se busca en idTenant (de la URL, ya autorizado) en vez del
// tenant del que llama, así que un admin de DuLabs puede probar el agente de
// CUALQUIER cliente sin que un usuario normal pueda hacer lo mismo con otro
// tenant (ese usuario nunca pasa verificarAccesoAdminDulabs).
export async function POST(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const { supabase } = acceso;

  let body: {
    phone_number_id?: string;
    mensaje?: string;
    historial?: { rol: "usuario" | "ia"; texto: string }[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { phone_number_id: phoneNumberId } = body;
  const mensaje = body.mensaje?.trim();
  if (!phoneNumberId || !mensaje) {
    return Response.json({ error: "Faltan 'phone_number_id' o 'mensaje'" }, { status: 400 });
  }
  if (mensaje.length > MAX_MENSAJE) {
    return Response.json({ error: `El mensaje no puede superar ${MAX_MENSAJE} caracteres` }, { status: 400 });
  }

  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("agente_id, prompt_sistema, base_conocimiento, nombre_negocio, api_key_ia, nombre_agente")
    .eq("phone_number_id", phoneNumberId)
    .eq("id_tenant", idTenant)
    .maybeSingle();
  if (clienteError) return Response.json({ error: clienteError.message }, { status: 500 });
  if (!cliente) return Response.json({ error: "Número no encontrado" }, { status: 404 });

  const configAgente = await resolverConfigAgente(supabase, cliente);
  const historial = historialPlaygroundAHistorialIA(body.historial ?? []);
  const respuesta = await generarRespuestaIA(
    { ...configAgente, nombre_negocio: cliente.nombre_negocio },
    mensaje,
    { idTenant, phoneNumberId },
    historial
  );
  if (!respuesta) {
    const { data: ultimoFallo } = await supabase
      .from("dulabs_fallos_ia")
      .select("tipo")
      .eq("id_tenant", idTenant)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const causas: Record<string, string> = {
      sin_saldo: "El servicio de IA se quedó sin saldo. Ya se notificó al equipo de Du Labs.",
      key_invalida: "La clave del servicio de IA es inválida. Ya se notificó al equipo de Du Labs.",
      sin_key: "Falta configurar el servicio de IA. Ya se notificó al equipo de Du Labs.",
      rate_limit: "El servicio de IA está saturado en este momento. Intenta de nuevo en unos minutos.",
      sobrecarga: "El servicio de IA está sobrecargado en este momento. Intenta de nuevo en unos minutos.",
    };
    const error =
      (ultimoFallo?.tipo && causas[ultimoFallo.tipo]) ??
      "La IA no pudo generar una respuesta. Ya se notificó al equipo de Du Labs.";
    return Response.json({ error }, { status: 500 });
  }

  return Response.json({ respuesta });
}
