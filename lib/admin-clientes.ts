import type { SupabaseClient } from "@supabase/supabase-js";

export type EstadoImplementacion = "PENDIENTE" | "EN_CONFIGURACION" | "EN_PRUEBAS" | "ACTIVO" | "REQUIERE_ATENCION";

export type ClienteAdmin = {
  idTenant: string;
  nombre: string | null;
  correo: string | null;
  telefono: string | null;
  plan: string;
  fechaCompra: string;
  estadoPago: string;
  // Onboarding: null si el pago se confirmó pero, por lo que sea (sin
  // telefono_onboarding, ver lib/onboarding-trigger.ts), nunca se creó la
  // sesión -- el cliente igual debe aparecer, con esto en null.
  onboarding: {
    estado: string;
    businessDescription: string | null;
    implementationIdea: string | null;
    additionalInformation: string | null;
    iniciadoAt: string;
    actualizadoAt: string;
    phoneNumberId: string;
    telefonoCliente: string;
    estadoImplementacion: EstadoImplementacion;
    implementacionIniciadaAt: string | null;
    activadoAt: string | null;
  } | null;
};

// auth.admin.listUsers() no soporta filtrar por id/búsqueda -- se trae todo
// una vez (paginado) y se arma un mapa en memoria. A esta escala (clientes
// propios de DuLabs, recién empezando) es simple y suficiente; si el
// volumen crece, esto es lo primero que habría que optimizar.
async function mapaUsuarios(supabase: SupabaseClient): Promise<Map<string, { email: string | null; nombre: string | null }>> {
  const mapa = new Map<string, { email: string | null; nombre: string | null }>();
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 25; i++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error || !data) break;
    for (const u of data.users) {
      mapa.set(u.id, { email: u.email ?? null, nombre: (u.user_metadata?.nombre as string | undefined) ?? null });
    }
    if (data.users.length < perPage) break;
    page++;
  }
  return mapa;
}

// Único punto de lectura para el Panel de Operaciones -- reusado por
// /api/dashboard/admin/resumen y /api/dashboard/admin/clientes, para no
// duplicar el join suscripciones + onboarding_sesiones + auth.users.
export async function obtenerClientesAdmin(supabase: SupabaseClient): Promise<ClienteAdmin[]> {
  const [{ data: suscripciones, error: susError }, { data: sesiones, error: sesError }, usuarios] = await Promise.all([
    supabase
      .from("dulabs_suscripciones")
      .select("id_tenant, plan, estado, created_at, telefono_onboarding, wompi_customer_email")
      .order("created_at", { ascending: false }),
    supabase
      .from("dulabs_onboarding_sesiones")
      .select(
        "id_tenant, estado, business_description, implementation_idea, additional_information, iniciado_at, updated_at, phone_number_id, telefono_cliente, estado_implementacion, implementacion_iniciada_at, activado_at"
      ),
    mapaUsuarios(supabase),
  ]);
  if (susError) throw new Error(susError.message);
  if (sesError) throw new Error(sesError.message);

  const sesionPorTenant = new Map((sesiones ?? []).map((s) => [s.id_tenant, s]));

  return (suscripciones ?? []).map((s) => {
    const usuario = usuarios.get(s.id_tenant);
    const sesion = sesionPorTenant.get(s.id_tenant);
    return {
      idTenant: s.id_tenant,
      nombre: usuario?.nombre ?? null,
      correo: usuario?.email ?? s.wompi_customer_email ?? null,
      telefono: s.telefono_onboarding,
      plan: s.plan,
      fechaCompra: s.created_at,
      estadoPago: s.estado,
      onboarding: sesion
        ? {
            estado: sesion.estado,
            businessDescription: sesion.business_description,
            implementationIdea: sesion.implementation_idea,
            additionalInformation: sesion.additional_information,
            iniciadoAt: sesion.iniciado_at,
            actualizadoAt: sesion.updated_at,
            phoneNumberId: sesion.phone_number_id,
            telefonoCliente: sesion.telefono_cliente,
            estadoImplementacion: sesion.estado_implementacion as EstadoImplementacion,
            implementacionIniciadaAt: sesion.implementacion_iniciada_at,
            activadoAt: sesion.activado_at,
          }
        : null,
    };
  });
}

export type NumeroAdmin = {
  phoneNumberId: string;
  nombreNegocio: string;
  telefonoNegocio: string;
  /** Mismo criterio que /api/dashboard/me: hay token de Meta guardado (propio o el genérico del entorno). */
  conectado: boolean;
  agenteId: number | null;
  marketplaceActivacionId: number | null;
};

// Números de WhatsApp de UN tenant específico, para las secciones
// "Soluciones", "Agente de IA" y "WhatsApp" del detalle de cliente del Panel
// de Operaciones -- compartido entre esos endpoints para no repetir la
// misma consulta ni duplicar la lógica de "conectado" (ver /api/dashboard/me).
export async function obtenerNumerosAdmin(supabase: SupabaseClient, idTenant: string): Promise<NumeroAdmin[]> {
  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .select("phone_number_id, nombre_negocio, telefono_negocio, meta_permanent_token, agente_id, marketplace_activacion_id")
    .eq("id_tenant", idTenant)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((n) => ({
    phoneNumberId: n.phone_number_id,
    nombreNegocio: n.nombre_negocio,
    telefonoNegocio: n.telefono_negocio,
    conectado: Boolean(n.meta_permanent_token || process.env.META_ACCESS_TOKEN),
    agenteId: n.agente_id,
    marketplaceActivacionId: n.marketplace_activacion_id,
  }));
}
