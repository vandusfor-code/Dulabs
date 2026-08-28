import { supabaseAdmin } from "@/lib/supabase";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;

// Ventana de silencio por tipo de fallo: si la IA se cae por falta de saldo,
// TODOS los mensajes de TODOS los tenants fallan a la vez -- sin esto serían
// cientos de WhatsApp seguidos al dueño. Se avisa una vez y no se vuelve a
// avisar del mismo tipo hasta que pase la ventana.
const VENTANA_DEDUPE_MS = 6 * 60 * 60 * 1000;

export type TipoFalloIA = "sin_saldo" | "key_invalida" | "rate_limit" | "sobrecarga" | "sin_key" | "otro";

const DESCRIPCION: Record<TipoFalloIA, string> = {
  sin_saldo: "La cuenta de Anthropic se quedó sin saldo",
  key_invalida: "La API key de Anthropic es inválida o fue revocada",
  rate_limit: "Anthropic está limitando la cantidad de peticiones (rate limit)",
  sobrecarga: "Los servidores de Anthropic están sobrecargados",
  sin_key: "No hay ninguna API key de IA configurada",
  otro: "Error inesperado de la IA",
};

// Traduce el error crudo del SDK de Anthropic a una causa accionable. El
// saldo agotado NO llega como un código propio: viene como 400 con el texto
// "credit balance is too low", por eso se revisa el mensaje y no solo el
// status.
export function clasificarFalloIA(err: unknown): { tipo: TipoFalloIA; mensaje: string; status: number | null } {
  const e = err as { status?: number; message?: string };
  const mensaje = e?.message ?? String(err);
  const status = typeof e?.status === "number" ? e.status : null;
  const texto = mensaje.toLowerCase();

  if (texto.includes("credit balance") || texto.includes("insufficient") || texto.includes("billing")) {
    return { tipo: "sin_saldo", mensaje, status };
  }
  if (status === 401 || status === 403 || texto.includes("invalid x-api-key") || texto.includes("authentication")) {
    return { tipo: "key_invalida", mensaje, status };
  }
  if (status === 429) return { tipo: "rate_limit", mensaje, status };
  if (status === 529 || texto.includes("overloaded")) return { tipo: "sobrecarga", mensaje, status };
  return { tipo: "otro", mensaje, status };
}

// Mensaje que ve el dueño en su WhatsApp. Sin jerga de API: dice qué se
// rompió, a quién afecta y qué hacer.
function redactarAlerta(params: { tipo: TipoFalloIA; negocio: string | null; mensaje: string }): string {
  const quePasa = DESCRIPCION[params.tipo];
  const donde = params.negocio ? `\nNegocio afectado: ${params.negocio}` : "";
  const queHacer =
    params.tipo === "sin_saldo"
      ? "\n\nQué hacer: recarga saldo en console.anthropic.com. Mientras tanto, la IA no le responde a NINGÚN cliente."
      : params.tipo === "key_invalida"
        ? "\n\nQué hacer: revisa ANTHROPIC_API_KEY en Vercel y vuelve a desplegar."
        : params.tipo === "sin_key"
          ? "\n\nQué hacer: falta configurar ANTHROPIC_API_KEY en Vercel."
          : params.tipo === "rate_limit" || params.tipo === "sobrecarga"
            ? "\n\nSuele resolverse solo en unos minutos. Si persiste, avisa."
            : "";

  return `⚠️ Du Labs — la IA dejó de responder\n\n${quePasa}.${donde}${queHacer}\n\nDetalle técnico: ${params.mensaje.slice(0, 300)}`;
}

// Envía por WhatsApp desde el número interno de alertas. Nunca lanza: una
// alerta que falla no puede tumbar el webhook que la disparó. Exportada
// para que otras alertas internas (ej. mensajes sin respuesta, ver
// app/api/cron/mensajes-sin-respuesta/route.ts) reutilicen el mismo canal
// en vez de duplicar el fetch a Meta.
export async function enviarAlertaWhatsApp(texto: string): Promise<boolean> {
  const phoneNumberId = process.env.ALERTAS_PHONE_NUMBER_ID;
  const token = process.env.ALERTAS_META_TOKEN;
  const destino = process.env.ALERTAS_DESTINO;
  if (!phoneNumberId || !token || !destino) return false;

  try {
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: destino, type: "text", text: { body: texto } }),
    });
    if (!res.ok) {
      const detalle = await res.text();
      console.error(`[alertas] Meta rechazó la alerta (${res.status}): ${detalle.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[alertas] error enviando alerta:", err instanceof Error ? err.message : err);
    return false;
  }
}

// Registra el fallo y avisa al dueño si toca. Nunca lanza y nunca bloquea:
// toda lectura/escritura tolera que la tabla todavía no exista (mismo
// criterio defensivo que lib/survey-bot-store.ts), para poder desplegar
// esto antes de correr la migración.
export async function registrarFalloIA(params: {
  tipo: TipoFalloIA;
  mensaje: string;
  status?: number | null;
  idTenant?: string | null;
  phoneNumberId?: string | null;
  nombreNegocio?: string | null;
}): Promise<void> {
  const { tipo, mensaje, status = null, idTenant = null, phoneNumberId = null, nombreNegocio = null } = params;
  console.error(`[ia] fallo (${tipo}) tenant=${idTenant ?? "?"} numero=${phoneNumberId ?? "?"}: ${mensaje}`);

  try {
    const supabase = supabaseAdmin();

    // ¿Ya se avisó de este mismo tipo hace poco para este tenant?
    const desde = new Date(Date.now() - VENTANA_DEDUPE_MS).toISOString();
    let consulta = supabase
      .from("dulabs_fallos_ia")
      .select("id")
      .eq("tipo", tipo)
      .not("alertado_at", "is", null)
      .gte("alertado_at", desde)
      .limit(1);
    consulta = idTenant ? consulta.eq("id_tenant", idTenant) : consulta.is("id_tenant", null);
    const { data: yaAvisado, error: consultaError } = await consulta;

    // Si la tabla no existe todavía, se registra en logs y se sigue sin alertar.
    if (consultaError) {
      console.error("[alertas] no se pudo consultar dulabs_fallos_ia (¿falta la migración?):", consultaError.message);
      return;
    }

    const debeAlertar = (yaAvisado ?? []).length === 0;
    const alertado = debeAlertar ? await enviarAlertaWhatsApp(redactarAlerta({ tipo, negocio: nombreNegocio, mensaje })) : false;

    const { error: insertError } = await supabase.from("dulabs_fallos_ia").insert({
      id_tenant: idTenant,
      phone_number_id: phoneNumberId,
      tipo,
      mensaje: mensaje.slice(0, 2000),
      http_status: status,
      alertado_at: alertado ? new Date().toISOString() : null,
    });
    if (insertError) {
      console.error("[alertas] no se pudo registrar el fallo:", insertError.message);
    }
  } catch (err) {
    console.error("[alertas] error registrando fallo:", err instanceof Error ? err.message : err);
  }
}
