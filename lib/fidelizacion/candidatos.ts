import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerReglasActivas } from "./reglas";
import { buscarVisitasCompletadas } from "./visitas";
import { diasTranscurridos, haVencido } from "./vencimiento";
import type { CandidatoFidelizacion } from "./tipos";

// Fidelización (Fase 7, genérico, autorizado) — 4) generación de
// candidatos: combina reglas + visitas + vencimiento + resolución del
// cliente real (dulabs_clientes_conocidos, SIN crear otra tabla de
// clientes). Todavía no escribe nada -- eso es responsabilidad del motor
// (idempotencia + persistencia), no de esta función.
export async function buscarCandidatosDelTenant(supabase: SupabaseClient, idTenant: string, ahora: Date): Promise<CandidatoFidelizacion[]> {
  const reglas = await obtenerReglasActivas(supabase, idTenant);
  if (reglas.length === 0) return [];

  const candidatos: CandidatoFidelizacion[] = [];

  for (const regla of reglas) {
    const visitas = await buscarVisitasCompletadas(supabase, idTenant, regla.servicioId);
    const vencidas = visitas.filter((v) => haVencido(new Date(v.inicio), regla.dias, ahora));
    if (vencidas.length === 0) continue;

    // Resolver el cliente real conocido para cada visita vencida, en un
    // solo viaje por lote (no una consulta por visita).
    const claves = vencidas.map((v) => ({ phone_number_id: v.phoneNumberId, telefono_cliente: v.telefonoCliente }));
    const phoneNumberIds = Array.from(new Set(claves.map((c) => c.phone_number_id)));
    const { data: clientesConocidos } = await supabase
      .from("dulabs_clientes_conocidos")
      .select("id, phone_number_id, telefono_cliente, nombre")
      .eq("id_tenant", idTenant)
      .in("phone_number_id", phoneNumberIds);

    const clientePorClave = new Map<string, { id: number; nombre: string }>();
    for (const c of (clientesConocidos ?? []) as { id: number; phone_number_id: string; telefono_cliente: string; nombre: string }[]) {
      clientePorClave.set(`${c.phone_number_id}|${c.telefono_cliente}`, { id: c.id, nombre: c.nombre });
    }

    for (const visita of vencidas) {
      const cliente = clientePorClave.get(`${visita.phoneNumberId}|${visita.telefonoCliente}`);
      if (!cliente) continue; // sin registro conocido -- no se inventa un cliente, se omite esta visita.

      candidatos.push({
        regla,
        visita,
        clienteId: cliente.id,
        nombreCliente: cliente.nombre,
        diasTranscurridos: diasTranscurridos(new Date(visita.inicio), ahora),
      });
    }
  }

  return candidatos;
}
