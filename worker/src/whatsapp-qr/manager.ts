import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstadoConexion, EstadoPublico, EventoConexion, FabricaSocket, SocketWhatsApp } from "./tipos.js";
import { generarImagenQr } from "./qr-imagen.js";
import { logEstado, logErrorControlado } from "../logging.js";

const TABLA = "dulabs_whatsapp_qr_sesiones";

// WhatsApp QR (Fase 9A/9B, autorizado) — manager GENÉRICO por tenant. Aísla
// multitenant de la única manera que importa: el mapa en memoria y toda
// consulta a Supabase están SIEMPRE keyed por idTenant, y ese idTenant
// SIEMPRE llega ya resuelto desde el token en Next.js (ver
// lib/agenda-admin-auth.ts allá) antes de que la petición HTTP llegue al
// worker -- este módulo nunca expone una función para listar/iterar todas
// las sesiones, así que no hay forma de que un tenant vea la sesión de otro.
//
// No conoce Baileys: recibe una FabricaSocket inyectada (ver tipos.ts). La
// implementación real vive en socket-baileys.ts; las pruebas inyectan una
// falsa que nunca toca la red de WhatsApp -- mismo patrón de
// enviador/adaptador ya usado en cumpleaños/fidelización/comunicaciones.
const conexionesActivas = new Map<string, SocketWhatsApp>();

type FilaSesion = {
  estado: EstadoConexion;
  numero_conectado: string | null;
  conectado_en: string | null;
  qr_actual: string | null;
  codigo_vinculacion: string | null;
};

async function upsertEstado(
  supabase: SupabaseClient,
  idTenant: string,
  campos: Partial<{
    estado: EstadoConexion;
    numero_conectado: string | null;
    conectado_en: string | null;
    qr_actual: string | null;
    qr_generado_en: string | null;
    codigo_vinculacion: string | null;
    codigo_generado_en: string | null;
    ultimo_error: string | null;
    creds: null;
    claves: Record<string, never>;
  }>
): Promise<void> {
  const { error } = await supabase
    .from(TABLA)
    .upsert({ id_tenant: idTenant, ...campos, updated_at: new Date().toISOString() }, { onConflict: "id_tenant" });
  if (error) {
    logErrorControlado(idTenant, "upsert_estado_fallo");
    return;
  }
  if (campos.estado) logEstado(idTenant, campos.estado);
}

export async function obtenerEstadoPublico(supabase: SupabaseClient, idTenant: string): Promise<EstadoPublico> {
  const { data, error } = await supabase
    .from(TABLA)
    .select("estado, numero_conectado, conectado_en, qr_actual, codigo_vinculacion")
    .eq("id_tenant", idTenant)
    .maybeSingle<FilaSesion>();

  if (error) logErrorControlado(idTenant, "consulta_estado_fallo");

  if (!data) {
    return { idTenant, estado: "desconectado", numeroConectado: null, conectadoEn: null, qr: null, codigoVinculacion: null };
  }
  return {
    idTenant,
    estado: data.estado,
    numeroConectado: data.numero_conectado,
    conectadoEn: data.conectado_en,
    qr: data.qr_actual,
    codigoVinculacion: data.codigo_vinculacion,
  };
}

/** Único punto que expone una conexión activa -- siempre por idTenant exacto, nunca enumerable. */
export function obtenerConexionActiva(idTenant: string): SocketWhatsApp | undefined {
  return conexionesActivas.get(idTenant);
}

