import { supabaseAdmin } from "@/lib/supabase";

// Candado real por conversación -- ver migración 20260826180000_chat_lock.sql
// para el porqué: sin esto, dos mensajes de la misma clienta separados por
// más de los ~2.5s del freno de ráfaga del webhook pueden disparar dos
// llamadas a la IA EN PARALELO, cada una agendando por su cuenta.
const CANDADO_VENCE_MS = 90 * 1000; // proceso que se cayó sin liberar: no bloquea para siempre
const REINTENTO_MS = 700;
const MAX_ESPERA_MS = 20 * 1000;

function esperar(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Intenta tomar el candado de este chat. Si ya está tomado, espera y
// reintenta (nunca deja a la clienta en silencio abandonando el mensaje).
// Si la tabla todavía no existe (falta la migración) o hay cualquier otro
// error, deja pasar sin bloquear -- mismo criterio defensivo que el resto
// del proyecto: nunca tumbar el envío real por un candado que falló.
export async function adquirirCandadoChat(phoneNumberId: string, telefonoCliente: string, wamid: string): Promise<boolean> {
  const supabase = supabaseAdmin();
  const desde = Date.now();

  while (Date.now() - desde < MAX_ESPERA_MS) {
    const { error } = await supabase
      .from("dulabs_chat_lock")
      .insert({ phone_number_id: phoneNumberId, telefono_cliente: telefonoCliente, wamid });
    if (!error) return true;

    if (error.code !== "23505") {
      console.error("[chat-lock] error adquiriendo candado (¿falta la migración?):", error.message);
      return true;
    }

    const { data: existente } = await supabase
      .from("dulabs_chat_lock")
      .select("bloqueado_at")
      .eq("phone_number_id", phoneNumberId)
      .eq("telefono_cliente", telefonoCliente)
      .maybeSingle();
    if (existente && Date.now() - new Date(existente.bloqueado_at).getTime() > CANDADO_VENCE_MS) {
      // Candado abandonado por un proceso que se cayó sin liberar -- se roba.
      await supabase
        .from("dulabs_chat_lock")
        .delete()
        .eq("phone_number_id", phoneNumberId)
        .eq("telefono_cliente", telefonoCliente);
      continue;
    }

    await esperar(REINTENTO_MS);
  }

  console.error(`[chat-lock] no se pudo adquirir el candado de ${phoneNumberId}/${telefonoCliente} tras ${MAX_ESPERA_MS}ms -- se procesa igual`);
  return false;
}

export async function liberarCandadoChat(phoneNumberId: string, telefonoCliente: string, wamid: string): Promise<void> {
  const supabase = supabaseAdmin();
  // Solo borra si el candado sigue siendo el mío -- si se venció y otro
  // proceso ya lo tomó, no le borres el candado a ese otro proceso.
  const { error } = await supabase
    .from("dulabs_chat_lock")
    .delete()
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefonoCliente)
    .eq("wamid", wamid);
  if (error) {
    console.error("[chat-lock] error liberando candado:", error.message);
  }
}
