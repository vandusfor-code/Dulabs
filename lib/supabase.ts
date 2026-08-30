import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ClienteConfig = {
  id: string;
  id_tenant: string;
  nombre_negocio: string;
  whatsapp_business_account_id: string;
  phone_number_id: string;
  telefono_negocio: string;
  prompt_sistema: string | null;
  api_key_ia: string | null;
  meta_permanent_token: string | null;
  estado_pausa: boolean;
  pausado_hasta: string | null;
  plan: string | null;
  mensajes_usados_mes: number;
  mes_actual: string;
  base_conocimiento: string | null;
  base_conocimiento_nombre_archivo: string | null;
  base_conocimiento_actualizado_at: string | null;
  calidad: string | null;
  limite_mensajeria: string | null;
  estado_verificacion: string | null;
  estado_nombre_visible: string | null;
  ultima_sincronizacion_meta: string | null;
  nombre_agente: string | null;
  ia_pausada: boolean;
  /** NULL = responde a cualquiera. Con valor: solo estos números (coma-separados, solo dígitos) reciben respuesta. */
  ia_restringida_a: string | null;
  /** Lista negra: estos números (coma-separados, solo dígitos) NUNCA reciben respuesta de la IA, sin importar nada más. */
  ia_numeros_bloqueados: string | null;
  forward_to_dumo: boolean;
  captura_leads: boolean;
  agente_id: number | null;
  marketplace_activacion_id: number | null;
  /**
   * Opt-in EXPLÍCITO al motor Flow (Fase 0, migración
   * 20260829120000_dulabs_flow_activacion_opt_in.sql). Default false/no
   * existe todavía en DB hasta aplicar esa migración -- en ese caso llega
   * `undefined`, que es falsy, así que el webhook sigue yendo a LEGACY sin
   * ningún cambio de comportamiento. NUNCA inferir esto de otra señal
   * (especialistas activas, marketplace_activacion_id, etc.) -- ver
   * lib/flow-routing.ts.
   */
  flow_activo?: boolean;
  /** Flow publicado que atiende este número cuando flow_activo=true. */
  flow_id?: string | null;
  /**
   * Fase 2 (bug crítico real, prueba 314 sin confirmación; migración
   * <pendiente>_dulabs_citas_requiere_confirmacion_opt_in.sql, NO aplicada
   * todavía). Opt-in EXPLÍCITO por tenant: true = la herramienta
   * crear_solicitud_cita de LEGACY (lib/especialista-solicitud-ia.ts) exige
   * confirmado===true antes de crear la cita real -- mismo candado real en
   * código que ya existe para cancelar_mi_cita, nunca solo una instrucción
   * de prompt. Default false/undefined = comportamiento LEGACY actual
   * intacto, para no afectar a ningún otro tenant que dependa de la
   * creación inmediata. NUNCA activar a mano sin autorización explícita.
   */
  requiere_confirmacion_cita?: boolean;
  created_at: string;
  updated_at: string;
};

export type AgenteConfig = {
  id: number;
  id_tenant: string;
  nombre: string;
  prompt_sistema: string | null;
  base_conocimiento: string | null;
  base_conocimiento_nombre_archivo: string | null;
  base_conocimiento_actualizado_at: string | null;
  api_key_ia: string | null;
  created_at: string;
  updated_at: string;
};

export type PausaChat = {
  id: number;
  phone_number_id: string;
  telefono_cliente: string;
  pausado_hasta: string;
  created_at: string;
};

let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno"
      );
    }
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
