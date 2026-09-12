import type { SupabaseClient } from "@supabase/supabase-js";

// FASE F8.1 (Flow Engine <-> WhatsApp Cloud API, autorizado) -- resuelve una
// plantilla APROBADA por nombre, siempre acotada al tenant de la ejecución
// (mismo criterio exacto que resolverEtiquetaPorNombre en lib/etiquetas.ts):
// el nodo `enviar_plantilla` de un Flow nunca puede alcanzar la plantilla de
// otro tenant, ni una plantilla que Meta todavía no aprobó. `.limit(1)` en
// vez de `.maybeSingle()` sin filtro de idioma porque un mismo tenant puede
// tener la misma plantilla aprobada en varios idiomas (unique real es
// (waba_id, nombre, idioma), no (tenant, nombre)) -- se toma la primera
// aprobada de forma determinista en vez de fallar por "múltiples filas".
export interface PlantillaAprobada {
  id: number;
  nombre: string;
  idioma: string;
}

export async function resolverPlantillaAprobadaDelTenant(
  supabase: SupabaseClient,
  tenantId: string,
  nombre: string
): Promise<PlantillaAprobada | null> {
  const { data } = await supabase
    .from("dulabs_plantillas")
    .select("id, nombre, idioma")
    .eq("id_tenant", tenantId)
    .eq("nombre", nombre)
    .eq("estado", "APPROVED")
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as number, nombre: data.nombre as string, idioma: data.idioma as string };
}
