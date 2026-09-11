// Fuente única de verdad para los planes de Du Labs: precio y límites duros.
// Todo el enforcement (frontend y backend) y toda la copy de precios se
// derivan de aquí — nunca se hardcodea un nombre o límite de plan en otro
// archivo.
//
// start/growth/scale son los planes LEGACY (propuesta comercial anterior) --
// quedan intactos, sin vender, EXCLUSIVAMENTE para no romper a los tenants
// que ya los tienen activos (dulabs_suscripciones.plan sigue guardando ese
// string; lib/plan-limits.ts:planDelTenant lo resuelve en vivo contra este
// objeto en cada request, así que borrar/renombrar estas llaves rompería a
// esos tenants de inmediato -- ver auditoría de la migración de pricing).
// essential/business/pro son los planes NUEVOS (propuesta comercial DuLabs
// v2) -- son los únicos que se ofrecen a clientes nuevos desde /newversion.
export type PlanId = "start" | "growth" | "scale" | "essential" | "business" | "pro" | "enterprise";

export interface PlanLimites {
  numeros: number | null; // null = ilimitado
  usuarios: number | null;
  agentesIA: number | null;
  contactosPorCampana: number | null;
  campanasSimultaneas: number | null;
  /** Mensajes de IA salientes por mes (pool del tenant). null = ilimitado. */
  mensajesIAMes: number | null;
  /** Campañas que se pueden enviar por mes desde el panel. null = sin límite. */
  campanasPorMes: number | null;
  /** Acceso al módulo de Encuestas (crear/enviar/resultados/embudo). */
  encuestas: boolean;
  /** Insights de IA sobre respuestas de encuestas (análisis de sentimiento). */
  insightsIA: boolean;
}

export interface PlanDef {
  id: PlanId | "sin_plan";
  nombre: string;
  precioCop: number | null; // null = "Solicitar cotización" (Enterprise) -- mensualidad, cobro recurrente
  /** Pago único por configurar y poner en marcha el asistente. null = sin cobro de implementación (Enterprise, a medida). */
  implementacionCop: number | null;
  limites: PlanLimites;
}

export const PLANES: Record<PlanId, PlanDef> = {
  start: {
    id: "start",
    nombre: "Start",
    precioCop: 39900,
    implementacionCop: 99900,
    limites: {
      numeros: 1,
      usuarios: 1,
      agentesIA: 1,
      contactosPorCampana: 500,
      campanasSimultaneas: 1,
      mensajesIAMes: 500,
      campanasPorMes: 8,
      encuestas: false,
      insightsIA: false,
    },
  },
  growth: {
    id: "growth",
    nombre: "Growth",
    precioCop: 89900,
    implementacionCop: 149900,
    limites: {
      numeros: 2,
      usuarios: 5,
      agentesIA: 3,
      contactosPorCampana: 5000,
      campanasSimultaneas: 3,
      mensajesIAMes: 1200,
      campanasPorMes: 15,
      encuestas: true,
      insightsIA: false,
    },
  },
  scale: {
    id: "scale",
    nombre: "Scale",
    precioCop: 179900,
    implementacionCop: 249900,
    limites: {
      numeros: 5,
      usuarios: 20,
      agentesIA: null,
      contactosPorCampana: 50000,
      campanasSimultaneas: 10,
      mensajesIAMes: 2500,
      campanasPorMes: null,
      encuestas: true,
      insightsIA: true,
    },
  },
  // --- Planes nuevos (propuesta comercial DuLabs v2, aprobada) ---
  essential: {
    id: "essential",
    nombre: "Essential",
    precioCop: 79990,
    implementacionCop: 149900,
    limites: {
      numeros: 1,
      usuarios: 2,
      agentesIA: 1,
      contactosPorCampana: 500,
      campanasSimultaneas: 1,
      mensajesIAMes: 800,
      campanasPorMes: 8,
      encuestas: false,
      insightsIA: false,
    },
  },
  business: {
    id: "business",
    nombre: "Business",
    precioCop: 159990,
    implementacionCop: 299900,
    limites: {
      numeros: 2,
      usuarios: 5,
      agentesIA: 3,
      contactosPorCampana: 5000,
      campanasSimultaneas: 3,
      mensajesIAMes: 2000,
      campanasPorMes: 15,
      encuestas: true,
      insightsIA: false,
    },
  },
  pro: {
    id: "pro",
    nombre: "Pro",
    precioCop: 299990,
    // "Desde" -- el equipo comercial puede cotizar más alto según alcance,
    // pero el checkout siempre cobra este valor de referencia (mismo patrón
    // que ya usan start/growth/scale, ninguno tiene lógica de "desde X").
    implementacionCop: 499900,
    limites: {
      numeros: 5,
      usuarios: 15,
      agentesIA: 10,
      contactosPorCampana: 50000,
      campanasSimultaneas: 10,
      mensajesIAMes: 4000,
      campanasPorMes: null, // "Campañas ilimitadas": sin cupo comercial de creación mensual, ver 08_pricing/copy
      encuestas: true,
      insightsIA: true,
    },
  },
  enterprise: {
    id: "enterprise",
    nombre: "Enterprise",
    precioCop: null,
    implementacionCop: null,
    limites: {
      numeros: null,
      usuarios: null,
      agentesIA: null,
      contactosPorCampana: null,
      campanasSimultaneas: null,
      mensajesIAMes: null,
      campanasPorMes: null,
      encuestas: true,
      insightsIA: true,
    },
  },
};

