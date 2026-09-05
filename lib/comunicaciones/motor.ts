import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarCandidatosConfirmacion, buscarCandidatosRecordatorio } from "./candidatos";
import { obtenerConfigComunicaciones } from "./config";
import { renderizarMensajeComunicacion, formatearFechaComunicacion } from "./mensaje";
import { reclamarComunicacion } from "./idempotencia";
import { crearAdaptadorSimulado } from "./adaptador";
import { normalizarTelefono } from "@/lib/marketplace-store";
import type { CitaComunicable, TipoComunicacion, AdaptadorCanal } from "./tipos";

// Confirmaciones y recordatorios (Fase 8, genérico, autorizado) —
// orquestación: config -> candidatos (por tipo) -> render -> idempotencia
// -> adaptador. Nada acá menciona AMORE -- todo llega parametrizado por
// idTenant, el mismo motor correría para cualquier otro negocio que active
// su propia fila en dulabs_comunicaciones_config.
//
// Esta fase NUNCA envía WhatsApp real: `adaptador` por defecto es
// crearAdaptadorSimulado() (ver adaptador.ts) -- ni siquiera en modo "real"
// (dryRun=false) existe todavía un canal de verdad, a diferencia de
// cumpleaños/Fase 6B (que sí tenía WhatsApp Cloud API disponible). La Fase 9
// reemplaza el adaptador sin tocar este archivo.

export type ResultadoCitaComunicacion =
  | { citaId: number; tipo: TipoComunicacion; resultado: "procesada" }
  | { citaId: number; tipo: TipoComunicacion; resultado: "candidata" } // dry-run: se generaría, pero no se persistió ni se entregó
  | { citaId: number; tipo: TipoComunicacion; resultado: "ya_procesada" }
  | { citaId: number; tipo: TipoComunicacion; resultado: "fallido"; detalle: string };

export type ResultadoProcesarComunicaciones = {
  idTenant: string;
  dryRun: boolean;
  candidatos: number;
  procesados: ResultadoCitaComunicacion[];
};

export async function procesarComunicacionesDelTenant(
  supabase: SupabaseClient,
  params: { idTenant: string; ahora?: Date; dryRun?: boolean; adaptador?: AdaptadorCanal }
): Promise<ResultadoProcesarComunicaciones> {
  const ahora = params.ahora ?? new Date();
  const dryRun = params.dryRun ?? false;
  const adaptador = params.adaptador ?? crearAdaptadorSimulado();
  const config = await obtenerConfigComunicaciones(supabase, params.idTenant);

  async function procesarUna(cita: CitaComunicable, tipo: TipoComunicacion, plantilla: string): Promise<ResultadoCitaComunicacion> {
    try {
      const telefono = normalizarTelefono(cita.telefonoCliente);
      if (!telefono) throw new Error("Número de WhatsApp inválido o ausente");

      const { fecha, hora } = formatearFechaComunicacion(cita.inicio);
      const mensaje = renderizarMensajeComunicacion(plantilla, {
        nombre: cita.nombreCliente,
        servicio: cita.servicio,
        profesional: cita.profesionalNombre,
        fecha,
        hora,
      });

      if (dryRun) {
        const { data: existente } = await supabase
          .from("dulabs_comunicaciones_procesadas")
          .select("id")
          .eq("id_tenant", params.idTenant)
          .eq("cita_id", cita.citaId)
          .eq("tipo", tipo)
          .maybeSingle();
        return { citaId: cita.citaId, tipo, resultado: existente ? "ya_procesada" : "candidata" };
      }

      const claim = await reclamarComunicacion(supabase, {
        idTenant: params.idTenant,
        citaId: cita.citaId,
        tipo,
        telefonoCliente: telefono,
        mensajeRenderizado: mensaje,
      });
      if (claim.estado === "ya_procesada") return { citaId: cita.citaId, tipo, resultado: "ya_procesada" };

      // Nunca lanza -- un adaptador que falla no debe tumbar el resto del
      // lote (mismo criterio que enviarWhatsApp en el resto del proyecto).
      await adaptador({ idTenant: params.idTenant, citaId: cita.citaId, tipo, telefonoCliente: telefono, mensaje });
      return { citaId: cita.citaId, tipo, resultado: "procesada" };
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      return { citaId: cita.citaId, tipo, resultado: "fallido", detalle };
    }
  }

  const procesados: ResultadoCitaComunicacion[] = [];

  if (config.confirmacionActiva) {
    const candidatos = await buscarCandidatosConfirmacion(supabase, params.idTenant, ahora);
    for (const cita of candidatos) procesados.push(await procesarUna(cita, "confirmacion", config.confirmacionMensaje));
  }

  if (config.recordatorioActivo) {
    const candidatos = await buscarCandidatosRecordatorio(supabase, params.idTenant, config.recordatorioAnticipacionHoras, ahora);
    for (const cita of candidatos) procesados.push(await procesarUna(cita, "recordatorio", config.recordatorioMensaje));
  }

  return { idTenant: params.idTenant, dryRun, candidatos: procesados.length, procesados };
}
