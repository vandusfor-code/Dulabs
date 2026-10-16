/**
 * Cobros manuales — cableado de PRODUCCIÓN: las consultas reales a Supabase que usa el cron (procesar-cobros-manuales.ts) y el envío por Meta.
 *
 * Todo lo que escribe está condicionado en la propia consulta (la suspensión solo aplica si la suscripción SIGUE en ese ciclo; el envío no pisa un ciclo ya pagado), así que
 * aunque un operador registre un pago justo mientras corre el cron, nunca queda suspendido alguien que ya pagó.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { avisarNuevoClienteDulabs } from "@/lib/onboarding-trigger";
import { depsEnvioDeProduccion, enviarRecordatorioPago, type DepsEnvioRecordatorio } from "./enviar-recordatorio";
import { hoyBogota } from "./fechas";
import type { CicloExistente, DepsCobros, SuscripcionVencida } from "./procesar-cobros-manuales";
import { olvidarSuspensiones } from "./suspension";

/** PostgREST / Postgres cuando falta la tabla o la columna (la migración todavía no corrió). */
const CODIGOS_MIGRACION_PENDIENTE = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

export class MigracionCobrosPendiente extends Error {
  constructor(detalle: string) {
    super(`falta correr la migración 20261213000000_dulabs_cobros_manuales.sql (${detalle})`);
    this.name = "MigracionCobrosPendiente";
  }
}

function fallo(error: { code?: string; message: string }): Error {
  return CODIGOS_MIGRACION_PENDIENTE.has(error.code ?? "") ? new MigracionCobrosPendiente(error.message) : new Error(error.message);
}

export function depsCobrosDeProduccion(supabase: SupabaseClient, envio: DepsEnvioRecordatorio = depsEnvioDeProduccion(supabase)): DepsCobros {
  return {
    hoy: () => hoyBogota(),

    async listarVencidas(hoy) {
      const { data, error } = await supabase
        .from("dulabs_suscripciones")
        .select("id_tenant, plan, precio_cop, fecha_proximo_cobro, telefono_cobro, nombre_cobro, suspendida_por_pago_at")
        .eq("estado", "activa")
        .eq("cortesia", false)
        .is("wompi_payment_source_id", null)
        .lte("fecha_proximo_cobro", hoy)
        .order("fecha_proximo_cobro", { ascending: true });
      if (error) throw fallo(error);
      return (data ?? []).map(
        (f): SuscripcionVencida => ({
          idTenant: f.id_tenant as string,
          plan: f.plan as string,
          precioCop: Number(f.precio_cop ?? 0),
          fechaCobro: String(f.fecha_proximo_cobro).slice(0, 10),
          telefonoCobro: (f.telefono_cobro as string | null) || null,
          nombreCobro: (f.nombre_cobro as string | null) || null,
          suspendida: Boolean(f.suspendida_por_pago_at),
        }),
      );
    },

    async obtenerCiclo(idTenant, fechaCobro) {
      const { data, error } = await supabase.from("dulabs_cobros_ciclos").select("estado, intentos").eq("id_tenant", idTenant).eq("fecha_cobro", fechaCobro).maybeSingle();
      if (error) throw fallo(error);
      return data ? ({ estado: data.estado, intentos: Number(data.intentos ?? 0) } as CicloExistente) : null;
    },

    async reclamarCiclo(s) {
      const { data, error } = await supabase
        .from("dulabs_cobros_ciclos")
        .upsert(
          { id_tenant: s.idTenant, fecha_cobro: s.fechaCobro, monto_cop: s.precioCop, telefono: s.telefonoCobro, estado: "pendiente" },
          { onConflict: "id_tenant,fecha_cobro", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw fallo(error);
      return (data ?? []).length > 0;
    },

    async suspender(idTenant, fechaCobro) {
      const ahora = new Date().toISOString();
      const { data, error } = await supabase
        .from("dulabs_suscripciones")
        .update({ suspendida_por_pago_at: ahora, updated_at: ahora })
        .eq("id_tenant", idTenant)
        .eq("fecha_proximo_cobro", fechaCobro)
        .eq("estado", "activa")
        .eq("cortesia", false)
        .is("wompi_payment_source_id", null)
        .is("suspendida_por_pago_at", null)
        .select("id_tenant");
      if (error) throw fallo(error);
      if ((data ?? []).length === 0) return false;
      await supabase.from("dulabs_cobros_ciclos").update({ suspendido_at: ahora, updated_at: ahora }).eq("id_tenant", idTenant).eq("fecha_cobro", fechaCobro);
      olvidarSuspensiones(idTenant);
      return true;
    },

    async marcarOmitido(idTenant, fechaCobro) {
      await supabase
        .from("dulabs_cobros_ciclos")
        .update({ estado: "omitido", updated_at: new Date().toISOString() })
        .eq("id_tenant", idTenant)
        .eq("fecha_cobro", fechaCobro)
        .eq("estado", "pendiente");
    },

    async nombreNegocio(s) {
      if (s.nombreCobro?.trim()) return s.nombreCobro.trim();
      const { data } = await supabase.from("dulabs_clientes_config").select("nombre_negocio").eq("id_tenant", s.idTenant).order("created_at", { ascending: true }).limit(1);
      const deNumero = (data?.[0]?.nombre_negocio as string | undefined)?.trim();
      if (deNumero) return deNumero;
      try {
        const { data: usuario } = await supabase.auth.admin.getUserById(s.idTenant);
        const deUsuario = usuario?.user?.user_metadata?.nombre;
        if (typeof deUsuario === "string" && deUsuario.trim()) return deUsuario.trim();
      } catch {
        // sin usuario de Auth (clientes a medida como AMORE): se saluda con el texto genérico
      }
      return "tu negocio";
    },

    enviar: (input) => enviarRecordatorioPago(input, envio),

    async registrarEnvio({ idTenant, fechaCobro, resultado, intentos }) {
      const ahora = new Date().toISOString();
      const cambios = resultado.enviado
        ? { estado: "enviado", intentos, recordatorio_wamid: resultado.wamid, recordatorio_enviado_at: ahora, ultimo_error: null, updated_at: ahora }
        : { estado: "fallido", intentos, ultimo_error: `${resultado.motivo}${resultado.detalle ? `: ${resultado.detalle}` : ""}`.slice(0, 500), updated_at: ahora };
      // Solo si el ciclo sigue pendiente/fallido: si mientras tanto se registró el pago, no se le vuelve a poner «enviado».
      const { error } = await supabase.from("dulabs_cobros_ciclos").update(cambios).eq("id_tenant", idTenant).eq("fecha_cobro", fechaCobro).in("estado", ["pendiente", "fallido"]);
      if (error) throw fallo(error);
    },

    avisarDueno: (texto) => avisarNuevoClienteDulabs(texto),
  };
}