// Orden de la pagina de precios EN PRODUCCION (/precios, PricingSection) --
// NUNCA se toca para incluir los planes nuevos: la web real sigue vendiendo
// exactamente start/growth/scale/enterprise hasta que se autorice migrarla.
export const ORDEN_PLANES: PlanId[] = ["start", "growth", "scale", "enterprise"];

// Orden de la nueva propuesta comercial (usado SOLO por /newversion,
// components/site-v2/PricingV2.tsx) -- los 3 planes nuevos + Enterprise,
// nunca los legacy.
export const ORDEN_PLANES_V2: PlanId[] = ["essential", "business", "pro", "enterprise"];

// Union completa (legacy + nueva) SOLO para herramientas internas de admin:
// a diferencia de ORDEN_PLANES (lo que /precios vende hoy) y ORDEN_PLANES_V2
// (lo que /newversion vende), el equipo de DuLabs necesita listar/filtrar/
// activar manualmente un tenant sin importar en qué era se suscribió -- un
// cliente Growth de hace meses y uno Business de hoy conviven en la misma
// pantalla de admin. NO usar esta constante para nada que decida qué le
// ofrece la web pública a un visitante nuevo.
export const ORDEN_PLANES_ADMIN: PlanId[] = [
  "start",
  "growth",
  "scale",
  "essential",
  "business",
  "pro",
  "enterprise",
];
// Fallback SOLO para resolverPlanId: normaliza un nombre de plan viejo o
// desconocido guardado en una suscripción que YA está activa (alguien que
// sí pagó). NUNCA se usa para "sin suscripción" -- ver SIN_PLAN más abajo,
// que es lo que consume planDelTenant() cuando no hay fila activa.
export const PLAN_POR_DEFECTO: PlanId = "start";

// Límites de un tenant SIN ninguna suscripción activa: cero funcionalidad
// (no conecta número, la IA no responde, no puede enviar campañas ni
// encuestas) hasta que pague. Deliberadamente NO es un plan comprable --no
// está en PLANES ni en ORDEN_PLANES, el checkout nunca lo acepta-- para que
// nunca se confunda con un plan real ni se le pueda asignar a una
// suscripción por error.
export const SIN_PLAN: PlanDef = {
  id: "sin_plan",
  nombre: "Sin plan",
  precioCop: null,
  implementacionCop: null,
  limites: {
    numeros: 0,
    usuarios: 0,
    agentesIA: 0,
    contactosPorCampana: 0,
    campanasSimultaneas: 0,
    mensajesIAMes: 0,
    campanasPorMes: 0,
    encuestas: false,
    insightsIA: false,
  },
};

// Normaliza cualquier valor guardado (incluidos los nombres viejos "Plan
// Básico"/"Plan Pro"/"Plan Enterprise" de antes de este cambio) a un PlanId
// válido, cayendo a PLAN_POR_DEFECTO ante cualquier duda. Solo se llama
// cuando YA se confirmó que hay una suscripción activa -- por eso cae a
// "start" y no a "sin_plan".
export function resolverPlanId(valor: string | null | undefined): PlanId {
  if (valor && valor in PLANES) return valor as PlanId;
  return PLAN_POR_DEFECTO;
}

export function planPorId(id: PlanId): PlanDef {
  return PLANES[id];
}

export function esSinPlan(plan: PlanDef): boolean {
  return plan.id === "sin_plan";
}

// Precio real a cobrar: el negociado para ESTE tenant si existe (ver
// dulabs_suscripciones.precio_negociado_cop), si no el de lista del plan.
// Función pura y aislada a propósito -- es el único lugar que decide cuánto
// se le cobra de verdad a alguien en Wompi, así que se puede probar sola sin
// tocar la base de datos ni la API de pagos.
export function resolverPrecioSuscripcion(precioListaCop: number, precioNegociadoCop: number | null): number {
  return precioNegociadoCop ?? precioListaCop;
}

// Mensaje de bloqueo cuando el tenant NO tiene suscripción activa. Sin esto,
// los mensajes de límite se renderizan como "Tu plan Sin plan permite máximo
// 0 números. Mejora tu plan para conectar otro." — literalmente cierto pero
// inservible: el usuario no tiene que "mejorar" nada, tiene que activar su
// primer plan, que es una acción distinta y en otra pantalla.
export const MENSAJE_SIN_PLAN =
  "Todavía no tienes un plan activo. Activa uno para empezar a usar Du Labs — puedes elegirlo en la página de planes.";
