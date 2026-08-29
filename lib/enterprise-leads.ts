import type { SupabaseClient } from "@supabase/supabase-js";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v23.0"}`;

export type LeadEnterprise = {
  nombre: string;
  empresa: string;
  correo: string;
  telefono?: string;
  necesidad: string;
  detalle?: string;
};

export type GuardarLeadEnterpriseResult =
  | { success: true; leadId: number }
  | { success: false; error?: string };

// Guarda la solicitud. Tolera que la tabla todavía no exista (falta correr
// la migración 20260826120000_enterprise_leads.sql) -- mismo criterio
// defensivo que lib/survey-bot-store.ts y lib/alertas.ts: nunca se le
// devuelve un error de servidor al visitante por eso, se registra en logs.
export async function guardarLeadEnterprise(
  supabase: SupabaseClient,
  lead: LeadEnterprise,
): Promise<GuardarLeadEnterpriseResult> {
  const { data, error } = await supabase
    .from("dulabs_enterprise_leads")
    .insert({
      nombre: lead.nombre,
      empresa: lead.empresa,
      correo: lead.correo,
      telefono: lead.telefono || null,
      necesidad: lead.necesidad,
      detalle: lead.detalle || null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[enterprise-leads] no se pudo guardar (¿falta la migración?):", error.message);
    return { success: false, error: error.message };
  }

  if (data?.id === undefined || data.id === null) {
    return { success: false, error: "lead_id_missing" };
  }

  return { success: true, leadId: data.id as number };
}

// Avisa por WhatsApp al número interno de alertas (mismas env vars que
// lib/alertas.ts) para que un lead nuevo no dependa de que alguien revise
// la base de datos. Nunca lanza: un aviso que falla no puede tumbar el
// endpoint que lo disparó.
export async function notificarLeadEnterprise(lead: LeadEnterprise): Promise<void> {
  const phoneNumberId = process.env.ALERTAS_PHONE_NUMBER_ID;
  const token = process.env.ALERTAS_META_TOKEN;
  const destino = process.env.ALERTAS_DESTINO;
  if (!phoneNumberId || !token || !destino) {
    console.error("[enterprise-leads] ALERTAS_* no configurado, no se avisa el lead nuevo");
    return;
  }

  const texto =
    `🏢 Nuevo lead Enterprise\n\n` +
    `Nombre: ${lead.nombre}\n` +
    `Empresa: ${lead.empresa}\n` +
    `Correo: ${lead.correo}\n` +
    (lead.telefono ? `Teléfono: ${lead.telefono}\n` : "") +
    `Necesidad: ${lead.necesidad}\n` +
    (lead.detalle ? `\n${lead.detalle}` : "");

  try {
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: destino, type: "text", text: { body: texto } }),
    });
    if (!res.ok) {
      const detalle = await res.text();
      console.error(`[enterprise-leads] Meta rechazó el aviso (${res.status}): ${detalle.slice(0, 300)}`);
    }
  } catch (err) {
    console.error("[enterprise-leads] error enviando aviso:", err instanceof Error ? err.message : err);
  }
}
