import type { SupabaseClient } from "@supabase/supabase-js";
import { MESES_COBRADOS, esPlanManual } from "@/lib/developer/billing/pricing";

// DuLabs Developer V1 -- Fase 15 (Landing comercial). Proyección PÚBLICA y
// READ-ONLY del catálogo comercial de planes. Fuente única de verdad: la tabla
// dulabs_dev_plans (Fase 7/11) + la lógica de pricing de Fase 12 (anual = x10
// vía MESES_COBRADOS, Enterprise manual vía esPlanManual). NO se duplican
// cifras ni reglas aquí: solo se leen y se proyectan a lo COMERCIALMENTE
// seguro. NUNCA expone cuentas, tokens, secretos, billing privado ni IDs
// internos sensibles -- solo el catálogo (nombre, precio de lista, límites
// comerciales y si el plan permite checkout self-service).

/** Campos comerciales seguros del catálogo. Deliberadamente NO incluye nada
 *  ligado a una cuenta, suscripción, pago o secreto. */
export type PlanPublico = {
  /** Identificador estable para el frontend (código en minúsculas). */
  slug: string;
  nombre: string;
  /** Precio de lista mensual en USD (null = sin precio de lista / a cotizar). */
  precioMensualUsd: number | null;
  /** Precio anual total en USD DERIVADO (mensual x10 = 2 meses gratis). */
  precioAnualUsd: number | null;
  /** Equivalente mensual cuando se paga anual (precio anual / 12), para mostrar. */
  equivalenteMensualAnualUsd: number | null;
  mensajesMensualesIncluidos: number | null;
  numerosIncluidos: number | null;
  mensajesPorSegundoPorNumero: number | null;
  maxWorkspaces: number | null;
  maxMembers: number | null;
  permiteNumerosAdicionales: boolean;
  precioNumeroAdicionalUsd: number | null;
  /** true si el plan permite checkout self-service (Enterprise = false). */
  checkoutHabilitado: boolean;
  /** true si el plan es de contratación manual/ventas (Enterprise). */
  esManual: boolean;
};

/** Fila cruda del catálogo (subconjunto comercial de dulabs_dev_plans). */
type PlanFilaComercial = {
  codigo: string;
  nombre: string;
  precio_mensual_usd: number | null;
  mensajes_mensuales_incluidos: number | null;
  numeros_incluidos: number | null;
  mensajes_por_segundo_por_numero: number | null;
  max_workspaces: number | null;
  max_members: number | null;
  permite_numeros_adicionales: boolean;
  precio_numero_adicional_usd: number | null;
};

const CAMPOS_COMERCIALES =
  "codigo, nombre, precio_mensual_usd, mensajes_mensuales_incluidos, numeros_incluidos, mensajes_por_segundo_por_numero, max_workspaces, max_members, permite_numeros_adicionales, precio_numero_adicional_usd";

/** Redondea a centavos (evita floats largos en la respuesta pública). */
function aCentavos(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Proyección PURA de una fila del catálogo a su forma pública. El precio anual
 * se deriva con MESES_COBRADOS.year (x10) -- misma regla que el checkout real
 * de Fase 12, no una copia. Testeable sin DB.
 */
export function aPlanPublico(fila: PlanFilaComercial): PlanPublico {
  const mensual = fila.precio_mensual_usd;
  const manual = esPlanManual(fila.codigo);
  const anual = mensual === null ? null : aCentavos(mensual * MESES_COBRADOS.year);
  const equivalenteMensualAnual = anual === null ? null : aCentavos(anual / 12);
  return {
    slug: fila.codigo.toLowerCase(),
    nombre: fila.nombre,
    precioMensualUsd: mensual,
    precioAnualUsd: anual,
    equivalenteMensualAnualUsd: equivalenteMensualAnual,
    mensajesMensualesIncluidos: fila.mensajes_mensuales_incluidos,
    numerosIncluidos: fila.numeros_incluidos,
    mensajesPorSegundoPorNumero: fila.mensajes_por_segundo_por_numero,
    maxWorkspaces: fila.max_workspaces,
    maxMembers: fila.max_members,
    permiteNumerosAdicionales: fila.permite_numeros_adicionales,
    precioNumeroAdicionalUsd: fila.precio_numero_adicional_usd,
    // Self-service solo si hay precio de lista y no es plan manual.
    checkoutHabilitado: !manual && mensual !== null && mensual > 0,
    esManual: manual,
  };
}

/**
 * Lee el catálogo comercial de planes desde dulabs_dev_plans y lo proyecta a
 * su forma pública, ordenado por precio ascendente (Developer -> Agency ->
 * Enterprise). Solo lectura; sin ningún input del cliente.
 */
export async function listarPlanesPublicos(supabase: SupabaseClient): Promise<PlanPublico[]> {
  const { data, error } = await supabase.from("dulabs_dev_plans").select(CAMPOS_COMERCIALES);
  if (error) throw new Error(`[developers/planes-publicos] error leyendo catálogo: ${error.message}`);
  const filas = (data as PlanFilaComercial[]) ?? [];
  return filas
    .map(aPlanPublico)
    .sort((a, b) => (a.precioMensualUsd ?? Infinity) - (b.precioMensualUsd ?? Infinity));
}
