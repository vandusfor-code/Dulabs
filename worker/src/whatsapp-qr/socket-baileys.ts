import type { SupabaseClient } from "@supabase/supabase-js";
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import { crearAuthStateSupabase } from "./auth-store.js";
import type { EventoConexion, FabricaSocket, SocketWhatsApp } from "./tipos.js";
import { persistirMensajeEntrante } from "../chats/persistir-mensaje.js";
import { invocarBotWhatsAppQR } from "../bot/invocar-bot.js";
import { logErrorControlado } from "../logging.js";

function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/**
 * Construye el JID de destino real para un "telefono" ya resuelto por
 * persistirMensajeEntrante (ver chats/persistir-mensaje.ts::resolverTelefono).
 * HALLAZGO REAL (verificado en producción, autorizado) — un identificador
 * marcado "lid:<dígitos>" (contacto LID cuyo número real no se pudo
 * resolver) NUNCA debe enviarse a "<dígitos>@s.whatsapp.net": esos dígitos
 * son un LID opaco, no un teléfono real, así que ese JID no corresponde a
 * ningún usuario de WhatsApp y el envío se pierde en silencio (bug real:
 * "escribo y el bot no me responde"). Ese caso se envía al dominio @lid
 * real en su lugar -- WhatsApp sí entrega mensajes a un JID @lid válido.
 */
function jidParaTelefono(telefono: string): string {
  if (telefono.startsWith("lid:")) return `${telefono.slice(4)}@lid`;
  return `${soloDigitos(telefono)}@s.whatsapp.net`;
}

