import type { SupabaseClient } from "@supabase/supabase-js";
import { initAuthCreds, BufferJSON, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from "@whiskeysockets/baileys";

// WhatsApp QR (Fase 9A/9B, autorizado) — auth-state de Baileys respaldado en
// Supabase, mismo rol que useMultiFileAuthState (que la propia librería
// documenta como solo apto para pruebas/un bot, recomendando explícitamente
// "escribir un auth state para una DB real" -- esto es exactamente eso).
// Una fila por tenant en dulabs_whatsapp_qr_sesiones (creds/claves) -- nunca
// un archivo en disco, necesario porque el worker puede reiniciarse
// (redeploy, crash) y no debe depender de filesystem local para conservar
// la sesión.

type FilaCredenciales = { creds: unknown | null; claves: Record<string, Record<string, unknown>> | null };

export async function crearAuthStateSupabase(
  supabase: SupabaseClient,
  idTenant: string
): Promise<{ state: AuthenticationState; guardarCredenciales: () => Promise<void> }> {
  const { data } = await supabase
    .from("dulabs_whatsapp_qr_sesiones")
    .select("creds, claves")
    .eq("id_tenant", idTenant)
    .maybeSingle<FilaCredenciales>();

  const creds: AuthenticationCreds = data?.creds
    ? (JSON.parse(JSON.stringify(data.creds), BufferJSON.reviver) as AuthenticationCreds)
    : initAuthCreds();

  const claves: Record<string, Record<string, unknown>> = data?.claves
    ? (JSON.parse(JSON.stringify(data.claves), BufferJSON.reviver) as Record<string, Record<string, unknown>>)
    : {};

  async function persistirClaves(): Promise<void> {
    await supabase.from("dulabs_whatsapp_qr_sesiones").upsert(
      {
        id_tenant: idTenant,
        claves: JSON.parse(JSON.stringify(claves, BufferJSON.replacer)),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id_tenant" }
    );
  }

  const keys: AuthenticationState["keys"] = {
    async get(type, ids) {
      const bucket = claves[type] ?? {};
      const resultado: { [id: string]: SignalDataTypeMap[typeof type] } = {};
      for (const id of ids) {
        if (bucket[id] !== undefined && bucket[id] !== null) {
          resultado[id] = bucket[id] as SignalDataTypeMap[typeof type];
        }
      }
      return resultado;
    },
    async set(dataParcial) {
      for (const tipo of Object.keys(dataParcial) as (keyof SignalDataTypeMap)[]) {
        const porTipo = dataParcial[tipo];
        if (!porTipo) continue;
        claves[tipo] = claves[tipo] ?? {};
        for (const id of Object.keys(porTipo)) {
          const valor = (porTipo as Record<string, unknown>)[id];
          if (valor === null || valor === undefined) {
            delete claves[tipo][id];
          } else {
            claves[tipo][id] = valor;
          }
        }
      }
      await persistirClaves();
    },
  };

  async function guardarCredenciales(): Promise<void> {
    await supabase.from("dulabs_whatsapp_qr_sesiones").upsert(
      {
        id_tenant: idTenant,
        creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id_tenant" }
    );
  }

  return { state: { creds, keys }, guardarCredenciales };
}
