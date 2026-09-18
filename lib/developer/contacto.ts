import type { SupabaseClient } from "@supabase/supabase-js";

// DuLabs Developer -- resolución del contacto de un usuario (email/nombre/
// whatsapp) desde Supabase Auth. Punto ÚNICO reutilizado por la bienvenida
// (welcome.ts) y por el worker de jobs de WhatsApp -- no se duplica la lectura
// de user_metadata. Nunca loguea secretos.

export type ContactoUsuario = { email: string; nombre: string; empresa: string | null; whatsapp: string };

export async function resolverContactoUsuario(supabase: SupabaseClient, userId: string): Promise<ContactoUsuario> {
  const { data } = await supabase.auth.admin.getUserById(userId);
  const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  return {
    email: data?.user?.email ?? "",
    nombre: typeof meta.nombre === "string" ? meta.nombre : "",
    empresa: typeof meta.empresa === "string" ? meta.empresa : null,
    whatsapp: typeof meta.whatsapp === "string" ? meta.whatsapp : "",
  };
}

/** Primer nombre para saludo ({{1}} de la plantilla). Fallback a "cliente". */
export function primerNombreDe(nombre: string): string {
  return nombre.split(/\s+/)[0] || nombre || "cliente";
}
