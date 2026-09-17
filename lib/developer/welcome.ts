import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarBienvenidaEmailDeveloper } from "@/lib/developer/welcome-email";
import { enviarBienvenidaWhatsappDeveloper } from "@/lib/developer/welcome-whatsapp";

// DuLabs Developer -- orquestación de la bienvenida (email + WhatsApp). Se
// dispara UNA sola vez, en la PRIMERA provisión del workspace del usuario
// (created=true, atómico por advisory lock) -- ese momento equivale a "email
// confirmado + primer acceso al dashboard". Ambos canales son NO bloqueantes:
// un fallo se loguea y nunca hace fallar la provisión/registro. Nunca loguea
// secretos (ni token, ni contenido, solo motivos/ids).

export type ResumenBienvenida = {
  email: { enviado: boolean; motivo?: string };
  whatsapp: { enviado: boolean; motivo?: string; wamid?: string | null };
};

export async function dispararBienvenidaDeveloper(supabase: SupabaseClient, userId: string): Promise<ResumenBienvenida> {
  const resumen: ResumenBienvenida = { email: { enviado: false }, whatsapp: { enviado: false } };

  let email = "";
  let nombre = "";
  let empresa: string | null = null;
  let whatsapp = "";
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    email = data?.user?.email ?? "";
    const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
    nombre = typeof meta.nombre === "string" ? meta.nombre : "";
    empresa = typeof meta.empresa === "string" ? meta.empresa : null;
    whatsapp = typeof meta.whatsapp === "string" ? meta.whatsapp : "";
  } catch (err) {
    console.error(`[developer/welcome] no se pudo leer el usuario ${userId}:`, err instanceof Error ? err.message : String(err));
    return resumen;
  }

  const primerNombre = nombre.split(/\s+/)[0] || nombre;

  const [rEmail, rWa] = await Promise.allSettled([
    email ? enviarBienvenidaEmailDeveloper({ email, nombre, empresa }) : Promise.resolve({ enviado: false as const, motivo: "sin_email" }),
    whatsapp ? enviarBienvenidaWhatsappDeveloper(supabase, { destinoE164: whatsapp, nombre: primerNombre }) : Promise.resolve({ enviado: false as const, motivo: "sin_whatsapp" }),
  ]);

  if (rEmail.status === "fulfilled") {
    resumen.email = rEmail.value.enviado ? { enviado: true } : { enviado: false, motivo: rEmail.value.motivo };
  } else {
    resumen.email = { enviado: false, motivo: "excepcion" };
  }
  if (rWa.status === "fulfilled") {
    resumen.whatsapp = rWa.value.enviado
      ? { enviado: true, wamid: rWa.value.wamid }
      : { enviado: false, motivo: rWa.value.motivo };
  } else {
    resumen.whatsapp = { enviado: false, motivo: "excepcion" };
  }

  console.log(`[developer/welcome] userId=${userId} email=${resumen.email.enviado ? "ok" : `fail:${resumen.email.motivo}`} whatsapp=${resumen.whatsapp.enviado ? "ok" : `fail:${resumen.whatsapp.motivo}`}`);
  return resumen;
}