// WhatsApp QR (Fase 9A/9B, autorizado) — única implementación REAL de
// FabricaSocket (ver tipos.ts). El manager (manager.ts) no importa este
// archivo; lo recibe inyectado quien arma el servidor (server.ts). Las
// pruebas nunca importan este archivo -- inyectan su propia fábrica falsa,
// así que ninguna prueba automatizada abre una conexión real a los
// servidores de WhatsApp.
export function crearFabricaSocketBaileys(supabase: SupabaseClient): FabricaSocket {
  return async ({ idTenant, slot, telefono }) => {
    const { state, guardarCredenciales } = await crearAuthStateSupabase(supabase, idTenant, slot);
    const { version } = await fetchLatestBaileysVersion();

    // "Vincular con número" (autorizado) -- alternativa real al QR, misma
    // API que ya expone Baileys (sock.requestPairingCode). Se pide una sola
    // vez, solo si esta sesión todavía no tiene credenciales registradas
    // (un socket que reconecta con creds ya guardadas nunca vuelve a pedir
    // código ni QR).
    const modoCodigoVinculacion = Boolean(telefono) && !state.creds.registered;

    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys) },
      browser: Browsers.macOS("Safari"),
      printQRInTerminal: false,
    });

    let handler: ((evento: EventoConexion) => void) | null = null;

    // Bot real (autorizado) — el bot y Jessica mandan por el MISMO
    // sock.sendMessage; Baileys reporta ambos envíos como "fromMe" por el
    // mismo evento messages.upsert, sin ninguna marca que distinga quién lo
    // mandó. Este registro efímero (solo en memoria, se autolimpia al
    // consumirse) es lo único que permite que persistirMensajeEntrante
    // grave el origen real del eco saliente -- nunca se persiste ni se lee
    // de ningún lado más.
    const origenPorMensajeId = new Map<string, "automatico">();
    function resolverOrigenSaliente(id: string): "automatico" | undefined {
      const origen = origenPorMensajeId.get(id);
      if (origen) origenPorMensajeId.delete(id);
      return origen;
    }

    if (modoCodigoVinculacion && telefono) {
      // Deliberadamente SIN await: requestPairingCode hace I/O de red real
      // (varios round-trips), así que su promesa nunca resuelve antes de
      // que este factory termine de retornar y el manager llame a
      // onEvento(cb) más abajo -- mismo razonamiento de timing que ya
      // aplica al evento "qr" (async, siempre después de que handler ya
      // esté asignado). Nunca lanza sin control: un error de red al pedir
      // el código queda igual que un fallo de fabricaSocket normal.
      sock
        .requestPairingCode(soloDigitos(telefono))
        .then((codigo) => handler?.({ tipo: "codigo_vinculacion", codigo }))
        .catch(() => handler?.({ tipo: "desconectado", motivoFinal: false, error: "fallo_solicitando_codigo" }));
    }

    sock.ev.on("creds.update", guardarCredenciales);
    sock.ev.on("connection.update", (update) => {
      if (!handler) return;

      if (update.qr && !modoCodigoVinculacion) {
        handler({ tipo: "qr", qr: update.qr });
      }

      if (update.connection === "open") {
        const jid = sock.user?.phoneNumber ?? sock.user?.id ?? null;
        handler({ tipo: "conectado", numero: jid ? jid.split("@")[0] : null });
      }

      if (update.connection === "close") {
        const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
          ?.statusCode;
        const motivoFinal = statusCode === DisconnectReason.loggedOut;
        handler({ tipo: "desconectado", motivoFinal, error: update.lastDisconnect?.error?.message });
      }
    });

    // Chats AMORE (autorizado) — ÚNICO listener real de mensajes entrantes
    // Y salientes (fromMe incluido): persiste ambas direcciones por el
    // mismo camino real, sin importar si el mensaje lo escribió la clienta
    // o si lo mandó Jessica desde el panel (ver lib/whatsapp-worker-client.ts
    // -> /enviar, que termina emitiendo este mismo evento). Un fallo de
    // persistencia nunca debe tumbar la sesión de WhatsApp -- solo se
    // registra con la etiqueta fija de siempre.
    // Mapeo LID↔PN que el propio Baileys mantiene (aprendido de
    // interacciones/contactos previos) -- se intenta ANTES de rendirse a
    // guardar un identificador "lid:..." (ver persistir-mensaje.ts). Nunca
    // lanza sin control: si el mapeo aún no existe o falla, se resuelve a
    // null y persistirMensajeEntrante cae a su fallback marcado de siempre.
    async function resolverPnDesdeLid(lidJid: string): Promise<string | null> {
      try {
        return await sock.signalRepository.lidMapping.getPNForLID(lidJid);
      } catch {
        return null;
      }
    }

    sock.ev.on("messages.upsert", ({ messages }) => {
      for (const msg of messages) {
        persistirMensajeEntrante(supabase, idTenant, slot, msg, resolverOrigenSaliente, resolverPnDesdeLid)
          .then((resultado) => {
            // Bot real (autorizado) — solo se invoca para texto entrante
            // real, y solo si la conversación está en "automatico" (nunca
            // si Jessica ya la tomó a mano, ni si está archivada/esperando
            // atención humana). msg.key.id es el wamid real de Baileys,
            // usado como eventId idempotente por el propio Flow Engine.
            //
            // WhatsApp multi-cuenta (autorizado) — el bot/Flow Engine SOLO
            // se invoca para el slot 1 ("WhatsApp principal"). El slot 2
            // nunca dispara ninguna automatización: persistirMensajeEntrante
            // ya garantiza que una conversación nueva en slot 2 nace en
            // "requiere_atencion" (nunca "automatico"), así que esta
            // condición es, en la práctica, una segunda barrera explícita
            // -- nunca se depende de una sola capa para algo tan importante
            // como "no inventar una lógica de distribución entre cuentas".
            if (slot === 1 && resultado?.entrante && resultado.tipo === "texto" && resultado.texto && resultado.estadoConversacion === "automatico" && msg.key.id) {
              // "Escribiendo..." real (autorizado) — el bot puede tardar
              // varios segundos (varias llamadas reales a Claude en cadena:
              // clasificar, extraer, responder). Un solo sendPresenceUpdate
              // no alcanza: WhatsApp lo vence a los pocos segundos si no se
              // refresca, así que se reenvía cada 8s mientras se espera.
              // "paused" al final limpia el indicador si el bot falla sin
              // llegar a mandar nada -- un envío real ya lo limpia solo.
              const jidEntrante = jidParaTelefono(resultado.telefono);
              sock.sendPresenceUpdate("composing", jidEntrante).catch(() => {});
              const refrescoTyping = setInterval(() => {
                sock.sendPresenceUpdate("composing", jidEntrante).catch(() => {});
              }, 8000);
              invocarBotWhatsAppQR({ idTenant, telefono: resultado.telefono, texto: resultado.texto, wamid: msg.key.id })
                .catch(() => {
                  logErrorControlado(idTenant, "invocacion_bot_fallo");
                })
                .finally(() => {
                  clearInterval(refrescoTyping);
                  sock.sendPresenceUpdate("paused", jidEntrante).catch(() => {});
                });
            }
          })
          .catch(() => {
            logErrorControlado(idTenant, "persistir_mensaje_chat_fallo");
          });
      }
    });

    const socketWhatsApp: SocketWhatsApp = {
      onEvento(cb) {
        handler = cb;
      },
      async enviarMensaje(telefono, mensaje, origen) {
        const jid = jidParaTelefono(telefono);
        const enviado = await sock.sendMessage(jid, { text: mensaje });
        if (origen === "automatico" && enviado?.key.id) origenPorMensajeId.set(enviado.key.id, "automatico");
      },
      async enviarAudio(telefono, audio, mimeType) {
        const jid = jidParaTelefono(telefono);
        // ptt=true (nota de voz): WhatsApp espera nativamente OGG/Opus para
        // esa burbuja -- un navegador real casi siempre entrega
        // audio/webm;codecs=opus (mismo audio Opus, contenedor distinto).
        // Sin ffmpeg disponible en este worker no se puede reempaquetar a
        // OGG de forma estable, así que se envía tal cual con su mimetype
        // real. HALLAZGO PENDIENTE DE VERIFICAR: no se ha podido confirmar
        // contra un dispositivo real (esta fase prohíbe conectar el número
        // WABA real) si WhatsApp reproduce esto como nota de voz normal o
        // como archivo adjunto genérico -- documentado en el reporte final.
        await sock.sendMessage(jid, { audio, mimetype: mimeType, ptt: true });
      },
      async cerrar() {
        try {
          await sock.logout();
        } catch {
          // ya puede estar cerrada del lado de WhatsApp -- no bloquea la limpieza.
        }
        await sock.end(undefined);
      },
    };

    return socketWhatsApp;
  };
}
