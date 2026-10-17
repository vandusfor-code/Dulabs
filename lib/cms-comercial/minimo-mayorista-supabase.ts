/**
 * CMS comercial — el MÍNIMO mayorista sobre Supabase: lee las líneas del negocio, calcula el cambio (minimo-mayorista-servidor.ts: reemplazo de textos y validación con el esquema real del asistente) y lo
 * entrega a la función SQL que lo aplica con control de concurrencia (migración 20261214000000). Traduce los errores a mensajes para la administradora.
 *
 * Sin la migración las funciones no existen: se responde FEATURE_UNAVAILABLE y el panel muestra el mínimo pero avisa que cambiarlo todavía no está activo; nada más se afecta.
 * Los mensajes son texto fijo y seguro: nunca SQL, ni datos de otro negocio, ni el contenido de la configuración del asistente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CmsError } from "@/lib/cms-comercial/errores";
import { MINIMO_MAYORISTA_MAX, MINIMO_MAYORISTA_MIN, minimoDeNegocio, rutasConMonto, type MinimoMayoristaVista, type PuertoMinimoMayorista } from "@/lib/cms-comercial/minimo-mayorista";
import { minimoVigente, prepararCambioDeMinimo, type FilaDeNegocio } from "@/lib/cms-comercial/minimo-mayorista-servidor";

const ESQUEMA_AUSENTE = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);
const MENSAJE_GENERAL = "No se pudo completar la operación de la tienda.";

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;

interface ErrorDeSupabase {
  code?: string;
  message?: string;
}

/** De un error de la base a uno que la administradora entiende. Lo desconocido no se filtra: queda en el registro del servidor y ella ve un mensaje general. */
export function traducirErrorMinimo(error: ErrorDeSupabase): CmsError {
  if (ESQUEMA_AUSENTE.has(error.code ?? "")) return new CmsError("FEATURE_UNAVAILABLE", "Cambiar el mínimo desde el panel todavía no está activo para este negocio. Avísale al equipo de DuLabs.");
  const motivo = error.message ?? "";
  if (motivo.includes("minimo_fuera_de_rango")) return new CmsError("VALIDATION_ERROR", `El mínimo debe estar entre ${pesos(MINIMO_MAYORISTA_MIN)} y ${pesos(MINIMO_MAYORISTA_MAX)}.`);
  if (motivo.includes("minimo_cambio_mientras_tanto")) return new CmsError("CONFLICT", "El monto cambió mientras lo editabas. Revisa el valor actual y vuelve a intentarlo.");
  if (motivo.includes("config_cambio_mientras_tanto")) return new CmsError("CONFLICT", "La configuración de tu asistente cambió mientras lo editabas. Revisa el valor actual y vuelve a intentarlo.");
  if (motivo.includes("minimo_sin_configurar")) return new CmsError("CONFLICT", "Tu negocio todavía no tiene un mínimo configurado en el asistente. Avísale al equipo de DuLabs para dejarlo listo.");
  console.error("[cms-comercial/minimo-mayorista] error de la base de datos:", error.code ?? "", motivo);
  return new CmsError("INTERNAL_ERROR", MENSAJE_GENERAL);
}

function leerFilas(data: unknown): FilaDeNegocio[] {
  if (!esObjeto(data) || !Array.isArray(data.filas)) throw new CmsError("INTERNAL_ERROR", MENSAJE_GENERAL);
  return data.filas.map((f): FilaDeNegocio => {
    if (!esObjeto(f) || typeof f.phone_number_id !== "string") throw new CmsError("INTERNAL_ERROR", MENSAJE_GENERAL);
    return { phone_number_id: f.phone_number_id, negocio: f.negocio };
  });
}

/** Cómo está el mínimo hoy, a partir de las líneas: el monto, si todas coinciden y en qué textos del asistente está escrito a mano. */
export function vistaDeFilas(filas: readonly FilaDeNegocio[]): MinimoMayoristaVista {
  const { minimo, uniforme } = minimoVigente(filas);
  if (minimo === null) return { configurado: false, minimo: null, uniforme: true, filas: 0, lugares: [] };
  const lugares = [...new Set(filas.flatMap((f) => rutasConMonto(f.negocio, minimoDeNegocio(f.negocio) ?? minimo)))].sort();
  return { configurado: true, minimo, uniforme, filas: filas.length, lugares };
}

export function crearPuertoMinimoMayoristaSupabase(supabase: SupabaseClient): PuertoMinimoMayorista {
  async function filasDe(tenantId: string): Promise<FilaDeNegocio[]> {
    const { data, error } = await supabase.rpc("dulabs_agente_minimo_mayorista_ver", { p_tenant: tenantId });
    if (error) throw traducirErrorMinimo(error);
    return leerFilas(data);
  }

  return {
    async ver(tenantId) {
      return vistaDeFilas(await filasDe(tenantId));
    },

    async fijar(tenantId, actorUserId, nuevo, esperado) {
      if (!Number.isSafeInteger(nuevo) || nuevo < MINIMO_MAYORISTA_MIN || nuevo > MINIMO_MAYORISTA_MAX) {
        throw new CmsError("VALIDATION_ERROR", `El mínimo debe estar entre ${pesos(MINIMO_MAYORISTA_MIN)} y ${pesos(MINIMO_MAYORISTA_MAX)}.`);
      }
      const filas = await filasDe(tenantId);
      const vista = vistaDeFilas(filas);
      if (!vista.configurado || vista.minimo === null) throw traducirErrorMinimo({ message: "minimo_sin_configurar" });
      if (!vista.uniforme) throw new CmsError("CONFLICT", "Tus líneas de WhatsApp tienen montos mínimos distintos, así que no se puede elegir uno solo desde aquí. Avísale al equipo de DuLabs.");
      if (vista.minimo !== esperado) throw traducirErrorMinimo({ message: "minimo_cambio_mientras_tanto" });
      if (nuevo === vista.minimo) return { cambio: false, antes: vista.minimo, despues: vista.minimo, filas: filas.length, lugares: [] };

      const preparado = prepararCambioDeMinimo(filas, vista.minimo, nuevo);
      if (!preparado.ok) {
        if (preparado.motivo === "configuracion_invalida") {
          throw new CmsError("VALIDATION_ERROR", "La configuración de tu asistente tiene un problema que hay que corregir antes de cambiar el mínimo desde aquí. No se cambió nada. Avísale al equipo de DuLabs.");
        }
        throw new CmsError(
          "VALIDATION_ERROR",
          `Con ${pesos(nuevo)} uno de los textos del asistente que tiene el monto escrito superaría el largo permitido y el asistente dejaría de responder. No se cambió nada. Avísale al equipo de DuLabs para acortar ese texto.`,
        );
      }

      const { data, error } = await supabase.rpc("dulabs_agente_minimo_mayorista_aplicar", { p_tenant: tenantId, p_actor: actorUserId, p_esperado: esperado, p_nuevo: nuevo, p_filas: preparado.filas });
      if (error) throw traducirErrorMinimo(error);
      if (!esObjeto(data) || data.cambio !== true) throw new CmsError("INTERNAL_ERROR", MENSAJE_GENERAL);
      return { cambio: true, antes: vista.minimo, despues: nuevo, filas: typeof data.filas === "number" ? data.filas : filas.length, lugares: preparado.lugares };
    },
  };
}
