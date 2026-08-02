import type { SupabaseClient } from "@supabase/supabase-js";
import type { TipoPlanMarketplace } from "@/lib/marketplace";

// Capa de persistencia de las activaciones del Marketplace
// (dulabs_marketplace_activaciones). El catálogo de agentes es fijo y vive
// en lib/marketplace.ts; aquí solo se leen/escriben las activaciones reales.

export interface ActivacionMarketplace {
  id: number;
  id_tenant: string;
  phone_number_id: string;
  agente_slug: string;
  tipo_plan: TipoPlanMarketplace;
  estado: "activa" | "vencida" | "cancelada";
  precio_cop: number;
  fecha_proximo_cobro: string | null;
  vence_at: string | null;
  numero_admin: string | null;
  nombre_admin: string | null;
  config_texto: string | null;
  config_nombre_archivo: string | null;
  /** Citas simultáneas que puede atender el negocio. Solo relevante si el agente usa agenda. */
  recursos_disponibles: number;
  /** Duración estándar de una cita, en minutos. Solo relevante si el agente usa agenda. */
  duracion_estandar_min: number;
  wompi_payment_source_id: string | null;
  wompi_customer_email: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNAS =
  "id, id_tenant, phone_number_id, agente_slug, tipo_plan, estado, precio_cop, fecha_proximo_cobro, vence_at, numero_admin, nombre_admin, config_texto, config_nombre_archivo, recursos_disponibles, duracion_estandar_min, wompi_payment_source_id, wompi_customer_email, created_at, updated_at";

export async function getActivacionPorId(
  supabase: SupabaseClient,
  id: number
): Promise<ActivacionMarketplace | null> {
  const { data } = await supabase
    .from("dulabs_marketplace_activaciones")
    .select(COLUMNAS)
    .eq("id", id)
    .maybeSingle();
  return (data as ActivacionMarketplace | null) ?? null;
}

/** La activación ACTIVA (una sola, por el índice parcial único) de un número. */
export async function getActivacionActivaPorNumero(
  supabase: SupabaseClient,
  phoneNumberId: string
): Promise<ActivacionMarketplace | null> {
  const { data } = await supabase
    .from("dulabs_marketplace_activaciones")
    .select(COLUMNAS)
    .eq("phone_number_id", phoneNumberId)
    .eq("estado", "activa")
    .maybeSingle();
  return (data as ActivacionMarketplace | null) ?? null;
}

// Normaliza un teléfono a solo dígitos con código de país, para que
// "300 123 4567", "+57 300 123 4567" y "573001234567" se traten como el
// mismo número al comparar el remitente entrante contra el número admin
// guardado. Un móvil colombiano suelto (10 dígitos que empiezan por 3) se
// asume +57 (mercado actual de Du Labs).
export function normalizarTelefono(valor: string | null | undefined): string {
  const digitos = (valor ?? "").replace(/\D/g, "");
  if (digitos.length === 10 && digitos.startsWith("3")) return `57${digitos}`;
  return digitos;
}
