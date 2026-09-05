import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarCandidatosDelTenant } from "./candidatos";
import { renderizarMensajeFidelizacion } from "./mensaje";
import { reclamarOportunidad } from "./idempotencia";

// Fidelización (Fase 7, genérico, autorizado) — 7/8) orquestación +
// estado de la oportunidad. Nada acá menciona AMORE -- todo llega
// parametrizado por idTenant, el mismo motor correría para cualquier otro
// negocio que active sus propias reglas.
//
// Esta fase NO envía nada (WhatsApp llega en la Fase 9 vía QR): el motor
// solo GENERA oportunidades (persiste una fila con estado "pendiente" y el
// mensaje ya renderizado) para que el panel las muestre. `dryRun` decide si
// esa persistencia ocurre o si solo se devuelve la vista previa.

export type ResultadoCandidatoFidelizacion =
  | { clienteId: number; nombre: string; servicio: string; resultado: "generada"; oportunidadId: number }
  | { clienteId: number; nombre: string; servicio: string; resultado: "candidato" } // dry-run: se generaría, pero no se persistió
  | { clienteId: number; nombre: string; servicio: string; resultado: "ya_existia" };

export type ResultadoProcesarFidelizacion = {
  idTenant: string;
  dryRun: boolean;
  candidatos: number;
  procesados: ResultadoCandidatoFidelizacion[];
};

export async function procesarFidelizacionDelTenant(
  supabase: SupabaseClient,
  params: { idTenant: string; ahora?: Date; dryRun?: boolean }
): Promise<ResultadoProcesarFidelizacion> {
  const ahora = params.ahora ?? new Date();
  const dryRun = params.dryRun ?? false;

  const candidatos = await buscarCandidatosDelTenant(supabase, params.idTenant, ahora);
  const procesados: ResultadoCandidatoFidelizacion[] = [];

  for (const c of candidatos) {
    const mensaje = renderizarMensajeFidelizacion(c.regla.mensaje, {
      nombre: c.nombreCliente,
      servicio: c.visita.servicioNombre,
      dias: c.regla.dias,
    });

    if (dryRun) {
      // Solo lectura: ¿ya existe una oportunidad para (regla, cita)? No se
      // reclama nada -- dry-run nunca escribe.
      const { data: existente } = await supabase
        .from("dulabs_fidelizacion_oportunidades")
        .select("id")
        .eq("id_tenant", params.idTenant)
        .eq("regla_id", c.regla.id)
        .eq("cita_id", c.visita.citaId)
        .maybeSingle();
      procesados.push({
        clienteId: c.clienteId,
        nombre: c.nombreCliente,
        servicio: c.visita.servicioNombre,
        resultado: existente ? "ya_existia" : "candidato",
      });
      continue;
    }

    const claim = await reclamarOportunidad(supabase, {
      idTenant: params.idTenant,
      reglaId: c.regla.id,
      citaId: c.visita.citaId,
      clienteId: c.clienteId,
      telefonoCliente: c.visita.telefonoCliente,
      fechaVisita: c.visita.inicio,
      diasRegla: c.regla.dias,
      mensajeRenderizado: mensaje,
    });

    if (claim.estado === "ya_existia") {
      procesados.push({ clienteId: c.clienteId, nombre: c.nombreCliente, servicio: c.visita.servicioNombre, resultado: "ya_existia" });
    } else {
      procesados.push({
        clienteId: c.clienteId,
        nombre: c.nombreCliente,
        servicio: c.visita.servicioNombre,
        resultado: "generada",
        oportunidadId: claim.id,
      });
    }
  }

  return { idTenant: params.idTenant, dryRun, candidatos: candidatos.length, procesados };
}
