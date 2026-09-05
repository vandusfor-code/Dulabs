import type { SupabaseClient } from "@supabase/supabase-js";
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import { crearAuthStateSupabase } from "./auth-store.js";
import type { EventoConexion, FabricaSocket, SocketWhatsApp } from "./tipos.js";

function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

// WhatsApp QR (Fase 9A/9B, autorizado) — única implementación REAL de
// FabricaSocket (ver tipos.ts). El manager (manager.ts) no importa este
// archivo; lo recibe inyectado quien arma el servidor (server.ts). Las
// pruebas nunca importan este archivo -- inyectan su propia fábrica falsa,
// así que ninguna prueba automatizada abre una conexión real a los
// servidores de WhatsApp.
export function crearFabricaSocketBaileys(supabase: SupabaseClient): FabricaSocket {
  return async ({ idTenant }) => {
    const { state, guardarCredenciales } = await crearAuthStateSupabase(supabase, idTenant);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys) },
      browser: Browsers.macOS("Safari"),
      printQRInTerminal: false,
    });

    let handler: ((evento: EventoConexion) => void) | null = null;

    sock.ev.on("creds.update", guardarCredenciales);
    sock.ev.on("connection.update", (update) => {
      if (!handler) return;

      if (update.qr) {
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

    const socketWhatsApp: SocketWhatsApp = {
      onEvento(cb) {
        handler = cb;
      },
      async enviarMensaje(telefono, mensaje) {
        const jid = `${soloDigitos(telefono)}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: mensaje });
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
