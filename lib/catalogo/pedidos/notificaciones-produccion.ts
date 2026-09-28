/**
 * Bloque 31 — adaptadores de PRODUCCIÓN de las notificaciones de estado de pedidos:
 * Supabase (tabla dulabs_catalogo_pedido_notificaciones, módulo del negocio, canal y ventana de
 * 24 h desde dulabs_mensajes_log) y Meta Cloud API (texto libre, sin IA). Toda la lógica vive en
 * notificaciones.ts; aquí solo hay E/S.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteConfig } from "@/lib/supabase";
import { MetaGraphApiError, enviarTexto } from "@/lib/whatsapp";
import { registrarMensaje, resolverTokenMeta } from "@/lib/whatsapp-outbound";
import { moduloHabilitado } from "@/lib/tenant-modulos";
import {
  ErrorEnvioWhatsapp,
  type EnviadorWhatsapp,
  type EstadoNotificacion,
  type NotificacionesStore,
  type NotificadorDeps,
  type RegistroNotificacion,
  type TipoNotificacion,
} from "@/lib/catalogo/pedidos/notificaciones";

const TABLA = "dulabs_catalogo_pedido_notificaciones";
const SIN_TABLA = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);
const COLUMNAS = "id, tipo, estado_desde, estado_hacia, estado, motivo, error_codigo, error_mensaje, message_id, intentos, miembro_id, enviada_at, created_at, updated_at";
const ENVIO_TIMEOUT_MS = 10_000;

interface Fila {
  id: number;
  tipo: TipoNotificacion;
  estado_desde: string | null;
  estado_hacia: string;
  estado: EstadoNotificacion;
  motivo: string | null;
  error_codigo: string | null;
  error_mensaje: string | null;
  message_id: string | null;
  intentos: number;
  miembro_id: number | null;
  enviada_at: string | null;
  created_at: string;
  updated_at: string;
}

function registro(f: Fila): RegistroNotificacion {
  return {
    id: Number(f.id),
    tipo: f.tipo,
    estadoDesde: f.estado_desde,
    estadoHacia: f.estado_hacia,
    estado: f.estado,
    motivo: f.motivo,
    errorCodigo: f.error_codigo,
    errorMensaje: f.error_mensaje,
    messageId: f.message_id,
    intentos: f.intentos,
    miembroId: f.miembro_id === null ? null : Number(f.miembro_id),
    enviadaAt: f.enviada_at,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  };
}

export function createSupabaseNotificacionesStore(supabase: SupabaseClient): NotificacionesStore {
  const tabla = () => supabase.from(TABLA);
  return {
    // Módulo del negocio: encendido SOLO para quien corresponda (Delacour). Un error = apagado.
    habilitado: (tenantId) => moduloHabilitado(supabase, tenantId, "notificaciones_pedidos").catch(() => false),

    async reservar(i) {
      const { data, error } = await tabla()
        .insert({
          id_tenant: i.tenantId,
          pedido_id: i.pedidoId,
          pedido_publico: i.pedidoPublico,
          tipo: i.tipo,
          estado_desde: i.estadoDesde,
          estado_hacia: i.estadoHacia,
          phone_number_id: i.phoneNumberId,
          telefono_cliente: i.telefono,
          estado: "enviando",
          miembro_id: i.miembroId,
        })
        .select(COLUMNAS)
        .maybeSingle();
      if (!error && data) return { creada: true, registro: registro(data as Fila) };
      if (error && SIN_TABLA.has(error.code ?? "")) return null;
      if (error && error.code !== "23505") throw new Error(`[pedidos/notificaciones] reservar: ${error.code ?? "?"}`);
      // Ya existía (clave única pedido + tipo): se devuelve la que hay, sin crear otra.
      const { data: existente, error: e2 } = await tabla().select(COLUMNAS).eq("id_tenant", i.tenantId).eq("pedido_id", i.pedidoId).eq("tipo", i.tipo).maybeSingle();
      if (e2 || !existente) throw new Error(`[pedidos/notificaciones] leer existente: ${e2?.code ?? "sin fila"}`);
      return { creada: false, registro: registro(existente as Fila) };
    },

    async cambiar(tenantId, id, desde, cambios) {
      const { sumarIntento, ...resto } = cambios;
      let intentos: number | undefined;
      let intentosAntes: number | undefined;
      if (sumarIntento) {
        const { data } = await tabla().select("intentos").eq("id", id).eq("id_tenant", tenantId).maybeSingle();
        intentosAntes = (data as { intentos?: number } | null)?.intentos ?? 0;
        intentos = Math.min(20, intentosAntes + 1);
      }
      let q = tabla()
        .update({
          ...(resto.estado !== undefined ? { estado: resto.estado } : {}),
          ...("motivo" in resto ? { motivo: resto.motivo } : {}),
          ...("errorCodigo" in resto ? { error_codigo: resto.errorCodigo?.slice(0, 40) ?? null } : {}),
          ...("errorMensaje" in resto ? { error_mensaje: resto.errorMensaje?.slice(0, 300) ?? null } : {}),
          ...("messageId" in resto ? { message_id: resto.messageId?.slice(0, 200) ?? null } : {}),
          ...("enviadaAt" in resto ? { enviada_at: resto.enviadaAt } : {}),
          ...(intentos !== undefined ? { intentos } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("id_tenant", tenantId)
        .in("estado", [...desde]);
      if (intentosAntes !== undefined) q = q.eq("intentos", intentosAntes);
      const { data, error } = await q.select(COLUMNAS).maybeSingle();
      if (error) throw new Error(`[pedidos/notificaciones] cambiar: ${error.code ?? "?"}`);
      return data ? registro(data as Fila) : null;
    },

    async listar(tenantId, pedidoId) {
      const { data, error } = await tabla().select(COLUMNAS).eq("id_tenant", tenantId).eq("pedido_id", pedidoId).order("created_at", { ascending: true });
      if (error) {
        if (SIN_TABLA.has(error.code ?? "")) return [];
        throw new Error(`[pedidos/notificaciones] listar: ${error.code ?? "?"}`);
      }
      return ((data ?? []) as Fila[]).map(registro);
    },

    async canal(tenantId, phoneNumberId) {
      // El número del pedido debe pertenecer a ESTE negocio: nunca se escribe con el número de otro.
      const { data, error } = await supabase
        .from("dulabs_clientes_config")
        .select("id_tenant, phone_number_id, nombre_negocio, meta_permanent_token")
        .eq("phone_number_id", phoneNumberId)
        .eq("id_tenant", tenantId)
        .maybeSingle();
      if (error || !data) return null;
      const c = data as Pick<ClienteConfig, "id_tenant" | "phone_number_id" | "nombre_negocio" | "meta_permanent_token">;
      let token: string | null = null;
      try {
        token = resolverTokenMeta(c as ClienteConfig);
      } catch {
        token = null;
      }
      return { phoneNumberId: c.phone_number_id, token, nombreNegocio: c.nombre_negocio ?? null };
    },

    async ultimoEntrante(phoneNumberId, telefono) {
      const { data, error } = await supabase
        .from("dulabs_mensajes_log")
        .select("created_at")
        .eq("phone_number_id", phoneNumberId)
        .eq("telefono_cliente", telefono)
        .eq("direccion", "entrante")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return (data as { created_at?: string } | null)?.created_at ?? null;
    },
  };
}

/** Meta: 131047 = ventana de 24 h cerrada. 4xx = el mensaje NO salió (fallida); red/timeout = incierto. */
export function errorDeMeta(err: unknown): ErrorEnvioWhatsapp {
  if (err instanceof MetaGraphApiError) {
    const codigo = err.metaErrorCode !== undefined ? String(err.metaErrorCode) : `http_${err.httpStatus}`;
    return new ErrorEnvioWhatsapp(codigo, (err.metaErrorMessage ?? err.message).slice(0, 300), false, err.metaErrorCode === 131047);
  }
  const nombre = err instanceof Error ? err.name : "";
  const timeout = nombre === "TimeoutError" || nombre === "AbortError";
  return new ErrorEnvioWhatsapp(timeout ? "timeout" : "red", err instanceof Error ? err.message.slice(0, 300) : "error de red", true);
}

export function createMetaEnviador(supabase: SupabaseClient): EnviadorWhatsapp {
  return {
    async enviar(canal, telefono, texto) {
      if (!canal.token) throw new ErrorEnvioWhatsapp("sin_token", "El número no tiene token de Meta.", false);
      try {
        const { wamid } = await enviarTexto({ phoneNumberId: canal.phoneNumberId, token: canal.token, para: telefono, texto, signal: AbortSignal.timeout(ENVIO_TIMEOUT_MS) });
        return { messageId: wamid };
      } catch (err) {
        throw errorDeMeta(err);
      }
    },
    async registrar(canal, telefono, texto, messageId) {
      // En el Inbox como mensaje del NEGOCIO (automático). No pausa ni reactiva la IA: los envíos por
      // la API no vuelven como "ecos" de coexistencia; con el wamid registrado nada lo confunde.
      await registrarMensaje(supabase, canal.phoneNumberId, telefono, "saliente", texto, "agente", messageId ?? undefined);
    },
  };
}

export function productionNotificador(supabase: SupabaseClient): NotificadorDeps {
  return {
    store: createSupabaseNotificacionesStore(supabase),
    enviador: createMetaEnviador(supabase),
    log: (e) => console.info(JSON.stringify(e)),
  };
}
