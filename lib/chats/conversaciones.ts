import type { SupabaseClient } from "@supabase/supabase-js";

// Chats AMORE (autorizado) — resolver compartido por todas las rutas de
// Chats: una conversación SIEMPRE se busca por (id_tenant, id) juntos, nunca
// solo por id -- así ninguna ruta puede tocar por error (o por un id
// adivinado) la conversación de otro tenant.
export type ConversacionFila = {
  id: number;
  telefono: string;
  cliente_id: number | null;
  nombre_visible: string;
  ultimo_mensaje: string | null;
  ultima_actividad: string;
  no_leidos: number;
  estado: string;
};

export async function conversacionDelTenant(
  supabase: SupabaseClient,
  idTenant: string,
  conversacionId: number
): Promise<ConversacionFila | null> {
  const { data } = await supabase
    .from("dulabs_chat_conversaciones")
    .select("id, telefono, cliente_id, nombre_visible, ultimo_mensaje, ultima_actividad, no_leidos, estado")
    .eq("id_tenant", idTenant)
    .eq("id", conversacionId)
    .maybeSingle();
  return data as ConversacionFila | null;
}
