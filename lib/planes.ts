// Fuente única de verdad para los 4 planes de Du Labs (Start/Growth/Scale/
// Enterprise): precio y límites duros. Todo el enforcement (frontend y
// backend) y toda la copy de precios se derivan de aquí — nunca se
// hardcodea un nombre o límite de plan en otro archivo.
export type PlanId = "start" | "growth" | "scale" | "enterprise";

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
  id: PlanId;
  nombre: string;
  precioCop: number | null; // null = "Solicitar cotización" (Enterprise)
  limites: PlanLimites;
}

export const PLANES: Record<PlanId, PlanDef> = {
  start: {
    id: "start",
    nombre: "Start",
    precioCop: 19900,
    limites: {
      numeros: 1,
      usuarios: 1,
      agentesIA: 1,
      contactosPorCampana: 500,
      campanasSimultaneas: 1,
      mensajesIAMes: 1000,
      campanasPorMes: 8,
      encuestas: false,
      insightsIA: false,
    },
  },
  growth: {
    id: "growth",
    nombre: "Growth",
    precioCop: 49900,
    limites: {
      numeros: 2,
      usuarios: 5,
      agentesIA: 3,
      contactosPorCampana: 5000,
      campanasSimultaneas: 3,
      mensajesIAMes: 2500,
      campanasPorMes: 15,
      encuestas: true,
      insightsIA: false,
    },
  },
  scale: {
    id: "scale",
    nombre: "Scale",
    precioCop: 149900,
    limites: {
      numeros: 5,
      usuarios: 20,
      agentesIA: null,
      contactosPorCampana: 50000,
      campanasSimultaneas: 10,
      mensajesIAMes: 9000,
      campanasPorMes: null,
      encuestas: true,
      insightsIA: true,
    },
  },
  enterprise: {
    id: "enterprise",
    nombre: "Enterprise",
    precioCop: null,
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

export const ORDEN_PLANES: PlanId[] = ["start", "growth", "scale", "enterprise"];
export const PLAN_POR_DEFECTO: PlanId = "start";

// Normaliza cualquier valor guardado (incluidos los nombres viejos "Plan
// Básico"/"Plan Pro"/"Plan Enterprise" de antes de este cambio) a un PlanId
// válido, cayendo a PLAN_POR_DEFECTO ante cualquier duda.
export function resolverPlanId(valor: string | null | undefined): PlanId {
  if (valor && valor in PLANES) return valor as PlanId;
  return PLAN_POR_DEFECTO;
}

export function planPorId(id: PlanId): PlanDef {
  return PLANES[id];
}
