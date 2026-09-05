import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarCumpleanosDelDia } from "./candidatos";
import { obtenerConfigCumpleanos } from "./config";
import { fechaTenantHoy } from "./fecha";
import { renderizarMensajeCumpleanos } from "./mensaje";
import { reclamarProcesamiento, registrarResultadoProcesamiento } from "./idempotencia";
import { enviarWhatsApp } from "@/lib/whatsapp-outbound";
import { normalizarTelefono } from "@/lib/marketplace-store";
import type { ClienteConfig } from "@/lib/supabase";

// Cumpleaños automáticos (Fase 6A, genérico, autorizado) — 5) ejecución:
// orquesta las 4 piezas anteriores para UN tenant. Nada acá menciona AMORE
// -- todo llega parametrizado por idTenant, exactamente el mismo motor
// correría para cualquier otro negocio que active su propia fila en
// dulabs_cumpleanos_config.
//
// `enviador` es el único punto de inyección para pruebas: si se pasa, NUNCA
// se llama a enviarWhatsApp real (ni se consulta dulabs_clientes_config) --
// así ninguna prueba automatizada puede, ni por accidente, mandar un
// WhatsApp de verdad. En producción (sin `enviador`) se usa la
// infraestructura ya existente (lib/whatsapp-outbound.ts), sin duplicarla.

export type EnviadorWhatsApp = (params: { clienteId: number; telefono: string; mensaje: string }) => Promise<void>;

export type ResultadoClienteCumpleanos =
  | { clienteId: number; nombre: string; resultado: "enviado" | "simulado" }
  | { clienteId: number; nombre: string; resultado: "ya_procesado" }
  | { clienteId: number; nombre: string; resultado: "fallido"; detalle: string };

export type ResultadoProcesarCumpleanos = { idTenant: string; candidatos: number; procesados: ResultadoClienteCumpleanos[] };

export async function procesarCumpleanosDelTenant(
  supabase: SupabaseClient,
  params: { idTenant: string; ahora?: Date; enviador?: EnviadorWhatsApp; soloTelefono?: string }
): Promise<ResultadoProcesarCumpleanos> {
  const config = await obtenerConfigCumpleanos(supabase, params.idTenant);
  if (!config.activo) return { idTenant: params.idTenant, candidatos: 0, procesados: [] };

  const { dia, mes, anio } = fechaTenantHoy(config.zonaHoraria, params.ahora);
  const candidatos = await buscarCumpleanosDelDia(supabase, params.idTenant, { dia, mes }, { soloTelefono: params.soloTelefono });

  let clienteConfig: ClienteConfig | null = null;
  if (!params.enviador && candidatos.length > 0) {
    const { data } = await supabase.from("dulabs_clientes_config").select("*").eq("id_tenant", params.idTenant).limit(1).maybeSingle();
    clienteConfig = data as ClienteConfig | null;
  }

  const procesados: ResultadoClienteCumpleanos[] = [];

  for (const cliente of candidatos) {
    const claim = await reclamarProcesamiento(supabase, {
      idTenant: params.idTenant,
      clienteId: cliente.id,
      anio,
      telefonoCliente: cliente.telefonoCliente,
    });
    if (claim.estado === "ya_procesado") {
      procesados.push({ clienteId: cliente.id, nombre: cliente.nombre, resultado: "ya_procesado" });
      continue;
    }

    try {
      const telefono = normalizarTelefono(cliente.telefonoCliente);
      if (!telefono) throw new Error("Número de WhatsApp inválido o ausente");

      const mensaje = renderizarMensajeCumpleanos(config.mensaje, { nombre: cliente.nombre, negocio: config.nombreNegocio });

      let estado: "enviado" | "simulado";
      if (params.enviador) {
        await params.enviador({ clienteId: cliente.id, telefono, mensaje });
        estado = "simulado";
      } else if (clienteConfig) {
        // Límite conocido (Fase 6B): enviarWhatsApp no devuelve si de verdad
        // llegó a Meta o si solo no-opeó por falta de token (retorna void en
        // ambos casos, ver lib/whatsapp-outbound.ts) -- "enviado" acá
        // significa "se intentó sin lanzar", no "confirmado entregado". Una
        // confirmación real requeriría los webhooks de estado de Meta, fuera
        // del alcance de esta fase. No se modifica enviarWhatsApp porque es
        // infraestructura compartida con el asistente de WhatsApp y otros
        // cron existentes.
        await enviarWhatsApp(supabase, clienteConfig, telefono, mensaje);
        estado = "enviado";
      } else {
        throw new Error("Sin configuración de WhatsApp para este tenant");
      }

      await registrarResultadoProcesamiento(supabase, { idTenant: params.idTenant, clienteId: cliente.id, anio, estado, mensajeEnviado: mensaje });
      procesados.push({ clienteId: cliente.id, nombre: cliente.nombre, resultado: estado });
    } catch (err) {
      // Un cliente con datos inválidos (teléfono roto, etc.) nunca debe
      // tumbar el resto del lote -- se registra como fallido y se sigue.
      const detalle = err instanceof Error ? err.message : String(err);
      await registrarResultadoProcesamiento(supabase, { idTenant: params.idTenant, clienteId: cliente.id, anio, estado: "fallido", detalle });
      procesados.push({ clienteId: cliente.id, nombre: cliente.nombre, resultado: "fallido", detalle });
    }
  }

  return { idTenant: params.idTenant, candidatos: candidatos.length, procesados };
}
