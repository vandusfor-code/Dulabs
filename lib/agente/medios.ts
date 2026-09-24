/**
 * REGISTRO DE FOTOS ENVIADAS por el agente (dulabs_agente_medios_enviados).
 *
 * Cada foto de producto que sale por WhatsApp queda ligada a su wamid:
 *
 *   wamid de la foto -> negocio + número + cliente -> referencia + producto interno + canal
 *
 * Así, cuando el cliente RESPONDE a una foto ("quiero este"), Meta entrega
 * `context.id` = wamid de esa foto y el backend sabe, sin adivinar, de qué
 * producto habla. La búsqueda exige la MISMA conversación (negocio, número y
 * cliente): una foto de otro negocio, de otro cliente o un wamid desconocido
 * simplemente no se encuentra, y el agente pide aclaración.
 *
 * El id interno del producto nunca sale hacia el modelo ni hacia el cliente:
 * sirve para auditar y para detectar si la referencia se reasignó.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderChannel } from "@/lib/catalogo/pedidos/contrato";

export interface SentProductImage {
  tenantId: string;
  phoneNumberId: string;
  waId: string;
  /** wamid que Meta asignó al mensaje de la foto. */
  wamid: string;
  reference: string;
  /** Id interno del producto (auditoría); nunca se expone. */
  productId: string | null;
  channel: OrderChannel;
  /** Turno del agente que la envió. */
  turn: number;
}

export interface ConversationScope {
  tenantId: string;
  phoneNumberId: string;
  waId: string;
}

export interface ProductMediaLedger {
  /** Registra una foto enviada. false si no se pudo (la foto ya salió: solo se pierde la posibilidad de citarla). */
  record(entry: SentProductImage): Promise<boolean>;
  /** La foto citada, SOLO si pertenece a esta conversación; null en cualquier otro caso. */
  findByWamid(scope: ConversationScope, wamid: string): Promise<SentProductImage | null>;
}

const T = "dulabs_agente_medios_enviados";
const MISSING_SCHEMA = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);
const WAMID = /^[A-Za-z0-9._:=+/-]{1,200}$/;

export function createSupabaseProductMediaLedger(supabase: SupabaseClient): ProductMediaLedger {
  return {
    async record(e) {
      if (!WAMID.test(e.wamid)) return false;
      const { error } = await supabase.from(T).insert({
        id_tenant: e.tenantId,
        phone_number_id: e.phoneNumberId,
        wa_id: e.waId,
        wamid: e.wamid,
        referencia: e.reference,
        id_producto: e.productId,
        canal: e.channel,
        turno: e.turn,
      });
      if (!error) return true;
      // Sin la migración (o un wamid repetido): la foto ya salió; no se puede citar, y el agente pedirá aclaración.
      if (!MISSING_SCHEMA.has(error.code ?? "") && error.code !== "23505") console.error(`[agente/medios] record ${error.code ?? "?"}`);
      return false;
    },
    async findByWamid(scope, wamid) {
      if (!WAMID.test(wamid)) return null;
      const { data, error } = await supabase
        .from(T)
        .select("wamid, referencia, id_producto, canal, turno")
        .eq("id_tenant", scope.tenantId)
        .eq("phone_number_id", scope.phoneNumberId)
        .eq("wa_id", scope.waId)
        .eq("wamid", wamid)
        .maybeSingle();
      if (error) {
        if (!MISSING_SCHEMA.has(error.code ?? "")) console.error(`[agente/medios] find ${error.code ?? "?"}`);
        return null;
      }
      if (!data) return null;
      const row = data as { wamid: string; referencia: string; id_producto: string | null; canal: OrderChannel; turno: number };
      return { ...scope, wamid: row.wamid, reference: row.referencia, productId: row.id_producto, channel: row.canal, turn: row.turno };
    },
  };
}

export function createMemoryProductMediaLedger() {
  const rows: SentProductImage[] = [];
  const ledger: ProductMediaLedger & { rows: SentProductImage[] } = {
    rows,
    async record(e) {
      if (!WAMID.test(e.wamid) || rows.some((r) => r.wamid === e.wamid)) return false;
      rows.push({ ...e });
      return true;
    },
    async findByWamid(scope, wamid) {
      const r = rows.find((x) => x.wamid === wamid && x.tenantId === scope.tenantId && x.phoneNumberId === scope.phoneNumberId && x.waId === scope.waId);
      return r ? { ...r } : null;
    },
  };
  return ledger;
}
