/**
 * Fase 8.5 (Connection Lifecycle, autorizado) — ciclo de vida de una
 * conexión WhatsApp (Meta Cloud API / Embedded Signup), separado
 * deliberadamente de los datos de negocio.
 *
 * Antes de esta fase, la ÚNICA forma de "desconectar" un número era
 * DELETE /api/dashboard/negocio -- política de eliminación de datos de Meta,
 * IRREVERSIBLE a propósito (borra mensajes, campañas y la fila de config
 * completa). Este módulo agrega un disconnect REVERSIBLE: invalida
 * solamente la credencial de Meta y marca `estado_conexion`, sin tocar
 * flow_activo/flow_id/trigger_routing_activo/ia_pausada/ia_restringida_a/
 * contactos/tags/custom fields/agentes/integraciones/campañas/historial --
 * todo eso vive en otras columnas de la misma fila o en tablas separadas
 * por tenant_id, y esta función jamás las toca.
 *
 * Reconexión: NO se implementa acá -- ya existe y funciona en
 * app/api/auth/meta-callback/route.ts (Embedded Signup), que ya sabía
 * reconocer "mismo número físico, phone_number_id nuevo" (el caso real de
 * Soluciones Financieras/Charlotte) antes de esta fase. Este módulo solo le
 * agrega, en ese mismo archivo, volver a marcar estado_conexion='conectado'.
 *
 * TOLERANCIA A LA MIGRACIÓN PENDIENTE (ver supabase/migrations/
 * 20260928000000_dulabs_estado_conexion.sql): esta fase no pudo aplicar la
 * migración desde esta sesión (sin acceso a DDL de Supabase -- ver reporte
 * final de Fase 8.5). Todo escritor de `estado_conexion` en este archivo y
 * en meta-callback usa `escribirToleranteAColumnaFaltante` para NUNCA romper
 * un flujo real (conectar/reconectar) si la migración todavía no se aplicó
 * -- reintenta la misma escritura sin esa columna, sin exponer el detalle al
 * usuario final. Se autoactiva solo, sin otro deploy, en cuanto se aplique
 * la migración.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { descifrarSecreto } from "@/lib/crypto";
import { desuscribirWaba } from "@/lib/meta-numero";

export type EstadoConexionWhatsapp = "conectado" | "desconectado" | "reconectando" | "error";

/** Código Postgres real de "columna inexistente" (undefined_column). */
const CODIGO_COLUMNA_INEXISTENTE = "42703";

function esErrorColumnaEstadoConexionFaltante(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && error.code === CODIGO_COLUMNA_INEXISTENTE && error.message?.includes("estado_conexion"));
}

/**
 * Ejecuta un update/upsert que incluye `estado_conexion` en `datosConCampo`.
 * Si Supabase rechaza la escritura porque la migración 20260928000000
 * todavía no se aplicó (columna inexistente), reintenta la MISMA operación
 * usando `datosSinCampo` -- así connect/reconnect/disconnect siguen
 * funcionando exactamente igual que antes de esta fase hasta que se aplique
 * la migración, sin exponer el detalle ni bloquear al usuario real.
 */
export async function escribirToleranteAColumnaFaltante<T extends { error: { code?: string; message?: string } | null }>(
  ejecutar: (datos: Record<string, unknown>) => PromiseLike<T>,
  datosConCampo: Record<string, unknown>,
  datosSinCampo: Record<string, unknown>,
): Promise<{ resultado: T; migracionPendiente: boolean }> {
  const primerIntento = await ejecutar(datosConCampo);
  if (!esErrorColumnaEstadoConexionFaltante(primerIntento.error)) {
    return { resultado: primerIntento, migracionPendiente: false };
  }
  const reintento = await ejecutar(datosSinCampo);
  return { resultado: reintento, migracionPendiente: true };
}

export type ResultadoDesconexion =
  | { ok: true; migracionPendiente: boolean }
  | { ok: false; motivo: "no_encontrado" }
  | { ok: false; motivo: "error_db"; mensaje: string };

interface FilaConexion {
  id_tenant: string;
  phone_number_id: string;
  whatsapp_business_account_id: string;
  meta_permanent_token: string | null;
}

/**
 * Desconecta UN número (phone_number_id) de UN tenant, de forma reversible:
 *
 * 1. Verifica ownership (phone_number_id + id_tenant) -- fail-closed, nunca
 *    encuentra ni toca la fila de otro tenant.
 * 2. Best-effort: desuscribe la app del WABA en Meta (mismo criterio que
 *    desuscribirWaba -- nunca lanza, un fallo acá no bloquea el disconnect
 *    local; Meta ya no tiene por qué enviarnos webhooks de este número).
 * 3. Limpia SOLO la credencial (meta_permanent_token=null) y marca
 *    estado_conexion='desconectado' + desconectado_en=now() -- ninguna otra
 *    columna de la fila se toca (flow_activo, flow_id,
 *    trigger_routing_activo, nombre_negocio, ia_pausada, ia_restringida_a,
 *    agente_id, etc. quedan exactamente iguales).
 *
 * Idempotente: desconectar un número ya desconectado repite el best-effort
 * de Meta (inofensivo, Meta ya no tiene nada que desuscribir) y vuelve a
 * escribir el mismo estado -- nunca falla ni duplica nada.
 */
export async function desconectarNumeroWhatsapp(
  supabase: SupabaseClient,
  params: { tenantId: string; phoneNumberId: string },
): Promise<ResultadoDesconexion> {
  const { data, error: errorLectura } = await supabase
    .from("dulabs_clientes_config")
    .select("id_tenant, phone_number_id, whatsapp_business_account_id, meta_permanent_token")
    .eq("phone_number_id", params.phoneNumberId)
    .eq("id_tenant", params.tenantId)
    .maybeSingle();
  if (errorLectura) return { ok: false, motivo: "error_db", mensaje: errorLectura.message };

  const fila = data as FilaConexion | null;
  if (!fila) return { ok: false, motivo: "no_encontrado" };

  const token = fila.meta_permanent_token ? descifrarSecreto(fila.meta_permanent_token) : null;
  if (token) {
    await desuscribirWaba({ wabaId: fila.whatsapp_business_account_id, token });
  }

  const now = new Date().toISOString();
  const { resultado, migracionPendiente } = await escribirToleranteAColumnaFaltante(
    (datos) =>
      supabase
        .from("dulabs_clientes_config")
        .update(datos)
        .eq("phone_number_id", params.phoneNumberId)
        .eq("id_tenant", params.tenantId),
    { meta_permanent_token: null, estado_conexion: "desconectado", desconectado_en: now, updated_at: now },
    { meta_permanent_token: null, updated_at: now },
  );
  if (resultado.error) return { ok: false, motivo: "error_db", mensaje: resultado.error.message ?? "error desconocido" };

  return { ok: true, migracionPendiente };
}