async function manejarEvento(
  supabase: SupabaseClient,
  idTenant: string,
  evento: EventoConexion,
  fabricaSocket: FabricaSocket
): Promise<void> {
  if (evento.tipo === "qr") {
    const qrImagen = await generarImagenQr(evento.qr);
    await upsertEstado(supabase, idTenant, {
      estado: "conectando",
      qr_actual: qrImagen,
      qr_generado_en: new Date().toISOString(),
      // Mutuamente excluyente con el código de vinculación -- una conexión
      // en curso usa un solo mecanismo a la vez.
      codigo_vinculacion: null,
    });
    return;
  }

  if (evento.tipo === "codigo_vinculacion") {
    await upsertEstado(supabase, idTenant, {
      estado: "conectando",
      codigo_vinculacion: evento.codigo,
      codigo_generado_en: new Date().toISOString(),
      qr_actual: null,
    });
    return;
  }

  if (evento.tipo === "conectado") {
    await upsertEstado(supabase, idTenant, {
      estado: "conectado",
      numero_conectado: evento.numero,
      conectado_en: new Date().toISOString(),
      qr_actual: null,
      codigo_vinculacion: null,
      ultimo_error: null,
    });
    return;
  }

  // desconectado -- siempre se suelta la conexión en memoria primero, sin
  // importar el motivo, para nunca dejar un socket "colgado" que ya cerró.
  conexionesActivas.delete(idTenant);

  if (evento.motivoFinal) {
    await upsertEstado(supabase, idTenant, {
      estado: "desconectado",
      numero_conectado: null,
      conectado_en: null,
      qr_actual: null,
      codigo_vinculacion: null,
      ultimo_error: evento.error ? "desconexion_no_recuperable" : null,
    });
    return;
  }

  // Caída recuperable (ej. red) -- reconecta reutilizando las credenciales
  // ya guardadas (la propia fabricaSocket las vuelve a leer de Supabase),
  // sin pedir un QR nuevo.
  await upsertEstado(supabase, idTenant, { estado: "conectando", ultimo_error: "reconectando_tras_caida" });
  await iniciarConexion(supabase, idTenant, fabricaSocket);
}

// Idempotente: si el tenant ya tiene una conexión activa en memoria
// (conectando o conectada), no abre una segunda -- devuelve el estado actual.
// `telefono` (opcional, solo dígitos con indicativo de país) pide el modo
// "vincular con número" en vez de QR -- ver socket-baileys.ts.
export async function iniciarConexion(
  supabase: SupabaseClient,
  idTenant: string,
  fabricaSocket: FabricaSocket,
  opciones?: { telefono?: string }
): Promise<EstadoPublico> {
  if (conexionesActivas.has(idTenant)) {
    return obtenerEstadoPublico(supabase, idTenant);
  }

  await upsertEstado(supabase, idTenant, { estado: "conectando", qr_actual: null, codigo_vinculacion: null, ultimo_error: null });

  try {
    const socket = await fabricaSocket({ idTenant, telefono: opciones?.telefono });
    conexionesActivas.set(idTenant, socket);
    socket.onEvento((evento) => {
      void manejarEvento(supabase, idTenant, evento, fabricaSocket);
    });
  } catch {
    conexionesActivas.delete(idTenant);
    logErrorControlado(idTenant, "fabrica_socket_fallo");
    await upsertEstado(supabase, idTenant, { estado: "desconectado", ultimo_error: "fabrica_socket_fallo" });
  }

  return obtenerEstadoPublico(supabase, idTenant);
}

// Cierra sesión de verdad: borra creds/claves (un futuro iniciarConexion
// exige un QR nuevo). Nunca lanza si el socket ya estaba muerto -- limpiar
// el estado en Supabase es lo que importa, no que el logout remoto confirme.
export async function desconectar(supabase: SupabaseClient, idTenant: string): Promise<EstadoPublico> {
  const socket = conexionesActivas.get(idTenant);
  conexionesActivas.delete(idTenant);
  if (socket) {
    try {
      await socket.cerrar();
    } catch {
      // ya se estaba cerrando del lado de WhatsApp -- no bloquea la limpieza.
    }
  }

  await upsertEstado(supabase, idTenant, {
    estado: "desconectado",
    numero_conectado: null,
    conectado_en: null,
    qr_actual: null,
    codigo_vinculacion: null,
    ultimo_error: null,
    creds: null,
    claves: {},
  });

  return obtenerEstadoPublico(supabase, idTenant);
}

// Arranque del worker (Fase 9B): tras un reinicio/redeploy, el mapa en
// memoria empieza vacío pero Supabase recuerda qué tenants estaban
// conectando/conectados -- se reintenta cada uno reutilizando sus
// credenciales persistidas (nunca pide un QR nuevo salvo que Baileys
// determine que hace falta, en cuyo caso simplemente emite un evento "qr"
// como cualquier otra vez y la fila queda en conectando+QR pendiente).
export async function recuperarSesionesPersistidas(
  supabase: SupabaseClient,
  fabricaSocket: FabricaSocket
): Promise<{ recuperadas: number }> {
  const { data } = await supabase.from(TABLA).select("id_tenant").in("estado", ["conectando", "conectado"]);
  const filas = (data ?? []) as { id_tenant: string }[];
  for (const fila of filas) {
    await iniciarConexion(supabase, fila.id_tenant, fabricaSocket);
  }
  return { recuperadas: filas.length };
}
