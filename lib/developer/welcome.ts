import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarBienvenidaEmailDeveloper } from "@/lib/developer/welcome-email";
import { enviarBienvenidaWhatsappPorUsuario } from "@/lib/developer/welcome-whatsapp";
import { resolverContactoUsuario } from "@/lib/developer/contacto";
import { encolarWhatsappDeveloper } from "@/lib/developer/whatsapp-jobs";

// DuLabs Developer -- orquestación de la bienvenida (email + WhatsApp). Se
// dispara UNA sola vez, en la PRIMERA provisión del workspace del usuario
// (created=true, atómico por advisory lock). El EMAIL se envía inline (Resend,
// inmediato). El WhatsApp se ENCOLA en QStash para envío inmediato + reintentos
// SIN depender de Vercel Cron; si QStash no está disponible, fallback inline
// (sin regresión). Ambos canales son NO bloqueantes: un fallo se loguea y nunca
// hace fallar la provisión/registro. Nunca loguea secretos (solo motivos/ids).

export type ResumenBienvenida = {
  email: { enviado: boolean; motivo?: string };
  whatsapp: { enviado: boolean; motivo?: string; wamid?: string | null; encolado?: boolean };
};

export async function dispararBienvenidaDeveloper(supabase: SupabaseClient, userId: string, workspaceId: string): Promise<ResumenBienvenida> {
  const resumen: ResumenBienvenida = { email: { enviado: false }, whatsapp: { enviado: false } };

  let contacto;
  try {
    contacto = await resolverContactoUsuario(supabase, userId);
  } catch (err) {
    console.error(`[developer/welcome] no se pudo leer el usuario ${userId}:`, err instanceof Error ? err.message : String(err));
    return resumen;
  }

  // Email (Resend) -- inline.
  if (contacto.email) {
    try {
      const r = await enviarBienvenidaEmailDeveloper({ email: contacto.email, nombre: contacto.nombre, empresa: contacto.empresa });
      resumen.email = r.enviado ? { enviado: true } : { enviado: false, motivo: r.motivo };
    } catch {
      resumen.email = { enviado: false, motivo: "excepcion" };
    }
  } else {
    resumen.email = { enviado: false, motivo: "sin_email" };
  }

  // WhatsApp -- encolar en QStash (inmediato + reintentos). Solo si el usuario
  // dio número. Fallback inline si QStash no está disponible.
  let waDetalle = "";
  if (!contacto.whatsapp) {
    resumen.whatsapp = { enviado: false, motivo: "sin_whatsapp" };
  } else {
    const enc = await encolarWhatsappDeveloper({ tipo: "bienvenida", workspaceId, userId });
    if (enc.encolado) {
      resumen.whatsapp = { enviado: false, encolado: true };
    } else {
      try {
        const rWa = await enviarBienvenidaWhatsappPorUsuario(supabase, userId);
        resumen.whatsapp = rWa.enviado ? { enviado: true, wamid: rWa.wamid } : { enviado: false, motivo: rWa.motivo };
        const det = !rWa.enviado && "detalle" in rWa ? rWa.detalle : undefined;
        if (det) waDetalle = ` detalle="${det}"`;
      } catch (err) {
        resumen.whatsapp = { enviado: false, motivo: "excepcion" };
        waDetalle = ` detalle="${err instanceof Error ? err.message : String(err)}"`;
      }
    }
  }

  const waEstado = resumen.whatsapp.encolado ? "encolado" : resumen.whatsapp.enviado ? `ok wamid=${resumen.whatsapp.wamid}` : `fail:${resumen.whatsapp.motivo}`;
  console.log(`[developer/welcome] userId=${userId} email=${resumen.email.enviado ? "ok" : `fail:${resumen.email.motivo}`} whatsapp=${waEstado}${waDetalle}`);
  return resumen;
}
