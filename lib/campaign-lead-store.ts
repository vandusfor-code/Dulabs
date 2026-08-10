/**
 * Persistencia del bot de captación de leads por campaña (Supabase). Capa
 * fina entre el motor puro (lib/campaign-lead-engine.ts) y las tablas
 * reales.
 *
 * IMPORTANTE — seguridad de despliegue: este módulo puede desplegarse ANTES
 * de que la migración `20260810090000_campaign_lead_capture.sql` se
 * ejecute en la base de datos real (mismo criterio que
 * lib/survey-bot-store.ts). Toda lectura swallow-ea el error si las tablas
 * todavía no existen y devuelve null — el llamador debe tratar null como
 * "esta funcionalidad no aplica todavía aquí" y seguir su flujo normal.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { crearSesionCampaña, type CampaignBotConfig, type CampaignLeadSession } from "@/lib/campaign-lead-engine";
import type { OperadorChileno } from "@/lib/campaign-lead-extraction";

let warnedMissingTable = false;
function logMissingOnce(context: string, err: unknown) {
  if (warnedMissingTable) return;
  warnedMissingTable = true;
  console.warn(
    `[campaign-lead-store] tablas de captación de leads no disponibles todavía (${context}). ` +
      `Esto es esperado hasta correr la migración 20260810090000_campaign_lead_capture.sql — el resto de la app sigue funcionando normal.`,
    err instanceof Error ? err.message : err
  );
}

export interface StoredCampaignBotConfig extends CampaignBotConfig {
  id: number;
  tenantId: string;
  phoneNumberId: string;
  plantillaId: number;
}

/** Config del bot de captación asociada a esa plantilla en ese número, o null si no existe/inactiva/tabla ausente. */
export async function getCampaignBotConfig(
  supabase: SupabaseClient,
  phoneNumberId: string,
  plantillaId: number
): Promise<StoredCampaignBotConfig | null> {
  try {
    const { data, error } = await supabase
      .from("dulabs_campaign_bot_config")
      .select("*")
      .eq("phone_number_id", phoneNumberId)
      .eq("plantilla_id", plantillaId)
      .eq("active", true)
      .maybeSingle();
    if (error) {
      logMissingOnce("getCampaignBotConfig", error);
      return null;
    }
    if (!data) return null;
    return {
      id: data.id,
      tenantId: data.id_tenant,
      phoneNumberId: data.phone_number_id,
      plantillaId: data.plantilla_id,
      campaignLabel: data.campaign_label,
      yesButtonText: data.yes_button_text,
      noButtonText: data.no_button_text,
      askDataTemplate: data.ask_data_template,
      confirmTemplate: data.confirm_template,
      declineTemplate: data.decline_template ?? null,
    };
  } catch (err) {
    logMissingOnce("getCampaignBotConfig (throw)", err);
    return null;
  }
}

export interface StoredCampaignLead {
  id: number;
  campanaId: number | null;
  plantillaId: number | null;
  session: CampaignLeadSession;
}

function rowToSession(row: Record<string, unknown>): CampaignLeadSession {
  return {
    estado: row.estado as CampaignLeadSession["estado"],
    customerName: (row.customer_name as string) ?? null,
    rut: (row.rut as string) ?? null,
    phoneProvided: (row.phone_provided as string) ?? null,
    currentCompanyRaw: (row.current_company_raw as string) ?? null,
    currentOperator: (row.current_operator as OperadorChileno) ?? null,
    capturedAt: (row.captured_at as string) ?? null,
  };
}

function sessionToRow(session: CampaignLeadSession) {
  return {
    estado: session.estado,
    customer_name: session.customerName,
    rut: session.rut,
    phone_provided: session.phoneProvided,
    current_company_raw: session.currentCompanyRaw,
    current_operator: session.currentOperator,
    captured_at: session.capturedAt,
    updated_at: new Date().toISOString(),
  };
}

/** Sesión existente para (número, cliente), con sus ids de campaña/plantilla, o null si no existe/tabla ausente. */
export async function getCampaignLead(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string
): Promise<StoredCampaignLead | null> {
  try {
    const { data, error } = await supabase
      .from("dulabs_campaign_leads")
      .select("*")
      .eq("phone_number_id", phoneNumberId)
      .eq("telefono_cliente", telefonoCliente)
      .maybeSingle();
    if (error) {
      logMissingOnce("getCampaignLead", error);
      return null;
    }
    if (!data) return null;
    return { id: data.id, campanaId: data.campana_id ?? null, plantillaId: data.plantilla_id ?? null, session: rowToSession(data) };
  } catch (err) {
    logMissingOnce("getCampaignLead (throw)", err);
    return null;
  }
}

/**
 * Crea (o resetea, vía upsert) la sesión de captación para un destinatario
 * de campaña — se llama al enviar la plantilla, no al recibir la primera
 * respuesta (mismo momento que createSessionRow en el bot de encuestas).
 */
export async function crearCampaignLeadRow(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    phoneNumberId: string;
    telefonoCliente: string;
    campanaId: number | null;
    plantillaId: number;
    customerName?: string | null;
  }
): Promise<boolean> {
  try {
    const session = crearSesionCampaña(params.customerName ?? null);
    const { error } = await supabase.from("dulabs_campaign_leads").upsert(
      {
        id_tenant: params.idTenant,
        phone_number_id: params.phoneNumberId,
        telefono_cliente: params.telefonoCliente,
        campana_id: params.campanaId,
        plantilla_id: params.plantillaId,
        dumo_sync_status: "not_applicable",
        ...sessionToRow(session),
      },
      { onConflict: "phone_number_id,telefono_cliente" }
    );
    if (error) {
      logMissingOnce("crearCampaignLeadRow", error);
      return false;
    }
    return true;
  } catch (err) {
    logMissingOnce("crearCampaignLeadRow (throw)", err);
    return false;
  }
}

/** Persiste el estado resultante de un turno del motor. */
export async function guardarCampaignLead(
  supabase: SupabaseClient,
  phoneNumberId: string,
  telefonoCliente: string,
  session: CampaignLeadSession
): Promise<void> {
  try {
    const { error } = await supabase
      .from("dulabs_campaign_leads")
      .update(sessionToRow(session))
      .eq("phone_number_id", phoneNumberId)
      .eq("telefono_cliente", telefonoCliente);
    if (error) logMissingOnce("guardarCampaignLead", error);
  } catch (err) {
    logMissingOnce("guardarCampaignLead (throw)", err);
  }
}
