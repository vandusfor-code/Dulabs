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
  return async ({ idTenant, telefono }) => {
    const { state, guardarCredenciales } = await crearAuthStateSupabase(supabase, idTenant);
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
