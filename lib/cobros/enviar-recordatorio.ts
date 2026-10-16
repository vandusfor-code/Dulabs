/**
 * Envío del recordatorio de pago: la plantilla `pendiente_pago` desde el número OFICIAL de Dulabs (573148127388 / DULABS_PHONE_NUMBER_ID) al teléfono de cobro del cliente.
 *
 * Reutiliza la infraestructura que ya existe: el token cifrado de dulabs_clientes_config para ese número (resolverTokenMeta) y enviarPlantilla. Antes de CADA envío lee la
 * plantilla real en Meta: debe estar APPROVED y calzar con «nombre + monto»; si no, no se manda nada y se devuelve el motivo. Nunca lanza una excepción.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DULABS_WABA_ID } from "@/lib/developer/dulabs-whatsapp";
import { enviarPlantilla, importarPlantillaMeta, type PlantillaImportada } from "@/lib/meta-templates";
import { DULABS_PHONE_NUMBER_ID, WHATSAPP_VENTAS_NUMERO } from "@/lib/site-contact";
import type { ClienteConfig } from "@/lib/supabase";
import { resolverTokenMeta } from "@/lib/whatsapp-outbound";
import { PLANTILLA_PENDIENTE_PAGO, resolverParametrosPlantilla } from "./plantilla";

export type ResultadoRecordatorio = { enviado: true; wamid: string | null; resumen: string } | { enviado: false; motivo: MotivoFalloRecordatorio; detalle?: string };

export type MotivoFalloRecordatorio =
  | "destino_invalido"
  | "destino_es_el_remitente"
  | "sin_credenciales"
  | "plantilla_no_consultable"
  | "plantilla_no_encontrada"
  | "plantilla_no_aprobada"
  | "variables_no_coinciden"
  | "error_envio";

export interface DepsEnvioRecordatorio {
  resolverToken(): Promise<{ token: string } | { error: string }>;
  importarPlantilla(token: string): Promise<PlantillaImportada | null>;
  enviar(params: Parameters<typeof enviarPlantilla>[0]): Promise<{ wamid: string | null }>;
}

export function depsEnvioDeProduccion(supabase: SupabaseClient): DepsEnvioRecordatorio {
  return {
    async resolverToken() {
      const { data, error } = await supabase
        .from("dulabs_clientes_config")
        .select("phone_number_id, meta_permanent_token, estado_conexion")
        .eq("phone_number_id", DULABS_PHONE_NUMBER_ID)
        .maybeSingle();
      if (error) return { error: `config número DuLabs: ${error.message}` };
      if (!data) return { error: "numero_dulabs_no_encontrado" };
      try {
        const token = resolverTokenMeta(data as unknown as ClienteConfig);
        return token ? { token } : { error: "sin_token_meta" };
      } catch (err) {
        return { error: `token_no_resoluble: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    importarPlantilla: (token) =>
      importarPlantillaMeta({ wabaId: DULABS_WABA_ID, token, nombre: PLANTILLA_PENDIENTE_PAGO.nombre, idioma: PLANTILLA_PENDIENTE_PAGO.idioma }),
    enviar: (params) => enviarPlantilla(params),
  };
}

export async function enviarRecordatorioPago(
  input: { telefonoE164: string; nombreNegocio: string; montoCop: number },
  deps: DepsEnvioRecordatorio,
): Promise<ResultadoRecordatorio> {
  const destino = input.telefonoE164.replace(/\D/g, ""); // Meta espera solo dígitos, sin «+»
  if (!/^\d{10,15}$/.test(destino)) return { enviado: false, motivo: "destino_invalido" };
  // Meta rechaza (#100) un mensaje de un número a sí mismo: el remitente ES el número de ventas de Dulabs.
  if (destino === WHATSAPP_VENTAS_NUMERO) return { enviado: false, motivo: "destino_es_el_remitente" };

  const credencial = await deps.resolverToken();
  if ("error" in credencial) return { enviado: false, motivo: "sin_credenciales", detalle: credencial.error };

  let plantilla: PlantillaImportada | null;
  try {
    plantilla = await deps.importarPlantilla(credencial.token);
  } catch (err) {
    return { enviado: false, motivo: "plantilla_no_consultable", detalle: err instanceof Error ? err.message : String(err) };
  }
  if (!plantilla) return { enviado: false, motivo: "plantilla_no_encontrada", detalle: PLANTILLA_PENDIENTE_PAGO.nombre };
  if (plantilla.estado !== "APPROVED") return { enviado: false, motivo: "plantilla_no_aprobada", detalle: `status=${plantilla.estado}` };

  const parametros = resolverParametrosPlantilla(plantilla.cuerpo, { nombre: input.nombreNegocio, montoCop: input.montoCop });
  if (!parametros.ok) return { enviado: false, motivo: parametros.motivo, detalle: parametros.detalle };

  try {
    const { wamid } = await deps.enviar({
      phoneNumberId: DULABS_PHONE_NUMBER_ID,
      token: credencial.token,
      para: destino,
      nombrePlantilla: PLANTILLA_PENDIENTE_PAGO.nombre,
      // El idioma REAL aprobado de la plantilla (un código que no calza da (#132001)).
      idioma: plantilla.idioma || PLANTILLA_PENDIENTE_PAGO.idioma,
      ...(parametros.tipo === "nombrados" ? { variables: parametros.variables } : { parametrosPosicionales: parametros.valores }),
    });
    return { enviado: true, wamid, resumen: parametros.resumen };
  } catch (err) {
    return { enviado: false, motivo: "error_envio", detalle: err instanceof Error ? err.message : String(err) };
  }
}
