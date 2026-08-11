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
import type { CampaignBotConfig, CampaignLeadSession } from "@/lib/campaign-lead-engine";
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
      askCompanyTemplate: data.ask_company_template ?? "",
      askRutTemplate: data.ask_rut_template ?? "",
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
  /** Clave de idempotencia externa (futuro payload a DuMo). NO usar `id`. */
  dulabsSessionId: string;
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

const ESTADOS_ACTIVOS = ["waiting_response", "requesting_data"] as const;

/**
 * Sesión ACTIVA para (número, cliente), o null si no hay ninguna activa
 * ahora mismo (tabla ausente, nunca participó, o su(s) sesión(es) previas ya
 * son terminales). Un teléfono puede tener varias filas históricas -- filtrar
 * por estado activo es obligatorio, no cosmético: sin este filtro, un
 * cliente con 2+ campañas pasadas rompería el maybeSingle() de abajo.
 */
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
      .in("estado", ESTADOS_ACTIVOS)
      .maybeSingle();
    if (error) {
      logMissingOnce("getCampaignLead", error);
      return null;
    }
    if (!data) return null;
    return {
      id: data.id,
      dulabsSessionId: data.dulabs_session_id,
      campanaId: data.campana_id ?? null,
      plantillaId: data.plantilla_id ?? null,
      session: rowToSession(data),
    };
  } catch (err) {
    logMissingOnce("getCampaignLead (throw)", err);
    return null;
  }
}

/**
 * Crea la sesión de captación para un destinatario de campaña — se llama al
 * enviar la plantilla, no al recibir la primera respuesta (mismo momento que
 * createSessionRow en el bot de encuestas).
 *
 * Idempotente vía RPC dulabs_crear_campaign_lead_idempotente (atómica en
 * Postgres, apoyada en el índice único parcial de sesión activa): si ese
 * teléfono ya tiene una sesión activa (de esta campaña o de otra sin
 * resolver), la devuelve tal cual, sin duplicar ni resetear su estado ni
 * regenerar su dulabs_session_id. Si no, inserta una fila nueva y conserva
 * el histórico de campañas anteriores de ese teléfono.
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
): Promise<StoredCampaignLead | null> {
  try {
    // Sin .single(): la función devuelve UNA fila compuesta (no SETOF), así
    // que PostgREST ya entrega `data` como objeto directo, no como arreglo
    // (mismo criterio que dulabs_intentar_iniciar_campana en
    // app/api/campanas/enviar/route.ts, que tampoco encadena .single()).
    const { data: rpcData, error } = await supabase.rpc("dulabs_crear_campaign_lead_idempotente", {
      p_tenant: params.idTenant,
      p_phone_number_id: params.phoneNumberId,
      p_telefono_cliente: params.telefonoCliente,
      p_campana_id: params.campanaId,
      p_plantilla_id: params.plantillaId,
      p_customer_name: params.customerName ?? null,
    });
    if (error) {
      logMissingOnce("crearCampaignLeadRow", error);
      return null;
    }
    if (!rpcData) return null;
    const data = rpcData as Record<string, unknown>;
    return {
      id: data.id as number,
      dulabsSessionId: data.dulabs_session_id as string,
      campanaId: (data.campana_id as number) ?? null,
      plantillaId: (data.plantilla_id as number) ?? null,
      session: rowToSession(data),
    };
  } catch (err) {
    logMissingOnce("crearCampaignLeadRow (throw)", err);
    return null;
  }
}

/**
 * Persiste el estado resultante de un turno del motor, en la fila exacta de
 * esa sesión (dulabs_session_id) — NO por phone_number_id+telefono_cliente:
 * un teléfono puede tener varias filas históricas, y filtrar solo por esos
 * dos campos sobreescribiría también las sesiones terminales de campañas
 * anteriores de ese mismo teléfono.
 */
export async function guardarCampaignLead(
  supabase: SupabaseClient,
  dulabsSessionId: string,
  session: CampaignLeadSession
): Promise<void> {
  try {
    const { error } = await supabase
      .from("dulabs_campaign_leads")
      .update(sessionToRow(session))
      .eq("dulabs_session_id", dulabsSessionId);
    if (error) logMissingOnce("guardarCampaignLead", error);
  } catch (err) {
    logMissingOnce("guardarCampaignLead (throw)", err);
  }
}

/** Actualiza dumo_sync_status tras intentar transferir un lead capturado a DuMo. */
export async function marcarDumoSyncStatus(
  supabase: SupabaseClient,
  dulabsSessionId: string,
  status: "pending" | "synced" | "error"
): Promise<void> {
  try {
    const { error } = await supabase
      .from("dulabs_campaign_leads")
      .update({ dumo_sync_status: status, dumo_synced_at: status === "synced" ? new Date().toISOString() : null })
      .eq("dulabs_session_id", dulabsSessionId);
    if (error) logMissingOnce("marcarDumoSyncStatus", error);
  } catch (err) {
    logMissingOnce("marcarDumoSyncStatus (throw)", err);
  }
}
