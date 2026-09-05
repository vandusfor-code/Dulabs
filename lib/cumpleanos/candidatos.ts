import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteCumpleanos } from "./tipos";

// Cumpleaños automáticos (Fase 6A, genérico, autorizado) — 1) búsqueda de
// clientes que cumplen años, separada a propósito de configuración/mensaje/
// idempotencia/envío (cada una en su propio archivo).

/** Pura -- nunca llama Date.now() por su cuenta, siempre recibe día/mes ya resueltos en la zona horaria correcta (ver fecha.ts). */
export function esCumpleanosHoy(cumpleDia: number | null, cumpleMes: number | null, diaHoy: number, mesHoy: number): boolean {
  if (!cumpleDia || !cumpleMes) return false;
  return cumpleDia === diaHoy && cumpleMes === mesHoy;
}

/**
 * Clientes de UN tenant cuyo cumpleaños (día/mes, sin año) cae en la fecha
 * dada. SIEMPRE filtrado por id_tenant -- un negocio nunca ve clientes de
 * otro. Descarta clientes sin WhatsApp usable (defensivo: la columna es
 * NOT NULL, pero un valor vacío/solo-espacios no debe llegar al envío).
 *
 * `soloTelefono` (Fase 6B, opcional) -- acota el lote a UN solo teléfono.
 * Nunca lo usa el cron diario (siempre corre sin filtro); existe para poder
 * ejecutar una prueba real controlada contra un único número autorizado sin
 * arriesgarse a alcanzar a ningún otro cliente real del mismo tenant que
 * también cumpla años ese día.
 */
export async function buscarCumpleanosDelDia(
  supabase: SupabaseClient,
  idTenant: string,
  fecha: { dia: number; mes: number },
  opciones?: { soloTelefono?: string }
): Promise<ClienteCumpleanos[]> {
  let consulta = supabase
    .from("dulabs_clientes_conocidos")
    .select("id, id_tenant, phone_number_id, telefono_cliente, nombre, cumple_dia, cumple_mes")
    .eq("id_tenant", idTenant)
    .eq("cumple_dia", fecha.dia)
    .eq("cumple_mes", fecha.mes);
  if (opciones?.soloTelefono) consulta = consulta.eq("telefono_cliente", opciones.soloTelefono);

  const { data, error } = await consulta;
  if (error) throw error;

  type Fila = {
    id: number;
    id_tenant: string;
    phone_number_id: string;
    telefono_cliente: string | null;
    nombre: string;
    cumple_dia: number;
    cumple_mes: number;
  };

  return ((data ?? []) as Fila[])
    .filter((c) => Boolean(c.telefono_cliente?.trim()))
    .map((c) => ({
      id: c.id,
      idTenant: c.id_tenant,
      phoneNumberId: c.phone_number_id,
      telefonoCliente: (c.telefono_cliente as string).trim(),
      nombre: c.nombre,
      cumpleDia: c.cumple_dia,
      cumpleMes: c.cumple_mes,
    }));
}
