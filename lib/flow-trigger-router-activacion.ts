/**
 * Fase 3B (Trigger Router SaaS, autorizado) — mecanismo NUEVO de activación
 * por número, en PARALELO al allowlist hardcodeado existente
 * (`TRIGGER_ROUTING_TEST_SENDERS`, lib/flow-routing.ts), que sigue
 * exactamente como está, sin ninguna línea tocada.
 *
 * ESTADO DE INTEGRACIÓN (léase antes de conectar nada): este archivo NO
 * está importado por `lib/flow-runtime-bridge.ts` ni por ningún camino real
 * de producción todavía -- existe en paralelo, sin estar activo, tal como
 * pidió el usuario. Conectarlo (reemplazando o complementando
 * `remitenteAutorizadoParaTriggerRouting`) es explícitamente Fase 3C, no
 * esta fase.
 *
 * PASO 0 — verificación de la Opción B (evidencia real de schema, no
 * asumida): `dulabs_clientes_config.phone_number_id` tiene un UNIQUE INDEX
 * sobre TODA la tabla desde su creación
 * (supabase/migrations/20260713120000_create_dulabs_clientes_config.sql:19-20,
 * `dulabs_clientes_config_phone_number_id_idx`), nunca alterado ni
 * debilitado por ninguna migración posterior (verificado por búsqueda en
 * todo `supabase/migrations/`). `id_tenant` es `NOT NULL`
 * (supabase/migrations/20260713150000_embedded_signup_columns.sql:25).
 *
 * Consecuencia: dos tenants NUNCA pueden compartir el mismo
 * `phone_number_id` (el índice único lo rechazaría al insertar), así que
 * una fila de esta tabla, localizada SOLO por `phone_number_id`, ya
 * representa de forma inequívoca la tupla
 * `(tenant_id, phone_number_id) -> flow_id` -- sin necesitar `tenant_id`
 * como filtro adicional en la consulta. Por eso esta función consulta
 * EXCLUSIVAMENTE por `phone_number_id` (clave única), nunca por
 * `tenant_id` solo -- resolver por tenant_id solo sería exactamente el
 * error que este diseño evita (mezclaría los números de un tenant con
 * varios números entre sí).
 *
 * LIMITACIÓN CONOCIDA Y DOCUMENTADA (no bloqueante para esta fase, ver
 * reporte de Fase 3B): como `flow_id` es una sola columna (no una lista),
 * esta tabla resuelve UN solo Flow candidato por número -- no permite que
 * varios Flows compitan por trigger dentro del MISMO número. Eso queda
 * para una fase futura si el usuario lo pide (columna de canal en
 * `dulabs_flow_triggers`, o una tabla de activaciones N:1).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type TriggerRoutingActivationResolution =
  | { kind: "activo"; tenantId: string; flowId: string }
  | { kind: "inactivo" }
  | { kind: "sin_configuracion" };

/**
 * Kill switch global — mismo patrón exacto que `AMORE_IA_MOTOR`
 * (lib/whatsapp-qr-bot.ts:38-42): variable de entorno leída en RUNTIME, sin
 * build step, para poder revertir instantáneamente sin deploy de lógica.
 *
 * AUSENTE o `""` (por defecto, hoy) -> el routing nuevo queda DISPONIBLE
 * según la configuración de cada tenant (columna `trigger_routing_activo`).
 * CUALQUIER valor no vacío presente (`"on"`, `"1"`, `"true"`, cualquier
 * string) -> fuerza SIEMPRE el comportamiento anterior (routing nuevo
 * inactivo para TODOS los tenants, sin excepción, sin siquiera consultar
 * Supabase) -- interpretación deliberadamente conservadora: la sola
 * PRESENCIA de la variable ya es la señal de "algo salió mal, apaga todo",
 * no se exige un valor exacto para no arriesgar un typo que deje el
 * kill switch sin efecto justo cuando más se necesita.
 */
export function triggerRouterKillSwitchActivo(): boolean {
  const valor = process.env.TRIGGER_ROUTER_KILL_SWITCH;
  return typeof valor === "string" && valor.trim().length > 0;
}

interface FilaActivacionTriggerRouter {
  id_tenant: string;
  flow_activo: boolean;
  flow_id: string | null;
  trigger_routing_activo: boolean;
}

/**
 * Resuelve, para UN `phoneNumberId` (clave única real en
 * `dulabs_clientes_config`), si el Trigger Router SaaS está activo y para
 * cuál `flowId` -- sin recibir ni necesitar `tenantId` como parámetro,
 * porque la fila localizada por `phoneNumberId` ya lo determina sin
 * ambigüedad (ver docstring del archivo).
 *
 * Fail-closed en cada paso, en este orden:
 *  1. Kill switch activo -> `inactivo` siempre, sin consultar Supabase.
 *  2. Sin fila para ese `phoneNumberId` -> `sin_configuracion` (nunca se
 *     inventa un tenant/flow).
 *  3. `trigger_routing_activo=false` (default de toda fila existente) ->
 *     `inactivo`.
 *  4. `flow_activo=false` o `flow_id` nulo -> `inactivo` (protegido también
 *     por el CHECK de la migración, pero se revalida acá en profundidad:
 *     nunca activar el Router sin un Flow base real).
 *  5. Todo lo anterior en orden -> `activo`, con el `tenantId`/`flowId`
 *     EXACTOS de esa fila (nunca de una fuente distinta).
 */
export async function resolverActivacionTriggerRouter(
  supabase: SupabaseClient,
  phoneNumberId: string,
): Promise<TriggerRoutingActivationResolution> {
  if (triggerRouterKillSwitchActivo()) {
    return { kind: "inactivo" };
  }

  const { data, error } = await supabase
    .from("dulabs_clientes_config")
    .select("id_tenant, flow_activo, flow_id, trigger_routing_activo")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error) throw error;

  const fila = data as FilaActivacionTriggerRouter | null;
  if (!fila) return { kind: "sin_configuracion" };
  if (!fila.trigger_routing_activo) return { kind: "inactivo" };
  if (!fila.flow_activo || !fila.flow_id) return { kind: "inactivo" };

  return { kind: "activo", tenantId: fila.id_tenant, flowId: fila.flow_id };
}
