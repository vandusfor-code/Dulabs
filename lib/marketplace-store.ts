import type { SupabaseClient } from "@supabase/supabase-js";
import type { TipoPlanMarketplace } from "@/lib/marketplace";
import { agentePorSlug } from "@/lib/marketplace";
import { RECURSOS_DISPONIBLES_POR_DEFECTO, DURACION_ESTANDAR_MIN_POR_DEFECTO } from "@/lib/agente-config";

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
  es_cortesia: boolean;
  cortesia_activada_por: string | null;
  cortesia_motivo: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNAS =
  "id, id_tenant, phone_number_id, agente_slug, tipo_plan, estado, precio_cop, fecha_proximo_cobro, vence_at, numero_admin, nombre_admin, config_texto, config_nombre_archivo, recursos_disponibles, duracion_estandar_min, wompi_payment_source_id, wompi_customer_email, es_cortesia, cortesia_activada_por, cortesia_motivo, created_at, updated_at";

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

// Desactiva una activación del marketplace: la marca 'vencida' y devuelve el
// número a su agente propio (marketplace_activacion_id -> null). La config
// propia del cliente nunca se toca, así que vuelve a usarse sola. Compartida
// entre el cron de cobro (vencimiento/rebote de pago recurrente) y el
// webhook de Wompi (transacción de marketplace que termina DECLINED/ERROR/
// VOIDED de forma asíncrona).
export async function desactivarActivacion(supabase: SupabaseClient, activacionId: number): Promise<void> {
  await supabase
    .from("dulabs_clientes_config")
    .update({ marketplace_activacion_id: null })
    .eq("marketplace_activacion_id", activacionId);
  await supabase
    .from("dulabs_marketplace_activaciones")
    .update({ estado: "vencida", updated_at: new Date().toISOString() })
    .eq("id", activacionId);
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

export type ResultadoActivacionCortesia =
  | { ok: true; activacion: ActivacionMarketplace; yaEstabaActivo: boolean }
  | { ok: false; motivo: "numero_no_encontrado"; }
  | { ok: false; motivo: "agente_no_encontrado" }
  | { ok: false; motivo: "otro_producto_activo"; activacionExistente: ActivacionMarketplace }
  | { ok: false; motivo: "error"; detalle: string };

// Activación administrativa SIN COBRO de un agente del Marketplace, para el
// botón "Activar en cortesía" del Panel de Operaciones (Fase 1). Reutiliza
// EXACTAMENTE el mismo mecanismo que la activación pagada
// (app/api/dashboard/marketplace/activar/route.ts): una fila normal de
// dulabs_marketplace_activaciones con estado='activa' que "sombrea" el
// número vía dulabs_clientes_config.marketplace_activacion_id -- el webhook
// (resolverContextoMensaje) no distingue entre una activación pagada y una
// de cortesía, así que el agente responde exactamente igual.
//
// La única diferencia real es que esta función NUNCA llama a Wompi: precio
// 0, fecha_proximo_cobro null (el cron de cobro mensual ya se salta
// cualquier fila con esa columna en null, así que nunca se cobra ni expira
// sola) y wompi_payment_source_id/email null (ni siquiera requiere que el
// tenant tenga un método de pago guardado). NO toca el flujo de compra
// normal ni ninguna de sus rutas.
//
// Idempotente: si el número YA tiene este mismo producto activo, no crea
// una fila nueva -- devuelve la existente con yaEstabaActivo=true. Si tiene
// un producto DISTINTO activo, no lo reemplaza (mismo comportamiento que la
// compra normal: hay que desactivar primero).
export async function activarMarketplaceCortesia(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    phoneNumberId: string;
    slug: string;
    configTexto: string;
    activadaPorUserId: string;
    motivo: string;
  }
): Promise<ResultadoActivacionCortesia> {
  const agente = agentePorSlug(params.slug);
  if (!agente) return { ok: false, motivo: "agente_no_encontrado" };

  const { data: cliente, error: clienteError } = await supabase
    .from("dulabs_clientes_config")
    .select("id, marketplace_activacion_id")
    .eq("phone_number_id", params.phoneNumberId)
    .eq("id_tenant", params.idTenant)
    .maybeSingle();
  if (clienteError) return { ok: false, motivo: "error", detalle: clienteError.message };
  if (!cliente) return { ok: false, motivo: "numero_no_encontrado" };

  if (cliente.marketplace_activacion_id) {
    const activacionActual = await getActivacionPorId(supabase, cliente.marketplace_activacion_id);
    if (activacionActual && activacionActual.estado === "activa") {
      if (activacionActual.agente_slug === params.slug) {
        return { ok: true, activacion: activacionActual, yaEstabaActivo: true };
      }
      return { ok: false, motivo: "otro_producto_activo", activacionExistente: activacionActual };
    }
  }

  const { data: nuevaActivacion, error: insertError } = await supabase
    .from("dulabs_marketplace_activaciones")
    .insert({
      id_tenant: params.idTenant,
      phone_number_id: params.phoneNumberId,
      agente_slug: params.slug,
      tipo_plan: "recurrente",
      estado: "activa",
      precio_cop: 0,
      fecha_proximo_cobro: null,
      vence_at: null,
      numero_admin: null,
      nombre_admin: null,
      config_texto: params.configTexto || null,
      config_nombre_archivo: "Cortesía (Panel de Operaciones)",
      recursos_disponibles: RECURSOS_DISPONIBLES_POR_DEFECTO,
      duracion_estandar_min: DURACION_ESTANDAR_MIN_POR_DEFECTO,
      wompi_payment_source_id: null,
      wompi_customer_email: null,
      es_cortesia: true,
      cortesia_activada_por: params.activadaPorUserId,
      cortesia_motivo: params.motivo,
    })
    .select(COLUMNAS)
    .single();

  if (insertError) {
    // 23505 = el índice único parcial (una activación 'activa' por número)
    // chocó -- otra pestaña/click concurrente ganó la carrera. No es un
    // error real: se relee cuál quedó activa y se responde igual de
    // idempotente que si la hubiéramos encontrado arriba.
    if (insertError.code === "23505") {
      const activacionGanadora = await getActivacionActivaPorNumero(supabase, params.phoneNumberId);
      if (activacionGanadora) {
        if (activacionGanadora.agente_slug === params.slug) {
          return { ok: true, activacion: activacionGanadora, yaEstabaActivo: true };
        }
        return { ok: false, motivo: "otro_producto_activo", activacionExistente: activacionGanadora };
      }
    }
    return { ok: false, motivo: "error", detalle: insertError.message };
  }

  const { error: updateError } = await supabase
    .from("dulabs_clientes_config")
    .update({ marketplace_activacion_id: nuevaActivacion.id })
    .eq("id", cliente.id);
  if (updateError) {
    console.error(
      `[marketplace-store] ALERTA: activación de cortesía ${nuevaActivacion.id} (tenant ${params.idTenant}) quedó creada pero no se pudo encender en el número ${params.phoneNumberId} -- requiere arreglo manual:`,
      updateError.message
    );
    return { ok: false, motivo: "error", detalle: `Activación creada pero no se pudo encender en el número: ${updateError.message}` };
  }

  return { ok: true, activacion: nuevaActivacion as ActivacionMarketplace, yaEstabaActivo: false };
}
